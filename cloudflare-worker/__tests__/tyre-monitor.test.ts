import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEnvAuthKvStore, issueOrAdoptApiToken } from '../multi-user-auth';
import worker, { runMorningTyreChecks } from '../multi-worker';

class InMemoryWorkerKv {
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

  async list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }> }> {
    const prefix = options?.prefix || '';
    const keys: Array<{ name: string }> = [];
    for (const k of this.map.keys()) {
      if (!prefix || k.startsWith(prefix)) keys.push({ name: k });
    }
    return { keys };
  }
}

const VIN_A = 'MZBWINDSORTYRE001';
const VIN_B = 'MZBWINDSORTYRE002';
const PHONE_A = '9811112222';
const PHONE_B = '9833334444';

async function seedUser(kv: InMemoryWorkerKv, vin: string, phone: string) {
  const env = { TRIP_KV: kv };
  const store = createEnvAuthKvStore(env);
  const token = await issueOrAdoptApiToken(store, { vin, phone, uid: `uid_${vin}` });
  await kv.put(
    `mg_session:${vin}`,
    JSON.stringify({ uid: `uid_${vin}`, token: `mg_tok_${vin}`, vin, phone })
  );
  await kv.put('mg_session_vins', JSON.stringify([VIN_A, VIN_B]));
  return { env, token };
}

