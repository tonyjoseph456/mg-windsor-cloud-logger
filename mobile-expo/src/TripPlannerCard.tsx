import React, { useState, useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import * as SecureStore from './storage';
import {
  ChargerFeedbackEntry,
  ChargeVerdict,
  computeTripRouteChoices,
  DEFAULT_CHARGER_PREFS,
  DEFAULT_TRIP_SETTINGS,
  DEFAULT_WINDSOR_PROFILE,
  LatLng,
  NamedPlace,
  PlaceSuggestion,
  PlannedCharger,
  PlannedStop,
  PlanOption,
  resolvePlaceSuggestion,
  RouteChoice,
  searchDestinationPlaces,
  TripPlan,
  TripSettings,
  VehicleProfile,
  verifyGoogleMapsApiKey,
  VoltaTripPlanner,
} from './sdk';

const GOOGLE_MAPS_KEY_STORAGE = 'mg_ismart_volta_google_maps_key_v1';
const CHARGER_FEEDBACK_STORAGE = 'mg_ismart_volta_charger_feedback_v1';
const PLANNER_SETTINGS_STORAGE = 'mg_ismart_volta_planner_settings_v1';

interface TripPlannerCardProps {
  currentSoc: number;
  currentLat?: number | null;
  currentLng?: number | null;
  usableCapacityKwh?: number;
  onShowBanner?: (type: 'ok' | 'err', msg: string) => void;
}

const QUICK_DESTINATIONS: { name: string; subtitle: string; position: LatLng }[] = [
  { name: 'Kochi (Lulu Mall Edappally)', subtitle: 'NH 544 / NH 66 Hub', position: { lat: 10.0274, lng: 76.3082 } },
  { name: 'Munnar Hill Station', subtitle: 'Ghat Climb (+1,500m Elevation Test)', position: { lat: 10.0889, lng: 77.0595 } },
  { name: 'Thiruvananthapuram', subtitle: 'MC Road / NH 66 Corridor', position: { lat: 8.5241, lng: 76.9366 } },
  { name: 'Kozhikode', subtitle: 'Malabar NH 66 Corridor', position: { lat: 11.2588, lng: 75.7804 } },
  { name: 'Coimbatore', subtitle: 'Walayar NH 544 Highway', position: { lat: 11.0168, lng: 76.9558 } },
  { name: 'Bengaluru', subtitle: 'Long-Haul Multi-Stop Highway', position: { lat: 12.9716, lng: 77.5946 } },
];

export function TripPlannerCard({
  currentSoc,
  currentLat,
  currentLng,
  usableCapacityKwh = 37.3,
  onShowBanner,
}: TripPlannerCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [originMode, setOriginMode] = useState<'car' | 'custom'>('car');
  const [originQuery, setOriginQuery] = useState('');
  const [originSuggestions, setOriginSuggestions] = useState<PlaceSuggestion[]>([]);
  const [customOrigin, setCustomOrigin] = useState<NamedPlace | null>(null);

  const [destQuery, setDestQuery] = useState('');
  const [destSuggestions, setDestSuggestions] = useState<PlaceSuggestion[]>([]);
  const [selectedDest, setSelectedDest] = useState<NamedPlace | null>(null);
  const [isSearchingPlaces, setIsSearchingPlaces] = useState(false);

  const [startSocInput, setStartSocInput] = useState<string>(
    String(Math.round(currentSoc || 80))
  );
  const [minChargerInput, setMinChargerInput] = useState<string>('10');
  const [minDestInput, setMinDestInput] = useState<string>('15');
  const [chargeTargetInput, setChargeTargetInput] = useState<string>('80');
  const [settings, setSettings] = useState<TripSettings>(DEFAULT_TRIP_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);

  const [googleApiKey, setGoogleApiKey] = useState('');
  const [keyStatusMsg, setKeyStatusMsg] = useState<string | null>(null);
  const [isCheckingKey, setIsCheckingKey] = useState(false);

  const [feedbackMap, setFeedbackMap] = useState<Record<string, ChargerFeedbackEntry[]>>({});

  const [isPlanning, setIsPlanning] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [errorText, setErrorText] = useState<string | null>(null);

  const [routeChoices, setRouteChoices] = useState<RouteChoice[]>([]);
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0);
  const [selectedOptionIdx, setSelectedOptionIdx] = useState(0);

  // Sync live car SoC when it changes if user hasn't manually edited it far away
  useEffect(() => {
    if (currentSoc > 0) {
      setStartSocInput(String(Math.round(currentSoc)));
    }
  }, [currentSoc]);

  // Load saved Google Maps API Key, Charger Feedback & Planner Settings
  useEffect(() => {
    (async () => {
      try {
        const [savedKey, savedFb, savedSet] = await Promise.all([
          SecureStore.getItemAsync(GOOGLE_MAPS_KEY_STORAGE),
          SecureStore.getItemAsync(CHARGER_FEEDBACK_STORAGE),
          SecureStore.getItemAsync(PLANNER_SETTINGS_STORAGE),
        ]);
        if (savedKey) setGoogleApiKey(savedKey);
        if (savedFb) setFeedbackMap(JSON.parse(savedFb));
        if (savedSet) {
          try {
            const parsed = JSON.parse(savedSet);
            if (parsed.minArrivalAtChargerPercent != null) {
              setMinChargerInput(String(parsed.minArrivalAtChargerPercent));
            }
            if (parsed.minArrivalAtDestinationPercent != null) {
              setMinDestInput(String(parsed.minArrivalAtDestinationPercent));
            }
            if (parsed.maxChargeTargetPercent != null) {
              setChargeTargetInput(String(parsed.maxChargeTargetPercent));
            }
            setSettings({ ...DEFAULT_TRIP_SETTINGS, ...parsed });
          } catch (_) {}
        }
      } catch (_) {}
    })();
  }, []);

  const activeOrigin: LatLng = useMemo(() => {
    if (originMode === 'custom' && customOrigin) {
      return customOrigin.position;
    }
    if (
      currentLat &&
      currentLng &&
      Math.abs(currentLat) > 0.1 &&
      Math.abs(currentLng) > 0.1
    ) {
      return { lat: currentLat, lng: currentLng };
    }
    // Default fallback: Kochi / Central Kerala
    return { lat: 10.0261, lng: 76.3125 };
  }, [originMode, customOrigin, currentLat, currentLng]);

  const vehicleProfile: VehicleProfile = useMemo(
    () => ({
      ...DEFAULT_WINDSOR_PROFILE,
      usableCapacityKwh: usableCapacityKwh > 20 ? usableCapacityKwh : 37.3,
    }),
    [usableCapacityKwh]
  );

  // Debounced Destination Search
  useEffect(() => {
    const q = destQuery.trim();
    if (q.length < 2 || (selectedDest && selectedDest.name === q)) {
      setDestSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearchingPlaces(true);
      try {
        const res = await searchDestinationPlaces(q, activeOrigin, googleApiKey);
        setDestSuggestions(res);
      } catch (_) {
      } finally {
        setIsSearchingPlaces(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [destQuery, activeOrigin, googleApiKey, selectedDest]);

  // Debounced Custom Origin Search
  useEffect(() => {
    if (originMode !== 'custom') return;
    const q = originQuery.trim();
    if (q.length < 2 || (customOrigin && customOrigin.name === q)) {
      setOriginSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await searchDestinationPlaces(q, activeOrigin, googleApiKey);
        setOriginSuggestions(res);
      } catch (_) {}
    }, 300);
    return () => clearTimeout(timer);
  }, [originQuery, originMode, activeOrigin, googleApiKey, customOrigin]);

  const handleMinChargerChange = (v: string) => {
    setMinChargerInput(v);
    const num = parseInt(v, 10);
    const next: TripSettings = {
      ...settings,
      minArrivalAtChargerPercent: isNaN(num) ? 0 : Math.max(0, Math.min(100, num)),
    };
    setSettings(next);
    SecureStore.setItemAsync(PLANNER_SETTINGS_STORAGE, JSON.stringify(next));
  };

  const handleMinDestChange = (v: string) => {
    setMinDestInput(v);
    const num = parseInt(v, 10);
    const next: TripSettings = {
      ...settings,
      minArrivalAtDestinationPercent: isNaN(num) ? 0 : Math.max(0, Math.min(100, num)),
    };
    setSettings(next);
    SecureStore.setItemAsync(PLANNER_SETTINGS_STORAGE, JSON.stringify(next));
  };

  const handleChargeTargetChange = (v: string) => {
    setChargeTargetInput(v);
    const num = parseInt(v, 10);
    const next: TripSettings = {
      ...settings,
      maxChargeTargetPercent: isNaN(num) ? 100 : Math.max(0, Math.min(100, num)),
    };
    setSettings(next);
    SecureStore.setItemAsync(PLANNER_SETTINGS_STORAGE, JSON.stringify(next));
  };

  // Re-compute optimal charging plan whenever route, startSoc, settings, or broken-charger feedback changes
  const activeRouteChoice: RouteChoice | null =
    routeChoices[selectedRouteIdx] || routeChoices[0] || null;

  const planOptions: PlanOption[] = useMemo(() => {
    if (!activeRouteChoice) return [];
    const startSoc = Math.max(
      0,
      Math.min(100, Number(startSocInput) || currentSoc || 80)
    );
    const planner = new VoltaTripPlanner(
      vehicleProfile,
      settings,
      DEFAULT_CHARGER_PREFS,
      feedbackMap
    );
    return planner.options(
      activeRouteChoice.profile,
      startSoc,
      activeRouteChoice.chargers,
      activeRouteChoice.durationS / 60.0
    );
  }, [activeRouteChoice, startSocInput, currentSoc, vehicleProfile, settings, feedbackMap]);

  const activeOption: PlanOption | null =
    planOptions[selectedOptionIdx] || planOptions[0] || null;
  const activePlan: TripPlan | null = activeOption?.plan || null;

  const handlePlanTrip = async (destOverride?: NamedPlace) => {
    const targetDest = destOverride || selectedDest;
    if (!targetDest) {
      setErrorText('Please select or type a destination first.');
      return;
    }
    setErrorText(null);
    setIsPlanning(true);
    setProgressText('Computing routes & elevation profile...');
    try {
      const choices = await computeTripRouteChoices(
        activeOrigin,
        targetDest,
        googleApiKey,
        (msg) => setProgressText(msg)
      );
      setRouteChoices(choices);
      setSelectedRouteIdx(0);
      setSelectedOptionIdx(0);
    } catch (e) {
      setErrorText((e as Error).message || 'Failed to compute route plan.');
    } finally {
      setIsPlanning(false);
      setProgressText('');
    }
  };

  const handleMarkChargerVerdict = async (
    chargerId: string,
    chargerName: string,
    verdict: ChargeVerdict
  ) => {
    const existing = feedbackMap[chargerId] || [];
    const updated = {
      ...feedbackMap,
      [chargerId]: [...existing.slice(-9), { verdict, at: Date.now() }],
    };
    setFeedbackMap(updated);
    await SecureStore.setItemAsync(CHARGER_FEEDBACK_STORAGE, JSON.stringify(updated));
    if (verdict === 'Broken') {
      onShowBanner?.(
        'ok',
        `Marked "${chargerName}" offline/broken — automatically re-planned route with next available charger!`
      );
    } else {
      onShowBanner?.('ok', `Saved feedback (${verdict}) for ${chargerName}`);
    }
  };

  const handleResetBrokenChargers = async () => {
    setFeedbackMap({});
    await SecureStore.deleteItemAsync(CHARGER_FEEDBACK_STORAGE);
    onShowBanner?.('ok', 'Cleared all offline/broken charger overrides');
  };

  const handleSaveAndVerifyKey = async () => {
    const clean = googleApiKey.trim();
    await SecureStore.setItemAsync(GOOGLE_MAPS_KEY_STORAGE, clean);
    if (!clean) {
      setKeyStatusMsg('Switched to Free Zero-Key Mode (OSRM + Open-Meteo DEM + OSM Overpass).');
      return;
    }
    setIsCheckingKey(true);
    setKeyStatusMsg('Checking Google Maps Platform API key...');
    const res = await verifyGoogleMapsApiKey(clean);
    setIsCheckingKey(false);
    setKeyStatusMsg(res.ok ? `✅ ${res.message}` : `❌ ${res.message}`);
  };

  const openNavigation = (lat: number, lng: number, label?: string) => {
    const q = encodeURIComponent(label || `${lat},${lng}`);
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${q}&travelmode=driving`;
    Linking.openURL(url);
  };

  const openFullRouteInGoogleMaps = () => {
    if (!selectedDest || !activePlan) return;
    const waypoints = activePlan.stops
      .map((s) => `${s.charger.position.lat},${s.charger.position.lng}`)
      .join('|');
    const wpParam = waypoints ? `&waypoints=${encodeURIComponent(waypoints)}` : '';
    const url = `https://www.google.com/maps/dir/?api=1&origin=${activeOrigin.lat},${activeOrigin.lng}&destination=${selectedDest.position.lat},${selectedDest.position.lng}${wpParam}&travelmode=driving`;
    Linking.openURL(url);
  };

  const formatHm = (mins: number) => {
    const m = Math.max(0, Math.round(mins));
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return h > 0 ? `${h}h ${rem}m` : `${rem} min`;
  };

  const brokenCount = Object.values(feedbackMap).filter(
    (arr) => arr.length > 0 && arr[arr.length - 1].verdict === 'Broken'
  ).length;

  return (
    <View style={styles.card}>
      {/* Header Row */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => setExpanded((v) => !v)}
        style={styles.headerRow}
      >
        <View style={{ flex: 1, paddingRight: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={styles.title}>🗺️ EV Route & Charger Planner</Text>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {googleApiKey.trim().length > 15 ? '● Google Live Traffic' : '● Free DEM + OSM Mode'}
              </Text>
            </View>
          </View>
          <Text style={styles.subtitle}>
            Elevation physics (Ghats/hills), optimal DC stops, 25km backup chargers &amp; live SoC trace
          </Text>
        </View>
        <Text style={styles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={{ marginTop: 12 }}>
          {/* Starting Location */}
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.fieldLabel}>STARTING LOCATION</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                <TouchableOpacity
                  style={[
                    styles.pillBtn,
                    originMode === 'car' && styles.pillBtnActive,
                  ]}
                  onPress={() => setOriginMode('car')}
                >
                  <Text
                    style={[
                      styles.pillBtnText,
                      originMode === 'car' && styles.pillBtnTextActive,
                    ]}
                  >
                    📍 Car GPS ({activeOrigin.lat.toFixed(2)}, {activeOrigin.lng.toFixed(2)})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.pillBtn,
                    originMode === 'custom' && styles.pillBtnActive,
                  ]}
                  onPress={() => setOriginMode('custom')}
                >
                  <Text
                    style={[
                      styles.pillBtnText,
                      originMode === 'custom' && styles.pillBtnTextActive,
                    ]}
                  >
                    ✏️ Custom Start
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* User-Configured Trip Battery % Strategy (Start, Min @ Charger, Min @ Dest, Charge Target) */}
          <View style={{ marginTop: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <Text style={styles.fieldLabel}>TRIP BATTERY % TARGETS</Text>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <TouchableOpacity
                  style={[
                    styles.pillBtn,
                    { paddingVertical: 3, paddingHorizontal: 7 },
                    (settings.chargeStrategy ?? 'optimal') === 'optimal' && styles.pillBtnActive,
                  ]}
                  onPress={() => {
                    const next: TripSettings = { ...settings, chargeStrategy: 'optimal' };
                    setSettings(next);
                    SecureStore.setItemAsync(PLANNER_SETTINGS_STORAGE, JSON.stringify(next));
                  }}
                >
                  <Text
                    style={[
                      styles.pillBtnText,
                      { fontSize: 10 },
                      (settings.chargeStrategy ?? 'optimal') === 'optimal' && styles.pillBtnTextActive,
                    ]}
                  >
                    ⚡ Optimal (Fastest)
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.pillBtn,
                    { paddingVertical: 3, paddingHorizontal: 7 },
                    settings.chargeStrategy === 'fixed' && styles.pillBtnActive,
                  ]}
                  onPress={() => {
                    const next: TripSettings = { ...settings, chargeStrategy: 'fixed' };
                    setSettings(next);
                    SecureStore.setItemAsync(PLANNER_SETTINGS_STORAGE, JSON.stringify(next));
                  }}
                >
                  <Text
                    style={[
                      styles.pillBtnText,
                      { fontSize: 10 },
                      settings.chargeStrategy === 'fixed' && styles.pillBtnTextActive,
                    ]}
                  >
                    🔋 Fixed ({chargeTargetInput || '100'}% Every Stop)
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 5 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { fontSize: 9, textAlign: 'center' }]}>START SOC %</Text>
                <TextInput
                  style={[styles.input, { marginTop: 3, textAlign: 'center', fontWeight: '800' }]}
                  keyboardType="numeric"
                  maxLength={3}
                  value={startSocInput}
                  onChangeText={setStartSocInput}
                  placeholder="85"
                  placeholderTextColor="#475569"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { fontSize: 9, textAlign: 'center' }]}>MIN @ CHARGER %</Text>
                <TextInput
                  style={[styles.input, { marginTop: 3, textAlign: 'center', fontWeight: '800' }]}
                  keyboardType="numeric"
                  maxLength={3}
                  value={minChargerInput}
                  onChangeText={handleMinChargerChange}
                  placeholder="10"
                  placeholderTextColor="#475569"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { fontSize: 9, textAlign: 'center' }]}>MIN @ DEST %</Text>
                <TextInput
                  style={[styles.input, { marginTop: 3, textAlign: 'center', fontWeight: '800' }]}
                  keyboardType="numeric"
                  maxLength={3}
                  value={minDestInput}
                  onChangeText={handleMinDestChange}
                  placeholder="15"
                  placeholderTextColor="#475569"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.fieldLabel, { fontSize: 9, textAlign: 'center' }]}>CHARGE TARGET %</Text>
                <TextInput
                  style={[styles.input, { marginTop: 3, textAlign: 'center', fontWeight: '800' }]}
                  keyboardType="numeric"
                  maxLength={3}
                  value={chargeTargetInput}
                  onChangeText={handleChargeTargetChange}
                  placeholder="80"
                  placeholderTextColor="#475569"
                />
              </View>
            </View>
          </View>

          {/* Custom Origin Input if selected */}
          {originMode === 'custom' && (
            <View style={{ marginTop: 8 }}>
              <TextInput
                style={styles.input}
                placeholder="Type starting town or city (e.g. Kottayam, Kochi)..."
                placeholderTextColor="#64748B"
                value={originQuery}
                onChangeText={(txt) => {
                  setOriginQuery(txt);
                  if (customOrigin && txt !== customOrigin.name) {
                    setCustomOrigin(null);
                  }
                }}
              />
              {originSuggestions.length > 0 && (
                <View style={styles.suggestionsBox}>
                  {originSuggestions.map((s) => (
                    <TouchableOpacity
                      key={s.placeId}
                      style={styles.suggestionItem}
                      onPress={async () => {
                        const resolved = await resolvePlaceSuggestion(s, googleApiKey);
                        setCustomOrigin(resolved);
                        setOriginQuery(resolved.name);
                        setOriginSuggestions([]);
                      }}
                    >
                      <Text style={styles.suggestionTitle}>📍 {s.title}</Text>
                      {s.subtitle ? (
                        <Text style={styles.suggestionSub}>{s.subtitle}</Text>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          )}

          {/* Destination Input */}
          <View style={{ marginTop: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.fieldLabel}>DESTINATION</Text>
              <TouchableOpacity onPress={() => setShowSettings((v) => !v)}>
                <Text style={{ color: '#38BDF8', fontSize: 11, fontWeight: '700' }}>
                  {showSettings ? '▲ Hide Google API Key' : '⚙️ Google API Key'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="Where to? (e.g. Munnar, Bengaluru, Lulu Mall)..."
                placeholderTextColor="#64748B"
                value={destQuery}
                onChangeText={(txt) => {
                  setDestQuery(txt);
                  if (selectedDest && txt !== selectedDest.name) {
                    setSelectedDest(null);
                  }
                }}
              />
              <TouchableOpacity
                style={styles.planBtn}
                disabled={isPlanning}
                onPress={async () => {
                  if (selectedDest) {
                    await handlePlanTrip(selectedDest);
                  } else if (destSuggestions.length > 0) {
                    const resolved = await resolvePlaceSuggestion(
                      destSuggestions[0],
                      googleApiKey
                    );
                    setSelectedDest(resolved);
                    setDestQuery(resolved.name);
                    setDestSuggestions([]);
                    await handlePlanTrip(resolved);
                  } else if (destQuery.trim().length >= 2) {
                    const list = await searchDestinationPlaces(
                      destQuery,
                      activeOrigin,
                      googleApiKey
                    );
                    if (list.length > 0) {
                      const resolved = await resolvePlaceSuggestion(list[0], googleApiKey);
                      setSelectedDest(resolved);
                      setDestQuery(resolved.name);
                      setDestSuggestions([]);
                      await handlePlanTrip(resolved);
                    } else {
                      setErrorText('Place not found. Try a nearby town or landmark.');
                    }
                  }
                }}
              >
                {isPlanning ? (
                  <ActivityIndicator size="small" color="#042F2E" />
                ) : (
                  <Text style={styles.planBtnText}>Plan Route</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* Autocomplete Dropdown */}
            {destSuggestions.length > 0 && (
              <View style={styles.suggestionsBox}>
                {destSuggestions.map((s) => (
                  <TouchableOpacity
                    key={s.placeId}
                    style={styles.suggestionItem}
                    onPress={async () => {
                      try {
                        const resolved = await resolvePlaceSuggestion(s, googleApiKey);
                        setSelectedDest(resolved);
                        setDestQuery(resolved.name);
                        setDestSuggestions([]);
                        await handlePlanTrip(resolved);
                      } catch (e) {
                        setErrorText((e as Error).message);
                      }
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.suggestionTitle}>🏁 {s.title}</Text>
                      {s.subtitle ? (
                        <Text style={styles.suggestionSub} numberOfLines={1}>
                          {s.subtitle}
                        </Text>
                      ) : null}
                    </View>
                    {s.distanceM ? (
                      <Text style={styles.suggestionDist}>
                        {Math.round(s.distanceM / 1000)} km
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Quick Corridor Chips */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {QUICK_DESTINATIONS.map((qd) => (
                <TouchableOpacity
                  key={qd.name}
                  style={styles.quickChip}
                  onPress={() => {
                    const place: NamedPlace = {
                      placeId: `quick:${qd.name}`,
                      name: qd.name,
                      position: qd.position,
                    };
                    setSelectedDest(place);
                    setDestQuery(qd.name);
                    setDestSuggestions([]);
                    handlePlanTrip(place);
                  }}
                >
                  <Text style={styles.quickChipText}>⚡ {qd.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Collapsible Optional Google Maps API Key */}
          {showSettings && (
            <View style={styles.settingsBox}>
              <Text style={styles.settingsHeader}>
                🔑 Optional Google Maps Platform API Key (Hybrid Mode)
              </Text>
              <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 2, lineHeight: 16 }}>
                Leave blank to use 100% Free Mode (OSRM + Open-Meteo 90m DEM + OSM/Curated DC Chargers). Add a Google key to unlock live traffic speeds &amp; live CCS2 plug availability.
              </Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="Paste Google Maps API Key (optional)..."
                  placeholderTextColor="#64748B"
                  secureTextEntry
                  value={googleApiKey}
                  onChangeText={setGoogleApiKey}
                />
                <TouchableOpacity
                  style={[styles.pillBtn, styles.pillBtnActive, { paddingHorizontal: 12 }]}
                  onPress={handleSaveAndVerifyKey}
                  disabled={isCheckingKey}
                >
                  <Text style={styles.pillBtnTextActive}>
                    {isCheckingKey ? 'Checking...' : 'Check & Save'}
                  </Text>
                </TouchableOpacity>
              </View>
              {keyStatusMsg && (
                <Text
                  style={{
                    color: keyStatusMsg.startsWith('❌') ? '#F87171' : '#34D399',
                    fontSize: 11,
                    marginTop: 6,
                  }}
                >
                  {keyStatusMsg}
                </Text>
              )}

              {brokenCount > 0 && (
                <TouchableOpacity
                  style={[styles.pillBtn, { marginTop: 10, borderColor: '#F59E0B' }]}
                  onPress={handleResetBrokenChargers}
                >
                  <Text style={{ color: '#FBBF24', fontSize: 11, fontWeight: '700' }}>
                    🔄 Reset {brokenCount} Offline/Broken Charger Override(s)
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Progress or Error Banner */}
          {isPlanning && (
            <View style={styles.statusBox}>
              <ActivityIndicator size="small" color="#38BDF8" />
              <Text style={{ color: '#BAE6FD', fontSize: 12, fontWeight: '700' }}>
                {progressText || 'Planning trip...'}
              </Text>
            </View>
          )}

          {errorText && (
            <View style={[styles.statusBox, { borderColor: '#EF444460', backgroundColor: '#7F1D1D25' }]}>
              <Text style={{ color: '#FCA5A5', fontSize: 12 }}>{errorText}</Text>
            </View>
          )}

          {/* PLANNED TRIP RESULTS */}
          {activeRouteChoice && activePlan && !isPlanning && (
            <View style={{ marginTop: 14, gap: 12 }}>
              {/* 1. Route Alternatives Selector (if multiple routes returned) */}
              {routeChoices.length > 1 && (
                <View>
                  <Text style={styles.fieldLabel}>ROUTE ALTERNATIVES</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                    {routeChoices.map((rc, idx) => {
                      const active = idx === selectedRouteIdx;
                      return (
                        <TouchableOpacity
                          key={rc.id}
                          style={[
                            styles.routeTab,
                            active && styles.routeTabActive,
                          ]}
                          onPress={() => {
                            setSelectedRouteIdx(idx);
                            setSelectedOptionIdx(0);
                          }}
                        >
                          <Text
                            style={[
                              styles.routeTabTitle,
                              active && { color: '#34D399' },
                            ]}
                          >
                            {rc.label}
                          </Text>
                          <Text style={styles.routeTabSub}>
                            {Math.round(rc.distanceM / 1000)} km • {formatHm(rc.durationS / 60)} • ⛰️ +{rc.climbM}m climb • ⚡ {rc.chargers.length} DC
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* 2. Plan Goal Options (Fastest vs Fewer Stops vs Preferred Network) */}
              {planOptions.length > 1 && (
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  {planOptions.map((opt, idx) => {
                    const active = idx === selectedOptionIdx;
                    return (
                      <TouchableOpacity
                        key={opt.goal}
                        style={[styles.pillBtn, active && styles.pillBtnActive]}
                        onPress={() => setSelectedOptionIdx(idx)}
                      >
                        <Text
                          style={[
                            styles.pillBtnText,
                            active && styles.pillBtnTextActive,
                          ]}
                        >
                          {opt.label} ({opt.plan.stops.length}{' '}
                          {opt.plan.stops.length === 1 ? 'stop' : 'stops'} • +
                          {opt.plan.chargeMinutes}m)
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* 3. Trip Summary Metrics Grid */}
              <View style={styles.summaryBox}>
                <View style={styles.summaryHeaderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: '#F8FAFC', fontSize: 15, fontWeight: '900' }}>
                      🏁 To {selectedDest?.name}
                    </Text>
                    <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 2 }}>
                      {activeRouteChoice.label}
                      {activeRouteChoice.trafficDelayMin > 2
                        ? ` • 🚦 +${activeRouteChoice.trafficDelayMin}m live traffic delay`
                        : ''}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.navAllBtn}
                    onPress={openFullRouteInGoogleMaps}
                  >
                    <Text style={styles.navAllBtnText}>🧭 Open Route in Maps</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.metricsGrid}>
                  <View style={styles.metricCell}>
                    <Text style={styles.metricLabel}>TOTAL DISTANCE</Text>
                    <Text style={styles.metricValue}>
                      {(activePlan.distanceM / 1000).toFixed(1)} km
                    </Text>
                    <Text style={styles.metricSub}>
                      Drive: {formatHm(activePlan.driveMinutes)}
                    </Text>
                  </View>

                  <View style={styles.metricCell}>
                    <Text style={styles.metricLabel}>ARRIVAL BATTERY</Text>
                    <Text
                      style={[
                        styles.metricValue,
                        {
                          color: !activePlan.reachable
                            ? '#EF4444'
                            : activePlan.arrivalSoc <= 15
                            ? '#F59E0B'
                            : '#34D399',
                        },
                      ]}
                    >
                      {activePlan.reachable ? `${activePlan.arrivalSoc}%` : 'Unreachable'}
                    </Text>
                    <Text style={styles.metricSub}>
                      {activePlan.stops.length === 0
                        ? 'Direct non-stop drive'
                        : `With ${activePlan.stops.length} charging ${
                            activePlan.stops.length === 1 ? 'stop' : 'stops'
                          } (+${activePlan.chargeMinutes}m)`}
                    </Text>
                  </View>

                  <View style={styles.metricCell}>
                    <Text style={styles.metricLabel}>TERRAIN / GHATS</Text>
                    <Text
                      style={[
                        styles.metricValue,
                        {
                          color:
                            activePlan.terrainPercent > 3
                              ? '#F59E0B'
                              : activePlan.terrainPercent < -2
                              ? '#34D399'
                              : '#38BDF8',
                        },
                      ]}
                    >
                      {activePlan.terrainPercent >= 0 ? '+' : ''}
                      {activePlan.terrainPercent}% SoC
                    </Text>
                    <Text style={styles.metricSub}>
                      ⛰️ +{activeRouteChoice.climbM}m climb (Peak {activeRouteChoice.peakM}m)
                    </Text>
                  </View>

                  <View style={styles.metricCell}>
                    <Text style={styles.metricLabel}>PHYSICS ENERGY</Text>
                    <Text style={[styles.metricValue, { color: '#A78BFA' }]}>
                      {activePlan.energy.totalKwh.toFixed(1)} kWh
                    </Text>
                    <Text style={styles.metricSub}>
                      Flat {activePlan.energy.flatKwh.toFixed(1)} • Climb +
                      {activePlan.energy.climbKwh.toFixed(1)} • Regen -
                      {activePlan.energy.regenKwh.toFixed(1)}
                    </Text>
                  </View>
                </View>

                {!activePlan.reachable && activePlan.unreachableReason && (
                  <View
                    style={{
                      marginTop: 10,
                      padding: 10,
                      backgroundColor: '#7F1D1D35',
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: '#EF444480',
                    }}
                  >
                    <Text style={{ color: '#FCA5A5', fontSize: 11, fontWeight: '700' }}>
                      ⚠️ {activePlan.unreachableReason}
                    </Text>
                  </View>
                )}
              </View>

              {/* 4. Interactive SVG Elevation & Battery SoC Chart */}
              <ElevationAndSocChart
                plan={activePlan}
                minBuffer={settings.minArrivalAtChargerPercent}
              />

              {/* 5. Planned Charging Stops + Automatic Backup Charger + Offline/Broken Re-plan Button */}
              {activePlan.stops.length > 0 ? (
                <View style={{ gap: 10 }}>
                  <Text style={styles.fieldLabel}>
                    ⚡ PLANNED DC FAST CHARGING STOPS ({activePlan.stops.length})
                  </Text>
                  {activePlan.stops.map((stop, idx) => (
                    <PlannedStopItem
                      key={`${stop.charger.id}-${idx}`}
                      index={idx + 1}
                      stop={stop}
                      onNavigate={(pos, name) => openNavigation(pos.lat, pos.lng, name)}
                      onMarkBroken={() =>
                        handleMarkChargerVerdict(
                          stop.charger.id,
                          stop.charger.name,
                          'Broken'
                        )
                      }
                      onMarkWorked={() =>
                        handleMarkChargerVerdict(
                          stop.charger.id,
                          stop.charger.name,
                          'Worked'
                        )
                      }
                    />
                  ))}
                </View>
              ) : (
                <View style={styles.noStopsBanner}>
                  <Text style={{ color: '#34D399', fontSize: 13, fontWeight: '800' }}>
                    ✅ Non-Stop Drive! No Charging Required
                  </Text>
                  <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 2 }}>
                    Starting at {startSocInput}%, you will arrive at {selectedDest?.name} with approximately{' '}
                    <Text style={{ color: '#34D399', fontWeight: '800' }}>
                      {activePlan.arrivalSoc}%
                    </Text>{' '}
                    battery remaining (accounting for +{activeRouteChoice.climbM}m elevation climb).
                  </Text>
                </View>
              )}

              {/* 6. All DC Fast Chargers Along Route Corridor List */}
              {activeRouteChoice.chargers.length > 0 && (
                <View style={styles.corridorChargersBox}>
                  <Text style={styles.fieldLabel}>
                    🔌 ALL {activeRouteChoice.chargers.length} DC FAST CHARGERS ALONG THIS ROUTE (MAX GAP: {activeRouteChoice.longestGapKm} KM)
                  </Text>
                  <View style={{ gap: 6, marginTop: 8 }}>
                    {activeRouteChoice.chargers.map((c) => {
                      const plannedStop = activePlan.stops.find(
                        (s) => s.charger.id === c.id
                      );
                      const isPlanned = Boolean(plannedStop);
                      const isBackup = activePlan.stops.some(
                        (s) => s.backupCharger?.id === c.id
                      );
                      const isBroken =
                        (feedbackMap[c.id] || []).slice(-1)[0]?.verdict === 'Broken';

                      // 1. Calculate Estimated Arrival Battery % for this charger along the route
                      let estArrivalSoc: number | null = null;
                      let isReachable = true;

                      if (plannedStop) {
                        estArrivalSoc = Math.round(plannedStop.arriveSoc);
                        isReachable = estArrivalSoc > 0;
                      } else {
                        // Find simulated SoC at this distance in activePlan.socTrace
                        const trace = activePlan.socTrace || [];
                        const pt =
                          [...trace].reverse().find((p) => p.distanceM <= c.alongRouteM) ||
                          trace[0];
                        if (pt) {
                          const detourKwh =
                            c.detourM / 1000 / vehicleProfile.cityKmPerKwh;
                          const detourSoc =
                            (detourKwh / vehicleProfile.usableCapacityKwh) * 100;
                          const calculatedSoc = Math.round(pt.socPercent - detourSoc);
                          estArrivalSoc = calculatedSoc;
                          isReachable = calculatedSoc > 0;
                        }
                      }

                      // 2. Check if this charger is the NEXT charger following a planned stop with NO 25 km backup
                      const prevStopWithNoBackup = activePlan.stops.find(
                        (s) => !s.backupCharger && s.nextCharger?.id === c.id
                      );
                      const prevStopIdx = prevStopWithNoBackup
                        ? activePlan.stops.findIndex(
                            (s) => s.charger.id === prevStopWithNoBackup.charger.id
                          ) + 1
                        : null;

                      return (
                        <View
                          key={c.id}
                          style={[
                            styles.corridorRow,
                            isPlanned && {
                              borderColor: '#34D39980',
                              backgroundColor: '#064E3B25',
                            },
                            isBackup &&
                              !isPlanned && {
                                borderColor: '#38BDF860',
                                backgroundColor: '#0284C718',
                              },
                            isBroken && {
                              opacity: 0.5,
                              borderColor: '#EF444460',
                            },
                          ]}
                        >
                          <View style={{ flex: 1, paddingRight: 8 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <Text style={{ color: '#F8FAFC', fontSize: 12, fontWeight: '800' }}>
                                {c.name}
                              </Text>
                              {isPlanned && (
                                <View style={styles.tagPlanned}>
                                  <Text style={styles.tagPlannedText}>PLANNED STOP</Text>
                                </View>
                              )}
                              {isBackup && !isPlanned && (
                                <View style={styles.tagBackup}>
                                  <Text style={styles.tagBackupText}>BACKUP</Text>
                                </View>
                              )}

                              {/* Estimated Arrival Battery % Badge */}
                              {estArrivalSoc != null && isReachable ? (
                                <View
                                  style={[
                                    styles.tagPlanned,
                                    isPlanned
                                      ? { backgroundColor: '#064E3B', borderColor: '#10B981', borderWidth: 1 }
                                      : { backgroundColor: '#0C4A6E', borderColor: '#38BDF860', borderWidth: 1 },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.tagPlannedText,
                                      isPlanned ? { color: '#34D399' } : { color: '#38BDF8' },
                                    ]}
                                  >
                                    ⚡ Arrive: {estArrivalSoc}% SoC
                                  </Text>
                                </View>
                              ) : (
                                <View style={[styles.tagBackup, { backgroundColor: '#7F1D1D', borderColor: '#EF4444', borderWidth: 1 }]}>
                                  <Text style={[styles.tagBackupText, { color: '#FCA5A5' }]}>
                                    ❌ Won't Arrive (Exceeds Range)
                                  </Text>
                                </View>
                              )}

                              {isPlanned && !plannedStop?.backupCharger && (
                                <View style={[styles.tagBackup, { backgroundColor: '#78350F', borderColor: '#F59E0B60', borderWidth: 1 }]}>
                                  <Text style={[styles.tagBackupText, { color: '#FCD34D' }]}>
                                    ⚠️ No 25km Backup
                                  </Text>
                                </View>
                              )}

                              {isBroken && (
                                <View style={[styles.tagBackup, { backgroundColor: '#7F1D1D' }]}>
                                  <Text style={[styles.tagBackupText, { color: '#FCA5A5' }]}>
                                    MARKED OFFLINE
                                  </Text>
                                </View>
                              )}
                            </View>
                            <Text style={{ color: '#94A3B8', fontSize: 10, marginTop: 2 }}>
                              At {(c.alongRouteM / 1000).toFixed(0)} km • ⚡ {c.maxKw} kW CCS2
                              {c.network ? ` • ${c.network}` : ''}
                              {c.detourM > 400
                                ? ` • +${(c.detourM / 1000).toFixed(1)} km detour`
                                : ' • On highway'}
                              {c.availableCount != null
                                ? ` • 🟢 ${c.availableCount}/${c.connectorCount || '?'} free`
                                : ''}
                              {prevStopWithNoBackup && (
                                <Text
                                  style={{
                                    color:
                                      prevStopWithNoBackup.nextUnassistedSoc != null &&
                                      prevStopWithNoBackup.nextUnassistedSoc >= 0
                                        ? '#FCD34D'
                                        : '#F87171',
                                    fontWeight: '800',
                                  }}
                                >
                                  {prevStopWithNoBackup.nextUnassistedSoc != null &&
                                  prevStopWithNoBackup.nextUnassistedSoc >= 0
                                    ? ` • If Stop ${prevStopIdx} offline: ~${Math.round(prevStopWithNoBackup.nextUnassistedSoc)}% SoC`
                                    : ` • If Stop ${prevStopIdx} offline: ❌ Won't Reach!`}
                                </Text>
                              )}
                            </Text>
                          </View>

                          <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                            {!isBroken && (
                              <TouchableOpacity
                                style={styles.smallActionBtn}
                                onPress={() =>
                                  handleMarkChargerVerdict(c.id, c.name, 'Broken')
                                }
                              >
                                <Text style={{ color: '#FCA5A5', fontSize: 10, fontWeight: '700' }}>
                                  Offline?
                                </Text>
                              </TouchableOpacity>
                            )}
                            <TouchableOpacity
                              style={[styles.smallActionBtn, { borderColor: '#38BDF860' }]}
                              onPress={() =>
                                openNavigation(c.position.lat, c.position.lng, c.name)
                              }
                            >
                              <Text style={{ color: '#38BDF8', fontSize: 10, fontWeight: '700' }}>
                                🧭 Map
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Open-Source Attribution Footer (Credit to Irshad Melethil / Volta Android) */}
          <View style={styles.creditBox}>
            <Text style={styles.creditText}>
              🙏 <Text style={{ fontWeight: '800', color: '#E2E8F0' }}>Trip Planner Credits:</Text>{' '}
              Physics elevation model, Dijkstra optimal stop planner &amp; backup charger selection ported from{' '}
              <Text
                style={styles.creditLink}
                onPress={() => Linking.openURL('https://github.com/irshadm/volta-android')}
              >
                irshadm/volta-android
              </Text>{' '}
              by{' '}
              <Text
                style={styles.creditLink}
                onPress={() => Linking.openURL('https://irshadm.dev/volta/')}
              >
                Irshad Melethil
              </Text>{' '}
              (Apache License 2.0).
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

function PlannedStopItem({
  index,
  stop,
  onNavigate,
  onMarkBroken,
  onMarkWorked,
}: {
  index: number;
  stop: PlannedStop;
  onNavigate: (pos: LatLng, name: string) => void;
  onMarkBroken: () => void;
  onMarkWorked: () => void;
}) {
  const c = stop.charger;
  const dots = stop.confidenceDots || 4;
  const dotStr = '●'.repeat(dots) + '○'.repeat(Math.max(0, 5 - dots));

  return (
    <View style={styles.stopCard}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <View style={styles.stopBadge}>
              <Text style={styles.stopBadgeText}>STOP {index}</Text>
            </View>
            <Text style={{ color: '#F8FAFC', fontSize: 14, fontWeight: '900' }}>
              {c.name}
            </Text>
          </View>
          <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 3 }}>
            At {(c.alongRouteM / 1000).toFixed(1)} km • ⚡ {c.maxKw} kW CCS2
            {c.network ? ` • ${c.network}` : ''}
            {c.detourM > 400
              ? ` • +${(c.detourM / 1000).toFixed(1)} km detour`
              : ' • Right on highway'}
          </Text>
          {c.address ? (
            <Text style={{ color: '#64748B', fontSize: 10, marginTop: 1 }} numberOfLines={1}>
              📍 {c.address}
            </Text>
          ) : null}
        </View>

        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: '#34D399', fontSize: 11, fontWeight: '800' }}>
            {dotStr} {stop.confidenceLabel || 'Reliable'}
          </Text>
          {c.availableCount != null && (
            <Text
              style={{
                color: c.availableCount > 0 ? '#34D399' : '#F87171',
                fontSize: 10,
                fontWeight: '700',
                marginTop: 2,
              }}
            >
              {c.availableCount > 0
                ? `🟢 ${c.availableCount}/${c.connectorCount || '?'} plugs free`
                : '🔴 0 plugs free right now'}
            </Text>
          )}
        </View>
      </View>

      {/* Charge From -> To Bar */}
      <View style={styles.stopSocRow}>
        <View>
          <Text style={styles.metricLabel}>ARRIVE</Text>
          <Text style={{ color: '#F59E0B', fontSize: 16, fontWeight: '900' }}>
            {Math.round(stop.arriveSoc)}%
          </Text>
        </View>
        <Text style={{ color: '#64748B', fontSize: 16, fontWeight: '900' }}>➔</Text>
        <View>
          <Text style={styles.metricLabel}>CHARGE TO</Text>
          <Text style={{ color: '#34D399', fontSize: 16, fontWeight: '900' }}>
            {Math.round(stop.departSoc)}%
          </Text>
        </View>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          <Text style={styles.metricLabel}>EST. CHARGE TIME</Text>
          <Text style={{ color: '#38BDF8', fontSize: 15, fontWeight: '900' }}>
            ⏱️ ~{stop.chargeMinutes} mins
          </Text>
        </View>
      </View>

      {/* Automatic Backup Charger Box OR No-Backup Alert */}
      {stop.backupCharger ? (
        <View style={styles.backupBox}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={{ color: '#38BDF8', fontSize: 10, fontWeight: '800' }}>
              🛡️ BACKUP CHARGER ({stop.backupDistanceKm && stop.backupDistanceKm >= 0 ? `+${stop.backupDistanceKm} km ahead` : `${stop.backupDistanceKm} km earlier`})
            </Text>
            <Text style={{ color: '#E2E8F0', fontSize: 12, fontWeight: '700', marginTop: 1 }}>
              {stop.backupCharger.name} ({stop.backupCharger.maxKw} kW)
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.smallActionBtn, { borderColor: '#38BDF8' }]}
            onPress={() =>
              onNavigate(stop.backupCharger!.position, stop.backupCharger!.name)
            }
          >
            <Text style={{ color: '#38BDF8', fontSize: 10, fontWeight: '800' }}>
              🧭 Backup Map
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View
          style={[
            styles.backupBox,
            {
              backgroundColor:
                stop.nextUnassistedSoc != null && stop.nextUnassistedSoc >= 0
                  ? '#78350F25'
                  : '#7F1D1D25',
              borderColor:
                stop.nextUnassistedSoc != null && stop.nextUnassistedSoc >= 0
                  ? '#F59E0B70'
                  : '#EF444470',
            },
          ]}
        >
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text
              style={{
                color:
                  stop.nextUnassistedSoc != null && stop.nextUnassistedSoc >= 0
                    ? '#FCD34D'
                    : '#FCA5A5',
                fontSize: 10,
                fontWeight: '900',
                letterSpacing: 0.5,
              }}
            >
              {stop.nextUnassistedSoc != null && stop.nextUnassistedSoc >= 0
                ? '⚠️ NO BACKUP CHARGER WITHIN 25 KM'
                : '🚨 NO BACKUP WITHIN 25 KM — EXCEEDS BATTERY RANGE'}
            </Text>
            {stop.nextCharger ? (
              <View style={{ marginTop: 2 }}>
                <Text style={{ color: '#E2E8F0', fontSize: 11, fontWeight: '700' }}>
                  Next charger on route: {stop.nextCharger.name} at {(stop.nextCharger.alongRouteM / 1000).toFixed(0)} km (+{stop.nextDistanceKm} km ahead)
                </Text>
                {stop.nextUnassistedSoc != null && stop.nextUnassistedSoc >= 0 ? (
                  <Text style={{ color: '#34D399', fontSize: 11, fontWeight: '800', marginTop: 2 }}>
                    • If this station is offline: Approx. arrival with current battery is ~{Math.round(stop.nextUnassistedSoc)}% SoC (Reachable)
                  </Text>
                ) : (
                  <Text style={{ color: '#F87171', fontSize: 11, fontWeight: '800', marginTop: 2 }}>
                    • ❌ Won't reach next charger if this station is offline! Exceeds range ({Math.round(stop.arriveSoc)}% battery gives max ~{stop.maxUnassistedRangeKm} km, shortfall of {Math.max(1, Math.round((stop.nextDistanceKm || 0) - (stop.maxUnassistedRangeKm || 0)))} km)
                  </Text>
                )}
              </View>
            ) : (
              <Text style={{ color: '#94A3B8', fontSize: 11, marginTop: 2 }}>
                Last charging station on this corridor before destination.
              </Text>
            )}
          </View>
          {stop.nextCharger && (
            <TouchableOpacity
              style={[
                styles.smallActionBtn,
                {
                  borderColor:
                    stop.nextUnassistedSoc != null && stop.nextUnassistedSoc >= 0
                      ? '#F59E0B'
                      : '#EF4444',
                },
              ]}
              onPress={() =>
                onNavigate(stop.nextCharger!.position, stop.nextCharger!.name)
              }
            >
              <Text
                style={{
                  color:
                    stop.nextUnassistedSoc != null && stop.nextUnassistedSoc >= 0
                      ? '#F59E0B'
                      : '#EF4444',
                  fontSize: 10,
                  fontWeight: '800',
                }}
              >
                🧭 Next Map
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Action Buttons: Navigate / Mark Offline & Re-plan */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <TouchableOpacity
          style={[styles.stopBtn, { backgroundColor: '#0284C7', flex: 1.2 }]}
          onPress={() => onNavigate(c.position, c.name)}
        >
          <Text style={styles.stopBtnText}>🧭 Navigate to Stop</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.stopBtn, { backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#34D39960', flex: 0.8 }]}
          onPress={onMarkWorked}
        >
          <Text style={[styles.stopBtnText, { color: '#34D399' }]}>👍 Worked</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.stopBtn, { backgroundColor: '#7F1D1D40', borderWidth: 1, borderColor: '#EF444480', flex: 1.2 }]}
          onPress={onMarkBroken}
        >
          <Text style={[styles.stopBtnText, { color: '#FCA5A5' }]}>
            ⚠️ Offline (Re-plan)
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ElevationAndSocChart({
  plan,
  minBuffer,
}: {
  plan: TripPlan;
  minBuffer: number;
}) {
  const trace = plan.socTrace;
  if (trace.length < 2) return null;

  const width = 340;
  const height = 135;
  const padL = 28;
  const padR = 28;
  const padT = 14;
  const padB = 22;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const totalDistM = Math.max(1, plan.distanceM);
  const maxElev = Math.max(100, ...trace.map((p) => p.elevationM));
  const minElev = Math.min(0, ...trace.map((p) => p.elevationM));
  const elevSpan = Math.max(50, maxElev - minElev);

  const xOf = (distM: number) => padL + (distM / totalDistM) * plotW;
  const ySoc = (soc: number) =>
    padT + plotH - (Math.max(0, Math.min(100, soc)) / 100) * plotH;
  const yElev = (elev: number) =>
    padT + plotH - ((elev - minElev) / elevSpan) * (plotH * 0.65);

  // Build SVG Path for Elevation Area
  let elevPath = `M ${xOf(trace[0].distanceM).toFixed(1)} ${(padT + plotH).toFixed(1)} `;
  for (const pt of trace) {
    elevPath += `L ${xOf(pt.distanceM).toFixed(1)} ${yElev(pt.elevationM).toFixed(1)} `;
  }
  elevPath += `L ${xOf(trace[trace.length - 1].distanceM).toFixed(1)} ${(
    padT + plotH
  ).toFixed(1)} Z`;

  // Build SVG Path for Battery SoC Curve
  let socPath = '';
  trace.forEach((pt, idx) => {
    const cmd = idx === 0 ? 'M' : 'L';
    socPath += `${cmd} ${xOf(pt.distanceM).toFixed(1)} ${ySoc(pt.socPercent).toFixed(
      1
    )} `;
  });

  const bufY = ySoc(minBuffer);

  return (
    <View style={styles.chartBox}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={styles.fieldLabel}>
          📈 BATTERY SOC % (GREEN) &amp; ELEVATION PROFILE (BLUE)
        </Text>
        <Text style={{ color: '#64748B', fontSize: 10 }}>
          Peak: {Math.round(maxElev)}m
        </Text>
      </View>

      <View style={{ alignItems: 'center' }}>
        <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
          {/* Grid lines */}
          {[25, 50, 75, 100].map((pct) => (
            <React.Fragment key={pct}>
              <Line
                x1={padL}
                y1={ySoc(pct)}
                x2={width - padR}
                y2={ySoc(pct)}
                stroke="#1E293B"
                strokeWidth="1"
              />
              <SvgText
                x={padL - 4}
                y={ySoc(pct) + 3}
                fill="#64748B"
                fontSize="8"
                textAnchor="end"
              >
                {pct}%
              </SvgText>
            </React.Fragment>
          ))}

          {/* Min Charger Buffer Line */}
          <Line
            x1={padL}
            y1={bufY}
            x2={width - padR}
            y2={bufY}
            stroke="#EF444480"
            strokeWidth="1"
            strokeDasharray="3,3"
          />

          {/* Elevation Shaded Area */}
          <Path d={elevPath} fill="#0284C735" stroke="#38BDF880" strokeWidth="1.2" />

          {/* Battery SoC Line */}
          <Path d={socPath} fill="none" stroke="#34D399" strokeWidth="2.2" />

          {/* Charging Stop Dots */}
          {plan.stops.map((s, i) => (
            <React.Fragment key={i}>
              <Circle
                cx={xOf(s.charger.alongRouteM)}
                cy={ySoc(s.arriveSoc)}
                r="3.5"
                fill="#F59E0B"
              />
              <Circle
                cx={xOf(s.charger.alongRouteM)}
                cy={ySoc(s.departSoc)}
                r="3.5"
                fill="#34D399"
              />
            </React.Fragment>
          ))}

          {/* Distance X-Axis Labels */}
          <SvgText x={padL} y={height - 5} fill="#94A3B8" fontSize="8" textAnchor="start">
            0 km
          </SvgText>
          <SvgText
            x={padL + plotW / 2}
            y={height - 5}
            fill="#94A3B8"
            fontSize="8"
            textAnchor="middle"
          >
            {Math.round(totalDistM / 2000)} km
          </SvgText>
          <SvgText
            x={width - padR}
            y={height - 5}
            fill="#94A3B8"
            fontSize="8"
            textAnchor="end"
          >
            {Math.round(totalDistM / 1000)} km
          </SvgText>
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111827',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 3,
  },
  chevron: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '800',
  },
  badge: {
    backgroundColor: '#064E3B',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#059669',
  },
  badgeText: {
    color: '#34D399',
    fontSize: 10,
    fontWeight: '800',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-end',
  },
  fieldLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  input: {
    backgroundColor: '#0A0E17',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    color: '#F8FAFC',
    fontSize: 13,
  },
  pillBtn: {
    backgroundColor: '#0A0E17',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillBtnActive: {
    backgroundColor: '#0284C728',
    borderColor: '#38BDF8',
  },
  pillBtnText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  pillBtnTextActive: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '800',
  },
  planBtn: {
    backgroundColor: '#10B981',
    paddingHorizontal: 16,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  planBtnText: {
    color: '#042F2E',
    fontWeight: '900',
    fontSize: 13,
  },
  suggestionsBox: {
    marginTop: 6,
    backgroundColor: '#0A0E17',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    overflow: 'hidden',
  },
  suggestionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  suggestionTitle: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  suggestionSub: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 1,
  },
  suggestionDist: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 8,
  },
  quickChip: {
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
  },
  quickChipText: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '700',
  },
  settingsBox: {
    marginTop: 10,
    backgroundColor: '#0A0E17',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  settingsHeader: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '800',
  },
  statusBox: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    backgroundColor: '#0284C720',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#38BDF850',
  },
  routeTab: {
    backgroundColor: '#0A0E17',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexGrow: 1,
  },
  routeTabActive: {
    borderColor: '#10B981',
    backgroundColor: '#064E3B25',
  },
  routeTabTitle: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '800',
  },
  routeTabSub: {
    color: '#94A3B8',
    fontSize: 10,
    marginTop: 2,
  },
  summaryBox: {
    backgroundColor: '#0A0E17',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  summaryHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  navAllBtn: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
  },
  navAllBtnText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metricCell: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: '#0F172A',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  metricLabel: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  metricValue: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '900',
    marginTop: 2,
  },
  metricSub: {
    color: '#94A3B8',
    fontSize: 10,
    marginTop: 2,
  },
  chartBox: {
    backgroundColor: '#0A0E17',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  stopCard: {
    backgroundColor: '#0A0E17',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#10B98150',
  },
  stopBadge: {
    backgroundColor: '#064E3B',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  stopBadgeText: {
    color: '#34D399',
    fontSize: 10,
    fontWeight: '900',
  },
  stopSocRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 10,
    backgroundColor: '#0F172A',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  backupBox: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0284C715',
    padding: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#38BDF840',
  },
  stopBtn: {
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopBtnText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
  },
  noStopsBanner: {
    backgroundColor: '#064E3B25',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#10B98160',
  },
  corridorChargersBox: {
    backgroundColor: '#0A0E17',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  corridorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    padding: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  tagPlanned: {
    backgroundColor: '#064E3B',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  tagPlannedText: {
    color: '#34D399',
    fontSize: 9,
    fontWeight: '800',
  },
  tagBackup: {
    backgroundColor: '#0C4A6E',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  tagBackupText: {
    color: '#38BDF8',
    fontSize: 9,
    fontWeight: '800',
  },
  smallActionBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#EF444460',
    backgroundColor: '#0A0E17',
  },
  creditBox: {
    marginTop: 12,
    padding: 10,
    backgroundColor: '#0A0E17',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  creditText: {
    color: '#94A3B8',
    fontSize: 10,
    lineHeight: 15,
  },
  creditLink: {
    color: '#38BDF8',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
