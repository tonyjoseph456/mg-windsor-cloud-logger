export const CAPSULE_PRESSED_SCALE = 1.16;
export const DRAG_THRESHOLD_PX = 6;
export const EDGE_RUBBER_MAX_PX = 6;

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Computes which tab indices are covered by the glass capsule (bitmask).
 * When resting or pressed centered on one tab, only that tab matches;
 * when dragged across two tabs (e.g. between Charge and Trips), both turn active.
 */
export function computeCapsuleOverlapMask(
  capsuleLeftPx: number,
  trackWidthPx: number,
  tabCount: number,
  lifted: boolean,
  fallbackIdx: number = 0
): number {
  if (trackWidthPx <= 0 || tabCount <= 0) {
    return 1 << clamp(fallbackIdx, 0, Math.max(0, tabCount - 1));
  }
  const slotW = trackWidthPx / tabCount;
  const capCenter = capsuleLeftPx + slotW * 0.5;
  const capHalf = slotW * (lifted ? CAPSULE_PRESSED_SCALE : 1) * 0.5;
  const tabHitHalf = slotW * 0.14;
  const threshold = capHalf + tabHitHalf;

  let mask = 0;
  for (let i = 0; i < tabCount; i++) {
    const tabCenter = (i + 0.5) * slotW;
    if (Math.abs(capCenter - tabCenter) <= threshold) {
      mask |= 1 << i;
    }
  }
  if (mask === 0) {
    const nearest = clamp(Math.floor(capCenter / slotW), 0, tabCount - 1);
    mask = 1 << nearest;
  }
  return mask;
}

/**
 * Computes live capsule left offset during horizontal pointer dragging,
 * blending smoothly from the touched tab's center onto the finger X with edge rubber-banding.
 */
export function computeDragCapsuleLeft(
  clientX: number,
  startClientX: number,
  downIdx: number,
  rectLeft: number,
  rectW: number,
  tabCount: number
): number {
  if (rectW <= 0 || tabCount <= 0) return 0;
  const slotW = rectW / tabCount;
  const dx = clientX - startClientX;
  const localX = clamp(clientX - rectLeft, 0, rectW);
  const blend = clamp((Math.abs(dx) - DRAG_THRESHOLD_PX) / 24, 0, 1);
  const anchoredCenter = (downIdx + 0.5) * slotW + dx;
  const targetCenter = anchoredCenter * (1 - blend) + localX * blend;
  const rawLeft = targetCenter - slotW * 0.5;
  const maxLeft = Math.max(0, rectW - slotW);

  if (rawLeft < 0) {
    return -Math.min(EDGE_RUBBER_MAX_PX, Math.abs(rawLeft) * 0.18);
  }
  if (rawLeft > maxLeft) {
    return maxLeft + Math.min(EDGE_RUBBER_MAX_PX, (rawLeft - maxLeft) * 0.18);
  }
  return rawLeft;
}

/**
 * Resolves the nearest tab index to settle on when the user releases the dragged capsule.
 */
export function computeNearestTabIndex(
  capsuleLeftPx: number,
  trackWidthPx: number,
  tabCount: number
): number {
  if (trackWidthPx <= 0 || tabCount <= 0) return 0;
  const slotW = trackWidthPx / tabCount;
  const capCenter = clamp(capsuleLeftPx + slotW * 0.5, 0, trackWidthPx);
  return clamp(Math.floor(capCenter / slotW), 0, tabCount - 1);
}
