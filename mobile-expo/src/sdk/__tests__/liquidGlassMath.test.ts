import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CAPSULE_PRESSED_SCALE,
  computeCapsuleOverlapMask,
  computeDragCapsuleLeft,
  computeNearestTabIndex,
} from '../../liquidGlassMath.ts';

describe('LiquidGlassTabBar geometry & physics', () => {
  const TRACK_W = 400; // 4 slots x 100px each
  const TABS = 4;
  const SLOT_W = 100;

  it('resting on Home highlights only Home', () => {
    const mask = computeCapsuleOverlapMask(0, TRACK_W, TABS, false, 0);
    assert.equal(mask, 0b0001);
  });

  it('pressed centered on Charge uses 116% scale and highlights only Charge', () => {
    assert.equal(CAPSULE_PRESSED_SCALE, 1.16);
    const mask = computeCapsuleOverlapMask(SLOT_W, TRACK_W, TABS, true, 1);
    assert.equal(mask, 0b0010);
  });

  it('dragging midway between Charge (1) and Trips (2) highlights both Charge and Trips', () => {
    const midwayLeft = 1.5 * SLOT_W;
    const mask = computeCapsuleOverlapMask(midwayLeft, TRACK_W, TABS, true, 1);
    assert.equal(mask, 0b0110);
  });

  it('settles onto the nearest tab when released', () => {
    // 1.35 * slotW -> center 185 -> closer to Charge (1)
    assert.equal(computeNearestTabIndex(135, TRACK_W, TABS), 1);
    // 1.65 * slotW -> center 215 -> closer to Trips (2)
    assert.equal(computeNearestTabIndex(165, TRACK_W, TABS), 2);
    // Boundary clamps cleanly
    assert.equal(computeNearestTabIndex(-10, TRACK_W, TABS), 0);
    assert.equal(computeNearestTabIndex(350, TRACK_W, TABS), 3);
  });

  it('tracks finger drag between tabs and rubber-bands at edges', () => {
    // Touch down near Charge center (x=150), drag right by 50px to midway between Charge & Trips (left=150)
    const draggedLeft = computeDragCapsuleLeft(200, 150, 1, 0, TRACK_W, TABS);
    assert.equal(draggedLeft, 150);

    // Rubber-banding past left & right bounds stays within +/-6px
    assert.ok(computeDragCapsuleLeft(-100, 50, 0, 0, TRACK_W, TABS) >= -6);
    assert.ok(computeDragCapsuleLeft(500, 350, 3, 0, TRACK_W, TABS) <= 300 + 6);
  });
});
