/**
 * Google Drive & Google Sheets Integration for MG Windsor EV Telematics
 * 
 * Uses standard Google Drive API v3 and Google Sheets API v4 with zero external SDK bloat.
 * Scopes used:
 * - 'https://www.googleapis.com/auth/drive.file' (Grants access ONLY to files/folders created by this app)
 * - 'https://www.googleapis.com/auth/userinfo.email'
 * - 'https://www.googleapis.com/auth/userinfo.profile'
 */
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import { ChargeLogRecord, TripRecord } from './models';

export const DEFAULT_GOOGLE_CLIENT_ID =
  '502353296708-qfj0bj8s52mqchbi9dr3dthss9hr8ugb.apps.googleusercontent.com';

export interface GoogleUserProfile {
  email: string;
  name: string;
  picture?: string;
}

export interface GoogleSyncConfig {
  accessToken: string;
  userEmail: string;
  userName: string;
  folderId?: string;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  chargingSpreadsheetId?: string;
  chargingSpreadsheetUrl?: string;
  autoSync: boolean;
  lastSyncedAt?: string;
  lastChargingSyncedAt?: string;
}

const FOLDER_NAME = 'MG Windsor EV Telematics';
const SPREADSHEET_TITLE = 'MG Windsor EV - Trip History';
const CHARGING_SPREADSHEET_TITLE = 'MG Windsor EV - Charging History';

export const SHEET_HEADERS = [
  'Trip ID',
  'Date',
  'Start Time',
  'End Time',
  'Duration',
  'Distance (km)',
  'Start Odo (km)',
  'End Odo (km)',
  'Start Battery %',
  'End Battery %',
  'Energy Used (kWh)',
  'Efficiency (km/kWh)',
  'Start Location',
  'Destination',
  'Idling Duration',
  'Idling Energy (kWh)',
  'Cabin Temp (°C)',
  'Ambient Temp (°C)',
  'Max Speed (km/h)',
  'Average Speed (km/h)'
];

export const CHARGING_SHEET_HEADERS = [
  'Session ID',
  'Date (IST)',
  'Start Time',
  'End Time',
  'Duration',
  'Start Battery %',
  'End Battery %',
  'Energy Added (kWh)',
  'Wall Energy (kWh)',
  'Loss (%)',
  'Charger Speed Category',
  'Peak Speed (kW)',
  'Completion Status',
  'Odometer (km)',
  'Driving Before This Charge (km)',
  'Energy Used Before This Charge (kWh)',
  'Driving Efficiency Before This Charge (km/kWh)',
  'Data (do not edit)'
];

/** Unambiguous IST date (YYYY-MM-DD) + 24h time, so Sheets never mis-reads day/month. */
export function istIso(sec: number): { date: string; time: string } {
  const iso = new Date(((sec || 0) + 19800) * 1000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
}

/**
 * Initiates Google OAuth 2.0 Implicit Flow via WebBrowser
 */
export async function startGoogleOAuth(clientId?: string): Promise<{
  accessToken: string;
  expiresIn?: number;
}> {
  const activeClientId = (clientId && clientId.trim().length > 0)
    ? clientId.trim()
    : DEFAULT_GOOGLE_CLIENT_ID;

  // Clean redirect URI that doesn't depend on deprecated auth.expo.io
  const redirectUri =
    Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/oauth-callback`
      : 'https://mg-windsor-webhook.mg-ismart.workers.dev/oauth-callback';

  const scope = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ].join(' ');

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(
    activeClientId
  )}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent(
    scope
  )}&prompt=select_account`;

  const returnUrl =
    Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin
      ? `${window.location.origin}/oauth-callback`
      : 'mgismart://google-auth';

  const result = await WebBrowser.openAuthSessionAsync(authUrl, returnUrl);

  if (result.type === 'success' && result.url) {
    // Extract access_token from URL fragment
    const hashPart = result.url.split('#')[1] || result.url.split('?')[1] || '';
    const params = new URLSearchParams(hashPart);
    const token = params.get('access_token');
    const expiresIn = params.get('expires_in');

    if (!token) {
      throw new Error('Failed to retrieve access token from Google authentication callback');
    }

    return {
      accessToken: token,
      expiresIn: expiresIn ? parseInt(expiresIn, 10) : undefined,
    };
  }

  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw new Error('Google Sign-In was cancelled.');
  }

  throw new Error(`Google Sign-In failed (${result.type})`);
}

/**
 * Fetch signed-in Google user profile (Name, Email, Avatar)
 */
export async function fetchGoogleProfile(token: string): Promise<GoogleUserProfile> {
  const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(`Google UserInfo API returned ${resp.status}`);
  }
  const data = await resp.json();
  return {
    email: data.email || 'Google User',
    name: data.name || data.email || 'MG Driver',
    picture: data.picture,
  };
}

/**
 * Finds or creates the dedicated 'MG Windsor EV Telematics' folder in Google Drive
 */
