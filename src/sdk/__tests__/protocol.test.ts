import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bytesToHex,
  codec11,
  codec21,
  decodeChargeStatus,
  decodeLoginResponse,
  decodeV21,
  discoverCapabilities,
  encodeChargeStatusRequest,
  encodeControlRequest,
  encodeLoginApp,
  encodePinRequest,
  encodeStatusRequest,
  gatewaySignature,
  GpsStatus,
  hashControlPin,
  MgIndiaApiError,
  normalizePhone,
  PackedBitWriter,
  parseGpsPosition,
  parseStatus,
  parseVehicle,
  tapSignature,
} from '../index';

// Captured MG Windsor EV frames from test_charge_status.py
const CHARGING_70 =
  '100C721750000000000000000000000000000000000F0F983060C183060C183060C183' +
  '060C183060C183060C183060C183060C183060C183060C183060C183060C183060C183' +
  '060C18305AC183060B5A3060C16B860C182D60C183060C183060C1830C38B1E46AC58D' +
  '48B4EA56933983060C183060C183109000000000000000000FC0201400000D4FEA4B6A' +
  'BA9500ABA95000190043E801E000000002F3C30004100AF308B6020114D4FDE781AAEB' +
  'CE11373017E13730026415A401600002F4D008200038FE5';

const CHARGING_74 =
  '100C721750000000000000000000000000000000000F0F983060C183060C183060C183' +
  '060C183060C183060C183060C183060C183060C183060C183060C183060C183060C183' +
  '060C18305AC183060B5A3060C16B860C182D60C183060C183060C1830C38B1E46AC58D' +
  '48B4EA56933983060C183060C183109000000000000000000FC0201400000D4FEBAF0A' +
  'BA9500ABA95000192303E801A000000002F3C30004440B93091A0200F7D4FDE781AAEB' +
  'CE11373817E53738026415A4012C00034DB808880038FE5';

const IDLE_100 =
  '100C721750000000000000000000000000000000000F0F983060C183060C183060C183' +
  '060C183060C183060C183060C183060C183060C183060C183060C183060C183060C183' +
  '060C18305AC183060B5A3060C16B860C182D60C183060C183060C1830C38B1E46AC58D' +
  '48B4EA56933983060C183060C183109000000000000000000FC0201400000D4FFAA0AA' +
  'BA9500ABA95000191D63E8025600000002F3C30005D40FA10C8006FFFF000000000000' +
  '0001388018B93880027800000000000000000BA80038FE5';

const CHARGING_17A_SOC45 =
  '100C721750000000000000000000000000000000000F0F983060C183060C183060C183' +
  '060C183060C183060C183060C183060C183060C183060C183060C183060C183060C183' +
  '060C18305AC183060B5A3060C16B860C182D60C183060C183060C1830C38B1E46AC58D' +
  '48B4EA56933983060C183060C183109000000000000000000FC0201400000D508C250A' +
  'BA9500ABA95000191CA3E801E000000002F3C3000298070B058C0201ACD508C125AB01' +
  '8159332817A13328025C0E800218000004B005300039634';

const CHARGING_11A =
  '100C721750000000000000000000000000000000000F0F983060C183060C183060C183' +
  '060C183060C183060C183060C183060C183060C183060C183060C183060C183060C183' +
  '060C18305AC183060B5A3060C16B860C182D60C183060C183060C1830C38B1E46AC58D' +
  '48B4EA56933983060C183060C183109000000000000000000FC0201400000D5010A08A' +
  'BA9500ABA950001926E3E801A000000002F3C30004A80C8309F60200B7D501081DAAF2' +
  '0F49352017E5352002640ABC012C000007B009500039294';

