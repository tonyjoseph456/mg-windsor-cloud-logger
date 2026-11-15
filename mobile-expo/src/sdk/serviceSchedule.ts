export type ScheduledReplacementItem =
  | 'AC filter'
  | 'Coolant'
  | 'Brake fluid'
  | 'Reducer oil';

export type WheelServiceKey = 'balancing' | 'alignment' | 'rotation';

export const SERVICE_REPLACEMENT_PRICES_INR: Record<ScheduledReplacementItem, number> = {
  'AC filter': 796,
  Coolant: 821,
  'Brake fluid': 515,
  'Reducer oil': 1556,
};

/**
 * Paid labour/service charge from the 30,000 km service onward, matching
 * https://tonyjoseph456.github.io/mgwindsor_service/
 */
export const SERVICE_PAID_CHARGE_START_KM = 30000;
export const SERVICE_PAID_CHARGE_INR = 2301;

export const SERVICE_SCHEDULE_SOURCE_URL = 'https://tonyjoseph456.github.io/mgwindsor_service/';
export const SERVICE_PRICE_REFERENCE_NOTE =
  'Approximate costs from 30,000 km service on 25/05/2026 at Fortune MG Muvattupuzha (AC filter, coolant, brake fluid, reducer oil + ₹2,301 paid service from 30,000 km onward). Inspection-only items and tyre care are excluded; confirm final pricing with your MG service advisor.';

export interface ServiceMilestoneDefinition {
  km: number;
  monthsFromDelivery: number;
  timeLabel: string;
  replacements: ScheduledReplacementItem[];
}

export const WINDSOR_SERVICE_MILESTONES: readonly ServiceMilestoneDefinition[] = [
  { km: 1000, monthsFromDelivery: 1, timeLabel: '1 Month', replacements: [] },
  { km: 5000, monthsFromDelivery: 6, timeLabel: '6 Months', replacements: ['Reducer oil'] },
  { km: 15000, monthsFromDelivery: 12, timeLabel: '1 Year', replacements: ['AC filter'] },
  {
    km: 30000,
    monthsFromDelivery: 24,
    timeLabel: '2 Years',
    replacements: ['AC filter', 'Brake fluid', 'Coolant', 'Reducer oil'],
  },
  { km: 45000, monthsFromDelivery: 36, timeLabel: '3 Years', replacements: ['AC filter'] },
  {
    km: 60000,
    monthsFromDelivery: 48,
    timeLabel: '4 Years',
    replacements: ['AC filter', 'Brake fluid', 'Coolant', 'Reducer oil'],
  },
  { km: 75000, monthsFromDelivery: 60, timeLabel: '5 Years', replacements: ['AC filter'] },
  {
    km: 90000,
    monthsFromDelivery: 72,
    timeLabel: '6 Years',
    replacements: ['AC filter', 'Brake fluid', 'Coolant', 'Reducer oil'],
  },
  { km: 105000, monthsFromDelivery: 84, timeLabel: '7 Years', replacements: ['AC filter'] },
  {
    km: 120000,
    monthsFromDelivery: 96,
    timeLabel: '8 Years',
    replacements: ['AC filter', 'Brake fluid', 'Coolant', 'Reducer oil'],
  },
  { km: 135000, monthsFromDelivery: 108, timeLabel: '9 Years', replacements: ['AC filter'] },
  {
    km: 150000,
    monthsFromDelivery: 120,
    timeLabel: '10 Years',
    replacements: ['AC filter', 'Brake fluid', 'Coolant', 'Reducer oil'],
  },
];

export interface ServiceCostLineItem {
  name: string;
  amountInr: number;
  kind: 'part' | 'labour';
}

export interface ServiceCostBreakdown {
  partsTotalInr: number;
  serviceChargeInr: number;
  totalInr: number;
  lineItems: ServiceCostLineItem[];
}

export interface WheelServiceConfig {
  enabled: boolean;
  intervalKm: number;
  lastDoneKm: number | null;
  lastDoneDate: string | null;
  warningKm: number;
}

export interface ServiceReminderSettings {
  lastServiceDate: string | null;
  lastServiceOdoKm: number | null;
  /** Optional explicit last completed milestone km (0 = before 1,000 km; null = Auto-infer). */
  lastServiceMilestoneKm: number | null;
  warningDays: number;
  warningKm: number;
  wheelServices: Record<WheelServiceKey, WheelServiceConfig>;
}

