import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Battery,
  BatteryCharging,
  Car,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Compass,
  Cpu,
  Flame,
  Gauge,
  History,
  KeyRound,
  Lock,
  MapPin,
  Navigation,
  Power,
  Radio,
  RefreshCw,
  Satellite,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  Thermometer,
  Unlock,
  Volume2,
  Wifi,
  Wind,
  Zap,
} from 'lucide-react';
import {
  ChargeLogRecord,
  GpsStatus,
  hashControlPin,
  MgIndiaClient,
  Snapshot,
  Status,
  TripRecord,
  Vehicle,
} from './sdk';
import {
  createDemoSnapshot,
  DEMO_VEHICLES,
  INITIAL_CHARGE_HISTORY,
  INITIAL_TRIP_HISTORY,
} from './sdk/simulator';

type TabId = 'dashboard' | 'charging' | 'controls' | 'location' | 'history' | 'settings';

interface SavedConfig {
  mode: 'demo' | 'live';
  phone: string;
  password: string;
  vin: string;
  pin: string;
  proxyUrl: string;
  demoVehicleIdx: number;
}

const DEFAULT_CONFIG: SavedConfig = {
  mode: 'demo',
  phone: '',
  password: '',
  vin: '',
  pin: '1234',
  proxyUrl: 'http://localhost:8787',
  demoVehicleIdx: 0,
};

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [config, setConfig] = useState<SavedConfig>(() => {
    try {
      const saved = localStorage.getItem('mg_ismart_config');
      return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
    } catch {
      return DEFAULT_CONFIG;
    }
  });

  const [snapshot, setSnapshot] = useState<Snapshot>(() =>
    createDemoSnapshot(config.demoVehicleIdx)
  );
  const [availableVehicles, setAvailableVehicles] = useState<Vehicle[]>(DEMO_VEHICLES);
  const [trips, setTrips] = useState<TripRecord[]>(INITIAL_TRIP_HISTORY);
  const [chargeLogs, setChargeLogs] = useState<ChargeLogRecord[]>(INITIAL_CHARGE_HISTORY);

  const [isPolling, setIsPolling] = useState(false);
  const [activeCommand, setActiveCommand] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(
    null
  );
  const [pinModal, setPinModal] = useState<{
    open: boolean;
    label: string;
    onConfirm: (pin: string) => void;
  } | null>(null);
  const [enteredPin, setEnteredPin] = useState('');

  const clientRef = useRef<MgIndiaClient | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('mg_ismart_config', JSON.stringify(config));
    } catch {
      // Ignore storage errors
    }
  }, [config]);

  const showToast = (type: 'success' | 'error' | 'info', text: string) => {
    setToast({ type, text });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 4000);
  };

  // Live charging simulation ticker when in Demo mode & charging
  useEffect(() => {
    if (config.mode !== 'demo') return;
    const timer = setInterval(() => {
      setSnapshot((prev) => {
        const chg = prev.status.charge;
        if (!chg || !chg.is_charging) return prev;
        const voltageJitter = Number(
          (383.5 + Math.sin(Date.now() / 3000) * 1.25).toFixed(2)
        );
        const currentJitter = Number(
          (16.6 + Math.cos(Date.now() / 2500) * 0.4).toFixed(1)
        );
        return {
          ...prev,
          status: {
            ...prev.status,
            charge: {
              ...chg,
              charging_voltage: voltageJitter,
              charging_current: currentJitter,
              charge_time_elapsed_s: (chg.charge_time_elapsed_s || 0) + 2,
            },
          },
        };
      });
    }, 2000);
    return () => clearInterval(timer);
  }, [config.mode]);

  const refreshTelemetry = async (includeCharge = true) => {
    setIsPolling(true);
    try {
      if (config.mode === 'demo') {
        await new Promise((r) => setTimeout(r, 650));
        const now = Math.floor(Date.now() / 1000);
        setSnapshot((prev) => ({
          ...prev,
          status: {
            ...prev.status,
            status_time: now,
            charge: prev.status.charge
              ? { ...prev.status.charge, status_time: now }
              : null,
          },
        }));
        showToast('success', 'Telemetry synced (Simulator Mode)');
      } else {
        if (!config.phone || !config.password) {
          showToast('error', 'Enter your MG India phone & password in Settings first');
          setActiveTab('settings');
          return;
        }
        const pinHash = /^\d{4}$/.test(config.pin) ? hashControlPin(config.pin) : undefined;
        const client = new MgIndiaClient({
          phone: config.phone,
          password: config.password,
          vin: config.vin || undefined,
          pinHash,
          proxyBaseUrl: config.proxyUrl || undefined,
        });
        clientRef.current = client;
        const vehicles = await client.vehicles();
        setAvailableVehicles(vehicles);
        const snap = await client.snapshot(includeCharge);
        setSnapshot(snap);
        if (!config.vin && snap.vehicle.vin) {
          setConfig((c) => ({ ...c, vin: snap.vehicle.vin }));
        }
        showToast('success', `Live telemetry received from ${snap.vehicle.name}`);
      }
    } catch (err) {
      showToast('error', (err as Error).message || 'Failed to poll MG India TAP server');
    } finally {
      setIsPolling(false);
    }
  };

  const executeRemoteControl = async (
    label: string,
    demoMutator: (prev: Status) => Status,
    liveRunner: (client: MgIndiaClient) => Promise<void>
  ) => {
    const runWithPin = async (pinToUse: string) => {
      setActiveCommand(label);
      try {
        if (config.mode === 'demo') {
          await new Promise((r) => setTimeout(r, 900));
          setSnapshot((prev) => ({
            ...prev,
            status: {
              ...demoMutator(prev.status),
              status_time: Math.floor(Date.now() / 1000),
            },
          }));
          showToast('success', `${label} executed (PIN verified)`);
        } else {
          const pinHash = hashControlPin(pinToUse);
          const client =
            clientRef.current ||
            new MgIndiaClient({
              phone: config.phone,
              password: config.password,
              vin: config.vin || undefined,
              pinHash,
              proxyBaseUrl: config.proxyUrl || undefined,
            });
          client.pinHash = pinHash;
          clientRef.current = client;
          await liveRunner(client);
          showToast('success', `${label} confirmed by vehicle`);
          await refreshTelemetry(true);
        }
      } catch (err) {
        showToast('error', (err as Error).message);
      } finally {
        setActiveCommand(null);
      }
    };

    if (/^\d{4}$/.test(config.pin)) {
      await runWithPin(config.pin);
    } else {
      setEnteredPin('');
      setPinModal({
        open: true,
        label,
        onConfirm: (pinVal) => {
          setPinModal(null);
          runWithPin(pinVal);
        },
      });
    }
  };

  const { vehicle, status } = snapshot;
  const charge = status.charge;
  const soc = charge?.soc ?? status.fuel_level ?? 0;
  const rangeKm = charge?.range_km ?? status.range_km ?? 0;
  const chargingKw =
    charge && charge.is_charging && charge.charging_current
      ? Number(((charge.charging_voltage * charge.charging_current) / 1000).toFixed(2))
      : 0;

  const anyDoorOpen = Boolean(
    status.driver_door_open ||
      status.passenger_door_open ||
      status.rear_left_door_open ||
      status.rear_right_door_open ||
      status.boot_open ||
      status.bonnet_open
  );

  const anyWindowOpen = Boolean(
    status.driver_window_open ||
      status.passenger_window_open ||
      status.rear_left_window_open ||
      status.rear_right_window_open ||
      status.sunroof_open
  );

  return (
    <div className="min-h-screen bg-[#0A0E17] text-slate-100 flex flex-col items-center justify-start">
      {/* iPhone 14 Plus / Mobile Viewport Container (430px max-width on desktop, full screen on iPhone) */}
      <div className="w-full max-w-[440px] min-h-screen bg-[#0A0E17] flex flex-col justify-between relative shadow-2xl border-x border-slate-800/60 pb-24">
        {/* Top Status Header */}
        <header className="safe-top px-5 pt-4 pb-3 sticky top-0 z-30 bg-[#0A0E17]/90 backdrop-blur-xl border-b border-slate-800/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center shadow-lg shadow-red-900/30 border border-red-400/30">
                <span className="font-black text-base tracking-tighter text-white">MG</span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-bold text-base tracking-tight text-white">
                    {vehicle.name}
                  </h1>
                  <span
                    className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${
                      config.mode === 'demo'
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    }`}
                  >
                    {config.mode === 'demo' ? 'Simulator' : 'Live TAP'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 font-mono">
                  {vehicle.model} • {vehicle.color_name || vehicle.vin.slice(-6)}
                </p>
              </div>
            </div>

            <button
              onClick={() => refreshTelemetry(true)}
              disabled={isPolling}
              className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 active:scale-95 transition border border-slate-700/60 text-slate-200"
              title="Poll Vehicle Status"
            >
              <RefreshCw className={`w-4 h-4 ${isPolling ? 'animate-spin text-emerald-400' : ''}`} />
            </button>
          </div>
        </header>

        {/* Toast Notification */}
        {toast && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-[400px]">
            <div
              className={`px-4 py-3 rounded-2xl shadow-2xl border backdrop-blur-xl flex items-center gap-2.5 text-xs font-medium ${
                toast.type === 'error'
                  ? 'bg-red-950/90 border-red-500/40 text-red-200'
                  : 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
              }`}
            >
              {toast.type === 'error' ? (
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              )}
              <span>{toast.text}</span>
            </div>
          </div>
        )}

        {/* Main Content Body */}
        <main className="flex-1 px-4 py-4 space-y-4">
          {/* TAB 1: DASHBOARD */}
          {activeTab === 'dashboard' && (
            <>
              {/* Hero Battery & Range Card */}
              <div className="rounded-3xl bg-gradient-to-br from-[#131B2E] via-[#0F172A] to-[#0B1120] p-5 border border-slate-800/80 shadow-xl relative overflow-hidden">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                          status.locked
                            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                            : 'bg-red-500/15 text-red-300 border border-red-500/30'
                        }`}
                      >
                        {status.locked ? (
                          <Lock className="w-3.5 h-3.5" />
                        ) : (
                          <Unlock className="w-3.5 h-3.5" />
                        )}
                        {status.locked ? 'Locked & Secure' : 'Unlocked'}
                      </span>

                      {charge?.is_charging && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 animate-pulse">
                          <Zap className="w-3.5 h-3.5 fill-cyan-400" />
                          {chargingKw} kW
                        </span>
                      )}
                    </div>

                    <div className="mt-4 flex items-baseline gap-2">
                      <span className="text-5xl font-black tracking-tight text-white">
                        {Math.round(RangeOrZero(rangeKm))}
                      </span>
                      <span className="text-lg font-semibold text-slate-400">km range</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      Battery Energy:{' '}
                      <span className="text-slate-200 font-semibold">
                        {charge?.battery_energy_kwh ?? ((soc / 100) * 37.3).toFixed(1)} kWh
                      </span>{' '}
                      / {charge?.total_battery_capacity_kwh ?? 37.3} kWh usable
                    </p>
                  </div>

                  {/* Circular SOC Ring */}
                  <div className="relative w-24 h-24 flex items-center justify-center">
                    <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        className="stroke-slate-800"
                        strokeWidth="10"
                        fill="transparent"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        stroke={charge?.is_charging ? '#06B6D4' : '#10B981'}
                        strokeWidth="10"
                        strokeDasharray={2 * Math.PI * 42}
                        strokeDashoffset={
                          2 * Math.PI * 42 * (1 - Math.min(100, Math.max(0, soc)) / 100)
                        }
                        strokeLinecap="round"
                        fill="transparent"
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-xl font-black text-white">{soc.toFixed(0)}%</span>
                      <span className="text-[10px] uppercase tracking-wider text-slate-400">
                        SOC
                      </span>
                    </div>
                  </div>
                </div>

                {/* Progress Bar & Odometer Footer */}
                <div className="mt-5 pt-4 border-t border-slate-800/80 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[11px] text-slate-400">Odometer</p>
                    <p className="text-sm font-bold text-slate-100">
                      {(charge?.odometer_km ?? status.odometer_km ?? 0).toLocaleString()} km
                    </p>
                  </div>
                  <div className="border-x border-slate-800/80">
                    <p className="text-[11px] text-slate-400">12V Aux Battery</p>
                    <p className="text-sm font-bold text-emerald-400">
                      {status.aux_battery_voltage ?? 14.0} V
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400">Cabin / Ext</p>
                    <p className="text-sm font-bold text-slate-100">
                      {status.interior_temperature ?? '--'}° / {status.exterior_temperature ?? '--'}°C
                    </p>
                  </div>
                </div>
              </div>

              {/* Quick Action Pill Strip */}
              <div className="grid grid-cols-4 gap-2.5">
                <button
                  onClick={() =>
                    executeRemoteControl(
                      status.locked ? 'Unlock Doors' : 'Lock Doors',
                      (s) => ({ ...s, locked: !s.locked }),
                      (c) => c.controlDoorLock(!status.locked)
                    )
                  }
                  disabled={Boolean(activeCommand)}
                  className={`flex flex-col items-center justify-center p-3.5 rounded-2xl border transition active:scale-95 ${
                    status.locked
                      ? 'bg-[#131B2E] border-slate-800 text-slate-200'
                      : 'bg-red-500/20 border-red-500/40 text-red-200'
                  }`}
                >
                  {status.locked ? (
                    <Lock className="w-5 h-5 text-emerald-400 mb-1.5" />
                  ) : (
                    <Unlock className="w-5 h-5 text-red-400 mb-1.5" />
                  )}
                  <span className="text-xs font-semibold">
                    {status.locked ? 'Locked' : 'Unlocked'}
                  </span>
                </button>

                <button
                  onClick={() =>
                    executeRemoteControl(
                      status.climate_running ? 'Stop AC Climate' : 'Start AC Climate',
                      (s) => ({ ...s, climate_running: !s.climate_running }),
                      (c) => c.controlClimate(!status.climate_running)
                    )
                  }
                  disabled={Boolean(activeCommand)}
                  className={`flex flex-col items-center justify-center p-3.5 rounded-2xl border transition active:scale-95 ${
                    status.climate_running
                      ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-200'
                      : 'bg-[#131B2E] border-slate-800 text-slate-200'
                  }`}
                >
                  <Wind
                    className={`w-5 h-5 mb-1.5 ${
                      status.climate_running ? 'text-cyan-400 animate-spin' : 'text-slate-400'
                    }`}
                  />
                  <span className="text-xs font-semibold">
                    {status.climate_running ? 'AC On' : 'Climate'}
                  </span>
                </button>

                <button
                  onClick={() =>
                    executeRemoteControl(
                      'Find My Car (Horn & Lights)',
                      (s) => ({ ...s, side_lights_on: true }),
                      (c) => c.findMyCar()
                    )
                  }
                  disabled={Boolean(activeCommand)}
                  className="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-[#131B2E] border border-slate-800 text-slate-200 active:scale-95 transition"
                >
                  <Volume2 className="w-5 h-5 text-amber-400 mb-1.5" />
                  <span className="text-xs font-semibold">Find Car</span>
                </button>

                <button
                  onClick={() =>
                    executeRemoteControl(
                      'Release Tailgate',
                      (s) => ({ ...s, boot_open: !s.boot_open }),
                      (c) => c.releaseTailgate()
                    )
                  }
                  disabled={Boolean(activeCommand)}
                  className={`flex flex-col items-center justify-center p-3.5 rounded-2xl border transition active:scale-95 ${
                    status.boot_open
                      ? 'bg-amber-500/20 border-amber-500/40 text-amber-200'
                      : 'bg-[#131B2E] border-slate-800 text-slate-200'
                  }`}
                >
                  <Car className="w-5 h-5 text-purple-400 mb-1.5" />
                  <span className="text-xs font-semibold">Tailgate</span>
                </button>
              </div>

              {/* Top-Down Interactive Vehicle & TPMS Card */}
              <div className="rounded-3xl bg-[#131B2E] p-5 border border-slate-800/80">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-sm font-bold text-white flex items-center gap-2">
                      <Gauge className="w-4 h-4 text-emerald-400" />
                      Tyre Pressures (TPMS) & Closures
                    </h2>
                    <p className="text-[11px] text-slate-400">
                      0.2 PSI/unit precision decoded from RvsBasicStatus513
                    </p>
                  </div>
                  <span
                    className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
                      !anyDoorOpen && !anyWindowOpen
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-amber-500/15 text-amber-300'
                    }`}
                  >
                    {!anyDoorOpen && !anyWindowOpen ? 'All Closed' : 'Check Open Entry'}
                  </span>
                </div>

                <div className="grid grid-cols-3 items-center gap-3 my-2">
                  {/* Left Tyres */}
                  <div className="space-y-12 text-right">
                    <TyreBadge
                      label="Front Left"
                      psi={status.front_left_tyre_psi}
                      doorOpen={status.driver_door_open}
                      windowOpen={status.driver_window_open}
                    />
                    <TyreBadge
                      label="Rear Left"
                      psi={status.rear_left_tyre_psi}
                      doorOpen={status.rear_left_door_open}
                      windowOpen={status.rear_left_window_open}
                    />
                  </div>

                  {/* Center Top-Down Car Silhouette */}
                  <div className="flex flex-col items-center justify-center">
                    <div className="w-28 h-52 rounded-[36px] bg-gradient-to-b from-slate-800 via-slate-900 to-slate-800 border-2 border-slate-700 relative flex flex-col items-center justify-between p-3 shadow-inner">
                      {/* Bonnet */}
                      <div
                        className={`w-16 h-6 rounded-t-2xl border-t-2 ${
                          status.bonnet_open ? 'border-red-500 bg-red-500/20' : 'border-slate-600'
                        } flex items-center justify-center text-[9px] text-slate-400 uppercase`}
                      >
                        {status.bonnet_open ? 'Bonnet Open' : 'Front'}
                      </div>

                      {/* Windshield & Sunroof */}
                      <div
                        className={`w-20 h-20 rounded-xl border ${
                          status.sunroof_open
                            ? 'border-cyan-400 bg-cyan-500/20'
                            : 'border-slate-700 bg-slate-950/70'
                        } flex flex-col items-center justify-center text-center p-1`}
                      >
                        <span className="text-[9px] text-slate-400 uppercase">Sunroof</span>
                        <span className="text-[11px] font-bold text-slate-200">
                          {status.sunroof_open ? 'OPEN' : 'CLOSED'}
                        </span>
                      </div>

                      {/* Boot */}
                      <div
                        className={`w-16 h-6 rounded-b-2xl border-b-2 ${
                          status.boot_open ? 'border-amber-400 bg-amber-500/20' : 'border-slate-600'
                        } flex items-center justify-center text-[9px] text-slate-400 uppercase`}
                      >
                        {status.boot_open ? 'Boot Open' : 'Rear'}
                      </div>
                    </div>
                  </div>

                  {/* Right Tyres */}
                  <div className="space-y-12 text-left">
                    <TyreBadge
                      label="Front Right"
                      psi={status.front_right_tyre_psi}
                      doorOpen={status.passenger_door_open}
                      windowOpen={status.passenger_window_open}
                      align="left"
                    />
                    <TyreBadge
                      label="Rear Right"
                      psi={status.rear_right_tyre_psi}
                      doorOpen={status.rear_right_door_open}
                      windowOpen={status.rear_right_window_open}
                      align="left"
                    />
                  </div>
                </div>
              </div>

              {/* System Diagnostics & CAN Bus Status */}
              <div className="rounded-3xl bg-[#131B2E] p-4 border border-slate-800/80 grid grid-cols-2 gap-3">
                <div className="p-3 rounded-2xl bg-slate-900/70 border border-slate-800/80 flex items-center gap-3">
                  <Activity className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div>
                    <p className="text-[11px] text-slate-400">CAN Bus & Handbrake</p>
                    <p className="text-xs font-bold text-slate-200">
                      {status.can_bus_active ? 'CAN Active' : 'Sleeping'} •{' '}
                      {status.handbrake ? 'Park Brake ON' : 'Released'}
                    </p>
                  </div>
                </div>
                <div className="p-3 rounded-2xl bg-slate-900/70 border border-slate-800/80 flex items-center gap-3">
                  <Sun className="w-5 h-5 text-amber-400 shrink-0" />
                  <div>
                    <p className="text-[11px] text-slate-400">Exterior Lighting</p>
                    <p className="text-xs font-bold text-slate-200">
                      {status.main_beam_on
                        ? 'High Beam'
                        : status.dipped_beam_on
                        ? 'Low Beam'
                        : status.side_lights_on
                        ? 'Parking Lights'
                        : 'All Off'}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* TAB 2: EV CHARGING MONITOR (App-ID 511 / MessageID 8) */}
          {activeTab === 'charging' && (
            <div className="space-y-4">
              <div className="rounded-3xl bg-gradient-to-br from-[#0F293A] via-[#111C2D] to-[#0A0E17] p-5 border border-cyan-500/30 shadow-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2.5 rounded-2xl bg-cyan-500/20 text-cyan-300">
                      <BatteryCharging className="w-6 h-6" />
                    </div>
                    <div>
                      <h2 className="font-bold text-base text-white">
                        EV Charging Telemetry
                      </h2>
                      <p className="text-xs text-cyan-300/80">
                        63-Byte App-ID 511 Frame (MessageID=8)
                      </p>
                    </div>
                  </div>
                  {config.mode === 'demo' && (
                    <button
                      onClick={() =>
                        setSnapshot((prev) => ({
                          ...prev,
                          status: {
                            ...prev.status,
                            charge: prev.status.charge
                              ? {
                                  ...prev.status.charge,
                                  is_charging: !prev.status.charge.is_charging,
                                  charging_current: !prev.status.charge.is_charging ? 16.8 : 0.0,
                                }
                              : null,
                          },
                        }))
                      }
                      className="text-xs px-3 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 font-semibold"
                    >
                      {charge?.is_charging ? 'Pause Sim' : 'Resume Sim'}
                    </button>
                  )}
                </div>

                {charge ? (
                  <>
                    {/* Live Power & Remaining Time */}
                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800">
                        <p className="text-xs text-slate-400">Live Charging Power</p>
                        <p className="text-3xl font-black text-cyan-400 mt-1">
                          {chargingKw} <span className="text-sm font-semibold">kW</span>
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          {charge.charging_voltage} V × {charge.charging_current ?? 0} A
                        </p>
                      </div>

                      <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800">
                        <p className="text-xs text-slate-400">Time to 100% Full</p>
                        <p className="text-3xl font-black text-emerald-400 mt-1">
                          {charge.charge_time_remaining_min ?? '--'}{' '}
                          <span className="text-sm font-semibold">min</span>
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          Elapsed:{' '}
                          {charge.charge_time_elapsed_s
                            ? `${Math.floor(charge.charge_time_elapsed_s / 60)}m ${
                                charge.charge_time_elapsed_s % 60
                              }s`
                            : 'Idle'}
                        </p>
                      </div>
                    </div>

                    {/* Detailed BMS Metrics */}
                    <div className="mt-4 grid grid-cols-2 gap-2.5 text-xs">
                      <MetricRow
                        label="State of Charge (SOC)"
                        value={`${charge.soc ?? '--'} %`}
                      />
                      <MetricRow
                        label="Estimated EV Range"
                        value={`${charge.range_km} km`}
                      />
                      <MetricRow
                        label="Pack Energy (BMS)"
                        value={`${charge.battery_energy_kwh} kWh`}
                      />
                      <MetricRow
                        label="Derived Usable Capacity"
                        value={
                          charge.soc && charge.soc > 0
                            ? `${(charge.battery_energy_kwh / (charge.soc / 100)).toFixed(1)} kWh`
                            : '37.3 kWh'
                        }
                      />
                      <MetricRow
                        label="Driven Since Last Charge"
                        value={`${charge.distance_since_last_charge_km ?? 0} km`}
                      />
                      <MetricRow
                        label="Energy Used Since Charge"
                        value={`${charge.power_usage_since_last_charge_kwh ?? 0} kWh`}
                      />
                      <MetricRow
                        label="Charge Point ID"
                        value={charge.charging_pile_id || 'Home AC Wallbox'}
                      />
                      <MetricRow
                        label="Charge Operator"
                        value={charge.charging_pile_supplier || 'Standard AC'}
                      />
                    </div>
                  </>
                ) : (
                  <div className="py-8 text-center text-slate-400 text-sm">
                    No active 63-byte charging frame returned. Tap Refresh at the top right to
                    poll `status(include_charge=True)`.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: REMOTE CONTROLS (PIN-Protected App-ID 510 & 313) */}
          {activeTab === 'controls' && (
            <div className="space-y-4">
              <div className="rounded-3xl bg-[#131B2E] p-5 border border-slate-800/80">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="font-bold text-base text-white flex items-center gap-2">
                      <KeyRound className="w-4 h-4 text-emerald-400" />
                      Remote Vehicle Controls
                    </h2>
                    <p className="text-xs text-slate-400">
                      Protected by MD5(&quot;PIN00&quot;) V11 App-ID 313 Verification
                    </p>
                  </div>
                  {activeCommand && (
                    <span className="text-xs text-cyan-300 font-semibold animate-pulse">
                      Sending {activeCommand}...
                    </span>
                  )}
                </div>

                <div className="space-y-3 mt-4">
                  {/* Door Lock / Unlock */}
                  <ControlCard
                    title="Central Door Locks"
                    subtitle={status.locked ? 'All doors currently locked' : 'Doors unlocked'}
                    icon={<Lock className="w-5 h-5 text-emerald-400" />}
                    primaryLabel="Lock Car"
                    secondaryLabel="Unlock Car"
                    primaryActive={Boolean(status.locked)}
                    onPrimary={() =>
                      executeRemoteControl(
                        'Lock Doors',
                        (s) => ({ ...s, locked: true }),
                        (c) => c.controlDoorLock(true)
                      )
                    }
                    onSecondary={() =>
                      executeRemoteControl(
                        'Unlock Doors',
                        (s) => ({ ...s, locked: false }),
                        (c) => c.controlDoorLock(false)
                      )
                    }
                  />

                  {/* Remote Climate Control */}
                  <ControlCard
                    title="Cabin Air Conditioning (HVAC)"
                    subtitle={
                      status.climate_running
                        ? `Running • Cabin ${status.interior_temperature ?? 22}°C`
                        : `Off • Cabin ${status.interior_temperature ?? 24}°C`
                    }
                    icon={<Wind className="w-5 h-5 text-cyan-400" />}
                    primaryLabel="Start Climate"
                    secondaryLabel="Stop Climate"
                    primaryActive={Boolean(status.climate_running)}
                    onPrimary={() =>
                      executeRemoteControl(
                        'Start Climate',
                        (s) => ({ ...s, climate_running: true, interior_temperature: 21 }),
                        (c) => c.controlClimate(true)
                      )
                    }
                    onSecondary={() =>
                      executeRemoteControl(
                        'Stop Climate',
                        (s) => ({ ...s, climate_running: false }),
                        (c) => c.controlClimate(false)
                      )
                    }
                  />

                  {/* Power Windows (Params 9, 10, 11, 12) */}
                  <ControlCard
                    title="All 4 Power Windows"
                    subtitle="Ventilate cabin or seal all windows (IDs 9..12)"
                    icon={<Sparkles className="w-5 h-5 text-blue-400" />}
                    primaryLabel="Close Windows"
                    secondaryLabel="Vent / Open"
                    primaryActive={!status.driver_window_open}
                    onPrimary={() =>
                      executeRemoteControl(
                        'Close All Windows',
                        (s) => ({
                          ...s,
                          driver_window_open: false,
                          passenger_window_open: false,
                          rear_left_window_open: false,
                          rear_right_window_open: false,
                        }),
                        (c) => c.controlWindows(false, [9, 10, 11, 12])
                      )
                    }
                    onSecondary={() =>
                      executeRemoteControl(
                        'Open All Windows',
                        (s) => ({
                          ...s,
                          driver_window_open: true,
                          passenger_window_open: true,
                          rear_left_window_open: true,
                          rear_right_window_open: true,
                        }),
                        (c) => c.controlWindows(true, [9, 10, 11, 12])
                      )
                    }
                  />

                  {/* Panoramic Sunroof (Param 8) */}
                  <ControlCard
                    title="Panoramic Sunroof"
                    subtitle={status.sunroof_open ? 'Sunroof is open' : 'Sunroof is closed'}
                    icon={<Sun className="w-5 h-5 text-amber-400" />}
                    primaryLabel="Close Sunroof"
                    secondaryLabel="Open Sunroof"
                    primaryActive={!status.sunroof_open}
                    onPrimary={() =>
                      executeRemoteControl(
                        'Close Sunroof',
                        (s) => ({ ...s, sunroof_open: false }),
                        (c) => c.controlSunroof(false)
                      )
                    }
                    onSecondary={() =>
                      executeRemoteControl(
                        'Open Sunroof',
                        (s) => ({ ...s, sunroof_open: true }),
                        (c) => c.controlSunroof(true)
                      )
                    }
                  />

                  {/* Heated Seats (Levels 0..3) */}
                  <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <Flame className="w-5 h-5 text-orange-400" />
                        <div>
                          <p className="text-sm font-bold text-white">Front Heated Seats</p>
                          <p className="text-[11px] text-slate-400">
                            Driver Level {status.front_left_seat_heat_level ?? 0} • Passenger Level{' '}
                            {status.front_right_seat_heat_level ?? 0}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {[0, 1, 2, 3].map((lvl) => (
                        <button
                          key={lvl}
                          onClick={() =>
                            executeRemoteControl(
                              `Heated Seats Level ${lvl}`,
                              (s) => ({
                                ...s,
                                front_left_seat_heat_level: lvl,
                                front_right_seat_heat_level: lvl,
                              }),
                              (c) => c.controlHeatedSeats(lvl, lvl)
                            )
                          }
                          className={`py-2 rounded-xl text-xs font-bold border transition ${
                            (status.front_left_seat_heat_level ?? 0) === lvl
                              ? 'bg-orange-500/20 border-orange-500/50 text-orange-300'
                              : 'bg-slate-800/70 border-slate-700/60 text-slate-300'
                          }`}
                        >
                          {lvl === 0 ? 'Off' : `Lvl ${lvl}`}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: LIVE GPS LOCATION (RvsPosition) */}
          {activeTab === 'location' && (
            <div className="space-y-4">
              <div className="rounded-3xl bg-[#131B2E] p-5 border border-slate-800/80 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="font-bold text-base text-white flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-red-400" />
                      Live Vehicle GPS Tracker
                    </h2>
                    <p className="text-xs text-slate-400">
                      Decoded WGS84 micro-degrees from RvsPosition
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    <Satellite className="w-3.5 h-3.5" />
                    {status.gps?.satellites ?? 0} Sats •{' '}
                    {status.gps?.gps_status === GpsStatus.FIX_3D ? '3D Fix' : '2D Fix'}
                  </span>
                </div>

                {/* Embedded Interactive Map Preview */}
                {status.gps?.has_fix && status.gps.latitude && status.gps.longitude ? (
                  <>
                    <div className="w-full h-64 rounded-2xl overflow-hidden border border-slate-700 relative bg-slate-900">
                      <iframe
                        title="Vehicle GPS Map"
                        width="100%"
                        height="100%"
                        style={{ border: 0, filter: 'invert(90%) hue-rotate(180deg)' }}
                        loading="lazy"
                        src={`https://www.openstreetmap.org/export/embed.html?bbox=${
                          status.gps.longitude - 0.008
                        }%2C${status.gps.latitude - 0.008}%2C${
                          status.gps.longitude + 0.008
                        }%2C${status.gps.latitude + 0.008}&layer=mapnik&marker=${
                          status.gps.latitude
                        }%2C${status.gps.longitude}`}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 text-xs">
                      <MetricRow
                        label="Coordinates"
                        value={`${status.gps.latitude.toFixed(6)}, ${status.gps.longitude.toFixed(
                          6
                        )}`}
                      />
                      <MetricRow
                        label="Speed & Heading"
                        value={`${status.gps.speed_kmh ?? 0} km/h • ${
                          status.gps.heading_deg ?? 0
                        }°`}
                      />
                      <MetricRow
                        label="Altitude"
                        value={`${status.gps.altitude_m ?? 0} m ASL`}
                      />
                      <MetricRow
                        label="HDOP Precision"
                        value={`HDOP ${status.gps.hdop ?? '--'}`}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <a
                        href={`http://maps.apple.com/?ll=${status.gps.latitude},${status.gps.longitude}&q=${encodeURIComponent(
                          vehicle.name
                        )}`}
                        target="_blank"
                        rel="noreferrer"
                        className="py-3 px-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-center text-xs font-bold text-white flex items-center justify-center gap-2 border border-slate-700"
                      >
                        <Navigation className="w-4 h-4 text-cyan-400" />
                        Open in Apple Maps
                      </a>
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${status.gps.latitude},${status.gps.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-center text-xs font-bold text-white flex items-center justify-center gap-2"
                      >
                        <MapPin className="w-4 h-4" />
                        Open in Google Maps
                      </a>
                    </div>
                  </>
                ) : (
                  <div className="py-12 text-center text-slate-400 text-sm">
                    Vehicle reported no active sky GPS fix (`noGpsSignal`).
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: TRIP & CHARGE LOGBOOK */}
          {activeTab === 'history' && (
            <div className="space-y-4">
              <div className="rounded-3xl bg-[#131B2E] p-5 border border-slate-800/80">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h2 className="font-bold text-base text-white flex items-center gap-2">
                      <History className="w-4 h-4 text-emerald-400" />
                      Recent Trips & Efficiency
                    </h2>
                    <p className="text-xs text-slate-400">
                      Automatic trip & energy consumption logger
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      const newTrip: TripRecord = {
                        id: `trip-${Date.now()}`,
                        date: 'Just Now',
                        startLocation: 'Current GPS Fix',
                        endLocation: 'Recorded Snapshot',
                        distanceKm: charge?.distance_since_last_charge_km ?? 14.2,
                        durationMin: 28,
                        energyUsedKwh: charge?.power_usage_since_last_charge_kwh ?? 2.1,
                        efficiencyKmPerKwh: 6.76,
                        avgSpeedKmh: 31.0,
                        startSoc: Math.min(100, Math.round(soc + 6)),
                        endSoc: Math.round(soc),
                      };
                      setTrips((prev) => [newTrip, ...prev]);
                      showToast('success', 'Logged current trip snapshot to history');
                    }}
                    className="text-xs px-3 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold"
                  >
                    + Log Snapshot
                  </button>
                </div>

                <div className="space-y-2.5">
                  {trips.map((t) => (
                    <div
                      key={t.id}
                      className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800/90 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-emerald-400">
                          {t.date}
                        </span>
                        <span className="text-xs font-bold text-white">
                          {t.distanceKm} km • {t.energyUsedKwh} kWh
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 font-medium">
                        {t.startLocation} → {t.endLocation}
                      </p>
                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/70">
                        <span>Efficiency: {t.efficiencyKmPerKwh.toFixed(2)} km/kWh</span>
                        <span>
                          SOC: {t.startSoc}% → {t.endSoc}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl bg-[#131B2E] p-5 border border-slate-800/80">
                <h2 className="font-bold text-base text-white flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-cyan-400" />
                  Charging Session Logbook
                </h2>
                <div className="space-y-2.5">
                  {chargeLogs.map((c) => (
                    <div
                      key={c.id}
                      className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800/90 space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">{c.stationName}</span>
                        <span className="text-xs font-bold text-cyan-300">
                          +{c.energyAddedKwh} kWh
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400">
                        <span>
                          {c.date} • {c.chargerType}
                        </span>
                        <span>
                          {c.startSoc}% → {c.endSoc}% ({c.peakKw} kW)
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: SETTINGS, LIVE CREDENTIALS & IPHONE 14 PLUS INSTALL GUIDE */}
          {activeTab === 'settings' && (
            <div className="space-y-4">
              {/* Mode Switcher */}
              <div className="rounded-3xl bg-[#131B2E] p-5 border border-slate-800/80 space-y-4">
                <h2 className="font-bold text-base text-white flex items-center gap-2">
                  <Settings className="w-4 h-4 text-emerald-400" />
                  Connection Mode & MG India Account
                </h2>

                <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-slate-950 border border-slate-800">
                  <button
                    onClick={() => setConfig((c) => ({ ...c, mode: 'demo' }))}
                    className={`py-2.5 rounded-xl text-xs font-bold transition ${
                      config.mode === 'demo'
                        ? 'bg-emerald-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Simulator Mode
                  </button>
                  <button
                    onClick={() => setConfig((c) => ({ ...c, mode: 'live' }))}
                    className={`py-2.5 rounded-xl text-xs font-bold transition ${
                      config.mode === 'live'
                        ? 'bg-emerald-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Live MG India API
                  </button>
                </div>

                {config.mode === 'demo' ? (
                  <div className="space-y-3">
                    <label className="block text-xs text-slate-400">
                      Select Simulated Indian MG EV Model
                    </label>
                    <div className="grid grid-cols-1 gap-2">
                      {DEMO_VEHICLES.map((v, idx) => (
                        <button
                          key={v.vin}
                          onClick={() => {
                            setConfig((c) => ({ ...c, demoVehicleIdx: idx }));
                            setSnapshot(createDemoSnapshot(idx));
                          }}
                          className={`p-3 rounded-2xl border text-left flex items-center justify-between ${
                            config.demoVehicleIdx === idx
                              ? 'bg-emerald-500/15 border-emerald-500/50 text-white'
                              : 'bg-slate-900/70 border-slate-800 text-slate-300'
                          }`}
                        >
                          <div>
                            <p className="text-xs font-bold">{v.name}</p>
                            <p className="text-[11px] text-slate-400">
                              {v.model} • {v.color_name} ({v.series})
                            </p>
                          </div>
                          {config.demoVehicleIdx === idx && (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        India Mobile Number (10 digits)
                      </label>
                      <input
                        type="tel"
                        placeholder="9876543210"
                        value={config.phone}
                        onChange={(e) => setConfig((c) => ({ ...c, phone: e.target.value }))}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:border-emerald-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        MG iSMART Password (auto-trimmed to 16 chars per protocol)
                      </label>
                      <input
                        type="password"
                        placeholder="••••••••"
                        value={config.password}
                        onChange={(e) => setConfig((c) => ({ ...c, password: e.target.value }))}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:border-emerald-500 outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">
                          4-Digit Control PIN
                        </label>
                        <input
                          type="password"
                          maxLength={4}
                          placeholder="1234"
                          value={config.pin}
                          onChange={(e) => setConfig((c) => ({ ...c, pin: e.target.value }))}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:border-emerald-500 outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">
                          VIN (Optional - Auto-discovers)
                        </label>
                        <input
                          type="text"
                          placeholder="Auto-discover"
                          value={config.vin}
                          onChange={(e) => setConfig((c) => ({ ...c, vin: e.target.value }))}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:border-emerald-500 outline-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        CORS Relay / Cloudflare Worker URL (Leave blank on React Native)
                      </label>
                      <input
                        type="url"
                        placeholder="https://your-worker.workers.dev or http://localhost:8787"
                        value={config.proxyUrl}
                        onChange={(e) => setConfig((c) => ({ ...c, proxyUrl: e.target.value }))}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:border-emerald-500 outline-none font-mono"
                      />
                    </div>
                    <button
                      onClick={() => refreshTelemetry(true)}
                      disabled={isPolling}
                      className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-900/30 transition"
                    >
                      {isPolling ? 'Connecting to MG India TAP...' : 'Login & Poll Vehicle Now'}
                    </button>
                  </div>
                )}
              </div>

              {/* iPhone 14 Plus Installation Guide Card */}
              <div className="rounded-3xl bg-[#131B2E] p-5 border border-slate-800/80 space-y-3">
                <h3 className="font-bold text-sm text-white flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-cyan-400" />
                  Run on Your iPhone 14 Plus (No App Store Needed)
                </h3>
                <div className="text-xs text-slate-300 space-y-2 leading-relaxed">
                  <p>
                    <strong className="text-emerald-400">Option A — Native iOS Home Screen PWA:</strong>{' '}
                    Open this app URL in <strong>Safari</strong> on your iPhone 14 Plus, tap{' '}
                    <strong>Share</strong> → <strong>Add to Home Screen</strong>. It launches
                    full-screen with a native icon and never expires.
                  </p>
                  <p>
                    <strong className="text-cyan-400">Option B — React Native (Expo Go):</strong>{' '}
                    Use the companion <code>mobile-expo/</code> folder in this workspace with the
                    free <strong>Expo Go</strong> app on iOS—it calls{' '}
                    <code>iov-tap.mgindia.co.in</code> directly from your iPhone without needing any
                    CORS proxy!
                  </p>
                </div>
              </div>
            </div>
          )}
        </main>

        {/* PIN Prompt Modal */}
        {pinModal?.open && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-xs rounded-3xl bg-[#131B2E] border border-slate-700 p-5 space-y-4">
              <h3 className="font-bold text-base text-white">Enter 4-Digit Control PIN</h3>
              <p className="text-xs text-slate-400">
                Required to authorize <strong>{pinModal.label}</strong> (hashed with MD5(&quot;PIN00&quot;)).
              </p>
              <input
                type="password"
                maxLength={4}
                autoFocus
                value={enteredPin}
                onChange={(e) => setEnteredPin(e.target.value)}
                className="w-full text-center text-2xl tracking-[0.5em] py-3 rounded-2xl bg-slate-950 border border-slate-700 text-white outline-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setPinModal(null)}
                  className="py-2.5 rounded-xl bg-slate-800 text-slate-300 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  onClick={() => pinModal.onConfirm(enteredPin)}
                  disabled={!/^\d{4}$/.test(enteredPin)}
                  className="py-2.5 rounded-xl bg-emerald-600 disabled:opacity-40 text-white text-xs font-bold"
                >
                  Authorize
                </button>
              </div>
            </div>
          </div>
        )}

        {/* iOS Bottom Tab Bar */}
        <nav className="safe-bottom fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[440px] z-40 bg-[#0D1322]/95 backdrop-blur-xl border-t border-slate-800/80 px-2 pt-2">
          <div className="grid grid-cols-6 gap-1">
            <NavButton
              active={activeTab === 'dashboard'}
              onClick={() => setActiveTab('dashboard')}
              icon={<Car className="w-5 h-5" />}
              label="Cockpit"
            />
            <NavButton
              active={activeTab === 'charging'}
              onClick={() => setActiveTab('charging')}
              icon={<BatteryCharging className="w-5 h-5" />}
              label="Charge"
            />
            <NavButton
              active={activeTab === 'controls'}
              onClick={() => setActiveTab('controls')}
              icon={<KeyRound className="w-5 h-5" />}
              label="Control"
            />
            <NavButton
              active={activeTab === 'location'}
              onClick={() => setActiveTab('location')}
              icon={<MapPin className="w-5 h-5" />}
              label="GPS Map"
            />
            <NavButton
              active={activeTab === 'history'}
              onClick={() => setActiveTab('history')}
              icon={<History className="w-5 h-5" />}
              label="Logbook"
            />
            <NavButton
              active={activeTab === 'settings'}
              onClick={() => setActiveTab('settings')}
              icon={<Settings className="w-5 h-5" />}
              label="Setup"
            />
          </div>
        </nav>
      </div>
    </div>
  );
}

function RangeOrZero(val: number | null | undefined): number {
  return val && !Number.isNaN(val) ? val : 0;
}

function NavButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center py-1.5 rounded-xl transition ${
        active ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {icon}
      <span className="text-[10px] font-semibold mt-1">{label}</span>
    </button>
  );
}

function TyreBadge({
  label,
  psi,
  doorOpen,
  windowOpen,
  align = 'right',
}: {
  label: string;
  psi: number | null;
  doorOpen: boolean | null;
  windowOpen: boolean | null;
  align?: 'left' | 'right';
}) {
  const low = psi !== null && psi < 30;
  return (
    <div className={align === 'right' ? 'text-right' : 'text-left'}>
      <p className="text-[10px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`text-base font-black ${low ? 'text-red-400' : 'text-emerald-400'}`}>
        {psi !== null ? `${psi.toFixed(1)} psi` : '--'}
      </p>
      <p className="text-[10px] text-slate-400">
        Door: <span className={doorOpen ? 'text-red-400 font-bold' : 'text-slate-300'}>{doorOpen ? 'Open' : 'Shut'}</span>
      </p>
      <p className="text-[10px] text-slate-400">
        Win: <span className={windowOpen ? 'text-cyan-400 font-bold' : 'text-slate-300'}>{windowOpen ? 'Open' : 'Shut'}</span>
      </p>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-2xl bg-slate-900/75 border border-slate-800/80">
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className="text-xs font-bold text-slate-100 mt-0.5 truncate">{value}</p>
    </div>
  );
}

function ControlCard({
  title,
  subtitle,
  icon,
  primaryLabel,
  secondaryLabel,
  primaryActive,
  onPrimary,
  onSecondary,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  primaryLabel: string;
  secondaryLabel: string;
  primaryActive: boolean;
  onPrimary: () => void;
  onSecondary: () => void;
}) {
  return (
    <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-xl bg-slate-800">{icon}</div>
        <div>
          <p className="text-sm font-bold text-white">{title}</p>
          <p className="text-[11px] text-slate-400">{subtitle}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onPrimary}
          className={`py-2.5 rounded-xl text-xs font-bold border transition active:scale-95 ${
            primaryActive
              ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
              : 'bg-slate-800 border-slate-700 text-slate-200'
          }`}
        >
          {primaryLabel}
        </button>
        <button
          onClick={onSecondary}
          className={`py-2.5 rounded-xl text-xs font-bold border transition active:scale-95 ${
            !primaryActive
              ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
              : 'bg-slate-800 border-slate-700 text-slate-200'
          }`}
        >
          {secondaryLabel}
        </button>
      </div>
    </div>
  );
}
