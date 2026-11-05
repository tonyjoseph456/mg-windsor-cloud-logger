/**
 * TAP v1.1 and v2.1 Framing, Encoders, and Decoders
 * 1:1 port of mg_ismart_india_client/tap.py
 */
import { codec11, codec21 } from './asn1-uper';
import { bytesToHex, hexToBytes } from './bitcodec';
import { ChargeStatus } from './models';

export const TAP_RESERVED_SIZE = 16;
export const TAP_PROTOCOL_VERSION = 33;
export const V11_PROTOCOL_VERSION = 17;
export const PROTOCOL = 513;
export const STATUS_APP_ID = '511';
export const CONTROL_APP_ID = '510';
export const PIN_APP_ID = '313';
export const CHARGE_STATUS_MESSAGE_ID = 8;
export const CHARGE_STATUS_APP_LEN = 63;

const SOC_FACTOR = 0.1;
const RANGE_FACTOR = 0.1;
const VOLTAGE_FACTOR = 0.25;
const CURRENT_FACTOR = 0.05;
const CURRENT_ZERO_A = 1000.0;
const MILEAGE_FACTOR = 0.1;
const ENERGY_FACTOR = 0.1;
const WORKING_VOLTAGE_FACTOR = 2.5;
const TIME_LEVEL_NA = 0xffff;

export function frameV21(dispatcher: Uint8Array, app: Uint8Array): string {
  const dispatcherLength = dispatcher.length + 3;
  if (dispatcherLength > 255) {
    throw new Error('TAP dispatcher too large');
  }
  const payload = new Uint8Array(3 + TAP_RESERVED_SIZE + dispatcher.length + app.length);
  payload[0] = TAP_PROTOCOL_VERSION;
  payload[1] = dispatcherLength;
  payload[2] = 0;
  // bytes 3..18 are 0 (TAP_RESERVED_SIZE)
  payload.set(dispatcher, 3 + TAP_RESERVED_SIZE);
  payload.set(app, 3 + TAP_RESERVED_SIZE + dispatcher.length);

  const lenHex = (payload.length + 3).toString(16).toUpperCase().padStart(4, '0');
  return '1' + lenHex + bytesToHex(payload, true);
}

function buildDispatcher(
  uid: string,
  token: string,
  vin: string,
  appId: string,
  app: Uint8Array,
  eventId: number,
  msgId = 1
): Uint8Array {
  return codec21.encode('MPDispatcherBody', {
    uid,
    token,
    applicationID: appId,
    vin,
    messageID: msgId,
    eventCreationTime: Math.floor(Date.now() / 1000),
    eventID: eventId,
    ulMessageCounter: 0,
    dlMessageCounter: 0,
    ackMessageCounter: 0,
    ackRequired: false,
    applicationDataLength: app.length,
    applicationDataEncoding: 'perUnaligned',
    applicationDataProtocolVersion: PROTOCOL,
    testFlag: 2,
    result: 0,
  });
}

export function encodeStatusRequest(
  uid: string,
  token: string,
  vin: string,
  eventId: number
): string {
  const app = codec21.encode('OTARVMVehicleStatusReq', { vehStatusReqType: 2 });
  return frameV21(buildDispatcher(uid, token, vin, STATUS_APP_ID, app, eventId), app);
}

export function encodeChargeStatusRequest(
  uid: string,
  token: string,
  vin: string,
  eventId: number
): string {
  const empty = new Uint8Array(0);
  return frameV21(
    buildDispatcher(uid, token, vin, STATUS_APP_ID, empty, eventId, CHARGE_STATUS_MESSAGE_ID),
    empty
  );
}

export function encodeControlRequest(
  uid: string,
  token: string,
  vin: string,
  eventId: number,
  typ: number,
  params: Array<[number, Uint8Array]>
): string {
  const request: Record<string, any> = {
    rvcReqType: new Uint8Array([typ]),
  };
  if (params.length > 0) {
    request.rvcParams = params.map(([paramId, paramValue]) => ({
      paramId,
      paramValue,
    }));
  }
  const app = codec21.encode('OTARVCReq', request);
  return frameV21(buildDispatcher(uid, token, vin, CONTROL_APP_ID, app, eventId), app);
}

