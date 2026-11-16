export type ScheduledReplacementItem =
  | 'AC filter'
  | 'Coolant'
  | 'Brake fluid'
  | 'Reducer oil'
  | (string & {});

export type WheelServiceKey = 'balancing' | 'alignment' | 'rotation';

export const SERVICE_REPLACEMENT_PRICES_INR: Record<string, number> = {
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

export interface ServiceScheduleCatalog {
  prices: Record<string, number>;
  paidServiceStartKm: number;
  paidServiceChargeInr: number;
  milestones: ServiceMilestoneDefinition[];
  priceNote: string;
  fetchedAt: string | null;
  source: 'live' | 'cached' | 'default';
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
    label: 'Wheel balancing',
    shortLabel: 'Balancing',
    defaultIntervalKm: 5000,
  },
  alignment: {
    key: 'alignment',
    label: 'Wheel alignment',
    shortLabel: 'Alignment',
    defaultIntervalKm: 5000,
  },
  rotation: {
    key: 'rotation',
    label: 'Tyre rotation',
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

export function getDefaultServiceScheduleCatalog(): ServiceScheduleCatalog {
  return {
    prices: { ...SERVICE_REPLACEMENT_PRICES_INR },
    paidServiceStartKm: SERVICE_PAID_CHARGE_START_KM,
    paidServiceChargeInr: SERVICE_PAID_CHARGE_INR,
    milestones: WINDSOR_SERVICE_MILESTONES.map((m) => ({
      ...m,
      replacements: [...m.replacements],
    })),
    priceNote: SERVICE_PRICE_REFERENCE_NOTE,
    fetchedAt: null,
    source: 'default',
  };
}

export function parseTimeLabelToMonths(timeLabel: string, fallbackKm?: number): number {
  const clean = (timeLabel || '').trim().toLowerCase();
  const yrMatch = clean.match(/(\d+(?:\.\d+)?)\s*year/);
  if (yrMatch) {
    return Math.max(1, Math.round(Number(yrMatch[1]) * 12));
  }
  const moMatch = clean.match(/(\d+(?:\.\d+)?)\s*month/);
  if (moMatch) {
    return Math.max(1, Math.round(Number(moMatch[1])));
  }
  if (typeof fallbackKm === 'number' && Number.isFinite(fallbackKm) && fallbackKm > 0) {
    if (fallbackKm <= 1000) return 1;
    if (fallbackKm <= 5000) return 6;
    return Math.max(12, Math.round(fallbackKm / 15000) * 12);
  }
  return 12;
}

function decodeBasicHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#8377;/gi, '₹');
}

function stripTagsAndNormalizeWhitespace(htmlFragment: string): string {
  return decodeBasicHtmlEntities(htmlFragment.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBalancedBlock(source: string, openIdx: number, openChar: string, closeChar: string): string | null {
  if (openIdx < 0 || source[openIdx] !== openChar) return null;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === openChar) depth += 1;
    else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIdx, i + 1);
      }
    }
  }
  return null;
}

function parsePriceObjectLiteral(block: string): Record<string, number> | null {
  const prices: Record<string, number> = {};
  const entryRegex = /(?:"([^"\\]+)"|'([^'\\]+)'|([A-Za-z_][A-Za-z0-9_\- ]*))\s*:\s*([0-9]+(?:\.[0-9]+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(block)) !== null) {
    const key = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    const val = Number(match[4]);
    if (key && Number.isFinite(val) && val >= 0) {
      prices[key] = Math.round(val);
    }
  }
  return Object.keys(prices).length > 0 ? prices : null;
}

