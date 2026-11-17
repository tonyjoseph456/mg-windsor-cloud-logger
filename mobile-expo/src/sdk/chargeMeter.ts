import type { ChargeLogRecord, TripRecord } from './models';

export const WINDSOR_PACK_NOMINAL_KWH = 38.0;
export const DEFAULT_AC_EFFICIENCY = 0.88;

export const ANALYTICS_MONTHS_LIST = [
  { num: '01', short: 'Jan', full: 'January' },
  { num: '02', short: 'Feb', full: 'February' },
  { num: '03', short: 'Mar', full: 'March' },
  { num: '04', short: 'Apr', full: 'April' },
  { num: '05', short: 'May', full: 'May' },
  { num: '06', short: 'Jun', full: 'June' },
  { num: '07', short: 'Jul', full: 'July' },
  { num: '08', short: 'Aug', full: 'August' },
  { num: '09', short: 'Sep', full: 'September' },
  { num: '10', short: 'Oct', full: 'October' },
  { num: '11', short: 'Nov', full: 'November' },
  { num: '12', short: 'Dec', full: 'December' },
] as const;

/**
 * Validates external AC meter energy input in kWh.
 * Empty/null clears the value (`null`); accepts `(0, 500]` rounded to 2 decimals.
 */
export function sanitizeMeterEnergyInput(raw: unknown): number | null | 'invalid' {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 500) {
    return 'invalid';
  }
  return Number(n.toFixed(2));
}

/** Returns pack energy added for a session, falling back cleanly to SoC delta * 38 kWh. */
export function getChargePackAddedKwh(c: Pick<ChargeLogRecord, 'energyAddedToPackKwh' | 'startSoc' | 'endSoc'>): number {
  return Number(c.energyAddedToPackKwh) > 0
    ? Number(c.energyAddedToPackKwh)
    : Math.max(0, ((Number(c.endSoc) - Number(c.startSoc)) / 100) * WINDSOR_PACK_NOMINAL_KWH);
}

/** Returns estimated wall energy for a session when no direct wall kWh is stored. */
export function getChargeEstimatedWallKwh(
  c: Pick<ChargeLogRecord, 'energyAddedToPackKwh' | 'energyConsumedKwh' | 'startSoc' | 'endSoc'>
): number {
  const added = getChargePackAddedKwh(c);
  return Number(c.energyConsumedKwh) > 0
    ? Number(c.energyConsumedKwh)
    : Number((added / DEFAULT_AC_EFFICIENCY).toFixed(2));
}

export interface ChargeMeterAnalyticsSummary {
  totalMeterKwh: number;
  meterLoggedCount: number;
  meterLoggedPackKwh: number;
  meterLoggedEstWallKwh: number;
  meterRealLossKwh: number;
  meterRealLossPct: number;
  meterDiffVsEstKwh: number;
}

/**
 * Computes actual external meter totals, real wall-to-pack loss, and variance vs
 * estimated wall energy across sessions that have a logged meter reading.
 */
export function summarizeChargeMeterAnalytics(charges: ChargeLogRecord[]): ChargeMeterAnalyticsSummary {
  let totalMeterKwh = 0;
  let meterLoggedCount = 0;
  let meterLoggedPackKwh = 0;
  let meterLoggedEstWallKwh = 0;

  for (const c of charges) {
    const meter = Number(c.meterEnergyKwh);
    if (!Number.isFinite(meter) || meter <= 0) continue;
    meterLoggedCount += 1;
    totalMeterKwh += meter;
    meterLoggedPackKwh += getChargePackAddedKwh(c);
    meterLoggedEstWallKwh += getChargeEstimatedWallKwh(c);
  }

  const roundedMeter = Number(totalMeterKwh.toFixed(2));
  const roundedPack = Number(meterLoggedPackKwh.toFixed(2));
  const roundedEstWall = Number(meterLoggedEstWallKwh.toFixed(2));
  const realLossKwh =
    meterLoggedCount > 0 ? Math.max(0, Number((roundedMeter - roundedPack).toFixed(2))) : 0;
  const realLossPct =
    roundedMeter > 0 ? Number(((realLossKwh / roundedMeter) * 100).toFixed(1)) : 0;
  const diffVsEstKwh =
    meterLoggedCount > 0 ? Number((roundedMeter - roundedEstWall).toFixed(2)) : 0;

  return {
    totalMeterKwh: roundedMeter,
    meterLoggedCount,
    meterLoggedPackKwh: roundedPack,
    meterLoggedEstWallKwh: roundedEstWall,
    meterRealLossKwh: realLossKwh,
    meterRealLossPct: realLossPct,
    meterDiffVsEstKwh: diffVsEstKwh,
  };
}