describe('Tyre Pressure Monitor Worker APIs & 6:00 AM IST Cron', () => {
  it('enforces auth and VIN isolation on /api/tyres/monitor, /api/tyres/settings, and /api/tyres/morning-dismiss', async () => {
    const kv = new InMemoryWorkerKv();
    const { env, token: tokenA } = await seedUser(kv, VIN_A, PHONE_A);
    const { token: tokenB } = await seedUser(kv, VIN_B, PHONE_B);

    const unauth = await worker.fetch(
      new Request('https://example.workers.dev/api/tyres/monitor'),
      env
    );
    assert.equal(unauth.status, 401);

    const crossVin = await worker.fetch(
      new Request(`https://example.workers.dev/api/tyres/monitor?vin=${VIN_A}`, {
        headers: { Authorization: `Bearer ${tokenB}` },
      }),
      env
    );
    assert.equal(crossVin.status, 403);

    const saveResp = await worker.fetch(
      new Request('https://example.workers.dev/api/tyres/settings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dropThresholdPct: 3, morningCheckEnabled: true }),
      }),
      env
    );
    assert.equal(saveResp.status, 200);
    const savedJson: any = await saveResp.json();
    assert.equal(savedJson.settings.dropThresholdPct, 3);
    assert.equal(savedJson.settings.recommendedPsi, 36);

    const monResp = await worker.fetch(
      new Request('https://example.workers.dev/api/tyres/monitor', {
        headers: { Authorization: `Bearer ${tokenA}` },
      }),
      env
    );
    assert.equal(monResp.status, 200);
    const monJson: any = await monResp.json();
    assert.equal(monJson.vin, VIN_A);
    assert.equal(monJson.settings.dropThresholdPct, 3);
    assert.equal(monJson.morningCheck, null);
  });

  it('polls once at 06:00 IST, records alerts & notifications, and re-evaluates when threshold updates', async () => {
    const kv = new InMemoryWorkerKv();
    const { env, token: tokenA } = await seedUser(kv, VIN_A, PHONE_A);
    // Disable VIN_B so only VIN_A is polled
    await kv.put(
      `tyre_settings:${VIN_B}`,
      JSON.stringify({ morningCheckEnabled: false, dropThresholdPct: 5, recommendedPsi: 36 })
    );

    const sixAmIstSec = Math.floor(Date.UTC(2026, 10, 17, 0, 30, 0) / 1000);
    let fetchCalls = 0;

    // Outside window (05:55 IST) -> 0 polls
    const early = await runMorningTyreChecks(env, sixAmIstSec - 300, async () => {
      fetchCalls += 1;
      return {};
    });
    assert.equal(early.length, 0);
    assert.equal(fetchCalls, 0);

    // At 06:00 IST -> polls VIN_A once, records 34.0 PSI (5.6% below 36) as alert
    const atSix = await runMorningTyreChecks(env, sixAmIstSec, async (_client, vin) => {
      fetchCalls += 1;
      assert.equal(vin, VIN_A);
      return {
        status_time: sixAmIstSec - 15,
        last_can_activity: sixAmIstSec - 15,
        front_left_tyre_psi: 34.0,
        front_right_tyre_psi: 35.6,
        rear_left_tyre_psi: 35.4,
        rear_right_tyre_psi: 35.6,
      };
    });
    assert.equal(fetchCalls, 1);
    assert.equal(atSix.length, 1);
    assert.equal(atSix[0].outcome, 'alert');
    assert.equal(atSix[0].lowTyres[0].key, 'fl');

    const notifs = await kv.get('d1_fallback:notifications', 'json');
    assert.equal(Array.isArray(notifs), true);
    assert.equal(notifs[0].vin, VIN_A);
    assert.equal(notifs[0].type, 'tyre_morning_alert');

    // Second cron tick at 06:01 IST -> must NOT poll again same day
    const atSixOhOne = await runMorningTyreChecks(env, sixAmIstSec + 60, async () => {
      fetchCalls += 1;
      return {};
    });
    assert.equal(fetchCalls, 1);
    assert.equal(atSixOhOne.length, 0);

    // Dismiss alert via API
    const dismissRes = await worker.fetch(
      new Request('https://example.workers.dev/api/tyres/morning-dismiss', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenA}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dateIst: '2026-11-17' }),
      }),
      env
    );
    assert.equal(dismissRes.status, 200);
    const dismissJson: any = await dismissRes.json();
    assert.ok(dismissJson.morningCheck.dismissedAtSec > 0);
  });

  it('records asleep, stale, and session_expired cleanly without false Home alerts', async () => {
    const kv = new InMemoryWorkerKv();
    const { env } = await seedUser(kv, VIN_A, PHONE_A);
    await kv.put(
      `tyre_settings:${VIN_B}`,
      JSON.stringify({ morningCheckEnabled: false, dropThresholdPct: 5, recommendedPsi: 36 })
    );

    const day1 = Math.floor(Date.UTC(2026, 10, 18, 0, 30, 0) / 1000);
    const asleepRes = await runMorningTyreChecks(env, day1, async () => {
      throw new Error('Vehicle status was not ready after polling');
    });
    assert.equal(asleepRes[0].outcome, 'asleep');

    const day2 = Math.floor(Date.UTC(2026, 10, 19, 0, 30, 0) / 1000);
    const expiredRes = await runMorningTyreChecks(env, day2, async () => {
      throw new Error('MG_SESSION_EXPIRED');
    });
    assert.equal(expiredRes[0].outcome, 'session_expired');

    const day3 = Math.floor(Date.UTC(2026, 10, 20, 0, 30, 0) / 1000);
    const staleRes = await runMorningTyreChecks(env, day3, async () => ({
      status_time: day3 - 7200,
      front_left_tyre_psi: 32.0,
      front_right_tyre_psi: 35.0,
      rear_left_tyre_psi: 35.0,
      rear_right_tyre_psi: 35.0,
    }));
    assert.equal(staleRes[0].outcome, 'stale');
    assert.equal(staleRes[0].lowTyres.length, 0);

    // Deregister car wipes tyre keys cleanly
    const tokenA = await issueOrAdoptApiToken(createEnvAuthKvStore(env), {
      vin: VIN_A,
      phone: PHONE_A,
      uid: `uid_${VIN_A}`,
    });
    const wipeRes = await worker.fetch(
      new Request('https://example.workers.dev/api/deregister-car', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      env
    );
    assert.equal(wipeRes.status, 200);
    assert.equal(await kv.get(`tyre_morning_check:${VIN_A}`, 'json'), null);
    assert.equal(await kv.get(`tyre_settings:${VIN_A}`, 'json'), null);
  });
});
