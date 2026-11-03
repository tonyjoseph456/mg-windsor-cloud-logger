/**
 * MgIndiaClient — 1:1 port of mg_ismart_india_client/client.py
 * Works directly in React Native, Node.js, Cloudflare Workers, or Browser PWA (via proxy/worker).
 */
import { codec11 } from './asn1-uper';
import {
  bytesToHex,
  hexToBytes,
  PackedBitReader,
  PackedBitWriter,
  readFixed7Bit,
  setFixed7Bit,
  setMsbBits,
} from './bitcodec';
import {
  ChargingStatusUnavailable,
  decryptGatewayBody,
  gatewaySignature,
  makeDeviceId,
  MgIndiaApiError,
  MgIndiaCommandIndeterminate,
  MgIndiaLoginRejected,
  normalizePhone,
  tapSignature,
} from './crypto';
import {
  Capabilities,
  ChargeStatus,
  GpsPosition,
  GpsStatus,
  Snapshot,
  Status,
  Vehicle,
} from './models';
import {
  decodeControlResponse,
  decodePinResponse,
  decodeStatusAndCharge,
  encodeChargeStatusRequest,
  encodeControlRequest,
  encodePinRequest,
  encodeStatusRequest,
} from './tap';

export const TAP_LOGIN_URL = 'https://iov-tap.mgindia.co.in/TAP.Web/ota.mp';
export const TAP_STATUS_URL = 'https://iov-tap.mgindia.co.in/TAP.Web/ota.mpv21';
export const GATEWAY_BASE = 'https://iov-gateway.mgindia.co.in/api.app/v1';
export const USER_AGENT = 'CER_IKE_01/2.3.0 (iPad; iOS 26.3; Scale/2.00)';

export const CONTROL_ATTEMPTS = 15;
export const CONTROL_DELAY_MS = 2000;
export const LOGIN_ATTEMPTS = 3;
export const LOGIN_DELAY_MS = 1500;
export const STATUS_ATTEMPTS = 10;
export const STATUS_DELAY_MS = 1500;

export const STATUS_RESULT_PENDING = [0, 4, 6];
export const STATUS_RESULT_SESSION_INVALID = 2;
export const CHARGE_RESULT_UNAVAILABLE = [5];
export const TYRE_PSI_PER_UNIT = 0.2;
export const PASSWORD_MAX_LEN = 16;

export const LOGIN_DISPATCHER_TEMPLATE_HEX =
  '11005600882c60c183060c183060c183060c183060c183060c183060c183060c183060c183' +
  '060c183060c183060c183060c1ab06200000000020200468acf134468acf1342468acf134' +
  '2468acf1342000000000100a0';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asList(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const key of ['list', 'vehicleList', 'vehicles', 'vinList', 'result']) {
      if (Array.isArray(data[key])) return data[key];
    }
    const nested = data.data;
    if (nested && typeof nested === 'object') {
      return asList(nested);
    }
  }
  return [];
}

function toBool(v: any): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number' && (v === 0 || v === 1)) return Boolean(v);
  return null;
}

function toInt(v: any, minv?: number, maxv?: number): number | null {
  if (v === undefined || v === null || typeof v === 'boolean') return null;
  const i = Math.trunc(Number(v));
  if (Number.isNaN(i)) return null;
  if (minv !== undefined && i < minv) return null;
  if (maxv !== undefined && i > maxv) return null;
  return i;
}

function toTenths(v: any): number | null {
  const i = toInt(v);
  return i === null ? null : i / 10;
}

function toTyrePsi(v: any): number | null {
  const i = toInt(v, 1, 255);
  return i === null ? null : Number((i * TYRE_PSI_PER_UNIT).toFixed(1));
}

const GPS_STATUS_NAMES: Record<string, GpsStatus> = {
  noGpsSignal: GpsStatus.NO_SIGNAL,
  timeFix: GpsStatus.TIME_FIX,
  fix2D: GpsStatus.FIX_2D,
  fix3D: GpsStatus.FIX_3D,
};

function toGpsStatus(v: any): GpsStatus | null {
  if (typeof v === 'string') {
    return GPS_STATUS_NAMES[v] ?? null;
  }
  const i = toInt(v, 0, 3);
  return i === null ? null : (i as GpsStatus);
}

function toMicroDegrees(v: any, limit: number): number | null {
  const i = toInt(v, -limit, limit);
  return i === null ? null : i / 1e6;
}