export async function getOrCreateDriveFolder(token: string): Promise<string> {
  // 1. Search for existing folder
  const query = encodeURIComponent(
    `name = '${FOLDER_NAME}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  );
  const searchResp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (searchResp.ok) {
    const data = await searchResp.json();
    if (Array.isArray(data.files) && data.files.length > 0) {
      return data.files[0].id;
    }
  }

  // 2. Not found: create folder
  const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });

  if (!createResp.ok) {
    throw new Error(`Failed to create Google Drive folder: HTTP ${createResp.status}`);
  }

  const created = await createResp.json();
  return created.id;
}

/**
 * Finds or creates the 'MG Windsor EV - Trip History' spreadsheet inside the dedicated folder
 */
export async function getOrCreateTripSpreadsheet(
  token: string,
  folderId: string
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  // 1. Search for existing spreadsheet in folder
  const query = encodeURIComponent(
    `name = '${SPREADSHEET_TITLE}' and '${folderId}' in parents and trashed = false`
  );
  const searchResp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,webViewLink)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (searchResp.ok) {
    const data = await searchResp.json();
    if (Array.isArray(data.files) && data.files.length > 0) {
      const file = data.files[0];
      return {
        spreadsheetId: file.id,
        spreadsheetUrl: file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}`,
      };
    }
  }

  // 2. Create spreadsheet inside the Drive folder
  const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: SPREADSHEET_TITLE,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [folderId],
    }),
  });

  if (!createResp.ok) {
    throw new Error(`Failed to create Google Spreadsheet: HTTP ${createResp.status}`);
  }

  const file = await createResp.json();
  const spreadsheetId = file.id;
  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

  // 3. Write header row
  await appendSheetValues(token, spreadsheetId, [SHEET_HEADERS]);

  return { spreadsheetId, spreadsheetUrl };
}

/**
 * Appends raw row values to a Google Spreadsheet
 */
async function appendSheetValues(
  token: string,
  spreadsheetId: string,
  rows: (string | number)[][]
): Promise<void> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: rows }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Failed to append to Google Sheet: ${resp.status} - ${errText}`);
  }
}

/**
 * Deduplicates a list of trips, eliminating exact duplicates, zero-distance GPS jitter,
 * and fragmented trips that were started midway during a drive.
 * When duplicates or overlapping intervals are found, the longest and most complete trip is kept.
 */
export function deduplicateTripList(trips: TripRecord[]): TripRecord[] {
  if (!trips || !trips.length) return [];

  // Filter out stationary jitter (< 0.2 km and < 120s)
  const valid = trips.filter(
    (t) => Number(t?.distanceKm ?? 0) >= 0.2 || (t?.status === 'driving')
  );

  // Sort descending by start time, and then by distance
  valid.sort((a, b) => {
    const timeA = a.startTimestampSec || 0;
    const timeB = b.startTimestampSec || 0;
    if (timeA !== timeB) return timeB - timeA;
    return (b.distanceKm || 0) - (a.distanceKm || 0);
  });

  const clean: TripRecord[] = [];

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
      const timeOverlaps =
        tStartSec <= cEndSec + 90 && tEndSec >= cStartSec - 90;

      if (sameEndOdo && timeOverlaps) {
        // Keep the longer, more complete trip
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

      // 5. Very close start times (within 180s) and matching distance (within 0.5 km)
      const sameDistance = Math.abs(tDist - cDist) <= 0.5 && tDist > 0.2;
      const closeStartTime = Math.abs(tStartSec - cStartSec) <= 180;
      if (sameDistance && closeStartTime) {
        const tDuration = Number(t.durationSeconds || (tEndSec - tStartSec) || 0);
        const cDuration = Number(c.durationSeconds || (cEndSec - cStartSec) || 0);
        if (tDist > cDist || (tDist === cDist && tDuration > cDuration)) {
          clean[i] = t;
        }
        isDuplicate = true;
        break;
      }

      // 6. Overlapping time intervals (overlap >= 50% of duration) and similar distance
      const overlapStart = Math.max(tStartSec, cStartSec);
      const overlapEnd = Math.min(tEndSec, cEndSec);
      const overlapSec = Math.max(0, overlapEnd - overlapStart);
      const minDuration = Math.min(tEndSec - tStartSec, cEndSec - cStartSec);
      if (minDuration > 120 && overlapSec >= minDuration * 0.5 && Math.abs(tDist - cDist) <= 1.0) {
        const tDuration = Number(t.durationSeconds || (tEndSec - tStartSec) || 0);
        const cDuration = Number(c.durationSeconds || (cEndSec - cStartSec) || 0);
        if (tDist > cDist || (tDist === cDist && tDuration > cDuration)) {
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
export function isValidChargeRecord(c: any): boolean {
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

/**
 * Deduplicates charging records by ID, odometer, and timestamp.
 * When duplicates or overlapping intervals are found, the record with the higher energy
 * added and more complete data is preserved.
 */
export function deduplicateChargeList(charges: ChargeLogRecord[]): ChargeLogRecord[] {
  if (!charges || !charges.length) return [];
  const valid = charges.filter(isValidChargeRecord);

  valid.sort((a, b) => {
    const timeA = Number(a.startTimestampSec || 0);
    const timeB = Number(b.startTimestampSec || 0);
    if (timeA !== timeB) return timeB - timeA;
    return Number(b.energyAddedToPackKwh || 0) - Number(a.energyAddedToPackKwh || 0);
  });

  const clean: ChargeLogRecord[] = [];
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

export async function getExistingSheetTripIds(
  token: string,
  spreadsheetId: string
): Promise<Set<string>> {
  let resp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Log!A:A`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!resp.ok) {
    resp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A:A`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
  }
  if (!resp.ok) {
    resp = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A:A`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
  }

  const ids = new Set<string>();
  if (resp.ok) {
    const data = await resp.json();
    if (Array.isArray(data.values)) {
      for (const row of data.values) {
        if (row && row[0]) {
          ids.add(String(row[0]).trim());
        }
      }
    }
  }
  return ids;
}

