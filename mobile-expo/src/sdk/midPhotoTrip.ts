/**
 * Offline MID (Multi-Information Display) Photo Trip Logger helpers.
 * Pure TypeScript so Vision JSON parsing, JPEG EXIF metadata extraction,
 * and ODO/Trip/SOC physics calculations run identically in PWA, Node tests,
 * and Cloudflare Workers.
 */

export interface MidExtractedReading {
  tripKm: number | null;
  odoKm: number | null;
  socPct: number | null;
  dteKm: number | null;
}

export interface JpegExifMetadata {
  timestampSec: number | null;
  lat: number | null;
  lng: number | null;
}

export interface ComputedMidTripMetrics {
  distanceKm: number;
  distanceSource: 'trip_delta' | 'odo_delta' | 'end_trip' | 'none';
  startOdoKm: number;
  endOdoKm: number;
  startSoc: number;
  endSoc: number;
  socUsedPct: number;
  energyUsedKwh: number;
  efficiencyKmPerKwh: number;
  durationSeconds: number;
  avgSpeedKmh: number;
  startEnergyKwh: number;
  endEnergyKwh: number;
}

export const MID_PHOTO_VISION_PROMPT =
  'Read ONLY the bottom-left telemetry numbers of this MG Windsor EV instrument cluster (MID) photo. ' +
  'Look specifically for: ' +
  '1) "Trip" distance in km (decimal like 168.1), ' +
  '2) "ODO" total odometer in km (integer like 39599), ' +
  '3) Battery state-of-charge percentage shown inside the small green/gray battery bar (% like 41), and ' +
  '4) Remaining driving range DTE in km right beside the battery bar (like 130). ' +
  'Ignore Power kW and Speed km/h. ' +
  'Respond ONLY with raw JSON and no extra text using keys: ' +
  '{"tripKm": number|null, "odoKm": number|null, "socPct": number|null, "dteKm": number|null}.';

function parseNumericToken(val: unknown): number | null {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val === 'string') {
    const m = val.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clampField(
  raw: number | null,
  min: number,
  max: number,
  decimals = 1
): number | null {
  if (raw === null || !Number.isFinite(raw)) return null;
  if (raw < min || raw > max) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(raw * factor) / factor;
}

export function sanitizeMidExtractedReading(raw: unknown): MidExtractedReading {
  if (!raw || typeof raw !== 'object') {
    return { tripKm: null, odoKm: null, socPct: null, dteKm: null };
  }
  const obj = raw as Record<string, unknown>;
  const rawTrip =
    obj.tripKm ?? obj.trip_km ?? obj.tripDistanceKm ?? obj.trip_distance ?? obj.trip;
  const rawOdo =
    obj.odoKm ?? obj.odo_km ?? obj.odometerKm ?? obj.odometer_km ?? obj.odometer ?? obj.odo;
  const rawSoc =
    obj.socPct ?? obj.soc_pct ?? obj.soc ?? obj.batteryPct ?? obj.battery_pct ?? obj.battery;
  const rawDte =
    obj.dteKm ?? obj.dte_km ?? obj.rangeKm ?? obj.range_km ?? obj.dte ?? obj.range;

  return {
    tripKm: clampField(parseNumericToken(rawTrip), 0, 9999.9, 1),
    odoKm: clampField(parseNumericToken(rawOdo), 0, 1000000, 1),
    socPct: clampField(parseNumericToken(rawSoc), 0, 100, 1),
    dteKm: clampField(parseNumericToken(rawDte), 0, 1000, 0),
  };
}

export function parseMidAiJsonResponse(rawText: string): MidExtractedReading {
  const empty: MidExtractedReading = { tripKm: null, odoKm: null, socPct: null, dteKm: null };
  if (typeof rawText !== 'string' || !rawText.trim()) return empty;

  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const tryParse = (candidate: string): MidExtractedReading | null => {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return sanitizeMidExtractedReading(parsed);
      }
    } catch {
      return null;
    }
    return null;
  };

  const direct = tryParse(cleaned);
  if (direct) return direct;

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const sliced = tryParse(cleaned.slice(firstBrace, lastBrace + 1));
    if (sliced) return sliced;
  }

  // Regex fallback if model answered in prose rather than strict JSON
  const tripMatch = cleaned.match(/trip\D{0,12}(\d+(?:\.\d+)?)/i);
  const odoMatch = cleaned.match(/odo(?:meter)?\D{0,12}(\d[\d,]*(?:\.\d+)?)/i);
  const socMatch = cleaned.match(/(?:soc|battery|%)\D{0,12}(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*%/i);
  const dteMatch = cleaned.match(/(?:dte|range)\D{0,12}(\d+(?:\.\d+)?)/i);

  return sanitizeMidExtractedReading({
    tripKm: tripMatch?.[1] ?? null,
    odoKm: odoMatch?.[1] ?? null,
    socPct: socMatch?.[1] ?? socMatch?.[2] ?? null,
    dteKm: dteMatch?.[1] ?? null,
  });
}

