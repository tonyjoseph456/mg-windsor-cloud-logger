/**
 * MG Windsor EV - Multi-User Background Backend (Cloudflare Workers FREE plan friendly)
 *
 * - Users sign in with Google (OAuth code flow, offline). We store ONLY tokens:
 *     * Google refresh token (to append rows to the user's own Google Sheets)
 *     * MG session token + uid + VIN (NO MG password, NO PIN)
 * - A Cron Trigger (every minute) polls each user's car, detects trips + charging sessions
 *   and appends finished ones straight into that user's Google Sheets.
 * - If the MG session token dies, the user is flagged "mgStatus: expired" and must
 *   reconnect from the app. Nothing else is lost.
 *
 * Required bindings (Cloudflare dashboard):
 *   KV namespace  : TRIP_KV
 *   Variable      : GOOGLE_CLIENT_ID
 *   Secret        : GOOGLE_CLIENT_SECRET
 *   Cron trigger  : * * * * *
 */
import { MgIndiaClient } from '../src/sdk/client';
import { hashControlPin } from '../src/sdk/crypto';
import legacy from './silent-webhook';
import mgProxy from './worker';

interface Env {
  DB?: any;
  TRIP_KV?: {
    get(key: string, type?: 'text' | 'json'): Promise<any>;
    put(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  WEB_APP_ORIGINS?: string;
  MG_PHONE?: string;
  MG_PASSWORD?: string;
  MG_PIN?: string;
  MG_VIN?: string;
  WEBHOOK_TOKEN?: string;
  [k: string]: any;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': 'APP-SEND-DATE, ORIGINAL-CONTENT-TYPE, app-send-date, original-content-type, x-mg-send-date',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });

const MAX_USERS_PER_RUN = 6;
const SUBREQUEST_BUDGET = 40; // free plan: 50 per invocation
const POLL_EVERY_MIN = 2;

const TRIP_HEADERS = [
  'Trip ID', 'Date (IST)', 'Start Time', 'End Time', 'Duration', 'Distance (km)', 'Start Odo (km)',
  'End Odo (km)', 'Start Battery %', 'End Battery %', 'Energy Used (kWh)', 'Efficiency (km/kWh)',
  'Start Location', 'Destination', 'Idling Duration', 'Idling Energy (kWh)', 'Cabin Temp (°C)',
  'Ambient Temp (°C)', 'Max Speed (km/h)', 'Average Speed (km/h)', 'Data (do not edit)',
];
const CHARGE_HEADERS = [
  'Session ID', 'Date (IST)', 'Start Time', 'End Time', 'Duration', 'Start Battery %', 'End Battery %',
  'Energy Added (kWh)', 'Wall Energy (kWh)', 'Loss (%)', 'Charger Speed Category',
  'Peak Speed (kW)', 'Completion Status', 'Odometer (km)',
  'Driving Before This Charge (km)', 'Energy Used Before This Charge (kWh)',
  'Driving Efficiency Before This Charge (km/kWh)', 'Data (do not edit)',
];

// ---------------------------------------------------------------- helpers
function kvOrThrow(env: Env) {
  if (env.TRIP_KV) return env.TRIP_KV;
  return {
    get: async (key: string, type?: string) => {
      const val = await d1KvGet(env, key);
      if (val === null) return null;
      return type === 'json' ? val : (typeof val === 'string' ? val : JSON.stringify(val));
    },
    put: async (key: string, value: any) => {
      await d1KvPut(env, key, value);
    },
    delete: async (key: string) => {
      if (env.DB) {
        try { await env.DB.prepare('DELETE FROM kv_store WHERE key = ?').bind(key).run(); } catch (_) {}
      }
    },
  };
}
async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function randomHex(bytes = 24): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function hashSlot(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}
async function loadUser(env: Env, id: string): Promise<any | null> {
  const raw = await kvOrThrow(env).get(`u:${id}`, 'text');
  return raw ? JSON.parse(raw) : null;
}
async function saveUser(env: Env, u: any): Promise<void> {
  await kvOrThrow(env).put(`u:${u.id}`, JSON.stringify(u));
}
async function authUser(env: Env, url: URL, body?: any): Promise<any | null> {
  const id = (url.searchParams.get('userId') || url.searchParams.get('id') || body?.userId || '').trim();
  const key = (url.searchParams.get('userKey') || url.searchParams.get('key') || body?.userKey || '').trim();
  if (!id || !key) return null;
  const u = await loadUser(env, id);
  if (!u) return null;
  const h = await sha256(key);
  if (u.keyHash === h) return u;
  if (Array.isArray(u.keyHashes) && u.keyHashes.includes(h)) return u;
  if (u.userKey === key || u.key === key) return u;
  if (!u.keyHash && (!u.keyHashes || !u.keyHashes.length)) {
    // Auto-bind legacy record missing keyHash
    u.keyHash = h;
    u.keyHashes = [h];
    await saveUser(env, u);
    return u;
  }
  return null;
}
function istParts(sec: number): { date: string; time: string; full: string } {
  const full = new Date(sec * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const [date, time] = full.split(', ');
  return { date: date || full, time: time || '', full };
}
const fmtDur = (s: number) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

// ---------------------------------------------------------------- Web Push & VAPID (RFC 8291 / RFC 8292)
const VAPID_PUB_B64URL = 'BEDIJNL78q2CN6h-Mbf3xfqUKUM5HNR0tjZw4aikdcnztJaOJaP4Xz6ismoVROcaJW760XDrGDUE4byQayacUWE';
const VAPID_JWK_X = 'QMgk0vvyrYI3qH4xt_fF-pQpQzkc1HS2NnDhqKR1yfM';
const VAPID_JWK_Y = 'tJaOJaP4Xz6ismoVROcaJW760XDrGDUE4byQayacUWE';
const VAPID_JWK_D = 'P-IKz-Y1iVBinAM9oqTAuCpDG_7xrV8s1ABy0GjVRnw';
const VAPID_SUBJECT = 'mailto:tonyjoseph456@gmail.com';

function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(b64url: string): Uint8Array {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function createVapidJwt(audience: string): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    exp: now + 86400,
    sub: VAPID_SUBJECT,
  };

  const headerB64 = bytesToB64url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = bytesToB64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const privKey = await crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC',
      crv: 'P-256',
      x: VAPID_JWK_X,
      y: VAPID_JWK_Y,
      d: VAPID_JWK_D,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privKey,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${bytesToB64url(new Uint8Array(sig))}`;
}

async function encryptWebPushPayload(
  clientP256dhB64url: string,
  clientAuthB64url: string,
  payloadStr: string
): Promise<Uint8Array> {
  const clientPubRaw = b64urlToBytes(clientP256dhB64url);
  const clientAuth = b64urlToBytes(clientAuthB64url);
  const payloadBytes = new TextEncoder().encode(payloadStr);

  const serverEcdh = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverEcdh.publicKey));

  const importedClientPub = await crypto.subtle.importKey(
    'raw',
    clientPubRaw,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const ecdhSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: importedClientPub },
    serverEcdh.privateKey,
    256
  );

  const te = new TextEncoder();
  const infoPrefix = te.encode('WebPush: info\0');
  const authInfo = new Uint8Array(infoPrefix.length + clientPubRaw.length + serverPubRaw.length);
  authInfo.set(infoPrefix, 0);
  authInfo.set(clientPubRaw, infoPrefix.length);
  authInfo.set(serverPubRaw, infoPrefix.length + clientPubRaw.length);

  const ikmBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: clientAuth, info: authInfo },
    await crypto.subtle.importKey('raw', ecdhSecret, 'HKDF', false, ['deriveBits']),
    256
  );

  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const cekInfo = te.encode('Content-Encoding: aes128gcm\0');
  const ikmKey = await crypto.subtle.importKey('raw', ikmBits, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const cek = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: cekInfo },
    ikmKey,
    { name: 'AES-GCM', length: 128 },
    false,
    ['encrypt']
  );

  const nonceInfo = te.encode('Content-Encoding: nonce\0');
  const nonceBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfo },
    ikmKey,
    96
  );
  const nonce = new Uint8Array(nonceBits);

  const recordPlaintext = new Uint8Array(payloadBytes.length + 1);
  recordPlaintext.set(payloadBytes, 0);
  recordPlaintext[payloadBytes.length] = 2;

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    cek,
    recordPlaintext
  );

  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = 65;
  header.set(serverPubRaw, 21);

  const body = new Uint8Array(header.length + ciphertext.byteLength);
  body.set(header, 0);
  body.set(new Uint8Array(ciphertext), header.length);

  return body;
}

interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  data?: any;
}

interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
  addedSec?: number;
}

async function sendPushToSubscription(
  sub: PushSubscription,
  payload: PushPayload
): Promise<{ ok: boolean; status: number; expired?: boolean }> {
  try {
    const pushUrl = new URL(sub.endpoint);
    const audience = `${pushUrl.protocol}//${pushUrl.host}`;
    const jwt = await createVapidJwt(audience);
    const body = await encryptWebPushPayload(sub.keys.p256dh, sub.keys.auth, JSON.stringify(payload));

    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        TTL: '86400',
        Urgency: 'high',
        Authorization: `vapid t=${jwt}, k=${VAPID_PUB_B64URL}`,
        'Crypto-Key': `p256ecdsa=${VAPID_PUB_B64URL}`,
      },
      body,
    });

    const isExpired = res.status === 404 || res.status === 410;
    return { ok: res.ok, status: res.status, expired: isExpired };
  } catch (_) {
    return { ok: false, status: 0 };
  }
}

async function notifyUser(env: Env, u: any, payload: PushPayload): Promise<void> {
  if (!Array.isArray(u.pushSubscriptions) || u.pushSubscriptions.length === 0) return;
  const expiredEndpoints = new Set<string>();

  await Promise.allSettled(
    u.pushSubscriptions.map(async (sub: PushSubscription) => {
      const res = await sendPushToSubscription(sub, payload);
      if (res.expired) expiredEndpoints.add(sub.endpoint);
    })
  );

  if (expiredEndpoints.size > 0) {
    u.pushSubscriptions = u.pushSubscriptions.filter(
      (s: PushSubscription) => !expiredEndpoints.has(s.endpoint)
    );
  }
}

// ---------------------------------------------------------------- Google
async function exchangeCode(env: Env, code: string, redirectUri: string) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID || '',
      client_secret: env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const d: any = await r.json();
  if (!r.ok) throw new Error(`Google token exchange failed: ${d.error_description || d.error}`);
  return d as { access_token: string; refresh_token?: string };
}
async function googleAccessToken(env: Env, u: any): Promise<string> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID || '',
      client_secret: env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: u.googleRefresh,
      grant_type: 'refresh_token',
    }),
  });
  const d: any = await r.json();
  if (!r.ok) {
    if (d.error === 'invalid_grant') u.googleStatus = 'revoked';
    throw new Error(`Google refresh failed: ${d.error}`);
  }
  u.googleStatus = 'ok';
  return d.access_token;
}
async function createSheet(token: string, title: string, headers: string[]): Promise<string> {
  const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: 'Log', gridProperties: { frozenRowCount: 1 } } }],
    }),
  });
  const d: any = await r.json();
  if (!r.ok) throw new Error(`Create sheet failed: ${d.error?.message}`);
  await appendRows(token, d.spreadsheetId, [headers]);
  return d.spreadsheetId;
}
async function appendRows(token: string, sheetId: string, rows: (string | number)[][]) {
  let r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Log!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    }
  );
  if (!r.ok) {
    // If 'Log' tab doesn't exist, fallback to Sheet1
    r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: rows }),
      }
    );
  }
  if (!r.ok) throw new Error(`Append failed: HTTP ${r.status}`);
}
/** Unambiguous IST date (YYYY-MM-DD) + 24h time. Locale strings like 4/11/2026 get mis-read by Sheets. */
function istIso(sec: number): { date: string; time: string } {
  const safeSec = typeof sec === 'number' && !isNaN(sec) ? sec : Math.floor(Date.now() / 1000);
  const iso = new Date((safeSec + 19800) * 1000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
}
// Last column of every row holds the full record as JSON so history can be restored on a new device.
const tripRow = (t: any) => {
  const s = istIso(t.startTimestampSec);
  const e = istIso(t.endTimestampSec || t.startTimestampSec);
  const durSec = t.durationSeconds || (t.endTimestampSec && t.startTimestampSec ? Math.max(0, t.endTimestampSec - t.startTimestampSec) : 0);
  return [
    t.id, s.date, s.time, e.time, fmtDur(durSec), t.distanceKm ?? 0, t.startOdometerKm ?? 0,
    t.endOdometerKm ?? 0, Number(Number(t.startSoc ?? 0).toFixed(1)), Number(Number(t.endSoc ?? 0).toFixed(1)),
    t.energyUsedKwh ?? 0, t.efficiencyKmPerKwh ?? 0,
    t.startLocation || (t.startLat != null ? `${t.startLat},${t.startLng}` : '--'),
    t.endLocation || (t.endLat != null ? `${t.endLat},${t.endLng}` : '--'),
    fmtDur(t.idleDurationSeconds || 0), t.idleEnergyKwh ?? 0, t.endCabinTempC ?? t.cabinTempC ?? '', t.endExteriorTempC ?? t.exteriorTempC ?? '',
    t.maxSpeedKmh ?? 0, t.avgSpeedKmh ?? 0, JSON.stringify(t),
  ];
};
const chargeRow = (c: any) => {
  const s = istIso(c.startTimestampSec);
  const e = istIso(c.endTimestampSec || c.startTimestampSec);
  const dur = c.durationFormatted || fmtDur(c.durationSeconds || (c.endTimestampSec && c.startTimestampSec ? Math.max(0, c.endTimestampSec - c.startTimestampSec) : 0));
  return [
    c.id, s.date, s.time, e.time, dur, Number(Number(c.startSoc ?? 0).toFixed(1)),
    Number(Number(c.endSoc ?? 0).toFixed(1)), c.energyAddedToPackKwh ?? 0, c.energyConsumedKwh ?? 0,
    c.energyLossPercent ?? 0, c.chargerCategory || '3.3 kW AC', c.maxChargingSpeedKw ?? 0, c.completionStatus || c.status || 'completed',
    c.odometerKm ?? 0, c.distanceTravelledSinceLastChargeKm ?? 0, c.energyUsedSinceLastChargeKwh ?? 0,
    c.efficiencyKmPerKwh ?? 0, JSON.stringify(c),
  ];
};

/** Rewrite an entire sheet cleanly with fresh headers and sorted unique rows. */
async function clearAndRewriteSheet(
  token: string,
  sheetId: string,
  headers: string[],
  rows: (string | number)[][]
): Promise<void> {
  let tabName = 'Log';
  let r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Log!A1:Z5000:clear`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    }
  );
  if (!r.ok) {
    tabName = 'Sheet1';
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A1:Z5000:clear`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      }
    );
  }

  const allValues = [headers, ...rows];
  const putResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${tabName}!A1?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: allValues }),
    }
  );
  if (!putResp.ok) {
    const errText = await putResp.text();
    throw new Error(`Rewrite sheet failed: HTTP ${putResp.status} - ${errText}`);
  }
}

