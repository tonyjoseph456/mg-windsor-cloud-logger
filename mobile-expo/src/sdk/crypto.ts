/**
 * Cryptographic helpers — 1:1 port of mg_ismart_india_client/crypto.py
 * Works identically in Web Browsers, iOS Safari PWA, React Native, and Node.js.
 */
import CryptoJS from 'crypto-js';

export class MgIndiaApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MgIndiaApiError';
  }
}

export class ChargingStatusUnavailable extends MgIndiaApiError {
  constructor(message = 'Charging status was not available after polling') {
    super(message);
    this.name = 'ChargingStatusUnavailable';
  }
}

export class MgIndiaCommandIndeterminate extends MgIndiaApiError {
  constructor(message: string) {
    super(message);
    this.name = 'MgIndiaCommandIndeterminate';
  }
}

export class MgIndiaLoginRejected extends MgIndiaApiError {
  constructor(message: string) {
    super(message);
    this.name = 'MgIndiaLoginRejected';
  }
}

export function normalizePhone(phone: string): string {
  let digits = (phone || '').replace(/\D/g, '');
  if (digits.length >= 10) {
    digits = digits.slice(-10);
  }
  if (digits.length !== 10) {
    throw new MgIndiaApiError('Use the 10 digit India mobile number');
  }
  return digits;
}

export function makeDeviceId(phone: string): string {
  const normalized = normalizePhone(phone);
  const seed = CryptoJS.SHA256(`mg-ismart-india:${normalized}`).toString(CryptoJS.enc.Hex);
  return (`haos-mg-ismart-india-${seed}` + '0'.repeat(120)).slice(0, 103);
}

export function md5Hex(value: string): string {
  return CryptoJS.MD5(value).toString(CryptoJS.enc.Hex);
}

export function tapSignature(body: string): string {
  const half = Math.floor(body.length / 2);
  const key = md5Hex(body.slice(1, half));
  return CryptoJS.HmacSHA256(body, key).toString(CryptoJS.enc.Hex);
}

export function gatewaySignature(
  path: string,
  timestamp: string,
  contentType = 'application/json'
): string {
  const part1 = md5Hex(path);
  const part2 = md5Hex(part1 + timestamp + '1' + contentType);
  const key = md5Hex(part2 + timestamp);
  return CryptoJS.HmacSHA256(path + timestamp + '1' + contentType, key).toString(
    CryptoJS.enc.Hex
  );
}

export function hashControlPin(pin: string): string {
  if (!/^\d{4}$/.test(pin || '')) {
    throw new MgIndiaApiError('Control PIN must be exactly 4 digits');
  }
  return md5Hex(`${pin}00`).toUpperCase();
}

export function decryptGatewayBody(
  encryptedHex: string,
  headers: Record<string, string | null | undefined>
): string {
  const timestamp =
    headers['APP-SEND-DATE'] ||
    headers['app-send-date'] ||
    '';
  const contentType =
    headers['ORIGINAL-CONTENT-TYPE'] ||
    headers['original-content-type'] ||
    'application/json';

  const keyHex = md5Hex(timestamp + '1' + contentType);
  const ivHex = md5Hex(timestamp);

  const key = CryptoJS.enc.Hex.parse(keyHex);
  const iv = CryptoJS.enc.Hex.parse(ivHex);
  const ciphertext = CryptoJS.enc.Hex.parse(encryptedHex.trim());

  const cipherParams = CryptoJS.lib.CipherParams.create({ ciphertext });
  const decrypted = CryptoJS.AES.decrypt(cipherParams, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });

  return decrypted.toString(CryptoJS.enc.Utf8);
}