function parseServicesArrayLiteral(block: string): ServiceMilestoneDefinition[] | null {
  const milestones: ServiceMilestoneDefinition[] = [];
  const rowRegex =
    /\{\s*km\s*:\s*([0-9]+)\s*,\s*time\s*:\s*(?:"([^"]*)"|'([^']*)')\s*,\s*replacements\s*:\s*(\[[^\]]*\])\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(block)) !== null) {
    const km = Number(match[1]);
    const timeLabel = (match[2] ?? match[3] ?? '').trim();
    const arrBody = match[4];
    if (!Number.isFinite(km) || km <= 0 || !timeLabel) continue;
    const replacements: ScheduledReplacementItem[] = [];
    const itemRegex = /"([^"\\]+)"|'([^'\\]+)'/g;
    let itemMatch: RegExpExecArray | null;
    while ((itemMatch = itemRegex.exec(arrBody)) !== null) {
      const name = (itemMatch[1] ?? itemMatch[2] ?? '').trim();
      if (name) replacements.push(name);
    }
    milestones.push({
      km: Math.round(km),
      monthsFromDelivery: parseTimeLabelToMonths(timeLabel, km),
      timeLabel,
      replacements,
    });
  }
  if (milestones.length === 0) return null;
  milestones.sort((a, b) => a.km - b.km);
  return milestones;
}