/**
 * Deduplicates a list of trips, eliminating exact duplicates, zero-distance GPS jitter,
 * and fragmented trips that were started midway during a drive.
 * When duplicates or overlapping intervals are found, the longest and most complete trip is kept.
 */
function deduplicateTripList(trips: any[]): any[] {
  if (!trips || !trips.length) return [];

  const valid = trips.filter((t) => Number(t?.distanceKm ?? 0) >= 0.2 || t?.status === 'driving');

  valid.sort((a, b) => {
    const timeA = a.startTimestampSec || 0;
    const timeB = b.startTimestampSec || 0;
    if (timeA !== timeB) return timeB - timeA;
    return (b.distanceKm || 0) - (a.distanceKm || 0);
  });

  const clean: any[] = [];

  for (const t of valid) {
    const tId = String(t.id || '');
    const tJourney = t.journeyId != null ? Number(t.journeyId) : null;
    const tStartSec = Number(t.startTimestampSec || 0);
    const tEndSec = Number(t.endTimestampSec || tStartSec);
    const tStartOdo = Number(t.startOdometerKm || 0);
    const tEndOdo = Number(t.endOdometerKm || 0);
    const tDist = Number(t.distanceKm || 0);

    let isDuplicate = false;

    for (let i = 0; i < clean.length; i++) {
      const c = clean[i];
      const cId = String(c.id || '');
      const cJourney = c.journeyId != null ? Number(c.journeyId) : null;
      const cStartSec = Number(c.startTimestampSec || 0);
      const cEndSec = Number(c.endTimestampSec || cStartSec);
      const cStartOdo = Number(c.startOdometerKm || 0);
      const cEndOdo = Number(c.endOdometerKm || 0);
      const cDist = Number(c.distanceKm || 0);

      // 1. Exact ID match
      if (tId && cId && tId === cId) {
        isDuplicate = true;
        break;
      }

      // 2. Same vehicle ECU Journey ID
      if (tJourney != null && cJourney != null && tJourney === cJourney) {
        if (tDist > cDist || (tStartSec < cStartSec && tEndSec >= cEndSec)) {
          clean[i] = t;
        }
        isDuplicate = true;
        break;
      }

      // 3. Same End Odometer (within 0.25 km) AND Overlapping Time Window
      const sameEndOdo = tEndOdo > 0 && cEndOdo > 0 && Math.abs(tEndOdo - cEndOdo) <= 0.25;
      const timeOverlaps = tStartSec <= cEndSec + 90 && tEndSec >= cStartSec - 90;

      if (sameEndOdo && timeOverlaps) {
        if (tDist > cDist || (tStartSec < cStartSec && tEndSec >= cEndSec)) {
          clean[i] = t;
        }
        isDuplicate = true;
        break;
      }

      // 4. Same Start Odometer AND Start Time (within 120s)
      const sameStartOdo = tStartOdo > 0 && cStartOdo > 0 && Math.abs(tStartOdo - cStartOdo) <= 0.25;
      const sameStartTime = Math.abs(tStartSec - cStartSec) <= 120;
      if (sameStartOdo && sameStartTime) {
        if (tDist > cDist) {
          clean[i] = t;
        }
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      clean.push(t);
    }
  }

  return clean;
}

/**
 * Strict validator for charging session records.
 * Discards ghost records with null/missing timestamps, corrupt 0.13% SOC, or zero energy added.
 */
function isValidChargeRecord(c: any): boolean {
  if (!c || typeof c !== 'object') return false;
  const id = String(c.id || '');
  if (id === 'chg-1793725580' && (!c.startTimestampSec || Number(c.energyAddedToPackKwh || 0) <= 0)) {
    return false;
  }
  const startSec = Number(c.startTimestampSec || 0);
  const startSoc = Number(c.startSoc || 0);
  const endSoc = Number(c.endSoc || 0);
  const energyAdded = Number(c.energyAddedToPackKwh || 0);
  const durSec = Number(c.durationSeconds || 0);
  if (!startSec || startSec < 1704067200) {
    if (!c.startDateTime || c.startDateTime === '--') return false;
  }
  if (endSoc <= 1 && startSoc > 5) return false;
  if (energyAdded <= 0 && (endSoc - startSoc) <= 0.5 && durSec <= 60) {
    if (c.status !== 'charging') return false;
  }
  if (c.endDateTime === 'Charging in progress...' && c.status === 'completed' && energyAdded <= 0) {
    return false;
  }
  return true;
}

/** Deduplicates charging records by ID, odometer, and timestamp */
function deduplicateChargeList(charges: any[]): any[] {
  if (!charges || !charges.length) return [];
  const valid = charges.filter(isValidChargeRecord);

  valid.sort((a, b) => {
    const timeA = Number(a.startTimestampSec || 0);
    const timeB = Number(b.startTimestampSec || 0);
    if (timeA !== timeB) return timeB - timeA;
    return Number(b.energyAddedToPackKwh || 0) - Number(a.energyAddedToPackKwh || 0);
  });

  const clean: any[] = [];
  for (const c of valid) {
    const cId = String(c.id || '');
    const cStartSec = Number(c.startTimestampSec || 0);
    const cEndSec = Number(c.endTimestampSec || cStartSec);
    const cOdo = Number(c.odometerKm || 0);
    const cEndSoc = Number(c.endSoc || 0);
    const cEnergy = Number(c.energyAddedToPackKwh || 0);

    let isDup = false;
    for (let i = 0; i < clean.length; i++) {
      const x = clean[i];
      const xId = String(x.id || '');
      const xStartSec = Number(x.startTimestampSec || 0);
      const xEndSec = Number(x.endTimestampSec || xStartSec);
      const xOdo = Number(x.odometerKm || 0);
      const xEndSoc = Number(x.endSoc || 0);
      const xEnergy = Number(x.energyAddedToPackKwh || 0);

      // 1. Exact ID match
      if (cId && xId && cId === xId) {
        if (cEnergy > xEnergy) clean[i] = c;
        isDup = true;
        break;
      }

      // 2. Same session by timestamp (within 15 minutes of start)
      if (cStartSec > 0 && xStartSec > 0 && Math.abs(cStartSec - xStartSec) < 900) {
        if (cEnergy > xEnergy) clean[i] = c;
        isDup = true;
        break;
      }

      // 3. Same vehicle odometer (within 0.5 km) and overlapping charge window
      if (cOdo > 0 && xOdo > 0 && Math.abs(cOdo - xOdo) <= 0.5) {
        const timeOverlaps = cStartSec <= xEndSec + 1800 && cEndSec >= xStartSec - 1800;
        const socSimilar = Math.abs(cEndSoc - xEndSoc) <= 2;
        if (timeOverlaps || socSimilar) {
          if (cEnergy > xEnergy) clean[i] = c;
          isDup = true;
          break;
        }
      }
    }

    if (!isDup) {
      clean.push(c);
    }
  }
  return clean;
}

/** Full cleanup & deduplication of user's Google Sheets (Trips and Charges) */
async function cleanGoogleSheetTripsAndCharges(
  token: string,
  tripSheetId: string,
  chargeSheetId?: string,
  u?: any
): Promise<{
  tripsBefore: number;
  tripsAfter: number;
  tripsRemoved: number;
  chargesBefore: number;
  chargesAfter: number;
  chargesRemoved: number;
}> {
  let tripsBefore = 0;
  let tripsAfter = 0;
  let tripsRemoved = 0;

  if (tripSheetId) {
    const existing = await readSheetRecords(token, tripSheetId).catch(() => []);
    tripsBefore = existing.length;
    const cleanTrips = deduplicateTripList(existing);
    tripsAfter = cleanTrips.length;
    tripsRemoved = Math.max(0, tripsBefore - tripsAfter);

    if (tripsRemoved > 0 || tripsBefore !== tripsAfter) {
      cleanTrips.sort((a, b) => (a.startTimestampSec || 0) - (b.startTimestampSec || 0));
      await clearAndRewriteSheet(token, tripSheetId, TRIP_HEADERS, cleanTrips.map(tripRow));
      if (u) {
        u.trips = cleanTrips.slice(0, 60);
        u.pendingTrips = [];
      }
    }
  }

  let chargesBefore = 0;
  let chargesAfter = 0;
  let chargesRemoved = 0;

  if (chargeSheetId) {
    const existing = await readSheetRecords(token, chargeSheetId).catch(() => []);
    chargesBefore = existing.length;
    const cleanCharges = deduplicateChargeList(existing);
    chargesAfter = cleanCharges.length;
    chargesRemoved = Math.max(0, chargesBefore - chargesAfter);

    if (chargesRemoved > 0 || chargesBefore !== chargesAfter) {
      cleanCharges.sort((a, b) => (a.startTimestampSec || 0) - (b.startTimestampSec || 0));
      await clearAndRewriteSheet(token, chargeSheetId, CHARGE_HEADERS, cleanCharges.map(chargeRow));
      if (u) {
        u.charges = cleanCharges.slice(0, 60);
        u.pendingCharges = [];
      }
    }
  }

  return { tripsBefore, tripsAfter, tripsRemoved, chargesBefore, chargesAfter, chargesRemoved };
}

/** Read every saved record back out of a user's sheet (for restoring history on a new device). */
async function readSheetRecords(token: string, sheetId: string): Promise<any[]> {
  let r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Log!A2:Z5000?valueRenderOption=UNFORMATTED_VALUE`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) {
    r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A2:Z5000?valueRenderOption=UNFORMATTED_VALUE`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
  }
  if (!r.ok) {
    r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A2:Z5000?valueRenderOption=UNFORMATTED_VALUE`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
  }
  if (!r.ok) return [];
  const d: any = await r.json();
  const out: any[] = [];
  for (const row of d.values || []) {
    let parsed: any = null;
    for (let i = row.length - 1; i >= 0; i--) {
      if (typeof row[i] === 'string' && row[i].startsWith('{')) {
        try {
          parsed = JSON.parse(row[i]);
          break;
        } catch (_) {}
      }
    }
    if (parsed) {
      out.push(parsed);
    } else if (row && row[0]) {
      // Reconstruct basic record from columns if JSON column missing
      const isCharge = String(row[0]).startsWith('chg-');
      if (isCharge) {
        out.push({
          id: String(row[0]),
          startSoc: Number(row[5]) || 0,
          endSoc: Number(row[6]) || 0,
          energyAddedToPackKwh: Number(row[7]) || 0,
          energyConsumedKwh: Number(row[8]) || 0,
          energyLossPercent: Number(row[9]) || 0,
          chargerCategory: String(row[10] || '3.3 kW AC'),
          maxChargingSpeedKw: Number(row[11]) || 0,
          status: String(row[12] || 'completed'),
          odometerKm: Number(row[13]) || 0,
          distanceTravelledSinceLastChargeKm: Number(row[14]) || 0,
          energyUsedSinceLastChargeKwh: Number(row[15]) || 0,
          efficiencyKmPerKwh: Number(row[16]) || 0,
        });
      } else {
        out.push({
          id: String(row[0]),
          distanceKm: Number(row[5]) || 0,
          startOdometerKm: Number(row[6]) || 0,
          endOdometerKm: Number(row[7]) || 0,
          startSoc: Number(row[8]) || 0,
          endSoc: Number(row[9]) || 0,
          energyUsedKwh: Number(row[10]) || 0,
          efficiencyKmPerKwh: Number(row[11]) || 0,
          startLocation: row[12] || '',
          endLocation: row[13] || '',
        });
      }
    }
  }
  return out.sort((a, b) => (b.startTimestampSec || 0) - (a.startTimestampSec || 0));
}

/** Push any queued rows to the user's sheets. Failures stay queued for next time. */
async function flushPending(env: Env, u: any, budget: { n: number }): Promise<boolean> {
  if (!u.pendingTrips.length && !u.pendingCharges.length) return false;
  if (u.googleStatus === 'revoked' || budget.n < 3) return false;
  try {
    const token = await googleAccessToken(env, u);
    budget.n++;
    if (u.pendingTrips.length) {
      const cleanPending = deduplicateTripList(u.pendingTrips);
      const existingSheet = await readSheetRecords(token, u.tripSheetId).catch(() => []);
      const existingIds = new Set(existingSheet.map((x: any) => String(x.id)));
      const toAppend = cleanPending.filter((p: any) => !existingIds.has(String(p.id)));
      if (toAppend.length > 0) {
        await appendRows(token, u.tripSheetId, toAppend.map(tripRow));
      }
      budget.n++;
      u.pendingTrips = [];
    }
    if (u.pendingCharges.length) {
      const cleanPending = deduplicateChargeList(u.pendingCharges);
      const existingSheet = await readSheetRecords(token, u.chargeSheetId).catch(() => []);
      const existingIds = new Set(existingSheet.map((x: any) => String(x.id)));
      const toAppend = cleanPending.filter((p: any) => !existingIds.has(String(p.id)));
      if (toAppend.length > 0) {
        await appendRows(token, u.chargeSheetId, toAppend.map(chargeRow));
      }
      budget.n++;
      u.pendingCharges = [];
    }
  } catch (e) {
    u.lastError = (e as Error).message;
  }
  return true;
}

// ---------------------------------------------------------------- polling engine
/** Returns true if the user record changed and must be saved. */
async function pollUser(env: Env, u: any, nowSec: number, budget: { n: number }): Promise<boolean> {
  // 24/7 polling disabled to protect 12V battery
  return false;
}

// ---------------------------------------------------------------- HTTP routes
function redirectPage(target: string, title: string): Response {
  const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{background:#0B132B;color:#94A3B8;font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
.b{background:#1C2541;padding:28px;border-radius:16px;border:1px solid #3A506B;max-width:320px}h2{color:#10B981;margin:0 0 10px}
a{display:inline-block;padding:12px 24px;background:#10B981;color:#fff;border-radius:10px;text-decoration:none;font-weight:bold}</style></head>
<body><div class="b"><h2>${title}</h2><p>Returning you to the app...</p><a href="${target}">Open MG Windsor EV App</a></div>
<script>setTimeout(function(){window.location.replace(${JSON.stringify(target)})},50);</script></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/** Native app: deep link. PWA: redirect to an allow-listed web origin passed via OAuth state. */
function finishSignIn(env: Env, url: URL, query: string, title: string): Response {
  const state = (url.searchParams.get('state') || '').trim();
  if (state.startsWith('http://') || state.startsWith('https://')) {
    let targetOrigin = state.replace(/\/$/, '');
    try {
      targetOrigin = new URL(state).origin;
    } catch (_) {}

    const allowed = (env.WEB_APP_ORIGINS || '')
      .split(',')
      .map((s) => s.trim().replace(/\/$/, '').toLowerCase())
      .filter(Boolean);

    const isAllowed =
      allowed.length === 0 ||
      allowed.includes(targetOrigin.toLowerCase()) ||
      targetOrigin.toLowerCase().endsWith('.pages.dev') ||
      targetOrigin.startsWith('https://') ||
      targetOrigin.includes('localhost') ||
      targetOrigin.includes('127.0.0.1');

    if (!isAllowed) {
      return new Response(
        `Web app origin "${targetOrigin}" is not in the allowed list.\n\nAdd it to WEB_APP_ORIGINS in your Cloudflare Worker Settings > Variables.\nAllowed list currently: ${allowed.join(', ') || '(none)'}`,
        { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      );
    }

    const targetUrl = `${targetOrigin}/?${query}`;
    const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Returning to MG iSMART...</title>
<style>body{background:#0A0E17;color:#94A3B8;font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center}
.b{background:#1C2541;padding:28px;border-radius:16px;border:1px solid #3A506B;max-width:320px}h2{color:#10B981;margin:0 0 10px}
a{display:inline-block;padding:12px 24px;background:#10B981;color:#fff;border-radius:10px;text-decoration:none;font-weight:bold}</style></head>
<body><div class="b"><h2>✅ Connected to Google!</h2><p>Returning you to the MG Windsor EV app...</p><a href="${targetUrl}">Open MG Windsor EV App</a></div>
<script>window.location.replace(${JSON.stringify(targetUrl)});</script></body></html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  return redirectPage(`mgismart://google-auth?${query}`, title);
}

async function handleGoogleCallback(env: Env, url: URL): Promise<Response> {
  const err = url.searchParams.get('error');
  if (err) return finishSignIn(env, url, `error=${encodeURIComponent(err)}`, 'Sign-in cancelled');
  const code = url.searchParams.get('code');
  if (!code) return finishSignIn(env, url, 'error=no_code', 'Sign-in failed');
  try {
    const redirectUri = `${url.origin}/google-callback`;
    const tok = await exchangeCode(env, code, redirectUri);
    const prof: any = await (
      await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tok.access_token}` },
      })
    ).json();
    const email: string = prof.email || 'unknown';
    const kv = kvOrThrow(env);

    // Same Google account signing in again => reuse same record (no duplicate sheets)
    let id = await kv.get(`e:${email}`, 'text');
    let u = id ? await loadUser(env, id) : null;
    const userKey = randomHex(24);
    const newHash = await sha256(userKey);
    if (!u) {
      id = randomHex(8);
      const tripSheetId = await createSheet(tok.access_token, 'MG Windsor EV - Trip Logs', TRIP_HEADERS);
      const chargeSheetId = await createSheet(tok.access_token, 'MG Windsor EV - Charging Sessions', CHARGE_HEADERS);
      u = {
        id, email, name: prof.name || email, createdSec: Math.floor(Date.now() / 1000),
        googleRefresh: tok.refresh_token || '', googleStatus: 'ok', tripSheetId, chargeSheetId,
        mg: null, mgStatus: 'none', activeTrip: null, activeCharge: null,
        trips: [], charges: [], pendingTrips: [], pendingCharges: [],
        keyHash: newHash,
        keyHashes: [newHash],
      };
      const ids: string[] = JSON.parse((await kv.get('users', 'text')) || '[]');
      ids.push(id!);
      await kv.put('users', JSON.stringify(ids));
      await kv.put(`e:${email}`, id!);
    } else {
      if (tok.refresh_token) {
        u.googleRefresh = tok.refresh_token;
        u.googleStatus = 'ok';
      }
      u.keyHash = newHash;
      const existing = Array.isArray(u.keyHashes) ? u.keyHashes : (u.keyHash ? [u.keyHash] : []);
      existing.push(newHash);
      u.keyHashes = existing.slice(-10); // allow up to 10 active devices simultaneously
    }
    await saveUser(env, u);

    const q = new URLSearchParams({
      userId: u.id, userKey, email, name: u.name,
      tripSheetId: u.tripSheetId, chargeSheetId: u.chargeSheetId,
    });
    return finishSignIn(env, url, q.toString(), '✅ Background tracking connected');
  } catch (e) {
    return finishSignIn(env, url, `error=${encodeURIComponent((e as Error).message)}`, 'Sign-in failed');
  }
}


// ---------------------------------------------------------------- Cloudflare D1 Database & CarPlay Webhooks
let d1Initialized = false;
let d1InitErrors: string[] = [];

const D1_TABLE_SCHEMAS = [
  `CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    start_timestamp INTEGER NOT NULL,
    end_timestamp INTEGER,
    duration_seconds INTEGER,
    distance_km REAL,
    start_odometer_km REAL,
    end_odometer_km REAL,
    start_soc INTEGER,
    end_soc INTEGER,
    energy_used_kwh REAL,
    efficiency_km_per_kwh REAL,
    start_location TEXT,
    end_location TEXT,
    avg_speed_kmh REAL,
    max_speed_kmh REAL,
    status TEXT DEFAULT 'completed',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(date)`,
  `CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status)`,
  `CREATE TABLE IF NOT EXISTS charges (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    start_timestamp INTEGER NOT NULL,
    end_timestamp INTEGER,
    duration_seconds INTEGER,
    start_soc INTEGER,
    end_soc INTEGER,
    energy_added_kwh REAL,
    charger_type TEXT,
    peak_kw REAL,
    odometer_km REAL,
    status TEXT DEFAULT 'completed',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_charges_date ON charges(date)`,
  `CREATE TABLE IF NOT EXISTS charging_sessions (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    start_soc INTEGER NOT NULL,
    end_soc INTEGER,
    soc_added INTEGER DEFAULT 0,
    kwh_added REAL DEFAULT 0,
    energy_used_kwh REAL DEFAULT 0,
    charging_loss_kwh REAL DEFAULT 0,
    charge_type TEXT DEFAULT 'AC',
    peak_power_kw REAL DEFAULT 0,
    last_power_kw REAL DEFAULT 0,
    start_odometer_km REAL,
    start_range_km REAL,
    outage_count INTEGER DEFAULT 0,
    paused_at INTEGER,
    active_duration_seconds INTEGER DEFAULT 0,
    last_poll_time INTEGER,
    date TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_charging_sessions_status ON charging_sessions(status)`,
  `CREATE INDEX IF NOT EXISTS idx_charging_sessions_start_time ON charging_sessions(start_time DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_charging_sessions_date ON charging_sessions(date)`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    date TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    metadata TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_timestamp ON notifications(timestamp DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_date ON notifications(date)`,
  `CREATE TABLE IF NOT EXISTS kv_store (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`
];

async function initD1(db: any) {
  if (d1Initialized || !db || typeof db.prepare !== 'function') return;
  d1InitErrors = [];
  for (const sql of D1_TABLE_SCHEMAS) {
    try {
      await db.prepare(sql).run();
    } catch (err: any) {
      d1InitErrors.push(`${sql.substring(0, 30)}: ${err?.message || err}`);
      console.warn('initD1 statement error:', err);
    }
  }
  // Auto-migrate columns for pre-existing tables:
  try {
    await db.prepare('ALTER TABLE notifications ADD COLUMN is_read INTEGER DEFAULT 0').run();
  } catch (_) {}
  if (d1InitErrors.length === 0) {
    d1Initialized = true;
  }
}

async function d1KvGet(env: Env, key: string): Promise<any | null> {
  if (env.DB) {
    try {
      const row: any = await env.DB.prepare('SELECT value FROM kv_store WHERE key = ?').bind(key).first();
      if (row?.value) {
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
}

async function d1KvPut(env: Env, key: string, value: any): Promise<void> {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare('INSERT OR REPLACE INTO kv_store (key, value) VALUES (?, ?)').bind(key, str).run();
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      await env.TRIP_KV.put(key, str);
    } catch (_) {}
  }
}

async function resolveLocation(lat?: number | null, lng?: number | null): Promise<string> {
  if (!lat || !lng) return 'Unknown Location';
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16`, {
      headers: {
        'User-Agent': 'MGWindsorEV-CarPlay/1.0',
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (res.ok) {
      const data: any = await res.json();
      const addr = data.address || {};
      const road = addr.road || addr.suburb || addr.neighbourhood || '';
      const city = addr.city || addr.town || addr.village || addr.county || '';
      if (road && city) return `${road}, ${city}`;
      if (city) return city;
      if (data.display_name) return data.display_name.split(',').slice(0, 2).join(',').trim();
    }
  } catch (_) {}
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function istDateString(sec: number): string {
  const d = new Date((sec + 19800) * 1000); // UTC + 5:30
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDurationSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h} hr ${remM} min`;
  }
  return `${m} min ${s} sec`;
}

function formatClockTime(sec: number): string {
  const d = new Date((sec + 19800) * 1000);
  let h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
}

async function dispatchTripNotification(url: URL | null, title: string, bodyText: string, tags = 'car', env?: Env) {
  let ntfyTopic = url ? (url.searchParams.get('ntfy') || url.searchParams.get('topic') || '').trim() : '';
  let pushwardKey = url ? (url.searchParams.get('pushward') || '').trim() : '';

  if (env) {
    if (!ntfyTopic && (env as any).NTFY_TOPIC) {
      ntfyTopic = String((env as any).NTFY_TOPIC || '').trim();
    }
    if (!pushwardKey && (env as any).PUSHWARD_KEY) {
      pushwardKey = String((env as any).PUSHWARD_KEY || '').trim();
    }
    if (!ntfyTopic) {
      const saved = await d1KvGet(env, 'ntfy_topic');
      if (saved) ntfyTopic = String(saved).trim();
    }
    if (!pushwardKey) {
      const saved = await d1KvGet(env, 'pushward_key');
      if (saved) pushwardKey = String(saved).trim();
    }
    if (url && url.searchParams.get('ntfy') && ntfyTopic) {
      await d1KvSet(env, 'ntfy_topic', ntfyTopic);
    }
    if (url && url.searchParams.get('pushward') && pushwardKey) {
      await d1KvSet(env, 'pushward_key', pushwardKey);
    }
  }

  if (ntfyTopic) {
    try {
      await fetch(`https://ntfy.sh/${encodeURIComponent(ntfyTopic)}`, {
        method: 'POST',
        headers: {
          'Title': title,
          'Tags': tags,
          'Priority': 'high',
        },
        body: bodyText,
      });
    } catch (_) {}
  }

  if (pushwardKey) {
    try {
      await fetch('https://api.pushward.com/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: pushwardKey, title, body: bodyText }),
      });
    } catch (_) {}
  }
}

// D1 and KV Dual Storage Helpers
async function d1InsertTrip(env: Env, trip: any) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare(`
        INSERT OR REPLACE INTO trips (id, date, start_timestamp, end_timestamp, duration_seconds, distance_km, start_odometer_km, end_odometer_km, start_soc, end_soc, energy_used_kwh, efficiency_km_per_kwh, start_location, end_location, avg_speed_kmh, max_speed_kmh, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        trip.id, trip.date, trip.start_timestamp, trip.end_timestamp || null, trip.duration_seconds || null,
        trip.distance_km != null ? Number(trip.distance_km) : null,
        trip.start_odometer_km != null ? Number(trip.start_odometer_km) : null,
        trip.end_odometer_km != null ? Number(trip.end_odometer_km) : null,
        trip.start_soc != null ? Number(trip.start_soc) : null,
        trip.end_soc != null ? Number(trip.end_soc) : null,
        trip.energy_used_kwh != null ? Number(trip.energy_used_kwh) : null,
        trip.efficiency_km_per_kwh != null ? Number(trip.efficiency_km_per_kwh) : null,
        trip.start_location || '', trip.end_location || '',
        trip.avg_speed_kmh != null ? Number(trip.avg_speed_kmh) : null,
        trip.max_speed_kmh != null ? Number(trip.max_speed_kmh) : null,
        trip.status || 'ongoing'
      ).run();
    } catch (err) {
      console.warn('d1InsertTrip error:', err);
    }
  }
  if (env.TRIP_KV) {
    try {
      const trips = (await env.TRIP_KV.get('d1_fallback:trips', 'json')) || [];
      const filtered = trips.filter((t: any) => t.id !== trip.id);
      filtered.unshift(trip);
      await env.TRIP_KV.put('d1_fallback:trips', JSON.stringify(filtered.slice(0, 300)));
      if (trip.status === 'ongoing') {
        await env.TRIP_KV.put('d1_fallback:active_trip', JSON.stringify(trip));
      }
    } catch (_) {}
  }
}

async function d1BatchSyncTrips(env: Env, rawTrips: any[]): Promise<number> {
  if (!Array.isArray(rawTrips) || rawTrips.length === 0) return 0;
  let count = 0;
  if (env.DB) {
    await initD1(env.DB);
    for (const trip of rawTrips) {
      try {
        const id = trip.id || ('trip_' + (trip.start_timestamp || Math.floor(Date.now() / 1000)) + '_' + Math.random().toString(36).substring(2, 6));
        const date = trip.date || (trip.start_timestamp ? istDateString(Number(trip.start_timestamp)) : istDateString(Math.floor(Date.now() / 1000)));
        await env.DB.prepare(`
          INSERT OR REPLACE INTO trips (
            id, date, start_timestamp, end_timestamp, duration_seconds, distance_km,
            start_odometer_km, end_odometer_km, start_soc, end_soc, energy_used_kwh,
            efficiency_km_per_kwh, start_location, end_location, avg_speed_kmh, max_speed_kmh, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          id, date, Number(trip.start_timestamp) || 0,
          trip.end_timestamp ? Number(trip.end_timestamp) : null,
          trip.duration_seconds ? Number(trip.duration_seconds) : null,
          trip.distance_km != null ? Number(trip.distance_km) : null,
          trip.start_odometer_km != null ? Number(trip.start_odometer_km) : null,
          trip.end_odometer_km != null ? Number(trip.end_odometer_km) : null,
          trip.start_soc != null ? Number(trip.start_soc) : null,
          trip.end_soc != null ? Number(trip.end_soc) : null,
          trip.energy_used_kwh != null ? Number(trip.energy_used_kwh) : null,
          trip.efficiency_km_per_kwh != null ? Number(trip.efficiency_km_per_kwh) : null,
          trip.start_location || '', trip.end_location || '',
          trip.avg_speed_kmh != null ? Number(trip.avg_speed_kmh) : null,
          trip.max_speed_kmh != null ? Number(trip.max_speed_kmh) : null,
          trip.status || 'completed'
        ).run();
        count++;
      } catch (err) {
        console.warn('d1BatchSyncTrips error:', err);
      }
    }
  }
  if (env.TRIP_KV) {
    try {
      const existing = (await env.TRIP_KV.get('d1_fallback:trips', 'json')) || [];
      const map = new Map<string, any>();
      for (const t of existing) {
        if (t?.id) map.set(t.id, t);
      }
      for (const t of rawTrips) {
        if (t?.id) {
          map.set(t.id, {
            ...t,
            date: t.date || (t.start_timestamp ? istDateString(Number(t.start_timestamp)) : ''),
            status: t.status || 'completed',
          });
        }
      }
      const merged = Array.from(map.values()).sort((a, b) => (Number(b.start_timestamp) || 0) - (Number(a.start_timestamp) || 0));
      await env.TRIP_KV.put('d1_fallback:trips', JSON.stringify(merged.slice(0, 300)));
      if (!env.DB) count = rawTrips.length;
    } catch (_) {}
  }
  return count;
}

