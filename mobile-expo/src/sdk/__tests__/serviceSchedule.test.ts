import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addCalendarMonthsToIsoDate,
  computeMilestoneCost,
  computeNextServiceStatus,
  computeWheelServicesStatus,
  createDefaultServiceReminderSettings,
  diffIsoDateDays,
  formatInrAmount,
  formatKmNumber,
  getMilestoneForKm,
  sanitizeServiceReminderSettings,
} from '../serviceSchedule';

test('milestone replacement items and INR costs match mgwindsor_service schedule', () => {
  const m1k = computeMilestoneCost(getMilestoneForKm(1000));
  assert.equal(m1k.partsTotalInr, 0);
  assert.equal(m1k.serviceChargeInr, 0);
  assert.equal(m1k.totalInr, 0);

  const m5k = computeMilestoneCost(getMilestoneForKm(5000));
  assert.equal(m5k.partsTotalInr, 1556);
  assert.equal(m5k.serviceChargeInr, 0);
  assert.equal(m5k.totalInr, 1556);

  const m15k = computeMilestoneCost(getMilestoneForKm(15000));
  assert.equal(m15k.partsTotalInr, 796);
  assert.equal(m15k.serviceChargeInr, 0);
  assert.equal(m15k.totalInr, 796);

  const m30k = computeMilestoneCost(getMilestoneForKm(30000));
  assert.equal(m30k.partsTotalInr, 796 + 515 + 821 + 1556);
  assert.equal(m30k.serviceChargeInr, 2301);
  assert.equal(m30k.totalInr, 5989);

  const m45k = computeMilestoneCost(getMilestoneForKm(45000));
  assert.equal(m45k.partsTotalInr, 796);
  assert.equal(m45k.serviceChargeInr, 2301);
  assert.equal(m45k.totalInr, 3097);

  const m150k = computeMilestoneCost(getMilestoneForKm(150000));
  assert.equal(m150k.totalInr, 5989);

  const m165k = computeMilestoneCost(getMilestoneForKm(165000));
  assert.equal(m165k.totalInr, 3097);
});

test('calendar date helpers add months cleanly and compute signed day countdowns', () => {
  assert.equal(addCalendarMonthsToIsoDate('2026-05-25', 12), '2027-05-25');
  assert.equal(addCalendarMonthsToIsoDate('2024-02-29', 12), '2025-02-28');
  assert.equal(addCalendarMonthsToIsoDate('2026-01-31', 1), '2026-02-28');
  assert.equal(diffIsoDateDays('2026-11-15', '2026-12-15'), 30);
  assert.equal(diffIsoDateDays('2026-11-16', '2026-12-15'), 29);
  assert.equal(diffIsoDateDays('2026-11-15', '2026-11-10'), -5);
});

test('service countdowns trigger Home alert inside default 30d or 1000km window and respect custom limits', () => {
  const base = createDefaultServiceReminderSettings();

  // At 32,400 km serviced on 2026-05-25 => next is 45,000 km on 2027-05-25 (₹3,097), no alert on 2026-11-15
  const healthy = computeNextServiceStatus({
    odometerKm: 32400,
    todayIsoDate: '2026-11-15',
    settings: { ...base, lastServiceDate: '2026-05-25' },
  });
  assert.equal(healthy.nextMilestone.km, 45000);
  assert.equal(healthy.kmRemaining, 12600);
  assert.equal(healthy.nextDueDate, '2027-05-25');
  assert.equal(healthy.daysRemaining, 191);
  assert.equal(healthy.cost.totalInr, 3097);
  assert.equal(healthy.isAlertActive, false);

  // Within last 30 days (counts down each day)
  const day25 = computeNextServiceStatus({
    odometerKm: 39000,
    todayIsoDate: '2027-04-30',
    settings: { ...base, lastServiceDate: '2026-05-25' },
  });
  assert.equal(day25.daysRemaining, 25);
  assert.equal(day25.isDaysWarning, true);
  assert.equal(day25.isKmWarning, false);
  assert.equal(day25.isAlertActive, true);
  assert.equal(day25.urgency, 'warning');

  const day24 = computeNextServiceStatus({
    odometerKm: 39050,
    todayIsoDate: '2027-05-01',
    settings: { ...base, lastServiceDate: '2026-05-25' },
  });
  assert.equal(day24.daysRemaining, 24);
  assert.equal(day24.kmRemaining, 5950);

  // Within last 1,000 km even if date has months left
  const kmSoon = computeNextServiceStatus({
    odometerKm: 44150,
    todayIsoDate: '2026-11-15',
    settings: { ...base, lastServiceDate: '2026-05-25' },
  });
  assert.equal(kmSoon.kmRemaining, 850);
  assert.equal(kmSoon.isKmWarning, true);
  assert.equal(kmSoon.isAlertActive, true);

  // Custom editable thresholds override 30d / 1000km cleanly
  const tightened = computeNextServiceStatus({
    odometerKm: 44150,
    todayIsoDate: '2027-04-30',
    settings: { ...base, lastServiceDate: '2026-05-25', warningDays: 14, warningKm: 500 },
  });
  assert.equal(tightened.isAlertActive, false);

  // Pinned milestone stays overdue if vehicle crosses 45,000 km before logging next service
  const overduePinned = computeNextServiceStatus({
    odometerKm: 45350,
    todayIsoDate: '2027-05-30',
    settings: { ...base, lastServiceDate: '2026-05-25', lastServiceMilestoneKm: 30000 },
  });
  assert.equal(overduePinned.nextMilestone.km, 45000);
  assert.equal(overduePinned.kmRemaining, -350);
  assert.equal(overduePinned.kmOverdueBy, 350);
  assert.equal(overduePinned.daysRemaining, -5);
  assert.equal(overduePinned.isOverdue, true);
  assert.equal(overduePinned.urgency, 'overdue');
});

