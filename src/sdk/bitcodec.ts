/**
 * PackedBitReader & PackedBitWriter — 1:1 port of mg_ismart_india_client/bitcodec.py
 * Also powers our ASN.1 UPER (Unaligned Packed Encoding Rules) codec.
 */

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error('Invalid hex character');
    }
    out[i] = byte;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array, upper = true): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return upper ? out.toUpperCase() : out;
}

export class PackedBitReader {
  public data: Uint8Array;
  public offset = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  read(count: number): number {
    if (count < 0 || this.offset + count > this.data.length * 8) {
      throw new Error('truncated packed bit field');
    }
    let value = 0;
    for (let i = 0; i < count; i++) {
      const absolute = this.offset;
      this.offset += 1;
      const bit = (this.data[Math.floor(absolute / 8)] >> (7 - (absolute % 8))) & 1;
      value = value * 2 + bit;
    }
    return value;
  }

  readBigInt(count: number): bigint {
    if (count < 0 || this.offset + count > this.data.length * 8) {
      throw new Error('truncated packed bit field');
    }
    let value = 0n;
    for (let i = 0; i < count; i++) {
      const absolute = this.offset;
      this.offset += 1;
      const bit = BigInt((this.data[Math.floor(absolute / 8)] >> (7 - (absolute % 8))) & 1);
      value = (value << 1n) | bit;
    }
    return value;
  }

  readBool(): boolean {
    return this.read(1) === 1;
  }

  readString(minimum: number, maximum: number): string {
    const span = maximum - minimum;
    const lengthBits = span > 0 ? Math.ceil(Math.log2(span + 1)) : 0;
    const length = minimum + (span > 0 ? this.read(lengthBits) : 0);
    let out = '';
    for (let i = 0; i < length; i++) {
      out += String.fromCharCode(this.read(7));
    }
    return out;
  }

  readNumericString(minimum: number, maximum: number): string {
    // UPER NumericString alphabet: " 0123456789" (11 chars -> 4 bits per char)
    const alphabet = ' 0123456789';
    const span = maximum - minimum;
    const lengthBits = span > 0 ? Math.ceil(Math.log2(span + 1)) : 0;
    const length = minimum + (span > 0 ? this.read(lengthBits) : 0);
    let out = '';
    for (let i = 0; i < length; i++) {
      const idx = this.read(4);
      if (idx >= alphabet.length) {
        throw new Error('Invalid NumericString character index');
      }
      out += alphabet[idx];
    }
    return out;
  }

  readOctetString(minimum: number, maximum: number): Uint8Array {
    const span = maximum - minimum;
    const lengthBits = span > 0 ? Math.ceil(Math.log2(span + 1)) : 0;
    const length = minimum + (span > 0 ? this.read(lengthBits) : 0);
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      out[i] = this.read(8);
    }
    return out;
  }

  readConstrainedInt(min: number, max: number): number {
    const span = max - min;
    if (span === 0) return min;
    const bits = Math.ceil(Math.log2(span + 1));
    const offsetVal = this.read(bits);
    const result = min + offsetVal;
    if (result > max) {
      throw new Error(`Decoded integer ${result} exceeds max ${max}`);
    }
    return result;
  }

  readConstrainedBigInt(min: bigint, max: bigint): number {
    const span = max - min;
    if (span === 0n) return Number(min);
    let bits = 0;
    let temp = span;
    while (temp > 0n) {
      bits++;
      temp >>= 1n;
    }
    const offsetVal = this.readBigInt(bits);
    const result = min + offsetVal;
    if (result > max) {
      throw new Error(`Decoded bigint ${result} exceeds max ${max}`);
    }
    return Number(result);
  }
}

export class PackedBitWriter {
  public bits: number[] = [];

  write(value: number, count: number): void {
    if (count === 0) return;
    if (value < 0 || (count < 31 && value >= (1 << count)) || (count >= 31 && value >= Math.pow(2, count))) {
      throw new Error('bit value out of range');
    }
    for (let shift = count - 1; shift >= 0; shift--) {
      const bit = Math.floor(value / Math.pow(2, shift)) & 1;
      this.bits.push(bit);
    }
  }

  writeBigInt(value: bigint, count: number): void {
    if (count === 0) return;
    if (value < 0n || value >= (1n << BigInt(count))) {
      throw new Error('bigint bit value out of range');
    }
    for (let shift = count - 1; shift >= 0; shift--) {
      this.bits.push(Number((value >> BigInt(shift)) & 1n));
    }
  }

  writeBool(value: boolean): void {
    this.bits.push(value ? 1 : 0);
  }