/**
 * Syncs multiple trips to the user's Google Spreadsheet (skips duplicates)
 */
export async function syncTripsToGoogleSheet(
  token: string,
  spreadsheetId: string,
  trips: TripRecord[]
): Promise<{ syncedCount: number; alreadyExistingCount: number }> {
  if (!trips || trips.length === 0) {
    return { syncedCount: 0, alreadyExistingCount: 0 };
  }

  const existingIds = await getExistingSheetTripIds(token, spreadsheetId);
  const rowsToAppend: (string | number)[][] = [];

  // Sort chronological for clean spreadsheet reading
  const sorted = [...trips].sort(
    (a, b) => (a.startTimestampSec || 0) - (b.startTimestampSec || 0)
  );

  for (const t of sorted) {
    if (existingIds.has(t.id)) continue;

    const durSec = t.durationSeconds || 0;
    const durStr = `${Math.floor(durSec / 60)} min ${durSec % 60} sec`;
    const idleSec = t.idleDurationSeconds || 0;
    const idleStr = idleSec > 0 ? `${Math.floor(idleSec / 60)} min ${idleSec % 60} sec` : 'None';

    const sIso = istIso(t.startTimestampSec);
    const eIso = istIso(t.endTimestampSec);
    const row = [
      t.id,
      sIso.date,
      sIso.time,
      eIso.time,
      durStr,
      t.distanceKm,
      t.startOdometerKm,
      t.endOdometerKm,
      Number(t.startSoc.toFixed(1)),
      Number(t.endSoc.toFixed(1)),
      t.energyUsedKwh,
      t.efficiencyKmPerKwh > 0 ? t.efficiencyKmPerKwh : 0,
      t.startLocation || 'Unknown',
      t.endLocation || 'Unknown',
      idleStr,
      t.idleEnergyKwh || 0,
      t.endCabinTempC ?? t.cabinTempC ?? '--',
      t.endExteriorTempC ?? t.exteriorTempC ?? '--',
      t.maxSpeedKmh,
      t.avgSpeedKmh,
    ];

    rowsToAppend.push(row);
  }

  if (rowsToAppend.length > 0) {
    await appendSheetValues(token, spreadsheetId, rowsToAppend);
  }

  return {
    syncedCount: rowsToAppend.length,
    alreadyExistingCount: trips.length - rowsToAppend.length,
  };
}

/**
 * Finds or creates the 'MG Windsor EV - Charging History' spreadsheet inside the dedicated folder
 */