function readU16(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  if (offset < 0 || offset + 2 > bytes.length) return 0;
  return littleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function readU32(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
  if (offset < 0 || offset + 4 > bytes.length) return 0;
  if (littleEndian) {
    return (
      (bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)) >>>
      0
    );
  }
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function readAscii(bytes: Uint8Array, start: number, maxLen: number): string {
  const end = Math.min(bytes.length, start + maxLen);
  let out = '';
  for (let i = start; i < end; i++) {
    const ch = bytes[i];
    if (ch === 0) break;
    if (ch >= 32 && ch <= 126) {
      out += String.fromCharCode(ch);
    }
  }
  return out.trim();
}

function getExifStringTag(
  bytes: Uint8Array,
  tiffStart: number,
  type: number,
  count: number,
  valOrOffsetBytesPos: number,
  littleEndian: boolean
): string {
  if (type !== 2 || count <= 0 || count > 256) return '';
  if (count <= 4) {
    return readAscii(bytes, valOrOffsetBytesPos, count);
  }
  const relOffset = readU32(bytes, valOrOffsetBytesPos, littleEndian);
  return readAscii(bytes, tiffStart + relOffset, count);
}

function getExifDmsTag(
  bytes: Uint8Array,
  tiffStart: number,
  type: number,
  count: number,
  valOrOffsetBytesPos: number,
  littleEndian: boolean
): number | null {
  if ((type !== 5 && type !== 10) || count < 3) return null;
  const relOffset = readU32(bytes, valOrOffsetBytesPos, littleEndian);
  const abs = tiffStart + relOffset;
  if (abs < 0 || abs + 24 > bytes.length) return null;
  const degNum = readU32(bytes, abs, littleEndian);
  const degDen = readU32(bytes, abs + 4, littleEndian);
  const minNum = readU32(bytes, abs + 8, littleEndian);
  const minDen = readU32(bytes, abs + 12, littleEndian);
  const secNum = readU32(bytes, abs + 16, littleEndian);
  const secDen = readU32(bytes, abs + 20, littleEndian);
  if (!degDen || !minDen || !secDen) return null;
  const val = degNum / degDen + minNum / minDen / 60 + secNum / secDen / 3600;
  return Number.isFinite(val) ? val : null;
}

function parseExifDateTimeToUnixSec(dateStr: string, offsetStr?: string): number | null {
  const m = dateStr.trim().match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss] = m;
  const cleanOffset = (offsetStr || '').trim();
  if (/^(Z|[+-]\d{2}:\d{2})$/i.test(cleanOffset)) {
    const ms = Date.parse(`${y}-${mo}-${d}T${hh}:${mm}:${ss}${cleanOffset}`);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  const dt = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(hh),
    Number(mm),
    Number(ss)
  );
  const ms = dt.getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * Extracts DateTimeOriginal + GPS Latitude/Longitude from raw JPEG EXIF bytes
 * without external dependencies (supports both little-endian II and big-endian MM TIFF).
 */
export function extractJpegExifMetadata(bytes: Uint8Array): JpegExifMetadata {
  const empty: JpegExifMetadata = { timestampSec: null, lat: null, lng: null };
  if (!(bytes instanceof Uint8Array) || bytes.length < 16) return empty;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return empty;

  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break; // SOS / EOI
    const segLen = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segLen < 2 || offset + 2 + segLen > bytes.length) break;

    if (marker === 0xe1 && offset + 10 < bytes.length) {
      const hdr = readAscii(bytes, offset + 4, 4);
      if (hdr === 'Exif' && bytes[offset + 8] === 0 && bytes[offset + 9] === 0) {
        const tiffStart = offset + 10;
        if (tiffStart + 8 > bytes.length) return empty;
        const endianByte0 = bytes[tiffStart];
        const endianByte1 = bytes[tiffStart + 1];
        const littleEndian = endianByte0 === 0x49 && endianByte1 === 0x49;
        const bigEndian = endianByte0 === 0x4d && endianByte1 === 0x4d;
        if (!littleEndian && !bigEndian) return empty;
        if (readU16(bytes, tiffStart + 2, littleEndian) !== 42) return empty;

        const ifd0Offset = readU32(bytes, tiffStart + 4, littleEndian);
        const ifd0Abs = tiffStart + ifd0Offset;
        if (ifd0Abs + 2 > bytes.length) return empty;

        let exifIfdOffset: number | null = null;
        let gpsIfdOffset: number | null = null;
        let ifd0Date = '';
        let dateOriginal = '';
        let dateDigitized = '';
        let offsetTime = '';
        let latRef = '';
        let lngRef = '';
        let latVal: number | null = null;
        let lngVal: number | null = null;

        const scanIfd = (ifdAbs: number, handler: (tag: number, type: number, count: number, valPos: number) => void) => {
          if (ifdAbs < 0 || ifdAbs + 2 > bytes.length) return;
          const entryCount = readU16(bytes, ifdAbs, littleEndian);
          const safeCount = Math.min(entryCount, 200);
          for (let i = 0; i < safeCount; i++) {
            const ent = ifdAbs + 2 + i * 12;
            if (ent + 12 > bytes.length) break;
            const tag = readU16(bytes, ent, littleEndian);
            const type = readU16(bytes, ent + 2, littleEndian);
            const count = readU32(bytes, ent + 4, littleEndian);
            handler(tag, type, count, ent + 8);
          }
        };

        scanIfd(ifd0Abs, (tag, type, count, valPos) => {
          if (tag === 0x0132) {
            ifd0Date = getExifStringTag(bytes, tiffStart, type, count, valPos, littleEndian);
          } else if (tag === 0x8769) {
            exifIfdOffset = readU32(bytes, valPos, littleEndian);
          } else if (tag === 0x8825) {
            gpsIfdOffset = readU32(bytes, valPos, littleEndian);
          }
        });

        if (exifIfdOffset !== null) {
          scanIfd(tiffStart + exifIfdOffset, (tag, type, count, valPos) => {
            if (tag === 0x9003) {
              dateOriginal = getExifStringTag(bytes, tiffStart, type, count, valPos, littleEndian);
            } else if (tag === 0x9004) {
              dateDigitized = getExifStringTag(bytes, tiffStart, type, count, valPos, littleEndian);
            } else if (tag === 0x9011) {
              offsetTime = getExifStringTag(bytes, tiffStart, type, count, valPos, littleEndian);
            }
          });
        }

        if (gpsIfdOffset !== null) {
          scanIfd(tiffStart + gpsIfdOffset, (tag, type, count, valPos) => {
            if (tag === 0x0001) {
              latRef = getExifStringTag(bytes, tiffStart, type, count, valPos, littleEndian).toUpperCase();
            } else if (tag === 0x0002) {
              latVal = getExifDmsTag(bytes, tiffStart, type, count, valPos, littleEndian);
            } else if (tag === 0x0003) {
              lngRef = getExifStringTag(bytes, tiffStart, type, count, valPos, littleEndian).toUpperCase();
            } else if (tag === 0x0004) {
              lngVal = getExifDmsTag(bytes, tiffStart, type, count, valPos, littleEndian);
            }
          });
        }

        const chosenDate = dateOriginal || dateDigitized || ifd0Date;
        const timestampSec = chosenDate ? parseExifDateTimeToUnixSec(chosenDate, offsetTime) : null;

        let lat: number | null = null;
        let lng: number | null = null;
        if (latVal !== null && lngVal !== null) {
          const signedLat = latRef === 'S' ? -Math.abs(latVal) : Math.abs(latVal);
          const signedLng = lngRef === 'W' ? -Math.abs(lngVal) : Math.abs(lngVal);
          if (
            Math.abs(signedLat) <= 90 &&
            Math.abs(signedLng) <= 180 &&
            !(Math.abs(signedLat) < 0.0001 && Math.abs(signedLng) < 0.0001)
          ) {
            lat = Number(signedLat.toFixed(6));
            lng = Number(signedLng.toFixed(6));
          }
        }

        return { timestampSec, lat, lng };
      }
    }

    offset += 2 + segLen;
  }

  return empty;
}

