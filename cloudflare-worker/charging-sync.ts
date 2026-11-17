/**
 * Pure telemetry parsing and charging pause-debounce logic shared by
 * cloudflare-worker/multi-worker.ts and Node unit tests.
 */

export const DEFAULT_PAUSE_CONFIRM_SECONDS = 120;
export const PAUSED_SESSION_TIMEOUT_SECONDS = 6 * 3600;

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
  const isMoving = speedKmh > 2;
  const gunPluggedIn = Boolean(ch?.is_plugged_in);
  // Measurable active power (>= 0.2 kW) guards against transient chargingState=0 BMS glitches,
  // but ONLY while the charge gun is plugged in and the vehicle is stationary; otherwise
  // positive pack current from regenerative braking while driving mimics AC charging.
  const isCharging =
    hasChargeTelemetry &&
    !isMoving &&
    Boolean(ch?.is_charging || (gunPluggedIn && calcKw >= 0.2));
  const isPluggedIn =
    hasChargeTelemetry &&
    !isMoving &&
    Boolean(gunPluggedIn || ch?.is_charging);
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

/**
 * Blocks starting or resuming a charging session when the vehicle is driving,
 * physically unplugged, or polled by idle cron while a fresh trip is ongoing.
 */
export function shouldBlockChargingSessionStart(params: {
  triggerSource: string;
  liveTelem: {
    isCharging: boolean;
    isPluggedIn?: boolean;
    hasChargeTelemetry?: boolean;
    speedKmh?: number;
  };
  hasOngoingTrip?: boolean;
}): boolean {
  if (params.triggerSource === 'test_start') return false;
  if (!params.liveTelem?.isCharging) return true;
  if (Number(params.liveTelem.speedKmh) > 1) return true;
  if (params.liveTelem.hasChargeTelemetry !== false && !params.liveTelem.isPluggedIn) {
    return true;
  }
  if (params.hasOngoingTrip && params.triggerSource === 'cron_idle') {
    return true;
  }
  return false;
}

/**
 * Returns true when a movement-ended charging session added 0% SoC and either
 * ran briefly (< 5 min) or drew negligible energy, indicating a false trigger.
 */
export function shouldDiscardZeroEnergySession(params: {
  triggerSource: string;
  socAdded: number;
  activeDurationSec: number;
  energyUsedKwh?: number;
}): boolean {
  if (params.triggerSource === 'test_end') return false;
  if (params.socAdded > 0) return false;
  const energyUsed = Number(params.energyUsedKwh) || 0;
  return params.activeDurationSec < 300 || energyUsed <= 0.1;
}

/**
 * Decides whether an ongoing/paused charging session should be finalized due to
 * vehicle movement/drive start. CarPlay booting when unlocking the car fires
 * `trip_start` while still parked; ignore it unless the vehicle moved or is
 * confirmed physically unplugged and idle.
 */
export function shouldFinalizeOnMovement(params: {
  triggerSource: string;
  odoDiffKm: number;
  liveTelem: {
    isCharging?: boolean;
    isPluggedIn?: boolean;
    hasChargeTelemetry?: boolean;
    speedKmh?: number;
  };
}): boolean {
  if (params.triggerSource === 'test_end') return true;
  if (params.odoDiffKm >= 0.2) return true;
  if (params.triggerSource === 'trip_start') {
    const isMoving = Number(params.liveTelem?.speedKmh) > 2;
    const hasChargeData = params.liveTelem?.hasChargeTelemetry !== false;
    const confirmedUnpluggedAndIdle =
      hasChargeData && !params.liveTelem?.isPluggedIn && !params.liveTelem?.isCharging;
    return isMoving || confirmedUnpluggedAndIdle;
  }
  return false;
}

/**
 * Computes final `end_time` and `active_duration_seconds` when completing a
 * charging session. Paused sessions anchor to `paused_at` so overnight idle
 * time before unlock/timeout is never counted as active charging duration.
 */
