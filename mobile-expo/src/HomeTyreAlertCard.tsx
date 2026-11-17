import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import {
  LowTyreDetail,
  MorningTyreCheckRecord,
  TyreThresholdEvaluation,
  formatIstClockTime,
  shouldShowMorningTyreAlertOnHome,
} from './sdk';

interface HomeTyreAlertCardProps {
  severeAirLoss: TyreThresholdEvaluation | null;
  morningCheck: MorningTyreCheckRecord | null;
  todayIst: string;
  syncedAtLabel?: string | null;
  onPressOpenTyres: () => void;
  onDismissMorningAlert: () => void;
}

const TyreAlertPillRow: React.FC<{
  items: LowTyreDetail[];
  urgent: boolean;
}> = ({ items, urgent }) => {
  if (items.length === 0) return null;
  const pillBg = urgent ? 'rgba(248, 113, 113, 0.12)' : 'rgba(251, 191, 36, 0.10)';
  const pillBorder = urgent ? 'rgba(248, 113, 113, 0.34)' : 'rgba(251, 191, 36, 0.26)';
  const dotColor = urgent ? '#F87171' : '#FBC765';

  return (
    <View style={styles.pillsRow}>
      {items.map((tyre) => (
        <View
          key={tyre.key}
          style={[styles.pill, { backgroundColor: pillBg, borderColor: pillBorder }]}
        >
          <View style={[styles.pillDot, { backgroundColor: dotColor }]} />
          <Text style={styles.pillText}>
            {`${tyre.shortLabel} · ${tyre.psi.toFixed(1)} PSI (-${tyre.dropPct}%)`}
          </Text>
        </View>
      ))}
    </View>
  );
};

