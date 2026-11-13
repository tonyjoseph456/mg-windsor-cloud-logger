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
import {
  BMS_FULL_RANGE_KM,
  evaluateChargingStateDecision,
  hasValidGpsCoords,
  parseTelemetryFromStatus,
  ParsedCarTelemetry,
  resolveChargingEndRangeKm,
} from './charging-sync';
import {
  initAccessControlD1,
  ADMIN_TABLE_SCHEMAS,
  handleAuthApi,
  handleAdminApi,
  renderAdminWebsiteHtml,
  validateAccessCode,
  logAccessEvent,
  isMasterAdminPhone,
} from './admin-portal';
import {
  createD1AuthDbAdapter,
  createEnvAuthKvStore,
  ensureWebhookKey,
  issueOrAdoptApiToken,
  normPhoneValue,
  normVinValue,
  requireScopedVin,
  resolveAppAuth,
  resolveWebhookAuth,
  revokeTokensForVin,
  verifyCarRegistrationCaller,
} from './multi-user-auth';

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
    vin TEXT,
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
    start_lat REAL,
    start_lng REAL,
    end_lat REAL,
    end_lng REAL,
    start_cabin_temp_c REAL,
    end_cabin_temp_c REAL,
    start_exterior_temp_c REAL,
    end_exterior_temp_c REAL,
    status TEXT DEFAULT 'completed',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_trips_date ON trips(date)`,
  `CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status)`,
  `CREATE TABLE IF NOT EXISTS charges (
    id TEXT PRIMARY KEY,
    vin TEXT,
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
    end_range_km REAL,
    lat REAL,
    lng REAL,
    location TEXT,
    status TEXT DEFAULT 'completed',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_charges_date ON charges(date)`,
  `CREATE TABLE IF NOT EXISTS charging_sessions (
    id TEXT PRIMARY KEY,
    vin TEXT,
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
    end_range_km REAL,
    start_lat REAL,
    start_lng REAL,
    location TEXT,
    outage_count INTEGER DEFAULT 0,
    paused_at INTEGER,
    pause_pending_at INTEGER,
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
    vin TEXT,
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

function normVin(v?: string | null): string {
  return (v || '').trim().toUpperCase();
}

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
  for (const sql of ADMIN_TABLE_SCHEMAS) {
    try {
      await db.prepare(sql).run();
    } catch (err: any) {
      d1InitErrors.push(`admin schema ${sql.substring(0, 30)}: ${err?.message || err}`);
    }
  }
  // Auto-migrate columns for pre-existing tables:
  try {
    await db.prepare('ALTER TABLE notifications ADD COLUMN is_read INTEGER DEFAULT 0').run();
  } catch (_) {}
  for (const tbl of ['trips', 'charges', 'charging_sessions', 'notifications']) {
    try {
      await db.prepare(`ALTER TABLE ${tbl} ADD COLUMN vin TEXT`).run();
    } catch (_) {}
  }
  const tripCols = [
    'start_lat REAL',
    'start_lng REAL',
    'end_lat REAL',
    'end_lng REAL',
    'start_cabin_temp_c REAL',
    'end_cabin_temp_c REAL',
    'start_exterior_temp_c REAL',
    'end_exterior_temp_c REAL',
  ];
  for (const col of tripCols) {
    try {
      await db.prepare(`ALTER TABLE trips ADD COLUMN ${col}`).run();
    } catch (_) {}
  }
  const chargingSessionCols = [
    'pause_pending_at INTEGER',
    'end_range_km REAL',
    'start_lat REAL',
    'start_lng REAL',
    'location TEXT',
  ];
  for (const col of chargingSessionCols) {
    try {
      await db.prepare(`ALTER TABLE charging_sessions ADD COLUMN ${col}`).run();
    } catch (_) {}
  }
  const chargeCols = ['end_range_km REAL', 'lat REAL', 'lng REAL', 'location TEXT'];
  for (const col of chargeCols) {
    try {
      await db.prepare(`ALTER TABLE charges ADD COLUMN ${col}`).run();
    } catch (_) {}
  }
  // One-time legacy single-user migration ONLY: tag pre-existing NULL-VIN rows only if DB contains <= 1 VIN
  try {
    const doneRow: any = await db.prepare("SELECT value FROM kv_store WHERE key = 'legacy_vin_backfill_done'").first();
    if (!doneRow?.value) {
      const countRow: any = await db.prepare(`
        SELECT COUNT(DISTINCT vin) AS c FROM (
          SELECT vin FROM trips WHERE vin IS NOT NULL AND vin != ''
          UNION SELECT vin FROM charges WHERE vin IS NOT NULL AND vin != ''
          UNION SELECT vin FROM charging_sessions WHERE vin IS NOT NULL AND vin != ''
        )
      `).first();
      const distinctVinCount = Number(countRow?.c) || 0;
      if (distinctVinCount <= 1) {
        const sessRow: any = await db.prepare("SELECT value FROM kv_store WHERE key = 'mg_active_session'").first();
        if (sessRow?.value) {
          const parsed = JSON.parse(sessRow.value);
          const primaryVin = normVin(parsed?.vin);
          if (primaryVin) {
            for (const tbl of ['trips', 'charges', 'charging_sessions', 'notifications']) {
              try {
                await db.prepare(`UPDATE ${tbl} SET vin = ? WHERE vin IS NULL OR vin = ''`).bind(primaryVin).run();
              } catch (_) {}
            }
          }
        }
      }
      await db.prepare("INSERT OR REPLACE INTO kv_store (key, value) VALUES ('legacy_vin_backfill_done', '1')").run();
    }
  } catch (_) {}
  // Repair 07 Nov 2026 charging session start_time to actual 11:12 PM IST plug-in time (1794073320) & restore zeroed durations/peak_power
  try {
    await db.prepare(
      "UPDATE charging_sessions SET start_time = 1794073320, active_duration_seconds = 30632, peak_power_kw = 3.3 WHERE id = 'chg_1794074431890_5kct' AND start_time = 1794074431"
    ).run();
    await db.prepare(
      "UPDATE charging_sessions SET active_duration_seconds = MAX(0, end_time - start_time) WHERE status = 'completed' AND end_time IS NOT NULL AND end_time > start_time AND (active_duration_seconds IS NULL OR active_duration_seconds = 0)"
    ).run();
    await db.prepare(
      "UPDATE charging_sessions SET peak_power_kw = 3.3 WHERE status = 'completed' AND (peak_power_kw IS NULL OR peak_power_kw = 0)"
    ).run();
    await db.prepare(
      "UPDATE charging_sessions SET charge_type = 'AC' WHERE peak_power_kw > 0 AND peak_power_kw <= 11.0 AND charge_type = 'DC'"
    ).run();
    await db.prepare(
      "UPDATE charges SET charge_type = 'AC Standard', charger_type = 'AC Standard' WHERE peak_kw > 0 AND peak_kw <= 11.0 AND (charge_type LIKE '%DC%' OR charger_type LIKE '%DC%')"
    ).run();
    // Backfill charging location/GPS on historical charging_sessions when a trip ended right before plug-in at the same odometer
    await db.prepare(`
      UPDATE charging_sessions
      SET
        start_lat = COALESCE(start_lat, (
          SELECT t.end_lat FROM trips t
          WHERE t.status = 'completed'
            AND (charging_sessions.vin IS NULL OR charging_sessions.vin = '' OR t.vin = charging_sessions.vin)
            AND t.end_lat IS NOT NULL AND t.end_lng IS NOT NULL
            AND t.end_timestamp IS NOT NULL AND t.end_timestamp <= charging_sessions.start_time
            AND (charging_sessions.start_time - t.end_timestamp) <= 21600
            AND t.end_odometer_km IS NOT NULL AND charging_sessions.start_odometer_km IS NOT NULL
            AND ABS(t.end_odometer_km - charging_sessions.start_odometer_km) <= 0.3
          ORDER BY t.end_timestamp DESC LIMIT 1
        )),
        start_lng = COALESCE(start_lng, (
          SELECT t.end_lng FROM trips t
          WHERE t.status = 'completed'
            AND (charging_sessions.vin IS NULL OR charging_sessions.vin = '' OR t.vin = charging_sessions.vin)
            AND t.end_lat IS NOT NULL AND t.end_lng IS NOT NULL
            AND t.end_timestamp IS NOT NULL AND t.end_timestamp <= charging_sessions.start_time
            AND (charging_sessions.start_time - t.end_timestamp) <= 21600
            AND t.end_odometer_km IS NOT NULL AND charging_sessions.start_odometer_km IS NOT NULL
            AND ABS(t.end_odometer_km - charging_sessions.start_odometer_km) <= 0.3
          ORDER BY t.end_timestamp DESC LIMIT 1
        )),
        location = COALESCE(NULLIF(location, ''), (
          SELECT t.end_location FROM trips t
          WHERE t.status = 'completed'
            AND (charging_sessions.vin IS NULL OR charging_sessions.vin = '' OR t.vin = charging_sessions.vin)
            AND t.end_location IS NOT NULL AND t.end_location != ''
            AND t.end_timestamp IS NOT NULL AND t.end_timestamp <= charging_sessions.start_time
            AND (charging_sessions.start_time - t.end_timestamp) <= 21600
            AND t.end_odometer_km IS NOT NULL AND charging_sessions.start_odometer_km IS NOT NULL
            AND ABS(t.end_odometer_km - charging_sessions.start_odometer_km) <= 0.3
          ORDER BY t.end_timestamp DESC LIMIT 1
        ))
      WHERE (location IS NULL OR location = '' OR start_lat IS NULL OR start_lng IS NULL)
        AND start_odometer_km IS NOT NULL
    `).run();
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

async function d1KvDelete(env: Env, key: string): Promise<void> {
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
      const coordSuffix = `(${lat.toFixed(6)}, ${lng.toFixed(6)})`;
      if (road && city) return `${road}, ${city} ${coordSuffix}`;
      if (city) return `${city} ${coordSuffix}`;
      if (data.display_name) return `${data.display_name.split(',').slice(0, 2).join(',').trim()} ${coordSuffix}`;
    }
  } catch (_) {}
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
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

async function getPushSubscriptionsForVin(env: Env, vin?: string | null): Promise<{ key: string; subs: PushSubscription[] }> {
  const v = requireScopedVin(vin);
  if (!v) return { key: 'push_subs:none', subs: [] };
  const key = `push_subs:${v}`;
  const raw = await d1KvGet(env, key);
  const subs: PushSubscription[] = Array.isArray(raw) ? raw : [];
  return { key, subs };
}

async function dispatchTripNotification(url: URL | null, title: string, bodyText: string, tags = 'car', env?: Env, vin?: string | null) {
  const v = normVin(vin || (url ? url.searchParams.get('vin') : null) || env?.MG_VIN);
  const result: any = { vin: v || null, sent: 0, total: 0, results: [] };

  if (!env) return result;

  try {
    const { key, subs } = await getPushSubscriptionsForVin(env, v);
    result.total = subs.length;
    if (subs.length === 0) return result;

    const expiredEndpoints = new Set<string>();
    const pushResults = await Promise.all(
      subs.map(async (sub: PushSubscription) => {
        const r = await sendPushToSubscription(sub, {
          title,
          body: bodyText,
          tag: tags || 'windsor-alert',
          data: { vin: v, url: '/' },
        });
        if (r.expired) expiredEndpoints.add(sub.endpoint);
        return { endpoint: sub.endpoint.slice(0, 48) + '...', ok: r.ok, status: r.status };
      })
    );
    result.results = pushResults;
    result.sent = pushResults.filter((r) => r.ok).length;

    if (expiredEndpoints.size > 0) {
      const remaining = subs.filter((s) => !expiredEndpoints.has(s.endpoint));
      await d1KvPut(env, key, remaining);
    }
  } catch (e: any) {
    result.error = e?.message || String(e);
  }

  return result;
}

// D1 and KV Dual Storage Helpers (with Multi-User VIN Isolation)
async function d1InsertTrip(env: Env, trip: any) {
  const v = requireScopedVin(trip.vin);
  if (!v) return;
  if (env.DB) {
    await initD1(env.DB);
    try {
      try {
        await env.DB.prepare(`
          INSERT OR REPLACE INTO trips (
            id, vin, date, start_timestamp, end_timestamp, duration_seconds, distance_km,
            start_odometer_km, end_odometer_km, start_soc, end_soc, energy_used_kwh,
            efficiency_km_per_kwh, start_location, end_location, avg_speed_kmh, max_speed_kmh,
            start_lat, start_lng, end_lat, end_lng,
            start_cabin_temp_c, end_cabin_temp_c, start_exterior_temp_c, end_exterior_temp_c,
            status
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          trip.id, v || null, trip.date, trip.start_timestamp, trip.end_timestamp || null, trip.duration_seconds || null,
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
          trip.start_lat != null ? Number(trip.start_lat) : null,
          trip.start_lng != null ? Number(trip.start_lng) : null,
          trip.end_lat != null ? Number(trip.end_lat) : null,
          trip.end_lng != null ? Number(trip.end_lng) : null,
          trip.start_cabin_temp_c != null ? Number(trip.start_cabin_temp_c) : null,
          trip.end_cabin_temp_c != null ? Number(trip.end_cabin_temp_c) : null,
          trip.start_exterior_temp_c != null ? Number(trip.start_exterior_temp_c) : null,
          trip.end_exterior_temp_c != null ? Number(trip.end_exterior_temp_c) : null,
          trip.status || 'ongoing'
        ).run();
      } catch (_) {
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
      }
    } catch (err) {
      console.warn('d1InsertTrip error:', err);
    }
  }
  if (env.TRIP_KV) {
    try {
      const trips = (await env.TRIP_KV.get('d1_fallback:trips', 'json')) || [];
      const filtered = trips.filter((t: any) => t.id !== trip.id);
      filtered.unshift({ ...trip, vin: v });
      await env.TRIP_KV.put('d1_fallback:trips', JSON.stringify(filtered.slice(0, 300)));
      if (trip.status === 'ongoing') {
        await env.TRIP_KV.put(`d1_fallback:active_trip:${v}`, JSON.stringify({ ...trip, vin: v }));
      }
    } catch (_) {}
  }
}

async function d1BatchSyncTrips(env: Env, rawTrips: any[], defaultVin?: string | null): Promise<number> {
  if (!Array.isArray(rawTrips) || rawTrips.length === 0) return 0;
  const fallbackVin = requireScopedVin(defaultVin);
  if (!fallbackVin) return 0;
  let count = 0;
  if (env.DB) {
    await initD1(env.DB);
    for (const trip of rawTrips) {
      try {
        const id = trip.id || ('trip_' + (trip.start_timestamp || Math.floor(Date.now() / 1000)) + '_' + Math.random().toString(36).substring(2, 6));
        const date = trip.date || (trip.start_timestamp ? istDateString(Number(trip.start_timestamp)) : istDateString(Math.floor(Date.now() / 1000)));
        const v = fallbackVin;
        try {
          await env.DB.prepare(`
            INSERT OR REPLACE INTO trips (
              id, vin, date, start_timestamp, end_timestamp, duration_seconds, distance_km,
              start_odometer_km, end_odometer_km, start_soc, end_soc, energy_used_kwh,
              efficiency_km_per_kwh, start_location, end_location, avg_speed_kmh, max_speed_kmh,
              start_lat, start_lng, end_lat, end_lng,
              start_cabin_temp_c, end_cabin_temp_c, start_exterior_temp_c, end_exterior_temp_c,
              status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            id, v, date, Number(trip.start_timestamp) || 0,
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
            trip.start_lat != null ? Number(trip.start_lat) : null,
            trip.start_lng != null ? Number(trip.start_lng) : null,
            trip.end_lat != null ? Number(trip.end_lat) : null,
            trip.end_lng != null ? Number(trip.end_lng) : null,
            trip.start_cabin_temp_c != null ? Number(trip.start_cabin_temp_c) : null,
            trip.end_cabin_temp_c != null ? Number(trip.end_cabin_temp_c) : null,
            trip.start_exterior_temp_c != null ? Number(trip.start_exterior_temp_c) : null,
            trip.end_exterior_temp_c != null ? Number(trip.end_exterior_temp_c) : null,
            trip.status || 'completed'
          ).run();
        } catch (_) {
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
        }
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
            vin: normVin(t.vin) || fallbackVin || undefined,
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

async function d1DeleteTrip(env: Env, tripId: string, vin?: string | null) {
  const v = requireScopedVin(vin);
  if (!v) return;
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare('DELETE FROM trips WHERE id = ? AND vin = ?').bind(tripId, v).run();
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const trips = (await env.TRIP_KV.get('d1_fallback:trips', 'json')) || [];
      await env.TRIP_KV.put(
        'd1_fallback:trips',
        JSON.stringify(trips.filter((t: any) => !(t.id === tripId && normVin(t.vin) === v)))
      );
    } catch (_) {}
  }
}

async function d1ClearTrips(env: Env, vin?: string | null) {
  const v = requireScopedVin(vin);
  if (!v) return;
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare('DELETE FROM trips WHERE vin = ?').bind(v).run();
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const trips = (await env.TRIP_KV.get('d1_fallback:trips', 'json')) || [];
      await env.TRIP_KV.put('d1_fallback:trips', JSON.stringify(trips.filter((t: any) => normVin(t.vin) !== v)));
      await env.TRIP_KV.delete(`d1_fallback:active_trip:${v}`);
    } catch (_) {}
  }
}

async function d1UpdateTrip(env: Env, tripId: string, updates: any) {
  if (env.DB) {
    await initD1(env.DB);
    try {
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
            max_speed_kmh = ?,
            end_lat = ?,
            end_lng = ?,
            end_cabin_temp_c = ?,
            end_exterior_temp_c = ?,
            status = 'completed'
          WHERE id = ?
        `).bind(
          updates.end_timestamp, updates.duration_seconds, updates.distance_km,
          updates.end_odometer_km, updates.end_soc, updates.energy_used_kwh,
          updates.efficiency_km_per_kwh, updates.end_location, updates.avg_speed_kmh,
          updates.max_speed_kmh ?? null,
          updates.end_lat ?? null,
          updates.end_lng ?? null,
          updates.end_cabin_temp_c ?? null,
          updates.end_exterior_temp_c ?? null,
          tripId
        ).run();
      } catch (_) {
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
            max_speed_kmh = ?,
            status = 'completed'
          WHERE id = ?
        `).bind(
          updates.end_timestamp, updates.duration_seconds, updates.distance_km,
          updates.end_odometer_km, updates.end_soc, updates.energy_used_kwh,
          updates.efficiency_km_per_kwh, updates.end_location, updates.avg_speed_kmh,
          updates.max_speed_kmh ?? null,
          tripId
        ).run();
      }
    } catch (err) {
      console.warn('d1UpdateTrip error:', err);
    }
  }
  if (env.TRIP_KV) {
    try {
      const trips = (await env.TRIP_KV.get('d1_fallback:trips', 'json')) || [];
      const idx = trips.findIndex((t: any) => t.id === tripId);
      if (idx !== -1) {
        const v = normVin(trips[idx].vin);
        trips[idx] = { ...trips[idx], ...updates, status: 'completed' };
        await env.TRIP_KV.put('d1_fallback:trips', JSON.stringify(trips.slice(0, 200)));
        if (v) await env.TRIP_KV.delete(`d1_fallback:active_trip:${v}`);
      }
    } catch (_) {}
  }
}

