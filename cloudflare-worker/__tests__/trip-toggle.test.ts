import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TRIP_TOGGLE_COOLDOWN_SEC,
  TRIP_TOGGLE_IN_FLIGHT_TIMEOUT_SEC,
  buildTripToggleCooldownPayload,
  evaluateTripToggleDecision,
} from '../trip-toggle';
import { createEnvAuthKvStore, ensureWebhookKey } from '../multi-user-auth';
import worker from '../multi-worker';

class InMemoryTripKv {
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

describe('Trip Toggle State Machine (/api/trip/toggle)', () => {
  it('chooses start when no trip is ongoing and no recent lock exists', () => {
    const decision = evaluateTripToggleDecision({
      ongoingTrip: null,
      lockState: null,
      nowSec: 1_700_000_100,
    });
    assert.deepEqual(decision, { action: 'start' });
  });

  it('chooses stop when an ongoing trip started at least cooldownSec ago', () => {
    const ongoing = { id: 'trip_1', start_timestamp: 1_700_000_000, status: 'ongoing' };
    const decision = evaluateTripToggleDecision({
      ongoingTrip: ongoing,
      lockState: { status: 'done', ts: 1_700_000_000, action: 'start' },
      nowSec: 1_700_000_000 + TRIP_TOGGLE_COOLDOWN_SEC,
    });
    assert.deepEqual(decision, { action: 'stop', trip: ongoing });
  });

  it('blocks accidental immediate stop within double-tap window after start', () => {
    const ongoing = { id: 'trip_1', start_timestamp: 1_700_000_000, status: 'ongoing' };
    const decision = evaluateTripToggleDecision({
      ongoingTrip: ongoing,
      lockState: { status: 'done', ts: 1_700_000_000, action: 'start' },
      nowSec: 1_700_000_003,
    });
    assert.equal(decision.action, 'cooldown');
    if (decision.action === 'cooldown') {
      assert.equal(decision.reason, 'recently_started');
      assert.equal(decision.remainingSec, TRIP_TOGGLE_COOLDOWN_SEC - 3);
      const payload = buildTripToggleCooldownPayload(decision);
      assert.match(payload.title, /Already Started/);
      assert.match(payload.message, /Double-tap protection/);
    }
  });

  it('blocks accidental ghost start within double-tap window after stop', () => {
    const decision = evaluateTripToggleDecision({
      ongoingTrip: null,
      lockState: { status: 'done', ts: 1_700_000_100, action: 'stop' },
      nowSec: 1_700_000_104,
    });
    assert.equal(decision.action, 'cooldown');
    if (decision.action === 'cooldown') {
      assert.equal(decision.reason, 'recently_stopped');
      assert.equal(decision.remainingSec, TRIP_TOGGLE_COOLDOWN_SEC - 4);
      const payload = buildTripToggleCooldownPayload(decision);
      assert.match(payload.title, /Just Completed/);
    }
  });

  it('allows starting again once cooldownSec has elapsed after stop', () => {
    const decision = evaluateTripToggleDecision({
      ongoingTrip: null,
      lockState: { status: 'done', ts: 1_700_000_100, action: 'stop' },
      nowSec: 1_700_000_100 + TRIP_TOGGLE_COOLDOWN_SEC,
    });
    assert.deepEqual(decision, { action: 'start' });
  });

  it('blocks concurrent NFC tap while another toggle is in_flight and recovers after timeout', () => {
    const locked = evaluateTripToggleDecision({
      ongoingTrip: null,
      lockState: { status: 'in_flight', ts: 1_700_000_200, action: 'start' },
      nowSec: 1_700_000_202,
    });
    assert.equal(locked.action, 'cooldown');
    if (locked.action === 'cooldown') {
      assert.equal(locked.reason, 'in_flight');
      assert.equal(locked.remainingSec, TRIP_TOGGLE_IN_FLIGHT_TIMEOUT_SEC - 2);
      const payload = buildTripToggleCooldownPayload(locked);
      assert.match(payload.title, /Sync In Progress/);
    }

    const recovered = evaluateTripToggleDecision({
      ongoingTrip: null,
      lockState: { status: 'in_flight', ts: 1_700_000_200, action: 'start' },
      nowSec: 1_700_000_200 + TRIP_TOGGLE_IN_FLIGHT_TIMEOUT_SEC,
    });
    assert.deepEqual(recovered, { action: 'start' });
  });
});

describe('Worker /api/trip/toggle Endpoint Routing & Preserved Start/Stop Endpoints', () => {
  const ADMIN_PHONE = '919876543210';
  const TEST_VIN = 'LSGWT000000000001';

  it('rejects missing or invalid webhook key with 401 in both text and json formats', async () => {
    const kv = new InMemoryTripKv();
    const env: any = { TRIP_KV: kv, ADMIN_PHONE };

    const textRes = await worker.fetch(
      new Request('https://example.workers.dev/api/trip/toggle?key=wk_invalid&format=text'),
      env
    );
    assert.equal(textRes.status, 401);
    const textBody = await textRes.text();
    assert.ok(textBody.startsWith('❌'));

    const jsonRes = await worker.fetch(
      new Request('https://example.workers.dev/api/trip/toggle?format=json'),
      env
    );
    assert.equal(jsonRes.status, 401);
    const jsonBody: any = await jsonRes.json();
    assert.equal(jsonBody.success, false);
  });

  it('stops an active trip on /api/trip/toggle, enforces post-stop cooldown, and preserves /api/trip/stop', async () => {
    const kv = new InMemoryTripKv();
    const env: any = { TRIP_KV: kv, ADMIN_PHONE };
    const authStore = createEnvAuthKvStore(env);
    const webhookKey = await ensureWebhookKey(authStore, TEST_VIN, ADMIN_PHONE);

    const nowSec = Math.floor(Date.now() / 1000);
    const ongoingTrip = {
      id: 'trip_active_1',
      vin: TEST_VIN,
      date: '2026-11-15',
      start_timestamp: nowSec - 120,
      start_odometer_km: 39300,
      start_soc: 80,
      status: 'ongoing',
    };
    await kv.put(`d1_fallback:trips`, JSON.stringify([ongoingTrip]));
    await kv.put(`d1_fallback:active_trip:${TEST_VIN}`, JSON.stringify(ongoingTrip));

    // Existing /api/trip/stop with no ongoing trip after toggle stops it must keep its exact behavior,
    // so first tap /api/trip/toggle to stop this active trip (no MG session -> stationary cleanup path):
    const stopRes = await worker.fetch(
      new Request(`https://example.workers.dev/api/trip/toggle?key=${webhookKey}&format=json`),
      env
    );
    assert.equal(stopRes.status, 200);
    const stopJson: any = await stopRes.json();
    assert.equal(stopJson.success, true);
    assert.equal(stopJson.action, 'stop');
    assert.equal(stopJson.cancelled, true);

    // Active trip must now be cleared
    assert.equal(await kv.get(`d1_fallback:active_trip:${TEST_VIN}`, 'json'), null);

    // Immediate double-tap right after stop triggers cooldown instead of starting a ghost trip
    const bounceRes = await worker.fetch(
      new Request(`https://example.workers.dev/api/trip/toggle?key=${webhookKey}&format=json`),
      env
    );
    assert.equal(bounceRes.status, 200);
    const bounceJson: any = await bounceRes.json();
    assert.equal(bounceJson.action, 'cooldown');
    assert.equal(bounceJson.cooldownReason, 'recently_stopped');

    // Preserved /api/trip/stop endpoint still returns its original 'No Active Trip' payload
    const legacyStopRes = await worker.fetch(
      new Request(`https://example.workers.dev/api/trip/stop?key=${webhookKey}&format=json`),
      env
    );
    assert.equal(legacyStopRes.status, 200);
    const legacyStopJson: any = await legacyStopRes.json();
    assert.equal(legacyStopJson.success, false);
    assert.match(legacyStopJson.title, /No Active Trip/);
  });

  it('guards against stopping a trip started <10s ago and clears failed start locks for immediate retry', async () => {
    const kv = new InMemoryTripKv();
    const env: any = { TRIP_KV: kv, ADMIN_PHONE };
    const authStore = createEnvAuthKvStore(env);
    const webhookKey = await ensureWebhookKey(authStore, TEST_VIN, ADMIN_PHONE);

    const nowSec = Math.floor(Date.now() / 1000);
    await kv.put(
      `d1_fallback:active_trip:${TEST_VIN}`,
      JSON.stringify({
        id: 'trip_fresh_1',
        vin: TEST_VIN,
        date: '2026-11-15',
        start_timestamp: nowSec - 2,
        start_odometer_km: 39300,
        start_soc: 80,
        status: 'ongoing',
      })
    );

    const cooldownRes = await worker.fetch(
      new Request(`https://example.workers.dev/api/trip/toggle?key=${webhookKey}&format=text`),
      env
    );
    assert.equal(cooldownRes.status, 200);
    const cooldownText = await cooldownRes.text();
    assert.match(cooldownText, /Trip Already Started/);
    // Ongoing trip remains intact
    assert.notEqual(await kv.get(`d1_fallback:active_trip:${TEST_VIN}`, 'json'), null);

    // When idle and MG session is missing, /api/trip/toggle returns 401 and clears the in_flight lock
    await kv.delete(`d1_fallback:active_trip:${TEST_VIN}`);
    const noSessionRes = await worker.fetch(
      new Request(`https://example.workers.dev/api/trip/toggle?key=${webhookKey}&format=json`),
      env
    );
    assert.equal(noSessionRes.status, 401);
    assert.equal(await kv.get(`trip_toggle_state:${TEST_VIN}`, 'json'), null);
  });
});
