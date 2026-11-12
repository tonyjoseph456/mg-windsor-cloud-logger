/**
 * MG Windsor EV Telematics - Admin Portal & Access Control Engine
 * 
 * Provides:
 * 1. Self-contained responsive Admin Website at /admin
 * 2. One-Time Access Code Generator & Validator (/api/auth/* & /api/admin/*)
 * 3. User Authorization & Access Revocation (/api/admin/users/*)
 * 4. Audit Logging of all login attempts and code redemptions (/api/admin/logs)
 */

export const ADMIN_TABLE_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS access_codes (
    code TEXT PRIMARY KEY,
    assigned_name TEXT,
    assigned_phone TEXT,
    notes TEXT,
    status TEXT DEFAULT 'active', -- 'active' | 'used' | 'revoked'
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    expires_at INTEGER,           -- Unix timestamp (seconds), null = no expiration
    redeemed_at TEXT,
    redeemed_by_phone TEXT,
    redeemed_by_vin TEXT,
    redeemed_device_info TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_access_codes_status ON access_codes(status)`,
  `CREATE INDEX IF NOT EXISTS idx_access_codes_phone ON access_codes(assigned_phone)`,
  `CREATE TABLE IF NOT EXISTS authorized_users (
    id TEXT PRIMARY KEY,
    phone TEXT UNIQUE NOT NULL,
    name TEXT,
    status TEXT DEFAULT 'active', -- 'active' | 'blocked'
    access_code TEXT,
    vin TEXT,
    car_name TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_authorized_users_phone ON authorized_users(phone)`,
  `CREATE TABLE IF NOT EXISTS access_logs (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,         -- 'code_generated' | 'code_redeemed' | 'code_revoked' | 'login_success' | 'login_blocked' | 'user_blocked' | 'user_unblocked'
    phone TEXT,
    code TEXT,
    status TEXT NOT NULL,         -- 'success' | 'blocked' | 'revoked'
    reason TEXT,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at DESC)`
];

export async function initAccessControlD1(db: any) {
  if (!db || typeof db.prepare !== 'function') return;
  for (const sql of ADMIN_TABLE_SCHEMAS) {
    try {
      await db.prepare(sql).run();
    } catch (_) {}
  }
}

// ---------------------------------------------------------------- Admin Authentication & Password Management
const DEFAULT_ADMIN_PASSWORD = 'WindsorAdmin@2026';
const MASTER_ACCESS_CODE = 'WINDSOR-MASTER-2026';

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toHex(buf);
}

function generateRandomToken(bytesLen = 24): string {
  const arr = new Uint8Array(bytesLen);
  crypto.getRandomValues(arr);
  return toHex(arr.buffer);
}

export function generateAccessCode(prefix = 'WND'): string {
  // Characters excluding ambiguous 0, O, 1, I
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let p1 = '';
  let p2 = '';
  const rnd = new Uint8Array(8);
  crypto.getRandomValues(rnd);
  for (let i = 0; i < 4; i++) p1 += chars[rnd[i] % chars.length];
  for (let i = 4; i < 8; i++) p2 += chars[rnd[i] % chars.length];
  return `${prefix}-${p1}-${p2}`;
}

async function getStoredAdminPasswordHash(env: any): Promise<{ hash: string; salt: string } | null> {
  if (env.DB) {
    try {
      const row: any = await env.DB.prepare("SELECT value FROM kv_store WHERE key = 'admin:pwd_hash'").first();
      if (row?.value) {
        return JSON.parse(row.value);
      }
    } catch (_) {}
  }
  return null;
}

async function setStoredAdminPasswordHash(env: any, hash: string, salt: string): Promise<void> {
  const payload = JSON.stringify({ hash, salt, updatedAt: new Date().toISOString() });
  if (env.DB) {
    try {
      await env.DB.prepare("INSERT OR REPLACE INTO kv_store (key, value) VALUES ('admin:pwd_hash', ?)").bind(payload).run();
    } catch (_) {}
  }
}

export async function verifyAdminPassword(env: any, candidate: string): Promise<boolean> {
  if (!candidate) return false;
  // 1. Check custom environment secret override if configured
  if (env.ADMIN_PASSWORD && candidate === env.ADMIN_PASSWORD) {
    return true;
  }
  // 2. Check D1 stored hash
  const stored = await getStoredAdminPasswordHash(env);
  if (stored?.hash && stored?.salt) {
    const computed = await sha256(stored.salt + candidate);
    return computed === stored.hash;
  }
  // 3. Fallback to default admin password
  return candidate === DEFAULT_ADMIN_PASSWORD;
}

export async function changeAdminPassword(env: any, oldPwd: string, newPwd: string): Promise<{ success: boolean; error?: string }> {
  if (!newPwd || newPwd.trim().length < 6) {
    return { success: false, error: 'New password must be at least 6 characters long' };
  }
  const isOldValid = await verifyAdminPassword(env, oldPwd);
  if (!isOldValid) {
    return { success: false, error: 'Current admin password is incorrect' };
  }
  const salt = generateRandomToken(16);
  const hash = await sha256(salt + newPwd.trim());
  await setStoredAdminPasswordHash(env, hash, salt);
  return { success: true };
}

export async function verifyAdminToken(env: any, request: Request): Promise<boolean> {
  const authHeader = request.headers.get('Authorization') || request.headers.get('x-admin-token') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;

  if (env.DB) {
    try {
      const key = `adm_token:${token}`;
      const row: any = await env.DB.prepare("SELECT value FROM kv_store WHERE key = ?").bind(key).first();
      if (row?.value) {
        const parsed = JSON.parse(row.value);
        if (parsed.expiresAt && Date.now() < parsed.expiresAt) {
          return true;
        }
      }
    } catch (_) {}
  }
  return false;
}

export async function createAdminSession(env: any): Promise<string> {
  const token = `adm_${Date.now()}_${generateRandomToken(18)}`;
  const expiresAt = Date.now() + 7 * 86400 * 1000; // 7 days session
  if (env.DB) {
    try {
      const key = `adm_token:${token}`;
      const payload = JSON.stringify({ token, createdAt: Date.now(), expiresAt });
      await env.DB.prepare("INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)").bind(key, payload).run();
    } catch (_) {}
  }
  return token;
}

// ---------------------------------------------------------------- Audit Logging Helper
export async function logAccessEvent(
  env: any,
  action: string,
  phone: string | null,
  code: string | null,
  status: 'success' | 'blocked' | 'revoked',
  reason: string,
  request?: Request
) {
  if (!env.DB) return;
  const ip = request ? (request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown') : 'unknown';
  const ua = request ? (request.headers.get('user-agent') || 'unknown') : 'unknown';
  const id = `log_${Date.now()}_${generateRandomToken(4)}`;
  try {
    await env.DB.prepare(`
      INSERT INTO access_logs (id, action, phone, code, status, reason, ip, user_agent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(id, action, phone || null, code || null, status, reason, ip.slice(0, 45), ua.slice(0, 160)).run();
  } catch (_) {}
}

// ---------------------------------------------------------------- Core Access Validation & Code Consumption
export async function validateAccessCode(env: any, rawCode: string, rawPhone: string, request?: Request): Promise<{
  valid: boolean;
  code?: string;
  assignedName?: string;
  isAlreadyAuthorized?: boolean;
  error?: string;
}> {
  const code = (rawCode || '').trim().toUpperCase();
  const phone = (rawPhone || '').replace(/\D/g, '');

  if (!env.DB) {
    // If DB is offline, allow master access code as fallback
    if (code === MASTER_ACCESS_CODE) {
      return { valid: true, code: MASTER_ACCESS_CODE, assignedName: 'Master Admin' };
    }
    return { valid: false, error: 'Database service is currently unavailable' };
  }

  // 1. Check if the user is already authorized and NOT blocked
  if (phone) {
    try {
      const user: any = await env.DB.prepare("SELECT * FROM authorized_users WHERE phone = ?").bind(phone).first();
      if (user) {
        if (user.status === 'blocked') {
          await logAccessEvent(env, 'login_blocked', phone, code, 'blocked', 'User account is blocked by administrator', request);
          return { valid: false, error: 'Your access has been suspended by the administrator.' };
        }
        // User already has an authorized account on file!
        return { valid: true, code: user.access_code || 'PRE_AUTHORIZED', assignedName: user.name || 'Friend', isAlreadyAuthorized: true };
      }
    } catch (_) {}
  }

  // 2. Allow Master Access Code for initial setup / owner
  if (code === MASTER_ACCESS_CODE) {
    return { valid: true, code: MASTER_ACCESS_CODE, assignedName: 'Owner / Master' };
  }

  if (!code) {
    return { valid: false, error: 'One-time access code is required to sign in.' };
  }

  // 3. Query the access code in D1
  try {
    const row: any = await env.DB.prepare("SELECT * FROM access_codes WHERE code = ?").bind(code).first();
    if (!row) {
      await logAccessEvent(env, 'login_blocked', phone, code, 'blocked', 'Invalid access code', request);
      return { valid: false, error: 'Invalid access code. Please request an access code from the administrator.' };
    }

    if (row.status === 'used') {
      await logAccessEvent(env, 'login_blocked', phone, code, 'blocked', 'Code already used', request);
      return { valid: false, error: `This access code has already been claimed (used by ${row.redeemed_by_phone || 'another user'}) and cannot be reused.` };
    }

    if (row.status === 'revoked') {
      await logAccessEvent(env, 'login_blocked', phone, code, 'revoked', 'Code was revoked by admin', request);
      return { valid: false, error: 'This access code has been revoked by the administrator.' };
    }

    if (row.expires_at && Math.floor(Date.now() / 1000) > row.expires_at) {
      await logAccessEvent(env, 'login_blocked', phone, code, 'revoked', 'Code expired', request);
      return { valid: false, error: 'This access code has expired.' };
    }

    if (row.assigned_phone && row.assigned_phone.replace(/\D/g, '') !== phone) {
      await logAccessEvent(env, 'login_blocked', phone, code, 'blocked', 'Code phone mismatch', request);
      return { valid: false, error: 'This access code is designated for a different mobile number.' };
    }

    return { valid: true, code: row.code, assignedName: row.assigned_name || 'Friend' };
  } catch (err: any) {
    return { valid: false, error: `Access verification failed: ${err.message}` };
  }
}

export async function consumeAccessCode(
  env: any,
  rawCode: string,
  rawPhone: string,
  vin?: string,
  carName?: string,
  deviceInfo?: string,
  request?: Request
): Promise<{ success: boolean; licenseToken?: string; error?: string }> {
  const code = (rawCode || '').trim().toUpperCase();
  const phone = (rawPhone || '').replace(/\D/g, '');

  if (!phone) {
    return { success: false, error: 'Valid mobile number is required' };
  }

  const check = await validateAccessCode(env, code, phone, request);
  if (!check.valid) {
    return { success: false, error: check.error };
  }

  const licenseToken = `lic_${phone}_${generateRandomToken(16)}`;

  if (env.DB) {
    try {
      // Mark code as used (unless it's the master override code)
      if (code !== MASTER_ACCESS_CODE && !check.isAlreadyAuthorized) {
        await env.DB.prepare(`
          UPDATE access_codes
          SET status = 'used',
              redeemed_at = CURRENT_TIMESTAMP,
              redeemed_by_phone = ?,
              redeemed_by_vin = ?,
              redeemed_device_info = ?
          WHERE code = ?
        `).bind(phone, vin || null, deviceInfo || null, code).run();
      }

      // Upsert into authorized_users
      const userId = `usr_${phone}`;
      await env.DB.prepare(`
        INSERT INTO authorized_users (id, phone, name, status, access_code, vin, car_name, created_at, last_login_at)
        VALUES (?, ?, ?, 'active', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(phone) DO UPDATE SET
          last_login_at = CURRENT_TIMESTAMP,
          vin = COALESCE(excluded.vin, authorized_users.vin),
          car_name = COALESCE(excluded.car_name, authorized_users.car_name),
          access_code = COALESCE(excluded.access_code, authorized_users.access_code)
      `).bind(userId, phone, check.assignedName || 'Friend', code, vin || null, carName || null).run();

      await logAccessEvent(env, 'code_redeemed', phone, code, 'success', `Authorized access granted for ${carName || 'Windsor EV'}`, request);
    } catch (e: any) {
      console.warn('consumeAccessCode error:', e);
    }
  }

  return { success: true, licenseToken };
}

// ---------------------------------------------------------------- API Route Handlers
export async function handleAuthApi(env: any, request: Request, url: URL, body: any): Promise<Response> {
  const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-token',
      },
    });

  const path = url.pathname;

  // 1. Verify Access Code (/api/auth/verify-code)
  if (path === '/api/auth/verify-code') {
    const code = body?.code || url.searchParams.get('code') || '';
    const phone = body?.phone || url.searchParams.get('phone') || '';
    const res = await validateAccessCode(env, code, phone, request);
    return json(res);
  }

  // 2. Consume Access Code upon successful MG login (/api/auth/consume-code)
  if (path === '/api/auth/consume-code') {
    const code = body?.code || '';
    const phone = body?.phone || '';
    const vin = body?.vin || '';
    const carName = body?.carName || '';
    const deviceInfo = body?.deviceInfo || request.headers.get('user-agent') || '';
    const res = await consumeAccessCode(env, code, phone, vin, carName, deviceInfo, request);
    return json(res, res.success ? 200 : 403);
  }

  // 3. Check User Authorization Status (/api/auth/check-status)
  if (path === '/api/auth/check-status') {
    const phone = (body?.phone || url.searchParams.get('phone') || '').replace(/\D/g, '');
    if (!phone) return json({ authorized: false, error: 'Phone required' }, 400);

    if (env.DB) {
      try {
        const user: any = await env.DB.prepare("SELECT * FROM authorized_users WHERE phone = ?").bind(phone).first();
        if (user) {
          if (user.status === 'blocked') {
            return json({ authorized: false, reason: 'blocked', error: 'Access revoked by administrator' }, 403);
          }
          return json({ authorized: true, user: { phone: user.phone, name: user.name, status: user.status, vin: user.vin } });
        }
      } catch (_) {}
    }
    // If phone is configured as primary car owner, treat as authorized
    if (env.MG_PHONE && phone === env.MG_PHONE.replace(/\D/g, '')) {
      return json({ authorized: true, user: { phone, name: 'Primary Owner', status: 'active' } });
    }
    return json({ authorized: false, reason: 'not_found' });
  }

  return json({ error: 'Auth endpoint not found' }, 404);
}

