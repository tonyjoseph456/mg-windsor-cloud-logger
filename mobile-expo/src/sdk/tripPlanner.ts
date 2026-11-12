/**
 * EV Trip Planner & Physics Energy Engine
 *
 * Ported to TypeScript from Volta (https://github.com/irshadm/volta-android)
 * Original Author: Irshad Melethil (@irshadm) — https://irshadm.dev/volta/
 * License: Apache License 2.0
 *
 * Features ported from Volta:
 * - Terrain-aware physics EnergyModel (flat speed efficiency + potential energy m*g*dh climb & regen)
 * - Terrain ascent filter (20m hysteresis threshold to ignore DEM/bridge noise)
 * - Windsor EV DC Charging Curve interpolation & ChargeTime estimator
 * - Time-optimal Dijkstra stop planner (Fastest, Fewer Stops, Preferred Network) + Greedy fallback
 * - Charger Confidence scoring (1-5 dots), 15 km Backup Charger selection & Broken Charger blacklist
 * - Corridor town naming & Kerala/South India hub routing
 * - Hybrid Data Provider:
 *   1. Free / Zero-Key Mode (Nominatim + OSRM + Open-Meteo 90m SRTM DEM + OpenStreetMap Overpass + Curated South India DC Fast Charger Network)
 *   2. Google Maps Platform Mode (Places Autocomplete + Routes API v2 with Live Traffic + Google Elevation + Places Text Search Along Route with Live CCS2 Plug Availability)
 */

import { BACKEND_URL } from './googleSheets';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RoutePoint {
  position: LatLng;
  distanceM: number;
}

export interface ChargeCurvePoint {
  socPercent: number;
  powerKw: number;
}

export interface VehicleProfile {
  usableCapacityKwh: number;
  cityKmPerKwh: number;
  highwayKmPerKwh: number;
  massKg: number;
  driveEfficiency: number;
  regenEfficiency: number;
  dcCurve: ChargeCurvePoint[];
}

export const WINDSOR_38_DC_CURVE: ChargeCurvePoint[] = [
  { socPercent: 0, powerKw: 40.0 },
  { socPercent: 10, powerKw: 45.0 },
  { socPercent: 50, powerKw: 45.0 },
  { socPercent: 65, powerKw: 35.0 },
  { socPercent: 80, powerKw: 25.0 },
  { socPercent: 90, powerKw: 12.0 },
  { socPercent: 100, powerKw: 5.0 },
];

export const DEFAULT_WINDSOR_PROFILE: VehicleProfile = {
  usableCapacityKwh: 37.3,
  cityKmPerKwh: 8.5,
  highwayKmPerKwh: 6.8,
  massKg: 1650.0,
  driveEfficiency: 0.88,
  regenEfficiency: 0.6,
  dcCurve: WINDSOR_38_DC_CURVE,
};

export type ChargeStrategy = 'optimal' | 'fixed';

export interface TripSettings {
  minArrivalAtChargerPercent: number;
  minArrivalAtDestinationPercent: number;
  maxChargeTargetPercent: number;
  maxDetourKm: number;
  replanDeviationPercent: number;
  chargeStrategy?: ChargeStrategy;
}

export const DEFAULT_TRIP_SETTINGS: TripSettings = {
  minArrivalAtChargerPercent: 10,
  minArrivalAtDestinationPercent: 15,
  maxChargeTargetPercent: 80,
  maxDetourKm: 15,
  replanDeviationPercent: 5,
  chargeStrategy: 'optimal',
};

export type NetworkPreference = 'OFF' | 'PREFER' | 'ONLY';

export interface ChargerPreferences {
  networkPreference: NetworkPreference;
  preferredNetworks: string[];
  avoidedNetworks: string[];
}

export const KNOWN_CHARGER_NETWORKS = [
  'Zeon',
  'ChargeZone',
  'Statiq',
  'GOEC',
  'Tata Power',
  'chargeMOD',
  'Jio-bp',
  'Relux',
  'GLIDA',
  'MG eHub',
  'Iongrid',
  'KSEB',
  'BPCL',
  'Shell',
  'Ather',
];

export const DEFAULT_CHARGER_PREFS: ChargerPreferences = {
  networkPreference: 'PREFER',
  preferredNetworks: ['Zeon', 'ChargeZone', 'Statiq', 'GOEC', 'Tata Power', 'chargeMOD'],
  avoidedNetworks: [],
};

export function detectChargerNetwork(name: string): string | null {
  const clean = (name || '').replace(/\s+/g, '').toLowerCase();
  for (const net of KNOWN_CHARGER_NETWORKS) {
    if (clean.includes(net.replace(/\s+/g, '').toLowerCase())) {
      return net;
    }
  }
  return null;
}

// ============================================================================
// GEO & POLYLINE UTILITIES (Ported from Geo.kt)
// ============================================================================

const EARTH_RADIUS_M = 6_371_008.8;

export const Geo = {
  distanceM(a: LatLng, b: LatLng): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const h =
      sinLat * sinLat +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
    return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
  },

  decodePolyline(encoded: string): LatLng[] {
    const out: LatLng[] = [];
    let i = 0;
    let lat = 0;
    let lng = 0;
    while (i < encoded.length) {
      for (let axis = 0; axis < 2; axis++) {
        let shift = 0;
        let result = 0;
        let b: number;
        do {
          b = encoded.charCodeAt(i++) - 63;
          result |= (b & 0x1f) << shift;
          shift += 5;
        } while (b >= 0x20 && i < encoded.length + 1);
        const delta = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
        if (axis === 0) lat += delta;
        else lng += delta;
      }
      out.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }
    return out;
  },

  encodePolyline(points: LatLng[]): string {
    let out = '';
    let pLat = 0;
    let pLng = 0;
    const enc = (v: number) => {
      let x = v < 0 ? ~(v << 1) : v << 1;
      while (x >= 0x20) {
        out += String.fromCharCode((0x20 | (x & 0x1f)) + 63);
        x >>= 5;
      }
      out += String.fromCharCode(x + 63);
    };
    for (const p of points) {
      const lat = Math.round(p.lat * 1e5);
      const lng = Math.round(p.lng * 1e5);
      enc(lat - pLat);
      enc(lng - pLng);
      pLat = lat;
      pLng = lng;
    }
    return out;
  },

  resample(path: LatLng[], stepM: number): RoutePoint[] {
    if (stepM <= 0 || path.length === 0) return [];
    const out: RoutePoint[] = [{ position: path[0], distanceM: 0 }];
    let travelled = 0;
    let nextMark = stepM;
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1];
      const b = path[k];
      const seg = Geo.distanceM(a, b);
      if (seg === 0) continue;
      while (travelled + seg >= nextMark) {
        const t = (nextMark - travelled) / seg;
        out.push({
          position: {
            lat: a.lat + (b.lat - a.lat) * t,
            lng: a.lng + (b.lng - a.lng) * t,
          },
          distanceM: nextMark,
        });
        nextMark += stepM;
      }
      travelled += seg;
    }
    if (travelled - out[out.length - 1].distanceM > 1.0) {
      out.push({ position: path[path.length - 1], distanceM: travelled });
    }
    return out;
  },
};

// ============================================================================
// TERRAIN & PHYSICS ENERGY MODEL (Ported from Terrain.kt & EnergyModel.kt)
// ============================================================================

export interface ProfilePoint {
  distanceM: number;
  elevationM: number;
  speedKmh: number;
}

export interface SocPoint {
  distanceM: number;
  socPercent: number;
  elevationM: number;
}

export interface EnergyBreakdown {
  flatKwh: number;
  climbKwh: number;
  regenKwh: number;
  totalKwh: number;
  terrainKwh: number;
}

export const Terrain = {
  /**
   * Total climbing along [elevations], ignoring wiggles smaller than [thresholdM] (20m)
   * so bridges, flyovers and DEM noise don't count as hills.
   */
  ascentM(elevations: number[], thresholdM = 20.0): number {
    if (elevations.length === 0) return 0;
    let total = 0;
    let low = elevations[0];
    let high = low;
    let rising = false;
    for (const e of elevations) {
      if (rising) {
        if (e > high) {
          high = e;
        } else if (high - e >= thresholdM) {
          total += high - low;
          low = e;
          high = e;
          rising = false;
        }
      } else {
        if (e < low) {
          low = e;
          high = e;
        } else if (e - low >= thresholdM) {
          high = e;
          rising = true;
        }
      }
    }
    if (rising) total += high - low;
    return total;
  },
};

const CITY_KMH = 40.0;
const HIGHWAY_KMH = 80.0;
const NOISE_M = 2.0;
const GRAVITY = 9.81;
const JOULES_PER_KWH = 3.6e6;

export class EnergyModel {
  constructor(private readonly vehicle: VehicleProfile) {}

  kmPerKwh(speedKmh: number): number {
    if (speedKmh <= CITY_KMH) return this.vehicle.cityKmPerKwh;
    if (speedKmh >= HIGHWAY_KMH) return this.vehicle.highwayKmPerKwh;
    const t = (speedKmh - CITY_KMH) / (HIGHWAY_KMH - CITY_KMH);
    return (
      this.vehicle.cityKmPerKwh +
      (this.vehicle.highwayKmPerKwh - this.vehicle.cityKmPerKwh) * t
    );
  }

  private potentialKwh(dhM: number): number {
    return (this.vehicle.massKg * GRAVITY * dhM) / JOULES_PER_KWH;
  }

  breakdown(points: ProfilePoint[]): EnergyBreakdown {
    let flat = 0;
    let climb = 0;
    let regen = 0;
    let pendingDh = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const avgSpeed = (a.speedKmh + b.speedKmh) / 2;
      flat += (b.distanceM - a.distanceM) / 1000.0 / this.kmPerKwh(avgSpeed);
      pendingDh += b.elevationM - a.elevationM;
      if (Math.abs(pendingDh) >= NOISE_M) {
        if (pendingDh > 0) {
          climb += this.potentialKwh(pendingDh) / this.vehicle.driveEfficiency;
        } else {
          regen += this.potentialKwh(-pendingDh) * this.vehicle.regenEfficiency;
        }
        pendingDh = 0;
      }
    }
    const totalKwh = flat + climb - regen;
    const terrainKwh = climb - regen;
    return { flatKwh: flat, climbKwh: climb, regenKwh: regen, totalKwh, terrainKwh };
  }

  simulate(points: ProfilePoint[], startSoc: number, capSoc = 100.0): SocPoint[] {
    if (points.length === 0) return [];
    const perPercent = this.vehicle.usableCapacityKwh / 100.0;
    let soc = startSoc;
    let pendingDh = 0;
    const out: SocPoint[] = [
      {
        distanceM: points[0].distanceM,
        socPercent: soc,
        elevationM: points[0].elevationM,
      },
    ];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const avgSpeed = (a.speedKmh + b.speedKmh) / 2;
      let kwh = (b.distanceM - a.distanceM) / 1000.0 / this.kmPerKwh(avgSpeed);
      pendingDh += b.elevationM - a.elevationM;
      if (Math.abs(pendingDh) >= NOISE_M) {
        if (pendingDh > 0) {
          kwh += this.potentialKwh(pendingDh) / this.vehicle.driveEfficiency;
        } else {
          kwh -= this.potentialKwh(-pendingDh) * this.vehicle.regenEfficiency;
        }
        pendingDh = 0;
      }
      soc = Math.min(capSoc, soc - kwh / perPercent);
      out.push({
        distanceM: b.distanceM,
        socPercent: soc,
        elevationM: b.elevationM,
      });
    }
    return out;
  }
}