export function parseGpsPosition(raw: any): GpsPosition | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const wayPoint = raw.wayPoint && typeof raw.wayPoint === 'object' ? raw.wayPoint : {};
  const position = wayPoint.position && typeof wayPoint.position === 'object' ? wayPoint.position : {};
  const timestamp = raw.timestamp4Short;
  const seconds =
    timestamp && typeof timestamp === 'object' ? timestamp.seconds : timestamp;

  const latitude = toMicroDegrees(position.latitude, 90_000_000);
  const longitude = toMicroDegrees(position.longitude, 180_000_000);
  const gpsStatus = toGpsStatus(raw.gpsStatus);
  const hasFix =
    (gpsStatus === GpsStatus.FIX_2D || gpsStatus === GpsStatus.FIX_3D) &&
    latitude !== null &&
    longitude !== null;

  return {
    latitude,
    longitude,
    altitude_m: toInt(position.altitude, -100, 8900),
    heading_deg: toInt(wayPoint.heading, 0, 359),
    speed_kmh: toTenths(toInt(wayPoint.speed, 0, 4500)),
    hdop: toInt(wayPoint.hdop, 0, 1000),
    satellites: toInt(wayPoint.satellites, 0, 16),
    gps_status: gpsStatus,
    position_time: toInt(seconds),
    has_fix: hasFix,
    raw,
  };
}

const SERIES_NAME_MAP: Record<string, string> = {
  EQ100: 'Windsor EV',
  EC32: 'Comet EV',
  ZS11: 'ZS EV',
};

export function parseVehicle(raw: Record<string, any>): Vehicle {
  const vin = raw.vin || raw.VIN || raw.vinNo || raw.vehicleVin;
  if (!vin) {
    throw new MgIndiaApiError('Vehicle response did not include a VIN');
  }
  const rawSeries = raw.series ? String(raw.series).trim().toUpperCase() : '';
  const mappedName = SERIES_NAME_MAP[rawSeries];
  const rawModel = raw.modelName ? String(raw.modelName).trim() : '';

  const name =
    mappedName ||
    (rawModel && rawModel.toUpperCase() === 'WINDSOR' ? 'Windsor EV' : rawModel) ||
    raw.series ||
    raw.brandName ||
    String(vin).slice(-6);

  return {
    vin: String(vin),
    name: String(name),
    brand: raw.brandName ?? null,
    model: mappedName || rawModel || raw.series || null,
    model_year: raw.modelYear ? String(raw.modelYear) : null,
    color_name: raw.colorName ?? null,
    series: raw.series ?? null,
    raw,
  };
}