export interface AnalyticsPeriodStats extends ChargeMeterAnalyticsSummary {
  tripCount: number;
  totalDistKm: number;
  totalDriveEnergyKwh: number;
  totalDriveDurSec: number;
  avgDriveEff: number;
  totalChargeCount: number;
  totalPackKwh: number;
  totalWallKwh: number;
  totalLossKwh: number;
  count33: number;
  packKwh33: number;
  wallKwh33: number;
  count74: number;
  packKwh74: number;
  wallKwh74: number;
  countDc: number;
  packKwhDc: number;
  wallKwhDc: number;
}

function classifyAnalyticsChargerSpeed(c: ChargeLogRecord): '3.3' | '7.4' | 'dc' {
  const kw = Number(c.maxChargingSpeedKw) || 0;
  const cat = (c.chargerCategory || '').toUpperCase();
  if (kw > 11) return 'dc';
  if (kw > 4.0 && kw <= 11) return '7.4';
  if (kw > 0 && kw <= 4.0) return '3.3';
  if (cat.includes('DC')) return 'dc';
  if (cat.includes('7.4') || cat.includes('7.2')) return '7.4';
  return '3.3';
}

/**
 * Computes combined driving & charging analytics (including external meter energy)
 * for any YYYY- or YYYY-MM prefix shared across both Analytics views.
 */
export function computePeriodAnalyticsStats(params: {
  trips: TripRecord[];
  chargeLogs: ChargeLogRecord[];
  getTripDateKey: (t: TripRecord) => string;
  getChargeDateKey: (c: ChargeLogRecord) => string;
  prefix: string;
  usableBatteryKwh?: number;
}): AnalyticsPeriodStats {
  const { trips, chargeLogs, getTripDateKey, getChargeDateKey, prefix, usableBatteryKwh = 37.3 } = params;
  const mTrips = trips.filter((t) => getTripDateKey(t).startsWith(prefix));
  const mCharges = chargeLogs.filter((c) => getChargeDateKey(c).startsWith(prefix));

  const totalDistKm = Number(
    mTrips.reduce((s, t) => s + (Number(t.distanceKm) || 0), 0).toFixed(1)
  );
  const totalDriveEnergyKwh = Number(
    mTrips
      .reduce((s, t) => {
        const energy =
          Number(t.energyUsedKwh) > 0
            ? Number(t.energyUsedKwh)
            : Math.max(0, ((Number(t.startSoc) - Number(t.endSoc)) / 100) * usableBatteryKwh);
        return s + energy;
      }, 0)
      .toFixed(2)
  );
  const totalDriveDurSec = mTrips.reduce((s, t) => s + (Number(t.durationSeconds) || 0), 0);
  const avgDriveEff =
    totalDistKm > 0 && totalDriveEnergyKwh > 0
      ? Number((totalDistKm / totalDriveEnergyKwh).toFixed(2))
      : 0;

  let count33 = 0;
  let packKwh33 = 0;
  let wallKwh33 = 0;
  let count74 = 0;
  let packKwh74 = 0;
  let wallKwh74 = 0;
  let countDc = 0;
  let packKwhDc = 0;
  let wallKwhDc = 0;

  for (const c of mCharges) {
    const sp = classifyAnalyticsChargerSpeed(c);
    const pk = getChargePackAddedKwh(c);
    const wl = getChargeEstimatedWallKwh(c);
    if (sp === 'dc') {
      countDc += 1;
      packKwhDc += pk;
      wallKwhDc += wl;
    } else if (sp === '7.4') {
      count74 += 1;
      packKwh74 += pk;
      wallKwh74 += wl;
    } else {
      count33 += 1;
      packKwh33 += pk;
      wallKwh33 += wl;
    }
  }

  const totalChargeCount = mCharges.length;
  const totalPackKwh = Number((packKwh33 + packKwh74 + packKwhDc).toFixed(2));
  const totalWallKwh = Number((wallKwh33 + wallKwh74 + wallKwhDc).toFixed(2));
  const totalLossKwh = Math.max(0, Number((totalWallKwh - totalPackKwh).toFixed(2)));
  const meterAnalytics = summarizeChargeMeterAnalytics(mCharges);

  return {
    tripCount: mTrips.length,
    totalDistKm,
    totalDriveEnergyKwh,
    totalDriveDurSec,
    avgDriveEff,
    totalChargeCount,
    totalPackKwh,
    totalWallKwh,
    totalLossKwh,
    ...meterAnalytics,
    count33,
    packKwh33: Number(packKwh33.toFixed(2)),
    wallKwh33: Number(wallKwh33.toFixed(2)),
    count74,
    packKwh74: Number(packKwh74.toFixed(2)),
    wallKwh74: Number(wallKwh74.toFixed(2)),
    countDc,
    packKwhDc: Number(packKwhDc.toFixed(2)),
    wallKwhDc: Number(wallKwhDc.toFixed(2)),
  };
}