// ============================================================================
// CHARGER, CHARGE TIME & OPTIMAL DIJKSTRA PLANNER (Ported from TripPlanner.kt & OptimalPlanner.kt)
// ============================================================================

export interface PlannedCharger {
  id: string;
  name: string;
  position: LatLng;
  maxKw: number;
  alongRouteM: number;
  detourM: number;
  connectorCount?: number | null;
  availableCount?: number | null;
  network?: string | null;
  address?: string | null;
  open24h?: boolean | null;
  amenities?: string[];
}

export type MealType = 'Breakfast' | 'Lunch' | 'Dinner';

export interface PlannedStop {
  charger: PlannedCharger;
  arriveSoc: number;
  departSoc: number;
  chargeMinutes: number;
  meal?: MealType | null;
  mealPlace?: string | null;
  backupCharger?: PlannedCharger | null;
  backupDistanceKm?: number | null;
  nextCharger?: PlannedCharger | null;
  nextDistanceKm?: number | null;
  nextUnassistedSoc?: number | null;
  maxUnassistedRangeKm?: number | null;
  confidenceDots?: number;
  confidenceLabel?: string;
  confidenceReasons?: string[];
  chargeType?: 'DC' | 'AC';
  dcStopIndex?: number;
  isMandatoryAcStop?: boolean;
  mandatoryAcReason?: string;
}

export type PlanGoal = 'Fastest' | 'FewerStops' | 'Preferred';

export interface TripPlan {
  reachable: boolean;
  unreachableReason?: string;
  strandedAtKm?: number;
  stops: PlannedStop[];
  arrivalSoc: number;
  socTrace: SocPoint[];
  distanceM: number;
  driveMinutes: number;
  chargeMinutes: number;
  energy: EnergyBreakdown;
  usableCapacityKwh: number;
  terrainPercent: number;
  dcStopCount?: number;
  mandatoryAcStopCount?: number;
}

export interface PlanOption {
  goal: PlanGoal;
  label: string;
  plan: TripPlan;
}

export const ChargeTime = {
  curveKw(curve: ChargeCurvePoint[], soc: number): number {
    if (curve.length === 0) return 30;
    if (soc <= curve[0].socPercent) return curve[0].powerKw;
    if (soc >= curve[curve.length - 1].socPercent) return curve[curve.length - 1].powerKw;
    const hi = curve.findIndex((p) => p.socPercent >= soc);
    if (hi <= 0) return curve[0].powerKw;
    const a = curve[hi - 1];
    const b = curve[hi];
    const t = (soc - a.socPercent) / Math.max(1e-6, b.socPercent - a.socPercent);
    return a.powerKw + (b.powerKw - a.powerKw) * t;
  },

  minutes(
    vehicle: VehicleProfile,
    fromSoc: number,
    toSoc: number,
    chargerKw: number
  ): number {
    if (toSoc <= fromSoc) return 0;
    const step = 0.5;
    let soc = fromSoc;
    let hours = 0;
    const kwhPerStep = (vehicle.usableCapacityKwh * step) / 100.0;
    while (soc < toSoc) {
      const kw = Math.max(
        1.0,
        Math.min(ChargeTime.curveKw(vehicle.dcCurve, soc + step / 2), chargerKw)
      );
      hours += kwhPerStep / kw;
      soc += step;
    }
    return hours * 60.0;
  },
};

// ============================================================================
// CHARGER CONFIDENCE & BACKUP SELECTION (Ported from ChargerConfidence.kt)
// ============================================================================

export type ChargeVerdict = 'Worked' | 'Waited' | 'Broken';

export interface ChargerFeedbackEntry {
  verdict: ChargeVerdict;
  at: number;
}

const DAY_MS = 86_400_000;

export function isChargerRecentlyBroken(
  history: ChargerFeedbackEntry[],
  now = Date.now()
): boolean {
  if (!history || history.length === 0) return false;
  const last = history[history.length - 1];
  return last.verdict === 'Broken' && now - last.at < 14 * DAY_MS;
}

export function evaluateChargerConfidence(
  c: PlannedCharger,
  allChargers: PlannedCharger[],
  history: ChargerFeedbackEntry[] = [],
  now = Date.now()
): {
  dots: number;
  label: string;
  reasons: string[];
  backup: PlannedCharger | null;
  backupKm: number | null;
  nextCharger?: PlannedCharger | null;
  nextKm?: number | null;
} {
  let score = 3.0;
  const why: string[] = [];

  if (c.availableCount != null) {
    if (c.availableCount === 0) {
      score -= 1.0;
      why.push('0 plugs free right now');
    } else {
      score += 0.5;
      why.push(`${c.availableCount}${c.connectorCount ? `/${c.connectorCount}` : ''} CCS2 free`);
    }
  }
  if (c.open24h === true) {
    score += 0.5;
    why.push('Open 24h');
  }
  if (c.maxKw >= 50) {
    score += 0.5;
    why.push(`${c.maxKw} kW high-speed DC`);
  }
  const worked = history.filter((h) => h.verdict === 'Worked').length;
  const waited = history.filter(
    (h) => h.verdict === 'Waited' && now - h.at < 60 * DAY_MS
  ).length;
  const broken = [...history].reverse().find((h) => h.verdict === 'Broken');

  if (worked > 0) {
    score += Math.min(1.0, worked * 0.5);
    why.push(`Worked for you ${worked === 1 ? 'once' : `${worked} times`}`);
  }
  if (waited > 0) {
    score -= 0.5;
    why.push(`Waited here ${waited === 1 ? 'once' : `${waited} times`}`);
  }
  if (
    broken &&
    now - broken.at < 30 * DAY_MS &&
    history[history.length - 1]?.verdict === 'Broken'
  ) {
    score -= 2.0;
    const days = Math.floor((now - broken.at) / DAY_MS);
    why.push(`Marked broken ${days === 0 ? 'today' : `${days}d ago`}`);
  }

  // Backup is the nearest other charger within 25 km along the route (before or after)
  const candidates = allChargers.filter(
    (other) =>
      other.id !== c.id && Math.abs(other.alongRouteM - c.alongRouteM) <= 25_000
  );
  candidates.sort(
    (a, b) =>
      Math.abs(a.alongRouteM - c.alongRouteM) -
      Math.abs(b.alongRouteM - c.alongRouteM)
  );
  const backup = candidates[0] || null;
  const backupKm = backup
    ? Number(((backup.alongRouteM - c.alongRouteM) / 1000).toFixed(1))
    : null;

  // Next charger ahead on the route (regardless of distance)
  const ahead = allChargers
    .filter((other) => other.id !== c.id && other.alongRouteM > c.alongRouteM)
    .sort((a, b) => a.alongRouteM - b.alongRouteM);
  const nextCharger = ahead[0] || null;
  const nextKm = nextCharger
    ? Number(((nextCharger.alongRouteM - c.alongRouteM) / 1000).toFixed(1))
    : null;

  const dots = Math.max(1, Math.min(5, Math.round(score)));
  const label = dots >= 4 ? 'Reliable' : dots === 3 ? 'Good' : 'Unsure';

  return { dots, label, reasons: why, backup, backupKm, nextCharger, nextKm };
}

// ============================================================================
// OPTIMAL DIJKSTRA & GREEDY STOP PLANNER (Ported from OptimalPlanner.kt & TripPlanner.kt)
// ============================================================================

const STOP_OVERHEAD_MIN = 12.0;
const MIN_GAIN_SOC = 10.0;
const MAX_ARRIVE_SOC = 75.0;
const DETOUR_KMH = 35.0;
const PREFERRED_BONUS_MIN = 4.0;
const FINISH_MARGIN_SOC = 3.0;

export class VoltaTripPlanner {
  private readonly model: EnergyModel;

  constructor(
    private readonly vehicle: VehicleProfile = DEFAULT_WINDSOR_PROFILE,
    private readonly settings: TripSettings = DEFAULT_TRIP_SETTINGS,
    private readonly prefs: ChargerPreferences = DEFAULT_CHARGER_PREFS,
    private readonly feedbackMap: Record<string, ChargerFeedbackEntry[]> = {}
  ) {
    this.model = new EnergyModel(vehicle);
  }

  options(
    points: ProfilePoint[],
    startSoc: number,
    chargers: PlannedCharger[],
    driveMinutes: number
  ): PlanOption[] {
    if (points.length < 2) return [];
    const allowed = chargers.filter(
      (c) =>
        (!c.network || !this.prefs.avoidedNetworks.includes(c.network)) &&
        !isChargerRecentlyBroken(this.feedbackMap[c.id] || [])
    );

    const out: PlanOption[] = [];
    const addOption = (goal: PlanGoal, label: string, plan: TripPlan | null) => {
      if (!plan || !plan.reachable) return;
      const key = plan.stops
        .map((s) => `${s.charger.id}:${Math.round(s.departSoc)}`)
        .join('|');
      const exists = out.some(
        (o) =>
          o.plan.stops
            .map((s) => `${s.charger.id}:${Math.round(s.departSoc)}`)
            .join('|') === key
      );
      if (!exists) {
        out.push({ goal, label, plan: this.enrichStopsWithConfidence(plan, allowed) });
      }
    };

    const usable =
      this.prefs.networkPreference === 'ONLY' &&
      this.prefs.preferredNetworks.length > 0
        ? allowed.filter(
            (c) => c.network && this.prefs.preferredNetworks.includes(c.network)
          )
        : allowed;

    addOption(
      'Fastest',
      '⚡ Fastest Total Time',
      this.dijkstraSearch(points, startSoc, usable, driveMinutes, 0.0)
    );
    addOption(
      'FewerStops',
      '🛑 Fewer Charging Stops',
      this.dijkstraSearch(points, startSoc, usable, driveMinutes, 1000.0)
    );
    if (
      this.prefs.networkPreference === 'PREFER' &&
      this.prefs.preferredNetworks.length > 0
    ) {
      const prefOnly = allowed.filter(
        (c) => c.network && this.prefs.preferredNetworks.includes(c.network)
      );
      if (prefOnly.length > 0) {
        addOption(
          'Preferred',
          '⭐ Preferred Networks',
          this.dijkstraSearch(points, startSoc, prefOnly, driveMinutes, 0.0)
        );
      }
    }

    if (out.length === 0) {
      const fallback = this.greedyFallback(points, startSoc, allowed, driveMinutes);
      return [
        {
          goal: 'Fastest',
          label: fallback.reachable ? '⚡ Recommended Plan' : '⚠️ Range Warning',
          plan: this.enrichStopsWithConfidence(fallback, allowed),
        },
      ];
    }
    return out;
  }

