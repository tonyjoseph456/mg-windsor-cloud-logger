/**
 * Pure TypeScript ASN.1 UPER (Unaligned Packed Encoding Rules) Codec
 * Exact implementation of ASN_V21 and ASN_V11 schemas in mg_ismart_india_client/tap.py.
 */
import { PackedBitReader, PackedBitWriter } from './bitcodec';

export type FieldDef =
  | {
      name: string;
      optional?: boolean;
      type: 'int';
      min: number;
      max: number;
    }
  | {
      name: string;
      optional?: boolean;
      type: 'bigint';
      min: bigint;
      max: bigint;
    }
  | {
      name: string;
      optional?: boolean;
      type: 'bool';
    }
  | {
      name: string;
      optional?: boolean;
      type: 'ia5';
      min: number;
      max: number;
    }
  | {
      name: string;
      optional?: boolean;
      type: 'numeric';
      min: number;
      max: number;
    }
  | {
      name: string;
      optional?: boolean;
      type: 'octet';
      min: number;
      max: number;
    }
  | {
      name: string;
      optional?: boolean;
      type: 'enum';
      values: string[];
    }
  | {
      name: string;
      optional?: boolean;
      type: 'seq';
      fields: FieldDef[];
    }
  | {
      name: string;
      optional?: boolean;
      type: 'seqof';
      min: number;
      max: number;
      itemFields: FieldDef[];
    };

function encodeFields(writer: PackedBitWriter, fields: FieldDef[], obj: Record<string, any>): void {
  // 1. Write OPTIONAL bitmap preamble
  for (const field of fields) {
    if (field.optional) {
      const present = obj[field.name] !== undefined && obj[field.name] !== null;
      writer.writeBool(present);
    }
  }
  // 2. Encode each present field in order
  for (const field of fields) {
    const val = obj[field.name];
    if (field.optional && (val === undefined || val === null)) {
      continue;
    }
    if (val === undefined || val === null) {
      throw new Error(`Missing mandatory ASN.1 field: ${field.name}`);
    }
    encodeFieldValue(writer, field, val);
  }
}

function encodeFieldValue(writer: PackedBitWriter, field: FieldDef, val: any): void {
  switch (field.type) {
    case 'int':
      writer.writeConstrainedInt(Number(val), field.min, field.max);
      break;
    case 'bigint':
      writer.writeConstrainedBigInt(BigInt(val), field.min, field.max);
      break;
    case 'bool':
      writer.writeBool(Boolean(val));
      break;
    case 'ia5':
      writer.writeString(String(val), field.min, field.max);
      break;
    case 'numeric':
      writer.writeNumericString(String(val), field.min, field.max);
      break;
    case 'octet': {
      const bytes = val instanceof Uint8Array ? val : new Uint8Array(val);
      writer.writeOctetString(bytes, field.min, field.max);
      break;
    }
    case 'enum': {
      const idx = typeof val === 'number' ? val : field.values.indexOf(String(val));
      if (idx < 0 || idx >= field.values.length) {
        throw new Error(`Invalid enum value ${val} for ${field.name}`);
      }
      writer.writeConstrainedInt(idx, 0, field.values.length - 1);
      break;
    }
    case 'seq':
      encodeFields(writer, field.fields, val);
      break;
    case 'seqof': {
      if (!Array.isArray(val)) {
        throw new Error(`Expected array for SEQUENCE OF ${field.name}`);
      }
      writer.writeConstrainedInt(val.length, field.min, field.max);
      for (const item of val) {
        encodeFields(writer, field.itemFields, item);
      }
      break;
    }
  }
}

function decodeFields(reader: PackedBitReader, fields: FieldDef[]): Record<string, any> {
  const presentMap = new Map<string, boolean>();
  for (const field of fields) {
    if (field.optional) {
      presentMap.set(field.name, reader.readBool());
    }
  }
  const out: Record<string, any> = {};
  for (const field of fields) {
    if (field.optional && !presentMap.get(field.name)) {
      continue;
    }
    out[field.name] = decodeFieldValue(reader, field);
  }
  return out;
}

