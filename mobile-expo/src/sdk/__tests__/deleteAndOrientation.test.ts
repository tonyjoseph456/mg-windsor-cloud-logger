import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isTabletViewport, resolveDesiredOrientationPolicy } from '../../orientationPolicy';
import {
  SWIPE_ACTION_WIDTH,
  clampSwipeTranslateX,
  resolveSwipeSnapTarget,
  shouldClaimHorizontalSwipe,
} from '../../swipeableDeleteMath';

describe('Tablet Detection & Orientation Lock Policy', () => {
  it('classifies mobile phones (iOS/Android/Web) as non-tablet and locks them to portrait', () => {
    assert.equal(
      isTabletViewport({ os: 'ios', isPad: false, screenWidth: 430, screenHeight: 932 }),
      false
    );
    assert.equal(
      isTabletViewport({ os: 'android', screenWidth: 412, screenHeight: 915 }),
      false
    );
    assert.equal(
      isTabletViewport({
        os: 'web',
        screenWidth: 844,
        screenHeight: 390,
        maxTouchPoints: 5,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      }),
      false
    );

    // Phones stay portrait even if somehow toggled true
    assert.equal(
      resolveDesiredOrientationPolicy({ isTablet: false, tabletLandscapeEnabled: false }),
      'portrait'
    );
    assert.equal(
      resolveDesiredOrientationPolicy({ isTablet: false, tabletLandscapeEnabled: true }),
      'portrait'
    );
  });

  it('classifies iPads & >=600dp tablets accurately and defaults tablets to portrait unless enabled', () => {
    assert.equal(
      isTabletViewport({ os: 'ios', isPad: true, screenWidth: 744, screenHeight: 1133 }),
      true
    );
    assert.equal(
      isTabletViewport({ os: 'android', screenWidth: 800, screenHeight: 1280 }),
      true
    );
    assert.equal(
      isTabletViewport({
        os: 'web',
        screenWidth: 1024,
        screenHeight: 1366,
        maxTouchPoints: 5,
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      }),
      true
    );
    // Desktop mouse browser is not treated as a tablet
    assert.equal(
      isTabletViewport({
        os: 'web',
        screenWidth: 1440,
        screenHeight: 900,
        maxTouchPoints: 0,
        hasTouchEvent: false,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      }),
      false
    );

    assert.equal(
      resolveDesiredOrientationPolicy({ isTablet: true, tabletLandscapeEnabled: false }),
      'portrait'
    );
    assert.equal(
      resolveDesiredOrientationPolicy({ isTablet: true, tabletLandscapeEnabled: true }),
      'all'
    );
  });
});

describe('SwipeableDeleteRow Gesture Math', () => {
  it('only allows right-to-left offset with bounded over-drag', () => {
    assert.equal(clampSwipeTranslateX(25), 0);
    assert.equal(clampSwipeTranslateX(-40), -40);
    assert.equal(clampSwipeTranslateX(-200), -SWIPE_ACTION_WIDTH - 18);
  });

  it('claims horizontal swipe right-to-left and closing swipes left-to-right only when open', () => {
    // Small jitter or vertical scrolling is never claimed
    assert.equal(shouldClaimHorizontalSwipe(-4, 0, false), false);
    assert.equal(shouldClaimHorizontalSwipe(-10, 20, false), false);

    // Swiping left past slop claims the gesture
    assert.equal(shouldClaimHorizontalSwipe(-18, 3, false), true);

    // Swiping right while closed does NOT steal back gestures or scroll
    assert.equal(shouldClaimHorizontalSwipe(24, 2, false), false);

    // Swiping right while open closes smoothly
    assert.equal(shouldClaimHorizontalSwipe(24, 2, true), true);
  });

  it('snaps open or closed based on release offset and velocity', () => {
    assert.equal(resolveSwipeSnapTarget({ translateX: -20, vx: 0 }), 0);
    assert.equal(resolveSwipeSnapTarget({ translateX: -48, vx: 0 }), -SWIPE_ACTION_WIDTH);
    assert.equal(resolveSwipeSnapTarget({ translateX: -18, vx: -0.6 }), -SWIPE_ACTION_WIDTH);
    assert.equal(resolveSwipeSnapTarget({ translateX: -65, vx: 0.55 }), 0);
  });
});