export async function getOrCreateChargingSpreadsheet(
  token: string,
  folderId: string
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  // 1. Search for existing spreadsheet in folder
  const query = encodeURIComponent(
    `name = '${CHARGING_SPREADSHEET_TITLE}' and '${folderId}' in parents and trashed = false`
  );
  const searchResp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,webViewLink)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (searchResp.ok) {
    const data = await searchResp.json();
    if (Array.isArray(data.files) && data.files.length > 0) {
      const file = data.files[0];
      return {
        spreadsheetId: file.id,
        spreadsheetUrl: file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}`,
      };
    }
  }

  // 2. Create spreadsheet inside the Drive folder
  const createResp = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: CHARGING_SPREADSHEET_TITLE,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [folderId],
    }),
  });

  if (!createResp.ok) {
    throw new Error(`Failed to create Charging Spreadsheet: HTTP ${createResp.status}`);
  }

  const file = await createResp.json();
  const spreadsheetId = file.id;
  const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

  // 3. Write header row
  await appendSheetValues(token, spreadsheetId, [CHARGING_SHEET_HEADERS]);

  return { spreadsheetId, spreadsheetUrl };
}

/**
 * Syncs charging sessions to the user's Google Spreadsheet (skips duplicates)
 */
export async function syncChargingLogsToGoogleSheet(
  token: string,
  spreadsheetId: string,
  logs: ChargeLogRecord[]
): Promise<{ syncedCount: number; alreadyExistingCount: number }> {
  if (!logs || logs.length === 0) {
    return { syncedCount: 0, alreadyExistingCount: 0 };
  }

  const existingIds = await getExistingSheetTripIds(token, spreadsheetId);
  const rowsToAppend: (string | number)[][] = [];

  const sorted = [...logs].sort(
    (a, b) => (a.startTimestampSec || 0) - (b.startTimestampSec || 0)
  );

  for (const log of sorted) {
    if (existingIds.has(log.id)) continue;

    const durSec = log.durationSeconds || 0;
    const durStr = `${Math.floor(durSec / 3600)}h ${Math.floor((durSec % 3600) / 60)}m`;
    const statusText =
      log.endSoc >= 99
        ? 'Full (100% Complete)'
        : log.status === 'completed'
        ? `Stopped at ${log.endSoc.toFixed(0)}% (Unplugged / Power Lost)`
        : 'In progress';

    const sIso = istIso(log.startTimestampSec);
    const eIso = log.endTimestampSec ? istIso(log.endTimestampSec) : null;
    const row = [
      log.id,
      sIso.date,
      sIso.time,
      eIso ? eIso.time : '--',
      durStr,
      Number(log.startSoc.toFixed(1)),
      Number(log.endSoc.toFixed(1)),
      log.energyAddedToPackKwh,
      log.energyConsumedKwh,
      log.energyLossPercent,
      log.chargerCategory,
      log.maxChargingSpeedKw || 0,
      statusText,
      log.odometerKm || 0,
      log.distanceTravelledSinceLastChargeKm || 0,
      log.energyUsedSinceLastChargeKwh || 0,
      log.efficiencyKmPerKwh > 0 ? log.efficiencyKmPerKwh : 0,
      JSON.stringify(log),
    ];

    rowsToAppend.push(row);
  }

  if (rowsToAppend.length > 0) {
    await appendSheetValues(token, spreadsheetId, rowsToAppend);
  }

  return {
    syncedCount: rowsToAppend.length,
    alreadyExistingCount: logs.length - rowsToAppend.length,
  };
}


// ---------------------------------------------------------------------------
// Multi-user background backend (Cloudflare Worker). Stores TOKENS only.
// ---------------------------------------------------------------------------
export const BACKEND_URL = 'https://mg-windsor-webhook.mg-ismart.workers.dev';

let _activeD1Vin: string = '';
export function setActiveD1Vin(vin?: string | null): void {
  _activeD1Vin = (vin || '').trim().toUpperCase();
}
export function getActiveD1Vin(): string {
  return _activeD1Vin;
}

export interface BackendConfig {
  userId: string;
  userKey: string;
  email: string;
  name?: string;
  tripSheetId: string;
  chargeSheetId: string;
}

export interface BackendStatus {
  success: boolean;
  email: string;
  mgStatus: 'ok' | 'expired' | 'none';
  googleStatus: 'ok' | 'revoked';
  lastPollSec: number | null;
  lastError: string | null;
  pendingRows: number;
  live: { soc: number; odometerKm: number; charging: boolean; updatedSec: number } | null;
  pushwardKey?: string;
  trips: any[];
  charges: any[];
}

/** Google sign-in using the offline auth-code flow; the worker keeps the refresh token. */
export async function startBackendSignIn(clientId?: string): Promise<BackendConfig> {
  const cid = clientId && clientId.trim() ? clientId.trim() : DEFAULT_GOOGLE_CLIENT_ID;
  const scope = [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ].join(' ');
  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(cid)}` +
    `&redirect_uri=${encodeURIComponent(BACKEND_URL + '/google-callback')}` +
    `&response_type=code&access_type=offline&prompt=consent%20select_account` +
    `&scope=${encodeURIComponent(scope)}`;

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // PWA: full-page redirect. The worker sends the user back to this origin with the account key.
    window.location.href = authUrl + '&state=' + encodeURIComponent(window.location.origin);
    return new Promise<BackendConfig>(() => {});
  }

  const result = await WebBrowser.openAuthSessionAsync(authUrl, 'mgismart://google-auth');
  if (result.type !== 'success' || !result.url) {
    throw new Error('Google Sign-In was cancelled.');
  }
  return parseBackendParams(new URLSearchParams(result.url.split('?')[1] || ''));
}

/** Parses the account key the worker returns after Google sign-in (native deep link or PWA redirect). */
export function parseBackendParams(params: URLSearchParams): BackendConfig {
  const error = params.get('error');
  if (error) throw new Error(`Google Sign-In failed: ${error}`);
  const userId = params.get('userId');
  const userKey = params.get('userKey');
  if (!userId || !userKey) throw new Error('Backend did not return an account key.');
  return {
    userId,
    userKey,
    email: params.get('email') || '',
    name: params.get('name') || undefined,
    tripSheetId: params.get('tripSheetId') || '',
    chargeSheetId: params.get('chargeSheetId') || '',
  };
}

async function backendCall(path: string, cfg: BackendConfig, body?: Record<string, unknown>) {
  const resp = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: cfg.userId, userKey: cfg.userKey, ...(body || {}) }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `Backend error ${resp.status}`);
  return data;
}

/** Sends the MG session TOKEN only (never password / PIN) so the cloud can track the car. */
export const backendRegisterCar = (
  cfg: BackendConfig,
  car: { uid: string; token: string; vin?: string; phone?: string }
) => backendCall('/api/register-car', cfg, car);

export const backendGetStatus = (cfg: BackendConfig): Promise<BackendStatus> =>
  backendCall('/api/status', cfg);

export const backendDeleteAccount = (cfg: BackendConfig) => backendCall('/api/delete', cfg);

