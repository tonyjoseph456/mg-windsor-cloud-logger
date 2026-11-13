import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  LayoutChangeEvent,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  CAPSULE_PRESSED_SCALE,
  DRAG_THRESHOLD_PX,
  clamp,
  computeCapsuleOverlapMask,
  computeDragCapsuleLeft,
  computeNearestTabIndex,
} from './liquidGlassMath';

export interface LiquidGlassTabItem<T extends string = string> {
  id: T;
  label: string;
  renderIcon: (active: boolean) => React.ReactNode;
}

interface LiquidGlassTabBarProps<T extends string> {
  tabs: ReadonlyArray<LiquidGlassTabItem<T>>;
  activeTab: T;
  onSelectTab: (id: T) => void;
}

const ACTIVE_GREEN = '#34D399';
const INACTIVE_ICON_WHITE = 'rgba(255, 255, 255, 0.88)';
const INACTIVE_LABEL_WHITE = 'rgba(255, 255, 255, 0.82)';

const BAR_HEIGHT = 64;
const BAR_PAD_H = 4;
const BAR_PAD_V = 3;

function getInitialWebReduceTransparency(): boolean {
  if (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
  ) {
    try {
      return window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
    } catch {
      return false;
    }
  }
  return false;
}

export function LiquidGlassTabBar<T extends string>({
  tabs,
  activeTab,
  onSelectTab,
}: LiquidGlassTabBarProps<T>) {
  const tabCount = Math.max(1, tabs.length);
  const activeIdx = Math.max(0, tabs.findIndex((t) => t.id === activeTab));

  const [reduceTransparency, setReduceTransparency] = useState<boolean>(
    getInitialWebReduceTransparency
  );
  const [trackWidth, setTrackWidth] = useState<number>(0);
  const [isPressed, setIsPressed] = useState<boolean>(false);
  const [greenMask, setGreenMask] = useState<number>(1 << activeIdx);

  const trackElRef = useRef<any>(null);
  const trackWidthRef = useRef<number>(0);
  const trackWindowXRef = useRef<number>(0);
  const hasMeasuredRef = useRef<boolean>(false);
  const activeIdxRef = useRef<number>(activeIdx);
  activeIdxRef.current = activeIdx;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const onSelectTabRef = useRef(onSelectTab);
  onSelectTabRef.current = onSelectTab;

  const capsuleX = useRef(new Animated.Value(0)).current;
  const capsulePressAnim = useRef(new Animated.Value(0)).current;
  const capsuleLeftRef = useRef<number>(0);
  const lastPointerUpAtRef = useRef<number>(0);

  const interactionRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startClientX: number;
    downIdx: number;
    hasDragged: boolean;
    slotW: number;
    rectLeft: number;
    rectW: number;
  }>({
    active: false,
    pointerId: null,
    startClientX: 0,
    downIdx: 0,
    hasDragged: false,
    slotW: 0,
    rectLeft: 0,
    rectW: 0,
  });

  // Subscribe to OS / browser Reduce Transparency setting
  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return;
      }
      const mq = window.matchMedia('(prefers-reduced-transparency: reduce)');
      setReduceTransparency(Boolean(mq.matches));
      const handleChange = (ev: MediaQueryListEvent) => {
        setReduceTransparency(Boolean(ev.matches));
      };
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', handleChange);
        return () => mq.removeEventListener('change', handleChange);
      }
      (mq as any).addListener?.(handleChange);
      return () => (mq as any).removeListener?.(handleChange);
    }

    let mounted = true;
    AccessibilityInfo.isReduceTransparencyEnabled?.()
      .then((enabled) => {
        if (mounted) setReduceTransparency(Boolean(enabled));
      })
      .catch(() => {});

    const sub = AccessibilityInfo.addEventListener?.(
      'reduceTransparencyChanged',
      (enabled: boolean) => {
        setReduceTransparency(Boolean(enabled));
      }
    );

    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  // Track real-time capsule X so dragged overlap highlights update only when crossing a tab boundary
  useEffect(() => {
    const subId = capsuleX.addListener(({ value }) => {
      capsuleLeftRef.current = value;
      const ia = interactionRef.current;
      if (!ia.active) return;

      if (!ia.hasDragged) {
        const nextMask = 1 << ia.downIdx;
        setGreenMask((prev) => (prev === nextMask ? prev : nextMask));
        return;
      }

      const nextMask = computeCapsuleOverlapMask(
        value,
        trackWidthRef.current,
        tabsRef.current.length,
        true,
        ia.downIdx
      );
      setGreenMask((prev) => (prev === nextMask ? prev : nextMask));
    });

    return () => {
      capsuleX.removeListener(subId);
    };
  }, [capsuleX]);

  // Keep resting capsule synchronized when activeTab changes externally
  useEffect(() => {
    if (interactionRef.current.active) return;
    setGreenMask(1 << activeIdx);
    const w = trackWidthRef.current;
    if (w <= 0) return;

    const slotW = w / tabCount;
    const targetLeft = activeIdx * slotW;
    if (!hasMeasuredRef.current) {
      hasMeasuredRef.current = true;
      capsuleX.setValue(targetLeft);
      capsuleLeftRef.current = targetLeft;
      return;
    }

    Animated.spring(capsuleX, {
      toValue: targetLeft,
      tension: 260,
      friction: 24,
      useNativeDriver: false,
    }).start();
  }, [activeIdx, capsuleX, tabCount]);

  // Observe web container resizes
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof ResizeObserver === 'undefined') return;
    const el = trackElRef.current as HTMLElement | null;
    if (!el) return;

    const syncWidth = () => {
      const rect = el.getBoundingClientRect?.();
      if (!rect || rect.width <= 0) return;
      const prevW = trackWidthRef.current;
      if (Math.abs(rect.width - prevW) > 0.5) {
        trackWidthRef.current = rect.width;
        setTrackWidth(rect.width);
        if (!interactionRef.current.active) {
          const slotW = rect.width / tabsRef.current.length;
          const nextLeft = activeIdxRef.current * slotW;
          hasMeasuredRef.current = true;
          capsuleX.setValue(nextLeft);
          capsuleLeftRef.current = nextLeft;
        }
      }
    };

    syncWidth();
    const ro = new ResizeObserver(syncWidth);
    ro.observe(el);
    return () => ro.disconnect();
  }, [capsuleX]);

  const handleTrackLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const width = e.nativeEvent.layout.width;
      if (width <= 0) return;

      const widthChanged = Math.abs(width - trackWidthRef.current) > 0.5;
      trackWidthRef.current = width;
      if (widthChanged) {
        setTrackWidth(width);
      }

      if (!interactionRef.current.active && (!hasMeasuredRef.current || widthChanged)) {
        const slotW = width / tabCount;
        const targetLeft = activeIdxRef.current * slotW;
        hasMeasuredRef.current = true;
        capsuleX.setValue(targetLeft);
        capsuleLeftRef.current = targetLeft;
      }

      if (Platform.OS !== 'web') {
        trackElRef.current?.measureInWindow?.((x: number) => {
          if (typeof x === 'number') {
            trackWindowXRef.current = x;
          }
        });
      }
    },
    [capsuleX, tabCount]
  );

  const beginInteraction = useCallback(
    (clientX: number, rectLeft: number, rectW: number, pointerId: number | null) => {
      const count = tabsRef.current.length;
      if (rectW <= 0 || count <= 0) return;

      const slotW = rectW / count;
      const localX = clamp(clientX - rectLeft, 0, rectW);
      const downIdx = clamp(Math.floor(localX / slotW), 0, count - 1);

      trackWidthRef.current = rectW;
      hasMeasuredRef.current = true;
      interactionRef.current = {
        active: true,
        pointerId,
        startClientX: clientX,
        downIdx,
        hasDragged: false,
        slotW,
        rectLeft,
        rectW,
      };

      setIsPressed(true);
      setGreenMask(1 << downIdx);

      Animated.spring(capsulePressAnim, {
        toValue: 1,
        tension: 320,
        friction: 22,
        useNativeDriver: false,
      }).start();

      Animated.spring(capsuleX, {
        toValue: downIdx * slotW,
        tension: 290,
        friction: 24,
        useNativeDriver: false,
      }).start();
    },
    [capsulePressAnim, capsuleX]
  );

  const moveInteraction = useCallback(
    (clientX: number) => {
      const ia = interactionRef.current;
      if (!ia.active || ia.slotW <= 0 || ia.rectW <= 0) return;

      const dx = clientX - ia.startClientX;
      if (!ia.hasDragged && Math.abs(dx) > DRAG_THRESHOLD_PX) {
        ia.hasDragged = true;
        capsuleX.stopAnimation();
      }
      if (!ia.hasDragged) return;

      const nextLeft = computeDragCapsuleLeft(
        clientX,
        ia.startClientX,
        ia.downIdx,
        ia.rectLeft,
        ia.rectW,
        tabsRef.current.length
      );
      capsuleX.setValue(nextLeft);
    },
    [capsuleX]
  );

  const endInteraction = useCallback(
    (cancelled: boolean) => {
      const ia = interactionRef.current;
      if (!ia.active) return;

      const count = tabsRef.current.length;
      let settleIdx = activeIdxRef.current;
      if (!cancelled) {
        if (ia.hasDragged && ia.slotW > 0) {
          settleIdx = computeNearestTabIndex(capsuleLeftRef.current, ia.rectW, count);
        } else {
          settleIdx = ia.downIdx;
        }
      }

      ia.active = false;
      ia.pointerId = null;
      setIsPressed(false);
      setGreenMask(1 << settleIdx);
      lastPointerUpAtRef.current = Date.now();

      Animated.parallel([
        Animated.spring(capsulePressAnim, {
          toValue: 0,
          tension: 270,
          friction: 24,
          useNativeDriver: false,
        }),
        Animated.spring(capsuleX, {
          toValue: settleIdx * ia.slotW,
          tension: 260,
          friction: 24,
          useNativeDriver: false,
        }),
      ]).start();

      if (!cancelled && tabsRef.current[settleIdx]) {
        onSelectTabRef.current(tabsRef.current[settleIdx].id);
      }
    },
    [capsulePressAnim, capsuleX]
  );

  // Web active-drag window listeners cleanup ref
  const webListenersCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => {
      webListenersCleanupRef.current?.();
      webListenersCleanupRef.current = null;
    };
  }, []);

  const handleWebPointerDown = useCallback(
    (e: any) => {
      if (Platform.OS !== 'web' || typeof window === 'undefined') return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (interactionRef.current.active) return;

      const el = trackElRef.current as HTMLElement | null;
      const rect = el?.getBoundingClientRect?.();
      const rectLeft = rect ? rect.left : 0;
      const rectW = rect && rect.width > 0 ? rect.width : trackWidthRef.current;
      if (rectW <= 0) return;

      if (rect && Math.abs(rect.width - trackWidthRef.current) > 0.5) {
        setTrackWidth(rect.width);
      }

      const pointerId: number = e.pointerId;
      try {
        (e.currentTarget as any)?.setPointerCapture?.(pointerId);
      } catch {}
      webListenersCleanupRef.current?.();

      const onWindowMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        moveInteraction(ev.clientX);
      };
      const onWindowUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        cleanup();
        endInteraction(false);
      };
      const onWindowCancel = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        cleanup();
        endInteraction(true);
      };
      const cleanup = () => {
        window.removeEventListener('pointermove', onWindowMove);
        window.removeEventListener('pointerup', onWindowUp);
        window.removeEventListener('pointercancel', onWindowCancel);
        try {
          el?.releasePointerCapture?.(pointerId);
        } catch {}
        if (webListenersCleanupRef.current === cleanup) {
          webListenersCleanupRef.current = null;
        }
      };

      webListenersCleanupRef.current = cleanup;
      window.addEventListener('pointermove', onWindowMove, { passive: true });
      window.addEventListener('pointerup', onWindowUp, { passive: true });
      window.addEventListener('pointercancel', onWindowCancel, { passive: true });

      beginInteraction(e.clientX, rectLeft, rectW, pointerId);
    },
    [beginInteraction, endInteraction, moveInteraction]
  );

  // Native iOS / Android PanResponder
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => Platform.OS !== 'web',
      onMoveShouldSetPanResponder: () => Platform.OS !== 'web',
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const w = trackWidthRef.current;
        if (w <= 0) return;
        const pageX = e.nativeEvent.pageX;
        const rectLeft = trackWindowXRef.current;
        beginInteraction(pageX, rectLeft, w, null);
      },
      onPanResponderMove: (e) => {
        moveInteraction(e.nativeEvent.pageX);
      },
      onPanResponderRelease: () => {
        endInteraction(false);
      },
      onPanResponderTerminate: () => {
        endInteraction(true);
      },
    })
  ).current;

  const slotWidth = trackWidth > 0 ? trackWidth / tabCount : 0;

  const capsuleScale = capsulePressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, CAPSULE_PRESSED_SCALE],
  });

  const capsuleBgColor = capsulePressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: reduceTransparency
      ? ['#24324E', '#33466B']
      : ['rgba(255, 255, 255, 0.14)', 'rgba(255, 255, 255, 0.22)'],
  });

  const capsuleBorderColor = capsulePressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: reduceTransparency
      ? ['rgba(255, 255, 255, 0.22)', 'rgba(255, 255, 255, 0.42)']
      : ['rgba(255, 255, 255, 0.22)', 'rgba(255, 255, 255, 0.44)'],
  });

  const webRootProps =
    Platform.OS === 'web'
      ? ({
          className: 'liquid-glass-tabbar',
          'data-no-swipe-back': 'true',
          role: 'tablist',
          onContextMenu: (e: any) => e.preventDefault(),
        } as any)
      : {};

  const webSurfaceProps =
    Platform.OS === 'web'
      ? ({
          className: reduceTransparency
            ? 'liquid-glass-tabbar-surface reduced-transparency'
            : 'liquid-glass-tabbar-surface',
        } as any)
      : {};

  const webTrackProps =
    Platform.OS === 'web'
      ? ({
          onPointerDown: handleWebPointerDown,
          'data-no-swipe-back': 'true',
        } as any)
      : panResponder.panHandlers;

  const barSurfaceStyle = [
    styles.barSurface,
    reduceTransparency ? styles.barSurfaceReduced : styles.barSurfaceGlass,
  ];

  const capsuleShadowStyle =
    Platform.OS === 'web'
      ? ({
          boxShadow: isPressed
            ? '0 14px 32px rgba(0, 0, 0, 0.6), 0 5px 14px rgba(0, 0, 0, 0.42), inset 0 1px 0 0 rgba(255, 255, 255, 0.54)'
            : '0 2px 10px rgba(0, 0, 0, 0.2), inset 0 1px 0 0 rgba(255, 255, 255, 0.36)',
          transitionProperty: 'box-shadow',
          transitionDuration: '180ms',
          transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
        } as any)
      : isPressed
      ? styles.capsuleShadowPressedNative
      : styles.capsuleShadowRestingNative;

  return (
    <View
      nativeID="liquid-glass-tabbar"
      testID="liquid-glass-tabbar"
      style={styles.barOuter}
      accessibilityRole="tablist"
      {...webRootProps}
    >
      {/* Clipped Liquid Glass pill surface (7% white, 22px blur, 180% saturate, 16% white edge, 1px top highlight) */}
      <View
        nativeID="liquid-glass-tabbar-surface"
        pointerEvents="none"
        style={barSurfaceStyle}
        {...webSurfaceProps}
      />

      {/* Interactive gesture track (overflow visible so lifted 116% capsule floats above bar edge) */}
      <View
        ref={trackElRef}
        onLayout={handleTrackLayout}
        style={styles.track}
        {...webTrackProps}
      >
        {/* Sliding & Lifting Liquid Glass Capsule (14% white resting -> 22% white & 116% size pressed) */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.capsule,
            slotWidth > 0
              ? {
                  left: 0,
                  width: slotWidth,
                  transform: [{ translateX: capsuleX }, { scale: capsuleScale }],
                }
              : {
                  left: `${(activeIdx / tabCount) * 100}%` as any,
                  width: `${100 / tabCount}%` as any,
                  transform: [{ scale: capsuleScale }],
                },
            {
              backgroundColor: capsuleBgColor,
              borderColor: capsuleBorderColor,
            },
            capsuleShadowStyle,
          ]}
        />

        {/* Tab Icons & Labels layer above the capsule */}
        {tabs.map((item, idx) => {
          const isGreen = (greenMask & (1 << idx)) !== 0;
          const isSelected = activeTab === item.id;
          const webTabItemProps =
            Platform.OS === 'web'
              ? ({
                  role: 'tab',
                  'aria-selected': isSelected,
                  tabIndex: 0,
                  onClick: () => {
                    // Keyboard/Assistive fallback when click didn't originate from our pointer lifecycle
                    if (Date.now() - lastPointerUpAtRef.current > 180) {
                      onSelectTabRef.current(item.id);
                    }
                  },
                  onKeyDown: (e: any) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectTabRef.current(item.id);
                    }
                  },
                } as any)
              : {};

          return (
            <View
              key={item.id}
              style={styles.tabItem}
              accessibilityRole="tab"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: isSelected }}
              {...webTabItemProps}
            >
              <View style={styles.tabIconWrap}>{item.renderIcon(isGreen)}</View>
              <Text
                numberOfLines={1}
                style={[styles.tabLabel, isGreen && styles.tabLabelActive]}
              >
                {item.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  barOuter: {
    position: (Platform.OS === 'web' ? 'fixed' : 'absolute') as any,
    bottom: (Platform.OS === 'web' ? 18 : Platform.OS === 'ios' ? 24 : 18) as any,
    left: 16,
    right: 16,
    maxWidth: 420,
    height: BAR_HEIGHT,
    alignSelf: 'center',
    marginHorizontal: 'auto' as any,
    borderRadius: 9999,
    paddingHorizontal: BAR_PAD_H,
    paddingVertical: BAR_PAD_V,
    zIndex: Platform.OS === 'web' ? 9999 : 1000,
    overflow: 'visible',
    ...(Platform.OS === 'web'
      ? ({
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          touchAction: 'none',
        } as any)
      : {}),
  },
  barSurface: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 9999,
    overflow: 'hidden',
    borderWidth: 1,
  },
  barSurfaceGlass: {
    backgroundColor:
      Platform.OS === 'web'
        ? 'rgba(255, 255, 255, 0.07)'
        : 'rgba(15, 23, 42, 0.84)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
    ...(Platform.OS === 'web'
      ? ({
          backdropFilter: 'blur(22px) saturate(180%)',
          WebkitBackdropFilter: 'blur(22px) saturate(180%)',
          boxShadow:
            'inset 0 1px 0 0 rgba(255, 255, 255, 0.38), 0 12px 32px rgba(0, 0, 0, 0.45)',
        } as any)
      : {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 12 },
          shadowOpacity: 0.45,
          shadowRadius: 24,
          elevation: 20,
        }),
  },
  barSurfaceReduced: {
    backgroundColor: '#131B2E',
    borderColor: 'rgba(255, 255, 255, 0.18)',
    ...(Platform.OS === 'web'
      ? ({
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
          boxShadow:
            'inset 0 1px 0 0 rgba(255, 255, 255, 0.16), 0 12px 30px rgba(0, 0, 0, 0.6)',
        } as any)
      : {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 12 },
          shadowOpacity: 0.55,
          shadowRadius: 20,
          elevation: 20,
        }),
  },
  track: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
    overflow: 'visible',
    height: '100%',
    ...(Platform.OS === 'web'
      ? ({
          touchAction: 'none',
          cursor: 'pointer',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        } as any)
      : {}),
  },
  capsule: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: 9999,
    borderWidth: 1,
    zIndex: 1,
  },
  capsuleShadowRestingNative: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 4,
  },
  capsuleShadowPressedNative: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.58,
    shadowRadius: 18,
    elevation: 16,
  },
  tabItem: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    ...(Platform.OS === 'web'
      ? ({
          outlineStyle: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        } as any)
      : {}),
  },
  tabIconWrap: {
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: 10.5,
    fontWeight: '600',
    color: INACTIVE_LABEL_WHITE,
    marginTop: 2,
    ...(Platform.OS === 'web'
      ? ({
          textShadow: '0 1px 2px rgba(0, 0, 0, 0.35)',
        } as any)
      : {}),
  },
  tabLabelActive: {
    color: ACTIVE_GREEN,
    fontWeight: '700',
    ...(Platform.OS === 'web'
      ? ({
          textShadow: '0 0 10px rgba(52, 211, 153, 0.35)',
        } as any)
      : {}),
  },
});

export { ACTIVE_GREEN, INACTIVE_ICON_WHITE };
