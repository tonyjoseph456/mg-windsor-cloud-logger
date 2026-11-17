/**
 * Shared Tyre Pressure Monitoring & Threshold Evaluation Logic
 *
 * Used identically by:
 *   1. Cloudflare Worker 6:00 AM IST cron check & `/api/tyres/*` APIs
 *   2. Mobile / PWA client (`App.tsx`) for Tyres & Closures UI and live-sync air-loss alerts
 */

export const TYRE_RECOMMENDED_PSI = 36;
export const DEFAULT_MORNING_TYRE_DROP_PCT = 5;
export const MIN_MORNING_TYRE_DROP_PCT = 1;
export const MAX_MORNING_TYRE_DROP_PCT = 25;
export const SEVERE_AIR_LOSS_DROP_PCT = 10;
export const MORNING_TYRE_CHECK_HOUR_IST = 6;
export const MORNING_TYRE_CHECK_WINDOW_MAX_MIN = 5;
export const MORNING_TYRE_STALE_AGE_SEC = 3600;
const IST_OFFSET_SEC = 19800;

export type TyrePositionKey = 'fl' | 'fr' | 'rl' | 'rr';

export const TYRE_POSITION_META: readonly {
  key: TyrePositionKey;
  shortLabel: string;
  label: string;
  statusField:
    | 'front_left_tyre_psi'
    | 'front_right_tyre_psi'
    | 'rear_left_tyre_psi'
    | 'rear_right_tyre_psi';
}[] = [
  { key: 'fl', shortLabel: 'FL', label: 'Front left', statusField: 'front_left_tyre_psi' },
  { key: 'fr', shortLabel: 'FR', label: 'Front right', statusField: 'front_right_tyre_psi' },
  { key: 'rl', shortLabel: 'RL', label: 'Rear left', statusField: 'rear_left_tyre_psi' },
  { key: 'rr', shortLabel: 'RR', label: 'Rear right', statusField: 'rear_right_tyre_psi' },
] as const;

export interface TyreReadingsSnapshot {
  fl: number | null;
  fr: number | null;
  rl: number | null;
  rr: number | null;
}

export interface TyreMonitorSettings {
  morningCheckEnabled: boolean;
  dropThresholdPct: number;
  recommendedPsi: number;
  updatedAtSec?: number;
}

export interface LowTyreDetail {
  key: TyrePositionKey;
  shortLabel: string;
  label: string;
  psi: number;
  dropPsi: number;
  dropPct: number;
}

export interface TyreThresholdEvaluation {
  recommendedPsi: number;
  dropThresholdPct: number;
  thresholdPsi: number;
  readingsCount: number;
  lowTyres: LowTyreDetail[];
  lowestPsi: number | null;
  hasAlert: boolean;
}

export type MorningTyreCheckOutcome =
  | 'ok'
  | 'alert'
  | 'asleep'
  | 'stale'
  | 'session_expired'
  | 'no_tyre_data'
  | 'error';

export interface MorningTyreCheckRecord {
  dateIst: string;
  checkedAtSec: number;
  statusTimeSec: number | null;
  lastCanActivitySec: number | null;
  isFreshReading: boolean;
  outcome: MorningTyreCheckOutcome;
  detailText: string;
  recommendedPsi: number;
  dropThresholdPct: number;
  thresholdPsi: number;
  readings: TyreReadingsSnapshot | null;
  lowTyres: LowTyreDetail[];
  dismissedAtSec?: number | null;
}

function roundToOneDecimal(val: number): number {
  return Math.round(val * 10) / 10;
}

function normalizePsiReading(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0 || num > 100) return null;
  return roundToOneDecimal(num);
}

/** Clamps and normalizes the user-customizable morning drop threshold (%). */
export function sanitizeTyreDropThresholdPct(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_MORNING_TYRE_DROP_PCT;
  const clamped = Math.min(MAX_MORNING_TYRE_DROP_PCT, Math.max(MIN_MORNING_TYRE_DROP_PCT, parsed));
  return roundToOneDecimal(clamped);
}

/** Normalizes persisted or incoming per-VIN tyre monitor settings. */
export function sanitizeTyreMonitorSettings(raw: unknown): TyreMonitorSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const morningCheckEnabled = obj.morningCheckEnabled !== false;
  const dropThresholdPct = sanitizeTyreDropThresholdPct(obj.dropThresholdPct);
  const rawRec = Number(obj.recommendedPsi);
  const recommendedPsi =
    Number.isFinite(rawRec) && rawRec >= 20 && rawRec <= 60
      ? roundToOneDecimal(rawRec)
      : TYRE_RECOMMENDED_PSI;
  const updatedAtSec =
    typeof obj.updatedAtSec === 'number' && Number.isFinite(obj.updatedAtSec) && obj.updatedAtSec > 0
      ? Math.floor(obj.updatedAtSec)
      : undefined;

  return {
    morningCheckEnabled,
    dropThresholdPct,
    recommendedPsi,
    ...(updatedAtSec ? { updatedAtSec } : {}),
  };
}

