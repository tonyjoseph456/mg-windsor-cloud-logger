import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEnvAuthKvStore, issueOrAdoptApiToken } from '../multi-user-auth';
import worker from '../multi-worker';

class InMemoryDeleteKv {
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

class InMemoryDeleteDb {
  public trips: any[] = [];
  public charges: any[] = [];
  public chargingSessions: any[] = [];
  public kv = new Map<string, string>();

  prepare(sql: string) {
    const db = this;
    const makeRunner = (args: any[]) => ({
      async run() {
        const q = sql.trim();
        if (q.startsWith('DELETE FROM trips WHERE id = ? AND vin = ?')) {
          const [id, vin] = args;
          db.trips = db.trips.filter((t) => !(String(t.id) === String(id) && String(t.vin) === String(vin)));
        } else if (q.startsWith('DELETE FROM charges WHERE id = ? AND vin = ?')) {
          const [id, vin] = args;
          db.charges = db.charges.filter((c) => !(String(c.id) === String(id) && String(c.vin) === String(vin)));
        } else if (q.startsWith('DELETE FROM charging_sessions WHERE id = ? AND vin = ?')) {
          const [id, vin] = args;
          db.chargingSessions = db.chargingSessions.filter(
            (c) => !(String(c.id) === String(id) && String(c.vin) === String(vin))
          );
        }
        return { success: true };
      },
      async first() {
        const res = await this.all();
        return res.results[0] || null;
      },
      async all() {
        const q = sql.trim();
        if (q.startsWith('SELECT * FROM trips WHERE vin = ?')) {
          const [vin] = args;
          return { results: db.trips.filter((t) => t.vin === vin) };
        }
        if (q.startsWith('SELECT DISTINCT date FROM trips WHERE vin = ?')) {
          const [vin] = args;
          const dates = Array.from(new Set(db.trips.filter((t) => t.vin === vin).map((t) => t.date)));
          return { results: dates.map((date) => ({ date })) };
        }
        if (q.startsWith('SELECT * FROM charging_sessions WHERE vin = ?')) {
          const [vin] = args;
          return { results: db.chargingSessions.filter((c) => c.vin === vin) };
        }
        if (q.startsWith('SELECT * FROM charges WHERE vin = ?')) {
          const [vin] = args;
          return { results: db.charges.filter((c) => c.vin === vin) };
        }
        if (q.startsWith('SELECT DISTINCT date FROM charging_sessions WHERE vin = ?')) {
          const [vin] = args;
          const dates = Array.from(new Set(db.chargingSessions.filter((c) => c.vin === vin).map((c) => c.date)));
          return { results: dates.map((date) => ({ date })) };
        }
        if (q.startsWith('SELECT DISTINCT date FROM charges WHERE vin = ?')) {
          const [vin] = args;
          const dates = Array.from(new Set(db.charges.filter((c) => c.vin === vin).map((c) => c.date)));
          return { results: dates.map((date) => ({ date })) };
        }
        return { results: [] };
      },
    });
    return {
      bind(...args: any[]) {
        return makeRunner(args);
      },
      ...makeRunner([]),
    };
  }

  async batch() {
    return [];
  }

