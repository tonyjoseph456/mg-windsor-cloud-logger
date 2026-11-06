import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import Svg, { Circle, Path, Rect, G } from 'react-native-svg';
import * as SecureStore from './src/storage';
import './src/webShims';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
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
  sheetUrl,
  fetchD1Trips,
  fetchD1TripDates,
  fetchD1Charges,
  fetchD1ChargeDates,
  registerCarSession,
} from './src/sdk';

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
  const coordStr = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
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
    chargerCategory: c.chargerCategory || '3.3 kW AC',
    maxChargingSpeedKw: Number(c.maxChargingSpeedKw ?? 0),
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
  if (budget.n <= 0) return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
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
  if (maxKw > 8.0) {
    return { category: 'DC Fast', lossPct: 6.0 };
  }
  if (maxKw > 3.7) {
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

  // Credentials & Session
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [vin, setVin] = useState('');

  // Telemetry state
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [activeTrip, setActiveTrip] = useState<TripRecord | null>(null);
  const [parkedBaseline, setParkedBaseline] = useState<ParkedTripBaseline | null>(null);
  const [liveTripTracking, setLiveTripTracking] = useState<boolean>(false);

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

  // Query D1 trips and distinct dates whenever Trips tab or date filter changes
  useEffect(() => {
    if (tab === 'trips') {
      fetchD1TripDates().then((dates) => {
        if (dates && dates.length > 0) setD1TripDates(dates);
      }).catch(() => {});

      fetchD1Trips(selectedTripDate === 'all' ? undefined : selectedTripDate).then((d1Trips) => {
        if (d1Trips && d1Trips.length > 0) {
          setTrips((prev) => {
            const merged = deduplicateTripList([...d1Trips, ...prev]);
            tripsRef.current = merged;
            SecureStore.setItemAsync(TRIPS_KEY, JSON.stringify(merged)).catch(() => {});
            return merged;
          });
        }
      }).catch(() => {});
    }
  }, [tab, selectedTripDate]);

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

  // Query D1 charges and distinct dates whenever Charge tab or date filter changes
  useEffect(() => {
    if (tab === 'charge') {
      fetchD1ChargeDates().then((dates) => {
        if (dates && dates.length > 0) setD1ChargeDates(dates);
      }).catch(() => {});

      fetchD1Charges(selectedChargeDate === 'all' ? undefined : selectedChargeDate).then((d1Charges) => {
        if (d1Charges && d1Charges.length > 0) {
          setChargeLogs((prev) => {
            const merged = deduplicateChargeList([...d1Charges, ...prev]);
            chargeLogsRef.current = merged;
            SecureStore.setItemAsync(CHARGE_LOGS_KEY, JSON.stringify(merged)).catch(() => {});
            return merged;
          });
        }
      }).catch(() => {});
    }
  }, [tab, selectedChargeDate]);

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
        ]);

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

  const handleSyncAllToBackendSheets = async (silent = false) => {
    if (!silent) {
      Alert.alert(
        'Google Sheets Backup',
        'Direct Google Sheets backup is active. You can sync from the Account tab.'
      );
    }
  };

  const handleCleanAndDeduplicateSheets = () => {
    const cleanedTrips = deduplicateTripList(tripsRef.current);
    setTrips(cleanedTrips);
    tripsRef.current = cleanedTrips;
    SecureStore.setItemAsync(TRIPS_KEY, JSON.stringify(cleanedTrips)).catch(() => {});

    const cleanedCharges = deduplicateChargeList(chargeLogsRef.current);
    setChargeLogs(cleanedCharges);
    chargeLogsRef.current = cleanedCharges;
    SecureStore.setItemAsync(CHARGE_LOGS_KEY, JSON.stringify(cleanedCharges)).catch(() => {});

    Alert.alert(
      'History Cleaned ✨',
      `Local history cleaned and deduplicated successfully!\n\n⚡ Charges: ${cleanedCharges.length} valid sessions\n🚗 Trips: ${cleanedTrips.length} valid trips`
    );
    showBanner('ok', 'Local trips & charges deduplicated');
  };

  const handleCleanAndDeduplicateCharges = handleCleanAndDeduplicateSheets;

  const refreshVehicleTelemetry = async (
    existingClient?: MgIndiaClient,
    sessionOverride?: Partial<PersistedSession> & { _isRetry?: boolean }
  ) => {
    const usePhone = sessionOverride?.phone ?? phone;
    const usePassword = sessionOverride?.password ?? password;
    const usePin = sessionOverride?.pin ?? pin;
    const useVin = sessionOverride?.vin ?? vin;

    setIsSyncing(true);
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
      showBanner('err', msg);
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
            setIsAuthenticated(false);
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

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
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
        {/* Tap-to-Refresh & Pull-to-Refresh banner */}
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

        {/* TAB 1: HOME */}
        {tab === 'home' && (
          <>
            <View style={styles.heroCard}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <View
                    style={[
                      styles.statusTag,
                      status.locked ? styles.tagLocked : styles.tagUnlocked,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusTagText,
                        status.locked ? { color: '#6EE7B7' } : { color: '#FCA5A5' },
                      ]}
                    >
                      {status.locked === undefined || status.locked === null
                        ? 'PULL DOWN TO SYNC'
                        : status.locked
                        ? 'LOCKED & SECURE'
                        : 'UNLOCKED'}
                    </Text>
                  </View>

                  {charge?.is_charging && (
                    <View style={styles.tagCharging}>
                      <Text style={styles.tagChargingText}>CHARGING • {chargingKw} kW</Text>
                    </View>
                  )}
                </View>


              </View>

              <View style={styles.heroRow}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={styles.rangeValue}>{Math.round(rangeKm)} km</Text>
                  <Text style={styles.rangeLabel}>
                    {charge
                      ? `Pack Energy: ${charge.battery_energy_kwh} / ${nominalCapacityKwh} kWh`
                      : 'Estimated Electric Range'}
                  </Text>
                </View>

                {/* Proportional SVG Circular Progress Ring */}
                <BatteryProgressRing
                  percent={clampedSoc}
                  label={socDisplay}
                  isCharging={Boolean(charge?.is_charging)}
                />
              </View>

              {/* 4-Column Telemetry Summary Row including Battery Health (SOH) */}
              <View style={styles.statsRow}>
                <View>
                  <Text style={styles.statLabel}>Battery Health</Text>
                  <Text style={[styles.statItem, { color: '#10B981' }]}>
                    {sohPercent.toFixed(1)}% SOH
                  </Text>
                </View>
                <View>
                  <Text style={styles.statLabel}>Odometer</Text>
                  <Text style={styles.statItem}>
                    {(charge?.odometer_km ?? status.odometer_km ?? 0).toLocaleString()} km
                  </Text>
                </View>
                <View>
                  <Text style={styles.statLabel}>12V Aux</Text>
                  <Text style={[styles.statItem, { color: '#34D399' }]}>
                    {status.aux_battery_voltage ?? '--'} V
                  </Text>
                </View>
                <View>
                  <Text style={styles.statLabel}>Cabin / Ext</Text>
                  <Text style={styles.statItem}>
                    {status.interior_temperature ?? '--'}° / {status.exterior_temperature ?? '--'}°C
                  </Text>
                </View>
              </View>
            </View>

            {/* Quick Remote Actions */}
            <View style={styles.quickRow}>
              <TouchableOpacity
                style={[
                  styles.quickBtn,
                  status.locked === false && {
                    borderColor: '#EF4444',
                    backgroundColor: '#450A0A',
                  },
                ]}
                onPress={() =>
                  triggerCommand(status.locked ? 'Unlock Doors' : 'Lock Doors', (c) =>
                    c.controlDoorLock(!status.locked)
                  )
                }
              >
                <Text style={styles.quickBtnTitle}>
                  {status.locked ? 'Unlock' : 'Lock'}
                </Text>
                <Text style={styles.quickBtnSub}>Doors</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.quickBtn,
                  status.climate_running && {
                    borderColor: '#06B6D4',
                    backgroundColor: '#083344',
                  },
                ]}
                onPress={() =>
                  triggerCommand(
                    status.climate_running ? 'Stop Climate' : 'Start Climate',
                    (c) => c.controlClimate(!status.climate_running)
                  )
                }
              >
                <Text style={styles.quickBtnTitle}>
                  {status.climate_running ? 'AC On' : 'Climate'}
                </Text>
                <Text style={styles.quickBtnSub}>HVAC</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickBtn}
                onPress={() => triggerCommand('Find My Car', (c) => c.findMyCar())}
              >
                <Text style={styles.quickBtnTitle}>Find Car</Text>
                <Text style={styles.quickBtnSub}>Horn/Light</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickBtn}
                onPress={() => triggerCommand('Release Tailgate', (c) => c.releaseTailgate())}
              >
                <Text style={styles.quickBtnTitle}>Tailgate</Text>
                <Text style={styles.quickBtnSub}>
                  {status.boot_open ? 'Open' : 'Closed'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Dedicated HV Battery Health & BMS Card on Home Screen */}
            <View style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                  <Text style={styles.cardTitle}>HV Battery Health (SOH)</Text>
                  <Text style={styles.subtitle}>
                    {derivedFullCapacityKwh !== null
                      ? `Live BMS Derived: ${derivedFullCapacityKwh.toFixed(1)} kWh / ${nominalCapacityKwh} kWh usable`
                      : `Nominal Pack: ${nominalCapacityKwh} kWh usable (12V Aux: ${
                          status.aux_battery_voltage ?? '--'
                        } V)`}
                  </Text>
                </View>
                <View style={styles.sohBadge}>
                  <Text style={styles.sohBadgeText}>{sohPercent.toFixed(1)}%</Text>
                </View>
              </View>
            </View>

            {/* Driving efficiency since the last charge: tracked from the end of a charge until the
                next plug-in, then kept on the charge it followed (see Charge tab history). */}
            {(() => {
              const cycleKm =
                charge?.distance_since_last_charge_km ?? preChargeBaseline?.distanceSinceLastChargeKm ?? 0;
              const cycleKwh =
                charge?.power_usage_since_last_charge_kwh ??
                preChargeBaseline?.energyUsedSinceLastChargeKwh ??
                0;
              const cycleEff = cycleKm > 0 && cycleKwh > 0 ? cycleKm / cycleKwh : 0;
              const lastCharge = chargeLogs[0];
              return (
                <View style={styles.card}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={styles.cardTitle}>🛣️ Driving Efficiency Since Last Charge</Text>
                      <Text style={styles.subtitle}>
                        {charge?.is_charging
                          ? 'Charging now — showing the drive that just ended'
                          : lastCharge
                          ? `Since charge ended ${extractDate(lastCharge.endDateTime)} ${extractTime(lastCharge.endDateTime)}`
                          : 'Tracking since your last charge'}
                      </Text>
                    </View>
                    <View style={styles.sohBadge}>
                      <Text style={styles.sohBadgeText}>
                        {cycleEff > 0 ? cycleEff.toFixed(2) : '--'}
                      </Text>
                      <Text style={{ color: '#6EE7B7', fontSize: 9, textAlign: 'center' }}>km/kWh</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    <View style={[styles.tpmsBox, { flex: 1 }]}>
                      <Text style={styles.tpmsLabel}>Distance</Text>
                      <Text style={styles.tpmsVal}>{cycleKm > 0 ? cycleKm.toFixed(1) : '0'} km</Text>
                    </View>
                    <View style={[styles.tpmsBox, { flex: 1 }]}>
                      <Text style={styles.tpmsLabel}>Energy Used</Text>
                      <Text style={styles.tpmsVal}>{cycleKwh > 0 ? cycleKwh.toFixed(2) : '0'} kWh</Text>
                    </View>
                  </View>
                </View>
              );
            })()}

            {/* 1. Tyre Pressures & Closures (Closed by default) */}
            {(() => {
              const allShut =
                !status.driver_door_open &&
                !status.passenger_door_open &&
                !status.rear_left_door_open &&
                !status.rear_right_door_open &&
                !status.boot_open &&
                !status.bonnet_open;
              const tpmsSummary = `FL ${status.front_left_tyre_psi ?? '--'} • FR ${status.front_right_tyre_psi ?? '--'} • RL ${status.rear_left_tyre_psi ?? '--'} • RR ${status.rear_right_tyre_psi ?? '--'} PSI`;
              return (
                <CollapsibleSectionCard
                  title="Tyre Pressures (0.2 PSI Precision) & Closures"
                  icon="🛞"
                  badge={allShut ? 'ALL SHUT' : 'DOOR / BOOT OPEN'}
                  badgeBg={allShut ? '#064E3B' : '#7F1D1D'}
                  badgeColor={allShut ? '#6EE7B7' : '#FCA5A5'}
                  preview={tpmsSummary}
                  tapHint="Tap to expand • 4-wheel pressures, doors & windows"
                  defaultExpanded={false}
                >
                  <View style={styles.tpmsGrid}>
                    <View style={styles.tpmsBox}>
                      <Text style={styles.tpmsLabel}>Front Left (Driver)</Text>
                      <Text style={styles.tpmsVal}>
                        {status.front_left_tyre_psi ?? '--'} PSI
                      </Text>
                      <Text style={styles.tpmsMeta}>
                        Door: {status.driver_door_open ? 'OPEN' : 'Shut'} • Win:{' '}
                        {status.driver_window_open ? 'OPEN' : 'Shut'}
                      </Text>
                    </View>

                    <View style={styles.tpmsBox}>
                      <Text style={styles.tpmsLabel}>Front Right (Passenger)</Text>
                      <Text style={styles.tpmsVal}>
                        {status.front_right_tyre_psi ?? '--'} PSI
                      </Text>
                      <Text style={styles.tpmsMeta}>
                        Door: {status.passenger_door_open ? 'OPEN' : 'Shut'} • Win:{' '}
                        {status.passenger_window_open ? 'OPEN' : 'Shut'}
                      </Text>
                    </View>

                    <View style={styles.tpmsBox}>
                      <Text style={styles.tpmsLabel}>Rear Left</Text>
                      <Text style={styles.tpmsVal}>
                        {status.rear_left_tyre_psi ?? '--'} PSI
                      </Text>
                      <Text style={styles.tpmsMeta}>
                        Door: {status.rear_left_door_open ? 'OPEN' : 'Shut'} • Win:{' '}
                        {status.rear_left_window_open ? 'OPEN' : 'Shut'}
                      </Text>
                    </View>

                    <View style={styles.tpmsBox}>
                      <Text style={styles.tpmsLabel}>Rear Right</Text>
                      <Text style={styles.tpmsVal}>
                        {status.rear_right_tyre_psi ?? '--'} PSI
                      </Text>
                      <Text style={styles.tpmsMeta}>
                        Door: {status.rear_right_door_open ? 'OPEN' : 'Shut'} • Win:{' '}
                        {status.rear_right_window_open ? 'OPEN' : 'Shut'}
                      </Text>
                    </View>
                  </View>
                </CollapsibleSectionCard>
              );
            })()}

            {/* 2. Live Vehicle GPS (Moved from Map Tab, Closed by default) */}
            {(() => {
              const fix3d = status.gps?.gps_status === GpsStatus.FIX_3D;
              const hasFix = Boolean(status.gps && (status.gps.latitude || status.gps.longitude));
              const gpsSummary = hasFix
                ? `${status.gps?.latitude?.toFixed(4)}°, ${status.gps?.longitude?.toFixed(4)}° • ${status.gps?.speed_kmh ?? 0} km/h`
                : 'Pull down to refresh GPS fix';
              return (
                <CollapsibleSectionCard
                  title="Live Vehicle GPS & Navigation"
                  icon="📍"
                  badge={hasFix ? (fix3d ? '3D FIX' : '2D FIX') : 'NO FIX'}
                  badgeBg={hasFix ? '#064E3B' : '#78350F'}
                  badgeColor={hasFix ? '#6EE7B7' : '#FCD34D'}
                  preview={gpsSummary}
                  tapHint="Tap to expand • Coordinates, Altitude & Navigation"
                  defaultExpanded={false}
                >
                  {status.gps ? (
                    <>
                      <View style={{ gap: 10, marginTop: 4 }}>
                        <InfoRow
                          label="GPS Fix Quality"
                          value={
                            status.gps.gps_status === GpsStatus.FIX_3D
                              ? `3D Fix (${status.gps.satellites ?? 0} Satellites)`
                              : status.gps.gps_status === GpsStatus.FIX_2D
                              ? `2D Fix (${status.gps.satellites ?? 0} Satellites)`
                              : 'No Active Fix'
                          }
                        />
                        <InfoRow
                          label="Coordinates"
                          value={`${status.gps.latitude?.toFixed(6) ?? '--'}, ${
                            status.gps.longitude?.toFixed(6) ?? '--'
                          }`}
                        />
                        <InfoRow
                          label="Speed & Heading"
                          value={`${status.gps.speed_kmh ?? 0} km/h • ${status.gps.heading_deg ?? 0}°`}
                        />
                        <InfoRow label="Altitude" value={`${status.gps.altitude_m ?? 0} m ASL`} />
                      </View>

                      {status.gps.latitude && status.gps.longitude && (
                        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                          <TouchableOpacity
                            style={[styles.ctrlBtn, { backgroundColor: '#0284C7' }]}
                            onPress={() =>
                              Linking.openURL(
                                `http://maps.apple.com/?ll=${status.gps?.latitude},${status.gps?.longitude}&q=${encodeURIComponent(
                                  displayName
                                )}`
                              )
                            }
                          >
                            <Text style={styles.ctrlBtnText}>Open in Apple Maps</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.ctrlBtn, { backgroundColor: '#059669' }]}
                            onPress={() =>
                              Linking.openURL(
                                `https://www.google.com/maps/search/?api=1&query=${status.gps?.latitude},${status.gps?.longitude}`
                              )
                            }
                          >
                            <Text style={styles.ctrlBtnText}>Google Maps</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </>
                  ) : (
                    <Text style={styles.subtitle}>Pull down or tap Sync to fetch vehicle GPS coordinates.</Text>
                  )}
                </CollapsibleSectionCard>
              );
            })()}

            {/* 3. PIN-Protected Remote Commands (Moved from Control Tab, Closed by default) */}
            <CollapsibleSectionCard
              title="PIN-Protected Remote Commands"
              icon="🎛️"
              badge={status.locked ? 'LOCKED' : 'UNLOCKED'}
              badgeBg={status.locked ? '#064E3B' : '#7F1D1D'}
              badgeColor={status.locked ? '#6EE7B7' : '#FCA5A5'}
              subtitle="Verifies MD5(&quot;PIN00&quot;) on V11 dispatcher before issuing control frames"
              preview="Lock, Unlock, Climate AC, Windows, Sunroof, Tailgate"
              tapHint="Tap to expand • Full remote control commands"
              defaultExpanded={false}
            >
              <View style={styles.btnGrid}>
                <TouchableOpacity
                  style={styles.ctrlBtn}
                  onPress={() => triggerCommand('Lock Doors', (c) => c.controlDoorLock(true))}
                >
                  <Text style={styles.ctrlBtnText}>Lock Doors</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.ctrlBtn}
                  onPress={() => triggerCommand('Unlock Doors', (c) => c.controlDoorLock(false))}
                >
                  <Text style={styles.ctrlBtnText}>Unlock Doors</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.ctrlBtn}
                  onPress={() => triggerCommand('Start Climate AC', (c) => c.controlClimate(true))}
                >
                  <Text style={styles.ctrlBtnText}>Start Climate AC</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.ctrlBtn}
                  onPress={() => triggerCommand('Stop Climate AC', (c) => c.controlClimate(false))}
                >
                  <Text style={styles.ctrlBtnText}>Stop Climate AC</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.ctrlBtn}
                  onPress={() =>
                    triggerCommand('Open Windows', (c) => c.controlWindows(true, [9, 10, 11, 12]))
                  }
                >
                  <Text style={styles.ctrlBtnText}>Open Windows</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.ctrlBtn}
                  onPress={() =>
                    triggerCommand('Close Windows', (c) => c.controlWindows(false, [9, 10, 11, 12]))
                  }
                >
                  <Text style={styles.ctrlBtnText}>Close Windows</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.ctrlBtn}
                  onPress={() => triggerCommand('Open Sunroof', (c) => c.controlSunroof(true))}
                >
                  <Text style={styles.ctrlBtnText}>Open Sunroof</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.ctrlBtn}
                  onPress={() => triggerCommand('Close Sunroof', (c) => c.controlSunroof(false))}
                >
                  <Text style={styles.ctrlBtnText}>Close Sunroof</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.ctrlBtn}
                  onPress={() => triggerCommand('Find My Car', (c) => c.findMyCar())}
                >
                  <Text style={styles.ctrlBtnText}>Find My Car</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.ctrlBtn}
                  onPress={() => triggerCommand('Release Tailgate', (c) => c.releaseTailgate())}
                >
                  <Text style={styles.ctrlBtnText}>Release Tailgate</Text>
                </TouchableOpacity>
              </View>
            </CollapsibleSectionCard>
          </>
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
                    style={[styles.recordBtn, { backgroundColor: '#064E3B28', borderColor: '#059669', paddingHorizontal: 12, paddingVertical: 8 }]}
                    onPress={handleCleanAndDeduplicateCharges}
                    disabled={isBackendBusy}
                  >
                    <Text style={[styles.recordBtnText, { color: '#34D399' }]}>
                      {isBackendBusy ? 'Cleaning...' : '🧹 Clean Sheets'}
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
                  }}
                >
                  <Text style={styles.recordBtnText}>+ Save Session</Text>
                </TouchableOpacity>
                </View>

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

        {/* TAB 3: TRIPS (10-Point Automatic + Live Road-Trip Logger) */}
        {tab === 'trips' && (
          <>
            {/* Live Road-Trip Mode & AC Setting Controls (Way 2) */}
            <View style={styles.card}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                }}
              >
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={styles.cardTitle}>Trip Logger (Auto & Live Mode)</Text>
                  <Text style={styles.subtitle}>
                    Way 1: Auto-detects trips from odometer, GPS & BMS even when app was closed.{'\n'}
                    Way 2: Enable Live Road-Trip Mode while driving to poll every 60s for exact Peak
                    Speed & Idling energy.
                  </Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.recordBtn,
                    liveTripTracking && {
                      backgroundColor: '#064E3B',
                      borderColor: '#10B981',
                    },
                  ]}
                  onPress={() => {
                    const nextVal = !liveTripTracking;
                    setLiveTripTracking(nextVal);
                    showBanner('ok', nextVal ? 'Live trip mode active' : 'Live trip mode paused');
                  }}
                >
                  <Text
                    style={[
                      styles.recordBtnText,
                      liveTripTracking && { color: '#6EE7B7', fontWeight: '900' },
                    ]}
                  >
                    {liveTripTracking ? '● Live Trip ON' : '▶ Start Live Trip'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Active Ongoing Trip Card */}
            {activeTrip && (
              <View style={[styles.card, { borderColor: '#10B981', borderWidth: 1.5 }]}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 10,
                  }}
                >
                  <Text style={[styles.cardTitle, { color: '#6EE7B7', marginBottom: 0 }]}>
                    🚗 Active Trip in Progress
                  </Text>
                  <TouchableOpacity
                    style={styles.recordBtn}
                    onPress={async () => {
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
                      showBanner('ok', 'Trip completed and saved to Trip History');
                    }}
                  >
                    <Text style={[styles.recordBtnText, { color: '#FCA5A5' }]}>■ End & Save</Text>
                  </TouchableOpacity>
                </View>
                <TripSessionCard trip={activeTrip} />
              </View>
            )}

            {/* Completed Trips History */}
            <View style={styles.card}>
              <View style={{ marginBottom: 14 }}>
                <View style={styles.tripCardHeaderRow}>
                  <View style={styles.tripCardHeaderLeft}>
                    <Text style={styles.cardTitle}>Saved Trips History</Text>
                    <Text style={styles.subtitle}>All 10 trip & driving metrics per journey</Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.tripDateFilterBtn,
                      showTripCalendar && styles.tripDateFilterBtnActive,
                    ]}
                    onPress={() => setShowTripCalendar((v) => !v)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.tripDateFilterBtnIcon}>📅</Text>
                    <Text style={styles.tripDateFilterBtnText}>
                      {selectedTripDate === 'all'
                        ? 'All Dates'
                        : selectedTripDate === todayKey
                        ? `Today (${formatShortDayMonth(selectedTripDate)})`
                        : formatDisplayDateKey(selectedTripDate)}
                    </Text>
                    <Text style={styles.tripDateFilterBtnChevron}>
                      {showTripCalendar ? '▲' : '▼'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                  <TouchableOpacity
                    style={[styles.recordBtn, { backgroundColor: '#064E3B28', borderColor: '#059669', paddingHorizontal: 12, paddingVertical: 8 }]}
                    onPress={handleCleanAndDeduplicateSheets}
                    disabled={isBackendBusy}
                  >
                    <Text style={[styles.recordBtnText, { color: '#34D399' }]}>
                      {isBackendBusy ? 'Cleaning...' : '🧹 Clean Sheets'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.recordBtn, { backgroundColor: '#059669', paddingHorizontal: 12, paddingVertical: 8 }]}
                    onPress={() => handleSyncAllToBackendSheets(false)}
                    disabled={isBackendBusy}
                  >
                    <Text style={styles.recordBtnText}>
                      {isBackendBusy ? 'Syncing...' : '📊 Sync Sheets'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.recordBtn, { paddingHorizontal: 12, paddingVertical: 8 }]}
                    onPress={async () => {
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
                    if (googleConfigRef.current?.accessToken && googleConfigRef.current?.spreadsheetId && googleConfigRef.current?.autoSync) {
                      syncTripsToGoogleSheet(googleConfigRef.current.accessToken, googleConfigRef.current.spreadsheetId, [manualTrip]).catch(() => {});
                    }
                  }}
                >
                  <Text style={styles.recordBtnText}>+ Log Trip Now</Text>
                </TouchableOpacity>
                </View>

                {/* Interactive Inline Calendar (shown when user taps date button) */}
                {showTripCalendar && (
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
                )}
              </View>

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
                    {selectedTripDate === todayKey
                      ? 'Trips are recorded automatically when your car drives (or via Live Trip Mode / "+ Log Trip Now").'
                      : selectedTripDate === 'all'
                      ? 'Trips are recorded automatically when your car drives (or via Live Trip Mode / "+ Log Trip Now").'
                      : 'No completed driving records found for this selected date.'}
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
                displayedTrips.map((t) => (
                  <TripSessionCard key={t.id} trip={t} />
                ))
              )}
            </View>
          </>
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
            </AccountSectionCard>

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
                          `${BACKEND_URL}/api/trip/start?format=text`,
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
                        `${BACKEND_URL}/api/trip/start?format=text`,
                        'CarPlay Start Trip URL'
                      )
                    }
                  >
                    <Text style={styles.copyUrlMonoText} numberOfLines={2}>
                      {`${BACKEND_URL}/api/trip/start?format=text`}
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
                          `${BACKEND_URL}/api/trip/stop?format=text`,
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
                        `${BACKEND_URL}/api/trip/stop?format=text`,
                        'CarPlay Stop Trip URL'
                      )
                    }
                  >
                    <Text style={styles.copyUrlMonoText} numberOfLines={2}>
                      {`${BACKEND_URL}/api/trip/stop?format=text`}
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
                          `https://mg-windsor-webhook.tonyjoseph456.workers.dev?action=unlock&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`,
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
                        `https://mg-windsor-webhook.tonyjoseph456.workers.dev?action=unlock&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`,
                        'Silent Unlock URL'
                      )
                    }
                  >
                    <Text style={styles.copyUrlMonoText} numberOfLines={2}>
                      {`https://mg-windsor-webhook.tonyjoseph456.workers.dev?action=unlock&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`}
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
                          `https://mg-windsor-webhook.tonyjoseph456.workers.dev?action=lock&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`,
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
                        `https://mg-windsor-webhook.tonyjoseph456.workers.dev?action=lock&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`,
                        'Silent Lock URL'
                      )
                    }
                  >
                    <Text style={styles.copyUrlMonoText} numberOfLines={2}>
                      {`https://mg-windsor-webhook.tonyjoseph456.workers.dev?action=lock&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`}
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
                          `https://mg-windsor-webhook.tonyjoseph456.workers.dev?action=climate-on&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`,
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
                        `https://mg-windsor-webhook.tonyjoseph456.workers.dev?action=climate-on&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`,
                        'Silent Climate AC On URL'
                      )
                    }
                  >
                    <Text style={styles.copyUrlMonoText} numberOfLines={2}>
                      {`https://mg-windsor-webhook.tonyjoseph456.workers.dev?action=climate-on&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`}
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
                          `https://mg-windsor-webhook.tonyjoseph456.workers.dev?action=climate-off&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`,
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
                        `https://mg-windsor-webhook.tonyjoseph456.workers.dev?action=climate-off&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`,
                        'Silent Climate AC Off URL'
                      )
                    }
                  >
                    <Text style={styles.copyUrlMonoText} numberOfLines={2}>
                      {`https://mg-windsor-webhook.tonyjoseph456.workers.dev?action=climate-off&phone=${encodeURIComponent(phone)}&password=${encodeURIComponent(password)}&pin=${encodeURIComponent(pin)}`}
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
                          `${BACKEND_URL}/api/trip/start?format=text`,
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
                        `${BACKEND_URL}/api/trip/start?format=text`,
                        'CarPlay Start Trip URL'
                      )
                    }
                  >
                    <Text style={styles.copyUrlMonoText} numberOfLines={2}>
                      {`${BACKEND_URL}/api/trip/start?format=text`}
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
                          `${BACKEND_URL}/api/trip/stop?format=text`,
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
                        `${BACKEND_URL}/api/trip/stop?format=text`,
                        'CarPlay Stop Trip URL'
                      )
                    }
                  >
                    <Text style={styles.copyUrlMonoText} numberOfLines={2}>
                      {`${BACKEND_URL}/api/trip/stop?format=text`}
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
          </>
        )}
      </ScrollView>

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
              label: 'Account',
              renderIcon: (active: boolean) => (
                <Svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke={active ? '#34D399' : '#94A3B8'} strokeWidth={active ? 2.3 : 1.9}>
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
              onPress={() => setTab(item.id)}
              style={styles.tabItem}
              activeOpacity={0.7}
              accessibilityLabel={item.label}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <View style={[styles.tabIconWrapper, active && styles.tabIconWrapperActive]}>
                {item.renderIcon(active)}
              </View>
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

function TripSessionCard({ trip }: { trip: TripRecord }) {
  const [expanded, setExpanded] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const cardRef = useRef<any>(null);

  const effDisplay = getTripEfficiencyDisplay(trip);

  const computedDurationSec =
    trip.endTimestampSec &&
    trip.startTimestampSec &&
    trip.endTimestampSec > trip.startTimestampSec
      ? trip.endTimestampSec - trip.startTimestampSec
      : trip.durationSeconds;

  const cabinStr = (() => {
    const start = trip.startCabinTempC ?? trip.cabinTempC;
    const end = trip.endCabinTempC ?? trip.cabinTempC;
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
    return 'Cabin: --°C';
  })();

  const extStr = (() => {
    const start = trip.startExteriorTempC ?? trip.exteriorTempC;
    const end = trip.endExteriorTempC ?? trip.exteriorTempC;
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
    return 'Outside: --°C';
  })();

  const remoteAcStr =
    trip.acState && trip.acState !== 'Remote AC Off' && trip.acState !== 'AC OFF / Auto'
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
            { label: '📍 6a. Start Location', value: trip.startLocation || 'Unknown' },
            { label: '🏁 6b. Destination', value: trip.endLocation || 'Unknown' },
            { label: '7. Idling Time & Energy', value: idleSummary },
            { label: '🌡️ 8. Cabin & Ambient Temp', value: acSummary },
            { label: '9. Maximum Speed', value: `${trip.maxSpeedKmh} km/h` },
            { label: '10. Average Speed', value: `${trip.avgSpeedKmh} km/h` },
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
                <Text style={styles.metricBlockLabel}>📍 6a. Start Location</Text>
                <Text style={styles.metricBlockValue}>{trip.startLocation || 'Unknown'}</Text>
              </View>

              {/* 6b. End Location (Dedicated block prevents overlap!) */}
              <View style={styles.metricBlock}>
                <Text style={styles.metricBlockLabel}>🏁 6b. Destination / End Location</Text>
                <Text style={styles.metricBlockValue}>{trip.endLocation || 'Unknown'}</Text>
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
                <Text style={styles.metricRowValue}>{trip.maxSpeedKmh} km/h</Text>
              </View>

              {/* 10. Avg Speed */}
              <View style={styles.metricRow}>
                <Text style={styles.metricRowLabel}>10. Average Speed</Text>
                <Text style={styles.metricRowValue}>{trip.avgSpeedKmh} km/h</Text>
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
    width: 62,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
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
});
