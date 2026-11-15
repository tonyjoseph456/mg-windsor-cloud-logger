import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  PanResponder,
  Platform,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import {
  SWIPE_ACTION_WIDTH,
  clampSwipeTranslateX,
  resolveSwipeSnapTarget,
  shouldClaimHorizontalSwipe,
} from './swipeableDeleteMath';

interface SwipeableDeleteRowProps {
  rowId: string;
  openRowId: string | null;
  onOpenRowChange: (id: string | null) => void;
  onPress: () => void;
  onPressDelete: () => void;
  accessibilityLabel?: string;
  deleteAccessibilityLabel?: string;
  rowStyle?: StyleProp<ViewStyle>;
  outerStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
  children: React.ReactNode;
}

export function SwipeableDeleteRow({
  rowId,
  openRowId,
  onOpenRowChange,
  onPress,
  onPressDelete,
  accessibilityLabel,
  deleteAccessibilityLabel = 'Delete entry',
  rowStyle,
  outerStyle,
  disabled = false,
  children,
}: SwipeableDeleteRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const currentOffsetRef = useRef<number>(0);
  const startOffsetRef = useRef<number>(0);
  const isOpenRef = useRef<boolean>(false);
  const blockPressUntilRef = useRef<number>(0);

  const onOpenRowChangeRef = useRef(onOpenRowChange);
  onOpenRowChangeRef.current = onOpenRowChange;
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const onPressDeleteRef = useRef(onPressDelete);
  onPressDeleteRef.current = onPressDelete;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const rowIdRef = useRef(rowId);
  rowIdRef.current = rowId;

  const animateTo = useCallback(
    (target: number) => {
      const opening = target < 0;
      isOpenRef.current = opening;
      currentOffsetRef.current = target;
      if (opening) {
        onOpenRowChangeRef.current(rowIdRef.current);
      } else if (openRowId === rowIdRef.current) {
        onOpenRowChangeRef.current(null);
      }
      Animated.spring(translateX, {
        toValue: target,
        tension: 260,
        friction: 26,
        useNativeDriver: false,
      }).start();
    },
    [openRowId, translateX]
  );

  // Close automatically whenever another row is swiped open or selection resets
  useEffect(() => {
    if (openRowId !== rowId && isOpenRef.current) {
      isOpenRef.current = false;
      currentOffsetRef.current = 0;
      Animated.spring(translateX, {
        toValue: 0,
        tension: 260,
        friction: 26,
        useNativeDriver: false,
      }).start();
    }
  }, [openRowId, rowId, translateX]);

  // Web pointer swipe handler so touch & trackpad/mouse swipes work alongside ScrollView
  const webCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => {
      webCleanupRef.current?.();
      webCleanupRef.current = null;
    };
  }, []);

  const handleWebPointerDown = useCallback(
    (e: any) => {
      if (Platform.OS !== 'web' || typeof window === 'undefined' || disabledRef.current) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      const pointerId: number = e.pointerId;
      const startX: number = e.clientX;
      const startY: number = e.clientY;
      let locked: 'swipe' | 'scroll' | null = null;
      let baseOffset = currentOffsetRef.current;
      let lastX = startX;
      let lastTime = Date.now();
      let vx = 0;

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        if (!locked) {
          if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
            locked = 'scroll';
            cleanup();
            return;
          }
          if (shouldClaimHorizontalSwipe(dx, dy, isOpenRef.current)) {
            locked = 'swipe';
            blockPressUntilRef.current = Date.now() + 320;
            onOpenRowChangeRef.current(rowIdRef.current);
          } else {
            return;
          }
        }

        const now = Date.now();
        const dt = Math.max(1, now - lastTime);
        vx = (ev.clientX - lastX) / dt;
        lastX = ev.clientX;
        lastTime = now;

        const next = clampSwipeTranslateX(baseOffset + dx);
        currentOffsetRef.current = next;
        translateX.setValue(next);
      };

      const finish = () => {
        cleanup();
        if (locked !== 'swipe') return;
        blockPressUntilRef.current = Date.now() + 260;
        const target = resolveSwipeSnapTarget({ translateX: currentOffsetRef.current, vx });
        animateTo(target);
      };

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        if (webCleanupRef.current === cleanup) {
          webCleanupRef.current = null;
        }
      };

      webCleanupRef.current?.();
      webCleanupRef.current = cleanup;
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerup', finish, { passive: true });
      window.addEventListener('pointercancel', finish, { passive: true });
    },
    [animateTo, translateX]
  );

  // Native iOS / Android PanResponder
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, gs) =>
          Platform.OS !== 'web' &&
          !disabledRef.current &&
          shouldClaimHorizontalSwipe(gs.dx, gs.dy, isOpenRef.current),
        onPanResponderGrant: () => {
          startOffsetRef.current = currentOffsetRef.current;
          blockPressUntilRef.current = Date.now() + 320;
          onOpenRowChangeRef.current(rowIdRef.current);
        },
        onPanResponderMove: (_, gs) => {
          const next = clampSwipeTranslateX(startOffsetRef.current + gs.dx);
          currentOffsetRef.current = next;
          translateX.setValue(next);
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderRelease: (_, gs) => {
          blockPressUntilRef.current = Date.now() + 260;
          const target = resolveSwipeSnapTarget({
            translateX: currentOffsetRef.current,
            vx: gs.vx,
          });
          animateTo(target);
        },
        onPanResponderTerminate: () => {
          const target = resolveSwipeSnapTarget({
            translateX: currentOffsetRef.current,
            vx: 0,
          });
          animateTo(target);
        },
      }),
    [animateTo, translateX]
  );

  const handlePressRow = useCallback(() => {
    if (Date.now() < blockPressUntilRef.current) return;
    if (isOpenRef.current) {
      animateTo(0);
      return;
    }
    onPressRef.current();
  }, [animateTo]);

  const handlePressTrash = useCallback(() => {
    if (disabledRef.current) return;
    animateTo(0);
    onPressDeleteRef.current();
  }, [animateTo]);

  const actionOpacity = translateX.interpolate({
    inputRange: [-SWIPE_ACTION_WIDTH, -14, 0],
    outputRange: [1, 0.45, 0],
    extrapolate: 'clamp',
  });

  return (
    <View
      style={[styles.container, outerStyle]}
      {...(Platform.OS === 'web'
        ? ({
            'data-no-swipe-back': 'true',
            onPointerDown: handleWebPointerDown,
          } as any)
        : {})}
    >
      {/* Revealed Right-Side Delete Button */}
      <Animated.View
        pointerEvents={openRowId === rowId ? 'auto' : 'none'}
        style={[styles.deleteActionWrap, { opacity: actionOpacity }]}
      >
        <TouchableOpacity
          style={styles.deleteActionBtn}
          onPress={handlePressTrash}
          activeOpacity={0.8}
          disabled={disabled}
          accessibilityLabel={deleteAccessibilityLabel}
          accessibilityRole="button"
        >
          <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={2.2}>
            <Path d="M3 6h18" strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M10 11v6M14 11v6" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
          <Text style={styles.deleteActionText}>Delete</Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Foreground Sliding Row */}
      <Animated.View
        style={[
          styles.foregroundWrap,
          { transform: [{ translateX }] },
          Platform.OS === 'web' ? ({ touchAction: 'pan-y' } as any) : null,
        ]}
        {...panResponder.panHandlers}
      >
        <TouchableOpacity
          style={[styles.rowTouchable, rowStyle]}
          onPress={handlePressRow}
          activeOpacity={0.7}
          disabled={disabled}
          accessibilityLabel={accessibilityLabel}
          accessibilityRole="button"
        >
          {children}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#0A0E17',
  },
  deleteActionWrap: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    right: 0,
    width: SWIPE_ACTION_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  deleteActionBtn: {
    width: SWIPE_ACTION_WIDTH - 4,
    height: '100%',
    borderRadius: 12,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  deleteActionText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  foregroundWrap: {
    backgroundColor: '#0A0E17',
    zIndex: 2,
  },
  rowTouchable: {
    width: '100%',
  },
});
