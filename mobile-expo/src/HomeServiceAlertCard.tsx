import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import {
  ComputedNextServiceStatus,
  ComputedWheelServiceItemStatus,
  formatInrAmount,
  formatIsoDateShort,
  formatKmNumber,
  WheelServiceKey,
} from './sdk';

interface HomeServiceAlertCardProps {
  serviceStatus: ComputedNextServiceStatus;
  wheelStatuses: ComputedWheelServiceItemStatus[];
  onPressManage: () => void;
  onMarkWheelDone: (key: WheelServiceKey) => void;
}

function formatDaysCountdown(status: ComputedNextServiceStatus): string {
  if (status.daysRemaining === null) return 'Add service date';
  if (status.daysRemaining < 0) {
    const overdue = Math.abs(status.daysRemaining);
    return `${overdue} day${overdue === 1 ? '' : 's'} overdue`;
  }
  if (status.daysRemaining === 0) return 'Due today';
  return `${status.daysRemaining} day${status.daysRemaining === 1 ? '' : 's'} left`;
}

function formatKmCountdown(kmRemaining: number | null): string {
  if (kmRemaining === null) return 'Sync odometer';
  if (kmRemaining < 0) {
    return `${formatKmNumber(Math.abs(kmRemaining))} km overdue`;
  }
  if (kmRemaining === 0) return 'Due now';
  return `${formatKmNumber(kmRemaining)} km left`;
}

