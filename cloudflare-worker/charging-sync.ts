/**
 * Pure telemetry parsing and charging pause-debounce logic shared by
 * cloudflare-worker/multi-worker.ts and Node unit tests.
 */

export const DEFAULT_PAUSE_CONFIRM_SECONDS = 120;

export interface ParsedCarTelemetry {
  odometer: number;
  soc: number;
  lat: number | null;
  lng: number | null;
  speedKmh: number;
  cabinTempC: number | null;
  exteriorTempC: number | null;
  hasChargeTelemetry: boolean;
  isCharging: boolean;
  isPluggedIn: boolean;
  powerKw: number;
  rangeKm: number;
  chargeType: 'AC' | 'DC';
  chargeTimeElapsedSec: number;
  bmsStartTime: number | null;
  status: any;
}

export type ChargingStateDecision =
  | { action: 'ignore_unavailable' }
  | { action: 'charging' }
  | { action: 'complete_full' }
  | { action: 'pending_pause'; pausePendingAt: number }
  | { action: 'confirm_pause'; pausedAt: number }
  | { action: 'stay_paused' };

/**
 * Normalizes a `MgIndiaClient.status(true)` payload into backend telemetry.
 * Explicitly preserves `hasChargeTelemetry` so a missing/unavailable charge
 * frame (`status.charge === null`) is never confused with `isCharging = false`.
 */
export function parseTelemetryFromStatus(
  status: any,
  nowSec = Math.floor(Date.now() / 1000)
): ParsedCarTelemetry {
  const ch = status?.charge ?? null;
  const hasChargeTelemetry = ch != null;

  const odometer = Number(status?.odometer_km ?? ch?.odometer_km) || 0;
  const soc =
    ch?.soc != null
      ? Number(ch.soc)
      : status?.fuel_level != null
      ? Number(status.fuel_level)
      : 0;
  const lat = status?.gps?.latitude ?? null;
  const lng = status?.gps?.longitude ?? null;
  const speedKmh = Number(status?.gps?.speed_kmh) || 0;
  const cabinTempC =
    status?.interior_temperature != null ? Number(status.interior_temperature) : null;
  const exteriorTempC =
    status?.exterior_temperature != null ? Number(status.exterior_temperature) : null;

  const v = Number(ch?.charging_voltage) || 0;
  const a = Number(ch?.charging_current) || 0;
  const calcKw = v > 0 && a > 0 ? Number(((v * a) / 1000).toFixed(2)) : 0;
  // Measurable active power (>= 0.2 kW) guards against transient chargingState=0 BMS glitches
  const isCharging = hasChargeTelemetry && Boolean(ch?.is_charging || calcKw >= 0.2);
  const isPluggedIn = hasChargeTelemetry && Boolean(ch?.is_plugged_in || isCharging);
  const powerKw = isCharging ? (calcKw > 0 ? calcKw : 3.3) : 0;
  const chargeType: 'AC' | 'DC' = powerKw > 11 ? 'DC' : 'AC';
  const rangeKm = Number(ch?.range_km ?? status?.range_km) || 0;

  const rawElapsed = Number(ch?.charge_time_elapsed_s) || 0;
  const rawStartTime = Number(ch?.start_time) || 0;
  const elapsedFromStart =
    rawStartTime > 1700000000 && nowSec >= rawStartTime && nowSec - rawStartTime < 86400
      ? nowSec - rawStartTime
      : 0;
  const chargeTimeElapsedSec =
    rawElapsed > 0 && rawElapsed < 86400
      ? Math.max(rawElapsed, elapsedFromStart)
      : elapsedFromStart;
  const bmsStartTime =
    rawStartTime > 1700000000 && nowSec >= rawStartTime && nowSec - rawStartTime < 86400
      ? rawStartTime
      : chargeTimeElapsedSec > 0
      ? nowSec - chargeTimeElapsedSec
      : null;

  return {
    odometer,
    soc,
    lat,
    lng,
    speedKmh,
    cabinTempC,
    exteriorTempC,
    hasChargeTelemetry,
    isCharging,
    isPluggedIn,
    powerKw,
    rangeKm,
    chargeType,
    chargeTimeElapsedSec,
    bmsStartTime,
    status,
  };
}

/**
 * Decides the state transition for an active charging session while filtering
 * out unavailable charge frames and momentary BMS dropouts (< confirmSec).
 */
export function evaluateChargingStateDecision(
  activeSession: any,
  liveTelem: { isCharging: boolean; hasChargeTelemetry?: boolean },
  currentSoc: number,
  nowSec: number,
  confirmSec = DEFAULT_PAUSE_CONFIRM_SECONDS
): ChargingStateDecision {
  const hasChargeData = liveTelem?.hasChargeTelemetry !== false;

  if (hasChargeData && liveTelem?.isCharging) {
    return { action: 'charging' };
  }

  // If the charge TAP frame timed out or returned unavailable, never infer a
  // grid outage; only allow completion when SoC has already reached 100%.
  if (!hasChargeData) {
    if (currentSoc >= 100) {
      return { action: 'complete_full' };
    }
    return { action: 'ignore_unavailable' };
  }

  if (currentSoc >= 99) {
    return { action: 'complete_full' };
  }

  if (activeSession?.status === 'paused') {
    return { action: 'stay_paused' };
  }

  const existingPending = Number(activeSession?.pause_pending_at);
  const hasValidPending =
    Number.isFinite(existingPending) && existingPending > 0 && existingPending <= nowSec;
  if (hasValidPending && nowSec - existingPending >= confirmSec) {
    return { action: 'confirm_pause', pausedAt: existingPending };
  }

  return {
    action: 'pending_pause',
    pausePendingAt: hasValidPending ? existingPending : nowSec,
  };
}

export const BMS_FULL_RANGE_KM = 320;

export function hasValidGpsCoords(
  lat: number | null | undefined,
  lng: number | null | undefined
): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    (Math.abs(lat) > 0.001 || Math.abs(lng) > 0.001)
  );
}

/**
 * Selects the best verified BMS ending range (km) for a charging session.
 * MG's BMS often leaves `range_km` frozen at the pre-charge value during slow
 * AC charging, so stale unchanged readings after substantial SoC gain are
 * skipped; at 100% completion, falls back to 320 km if BMS hasn't updated yet.
 */
export function resolveChargingEndRangeKm(params: {
  startRangeKm?: number | null;
  storedEndRangeKm?: number | null;
  liveRangeKm?: number | null;
  startSoc?: number | null;
  endSoc?: number | null;
  isComplete?: boolean;
}): number | null {
  const startRange = Number(params.startRangeKm) || 0;
  const storedEnd = Number(params.storedEndRangeKm) || 0;
  const liveRange = Number(params.liveRangeKm) || 0;
  const startSoc = Number(params.startSoc) || 0;
  const endSoc = Number(params.endSoc) || startSoc;
  const socAdded = Math.max(0, endSoc - startSoc);

  const isFrozenPreCharge = startRange > 0 && socAdded >= 5 && liveRange <= startRange + 2;
  const isImplausibleFull = endSoc >= 99 && liveRange < 250;
  const isFreshLiveRange = liveRange > 0 && !isFrozenPreCharge && !isImplausibleFull;

  if (isFreshLiveRange) {
    return Math.round(liveRange);
  }

  if (storedEnd > 0 && !(endSoc >= 99 && storedEnd < 250)) {
    return Math.round(storedEnd);
  }

  if (params.isComplete && endSoc > 0) {
    return Math.round((endSoc / 100) * BMS_FULL_RANGE_KM);
  }

  return null;
}
