import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import {
  computeMidTripMetrics,
  extractJpegExifMetadata,
  parseMidPhotoViaWorker,
  TripRecord,
} from './sdk';

export interface OfflineMidDraftSide {
  photoDataUrl: string | null;
  timestampSec: number | null;
  lat: number | null;
  lng: number | null;
  locationLabel: string;
  tripKmText: string;
  odoKmText: string;
  socPctText: string;
  parseStatus: 'idle' | 'parsing' | 'parsed' | 'error' | 'offline';
  parseNote: string;
}

export interface OfflineMidTripDraft {
  before: OfflineMidDraftSide;
  after: OfflineMidDraftSide;
}

export function createEmptyMidSide(): OfflineMidDraftSide {
  return {
    photoDataUrl: null,
    timestampSec: null,
    lat: null,
    lng: null,
    locationLabel: '',
    tripKmText: '',
    odoKmText: '',
    socPctText: '',
    parseStatus: 'idle',
    parseNote: '',
  };
}

export function createEmptyMidDraft(): OfflineMidTripDraft {
  return {
    before: createEmptyMidSide(),
    after: createEmptyMidSide(),
  };
}

interface OfflineTripScreenProps {
  translateX: Animated.AnimatedInterpolation<string | number>;
  vin: string | null;
  usableCapacityKwh: number;
  draft: OfflineMidTripDraft;
  onChangeDraft: (next: OfflineMidTripDraft) => void;
  onClearDraft: () => void;
  onSaveTrip: (trip: TripRecord) => Promise<{ d1Synced: boolean }>;
  onResolveLocationLabel: (lat: number | null, lng: number | null) => Promise<string>;
  onClose: () => void;
  onShowBanner?: (type: 'ok' | 'err', msg: string) => void;
}

