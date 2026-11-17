import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_MORNING_TYRE_DROP_PCT,
  TYRE_RECOMMENDED_PSI,
  buildMorningTyreCheckFailureRecord,
  buildMorningTyreCheckFromStatus,
  computeTyreThresholdPsi,
  evaluateSevereAirLoss,
  evaluateTyreDrop,
  extractTyreReadings,
  getIstDateAndTime,
  reevaluateMorningTyreCheck,
  sanitizeTyreDropThresholdPct,
  sanitizeTyreMonitorSettings,
  shouldRunMorningTyreCron,
  shouldShowMorningTyreAlertOnHome,
} from '../tyreMonitor';

test('computeTyreThresholdPsi and sanitization handle default 5%, 3% (<35 PSI), 6% (<34 PSI), and bounds', () => {
  assert.equal(sanitizeTyreDropThresholdPct(undefined), DEFAULT_MORNING_TYRE_DROP_PCT);
  assert.equal(sanitizeTyreDropThresholdPct(0.2), 1);
  assert.equal(sanitizeTyreDropThresholdPct(40), 25);
  assert.equal(sanitizeTyreDropThresholdPct(2.84), 2.8);

  assert.equal(computeTyreThresholdPsi(5, TYRE_RECOMMENDED_PSI), 34.2);
  assert.equal(computeTyreThresholdPsi(10, TYRE_RECOMMENDED_PSI), 32.4);
  assert.equal(computeTyreThresholdPsi(3, TYRE_RECOMMENDED_PSI), 34.92);
  assert.equal(computeTyreThresholdPsi(6, TYRE_RECOMMENDED_PSI), 33.84);
});

test('extractTyreReadings ignores null/zero/invalid values and evaluateTyreDrop flags breached tyres', () => {
  const missing = extractTyreReadings({});
  assert.deepEqual(missing, { fl: null, fr: null, rl: null, rr: null });

  const readings = extractTyreReadings({
    front_left_tyre_psi: 34.2,
    front_right_tyre_psi: 35.6,
    rear_left_tyre_psi: 0,
    rear_right_tyre_psi: null,
  });
  assert.deepEqual(readings, { fl: 34.2, fr: 35.6, rl: null, rr: null });

  const eval5 = evaluateTyreDrop(readings, 5);
  assert.equal(eval5.readingsCount, 2);
  assert.equal(eval5.hasAlert, true);
  assert.equal(eval5.lowTyres.length, 1);
  assert.equal(eval5.lowTyres[0].key, 'fl');
  assert.equal(eval5.lowTyres[0].psi, 34.2);
  assert.equal(eval5.lowTyres[0].dropPct, 5);

  const readingsBelow35 = extractTyreReadings({
    front_left_tyre_psi: 34.8,
    front_right_tyre_psi: 35.0,
    rear_left_tyre_psi: 35.2,
    rear_right_tyre_psi: 35.4,
  });
  const eval3 = evaluateTyreDrop(readingsBelow35, 3);
  assert.equal(eval3.lowTyres.map((t) => t.key).join(','), 'fl');
});

test('evaluateSevereAirLoss detects >= 10% drop (<= 32.4 PSI) on live sync', () => {
  const okReadings = extractTyreReadings({
    front_left_tyre_psi: 32.6,
    front_right_tyre_psi: 35.0,
    rear_left_tyre_psi: 34.2,
    rear_right_tyre_psi: 35.2,
  });
  assert.equal(evaluateSevereAirLoss(okReadings).hasAlert, false);

  const leakReadings = extractTyreReadings({
    front_left_tyre_psi: 32.4,
    front_right_tyre_psi: 35.0,
    rear_left_tyre_psi: 31.8,
    rear_right_tyre_psi: 35.2,
  });
  const severe = evaluateSevereAirLoss(leakReadings);
  assert.equal(severe.hasAlert, true);
  assert.equal(severe.thresholdPsi, 32.4);
  assert.deepEqual(
    severe.lowTyres.map((t) => t.key),
    ['fl', 'rl']
  );
  assert.equal(severe.lowestPsi, 31.8);
});