  private enrichStopsWithConfidence(
    plan: TripPlan,
    allChargers: PlannedCharger[]
  ): TripPlan {
    let dcCount = 0;
    let acCount = 0;
    const stops = plan.stops.map((s) => {
      const conf = evaluateChargerConfidence(
        s.charger,
        allChargers,
        this.feedbackMap[s.charger.id] || []
      );
      const nextUnassistedSoc =
        conf.nextCharger && conf.nextKm != null
          ? Number(
              (
                s.arriveSoc -
                (conf.nextKm / this.vehicle.highwayKmPerKwh / this.vehicle.usableCapacityKwh) *
                  100
              ).toFixed(1)
            )
          : null;
      const maxUnassistedRangeKm = Number(
        (
          (s.arriveSoc / 100) *
          this.vehicle.usableCapacityKwh *
          this.vehicle.highwayKmPerKwh
        ).toFixed(0)
      );

      // MG Windsor EV BMS 4-DC Continuous Fast Charging Rule:
      // After 4 consecutive DC fast charges, a mandatory slow AC charge to 100% is required for LFP cell balancing.
      const isFastCharger = (s.charger.maxKw || 30) >= 20;
      let chargeType: 'DC' | 'AC' = isFastCharger ? 'DC' : 'AC';
      let dcStopIndex: number | undefined;
      let isMandatoryAcStop = false;
      let mandatoryAcReason: string | undefined;

      if (isFastCharger) {
        dcCount++;
        if (dcCount > 4) {
          chargeType = 'AC';
          isMandatoryAcStop = true;
          acCount++;
          mandatoryAcReason =
            'MG Windsor EV BMS Rule: Mandatory slow AC charge to 100% for LFP cell balancing after 4 consecutive DC charges.';
        } else {
          dcStopIndex = dcCount;
        }
      } else {
        acCount++;
      }

      const departSoc = isMandatoryAcStop ? 100 : s.departSoc;
      const chargeMinutes = isMandatoryAcStop
        ? Math.round(
            (((100 - s.arriveSoc) / 100.0) * this.vehicle.usableCapacityKwh / 7.4) * 60.0
          )
        : s.chargeMinutes;

      return {
        ...s,
        departSoc,
        chargeMinutes,
        chargeType,
        dcStopIndex,
        isMandatoryAcStop,
        mandatoryAcReason,
        backupCharger: conf.backup,
        backupDistanceKm: conf.backupKm,
        nextCharger: conf.nextCharger,
        nextDistanceKm: conf.nextKm,
        nextUnassistedSoc,
        maxUnassistedRangeKm,
        confidenceDots: conf.dots,
        confidenceLabel: conf.label,
        confidenceReasons: conf.reasons,
      };
    });

    const totalChargeMinutes = stops.reduce((acc, s) => acc + s.chargeMinutes, 0);

    return {
      ...plan,
      stops,
      chargeMinutes: totalChargeMinutes,
      dcStopCount: dcCount > 4 ? 4 : dcCount,
      mandatoryAcStopCount: acCount,
    };
  }

  private cumulativeKwh(points: ProfilePoint[]): number[] {
    const sim = this.model.simulate(points, 1000.0, 10000.0);
    const cap = this.vehicle.usableCapacityKwh;
    return sim.map((pt) => ((1000.0 - pt.socPercent) / 100.0) * cap);
  }

  private dijkstraSearch(
    points: ProfilePoint[],
    startSoc: number,
    chargers: PlannedCharger[],
    driveMinutes: number,
    stopWeight: number
  ): TripPlan | null {
    const total = points[points.length - 1].distanceM;
    const cap = this.vehicle.usableCapacityKwh;
    const minCharger = this.settings.minArrivalAtChargerPercent;
    const minDest = this.settings.minArrivalAtDestinationPercent;
    const maxTarget = this.settings.maxChargeTargetPercent;
    const cum = this.cumulativeKwh(points);

    const maxDetourAllowedM = Math.max(this.settings.maxDetourKm * 2000.0, 30000.0);
    const list = chargers
      .filter(
        (c) =>
          c.alongRouteM > 1.0 &&
          c.alongRouteM < total &&
          c.detourM <= maxDetourAllowedM
      )
      .sort((a, b) => a.alongRouteM - b.alongRouteM);

    const idx = list.map((c) => {
      const found = points.findIndex((p) => p.distanceM >= c.alongRouteM);
      return Math.max(1, found < 0 ? points.length - 1 : found);
    });

    const drop = (a: number, b: number) => ((cum[b] - cum[a]) / cap) * 100.0;
    const halfDetour = (j: number) =>
      ((list[j].detourM / 2 / 1000.0 / this.vehicle.cityKmPerKwh) / cap) * 100.0;
    const detourMin = (j: number) =>
      ((list[j].detourM / 1000.0) / DETOUR_KMH) * 60.0;
    const bonus = (j: number) =>
      this.prefs.networkPreference === 'PREFER' &&
      list[j].network &&
      this.prefs.preferredNetworks.includes(list[j].network!)
        ? PREFERRED_BONUS_MIN
        : 0.0;

    const end = points.length - 1;

    // Direct drive possible without charging?
    if (startSoc - drop(0, end) >= minDest) {
      return this.buildPlan(points, startSoc, [], driveMinutes);
    }

    const best = new Map<string, number>();
    const prev = new Map<
      string,
      { prevKey: string | null; chargerIdx: number; departSoc: number; arriveSoc: number }
    >();
    const queue: {
      key: string;
      chargerIdx: number;
      departSoc: number;
      cost: number;
      stops: number;
    }[] = [];

    let bestEndKey: string | null = null;
    let bestEndCost = Number.MAX_VALUE;

    const departures = (j: number, arrive: number, toEnd: number): number[] => {
      if (this.settings.chargeStrategy === 'fixed') {
        const target = Math.max(arrive + MIN_GAIN_SOC, Math.min(100, maxTarget));
        return [target];
      }
      const set = new Set<number>();
      let d = Math.ceil((arrive + MIN_GAIN_SOC) / 5) * 5;
      while (d <= maxTarget + 1e-9) {
        set.add(d);
        d += 5;
      }
      const enough = Math.ceil(toEnd + minDest + halfDetour(j) + FINISH_MARGIN_SOC);
      if (enough >= arrive + MIN_GAIN_SOC && enough <= maxTarget) {
        set.add(enough);
      }
      return Array.from(set).sort((a, b) => a - b);
    };

    const relax = (
      fromKey: string | null,
      fromChargerIdx: number,
      fromCost: number,
      fromStops: number,
      depart: number,
      fromPointIdx: number,
      fromHalfDetour: number
    ) => {
      const atEnd = depart - fromHalfDetour - drop(fromPointIdx, end);
      if (fromKey !== null && atEnd >= minDest && fromCost < bestEndCost) {
        bestEndCost = fromCost;
        bestEndKey = fromKey;
      }

      for (let k = 0; k < list.length; k++) {
        if (idx[k] <= fromPointIdx || (fromKey !== null && k <= fromChargerIdx)) continue;
        const arrive =
          depart - fromHalfDetour - drop(fromPointIdx, idx[k]) - halfDetour(k);
        if (arrive < minCharger) {
          if (drop(fromPointIdx, idx[k]) > 100) break;
          else continue;
        }
        if (arrive > MAX_ARRIVE_SOC) continue;

        const deps = departures(k, arrive, drop(idx[k], end));
        for (const dep of deps) {
          // 1. Premature stop penalty: heavily penalize stopping when vehicle still has high SoC above minCharger.
          // This stretches each leg to arrive near minArrivalAtChargerPercent, maximizing range per DC charge.
          const surplusSoc = Math.max(0, arrive - (minCharger + 6));
          const prematurePenalty = Math.pow(surplusSoc, 1.6) * 3.5;

          // 2. Windsor EV BMS 4-DC Continuous Fast Charging Rule penalty:
          // Discourage unnecessary extra stops that exhaust the 4 consecutive DC charging slots.
          const extraStopPenalty = fromStops >= 3 ? 150.0 : 0.0;

          const cost =
            fromCost +
            stopWeight +
            STOP_OVERHEAD_MIN +
            detourMin(k) +
            ChargeTime.minutes(this.vehicle, arrive, dep, list[k].maxKw) +
            prematurePenalty +
            extraStopPenalty -
            bonus(k);
          const nodeKey = `${k}:${Math.round(dep * 10)}`;
          const prevBest = best.get(nodeKey) ?? Number.MAX_VALUE;
          if (cost < prevBest) {
            best.set(nodeKey, cost);
            prev.set(nodeKey, {
              prevKey: fromKey,
              chargerIdx: k,
              departSoc: dep,
              arriveSoc: arrive,
            });
            queue.push({
              key: nodeKey,
              chargerIdx: k,
              departSoc: dep,
              cost,
              stops: fromStops + 1,
            });
          }
        }
      }
    };

    relax(null, -1, 0.0, 0, startSoc, 0, 0.0);

    while (queue.length > 0) {
      queue.sort((a, b) => a.cost - b.cost);
      const e = queue.shift()!;
      const curBest = best.get(e.key) ?? Number.MAX_VALUE;
      if (e.cost > curBest + 1e-9 || e.cost >= bestEndCost) continue;
      if (e.stops >= 8) continue;
      relax(
        e.key,
        e.chargerIdx,
        e.cost,
        e.stops,
        e.departSoc,
        idx[e.chargerIdx],
        halfDetour(e.chargerIdx)
      );
    }

    if (!bestEndKey) return null;

    const chain: PlannedStop[] = [];
    let curKey: string | null = bestEndKey;
    while (curKey !== null) {
      const entry = prev.get(curKey);
      if (!entry) break;
      const c = list[entry.chargerIdx];
      chain.push({
        charger: c,
        arriveSoc: Number(entry.arriveSoc.toFixed(1)),
        departSoc: Number(entry.departSoc.toFixed(1)),
        chargeMinutes: Math.round(
          ChargeTime.minutes(this.vehicle, entry.arriveSoc, entry.departSoc, c.maxKw)
        ),
      });
      curKey = entry.prevKey;
    }

    return this.buildPlan(points, startSoc, chain.reverse(), driveMinutes);
  }

  private buildPlan(
    points: ProfilePoint[],
    startSoc: number,
    stops: PlannedStop[],
    driveMinutes: number
  ): TripPlan {
    const trace: SocPoint[] = [];
    let from = 0;
    let soc = startSoc;
    for (const s of stops) {
      const foundIdx = points.findIndex((p) => p.distanceM >= s.charger.alongRouteM);
      const i = Math.max(from + 1, foundIdx < 0 ? points.length - 1 : foundIdx);
      const leg = this.model.simulate(points.slice(from, i + 1), soc);
      trace.push(...leg.slice(0, leg.length - 1));
      trace.push({
        distanceM: points[i].distanceM,
        socPercent: s.arriveSoc,
        elevationM: points[i].elevationM,
      });
      from = i;
      soc = s.departSoc;
    }
    const lastLeg = this.model.simulate(points.slice(from), soc);
    trace.push(...lastLeg);

    const detourMin = stops.reduce(
      (acc, s) => acc + ((s.charger.detourM / 1000.0) / DETOUR_KMH) * 60.0,
      0
    );
    const chargeMinutes = stops.reduce((acc, s) => acc + s.chargeMinutes, 0);
    const energy = this.model.breakdown(points);
    const arrivalSoc = Number(
      (lastLeg[lastLeg.length - 1]?.socPercent ?? startSoc).toFixed(1)
    );

    return {
      reachable: true,
      stops,
      arrivalSoc,
      socTrace: trace,
      distanceM: points[points.length - 1].distanceM,
      driveMinutes: Math.round(driveMinutes + detourMin),
      chargeMinutes: Math.round(chargeMinutes),
      energy,
      usableCapacityKwh: this.vehicle.usableCapacityKwh,
      terrainPercent: Number(
        ((energy.terrainKwh / this.vehicle.usableCapacityKwh) * 100.0).toFixed(1)
      ),
    };
  }

