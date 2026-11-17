import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addCalendarDaysToIsoDate,
  addCalendarMonthsToIsoDate,
  buildComingUpTimeline,
  computeMaintenanceForecast,
  computeMilestoneCost,
  computeNextServiceStatus,
  computeServiceIntervalProgress,
  computeWeeklyRunningAverageFromTrips,
  computeWheelAlertSummary,
  computeWheelServicesStatus,
  createDefaultServiceReminderSettings,
  diffIsoDateDays,
  extractTripIsoDate,
  fetchLatestServiceCatalog,
  formatInrAmount,
  formatKmNumber,
  formatServiceDaysCountdownText,
  getMilestoneForKm,
  parseServiceCatalogFromHtml,
  projectDateFromRemainingKm,
  sanitizeServiceReminderSettings,
  sanitizeServiceScheduleCatalog,
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

test('parseServiceCatalogFromHtml extracts updated prices, service charge, and price note', () => {
  const updatedHtml = `
    <div class="source-box">
      <strong>Price information:</strong> The approximate prices shown on this page are based on the user's most recent <strong>45,000 km service on 10/05/2027 at Fortune MG Muvattupuzha</strong>.<br><br>
    </div>
    <script>
      const prices = {
        "AC filter": 890,
        "Coolant": 910,
        "Brake fluid": 560,
        "Reducer oil": 1700
      };
      const services = [
        {km:1000, time:"1 Month", replacements:[]},
        {km:5000, time:"6 Months", replacements:["Reducer oil"]},
        {km:15000, time:"1 Year", replacements:["AC filter"]},
        {km:30000, time:"2 Years", replacements:["AC filter","Brake fluid","Coolant","Reducer oil"]},
        {km:45000, time:"3 Years", replacements:["AC filter"]}
      ];
      function render() {
        const serviceCharge=s.km>=30000 ? 2550 : 0;
      }
    </script>
  `;

  const parsed = parseServiceCatalogFromHtml(updatedHtml, '2026-11-16T01:28:00.000Z');
  assert.ok(parsed);
  assert.equal(parsed.source, 'live');
  assert.equal(parsed.prices['AC filter'], 890);
  assert.equal(parsed.prices['Reducer oil'], 1700);
  assert.equal(parsed.paidServiceStartKm, 30000);
  assert.equal(parsed.paidServiceChargeInr, 2550);
  assert.equal(parsed.milestones.length, 5);
  assert.match(parsed.priceNote, /45,000 km service on 10\/05\/2027/);

  const status = computeNextServiceStatus({
    odometerKm: 32000,
    todayIsoDate: '2026-11-16',
    settings: { ...createDefaultServiceReminderSettings(), lastServiceDate: '2026-05-25' },
    catalog: parsed,
  });
  assert.equal(status.nextMilestone.km, 45000);
  assert.equal(status.cost.partsTotalInr, 890);
  assert.equal(status.cost.serviceChargeInr, 2550);
  assert.equal(status.cost.totalInr, 3440);
});

test('fetchLatestServiceCatalog handles live fetch success and network/404 fallback cleanly', async () => {
  const sampleHtml = `
    <script>
      const prices = { "AC filter": 825, "Coolant": 821, "Brake fluid": 515, "Reducer oil": 1556 };
      const services = [{km:15000, time:"1 Year", replacements:["AC filter"]}];
      const serviceCharge=s.km>=30000 ? 2400 : 0;
    </script>
  `;
  const okCatalog = await fetchLatestServiceCatalog({
    fetchImpl: (async () =>
      ({
        ok: true,
        text: async () => sampleHtml,
      }) as Response) as typeof fetch,
  });
  assert.ok(okCatalog);
  assert.equal(okCatalog.source, 'live');
  assert.equal(okCatalog.prices['AC filter'], 825);
  assert.equal(okCatalog.paidServiceChargeInr, 2400);

  const errCatalog = await fetchLatestServiceCatalog({
    fetchImpl: (async () => ({ ok: false, status: 500, text: async () => '' }) as Response) as typeof fetch,
  });
  assert.equal(errCatalog, null);

  assert.equal(parseServiceCatalogFromHtml('<html>Not found</html>'), null);

  const cached = sanitizeServiceScheduleCatalog(okCatalog, 'cached');
  assert.equal(cached.source, 'cached');
  assert.equal(cached.prices['AC filter'], 825);
  assert.equal(cached.paidServiceChargeInr, 2400);
});