async function d1GetActiveTrip(env: Env, vin?: string | null) {
  const v = requireScopedVin(vin);
  if (!v) return null;
  if (env.DB) {
    await initD1(env.DB);
    try {
      const row = await env.DB.prepare("SELECT * FROM trips WHERE status = 'ongoing' AND vin = ? ORDER BY start_timestamp DESC LIMIT 1").bind(v).first();
      if (row) return row;
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const activeV = await env.TRIP_KV.get(`d1_fallback:active_trip:${v}`, 'json');
      if (activeV && normVin(activeV.vin) === v) return activeV;
      const trips = (await env.TRIP_KV.get('d1_fallback:trips', 'json')) || [];
      return trips.find((t: any) => t.status === 'ongoing' && normVin(t.vin) === v) || null;
    } catch (_) {}
  }
  return null;
}

function d1DeduplicateTripRows(trips: any[]): { clean: any[]; duplicateIds: string[] } {
  if (!Array.isArray(trips) || trips.length === 0) return { clean: [], duplicateIds: [] };

  const valid = trips.filter(
    (t) => Number(t?.distance_km ?? t?.distanceKm ?? 0) >= 0.2 || t?.status === 'ongoing' || t?.status === 'driving'
  );

  valid.sort((a, b) => {
    const timeA = Number(a.start_timestamp || a.startTimestampSec || 0);
    const timeB = Number(b.start_timestamp || b.startTimestampSec || 0);
    if (timeA !== timeB) return timeB - timeA;
    return Number(b.distance_km || b.distanceKm || 0) - Number(a.distance_km || a.distanceKm || 0);
  });

  const clean: any[] = [];
  const duplicateIds: string[] = [];

  for (const t of valid) {
    const tId = String(t.id || '');
    const tStartSec = Number(t.start_timestamp || t.startTimestampSec || 0);
    const tEndSec = Number(t.end_timestamp || t.endTimestampSec || tStartSec);
    const tStartOdo = Number(t.start_odometer_km || t.startOdometerKm || 0);
    const tEndOdo = Number(t.end_odometer_km || t.endOdometerKm || 0);
    const tDist = Number(t.distance_km || t.distanceKm || 0);
    const tDur = Number(t.duration_seconds || t.durationSeconds || (tEndSec - tStartSec) || 0);

    let isDuplicate = false;

    for (let i = 0; i < clean.length; i++) {
      const c = clean[i];
      const cId = String(c.id || '');
      const cStartSec = Number(c.start_timestamp || c.startTimestampSec || 0);
      const cEndSec = Number(c.end_timestamp || c.endTimestampSec || cStartSec);
      const cStartOdo = Number(c.start_odometer_km || c.startOdometerKm || 0);
      const cEndOdo = Number(c.end_odometer_km || c.endOdometerKm || 0);
      const cDist = Number(c.distance_km || c.distanceKm || 0);
      const cDur = Number(c.duration_seconds || c.durationSeconds || (cEndSec - cStartSec) || 0);

      // 1. Exact ID
      if (tId && cId && tId === cId) {
        isDuplicate = true;
        break;
      }

      // 2. Same End Odometer (within 0.25 km) & Overlapping Time Window
      const sameEndOdo = tEndOdo > 0 && cEndOdo > 0 && Math.abs(tEndOdo - cEndOdo) <= 0.25;
      const timeOverlaps = tStartSec <= cEndSec + 90 && tEndSec >= cStartSec - 90;

      // 3. Same Start Odometer & Start Time
      const sameStartOdo = tStartOdo > 0 && cStartOdo > 0 && Math.abs(tStartOdo - cStartOdo) <= 0.25;
      const sameStartTime = Math.abs(tStartSec - cStartSec) <= 120;

      // 4. Same Distance (within 0.5 km) & close Start Time (within 180s)
      const sameDistance = Math.abs(tDist - cDist) <= 0.5 && tDist > 0.2;
      const closeStartTime = Math.abs(tStartSec - cStartSec) <= 180;

      // 5. Overlapping time interval >= 50%
      const overlapStart = Math.max(tStartSec, cStartSec);
      const overlapEnd = Math.min(tEndSec, cEndSec);
      const overlapSec = Math.max(0, overlapEnd - overlapStart);
      const minDuration = Math.min(tDur, cDur);
      const isSignificantOverlap = minDuration > 120 && overlapSec >= minDuration * 0.5 && Math.abs(tDist - cDist) <= 1.0;

      if ((sameEndOdo && timeOverlaps) || (sameStartOdo && sameStartTime) || (sameDistance && closeStartTime) || isSignificantOverlap) {
        if (tDist > cDist || (tDist === cDist && tDur > cDur)) {
          if (cId) duplicateIds.push(cId);
          clean[i] = t;
        } else {
          if (tId) duplicateIds.push(tId);
        }
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      clean.push(t);
    }
  }

  return { clean, duplicateIds };
}

async function d1DeduplicateTrips(env: Env, vin?: string | null): Promise<{ removedCount: number; duplicateIds: string[] }> {
  const v = requireScopedVin(vin);
  if (!v) return { removedCount: 0, duplicateIds: [] };
  let allTrips: any[] = [];
  if (env.DB) {
    await initD1(env.DB);
    try {
      const res = await env.DB.prepare("SELECT * FROM trips WHERE vin = ? ORDER BY start_timestamp DESC").bind(v).all();
      allTrips = res.results || [];
    } catch (_) {}
  } else if (env.TRIP_KV) {
    try {
      allTrips = ((await env.TRIP_KV.get('d1_fallback:trips', 'json')) || []).filter((t: any) => normVin(t.vin) === v);
    } catch (_) {}
  }

  const { duplicateIds } = d1DeduplicateTripRows(allTrips);

  if (duplicateIds.length > 0) {
    if (env.DB) {
      for (const id of duplicateIds) {
        try {
          await env.DB.prepare('DELETE FROM trips WHERE id = ? AND vin = ?').bind(id, v).run();
        } catch (_) {}
      }
    }
    if (env.TRIP_KV) {
      try {
        let trips = (await env.TRIP_KV.get('d1_fallback:trips', 'json')) || [];
        trips = trips.filter((t: any) => !(normVin(t.vin) === v && duplicateIds.includes(String(t.id))));
        await env.TRIP_KV.put('d1_fallback:trips', JSON.stringify(trips));
      } catch (_) {}
    }
  }

  return { removedCount: duplicateIds.length, duplicateIds };
}

async function d1GetTrips(env: Env, date?: string | null, vin?: string | null) {
  const v = requireScopedVin(vin);
  if (!v) return [];
  if (env.DB) {
    await initD1(env.DB);
    try {
      if (!date || date === 'all') {
        const res = await env.DB.prepare("SELECT * FROM trips WHERE vin = ? ORDER BY start_timestamp DESC LIMIT 150").bind(v).all();
        return d1DeduplicateTripRows(res.results || []).clean;
      }
      const res = await env.DB.prepare("SELECT * FROM trips WHERE date = ? AND vin = ? ORDER BY start_timestamp DESC").bind(date, v).all();
      return d1DeduplicateTripRows(res.results || []).clean;
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const trips = ((await env.TRIP_KV.get('d1_fallback:trips', 'json')) || []).filter((t: any) => normVin(t.vin) === v);
      const filtered = (!date || date === 'all') ? trips : trips.filter((t: any) => t.date === date);
      return d1DeduplicateTripRows(filtered).clean;
    } catch (_) {}
  }
  return [];
}

async function d1GetTripDates(env: Env, vin?: string | null) {
  const v = requireScopedVin(vin);
  if (!v) return [];
  if (env.DB) {
    await initD1(env.DB);
    try {
      const res = await env.DB.prepare("SELECT DISTINCT date FROM trips WHERE vin = ? ORDER BY date DESC").bind(v).all();
      return (res.results || []).map((r: any) => r.date).filter(Boolean);
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const trips = ((await env.TRIP_KV.get('d1_fallback:trips', 'json')) || []).filter((t: any) => normVin(t.vin) === v);
      return Array.from(new Set(trips.map((t: any) => t.date).filter(Boolean)));
    } catch (_) {}
  }
  return [];
}

// Charges D1 & KV helpers
async function d1InsertCharge(env: Env, charge: any) {
  const v = requireScopedVin(charge.vin);
  if (!v) return;
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare(`
        INSERT OR REPLACE INTO charges (id, vin, date, start_timestamp, end_timestamp, duration_seconds, start_soc, end_soc, energy_added_kwh, charger_type, peak_kw, odometer_km, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        charge.id, v, charge.date, charge.start_timestamp, charge.end_timestamp || null, charge.duration_seconds || null,
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
      filtered.unshift({ ...charge, vin: v });
      await env.TRIP_KV.put('d1_fallback:charges', JSON.stringify(filtered.slice(0, 300)));
      if (charge.status === 'charging') {
        await env.TRIP_KV.put(`d1_fallback:active_charge:${v}`, JSON.stringify({ ...charge, vin: v }));
      }
    } catch (_) {}
  }
}

async function d1BatchSyncCharges(env: Env, rawCharges: any[], defaultVin?: string | null): Promise<number> {
  if (!Array.isArray(rawCharges) || rawCharges.length === 0) return 0;
  const fallbackVin = requireScopedVin(defaultVin);
  if (!fallbackVin) return 0;
  let count = 0;
  if (env.DB) {
    await initD1(env.DB);
    for (const charge of rawCharges) {
      try {
        const id = charge.id || ('chg_' + (charge.start_timestamp || Math.floor(Date.now() / 1000)) + '_' + Math.random().toString(36).substring(2, 6));
        const date = charge.date || (charge.start_timestamp ? istDateString(Number(charge.start_timestamp)) : istDateString(Math.floor(Date.now() / 1000)));
        const v = fallbackVin;
        await env.DB.prepare(`
          INSERT OR REPLACE INTO charges (
            id, vin, date, start_timestamp, end_timestamp, duration_seconds,
            start_soc, end_soc, energy_added_kwh, charger_type, peak_kw, odometer_km,
            end_range_km, lat, lng, location, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          id, v, date, Number(charge.start_timestamp) || 0,
          charge.end_timestamp ? Number(charge.end_timestamp) : null,
          charge.duration_seconds ? Number(charge.duration_seconds) : null,
          charge.start_soc != null ? Number(charge.start_soc) : null,
          charge.end_soc != null ? Number(charge.end_soc) : null,
          charge.energy_added_kwh != null ? Number(charge.energy_added_kwh) : null,
          charge.charger_type || 'AC 3.3 kW',
          charge.peak_kw != null ? Number(charge.peak_kw) : null,
          charge.odometer_km != null ? Number(charge.odometer_km) : null,
          charge.end_range_km != null ? Number(charge.end_range_km) : null,
          charge.lat != null ? Number(charge.lat) : null,
          charge.lng != null ? Number(charge.lng) : null,
          charge.location || null,
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
            vin: normVin(c.vin) || fallbackVin || undefined,
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

async function d1DeleteCharge(env: Env, chargeId: string, vin?: string | null) {
  const v = requireScopedVin(vin);
  if (!v) return;
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare('DELETE FROM charges WHERE id = ? AND vin = ?').bind(chargeId, v).run();
      await env.DB.prepare('DELETE FROM charging_sessions WHERE id = ? AND vin = ?').bind(chargeId, v).run();
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const charges = (await env.TRIP_KV.get('d1_fallback:charges', 'json')) || [];
      await env.TRIP_KV.put(
        'd1_fallback:charges',
        JSON.stringify(charges.filter((c: any) => !(c.id === chargeId && normVin(c.vin) === v)))
      );
    } catch (_) {}
  }
}

async function d1ClearCharges(env: Env, vin?: string | null) {
  const v = requireScopedVin(vin);
  if (!v) return;
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare('DELETE FROM charges WHERE vin = ?').bind(v).run();
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const charges = (await env.TRIP_KV.get('d1_fallback:charges', 'json')) || [];
      await env.TRIP_KV.put('d1_fallback:charges', JSON.stringify(charges.filter((c: any) => normVin(c.vin) !== v)));
      await env.TRIP_KV.delete(`d1_fallback:active_charge:${v}`);
    } catch (_) {}
  }
}