test('shouldRunMorningTyreCron triggers once per IST day inside 06:00-06:05 IST window', () => {
  // 2026-11-17 06:00:00 IST === 2026-11-17 00:30:00 UTC
  const sixAmIstSec = Math.floor(Date.UTC(2026, 10, 17, 0, 30, 0) / 1000);
  const ist = getIstDateAndTime(sixAmIstSec);
  assert.deepEqual(ist, { dateIst: '2026-11-17', hourIst: 6, minuteIst: 0 });

  assert.equal(
    shouldRunMorningTyreCron({ nowSec: sixAmIstSec, lastAttemptDateIst: null, morningCheckEnabled: true }),
    true
  );
  assert.equal(
    shouldRunMorningTyreCron({
      nowSec: sixAmIstSec + 5 * 60,
      lastAttemptDateIst: '2026-11-16',
      morningCheckEnabled: true,
    }),
    true
  );
  assert.equal(
    shouldRunMorningTyreCron({
      nowSec: sixAmIstSec + 60,
      lastAttemptDateIst: '2026-11-17',
      morningCheckEnabled: true,
    }),
    false
  );
  assert.equal(
    shouldRunMorningTyreCron({
      nowSec: sixAmIstSec - 60,
      lastAttemptDateIst: null,
      morningCheckEnabled: true,
    }),
    false
  );
  assert.equal(
    shouldRunMorningTyreCron({
      nowSec: sixAmIstSec + 6 * 60,
      lastAttemptDateIst: null,
      morningCheckEnabled: true,
    }),
    false
  );
  assert.equal(
    shouldRunMorningTyreCron({
      nowSec: sixAmIstSec,
      lastAttemptDateIst: null,
      morningCheckEnabled: false,
    }),
    false
  );
});

test('morning check lifecycle: fresh alert/ok, stale rejection, re-evaluation on threshold change, and Home visibility', () => {
  const sixAmSec = Math.floor(Date.UTC(2026, 10, 17, 0, 30, 0) / 1000);
  const settings5 = sanitizeTyreMonitorSettings({ dropThresholdPct: 5 });

  // Stale reading (> 1 hour older than 6 AM) stays in Tyres & closures only, never on Home
  const stale = buildMorningTyreCheckFromStatus({
    readings: { fl: 33.8, fr: 35.0, rl: 35.0, rr: 35.0 },
    settings: settings5,
    checkedAtSec: sixAmSec,
    statusTimeSec: sixAmSec - 5000,
  });
  assert.equal(stale.outcome, 'stale');
  assert.equal(stale.isFreshReading, false);
  assert.equal(shouldShowMorningTyreAlertOnHome(stale, '2026-11-17'), false);

  // Asleep failure stays out of Home screen
  const asleep = buildMorningTyreCheckFailureRecord({
    outcome: 'asleep',
    settings: settings5,
    checkedAtSec: sixAmSec,
  });
  assert.equal(asleep.outcome, 'asleep');
  assert.equal(shouldShowMorningTyreAlertOnHome(asleep, '2026-11-17'), false);

  // Fresh 34.6 PSI passes 5% (34.2) check, then flips to alert when user customizes to 3% (34.92)
  const okAt5 = buildMorningTyreCheckFromStatus({
    readings: { fl: 34.6, fr: 35.8, rl: 35.6, rr: 35.6 },
    settings: settings5,
    checkedAtSec: sixAmSec,
    statusTimeSec: sixAmSec - 30,
  });
  assert.equal(okAt5.outcome, 'ok');
  assert.equal(shouldShowMorningTyreAlertOnHome(okAt5, '2026-11-17'), false);

  const settings3 = sanitizeTyreMonitorSettings({ dropThresholdPct: 3 });
  const alertAt3 = reevaluateMorningTyreCheck(okAt5, settings3)!;
  assert.equal(alertAt3.outcome, 'alert');
  assert.equal(alertAt3.lowTyres[0].key, 'fl');
  assert.equal(shouldShowMorningTyreAlertOnHome(alertAt3, '2026-11-17'), true);
  assert.equal(shouldShowMorningTyreAlertOnHome(alertAt3, '2026-11-18'), false);

  const dismissed = { ...alertAt3, dismissedAtSec: sixAmSec + 2700 };
  assert.equal(shouldShowMorningTyreAlertOnHome(dismissed, '2026-11-17'), false);
});
