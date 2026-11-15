import { Platform } from 'react-native';
import {
  type AppOrientationPolicy,
  type TabletDetectionInput,
  isTabletViewport,
  resolveDesiredOrientationPolicy,
} from './orientationPolicy';

export {
  type AppOrientationPolicy,
  type TabletDetectionInput,
  isTabletViewport,
  resolveDesiredOrientationPolicy,
};

export function detectRuntimeIsTablet(windowWidth: number, windowHeight: number): boolean {
  const isPad = Platform.OS === 'ios' && Boolean((Platform as any).isPad);
  let screenWidth = windowWidth;
  let screenHeight = windowHeight;
  let maxTouchPoints = 0;
  let hasTouchEvent = false;
  let userAgent = '';

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    if (window.screen && Number(window.screen.width) > 0 && Number(window.screen.height) > 0) {
      screenWidth = windowWidth > 0 ? Math.min(windowWidth, window.screen.width) : window.screen.width;
      screenHeight = windowHeight > 0 ? Math.min(windowHeight, window.screen.height) : window.screen.height;
    }
    if (typeof navigator !== 'undefined') {
      maxTouchPoints = Number(navigator.maxTouchPoints) || 0;
      userAgent = navigator.userAgent || '';
    }
    hasTouchEvent = 'ontouchstart' in window;
  }

  return isTabletViewport({
    os: Platform.OS,
    isPad,
    screenWidth,
    screenHeight,
    maxTouchPoints,
    hasTouchEvent,
    userAgent,
  });
}

export async function applyScreenOrientationPolicy(policy: AppOrientationPolicy): Promise<void> {
  try {
    const ScreenOrientation = await import('expo-screen-orientation');
    if (policy === 'all') {
      await ScreenOrientation.unlockAsync().catch(async () => {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.DEFAULT);
      });
    } else {
      await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(async () => {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT);
      });
    }
  } catch {
    // Web browsers (e.g., iOS Safari or non-fullscreen windows) reject orientation.lock; ignore safely.
  }
}