  async exec() {
    return { count: 0, duration: 0 };
  }
}

describe('Permanent D1 + KV Deletion (/api/trips/delete & /api/charges/delete)', () => {
  const ADMIN_PHONE = '919744010098';
  const VIN_A = 'LSGWT000000000001';
  const VIN_B = 'LSGWT000000000002';

  it('deletes a trip from D1 + KV, updates distinct dates, and enforces VIN isolation', async () => {
    const kv = new InMemoryDeleteKv();
    const db = new InMemoryDeleteDb();
    const env: any = { DB: db, TRIP_KV: kv, ADMIN_PHONE };

    const authStore = createEnvAuthKvStore(env);
    const tokenA = await issueOrAdoptApiToken(authStore, { vin: VIN_A, phone: ADMIN_PHONE });

    const badTrip = {
      id: 'trip_bad_1',
      vin: VIN_A,
      date: '2026-11-14',
      start_timestamp: 1794650000,
      distance_km: 12.4,
      status: 'completed',
    };
    const keepTrip = {
      id: 'trip_good_2',
      vin: VIN_A,
      date: '2026-11-15',
      start_timestamp: 1794730000,
      distance_km: 24.8,
      status: 'completed',
    };
    const otherVinTrip = {
      id: 'trip_bad_1',
      vin: VIN_B,
      date: '2026-11-14',
      start_timestamp: 1794650000,
      distance_km: 18.0,
      status: 'completed',
    };

    db.trips.push(badTrip, keepTrip, otherVinTrip);
    await kv.put('d1_fallback:trips', JSON.stringify([badTrip, keepTrip, otherVinTrip]));
    await kv.put(`d1_fallback:active_trip:${VIN_A}`, JSON.stringify(badTrip));

    const delRes = await worker.fetch(
      new Request('https://example.workers.dev/api/trips/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenA}`,
        },
        body: JSON.stringify({ id: 'trip_bad_1', vin: VIN_A }),
      }),
      env
    );
    assert.equal(delRes.status, 200);
    const delJson: any = await delRes.json();
    assert.equal(delJson.success, true);

    // Remaining D1 trips for VIN_A must only have trip_good_2, while VIN_B stays untouched
    assert.deepEqual(
      db.trips.map((t) => `${t.vin}:${t.id}`),
      [`${VIN_A}:trip_good_2`, `${VIN_B}:trip_bad_1`]
    );
    assert.equal(await kv.get(`d1_fallback:active_trip:${VIN_A}`, 'json'), null);
    const kvTrips: any[] = await kv.get('d1_fallback:trips', 'json');
    assert.deepEqual(
      kvTrips.map((t) => `${t.vin}:${t.id}`),
      [`${VIN_A}:trip_good_2`, `${VIN_B}:trip_bad_1`]
    );

    const listRes = await worker.fetch(
      new Request('https://example.workers.dev/api/trips', {
        headers: { Authorization: `Bearer ${tokenA}` },
      }),
      env
    );
    const listJson: any = await listRes.json();
    assert.equal(listJson.trips.length, 1);
    assert.equal(listJson.trips[0].id, 'trip_good_2');

    const datesRes = await worker.fetch(
      new Request('https://example.workers.dev/api/trip/dates', {
        headers: { Authorization: `Bearer ${tokenA}` },
      }),
      env
    );
    const datesJson: any = await datesRes.json();
    assert.deepEqual(datesJson.dates, ['2026-11-15']);
  });

  it('deletes a charge from both charges & charging_sessions tables, clears KV fallbacks, and updates dates', async () => {
    const kv = new InMemoryDeleteKv();
    const db = new InMemoryDeleteDb();
    const env: any = { DB: db, TRIP_KV: kv, ADMIN_PHONE };

    const authStore = createEnvAuthKvStore(env);
    const tokenA = await issueOrAdoptApiToken(authStore, { vin: VIN_A, phone: ADMIN_PHONE });

    const badCharge = {
      id: 'chg_bad_1',
      vin: VIN_A,
      date: '2026-11-10',
      start_timestamp: 1794300000,
      start_time: 1794300000,
      start_soc: 45,
      end_soc: 45,
      kwh_added: 0,
      status: 'completed',
    };
    const keepCharge = {
      id: 'chg_good_2',
      vin: VIN_A,
      date: '2026-11-12',
      start_timestamp: 1794500000,
      start_time: 1794500000,
      start_soc: 20,
      end_soc: 90,
      kwh_added: 26.6,
      status: 'completed',
    };

    db.charges.push(badCharge, keepCharge);
    db.chargingSessions.push(badCharge, keepCharge);
    await kv.put('d1_fallback:charges', JSON.stringify([badCharge, keepCharge]));
    await kv.put(`d1_fallback:active_charge:${VIN_A}`, JSON.stringify(badCharge));
    await kv.put(`d1_fallback:active_charging_session:${VIN_A}`, JSON.stringify(badCharge));

    const delRes = await worker.fetch(
      new Request('https://example.workers.dev/api/charges/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenA}`,
        },
        body: JSON.stringify({ id: 'chg_bad_1', vin: VIN_A }),
      }),
      env
    );
    assert.equal(delRes.status, 200);
    const delJson: any = await delRes.json();
    assert.equal(delJson.success, true);

    assert.deepEqual(db.charges.map((c) => c.id), ['chg_good_2']);
    assert.deepEqual(db.chargingSessions.map((c) => c.id), ['chg_good_2']);
    assert.equal(await kv.get(`d1_fallback:active_charge:${VIN_A}`, 'json'), null);
    assert.equal(await kv.get(`d1_fallback:active_charging_session:${VIN_A}`, 'json'), null);

    const datesRes = await worker.fetch(
      new Request('https://example.workers.dev/api/charge/dates', {
        headers: { Authorization: `Bearer ${tokenA}` },
      }),
      env
    );
    const datesJson: any = await datesRes.json();
    assert.deepEqual(datesJson.dates, ['2026-11-12']);
  });
});