test('missing lastServiceDate still calculates remaining km and approximate cost without fake days', () => {
  const status = computeNextServiceStatus({
    odometerKm: 28200,
    todayIsoDate: '2026-11-15',
    settings: createDefaultServiceReminderSettings(),
  });
  assert.equal(status.nextMilestone.km, 30000);
  assert.equal(status.kmRemaining, 1800);
  assert.equal(status.daysRemaining, null);
  assert.equal(status.cost.totalInr, 5989);
  assert.equal(status.isAlertActive, false);
});

test('wheel balancing, alignment and rotation evaluate custom intervals independently', () => {
  const base = createDefaultServiceReminderSettings();
  base.wheelServices.balancing = {
    enabled: true,
    intervalKm: 6000,
    lastDoneKm: 30000,
    lastDoneDate: '2026-05-25',
    warningKm: 500,
  };
  base.wheelServices.alignment = {
    enabled: true,
    intervalKm: 5000,
    lastDoneKm: 30000,
    lastDoneDate: '2026-05-25',
    warningKm: 500,
  };
  base.wheelServices.rotation = {
    enabled: true,
    intervalKm: 10000,
    lastDoneKm: 30000,
    lastDoneDate: '2026-05-25',
    warningKm: 500,
  };

  const statuses = computeWheelServicesStatus({
    odometerKm: 35600,
    settings: base,
  });

  const balancing = statuses.find((x) => x.key === 'balancing')!;
  assert.equal(balancing.nextDueKm, 36000);
  assert.equal(balancing.kmRemaining, 400);
  assert.equal(balancing.isDueSoon, true);
  assert.equal(balancing.isDueNow, false);
  assert.equal(balancing.isAlertActive, true);

  const alignment = statuses.find((x) => x.key === 'alignment')!;
  assert.equal(alignment.nextDueKm, 35000);
  assert.equal(alignment.kmRemaining, -600);
  assert.equal(alignment.kmOverdueBy, 600);
  assert.equal(alignment.isDueNow, true);
  assert.equal(alignment.isAlertActive, true);

  const rotation = statuses.find((x) => x.key === 'rotation')!;
  assert.equal(rotation.nextDueKm, 40000);
  assert.equal(rotation.kmRemaining, 4400);
  assert.equal(rotation.isAlertActive, false);
});

test('formatting and settings sanitization preserve valid bounds', () => {
  assert.equal(formatInrAmount(5989), '₹5,989');
  assert.equal(formatKmNumber(150000), '1,50,000');

  const sanitized = sanitizeServiceReminderSettings({
    lastServiceDate: '2026-02-31',
    warningDays: -5,
    warningKm: 999999,
    wheelServices: {
      balancing: { intervalKm: 50, lastDoneKm: 30000 },
    },
  });
  assert.equal(sanitized.lastServiceDate, null);
  assert.equal(sanitized.warningDays, 1);
  assert.equal(sanitized.warningKm, 20000);
  assert.equal(sanitized.wheelServices.balancing.intervalKm, 500);
  assert.equal(sanitized.wheelServices.balancing.lastDoneKm, 30000);
});
