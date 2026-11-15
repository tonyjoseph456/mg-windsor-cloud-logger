/**
 * Pure decision & message helpers for `/api/charging/toggle`, allowing a single
 * NFC sticker Shortcut URL to start and end charging sessions seamlessly alongside
 * `runCron` automatic charging detection.
 */

import {
  TRIP_TOGGLE_COOLDOWN_SEC,
  TripToggleLockState,
  WebhookToggleCooldownReason,
  evaluateWebhookToggleDecision,
} from './trip-toggle';

export type ChargingToggleDecision =
  | { action: 'start' }
  | { action: 'stop'; session: any }
  | {
      action: 'cooldown';
      reason: WebhookToggleCooldownReason;
      remainingSec: number;
      activeSession?: any | null;
    };

export type ChargingNotStartedReason = 'unavailable' | 'moving' | 'unplugged' | 'not_drawing';

/**
 * Decides whether a `/api/charging/toggle` tap should try to start a session,
 * inspect & stop an active/paused session, or emit a double-tap cooldown notice.
 */
export function evaluateChargingToggleDecision(params: {
  activeSession: any | null;
  lockState?: TripToggleLockState | null;
  nowSec: number;
  cooldownSec?: number;
}): ChargingToggleDecision {
  const decision = evaluateWebhookToggleDecision({
    activeRecord: params.activeSession,
    activeStartedAtSec: params.activeSession?.start_time,
    lockState: params.lockState,
    nowSec: params.nowSec,
    cooldownSec: params.cooldownSec ?? TRIP_TOGGLE_COOLDOWN_SEC,
  });

  if (decision.action === 'stop') {
    return { action: 'stop', session: decision.active };
  }
  if (decision.action === 'cooldown') {
    return {
      action: 'cooldown',
      reason: decision.reason,
      remainingSec: decision.remainingSec,
      activeSession: decision.active ?? null,
    };
  }
  return { action: 'start' };
}

/**
 * Formats cooldown responses when `/api/charging/toggle` receives a rapid double-tap.
 */
export function buildChargingToggleCooldownPayload(
  decision: Extract<ChargingToggleDecision, { action: 'cooldown' }>
): {
  success: boolean;
  action: 'cooldown';
  cooldownReason: WebhookToggleCooldownReason;
  cooldownRemainingSec: number;
  title: string;
  notification: string;
  message: string;
  session?: any;
} {
  let title: string;
  let message: string;

  if (decision.reason === 'in_flight') {
    title = '⏳ MG Windsor EV • Charging Sync In Progress';
    message = `A charging tap is already being processed. Wait ~${decision.remainingSec}s and check your notifications.`;
  } else if (decision.reason === 'recently_started') {
    title = '⏳ MG Windsor EV • Charging Already Active';
    message = `Charging session started moments ago. Double-tap protection active — tap again in ${decision.remainingSec}s to check or stop.`;
  } else {
    title = '⏳ MG Windsor EV • Charging Just Completed';
    message = `Charging session ended moments ago. Double-tap protection active — tap again in ${decision.remainingSec}s to start a new session.`;
  }

  return {
    success: true,
    action: 'cooldown',
    cooldownReason: decision.reason,
    cooldownRemainingSec: decision.remainingSec,
    title,
    notification: message,
    message,
    ...(decision.activeSession ? { session: decision.activeSession } : {}),
  };
}

/**
 * Determines whether a stop tap should finalize the active session or refuse
 * because the car is still actively drawing power (preventing cron re-opening).
 */
export function resolveChargingToggleStopAction(liveTelem: {
  hasChargeTelemetry?: boolean;
  isCharging?: boolean;
} | null | undefined): 'still_charging' | 'finalize' {
  if (liveTelem && liveTelem.hasChargeTelemetry !== false && Boolean(liveTelem.isCharging)) {
    return 'still_charging';
  }
  return 'finalize';
}

/**
 * Explains why an idle `/api/charging/toggle` tap did not create a synthetic
 * charging row when real telemetry shows the vehicle is not charging.
 */
export function classifyChargingNotStartedReason(liveTelem: {
  hasChargeTelemetry?: boolean;
  isCharging?: boolean;
  isPluggedIn?: boolean;
  speedKmh?: number;
} | null | undefined): {
  reason: ChargingNotStartedReason;
  title: string;
  message: string;
} {
  if (!liveTelem || liveTelem.hasChargeTelemetry === false) {
    return {
      reason: 'unavailable',
      title: 'ℹ️ MG Windsor EV • Charge Status Unavailable',
      message:
        'Car charge telemetry is temporarily unavailable from MG server. Tap again in a moment, or background detection will start automatically once charging stabilizes.',
    };
  }
  if (Number(liveTelem.speedKmh) > 1) {
    return {
      reason: 'moving',
      title: 'ℹ️ MG Windsor EV • Vehicle Moving',
      message: 'Car appears to be driving right now. Park and plug in before starting a charging session.',
    };
  }
  if (!liveTelem.isPluggedIn) {
    return {
      reason: 'unplugged',
      title: 'ℹ️ MG Windsor EV • Charger Not Plugged In',
      message: 'Charging gun is not plugged in yet. Plug in first, wait for charging to begin, then tap NFC again.',
    };
  }
  return {
    reason: 'not_drawing',
    title: 'ℹ️ MG Windsor EV • Waiting For Charger Power',
    message:
      'Charging gun is plugged in, but power draw is 0 kW right now (waiting on EVSE/breaker/schedule). Auto-detection will start automatically as soon as charging begins.',
  };
}
