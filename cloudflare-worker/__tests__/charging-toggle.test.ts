import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildChargingToggleCooldownPayload,
  classifyChargingNotStartedReason,
  evaluateChargingToggleDecision,
  resolveChargingToggleStopAction,
} from '../charging-toggle';
import { TRIP_TOGGLE_COOLDOWN_SEC, TRIP_TOGGLE_IN_FLIGHT_TIMEOUT_SEC } from '../trip-toggle';
import { createEnvAuthKvStore, ensureWebhookKey } from '../multi-user-auth';
import worker from '../multi-worker';

class InMemoryKv {
  private map = new Map<string, string>();

  async get(key: string, type?: 'text' | 'json'): Promise<any> {
    const raw = this.map.get(key);
    if (raw === undefined) return null;
    if (type === 'json') {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    return raw;
  }

  async put(key: string, value: string): Promise<void> {
    this.map.set(key, String(value));
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

describe('Charging Toggle State Machine (/api/charging/toggle)', () => {
  it('chooses start when no charging session is active and no cooldown applies', () => {
    const decision = evaluateChargingToggleDecision({
      activeSession: null,
      lockState: null,
      nowSec: 1_700_000_000,
    });
    assert.deepEqual(decision, { action: 'start' });
  });

  it('chooses stop for an auto-detected ongoing or paused session past cooldown', () => {
    const ongoing = {
      id: 'chg_cron_1',
      status: 'ongoing',
      start_time: 1_700_000_000 - 1800,
    };
    const decision = evaluateChargingToggleDecision({
      activeSession: ongoing,
      lockState: null,
      nowSec: 1_700_000_000,
    });
    assert.deepEqual(decision, { action: 'stop', session: ongoing });

    const paused = { ...ongoing, status: 'paused', paused_at: 1_700_000_000 - 600 };
    const pausedDecision = evaluateChargingToggleDecision({
      activeSession: paused,
      lockState: null,
      nowSec: 1_700_000_000,
    });
    assert.deepEqual(pausedDecision, { action: 'stop', session: paused });
  });

  it('enforces start double-tap cooldown via lock timestamp even when BMS backdates start_time', () => {
    const backdatedSession = {
      id: 'chg_bms_1',
      status: 'ongoing',
      start_time: 1_700_000_000 - 300,
    };
    const decision = evaluateChargingToggleDecision({
      activeSession: backdatedSession,
      lockState: { status: 'done', ts: 1_700_000_000, action: 'start' },
      nowSec: 1_700_000_003,
    });
    assert.equal(decision.action, 'cooldown');
    if (decision.action === 'cooldown') {
      assert.equal(decision.reason, 'recently_started');
      assert.equal(decision.remainingSec, TRIP_TOGGLE_COOLDOWN_SEC - 3);
      const payload = buildChargingToggleCooldownPayload(decision);
      assert.match(payload.title, /Already Active/);
    }
  });

  it('enforces post-stop cooldown and recovers after cooldownSec elapses', () => {
    const locked = evaluateChargingToggleDecision({
      activeSession: null,
      lockState: { status: 'done', ts: 1_700_000_100, action: 'stop' },
      nowSec: 1_700_000_104,
    });
    assert.equal(locked.action, 'cooldown');
    if (locked.action === 'cooldown') {
      assert.equal(locked.reason, 'recently_stopped');
      assert.equal(locked.remainingSec, TRIP_TOGGLE_COOLDOWN_SEC - 4);
      const payload = buildChargingToggleCooldownPayload(locked);
      assert.match(payload.title, /Just Completed/);
    }

    const ready = evaluateChargingToggleDecision({
      activeSession: null,
      lockState: { status: 'done', ts: 1_700_000_100, action: 'stop' },
      nowSec: 1_700_000_100 + TRIP_TOGGLE_COOLDOWN_SEC,
    });
    assert.deepEqual(ready, { action: 'start' });
  });

  it('guards concurrent in_flight taps and expires stale locks cleanly', () => {
    const inFlight = evaluateChargingToggleDecision({
      activeSession: null,
      lockState: { status: 'in_flight', ts: 1_700_000_200, action: 'start' },
      nowSec: 1_700_000_201,
    });
    assert.equal(inFlight.action, 'cooldown');
    if (inFlight.action === 'cooldown') {
      assert.equal(inFlight.reason, 'in_flight');
      assert.equal(inFlight.remainingSec, TRIP_TOGGLE_IN_FLIGHT_TIMEOUT_SEC - 1);
    }

    const recovered = evaluateChargingToggleDecision({
      activeSession: null,
      lockState: { status: 'in_flight', ts: 1_700_000_200, action: 'start' },
      nowSec: 1_700_000_200 + TRIP_TOGGLE_IN_FLIGHT_TIMEOUT_SEC,
    });
    assert.deepEqual(recovered, { action: 'start' });
  });

  it('keeps active session open while still drawing power and classifies blocked starts accurately', () => {
    assert.equal(
      resolveChargingToggleStopAction({ hasChargeTelemetry: true, isCharging: true }),
      'still_charging'
    );
    assert.equal(
      resolveChargingToggleStopAction({ hasChargeTelemetry: true, isCharging: false }),
      'finalize'
    );
    assert.equal(
      resolveChargingToggleStopAction({ hasChargeTelemetry: false, isCharging: false }),
      'finalize'
    );
    assert.equal(resolveChargingToggleStopAction(null), 'finalize');

    assert.equal(classifyChargingNotStartedReason(null).reason, 'unavailable');
    assert.equal(
      classifyChargingNotStartedReason({ hasChargeTelemetry: false, isPluggedIn: true }).reason,
      'unavailable'
    );
    assert.equal(
      classifyChargingNotStartedReason({ hasChargeTelemetry: true, speedKmh: 18, isPluggedIn: false }).reason,
      'moving'
    );
    assert.equal(
      classifyChargingNotStartedReason({ hasChargeTelemetry: true, speedKmh: 0, isPluggedIn: false }).reason,
      'unplugged'
    );
    assert.equal(
      classifyChargingNotStartedReason({ hasChargeTelemetry: true, speedKmh: 0, isPluggedIn: true, isCharging: false }).reason,
      'not_drawing'
    );
  });
});

describe('Worker /api/charging/toggle Endpoint Routing & Lifecycle', () => {
  const ADMIN_PHONE = '919876543210';
  const TEST_VIN = 'LSGWT000000000002';

  it('rejects missing or invalid webhook key with 401 in text and json formats', async () => {
    const kv = new InMemoryKv();
    const env: any = { TRIP_KV: kv, ADMIN_PHONE };

    const badText = await worker.fetch(
      new Request('https://example.workers.dev/api/charging/toggle?key=wk_bad&format=text'),
      env
    );
    assert.equal(badText.status, 401);
    assert.ok((await badText.text()).startsWith('❌'));

    const missingJson = await worker.fetch(
      new Request('https://example.workers.dev/api/charging/toggle?format=json'),
      env
    );
    assert.equal(missingJson.status, 401);
    const body: any = await missingJson.json();
    assert.equal(body.success, false);
  });

  it('finalizes an ongoing or paused session on NFC stop, blocks bounce restart, and preserves active lock cleanup on 401', async () => {
    const kv = new InMemoryKv();
    const env: any = { TRIP_KV: kv, ADMIN_PHONE };
    const authStore = createEnvAuthKvStore(env);
    const webhookKey = await ensureWebhookKey(authStore, TEST_VIN, ADMIN_PHONE);

    const nowSec = Math.floor(Date.now() / 1000);
    await kv.put(
      `d1_fallback:active_charging_session:${TEST_VIN}`,
      JSON.stringify({
        id: 'chg_active_1',
        vin: TEST_VIN,
        status: 'paused',
        start_time: nowSec - 3600,
        paused_at: nowSec - 600,
        start_soc: 50,
        end_soc: 65,
        charge_type: 'AC',
        peak_power_kw: 3.3,
        energy_used_kwh: 6.48,
        active_duration_seconds: 3000,
        outage_count: 1,
        date: '2026-11-15',
      })
    );

    const stopRes = await worker.fetch(
      new Request(`https://example.workers.dev/api/charging/toggle?key=${webhookKey}&format=json`),
      env
    );
    assert.equal(stopRes.status, 200);
    const stopBody: any = await stopRes.json();
    assert.equal(stopBody.success, true);
    assert.equal(stopBody.action, 'stop');
    assert.equal(stopBody.cancelled, false);
    assert.equal(stopBody.session.end_soc, 65);
    assert.equal(stopBody.session.soc_added, 15);
    assert.equal(stopBody.session.end_time, nowSec - 600);
    assert.equal(await kv.get(`d1_fallback:active_charging_session:${TEST_VIN}`, 'json'), null);

    // Immediate bounce tap returns cooldown instead of hitting MG or failing 401
    const bounceRes = await worker.fetch(
      new Request(`https://example.workers.dev/api/charging/toggle?key=${webhookKey}&format=text`),
      env
    );
    assert.equal(bounceRes.status, 200);
    assert.match(await bounceRes.text(), /Just Completed/);

    // Clear lock and verify missing MG session on idle tap returns 401 and deletes in_flight lock
    await kv.delete(`charging_toggle_state:${TEST_VIN}`);
    const noMgRes = await worker.fetch(
      new Request(`https://example.workers.dev/api/charging/toggle?key=${webhookKey}&format=json`),
      env
    );
    assert.equal(noMgRes.status, 401);
    assert.equal(await kv.get(`charging_toggle_state:${TEST_VIN}`, 'json'), null);
  });

  it('prunes zero-energy brief plug sessions cleanly and enforces recently_started cooldown', async () => {
    const kv = new InMemoryKv();
    const env: any = { TRIP_KV: kv, ADMIN_PHONE };
    const authStore = createEnvAuthKvStore(env);
    const webhookKey = await ensureWebhookKey(authStore, TEST_VIN, ADMIN_PHONE);

    const nowSec = Math.floor(Date.now() / 1000);
    await kv.put(
      `d1_fallback:active_charging_session:${TEST_VIN}`,
      JSON.stringify({
        id: 'chg_fresh_1',
        vin: TEST_VIN,
        status: 'ongoing',
        start_time: nowSec - 2,
        start_soc: 70,
        end_soc: 70,
        energy_used_kwh: 0,
        active_duration_seconds: 2,
      })
    );

    const cooldownRes = await worker.fetch(
      new Request(`https://example.workers.dev/api/charging/toggle?key=${webhookKey}&format=json`),
      env
    );
    assert.equal(cooldownRes.status, 200);
    const cooldownBody: any = await cooldownRes.json();
    assert.equal(cooldownBody.action, 'cooldown');
    assert.equal(cooldownBody.cooldownReason, 'recently_started');

    // Empty brief session (<5 min, 0% added) stopped after cooldown is cancelled/deleted cleanly
    await kv.put(
      `d1_fallback:active_charging_session:${TEST_VIN}`,
      JSON.stringify({
        id: 'chg_noise_1',
        vin: TEST_VIN,
        status: 'ongoing',
        start_time: nowSec - 90,
        start_soc: 70,
        end_soc: 70,
        energy_used_kwh: 0.05,
        active_duration_seconds: 90,
      })
    );
    const cancelRes = await worker.fetch(
      new Request(`https://example.workers.dev/api/charging/toggle?key=${webhookKey}&format=json`),
      env
    );
    assert.equal(cancelRes.status, 200);
    const cancelBody: any = await cancelRes.json();
    assert.equal(cancelBody.success, true);
    assert.equal(cancelBody.cancelled, true);
    assert.equal(await kv.get(`d1_fallback:active_charging_session:${TEST_VIN}`, 'json'), null);
  });
});
