import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BMS_FULL_RANGE_KM,
  DEFAULT_PAUSE_CONFIRM_SECONDS,
  PAUSED_SESSION_TIMEOUT_SECONDS,
  evaluateChargingStateDecision,
  findMissedChargeBaseline,
  hasValidGpsCoords,
  parseTelemetryFromStatus,
  resolveChargingEndRangeKm,
  resolveCompletedSessionTiming,
  resolveNewSessionStartAnchor,
  shouldBlockChargingSessionStart,
  shouldDiscardZeroEnergySession,
  shouldFinalizeOnMovement,
} from '../charging-sync';

describe('Charging Telemetry & Pause Debounce State Machine', () => {
  it('marks hasChargeTelemetry=false when status.charge is null (TAP timeout / result 5)', () => {
    const parsed = parseTelemetryFromStatus({
      odometer_km: 38600,
      fuel_level: 72,
      range_km: 142,
      charge: null,
    });

    assert.equal(parsed.hasChargeTelemetry, false);
    assert.equal(parsed.isCharging, false);
    assert.equal(parsed.powerKw, 0);
    assert.equal(parsed.soc, 72);
    assert.equal(parsed.rangeKm, 142);
  });

  it('keeps isCharging=true when measurable power draw exists despite chargingState=0 glitch', () => {
    const parsed = parseTelemetryFromStatus({
      odometer_km: 38600,
      fuel_level: 72,
      range_km: 142,
      charge: {
        is_charging: false,
        is_plugged_in: true,
        charging_voltage: 382,
        charging_current: 6.8,
        soc: 72,
        range_km: 142,
      },
    });

    assert.equal(parsed.hasChargeTelemetry, true);
    assert.equal(parsed.isCharging, true);
    assert.equal(parsed.powerKw, 2.6);
  });

  it('ignores unavailable charge telemetry mid-session (Scenario 10) instead of pausing', () => {
    const activeSession = { id: 'chg_1', status: 'ongoing', pause_pending_at: null };
    const decision72 = evaluateChargingStateDecision(
      activeSession,
      { hasChargeTelemetry: false, isCharging: false },
      72,
      2000
    );
    assert.deepEqual(decision72, { action: 'ignore_unavailable' });

    const decision99 = evaluateChargingStateDecision(
      activeSession,
      { hasChargeTelemetry: false, isCharging: false },
      99,
      2000
    );
    assert.deepEqual(decision99, { action: 'ignore_unavailable' });

    const decision100 = evaluateChargingStateDecision(
      activeSession,
      { hasChargeTelemetry: false, isCharging: false },
      100,
      2000
    );
    assert.deepEqual(decision100, { action: 'complete_full' });
  });

  it('debounces momentary BMS dropouts (< 120s) without emitting pause/resume alerts', () => {
    const ongoing = { id: 'chg_2', status: 'ongoing', pause_pending_at: null };

    // Poll 1 (t=1000): first non-charging frame enters pending state only
    const d1 = evaluateChargingStateDecision(
      ongoing,
      { hasChargeTelemetry: true, isCharging: false },
      72,
      1000
    );
    assert.deepEqual(d1, { action: 'pending_pause', pausePendingAt: 1000 });

    // Poll 2 (t=1060): 60s later (< 120s) preserves original pausePendingAt without pausing
    const d2 = evaluateChargingStateDecision(
      { ...ongoing, pause_pending_at: 1000 },
      { hasChargeTelemetry: true, isCharging: false },
      72,
      1060
    );
    assert.deepEqual(d2, { action: 'pending_pause', pausePendingAt: 1000 });

    // Poll 3 (t=1100): charging telemetry recovers -> stays ongoing cleanly
    const d3 = evaluateChargingStateDecision(
      { ...ongoing, pause_pending_at: 1000 },
      { hasChargeTelemetry: true, isCharging: true },
      72,
      1100
    );
    assert.deepEqual(d3, { action: 'charging' });
  });

  it('confirms real power outage once non-charging persists >= confirmSec', () => {
    const pendingSession = {
      id: 'chg_3',
      status: 'ongoing',
      pause_pending_at: 1000,
    };

    const confirmed = evaluateChargingStateDecision(
      pendingSession,
      { hasChargeTelemetry: true, isCharging: false },
      72,
      1000 + DEFAULT_PAUSE_CONFIRM_SECONDS
    );
    assert.deepEqual(confirmed, { action: 'confirm_pause', pausedAt: 1000 });

    const stillPaused = evaluateChargingStateDecision(
      { id: 'chg_3', status: 'paused', paused_at: 1000, pause_pending_at: null },
      { hasChargeTelemetry: true, isCharging: false },
      72,
      1000 + DEFAULT_PAUSE_CONFIRM_SECONDS + 600
    );
    assert.deepEqual(stillPaused, { action: 'stay_paused' });
  });

  it('captures real BMS end range (320 km at 100%) and ignores frozen pre-charge values', () => {
    // 1. Fresh BMS reading at 100% -> uses real BMS value directly
    assert.equal(
      resolveChargingEndRangeKm({
        startRangeKm: 142,
        liveRangeKm: 320,
        startSoc: 45,
        endSoc: 100,
        isComplete: true,
      }),
      320
    );

    // 2. Real BMS variation (e.g. 316 km) is preserved without forcing 320/324
    assert.equal(
      resolveChargingEndRangeKm({
        startRangeKm: 142,
        liveRangeKm: 316,
        startSoc: 45,
        endSoc: 100,
        isComplete: true,
      }),
      316
    );

    // 3. Frozen BMS range mid-charge (still 142 km at 72%) is ignored rather than saved as end_range_km
    assert.equal(
      resolveChargingEndRangeKm({
        startRangeKm: 142,
        liveRangeKm: 142,
        startSoc: 45,
        endSoc: 72,
        isComplete: false,
      }),
      null
    );

    // 4. Frozen BMS range (142 km) on 100% completion falls back to real 320 km rating (not 324)
    assert.equal(
      resolveChargingEndRangeKm({
        startRangeKm: 142,
        liveRangeKm: 142,
        startSoc: 45,
        endSoc: 100,
        isComplete: true,
      }),
      BMS_FULL_RANGE_KM
    );
  });

  it('validates non-zero GPS coordinates for charging location capture', () => {
    assert.equal(hasValidGpsCoords(10.0512, 76.6214), true);
    assert.equal(hasValidGpsCoords(0, 0), false);
    assert.equal(hasValidGpsCoords(null, 76.6214), false);
    assert.equal(hasValidGpsCoords(NaN, 76.6214), false);
  });

  it('never mistakes regenerative braking while driving or unplugged for AC charging', () => {
    // 1. Driving with positive regen current (e.g. ~5.8 kW) while unplugged
    const drivingRegen = parseTelemetryFromStatus({
      odometer_km: 38640.5,
      fuel_level: 43,
      gps: { latitude: 10.02, longitude: 76.31, speed_kmh: 48.2 },
      charge: {
        is_charging: false,
        is_plugged_in: false,
        charging_voltage: 381.5,
        charging_current: 15.2,
        soc: 43,
        range_km: 138,
      },
    });
    assert.equal(drivingRegen.isCharging, false);
    assert.equal(drivingRegen.isPluggedIn, false);
    assert.equal(drivingRegen.powerKw, 0);

    // 2. Stationary/stale-GPS positive current while gun is unplugged
    const unpluggedPositiveCurrent = parseTelemetryFromStatus({
      odometer_km: 38640.5,
      fuel_level: 43,
      gps: { latitude: 10.02, longitude: 76.31, speed_kmh: 0 },
      charge: {
        is_charging: false,
        is_plugged_in: false,
        charging_voltage: 381.5,
        charging_current: 8.5,
        soc: 43,
        range_km: 138,
      },
    });
    assert.equal(unpluggedPositiveCurrent.isCharging, false);
    assert.equal(unpluggedPositiveCurrent.isPluggedIn, false);
    assert.equal(unpluggedPositiveCurrent.powerKw, 0);

    // 3. Moving vehicle (> 2 km/h) never reports charging even if flag is stale
    const movingStaleFlag = parseTelemetryFromStatus({
      odometer_km: 38641.2,
      fuel_level: 43,
      gps: { latitude: 10.03, longitude: 76.32, speed_kmh: 32.0 },
      charge: {
        is_charging: true,
        is_plugged_in: true,
        charging_voltage: 380,
        charging_current: 8.5,
        soc: 43,
        range_km: 138,
      },
    });
    assert.equal(movingStaleFlag.isCharging, false);
    assert.equal(movingStaleFlag.isPluggedIn, false);
    assert.equal(movingStaleFlag.powerKw, 0);
  });

  it('blocks false charging starts during driving or ongoing trips and prunes 0 kWh noise sessions', () => {
    assert.equal(
      shouldBlockChargingSessionStart({
        triggerSource: 'cron_idle',
        liveTelem: { isCharging: true, isPluggedIn: true, hasChargeTelemetry: true, speedKmh: 0 },
        hasOngoingTrip: true,
      }),
      true
    );
    assert.equal(
      shouldBlockChargingSessionStart({
        triggerSource: 'cron_idle',
        liveTelem: { isCharging: true, isPluggedIn: false, hasChargeTelemetry: true, speedKmh: 0 },
        hasOngoingTrip: false,
      }),
      true
    );
    assert.equal(
      shouldBlockChargingSessionStart({
        triggerSource: 'user_refresh',
        liveTelem: { isCharging: true, isPluggedIn: true, hasChargeTelemetry: true, speedKmh: 12 },
        hasOngoingTrip: false,
      }),
      true
    );
    assert.equal(
      shouldBlockChargingSessionStart({
        triggerSource: 'cron_idle',
        liveTelem: { isCharging: true, isPluggedIn: true, hasChargeTelemetry: true, speedKmh: 0 },
        hasOngoingTrip: false,
      }),
      false
    );
    assert.equal(
      shouldBlockChargingSessionStart({
        triggerSource: 'test_start',
        liveTelem: { isCharging: true, isPluggedIn: false, hasChargeTelemetry: true, speedKmh: 50 },
        hasOngoingTrip: true,
      }),
      false
    );

    // 3m (180s) 0% / 0 kWh false session is discarded instead of persisted
    assert.equal(
      shouldDiscardZeroEnergySession({
        triggerSource: 'cron',
        socAdded: 0,
        activeDurationSec: 185,
        energyUsedKwh: 0,
      }),
      true
    );
    // Genuine session with >= 1% gain or simulated test_end is preserved
    assert.equal(
      shouldDiscardZeroEnergySession({
        triggerSource: 'cron',
        socAdded: 1,
        activeDurationSec: 185,
        energyUsedKwh: 0.43,
      }),
      false
    );
    assert.equal(
      shouldDiscardZeroEnergySession({
        triggerSource: 'test_end',
        socAdded: 0,
        activeDurationSec: 180,
        energyUsedKwh: 0,
      }),
      false
    );
  });

  it('does not let CarPlay unlock trip_start kill plugged-in/paused sessions or stretch duration past paused_at', () => {
    assert.equal(PAUSED_SESSION_TIMEOUT_SECONDS, 6 * 3600);

    // Unlocking car wakes CarPlay (trip_start at 0 km/h) while gun is still plugged in
    assert.equal(
      shouldFinalizeOnMovement({
        triggerSource: 'trip_start',
        odoDiffKm: 0,
        liveTelem: { isCharging: false, isPluggedIn: true, hasChargeTelemetry: true, speedKmh: 0 },
      }),
      false
    );

    // Unlocking car while actively charging or when charge frame timed out also preserves session
    assert.equal(
      shouldFinalizeOnMovement({
        triggerSource: 'trip_start',
        odoDiffKm: 0,
        liveTelem: { isCharging: true, isPluggedIn: true, hasChargeTelemetry: true, speedKmh: 0 },
      }),
      false
    );
    assert.equal(
      shouldFinalizeOnMovement({
        triggerSource: 'trip_start',
        odoDiffKm: 0,
        liveTelem: { isCharging: false, isPluggedIn: false, hasChargeTelemetry: false, speedKmh: 0 },
      }),
      false
    );

    // Physically unplugged & idle, moving (> 2 km/h), or odometer moved (>= 0.2 km) DOES finalize
    assert.equal(
      shouldFinalizeOnMovement({
        triggerSource: 'trip_start',
        odoDiffKm: 0,
        liveTelem: { isCharging: false, isPluggedIn: false, hasChargeTelemetry: true, speedKmh: 0 },
      }),
      true
    );
    assert.equal(
      shouldFinalizeOnMovement({
        triggerSource: 'trip_start',
        odoDiffKm: 0.3,
        liveTelem: { isCharging: false, isPluggedIn: true, hasChargeTelemetry: true, speedKmh: 25 },
      }),
      true
    );

    // Overnight 8:18 pm -> paused 11:13 pm (175 min), closed at 6:31 am (613 min wall time)
    const startSec = 1794581280; // 20:18
    const pausedSec = startSec + 175 * 60; // 23:13
    const unlockSec = startSec + 613 * 60; // 06:31 next day
    const timing = resolveCompletedSessionTiming(
      {
        status: 'paused',
        start_time: startSec,
        paused_at: pausedSec,
        outage_count: 0,
        active_duration_seconds: 173 * 60,
      },
      unlockSec
    );
    assert.equal(timing.endTimeSec, pausedSec);
    assert.equal(timing.durationMin, 175);
  });

  it('recovers and anchors repeat top-ups (e.g. 98% -> 100%) after a prior paused charge at same odometer', () => {
    const tTripEnd = 1794580800; // 20:10
    const tChargeEnd = 1794591780; // 23:13 (81% -> 98%)
    const tMorningCheck = tChargeEnd + 7 * 3600; // 06:13+ next day

    const lastTrip = {
      end_timestamp: tTripEnd,
      end_odometer_km: 39193.8,
      end_soc: 81,
      end_lat: 9.887,
      end_lng: 76.731,
      end_location: 'Home Charger',
    };
    const overnightSession = {
      start_time: tTripEnd + 180,
      end_time: tChargeEnd,
      start_odometer_km: 39193.8,
      start_soc: 81,
      end_soc: 98,
      start_lat: 9.887,
      start_lng: 76.731,
      location: 'Home Charger',
    };

    // Missed 98% -> 100% (+2% to full) IS recovered against overnightSession (not blocked by lastTrip)
    const topupRecovery = findMissedChargeBaseline({
      liveOdometerKm: 39193.8,
      liveSoc: 100,
      nowSec: tMorningCheck,
      lastTrip,
      lastSession: overnightSession,
    });
    assert.ok(topupRecovery);
    assert.equal(topupRecovery.baselineSoc, 98);
    assert.equal(topupRecovery.fromPriorSession, true);

    // Below 99%, +2% BMS drift is NOT falsely recovered; requires >= 3%
    assert.equal(
      findMissedChargeBaseline({
        liveOdometerKm: 39193.8,
        liveSoc: 83,
        nowSec: tTripEnd + 3600,
        lastTrip,
        lastSession: null,
      }),
      null
    );

    // Once 100% session is saved as lastSession, next check at 100% does not duplicate it
    assert.equal(
      findMissedChargeBaseline({
        liveOdometerKm: 39193.8,
        liveSoc: 100,
        nowSec: tMorningCheck + 900,
        lastTrip,
        lastSession: { ...overnightSession, end_time: tMorningCheck, end_soc: 100 },
      }),
      null
    );

    // Starting a live morning top-up session anchors startSoc to 98% (never re-anchoring to trip 81%)
    const startAnchor = resolveNewSessionStartAnchor({
      liveOdometerKm: 39193.8,
      liveSoc: 99,
      nowSec: tMorningCheck,
      lastTrip,
      lastSession: overnightSession,
    });
    assert.equal(startAnchor.startSoc, 98);
  });
});