async function d1DeleteTrip(env: Env, tripId: string) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare('DELETE FROM trips WHERE id = ?').bind(tripId).run();
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const trips = (await env.TRIP_KV.get('d1_fallback:trips', 'json')) || [];
      await env.TRIP_KV.put('d1_fallback:trips', JSON.stringify(trips.filter((t: any) => t.id !== tripId)));
    } catch (_) {}
  }
}

async function d1ClearTrips(env: Env) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare('DELETE FROM trips').run();
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      await env.TRIP_KV.delete('d1_fallback:trips');
      await env.TRIP_KV.delete('d1_fallback:active_trip');
    } catch (_) {}
  }
}

async function d1UpdateTrip(env: Env, tripId: string, updates: any) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare(`
        UPDATE trips SET
          end_timestamp = ?,
          duration_seconds = ?,
          distance_km = ?,
          end_odometer_km = ?,
          end_soc = ?,
          energy_used_kwh = ?,
          efficiency_km_per_kwh = ?,
          end_location = ?,
          avg_speed_kmh = ?,
          status = 'completed'
        WHERE id = ?
      `).bind(
        updates.end_timestamp, updates.duration_seconds, updates.distance_km,
        updates.end_odometer_km, updates.end_soc, updates.energy_used_kwh,
        updates.efficiency_km_per_kwh, updates.end_location, updates.avg_speed_kmh,
        tripId
      ).run();
    } catch (err) {
      console.warn('d1UpdateTrip error:', err);
    }
  }
  if (env.TRIP_KV) {
    try {
      const trips = (await env.TRIP_KV.get('d1_fallback:trips', 'json')) || [];
      const idx = trips.findIndex((t: any) => t.id === tripId);
      if (idx !== -1) {
        trips[idx] = { ...trips[idx], ...updates, status: 'completed' };
        await env.TRIP_KV.put('d1_fallback:trips', JSON.stringify(trips.slice(0, 200)));
      }
      await env.TRIP_KV.delete('d1_fallback:active_trip');
    } catch (_) {}
  }
}

