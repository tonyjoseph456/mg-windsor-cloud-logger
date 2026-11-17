import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deduplicateChargeList,
  mapD1ChargeToRecord,
  mergePendingMeterOverrides,
  sanitizeMeterEnergyInput,
  summarizeChargeMeterAnalytics,
} from '../chargeMeter';
import type { ChargeLogRecord } from '../models';

function makeSession(overrides: Partial<ChargeLogRecord> = {}): ChargeLogRecord {
  return {
    id: 'chg_1',
    startTimestampSec: 1794670000,
    endTimestampSec: 1794713600,
    startDateTime: '14 Nov 2026, 10:51 pm',
    endDateTime: '15 Nov 2026, 10:59 am',
    startSoc: 16,
    endSoc: 100,
    startEnergyKwh: 6.08,
    endEnergyKwh: 38,
    odometerKm: 38500,
    distanceToEmptyAfterKm: 320,
    chargerCategory: '3.3 kW AC',
    maxChargingSpeedKw: 3.3,
    energyAddedToPackKwh: 31.92,
    energyConsumedKwh: 36.7,
    energyLossPercent: 13.0,
    distanceTravelledSinceLastChargeKm: 0,
    energyUsedSinceLastChargeKwh: 0,
    efficiencyKmPerKwh: 0,
    durationSeconds: 43600,
    status: 'completed',
    ...overrides,
  };
}

describe('Charge Meter Analytics & Sync Helpers', () => {
  it('sanitizeMeterEnergyInput validates empty clears, valid readings, and bounds', () => {
    assert.equal(sanitizeMeterEnergyInput(''), null);
    assert.equal(sanitizeMeterEnergyInput(null), null);
    assert.equal(sanitizeMeterEnergyInput('39.4'), 39.4);
    assert.equal(sanitizeMeterEnergyInput('39.456'), 39.46);
    assert.equal(sanitizeMeterEnergyInput('0'), 'invalid');
    assert.equal(sanitizeMeterEnergyInput('-1.2'), 'invalid');
    assert.equal(sanitizeMeterEnergyInput('600'), 'invalid');
    assert.equal(sanitizeMeterEnergyInput('abc'), 'invalid');
  });

  it('summarizeChargeMeterAnalytics computes separate meter total, real loss, and variance only over logged sessions', () => {
    const nov14 = makeSession({
      id: 'chg_nov14',
      energyAddedToPackKwh: 31.92,
      energyConsumedKwh: 36.7,
      meterEnergyKwh: 39.4,
    });
    const unlogged = makeSession({
      id: 'chg_unlogged',
      startTimestampSec: 1794800000,
      endTimestampSec: 1794820000,
      startSoc: 45,
      endSoc: 100,
      energyAddedToPackKwh: 20.9,
      energyConsumedKwh: 23.75,
      meterEnergyKwh: null,
    });

    const summary = summarizeChargeMeterAnalytics([nov14, unlogged]);
    assert.equal(summary.meterLoggedCount, 1);
    assert.equal(summary.totalMeterKwh, 39.4);
    assert.equal(summary.meterLoggedPackKwh, 31.92);
    assert.equal(summary.meterLoggedEstWallKwh, 36.7);
    assert.equal(summary.meterRealLossKwh, 7.48);
    assert.equal(summary.meterRealLossPct, 19);
    assert.equal(summary.meterDiffVsEstKwh, 2.7);
  });

  it('mergePendingMeterOverrides preserves unsynced edits and prunes once D1 matches', () => {
    const fromD1Pending = [
      makeSession({ id: 'chg_a', meterEnergyKwh: null }),
      makeSession({ id: 'chg_b', startTimestampSec: 1794800000, meterEnergyKwh: 15.2 }),
    ];

    const firstPass = mergePendingMeterOverrides(fromD1Pending, {
      chg_a: 39.4,
      chg_b: 15.2,
    });
    assert.equal(firstPass.merged[0].meterEnergyKwh, 39.4);
    assert.equal(firstPass.merged[1].meterEnergyKwh, 15.2);
    assert.equal(firstPass.changedPending, true);
    assert.deepEqual(firstPass.remainingPending, { chg_a: 39.4 });
  });

  it('mapD1ChargeToRecord and deduplicateChargeList preserve meter_energy_kwh', () => {
    const mapped = mapD1ChargeToRecord({
      id: 'chg_nov14',
      start_time: 1794670000,
      end_time: 1794713600,
      start_soc: 16,
      end_soc: 100,
      kwh_added: 31.92,
      energy_used_kwh: 36.7,
      meter_energy_kwh: 39.4,
      peak_power_kw: 3.3,
      status: 'completed',
    });
    assert.equal(mapped.meterEnergyKwh, 39.4);

    const dupWithoutMeter = makeSession({
      id: 'chg_nov14_alt',
      energyAddedToPackKwh: 32.0,
      meterEnergyKwh: null,
    });
    const deduped = deduplicateChargeList([dupWithoutMeter, mapped]);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].meterEnergyKwh, 39.4);
  });
});