function parseOptionalNumber(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatDateTimeShort(sec: number | null): string {
  if (!sec || sec <= 0) return 'Set date & time';
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return 'Set date & time';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatFullTripDateTime(sec: number): string {
  const d = new Date(sec * 1000);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function toDatetimeLocalValue(sec: number | null): string {
  if (!sec || sec <= 0) return '';
  const d = new Date(sec * 1000);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${day}T${hh}:${mm}`;
}

function fromDatetimeLocalValue(val: string): number | null {
  if (!val) return null;
  const ms = Date.parse(val);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function formatDurLabel(seconds: number): string {
  if (!seconds || seconds <= 0) return '--';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
}

async function getCurrentPhoneGps(): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos?.coords?.latitude);
        const lng = Number(pos?.coords?.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
          resolve({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) });
        } else {
          resolve(null);
        }
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }
    );
  });
}

async function compressWebImageToJpegDataUrl(file: File, maxDim = 1280, quality = 0.82): Promise<string> {
  if (typeof document === 'undefined') {
    throw new Error('Image compression requires a browser DOM context');
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode selected image'));
      el.src = objectUrl;
    });
    const srcW = img.naturalWidth || img.width || 1280;
    const srcH = img.naturalHeight || img.height || 960;
    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const dstW = Math.max(1, Math.round(srcW * scale));
    const dstH = Math.max(1, Math.round(srcH * scale));
    const canvas = document.createElement('canvas');
    canvas.width = dstW;
    canvas.height = dstH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(img, 0, 0, dstW, dstH);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export const OfflineTripScreen: React.FC<OfflineTripScreenProps> = ({
  translateX,
  vin,
  usableCapacityKwh,
  draft,
  onChangeDraft,
  onClearDraft,
  onSaveTrip,
  onResolveLocationLabel,
  onClose,
  onShowBanner,
}) => {
  const beforeInputRef = useRef<HTMLInputElement | null>(null);
  const afterInputRef = useRef<HTMLInputElement | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [locBusySide, setLocBusySide] = useState<'before' | 'after' | null>(null);

  const patchSide = (side: 'before' | 'after', patch: Partial<OfflineMidDraftSide>) => {
    const cur = draftRef.current;
    const next: OfflineMidTripDraft = {
      ...cur,
      [side]: {
        ...cur[side],
        ...patch,
      },
    };
    draftRef.current = next;
    onChangeDraft(next);
  };

  const runAiScanForSide = async (
    side: 'before' | 'after',
    imageDataUrl: string,
    lat: number | null,
    lng: number | null,
    existingLocation: string
  ) => {
    patchSide(side, { parseStatus: 'parsing', parseNote: 'Reading MID cluster with Workers AI...' });
    const aiRes = await parseMidPhotoViaWorker({
      imageDataUrl,
      lat,
      lng,
      vinOverride: vin || undefined,
    });

    if (aiRes.ok && aiRes.extracted) {
      const { tripKm, odoKm, socPct, dteKm } = aiRes.extracted;
      const curSide = draftRef.current[side];
      const nextLoc = aiRes.locationLabel || existingLocation;
      const detectedAny =
        tripKm !== null || odoKm !== null || socPct !== null;
      const noteParts: string[] = [];
      if (detectedAny) {
        noteParts.push('AI extracted');
      } else {
        noteParts.push('No digits matched — type manually');
      }
      if (dteKm !== null) noteParts.push(`DTE ${dteKm} km`);
      if (typeof aiRes.remainingDailyQuota === 'number') {
        noteParts.push(`${aiRes.remainingDailyQuota} AI scans left today`);
      }

      patchSide(side, {
        tripKmText: tripKm !== null ? String(tripKm) : curSide.tripKmText,
        odoKmText: odoKm !== null ? String(odoKm) : curSide.odoKmText,
        socPctText: socPct !== null ? String(socPct) : curSide.socPctText,
        locationLabel: nextLoc || (lat !== null && lng !== null ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : curSide.locationLabel),
        parseStatus: detectedAny ? 'parsed' : 'error',
        parseNote: noteParts.join(' · '),
      });
      return;
    }

    const isOffline =
      typeof navigator !== 'undefined' && navigator.onLine === false
        ? true
        : /network|failed to fetch|offline|timeout/i.test(aiRes.error || '');

    let fallbackLoc = existingLocation;
    if (!fallbackLoc && lat !== null && lng !== null && !isOffline) {
      fallbackLoc = await onResolveLocationLabel(lat, lng).catch(
        () => `${lat.toFixed(6)}, ${lng.toFixed(6)}`
      );
    }

    patchSide(side, {
      locationLabel:
        fallbackLoc ||
        (lat !== null && lng !== null ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : ''),
      parseStatus: isOffline ? 'offline' : 'error',
      parseNote: isOffline
        ? 'Saved offline — tap Re-scan when online or enter numbers below.'
        : aiRes.error || 'Could not auto-read photo — enter numbers below.',
    });
  };

  const handleFileSelected = async (side: 'before' | 'after', file: File | null | undefined) => {
    if (!file) return;
    try {
      patchSide(side, { parseStatus: 'parsing', parseNote: 'Processing photo & GPS...' });
      const [buf, compressedUrl] = await Promise.all([
        file.arrayBuffer(),
        compressWebImageToJpegDataUrl(file, 1280, 0.82),
      ]);
      const exif = extractJpegExifMetadata(new Uint8Array(buf));
      const fallbackTs = file.lastModified
        ? Math.floor(file.lastModified / 1000)
        : Math.floor(Date.now() / 1000);
      const chosenTs = exif.timestampSec || fallbackTs;

      let chosenLat = exif.lat;
      let chosenLng = exif.lng;
      if (chosenLat === null || chosenLng === null) {
        const phoneGps = await getCurrentPhoneGps();
        if (phoneGps) {
          chosenLat = phoneGps.lat;
          chosenLng = phoneGps.lng;
        }
      }

      const coordText =
        chosenLat !== null && chosenLng !== null
          ? `${chosenLat.toFixed(6)}, ${chosenLng.toFixed(6)}`
          : draftRef.current[side].locationLabel;

      patchSide(side, {
        photoDataUrl: compressedUrl,
        timestampSec: chosenTs,
        lat: chosenLat,
        lng: chosenLng,
        locationLabel: coordText,
      });

      await runAiScanForSide(side, compressedUrl, chosenLat, chosenLng, coordText);
    } catch (err: any) {
      patchSide(side, {
        parseStatus: 'error',
        parseNote: err?.message || 'Could not read image file.',
      });
    }
  };

  const handleCaptureGpsOnly = async (side: 'before' | 'after') => {
    setLocBusySide(side);
    try {
      const gps = await getCurrentPhoneGps();
      if (!gps) {
        onShowBanner?.('err', 'Phone GPS unavailable. Check location permission.');
        return;
      }
      const label = await onResolveLocationLabel(gps.lat, gps.lng).catch(
        () => `${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)}`
      );
      patchSide(side, {
        lat: gps.lat,
        lng: gps.lng,
        locationLabel: label,
        timestampSec: draftRef.current[side].timestampSec || Math.floor(Date.now() / 1000),
      });
      onShowBanner?.('ok', 'Captured phone GPS location');
    } finally {
      setLocBusySide(null);
    }
  };

  const metrics = computeMidTripMetrics({
    startOdoKm: parseOptionalNumber(draft.before.odoKmText),
    endOdoKm: parseOptionalNumber(draft.after.odoKmText),
    startTripKm: parseOptionalNumber(draft.before.tripKmText),
    endTripKm: parseOptionalNumber(draft.after.tripKmText),
    startSoc: parseOptionalNumber(draft.before.socPctText),
    endSoc: parseOptionalNumber(draft.after.socPctText),
    startTimestampSec: draft.before.timestampSec,
    endTimestampSec: draft.after.timestampSec,
    usableCapacityKwh,
  });

  const hasValidTripInput = metrics.distanceKm > 0 || metrics.socUsedPct > 0;
  const hasAnyDraftData = Boolean(
    draft.before.photoDataUrl ||
      draft.after.photoDataUrl ||
      draft.before.odoKmText ||
      draft.before.tripKmText ||
      draft.before.socPctText ||
      draft.after.odoKmText ||
      draft.after.tripKmText ||
      draft.after.socPctText
  );

  const handleSaveCompletedTrip = async () => {
    if (!hasValidTripInput) {
      onShowBanner?.('err', 'Enter Before & After Trip/ODO km or Battery % first.');
      return;
    }
    setIsSaving(true);
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const endSec = draft.after.timestampSec || nowSec;
      const startSec =
        draft.before.timestampSec && draft.before.timestampSec <= endSec
          ? draft.before.timestampSec
          : endSec;

      let startLoc = draft.before.locationLabel.trim();
      let endLoc = draft.after.locationLabel.trim();
      if (!startLoc && draft.before.lat !== null && draft.before.lng !== null) {
        startLoc = await onResolveLocationLabel(draft.before.lat, draft.before.lng).catch(
          () => `${draft.before.lat!.toFixed(6)}, ${draft.before.lng!.toFixed(6)}`
        );
      }
      if (!endLoc && draft.after.lat !== null && draft.after.lng !== null) {
        endLoc = await onResolveLocationLabel(draft.after.lat, draft.after.lng).catch(
          () => `${draft.after.lat!.toFixed(6)}, ${draft.after.lng!.toFixed(6)}`
        );
      }

      const trip: TripRecord = {
        id: `trip-photo-${startSec}-${Date.now().toString(36).slice(-4)}`,
        journeyId: null,
        startTimestampSec: startSec,
        endTimestampSec: endSec,
        startDateTime: formatFullTripDateTime(startSec),
        endDateTime: formatFullTripDateTime(endSec),
        startSoc: metrics.startSoc,
        endSoc: metrics.endSoc,
        startEnergyKwh: metrics.startEnergyKwh,
        endEnergyKwh: metrics.endEnergyKwh,
        durationSeconds: metrics.durationSeconds,
        distanceKm: metrics.distanceKm,
        startOdometerKm: metrics.startOdoKm,
        endOdometerKm: metrics.endOdoKm,
        energyUsedKwh: metrics.energyUsedKwh,
        efficiencyKmPerKwh: metrics.efficiencyKmPerKwh,
        startLat: draft.before.lat,
        startLng: draft.before.lng,
        endLat: draft.after.lat,
        endLng: draft.after.lng,
        startLocation: startLoc || 'Offline Log (Photo)',
        endLocation: endLoc || 'Offline Log (Photo)',
        idleDurationSeconds: 0,
        idleEnergyKwh: 0,
        acState: 'Logged from MID photo',
        startCabinTempC: null,
        endCabinTempC: null,
        startExteriorTempC: null,
        endExteriorTempC: null,
        cabinTempC: null,
        exteriorTempC: null,
        acTargetTempC: '',
        acFanSpeed: '',
        maxSpeedKmh: 0,
        avgSpeedKmh: metrics.avgSpeedKmh,
        status: 'completed',
      };

      const { d1Synced } = await onSaveTrip(trip);
      onShowBanner?.(
        'ok',
        d1Synced
          ? `Trip (${metrics.distanceKm} km) saved & synced to D1`
          : `Trip (${metrics.distanceKm} km) saved locally — will sync to D1 when online`
      );
      onClose();
    } catch (err: any) {
      onShowBanner?.('err', err?.message || 'Failed to save offline trip');
    } finally {
      setIsSaving(false);
    }
  };

  const renderPhotoSideCard = (side: 'before' | 'after') => {
    const data = draft[side];
    const isBefore = side === 'before';
    const title = isBefore ? '1. Before Trip (Start MID)' : '2. After Trip (End MID)';
    const inputRef = isBefore ? beforeInputRef : afterInputRef;
    const isParsing = data.parseStatus === 'parsing';
    const statusColor =
      data.parseStatus === 'parsed'
        ? '#34D399'
        : data.parseStatus === 'offline'
          ? '#FBBF24'
          : data.parseStatus === 'error'
            ? '#FCA5A5'
            : '#94A3B8';

    return (
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitle}>{title}</Text>
          <View style={styles.cardHeaderActions}>
            {data.photoDataUrl && (
              <TouchableOpacity
                style={styles.smallOutlineBtn}
                onPress={() =>
                  runAiScanForSide(
                    side,
                    data.photoDataUrl!,
                    data.lat,
                    data.lng,
                    data.locationLabel
                  )
                }
                disabled={isParsing}
                activeOpacity={0.75}
              >
                <Text style={styles.smallOutlineBtnText}>Re-scan AI</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.smallGreenBtn}
              onPress={() => {
                if (Platform.OS === 'web') {
                  if (inputRef.current) {
                    inputRef.current.value = '';
                    inputRef.current.click();
                  }
                } else {
                  onShowBanner?.('err', 'Photo upload uses the PWA web picker; enter values manually on native.');
                }
              }}
              activeOpacity={0.75}
            >
              <Text style={styles.smallGreenBtnText}>
                {data.photoDataUrl ? 'Replace photo' : 'Snap / Pick photo'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {Platform.OS === 'web' &&
          React.createElement('input', {
            ref: (el: any) => {
              inputRef.current = el;
            },
            type: 'file',
            accept: 'image/*',
            onChange: (e: any) => handleFileSelected(side, e?.target?.files?.[0]),
            style: { display: 'none' },
          })}

        {data.photoDataUrl && (
          <View style={styles.previewWrap}>
            <Image
              source={{ uri: data.photoDataUrl }}
              style={styles.previewImg}
              resizeMode="cover"
            />
          </View>
        )}

        {(isParsing || Boolean(data.parseNote)) && (
          <View style={styles.parseNoteRow}>
            {isParsing && <ActivityIndicator size="small" color="#34D399" />}
            <Text style={[styles.parseNoteText, { color: statusColor }]}>
              {data.parseNote}
            </Text>
          </View>
        )}

        {/* 3 Numeric Cluster Inputs */}
        <View style={styles.threeColRow}>
          <View style={styles.fieldCol}>
            <Text style={styles.fieldLabel}>Trip (km)</Text>
            <View style={styles.inputBox}>
              <TextInput
                style={styles.numInput}
                value={data.tripKmText}
                onChangeText={(v) => patchSide(side, { tripKmText: v.replace(/[^0-9.]/g, '') })}
                placeholder="168.1"
                placeholderTextColor="#475569"
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          <View style={styles.fieldCol}>
            <Text style={styles.fieldLabel}>ODO (km)</Text>
            <View style={styles.inputBox}>
              <TextInput
                style={styles.numInput}
                value={data.odoKmText}
                onChangeText={(v) => patchSide(side, { odoKmText: v.replace(/[^0-9.]/g, '') })}
                placeholder="39599"
                placeholderTextColor="#475569"
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          <View style={styles.fieldCol}>
            <Text style={styles.fieldLabel}>Battery (%)</Text>
            <View style={styles.inputBox}>
              <TextInput
                style={styles.numInput}
                value={data.socPctText}
                onChangeText={(v) => patchSide(side, { socPctText: v.replace(/[^0-9.]/g, '') })}
                placeholder="81"
                placeholderTextColor="#475569"
                keyboardType="decimal-pad"
              />
            </View>
          </View>
        </View>

        {/* Time & GPS Location Row */}
        <View style={styles.metaRow}>
          <View style={styles.timeFieldCol}>
            <Text style={styles.fieldLabel}>Time</Text>
            <View style={styles.metaBox}>
              <Text style={styles.metaText} numberOfLines={1}>
                {formatDateTimeShort(data.timestampSec)}
              </Text>
              {Platform.OS === 'web' &&
                React.createElement('input', {
                  type: 'datetime-local',
                  value: toDatetimeLocalValue(data.timestampSec),
                  onChange: (e: any) => {
                    const ts = fromDatetimeLocalValue(String(e?.target?.value || ''));
                    if (ts !== null) patchSide(side, { timestampSec: ts });
                  },
                  style: {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    width: '100%',
                    height: '100%',
                    opacity: 0,
                    cursor: 'pointer',
                    colorScheme: 'dark',
                  },
                })}
            </View>
          </View>

          <View style={styles.gpsBtnCol}>
            <Text style={styles.fieldLabel}>Phone GPS</Text>
            <TouchableOpacity
              style={styles.gpsActionBtn}
              onPress={() => handleCaptureGpsOnly(side)}
              disabled={locBusySide === side}
              activeOpacity={0.75}
            >
              {locBusySide === side ? (
                <ActivityIndicator size="small" color="#38BDF8" />
              ) : (
                <Text style={styles.gpsActionBtnText} numberOfLines={1}>
                  {data.lat !== null ? 'Refresh GPS' : 'Use GPS'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ marginTop: 10 }}>
          <Text style={styles.fieldLabel}>Location label</Text>
          <View style={styles.inputBox}>
            <TextInput
              style={styles.locInput}
              value={data.locationLabel}
              onChangeText={(v) => patchSide(side, { locationLabel: v })}
              placeholder="Auto-filled from GPS or type place name"
              placeholderTextColor="#475569"
            />
          </View>
        </View>
      </View>
    );
  };

  return (
    <Animated.View style={[styles.layer, { transform: [{ translateX }] }]}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={onClose}
              activeOpacity={0.7}
              accessibilityLabel="Back to Trips"
              accessibilityRole="button"
            >
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#F8FAFC" strokeWidth={2.4}>
                <Path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Log offline trip</Text>
              <Text style={styles.headerSub}>
                Reads Before &amp; After MID photos even when MG servers are down
              </Text>
            </View>
          </View>

          {renderPhotoSideCard('before')}
          {renderPhotoSideCard('after')}

          {/* 3. Calculated Summary Card */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryTopRow}>
              <Text style={styles.summaryEyebrow}>COMPUTED TRIP SUMMARY</Text>
              <Text style={styles.summarySourceTag}>
                {metrics.distanceSource === 'trip_delta'
                  ? '0.1 km Trip Δ'
                  : metrics.distanceSource === 'odo_delta'
                    ? 'ODO Δ'
                    : metrics.distanceSource === 'end_trip'
                      ? 'End Trip'
                      : 'Enter readings'}
              </Text>
            </View>

            <View style={styles.summaryGrid}>
              <View style={styles.summaryGridRow}>
                <View style={styles.summaryTile}>
                  <Text style={styles.summaryLabel}>Distance</Text>
                  <Text style={styles.summaryVal}>{metrics.distanceKm} km</Text>
                </View>
                <View style={styles.summaryTile}>
                  <Text style={styles.summaryLabel}>Battery Used</Text>
                  <Text style={[styles.summaryVal, { color: '#34D399' }]}>
                    {metrics.socUsedPct}% ({metrics.energyUsedKwh} kWh)
                  </Text>
                </View>
              </View>
              <View style={styles.summaryGridRow}>
                <View style={styles.summaryTile}>
                  <Text style={styles.summaryLabel}>Efficiency</Text>
                  <Text style={styles.summaryVal}>
                    {metrics.efficiencyKmPerKwh > 0 ? `${metrics.efficiencyKmPerKwh} km/kWh` : '--'}
                  </Text>
                </View>
                <View style={styles.summaryTile}>
                  <Text style={styles.summaryLabel}>Duration · Avg</Text>
                  <Text style={styles.summaryVal}>
                    {formatDurLabel(metrics.durationSeconds)}
                    {metrics.avgSpeedKmh > 0 ? ` · ${metrics.avgSpeedKmh} km/h` : ''}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.saveBtn,
              (!hasValidTripInput || isSaving) && styles.saveBtnDisabled,
            ]}
            onPress={handleSaveCompletedTrip}
            disabled={!hasValidTripInput || isSaving}
            activeOpacity={0.82}
          >
            {isSaving ? (
              <ActivityIndicator size="small" color="#052E16" />
            ) : (
              <Text style={styles.saveBtnText}>Save trip &amp; sync to D1</Text>
            )}
          </TouchableOpacity>

          {hasAnyDraftData && (
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={onClearDraft}
              disabled={isSaving}
              activeOpacity={0.75}
            >
              <Text style={styles.clearBtnText}>Clear draft</Text>
            </TouchableOpacity>
          )}

          <Text style={styles.footerInfo}>
            Before/After drafts stay saved on this phone while you drive. Extracted numbers are reviewed by you before syncing directly to your private VIN history in Cloudflare D1.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  layer: {
    position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0A0E17',
    zIndex: 2000,
  },
  safeArea: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    alignItems: 'center',
  },
  scrollView: {
    width: '100%',
    flex: 1,
  },
  scrollContent: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 44 : 20,
    paddingBottom: 145,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
    paddingTop: 4,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#131B2A',
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  headerTitle: {
    color: '#F8FAFC',
    fontSize: 23,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  headerSub: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  card: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 12,
  },
  cardTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    minWidth: 0,
  },
  cardHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  smallGreenBtn: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.5)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  smallGreenBtnText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '700',
  },
  smallOutlineBtn: {
    backgroundColor: '#0A0E17',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  smallOutlineBtnText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
  },
  previewWrap: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 10,
    backgroundColor: '#0A0E17',
  },
  previewImg: {
    width: '100%',
    height: 128,
  },
  parseNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  parseNoteText: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  threeColRow: {
    flexDirection: 'row',
    gap: 8,
  },
  fieldCol: {
    flex: 1,
    minWidth: 0,
  },
  fieldLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 5,
  },
  inputBox: {
    backgroundColor: '#0A0E17',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    minWidth: 0,
  },
  numInput: {
    width: '100%',
    minWidth: 0,
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
    padding: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  locInput: {
    width: '100%',
    minWidth: 0,
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '500',
    padding: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  metaRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  timeFieldCol: {
    flex: 1.4,
    minWidth: 0,
  },
  gpsBtnCol: {
    flex: 1,
    minWidth: 0,
  },
  metaBox: {
    position: 'relative',
    backgroundColor: '#0A0E17',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  metaText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
  },
  gpsActionBtn: {
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.45)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsActionBtnText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '700',
  },
  summaryCard: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.35)',
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
  },
  summaryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  summaryEyebrow: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.9,
  },
  summarySourceTag: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  summaryGrid: {
    gap: 10,
  },
  summaryGridRow: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryTile: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#0A0E17',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  summaryLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '500',
  },
  summaryVal: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 3,
  },
  saveBtn: {
    backgroundColor: '#34D399',
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  saveBtnDisabled: {
    opacity: 0.45,
  },
  saveBtnText: {
    color: '#052E16',
    fontSize: 15,
    fontWeight: '800',
  },
  clearBtn: {
    borderWidth: 1,
    borderColor: '#1E293B',
    backgroundColor: '#111827',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  clearBtnText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  footerInfo: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