export function encodePinRequest(
  uid: string,
  token: string,
  vin: string,
  _eventId: number,
  pinHash: string
): string {
  const app = codec11.encode('PINVerificationReq', { pin: pinHash });
  const body = codec11.encode('MPDispatcherBodyV11', {
    uid,
    token,
    applicationID: PIN_APP_ID,
    vin,
    eventCreationTime: Math.floor(Date.now() / 1000),
    messageID: 1,
    messageCounter: { uplinkCounter: 1, downlinkCounter: 0 },
    simInfo: '1234567890987654321',
    iccID: '12345678901234567890',
    applicationDataLength: app.length,
    applicationDataEncoding: 'perUnaligned',
    applicationDataProtocolVersion: PROTOCOL,
    testFlag: 2,
  });
  const dispatcherLength = body.length + 4;
  if (dispatcherLength > 255) {
    throw new Error('TAP PIN dispatcher too large');
  }
  const payload = new Uint8Array(4 + body.length + app.length);
  payload[0] = V11_PROTOCOL_VERSION;
  payload[1] = 0;
  payload[2] = dispatcherLength;
  payload[3] = 0;
  payload.set(body, 4);
  payload.set(app, 4 + body.length);

  const lenHex = (payload.length * 2 + 5).toString(16).toUpperCase().padStart(4, '0');
  return `${lenHex}1${bytesToHex(payload, true)}`;
}

export function decodeV21(raw: string): [Record<string, any>, Uint8Array | null] {
  if (raw.length < 5 || raw[0] !== '1') {
    throw new Error('unexpected TAP v2.1 response framing');
  }
  const data = hexToBytes(raw.slice(5));
  if (data.length < 19) {
    throw new Error('short TAP v2.1 response');
  }
  if (data[0] !== TAP_PROTOCOL_VERSION) {
    throw new Error('unsupported TAP response protocol');
  }
  const dispatcherLength = data[1];
  const dispatcherEnd = TAP_RESERVED_SIZE + dispatcherLength;
  if (dispatcherLength < 3 || dispatcherEnd > data.length) {
    throw new Error('invalid TAP dispatcher length');
  }
  let dispatcher: Record<string, any>;
  try {
    dispatcher = codec21.decode('MPDispatcherBody', data.slice(19, dispatcherEnd));
  } catch (err) {
    throw new Error(`invalid TAP dispatcher: ${(err as Error).message}`);
  }
  if (
    dispatcher.applicationDataEncoding !== undefined &&
    dispatcher.applicationDataEncoding !== 'perUnaligned'
  ) {
    throw new Error('unsupported TAP app encoding');
  }
  if (
    dispatcher.applicationDataProtocolVersion !== undefined &&
    dispatcher.applicationDataProtocolVersion !== PROTOCOL
  ) {
    throw new Error('unsupported TAP app protocol');
  }
  const result = dispatcher.result ?? 0;
  if (![0, 4, 6].includes(result)) {
    return [dispatcher, null];
  }
  const appLength = dispatcher.applicationDataLength || 0;
  if (!appLength) {
    return [dispatcher, null];
  }
  const app = data.slice(dispatcherEnd, dispatcherEnd + appLength);
  if (app.length !== appLength) {
    throw new Error('truncated TAP app data');
  }
  return [dispatcher, app];
}

export function decodeStatusResponse(raw: string): [Record<string, any>, Record<string, any> | null] {
  const [disp, app] = decodeV21(raw);
  if (disp.applicationID !== STATUS_APP_ID) {
    throw new Error('unexpected status application identity');
  }
  try {
    return [disp, app ? codec21.decode('OTARVMVehicleStatusResp513', app) : null];
  } catch (err) {
    throw new Error(`invalid TAP status payload: ${(err as Error).message}`);
  }
}

export function decodeControlResponse(raw: string): [Record<string, any>, Record<string, any> | null] {
  const [disp, app] = decodeV21(raw);
  if (disp.applicationID !== CONTROL_APP_ID) {
    throw new Error('unexpected control application identity');
  }
  try {
    return [disp, app ? codec21.decode('OTARVCStatus513', app) : null];
  } catch (err) {
    throw new Error(`invalid TAP control payload: ${(err as Error).message}`);
  }
}

export function decodePinResponse(raw: string): Record<string, any> {
  const hexPart = raw.length >= 5 && raw[4] === '1' ? raw.slice(5) : raw;
  const payload = hexToBytes(hexPart);
  if (payload.length < 4) {
    throw new Error('short TAP PIN header');
  }
  const dispatcherLength = payload[2] + (payload[3] << 8);
  if (payload[0] !== V11_PROTOCOL_VERSION || !(dispatcherLength > 4 && dispatcherLength <= payload.length)) {
    throw new Error('invalid TAP PIN dispatcher header');
  }
  let dispatcher: Record<string, any>;
  try {
    dispatcher = codec11.decode('MPDispatcherBodyV11', payload.slice(4, dispatcherLength));
  } catch (err) {
    throw new Error(`invalid TAP PIN dispatcher: ${(err as Error).message}`);
  }
  if (dispatcher.applicationID !== PIN_APP_ID) {
    throw new Error('unexpected PIN application identity');
  }
  if (
    dispatcher.applicationDataEncoding !== undefined &&
    dispatcher.applicationDataEncoding !== 'perUnaligned'
  ) {
    throw new Error('unsupported TAP PIN encoding');
  }
  if (
    dispatcher.applicationDataProtocolVersion !== undefined &&
    dispatcher.applicationDataProtocolVersion !== PROTOCOL
  ) {
    throw new Error('unsupported TAP PIN protocol');
  }
  const appLength = dispatcher.applicationDataLength || 0;
  if (dispatcherLength + appLength > payload.length) {
    throw new Error('truncated TAP PIN app data');
  }
  return dispatcher;
}