  private greedyFallback(
    points: ProfilePoint[],
    startSoc: number,
    chargers: PlannedCharger[],
    driveMinutes: number
  ): TripPlan {
    const total = points[points.length - 1].distanceM;
    const minCharger = this.settings.minArrivalAtChargerPercent;
    const minDest = this.settings.minArrivalAtDestinationPercent;
    const maxTarget = this.settings.maxChargeTargetPercent;
    const maxDetourAllowedM = Math.max(this.settings.maxDetourKm * 2000.0, 30000.0);
    const candidates = chargers
      .filter(
        (c) =>
          c.alongRouteM > 1.0 &&
          c.alongRouteM < total &&
          c.detourM <= maxDetourAllowedM
      )
      .sort((a, b) => a.alongRouteM - b.alongRouteM);

    const trace: SocPoint[] = [];
    const stops: PlannedStop[] = [];
    let fromIndex = 0;
    let soc = startSoc;

    const arrivalAt = (sim: SocPoint[], c: PlannedCharger): number => {
      const atExit =
        [...sim].reverse().find((p) => p.distanceM <= c.alongRouteM)?.socPercent ??
        sim[0].socPercent;
      const detourKwh = c.detourM / 2 / 1000.0 / this.vehicle.cityKmPerKwh;
      return atExit - (detourKwh / this.vehicle.usableCapacityKwh) * 100.0;
    };

    while (stops.length <= 15) {
      const leg = points.slice(fromIndex);
      const sim = this.model.simulate(leg, soc);
      const arrival = sim[sim.length - 1].socPercent;
      if (arrival >= minDest) {
        trace.push(...sim);
        const energy = this.model.breakdown(points);
        return {
          reachable: true,
          stops,
          arrivalSoc: Number(arrival.toFixed(1)),
          socTrace: trace,
          distanceM: total,
          driveMinutes: Math.round(driveMinutes),
          chargeMinutes: Math.round(
            stops.reduce((acc, s) => acc + s.chargeMinutes, 0)
          ),
          energy,
          usableCapacityKwh: this.vehicle.usableCapacityKwh,
          terrainPercent: Number(
            ((energy.terrainKwh / this.vehicle.usableCapacityKwh) * 100.0).toFixed(1)
          ),
        };
      }

      const limitPt = sim.find((p) => p.socPercent < minCharger);
      const limitM = limitPt ? limitPt.distanceM : total;
      const reachable = candidates.filter(
        (c) =>
          c.alongRouteM > sim[0].distanceM + 500 &&
          c.alongRouteM <= limitM &&
          arrivalAt(sim, c) >= minCharger
      );

      const pick = reachable.length > 0 ? reachable[reachable.length - 1] : null;
      if (!pick) {
        trace.push(...sim.filter((p) => p.distanceM <= limitM));
        const energy = this.model.breakdown(points);
        return {
          reachable: false,
          strandedAtKm: Number((limitM / 1000).toFixed(1)),
          unreachableReason: `No reachable DC charger before battery drops to ${minCharger}% (around ${(
            limitM / 1000
          ).toFixed(0)} km). Try increasing starting SoC or Max Detour km.`,
          stops,
          arrivalSoc: Number(arrival.toFixed(1)),
          socTrace: trace,
          distanceM: total,
          driveMinutes: Math.round(driveMinutes),
          chargeMinutes: Math.round(
            stops.reduce((acc, s) => acc + s.chargeMinutes, 0)
          ),
          energy,
          usableCapacityKwh: this.vehicle.usableCapacityKwh,
          terrainPercent: Number(
            ((energy.terrainKwh / this.vehicle.usableCapacityKwh) * 100.0).toFixed(1)
          ),
        };
      }

      const arrive = arrivalAt(sim, pick);
      const foundIdx = points.findIndex((p) => p.distanceM >= pick.alongRouteM);
      const idx = Math.max(fromIndex + 1, foundIdx < 0 ? points.length - 1 : foundIdx);
      const remSim = this.model.simulate(points.slice(idx), arrive, 1000.0);
      const dropToEnd = arrive - remSim[remSim.length - 1].socPercent;
      const needToFinish = dropToEnd + minDest + FINISH_MARGIN_SOC;
      const roundUp5 = (x: number) => Math.ceil(x / 5.0) * 5.0;
      const depart = this.settings.chargeStrategy === 'fixed'
        ? Math.max(arrive + 5.0, Math.min(100.0, maxTarget))
        : Math.min(
            100.0,
            Math.min(maxTarget, Math.max(arrive + 10.0, roundUp5(needToFinish)))
          );

      stops.push({
        charger: pick,
        arriveSoc: Number(arrive.toFixed(1)),
        departSoc: Number(depart.toFixed(1)),
        chargeMinutes: Math.round(
          ChargeTime.minutes(this.vehicle, arrive, depart, pick.maxKw)
        ),
      });
      trace.push(...sim.filter((p) => p.distanceM < pick.alongRouteM));
      trace.push({
        distanceM: points[idx].distanceM,
        socPercent: Number(arrive.toFixed(1)),
        elevationM: points[idx].elevationM,
      });
      soc = depart;
      fromIndex = idx;
    }

    const energy = this.model.breakdown(points);
    return {
      reachable: false,
      unreachableReason: 'Trip requires too many stops to converge.',
      stops,
      arrivalSoc: 0,
      socTrace: trace,
      distanceM: total,
      driveMinutes: Math.round(driveMinutes),
      chargeMinutes: 0,
      energy,
      usableCapacityKwh: this.vehicle.usableCapacityKwh,
      terrainPercent: 0,
    };
  }
}

// ============================================================================
// CORRIDORS & CURATED SOUTH INDIA DC FAST CHARGER DATABASE (Ported from Corridors.kt + Real Highway Hubs)
// ============================================================================

interface Town {
  name: string;
  at: LatLng;
  city?: boolean;
  hub?: boolean;
}

const CORRIDOR_TOWNS: Town[] = [
  { name: 'Thiruvananthapuram', at: { lat: 8.5241, lng: 76.9366 }, city: true },
  { name: 'Attingal', at: { lat: 8.6964, lng: 76.8155 } },
  { name: 'Kollam', at: { lat: 8.8932, lng: 76.6141 }, city: true },
  { name: 'Kottarakkara', at: { lat: 9.0005, lng: 76.7735 } },
  { name: 'Punalur', at: { lat: 9.0168, lng: 76.9257 }, hub: true },
  { name: 'Adoor', at: { lat: 9.153, lng: 76.7356 } },
  { name: 'Pathanamthitta', at: { lat: 9.2648, lng: 76.787 } },
  { name: 'Kayamkulam', at: { lat: 9.1748, lng: 76.5013 } },
  { name: 'Chengannur', at: { lat: 9.3182, lng: 76.6114 } },
  { name: 'Thiruvalla', at: { lat: 9.3835, lng: 76.5741 } },
  { name: 'Changanassery', at: { lat: 9.4446, lng: 76.541 } },
  { name: 'Alappuzha', at: { lat: 9.4981, lng: 76.3388 }, city: true, hub: true },
  { name: 'Kottayam', at: { lat: 9.5916, lng: 76.5222 }, city: true, hub: true },
  { name: 'Cherthala', at: { lat: 9.6845, lng: 76.336 } },
  { name: 'Ettumanoor', at: { lat: 9.6705, lng: 76.5602 } },
  { name: 'Pala', at: { lat: 9.7139, lng: 76.6831 } },
  { name: 'Thodupuzha', at: { lat: 9.8959, lng: 76.7184 }, hub: true },
  { name: 'Kochi', at: { lat: 10.0261, lng: 76.3125 }, city: true },
  { name: 'Muvattupuzha', at: { lat: 9.9894, lng: 76.579 } },
  { name: 'Kothamangalam', at: { lat: 10.0602, lng: 76.6351 } },
  { name: 'Perumbavoor', at: { lat: 10.1155, lng: 76.4769 } },
  { name: 'Aluva', at: { lat: 10.1004, lng: 76.357 } },
  { name: 'Angamaly', at: { lat: 10.196, lng: 76.386 }, city: true },
  { name: 'Chalakudy', at: { lat: 10.307, lng: 76.334 } },
  { name: 'Thrissur', at: { lat: 10.5276, lng: 76.2144 }, city: true },
  { name: 'Guruvayur', at: { lat: 10.5946, lng: 76.04 } },
  { name: 'Palakkad', at: { lat: 10.7867, lng: 76.6548 }, city: true, hub: true },
  { name: 'Kuttippuram', at: { lat: 10.844, lng: 76.031 } },
  { name: 'Malappuram', at: { lat: 11.051, lng: 76.0711 }, city: true },
  { name: 'Kozhikode', at: { lat: 11.2588, lng: 75.7804 }, city: true },
  { name: 'Wayanad (Kalpetta)', at: { lat: 11.6103, lng: 76.0828 } },
  { name: 'Kannur', at: { lat: 11.8745, lng: 75.3704 }, city: true },
  { name: 'Kasaragod', at: { lat: 12.4996, lng: 74.9869 }, city: true },
  { name: 'Munnar', at: { lat: 10.0889, lng: 77.0595 }, city: true },
  { name: 'Adimali', at: { lat: 10.01, lng: 76.95 } },
  { name: 'Kumily (Thekkady)', at: { lat: 9.604, lng: 77.164 } },
  { name: 'Nagercoil', at: { lat: 8.1833, lng: 77.4119 }, city: true },
  { name: 'Madurai', at: { lat: 9.9252, lng: 78.1198 }, city: true },
  { name: 'Coimbatore', at: { lat: 11.0168, lng: 76.9558 }, city: true, hub: true },
  { name: 'Salem', at: { lat: 11.6643, lng: 78.146 }, city: true },
  { name: 'Hosur', at: { lat: 12.7409, lng: 77.8253 } },
  { name: 'Mysuru', at: { lat: 12.2958, lng: 76.6394 }, city: true },
  { name: 'Bengaluru', at: { lat: 12.9716, lng: 77.5946 }, city: true },
  { name: 'Mangaluru', at: { lat: 12.9141, lng: 74.856 }, city: true },
  { name: 'Chennai', at: { lat: 13.0827, lng: 80.2707 }, city: true },
];

export function describeRouteViaTowns(path: LatLng[]): string[] {
  if (path.length < 2) return [];
  const pts = Geo.resample(path, 1500.0);
  const total = pts[pts.length - 1].distanceM;
  const passed: { town: Town; distM: number }[] = [];

  for (const t of CORRIDOR_TOWNS) {
    let minOff = Number.MAX_VALUE;
    let bestDistM = 0;
    for (const p of pts) {
      const d = Geo.distanceM(p.position, t.at);
      if (d < minOff) {
        minOff = d;
        bestDistM = p.distanceM;
      }
    }
    const maxRadius = t.city ? 7000 : 3500;
    if (minOff <= maxRadius && bestDistM > 15000 && bestDistM < total - 15000) {
      passed.push({ town: t, distM: bestDistM });
    }
  }
  passed.sort((a, b) => a.distM - b.distM);
  return passed.slice(0, 4).map((p) => p.town.name);
}

