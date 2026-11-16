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
  DEFAULT_SERVICE_WARNING_DAYS,
  DEFAULT_SERVICE_WARNING_KM,
  DEFAULT_WHEEL_SERVICE_WARNING_KM,
  formatInrAmount,
  formatIsoDateShort,
  formatKmNumber,
  getServiceMilestonesUpTo,
  getTodayLocalIsoDate,
  isValidIsoDateString,
  SERVICE_SCHEDULE_SOURCE_URL,
  ServiceMilestoneDefinition,
  ServiceReminderSettings,
  ServiceScheduleCatalog,
  WHEEL_SERVICE_META,
  WheelServiceKey,
} from './sdk';

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
  onShowBanner?: (type: 'ok' | 'err', msg: string) => void;
}

function formatAutoDateInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
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
  onShowBanner,
}) => {
  const todayIso = getTodayLocalIsoDate();
  const [dateDraft, setDateDraft] = useState<string>(settings.lastServiceDate || '');
  const [odoDraft, setOdoDraft] = useState<string>(
    settings.lastServiceOdoKm !== null && settings.lastServiceOdoKm !== undefined
      ? String(settings.lastServiceOdoKm)
      : ''
  );
  const [warnDaysDraft, setWarnDaysDraft] = useState<string>(String(settings.warningDays));
  const [warnKmDraft, setWarnKmDraft] = useState<string>(String(settings.warningKm));
  const [wheelIntervalDrafts, setWheelIntervalDrafts] = useState<Record<WheelServiceKey, string>>({
    balancing: String(settings.wheelServices.balancing.intervalKm),
    alignment: String(settings.wheelServices.alignment.intervalKm),
    rotation: String(settings.wheelServices.rotation.intervalKm),
  });
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
  const [wheelWarnKmDrafts, setWheelWarnKmDrafts] = useState<Record<WheelServiceKey, string>>({
    balancing: String(settings.wheelServices.balancing.warningKm),
    alignment: String(settings.wheelServices.alignment.warningKm),
    rotation: String(settings.wheelServices.rotation.warningKm),
  });
  const [inspectKm, setInspectKm] = useState<number>(serviceStatus.nextMilestone.km);
  const [showScheduleList, setShowScheduleList] = useState<boolean>(false);

  useEffect(() => {
    setDateDraft(settings.lastServiceDate || '');
  }, [settings.lastServiceDate]);

  useEffect(() => {
    setOdoDraft(
      settings.lastServiceOdoKm !== null && settings.lastServiceOdoKm !== undefined
        ? String(settings.lastServiceOdoKm)
        : ''
    );
  }, [settings.lastServiceOdoKm]);

  useEffect(() => {
    setWarnDaysDraft(String(settings.warningDays));
  }, [settings.warningDays]);

  useEffect(() => {
    setWarnKmDraft(String(settings.warningKm));
  }, [settings.warningKm]);

  useEffect(() => {
    setWheelIntervalDrafts({
      balancing: String(settings.wheelServices.balancing.intervalKm),
      alignment: String(settings.wheelServices.alignment.intervalKm),
      rotation: String(settings.wheelServices.rotation.intervalKm),
    });
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

  const inspectedMilestone: ServiceMilestoneDefinition =
    milestones.find((m) => m.km === inspectKm) || serviceStatus.nextMilestone;
  const inspectedCost = computeMilestoneCost(inspectedMilestone, catalog);

  const formatCatalogSyncLabel = () => {
    if (catalog.fetchedAt) {
      const dt = new Date(catalog.fetchedAt);
      const timeStr = Number.isNaN(dt.getTime())
        ? catalog.fetchedAt
        : dt.toLocaleString(undefined, {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          });
      if (catalog.source === 'live') return `Live costs synced · ${timeStr}`;
      return `Cached live costs · ${timeStr}`;
    }
    return 'Bundled baseline estimate (offline fallback)';
  };

  const urgencyBadge =
    serviceStatus.urgency === 'overdue'
      ? {
          label: 'OVERDUE',
          bg: 'rgba(239, 68, 68, 0.18)',
          border: 'rgba(248, 113, 113, 0.45)',
          color: '#FCA5A5',
        }
      : serviceStatus.urgency === 'warning'
        ? {
            label: 'DUE SOON',
            bg: 'rgba(245, 158, 11, 0.18)',
            border: 'rgba(251, 191, 36, 0.45)',
            color: '#FCD34D',
          }
        : {
            label: 'ON TRACK',
            bg: 'rgba(16, 185, 129, 0.16)',
            border: 'rgba(52, 211, 153, 0.35)',
            color: '#34D399',
          };

  const handleLastDateText = (val: string) => {
    const cleaned = val.trim();
    const formatted =
      cleaned.length > dateDraft.length && !cleaned.includes('-')
        ? formatAutoDateInput(cleaned)
        : cleaned.slice(0, 10);
    setDateDraft(formatted);
    if (!formatted) {
      onChangeSettings({ ...settings, lastServiceDate: null });
    } else if (isValidIsoDateString(formatted)) {
      onChangeSettings({ ...settings, lastServiceDate: formatted });
    }
  };

  const handleLastOdoText = (val: string) => {
    const digits = val.replace(/\D/g, '');
    setOdoDraft(digits);
    if (!digits) {
      onChangeSettings({ ...settings, lastServiceOdoKm: null });
      return;
    }
    const parsed = Number(digits);
    if (Number.isFinite(parsed) && parsed >= 0) {
      onChangeSettings({ ...settings, lastServiceOdoKm: Math.min(1000000, parsed) });
    }
  };

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
      `Logged ${formatKmNumber(serviceStatus.nextMilestone.km)} km service on ${formatIsoDateShort(
        todayIso
      )}`
    );
  };

  const updateWheel = (key: WheelServiceKey, patch: Partial<ServiceReminderSettings['wheelServices'][WheelServiceKey]>) => {
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
      onShowBanner?.('err', 'Sync live odometer first or type the last-done km below.');
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

  const isDateDraftInvalid = Boolean(dateDraft && !isValidIsoDateString(dateDraft));

  const formatDaysBadgeText = () => {
    if (serviceStatus.daysRemaining === null) return 'Add date';
    if (serviceStatus.daysRemaining < 0) {
      return `${Math.abs(serviceStatus.daysRemaining)}d overdue`;
    }
    if (serviceStatus.daysRemaining === 0) return 'Today';
    return `${serviceStatus.daysRemaining} days`;
  };

  const formatKmBadgeText = () => {
    if (serviceStatus.kmRemaining === null) return '-- km';
    if (serviceStatus.kmRemaining < 0) {
      return `${formatKmNumber(Math.abs(serviceStatus.kmRemaining))} km overdue`;
    }
    if (serviceStatus.kmRemaining === 0) return 'Due now';
    return `${formatKmNumber(serviceStatus.kmRemaining)} km`;
  };

  return (
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
          showsVerticalScrollIndicator={true}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.backBtn}
              onPress={onClose}
              activeOpacity={0.7}
              accessibilityLabel="Back to Profile"
              accessibilityRole="button"
            >
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#F8FAFC" strokeWidth={2.4}>
                <Path d="M15 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Service Reminder</Text>
              <Text style={styles.headerSub}>
                Live odo: {odometerKm !== null ? `${formatKmNumber(odometerKm)} km` : 'Sync vehicle'} · MG server does not provide last service date
              </Text>
            </View>
          </View>

          {/* 1. Next Service Overview Card */}
          <View style={styles.card}>
            <View style={styles.cardTopRow}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={styles.eyebrow}>NEXT SCHEDULED SERVICE</Text>
                <Text style={styles.milestoneHeading}>
                  {formatKmNumber(serviceStatus.nextMilestone.km)} km · {serviceStatus.nextMilestone.timeLabel}
                </Text>
                {serviceStatus.previousMilestone && (
                  <Text style={styles.mutedText}>
                    Previous interval: {formatKmNumber(serviceStatus.previousMilestone.km)} km (
                    {serviceStatus.previousMilestone.timeLabel})
                  </Text>
                )}
              </View>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: urgencyBadge.bg, borderColor: urgencyBadge.border },
                ]}
              >
                <Text style={[styles.statusBadgeText, { color: urgencyBadge.color }]}>
                  {urgencyBadge.label}
                </Text>
              </View>
            </View>

            <View style={styles.metricsRow}>
              <View style={styles.metricTile}>
                <Text style={styles.metricLabel}>Kms left</Text>
                <Text
                  style={[
                    styles.metricValue,
                    serviceStatus.isKmWarning && { color: urgencyBadge.color },
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {formatKmBadgeText()}
                </Text>
                <Text style={styles.metricSub}>
                  Target {formatKmNumber(serviceStatus.nextMilestone.km)} km
                </Text>
              </View>

              <View style={styles.metricTile}>
                <Text style={styles.metricLabel}>Days left</Text>
                <Text
                  style={[
                    styles.metricValue,
                    serviceStatus.isDaysWarning && { color: urgencyBadge.color },
                    serviceStatus.daysRemaining === null && { color: '#94A3B8', fontSize: 15 },
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {formatDaysBadgeText()}
                </Text>
                <Text style={styles.metricSub}>
                  {serviceStatus.nextDueDate
                    ? `Due ${formatIsoDateShort(serviceStatus.nextDueDate)}`
                    : `Every ${serviceStatus.intervalMonths} mo`}
                </Text>
              </View>

              <View style={styles.metricTile}>
                <Text style={styles.metricLabel}>Approx. cost</Text>
                <Text style={[styles.metricValue, { color: '#34D399' }]} numberOfLines={1}>
                  {formatInrAmount(serviceStatus.cost.totalInr)}
                </Text>
                <Text style={styles.metricSub}>
                  {serviceStatus.cost.lineItems.length > 0
                    ? `${serviceStatus.nextMilestone.replacements.length} replacement${
                        serviceStatus.nextMilestone.replacements.length === 1 ? '' : 's'
                      }`
                    : 'Inspection only'}
                </Text>
              </View>
            </View>

            {/* Cost Line Breakdown */}
            <View style={styles.costBox}>
              <Text style={styles.costBoxTitle}>Estimated Replacement &amp; Service Breakdown</Text>
              {serviceStatus.cost.lineItems.length === 0 ? (
                <Text style={styles.mutedText}>
                  No mandatory scheduled replacements at {formatKmNumber(serviceStatus.nextMilestone.km)} km (inspection / check items only).
                </Text>
              ) : (
                serviceStatus.cost.lineItems.map((item) => (
                  <View key={item.name} style={styles.costLineRow}>
                    <Text style={styles.costLineName}>
                      {item.name}
                      {item.kind === 'labour' ? ' (from 30k km)' : ''}
                    </Text>
                    <Text style={styles.costLineVal}>{formatInrAmount(item.amountInr)}</Text>
                  </View>
                ))
              )}
              <View style={styles.costTotalRow}>
                <Text style={styles.costTotalLabel}>Approx. estimated total</Text>
                <Text style={styles.costTotalVal}>{formatInrAmount(serviceStatus.cost.totalInr)}</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.logServiceBtn}
              onPress={handleMarkNextServiceDoneToday}
              activeOpacity={0.75}
            >
              <Text style={styles.logServiceBtnText}>
                Mark {formatKmNumber(serviceStatus.nextMilestone.km)} km Service Done Today
              </Text>
            </TouchableOpacity>
          </View>

          {/* 2. Last Serviced Input Card */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Last Service Record</Text>
            <Text style={styles.mutedText}>
              Because MG iSmart does not expose service history, enter your last serviced date (and optional odometer) to calculate exact remaining days and kms.
            </Text>

            <View style={styles.fieldGroup}>
              <View style={styles.fieldHeaderRow}>
                <Text style={styles.fieldLabel}>Last serviced date</Text>
                <View style={styles.chipActionsRow}>
                  <TouchableOpacity
                    style={styles.miniActionBtn}
                    onPress={() => {
                      setDateDraft(todayIso);
                      onChangeSettings({ ...settings, lastServiceDate: todayIso });
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.miniActionText}>Today</Text>
                  </TouchableOpacity>
                  {Boolean(settings.lastServiceDate || dateDraft) && (
                    <TouchableOpacity
                      style={[styles.miniActionBtn, styles.miniClearBtn]}
                      onPress={() => {
                        setDateDraft('');
                        onChangeSettings({ ...settings, lastServiceDate: null });
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.miniClearText}>Clear</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {Platform.OS === 'web' ? (
                <View style={styles.webDateWrap}>
                  {React.createElement('input', {
                    type: 'date',
                    value: isValidIsoDateString(dateDraft) ? dateDraft : '',
                    max: todayIso,
                    onChange: (e: any) => handleLastDateText(String(e?.target?.value || '')),
                    style: {
                      width: '100%',
                      backgroundColor: 'transparent',
                      color: '#F8FAFC',
                      border: 'none',
                      outline: 'none',
                      fontSize: 15,
                      fontWeight: 600,
                      fontFamily: 'inherit',
                      colorScheme: 'dark',
                    },
                  })}
                </View>
              ) : (
                <TextInput
                  style={[styles.textInput, isDateDraftInvalid && styles.textInputError]}
                  value={dateDraft}
                  onChangeText={handleLastDateText}
                  placeholder="YYYY-MM-DD (e.g. 2026-05-25)"
                  placeholderTextColor="#64748B"
                  keyboardType="numbers-and-punctuation"
                  maxLength={10}
                  autoCorrect={false}
                />
              )}
              {isDateDraftInvalid && (
                <Text style={styles.errorHint}>Enter a valid calendar date as YYYY-MM-DD.</Text>
              )}
            </View>

            <View style={styles.fieldGroup}>
              <View style={styles.fieldHeaderRow}>
                <Text style={styles.fieldLabel}>Last serviced odometer (optional)</Text>
                <View style={styles.chipActionsRow}>
                  {odometerKm !== null && (
                    <TouchableOpacity
                      style={styles.miniActionBtn}
                      onPress={() => {
                        const rounded = Math.round(odometerKm);
                        setOdoDraft(String(rounded));
                        onChangeSettings({ ...settings, lastServiceOdoKm: rounded });
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.miniActionText}>Use {formatKmNumber(odometerKm)} km</Text>
                    </TouchableOpacity>
                  )}
                  {Boolean(odoDraft) && (
                    <TouchableOpacity
                      style={[styles.miniActionBtn, styles.miniClearBtn]}
                      onPress={() => {
                        setOdoDraft('');
                        onChangeSettings({ ...settings, lastServiceOdoKm: null });
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.miniClearText}>Clear</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
              <TextInput
                style={styles.textInput}
                value={odoDraft}
                onChangeText={handleLastOdoText}
                placeholder="Auto from live odometer"
                placeholderTextColor="#64748B"
                keyboardType="number-pad"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Last completed service milestone</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.milestonePillsRow}
              >
                <TouchableOpacity
                  style={[
                    styles.milestonePill,
                    settings.lastServiceMilestoneKm === null && styles.milestonePillActive,
                  ]}
                  onPress={() => onChangeSettings({ ...settings, lastServiceMilestoneKm: null })}
                >
                  <Text
                    style={[
                      styles.milestonePillText,
                      settings.lastServiceMilestoneKm === null && styles.milestonePillTextActive,
                    ]}
                  >
                    Auto
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.milestonePill,
                    settings.lastServiceMilestoneKm === 0 && styles.milestonePillActive,
                  ]}
                  onPress={() => onChangeSettings({ ...settings, lastServiceMilestoneKm: 0 })}
                >
                  <Text
                    style={[
                      styles.milestonePillText,
                      settings.lastServiceMilestoneKm === 0 && styles.milestonePillTextActive,
                    ]}
                  >
                    Pre-1k
                  </Text>
                </TouchableOpacity>
                {milestones.map((m) => {
                  const selected = settings.lastServiceMilestoneKm === m.km;
                  return (
                    <TouchableOpacity
                      key={m.km}
                      style={[styles.milestonePill, selected && styles.milestonePillActive]}
                      onPress={() => onChangeSettings({ ...settings, lastServiceMilestoneKm: m.km })}
                    >
                      <Text style={[styles.milestonePillText, selected && styles.milestonePillTextActive]}>
                        {formatKmNumber(m.km)} km
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <Text style={styles.helperHint}>
                Auto picks the next service after your live odometer (or after your last serviced odometer if set). Select the exact milestone if you serviced early or want to pin an overdue interval.
              </Text>
            </View>
          </View>

          {/* 3. Editable Home Screen Warning Limits */}
          <View style={styles.card}>
            <View style={styles.fieldHeaderRow}>
              <Text style={styles.sectionTitle}>Home Warning Limits</Text>
              <TouchableOpacity
                onPress={() => {
                  setWarnDaysDraft(String(DEFAULT_SERVICE_WARNING_DAYS));
                  setWarnKmDraft(String(DEFAULT_SERVICE_WARNING_KM));
                  onChangeSettings({
                    ...settings,
                    warningDays: DEFAULT_SERVICE_WARNING_DAYS,
                    warningKm: DEFAULT_SERVICE_WARNING_KM,
                  });
                }}
              >
                <Text style={styles.resetLink}>Reset (30d / 1,000 km)</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.mutedText}>
              Show countdown &amp; approximate cost on the Home screen within these remaining limits:
            </Text>

            <View style={styles.limitRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Last N days</Text>
                <View style={styles.stepperBox}>
                  <TouchableOpacity style={styles.stepBtn} onPress={() => handleStepWarnDays(-5)}>
                    <Text style={styles.stepBtnText}>-</Text>
                  </TouchableOpacity>
                  <TextInput
                    style={styles.stepInput}
                    value={warnDaysDraft}
                    onChangeText={handleWarnDaysText}
                    keyboardType="number-pad"
                    maxLength={3}
                  />
                  <TouchableOpacity style={styles.stepBtn} onPress={() => handleStepWarnDays(5)}>
                    <Text style={styles.stepBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Last N km</Text>
                <View style={styles.stepperBox}>
                  <TouchableOpacity style={styles.stepBtn} onPress={() => handleStepWarnKm(-100)}>
                    <Text style={styles.stepBtnText}>-</Text>
                  </TouchableOpacity>
                  <TextInput
                    style={styles.stepInput}
                    value={warnKmDraft}
                    onChangeText={handleWarnKmText}
                    keyboardType="number-pad"
                    maxLength={5}
                  />
                  <TouchableOpacity style={styles.stepBtn} onPress={() => handleStepWarnKm(100)}>
                    <Text style={styles.stepBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>

          {/* 4. Wheel Balancing, Alignment & Tire Rotation */}
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Wheel Balancing, Alignment &amp; Rotation</Text>
            <Text style={styles.mutedText}>
              Set your preferred km interval and last-done odometer for each tyre maintenance item. Home alerts trigger automatically when approaching or due.
            </Text>

            {wheelStatuses.map((item) => {
              const statusColor =
                item.urgency === 'overdue'
                  ? '#FCA5A5'
                  : item.urgency === 'warning'
                    ? '#FCD34D'
                    : item.urgency === 'normal'
                      ? '#34D399'
                      : '#94A3B8';

              const statusText = !item.enabled
                ? 'Disabled'
                : item.lastDoneKm === null
                  ? 'Set last done km'
                  : item.kmRemaining === null
                    ? `Due at ${formatKmNumber(item.nextDueKm ?? 0)} km`
                    : item.kmRemaining <= 0
                      ? item.kmRemaining === 0
                        ? 'Due now'
                        : `${formatKmNumber(Math.abs(item.kmRemaining))} km overdue`
                      : `${formatKmNumber(item.kmRemaining)} km left`;

              return (
                <View key={item.key} style={styles.wheelCard}>
                  <View style={styles.wheelCardHeader}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={styles.wheelCardTitle}>{item.label}</Text>
                      <Text style={[styles.wheelStatusLabel, { color: statusColor }]}>
                        {statusText}
                        {item.nextDueKm !== null ? ` · Target ${formatKmNumber(item.nextDueKm)} km` : ''}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={[
                        styles.toggleTrack,
                        item.enabled && styles.toggleTrackActive,
                      ]}
                      onPress={() => updateWheel(item.key, { enabled: !item.enabled })}
                      accessibilityRole="switch"
                      accessibilityLabel={`Enable ${item.label} reminder`}
                      accessibilityState={{ checked: item.enabled }}
                    >
                      <View
                        style={[
                          styles.toggleThumb,
                          item.enabled && styles.toggleThumbActive,
                        ]}
                      />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.wheelInputsRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.miniLabel}>Preferred interval (km)</Text>
                      <TextInput
                        style={styles.textInput}
                        value={wheelIntervalDrafts[item.key]}
                        onChangeText={(txt) => {
                          const digits = txt.replace(/\D/g, '');
                          setWheelIntervalDrafts((p) => ({ ...p, [item.key]: digits }));
                          const n = Number(digits);
                          if (digits && Number.isFinite(n) && n >= 500) {
                            updateWheel(item.key, { intervalKm: Math.min(100000, n) });
                          }
                        }}
                        keyboardType="number-pad"
                        placeholder="5000"
                        placeholderTextColor="#64748B"
                      />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={styles.miniLabel}>Last done at (km)</Text>
                      <TextInput
                        style={styles.textInput}
                        value={wheelLastKmDrafts[item.key]}
                        onChangeText={(txt) => {
                          const digits = txt.replace(/\D/g, '');
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
                        placeholder="e.g. 30000"
                        placeholderTextColor="#64748B"
                      />
                    </View>
                  </View>

                  <View style={styles.wheelQuickBar}>
                    {[5000, 7500, 10000].map((preset) => {
                      const active = item.intervalKm === preset;
                      return (
                        <TouchableOpacity
                          key={preset}
                          style={[styles.presetChip, active && styles.presetChipActive]}
                          onPress={() => {
                            setWheelIntervalDrafts((p) => ({ ...p, [item.key]: String(preset) }));
                            updateWheel(item.key, { intervalKm: preset });
                          }}
                        >
                          <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>
                            {formatKmNumber(preset)} km
                          </Text>
                        </TouchableOpacity>
                      );
                    })}

                    <TouchableOpacity
                      style={styles.doneNowPill}
                      onPress={() => handleMarkWheelDoneNow(item.key)}
                    >
                      <Text style={styles.doneNowPillText}>
                        Done now{odometerKm !== null ? ` (${formatKmNumber(odometerKm)})` : ''}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.wheelWarnRow}>
                    <Text style={styles.miniLabel}>Home alert buffer before due (km):</Text>
                    <TextInput
                      style={styles.smallInlineInput}
                      value={wheelWarnKmDrafts[item.key]}
                      onChangeText={(txt) => {
                        const digits = txt.replace(/\D/g, '');
                        setWheelWarnKmDrafts((p) => ({ ...p, [item.key]: digits }));
                        const n = Number(digits);
                        if (digits !== '' && Number.isFinite(n)) {
                          updateWheel(item.key, { warningKm: Math.min(5000, Math.max(0, n)) });
                        }
                      }}
                      keyboardType="number-pad"
                      maxLength={4}
                    />
                    {item.warningKm !== DEFAULT_WHEEL_SERVICE_WARNING_KM && (
                      <TouchableOpacity
                        onPress={() => {
                          setWheelWarnKmDrafts((p) => ({
                            ...p,
                            [item.key]: String(DEFAULT_WHEEL_SERVICE_WARNING_KM),
                          }));
                          updateWheel(item.key, { warningKm: DEFAULT_WHEEL_SERVICE_WARNING_KM });
                        }}
                      >
                        <Text style={styles.resetLink}>500 km</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </View>

          {/* 5. Official Replacement Schedule Explorer */}
          <View style={[styles.card, { marginBottom: Platform.OS === 'web' ? 140 : 145 }]}>
            <TouchableOpacity
              style={styles.fieldHeaderRow}
              onPress={() => setShowScheduleList((v) => !v)}
              activeOpacity={0.75}
            >
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.sectionTitle}>Windsor EV Replacement Schedule</Text>
                <Text style={styles.mutedText}>
                  Explore mandatory replacements &amp; costs (1,000 km to 1,50,000 km+)
                </Text>
              </View>
              <Text style={styles.resetLink}>{showScheduleList ? 'Hide ▲' : 'View ▼'}</Text>
            </TouchableOpacity>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.milestonePillsRow}
            >
              {milestones.slice(0, 12).map((m) => {
                const selected = inspectedMilestone.km === m.km;
                return (
                  <TouchableOpacity
                    key={m.km}
                    style={[styles.milestonePill, selected && styles.milestonePillActive]}
                    onPress={() => setInspectKm(m.km)}
                  >
                    <Text style={[styles.milestonePillText, selected && styles.milestonePillTextActive]}>
                      {formatKmNumber(m.km)} km
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.costBox}>
              <View style={styles.costLineRow}>
                <Text style={styles.costTotalLabel}>
                  {formatKmNumber(inspectedMilestone.km)} km — {inspectedMilestone.timeLabel}
                </Text>
                <Text style={styles.costTotalVal}>{formatInrAmount(inspectedCost.totalInr)}</Text>
              </View>
              {inspectedCost.lineItems.length === 0 ? (
                <Text style={styles.mutedText}>
                  No scheduled replacements — inspection / check items only.
                </Text>
              ) : (
                inspectedCost.lineItems.map((li) => (
                  <View key={li.name} style={styles.costLineRow}>
                    <Text style={styles.costLineName}>{li.name}</Text>
                    <Text style={styles.costLineVal}>{formatInrAmount(li.amountInr)}</Text>
                  </View>
                ))
              )}
            </View>

            {showScheduleList && (
              <View style={{ marginTop: 12, gap: 8 }}>
                {milestones.slice(0, 12).map((m) => {
                  const c = computeMilestoneCost(m, catalog);
                  return (
                    <View key={m.km} style={styles.scheduleTableRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.scheduleTableKm}>
                          {formatKmNumber(m.km)} km · {m.timeLabel}
                        </Text>
                        <Text style={styles.scheduleTableItems}>
                          {m.replacements.length > 0 ? m.replacements.join(', ') : 'Inspection only'}
                        </Text>
                      </View>
                      <Text style={styles.scheduleTableCost}>{formatInrAmount(c.totalInr)}</Text>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={styles.catalogSyncBar}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text
                  style={[
                    styles.catalogSyncTitle,
                    catalog.source === 'live' && { color: '#34D399' },
                    catalogSyncError && { color: '#FCD34D' },
                  ]}
                >
                  {isSyncingCatalog ? 'Updating costs from mgwindsor_service...' : formatCatalogSyncLabel()}
                </Text>
                {Boolean(catalogSyncError) && (
                  <Text style={styles.catalogSyncErr}>{catalogSyncError}</Text>
                )}
              </View>
              <TouchableOpacity
                style={styles.refreshCatalogBtn}
                onPress={onRefreshCatalog}
                disabled={isSyncingCatalog}
                activeOpacity={0.75}
              >
                {isSyncingCatalog ? (
                  <ActivityIndicator size="small" color="#34D399" />
                ) : (
                  <Text style={styles.refreshCatalogBtnText}>↻ Refresh costs</Text>
                )}
              </TouchableOpacity>
            </View>

            <Text style={styles.sourceNote}>{catalog.priceNote}</Text>
            <TouchableOpacity
              onPress={() => Linking.openURL(SERVICE_SCHEDULE_SOURCE_URL).catch(() => {})}
              style={{ marginTop: 8 }}
            >
              <Text style={styles.sourceUrl}>Open reference: tonyjoseph456.github.io/mgwindsor_service ›</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0A0E17',
    zIndex: 60,
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
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 40,
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTitle: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSub: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 2,
  },
  card: {
    backgroundColor: '#111827',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 16,
    marginBottom: 16,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  eyebrow: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.9,
    marginBottom: 4,
  },
  milestoneHeading: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  metricTile: {
    flex: 1,
    backgroundColor: '#0B1120',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 10,
  },
  metricLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  metricValue: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '800',
    marginTop: 3,
  },
  metricSub: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 3,
  },
  costBox: {
    backgroundColor: '#0B1120',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 12,
    gap: 8,
  },
  costBoxTitle: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  costLineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  costLineName: {
    color: '#CBD5E1',
    fontSize: 13,
    flex: 1,
  },
  costLineVal: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  costTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  costTotalLabel: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  costTotalVal: {
    color: '#34D399',
    fontSize: 16,
    fontWeight: '800',
  },
  logServiceBtn: {
    marginTop: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.4)',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  logServiceBtnText: {
    color: '#34D399',
    fontSize: 13,
    fontWeight: '700',
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  mutedText: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 17,
  },
  fieldGroup: {
    marginTop: 14,
  },
  fieldHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  fieldLabel: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
  },
  chipActionsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  miniActionBtn: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.35)',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  miniActionText: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '700',
  },
  miniClearBtn: {
    backgroundColor: 'rgba(148, 163, 184, 0.12)',
    borderColor: 'rgba(148, 163, 184, 0.3)',
  },
  miniClearText: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '600',
  },
  webDateWrap: {
    backgroundColor: '#0B1120',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  textInput: {
    backgroundColor: '#0B1120',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
  },
  textInputError: {
    borderColor: '#F87171',
  },
  errorHint: {
    color: '#FCA5A5',
    fontSize: 11,
    marginTop: 5,
  },
  helperHint: {
    color: '#64748B',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 6,
  },
  milestonePillsRow: {
    gap: 8,
    paddingVertical: 6,
  },
  milestonePill: {
    backgroundColor: '#0B1120',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  milestonePillActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    borderColor: '#10B981',
  },
  milestonePillText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  milestonePillTextActive: {
    color: '#34D399',
    fontWeight: '700',
  },
  resetLink: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '600',
  },
  limitRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  stepperBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0B1120',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    marginTop: 6,
    overflow: 'hidden',
  },
  stepBtn: {
    width: 38,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#131C2E',
  },
  stepBtnText: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
  },
  stepInput: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 8,
  },
  wheelCard: {
    backgroundColor: '#0B1120',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 13,
    marginTop: 12,
  },
  wheelCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  wheelCardTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  wheelStatusLabel: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  toggleTrack: {
    width: 46,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#1E293B',
    padding: 3,
    justifyContent: 'center',
  },
  toggleTrackActive: {
    backgroundColor: '#10B981',
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#94A3B8',
  },
  toggleThumbActive: {
    backgroundColor: '#FFFFFF',
    alignSelf: 'flex-end',
  },
  wheelInputsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  miniLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
  },
  wheelQuickBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  presetChip: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  presetChipActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderColor: '#10B981',
  },
  presetChipText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  presetChipTextActive: {
    color: '#34D399',
    fontWeight: '700',
  },
  doneNowPill: {
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginLeft: 'auto',
  },
  doneNowPillText: {
    color: '#38BDF8',
    fontSize: 11,
    fontWeight: '700',
  },
  wheelWarnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  smallInlineInput: {
    width: 72,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  scheduleTableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0B1120',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 8,
  },
  scheduleTableKm: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  scheduleTableItems: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  scheduleTableCost: {
    color: '#34D399',
    fontSize: 13,
    fontWeight: '800',
  },
  sourceNote: {
    color: '#64748B',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 12,
  },
  catalogSyncBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0B1120',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 14,
  },
  catalogSyncTitle: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  catalogSyncErr: {
    color: '#FCA5A5',
    fontSize: 11,
    marginTop: 2,
  },
  refreshCatalogBtn: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.35)',
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 102,
    alignItems: 'center',
  },
  refreshCatalogBtnText: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '700',
  },
  sourceUrl: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '600',
  },
});
