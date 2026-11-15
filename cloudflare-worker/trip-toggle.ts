/**
 * Pure state-transition & debounce helpers shared by single-URL NFC / fallback
 * toggle webhooks (`/api/trip/toggle` and `/api/charging/toggle`).
 */

export const TRIP_TOGGLE_COOLDOWN_SEC = 10;
export const TRIP_TOGGLE_IN_FLIGHT_TIMEOUT_SEC = 15;

export interface TripToggleLockState {
  status: 'in_flight' | 'done';
  ts: number;
  action?: 'start' | 'stop';
}

export type WebhookToggleCooldownReason =
  | 'in_flight'
  | 'recently_started'
  | 'recently_stopped';

export type WebhookToggleDecision<T = any> =
  | { action: 'start' }
  | { action: 'stop'; active: T }
  | {
      action: 'cooldown';
      reason: WebhookToggleCooldownReason;
      remainingSec: number;
      active?: T | null;
    };

export type TripToggleDecision =
  | { action: 'start' }
  | { action: 'stop'; trip: any }
  | {
      action: 'cooldown';
      reason: WebhookToggleCooldownReason;
      remainingSec: number;
      ongoingTrip?: any | null;
    };

/**
 * Core start/stop/cooldown state machine shared across single-URL toggle endpoints.
 * Prevents concurrent telemetry races (`in_flight`) and NFC double-tap bounces
 * right after either starting or stopping an active session.
 */
export function evaluateWebhookToggleDecision<T = any>(params: {
  activeRecord: T | null;
  activeStartedAtSec?: number | null;
  lockState?: TripToggleLockState | null;
  nowSec: number;
  cooldownSec?: number;
}): WebhookToggleDecision<T> {
  const {
    activeRecord,
    activeStartedAtSec = null,
    lockState = null,
    nowSec,
    cooldownSec = TRIP_TOGGLE_COOLDOWN_SEC,
  } = params;
  const safeCooldown = Math.max(0, Math.floor(cooldownSec));
  const inFlightWindow = Math.max(safeCooldown, TRIP_TOGGLE_IN_FLIGHT_TIMEOUT_SEC);

  // Guard against simultaneous double-requests while MG telemetry is being fetched.
  if (lockState?.status === 'in_flight' && Number.isFinite(lockState.ts)) {
    const rawElapsed = nowSec - Number(lockState.ts);
    if (rawElapsed >= -5 && rawElapsed < inFlightWindow) {
      const remainingSec = Math.max(1, inFlightWindow - Math.max(0, Math.floor(rawElapsed)));
      return {
        action: 'cooldown',
        reason: 'in_flight',
        remainingSec,
        active: activeRecord,
      };
    }
  }

  if (activeRecord) {
    if (safeCooldown > 0) {
      const candidates: number[] = [];
      const startTs = Number(activeStartedAtSec);
      if (Number.isFinite(startTs) && startTs > 0) {
        const elapsedSinceStart = nowSec - startTs;
        if (elapsedSinceStart >= -5 && elapsedSinceStart < safeCooldown) {
          candidates.push(Math.max(0, Math.floor(elapsedSinceStart)));
        }
      }
      if (
        lockState?.status === 'done' &&
        lockState.action === 'start' &&
        Number.isFinite(lockState.ts) &&
        lockState.ts > 0
      ) {
        const elapsedSinceLock = nowSec - Number(lockState.ts);
        if (elapsedSinceLock >= -5 && elapsedSinceLock < safeCooldown) {
          candidates.push(Math.max(0, Math.floor(elapsedSinceLock)));
        }
      }
      if (candidates.length > 0) {
        const minElapsed = Math.min(...candidates);
        return {
          action: 'cooldown',
          reason: 'recently_started',
          remainingSec: Math.max(1, safeCooldown - minElapsed),
          active: activeRecord,
        };
      }
    }
    return { action: 'stop', active: activeRecord };
  }

  // Guard against accidental NFC double-tap right after stopping (prevents ghost re-start).
  if (
    safeCooldown > 0 &&
    lockState?.status === 'done' &&
    lockState.action === 'stop' &&
    Number.isFinite(lockState.ts) &&
    lockState.ts > 0
  ) {
    const elapsedSinceStop = nowSec - Number(lockState.ts);
    if (elapsedSinceStop >= -5 && elapsedSinceStop < safeCooldown) {
      const remainingSec = Math.max(1, safeCooldown - Math.max(0, Math.floor(elapsedSinceStop)));
      return {
        action: 'cooldown',
        reason: 'recently_stopped',
        remainingSec,
        active: null,
      };
    }
  }

  return { action: 'start' };
}

/**
 * Decides whether a single `/api/trip/toggle` tap should start a new trip,
 * stop the currently ongoing trip, or return a double-tap protection notice.
 */
export function evaluateTripToggleDecision(params: {
  ongoingTrip: any | null;
  lockState?: TripToggleLockState | null;
  nowSec: number;
  cooldownSec?: number;
}): TripToggleDecision {
  const decision = evaluateWebhookToggleDecision({
    activeRecord: params.ongoingTrip,
    activeStartedAtSec: params.ongoingTrip?.start_timestamp,
    lockState: params.lockState,
    nowSec: params.nowSec,
    cooldownSec: params.cooldownSec,
  });
  if (decision.action === 'stop') {
    return { action: 'stop', trip: decision.active };
  }
  if (decision.action === 'cooldown') {
    return {
      action: 'cooldown',
      reason: decision.reason,
      remainingSec: decision.remainingSec,
      ongoingTrip: decision.active ?? null,
    };
  }
  return { action: 'start' };
}

/**
 * Builds consistent JSON + Shortcut text notification fields for trip toggle cooldown responses.
 */
export function buildTripToggleCooldownPayload(
  decision: Extract<TripToggleDecision, { action: 'cooldown' }>
): {
  success: boolean;
  action: 'cooldown';
  cooldownReason: WebhookToggleCooldownReason;
  cooldownRemainingSec: number;
  title: string;
  notification: string;
  message: string;
  trip?: any;
} {
  let title: string;
  let message: string;

  if (decision.reason === 'in_flight') {
    title = '⏳ MG Windsor EV • Sync In Progress';
    message = `A trip tap is already being processed. Wait ~${decision.remainingSec}s and check your notifications.`;
  } else if (decision.reason === 'recently_started') {
    title = '⏳ MG Windsor EV • Trip Already Started';
    message = `Trip started moments ago. Double-tap protection active — tap again in ${decision.remainingSec}s if you want to stop it.`;
  } else {
    title = '⏳ MG Windsor EV • Trip Just Completed';
    message = `Trip just ended moments ago. Double-tap protection active — tap again in ${decision.remainingSec}s to start a new trip.`;
  }

  return {
    success: true,
    action: 'cooldown',
    cooldownReason: decision.reason,
    cooldownRemainingSec: decision.remainingSec,
    title,
    notification: message,
    message,
    ...(decision.ongoingTrip ? { trip: decision.ongoingTrip } : {}),
  };
}
