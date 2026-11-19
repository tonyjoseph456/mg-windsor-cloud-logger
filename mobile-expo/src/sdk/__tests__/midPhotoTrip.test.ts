import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeMidTripMetrics,
  extractJpegExifMetadata,
  parseMidAiJsonResponse,
} from '../midPhotoTrip';

function buildMinimalExifJpeg(opts: {
  dateTimeOriginal: string;
  offsetTimeOriginal: string;
  latDeg: number;
  latMin: number;
  latSec: number;
  latRef: 'N' | 'S';
  lngDeg: number;
  lngMin: number;
  lngSec: number;
  lngRef: 'E' | 'W';
}): Uint8Array {
  // Build a valid little-endian TIFF block inside APP1 Exif segment
  const buf = new Uint8Array(512);
  let p = 0;
  // SOI
  buf[p++] = 0xff;
  buf[p++] = 0xd8;
  // APP1 marker
  buf[p++] = 0xff;
  buf[p++] = 0xe1;
  const segLenPos = p;
  p += 2; // segment length filled later
  // Exif\0\0
  for (const ch of 'Exif') buf[p++] = ch.charCodeAt(0);
  buf[p++] = 0;
  buf[p++] = 0;

  const tiffStart = p;
  // II + 0x002A + offset 8
  buf[p++] = 0x49;
  buf[p++] = 0x49;
  buf[p++] = 0x2a;
  buf[p++] = 0x00;
  buf[p++] = 0x08;
  buf[p++] = 0x00;
  buf[p++] = 0x00;
  buf[p++] = 0x00;

  const w16 = (off: number, val: number) => {
    buf[off] = val & 0xff;
    buf[off + 1] = (val >> 8) & 0xff;
  };
  const w32 = (off: number, val: number) => {
    buf[off] = val & 0xff;
    buf[off + 1] = (val >> 8) & 0xff;
    buf[off + 2] = (val >> 16) & 0xff;
    buf[off + 3] = (val >> 24) & 0xff;
  };
  const wStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i);
    buf[off + s.length] = 0;
  };
  const wEntry = (off: number, tag: number, type: number, count: number, valOrOff: number) => {
    w16(off, tag);
    w16(off + 2, type);
    w32(off + 4, count);
    w32(off + 8, valOrOff);
  };

  // IFD0 at tiffStart + 8: 2 entries (ExifIFD + GPSIFD)
  const ifd0 = tiffStart + 8;
  w16(ifd0, 2);
  const exifIfd = ifd0 + 2 + 2 * 12 + 4;
  const gpsIfd = exifIfd + 2 + 2 * 12 + 4;
  const dataArea = gpsIfd + 2 + 4 * 12 + 4;

  wEntry(ifd0 + 2, 0x8769, 4, 1, exifIfd - tiffStart);
  wEntry(ifd0 + 14, 0x8825, 4, 1, gpsIfd - tiffStart);

  // ExifIFD: DateTimeOriginal (0x9003), OffsetTimeOriginal (0x9011)
  let dPtr = dataArea;
  w16(exifIfd, 2);
  const dateOff = dPtr - tiffStart;
  wStr(dPtr, opts.dateTimeOriginal);
  dPtr += opts.dateTimeOriginal.length + 1;
  const tzOff = dPtr - tiffStart;
  wStr(dPtr, opts.offsetTimeOriginal);
  dPtr += opts.offsetTimeOriginal.length + 1;

  wEntry(exifIfd + 2, 0x9003, 2, opts.dateTimeOriginal.length + 1, dateOff);
  wEntry(exifIfd + 14, 0x9011, 2, opts.offsetTimeOriginal.length + 1, tzOff);

  // GPSIFD: 4 entries (LatRef, Lat, LngRef, Lng)
  w16(gpsIfd, 4);
  const writeDms = (deg: number, min: number, sec: number): number => {
    const start = dPtr - tiffStart;
    w32(dPtr, deg);
    w32(dPtr + 4, 1);
    w32(dPtr + 8, min);
    w32(dPtr + 12, 1);
    w32(dPtr + 16, Math.round(sec * 100));
    w32(dPtr + 20, 100);
    dPtr += 24;
    return start;
  };
  const latOff = writeDms(opts.latDeg, opts.latMin, opts.latSec);
  const lngOff = writeDms(opts.lngDeg, opts.lngMin, opts.lngSec);

  wEntry(gpsIfd + 2, 0x0001, 2, 2, opts.latRef.charCodeAt(0));
  wEntry(gpsIfd + 14, 0x0002, 5, 3, latOff);
  wEntry(gpsIfd + 26, 0x0003, 2, 2, opts.lngRef.charCodeAt(0));
  wEntry(gpsIfd + 38, 0x0004, 5, 3, lngOff);

  // EOI
  buf[dPtr++] = 0xff;
  buf[dPtr++] = 0xd9;
  const app1Len = dPtr - segLenPos - 2; // bytes including length field inside segment minus markers
  buf[segLenPos] = (app1Len >> 8) & 0xff;
  buf[segLenPos + 1] = app1Len & 0xff;

  return buf.slice(0, dPtr);
}

