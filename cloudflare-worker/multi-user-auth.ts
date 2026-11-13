/**
 * Multi-User Authentication, Opaque Webhook Keys & Strict VIN Isolation Helpers
 *
 * Security model (Option A):
 *   1. `api_token:<tok>` (stored only on user device + `kv_store`, sent in
 *      `Authorization: Bearer <tok>`) grants access ONLY to the caller's own VIN
 *      across D1 history, push subscription management, and webhook key rotation.
 *   2. `webhook_key:<key>` (placed in Siri/Shortcuts & CarPlay links as `?key=...`)
 *      grants access ONLY to CarPlay trip start/stop and remote vehicle commands
 *      (`/api/command/*` with caller-supplied `&pin=<4digit>` — PIN is never saved
 *      to D1 under Option A). It CANNOT read, modify, or wipe trip/charging history.
 *   3. Neither token nor link ever contains a user's MG phone number, MG password,
 *      VIN, or 4-digit Control PIN in persistent server storage.
 */

export interface AuthKvStore {
  get(key: string): Promise<any | null>;
  put(key: string, value: any): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface AuthDbAdapter {
  getUserStatus(phone: string): Promise<string | null>;
}

export interface ApiTokenRecord {
  vin: string;
  phone: string;
  uid?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WebhookKeyRecord {
  vin: string;
  phone: string;
  createdAt: number;
  updatedAt?: number;
}

export type AppAuthResult =
  | { ok: true; vin: string; phone: string; uid?: string; token: string }
  | { ok: false; status: 400 | 401 | 403; error: string };

export type WebhookAuthResult =
  | { ok: true; vin: string; phone: string; key: string }
  | { ok: false; status: 401 | 403; error: string };

export type RegistrationVerifyResult =
  | { ok: true; vin: string; phone: string; candidateToken: string }
  | { ok: false; status: 400 | 403; error: string };

const MAX_API_TOKENS_PER_VIN = 12;

export function normVinValue(raw?: string | null): string {
  return String(raw || '').trim().toUpperCase();
}

export function normPhoneValue(raw?: string | null): string {
  return String(raw || '').replace(/\D/g, '');
}

/** Rejects empty/blank VINs so D1 queries never fall back to scanning all users. */
export function requireScopedVin(vin?: string | null): string | null {
  const clean = normVinValue(vin);
  return clean.length > 0 ? clean : null;
}

/** Generates a URL-safe random opaque secret prefixed for easy type distinction. */
export function generateOpaqueSecret(prefix: string, byteLength = 18): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}

export function createD1AuthDbAdapter(db: any): AuthDbAdapter | null {
  if (!db) return null;
  return {
    async getUserStatus(phone: string): Promise<string | null> {
      const clean = normPhoneValue(phone);
      if (!clean) return null;
      const row: any = await db
        .prepare('SELECT status FROM authorized_users WHERE phone = ?')
        .bind(clean)
        .first();
      if (!row) return null;
      return String(row.status || 'active').toLowerCase();
    },
  };
}

/** Shared KV adapter backed by Cloudflare D1 `kv_store` and optional `TRIP_KV` namespace. */
export function createEnvAuthKvStore(
  env: { DB?: any; TRIP_KV?: { get(k: string, t?: 'text' | 'json'): Promise<any>; put(k: string, v: string): Promise<void>; delete(k: string): Promise<void> } },
  onBeforeWrite?: (db: any) => Promise<void>
): AuthKvStore {
  return {
    async get(key: string): Promise<any | null> {
      if (env.DB) {
        try {
          const row: any = await env.DB.prepare('SELECT value FROM kv_store WHERE key = ?').bind(key).first();
          if (row?.value != null) {
            try { return JSON.parse(row.value); } catch (_) { return row.value; }
          }
        } catch (_) {}
      }
      if (env.TRIP_KV) {
        try {
          return await env.TRIP_KV.get(key, 'json');
        } catch (_) {}
      }
      return null;
    },
    async put(key: string, value: any): Promise<void> {
      const str = typeof value === 'string' ? value : JSON.stringify(value);
      if (env.DB) {
        if (onBeforeWrite) await onBeforeWrite(env.DB);
        try {
          await env.DB.prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)').bind(key, str).run();
        } catch (_) {}
      }
      if (env.TRIP_KV) {
        try {
          await env.TRIP_KV.put(key, str);
        } catch (_) {}
      }
    },
    async delete(key: string): Promise<void> {
      if (env.DB) {
        try {
          await env.DB.prepare('DELETE FROM kv_store WHERE key = ?').bind(key).run();
        } catch (_) {}
      }
      if (env.TRIP_KV) {
        try {
          await env.TRIP_KV.delete(key);
        } catch (_) {}
      }
    },
  };
}