test('computeServiceIntervalProgress and formatServiceDaysCountdownText handle all boundary states', () => {
  const prog = computeServiceIntervalProgress({
    odometerKm: 39472,
    lastServiceOdoKm: 30207,
    previousMilestoneKm: 30000,
    nextMilestoneKm: 45000,
  });
  assert.equal(prog.startKm, 30207);
  assert.equal(prog.targetKm, 45000);
  assert.equal(prog.startLabel, 'Last service 30,207');
  assert.equal(prog.targetLabel, '45,000 km');
  assert.ok(Math.abs(prog.fraction - (39472 - 30207) / (45000 - 30207)) < 1e-6);

  const fallbackPrev = computeServiceIntervalProgress({
    odometerKm: 37500,
    lastServiceOdoKm: null,
    previousMilestoneKm: 30000,
    nextMilestoneKm: 45000,
  });
  assert.equal(fallbackPrev.startKm, 30000);
  assert.equal(fallbackPrev.startLabel, 'Prev 30,000 km');
  assert.equal(fallbackPrev.fraction, 0.5);

  const overdueClamped = computeServiceIntervalProgress({
    odometerKm: 46000,
    lastServiceOdoKm: 30207,
    previousMilestoneKm: 30000,
    nextMilestoneKm: 45000,
  });
  assert.equal(overdueClamped.fraction, 1);

  const nullOdo = computeServiceIntervalProgress({
    odometerKm: null,
    lastServiceOdoKm: 30207,
    previousMilestoneKm: 30000,
    nextMilestoneKm: 45000,
  });
  assert.equal(nullOdo.fraction, 0);

  assert.equal(formatServiceDaysCountdownText(190), '190 days left');
  assert.equal(formatServiceDaysCountdownText(1), '1 day left');
  assert.equal(formatServiceDaysCountdownText(0), 'Due today');
  assert.equal(formatServiceDaysCountdownText(-3), '3 days overdue');
  assert.equal(formatServiceDaysCountdownText(null, 'Add date'), 'Add date');
});

test('addCalendarDaysToIsoDate and extractTripIsoDate handle calendar boundaries and formats', () => {
  assert.equal(addCalendarDaysToIsoDate('2026-11-17', 9), '2026-11-26');
  assert.equal(addCalendarDaysToIsoDate('2026-11-17', 104), '2027-03-01');
  assert.equal(addCalendarDaysToIsoDate('2024-02-28', 2), '2024-03-01');
  assert.equal(addCalendarDaysToIsoDate('2025-02-28', 1), '2025-03-01');

  assert.equal(extractTripIsoDate({ startDateTime: '16 Nov 2026, 10:30 am' }), '2026-11-16');
  assert.equal(extractTripIsoDate({ startDateTime: '2026-10-25T08:15:00' }), '2026-10-25');
  assert.equal(extractTripIsoDate({ startDateTime: '05/11/2026' }), '2026-11-05');
  assert.equal(extractTripIsoDate({ startDateTime: 'invalid' }), null);
});