async function d1GetActiveTrip(env: Env) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      const row = await env.DB.prepare("SELECT * FROM trips WHERE status = 'ongoing' ORDER BY start_timestamp DESC LIMIT 1").first();
      if (row) return row;
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const active = await env.TRIP_KV.get('d1_fallback:active_trip', 'json');
      if (active) return active;
      const trips = (await env.TRIP_KV.get('d1_fallback:trips', 'json')) || [];
      return trips.find((t: any) => t.status === 'ongoing') || null;
    } catch (_) {}
  }
  return null;
}

async function d1GetTrips(env: Env, date?: string | null) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      if (!date || date === 'all') {
        const res = await env.DB.prepare("SELECT * FROM trips ORDER BY start_timestamp DESC LIMIT 150").all();
        return res.results || [];
      }
      const res = await env.DB.prepare("SELECT * FROM trips WHERE date = ? ORDER BY start_timestamp DESC").bind(date).all();
      return res.results || [];
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const trips = (await env.TRIP_KV.get('d1_fallback:trips', 'json')) || [];
      if (!date || date === 'all') return trips;
      return trips.filter((t: any) => t.date === date);
    } catch (_) {}
  }
  return [];
}

async function d1GetTripDates(env: Env) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      const res = await env.DB.prepare("SELECT DISTINCT date FROM trips ORDER BY date DESC").all();
      return (res.results || []).map((r: any) => r.date).filter(Boolean);
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const trips = (await env.TRIP_KV.get('d1_fallback:trips', 'json')) || [];
      return Array.from(new Set(trips.map((t: any) => t.date).filter(Boolean)));
    } catch (_) {}
  }
  return [];
}

// Charges D1 & KV helpers
async function d1InsertCharge(env: Env, charge: any) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare(`
        INSERT OR REPLACE INTO charges (id, date, start_timestamp, end_timestamp, duration_seconds, start_soc, end_soc, energy_added_kwh, charger_type, peak_kw, odometer_km, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        charge.id, charge.date, charge.start_timestamp, charge.end_timestamp || null, charge.duration_seconds || null,
        charge.start_soc != null ? Number(charge.start_soc) : null,
        charge.end_soc != null ? Number(charge.end_soc) : null,
        charge.energy_added_kwh != null ? Number(charge.energy_added_kwh) : null,
        charge.charger_type || 'AC 3.3 kW',
        charge.peak_kw != null ? Number(charge.peak_kw) : null,
        charge.odometer_km != null ? Number(charge.odometer_km) : null,
        charge.status || 'charging'
      ).run();
    } catch (err) {
      console.warn('d1InsertCharge error:', err);
    }
  }
  if (env.TRIP_KV) {
    try {
      const charges = (await env.TRIP_KV.get('d1_fallback:charges', 'json')) || [];
      const filtered = charges.filter((c: any) => c.id !== charge.id);
      filtered.unshift(charge);
      await env.TRIP_KV.put('d1_fallback:charges', JSON.stringify(filtered.slice(0, 300)));
      if (charge.status === 'charging') {
        await env.TRIP_KV.put('d1_fallback:active_charge', JSON.stringify(charge));
      }
    } catch (_) {}
  }
}

async function d1BatchSyncCharges(env: Env, rawCharges: any[]): Promise<number> {
  if (!Array.isArray(rawCharges) || rawCharges.length === 0) return 0;
  let count = 0;
  if (env.DB) {
    await initD1(env.DB);
    for (const charge of rawCharges) {
      try {
        const id = charge.id || ('chg_' + (charge.start_timestamp || Math.floor(Date.now() / 1000)) + '_' + Math.random().toString(36).substring(2, 6));
        const date = charge.date || (charge.start_timestamp ? istDateString(Number(charge.start_timestamp)) : istDateString(Math.floor(Date.now() / 1000)));
        await env.DB.prepare(`
          INSERT OR REPLACE INTO charges (
            id, date, start_timestamp, end_timestamp, duration_seconds,
            start_soc, end_soc, energy_added_kwh, charger_type, peak_kw, odometer_km, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          id, date, Number(charge.start_timestamp) || 0,
          charge.end_timestamp ? Number(charge.end_timestamp) : null,
          charge.duration_seconds ? Number(charge.duration_seconds) : null,
          charge.start_soc != null ? Number(charge.start_soc) : null,
          charge.end_soc != null ? Number(charge.end_soc) : null,
          charge.energy_added_kwh != null ? Number(charge.energy_added_kwh) : null,
          charge.charger_type || 'AC 3.3 kW',
          charge.peak_kw != null ? Number(charge.peak_kw) : null,
          charge.odometer_km != null ? Number(charge.odometer_km) : null,
          charge.status || 'completed'
        ).run();
        count++;
      } catch (err) {
        console.warn('d1BatchSyncCharges error:', err);
      }
    }
  }
  if (env.TRIP_KV) {
    try {
      const existing = (await env.TRIP_KV.get('d1_fallback:charges', 'json')) || [];
      const map = new Map<string, any>();
      for (const c of existing) {
        if (c?.id) map.set(c.id, c);
      }
      for (const c of rawCharges) {
        if (c?.id) {
          map.set(c.id, {
            ...c,
            date: c.date || (c.start_timestamp ? istDateString(Number(c.start_timestamp)) : ''),
            status: c.status || 'completed',
          });
        }
      }
      const merged = Array.from(map.values()).sort((a, b) => (Number(b.start_timestamp) || 0) - (Number(a.start_timestamp) || 0));
      await env.TRIP_KV.put('d1_fallback:charges', JSON.stringify(merged.slice(0, 300)));
      if (!env.DB) count = rawCharges.length;
    } catch (_) {}
  }
  return count;
}

async function d1DeleteCharge(env: Env, chargeId: string) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare('DELETE FROM charges WHERE id = ?').bind(chargeId).run();
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const charges = (await env.TRIP_KV.get('d1_fallback:charges', 'json')) || [];
      await env.TRIP_KV.put('d1_fallback:charges', JSON.stringify(charges.filter((c: any) => c.id !== chargeId)));
    } catch (_) {}
  }
}

async function d1ClearCharges(env: Env) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare('DELETE FROM charges').run();
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      await env.TRIP_KV.delete('d1_fallback:charges');
      await env.TRIP_KV.delete('d1_fallback:active_charge');
    } catch (_) {}
  }
}

async function d1UpdateCharge(env: Env, chargeId: string, updates: any) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare(`
        UPDATE charges SET
          end_timestamp = ?,
          duration_seconds = ?,
          end_soc = ?,
          energy_added_kwh = ?,
          peak_kw = ?,
          status = 'completed'
        WHERE id = ?
      `).bind(
        updates.end_timestamp, updates.duration_seconds, updates.end_soc,
        updates.energy_added_kwh, updates.peak_kw, chargeId
      ).run();
    } catch (err) {
      console.warn('d1UpdateCharge error:', err);
    }
  }
  if (env.TRIP_KV) {
    try {
      const charges = (await env.TRIP_KV.get('d1_fallback:charges', 'json')) || [];
      const idx = charges.findIndex((c: any) => c.id === chargeId);
      if (idx !== -1) {
        charges[idx] = { ...charges[idx], ...updates, status: 'completed' };
        await env.TRIP_KV.put('d1_fallback:charges', JSON.stringify(charges.slice(0, 200)));
      }
      await env.TRIP_KV.delete('d1_fallback:active_charge');
    } catch (_) {}
  }
}

async function d1GetActiveCharge(env: Env) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      const row = await env.DB.prepare("SELECT * FROM charges WHERE status = 'charging' ORDER BY start_timestamp DESC LIMIT 1").first();
      if (row) return row;
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const active = await env.TRIP_KV.get('d1_fallback:active_charge', 'json');
      if (active) return active;
      const charges = (await env.TRIP_KV.get('d1_fallback:charges', 'json')) || [];
      return charges.find((c: any) => c.status === 'charging') || null;
    } catch (_) {}
  }
  return null;
}

async function d1GetCharges(env: Env, date?: string | null) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      if (!date || date === 'all') {
        const res = await env.DB.prepare("SELECT * FROM charges ORDER BY start_timestamp DESC LIMIT 150").all();
        return res.results || [];
      }
      const res = await env.DB.prepare("SELECT * FROM charges WHERE date = ? ORDER BY start_timestamp DESC").bind(date).all();
      return res.results || [];
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const charges = (await env.TRIP_KV.get('d1_fallback:charges', 'json')) || [];
      if (!date || date === 'all') return charges;
      return charges.filter((c: any) => c.date === date);
    } catch (_) {}
  }
  return [];
}

async function d1GetChargeDates(env: Env) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      const res = await env.DB.prepare("SELECT DISTINCT date FROM charges ORDER BY date DESC").all();
      return (res.results || []).map((r: any) => r.date).filter(Boolean);
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const charges = (await env.TRIP_KV.get('d1_fallback:charges', 'json')) || [];
      return Array.from(new Set(charges.map((c: any) => c.date).filter(Boolean)));
    } catch (_) {}
  }
  return [];
}


// Notifications D1 & KV helpers
async function d1InsertNotification(env: Env, notif: any) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare(`
        INSERT INTO notifications (id, type, title, message, timestamp, date, is_read, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        notif.id, notif.type, notif.title, notif.message,
        notif.timestamp, notif.date, notif.is_read || 0, notif.metadata || ''
      ).run();
      return;
    } catch (err: any) {
      console.warn('d1InsertNotification primary error, trying fallback without is_read:', err?.message || err);
    }

    // Resilient fallback in case existing notifications table doesn't have is_read column:
    try {
      await env.DB.prepare(`
        INSERT INTO notifications (id, type, title, message, timestamp, date, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        notif.id, notif.type, notif.title, notif.message,
        notif.timestamp, notif.date, notif.metadata || ''
      ).run();
      return;
    } catch (err2: any) {
      console.error('d1InsertNotification fallback error:', err2?.message || err2);
    }
  }
  if (env.TRIP_KV) {
    try {
      const list = (await env.TRIP_KV.get('d1_fallback:notifications', 'json')) || [];
      list.unshift(notif);
      await env.TRIP_KV.put('d1_fallback:notifications', JSON.stringify(list.slice(0, 100)));
    } catch (_) {}
  }
}

async function d1GetNotifications(env: Env, limit = 50) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      const res = await env.DB.prepare('SELECT * FROM notifications ORDER BY timestamp DESC LIMIT ?').bind(limit).all();
      return res.results || [];
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const list = (await env.TRIP_KV.get('d1_fallback:notifications', 'json')) || [];
      return list.slice(0, limit);
    } catch (_) {}
  }
  return [];
}

async function d1ClearNotifications(env: Env) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare('DELETE FROM notifications').run();
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      await env.TRIP_KV.delete('d1_fallback:notifications');
    } catch (_) {}
  }
}

async function getMgClientForWebhook(env: Env, url: URL): Promise<{ client: MgIndiaClient; vin?: string } | null> {
  const token = (url.searchParams.get('token') || url.searchParams.get('key') || '').trim();
  const userId = (url.searchParams.get('userId') || url.searchParams.get('id') || '').trim();

  // 1. Try multi-user stored session in KV
  if (env.TRIP_KV) {
    let targetId = userId;
    if (!targetId && token) {
      const mappedId = await env.TRIP_KV.get(`carplay_token:${token}`, 'text');
      if (mappedId) targetId = mappedId;
    }
    if (targetId) {
      const raw = await env.TRIP_KV.get(`u:${targetId}`, 'text');
      if (raw) {
        const u = JSON.parse(raw);
        if (u.mg?.token && u.mg?.uid) {
          const client = new MgIndiaClient({ phone: u.mg.phone || '9999999999', password: '', vin: u.mg.vin });
          client.uid = u.mg.uid;
          client.token = u.mg.token;
          return { client, vin: u.mg.vin };
        }
      }
    }
  }

  // Try last active session stored in D1 or KV
  try {
    const lastSession = await d1KvGet(env, 'mg_active_session');
    if (lastSession?.token && lastSession?.uid) {
      const client = new MgIndiaClient({ phone: lastSession.phone || '9999999999', password: '', vin: lastSession.vin });
      client.uid = lastSession.uid;
      client.token = lastSession.token;
      return { client, vin: lastSession.vin };
    }
  } catch (_) {}

  // 2. Try single-user environment variables (if configured in Cloudflare)
  if (env.MG_PHONE && (env.MG_PASSWORD || env.MG_PIN)) {
    const client = new MgIndiaClient({
      phone: env.MG_PHONE,
      password: env.MG_PASSWORD || '',
      vin: env.MG_VIN,
      pinHash: env.MG_PIN && /^\d{4}$/.test(env.MG_PIN) ? hashControlPin(env.MG_PIN) : undefined,
    });
    return { client, vin: env.MG_VIN };
  }

  // 3. Try query parameters (?phone=...&password=...&vin=...)
  const qPhone = url.searchParams.get('phone');
  const qPass = url.searchParams.get('password');
  const qVin = url.searchParams.get('vin');
  const qPin = url.searchParams.get('pin');
  if (qPhone && (qPass || qPin)) {
    const client = new MgIndiaClient({
      phone: qPhone,
      password: qPass || '',
      vin: qVin || undefined,
      pinHash: qPin && /^\d{4}$/.test(qPin) ? hashControlPin(qPin) : undefined,
    });
    return { client, vin: qVin || undefined };
  }

  return null;
}