  writeString(value: string, minimum: number, maximum: number): void {
    const span = maximum - minimum;
    if (value.length < minimum || value.length > maximum) {
      throw new Error(`string length ${value.length} out of range [${minimum}..${maximum}]`);
    }
    if (span > 0) {
      this.write(value.length - minimum, Math.ceil(Math.log2(span + 1)));
    }
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code > 127) {
        throw new Error('IA5String character out of range');
      }
      this.write(code, 7);
    }
  }

  writeNumericString(value: string, minimum: number, maximum: number): void {
    const alphabet = ' 0123456789';
    const span = maximum - minimum;
    if (value.length < minimum || value.length > maximum) {
      throw new Error(`numeric string length ${value.length} out of range [${minimum}..${maximum}]`);
    }
    if (span > 0) {
      this.write(value.length - minimum, Math.ceil(Math.log2(span + 1)));
    }
    for (let i = 0; i < value.length; i++) {
      const idx = alphabet.indexOf(value[i]);
      if (idx === -1) {
        throw new Error(`Invalid NumericString char: ${value[i]}`);
      }
      this.write(idx, 4);
    }
  }

  writeOctetString(value: Uint8Array, minimum: number, maximum: number): void {
    const span = maximum - minimum;
    if (value.length < minimum || value.length > maximum) {
      throw new Error(`octet string length ${value.length} out of range [${minimum}..${maximum}]`);
    }
    if (span > 0) {
      this.write(value.length - minimum, Math.ceil(Math.log2(span + 1)));
    }
    for (let i = 0; i < value.length; i++) {
      this.write(value[i], 8);
    }
  }

  writeConstrainedInt(value: number, min: number, max: number): void {
    if (value < min || value > max) {
      throw new Error(`Integer ${value} out of constrained range [${min}..${max}]`);
    }
    const span = max - min;
    if (span === 0) return;
    const bits = Math.ceil(Math.log2(span + 1));
    this.write(value - min, bits);
  }

  writeConstrainedBigInt(value: bigint, min: bigint, max: bigint): void {
    if (value < min || value > max) {
      throw new Error(`BigInt ${value} out of constrained range [${min}..${max}]`);
    }
    const span = max - min;
    if (span === 0n) return;
    let bits = 0;
    let temp = span;
    while (temp > 0n) {
      bits++;
      temp >>= 1n;
    }
    this.writeBigInt(value - min, bits);
  }

  bytes(): Uint8Array {
    const byteCount = Math.ceil(this.bits.length / 8);
    const out = new Uint8Array(byteCount);
    for (let start = 0; start < this.bits.length; start += 8) {
      let val = 0;
      const chunkLen = Math.min(8, this.bits.length - start);
      for (let i = 0; i < chunkLen; i++) {
        val = (val << 1) | this.bits[start + i];
      }
      out[start / 8] = val << (8 - chunkLen);
    }
    return out;
  }
}

export function setMsbBits(buf: Uint8Array, offset: number, count: number, value: number): void {
  if (value < 0 || (count < 31 && value >= (1 << count)) || (count >= 31 && value >= Math.pow(2, count))) {
    throw new Error('bit value out of range');
  }
  for (let idx = 0; idx < count; idx++) {
    const absolute = offset + idx;
    const mask = 1 << (7 - (absolute % 8));
    const shift = count - 1 - idx;
    const bit = Math.floor(value / Math.pow(2, shift)) & 1;
    if (bit === 1) {
      buf[Math.floor(absolute / 8)] |= mask;
    } else {
      buf[Math.floor(absolute / 8)] &= ~mask;
    }
  }
}

export function setFixed7Bit(buf: Uint8Array, offset: number, value: string): void {
  for (let idx = 0; idx < value.length; idx++) {
    setMsbBits(buf, offset + idx * 7, 7, value.charCodeAt(idx));
  }
}

export function readMsbBits(buf: Uint8Array, offset: number, count: number): number {
  if (offset < 0 || count < 0 || offset + count > buf.length * 8) {
    throw new Error('truncated fixed bit field');
  }
  let value = 0;
  for (let idx = 0; idx < count; idx++) {
    const absolute = offset + idx;
    const bit = (buf[Math.floor(absolute / 8)] >> (7 - (absolute % 8))) & 1;
    value = value * 2 + bit;
  }
  return value;
}

export function readFixed7Bit(buf: Uint8Array, offset: number, count: number): string {
  let out = '';
  for (let idx = 0; idx < count; idx++) {
    out += String.fromCharCode(readMsbBits(buf, offset + idx * 7, 7));
  }
  return out;
}