export const HomeServiceAlertCard: React.FC<HomeServiceAlertCardProps> = ({
  serviceStatus,
  wheelStatuses,
  onPressManage,
  onMarkWheelDone,
}) => {
  const activeWheelAlerts = wheelStatuses.filter((w) => w.isAlertActive);
  const showServiceAlert = serviceStatus.isAlertActive;

  if (!showServiceAlert && activeWheelAlerts.length === 0) {
    return null;
  }

  const hasOverdue =
    (showServiceAlert && serviceStatus.isOverdue) ||
    activeWheelAlerts.some((w) => w.isDueNow);

  const badgeBg = hasOverdue ? 'rgba(239, 68, 68, 0.16)' : 'rgba(245, 158, 11, 0.16)';
  const badgeBorder = hasOverdue ? 'rgba(248, 113, 113, 0.45)' : 'rgba(251, 191, 36, 0.45)';
  const badgeTextColor = hasOverdue ? '#FCA5A5' : '#FCD34D';
  const accentColor = hasOverdue ? '#F87171' : '#FBBF24';

  const partsText =
    serviceStatus.cost.lineItems.length > 0
      ? serviceStatus.cost.lineItems
          .map((item) => `${item.name} ${formatInrAmount(item.amountInr)}`)
          .join(' · ')
      : 'Inspection / check items only';

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          borderColor: badgeBorder,
          backgroundColor: hasOverdue ? 'rgba(127, 29, 29, 0.18)' : 'rgba(120, 53, 15, 0.18)',
        },
      ]}
      onPress={onPressManage}
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel="Service and wheel maintenance reminder. Tap to open details."
    >
      {/* Top Status Strip */}
      <View style={styles.topRow}>
        <View style={[styles.badge, { backgroundColor: badgeBg, borderColor: badgeBorder }]}>
          <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth={2.2}>
            <Path
              d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <Text style={[styles.badgeText, { color: badgeTextColor }]}>
            {hasOverdue ? 'MAINTENANCE OVERDUE' : 'MAINTENANCE DUE SOON'}
          </Text>
        </View>
        <Text style={styles.manageLink}>Manage ›</Text>
      </View>

      {/* Scheduled Periodic Service Block */}
      {showServiceAlert && (
        <View style={styles.serviceBlock}>
          <View style={styles.serviceHeaderRow}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.serviceTitle}>
                {formatKmNumber(serviceStatus.nextMilestone.km)} km Service ·{' '}
                {serviceStatus.nextMilestone.timeLabel}
              </Text>
              <Text style={styles.serviceSub} numberOfLines={2}>
                {partsText}
              </Text>
            </View>
            <View style={styles.costPill}>
              <Text style={styles.costPillLabel}>Approx.</Text>
              <Text style={styles.costPillVal}>{formatInrAmount(serviceStatus.cost.totalInr)}</Text>
            </View>
          </View>

          <View style={styles.countdownRow}>
            <View
              style={[
                styles.countdownBox,
                serviceStatus.isDaysWarning && {
                  borderColor: badgeBorder,
                  backgroundColor: 'rgba(15, 23, 42, 0.7)',
                },
              ]}
            >
              <Text style={styles.countdownLabel}>Time Countdown</Text>
              <Text
                style={[
                  styles.countdownValue,
                  serviceStatus.isDaysWarning && { color: badgeTextColor },
                ]}
              >
                {formatDaysCountdown(serviceStatus)}
              </Text>
              {serviceStatus.nextDueDate && (
                <Text style={styles.countdownSub}>Due {formatIsoDateShort(serviceStatus.nextDueDate)}</Text>
              )}
            </View>

            <View
              style={[
                styles.countdownBox,
                serviceStatus.isKmWarning && {
                  borderColor: badgeBorder,
                  backgroundColor: 'rgba(15, 23, 42, 0.7)',
                },
              ]}
            >
              <Text style={styles.countdownLabel}>Distance Countdown</Text>
              <Text
                style={[
                  styles.countdownValue,
                  serviceStatus.isKmWarning && { color: badgeTextColor },
                ]}
              >
                {formatKmCountdown(serviceStatus.kmRemaining)}
              </Text>
              <Text style={styles.countdownSub}>
                At {formatKmNumber(serviceStatus.nextMilestone.km)} km
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Wheel Balancing, Alignment & Tire Rotation Alerts */}
      {activeWheelAlerts.length > 0 && (
        <View style={[styles.wheelWrap, showServiceAlert && styles.wheelWrapDivider]}>
          {activeWheelAlerts.map((item) => {
            const isOverdue = item.isDueNow;
            const dotColor = isOverdue ? '#F87171' : '#FBBF24';
            return (
              <View key={item.key} style={styles.wheelRow}>
                <View style={styles.wheelIconWrap}>
                  <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={dotColor} strokeWidth={2}>
                    <Circle cx="12" cy="12" r="9" />
                    <Circle cx="12" cy="12" r="3" />
                  </Svg>
                </View>
                <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                  <Text style={styles.wheelTitle} numberOfLines={1}>
                    {item.label}
                  </Text>
                  <Text style={[styles.wheelSub, { color: isOverdue ? '#FCA5A5' : '#FCD34D' }]}>
                    {item.kmRemaining !== null && item.kmRemaining <= 0
                      ? item.kmRemaining === 0
                        ? `Due now at ${formatKmNumber(item.nextDueKm ?? 0)} km`
                        : `${formatKmNumber(Math.abs(item.kmRemaining))} km overdue`
                      : `${formatKmNumber(item.kmRemaining ?? 0)} km left · due at ${formatKmNumber(
                          item.nextDueKm ?? 0
                        )} km`}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.doneBtn}
                  onPress={(e) => {
                    e?.stopPropagation?.();
                    onMarkWheelDone(item.key);
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Mark ${item.label} done at current odometer`}
                >
                  <Text style={styles.doneBtnText}>Mark done</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    marginBottom: 18,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  manageLink: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94A3B8',
  },
  serviceBlock: {
    gap: 10,
  },
  serviceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  serviceTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  serviceSub: {
    color: '#CBD5E1',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  costPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.35)',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'flex-end',
  },
  costPillLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '600',
  },
  costPillVal: {
    color: '#34D399',
    fontSize: 15,
    fontWeight: '800',
  },
  countdownRow: {
    flexDirection: 'row',
    gap: 10,
  },
  countdownBox: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  countdownLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  countdownValue: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
  },
  countdownSub: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  wheelWrap: {
    gap: 8,
  },
  wheelWrapDivider: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
  },
  wheelRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  wheelIconWrap: {
    width: 24,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  wheelTitle: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '700',
  },
  wheelSub: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 1,
  },
  doneBtn: {
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.4)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  doneBtnText: {
    color: '#34D399',
    fontSize: 11,
    fontWeight: '700',
  },
});