/**
 * Extracts the app's D1 bearer token from headers or JSON body (never URL query strings,
 * keeping long-lived D1 credentials out of browser history and server access logs).
 */
export function extractBearerOrHeaderToken(request: Request, body?: any): string {
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  if (/^Bearer\s+/i.test(authHeader)) {
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (bearer) return bearer;
  }
  const headerTok = (request.headers.get('x-d1-token') || '').trim();
  if (headerTok) return headerTok;
  const bodyTok = body?.apiToken || body?.d1Token;
  return typeof bodyTok === 'string' ? bodyTok.trim() : '';
}

export function extractWebhookKey(request: Request, url: URL, body?: any): string {
  const qKey = (url.searchParams.get('key') || '').trim();
  if (qKey) return qKey;
  const hKey = (request.headers.get('x-webhook-key') || '').trim();
  if (hKey) return hKey;
  const bKey = body?.key;
  return typeof bKey === 'string' ? bKey.trim() : '';
}

/**
 * Verifies whether a phone belongs to an active user (Master Admin or active invite row).
 * When an authorized_users row is blocked or deleted by the admin, returns false immediately.
 */
export async function isUserAuthorized(
  db: AuthDbAdapter | null,
  phone: string,
  isMasterAdminFn: (phone: string) => boolean
): Promise<boolean> {
  const cleanPhone = normPhoneValue(phone);
  if (!cleanPhone) return false;
  if (isMasterAdminFn(cleanPhone)) return true;
  if (!db) return true;
  const status = await db.getUserStatus(cleanPhone);
  return status === 'active';
}

/** Indexes a licenseToken minted by `/api/auth/consume-code` into `api_token:<tok>`. */
export async function registerLicenseToken(
  store: AuthKvStore,
  params: { token: string; phone: string; vin?: string | null }
): Promise<void> {
  const tok = String(params.token || '').trim();
  const cleanPhone = normPhoneValue(params.phone);
  const cleanVin = normVinValue(params.vin);
  if (!tok || !cleanPhone) return;

  const nowSec = Math.floor(Date.now() / 1000);
  const record: ApiTokenRecord = {
    vin: cleanVin,
    phone: cleanPhone,
    createdAt: nowSec,
    updatedAt: nowSec,
  };
  await store.put(`api_token:${tok}`, record);
  if (cleanVin) {
    await appendVinTokenIndex(store, cleanVin, tok);
  }
}

async function appendVinTokenIndex(store: AuthKvStore, vin: string, token: string): Promise<void> {
  const cleanVin = normVinValue(vin);
  if (!cleanVin || !token) return;
  const indexKey = `api_tokens_vin:${cleanVin}`;
  const rawList = await store.get(indexKey);
  const existing: string[] = Array.isArray(rawList) ? rawList.filter((t) => typeof t === 'string') : [];
  const next = existing.filter((t) => t !== token);
  next.push(token);
  const trimmed = next.slice(-MAX_API_TOKENS_PER_VIN);
  await store.put(indexKey, trimmed);
}

/**
 * Returns the VIN's existing opaque webhook key, or mints a fresh `wk_...` key.
 * Pass `forceRotate = true` to revoke the old key and generate a new one.
 */
export async function ensureWebhookKey(
  store: AuthKvStore,
  vin: string,
  phone: string,
  forceRotate = false
): Promise<string> {
  const cleanVin = normVinValue(vin);
  const cleanPhone = normPhoneValue(phone);
  if (!cleanVin) throw new Error('VIN is required to issue a webhook key');

  const vinPtrKey = `webhook_key_vin:${cleanVin}`;
  const existingKeyRaw = await store.get(vinPtrKey);
  const existingKey = typeof existingKeyRaw === 'string' ? existingKeyRaw.trim() : '';

  if (!forceRotate && existingKey.startsWith('wk_')) {
    const rec = (await store.get(`webhook_key:${existingKey}`)) as WebhookKeyRecord | null;
    if (rec && normVinValue(rec.vin) === cleanVin) {
      if (cleanPhone && normPhoneValue(rec.phone) !== cleanPhone) {
        await store.put(`webhook_key:${existingKey}`, {
          ...rec,
          phone: cleanPhone,
          updatedAt: Math.floor(Date.now() / 1000),
        });
      }
      return existingKey;
    }
  }

  if (existingKey) {
    await store.delete(`webhook_key:${existingKey}`);
  }

  const newKey = generateOpaqueSecret('wk', 18);
  const nowSec = Math.floor(Date.now() / 1000);
  const rec: WebhookKeyRecord = {
    vin: cleanVin,
    phone: cleanPhone,
    createdAt: nowSec,
    updatedAt: nowSec,
  };
  await store.put(`webhook_key:${newKey}`, rec);
  await store.put(vinPtrKey, newKey);
  return newKey;
}