function decodeFieldValue(reader: PackedBitReader, field: FieldDef): any {
  switch (field.type) {
    case 'int':
      return reader.readConstrainedInt(field.min, field.max);
    case 'bigint':
      return reader.readConstrainedBigInt(field.min, field.max);
    case 'bool':
      return reader.readBool();
    case 'ia5':
      return reader.readString(field.min, field.max);
    case 'numeric':
      return reader.readNumericString(field.min, field.max);
    case 'octet':
      return reader.readOctetString(field.min, field.max);
    case 'enum': {
      const idx = reader.readConstrainedInt(0, field.values.length - 1);
      return field.values[idx];
    }
    case 'seq':
      return decodeFields(reader, field.fields);
    case 'seqof': {
      const count = reader.readConstrainedInt(field.min, field.max);
      const list: any[] = [];
      for (let i = 0; i < count; i++) {
        list.push(decodeFields(reader, field.itemFields));
      }
      return list;
    }
  }
}

// ============================================================================
// ASN_V21 Schema Definitions
// ============================================================================

const DataEncodingTypeValues = ['perUnaligned', 'der', 'ber'];
const GPSStatusValues = ['noGpsSignal', 'timeFix', 'fix2D', 'fix3D'];
const LanguageTypeValues = ['simplifiedChinese', 'english', 'spanish', 'arabic', 'hindi'];

export const MPDispatcherBodySchema: FieldDef[] = [
  { name: 'uid', optional: true, type: 'ia5', min: 50, max: 50 },
  { name: 'token', optional: true, type: 'ia5', min: 40, max: 40 },
  { name: 'applicationID', type: 'ia5', min: 3, max: 3 },
  { name: 'vin', optional: true, type: 'ia5', min: 17, max: 17 },
  { name: 'messageID', type: 'int', min: 0, max: 255 },
  { name: 'eventCreationTime', type: 'int', min: 0, max: 2147483647 },
  { name: 'eventID', optional: true, type: 'int', min: 0, max: 2147483647 },
  { name: 'ulMessageCounter', optional: true, type: 'int', min: 0, max: 65535 },
  { name: 'dlMessageCounter', optional: true, type: 'int', min: 0, max: 65535 },
  { name: 'ackMessageCounter', optional: true, type: 'int', min: 0, max: 65535 },
  { name: 'ackRequired', optional: true, type: 'bool' },
  { name: 'applicationDataLength', optional: true, type: 'int', min: 0, max: 65535 },
  { name: 'applicationDataEncoding', optional: true, type: 'enum', values: DataEncodingTypeValues },
  { name: 'applicationDataProtocolVersion', optional: true, type: 'int', min: 0, max: 65535 },
  { name: 'testFlag', optional: true, type: 'int', min: 1, max: 3 },
  { name: 'result', optional: true, type: 'int', min: 0, max: 65535 },
  { name: 'errorMessage', optional: true, type: 'octet', min: 1, max: 1024 },
];

export const OTARVMVehicleStatusReqSchema: FieldDef[] = [
  { name: 'vehStatusReqType', type: 'int', min: 0, max: 255 },
];

export const RvcReqParamSchema: FieldDef[] = [
  { name: 'paramId', type: 'int', min: 0, max: 65535 },
  { name: 'paramValue', type: 'octet', min: 1, max: 255 },
];

export const OTARVCReqSchema: FieldDef[] = [
  { name: 'rvcReqType', type: 'octet', min: 1, max: 1 },
  { name: 'rvcParams', optional: true, type: 'seqof', min: 1, max: 10, itemFields: RvcReqParamSchema },
];

export const RvsWGS84PointSchema: FieldDef[] = [
  { name: 'latitude', type: 'int', min: -90000000, max: 90000000 },
  { name: 'longitude', type: 'int', min: -180000000, max: 180000000 },
  { name: 'altitude', type: 'int', min: -100, max: 8900 },
];

export const RvsWayPointSchema: FieldDef[] = [
  { name: 'position', type: 'seq', fields: RvsWGS84PointSchema },
  { name: 'heading', type: 'int', min: 0, max: 359 },
  { name: 'speed', type: 'int', min: -1000, max: 4500 },
  { name: 'hdop', type: 'int', min: 0, max: 1000 },
  { name: 'satellites', type: 'int', min: 0, max: 16 },
];

export const Timestamp4ShortSchema: FieldDef[] = [
  { name: 'seconds', type: 'int', min: 0, max: 2147483647 },
];

export const RvsPositionSchema: FieldDef[] = [
  { name: 'wayPoint', type: 'seq', fields: RvsWayPointSchema },
  { name: 'timestamp4Short', type: 'seq', fields: Timestamp4ShortSchema },
  { name: 'gpsStatus', type: 'enum', values: GPSStatusValues },
];