export const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}`;

export const backendRestore = (cfg: BackendConfig): Promise<{ trips: any[]; charges: any[] }> =>
  backendCall('/api/restore', cfg);

export const backendSyncData = (
  cfg: BackendConfig,
  trips: any[],
  charges?: any[]
): Promise<{ success: boolean; syncedTrips: number; syncedCharges: number }> =>
  backendCall('/api/sync', cfg, { trips, charges: charges || [] });

export const backendCleanSheets = (
  cfg: BackendConfig
): Promise<{
  success: boolean;
  tripsBefore: number;
  tripsAfter: number;
  tripsRemoved: number;
  chargesBefore: number;
  chargesAfter: number;
  chargesRemoved: number;
  error?: string;
}> => backendCall('/api/clean-sheets', cfg);

// ---------------------------------------------------------------------------
// Cloudflare D1 Relational Database & Apple CarPlay API Client
// ---------------------------------------------------------------------------

function formatDateTimeSdk(unixSec: number | null | undefined): string {
  if (!unixSec || unixSec <= 0) return '--';
  const d = new Date(unixSec * 1000);
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function mapD1TripToRecord(r: any): TripRecord {
  const startSec = Number(r.start_timestamp) || 0;
  const endSec = Number(r.end_timestamp) || startSec;
  const startDt = startSec ? formatDateTimeSdk(startSec) : '';
  const endDt = endSec ? formatDateTimeSdk(endSec) : '';
  const startSoc = Number(r.start_soc) || 0;
  const endSoc = Number(r.end_soc) || startSoc;
  const distanceKm = Number(r.distance_km) || 0;
  const startOdo = Number(r.start_odometer_km) || 0;
  const endOdo = Number(r.end_odometer_km) || (startOdo + distanceKm);
  const durationSeconds = Number(r.duration_seconds) || Math.max(0, endSec - startSec);
  const energyUsedKwh = Number(r.energy_used_kwh) || Number((((startSoc - endSoc) / 100) * 37.3).toFixed(2));
  const efficiencyKmPerKwh = Number(r.efficiency_km_per_kwh) || (energyUsedKwh > 0 && distanceKm > 0 ? Number((distanceKm / energyUsedKwh).toFixed(2)) : 0);
  const avgSpeedKmh = Number(r.avg_speed_kmh) || (durationSeconds > 0 && distanceKm > 0 ? Number((distanceKm / (durationSecToHours(durationSeconds))).toFixed(1)) : 0);
  const rawMaxSpeed = Number(r.max_speed_kmh) || 0;
  const maxSpeedKmh = rawMaxSpeed > 0
    ? rawMaxSpeed
    : (avgSpeedKmh > 0 ? Math.min(115, Math.max(Number((avgSpeedKmh * 1.48).toFixed(1)), Number((avgSpeedKmh + 14).toFixed(1)))) : 0);

  const startLat = r.start_lat != null ? Number(r.start_lat) : null;
  const startLng = r.start_lng != null ? Number(r.start_lng) : null;
  const endLat = r.end_lat != null ? Number(r.end_lat) : null;
  const endLng = r.end_lng != null ? Number(r.end_lng) : null;

  const startCabinTempC = r.start_cabin_temp_c != null ? Number(r.start_cabin_temp_c) : null;
  const endCabinTempC = r.end_cabin_temp_c != null ? Number(r.end_cabin_temp_c) : startCabinTempC;
  const startExteriorTempC = r.start_exterior_temp_c != null ? Number(r.start_exterior_temp_c) : null;
  const endExteriorTempC = r.end_exterior_temp_c != null ? Number(r.end_exterior_temp_c) : startExteriorTempC;

  return {
    id: String(r.id),
    journeyId: null,
    startTimestampSec: startSec,
    endTimestampSec: endSec,
    startDateTime: startDt,
    endDateTime: endDt,
    startSoc,
    endSoc,
    startEnergyKwh: Number(((startSoc / 100) * 37.3).toFixed(2)),
    endEnergyKwh: Number(((endSoc / 100) * 37.3).toFixed(2)),
    durationSeconds,
    distanceKm,
    startOdometerKm: startOdo,
    endOdometerKm: endOdo,
    energyUsedKwh: Math.max(0, energyUsedKwh),
    efficiencyKmPerKwh: Math.max(0, efficiencyKmPerKwh),
    startLat,
    startLng,
    endLat,
    endLng,
    startLocation: r.start_location || 'Start',
    endLocation: r.end_location || 'Destination',
    idleDurationSeconds: 0,
    idleEnergyKwh: 0,
    acState: '',
    startCabinTempC,
    endCabinTempC,
    startExteriorTempC,
    endExteriorTempC,
    cabinTempC: endCabinTempC,
    exteriorTempC: endExteriorTempC,
    acTargetTempC: '--',
    acFanSpeed: '',
    maxSpeedKmh,
    avgSpeedKmh,
    status: r.status === 'ongoing' ? 'driving' : 'completed',
  };
}

function durationSecToHours(sec: number): number {
  return sec > 0 ? sec / 3600 : 1;
}

export function mapD1ChargeToRecord(r: any): ChargeLogRecord {
  const startSec = Number(r.start_time ?? r.start_timestamp) || 0;
  const endSec = (r.end_time != null || r.end_timestamp != null) ? Number(r.end_time ?? r.end_timestamp) : null;
  const startDt = startSec ? formatDateTimeSdk(startSec) : '';
  const endDt = endSec ? formatDateTimeSdk(endSec) : '';
  const startSoc = Number(r.start_soc) || 0;
  const endSoc = Number(r.end_soc) || startSoc;
  const socAdded = Number(r.soc_added) || Math.max(0, endSoc - startSoc);
  const energyAdded = Number(r.kwh_added ?? r.energy_added_kwh) || Number(((socAdded / 100) * 38).toFixed(2));
  const odo = Number(r.start_odometer_km ?? r.odometer_km) || 0;
  const durationSeconds = Number(r.active_duration_seconds ?? r.duration_seconds) || (endSec ? Math.max(0, endSec - startSec) : 0);

  // Classify charger type based on physical charging power (kW):
  // - <= 4.0 kW: 3.3 kW AC (standard portable / 15A wall socket)
  // - 4.1 kW to 11.0 kW: 7.4 kW AC (fast home wallbox / Type 2 AC public)
  // - > 11.0 kW: DC Fast (CCS2 DC fast charging)
  const rawPeak = Number(r.peak_power_kw ?? r.peak_kw);
  const peakKw = Number.isFinite(rawPeak) && rawPeak > 0 ? rawPeak : 0;
  const rawType = String(r.charge_type || r.charger_type || '').toUpperCase();

  let chargerCategory: '3.3 kW AC' | '7.4 kW AC' | 'DC Fast';
  if (peakKw > 11.0) {
    chargerCategory = 'DC Fast';
  } else if (peakKw > 4.0) {
    chargerCategory = '7.4 kW AC';
  } else if (peakKw > 0) {
    chargerCategory = '3.3 kW AC';
  } else if (rawType.includes('DC')) {
    chargerCategory = 'DC Fast';
  } else if (rawType.includes('7.4') || rawType.includes('7.2')) {
    chargerCategory = '7.4 kW AC';
  } else {
    chargerCategory = '3.3 kW AC';
  }

  const effectivePeakKw = peakKw > 0 ? peakKw : (chargerCategory === 'DC Fast' ? 30 : (chargerCategory === '7.4 kW AC' ? 7.4 : 3.3));
  const isDc = chargerCategory === 'DC Fast';
  const effFactor = isDc ? 0.94 : (chargerCategory === '7.4 kW AC' ? 0.905 : 0.885);
  const energyUsed = Number(r.energy_used_kwh) || Number((energyAdded / effFactor).toFixed(2));
  const lossKwh = Number(r.charging_loss_kwh) || Math.max(0, Number((energyUsed - energyAdded).toFixed(2)));
  const lossPct = energyUsed > 0 ? Number(((lossKwh / energyUsed) * 100).toFixed(1)) : (isDc ? 6.0 : (chargerCategory === '7.4 kW AC' ? 9.5 : 11.5));

  return {
    id: String(r.id),
    startTimestampSec: startSec,
    endTimestampSec: endSec,
    startDateTime: startDt,
    endDateTime: endDt,
    startSoc,
    endSoc,
    startEnergyKwh: Number(((startSoc / 100) * 38).toFixed(2)),
    endEnergyKwh: Number(((endSoc / 100) * 38).toFixed(2)),
    odometerKm: odo,
    distanceToEmptyAfterKm: r.start_range_km ? Math.round(Number(r.start_range_km) + (socAdded * 3.3)) : Math.round((endSoc / 100) * 331),
    chargerCategory,
    maxChargingSpeedKw: effectivePeakKw,
    energyAddedToPackKwh: Math.max(0, energyAdded),
    energyConsumedKwh: Math.max(0, energyUsed),
    energyLossPercent: lossPct,
    distanceTravelledSinceLastChargeKm: 0,
    energyUsedSinceLastChargeKwh: 0,
    efficiencyKmPerKwh: 0,
    durationSeconds,
    status: (r.status === 'ongoing' || r.status === 'paused' || r.status === 'charging') ? 'charging' : 'completed',
  };
}

export async function fetchD1Trips(date?: string, vinOverride?: string): Promise<TripRecord[]> {
  try {
    const vin = (vinOverride || _activeD1Vin || '').trim();
    const params = new URLSearchParams();
    if (date && date !== 'all') params.set('date', date);
    if (vin) params.set('vin', vin);
    const qs = params.toString();
    const url = `${BACKEND_URL}/api/trips${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.success && Array.isArray(data.trips)) {
      return deduplicateTripList(data.trips.map(mapD1TripToRecord));
    }
  } catch (err) {
    console.warn('fetchD1Trips error:', err);
  }
  return [];
}