/** Computes the alert cutoff PSI for a drop percentage below the recommended PSI. */
export function computeTyreThresholdPsi(
  dropPct: number,
  recommendedPsi = TYRE_RECOMMENDED_PSI
): number {
  const cleanPct = sanitizeTyreDropThresholdPct(dropPct);
  const cleanRec =
    Number.isFinite(recommendedPsi) && recommendedPsi > 0 ? recommendedPsi : TYRE_RECOMMENDED_PSI;
  return Number((cleanRec * (1 - cleanPct / 100)).toFixed(2));
}

/** Extracts real non-null tyre PSI readings from a `Status` or readings snapshot object. */
export function extractTyreReadings(source: any): TyreReadingsSnapshot {
  if (!source || typeof source !== 'object') {
    return { fl: null, fr: null, rl: null, rr: null };
  }
  return {
    fl: normalizePsiReading(source.front_left_tyre_psi ?? source.fl),
    fr: normalizePsiReading(source.front_right_tyre_psi ?? source.fr),
    rl: normalizePsiReading(source.rear_left_tyre_psi ?? source.rl),
    rr: normalizePsiReading(source.rear_right_tyre_psi ?? source.rr),
  };
}

/** Evaluates tyre readings against a percentage drop from recommended PSI. */
export function evaluateTyreDrop(
  readings: TyreReadingsSnapshot | null | undefined,
  dropThresholdPct: number,
  recommendedPsi = TYRE_RECOMMENDED_PSI
): TyreThresholdEvaluation {
  const cleanPct = sanitizeTyreDropThresholdPct(dropThresholdPct);
  const cleanRec =
    Number.isFinite(recommendedPsi) && recommendedPsi > 0 ? recommendedPsi : TYRE_RECOMMENDED_PSI;
  const thresholdPsi = computeTyreThresholdPsi(cleanPct, cleanRec);

  const safeReadings = readings || { fl: null, fr: null, rl: null, rr: null };
  const lowTyres: LowTyreDetail[] = [];
  let readingsCount = 0;
  let lowestPsi: number | null = null;

  for (const meta of TYRE_POSITION_META) {
    const psi = normalizePsiReading(safeReadings[meta.key]);
    if (psi === null) continue;
    readingsCount += 1;
    if (lowestPsi === null || psi < lowestPsi) {
      lowestPsi = psi;
    }
    if (psi <= thresholdPsi + 1e-6) {
      const dropPsi = roundToOneDecimal(Math.max(0, cleanRec - psi));
      const dropPct = roundToOneDecimal(Math.max(0, ((cleanRec - psi) / cleanRec) * 100));
      lowTyres.push({
        key: meta.key,
        shortLabel: meta.shortLabel,
        label: meta.label,
        psi,
        dropPsi,
        dropPct,
      });
    }
  }

  return {
    recommendedPsi: cleanRec,
    dropThresholdPct: cleanPct,
    thresholdPsi,
    readingsCount,
    lowTyres,
    lowestPsi,
    hasAlert: lowTyres.length > 0,
  };
}

/** Evaluates live-synced tyre readings for severe air loss (>= 10% below 36 PSI, i.e. <= 32.4 PSI). */
export function evaluateSevereAirLoss(
  readings: TyreReadingsSnapshot | null | undefined,
  recommendedPsi = TYRE_RECOMMENDED_PSI
): TyreThresholdEvaluation {
  return evaluateTyreDrop(readings, SEVERE_AIR_LOSS_DROP_PCT, recommendedPsi);
}