export const RvsBasicStatus513Schema: FieldDef[] = [
  { name: 'driverDoor', type: 'bool' },
  { name: 'passengerDoor', type: 'bool' },
  { name: 'rearLeftDoor', type: 'bool' },
  { name: 'rearRightDoor', type: 'bool' },
  { name: 'bootStatus', type: 'bool' },
  { name: 'bonnetStatus', type: 'bool' },
  { name: 'lockStatus', type: 'bool' },
  { name: 'driverWindow', optional: true, type: 'bool' },
  { name: 'passengerWindow', optional: true, type: 'bool' },
  { name: 'rearLeftWindow', optional: true, type: 'bool' },
  { name: 'rearRightWindow', optional: true, type: 'bool' },
  { name: 'sunroofStatus', optional: true, type: 'bool' },
  { name: 'frontRrightTyrePressure', optional: true, type: 'int', min: 0, max: 255 },
  { name: 'frontLeftTyrePressure', optional: true, type: 'int', min: 0, max: 255 },
  { name: 'rearRightTyrePressure', optional: true, type: 'int', min: 0, max: 255 },
  { name: 'rearLeftTyrePressure', optional: true, type: 'int', min: 0, max: 255 },
  { name: 'wheelTyreMonitorStatus', optional: true, type: 'int', min: 0, max: 255 },
  { name: 'sideLightStatus', type: 'bool' },
  { name: 'dippedBeamStatus', type: 'bool' },
  { name: 'mainBeamStatus', type: 'bool' },
  { name: 'vehicleAlarmStatus', optional: true, type: 'int', min: 0, max: 255 },
  { name: 'engineStatus', type: 'int', min: 0, max: 255 },
  { name: 'powerMode', type: 'int', min: 0, max: 255 },
  { name: 'lastKeySeen', type: 'int', min: 0, max: 65535 },
  { name: 'currentJourneyDistance', type: 'int', min: 0, max: 65535 },
  { name: 'currentJourneyID', type: 'int', min: 0, max: 2147483647 },
  { name: 'interiorTemperature', type: 'int', min: -128, max: 127 },
  { name: 'exteriorTemperature', type: 'int', min: -128, max: 127 },
  { name: 'fuelLevelPrc', type: 'int', min: 0, max: 255 },
  { name: 'fuelRange', type: 'int', min: 0, max: 65535 },
  { name: 'remoteClimateStatus', type: 'int', min: 0, max: 255 },
  { name: 'frontLeftSeatHeatLevel', optional: true, type: 'int', min: 0, max: 255 },
  { name: 'frontRightSeatHeatLevel', optional: true, type: 'int', min: 0, max: 255 },
  { name: 'canBusActive', type: 'bool' },
  { name: 'timeOfLastCANBUSActivity', type: 'int', min: 0, max: 2147483647 },
  { name: 'clstrDspdFuelLvlSgmt', type: 'int', min: 0, max: 255 },
  { name: 'mileage', type: 'int', min: 0, max: 2147483647 },
  { name: 'batteryVoltage', type: 'int', min: 0, max: 65535 },
  { name: 'extendedData1', optional: true, type: 'int', min: 0, max: 2147483647 },
  { name: 'extendedData2', optional: true, type: 'int', min: 0, max: 2147483647 },
  { name: 'handBrake', type: 'bool' },
];

export const VehicleAlertInfoSchema: FieldDef[] = [
  { name: 'id', type: 'int', min: 0, max: 255 },
  { name: 'value', type: 'int', min: 0, max: 255 },
];

export const RvsExtStatusSchema: FieldDef[] = [
  { name: 'vehicleAlerts', type: 'seqof', min: 0, max: 64, itemFields: VehicleAlertInfoSchema },
];

export const OTARVMVehicleStatusResp513Schema: FieldDef[] = [
  { name: 'statusTime', type: 'int', min: 0, max: 2147483647 },
  { name: 'gpsPosition', type: 'seq', fields: RvsPositionSchema },
  { name: 'basicVehicleStatus', type: 'seq', fields: RvsBasicStatus513Schema },
  { name: 'extendedVehicleStatus', optional: true, type: 'seq', fields: RvsExtStatusSchema },
];