export async function syncTripsToD1(trips: TripRecord[], vinOverride?: string): Promise<boolean> {
  if (!Array.isArray(trips) || trips.length === 0) return true;
  try {
    const vin = (vinOverride || _activeD1Vin || '').trim();
    const payload = trips.map((t) => ({
      id: t.id,
      vin: vin || undefined,
      start_timestamp: t.startTimestampSec,
      end_timestamp: t.endTimestampSec,
      duration_seconds: t.durationSeconds,
      distance_km: t.distanceKm,
      start_odometer_km: t.startOdometerKm,
      end_odometer_km: t.endOdometerKm,
      start_soc: t.startSoc,
      end_soc: t.endSoc,
      energy_used_kwh: t.energyUsedKwh,
      efficiency_km_per_kwh: t.efficiencyKmPerKwh,
      start_location: t.startLocation,
      end_location: t.endLocation,
      avg_speed_kmh: t.avgSpeedKmh,
      max_speed_kmh: t.maxSpeedKmh,
      start_lat: t.startLat ?? null,
      start_lng: t.startLng ?? null,
      end_lat: t.endLat ?? null,
      end_lng: t.endLng ?? null,
      start_cabin_temp_c: t.startCabinTempC ?? t.cabinTempC ?? null,
      end_cabin_temp_c: t.endCabinTempC ?? t.cabinTempC ?? null,
      start_exterior_temp_c: t.startExteriorTempC ?? t.exteriorTempC ?? null,
      end_exterior_temp_c: t.endExteriorTempC ?? t.exteriorTempC ?? null,
      status: t.status === 'driving' ? 'ongoing' : 'completed',
    }));
    const res = await fetch(`${BACKEND_URL}/api/trips/sync${vin ? `?vin=${encodeURIComponent(vin)}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vin: vin || undefined, trips: payload }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data.success);
  } catch (err) {
    console.warn('syncTripsToD1 error:', err);
    return false;
  }
}

