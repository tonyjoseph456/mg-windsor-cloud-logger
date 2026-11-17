import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import {
  ComputedNextServiceStatus,
  ComputedWheelServiceItemStatus,
  computeServiceIntervalProgress,
  computeWheelAlertSummary,
  formatInrAmount,
  formatIsoDateShort,
  formatKmNumber,
  formatServiceDaysCountdownText,
  MaintenanceForecast,
  ServiceIntervalProgress,
  WheelServiceKey,
} from './sdk';

interface HomeServiceAlertCardProps {
  serviceStatus: ComputedNextServiceStatus;
  wheelStatuses: ComputedWheelServiceItemStatus[];
  serviceProgress?: ServiceIntervalProgress;
  forecast?: MaintenanceForecast;
  onPressManage: () => void;
  onMarkWheelDone: (keys: WheelServiceKey[]) => void;
}

interface PillItem {
  key: string;
  label: string;
  isOverdue: boolean;
}

interface MaintenanceAlertFrameProps {
  title: string;
  isOverdue: boolean;
  heroValue: string;
  heroUnit?: string;
  subtitle: string;
  progress: {
    fraction: number;
    startLabel: string;
    targetLabel: string;
  };
  pills: PillItem[];
  footerLeftTop: string;
  footerLeftBottom?: string;
  actionLabel: string;
  actionAccessibilityLabel: string;
  onPressCard: () => void;
  onPressAction: () => void;
}