/**
 * Built-in verified DC Fast Chargers across Kerala, Tamil Nadu & Karnataka corridors
 * Ensures Free/Zero-Key mode always finds real CCS2 hubs even when OSM Overpass is sparse.
 */
const CURATED_DC_CHARGERS: Omit<PlannedCharger, 'alongRouteM' | 'detourM'>[] = [
  { id: 'cur-tvpm-zeon', name: 'Zeon Charging • Lulu Mall Trivandrum', position: { lat: 8.5112, lng: 76.9016 }, maxKw: 60, connectorCount: 2, network: 'Zeon', open24h: true, address: 'NH 66, Akkulam, Thiruvananthapuram' },
  { id: 'cur-attingal-goec', name: 'GOEC Fast Charger • Attingal NH 66', position: { lat: 8.6981, lng: 76.8142 }, maxKw: 60, connectorCount: 2, network: 'GOEC', open24h: true, address: 'NH 66, Attingal, Kerala' },
  { id: 'cur-kollam-zeon', name: 'Zeon Charging • RP Mall Kollam', position: { lat: 8.8879, lng: 76.5945 }, maxKw: 50, connectorCount: 2, network: 'Zeon', open24h: true, address: 'Kollam, Kerala' },
  { id: 'cur-kottarakkara-cm', name: 'chargeMOD DC Fast • Kottarakkara MC Road', position: { lat: 9.0021, lng: 76.7751 }, maxKw: 60, connectorCount: 2, network: 'chargeMOD', open24h: true, address: 'MC Road, Kottarakkara' },
  { id: 'cur-adoor-goec', name: 'GOEC SuperFast • Adoor MC Road', position: { lat: 9.1552, lng: 76.7341 }, maxKw: 60, connectorCount: 2, network: 'GOEC', open24h: true, address: 'MC Road, Adoor' },
  { id: 'cur-kayamkulam-tata', name: 'Tata Power EZ Charge • Kayamkulam NH 66', position: { lat: 9.1762, lng: 76.5028 }, maxKw: 50, connectorCount: 2, network: 'Tata Power', open24h: true, address: 'NH 66, Kayamkulam' },
  { id: 'cur-thiruvalla-zeon', name: 'Zeon Charging • Club 7 Thiruvalla', position: { lat: 9.3845, lng: 76.5752 }, maxKw: 60, connectorCount: 2, network: 'Zeon', open24h: true, address: 'MC Road, Thiruvalla' },
  { id: 'cur-alappuzha-goec', name: 'GOEC DC Charger • Alappuzha Bypass', position: { lat: 9.4952, lng: 76.3412 }, maxKw: 60, connectorCount: 2, network: 'GOEC', open24h: true, address: 'NH 66, Alappuzha' },
  { id: 'cur-kottayam-zeon', name: 'Zeon Charging • Hotel Arcadia Kottayam', position: { lat: 9.5891, lng: 76.5214 }, maxKw: 50, connectorCount: 2, network: 'Zeon', open24h: true, address: 'Kottayam, Kerala' },
  { id: 'cur-ettumanoor-cm', name: 'chargeMOD DC Fast • Ettumanoor MC Road', position: { lat: 9.6712, lng: 76.5618 }, maxKw: 60, connectorCount: 2, network: 'chargeMOD', open24h: true, address: 'MC Road, Ettumanoor' },
  { id: 'cur-cherthala-cz', name: 'ChargeZone 60kW • Cherthala NH 66', position: { lat: 9.6852, lng: 76.3351 }, maxKw: 60, connectorCount: 2, network: 'ChargeZone', open24h: true, address: 'NH 66, Cherthala' },
  { id: 'cur-thodupuzha-goec', name: 'GOEC Fast Charger • Thodupuzha', position: { lat: 9.8965, lng: 76.7192 }, maxKw: 60, connectorCount: 2, network: 'GOEC', open24h: true, address: 'Thodupuzha, Idukki' },
  { id: 'cur-muvattupuzha-zeon', name: 'Zeon Charging • Muvattupuzha MC Road', position: { lat: 9.9885, lng: 76.5798 }, maxKw: 60, connectorCount: 2, network: 'Zeon', open24h: true, address: 'MC Road, Muvattupuzha' },
  { id: 'cur-kothamangalam-goec', name: 'GOEC 60kW DC • Kothamangalam NH 85', position: { lat: 10.0608, lng: 76.6345 }, maxKw: 60, connectorCount: 2, network: 'GOEC', open24h: true, address: 'Aluva-Munnar Hwy, Kothamangalam' },
  { id: 'cur-adimali-cm', name: 'chargeMOD DC Charger • Adimali Munnar Ghat', position: { lat: 10.0108, lng: 76.9512 }, maxKw: 50, connectorCount: 2, network: 'chargeMOD', open24h: true, address: 'NH 85, Adimali' },
  { id: 'cur-munnar-tata', name: 'Tata Power DC Charger • Munnar Town', position: { lat: 10.0892, lng: 77.0598 }, maxKw: 50, connectorCount: 2, network: 'Tata Power', open24h: true, address: 'Munnar, Idukki' },
  { id: 'cur-kochi-edappally-zeon', name: 'Zeon Charging Hub • Lulu Mall Edappally Kochi', position: { lat: 10.0274, lng: 76.3082 }, maxKw: 60, connectorCount: 4, network: 'Zeon', open24h: true, address: 'Edappally, Kochi' },
  { id: 'cur-aluva-goec', name: 'GOEC DC Fast • Aluva Bypass NH 544', position: { lat: 10.1021, lng: 76.3562 }, maxKw: 60, connectorCount: 2, network: 'GOEC', open24h: true, address: 'NH 544, Aluva' },
  { id: 'cur-angamaly-zeon', name: 'Zeon Charging • Angamaly NH 544', position: { lat: 10.1951, lng: 76.3865 }, maxKw: 60, connectorCount: 2, network: 'Zeon', open24h: true, address: 'NH 544, Angamaly' },
  { id: 'cur-chalakudy-cz', name: 'ChargeZone 60kW • Chalakudy NH 544', position: { lat: 10.3065, lng: 76.3345 }, maxKw: 60, connectorCount: 2, network: 'ChargeZone', open24h: true, address: 'NH 544, Chalakudy' },
  { id: 'cur-chalakudy-zeon-180', name: 'Zeon Charging Station • Chalakudy NH 544', position: { lat: 10.3345, lng: 76.3412 }, maxKw: 180, connectorCount: 4, network: 'Zeon', open24h: true, address: 'Potta, Chalakudy NH 544' },
  { id: 'cur-koratty-goec-30', name: 'GOEC Charging Station • Koratty InfoPark', position: { lat: 10.2612, lng: 76.3582 }, maxKw: 30, connectorCount: 2, network: 'GOEC', open24h: true, address: 'NH 544, Koratty' },
  { id: 'cur-thrissur-mannuthy-zeon', name: 'Zeon Charging • Mannuthy Bypass Thrissur', position: { lat: 10.5312, lng: 76.2564 }, maxKw: 60, connectorCount: 4, network: 'Zeon', open24h: true, address: 'NH 544, Mannuthy, Thrissur' },
  { id: 'cur-thrissur-goec', name: 'GOEC SuperFast • Sobha City Thrissur', position: { lat: 10.5538, lng: 76.1782 }, maxKw: 60, connectorCount: 2, network: 'GOEC', open24h: true, address: 'Puzhakkal, Thrissur' },
  { id: 'cur-vadakkenchery-zeon', name: 'Zeon Charging • Hotel Diana Heights Vadakkenchery', position: { lat: 10.5912, lng: 76.4841 }, maxKw: 60, connectorCount: 2, network: 'Zeon', open24h: true, address: 'NH 544, Vadakkenchery' },
  { id: 'cur-palakkad-zeon', name: 'Zeon Charging • Walayar / Palakkad Bypass NH 544', position: { lat: 10.7795, lng: 76.6821 }, maxKw: 60, connectorCount: 4, network: 'Zeon', open24h: true, address: 'NH 544, Palakkad' },
  { id: 'cur-palakkad-goec', name: 'GOEC Fast Charger • Chandra Nagar Palakkad', position: { lat: 10.7732, lng: 76.6712 }, maxKw: 60, connectorCount: 2, network: 'GOEC', open24h: true, address: 'NH 544, Palakkad' },
  { id: 'cur-kuttippuram-goec', name: 'GOEC DC Hub • Kuttippuram NH 66', position: { lat: 10.8448, lng: 76.0318 }, maxKw: 60, connectorCount: 2, network: 'GOEC', open24h: true, address: 'NH 66, Kuttippuram' },
  { id: 'cur-kozhikode-zeon', name: 'Zeon Charging • HiLITE Mall Kozhikode', position: { lat: 11.2481, lng: 75.8339 }, maxKw: 60, connectorCount: 4, network: 'Zeon', open24h: true, address: 'NH 66 Bypass, Kozhikode' },
  { id: 'cur-wayanad-goec', name: 'GOEC Fast Charger • Kalpetta Wayanad', position: { lat: 11.6112, lng: 76.0835 }, maxKw: 60, connectorCount: 2, network: 'GOEC', open24h: true, address: 'NH 766, Kalpetta, Wayanad' },
  { id: 'cur-kannur-goec', name: 'GOEC DC Fast • Kannur NH 66', position: { lat: 11.8752, lng: 75.3712 }, maxKw: 60, connectorCount: 2, network: 'GOEC', open24h: true, address: 'NH 66, Kannur' },
  { id: 'cur-coimbatore-zeon', name: 'Zeon Charging • Navavoor / L&T Bypass Coimbatore', position: { lat: 11.0012, lng: 77.0421 }, maxKw: 60, connectorCount: 4, network: 'Zeon', open24h: true, address: 'L&T Bypass, Coimbatore' },
  { id: 'cur-avinashi-zeon', name: 'Zeon Charging • Haribhavanam Avinashi NH 544', position: { lat: 11.1924, lng: 77.2688 }, maxKw: 80, connectorCount: 4, network: 'Zeon', open24h: true, address: 'NH 544, Avinashi, Tiruppur' },
  { id: 'cur-perundurai-relux', name: 'Relux Electric Hub • Perundurai / Erode NH 544', position: { lat: 11.2758, lng: 77.5831 }, maxKw: 120, connectorCount: 4, network: 'Relux', open24h: true, address: 'NH 544, Perundurai' },
  { id: 'cur-salem-zeon', name: 'Zeon Charging • A2B Sankagiri / Salem NH 544', position: { lat: 11.6512, lng: 78.1325 }, maxKw: 80, connectorCount: 4, network: 'Zeon', open24h: true, address: 'NH 44/544, Salem' },
  { id: 'cur-dharmapuri-zeon', name: 'Zeon Charging • Thoppur / Dharmapuri NH 44', position: { lat: 12.1211, lng: 78.1582 }, maxKw: 80, connectorCount: 4, network: 'Zeon', open24h: true, address: 'NH 44, Dharmapuri' },
  { id: 'cur-krishnagiri-cz', name: 'ChargeZone SuperHub • Krishnagiri NH 44', position: { lat: 12.5266, lng: 78.2137 }, maxKw: 120, connectorCount: 4, network: 'ChargeZone', open24h: true, address: 'NH 44, Krishnagiri' },
  { id: 'cur-hosur-zeon', name: 'Zeon Charging • A2B Hosur NH 44', position: { lat: 12.7405, lng: 77.8261 }, maxKw: 80, connectorCount: 4, network: 'Zeon', open24h: true, address: 'NH 44, Hosur' },
  { id: 'cur-mysuru-zeon', name: 'Zeon Charging • Mysuru Ring Road', position: { lat: 12.3112, lng: 76.6421 }, maxKw: 60, connectorCount: 4, network: 'Zeon', open24h: true, address: 'Mysuru, Karnataka' },
  { id: 'cur-bengaluru-statiq', name: 'Statiq Fast Hub • Electronic City Bengaluru', position: { lat: 12.8452, lng: 77.6602 }, maxKw: 60, connectorCount: 4, network: 'Statiq', open24h: true, address: 'Hosur Rd, Bengaluru' },
  { id: 'cur-madurai-zeon', name: 'Zeon Charging • Mattuthavani Madurai', position: { lat: 9.9421, lng: 78.1562 }, maxKw: 60, connectorCount: 4, network: 'Zeon', open24h: true, address: 'Madurai Bypass' },
  { id: 'cur-nagercoil-zeon', name: 'Zeon Charging • Nagercoil NH 66', position: { lat: 8.1841, lng: 77.4125 }, maxKw: 50, connectorCount: 2, network: 'Zeon', open24h: true, address: 'Nagercoil, Tamil Nadu' },
];