async function d1UpdateCharge(env: Env, chargeId: string, updates: any, vin?: string | null) {
  const scopedVin = requireScopedVin(vin);
  if (env.DB) {
    await initD1(env.DB);
    try {
      const sql = scopedVin
        ? `UPDATE charges SET end_timestamp = ?, duration_seconds = ?, end_soc = ?, energy_added_kwh = ?, peak_kw = ?, status = 'completed' WHERE id = ? AND vin = ?`
        : `UPDATE charges SET end_timestamp = ?, duration_seconds = ?, end_soc = ?, energy_added_kwh = ?, peak_kw = ?, status = 'completed' WHERE id = ?`;
      const args = scopedVin
        ? [updates.end_timestamp, updates.duration_seconds, updates.end_soc, updates.energy_added_kwh, updates.peak_kw, chargeId, scopedVin]
        : [updates.end_timestamp, updates.duration_seconds, updates.end_soc, updates.energy_added_kwh, updates.peak_kw, chargeId];
      await env.DB.prepare(sql).bind(...args).run();
    } catch (err) {
      console.warn('d1UpdateCharge error:', err);
    }
  }
  if (env.TRIP_KV) {
    try {
      const charges = (await env.TRIP_KV.get('d1_fallback:charges', 'json')) || [];
      const idx = charges.findIndex((c: any) => c.id === chargeId && (!scopedVin || normVin(c.vin) === scopedVin));
      if (idx !== -1) {
        const v = scopedVin || normVin(charges[idx].vin);
        charges[idx] = { ...charges[idx], ...updates, status: 'completed' };
        await env.TRIP_KV.put('d1_fallback:charges', JSON.stringify(charges.slice(0, 200)));
        if (v) await env.TRIP_KV.delete(`d1_fallback:active_charge:${v}`);
      } else if (scopedVin) {
        await env.TRIP_KV.delete(`d1_fallback:active_charge:${scopedVin}`);
      }
    } catch (_) {}
  }
}

async function d1GetActiveCharge(env: Env, vin?: string | null) {
  const v = requireScopedVin(vin);
  if (!v) return null;
  if (env.DB) {
    await initD1(env.DB);
    try {
      const row = await env.DB.prepare("SELECT * FROM charges WHERE status = 'charging' AND vin = ? ORDER BY start_timestamp DESC LIMIT 1").bind(v).first();
      if (row) return row;
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const active = await env.TRIP_KV.get(`d1_fallback:active_charge:${v}`, 'json');
      if (active && normVin(active.vin) === v) return active;
      const charges = (await env.TRIP_KV.get('d1_fallback:charges', 'json')) || [];
      return charges.find((c: any) => c.status === 'charging' && normVin(c.vin) === v) || null;
    } catch (_) {}
  }
  return null;
}

function d1DeduplicateChargeRows(charges: any[]): { clean: any[]; duplicateIds: string[] } {
  if (!Array.isArray(charges) || charges.length === 0) return { clean: [], duplicateIds: [] };

  const valid = charges.filter((c) => {
    const startSec = Number(c.start_timestamp || c.startTimestampSec || c.start_time || 0);
    const endSoc = Number(c.end_soc || c.endSoc || 0);
    const startSoc = Number(c.start_soc || c.startSoc || 0);
    if (!startSec || (endSoc <= 1 && startSoc > 5)) return false;
    return true;
  });

  valid.sort((a, b) => {
    const timeA = Number(a.start_timestamp || a.startTimestampSec || a.start_time || 0);
    const timeB = Number(b.start_timestamp || b.startTimestampSec || b.start_time || 0);
    if (timeA !== timeB) return timeB - timeA;
    return Number(b.energy_added_kwh || b.kwh_added || 0) - Number(a.energy_added_kwh || a.kwh_added || 0);
  });

  const clean: any[] = [];
  const duplicateIds: string[] = [];

  for (const c of valid) {
    const cId = String(c.id || '');
    const cStartSec = Number(c.start_timestamp || c.startTimestampSec || c.start_time || 0);
    const cEndSec = Number(c.end_timestamp || c.endTimestampSec || c.end_time || cStartSec);
    const cOdo = Number(c.odometer_km || c.odometerKm || c.start_odometer_km || 0);
    const cEnergy = Number(c.energy_added_kwh || c.kwh_added || 0);
    const cEndSoc = Number(c.end_soc || c.endSoc || 0);

    let isDuplicate = false;

    for (let i = 0; i < clean.length; i++) {
      const e = clean[i];
      const eId = String(e.id || '');
      const eStartSec = Number(e.start_timestamp || e.startTimestampSec || e.start_time || 0);
      const eEndSec = Number(e.end_timestamp || e.endTimestampSec || e.end_time || eStartSec);
      const eOdo = Number(e.odometer_km || e.odometerKm || e.start_odometer_km || 0);
      const eEnergy = Number(e.energy_added_kwh || e.kwh_added || 0);
      const eEndSoc = Number(e.end_soc || e.endSoc || 0);

      // 1. Exact ID
      if (cId && eId && cId === eId) {
        isDuplicate = true;
        break;
      }

      // 2. Close Start Time (< 30 min) and same Odometer (< 0.2 km)
      const sameOdo = cOdo > 0 && eOdo > 0 && Math.abs(cOdo - eOdo) <= 0.2;
      const closeTime = Math.abs(cStartSec - eStartSec) < 1800;
      const sameEndSoc = cEndSoc > 0 && eEndSoc > 0 && Math.abs(cEndSoc - eEndSoc) <= 1;

      if ((sameOdo && closeTime) || (closeTime && sameEndSoc)) {
        if (cEnergy > eEnergy || (cEndSec > eEndSec)) {
          if (eId) duplicateIds.push(eId);
          clean[i] = c;
        } else {
          if (cId) duplicateIds.push(cId);
        }
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      clean.push(c);
    }
  }

  return { clean, duplicateIds };
}

async function d1DeduplicateCharges(env: Env, vin?: string | null): Promise<{ removedCount: number; duplicateIds: string[] }> {
  const v = requireScopedVin(vin);
  if (!v) return { removedCount: 0, duplicateIds: [] };
  let allCharges: any[] = [];
  if (env.DB) {
    await initD1(env.DB);
    try {
      const res = await env.DB.prepare("SELECT * FROM charges WHERE vin = ? ORDER BY start_timestamp DESC").bind(v).all();
      allCharges = res.results || [];
    } catch (_) {}
  } else if (env.TRIP_KV) {
    try {
      allCharges = ((await env.TRIP_KV.get('d1_fallback:charges', 'json')) || []).filter((c: any) => normVin(c.vin) === v);
    } catch (_) {}
  }

  const { duplicateIds } = d1DeduplicateChargeRows(allCharges);

  if (duplicateIds.length > 0) {
    if (env.DB) {
      for (const id of duplicateIds) {
        try {
          await env.DB.prepare('DELETE FROM charges WHERE id = ? AND vin = ?').bind(id, v).run();
          await env.DB.prepare('DELETE FROM charging_sessions WHERE id = ? AND vin = ?').bind(id, v).run();
        } catch (_) {}
      }
    }
    if (env.TRIP_KV) {
      try {
        let charges = (await env.TRIP_KV.get('d1_fallback:charges', 'json')) || [];
        charges = charges.filter((c: any) => !(normVin(c.vin) === v && duplicateIds.includes(String(c.id))));
        await env.TRIP_KV.put('d1_fallback:charges', JSON.stringify(charges));
      } catch (_) {}
    }
  }

  return { removedCount: duplicateIds.length, duplicateIds };
}

function normalizeChargeSessionRow(r: any) {
  if (!r) return r;
  const peakKw = Number(r.peak_power_kw ?? r.peak_kw ?? 0);
  if (peakKw > 11.0) {
    r.charge_type = 'DC';
  } else if (peakKw > 0) {
    r.charge_type = 'AC';
  }
  return r;
}

async function d1GetCharges(env: Env, date?: string | null, vin?: string | null) {
  const v = requireScopedVin(vin);
  if (!v) return [];
  if (env.DB) {
    await initD1(env.DB);
    try {
      if (!date || date === 'all') {
        const res = await env.DB.prepare("SELECT * FROM charges WHERE vin = ? ORDER BY start_timestamp DESC LIMIT 150").bind(v).all();
        return d1DeduplicateChargeRows((res.results || []).map(normalizeChargeSessionRow)).clean;
      }
      const res = await env.DB.prepare("SELECT * FROM charges WHERE date = ? AND vin = ? ORDER BY start_timestamp DESC").bind(date, v).all();
      return d1DeduplicateChargeRows((res.results || []).map(normalizeChargeSessionRow)).clean;
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const charges = ((await env.TRIP_KV.get('d1_fallback:charges', 'json')) || []).filter((c: any) => normVin(c.vin) === v);
      const filtered = (!date || date === 'all') ? charges : charges.filter((c: any) => c.date === date);
      return d1DeduplicateChargeRows(filtered.map(normalizeChargeSessionRow)).clean;
    } catch (_) {}
  }
  return [];
}

async function d1GetChargeDates(env: Env, vin?: string | null) {
  const v = requireScopedVin(vin);
  if (!v) return [];
  if (env.DB) {
    await initD1(env.DB);
    try {
      const resA = await env.DB.prepare("SELECT DISTINCT date FROM charging_sessions WHERE vin = ? ORDER BY date DESC").bind(v).all();
      const resB = await env.DB.prepare("SELECT DISTINCT date FROM charges WHERE vin = ? ORDER BY date DESC").bind(v).all();
      const set = new Set<string>([
        ...(resA.results || []).map((r: any) => r.date),
        ...(resB.results || []).map((r: any) => r.date),
      ].filter(Boolean));
      return Array.from(set).sort().reverse();
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const charges = ((await env.TRIP_KV.get('d1_fallback:charges', 'json')) || []).filter((c: any) => normVin(c.vin) === v);
      return Array.from(new Set(charges.map((c: any) => c.date).filter(Boolean)));
    } catch (_) {}
  }
  return [];
}

// Notifications D1 & KV helpers
async function d1InsertNotification(env: Env, notif: any) {
  const v = requireScopedVin(notif.vin);
  if (!v) return;
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare(`
        INSERT INTO notifications (id, vin, type, title, message, timestamp, date, is_read, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        notif.id, v, notif.type, notif.title, notif.message,
        notif.timestamp, notif.date, notif.is_read || 0, notif.metadata || ''
      ).run();
      return;
    } catch (err: any) {
      console.warn('d1InsertNotification primary error, trying fallback:', err?.message || err);
    }
  }
  if (env.TRIP_KV) {
    try {
      const list = (await env.TRIP_KV.get('d1_fallback:notifications', 'json')) || [];
      list.unshift({ ...notif, vin: v });
      await env.TRIP_KV.put('d1_fallback:notifications', JSON.stringify(list.slice(0, 100)));
    } catch (_) {}
  }
}

async function d1GetNotifications(env: Env, limit = 50, vin?: string | null) {
  const v = requireScopedVin(vin);
  if (!v) return [];
  if (env.DB) {
    await initD1(env.DB);
    try {
      const res = await env.DB.prepare('SELECT * FROM notifications WHERE vin = ? ORDER BY timestamp DESC LIMIT ?').bind(v, limit).all();
      return res.results || [];
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const list = ((await env.TRIP_KV.get('d1_fallback:notifications', 'json')) || []).filter((n: any) => normVin(n.vin) === v);
      return list.slice(0, limit);
    } catch (_) {}
  }
  return [];
}

/** Count total notifications stored in D1 (or KV fallback) for a single VIN. */
async function d1GetNotificationCount(env: Env, vin?: string | null): Promise<number> {
  const v = requireScopedVin(vin);
  if (!v) return 0;
  if (env.DB) {
    await initD1(env.DB);
    try {
      const row: any = await env.DB.prepare('SELECT COUNT(*) as total FROM notifications WHERE vin = ?').bind(v).first();
      if (row && typeof row.total !== 'undefined') {
        return Number(row.total) || 0;
      }
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const list = ((await env.TRIP_KV.get('d1_fallback:notifications', 'json')) || []).filter((n: any) => normVin(n.vin) === v);
      return list.length;
    } catch (_) {}
  }
  return 0;
}

async function d1ClearNotifications(env: Env, vin?: string | null) {
  const v = requireScopedVin(vin);
  if (!v) return;
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare('DELETE FROM notifications WHERE vin = ?').bind(v).run();
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const list = (await env.TRIP_KV.get('d1_fallback:notifications', 'json')) || [];
      await env.TRIP_KV.put('d1_fallback:notifications', JSON.stringify(list.filter((n: any) => normVin(n.vin) !== v)));
    } catch (_) {}
  }
}

/**
 * Loads the MG client strictly for a specific verified VIN (`mg_session:<VIN>`).
 * Never falls back to another user's session (`mg_active_session`) or env defaults unless
 * explicitly authorized, preventing any cross-user car telemetry or command leakage.
 */
async function getMgClientForVin(
  env: Env,
  vin?: string | null,
  pin?: string | null
): Promise<{ client: MgIndiaClient; vin: string; phone: string } | null> {
  const targetVin = requireScopedVin(vin);
  if (!targetVin) return null;

  try {
    const vinSession = await d1KvGet(env, `mg_session:${targetVin}`);
    if (vinSession?.token && vinSession?.uid) {
      const cleanPin = typeof pin === 'string' && /^\d{4}$/.test(pin.trim()) ? pin.trim() : undefined;
      const client = new MgIndiaClient({
        phone: vinSession.phone || '9999999999',
        password: '',
        vin: normVin(vinSession.vin) || targetVin,
        pinHash: cleanPin ? hashControlPin(cleanPin) : undefined,
      });
      client.uid = vinSession.uid;
      client.token = vinSession.token;
      return {
        client,
        vin: normVin(vinSession.vin) || targetVin,
        phone: normPhoneValue(vinSession.phone),
      };
    }
  } catch (_) {}

  return null;
}

async function fetchCarTelemetry(client: MgIndiaClient, vin?: string): Promise<ParsedCarTelemetry> {
  if (vin && !client.vin) client.vin = vin;
  const status: any = await client.status(true);
  return parseTelemetryFromStatus(status);
}

// ---------------------------------------------------------------- Charging Session Tracking Helpers (Cloudflare D1)
async function d1GetActiveChargingSession(env: Env, vin?: string | null): Promise<any | null> {
  const v = requireScopedVin(vin);
  if (!v) return null;
  if (env.DB) {
    await initD1(env.DB);
    try {
      const row = await env.DB.prepare(
        "SELECT * FROM charging_sessions WHERE status IN ('ongoing', 'paused') AND vin = ? ORDER BY start_time DESC LIMIT 1"
      ).bind(v).first();
      if (row) return row;
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      const act = await env.TRIP_KV.get(`d1_fallback:active_charging_session:${v}`, 'json');
      if (act && normVin(act.vin) === v) return act;
    } catch (_) {}
  }
  return null;
}

async function d1GetAllActiveChargingSessions(env: Env): Promise<any[]> {
  if (env.DB) {
    await initD1(env.DB);
    try {
      const res = await env.DB.prepare(
        "SELECT * FROM charging_sessions WHERE status IN ('ongoing', 'paused') AND vin IS NOT NULL AND vin != '' ORDER BY start_time DESC"
      ).all();
      return res.results || [];
    } catch (_) {}
  }
  return [];
}

async function d1GetLastCompletedChargingSession(env: Env, vin?: string | null): Promise<any | null> {
  const v = requireScopedVin(vin);
  if (!v) return null;
  if (env.DB) {
    await initD1(env.DB);
    try {
      const row = await env.DB.prepare(
        "SELECT * FROM charging_sessions WHERE status = 'completed' AND vin = ? ORDER BY end_time DESC LIMIT 1"
      ).bind(v).first();
      if (row) return row;
    } catch (_) {}
  }
  return null;
}

async function d1GetLastCompletedTrip(env: Env, vin?: string | null): Promise<any | null> {
  const v = requireScopedVin(vin);
  if (!v) return null;
  if (env.DB) {
    await initD1(env.DB);
    try {
      const row = await env.DB.prepare(
        "SELECT * FROM trips WHERE status = 'completed' AND vin = ? ORDER BY end_timestamp DESC LIMIT 1"
      ).bind(v).first();
      if (row) return row;
    } catch (_) {}
  }
  return null;
}

async function d1GetRecentParkedTripsPerVin(env: Env, minEndTimestampSec: number): Promise<any[]> {
  if (env.DB) {
    await initD1(env.DB);
    try {
      const res = await env.DB.prepare(`
        SELECT t.* FROM trips t
        INNER JOIN (
          SELECT vin, MAX(end_timestamp) AS max_end
          FROM trips
          WHERE status = 'completed' AND vin IS NOT NULL AND vin != '' AND end_timestamp >= ?
          GROUP BY vin
        ) latest ON t.vin = latest.vin AND t.end_timestamp = latest.max_end
        WHERE t.status = 'completed'
      `).bind(minEndTimestampSec).all();
      return res.results || [];
    } catch (_) {}
  }
  return [];
}

async function d1CreateChargingSession(env: Env, session: any) {
  const v = requireScopedVin(session.vin);
  if (!v) return;
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare(`
        INSERT INTO charging_sessions (
          id, vin, status, start_time, end_time, start_soc, end_soc,
          soc_added, kwh_added, energy_used_kwh, charging_loss_kwh,
          charge_type, peak_power_kw, last_power_kw, start_odometer_km,
          start_range_km, end_range_km, start_lat, start_lng, location,
          outage_count, paused_at, active_duration_seconds,
          last_poll_time, date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        session.id, v, session.status, session.start_time, session.end_time || null,
        session.start_soc, session.end_soc || session.start_soc,
        session.soc_added || 0, session.kwh_added || 0,
        session.energy_used_kwh || 0, session.charging_loss_kwh || 0,
        session.charge_type || 'AC', session.peak_power_kw || 0,
        session.last_power_kw || 0, session.start_odometer_km || 0,
        session.start_range_km || 0, session.end_range_km ?? null,
        session.start_lat ?? null, session.start_lng ?? null, session.location || null,
        session.outage_count || 0,
        session.paused_at || null, session.active_duration_seconds || 0,
        session.last_poll_time || session.start_time, session.date
      ).run();
    } catch (err) {
      console.warn('d1CreateChargingSession error:', err);
    }
  }
  if (env.TRIP_KV) {
    try {
      await env.TRIP_KV.put(`d1_fallback:active_charging_session:${v}`, JSON.stringify({ ...session, vin: v }));
    } catch (_) {}
  }
}

