/**
 * Google Drive & Google Sheets Integration for Web PWA
 */
import { TripRecord } from './models';

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
  autoSync: boolean;
  lastSyncedAt?: string;
}

const FOLDER_NAME = 'MG Windsor EV Telematics';
const SPREADSHEET_TITLE = 'MG Windsor EV - Trip History';

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

/**
 * Initiates Google OAuth 2.0 Implicit Flow in Browser
 */
export function startGoogleOAuthWeb(clientId?: string): Promise<{
  accessToken: string;
  expiresIn?: number;
}> {
  return new Promise((resolve, reject) => {
    const activeClientId = clientId?.trim() || DEFAULT_GOOGLE_CLIENT_ID;
    const redirectUri = window.location.origin;
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

    const popup = window.open(authUrl, 'google_login', 'width=500,height=600');
    if (!popup) {
      reject(new Error('Popup blocked! Please allow popups for this site.'));
      return;
    }

    const timer = setInterval(() => {
      try {
        if (!popup || popup.closed) {
          clearInterval(timer);
          reject(new Error('Google Sign-In popup closed by user.'));
          return;
        }

        if (popup.location.href.includes('access_token')) {
          const hash = popup.location.hash || popup.location.search;
          const params = new URLSearchParams(hash.replace(/^[#?]/, ''));
          const token = params.get('access_token');
          const expiresIn = params.get('expires_in');
          popup.close();
          clearInterval(timer);
          if (token) {
            resolve({ accessToken: token, expiresIn: expiresIn ? parseInt(expiresIn, 10) : undefined });
          } else {
            reject(new Error('No access token in response'));
          }
        }
      } catch (_) {
        // Cross-origin before redirect - wait
      }
    }, 500);
  });
}

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

export async function getOrCreateDriveFolder(token: string): Promise<string> {
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

export async function getOrCreateTripSpreadsheet(
  token: string,
  folderId: string
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
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

  await appendSheetValues(token, spreadsheetId, [SHEET_HEADERS]);

  return { spreadsheetId, spreadsheetUrl };
}

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

export async function getExistingSheetTripIds(
  token: string,
  spreadsheetId: string
): Promise<Set<string>> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A:A`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

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

  const sorted = [...trips].sort(
    (a, b) => (a.startTimestampSec || 0) - (b.startTimestampSec || 0)
  );

  for (const t of sorted) {
    if (existingIds.has(t.id)) continue;

    const durSec = t.durationSeconds || 0;
    const durStr = `${Math.floor(durSec / 60)} min ${durSec % 60} sec`;
    const idleSec = t.idleDurationSeconds || 0;
    const idleStr = idleSec > 0 ? `${Math.floor(idleSec / 60)} min ${idleSec % 60} sec` : 'None';

    const row = [
      t.id,
      t.startDateTime ? t.startDateTime.split(' at ')[0] : 'Today',
      t.startDateTime ? (t.startDateTime.split(' at ')[1] || t.startDateTime) : '--',
      t.endDateTime ? (t.endDateTime.split(' at ')[1] || t.endDateTime) : '--',
      durStr,
      t.distanceKm,
      t.startOdometerKm,
      t.endOdometerKm,
      `${t.startSoc.toFixed(1)}%`,
      `${t.endSoc.toFixed(1)}%`,
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