export async function handleAdminApi(env: any, request: Request, url: URL, body: any): Promise<Response> {
  const json = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-token',
      },
    });

  const path = url.pathname;

  // 1. Admin Login (/api/admin/login)
  if (path === '/api/admin/login') {
    const password = body?.password || '';
    const isValid = await verifyAdminPassword(env, password);
    if (!isValid) {
      await logAccessEvent(env, 'admin_login_failed', null, null, 'blocked', 'Incorrect admin password', request);
      return json({ success: false, error: 'Invalid admin password' }, 401);
    }
    const token = await createAdminSession(env);
    await logAccessEvent(env, 'admin_login_success', null, null, 'success', 'Admin logged in', request);
    return json({ success: true, token, expiresAt: Date.now() + 7 * 86400 * 1000 });
  }

  // All other /api/admin/* routes require a verified admin session
  const isAdmin = await verifyAdminToken(env, request);
  if (!isAdmin) {
    return json({ success: false, error: 'Unauthorized: Admin authentication required' }, 401);
  }

  // 2. Change Admin Password (/api/admin/change-password)
  if (path === '/api/admin/change-password') {
    const oldPwd = body?.oldPassword || '';
    const newPwd = body?.newPassword || '';
    const res = await changeAdminPassword(env, oldPwd, newPwd);
    return json(res, res.success ? 200 : 400);
  }

  // 3. Stats & Overview (/api/admin/stats)
  if (path === '/api/admin/stats') {
    let totalUsers = 0;
    let activeCodes = 0;
    let redeemedCodes = 0;
    let registeredCars = 0;

    if (env.DB) {
      try {
        const uRow: any = await env.DB.prepare("SELECT COUNT(*) AS c FROM authorized_users").first();
        totalUsers = Number(uRow?.c || 0);

        const aRow: any = await env.DB.prepare("SELECT COUNT(*) AS c FROM access_codes WHERE status = 'active'").first();
        activeCodes = Number(aRow?.c || 0);

        const rRow: any = await env.DB.prepare("SELECT COUNT(*) AS c FROM access_codes WHERE status = 'used'").first();
        redeemedCodes = Number(rRow?.c || 0);

        const vRow: any = await env.DB.prepare("SELECT COUNT(DISTINCT vin) AS c FROM authorized_users WHERE vin IS NOT NULL AND vin != ''").first();
        registeredCars = Number(vRow?.c || 0);
      } catch (_) {}
    }

    return json({
      success: true,
      stats: { totalUsers, activeCodes, redeemedCodes, registeredCars },
      dbOnline: Boolean(env.DB),
      serverTime: new Date().toISOString(),
    });
  }

  // 4. Access Codes List (/api/admin/codes)
  if (path === '/api/admin/codes' && request.method === 'GET') {
    if (!env.DB) return json({ success: true, codes: [] });
    try {
      const res: any = await env.DB.prepare(`
        SELECT * FROM access_codes ORDER BY created_at DESC LIMIT 200
      `).all();
      return json({ success: true, codes: res?.results || [] });
    } catch (e: any) {
      return json({ success: false, error: e.message }, 500);
    }
  }

  // 5. Generate One-Time Access Code (/api/admin/codes/generate)
  if (path === '/api/admin/codes/generate' && request.method === 'POST') {
    const name = (body?.name || '').trim();
    const phone = (body?.phone || '').replace(/\D/g, '');
    const notes = (body?.notes || '').trim();
    const expiresDays = Number(body?.expiresDays) || 0;
    const expiresAt = expiresDays > 0 ? Math.floor(Date.now() / 1000) + expiresDays * 86400 : null;
    const customCode = (body?.customCode || '').trim().toUpperCase();
    const code = customCode && /^[A-Z0-9-]{6,20}$/.test(customCode) ? customCode : generateAccessCode('WND');

    if (!env.DB) return json({ success: false, error: 'Database unavailable' }, 500);

    try {
      await env.DB.prepare(`
        INSERT INTO access_codes (code, assigned_name, assigned_phone, notes, status, created_at, expires_at)
        VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, ?)
      `).bind(code, name || null, phone || null, notes || null, expiresAt).run();

      await logAccessEvent(env, 'code_generated', phone || null, code, 'success', `Generated for ${name || 'Friend'}`, request);

      return json({
        success: true,
        code: {
          code,
          assigned_name: name,
          assigned_phone: phone,
          notes,
          status: 'active',
          expires_at: expiresAt,
          created_at: new Date().toISOString(),
        },
      });
    } catch (e: any) {
      return json({ success: false, error: e.message }, 500);
    }
  }

  // 6. Revoke Access Code (/api/admin/codes/revoke)
  if (path === '/api/admin/codes/revoke' && request.method === 'POST') {
    const code = body?.code || '';
    if (!code || !env.DB) return json({ success: false, error: 'Code required' }, 400);
    try {
      await env.DB.prepare("UPDATE access_codes SET status = 'revoked' WHERE code = ?").bind(code).run();
      await logAccessEvent(env, 'code_revoked', null, code, 'revoked', 'Code revoked by admin', request);
      return json({ success: true, message: `Access code ${code} revoked` });
    } catch (e: any) {
      return json({ success: false, error: e.message }, 500);
    }
  }

  // 7. Delete Access Code (/api/admin/codes/delete)
  if (path === '/api/admin/codes/delete' && (request.method === 'POST' || request.method === 'DELETE')) {
    const code = body?.code || url.searchParams.get('code') || '';
    if (!code || !env.DB) return json({ success: false, error: 'Code required' }, 400);
    try {
      await env.DB.prepare("DELETE FROM access_codes WHERE code = ?").bind(code).run();
      return json({ success: true, message: `Access code ${code} deleted` });
    } catch (e: any) {
      return json({ success: false, error: e.message }, 500);
    }
  }

  // 8. Authorized Users List (/api/admin/users)
  if (path === '/api/admin/users' && request.method === 'GET') {
    if (!env.DB) return json({ success: true, users: [] });
    try {
      const res: any = await env.DB.prepare(`
        SELECT * FROM authorized_users ORDER BY last_login_at DESC LIMIT 200
      `).all();
      return json({ success: true, users: res?.results || [] });
    } catch (e: any) {
      return json({ success: false, error: e.message }, 500);
    }
  }

  // 9. Add User Manually (/api/admin/users/add)
  if (path === '/api/admin/users/add' && request.method === 'POST') {
    const name = (body?.name || '').trim();
    const phone = (body?.phone || '').replace(/\D/g, '');
    const notes = (body?.notes || '').trim();

    if (!phone || phone.length < 10) {
      return json({ success: false, error: 'Valid 10-digit mobile number required' }, 400);
    }

    if (!env.DB) return json({ success: false, error: 'Database unavailable' }, 500);

    try {
      const id = `usr_${phone}`;
      await env.DB.prepare(`
        INSERT INTO authorized_users (id, phone, name, status, notes, created_at, last_login_at)
        VALUES (?, ?, ?, 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(phone) DO UPDATE SET name = excluded.name, notes = excluded.notes, status = 'active'
      `).bind(id, phone, name || 'Authorized Friend', notes || null).run();

      await logAccessEvent(env, 'user_added', phone, null, 'success', `Manually added by admin (${name})`, request);
      return json({ success: true, message: `User ${name || phone} authorized successfully` });
    } catch (e: any) {
      return json({ success: false, error: e.message }, 500);
    }
  }

  // 10. Toggle User Block Status (/api/admin/users/toggle-block)
  if (path === '/api/admin/users/toggle-block' && request.method === 'POST') {
    const phone = (body?.phone || '').replace(/\D/g, '');
    const block = Boolean(body?.blocked);
    const newStatus = block ? 'blocked' : 'active';

    if (!phone || !env.DB) return json({ success: false, error: 'Phone required' }, 400);

    try {
      await env.DB.prepare("UPDATE authorized_users SET status = ? WHERE phone = ?").bind(newStatus, phone).run();
      await logAccessEvent(env, block ? 'user_blocked' : 'user_unblocked', phone, null, block ? 'blocked' : 'success', `User ${newStatus} by admin`, request);
      return json({ success: true, message: `User ${phone} is now ${newStatus}` });
    } catch (e: any) {
      return json({ success: false, error: e.message }, 500);
    }
  }

  // 11. Delete User (/api/admin/users/delete)
  if (path === '/api/admin/users/delete' && (request.method === 'POST' || request.method === 'DELETE')) {
    const phone = (body?.phone || url.searchParams.get('phone') || '').replace(/\D/g, '');
    if (!phone || !env.DB) return json({ success: false, error: 'Phone required' }, 400);
    try {
      await env.DB.prepare("DELETE FROM authorized_users WHERE phone = ?").bind(phone).run();
      return json({ success: true, message: `User ${phone} removed` });
    } catch (e: any) {
      return json({ success: false, error: e.message }, 500);
    }
  }

  // 12. Security Audit Logs (/api/admin/logs)
  if (path === '/api/admin/logs' && request.method === 'GET') {
    if (!env.DB) return json({ success: true, logs: [] });
    try {
      const res: any = await env.DB.prepare(`
        SELECT * FROM access_logs ORDER BY created_at DESC LIMIT 100
      `).all();
      return json({ success: true, logs: res?.results || [] });
    } catch (e: any) {
      return json({ success: false, error: e.message }, 500);
    }
  }

  return json({ error: 'Admin API route not found' }, 404);
}

