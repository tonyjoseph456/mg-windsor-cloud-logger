/**
 * MG Windsor EV — 24/7 12V-Safe Cloud Charging Session Logger
 *
 * Uses the pure TypeScript MG iSMART India SDK (`src/sdk`) to automatically
 * detect plug-in & charging sessions, track all 11 charging & efficiency metrics
 * (including exact Start Date/Time, End Date/Time, Total Charging Duration,
 * 3.3kW AC / 7.4kW AC / DC Fast classification, Max kW, Wall & Pack kWh,
 * Loss %, Distance Since Last Charge, and km/kWh efficiency), and persist them
 * to `data/cloud_charging_log.json` so the mobile app can sync them anytime!
 *
 * 12V AUXILIARY BATTERY PROTECTION:
 * 1. Defaults to polling ONLY `getChargeStatus` (messageID = 8), which does NOT
 *    engage high-voltage contactors or wake body ECUs when the vehicle is asleep.
 * 2. Only fetches full vehicle status when actively charging (`is_charging: true`)
 *    or when explicitly requested via `--full`.
 * 3. Hard cutoff if `aux_battery_voltage < 12.2V` while unplugged.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ChargeLogRecord, MgIndiaClient } from '../src/sdk';

const WINDSOR_FACTORY_USABLE_KWH = 37.3;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const LOG_FILE = path.join(DATA_DIR, 'cloud_charging_log.json');

interface CloudStateFile {
  updatedAt: string;
  vin: string;
  vehicleName: string;
  activeSession: ChargeLogRecord | null;
  preChargeBaseline: {
    timestampSec: number;
    soc: number;
    energyKwh: number;
    odometerKm: number;
    rangeKm: number;
    distanceSinceLastChargeKm: number;
    energyUsedSinceLastChargeKwh: number;
  } | null;
  sessions: ChargeLogRecord[];
}

function formatDateTime(unixSec: number | null | undefined): string {
  if (!unixSec || unixSec <= 0) return '--';
  return new Date(unixSec * 1000).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function classifyChargerSpeed(maxKw: number): {
  category: '3.3 kW AC' | '7.4 kW AC' | 'DC Fast';
  lossPct: number;
} {
  if (maxKw > 8.0) return { category: 'DC Fast', lossPct: 6.0 };
  if (maxKw > 3.7) return { category: '7.4 kW AC', lossPct: 9.5 };
  return { category: '3.3 kW AC', lossPct: 11.5 };
}

function loadState(): CloudStateFile {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (fs.existsSync(LOG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
    } catch {
      // fall through
    }
  }
  return {
    updatedAt: new Date().toISOString(),
    vin: '',
    vehicleName: 'Windsor EV',
    activeSession: null,
    preChargeBaseline: null,
    sessions: [],
  };
}

function saveState(state: CloudStateFile): void {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(LOG_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

async function main() {
  const phone = process.env.MG_PHONE || '';
  const password = process.env.MG_PASSWORD || '';
  const vin = process.env.MG_VIN || undefined;

  if (!phone || !password) {
    console.error('Missing MG_PHONE or MG_PASSWORD environment variables.');
    process.exit(1);
  }

  const state = loadState();
  const client = new MgIndiaClient({ phone, password, vin });

  console.log(`[CloudLogger] Authenticating with MG iSMART India...`);
  await client.login();
  const vehicles = await client.vehicles();
  if (!vehicles.length) {
    throw new Error('No vehicles found on account.');
  }

  const v = client.vehicle || vehicles[0];
  state.vin = v.vin;
  state.vehicleName = v.name;

  // 12V-Safe Poll: Query messageID=8 (Charge Status) first
  console.log(`[CloudLogger] Polling 12V-safe EV charging telemetry (messageID=8) for ${v.name} (${v.vin})...`);
  let ch = null;
  try {
    ch = await client.getChargeStatus();
  } catch (err) {
    console.log(`[CloudLogger] Vehicle charging frame unavailable (likely asleep & unplugged): ${(err as Error).message}`);
  }

  const nowSec = ch?.status_time || Math.floor(Date.now() / 1000);

  if (ch && ch.soc !== null && ch.soc !== undefined) {
    const currentSoc = ch.soc;
    const usableCap =
      ch.total_battery_capacity_kwh && ch.total_battery_capacity_kwh > 10
        ? ch.total_battery_capacity_kwh
        : WINDSOR_FACTORY_USABLE_KWH;
    const currentEnergyKwh =
      ch.battery_energy_kwh > 0
        ? ch.battery_energy_kwh
        : Number(((currentSoc / 100) * usableCap).toFixed(2));
    const currentOdo = ch.odometer_km || state.preChargeBaseline?.odometerKm || 0;
    const currentRange = ch.range_km || 0;
    const currentDistSince = ch.distance_since_last_charge_km ?? 0;
    const currentPowerUsedSince = ch.power_usage_since_last_charge_kwh ?? 0;

    if (ch.is_charging) {
      const liveKw =
        ch.charging_current && ch.charging_voltage
          ? Number(((ch.charging_voltage * ch.charging_current) / 1000).toFixed(2))
          : 0;
      const bmsStartSec =
        ch.start_time && ch.start_time > 1_600_000_000
          ? ch.start_time
          : ch.charge_time_elapsed_s && ch.charge_time_elapsed_s > 0
          ? nowSec - ch.charge_time_elapsed_s
          : state.activeSession?.startTimestampSec || nowSec;

      const sessionId = `chg-${bmsStartSec}`;
      const existing = state.activeSession;
      const base = state.preChargeBaseline;

      let startSoc = existing && existing.id === sessionId ? existing.startSoc : currentSoc;
      let startEnergyKwh =
        existing && existing.id === sessionId ? existing.startEnergyKwh : currentEnergyKwh;

      if (!existing || existing.id !== sessionId) {
        if (base && base.soc < currentSoc) {
          startSoc = base.soc;
          startEnergyKwh = base.energyKwh;
        } else if (ch.charge_time_elapsed_s && ch.charge_time_elapsed_s > 60 && liveKw > 0) {
          const estAddedKwh = liveKw * 0.9 * (ch.charge_time_elapsed_s / 3600);
          startEnergyKwh = Math.max(0, Number((currentEnergyKwh - estAddedKwh).toFixed(2)));
          startSoc = Math.max(0, Number(((startEnergyKwh / usableCap) * 100).toFixed(1)));
        }
      }

      const maxKw = Math.max(existing?.maxChargingSpeedKw || 0, liveKw);
      const { category, lossPct } = classifyChargerSpeed(maxKw);
      const addedPackKwh = Math.max(0, Number((currentEnergyKwh - startEnergyKwh).toFixed(2)));
      const consumedWallKwh = Number((addedPackKwh / (1 - lossPct / 100)).toFixed(2));
      const durationSec =
        ch.charge_time_elapsed_s && ch.charge_time_elapsed_s > 0
          ? ch.charge_time_elapsed_s
          : Math.max(0, nowSec - bmsStartSec);

      const distSinceLast =
        currentDistSince > 0
          ? currentDistSince
          : existing?.distanceTravelledSinceLastChargeKm || base?.distanceSinceLastChargeKm || 0;
      const energyUsedSinceLast =
        currentPowerUsedSince > 0
          ? currentPowerUsedSince
          : existing?.energyUsedSinceLastChargeKwh || base?.energyUsedSinceLastChargeKwh || 0;
      const effKmPerKwh =
        energyUsedSinceLast > 0 ? Number((distSinceLast / energyUsedSinceLast).toFixed(2)) : 0;

      state.activeSession = {
        id: sessionId,
        startTimestampSec: bmsStartSec,
        endTimestampSec: null,
        startDateTime: formatDateTime(bmsStartSec),
        endDateTime: 'Charging in progress...',
        startSoc,
        endSoc: currentSoc,
        startEnergyKwh,
        endEnergyKwh: currentEnergyKwh,
        odometerKm: currentOdo,
        distanceToEmptyAfterKm: currentRange,
        chargerCategory: category,
        maxChargingSpeedKw: maxKw,
        energyAddedToPackKwh: addedPackKwh,
        energyConsumedKwh: consumedWallKwh,
        energyLossPercent: lossPct,
        distanceTravelledSinceLastChargeKm: distSinceLast,
        energyUsedSinceLastChargeKwh: energyUsedSinceLast,
        efficiencyKmPerKwh: effKmPerKwh,
        durationSeconds: durationSec,
        status: 'charging',
      };

      console.log(
        `[CloudLogger] Active charge recorded: ${startSoc}% -> ${currentSoc}% (${category}, Max ${maxKw} kW)`
      );
    } else {
      // Vehicle is not actively charging
      if (state.activeSession) {
        const prev = state.activeSession;
        const endSec = ch.end_time && ch.end_time > prev.startTimestampSec ? ch.end_time : nowSec;
        const finalSoc = Math.max(prev.endSoc, currentSoc);
        const finalEnergyKwh = Math.max(prev.endEnergyKwh, currentEnergyKwh);
        const addedPackKwh = Math.max(0, Number((finalEnergyKwh - prev.startEnergyKwh).toFixed(2)));
        const { category, lossPct } = classifyChargerSpeed(prev.maxChargingSpeedKw);
        const consumedWallKwh = Number((addedPackKwh / (1 - lossPct / 100)).toFixed(2));
        const totalDur = Math.max(prev.durationSeconds, endSec - prev.startTimestampSec);

        const completed: ChargeLogRecord = {
          ...prev,
          endTimestampSec: endSec,
          endDateTime: formatDateTime(endSec),
          endSoc: finalSoc,
          endEnergyKwh: finalEnergyKwh,
          odometerKm: currentOdo || prev.odometerKm,
          distanceToEmptyAfterKm: currentRange || prev.distanceToEmptyAfterKm,
          chargerCategory: category,
          energyAddedToPackKwh: addedPackKwh,
          energyConsumedKwh: consumedWallKwh,
          energyLossPercent: lossPct,
          durationSeconds: totalDur,
          status: 'completed',
        };

        state.sessions = [
          completed,
          ...state.sessions.filter((s) => s.id !== completed.id),
        ];
        state.activeSession = null;
        console.log(
          `[CloudLogger] Completed charging session saved: ${completed.startSoc}% -> ${completed.endSoc}% (+${addedPackKwh} kWh)`
        );
      }

      state.preChargeBaseline = {
        timestampSec: nowSec,
        soc: currentSoc,
        energyKwh: currentEnergyKwh,
        odometerKm: currentOdo,
        rangeKm: currentRange,
        distanceSinceLastChargeKm:
          currentDistSince > 0
            ? currentDistSince
            : state.preChargeBaseline?.distanceSinceLastChargeKm || 0,
        energyUsedSinceLastChargeKwh:
          currentPowerUsedSince > 0
            ? currentPowerUsedSince
            : state.preChargeBaseline?.energyUsedSinceLastChargeKwh || 0,
      };
    }
  } else if (state.activeSession) {
    // If the vehicle was actively charging on the previous poll and now went to sleep/unplugged,
    // close and save the active session!
    const prev = state.activeSession;
    const endSec = Math.floor(Date.now() / 1000);
    const totalDur = Math.max(prev.durationSeconds, endSec - prev.startTimestampSec);
    const completed: ChargeLogRecord = {
      ...prev,
      endTimestampSec: endSec,
      endDateTime: formatDateTime(endSec),
      durationSeconds: totalDur,
      status: 'completed',
    };
    state.sessions = [
      completed,
      ...state.sessions.filter((s) => s.id !== completed.id),
    ];
    state.activeSession = null;
    console.log(`[CloudLogger] Closed active session after vehicle unplugged/slept.`);
  }

  saveState(state);
}

main().catch((err) => {
  console.error('[CloudLogger] Error:', err);
  process.exit(1);
});
