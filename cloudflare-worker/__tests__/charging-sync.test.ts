import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_PAUSE_CONFIRM_SECONDS,
  evaluateChargingStateDecision,
  parseTelemetryFromStatus,
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
});