function amps(raw: number | undefined | null): number | null {
  if (raw === undefined || raw === null) return null;
  return Number((CURRENT_ZERO_A - raw * CURRENT_FACTOR).toFixed(4));
}

function scaled(raw: number | undefined | null, factor: number): number | null {
  if (raw === undefined || raw === null) return null;
  return Number((raw * factor).toFixed(4));
}

export function decodeChargeApp(app: Uint8Array | null): ChargeStatus | null {
  if (!app || app.length !== CHARGE_STATUS_APP_LEN) {
    return null;
  }
  try {
    const frame = codec21.decode('OTARVMVehicleChargingStatusResp', app);
    const cs = frame.vehicleChargingStatus;
    const soc = cs.powerLevelPrc;
    const timeLevel = cs.chargingTimeLevelPrc;

    return {
      is_charging: Boolean(cs.chargingState),
      is_plugged_in: Boolean(cs.chargingGunState),
      charging_type: cs.chargingType,
      charging_electricity_phase: cs.chargingElectricityPhase ?? null,
      soc:
        soc !== undefined && soc !== null && soc >= 0 && soc <= 1000
          ? scaled(soc, SOC_FACTOR)
          : null,
      range_km: Number((cs.fuelRange * RANGE_FACTOR).toFixed(2)),
      charging_voltage: Number((cs.chargingVoltage * VOLTAGE_FACTOR).toFixed(2)),
      charging_current: amps(cs.chargingCurrent),
      battery_energy_kwh: Number((cs.realtimePower * ENERGY_FACTOR).toFixed(2)),
      working_voltage: scaled(cs.workingVoltage, WORKING_VOLTAGE_FACTOR),
      working_current: amps(cs.workingCurrent),
      charge_time_elapsed_s: cs.chargingDuration ?? null,
      start_time: cs.startTime || null,
      end_time: cs.endTime || null,
      charge_time_remaining_min:
        timeLevel === undefined || timeLevel === TIME_LEVEL_NA ? null : timeLevel,
      charging_pile_id: cs.chargingPileID || null,
      charging_pile_supplier: cs.chargingPileSupplier || null,
      odometer_km: Number((cs.mileage * MILEAGE_FACTOR).toFixed(2)),
      distance_since_last_charge_km: scaled(cs.mileageSinceLastCharge, MILEAGE_FACTOR),
      power_usage_since_last_charge_kwh: scaled(cs.powerUsageSinceLastCharge, ENERGY_FACTOR),
      mileage_of_day_raw: cs.mileageOfDay ?? null,
      power_usage_of_day_raw: cs.powerUsageOfDay ?? null,
      static_energy_consumption_raw: cs.staticEnergyConsumption ?? null,
      total_battery_capacity_kwh: scaled(cs.totalBatteryCapacity, ENERGY_FACTOR),
      last_charge_ending_power_kwh: scaled(cs.lastChargeEndingPower, ENERGY_FACTOR),
      fota_lowest_voltage_raw: cs.fotaLowestVoltage ?? null,
      status_time: frame.statusTime,
      extended_data_1: cs.extendedData1 ?? null,
      extended_data_2: cs.extendedData2 ?? null,
      extended_data_3: cs.extendedData3 || null,
      extended_data_4: cs.extendedData4 || null,
      _raw: cs,
    };
  } catch {
    return null;
  }
}

export function decodeChargeStatusResponse(
  raw: string
): [Record<string, any>, ChargeStatus | null] {
  const [dispatcher, app] = decodeV21(raw);
  if (dispatcher.applicationID !== STATUS_APP_ID) {
    throw new Error('unexpected status application identity');
  }
  return [dispatcher, decodeChargeApp(app)];
}

export function decodeStatusAndCharge(
  raw: string
): [Record<string, any>, Record<string, any> | null, ChargeStatus | null] {
  const [dispatcher, app] = decodeV21(raw);
  if (dispatcher.applicationID !== STATUS_APP_ID) {
    throw new Error('unexpected status application identity');
  }
  if (!app) {
    return [dispatcher, null, null];
  }
  const charge = decodeChargeApp(app);
  if (charge !== null) {
    return [dispatcher, null, charge];
  }
  let status: Record<string, any> | null = null;
  try {
    status = codec21.decode('OTARVMVehicleStatusResp513', app);
  } catch {
    status = null;
  }
  return [dispatcher, status, charge];
}

export function decodeChargeStatus(raw: string): ChargeStatus | null {
  try {
    return decodeChargeStatusResponse(raw)[1];
  } catch {
    return null;
  }
}