/**
 * Applies locally unsynced meter overrides onto fetched D1 charges, automatically
 * pruning overrides once D1 reflects the exact entered/cleared value.
 */
export function mergePendingMeterOverrides(
  charges: ChargeLogRecord[],
  pending: Record<string, number | null>
): { merged: ChargeLogRecord[]; remainingPending: Record<string, number | null>; changedPending: boolean } {
  const keys = Object.keys(pending || {});
  if (keys.length === 0) {
    return { merged: charges, remainingPending: {}, changedPending: false };
  }

  const remainingPending: Record<string, number | null> = { ...pending };
  let changedPending = false;

  const merged = charges.map((c) => {
    const id = String(c.id || '');
    if (!id || !(id in remainingPending)) return c;
    const overrideVal = remainingPending[id];
    const remoteVal =
      c.meterEnergyKwh != null && Number(c.meterEnergyKwh) > 0
        ? Number(Number(c.meterEnergyKwh).toFixed(2))
        : null;

    if (
      (overrideVal === null && remoteVal === null) ||
      (overrideVal !== null && remoteVal !== null && Math.abs(overrideVal - remoteVal) < 0.005)
    ) {
      delete remainingPending[id];
      changedPending = true;
      return c;
    }

    return {
      ...c,
      meterEnergyKwh: overrideVal,
    };
  });

  return { merged, remainingPending, changedPending };
}