/**
 * Adopts an already-valid token (`lic_...` / `d1t_...`) owned by the same user, or mints
 * a new opaque `d1t_...` token scoped strictly to `(vin, phone)`.
 */
export async function issueOrAdoptApiToken(
  store: AuthKvStore,
  params: { vin: string; phone: string; uid?: string; candidateToken?: string | null }
): Promise<string> {
  const cleanVin = normVinValue(params.vin);
  const cleanPhone = normPhoneValue(params.phone);
  const uid = String(params.uid || '').trim();
  const candidate = String(params.candidateToken || '').trim();
  if (!cleanVin || !cleanPhone) throw new Error('VIN and phone are required to issue API token');

  const nowSec = Math.floor(Date.now() / 1000);

  if (candidate) {
    const existing = (await store.get(`api_token:${candidate}`)) as ApiTokenRecord | null;
    if (existing) {
      const exPhone = normPhoneValue(existing.phone);
      const exVin = normVinValue(existing.vin);
      const sameOwner = (!exPhone || exPhone === cleanPhone) && (!exVin || exVin === cleanVin);
      if (sameOwner) {
        await store.put(`api_token:${candidate}`, {
          vin: cleanVin,
          phone: cleanPhone,
          uid: uid || existing.uid || '',
          createdAt: existing.createdAt || nowSec,
          updatedAt: nowSec,
        });
        await appendVinTokenIndex(store, cleanVin, candidate);
        return candidate;
      }
    } else if (candidate.startsWith(`lic_${cleanPhone}_`)) {
      // Seamless upgrade path for devices signed in prior to api_token KV persistence.
      await store.put(`api_token:${candidate}`, {
        vin: cleanVin,
        phone: cleanPhone,
        uid,
        createdAt: nowSec,
        updatedAt: nowSec,
      });
      await appendVinTokenIndex(store, cleanVin, candidate);
      return candidate;
    }
  }

  const fresh = generateOpaqueSecret('d1t', 20);
  await store.put(`api_token:${fresh}`, {
    vin: cleanVin,
    phone: cleanPhone,
    uid,
    createdAt: nowSec,
    updatedAt: nowSec,
  });
  await appendVinTokenIndex(store, cleanVin, fresh);
  return fresh;
}

/** Revokes every API token and webhook key issued for a given VIN (used on wipe/deregister). */
export async function revokeTokensForVin(store: AuthKvStore, vin: string): Promise<void> {
  const cleanVin = normVinValue(vin);
  if (!cleanVin) return;

  const indexKey = `api_tokens_vin:${cleanVin}`;
  const tokensRaw = await store.get(indexKey);
  if (Array.isArray(tokensRaw)) {
    for (const tok of tokensRaw) {
      if (typeof tok === 'string' && tok) {
        await store.delete(`api_token:${tok}`);
      }
    }
  }
  await store.delete(indexKey);

  const vinPtrKey = `webhook_key_vin:${cleanVin}`;
  const wk = await store.get(vinPtrKey);
  if (typeof wk === 'string' && wk) {
    await store.delete(`webhook_key:${wk}`);
  }
  await store.delete(vinPtrKey);
}

/**
 * Authenticates PWA / mobile app D1 & push API calls via `Authorization: Bearer <token>`.
 * Guarantees callers can only access their own active VIN and blocks spoofed `?vin=` params.
 */
export async function resolveAppAuth(
  store: AuthKvStore,
  db: AuthDbAdapter | null,
  isMasterAdminFn: (phone: string) => boolean,
  request: Request,
  url: URL,
  body?: any
): Promise<AppAuthResult> {
  const token = extractBearerOrHeaderToken(request, body);
  if (!token) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }

  const rec = (await store.get(`api_token:${token}`)) as ApiTokenRecord | null;
  if (!rec) {
    return { ok: false, status: 401, error: 'Invalid or expired session token' };
  }

  const tokenVin = normVinValue(rec.vin);
  const tokenPhone = normPhoneValue(rec.phone);
  if (!tokenVin || !tokenPhone) {
    return { ok: false, status: 401, error: 'Session token is missing vehicle binding' };
  }

  const authorized = await isUserAuthorized(db, tokenPhone, isMasterAdminFn);
  if (!authorized) {
    return { ok: false, status: 403, error: 'Account access has been revoked or removed' };
  }

  const requestedVin = normVinValue(url.searchParams.get('vin') || body?.vin);
  if (requestedVin && requestedVin !== tokenVin) {
    return { ok: false, status: 403, error: 'VIN does not match authenticated account' };
  }

  return {
    ok: true,
    vin: tokenVin,
    phone: tokenPhone,
    uid: rec.uid,
    token,
  };
}