export function computeMidTripMetrics(params: {
  startOdoKm: number | null;
  endOdoKm: number | null;
  startTripKm: number | null;
  endTripKm: number | null;
  startSoc: number | null;
  endSoc: number | null;
  startTimestampSec: number | null;
  endTimestampSec: number | null;
  usableCapacityKwh?: number;
}): ComputedMidTripMetrics {
  const cap =
    typeof params.usableCapacityKwh === 'number' && params.usableCapacityKwh > 0
      ? params.usableCapacityKwh
      : 37.3;

  const sOdo = params.startOdoKm !== null && Number.isFinite(params.startOdoKm) ? params.startOdoKm : null;
  const eOdo = params.endOdoKm !== null && Number.isFinite(params.endOdoKm) ? params.endOdoKm : null;
  const sTrip = params.startTripKm !== null && Number.isFinite(params.startTripKm) ? params.startTripKm : null;
  const eTrip = params.endTripKm !== null && Number.isFinite(params.endTripKm) ? params.endTripKm : null;

  const odoDelta =
    sOdo !== null && eOdo !== null && eOdo >= sOdo ? Number((eOdo - sOdo).toFixed(1)) : null;
  const tripDelta =
    sTrip !== null && eTrip !== null && eTrip >= sTrip ? Number((eTrip - sTrip).toFixed(1)) : null;

  let distanceKm = 0;
  let distanceSource: ComputedMidTripMetrics['distanceSource'] = 'none';

  if (tripDelta !== null && odoDelta !== null) {
    // Cluster ODO truncates/steps in whole 1 km units while Trip has 0.1 km precision;
    // prefer Trip delta unless divergence (> 2.0 km) indicates a mid-drive Trip reset.
    if (Math.abs(tripDelta - odoDelta) <= 2.0) {
      distanceKm = tripDelta;
      distanceSource = 'trip_delta';
    } else {
      distanceKm = odoDelta;
      distanceSource = 'odo_delta';
    }
  } else if (tripDelta !== null) {
    distanceKm = tripDelta;
    distanceSource = 'trip_delta';
  } else if (odoDelta !== null) {
    distanceKm = odoDelta;
    distanceSource = 'odo_delta';
  } else if (eTrip !== null && sTrip === null) {
    distanceKm = Number(eTrip.toFixed(1));
    distanceSource = 'end_trip';
  }

  const endOdoResolved =
    eOdo !== null ? eOdo : sOdo !== null ? Number((sOdo + distanceKm).toFixed(1)) : 0;
  const startOdoResolved =
    sOdo !== null ? sOdo : eOdo !== null ? Math.max(0, Number((eOdo - distanceKm).toFixed(1))) : 0;

  const startSocVal =
    params.startSoc !== null && Number.isFinite(params.startSoc)
      ? Math.max(0, Math.min(100, Number(params.startSoc.toFixed(1))))
      : 0;
  const endSocVal =
    params.endSoc !== null && Number.isFinite(params.endSoc)
      ? Math.max(0, Math.min(100, Number(params.endSoc.toFixed(1))))
      : startSocVal;

  const round2 = (n: number): number => Math.round(n * 100 + 1e-9) / 100;
  const socUsedPct = Math.max(0, Number((startSocVal - endSocVal).toFixed(1)));
  const energyUsedKwh = round2((socUsedPct / 100) * cap);
  const startEnergyKwh = round2((startSocVal / 100) * cap);
  const endEnergyKwh = round2((endSocVal / 100) * cap);
  const efficiencyKmPerKwh =
    energyUsedKwh > 0 && distanceKm > 0 ? round2(distanceKm / energyUsedKwh) : 0;

  const durationSeconds =
    params.startTimestampSec !== null &&
    params.endTimestampSec !== null &&
    params.endTimestampSec > params.startTimestampSec
      ? Math.round(params.endTimestampSec - params.startTimestampSec)
      : 0;

  const avgSpeedKmh =
    durationSeconds >= 60 && distanceKm > 0
      ? Number((distanceKm / (durationSeconds / 3600)).toFixed(1))
      : 0;

  return {
    distanceKm,
    distanceSource,
    startOdoKm: startOdoResolved,
    endOdoKm: endOdoResolved,
    startSoc: startSocVal,
    endSoc: endSocVal,
    socUsedPct,
    energyUsedKwh,
    efficiencyKmPerKwh,
    durationSeconds,
    avgSpeedKmh,
    startEnergyKwh,
    endEnergyKwh,
  };
}