export const HomeTyreAlertCard: React.FC<HomeTyreAlertCardProps> = ({
  severeAirLoss,
  morningCheck,
  todayIst,
  syncedAtLabel,
  onPressOpenTyres,
  onDismissMorningAlert,
}) => {
  const showSevereAlert = Boolean(severeAirLoss?.hasAlert && severeAirLoss.lowTyres.length > 0);
  const showMorningAlert = shouldShowMorningTyreAlertOnHome(morningCheck, todayIst);

  if (!showSevereAlert && !showMorningAlert) {
    return null;
  }

  const renderSevereAirLossCard = () => {
    if (!severeAirLoss || !showSevereAlert) return null;
    const worst = severeAirLoss.lowTyres.reduce((min, cur) => (cur.psi < min.psi ? cur : min));
    const syncText = syncedAtLabel ? `Synced at ${syncedAtLabel}` : 'Detected on latest sync';

    return (
      <TouchableOpacity
        style={[
          styles.card,
          {
            backgroundColor: 'rgba(127, 29, 29, 0.22)',
            borderColor: 'rgba(248, 113, 113, 0.48)',
          },
        ]}
        onPress={onPressOpenTyres}
        activeOpacity={0.84}
        accessibilityRole="button"
        accessibilityLabel="Air loss detected in tyres. Tap to open Tyres and closures."
      >
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={[styles.iconCircle, { backgroundColor: 'rgba(248, 113, 113, 0.16)' }]}>
              <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#FCA5A5" strokeWidth={2.2}>
                <Circle cx="12" cy="12" r="9" />
                <Path d="M12 8v5" strokeLinecap="round" />
                <Circle cx="12" cy="16.2" r="0.9" fill="#FCA5A5" />
              </Svg>
            </View>
            <Text style={styles.headerTitle} numberOfLines={1}>
              Air loss in tyres
            </Text>
          </View>
          <Text style={styles.manageLink}>Tyres ›</Text>
        </View>

        <View style={styles.heroRow}>
          <Text style={[styles.heroValue, { color: '#FCA5A5' }]}>
            {`${worst.psi.toFixed(1)} PSI`}
          </Text>
          <Text style={styles.heroUnit}>{`${worst.dropPct}% below ${severeAirLoss.recommendedPsi} PSI`}</Text>
        </View>

        <Text style={styles.subtitleText}>
          {`Air loss alert (≥ ${severeAirLoss.dropThresholdPct}% drop · ≤ ${severeAirLoss.thresholdPsi} PSI). Inspect tyre(s) for a leak or puncture before driving.`}
        </Text>

        <TyreAlertPillRow items={severeAirLoss.lowTyres} urgent />

        <View style={styles.divider} />
        <View style={styles.footerRow}>
          <View style={styles.footerLeft}>
            <Text style={styles.footerText}>{syncText}</Text>
            <Text style={styles.footerSubText}>
              {`Recommended ${severeAirLoss.recommendedPsi} PSI`}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.urgentActionBtn}
            onPress={(e) => {
              e?.stopPropagation?.();
              onPressOpenTyres();
            }}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Inspect tyres in Tyres and closures"
          >
            <Text style={styles.urgentActionBtnText}>Check tyres</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const renderMorningDropCard = () => {
    if (!morningCheck || !showMorningAlert) return null;
    const worst = morningCheck.lowTyres.reduce((min, cur) => (cur.psi < min.psi ? cur : min));
    const checkTime = formatIstClockTime(morningCheck.statusTimeSec || morningCheck.checkedAtSec);

    return (
      <TouchableOpacity
        style={[
          styles.card,
          {
            backgroundColor: 'rgba(120, 68, 12, 0.16)',
            borderColor: 'rgba(251, 191, 36, 0.36)',
          },
        ]}
        onPress={onPressOpenTyres}
        activeOpacity={0.84}
        accessibilityRole="button"
        accessibilityLabel="Low tyre pressure detected at 6 AM. Tap to open Tyres and closures."
      >
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <View style={[styles.iconCircle, { backgroundColor: 'rgba(251, 191, 36, 0.14)' }]}>
              <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#FBC765" strokeWidth={2.1}>
                <Circle cx="12" cy="12" r="9" />
                <Circle cx="12" cy="12" r="3" />
                <Path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
              </Svg>
            </View>
            <Text style={styles.headerTitle} numberOfLines={1}>
              6:00 AM tyre pressure alert
            </Text>
          </View>
          <Text style={styles.manageLink}>Adjust % ›</Text>
        </View>

        <View style={styles.heroRow}>
          <Text style={[styles.heroValue, { color: '#FBC765' }]}>
            {`${worst.psi.toFixed(1)} PSI`}
          </Text>
          <Text style={styles.heroUnit}>
            {`${worst.dropPct}% below ${morningCheck.recommendedPsi} PSI`}
          </Text>
        </View>

        <Text style={styles.subtitleText}>
          {`Tyre pressure dropped to ${morningCheck.dropThresholdPct}% below recommended ${morningCheck.recommendedPsi} PSI (≤ ${morningCheck.thresholdPsi} PSI) at ${checkTime} IST.`}
        </Text>

        <TyreAlertPillRow items={morningCheck.lowTyres} urgent={false} />

        <View style={styles.divider} />
        <View style={styles.footerRow}>
          <View style={styles.footerLeft}>
            <Text style={styles.footerText}>{`Checked at ${checkTime} IST`}</Text>
            <Text style={styles.footerSubText}>Cold morning check before daytime heat</Text>
          </View>

          <TouchableOpacity
            style={styles.dismissActionBtn}
            onPress={(e) => {
              e?.stopPropagation?.();
              onDismissMorningAlert();
            }}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Dismiss today's 6 AM tyre pressure alert"
          >
            <Text style={styles.dismissActionBtnText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.stackWrap}>
      {renderSevereAirLossCard()}
      {renderMorningDropCard()}
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
    gap: 8,
    marginTop: 14,
  },
  heroValue: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  heroUnit: {
    color: '#CBD5E1',
    fontSize: 15,
    fontWeight: '600',
  },
  subtitleText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '500',
    marginTop: 6,
    lineHeight: 18,
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
  urgentActionBtn: {
    backgroundColor: 'rgba(248, 113, 113, 0.16)',
    borderWidth: 1.2,
    borderColor: 'rgba(248, 113, 113, 0.65)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 11,
    flexShrink: 0,
  },
  urgentActionBtnText: {
    color: '#FCA5A5',
    fontSize: 14,
    fontWeight: '700',
  },
  dismissActionBtn: {
    backgroundColor: 'rgba(251, 191, 36, 0.14)',
    borderWidth: 1.2,
    borderColor: 'rgba(251, 191, 36, 0.52)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 11,
    flexShrink: 0,
  },
  dismissActionBtnText: {
    color: '#FBC765',
    fontSize: 14,
    fontWeight: '700',
  },
});