test('computeWeeklyRunningAverageFromTrips computes weekly pace strictly from recent logged trips', () => {
  // Steady-state 4-week rolling window (oldest trip > 28d ago sets full 28-day denominator)
  const trips = [
    { id: 'old-1', distanceKm: 500, startDateTime: '01 Sep 2026, 09:00 am', status: 'completed' },
    { id: 't1', distanceKm: 370, startDateTime: '15 Nov 2026, 09:00 am', status: 'completed' },
    { id: 't2', distanceKm: 370, startDateTime: '08 Nov 2026, 09:00 am', status: 'completed' },
    { id: 't3', distanceKm: 370, startDateTime: '01 Nov 2026, 09:00 am', status: 'completed' },
    { id: 't4', distanceKm: 370, startDateTime: '25 Oct 2026, 09:00 am', status: 'completed' },
    // Duplicate id and ongoing driving trip should both be ignored
    { id: 't4', distanceKm: 999, startDateTime: '25 Oct 2026, 09:00 am', status: 'completed' },
    { id: 'live', distanceKm: 80, startDateTime: '17 Nov 2026, 09:00 am', status: 'driving' },
  ];
  const avg4w = computeWeeklyRunningAverageFromTrips({ trips, todayIsoDate: '2026-11-17' });
  assert.equal(avg4w.source, 'trips');
  assert.equal(avg4w.tripCount, 4);
  assert.equal(avg4w.totalDistanceKm, 1480);
  assert.equal(avg4w.windowDays, 28);
  assert.equal(avg4w.weeklyKm, 370);
  assert.equal(avg4w.windowLabel, 'last 4 weeks');

  // New logger with only 14 days of history uses observed 14-day (2-week) span
  const newLoggerAvg = computeWeeklyRunningAverageFromTrips({
    trips: [
      { id: 'n1', distanceKm: 300, startDateTime: '04 Nov 2026, 08:00 am', status: 'completed' },
      { id: 'n2', distanceKm: 400, startDateTime: '16 Nov 2026, 08:00 am', status: 'completed' },
    ],
    todayIsoDate: '2026-11-17',
  });
  assert.equal(newLoggerAvg.windowDays, 14);
  assert.equal(newLoggerAvg.weeklyKm, 350);
  assert.equal(newLoggerAvg.windowLabel, 'last 2 weeks');

  // 0 trips in last 4 weeks widens cleanly to last 8 weeks
  const avg8w = computeWeeklyRunningAverageFromTrips({
    trips: [
      { id: 'a0', distanceKm: 300, startDateTime: '01 Aug 2026, 08:00 am', status: 'completed' },
      { id: 'a1', distanceKm: 800, startDateTime: '10 Oct 2026, 08:00 am', status: 'completed' },
    ],
    todayIsoDate: '2026-11-17',
  });
  assert.equal(avg8w.source, 'trips');
  assert.equal(avg8w.windowDays, 56);
  assert.equal(avg8w.weeklyKm, 100);
  assert.equal(avg8w.windowLabel, 'last 8 weeks');

  // Empty or stale >8-week trips return source: 'none' (no odometer delta fallback)
  const emptyAvg = computeWeeklyRunningAverageFromTrips({
    trips: [{ id: 'stale', distanceKm: 1200, startDateTime: '01 Aug 2026, 08:00 am', status: 'completed' }],
    todayIsoDate: '2026-11-17',
  });
  assert.equal(emptyAvg.source, 'none');
  assert.equal(emptyAvg.weeklyKm, null);
});