export const WHEEL_SERVICE_META: Record<
  WheelServiceKey,
  { key: WheelServiceKey; label: string; shortLabel: string; defaultIntervalKm: number }
> = {
  balancing: {
    key: 'balancing',
    label: 'Wheel Balancing',
    shortLabel: 'Balancing',
    defaultIntervalKm: 5000,
  },
  alignment: {
    key: 'alignment',
    label: 'Wheel Alignment',
    shortLabel: 'Alignment',
    defaultIntervalKm: 5000,
  },
  rotation: {
    key: 'rotation',
    label: 'Tire Rotation',
    shortLabel: 'Rotation',
    defaultIntervalKm: 10000,
  },
};

export const DEFAULT_WHEEL_SERVICE_WARNING_KM = 500;
export const DEFAULT_SERVICE_WARNING_DAYS = 30;
export const DEFAULT_SERVICE_WARNING_KM = 1000;

export function createDefaultServiceReminderSettings(): ServiceReminderSettings {
  return {
    lastServiceDate: null,
    lastServiceOdoKm: null,
    lastServiceMilestoneKm: null,
    warningDays: DEFAULT_SERVICE_WARNING_DAYS,
    warningKm: DEFAULT_SERVICE_WARNING_KM,
    wheelServices: {
      balancing: {
        enabled: true,
        intervalKm: WHEEL_SERVICE_META.balancing.defaultIntervalKm,
        lastDoneKm: null,
        lastDoneDate: null,
        warningKm: DEFAULT_WHEEL_SERVICE_WARNING_KM,
      },
      alignment: {
        enabled: true,
        intervalKm: WHEEL_SERVICE_META.alignment.defaultIntervalKm,
        lastDoneKm: null,
        lastDoneDate: null,
        warningKm: DEFAULT_WHEEL_SERVICE_WARNING_KM,
      },
      rotation: {
        enabled: true,
        intervalKm: WHEEL_SERVICE_META.rotation.defaultIntervalKm,
        lastDoneKm: null,
        lastDoneDate: null,
        warningKm: DEFAULT_WHEEL_SERVICE_WARNING_KM,
      },
    },
  };
}

export function isValidIsoDateString(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yStr, mStr, dStr] = value.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const d = Number(dStr);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function getTodayLocalIsoDate(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addCalendarMonthsToIsoDate(isoDate: string, months: number): string | null {
  if (!isValidIsoDateString(isoDate)) return null;
  const [yStr, mStr, dStr] = isoDate.split('-');
  const y = Number(yStr);
  const m = Number(mStr) - 1;
  const d = Number(dStr);
  const targetMonthIndex = m + months;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(d, daysInTargetMonth);
  return `${String(targetYear).padStart(4, '0')}-${String(normalizedMonth + 1).padStart(2, '0')}-${String(
    clampedDay
  ).padStart(2, '0')}`;
}

/**
 * Signed whole calendar-day difference: `toIsoDate - fromIsoDate`.
 * Positive => days remaining; 0 => due today; negative => days overdue.
 */
export function diffIsoDateDays(fromIsoDate: string, toIsoDate: string): number | null {
  if (!isValidIsoDateString(fromIsoDate) || !isValidIsoDateString(toIsoDate)) return null;
  const [fy, fm, fd] = fromIsoDate.split('-').map(Number);
  const [ty, tm, td] = toIsoDate.split('-').map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / 86400000);
}

export function formatIsoDateShort(isoDate: string | null | undefined): string {
  if (!isValidIsoDateString(isoDate)) return 'Not set';
  const [y, m, d] = isoDate.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d).padStart(2, '0')} ${months[m - 1]} ${y}`;
}

export function formatInrAmount(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  const absStr = String(Math.abs(rounded));
  if (absStr.length <= 3) return `${sign}₹${absStr}`;
  const lastThree = absStr.slice(-3);
  const rest = absStr.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}₹${rest},${lastThree}`;
}

