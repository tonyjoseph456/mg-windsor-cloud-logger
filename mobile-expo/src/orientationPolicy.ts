export type AppOrientationPolicy = 'portrait' | 'all';

export interface TabletDetectionInput {
  os: string;
  isPad?: boolean;
  screenWidth: number;
  screenHeight: number;
  maxTouchPoints?: number;
  hasTouchEvent?: boolean;
  userAgent?: string;
}

const TABLET_SHORTEST_SIDE_DP = 600;

/**
 * Identifies tablet form factors (iPads and >=600dp Android/touch tablets)
 * without misclassifying rotated phones or non-touch desktop monitors.
 */
export function isTabletViewport(input: TabletDetectionInput): boolean {
  const shortestSide = Math.min(Number(input.screenWidth) || 0, Number(input.screenHeight) || 0);
  if (input.os === 'ios') {
    return Boolean(input.isPad) || shortestSide >= TABLET_SHORTEST_SIDE_DP;
  }
  if (input.os === 'android') {
    return shortestSide >= TABLET_SHORTEST_SIDE_DP;
  }
  if (input.os === 'web') {
    const ua = input.userAgent || '';
    const touchPoints = Number(input.maxTouchPoints) || 0;
    const isIpadDesktopSafari = /macintosh/i.test(ua) && touchPoints >= 2;
    const isExplicitTabletUa =
      /ipad|tablet|playbook|silk/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua));
    const hasTouch = Boolean(input.hasTouchEvent) || touchPoints > 0;
    if (isIpadDesktopSafari || isExplicitTabletUa) {
      return shortestSide === 0 || shortestSide >= TABLET_SHORTEST_SIDE_DP;
    }
    return hasTouch && shortestSide >= TABLET_SHORTEST_SIDE_DP;
  }
  return false;
}

/**
 * Phones are always locked to portrait. Tablets also default to portrait unless
 * the user explicitly enables landscape orientation in Profile.
 */
export function resolveDesiredOrientationPolicy(params: {
  isTablet: boolean;
  tabletLandscapeEnabled: boolean;
}): AppOrientationPolicy {
  if (params.isTablet && params.tabletLandscapeEnabled) {
    return 'all';
  }
  return 'portrait';
}