// ---------------------------------------------------------------- Admin Single-Page Website HTML Generator
export function renderAdminWebsiteHtml(env?: any, url?: URL): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>MG Windsor EV • Backend Admin Console</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220%22%20%22100%22><text y=%22.9em%22 font-size=%2290%22>⚡</text></svg>">
  <style>
    :root {
      --bg: #070B14;
      --card-bg: #0F172A;
      --card-border: #1E293B;
      --card-hover: #172554;
      --primary: #10B981;
      --primary-glow: #10B98130;
      --cyan: #38BDF8;
      --danger: #EF4444;
      --warning: #F59E0B;
      --text: #F8FAFC;
      --text-muted: #94A3B8;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--card-border);
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-logo {
      background: linear-gradient(135deg, #10B981, #0284C7);
      color: #fff;
      font-weight: 900;
      font-size: 14px;
      padding: 6px 10px;
      border-radius: 8px;
      letter-spacing: 1px;
    }
    .brand-title {
      font-size: 17px;
      font-weight: 800;
      letter-spacing: 0.3px;
    }
    .brand-sub {
      font-size: 11px;
      color: var(--text-muted);
      font-weight: 500;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .badge-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 99px;
      background: #064E3B;
      color: #34D399;
      font-weight: 700;
      border: 1px solid #059669;
    }
    .btn {
      background: var(--primary);
      color: #022C22;
      border: none;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    .btn:hover {
      filter: brightness(1.1);
      transform: translateY(-1px);
    }
    .btn-secondary {
      background: #1E293B;
      color: #F8FAFC;
    }
    .btn-secondary:hover {
      background: #334155;
    }
    .btn-danger {
      background: #7F1D1D;
      color: #FCA5A5;
      border: 1px solid #DC2626;
    }
    .btn-danger:hover {
      background: #991B1B;
    }
    .btn-sm {
      padding: 4px 10px;
      font-size: 11px;
      border-radius: 6px;
    }
    .nav-tabs {
      display: flex;
      gap: 6px;
      background: #0B1120;
      padding: 6px 24px;
      border-bottom: 1px solid var(--card-border);
      overflow-x: auto;
    }
    .nav-tab {
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      color: var(--text-muted);
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .nav-tab:hover {
      color: #F8FAFC;
      background: rgba(255, 255, 255, 0.05);
    }
    .nav-tab.active {
      color: #34D399;
      background: #064E3B40;
      border: 1px solid #05966960;
    }
    main {
      flex: 1;
      padding: 24px;
      max-width: 1200px;
      margin: 0 auto;
      width: 100%;
    }
    .grid-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 18px 20px;
      position: relative;
      overflow: hidden;
    }
    .stat-card::after {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: linear-gradient(90deg, var(--primary), var(--cyan));
    }
    .stat-label {
      font-size: 12px;
      color: var(--text-muted);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .stat-value {
      font-size: 28px;
      font-weight: 900;
      color: #fff;
    }
    .stat-sub {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 20px;
      margin-bottom: 24px;
    }
    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .card-title {
      font-size: 16px;
      font-weight: 800;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }
    th {
      background: #0B1120;
      color: var(--text-muted);
      font-weight: 700;
      padding: 12px 14px;
      border-bottom: 1px solid var(--card-border);
      text-transform: uppercase;
      font-size: 10.5px;
      letter-spacing: 0.5px;
    }
    td {
      padding: 12px 14px;
      border-bottom: 1px solid #1E293B80;
      vertical-align: middle;
    }
    tr:hover td {
      background: rgba(255, 255, 255, 0.02);
    }
    .code-badge {
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 700;
      background: #0B1120;
      border: 1px solid #334155;
      padding: 4px 8px;
      border-radius: 6px;
      color: #38BDF8;
      letter-spacing: 1px;
      display: inline-block;
    }
    .status-badge {
      font-size: 10.5px;
      font-weight: 800;
      padding: 3px 8px;
      border-radius: 6px;
      display: inline-block;
    }
    .status-active { background: #064E3B; color: #34D399; border: 1px solid #059669; }
    .status-used { background: #1E3A8A; color: #93C5FD; border: 1px solid #2563EB; }
    .status-revoked { background: #7F1D1D; color: #FCA5A5; border: 1px solid #DC2626; }
    .status-blocked { background: #7F1D1D; color: #FCA5A5; border: 1px solid #DC2626; }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(6px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 100;
      padding: 16px;
    }
    .modal {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      width: 100%;
      max-width: 480px;
      padding: 24px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    }
    .modal-title {
      font-size: 18px;
      font-weight: 800;
      margin-bottom: 6px;
    }
    .modal-sub {
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 20px;
    }
    .form-group {
      margin-bottom: 16px;
    }
    .form-label {
      display: block;
      font-size: 12px;
      font-weight: 700;
      color: var(--text-muted);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .form-input {
      width: 100%;
      background: #0B1120;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 10px 14px;
      color: #fff;
      font-size: 14px;
      outline: none;
      transition: border 0.15s ease;
    }
    .form-input:focus {
      border-color: var(--primary);
    }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 24px;
    }
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #10B981;
      color: #022C22;
      font-weight: 700;
      padding: 12px 20px;
      border-radius: 10px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      z-index: 200;
      display: none;
      animation: slideUp 0.2s ease;
    }
    @keyframes slideUp {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .login-container {
      max-width: 400px;
      margin: 80px auto;
      padding: 32px 24px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 18px;
      text-align: center;
    }
    .login-logo {
      display: inline-block;
      background: linear-gradient(135deg, #10B981, #0284C7);
      color: #fff;
      font-size: 20px;
      font-weight: 900;
      padding: 10px 16px;
      border-radius: 12px;
      margin-bottom: 16px;
    }
    .login-title {
      font-size: 20px;
      font-weight: 800;
      margin-bottom: 6px;
    }
    .login-desc {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 24px;
    }
  </style>
</head>
<body>

  <!-- ADMIN LOGIN VIEW (shown when not logged in) -->
  <div id="loginView" style="display: none;">
    <div class="login-container">
      <div class="login-logo">MG</div>
      <h1 class="login-title">Windsor EV Admin</h1>
      <p class="login-desc">Enter your administrator master password to manage users and access codes.</p>
      <form id="adminLoginForm" onsubmit="handleAdminLogin(event)">
        <div class="form-group" style="text-align: left;">
          <label class="form-label">Master Password</label>
          <input type="password" id="adminPasswordInput" class="form-input" placeholder="Enter admin password" required autofocus>
        </div>
        <button type="submit" class="btn" style="width: 100%; justify-content: center; padding: 12px;">
          Unlock Admin Console 🔐
        </button>
      </form>
    </div>
  </div>

  <!-- AUTHENTICATED ADMIN CONSOLE VIEW -->
  <div id="adminView" style="display: none; flex-direction: column; min-height: 100vh;">
    <header>
      <div class="brand">
        <div class="brand-logo">MG</div>
        <div>
          <div class="brand-title">Windsor EV Admin Portal</div>
          <div class="brand-sub">Access Control & One-Time Passcode Engine</div>
        </div>
      </div>
      <div class="header-actions">
        <div class="badge-status">
          <span style="display:inline-block; width:7px; height:7px; background:#34D399; border-radius:99px;"></span>
          D1 Live
        </div>
        <button class="btn btn-secondary btn-sm" onclick="logoutAdmin()">🚪 Sign Out</button>
      </div>
    </header>

    <div class="nav-tabs">
      <div class="nav-tab active" onclick="switchTab('dashboard')">📊 Dashboard</div>
      <div class="nav-tab" onclick="switchTab('codes')">🔑 Access Codes</div>
      <div class="nav-tab" onclick="switchTab('users')">👥 Authorized Users</div>
      <div class="nav-tab" onclick="switchTab('logs')">📜 Audit Logs</div>
      <div class="nav-tab" onclick="switchTab('settings')">⚙️ Settings</div>
    </div>

    <main>
      <!-- TAB 1: DASHBOARD -->
      <section id="tab-dashboard">
        <div class="grid-stats">
          <div class="stat-card">
            <div class="stat-label">Authorized Users</div>
            <div class="stat-value" id="statUsers">--</div>
            <div class="stat-sub">Active friends & accounts</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Active Access Codes</div>
            <div class="stat-value" id="statActiveCodes" style="color: #34D399;">--</div>
            <div class="stat-sub">Ready to distribute</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Claimed Codes</div>
            <div class="stat-value" id="statRedeemedCodes" style="color: #60A5FA;">--</div>
            <div class="stat-sub">Activated by friends</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Registered Cars</div>
            <div class="stat-value" id="statCars" style="color: #FBBF24;">--</div>
            <div class="stat-sub">Distinct VINs</div>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">🚀 Fast Action: Share Access with a Friend</div>
              <p style="color: var(--text-muted); font-size: 12px; margin-top: 4px;">
                Generate a secure, single-use access code and send it to your friend via WhatsApp.
              </p>
            </div>
            <button class="btn" onclick="openGenerateModal()">+ Generate Access Code</button>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div class="card-title">🕒 Recent Access Events</div>
            <button class="btn btn-secondary btn-sm" onclick="loadDashboard()">Refresh</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Phone</th>
                  <th>Code</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody id="dashRecentLogs">
                <tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Loading logs...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- TAB 2: ACCESS CODES -->
      <section id="tab-codes" style="display: none;">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">🔑 One-Time Access Codes</div>
              <p style="color: var(--text-muted); font-size: 12px; margin-top: 4px;">
                Each code can only be activated once. Once claimed, it binds to that friend's device and mobile number.
              </p>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn" onclick="openGenerateModal()">+ New Code</button>
              <button class="btn btn-secondary" onclick="loadAccessCodes()">🔄 Refresh</button>
            </div>
          </div>

          <div style="margin-bottom: 16px; display: flex; gap: 10px; flex-wrap: wrap;">
            <input type="text" id="codeSearchInput" class="form-input" placeholder="Search by code, friend name or phone..." style="max-width: 320px;" oninput="filterCodesTable()">
            <select id="codeStatusFilter" class="form-input" style="max-width: 160px;" onchange="filterCodesTable()">
              <option value="all">All Statuses</option>
              <option value="active">Active (Unused)</option>
              <option value="used">Claimed (Used)</option>
              <option value="revoked">Revoked</option>
            </select>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Access Code</th>
                  <th>Designated For</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Redemption Info</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="codesTableBody">
                <tr><td colspan="6" style="text-align: center; color: var(--text-muted);">Loading codes...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- TAB 3: AUTHORIZED USERS -->
      <section id="tab-users" style="display: none;">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">👥 Authorized Friends & Users</div>
              <p style="color: var(--text-muted); font-size: 12px; margin-top: 4px;">
                Manage who has permission to log into your MG Windsor EV PWA. Block users at any time to instantly revoke access.
              </p>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn" onclick="openAddUserModal()">+ Add User Manually</button>
              <button class="btn btn-secondary" onclick="loadUsers()">🔄 Refresh</button>
            </div>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User / Friend</th>
                  <th>Mobile Number</th>
                  <th>Connected Vehicle</th>
                  <th>Access Code</th>
                  <th>Status</th>
                  <th>Last Active</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="usersTableBody">
                <tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Loading users...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- TAB 4: AUDIT LOGS -->
      <section id="tab-logs" style="display: none;">
        <div class="card">
          <div class="card-header">
            <div class="card-title">📜 Security Audit Trail</div>
            <button class="btn btn-secondary btn-sm" onclick="loadLogs()">🔄 Refresh</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Event</th>
                  <th>Phone</th>
                  <th>Code</th>
                  <th>Status</th>
                  <th>Reason / Details</th>
                  <th>IP Address</th>
                </tr>
              </thead>
              <tbody id="logsTableBody">
                <tr><td colspan="7" style="text-align: center; color: var(--text-muted);">Loading audit logs...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- TAB 5: SETTINGS -->
      <section id="tab-settings" style="display: none;">
        <div class="card" style="max-width: 520px;">
          <div class="card-title" style="margin-bottom: 16px;">🔐 Change Admin Master Password</div>
          <form onsubmit="handleChangePassword(event)">
            <div class="form-group">
              <label class="form-label">Current Password</label>
              <input type="password" id="oldPwdInput" class="form-input" required>
            </div>
            <div class="form-group">
              <label class="form-label">New Password (at least 6 characters)</label>
              <input type="password" id="newPwdInput" class="form-input" required minlength="6">
            </div>
            <div class="form-group">
              <label class="form-label">Confirm New Password</label>
              <input type="password" id="confirmPwdInput" class="form-input" required minlength="6">
            </div>
            <button type="submit" class="btn">Update Master Password</button>
          </form>
        </div>

        <div class="card" style="max-width: 520px;">
          <div class="card-title" style="margin-bottom: 12px;">📱 PWA Web App Shortcut</div>
          <p style="color: var(--text-muted); font-size: 13px; line-height: 1.5; margin-bottom: 16px;">
            Open your live MG Windsor EV Companion PWA in a new browser tab.
          </p>
          <a href="/" target="_blank" class="btn btn-secondary">Open PWA App ↗</a>
        </div>
      </section>
    </main>
  </div>

  <!-- MODAL: GENERATE ACCESS CODE -->
  <div class="modal-backdrop" id="genModal">
    <div class="modal">
      <div class="modal-title">🔑 Generate One-Time Access Code</div>
      <p class="modal-sub">Create an invite code for a friend. Once used, it cannot be reused by anyone else.</p>
      <form onsubmit="handleGenerateCode(event)">
        <div class="form-group">
          <label class="form-label">Friend's Name (Optional)</label>
          <input type="text" id="genNameInput" class="form-input" placeholder="e.g. Rahul / Arun">
        </div>
        <div class="form-group">
          <label class="form-label">Specific Mobile Number (Optional)</label>
          <input type="tel" id="genPhoneInput" class="form-input" placeholder="Leave empty for anyone, or enter 10 digits">
        </div>
        <div class="form-group">
          <label class="form-label">Expiry</label>
          <select id="genExpiryInput" class="form-input">
            <option value="0">Never Expires</option>
            <option value="7" selected>7 Days</option>
            <option value="30">30 Days</option>
            <option value="1">24 Hours</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Notes (Optional)</label>
          <input type="text" id="genNotesInput" class="form-input" placeholder="e.g. Windsor EV Starry Black friend">
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="closeModal('genModal')">Cancel</button>
          <button type="submit" class="btn">Generate Code ✨</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: ADD USER MANUALLY -->
  <div class="modal-backdrop" id="addUserModal">
    <div class="modal">
      <div class="modal-title">👥 Add Authorized User</div>
      <p class="modal-sub">Directly pre-authorize a mobile number without needing an access code.</p>
      <form onsubmit="handleAddUser(event)">
        <div class="form-group">
          <label class="form-label">Friend's Name *</label>
          <input type="text" id="addUserNameInput" class="form-input" placeholder="e.g. Rahul" required>
        </div>
        <div class="form-group">
          <label class="form-label">10-Digit Mobile Number *</label>
          <input type="tel" id="addUserPhoneInput" class="form-input" placeholder="e.g. 9876543210" required>
        </div>
        <div class="form-group">
          <label class="form-label">Notes (Optional)</label>
          <input type="text" id="addUserNotesInput" class="form-input" placeholder="e.g. Colleague">
        </div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick="closeModal('addUserModal')">Cancel</button>
          <button type="submit" class="btn">Authorize User ✓</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: CODE CREATED SUCCESS DIALOG -->
  <div class="modal-backdrop" id="codeSuccessModal">
    <div class="modal" style="text-align: center;">
      <div style="font-size: 40px; margin-bottom: 12px;">🎉</div>
      <div class="modal-title">Access Code Ready!</div>
      <p class="modal-sub">Send this code to your friend to allow them to activate the PWA.</p>
      
      <div style="background: #0B1120; border: 1px solid #334155; padding: 16px; border-radius: 12px; margin-bottom: 20px;">
        <div id="createdCodeDisplay" style="font-family: var(--font-mono); font-size: 24px; font-weight: 900; color: #34D399; letter-spacing: 2px;">WND-XXXX-YYYY</div>
        <div id="createdCodeSub" style="color: var(--text-muted); font-size: 11px; margin-top: 6px;">One-time activation for Rahul</div>
      </div>

      <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
        <button class="btn" onclick="copyCreatedCode()">📋 Copy Code</button>
        <button class="btn btn-secondary" onclick="shareWhatsAppInvite()">💬 Copy WhatsApp Invite</button>
      </div>

      <div style="margin-top: 24px;">
        <button class="btn btn-secondary btn-sm" onclick="closeModal('codeSuccessModal')">Done</button>
      </div>
    </div>
  </div>

  <!-- TOAST FEEDBACK -->
  <div class="toast" id="toast">Feedback message</div>

  <script>
    let adminToken = localStorage.getItem('mg_admin_token') || '';
    let currentCodesList = [];
    let lastCreatedCode = null;

    function showToast(msg) {
      const t = document.getElementById('toast');
      t.innerText = msg;
      t.style.display = 'block';
      setTimeout(() => { t.style.display = 'none'; }, 3000);
    }

    function checkAuth() {
      if (adminToken) {
        document.getElementById('loginView').style.display = 'none';
        document.getElementById('adminView').style.display = 'flex';
        loadDashboard();
      } else {
        document.getElementById('loginView').style.display = 'block';
        document.getElementById('adminView').style.display = 'none';
      }
    }

    async function handleAdminLogin(e) {
      e.preventDefault();
      const pwd = document.getElementById('adminPasswordInput').value;
      try {
        const res = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: pwd })
        });
        const data = await res.json();
        if (data.success && data.token) {
          adminToken = data.token;
          localStorage.setItem('mg_admin_token', adminToken);
          checkAuth();
          showToast('Welcome to Windsor EV Admin!');
        } else {
          alert(data.error || 'Login failed');
        }
      } catch (err) {
        alert('Connection error: ' + err.message);
      }
    }

    function logoutAdmin() {
      adminToken = '';
      localStorage.removeItem('mg_admin_token');
      checkAuth();
    }

    function switchTab(tabId) {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('main > section').forEach(s => s.style.display = 'none');
      event.currentTarget.classList.add('active');
      document.getElementById('tab-' + tabId).style.display = 'block';

      if (tabId === 'dashboard') loadDashboard();
      if (tabId === 'codes') loadAccessCodes();
      if (tabId === 'users') loadUsers();
      if (tabId === 'logs') loadLogs();
    }

    async function adminFetch(endpoint, options = {}) {
      const headers = options.headers || {};
      headers['Authorization'] = 'Bearer ' + adminToken;
      headers['Content-Type'] = 'application/json';
      const res = await fetch(endpoint, { ...options, headers });
      if (res.status === 401) {
        logoutAdmin();
        throw new Error('Session expired. Please log in again.');
      }
      return await res.json();
    }

    async function loadDashboard() {
      try {
        const data = await adminFetch('/api/admin/stats');
        if (data.success) {
          document.getElementById('statUsers').innerText = data.stats.totalUsers;
          document.getElementById('statActiveCodes').innerText = data.stats.activeCodes;
          document.getElementById('statRedeemedCodes').innerText = data.stats.redeemedCodes;
          document.getElementById('statCars').innerText = data.stats.registeredCars;
        }
        const logsData = await adminFetch('/api/admin/logs');
        if (logsData.success) {
          renderRecentLogs(logsData.logs.slice(0, 5));
        }
      } catch (_) {}
    }

    function renderRecentLogs(logs) {
      const tbody = document.getElementById('dashRecentLogs');
      if (!logs || logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No activity recorded yet.</td></tr>';
        return;
      }
      tbody.innerHTML = logs.map(l => \`
        <tr>
          <td style="color:var(--text-muted); font-size:11px;">\${formatDate(l.created_at)}</td>
          <td style="font-weight:700;">\${formatAction(l.action)}</td>
          <td>\${l.phone || '--'}</td>
          <td>\${l.code ? '<span class="code-badge">' + l.code + '</span>' : '--'}</td>
          <td><span class="status-badge status-\${l.status}">\${l.status.toUpperCase()}</span></td>
          <td style="font-size:12px; color:var(--text-muted);">\${l.reason || ''}</td>
        </tr>
      \`).join('');
    }

    async function loadAccessCodes() {
      try {
        const data = await adminFetch('/api/admin/codes');
        if (data.success) {
          currentCodesList = data.codes || [];
          renderCodesTable(currentCodesList);
        }
      } catch (err) {
        document.getElementById('codesTableBody').innerHTML = \`<tr><td colspan="6" style="color:var(--danger); text-align:center;">\${err.message}</td></tr>\`;
      }
    }

    function renderCodesTable(codes) {
      const tbody = document.getElementById('codesTableBody');
      if (!codes || codes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No access codes created yet. Click "+ New Code" to create one.</td></tr>';
        return;
      }
      tbody.innerHTML = codes.map(c => \`
        <tr>
          <td><span class="code-badge">\${c.code}</span></td>
          <td>
            <div style="font-weight:700;">\${c.assigned_name || 'Open Access'}</div>
            <div style="font-size:11px; color:var(--text-muted);">\${c.assigned_phone || (c.notes || 'Single-use code')}</div>
          </td>
          <td><span class="status-badge status-\${c.status}">\${c.status.toUpperCase()}</span></td>
          <td style="font-size:11px; color:var(--text-muted);">\${formatDate(c.created_at)}</td>
          <td style="font-size:12px;">
            \${c.status === 'used'
              ? '<span style="color:#60A5FA;">✓ Used by ' + (c.redeemed_by_phone || 'User') + (c.redeemed_at ? ' (' + formatDate(c.redeemed_at) + ')' : '') + '</span>'
              : c.expires_at ? 'Expires ' + new Date(c.expires_at * 1000).toLocaleDateString() : '<span style="color:#34D399;">Available</span>'}
          </td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-secondary btn-sm" onclick="copyCode('\${c.code}')">📋 Copy</button>
              \${c.status === 'active' ? \`
                <button class="btn btn-secondary btn-sm" onclick="copyWhatsAppInviteText('\${c.code}', '\${c.assigned_name || 'Friend'}')">💬 WhatsApp</button>
                <button class="btn btn-danger btn-sm" onclick="revokeCode('\${c.code}')">Revoke</button>
              \` : ''}
              <button class="btn btn-danger btn-sm" onclick="deleteCode('\${c.code}')">🗑️</button>
            </div>
          </td>
        </tr>
      \`).join('');
    }

    function filterCodesTable() {
      const q = document.getElementById('codeSearchInput').value.toLowerCase();
      const status = document.getElementById('codeStatusFilter').value;
      const filtered = currentCodesList.filter(c => {
        const matchesQ = !q || c.code.toLowerCase().includes(q) || (c.assigned_name && c.assigned_name.toLowerCase().includes(q)) || (c.assigned_phone && c.assigned_phone.includes(q));
        const matchesStatus = status === 'all' || c.status === status;
        return matchesQ && matchesStatus;
      });
      renderCodesTable(filtered);
    }

    function openGenerateModal() {
      document.getElementById('genModal').style.display = 'flex';
      document.getElementById('genNameInput').focus();
    }

    function closeModal(modalId) {
      document.getElementById(modalId).style.display = 'none';
    }

    async function handleGenerateCode(e) {
      e.preventDefault();
      const name = document.getElementById('genNameInput').value;
      const phone = document.getElementById('genPhoneInput').value;
      const expiresDays = document.getElementById('genExpiryInput').value;
      const notes = document.getElementById('genNotesInput').value;

      try {
        const data = await adminFetch('/api/admin/codes/generate', {
          method: 'POST',
          body: JSON.stringify({ name, phone, expiresDays, notes })
        });
        if (data.success && data.code) {
          closeModal('genModal');
          lastCreatedCode = data.code;
          document.getElementById('createdCodeDisplay').innerText = data.code.code;
          document.getElementById('createdCodeSub').innerText = name ? 'One-time activation for ' + name : 'Single-use invite code';
          document.getElementById('codeSuccessModal').style.display = 'flex';
          loadDashboard();
          loadAccessCodes();
          showToast('Access code created!');
        } else {
          alert(data.error || 'Failed to generate code');
        }
      } catch (err) {
        alert(err.message);
      }
    }

    function copyCode(code) {
      navigator.clipboard.writeText(code);
      showToast('Copied code ' + code + ' to clipboard!');
    }

    function copyCreatedCode() {
      if (lastCreatedCode) {
        copyCode(lastCreatedCode.code);
      }
    }

    function copyWhatsAppInviteText(code, name) {
      const pwaUrl = window.location.origin;
      const msg = "🚗 *MG Windsor EV Telematics Access*\\n\\n" +
        "Hey " + (name || "there") + "! Here is your private one-time access code for the MG Windsor EV PWA companion app:\\n\\n" +
        "🔑 *" + code + "*\\n\\n" +
        "📱 *How to activate:*\\n" +
        "1. Open " + pwaUrl + "\\n" +
        "2. Enter your 10-digit MG iSMART phone number and password\\n" +
        "3. Paste this one-time access code when prompted\\n\\n" +
        "_Note: This access code is private and valid for one-time activation on your phone._";
      navigator.clipboard.writeText(msg);
      showToast('Copied WhatsApp invitation message to clipboard!');
    }

    function shareWhatsAppInvite() {
      if (lastCreatedCode) {
        copyWhatsAppInviteText(lastCreatedCode.code, lastCreatedCode.assigned_name || 'Friend');
      }
    }

    async function revokeCode(code) {
      if (!confirm('Are you sure you want to revoke code ' + code + '? It will no longer be usable.')) return;
      try {
        const data = await adminFetch('/api/admin/codes/revoke', {
          method: 'POST',
          body: JSON.stringify({ code })
        });
        if (data.success) {
          showToast('Code ' + code + ' revoked');
          loadAccessCodes();
        }
      } catch (err) {
        alert(err.message);
      }
    }

    async function deleteCode(code) {
      if (!confirm('Permanently delete code ' + code + '?')) return;
      try {
        const data = await adminFetch('/api/admin/codes/delete', {
          method: 'POST',
          body: JSON.stringify({ code })
        });
        if (data.success) {
          showToast('Code ' + code + ' deleted');
          loadAccessCodes();
        }
      } catch (err) {
        alert(err.message);
      }
    }

    async function loadUsers() {
      try {
        const data = await adminFetch('/api/admin/users');
        if (data.success) {
          renderUsersTable(data.users || []);
        }
      } catch (err) {
        document.getElementById('usersTableBody').innerHTML = \`<tr><td colspan="7" style="color:var(--danger); text-align:center;">\${err.message}</td></tr>\`;
      }
    }

    function renderUsersTable(users) {
      const tbody = document.getElementById('usersTableBody');
      if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No authorized users yet. Users will appear here automatically when they claim access codes.</td></tr>';
        return;
      }
      tbody.innerHTML = users.map(u => \`
        <tr>
          <td style="font-weight:700;">\${u.name || 'Friend'}</td>
          <td style="font-family:var(--font-mono);">\${u.phone}</td>
          <td>\${u.vin ? '<span style="font-size:11px; color:#38BDF8;">' + u.vin + '</span>' : '--'}</td>
          <td><span class="code-badge" style="font-size:11px;">\${u.access_code || '--'}</span></td>
          <td><span class="status-badge status-\${u.status}">\${u.status.toUpperCase()}</span></td>
          <td style="font-size:11px; color:var(--text-muted);">\${u.last_login_at ? formatDate(u.last_login_at) : '--'}</td>
          <td>
            <div style="display:flex; gap:6px;">
              \${u.status === 'active' ? \`
                <button class="btn btn-danger btn-sm" onclick="toggleUserBlock('\${u.phone}', true)">⛔ Block</button>
              \` : \`
                <button class="btn btn-sm" style="background:#064E3B; color:#34D399;" onclick="toggleUserBlock('\${u.phone}', false)">✓ Unblock</button>
              \`}
              <button class="btn btn-danger btn-sm" onclick="deleteUser('\${u.phone}')">🗑️</button>
            </div>
          </td>
        </tr>
      \`).join('');
    }

    function openAddUserModal() {
      document.getElementById('addUserModal').style.display = 'flex';
      document.getElementById('addUserNameInput').focus();
    }

    async function handleAddUser(e) {
      e.preventDefault();
      const name = document.getElementById('addUserNameInput').value;
      const phone = document.getElementById('addUserPhoneInput').value;
      const notes = document.getElementById('addUserNotesInput').value;

      try {
        const data = await adminFetch('/api/admin/users/add', {
          method: 'POST',
          body: JSON.stringify({ name, phone, notes })
        });
        if (data.success) {
          closeModal('addUserModal');
          loadUsers();
          showToast('User ' + (name || phone) + ' authorized!');
        } else {
          alert(data.error || 'Failed to add user');
        }
      } catch (err) {
        alert(err.message);
      }
    }

    async function toggleUserBlock(phone, blocked) {
      const actionStr = blocked ? 'BLOCK access for' : 'UNBLOCK access for';
      if (!confirm('Are you sure you want to ' + actionStr + ' ' + phone + '?')) return;
      try {
        const data = await adminFetch('/api/admin/users/toggle-block', {
          method: 'POST',
          body: JSON.stringify({ phone, blocked })
        });
        if (data.success) {
          showToast(blocked ? 'User blocked' : 'User unblocked');
          loadUsers();
        }
      } catch (err) {
        alert(err.message);
      }
    }

    async function deleteUser(phone) {
      if (!confirm('Remove user ' + phone + '? They will lose access immediately.')) return;
      try {
        const data = await adminFetch('/api/admin/users/delete', {
          method: 'POST',
          body: JSON.stringify({ phone })
        });
        if (data.success) {
          showToast('User removed');
          loadUsers();
        }
      } catch (err) {
        alert(err.message);
      }
    }

    async function loadLogs() {
      try {
        const data = await adminFetch('/api/admin/logs');
        if (data.success) {
          renderLogsTable(data.logs || []);
        }
      } catch (err) {
        document.getElementById('logsTableBody').innerHTML = \`<tr><td colspan="7" style="color:var(--danger); text-align:center;">\${err.message}</td></tr>\`;
      }
    }

    function renderLogsTable(logs) {
      const tbody = document.getElementById('logsTableBody');
      if (!logs || logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No audit logs yet.</td></tr>';
        return;
      }
      tbody.innerHTML = logs.map(l => \`
        <tr>
          <td style="color:var(--text-muted); font-size:11px;">\${formatDate(l.created_at)}</td>
          <td style="font-weight:700;">\${formatAction(l.action)}</td>
          <td>\${l.phone || '--'}</td>
          <td>\${l.code ? '<span class="code-badge">' + l.code + '</span>' : '--'}</td>
          <td><span class="status-badge status-\${l.status}">\${l.status.toUpperCase()}</span></td>
          <td style="font-size:12px; color:var(--text-muted);">\${l.reason || ''}</td>
          <td style="font-size:11px; font-family:var(--font-mono); color:var(--text-muted);">\${l.ip || '--'}</td>
        </tr>
      \`).join('');
    }

    async function handleChangePassword(e) {
      e.preventDefault();
      const oldPassword = document.getElementById('oldPwdInput').value;
      const newPassword = document.getElementById('newPwdInput').value;
      const confirmPassword = document.getElementById('confirmPwdInput').value;

      if (newPassword !== confirmPassword) {
        alert('New passwords do not match');
        return;
      }

      try {
        const data = await adminFetch('/api/admin/change-password', {
          method: 'POST',
          body: JSON.stringify({ oldPassword, newPassword })
        });
        if (data.success) {
          showToast('Master password updated successfully!');
          document.getElementById('oldPwdInput').value = '';
          document.getElementById('newPwdInput').value = '';
          document.getElementById('confirmPwdInput').value = '';
        } else {
          alert(data.error || 'Failed to update password');
        }
      } catch (err) {
        alert(err.message);
      }
    }

    function formatDate(isoStr) {
      if (!isoStr) return '--';
      try {
        const d = new Date(isoStr);
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch {
        return isoStr;
      }
    }

    function formatAction(a) {
      const map = {
        code_generated: '✨ Code Generated',
        code_redeemed: '🔑 Code Redeemed',
        code_revoked: '🚫 Code Revoked',
        login_success: '✓ Login Success',
        login_blocked: '⛔ Login Blocked',
        user_added: '👤 User Added',
        user_blocked: '⛔ User Blocked',
        user_unblocked: '✓ User Unblocked',
        admin_login_success: '🔐 Admin Sign-In',
        admin_login_failed: '⚠️ Admin Sign-In Failed'
      };
      return map[a] || a;
    }

    // Initialize View
    checkAuth();
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