export function resolveCompletedSessionTiming(
  activeSession: any,
  nowSec: number
): { endTimeSec: number; activeDurationSec: number; durationMin: number } {
  const startTime = Number(activeSession?.start_time) || nowSec;
  const isPaused = activeSession?.status === 'paused' && Number(activeSession?.paused_at) > 0;
  const rawEndTime = isPaused ? Number(activeSession.paused_at) : nowSec;
  const endTimeSec = Math.max(startTime, Math.min(nowSec, rawEndTime));
  const wallDurationSec = Math.max(0, endTimeSec - startTime);
  const storedActiveSec = Math.max(0, Number(activeSession?.active_duration_seconds) || 0);
  const outageCount = Number(activeSession?.outage_count) || 0;

  let activeDurationSec = storedActiveSec;
  if (outageCount === 0) {
    activeDurationSec = Math.max(storedActiveSec, wallDurationSec);
  } else if (!isPaused) {
    const lastPoll = Number(activeSession?.last_poll_time) || startTime;
    const tailSec = Math.max(0, Math.min(3600, endTimeSec - lastPoll));
    activeDurationSec = storedActiveSec + tailSec;
  }

  if (wallDurationSec > 0 && activeDurationSec > wallDurationSec) {
    activeDurationSec = wallDurationSec;
  }

  return {
    endTimeSec,
    activeDurationSec,
    durationMin: Math.round(activeDurationSec / 60),
  };
}

export interface MissedChargeBaseline {
  baselineTime: number;
  baselineSoc: number;
  fromPriorSession: boolean;
  lat: number | null;
  lng: number | null;
  location: string | null;
}

/**
 * Finds the most recent parked baseline (last completed trip OR a more recent
 * completed charge at the same odometer) to recover unlogged charging sessions,
 * including top-ups to 99-100% SoC (>= 2% gain) after an earlier paused charge.
 */
export function findMissedChargeBaseline(params: {
  liveOdometerKm: number;
  liveSoc: number;
  nowSec: number;
  lastTrip?: any | null;
  lastSession?: any | null;
}): MissedChargeBaseline | null {
  const odo = Number(params.liveOdometerKm) || 0;
  const tEnd = Number(params.lastTrip?.end_timestamp) || 0;
  const tOdo = Number(params.lastTrip?.end_odometer_km);
  const tSoc = params.lastTrip?.end_soc != null ? Number(params.lastTrip.end_soc) : null;
  const tripValid =
    tEnd > 0 &&
    tSoc != null &&
    (!Number.isFinite(tOdo) || tOdo <= 0 || Math.abs(odo - tOdo) < 0.5);

  const sEnd = Number(params.lastSession?.end_time) || 0;
  const sOdo = Number(params.lastSession?.start_odometer_km);
  const sSoc = params.lastSession?.end_soc != null ? Number(params.lastSession.end_soc) : null;
  const sessionValid =
    sEnd > 0 &&
    sSoc != null &&
    (!Number.isFinite(sOdo) || sOdo <= 0 || Math.abs(odo - sOdo) < 0.5);

  const useSession = sessionValid && (!tripValid || sEnd >= tEnd);
  const baseline: MissedChargeBaseline | null = useSession
    ? {
        baselineTime: sEnd,
        baselineSoc: sSoc as number,
        fromPriorSession: true,
        lat: hasValidGpsCoords(params.lastSession?.start_lat, params.lastSession?.start_lng)
          ? Number(params.lastSession.start_lat)
          : null,
        lng: hasValidGpsCoords(params.lastSession?.start_lat, params.lastSession?.start_lng)
          ? Number(params.lastSession.start_lng)
          : null,
        location: params.lastSession?.location ? String(params.lastSession.location) : null,
      }
    : tripValid
    ? {
        baselineTime: tEnd,
        baselineSoc: tSoc as number,
        fromPriorSession: false,
        lat: hasValidGpsCoords(params.lastTrip?.end_lat, params.lastTrip?.end_lng)
          ? Number(params.lastTrip.end_lat)
          : null,
        lng: hasValidGpsCoords(params.lastTrip?.end_lat, params.lastTrip?.end_lng)
          ? Number(params.lastTrip.end_lng)
          : null,
        location: params.lastTrip?.end_location ? String(params.lastTrip.end_location) : null,
      }
    : null;

  if (!baseline) return null;
  if (
    !useSession &&
    sessionValid &&
    Number(params.lastSession?.start_time) >= baseline.baselineTime - 300
  ) {
    return null;
  }

  const socGain = Math.max(0, params.liveSoc - baseline.baselineSoc);
  const minSocGain = params.liveSoc >= 99 ? 2 : 3;
  if (socGain < minSocGain || params.nowSec <= baseline.baselineTime + 120) {
    return null;
  }

  return baseline;
}