export function parseStatus(raw: Record<string, any>): Status {
  const basic = raw.basicVehicleStatus || raw;
  const locked = toBool(basic.lockStatus);
  const driverDoor = toBool(basic.driverDoor);
  const passengerDoor = toBool(basic.passengerDoor);
  const rearLeftDoor = toBool(basic.rearLeftDoor);
  const rearRightDoor = toBool(basic.rearRightDoor);
  const boot = toBool(basic.bootStatus);
  const bonnet = toBool(basic.bonnetStatus);
  let driverWindow = toBool(basic.driverWindow);
  const passengerWindow = toBool(basic.passengerWindow);
  const rearLeftWindow = toBool(basic.rearLeftWindow);
  const rearRightWindow = toBool(basic.rearRightWindow);

  // Known MG India stale driver-window-open bit mitigation
  if (
    driverWindow === true &&
    locked === true &&
    ![
      driverDoor,
      passengerDoor,
      rearLeftDoor,
      rearRightDoor,
      boot,
      bonnet,
      passengerWindow,
      rearLeftWindow,
      rearRightWindow,
    ].some(Boolean)
  ) {
    driverWindow = false;
  }

  return {
    status_time: toInt(raw.statusTime),
    locked,
    driver_door_open: driverDoor,
    passenger_door_open: passengerDoor,
    rear_left_door_open: rearLeftDoor,
    rear_right_door_open: rearRightDoor,
    boot_open: boot,
    bonnet_open: bonnet,
    driver_window_open: driverWindow,
    passenger_window_open: passengerWindow,
    rear_left_window_open: rearLeftWindow,
    rear_right_window_open: rearRightWindow,
    sunroof_open: toBool(basic.sunroofStatus),
    climate_running:
      basic.remoteClimateStatus !== undefined && basic.remoteClimateStatus !== null
        ? basic.remoteClimateStatus === 2 || basic.remoteClimateStatus === 3
        : null,
    interior_temperature: toInt(basic.interiorTemperature, -60, 90),
    exterior_temperature: toInt(basic.exteriorTemperature, -60, 90),
    fuel_level: toInt(basic.fuelLevelPrc, 0, 100),
    range_km: toTenths(basic.fuelRange),
    odometer_km: toTenths(basic.mileage),
    aux_battery_voltage: toTenths(basic.batteryVoltage),
    front_left_tyre_psi: toTyrePsi(basic.frontLeftTyrePressure),
    front_right_tyre_psi: toTyrePsi(
      basic.frontRrightTyrePressure !== undefined && basic.frontRrightTyrePressure !== null
        ? basic.frontRrightTyrePressure
        : basic.frontRightTyrePressure
    ),
    rear_left_tyre_psi: toTyrePsi(basic.rearLeftTyrePressure),
    rear_right_tyre_psi: toTyrePsi(basic.rearRightTyrePressure),
    tyre_monitor_status: toInt(basic.wheelTyreMonitorStatus, 0, 255),
    can_bus_active: toBool(basic.canBusActive),
    last_can_activity: toInt(basic.timeOfLastCANBUSActivity),
    handbrake: toBool(basic.handBrake),
    gps: parseGpsPosition(raw.gpsPosition),
    charge: null,
    power_mode_raw: toInt(basic.powerMode, 0, 255),
    engine_status_raw: toInt(basic.engineStatus, 0, 255),
    side_lights_on: toBool(basic.sideLightStatus),
    dipped_beam_on: toBool(basic.dippedBeamStatus),
    main_beam_on: toBool(basic.mainBeamStatus),
    front_left_seat_heat_level: toInt(basic.frontLeftSeatHeatLevel, 0, 255),
    front_right_seat_heat_level: toInt(basic.frontRightSeatHeatLevel, 0, 255),
    raw,
  };
}

export function discoverCapabilities(payloads: Array<Record<string, any>>): Capabilities {
  const cfg: Record<string, any> = {};
  const featureIds = new Set<number>();

  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object') continue;
    for (const block of [payload.configuration, payload.config, payload.modelConfig]) {
      if (block && typeof block === 'object') {
        Object.assign(cfg, block);
      }
    }
    for (const item of asList(payload)) {
      if (item && typeof item === 'object') {
        const fid = Number(item.featureId ?? item.id);
        if (!Number.isNaN(fid)) {
          featureIds.add(fid);
        }
      }
    }
  }

  const enabled = (val: any): boolean =>
    ['1', 'Y', 'YES', 'TRUE', 'ON', 'SUPPORTED'].includes(String(val || '').toUpperCase());

  const remote = enabled(cfg.S61) || featureIds.size > 0;
  const mask = String(cfg.WINDOW || '');
  const windowParamIds: number[] = [];
  const pids = [9, 10, 11, 12];
  for (let i = 0; i < Math.min(mask.length, pids.length); i++) {
    if (['1', 'Y', 'T'].includes(mask[i].toUpperCase())) {
      windowParamIds.push(pids[i]);
    }
  }

  return {
    climate: enabled(cfg.T11) || featureIds.has(2),
    door_lock: remote,
    find_my_car: remote,
    tailgate: remote && enabled(cfg.BOOT),
    sunroof: remote && enabled(cfg.S35),
    heated_seats: remote && enabled(cfg.HeatedSeat),
    window_param_ids: remote ? windowParamIds : [],
  };
}

export function encodeLoginApp(password: string, deviceId: string): Uint8Array {
  const writer = new PackedBitWriter();
  writer.write(1, 1);
  writer.writeString(password.slice(0, PASSWORD_MAX_LEN), 6, 30);
  writer.writeString(deviceId, 1, 200);
  return writer.bytes();
}

export function loginErrorFromResponse(payload: Uint8Array): MgIndiaApiError | null {
  if (payload.length < 4) return null;
  const dispatcherEnd = payload[2] + (payload[3] << 8);
  if (!(dispatcherEnd > 4 && dispatcherEnd <= payload.length)) return null;
  try {
    const dispatcher = codec11.decode('MPDispatcherBodyV11', payload.slice(4, dispatcherEnd));
    const result = dispatcher.result;
    if (!result) return null;
    let message = '';
    if (dispatcher.errorMessage instanceof Uint8Array) {
      message = new TextDecoder().decode(dispatcher.errorMessage).trim();
    }
    const detail = message || `result ${result}`;
    return new MgIndiaLoginRejected(`MG India login rejected: ${detail}`);
  } catch {
    return null;
  }
}

