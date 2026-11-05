/**
 * MG Windsor EV Cloudflare Background Worker
 * 
 * Features:
 * 1. 1-Tap Background Webhooks for iOS Shortcuts (Lock, Unlock, AC On/Off, Status)
 * 2. 24/7 Automated Trip & Idling Poller for cron-job.org / Cloudflare Cron
 * 3. 12V Auxiliary Battery Voltage Guard (auto-cutoff below 12.2V to prevent 12V drain)
 * 4. Multi-Stop Journey Segmentation & Idling Power Logging
 * 5. Persistent State via Cloudflare KV (or in-worker memory fallback)
 */
import { MgIndiaClient } from '../src/sdk/client';
import { hashControlPin } from '../src/sdk/crypto';

interface Env {
  MG_PHONE: string;
  MG_PASSWORD: string;
  MG_PIN: string;
  MG_VIN?: string;
  WEBHOOK_SECRET?: string;
  // Cloudflare KV Namespace (Optional binding named TRIP_KV)
  TRIP_KV?: {
    get(key: string, type?: 'text' | 'json'): Promise<any>;
    put(key: string, value: string): Promise<void>;
  };
}

// In-worker volatile memory cache (works across cron invocations on the same edge node)
const memCache = new Map<string, string>();

async function storageGet(env: Env, key: string): Promise<string | null> {
  if (env.TRIP_KV) {
    try {
      return await env.TRIP_KV.get(key, 'text');
    } catch (_) {}
  }
  return memCache.get(key) ?? null;
}

async function storagePut(env: Env, key: string, value: string): Promise<void> {
  memCache.set(key, value);
  if (env.TRIP_KV) {
    try {
      await env.TRIP_KV.put(key, value);
    } catch (_) {}
  }
}

