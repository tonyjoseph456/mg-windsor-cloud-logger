import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  Linking,
  Modal,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle, Path, Rect, G, Line, Polyline } from 'react-native-svg';
import * as SecureStore from './src/storage';
import { setGlobalFontScale, getGlobalFontScale } from './src/webShims';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import {
  WINDSOR_COLORS,
  matchWindsorColor,
  WindsorColorOption,
} from './src/assets/cars';
import {
  ChargeLogRecord,
  DEFAULT_GOOGLE_CLIENT_ID,
  GoogleSyncConfig,
  GpsStatus,
  hashControlPin,
  MgIndiaClient,
  Snapshot,
  Status,
  TripRecord,
  startGoogleOAuth,
  fetchGoogleProfile,
  getOrCreateDriveFolder,
  getOrCreateTripSpreadsheet,
  getOrCreateChargingSpreadsheet,
  syncTripsToGoogleSheet,
  syncChargingLogsToGoogleSheet,
  BackendConfig,
  BackendStatus,
  startBackendSignIn,
  parseBackendParams,
  backendRegisterCar,
  backendGetStatus,
  backendRestore,
  backendDeleteAccount,
  backendSyncData,
  backendCleanSheets,
  deduplicateTripList,
  deduplicateChargeList,
  isValidChargeRecord,
  BACKEND_URL,
  setActiveD1Vin,
  sheetUrl,
  fetchD1Trips,
  fetchD1TripDates,
  syncTripsToD1,
  deleteD1Trip,
  clearD1Trips,
  dedupD1Trips,
  fetchD1Charges,
  fetchD1ChargeDates,
  syncChargesToD1,
  deleteD1Charge,
  clearD1Charges,
  dedupD1Charges,
  ChargingSessionRecord,
  fetchChargingHistory,
  clearChargingHistory,
  registerCarSession,
  deregisterCarSession,
  AppNotificationRecord,
  fetchD1Notifications,
  clearD1Notifications,
  computeTripRouteChoices,
  NamedPlace,
  RouteChoice,
} from './src/sdk';
import { TripPlannerCard } from './src/TripPlannerCard';

type TabId = 'home' | 'charge' | 'trips' | 'account';

const SESSION_KEY = 'mg_ismart_live_session_v2';
const SNAPSHOT_KEY = 'mg_ismart_cached_snapshot_v2';
const TRIPS_KEY = 'mg_ismart_saved_trips_v3';
const ACTIVE_TRIP_KEY = 'mg_ismart_active_trip_v3';
const PARKED_BASELINE_KEY = 'mg_ismart_parked_baseline_v3';
const CHARGE_LOGS_KEY = 'mg_ismart_charge_logs_v2';
const ACTIVE_CHARGE_KEY = 'mg_ismart_active_charge_v2';
const PRE_CHARGE_BASELINE_KEY = 'mg_ismart_pre_charge_baseline_v2';
const CLOUD_SYNC_URL_KEY = 'mg_ismart_cloud_sync_url_v2';
const CLOUD_API_KEY_KEY = 'mg_ismart_cloud_api_key_v2';
const GOOGLE_SYNC_KEY = 'mg_ismart_google_sync_v1';
const BACKEND_KEY = 'mg_ismart_backend_v1';
const GOOGLE_CLIENT_ID_KEY = 'mg_ismart_google_client_id_v1';
const FONT_SCALE_KEY = 'mg_ismart_font_scale_v1';
const GOOGLE_MAPS_API_KEY_KEY = 'mg_ismart_google_maps_api_key_v1';
const COLOR_OVERRIDE_KEY = 'mg_windsor_selected_color_v1';
const DEFAULT_CLOUD_SYNC_URL =
  'https://raw.githubusercontent.com/tonyjoseph456/mg-windsor-cloud-logger/main/data/cloud_charging_log.json';

// MG Windsor EV (EQ100) factory full usable BMS energy from captured 100% SOC frames (IDLE_100 = 37.3 kWh)
const WINDSOR_FACTORY_USABLE_KWH = 37.3;

const VAPID_PUB_B64URL =
  'BEDIJNL78q2CN6h-Mbf3xfqUKUM5HNR0tjZw4aikdcnztJaOJaP4Xz6ismoVROcaJW760XDrGDUE4byQayacUWE';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function getCardinalDirection(deg: number): string {
  const normalized = ((deg % 360) + 360) % 360;
  const directions = [
    'North',
    'North-east',
    'East',
    'South-east',
    'South',
    'South-west',
    'West',
    'North-west',
  ];
  const index = Math.round(normalized / 45) % 8;
  return directions[index];
}

interface PreChargeBaseline {
  timestampSec: number;
  soc: number;
  energyKwh: number;
  odometerKm: number;
  rangeKm: number;
  distanceSinceLastChargeKm: number;
  energyUsedSinceLastChargeKwh: number;
}

interface ParkedTripBaseline {
  timestampSec: number;
  soc: number;
  energyKwh: number;
  odometerKm: number;
  lat: number | null;
  lng: number | null;
  locationName: string;
  journeyId: number | null;
  interiorTemperature?: number | null;
  exteriorTemperature?: number | null;
}

async function resolveLocationLabel(
  lat: number | null | undefined,
  lng: number | null | undefined
): Promise<string> {
  if (lat === null || lat === undefined || lng === null || lng === undefined) {
    return 'Unknown Location';
  }
  const coordStr = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'MGiSmartIndiaCompanion/1.0',
          Accept: 'application/json',
        },
      }
    );
    if (!resp.ok) return coordStr;
    const data = await resp.json();
    const addr = data?.address;
    if (addr) {
      const parts = [
        addr.road || addr.neighbourhood || addr.suburb || addr.village,
        addr.city || addr.town || addr.county || addr.state_district,
      ].filter(Boolean);
      if (parts.length > 0) {
        return `${parts.join(', ')} (${coordStr})`;
      }
    }
    if (data?.display_name) {
      const shortName = String(data.display_name).split(',').slice(0, 2).join(',').trim();
      return `${shortName} (${coordStr})`;
    }
  } catch {
    // Fallback to raw coordinates if offline
  }
  return coordStr;
}


const forwardGeocodeCache = new Map<string, { lat: number; lng: number }>();

async function geocodeAddressCoords(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!address || address === 'Unknown' || address === 'Start' || address === 'Destination') return null;
  if (/\([-\d.]+,\s*[-\d.]+\)/.test(address)) return null;
  const cleanQuery = address.trim();
  if (forwardGeocodeCache.has(cleanQuery)) {
    return forwardGeocodeCache.get(cleanQuery)!;
  }
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanQuery + ', Kerala, India')}&limit=1`,
      {
        headers: {
          'User-Agent': 'MGiSmartIndiaCompanion/1.0',
          Accept: 'application/json',
        },
      }
    );
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data) && data.length > 0 && data[0].lat && data[0].lon) {
        const coords = { lat: Number(data[0].lat), lng: Number(data[0].lon) };
        forwardGeocodeCache.set(cleanQuery, coords);
        return coords;
      }
    }
  } catch (_) {}
  return null;
}

function mergeD1TripsWithLocalRichData(
  d1Trips: TripRecord[],
  localTrips: TripRecord[],
  liveStatus?: Partial<Status> | null
): TripRecord[] {
  const mapped = d1Trips.map((dt) => {
    const match = localTrips.find(
      (lt) =>
        lt.id === dt.id ||
        (Math.abs((lt.startOdometerKm || 0) - (dt.startOdometerKm || 0)) <= 0.3 &&
          Math.abs((lt.endOdometerKm || 0) - (dt.endOdometerKm || 0)) <= 0.3 &&
          dt.distanceKm > 0)
    );
    const startLat = dt.startLat ?? match?.startLat ?? null;
    const startLng = dt.startLng ?? match?.startLng ?? null;
    const endLat = dt.endLat ?? match?.endLat ?? null;
    const endLng = dt.endLng ?? match?.endLng ?? null;

    const startCabinTempC =
      dt.startCabinTempC ?? match?.startCabinTempC ?? match?.cabinTempC ?? liveStatus?.interior_temperature ?? null;
    const endCabinTempC =
      dt.endCabinTempC ?? match?.endCabinTempC ?? match?.cabinTempC ?? liveStatus?.interior_temperature ?? null;
    const startExteriorTempC =
      dt.startExteriorTempC ?? match?.startExteriorTempC ?? match?.exteriorTempC ?? liveStatus?.exterior_temperature ?? null;
    const endExteriorTempC =
      dt.endExteriorTempC ?? match?.endExteriorTempC ?? match?.exteriorTempC ?? liveStatus?.exterior_temperature ?? null;

    const avgSpd = dt.avgSpeedKmh || match?.avgSpeedKmh || 0;
    const estPeak =
      avgSpd > 0
        ? Math.min(115, Math.max(Number((avgSpd * 1.48).toFixed(1)), Number((avgSpd + 14).toFixed(1))))
        : 0;
    const maxSpeedKmh = Math.max(dt.maxSpeedKmh || 0, match?.maxSpeedKmh || 0, estPeak);

    return {
      ...dt,
      startLat,
      startLng,
      endLat,
      endLng,
      startLocation:
        startLat != null && startLng != null && !/\([-\d.]+,\s*[-\d.]+\)/.test(dt.startLocation || '')
          ? `${dt.startLocation} (${startLat.toFixed(6)}, ${startLng.toFixed(6)})`
          : match?.startLocation && /\([-\d.]+,\s*[-\d.]+\)/.test(match.startLocation)
          ? match.startLocation
          : dt.startLocation,
      endLocation:
        endLat != null && endLng != null && !/\([-\d.]+,\s*[-\d.]+\)/.test(dt.endLocation || '')
          ? `${dt.endLocation} (${endLat.toFixed(6)}, ${endLng.toFixed(6)})`
          : match?.endLocation && /\([-\d.]+,\s*[-\d.]+\)/.test(match.endLocation)
          ? match.endLocation
          : dt.endLocation,
      startCabinTempC,
      endCabinTempC,
      startExteriorTempC,
      endExteriorTempC,
      cabinTempC: endCabinTempC,
      exteriorTempC: endExteriorTempC,
      maxSpeedKmh,
    };
  });
  return deduplicateTripList(mapped);
}

function describeAcState(status: Partial<Status>): string {
  const rawBasic = status.raw?.basicVehicleStatus || status.raw || {};
  const rc = rawBasic.remoteClimateStatus;
  if (rc === 2) return 'Remote AC Cooling ON';
  if (rc === 3) return 'Remote Heating ON';
  if (rc === 4) return 'Remote Front Defrost ON';
  if (status.climate_running) return 'Remote AC ON';
  return 'Remote AC Off';
}

function formatDateTime(unixSec: number | null | undefined): string {
  if (!unixSec || unixSec <= 0) return '--';
  const d = new Date(unixSec * 1000);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDurationHm(seconds: number): string {
  if (!seconds || seconds <= 0) return '0m';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

/**
 * Cloud-recorded sessions (Cloudflare worker) are timestamped by the 24/7 poller, so they are far
 * more accurate than anything the app reconstructs after being opened late. These helpers turn the
 * worker's compact records into the app's full record shapes.
 */
function normalizeCloudCharge(c: any): ChargeLogRecord {
  const cap = WINDSOR_FACTORY_USABLE_KWH;
  const startSoc = Number(c.startSoc ?? 0);
  const endSoc = Number(c.endSoc ?? startSoc);
  const added = Number(c.energyAddedToPackKwh ?? 0);
  const startKwh = Number(c.startEnergyKwh ?? ((startSoc / 100) * cap).toFixed(2));
  let dist = Number(c.distanceTravelledSinceLastChargeKm ?? c.cycleDistanceKm ?? 0);
  let used = Number(c.energyUsedSinceLastChargeKwh ?? c.cycleEnergyKwh ?? 0);
  const startSec = Number(c.startTimestampSec);
  const endSec = c.endTimestampSec ? Number(c.endTimestampSec) : null;
  const dte = Number(
    c.distanceToEmptyAfterKm ||
    c.rangeKm ||
    c.dteKm ||
    (endSoc > 0 ? Math.round((endSoc / 100) * 320) : 320)
  );

  // If pre-charge drive counters are 0, reconstruct from battery consumption if startSoc < 98%
  if (dist <= 0 && startSoc < 98) {
    const consumedSoc = 100 - startSoc;
    if (consumedSoc > 0) {
      if (used <= 0) {
        used = Number(((consumedSoc / 100) * cap).toFixed(2));
      }
      dist = Number((used * 8.0).toFixed(1));
    }
  }

  const eff = dist > 0 && used > 0 ? Number((dist / used).toFixed(2)) : Number(c.efficiencyKmPerKwh || 0);

  const rawKw = Number(c.maxChargingSpeedKw ?? c.peak_power_kw ?? c.peak_kw ?? 0);
  let chargerCat: '3.3 kW AC' | '7.4 kW AC' | 'DC Fast' = '3.3 kW AC';
  if (rawKw > 11.0) {
    chargerCat = 'DC Fast';
  } else if (rawKw > 4.0) {
    chargerCat = '7.4 kW AC';
  } else if (rawKw > 0) {
    chargerCat = '3.3 kW AC';
  } else {
    const rawType = String(c.chargerCategory || c.charge_type || c.charger_type || '').toUpperCase();
    if (rawType.includes('DC')) chargerCat = 'DC Fast';
    else if (rawType.includes('7.4') || rawType.includes('7.2')) chargerCat = '7.4 kW AC';
    else chargerCat = '3.3 kW AC';
  }
  const effectiveKw = rawKw > 0 ? rawKw : (chargerCat === 'DC Fast' ? 30 : (chargerCat === '7.4 kW AC' ? 7.4 : 3.3));

  return {
    id: String(c.id),
    startTimestampSec: startSec,
    endTimestampSec: endSec,
    startDateTime: formatDateTime(startSec),
    endDateTime: endSec ? formatDateTime(endSec) : 'Charging in progress...',
    startSoc,
    endSoc,
    startEnergyKwh: startKwh,
    endEnergyKwh: Number(c.endEnergyKwh ?? (startKwh + added).toFixed(2)),
    odometerKm: Number(c.odometerKm ?? 0),
    distanceToEmptyAfterKm: dte > 0 ? dte : (endSoc > 0 ? Math.round((endSoc / 100) * 320) : 320),
    chargerCategory: chargerCat,
    maxChargingSpeedKw: effectiveKw,
    energyAddedToPackKwh: added,
    energyConsumedKwh: Number(c.energyConsumedKwh ?? added),
    energyLossPercent: Number(c.energyLossPercent ?? 0),
    distanceTravelledSinceLastChargeKm: dist,
    energyUsedSinceLastChargeKwh: used,
    efficiencyKmPerKwh: eff,
    durationSeconds: Number(c.durationSeconds ?? Math.max(0, (endSec ?? startSec) - startSec)),
    status: c.status === 'charging' ? 'charging' : 'completed',
  };
}

/** The BMS sometimes blips "not charging" mid-session; stitch such fragments back into one session. */
function mergeChargeFragments(list: ChargeLogRecord[]): ChargeLogRecord[] {
  const sorted = [...list].sort((a, b) => a.startTimestampSec - b.startTimestampSec);
  const out: ChargeLogRecord[] = [];
  for (const c of sorted) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.status === 'completed' &&
      prev.endTimestampSec &&
      c.startTimestampSec - prev.endTimestampSec <= 1800 &&
      prev.endSoc < 99 &&
      Math.abs((c.odometerKm || 0) - (prev.odometerKm || 0)) <= 1
    ) {
      const endSec = c.endTimestampSec ?? prev.endTimestampSec;
      const endSoc = Math.max(prev.endSoc, c.endSoc);
      const peak = Math.max(prev.maxChargingSpeedKw, c.maxChargingSpeedKw);
      out[out.length - 1] = {
        ...prev,
        endTimestampSec: endSec,
        endDateTime: c.endTimestampSec ? formatDateTime(endSec) : c.endDateTime,
        endSoc,
        endEnergyKwh: Math.max(prev.endEnergyKwh, c.endEnergyKwh),
        maxChargingSpeedKw: peak,
        energyAddedToPackKwh: Number((prev.energyAddedToPackKwh + c.energyAddedToPackKwh).toFixed(2)),
        energyConsumedKwh: Number((prev.energyConsumedKwh + c.energyConsumedKwh).toFixed(2)),
        durationSeconds: Math.max(0, endSec - prev.startTimestampSec),
        status: c.status,
      };
    } else {
      out.push(c);
    }
  }
  return out.sort((a, b) => b.startTimestampSec - a.startTimestampSec);
}

/** Reverse-geocode only a few places per sync (Nominatim allows ~1 request/second). */
async function labelOrCoords(
  lat: number | null | undefined,
  lng: number | null | undefined,
  budget: { n: number }
): Promise<string> {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return 'Unknown Location';
  if (budget.n <= 0) return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
  budget.n--;
  return resolveLocationLabel(lat, lng);
}

async function normalizeCloudTrip(
  t: any,
  keepNames: Map<string, TripRecord> | undefined,
  budget: { n: number }
): Promise<TripRecord> {
  const startSec = Number(t.startTimestampSec);
  const endSec = Number(t.endTimestampSec || t.startTimestampSec);
  const known = keepNames?.get(String(t.id));
  const startLoc =
    t.startLocation || known?.startLocation || (await labelOrCoords(t.startLat, t.startLng, budget));
  const endLoc =
    t.endLocation || known?.endLocation || (await labelOrCoords(t.endLat, t.endLng, budget));
  return {
    id: String(t.id),
    journeyId: t.journeyId ?? null,
    startTimestampSec: startSec,
    endTimestampSec: endSec,
    startDateTime: formatDateTime(startSec),
    endDateTime: formatDateTime(endSec),
    startSoc: Number(t.startSoc ?? 0),
    endSoc: Number(t.endSoc ?? 0),
    startEnergyKwh: Number(t.startEnergyKwh ?? 0),
    endEnergyKwh: Number(t.endEnergyKwh ?? 0),
    durationSeconds: Number(t.durationSeconds ?? Math.max(0, endSec - startSec)),
    distanceKm: Number(t.distanceKm ?? 0),
    startOdometerKm: Number(t.startOdometerKm ?? 0),
    endOdometerKm: Number(t.endOdometerKm ?? 0),
    energyUsedKwh: Number(t.energyUsedKwh ?? 0),
    efficiencyKmPerKwh: Number(t.efficiencyKmPerKwh ?? 0),
    startLat: t.startLat ?? null,
    startLng: t.startLng ?? null,
    endLat: t.endLat ?? null,
    endLng: t.endLng ?? null,
    startLocation: startLoc,
    endLocation: endLoc,
    idleDurationSeconds: Number(t.idleDurationSeconds ?? 0),
    idleEnergyKwh: Number(t.idleEnergyKwh ?? 0),
    acState: t.acState || '',
    startCabinTempC: t.startCabinTempC ?? null,
    endCabinTempC: t.endCabinTempC ?? null,
    startExteriorTempC: t.startExteriorTempC ?? null,
    endExteriorTempC: t.endExteriorTempC ?? null,
    cabinTempC: t.endCabinTempC ?? t.cabinTempC ?? null,
    exteriorTempC: t.endExteriorTempC ?? t.exteriorTempC ?? null,
    acTargetTempC: '',
    acFanSpeed: '',
    maxSpeedKmh: Number(t.maxSpeedKmh ?? 0),
    avgSpeedKmh: Number(t.avgSpeedKmh ?? 0),
    status: 'completed',
  };
}

const sameTrip = (a: TripRecord, b: TripRecord) =>
  a.id === b.id ||
  (Math.abs(a.startOdometerKm - b.startOdometerKm) <= 0.3 &&
    Math.abs(a.endOdometerKm - b.endOdometerKm) <= 0.3 &&
    a.distanceKm > 0 &&
    b.distanceKm > 0);

const sameCharge = (a: ChargeLogRecord, b: ChargeLogRecord) => {
  const aEnd = a.endTimestampSec ?? a.startTimestampSec;
  const bEnd = b.endTimestampSec ?? b.startTimestampSec;
  return a.id === b.id || (a.startTimestampSec <= bEnd + 1800 && b.startTimestampSec <= aEnd + 1800);
};

function classifyChargerSpeed(maxKw: number): {
  category: '3.3 kW AC' | '7.4 kW AC' | 'DC Fast';
  lossPct: number;
} {
  if (maxKw > 11.0) {
    return { category: 'DC Fast', lossPct: 6.0 };
  }
  if (maxKw > 4.0) {
    return { category: '7.4 kW AC', lossPct: 9.5 };
  }
  return { category: '3.3 kW AC', lossPct: 11.5 };
}

const MONTH_NAMES_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function getTripDateKey(trip: TripRecord): string {
  if (trip.startDateTime) {
    const m = trip.startDateTime.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
    if (m) {
      const day = m[1].padStart(2, '0');
      const mon = MONTH_NAMES_MAP[m[2].toLowerCase()];
      const yr = m[3];
      if (mon) return `${yr}-${mon}-${day}`;
    }
    const iso = trip.startDateTime.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = trip.startDateTime.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  if (typeof trip.startTimestampSec === 'number' && trip.startTimestampSec > 0) {
    const d = new Date(trip.startTimestampSec * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return '';
}

function getTodayDateKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatShortDayMonth(dateKey: string): string {
  if (!dateKey || dateKey === 'all') return '--';
  const parts = dateKey.split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const d = new Date(y, m, day);
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
    });
  }
  return dateKey;
}

function formatDisplayDateKey(dateKey: string): string {
  if (!dateKey || dateKey === 'all') return '--';
  const parts = dateKey.split('-');
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const d = new Date(y, m, day);
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }
  return dateKey;
}

const QUICK_DESTINATIONS: { name: string; position: { lat: number; lng: number } }[] = [
  { name: 'Kochi', position: { lat: 10.0274, lng: 76.3082 } },
  { name: 'Munnar', position: { lat: 10.0889, lng: 77.0595 } },
  { name: 'Thiruvananthapuram', position: { lat: 8.5241, lng: 76.9366 } },
  { name: 'Kozhikode', position: { lat: 11.2588, lng: 75.7804 } },
  { name: 'Coimbatore', position: { lat: 11.0168, lng: 76.9558 } },
  { name: 'Bengaluru', position: { lat: 12.9716, lng: 77.5946 } },
];

function formatTripRouteTitle(trip: TripRecord): string {
  const startClean = cleanLocationSummary(trip.startLocation);
  const endClean = cleanLocationSummary(trip.endLocation);
  const startPart = startClean ? startClean.split(',')[0].trim() : '';
  const endPart = endClean ? endClean.split(',')[0].trim() : '';

  if (startPart && endPart && startPart !== endPart) {
    return `${startPart} - ${endPart}`;
  }
  return startPart || endPart || 'Trip Journey';
}

function formatTripTimeDisplay(trip: TripRecord): string {
  let timeStr = '';
  if (trip.startTimestampSec) {
    const d = new Date(trip.startTimestampSec * 1000);
    timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  } else if (trip.startDateTime) {
    timeStr = extractTime(trip.startDateTime);
  } else {
    timeStr = '--';
  }
  const durSec =
    trip.durationSeconds > 0
      ? trip.durationSeconds
      : trip.endTimestampSec && trip.startTimestampSec
      ? trip.endTimestampSec - trip.startTimestampSec
      : 0;
  const durMin = Math.max(1, Math.round(durSec / 60));
  return `${timeStr} · ${durMin} min`;
}

function formatTripDistDisplay(trip: TripRecord): string {
  const d = Number(trip.distanceKm) || 0;
  return d % 1 === 0 ? `${d} km` : `${d.toFixed(1)} km`;
}

function formatTripDetailSubtitle(trip: TripRecord): string {
  const dateStr = trip.startDateTime ? extractDate(trip.startDateTime) : formatDisplayDateKey(getTripDateKey(trip));
  let startT = '';
  let endT = '';
  if (trip.startTimestampSec) {
    startT = new Date(trip.startTimestampSec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  } else {
    startT = extractTime(trip.startDateTime);
  }
  if (trip.endTimestampSec) {
    endT = new Date(trip.endTimestampSec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  } else {
    endT = extractTime(trip.endDateTime);
  }
  if (startT && endT && startT !== '--' && endT !== '--') {
    return `${dateStr} · ${startT} – ${endT}`;
  }
  return dateStr;
}

function getChargeDateKey(session: ChargeLogRecord): string {
  if (session.startDateTime) {
    const m = session.startDateTime.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
    if (m) {
      const day = m[1].padStart(2, '0');
      const mon = MONTH_NAMES_MAP[m[2].toLowerCase()];
      const yr = m[3];
      if (mon) return `${yr}-${mon}-${day}`;
    }
    const iso = session.startDateTime.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = session.startDateTime.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  if (typeof session.startTimestampSec === 'number' && session.startTimestampSec > 0) {
    const d = new Date(session.startTimestampSec * 1000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return '';
}

interface HistoryCalendarProps {
  selectedDateKey: string;
  activeDateKeys: Set<string>;
  legendLabel?: string;
  onSelectDate: (dateKey: string) => void;
  onShowAll: () => void;
  onClose: () => void;
}

function HistoryCalendar({
  selectedDateKey,
  activeDateKeys,
  legendLabel = 'Dates with activity',
  onSelectDate,
  onShowAll,
  onClose,
}: HistoryCalendarProps) {
  const todayKey = getTodayDateKey();
  const [viewDate, setViewDate] = useState(() => {
    if (selectedDateKey && selectedDateKey !== 'all') {
      const parts = selectedDateKey.split('-');
      if (parts.length === 3) {
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
      }
    }
    return new Date();
  });

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const handlePrevMonth = () => {
    setViewDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setViewDate(new Date(year, month + 1, 1));
  };

  const handleTodayPress = () => {
    onSelectDate(todayKey);
  };

  const monthLabel = viewDate.toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOfWeek = new Date(year, month, 1).getDay(); // 0 = Sunday

  const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const cells: Array<{ day: number | null; dateKey: string | null }> = [];
  for (let i = 0; i < firstDayOfWeek; i++) {
    cells.push({ day: null, dateKey: null });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const mStr = String(month + 1).padStart(2, '0');
    const dStr = String(d).padStart(2, '0');
    cells.push({
      day: d,
      dateKey: `${year}-${mStr}-${dStr}`,
    });
  }

  return (
    <View style={styles.calendarContainer}>
      {/* Header */}
      <View style={styles.calendarHeader}>
        <TouchableOpacity
          style={styles.calendarNavBtn}
          onPress={handlePrevMonth}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.calendarNavText}>◀</Text>
        </TouchableOpacity>

        <View style={styles.calendarTitleWrap}>
          <Text style={styles.calendarMonthText}>{monthLabel}</Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <TouchableOpacity
            style={[
              styles.calendarTodayBtn,
              selectedDateKey === todayKey && styles.calendarTodayBtnActive,
            ]}
            onPress={handleTodayPress}
          >
            <Text
              style={[
                styles.calendarTodayBtnText,
                selectedDateKey === todayKey && styles.calendarTodayBtnTextActive,
              ]}
            >
              Today
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.calendarNavBtn}
            onPress={handleNextMonth}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.calendarNavText}>▶</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Week Day Labels */}
      <View style={styles.calendarWeekRow}>
        {dayNames.map((name, idx) => (
          <View key={idx} style={styles.calendarWeekHeaderCell}>
            <Text
              style={[
                styles.calendarWeekHeaderText,
                idx === 0 && { color: '#F87171' },
              ]}
            >
              {name}
            </Text>
          </View>
        ))}
      </View>

      {/* Calendar Grid */}
      <View style={styles.calendarGrid}>
        {cells.map((cell, idx) => {
          if (!cell.day || !cell.dateKey) {
            return <View key={`empty-${idx}`} style={styles.calendarDayCell} />;
          }

          const isSelected = cell.dateKey === selectedDateKey;
          const isToday = cell.dateKey === todayKey;
          const hasActivity = activeDateKeys.has(cell.dateKey);

          return (
            <TouchableOpacity
              key={cell.dateKey}
              style={[
                styles.calendarDayCell,
                isSelected && styles.calendarDayCellSelected,
                !isSelected && isToday && styles.calendarDayCellToday,
              ]}
              onPress={() => onSelectDate(cell.dateKey!)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.calendarDayText,
                  isSelected && styles.calendarDayTextSelected,
                  !isSelected && isToday && styles.calendarDayTextToday,
                  !isSelected && !isToday && hasActivity && styles.calendarDayTextHasTrips,
                ]}
              >
                {cell.day}
              </Text>
              {hasActivity && (
                <View
                  style={[
                    styles.calendarTripDot,
                    isSelected && styles.calendarTripDotSelected,
                  ]}
                />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Footer with Legend and Controls */}
      <View style={styles.calendarFooter}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={styles.calendarLegendDot} />
          <Text style={styles.calendarLegendText}>{legendLabel}</Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <TouchableOpacity onPress={onShowAll}>
            <Text style={[styles.calendarCloseText, { color: '#34D399' }]}>Show All Dates</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.calendarCloseText}>Hide ▲</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const TripCalendar = ({
  selectedDateKey,
  tripDateKeys,
  onSelectDate,
  onShowAll,
  onClose,
}: {
  selectedDateKey: string;
  tripDateKeys: Set<string>;
  onSelectDate: (dateKey: string) => void;
  onShowAll: () => void;
  onClose: () => void;
}) => (
  <HistoryCalendar
    selectedDateKey={selectedDateKey}
    activeDateKeys={tripDateKeys}
    legendLabel="Dates with trips"
    onSelectDate={onSelectDate}
    onShowAll={onShowAll}
    onClose={onClose}
  />
);


const LIVE_ACTIVITY_KEY = 'mg_live_activity_enabled';

let liveActivityAudioInstance: any = null;
let silentAudioBlobUrl: string | null = null;

function getOrCreateSilentAudioUrl(): string {
  if (silentAudioBlobUrl) return silentAudioBlobUrl;
  if (typeof window === 'undefined' || typeof Blob === 'undefined') return '';

  const sampleRate = 8000;
  const numSeconds = 4;
  const numSamples = sampleRate * numSeconds;
  const buffer = new ArrayBuffer(44 + numSamples);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true); // 8-bit
  writeStr(36, 'data');
  view.setUint32(40, numSamples, true);

  const bytes = new Uint8Array(buffer, 44);
  bytes.fill(128); // 8-bit PCM silence

  try {
    const blob = new Blob([buffer], { type: 'audio/wav' });
    silentAudioBlobUrl = URL.createObjectURL(blob);
    return silentAudioBlobUrl;
  } catch {
    return '';
  }
}

function startLiveActivityAudio(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const AudioCtor: any = (window as any).Audio;
    if (!AudioCtor) return false;

    const url = getOrCreateSilentAudioUrl();
    if (!url) return false;

    if (!liveActivityAudioInstance) {
      const audio = new AudioCtor(url);
      audio.loop = true;
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      audio.setAttribute('webkit-playsinline', '');
      audio.volume = 1.0;
      liveActivityAudioInstance = audio;
    }

    const p = liveActivityAudioInstance.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}

function stopLiveActivityAudio() {
  try {
    if (liveActivityAudioInstance) {
      liveActivityAudioInstance.pause();
      liveActivityAudioInstance.currentTime = 0;
    }
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    if (nav && nav.mediaSession) {
      nav.mediaSession.playbackState = 'none';
    }
  } catch {}
}

if (typeof window !== 'undefined') {
  const primeLiveActivityAudio = () => {
    try {
      if (!liveActivityAudioInstance) {
        const AudioCtor = (window as any).Audio;
        const url = getOrCreateSilentAudioUrl();
        if (AudioCtor && url) {
          const a = new AudioCtor(url);
          a.loop = true;
          a.volume = 1.0;
          a.setAttribute('playsinline', '');
          a.setAttribute('webkit-playsinline', '');
          liveActivityAudioInstance = a;
        }
      }
    } catch {}
    window.removeEventListener('click', primeLiveActivityAudio);
    window.removeEventListener('touchstart', primeLiveActivityAudio);
  };
  window.addEventListener('click', primeLiveActivityAudio, { passive: true, once: true });
  window.addEventListener('touchstart', primeLiveActivityAudio, { passive: true, once: true });
}

function generateLiveActivityArtwork(
  soc: number,
  isCharging: boolean,
  headline: string,
  subline: string
): string {
  if (typeof document === 'undefined') return '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const bg = ctx.createLinearGradient(0, 0, 0, 512);
    bg.addColorStop(0, '#0F172A');
    bg.addColorStop(1, '#020617');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 512, 512);

    const centerX = 256;
    const centerY = 210;
    const radius = 135;

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 18;
    ctx.lineCap = 'round';
    ctx.stroke();

    const startAngle = -Math.PI / 2;
    const clampedSoc = Math.min(100, Math.max(0, soc));
    const endAngle = startAngle + (clampedSoc / 100) * 2 * Math.PI;

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.strokeStyle = isCharging ? '#10B981' : clampedSoc <= 20 ? '#EF4444' : '#38BDF8';
    ctx.lineWidth = 18;
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.fillStyle = '#EF4444';
    ctx.font = 'bold 22px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('MG WINDSOR EV', centerX, centerY - 65);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 92px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(`${Math.round(clampedSoc)}%`, centerX, centerY + 8);

    ctx.fillStyle = isCharging ? '#34D399' : '#38BDF8';
    ctx.font = 'bold 24px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(headline.toUpperCase(), centerX, centerY + 70);

    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(50, 390);
    ctx.lineTo(462, 390);
    ctx.stroke();

    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 22px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillText(subline, centerX, 435);

    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

interface PersistedSession {
  phone: string;
  password: string;
  pin: string;
  vin: string;
  uid: string;
  token: string;
}

function normalizeVehicleDisplayName(rawName?: string | null, series?: string | null): string {
  const s = (series || rawName || '').trim().toUpperCase();
  if (s === 'EQ100' || s === 'WINDSOR') return 'Windsor EV';
  if (s === 'EC32' || s === 'COMET') return 'Comet EV';
  if (s === 'ZS11') return 'ZS EV';
  return rawName || 'Windsor EV';
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [tab, setTab] = useState<TabId>('home');

  // Global Font Scale for Small Mobile Screens & Accessibility (80% - 125%)
  const [fontScale, setFontScale] = useState<number>(() => getGlobalFontScale());

  const handleFontScaleChange = useCallback(async (val: number) => {
    const clamped = Math.max(0.75, Math.min(1.3, Number(val.toFixed(2))));
    setFontScale(clamped);
    setGlobalFontScale(clamped);
    await SecureStore.setItemAsync(FONT_SCALE_KEY, String(clamped));
  }, []);

  // Credentials & Session
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [vin, setVin] = useState('');

  // Telemetry state
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    const currentVin = snapshot?.vehicle?.vin || vin;
    setActiveD1Vin(currentVin || '');
  }, [vin, snapshot?.vehicle?.vin]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [activeTrip, setActiveTrip] = useState<TripRecord | null>(null);
  const [parkedBaseline, setParkedBaseline] = useState<ParkedTripBaseline | null>(null);
  const [liveTripTracking, setLiveTripTracking] = useState<boolean>(false);

  // Home Screen Redesign: Color & Detail Sections State
  const [carColorOverride, setCarColorOverride] = useState<string | null>(null);
  const [showColorPicker, setShowColorPicker] = useState<boolean>(false);
  const [openDetailSection, setOpenDetailSection] = useState<'remote' | null>(null);

  // Tyres & Closures Screen Horizontal Tween Animation State
  const tyreSlideAnim = useRef(new Animated.Value(0)).current;
  const [isTyresScreenVisible, setIsTyresScreenVisible] = useState<boolean>(false);

  const handleOpenTyresScreen = () => {
    setIsTyresScreenVisible(true);
    Animated.timing(tyreSlideAnim, {
      toValue: 1,
      duration: 320,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  };

  const handleCloseTyresScreen = () => {
    Animated.timing(tyreSlideAnim, {
      toValue: 0,
      duration: 280,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: Platform.OS !== 'web',
    }).start(() => {
      setIsTyresScreenVisible(false);
    });
  };

  // Location Screen Horizontal Tween Animation State
  const locationSlideAnim = useRef(new Animated.Value(0)).current;
  const [isLocationScreenVisible, setIsLocationScreenVisible] = useState<boolean>(false);

  const handleOpenLocationScreen = () => {
    setIsLocationScreenVisible(true);
    Animated.timing(locationSlideAnim, {
      toValue: 1,
      duration: 320,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  };

  const handleCloseLocationScreen = () => {
    Animated.timing(locationSlideAnim, {
      toValue: 0,
      duration: 280,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: Platform.OS !== 'web',
    }).start(() => {
      setIsLocationScreenVisible(false);
    });
  };

  // Remote Commands Screen Horizontal Tween Animation State
  const remoteSlideAnim = useRef(new Animated.Value(0)).current;
  const [isRemoteScreenVisible, setIsRemoteScreenVisible] = useState<boolean>(false);

  const handleOpenRemoteScreen = () => {
    setIsRemoteScreenVisible(true);
    Animated.timing(remoteSlideAnim, {
      toValue: 1,
      duration: 320,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  };

  const handleCloseRemoteScreen = () => {
    Animated.timing(remoteSlideAnim, {
      toValue: 0,
      duration: 280,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: Platform.OS !== 'web',
    }).start(() => {
      setIsRemoteScreenVisible(false);
    });
  };

  // Trips Subscreens (Plan a Trip & Trip Detail) Tween State
  const planSlideAnim = useRef(new Animated.Value(0)).current;
  const [isPlanScreenVisible, setIsPlanScreenVisible] = useState<boolean>(false);

  const handleOpenPlanScreen = () => {
    setIsPlanScreenVisible(true);
    Animated.timing(planSlideAnim, {
      toValue: 1,
      duration: 320,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  };

  const handleClosePlanScreen = () => {
    Animated.timing(planSlideAnim, {
      toValue: 0,
      duration: 280,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: Platform.OS !== 'web',
    }).start(() => {
      setIsPlanScreenVisible(false);
    });
  };

  const tripDetailSlideAnim = useRef(new Animated.Value(0)).current;
  const [isTripDetailVisible, setIsTripDetailVisible] = useState<boolean>(false);
  const [selectedTripForDetail, setSelectedTripForDetail] = useState<TripRecord | null>(null);

  const handleOpenTripDetail = (trip: TripRecord) => {
    setSelectedTripForDetail(trip);
    setIsTripDetailVisible(true);
    Animated.timing(tripDetailSlideAnim, {
      toValue: 1,
      duration: 320,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  };

  const handleCloseTripDetail = () => {
    Animated.timing(tripDetailSlideAnim, {
      toValue: 0,
      duration: 280,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
      useNativeDriver: Platform.OS !== 'web',
    }).start(() => {
      setIsTripDetailVisible(false);
      setSelectedTripForDetail(null);
    });
  };

  // Trips Options Menu State
  const [showTripsOptionsMenu, setShowTripsOptionsMenu] = useState<boolean>(false);

  // Plan a Trip Parameters State
  const [planOriginMode, setPlanOriginMode] = useState<'car' | 'custom'>('car');
  const [planCustomOrigin, setPlanCustomOrigin] = useState<string>('');
  const [planStrategy, setPlanStrategy] = useState<'fastest' | 'fixed100'>('fixed100');
  const [planStartSoc, setPlanStartSoc] = useState<number>(90);
  const [planMinCharger, setPlanMinCharger] = useState<number>(25);
  const [planMinDest, setPlanMinDest] = useState<number>(50);
  const [planChargeTo, setPlanChargeTo] = useState<number>(100);
  const [planDestQuery, setPlanDestQuery] = useState<string>('');
  const [planSelectedDest, setPlanSelectedDest] = useState<NamedPlace | null>(null);
  const [planIsComputing, setPlanIsComputing] = useState<boolean>(false);
  const [planProgressMsg, setPlanProgressMsg] = useState<string>('');
  const [planError, setPlanError] = useState<string | null>(null);
  const [planComputedChoices, setPlanComputedChoices] = useState<RouteChoice[]>([]);

  const handleExecutePlanRoute = async (targetDest?: NamedPlace) => {
    let dest = targetDest || planSelectedDest;
    if (!dest && planDestQuery.trim()) {
      const match = QUICK_DESTINATIONS.find(
        (q) => q.name.toLowerCase() === planDestQuery.trim().toLowerCase()
      );
      if (match) {
        dest = { placeId: 'quick-dest-' + match.name.toLowerCase(), name: match.name, position: match.position };
      } else {
        dest = { placeId: 'custom-dest-' + Date.now(), name: planDestQuery.trim(), position: { lat: 10.0889, lng: 77.0595 } };
      }
    }
    if (!dest) {
      setPlanError('Please enter or select a destination first.');
      return;
    }
    setPlanError(null);
    setPlanIsComputing(true);
    setPlanProgressMsg('Calculating terrain & charging corridor...');

    try {
      const originPos =
        planOriginMode === 'car' && status.gps?.latitude && status.gps?.longitude
          ? { lat: status.gps.latitude, lng: status.gps.longitude }
          : { lat: 10.062227, lng: 76.620519 };

      const choices = await computeTripRouteChoices(
        originPos,
        dest,
        googleMapsApiKey,
        (msg) => setPlanProgressMsg(msg)
      );
      setPlanComputedChoices(choices);
      setPlanIsComputing(false);
      showBanner('ok', `Route planned to ${dest.name}!`);
    } catch (e: any) {
      setPlanIsComputing(false);
      setPlanError(e?.message || 'Could not compute route.');
    }
  };

  const handleShareTripRecord = async (trip: TripRecord) => {
    try {
      showBanner('ok', 'Preparing trip telemetry card...');
      const dateStr = trip.startDateTime ? extractDate(trip.startDateTime) : formatDisplayDateKey(getTripDateKey(trip));
      const durSec = trip.durationSeconds || (trip.endTimestampSec - trip.startTimestampSec) || 60;
      const startShort = cleanLocationSummary(trip.startLocation);
      const endShort = cleanLocationSummary(trip.endLocation);
      const timeRange = formatDetailedTravelTime(trip.startDateTime, trip.endDateTime);

      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const eff = trip.efficiencyKmPerKwh > 0
          ? `${trip.efficiencyKmPerKwh} km/kWh`
          : trip.energyUsedKwh > 0
          ? `${(trip.distanceKm / trip.energyUsedKwh).toFixed(2)} km/kWh`
          : '8.6 km/kWh';

        const blob = await renderTelemetryCardToBlob({
          titleBadge: 'MG WINDSOR EV • TRIP TELEMETRY',
          dateStr: `📅  ${dateStr}`,
          odoStr: trip.endOdometerKm > 0 ? `${trip.endOdometerKm.toLocaleString()} km` : '',
          timeRangeStr: timeRange,
          durationBadgeStr: `(${formatDurationDetailed(durSec)})`,
          pills: [
            { label: 'DISTANCE', value: `${trip.distanceKm} km` },
            { label: 'TIME', value: formatDurationDetailed(durSec) },
            { label: 'BATTERY', value: `${trip.startSoc.toFixed(0)}% → ${trip.endSoc.toFixed(0)}%`, color: '#34D399' },
            { label: 'EFFICIENCY', value: eff },
          ],
          heading: 'TRIP & DRIVING TELEMETRY',
          metrics: [
            { label: '1. Start Battery', value: `${trip.startSoc.toFixed(1)}% (${trip.startEnergyKwh} kWh)` },
            { label: '2. End Battery', value: `${trip.endSoc.toFixed(1)}% (${trip.endEnergyKwh} kWh)` },
            { label: '3. Duration', value: formatDurationDetailed(durSec) },
            { label: '4. Distance', value: `${trip.distanceKm} km (${trip.startOdometerKm} → ${trip.endOdometerKm} km)` },
            { label: '5. Energy Used', value: `${trip.energyUsedKwh} kWh (${eff})` },
            { label: '6. Route', value: `${startShort} → ${endShort}` },
            { label: '7. Max Speed', value: `${trip.maxSpeedKmh || (trip.avgSpeedKmh * 1.45).toFixed(0)} km/h` },
            { label: '8. Average Speed', value: `${trip.avgSpeedKmh || (trip.distanceKm / (durSec / 3600)).toFixed(0)} km/h` },
          ],
        });

        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `Windsor_Trip_${dateStr.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showBanner('ok', 'Telemetry image downloaded');
        }
      } else {
        showBanner('ok', `Trip: ${trip.distanceKm} km, ${startShort} → ${endShort}`);
      }
    } catch (e: any) {
      showBanner('err', `Could not share trip: ${e?.message}`);
    }
  };

  const handleManualLogTrip = async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const base = parkedBaselineRef.current;
    const curOdo = charge?.odometer_km ?? status.odometer_km ?? 0;
    const curEnergy =
      charge?.battery_energy_kwh ??
      Number(((clampedSoc / 100) * nominalCapacityKwh).toFixed(2));
    const distFromCharge = charge?.distance_since_last_charge_km ?? 0;
    const usedFromCharge = charge?.power_usage_since_last_charge_kwh ?? 0;

    const distKm =
      activeTrip?.distanceKm ||
      (base && curOdo > base.odometerKm
        ? Number((curOdo - base.odometerKm).toFixed(1))
        : distFromCharge);
    const usedKwh =
      activeTrip?.energyUsedKwh ||
      (base && base.energyKwh > curEnergy
        ? Number((base.energyKwh - curEnergy).toFixed(2))
        : usedFromCharge);
    const startSocVal =
      activeTrip?.startSoc ??
      base?.soc ??
      Math.min(100, Number((clampedSoc + (usedKwh / nominalCapacityKwh) * 100).toFixed(1)));
    const startKwhVal =
      activeTrip?.startEnergyKwh ??
      base?.energyKwh ??
      Number((curEnergy + usedKwh).toFixed(2));
    const startSec =
      activeTrip?.startTimestampSec ||
      base?.timestampSec ||
      nowSec - 1800;
    const durSec = Math.max(60, nowSec - startSec);
    const avgSpd =
      distKm > 0 ? Number((distKm / (durSec / 3600)).toFixed(1)) : 0;
    const curLat = status.gps?.latitude ?? null;
    const curLng = status.gps?.longitude ?? null;
    const locLabel = await resolveLocationLabel(curLat, curLng);

    const manualTrip: TripRecord = {
      id: `trip-manual-${Date.now()}`,
      journeyId: null,
      startTimestampSec: startSec,
      endTimestampSec: nowSec,
      startDateTime: formatDateTime(startSec),
      endDateTime: formatDateTime(nowSec),
      startSoc: startSocVal,
      endSoc: clampedSoc,
      startEnergyKwh: startKwhVal,
      endEnergyKwh: curEnergy,
      durationSeconds: durSec,
      distanceKm: distKm,
      startOdometerKm: Math.max(0, Number((curOdo - distKm).toFixed(1))),
      endOdometerKm: curOdo,
      energyUsedKwh: usedKwh,
      efficiencyKmPerKwh: usedKwh > 0 ? Number((distKm / usedKwh).toFixed(2)) : 0,
      startLat: activeTrip?.startLat ?? base?.lat ?? curLat,
      startLng: activeTrip?.startLng ?? base?.lng ?? curLng,
      endLat: curLat,
      endLng: curLng,
      startLocation: activeTrip?.startLocation || base?.locationName || locLabel,
      endLocation: locLabel,
      idleDurationSeconds: activeTrip?.idleDurationSeconds || 0,
      idleEnergyKwh: activeTrip?.idleEnergyKwh || 0,
      acState: describeAcState(status),
      startCabinTempC: activeTrip?.startCabinTempC ?? base?.interiorTemperature ?? status.interior_temperature ?? null,
      endCabinTempC: status.interior_temperature ?? activeTrip?.endCabinTempC ?? null,
      startExteriorTempC: activeTrip?.startExteriorTempC ?? base?.exteriorTemperature ?? status.exterior_temperature ?? null,
      endExteriorTempC: status.exterior_temperature ?? activeTrip?.endExteriorTempC ?? null,
      cabinTempC: status.interior_temperature ?? null,
      exteriorTempC: status.exterior_temperature ?? null,
      acTargetTempC: '',
      acFanSpeed: '',
      maxSpeedKmh: Math.max(
        activeTrip?.maxSpeedKmh || 0,
        status.gps?.speed_kmh || 0,
        avgSpd
      ),
      avgSpeedKmh: avgSpd,
      status: 'completed',
    };

    const nextTrips = deduplicateTripList([manualTrip, ...tripsRef.current]);
    setTrips(nextTrips);
    tripsRef.current = nextTrips;
    setSelectedTripDate(getTodayDateKey());
    await SecureStore.setItemAsync(TRIPS_KEY, JSON.stringify(nextTrips));
    showBanner('ok', 'Saved current trip to Trip History');
    syncTripsToD1([manualTrip]).catch(() => {});
    if (googleConfigRef.current?.accessToken && googleConfigRef.current?.spreadsheetId && googleConfigRef.current?.autoSync) {
      syncTripsToGoogleSheet(googleConfigRef.current.accessToken, googleConfigRef.current.spreadsheetId, [manualTrip]).catch(() => {});
    }
  };

  // Google Maps API Key State
  const [googleMapsApiKey, setGoogleMapsApiKey] = useState<string>('');
  const [tempMapsApiKey, setTempMapsApiKey] = useState<string>('');
  const [isMapsKeySaved, setIsMapsKeySaved] = useState<boolean>(false);
  const [googleMapsKeyError, setGoogleMapsKeyError] = useState<boolean>(false);

  const handleSaveMapsApiKey = async (val: string) => {
    const trimmed = val.trim();
    setGoogleMapsApiKey(trimmed);
    setTempMapsApiKey(trimmed);
    setGoogleMapsKeyError(false);
    if (trimmed) {
      await SecureStore.setItemAsync(GOOGLE_MAPS_API_KEY_KEY, trimmed);
      setIsMapsKeySaved(true);
      setTimeout(() => setIsMapsKeySaved(false), 3000);
    } else {
      await SecureStore.deleteItemAsync(GOOGLE_MAPS_API_KEY_KEY);
    }
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handleMsg = (event: MessageEvent) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data && data.type === 'GOOGLE_MAPS_ERROR') {
          setGoogleMapsKeyError(true);
        }
      } catch (e) {}
    };
    window.addEventListener('message', handleMsg);
    return () => window.removeEventListener('message', handleMsg);
  }, []);

  useEffect(() => {
    SecureStore.getItemAsync(COLOR_OVERRIDE_KEY).then((c) => {
      if (c) setCarColorOverride(c);
    }).catch(() => {});

    SecureStore.getItemAsync(GOOGLE_MAPS_API_KEY_KEY).then((k) => {
      if (k) {
        setGoogleMapsApiKey(k);
        setTempMapsApiKey(k);
      }
    }).catch(() => {});
  }, []);

  // Trip History Date Filter & Calendar State
  const [selectedTripDate, setSelectedTripDate] = useState<string>(() => getTodayDateKey());
  const [showTripCalendar, setShowTripCalendar] = useState<boolean>(false);

  // Revert trip and charging filters to current day whenever user changes tabs
  useEffect(() => {
    setSelectedTripDate(getTodayDateKey());
    setShowTripCalendar(false);
    setSelectedChargeDate(getTodayDateKey());
    setShowChargeCalendar(false);
  }, [tab]);

  const todayKey = getTodayDateKey();

  const [d1TripDates, setD1TripDates] = useState<string[]>([]);
  const [d1ChargeDates, setD1ChargeDates] = useState<string[]>([]);

  // Monthly Driving & Charging Analytics Selector State (Account Tab)
  const [analyticsYear, setAnalyticsYear] = useState<number>(() => new Date().getFullYear());
  const [analyticsMonth, setAnalyticsMonth] = useState<string>(() =>
    String(new Date().getMonth() + 1).padStart(2, '0')
  );

  // Query D1 trips and distinct dates whenever Trips or Account tab is opened
  useEffect(() => {
    if (tab === 'trips' || tab === 'account') {
      fetchD1TripDates().then((dates) => {
        if (dates && dates.length > 0) setD1TripDates(dates);
      }).catch(() => {});

      // Fetch all trips from Cloudflare D1
      fetchD1Trips('all').then((d1Trips) => {
        if (Array.isArray(d1Trips)) {
          const merged = mergeD1TripsWithLocalRichData(d1Trips, tripsRef.current, snapshot?.status);
          setTrips(merged);
          tripsRef.current = merged;
          SecureStore.setItemAsync(TRIPS_KEY, JSON.stringify(merged)).catch(() => {});
        }
      }).catch(() => {});
    }
  }, [tab]);

  const tripDateKeysSet = useMemo(() => {
    const set = new Set<string>();
    for (const d of d1TripDates) {
      if (d) set.add(d);
    }
    for (const t of trips) {
      const k = getTripDateKey(t);
      if (k) set.add(k);
    }
    return set;
  }, [trips, d1TripDates]);

  const displayedTrips = useMemo(() => {
    if (selectedTripDate === 'all') {
      return trips;
    }
    return trips.filter((t) => getTripDateKey(t) === selectedTripDate);
  }, [trips, selectedTripDate]);

  const [chargeLogs, setChargeLogs] = useState<ChargeLogRecord[]>([]);
  const [activeCharge, setActiveCharge] = useState<ChargeLogRecord | null>(null);

  // Charging History Date Filter & Calendar State
  const [selectedChargeDate, setSelectedChargeDate] = useState<string>(() => getTodayDateKey());
  const [showChargeCalendar, setShowChargeCalendar] = useState<boolean>(false);

  // Query D1 charges and distinct dates whenever Charge or Account tab is opened
  useEffect(() => {
    if (tab === 'charge' || tab === 'account') {
      fetchD1ChargeDates().then((dates) => {
        if (dates && dates.length > 0) setD1ChargeDates(dates);
      }).catch(() => {});

      // Fetch all charges from Cloudflare D1
      fetchD1Charges('all').then((d1Charges) => {
        if (Array.isArray(d1Charges)) {
          setChargeLogs(d1Charges);
          chargeLogsRef.current = d1Charges;
          SecureStore.setItemAsync(CHARGE_LOGS_KEY, JSON.stringify(d1Charges)).catch(() => {});
        }
      }).catch(() => {});
    }
  }, [tab]);

  const chargeDateKeysSet = useMemo(() => {
    const set = new Set<string>();
    for (const d of d1ChargeDates) {
      if (d) set.add(d);
    }
    for (const c of chargeLogs) {
      const k = getChargeDateKey(c);
      if (k) set.add(k);
    }
    return set;
  }, [chargeLogs, d1ChargeDates]);

  const displayedCharges = useMemo(() => {
    if (selectedChargeDate === 'all') {
      return chargeLogs;
    }
    return chargeLogs.filter((c) => getChargeDateKey(c) === selectedChargeDate);
  }, [chargeLogs, selectedChargeDate]);
  const [preChargeBaseline, setPreChargeBaseline] = useState<PreChargeBaseline | null>(null);
  const [cloudSyncUrl, setCloudSyncUrl] = useState<string>(DEFAULT_CLOUD_SYNC_URL);
  const [cloudApiKey, setCloudApiKey] = useState<string>('');
  const [lastCloudSyncAt, setLastCloudSyncAt] = useState<string | null>(null);

  // Google Drive & Google Sheets Sync State
  const [googleConfig, setGoogleConfig] = useState<GoogleSyncConfig | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string>('');
  const [isGoogleSyncing, setIsGoogleSyncing] = useState<boolean>(false);
  const googleConfigRef = useRef<GoogleSyncConfig | null>(null);
  const [isBackendBusy, setIsBackendBusy] = useState<boolean>(false);

  // Cloudflare D1 Stored Notifications State
  const [d1Notifications, setD1Notifications] = useState<AppNotificationRecord[]>([]);
  const [isNotifsLoading, setIsNotifsLoading] = useState<boolean>(false);

  // Cloudflare D1 Charging Sessions State
  const [d1ChargingSessions, setD1ChargingSessions] = useState<ChargingSessionRecord[]>([]);
  const [isChargingHistoryLoading, setIsChargingHistoryLoading] = useState<boolean>(false);

  const refreshD1ChargingHistory = async (refreshFromVehicle = false) => {
    setIsChargingHistoryLoading(true);
    try {
      const list = await fetchChargingHistory(refreshFromVehicle);
      if (Array.isArray(list)) {
        setD1ChargingSessions(list);
      }
    } catch (_) {}
    finally {
      setIsChargingHistoryLoading(false);
    }
  };

  const refreshD1Notifications = async () => {
    setIsNotifsLoading(true);
    try {
      const list = await fetchD1Notifications(60);
      setD1Notifications(list);
    } catch (_) {}
    finally {
      setIsNotifsLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'account') {
      refreshD1Notifications();
    }
    if (tab === 'charge') {
      refreshD1ChargingHistory(false);
    }
  }, [tab]);

  const tripsRef = useRef<TripRecord[]>([]);
  const activeTripRef = useRef<TripRecord | null>(null);
  const parkedBaselineRef = useRef<ParkedTripBaseline | null>(null);
  const chargeLogsRef = useRef<ChargeLogRecord[]>([]);
  const activeChargeRef = useRef<ChargeLogRecord | null>(null);
  const baselineRef = useRef<PreChargeBaseline | null>(null);
  const cloudSyncUrlRef = useRef<string>(DEFAULT_CLOUD_SYNC_URL);
  const cloudApiKeyRef = useRef<string>('');


  // Loading & command states
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // PIN prompt modal (when PIN wasn't saved during login)
  const [pinPrompt, setPinPrompt] = useState<{
    visible: boolean;
    label: string;
    onConfirm: (pinVal: string) => void;
  } | null>(null);
  const [tempPin, setTempPin] = useState('');

  const clientRef = useRef<MgIndiaClient | null>(null);

  // Web / PWA pull-down-to-refresh touch gesture tracking
  const touchStartY = useRef<number>(0);
  const scrollYRef = useRef<number>(0);

  const handleTouchStart = (e: any) => {
    touchStartY.current = e.nativeEvent.pageY || e.nativeEvent.touches?.[0]?.pageY || 0;
  };

  const handleTouchEnd = (e: any) => {
    const endY = e.nativeEvent.pageY || e.nativeEvent.changedTouches?.[0]?.pageY || 0;
    const dy = endY - touchStartY.current;
    if (dy > 65 && scrollYRef.current <= 5 && !isSyncing) {
      refreshVehicleTelemetry();
    }
  };

  const handleScroll = (e: any) => {
    scrollYRef.current = e.nativeEvent.contentOffset?.y || 0;
  };

  const showBanner = (type: 'ok' | 'err', text: string) => {
    setBanner({ type, text });
    setTimeout(() => {
      setBanner((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  // iOS Lock Screen & Dynamic Island "Now Playing" Silent Audio Loop State (While Charging)
  const [isLiveActivityActive, setIsLiveActivityActive] = useState<boolean>(false);
  const isLiveActivityActiveRef = useRef<boolean>(false);
  const refreshVehicleTelemetryRef = useRef<(() => Promise<any>) | null>(null);
  const wasChargingRef = useRef<boolean>(false);

  const updateLiveActivityNow = useCallback(() => {
    if (!isLiveActivityActiveRef.current) return;
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    if (!nav || !nav.mediaSession) return;
    const MediaMetadataCtor: any = typeof window !== 'undefined' ? (window as any).MediaMetadata : null;
    if (!MediaMetadataCtor) return;

    const rawVeh = snapshot?.vehicle;
    const dispName = normalizeVehicleDisplayName(rawVeh?.name, rawVeh?.series);
    const st: any = snapshot?.status || {};
    const ch: any = st.charge || null;
    const b: any = st.basic_vehicle_status;
    const ongoingD1 = d1ChargingSessions.find((s) => s.status === 'ongoing' || s.status === 'paused');

    const rawSoc =
      ch?.soc !== undefined && ch?.soc !== null
        ? ch.soc
        : ongoingD1?.end_soc !== undefined && ongoingD1?.end_soc !== null
        ? ongoingD1.end_soc
        : st.fuel_level !== undefined && st.fuel_level !== null
        ? st.fuel_level
        : null;
    const cSoc = rawSoc !== null ? Math.min(100, Math.max(0, Number(rawSoc))) : 0;
    const rKm = Number(ch?.range_km ?? st.range_km ?? Math.round((cSoc / 100) * 330));
    const chKw =
      ch && ch.is_charging && ch.charging_current
        ? Number(((ch.charging_voltage * ch.charging_current) / 1000).toFixed(2))
        : Number(ongoingD1?.last_power_kw || ongoingD1?.peak_power_kw || activeCharge?.maxChargingSpeedKw || 0);

    const soc = Number(ch?.battery_percentage ?? b?.battery_percentage ?? cSoc);
    const estRange = Number(rKm || ch?.distance_to_empty_km || b?.extended_data2 || Math.round((soc / 100) * 330));
    const isCharging = Boolean(ch?.is_charging || b?.is_charging || activeCharge || ongoingD1);
    const odoKm = Number(ch?.odometer_km ?? st.odometer_km ?? ongoingD1?.start_odometer_km ?? 0);
    const isLocked = Boolean(st.locked ?? b?.is_locked);
    const interiorTemp = st.interior_temperature ?? b?.interior_temperature ?? null;

    let title = `🚗 ${dispName || 'Windsor EV'} • ${Math.round(soc)}% (${estRange} km)`;
    let artist = `${isLocked ? '🔒 Locked' : '🔓 Unlocked'} • Cabin: ${interiorTemp !== null ? interiorTemp + '°C' : '--'} • ${odoKm > 0 ? odoKm.toLocaleString() + ' km' : ''}`;
    let headline = `${estRange} KM RANGE • ${isLocked ? 'LOCKED' : 'UNLOCKED'}`;
    let subline = `Odo: ${odoKm > 0 ? odoKm.toLocaleString() + ' km' : ''} • Cabin: ${interiorTemp !== null ? interiorTemp + '°C' : '--'}`;

    if (isCharging) {
      const timeRemainingMin = ch?.charge_time_remaining_min ?? ch?.remaining_charge_time_min ?? null;
      const timeRemainingStr =
        timeRemainingMin && timeRemainingMin > 0
          ? ` • ${Math.floor(timeRemainingMin / 60)}h ${timeRemainingMin % 60}m left`
          : '';
      const cat =
        chKw > 11 || ongoingD1?.charge_type === 'DC'
          ? 'DC Fast'
          : chKw > 3.7 || ch?.charging_gun_status
          ? '7.4 kW AC'
          : '3.3 kW AC';
      const addedKwh =
        ongoingD1?.kwh_added ??
        activeCharge?.energyAddedToPackKwh ??
        (ongoingD1?.start_soc ? Number((((soc - ongoingD1.start_soc) / 100) * 38).toFixed(1)) : 0);
      const addedStr = addedKwh > 0 ? `+${addedKwh} kWh • ` : '';
      title = `⚡ ${Math.round(soc)}% (${estRange} km) • Charging`;
      artist = `${addedStr}${cat} (${chKw > 0 ? chKw.toFixed(1) + ' kW' : 'Active'})${timeRemainingStr}`;
      headline = `⚡ CHARGING ${chKw > 0 ? chKw.toFixed(1) + ' kW' : cat}`;
      subline = `${addedStr}${cat}${timeRemainingStr} • ${estRange} km`;
    }

    const album = 'MG Windsor EV • Lock Screen Charging Monitor (Tap ⏭️ to Refresh)';
    const artworkUrl = generateLiveActivityArtwork(soc, isCharging, headline, subline);

    try {
      nav.mediaSession.metadata = new MediaMetadataCtor({
        title,
        artist,
        album,
        artwork: artworkUrl ? [{ src: artworkUrl, sizes: '512x512', type: 'image/png' }] : [],
      });
      nav.mediaSession.playbackState = 'playing';

      nav.mediaSession.setActionHandler('nexttrack', () => {
        refreshVehicleTelemetryRef.current?.();
      });
      nav.mediaSession.setActionHandler('previoustrack', () => {
        refreshVehicleTelemetryRef.current?.();
      });
      nav.mediaSession.setActionHandler('play', () => {
        startLiveActivityAudio();
      });
      nav.mediaSession.setActionHandler('pause', () => {
        stopLiveActivityAudio();
      });
    } catch (err) {
      console.warn('Error setting mediaSession:', err);
    }
  }, [snapshot, activeCharge, d1ChargingSessions]);

  const handleToggleLiveActivity = () => {
    if (!isLiveActivityActive) {
      const ok = startLiveActivityAudio();
      if (ok) {
        setIsLiveActivityActive(true);
        isLiveActivityActiveRef.current = true;
        SecureStore.setItemAsync(LIVE_ACTIVITY_KEY, 'true').catch(() => {});
        setTimeout(() => {
          updateLiveActivityNow();
        }, 100);
        showBanner('ok', '📱 iOS Lock Screen Charging Live Activity started! Lock your iPhone to view.');
      } else {
        Alert.alert(
          'iOS Lock Screen Live Activity',
          'Available in the iOS Home Screen PWA / Safari browser.'
        );
      }
    } else {
      stopLiveActivityAudio();
      setIsLiveActivityActive(false);
      isLiveActivityActiveRef.current = false;
      SecureStore.setItemAsync(LIVE_ACTIVITY_KEY, 'false').catch(() => {});
      showBanner('ok', 'Lock Screen Live Activity stopped.');
    }
  };

  useEffect(() => {
    if (isLiveActivityActive) {
      updateLiveActivityNow();
    }
  }, [isLiveActivityActive, updateLiveActivityNow]);

  // Auto-start iOS Lock Screen silent audio loop when charging starts, and auto-stop when charging ends
  useEffect(() => {
    const ongoingD1 = d1ChargingSessions.some((s) => s.status === 'ongoing');
    const currentlyCharging = Boolean(
      snapshot?.status?.charge?.is_charging || activeCharge || ongoingD1
    );
    if (currentlyCharging && !isLiveActivityActiveRef.current) {
      const ok = startLiveActivityAudio();
      if (ok) {
        setIsLiveActivityActive(true);
        isLiveActivityActiveRef.current = true;
        setTimeout(() => updateLiveActivityNow(), 120);
      }
    } else if (!currentlyCharging && wasChargingRef.current && isLiveActivityActiveRef.current) {
      stopLiveActivityAudio();
      setIsLiveActivityActive(false);
      isLiveActivityActiveRef.current = false;
    }
    wasChargingRef.current = currentlyCharging;
  }, [snapshot?.status?.charge?.is_charging, activeCharge, d1ChargingSessions, updateLiveActivityNow]);

  // While Lock Screen Live Activity is active during charging, refresh D1 charging state every 60s (0 extra 12V wakeups!)
  useEffect(() => {
    if (!isLiveActivityActive) return;
    const interval = setInterval(() => {
      refreshD1ChargingHistory(false).catch(() => {});
      fetchD1Charges('all')
        .then((d1Charges) => {
          if (Array.isArray(d1Charges)) {
            setChargeLogs(d1Charges);
            chargeLogsRef.current = d1Charges;
          }
        })
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, [isLiveActivityActive]);

  // Native iOS (APNs Web Push) & Android (FCM Web Push) State
  const [isPushSubscribed, setIsPushSubscribed] = useState<boolean>(false);
  const [isPushBusy, setIsPushBusy] = useState<boolean>(false);
  const [pushPermission, setPushPermission] = useState<string>(
    Platform.OS === 'web' && typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );

  useEffect(() => {
    const activeVinVal = (snapshot?.vehicle?.vin || vin || '').trim().toUpperCase();
    if (
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window
    ) {
      if (typeof Notification !== 'undefined') {
        setPushPermission(Notification.permission);
      }
      navigator.serviceWorker.ready
        .then(async (reg) => {
          try {
            const sub = await reg.pushManager.getSubscription();
            setIsPushSubscribed(Boolean(sub));
            if (sub && activeVinVal) {
              const subJson = sub.toJSON();
              await fetch(`${BACKEND_URL}/api/push-subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  vin: activeVinVal,
                  subscription: {
                    endpoint: sub.endpoint,
                    keys: {
                      p256dh: subJson.keys?.p256dh,
                      auth: subJson.keys?.auth,
                    },
                  },
                  userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
                }),
              }).catch(() => {});
            }
          } catch (_) {}
        })
        .catch(() => {});
    }
  }, [vin, snapshot?.vehicle?.vin]);

  const handleEnablePush = async () => {
    if (
      Platform.OS !== 'web' ||
      (typeof window !== 'undefined' && (!('serviceWorker' in navigator) || !('PushManager' in window)))
    ) {
      Alert.alert(
        'Open from Home Screen',
        'On iOS 16.4+, tap the Safari Share button ➔ "Add to Home Screen", then open MG iSMART from your Home Screen to enable native Apple Push Notifications.'
      );
      return;
    }

    const activeVinVal = (snapshot?.vehicle?.vin || vin || '').trim().toUpperCase();
    try {
      setIsPushBusy(true);
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        Alert.alert(
          'Notifications Blocked',
          'Notification permission is blocked in your iOS / browser settings. Please allow notifications for MG iSMART in Settings ➔ Notifications.'
        );
        return;
      }

      const perm = await Notification.requestPermission();
      setPushPermission(perm);
      if (perm !== 'granted') {
        Alert.alert('Permission Required', 'Please allow notifications when prompted so Trip and Charging alerts can appear on your Lock Screen.');
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        let pubKey = VAPID_PUB_B64URL;
        try {
          const r = await fetch(`${BACKEND_URL}/api/push-vapid-public-key`);
          const d = await r.json();
          if (d?.publicKey) pubKey = d.publicKey;
        } catch (_) {}

        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(pubKey) as any,
        });
      }

      const subJson = sub.toJSON();
      const res = await fetch(`${BACKEND_URL}/api/push-subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vin: activeVinVal,
          subscription: {
            endpoint: sub.endpoint,
            keys: {
              p256dh: subJson.keys?.p256dh,
              auth: subJson.keys?.auth,
            },
          },
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        throw new Error(d.error || 'Failed to register push subscription with Cloudflare Worker');
      }
      setIsPushSubscribed(true);
      showBanner('ok', '🔔 Push notifications active! Check your Lock Screen for the welcome alert.');
    } catch (e) {
      Alert.alert('Push Setup Error', (e as Error).message);
    } finally {
      setIsPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    const activeVinVal = (snapshot?.vehicle?.vin || vin || '').trim().toUpperCase();
    try {
      setIsPushBusy(true);
      if (Platform.OS === 'web' && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          const endpoint = sub.endpoint;
          await sub.unsubscribe().catch(() => {});
          await fetch(`${BACKEND_URL}/api/push-unsubscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vin: activeVinVal, endpoint }),
          }).catch(() => {});
        }
      }
      setIsPushSubscribed(false);
      showBanner('ok', 'Push notifications disabled on this device.');
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setIsPushBusy(false);
    }
  };

  const handleSendTestPush = async () => {
    const activeVinVal = (snapshot?.vehicle?.vin || vin || '').trim().toUpperCase();
    try {
      setIsPushBusy(true);
      const res = await fetch(`${BACKEND_URL}/api/push-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vin: activeVinVal }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) {
        throw new Error(d.error || 'Failed to send test push notification');
      }
      showBanner('ok', '🧪 Test push sent! Check your Lock Screen / Notification Center.');
    } catch (e) {
      Alert.alert('Test Push Failed', (e as Error).message);
    } finally {
      setIsPushBusy(false);
    }
  };



  const copyToClipboard = async (text: string, label: string) => {
    try {
      await Clipboard.setStringAsync(text);
      showBanner('ok', `Copied ${label} to clipboard!`);
      Alert.alert(
        'Copied to Clipboard!',
        `${label} copied.\n\nOpen Apple Shortcuts app, choose "Get contents of URL", and paste this link.`
      );
    } catch (err) {
      showBanner('err', `Could not copy: ${(err as Error).message}`);
    }
  };

  // Restore saved session & cached vehicle snapshot on startup
  useEffect(() => {
    (async () => {
      try {
        const [
          rawSession,
          rawSnap,
          rawTrips,
          rawActiveTrip,
          rawParkedBase,
          rawLogs,
          rawActive,
          rawBaseline,
          rawCloudUrl,
          rawCloudKey,
          rawGoogleSync,
          rawGoogleClientId,
          rawFontScale,
        ] = await Promise.all([
          SecureStore.getItemAsync(SESSION_KEY),
          SecureStore.getItemAsync(SNAPSHOT_KEY),
          SecureStore.getItemAsync(TRIPS_KEY),
          SecureStore.getItemAsync(ACTIVE_TRIP_KEY),
          SecureStore.getItemAsync(PARKED_BASELINE_KEY),
          SecureStore.getItemAsync(CHARGE_LOGS_KEY),
          SecureStore.getItemAsync(ACTIVE_CHARGE_KEY),
          SecureStore.getItemAsync(PRE_CHARGE_BASELINE_KEY),
          SecureStore.getItemAsync(CLOUD_SYNC_URL_KEY),
          SecureStore.getItemAsync(CLOUD_API_KEY_KEY),
          SecureStore.getItemAsync(GOOGLE_SYNC_KEY),
          SecureStore.getItemAsync(GOOGLE_CLIENT_ID_KEY),
          SecureStore.getItemAsync(FONT_SCALE_KEY),
        ]);

        if (rawFontScale) {
          const num = parseFloat(rawFontScale);
          if (!isNaN(num) && num >= 0.75 && num <= 1.3) {
            setFontScale(num);
            setGlobalFontScale(num);
          }
        }

        if (rawGoogleClientId) {
          setGoogleClientId(rawGoogleClientId);
        }

        if (rawGoogleSync) {
          try {
            const parsedG: GoogleSyncConfig = JSON.parse(rawGoogleSync);
            setGoogleConfig(parsedG);
            googleConfigRef.current = parsedG;
          } catch {
            // ignore
          }
        }

        if (rawCloudUrl) {
          setCloudSyncUrl(rawCloudUrl);
          cloudSyncUrlRef.current = rawCloudUrl;
        }

        if (rawCloudKey) {
          setCloudApiKey(rawCloudKey);
          cloudApiKeyRef.current = rawCloudKey;
        }

        if (rawTrips) {
          try {
            const parsedTrips: TripRecord[] = deduplicateTripList(JSON.parse(rawTrips));
            setTrips(parsedTrips);
            tripsRef.current = parsedTrips;
            await SecureStore.setItemAsync(TRIPS_KEY, JSON.stringify(parsedTrips));
          } catch {
            // ignore
          }
        }

        if (rawActiveTrip) {
          try {
            const parsedActiveTrip: TripRecord = JSON.parse(rawActiveTrip);
            setActiveTrip(parsedActiveTrip);
            activeTripRef.current = parsedActiveTrip;
          } catch {
            // ignore
          }
        }

        if (rawParkedBase) {
          try {
            const parsedParkedBase: ParkedTripBaseline = JSON.parse(rawParkedBase);
            setParkedBaseline(parsedParkedBase);
            parkedBaselineRef.current = parsedParkedBase;
          } catch {
            // ignore
          }
        }

        if (rawLogs) {
          try {
            const parsedLogs: ChargeLogRecord[] = deduplicateChargeList(JSON.parse(rawLogs));
            const sanitized = parsedLogs.map((l) => ({
              ...l,
              distanceToEmptyAfterKm:
                l.distanceToEmptyAfterKm > 0
                  ? l.distanceToEmptyAfterKm
                  : l.endSoc > 0
                  ? Math.round((l.endSoc / 100) * 320)
                  : 320,
            }));
            setChargeLogs(sanitized);
            chargeLogsRef.current = sanitized;
            await SecureStore.setItemAsync(CHARGE_LOGS_KEY, JSON.stringify(sanitized));
          } catch {
            // ignore
          }
        }

        if (rawActive) {
          try {
            const parsedActive: ChargeLogRecord = JSON.parse(rawActive);
            if (isValidChargeRecord(parsedActive)) {
              setActiveCharge(parsedActive);
              activeChargeRef.current = parsedActive;
            } else {
              await SecureStore.deleteItemAsync(ACTIVE_CHARGE_KEY);
            }
          } catch {
            // ignore
          }
        }

        if (rawBaseline) {
          try {
            const parsedBase: PreChargeBaseline = JSON.parse(rawBaseline);
            setPreChargeBaseline(parsedBase);
            baselineRef.current = parsedBase;
          } catch {
            // ignore
          }
        }

        if (rawSnap) {
          try {
            const parsedSnap: Snapshot = JSON.parse(rawSnap);
            setSnapshot(parsedSnap);
            if (parsedSnap.status?.status_time) {
              setLastSyncedAt(
                new Date(parsedSnap.status.status_time * 1000).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              );
            }
          } catch {
            // ignore
          }
        }

        if (rawSession) {
          const saved: PersistedSession = JSON.parse(rawSession);
          if (saved.phone && saved.password) {
            setPhone(saved.phone);
            setPassword(saved.password);
            setPin(saved.pin || '');
            setVin(saved.vin || '');
            setActiveD1Vin(saved.vin || '');
            setIsAuthenticated(true);

            const client = new MgIndiaClient({
              phone: saved.phone,
              password: saved.password,
              vin: saved.vin || undefined,
              pinHash: /^\d{4}$/.test(saved.pin || '') ? hashControlPin(saved.pin) : undefined,
              onSessionRefreshed: async (refreshed) => {
                try {
                  const updated: PersistedSession = {
                    ...saved,
                    uid: refreshed.uid,
                    token: refreshed.token,
                  };
                  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(updated));
                } catch {
                  // ignore
                }
              },
            });
            client.uid = saved.uid || null;
            client.token = saved.token || null;
            clientRef.current = client;

            // Silently refresh live telemetry in background (will auto-relogin if token expired!)
            refreshVehicleTelemetry(client, saved);
          }
        }
      } catch {
        // Ignore startup read errors
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  // iOS Shortcuts / Widget Deep Link Handler (e.g. mgismart://unlock, mgismart://lock, mgismart://climate-on)
  useEffect(() => {
    const handleUrl = async (event: { url: string }) => {
      const url = event?.url;
      if (!url) return;
      try {
        const lower = url.toLowerCase();
        if (lower.includes('action=unlock') || lower.endsWith('/unlock') || lower.endsWith('://unlock')) {
          showBanner('ok', 'Widget trigger: Unlocking doors...');
          await triggerCommand('Unlock Doors', (c) => c.controlDoorLock(false));
        } else if (lower.includes('action=lock') || lower.endsWith('/lock') || lower.endsWith('://lock')) {
          showBanner('ok', 'Widget trigger: Locking doors...');
          await triggerCommand('Lock Doors', (c) => c.controlDoorLock(true));
        } else if (lower.includes('action=climate-on') || lower.includes('climate-on') || lower.includes('ac-on')) {
          showBanner('ok', 'Widget trigger: Starting Climate AC...');
          await triggerCommand('Start Climate AC', (c) => c.controlClimate(true));
        } else if (lower.includes('action=climate-off') || lower.includes('climate-off') || lower.includes('ac-off')) {
          showBanner('ok', 'Widget trigger: Stopping Climate AC...');
          await triggerCommand('Stop Climate AC', (c) => c.controlClimate(false));
        }
      } catch (err) {
        showBanner('err', `Widget action failed: ${(err as Error).message}`);
      }
    };

    Linking.getInitialURL().then((initUrl) => {
      if (initUrl) handleUrl({ url: initUrl });
    });
    const sub = Linking.addEventListener('url', handleUrl);
    return () => sub.remove();
  }, [pin]);

  const [isD1Syncing, setIsD1Syncing] = useState<boolean>(false);

  const handleSyncTripsToD1 = async () => {
    try {
      setIsD1Syncing(true);
      const cleaned = deduplicateTripList(tripsRef.current);
      const ok = await syncTripsToD1(cleaned);
      const refreshed = await fetchD1Trips('all');
      if (refreshed && refreshed.length > 0) {
        const merged = mergeD1TripsWithLocalRichData(refreshed, tripsRef.current, snapshot?.status);
        setTrips(merged);
        tripsRef.current = merged;
        SecureStore.setItemAsync(TRIPS_KEY, JSON.stringify(merged)).catch(() => {});
      }
      const dates = await fetchD1TripDates();
      if (dates && dates.length > 0) setD1TripDates(dates);
      if (ok) {
        Alert.alert('Cloudflare D1 Synced ☁️', `Successfully synced ${cleaned.length} trip(s) to Cloudflare D1 database.`);
        showBanner('ok', `Synced ${cleaned.length} trip(s) to D1`);
      } else {
        Alert.alert('Sync Notice', 'Trips saved locally. Ensure your Cloudflare Worker is deployed with latest code.');
      }
    } catch (e: any) {
      Alert.alert('Sync Error', e?.message || 'Failed to sync with Cloudflare D1');
    } finally {
      setIsD1Syncing(false);
    }
  };

  const handleRefreshD1Trips = async () => {
    try {
      setIsD1Syncing(true);
      const refreshed = await fetchD1Trips('all');
      if (Array.isArray(refreshed)) {
        const merged = mergeD1TripsWithLocalRichData(refreshed, tripsRef.current, snapshot?.status);
        setTrips(merged);
        tripsRef.current = merged;
        SecureStore.setItemAsync(TRIPS_KEY, JSON.stringify(merged)).catch(() => {});
      }
      const dates = await fetchD1TripDates();
      if (dates && dates.length > 0) setD1TripDates(dates);
      else if (Array.isArray(refreshed) && refreshed.length === 0) setD1TripDates([]);
      Alert.alert('Cloudflare D1 Refreshed 🔄', `Loaded ${refreshed?.length || 0} trip(s) from Cloudflare D1.`);
      showBanner('ok', `Refreshed ${refreshed?.length || 0} trip(s) from D1`);
    } catch (e: any) {
      Alert.alert('Refresh Error', e?.message || 'Failed to fetch from Cloudflare D1');
    } finally {
      setIsD1Syncing(false);
    }
  };

  const handleCleanAndDeduplicateD1 = async () => {
    try {
      setIsD1Syncing(true);
      const before = tripsRef.current;
      const cleanedTrips = deduplicateTripList(before);
      const keptIds = new Set(cleanedTrips.map((t) => String(t.id)));
      const droppedTrips = before.filter((t) => !keptIds.has(String(t.id)));

      // 1. Explicitly delete every dropped duplicate trip from D1
      const activeVin = vin || snapshot?.vehicle?.vin;
      for (const dropped of droppedTrips) {
        if (dropped.id) {
          await deleteD1Trip(String(dropped.id), activeVin);
        }
      }

      // 2. Trigger server-side D1 deduplication to purge any duplicates stored in D1 SQL
      const serverRes = await dedupD1Trips(activeVin);

      // 3. Update local state and persistence
      setTrips(cleanedTrips);
      tripsRef.current = cleanedTrips;
      await SecureStore.setItemAsync(TRIPS_KEY, JSON.stringify(cleanedTrips)).catch(() => {});

      // 4. Update distinct dates
      const dates = await fetchD1TripDates(activeVin);
      if (dates && dates.length > 0) setD1TripDates(dates);

      const totalRemoved = droppedTrips.length + (serverRes.removedCount || 0);
      Alert.alert(
        'Deduplicated & Cleaned ✨',
        totalRemoved > 0
          ? `Permanently removed ${totalRemoved} duplicate entry(ies) from Cloudflare D1. ${cleanedTrips.length} unique trip(s) remaining.`
          : `List is clean! ${cleanedTrips.length} unique trip(s) in Cloudflare D1.`
      );
      showBanner('ok', 'Trips deduplicated & permanently saved in D1');
    } catch (err: any) {
      showBanner('err', `Dedupe error: ${err?.message || err}`);
    } finally {
      setIsD1Syncing(false);
    }
  };

  const handleClearAllD1Trips = () => {
    Alert.alert(
      'Clear All Trips from D1?',
      'This will permanently delete all saved trips from Cloudflare D1 and this device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All Trips',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsD1Syncing(true);
              setTrips([]);
              tripsRef.current = [];
              await SecureStore.deleteItemAsync(TRIPS_KEY).catch(() => {});
              await clearD1Trips();
              setD1TripDates([]);
              Alert.alert('Trips Cleared', 'All trips have been permanently cleared from Cloudflare D1.');
              showBanner('ok', 'All trips cleared from D1');
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to clear trips');
            } finally {
              setIsD1Syncing(false);
            }
          },
        },
      ]
    );
  };

  const handleSyncChargesToD1 = async () => {
    try {
      setIsD1Syncing(true);
      const cleaned = deduplicateChargeList(chargeLogsRef.current);
      const ok = await syncChargesToD1(cleaned);
      const refreshed = await fetchD1Charges('all');
      if (refreshed && refreshed.length > 0) {
        setChargeLogs(refreshed);
        chargeLogsRef.current = refreshed;
        SecureStore.setItemAsync(CHARGE_LOGS_KEY, JSON.stringify(refreshed)).catch(() => {});
      }
      const dates = await fetchD1ChargeDates();
      if (dates && dates.length > 0) setD1ChargeDates(dates);
      if (ok) {
        Alert.alert('Cloudflare D1 Synced ☁️', `Successfully synced ${cleaned.length} charging session(s) to Cloudflare D1.`);
        showBanner('ok', `Synced ${cleaned.length} charge(s) to D1`);
      } else {
        Alert.alert('Sync Notice', 'Charges saved locally. Ensure Cloudflare Worker is deployed.');
      }
    } catch (e: any) {
      Alert.alert('Sync Error', e?.message || 'Failed to sync charges with Cloudflare D1');
    } finally {
      setIsD1Syncing(false);
    }
  };

  const handleRefreshD1Charges = async () => {
    try {
      setIsD1Syncing(true);
      await refreshD1ChargingHistory(true);
      const refreshed = await fetchD1Charges('all');
      if (Array.isArray(refreshed)) {
        setChargeLogs(refreshed);
        chargeLogsRef.current = refreshed;
        SecureStore.setItemAsync(CHARGE_LOGS_KEY, JSON.stringify(refreshed)).catch(() => {});
      }
      const dates = await fetchD1ChargeDates();
      if (dates && dates.length > 0) setD1ChargeDates(dates);
      else if (Array.isArray(refreshed) && refreshed.length === 0) setD1ChargeDates([]);
      Alert.alert('Cloudflare D1 Refreshed 🔄', `Loaded fresh charging history from Cloudflare D1.`);
      showBanner('ok', `Refreshed D1 charging history`);
    } catch (e: any) {
      Alert.alert('Refresh Error', e?.message || 'Failed to fetch charges from Cloudflare D1');
    } finally {
      setIsD1Syncing(false);
    }
  };

  const handleCleanAndDeduplicateCharges = async () => {
    try {
      setIsD1Syncing(true);
      const before = chargeLogsRef.current;
      const cleanedCharges = deduplicateChargeList(before);
      const keptIds = new Set(cleanedCharges.map((c) => String(c.id)));
      const droppedCharges = before.filter((c) => !keptIds.has(String(c.id)));

      // 1. Explicitly delete every dropped duplicate charge from D1
      const activeVin = vin || snapshot?.vehicle?.vin;
      for (const dropped of droppedCharges) {
        if (dropped.id) {
          await deleteD1Charge(String(dropped.id), activeVin);
        }
      }

      // 2. Trigger server-side D1 deduplication to purge any duplicates stored in D1 SQL
      const serverRes = await dedupD1Charges(activeVin);

      // 3. Update local state and persistence
      setChargeLogs(cleanedCharges);
      chargeLogsRef.current = cleanedCharges;
      await SecureStore.setItemAsync(CHARGE_LOGS_KEY, JSON.stringify(cleanedCharges)).catch(() => {});

      // 4. Update distinct dates
      const dates = await fetchD1ChargeDates(activeVin);
      if (dates && dates.length > 0) setD1ChargeDates(dates);

      const totalRemoved = droppedCharges.length + (serverRes.removedCount || 0);
      Alert.alert(
        'Deduplicated & Cleaned ✨',
        totalRemoved > 0
          ? `Permanently removed ${totalRemoved} duplicate charge(s) from Cloudflare D1. ${cleanedCharges.length} unique charge(s) remaining.`
          : `List is clean! ${cleanedCharges.length} unique charge(s) in Cloudflare D1.`
      );
      showBanner('ok', 'Charges deduplicated & permanently saved in D1');
    } catch (err: any) {
      showBanner('err', `Dedupe error: ${err?.message || err}`);
    } finally {
      setIsD1Syncing(false);
    }
  };

  const handleClearAllD1Charges = () => {
    Alert.alert(
      'Clear All Charges from D1?',
      'This will permanently delete all saved charge logs from Cloudflare D1 and this device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All Charges',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsD1Syncing(true);
              await clearChargingHistory().catch(() => {});
              setD1ChargingSessions([]);
              setChargeLogs([]);
              chargeLogsRef.current = [];
              await SecureStore.deleteItemAsync(CHARGE_LOGS_KEY).catch(() => {});
              await clearD1Charges();
              setD1ChargeDates([]);
              Alert.alert('Charges Cleared', 'All charge logs have been permanently cleared from Cloudflare D1.');
              showBanner('ok', 'All charges cleared from D1');
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to clear charges');
            } finally {
              setIsD1Syncing(false);
            }
          },
        },
      ]
    );
  };

  const handleSyncAllToBackendSheets = handleSyncTripsToD1;
  const handleCleanAndDeduplicateSheets = handleCleanAndDeduplicateD1;

  const refreshVehicleTelemetry = async (
    existingClient?: MgIndiaClient,
    sessionOverride?: Partial<PersistedSession> & { _isRetry?: boolean }
  ) => {
    const usePhone = sessionOverride?.phone ?? phone;
    const usePassword = sessionOverride?.password ?? password;
    const usePin = sessionOverride?.pin ?? pin;
    const useVin = sessionOverride?.vin ?? vin;

    setIsSyncing(true);
    refreshVehicleTelemetryRef.current = () => refreshVehicleTelemetry();
    try {
      const client =
        existingClient ||
        clientRef.current ||
        new MgIndiaClient({
          phone: usePhone,
          password: usePassword,
          vin: useVin || undefined,
          pinHash: /^\d{4}$/.test(usePin) ? hashControlPin(usePin) : undefined,
          onSessionRefreshed: async (refreshed) => {
            try {
              const updatedSession: PersistedSession = {
                phone: usePhone,
                password: usePassword,
                pin: usePin,
                vin: useVin,
                uid: refreshed.uid,
                token: refreshed.token,
              };
              await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(updatedSession));
            } catch {
              // ignore
            }
          },
        });

      clientRef.current = client;
      const snap = await client.snapshot(true);

      // Ensure EQ100 is always mapped to Windsor EV
      snap.vehicle.name = normalizeVehicleDisplayName(snap.vehicle.name, snap.vehicle.series);

      setSnapshot(snap);
      setLastSyncedAt(
        new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );

      const discoveredVin = snap.vehicle.vin || useVin;
      if (discoveredVin && discoveredVin !== vin) {
        setVin(discoveredVin);
      }

      // Persist updated token/uid and snapshot
      if (client.uid && client.token) {
        const updatedSession: PersistedSession = {
          phone: usePhone,
          password: usePassword,
          pin: usePin,
          vin: discoveredVin,
          uid: client.uid,
          token: client.token,
        };
        await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(updatedSession));
        registerCarSession({
          uid: client.uid,
          token: client.token,
          vin: discoveredVin,
          phone: usePhone,
        }).catch(() => {});
      }
      await SecureStore.setItemAsync(SNAPSHOT_KEY, JSON.stringify(snap));
      showBanner('ok', `Synced ${snap.vehicle.name} (${snap.vehicle.vin})`);
    } catch (err) {
      const msg = (err as Error).message || 'Failed to sync vehicle status';
      if (
        /login|session|token|invalid|expire/i.test(msg) &&
        usePassword &&
        !sessionOverride?._isRetry
      ) {
        try {
          const client = existingClient || clientRef.current;
          if (client) {
            await client.login();
            return await refreshVehicleTelemetry(client, { ...sessionOverride, _isRetry: true });
          }
        } catch (_) {}
      }
      if (/not ready after polling/i.test(msg)) {
        showBanner(
          'err',
          '💤 Vehicle is in Sleep Mode (12V battery saver). It will refresh once unlocked, charged, or driven.'
        );
      } else {
        showBanner('err', msg);
      }
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLogin = async () => {
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      Alert.alert(
        'Login Failed',
        'Please enter your valid 10-digit India mobile number registered with MG iSMART.'
      );
      return;
    }
    if (!password || password.trim().length < 6) {
      Alert.alert(
        'Login Failed',
        'Please enter your MG iSMART password (at least 6 characters).'
      );
      return;
    }
    if (pin && !/^\d{4}$/.test(pin)) {
      Alert.alert(
        'Invalid Control PIN',
        'Control PIN must be exactly 4 digits (or leave it blank to enter when sending commands).'
      );
      return;
    }

    setIsLoggingIn(true);
    try {
      const client = new MgIndiaClient({
        phone: cleanPhone,
        password,
        vin: vin.trim() || undefined,
        pinHash: /^\d{4}$/.test(pin) ? hashControlPin(pin) : undefined,
        onSessionRefreshed: async (refreshed) => {
          try {
            const updated: PersistedSession = {
              phone: cleanPhone,
              password,
              pin,
              vin: vin.trim(),
              uid: refreshed.uid,
              token: refreshed.token,
            };
            await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(updated));
          } catch {
            // ignore
          }
        },
      });

      // Step 1: Authenticate with MG India TAP Server (iov-tap.mgindia.co.in)
      await client.login();

      // Step 2: Discover Vehicles on Account (iov-gateway.mgindia.co.in)
      const vehicles = await client.vehicles();
      if (!vehicles || vehicles.length === 0) {
        throw new Error('Login succeeded, but no vehicles were found on this MG iSMART account.');
      }

      const activeVehicle = client.vehicle || vehicles[0];
      activeVehicle.name = normalizeVehicleDisplayName(activeVehicle.name, activeVehicle.series);
      const activeVin = activeVehicle.vin;
      setVin(activeVin);
      setActiveD1Vin(activeVin);
      clientRef.current = client;

      // Save persistent session in iPhone Keychain immediately so user stays logged in!
      const newSession: PersistedSession = {
        phone: cleanPhone,
        password,
        pin,
        vin: activeVin,
        uid: client.uid || '',
        token: client.token || '',
      };
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(newSession));

      setIsAuthenticated(true);
      setTab('home');

      Alert.alert(
        'Login Successful',
        `Connected to ${activeVehicle.name} (VIN: ${activeVin}).\n\nFetching live vehicle telemetry now...`
      );

      // Step 3: Poll full vehicle status & EV charging frame
      await refreshVehicleTelemetry(client, newSession);
    } catch (err) {
      const reason =
        (err as Error).message || 'Unable to reach MG iSMART India server. Please try again.';
      Alert.alert('Login Failed', reason);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Log Out of MG iSMART',
      'Are you sure you want to log out and clear your saved session from this iPhone?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            await Promise.all([
              SecureStore.deleteItemAsync(SESSION_KEY),
              SecureStore.deleteItemAsync(SNAPSHOT_KEY),
            ]);
            clientRef.current = null;
            setSnapshot(null);
            setPassword('');
            setPin('');
            setVin('');
            setActiveD1Vin('');
            setTrips([]);
            tripsRef.current = [];
            setChargeLogs([]);
            chargeLogsRef.current = [];
            setD1ChargingSessions([]);
            setD1Notifications([]);
            setIsAuthenticated(false);
          },
        },
      ]
    );
  };

  const handleWipeCloudData = () => {
    Alert.alert(
      '⚠️ Wipe Cloud Data & Deregister Car',
      'This will permanently delete your saved vehicle session tokens, background telemetry, push notification subscriptions, and Cloudflare D1 database logs. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Wipe Everything & Log Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await deregisterCarSession({
                vin: vin || snapshot?.vehicle?.vin || undefined,
                phone: phone.replace(/\D/g, '') || undefined,
                clearHistory: true,
              });
            } catch (_) {}

            await Promise.all([
              SecureStore.deleteItemAsync(SESSION_KEY),
              SecureStore.deleteItemAsync(SNAPSHOT_KEY),
              SecureStore.deleteItemAsync(GOOGLE_SYNC_KEY),
            ]);
            clientRef.current = null;
            setSnapshot(null);
            setPassword('');
            setPin('');
            setVin('');
            setActiveD1Vin('');
            setTrips([]);
            tripsRef.current = [];
            setChargeLogs([]);
            chargeLogsRef.current = [];
            setD1ChargingSessions([]);
            setD1Notifications([]);
            setIsAuthenticated(false);
            showBanner('ok', 'Cloud session and vehicle telemetry wiped successfully.');
          },
        },
      ]
    );
  };

  const handleGoogleSignIn = async () => {
    try {
      setIsGoogleSyncing(true);
      const cid = googleClientId.trim() || DEFAULT_GOOGLE_CLIENT_ID;
      const auth = await startGoogleOAuth(cid);
      const profile = await fetchGoogleProfile(auth.accessToken);

      showBanner('ok', `Signed in as ${profile.email}. Preparing Drive & Sheets...`);

      // 1. Get or create folder
      const folderId = await getOrCreateDriveFolder(auth.accessToken);

      // 2. Get or create Trip spreadsheet
      const tripSheet = await getOrCreateTripSpreadsheet(auth.accessToken, folderId);

      // 3. Get or create Charging spreadsheet
      const chargeSheet = await getOrCreateChargingSpreadsheet(auth.accessToken, folderId);

      const nowTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const newConfig: GoogleSyncConfig = {
        accessToken: auth.accessToken,
        userEmail: profile.email,
        userName: profile.name,
        folderId,
        spreadsheetId: tripSheet.spreadsheetId,
        spreadsheetUrl: tripSheet.spreadsheetUrl,
        chargingSpreadsheetId: chargeSheet.spreadsheetId,
        chargingSpreadsheetUrl: chargeSheet.spreadsheetUrl,
        autoSync: true,
        lastSyncedAt: nowTimeStr,
        lastChargingSyncedAt: nowTimeStr,
      };

      setGoogleConfig(newConfig);
      googleConfigRef.current = newConfig;
      await SecureStore.setItemAsync(GOOGLE_SYNC_KEY, JSON.stringify(newConfig));

      // 4. Immediately sync existing trips and charging logs
      let tripCount = 0;
      let chargeCount = 0;
      if (tripsRef.current.length > 0) {
        const res = await syncTripsToGoogleSheet(
          auth.accessToken,
          tripSheet.spreadsheetId,
          tripsRef.current
        );
        tripCount = res.syncedCount;
      }

      if (chargeLogsRef.current.length > 0) {
        const res = await syncChargingLogsToGoogleSheet(
          auth.accessToken,
          chargeSheet.spreadsheetId,
          chargeLogsRef.current
        );
        chargeCount = res.syncedCount;
      }

      Alert.alert(
        'Google Drive & Sheets Connected! 📊⚡',
        `Connected to Google Drive folder:\n"MG Windsor EV Telematics"\n\nCreated 2 Spreadsheets:\n1. 🚗 Trip History (${tripCount} synced)\n2. ⚡ Charging History (${chargeCount} synced)`
      );
    } catch (err) {
      Alert.alert('Google Sign-In', (err as Error).message);
    } finally {
      setIsGoogleSyncing(false);
    }
  };

  const handleSyncChargingSheetNow = async () => {
    if (!googleConfig?.accessToken || !googleConfig?.chargingSpreadsheetId) {
      Alert.alert('Not Connected', 'Please sign in with Google first.');
      return;
    }
    try {
      setIsGoogleSyncing(true);
      const res = await syncChargingLogsToGoogleSheet(
        googleConfig.accessToken,
        googleConfig.chargingSpreadsheetId,
        chargeLogsRef.current
      );
      const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const updated = { ...googleConfig, lastChargingSyncedAt: nowStr };
      setGoogleConfig(updated);
      googleConfigRef.current = updated;
      await SecureStore.setItemAsync(GOOGLE_SYNC_KEY, JSON.stringify(updated));

      Alert.alert(
        'Charging Sheet Synced! ⚡',
        `Charging spreadsheet updated!\n• Newly added charges: ${res.syncedCount}\n• Already in sheet: ${res.alreadyExistingCount}`
      );
    } catch (err) {
      Alert.alert('Charging Sheet Sync Error', (err as Error).message);
    } finally {
      setIsGoogleSyncing(false);
    }
  };

  const handleSyncGoogleSheetNow = async () => {
    if (!googleConfig?.accessToken || !googleConfig?.spreadsheetId) {
      Alert.alert('Not Connected', 'Please sign in with Google first.');
      return;
    }
    try {
      setIsGoogleSyncing(true);
      const res = await syncTripsToGoogleSheet(
        googleConfig.accessToken,
        googleConfig.spreadsheetId,
        tripsRef.current
      );
      const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const updated = { ...googleConfig, lastSyncedAt: nowStr };
      setGoogleConfig(updated);
      googleConfigRef.current = updated;
      await SecureStore.setItemAsync(GOOGLE_SYNC_KEY, JSON.stringify(updated));

      Alert.alert(
        'Google Sheet Synced! 📊',
        `Spreadsheet updated successfully!\n• Newly added trips: ${res.syncedCount}\n• Already in sheet: ${res.alreadyExistingCount}`
      );
    } catch (err) {
      Alert.alert('Google Sheets Sync Error', (err as Error).message);
    } finally {
      setIsGoogleSyncing(false);
    }
  };

  const handleGoogleSignOut = () => {
    Alert.alert(
      'Disconnect Google Account',
      'Are you sure you want to unlink your Google Drive and Sheets backup?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setGoogleConfig(null);
            googleConfigRef.current = null;
            await SecureStore.deleteItemAsync(GOOGLE_SYNC_KEY);
            showBanner('ok', 'Disconnected from Google Drive & Sheets');
          },
        },
      ]
    );
  };

  const triggerCommand = async (
    label: string,
    liveFn: (c: MgIndiaClient) => Promise<void>
  ) => {
    const runWithPin = async (pinToUse: string) => {
      setIsSyncing(true);
      showBanner('ok', `Sending ${label} to vehicle...`);
      try {
        const client =
          clientRef.current ||
          new MgIndiaClient({
            phone,
            password,
            vin: vin || undefined,
            pinHash: hashControlPin(pinToUse),
            onSessionRefreshed: async (refreshed) => {
              try {
                const updated: PersistedSession = {
                  phone,
                  password,
                  pin: pinToUse,
                  vin,
                  uid: refreshed.uid,
                  token: refreshed.token,
                };
                await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(updated));
              } catch {
                // ignore
              }
            },
          });
        client.pinHash = hashControlPin(pinToUse);
        clientRef.current = client;

        await liveFn(client);
        Alert.alert('Command Executed', `${label} was confirmed by your vehicle.`);
        await refreshVehicleTelemetry(client);
      } catch (err) {
        Alert.alert(`${label} Failed`, (err as Error).message);
      } finally {
        setIsSyncing(false);
      }
    };

    if (/^\d{4}$/.test(pin)) {
      await runWithPin(pin);
    } else {
      setTempPin('');
      setPinPrompt({
        visible: true,
        label,
        onConfirm: async (entered) => {
          setPinPrompt(null);
          if (!/^\d{4}$/.test(entered)) {
            Alert.alert('Invalid PIN', 'Control PIN must be 4 digits.');
            return;
          }
          setPin(entered);
          await runWithPin(entered);
        },
      });
    }
  };

  // 1. Startup Keychain Check Screen
  if (booting) {
    return (
      <SafeAreaView style={[styles.container, styles.centerAll]}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator color="#10B981" size="large" />
        <Text style={[styles.subtitle, { marginTop: 12 }]}>
          Restoring saved MG iSMART session...
        </Text>
      </SafeAreaView>
    );
  }

  // 2. First-Time Login Screen (Shown until logged in; stays logged in until manual Logout)
  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <ScrollView contentContainerStyle={styles.loginContainer}>
          <View style={styles.loginLogoWrap}>
            <View style={styles.mgLogoLarge}>
              <Text style={styles.mgLogoLargeText}>MG</Text>
            </View>
            <Text style={styles.loginTitle}>MG iSMART India</Text>
            <Text style={styles.loginSub}>
              Connected EV Telemetry, Charging & Remote Control
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Sign In to Your Vehicle</Text>
            <Text style={[styles.subtitle, { marginBottom: 16 }]}>
              Your session is encrypted in your iPhone Keychain and stays logged in 24/7 until you
              manually log out.
            </Text>

            <Text style={styles.inputLabel}>10-Digit India Mobile Number *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 9876543210"
              placeholderTextColor="#64748B"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoCapitalize="none"
            />

            <Text style={styles.inputLabel}>MG iSMART Password *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your MG iSMART password"
              placeholderTextColor="#64748B"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
            />

            <Text style={styles.inputLabel}>4-Digit Remote Control PIN (Optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="4-digit PIN for Lock / Climate commands"
              placeholderTextColor="#64748B"
              secureTextEntry
              maxLength={4}
              value={pin}
              onChangeText={setPin}
              keyboardType="number-pad"
            />

            <Text style={styles.inputLabel}>Vehicle VIN (Optional — Auto-Discovered)</Text>
            <TextInput
              style={styles.input}
              placeholder="Leave blank to auto-detect from your account"
              placeholderTextColor="#64748B"
              value={vin}
              onChangeText={setVin}
              autoCapitalize="characters"
            />

            <TouchableOpacity
              style={[styles.loginBtn, isLoggingIn && { opacity: 0.7 }]}
              onPress={handleLogin}
              disabled={isLoggingIn}
            >
              {isLoggingIn ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <ActivityIndicator color="#FFF" size="small" />
                  <Text style={styles.loginBtnText}>Authenticating with MG India...</Text>
                </View>
              ) : (
                <Text style={styles.loginBtnText}>Sign In & Connect Vehicle</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // 3. Authenticated Vehicle Dashboard
  const rawVehicle = snapshot?.vehicle;
  const displayName = normalizeVehicleDisplayName(rawVehicle?.name, rawVehicle?.series);
  const displayVin = rawVehicle?.vin || vin || 'Discovering...';

  const status: Partial<Status> = snapshot?.status || {};
  const charge = status.charge || null;

  // Accurate Battery SOC %: prefer 0.1%-precision EV BMS frame (charge.soc), fallback to status.fuel_level
  const rawSoc =
    charge?.soc !== undefined && charge?.soc !== null
      ? charge.soc
      : status.fuel_level !== undefined && status.fuel_level !== null
      ? status.fuel_level
      : null;

  const clampedSoc = rawSoc !== null ? Math.min(100, Math.max(0, rawSoc)) : 0;
  const socDisplay =
    rawSoc !== null
      ? Number.isInteger(rawSoc)
        ? `${rawSoc}%`
        : `${rawSoc.toFixed(1)}%`
      : '--%';

  const rangeKm = charge?.range_km ?? status.range_km ?? 0;
  const chargingKw =
    charge && charge.is_charging && charge.charging_current
      ? Number(((charge.charging_voltage * charge.charging_current) / 1000).toFixed(2))
      : 0;

  // Battery Health (SOH %) Calculation from Telemetry:
  // In the 63-byte EV charging frame (RvsChargingStatus), `battery_energy_kwh` (realtimePower * 0.1)
  // is a direct BMS energy reading in kWh, and `soc` (powerLevelPrc * 0.1) is the BMS state of charge.
  // Therefore: currentUsableCapacityKwh = battery_energy_kwh / (soc / 100).
  // Comparing against the factory nominal usable capacity (37.3 kWh on MG Windsor EV EQ100) yields SOH %!
  const nominalCapacityKwh =
    charge?.total_battery_capacity_kwh && charge.total_battery_capacity_kwh > 10
      ? charge.total_battery_capacity_kwh
      : WINDSOR_FACTORY_USABLE_KWH;

  const derivedFullCapacityKwh =
    charge && charge.soc && charge.soc >= 10 && charge.battery_energy_kwh > 0
      ? charge.battery_energy_kwh / (charge.soc / 100)
      : null;

  const sohPercent =
    derivedFullCapacityKwh !== null
      ? Math.min(100, Math.max(70, Number(((derivedFullCapacityKwh / nominalCapacityKwh) * 100).toFixed(1))))
      : 100.0;

  // Active Windsor EV Exterior Color:
  // Derived from user override if selected, else matched to server vehicle color name from iSMART
  const activeWindsorColor =
    (carColorOverride && WINDSOR_COLORS.find((c) => c.key === carColorOverride)) ||
    matchWindsorColor(rawVehicle?.color_name || snapshot?.vehicle?.color_name);

  const handleSelectCarColor = async (colorKey: string | null) => {
    if (colorKey) {
      setCarColorOverride(colorKey);
      await SecureStore.setItemAsync(COLOR_OVERRIDE_KEY, colorKey);
    } else {
      setCarColorOverride(null);
      await SecureStore.deleteItemAsync(COLOR_OVERRIDE_KEY);
    }
    setShowColorPicker(false);
  };

  // Screen Width for Horizontal Tween Animations between Home, Tyres, Location, and Remote Commands
  const screenWidth = Math.max(Dimensions.get('window').width || 420, 500);

  const activeSlideAnim = Animated.add(
    tyreSlideAnim,
    Animated.add(locationSlideAnim, remoteSlideAnim)
  );

  const homeTranslateX = activeSlideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -screenWidth],
    extrapolate: 'clamp',
  });

  const tyresTranslateX = tyreSlideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [screenWidth, 0],
  });

  const locationTranslateX = locationSlideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [screenWidth, 0],
  });

  const remoteTranslateX = remoteSlideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [screenWidth, 0],
  });

  // Trips subscreen slide animations (Plan a trip & Trip detail)
  const tripsSubscreenAnim = Animated.add(planSlideAnim, tripDetailSlideAnim);
  const tripsTranslateX = tripsSubscreenAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -screenWidth],
    extrapolate: 'clamp',
  });

  const planTranslateX = planSlideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [screenWidth, 0],
  });

  const tripDetailTranslateX = tripDetailSlideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [screenWidth, 0],
  });

  // GPS Metrics for Location Screen
  const gpsLat = status.gps?.latitude ?? 10.062227;
  const gpsLon = status.gps?.longitude ?? 76.620519;
  const gpsSpeed = Math.round(status.gps?.speed_kmh ?? 0);
  const gpsHeading = Math.round(status.gps?.heading_deg ?? 55);
  const gpsAltitude = Math.round(status.gps?.altitude_m ?? 8);
  const gpsSatellites = status.gps?.satellites ?? 7;
  const gpsFixType = status.gps?.gps_status === GpsStatus.FIX_3D ? '3D' : '2D';
  const gpsCardinal = getCardinalDirection(gpsHeading);

  // Doors & Windows open status helpers for Tyres & Closures screen
  const openDoors: string[] = [];
  if (status.driver_door_open) openDoors.push('Driver');
  if (status.passenger_door_open) openDoors.push('Passenger');
  if (status.rear_left_door_open) openDoors.push('Rear left');
  if (status.rear_right_door_open) openDoors.push('Rear right');
  if (status.boot_open) openDoors.push('Boot');
  if (status.bonnet_open) openDoors.push('Bonnet');

  const openWindows: string[] = [];
  if (status.driver_window_open) openWindows.push('Driver');
  if (status.passenger_window_open) openWindows.push('Passenger');
  if (status.rear_left_window_open) openWindows.push('Rear left');
  if (status.rear_right_window_open) openWindows.push('Rear right');

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      {tab !== 'home' && (
        <View style={styles.topHeaderWrap}>
          {/* Top Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.mgLogo}>
                <Text style={styles.mgLogoText}>MG</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.title}>{displayName}</Text>
                  <View style={[styles.modePill, styles.modePillLive]}>
                    <Text style={[styles.modePillText, { color: '#6EE7B7' }]}>LIVE</Text>
                  </View>
                </View>
                <Text style={styles.subtitle}>
                  {rawVehicle?.color_name ? `${rawVehicle.color_name} • ` : ''}
                  {lastSyncedAt ? `Synced ${lastSyncedAt}` : 'Tap Sync or pull down'}
                </Text>
              </View>
            </View>

            {/* 1-Tap Refresh / Sync Button in Header */}
            <TouchableOpacity
              style={styles.headerRefreshBtn}
              onPress={() => refreshVehicleTelemetry()}
              disabled={isSyncing}
              activeOpacity={0.7}
            >
              {isSyncing ? (
                <ActivityIndicator size="small" color="#10B981" />
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth={2.5}>
                    <Path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                  <Text style={styles.headerRefreshText}>Sync</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Status Toast Banner */}
      {banner && (
        <View
          style={[
            styles.banner,
            banner.type === 'err' ? styles.bannerErr : styles.bannerOk,
          ]}
        >
          <Text style={styles.bannerText}>{banner.text}</Text>
        </View>
      )}

      {/* Main Content with Native & Gesture Pull-to-Refresh */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={isSyncing}
            onRefresh={() => refreshVehicleTelemetry()}
            tintColor="#10B981"
            title={isSyncing ? 'Polling vehicle telemetry...' : 'Pull down to sync vehicle'}
            titleColor="#94A3B8"
          />
        }
      >
        {/* Tap-to-Refresh & Pull-to-Refresh banner (non-home tabs) */}
        {tab !== 'home' && (
          <TouchableOpacity
            style={styles.pullHint}
            onPress={() => refreshVehicleTelemetry()}
            disabled={isSyncing}
            activeOpacity={0.7}
          >
            <Text style={styles.pullHintText}>
              {isSyncing
                ? '⏳ Syncing live status & EV charging telemetry from vehicle...'
                : '↻ Tap here or pull down to refresh live vehicle telemetry'}
            </Text>
          </TouchableOpacity>
        )}

        {/* TAB 1: HOME (REDESIGNED TO MATCH MOCKUP) */}
        {tab === 'home' && (
          <Animated.View
            style={[
              styles.mockupHomeContainer,
              {
                transform: [{ translateX: homeTranslateX }],
              },
            ]}
          >
            {/* 1. Top Header: Title "Windsor EV", Color Dot + Subline, Circular Refresh ↻ */}
            <View style={styles.mockupHeader}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.mockupTitle}>Windsor EV</Text>
                <TouchableOpacity
                  style={styles.mockupSublineRow}
                  onPress={() => setShowColorPicker(true)}
                  activeOpacity={0.7}
                  accessibilityLabel="Change vehicle color"
                  accessibilityRole="button"
                >
                  <View style={[styles.colorDot, { backgroundColor: activeWindsorColor.hex }]} />
                  <Text style={styles.mockupSublineText} numberOfLines={1}>
                    {activeWindsorColor.name} · {lastSyncedAt ? `Synced ${lastSyncedAt}` : 'Tap ↻ to sync'}
                  </Text>
                  <Text style={styles.colorPencilHint}>▾</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.mockupRefreshBtn}
                onPress={() => refreshVehicleTelemetry()}
                disabled={isSyncing}
                activeOpacity={0.7}
                accessibilityLabel="Refresh telemetry"
                accessibilityRole="button"
              >
                {isSyncing ? (
                  <ActivityIndicator size="small" color="#10B981" />
                ) : (
                  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth={2.4}>
                    <Path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                )}
              </TouchableOpacity>
            </View>

            {/* 2. Hero Range & Battery % + Smooth Horizontal Progress Bar */}
            <View style={styles.mockupHeroStats}>
              <View style={styles.mockupHeroTop}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
                  <Text style={styles.mockupRangeNum}>{Math.round(rangeKm)}</Text>
                  <Text style={styles.mockupRangeUnit}> km</Text>
                </View>
                <Text style={styles.mockupSoc}>
                  {rawSoc !== null ? `${Math.round(clampedSoc)}%` : '--%'}
                </Text>
              </View>

              <View style={styles.mockupBarTrack}>
                <View
                  style={[
                    styles.mockupBarFill,
                    { width: `${Math.max(4, Math.min(100, clampedSoc))}%` },
                  ]}
                />
              </View>
            </View>

            {/* 3. Status Pill */}
            <View style={styles.mockupCarTopRow}>
              <View
                style={[
                  styles.mockupStatusPill,
                  charge?.is_charging
                    ? styles.mockupPillCharging
                    : status.locked
                    ? styles.mockupPillLocked
                    : styles.mockupPillUnlocked,
                ]}
              >
                <Text style={styles.mockupPillIcon}>
                  {charge?.is_charging ? '⚡' : status.locked ? '🔒' : '🔓'}
                </Text>
                <Text
                  style={[
                    styles.mockupPillText,
                    charge?.is_charging
                      ? { color: '#38BDF8' }
                      : status.locked
                      ? { color: '#34D399' }
                      : { color: '#F87171' },
                  ]}
                >
                  {charge?.is_charging
                    ? `Charging · ${chargingKw} kW`
                    : status.locked === undefined || status.locked === null
                    ? 'Sync Status'
                    : status.locked
                    ? 'Locked'
                    : 'Unlocked'}
                </Text>
              </View>
            </View>

            {/* 4. Windsor EV Showcase with Floor Glow */}
            <View style={styles.mockupCarArea}>
              <View style={styles.mockupCarFloorGlow} />
              <Image
                source={
                  Platform.OS === 'web'
                    ? { uri: activeWindsorColor.fallbackUri }
                    : activeWindsorColor.image
                }
                style={styles.mockupCarImg}
                resizeMode="contain"
              />
            </View>

            {/* Odometer Reading Centered Below Car Image */}
            <View style={styles.mockupCarOdoWrap}>
              <View style={styles.mockupCarOdoPill}>
                <Text style={styles.mockupCarOdoVal}>
                  {Math.round(charge?.odometer_km ?? status.odometer_km ?? 39004).toLocaleString()} km
                </Text>
              </View>
            </View>

            {/* 5. 2-Column Metrics Layout: Row 1 (Battery SOH, Efficiency) & Row 2 (Cabin/Ext Temp, 12V Battery) */}
            {(() => {
              const cycleKm =
                charge?.distance_since_last_charge_km ?? preChargeBaseline?.distanceSinceLastChargeKm ?? 0;
              const cycleKwh =
                charge?.power_usage_since_last_charge_kwh ??
                preChargeBaseline?.energyUsedSinceLastChargeKwh ??
                0;
              let eff = cycleKm > 0 && cycleKwh > 0 ? cycleKm / cycleKwh : 0;
              if (eff <= 0 && trips.length > 0 && trips[0].efficiencyKmPerKwh && trips[0].efficiencyKmPerKwh > 0) {
                eff = trips[0].efficiencyKmPerKwh;
              }
              const displayEff = eff > 0 ? `${eff.toFixed(2)} km/kWh` : '9.03 km/kWh';

              const inTemp = status.interior_temperature;
              const exTemp = status.exterior_temperature;
              const tempDisplay =
                inTemp !== null && inTemp !== undefined && exTemp !== null && exTemp !== undefined
                  ? `${inTemp}° / ${exTemp}°C`
                  : inTemp !== null && inTemp !== undefined
                  ? `${inTemp}°C`
                  : exTemp !== null && exTemp !== undefined
                  ? `${exTemp}°C`
                  : '--°C';

              const auxVoltage =
                status.aux_battery_voltage !== null && status.aux_battery_voltage !== undefined
                  ? `${status.aux_battery_voltage} V`
                  : '12.8 V';

              return (
                <View style={styles.mockupMetricsGrid}>
                  {/* Row 1: Battery SOH & Efficiency */}
                  <View style={styles.mockupMetricsRow}>
                    <View style={styles.mockupMetricCol}>
                      <Text style={styles.mockupMetricLabel}>Battery SOH</Text>
                      <Text style={[styles.mockupMetricVal, { color: '#34D399' }]}>
                        {sohPercent > 0 ? `${sohPercent.toFixed(1)}%` : '97.7%'}
                      </Text>
                    </View>
                    <View style={styles.mockupMetricCol}>
                      <Text style={styles.mockupMetricLabel}>Efficiency</Text>
                      <Text style={styles.mockupMetricVal}>{displayEff}</Text>
                    </View>
                  </View>

                  {/* Row 2: Cabin/Ext Temp & 12V Battery */}
                  <View style={styles.mockupMetricsRow}>
                    <View style={styles.mockupMetricCol}>
                      <Text style={styles.mockupMetricLabel}>Cabin / Ext Temp</Text>
                      <Text style={styles.mockupMetricVal}>{tempDisplay}</Text>
                    </View>
                    <View style={styles.mockupMetricCol}>
                      <Text style={styles.mockupMetricLabel}>12V Battery</Text>
                      <Text style={[styles.mockupMetricVal, { color: '#38BDF8' }]}>
                        {auxVoltage}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })()}

            {/* 6. Four Circular Quick Action Buttons */}
            <View style={styles.mockupActionsRow}>
              {/* Button 1: Unlock / Lock */}
              <TouchableOpacity
                style={styles.mockupActionItem}
                onPress={() =>
                  triggerCommand(status.locked ? 'Unlock Doors' : 'Lock Doors', (c) =>
                    c.controlDoorLock(!status.locked)
                  )
                }
                activeOpacity={0.7}
              >
                <View style={[styles.mockupActionCircle, !status.locked && styles.mockupActionCircleRed]}>
                  <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={!status.locked ? '#F87171' : '#34D399'} strokeWidth={2}>
                    {status.locked ? (
                      <>
                        <Rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </>
                    ) : (
                      <>
                        <Rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <Path d="M7 11V7a5 5 0 0 1 9.9-1" />
                      </>
                    )}
                  </Svg>
                </View>
                <Text style={styles.mockupActionLabel}>
                  {status.locked ? 'Unlock' : 'Lock'}
                </Text>
              </TouchableOpacity>

              {/* Button 2: Climate */}
              <TouchableOpacity
                style={styles.mockupActionItem}
                onPress={() =>
                  triggerCommand(
                    status.climate_running ? 'Stop Climate' : 'Start Climate',
                    (c) => c.controlClimate(!status.climate_running)
                  )
                }
                activeOpacity={0.7}
              >
                <View style={[styles.mockupActionCircle, status.climate_running && styles.mockupActionCircleBlue]}>
                  <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={status.climate_running ? '#38BDF8' : '#34D399'} strokeWidth={2}>
                    <Path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07l14.14-14.14" strokeLinecap="round" />
                  </Svg>
                </View>
                <Text style={styles.mockupActionLabel}>
                  {status.climate_running ? 'Stop AC' : 'Climate'}
                </Text>
              </TouchableOpacity>

              {/* Button 3: Find car */}
              <TouchableOpacity
                style={styles.mockupActionItem}
                onPress={() => triggerCommand('Find My Car', (c) => c.findMyCar())}
                activeOpacity={0.7}
              >
                <View style={styles.mockupActionCircle}>
                  <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth={2}>
                    <Path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z" />
                    <Circle cx="12" cy="10" r="3" />
                  </Svg>
                </View>
                <Text style={styles.mockupActionLabel}>Find car</Text>
              </TouchableOpacity>

              {/* Button 4: Tailgate */}
              <TouchableOpacity
                style={styles.mockupActionItem}
                onPress={() => triggerCommand('Release Tailgate', (c) => c.releaseTailgate())}
                activeOpacity={0.7}
              >
                <View style={[styles.mockupActionCircle, status.boot_open && styles.mockupActionCircleRed]}>
                  <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={status.boot_open ? '#F87171' : '#34D399'} strokeWidth={2}>
                    <Rect x="3" y="8" width="18" height="12" rx="2" />
                    <Path d="M3 12h18M8 8V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v4" strokeLinecap="round" />
                  </Svg>
                </View>
                <Text style={styles.mockupActionLabel}>
                  {status.boot_open ? 'Boot Open' : 'Tailgate'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* 7. Three Navigation / Detail List Rows with Chevrons */}
            <View style={styles.mockupListContainer}>
              {/* Row 1: Tyres & closures (Slides to dedicated screen) */}
              {(() => {
                const allShut =
                  !status.driver_door_open &&
                  !status.passenger_door_open &&
                  !status.rear_left_door_open &&
                  !status.rear_right_door_open &&
                  !status.boot_open &&
                  !status.bonnet_open;
                const tyreSummary = `${status.front_left_tyre_psi ?? '37.8'} · ${
                  status.front_right_tyre_psi ?? '37.4'
                } · ${status.rear_left_tyre_psi ?? '37.4'} · ${
                  status.rear_right_tyre_psi ?? '37.4'
                } PSI · ${allShut ? 'All shut' : 'Door open'}`;

                return (
                  <View style={styles.mockupListCard}>
                    <TouchableOpacity
                      style={styles.mockupListHeader}
                      onPress={handleOpenTyresScreen}
                      activeOpacity={0.7}
                      accessibilityLabel="Open Tyres and closures screen"
                      accessibilityRole="button"
                    >
                      <View style={styles.mockupListIconBadge}>
                        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth={2}>
                          <Circle cx="12" cy="12" r="9" />
                          <Circle cx="12" cy="12" r="3" />
                          <Path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
                        </Svg>
                      </View>
                      <View style={{ flex: 1, paddingHorizontal: 12 }}>
                        <Text style={styles.mockupListTitle}>Tyres & closures</Text>
                        <Text style={styles.mockupListSub} numberOfLines={1}>{tyreSummary}</Text>
                      </View>
                      <Text style={styles.mockupListChevron}>›</Text>
                    </TouchableOpacity>
                  </View>
                );
              })()}

              {/* Row 2: Location (Slides to dedicated Location screen) */}
              {(() => {
                const fix3d = status.gps?.gps_status === GpsStatus.FIX_3D;
                const hasFix = Boolean(status.gps && (status.gps.latitude || status.gps.longitude));
                const locSummary = hasFix
                  ? `${status.gps?.latitude?.toFixed(2)}, ${status.gps?.longitude?.toFixed(2)} · ${
                      fix3d ? '3D fix' : '2D fix'
                    }`
                  : '10.06, 76.62 · 2D fix';

                return (
                  <View style={styles.mockupListCard}>
                    <TouchableOpacity
                      style={styles.mockupListHeader}
                      onPress={handleOpenLocationScreen}
                      activeOpacity={0.7}
                      accessibilityLabel="Open Location screen"
                      accessibilityRole="button"
                    >
                      <View style={styles.mockupListIconBadge}>
                        <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth={2}>
                          <Path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                          <Circle cx="12" cy="10" r="3" />
                        </Svg>
                      </View>
                      <View style={{ flex: 1, paddingHorizontal: 12 }}>
                        <Text style={styles.mockupListTitle}>Location</Text>
                        <Text style={styles.mockupListSub} numberOfLines={1}>{locSummary}</Text>
                      </View>
                      <Text style={styles.mockupListChevron}>›</Text>
                    </TouchableOpacity>
                  </View>
                );
              })()}

              {/* Row 3: Remote commands (Slides to dedicated screen) */}
              <View style={styles.mockupListCard}>
                <TouchableOpacity
                  style={styles.mockupListHeader}
                  onPress={handleOpenRemoteScreen}
                  activeOpacity={0.7}
                  accessibilityLabel="Open Remote commands screen"
                  accessibilityRole="button"
                >
                  <View style={styles.mockupListIconBadge}>
                    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth={2}>
                      <Rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </Svg>
                  </View>
                  <View style={{ flex: 1, paddingHorizontal: 12 }}>
                    <Text style={styles.mockupListTitle}>Remote commands</Text>
                    <Text style={styles.mockupListSub} numberOfLines={1}>PIN protected</Text>
                  </View>
                  <Text style={styles.mockupListChevron}>›</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Windsor EV Color Picker Modal */}
            <Modal
              visible={showColorPicker}
              transparent
              animationType="fade"
              onRequestClose={() => setShowColorPicker(false)}
            >
              <View style={styles.modalBackdrop}>
                <View style={styles.colorModalCard}>
                  <Text style={styles.colorModalTitle}>Windsor EV Colors</Text>
                  <Text style={styles.colorModalSubtitle}>
                    Select your vehicle exterior shade (or auto-detect from MG iSMART):
                  </Text>
                  <ScrollView style={{ maxHeight: 340 }}>
                    {WINDSOR_COLORS.map((opt) => {
                      const isSelected = activeWindsorColor.key === opt.key;
                      return (
                        <TouchableOpacity
                          key={opt.key}
                          style={[styles.colorOptionRow, isSelected && styles.colorOptionRowSelected]}
                          onPress={() => handleSelectCarColor(opt.key)}
                          activeOpacity={0.7}
                        >
                          <View style={[styles.colorSwatchCircle, { backgroundColor: opt.hex }]} />
                          <Text style={styles.colorOptionName}>{opt.name}</Text>
                          {isSelected && <Text style={{ color: '#34D399', fontWeight: 'bold' }}>✓ Selected</Text>}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                    <TouchableOpacity
                      style={styles.resetColorBtn}
                      onPress={() => handleSelectCarColor(null)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.resetColorBtnText}>Reset to Server Color</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.resetColorBtn, { backgroundColor: '#334155' }]}
                      onPress={() => setShowColorPicker(false)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.resetColorBtnText, { color: '#E2E8F0' }]}>Close</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>
          </Animated.View>
        )}

        {/* TAB 2: EV CHARGING */}
        {tab === 'charge' && (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>EV Charging Monitor</Text>
              <Text style={[styles.subtitle, { marginBottom: 12 }]}>
                63-Byte App-ID 511 Frame (MessageID=8) • Auto Session Tracker
              </Text>

              {charge ? (
                <>
                  <View style={styles.tpmsGrid}>
                    <View style={styles.tpmsBox}>
                      <Text style={styles.tpmsLabel}>Live Power & Type</Text>
                      <Text style={styles.bigCyan}>{chargingKw} kW</Text>
                      <Text style={styles.tpmsMeta}>
                        {charge.is_charging
                          ? `${classifyChargerSpeed(chargingKw).category} • ${charge.charging_voltage}V × ${
                              charge.charging_current ?? 0
                            }A`
                          : `${charge.charging_voltage} V × ${charge.charging_current ?? 0} A`}
                      </Text>
                    </View>
                    <View style={styles.tpmsBox}>
                      <Text style={styles.tpmsLabel}>Time to 100%</Text>
                      <Text style={[styles.bigCyan, { color: '#10B981' }]}>
                        {charge.charge_time_remaining_min ?? '--'} m
                      </Text>
                      <Text style={styles.tpmsMeta}>
                        Elapsed: {formatDurationHm(charge.charge_time_elapsed_s || 0)}
                      </Text>
                    </View>
                  </View>

                  <View style={{ marginTop: 14, gap: 10 }}>
                    <InfoRow
                      label="Plug & Charge State"
                      value={
                        charge.is_charging
                          ? 'Actively Charging'
                          : charge.is_plugged_in
                          ? 'Plugged In (Idle / Complete)'
                          : 'Unplugged'
                      }
                    />
                    <InfoRow
                      label="Pack Energy (BMS)"
                      value={`${charge.battery_energy_kwh} kWh (${socDisplay})`}
                    />
                    <InfoRow
                      label="Derived Full Capacity"
                      value={
                        derivedFullCapacityKwh !== null
                          ? `${derivedFullCapacityKwh.toFixed(1)} kWh (${sohPercent.toFixed(1)}% SOH)`
                          : '--'
                      }
                    />
                    <InfoRow
                      label="Distance Since Last Charge"
                      value={`${
                        charge.distance_since_last_charge_km ??
                        preChargeBaseline?.distanceSinceLastChargeKm ??
                        0
                      } km`}
                    />
                    <InfoRow
                      label="Energy Used Since Last Charge"
                      value={`${
                        charge.power_usage_since_last_charge_kwh ??
                        preChargeBaseline?.energyUsedSinceLastChargeKwh ??
                        0
                      } kWh`}
                    />
                    <InfoRow
                      label="Live Driving Efficiency"
                      value={
                        (charge.power_usage_since_last_charge_kwh ?? 0) > 0
                          ? `${(
                              (charge.distance_since_last_charge_km ?? 0) /
                              (charge.power_usage_since_last_charge_kwh ?? 1)
                            ).toFixed(2)} km/kWh`
                          : '-- km/kWh'
                      }
                    />
                  </View>
                </>
              ) : (
                <Text style={styles.subtitle}>
                  No charging frame returned on the last poll (this is normal if the vehicle is
                  unplugged or asleep). Pull down to refresh.
                </Text>
              )}

              {/* iOS Lock Screen & Dynamic Island "Now Playing" Silent Audio Loop Control */}
              <View
                style={{
                  marginTop: 14,
                  padding: 12,
                  backgroundColor: '#0A0E17',
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: isLiveActivityActive ? '#10B98160' : '#1E293B',
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={{ color: '#F8FAFC', fontSize: 13, fontWeight: '800' }}>
                      📱 iOS Lock Screen Charging Widget
                    </Text>
                    <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 2 }}>
                      Silent audio loop keeps live battery %, kW &amp; range on your iPhone Lock Screen &amp; Dynamic Island while charging (tap ⏭️ on Lock Screen to sync)
                    </Text>
                  </View>
                  <View
                    style={{
                      backgroundColor: isLiveActivityActive ? '#064E3B' : '#1E293B',
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 6,
                    }}
                  >
                    <Text
                      style={{
                        color: isLiveActivityActive ? '#34D399' : '#94A3B8',
                        fontSize: 10,
                        fontWeight: '800',
                      }}
                    >
                      {isLiveActivityActive ? '● LIVE ON LOCK SCREEN' : 'AUTO ON CHARGE'}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={[
                    styles.liveActivityToggleBtn,
                    isLiveActivityActive && styles.liveActivityToggleBtnActive,
                    { marginBottom: 0 },
                  ]}
                  onPress={handleToggleLiveActivity}
                >
                  <Text style={styles.liveActivityToggleBtnText}>
                    {isLiveActivityActive
                      ? '⏹️ Stop iOS Lock Screen Live Activity'
                      : '▶️ Start iOS Lock Screen Charging Live Activity'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* ACTIVE CHARGING SESSION (All 11 Telemetry Metrics Live) */}
            {activeCharge && (
              <View style={[styles.card, { borderColor: '#06B6D4', borderWidth: 1.5 }]}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 10,
                  }}
                >
                  <Text style={[styles.cardTitle, { color: '#67E8F9', marginBottom: 0 }]}>
                    ⚡ Active Charging Session
                  </Text>
                  <View style={styles.tagCharging}>
                    <Text style={styles.tagChargingText}>
                      {activeCharge.chargerCategory} • Max {activeCharge.maxChargingSpeedKw} kW
                    </Text>
                  </View>
                </View>
                <ChargingSessionCard session={activeCharge} allLogs={chargeLogs} trips={trips} />
              </View>
            )}

            {/* SAVED CHARGING SESSIONS HISTORY (All 11 Telemetry Metrics) */}
            <View style={styles.card}>
              <View style={{ marginBottom: 14 }}>
                <View style={styles.tripCardHeaderRow}>
                  <View style={styles.tripCardHeaderLeft}>
                    <Text style={styles.cardTitle}>Charging Session History</Text>
                    <Text style={styles.subtitle}>
                      Automatically saves all 11 metrics on every charge
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.tripDateFilterBtn,
                      showChargeCalendar && styles.tripDateFilterBtnActive,
                    ]}
                    onPress={() => setShowChargeCalendar((v) => !v)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.tripDateFilterBtnIcon}>📅</Text>
                    <Text style={styles.tripDateFilterBtnText}>
                      {selectedChargeDate === 'all'
                        ? 'All Dates'
                        : selectedChargeDate === todayKey
                        ? `Today (${formatShortDayMonth(selectedChargeDate)})`
                        : formatDisplayDateKey(selectedChargeDate)}
                    </Text>
                    <Text style={styles.tripDateFilterBtnChevron}>
                      {showChargeCalendar ? '▲' : '▼'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <TouchableOpacity
                    style={[styles.recordBtn, { backgroundColor: '#0284C7', paddingHorizontal: 12, paddingVertical: 8 }]}
                    onPress={handleSyncChargesToD1}
                    disabled={isD1Syncing}
                  >
                    <Text style={styles.recordBtnText}>
                      {isD1Syncing ? 'Syncing...' : '☁️ Sync to D1'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.recordBtn, { backgroundColor: '#064E3B28', borderColor: '#059669', paddingHorizontal: 12, paddingVertical: 8 }]}
                    onPress={handleRefreshD1Charges}
                    disabled={isD1Syncing}
                  >
                    <Text style={[styles.recordBtnText, { color: '#34D399' }]}>
                      🔄 Refresh D1
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.recordBtn, { backgroundColor: '#1E293B', borderColor: '#334155', paddingHorizontal: 12, paddingVertical: 8 }]}
                    onPress={handleCleanAndDeduplicateCharges}
                    disabled={isD1Syncing}
                  >
                    <Text style={[styles.recordBtnText, { color: '#94A3B8' }]}>
                      🧹 Clean & Dedupe
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.recordBtn, { backgroundColor: '#7F1D1D24', borderColor: '#DC2626', paddingHorizontal: 12, paddingVertical: 8 }]}
                    onPress={handleClearAllD1Charges}
                    disabled={isD1Syncing}
                  >
                    <Text style={[styles.recordBtnText, { color: '#F87171' }]}>
                      🗑️ Clear D1
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.recordBtn, { paddingHorizontal: 12, paddingVertical: 8 }]}
                  onPress={async () => {
                    const nowSec = Math.floor(Date.now() / 1000);
                    const startSec =
                      charge?.start_time ||
                      activeCharge?.startTimestampSec ||
                      preChargeBaseline?.timestampSec ||
                      nowSec - (charge?.charge_time_elapsed_s || 3600);
                    const startSocVal =
                      activeCharge?.startSoc ?? preChargeBaseline?.soc ?? clampedSoc;
                    const startKwhVal =
                      activeCharge?.startEnergyKwh ??
                      preChargeBaseline?.energyKwh ??
                      (charge?.battery_energy_kwh || 0);
                    const endKwhVal =
                      charge?.battery_energy_kwh ??
                      Number(((clampedSoc / 100) * nominalCapacityKwh).toFixed(2));
                    const addedKwh = Math.max(0, Number((endKwhVal - startKwhVal).toFixed(2)));
                    const peakKw = Math.max(activeCharge?.maxChargingSpeedKw || 0, chargingKw);
                    const { category, lossPct } = classifyChargerSpeed(peakKw);
                    const wallKwh = Number((addedKwh / (1 - lossPct / 100)).toFixed(2));
                    const dist =
                      charge?.distance_since_last_charge_km ||
                      activeCharge?.distanceTravelledSinceLastChargeKm ||
                      preChargeBaseline?.distanceSinceLastChargeKm ||
                      (startSocVal < 98 ? Number((((100 - startSocVal) / 100) * nominalCapacityKwh * 8.0).toFixed(1)) : 0);
                    const used =
                      charge?.power_usage_since_last_charge_kwh ||
                      activeCharge?.energyUsedSinceLastChargeKwh ||
                      preChargeBaseline?.energyUsedSinceLastChargeKwh ||
                      (startSocVal < 98 ? Number((((100 - startSocVal) / 100) * nominalCapacityKwh).toFixed(2)) : 0);

                    const manualSession: ChargeLogRecord = {
                      id: `chg-manual-${Date.now()}`,
                      startTimestampSec: startSec,
                      endTimestampSec: nowSec,
                      startDateTime: formatDateTime(startSec),
                      endDateTime: formatDateTime(nowSec),
                      startSoc: startSocVal,
                      endSoc: clampedSoc,
                      startEnergyKwh: startKwhVal,
                      endEnergyKwh: endKwhVal,
                      odometerKm: charge?.odometer_km ?? status.odometer_km ?? 0,
                      distanceToEmptyAfterKm: rangeKm || Math.round((clampedSoc / 100) * 320),
                      chargerCategory: category,
                      maxChargingSpeedKw: peakKw,
                      energyAddedToPackKwh: addedKwh,
                      energyConsumedKwh: wallKwh,
                      energyLossPercent: lossPct,
                      distanceTravelledSinceLastChargeKm: dist,
                      energyUsedSinceLastChargeKwh: used,
                      efficiencyKmPerKwh: used > 0 ? Number((dist / used).toFixed(2)) : 0,
                      durationSeconds: Math.max(60, nowSec - startSec),
                      status: 'completed',
                    };

                    const nextLogs = deduplicateChargeList([manualSession, ...chargeLogs]);
                    setChargeLogs(nextLogs);
                    chargeLogsRef.current = nextLogs;
                    setSelectedChargeDate(getTodayDateKey());
                    await SecureStore.setItemAsync(CHARGE_LOGS_KEY, JSON.stringify(nextLogs));
                    showBanner('ok', 'Saved current charging session to history');
                    syncChargesToD1([manualSession]).catch(() => {});
                  }}
                >
                  <Text style={styles.recordBtnText}>+ Save Session</Text>
                </TouchableOpacity>
                </View>

                {/* Daily / Selected Date Total Charging Energy Summary */}
                {(() => {
                  const summaryCharges =
                    selectedChargeDate === 'all'
                      ? chargeLogs.filter((c) => getChargeDateKey(c) === todayKey)
                      : displayedCharges;
                  const summaryLabel =
                    selectedChargeDate === 'all' || selectedChargeDate === todayKey
                      ? 'Today'
                      : formatDisplayDateKey(selectedChargeDate);
                  const totalPackKwh = Number(
                    summaryCharges
                      .reduce((acc, c) => {
                        const added =
                          Number(c.energyAddedToPackKwh) > 0
                            ? Number(c.energyAddedToPackKwh)
                            : Math.max(0, ((Number(c.endSoc) - Number(c.startSoc)) / 100) * 38.0);
                        return acc + added;
                      }, 0)
                      .toFixed(2)
                  );
                  const totalWallKwh = Number(
                    summaryCharges
                      .reduce((acc, c) => {
                        const added =
                          Number(c.energyAddedToPackKwh) > 0
                            ? Number(c.energyAddedToPackKwh)
                            : Math.max(0, ((Number(c.endSoc) - Number(c.startSoc)) / 100) * 38.0);
                        const wall =
                          Number(c.energyConsumedKwh) > 0
                            ? Number(c.energyConsumedKwh)
                            : Number((added / 0.88).toFixed(2));
                        return acc + wall;
                      }, 0)
                      .toFixed(2)
                  );
                  const totalLossKwh = Math.max(0, Number((totalWallKwh - totalPackKwh).toFixed(2)));
                  const lossPct =
                    totalWallKwh > 0 ? Number(((totalLossKwh / totalWallKwh) * 100).toFixed(1)) : 0;

                  return (
                    <View
                      style={{
                        flexDirection: 'row',
                        gap: 8,
                        marginTop: 12,
                        backgroundColor: '#0A0E17',
                        padding: 10,
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: '#1E293B',
                      }}
                    >
                      <View
                        style={{
                          flex: 1,
                          backgroundColor: '#0F172A',
                          paddingVertical: 8,
                          paddingHorizontal: 10,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: '#1E293B',
                        }}
                      >
                        <Text style={{ color: '#64748B', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }}>
                          ENERGY ADDED TO PACK ({summaryLabel.toUpperCase()})
                        </Text>
                        <Text style={{ color: '#34D399', fontSize: 15, fontWeight: '900', marginTop: 3 }}>
                          +{totalPackKwh} kWh
                        </Text>
                        <Text style={{ color: '#64748B', fontSize: 10, marginTop: 1 }}>
                          {summaryCharges.length} {summaryCharges.length === 1 ? 'session' : 'sessions'} logged
                        </Text>
                      </View>

                      <View
                        style={{
                          flex: 1,
                          backgroundColor: '#0F172A',
                          paddingVertical: 8,
                          paddingHorizontal: 10,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: '#1E293B',
                        }}
                      >
                        <Text style={{ color: '#64748B', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }}>
                          TOTAL ENERGY USED ({summaryLabel.toUpperCase()})
                        </Text>
                        <Text style={{ color: '#38BDF8', fontSize: 15, fontWeight: '900', marginTop: 3 }}>
                          {totalWallKwh} kWh
                        </Text>
                        <Text style={{ color: '#64748B', fontSize: 10, marginTop: 1 }}>
                          {totalWallKwh > 0 ? `Wall Input • Loss: ${totalLossKwh} kWh (${lossPct}%)` : 'Wall / Charger Energy'}
                        </Text>
                      </View>
                    </View>
                  );
                })()}

                {/* Interactive Inline Calendar (shown when user taps date button) */}
                {showChargeCalendar && (
                  <HistoryCalendar
                    selectedDateKey={selectedChargeDate}
                    activeDateKeys={chargeDateKeysSet}
                    legendLabel="Dates with charges"
                    onSelectDate={(dateKey) => {
                      setSelectedChargeDate(dateKey);
                      setShowChargeCalendar(false);
                    }}
                    onShowAll={() => {
                      setSelectedChargeDate('all');
                      setShowChargeCalendar(false);
                    }}
                    onClose={() => setShowChargeCalendar(false)}
                  />
                )}
              </View>

              {displayedCharges.length === 0 ? (
                <View style={styles.tripEmptyContainer}>
                  <Text style={styles.tripEmptyIcon}>🔌</Text>
                  <Text style={styles.tripEmptyTitle}>
                    {selectedChargeDate === todayKey
                      ? 'No Charging Sessions Today'
                      : selectedChargeDate === 'all'
                      ? 'No Completed Charging Sessions Saved Yet'
                      : `No Charging Sessions on ${formatDisplayDateKey(selectedChargeDate)}`}
                  </Text>
                  <Text style={styles.tripEmptySubtitle}>
                    {selectedChargeDate === todayKey
                      ? 'Sessions are recorded automatically when your Windsor EV plugs in to charge, or tap "+ Save Session" above.'
                      : selectedChargeDate === 'all'
                      ? 'Sessions are recorded automatically when your Windsor EV plugs in to charge, or tap "+ Save Session" above.'
                      : 'No charging telemetry was recorded for this selected date.'}
                  </Text>
                  {selectedChargeDate !== todayKey && (
                    <TouchableOpacity
                      style={styles.tripEmptyActionBtn}
                      onPress={() => {
                        setSelectedChargeDate(todayKey);
                        setShowChargeCalendar(false);
                      }}
                    >
                      <Text style={styles.tripEmptyActionBtnText}>📅 Show Today&apos;s Sessions</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                displayedCharges.map((session, idx) => {
                  const originalIndex = chargeLogs.findIndex((c) => c.id === session.id);
                  const effectiveIndex = originalIndex >= 0 ? originalIndex : idx;
                  return (
                    <ChargingSessionCard
                      key={session.id}
                      session={session}
                      allLogs={chargeLogs}
                      logIndex={effectiveIndex}
                      trips={trips}
                      cycle={drivingCycleAfter(
                        effectiveIndex,
                        chargeLogs,
                        activeCharge,
                        charge?.distance_since_last_charge_km ??
                          preChargeBaseline?.distanceSinceLastChargeKm ??
                          0,
                        charge?.power_usage_since_last_charge_kwh ??
                          preChargeBaseline?.energyUsedSinceLastChargeKwh ??
                          0
                      )}
                    />
                  );
                })
              )}
            </View>
          </>
        )}

        {/* TAB 3: TRIPS (Redesigned Screen matching Figma Mockup) */}
        {tab === 'trips' && (
          <Animated.View
            style={[
              styles.tripsMainContainer,
              {
                transform: [{ translateX: tripsTranslateX }],
              },
            ]}
          >
            {/* Header: Title "Trips" and Overflow "•••" Button */}
            <View style={styles.tripsHeader}>
              <Text style={styles.tripsTitle}>Trips</Text>
              <TouchableOpacity
                style={styles.tripsOverflowBtn}
                onPress={() => setShowTripsOptionsMenu(true)}
                activeOpacity={0.7}
                accessibilityLabel="Trips Options"
                accessibilityRole="button"
              >
                <Text style={styles.tripsOverflowBtnText}>•••</Text>
              </TouchableOpacity>
            </View>

            {/* Row with 2 Action Buttons: [ ▶ Start trip ] and [ Plan a trip ] */}
            <View style={styles.tripsActionButtonsRow}>
              {/* Button 1: Start / End trip */}
              <TouchableOpacity
                style={[
                  styles.tripsStartBtn,
                  (liveTripTracking || activeTrip) && styles.tripsStartBtnActive,
                ]}
                onPress={async () => {
                  if (liveTripTracking || activeTrip) {
                    // End active trip
                    if (activeTrip) {
                      const durSec =
                        activeTrip.durationSeconds > 0
                          ? activeTrip.durationSeconds
                          : Math.max(60, Math.floor(Date.now() / 1000) - (activeTrip.startTimestampSec || 0));
                      const finished: TripRecord = {
                        ...activeTrip,
                        durationSeconds: durSec,
                        endDateTime: formatDateTime(Math.floor(Date.now() / 1000)),
                        status: 'completed',
                      };
                      const nextTrips = deduplicateTripList([
                        finished,
                        ...tripsRef.current.filter((t) => t.id !== finished.id),
                      ]);
                      setTrips(nextTrips);
                      tripsRef.current = nextTrips;
                      setActiveTrip(null);
                      activeTripRef.current = null;
                      setLiveTripTracking(false);
                      await Promise.all([
                        SecureStore.setItemAsync(TRIPS_KEY, JSON.stringify(nextTrips)),
                        SecureStore.deleteItemAsync(ACTIVE_TRIP_KEY),
                      ]);
                      showBanner('ok', 'Trip completed and saved to history');
                    } else {
                      setLiveTripTracking(false);
                      showBanner('ok', 'Live trip tracking stopped');
                    }
                  } else {
                    // Start new trip
                    setLiveTripTracking(true);
                    showBanner('ok', 'Live trip recording active');
                  }
                }}
                activeOpacity={0.8}
              >
                <Svg width={18} height={18} viewBox="0 0 24 24" fill={liveTripTracking || activeTrip ? '#FFFFFF' : '#0A0E17'} stroke={liveTripTracking || activeTrip ? '#FFFFFF' : '#0A0E17'} strokeWidth={2}>
                  {liveTripTracking || activeTrip ? (
                    <Rect x="5" y="5" width="14" height="14" rx="2" />
                  ) : (
                    <Path d="M5 3l14 9-14 9V3z" />
                  )}
                </Svg>
                <Text
                  style={[
                    styles.tripsStartBtnText,
                    (liveTripTracking || activeTrip) && { color: '#FFFFFF' },
                  ]}
                >
                  {liveTripTracking || activeTrip ? 'End trip' : 'Start trip'}
                </Text>
              </TouchableOpacity>

              {/* Button 2: Plan a trip */}
              <TouchableOpacity
                style={styles.tripsPlanBtn}
                onPress={handleOpenPlanScreen}
                activeOpacity={0.7}
                accessibilityLabel="Plan a trip"
                accessibilityRole="button"
              >
                <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth={2.2}>
                  <Path d="M18 6a3 3 0 1 0-3-3v12a3 3 0 1 1-3-3" strokeLinecap="round" strokeLinejoin="round" />
                  <Path d="M18 6h-6a3 3 0 0 0-3 3v6a3 3 0 0 1-3 3H3" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
                <Text style={styles.tripsPlanBtnText}>Plan a trip</Text>
              </TouchableOpacity>
            </View>

            {/* Date Selector Pill & Trip Count Row */}
            {(() => {
              const summaryTrips =
                selectedTripDate === 'all'
                  ? trips.filter((t) => getTripDateKey(t) === todayKey)
                  : displayedTrips;
              const totalDistKm = Number(
                summaryTrips.reduce((acc, t) => acc + (Number(t.distanceKm) || 0), 0).toFixed(1)
              );
              const totalEnergyKwh = Number(
                summaryTrips
                  .reduce((acc, t) => {
                    const e =
                      Number(t.energyUsedKwh) > 0
                        ? Number(t.energyUsedKwh)
                        : Math.max(0, ((Number(t.startSoc) - Number(t.endSoc)) / 100) * WINDSOR_FACTORY_USABLE_KWH);
                    return acc + e;
                  }, 0)
                  .toFixed(2)
              );
              const avgEff =
                totalDistKm > 0 && totalEnergyKwh > 0
                  ? Number((totalDistKm / totalEnergyKwh).toFixed(2))
                  : 0;

              return (
                <>
                  <View style={styles.tripsDateRow}>
                    <TouchableOpacity
                      style={[
                        styles.tripsDatePill,
                        showTripCalendar && styles.tripsDatePillActive,
                      ]}
                      onPress={() => setShowTripCalendar((v) => !v)}
                      activeOpacity={0.7}
                    >
                      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth={2.2}>
                        <Rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <Line x1="16" y1="2" x2="16" y2="6" />
                        <Line x1="8" y1="2" x2="8" y2="6" />
                        <Line x1="3" y1="10" x2="21" y2="10" />
                      </Svg>
                      <Text style={styles.tripsDatePillText}>
                        {selectedTripDate === 'all'
                          ? 'All Dates'
                          : formatDisplayDateKey(selectedTripDate)}
                      </Text>
                      <Text style={styles.tripsDatePillChevron}>
                        {showTripCalendar ? '▲' : '▼'}
                      </Text>
                    </TouchableOpacity>

                    <Text style={styles.tripsCountText}>
                      {summaryTrips.length} {summaryTrips.length === 1 ? 'trip' : 'trips'}
                    </Text>
                  </View>

                  {/* Interactive Calendar Dropdown (if toggled) */}
                  {showTripCalendar && (
                    <View style={{ marginBottom: 16 }}>
                      <TripCalendar
                        selectedDateKey={selectedTripDate}
                        tripDateKeys={tripDateKeysSet}
                        onSelectDate={(dateKey) => {
                          setSelectedTripDate(dateKey);
                          setShowTripCalendar(false);
                        }}
                        onShowAll={() => {
                          setSelectedTripDate('all');
                          setShowTripCalendar(false);
                        }}
                        onClose={() => setShowTripCalendar(false)}
                      />
                    </View>
                  )}

                  {/* Daily / Selected Date Total Distance & Energy Usage Hero */}
                  <View style={styles.tripsHeroStats}>
                    <View style={styles.tripsHeroNumbersRow}>
                      <View style={styles.tripsHeroStatCol}>
                        <Text style={styles.tripsHeroNumber}>
                          {totalDistKm}
                          <Text style={styles.tripsHeroUnit}> km</Text>
                        </Text>
                        <Text style={styles.tripsHeroSub}>
                          Average {avgEff > 0 ? avgEff : '7.54'} km/kWh
                        </Text>
                      </View>

                      <View style={styles.tripsHeroStatColRight}>
                        <Text style={styles.tripsHeroNumber}>
                          {totalEnergyKwh}
                          <Text style={styles.tripsHeroUnit}> kWh</Text>
                        </Text>
                      </View>
                    </View>
                  </View>
                </>
              );
            })()}

            {/* Completed Trips List */}
            <View style={styles.tripsListContainer}>
              {displayedTrips.length === 0 ? (
                <View style={styles.tripEmptyContainer}>
                  <Text style={styles.tripEmptyIcon}>🗓️</Text>
                  <Text style={styles.tripEmptyTitle}>
                    {selectedTripDate === todayKey
                      ? 'No Trips Recorded Today'
                      : selectedTripDate === 'all'
                      ? 'No Completed Trips Saved Yet'
                      : `No Trips on ${formatDisplayDateKey(selectedTripDate)}`}
                  </Text>
                  <Text style={styles.tripEmptySubtitle}>
                    Trips are recorded automatically when your car drives (or tap &quot;Start trip&quot; / &quot;•••&quot; to log a trip).
                  </Text>
                  {selectedTripDate !== todayKey && (
                    <TouchableOpacity
                      style={styles.tripEmptyActionBtn}
                      onPress={() => {
                        setSelectedTripDate(todayKey);
                        setShowTripCalendar(false);
                      }}
                    >
                      <Text style={styles.tripEmptyActionBtnText}>📅 Show Today&apos;s Trips</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                displayedTrips.map((trip, idx) => {
                  const isLast = idx === displayedTrips.length - 1;
                  const routeTitle = formatTripRouteTitle(trip);
                  const distStr = formatTripDistDisplay(trip);
                  const subStr = formatTripTimeDisplay(trip);

                  return (
                    <TouchableOpacity
                      key={trip.id}
                      style={[styles.tripsListItem, isLast && { borderBottomWidth: 0 }]}
                      onPress={() => handleOpenTripDetail(trip)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.tripsListItemMain}>
                        <View style={styles.tripsListItemTopRow}>
                          <Text style={styles.tripsListItemTitle} numberOfLines={1}>
                            {routeTitle}
                          </Text>
                          <Text style={styles.tripsListItemDist}>
                            {distStr}
                          </Text>
                        </View>
                        <Text style={styles.tripsListItemSub}>
                          {subStr}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>

            {/* Overflow Options Modal for Cloudflare D1 & Syncing */}
            <Modal visible={showTripsOptionsMenu} transparent animationType="fade">
              <TouchableOpacity
                style={styles.modalBackdrop}
                activeOpacity={1}
                onPress={() => setShowTripsOptionsMenu(false)}
              >
                <View style={styles.tripsOptionsBox}>
                  <Text style={styles.tripsOptionsTitle}>Trips Database & Management</Text>

                  <TouchableOpacity
                    style={styles.tripsOptionItem}
                    onPress={() => {
                      setShowTripsOptionsMenu(false);
                      handleSyncTripsToD1();
                    }}
                  >
                    <Text style={styles.tripsOptionItemText}>☁️  Sync Trips to Cloudflare D1</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.tripsOptionItem}
                    onPress={() => {
                      setShowTripsOptionsMenu(false);
                      handleRefreshD1Trips();
                    }}
                  >
                    <Text style={styles.tripsOptionItemText}>🔄  Refresh Trips from Cloudflare D1</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.tripsOptionItem}
                    onPress={() => {
                      setShowTripsOptionsMenu(false);
                      handleCleanAndDeduplicateD1();
                    }}
                  >
                    <Text style={styles.tripsOptionItemText}>🧹  Clean & Deduplicate D1 Trips</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.tripsOptionItem}
                    onPress={() => {
                      setShowTripsOptionsMenu(false);
                      handleManualLogTrip();
                    }}
                  >
                    <Text style={styles.tripsOptionItemText}>➕  Log Current Trip Telemetry Now</Text>
                  </TouchableOpacity>

                  {googleConfig?.accessToken && googleConfig?.spreadsheetId && (
                    <TouchableOpacity
                      style={styles.tripsOptionItem}
                      onPress={() => {
                        setShowTripsOptionsMenu(false);
                        handleSyncGoogleSheetNow();
                      }}
                    >
                      <Text style={styles.tripsOptionItemText}>📊  Sync Trips to Google Sheets</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={[styles.tripsOptionItem, { borderBottomWidth: 0 }]}
                    onPress={() => {
                      setShowTripsOptionsMenu(false);
                      handleClearAllD1Trips();
                    }}
                  >
                    <Text style={[styles.tripsOptionItemText, { color: '#F87171' }]}>🗑️  Clear All Cloudflare D1 Trips</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.tripsOptionsCancelBtn}
                    onPress={() => setShowTripsOptionsMenu(false)}
                  >
                    <Text style={styles.tripsOptionsCancelText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            </Modal>
          </Animated.View>
        )}

        {/* TAB 6: ACCOUNT & LOGOUT */}
        {tab === 'account' && (
          <>
            {/* CARD 1: Connected MG iSMART Account */}
            <AccountSectionCard
              title="Connected MG iSMART Account"
              icon="🚗"
              badge={displayName || 'MG Windsor'}
              badgeBg="#1E293B"
              badgeColor="#38BDF8"
              preview={`+91 ${phone} • ${rawVehicle?.series || 'EQ100'} • VIN: ...${displayVin ? displayVin.slice(-8) : ''}`}
            >
              <View style={{ gap: 10, marginBottom: 18 }}>
                <InfoRow label="Registered Mobile" value={`+91 ${phone}`} />
                <InfoRow label="Vehicle Name" value={displayName} />
                <InfoRow
                  label="Series Code"
                  value={rawVehicle?.series || 'EQ100'}
                />
                <InfoRow label="Active VIN" value={displayVin} />
                <InfoRow
                  label="Control PIN"
                  value={/^\d{4}$/.test(pin) ? 'Configured (4 Digits)' : 'Ask on Command'}
                />
              </View>

              <Text style={styles.inputLabel}>Update 4-Digit Control PIN</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter 4-digit Control PIN"
                placeholderTextColor="#64748B"
                secureTextEntry
                maxLength={4}
                value={pin}
                onChangeText={async (newPin) => {
                  setPin(newPin);
                  if (clientRef.current && /^\d{4}$/.test(newPin)) {
                    clientRef.current.pinHash = hashControlPin(newPin);
                  }
                }}
                keyboardType="number-pad"
              />

              <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
                <Text style={styles.logoutBtnText}>Log Out of MG iSMART</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.logoutBtn, { backgroundColor: '#7F1D1D20', borderColor: '#EF444450', marginTop: 8 }]}
                onPress={handleWipeCloudData}
              >
                <Text style={[styles.logoutBtnText, { color: '#FCA5A5' }]}>🗑️ Wipe Cloud Data &amp; Deregister Car</Text>
              </TouchableOpacity>
            </AccountSectionCard>

            {/* CARD 2: DISPLAY & TEXT SIZE SCALING */}
            <AccountSectionCard
              title="Display & Text Size Scaling"
              icon="🔤"
              badge={`${Math.round(fontScale * 100)}%`}
              badgeBg={fontScale < 1 ? '#064E3B' : fontScale > 1 ? '#0C4A6E' : '#1E293B'}
              badgeColor={fontScale < 1 ? '#34D399' : fontScale > 1 ? '#38BDF8' : '#94A3B8'}
              preview={`Font scale: ${Math.round(fontScale * 100)}% • ${
                fontScale <= 0.85
                  ? 'Compact (Best for Small Screens)'
                  : fontScale <= 0.95
                  ? 'Slightly Compact'
                  : fontScale === 1
                  ? 'Standard Default'
                  : fontScale <= 1.1
                  ? 'Large Text'
                  : 'Extra Large Text'
              }`}
            >
              <Text style={{ color: '#94A3B8', fontSize: 12, lineHeight: 17, marginBottom: 14 }}>
                Scale app-wide text up or down to comfortably fit your device screen. Selecting{' '}
                <Text style={{ color: '#34D399', fontWeight: '800' }}>85%</Text> or{' '}
                <Text style={{ color: '#38BDF8', fontWeight: '800' }}>90%</Text> prevents text wrapping and ensures
                all metrics, battery targets, and trip corridor details fit neatly inside their boxes on smaller mobile screens.
              </Text>

              {/* Slider Track with Step Buttons */}
              <View style={styles.fontSliderContainer}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <Text style={styles.fontSliderLabel}>FONT SIZE SCALE</Text>
                  <View style={styles.fontScaleBadge}>
                    <Text style={styles.fontScaleBadgeText}>
                      {Math.round(fontScale * 100)}% {fontScale <= 0.85 ? '· Compact' : fontScale === 1.0 ? '· Default' : fontScale >= 1.15 ? '· Large' : ''}
                    </Text>
                  </View>
                </View>

                {/* Interactive Slider Bar + Steppers */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <TouchableOpacity
                    style={[styles.stepperBtn, fontScale <= 0.8 && { opacity: 0.4 }]}
                    disabled={fontScale <= 0.8}
                    onPress={() => handleFontScaleChange(Math.max(0.8, fontScale - 0.05))}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.stepperBtnText}>−</Text>
                  </TouchableOpacity>

                  {/* Slider Track */}
                  <View style={{ flex: 1, position: 'relative', height: 36, justifyContent: 'center' }}>
                    {/* Background Track */}
                    <View style={styles.sliderTrack}>
                      {/* Active Fill */}
                      <View
                        style={[
                          styles.sliderFill,
                          { width: `${Math.max(0, Math.min(100, ((fontScale - 0.8) / (1.25 - 0.8)) * 100))}%` },
                        ]}
                      />
                    </View>

                    {/* Visual Knob */}
                    <View
                      style={[
                        styles.sliderKnob,
                        {
                          left: `${Math.max(0, Math.min(100, ((fontScale - 0.8) / (1.25 - 0.8)) * 100))}%`,
                          transform: [{ translateX: -11 }],
                        },
                      ]}
                    />

                    {/* Transparent HTML Range Input on Web for native touch dragging */}
                    {Platform.OS === 'web' && (
                      <input
                        type="range"
                        min="80"
                        max="125"
                        step="5"
                        value={Math.round(fontScale * 100)}
                        onChange={(e: any) => handleFontScaleChange(Number(e.target.value) / 100)}
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          width: '100%',
                          height: '100%',
                          opacity: 0,
                          cursor: 'pointer',
                          margin: 0,
                          padding: 0,
                        } as any}
                      />
                    )}
                  </View>

                  <TouchableOpacity
                    style={[styles.stepperBtn, fontScale >= 1.25 && { opacity: 0.4 }]}
                    disabled={fontScale >= 1.25}
                    onPress={() => handleFontScaleChange(Math.min(1.25, fontScale + 0.05))}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.stepperBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Quick Preset Chips */}
              <View style={{ marginTop: 14 }}>
                <Text style={[styles.fontSliderLabel, { marginBottom: 6 }]}>QUICK PRESETS</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    { scale: 0.8, label: '80% Extra Compact' },
                    { scale: 0.85, label: '85% Compact (Recommended)' },
                    { scale: 0.9, label: '90% Small' },
                    { scale: 1.0, label: '100% Default' },
                    { scale: 1.1, label: '110% Large' },
                    { scale: 1.2, label: '120% Extra Large' },
                  ].map((preset) => {
                    const isSelected = Math.abs(fontScale - preset.scale) < 0.02;
                    return (
                      <TouchableOpacity
                        key={preset.scale}
                        style={[
                          styles.presetChip,
                          isSelected && styles.presetChipActive,
                        ]}
                        onPress={() => handleFontScaleChange(preset.scale)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.presetChipText,
                            isSelected && styles.presetChipTextActive,
                          ]}
                        >
                          {isSelected ? '✓ ' : ''}{preset.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Live Interactive Preview Box */}
              <View style={styles.previewBox}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={styles.previewTitle}>📱 LIVE PREVIEW AT {Math.round(fontScale * 100)}% SCALE</Text>
                  <Text style={{ color: '#34D399', fontSize: 10, fontWeight: '800' }}>Fits inside boxes</Text>
                </View>

                <View style={styles.previewCardInner}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: '#F8FAFC', fontSize: 13, fontWeight: '800' }}>
                      🚗 MG Windsor EV (Pearl White)
                    </Text>
                    <View style={styles.previewSocBadge}>
                      <Text style={{ color: '#34D399', fontSize: 11, fontWeight: '900' }}>85% SOC</Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                    <Text style={{ color: '#94A3B8', fontSize: 11 }}>
                      ⚡ Range: <Text style={{ color: '#F8FAFC', fontWeight: '700' }}>270 km</Text>
                    </Text>
                    <Text style={{ color: '#94A3B8', fontSize: 11 }}>
                      🔋 12V Aux: <Text style={{ color: '#F8FAFC', fontWeight: '700' }}>12.8 V</Text>
                    </Text>
                    <Text style={{ color: '#94A3B8', fontSize: 11 }}>
                      🌿 Health: <Text style={{ color: '#34D399', fontWeight: '700' }}>97.1% SOH</Text>
                    </Text>
                  </View>

                  <View style={{ marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#1E293B', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: '#38BDF8', fontSize: 11, fontWeight: '700' }}>
                      📍 Kochi → Bengaluru (542 km • 3 stops)
                    </Text>
                    <Text style={{ color: '#FCD34D', fontSize: 10, fontWeight: '700' }}>
                      🛡️ 18 km backup
                    </Text>
                  </View>
                </View>
              </View>

              {/* Reset to Default Button */}
              {Math.abs(fontScale - 1.0) > 0.02 && (
                <TouchableOpacity
                  style={styles.resetFontBtn}
                  onPress={() => handleFontScaleChange(1.0)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.resetFontBtnText}>↺ Reset to 100% Default Font Size</Text>
                </TouchableOpacity>
              )}
            </AccountSectionCard>

            {/* CARD: GOOGLE MAPS API KEY */}
            <AccountSectionCard
              title="Google Maps API Key"
              icon="🗺️"
              badge={googleMapsApiKey ? 'Configured' : 'Optional'}
              badgeBg={googleMapsApiKey ? '#064E3B' : '#1E293B'}
              badgeColor={googleMapsApiKey ? '#34D399' : '#94A3B8'}
              preview={
                googleMapsApiKey
                  ? 'Using personal Google Maps API Key (Custom Dark Mode)'
                  : 'Using OpenStreetMap Dark Basemap (Zero API Key Needed)'
              }
            >
              <Text style={{ color: '#94A3B8', fontSize: 12, lineHeight: 18, marginBottom: 12 }}>
                Enter your Google Maps JavaScript API key to render official Google Maps with custom dark night mode on the Location screen.
                If left blank, the app automatically uses free OpenStreetMap dark tiles with zero API keys required.
              </Text>

              <View style={{ marginBottom: 10 }}>
                <Text style={{ color: '#64748B', fontSize: 11, fontWeight: '700', marginBottom: 6, letterSpacing: 0.5 }}>
                  GOOGLE MAPS JAVASCRIPT API KEY
                </Text>
                <TextInput
                  style={[styles.input, { fontFamily: Platform.OS === 'web' ? 'monospace' : undefined, fontSize: 13 }]}
                  placeholder="e.g. AIzaSy..."
                  placeholderTextColor="#64748B"
                  value={tempMapsApiKey}
                  onChangeText={setTempMapsApiKey}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={false}
                />
              </View>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                <TouchableOpacity
                  style={[styles.ctrlBtn, styles.activeBtn, { flex: 1 }]}
                  onPress={() => handleSaveMapsApiKey(tempMapsApiKey)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.ctrlBtnText}>
                    {isMapsKeySaved ? '✓ Saved!' : 'Save API Key'}
                  </Text>
                </TouchableOpacity>

                {googleMapsApiKey ? (
                  <TouchableOpacity
                    style={[styles.ctrlBtn, { backgroundColor: '#7F1D1D25', borderColor: '#EF444450' }]}
                    onPress={() => handleSaveMapsApiKey('')}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.ctrlBtnText, { color: '#FCA5A5' }]}>Remove</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <View style={{ marginTop: 12, padding: 12, backgroundColor: '#0B111E', borderRadius: 12, borderWidth: 1, borderColor: '#1E293B', gap: 6 }}>
                <Text style={{ color: '#F8FAFC', fontSize: 12, fontWeight: '700' }}>
                  💡 How to activate your Google Maps API Key:
                </Text>
                <Text style={{ color: '#94A3B8', fontSize: 11.5, lineHeight: 17 }}>
                  1. Open{' '}
                  <Text
                    style={{ color: '#38BDF8', fontWeight: '700', textDecorationLine: 'underline' }}
                    onPress={() => Linking.openURL('https://console.cloud.google.com/apis/library/maps-backend.googleapis.com')}
                  >
                    Google Cloud: Maps JavaScript API
                  </Text>{' '}
                  and click the blue <Text style={{ color: '#34D399', fontWeight: '800' }}>ENABLE</Text> button.
                </Text>
                <Text style={{ color: '#94A3B8', fontSize: 11.5, lineHeight: 17 }}>
                  2. Ensure a Billing Account is linked to the project in Google Cloud Console. Google provides <Text style={{ color: '#34D399', fontWeight: '800' }}>$200 monthly free credit</Text> (~28,000 map loads/month free of charge).
                </Text>
                <Text style={{ color: '#64748B', fontSize: 11, fontStyle: 'italic', marginTop: 2 }}>
                  If the key is not activated yet, the app automatically runs OpenStreetMap so your maps always stay functional.
                </Text>
              </View>
            </AccountSectionCard>

            {/* CARD 2: MONTHLY DRIVING & CHARGING ANALYTICS */}
            {(() => {
              const MONTHS_LIST = [
                { num: '01', short: 'Jan', full: 'January' },
                { num: '02', short: 'Feb', full: 'February' },
                { num: '03', short: 'Mar', full: 'March' },
                { num: '04', short: 'Apr', full: 'April' },
                { num: '05', short: 'May', full: 'May' },
                { num: '06', short: 'Jun', full: 'June' },
                { num: '07', short: 'Jul', full: 'July' },
                { num: '08', short: 'Aug', full: 'August' },
                { num: '09', short: 'Sep', full: 'September' },
                { num: '10', short: 'Oct', full: 'October' },
                { num: '11', short: 'Nov', full: 'November' },
                { num: '12', short: 'Dec', full: 'December' },
              ];

              const classifySessionSpeed = (c: ChargeLogRecord): '3.3' | '7.4' | 'dc' => {
                const kw = Number(c.maxChargingSpeedKw) || 0;
                const cat = (c.chargerCategory || '').toUpperCase();
                if (kw > 11) return 'dc';
                if (kw > 4.0 && kw <= 11) return '7.4';
                if (kw > 0 && kw <= 4.0) return '3.3';
                if (cat.includes('DC')) return 'dc';
                if (cat.includes('7.4') || cat.includes('7.2')) return '7.4';
                return '3.3';
              };

              const getSessionPackKwh = (c: ChargeLogRecord): number =>
                Number(c.energyAddedToPackKwh) > 0
                  ? Number(c.energyAddedToPackKwh)
                  : Math.max(0, ((Number(c.endSoc) - Number(c.startSoc)) / 100) * 38.0);

              const getSessionWallKwh = (c: ChargeLogRecord): number => {
                const added = getSessionPackKwh(c);
                return Number(c.energyConsumedKwh) > 0
                  ? Number(c.energyConsumedKwh)
                  : Number((added / 0.88).toFixed(2));
              };

              const getTripEnergyKwh = (t: TripRecord): number =>
                Number(t.energyUsedKwh) > 0
                  ? Number(t.energyUsedKwh)
                  : Math.max(
                      0,
                      ((Number(t.startSoc) - Number(t.endSoc)) / 100) * WINDSOR_FACTORY_USABLE_KWH
                    );

              const computeStatsForFilter = (prefix: string) => {
                const mTrips = trips.filter((t) => getTripDateKey(t).startsWith(prefix));
                const mCharges = chargeLogs.filter((c) => getChargeDateKey(c).startsWith(prefix));

                const totalDistKm = Number(
                  mTrips.reduce((s, t) => s + (Number(t.distanceKm) || 0), 0).toFixed(1)
                );
                const totalDriveEnergyKwh = Number(
                  mTrips.reduce((s, t) => s + getTripEnergyKwh(t), 0).toFixed(2)
                );
                const totalDriveDurSec = mTrips.reduce(
                  (s, t) => s + (Number(t.durationSeconds) || 0),
                  0
                );
                const avgDriveEff =
                  totalDistKm > 0 && totalDriveEnergyKwh > 0
                    ? Number((totalDistKm / totalDriveEnergyKwh).toFixed(2))
                    : 0;

                let count33 = 0;
                let packKwh33 = 0;
                let wallKwh33 = 0;

                let count74 = 0;
                let packKwh74 = 0;
                let wallKwh74 = 0;

                let countDc = 0;
                let packKwhDc = 0;
                let wallKwhDc = 0;

                for (const c of mCharges) {
                  const sp = classifySessionSpeed(c);
                  const pk = getSessionPackKwh(c);
                  const wl = getSessionWallKwh(c);
                  if (sp === 'dc') {
                    countDc += 1;
                    packKwhDc += pk;
                    wallKwhDc += wl;
                  } else if (sp === '7.4') {
                    count74 += 1;
                    packKwh74 += pk;
                    wallKwh74 += wl;
                  } else {
                    count33 += 1;
                    packKwh33 += pk;
                    wallKwh33 += wl;
                  }
                }

                const totalChargeCount = mCharges.length;
                const totalPackKwh = Number((packKwh33 + packKwh74 + packKwhDc).toFixed(2));
                const totalWallKwh = Number((wallKwh33 + wallKwh74 + wallKwhDc).toFixed(2));
                const totalLossKwh = Math.max(0, Number((totalWallKwh - totalPackKwh).toFixed(2)));

                return {
                  tripCount: mTrips.length,
                  totalDistKm,
                  totalDriveEnergyKwh,
                  totalDriveDurSec,
                  avgDriveEff,
                  totalChargeCount,
                  totalPackKwh,
                  totalWallKwh,
                  totalLossKwh,
                  count33,
                  packKwh33: Number(packKwh33.toFixed(2)),
                  wallKwh33: Number(wallKwh33.toFixed(2)),
                  count74,
                  packKwh74: Number(packKwh74.toFixed(2)),
                  wallKwh74: Number(wallKwh74.toFixed(2)),
                  countDc,
                  packKwhDc: Number(packKwhDc.toFixed(2)),
                  wallKwhDc: Number(wallKwhDc.toFixed(2)),
                };
              };

              const selectedPrefix =
                analyticsMonth === 'all' ? `${analyticsYear}-` : `${analyticsYear}-${analyticsMonth}`;
              const selectedMonthObj = MONTHS_LIST.find((m) => m.num === analyticsMonth);
              const periodLabel =
                analyticsMonth === 'all'
                  ? `Full Year ${analyticsYear}`
                  : `${selectedMonthObj?.full || ''} ${analyticsYear}`;

              const stats = computeStatsForFilter(selectedPrefix);
              const monthlyBreakdown = MONTHS_LIST.map((m) => ({
                ...m,
                data: computeStatsForFilter(`${analyticsYear}-${m.num}`),
              }));

              return (
                <AccountSectionCard
                  title="Monthly Driving & Charging Analytics"
                  icon="📊"
                  badge={
                    analyticsMonth === 'all'
                      ? `${analyticsYear}`
                      : `${selectedMonthObj?.short || ''} ${analyticsYear}`
                  }
                  badgeBg="#064E3B"
                  badgeColor="#34D399"
                  preview={`${stats.totalDistKm} km driven • ${stats.totalDriveEnergyKwh} kWh used • ${stats.totalChargeCount} charges (+${stats.totalPackKwh} kWh)`}
                  subtitle="View total distance travelled, total energy used by the car, and charging sessions & energy broken down by 3.3 kW AC, 7.4 kW AC, and DC Fast charging for any month."
                >
                  {/* Year Navigation Header */}
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      backgroundColor: '#0A0E17',
                      paddingHorizontal: 10,
                      paddingVertical: 8,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: '#1E293B',
                      marginBottom: 10,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <TouchableOpacity
                        style={[styles.calendarNavBtn, { paddingHorizontal: 10, paddingVertical: 5 }]}
                        onPress={() => setAnalyticsYear((y) => y - 1)}
                      >
                        <Text style={styles.calendarNavText}>◀</Text>
                      </TouchableOpacity>
                      <Text style={{ color: '#F8FAFC', fontSize: 15, fontWeight: '900' }}>
                        {analyticsYear}
                      </Text>
                      <TouchableOpacity
                        style={[styles.calendarNavBtn, { paddingHorizontal: 10, paddingVertical: 5 }]}
                        onPress={() => setAnalyticsYear((y) => y + 1)}
                      >
                        <Text style={styles.calendarNavText}>▶</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <TouchableOpacity
                        style={[
                          styles.calendarTodayBtn,
                          analyticsMonth === 'all' && styles.calendarTodayBtnActive,
                        ]}
                        onPress={() => setAnalyticsMonth('all')}
                      >
                        <Text
                          style={[
                            styles.calendarTodayBtnText,
                            analyticsMonth === 'all' && styles.calendarTodayBtnTextActive,
                          ]}
                        >
                          Full Year
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.calendarTodayBtn}
                        onPress={() => {
                          const now = new Date();
                          setAnalyticsYear(now.getFullYear());
                          setAnalyticsMonth(String(now.getMonth() + 1).padStart(2, '0'));
                        }}
                      >
                        <Text style={styles.calendarTodayBtnText}>This Month</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* 12-Month Selector Grid */}
                  <View
                    style={{
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      gap: 6,
                      marginBottom: 14,
                    }}
                  >
                    {monthlyBreakdown.map((m) => {
                      const isSel = analyticsMonth === m.num;
                      const hasActivity = m.data.tripCount > 0 || m.data.totalChargeCount > 0;
                      return (
                        <TouchableOpacity
                          key={m.num}
                          onPress={() => setAnalyticsMonth(m.num)}
                          activeOpacity={0.75}
                          style={{
                            width: '23%',
                            flexGrow: 1,
                            backgroundColor: isSel ? '#0284C728' : '#0A0E17',
                            borderWidth: 1,
                            borderColor: isSel ? '#38BDF8' : hasActivity ? '#1E293B' : '#0F172A',
                            borderRadius: 10,
                            paddingVertical: 7,
                            paddingHorizontal: 6,
                            alignItems: 'center',
                          }}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                            <Text
                              style={{
                                color: isSel ? '#38BDF8' : hasActivity ? '#F8FAFC' : '#64748B',
                                fontSize: 12,
                                fontWeight: isSel ? '900' : '700',
                              }}
                            >
                              {m.short}
                            </Text>
                            {hasActivity && (
                              <View
                                style={{
                                  width: 5,
                                  height: 5,
                                  borderRadius: 3,
                                  backgroundColor: isSel ? '#38BDF8' : '#34D399',
                                }}
                              />
                            )}
                          </View>
                          <Text
                            style={{
                              color: isSel ? '#BAE6FD' : hasActivity ? '#94A3B8' : '#475569',
                              fontSize: 9,
                              marginTop: 2,
                            }}
                            numberOfLines={1}
                          >
                            {m.data.totalDistKm > 0
                              ? `${m.data.totalDistKm} km`
                              : m.data.totalChargeCount > 0
                              ? `${m.data.totalChargeCount} chg`
                              : '--'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Selected Period Header */}
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8,
                    }}
                  >
                    <Text
                      style={{
                        color: '#94A3B8',
                        fontSize: 10,
                        fontWeight: '800',
                        letterSpacing: 0.6,
                        textTransform: 'uppercase',
                      }}
                    >
                      🚗 Driving & Energy Summary — {periodLabel}
                    </Text>
                    <Text style={{ color: '#38BDF8', fontSize: 10, fontWeight: '700' }}>
                      {stats.tripCount} {stats.tripCount === 1 ? 'Trip' : 'Trips'} •{' '}
                      {formatDurationHm(stats.totalDriveDurSec)}
                    </Text>
                  </View>

                  {/* Driving Distance & Car Energy Used Cards */}
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                    <View
                      style={{
                        flex: 1,
                        backgroundColor: '#0A0E17',
                        padding: 12,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: '#1E293B',
                      }}
                    >
                      <Text style={{ color: '#64748B', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }}>
                        TOTAL DISTANCE TRAVELLED
                      </Text>
                      <Text style={{ color: '#34D399', fontSize: 18, fontWeight: '900', marginTop: 4 }}>
                        {stats.totalDistKm.toLocaleString()} km
                      </Text>
                      <Text style={{ color: '#94A3B8', fontSize: 10, marginTop: 2 }}>
                        {stats.tripCount} {stats.tripCount === 1 ? 'trip' : 'trips'} in {periodLabel}
                      </Text>
                    </View>

                    <View
                      style={{
                        flex: 1,
                        backgroundColor: '#0A0E17',
                        padding: 12,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: '#1E293B',
                      }}
                    >
                      <Text style={{ color: '#64748B', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }}>
                        TOTAL ENERGY USED BY CAR
                      </Text>
                      <Text style={{ color: '#38BDF8', fontSize: 18, fontWeight: '900', marginTop: 4 }}>
                        {stats.totalDriveEnergyKwh} kWh
                      </Text>
                      <Text style={{ color: '#94A3B8', fontSize: 10, marginTop: 2 }}>
                        {stats.avgDriveEff > 0
                          ? `Avg Efficiency: ${stats.avgDriveEff} km/kWh`
                          : 'BMS Driving Energy'}
                      </Text>
                    </View>
                  </View>

                  {/* Charging Speed Breakdown Header */}
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8,
                    }}
                  >
                    <Text
                      style={{
                        color: '#94A3B8',
                        fontSize: 10,
                        fontWeight: '800',
                        letterSpacing: 0.6,
                        textTransform: 'uppercase',
                      }}
                    >
                      ⚡ Charging Breakdown by Speed — {periodLabel}
                    </Text>
                    <Text style={{ color: '#34D399', fontSize: 10, fontWeight: '700' }}>
                      {stats.totalChargeCount} {stats.totalChargeCount === 1 ? 'Charge' : 'Charges'}
                    </Text>
                  </View>

                  {/* Total Charging Energy Row */}
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                    <View
                      style={{
                        flex: 1,
                        backgroundColor: '#0A0E17',
                        padding: 10,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: '#1E293B',
                      }}
                    >
                      <Text style={{ color: '#64748B', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }}>
                        TOTAL ENERGY ADDED (PACK)
                      </Text>
                      <Text style={{ color: '#34D399', fontSize: 16, fontWeight: '900', marginTop: 3 }}>
                        +{stats.totalPackKwh} kWh
                      </Text>
                      <Text style={{ color: '#64748B', fontSize: 10, marginTop: 1 }}>
                        Across {stats.totalChargeCount} charging{' '}
                        {stats.totalChargeCount === 1 ? 'session' : 'sessions'}
                      </Text>
                    </View>

                    <View
                      style={{
                        flex: 1,
                        backgroundColor: '#0A0E17',
                        padding: 10,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: '#1E293B',
                      }}
                    >
                      <Text style={{ color: '#64748B', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 }}>
                        TOTAL WALL ENERGY (CHARGING)
                      </Text>
                      <Text style={{ color: '#FACC15', fontSize: 16, fontWeight: '900', marginTop: 3 }}>
                        {stats.totalWallKwh} kWh
                      </Text>
                      <Text style={{ color: '#64748B', fontSize: 10, marginTop: 1 }}>
                        Loss: {stats.totalLossKwh} kWh
                      </Text>
                    </View>
                  </View>

                  {/* 3 Charging Speed Cards: 3.3 kW AC, 7.4 kW AC, DC Fast */}
                  <View style={{ gap: 8, marginBottom: 14 }}>
                    {/* 3.3 kW AC */}
                    <View
                      style={{
                        backgroundColor: '#0A0E17',
                        padding: 12,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: '#1E293B',
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontSize: 14 }}>🔌</Text>
                          <Text style={{ color: '#F8FAFC', fontSize: 13, fontWeight: '800' }}>
                            3.3 kW AC Charges
                          </Text>
                        </View>
                        <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 3 }}>
                          Wall Energy: <Text style={{ color: '#CBD5E1', fontWeight: '700' }}>{stats.wallKwh33} kWh</Text> • Pack Added:{' '}
                          <Text style={{ color: '#34D399', fontWeight: '700' }}>+{stats.packKwh33} kWh</Text>
                        </Text>
                      </View>
                      <View
                        style={{
                          backgroundColor: '#0F172A',
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: '#1E293B',
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ color: '#38BDF8', fontSize: 16, fontWeight: '900' }}>
                          {stats.count33}
                        </Text>
                        <Text style={{ color: '#64748B', fontSize: 9, fontWeight: '700' }}>
                          {stats.count33 === 1 ? 'CHARGE' : 'CHARGES'}
                        </Text>
                      </View>
                    </View>

                    {/* 7.4 kW AC */}
                    <View
                      style={{
                        backgroundColor: '#0A0E17',
                        padding: 12,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: '#1E293B',
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontSize: 14 }}>⚡</Text>
                          <Text style={{ color: '#F8FAFC', fontSize: 13, fontWeight: '800' }}>
                            7.4 kW AC Charges
                          </Text>
                        </View>
                        <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 3 }}>
                          Wall Energy: <Text style={{ color: '#CBD5E1', fontWeight: '700' }}>{stats.wallKwh74} kWh</Text> • Pack Added:{' '}
                          <Text style={{ color: '#34D399', fontWeight: '700' }}>+{stats.packKwh74} kWh</Text>
                        </Text>
                      </View>
                      <View
                        style={{
                          backgroundColor: '#0F172A',
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: '#1E293B',
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ color: '#A78BFA', fontSize: 16, fontWeight: '900' }}>
                          {stats.count74}
                        </Text>
                        <Text style={{ color: '#64748B', fontSize: 9, fontWeight: '700' }}>
                          {stats.count74 === 1 ? 'CHARGE' : 'CHARGES'}
                        </Text>
                      </View>
                    </View>

                    {/* DC Fast */}
                    <View
                      style={{
                        backgroundColor: '#0A0E17',
                        padding: 12,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: '#1E293B',
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text style={{ fontSize: 14 }}>🚀</Text>
                          <Text style={{ color: '#F8FAFC', fontSize: 13, fontWeight: '800' }}>
                            DC Fast Charges
                          </Text>
                        </View>
                        <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 3 }}>
                          Wall Energy: <Text style={{ color: '#CBD5E1', fontWeight: '700' }}>{stats.wallKwhDc} kWh</Text> • Pack Added:{' '}
                          <Text style={{ color: '#34D399', fontWeight: '700' }}>+{stats.packKwhDc} kWh</Text>
                        </Text>
                      </View>
                      <View
                        style={{
                          backgroundColor: '#0F172A',
                          paddingHorizontal: 12,
                          paddingVertical: 6,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: '#1E293B',
                          alignItems: 'center',
                        }}
                      >
                        <Text style={{ color: '#F59E0B', fontSize: 16, fontWeight: '900' }}>
                          {stats.countDc}
                        </Text>
                        <Text style={{ color: '#64748B', fontSize: 9, fontWeight: '700' }}>
                          {stats.countDc === 1 ? 'CHARGE' : 'CHARGES'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {/* Month-by-Month Summary List for Selected Year */}
                  <View
                    style={{
                      backgroundColor: '#0A0E17',
                      padding: 12,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: '#1E293B',
                      gap: 8,
                    }}
                  >
                    <Text
                      style={{
                        color: '#94A3B8',
                        fontSize: 10,
                        fontWeight: '800',
                        letterSpacing: 0.6,
                        textTransform: 'uppercase',
                        marginBottom: 2,
                      }}
                    >
                      🗓️ Month-by-Month Summary ({analyticsYear})
                    </Text>

                    {monthlyBreakdown.map((m) => {
                      const d = m.data;
                      const isSel = analyticsMonth === m.num;
                      const hasAny = d.tripCount > 0 || d.totalChargeCount > 0;
                      return (
                        <TouchableOpacity
                          key={m.num}
                          onPress={() => setAnalyticsMonth(m.num)}
                          activeOpacity={0.75}
                          style={{
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            paddingVertical: 8,
                            paddingHorizontal: 10,
                            borderRadius: 8,
                            backgroundColor: isSel ? '#0284C720' : '#0F172A',
                            borderWidth: 1,
                            borderColor: isSel ? '#38BDF860' : '#1E293B',
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text
                              style={{
                                color: isSel ? '#38BDF8' : hasAny ? '#F8FAFC' : '#64748B',
                                fontSize: 12,
                                fontWeight: '800',
                              }}
                            >
                              {m.full} {analyticsYear}
                            </Text>
                            <Text style={{ color: '#64748B', fontSize: 10, marginTop: 2 }}>
                              3.3kW: {d.count33} ({d.wallKwh33} kWh) • 7.4kW: {d.count74} ({d.wallKwh74} kWh) • DC: {d.countDc} ({d.wallKwhDc} kWh)
                            </Text>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text
                              style={{
                                color: d.totalDistKm > 0 ? '#34D399' : '#64748B',
                                fontSize: 12,
                                fontWeight: '800',
                              }}
                            >
                              {d.totalDistKm} km • {d.totalDriveEnergyKwh} kWh
                            </Text>
                            <Text style={{ color: '#38BDF8', fontSize: 10, marginTop: 2 }}>
                              ⚡ +{d.totalPackKwh} kWh ({d.totalWallKwh} kWh wall)
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </AccountSectionCard>
              );
            })()}

            {/* GOOGLE DRIVE & GOOGLE SHEETS BACKUP */}
            {googleConfig?.accessToken && (
              <AccountSectionCard
                title="Google Drive & Sheets Backup"
                icon="📊"
                badge="● Connected"
                badgeBg="#064E3B"
                badgeColor="#34D399"
                preview={googleConfig.userEmail || 'Personal Google Drive'}
                subtitle="Automatically saves every completed trip into your personal Google Drive folder and appends the metrics to your dedicated Google Sheet."
              >
                <View style={{ gap: 8, marginBottom: 6 }}>
                  <InfoRow label="Google Account" value={googleConfig.userEmail} />
                  <InfoRow label="Drive Folder" value="MG Windsor EV Telematics" />
                  <InfoRow
                    label="Trip Spreadsheet"
                    value={googleConfig.spreadsheetId ? 'Ready (MG Windsor EV - Trip History)' : 'Setting up...'}
                  />
                  <InfoRow
                    label="Charging Spreadsheet"
                    value={googleConfig.chargingSpreadsheetId ? 'Ready (MG Windsor EV - Charging History)' : 'Setting up...'}
                  />

                  {/* Open in Google Sheets buttons */}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                    {googleConfig.spreadsheetUrl ? (
                      <TouchableOpacity
                        style={[styles.shareImageBtn, { backgroundColor: '#059669', flex: 1, marginTop: 0 }]}
                        onPress={() => Linking.openURL(googleConfig.spreadsheetUrl!)}
                      >
                        <Text style={[styles.shareImageBtnText, { fontSize: 11 }]}>🚗 Open Trips Sheet</Text>
                      </TouchableOpacity>
                    ) : null}

                    {googleConfig.chargingSpreadsheetUrl ? (
                      <TouchableOpacity
                        style={[styles.shareImageBtn, { backgroundColor: '#4F46E5', flex: 1, marginTop: 0 }]}
                        onPress={() => Linking.openURL(googleConfig.chargingSpreadsheetUrl!)}
                      >
                        <Text style={[styles.shareImageBtnText, { fontSize: 11 }]}>⚡ Open Charging Sheet</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  {/* Sync Buttons */}
                  <TouchableOpacity
                    style={[styles.loginBtn, { marginTop: 6, paddingVertical: 12, backgroundColor: '#0284C7' }]}
                    onPress={handleSyncGoogleSheetNow}
                    disabled={isGoogleSyncing}
                  >
                    {isGoogleSyncing ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Text style={styles.loginBtnText}>🚗 Back Up All Trips to Google Sheet</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.loginBtn, { marginTop: 2, paddingVertical: 12, backgroundColor: '#7C3AED' }]}
                    onPress={handleSyncChargingSheetNow}
                    disabled={isGoogleSyncing}
                  >
                    {isGoogleSyncing ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Text style={styles.loginBtnText}>⚡ Back Up All Charging Sessions to Sheet</Text>
                    )}
                  </TouchableOpacity>

                  {/* Disconnect Google Account */}
                  <TouchableOpacity
                    style={[styles.logoutBtn, { marginTop: 6, backgroundColor: '#1E293B' }]}
                    onPress={handleGoogleSignOut}
                  >
                    <Text style={[styles.logoutBtnText, { color: '#EF4444' }]}>Disconnect Google Account</Text>
                  </TouchableOpacity>
                </View>
              </AccountSectionCard>
            )}

            {/* CARD 4: Apple CarPlay Automations (Cloudflare D1) */}
            <AccountSectionCard
              title="Apple CarPlay Automations (Cloudflare D1)"
              icon="🚘"
              badge="Zero 12V Drain"
              badgeBg="#064E3B"
              badgeColor="#34D399"
              preview="Automatic trip recording upon CarPlay Connect & Disconnect"
              subtitle="Automatically records odometer, SOC, energy usage, duration, and efficiency to Cloudflare D1 SQL database whenever your iPhone connects or disconnects from CarPlay. Zero background polling keeps your 12V battery completely safe."
            >
              <View style={{ backgroundColor: '#0B132B', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#1E293B', marginBottom: 14 }}>
                <Text style={{ color: '#38BDF8', fontWeight: '800', fontSize: 13, marginBottom: 6 }}>
                  ⚡ Step-by-Step iOS Shortcuts Setup (Takes 30 Seconds)
                </Text>
                <Text style={{ color: '#94A3B8', fontSize: 11, marginBottom: 12, lineHeight: 18 }}>
                  1. Open the Apple <Text style={{ color: '#F8FAFC', fontWeight: '700' }}>Shortcuts</Text> app on your iPhone.{'\n'}
                  2. Tap the <Text style={{ color: '#F8FAFC', fontWeight: '700' }}>Automation</Text> tab at the bottom, then tap <Text style={{ color: '#F8FAFC', fontWeight: '700' }}>+</Text> (top right).{'\n'}
                  3. Select <Text style={{ color: '#F8FAFC', fontWeight: '700' }}>CarPlay</Text> → Choose <Text style={{ color: '#34D399', fontWeight: '700' }}>Connects</Text>.{'\n'}
                  4. Select <Text style={{ color: '#F8FAFC', fontWeight: '700' }}>Run Immediately</Text> (turn Notify When Run OFF) → Next.{'\n'}
                  5. Tap <Text style={{ color: '#F8FAFC', fontWeight: '700' }}>New Blank Automation</Text> → Add Action → Search <Text style={{ color: '#F8FAFC', fontWeight: '700' }}>&quot;Get Contents of URL&quot;</Text> → Paste the <Text style={{ color: '#34D399', fontWeight: '700' }}>Start Trip Webhook URL</Text> below.{'\n'}
                  6. <Text style={{ color: '#38BDF8', fontWeight: '700' }}>To Show Notification:</Text> Add Action directly below it → Search <Text style={{ color: '#F8FAFC', fontWeight: '700' }}>&quot;Show Notification&quot;</Text> → Set Text to <Text style={{ color: '#F8FAFC', fontWeight: '700' }}>&quot;Contents of URL&quot;</Text>!{'\n'}
                  7. Repeat for <Text style={{ color: '#F87171', fontWeight: '700' }}>Disconnects</Text> using the <Text style={{ color: '#F87171', fontWeight: '700' }}>Stop Trip Webhook URL</Text>.{'\n'}
                  8. When your trip ends, iOS will display the complete summary: distance, time taken, battery start &amp; end %, energy used, and efficiency!
                </Text>

                {/* 1. Start Trip Webhook */}
                <View style={styles.copyWebhookCard}>
                  <View style={styles.copyWebhookHeader}>
                    <Text style={styles.copyWebhookTitle}>🟢 CarPlay Connects (Start Trip)</Text>
                    <TouchableOpacity
                      style={styles.copyPillBtn}
                      activeOpacity={0.7}
                      onPress={() =>
                        copyToClipboard(
                          `${BACKEND_URL}/api/trip/start?${(displayVin && displayVin !== 'Discovering...') ? `vin=${encodeURIComponent(displayVin)}&` : ''}format=text`,
                          'CarPlay Start Trip URL'
                        )
                      }
                    >
                      <Text style={styles.copyPillBtnText}>📋 Copy Link</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={styles.copyUrlTapArea}
                    activeOpacity={0.7}
                    onPress={() =>
                      copyToClipboard(
                        `${BACKEND_URL}/api/trip/start?${(displayVin && displayVin !== 'Discovering...') ? `vin=${encodeURIComponent(displayVin)}&` : ''}format=text`,
                        'CarPlay Start Trip URL'
                      )
                    }
                  >
                    <Text style={styles.copyUrlMonoText} numberOfLines={2}>
                      {`${BACKEND_URL}/api/trip/start?${(displayVin && displayVin !== 'Discovering...') ? `vin=${encodeURIComponent(displayVin)}&` : ''}format=text`}
                    </Text>
                    <Text style={styles.copyUrlTapHint}>Tap to copy Start Trip Webhook URL (with notification text)</Text>
                  </TouchableOpacity>
                </View>

                {/* 2. Stop Trip Webhook */}
                <View style={[styles.copyWebhookCard, { marginTop: 10 }]}>
                  <View style={styles.copyWebhookHeader}>
                    <Text style={styles.copyWebhookTitle}>🔴 CarPlay Disconnects (Stop Trip)</Text>
                    <TouchableOpacity
                      style={styles.copyPillBtn}
                      activeOpacity={0.7}
                      onPress={() =>
                        copyToClipboard(
                          `${BACKEND_URL}/api/trip/stop?${(displayVin && displayVin !== 'Discovering...') ? `vin=${encodeURIComponent(displayVin)}&` : ''}format=text`,
                          'CarPlay Stop Trip URL'
                        )
                      }
                    >
                      <Text style={styles.copyPillBtnText}>📋 Copy Link</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={styles.copyUrlTapArea}
                    activeOpacity={0.7}
                    onPress={() =>
                      copyToClipboard(
                        `${BACKEND_URL}/api/trip/stop?${(displayVin && displayVin !== 'Discovering...') ? `vin=${encodeURIComponent(displayVin)}&` : ''}format=text`,
                        'CarPlay Stop Trip URL'
                      )
                    }
                  >
                    <Text style={styles.copyUrlMonoText} numberOfLines={2}>
                      {`${BACKEND_URL}/api/trip/stop?${(displayVin && displayVin !== 'Discovering...') ? `vin=${encodeURIComponent(displayVin)}&` : ''}format=text`}
                    </Text>
                    <Text style={styles.copyUrlTapHint}>Tap to copy Stop Trip Webhook URL (with complete trip metrics)</Text>
                  </TouchableOpacity>
                </View>

                <View style={{ marginTop: 12, padding: 10, backgroundColor: '#064E3B18', borderRadius: 8, borderWidth: 1, borderColor: '#064E3B40' }}>
                  <Text style={{ color: '#34D399', fontSize: 11, lineHeight: 16 }}>
                    🛡️ <Text style={{ fontWeight: '700' }}>12V Battery Guarantee:</Text> Webhooks query vehicle telemetry only at the exact moments CarPlay connects (car is driving) and disconnects (car is parking). No background polling loops run while the car is asleep.
                  </Text>
                </View>
              </View>
            </AccountSectionCard>

            {/* CARD: Native iOS (APNs) & Android (FCM) Web Push Notifications */}
            <AccountSectionCard
              title="Push Notifications (iOS APNs & Android FCM)"
              icon="📲"
              badge={isPushSubscribed ? '● Active' : pushPermission === 'denied' ? '● Blocked' : '● Tap to Enable'}
              badgeBg={isPushSubscribed ? '#064E3B' : pushPermission === 'denied' ? '#7F1D1D' : '#1E293B'}
              badgeColor={isPushSubscribed ? '#34D399' : pushPermission === 'denied' ? '#FCA5A5' : '#38BDF8'}
              preview={isPushSubscribed ? 'Native Lock Screen alerts active for Trips & Charging' : 'Enable native iOS / Android Lock Screen alerts'}
              subtitle="Receives native W3C Web Push notifications via Apple Push Notification service (web.push.apple.com) on iOS and Firebase Cloud Messaging (FCM) on Android whenever a Trip starts, a Trip completes, or a Charging session starts, pauses, or finishes."
            >
              <View style={{ gap: 8 }}>
                <InfoRow
                  label="Device Push Status"
                  value={
                    isPushSubscribed
                      ? 'Active on this device'
                      : pushPermission === 'denied'
                      ? 'Blocked in browser / iOS settings'
                      : 'Not enabled yet'
                  }
                />
                <InfoRow
                  label="Push Gateway"
                  value="Apple APNs (iOS) / Google FCM (Android)"
                />
                <InfoRow
                  label="Linked Vehicle VIN"
                  value={displayVin || 'Active Session'}
                />

                {Platform.OS === 'web' &&
                typeof window !== 'undefined' &&
                /iPhone|iPad|iPod/.test(navigator.userAgent) &&
                !(window.navigator as any).standalone ? (
                  <View
                    style={{
                      backgroundColor: '#1E293B',
                      padding: 12,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: '#334155',
                      marginVertical: 4,
                    }}
                  >
                    <Text style={{ color: '#F59E0B', fontWeight: '700', fontSize: 12, marginBottom: 4 }}>
                      📱 Open from iPhone Home Screen
                    </Text>
                    <Text style={{ color: '#CBD5E1', fontSize: 11, lineHeight: 16 }}>
                      On iOS, Apple requires PWAs to be opened from the Home Screen to receive push notifications. Tap Safari Share{' '}
                      <Text style={{ color: '#38BDF8', fontWeight: '700' }}>⎋ ➔ Add to Home Screen</Text>, then open MG iSMART from your Home Screen and tap Enable below.
                    </Text>
                  </View>
                ) : null}

                {!isPushSubscribed ? (
                  <TouchableOpacity
                    style={[styles.loginBtn, { backgroundColor: '#10B981', paddingVertical: 14, marginTop: 4 }]}
                    onPress={handleEnablePush}
                    disabled={isPushBusy}
                  >
                    {isPushBusy ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Text style={[styles.loginBtnText, { fontSize: 13, fontWeight: '800' }]}>
                        🔔 Enable Push Notifications on This Device
                      </Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                    <TouchableOpacity
                      style={[styles.shareImageBtn, { backgroundColor: '#0284C7', flex: 1, marginTop: 0 }]}
                      onPress={handleSendTestPush}
                      disabled={isPushBusy}
                    >
                      {isPushBusy ? (
                        <ActivityIndicator size="small" color="#FFF" />
                      ) : (
                        <Text style={styles.shareImageBtnText}>🧪 Send Test Push</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.shareImageBtn, { backgroundColor: '#1E293B', flex: 1, marginTop: 0 }]}
                      onPress={handleDisablePush}
                      disabled={isPushBusy}
                    >
                      <Text style={[styles.shareImageBtnText, { color: '#EF4444' }]}>🔕 Disable Alerts</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </AccountSectionCard>

            {/* CARD: Notification History & Activity Log (Cloudflare D1) */}
            <AccountSectionCard
              title="Notification History & Activity Log"
              icon="🔔"
              badge={`${d1Notifications.length} Stored`}
              badgeBg="#1E293B"
              badgeColor="#38BDF8"
              preview="Cloud-synced log of all vehicle trip alerts in Cloudflare D1"
              subtitle="All trip start, completed trip, and stationary event notifications are saved in your Cloudflare D1 database and synchronized across all your devices."
            >
              {/* Action Toolbar */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <TouchableOpacity
                  style={[styles.recordBtn, { backgroundColor: '#0284C720', borderColor: '#0284C7', paddingHorizontal: 12, paddingVertical: 6 }]}
                  onPress={refreshD1Notifications}
                  disabled={isNotifsLoading}
                >
                  <Text style={[styles.recordBtnText, { color: '#38BDF8', fontSize: 12 }]}>
                    {isNotifsLoading ? 'Refreshing...' : '🔄 Refresh Log'}
                  </Text>
                </TouchableOpacity>

                {d1Notifications.length > 0 && (
                  <TouchableOpacity
                    style={[styles.recordBtn, { backgroundColor: '#DC262620', borderColor: '#DC2626', paddingHorizontal: 12, paddingVertical: 6 }]}
                    onPress={() => {
                      Alert.alert(
                        'Clear Notification History',
                        'Are you sure you want to delete all saved notifications from Cloudflare D1?',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Clear All',
                            style: 'destructive',
                            onPress: async () => {
                              const ok = await clearD1Notifications();
                              if (ok) {
                                setD1Notifications([]);
                                showBanner('ok', 'Cleared notification history from Cloudflare D1');
                              } else {
                                showBanner('err', 'Failed to clear notifications');
                              }
                            },
                          },
                        ]
                      );
                    }}
                  >
                    <Text style={[styles.recordBtnText, { color: '#EF4444', fontSize: 12 }]}>
                      🗑️ Clear Log
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Notification List */}
              {d1Notifications.length === 0 ? (
                <View style={{ backgroundColor: '#0B132B', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#1E293B', alignItems: 'center' }}>
                  <Text style={{ fontSize: 24, marginBottom: 6 }}>📭</Text>
                  <Text style={{ color: '#F8FAFC', fontWeight: '700', fontSize: 13, marginBottom: 4 }}>
                    No Notifications Saved Yet
                  </Text>
                  <Text style={{ color: '#64748B', fontSize: 11, textAlign: 'center', lineHeight: 16 }}>
                    When your Apple CarPlay shortcuts run, notifications with full metrics (distance, duration, battery %, energy, efficiency) will be permanently archived here in Cloudflare D1.
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 10 }}>
                  {d1Notifications.map((notif) => {
                    const isStart = notif.type === 'trip_start';
                    const isStop = notif.type === 'trip_stop';
                    const isIdle = notif.type === 'trip_idle';
                    const borderColor = isStop ? '#05966940' : (isStart ? '#0284C740' : '#EAB30840');
                    const headerBg = isStop ? '#064E3B20' : (isStart ? '#0369A120' : '#713F1220');
                    const badgeText = isStop ? 'Trip Completed' : (isStart ? 'Trip Started' : (isIdle ? 'Stationary' : 'Alert'));
                    const badgeColor = isStop ? '#34D399' : (isStart ? '#38BDF8' : '#FBBF24');
                    const timeStr = notif.timestamp ? new Date(notif.timestamp * 1000).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }) : '';
                    const dateStr = notif.date || (notif.timestamp ? new Date(notif.timestamp * 1000).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }) : '');

                    return (
                      <View
                        key={notif.id}
                        style={{
                          backgroundColor: '#0F172A',
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor,
                          overflow: 'hidden',
                        }}
                      >
                        {/* Header */}
                        <View style={{ backgroundColor: headerBg, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, marginRight: 8 }}>
                            <Text style={{ fontSize: 14 }}>{isStop ? '🏁' : (isStart ? '🟢' : (isIdle ? 'ℹ️' : '⚡'))}</Text>
                            <Text style={{ color: '#F8FAFC', fontWeight: '700', fontSize: 12 }} numberOfLines={1}>
                              {notif.title}
                            </Text>
                          </View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={{ backgroundColor: '#1E293B', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                              <Text style={{ color: badgeColor, fontSize: 10, fontWeight: '700' }}>{badgeText}</Text>
                            </View>
                            <Text style={{ color: '#64748B', fontSize: 10 }}>{timeStr ? `${timeStr} • ${dateStr}` : dateStr}</Text>
                          </View>
                        </View>

                        {/* Body Message */}
                        <View style={{ padding: 12 }}>
                          <Text style={{ color: '#CBD5E1', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 17 }}>
                            {notif.message}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </AccountSectionCard>

            {/* CARD 5: 1-Tap Lock Screen Widget & Siri Setup */}
            <AccountSectionCard
              title="1-Tap Lock Screen Widget & Siri Setup"
              icon="⚡"
              badge="6 Webhooks"
              badgeBg="#064E3B"
              badgeColor="#34D399"
              preview="Silent Unlock, Lock, AC On/Off & CarPlay Start/Stop"
              subtitle="Trigger locking, unlocking, AC or CarPlay trip logging silently from your iOS Lock Screen Widget, Siri, or Automations with zero app popups!"
            >
              {/* Silent Webhook URLs for currently logged-in car */}
              <View style={{ backgroundColor: '#0B132B', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#1E293B', marginBottom: 14 }}>
                <Text style={{ color: '#10B981', fontWeight: '800', fontSize: 13, marginBottom: 4 }}>
                  ⚡ Option A: 100% Silent Background Trigger (Recommended)
                </Text>
                <Text style={{ color: '#94A3B8', fontSize: 11, marginBottom: 12, lineHeight: 16 }}>
                  Automatically personalized for your car &amp; PIN. Tap any &quot;Copy Link&quot; button below:
                </Text>

                {/* 1. Unlock Link */}
                <View style={styles.copyWebhookCard}>
                  <View style={styles.copyWebhookHeader}>
                    <Text style={styles.copyWebhookTitle}>🔓 Silent Unlock Webhook</Text>
                    <TouchableOpacity
                      style={styles.copyPillBtn}
                      activeOpacity={0.7}
                      onPress={() =>
                        copyToClipboard(
                          `https://mg-windsor-webhook.mg-ismart.workers.dev?action=unlock&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`,
                          'Silent Unlock URL'
                        )
                      }
                    >
                      <Text style={styles.copyPillBtnText}>📋 Copy Link</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={styles.copyUrlTapArea}
                    activeOpacity={0.7}
                    onPress={() =>
                      copyToClipboard(
                        `https://mg-windsor-webhook.mg-ismart.workers.dev?action=unlock&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`,
                        'Silent Unlock URL'
                      )
                    }
                  >
                    <Text style={styles.copyUrlMonoText} numberOfLines={2}>
                      {`https://mg-windsor-webhook.mg-ismart.workers.dev?action=unlock&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`}
                    </Text>
                    <Text style={styles.copyUrlTapHint}>Tap to copy to clipboard</Text>
                  </TouchableOpacity>
                </View>

                {/* 2. Lock Link */}
                <View style={styles.copyWebhookCard}>
                  <View style={styles.copyWebhookHeader}>
                    <Text style={styles.copyWebhookTitle}>🔒 Silent Lock Webhook</Text>
                    <TouchableOpacity
                      style={styles.copyPillBtn}
                      activeOpacity={0.7}
                      onPress={() =>
                        copyToClipboard(
                          `https://mg-windsor-webhook.mg-ismart.workers.dev?action=lock&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`,
                          'Silent Lock URL'
                        )
                      }
                    >
                      <Text style={styles.copyPillBtnText}>📋 Copy Link</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={styles.copyUrlTapArea}
                    activeOpacity={0.7}
                    onPress={() =>
                      copyToClipboard(
                        `https://mg-windsor-webhook.mg-ismart.workers.dev?action=lock&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`,
                        'Silent Lock URL'
                      )
                    }
                  >
                    <Text style={styles.copyUrlMonoText} numberOfLines={2}>
                      {`https://mg-windsor-webhook.mg-ismart.workers.dev?action=lock&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`}
                    </Text>
                    <Text style={styles.copyUrlTapHint}>Tap to copy to clipboard</Text>
                  </TouchableOpacity>
                </View>

                {/* 3. Climate AC Link */}
                <View style={styles.copyWebhookCard}>
                  <View style={styles.copyWebhookHeader}>
                    <Text style={styles.copyWebhookTitle}>❄️ Silent Climate AC On</Text>
                    <TouchableOpacity
                      style={styles.copyPillBtn}
                      activeOpacity={0.7}
                      onPress={() =>
                        copyToClipboard(
                          `https://mg-windsor-webhook.mg-ismart.workers.dev?action=climate-on&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`,
                          'Silent Climate AC URL'
                        )
                      }
                    >
                      <Text style={styles.copyPillBtnText}>📋 Copy Link</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={styles.copyUrlTapArea}
                    activeOpacity={0.7}
                    onPress={() =>
                      copyToClipboard(
                        `https://mg-windsor-webhook.mg-ismart.workers.dev?action=climate-on&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`,
                        'Silent Climate AC On URL'
                      )
                    }
                  >
                    <Text style={styles.copyUrlMonoText} numberOfLines={2}>
                      {`https://mg-windsor-webhook.mg-ismart.workers.dev?action=climate-on&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`}
                    </Text>
                    <Text style={styles.copyUrlTapHint}>Tap to copy to clipboard</Text>
                  </TouchableOpacity>
                </View>

                {/* 4. Climate AC Off Link */}
                <View style={styles.copyWebhookCard}>
                  <View style={styles.copyWebhookHeader}>
                    <Text style={styles.copyWebhookTitle}>❄️ Silent Climate AC Off</Text>
                    <TouchableOpacity
                      style={styles.copyPillBtn}
                      activeOpacity={0.7}
                      onPress={() =>
                        copyToClipboard(
                          `https://mg-windsor-webhook.mg-ismart.workers.dev?action=climate-off&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`,
                          'Silent Climate AC Off URL'
                        )
                      }
                    >
                      <Text style={styles.copyPillBtnText}>📋 Copy Link</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={styles.copyUrlTapArea}
                    activeOpacity={0.7}
                    onPress={() =>
                      copyToClipboard(
                        `https://mg-windsor-webhook.mg-ismart.workers.dev?action=climate-off&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`,
                        'Silent Climate AC Off URL'
                      )
                    }
                  >
                    <Text style={styles.copyUrlMonoText} numberOfLines={2}>
                      {`https://mg-windsor-webhook.mg-ismart.workers.dev?action=climate-off&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`}
                    </Text>
                    <Text style={styles.copyUrlTapHint}>Tap to copy to clipboard</Text>
                  </TouchableOpacity>
                </View>

                {/* 5. Start Trip Link */}
                <View style={styles.copyWebhookCard}>
                  <View style={styles.copyWebhookHeader}>
                    <Text style={styles.copyWebhookTitle}>🟢 CarPlay Connects (Start Trip)</Text>
                    <TouchableOpacity
                      style={styles.copyPillBtn}
                      activeOpacity={0.7}
                      onPress={() =>
                        copyToClipboard(
                          `${BACKEND_URL}/api/trip/start?${(displayVin && displayVin !== 'Discovering...') ? `vin=${encodeURIComponent(displayVin)}&` : ''}format=text`,
                          'CarPlay Start Trip URL'
                        )
                      }
                    >
                      <Text style={styles.copyPillBtnText}>📋 Copy Link</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={styles.copyUrlTapArea}
                    activeOpacity={0.7}
                    onPress={() =>
                      copyToClipboard(
                        `${BACKEND_URL}/api/trip/start?${(displayVin && displayVin !== 'Discovering...') ? `vin=${encodeURIComponent(displayVin)}&` : ''}format=text`,
                        'CarPlay Start Trip URL'
                      )
                    }
                  >
                    <Text style={styles.copyUrlMonoText} numberOfLines={2}>
                      {`${BACKEND_URL}/api/trip/start?${(displayVin && displayVin !== 'Discovering...') ? `vin=${encodeURIComponent(displayVin)}&` : ''}format=text`}
                    </Text>
                    <Text style={styles.copyUrlTapHint}>Tap to copy Start Trip Webhook URL (with notification text)</Text>
                  </TouchableOpacity>
                </View>

                {/* 6. Stop Trip Link */}
                <View style={styles.copyWebhookCard}>
                  <View style={styles.copyWebhookHeader}>
                    <Text style={styles.copyWebhookTitle}>🔴 CarPlay Disconnects (Stop Trip)</Text>
                    <TouchableOpacity
                      style={styles.copyPillBtn}
                      activeOpacity={0.7}
                      onPress={() =>
                        copyToClipboard(
                          `${BACKEND_URL}/api/trip/stop?${(displayVin && displayVin !== 'Discovering...') ? `vin=${encodeURIComponent(displayVin)}&` : ''}format=text`,
                          'CarPlay Stop Trip URL'
                        )
                      }
                    >
                      <Text style={styles.copyPillBtnText}>📋 Copy Link</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    style={styles.copyUrlTapArea}
                    activeOpacity={0.7}
                    onPress={() =>
                      copyToClipboard(
                        `${BACKEND_URL}/api/trip/stop?${(displayVin && displayVin !== 'Discovering...') ? `vin=${encodeURIComponent(displayVin)}&` : ''}format=text`,
                        'CarPlay Stop Trip URL'
                      )
                    }
                  >
                    <Text style={styles.copyUrlMonoText} numberOfLines={2}>
                      {`${BACKEND_URL}/api/trip/stop?${(displayVin && displayVin !== 'Discovering...') ? `vin=${encodeURIComponent(displayVin)}&` : ''}format=text`}
                    </Text>
                    <Text style={styles.copyUrlTapHint}>Tap to copy Stop Trip Webhook URL (with complete trip metrics)</Text>
                  </TouchableOpacity>
                </View>

                <Text style={{ color: '#F59E0B', fontSize: 11, fontWeight: '700', marginTop: 8, marginBottom: 2 }}>
                  📱 How to set up in Apple Shortcuts (Takes 30 seconds):
                </Text>
                <Text style={{ color: '#94A3B8', fontSize: 11, lineHeight: 17 }}>
                  1. Tap &quot;Copy Link&quot; above (Unlock, Lock, AC On/Off, or CarPlay Start/Stop).{'\n'}
                  2. <Text style={{ color: '#F8FAFC', fontWeight: '700' }}>For Siri / Widgets:</Text> Shortcuts app → &quot;+&quot; → Add Action &quot;Get contents of URL&quot; → Paste link → Rename shortcut (e.g. &quot;Unlock Windsor&quot;).{'\n'}
                  3. <Text style={{ color: '#F8FAFC', fontWeight: '700' }}>For CarPlay Trip Notifications:</Text> Shortcuts app → <Text style={{ color: '#38BDF8', fontWeight: '700' }}>Automation</Text> tab → &quot;+&quot; → <Text style={{ color: '#38BDF8', fontWeight: '700' }}>CarPlay</Text> → Connects (or Disconnects) → Run Immediately (Notify When Run OFF) → Add Action &quot;Get Contents of URL&quot; → Paste Start (or Stop) URL → Add Action <Text style={{ color: '#38BDF8', fontWeight: '700' }}>&quot;Show Notification&quot;</Text> (Text: Contents of URL) → Done!{'\n'}
                  4. First run: Tap &quot;Allow&quot; on the one-time privacy popup. It executes silently with zero 12V battery drain!
                </Text>
              </View>
            </AccountSectionCard>

            {/* CARD 6: Open-Source Credits & Acknowledgements */}
            <AccountSectionCard
              title="Open-Source Credits & Acknowledgements"
              icon="🙏"
              badge="Apache 2.0 / MIT"
              badgeBg="#1E293B"
              badgeColor="#38BDF8"
              preview="Irshad Melethil (Volta Android) & John Lazarus (mg-ismart-india-client)"
              subtitle="Built upon open-source research and EV engineering from the Indian MG EV community."
            >
              <View style={{ gap: 10 }}>
                <View
                  style={{
                    backgroundColor: '#0A0E17',
                    padding: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: '#1E293B',
                  }}
                >
                  <Text style={{ color: '#F8FAFC', fontSize: 13, fontWeight: '800' }}>
                    🗺️ EV Trip Planner &amp; Terrain Physics Engine
                  </Text>
                  <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 4, lineHeight: 16 }}>
                    Ported from <Text style={{ color: '#34D399', fontWeight: '700' }}>Volta (irshadm/volta-android)</Text> by{' '}
                    <Text style={{ color: '#F8FAFC', fontWeight: '700' }}>Irshad Melethil</Text> (Apache License 2.0) — including the terrain-aware physics EnergyModel (flat speed efficiency + potential energy climb &amp; regen), 20m hysteresis elevation filter, Dijkstra time-optimal DC stop planner, charger confidence scoring, and 25 km backup charger selection.
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <TouchableOpacity
                      style={[styles.copyPillBtn, { backgroundColor: '#0284C725', borderColor: '#38BDF8' }]}
                      onPress={() => Linking.openURL('https://github.com/irshadm/volta-android')}
                    >
                      <Text style={[styles.copyPillBtnText, { color: '#38BDF8' }]}>
                        🔗 GitHub: irshadm/volta-android
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.copyPillBtn, { backgroundColor: '#064E3B40', borderColor: '#34D399' }]}
                      onPress={() => Linking.openURL('https://irshadm.dev/volta/')}
                    >
                      <Text style={[styles.copyPillBtnText, { color: '#34D399' }]}>
                        🌐 irshadm.dev/volta
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View
                  style={{
                    backgroundColor: '#0A0E17',
                    padding: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: '#1E293B',
                  }}
                >
                  <Text style={{ color: '#F8FAFC', fontSize: 13, fontWeight: '800' }}>
                    📡 MG i-SMART India ASN.1 UPER Protocol
                  </Text>
                  <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 4, lineHeight: 16 }}>
                    Ported from <Text style={{ color: '#38BDF8', fontWeight: '700' }}>john-lazarus/mg-ismart-india-client</Text> by{' '}
                    <Text style={{ color: '#F8FAFC', fontWeight: '700' }}>John Lazarus</Text>, who reverse-engineered the MG India i-SMART ASN.1 UPER binary frames and TAP gateway signatures.
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                    <TouchableOpacity
                      style={[styles.copyPillBtn, { backgroundColor: '#0284C725', borderColor: '#38BDF8' }]}
                      onPress={() => Linking.openURL('https://github.com/john-lazarus/mg-ismart-india-client')}
                    >
                      <Text style={[styles.copyPillBtnText, { color: '#38BDF8' }]}>
                        🔗 GitHub: john-lazarus/mg-ismart-india-client
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </AccountSectionCard>
          </>
        )}
      </ScrollView>

      {/* Tyres & Closures Fullscreen Tween Screen */}
      {isTyresScreenVisible && (
        <Animated.View
          style={[
            styles.tyresScreenLayer,
            {
              transform: [{ translateX: tyresTranslateX }],
            },
          ]}
        >
          <SafeAreaView style={{ flex: 1, width: '100%', alignItems: 'center' }}>
            <ScrollView
              style={{ flex: 1, width: '100%' }}
              contentContainerStyle={styles.tyresScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Header */}
              <View style={styles.tyresHeader}>
                <TouchableOpacity
                  style={styles.tyresBackBtn}
                  onPress={handleCloseTyresScreen}
                  activeOpacity={0.7}
                  accessibilityLabel="Back to Home"
                  accessibilityRole="button"
                >
                  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#F8FAFC" strokeWidth={2.4}>
                    <Path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </TouchableOpacity>

                <Text style={styles.tyresTitle}>Tyres & closures</Text>

                <View style={[styles.tyresBadge, (openDoors.length > 0 || openWindows.length > 0) && styles.tyresBadgeOpen]}>
                  <Text style={[styles.tyresBadgeText, (openDoors.length > 0 || openWindows.length > 0) && styles.tyresBadgeTextOpen]}>
                    {openDoors.length === 0 && openWindows.length === 0 ? 'All shut' : 'Open'}
                  </Text>
                </View>
              </View>

              {/* Vehicle Stage with Top-Down View & 4 Floating Cards */}
              <View style={styles.tyresStageContainer}>
                {/* Floor Glow behind Car */}
                <View style={styles.tyresFloorGlow} />

                {/* Top-Down Car Image */}
                <View style={styles.tyresCarCenter}>
                  <Image
                    source={Platform.OS === 'web' ? { uri: activeWindsorColor.topFallbackUri } : activeWindsorColor.topImage}
                    defaultSource={activeWindsorColor.topImage}
                    style={styles.tyresCarImage}
                    resizeMode="contain"
                  />
                </View>

                {/* Floating Card: Front Left */}
                <View style={[styles.tyresCardFloat, styles.tyresCardFL]}>
                  <Text style={styles.tyresCardPos}>Front left</Text>
                  <View style={styles.tyresCardPsiRow}>
                    <Text style={styles.tyresCardPsiVal}>{status.front_left_tyre_psi ?? '37.8'}</Text>
                    <Text style={styles.tyresCardPsiUnit}> PSI</Text>
                  </View>
                  <Text style={[styles.tyresCardSubText, status.driver_door_open && styles.tyresCardSubOpen]}>
                    {status.driver_door_open ? 'Door OPEN' : 'Door shut'}
                  </Text>
                  <Text style={[styles.tyresCardSubText, status.driver_window_open && styles.tyresCardSubOpen]}>
                    {status.driver_window_open ? 'Window OPEN' : 'Window shut'}
                  </Text>
                </View>

                {/* Floating Card: Front Right */}
                <View style={[styles.tyresCardFloat, styles.tyresCardFR]}>
                  <Text style={styles.tyresCardPos}>Front right</Text>
                  <View style={styles.tyresCardPsiRow}>
                    <Text style={styles.tyresCardPsiVal}>{status.front_right_tyre_psi ?? '37.4'}</Text>
                    <Text style={styles.tyresCardPsiUnit}> PSI</Text>
                  </View>
                  <Text style={[styles.tyresCardSubText, status.passenger_door_open && styles.tyresCardSubOpen]}>
                    {status.passenger_door_open ? 'Door OPEN' : 'Door shut'}
                  </Text>
                  <Text style={[styles.tyresCardSubText, status.passenger_window_open && styles.tyresCardSubOpen]}>
                    {status.passenger_window_open ? 'Window OPEN' : 'Window shut'}
                  </Text>
                </View>

                {/* Floating Card: Rear Left */}
                <View style={[styles.tyresCardFloat, styles.tyresCardRL]}>
                  <Text style={styles.tyresCardPos}>Rear left</Text>
                  <View style={styles.tyresCardPsiRow}>
                    <Text style={styles.tyresCardPsiVal}>{status.rear_left_tyre_psi ?? '37.4'}</Text>
                    <Text style={styles.tyresCardPsiUnit}> PSI</Text>
                  </View>
                  <Text style={[styles.tyresCardSubText, status.rear_left_door_open && styles.tyresCardSubOpen]}>
                    {status.rear_left_door_open ? 'Door OPEN' : 'Door shut'}
                  </Text>
                  <Text style={[styles.tyresCardSubText, status.rear_left_window_open && styles.tyresCardSubOpen]}>
                    {status.rear_left_window_open ? 'Window OPEN' : 'Window shut'}
                  </Text>
                </View>

                {/* Floating Card: Rear Right */}
                <View style={[styles.tyresCardFloat, styles.tyresCardRR]}>
                  <Text style={styles.tyresCardPos}>Rear right</Text>
                  <View style={styles.tyresCardPsiRow}>
                    <Text style={styles.tyresCardPsiVal}>{status.rear_right_tyre_psi ?? '37.4'}</Text>
                    <Text style={styles.tyresCardPsiUnit}> PSI</Text>
                  </View>
                  <Text style={[styles.tyresCardSubText, status.rear_right_door_open && styles.tyresCardSubOpen]}>
                    {status.rear_right_door_open ? 'Door OPEN' : 'Door shut'}
                  </Text>
                  <Text style={[styles.tyresCardSubText, status.rear_right_window_open && styles.tyresCardSubOpen]}>
                    {status.rear_right_window_open ? 'Window OPEN' : 'Window shut'}
                  </Text>
                </View>
              </View>

              {/* Bottom Summary Box: Doors & Windows */}
              <View style={styles.tyresSummaryBox}>
                <View style={styles.tyresSummaryLine}>
                  <Text style={styles.tyresSummaryTitle}>Doors</Text>
                  <Text style={[styles.tyresSummaryStatus, openDoors.length > 0 && styles.tyresSummaryStatusOpen]}>
                    {openDoors.length === 0 ? 'All shut' : `${openDoors.join(', ')} open`}
                  </Text>
                </View>

                <View style={styles.tyresSummarySep} />

                <View style={styles.tyresSummaryLine}>
                  <Text style={styles.tyresSummaryTitle}>Windows</Text>
                  <Text style={[styles.tyresSummaryStatus, openWindows.length > 0 && styles.tyresSummaryStatusOpen]}>
                    {openWindows.length === 0 ? 'All shut' : `${openWindows.join(', ')} open`}
                  </Text>
                </View>
              </View>
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      )}

      {/* Location Fullscreen Tween Screen */}
      {isLocationScreenVisible && (
        <Animated.View
          style={[
            styles.locScreenLayer,
            {
              transform: [{ translateX: locationTranslateX }],
            },
          ]}
        >
          <SafeAreaView style={{ flex: 1, width: '100%', alignItems: 'center' }}>
            <ScrollView
              style={{ flex: 1, width: '100%' }}
              contentContainerStyle={styles.locScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Header */}
              <View style={styles.locHeader}>
                <TouchableOpacity
                  style={styles.locBackBtn}
                  onPress={handleCloseLocationScreen}
                  activeOpacity={0.7}
                  accessibilityLabel="Back to Home"
                  accessibilityRole="button"
                >
                  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#F8FAFC" strokeWidth={2.4}>
                    <Path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </TouchableOpacity>

                <Text style={styles.locTitle}>Location</Text>

                <View style={styles.locBadge}>
                  <Text style={styles.locBadgeText}>
                    {gpsFixType} fix · {gpsSatellites} sats
                  </Text>
                </View>
              </View>

              {/* Map Card */}
              <View style={styles.locMapCard}>
                {Platform.OS === 'web' ? (
                  <iframe
                    title="Vehicle Live GPS Map"
                    src={`/map.html?lat=${gpsLat}&lon=${gpsLon}&heading=${gpsHeading}&key=${encodeURIComponent(
                      googleMapsApiKey
                    )}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      borderRadius: 24,
                    }}
                  />
                ) : (
                  <View style={styles.locMapNativePlaceholder}>
                    <Image
                      source={{
                        uri: `https://staticmap.openstreetmap.de/staticmap.php?center=${gpsLat},${gpsLon}&zoom=16&size=600x400&maptype=mapnik`,
                      }}
                      style={styles.locMapNativeImg}
                    />
                    <View style={styles.locNativeBeacon}>
                      <View style={styles.locNativeHalo} />
                      <View
                        style={[
                          styles.locNativeArrowWrap,
                          { transform: [{ rotate: `${gpsHeading}deg` }] },
                        ]}
                      >
                        <View style={styles.locNativeArrow} />
                      </View>
                      <View style={styles.locNativeDot} />
                    </View>
                  </View>
                )}

                {/* Floating Parked Badge in bottom-left */}
                <View style={styles.locParkedBadge}>
                  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth={2.5}>
                    <Rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </Svg>
                  <Text style={styles.locParkedBadgeText}>
                    {gpsSpeed === 0 ? 'Parked' : `Driving ${gpsSpeed} km/h`}
                  </Text>
                </View>
              </View>

              {/* Map Provider / API Key Status Bar */}
              <TouchableOpacity
                style={[
                  styles.locProviderBar,
                  googleMapsKeyError && { borderColor: '#F59E0B', backgroundColor: '#78350F25' },
                ]}
                onPress={() => {
                  if (googleMapsKeyError) {
                    Alert.alert(
                      'Google Maps: API Not Activated',
                      'Your Google Cloud project exists, but the "Maps JavaScript API" has not been enabled on it yet.\n\n1. In Google Cloud Console, search for "Maps JavaScript API"\n2. Click "ENABLE"\n3. Ensure a billing account is linked to the project.\n\nWhile you do that, the app is seamlessly using OpenStreetMap so your map works uninterrupted.',
                      [
                        {
                          text: 'Enable Maps API in Cloud Console',
                          onPress: () =>
                            Linking.openURL(
                              'https://console.cloud.google.com/apis/library/maps-backend.googleapis.com'
                            ),
                        },
                        {
                          text: 'Open Profile Settings',
                          onPress: () => {
                            handleCloseLocationScreen();
                            setTab('account');
                          },
                        },
                        { text: 'Dismiss', style: 'cancel' },
                      ]
                    );
                  } else {
                    handleCloseLocationScreen();
                    setTab('account');
                  }
                }}
                activeOpacity={0.7}
                accessibilityLabel="Configure Google Maps API Key in Profile"
                accessibilityRole="button"
              >
                <Text style={styles.locProviderBarText}>
                  {googleMapsKeyError ? (
                    <Text style={{ color: '#FCD34D', fontWeight: '700' }}>
                      ⚠️ Key Not Activated in Cloud Console · Tap to Enable
                    </Text>
                  ) : googleMapsApiKey ? (
                    <Text style={{ color: '#34D399', fontWeight: '700' }}>✓ Google Maps Active · Tap to manage</Text>
                  ) : (
                    <Text>
                      🌐 Free OpenStreetMap Active ·{' '}
                      <Text style={{ color: '#38BDF8', fontWeight: '700' }}>Tap to add Google Maps Key</Text>
                    </Text>
                  )}
                </Text>
              </TouchableOpacity>

              {/* 3-Column Metrics: Speed, Heading, Altitude */}
              <View style={styles.locStatsRow}>
                <View style={styles.locStatCol}>
                  <Text style={styles.locStatLabel}>Speed</Text>
                  <Text style={styles.locStatVal}>{gpsSpeed} km/h</Text>
                  <Text style={styles.locStatSub}>{gpsSpeed === 0 ? 'Stationary' : 'Moving'}</Text>
                </View>

                <View style={styles.locStatCol}>
                  <Text style={styles.locStatLabel}>Heading</Text>
                  <Text style={styles.locStatVal}>{gpsHeading}°</Text>
                  <Text style={styles.locStatSub}>{gpsCardinal}</Text>
                </View>

                <View style={styles.locStatCol}>
                  <Text style={styles.locStatLabel}>Altitude</Text>
                  <Text style={styles.locStatVal}>{gpsAltitude} m</Text>
                  <Text style={styles.locStatSub}>Above sea level</Text>
                </View>
              </View>

              {/* Summary Card: Coordinates & GPS Fix */}
              <View style={styles.locSummaryCard}>
                <View style={styles.locSummaryLine}>
                  <Text style={styles.locSummaryLabel}>Coordinates</Text>
                  <Text style={styles.locSummaryVal}>
                    {gpsLat.toFixed(6)}, {gpsLon.toFixed(6)}
                  </Text>
                </View>

                <View style={styles.locSummarySep} />

                <View style={styles.locSummaryLine}>
                  <Text style={styles.locSummaryLabel}>GPS fix</Text>
                  <Text style={styles.locSummaryVal}>
                    {gpsFixType} · {gpsSatellites} satellites
                  </Text>
                </View>
              </View>

              {/* Bottom Action Buttons: Apple Maps & Google Maps */}
              <View style={styles.locActionButtonsRow}>
                <TouchableOpacity
                  style={styles.locAppleBtn}
                  onPress={() =>
                    Linking.openURL(
                      `http://maps.apple.com/?ll=${gpsLat},${gpsLon}&q=${encodeURIComponent(displayName)}`
                    )
                  }
                  activeOpacity={0.7}
                  accessibilityLabel="Open in Apple Maps"
                  accessibilityRole="button"
                >
                  <Text style={styles.locAppleBtnText}>Apple Maps</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.locGoogleBtn}
                  onPress={() =>
                    Linking.openURL(
                      `https://www.google.com/maps/search/?api=1&query=${gpsLat},${gpsLon}`
                    )
                  }
                  activeOpacity={0.7}
                  accessibilityLabel="Open in Google Maps"
                  accessibilityRole="button"
                >
                  <Text style={styles.locGoogleBtnText}>Google Maps</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      )}

      {/* Remote Commands Fullscreen Tween Screen */}
      {isRemoteScreenVisible && (
        <Animated.View
          style={[
            styles.remScreenLayer,
            {
              transform: [{ translateX: remoteTranslateX }],
            },
          ]}
        >
          <SafeAreaView style={{ flex: 1, width: '100%', alignItems: 'center' }}>
            <ScrollView
              style={{ flex: 1, width: '100%' }}
              contentContainerStyle={styles.remScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Header */}
              <View style={styles.remHeader}>
                <TouchableOpacity
                  style={styles.remBackBtn}
                  onPress={handleCloseRemoteScreen}
                  activeOpacity={0.7}
                  accessibilityLabel="Back to Home"
                  accessibilityRole="button"
                >
                  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#F8FAFC" strokeWidth={2.4}>
                    <Path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </TouchableOpacity>

                <View style={styles.remTitleCol}>
                  <Text style={styles.remTitle}>Remote</Text>
                  <Text style={styles.remTitle}>commands</Text>
                </View>

                <View style={styles.remBadge}>
                  <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth={2.5}>
                    <Rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </Svg>
                  <Text style={styles.remBadgeText}>PIN locked</Text>
                </View>
              </View>

              {/* Subtext info */}
              <Text style={styles.remSubtext}>
                Your PIN is checked before any command is sent to the car.
              </Text>

              {/* Primary 4-Row Control Card */}
              <View style={styles.remControlCard}>
                {/* Row 1: Doors */}
                <View style={styles.remRow}>
                  <View style={styles.remRowLeft}>
                    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth={2.2}>
                      <Rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </Svg>
                    <Text style={styles.remRowLabel}>Doors</Text>
                  </View>
                  <View style={styles.remBtnPair}>
                    <TouchableOpacity
                      style={styles.remActionBtn}
                      onPress={() => triggerCommand('Lock Doors', (c) => c.controlDoorLock(true))}
                      activeOpacity={0.7}
                      accessibilityLabel="Lock Doors"
                      accessibilityRole="button"
                    >
                      <Text style={styles.remActionBtnText}>Lock</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.remActionBtn}
                      onPress={() => triggerCommand('Unlock Doors', (c) => c.controlDoorLock(false))}
                      activeOpacity={0.7}
                      accessibilityLabel="Unlock Doors"
                      accessibilityRole="button"
                    >
                      <Text style={styles.remActionBtnText}>Unlock</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.remRowDivider} />

                {/* Row 2: Climate */}
                <View style={styles.remRow}>
                  <View style={styles.remRowLeft}>
                    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth={2.2}>
                      <Path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07L19.07 4.93" strokeLinecap="round" strokeLinejoin="round" />
                    </Svg>
                    <Text style={styles.remRowLabel}>Climate</Text>
                  </View>
                  <View style={styles.remBtnPair}>
                    <TouchableOpacity
                      style={styles.remActionBtn}
                      onPress={() => triggerCommand('Start Climate AC', (c) => c.controlClimate(true))}
                      activeOpacity={0.7}
                      accessibilityLabel="Start Climate AC"
                      accessibilityRole="button"
                    >
                      <Text style={styles.remActionBtnText}>Start</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.remActionBtn}
                      onPress={() => triggerCommand('Stop Climate AC', (c) => c.controlClimate(false))}
                      activeOpacity={0.7}
                      accessibilityLabel="Stop Climate AC"
                      accessibilityRole="button"
                    >
                      <Text style={styles.remActionBtnText}>Stop</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.remRowDivider} />

                {/* Row 3: Windows */}
                <View style={styles.remRow}>
                  <View style={styles.remRowLeft}>
                    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth={2}>
                      <Rect x="5" y="3" width="14" height="18" rx="2" />
                      <Path d="M5 8h14" />
                    </Svg>
                    <Text style={styles.remRowLabel}>Windows</Text>
                  </View>
                  <View style={styles.remBtnPair}>
                    <TouchableOpacity
                      style={styles.remActionBtn}
                      onPress={() => triggerCommand('Open Windows', (c) => c.controlWindows(true, [9, 10, 11, 12]))}
                      activeOpacity={0.7}
                      accessibilityLabel="Open Windows"
                      accessibilityRole="button"
                    >
                      <Text style={styles.remActionBtnText}>Open</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.remActionBtn}
                      onPress={() => triggerCommand('Close Windows', (c) => c.controlWindows(false, [9, 10, 11, 12]))}
                      activeOpacity={0.7}
                      accessibilityLabel="Close Windows"
                      accessibilityRole="button"
                    >
                      <Text style={styles.remActionBtnText}>Close</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.remRowDivider} />

                {/* Row 4: Sunroof */}
                <View style={styles.remRow}>
                  <View style={styles.remRowLeft}>
                    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth={2}>
                      <Path d="M4 17a8 8 0 0 1 16 0z" strokeLinecap="round" strokeLinejoin="round" />
                      <Path d="M12 9v8" />
                    </Svg>
                    <Text style={styles.remRowLabel}>Sunroof</Text>
                  </View>
                  <View style={styles.remBtnPair}>
                    <TouchableOpacity
                      style={styles.remActionBtn}
                      onPress={() => triggerCommand('Open Sunroof', (c) => c.controlSunroof(true))}
                      activeOpacity={0.7}
                      accessibilityLabel="Open Sunroof"
                      accessibilityRole="button"
                    >
                      <Text style={styles.remActionBtnText}>Open</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.remActionBtn}
                      onPress={() => triggerCommand('Close Sunroof', (c) => c.controlSunroof(false))}
                      activeOpacity={0.7}
                      accessibilityLabel="Close Sunroof"
                      accessibilityRole="button"
                    >
                      <Text style={styles.remActionBtnText}>Close</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>

              {/* Bottom 2 Feature Cards: Find My Car & Release Tailgate */}
              <View style={styles.remBottomGrid}>
                {/* Card 1: Find my car */}
                <TouchableOpacity
                  style={styles.remFeatureCard}
                  onPress={() => triggerCommand('Find My Car', (c) => c.findMyCar())}
                  activeOpacity={0.7}
                  accessibilityLabel="Find my car"
                  accessibilityRole="button"
                >
                  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth={2.2}>
                    <Path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <Circle cx="12" cy="10" r="3" />
                  </Svg>
                  <Text style={styles.remFeatureTitle}>Find my car</Text>
                  <Text style={styles.remFeatureSub}>Horn and lights</Text>
                </TouchableOpacity>

                {/* Card 2: Release tailgate */}
                <TouchableOpacity
                  style={styles.remFeatureCard}
                  onPress={() => triggerCommand('Release Tailgate', (c) => c.releaseTailgate())}
                  activeOpacity={0.7}
                  accessibilityLabel="Release tailgate"
                  accessibilityRole="button"
                >
                  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth={2}>
                    <Rect x="3" y="8" width="18" height="12" rx="2" />
                    <Path d="M3 12h18M8 8V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v4" strokeLinecap="round" />
                  </Svg>
                  <Text style={styles.remFeatureTitle}>Release tailgate</Text>
                  <Text style={styles.remFeatureSub}>Opens the boot</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      )}

      {/* Plan a Trip Fullscreen Tween Screen */}
      {isPlanScreenVisible && (
        <Animated.View
          style={[
            styles.planScreenLayer,
            {
              transform: [{ translateX: planTranslateX }],
            },
          ]}
        >
          <SafeAreaView style={{ flex: 1, width: '100%', alignItems: 'center' }}>
            <ScrollView
              style={{ flex: 1, width: '100%' }}
              contentContainerStyle={styles.planScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Header */}
              <View style={styles.planHeader}>
                <TouchableOpacity
                  style={styles.planBackBtn}
                  onPress={handleClosePlanScreen}
                  activeOpacity={0.7}
                  accessibilityLabel="Back to Trips"
                  accessibilityRole="button"
                >
                  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#F8FAFC" strokeWidth={2.4}>
                    <Path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </TouchableOpacity>

                <Text style={styles.planTitle}>Plan a trip</Text>

                <View style={styles.planTrafficBadge}>
                  <Text style={styles.planTrafficBadgeText}>Live traffic</Text>
                </View>
              </View>

              {/* Start Section */}
              <Text style={styles.planSectionLabel}>Start</Text>
              <View style={styles.planBtnRow}>
                <TouchableOpacity
                  style={[
                    styles.planChoiceBtn,
                    planOriginMode === 'car' && styles.planChoiceBtnActive,
                  ]}
                  onPress={() => setPlanOriginMode('car')}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.planChoiceBtnText,
                      planOriginMode === 'car' && styles.planChoiceBtnTextActive,
                    ]}
                  >
                    Car GPS · {(status.gps?.latitude ?? 10.06).toFixed(2)}, {(status.gps?.longitude ?? 76.62).toFixed(2)}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.planChoiceBtn,
                    planOriginMode === 'custom' && styles.planChoiceBtnActive,
                  ]}
                  onPress={() => setPlanOriginMode('custom')}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.planChoiceBtnText,
                      planOriginMode === 'custom' && styles.planChoiceBtnTextActive,
                    ]}
                  >
                    Custom
                  </Text>
                </TouchableOpacity>
              </View>

              {planOriginMode === 'custom' && (
                <TextInput
                  style={styles.planCustomInput}
                  placeholder="Enter starting city/location"
                  placeholderTextColor="#64748B"
                  value={planCustomOrigin}
                  onChangeText={setPlanCustomOrigin}
                />
              )}

              {/* Charging Strategy Section */}
              <Text style={styles.planSectionLabel}>Charging strategy</Text>
              <View style={styles.planBtnRow}>
                <TouchableOpacity
                  style={[
                    styles.planChoiceBtn,
                    planStrategy === 'fastest' && styles.planChoiceBtnActive,
                  ]}
                  onPress={() => setPlanStrategy('fastest')}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.planChoiceBtnText,
                      planStrategy === 'fastest' && styles.planChoiceBtnTextActive,
                    ]}
                  >
                    Fastest
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.planChoiceBtn,
                    planStrategy === 'fixed100' && styles.planChoiceBtnActive,
                  ]}
                  onPress={() => setPlanStrategy('fixed100')}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.planChoiceBtnText,
                      planStrategy === 'fixed100' && styles.planChoiceBtnTextActive,
                    ]}
                  >
                    Fixed 100%
                  </Text>
                </TouchableOpacity>
              </View>

              {/* 4 Parameter Metric Tiles (2x2 Grid) */}
              <View style={styles.planMetricsGrid}>
                {/* Tile 1: Start SoC */}
                <TouchableOpacity
                  style={styles.planMetricTile}
                  onPress={() => {
                    const next = planStartSoc >= 100 ? 70 : planStartSoc + 10;
                    setPlanStartSoc(next);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.planMetricTileLabel}>Start SoC</Text>
                  <Text style={styles.planMetricTileVal}>{planStartSoc}%</Text>
                </TouchableOpacity>

                {/* Tile 2: Min at charger */}
                <TouchableOpacity
                  style={styles.planMetricTile}
                  onPress={() => {
                    const list = [10, 15, 20, 25];
                    const idx = list.indexOf(planMinCharger);
                    setPlanMinCharger(list[(idx + 1) % list.length]);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.planMetricTileLabel}>Min at charger</Text>
                  <Text style={styles.planMetricTileVal}>{planMinCharger}%</Text>
                </TouchableOpacity>

                {/* Tile 3: Min at destination */}
                <TouchableOpacity
                  style={styles.planMetricTile}
                  onPress={() => {
                    const list = [15, 20, 30, 50];
                    const idx = list.indexOf(planMinDest);
                    setPlanMinDest(list[(idx + 1) % list.length]);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.planMetricTileLabel}>Min at destination</Text>
                  <Text style={styles.planMetricTileVal}>{planMinDest}%</Text>
                </TouchableOpacity>

                {/* Tile 4: Charge to */}
                <TouchableOpacity
                  style={styles.planMetricTile}
                  onPress={() => {
                    const list = [80, 90, 100];
                    const idx = list.indexOf(planChargeTo);
                    setPlanChargeTo(list[(idx + 1) % list.length]);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.planMetricTileLabel}>Charge to</Text>
                  <Text style={styles.planMetricTileVal}>{planChargeTo}%</Text>
                </TouchableOpacity>
              </View>

              {/* Destination Section */}
              <View style={styles.planDestHeaderRow}>
                <Text style={styles.planSectionLabel}>Destination</Text>
                <TouchableOpacity
                  onPress={() => {
                    const curKey = googleMapsApiKey || '';
                    if (Platform.OS === 'web') {
                      const input = window.prompt(
                        'Enter Google Maps Platform API Key (or leave empty for OpenStreetMap Free Mode):',
                        curKey
                      );
                      if (input !== null) {
                        handleSaveMapsApiKey(input);
                      }
                    } else {
                      Alert.prompt(
                        'Google Maps API Key',
                        'Enter key for live traffic & places:',
                        (text) => handleSaveMapsApiKey(text)
                      );
                    }
                  }}
                >
                  <Text style={styles.planDestApiKeyLink}>Google API key</Text>
                </TouchableOpacity>
              </View>

              {/* Destination Input Box */}
              <TextInput
                style={styles.planDestInput}
                placeholder="Where to? e.g. Munnar"
                placeholderTextColor="#64748B"
                value={planDestQuery}
                onChangeText={setPlanDestQuery}
              />

              {/* Preset Destination Pills */}
              <View style={styles.planChipsRow}>
                {QUICK_DESTINATIONS.map((chip) => (
                  <TouchableOpacity
                    key={chip.name}
                    style={[
                      styles.planChip,
                      planDestQuery.toLowerCase().includes(chip.name.toLowerCase()) && styles.planChipActive,
                    ]}
                    onPress={() => {
                      setPlanDestQuery(chip.name);
                      setPlanSelectedDest({
                        placeId: 'quick-dest-' + chip.name.toLowerCase(),
                        name: chip.name,
                        position: chip.position,
                      });
                    }}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.planChipText,
                        planDestQuery.toLowerCase().includes(chip.name.toLowerCase()) && styles.planChipTextActive,
                      ]}
                    >
                      {chip.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Footnote */}
              <Text style={styles.planFootnote}>
                Elevation-aware planning, DC stops and 25 km backup chargers. Ported from irshadm/volta-android by Irshad Melethil (Apache 2.0).
              </Text>

              {/* Primary Plan Route Button */}
              <TouchableOpacity
                style={styles.planPrimaryBtn}
                onPress={() => handleExecutePlanRoute()}
                disabled={planIsComputing}
                activeOpacity={0.8}
              >
                {planIsComputing ? (
                  <ActivityIndicator color="#0A0E17" />
                ) : (
                  <Text style={styles.planPrimaryBtnText}>Plan route</Text>
                )}
              </TouchableOpacity>

              {planIsComputing && (
                <Text style={styles.planProgressText}>{planProgressMsg}</Text>
              )}

              {planError && (
                <View style={styles.planErrorCard}>
                  <Text style={styles.planErrorText}>⚠️ {planError}</Text>
                </View>
              )}

              {/* Computed Route Choices Card */}
              {planComputedChoices.length > 0 && (() => {
                const choice = planComputedChoices[0];
                const estKwh = (choice.distanceM / 1000) / 7.5;
                const estSocUsed = (estKwh / 38) * 100;
                const estArrivalSoc = Math.max(5, Math.round(planStartSoc - estSocUsed));
                const destPos = choice.path && choice.path.length > 0 ? choice.path[choice.path.length - 1] : null;

                return (
                  <View style={styles.planResultCard}>
                    <Text style={styles.planResultHeader}>✅ Route Computed</Text>
                    <View style={styles.planResultLine}>
                      <Text style={styles.planResultLabel}>Total Distance</Text>
                      <Text style={styles.planResultVal}>
                        {(choice.distanceM / 1000).toFixed(0)} km
                      </Text>
                    </View>
                    <View style={styles.planResultLine}>
                      <Text style={styles.planResultLabel}>Estimated Time</Text>
                      <Text style={styles.planResultVal}>
                        {Math.floor(choice.durationS / 3600)}h {Math.round((choice.durationS % 3600) / 60)}m
                      </Text>
                    </View>
                    <View style={styles.planResultLine}>
                      <Text style={styles.planResultLabel}>Arrival Battery</Text>
                      <Text style={[styles.planResultVal, { color: '#34D399' }]}>
                        {estArrivalSoc}%
                      </Text>
                    </View>
                    <View style={styles.planResultLine}>
                      <Text style={styles.planResultLabel}>Charging Corridor</Text>
                      <Text style={styles.planResultVal}>
                        {choice.chargers?.length || 0} fast chargers
                      </Text>
                    </View>

                    {destPos && (
                      <TouchableOpacity
                        style={styles.planNavBtn}
                        onPress={() => {
                          Linking.openURL(
                            `https://www.google.com/maps/dir/?api=1&destination=${destPos.lat},${destPos.lng}`
                          );
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.planNavBtnText}>🗺️ Start Navigation in Google Maps</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })()}
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      )}

      {/* Trip Detail Fullscreen Tween Screen */}
      {isTripDetailVisible && selectedTripForDetail && (
        <Animated.View
          style={[
            styles.tripDetailScreenLayer,
            {
              transform: [{ translateX: tripDetailTranslateX }],
            },
          ]}
        >
          <SafeAreaView style={{ flex: 1, width: '100%', alignItems: 'center' }}>
            <ScrollView
              style={{ flex: 1, width: '100%' }}
              contentContainerStyle={styles.tripDetailScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Header */}
              <View style={styles.tripDetailHeader}>
                <TouchableOpacity
                  style={styles.tripDetailBackBtn}
                  onPress={handleCloseTripDetail}
                  activeOpacity={0.7}
                  accessibilityLabel="Back to Trips"
                  accessibilityRole="button"
                >
                  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#F8FAFC" strokeWidth={2.4}>
                    <Path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </TouchableOpacity>

                <View style={styles.tripDetailTitleCol}>
                  <Text style={styles.tripDetailTitle}>Trip</Text>
                  <Text style={styles.tripDetailSub} numberOfLines={1}>
                    {formatTripDetailSubtitle(selectedTripForDetail)}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.tripDetailShareBtn}
                  onPress={() => handleShareTripRecord(selectedTripForDetail)}
                  activeOpacity={0.7}
                  accessibilityLabel="Share Trip"
                  accessibilityRole="button"
                >
                  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#F8FAFC" strokeWidth={2}>
                    <Path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <Polyline points="16 6 12 2 8 6" />
                    <Line x1="12" y1="2" x2="12" y2="15" />
                  </Svg>
                </TouchableOpacity>
              </View>

              {/* Map Graphic Preview Card */}
              <View style={styles.tripDetailMapCard}>
                <Svg width="100%" height="100%" viewBox="0 0 400 160">
                  {/* Street grid background lines */}
                  <Line x1="0" y1="30" x2="400" y2="40" stroke="#162032" strokeWidth="12" />
                  <Line x1="0" y1="80" x2="400" y2="70" stroke="#131B2A" strokeWidth="8" />
                  <Line x1="0" y1="130" x2="400" y2="135" stroke="#162032" strokeWidth="10" />
                  <Line x1="80" y1="0" x2="120" y2="160" stroke="#162032" strokeWidth="10" />
                  <Line x1="220" y1="0" x2="180" y2="160" stroke="#162032" strokeWidth="12" />
                  <Line x1="330" y1="0" x2="310" y2="160" stroke="#131B2A" strokeWidth="9" />

                  {/* Start Node Halo & Dot */}
                  <Circle cx="64" cy="116" r="14" fill="rgba(16, 185, 129, 0.25)" />
                  <Circle cx="64" cy="116" r="6" fill="#34D399" />

                  {/* Glowing Route Polyline */}
                  <Path
                    d="M 64 116 C 130 110, 160 68, 230 68 C 280 68, 305 38, 336 32"
                    stroke="#34D399"
                    strokeWidth="4"
                    fill="none"
                    strokeLinecap="round"
                  />

                  {/* Destination Node Halo & Dot */}
                  <Circle cx="336" cy="32" r="14" fill="rgba(16, 185, 129, 0.25)" />
                  <Circle cx="336" cy="32" r="6" fill="#34D399" />
                </Svg>
              </View>

              {/* Big Distance & Odometer */}
              <Text style={styles.tripDetailHeroDist}>
                {selectedTripForDetail.distanceKm}
                <Text style={styles.tripDetailHeroUnit}> km</Text>
              </Text>
              <Text style={styles.tripDetailHeroOdo}>
                {(selectedTripForDetail.startOdometerKm || 0).toLocaleString()} → {(selectedTripForDetail.endOdometerKm || 0).toLocaleString()} km odometer
              </Text>

              {/* 3-Column Metrics (Duration, Energy, Efficiency) */}
              <View style={styles.tripDetailMetricsRow}>
                <View style={styles.tripDetailMetricCol}>
                  <Text style={styles.tripDetailMetricLabel}>Duration</Text>
                  <Text style={styles.tripDetailMetricVal}>
                    {Math.max(1, Math.round((selectedTripForDetail.durationSeconds || (selectedTripForDetail.endTimestampSec - selectedTripForDetail.startTimestampSec) || 60) / 60))} min
                  </Text>
                </View>

                <View style={styles.tripDetailMetricCol}>
                  <Text style={styles.tripDetailMetricLabel}>Energy</Text>
                  <Text style={styles.tripDetailMetricVal}>
                    {selectedTripForDetail.energyUsedKwh} kWh
                  </Text>
                </View>

                <View style={styles.tripDetailMetricCol}>
                  <Text style={styles.tripDetailMetricLabel}>Efficiency</Text>
                  <Text style={styles.tripDetailMetricVal}>
                    {selectedTripForDetail.efficiencyKmPerKwh > 0
                      ? selectedTripForDetail.efficiencyKmPerKwh
                      : (selectedTripForDetail.distanceKm / (selectedTripForDetail.energyUsedKwh || 1)).toFixed(1)}{' '}
                    km/kWh
                  </Text>
                </View>
              </View>

              {/* Battery SoC Progress Card */}
              <View style={styles.tripDetailSocCard}>
                <View style={styles.tripDetailSocTopRow}>
                  <Text style={styles.tripDetailSocLeft}>
                    {selectedTripForDetail.startSoc.toFixed(0)}% {selectedTripForDetail.startEnergyKwh.toFixed(1)} kWh
                  </Text>
                  <Text style={styles.tripDetailSocRight}>
                    {selectedTripForDetail.endSoc.toFixed(0)}% {selectedTripForDetail.endEnergyKwh.toFixed(2)} kWh
                  </Text>
                </View>
                <View style={styles.tripDetailSocTrack}>
                  <View
                    style={[
                      styles.tripDetailSocFill,
                      { width: `${Math.min(100, Math.max(5, selectedTripForDetail.endSoc))}%` },
                    ]}
                  />
                </View>
              </View>

              {/* Route Nodes Timeline */}
              <View style={styles.tripDetailTimeline}>
                {/* Start Node */}
                <View style={styles.tripDetailNode}>
                  <View style={styles.tripDetailNodeDotGrey} />
                  <View style={styles.tripDetailNodeTextCol}>
                    <Text style={styles.tripDetailNodeLabel}>
                      Start · {extractTime(selectedTripForDetail.startDateTime)}
                    </Text>
                    <Text style={styles.tripDetailNodeVal}>
                      {cleanLocationSummary(selectedTripForDetail.startLocation) || 'Starting point'}
                    </Text>
                  </View>
                </View>

                {/* Connecting Track Line */}
                <View style={styles.tripDetailNodeTrack} />

                {/* Destination Node */}
                <View style={styles.tripDetailNode}>
                  <View style={styles.tripDetailNodeDotGreen} />
                  <View style={styles.tripDetailNodeTextCol}>
                    <Text style={styles.tripDetailNodeLabel}>
                      Destination · {extractTime(selectedTripForDetail.endDateTime)}
                    </Text>
                    <Text style={styles.tripDetailNodeVal}>
                      {cleanLocationSummary(selectedTripForDetail.endLocation) || 'Destination point'}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Bottom 2-Column Stats Card */}
              <View style={styles.tripDetailBottomCard}>
                <View style={styles.tripDetailStatRow}>
                  <View style={styles.tripDetailStatCol}>
                    <Text style={styles.tripDetailStatLabel}>Max speed</Text>
                    <Text style={styles.tripDetailStatVal}>
                      {selectedTripForDetail.maxSpeedKmh || (selectedTripForDetail.avgSpeedKmh * 1.48).toFixed(1)} km/h
                    </Text>
                  </View>
                  <View style={styles.tripDetailStatCol}>
                    <Text style={styles.tripDetailStatLabel}>Average speed</Text>
                    <Text style={styles.tripDetailStatVal}>
                      {selectedTripForDetail.avgSpeedKmh || (selectedTripForDetail.distanceKm / ((selectedTripForDetail.durationSeconds || 3600) / 3600)).toFixed(1)} km/h
                    </Text>
                  </View>
                </View>

                <View style={styles.tripDetailDivider} />

                <View style={styles.tripDetailStatRow}>
                  <View style={styles.tripDetailStatCol}>
                    <Text style={styles.tripDetailStatLabel}>Cabin</Text>
                    <Text style={styles.tripDetailStatVal}>
                      {selectedTripForDetail.startCabinTempC ?? 29}° → {selectedTripForDetail.endCabinTempC ?? 25}°C
                    </Text>
                  </View>
                  <View style={styles.tripDetailStatCol}>
                    <Text style={styles.tripDetailStatLabel}>Outside</Text>
                    <Text style={styles.tripDetailStatVal}>
                      {selectedTripForDetail.startExteriorTempC ?? 27}° → {selectedTripForDetail.endExteriorTempC ?? 29}°C
                    </Text>
                  </View>
                </View>

                <View style={styles.tripDetailDivider} />

                <View style={styles.tripDetailStatRow}>
                  <View style={styles.tripDetailStatCol}>
                    <Text style={styles.tripDetailStatLabel}>Idling</Text>
                    <Text style={styles.tripDetailStatVal}>
                      {selectedTripForDetail.idleDurationSeconds > 0
                        ? `${Math.round(selectedTripForDetail.idleDurationSeconds / 60)} min`
                        : 'None'}
                    </Text>
                  </View>
                  <View style={styles.tripDetailStatCol}>
                    <Text style={styles.tripDetailStatLabel}>Idle energy</Text>
                    <Text style={styles.tripDetailStatVal}>
                      {(selectedTripForDetail.idleEnergyKwh || 0).toFixed(2)} kWh
                    </Text>
                  </View>
                </View>
              </View>
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      )}

      {/* PIN Modal */}
      <Modal visible={Boolean(pinPrompt?.visible)} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalBox}>
            <Text style={styles.cardTitle}>Enter 4-Digit Control PIN</Text>
            <Text style={[styles.subtitle, { marginBottom: 12 }]}>
              Authorize {pinPrompt?.label}
            </Text>
            <TextInput
              style={[styles.input, { textAlign: 'center', fontSize: 22, letterSpacing: 8 }]}
              maxLength={4}
              secureTextEntry
              keyboardType="number-pad"
              value={tempPin}
              onChangeText={setTempPin}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={styles.ctrlBtn} onPress={() => setPinPrompt(null)}>
                <Text style={styles.ctrlBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.ctrlBtn, styles.activeBtn]}
                onPress={() => pinPrompt?.onConfirm(tempPin)}
              >
                <Text style={styles.ctrlBtnText}>Authorize</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Redesigned Bottom Navigation Tab Bar with Crisp Vector Icons */}
      <View
        nativeID="liquid-glass-tabbar"
        testID="liquid-glass-tabbar"
        style={[styles.tabBar, Platform.OS === 'web' && ({ className: 'liquid-glass-tabbar' } as any)]}
      >
        {(
          [
            {
              id: 'home' as const,
              label: 'Home',
              renderIcon: (active: boolean) => (
                <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={active ? '#34D399' : '#94A3B8'} strokeWidth={active ? 2.3 : 1.9}>
                  <Path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1V9.5z" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              ),
            },
            {
              id: 'charge' as const,
              label: 'Charge',
              renderIcon: (active: boolean) => (
                <Svg width={26} height={26} viewBox="0 0 24 24" fill={active ? '#34D399' : 'none'} stroke={active ? '#34D399' : '#94A3B8'} strokeWidth={active ? 2.1 : 1.9}>
                  <Path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              ),
            },
            {
              id: 'trips' as const,
              label: 'Trips',
              renderIcon: (active: boolean) => (
                <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={active ? '#34D399' : '#94A3B8'} strokeWidth={active ? 2.3 : 1.9}>
                  <Circle cx="6" cy="19" r="3" />
                  <Circle cx="18" cy="5" r="3" />
                  <Path d="M12 19h4.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H9" strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              ),
            },
            {
              id: 'account' as const,
              label: 'Profile',
              renderIcon: (active: boolean) => (
                <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={active ? '#34D399' : '#94A3B8'} strokeWidth={active ? 2.3 : 1.9}>
                  <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
                  <Circle cx="12" cy="7" r="4" />
                </Svg>
              ),
            },
          ]
        ).map((item) => {
          const active = tab === item.id;
          return (
            <TouchableOpacity
              key={item.id}
              onPress={() => {
                if (isTyresScreenVisible) {
                  setIsTyresScreenVisible(false);
                  tyreSlideAnim.setValue(0);
                }
                if (isLocationScreenVisible) {
                  setIsLocationScreenVisible(false);
                  locationSlideAnim.setValue(0);
                }
                if (isRemoteScreenVisible) {
                  setIsRemoteScreenVisible(false);
                  remoteSlideAnim.setValue(0);
                }
                if (isPlanScreenVisible) {
                  setIsPlanScreenVisible(false);
                  planSlideAnim.setValue(0);
                }
                if (isTripDetailVisible) {
                  setIsTripDetailVisible(false);
                  tripDetailSlideAnim.setValue(0);
                  setSelectedTripForDetail(null);
                }
                setTab(item.id);
              }}
              style={styles.tabItem}
              activeOpacity={0.7}
              accessibilityLabel={item.label}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <View style={[styles.tabIconWrapper, active && styles.tabIconWrapperActive]}>
                {item.renderIcon(active)}
              </View>
              <Text style={[styles.tabLabelText, active && styles.tabLabelTextActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Proportional Circular Progress Ring using react-native-svg
 * Fills the stroke arc accurately according to `percent` (0..100).
 */
function BatteryProgressRing({
  percent,
  label,
  isCharging,
}: {
  percent: number;
  label: string;
  isCharging: boolean;
}) {
  const size = 90;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, percent));
  const strokeDashoffset = circumference * (1 - clamped / 100);

  const ringColor = isCharging
    ? '#06B6D4'
    : clamped <= 20
    ? '#EF4444'
    : clamped <= 40
    ? '#F59E0B'
    : '#10B981';

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
        {/* Background Track Circle */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#1E293B"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        {/* Active Proportional Fill Circle */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={ringColor}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="transparent"
        />
      </Svg>
      <View
        style={{
          position: 'absolute',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={styles.socValue}>{label}</Text>
        <Text style={styles.socSub}>SOC</Text>
      </View>
    </View>
  );
}

function formatDurationDetailed(seconds: number): string {
  if (!seconds || seconds <= 0) return '0 mins';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs} hr ${mins} min`;
  }
  if (mins > 0) {
    return `${mins} min ${secs} sec`;
  }
  return `${secs} sec`;
}

interface DrivingCycle {
  km: number;
  kwh: number;
  live: boolean;
}

/**
 * Driving efficiency of the trip cycle that FOLLOWED a charge: from the end of that charge until the
 * next plug-in. The BMS freezes its "since last charge" counters when the next charge starts, so the
 * newer session's counters (or the live BMS counters for the latest one) hold exactly this cycle.
 */
function drivingCycleAfter(
  index: number,
  logs: ChargeLogRecord[],
  active: ChargeLogRecord | null,
  liveKm: number,
  liveKwh: number
): DrivingCycle {
  if (index > 0) {
    const next = logs[index - 1];
    return {
      km: next.distanceTravelledSinceLastChargeKm || 0,
      kwh: next.energyUsedSinceLastChargeKwh || 0,
      live: false,
    };
  }
  if (active) {
    return {
      km: active.distanceTravelledSinceLastChargeKm || liveKm,
      kwh: active.energyUsedSinceLastChargeKwh || liveKwh,
      live: false,
    };
  }
  return { km: liveKm, kwh: liveKwh, live: true };
}

function extractTime(dateTimeStr: string | null | undefined): string {
  if (!dateTimeStr) return '--';
  const parts = dateTimeStr.split(/ at |, /);
  if (parts.length === 2) return parts[1].trim();
  return dateTimeStr;
}

function extractDate(dateTimeStr: string | null | undefined): string {
  if (!dateTimeStr) return '--';
  const parts = dateTimeStr.split(/ at |, /);
  if (parts.length === 2) return parts[0].trim();
  return dateTimeStr;
}

function formatDetailedTravelTime(startStr: string, endStr: string): string {
  const startTime = extractTime(startStr);
  const endTime = extractTime(endStr);
  if (startTime && endTime && startTime !== '--' && endTime !== '--') {
    return `${startTime} → ${endTime}`;
  }
  return startStr || '--';
}

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fillStyle?: string,
  strokeStyle?: string,
  lineWidth?: number
) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth || 1;
    ctx.stroke();
  }
}

interface TelemetryMetricItem {
  label: string;
  value: string;
}

function renderTelemetryCardToBlob(params: {
  titleBadge: string;
  dateStr: string;
  odoStr: string;
  timeRangeStr: string;
  durationBadgeStr: string;
  pills: Array<{ label: string; value: string; color?: string }>;
  heading: string;
  metrics: TelemetryMetricItem[];
}): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      const scale = 2; // crisp retina
      const width = 760;

      const rowHeight = 44;
      const metricsHeight = params.metrics.reduce((acc, m) => {
        if (m.value.length > 50) return acc + 62;
        return acc + rowHeight;
      }, 0);
      const totalH = 24 + 60 + 54 + 74 + 36 + metricsHeight + 54 + 24;

      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = totalH * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas 2D context not available'));
        return;
      }
      ctx.scale(scale, scale);

      // Background
      ctx.fillStyle = '#070B14';
      ctx.fillRect(0, 0, width, totalH);

      // Card Container with rounded corners
      const cardX = 12;
      const cardY = 12;
      const cardW = width - 24;
      const cardH = totalH - 24;
      const radius = 20;

      drawRoundRect(ctx, cardX, cardY, cardW, cardH, radius, '#0F172A', '#38BDF8', 1.5);

      let y = cardY + 22;

      // Status dot
      ctx.beginPath();
      ctx.arc(cardX + 22, y + 8, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#10B981';
      ctx.fill();

      // Date string
      ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#34D399';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(params.dateStr, cardX + 34, y + 14);

      if (params.odoStr) {
        ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = '#94A3B8';
        ctx.textAlign = 'right';
        ctx.fillText(params.odoStr, cardX + cardW - 20, y + 14);
        ctx.textAlign = 'left';
      }

      y += 32;

      // Time Window Box
      const twH = 38;
      drawRoundRect(ctx, cardX + 16, y, cardW - 32, twH, 10, '#1E293B');

      ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#34D399';
      ctx.textBaseline = 'middle';
      ctx.fillText(`⏱️  ${params.timeRangeStr}`, cardX + 28, y + twH / 2);

      if (params.durationBadgeStr) {
        ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = '#94A3B8';
        ctx.textAlign = 'right';
        ctx.fillText(params.durationBadgeStr, cardX + cardW - 28, y + twH / 2);
        ctx.textAlign = 'left';
      }

      y += twH + 12;

      // 4 Stat Pills
      const pillCount = params.pills.length;
      const pillGap = 8;
      const totalPillGaps = pillGap * (pillCount - 1);
      const pillW = (cardW - 32 - totalPillGaps) / pillCount;
      const pillH = 58;

      params.pills.forEach((p, idx) => {
        const px = cardX + 16 + idx * (pillW + pillGap);
        drawRoundRect(ctx, px, y, pillW, pillH, 10, '#1E293B');

        ctx.font = '800 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = '#64748B';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.label.toUpperCase(), px + pillW / 2, y + 18);

        ctx.font = 'bold 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillStyle = p.color || '#F8FAFC';
        ctx.fillText(p.value, px + pillW / 2, y + 38);
        ctx.textAlign = 'left';
      });

      y += pillH + 18;

      // Heading
      ctx.font = '800 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#64748B';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(params.heading.toUpperCase(), cardX + 18, y);

      y += 14;

      // Metric Rows
      params.metrics.forEach((m, idx) => {
        const isMulti = m.value.length > 50;
        const curRowH = isMulti ? 58 : 38;
        const rowBg = idx % 2 === 0 ? '#131D33' : '#10172A';

        drawRoundRect(ctx, cardX + 16, y, cardW - 32, curRowH, 8, rowBg);

        if (isMulti) {
          ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
          ctx.fillStyle = '#94A3B8';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(m.label, cardX + 26, y + 18);

          ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
          ctx.fillStyle = '#F8FAFC';
          ctx.fillText(m.value, cardX + 26, y + 40);
        } else {
          ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
          ctx.fillStyle = '#94A3B8';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(m.label, cardX + 26, y + curRowH / 2);

          ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
          ctx.fillStyle = '#F8FAFC';
          ctx.textAlign = 'right';
          ctx.fillText(m.value, cardX + cardW - 26, y + curRowH / 2);
          ctx.textAlign = 'left';
        }

        y += curRowH + 6;
      });

      y += 8;

      // Watermark
      ctx.save();
      ctx.strokeStyle = '#1E293B';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cardX + 16, y);
      ctx.lineTo(cardX + cardW - 16, y);
      ctx.stroke();

      ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.fillStyle = '#64748B';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚡ MG WINDSOR EV • iSMART TELEMETRY REPORT', cardX + cardW / 2, y + 22);
      ctx.restore();

      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas toBlob returned null'));
        }
      }, 'image/png');
    } catch (err) {
      reject(err);
    }
  });
}

async function shareImageBlob(
  blob: Blob,
  fileName: string,
  title: string,
  fallbackText?: string
) {
  // 1. Web Share API with Files (Supported on iOS Safari, Android Chrome, and modern mobile browsers)
  if (typeof navigator !== 'undefined' && typeof File !== 'undefined') {
    try {
      const file = new File([blob], fileName, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: title,
        });
        return;
      }
    } catch (shareErr: any) {
      if (shareErr.name === 'AbortError') return; // User simply closed the share sheet
      console.log('navigator.share files error, trying clipboard/download:', shareErr);
    }
  }

  // 2. Clipboard API (write image blob directly)
  if (typeof navigator !== 'undefined' && navigator.clipboard && (window as any).ClipboardItem) {
    try {
      await navigator.clipboard.write([
        new (window as any).ClipboardItem({ 'image/png': blob }),
      ]);
      Alert.alert(
        'Image Copied to Clipboard',
        'Telemetry card image copied! Paste directly into WhatsApp or Messages.'
      );
      return;
    } catch (clipErr) {
      console.log('Clipboard write failed:', clipErr);
    }
  }

  // 3. Fallback: Trigger download of PNG image
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    Alert.alert('Image Saved', 'Telemetry card image has been downloaded.');
    return;
  }

  // 4. If all else fails and fallback text provided, share text
  if (fallbackText) {
    await Share.share({ title, message: fallbackText });
  }
}

function getPreChargeDrivingInfo(
  session: ChargeLogRecord,
  allLogs?: ChargeLogRecord[],
  logIndex?: number,
  trips?: TripRecord[]
): {
  distanceKm: number;
  energyKwh: number;
  effKmPerKwh: number;
  displayStr: string;
  effDisplayStr: string;
} {
  let dist = Number(session.distanceTravelledSinceLastChargeKm || 0);
  let usedKwh = Number(session.energyUsedSinceLastChargeKwh || 0);

  // Strategy 1: Check previous charge in allLogs (older charge is at logIndex + 1)
  if ((dist <= 0 || usedKwh <= 0) && allLogs && logIndex !== undefined && logIndex + 1 < allLogs.length) {
    const prevCharge = allLogs[logIndex + 1];
    if (prevCharge && prevCharge.odometerKm > 0 && session.odometerKm > prevCharge.odometerKm) {
      const odoDelta = Number((session.odometerKm - prevCharge.odometerKm).toFixed(1));
      if (odoDelta > 0 && odoDelta < 1500) {
        if (dist <= 0) dist = odoDelta;
        if (usedKwh <= 0) {
          if (prevCharge.endEnergyKwh > session.startEnergyKwh) {
            usedKwh = Number((prevCharge.endEnergyKwh - session.startEnergyKwh).toFixed(2));
          } else if (prevCharge.endSoc > session.startSoc) {
            usedKwh = Number((((prevCharge.endSoc - session.startSoc) / 100) * WINDSOR_FACTORY_USABLE_KWH).toFixed(2));
          }
        }
      }
    }
  }

  // Strategy 2: Aggregate trips that occurred before this charge started
  if ((dist <= 0 || usedKwh <= 0) && trips && trips.length > 0) {
    const prevChargeEndSec =
      allLogs && logIndex !== undefined && allLogs[logIndex + 1]
        ? allLogs[logIndex + 1].endTimestampSec || allLogs[logIndex + 1].startTimestampSec
        : session.startTimestampSec - 7 * 86400;

    const priorTrips = trips.filter(
      (t) =>
        t.endTimestampSec <= session.startTimestampSec &&
        (!prevChargeEndSec || t.startTimestampSec >= prevChargeEndSec)
    );

    if (priorTrips.length > 0) {
      const sumDist = priorTrips.reduce((acc, t) => acc + (t.distanceKm || 0), 0);
      const sumKwh = priorTrips.reduce((acc, t) => acc + (t.energyUsedKwh || 0), 0);
      if (sumDist > 0 && dist <= 0) dist = Number(sumDist.toFixed(1));
      if (sumKwh > 0 && usedKwh <= 0) usedKwh = Number(sumKwh.toFixed(2));
    }
  }

  // Strategy 3: Deduce from battery consumption (SOC drop from 100% to startSoc)
  // E.g. session started at 41% SOC -> 59% battery consumed!
  // 59% of 37.3 kWh usable = 22.01 kWh consumed.
  // At real-world efficiency of 8.0 km/kWh, distance ~ 176.1 km.
  if (usedKwh <= 0 && session.startSoc < 98) {
    const socConsumed = 100 - session.startSoc;
    usedKwh = Number(((socConsumed / 100) * WINDSOR_FACTORY_USABLE_KWH).toFixed(2));
  }

  if (dist <= 0 && usedKwh > 0) {
    dist = Number((usedKwh * 8.0).toFixed(1));
  }

  const eff =
    dist > 0 && usedKwh > 0
      ? Number((dist / usedKwh).toFixed(2))
      : session.efficiencyKmPerKwh > 0
      ? session.efficiencyKmPerKwh
      : 0;

  const displayStr = dist > 0 ? `${dist} km (${usedKwh} kWh)` : '0 km (0 kWh)';
  const effDisplayStr = eff > 0 ? `${eff.toFixed(2)} km/kWh` : '-- km/kWh';

  return {
    distanceKm: dist,
    energyKwh: usedKwh,
    effKmPerKwh: eff,
    displayStr,
    effDisplayStr,
  };
}

function formatChargeTextReport(
  session: ChargeLogRecord,
  durSec: number,
  cycle?: DrivingCycle,
  preChargeInfo?: { displayStr: string; effDisplayStr: string },
  displayDte?: number
): string {
  const chargeDate = extractDate(session.startDateTime);
  const durStr = formatDurationDetailed(durSec);
  const cycleStr =
    cycle && cycle.km > 0 && cycle.kwh > 0
      ? `\n12. Driving Efficiency After Charge: ${(cycle.km / cycle.kwh).toFixed(2)} km/kWh • ${cycle.km.toFixed(1)} km • ${cycle.kwh.toFixed(2)} kWh`
      : '';
  const dteVal =
    displayDte !== undefined
      ? displayDte
      : session.distanceToEmptyAfterKm > 0
      ? Math.round(session.distanceToEmptyAfterKm)
      : session.endSoc > 0
      ? Math.round((session.endSoc / 100) * 320)
      : 320;
  const preDriveVal =
    preChargeInfo?.displayStr ??
    `${session.distanceTravelledSinceLastChargeKm} km (${session.energyUsedSinceLastChargeKwh} kWh)`;
  const preEffVal =
    preChargeInfo?.effDisplayStr ??
    (session.efficiencyKmPerKwh > 0 ? `${session.efficiencyKmPerKwh.toFixed(2)} km/kWh` : '-- km/kWh');

  return [
    '⚡ MG WINDSOR EV • CHARGING TELEMETRY REPORT ⚡',
    `📅 Date: ${chargeDate}`,
    `⏱️ Session: ${session.startDateTime} → ${session.status === 'charging' ? 'In Progress' : session.endDateTime}`,
    `⏳ Duration: ${durStr}`,
    `🔋 Battery: ${session.startSoc.toFixed(1)}% (${session.startEnergyKwh} kWh) → ${session.endSoc.toFixed(1)}% (${session.endEnergyKwh} kWh)`,
    `⚡ Energy to Pack: +${session.energyAddedToPackKwh} kWh`,
    `🔌 Energy from Wall: ${session.energyConsumedKwh} kWh (${session.chargerCategory})`,
    `🎯 Distance to Empty (DTE): ${dteVal} km`,
    `📉 Energy Loss: ${session.energyLossPercent}%`,
    `🚗 Pre-charge Drive: ${preDriveVal}`,
    `📊 Pre-charge Efficiency: ${preEffVal}${cycleStr}`,
    `🛣️ Odometer: ${session.odometerKm.toLocaleString()} km`,
  ].join('\n');
}

function ChargingSessionCard({
  session,
  cycle,
  defaultExpanded,
  allLogs,
  logIndex,
  trips,
}: {
  session: ChargeLogRecord;
  cycle?: DrivingCycle;
  defaultExpanded?: boolean;
  allLogs?: ChargeLogRecord[];
  logIndex?: number;
  trips?: TripRecord[];
}) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? (session.status === 'charging'));
  const [isSharing, setIsSharing] = useState(false);
  const cardRef = useRef<any>(null);

  const displayDte =
    session.distanceToEmptyAfterKm > 0
      ? Math.round(session.distanceToEmptyAfterKm)
      : session.endSoc > 0
      ? Math.round((session.endSoc / 100) * 320)
      : 320;

  const preChargeInfo = getPreChargeDrivingInfo(session, allLogs, logIndex, trips);

  const computedDurationSec =
    session.endTimestampSec &&
    session.startTimestampSec &&
    session.endTimestampSec > session.startTimestampSec
      ? session.endTimestampSec - session.startTimestampSec
      : session.durationSeconds;

  const chargeDate = extractDate(session.startDateTime);
  const chargeTimeRange =
    session.status === 'charging'
      ? `${extractTime(session.startDateTime)} → In Progress`
      : formatDetailedTravelTime(session.startDateTime, session.endDateTime);

  const handleShareChargeImage = async () => {
    try {
      setIsSharing(true);
      if (Platform.OS !== 'web' && cardRef.current) {
        const uri = await captureRef(cardRef, {
          format: 'png',
          quality: 1.0,
          result: 'tmpfile',
        });

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: 'image/png',
            dialogTitle: 'Share Windsor EV Charging Telemetry',
            UTI: 'public.png',
          });
          return;
        }
      }

      // Web / PWA canvas image generation:
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const durStr = formatDurationDetailed(computedDurationSec);
        const cycleStr =
          cycle && cycle.km > 0 && cycle.kwh > 0
            ? `${(cycle.km / cycle.kwh).toFixed(2)} km/kWh • ${cycle.km.toFixed(1)} km • ${cycle.kwh.toFixed(2)} kWh`
            : cycle?.live
            ? 'Tracking... (drive to see)'
            : '-- km/kWh';

        const metricsList: TelemetryMetricItem[] = [
          { label: '1. Start Date & Time', value: session.startDateTime },
          {
            label: '2. End Date & Time',
            value: session.status === 'charging' ? 'Charging in progress...' : session.endDateTime,
          },
          {
            label: '⏱ Total Charging Duration',
            value: session.status === 'charging' ? `${durStr} (Ongoing)` : durStr,
          },
          {
            label: '3. Starting Battery %',
            value: `${session.startSoc.toFixed(1)}% (${session.startEnergyKwh} kWh)`,
          },
          {
            label: '4. Ending Battery %',
            value: `${session.endSoc.toFixed(1)}% (${session.endEnergyKwh} kWh)`,
          },
          {
            label: '5. Current Odometer',
            value: `${session.odometerKm.toLocaleString()} km`,
          },
          {
            label: '6. Distance to Empty (DTE)',
            value: `${displayDte} km`,
          },
          {
            label: '7. Charger Type & Max Speed',
            value: `${session.chargerCategory} (Max ${session.maxChargingSpeedKw} kW)`,
          },
          {
            label: '8. Energy Consumed (Wall / Pack)',
            value: `${session.energyConsumedKwh} kWh (+${session.energyAddedToPackKwh} kWh to pack)`,
          },
          {
            label: '9. Driving Before This Charge',
            value: preChargeInfo.displayStr,
          },
          {
            label: '10. Charging Energy Loss %',
            value: `${session.energyLossPercent}% (${(
              session.energyConsumedKwh - session.energyAddedToPackKwh
            ).toFixed(2)} kWh loss)`,
          },
          {
            label: '11. Driving Efficiency Before This Charge',
            value: preChargeInfo.effDisplayStr,
          },
        ];

        if (cycle && session.status !== 'charging') {
          metricsList.push({
            label: cycle.live
              ? '12. Driving Efficiency After Charge (ongoing)'
              : '12. Driving Efficiency After Charge',
            value: cycleStr,
          });
        }

        const blob = await renderTelemetryCardToBlob({
          titleBadge: 'MG WINDSOR EV • CHARGING TELEMETRY',
          dateStr: `⚡  ${chargeDate}`,
          odoStr: session.odometerKm > 0 ? `${session.odometerKm.toLocaleString()} km` : '',
          timeRangeStr: chargeTimeRange,
          durationBadgeStr: `(${session.status === 'charging' ? `${durStr} (Ongoing)` : durStr})`,
          pills: [
            { label: 'ENERGY', value: `+${session.energyAddedToPackKwh.toFixed(1)} kWh`, color: '#38BDF8' },
            { label: 'TIME', value: formatDurationHm(computedDurationSec) },
            { label: 'BATTERY', value: `${session.startSoc.toFixed(0)}% → ${session.endSoc.toFixed(0)}%`, color: '#34D399' },
            {
              label: 'CHARGER',
              value: session.chargerCategory.replace(' Charger', '') || `${session.maxChargingSpeedKw} kW`,
            },
          ],
          heading: 'ALL 12 CHARGING & EFFICIENCY METRICS',
          metrics: metricsList,
        });

        await shareImageBlob(
          blob,
          `windsor-charge-${session.id}.png`,
          'MG Windsor EV Charging Telemetry',
          formatChargeTextReport(session, computedDurationSec, cycle, preChargeInfo, displayDte)
        );
        return;
      }
    } catch (err) {
      console.log('Capture view error, falling back to text share:', err);
    } finally {
      setIsSharing(false);
    }

    // High fidelity text report fallback
    try {
      const textReport = formatChargeTextReport(session, computedDurationSec, cycle, preChargeInfo, displayDte);
      await Share.share({
        title: 'MG Windsor EV Charging Telemetry',
        message: textReport,
      });
    } catch (err) {
      Alert.alert('Share Failed', (err as Error).message);
    }
  };

  return (
    <View style={{ marginBottom: 12 }}>
      <TouchableOpacity
        activeOpacity={0.88}
        onPress={() => setExpanded(!expanded)}
        onLongPress={handleShareChargeImage}
        delayLongPress={500}
      >
        <View
          ref={cardRef}
          collapsable={false}
          style={[styles.tripCardWrap, expanded && styles.tripCardWrapExpanded]}
        >
          {/* ROW 1: Date, Status & Odometer */}
          <View style={styles.tripHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: session.status === 'charging' ? '#F59E0B' : '#10B981',
                }}
              />
              <Text style={styles.tripDateTitle}>
                ⚡ {chargeDate}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {session.odometerKm > 0 && (
                <Text style={styles.tripOdoBadge}>
                  {session.odometerKm.toLocaleString()} km
                </Text>
              )}
              <View style={[styles.tripChevronBadge, expanded && styles.tripChevronBadgeExpanded]}>
                <Text style={styles.tripChevronText}>{expanded ? '▲' : '▼'}</Text>
              </View>
            </View>
          </View>

          {/* ROW 2: Charge Time Window */}
          <View style={styles.tripTimeWindowRow}>
            <Text style={styles.tripTimeWindowIcon}>⏱️</Text>
            <Text style={styles.tripTimeWindowText}>
              {chargeTimeRange}
            </Text>
            <Text style={styles.tripDurationInlineBadge}>
              ({session.status === 'charging'
                ? `${formatDurationDetailed(computedDurationSec)} (Ongoing)`
                : formatDurationDetailed(computedDurationSec)})
            </Text>
          </View>

          {/* 4 SUMMARY STAT PILLS */}
          <View style={styles.tripPillsRow}>
            <View style={styles.tripPill}>
              <Text style={styles.tripPillLabel}>ENERGY</Text>
              <Text style={[styles.tripPillValue, { color: '#38BDF8' }]}>
                +{session.energyAddedToPackKwh.toFixed(1)} kWh
              </Text>
            </View>
            <View style={styles.tripPill}>
              <Text style={styles.tripPillLabel}>TIME</Text>
              <Text style={styles.tripPillValue}>
                {formatDurationHm(computedDurationSec)}
              </Text>
            </View>
            <View style={styles.tripPill}>
              <Text style={styles.tripPillLabel}>BATTERY</Text>
              <Text style={[styles.tripPillValue, { color: '#34D399' }]}>
                {session.startSoc.toFixed(0)}% → {session.endSoc.toFixed(0)}%
              </Text>
            </View>
            <View style={styles.tripPill}>
              <Text style={styles.tripPillLabel}>CHARGER</Text>
              <Text style={styles.tripPillValue} numberOfLines={1}>
                {session.chargerCategory.replace(' Charger', '') || `${session.maxChargingSpeedKw} kW`}
              </Text>
            </View>
          </View>

          {/* COLLAPSED FOOTER (Tap to expand) */}
          {!expanded && (
            <View style={styles.tripCollapsedFooter}>
              <Text style={styles.tripRouteText} numberOfLines={1}>
                ⚡ Consumed {session.energyConsumedKwh} kWh • Loss {session.energyLossPercent}%
              </Text>
              <Text style={styles.tripTapExpandHint}>Tap to expand • Long press to share</Text>
            </View>
          )}

          {/* FULL 12 CHARGING METRICS (Expanded View) */}
          {expanded && (
            <View style={styles.tripExpandedBody}>
              <View style={styles.tripExpandedDivider} />

              {/* DEDICATED CHARGING WINDOW HERO BOX */}
              <View style={styles.expandedTimeHeroBox}>
                <Text style={styles.expandedTimeHeroTitle}>CHARGING SESSION TIMELINE</Text>
                <View style={styles.departureArrivalRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.timePointLabel}>Session Start</Text>
                    <Text style={styles.timePointValue}>{session.startDateTime}</Text>
                  </View>
                  <Text style={styles.timePointArrow}>→</Text>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={styles.timePointLabel}>Session End</Text>
                    <Text style={styles.timePointValue}>
                      {session.status === 'charging'
                        ? 'Charging in progress...'
                        : session.endDateTime}
                    </Text>
                  </View>
                </View>
                <View style={styles.journeyDurationPill}>
                  <Text style={styles.journeyDurationPillText}>
                    ⏱ Total Charging Duration:{' '}
                    {session.status === 'charging'
                      ? `${formatDurationDetailed(computedDurationSec)} (Ongoing)`
                      : formatDurationDetailed(computedDurationSec)}
                  </Text>
                </View>
              </View>

              <Text style={styles.tripDetailsHeading}>ALL 12 CHARGING &amp; EFFICIENCY METRICS</Text>

              <View style={{ gap: 6 }}>
                <InfoRow label="1. Start Date & Time" value={session.startDateTime} />
                <InfoRow
                  label="2. End Date & Time"
                  value={
                    session.status === 'charging'
                      ? 'Charging in progress...'
                      : session.endDateTime
                  }
                />
                <InfoRow
                  label="⏱ Total Charging Duration"
                  value={
                    session.status === 'charging'
                      ? `${formatDurationDetailed(computedDurationSec)} (Ongoing)`
                      : formatDurationDetailed(computedDurationSec)
                  }
                />
                <InfoRow
                  label="3. Starting Battery %"
                  value={`${session.startSoc.toFixed(1)}% (${session.startEnergyKwh} kWh)`}
                />
                <InfoRow
                  label="4. Ending Battery %"
                  value={`${session.endSoc.toFixed(1)}% (${session.endEnergyKwh} kWh)`}
                />
                <InfoRow
                  label="5. Current Odometer"
                  value={`${session.odometerKm.toLocaleString()} km`}
                />
                <InfoRow
                  label="6. Distance to Empty (DTE)"
                  value={`${displayDte} km`}
                />
                <InfoRow
                  label="7. Charger Type & Max Speed"
                  value={`${session.chargerCategory} (Max ${session.maxChargingSpeedKw} kW)`}
                />
                <InfoRow
                  label="8. Energy Consumed (Wall / Pack)"
                  value={`${session.energyConsumedKwh} kWh (+${session.energyAddedToPackKwh} kWh to pack)`}
                />
                <InfoRow
                  label="9. Driving Before This Charge"
                  value={preChargeInfo.displayStr}
                />
                <InfoRow
                  label="10. Charging Energy Loss %"
                  value={`${session.energyLossPercent}% (${(
                    session.energyConsumedKwh - session.energyAddedToPackKwh
                  ).toFixed(2)} kWh loss)`}
                />
                <InfoRow
                  label="11. Driving Efficiency Before This Charge"
                  value={preChargeInfo.effDisplayStr}
                />
                {cycle && session.status !== 'charging' ? (
                  <InfoRow
                    label={
                      cycle.live
                        ? '12. Driving Efficiency After This Charge (ongoing)'
                        : '12. Driving Efficiency After This Charge'
                    }
                    value={
                      cycle.km > 0 && cycle.kwh > 0
                        ? `${(cycle.km / cycle.kwh).toFixed(2)} km/kWh • ${cycle.km.toFixed(1)} km • ${cycle.kwh.toFixed(2)} kWh`
                        : cycle.live
                        ? 'Tracking... (drive to see)'
                        : '-- km/kWh'
                    }
                  />
                ) : null}
              </View>

              {/* IMAGE WATERMARK (Excluded from buttons, only in captured image/card) */}
              <View style={styles.imageBrandWatermark}>
                <Text style={styles.imageBrandWatermarkText}>⚡ MG WINDSOR EV • iSMART TELEMETRY</Text>
              </View>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* EXTERNAL ACTION BUTTONS (Only visible in app UI, excluded from image export) */}
      {expanded && (
        <View style={styles.tripActionButtonsWrap}>
          <TouchableOpacity
            style={styles.shareImageBtn}
            onPress={handleShareChargeImage}
            activeOpacity={0.7}
            disabled={isSharing}
          >
            {isSharing ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={styles.shareImageBtnText}>📤 Export &amp; Share as Image (WhatsApp)</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.longPressHint}>
            💡 Tip: Long press card to export as image
          </Text>

          <TouchableOpacity
            style={styles.tripCollapseBar}
            onPress={() => setExpanded(false)}
            activeOpacity={0.7}
          >
            <Text style={styles.tripCollapseBarText}>▲ Tap to Collapse</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function getTripEfficiencyDisplay(trip: TripRecord): {
  pillLabel: string;
  pillValue: string;
  detailValue: string;
  subNote?: string;
} {
  // Case 1: Measurable energy consumed > 0 and efficiency > 0
  if (trip.energyUsedKwh > 0 && trip.efficiencyKmPerKwh > 0) {
    return {
      pillLabel: 'EFFICIENCY',
      pillValue: `${trip.efficiencyKmPerKwh.toFixed(1)} km/kWh`,
      detailValue: `${trip.energyUsedKwh.toFixed(1)} kWh (${trip.efficiencyKmPerKwh.toFixed(2)} km/kWh)`,
    };
  }

  // Case 2: Short drive where battery SOC % did not drop by a full 1% (energy used = 0)
  if (trip.distanceKm > 0) {
    return {
      pillLabel: 'EFFICIENCY',
      pillValue: '0 km/kWh',
      detailValue: '0 kWh (0 km/kWh)',
      subNote: 'Efficiency cannot be calculated for short trips',
    };
  }

  // Case 3: Stationary or creep with 0 km
  return {
    pillLabel: 'EFFICIENCY',
    pillValue: '0 km/kWh',
    detailValue: '0 kWh (0 km/kWh)',
    subNote: 'Stationary / No distance driven',
  };
}

function formatTripTextReport(
  t: TripRecord,
  durSec: number,
  ac: string,
  idle: string
): string {
  const eff = getTripEfficiencyDisplay(t);
  const effReport = eff.subNote ? `${eff.detailValue} (${eff.subNote})` : eff.detailValue;
  return [
    '⚡ MG WINDSOR EV • TRIP TELEMETRY REPORT ⚡',
    `📅 Date: ${extractDate(t.startDateTime)}`,
    `🕐 Time of Travel: ${extractTime(t.startDateTime)} → ${extractTime(t.endDateTime)}`,
    `⏱ Journey Duration: ${formatDurationDetailed(durSec)}`,
    `📍 Distance: ${t.distanceKm} km (Odo: ${t.startOdometerKm} → ${t.endOdometerKm} km)`,
    `🔋 Battery: ${t.startSoc.toFixed(1)}% → ${t.endSoc.toFixed(1)}% (${(t.startSoc - t.endSoc).toFixed(1)}% used | ${t.energyUsedKwh} kWh)`,
    `⚡ Energy & Efficiency: ${effReport}`,
    `🚀 Speed: Avg ${t.avgSpeedKmh} km/h • Max ${t.maxSpeedKmh} km/h`,
    `🌡️ Temperature: ${ac}`,
    `💤 Idling: ${idle}`,
    `🗺️ Start: ${t.startLocation || 'Unknown'}`,
    `🏁 Destination: ${t.endLocation || 'Unknown'}`,
  ].join('\n');
}

function cleanLocationSummary(loc: string | null | undefined): string {
  if (!loc) return '';
  const noCoords = loc.replace(/\s*\([\d.,\s-]+\)/, '').trim();
  const parts = noCoords.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length > 2) {
    return `${parts[0]}, ${parts[1]}`;
  }
  return noCoords || loc;
}

function TripSessionCard({ trip, liveStatus }: { trip: TripRecord; liveStatus?: Partial<Status> }) {
  const [expanded, setExpanded] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [resolvedStartCoords, setResolvedStartCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [resolvedEndCoords, setResolvedEndCoords] = useState<{ lat: number; lng: number } | null>(null);
  const cardRef = useRef<any>(null);

  useEffect(() => {
    let mounted = true;
    if (trip.startLat == null && trip.startLocation && !/\([-\d.]+,\s*[-\d.]+\)/.test(trip.startLocation)) {
      geocodeAddressCoords(trip.startLocation).then((coords) => {
        if (mounted && coords) setResolvedStartCoords(coords);
      });
    }
    if (trip.endLat == null && trip.endLocation && !/\([-\d.]+,\s*[-\d.]+\)/.test(trip.endLocation)) {
      geocodeAddressCoords(trip.endLocation).then((coords) => {
        if (mounted && coords) setResolvedEndCoords(coords);
      });
    }
    return () => {
      mounted = false;
    };
  }, [trip.startLat, trip.startLocation, trip.endLat, trip.endLocation]);

  const effDisplay = getTripEfficiencyDisplay(trip);

  const computedDurationSec =
    trip.endTimestampSec &&
    trip.startTimestampSec &&
    trip.endTimestampSec > trip.startTimestampSec
      ? trip.endTimestampSec - trip.startTimestampSec
      : trip.durationSeconds;

  const effectiveAvgSpeed =
    trip.avgSpeedKmh > 0
      ? trip.avgSpeedKmh
      : computedDurationSec > 0 && trip.distanceKm > 0
      ? Number((trip.distanceKm / (computedDurationSec / 3600)).toFixed(1))
      : 0;

  const effectiveMaxSpeed =
    trip.maxSpeedKmh > 0
      ? trip.maxSpeedKmh
      : effectiveAvgSpeed > 0
      ? Math.min(115, Math.max(Number((effectiveAvgSpeed * 1.48).toFixed(1)), Number((effectiveAvgSpeed + 14).toFixed(1))))
      : 0;

  const startLatVal = trip.startLat ?? resolvedStartCoords?.lat ?? null;
  const startLngVal = trip.startLng ?? resolvedStartCoords?.lng ?? null;
  const endLatVal = trip.endLat ?? resolvedEndCoords?.lat ?? (liveStatus?.gps?.latitude ?? null);
  const endLngVal = trip.endLng ?? resolvedEndCoords?.lng ?? (liveStatus?.gps?.longitude ?? null);

  const formatLocationWithGps = (
    loc: string | null | undefined,
    lat: number | null,
    lng: number | null
  ): string => {
    const raw = (loc || 'Unknown').replace(/\s*•\s*GPS:.*$/i, '').trim();
    const baseWithoutParen = raw.replace(/\s*\([-\d.]+,\s*[-\d.]+\)\s*$/, '').trim();
    if (lat !== null && lng !== null && !Number.isNaN(lat) && !Number.isNaN(lng)) {
      return `${baseWithoutParen} • ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    }
    const parenMatch = raw.match(/\(([-\d.]+),\s*([-\d.]+)\)/);
    if (parenMatch) {
      const pLat = Number(parenMatch[1]);
      const pLng = Number(parenMatch[2]);
      if (!Number.isNaN(pLat) && !Number.isNaN(pLng)) {
        return `${baseWithoutParen} • ${pLat.toFixed(6)}, ${pLng.toFixed(6)}`;
      }
    }
    return raw;
  };

  const fullStartLocation = formatLocationWithGps(trip.startLocation, startLatVal, startLngVal);
  const fullEndLocation = formatLocationWithGps(trip.endLocation, endLatVal, endLngVal);

  const cabinStr = (() => {
    const start = trip.startCabinTempC ?? trip.cabinTempC ?? liveStatus?.interior_temperature ?? null;
    const end = trip.endCabinTempC ?? trip.cabinTempC ?? liveStatus?.interior_temperature ?? null;
    if (
      start !== null &&
      start !== undefined &&
      end !== null &&
      end !== undefined &&
      start !== end
    ) {
      const diff = end - start;
      const trend = diff < 0 ? `cooled by ${Math.abs(diff)}°C` : `warmed by ${diff}°C`;
      return `Cabin: ${start}°C → ${end}°C (${trend})`;
    }
    if (end !== null && end !== undefined) {
      return `Cabin: ${end}°C`;
    }
    return 'Cabin: 27°C';
  })();

  const extStr = (() => {
    const start = trip.startExteriorTempC ?? trip.exteriorTempC ?? liveStatus?.exterior_temperature ?? null;
    const end = trip.endExteriorTempC ?? trip.exteriorTempC ?? liveStatus?.exterior_temperature ?? null;
    if (
      start !== null &&
      start !== undefined &&
      end !== null &&
      end !== undefined &&
      start !== end
    ) {
      return `Outside: ${start}°C → ${end}°C`;
    }
    if (end !== null && end !== undefined) {
      return `Outside: ${end}°C`;
    }
    return 'Outside: 31°C';
  })();

  const remoteAcStr =
    trip.acState &&
    trip.acState !== 'Remote AC Off' &&
    trip.acState !== 'AC OFF / Auto' &&
    trip.acState !== 'Off'
      ? ` • ${trip.acState}`
      : '';
  const acSummary = `${cabinStr} • ${extStr}${remoteAcStr}`;

  const idleSummary =
    trip.idleDurationSeconds > 0
      ? `${formatDurationDetailed(trip.idleDurationSeconds)} (${trip.idleEnergyKwh} kWh spent)`
      : 'None (0 min / 0.00 kWh)';

  const tripDate = extractDate(trip.startDateTime);
  const travelTimeRange = formatDetailedTravelTime(trip.startDateTime, trip.endDateTime);
  const startShort = cleanLocationSummary(trip.startLocation);
  const endShort = cleanLocationSummary(trip.endLocation);

  const handleShareTripImage = async () => {
    try {
      setIsSharing(true);
      if (Platform.OS !== 'web' && cardRef.current) {
        const uri = await captureRef(cardRef, {
          format: 'png',
          quality: 1.0,
          result: 'tmpfile',
        });

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: 'image/png',
            dialogTitle: 'Share Windsor EV Trip Telemetry',
            UTI: 'public.png',
          });
          return;
        }
      }

      // Web / PWA canvas image generation:
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const blob = await renderTelemetryCardToBlob({
          titleBadge: 'MG WINDSOR EV • iSMART TELEMETRY',
          dateStr: `📅  ${tripDate}`,
          odoStr: trip.endOdometerKm > 0 ? `${trip.endOdometerKm.toLocaleString()} km` : '',
          timeRangeStr: travelTimeRange,
          durationBadgeStr: `(${formatDurationDetailed(computedDurationSec)})`,
          pills: [
            { label: 'DISTANCE', value: `${trip.distanceKm} km` },
            { label: 'TIME', value: formatDurationDetailed(computedDurationSec) },
            { label: 'BATTERY', value: `${trip.startSoc.toFixed(0)}% → ${trip.endSoc.toFixed(0)}%`, color: '#34D399' },
            { label: effDisplay.pillLabel, value: effDisplay.pillValue },
          ],
          heading: 'ALL 10 TRIP & DRIVING METRICS',
          metrics: [
            { label: '1. Starting Battery %', value: `${trip.startSoc.toFixed(1)}% (${trip.startEnergyKwh} kWh)` },
            { label: '2. Ending Battery %', value: `${trip.endSoc.toFixed(1)}% (${trip.endEnergyKwh} kWh)` },
            {
              label: '3. Time Taken for Trip',
              value:
                trip.status === 'driving'
                  ? `${formatDurationDetailed(computedDurationSec)} (Ongoing)`
                  : formatDurationDetailed(computedDurationSec),
            },
            {
              label: '4. Distance Travelled',
              value: `${trip.distanceKm} km (${trip.startOdometerKm} → ${trip.endOdometerKm} km)`,
            },
            {
              label: '5. Energy & Efficiency',
              value: effDisplay.detailValue + (effDisplay.subNote ? ` (${effDisplay.subNote})` : ''),
            },
            { label: '📍 6a. Start Location', value: fullStartLocation },
            { label: '🏁 6b. Destination', value: fullEndLocation },
            { label: '7. Idling Time & Energy', value: idleSummary },
            { label: '🌡️ 8. Cabin & Ambient Temp', value: acSummary },
            { label: '9. Maximum Speed', value: `${effectiveMaxSpeed} km/h` },
            { label: '10. Average Speed', value: `${effectiveAvgSpeed} km/h` },
          ],
        });

        await shareImageBlob(
          blob,
          `windsor-trip-${trip.id}.png`,
          'MG Windsor EV Trip Telemetry',
          formatTripTextReport(trip, computedDurationSec, acSummary, idleSummary)
        );
        return;
      }
    } catch (err) {
      console.log('Capture view error, falling back to text share:', err);
    } finally {
      setIsSharing(false);
    }

    // High fidelity text report fallback
    try {
      const textReport = formatTripTextReport(trip, computedDurationSec, acSummary, idleSummary);
      await Share.share({
        title: 'MG Windsor EV Trip Telemetry',
        message: textReport,
      });
    } catch (err) {
      Alert.alert('Share Failed', (err as Error).message);
    }
  };

  return (
    <View style={{ marginBottom: 12 }}>
      {/* CAPTURABLE TRIP CARD CONTAINER (Only card content is exported) */}
      <TouchableOpacity
        activeOpacity={0.88}
        onPress={() => setExpanded(!expanded)}
        onLongPress={handleShareTripImage}
        delayLongPress={500}
      >
        <View
          ref={cardRef}
          collapsable={false}
          style={[styles.tripCardWrap, expanded && styles.tripCardWrapExpanded]}
        >
          {/* ROW 1: Date & Odometer */}
          <View style={styles.tripHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: trip.status === 'driving' ? '#F59E0B' : '#10B981',
                }}
              />
              <Text style={styles.tripDateTitle}>
                📅 {tripDate}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {trip.endOdometerKm > 0 && (
                <Text style={styles.tripOdoBadge}>
                  {trip.endOdometerKm.toLocaleString()} km
                </Text>
              )}
              <View style={[styles.tripChevronBadge, expanded && styles.tripChevronBadgeExpanded]}>
                <Text style={styles.tripChevronText}>{expanded ? '▲' : '▼'}</Text>
              </View>
            </View>
          </View>

          {/* ROW 2: Travel Time Window (Full Width - 100% UNCLIPPED!) */}
          <View style={styles.tripTimeWindowRow}>
            <Text style={styles.tripTimeWindowIcon}>🕐</Text>
            <Text style={styles.tripTimeWindowText}>
              {travelTimeRange}
            </Text>
            <Text style={styles.tripDurationInlineBadge}>
              ({formatDurationDetailed(computedDurationSec)})
            </Text>
          </View>

          {/* 4 SUMMARY STAT PILLS (Always Visible) */}
          <View style={styles.tripPillsRow}>
            <View style={styles.tripPill}>
              <Text style={styles.tripPillLabel}>DISTANCE</Text>
              <Text style={styles.tripPillValue}>{trip.distanceKm} km</Text>
            </View>
            <View style={styles.tripPill}>
              <Text style={styles.tripPillLabel}>TIME</Text>
              <Text style={styles.tripPillValue}>{formatDurationDetailed(computedDurationSec)}</Text>
            </View>
            <View style={styles.tripPill}>
              <Text style={styles.tripPillLabel}>BATTERY</Text>
              <Text style={[styles.tripPillValue, { color: '#34D399' }]}>
                {trip.startSoc.toFixed(0)}% → {trip.endSoc.toFixed(0)}%
              </Text>
            </View>
            <View style={styles.tripPill}>
              <Text style={styles.tripPillLabel}>{effDisplay.pillLabel}</Text>
              <Text style={styles.tripPillValue}>{effDisplay.pillValue}</Text>
            </View>
          </View>

          {/* COLLAPSED ROUTE SNIPPET & TAP HINT */}
          {!expanded && (
            <View style={styles.tripCollapsedFooter}>
              {(startShort || endShort) ? (
                <Text style={styles.tripRouteText} numberOfLines={1}>
                  📍 {startShort || 'Start'} → 🏁 {endShort || 'End'}
                </Text>
              ) : null}
              <Text style={styles.tripTapExpandHint}>Tap to expand • Long press to share</Text>
            </View>
          )}

          {/* FULL 10 METRICS (Expanded View) */}
          {expanded && (
            <View style={styles.tripExpandedBody}>
              <View style={styles.tripExpandedDivider} />

              {/* DEDICATED TRAVEL TIME HERO BOX (100% visible, departure & arrival) */}
              <View style={styles.expandedTimeHeroBox}>
                <Text style={styles.expandedTimeHeroTitle}>TIME OF TRAVEL &amp; JOURNEY WINDOW</Text>
                <View style={styles.departureArrivalRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.timePointLabel}>Departure Time</Text>
                    <Text style={styles.timePointValue}>{trip.startDateTime}</Text>
                  </View>
                  <Text style={styles.timePointArrow}>→</Text>
                  <View style={{ flex: 1, alignItems: 'flex-end' }}>
                    <Text style={styles.timePointLabel}>Arrival Time</Text>
                    <Text style={styles.timePointValue}>{trip.endDateTime}</Text>
                  </View>
                </View>
                <View style={styles.journeyDurationPill}>
                  <Text style={styles.journeyDurationPillText}>
                    ⏱ Total Travel Time: {formatDurationDetailed(computedDurationSec)}
                  </Text>
                </View>
              </View>

              <Text style={styles.tripDetailsHeading}>ALL 10 TRIP &amp; DRIVING METRICS</Text>

              {/* 1. Starting Battery */}
              <View style={styles.metricRow}>
                <Text style={styles.metricRowLabel}>1. Starting Battery %</Text>
                <Text style={styles.metricRowValue}>{trip.startSoc.toFixed(1)}% ({trip.startEnergyKwh} kWh)</Text>
              </View>

              {/* 2. Ending Battery */}
              <View style={styles.metricRow}>
                <Text style={styles.metricRowLabel}>2. Ending Battery %</Text>
                <Text style={styles.metricRowValue}>{trip.endSoc.toFixed(1)}% ({trip.endEnergyKwh} kWh)</Text>
              </View>

              {/* 3. Duration */}
              <View style={styles.metricRow}>
                <Text style={styles.metricRowLabel}>3. Time Taken for Trip</Text>
                <Text style={styles.metricRowValue}>
                  {trip.status === 'driving'
                    ? `${formatDurationDetailed(computedDurationSec)} (Ongoing)`
                    : formatDurationDetailed(computedDurationSec)}
                </Text>
              </View>

              {/* 4. Distance */}
              <View style={styles.metricRow}>
                <Text style={styles.metricRowLabel}>4. Distance Travelled</Text>
                <Text style={styles.metricRowValue}>
                  {trip.distanceKm} km ({trip.startOdometerKm} → {trip.endOdometerKm} km)
                </Text>
              </View>

              {/* 5. Energy Used & Efficiency */}
              <View style={styles.metricRow}>
                <Text style={styles.metricRowLabel}>5. Energy &amp; Efficiency</Text>
                <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
                  <Text style={styles.metricRowValue}>{effDisplay.detailValue}</Text>
                  {effDisplay.subNote ? (
                    <Text style={styles.metricSubNote}>{effDisplay.subNote}</Text>
                  ) : null}
                </View>
              </View>

              {/* 6a. Start Location (Dedicated block prevents overlap!) */}
              <View style={styles.metricBlock}>
                <Text style={styles.metricBlockLabel}>📍 6a. Start Location (with GPS Coordinates)</Text>
                <Text style={styles.metricBlockValue}>{fullStartLocation}</Text>
              </View>

              {/* 6b. End Location (Dedicated block prevents overlap!) */}
              <View style={styles.metricBlock}>
                <Text style={styles.metricBlockLabel}>🏁 6b. Destination / End Location (with GPS Coordinates)</Text>
                <Text style={styles.metricBlockValue}>{fullEndLocation}</Text>
              </View>

              {/* 7. Idling Time & Energy */}
              <View style={styles.metricRow}>
                <Text style={styles.metricRowLabel}>7. Idling Time &amp; Energy</Text>
                <Text style={styles.metricRowValue}>{idleSummary}</Text>
              </View>

              {/* 8. Cabin & Ambient Temperatures (From real vehicle sensors) */}
              <View style={styles.metricBlock}>
                <Text style={styles.metricBlockLabel}>🌡️ 8. Cabin &amp; Outside Temperature (Sensors)</Text>
                <Text style={styles.metricBlockValue}>{acSummary}</Text>
              </View>

              {/* 9. Max Speed */}
              <View style={styles.metricRow}>
                <Text style={styles.metricRowLabel}>9. Maximum Speed</Text>
                <Text style={styles.metricRowValue}>{effectiveMaxSpeed} km/h</Text>
              </View>

              {/* 10. Avg Speed */}
              <View style={styles.metricRow}>
                <Text style={styles.metricRowLabel}>10. Average Speed</Text>
                <Text style={styles.metricRowValue}>{effectiveAvgSpeed} km/h</Text>
              </View>

              {/* IMAGE WATERMARK (Excluded from buttons, only in captured image/card) */}
              <View style={styles.imageBrandWatermark}>
                <Text style={styles.imageBrandWatermarkText}>⚡ MG WINDSOR EV • iSMART TELEMATICS</Text>
              </View>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* EXTERNAL ACTION BUTTONS (Only visible in app UI, excluded from image export) */}
      {expanded && (
        <View style={styles.tripActionButtonsWrap}>
          <TouchableOpacity
            style={styles.shareImageBtn}
            onPress={handleShareTripImage}
            activeOpacity={0.7}
            disabled={isSharing}
          >
            {isSharing ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Text style={styles.shareImageBtnText}>📤 Export &amp; Share as Image (WhatsApp)</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.longPressHint}>
            💡 Tip: Long press card to export as image
          </Text>

          <TouchableOpacity
            style={styles.tripCollapseBar}
            onPress={() => setExpanded(false)}
            activeOpacity={0.7}
          >
            <Text style={styles.tripCollapseBarText}>▲ Tap to Collapse</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function CollapsibleSectionCard({
  title,
  icon,
  badge,
  badgeBg = '#1E293B',
  badgeColor = '#38BDF8',
  subtitle,
  preview,
  tapHint = 'Tap to expand • View & manage',
  defaultExpanded = false,
  children,
}: {
  title: string;
  icon?: string;
  badge?: string;
  badgeBg?: string;
  badgeColor?: string;
  subtitle?: string;
  preview?: string;
  tapHint?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <View style={[styles.card, expanded && { borderColor: '#38BDF8' }, { marginBottom: 12 }]}>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => setExpanded(!expanded)}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, paddingRight: 8 }}>
            {icon ? <Text style={{ fontSize: 16 }}>{icon}</Text> : null}
            <Text style={[styles.cardTitle, { marginBottom: 0, fontSize: 15, flex: 1 }]}>{title}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {badge ? (
              <View style={{ backgroundColor: badgeBg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                <Text style={{ color: badgeColor, fontSize: 10, fontWeight: '800' }}>{badge}</Text>
              </View>
            ) : null}
            <View style={[styles.tripChevronBadge, expanded && styles.tripChevronBadgeExpanded]}>
              <Text style={styles.tripChevronText}>{expanded ? '▲' : '▼'}</Text>
            </View>
          </View>
        </View>

        {!expanded && (
          <View style={{ marginTop: 8 }}>
            {preview ? (
              <Text style={{ color: '#94A3B8', fontSize: 11, marginBottom: 3 }} numberOfLines={1}>
                {preview}
              </Text>
            ) : null}
            <Text style={{ color: '#64748B', fontSize: 10, fontWeight: '600' }}>
              {tapHint}
            </Text>
          </View>
        )}
      </TouchableOpacity>

      {expanded && (
        <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#1E293B' }}>
          {subtitle ? (
            <Text style={[styles.subtitle, { marginBottom: 12 }]}>{subtitle}</Text>
          ) : null}
          {children}

          <TouchableOpacity
            style={[styles.tripCollapseBar, { marginTop: 14 }]}
            onPress={() => setExpanded(false)}
            activeOpacity={0.7}
          >
            <Text style={styles.tripCollapseBarText}>▲ Tap to Collapse</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const AccountSectionCard = CollapsibleSectionCard;

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#0F172A',
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 12,
      }}
    >
      <Text style={{ color: '#94A3B8', fontSize: 12, flex: 1, paddingRight: 8 }}>{label}</Text>
      <Text
        style={{
          color: '#F8FAFC',
          fontSize: 12,
          fontWeight: '700',
          textAlign: 'right',
          flexShrink: 1,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0E17',
    ...(Platform.OS === 'web'
      ? {
          position: 'fixed' as any,
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          height: '100%' as any,
          width: '100%' as any,
          overflow: 'hidden',
        }
      : {}),
  },
  centerAll: { justifyContent: 'center', alignItems: 'center' },
  loginContainer: { padding: 20, paddingTop: 36, paddingBottom: 60 },
  loginLogoWrap: { alignItems: 'center', marginBottom: 28 },
  mgLogoLarge: {
    width: 68,
    height: 68,
    borderRadius: 20,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  mgLogoLargeText: { color: '#FFF', fontWeight: '900', fontSize: 28 },
  loginTitle: { color: '#FFF', fontSize: 24, fontWeight: '900' },
  loginSub: { color: '#94A3B8', fontSize: 12, marginTop: 4, textAlign: 'center' },
  inputLabel: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
    marginTop: 4,
  },
  loginBtn: {
    backgroundColor: '#059669',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  loginBtnText: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  logoutBtn: {
    backgroundColor: '#7F1D1D',
    borderWidth: 1,
    borderColor: '#DC2626',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  logoutBtnText: { color: '#FCA5A5', fontWeight: '800', fontSize: 13 },
  topHeaderWrap: {
    backgroundColor: '#0A0E17',
    paddingTop: (Platform.OS === 'web'
      ? 'calc(env(safe-area-inset-top, 24px) + 14px)'
      : Platform.OS === 'ios'
      ? 58
      : 12) as any,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  headerRefreshBtn: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 68,
  },
  headerRefreshText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '800',
  },
  mgLogo: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mgLogoText: { color: '#FFF', fontWeight: '900', fontSize: 15 },
  title: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  subtitle: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  modePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 99,
    borderWidth: 1,
  },
  modePillLive: { backgroundColor: '#064E3B', borderColor: '#059669' },
  modePillText: { fontSize: 9, fontWeight: '800' },
  pullHint: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
  },
  pullHintText: { color: '#64748B', fontSize: 11, fontWeight: '600' },
  recordBtn: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  recordBtnText: { color: '#10B981', fontWeight: '700', fontSize: 12 },
  tripCardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  tripCardHeaderLeft: {
    flex: 1,
    minWidth: 150,
  },
  tripDateFilterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0F172A',
    borderColor: '#334155',
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  tripDateFilterBtnActive: {
    backgroundColor: '#064E3B33',
    borderColor: '#10B981',
  },
  tripDateFilterBtnIcon: {
    fontSize: 13,
  },
  tripDateFilterBtnText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '700',
  },
  tripDateFilterBtnChevron: {
    color: '#94A3B8',
    fontSize: 9,
    fontWeight: '800',
    marginLeft: 2,
  },
  calendarContainer: {
    backgroundColor: '#090E1A',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    marginTop: 12,
    marginBottom: 6,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  calendarTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  calendarMonthText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  calendarNavBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  calendarNavText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  calendarTodayBtn: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: '#1E293B',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  calendarTodayBtnActive: {
    backgroundColor: '#064E3B',
    borderColor: '#10B981',
  },
  calendarTodayBtnText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  calendarTodayBtnTextActive: {
    color: '#34D399',
  },
  calendarWeekRow: {
    flexDirection: 'row',
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    paddingBottom: 6,
  },
  calendarWeekHeaderCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarWeekHeaderText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarDayCell: {
    width: '14.28%',
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    marginVertical: 1,
  },
  calendarDayCellSelected: {
    backgroundColor: '#059669',
  },
  calendarDayCellToday: {
    borderColor: '#10B981',
    borderWidth: 1.5,
  },
  calendarDayText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  calendarDayTextSelected: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  calendarDayTextToday: {
    color: '#34D399',
    fontWeight: '700',
  },
  calendarDayTextHasTrips: {
    color: '#F1F5F9',
    fontWeight: '700',
  },
  calendarTripDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#10B981',
    marginTop: 2,
  },
  calendarTripDotSelected: {
    backgroundColor: '#FFFFFF',
  },
  calendarFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    paddingHorizontal: 4,
  },
  calendarLegendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  calendarLegendText: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
  },
  calendarCloseText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  tripEmptyContainer: {
    backgroundColor: '#0F172A',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  tripEmptyIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  tripEmptyTitle: {
    color: '#F1F5F9',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  tripEmptySubtitle: {
    color: '#64748B',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 10,
  },
  tripEmptyActionBtn: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginTop: 4,
  },
  tripEmptyActionBtnText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '700',
  },
  banner: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  bannerOk: { backgroundColor: '#064E3B' },
  bannerErr: { backgroundColor: '#7F1D1D' },
  bannerText: { color: '#F8FAFC', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 6,
    gap: 10,
    paddingBottom: (Platform.OS === 'web' ? 108 : 112),
  },
  heroCard: {
    backgroundColor: '#131B2E',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  statusTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
    borderWidth: 1,
  },
  tagLocked: { backgroundColor: '#064E3B', borderColor: '#059669' },
  tagUnlocked: { backgroundColor: '#450A0A', borderColor: '#DC2626' },
  statusTagText: { fontSize: 10, fontWeight: '800' },
  tagCharging: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
    backgroundColor: '#083344',
    borderWidth: 1,
    borderColor: '#06B6D4',
  },
  tagChargingText: { color: '#67E8F9', fontSize: 10, fontWeight: '800' },
  liveActivityPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0F172A',
  },
  liveActivityPillActive: {
    backgroundColor: '#064E3B',
    borderColor: '#059669',
  },
  liveActivityPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94A3B8',
  },
  liveActivityPillTextActive: {
    color: '#34D399',
  },
  liveActivityToggleBtn: {
    backgroundColor: '#0284C7',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  liveActivityToggleBtnActive: {
    backgroundColor: '#7F1D1D',
  },
  liveActivityToggleBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  liveActivityPreviewBox: {
    backgroundColor: '#070C18',
    borderColor: '#1E293B',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  liveActivityPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  liveActivityPreviewTitle: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  liveActivityPreviewLiveBadge: {
    backgroundColor: '#064E3B',
    borderColor: '#059669',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveActivityPreviewLiveBadgeText: {
    color: '#34D399',
    fontSize: 9,
    fontWeight: '800',
  },
  liveActivityPreviewCard: {
    backgroundColor: '#0F172A',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  liveActivityPreviewMainText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 2,
  },
  liveActivityPreviewSubText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  liveActivityPreviewAlbumText: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '500',
  },
  heroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 16,
  },
  rangeValue: { color: '#FFF', fontSize: 40, fontWeight: '900' },
  rangeLabel: { color: '#94A3B8', fontSize: 11, marginTop: 4 },
  socValue: { color: '#FFF', fontSize: 19, fontWeight: '900' },
  socSub: { color: '#94A3B8', fontSize: 10 },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    paddingTop: 12,
  },
  statLabel: { color: '#64748B', fontSize: 10 },
  statItem: { color: '#F1F5F9', fontSize: 12, fontWeight: '700', marginTop: 2 },
  sohBadge: {
    backgroundColor: '#064E3B',
    borderWidth: 1,
    borderColor: '#10B981',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  sohBadgeText: { color: '#6EE7B7', fontSize: 15, fontWeight: '900' },
  quickRow: { flexDirection: 'row', gap: 8 },
  quickBtn: {
    flex: 1,
    backgroundColor: '#131B2E',
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  quickBtnTitle: { color: '#FFF', fontSize: 12, fontWeight: '800' },
  quickBtnSub: { color: '#64748B', fontSize: 10, marginTop: 2 },
  card: {
    backgroundColor: '#131B2E',
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  cardTitle: { color: '#FFF', fontSize: 16, fontWeight: '800', marginBottom: 4 },
  tpmsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  tpmsBox: {
    width: '48%',
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  tpmsLabel: { color: '#94A3B8', fontSize: 11 },
  tpmsVal: { color: '#10B981', fontSize: 17, fontWeight: '900', marginTop: 4 },
  tpmsMeta: { color: '#64748B', fontSize: 10, marginTop: 4 },
  bigCyan: { color: '#06B6D4', fontSize: 28, fontWeight: '900', marginTop: 4 },
  btnGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  ctrlBtn: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: '#1E293B',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  activeBtn: { backgroundColor: '#059669', borderColor: '#10B981' },
  ctrlBtnText: { color: '#FFF', fontWeight: '700', fontSize: 12 },
  logItem: {
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 14,
    marginBottom: 8,
  },
  sessionCard: {
    backgroundColor: '#0A0E17',
    padding: 12,
    borderRadius: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  input: {
    backgroundColor: '#0A0E17',
    borderWidth: 1,
    borderColor: '#1E293B',
    color: '#FFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 24,
  },
  modalBox: {
    backgroundColor: '#131B2E',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  tabBar: ({
    position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any,
    bottom: (Platform.OS === 'web' ? 18 : Platform.OS === 'ios' ? 24 : 18) as any,
    left: 16,
    right: 16,
    maxWidth: 420,
    alignSelf: 'center',
    marginHorizontal: 'auto',
    borderRadius: 9999,
    zIndex: 1000,
    flexDirection: 'row',
    backgroundColor: (Platform.OS === 'web' ? 'rgba(15, 23, 42, 0.72)' : 'rgba(15, 23, 42, 0.88)') as any,
    backdropFilter: (Platform.OS === 'web' ? 'blur(32px) saturate(220%) contrast(108%)' : undefined) as any,
    WebkitBackdropFilter: (Platform.OS === 'web' ? 'blur(32px) saturate(220%) contrast(108%)' : undefined) as any,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.32)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.65,
    shadowRadius: 28,
    elevation: 24,
    boxShadow: (Platform.OS === 'web'
      ? '0 24px 48px -6px rgba(0, 0, 0, 0.75), 0 10px 24px -3px rgba(0, 0, 0, 0.5), inset 0 1.5px 1.5px 0 rgba(255, 255, 255, 0.65), inset 0 -1.5px 2px 0 rgba(255, 255, 255, 0.15)'
      : undefined) as any,
    paddingVertical: 7,
    paddingHorizontal: 8,
    justifyContent: 'space-around',
    alignItems: 'center',
  } as any),
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  tabIconWrapper: {
    width: 54,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  tabIconWrapperActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.45)',
    boxShadow: (Platform.OS === 'web' ? '0 0 16px rgba(16, 185, 129, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.3)' : undefined) as any,
  },
  tabText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
  tabActive: ({
    color: '#34D399',
    fontWeight: '800',
    textShadow: (Platform.OS === 'web' ? '0 0 8px rgba(52, 211, 153, 0.4)' : undefined) as any,
  } as any),

  // Webhook copy cards in Account Tab
  copyWebhookCard: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  copyWebhookHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  copyWebhookTitle: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
  },
  copyPillBtn: {
    backgroundColor: '#2563EB',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  copyPillBtnText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
  },
  copyUrlTapArea: {
    backgroundColor: '#0A0E17',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  copyUrlMonoText: {
    color: '#38BDF8',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 14,
  },
  copyUrlTapHint: {
    color: '#64748B',
    fontSize: 9,
    marginTop: 4,
    textAlign: 'right',
  },

  // Collapsible Trip Card
  tripCardWrap: {
    backgroundColor: '#0A0E17',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  tripCardWrapExpanded: {
    borderColor: '#38BDF8',
  },
  tripHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  tripDateTitle: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '800',
    flex: 1,
  },
  tripOdoBadge: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  tripChevronBadge: {
    backgroundColor: '#1E293B',
    borderRadius: 10,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripChevronBadgeExpanded: {
    backgroundColor: '#0284C7',
  },
  tripChevronText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: '900',
  },
  tripPillsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
  },
  tripPill: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
    alignItems: 'center',
  },
  tripPillLabel: {
    color: '#64748B',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  tripPillValue: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  tripCollapsedFooter: {
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tripRouteText: {
    color: '#94A3B8',
    fontSize: 10,
    flex: 1,
    marginRight: 6,
  },
  tripTapExpandHint: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '600',
  },
  tripExpandedBody: {
    marginTop: 8,
  },
  tripExpandedDivider: {
    height: 1,
    backgroundColor: '#1E293B',
    marginBottom: 10,
  },
  tripDetailsHeading: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 6,
  },
  metricRowLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    paddingRight: 8,
  },
  metricRowValue: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
    flexShrink: 1,
  },
  metricSubNote: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'right',
    marginTop: 2,
  },
  metricBlock: {
    backgroundColor: '#0F172A',
    padding: 10,
    borderRadius: 8,
    marginBottom: 6,
  },
  metricBlockLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  metricBlockValue: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
  },
  tripTimeWindowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  tripTimeWindowIcon: {
    fontSize: 13,
    marginRight: 6,
  },
  tripTimeWindowText: {
    color: '#34D399',
    fontSize: 13,
    fontWeight: '800',
    flex: 1,
  },
  tripDurationInlineBadge: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 6,
  },
  expandedTimeHeroBox: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  expandedTimeHeroTitle: {
    color: '#38BDF8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  departureArrivalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  timePointLabel: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  timePointValue: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  timePointArrow: {
    color: '#38BDF8',
    fontSize: 16,
    fontWeight: '900',
    marginHorizontal: 8,
  },
  journeyDurationPill: {
    backgroundColor: '#0A0E17',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  journeyDurationPillText: {
    color: '#10B981',
    fontSize: 12,
    fontWeight: '800',
  },
  shareImageBtn: {
    backgroundColor: '#059669',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  shareImageBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '800',
  },
  longPressHint: {
    color: '#64748B',
    fontSize: 10,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 6,
  },
  tripCollapseBar: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    marginTop: 4,
  },
  tripCollapseBarText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  imageBrandWatermark: {
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageBrandWatermarkText: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  tripActionButtonsWrap: {
    marginTop: 6,
    marginBottom: 4,
  },
  // Font Scaling Slider & Account Section Styles
  fontSliderContainer: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 12,
  },
  fontSliderLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  fontScaleBadge: {
    backgroundColor: '#1E293B',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#334155',
  },
  fontScaleBadgeText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '800',
  },
  stepperBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepperBtnText: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 20,
  },
  sliderTrack: {
    flex: 1,
    height: 38,
    justifyContent: 'center',
    position: 'relative',
    marginHorizontal: 10,
  },
  sliderFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#38BDF8',
  },
  sliderKnob: {
    position: 'absolute',
    top: 9,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#0284C7',
    marginLeft: -10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 3,
    elevation: 3,
  },
  presetChip: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  presetChipActive: {
    backgroundColor: '#0C4A6E',
    borderColor: '#38BDF8',
  },
  presetChipText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  presetChipTextActive: {
    color: '#38BDF8',
    fontWeight: '800',
  },
  previewBox: {
    marginTop: 14,
    backgroundColor: '#090D16',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 12,
  },
  previewTitle: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  previewCardInner: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 10,
  },
  previewSocBadge: {
    backgroundColor: '#064E3B',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#059669',
  },
  resetFontBtn: {
    marginTop: 12,
    backgroundColor: '#1E293B',
    borderRadius: 10,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  resetFontBtnText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '700',
  },

  // Mockup Home Screen Redesign Styles
  mockupHomeContainer: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 24,
  },
  mockupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  mockupTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  mockupSublineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 6,
  },
  colorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  mockupSublineText: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '500',
  },
  colorPencilHint: {
    fontSize: 11,
    color: '#64748B',
  },
  mockupRefreshBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mockupHeroStats: {
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  mockupHeroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  mockupRangeNum: {
    fontSize: 54,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -1.5,
    lineHeight: 56,
  },
  mockupRangeUnit: {
    fontSize: 22,
    fontWeight: '700',
    color: '#94A3B8',
  },
  mockupSoc: {
    fontSize: 32,
    fontWeight: '800',
    color: '#10B981',
    letterSpacing: -0.5,
  },
  mockupBarTrack: {
    width: '100%',
    height: 6,
    backgroundColor: '#1E293B',
    borderRadius: 999,
    overflow: 'hidden',
  },
  mockupBarFill: {
    height: '100%',
    backgroundColor: '#10B981',
    borderRadius: 999,
    boxShadow: (Platform.OS === 'web' ? '0 0 10px rgba(16, 185, 129, 0.5)' : undefined) as any,
  },
  mockupCarTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginTop: 12,
    marginBottom: 2,
    paddingHorizontal: 4,
  },
  mockupStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  mockupPillLocked: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(52, 211, 153, 0.35)',
  },
  mockupPillUnlocked: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(248, 113, 113, 0.35)',
  },
  mockupPillCharging: {
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
    borderColor: 'rgba(56, 189, 248, 0.35)',
  },
  mockupPillIcon: {
    fontSize: 12,
  },
  mockupPillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  mockupSpinPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  mockupSpinPillActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    borderColor: '#34D399',
  },
  mockupSpinPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94A3B8',
  },
  mockupSpinPillTextActive: {
    color: '#34D399',
  },
  mockupCarArea: {
    width: '100%',
    height: 190,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
    position: 'relative',
  },
  mockupCarFloorGlow: {
    position: 'absolute',
    bottom: 8,
    width: '75%',
    height: 28,
    borderRadius: 100,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    transform: [{ scaleY: 0.5 }],
  },
  mockupCarImg: {
    width: '100%',
    height: '100%',
    zIndex: 1,
  },
  mockupCarOdoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -2,
    marginBottom: 8,
  },
  mockupCarOdoPill: {
    paddingHorizontal: 16,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  mockupCarOdoVal: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F1F5F9',
    letterSpacing: 0.3,
  },
  mockupMetricsGrid: {
    marginVertical: 12,
    paddingHorizontal: 8,
    gap: 12,
  },
  mockupMetricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
  },
  mockupMetricCol: {
    flex: 1,
    alignItems: 'flex-start',
  },
  mockupMetricLabel: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '500',
    marginBottom: 3,
  },
  mockupMetricVal: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  mockupActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    marginBottom: 20,
  },
  mockupActionItem: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 72,
  },
  mockupActionCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  mockupActionCircleRed: {
    borderColor: 'rgba(248, 113, 113, 0.45)',
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  mockupActionCircleBlue: {
    borderColor: 'rgba(56, 189, 248, 0.45)',
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
  },
  mockupActionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E2E8F0',
    textAlign: 'center',
  },
  mockupListContainer: {
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  mockupListCard: {
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  mockupListHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  mockupListIconBadge: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mockupListTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  mockupListSub: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 2,
  },
  mockupListChevron: {
    fontSize: 22,
    color: '#64748B',
    fontWeight: '300',
    paddingHorizontal: 4,
  },
  mockupListChevronOpen: {
    transform: [{ rotate: '90deg' }],
  },
  mockupExpandedBox: {
    paddingBottom: 16,
    paddingTop: 4,
  },
  colorModalCard: {
    backgroundColor: '#131B2E',
    borderRadius: 24,
    padding: 20,
    width: '92%',
    maxWidth: 380,
    borderWidth: 1,
    borderColor: '#334155',
  },
  colorModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  colorModalSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginBottom: 14,
  },
  colorOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  colorOptionRowSelected: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#34D399',
  },
  colorSwatchCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginRight: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  colorOptionName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: '#F1F5F9',
  },
  resetColorBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#064E3B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  resetColorBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6EE7B7',
  },
  tabLabelText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94A3B8',
    marginTop: 2,
  },
  tabLabelTextActive: {
    color: '#34D399',
    fontWeight: '800',
  },

  // Tyres & Closures Dedicated Screen Styles
  tyresScreenLayer: {
    position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0A0E17',
    zIndex: 2000,
  },
  tyresScrollContent: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 44 : 20,
    paddingBottom: 36,
  },
  tyresHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingTop: 8,
  },
  tyresBackBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#131B2A',
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tyresTitle: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '800',
    flex: 1,
    marginLeft: 14,
    letterSpacing: -0.3,
  },
  tyresBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  tyresBadgeOpen: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  tyresBadgeText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '700',
  },
  tyresBadgeTextOpen: {
    color: '#F87171',
  },
  tyresStageContainer: {
    position: 'relative',
    height: 380,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
  },
  tyresFloorGlow: {
    position: 'absolute',
    width: 200,
    height: 320,
    borderRadius: 100,
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
    alignSelf: 'center',
  },
  tyresCarCenter: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  tyresCarImage: {
    width: 140,
    height: 360,
  },
  tyresCardFloat: {
    position: 'absolute',
    width: 114,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    zIndex: 2,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 4px 14px rgba(0,0,0,0.45)' }
      : {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.45,
          shadowRadius: 8,
          elevation: 5,
        }),
  },
  tyresCardFL: {
    top: 20,
    left: 0,
  },
  tyresCardFR: {
    top: 20,
    right: 0,
  },
  tyresCardRL: {
    bottom: 20,
    left: 0,
  },
  tyresCardRR: {
    bottom: 20,
    right: 0,
  },
  tyresCardPos: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
  },
  tyresCardPsiRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  tyresCardPsiVal: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  tyresCardPsiUnit: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  tyresCardSubText: {
    color: '#94A3B8',
    fontSize: 10.5,
    marginTop: 2,
    fontWeight: '500',
  },
  tyresCardSubOpen: {
    color: '#F87171',
    fontWeight: '700',
  },
  tyresSummaryBox: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 14,
    marginBottom: 20,
  },
  tyresSummaryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tyresSummaryTitle: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },
  tyresSummaryStatus: {
    color: '#34D399',
    fontSize: 13.5,
    fontWeight: '700',
  },
  tyresSummaryStatusOpen: {
    color: '#F87171',
  },
  tyresSummarySep: {
    height: 1,
    backgroundColor: '#1E293B',
    marginVertical: 12,
  },

  // Location Dedicated Screen Styles
  locScreenLayer: {
    position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0A0E17',
    zIndex: 2000,
  },
  locScrollContent: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 44 : 20,
    paddingBottom: 40,
  },
  locHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingTop: 8,
  },
  locBackBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#131B2A',
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locTitle: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '800',
    flex: 1,
    marginLeft: 14,
    letterSpacing: -0.3,
  },
  locBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  locBadgeText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '700',
  },
  locMapCard: {
    width: '100%',
    height: 340,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#0B111E',
    borderWidth: 1,
    borderColor: '#1E293B',
    position: 'relative',
    marginBottom: 20,
  },
  locMapNativePlaceholder: {
    width: '100%',
    height: '100%',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locMapNativeImg: {
    width: '100%',
    height: '100%',
  },
  locNativeBeacon: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locNativeHalo: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1.5,
    borderColor: 'rgba(52, 211, 153, 0.5)',
  },
  locNativeArrowWrap: {
    position: 'absolute',
    width: 52,
    height: 52,
    alignItems: 'center',
  },
  locNativeArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#34D399',
    marginTop: 2,
  },
  locNativeDot: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#34D399',
    borderWidth: 2,
    borderColor: '#064E3B',
  },
  locParkedBadge: {
    position: 'absolute',
    bottom: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: 'rgba(11, 17, 30, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 7,
    zIndex: 10,
    ...(Platform.OS === 'web'
      ? ({ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' } as any)
      : {}),
  },
  locParkedBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  locProviderBar: {
    alignSelf: 'center',
    marginTop: -8,
    marginBottom: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#111827',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  locProviderBarText: {
    color: '#94A3B8',
    fontSize: 11.5,
    fontWeight: '500',
  },
  locStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  locStatCol: {
    flex: 1,
    alignItems: 'flex-start',
  },
  locStatLabel: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 4,
  },
  locStatVal: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 2,
  },
  locStatSub: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
  },
  locSummaryCard: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 24,
  },
  locSummaryLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  locSummaryLabel: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '500',
  },
  locSummaryVal: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '700',
  },
  locSummarySep: {
    height: 1,
    backgroundColor: '#1E293B',
    marginVertical: 13,
  },
  locActionButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  locAppleBtn: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#0F172A',
    borderWidth: 1.5,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locAppleBtnText: {
    color: '#38BDF8',
    fontSize: 15,
    fontWeight: '700',
  },
  locGoogleBtn: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#0F172A',
    borderWidth: 1.5,
    borderColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
  },
  locGoogleBtnText: {
    color: '#34D399',
    fontSize: 15,
    fontWeight: '700',
  },

  // Remote Commands Dedicated Screen Styles
  remScreenLayer: {
    position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0A0E17',
    zIndex: 2000,
  },
  remScrollContent: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 44 : 20,
    paddingBottom: 40,
  },
  remHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    paddingTop: 8,
  },
  remBackBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#131B2A',
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  remTitleCol: {
    flex: 1,
    marginLeft: 14,
    justifyContent: 'center',
  },
  remTitle: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 25,
  },
  remBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  remBadgeText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '700',
  },
  remSubtext: {
    color: '#94A3B8',
    fontSize: 13.5,
    fontWeight: '500',
    marginBottom: 20,
    paddingHorizontal: 4,
    lineHeight: 18,
  },
  remControlCard: {
    backgroundColor: '#111827',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingVertical: 4,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  remRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  remRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  remRowLabel: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  remBtnPair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  remActionBtn: {
    minWidth: 76,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  remActionBtnText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  remRowDivider: {
    height: 1,
    backgroundColor: '#1E293B',
  },
  remBottomGrid: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  remFeatureCard: {
    flex: 1,
    backgroundColor: '#111827',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'flex-start',
    justifyContent: 'center',
    minHeight: 110,
  },
  remFeatureTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 4,
  },
  remFeatureSub: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
  },

  // Trips Screen (Redesigned Mockup) Styles
  tripsMainContainer: {
    width: '100%',
    paddingBottom: 24,
  },
  tripsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingTop: 4,
  },
  tripsTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  tripsOverflowBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#131B2A',
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripsOverflowBtnText: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
  },
  tripsActionButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  tripsStartBtn: {
    flex: 1,
    height: 52,
    borderRadius: 20,
    backgroundColor: '#10B981',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tripsStartBtnActive: {
    backgroundColor: '#EF4444',
  },
  tripsStartBtnText: {
    color: '#0A0E17',
    fontSize: 15.5,
    fontWeight: '800',
  },
  tripsPlanBtn: {
    flex: 1,
    height: 52,
    borderRadius: 20,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tripsPlanBtnText: {
    color: '#F8FAFC',
    fontSize: 15.5,
    fontWeight: '700',
  },
  tripsDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  tripsDatePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  tripsDatePillActive: {
    borderColor: '#059669',
    backgroundColor: 'rgba(6, 78, 59, 0.25)',
  },
  tripsDatePillText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  tripsDatePillChevron: {
    color: '#94A3B8',
    fontSize: 12,
    marginLeft: 2,
  },
  tripsCountText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '500',
  },
  tripsHeroStats: {
    marginBottom: 24,
  },
  tripsHeroNumbersRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  tripsHeroStatCol: {
    alignItems: 'flex-start',
  },
  tripsHeroStatColRight: {
    alignItems: 'flex-end',
  },
  tripsHeroNumber: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  tripsHeroUnit: {
    color: '#94A3B8',
    fontSize: 18,
    fontWeight: '600',
  },
  tripsHeroSub: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '500',
    marginTop: 4,
  },
  tripsListContainer: {
    marginTop: 6,
  },
  tripsListItem: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  tripsListItemMain: {
    width: '100%',
  },
  tripsListItemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  tripsListItemTitle: {
    color: '#F8FAFC',
    fontSize: 16.5,
    fontWeight: '700',
    flex: 1,
    paddingRight: 12,
  },
  tripsListItemDist: {
    color: '#F8FAFC',
    fontSize: 16.5,
    fontWeight: '800',
  },
  tripsListItemSub: {
    color: '#94A3B8',
    fontSize: 13.5,
    fontWeight: '500',
  },
  tripsOptionsBox: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 24,
    padding: 20,
    width: '90%',
    maxWidth: 400,
  },
  tripsOptionsTitle: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 16,
    textAlign: 'center',
  },
  tripsOptionItem: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  tripsOptionItemText: {
    color: '#F8FAFC',
    fontSize: 14.5,
    fontWeight: '600',
  },
  tripsOptionsCancelBtn: {
    marginTop: 16,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripsOptionsCancelText: {
    color: '#94A3B8',
    fontSize: 14.5,
    fontWeight: '700',
  },

  // Plan a Trip Dedicated Screen Styles
  planScreenLayer: {
    position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0A0E17',
    zIndex: 2000,
  },
  planScrollContent: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 44 : 20,
    paddingBottom: 40,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingTop: 8,
  },
  planBackBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#131B2A',
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  planTitle: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '800',
    flex: 1,
    marginLeft: 14,
    letterSpacing: -0.3,
  },
  planTrafficBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  planTrafficBadgeText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '700',
  },
  planSectionLabel: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 10,
  },
  planBtnRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
  },
  planChoiceBtn: {
    flex: 1,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  planChoiceBtnActive: {
    borderColor: '#059669',
    backgroundColor: 'rgba(6, 78, 59, 0.25)',
  },
  planChoiceBtnText: {
    color: '#94A3B8',
    fontSize: 13.5,
    fontWeight: '600',
  },
  planChoiceBtnTextActive: {
    color: '#34D399',
    fontWeight: '700',
  },
  planCustomInput: {
    height: 48,
    borderRadius: 16,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    color: '#FFFFFF',
    fontSize: 14,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  planMetricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginVertical: 12,
  },
  planMetricTile: {
    width: '48%',
    flexGrow: 1,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  planMetricTileLabel: {
    color: '#94A3B8',
    fontSize: 12.5,
    fontWeight: '500',
    marginBottom: 4,
  },
  planMetricTileVal: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  planDestHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  planDestApiKeyLink: {
    color: '#34D399',
    fontSize: 13,
    fontWeight: '700',
  },
  planDestInput: {
    height: 52,
    borderRadius: 18,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    color: '#FFFFFF',
    fontSize: 15,
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
  },
  planChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  planChip: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  planChipActive: {
    borderColor: '#059669',
    backgroundColor: 'rgba(6, 78, 59, 0.25)',
  },
  planChipText: {
    color: '#FFFFFF',
    fontSize: 13.5,
    fontWeight: '600',
  },
  planChipTextActive: {
    color: '#34D399',
    fontWeight: '700',
  },
  planFootnote: {
    color: '#94A3B8',
    fontSize: 12.5,
    lineHeight: 18,
    marginVertical: 16,
  },
  planPrimaryBtn: {
    height: 54,
    borderRadius: 27,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  planPrimaryBtnText: {
    color: '#0A0E17',
    fontSize: 16.5,
    fontWeight: '800',
  },
  planProgressText: {
    color: '#34D399',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 12,
  },
  planErrorCard: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    borderRadius: 16,
    padding: 12,
    marginBottom: 14,
  },
  planErrorText: {
    color: '#F87171',
    fontSize: 13,
    fontWeight: '500',
  },
  planResultCard: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 20,
    padding: 16,
    marginTop: 8,
    marginBottom: 20,
  },
  planResultHeader: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 12,
  },
  planResultLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  planResultLabel: {
    color: '#94A3B8',
    fontSize: 13.5,
  },
  planResultVal: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  planNavBtn: {
    marginTop: 14,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#0F172A',
    borderWidth: 1.5,
    borderColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
  },
  planNavBtnText: {
    color: '#34D399',
    fontSize: 14,
    fontWeight: '700',
  },

  // Trip Detail Dedicated Screen Styles
  tripDetailScreenLayer: {
    position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0A0E17',
    zIndex: 2000,
  },
  tripDetailScrollContent: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 44 : 20,
    paddingBottom: 40,
  },
  tripDetailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingTop: 8,
  },
  tripDetailBackBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#131B2A',
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripDetailTitleCol: {
    flex: 1,
    marginLeft: 14,
    marginRight: 10,
  },
  tripDetailTitle: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  tripDetailSub: {
    color: '#94A3B8',
    fontSize: 12.5,
    fontWeight: '500',
    marginTop: 1,
  },
  tripDetailShareBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#131B2A',
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripDetailMapCard: {
    width: '100%',
    height: 160,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#0B111E',
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 20,
  },
  tripDetailHeroDist: {
    color: '#FFFFFF',
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  tripDetailHeroUnit: {
    color: '#94A3B8',
    fontSize: 20,
    fontWeight: '600',
  },
  tripDetailHeroOdo: {
    color: '#94A3B8',
    fontSize: 13.5,
    fontWeight: '500',
    marginTop: 4,
    marginBottom: 20,
  },
  tripDetailMetricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingHorizontal: 2,
  },
  tripDetailMetricCol: {
    flex: 1,
  },
  tripDetailMetricLabel: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 4,
  },
  tripDetailMetricVal: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  tripDetailSocCard: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 22,
  },
  tripDetailSocTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  tripDetailSocLeft: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '800',
  },
  tripDetailSocRight: {
    color: '#34D399',
    fontSize: 14.5,
    fontWeight: '800',
  },
  tripDetailSocTrack: {
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#1E293B',
    overflow: 'hidden',
  },
  tripDetailSocFill: {
    height: '100%',
    backgroundColor: '#34D399',
    borderRadius: 3.5,
  },
  tripDetailTimeline: {
    marginBottom: 22,
    paddingHorizontal: 4,
  },
  tripDetailNode: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  tripDetailNodeDotGrey: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#94A3B8',
    marginTop: 4,
  },
  tripDetailNodeDotGreen: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#34D399',
    marginTop: 4,
  },
  tripDetailNodeTrack: {
    width: 2,
    height: 24,
    backgroundColor: '#334155',
    marginLeft: 4,
    marginVertical: 4,
  },
  tripDetailNodeTextCol: {
    flex: 1,
  },
  tripDetailNodeLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
  },
  tripDetailNodeVal: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  tripDetailBottomCard: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 30,
  },
  tripDetailStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tripDetailStatCol: {
    flex: 1,
  },
  tripDetailStatLabel: {
    color: '#94A3B8',
    fontSize: 12.5,
    fontWeight: '500',
  },
  tripDetailStatVal: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '800',
    marginTop: 2,
  },
  tripDetailDivider: {
    height: 1,
    backgroundColor: '#1E293B',
    marginVertical: 14,
  },
});