export const OTARVCStatus513Schema: FieldDef[] = [
  { name: 'rvcReqType', type: 'octet', min: 1, max: 1 },
  { name: 'rvcReqSts', type: 'octet', min: 1, max: 1 },
  { name: 'failureType', optional: true, type: 'int', min: 0, max: 255 },
  { name: 'gpsPosition', type: 'seq', fields: RvsPositionSchema },
  { name: 'basicVehicleStatus', type: 'seq', fields: RvsBasicStatus513Schema },
];

export const RvsChargingStatusSchema: FieldDef[] = [
  { name: 'realtimePower', type: 'int', min: 0, max: 65535 },
  { name: 'powerLevelPrc', optional: true, type: 'int', min: 0, max: 65535 },
  { name: 'chargingState', type: 'bool' },
  { name: 'chargingGunState', type: 'bool' },
  { name: 'fuelRange', type: 'int', min: 0, max: 65535 },
  { name: 'chargingType', type: 'int', min: 0, max: 255 },
  { name: 'chargingTimeLevelPrc', optional: true, type: 'int', min: 0, max: 65535 },
  { name: 'startTime', optional: true, type: 'int', min: 0, max: 2147483647 },
  { name: 'endTime', optional: true, type: 'int', min: 0, max: 2147483647 },
  { name: 'chargingCurrent', type: 'int', min: 0, max: 65535 },
  { name: 'chargingVoltage', type: 'int', min: 0, max: 65535 },
  { name: 'chargingPileID', optional: true, type: 'ia5', min: 0, max: 64 },
  { name: 'chargingPileSupplier', optional: true, type: 'ia5', min: 0, max: 64 },
  { name: 'workingCurrent', optional: true, type: 'int', min: 0, max: 65535 },
  { name: 'workingVoltage', optional: true, type: 'int', min: 0, max: 65535 },
  { name: 'mileageSinceLastCharge', optional: true, type: 'int', min: 0, max: 65535 },
  { name: 'powerUsageSinceLastCharge', optional: true, type: 'int', min: 0, max: 65535 },
  { name: 'mileageOfDay', optional: true, type: 'int', min: 0, max: 65535 },
  { name: 'powerUsageOfDay', optional: true, type: 'int', min: 0, max: 65535 },
  { name: 'staticEnergyConsumption', optional: true, type: 'int', min: 0, max: 65535 },
  { name: 'chargingElectricityPhase', optional: true, type: 'int', min: 0, max: 255 },
  { name: 'chargingDuration', optional: true, type: 'int', min: 0, max: 2147483647 },
  { name: 'lastChargeEndingPower', optional: true, type: 'int', min: 0, max: 65535 },
  { name: 'totalBatteryCapacity', optional: true, type: 'int', min: 0, max: 65535 },
  { name: 'fotaLowestVoltage', optional: true, type: 'int', min: 0, max: 255 },
  { name: 'mileage', type: 'int', min: 0, max: 2147483647 },
  { name: 'extendedData1', optional: true, type: 'int', min: 0, max: 2147483647 },
  { name: 'extendedData2', optional: true, type: 'int', min: 0, max: 2147483647 },
  { name: 'extendedData3', optional: true, type: 'ia5', min: 0, max: 1024 },
  { name: 'extendedData4', optional: true, type: 'ia5', min: 0, max: 1024 },
];

export const OTARVMVehicleChargingStatusRespSchema: FieldDef[] = [
  { name: 'statusTime', type: 'int', min: 0, max: 2147483647 },
  { name: 'gpsPosition', type: 'seq', fields: RvsPositionSchema },
  { name: 'vehicleChargingStatus', type: 'seq', fields: RvsChargingStatusSchema },
];

// ============================================================================
// ASN_V11 Schema Definitions
// ============================================================================

export const MessageCounterSchema: FieldDef[] = [
  { name: 'uplinkCounter', type: 'int', min: 0, max: 255 },
  { name: 'downlinkCounter', type: 'int', min: 0, max: 255 },
];

export const BasicPositionSchema: FieldDef[] = [
  { name: 'latitude', type: 'int', min: -90000000, max: 90000000 },
  { name: 'longitude', type: 'int', min: -180000000, max: 180000000 },
];

export const NetworkInfoSchema: FieldDef[] = [
  { name: 'mccNetwork', type: 'numeric', min: 3, max: 3 },
  { name: 'mncNetwork', type: 'numeric', min: 3, max: 3 },
  { name: 'mccSim', type: 'numeric', min: 3, max: 3 },
  { name: 'mncSim', type: 'numeric', min: 3, max: 3 },
  { name: 'signalStrength', type: 'int', min: 0, max: 99 },
];