export default {
  // HTTP Fetch Handler (Called by iOS Shortcuts, cron-job.org, or Phone App/PWA)
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // OAuth 2.0 Callback endpoint for Google Sign-In (Intercepted by in-app browser)
    if (url.pathname === '/oauth-callback' || url.searchParams.get('action') === 'oauth-callback') {
      const html = `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Connecting to MG Windsor EV...</title>
    <style>
      body { background: #0B132B; color: #38BDF8; font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
      .box { background: #1C2541; padding: 28px; border-radius: 16px; border: 1px solid #3A506B; max-width: 320px; }
      h2 { color: #10B981; margin: 0 0 10px; font-size: 20px; }
      p { color: #94A3B8; font-size: 14px; margin: 0 0 16px; }
      .btn { display: inline-block; padding: 12px 24px; background: #10B981; color: #FFF; border-radius: 10px; text-decoration: none; font-weight: bold; font-size: 14px; }
    </style>
  </head>
  <body>
    <div class="box">
      <h2>✅ Google Authentication Successful!</h2>
      <p>Returning you to the MG Windsor EV app...</p>
      <a id="open-app-btn" class="btn" href="mgismart://google-auth">Open MG Windsor EV App</a>
    </div>
    <script>
      (function() {
        var hash = window.location.hash || window.location.search || '';
        var targetUrl = 'mgismart://google-auth' + hash;
        var btn = document.getElementById('open-app-btn');
        if (btn) btn.href = targetUrl;
        
        // Auto-redirect into native app scheme
        window.location.href = targetUrl;
        setTimeout(function() {
          window.location.replace(targetUrl);
        }, 100);
      })();
    </script>
  </body>
</html>`;
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Optional webhook secret check
    const secret = url.searchParams.get('key');
    if (env.WEBHOOK_SECRET && secret !== env.WEBHOOK_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized webhook key' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const action = url.searchParams.get('action'); // unlock, lock, climate-on, climate-off, status, poll-trip, get-trips, reset-guard

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        },
      });
    }

    if (!action) {
      return new Response(JSON.stringify({
        status: 'online',
        service: 'MG Windsor EV Telematics Cloud Worker',
        actions: [
          '?action=unlock&key=...',
          '?action=lock&key=...',
          '?action=climate-on&key=...',
          '?action=climate-off&key=...',
          '?action=status&key=...',
          '?action=poll-trip&key=... (Triggered every 1-2 min by cron-job.org)',
          '?action=get-trips&key=... (Fetch cloud-logged trips for PWA / Mobile App)',
          '?action=reset-guard&key=... (Reset 12V battery protection lock)'
        ]
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // 1. Check if caller passes their own credentials (for Multi-User support)
    const phone =
      request.headers.get('x-mg-phone') ||
      url.searchParams.get('phone') ||
      env.MG_PHONE;
    const password =
      request.headers.get('x-mg-password') ||
      url.searchParams.get('password') ||
      env.MG_PASSWORD;
    const pin =
      request.headers.get('x-mg-pin') ||
      url.searchParams.get('pin') ||
      env.MG_PIN;
    const vin =
      request.headers.get('x-mg-vin') ||
      url.searchParams.get('vin') ||
      env.MG_VIN ||
      undefined;

    // Reset 12V Battery Guard Action
    if (action === 'reset-guard') {
      await storagePut(env, 'battery_guard_cutoff_until', '0');
      return new Response(JSON.stringify({ success: true, message: '12V Battery Guard reset successfully' }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Read saved trips & charging history endpoint
    if (action === 'get-trips') {
      const rawTrips = await storageGet(env, 'cloud_trips_history');
      const trips = rawTrips ? JSON.parse(rawTrips) : [];
      const activeRaw = await storageGet(env, 'active_trip_state');
      const active = activeRaw ? JSON.parse(activeRaw) : null;

      const rawCharges = await storageGet(env, 'cloud_charging_history');
      const charges = rawCharges ? JSON.parse(rawCharges) : [];
      const activeChargeRaw = await storageGet(env, 'active_charge_state');
      const activeCharge = activeChargeRaw ? JSON.parse(activeChargeRaw) : null;

      return new Response(JSON.stringify({
        success: true,
        trips,
        activeTrip: active,
        charges,
        activeCharge,
        tripCount: trips.length,
        chargeCount: charges.length,
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (!phone || !password || !pin) {
      return new Response(JSON.stringify({ error: 'Missing phone, password, or pin.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // -------------------------------------------------------------
    // 2. CHECK 12V AUXILIARY BATTERY GUARD BEFORE CALLING MG API
    // -------------------------------------------------------------
    const nowSec = Math.floor(Date.now() / 1000);
    const guardUntilStr = await storageGet(env, 'battery_guard_cutoff_until');
    const guardUntilSec = guardUntilStr ? parseInt(guardUntilStr, 10) : 0;

    if (action === 'poll-trip' && guardUntilSec > nowSec) {
      const remainingMin = Math.ceil((guardUntilSec - nowSec) / 60);
      return new Response(JSON.stringify({
        status: 'low_battery_guard_active',
        message: `12V battery guard is active. Polling suspended for ${remainingMin} more minutes to protect vehicle battery. 0 requests sent to car.`,
        remainingMinutes: remainingMin
      }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    try {
      const client = new MgIndiaClient({
        phone,
        password,
        vin,
        pinHash: hashControlPin(pin),
      });

      await client.login();
      if (!client.vin) {
        await client.vehicles();
      }

      // Quick Remote Actions (iOS Shortcut 1-Tap controls)
      if (action === 'unlock') {
        await client.controlDoorLock(false);
        return new Response(JSON.stringify({ success: true, message: 'Doors unlocked successfully' }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      if (action === 'lock') {
        await client.controlDoorLock(true);
        return new Response(JSON.stringify({ success: true, message: 'Doors locked successfully' }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      if (action === 'climate-on') {
        await client.controlClimate(true);
        return new Response(JSON.stringify({ success: true, message: 'Climate AC turned on' }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      if (action === 'climate-off') {
        await client.controlClimate(false);
        return new Response(JSON.stringify({ success: true, message: 'Climate AC turned off' }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      // Live Telematics Snapshot
      const snap = await client.snapshot(true);
      const st = snap.status;
      const ch = st?.charge;

      // Extract 12V Auxiliary Battery Voltage
      const rawBasic = st?.raw?.basicVehicleStatus || st?.raw || {};
      const auxVoltage = typeof rawBasic.batteryVoltage === 'number' && rawBasic.batteryVoltage > 0
        ? Number((rawBasic.batteryVoltage / 10).toFixed(1))
        : 12.6;

      // -------------------------------------------------------------
      // 3. 12V BATTERY AUTO-CUTOFF SAFETY CHECK
      // If voltage drops below 12.2V, halt polling for 4 hours
      // -------------------------------------------------------------
      const BATTERY_CUTOFF_THRESHOLD = 12.2;
      if (auxVoltage < BATTERY_CUTOFF_THRESHOLD && !ch?.is_charging) {
        const lockoutDurationSec = 4 * 3600; // 4 hours cooldown
        await storagePut(env, 'battery_guard_cutoff_until', String(nowSec + lockoutDurationSec));
        return new Response(JSON.stringify({
          status: 'low_battery_guard_triggered',
          auxVoltage,
          message: `12V battery voltage dropped to ${auxVoltage}V (below ${BATTERY_CUTOFF_THRESHOLD}V). Polling suspended for 4 hours to prevent battery discharge.`,
          lockoutUntilSec: nowSec + lockoutDurationSec
        }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      // Status query
      if (action === 'status') {
        const soc = ch?.soc ?? st?.fuel_level ?? 0;
        const range = ch?.range_km ?? st?.range_km ?? 0;
        return new Response(JSON.stringify({
          soc,
          rangeKm: range,
          auxBatteryVoltage: auxVoltage,
          locked: st?.locked,
          climateRunning: st?.climate_running,
          powerMode: st?.power_mode_raw
        }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      // -------------------------------------------------------------
      // 4. CRON TRIP & CHARGING LOGGING ENGINE
      // -------------------------------------------------------------
      if (action === 'poll-trip') {
        const currentSoc = ch?.soc ?? st?.fuel_level ?? 0;
        const usableCap = ch?.total_battery_capacity_kwh && ch.total_battery_capacity_kwh > 10
          ? ch.total_battery_capacity_kwh
          : 37.3;
        const currentEnergyKwh = ch?.battery_energy_kwh && ch.battery_energy_kwh > 0
          ? ch.battery_energy_kwh
          : Number(((currentSoc / 100) * usableCap).toFixed(2));
        const currentOdo = ch?.odometer_km ?? st?.odometer_km ?? 0;
        const currentSpeed = st?.gps?.speed_kmh ?? 0;
        const currentLat = st?.gps?.latitude ?? null;
        const currentLng = st?.gps?.longitude ?? null;

        // -----------------------------------------------------------
        // 4A: CHARGING AUTO-DETECTION & LOGGING (24/7 Background)
        // -----------------------------------------------------------
        const isChargingNow = Boolean(ch && ch.is_charging);
        const activeChargeRaw = await storageGet(env, 'active_charge_state');
        let activeCharge = activeChargeRaw ? JSON.parse(activeChargeRaw) : null;

        const liveKw =
          ch?.charging_current && ch?.charging_voltage
            ? Number(((ch.charging_voltage * ch.charging_current) / 1000).toFixed(2))
            : 0;

        if (isChargingNow) {
          if (!activeCharge) {
            activeCharge = {
              id: `chg-${nowSec}`,
              startTimestampSec: nowSec,
              startDateTime: new Date(nowSec * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
              startSoc: currentSoc,
              endSoc: currentSoc,
              startEnergyKwh: currentEnergyKwh,
              endEnergyKwh: currentEnergyKwh,
              maxKw: liveKw,
              liveKw,
              voltage: ch?.charging_voltage,
              current: ch?.charging_current,
              odometerKm: currentOdo,
              // BMS freezes these at plug-in = the driving cycle that just ended
              cycleDistanceKm: ch?.distance_since_last_charge_km ?? 0,
              cycleEnergyKwh: ch?.power_usage_since_last_charge_kwh ?? 0,
              status: 'charging'
            };
          } else {
            activeCharge.notChargingSinceSec = 0;
            activeCharge.endSoc = Math.max(activeCharge.endSoc, currentSoc);
            activeCharge.endEnergyKwh = Math.max(activeCharge.endEnergyKwh, currentEnergyKwh);
            activeCharge.maxKw = Math.max(activeCharge.maxKw || 0, liveKw);
            activeCharge.liveKw = liveKw;
            activeCharge.lastSampleSec = nowSec;
          }
          await storagePut(env, 'active_charge_state', JSON.stringify(activeCharge));
        } else if (activeCharge && !activeCharge.notChargingSinceSec) {
          // First poll without charging: remember WHEN it stopped, but wait before closing the
          // session - the BMS briefly reports "not charging" mid-session, which used to split one
          // charge into several short sessions.
          activeCharge.notChargingSinceSec = nowSec;
          await storagePut(env, 'active_charge_state', JSON.stringify(activeCharge));
        } else if (activeCharge && nowSec - activeCharge.notChargingSinceSec >= 300) {
          // Charging really finished or was interrupted (power lost / full / unplugged)
          const endSec = activeCharge.notChargingSinceSec; // real stop time
          const durSec = Math.max(60, endSec - activeCharge.startTimestampSec);
          const durStr = `${Math.floor(durSec / 3600)}h ${Math.floor((durSec % 3600) / 60)}m`;
          const finalSoc = Math.max(activeCharge.endSoc, currentSoc);
          const finalEnergy = Math.max(activeCharge.endEnergyKwh, currentEnergyKwh);
          const addedPackKwh = Math.max(0, Number((finalEnergy - activeCharge.startEnergyKwh).toFixed(2)));
          const maxKw = activeCharge.maxKw || 0;
          const chargerCat = maxKw > 22 ? 'DC Fast' : maxKw > 4 ? '7.4 kW AC' : '3.3 kW AC';
          const lossPct = chargerCat === 'DC Fast' ? 7 : chargerCat === '7.4 kW AC' ? 10 : 13;
          const consumedWallKwh = Number((addedPackKwh / (1 - lossPct / 100)).toFixed(2));

          const completionStatus =
            finalSoc >= 99
              ? 'Full (100% Complete)'
              : `Stopped at ${finalSoc.toFixed(0)}% (Power Lost / Unplugged)`;

          let cycleKm = Number(activeCharge.cycleDistanceKm || 0);
          let cycleKwh = Number(activeCharge.cycleEnergyKwh || 0);
          const finalRange = ch?.range_km ?? st?.range_km ?? (finalSoc > 0 ? Math.round((finalSoc / 100) * 320) : 320);
          const completedChargeRecord = {
            id: activeCharge.id,
            startTimestampSec: activeCharge.startTimestampSec,
            endTimestampSec: endSec,
            startDateTime: activeCharge.startDateTime,
            endDateTime: new Date(endSec * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            durationSeconds: durSec,
            durationFormatted: durStr,
            startSoc: activeCharge.startSoc,
            endSoc: finalSoc,
            energyAddedToPackKwh: addedPackKwh,
            energyConsumedKwh: consumedWallKwh,
            energyLossPercent: lossPct,
            chargerCategory: chargerCat,
            maxChargingSpeedKw: maxKw,
            completionStatus,
            odometerKm: currentOdo,
            distanceToEmptyAfterKm: finalRange > 0 ? finalRange : Math.round((finalSoc / 100) * 320),
            rangeKm: finalRange > 0 ? finalRange : Math.round((finalSoc / 100) * 320),
            // Driving done BEFORE this charge (since the previous charge)
            distanceTravelledSinceLastChargeKm: cycleKm,
            energyUsedSinceLastChargeKwh: cycleKwh,
            efficiencyKmPerKwh: cycleKm > 0 && cycleKwh > 0 ? Number((cycleKm / cycleKwh).toFixed(2)) : 0,
            status: 'completed'
          };

          const rawHistory = await storageGet(env, 'cloud_charging_history');
          const chargeHistory = rawHistory ? JSON.parse(rawHistory) : [];
          chargeHistory.unshift(completedChargeRecord);
          if (chargeHistory.length > 200) chargeHistory.length = 200;
          await storagePut(env, 'cloud_charging_history', JSON.stringify(chargeHistory));
          await storagePut(env, 'active_charge_state', '');
        }

        // -----------------------------------------------------------
        // 4B: DRIVING TRIP LOGGING ENGINE
        // -----------------------------------------------------------
        // Is vehicle ON / driving / idling?
        const isDrivingOrReady =
          !ch?.is_charging &&
          (st?.engine_status_raw === 1 ||
            ((st?.power_mode_raw ?? 0) > 0) ||
            currentSpeed > 0.5);

        // Load active ongoing trip state
        const activeTripRaw = await storageGet(env, 'active_trip_state');
        let activeTrip = activeTripRaw ? JSON.parse(activeTripRaw) : null;

        // CASE A: Vehicle is driving or idling (Ignition ON)
        if (isDrivingOrReady) {
          if (!activeTrip) {
            // Start of a brand new trip!
            activeTrip = {
              id: `trip-${nowSec}`,
              startTimestampSec: nowSec,
              lastSampleTimeSec: nowSec,
              startSoc: currentSoc,
              endSoc: currentSoc,
              startEnergyKwh: currentEnergyKwh,
              endEnergyKwh: currentEnergyKwh,
              startOdometerKm: currentOdo,
              endOdometerKm: currentOdo,
              distanceKm: 0,
              durationSeconds: 0,
              idleDurationSeconds: 0,
              idleEnergyKwh: 0,
              maxSpeedKmh: currentSpeed,
              startLat: currentLat,
              startLng: currentLng,
              endLat: currentLat,
              endLng: currentLng,
              startCabinTempC: st?.interior_temperature ?? null,
              endCabinTempC: st?.interior_temperature ?? null,
              startExteriorTempC: st?.exterior_temperature ?? null,
              endExteriorTempC: st?.exterior_temperature ?? null,
              climateRunning: st?.climate_running ?? false
            };
          } else {
            // Update ongoing trip
            const dtSec = Math.max(0, nowSec - (activeTrip.lastSampleTimeSec || nowSec));
            const odoDelta = Math.max(0, currentOdo - activeTrip.endOdometerKm);

            // IDLING DETECTION: Vehicle ON, speed < 0.5 km/h, odometer unchanged
            const isIdling = currentSpeed < 0.5 && odoDelta < 0.05 && dtSec > 0 && dtSec < 600;
            if (isIdling) {
              activeTrip.idleDurationSeconds += dtSec;
              // Auxiliary draw: ~0.65 kW if AC running, ~0.25 kW if baseline electronics
              const idleKw = st?.climate_running ? 0.65 : 0.25;
              activeTrip.idleEnergyKwh = Number(
                (activeTrip.idleEnergyKwh + (idleKw * dtSec) / 3600).toFixed(3)
              );
            }

            activeTrip.endSoc = currentSoc;
            activeTrip.endEnergyKwh = currentEnergyKwh;
            activeTrip.endOdometerKm = currentOdo;
            activeTrip.distanceKm = Number((currentOdo - activeTrip.startOdometerKm).toFixed(1));
            activeTrip.durationSeconds = Math.max(0, nowSec - activeTrip.startTimestampSec);
            activeTrip.maxSpeedKmh = Math.max(activeTrip.maxSpeedKmh, currentSpeed);
            activeTrip.endLat = currentLat ?? activeTrip.endLat;
            activeTrip.endLng = currentLng ?? activeTrip.endLng;
            activeTrip.endCabinTempC = st?.interior_temperature ?? activeTrip.endCabinTempC;
            activeTrip.endExteriorTempC = st?.exterior_temperature ?? activeTrip.endExteriorTempC;
            activeTrip.lastSampleTimeSec = nowSec;
          }

          await storagePut(env, 'active_trip_state', JSON.stringify(activeTrip));

          return new Response(JSON.stringify({
            status: 'driving_active',
            activeTrip: {
              durationMin: Math.round(activeTrip.durationSeconds / 60),
              distanceKm: activeTrip.distanceKm,
              idleMinutes: Math.round(activeTrip.idleDurationSeconds / 60),
              idleEnergyKwh: activeTrip.idleEnergyKwh,
              currentSpeed,
              auxVoltage
            }
          }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }

        // CASE B: Vehicle is PARKED (Ignition OFF)
        if (activeTrip) {
          // A trip was previously in progress and the car just parked! Finalize trip!
          const distKm = Number((currentOdo - activeTrip.startOdometerKm).toFixed(1));
          const durSec = Math.max(60, nowSec - activeTrip.startTimestampSec);
          const usedKwh = Math.max(0, Number((activeTrip.startEnergyKwh - currentEnergyKwh).toFixed(2)));
          const eff = usedKwh > 0 && distKm > 0 ? Number((distKm / usedKwh).toFixed(2)) : 0;
          const avgSpd = durSec > 0 && distKm > 0 ? Number((distKm / (durSec / 3600)).toFixed(1)) : 0;

          const completedRecord = {
            id: activeTrip.id,
            startTimestampSec: activeTrip.startTimestampSec,
            endTimestampSec: nowSec,
            startDateTime: new Date(activeTrip.startTimestampSec * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            endDateTime: new Date(nowSec * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            startSoc: activeTrip.startSoc,
            endSoc: currentSoc,
            startEnergyKwh: activeTrip.startEnergyKwh,
            endEnergyKwh: currentEnergyKwh,
            durationSeconds: durSec,
            distanceKm: distKm,
            startOdometerKm: activeTrip.startOdometerKm,
            endOdometerKm: currentOdo,
            energyUsedKwh: usedKwh,
            efficiencyKmPerKwh: eff,
            idleDurationSeconds: activeTrip.idleDurationSeconds,
            idleEnergyKwh: Number(activeTrip.idleEnergyKwh.toFixed(2)),
            maxSpeedKmh: activeTrip.maxSpeedKmh,
            avgSpeedKmh: avgSpd,
            startCabinTempC: activeTrip.startCabinTempC,
            endCabinTempC: st?.interior_temperature ?? activeTrip.endCabinTempC,
            startExteriorTempC: activeTrip.startExteriorTempC,
            endExteriorTempC: st?.exterior_temperature ?? activeTrip.endExteriorTempC,
            startLat: activeTrip.startLat,
            startLng: activeTrip.startLng,
            endLat: currentLat,
            endLng: currentLng,
            status: 'completed'
          };

          // Save to completed trips history (skip GPS-jitter "trips": engine on, car not moved)
          const historyRaw = await storageGet(env, 'cloud_trips_history');
          const history = historyRaw ? JSON.parse(historyRaw) : [];
          if (distKm >= 0.2) {
            history.unshift(completedRecord);
          }
          // Keep up to 200 trips
          if (history.length > 200) history.length = 200;
          await storagePut(env, 'cloud_trips_history', JSON.stringify(history));

          // Clear active trip
          await storagePut(env, 'active_trip_state', '');

          return new Response(JSON.stringify({
            status: 'trip_completed_and_saved',
            trip: completedRecord
          }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }

        // Vehicle is parked and no trip was active
        return new Response(JSON.stringify({
          status: 'vehicle_parked',
          message: 'Vehicle is parked and ignition is OFF. No active trip.',
          auxVoltage,
          soc: currentSoc,
          odometerKm: currentOdo
        }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: (err as Error).message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
  },

  // Native Cloudflare Cron Trigger (Runs automatically if scheduled in wrangler or dashboard)
  async scheduled(event: any, env: Env): Promise<void> {
    const fakeRequest = new Request('https://worker.internal/?action=poll-trip', {
      headers: { 'Content-Type': 'application/json' }
    });
    await this.fetch(fakeRequest, env);
  }
};