export function decodeLoginResponse(raw: string): [string, string] {
  if (raw.length < 5 || raw[4] !== '1') {
    throw new MgIndiaApiError('Unexpected TAP login response framing');
  }
  let payload: Uint8Array;
  try {
    payload = hexToBytes(raw.slice(5));
  } catch {
    throw new MgIndiaApiError('Invalid TAP login response encoding');
  }
  if (payload.length < 4) {
    throw new MgIndiaApiError('TAP login response is too short');
  }
  const dispatcherLen = payload[2] + (payload[3] << 8);
  if (!(dispatcherLen >= 4 && dispatcherLen <= payload.length)) {
    throw new MgIndiaApiError('Invalid TAP login dispatcher length');
  }
  const error = loginErrorFromResponse(payload);
  if (error !== null) {
    throw error;
  }
  const dispatcher = payload.slice(0, dispatcherLen);
  const app = payload.slice(dispatcherLen);
  if (dispatcher.length < 50 || app.length * 8 < 6 + 40 * 7 + 40 * 7) {
    throw new MgIndiaApiError(
      'Login rejected by MG India server (check phone/password, or the account may not be authorized for this app)'
    );
  }
  const uid = readFixed7Bit(dispatcher, 300, 14).padStart(50, '0');
  const reader = new PackedBitReader(app);
  reader.read(6);
  const token = reader.readString(40, 40);
  const refresh = reader.readString(40, 40);
  if (token !== refresh) {
    throw new MgIndiaApiError('Login token and refresh token differ');
  }
  return [uid, token];
}

export interface MgClientOptions {
  phone: string;
  password: string;
  vin?: string;
  pinHash?: string;
  /**
   * Callback invoked whenever a new session token is issued (initial login or silent auto-relogin)
   */
  onSessionRefreshed?: (session: { uid: string; token: string; phone: string }) => void;
  /**
   * Optional proxy base URL when running in a browser PWA to avoid CORS restrictions.
   * React Native and Node.js do not enforce CORS and can leave this empty.
   */
  proxyBaseUrl?: string;
}

export class MgIndiaClient {
  public phone: string;
  public password: string;
  public vin: string | null;
  public pinHash: string | null;
  public deviceId: string;
  public uid: string | null = null;
  public token: string | null = null;
  public vehicle: Vehicle | null = null;
  public onSessionRefreshed?: (session: { uid: string; token: string; phone: string }) => void;
  public capabilities: Capabilities = {
    climate: false,
    door_lock: false,
    find_my_car: false,
    tailgate: false,
    sunroof: false,
    heated_seats: false,
    window_param_ids: [],
  };
  public proxyBaseUrl: string | null;
  private _event = 1;

  constructor(options: MgClientOptions) {
    this.phone = normalizePhone(options.phone);
    this.password = options.password;
    this.vin = options.vin || null;
    this.pinHash = options.pinHash || null;
    this.deviceId = makeDeviceId(this.phone);
    this.onSessionRefreshed = options.onSessionRefreshed;
    this.proxyBaseUrl = options.proxyBaseUrl || null;
  }

  get hasPin(): boolean {
    return Boolean(this.pinHash);
  }

  private _nextEvent(): number {
    this._event = (this._event + 1) & 0x7fffffff;
    return this._event;
  }

  private _resolveUrl(targetUrl: string): string {
    if (!this.proxyBaseUrl) return targetUrl;
    const base = this.proxyBaseUrl.replace(/\/$/, '');
    return `${base}/?url=${encodeURIComponent(targetUrl)}`;
  }