// ============================================================================
// HYBRID ROUTE, ELEVATION & CHARGER DATA CLIENT (Free OSM/OSRM/Open-Meteo + Optional Google Maps API)
// ============================================================================

export interface PlaceSuggestion {
  placeId: string;
  title: string;
  subtitle?: string;
  position?: LatLng;
  distanceM?: number;
}

export interface NamedPlace {
  placeId: string;
  name: string;
  position: LatLng;
}

export interface SlowStretch {
  startIndex: number;
  endIndex: number;
  lengthM: number;
  jam: boolean;
  near?: string | null;
}

export interface RouteChoice {
  id: string;
  label: string;
  description: string;
  path: LatLng[];
  samples: RoutePoint[];
  elevations: number[];
  profile: ProfilePoint[];
  distanceM: number;
  durationS: number;
  normalDurationS?: number;
  trafficDelayMin: number;
  climbM: number;
  peakM: number;
  chargers: PlannedCharger[];
  longestGapKm: number;
  tolls: boolean;
  slowStretches: SlowStretch[];
  source: 'google' | 'osrm';
}

/**
 * Search places using Google Places Autocomplete (if googleApiKey provided) or Free Nominatim/Photon
 */
export async function searchDestinationPlaces(
  query: string,
  near?: LatLng | null,
  googleApiKey?: string | null
): Promise<PlaceSuggestion[]> {
  const cleanQuery = query.trim();
  if (cleanQuery.length < 2) return [];

  // 1. Check built-in Corridor Towns first for instant 0ms response
  const qLower = cleanQuery.toLowerCase();
  const quickTowns: PlaceSuggestion[] = CORRIDOR_TOWNS.filter((t) =>
    t.name.toLowerCase().includes(qLower)
  )
    .slice(0, 3)
    .map((t) => ({
      placeId: `town:${t.name}`,
      title: t.name,
      subtitle: 'South India EV Corridor Hub',
      position: t.at,
      distanceM: near ? Geo.distanceM(near, t.at) : undefined,
    }));

  // 2. If Google Maps API key is configured, query via Worker proxy or direct Places API (New)
  if (googleApiKey && googleApiKey.trim().length > 15) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/planner/google-autocomplete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: googleApiKey.trim(),
          input: cleanQuery,
          near,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
          return [...data.suggestions, ...quickTowns].slice(0, 6);
        }
      }
    } catch (_) {}
  }

  // 3. Free / Zero-Key Mode: OpenStreetMap Nominatim (scoped to India first, then global)
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      cleanQuery
    )}&countrycodes=in&limit=6&addressdetails=1`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const items = await res.json();
      if (Array.isArray(items)) {
        const mapped: PlaceSuggestion[] = items.map((item: any) => {
          const lat = Number(item.lat);
          const lng = Number(item.lon);
          const parts = String(item.display_name || '').split(',');
          const title = parts[0]?.trim() || cleanQuery;
          const subtitle = parts.slice(1, 4).join(',').trim();
          return {
            placeId: `osm:${item.place_id}`,
            title,
            subtitle,
            position: { lat, lng },
            distanceM: near ? Geo.distanceM(near, { lat, lng }) : undefined,
          };
        });
        const combined = [...quickTowns, ...mapped];
        const seen = new Set<string>();
        return combined
          .filter((x) => {
            const k = x.title.toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .slice(0, 6);
      }
    }
  } catch (_) {}

  return quickTowns;
}

/**
 * Resolve Place coordinates when user taps a suggestion
 */
export async function resolvePlaceSuggestion(
  suggestion: PlaceSuggestion,
  googleApiKey?: string | null
): Promise<NamedPlace> {
  if (suggestion.position) {
    return {
      placeId: suggestion.placeId,
      name: suggestion.title,
      position: suggestion.position,
    };
  }
  if (googleApiKey && googleApiKey.trim().length > 15) {
    const res = await fetch(`${BACKEND_URL}/api/planner/google-place-details`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: googleApiKey.trim(),
        placeId: suggestion.placeId,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.location) {
        return {
          placeId: suggestion.placeId,
          name: data.name || suggestion.title,
          position: data.location,
        };
      }
    }
  }
  throw new Error('Could not resolve coordinates for selected place.');
}

// In-memory elevation cache across polyline hashes to prevent redundant network calls
const elevationCache = new Map<string, number[]>();

function interpolateElevations(sampleElevations: number[], totalPoints: number): number[] {
  if (sampleElevations.length === 0) return Array(totalPoints).fill(0);
  if (totalPoints <= 1) return Array(totalPoints).fill(sampleElevations[0]);
  if (sampleElevations.length === totalPoints) return sampleElevations;

  const M = sampleElevations.length;
  const result: number[] = new Array(totalPoints);
  for (let i = 0; i < totalPoints; i++) {
    const frac = i / (totalPoints - 1);
    const sampleIdxFloat = frac * (M - 1);
    const low = Math.floor(sampleIdxFloat);
    const high = Math.min(M - 1, Math.ceil(sampleIdxFloat));
    if (low === high) {
      result[i] = sampleElevations[low];
    } else {
      const t = sampleIdxFloat - low;
      result[i] = Number((sampleElevations[low] * (1 - t) + sampleElevations[high] * t).toFixed(1));
    }
  }
  return result;
}

/**
 * Fetch 90m SRTM Digital Elevation Model (DEM) elevations along sampled route points.
 * Uses Google Elevation API if key is set, else Open-Meteo Elevation API (100% free, no key).
 */
export async function fetchRouteElevations(
  points: LatLng[],
  googleApiKey?: string | null
): Promise<number[]> {
  if (points.length === 0) return [];

  const cacheKey = `${points[0].lat.toFixed(3)},${points[0].lng.toFixed(3)}->${points[points.length - 1].lat.toFixed(3)},${points[points.length - 1].lng.toFixed(3)}:${points.length}`;
  const cached = elevationCache.get(cacheKey);
  if (cached && cached.length === points.length) {
    return cached;
  }

  // Option A: Google Elevation API via Worker proxy
  if (googleApiKey && googleApiKey.trim().length > 15) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/planner/google-elevation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: googleApiKey.trim(),
          encodedPolyline: Geo.encodePolyline(points),
          count: Math.min(500, points.length),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.elevations) && data.elevations.length > 0) {
          const interpolated = interpolateElevations(data.elevations, points.length);
          elevationCache.set(cacheKey, interpolated);
          return interpolated;
        }
      }
    } catch (_) {}
  }

  // Option B: Free Open-Meteo SRTM DEM API (Smart 80-Sample Resampling & Interpolation)
  // Open-Meteo allows max 100 coordinates per request. By evenly sampling up to 80 points,
  // the entire route elevation profile is fetched in a SINGLE GET request, preventing 429 rate-limiting.
  try {
    const sampleCount = Math.min(80, points.length);
    const sampleIndices: number[] = [];
    if (points.length <= sampleCount) {
      for (let i = 0; i < points.length; i++) sampleIndices.push(i);
    } else {
      for (let s = 0; s < sampleCount; s++) {
        sampleIndices.push(Math.round((s / (sampleCount - 1)) * (points.length - 1)));
      }
    }

    const queryPoints = sampleIndices.map((idx) => points[idx]);
    const lats = queryPoints.map((p) => p.lat.toFixed(4)).join(',');
    const lngs = queryPoints.map((p) => p.lng.toFixed(4)).join(',');

    const res = await fetch(
      `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.elevation) && data.elevation.length === queryPoints.length) {
        const rawElevations = data.elevation.map((v: any) => Number(v) || 0);
        const interpolated = interpolateElevations(rawElevations, points.length);
        elevationCache.set(cacheKey, interpolated);
        return interpolated;
      }
    }
  } catch (_) {}

  // Fallback if offline
  return points.map(() => 0);
}

/**
 * Find DC Fast Chargers along the route path.
 * Combines:
 * 1. Google Places API (New) `searchAlongRouteParameters` (when Google key is provided, includes live CCS2 plug counts!)
 * 2. OpenStreetMap Overpass API (`amenity=charging_station`) along route bounding corridor
 * 3. Built-in Curated South India DC Fast Charger network (Zeon, GOEC, ChargeZone, Tata Power, Statiq, chargeMOD, Relux)
 */