/** Converts Unix seconds into IST (`UTC+5:30`) date string and clock components. */
export function getIstDateAndTime(nowSec = Math.floor(Date.now() / 1000)): {
  dateIst: string;
  hourIst: number;
  minuteIst: number;
} {
  const d = new Date((nowSec + IST_OFFSET_SEC) * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return {
    dateIst: `${y}-${m}-${day}`,
    hourIst: d.getUTCHours(),
    minuteIst: d.getUTCMinutes(),
  };
}

/** Formats Unix seconds as an IST clock label (e.g. `6:00 AM`). */
export function formatIstClockTime(sec?: number | null): string {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return '--';
  const d = new Date((Math.floor(sec) + IST_OFFSET_SEC) * 1000);
  let h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

/** Returns true when the 6:00 AM IST cron check should run once for today's date. */
export function shouldRunMorningTyreCron(params: {
  nowSec: number;
  lastAttemptDateIst?: string | null;
  morningCheckEnabled?: boolean;
}): boolean {
  if (params.morningCheckEnabled === false) return false;
  const { dateIst, hourIst, minuteIst } = getIstDateAndTime(params.nowSec);
  if (hourIst !== MORNING_TYRE_CHECK_HOUR_IST || minuteIst > MORNING_TYRE_CHECK_WINDOW_MAX_MIN) {
    return false;
  }
  return (params.lastAttemptDateIst || '').trim() !== dateIst;
}

/**
 * Checks whether a status frame timestamp is fresh for the 6:00 AM reading.
 * Cached frames older than 1 hour relative to `checkedAtSec` are marked stale.
 */
export function isMorningCheckReadingFresh(params: {
  checkedAtSec: number;
  statusTimeSec?: number | null;
  maxAgeSec?: number;
}): boolean {
  const statusTime = params.statusTimeSec;
  if (statusTime === null || statusTime === undefined || !Number.isFinite(statusTime) || statusTime <= 0) {
    return true;
  }
  const maxAge = params.maxAgeSec ?? MORNING_TYRE_STALE_AGE_SEC;
  return params.checkedAtSec - statusTime <= maxAge;
}

export function formatLowTyreListSummary(lowTyres: readonly LowTyreDetail[]): string {
  return lowTyres.map((t) => `${t.shortLabel} ${t.psi.toFixed(1)} PSI (-${t.dropPct}%)`).join(' · ');
}

/** Builds a normalized 6:00 AM check record from fetched status readings and settings. */
export function buildMorningTyreCheckFromStatus(params: {
  readings: TyreReadingsSnapshot;
  settings: TyreMonitorSettings;
  checkedAtSec: number;
  statusTimeSec?: number | null;
  lastCanActivitySec?: number | null;
}): MorningTyreCheckRecord {
  const cleanSettings = sanitizeTyreMonitorSettings(params.settings);
  const thresholdPsi = computeTyreThresholdPsi(
    cleanSettings.dropThresholdPct,
    cleanSettings.recommendedPsi
  );
  const { dateIst } = getIstDateAndTime(params.checkedAtSec);
  const statusTimeSec =
    typeof params.statusTimeSec === 'number' && Number.isFinite(params.statusTimeSec) && params.statusTimeSec > 0
      ? Math.floor(params.statusTimeSec)
      : null;
  const lastCanActivitySec =
    typeof params.lastCanActivitySec === 'number' &&
    Number.isFinite(params.lastCanActivitySec) &&
    params.lastCanActivitySec > 0
      ? Math.floor(params.lastCanActivitySec)
      : null;

  const evalAll = evaluateTyreDrop(
    params.readings,
    cleanSettings.dropThresholdPct,
    cleanSettings.recommendedPsi
  );

  if (evalAll.readingsCount === 0) {
    return {
      dateIst,
      checkedAtSec: params.checkedAtSec,
      statusTimeSec,
      lastCanActivitySec,
      isFreshReading: false,
      outcome: 'no_tyre_data',
      detailText: `Vehicle responded at ${formatIstClockTime(params.checkedAtSec)} IST, but no tyre pressure readings were reported.`,
      recommendedPsi: cleanSettings.recommendedPsi,
      dropThresholdPct: cleanSettings.dropThresholdPct,
      thresholdPsi,
      readings: params.readings,
      lowTyres: [],
      dismissedAtSec: null,
    };
  }

  const isFresh = isMorningCheckReadingFresh({
    checkedAtSec: params.checkedAtSec,
    statusTimeSec,
  });

  if (!isFresh) {
    return {
      dateIst,
      checkedAtSec: params.checkedAtSec,
      statusTimeSec,
      lastCanActivitySec,
      isFreshReading: false,
      outcome: 'stale',
      detailText: `6:00 AM check returned an older vehicle frame from ${formatIstClockTime(statusTimeSec)} IST; waiting for a fresh reading.`,
      recommendedPsi: cleanSettings.recommendedPsi,
      dropThresholdPct: cleanSettings.dropThresholdPct,
      thresholdPsi,
      readings: params.readings,
      lowTyres: [],
      dismissedAtSec: null,
    };
  }

  const timeLabel = formatIstClockTime(statusTimeSec || params.checkedAtSec);
  if (evalAll.hasAlert) {
    return {
      dateIst,
      checkedAtSec: params.checkedAtSec,
      statusTimeSec,
      lastCanActivitySec,
      isFreshReading: true,
      outcome: 'alert',
      detailText: `${formatLowTyreListSummary(evalAll.lowTyres)} · below ${cleanSettings.dropThresholdPct}% limit (≤ ${thresholdPsi} PSI) at ${timeLabel} IST.`,
      recommendedPsi: cleanSettings.recommendedPsi,
      dropThresholdPct: cleanSettings.dropThresholdPct,
      thresholdPsi,
      readings: params.readings,
      lowTyres: evalAll.lowTyres,
      dismissedAtSec: null,
    };
  }

  return {
    dateIst,
    checkedAtSec: params.checkedAtSec,
    statusTimeSec,
    lastCanActivitySec,
    isFreshReading: true,
    outcome: 'ok',
    detailText: `Checked at ${timeLabel} IST · All tyres OK (lowest ${evalAll.lowestPsi?.toFixed(1)} PSI, alert at ≤ ${thresholdPsi} PSI).`,
    recommendedPsi: cleanSettings.recommendedPsi,
    dropThresholdPct: cleanSettings.dropThresholdPct,
    thresholdPsi,
    readings: params.readings,
    lowTyres: [],
    dismissedAtSec: null,
  };
}

/** Builds a non-telemetry morning check outcome record (shown only in Tyres & closures). */
export function buildMorningTyreCheckFailureRecord(params: {
  outcome: Extract<MorningTyreCheckOutcome, 'asleep' | 'session_expired' | 'error'>;
  settings: TyreMonitorSettings;
  checkedAtSec: number;
  reason?: string;
}): MorningTyreCheckRecord {
  const cleanSettings = sanitizeTyreMonitorSettings(params.settings);
  const thresholdPsi = computeTyreThresholdPsi(
    cleanSettings.dropThresholdPct,
    cleanSettings.recommendedPsi
  );
  const { dateIst } = getIstDateAndTime(params.checkedAtSec);
  const timeLabel = formatIstClockTime(params.checkedAtSec);

  let detailText = '';
  if (params.outcome === 'asleep') {
    detailText = `6:00 AM check (${timeLabel} IST) could not wake the vehicle (12V Sleep Mode).`;
  } else if (params.outcome === 'session_expired') {
    detailText = `6:00 AM check (${timeLabel} IST) skipped — MG session expired. Tap Sync on Home to refresh your session.`;
  } else {
    detailText = `6:00 AM check (${timeLabel} IST) failed${params.reason ? `: ${params.reason}` : '.'}`;
  }

  return {
    dateIst,
    checkedAtSec: params.checkedAtSec,
    statusTimeSec: null,
    lastCanActivitySec: null,
    isFreshReading: false,
    outcome: params.outcome,
    detailText,
    recommendedPsi: cleanSettings.recommendedPsi,
    dropThresholdPct: cleanSettings.dropThresholdPct,
    thresholdPsi,
    readings: null,
    lowTyres: [],
    dismissedAtSec: null,
  };
}

/**
 * Re-evaluates an existing today's 6:00 AM reading when the user changes their
 * customizable threshold percentage in Tyres & closures.
 */
export function reevaluateMorningTyreCheck(
  existing: MorningTyreCheckRecord | null | undefined,
  nextSettings: TyreMonitorSettings
): MorningTyreCheckRecord | null {
  if (!existing) return null;
  const cleanSettings = sanitizeTyreMonitorSettings(nextSettings);
  const thresholdPsi = computeTyreThresholdPsi(
    cleanSettings.dropThresholdPct,
    cleanSettings.recommendedPsi
  );

  if (!existing.isFreshReading || !existing.readings) {
    return {
      ...existing,
      recommendedPsi: cleanSettings.recommendedPsi,
      dropThresholdPct: cleanSettings.dropThresholdPct,
      thresholdPsi,
    };
  }

  const rebuilt = buildMorningTyreCheckFromStatus({
    readings: existing.readings,
    settings: cleanSettings,
    checkedAtSec: existing.checkedAtSec,
    statusTimeSec: existing.statusTimeSec,
    lastCanActivitySec: existing.lastCanActivitySec,
  });

  // Preserve dismissal only when the alert state remained active under the existing dismissal
  const keepDismissed =
    existing.outcome === 'alert' &&
    rebuilt.outcome === 'alert' &&
    existing.dropThresholdPct === cleanSettings.dropThresholdPct
      ? existing.dismissedAtSec ?? null
      : null;

  return {
    ...rebuilt,
    dismissedAtSec: keepDismissed,
  };
}

/**
 * Returns true ONLY when the Home screen should render the 6:00 AM low-pressure card:
 * today's 6:00 AM reading breached the user's threshold and has not been dismissed.
 * Asleep / stale / error states stay strictly inside Tyres & closures.
 */
export function shouldShowMorningTyreAlertOnHome(
  record: MorningTyreCheckRecord | null | undefined,
  todayIst = getIstDateAndTime().dateIst
): boolean {
  if (!record) return false;
  if (record.dateIst !== todayIst) return false;
  if (record.outcome !== 'alert') return false;
  if (!Array.isArray(record.lowTyres) || record.lowTyres.length === 0) return false;
  if (record.dismissedAtSec) return false;
  return true;
}