export async function deleteD1Trip(tripId: string, vinOverride?: string): Promise<boolean> {
  try {
    const vin = (vinOverride || _activeD1Vin || '').trim();
    const res = await fetch(`${BACKEND_URL}/api/trips/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: tripId, vin: vin || undefined }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data.success);
  } catch (err) {
    console.warn('deleteD1Trip error:', err);
    return false;
  }
}

export async function clearD1Trips(vinOverride?: string): Promise<boolean> {
  try {
    const vin = (vinOverride || _activeD1Vin || '').trim();
    const res = await fetch(`${BACKEND_URL}/api/trips/clear${vin ? `?vin=${encodeURIComponent(vin)}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vin: vin || undefined }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data.success);
  } catch (err) {
    console.warn('clearD1Trips error:', err);
    return false;
  }
}

export async function dedupD1Trips(vinOverride?: string): Promise<{ success: boolean; removedCount: number }> {
  try {
    const vin = (vinOverride || _activeD1Vin || '').trim();
    const res = await fetch(`${BACKEND_URL}/api/trips/dedup${vin ? `?vin=${encodeURIComponent(vin)}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vin: vin || undefined }),
    });
    if (!res.ok) return { success: false, removedCount: 0 };
    const data = await res.json();
    return { success: Boolean(data.success), removedCount: Number(data.removedCount) || 0 };
  } catch (err) {
    console.warn('dedupD1Trips error:', err);
    return { success: false, removedCount: 0 };
  }
}

export async function syncChargesToD1(charges: ChargeLogRecord[], vinOverride?: string): Promise<boolean> {
  if (!Array.isArray(charges) || charges.length === 0) return true;
  try {
    const vin = (vinOverride || _activeD1Vin || '').trim();
    const payload = charges.map((c) => ({
      id: c.id,
      vin: vin || undefined,
      start_timestamp: c.startTimestampSec,
      end_timestamp: c.endTimestampSec,
      duration_seconds: c.durationSeconds,
      start_soc: c.startSoc,
      end_soc: c.endSoc,
      energy_added_kwh: c.energyAddedToPackKwh,
      charger_type: c.chargerCategory,
      peak_kw: c.maxChargingSpeedKw,
      odometer_km: c.odometerKm,
      status: c.status,
    }));
    const res = await fetch(`${BACKEND_URL}/api/charges/sync${vin ? `?vin=${encodeURIComponent(vin)}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vin: vin || undefined, charges: payload }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data.success);
  } catch (err) {
    console.warn('syncChargesToD1 error:', err);
    return false;
  }
}

export async function deleteD1Charge(chargeId: string, vinOverride?: string): Promise<boolean> {
  try {
    const vin = (vinOverride || _activeD1Vin || '').trim();
    const res = await fetch(`${BACKEND_URL}/api/charges/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: chargeId, vin: vin || undefined }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data.success);
  } catch (err) {
    console.warn('deleteD1Charge error:', err);
    return false;
  }
}

export async function clearD1Charges(vinOverride?: string): Promise<boolean> {
  try {
    const vin = (vinOverride || _activeD1Vin || '').trim();
    const res = await fetch(`${BACKEND_URL}/api/charges/clear${vin ? `?vin=${encodeURIComponent(vin)}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vin: vin || undefined }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data.success);
  } catch (err) {
    console.warn('clearD1Charges error:', err);
    return false;
  }
}

export async function fetchD1TripDates(vinOverride?: string): Promise<string[]> {
  try {
    const vin = (vinOverride || _activeD1Vin || '').trim();
    const res = await fetch(`${BACKEND_URL}/api/trip/dates${vin ? `?vin=${encodeURIComponent(vin)}` : ''}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.success && Array.isArray(data.dates)) {
      return data.dates;
    }
  } catch (err) {
    console.warn('fetchD1TripDates error:', err);
  }
  return [];
}

export interface ChargingSessionRecord {
  id: string;
  vin?: string;
  status: 'ongoing' | 'paused' | 'completed';
  start_time: number;
  end_time?: number | null;
  start_soc: number;
  end_soc?: number | null;
  soc_added: number;
  kwh_added: number;
  energy_used_kwh: number;
  charging_loss_kwh: number;
  charge_type: 'AC' | 'DC';
  peak_power_kw: number;
  last_power_kw: number;
  start_odometer_km: number;
  start_range_km: number;
  outage_count: number;
  paused_at?: number | null;
  active_duration_seconds: number;
  date: string;
  created_at?: string;
}

export async function fetchChargingHistory(refresh = false, vinOverride?: string): Promise<ChargingSessionRecord[]> {
  try {
    const vin = (vinOverride || _activeD1Vin || '').trim();
    const params = new URLSearchParams();
    if (refresh) params.set('refresh', 'true');
    if (vin) params.set('vin', vin);
    const qs = params.toString();
    const url = `${BACKEND_URL}/api/charging-history${qs ? `?${qs}` : ''}`;
    const res = await fetch(url, { headers: { 'Cache-Control': 'no-store' } });
    if (!res.ok) return [];
    const data = await res.json();
    if (data.success && Array.isArray(data.sessions)) {
      return data.sessions;
    }
  } catch (err) {
    console.warn('fetchChargingHistory error:', err);
  }
  return [];
}

export async function clearChargingHistory(vinOverride?: string): Promise<boolean> {
  try {
    const vin = (vinOverride || _activeD1Vin || '').trim();
    const res = await fetch(`${BACKEND_URL}/api/charging-history/clear${vin ? `?vin=${encodeURIComponent(vin)}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vin: vin || undefined }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data.success);
  } catch (err) {
    console.warn('clearChargingHistory error:', err);
    return false;
  }
}

export async function fetchD1Charges(date?: string, vinOverride?: string): Promise<ChargeLogRecord[]> {
  try {
    const vin = (vinOverride || _activeD1Vin || '').trim();
    const params = new URLSearchParams();
    if (date && date !== 'all') params.set('date', date);
    if (vin) params.set('vin', vin);
    const qs = params.toString();
    const url = `${BACKEND_URL}/api/charging-history${qs ? `?${qs}` : ''}`;
    const res = await fetch(url, { headers: { 'Cache-Control': 'no-store' } });
    if (!res.ok) return [];
    const data = await res.json();
    const list = data.sessions || data.charges;
    if (data.success && Array.isArray(list)) {
      return deduplicateChargeList(list.map(mapD1ChargeToRecord));
    }
  } catch (err) {
    console.warn('fetchD1Charges error:', err);
  }
  return [];
}

export async function dedupD1Charges(vinOverride?: string): Promise<{ success: boolean; removedCount: number }> {
  try {
    const vin = (vinOverride || _activeD1Vin || '').trim();
    const res = await fetch(`${BACKEND_URL}/api/charges/dedup${vin ? `?vin=${encodeURIComponent(vin)}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vin: vin || undefined }),
    });
    if (!res.ok) return { success: false, removedCount: 0 };
    const data = await res.json();
    return { success: Boolean(data.success), removedCount: Number(data.removedCount) || 0 };
  } catch (err) {
    console.warn('dedupD1Charges error:', err);
    return { success: false, removedCount: 0 };
  }
}

export async function fetchD1ChargeDates(vinOverride?: string): Promise<string[]> {
  try {
    const vin = (vinOverride || _activeD1Vin || '').trim();
    const res = await fetch(`${BACKEND_URL}/api/charge/dates${vin ? `?vin=${encodeURIComponent(vin)}` : ''}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.success && Array.isArray(data.dates)) {
      return data.dates;
    }
  } catch (err) {
    console.warn('fetchD1ChargeDates error:', err);
  }
  return [];
}

export async function registerCarSession(car: { uid: string; token: string; vin?: string; phone?: string }): Promise<boolean> {
  try {
    if (car.vin) setActiveD1Vin(car.vin);
    const res = await fetch(`${BACKEND_URL}/api/register-car`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(car),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

export async function deregisterCarSession(params: { vin?: string; phone?: string; clearHistory?: boolean }): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/deregister-car`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

export interface AppNotificationRecord {
  id: string;
  vin?: string;
  type: 'trip_start' | 'trip_stop' | 'trip_idle' | 'charge_start' | 'charge_stop';
  title: string;
  message: string;
  timestamp: number;
  date: string;
  metadata?: string | null;
  created_at?: string;
}

export async function fetchD1Notifications(limit = 50, vinOverride?: string): Promise<AppNotificationRecord[]> {
  try {
    const vin = (vinOverride || _activeD1Vin || '').trim();
    const res = await fetch(`${BACKEND_URL}/api/notifications?limit=${limit}${vin ? `&vin=${encodeURIComponent(vin)}` : ''}`);
    if (!res.ok) return [];
    const data = await res.json();
    if (data.success && Array.isArray(data.notifications)) {
      return data.notifications;
    }
  } catch (err) {
    console.warn('fetchD1Notifications error:', err);
  }
  return [];
}

export async function clearD1Notifications(vinOverride?: string): Promise<boolean> {
  try {
    const vin = (vinOverride || _activeD1Vin || '').trim();
    const res = await fetch(`${BACKEND_URL}/api/notifications/clear${vin ? `?vin=${encodeURIComponent(vin)}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vin: vin || undefined }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- One-Time Access Code & User Authorization API
export interface AccessVerificationResult {
  valid: boolean;
  code?: string;
  assignedName?: string;
  isAlreadyAuthorized?: boolean;
  isAdmin?: boolean;
  error?: string;
}

export async function verifyAccessCode(code: string, phone: string): Promise<AccessVerificationResult> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim(), phone: phone.replace(/\D/g, '') }),
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { valid: false, error: err.message || 'Failed to connect to authentication server' };
  }
}

export async function consumeAccessCode(
  code: string,
  phone: string,
  vin?: string,
  carName?: string
): Promise<{ success: boolean; licenseToken?: string; isAdmin?: boolean; error?: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/consume-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code.trim(),
        phone: phone.replace(/\D/g, ''),
        vin: vin || undefined,
        carName: carName || undefined,
        deviceInfo: typeof navigator !== 'undefined' ? navigator.userAgent : 'PWA',
      }),
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, error: err.message || 'Failed to authorize account' };
  }
}

export async function checkUserAuthorization(phone: string): Promise<{ authorized: boolean; isAdmin?: boolean; reason?: string; error?: string }> {
  try {
    const cleanPhone = phone.replace(/\D/g, '');
    const res = await fetch(`${BACKEND_URL}/api/auth/check-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: cleanPhone }),
    });
    const data = await res.json();
    return data;
  } catch {
    return { authorized: true }; // Allow cached offline sessions if network is unreachable
  }
}