async function d1UpdateChargingSession(env: Env, sessionId: string, updates: any) {
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare(`
        UPDATE charging_sessions SET
          status = COALESCE(?, status),
          start_time = COALESCE(?, start_time),
          end_time = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, end_time) END,
          start_soc = COALESCE(?, start_soc),
          end_soc = COALESCE(?, end_soc),
          soc_added = COALESCE(?, soc_added),
          kwh_added = COALESCE(?, kwh_added),
          energy_used_kwh = COALESCE(?, energy_used_kwh),
          charging_loss_kwh = COALESCE(?, charging_loss_kwh),
          charge_type = COALESCE(?, charge_type),
          peak_power_kw = COALESCE(?, peak_power_kw),
          last_power_kw = COALESCE(?, last_power_kw),
          end_range_km = COALESCE(?, end_range_km),
          start_lat = COALESCE(?, start_lat),
          start_lng = COALESCE(?, start_lng),
          location = COALESCE(?, location),
          outage_count = COALESCE(?, outage_count),
          paused_at = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, paused_at) END,
          pause_pending_at = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, pause_pending_at) END,
          active_duration_seconds = COALESCE(?, active_duration_seconds),
          last_poll_time = COALESCE(?, last_poll_time),
          date = COALESCE(?, date)
        WHERE id = ?
      `).bind(
        updates.status ?? null,
        updates.start_time ?? null,
        updates.end_time === null ? 1 : 0,
        updates.end_time ?? null,
        updates.start_soc ?? null,
        updates.end_soc ?? null,
        updates.soc_added ?? null,
        updates.kwh_added ?? null,
        updates.energy_used_kwh ?? null,
        updates.charging_loss_kwh ?? null,
        updates.charge_type ?? null,
        updates.peak_power_kw ?? null,
        updates.last_power_kw ?? null,
        updates.end_range_km ?? null,
        updates.start_lat ?? null,
        updates.start_lng ?? null,
        updates.location ?? null,
        updates.outage_count ?? null,
        updates.paused_at === null ? 1 : 0,
        updates.paused_at ?? null,
        updates.pause_pending_at === null ? 1 : 0,
        updates.pause_pending_at ?? null,
        updates.active_duration_seconds ?? null,
        updates.last_poll_time ?? Math.floor(Date.now() / 1000),
        updates.date ?? null,
        sessionId
      ).run();
    } catch (err) {
      console.warn('d1UpdateChargingSession error:', err);
    }
  }
  if (env.TRIP_KV && (updates?.vin)) {
    try {
      const kvKey = `d1_fallback:active_charging_session:${normVin(updates.vin)}`;
      if (updates.status === 'completed') {
        await env.TRIP_KV.delete(kvKey);
      } else {
        const active = (await env.TRIP_KV.get(kvKey, 'json')) || {};
        await env.TRIP_KV.put(kvKey, JSON.stringify({ ...active, ...updates }));
      }
    } catch (_) {}
  }
}

async function d1DeleteChargingSession(env: Env, sessionId: string, vin?: string | null) {
  const v = requireScopedVin(vin);
  if (env.DB) {
    await initD1(env.DB);
    try {
      if (v) {
        await env.DB.prepare('DELETE FROM charging_sessions WHERE id = ? AND vin = ?').bind(sessionId, v).run();
      } else {
        await env.DB.prepare('DELETE FROM charging_sessions WHERE id = ?').bind(sessionId).run();
      }
    } catch (_) {}
  }
  if (env.TRIP_KV && v) {
    try {
      await env.TRIP_KV.delete(`d1_fallback:active_charging_session:${v}`);
    } catch (_) {}
  }
}

async function d1GetChargingHistory(env: Env, limit = 50, vin?: string | null) {
  const v = requireScopedVin(vin);
  if (!v) return [];
  if (env.DB) {
    await initD1(env.DB);
    try {
      const res = await env.DB.prepare(
        'SELECT * FROM charging_sessions WHERE vin = ? ORDER BY start_time DESC LIMIT ?'
      ).bind(v, limit).all();
      return (res.results || []).map(normalizeChargeSessionRow);
    } catch (_) {}
  }
  return [];
}

async function d1ClearChargingHistory(env: Env, vin?: string | null) {
  const v = requireScopedVin(vin);
  if (!v) return;
  if (env.DB) {
    await initD1(env.DB);
    try {
      await env.DB.prepare('DELETE FROM charging_sessions WHERE vin = ?').bind(v).run();
    } catch (_) {}
  }
  if (env.TRIP_KV) {
    try {
      await env.TRIP_KV.delete(`d1_fallback:active_charging_session:${v}`);
    } catch (_) {}
  }
}