async function fetchCarTelemetry(client: MgIndiaClient, vin?: string): Promise<{
  odometer: number;
  soc: number;
  lat: number | null;
  lng: number | null;
  isCharging: boolean;
  isPluggedIn: boolean;
  powerKw: number;
  rangeKm: number;
  chargeType: 'AC' | 'DC';
  status: any;
}> {
  if (vin && !client.vin) client.vin = vin;
  const status: any = await client.status(true);
  const odometer = Number(status.odometer_km ?? status.charge?.odometer_km) || 0;
  const soc = status.charge?.soc != null ? Number(status.charge.soc) : (status.fuel_level != null ? Number(status.fuel_level) : 0);
  const lat = status.gps?.latitude ?? null;
  const lng = status.gps?.longitude ?? null;
  const ch = status.charge;
  const isCharging = Boolean(ch?.is_charging);
  const isPluggedIn = Boolean(ch?.is_plugged_in || ch?.is_charging);
  const v = Number(ch?.charging_voltage) || 0;
  const a = Number(ch?.charging_current) || 0;
  const calcKw = v > 0 && a > 0 ? Number(((v * a) / 1000).toFixed(2)) : 0;
  const powerKw = calcKw > 0 ? calcKw : (isCharging ? 3.3 : 0);
  const chargeType: 'AC' | 'DC' = (powerKw > 11 || ch?.charging_type === 2) ? 'DC' : 'AC';
  const rangeKm = Number(ch?.range_km ?? status.range_km) || 0;
  return {
    odometer,
    soc,
    lat,
    lng,
    isCharging,
    isPluggedIn,
    powerKw,
    rangeKm,
    chargeType,
    status,
  };
}

// ---------------------------------------------------------------- Charging Session Tracking Helpers (Cloudflare D1)
async function d1GetActiveChargingSession(env: Env): Promise<any | null> {
  if (env.DB) {
    await initD1(env.DB);
    try {
      const row = await env.DB.prepare(
        "SELECT * FROM charging_sessions WHERE status IN ('ongoing', 'paused') ORDER BY start_time DESC LIMIT 1"
      ).first();
      if (row) return row;
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      return await env.TRIP_KV.get('d1_fallback:active_charging_session', 'json');
    } catch (_) {}
  }
  return null;
}

async function d1GetLastCompletedChargingSession(env: Env): Promise<any | null> {
  if (env.DB) {
    await initD1(env.DB);
    try {
      const row = await env.DB.prepare(
        "SELECT * FROM charging_sessions WHERE status = 'completed' ORDER BY end_time DESC LIMIT 1"
      ).first();
      if (row) return row;
    } catch (_) {}
  }
  return null;
}

async function d1GetLastCompletedTrip(env: Env): Promise<any | null> {
  if (env.DB) {
    await initD1(env.DB);
    try {
      const row = await env.DB.prepare(
        "SELECT * FROM trips WHERE status = 'completed' ORDER BY end_timestamp DESC LIMIT 1"
      ).first();
      if (row) return row;
    } catch (_) {}
  }
  return null;
}