/**
 * Anchors the starting SoC and location for a brand-new charging session.
 * When a previous charging session already completed at this parked location
 * more recently than the last trip, anchors `startSoc` to that session's
 * ending SoC so a follow-up top-up (e.g. 98% -> 100%) never double-counts the
 * prior trip-to-charge energy (e.g. 81% -> 98%).
 */
export function resolveNewSessionStartAnchor(params: {
  liveOdometerKm: number;
  liveSoc: number;
  nowSec: number;
  lastTrip?: any | null;
  lastSession?: any | null;
}): {
  startSoc: number;
  maxElapsedBoundSec: number | null;
  fallbackLat: number | null;
  fallbackLng: number | null;
  fallbackLocation: string | null;
} {
  const odo = Number(params.liveOdometerKm) || 0;
  const sameOdoAsTrip = Boolean(
    params.lastTrip &&
      Math.abs(odo - (Number(params.lastTrip.end_odometer_km) || odo)) < 0.3
  );
  const sameOdoAsSession = Boolean(
    params.lastSession &&
      params.lastSession.end_time &&
      Math.abs(odo - (Number(params.lastSession.start_odometer_km) || odo)) < 0.3
  );

  const tripEnd = sameOdoAsTrip ? Number(params.lastTrip?.end_timestamp) || 0 : 0;
  const sessionEnd = sameOdoAsSession ? Number(params.lastSession?.end_time) || 0 : 0;

  let startSoc = params.liveSoc;
  let maxElapsedBoundSec: number | null = null;
  if (sameOdoAsSession && sessionEnd >= tripEnd) {
    if (params.lastSession.end_soc != null) {
      startSoc = Math.min(params.liveSoc, Number(params.lastSession.end_soc));
    }
    if (sessionEnd > 0 && sessionEnd <= params.nowSec) {
      maxElapsedBoundSec = Math.max(0, params.nowSec - sessionEnd);
    }
  } else if (sameOdoAsTrip) {
    if (params.lastTrip.end_soc != null) {
      startSoc = Math.min(params.liveSoc, Number(params.lastTrip.end_soc));
    }
    if (tripEnd > 0 && tripEnd <= params.nowSec) {
      maxElapsedBoundSec = Math.max(0, params.nowSec - tripEnd);
    }
  }

  const tripCoordsOk =
    sameOdoAsTrip && hasValidGpsCoords(params.lastTrip?.end_lat, params.lastTrip?.end_lng);
  const sessionCoordsOk =
    sameOdoAsSession && hasValidGpsCoords(params.lastSession?.start_lat, params.lastSession?.start_lng);

  return {
    startSoc,
    maxElapsedBoundSec,
    fallbackLat: sessionCoordsOk
      ? Number(params.lastSession.start_lat)
      : tripCoordsOk
      ? Number(params.lastTrip.end_lat)
      : null,
    fallbackLng: sessionCoordsOk
      ? Number(params.lastSession.start_lng)
      : tripCoordsOk
      ? Number(params.lastTrip.end_lng)
      : null,
    fallbackLocation:
      (sameOdoAsSession && params.lastSession?.location) ||
      (sameOdoAsTrip && params.lastTrip?.end_location) ||
      null,
  };
}

/**
 * Validates user-entered external meter kWh (null/empty clears the reading;
 * otherwise accepts positive finite values up to 500 kWh rounded to 2 decimals).
 */
export function sanitizeMeterEnergyKwh(raw: any): number | null | 'invalid' {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 500) {
    return 'invalid';
  }
  return Number(n.toFixed(2));
}