const MaintenanceAlertFrame: React.FC<MaintenanceAlertFrameProps> = ({
  title,
  isOverdue,
  heroValue,
  heroUnit,
  subtitle,
  progress,
  pills,
  footerLeftTop,
  footerLeftBottom,
  actionLabel,
  actionAccessibilityLabel,
  onPressCard,
  onPressAction,
}) => {
  const accentColor = isOverdue ? '#FCA5A5' : '#FBC765';
  const fillColor = isOverdue ? '#F87171' : '#FBC765';
  const cardBg = isOverdue ? 'rgba(127, 29, 29, 0.18)' : 'rgba(120, 68, 12, 0.16)';
  const cardBorder = isOverdue ? 'rgba(248, 113, 113, 0.42)' : 'rgba(251, 191, 36, 0.34)';
  const iconBg = isOverdue ? 'rgba(248, 113, 113, 0.14)' : 'rgba(251, 191, 36, 0.12)';
  const trackBg = isOverdue ? 'rgba(248, 113, 113, 0.16)' : 'rgba(251, 191, 36, 0.16)';
  const pillBg = isOverdue ? 'rgba(248, 113, 113, 0.10)' : 'rgba(251, 191, 36, 0.10)';
  const pillBorder = isOverdue ? 'rgba(248, 113, 113, 0.28)' : 'rgba(251, 191, 36, 0.26)';
  const fillPct = Math.round(Math.max(0, Math.min(1, progress.fraction)) * 100);

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}
      onPress={onPressCard}
      activeOpacity={0.84}
      accessibilityRole="button"
      accessibilityLabel={`${title}. Tap to manage reminders.`}
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={[styles.iconCircle, { backgroundColor: iconBg }]}>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth={2.1}>
              <Path
                d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </View>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <Text style={styles.manageLink}>Manage ›</Text>
      </View>

      {/* Hero Countdown */}
      <View style={styles.heroRow}>
        <Text style={[styles.heroValue, { color: accentColor }]}>{heroValue}</Text>
        {Boolean(heroUnit) && <Text style={styles.heroUnit}>{heroUnit}</Text>}
      </View>
      <Text style={styles.subtitleText}>{subtitle}</Text>

      {/* Progress Bar & Endpoints */}
      <View style={[styles.progressTrack, { backgroundColor: trackBg }]}>
        <View style={[styles.progressFill, { width: `${fillPct}%`, backgroundColor: fillColor }]} />
      </View>
      <View style={styles.progressLabelsRow}>
        <Text style={styles.progressLabelText}>{progress.startLabel}</Text>
        <Text style={styles.progressLabelText}>{progress.targetLabel}</Text>
      </View>

      {/* Affected Items / Cost Pills */}
      {pills.length > 0 && (
        <View style={styles.pillsRow}>
          {pills.map((pill) => (
            <View
              key={pill.key}
              style={[
                styles.pill,
                {
                  backgroundColor: pill.isOverdue ? 'rgba(248, 113, 113, 0.12)' : pillBg,
                  borderColor: pill.isOverdue ? 'rgba(248, 113, 113, 0.34)' : pillBorder,
                },
              ]}
            >
              <View
                style={[
                  styles.pillDot,
                  { backgroundColor: pill.isOverdue ? '#F87171' : '#FBC765' },
                ]}
              />
              <Text style={styles.pillText}>{pill.label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Divider + Footer */}
      <View style={styles.divider} />
      <View style={styles.footerRow}>
        <View style={styles.footerLeft}>
          <Text style={styles.footerText}>{footerLeftTop}</Text>
          {Boolean(footerLeftBottom) && (
            <Text style={styles.footerSubText}>{footerLeftBottom}</Text>
          )}
        </View>

        <TouchableOpacity
          style={styles.actionBtn}
          onPress={(e) => {
            e?.stopPropagation?.();
            onPressAction();
          }}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={actionAccessibilityLabel}
        >
          <Text style={styles.actionBtnText}>{actionLabel}</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

export const HomeServiceAlertCard: React.FC<HomeServiceAlertCardProps> = ({
  serviceStatus,
  wheelStatuses,
  serviceProgress,
  forecast,
  onPressManage,
  onMarkWheelDone,
}) => {
  const activeWheelAlerts = wheelStatuses.filter((w) => w.isAlertActive);
  const showServiceAlert = serviceStatus.isAlertActive;

  if (!showServiceAlert && activeWheelAlerts.length === 0) {
    return null;
  }

  const pace = forecast?.runningAverage;
  const hasPace = Boolean(pace && pace.source === 'trips' && pace.weeklyKm && pace.weeklyKm > 0);
  const paceTop = hasPace
    ? `At about ${formatKmNumber(Math.round(pace!.weeklyKm!))} km a week`
    : 'Sync recent trips';
  const paceBottom = hasPace ? `(${pace!.windowLabel})` : 'for date estimate';

  const wheelSummary = computeWheelAlertSummary(activeWheelAlerts);

  const renderPeriodicServiceCard = () => {
    const isOverdue = serviceStatus.isOverdue;
    const kmRem = serviceStatus.kmRemaining;
    const daysRem = serviceStatus.daysRemaining;
    const showKmHero = serviceStatus.isKmWarning || daysRem === null;

    let heroValue = 'Due';
    let heroUnit = 'soon';
    if (showKmHero && kmRem !== null) {
      if (kmRem < 0) {
        heroValue = `${formatKmNumber(Math.abs(kmRem))} km`;
        heroUnit = 'overdue';
      } else if (kmRem === 0) {
        heroValue = 'Due';
        heroUnit = 'now';
      } else {
        heroValue = `${formatKmNumber(kmRem)} km`;
        heroUnit = 'left';
      }
    } else if (daysRem !== null) {
      const absDays = Math.abs(Math.round(daysRem));
      const dayWord = absDays === 1 ? 'day' : 'days';
      if (daysRem < 0) {
        heroValue = `${absDays} ${dayWord}`;
        heroUnit = 'overdue';
      } else if (daysRem === 0) {
        heroValue = 'Due';
        heroUnit = 'today';
      } else {
        heroValue = `${absDays} ${dayWord}`;
        heroUnit = 'left';
      }
    }

    const subParts: string[] = [];
    if (!isOverdue && forecast?.regularService.recommendedDate) {
      if (
        forecast.regularService.likelyTrigger === 'distance' &&
        serviceStatus.nextDueDate &&
        forecast.regularService.recommendedDate !== serviceStatus.nextDueDate
      ) {
        subParts.push(`About ${formatIsoDateShort(forecast.regularService.recommendedDate)}`);
        subParts.push(`due ${formatIsoDateShort(serviceStatus.nextDueDate)}`);
      } else {
        subParts.push(`About ${formatIsoDateShort(forecast.regularService.recommendedDate)}`);
      }
    } else if (serviceStatus.nextDueDate) {
      subParts.push(`due ${formatIsoDateShort(serviceStatus.nextDueDate)}`);
    } else {
      subParts.push(`at ${formatKmNumber(serviceStatus.nextMilestone.km)} km`);
    }
    subParts.push(`approx. ${formatInrAmount(serviceStatus.cost.totalInr)}`);

    const resolvedProgress =
      serviceProgress ||
      computeServiceIntervalProgress({
        odometerKm: serviceStatus.currentOdometerKm,
        lastServiceOdoKm: null,
        previousMilestoneKm: serviceStatus.previousMilestone?.km ?? null,
        nextMilestoneKm: serviceStatus.nextMilestone.km,
      });

    const servicePills: PillItem[] =
      serviceStatus.cost.lineItems.length > 0
        ? serviceStatus.cost.lineItems.map((li) => ({
            key: li.name,
            label: `${li.kind === 'labour' ? 'Paid service' : li.name} ${formatInrAmount(li.amountInr)}`,
            isOverdue,
          }))
        : [{ key: 'inspection', label: 'Inspection only', isOverdue }];

    return (
      <MaintenanceAlertFrame
        title={`${formatKmNumber(serviceStatus.nextMilestone.km)} km service ${
          isOverdue ? 'overdue' : 'due soon'
        }`}
        isOverdue={isOverdue}
        heroValue={heroValue}
        heroUnit={heroUnit}
        subtitle={subParts.join(' · ')}
        progress={{
          fraction: resolvedProgress.fraction,
          startLabel: resolvedProgress.startLabel,
          targetLabel: resolvedProgress.targetLabel,
        }}
        pills={servicePills}
        footerLeftTop={
          hasPace
            ? paceTop
            : daysRem !== null
              ? formatServiceDaysCountdownText(daysRem)
              : paceTop
        }
        footerLeftBottom={
          hasPace
            ? paceBottom
            : serviceStatus.nextDueDate
              ? `Due ${formatIsoDateShort(serviceStatus.nextDueDate)}`
              : undefined
        }
        actionLabel="View details"
        actionAccessibilityLabel="Open service reminder details"
        onPressCard={onPressManage}
        onPressAction={onPressManage}
      />
    );
  };

  const renderTyreCareCard = () => {
    if (!wheelSummary) return null;
    const { primary, hasOverdue, allShareSameTarget } = wheelSummary;
    const kmRem = primary.kmRemaining;

    let heroValue = 'Due';
    let heroUnit = 'now';
    if (kmRem !== null) {
      if (kmRem < 0) {
        heroValue = `${formatKmNumber(Math.abs(kmRem))} km`;
        heroUnit = 'overdue';
      } else if (kmRem === 0) {
        heroValue = 'Due';
        heroUnit = 'now';
      } else {
        heroValue = `${formatKmNumber(kmRem)} km`;
        heroUnit = 'left';
      }
    }

    const primaryForecast = forecast?.wheelServices.find((w) => w.key === primary.key);
    const dueTargetText = `due at ${formatKmNumber(primary.nextDueKm ?? 0)} km`;
    const subtitle =
      !primary.isDueNow && primaryForecast?.estimatedDate
        ? `About ${formatIsoDateShort(primaryForecast.estimatedDate)} · ${dueTargetText}`
        : dueTargetText;

    const wheelPills: PillItem[] = activeWheelAlerts.map((w) => {
      if (allShareSameTarget) {
        return { key: w.key, label: w.shortLabel, isOverdue: w.isDueNow };
      }
      const suffix =
        w.kmRemaining === null
          ? ''
          : w.kmRemaining < 0
            ? ` · ${formatKmNumber(Math.abs(w.kmRemaining))} over`
            : w.kmRemaining === 0
              ? ' · now'
              : ` · ${formatKmNumber(w.kmRemaining)} km`;
      return {
        key: w.key,
        label: `${w.shortLabel}${suffix}`,
        isOverdue: w.isDueNow,
      };
    });

    const isMultiple = activeWheelAlerts.length > 1;
    return (
      <MaintenanceAlertFrame
        title={hasOverdue ? 'Tyre care overdue' : 'Tyre care due soon'}
        isOverdue={hasOverdue}
        heroValue={heroValue}
        heroUnit={heroUnit}
        subtitle={subtitle}
        progress={{
          fraction: wheelSummary.fraction,
          startLabel: wheelSummary.startLabel,
          targetLabel: wheelSummary.targetLabel,
        }}
        pills={wheelPills}
        footerLeftTop={paceTop}
        footerLeftBottom={paceBottom}
        actionLabel={isMultiple ? 'Mark all done' : 'Mark done'}
        actionAccessibilityLabel={
          isMultiple
            ? 'Mark all due wheel maintenance items done at current odometer'
            : `Mark ${primary.label} done at current odometer`
        }
        onPressCard={onPressManage}
        onPressAction={() => onMarkWheelDone(activeWheelAlerts.map((w) => w.key))}
      />
    );
  };

  return (
    <View style={styles.stackWrap}>
      {renderTyreCareCard()}
      {showServiceAlert && renderPeriodicServiceCard()}
    </View>
  );
};

const styles = StyleSheet.create({
  stackWrap: {
    gap: 12,
    marginBottom: 18,
  },
  card: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 18,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    flex: 1,
    minWidth: 0,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
    flex: 1,
  },
  manageLink: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 0,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: 14,
  },
  heroValue: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  heroUnit: {
    color: '#CBD5E1',
    fontSize: 17,
    fontWeight: '500',
  },
  subtitleText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
    lineHeight: 18,
  },
  progressTrack: {
    height: 7,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 14,
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  progressLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  progressLabelText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  pillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pillText: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    marginTop: 16,
    marginBottom: 14,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  footerLeft: {
    flex: 1,
    minWidth: 0,
  },
  footerText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  footerSubText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 1,
  },
  actionBtn: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1.2,
    borderColor: 'rgba(52, 211, 153, 0.72)',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexShrink: 0,
  },
  actionBtnText: {
    color: '#34D399',
    fontSize: 15,
    fontWeight: '700',
  },
});