  public buildLoginBody(): string {
    const dispatcher = hexToBytes(LOGIN_DISPATCHER_TEMPLATE_HEX);
    const app = encodeLoginApp(this.password, this.deviceId);
    setFixed7Bit(dispatcher, 48, this.phone.padStart(50, '0'));
    setMsbBits(dispatcher, 419, 32, Math.floor(Date.now() / 1000));

    const appLenBits = app.length * 2;
    dispatcher[dispatcher.length - 7] = (appLenBits >>> 24) & 0xff;
    dispatcher[dispatcher.length - 6] = (appLenBits >>> 16) & 0xff;
    dispatcher[dispatcher.length - 5] = (appLenBits >>> 8) & 0xff;
    dispatcher[dispatcher.length - 4] = appLenBits & 0xff;
    dispatcher[dispatcher.length - 3] = 1;
    dispatcher[dispatcher.length - 2] = 0;
    dispatcher[dispatcher.length - 1] = 160;

    const payload = new Uint8Array(dispatcher.length + app.length);
    payload.set(dispatcher, 0);
    payload.set(app, dispatcher.length);

    const rawWithoutLength = '1' + bytesToHex(payload, true);
    const lenHex = (rawWithoutLength.length + 4).toString(16).toUpperCase().padStart(4, '0');
    return `${lenHex}${rawWithoutLength}`;
  }