export function parseServiceCatalogFromHtml(
  html: string,
  fetchedAt: string = new Date().toISOString()
): ServiceScheduleCatalog | null {
  if (!html || typeof html !== 'string') return null;

  // 1. Parse `const prices = { ... }` from inline <script>
  const pricesAssignMatch = /\b(?:const|let|var)\s+prices\s*=\s*\{/.exec(html);
  if (!pricesAssignMatch) return null;
  const pricesOpenIdx = html.indexOf('{', pricesAssignMatch.index);
  const pricesBlock = extractBalancedBlock(html, pricesOpenIdx, '{', '}');
  const parsedPrices = pricesBlock ? parsePriceObjectLiteral(pricesBlock) : null;
  if (!parsedPrices) return null;

  // 2. Parse `const services = [ ... ]` from inline <script> (fallback to bundled milestones)
  let parsedMilestones: ServiceMilestoneDefinition[] | null = null;
  const servicesAssignMatch = /\b(?:const|let|var)\s+services\s*=\s*\[/.exec(html);
  if (servicesAssignMatch) {
    const servicesOpenIdx = html.indexOf('[', servicesAssignMatch.index);
    const servicesBlock = extractBalancedBlock(html, servicesOpenIdx, '[', ']');
    if (servicesBlock) {
      parsedMilestones = parseServicesArrayLiteral(servicesBlock);
    }
  }

  // 3. Parse paid service charge rule (`s.km>=30000 ? 2301 : 0`) or fallback note in HTML
  let paidStartKm = SERVICE_PAID_CHARGE_START_KM;
  let paidChargeInr = SERVICE_PAID_CHARGE_INR;
  const scriptChargeMatch =
    /s\.km\s*>=\s*([0-9]+)\s*\?\s*([0-9]+(?:\.[0-9]+)?)\s*:\s*0/.exec(html) ||
    /serviceCharge\s*=\s*[^;?\n]*>=\s*([0-9]+)\s*\?\s*([0-9]+(?:\.[0-9]+)?)\s*:\s*0/.exec(html);
  if (scriptChargeMatch) {
    const sKm = Number(scriptChargeMatch[1]);
    const sAmt = Number(scriptChargeMatch[2]);
    if (Number.isFinite(sKm) && sKm >= 0) paidStartKm = Math.round(sKm);
    if (Number.isFinite(sAmt) && sAmt >= 0) paidChargeInr = Math.round(sAmt);
  } else {
    const notesChargeMatch = /From the\s+([\d,]+)\s*km service onward[^₹\n]*₹\s*([\d,]+)/i.exec(
      stripTagsAndNormalizeWhitespace(html)
    );
    if (notesChargeMatch) {
      const sKm = Number(notesChargeMatch[1].replace(/,/g, ''));
      const sAmt = Number(notesChargeMatch[2].replace(/,/g, ''));
      if (Number.isFinite(sKm) && sKm >= 0) paidStartKm = Math.round(sKm);
      if (Number.isFinite(sAmt) && sAmt >= 0) paidChargeInr = Math.round(sAmt);
    }
  }

  // 4. Parse "Price information:" note if present in source-box
  let priceNote = SERVICE_PRICE_REFERENCE_NOTE;
  const priceInfoMatch = /<strong>\s*Price information:\s*<\/strong>([\s\S]*?)(?:<br\s*\/?>\s*<br\s*\/?>|<\/div>)/i.exec(
    html
  );
  if (priceInfoMatch && priceInfoMatch[1]) {
    const cleanedNote = stripTagsAndNormalizeWhitespace(priceInfoMatch[1]);
    if (cleanedNote.length >= 20) {
      priceNote = cleanedNote;
    }
  }

  return {
    prices: parsedPrices,
    paidServiceStartKm: paidStartKm,
    paidServiceChargeInr: paidChargeInr,
    milestones:
      parsedMilestones ||
      WINDSOR_SERVICE_MILESTONES.map((m) => ({ ...m, replacements: [...m.replacements] })),
    priceNote,
    fetchedAt: typeof fetchedAt === 'string' && fetchedAt ? fetchedAt : new Date().toISOString(),
    source: 'live',
  };
}

export function sanitizeServiceScheduleCatalog(
  raw: unknown,
  sourceOverride?: ServiceScheduleCatalog['source']
): ServiceScheduleCatalog {
  const def = getDefaultServiceScheduleCatalog();
  if (!raw || typeof raw !== 'object') return def;
  const obj = raw as Record<string, any>;

  const prices: Record<string, number> = {};
  if (obj.prices && typeof obj.prices === 'object') {
    for (const [k, v] of Object.entries(obj.prices)) {
      const key = String(k || '').trim();
      const val = Number(v);
      if (key && Number.isFinite(val) && val >= 0) {
        prices[key] = Math.round(val);
      }
    }
  }
  const hasValidPrices = Object.keys(prices).length > 0;

  const milestones: ServiceMilestoneDefinition[] = [];
  if (Array.isArray(obj.milestones)) {
    for (const row of obj.milestones) {
      if (!row || typeof row !== 'object') continue;
      const km = Number(row.km);
      const timeLabel = typeof row.timeLabel === 'string' ? row.timeLabel.trim() : '';
      const monthsFromDelivery = Number(row.monthsFromDelivery);
      if (!Number.isFinite(km) || km <= 0 || !timeLabel) continue;
      const replacements = Array.isArray(row.replacements)
        ? row.replacements
            .map((x: unknown) => String(x || '').trim())
            .filter(Boolean)
        : [];
      milestones.push({
        km: Math.round(km),
        timeLabel,
        monthsFromDelivery:
          Number.isFinite(monthsFromDelivery) && monthsFromDelivery >= 1
            ? Math.round(monthsFromDelivery)
            : parseTimeLabelToMonths(timeLabel, km),
        replacements,
      });
    }
  }
  milestones.sort((a, b) => a.km - b.km);

  const paidStart = Number(obj.paidServiceStartKm);
  const paidCharge = Number(obj.paidServiceChargeInr);
  const fetchedAt =
    typeof obj.fetchedAt === 'string' && obj.fetchedAt.trim() ? obj.fetchedAt.trim() : null;
  const source: ServiceScheduleCatalog['source'] =
    sourceOverride ||
    (obj.source === 'live' || obj.source === 'cached' || obj.source === 'default'
      ? obj.source
      : fetchedAt
        ? 'cached'
        : 'default');

  return {
    prices: hasValidPrices ? prices : def.prices,
    paidServiceStartKm:
      Number.isFinite(paidStart) && paidStart >= 0 ? Math.round(paidStart) : def.paidServiceStartKm,
    paidServiceChargeInr:
      Number.isFinite(paidCharge) && paidCharge >= 0
        ? Math.round(paidCharge)
        : def.paidServiceChargeInr,
    milestones: milestones.length > 0 ? milestones : def.milestones,
    priceNote:
      typeof obj.priceNote === 'string' && obj.priceNote.trim() ? obj.priceNote.trim() : def.priceNote,
    fetchedAt,
    source,
  };
}

export async function fetchLatestServiceCatalog(options?: {
  timeoutMs?: number;
  url?: string;
  fetchImpl?: typeof fetch;
}): Promise<ServiceScheduleCatalog | null> {
  const fetchFn = options?.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!fetchFn) return null;

  const baseUrl = options?.url || SERVICE_SCHEDULE_SOURCE_URL;
  const sep = baseUrl.includes('?') ? '&' : '?';
  const requestUrl = `${baseUrl}${sep}_=${Date.now()}`;
  const timeoutMs = Math.max(1000, options?.timeoutMs ?? 8000);

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchFn(requestUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: controller?.signal,
    });
    if (!res.ok) return null;
    const html = await res.text();
    return parseServiceCatalogFromHtml(html, new Date().toISOString());
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function lookupCatalogItemPrice(item: string, prices: Record<string, number>): number {
  if (Object.prototype.hasOwnProperty.call(prices, item)) {
    return prices[item];
  }
  const lower = item.trim().toLowerCase();
  for (const [k, v] of Object.entries(prices)) {
    if (k.trim().toLowerCase() === lower) return v;
  }
  return SERVICE_REPLACEMENT_PRICES_INR[item] ?? 0;
}

export function getMilestoneForKm(
  km: number,
  catalog?: ServiceScheduleCatalog
): ServiceMilestoneDefinition {
  const activeCatalog = catalog || getDefaultServiceScheduleCatalog();
  const preset = activeCatalog.milestones.find((m) => m.km === km);
  if (preset) return preset;

  const lastDefined =
    activeCatalog.milestones[activeCatalog.milestones.length - 1] ||
    WINDSOR_SERVICE_MILESTONES[WINDSOR_SERVICE_MILESTONES.length - 1];
  const minKm = lastDefined?.km ?? 150000;
  const normalizedKm = Math.max(minKm, Math.round(km / 15000) * 15000);
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

export function getServiceMilestonesUpTo(
  maxKm: number,
  catalog?: ServiceScheduleCatalog
): ServiceMilestoneDefinition[] {
  const activeCatalog = catalog || getDefaultServiceScheduleCatalog();
  const result = activeCatalog.milestones.map((m) => ({
    ...m,
    replacements: [...m.replacements],
  }));
  const lastDefinedKm = result.length > 0 ? result[result.length - 1].km : 150000;
  let km = lastDefinedKm + 15000;
  while (km <= Math.max(lastDefinedKm, maxKm + 30000)) {
    result.push(getMilestoneForKm(km, activeCatalog));
    km += 15000;
  }
  return result;
}

export function computeMilestoneCost(
  milestone: Pick<ServiceMilestoneDefinition, 'km' | 'replacements'>,
  catalog?: ServiceScheduleCatalog
): ServiceCostBreakdown {
  const activeCatalog = catalog || getDefaultServiceScheduleCatalog();
  const lineItems: ServiceCostLineItem[] = milestone.replacements.map((item) => ({
    name: item,
    amountInr: lookupCatalogItemPrice(item, activeCatalog.prices),
    kind: 'part',
  }));
  const partsTotalInr = lineItems.reduce((sum, x) => sum + x.amountInr, 0);
  const serviceChargeInr =
    milestone.km >= activeCatalog.paidServiceStartKm ? activeCatalog.paidServiceChargeInr : 0;
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

export function findCompletedMilestoneIndexForOdo(
  odometerKm: number,
  catalog?: ServiceScheduleCatalog
): number {
  const list = getServiceMilestonesUpTo(odometerKm, catalog);
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
  catalog?: ServiceScheduleCatalog;
}): ComputedNextServiceStatus {
  const { odometerKm, settings, catalog } = params;
  const activeCatalog = catalog || getDefaultServiceScheduleCatalog();
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
  const milestones = getServiceMilestonesUpTo(referenceMaxKm, activeCatalog);

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
        prevIdx = findCompletedMilestoneIndexForOdo(settings.lastServiceMilestoneKm, activeCatalog);
      }
    }
  } else if (
    settings.lastServiceOdoKm !== null &&
    settings.lastServiceOdoKm !== undefined &&
    Number.isFinite(settings.lastServiceOdoKm)
  ) {
    prevIdx = findCompletedMilestoneIndexForOdo(settings.lastServiceOdoKm, activeCatalog);
  } else if (odo !== null) {
    prevIdx = findCompletedMilestoneIndexForOdo(odo, activeCatalog);
  }

  const previousMilestone = prevIdx >= 0 ? milestones[prevIdx] : null;
  const nextMilestone =
    milestones[Math.min(prevIdx + 1, milestones.length - 1)] ||
    getMilestoneForKm(150000, activeCatalog);
  const cost = computeMilestoneCost(nextMilestone, activeCatalog);

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