function formatChargeDateTimeIst(unixSec: number | null | undefined): string {
  if (!unixSec || unixSec <= 0) return '--';
  const d = new Date(unixSec * 1000);
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Strict validator for charging session records.
 * Discards ghost records with null/missing timestamps, corrupt 0.13% SOC, or zero energy added.
 */
export function isValidChargeRecord(c: any): boolean {
  if (!c || typeof c !== 'object') return false;
  const id = String(c.id || '');
  if (id === 'chg-1793725580' && (!c.startTimestampSec || Number(c.energyAddedToPackKwh || 0) <= 0)) {
    return false;
  }
  const startSec = Number(c.startTimestampSec || 0);
  const startSoc = Number(c.startSoc || 0);
  const endSoc = Number(c.endSoc || 0);
  const energyAdded = Number(c.energyAddedToPackKwh || 0);
  const durSec = Number(c.durationSeconds || 0);
  if (!startSec || startSec < 1704067200) {
    if (!c.startDateTime || c.startDateTime === '--') return false;
  }
  if (endSoc <= 1 && startSoc > 5) return false;
  if (energyAdded <= 0 && (endSoc - startSoc) <= 0.5 && durSec <= 60) {
    if (c.status !== 'charging') return false;
  }
  if (c.endDateTime === 'Charging in progress...' && c.status === 'completed' && energyAdded <= 0) {
    return false;
  }
  return true;
}

/**
 * Deduplicates charging records by ID, odometer, and timestamp.
 * When duplicates or overlapping intervals are found, the record with higher energy
 * added is preserved along with any logged external meter energy reading.
 */
export function deduplicateChargeList(charges: ChargeLogRecord[]): ChargeLogRecord[] {
  if (!charges || !charges.length) return [];
  const valid = charges.filter(isValidChargeRecord);

  valid.sort((a, b) => {
    const timeA = Number(a.startTimestampSec || 0);
    const timeB = Number(b.startTimestampSec || 0);
    if (timeA !== timeB) return timeB - timeA;
    return Number(b.energyAddedToPackKwh || 0) - Number(a.energyAddedToPackKwh || 0);
  });

  const clean: ChargeLogRecord[] = [];
  for (const c of valid) {
    const cId = String(c.id || '');
    const cStartSec = Number(c.startTimestampSec || 0);
    const cEndSec = Number(c.endTimestampSec || cStartSec);
    const cOdo = Number(c.odometerKm || 0);
    const cEndSoc = Number(c.endSoc || 0);
    const cEnergy = Number(c.energyAddedToPackKwh || 0);

    let isDup = false;
    for (let i = 0; i < clean.length; i++) {
      const x = clean[i];
      const xId = String(x.id || '');
      const xStartSec = Number(x.startTimestampSec || 0);
      const xEndSec = Number(x.endTimestampSec || xStartSec);
      const xOdo = Number(x.odometerKm || 0);
      const xEndSoc = Number(x.endSoc || 0);
      const xEnergy = Number(x.energyAddedToPackKwh || 0);

      const pickChargeWinner = (incomingWins: boolean): ChargeLogRecord => {
        const mergedMeter = c.meterEnergyKwh ?? x.meterEnergyKwh ?? null;
        const winner = incomingWins ? c : x;
        return mergedMeter != null && winner.meterEnergyKwh == null
          ? { ...winner, meterEnergyKwh: mergedMeter }
          : winner;
      };

      // 1. Exact ID match
      if (cId && xId && cId === xId) {
        clean[i] = pickChargeWinner(cEnergy > xEnergy);
        isDup = true;
        break;
      }

      // 2. Same session by timestamp (within 15 minutes of start)
      if (cStartSec > 0 && xStartSec > 0 && Math.abs(cStartSec - xStartSec) < 900) {
        clean[i] = pickChargeWinner(cEnergy > xEnergy);
        isDup = true;
        break;
      }

      // 3. Same vehicle odometer (within 0.5 km) and overlapping charge window
      if (cOdo > 0 && xOdo > 0 && Math.abs(cOdo - xOdo) <= 0.5) {
        const timeOverlaps = cStartSec <= xEndSec + 1800 && cEndSec >= xStartSec - 1800;
        const socSimilar = Math.abs(cEndSoc - xEndSoc) <= 2;
        if (timeOverlaps || socSimilar) {
          clean[i] = pickChargeWinner(cEnergy > xEnergy);
          isDup = true;
          break;
        }
      }
    }

    if (!isDup) {
      clean.push(c);
    }
  }
  return clean;
}

/** Maps a raw Cloudflare D1 `charging_sessions` or `charges` row to `ChargeLogRecord`. */
export function mapD1ChargeToRecord(r: any): ChargeLogRecord {
  const startSec = Number(r.start_time ?? r.start_timestamp) || 0;
  const endSec = (r.end_time != null || r.end_timestamp != null) ? Number(r.end_time ?? r.end_timestamp) : null;
  const startDt = startSec ? formatChargeDateTimeIst(startSec) : '';
  const endDt = endSec ? formatChargeDateTimeIst(endSec) : '';
  const startSoc = Number(r.start_soc) || 0;
  const endSoc = Number(r.end_soc) || startSoc;
  const socAdded = Number(r.soc_added) || Math.max(0, endSoc - startSoc);
  const energyAdded = Number(r.kwh_added ?? r.energy_added_kwh) || Number(((socAdded / 100) * 38).toFixed(2));
  const odo = Number(r.start_odometer_km ?? r.odometer_km) || 0;
  const durationSeconds = Number(r.active_duration_seconds ?? r.duration_seconds) || (endSec ? Math.max(0, endSec - startSec) : 0);

  const rawPeak = Number(r.peak_power_kw ?? r.peak_kw);
  const peakKw = Number.isFinite(rawPeak) && rawPeak > 0 ? rawPeak : 0;
  const rawType = String(r.charge_type || r.charger_type || '').toUpperCase();

  let chargerCategory: '3.3 kW AC' | '7.4 kW AC' | 'DC Fast';
  if (peakKw > 11.0) {
    chargerCategory = 'DC Fast';
  } else if (peakKw > 4.0) {
    chargerCategory = '7.4 kW AC';
  } else if (peakKw > 0) {
    chargerCategory = '3.3 kW AC';
  } else if (rawType.includes('DC')) {
    chargerCategory = 'DC Fast';
  } else if (rawType.includes('7.4') || rawType.includes('7.2')) {
    chargerCategory = '7.4 kW AC';
  } else {
    chargerCategory = '3.3 kW AC';
  }

  const effectivePeakKw = peakKw > 0 ? peakKw : (chargerCategory === 'DC Fast' ? 30 : (chargerCategory === '7.4 kW AC' ? 7.4 : 3.3));
  const isDc = chargerCategory === 'DC Fast';
  const effFactor = isDc ? 0.94 : (chargerCategory === '7.4 kW AC' ? 0.905 : 0.885);
  const energyUsed = Number(r.energy_used_kwh) || Number((energyAdded / effFactor).toFixed(2));
  const lossKwh = Number(r.charging_loss_kwh) || Math.max(0, Number((energyUsed - energyAdded).toFixed(2)));
  const lossPct = energyUsed > 0 ? Number(((lossKwh / energyUsed) * 100).toFixed(1)) : (isDc ? 6.0 : (chargerCategory === '7.4 kW AC' ? 9.5 : 11.5));

  const rawEndRange = Number(r.end_range_km) || 0;
  const startRange = Number(r.start_range_km) || 0;
  const validEndRange =
    rawEndRange > 0 && !(endSoc >= 99 && rawEndRange < 250)
      ? Math.round(rawEndRange)
      : startRange > 0 && socAdded <= 1
      ? Math.round(startRange)
      : Math.round((endSoc / 100) * 320);

  const rawLat = r.start_lat ?? r.lat;
  const rawLng = r.start_lng ?? r.lng;
  const lat = rawLat != null && Number(rawLat) !== 0 ? Number(rawLat) : null;
  const lng = rawLng != null && Number(rawLng) !== 0 ? Number(rawLng) : null;
  const location = r.location ? String(r.location) : undefined;

  return {
    id: String(r.id),
    startTimestampSec: startSec,
    endTimestampSec: endSec,
    startDateTime: startDt,
    endDateTime: endDt,
    startSoc,
    endSoc,
    startEnergyKwh: Number(((startSoc / 100) * 38).toFixed(2)),
    endEnergyKwh: Number(((endSoc / 100) * 38).toFixed(2)),
    odometerKm: odo,
    distanceToEmptyAfterKm: validEndRange,
    chargerCategory,
    maxChargingSpeedKw: effectivePeakKw,
    energyAddedToPackKwh: Math.max(0, energyAdded),
    energyConsumedKwh: Math.max(0, energyUsed),
    energyLossPercent: lossPct,
    meterEnergyKwh:
      r.meter_energy_kwh != null && Number(r.meter_energy_kwh) > 0
        ? Number(Number(r.meter_energy_kwh).toFixed(2))
        : null,
    distanceTravelledSinceLastChargeKm: 0,
    energyUsedSinceLastChargeKwh: 0,
    efficiencyKmPerKwh: 0,
    durationSeconds,
    location,
    lat,
    lng,
    status: (r.status === 'ongoing' || r.status === 'paused' || r.status === 'charging') ? 'charging' : 'completed',
  };
}