/**
 * Authenticates Siri Shortcuts & CarPlay webhook triggers via opaque `?key=wk_...`.
 * Strictly separated from `api_token:` so leaked shortcut links cannot read/wipe D1 data.
 */
export async function resolveWebhookAuth(
  store: AuthKvStore,
  db: AuthDbAdapter | null,
  isMasterAdminFn: (phone: string) => boolean,
  request: Request,
  url: URL,
  body?: any
): Promise<WebhookAuthResult> {
  const key = extractWebhookKey(request, url, body);
  if (!key) {
    return { ok: false, status: 401, error: 'Missing private webhook key (?key=...)' };
  }

  const rec = (await store.get(`webhook_key:${key}`)) as WebhookKeyRecord | null;
  if (!rec || !normVinValue(rec.vin)) {
    return { ok: false, status: 401, error: 'Invalid or revoked webhook key' };
  }

  const recVin = normVinValue(rec.vin);
  const recPhone = normPhoneValue(rec.phone);

  if (recPhone) {
    const authorized = await isUserAuthorized(db, recPhone, isMasterAdminFn);
    if (!authorized) {
      return { ok: false, status: 403, error: 'Access revoked for this vehicle' };
    }
  }

  const requestedVin = normVinValue(url.searchParams.get('vin') || body?.vin);
  if (requestedVin && requestedVin !== recVin) {
    return { ok: false, status: 403, error: 'Webhook key does not match requested VIN' };
  }

  return {
    ok: true,
    vin: recVin,
    phone: recPhone,
    key,
  };
}

/**
 * Verifies caller identity before `/api/register-car` persists MG session tokens and mints
 * per-VIN credentials, preventing cross-user VIN hijacking.
 */
export async function verifyCarRegistrationCaller(
  store: AuthKvStore,
  db: AuthDbAdapter | null,
  isMasterAdminFn: (phone: string) => boolean,
  request: Request,
  body: any
): Promise<RegistrationVerifyResult> {
  const uid = String(body?.uid || '').trim();
  const mgToken = String(body?.token || '').trim();
  const cleanVin = normVinValue(body?.vin);
  const cleanPhone = normPhoneValue(body?.phone);

  if (!uid || !mgToken || !cleanVin || !cleanPhone) {
    return { ok: false, status: 400, error: 'uid, token, vin, and phone are required' };
  }

  const authorized = await isUserAuthorized(db, cleanPhone, isMasterAdminFn);
  if (!authorized) {
    return { ok: false, status: 403, error: 'Account is not authorized or access has been revoked' };
  }

  const candidateToken =
    extractBearerOrHeaderToken(request, body) ||
    (typeof body?.licenseToken === 'string' ? body.licenseToken.trim() : '');

  const existingTokenRec = candidateToken
    ? ((await store.get(`api_token:${candidateToken}`)) as ApiTokenRecord | null)
    : null;

  if (existingTokenRec) {
    const tokPhone = normPhoneValue(existingTokenRec.phone);
    const tokVin = normVinValue(existingTokenRec.vin);
    if ((tokPhone && tokPhone !== cleanPhone) || (tokVin && tokVin !== cleanVin)) {
      return { ok: false, status: 403, error: 'Session token belongs to another user or vehicle' };
    }
  }

  const existingSession = await store.get(`mg_session:${cleanVin}`);
  if (existingSession) {
    const sessPhone = normPhoneValue(existingSession.phone);
    const sessUid = String(existingSession.uid || '').trim();
    if (sessPhone && sessPhone !== cleanPhone) {
      return { ok: false, status: 403, error: 'Vehicle VIN is already registered to another account' };
    }
    if (!existingTokenRec && sessUid && sessUid !== uid) {
      return { ok: false, status: 403, error: 'Vehicle session UID mismatch' };
    }
  }

  return {
    ok: true,
    vin: cleanVin,
    phone: cleanPhone,
    candidateToken,
  };
}