export interface ServiceIntervalProgress {
  startKm: number;
  targetKm: number;
  fraction: number;
  startLabel: string;
  targetLabel: string;
}

/**
 * Computes progress across the current service interval (0..1) and endpoint labels
 * for both the Profile summary card and the Service Reminder hero card.
 */
export function computeServiceIntervalProgress(params: {
  odometerKm: number | null | undefined;
  lastServiceOdoKm: number | null | undefined;
  previousMilestoneKm: number | null | undefined;
  nextMilestoneKm: number;
}): ServiceIntervalProgress {
  const { odometerKm, lastServiceOdoKm, previousMilestoneKm, nextMilestoneKm } = params;
  const hasLastOdo =
    typeof lastServiceOdoKm === 'number' && Number.isFinite(lastServiceOdoKm) && lastServiceOdoKm >= 0;
  const hasPrev =
    typeof previousMilestoneKm === 'number' && Number.isFinite(previousMilestoneKm) && previousMilestoneKm >= 0;
  const startKm = hasLastOdo ? Math.round(lastServiceOdoKm!) : hasPrev ? Math.round(previousMilestoneKm!) : 0;
  const targetKm = Math.max(0, Math.round(nextMilestoneKm));

  let fraction = 0;
  if (typeof odometerKm === 'number' && Number.isFinite(odometerKm) && odometerKm >= 0) {
    const span = targetKm - startKm;
    if (span <= 0) {
      fraction = odometerKm >= targetKm ? 1 : 0;
    } else {
      fraction = Math.max(0, Math.min(1, (odometerKm - startKm) / span));
    }
  }

  const startLabel = hasLastOdo
    ? `Last service ${formatKmNumber(startKm)}`
    : hasPrev
      ? `Prev ${formatKmNumber(startKm)} km`
      : '0 km';

  return {
    startKm,
    targetKm,
    fraction,
    startLabel,
    targetLabel: `${formatKmNumber(targetKm)} km`,
  };
}

export function formatServiceDaysCountdownText(
  daysRemaining: number | null | undefined,
  missingText: string = 'Enter last service date'
): string {
  if (daysRemaining === null || daysRemaining === undefined || !Number.isFinite(daysRemaining)) {
    return missingText;
  }
  if (daysRemaining < 0) {
    const overdue = Math.abs(Math.round(daysRemaining));
    return `${overdue} day${overdue === 1 ? '' : 's'} overdue`;
  }
  if (daysRemaining === 0) return 'Due today';
  const rounded = Math.round(daysRemaining);
  return `${rounded} day${rounded === 1 ? '' : 's'} left`;
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