// ---------------------------------------------------------------- Core 10-Scenario State Machine
async function syncChargingSessionState(
  env: Env,
  url: URL,
  liveTelem: any,
  triggerSource: string = 'poll',
  vin?: string | null
): Promise<any> {
  const v = normVin(vin || url.searchParams.get('vin'));
  const activeSession = await d1GetActiveChargingSession(env, v);
  const nowSec = Math.floor(Date.now() / 1000);
  const hasChargeData = liveTelem?.hasChargeTelemetry !== false;

  // If no active charging session in D1
  if (!activeSession) {
    if (!hasChargeData && triggerSource !== 'trip_start') {
      return null;
    }
    if (!liveTelem.isCharging) {
      // Missed Fast Charge Recovery: If the car is no longer actively charging when polled (or when the next trip starts),
      // check if SOC jumped by >= 3% since the last completed trip at the same odometer without a recorded charging session.
      const lastTrip = await d1GetLastCompletedTrip(env, v);
      const lastSession = await d1GetLastCompletedChargingSession(env, v);
      if (
        lastTrip &&
        lastTrip.end_timestamp &&
        lastTrip.end_soc != null &&
        Math.abs(liveTelem.odometer - (Number(lastTrip.end_odometer_km) || liveTelem.odometer)) < 0.5
      ) {
        const parkTime = Number(lastTrip.end_timestamp);
        const parkSoc = Number(lastTrip.end_soc);
        const socGain = Math.max(0, liveTelem.soc - parkSoc);
        const alreadyLogged =
          lastSession && Number(lastSession.start_time) >= parkTime - 300;
        if (socGain >= 3 && !alreadyLogged && nowSec > parkTime + 120) {
          const bmsElapsed = Math.max(0, Math.min(86400, Number(liveTelem.chargeTimeElapsedSec) || 0));
          const estStartTime = Math.min(nowSec - 60, parkTime + 120);
          const estDurationSec =
            bmsElapsed >= 120 && bmsElapsed <= nowSec - parkTime
              ? bmsElapsed
              : Math.max(60, nowSec - estStartTime);
          const estEndTime = Math.min(nowSec, estStartTime + estDurationSec);
          const kwhAdded = Number(((socGain / 100) * 38.0).toFixed(2));
          const impliedKw = Number((kwhAdded / (estDurationSec / 3600)).toFixed(1));
          const chargeType: 'AC' | 'DC' = impliedKw > 11 ? 'DC' : 'AC';
          const effFactor = chargeType === 'DC' ? 0.94 : 0.88;
          const grossEnergyUsed = Number((kwhAdded / effFactor).toFixed(2));
          const lossKwh = Math.max(0, Number((grossEnergyUsed - kwhAdded).toFixed(2)));
          const peakKw = chargeType === 'DC' ? Math.max(30, impliedKw) : (impliedKw > 4.2 ? 7.4 : 3.3);
          const recLat = hasValidGpsCoords(liveTelem.lat, liveTelem.lng)
            ? liveTelem.lat
            : (hasValidGpsCoords(lastTrip.end_lat, lastTrip.end_lng) ? lastTrip.end_lat : null);
          const recLng = hasValidGpsCoords(liveTelem.lat, liveTelem.lng)
            ? liveTelem.lng
            : (hasValidGpsCoords(lastTrip.end_lat, lastTrip.end_lng) ? lastTrip.end_lng : null);
          const recLocation = hasValidGpsCoords(liveTelem.lat, liveTelem.lng)
            ? await resolveLocation(liveTelem.lat, liveTelem.lng)
            : (lastTrip.end_location || (hasValidGpsCoords(recLat, recLng) ? await resolveLocation(recLat, recLng) : null));
          const estStartRangeKm = Math.round((parkSoc / 100) * BMS_FULL_RANGE_KM);
          const recEndRangeKm = resolveChargingEndRangeKm({
            startRangeKm: estStartRangeKm,
            liveRangeKm: liveTelem.rangeKm,
            startSoc: parkSoc,
            endSoc: liveTelem.soc,
            isComplete: true,
          });
          const recoveredSession = {
            id: 'chg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            vin: v || null,
            status: 'completed',
            start_time: estStartTime,
            end_time: estEndTime,
            start_soc: parkSoc,
            end_soc: liveTelem.soc,
            soc_added: socGain,
            kwh_added: kwhAdded,
            energy_used_kwh: grossEnergyUsed,
            charging_loss_kwh: lossKwh,
            charge_type: chargeType,
            peak_power_kw: peakKw,
            last_power_kw: 0,
            start_odometer_km: liveTelem.odometer,
            start_range_km: estStartRangeKm,
            end_range_km: recEndRangeKm,
            start_lat: recLat,
            start_lng: recLng,
            location: recLocation,
            outage_count: 0,
            paused_at: null,
            active_duration_seconds: estDurationSec,
            last_poll_time: nowSec,
            date: istDateString(estStartTime),
          };
          await d1CreateChargingSession(env, recoveredSession);
          const title = `🔋 Charging Completed (${liveTelem.soc}%)`;
          const body = `Added +${socGain}% (+${kwhAdded} kWh ${chargeType}) • Used ${grossEnergyUsed} kWh • ${Math.round(estDurationSec / 60)}m`;
          await dispatchTripNotification(url, title, body, 'battery,white_check_mark', env, v);
          await d1InsertNotification(env, {
            id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
            vin: v || null,
            type: 'charge_end',
            title,
            message: body,
            timestamp: nowSec,
            date: istDateString(nowSec),
            is_read: 0,
            metadata: JSON.stringify(recoveredSession),
          });
          return recoveredSession;
        }
      }
      return null;
    }

    // SCENARIO 4 RESUMPTION: Check if this is a resumption of a session that ended < 6h ago at exact same odo
    const lastSession = await d1GetLastCompletedChargingSession(env, v);
    if (
      lastSession &&
      lastSession.end_time &&
      (nowSec - Number(lastSession.end_time) < 21600) &&
      (Math.abs(liveTelem.odometer - Number(lastSession.start_odometer_km)) < 0.2)
    ) {
      const resumedEndRange = resolveChargingEndRangeKm({
        startRangeKm: lastSession.start_range_km,
        storedEndRangeKm: lastSession.end_range_km,
        liveRangeKm: liveTelem.rangeKm,
        startSoc: Number(lastSession.start_soc) || 0,
        endSoc: Math.max(liveTelem.soc, Number(lastSession.end_soc) || 0),
      });
      const updates: any = {
        status: 'ongoing',
        end_time: null,
        last_power_kw: liveTelem.powerKw,
        peak_power_kw: Math.max(Number(lastSession.peak_power_kw) || 0, liveTelem.powerKw),
        end_range_km: resumedEndRange ?? undefined,
        last_poll_time: nowSec,
      };
      if ((!lastSession.location || lastSession.start_lat == null) && hasValidGpsCoords(liveTelem.lat, liveTelem.lng)) {
        updates.start_lat = liveTelem.lat;
        updates.start_lng = liveTelem.lng;
        updates.location = await resolveLocation(liveTelem.lat, liveTelem.lng);
      }
      await d1UpdateChargingSession(env, lastSession.id, updates);
      return { ...lastSession, ...updates };
    }

    // SCENARIO 1 & 2: Start brand new charging session
    // Backdate start_time and initialize active_duration_seconds from the vehicle BMS elapsed time
    // (charge_time_elapsed_s / start_time) when discovered by the 30-min idle cron poll!
    const lastTrip = await d1GetLastCompletedTrip(env, v);
    let startSoc = liveTelem.soc;
    const isSameOdoAsLastTrip =
      Boolean(
        lastTrip &&
        Math.abs(liveTelem.odometer - (Number(lastTrip.end_odometer_km) || liveTelem.odometer)) < 0.3
      );
    if (isSameOdoAsLastTrip && lastTrip.end_soc != null) {
      startSoc = Math.min(liveTelem.soc, Number(lastTrip.end_soc));
    }

    let bmsElapsedSec = Math.max(0, Math.min(86400, Number(liveTelem.chargeTimeElapsedSec) || 0));
    if (
      isSameOdoAsLastTrip &&
      lastTrip.end_timestamp &&
      Number(lastTrip.end_timestamp) <= nowSec
    ) {
      const maxSincePark = Math.max(0, nowSec - Number(lastTrip.end_timestamp));
      if (bmsElapsedSec > maxSincePark) {
        bmsElapsedSec = maxSincePark;
      }
    }

    const actualStartTime = nowSec - bmsElapsedSec;
    const chargeType: 'AC' | 'DC' = liveTelem.powerKw > 11 ? 'DC' : 'AC';
    const effFactor = chargeType === 'DC' ? 0.94 : 0.88;
    const prePollWallKwh = Number(((liveTelem.powerKw * (bmsElapsedSec / 3600))).toFixed(3));

    // If startSoc wasn't anchored by a prior trip at the same odometer, back-calculate the SOC added during bmsElapsedSec
    if (startSoc >= liveTelem.soc && bmsElapsedSec >= 120) {
      const estPackKwhAdded = prePollWallKwh * effFactor;
      const estSocAdded = Math.round((estPackKwhAdded / 38.0) * 100);
      if (estSocAdded > 0) {
        startSoc = Math.max(0, liveTelem.soc - estSocAdded);
      }
    }

    const initialSocAdded = Math.max(0, liveTelem.soc - startSoc);
    const initialKwhAdded = Number(((initialSocAdded / 100) * 38.0).toFixed(2));
    const initialEnergyUsed = Math.max(prePollWallKwh, Number((initialKwhAdded / effFactor).toFixed(2)));
    const initialLossKwh = Math.max(0, Number((initialEnergyUsed - initialKwhAdded).toFixed(2)));

    const startLat = hasValidGpsCoords(liveTelem.lat, liveTelem.lng)
      ? liveTelem.lat
      : (isSameOdoAsLastTrip && hasValidGpsCoords(lastTrip?.end_lat, lastTrip?.end_lng) ? lastTrip.end_lat : null);
    const startLng = hasValidGpsCoords(liveTelem.lat, liveTelem.lng)
      ? liveTelem.lng
      : (isSameOdoAsLastTrip && hasValidGpsCoords(lastTrip?.end_lat, lastTrip?.end_lng) ? lastTrip.end_lng : null);
    const chargeLocation = hasValidGpsCoords(startLat, startLng)
      ? await resolveLocation(startLat, startLng)
      : (isSameOdoAsLastTrip && lastTrip?.end_location ? lastTrip.end_location : null);

    const newSession = {
      id: 'chg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      vin: v || null,
      status: 'ongoing',
      start_time: actualStartTime,
      end_time: null,
      start_soc: startSoc,
      end_soc: liveTelem.soc,
      soc_added: initialSocAdded,
      kwh_added: initialKwhAdded,
      energy_used_kwh: initialEnergyUsed,
      charging_loss_kwh: initialLossKwh,
      charge_type: chargeType,
      peak_power_kw: liveTelem.powerKw,
      last_power_kw: liveTelem.powerKw,
      start_odometer_km: liveTelem.odometer,
      start_range_km: liveTelem.rangeKm,
      end_range_km: resolveChargingEndRangeKm({
        startRangeKm: liveTelem.rangeKm,
        liveRangeKm: liveTelem.rangeKm,
        startSoc,
        endSoc: liveTelem.soc,
      }),
      start_lat: startLat,
      start_lng: startLng,
      location: chargeLocation,
      outage_count: 0,
      paused_at: null,
      active_duration_seconds: bmsElapsedSec,
      last_poll_time: nowSec,
      date: istDateString(actualStartTime),
    };

    await d1CreateChargingSession(env, newSession);

    // NOTIFICATIONS ENGINE: Charging Started
    const title = `⚡ Charging Started (${chargeType})`;
    const startedTimeSuffix = bmsElapsedSec >= 120 ? ` at ${formatClockTime(actualStartTime)}` : '';
    const body = `Started${startedTimeSuffix} at ${startSoc}% (${liveTelem.rangeKm} km) • Drawing ${liveTelem.powerKw} kW`;
    await dispatchTripNotification(url, title, body, 'electric_plug,zap', env, v);
    await d1InsertNotification(env, {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      vin: v || null,
      type: 'charge_start',
      title,
      message: body,
      timestamp: nowSec,
      date: istDateString(actualStartTime),
      is_read: 0,
      metadata: JSON.stringify(newSession),
    });

    return newSession;
  }

  // Active session exists (either 'ongoing' or 'paused')
  const sessionVin = normVin(activeSession.vin) || v || null;
  const startOdo = Number(activeSession.start_odometer_km) || liveTelem.odometer;
  const odoDiff = Math.max(0, Number((liveTelem.odometer - startOdo).toFixed(1)));
  const startSoc = Number(activeSession.start_soc) || 0;
  // SCENARIO 9: Cabin Pre-Cooling (preserve peak SoC)
  const currentSoc = Math.max(liveTelem.soc, Number(activeSession.end_soc) || startSoc);

  // SCENARIO 5: Car drove away (live.odo > start_odo) OR CarPlay trip started OR test_end
  if (odoDiff >= 0.2 || triggerSource === 'trip_start' || triggerSource === 'test_end') {
    const wallDurationSec = Math.max(0, nowSec - (Number(activeSession.start_time) || nowSec));
    const activeSec = Math.max(
      Number(activeSession.active_duration_seconds) || 0,
      (Number(activeSession.outage_count) || 0) === 0 ? wallDurationSec : 0
    );
    const socAdded = Math.max(0, currentSoc - startSoc);

    // SCENARIO 8: False Trigger / Brief Plug Test (< 1% added & active_duration < 180s)
    if (triggerSource !== 'test_end' && socAdded <= 0 && activeSec < 180) {
      await d1DeleteChargingSession(env, activeSession.id, v);
      return null; // Suppress notification and remove noise row
    }

    // Energy Calculation Engine
    const kwhAdded = Number(((socAdded / 100) * 38.0).toFixed(2));
    const effFactor = (activeSession.charge_type === 'DC' || Number(activeSession.peak_power_kw) > 11) ? 0.94 : 0.88;
    const grossEnergyUsed = Math.max(Number(activeSession.energy_used_kwh) || 0, Number((kwhAdded / effFactor).toFixed(2)));
    const lossKwh = Math.max(0, Number((grossEnergyUsed - kwhAdded).toFixed(2)));
    const durationMin = Math.round(activeSec / 60);

    const completedEndRangeKm = resolveChargingEndRangeKm({
      startRangeKm: activeSession.start_range_km,
      storedEndRangeKm: activeSession.end_range_km,
      liveRangeKm: liveTelem.rangeKm,
      startSoc,
      endSoc: currentSoc,
      isComplete: true,
    });

    const completedUpdates = {
      status: 'completed',
      end_time: nowSec,
      end_soc: currentSoc,
      soc_added: socAdded,
      kwh_added: kwhAdded,
      energy_used_kwh: grossEnergyUsed,
      charging_loss_kwh: lossKwh,
      peak_power_kw: Math.max(Number(activeSession.peak_power_kw) || 0, 3.3),
      last_power_kw: 0,
      end_range_km: completedEndRangeKm,
      pause_pending_at: null,
      active_duration_seconds: activeSec,
      last_poll_time: nowSec,
    };
    await d1UpdateChargingSession(env, activeSession.id, completedUpdates);

    // NOTIFICATIONS ENGINE: Charging Completed
    const title = `🔋 Charging Completed (${currentSoc}%)`;
    const body = `Added +${socAdded}% (+${kwhAdded} kWh) • Used ${grossEnergyUsed} kWh • ${durationMin}m`;
    await dispatchTripNotification(url, title, body, 'battery,white_check_mark', env, sessionVin);
    await d1InsertNotification(env, {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      vin: sessionVin,
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

  const decision = evaluateChargingStateDecision(activeSession, liveTelem, currentSoc, nowSec);

  // SCENARIO 10: Charge telemetry unavailable / timed out — leave session untouched.
  if (decision.action === 'ignore_unavailable') {
    return activeSession;
  }

  // SCENARIO 6: Full Charge Auto-Shutoff (100% or >=99% & charger stopped)
  if (decision.action === 'complete_full') {
    const wallDurationSec = Math.max(0, nowSec - (Number(activeSession.start_time) || nowSec));
    const activeSec = Math.max(
      Number(activeSession.active_duration_seconds) || 0,
      (Number(activeSession.outage_count) || 0) === 0 ? wallDurationSec : 0
    );
    const endSoc = 100;
    const socAdded = Math.max(0, endSoc - startSoc);
    const kwhAdded = Number(((socAdded / 100) * 38.0).toFixed(2));
    const effFactor = (activeSession.charge_type === 'DC' || Number(activeSession.peak_power_kw) > 11) ? 0.94 : 0.88;
    const grossEnergyUsed = Math.max(Number(activeSession.energy_used_kwh) || 0, Number((kwhAdded / effFactor).toFixed(2)));
    const lossKwh = Math.max(0, Number((grossEnergyUsed - kwhAdded).toFixed(2)));
    const durationMin = Math.round(activeSec / 60);
    const fullEndRangeKm = resolveChargingEndRangeKm({
      startRangeKm: activeSession.start_range_km,
      storedEndRangeKm: activeSession.end_range_km,
      liveRangeKm: liveTelem.rangeKm,
      startSoc,
      endSoc,
      isComplete: true,
    });

    const completedUpdates: any = {
      status: 'completed',
      end_time: nowSec,
      end_soc: endSoc,
      soc_added: socAdded,
      kwh_added: kwhAdded,
      energy_used_kwh: grossEnergyUsed,
      charging_loss_kwh: lossKwh,
      peak_power_kw: Math.max(Number(activeSession.peak_power_kw) || 0, 3.3),
      last_power_kw: 0,
      end_range_km: fullEndRangeKm,
      pause_pending_at: null,
      active_duration_seconds: activeSec,
      last_poll_time: nowSec,
    };
    if ((!activeSession.location || activeSession.start_lat == null) && hasValidGpsCoords(liveTelem.lat, liveTelem.lng)) {
      completedUpdates.start_lat = liveTelem.lat;
      completedUpdates.start_lng = liveTelem.lng;
      completedUpdates.location = await resolveLocation(liveTelem.lat, liveTelem.lng);
    }
    await d1UpdateChargingSession(env, activeSession.id, completedUpdates);

    // NOTIFICATIONS ENGINE: Full Charge (100%)
    const title = `🔋 Charging Complete (100%)`;
    const body = `Full charge reached! Added +${socAdded}% (+${kwhAdded} kWh) • Used ${grossEnergyUsed} kWh • ${durationMin}m`;
    await dispatchTripNotification(url, title, body, 'battery,sparkles', env, sessionVin);
    await d1InsertNotification(env, {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      vin: sessionVin,
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

  // First non-charging poll (< 2 min confirmed): record pending timestamp without pausing or notifying.
  if (decision.action === 'pending_pause') {
    const pendingUpdates = {
      pause_pending_at: decision.pausePendingAt,
      end_soc: currentSoc,
      last_poll_time: Number(activeSession.last_poll_time) || nowSec,
    };
    await d1UpdateChargingSession(env, activeSession.id, pendingUpdates);
    return { ...activeSession, ...pendingUpdates };
  }

  // SCENARIO 3: Confirmed Mid-Charge Grid Power Outage / Breaker Cut
  if (decision.action === 'confirm_pause') {
    const updates = {
      status: 'paused',
      paused_at: decision.pausedAt,
      pause_pending_at: null,
      end_soc: currentSoc,
      last_power_kw: 0,
      last_poll_time: nowSec,
    };
    await d1UpdateChargingSession(env, activeSession.id, updates);

    const pauseTitle = '⚠️ Charging Paused (Grid Outage / Breaker Cut)';
    const pauseBody = `Grid power dropped at ${currentSoc}%. Waiting for power to restore...`;
    await dispatchTripNotification(url, pauseTitle, pauseBody, 'warning,electric_plug', env, sessionVin);
    await d1InsertNotification(env, {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      vin: sessionVin,
      type: 'charge_paused',
      title: pauseTitle,
      message: pauseBody,
      timestamp: nowSec,
      date: istDateString(nowSec),
      is_read: 0,
      metadata: JSON.stringify({ ...activeSession, ...updates }),
    });

    return { ...activeSession, ...updates };
  }

  if (decision.action === 'stay_paused') {
    const pausedSec = nowSec - (Number(activeSession.paused_at) || nowSec);
    if (pausedSec > 28800) { // Paused > 8 hours -> finalize
      const socAdded = Math.max(0, currentSoc - startSoc);
      const kwhAdded = Number(((socAdded / 100) * 38.0).toFixed(2));
      const effFactor = (activeSession.charge_type === 'DC') ? 0.94 : 0.88;
      const grossEnergyUsed = Math.max(Number(activeSession.energy_used_kwh) || 0, Number((kwhAdded / effFactor).toFixed(2)));
      const lossKwh = Math.max(0, Number((grossEnergyUsed - kwhAdded).toFixed(2)));
      const pausedTimeoutEndRangeKm = resolveChargingEndRangeKm({
        startRangeKm: activeSession.start_range_km,
        storedEndRangeKm: activeSession.end_range_km,
        liveRangeKm: liveTelem.rangeKm,
        startSoc,
        endSoc: currentSoc,
        isComplete: true,
      });
      const updates = {
        status: 'completed',
        end_time: activeSession.paused_at || nowSec,
        end_soc: currentSoc,
        soc_added: socAdded,
        kwh_added: kwhAdded,
        energy_used_kwh: grossEnergyUsed,
        charging_loss_kwh: lossKwh,
        end_range_km: pausedTimeoutEndRangeKm,
        pause_pending_at: null,
        last_poll_time: nowSec,
      };
      await d1UpdateChargingSession(env, activeSession.id, updates);
      return { ...activeSession, ...updates };
    }
    return activeSession;
  }

  // SCENARIOS 3 (restored), 4 (solar/fluctuating), 7 (DC fast charge)
  if (decision.action === 'charging') {
    let outageCount = Number(activeSession.outage_count) || 0;
    const wasPaused = activeSession.status === 'paused';
    if (wasPaused) {
      outageCount += 1;
    }

    const lastPoll = Number(activeSession.last_poll_time) || nowSec;
    const deltaSec = Math.max(0, Math.min(3600, nowSec - lastPoll));
    let activeSec = (Number(activeSession.active_duration_seconds) || 0) + (activeSession.status === 'ongoing' ? deltaSec : 0);
    let updatedStartTime: number | undefined = undefined;
    let updatedDate: string | undefined = undefined;

    const bmsElapsed = Math.max(0, Math.min(86400, Number(liveTelem.chargeTimeElapsedSec) || 0));
    if (outageCount === 0 && bmsElapsed > 0) {
      if (bmsElapsed > activeSec) {
        activeSec = bmsElapsed;
      }
      const bmsDerivedStart = nowSec - bmsElapsed;
      const curStart = Number(activeSession.start_time) || nowSec;
      if (bmsDerivedStart < curStart - 60) {
        updatedStartTime = bmsDerivedStart;
        updatedDate = istDateString(bmsDerivedStart);
      }
    }

    const deltaHours = deltaSec / 3600;
    const stepKwh = liveTelem.powerKw * deltaHours;
    const integratedKwh = Number(((Number(activeSession.energy_used_kwh) || 0) + stepKwh).toFixed(3));
    const socAdded = Math.max(0, currentSoc - startSoc);
    const kwhAdded = Number(((socAdded / 100) * 38.0).toFixed(2));
    const peakKw = Math.max(Number(activeSession.peak_power_kw) || 0, liveTelem.powerKw);
    const chargeType: 'AC' | 'DC' = peakKw > 11 ? 'DC' : 'AC';
    const effFactor = chargeType === 'DC' ? 0.94 : 0.88;
    const grossEnergyUsed = Math.max(integratedKwh, Number((kwhAdded / effFactor).toFixed(2)));
    const lossKwh = Math.max(0, Number((grossEnergyUsed - kwhAdded).toFixed(2)));

    const ongoingEndRangeKm = resolveChargingEndRangeKm({
      startRangeKm: activeSession.start_range_km,
      storedEndRangeKm: activeSession.end_range_km,
      liveRangeKm: liveTelem.rangeKm,
      startSoc,
      endSoc: currentSoc,
    });

    const updates: any = {
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
      pause_pending_at: null,
      last_poll_time: nowSec,
    };
    if (ongoingEndRangeKm != null) {
      updates.end_range_km = ongoingEndRangeKm;
    }
    if ((!activeSession.location || activeSession.start_lat == null) && hasValidGpsCoords(liveTelem.lat, liveTelem.lng)) {
      updates.start_lat = liveTelem.lat;
      updates.start_lng = liveTelem.lng;
      updates.location = await resolveLocation(liveTelem.lat, liveTelem.lng);
    }
    if (updatedStartTime !== undefined) {
      updates.start_time = updatedStartTime;
      updates.date = updatedDate;
    }
    await d1UpdateChargingSession(env, activeSession.id, updates);

    if (wasPaused) {
      const resumeTitle = `⚡ Charging Resumed (${chargeType})`;
      const resumeBody = `Grid power restored! Charging continuing at ${currentSoc}% • Drawing ${liveTelem.powerKw} kW`;
      await dispatchTripNotification(url, resumeTitle, resumeBody, 'electric_plug,zap', env, sessionVin);
      await d1InsertNotification(env, {
        id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        vin: sessionVin,
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

function workerAuthDeps(env: Env) {
  return {
    store: createEnvAuthKvStore(env, initD1),
    db: createD1AuthDbAdapter(env.DB),
    isMaster: (phone: string) => isMasterAdminPhone(phone, env),
  };
}

async function requireAppVin(
  env: Env,
  request: Request,
  url: URL,
  body?: any
): Promise<{ vin: string; phone: string; uid?: string; token: string } | Response> {
  const { store, db, isMaster } = workerAuthDeps(env);
  const res = await resolveAppAuth(store, db, isMaster, request, url, body);
  if (!res.ok) {
    return json({ success: false, error: res.error }, res.status);
  }
  return res;
}

async function handleCarCommand(
  env: Env,
  request: Request,
  url: URL,
  body: any,
  action: 'unlock' | 'lock' | 'climate-on' | 'climate-off'
): Promise<Response> {
  const wantsText = url.searchParams.get('format') === 'text';
  const reply = (payload: Record<string, any>, status = 200) => {
    if (wantsText) {
      const msg = payload.success ? `✅ ${payload.message}` : `❌ ${payload.error || 'Command failed'}`;
      return new Response(msg, {
        status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS },
      });
    }
    return json(payload, status);
  };

  const { store, db, isMaster } = workerAuthDeps(env);
  const auth = await resolveWebhookAuth(store, db, isMaster, request, url, body);
  if (!auth.ok) {
    return reply({ success: false, error: auth.error }, auth.status);
  }

  // Option A: 4-digit Control PIN is supplied per-request by iOS Shortcuts / Siri and never stored in D1.
  const pin = String(
    url.searchParams.get('pin') || request.headers.get('x-mg-pin') || body?.pin || ''
  ).trim();
  if (!/^\d{4}$/.test(pin)) {
    return reply(
      {
        success: false,
        code: 'PIN_REQUIRED',
        error: 'A 4-digit MG Control PIN (?pin=1234) is required in the shortcut link.',
      },
      400
    );
  }

  const mg = await getMgClientForVin(env, auth.vin, pin);
  if (!mg) {
    return reply(
      {
        success: false,
        code: 'NO_VEHICLE_SESSION',
        error: 'No active car session found on server. Open the MG Windsor app once to connect.',
      },
      401
    );
  }

  try {
    let message = '';
    if (action === 'unlock') {
      await mg.client.controlDoorLock(false);
      message = 'Doors unlocked successfully';
    } else if (action === 'lock') {
      await mg.client.controlDoorLock(true);
      message = 'Doors locked successfully';
    } else if (action === 'climate-on') {
      await mg.client.controlClimate(true);
      message = 'Climate AC turned on';
    } else {
      await mg.client.controlClimate(false);
      message = 'Climate AC turned off';
    }
    return reply({ success: true, action, message });
  } catch (err: any) {
    const rawMsg = err?.message || String(err || 'Command failed');
    const isExpired =
      /password|token|expired|unauthorized|login|session|401|403/i.test(rawMsg);
    if (isExpired) {
      return reply(
        {
          success: false,
          code: 'MG_SESSION_EXPIRED',
          error: 'MG car session expired. Open the MG Windsor app once to refresh it, then retry.',
        },
        401
      );
    }
    return reply({ success: false, error: rawMsg }, 500);
  }
}

async function handleApi(env: Env, request: Request, url: URL): Promise<Response> {
  const path = url.pathname;
  if (path === '/api/push-vapid-public-key') {
    return json({ success: true, publicKey: VAPID_PUB_B64URL });
  }
  if (path.startsWith('/api/widget')) {
    return json({ success: false, message: 'Widgets disabled' });
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
  if (request.method === 'POST' || request.method === 'DELETE') {
    try {
      body = await request.json();
    } catch (_) {}
  }

  // ----------------------------------------------------------- Access Control & Admin Portal APIs
  if (path.startsWith('/api/auth/')) {
    if (env.DB) await initD1(env.DB);
    return await handleAuthApi(env, request, url, body);
  }
  if (path.startsWith('/api/admin/')) {
    if (env.DB) await initD1(env.DB);
    return await handleAdminApi(env, request, url, body);
  }

  // ----------------------------------------------------------- Private Webhook Key & Car Command Endpoints
  if (path === '/api/webhook-key') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const { store } = workerAuthDeps(env);
    const webhookKey = await ensureWebhookKey(store, auth.vin, auth.phone, false);
    return json({ success: true, vin: auth.vin, webhookKey });
  }

  if (path === '/api/webhook-key/regenerate') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const { store } = workerAuthDeps(env);
    const webhookKey = await ensureWebhookKey(store, auth.vin, auth.phone, true);
    return json({
      success: true,
      vin: auth.vin,
      webhookKey,
      message: 'Private Shortcut & CarPlay links regenerated. Previous links have been revoked.',
    });
  }

  if (
    path === '/api/command/unlock' ||
    path === '/api/command/lock' ||
    path === '/api/command/climate-on' ||
    path === '/api/command/climate-off'
  ) {
    const cmd = path.replace('/api/command/', '') as 'unlock' | 'lock' | 'climate-on' | 'climate-off';
    return await handleCarCommand(env, request, url, body, cmd);
  }

  // ----------------------------------------------------------- Native iOS (APNs Web Push) & Android (FCM Web Push) Endpoints
  if (path === '/api/push-subscribe') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const sub = body?.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return json({ success: false, error: 'Invalid PushSubscription object' }, 400);
    }
    const targetVin = auth.vin;
    const key = `push_subs:${targetVin}`;
    const existingRaw = await d1KvGet(env, key);
    const existing: PushSubscription[] = Array.isArray(existingRaw) ? existingRaw : [];
    const newEntry: PushSubscription = {
      endpoint: String(sub.endpoint),
      keys: {
        p256dh: String(sub.keys.p256dh),
        auth: String(sub.keys.auth),
      },
      userAgent: String(body?.userAgent || request.headers.get('user-agent') || ''),
      addedSec: Math.floor(Date.now() / 1000),
    };
    const filtered = existing.filter((s) => s.endpoint !== newEntry.endpoint);
    filtered.push(newEntry);
    await d1KvPut(env, key, filtered);

    // Send welcome push notification immediately to verify APNs / FCM delivery
    const welcomeRes = await sendPushToSubscription(newEntry, {
      title: '🔔 MG Windsor EV • Push Alerts Active',
      body: 'Native push notifications are now active on this device. You will receive Trip & Charging alerts automatically!',
      tag: 'windsor-welcome',
      data: { vin: targetVin, url: '/' },
    });

    return json({
      success: true,
      vin: targetVin,
      devicesCount: filtered.length,
      welcomeSent: welcomeRes.ok,
      welcomeStatus: welcomeRes.status,
    });
  }

  if (path === '/api/push-unsubscribe') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const endpoint = String(body?.endpoint || url.searchParams.get('endpoint') || '').trim();
    const key = `push_subs:${auth.vin}`;
    const existingRaw = await d1KvGet(env, key);
    const existing: PushSubscription[] = Array.isArray(existingRaw) ? existingRaw : [];
    const remaining = endpoint ? existing.filter((s) => s.endpoint !== endpoint) : [];
    await d1KvPut(env, key, remaining);
    return json({ success: true, devicesCount: remaining.length });
  }

  if (path === '/api/push-test') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const nowSec = Math.floor(Date.now() / 1000);
    const title = '🚗 MG Windsor EV • Live Push Test';
    const message = `Native Web Push delivered at ${formatClockTime(nowSec)}! Trip Start, Trip End & Charging alerts are ready.`;
    const pushResult = await dispatchTripNotification(url, title, message, 'windsor-test', env, auth.vin);
    if (!pushResult.total) {
      return json({
        success: false,
        error: 'No push subscription registered for this vehicle yet. Tap "Enable Push Notifications" in the app first.',
        pushResult,
      }, 400);
    }
    return json({
      success: pushResult.sent > 0,
      message: pushResult.sent > 0 ? `Delivered to ${pushResult.sent} device(s)` : 'Push endpoint returned an error',
      pushResult,
    });
  }

  // ----------------------------------------------------------- EV Trip Planner Google Maps Proxy Endpoints (Ported from Volta)
  if (path === '/api/planner/google-verify-key') {
    const apiKey = String(body?.apiKey || '').trim();
    if (!apiKey) return json({ ok: false, message: 'API key is empty' }, 400);
    try {
      const elevRes = await fetch(
        `https://maps.googleapis.com/maps/api/elevation/json?locations=10.0261,76.3125&key=${encodeURIComponent(apiKey)}`
      );
      const elevJson: any = await elevRes.json();
      if (elevJson.status && elevJson.status !== 'OK') {
        return json({
          ok: false,
          message: `Elevation API: ${elevJson.error_message || elevJson.status}. Enable "Maps Elevation API", "Routes API", and "Places API (New)" in Google Cloud Console.`,
        });
      }
      return json({
        ok: true,
        message: 'Google Maps Platform API Key verified! Live Traffic, Elevation & CCS2 Plug Availability enabled.',
      });
    } catch (e) {
      return json({ ok: false, message: (e as Error).message }, 500);
    }
  }

  if (path === '/api/planner/google-autocomplete') {
    const apiKey = String(body?.apiKey || '').trim();
    const input = String(body?.input || '').trim();
    const near = body?.near;
    if (!apiKey || !input) return json({ suggestions: [] });
    try {
      const reqBody: any = {
        input,
        includedRegionCodes: ['in'],
      };
      if (near && near.lat && near.lng) {
        reqBody.locationBias = {
          circle: {
            center: { latitude: Number(near.lat), longitude: Number(near.lng) },
            radius: 50000.0,
          },
        };
      }
      const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
        },
        body: JSON.stringify(reqBody),
      });
      const data: any = await res.json();
      const suggestions = (data.suggestions || [])
        .map((s: any) => s.placePrediction)
        .filter(Boolean)
        .map((p: any) => ({
          placeId: p.placeId,
          title: p.structuredFormat?.mainText?.text || p.text?.text || input,
          subtitle: p.structuredFormat?.secondaryText?.text || '',
          distanceM: p.distanceMeters ? Number(p.distanceMeters) : undefined,
        }));
      return json({ ok: true, suggestions });
    } catch (e) {
      return json({ ok: false, suggestions: [], error: (e as Error).message });
    }
  }

  if (path === '/api/planner/google-place-details') {
    const apiKey = String(body?.apiKey || '').trim();
    const placeId = String(body?.placeId || '').trim();
    if (!apiKey || !placeId) return json({ error: 'apiKey and placeId required' }, 400);
    try {
      const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'id,displayName,location',
        },
      });
      const data: any = await res.json();
      if (!data.location) return json({ error: 'Place has no location' }, 404);
      return json({
        ok: true,
        name: data.displayName?.text || 'Destination',
        location: { lat: Number(data.location.latitude), lng: Number(data.location.longitude) },
      });
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
  }

  if (path === '/api/planner/google-routes') {
    const apiKey = String(body?.apiKey || '').trim();
    const origin = body?.origin;
    const destination = body?.destination;
    if (!apiKey || !origin || !destination) return json({ routes: [] });
    try {
      const reqBody = {
        origin: { location: { latLng: { latitude: Number(origin.lat), longitude: Number(origin.lng) } } },
        destination: { location: { latLng: { latitude: Number(destination.lat), longitude: Number(destination.lng) } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        computeAlternativeRoutes: true,
        extraComputations: ['TOLLS', 'TRAFFIC_ON_POLYLINE'],
        polylineQuality: 'OVERVIEW',
        regionCode: 'IN',
        languageCode: 'en-IN',
      };
      const mask =
        'routes.description,routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.travelAdvisory.tollInfo,routes.travelAdvisory.speedReadingIntervals';
      const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': mask,
        },
        body: JSON.stringify(reqBody),
      });
      const data: any = await res.json();
      const routes = (data.routes || []).map((r: any) => ({
        description: r.description || 'Highway Route',
        encodedPolyline: r.polyline?.encodedPolyline || '',
        distanceM: Number(r.distanceMeters) || 0,
        durationS: Number(String(r.duration || '0s').replace('s', '')) || 0,
        normalDurationS: r.staticDuration ? Number(String(r.staticDuration).replace('s', '')) : undefined,
        tolls: Boolean(r.travelAdvisory?.tollInfo),
        steps: (r.legs || [])
          .flatMap((l: any) => l.steps || [])
          .map((st: any) => ({
            distanceM: Number(st.distanceMeters) || 0,
            durationS: Number(String(st.staticDuration || '0s').replace('s', '')) || 0,
          })),
      }));
      return json({ ok: true, routes });
    } catch (e) {
      return json({ ok: false, routes: [], error: (e as Error).message });
    }
  }

  if (path === '/api/planner/google-elevation') {
    const apiKey = String(body?.apiKey || '').trim();
    const encodedPolyline = String(body?.encodedPolyline || '').trim();
    const sampleCount = Math.max(2, Math.min(500, Number(body?.count) || 120));
    if (!apiKey || !encodedPolyline) return json({ elevations: [] });
    try {
      // Use Google Elevation 'path' parameter which samples along the encoded route polyline
      const urlStr = `https://maps.googleapis.com/maps/api/elevation/json?path=${encodeURIComponent(
        'enc:' + encodedPolyline
      )}&samples=${sampleCount}&key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(urlStr);
      const data: any = await res.json();
      if (data.status === 'OK' && Array.isArray(data.results)) {
        return json({ ok: true, elevations: data.results.map((r: any) => Number(r.elevation) || 0) });
      }
      return json({ ok: false, elevations: [] });
    } catch (e) {
      return json({ ok: false, elevations: [] });
    }
  }

  if (path === '/api/planner/osm-chargers') {
    const bbox = String(body?.bbox || '').trim();
    if (!bbox) return json({ ok: false, elements: [] });
    try {
      const overpassQuery = `[out:json][timeout:6];node["amenity"="charging_station"](${bbox});out body 80;`;
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'MG-Windsor-TripPlanner/1.0 (https://mg-windsor.pages.dev)',
        },
        body: `data=${encodeURIComponent(overpassQuery)}`,
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data: any = await res.json();
        return json({ ok: true, elements: data.elements || [] });
      }
      return json({ ok: false, elements: [] });
    } catch (e) {
      return json({ ok: false, elements: [] });
    }
  }

  if (path === '/api/planner/google-chargers') {
    const apiKey = String(body?.apiKey || '').trim();
    const encodedPolyline = String(body?.encodedPolyline || '').trim();
    const origin = body?.origin;
    if (!apiKey || !encodedPolyline) return json({ chargers: [] });
    try {
      const reqBody: any = {
        textQuery: 'EV charging station',
        pageSize: 20,
        searchAlongRouteParameters: { polyline: { encodedPolyline } },
        evOptions: {
          minimumChargingRateKw: 20.0,
          connectorTypes: ['EV_CONNECTOR_TYPE_CCS_COMBO_2'],
        },
      };
      if (origin && origin.lat && origin.lng) {
        reqBody.routingParameters = {
          origin: { latitude: Number(origin.lat), longitude: Number(origin.lng) },
        };
      }
      const mask =
        'places.id,places.displayName,places.location,places.formattedAddress,places.evChargeOptions,places.regularOpeningHours';
      const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': mask,
        },
        body: JSON.stringify(reqBody),
      });
      const data: any = await res.json();
      const chargers = (data.places || [])
        .map((p: any) => {
          if (!p.location) return null;
          const aggs = p.evChargeOptions?.connectorAggregation || [];
          const ccs = aggs.filter((a: any) => a.type === 'EV_CONNECTOR_TYPE_CCS_COMBO_2');
          const listToUse = ccs.length > 0 ? ccs : aggs;
          const maxKw = listToUse.reduce(
            (mx: number, a: any) => Math.max(mx, Number(a.maxChargeRateKw) || 0),
            30
          );
          const connectorCount = listToUse.reduce((sum: number, a: any) => sum + (Number(a.count) || 0), 0) || null;
          const availArr = listToUse.filter((a: any) => a.availableCount != null);
          const availableCount =
            availArr.length > 0
              ? availArr.reduce((sum: number, a: any) => sum + (Number(a.availableCount) || 0), 0)
              : null;
          const periods = p.regularOpeningHours?.periods;
          const open24h = Array.isArray(periods) ? periods.length === 1 && !periods[0].close : null;
          return {
            id: p.id,
            name: p.displayName?.text || 'EV Fast Charger',
            address: p.formattedAddress || null,
            position: { lat: Number(p.location.latitude), lng: Number(p.location.longitude) },
            maxKw,
            connectorCount,
            availableCount,
            open24h,
          };
        })
        .filter(Boolean);
      return json({ ok: true, chargers });
    } catch (e) {
      return json({ ok: false, chargers: [] });
    }
  }

  // ----------------------------------------------------------- Apple CarPlay & Cloudflare D1 Endpoints
  // Start Trip (CarPlay Connects trigger - authenticated via opaque ?key=wk_...)
  if (path === '/api/trip/start') {
    const { store, db, isMaster } = workerAuthDeps(env);
    const hookAuth = await resolveWebhookAuth(store, db, isMaster, request, url, body);
    if (!hookAuth.ok) {
      if (url.searchParams.get('format') === 'json') {
        return json({ success: false, error: hookAuth.error }, hookAuth.status);
      }
      return new Response(`❌ ${hookAuth.error}`, {
        status: hookAuth.status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS },
      });
    }

    const activeVin = hookAuth.vin;
    const mg = await getMgClientForVin(env, activeVin);
    if (!mg) {
      const msg = 'MG vehicle session not found. Please open the MG Windsor app once to connect.';
      if (url.searchParams.get('format') === 'json') {
        return json({ success: false, error: msg }, 401);
      }
      return new Response(`❌ ${msg}`, {
        status: 401,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS },
      });
    }
    try {
      const telem = await fetchCarTelemetry(mg.client, activeVin);
      const startLocation = await resolveLocation(telem.lat, telem.lng);
      const nowSec = Math.floor(Date.now() / 1000);
      const tripId = 'trip_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
      const dateStr = istDateString(nowSec);

      const trip = {
        id: tripId,
        vin: activeVin,
        date: dateStr,
        start_timestamp: nowSec,
        start_odometer_km: telem.odometer,
        start_soc: telem.soc,
        start_location: startLocation,
        start_lat: telem.lat,
        start_lng: telem.lng,
        start_cabin_temp_c: telem.cabinTempC,
        start_exterior_temp_c: telem.exteriorTempC,
        max_speed_kmh: telem.speedKmh || 0,
        status: 'ongoing',
      };

      await d1InsertTrip(env, trip);

      // SCENARIO 5: Car unplugged early and driven away -> finalize any ongoing/paused charging session
      try {
        await syncChargingSessionState(env, url, telem, 'trip_start', activeVin);
      } catch (_) {}

      const title = '🚗 MG Windsor EV • Trip Started';
      const notificationText = [
        '🟢 Trip recording actively started in Cloudflare D1.',
        `⏱️ Started: ${formatClockTime(nowSec)}`,
        `🔋 Battery: ${trip.start_soc}% SOC`,
        `🛣️ Start Odometer: ${trip.start_odometer_km.toLocaleString()} km`,
        trip.start_location && trip.start_location !== 'Unknown Location' ? `📍 Start: ${trip.start_location}` : null,
      ].filter(Boolean).join('\n');

      await dispatchTripNotification(url, title, notificationText, 'car,electric_plug', env, activeVin);
      await d1InsertNotification(env, {
        id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        vin: activeVin,
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

  // Stop Trip (CarPlay Disconnects trigger - authenticated via opaque ?key=wk_...)
  if (path === '/api/trip/stop') {
    const { store, db, isMaster } = workerAuthDeps(env);
    const hookAuth = await resolveWebhookAuth(store, db, isMaster, request, url, body);
    if (!hookAuth.ok) {
      if (url.searchParams.get('format') === 'json') {
        return json({ success: false, error: hookAuth.error }, hookAuth.status);
      }
      return new Response(`❌ ${hookAuth.error}`, {
        status: hookAuth.status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS },
      });
    }

    const activeVin = hookAuth.vin;
    const mg = await getMgClientForVin(env, activeVin);
    const ongoingTrip = await d1GetActiveTrip(env, activeVin);
    if (!ongoingTrip) {
      const emptyTitle = 'ℹ️ MG Windsor EV • No Active Trip';
      const emptyMsg = 'No ongoing trip was recorded in Cloudflare D1 to stop.\n(Make sure CarPlay Connects ran first, and D1 database is bound).';
      if (url.searchParams.get('format') === 'json') {
        return json({ success: false, title: emptyTitle, notification: emptyMsg, message: emptyMsg }, 200);
      }
      return new Response(`${emptyTitle}\n\n${emptyMsg}`, { headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS }, status: 200 });
    }

    const tripVin = normVin(ongoingTrip.vin) || activeVin;
    let telem: any = null;
    if (mg) {
      telem = await fetchCarTelemetry(mg.client, tripVin).catch(() => null);
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
        const refreshed = await fetchCarTelemetry(mg.client, tripVin || mg.vin);
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
    if (distanceKm < 0.2) {
      if (env.DB) {
        await env.DB.prepare('DELETE FROM trips WHERE id = ? AND vin = ?').bind(ongoingTrip.id, tripVin).run().catch(() => {});
      }
      if (env.TRIP_KV) {
        if (tripVin) await env.TRIP_KV.delete(`d1_fallback:active_trip:${tripVin}`).catch(() => {});
        try {
          const trips = (await env.TRIP_KV.get('d1_fallback:trips', 'json')) || [];
          await env.TRIP_KV.put('d1_fallback:trips', JSON.stringify(trips.filter((t: any) => !(t.id === ongoingTrip.id && normVin(t.vin) === tripVin))));
        } catch (_) {}
      }

      const idleTitle = 'ℹ️ MG Windsor EV • Stationary (No Trip Logged)';
      const idleText = [
        'ℹ️ Vehicle was stationary (0.0 km driven).',
        `⏱️ Time in car: ${formatDurationSec(durationSec)} (${formatClockTime(startTimestamp)} → ${formatClockTime(nowSec)})`,
        `🔋 Battery: ${startSoc}% → ${endSoc}%`,
        '🧹 Cancelled recording to keep your driving history clean.',
      ].join('\n');

      await dispatchTripNotification(url, idleTitle, idleText, 'information_source', env, tripVin);
      await d1InsertNotification(env, {
        id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        vin: tripVin,
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
    const estPeakSpeed = avgSpeedKmh > 0 ? Math.min(115, Math.max(Number((avgSpeedKmh * 1.48).toFixed(1)), Number((avgSpeedKmh + 14).toFixed(1)))) : 0;
    const maxSpeedKmh = Math.max(Number(ongoingTrip.max_speed_kmh) || 0, Number(telem?.speedKmh) || 0, estPeakSpeed);

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
      max_speed_kmh: maxSpeedKmh,
      end_lat: telem?.lat ?? null,
      end_lng: telem?.lng ?? null,
      end_cabin_temp_c: telem?.cabinTempC ?? ongoingTrip.start_cabin_temp_c ?? null,
      end_exterior_temp_c: telem?.exteriorTempC ?? ongoingTrip.start_exterior_temp_c ?? null,
      status: 'completed',
    };

    await d1UpdateTrip(env, ongoingTrip.id, updates);

    // SCENARIO 1: Immediate Plug-In After Trip
    if (telem?.isCharging) {
      try {
        await syncChargingSessionState(env, url, telem, 'trip_stop', tripVin);
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

    await dispatchTripNotification(url, title, notificationText, 'white_check_mark,trophy', env, tripVin);
    await d1InsertNotification(env, {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      vin: tripVin,
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

  // Get Trips for UI (strictly scoped to authenticated user's VIN)
  if (path === '/api/trips') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const date = url.searchParams.get('date');
    const trips = await d1GetTrips(env, date, auth.vin);
    return json({ success: true, trips });
  }

  // Batch Sync Trips from Local App to D1
  if (path === '/api/trips/sync') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const rawTrips = body?.trips || [];
    const count = await d1BatchSyncTrips(env, rawTrips, auth.vin);
    return json({ success: true, count, message: `Synced ${count} trip(s) to Cloudflare D1` });
  }

  // Deduplicate and permanently prune duplicate Trips in D1 database
  if (path === '/api/trips/dedup' || path === '/api/trips/clean') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const res = await d1DeduplicateTrips(env, auth.vin);
    return json({
      success: true,
      removedCount: res.removedCount,
      removedIds: res.duplicateIds,
      message: `Cleaned and purged ${res.removedCount} duplicate trip(s) from Cloudflare D1`,
    });
  }

  // Delete Trip from D1
  if (path === '/api/trips/delete') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const tripId = body?.id || url.searchParams.get('id');
    if (!tripId) return json({ success: false, error: 'trip id required' }, 400);
    await d1DeleteTrip(env, tripId, auth.vin);
    return json({ success: true, message: 'Trip deleted from Cloudflare D1' });
  }

  // Clear all Trips from D1 (strictly scoped to authenticated VIN)
  if (path === '/api/trips/clear') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    await d1ClearTrips(env, auth.vin);
    return json({ success: true, message: 'All trips permanently cleared from Cloudflare D1' });
  }

  // Get Trip Distinct Dates for Calendar Picker
  if (path === '/api/trip/dates') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const dates = await d1GetTripDates(env, auth.vin);
    return json({ success: true, dates });
  }

  // Start Charging
  if (path === '/api/charge/start') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const mg = await getMgClientForVin(env, auth.vin);
    let telem: any = null;
    if (mg) {
      telem = await fetchCarTelemetry(mg.client, auth.vin).catch(() => null);
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const bmsElapsed = Math.max(0, Number(telem?.chargeTimeElapsedSec) || 0);
    const actualStartSec = bmsElapsed > 0 && bmsElapsed <= 48 * 3600 ? (nowSec - bmsElapsed) : nowSec;
    const chargeId = 'chg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
    const dateStr = istDateString(actualStartSec);
    const charge = {
      id: chargeId,
      vin: auth.vin,
      date: dateStr,
      start_timestamp: actualStartSec,
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
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const ongoingCharge = await d1GetActiveCharge(env, auth.vin);
    if (!ongoingCharge) {
      return json({ success: false, message: 'No active charging session found to stop' }, 404);
    }
    const mg = await getMgClientForVin(env, auth.vin);
    let telem: any = null;
    if (mg) {
      telem = await fetchCarTelemetry(mg.client, auth.vin).catch(() => null);
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
      peak_kw: Number(ongoingCharge.peak_kw) || 3.3,
      odometer_km: Number(telem?.odometer) || Number(ongoingCharge.odometer_km) || 0,
      status: 'completed',
    };
    await d1UpdateCharge(env, ongoingCharge.id, updates, auth.vin);
    return json({ success: true, message: 'Charging session completed', charge: { ...ongoingCharge, ...updates } });
  }

  // Get Notifications from D1
  if (path === '/api/notifications') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const [notifs, totalCount] = await Promise.all([
      d1GetNotifications(env, limit, auth.vin),
      d1GetNotificationCount(env, auth.vin),
    ]);
    return json({ success: true, notifications: notifs, totalCount });
  }

  // Test Notification insert to verify D1 Studio saving
  if (path === '/api/notifications/test') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const nowSec = Math.floor(Date.now() / 1000);
    const notif = {
      id: 'notif_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      vin: auth.vin,
      type: 'test',
      title: '🧪 MG Windsor EV • Test Notification',
      message: `Verified D1 Studio insertion at ${formatClockTime(nowSec)}. System is fully operational!`,
      timestamp: nowSec,
      date: istDateString(nowSec),
      is_read: 0,
      metadata: JSON.stringify({ test: true, time: new Date().toISOString() }),
    };
    const pushResult = await dispatchTripNotification(url, notif.title, notif.message, 'test_tube,car', env, auth.vin);
    await d1InsertNotification(env, notif);
    const notifs = await d1GetNotifications(env, 10, auth.vin);
    return json({ success: true, message: 'Test notification dispatched to ntfy & written to D1', pushResult, count: notifs.length, notification: notif, recent: notifs });
  }

  // Clear Notifications from D1
  if (path === '/api/notifications/clear') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    await d1ClearNotifications(env, auth.vin);
    return json({ success: true, message: 'Notification history cleared' });
  }

  // ----------------------------------------------------------- PWA Charging History Screen & Instant D1 Refresh Flow
  if (path === '/api/charging-history') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const isRefresh = url.searchParams.get('refresh') === 'true';
    if (isRefresh) {
      const activeSession = await d1GetActiveChargingSession(env, auth.vin);
      if (activeSession) {
        try {
          const mg = await getMgClientForVin(env, auth.vin);
          if (mg) {
            const telem = await fetchCarTelemetry(mg.client, auth.vin);
            await syncChargingSessionState(env, url, telem, 'user_refresh', auth.vin);
          }
        } catch (_) {}
      }
    }
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const sessions = await d1GetChargingHistory(env, limit, auth.vin);
    return json({ success: true, sessions, charges: sessions });
  }

  // Clear Charging History
  if (path === '/api/charging-history/clear') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    await d1ClearChargingHistory(env, auth.vin);
    await d1ClearCharges(env, auth.vin).catch(() => {});
    return json({ success: true, message: 'All charging sessions permanently cleared from Cloudflare D1' });
  }

  // Get active session status directly for PWA banner
  if (path === '/api/charging/active') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const active = await d1GetActiveChargingSession(env, auth.vin);
    return json({ success: true, activeSession: active });
  }

  // TEST ENDPOINT: Start simulated charging session in D1
  if (path === '/api/charging/test-start') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
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
      rangeKm: Math.round((qSoc / 100) * BMS_FULL_RANGE_KM),
    };
    const session = await syncChargingSessionState(env, url, dummyTelem, 'test_start', auth.vin);
    return json({
      success: true,
      message: '⚡ Test charging session started in Cloudflare D1!',
      session,
      instructions: 'Check your D1 charging_sessions & notifications tables, or PWA Charging tab. Then run /api/charging/test-end to complete it.',
    });
  }

  // TEST ENDPOINT: End simulated charging session in D1
  if (path === '/api/charging/test-end') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const active = await d1GetActiveChargingSession(env, auth.vin);
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
      rangeKm: Math.round((qSoc / 100) * BMS_FULL_RANGE_KM),
    };
    const fakeDeltaSec = 2700;
    active.active_duration_seconds = (Number(active.active_duration_seconds) || 0) + fakeDeltaSec;
    await d1UpdateChargingSession(env, active.id, { active_duration_seconds: active.active_duration_seconds });

    const session = await syncChargingSessionState(env, url, dummyTelem, 'test_end', auth.vin);
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
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const date = url.searchParams.get('date');
    const sessions = await d1GetChargingHistory(env, 100, auth.vin);
    if (sessions && sessions.length > 0) {
      return json({ success: true, charges: sessions, sessions });
    }
    const charges = await d1GetCharges(env, date, auth.vin);
    return json({ success: true, charges, sessions: charges });
  }

  // Batch Sync Charges from Local App to D1
  if (path === '/api/charges/sync') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const rawCharges = body?.charges || [];
    const count = await d1BatchSyncCharges(env, rawCharges, auth.vin);
    return json({ success: true, count, message: `Synced ${count} charge(s) to Cloudflare D1` });
  }

  // Deduplicate and permanently prune duplicate Charges in D1 database
  if (path === '/api/charges/dedup' || path === '/api/charges/clean') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const res = await d1DeduplicateCharges(env, auth.vin);
    return json({
      success: true,
      removedCount: res.removedCount,
      removedIds: res.duplicateIds,
      message: `Cleaned and purged ${res.removedCount} duplicate charge(s) from Cloudflare D1`,
    });
  }

  // Delete Charge from D1
  if (path === '/api/charges/delete') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const chargeId = body?.id || url.searchParams.get('id');
    if (!chargeId) return json({ success: false, error: 'charge id required' }, 400);
    await d1DeleteCharge(env, chargeId, auth.vin);
    return json({ success: true, message: 'Charge deleted from Cloudflare D1' });
  }

  // Clear all Charges from D1
  if (path === '/api/charges/clear') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    await d1ClearCharges(env, auth.vin);
    return json({ success: true, message: 'All charges permanently cleared from Cloudflare D1' });
  }

  // Get Charge Distinct Dates for Calendar Picker
  if (path === '/api/charge/dates') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const dates = await d1GetChargeDates(env, auth.vin);
    return json({ success: true, dates });
  }

  // Register car credentials & tokens strictly per-VIN and issue per-VIN API token + webhookKey
  if (path === '/api/register-car' || path === '/api/update-token') {
    const { store, db, isMaster } = workerAuthDeps(env);
    const check = await verifyCarRegistrationCaller(store, db, isMaster, request, body);
    if (!check.ok) {
      return json({ success: false, error: check.error }, check.status);
    }

    const cleanVin = check.vin;
    const cleanPhone = check.phone;
    const sessionObj = {
      uid: String(body.uid),
      token: String(body.token),
      vin: cleanVin,
      phone: cleanPhone,
      updatedAt: Math.floor(Date.now() / 1000),
    };

    await d1KvPut(env, `mg_session:${cleanVin}`, sessionObj);
    await d1KvPut(env, `mg_session_phone:${cleanPhone}`, sessionObj);

    const apiToken = await issueOrAdoptApiToken(store, {
      vin: cleanVin,
      phone: cleanPhone,
      uid: String(body.uid),
      candidateToken: check.candidateToken,
    });
    const webhookKey = await ensureWebhookKey(store, cleanVin, cleanPhone, false);

    const u = await authUser(env, url, body);
    if (u) {
      u.mg = { uid: body.uid, token: body.token, vin: cleanVin || u.mg?.vin, phone: cleanPhone || u.mg?.phone };
      u.mgStatus = 'ok';
      u.mgFailures = 0;
      u.guardUntilSec = 0;
      await saveUser(env, u);
    }
    return json({
      success: true,
      vin: cleanVin,
      apiToken,
      webhookKey,
      message: 'Car registered with strict per-user isolation & private webhook key',
    });
  }

  // Deregister car and wipe ONLY this authenticated user's cloud data (D1, KV, push subs, tokens)
  if (path === '/api/deregister-car' || path === '/api/car/wipe') {
    const auth = await requireAppVin(env, request, url, body);
    if (auth instanceof Response) return auth;
    const { store } = workerAuthDeps(env);
    const cleanVin = auth.vin;
    const cleanPhone = auth.phone;
    const clearHistory = body?.clearHistory !== false && url.searchParams.get('clearHistory') !== '0';

    await revokeTokensForVin(store, cleanVin);
    await d1KvDelete(env, `mg_session:${cleanVin}`);
    await d1KvDelete(env, `push_subs:${cleanVin}`);
    if (cleanPhone) {
      const phoneSess = await d1KvGet(env, `mg_session_phone:${cleanPhone}`);
      if (!phoneSess || !phoneSess.vin || normVin(phoneSess.vin) === cleanVin) {
        await d1KvDelete(env, `mg_session_phone:${cleanPhone}`);
      }
    }

    if (clearHistory) {
      await d1ClearTrips(env, cleanVin);
      await d1ClearCharges(env, cleanVin);
      await d1ClearChargingHistory(env, cleanVin);
      await d1ClearNotifications(env, cleanVin);
    }

    return json({
      success: true,
      message: 'Your vehicle session, webhook keys, push tokens, and cloud telemetry were permanently wiped.',
    });
  }

  const u = await authUser(env, url, body);
  if (path === '/api/status' || path === '/api/data') {
    if (!u) return json({ error: 'unauthorized' }, 401);
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
    if (!u) return json({ error: 'unauthorized' }, 401);
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

  const { db, isMaster } = workerAuthDeps(env);
  const { isUserAuthorized } = await import('./multi-user-auth');
  const activeVins = new Set<string>();

  // 1. Poll EVERY car with an active/paused charging session independently per VIN
  const activeSessions = await d1GetAllActiveChargingSessions(env).catch(() => []);
  for (const activeSession of activeSessions) {
    const sVin = requireScopedVin(activeSession?.vin);
    if (!sVin) continue;
    activeVins.add(sVin);

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
      shouldPoll = min % 3 === 0;
    } else if (isPaused) {
      shouldPoll = min % 10 === 0;
    }

    if (!shouldPoll) continue;

    try {
      const mg = await getMgClientForVin(env, sVin);
      if (!mg) continue;
      if (mg.phone && !(await isUserAuthorized(db, mg.phone, isMaster))) continue;
      const dummyUrl = new URL(`https://mg-windsor-webhook.mg-ismart.workers.dev`);
      const telem = await fetchCarTelemetry(mg.client, sVin);
      await syncChargingSessionState(env, dummyUrl, telem, 'cron', sVin);
    } catch (_) {
      // SCENARIO 10: MG Server Timeout / Cellular drop - 0 D1 changes
    }
  }

  // 2. Post-park / idle plug-in detection independently for each recently parked VIN (not already charging)
  try {
    const recentTrips = await d1GetRecentParkedTripsPerVin(env, nowSec - 14 * 3600);
    for (const lastTrip of recentTrips) {
      const tVin = requireScopedVin(lastTrip?.vin);
      if (!tVin || activeVins.has(tVin) || !lastTrip.end_timestamp) continue;

      const minutesSincePark = (nowSec - Number(lastTrip.end_timestamp)) / 60;
      const hoursSincePark = minutesSincePark / 60;
      const lastSoc = Number(lastTrip.end_soc) || 100;
      const isPostParkFastWindow = minutesSincePark >= 0 && minutesSincePark <= 20 && min % 3 === 0;
      const isHalfHourIdleCheck = min === 0 || min === 30;
      if (hoursSincePark < 14 && lastSoc < 100 && (isPostParkFastWindow || isHalfHourIdleCheck)) {
        try {
          const mg = await getMgClientForVin(env, tVin);
          if (!mg) continue;
          if (mg.phone && !(await isUserAuthorized(db, mg.phone, isMaster))) continue;
          const dummyUrl = new URL(`https://mg-windsor-webhook.mg-ismart.workers.dev`);
          const telem = await fetchCarTelemetry(mg.client, tVin);
          await syncChargingSessionState(env, dummyUrl, telem, 'cron_idle', tVin);
        } catch (_) {}
      }
    }
  } catch (_) {
    // SCENARIO 10: Catch block exits early
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

    // Block legacy unauthenticated single-user KV inspection/mutation endpoints
    if (action === 'get-trips' || action === 'reset-guard') {
      return json({ error: 'Legacy endpoint removed for multi-user isolation. Use authenticated /api/* endpoints.' }, 410);
    }

    // Option A remote commands dispatched to root query (?action=unlock&key=wk_...&pin=1234)
    if (action === 'unlock' || action === 'lock' || action === 'climate-on' || action === 'climate-off') {
      if (url.searchParams.get('key') || !env.MG_PHONE) {
        return await handleCarCommand(env, request, url, null, action);
      }
    }

    try {
      if (url.pathname === '/admin' || url.pathname === '/admin/' || url.pathname === '/admin/login') {
        return renderAdminWebsiteHtml(env, url);
      }
      if (url.pathname === '/google-callback') return await handleGoogleCallback(env, url);
      if (url.pathname.startsWith('/api/')) return await handleApi(env, request, url);
      if (url.searchParams.has('url')) return await (mgProxy as any).fetch(request);
      if (!env.MG_PHONE) {
        return json({
          status: 'online',
          service: 'MG Windsor EV Multi-User Cloud Worker',
          version: 'option-a-isolated',
        });
      }
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
