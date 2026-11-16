import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Linking,
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
  ComputedNextServiceStatus,
  ComputedWheelServiceItemStatus,
  computeMilestoneCost,
  computeServiceIntervalProgress,
  DEFAULT_SERVICE_WARNING_DAYS,
  DEFAULT_SERVICE_WARNING_KM,
  DEFAULT_WHEEL_SERVICE_WARNING_KM,
  formatInrAmount,
  formatIsoDateShort,
  formatKmNumber,
  formatServiceDaysCountdownText,
  getServiceMilestonesUpTo,
  getTodayLocalIsoDate,
  isValidIsoDateString,
  SERVICE_SCHEDULE_SOURCE_URL,
  ServiceReminderSettings,
  ServiceScheduleCatalog,
  WHEEL_SERVICE_META,
  WheelServiceKey,
} from './sdk';

export type ServiceSubScreenKey = 'lastService' | 'alerts' | 'schedule';

interface ServiceReminderScreenProps {
  translateX: Animated.AnimatedInterpolation<string | number>;
  odometerKm: number | null;
  catalog: ServiceScheduleCatalog;
  isSyncingCatalog: boolean;
  catalogSyncError: string | null;
  onRefreshCatalog: () => void;
  settings: ServiceReminderSettings;
  serviceStatus: ComputedNextServiceStatus;
  wheelStatuses: ComputedWheelServiceItemStatus[];
  onChangeSettings: (next: ServiceReminderSettings) => void;
  onClose: () => void;
  activeSubScreen: ServiceSubScreenKey | null;
  subScreenTranslateX: Animated.AnimatedInterpolation<string | number>;
  onOpenSubScreen: (key: ServiceSubScreenKey) => void;
  onCloseSubScreen: () => void;
  onShowBanner?: (type: 'ok' | 'err', msg: string) => void;
}

function formatAutoDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function formatSyncTimestamp(iso: string | null): string {
  if (!iso) return 'Using offline baseline';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function BackButton({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <TouchableOpacity
      style={styles.backBtn}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityLabel={label}
      accessibilityRole="button"
    >
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#F8FAFC" strokeWidth={2.4}>
        <Path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </TouchableOpacity>
  );
}

export const ServiceReminderScreen: React.FC<ServiceReminderScreenProps> = ({
  translateX,
  odometerKm,
  catalog,
  isSyncingCatalog,
  catalogSyncError,
  onRefreshCatalog,
  settings,
  serviceStatus,
  wheelStatuses,
  onChangeSettings,
  onClose,
  activeSubScreen,
  subScreenTranslateX,
  onOpenSubScreen,
  onCloseSubScreen,
  onShowBanner,
}) => {
  const todayIso = getTodayLocalIsoDate();

  // ---- Last service draft state (committed on Save) ----
  const [dateDraft, setDateDraft] = useState<string>(settings.lastServiceDate || '');
  const [isDateFocused, setIsDateFocused] = useState<boolean>(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const [odoDraft, setOdoDraft] = useState<string>(
    settings.lastServiceOdoKm !== null && settings.lastServiceOdoKm !== undefined
      ? String(settings.lastServiceOdoKm)
      : ''
  );
  const [isOdoFocused, setIsOdoFocused] = useState<boolean>(false);
  const [milestoneDraft, setMilestoneDraft] = useState<number | null>(settings.lastServiceMilestoneKm);
  const [showAllLastMilestones, setShowAllLastMilestones] = useState<boolean>(false);

  // ---- Alerts & tyre care state (live updates) ----
  const [warnDaysDraft, setWarnDaysDraft] = useState<string>(String(settings.warningDays));
  const [isWarnDaysFocused, setIsWarnDaysFocused] = useState<boolean>(false);
  const [warnKmDraft, setWarnKmDraft] = useState<string>(String(settings.warningKm));
  const [isWarnKmFocused, setIsWarnKmFocused] = useState<boolean>(false);
  const [expandedWheelKey, setExpandedWheelKey] = useState<WheelServiceKey | null>('balancing');
  const [wheelLastKmDrafts, setWheelLastKmDrafts] = useState<Record<WheelServiceKey, string>>({
    balancing:
      settings.wheelServices.balancing.lastDoneKm !== null
        ? String(settings.wheelServices.balancing.lastDoneKm)
        : '',
    alignment:
      settings.wheelServices.alignment.lastDoneKm !== null
        ? String(settings.wheelServices.alignment.lastDoneKm)
        : '',
    rotation:
      settings.wheelServices.rotation.lastDoneKm !== null
        ? String(settings.wheelServices.rotation.lastDoneKm)
        : '',
  });
  const [focusedWheelLastKey, setFocusedWheelLastKey] = useState<WheelServiceKey | null>(null);
  const [wheelWarnKmDrafts, setWheelWarnKmDrafts] = useState<Record<WheelServiceKey, string>>({
    balancing: String(settings.wheelServices.balancing.warningKm),
    alignment: String(settings.wheelServices.alignment.warningKm),
    rotation: String(settings.wheelServices.rotation.warningKm),
  });
  const [focusedWheelWarnKey, setFocusedWheelWarnKey] = useState<WheelServiceKey | null>(null);

  // ---- Replacement schedule state ----
  const [inspectKm, setInspectKm] = useState<number>(serviceStatus.nextMilestone.km);

  // Refresh drafts whenever opening a sub-screen
  useEffect(() => {
    if (activeSubScreen === 'lastService') {
      setDateDraft(settings.lastServiceDate || '');
      setDateError(null);
      setIsDateFocused(false);
      setOdoDraft(
        settings.lastServiceOdoKm !== null && settings.lastServiceOdoKm !== undefined
          ? String(settings.lastServiceOdoKm)
          : ''
      );
      setIsOdoFocused(false);
      setMilestoneDraft(settings.lastServiceMilestoneKm);
      setShowAllLastMilestones(
        (settings.lastServiceMilestoneKm ?? 0) > 30000 || (odometerKm ?? 0) >= 45000
      );
    } else if (activeSubScreen === 'alerts') {
      setWarnDaysDraft(String(settings.warningDays));
      setWarnKmDraft(String(settings.warningKm));
      setIsWarnDaysFocused(false);
      setIsWarnKmFocused(false);
      setExpandedWheelKey((prev) => prev || 'balancing');
    } else if (activeSubScreen === 'schedule') {
      setInspectKm(serviceStatus.nextMilestone.km);
    }
  }, [activeSubScreen]);

  useEffect(() => {
    setWarnDaysDraft(String(settings.warningDays));
  }, [settings.warningDays]);

  useEffect(() => {
    setWarnKmDraft(String(settings.warningKm));
  }, [settings.warningKm]);

  useEffect(() => {
    setWheelLastKmDrafts({
      balancing:
        settings.wheelServices.balancing.lastDoneKm !== null
          ? String(settings.wheelServices.balancing.lastDoneKm)
          : '',
      alignment:
        settings.wheelServices.alignment.lastDoneKm !== null
          ? String(settings.wheelServices.alignment.lastDoneKm)
          : '',
      rotation:
        settings.wheelServices.rotation.lastDoneKm !== null
          ? String(settings.wheelServices.rotation.lastDoneKm)
          : '',
    });
    setWheelWarnKmDrafts({
      balancing: String(settings.wheelServices.balancing.warningKm),
      alignment: String(settings.wheelServices.alignment.warningKm),
      rotation: String(settings.wheelServices.rotation.warningKm),
    });
  }, [settings.wheelServices]);

  const milestones = getServiceMilestonesUpTo(
    Math.max(odometerKm ?? 0, serviceStatus.nextMilestone.km + 15000),
    catalog
  );

  const lastServiceMilestoneCap = Math.max(
    30000,
    serviceStatus.previousMilestone?.km ?? 0,
    milestoneDraft ?? 0
  );
  const visibleLastServiceMilestones = showAllLastMilestones
    ? milestones.slice(0, 12)
    : milestones.filter((m) => m.km <= lastServiceMilestoneCap);
  const hasHiddenMilestones = !showAllLastMilestones && milestones.length > visibleLastServiceMilestones.length;

  const intervalProgress = computeServiceIntervalProgress({
    odometerKm,
    lastServiceOdoKm: settings.lastServiceOdoKm,
    previousMilestoneKm: serviceStatus.previousMilestone?.km ?? null,
    nextMilestoneKm: serviceStatus.nextMilestone.km,
  });

  const accentColor =
    serviceStatus.urgency === 'overdue'
      ? '#F87171'
      : serviceStatus.urgency === 'warning'
        ? '#FBBF24'
        : '#34D399';

  const urgencyBadge =
    serviceStatus.urgency === 'overdue'
      ? {
          label: 'Overdue',
          bg: 'rgba(239, 68, 68, 0.16)',
          color: '#FCA5A5',
        }
      : serviceStatus.urgency === 'warning'
        ? {
            label: 'Due soon',
            bg: 'rgba(245, 158, 11, 0.16)',
            color: '#FCD34D',
          }
        : {
            label: 'On track',
            bg: 'rgba(16, 185, 129, 0.16)',
            color: '#34D399',
          };

  const formatHubDistanceLeft = () => {
    if (serviceStatus.kmRemaining === null) return '-- km';
    if (serviceStatus.kmRemaining < 0) {
      return `${formatKmNumber(Math.abs(serviceStatus.kmRemaining))} km overdue`;
    }
    if (serviceStatus.kmRemaining === 0) return 'Due now';
    return `${formatKmNumber(serviceStatus.kmRemaining)} km`;
  };

  const formatHubTimeLeft = () => {
    if (serviceStatus.daysRemaining === null) return 'Add date';
    if (serviceStatus.daysRemaining < 0) {
      const overdue = Math.abs(serviceStatus.daysRemaining);
      return `${overdue} day${overdue === 1 ? '' : 's'} overdue`;
    }
    if (serviceStatus.daysRemaining === 0) return 'Due today';
    return `${serviceStatus.daysRemaining} day${serviceStatus.daysRemaining === 1 ? '' : 's'}`;
  };

  const handleMarkNextServiceDoneToday = () => {
    const roundedOdo =
      odometerKm !== null && Number.isFinite(odometerKm)
        ? Math.round(odometerKm)
        : serviceStatus.nextMilestone.km;
    onChangeSettings({
      ...settings,
      lastServiceDate: todayIso,
      lastServiceOdoKm: roundedOdo,
      lastServiceMilestoneKm: serviceStatus.nextMilestone.km,
    });
    onShowBanner?.(
      'ok',
      `Logged ${formatKmNumber(serviceStatus.nextMilestone.km)} km service on ${formatIsoDateShort(todayIso)}`
    );
  };

  // ---- Last Service Handlers ----
  const handleLastDateDraftInput = (val: string) => {
    const cleaned = val.trim();
    const formatted =
      cleaned.length > dateDraft.length && !cleaned.includes('-')
        ? formatAutoDateInput(cleaned)
        : cleaned.slice(0, 10);
    setDateDraft(formatted);
    if (!formatted || isValidIsoDateString(formatted)) {
      setDateError(null);
    }
  };

  const handleLastOdoDraftInput = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 7);
    setOdoDraft(digits);
  };

  const handleSaveLastService = () => {
    const trimmedDate = dateDraft.trim();
    if (trimmedDate && !isValidIsoDateString(trimmedDate)) {
      setDateError('Enter a valid calendar date (YYYY-MM-DD).');
      return;
    }
    const cleanOdoDigits = odoDraft.replace(/\D/g, '');
    const parsedOdo = cleanOdoDigits ? Math.min(1000000, Number(cleanOdoDigits)) : null;
    onChangeSettings({
      ...settings,
      lastServiceDate: trimmedDate || null,
      lastServiceOdoKm:
        parsedOdo !== null && Number.isFinite(parsedOdo) ? parsedOdo : null,
      lastServiceMilestoneKm: milestoneDraft,
    });
    onShowBanner?.('ok', 'Service record updated');
    onCloseSubScreen();
  };

  // ---- Alerts & Tyre Care Handlers ----
  const handleWarnDaysText = (val: string) => {
    const digits = val.replace(/\D/g, '');
    setWarnDaysDraft(digits);
    const num = Number(digits);
    if (digits && Number.isFinite(num) && num >= 1) {
      onChangeSettings({ ...settings, warningDays: Math.min(365, num) });
    }
  };

  const handleWarnKmText = (val: string) => {
    const digits = val.replace(/\D/g, '');
    setWarnKmDraft(digits);
    const num = Number(digits);
    if (digits && Number.isFinite(num) && num >= 50) {
      onChangeSettings({ ...settings, warningKm: Math.min(20000, num) });
    }
  };

  const handleStepWarnDays = (delta: number) => {
    const nextVal = Math.max(1, Math.min(365, settings.warningDays + delta));
    setWarnDaysDraft(String(nextVal));
    onChangeSettings({ ...settings, warningDays: nextVal });
  };

  const handleStepWarnKm = (delta: number) => {
    const nextVal = Math.max(50, Math.min(20000, settings.warningKm + delta));
    setWarnKmDraft(String(nextVal));
    onChangeSettings({ ...settings, warningKm: nextVal });
  };

  const updateWheel = (
    key: WheelServiceKey,
    patch: Partial<ServiceReminderSettings['wheelServices'][WheelServiceKey]>
  ) => {
    onChangeSettings({
      ...settings,
      wheelServices: {
        ...settings.wheelServices,
        [key]: {
          ...settings.wheelServices[key],
          ...patch,
        },
      },
    });
  };

  const handleMarkWheelDoneNow = (key: WheelServiceKey) => {
    if (odometerKm === null || !Number.isFinite(odometerKm)) {
      onShowBanner?.('err', 'Sync live odometer first or type the last-done km.');
      return;
    }
    const rounded = Math.round(odometerKm);
    setWheelLastKmDrafts((prev) => ({ ...prev, [key]: String(rounded) }));
    updateWheel(key, { enabled: true, lastDoneKm: rounded, lastDoneDate: todayIso });
    onShowBanner?.(
      'ok',
      `${WHEEL_SERVICE_META[key].label} marked done at ${formatKmNumber(rounded)} km`
    );
  };

  const formatWheelCountdownText = (item: ComputedWheelServiceItemStatus): string => {
    if (!item.enabled) return 'Disabled';
    if (item.lastDoneKm === null) return 'Set last done km';
    if (item.kmRemaining === null) return `Due at ${formatKmNumber(item.nextDueKm ?? 0)} km`;
    if (item.kmRemaining < 0) return `${formatKmNumber(Math.abs(item.kmRemaining))} km overdue`;
    if (item.kmRemaining === 0) return 'Due now';
    return `${formatKmNumber(item.kmRemaining)} km left`;
  };

  const enabledWheelCount = wheelStatuses.filter((w) => w.enabled).length;
  const replacementCount = serviceStatus.nextMilestone.replacements.length;

  const scheduleDisclaimerText =
    serviceStatus.lastServiceDate && serviceStatus.previousMilestone
      ? `Prices are approximate. They are based on your ${formatKmNumber(
          serviceStatus.previousMilestone.km
        )} km service on ${formatIsoDateShort(
          serviceStatus.lastServiceDate
        )} and may change with price revisions, taxes or labour charges. They update only after your next service.`
      : catalog.priceNote;

  return (
    <>
      {/* Root Hub Screen: Service reminder */}
      <Animated.View
        style={[
          styles.layer,
          {
            transform: [{ translateX }],
          },
        ]}
      >
        <SafeAreaView style={styles.safeArea}>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={styles.header}>
              <BackButton onPress={onClose} label="Back to Profile" />
              <View style={{ flex: 1 }}>
                <Text style={styles.headerTitle}>Service reminder</Text>
                <Text style={styles.headerSub}>
                  Odometer {odometerKm !== null ? `${formatKmNumber(odometerKm)} km` : 'not synced'}
                </Text>
              </View>
            </View>

            {/* 1. Hero Next Service Card */}
            <View style={styles.card}>
              <View style={styles.heroTopRow}>
                <Text style={[styles.heroEyebrow, { color: accentColor }]}>NEXT SERVICE</Text>
                <View style={[styles.statusBadge, { backgroundColor: urgencyBadge.bg }]}>
                  <Text style={[styles.statusBadgeText, { color: urgencyBadge.color }]}>
                    {urgencyBadge.label}
                  </Text>
                </View>
              </View>

              <Text style={styles.heroTitle}>
                {formatKmNumber(serviceStatus.nextMilestone.km)} km ·{' '}
                {serviceStatus.nextMilestone.timeLabel.toLowerCase()}
              </Text>
              {serviceStatus.previousMilestone ? (
                <Text style={styles.heroSub}>
                  Previous: {formatKmNumber(serviceStatus.previousMilestone.km)} km (
                  {serviceStatus.previousMilestone.timeLabel.toLowerCase()})
                </Text>
              ) : (
                <Text style={styles.heroSub}>First scheduled inspection milestone</Text>
              )}

              {/* Progress Bar */}
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.round(intervalProgress.fraction * 100)}%`,
                      backgroundColor: accentColor,
                    },
                  ]}
                />
              </View>
              <View style={styles.progressLabelsRow}>
                <Text style={styles.progressLabelText}>{intervalProgress.startLabel}</Text>
                <Text style={styles.progressLabelText}>{intervalProgress.targetLabel}</Text>
              </View>

              <View style={styles.heroDivider} />

              {/* 3-Column Metrics */}
              <View style={styles.heroMetricsRow}>
                <View style={styles.heroMetricCol}>
                  <Text style={styles.heroMetricLabel}>Distance left</Text>
                  <Text
                    style={[
                      styles.heroMetricVal,
                      serviceStatus.isKmWarning && { color: urgencyBadge.color },
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {formatHubDistanceLeft()}
                  </Text>
                  <Text style={styles.heroMetricSub} numberOfLines={1}>
                    Target {formatKmNumber(serviceStatus.nextMilestone.km)} km
                  </Text>
                </View>

                <View style={styles.heroMetricCol}>
                  <Text style={styles.heroMetricLabel}>Time left</Text>
                  <Text
                    style={[
                      styles.heroMetricVal,
                      serviceStatus.isDaysWarning && { color: urgencyBadge.color },
                      serviceStatus.daysRemaining === null && { color: '#94A3B8' },
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {formatHubTimeLeft()}
                  </Text>
                  <Text style={styles.heroMetricSub} numberOfLines={1}>
                    {serviceStatus.nextDueDate
                      ? `Due ${formatIsoDateShort(serviceStatus.nextDueDate)}`
                      : `Every ${serviceStatus.intervalMonths} mo`}
                  </Text>
                </View>

                <View style={styles.heroMetricCol}>
                  <Text style={styles.heroMetricLabel}>Approx. cost</Text>
                  <Text style={[styles.heroMetricVal, { color: '#34D399' }]} numberOfLines={1}>
                    {formatInrAmount(serviceStatus.cost.totalInr)}
                  </Text>
                  <Text style={styles.heroMetricSub} numberOfLines={1}>
                    {replacementCount > 0
                      ? `${replacementCount} replacement${replacementCount === 1 ? '' : 's'}`
                      : 'Inspection only'}
                  </Text>
                </View>
              </View>
            </View>

            {/* 2. Estimated Cost Breakdown Card */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Estimated cost</Text>
              {serviceStatus.cost.lineItems.length === 0 ? (
                <Text style={styles.mutedLineText}>
                  No mandatory replacements at {formatKmNumber(serviceStatus.nextMilestone.km)} km (inspection only).
                </Text>
              ) : (
                serviceStatus.cost.lineItems.map((item) => (
                  <View key={item.name} style={styles.costLineRow}>
                    <Text style={styles.costLineLabel}>
                      {item.kind === 'labour' ? 'Paid service (from 30k km)' : item.name}
                    </Text>
                    <Text style={styles.costLineVal}>{formatInrAmount(item.amountInr)}</Text>
                  </View>
                ))
              )}
              <View style={styles.costTotalRow}>
                <Text style={styles.costTotalLabel}>Total</Text>
                <Text style={styles.costTotalVal}>{formatInrAmount(serviceStatus.cost.totalInr)}</Text>
              </View>
            </View>

            {/* 3. Primary Solid Mint Action Button */}
            <TouchableOpacity
              style={styles.primaryCtaBtn}
              onPress={handleMarkNextServiceDoneToday}
              activeOpacity={0.82}
              accessibilityRole="button"
              accessibilityLabel={`Mark ${formatKmNumber(serviceStatus.nextMilestone.km)} km service done today`}
            >
              <Text style={styles.primaryCtaText}>
                Mark {formatKmNumber(serviceStatus.nextMilestone.km)} km service done today
              </Text>
            </TouchableOpacity>

            {/* 4. Sub-screen Navigation Menu Card */}
            <View style={styles.menuGroupCard}>
              <TouchableOpacity
                style={styles.menuRow}
                onPress={() => onOpenSubScreen('lastService')}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Open Last service record"
              >
                <Text style={styles.menuRowTitle}>Last service record</Text>
                <Text style={styles.menuRowVal}>
                  {settings.lastServiceDate ? formatIsoDateShort(settings.lastServiceDate) : 'Not set'}
                </Text>
                <Text style={styles.menuRowChevron}>›</Text>
              </TouchableOpacity>

              <View style={styles.menuDivider} />

              <TouchableOpacity
                style={styles.menuRow}
                onPress={() => onOpenSubScreen('alerts')}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Open Alerts & tyre care"
              >
                <Text style={styles.menuRowTitle}>Alerts &amp; tyre care</Text>
                <Text style={styles.menuRowVal}>{enabledWheelCount} on</Text>
                <Text style={styles.menuRowChevron}>›</Text>
              </TouchableOpacity>

              <View style={styles.menuDivider} />

              <TouchableOpacity
                style={styles.menuRow}
                onPress={() => onOpenSubScreen('schedule')}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Open Replacement schedule"
              >
                <Text style={styles.menuRowTitle}>Replacement schedule</Text>
                <Text style={styles.menuRowVal}>{formatKmNumber(serviceStatus.nextMilestone.km)} km</Text>
                <Text style={styles.menuRowChevron}>›</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Animated.View>

      {/* Nested Pushed Sub-screens */}
      {activeSubScreen !== null && (
        <Animated.View
          style={[
            styles.subLayer,
            {
              transform: [{ translateX: subScreenTranslateX }],
            },
          ]}
        >
          <SafeAreaView style={styles.safeArea}>
            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Sub-screen 1: Last service */}
              {activeSubScreen === 'lastService' && (
                <>
                  <View style={styles.header}>
                    <BackButton onPress={onCloseSubScreen} label="Back to Service reminder" />
                    <Text style={styles.headerTitle}>Last service</Text>
                  </View>

                  <Text style={styles.pageIntro}>
                    MG iSmart doesn’t share your service history. Enter your last service to get the exact days and km left.
                  </Text>

                  {/* Date Field */}
                  <View style={styles.formSection}>
                    <View style={styles.fieldHeaderRow}>
                      <Text style={styles.fieldLabel}>Date</Text>
                      <View style={styles.chipActionsRow}>
                        <TouchableOpacity
                          style={styles.outlineGreenPill}
                          onPress={() => {
                            setDateDraft(todayIso);
                            setDateError(null);
                          }}
                          activeOpacity={0.75}
                        >
                          <Text style={styles.outlineGreenPillText}>Today</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.outlineDarkPill}
                          onPress={() => {
                            setDateDraft('');
                            setDateError(null);
                          }}
                          activeOpacity={0.75}
                        >
                          <Text style={styles.outlineDarkPillText}>Clear</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    {Platform.OS === 'web' ? (
                      <View style={[styles.inputCard, Boolean(dateError) && styles.inputCardError]}>
                        <Text
                          style={[
                            styles.inputDisplayText,
                            !isValidIsoDateString(dateDraft) && styles.inputPlaceholderText,
                          ]}
                        >
                          {isValidIsoDateString(dateDraft) ? formatIsoDateShort(dateDraft) : 'Select date'}
                        </Text>
                        {React.createElement('input', {
                          type: 'date',
                          value: isValidIsoDateString(dateDraft) ? dateDraft : '',
                          max: todayIso,
                          'aria-label': 'Last service date',
                          onChange: (e: any) => handleLastDateDraftInput(String(e?.target?.value || '')),
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
                    ) : (
                      <View style={[styles.inputCard, Boolean(dateError) && styles.inputCardError]}>
                        <TextInput
                          style={styles.rawTextInput}
                          value={
                            !isDateFocused && isValidIsoDateString(dateDraft)
                              ? formatIsoDateShort(dateDraft)
                              : dateDraft
                          }
                          onFocus={() => setIsDateFocused(true)}
                          onBlur={() => setIsDateFocused(false)}
                          onChangeText={handleLastDateDraftInput}
                          placeholder="YYYY-MM-DD (e.g. 2026-05-25)"
                          placeholderTextColor="#64748B"
                          keyboardType="numbers-and-punctuation"
                          maxLength={10}
                          autoCorrect={false}
                        />
                      </View>
                    )}
                    {Boolean(dateError) && <Text style={styles.errorHint}>{dateError}</Text>}
                  </View>

                  {/* Odometer (optional) Field */}
                  <View style={styles.formSection}>
                    <View style={styles.fieldHeaderRow}>
                      <Text style={styles.fieldLabel}>Odometer (optional)</Text>
                      <View style={styles.chipActionsRow}>
                        {odometerKm !== null && (
                          <TouchableOpacity
                            style={styles.outlineGreenPill}
                            onPress={() => setOdoDraft(String(Math.round(odometerKm)))}
                            activeOpacity={0.75}
                          >
                            <Text style={styles.outlineGreenPillText}>
                              Use {formatKmNumber(odometerKm)} km
                            </Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={styles.outlineDarkPill}
                          onPress={() => setOdoDraft('')}
                          activeOpacity={0.75}
                        >
                          <Text style={styles.outlineDarkPillText}>Clear</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    <View style={styles.inputCard}>
                      <TextInput
                        style={styles.rawTextInput}
                        value={
                          !isOdoFocused && odoDraft
                            ? `${formatKmNumber(Number(odoDraft))} km`
                            : odoDraft
                        }
                        onFocus={() => setIsOdoFocused(true)}
                        onBlur={() => setIsOdoFocused(false)}
                        onChangeText={handleLastOdoDraftInput}
                        placeholder="Auto from live odometer"
                        placeholderTextColor="#64748B"
                        keyboardType="number-pad"
                      />
                    </View>
                  </View>

                  {/* Last Completed Milestone */}
                  <View style={styles.formSection}>
                    <Text style={[styles.fieldLabel, { marginBottom: 10 }]}>Last completed milestone</Text>
                    <View style={styles.milestoneWrapGrid}>
                      <TouchableOpacity
                        style={[
                          styles.choicePill,
                          milestoneDraft === null && styles.choicePillActive,
                        ]}
                        onPress={() => setMilestoneDraft(null)}
                        activeOpacity={0.75}
                      >
                        <Text
                          style={[
                            styles.choicePillText,
                            milestoneDraft === null && styles.choicePillTextActive,
                          ]}
                        >
                          Auto
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.choicePill,
                          milestoneDraft === 0 && styles.choicePillActive,
                        ]}
                        onPress={() => setMilestoneDraft(0)}
                        activeOpacity={0.75}
                      >
                        <Text
                          style={[
                            styles.choicePillText,
                            milestoneDraft === 0 && styles.choicePillTextActive,
                          ]}
                        >
                          Pre-1k
                        </Text>
                      </TouchableOpacity>

                      {visibleLastServiceMilestones.map((m) => {
                        const selected = milestoneDraft === m.km;
                        return (
                          <TouchableOpacity
                            key={m.km}
                            style={[styles.choicePill, selected && styles.choicePillActive]}
                            onPress={() => setMilestoneDraft(m.km)}
                            activeOpacity={0.75}
                          >
                            <Text
                              style={[
                                styles.choicePillText,
                                selected && styles.choicePillTextActive,
                              ]}
                            >
                              {formatKmNumber(m.km)} km
                            </Text>
                          </TouchableOpacity>
                        );
                      })}

                      {hasHiddenMilestones && (
                        <TouchableOpacity
                          style={styles.choicePill}
                          onPress={() => setShowAllLastMilestones(true)}
                          activeOpacity={0.75}
                        >
                          <Text style={[styles.choicePillText, { color: '#94A3B8' }]}>More…</Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    <Text style={styles.helperCopy}>
                      Auto picks the next service after your odometer, or after your last serviced odometer if set. Choose a milestone if you serviced early or want to pin an overdue interval.
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[styles.primaryCtaBtn, { marginTop: 28 }]}
                    onPress={handleSaveLastService}
                    activeOpacity={0.82}
                    accessibilityRole="button"
                    accessibilityLabel="Save last service record"
                  >
                    <Text style={styles.primaryCtaText}>Save</Text>
                  </TouchableOpacity>
                </>
              )}

              {/* Sub-screen 2: Alerts & tyre care */}
              {activeSubScreen === 'alerts' && (
                <>
                  <View style={styles.header}>
                    <BackButton onPress={onCloseSubScreen} label="Back to Service reminder" />
                    <Text style={styles.headerTitle}>Alerts &amp; tyre care</Text>
                  </View>

                  <Text style={styles.sectionSubHeading}>Show on Home when within</Text>
                  <Text style={styles.sectionSubCaption}>
                    Countdown and approx. cost appear on Home inside these limits.
                  </Text>

                  <View style={styles.limitGridRow}>
                    {/* Days Card */}
                    <View style={styles.limitCard}>
                      <Text style={styles.limitCardLabel}>Days</Text>
                      <View style={styles.limitStepperRow}>
                        <TouchableOpacity
                          style={styles.circleStepBtn}
                          onPress={() => {
                            setIsWarnDaysFocused(false);
                            handleStepWarnDays(-5);
                          }}
                          activeOpacity={0.7}
                          accessibilityLabel="Decrease warning days"
                        >
                          <Text style={styles.circleStepBtnText}>−</Text>
                        </TouchableOpacity>
                        <View style={styles.limitValueWrap}>
                          {isWarnDaysFocused ? (
                            <TextInput
                              autoFocus
                              style={styles.limitStepperInput}
                              value={warnDaysDraft}
                              onChangeText={handleWarnDaysText}
                              onBlur={() => {
                                setIsWarnDaysFocused(false);
                                if (!warnDaysDraft) {
                                  setWarnDaysDraft(String(settings.warningDays));
                                }
                              }}
                              keyboardType="number-pad"
                              maxLength={3}
                              accessibilityLabel="Warning days limit"
                            />
                          ) : (
                            <TouchableOpacity
                              style={styles.limitValueTap}
                              onPress={() => {
                                setWarnDaysDraft(String(settings.warningDays));
                                setIsWarnDaysFocused(true);
                              }}
                              activeOpacity={0.7}
                              accessibilityRole="button"
                              accessibilityLabel={`Warning days ${settings.warningDays}. Tap to edit.`}
                            >
                              <Text style={styles.limitValueText} numberOfLines={1} adjustsFontSizeToFit>
                                {settings.warningDays}
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                        <TouchableOpacity
                          style={styles.circleStepBtn}
                          onPress={() => {
                            setIsWarnDaysFocused(false);
                            handleStepWarnDays(5);
                          }}
                          activeOpacity={0.7}
                          accessibilityLabel="Increase warning days"
                        >
                          <Text style={styles.circleStepBtnText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </View>

                    {/* Distance Card */}
                    <View style={styles.limitCard}>
                      <Text style={styles.limitCardLabel}>Distance</Text>
                      <View style={styles.limitStepperRow}>
                        <TouchableOpacity
                          style={styles.circleStepBtn}
                          onPress={() => {
                            setIsWarnKmFocused(false);
                            handleStepWarnKm(-100);
                          }}
                          activeOpacity={0.7}
                          accessibilityLabel="Decrease warning distance"
                        >
                          <Text style={styles.circleStepBtnText}>−</Text>
                        </TouchableOpacity>
                        <View style={styles.limitValueWrap}>
                          {isWarnKmFocused ? (
                            <TextInput
                              autoFocus
                              style={styles.limitStepperInput}
                              value={warnKmDraft}
                              onChangeText={handleWarnKmText}
                              onBlur={() => {
                                setIsWarnKmFocused(false);
                                if (!warnKmDraft) {
                                  setWarnKmDraft(String(settings.warningKm));
                                }
                              }}
                              keyboardType="number-pad"
                              maxLength={5}
                              accessibilityLabel="Warning distance limit in km"
                            />
                          ) : (
                            <TouchableOpacity
                              style={styles.limitValueTap}
                              onPress={() => {
                                setWarnKmDraft(String(settings.warningKm));
                                setIsWarnKmFocused(true);
                              }}
                              activeOpacity={0.7}
                              accessibilityRole="button"
                              accessibilityLabel={`Warning distance ${formatKmNumber(settings.warningKm)} km. Tap to edit.`}
                            >
                              <Text style={styles.limitValueKmText} numberOfLines={1} adjustsFontSizeToFit>
                                {formatKmNumber(settings.warningKm)} km
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                        <TouchableOpacity
                          style={styles.circleStepBtn}
                          onPress={() => {
                            setIsWarnKmFocused(false);
                            handleStepWarnKm(100);
                          }}
                          activeOpacity={0.7}
                          accessibilityLabel="Increase warning distance"
                        >
                          <Text style={styles.circleStepBtnText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={styles.resetBlueBtn}
                    onPress={() => {
                      setWarnDaysDraft(String(DEFAULT_SERVICE_WARNING_DAYS));
                      setWarnKmDraft(String(DEFAULT_SERVICE_WARNING_KM));
                      onChangeSettings({
                        ...settings,
                        warningDays: DEFAULT_SERVICE_WARNING_DAYS,
                        warningKm: DEFAULT_SERVICE_WARNING_KM,
                      });
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.resetBlueText}>Reset to 30 days / 1,000 km</Text>
                  </TouchableOpacity>

                  {/* Tyre Care Accordion */}
                  <Text style={[styles.sectionSubHeading, { marginTop: 18, marginBottom: 10 }]}>
                    Tyre care
                  </Text>

                  <View style={{ gap: 10 }}>
                    {wheelStatuses.map((item) => {
                      const isExpanded = expandedWheelKey === item.key;
                      const statusColor =
                        item.urgency === 'overdue'
                          ? '#FCA5A5'
                          : item.urgency === 'warning'
                            ? '#FCD34D'
                            : item.urgency === 'normal'
                              ? '#34D399'
                              : '#94A3B8';
                      const remainingText = formatWheelCountdownText(item);
                      const statusSub = !item.enabled
                        ? `Disabled · every ${formatKmNumber(item.intervalKm)} km`
                        : isExpanded
                          ? item.nextDueKm !== null
                            ? `${remainingText} · target ${formatKmNumber(item.nextDueKm)} km`
                            : remainingText
                          : `${remainingText} · every ${formatKmNumber(item.intervalKm)} km`;

                      const presets = [5000, 7500, 10000];
                      const hasCustomPreset = !presets.includes(item.intervalKm);

                      return (
                        <View key={item.key} style={styles.tyreCard}>
                          <TouchableOpacity
                            style={styles.tyreCardHeader}
                            onPress={() => setExpandedWheelKey(isExpanded ? null : item.key)}
                            activeOpacity={0.75}
                            accessibilityRole="button"
                            accessibilityLabel={`${item.label} settings`}
                          >
                            <View style={{ flex: 1, paddingRight: 10 }}>
                              <Text style={styles.tyreCardTitle}>{item.label}</Text>
                              <Text style={[styles.tyreCardStatus, { color: statusColor }]}>
                                {statusSub}
                              </Text>
                            </View>

                            <View style={styles.tyreHeaderRight}>
                              <TouchableOpacity
                                style={[
                                  styles.switchTrack,
                                  item.enabled && styles.switchTrackActive,
                                ]}
                                onPress={(e) => {
                                  e?.stopPropagation?.();
                                  updateWheel(item.key, { enabled: !item.enabled });
                                }}
                                activeOpacity={0.8}
                                accessibilityRole="switch"
                                accessibilityLabel={`Enable ${item.label} reminder`}
                                accessibilityState={{ checked: item.enabled }}
                              >
                                <View
                                  style={[
                                    styles.switchThumb,
                                    item.enabled && styles.switchThumbActive,
                                  ]}
                                />
                              </TouchableOpacity>
                              {!isExpanded && <Text style={styles.tyreChevron}>›</Text>}
                            </View>
                          </TouchableOpacity>

                          {isExpanded && (
                            <View style={styles.tyreCardBody}>
                              <Text style={styles.tyreBodyLabel}>Repeat every</Text>
                              <View style={styles.repeatPillsRow}>
                                {(hasCustomPreset ? [...presets, item.intervalKm] : presets).map((preset) => {
                                  const active = item.intervalKm === preset;
                                  return (
                                    <TouchableOpacity
                                      key={preset}
                                      style={[styles.choicePill, active && styles.choicePillActive]}
                                      onPress={() => updateWheel(item.key, { intervalKm: preset })}
                                      activeOpacity={0.75}
                                    >
                                      <Text
                                        style={[
                                          styles.choicePillText,
                                          active && styles.choicePillTextActive,
                                        ]}
                                      >
                                        {formatKmNumber(preset)} km
                                      </Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>

                              <Text style={[styles.tyreBodyLabel, { marginTop: 14 }]}>Last done at</Text>
                              <View style={styles.lastDoneRow}>
                                <View style={styles.lastDoneInputWrap}>
                                  <TextInput
                                    style={styles.lastDoneInput}
                                    value={
                                      focusedWheelLastKey !== item.key && wheelLastKmDrafts[item.key]
                                        ? `${formatKmNumber(Number(wheelLastKmDrafts[item.key]))} km`
                                        : wheelLastKmDrafts[item.key]
                                    }
                                    onFocus={() => setFocusedWheelLastKey(item.key)}
                                    onBlur={() => setFocusedWheelLastKey(null)}
                                    onChangeText={(txt) => {
                                      const digits = txt.replace(/\D/g, '').slice(0, 7);
                                      setWheelLastKmDrafts((p) => ({ ...p, [item.key]: digits }));
                                      if (!digits) {
                                        updateWheel(item.key, { lastDoneKm: null, lastDoneDate: null });
                                        return;
                                      }
                                      const n = Number(digits);
                                      if (Number.isFinite(n) && n >= 0) {
                                        updateWheel(item.key, { lastDoneKm: Math.min(1000000, n) });
                                      }
                                    }}
                                    keyboardType="number-pad"
                                    placeholder="Set km"
                                    placeholderTextColor="#64748B"
                                  />
                                </View>

                                <TouchableOpacity
                                  style={styles.doneNowBlueBtn}
                                  onPress={() => handleMarkWheelDoneNow(item.key)}
                                  activeOpacity={0.75}
                                >
                                  <Text style={styles.doneNowBlueText}>
                                    Done now{odometerKm !== null ? ` (${formatKmNumber(odometerKm)})` : ''}
                                  </Text>
                                </TouchableOpacity>
                              </View>

                              <View style={styles.alertBeforeRow}>
                                <Text style={styles.alertBeforeLabel}>Alert before it’s due</Text>
                                <TextInput
                                  style={styles.alertBeforeValueInput}
                                  value={
                                    focusedWheelWarnKey !== item.key && wheelWarnKmDrafts[item.key] !== ''
                                      ? `${formatKmNumber(Number(wheelWarnKmDrafts[item.key]))} km`
                                      : wheelWarnKmDrafts[item.key]
                                  }
                                  onFocus={() => setFocusedWheelWarnKey(item.key)}
                                  onBlur={() => {
                                    setFocusedWheelWarnKey(null);
                                    if (!wheelWarnKmDrafts[item.key]) {
                                      setWheelWarnKmDrafts((p) => ({
                                        ...p,
                                        [item.key]: String(DEFAULT_WHEEL_SERVICE_WARNING_KM),
                                      }));
                                      updateWheel(item.key, { warningKm: DEFAULT_WHEEL_SERVICE_WARNING_KM });
                                    }
                                  }}
                                  onChangeText={(txt) => {
                                    const digits = txt.replace(/\D/g, '').slice(0, 4);
                                    setWheelWarnKmDrafts((p) => ({ ...p, [item.key]: digits }));
                                    const n = Number(digits);
                                    if (digits !== '' && Number.isFinite(n)) {
                                      updateWheel(item.key, { warningKm: Math.min(5000, Math.max(0, n)) });
                                    }
                                  }}
                                  keyboardType="number-pad"
                                  maxLength={7}
                                  accessibilityLabel={`${item.label} alert threshold in km`}
                                />
                              </View>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </>
              )}

              {/* Sub-screen 3: Replacement schedule */}
              {activeSubScreen === 'schedule' && (
                <>
                  <View style={styles.header}>
                    <BackButton onPress={onCloseSubScreen} label="Back to Service reminder" />
                    <Text style={styles.headerTitle}>Replacement schedule</Text>
                  </View>

                  <Text style={styles.pageIntro}>
                    What gets replaced at each service, and roughly what it costs. Tap any interval to see parts and labour.
                  </Text>

                  {/* Live Sync Status Strip */}
                  <View style={styles.syncCard}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <Text
                        style={[
                          styles.syncCardTitle,
                          catalog.source === 'live' && { color: '#34D399' },
                          Boolean(catalogSyncError) && { color: '#FCD34D' },
                        ]}
                      >
                        {isSyncingCatalog
                          ? 'Updating live costs...'
                          : catalog.source === 'live'
                            ? 'Live costs synced'
                            : catalog.source === 'cached'
                              ? 'Cached live costs'
                              : 'Offline baseline costs'}
                      </Text>
                      <Text style={styles.syncCardSub}>
                        {catalogSyncError || formatSyncTimestamp(catalog.fetchedAt)}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.refreshOutlineBtn}
                      onPress={onRefreshCatalog}
                      disabled={isSyncingCatalog}
                      activeOpacity={0.75}
                    >
                      {isSyncingCatalog ? (
                        <ActivityIndicator size="small" color="#34D399" />
                      ) : (
                        <Text style={styles.refreshOutlineText}>Refresh</Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Vertical Expandable Schedule List (no horizontal scrolling) */}
                  <View style={styles.scheduleListWrap}>
                    {milestones.slice(0, 12).map((m) => {
                      const cost = computeMilestoneCost(m, catalog);
                      const isExpanded = inspectKm === m.km;
                      const isNext = m.km === serviceStatus.nextMilestone.km;
                      const isDone =
                        !isNext &&
                        (settings.lastServiceMilestoneKm !== null
                          ? settings.lastServiceMilestoneKm > 0 &&
                            m.km <= settings.lastServiceMilestoneKm
                          : odometerKm !== null && m.km < serviceStatus.nextMilestone.km);

                      const summaryItems =
                        m.replacements.length > 0
                          ? cost.serviceChargeInr > 0
                            ? `${m.replacements.join(' · ')} + Paid service`
                            : m.replacements.join(' · ')
                          : 'Inspection & checks only';

                      return (
                        <View
                          key={m.km}
                          style={[
                            styles.scheduleCard,
                            isNext && styles.scheduleCardNext,
                            isExpanded && styles.scheduleCardExpanded,
                          ]}
                        >
                          <TouchableOpacity
                            style={styles.scheduleCardHeader}
                            onPress={() => setInspectKm(isExpanded ? -1 : m.km)}
                            activeOpacity={0.75}
                            accessibilityRole="button"
                            accessibilityLabel={`${formatKmNumber(m.km)} km service schedule, ${formatInrAmount(
                              cost.totalInr
                            )}. Tap to ${isExpanded ? 'collapse' : 'expand'}.`}
                          >
                            <View style={{ flex: 1, minWidth: 0, paddingRight: 10 }}>
                              <View style={styles.scheduleTitleRow}>
                                <Text style={styles.scheduleCardTitle}>
                                  {formatKmNumber(m.km)} km · {m.timeLabel.toLowerCase()}
                                </Text>
                                {isNext && (
                                  <View style={styles.scheduleNextBadge}>
                                    <Text style={styles.scheduleNextBadgeText}>Next</Text>
                                  </View>
                                )}
                                {isDone && (
                                  <View style={styles.scheduleDoneBadge}>
                                    <Text style={styles.scheduleDoneBadgeText}>Done</Text>
                                  </View>
                                )}
                              </View>
                              {!isExpanded && (
                                <Text style={styles.scheduleCardSummary} numberOfLines={1}>
                                  {summaryItems}
                                </Text>
                              )}
                            </View>

                            <View style={styles.scheduleHeaderRight}>
                              <Text
                                style={[
                                  styles.scheduleCardCost,
                                  (isNext || isExpanded) && { color: '#34D399' },
                                  cost.totalInr === 0 && !isNext && !isExpanded && { color: '#94A3B8' },
                                ]}
                              >
                                {formatInrAmount(cost.totalInr)}
                              </Text>
                              <View
                                style={{
                                  transform: [{ rotate: isExpanded ? '180deg' : '0deg' }],
                                }}
                              >
                                <Svg
                                  width={16}
                                  height={16}
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="#94A3B8"
                                  strokeWidth={2.2}
                                >
                                  <Path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                                </Svg>
                              </View>
                            </View>
                          </TouchableOpacity>

                          {isExpanded && (
                            <View style={styles.scheduleCardBody}>
                              <View style={styles.scheduleBreakdownDivider} />
                              {cost.lineItems.length === 0 ? (
                                <Text style={styles.mutedLineText}>
                                  No scheduled replacements — inspection / check items only.
                                </Text>
                              ) : (
                                cost.lineItems.map((li, idx) => (
                                  <View
                                    key={li.name}
                                    style={[
                                      styles.costLineRow,
                                      idx === cost.lineItems.length - 1 && {
                                        borderBottomWidth: 0,
                                        paddingBottom: 2,
                                      },
                                    ]}
                                  >
                                    <Text style={styles.costLineLabel}>{li.name}</Text>
                                    <Text style={styles.costLineVal}>
                                      {formatInrAmount(li.amountInr)}
                                    </Text>
                                  </View>
                                ))
                              )}
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>

                  <Text style={styles.disclaimerText}>{scheduleDisclaimerText}</Text>

                  <TouchableOpacity
                    style={styles.openRefLink}
                    onPress={() => Linking.openURL(SERVICE_SCHEDULE_SOURCE_URL).catch(() => {})}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.openRefLinkText}>Open price reference  ↗</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      )}
    </>
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
  subLayer: {
    position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0A0E17',
    zIndex: 2005,
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
    paddingBottom: Platform.OS === 'web' ? 140 : 145,
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
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  pageIntro: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 22,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 18,
    marginBottom: 16,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  heroEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.0,
  },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  heroTitle: {
    color: '#F8FAFC',
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  heroSub: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
  },
  progressTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: '#1E293B',
    overflow: 'hidden',
    marginTop: 16,
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabelText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
  },
  heroDivider: {
    height: 1,
    backgroundColor: '#1E293B',
    marginVertical: 15,
  },
  heroMetricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  heroMetricCol: {
    flex: 1,
  },
  heroMetricLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
  },
  heroMetricVal: {
    color: '#F8FAFC',
    fontSize: 19,
    fontWeight: '800',
    marginTop: 4,
    letterSpacing: -0.3,
  },
  heroMetricSub: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 3,
  },
  cardTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  mutedLineText: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 19,
    paddingVertical: 6,
  },
  costLineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    gap: 12,
  },
  costLineLabel: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  costLineVal: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  costTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 14,
  },
  costTotalLabel: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  costTotalVal: {
    color: '#34D399',
    fontSize: 19,
    fontWeight: '800',
  },
  primaryCtaBtn: {
    backgroundColor: '#34D399',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  primaryCtaText: {
    color: '#052E16',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  menuGroupCard: {
    backgroundColor: '#111827',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    overflow: 'hidden',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 17,
  },
  menuRowTitle: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '600',
  },
  menuRowVal: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '500',
    marginRight: 10,
  },
  menuRowChevron: {
    color: '#64748B',
    fontSize: 19,
    fontWeight: '400',
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#1E293B',
    marginHorizontal: 18,
  },
  formSection: {
    marginBottom: 22,
  },
  fieldHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  fieldLabel: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  chipActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  outlineGreenPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.5)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  outlineGreenPillText: {
    color: '#34D399',
    fontSize: 12,
    fontWeight: '700',
  },
  outlineDarkPill: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  outlineDarkPillText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
  },
  inputCard: {
    position: 'relative',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 15,
    minHeight: 54,
    justifyContent: 'center',
  },
  inputCardError: {
    borderColor: '#F87171',
  },
  inputDisplayText: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  inputPlaceholderText: {
    color: '#64748B',
    fontWeight: '500',
  },
  rawTextInput: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    width: '100%',
    minWidth: 0,
    padding: 0,
    margin: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  errorHint: {
    color: '#FCA5A5',
    fontSize: 12,
    marginTop: 6,
  },
  milestoneWrapGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  choicePill: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  choicePillActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderColor: '#34D399',
  },
  choicePillText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  choicePillTextActive: {
    color: '#34D399',
  },
  helperCopy: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 12,
  },
  sectionSubHeading: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  sectionSubCaption: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 14,
  },
  limitGridRow: {
    flexDirection: 'row',
    gap: 12,
  },
  limitCard: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingVertical: 14,
  },
  limitCardLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 10,
  },
  limitStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
    minHeight: 34,
  },
  circleStepBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    flexShrink: 0,
    backgroundColor: '#152033',
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleStepBtnText: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 18,
  },
  limitValueWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  limitValueTap: {
    width: '100%',
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  limitValueText: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  limitValueKmText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  limitStepperInput: {
    width: '100%',
    minWidth: 0,
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
    padding: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  resetBlueBtn: {
    alignSelf: 'flex-start',
    marginTop: 14,
    marginBottom: 8,
  },
  resetBlueText: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '700',
  },
  tyreCard: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 18,
    overflow: 'hidden',
  },
  tyreCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  tyreCardTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  tyreCardStatus: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 3,
  },
  tyreHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  switchTrack: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1E293B',
    padding: 3,
    justifyContent: 'center',
  },
  switchTrackActive: {
    backgroundColor: '#34D399',
  },
  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#94A3B8',
  },
  switchThumbActive: {
    backgroundColor: '#0A0E17',
    alignSelf: 'flex-end',
  },
  tyreChevron: {
    color: '#94A3B8',
    fontSize: 19,
    fontWeight: '500',
  },
  tyreCardBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  tyreBodyLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 8,
  },
  repeatPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  lastDoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  lastDoneInputWrap: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#0A0E17',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    justifyContent: 'center',
  },
  lastDoneInput: {
    width: '100%',
    minWidth: 0,
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
    padding: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  doneNowBlueBtn: {
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.5)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneNowBlueText: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '700',
  },
  alertBeforeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  alertBeforeLabel: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '500',
  },
  alertBeforeValueInput: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'right',
    minWidth: 74,
    paddingVertical: 2,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  scheduleListWrap: {
    gap: 10,
    marginBottom: 18,
  },
  scheduleCard: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 18,
    overflow: 'hidden',
  },
  scheduleCardNext: {
    borderColor: 'rgba(52, 211, 153, 0.35)',
  },
  scheduleCardExpanded: {
    borderColor: 'rgba(52, 211, 153, 0.6)',
  },
  scheduleCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  scheduleTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  scheduleCardTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  scheduleNextBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  scheduleNextBadgeText: {
    color: '#34D399',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  scheduleDoneBadge: {
    backgroundColor: '#1E293B',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  scheduleDoneBadgeText: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
  },
  scheduleCardSummary: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 4,
  },
  scheduleHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  scheduleCardCost: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
  },
  scheduleCardBody: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  scheduleBreakdownDivider: {
    height: 1,
    backgroundColor: '#1E293B',
    marginBottom: 4,
  },
  syncCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 15,
    marginBottom: 16,
  },
  syncCardTitle: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '700',
  },
  syncCardSub: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 3,
  },
  refreshOutlineBtn: {
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.55)',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshOutlineText: {
    color: '#34D399',
    fontSize: 13,
    fontWeight: '700',
  },
  disclaimerText: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 20,
  },
  openRefLink: {
    alignSelf: 'flex-start',
    marginTop: 14,
  },
  openRefLinkText: {
    color: '#38BDF8',
    fontSize: 14,
    fontWeight: '700',
  },
});