test('computeMaintenanceForecast projects regular service and wheel care dates and triggers', () => {
  const settings = createDefaultServiceReminderSettings();
  settings.lastServiceDate = '2026-05-25';
  settings.lastServiceOdoKm = 30207;
  settings.wheelServices.balancing.lastDoneKm = 35000;
  settings.wheelServices.alignment.lastDoneKm = 35000;
  settings.wheelServices.rotation.lastDoneKm = 30000;

  const serviceStatus = computeNextServiceStatus({
    odometerKm: 39518,
    settings,
    todayIsoDate: '2026-11-17',
  });
  const wheelStatuses = computeWheelServicesStatus({ odometerKm: 39518, settings });

  // ~370 km/wk over last 4 weeks => 482 km wheel care ~26 Nov 2026; 5482 km service ~01 Mar 2027 (before 25 May 2027)
  const fastForecast = computeMaintenanceForecast({
    trips: [
      { id: 'o', distanceKm: 100, startDateTime: '01 Oct 2026, 09:00 am', status: 'completed' },
      { id: 'w1', distanceKm: 370.3, startDateTime: '22 Oct 2026, 09:00 am', status: 'completed' },
      { id: 'w2', distanceKm: 370.3, startDateTime: '29 Oct 2026, 09:00 am', status: 'completed' },
      { id: 'w3', distanceKm: 370.3, startDateTime: '05 Nov 2026, 09:00 am', status: 'completed' },
      { id: 'w4', distanceKm: 370.3, startDateTime: '12 Nov 2026, 09:00 am', status: 'completed' },
    ],
    serviceStatus,
    wheelStatuses,
    todayIsoDate: '2026-11-17',
  });
  assert.equal(fastForecast.runningAverage.weeklyKm, 370.3);
  assert.equal(fastForecast.regularService.distanceEstimatedDate, '2027-03-01');
  assert.equal(fastForecast.regularService.recommendedDate, '2027-03-01');
  assert.equal(fastForecast.regularService.likelyTrigger, 'distance');
  assert.equal(fastForecast.regularService.daysEarlierThanDueDate, 85);

  for (const key of ['balancing', 'alignment', 'rotation'] as const) {
    const wf = fastForecast.wheelServices.find((w) => w.key === key)!;
    assert.equal(wf.estimatedDate, '2026-11-26');
    assert.equal(wf.estimatedDays, 9);
  }
  assert.ok(fastForecast.advisorTip && fastForecast.advisorTip.includes('26 Nov 2026'));

  // Low weekly pace (70 km/wk = 10 km/day) => calendar due date 25 May 2027 arrives before 45,000 km
  const slowForecast = computeMaintenanceForecast({
    trips: [
      { id: 's0', distanceKm: 100, startDateTime: '01 Oct 2026, 09:00 am', status: 'completed' },
      { id: 's1', distanceKm: 280, startDateTime: '10 Nov 2026, 09:00 am', status: 'completed' },
    ],
    serviceStatus,
    wheelStatuses,
    todayIsoDate: '2026-11-17',
  });
  assert.equal(slowForecast.runningAverage.weeklyKm, 70);
  assert.equal(slowForecast.regularService.likelyTrigger, 'time');
  assert.equal(slowForecast.regularService.recommendedDate, '2027-05-25');
  assert.equal(slowForecast.regularService.recommendedDays, 189);
  assert.equal(slowForecast.wheelServices[0].estimatedDate, '2027-01-04'); // 482 / 10 = 48 days

  // Negligible pace (< 5 km/wk) guards against absurd multi-decade date projections
  assert.equal(
    projectDateFromRemainingKm({
      kmRemaining: 5000,
      dailyKm: 2 / 7,
      weeklyKm: 2,
      todayIsoDate: '2026-11-17',
    }),
    null
  );
});

test('computeWheelAlertSummary builds unified progress bar and handles mixed targets', () => {
  assert.equal(computeWheelAlertSummary([]), null);

  const settings = createDefaultServiceReminderSettings();
  settings.wheelServices.balancing.lastDoneKm = 35000;
  settings.wheelServices.alignment.lastDoneKm = 35000;
  settings.wheelServices.rotation.lastDoneKm = 30000;

  const sharedStatuses = computeWheelServicesStatus({ odometerKm: 39518, settings }).filter(
    (w) => w.isAlertActive
  );
  const shared = computeWheelAlertSummary(sharedStatuses)!;
  assert.ok(shared);
  assert.equal(shared.primary.kmRemaining, 482);
  assert.equal(shared.startKm, 35000);
  assert.equal(shared.targetKm, 40000);
  assert.equal(shared.startLabel, '35,000 last done');
  assert.equal(shared.targetLabel, '40,000 km');
  assert.equal(shared.allShareSameTarget, true);
  assert.equal(shared.hasOverdue, false);
  assert.ok(Math.abs(shared.fraction - 4518 / 5000) < 1e-6);

  // When one item is overdue at 39,000 and another is due soon at 40,000, primary picks the most urgent
  const mixedSettings = createDefaultServiceReminderSettings();
  mixedSettings.wheelServices.balancing.lastDoneKm = 34000; // due at 39,000 (-518 km)
  mixedSettings.wheelServices.alignment.lastDoneKm = 35000; // due at 40,000 (+482 km)
  mixedSettings.wheelServices.rotation.enabled = false;
  const mixedStatuses = computeWheelServicesStatus({
    odometerKm: 39518,
    settings: mixedSettings,
  }).filter((w) => w.isAlertActive);
  const mixed = computeWheelAlertSummary(mixedStatuses)!;
  assert.equal(mixed.primary.key, 'balancing');
  assert.equal(mixed.primary.kmRemaining, -518);
  assert.equal(mixed.allShareSameTarget, false);
  assert.equal(mixed.hasOverdue, true);
  assert.equal(mixed.fraction, 1);
});