test('parseMidAiJsonResponse handles strict JSON, code fences, units, and out-of-range filtering', () => {
  const fenced = parseMidAiJsonResponse(
    '```json\n{"tripKm": "168.1 km", "odoKm": "39,599 km", "socPct": "41%", "dteKm": 130}\n```'
  );
  assert.equal(fenced.tripKm, 168.1);
  assert.equal(fenced.odoKm, 39599);
  assert.equal(fenced.socPct, 41);
  assert.equal(fenced.dteKm, 130);

  const looseProse = parseMidAiJsonResponse(
    'Reading cluster: Trip: 64.9 km, ODO 39193 km, Battery is 81%, range 256 km'
  );
  assert.equal(looseProse.tripKm, 64.9);
  assert.equal(looseProse.odoKm, 39193);
  assert.equal(looseProse.socPct, 81);
  assert.equal(looseProse.dteKm, 256);

  const invalidBounds = parseMidAiJsonResponse(
    '{"tripKm": 99999, "odoKm": -5, "socPct": 140, "dteKm": 2000}'
  );
  assert.deepEqual(invalidBounds, {
    tripKm: null,
    odoKm: null,
    socPct: null,
    dteKm: null,
  });
});

test('extractJpegExifMetadata decodes DateTimeOriginal and DMS GPS coordinates', () => {
  const jpeg = buildMinimalExifJpeg({
    dateTimeOriginal: '2026:11:18 18:10:00',
    offsetTimeOriginal: '+05:30',
    latDeg: 10,
    latMin: 3,
    latSec: 43.64,
    latRef: 'N',
    lngDeg: 76,
    lngMin: 37,
    lngSec: 13.56,
    lngRef: 'E',
  });
  const exif = extractJpegExifMetadata(jpeg);
  assert.equal(exif.timestampSec, Math.floor(Date.parse('2026-11-18T18:10:00+05:30') / 1000));
  assert.ok(exif.lat !== null && Math.abs(exif.lat - 10.062122) < 0.0001);
  assert.ok(exif.lng !== null && Math.abs(exif.lng - 76.620433) < 0.0001);
});

test('computeMidTripMetrics prefers 0.1km Trip delta when consistent and falls back cleanly on reset', () => {
  // Normal trip where ODO moved 12 km (integer) and Trip meter moved 12.4 km (0.1km resolution)
  const normal = computeMidTripMetrics({
    startOdoKm: 39599,
    endOdoKm: 39611,
    startTripKm: 168.1,
    endTripKm: 180.5,
    startSoc: 81,
    endSoc: 76,
    startTimestampSec: 10000,
    endTimestampSec: 11800,
    usableCapacityKwh: 37.3,
  });
  assert.equal(normal.distanceKm, 12.4);
  assert.equal(normal.distanceSource, 'trip_delta');
  assert.equal(normal.socUsedPct, 5);
  assert.equal(normal.energyUsedKwh, 1.87);
  assert.equal(normal.efficiencyKmPerKwh, 6.63);
  assert.equal(normal.durationSeconds, 1800);
  assert.equal(normal.avgSpeedKmh, 24.8);

  // Divergent Trip meter (driver reset Trip mid-drive): use ODO delta
  const reset = computeMidTripMetrics({
    startOdoKm: 39600,
    endOdoKm: 39638,
    startTripKm: 168.1,
    endTripKm: 190.0,
    startSoc: 91,
    endSoc: 80,
    startTimestampSec: 10000,
    endTimestampSec: 13600,
    usableCapacityKwh: 37.3,
  });
  assert.equal(reset.distanceKm, 38);
  assert.equal(reset.distanceSource, 'odo_delta');
});
