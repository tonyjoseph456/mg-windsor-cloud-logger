/**
 * MG Windsor EV variant definitions (per official MG Windsor brochure)
 * and detection helpers for gating the Remote Sunroof control.
 */
import type { Snapshot } from './models';

export type WindsorVariantId =
  | 'excite'
  | 'exclusive'
  | 'essence'
  | 'exclusive_pro'
  | 'essence_pro';

export interface WindsorVariantSpec {
  id: WindsorVariantId;
  label: string;
  batteryLabel: string;
  batteryKwh: number;
  hasSunroof: boolean;
  sunroofLabel: string;
}

export const WINDSOR_VARIANTS: readonly WindsorVariantSpec[] = [
  {
    id: 'excite',
    label: 'Excite',
    batteryLabel: '38 kWh',
    batteryKwh: 38,
    hasSunroof: false,
    sunroofLabel: 'No glass roof / sunroof',
  },
  {
    id: 'exclusive',
    label: 'Exclusive',
    batteryLabel: '38 kWh',
    batteryKwh: 38,
    hasSunroof: false,
    sunroofLabel: 'No glass roof / sunroof',
  },
  {
    id: 'essence',
    label: 'Essence',
    batteryLabel: '38 kWh',
    batteryKwh: 38,
    hasSunroof: true,
    sunroofLabel: 'Infinity View Glass Roof',
  },
  {
    id: 'exclusive_pro',
    label: 'Exclusive Pro',
    batteryLabel: '52.9 kWh',
    batteryKwh: 52.9,
    hasSunroof: false,
    sunroofLabel: 'No glass roof / sunroof',
  },
  {
    id: 'essence_pro',
    label: 'Essence Pro',
    batteryLabel: '52.9 kWh',
    batteryKwh: 52.9,
    hasSunroof: true,
    sunroofLabel: 'Infinity View Glass Roof',
  },
] as const;

export function getWindsorVariantById(id?: string | null): WindsorVariantSpec | null {
  if (!id) return null;
  const normalized = String(id).trim().toLowerCase();
  return WINDSOR_VARIANTS.find((v) => v.id === normalized) || null;
}

export function matchWindsorVariantFromText(text?: string | null): WindsorVariantSpec | null {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;

  if (/\bessence\s+pro\b/i.test(cleaned)) {
    return getWindsorVariantById('essence_pro');
  }
  if (/\bexclusive\s+pro\b/i.test(cleaned)) {
    return getWindsorVariantById('exclusive_pro');
  }
  if (/\bessence\b/i.test(cleaned)) {
    return getWindsorVariantById('essence');
  }
  if (/\bexclusive\b/i.test(cleaned)) {
    return getWindsorVariantById('exclusive');
  }
  if (/\bexcite\b/i.test(cleaned)) {
    return getWindsorVariantById('excite');
  }
  return null;
}

function collectCandidateVariantStrings(snapshot?: Partial<Snapshot> | null): string[] {
  const strings: string[] = [];
  const veh: any = snapshot?.vehicle;
  if (!veh || typeof veh !== 'object') return strings;

  const raw: Record<string, any> =
    veh.raw && typeof veh.raw === 'object' ? veh.raw : {};

  const priorityKeys = [
    'variantName',
    'variant',
    'trimName',
    'trim',
    'grade',
    'subModelName',
    'subModel',
    'modelConfigurationName',
    'vehicleModelConfigurationName',
    'configName',
    'edition',
    'seriesName',
    'modelName',
    'carModelName',
    'vehicleModelName',
    'desc',
    'description',
  ];

  for (const key of priorityKeys) {
    const val = raw[key];
    if (typeof val === 'string' && val.trim()) {
      strings.push(val);
    }
  }

  for (const blockKey of [
    'vehicleModelConfiguration',
    'modelConfiguration',
    'configuration',
    'config',
    'modelConfig',
  ]) {
    const block = raw[blockKey] ?? raw?.data?.[blockKey];
    if (Array.isArray(block)) {
      for (const item of block) {
        if (item && typeof item === 'object') {
          for (const field of ['itemName', 'itemValue', 'name', 'value', 'desc']) {
            if (typeof item[field] === 'string' && item[field].trim()) {
              strings.push(item[field]);
            }
          }
        }
      }
    } else if (typeof block === 'string' && block.trim()) {
      strings.push(block);
    }
  }

  if (typeof veh.model === 'string' && veh.model.trim()) {
    strings.push(veh.model);
  }
  if (typeof veh.name === 'string' && veh.name.trim()) {
    strings.push(veh.name);
  }

  return strings;
}

