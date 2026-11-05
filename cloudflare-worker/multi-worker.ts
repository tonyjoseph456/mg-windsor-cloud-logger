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
import legacy from './silent-webhook';
import mgProxy from './worker';

interface Env {
  TRIP_KV?: {
    get(key: string, type?: 'text' | 'json'): Promise<any>;
    put(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
  };
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Comma-separated origins of the hosted PWA, e.g. https://mg-windsor.pages.dev */
  WEB_APP_ORIGINS?: string;
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
    headers: { 'Content-Type': 'application/json', ...CORS },
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
  if (!env.TRIP_KV) throw new Error('KV namespace TRIP_KV is not bound to this worker');
  return env.TRIP_KV;
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

/** Deduplicates charging records by ID, odometer, and timestamp */
function deduplicateChargeList(charges: any[]): any[] {
  if (!charges || !charges.length) return [];
  const valid = charges.filter((c) => Number(c?.endSoc ?? 0) > 0 || Number(c?.energyAddedToPackKwh ?? 0) > 0);

  valid.sort((a, b) => (b.startTimestampSec || 0) - (a.startTimestampSec || 0));
  const clean: any[] = [];

  for (const c of valid) {
    const cId = String(c.id || '');
    const cStartSec = Number(c.startTimestampSec || 0);
    const cEndSec = Number(c.endTimestampSec || cStartSec);
    const cOdo = Number(c.odometerKm || 0);
    const cEndSoc = Number(c.endSoc || 0);

    const isDup = clean.some((x) => {
      const xId = String(x.id || '');
      if (cId && xId && cId === xId) return true;
      const xStartSec = Number(x.startTimestampSec || 0);
      const xEndSec = Number(x.endTimestampSec || xStartSec);
      const xOdo = Number(x.odometerKm || 0);
      const xEndSoc = Number(x.endSoc || 0);

      if (cOdo > 0 && xOdo > 0 && Math.abs(cOdo - xOdo) <= 0.2) {
        if (Math.abs(cEndSoc - xEndSoc) <= 1 && Math.abs(cEndSec - xEndSec) < 1800) {
          return true;
        }
      }
      return false;
    });

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
  let dirty = false;
  u.lastPollSec = nowSec;

  if (u.mg && u.mgStatus === 'ok' && !(u.guardUntilSec > nowSec)) {
    const client = new MgIndiaClient({ phone: u.mg.phone || '9999999999', password: '', vin: u.mg.vin });
    client.uid = u.mg.uid;
    client.token = u.mg.token;
    try {
      const snap = await client.snapshot(true);
      budget.n += 3;
      u.mgFailures = 0;
      const st: any = snap.status;
      const ch: any = st?.charge;
      const raw = st?.raw?.basicVehicleStatus || st?.raw || {};
      const aux =
        typeof raw.batteryVoltage === 'number' && raw.batteryVoltage > 0
          ? Number((raw.batteryVoltage / 10).toFixed(1))
          : 12.6;

      const soc = ch?.soc ?? st?.fuel_level ?? 0;
      const cap = ch?.total_battery_capacity_kwh > 10 ? ch.total_battery_capacity_kwh : 37.3;
      const energy =
        ch?.battery_energy_kwh > 0 ? ch.battery_energy_kwh : Number(((soc / 100) * cap).toFixed(2));
      const odo = ch?.odometer_km ?? st?.odometer_km ?? 0;
      const speed = st?.gps?.speed_kmh ?? 0;
      const lat = st?.gps?.latitude ?? null;
      const lng = st?.gps?.longitude ?? null;
      const charging = Boolean(ch?.is_charging);

      u.live = { soc, odometerKm: odo, aux, charging, updatedSec: nowSec, rangeKm: ch?.range_km ?? st?.range_km ?? null };

      // 12V critical alert (< 12.1V) to prevent dead 12V battery lockout
      if (aux <= 12.1) {
        if (!u.last12vAlertSec || nowSec - u.last12vAlertSec > 7200) {
          u.last12vAlertSec = nowSec;
          dirty = true;
          await notifyUser(env, u, {
            title: `⚠️ 12V Battery Low: ${aux}V`,
            body: `Warning: 12V auxiliary battery is critically low (${aux}V). Turn on the car or plug in to charge immediately to avoid 12V drain/lockout.`,
            tag: 'windsor-12v-critical',
          });
        }
      } else if (aux >= 12.5) {
        u.last12vAlertSec = 0;
      }

      // Traction battery low (<= 15%)
      if (soc > 0 && soc <= 15 && !charging) {
        if (!u.lastTractionAlertSec || nowSec - u.lastTractionAlertSec > 7200) {
          u.lastTractionAlertSec = nowSec;
          dirty = true;
          const estRange = ch?.range_km ?? Math.round((soc / 100) * 320);
          await notifyUser(env, u, {
            title: `🪫 Traction Battery Low: ${soc}%`,
            body: `Main battery is at ${soc}% (~${estRange} km range remaining). Please plug in to an EV charger soon.`,
            tag: 'windsor-soc-low',
          });
        }
      } else if (soc > 20) {
        u.lastTractionAlertSec = 0;
      }

      // 12V guard
      if (aux < 12.2 && !charging) {
        u.guardUntilSec = nowSec + 4 * 3600;
        return true;
      }

      // ---- charging
      const liveKw =
        ch?.charging_current && ch?.charging_voltage
          ? Number(((ch.charging_voltage * ch.charging_current) / 1000).toFixed(2))
          : 0;
      if (charging) {
        if (!u.activeCharge) {
          u.activeCharge = {
            id: `chg-${nowSec}`, startTimestampSec: nowSec, startSoc: soc, endSoc: soc,
            startEnergyKwh: energy, endEnergyKwh: energy, maxKw: liveKw, odometerKm: odo,
            // BMS freezes these at plug-in = the driving cycle that just ended
            cycleDistanceKm: ch?.distance_since_last_charge_km ?? 0,
            cycleEnergyKwh: ch?.power_usage_since_last_charge_kwh ?? 0,
          };
          dirty = true;
          await notifyUser(env, u, {
            title: `⚡ Charging Started (${soc}%)`,
            body: `Plugged in at ${istParts(nowSec).time}. Battery: ${soc}%${liveKw > 0 ? ` • Charging at ${liveKw} kW` : ''}.`,
            tag: 'windsor-charge-status',
          });
        } else {
          u.activeCharge.notChargingSinceSec = 0;
          u.activeCharge.endSoc = Math.max(u.activeCharge.endSoc, soc);
          u.activeCharge.endEnergyKwh = Math.max(u.activeCharge.endEnergyKwh, energy);
          u.activeCharge.maxKw = Math.max(u.activeCharge.maxKw || 0, liveKw);
          // Save progress at most every ~10 min (KV free plan: 1000 writes/day)
          if (nowSec - (u.lastSaveSec || 0) > 600) dirty = true;
        }
      } else if (u.activeCharge && !u.activeCharge.notChargingSinceSec) {
        // First poll without charging: remember WHEN it stopped, but wait before closing the
        // session (the BMS briefly reports "not charging" mid-session, which used to split one
        // charge into several short sessions).
        u.activeCharge.notChargingSinceSec = nowSec;
        dirty = true;
      } else if (u.activeCharge && nowSec - u.activeCharge.notChargingSinceSec >= 300) {
        const a = u.activeCharge;
        const endSec = a.notChargingSinceSec; // real stop time (not when we gave up waiting)
        const durSec = Math.max(60, endSec - a.startTimestampSec);
        const finalSoc = Math.max(a.endSoc, soc);
        const finalEnergy = Math.max(a.endEnergyKwh, energy);
        const added = Math.max(0, Number((finalEnergy - a.startEnergyKwh).toFixed(2)));
        const kw = a.maxKw || 0;
        const cat = kw > 22 ? 'DC Fast' : kw > 4 ? '7.4 kW AC' : '3.3 kW AC';
        const loss = cat === 'DC Fast' ? 7 : cat === '7.4 kW AC' ? 10 : 13;
        let cycleKm = Number(a.cycleDistanceKm || 0);
        let cycleKwh = Number(a.cycleEnergyKwh || 0);
        if (cycleKm <= 0 && u.charges.length > 0 && u.charges[0].odometerKm > 0 && odo > u.charges[0].odometerKm) {
          cycleKm = Number((odo - u.charges[0].odometerKm).toFixed(1));
          if (cycleKwh <= 0) {
            cycleKwh = Number((((100 - a.startSoc) / 100) * cap).toFixed(2));
          }
        }
        const finalRange = ch?.range_km ?? st?.range_km ?? (finalSoc > 0 ? Math.round((finalSoc / 100) * 320) : 320);
        const rec = {
          id: a.id, startTimestampSec: a.startTimestampSec, endTimestampSec: endSec,
          durationSeconds: durSec, durationFormatted: fmtDur(durSec),
          startSoc: a.startSoc, endSoc: finalSoc, energyAddedToPackKwh: added,
          energyConsumedKwh: Number((added / (1 - loss / 100)).toFixed(2)),
          energyLossPercent: loss, chargerCategory: cat, maxChargingSpeedKw: kw,
          completionStatus:
            finalSoc >= 99 ? 'Full (100% Complete)' : `Stopped at ${finalSoc.toFixed(0)}% (Power Lost / Unplugged)`,
          odometerKm: odo,
          distanceToEmptyAfterKm: finalRange > 0 ? finalRange : Math.round((finalSoc / 100) * 320),
          rangeKm: finalRange > 0 ? finalRange : Math.round((finalSoc / 100) * 320),
          // Driving done BEFORE this charge (since the previous charge)
          distanceTravelledSinceLastChargeKm: cycleKm,
          energyUsedSinceLastChargeKwh: cycleKwh,
          efficiencyKmPerKwh: cycleKm > 0 && cycleKwh > 0 ? Number((cycleKm / cycleKwh).toFixed(2)) : 0,
        };
        u.charges.unshift(rec);
        u.charges.length = Math.min(u.charges.length, 100);
        u.pendingCharges.push(rec);
        u.activeCharge = null;
        dirty = true;

        const isFull = finalSoc >= 99;
        await notifyUser(env, u, {
          title: isFull ? '🔋 Charging Complete (100%)' : `🔌 Charging Stopped at ${finalSoc.toFixed(0)}%`,
          body: `${a.startSoc}% → ${finalSoc.toFixed(0)}% (+${added} kWh) in ${rec.durationFormatted}. Estimated DTE: ${rec.rangeKm} km.`,
          tag: 'windsor-charge-status',
        });
      }

      // ---- trips
      const journeyId =
        typeof raw.currentJourneyID === 'number' && raw.currentJourneyID > 0
          ? raw.currentJourneyID
          : null;

      const driving =
        !charging && (speed > 0.5 || st?.engine_status_raw === 1 || (st?.power_mode_raw ?? 0) > 0);

      if (u.activeTrip) {
        const t = u.activeTrip;
        const dt = Math.max(0, nowSec - (t.lastSampleTimeSec || nowSec));
        const odoDelta = Math.max(0, odo - t.endOdometerKm);

        // Check if the trip has genuinely ended vs temporarily stopped at a red light / in traffic
        const isCarLocked = Boolean(st?.locked);
        const isNewJourneyId = journeyId != null && t.journeyId != null && journeyId !== t.journeyId;
        const stationaryDurationSec =
          speed > 0.5 ? 0 : nowSec - (t.lastMotionSec || t.lastSampleTimeSec || nowSec);

        const isTrulyFinished =
          charging ||
          isCarLocked ||
          isNewJourneyId ||
          stationaryDurationSec >= 300; // at least 5 minutes stationary with no motion

        if (!isTrulyFinished) {
          // Trip is still actively ongoing! Accumulate idling if stopped at signal / junction
          if (speed < 0.5 && odoDelta < 0.05 && dt > 0 && dt < 600) {
            t.idleDurationSeconds += dt;
            t.idleEnergyKwh = Number((t.idleEnergyKwh + ((st?.climate_running ? 0.65 : 0.25) * dt) / 3600).toFixed(3));
          } else if (speed > 0.5) {
            t.lastMotionSec = nowSec;
          }
          t.journeyId = t.journeyId || journeyId;
          t.endSoc = soc;
          t.endEnergyKwh = energy;
          t.endOdometerKm = odo;
          t.maxSpeedKmh = Math.max(t.maxSpeedKmh, speed);
          t.endLat = lat ?? t.endLat;
          t.endLng = lng ?? t.endLng;
          t.endCabinTempC = st?.interior_temperature ?? t.endCabinTempC;
          t.endExteriorTempC = st?.exterior_temperature ?? t.endExteriorTempC;
          t.lastSampleTimeSec = nowSec;
          if (nowSec - (u.lastSaveSec || 0) > 600) dirty = true;
        } else {
          // Truly finished: finalize and log the complete continuous trip
          const dist = Number((odo - t.startOdometerKm).toFixed(1));
          const durSec = Math.max(60, nowSec - t.startTimestampSec);
          const used = Math.max(0, Number((t.startEnergyKwh - energy).toFixed(2)));
          const rec = {
            id: t.id,
            journeyId: t.journeyId || journeyId,
            startTimestampSec: t.startTimestampSec,
            endTimestampSec: nowSec,
            durationSeconds: durSec,
            distanceKm: dist,
            startOdometerKm: t.startOdometerKm,
            endOdometerKm: odo,
            startSoc: t.startSoc,
            endSoc: soc,
            energyUsedKwh: used,
            efficiencyKmPerKwh: used > 0 && dist > 0 ? Number((dist / used).toFixed(2)) : 0,
            idleDurationSeconds: t.idleDurationSeconds,
            idleEnergyKwh: Number(t.idleEnergyKwh.toFixed(2)),
            maxSpeedKmh: t.maxSpeedKmh,
            avgSpeedKmh: dist > 0 ? Number((dist / (durSec / 3600)).toFixed(1)) : 0,
            endCabinTempC: st?.interior_temperature ?? t.endCabinTempC,
            endExteriorTempC: st?.exterior_temperature ?? t.endExteriorTempC,
            startLat: t.startLat,
            startLng: t.startLng,
            endLat: lat ?? t.endLat,
            endLng: lng ?? t.endLng,
          };

          if (dist >= 0.2) {
            u.trips = deduplicateTripList([rec, ...(u.trips || [])]);
            u.trips.length = Math.min(u.trips.length, 100);
            u.pendingTrips.push(rec);
            await notifyUser(env, u, {
              title: `🏁 Trip Completed: ${dist} km`,
              body: `Duration: ${fmtDur(durSec)} • Efficiency: ${rec.efficiencyKmPerKwh} km/kWh • Battery: ${t.startSoc}% → ${soc}% • Odo: ${odo.toLocaleString()} km.`,
              tag: 'windsor-trip-status',
            });
          }
          u.activeTrip = null;
          dirty = true;
        }
      } else if (driving) {
        // Vehicle is moving, but u.activeTrip is null.
        // Check if we should RESUME the recently completed trip instead of creating a fragmented second trip!
        if (Array.isArray(u.trips) && u.trips.length > 0) {
          const last = u.trips[0];
          const endedRecently = nowSec - (last.endTimestampSec || 0) < 600;
          const sameJourney = last.journeyId && journeyId && last.journeyId === journeyId;
          const sameOdo = Math.abs(odo - (last.endOdometerKm || 0)) < 0.35;
          if (sameJourney || (endedRecently && sameOdo)) {
            // Re-open and resume the previous trip!
            u.activeTrip = {
              ...last,
              lastSampleTimeSec: nowSec,
              lastMotionSec: nowSec,
            };
            u.trips.shift();
            u.pendingTrips = (u.pendingTrips || []).filter((p: any) => p.id !== last.id);
            dirty = true;
            return dirty;
          }
        }

        // Start a brand new trip
        const tripId = `trip-${journeyId || nowSec}`;
        u.activeTrip = {
          id: tripId,
          journeyId,
          startTimestampSec: nowSec,
          lastSampleTimeSec: nowSec,
          lastMotionSec: nowSec,
          startSoc: soc,
          endSoc: soc,
          startEnergyKwh: energy,
          endEnergyKwh: energy,
          startOdometerKm: odo,
          endOdometerKm: odo,
          idleDurationSeconds: 0,
          idleEnergyKwh: 0,
          maxSpeedKmh: speed,
          startLat: lat,
          startLng: lng,
          endLat: lat,
          endLng: lng,
          endCabinTempC: st?.interior_temperature ?? null,
          endExteriorTempC: st?.exterior_temperature ?? null,
        };
        dirty = true;
        const estRange = ch?.range_km ?? Math.round((soc / 100) * 320);
        await notifyUser(env, u, {
          title: '🚗 Trip Started',
          body: `Started at ${istParts(nowSec).time}. Battery: ${soc}% • Range: ${estRange} km • Odo: ${odo.toLocaleString()} km.`,
          tag: 'windsor-trip-status',
        });
      }
    } catch (e) {
      const msg = (e as Error).message || '';
      u.mgFailures = (u.mgFailures || 0) + 1;
      // Session rejected (or we can't re-login because we deliberately hold no password)
      if (/login|401|403|token|session|reject/i.test(msg) || u.mgFailures >= 8) {
        u.mgStatus = 'expired';
      }
      u.lastError = msg;
      dirty = true;
    }
  }

  if (await flushPending(env, u, budget)) dirty = true;
  if (dirty) u.lastSaveSec = nowSec;
  return dirty;
}

async function runCron(env: Env): Promise<void> {
  const kv = kvOrThrow(env);
  const ids: string[] = JSON.parse((await kv.get('users', 'text')) || '[]');
  if (!ids.length) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const minute = Math.floor(nowSec / 60);
  const due = ids.filter((id) => (minute + hashSlot(id)) % POLL_EVERY_MIN === 0);
  const budget = { n: 1 };
  let processed = 0;
  for (const id of due) {
    if (processed >= MAX_USERS_PER_RUN || budget.n > SUBREQUEST_BUDGET - 8) break;
    const u = await loadUser(env, id);
    if (!u) continue;
    processed++;
    if (await pollUser(env, u, nowSec, budget)) await saveUser(env, u);
  }
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

async function handleApi(env: Env, request: Request, url: URL): Promise<Response> {
  const path = url.pathname;
  if (path === '/api/push-vapid-public-key') {
    return json({ success: true, publicKey: VAPID_PUB_B64URL });
  }
  const body: any = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  const u = await authUser(env, url, body);
  if (!u) return json({ error: 'Unauthorized' }, 401);

  if (path === '/api/register-car' || path === '/api/update-token') {
    // Only tokens are stored - never the MG password or PIN.
    if (!body.uid || !body.token) return json({ error: 'uid and token required' }, 400);
    u.mg = { uid: body.uid, token: body.token, vin: body.vin || u.mg?.vin, phone: body.phone || u.mg?.phone };
    u.mgStatus = 'ok';
    u.mgFailures = 0;
    u.guardUntilSec = 0;
    await saveUser(env, u);
    return json({ success: true });
  }
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
      await runCron(env).catch(() => {});
      return json({
        success: true,
        message: 'Polled registered background users safely. cron-job.org is no longer needed (Cloudflare Cron Trigger runs automatically).',
      });
    }

    try {
      if (url.pathname === '/google-callback') return await handleGoogleCallback(env, url);
      if (url.pathname.startsWith('/api/')) return await handleApi(env, request, url);
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
    // PWA CORS proxy to MG servers (?url=...)
    if (url.searchParams.has('url')) {
      try {
        return await (mgProxy as any).fetch(request);
      } catch (err) {
        return json({ error: (err as Error).message || 'Proxy error' }, 502);
      }
    }
    return (legacy as any).fetch(request, env, ctx);
  },

  async scheduled(event: any, env: Env, ctx?: any): Promise<void> {
    await runCron(env).catch(() => {});
    // Legacy single-user poller keeps working if MG_PHONE etc. are still configured.
    if (env.MG_PHONE) await (legacy as any).scheduled(event, env).catch(() => {});
  },
};
