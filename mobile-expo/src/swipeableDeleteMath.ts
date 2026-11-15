export const SWIPE_ACTION_WIDTH = 76;
export const SWIPE_OPEN_THRESHOLD = 36;
export const SWIPE_START_SLOP = 8;
export const SWIPE_FLICK_VX_THRESHOLD = 0.35;

/**
 * Clamps horizontal row offset so only right-to-left swipe (negative X) is allowed,
 * with a small rubber-band allowance past the revealed action width.
 */
export function clampSwipeTranslateX(rawX: number, actionWidth: number = SWIPE_ACTION_WIDTH): number {
  return Math.max(-actionWidth - 18, Math.min(0, rawX));
}

/**
 * Claims horizontal pan gestures only when moving clearly horizontally either
 * left to open the delete action, or right when the row is already swiped open.
 */
export function shouldClaimHorizontalSwipe(
  dx: number,
  dy: number,
  isOpen: boolean,
  slop: number = SWIPE_START_SLOP
): boolean {
  if (Math.abs(dx) <= slop) return false;
  if (Math.abs(dx) <= Math.abs(dy) * 1.25) return false;
  if (dx < 0) return true;
  return isOpen && dx > 0;
}

/**
 * Resolves the target resting offset (0 closed, -actionWidth open) on release.
 */
export function resolveSwipeSnapTarget(params: {
  translateX: number;
  vx: number;
  actionWidth?: number;
  openThreshold?: number;
}): number {
  const actionWidth = params.actionWidth ?? SWIPE_ACTION_WIDTH;
  const openThreshold = params.openThreshold ?? SWIPE_OPEN_THRESHOLD;
  if (params.vx <= -SWIPE_FLICK_VX_THRESHOLD) return -actionWidth;
  if (params.vx >= SWIPE_FLICK_VX_THRESHOLD) return 0;
  return params.translateX <= -openThreshold ? -actionWidth : 0;
}