export function detectWindsorVariantFromSnapshot(
  snapshot?: Partial<Snapshot> | null
): WindsorVariantSpec | null {
  const candidates = collectCandidateVariantStrings(snapshot);
  for (const text of candidates) {
    const match = matchWindsorVariantFromText(text);
    if (match) return match;
  }
  return null;
}

function readRawS35Flag(raw: Record<string, any>): string | null {
  for (const blockKey of [
    'vehicleModelConfiguration',
    'modelConfiguration',
    'configuration',
    'config',
    'modelConfig',
    'modelConfigurationJsonStr',
  ]) {
    let block = raw[blockKey] ?? raw?.data?.[blockKey];
    if (typeof block === 'string') {
      try {
        block = JSON.parse(block);
      } catch {
        continue;
      }
    }
    if (Array.isArray(block)) {
      for (const item of block) {
        if (item && typeof item === 'object') {
          const code = String(item.itemCode ?? item.code ?? item.key ?? '').trim().toUpperCase();
          if (code === 'S35') {
            const v = item.itemValue ?? item.value ?? item.val;
            if (v !== undefined && v !== null) return String(v);
          }
        }
      }
    } else if (block && typeof block === 'object' && block.S35 !== undefined && block.S35 !== null) {
      return String(block.S35);
    }
  }
  return null;
}

export interface WindsorSunroofState {
  detectedVariant: WindsorVariantSpec | null;
  manualVariant: WindsorVariantSpec | null;
  activeVariant: WindsorVariantSpec | null;
  source: 'detected' | 'manual' | 'unknown';
  sunroofEnabled: boolean;
  showUnconfiguredWarning: boolean;
  serverSummary: string;
}

export function resolveWindsorSunroofState(
  snapshot?: Partial<Snapshot> | null,
  manualVariantId?: string | null
): WindsorSunroofState {
  const detectedVariant = detectWindsorVariantFromSnapshot(snapshot);
  const manualVariant = getWindsorVariantById(manualVariantId);
  const activeVariant = detectedVariant || manualVariant;
  const source: 'detected' | 'manual' | 'unknown' = detectedVariant
    ? 'detected'
    : manualVariant
    ? 'manual'
    : 'unknown';

  const sunroofEnabled = activeVariant ? activeVariant.hasSunroof : true;
  const showUnconfiguredWarning = activeVariant === null;

  const veh: any = snapshot?.vehicle;
  const raw: Record<string, any> =
    veh?.raw && typeof veh.raw === 'object' ? veh.raw : {};
  const series = String(raw.series || veh?.series || 'EQ100').trim() || 'EQ100';
  const rawModelName = String(raw.modelName || raw.variantName || raw.trim || veh?.model || '').trim();
  const s35 = readRawS35Flag(raw);
  const capsSunroof = snapshot?.capabilities?.sunroof;

  const parts: string[] = [`Series ${series}`];
  if (rawModelName) {
    parts.push(`model ${rawModelName}`);
  }
  if (s35 !== null) {
    parts.push(`S35=${s35}`);
  } else if (capsSunroof !== undefined) {
    parts.push(`sunroof capability=${capsSunroof ? '1' : '0'}`);
  } else {
    parts.push('no trim/sunroof code');
  }

  return {
    detectedVariant,
    manualVariant,
    activeVariant,
    source,
    sunroofEnabled,
    showUnconfiguredWarning,
    serverSummary: parts.join(' · '),
  };
}