describe('MG iSMART India TypeScript SDK Protocol Suite', () => {
  it('normalizes phone numbers and hashes control PINs', () => {
    assert.equal(normalizePhone('+91 98765 43210'), '9876543210');
    assert.equal(hashControlPin('1234').length, 32);
    assert.equal(tapSignature('0123456789ABCDEF').length, 64);
    assert.equal(gatewaySignature('/vehicle/userVinList', '1700000000000').length, 64);
  });

  it('parses vehicle, tyre pressure, and GPS positions accurately', () => {
    const v = parseVehicle({
      vin: 'LSJA00000TEST0001',
      brandName: 'MG',
      modelName: 'Comet',
      series: 'EC32',
      colorName: 'Nova Blue',
      modelYear: '2025',
    });
    assert.equal(v.model, 'Comet');
    assert.equal(v.series, 'EC32');
    assert.equal(v.color_name, 'Nova Blue');

    const s = parseStatus({
      statusTime: 1,
      basicVehicleStatus: {
        lockStatus: true,
        driverDoor: false,
        fuelLevelPrc: 50,
        fuelRange: 123,
        mileage: 456,
        batteryVoltage: 140,
        frontRrightTyrePressure: 179,
        frontLeftTyrePressure: 169,
        rearRightTyrePressure: 177,
        rearLeftTyrePressure: 169,
        wheelTyreMonitorStatus: 0,
      },
    });
    assert.equal(s.locked, true);
    assert.equal(s.fuel_level, 50);
    assert.equal(s.aux_battery_voltage, 14);
    assert.equal(s.front_left_tyre_psi, 33.8);
    assert.equal(s.front_right_tyre_psi, 35.8);
    assert.equal(s.rear_left_tyre_psi, 33.8);
    assert.equal(s.rear_right_tyre_psi, 35.4);
  });

  it('decodes and re-encodes RvsPosition GPS ASN.1 UPER round-trip', () => {
    const sample = {
      wayPoint: {
        position: { latitude: 12971599, longitude: 77594566, altitude: 920 },
        heading: 180,
        speed: 421,
        hdop: 8,
        satellites: 11,
      },
      timestamp4Short: { seconds: 1755230000 },
      gpsStatus: 'fix3D',
    };
    const encoded = codec21.encode('RvsPosition', sample);
    const decoded = codec21.decode('RvsPosition', encoded);
    assert.equal(decoded.gpsStatus, 'fix3D');

    const gps = parseGpsPosition(decoded);
    assert.ok(gps);
    assert.equal(gps.latitude, 12.971599);
    assert.equal(gps.longitude, 77.594566);
    assert.equal(gps.altitude_m, 920);
    assert.equal(gps.heading_deg, 180);
    assert.equal(gps.speed_kmh, 42.1);
    assert.equal(gps.gps_status, GpsStatus.FIX_3D);
    assert.equal(gps.has_fix, true);
  });

  it('decodes captured MG Windsor EV charging frames (70%, 74%, 80%, 45%, 100%)', () => {
    const s70 = decodeChargeStatus(CHARGING_70);
    assert.ok(s70);
    assert.equal(s70.is_charging, true);
    assert.equal(s70.is_plugged_in, true);
    assert.equal(s70.charging_type, 2);
    assert.equal(s70.soc, 70.0);
    assert.equal(s70.range_km, 223.0);
    assert.equal(s70.charging_voltage, 382.0);
    assert.equal(s70.charging_current, 4.2);
    assert.equal(s70.charge_time_elapsed_s, 24218);
    assert.equal(s70.start_time, 1786704832);
    assert.equal(s70.status_time, 1786729051);
    assert.equal(s70.battery_energy_kwh, 26.0);
    assert.equal(s70.charge_time_remaining_min, 276);
    assert.equal(s70.power_usage_since_last_charge_kwh, 8.8);
    assert.equal(s70.working_voltage, 382.5);
    assert.equal(s70.odometer_km, 23344.5);
    assert.equal(s70.distance_since_last_charge_km, 138.5);

    const s74 = decodeChargeStatus(CHARGING_74);
    assert.ok(s74);
    assert.equal(s74.soc, 74.0);
    assert.equal(s74.charging_voltage, 382.25);
    assert.equal(s74.charging_current, 4.1);
    assert.equal(s74.battery_energy_kwh, 27.3);

    const s11a = decodeChargeStatus(CHARGING_11A);
    assert.ok(s11a);
    assert.equal(s11a.soc, 80.0);
    assert.equal(s11a.charging_current, 10.8);
    assert.equal(s11a.battery_energy_kwh, 29.8);

    const s45 = decodeChargeStatus(CHARGING_17A_SOC45);
    assert.ok(s45);
    assert.equal(s45.soc, 45.0);
    assert.equal(s45.charging_current, 17.1);
    assert.equal(s45.battery_energy_kwh, 16.6);

    const s100 = decodeChargeStatus(IDLE_100);
    assert.ok(s100);
    assert.equal(s100.is_charging, false);
    assert.equal(s100.is_plugged_in, true);
    assert.equal(s100.soc, 100.0);
    assert.equal(s100.range_km, 320.0);
    assert.equal(s100.charging_voltage, 395.5);
    assert.equal(s100.charging_current, 0.0);
    assert.equal(s100.battery_energy_kwh, 37.3);
    assert.equal(s100.charge_time_remaining_min, null);
  });

  it('re-encodes all captured charging frames byte-for-byte identically', () => {
    for (const frame of [CHARGING_70, CHARGING_74, CHARGING_11A, CHARGING_17A_SOC45, IDLE_100]) {
      const [, app] = decodeV21(frame);
      assert.ok(app);
      const decoded = codec21.decode('OTARVMVehicleChargingStatusResp', app);
      const reencoded = codec21.encode('OTARVMVehicleChargingStatusResp', decoded);
      assert.equal(bytesToHex(reencoded), bytesToHex(app));
    }
  });

  it('encodes and decodes V11 login rejection and success responses', () => {
    const body = codec11.encode('MPDispatcherBodyV11', {
      applicationID: '501',
      eventCreationTime: 1n,
      messageID: 1,
      iccID: '12345678901234567890',
      applicationDataLength: 0n,
      applicationDataProtocolVersion: 513,
      result: 15030,
      errorMessage: new TextEncoder().encode('Incorrect password. You may have another 2 attempts'),
    });
    const payload = new Uint8Array(4 + body.length);
    payload[0] = 17;
    payload[1] = 0;
    payload[2] = body.length + 4;
    payload[3] = 0;
    payload.set(body, 4);
    const raw = '00001' + bytesToHex(payload, true);

    assert.throws(
      () => decodeLoginResponse(raw),
      (err: any) => err instanceof MgIndiaApiError && /Incorrect password/.test(err.message)
    );

    // Success round-trip
    const disp = new Uint8Array(50);
    disp[2] = 50;
    disp[3] = 0;
    const writer = new PackedBitWriter();
    writer.write(0, 6);
    writer.writeString('T'.repeat(40), 40, 40);
    writer.writeString('T'.repeat(40), 40, 40);
    const appBytes = writer.bytes();
    const full = new Uint8Array(disp.length + appBytes.length);
    full.set(disp, 0);
    full.set(appBytes, disp.length);
    const [uid, token] = decodeLoginResponse('00001' + bytesToHex(full, true));
    assert.equal(token, 'T'.repeat(40));
    assert.equal(uid.length, 50);
  });

  it('verifies encoders and capability discovery', () => {
    const c = discoverCapabilities([
      {
        configuration: {
          S61: '1',
          T11: '1',
          WINDOW: '1111',
          BOOT: '1',
          S35: '1',
          HeatedSeat: '1',
        },
      },
    ]);
    assert.equal(c.climate, true);
    assert.equal(c.door_lock, true);
    assert.deepEqual(c.window_param_ids, [9, 10, 11, 12]);

    assert.ok(encodeStatusRequest('1'.repeat(50), '2'.repeat(40), '3'.repeat(17), 7));
    assert.ok(
      encodeControlRequest('1'.repeat(50), '2'.repeat(40), '3'.repeat(17), 8, 6, [
        [1, new Uint8Array([1])],
      ])
    );
    assert.ok(encodePinRequest('1'.repeat(50), '2'.repeat(40), '3'.repeat(17), 9, 'A'.repeat(32)));

    const chargeReq = encodeChargeStatusRequest('1'.repeat(50), '2'.repeat(40), '3'.repeat(17), 0);
    const [disp, app] = decodeV21(chargeReq);
    assert.equal(disp.messageID, 8);
    assert.equal(disp.applicationDataLength || 0, 0);
    assert.equal(app, null);

    const longPwd = '0123456789ABCDEFextra-that-app-would-never-see';
    assert.equal(
      bytesToHex(encodeLoginApp(longPwd, 'device-1')),
      bytesToHex(encodeLoginApp(longPwd.slice(0, 16), 'device-1'))
    );
  });
});