  async login(): Promise<void> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < LOGIN_ATTEMPTS; attempt++) {
      const body = this.buildLoginBody();
      const headers: Record<string, string> = {
        'Content-Type': 'text/plain',
        Accept: '*/*',
        'Accept-Language': 'en-US;q=1',
        'APP-SIGNATURE': tapSignature(body),
        SIGNATURE: '1',
      };
      const response = await fetch(this._resolveUrl(TAP_LOGIN_URL), {
        method: 'POST',
        headers,
        body,
      });
      const text = await response.text();
      if (response.status >= 400) {
        lastError = new MgIndiaApiError(`Login failed: HTTP ${response.status}`);
      } else {
        try {
          const [uid, token] = decodeLoginResponse(text);
          this.uid = uid;
          this.token = token;
          if (this.onSessionRefreshed) {
            try {
              this.onSessionRefreshed({ uid, token, phone: this.phone });
            } catch {
              // ignore callback error
            }
          }
          return;
        } catch (err) {
          if (err instanceof MgIndiaLoginRejected) {
            throw err;
          }
          lastError = err as Error;
        }
      }
      if (attempt < LOGIN_ATTEMPTS - 1) {
        await sleep(LOGIN_DELAY_MS);
      }
    }
    throw new MgIndiaApiError(
      `Login failed after retrying transient TAP response: ${lastError?.message || ''}`
    );
  }

  async gatewayGet(
    path: string,
    params?: Record<string, string>,
    _sessionRetry = true
  ): Promise<Record<string, any>> {
    if (!this.token || !this.uid) {
      await this.login();
    }
    const cleanPath = '/' + path.replace(/^\/+/, '');
    const searchParams = new URLSearchParams(params || {});
    const query = searchParams.toString();
    const signingPath = cleanPath + (query ? `?${query}` : '');
    const timestamp = String(Date.now());
    const contentType = 'application/json';

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'APP-CONTENT-ENCRYPTED': '1',
      'APP-LANGUAGE-TYPE': 'en-us',
      'APP-LOGIN-TOKEN': this.token || '',
      'APP-USER-ID': this.uid || '',
      'APP-SEND-DATE': timestamp,
      'APP-VERIFICATION-STRING': gatewaySignature(signingPath, timestamp, contentType),
      'ORIGINAL-CONTENT-TYPE': contentType,
    };

    const fullUrl = GATEWAY_BASE + signingPath;
    const response = await fetch(this._resolveUrl(fullUrl), {
      method: 'GET',
      headers,
    });
    const text = await response.text();
    if (response.status >= 400) {
      throw new MgIndiaApiError(`Gateway ${cleanPath} failed: HTTP ${response.status}`);
    }

    const respHeaders: Record<string, string | null> = {
      'APP-SEND-DATE':
        response.headers.get('APP-SEND-DATE') ||
        response.headers.get('app-send-date') ||
        response.headers.get('x-mg-send-date'),
      'ORIGINAL-CONTENT-TYPE':
        response.headers.get('ORIGINAL-CONTENT-TYPE') ||
        response.headers.get('original-content-type') ||
        'application/json',
    };

    const decrypted = decryptGatewayBody(text, respHeaders);
    const parsed = JSON.parse(decrypted);
    if (parsed.code === 7) {
      if (!_sessionRetry) {
        throw new MgIndiaApiError('Gateway session remains invalid after login');
      }
      await this.login();
      return this.gatewayGet(path, params, false);
    }
    if (parsed.code !== 0 && parsed.code !== undefined && parsed.code !== null) {
      throw new MgIndiaApiError(parsed.message || `Gateway error code ${parsed.code}`);
    }
    return parsed;
  }

  async vehicles(): Promise<Vehicle[]> {
    const operationVin = this.vin;
    const data = await this.gatewayGet('/vehicle/userVinList');
    const list = asList(data)
      .filter((x) => x && typeof x === 'object')
      .map((x) => parseVehicle(x));

    if (this.vin !== operationVin) {
      throw new MgIndiaApiError('VIN changed during vehicle discovery');
    }
    if (operationVin) {
      this.vehicle = list.find((v) => v.vin === operationVin) || null;
      if (!this.vehicle) {
        throw new MgIndiaApiError('Configured vehicle is absent from the account');
      }
    } else if (list.length > 0) {
      this.vehicle = list[0];
      this.vin = this.vehicle.vin;
    }
    return list;
  }

  async refreshCapabilities(): Promise<Capabilities> {
    if (!this.vin) {
      await this.vehicles();
    }
    const operationVin = this.vin || '';
    const payloads: Array<Record<string, any>> = [];
    for (const path of [
      '/vehicle/feature/list',
      '/vehicle/service/subscription',
      '/navi/vehicle/co2info',
      '/navi/vehicle/co2info/supplementInfo',
    ]) {
      try {
        payloads.push(await this.gatewayGet(path, { vin: operationVin }));
      } catch (err) {
        if (err instanceof MgIndiaLoginRejected) throw err;
      }
    }
    this.capabilities = discoverCapabilities(payloads);
    return this.capabilities;
  }

  private async _postTapFrame(body: string, errorLabel: string): Promise<string> {
    const headers: Record<string, string> = {
      'Content-Type': 'text/plain',
      Accept: '*/*',
      'Accept-Language': 'en-US;q=1',
      SIGNATURE: '1',
      'APP-SIGNATURE': tapSignature(body),
    };
    const response = await fetch(this._resolveUrl(TAP_STATUS_URL), {
      method: 'POST',
      headers,
      body,
    });
    const text = await response.text();
    if (response.status >= 400) {
      throw new MgIndiaApiError(`${errorLabel} failed: HTTP ${response.status}`);
    }
    return text;
  }

  private async _postStatusFrame(eventId: number, errorLabel: string): Promise<string> {
    const body = encodeStatusRequest(
      this.uid || '0'.repeat(50),
      this.token || '0'.repeat(40),
      this.vin || '',
      eventId
    );
    return this._postTapFrame(body, errorLabel);
  }

  private async _postChargeFrame(eventId: number, errorLabel: string): Promise<string> {
    const body = encodeChargeStatusRequest(
      this.uid || '0'.repeat(50),
      this.token || '0'.repeat(40),
      this.vin || '',
      eventId
    );
    return this._postTapFrame(body, errorLabel);
  }

  private async _pollRequest<T>(
    post: (eventId: number, label: string) => Promise<string>,
    want: (status: Record<string, any> | null, charge: ChargeStatus | null) => T | null,
    label: string,
    options: {
      unavailableResults?: number[];
      tolerateFramingErrors?: boolean;
      operationVin?: string | null;
    } = {}
  ): Promise<T | null> {
    const unavailableResults = options.unavailableResults || [];
    const tolerateFramingErrors = options.tolerateFramingErrors || false;
    const operationVin = options.operationVin ?? null;

    for (let loginAttempt = 0; loginAttempt < 2; loginAttempt++) {
      let eventId = 0;
      let reLoginNeeded = false;

      for (let attempt = 0; attempt < STATUS_ATTEMPTS; attempt++) {
        if (this.vin !== operationVin) {
          throw new MgIndiaApiError('VIN changed during polling');
        }
        const text = await post(eventId, label);
        let dispatcher: Record<string, any>;
        let statusPayload: Record<string, any> | null;
        let charge: ChargeStatus | null;

        try {
          [dispatcher, statusPayload, charge] = decodeStatusAndCharge(text);
        } catch (err) {
          if (!tolerateFramingErrors) throw err;
          if (attempt < STATUS_ATTEMPTS - 1) {
            await sleep(STATUS_DELAY_MS);
          }
          continue;
        }

        if (dispatcher.vin !== undefined && dispatcher.vin !== operationVin) {
          throw new MgIndiaApiError('TAP response vehicle does not match request');
        }
        const result = dispatcher.result ?? 0;
        if (result === STATUS_RESULT_SESSION_INVALID) {
          if (loginAttempt === 0) {
            await this.login();
            reLoginNeeded = true;
            break;
          }
          throw new MgIndiaApiError(`TAP ${label.toLowerCase()} session is invalid`);
        }
        if (unavailableResults.includes(result)) {
          return null;
        }
        if (!STATUS_RESULT_PENDING.includes(result)) {
          throw new MgIndiaApiError(`${label} failed: result ${result}`);
        }
        const frame = want(statusPayload, charge);
        if (frame !== null) {
          return frame;
        }
        eventId = dispatcher.eventID ?? eventId;
        if (attempt < STATUS_ATTEMPTS - 1) {
          await sleep(STATUS_DELAY_MS);
        }
      }
      if (!reLoginNeeded) {
        return null;
      }
    }
    return null;
  }

  async status(includeCharge = false): Promise<Status> {
    if (!this.token) {
      await this.login();
    }
    if (!this.vin) {
      await this.vehicles();
    }
    const operationVin = this.vin;

    const statusPayload = await this._pollRequest(
      (eid, lbl) => this._postStatusFrame(eid, lbl),
      (st, _ch) => st,
      'Status',
      { operationVin }
    );
    if (!statusPayload) {
      throw new MgIndiaApiError('Vehicle status was not ready after polling');
    }
    const statusObj = parseStatus(statusPayload);

    if (includeCharge) {
      const chargeObj = await this._pollRequest(
        (eid, lbl) => this._postChargeFrame(eid, lbl),
        (_st, ch) => ch,
        'Status',
        {
          unavailableResults: CHARGE_RESULT_UNAVAILABLE,
          tolerateFramingErrors: true,
          operationVin,
        }
      );
      statusObj.charge = chargeObj;
    }

    return statusObj;
  }

  async chargeStatus(): Promise<ChargeStatus> {
    if (!this.token) {
      await this.login();
    }
    if (!this.vin) {
      await this.vehicles();
    }
    const operationVin = this.vin;

    const chargeObj = await this._pollRequest(
      (eid, lbl) => this._postChargeFrame(eid, lbl),
      (_st, ch) => ch,
      'Charge status',
      {
        unavailableResults: CHARGE_RESULT_UNAVAILABLE,
        tolerateFramingErrors: true,
        operationVin,
      }
    );
    if (!chargeObj) {
      throw new ChargingStatusUnavailable();
    }
    return chargeObj;
  }

  async snapshot(includeCharge = true): Promise<Snapshot> {
    if (!this.vehicle || this.vehicle.vin !== this.vin) {
      await this.vehicles();
    }
    if (!this.vehicle) {
      throw new MgIndiaApiError('No vehicle is available for a snapshot');
    }
    const caps = await this.refreshCapabilities();
    const status = await this.status(includeCharge);
    return {
      vehicle: this.vehicle,
      capabilities: caps,
      status,
      user_info: {},
    };
  }

  async verifyPin(): Promise<void> {
    if (!this.pinHash) {
      throw new MgIndiaApiError('Control PIN is not configured');
    }
    let operationVin = this.vin;
    for (let loginAttempt = 0; loginAttempt < 2; loginAttempt++) {
      if (!this.token || !this.uid) {
        await this.login();
      }
      if (!operationVin) {
        await this.vehicles();
        operationVin = this.vin;
      }
      const body = encodePinRequest(
        this.uid || '0'.repeat(50),
        this.token || '0'.repeat(40),
        operationVin || '',
        this._nextEvent(),
        this.pinHash
      );
      const response = await fetch(this._resolveUrl(TAP_LOGIN_URL), {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          Accept: '*/*',
          'Accept-Language': 'en-US;q=1',
          'APP-SIGNATURE': tapSignature(body),
          SIGNATURE: '1',
        },
        body,
      });
      const text = await response.text();
      if (response.status >= 400) {
        throw new MgIndiaApiError(`PIN verification failed: HTTP ${response.status}`);
      }
      let dispatcher: Record<string, any>;
      try {
        dispatcher = decodePinResponse(text);
      } catch {
        throw new MgIndiaApiError('PIN response could not be decoded');
      }
      const result = dispatcher.result ?? 0;
      if (result === 0) return;
      if (result === 2 && loginAttempt === 0) {
        await this.login();
        continue;
      }
      throw new MgIndiaApiError(`PIN verification failed: result ${result}`);
    }
    throw new MgIndiaApiError('PIN verification failed after token refresh');
  }

  private async _control(
    name: string,
    typ: number,
    params: Array<[number, Uint8Array]>
  ): Promise<void> {
    await this.verifyPin();
    const operationVin = this.vin || '';
    let eventId = 0;

    for (let attempt = 0; attempt < CONTROL_ATTEMPTS; attempt++) {
      const body = encodeControlRequest(
        this.uid || '0'.repeat(50),
        this.token || '0'.repeat(40),
        operationVin,
        eventId,
        typ,
        params
      );
      let text: string;
      try {
        text = await this._postTapFrame(body, name);
      } catch (err) {
        throw new MgIndiaCommandIndeterminate(`${name} completion is unknown: ${(err as Error).message}`);
      }

      let dispatcher: Record<string, any>;
      let control: Record<string, any> | null;
      try {
        [dispatcher, control] = decodeControlResponse(text);
      } catch {
        throw new MgIndiaCommandIndeterminate(`${name} response could not be decoded`);
      }

      const result = dispatcher.result ?? 0;
      if (!STATUS_RESULT_PENDING.includes(result)) {
        throw new MgIndiaCommandIndeterminate(`${name} completion unknown: result ${result}`);
      }
      if (control) {
        const statusBytes: Uint8Array | undefined = control.rvcReqSts;
        if (statusBytes && statusBytes[0] === 2) {
          return;
        }
        if (statusBytes && statusBytes[0] !== 1) {
          throw new MgIndiaApiError(`${name} failed: status ${statusBytes[0]}`);
        }
      }
      eventId = dispatcher.eventID ?? eventId;
      if (!eventId) {
        throw new MgIndiaCommandIndeterminate(`${name} completion unknown: no polling cursor`);
      }
      if (attempt < CONTROL_ATTEMPTS - 1) {
        await sleep(CONTROL_DELAY_MS);
      }
    }
    throw new MgIndiaCommandIndeterminate(`${name} did not complete`);
  }

  async controlClimate(on: boolean): Promise<void> {
    const val = on ? new Uint8Array([3]) : new Uint8Array([0]);
    const params: Array<[number, Uint8Array]> = [
      [19, val],
      [20, val],
      [255, new Uint8Array([0])],
    ];
    await this._control('Climate', 6, params);
  }

  async controlDoorLock(lock: boolean): Promise<void> {
    const params: Array<[number, Uint8Array]> = lock
      ? []
      : [
          [4, new Uint8Array([0])],
          [5, new Uint8Array([0])],
          [6, new Uint8Array([0])],
          [7, new Uint8Array([3])],
          [255, new Uint8Array([0])],
        ];
    await this._control('Door lock', lock ? 1 : 2, params);
  }

  async findMyCar(): Promise<void> {
    await this._control('Find my car', 0, [
      [1, new Uint8Array([1])],
      [2, new Uint8Array([1])],
      [3, new Uint8Array([1])],
      [255, new Uint8Array([0])],
    ]);
  }

  async releaseTailgate(): Promise<void> {
    await this._control('Tailgate', 2, [
      [4, new Uint8Array([0])],
      [5, new Uint8Array([0])],
      [6, new Uint8Array([0])],
      [7, new Uint8Array([2])],
      [255, new Uint8Array([0])],
    ]);
  }

  async controlWindows(openWindows: boolean, ids: number[] = [9, 10, 11, 12]): Promise<void> {
    const selected = new Set(ids);
    const params: Array<[number, Uint8Array]> = [8, 9, 10, 11, 12].map((paramId) => [
      paramId,
      new Uint8Array([selected.has(paramId) ? 1 : 0]),
    ]);
    params.push([13, new Uint8Array([openWindows ? 3 : 0])]);
    await this._control('Windows', 3, params);
  }

  async controlSunroof(openSunroof: boolean): Promise<void> {
    await this._control('Sunroof', 3, [
      [8, new Uint8Array([1])],
      [9, new Uint8Array([0])],
      [10, new Uint8Array([0])],
      [11, new Uint8Array([0])],
      [12, new Uint8Array([0])],
      [13, new Uint8Array([openSunroof ? 3 : 0])],
    ]);
  }

  async controlHeatedSeats(driver: number, passenger: number): Promise<void> {
    if (driver < 0 || driver > 3 || passenger < 0 || passenger > 3) {
      throw new MgIndiaApiError('Heated-seat levels must be between 0 and 3');
    }
    await this._control('Heated seats', 5, [
      [17, new Uint8Array([driver])],
      [18, new Uint8Array([passenger])],
      [255, new Uint8Array([0])],
    ]);
  }
}
