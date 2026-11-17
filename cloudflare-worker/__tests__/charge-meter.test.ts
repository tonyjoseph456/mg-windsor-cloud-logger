import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeMeterEnergyKwh } from '../charging-sync';
import { createEnvAuthKvStore, issueOrAdoptApiToken } from '../multi-user-auth';
import worker from '../multi-worker';

class InMemoryMeterKv {
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

class InMemoryMeterDb {
  public charges: any[] = [];
  public chargingSessions: any[] = [];

  prepare(sql: string) {
    const db = this;
    const makeRunner = (args: any[]) => ({
      async run() {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (q.startsWith('UPDATE charging_sessions SET meter_energy_kwh = ? WHERE id = ? AND vin = ?')) {
          const [meter, id, vin] = args;
          for (const s of db.chargingSessions) {
            if (String(s.id) === String(id) && String(s.vin) === String(vin)) {
              s.meter_energy_kwh = meter;
            }
          }
        } else if (q.startsWith('UPDATE charges SET meter_energy_kwh = ? WHERE id = ? AND vin = ?')) {
          const [meter, id, vin] = args;
          for (const c of db.charges) {
            if (String(c.id) === String(id) && String(c.vin) === String(vin)) {
              c.meter_energy_kwh = meter;
            }
          }
        } else if (q.startsWith('INSERT INTO charging_sessions (')) {
          db.chargingSessions.push({
            id: args[0],
            vin: args[1],
            status: args[2],
            start_time: args[3],
            end_time: args[4],
            start_soc: args[5],
            end_soc: args[6],
            soc_added: args[7],
            kwh_added: args[8],
            energy_used_kwh: args[9],
            charging_loss_kwh: args[10],
            meter_energy_kwh: args[11],
            charge_type: args[12],
            peak_power_kw: args[13],
            last_power_kw: args[14],
            start_odometer_km: args[15],
            start_range_km: args[16],
            end_range_km: args[17],
            start_lat: args[18],
            start_lng: args[19],
            location: args[20],
            outage_count: args[21],
            paused_at: args[22],
            active_duration_seconds: args[23],
            last_poll_time: args[24],
            date: args[25],
          });
        }
        return { success: true };
      },
      async first() {
        const res = await this.all();
        return res.results[0] || null;
      },
      async all() {
        const q = sql.replace(/\s+/g, ' ').trim();
        if (q.startsWith('SELECT * FROM charging_sessions WHERE id = ? AND vin = ?')) {
          const [id, vin] = args;
          return {
            results: db.chargingSessions
              .filter((c) => String(c.id) === String(id) && String(c.vin) === String(vin))
              .map((c) => ({ ...c })),
          };
        }
        if (q.startsWith('SELECT * FROM charges WHERE id = ? AND vin = ?')) {
          const [id, vin] = args;
          return {
            results: db.charges
              .filter((c) => String(c.id) === String(id) && String(c.vin) === String(vin))
              .map((c) => ({ ...c })),
          };
        }
        if (q.startsWith('SELECT * FROM charging_sessions WHERE vin = ? ORDER BY start_time DESC')) {
          const [vin, limit] = args;
          return {
            results: db.chargingSessions
              .filter((c) => String(c.vin) === String(vin))
              .sort((a, b) => Number(b.start_time) - Number(a.start_time))
              .slice(0, Number(limit) || 50)
              .map((c) => ({ ...c })),
          };
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
}

describe('External Energy Meter D1 Endpoint (/api/charging/meter)', () => {
  const ADMIN_PHONE = '9744010098';
  const VIN_A = 'MCA1111111111111A';
  const VIN_B = 'MCA2222222222222B';

  it('sanitizeMeterEnergyKwh validates empty, valid decimals, and out-of-range values', () => {
    assert.equal(sanitizeMeterEnergyKwh(null), null);
    assert.equal(sanitizeMeterEnergyKwh(''), null);
    assert.equal(sanitizeMeterEnergyKwh('  '), null);
    assert.equal(sanitizeMeterEnergyKwh('39.436'), 39.44);
    assert.equal(sanitizeMeterEnergyKwh(39.4), 39.4);
    assert.equal(sanitizeMeterEnergyKwh(0), 'invalid');
    assert.equal(sanitizeMeterEnergyKwh(-5), 'invalid');
    assert.equal(sanitizeMeterEnergyKwh(501), 'invalid');
    assert.equal(sanitizeMeterEnergyKwh('abc'), 'invalid');
  });

  it('saves and clears meter_energy_kwh in D1 for owning VIN and isolates other VINs', async () => {
    const kv = new InMemoryMeterKv();
    const db = new InMemoryMeterDb();
    const env: any = { DB: db, TRIP_KV: kv, ADMIN_PHONE };
    const authStore = createEnvAuthKvStore(env);
    const tokenA = await issueOrAdoptApiToken(authStore, { vin: VIN_A, phone: ADMIN_PHONE });
    const tokenB = await issueOrAdoptApiToken(authStore, { vin: VIN_B, phone: ADMIN_PHONE });

    const sessionA = {
      id: 'chg_nov14_1',
      vin: VIN_A,
      date: '2026-11-14',
      status: 'completed',
      start_time: 1794670000,
      end_time: 1794713600,
      start_soc: 16,
      end_soc: 100,
      soc_added: 84,
      kwh_added: 31.92,
      energy_used_kwh: 36.7,
      charging_loss_kwh: 4.78,
      charge_type: 'AC',
      peak_power_kw: 3.3,
    };
    db.chargingSessions.push({ ...sessionA });
    db.charges.push({ ...sessionA });

    // Cross-VIN write attempt must fail with 404 without modifying VIN_A's row
    const blockedRes = await worker.fetch(
      new Request('https://example.workers.dev/api/charging/meter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenB}`,
        },
        body: JSON.stringify({ id: 'chg_nov14_1', vin: VIN_B, meterEnergyKwh: 39.4 }),
      }),
      env
    );
    assert.equal(blockedRes.status, 404);
    assert.equal(db.chargingSessions[0].meter_energy_kwh, undefined);

    // Invalid value rejected with 400
    const badRes = await worker.fetch(
      new Request('https://example.workers.dev/api/charging/meter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenA}`,
        },
        body: JSON.stringify({ id: 'chg_nov14_1', vin: VIN_A, meterEnergyKwh: -2 }),
      }),
      env
    );
    assert.equal(badRes.status, 400);

    // Valid meter reading persisted to charging_sessions & charges
    const saveRes = await worker.fetch(
      new Request('https://example.workers.dev/api/charging/meter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenA}`,
        },
        body: JSON.stringify({ id: 'chg_nov14_1', vin: VIN_A, meterEnergyKwh: 39.4 }),
      }),
      env
    );
    assert.equal(saveRes.status, 200);
    const saveJson: any = await saveRes.json();
    assert.equal(saveJson.success, true);
    assert.equal(saveJson.meterEnergyKwh, 39.4);
    assert.equal(db.chargingSessions[0].meter_energy_kwh, 39.4);
    assert.equal(db.charges[0].meter_energy_kwh, 39.4);

    // /api/charging-history returns meter_energy_kwh
    const histRes = await worker.fetch(
      new Request('https://example.workers.dev/api/charging-history', {
        headers: { Authorization: `Bearer ${tokenA}` },
      }),
      env
    );
    assert.equal(histRes.status, 200);
    const histJson: any = await histRes.json();
    assert.equal(histJson.sessions[0].meter_energy_kwh, 39.4);

    // Clearing via null restores null cleanly
    const clearRes = await worker.fetch(
      new Request('https://example.workers.dev/api/charging/meter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenA}`,
        },
        body: JSON.stringify({ id: 'chg_nov14_1', vin: VIN_A, meterEnergyKwh: null }),
      }),
      env
    );
    assert.equal(clearRes.status, 200);
    assert.equal(db.chargingSessions[0].meter_energy_kwh, null);
    assert.equal(db.charges[0].meter_energy_kwh, null);
  });

  it('upserts locally created sessions into charging_sessions when meter reading is saved', async () => {
    const kv = new InMemoryMeterKv();
    const db = new InMemoryMeterDb();
    const env: any = { DB: db, TRIP_KV: kv, ADMIN_PHONE };
    const authStore = createEnvAuthKvStore(env);
    const tokenA = await issueOrAdoptApiToken(authStore, { vin: VIN_A, phone: ADMIN_PHONE });

    const manualRes = await worker.fetch(
      new Request('https://example.workers.dev/api/charging/meter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenA}`,
        },
        body: JSON.stringify({
          id: 'chg-manual-1794670000',
          vin: VIN_A,
          meterEnergyKwh: 39.4,
          session: {
            id: 'chg-manual-1794670000',
            startTimestampSec: 1794670000,
            endTimestampSec: 1794713600,
            startSoc: 16,
            endSoc: 100,
            energyAddedToPackKwh: 31.92,
            energyConsumedKwh: 36.7,
            maxChargingSpeedKw: 3.3,
            status: 'completed',
          },
        }),
      }),
      env
    );
    assert.equal(manualRes.status, 200);
    assert.equal(db.chargingSessions.length, 1);
    assert.equal(db.chargingSessions[0].id, 'chg-manual-1794670000');
    assert.equal(db.chargingSessions[0].meter_energy_kwh, 39.4);
  });
});