async function d1CreateChargingSession(env: Env, session: any) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare(`
        INSERT INTO charging_sessions (
          id, status, start_time, end_time, start_soc, end_soc,
          soc_added, kwh_added, energy_used_kwh, charging_loss_kwh,
          charge_type, peak_power_kw, last_power_kw, start_odometer_km,
          start_range_km, outage_count, paused_at, active_duration_seconds,
          last_poll_time, date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        session.id, session.status, session.start_time, session.end_time || null,
        session.start_soc, session.end_soc || session.start_soc,
        session.soc_added || 0, session.kwh_added || 0,
        session.energy_used_kwh || 0, session.charging_loss_kwh || 0,
        session.charge_type || 'AC', session.peak_power_kw || 0,
        session.last_power_kw || 0, session.start_odometer_km || 0,
        session.start_range_km || 0, session.outage_count || 0,
        session.paused_at || null, session.active_duration_seconds || 0,
        session.last_poll_time || session.start_time, session.date
      ).run();
    } catch (err) {
      console.warn('d1CreateChargingSession error:', err);
    }
  }
  if (env.TRIP_KV) {
    try {
      await env.TRIP_KV.put('d1_fallback:active_charging_session', JSON.stringify(session));
    } catch (_) {}
  }
}

async function d1UpdateChargingSession(env: Env, sessionId: string, updates: any) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare(`
        UPDATE charging_sessions SET
          status = ?,
          end_time = ?,
          end_soc = ?,
          soc_added = ?,
          kwh_added = ?,
          energy_used_kwh = ?,
          charging_loss_kwh = ?,
          charge_type = ?,
          peak_power_kw = ?,
          last_power_kw = ?,
          outage_count = ?,
          paused_at = ?,
          active_duration_seconds = ?,
          last_poll_time = ?
        WHERE id = ?
      `).bind(
        updates.status, updates.end_time || null, updates.end_soc,
        updates.soc_added || 0, updates.kwh_added || 0,
        updates.energy_used_kwh || 0, updates.charging_loss_kwh || 0,
        updates.charge_type || 'AC', updates.peak_power_kw || 0,
        updates.last_power_kw || 0, updates.outage_count || 0,
        updates.paused_at || null, updates.active_duration_seconds || 0,
        updates.last_poll_time || Math.floor(Date.now() / 1000),
        sessionId
      ).run();
    } catch (err) {
      console.warn('d1UpdateChargingSession error:', err);
    }
  }
  if (env.TRIP_KV) {
    try {
      if (updates.status === 'completed') {
        await env.TRIP_KV.delete('d1_fallback:active_charging_session');
      } else {
        const active = (await env.TRIP_KV.get('d1_fallback:active_charging_session', 'json')) || {};
        await env.TRIP_KV.put('d1_fallback:active_charging_session', JSON.stringify({ ...active, ...updates }));
      }
    } catch (_) {}
  }
}

async function d1DeleteChargingSession(env: Env, sessionId: string) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare('DELETE FROM charging_sessions WHERE id = ?').bind(sessionId).run();
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      await env.TRIP_KV.delete('d1_fallback:active_charging_session');
    } catch (_) {}
  }
}

async function d1GetChargingHistory(env: Env, limit = 50) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      const res = await env.DB.prepare(
        'SELECT * FROM charging_sessions ORDER BY start_time DESC LIMIT ?'
      ).bind(limit).all();
      return res.results || [];
    } catch (_) {}
  }
  return [];
}

async function d1ClearChargingHistory(env: Env) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare('DELETE FROM charging_sessions').run();
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      await env.TRIP_KV.delete('d1_fallback:active_charging_session');
    } catch (_) {}
  }
}

// ---------------------------------------------------------------- Core 10-Scenario State Machine
async function syncChargingSessionState(
  env: Env,
  url: URL,
  liveTelem: any,
  triggerSource: string = 'poll'
): Promise<any> {
  const activeSession = await d1GetActiveChargingSession(env);
  const nowSec = Math.floor(Date.now() / 1000);

  // If no active charging session in D1
  if (!activeSession) {
    if (!liveTelem.isCharging) {
      return null;
    }

    // SCENARIO 4 RESUMPTION: Check if this is a resumption of a session that ended < 6h ago at exact same odo
    const lastSession = await d1GetLastCompletedChargingSession(env);
    if (
      lastSession &&
      lastSession.end_time &&
      (nowSec - Number(lastSession.end_time) < 21600) &&
      (Math.abs(liveTelem.odometer - Number(lastSession.start_odometer_km)) < 0.2)
    ) {
      const updates = {
        status: 'ongoing',
        end_time: null,
        last_power_kw: liveTelem.powerKw,
        peak_power_kw: Math.max(Number(lastSession.peak_power_kw) || 0, liveTelem.powerKw),
        last_poll_time: nowSec,
      };
      await d1UpdateChargingSession(env, lastSession.id, updates);
      return { ...lastSession, ...updates };
    }

    // SCENARIO 1 & 2: Start brand new charging session
    // Strictly isolate from trip logic: read-only check on lastTrip.end_soc and end_odometer_km
    const lastTrip = await d1GetLastCompletedTrip(env);
    let startSoc = liveTelem.soc;
    if (
      lastTrip &&
      lastTrip.end_soc != null &&
      Math.abs(liveTelem.odometer - (Number(lastTrip.end_odometer_km) || liveTelem.odometer)) < 0.3
    ) {
      startSoc = Math.min(liveTelem.soc, Number(lastTrip.end_soc));
    }

    const chargeType: 'AC' | 'DC' = (liveTelem.powerKw > 11 || liveTelem.chargeType === 'DC') ? 'DC' : 'AC';
    const newSession = {
      id: 'chg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      status: 'ongoing',
      start_time: nowSec,
      end_time: null,
      start_soc: startSoc,
      end_soc: liveTelem.soc,
      soc_added: Math.max(0, liveTelem.soc - startSoc),
      kwh_added: Number((((Math.max(0, liveTelem.soc - startSoc)) / 100) * 38.0).toFixed(2)),
      energy_used_kwh: 0,
      charging_loss_kwh: 0,
      charge_type: chargeType,
      peak_power_kw: liveTelem.powerKw,
      last_power_kw: liveTelem.powerKw,
      start_odometer_km: liveTelem.odometer,
      start_range_km: liveTelem.rangeKm,
      outage_count: 0,
      paused_at: null,
      active_duration_seconds: 0,
      last_poll_time: nowSec,
      date: istDateString(nowSec),
    };

    await d1CreateChargingSession(env, newSession);

    // NOTIFICATIONS ENGINE: Charging Started
    const title = `⚡ Charging Started (${chargeType})`;
    const body = `Started at ${startSoc}% (${liveTelem.rangeKm} km) • Drawing ${liveTelem.powerKw} kW`;
    await dispatchTripNotification(url, title, body, 'electric_plug,zap', env);
    await d1InsertNotification(env, {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'charge_start',
      title,
      message: body,
      timestamp: nowSec,
      date: istDateString(nowSec),
      is_read: 0,
      metadata: JSON.stringify(newSession),
    });

    return newSession;
  }

  // Active session exists (either 'ongoing' or 'paused')
  const startOdo = Number(activeSession.start_odometer_km) || liveTelem.odometer;
  const odoDiff = Math.max(0, Number((liveTelem.odometer - startOdo).toFixed(1)));
  const startSoc = Number(activeSession.start_soc) || 0;
  // SCENARIO 9: Cabin Pre-Cooling (preserve peak SoC)
  const currentSoc = Math.max(liveTelem.soc, Number(activeSession.end_soc) || startSoc);

  // SCENARIO 5: Car drove away (live.odo > start_odo) OR CarPlay trip started OR test_end
  if (odoDiff >= 0.2 || triggerSource === 'trip_start' || triggerSource === 'test_end') {
    const activeSec = Number(activeSession.active_duration_seconds) || 0;
    const socAdded = Math.max(0, currentSoc - startSoc);

    // SCENARIO 8: False Trigger / Brief Plug Test (< 1% added & active_duration < 180s)
    if (triggerSource !== 'test_end' && socAdded <= 0 && activeSec < 180) {
      await d1DeleteChargingSession(env, activeSession.id);
      return null; // Suppress notification and remove noise row
    }

    // Energy Calculation Engine
    const kwhAdded = Number(((socAdded / 100) * 38.0).toFixed(2));
    const effFactor = (activeSession.charge_type === 'DC' || Number(activeSession.peak_power_kw) > 11) ? 0.94 : 0.88;
    const grossEnergyUsed = Math.max(Number(activeSession.energy_used_kwh) || 0, Number((kwhAdded / effFactor).toFixed(2)));
    const lossKwh = Math.max(0, Number((grossEnergyUsed - kwhAdded).toFixed(2)));
    const durationMin = Math.round(activeSec / 60);

    const completedUpdates = {
      status: 'completed',
      end_time: nowSec,
      end_soc: currentSoc,
      soc_added: socAdded,
      kwh_added: kwhAdded,
      energy_used_kwh: grossEnergyUsed,
      charging_loss_kwh: lossKwh,
      last_power_kw: 0,
      last_poll_time: nowSec,
    };
    await d1UpdateChargingSession(env, activeSession.id, completedUpdates);

    // NOTIFICATIONS ENGINE: Charging Completed
    const title = `🔋 Charging Completed (${currentSoc}%)`;
    const body = `Added +${socAdded}% (+${kwhAdded} kWh) • Used ${grossEnergyUsed} kWh • ${durationMin}m`;
    await dispatchTripNotification(url, title, body, 'battery,white_check_mark', env);
    await d1InsertNotification(env, {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'charge_end',
      title,
      message: body,
      timestamp: nowSec,
      date: istDateString(nowSec),
      is_read: 0,
      metadata: JSON.stringify({ ...activeSession, ...completedUpdates }),
    });

    return { ...activeSession, ...completedUpdates };
  }

  // SCENARIO 6: Full Charge Auto-Shutoff (100% or >=99% & charger stopped)
  if (!liveTelem.isCharging && currentSoc >= 99) {
    const activeSec = Number(activeSession.active_duration_seconds) || 0;
    const endSoc = 100;
    const socAdded = Math.max(0, endSoc - startSoc);
    const kwhAdded = Number(((socAdded / 100) * 38.0).toFixed(2));
    const effFactor = (activeSession.charge_type === 'DC' || Number(activeSession.peak_power_kw) > 11) ? 0.94 : 0.88;
    const grossEnergyUsed = Math.max(Number(activeSession.energy_used_kwh) || 0, Number((kwhAdded / effFactor).toFixed(2)));
    const lossKwh = Math.max(0, Number((grossEnergyUsed - kwhAdded).toFixed(2)));
    const durationMin = Math.round(activeSec / 60);

    const completedUpdates = {
      status: 'completed',
      end_time: nowSec,
      end_soc: endSoc,
      soc_added: socAdded,
      kwh_added: kwhAdded,
      energy_used_kwh: grossEnergyUsed,
      charging_loss_kwh: lossKwh,
      last_power_kw: 0,
      last_poll_time: nowSec,
    };
    await d1UpdateChargingSession(env, activeSession.id, completedUpdates);

    // NOTIFICATIONS ENGINE: Full Charge (100%)
    const title = `🔋 Charging Complete (100%)`;
    const body = `Full charge reached! Added +${socAdded}% (+${kwhAdded} kWh) • Used ${grossEnergyUsed} kWh • ${durationMin}m`;
    await dispatchTripNotification(url, title, body, 'battery,sparkles', env);
    await d1InsertNotification(env, {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'charge_end',
      title,
      message: body,
      timestamp: nowSec,
      date: istDateString(nowSec),
      is_read: 0,
      metadata: JSON.stringify({ ...activeSession, ...completedUpdates }),
    });

    return { ...activeSession, ...completedUpdates };
  }

  // SCENARIO 3: Mid-Charge Grid Power Outage / Breaker Cut
  if (!liveTelem.isCharging && currentSoc < 99) {
    if (activeSession.status === 'ongoing') {
      const updates = {
        status: 'paused',
        paused_at: nowSec,
        last_power_kw: 0,
        last_poll_time: nowSec,
      };
      await d1UpdateChargingSession(env, activeSession.id, updates);

      const pauseTitle = '⚠️ Charging Paused (Grid Outage / Breaker Cut)';
      const pauseBody = `Grid power dropped at ${currentSoc}%. Waiting for power to restore...`;
      await dispatchTripNotification(url, pauseTitle, pauseBody, 'warning,electric_plug', env);
      await d1InsertNotification(env, {
        id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        type: 'charge_paused',
        title: pauseTitle,
        message: pauseBody,
        timestamp: nowSec,
        date: istDateString(nowSec),
        is_read: 0,
        metadata: JSON.stringify({ ...activeSession, ...updates }),
      });

      return { ...activeSession, ...updates };
    } else if (activeSession.status === 'paused') {
      const pausedSec = nowSec - (Number(activeSession.paused_at) || nowSec);
      if (pausedSec > 28800) { // Paused > 8 hours -> finalize
        const activeSec = Number(activeSession.active_duration_seconds) || 0;
        const socAdded = Math.max(0, currentSoc - startSoc);
        const kwhAdded = Number(((socAdded / 100) * 38.0).toFixed(2));
        const effFactor = (activeSession.charge_type === 'DC') ? 0.94 : 0.88;
        const grossEnergyUsed = Math.max(Number(activeSession.energy_used_kwh) || 0, Number((kwhAdded / effFactor).toFixed(2)));
        const lossKwh = Math.max(0, Number((grossEnergyUsed - kwhAdded).toFixed(2)));
        const updates = {
          status: 'completed',
          end_time: activeSession.paused_at || nowSec,
          end_soc: currentSoc,
          soc_added: socAdded,
          kwh_added: kwhAdded,
          energy_used_kwh: grossEnergyUsed,
          charging_loss_kwh: lossKwh,
          last_poll_time: nowSec,
        };
        await d1UpdateChargingSession(env, activeSession.id, updates);
        return { ...activeSession, ...updates };
      }
    }
    return activeSession;
  }

  // SCENARIOS 3 (restored), 4 (solar/fluctuating), 7 (DC fast charge)
  if (liveTelem.isCharging) {
    let outageCount = Number(activeSession.outage_count) || 0;
    const wasPaused = activeSession.status === 'paused';
    if (wasPaused) {
      outageCount += 1;
    }

    const lastPoll = Number(activeSession.last_poll_time) || nowSec;
    const deltaSec = Math.max(0, Math.min(3600, nowSec - lastPoll));
    const activeSec = (Number(activeSession.active_duration_seconds) || 0) + (activeSession.status === 'ongoing' ? deltaSec : 0);
    const deltaHours = deltaSec / 3600;
    const stepKwh = liveTelem.powerKw * deltaHours;
    const integratedKwh = Number(((Number(activeSession.energy_used_kwh) || 0) + stepKwh).toFixed(3));
    const socAdded = Math.max(0, currentSoc - startSoc);
    const kwhAdded = Number(((socAdded / 100) * 38.0).toFixed(2));
    const effFactor = (activeSession.charge_type === 'DC' || liveTelem.powerKw > 11) ? 0.94 : 0.88;
    const grossEnergyUsed = Math.max(integratedKwh, Number((kwhAdded / effFactor).toFixed(2)));
    const lossKwh = Math.max(0, Number((grossEnergyUsed - kwhAdded).toFixed(2)));
    const peakKw = Math.max(Number(activeSession.peak_power_kw) || 0, liveTelem.powerKw);
    const chargeType = (peakKw > 11 || liveTelem.chargeType === 'DC') ? 'DC' : 'AC';

    const updates = {
      status: 'ongoing',
      end_soc: currentSoc,
      soc_added: socAdded,
      kwh_added: kwhAdded,
      energy_used_kwh: grossEnergyUsed,
      charging_loss_kwh: lossKwh,
      peak_power_kw: peakKw,
      last_power_kw: liveTelem.powerKw,
      charge_type: chargeType,
      active_duration_seconds: activeSec,
      outage_count: outageCount,
      paused_at: null,
      last_poll_time: nowSec,
    };
    await d1UpdateChargingSession(env, activeSession.id, updates);

    if (wasPaused) {
      const resumeTitle = `⚡ Charging Resumed (${chargeType})`;
      const resumeBody = `Grid power restored! Charging continuing at ${currentSoc}% • Drawing ${liveTelem.powerKw} kW`;
      await dispatchTripNotification(url, resumeTitle, resumeBody, 'electric_plug,zap', env);
      await d1InsertNotification(env, {
        id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        type: 'charge_resumed',
        title: resumeTitle,
        message: resumeBody,
        timestamp: nowSec,
        date: istDateString(nowSec),
        is_read: 0,
        metadata: JSON.stringify({ ...activeSession, ...updates }),
      });
    }

    return { ...activeSession, ...updates };
  }

  return activeSession;
}

async function handleApi(env: Env, request: Request, url: URL): Promise<Response> {
  const path = url.pathname;
  if (path.startsWith('/api/push') || path.startsWith('/api/widget')) {
    return json({ success: false, message: 'Push notifications and widgets disabled' });
  }

  // Diagnostic Endpoint to verify Cloudflare D1 Database & Bindings
  if (path === '/api/diagnostic' || path === '/api/health') {
    let dbStatus = 'missing';
    let dbError: string | null = null;
    let tables: string[] = [];
    if (env.DB) {
      try {
        await initD1(env.DB);
        const res: any = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        tables = (res?.results || []).map((r: any) => r.name);
        dbStatus = 'connected';
      } catch (e: any) {
        dbStatus = 'error';
        dbError = e?.message || String(e);
      }
    }
    return json({
      status: 'ok',
      hasDB: Boolean(env.DB),
      hasKV: Boolean(env.TRIP_KV),
      dbStatus,
      dbError,
      initErrors: d1InitErrors,
      tables,
      hasPhone: Boolean(env.MG_PHONE),
      hasVin: Boolean(env.MG_VIN),
      time: new Date().toISOString(),
    });
  }

  let body: any = null;
  if (request.method === 'POST') {
    try {
      body = await request.json();
    } catch (_) {}
  }

  // ----------------------------------------------------------- Apple CarPlay & Cloudflare D1 Endpoints
  // Start Trip (CarPlay Connects trigger)
  if (path === '/api/trip/start') {
    const mg = await getMgClientForWebhook(env, url);
    if (!mg) {
      return json({ success: false, error: 'MG vehicle session not found. Please log in from the web app first.' }, 400);
    }
    try {
      const telem = await fetchCarTelemetry(mg.client, mg.vin);
      const startLocation = await resolveLocation(telem.lat, telem.lng);
      const nowSec = Math.floor(Date.now() / 1000);
      const tripId = 'trip_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      const dateStr = istDateString(nowSec);

      const trip = {
        id: tripId,
        date: dateStr,
        start_timestamp: nowSec,
        start_odometer_km: telem.odometer,
        start_soc: telem.soc,
        start_location: startLocation,
        status: 'ongoing',
      };

      await d1InsertTrip(env, trip);

      // SCENARIO 5: Car unplugged early and driven away -> finalize any ongoing/paused charging session
      try {
        await syncChargingSessionState(env, url, telem, 'trip_start');
      } catch (_) {}

      const title = '🚗 MG Windsor EV • Trip Started';
      const notificationText = [
        '🟢 Trip recording actively started in Cloudflare D1.',
        `⏱️ Started: ${formatClockTime(nowSec)}`,
        `🔋 Battery: ${trip.start_soc}% SOC`,
        `🛣️ Start Odometer: ${trip.start_odometer_km.toLocaleString()} km`,
        trip.start_location && trip.start_location !== 'Unknown Location' ? `📍 Start: ${trip.start_location}` : null,
      ].filter(Boolean).join('\n');

      await dispatchTripNotification(url, title, notificationText, 'car,electric_plug', env);
      await d1InsertNotification(env, {
        id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        type: 'trip_start',
        title,
        message: notificationText,
        timestamp: nowSec,
        date: dateStr,
        metadata: JSON.stringify(trip),
      });

      if (url.searchParams.get('format') === 'json') {
        return json({
          success: true,
          title,
          notification: notificationText,
          message: 'Trip started successfully via CarPlay connection',
          trip,
        });
      }

      return new Response(`${title}\n\n${notificationText}`, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS },
      });
    } catch (err) {
      const errMsg = `❌ Trip Start Error: ${(err as Error).message}`;
      if (url.searchParams.get('format') === 'json') {
        return json({ success: false, error: (err as Error).message }, 500);
      }
      return new Response(errMsg, { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS }, status: 200 });
    }
  }

  // Stop Trip (CarPlay Disconnects trigger)
  if (path === '/api/trip/stop') {
    const ongoingTrip = await d1GetActiveTrip(env);
    if (!ongoingTrip) {
      const emptyTitle = 'ℹ️ MG Windsor EV • No Active Trip';
      const emptyMsg = 'No ongoing trip was recorded in Cloudflare D1 to stop.\n(Make sure CarPlay Connects ran first, and D1 database is bound).';
      if (url.searchParams.get('format') === 'json') {
        return json({ success: false, title: emptyTitle, notification: emptyMsg, message: emptyMsg }, 200);
      }
      return new Response(`${emptyTitle}\n\n${emptyMsg}`, { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS }, status: 200 });
    }

    const mg = await getMgClientForWebhook(env, url);
    let telem: any = null;
    if (mg) {
      telem = await fetchCarTelemetry(mg.client, mg.vin).catch(() => null);
    }

    const startOdo = Number(ongoingTrip.start_odometer_km) || 0;
    let finalOdo = Number(telem?.odometer) || startOdo;
    const startTimestamp = Number(ongoingTrip.start_timestamp) || Math.floor(Date.now() / 1000);
    const nowSec = Math.floor(Date.now() / 1000);
    const durationSec = Math.max(0, nowSec - startTimestamp);

    // Buffer check: If finalOdo < startOdo or (finalOdo == startOdo and duration > 60s), wait 2.5s and re-fetch once
    if (mg && (finalOdo < startOdo || (finalOdo === startOdo && durationSec > 60))) {
      await new Promise((r) => setTimeout(r, 2500));
      try {
        const refreshed = await fetchCarTelemetry(mg.client, mg.vin);
        if (refreshed && Number(refreshed.odometer) >= startOdo) {
          telem = refreshed;
          finalOdo = Number(refreshed.odometer);
        }
      } catch (_) {}
    }

    if (finalOdo < startOdo) {
      finalOdo = startOdo;
    }

    const distanceKm = Math.max(0, Number((finalOdo - startOdo).toFixed(1)));
    const endSoc = telem?.soc != null ? Number(telem.soc) : (Number(ongoingTrip.start_soc) || 0);
    const startSoc = Number(ongoingTrip.start_soc) || endSoc;
    const socDiff = Math.max(0, startSoc - endSoc);

    // Stationary / Idle Session Detection:
    // If the car didn't actually drive (< 0.2 km, e.g. sitting in car for 5 mins in driveway),
    // remove the ongoing trip from D1/KV so trip history stays clean, and notify user accordingly.
    if (distanceKm < 0.2) {
      if (env.DB) {
        await env.DB.prepare('DELETE FROM trips WHERE id = ?').bind(ongoingTrip.id).run().catch(() => {});
      }
      if (env.TRIP_KV) {
        await env.TRIP_KV.delete('d1_fallback:active_trip').catch(() => {});
        try {
          const trips = (await env.TRIP_KV.get('d1_fallback:trips', 'json')) || [];
          await env.TRIP_KV.put('d1_fallback:trips', JSON.stringify(trips.filter((t: any) => t.id !== ongoingTrip.id)));
        } catch (_) {}
      }

      const idleTitle = 'ℹ️ MG Windsor EV • Stationary (No Trip Logged)';
      const idleText = [
        'ℹ️ Vehicle was stationary (0.0 km driven).',
        `⏱️ Time in car: ${formatDurationSec(durationSec)} (${formatClockTime(startTimestamp)} → ${formatClockTime(nowSec)})`,
        `🔋 Battery: ${startSoc}% → ${endSoc}%`,
        '🧹 Cancelled recording to keep your driving history clean.',
      ].join('\n');

      await dispatchTripNotification(url, idleTitle, idleText, 'information_source', env);
      await d1InsertNotification(env, {
        id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        type: 'trip_idle',
        title: idleTitle,
        message: idleText,
        timestamp: nowSec,
        date: istDateString(nowSec),
        metadata: JSON.stringify({ durationSec, startSoc, endSoc }),
      });

      if (url.searchParams.get('format') === 'json') {
        return json({
          success: true,
          title: idleTitle,
          notification: idleText,
          message: 'No drive detected (0.0 km). Stationary session cancelled.',
          cancelled: true,
        });
      }

      return new Response(`${idleTitle}\n\n${idleText}`, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS },
      });
    }

    const energyUsedKwh = Number(((socDiff / 100) * 38).toFixed(2));
    const efficiencyKmPerKwh = energyUsedKwh > 0 && distanceKm > 0 ? Number((distanceKm / energyUsedKwh).toFixed(2)) : 0;
    const endLocation = await resolveLocation(telem?.lat, telem?.lng);
    const avgSpeedKmh = durationSec > 0 && distanceKm > 0 ? Number(((distanceKm / (durationSec / 3600))).toFixed(1)) : 0;

    const updates = {
      end_timestamp: nowSec,
      duration_seconds: durationSec,
      distance_km: distanceKm,
      end_odometer_km: finalOdo,
      end_soc: endSoc,
      energy_used_kwh: energyUsedKwh,
      efficiency_km_per_kwh: efficiencyKmPerKwh,
      end_location: endLocation,
      avg_speed_kmh: avgSpeedKmh,
      status: 'completed',
    };

    await d1UpdateTrip(env, ongoingTrip.id, updates);

    // SCENARIO 1: Immediate Plug-In After Trip (Strictly isolated: trip row already saved above)
    if (telem?.isCharging) {
      try {
        await syncChargingSessionState(env, url, telem, 'trip_stop');
      } catch (_) {}
    }

    const title = '✅ MG Windsor EV • Trip Completed';
    const notificationText = [
      '✅ Trip completed & safely logged in Cloudflare D1.',
      '',
      `🛣️ Distance Travelled: ${distanceKm} km`,
      `⏱️ Time Taken: ${formatDurationSec(durationSec)} (${formatClockTime(startTimestamp)} → ${formatClockTime(nowSec)})`,
      `🔋 Battery: ${startSoc}% → ${endSoc}% (${socDiff > 0 ? `-${socDiff}%` : '0%'})`,
      `⚡ Energy Used: ${energyUsedKwh} kWh`,
      `🌱 Efficiency: ${efficiencyKmPerKwh > 0 ? `${efficiencyKmPerKwh} km/kWh` : 'N/A'}`,
      ongoingTrip.start_location && endLocation && ongoingTrip.start_location !== 'Unknown Location'
        ? `📍 Route: ${ongoingTrip.start_location} → ${endLocation}`
        : (endLocation && endLocation !== 'Unknown Location' ? `📍 Destination: ${endLocation}` : null),
      `🏁 Final Odometer: ${finalOdo.toLocaleString()} km`,
    ].filter(Boolean).join('\n');

    await dispatchTripNotification(url, title, notificationText, 'white_check_mark,trophy', env);
    await d1InsertNotification(env, {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'trip_stop',
      title,
      message: notificationText,
      timestamp: nowSec,
      date: istDateString(nowSec),
      metadata: JSON.stringify(updates),
    });

    if (url.searchParams.get('format') === 'json') {
      return json({
        success: true,
        title,
        notification: notificationText,
        message: 'Trip stopped and logged into Cloudflare D1',
        trip: { ...ongoingTrip, ...updates },
      });
    }

    return new Response(`${title}\n\n${notificationText}`, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS },
    });
  }

  // Get Trips for UI (by date or all)
  if (path === '/api/trips') {
    const date = url.searchParams.get('date');
    const trips = await d1GetTrips(env, date);
    return json({ success: true, trips });
  }

  // Batch Sync Trips from Local App to D1
  if (path === '/api/trips/sync') {
    const rawTrips = body?.trips || [];
    const count = await d1BatchSyncTrips(env, rawTrips);
    return json({ success: true, count, message: `Synced ${count} trip(s) to Cloudflare D1` });
  }

  // Delete Trip from D1
  if (path === '/api/trips/delete') {
    const tripId = body?.id || url.searchParams.get('id');
    if (!tripId) return json({ success: false, error: 'trip id required' }, 400);
    await d1DeleteTrip(env, tripId);
    return json({ success: true, message: 'Trip deleted from Cloudflare D1' });
  }

  // Clear all Trips from D1
  if (path === '/api/trips/clear') {
    await d1ClearTrips(env);
    return json({ success: true, message: 'All trips permanently cleared from Cloudflare D1' });
  }

  // Get Trip Distinct Dates for Calendar Picker
  if (path === '/api/trip/dates') {
    const dates = await d1GetTripDates(env);
    return json({ success: true, dates });
  }

  // Start Charging
  if (path === '/api/charge/start') {
    const mg = await getMgClientForWebhook(env, url);
    let telem: any = null;
    if (mg) {
      telem = await fetchCarTelemetry(mg.client, mg.vin).catch(() => null);
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const chargeId = 'chg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const dateStr = istDateString(nowSec);
    const charge = {
      id: chargeId,
      date: dateStr,
      start_timestamp: nowSec,
      start_soc: telem?.soc != null ? Number(telem.soc) : 0,
      charger_type: 'AC Fast',
      peak_kw: 3.3,
      odometer_km: telem?.odometer || 0,
      status: 'charging',
    };
    await d1InsertCharge(env, charge);
    return json({ success: true, message: 'Charging session started', charge });
  }

  // Stop Charging
  if (path === '/api/charge/stop') {
    const ongoingCharge = await d1GetActiveCharge(env);
    if (!ongoingCharge) {
      return json({ success: false, message: 'No active charging session found to stop' }, 404);
    }
    const mg = await getMgClientForWebhook(env, url);
    let telem: any = null;
    if (mg) {
      telem = await fetchCarTelemetry(mg.client, mg.vin).catch(() => null);
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const startTimestamp = Number(ongoingCharge.start_timestamp) || nowSec;
    const durationSec = Math.max(0, nowSec - startTimestamp);
    const endSoc = telem?.soc != null ? Number(telem.soc) : (Number(ongoingCharge.start_soc) || 0);
    const startSoc = Number(ongoingCharge.start_soc) || endSoc;
    const addedSoc = Math.max(0, endSoc - startSoc);
    const energyAddedKwh = Number(((addedSoc / 100) * 38).toFixed(2));

    const updates = {
      end_timestamp: nowSec,
      duration_seconds: durationSec,
      end_soc: endSoc,
      energy_added_kwh: energyAddedKwh,
      odometer_km: Number(telem?.odometer) || Number(ongoingCharge.odometer_km) || 0,
      status: 'completed',
    };
    await d1UpdateCharge(env, ongoingCharge.id, updates);
    return json({ success: true, message: 'Charging session completed', charge: { ...ongoingCharge, ...updates } });
  }

  // Get Notifications from D1
  if (path === '/api/notifications') {
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const notifs = await d1GetNotifications(env, limit);
    return json({ success: true, notifications: notifs });
  }

  // Test Notification insert to verify D1 Studio saving
  if (path === '/api/notifications/test') {
    const nowSec = Math.floor(Date.now() / 1000);
    const notif = {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      type: 'test',
      title: '🧪 MG Windsor EV • Test Notification',
      message: `Verified D1 Studio insertion at ${formatClockTime(nowSec)}. System is fully operational!`,
      timestamp: nowSec,
      date: istDateString(nowSec),
      is_read: 0,
      metadata: JSON.stringify({ test: true, time: new Date().toISOString() }),
    };
    await d1InsertNotification(env, notif);
    const notifs = await d1GetNotifications(env, 10);
    return json({ success: true, message: 'Test notification written to D1', count: notifs.length, notification: notif, recent: notifs });
  }

  // Clear Notifications from D1
  if (path === '/api/notifications/clear') {
    await d1ClearNotifications(env);
    return json({ success: true, message: 'Notification history cleared' });
  }

  // ----------------------------------------------------------- PWA Charging History Screen & Instant D1 Refresh Flow
  if (path === '/api/charging-history') {
    const isRefresh = url.searchParams.get('refresh') === 'true';
    if (isRefresh) {
      const activeSession = await d1GetActiveChargingSession(env);
      if (activeSession) {
        try {
          const mg = await getMgClientForWebhook(env, url);
          if (mg) {
            const telem = await fetchCarTelemetry(mg.client, mg.vin);
            await syncChargingSessionState(env, url, telem, 'user_refresh');
          }
        } catch (_) {}
      }
    }
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const sessions = await d1GetChargingHistory(env, limit);
    return json({ success: true, sessions, charges: sessions });
  }

  // Clear Charging History
  if (path === '/api/charging-history/clear') {
    await d1ClearChargingHistory(env);
    await d1ClearCharges(env).catch(() => {});
    return json({ success: true, message: 'All charging sessions permanently cleared from Cloudflare D1' });
  }

  // Get active session status directly for PWA banner
  if (path === '/api/charging/active') {
    const active = await d1GetActiveChargingSession(env);
    return json({ success: true, activeSession: active });
  }

  // TEST ENDPOINT: Start simulated charging session in D1
  if (path === '/api/charging/test-start') {
    const qSoc = Number(url.searchParams.get('soc')) || 80;
    const qKw = Number(url.searchParams.get('power')) || 3.3;
    const dummyTelem = {
      odometer: 38598.9,
      soc: qSoc,
      lat: 10.05,
      lng: 76.62,
      isCharging: true,
      isPluggedIn: true,
      powerKw: qKw,
      chargeType: qKw > 11 ? 'DC' : 'AC',
      rangeKm: Math.round((qSoc / 100) * 331),
    };
    const session = await syncChargingSessionState(env, url, dummyTelem, 'test_start');
    return json({
      success: true,
      message: '⚡ Test charging session started in Cloudflare D1!',
      session,
      instructions: 'Check your D1 charging_sessions & notifications tables, or PWA Charging tab. Then run /api/charging/test-end to complete it.',
    });
  }

  // TEST ENDPOINT: End simulated charging session in D1
  if (path === '/api/charging/test-end') {
    const active = await d1GetActiveChargingSession(env);
    if (!active) {
      return json({
        success: false,
        message: 'No active ongoing charging session found in D1. Run /api/charging/test-start first!',
      }, 400);
    }
    const startSoc = Number(active.start_soc) || 80;
    const qSoc = Number(url.searchParams.get('soc')) || Math.min(100, startSoc + 8);
    const dummyTelem = {
      odometer: Number(active.start_odometer_km) || 38598.9,
      soc: qSoc,
      lat: 10.05,
      lng: 76.62,
      isCharging: false,
      isPluggedIn: false,
      powerKw: 0,
      chargeType: active.charge_type || 'AC',
      rangeKm: Math.round((qSoc / 100) * 331),
    };
    // Advance active duration by 45 minutes for realistic energy math
    const fakeDeltaSec = 2700;
    active.active_duration_seconds = (Number(active.active_duration_seconds) || 0) + fakeDeltaSec;
    await d1UpdateChargingSession(env, active.id, { active_duration_seconds: active.active_duration_seconds });

    const session = await syncChargingSessionState(env, url, dummyTelem, 'test_end');
    return json({
      success: true,
      message: '🔋 Test charging session completed and saved to D1!',
      session,
      metrics: {
        startSoc: `${startSoc}%`,
        endSoc: `${qSoc}%`,
        socAdded: `+${session?.soc_added}%`,
        kwhAdded: `+${session?.kwh_added} kWh`,
        energyUsedKwh: `${session?.energy_used_kwh} kWh`,
        chargingLossKwh: `${session?.charging_loss_kwh} kWh`,
      },
    });
  }

  // Get Charges for UI (by date or all)
  if (path === '/api/charges') {
    const date = url.searchParams.get('date');
    const sessions = await d1GetChargingHistory(env, 100);
    if (sessions && sessions.length > 0) {
      return json({ success: true, charges: sessions, sessions });
    }
    const charges = await d1GetCharges(env, date);
    return json({ success: true, charges, sessions: charges });
  }

  // Batch Sync Charges from Local App to D1
  if (path === '/api/charges/sync') {
    const rawCharges = body?.charges || [];
    const count = await d1BatchSyncCharges(env, rawCharges);
    return json({ success: true, count, message: `Synced ${count} charge(s) to Cloudflare D1` });
  }

  // Delete Charge from D1
  if (path === '/api/charges/delete') {
    const chargeId = body?.id || url.searchParams.get('id');
    if (!chargeId) return json({ success: false, error: 'charge id required' }, 400);
    await d1DeleteCharge(env, chargeId);
    return json({ success: true, message: 'Charge deleted from Cloudflare D1' });
  }

  // Clear all Charges from D1
  if (path === '/api/charges/clear') {
    await d1ClearCharges(env);
    return json({ success: true, message: 'All charges permanently cleared from Cloudflare D1' });
  }

  // Get Charge Distinct Dates for Calendar Picker
  if (path === '/api/charge/dates') {
    const dates = await d1GetChargeDates(env);
    return json({ success: true, dates });
  }

  // Register car credentials & tokens (saved to KV for CarPlay automation without passwords)
  if (path === '/api/register-car' || path === '/api/update-token') {
    if (!body?.uid || !body?.token) return json({ error: 'uid and token required' }, 400);

    await d1KvPut(env, 'mg_active_session', {
      uid: body.uid,
      token: body.token,
      vin: body.vin,
      phone: body.phone,
      updatedAt: Math.floor(Date.now() / 1000),
    });
    if (body.token) {
      await d1KvPut(env, 'carplay_token:' + body.token, body.uid || 'default');
    }

    const u = await authUser(env, url, body);
    if (u) {
      u.mg = { uid: body.uid, token: body.token, vin: body.vin || u.mg?.vin, phone: body.phone || u.mg?.phone };
      u.mgStatus = 'ok';
      u.mgFailures = 0;
      u.guardUntilSec = 0;
      await saveUser(env, u);
    }
    return json({ success: true, message: 'Car registered for CarPlay webhooks & PWA' });
  }

  const u = await authUser(env, url, body);
  if (path === '/api/status' || path === '/api/data') {
    return json({
      success: true,
      email: u.email,
      mgStatus: u.mgStatus,
      googleStatus: u.googleStatus,
      lastPollSec: u.lastPollSec || null,
      lastError: u.lastError || null,
      live: u.live || null,
      tripSheetId: u.tripSheetId,
      chargeSheetId: u.chargeSheetId,
      pushSubscriptionsCount: (u.pushSubscriptions || []).length,
      pushwardKey: u.pushwardKey || '',
      pendingRows: u.pendingTrips.length + u.pendingCharges.length,
      activeTrip: u.activeTrip,
      activeCharge: u.activeCharge,
      trips: u.trips,
      charges: u.charges,
    });
  }
  if (path === '/api/live-status' || path === '/api/live-activity') {
    // Tailored for iOS Live Activities, Live Shortcut app, Dynamic Island & Lock Screen widgets
    const isTestDriving = url.searchParams.get('test') === 'driving' || url.searchParams.get('test') === '1';
    const isTestCharging = url.searchParams.get('test') === 'charging';
    const nowSec = Math.floor(Date.now() / 1000);

    if (isTestDriving) {
      return json({
        success: true,
        state: 'Driving',
        title: 'MG Windsor EV • Driving',
        headline: '32.5 km • 9.8 km/kWh',
        battery: '91% SOC',
        range: '291 km',
        duration: '1 hr 8 min',
        speed: '48 km/h',
        efficiency: '9.8 km/kWh',
        odometer: '38,443 km',
        aux: '12.6 V',
        summary: 'MG Windsor EV: 32.5 km • 9.8 km/kWh • 91% SOC (291 km)',
      });
    }

    if (isTestCharging) {
      return json({
        success: true,
        state: 'Charging',
        title: 'MG Windsor EV • Charging',
        headline: '3.3 kW AC • 91% SOC',
        battery: '91% SOC (+21.9 kWh)',
        range: '291 km',
        duration: '2 hr 15 min',
        speed: '3.3 kW',
        efficiency: '10.4 km/kWh',
        odometer: '38,443 km',
        aux: '12.8 V',
        summary: 'MG Windsor EV: Charging at 3.3 kW • 91% SOC (291 km)',
      });
    }

    // Live state from vehicle telemetry
    if (u.activeTrip) {
      const t = u.activeTrip;
      const durSec = Math.max(60, nowSec - t.startTimestampSec);
      const curOdo = u.live?.odometerKm || t.endOdometerKm;
      const dist = Number((curOdo - t.startOdometerKm).toFixed(1));
      const durStr = fmtDur(durSec);
      const usedKwh = Math.max(0, Number((t.startEnergyKwh - (u.live?.soc ? (u.live.soc / 100) * 38 : t.endEnergyKwh)).toFixed(2)));
      const eff = dist > 0 && usedKwh > 0 ? `${(dist / usedKwh).toFixed(1)} km/kWh` : '-- km/kWh';
      const curSoc = u.live?.soc ?? t.endSoc;
      const curRange = u.live?.rangeKm ? `${u.live.rangeKm} km` : '-- km';
      const isActuallyMoving = dist >= 0.2 || (t.maxSpeedKmh && t.maxSpeedKmh > 5);

      const state = isActuallyMoving ? 'Driving' : 'Stationary';
      const title = isActuallyMoving ? 'MG Windsor EV • Driving' : 'MG Windsor EV • Ready';
      const headline = isActuallyMoving ? `${dist} km • ${eff}` : `Parked / Idle • ${curSoc}% SOC`;

      return json({
        success: true,
        state,
        title,
        headline,
        battery: `${curSoc}% SOC`,
        range: curRange,
        duration: durStr,
        speed: `${t.maxSpeedKmh || 0} km/h`,
        efficiency: eff,
        odometer: `${curOdo} km`,
        aux: u.live?.aux ? `${u.live.aux} V` : '--',
        summary: `MG Windsor EV: ${headline} • ${curSoc}% SOC (${curRange})`,
      });
    }

    if (u.activeCharge || u.live?.charging) {
      const c = u.activeCharge;
      const curSoc = u.live?.soc ?? c?.endSoc ?? 0;
      const curKw = c?.maxKw || 3.3;
      const durSec = c ? Math.max(60, nowSec - c.startTimestampSec) : 0;
      const curRange = u.live?.rangeKm ? `${u.live.rangeKm} km` : '-- km';

      return json({
        success: true,
        state: 'Charging',
        title: 'MG Windsor EV • Charging',
        headline: `${curKw} kW AC • ${curSoc}% SOC`,
        battery: `${curSoc}% SOC`,
        range: curRange,
        duration: fmtDur(durSec),
        speed: `${curKw} kW`,
        efficiency: '--',
        odometer: `${u.live?.odometerKm || '--'} km`,
        aux: u.live?.aux ? `${u.live.aux} V` : '--',
        summary: `MG Windsor EV: Charging at ${curKw} kW • ${curSoc}% SOC (${curRange})`,
      });
    }

    // Parked state
    const soc = u.live?.soc ?? (u.trips?.[0]?.endSoc || 100);
    const range = u.live?.rangeKm ? `${u.live.rangeKm} km` : '-- km';
    const odo = u.live?.odometerKm ? `${u.live.odometerKm} km` : (u.trips?.[0]?.endOdometerKm ? `${u.trips[0].endOdometerKm} km` : '-- km');
    const aux = u.live?.aux ? `${u.live.aux} V` : '--';
    const lastTrip = u.trips?.[0];
    const lastEff = lastTrip ? `${lastTrip.efficiencyKmPerKwh || lastTrip.efficiency} km/kWh` : '--';

    return json({
      success: true,
      state: 'Parked',
      title: 'MG Windsor EV • Parked',
      headline: `${soc}% SOC • ${range}`,
      battery: `${soc}% SOC`,
      range,
      duration: 'Parked',
      speed: '0 km/h',
      efficiency: lastEff,
      odometer: odo,
      aux,
      summary: `MG Windsor EV: Parked • ${soc}% SOC • ${range} DTE • ${odo}`,
    });
  }
  if (path === '/api/clean-sheets' || path === '/api/dedup-sheets') {
    if (!u) return json({ error: 'unauthorized' }, 401);
    try {
      const token = await googleAccessToken(env, u);
      const res = await cleanGoogleSheetTripsAndCharges(token, u.tripSheetId, u.chargeSheetId, u);
      await saveUser(env, u);
      return json({ success: true, ...res });
    } catch (e) {
      return json({ success: false, error: (e as Error).message }, 500);
    }
  }
  if (path === '/api/restore') {
    // Full history straight from the user's own Google Sheets (works on any new device).
    try {
      const token = await googleAccessToken(env, u);
      // Automatically clean and deduplicate the sheets during restore so data is always pristine
      await cleanGoogleSheetTripsAndCharges(token, u.tripSheetId, u.chargeSheetId, u).catch(() => {});
      const [trips, charges] = await Promise.all([
        readSheetRecords(token, u.tripSheetId),
        readSheetRecords(token, u.chargeSheetId),
      ]);
      const cleanTrips = deduplicateTripList(trips);
      const cleanCharges = deduplicateChargeList(charges);
      u.trips = cleanTrips.slice(0, 60);
      u.charges = cleanCharges.slice(0, 60);
      await saveUser(env, u);
      return json({ success: true, trips: cleanTrips, charges: cleanCharges });
    } catch (e) {
      return json({ success: false, error: (e as Error).message, trips: u.trips, charges: u.charges });
    }
  }
  if (path === '/api/sync' || path === '/api/sync-data' || path === '/api/sync-trips') {
    // App pushes newly completed trips or charging logs directly to Google Sheets
    try {
      const token = await googleAccessToken(env, u);
      if (!u.tripSheetId) {
        u.tripSheetId = await createSheet(token, 'MG Windsor EV - Trip Logs', TRIP_HEADERS);
        await saveUser(env, u);
      }
      if (!u.chargeSheetId) {
        u.chargeSheetId = await createSheet(token, 'MG Windsor EV - Charging Sessions', CHARGE_HEADERS);
        await saveUser(env, u);
      }

      let syncedTrips = 0;
      let syncedCharges = 0;

      if (Array.isArray(body.trips) && body.trips.length > 0) {
        const existingTrips = await readSheetRecords(token, u.tripSheetId).catch(() => []);
        const cleanExisting = deduplicateTripList(existingTrips);
        const incomingClean = deduplicateTripList(body.trips);

        // Filter out incoming trips that match or overlap with existing sheet trips
        const toAppend = incomingClean.filter((inc: any) => {
          return !cleanExisting.some((ex: any) => {
            if (inc.id && ex.id && String(inc.id) === String(ex.id)) return true;
            if (inc.journeyId != null && ex.journeyId != null && Number(inc.journeyId) === Number(ex.journeyId)) return true;
            const sameEndOdo = inc.endOdometerKm && ex.endOdometerKm && Math.abs(Number(inc.endOdometerKm) - Number(ex.endOdometerKm)) <= 0.25;
            const timeOverlaps = (inc.startTimestampSec || 0) <= (ex.endTimestampSec || 0) + 90 && (inc.endTimestampSec || 0) >= (ex.startTimestampSec || 0) - 90;
            if (sameEndOdo && timeOverlaps) return true;
            return false;
          });
        });

        if (toAppend.length > 0) {
          toAppend.sort((a: any, b: any) => (a.startTimestampSec || 0) - (b.startTimestampSec || 0));
          await appendRows(token, u.tripSheetId, toAppend.map(tripRow));
          syncedTrips = toAppend.length;
        }
        u.trips = deduplicateTripList([...toAppend, ...cleanExisting]).slice(0, 60);
      }

      if (Array.isArray(body.charges) && body.charges.length > 0) {
        const existingCharges = await readSheetRecords(token, u.chargeSheetId).catch(() => []);
        const cleanExisting = deduplicateChargeList(existingCharges);
        const incomingClean = deduplicateChargeList(body.charges);

        const toAppend = incomingClean.filter((inc: any) => {
          return !cleanExisting.some((ex: any) => {
            if (inc.id && ex.id && String(inc.id) === String(ex.id)) return true;
            const sameOdo = inc.odometerKm && ex.odometerKm && Math.abs(Number(inc.odometerKm) - Number(ex.odometerKm)) <= 0.2;
            const sameEndSoc = inc.endSoc != null && ex.endSoc != null && Math.abs(Number(inc.endSoc) - Number(ex.endSoc)) <= 1;
            const closeTime = Math.abs((inc.endTimestampSec || 0) - (ex.endTimestampSec || 0)) < 1800;
            if (sameOdo && sameEndSoc && closeTime) return true;
            return false;
          });
        });

        if (toAppend.length > 0) {
          toAppend.sort((a: any, b: any) => (a.startTimestampSec || 0) - (b.startTimestampSec || 0));
          await appendRows(token, u.chargeSheetId, toAppend.map(chargeRow));
          syncedCharges = toAppend.length;
        }
        u.charges = deduplicateChargeList([...toAppend, ...cleanExisting]).slice(0, 60);
      }

      if (syncedTrips > 0 || syncedCharges > 0) {
        await saveUser(env, u);
      }

      return json({ success: true, syncedTrips, syncedCharges });
    } catch (e) {
      return json({ success: false, error: (e as Error).message }, 500);
    }
  }
  if (path === '/api/push-subscribe') {
    if (!body.subscription || !body.subscription.endpoint || !body.subscription.keys) {
      return json({ error: 'subscription object with endpoint and keys required' }, 400);
    }
    if (!Array.isArray(u.pushSubscriptions)) u.pushSubscriptions = [];
    const endpoint = body.subscription.endpoint;
    u.pushSubscriptions = u.pushSubscriptions.filter((s: any) => s.endpoint !== endpoint);
    u.pushSubscriptions.push({
      endpoint,
      keys: {
        p256dh: body.subscription.keys.p256dh,
        auth: body.subscription.keys.auth,
      },
      userAgent: body.userAgent || '',
      addedSec: Math.floor(Date.now() / 1000),
    });
    if (u.pushSubscriptions.length > 10) u.pushSubscriptions = u.pushSubscriptions.slice(-10);
    await saveUser(env, u);

    // Send instant welcome notification
    await notifyUser(env, u, {
      title: '🔔 MG Windsor EV Notifications Active',
      body: 'Real-time alerts for Trips, Charging, and Low 12V Battery are now active on this device!',
      tag: 'windsor-welcome',
    });

    return json({ success: true, count: u.pushSubscriptions.length });
  }

  if (path === '/api/push-unsubscribe') {
    const endpoint = body.endpoint || url.searchParams.get('endpoint');
    if (endpoint && Array.isArray(u.pushSubscriptions)) {
      u.pushSubscriptions = u.pushSubscriptions.filter((s: any) => s.endpoint !== endpoint);
      await saveUser(env, u);
    }
    return json({ success: true });
  }

  if (path === '/api/push-test') {
    const count = Array.isArray(u.pushSubscriptions) ? u.pushSubscriptions.length : 0;
    if (count === 0) {
      return json({ success: false, error: 'No active push subscriptions registered on this account.' }, 400);
    }
    await notifyUser(env, u, {
      title: '⚡ MG Windsor EV • Test Alert',
      body: `Push notifications are working! 12V: ${u.live?.aux || '12.6'}V • SOC: ${u.live?.soc || '91'}% • Range: ${u.live?.rangeKm || '291'} km`,
      tag: 'windsor-test',
    });
    return json({ success: true, count });
  }

  if (path === '/api/delete') {
    // Wipe all stored tokens + history for this user.
    const kv = kvOrThrow(env);
    const ids: string[] = JSON.parse((await kv.get('users', 'text')) || '[]');
    await kv.put('users', JSON.stringify(ids.filter((x) => x !== u.id)));
    await kv.delete(`u:${u.id}`);
    await kv.delete(`e:${u.email}`);
    return json({ success: true });
  }
  return json({ error: 'Unknown API route' }, 404);
}

async function runCron(env: Env): Promise<void> {
  if (!env.DB && !env.TRIP_KV) return;
  const now = new Date();
  const min = now.getUTCMinutes();
  const nowSec = Math.floor(Date.now() / 1000);

  // Check if an active/paused charging session exists in D1
  const activeSession = await d1GetActiveChargingSession(env).catch(() => null);

  if (activeSession) {
    const isOngoing = activeSession.status === 'ongoing';
    const isPaused = activeSession.status === 'paused';
    const isDC = activeSession.charge_type === 'DC';

    // DC Fast Charging (Scenario 7): poll every 1-2 minutes
    // AC Charging (Scenario 1 & 4): poll every 3 minutes (min % 3 === 0)
    // Paused (Scenario 3): poll every 10 minutes (min % 10 === 0)
    let shouldPoll = false;
    if (isDC) {
      shouldPoll = true;
    } else if (isOngoing) {
      shouldPoll = (min % 3 === 0);
    } else if (isPaused) {
      shouldPoll = (min % 10 === 0);
    }

    if (shouldPoll) {
      try {
        const dummyUrl = new URL('https://mg-windsor-webhook.workers.dev');
        const mg = await getMgClientForWebhook(env, dummyUrl);
        if (mg) {
          const telem = await fetchCarTelemetry(mg.client, mg.vin);
          await syncChargingSessionState(env, dummyUrl, telem, 'cron');
        }
      } catch (_) {
        // SCENARIO 10: MG Server Timeout / Cellular drop - 0 D1 changes, never treat timeout as false!
      }
    }
    return;
  }

  // SCENARIO 2: No active session, check if car was parked < 14h ago with SoC < 100%
  // Only check at :00 and :30 (max 2 calls/hour while idle to strictly protect 12V battery!)
  if (min === 0 || min === 30) {
    try {
      const lastTrip = await d1GetLastCompletedTrip(env);
      if (lastTrip && lastTrip.end_timestamp) {
        const hoursSincePark = (nowSec - Number(lastTrip.end_timestamp)) / 3600;
        const lastSoc = Number(lastTrip.end_soc) || 100;
        if (hoursSincePark < 14 && lastSoc < 100) {
          const dummyUrl = new URL('https://mg-windsor-webhook.workers.dev');
          const mg = await getMgClientForWebhook(env, dummyUrl);
          if (mg) {
            const telem = await fetchCarTelemetry(mg.client, mg.vin);
            if (telem.isCharging) {
              await syncChargingSessionState(env, dummyUrl, telem, 'cron_idle');
            }
          }
        }
      }
    } catch (_) {
      // SCENARIO 10: Catch block exits early
    }
  }
}

export default {
  async fetch(request: Request, env: Env, ctx?: any): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      // Proxy preflights need the full MG header allow-list (APP-SIGNATURE etc.)
      if (url.searchParams.has('url')) return (mgProxy as any).fetch(request);
      return new Response(null, { status: 204, headers: CORS });
    }

    // Intercept legacy cron-job.org / manual polling to PREVENT kicking the user out of their app!
    const action = url.searchParams.get('action');
    if (action === 'poll-trip' || action === 'cron') {
      return json({
        success: true,
        message: '24/7 background polling is disabled to protect vehicle 12V battery.',
      });
    }

    try {
      if (url.pathname === '/google-callback') return await handleGoogleCallback(env, url);
      if (url.pathname.startsWith('/api/')) return await handleApi(env, request, url);
      if (url.searchParams.has('url')) return await (mgProxy as any).fetch(request);
      return await (legacy as any).fetch(request, env, ctx);
    } catch (e: any) {
      console.error('Unhandled worker exception:', e);
      return json({ error: e?.message || String(e), stack: e?.stack }, 500);
    }
  },

  async scheduled(event: any, env: Env, ctx?: any): Promise<void> {
    await runCron(env).catch(() => {});
    // Legacy single-user poller keeps working if MG_PHONE etc. are still configured.
    if (env.MG_PHONE) await (legacy as any).scheduled(event, env).catch(() => {});
  },
};
