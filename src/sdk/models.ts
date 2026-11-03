/**
 * Data models — 1:1 port of mg_ismart_india_client/models.py
 */

export enum GpsStatus {
  NO_SIGNAL = 0,
  TIME_FIX = 1,
  FIX_2D = 2,
  FIX_3D = 3,
}

export interface GpsPosition {
  latitude: number | null;
  longitude: number | null;
  altitude_m: number | null;
  heading_deg: number | null;
  speed_kmh: number | null;
  hdop: number | null;
  satellites: number | null;
  gps_status: GpsStatus | null;
  position_time: number | null;
  has_fix: boolean;
  raw: Record<string, any>;
}

export interface Vehicle {
  vin: string;
  name: string;
  brand: string | null;
  model: string | null;
  model_year: string | null;
  color_name: string | null;
  series: string | null;
  raw: Record<string, any>;
}

export interface Capabilities {
  climate: boolean;
  door_lock: boolean;
  find_my_car: boolean;
  tailgate: boolean;
  sunroof: boolean;
  heated_seats: boolean;
  window_param_ids: number[];
}

export interface ChargeStatus {
  is_charging: boolean;
  is_plugged_in: boolean;
  charging_type: number;
  charging_electricity_phase: number | null;
  soc: number | null;
  range_km: number;
  charging_voltage: number;
  charging_current: number | null;
  battery_energy_kwh: number;
  working_voltage: number | null;
  working_current: number | null;
  charge_time_elapsed_s: number | null;
  start_time: number | null;
  end_time: number | null;
  charge_time_remaining_min: number | null;
  charging_pile_id: string | null;
  charging_pile_supplier: string | null;
  odometer_km: number;
  distance_since_last_charge_km: number | null;
  power_usage_since_last_charge_kwh: number | null;
  mileage_of_day_raw: number | null;
  power_usage_of_day_raw: number | null;
  static_energy_consumption_raw: number | null;
  total_battery_capacity_kwh: number | null;
  last_charge_ending_power_kwh: number | null;
  fota_lowest_voltage_raw: number | null;
  status_time: number;
  extended_data_1: number | null;
  extended_data_2: number | null;
  extended_data_3: string | null;
  extended_data_4: string | null;
  _raw: Record<string, any>;
}

export interface Status {
  status_time: number | null;
  locked: boolean | null;
  driver_door_open: boolean | null;
  passenger_door_open: boolean | null;
  rear_left_door_open: boolean | null;
  rear_right_door_open: boolean | null;
  boot_open: boolean | null;
  bonnet_open: boolean | null;
  driver_window_open: boolean | null;
  passenger_window_open: boolean | null;
  rear_left_window_open: boolean | null;
  rear_right_window_open: boolean | null;
  sunroof_open: boolean | null;
  climate_running: boolean | null;
  interior_temperature: number | null;
  exterior_temperature: number | null;
  fuel_level: number | null;
  range_km: number | null;
  odometer_km: number | null;
  aux_battery_voltage: number | null;
  front_left_tyre_psi: number | null;
  front_right_tyre_psi: number | null;
  rear_left_tyre_psi: number | null;
  rear_right_tyre_psi: number | null;
  tyre_monitor_status: number | null;
  can_bus_active: boolean | null;
  last_can_activity: number | null;
  handbrake: boolean | null;
  gps: GpsPosition | null;
  charge: ChargeStatus | null;
  power_mode_raw: number | null;
  engine_status_raw: number | null;
  side_lights_on: boolean | null;
  dipped_beam_on: boolean | null;
  main_beam_on: boolean | null;
  front_left_seat_heat_level: number | null;
  front_right_seat_heat_level: number | null;
  raw: Record<string, any>;
}

export interface Snapshot {
  vehicle: Vehicle;
  capabilities: Capabilities;
  status: Status;
  user_info: Record<string, any>;
}

export interface TripRecord {
  id: string;
  journeyId: number | null;
  startTimestampSec: number;
  endTimestampSec: number;
  startDateTime: string;
  endDateTime: string;
  // 1 & 2: Start & End Battery % (and kWh)
  startSoc: number;
  endSoc: number;
  startEnergyKwh: number;
  endEnergyKwh: number;
  // 3: Time taken for the trip
  durationSeconds: number;
  // 4: Distance travelled in that trip
  distanceKm: number;
  startOdometerKm: number;
  endOdometerKm: number;
  // 5: Energy used for travelling that trip
  energyUsedKwh: number;
  efficiencyKmPerKwh: number;
  // 6: Location data of starting & ending points
  startLat: number | null;
  startLng: number | null;
  endLat: number | null;
  endLng: number | null;
  startLocation: string;
  endLocation: string;
  // 7: Idling if any, and energy spent & time taken during idle time
  idleDurationSeconds: number;
  idleEnergyKwh: number;
  // 8: Cabin & Ambient temperatures during this trip (Start vs End change)
  acState: string;
  startCabinTempC?: number | null;
  endCabinTempC?: number | null;
  startExteriorTempC?: number | null;
  endExteriorTempC?: number | null;
  cabinTempC: number | null;
  exteriorTempC: number | null;
  acTargetTempC: string;
  acFanSpeed: string;
  // 9 & 10: Maximum & Average speed recorded in this trip
  maxSpeedKmh: number;
  avgSpeedKmh: number;
  status: 'driving' | 'completed';
  lastSampleTimeSec?: number;
}

export interface ChargeLogRecord {
  id: string;
  startTimestampSec: number;
  endTimestampSec: number | null;
  startDateTime: string;
  endDateTime: string;
  startSoc: number;
  endSoc: number;
  startEnergyKwh: number;
  endEnergyKwh: number;
  odometerKm: number;
  distanceToEmptyAfterKm: number;
  chargerCategory: '3.3 kW AC' | '7.4 kW AC' | 'DC Fast';
  maxChargingSpeedKw: number;
  energyAddedToPackKwh: number;
  energyConsumedKwh: number;
  energyLossPercent: number;
  distanceTravelledSinceLastChargeKm: number;
  energyUsedSinceLastChargeKwh: number;
  efficiencyKmPerKwh: number;
  durationSeconds: number;
  status: 'charging' | 'completed';
}