test('buildComingUpTimeline orders tyre care, expected service, and latest date chronologically', () => {
  const settings = createDefaultServiceReminderSettings();
  settings.lastServiceDate = '2026-05-25';
  settings.lastServiceOdoKm = 30207;
  settings.wheelServices.balancing.lastDoneKm = 35000;
  settings.wheelServices.alignment.lastDoneKm = 35000;
  settings.wheelServices.rotation.lastDoneKm = 30000;

  const serviceStatus = computeNextServiceStatus({
    odometerKm: 39518,
    settings,
    todayIsoDate: '2026-11-17',
  });
  const wheelStatuses = computeWheelServicesStatus({ odometerKm: 39518, settings });

  // ~532 km/wk across 12 days => 482 km ~6d (23 Nov 2026), 5482 km ~72d (28 Jan 2027), latest 25 May 2027 (189d)
  const fastForecast = computeMaintenanceForecast({
    trips: [
      { id: 'd1', distanceKm: 456, startDateTime: '06 Nov 2026, 09:00 am', status: 'completed' },
      { id: 'd2', distanceKm: 456, startDateTime: '16 Nov 2026, 09:00 am', status: 'completed' },
    ],
    serviceStatus,
    wheelStatuses,
    todayIsoDate: '2026-11-17',
  });
  assert.equal(fastForecast.runningAverage.windowDays, 12);
  assert.equal(fastForecast.runningAverage.weeklyKm, 532);

  const timeline = buildComingUpTimeline({
    serviceStatus,
    wheelStatuses,
    forecast: fastForecast,
  });
  assert.equal(timeline.nodes.length, 3);
  assert.equal(timeline.nodes[0].title, 'Tyre care');
  assert.equal(timeline.nodes[0].subtitle, 'Balancing, alignment and rotation · at 40,000 km');
  assert.equal(timeline.nodes[0].dateText, '~23 Nov 2026');
  assert.equal(timeline.nodes[0].etaText, 'In ~6 days');

  assert.equal(timeline.nodes[1].title, '45,000 km service');
  assert.equal(timeline.nodes[1].dateText, '~28 Jan 2027');
  assert.equal(timeline.nodes[1].etaText, 'In ~72 days');
  assert.match(timeline.nodes[1].subtitle, /before the latest date/);

  assert.equal(timeline.nodes[2].title, 'Latest date');
  assert.equal(timeline.nodes[2].dateText, '25 May 2027');
  assert.equal(timeline.nodes[2].etaText, 'In 189 days');
  assert.equal(
    timeline.calloutTip,
    'The three tyre jobs fall on the same date, so you can do them in one visit.'
  );

  // At low pace (70 km/wk), Latest date (189d) comes chronologically BEFORE 45,000 km (~783d)
  const slowForecast = computeMaintenanceForecast({
    trips: [
      { id: 's0', distanceKm: 100, startDateTime: '01 Oct 2026, 09:00 am', status: 'completed' },
      { id: 's1', distanceKm: 280, startDateTime: '10 Nov 2026, 09:00 am', status: 'completed' },
    ],
    serviceStatus,
    wheelStatuses,
    todayIsoDate: '2026-11-17',
  });
  const slowTimeline = buildComingUpTimeline({
    serviceStatus,
    wheelStatuses,
    forecast: slowForecast,
  });
  assert.deepEqual(
    slowTimeline.nodes.map((n) => n.kind),
    ['wheel', 'latest', 'service']
  );
  assert.match(slowTimeline.nodes[2].subtitle, /after the latest date/);
});