export function formatKmNumber(km: number): string {
  const rounded = Math.round(km);
  const sign = rounded < 0 ? '-' : '';
  const absStr = String(Math.abs(rounded));
  if (absStr.length <= 3) return `${sign}${absStr}`;
  const lastThree = absStr.slice(-3);
  const rest = absStr.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}${rest},${lastThree}`;
}

export function getMilestoneForKm(km: number): ServiceMilestoneDefinition {
  const preset = WINDSOR_SERVICE_MILESTONES.find((m) => m.km === km);
  if (preset) return preset;

  const normalizedKm = Math.max(150000, Math.round(km / 15000) * 15000);
  const years = Math.round(normalizedKm / 15000);
  const isMajor = normalizedKm % 30000 === 0;
  return {
    km: normalizedKm,
    monthsFromDelivery: years * 12,
    timeLabel: `${years} Year${years === 1 ? '' : 's'}`,
    replacements: isMajor
      ? ['AC filter', 'Brake fluid', 'Coolant', 'Reducer oil']
      : ['AC filter'],
  };
}

export function getServiceMilestonesUpTo(maxKm: number): ServiceMilestoneDefinition[] {
  const result = [...WINDSOR_SERVICE_MILESTONES];
  let km = 165000;
  while (km <= Math.max(150000, maxKm + 30000)) {
    result.push(getMilestoneForKm(km));
    km += 15000;
  }
  return result;
}

export function computeMilestoneCost(milestone: Pick<ServiceMilestoneDefinition, 'km' | 'replacements'>): ServiceCostBreakdown {
  const lineItems: ServiceCostLineItem[] = milestone.replacements.map((item) => ({
    name: item,
    amountInr: SERVICE_REPLACEMENT_PRICES_INR[item],
    kind: 'part',
  }));
  const partsTotalInr = lineItems.reduce((sum, x) => sum + x.amountInr, 0);
  const serviceChargeInr = milestone.km >= SERVICE_PAID_CHARGE_START_KM ? SERVICE_PAID_CHARGE_INR : 0;
  if (serviceChargeInr > 0) {
    lineItems.push({
      name: 'Paid service charge',
      amountInr: serviceChargeInr,
      kind: 'labour',
    });
  }
  return {
    partsTotalInr,
    serviceChargeInr,
    totalInr: partsTotalInr + serviceChargeInr,
    lineItems,
  };
}

export function findCompletedMilestoneIndexForOdo(odometerKm: number): number {
  const list = getServiceMilestonesUpTo(odometerKm);
  let lastIndex = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i].km <= odometerKm) {
      lastIndex = i;
    } else {
      break;
    }
  }
  return lastIndex;
}

export interface ComputedNextServiceStatus {
  previousMilestone: ServiceMilestoneDefinition | null;
  nextMilestone: ServiceMilestoneDefinition;
  cost: ServiceCostBreakdown;
  currentOdometerKm: number | null;
  kmRemaining: number | null;
  kmOverdueBy: number | null;
  intervalMonths: number;
  lastServiceDate: string | null;
  nextDueDate: string | null;
  daysRemaining: number | null;
  daysOverdueBy: number | null;
  isKmWarning: boolean;
  isDaysWarning: boolean;
  isOverdue: boolean;
  isAlertActive: boolean;
  urgency: 'normal' | 'warning' | 'overdue';
}

export function computeNextServiceStatus(params: {
  odometerKm: number | null | undefined;
  settings: ServiceReminderSettings;
  todayIsoDate?: string;
}): ComputedNextServiceStatus {
  const { odometerKm, settings } = params;
  const odo =
    typeof odometerKm === 'number' && Number.isFinite(odometerKm) && odometerKm >= 0
      ? odometerKm
      : null;
  const todayIso =
    params.todayIsoDate && isValidIsoDateString(params.todayIsoDate)
      ? params.todayIsoDate
      : getTodayLocalIsoDate();

  const referenceMaxKm = Math.max(
    odo ?? 0,
    settings.lastServiceOdoKm ?? 0,
    settings.lastServiceMilestoneKm ?? 0
  );
  const milestones = getServiceMilestonesUpTo(referenceMaxKm);

  let prevIdx = -1;
  if (
    settings.lastServiceMilestoneKm !== null &&
    settings.lastServiceMilestoneKm !== undefined &&
    Number.isFinite(settings.lastServiceMilestoneKm)
  ) {
    if (settings.lastServiceMilestoneKm <= 0) {
      prevIdx = -1;
    } else {
      const exactIdx = milestones.findIndex((m) => m.km === settings.lastServiceMilestoneKm);
      if (exactIdx >= 0) {
        prevIdx = exactIdx;
      } else {
        prevIdx = findCompletedMilestoneIndexForOdo(settings.lastServiceMilestoneKm);
      }
    }
  } else if (
    settings.lastServiceOdoKm !== null &&
    settings.lastServiceOdoKm !== undefined &&
    Number.isFinite(settings.lastServiceOdoKm)
  ) {
    prevIdx = findCompletedMilestoneIndexForOdo(settings.lastServiceOdoKm);
  } else if (odo !== null) {
    prevIdx = findCompletedMilestoneIndexForOdo(odo);
  }

  const previousMilestone = prevIdx >= 0 ? milestones[prevIdx] : null;
  const nextMilestone = milestones[Math.min(prevIdx + 1, milestones.length - 1)] || getMilestoneForKm(150000);
  const cost = computeMilestoneCost(nextMilestone);

  const kmRemainingRaw = odo !== null ? nextMilestone.km - odo : null;
  const kmRemaining = kmRemainingRaw !== null ? Math.round(kmRemainingRaw) : null;
  const kmOverdueBy = kmRemaining !== null && kmRemaining < 0 ? Math.abs(kmRemaining) : null;

  const prevMonths = previousMilestone ? previousMilestone.monthsFromDelivery : 0;
  const intervalMonths = Math.max(1, nextMilestone.monthsFromDelivery - prevMonths);

  const validLastDate = isValidIsoDateString(settings.lastServiceDate) ? settings.lastServiceDate : null;
  const nextDueDate = validLastDate ? addCalendarMonthsToIsoDate(validLastDate, intervalMonths) : null;
  const daysRemaining = nextDueDate ? diffIsoDateDays(todayIso, nextDueDate) : null;
  const daysOverdueBy = daysRemaining !== null && daysRemaining < 0 ? Math.abs(daysRemaining) : null;

  const warnDays = Math.max(0, Math.round(settings.warningDays));
  const warnKm = Math.max(0, Math.round(settings.warningKm));

  const isDaysWarning = daysRemaining !== null && daysRemaining <= warnDays;
  const isKmWarning = kmRemaining !== null && kmRemaining <= warnKm;
  const isOverdue =
    (daysRemaining !== null && daysRemaining < 0) || (kmRemaining !== null && kmRemaining < 0);
  const isAlertActive = isDaysWarning || isKmWarning;
  const urgency: 'normal' | 'warning' | 'overdue' = isOverdue
    ? 'overdue'
    : isAlertActive
      ? 'warning'
      : 'normal';

  return {
    previousMilestone,
    nextMilestone,
    cost,
    currentOdometerKm: odo,
    kmRemaining,
    kmOverdueBy,
    intervalMonths,
    lastServiceDate: validLastDate,
    nextDueDate,
    daysRemaining,
    daysOverdueBy,
    isKmWarning,
    isDaysWarning,
    isOverdue,
    isAlertActive,
    urgency,
  };
}

export interface ComputedWheelServiceItemStatus {
  key: WheelServiceKey;
  label: string;
  shortLabel: string;
  enabled: boolean;
  intervalKm: number;
  lastDoneKm: number | null;
  lastDoneDate: string | null;
  warningKm: number;
  nextDueKm: number | null;
  kmRemaining: number | null;
  kmOverdueBy: number | null;
  isConfigured: boolean;
  isDueNow: boolean;
  isDueSoon: boolean;
  isAlertActive: boolean;
  urgency: 'unconfigured' | 'normal' | 'warning' | 'overdue';
}

export function computeWheelServicesStatus(params: {
  odometerKm: number | null | undefined;
  settings: ServiceReminderSettings;
}): ComputedWheelServiceItemStatus[] {
  const odo =
    typeof params.odometerKm === 'number' && Number.isFinite(params.odometerKm) && params.odometerKm >= 0
      ? params.odometerKm
      : null;

  return (['balancing', 'alignment', 'rotation'] as WheelServiceKey[]).map((key) => {
    const meta = WHEEL_SERVICE_META[key];
    const cfg = params.settings.wheelServices[key];
    const intervalKm = Math.max(100, Math.round(cfg.intervalKm || meta.defaultIntervalKm));
    const warningKm = Math.max(0, Math.round(cfg.warningKm ?? DEFAULT_WHEEL_SERVICE_WARNING_KM));
    const lastDoneKm =
      cfg.lastDoneKm !== null && cfg.lastDoneKm !== undefined && Number.isFinite(cfg.lastDoneKm)
        ? Math.max(0, Math.round(cfg.lastDoneKm))
        : null;
    const lastDoneDate = isValidIsoDateString(cfg.lastDoneDate) ? cfg.lastDoneDate : null;
    const isConfigured = cfg.enabled && lastDoneKm !== null;
    const nextDueKm = lastDoneKm !== null ? lastDoneKm + intervalKm : null;
    const kmRemaining = nextDueKm !== null && odo !== null ? Math.round(nextDueKm - odo) : null;
    const kmOverdueBy = kmRemaining !== null && kmRemaining < 0 ? Math.abs(kmRemaining) : null;
    const isDueNow = Boolean(cfg.enabled && kmRemaining !== null && kmRemaining <= 0);
    const isDueSoon = Boolean(cfg.enabled && kmRemaining !== null && kmRemaining > 0 && kmRemaining <= warningKm);
    const isAlertActive = isDueNow || isDueSoon;
    const urgency: ComputedWheelServiceItemStatus['urgency'] = !isConfigured
      ? 'unconfigured'
      : isDueNow
        ? 'overdue'
        : isDueSoon
          ? 'warning'
          : 'normal';

    return {
      key,
      label: meta.label,
      shortLabel: meta.shortLabel,
      enabled: cfg.enabled,
      intervalKm,
      lastDoneKm,
      lastDoneDate,
      warningKm,
      nextDueKm,
      kmRemaining,
      kmOverdueBy,
      isConfigured,
      isDueNow,
      isDueSoon,
      isAlertActive,
      urgency,
    };
  });
}

export function sanitizeServiceReminderSettings(raw: unknown): ServiceReminderSettings {
  const defaults = createDefaultServiceReminderSettings();
  if (!raw || typeof raw !== 'object') return defaults;
  const obj = raw as Record<string, any>;

  const clampNum = (val: unknown, fallback: number, min: number, max: number): number => {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };

  const clampNullableNum = (val: unknown, min: number, max: number): number | null => {
    if (val === null || val === undefined || val === '') return null;
    const n = Number(val);
    if (!Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, Math.round(n)));
  };

  const wheelRaw = obj.wheelServices && typeof obj.wheelServices === 'object' ? obj.wheelServices : {};
  const parseWheel = (key: WheelServiceKey): WheelServiceConfig => {
    const item = wheelRaw[key] && typeof wheelRaw[key] === 'object' ? wheelRaw[key] : {};
    const def = defaults.wheelServices[key];
    return {
      enabled: typeof item.enabled === 'boolean' ? item.enabled : def.enabled,
      intervalKm: clampNum(item.intervalKm, def.intervalKm, 500, 100000),
      lastDoneKm: clampNullableNum(item.lastDoneKm, 0, 1000000),
      lastDoneDate: isValidIsoDateString(item.lastDoneDate) ? item.lastDoneDate : null,
      warningKm: clampNum(item.warningKm, def.warningKm, 0, 5000),
    };
  };

  return {
    lastServiceDate: isValidIsoDateString(obj.lastServiceDate) ? obj.lastServiceDate : null,
    lastServiceOdoKm: clampNullableNum(obj.lastServiceOdoKm, 0, 1000000),
    lastServiceMilestoneKm: clampNullableNum(obj.lastServiceMilestoneKm, 0, 1000000),
    warningDays: clampNum(obj.warningDays, defaults.warningDays, 1, 365),
    warningKm: clampNum(obj.warningKm, defaults.warningKm, 50, 20000),
    wheelServices: {
      balancing: parseWheel('balancing'),
      alignment: parseWheel('alignment'),
      rotation: parseWheel('rotation'),
    },
  };
}