export const MPDispatcherBodyV11Schema: FieldDef[] = [
  { name: 'uid', optional: true, type: 'ia5', min: 50, max: 50 },
  { name: 'token', optional: true, type: 'ia5', min: 40, max: 40 },
  { name: 'applicationID', type: 'ia5', min: 3, max: 3 },
  { name: 'vin', optional: true, type: 'ia5', min: 17, max: 17 },
  { name: 'eventCreationTime', type: 'bigint', min: 0n, max: 4294967295n },
  { name: 'eventID', optional: true, type: 'bigint', min: 0n, max: 281474976710655n },
  { name: 'messageID', type: 'int', min: 0, max: 255 },
  { name: 'messageCounter', optional: true, type: 'seq', fields: MessageCounterSchema },
  { name: 'ackRequired', optional: true, type: 'bool' },
  { name: 'statelessDispatcherMessage', optional: true, type: 'bool' },
  { name: 'crqmRequest', optional: true, type: 'bool' },
  { name: 'basicPosition', optional: true, type: 'seq', fields: BasicPositionSchema },
  { name: 'networkInfo', optional: true, type: 'seq', fields: NetworkInfoSchema },
  { name: 'simInfo', optional: true, type: 'numeric', min: 19, max: 19 },
  { name: 'hmiLanguage', optional: true, type: 'enum', values: LanguageTypeValues },
  { name: 'iccID', type: 'numeric', min: 20, max: 20 },
  { name: 'applicationDataLength', type: 'bigint', min: 0n, max: 4294967295n },
  { name: 'applicationDataEncoding', optional: true, type: 'enum', values: DataEncodingTypeValues },
  { name: 'applicationDataProtocolVersion', type: 'int', min: 0, max: 65535 },
  { name: 'testFlag', optional: true, type: 'int', min: 1, max: 3 },
  { name: 'result', optional: true, type: 'int', min: 0, max: 65535 },
  { name: 'errorMessage', optional: true, type: 'octet', min: 1, max: 1024 },
];

export const PINVerificationReqSchema: FieldDef[] = [
  { name: 'pin', type: 'ia5', min: 32, max: 32 },
];

const V21_TYPES: Record<string, FieldDef[]> = {
  MPDispatcherBody: MPDispatcherBodySchema,
  OTARVMVehicleStatusReq: OTARVMVehicleStatusReqSchema,
  OTARVCReq: OTARVCReqSchema,
  RvsPosition: RvsPositionSchema,
  OTARVMVehicleStatusResp513: OTARVMVehicleStatusResp513Schema,
  OTARVCStatus513: OTARVCStatus513Schema,
  OTARVMVehicleChargingStatusResp: OTARVMVehicleChargingStatusRespSchema,
};

const V11_TYPES: Record<string, FieldDef[]> = {
  MPDispatcherBodyV11: MPDispatcherBodyV11Schema,
  PINVerificationReq: PINVerificationReqSchema,
};

export const codec21 = {
  encode(typeName: string, data: Record<string, any>): Uint8Array {
    const schema = V21_TYPES[typeName];
    if (!schema) throw new Error(`Unknown V21 ASN.1 type: ${typeName}`);
    const writer = new PackedBitWriter();
    encodeFields(writer, schema, data);
    return writer.bytes();
  },
  decode(typeName: string, bytes: Uint8Array): Record<string, any> {
    const schema = V21_TYPES[typeName];
    if (!schema) throw new Error(`Unknown V21 ASN.1 type: ${typeName}`);
    const reader = new PackedBitReader(bytes);
    return decodeFields(reader, schema);
  },
};

export const codec11 = {
  encode(typeName: string, data: Record<string, any>): Uint8Array {
    const schema = V11_TYPES[typeName];
    if (!schema) throw new Error(`Unknown V11 ASN.1 type: ${typeName}`);
    const writer = new PackedBitWriter();
    encodeFields(writer, schema, data);
    return writer.bytes();
  },
  decode(typeName: string, bytes: Uint8Array): Record<string, any> {
    const schema = V11_TYPES[typeName];
    if (!schema) throw new Error(`Unknown V11 ASN.1 type: ${typeName}`);
    const reader = new PackedBitReader(bytes);
    return decodeFields(reader, schema);
  },
};