export async function findChargersAlongRoute(
  samples: RoutePoint[],
  routeDistanceM: number,
  maxDetourKm = 15,
  googleApiKey?: string | null
): Promise<PlannedCharger[]> {
  if (samples.length < 2) return [];
  const maxOffRouteM = maxDetourKm * 1000;
  const rawChargers: Omit<PlannedCharger, 'alongRouteM' | 'detourM'>[] = [
    ...CURATED_DC_CHARGERS,
  ];

  // 1. If Google Maps API key is configured, query Google Places Search Along Route
  if (googleApiKey && googleApiKey.trim().length > 15) {
    try {
      const thin = Geo.resample(
        samples.map((s) => s.position),
        1000.0
      ).map((s) => s.position);
      const res = await fetch(`${BACKEND_URL}/api/planner/google-chargers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: googleApiKey.trim(),
          encodedPolyline: Geo.encodePolyline(thin),
          origin: thin[0],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.chargers)) {
          for (const gc of data.chargers) {
            rawChargers.unshift({
              id: gc.id,
              name: gc.name,
              position: gc.position,
              maxKw: Math.max(25, Number(gc.maxKw) || 30),
              connectorCount: gc.connectorCount ?? null,
              availableCount: gc.availableCount ?? null,
              network: detectChargerNetwork(gc.name),
              address: gc.address || null,
              open24h: gc.open24h ?? null,
            });
          }
        }
      }
    } catch (_) {}
  }

  // 2. Query OpenStreetMap Overpass API for charging stations along the route bounding box via Worker Proxy
  try {
    let minLat = 90,
      maxLat = -90,
      minLng = 180,
      maxLng = -180;
    for (const s of samples) {
      if (s.position.lat < minLat) minLat = s.position.lat;
      if (s.position.lat > maxLat) maxLat = s.position.lat;
      if (s.position.lng < minLng) minLng = s.position.lng;
      if (s.position.lng > maxLng) maxLng = s.position.lng;
    }
    const pad = 0.08;
    const bbox = `${(minLat - pad).toFixed(3)},${(minLng - pad).toFixed(3)},${(
      maxLat + pad
    ).toFixed(3)},${(maxLng + pad).toFixed(3)}`;

    const res = await fetch(`${BACKEND_URL}/api/planner/osm-chargers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bbox }),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.elements)) {
        for (const el of data.elements) {
          if (!el.lat || !el.lon) continue;
          const tags = el.tags || {};
          const name =
            tags.name ||
            tags.operator ||
            tags.brand ||
            'EV Fast Charging Station';
          const outStr = String(
            tags['socket:ccs2:output'] ||
              tags['charging_station:output'] ||
              tags.maxpower ||
              '30'
          );
          const kwMatch = outStr.match(/(\d+(\.\d+)?)/);
          const kw = kwMatch ? Math.max(25, Number(kwMatch[1])) : 30;
          rawChargers.push({
            id: `osm-node-${el.id}`,
            name,
            position: { lat: Number(el.lat), lng: Number(el.lon) },
            maxKw: kw,
            connectorCount: Number(tags.capacity) || 2,
            availableCount: null,
            network: detectChargerNetwork(
              `${name} ${tags.operator || ''} ${tags.network || ''}`
            ),
            address: (() => {
              const street = tags['addr:street']
                ? [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ')
                : null;
              const locality =
                tags['addr:suburb'] ||
                tags['addr:city'] ||
                tags['addr:town'] ||
                tags['addr:village'] ||
                tags['addr:district'] ||
                null;
              const state = tags['addr:state'] || null;
              const combined = [street, locality, state].filter(Boolean).join(', ');
              return combined || tags['addr:full'] || tags['description'] || null;
            })(),
            open24h: tags.opening_hours === '24/7' ? true : null,
          });
        }
      }
    }
  } catch (_) {}

  // 3. Snap chargers to route and filter by maxDetourKm & deduplicate within 400m
  const matched: PlannedCharger[] = [];
  for (const c of rawChargers) {
    let bestSample = samples[0];
    let minOffM = Number.MAX_VALUE;
    for (const s of samples) {
      const d = Geo.distanceM(s.position, c.position);
      if (d < minOffM) {
        minOffM = d;
        bestSample = s;
      }
    }
    if (
      minOffM <= maxOffRouteM &&
      bestSample.distanceM > 1000 &&
      bestSample.distanceM < routeDistanceM - 1000
    ) {
      // Check if duplicate within 350m already exists
      const existingIdx = matched.findIndex(
        (m) => Geo.distanceM(m.position, c.position) < 350
      );
      const entry: PlannedCharger = {
        ...c,
        alongRouteM: Math.round(bestSample.distanceM),
        detourM: Math.round(minOffM * 2),
      };
      if (existingIdx >= 0) {
        // Prefer the one with live availability or higher kW
        if (
          entry.availableCount != null &&
          matched[existingIdx].availableCount == null
        ) {
          matched[existingIdx] = entry;
        }
      } else {
        matched.push(entry);
      }
    }
  }

  return matched.sort((a, b) => a.alongRouteM - b.alongRouteM);
}

/**
 * Compute full Route Choices (Geometry + Elevation Profile + Traffic Speeds + Chargers Along Route)
 */
export async function computeTripRouteChoices(
  origin: LatLng,
  destination: NamedPlace,
  googleApiKey?: string | null,
  onProgress?: (status: string) => void
): Promise<RouteChoice[]> {
  onProgress?.('Finding routes & traffic data...');
  const rawRoutes: {
    description: string;
    path: LatLng[];
    distanceM: number;
    durationS: number;
    normalDurationS?: number;
    steps: { distanceM: number; durationS: number }[];
    tolls: boolean;
    slowStretches: SlowStretch[];
    source: 'google' | 'osrm';
  }[] = [];

  // 1. Try Google Routes API v2 (with TRAFFIC_AWARE & TRAFFIC_ON_POLYLINE) if key is provided
  if (googleApiKey && googleApiKey.trim().length > 15) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/planner/google-routes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: googleApiKey.trim(),
          origin,
          destination: destination.position,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.routes) && data.routes.length > 0) {
          for (const gr of data.routes) {
            const path = Geo.decodePolyline(gr.encodedPolyline);
            if (path.length >= 2) {
              rawRoutes.push({
                description: gr.description || 'Fastest Route',
                path,
                distanceM: Number(gr.distanceM) || 0,
                durationS: Number(gr.durationS) || 0,
                normalDurationS: gr.normalDurationS
                  ? Number(gr.normalDurationS)
                  : undefined,
                steps: Array.isArray(gr.steps) ? gr.steps : [],
                tolls: Boolean(gr.tolls),
                slowStretches: Array.isArray(gr.slowStretches)
                  ? gr.slowStretches
                  : [],
                source: 'google',
              });
            }
          }
        }
      }
    } catch (_) {}
  }

  // 2. Fallback / Free Mode: OSRM Routing API (with alternative routes + step speeds)
  if (rawRoutes.length === 0) {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.position.lng},${destination.position.lat}?overview=full&geometries=polyline&alternatives=true&steps=true`;
    const res = await fetch(osrmUrl);
    if (!res.ok) {
      throw new Error('Could not compute driving route. Check your internet connection.');
    }
    const data = await res.json();
    if (!Array.isArray(data.routes) || data.routes.length === 0) {
      throw new Error('No drivable route found between these locations.');
    }
    for (let i = 0; i < Math.min(3, data.routes.length); i++) {
      const r = data.routes[i];
      const path = Geo.decodePolyline(r.geometry);
      const steps: { distanceM: number; durationS: number }[] = [];
      for (const leg of r.legs || []) {
        for (const st of leg.steps || []) {
          steps.push({
            distanceM: Number(st.distance) || 0,
            durationS: Number(st.duration) || 0,
          });
        }
      }
      rawRoutes.push({
        description:
          r.legs?.[0]?.summary || (i === 0 ? 'Primary Highway' : `Alternative ${i + 1}`),
        path,
        distanceM: Number(r.distance) || 0,
        durationS: Number(r.duration) || 0,
        steps,
        tolls: false,
        slowStretches: [],
        source: 'osrm',
      });
    }
  }

  // 3. For each route, resample every 500m, fetch DEM elevations, build speed+terrain profile, and find DC chargers
  const choices: RouteChoice[] = [];
  for (let i = 0; i < rawRoutes.length; i++) {
    const r = rawRoutes[i];
    if (i > 0) {
      await new Promise((res) => setTimeout(res, 200));
    }
    onProgress?.(
      `Reading elevation (Ghats/hills) & DC chargers for Route ${i + 1}...`
    );
    const sampleStepM = r.distanceM > 250_000 ? 1000.0 : 500.0;
    const samples = Geo.resample(r.path, sampleStepM);
    const elevations = await fetchRouteElevations(
      samples.map((s) => s.position),
      googleApiKey
    );

    // Build ProfilePoint[] with segment speeds
    const stepEnds: number[] = [];
    let accDist = 0;
    for (const st of r.steps) {
      accDist += st.distanceM;
      stepEnds.push(accDist);
    }
    const fallbackSpeed =
      r.durationS > 0 ? (r.distanceM / r.durationS) * 3.6 : 55.0;
    const profile: ProfilePoint[] = samples.map((s, idx) => {
      const stepIdx = stepEnds.findIndex((endM) => endM >= s.distanceM);
      const st =
        r.steps[stepIdx >= 0 ? stepIdx : Math.max(0, r.steps.length - 1)];
      const rawSpeed =
        st && st.durationS > 0 ? (st.distanceM / st.durationS) * 3.6 : fallbackSpeed;
      const clampedSpeed = Math.max(10.0, Math.min(110.0, rawSpeed));
      return {
        distanceM: s.distanceM,
        elevationM: elevations[idx] ?? 0,
        speedKmh: clampedSpeed,
      };
    });

    const chargers = await findChargersAlongRoute(
      samples,
      r.distanceM,
      15,
      googleApiKey
    );
    const climbM = Math.round(Terrain.ascentM(elevations));
    const peakM = Math.round(
      elevations.length > 0 ? Math.max(...elevations) : 0
    );

    // Longest charger-free gap along route
    const marks = [
      0,
      ...chargers.map((c) => c.alongRouteM).sort((a, b) => a - b),
      r.distanceM,
    ];
    let maxGapM = 0;
    for (let k = 1; k < marks.length; k++) {
      const gap = marks[k] - marks[k - 1];
      if (gap > maxGapM) maxGapM = gap;
    }

    const towns = describeRouteViaTowns(r.path);
    const label =
      towns.length > 0 ? `via ${towns.join(', ')}` : r.description || `Route ${i + 1}`;
    const trafficDelayMin =
      r.normalDurationS && r.durationS > r.normalDurationS
        ? Math.round((r.durationS - r.normalDurationS) / 60)
        : 0;

    choices.push({
      id: `route-${i}`,
      label,
      description: r.description,
      path: r.path,
      samples,
      elevations,
      profile,
      distanceM: r.distanceM,
      durationS: r.durationS,
      normalDurationS: r.normalDurationS,
      trafficDelayMin,
      climbM,
      peakM,
      chargers,
      longestGapKm: Math.round(maxGapM / 1000),
      tolls: r.tolls,
      slowStretches: r.slowStretches,
      source: r.source,
    });
  }

  return choices;
}

/**
 * Validate a user-supplied Google Maps Platform API Key (Checks Routes, Places & Elevation APIs)
 */
export async function verifyGoogleMapsApiKey(
  apiKey: string
): Promise<{ ok: boolean; message: string }> {
  const clean = apiKey.trim();
  if (!clean) {
    return { ok: false, message: 'Please enter a Google Maps Platform API key.' };
  }
  try {
    const res = await fetch(`${BACKEND_URL}/api/planner/google-verify-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: clean }),
    });
    const data = await res.json();
    return {
      ok: Boolean(data.ok),
      message: data.message || (data.ok ? 'Google API key verified!' : 'Key check failed'),
    };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/**
 * Find the nearest other charger in the corridor within 15-20 km of a given charger
 */
export function findBackupChargerInCorridor(
  c: PlannedCharger,
  allChargers: PlannedCharger[],
  maxDistanceKm = 20
): {
  backup: PlannedCharger | null;
  distanceKm: number | null;
  isWithin20km: boolean;
} {
  const candidates = allChargers.filter(
    (other) =>
      other.id !== c.id &&
      Math.abs(other.alongRouteM - c.alongRouteM) <= maxDistanceKm * 1000.0 &&
      Math.abs(other.alongRouteM - c.alongRouteM) >= 200.0
  );
  if (candidates.length === 0) {
    return { backup: null, distanceKm: null, isWithin20km: false };
  }
  candidates.sort(
    (a, b) =>
      Math.abs(a.alongRouteM - c.alongRouteM) -
      Math.abs(b.alongRouteM - c.alongRouteM)
  );
  const best = candidates[0];
  const offsetKm = Number(((best.alongRouteM - c.alongRouteM) / 1000.0).toFixed(1));
  return {
    backup: best,
    distanceKm: offsetKm,
    isWithin20km: true,
  };
}

/**
 * Simulate battery arrival % and driving distance to a candidate charger from a given start point
 * using route elevation profile and live traffic speeds.
 */
export function simulateLegToCharger(
  vehicle: VehicleProfile,
  points: ProfilePoint[],
  fromM: number,
  fromSoc: number,
  targetCharger: PlannedCharger
): {
  distanceM: number;
  arriveSoc: number;
  isReachable: boolean;
} {
  if (points.length === 0) {
    return { distanceM: 0, arriveSoc: fromSoc, isReachable: true };
  }
  const model = new EnergyModel(vehicle);
  const capKwh = vehicle.usableCapacityKwh;

  let fromIdx = points.findIndex((p) => p.distanceM >= fromM);
  if (fromIdx < 0) fromIdx = 0;

  let toIdx = points.findIndex((p) => p.distanceM >= targetCharger.alongRouteM);
  if (toIdx < 0) toIdx = points.length - 1;
  const targetIdx = Math.max(fromIdx + 1, toIdx);

  const slice = points.slice(fromIdx, targetIdx + 1);
  const sim = model.simulate(slice, fromSoc);
  const atExitSoc = sim[sim.length - 1]?.socPercent ?? fromSoc;
  const detourKwh = (targetCharger.detourM / 2 / 1000.0) / vehicle.cityKmPerKwh;
  const detourSoc = (detourKwh / capKwh) * 100.0;
  const arriveSoc = Number((atExitSoc - detourSoc).toFixed(1));
  const distanceM = Math.max(0, targetCharger.alongRouteM - fromM);

  return {
    distanceM,
    arriveSoc,
    isReachable: arriveSoc > 0,
  };
}

/**
 * Build a complete trip plan from a list of user-selected charging stops,
 * computing physics elevation and traffic across each leg.
 */
export function buildManualTripPlan(
  vehicle: VehicleProfile,
  settings: TripSettings,
  points: ProfilePoint[],
  startSoc: number,
  selectedChargers: PlannedCharger[],
  allChargers: PlannedCharger[],
  feedbackMap: Record<string, ChargerFeedbackEntry[]> = {}
): TripPlan {
  if (points.length === 0) {
    return {
      reachable: false,
      stops: [],
      arrivalSoc: 0,
      socTrace: [],
      distanceM: 0,
      driveMinutes: 0,
      chargeMinutes: 0,
      energy: { flatKwh: 0, climbKwh: 0, regenKwh: 0, totalKwh: 0, terrainKwh: 0 },
      usableCapacityKwh: vehicle.usableCapacityKwh,
      terrainPercent: 0,
    };
  }

  const model = new EnergyModel(vehicle);
  const totalM = points[points.length - 1].distanceM;
  const capKwh = vehicle.usableCapacityKwh;
  const targetSoc = settings.maxChargeTargetPercent || 100;

  const trace: SocPoint[] = [];
  const stops: PlannedStop[] = [];
  let fromPointIdx = 0;
  let currentSoc = startSoc;

  let dcCount = 0;
  let acCount = 0;

  for (let sIdx = 0; sIdx < selectedChargers.length; sIdx++) {
    const c = selectedChargers[sIdx];
    const targetIdx = points.findIndex((p) => p.distanceM >= c.alongRouteM);
    const stopIdx = Math.max(fromPointIdx + 1, targetIdx < 0 ? points.length - 1 : targetIdx);

    const legSlice = points.slice(fromPointIdx, stopIdx + 1);
    const legSim = model.simulate(legSlice, currentSoc);
    if (legSim.length > 0) {
      trace.push(...legSim.slice(0, legSim.length - 1));
    }

    const detourKwh = (c.detourM / 2 / 1000.0) / vehicle.cityKmPerKwh;
    const detourSoc = (detourKwh / capKwh) * 100.0;
    const rawArrive = legSim[legSim.length - 1]?.socPercent ?? currentSoc;
    const arriveSoc = Number((rawArrive - detourSoc).toFixed(1));

    // Windsor 4-DC fast charge rule
    const isFast = (c.maxKw || 30) >= 20;
    let chargeType: 'DC' | 'AC' = isFast ? 'DC' : 'AC';
    let dcStopIndex: number | undefined;
    let isMandatoryAcStop = false;
    let mandatoryAcReason: string | undefined;

    if (isFast) {
      dcCount++;
      if (dcCount > 4) {
        chargeType = 'AC';
        isMandatoryAcStop = true;
        acCount++;
        mandatoryAcReason =
          'MG Windsor EV BMS Rule: Mandatory slow AC charge to 100% for LFP cell balancing after 4 consecutive DC charges.';
      } else {
        dcStopIndex = dcCount;
      }
    } else {
      acCount++;
    }

    const departSoc = isMandatoryAcStop
      ? 100
      : Math.min(100, Math.max(arriveSoc + 5, targetSoc));
    const chargeMinutes = isMandatoryAcStop
      ? Math.round((((100 - arriveSoc) / 100.0) * capKwh / 7.4) * 60.0)
      : Math.round(ChargeTime.minutes(vehicle, arriveSoc, departSoc, c.maxKw));

    const conf = evaluateChargerConfidence(c, allChargers, feedbackMap[c.id] || []);
    const backupInfo = findBackupChargerInCorridor(c, allChargers, 20);

    const plannedStop: PlannedStop = {
      charger: c,
      arriveSoc,
      departSoc,
      chargeMinutes,
      chargeType,
      dcStopIndex,
      isMandatoryAcStop,
      mandatoryAcReason,
      backupCharger: backupInfo.backup || conf.backup || null,
      backupDistanceKm: backupInfo.distanceKm ?? conf.backupKm,
      nextCharger: conf.nextCharger,
      nextDistanceKm: conf.nextKm,
      confidenceDots: conf.dots,
      confidenceLabel: conf.label,
      confidenceReasons: conf.reasons,
    };

    stops.push(plannedStop);
    trace.push({
      distanceM: points[stopIdx].distanceM,
      socPercent: arriveSoc,
      elevationM: points[stopIdx].elevationM,
    });

    fromPointIdx = stopIdx;
    currentSoc = departSoc;
  }

  const remainingSlice = points.slice(fromPointIdx);
  const remainingSim = model.simulate(remainingSlice, currentSoc);
  trace.push(...remainingSim);

  const destinationArrivalSoc = Number(
    (remainingSim[remainingSim.length - 1]?.socPercent ?? currentSoc).toFixed(1)
  );

  const detourMin = stops.reduce(
    (acc, s) => acc + ((s.charger.detourM / 1000.0) / 35.0) * 60.0,
    0
  );
  const totalChargeMinutes = stops.reduce((acc, s) => acc + s.chargeMinutes, 0);
  const energy = model.breakdown(points);

  let driveMinutes = 0;
  for (let i = 1; i < points.length; i++) {
    const distKm = (points[i].distanceM - points[i - 1].distanceM) / 1000.0;
    const speed = Math.max(10, (points[i].speedKmh + points[i - 1].speedKmh) / 2);
    driveMinutes += (distKm / speed) * 60.0;
  }

  return {
    reachable: destinationArrivalSoc > 0,
    stops,
    arrivalSoc: destinationArrivalSoc,
    socTrace: trace,
    distanceM: totalM,
    driveMinutes: Math.round(driveMinutes + detourMin),
    chargeMinutes: totalChargeMinutes,
    energy,
    usableCapacityKwh: capKwh,
    terrainPercent: Number(
      ((energy.terrainKwh / capKwh) * 100.0).toFixed(1)
    ),
    dcStopCount: dcCount > 4 ? 4 : dcCount,
    mandatoryAcStopCount: acCount,
  };
}

export interface NearbyChargerItem extends PlannedCharger {
  distanceKm: number;
}

export async function findNearbyChargers(
  center: LatLng,
  radiusKm: number = 25,
  googleApiKey?: string
): Promise<NearbyChargerItem[]> {
  const list: NearbyChargerItem[] = [];
  const maxM = radiusKm * 1000.0;

  // 1. Check curated DC chargers
  for (const c of CURATED_DC_CHARGERS) {
    const d = Geo.distanceM(center, c.position);
    if (d <= maxM) {
      list.push({
        ...c,
        alongRouteM: Math.round(d),
        detourM: 0,
        distanceKm: Number((d / 1000.0).toFixed(1)),
      });
    }
  }

  // 2. Query OSM Overpass proxy if available
  try {
    const latDelta = (radiusKm * 1.15) / 111.0;
    const lonDelta = (radiusKm * 1.15) / (111.0 * Math.max(0.1, Math.cos((center.lat * Math.PI) / 180.0)));
    const bbox = `${(center.lat - latDelta).toFixed(3)},${(center.lng - lonDelta).toFixed(3)},${(center.lat + latDelta).toFixed(3)},${(center.lng + lonDelta).toFixed(3)}`;
    const res = await fetch(`${BACKEND_URL}/api/planner/osm-chargers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bbox }),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.elements)) {
        for (const el of data.elements) {
          if (!el.lat || !el.lon) continue;
          const pos = { lat: Number(el.lat), lng: Number(el.lon) };
          const d = Geo.distanceM(center, pos);
          if (d > maxM) continue;

          const tags = el.tags || {};
          const name = tags.name || tags.operator || tags.brand || 'EV Fast Charging Station';
          const outStr = String(
            tags['socket:ccs2:output'] ||
              tags['charging_station:output'] ||
              tags.maxpower ||
              '30'
          );
          const kwMatch = outStr.match(/(\d+(\.\d+)?)/);
          const kw = kwMatch ? Math.max(25, Number(kwMatch[1])) : 30;

          const street = tags['addr:street']
            ? [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ')
            : null;
          const locality =
            tags['addr:suburb'] ||
            tags['addr:city'] ||
            tags['addr:town'] ||
            tags['addr:village'] ||
            tags['addr:district'] ||
            null;
          const state = tags['addr:state'] || null;
          const combined = [street, locality, state].filter(Boolean).join(', ');
          const address = combined || tags['addr:full'] || tags['description'] || null;

          list.push({
            id: `osm-node-${el.id}`,
            name,
            position: pos,
            maxKw: kw,
            connectorCount: Number(tags.capacity) || 2,
            availableCount: null,
            network: detectChargerNetwork(`${name} ${tags.operator || ''} ${tags.network || ''}`),
            address,
            open24h: tags.opening_hours === '24/7' ? true : null,
            alongRouteM: Math.round(d),
            detourM: 0,
            distanceKm: Number((d / 1000.0).toFixed(1)),
          });
        }
      }
    }
  } catch (_) {}

  // 3. Deduplicate chargers within 300 meters
  const deduplicated: NearbyChargerItem[] = [];
  for (const item of list) {
    const existingIdx = deduplicated.findIndex(
      (c) => Geo.distanceM(c.position, item.position) < 300
    );
    if (existingIdx >= 0) {
      if ((item.maxKw || 0) > (deduplicated[existingIdx].maxKw || 0)) {
        deduplicated[existingIdx] = item;
      }
    } else {
      deduplicated.push(item);
    }
  }

  // 4. Sort nearest first
  deduplicated.sort((a, b) => a.distanceKm - b.distanceKm);
  return deduplicated;
}
