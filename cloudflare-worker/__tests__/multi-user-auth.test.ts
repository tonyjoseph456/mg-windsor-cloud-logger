import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AuthDbAdapter,
  AuthKvStore,
  ensureWebhookKey,
  issueOrAdoptApiToken,
  registerLicenseToken,
  requireScopedVin,
  resolveAppAuth,
  resolveWebhookAuth,
  revokeTokensForVin,
  verifyCarRegistrationCaller,
} from '../multi-user-auth';

class MemoryKvStore implements AuthKvStore {
  public readonly map = new Map<string, any>();

  async get(key: string): Promise<any | null> {
    return this.map.has(key) ? structuredClone(this.map.get(key)) : null;
  }

  async put(key: string, value: any): Promise<void> {
    this.map.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

class MemoryDb implements AuthDbAdapter {
  public readonly users = new Map<string, string>();

  async getUserStatus(phone: string): Promise<string | null> {
    return this.users.get(phone) ?? null;
  }
}

const ADMIN_PHONE = '9744010098';
const FRIEND_A_PHONE = '9811111111';
const FRIEND_B_PHONE = '9822222222';
const VIN_A = 'MZBWINDSORA000001';
const VIN_B = 'MZBWINDSORB000002';

const isMasterAdmin = (p: string) => p === ADMIN_PHONE || p.endsWith(ADMIN_PHONE);

describe('Multi-User Auth, Opaque Webhook Keys & Strict VIN Isolation', () => {
  it('requireScopedVin rejects blank values and normalizes non-empty VINs', () => {
    assert.equal(requireScopedVin(null), null);
    assert.equal(requireScopedVin(''), null);
    assert.equal(requireScopedVin('   '), null);
    assert.equal(requireScopedVin(' mzb123 '), 'MZB123');
  });

  it('isolates User A and User B D1 tokens and rejects cross-VIN access (403)', async () => {
    const store = new MemoryKvStore();
    const db = new MemoryDb();
    db.users.set(FRIEND_A_PHONE, 'active');
    db.users.set(FRIEND_B_PHONE, 'active');

    const tokenA = await issueOrAdoptApiToken(store, { vin: VIN_A, phone: FRIEND_A_PHONE, uid: 'uidA' });
    const tokenB = await issueOrAdoptApiToken(store, { vin: VIN_B, phone: FRIEND_B_PHONE, uid: 'uidB' });

    assert.notEqual(tokenA, tokenB);

    // User A reads own trips cleanly (even without passing ?vin=, it scopes strictly to VIN_A)
    const okReq = new Request('https://example.workers.dev/api/trips', {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const okRes = await resolveAppAuth(store, db, isMasterAdmin, okReq, new URL(okReq.url));
    assert.equal(okRes.ok, true);
    if (okRes.ok) {
      assert.equal(okRes.vin, VIN_A);
      assert.equal(okRes.phone, FRIEND_A_PHONE);
    }

    // User B tries to read/clear User A's VIN via ?vin=VIN_A -> must return 403
    const spoofReq = new Request(`https://example.workers.dev/api/trips/clear?vin=${VIN_A}`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    const spoofRes = await resolveAppAuth(store, db, isMasterAdmin, spoofReq, new URL(spoofReq.url));
    assert.equal(spoofRes.ok, false);
    if (!spoofRes.ok) {
      assert.equal(spoofRes.status, 403);
    }

    // Missing or bogus token -> must return 401
    const unauthReq = new Request(`https://example.workers.dev/api/trips?vin=${VIN_A}`);
    const unauthRes = await resolveAppAuth(store, db, isMasterAdmin, unauthReq, new URL(unauthReq.url));
    assert.equal(unauthRes.ok, false);
    if (!unauthRes.ok) {
      assert.equal(unauthRes.status, 401);
    }
  });

  it('enforces strict separation between webhookKey and apiToken', async () => {
    const store = new MemoryKvStore();
    const db = new MemoryDb();
    db.users.set(FRIEND_A_PHONE, 'active');

    const apiToken = await issueOrAdoptApiToken(store, { vin: VIN_A, phone: FRIEND_A_PHONE, uid: 'uidA' });
    const webhookKey = await ensureWebhookKey(store, VIN_A, FRIEND_A_PHONE);

    assert.ok(webhookKey.startsWith('wk_'));
    assert.ok(apiToken.startsWith('d1t_'));
    assert.notEqual(webhookKey, apiToken);

    // Leaked Siri/CarPlay ?key= must NOT authenticate D1 data endpoints
    const dataAttempt = new Request(`https://example.workers.dev/api/trips?key=${webhookKey}`, {
      headers: { Authorization: `Bearer ${webhookKey}` },
    });
    const dataAuth = await resolveAppAuth(store, db, isMasterAdmin, dataAttempt, new URL(dataAttempt.url));
    assert.equal(dataAuth.ok, false);

    // And D1 bearer token cannot be passed as a shortcut ?key=
    const hookAttempt = new Request(`https://example.workers.dev/api/command/unlock?key=${apiToken}&pin=1234`);
    const hookAuth = await resolveWebhookAuth(store, db, isMasterAdmin, hookAttempt, new URL(hookAttempt.url));
    assert.equal(hookAuth.ok, false);
    if (!hookAuth.ok) {
      assert.equal(hookAuth.status, 401);
    }

    // Valid webhook key resolves strictly to VIN_A without needing phone/vin/password in URL
    const validHook = new Request(`https://example.workers.dev/api/command/unlock?key=${webhookKey}&pin=1234`);
    const validAuth = await resolveWebhookAuth(store, db, isMasterAdmin, validHook, new URL(validHook.url));
    assert.equal(validAuth.ok, true);
    if (validAuth.ok) {
      assert.equal(validAuth.vin, VIN_A);
      assert.equal(validAuth.phone, FRIEND_A_PHONE);
    }
  });

  it('keeps webhookKey stable across normal calls and immediately invalidates old key on rotation', async () => {
    const store = new MemoryKvStore();
    const db = new MemoryDb();
    db.users.set(FRIEND_A_PHONE, 'active');

    const firstKey = await ensureWebhookKey(store, VIN_A, FRIEND_A_PHONE, false);
    const sameKey = await ensureWebhookKey(store, VIN_A, FRIEND_A_PHONE, false);
    assert.equal(firstKey, sameKey);

    const rotatedKey = await ensureWebhookKey(store, VIN_A, FRIEND_A_PHONE, true);
    assert.notEqual(rotatedKey, firstKey);
    assert.ok(rotatedKey.startsWith('wk_'));

    const oldReq = new Request(`https://example.workers.dev/api/trip/start?key=${firstKey}`);
    const oldRes = await resolveWebhookAuth(store, db, isMasterAdmin, oldReq, new URL(oldReq.url));
    assert.equal(oldRes.ok, false);

    const newReq = new Request(`https://example.workers.dev/api/trip/start?key=${rotatedKey}`);
    const newRes = await resolveWebhookAuth(store, db, isMasterAdmin, newReq, new URL(newReq.url));
    assert.equal(newRes.ok, true);
  });

  it('immediately revokes both D1 access and webhook shortcuts when a friend is blocked or deleted', async () => {
    const store = new MemoryKvStore();
    const db = new MemoryDb();
    db.users.set(FRIEND_A_PHONE, 'active');

    const apiToken = await issueOrAdoptApiToken(store, { vin: VIN_A, phone: FRIEND_A_PHONE, uid: 'uidA' });
    const webhookKey = await ensureWebhookKey(store, VIN_A, FRIEND_A_PHONE);

    // Block Friend A
    db.users.set(FRIEND_A_PHONE, 'blocked');
    const appReq = new Request('https://example.workers.dev/api/trips', {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    const blockedApp = await resolveAppAuth(store, db, isMasterAdmin, appReq, new URL(appReq.url));
    assert.equal(blockedApp.ok, false);
    if (!blockedApp.ok) assert.equal(blockedApp.status, 403);

    const hookReq = new Request(`https://example.workers.dev/api/trip/start?key=${webhookKey}`);
    const blockedHook = await resolveWebhookAuth(store, db, isMasterAdmin, hookReq, new URL(hookReq.url));
    assert.equal(blockedHook.ok, false);
    if (!blockedHook.ok) assert.equal(blockedHook.status, 403);

    // Delete Friend A from authorized_users
    db.users.delete(FRIEND_A_PHONE);
    const deletedApp = await resolveAppAuth(store, db, isMasterAdmin, appReq, new URL(appReq.url));
    assert.equal(deletedApp.ok, false);
    const deletedHook = await resolveWebhookAuth(store, db, isMasterAdmin, hookReq, new URL(hookReq.url));
    assert.equal(deletedHook.ok, false);
  });

  it('allows Master Admin even without an authorized_users row and blocks VIN hijacking on /api/register-car', async () => {
    const store = new MemoryKvStore();
    const db = new MemoryDb();
    db.users.set(FRIEND_B_PHONE, 'active');

    // Simulate Admin already registered VIN_A
    await store.put(`mg_session:${VIN_A}`, { uid: 'adminUid', token: 'mgTokAdmin', vin: VIN_A, phone: ADMIN_PHONE });

    // Legitimate Admin re-registration / upgrade succeeds
    const adminBody = {
      uid: 'adminUid',
      token: 'mgTokAdminNew',
      vin: VIN_A,
      phone: ADMIN_PHONE,
      licenseToken: `lic_${ADMIN_PHONE}_legacyhex1234`,
    };
    const adminReq = new Request('https://example.workers.dev/api/register-car', { method: 'POST' });
    const adminCheck = await verifyCarRegistrationCaller(store, db, isMasterAdmin, adminReq, adminBody);
    assert.equal(adminCheck.ok, true);

    const adoptedTok = await issueOrAdoptApiToken(store, {
      vin: VIN_A,
      phone: ADMIN_PHONE,
      uid: 'adminUid',
      candidateToken: adminBody.licenseToken,
    });
    assert.equal(adoptedTok, adminBody.licenseToken);

    // Friend B tries to hijack VIN_A by calling /api/register-car with their active account -> must return 403
    const hijackBody = {
      uid: 'uidB',
      token: 'mgTokB',
      vin: VIN_A,
      phone: FRIEND_B_PHONE,
    };
    const hijackCheck = await verifyCarRegistrationCaller(store, db, isMasterAdmin, adminReq, hijackBody);
    assert.equal(hijackCheck.ok, false);
    if (!hijackCheck.ok) {
      assert.equal(hijackCheck.status, 403);
    }
  });

  it('binds license tokens issued at consume-code time and revokes all VIN tokens on wipe', async () => {
    const store = new MemoryKvStore();
    const db = new MemoryDb();
    db.users.set(FRIEND_A_PHONE, 'active');

    const lic = `lic_${FRIEND_A_PHONE}_abc123def456`;
    await registerLicenseToken(store, { token: lic, phone: FRIEND_A_PHONE, vin: '' });

    // Complete registration with discovered VIN adopts the pre-registered license token
    const finalTok = await issueOrAdoptApiToken(store, {
      vin: VIN_A,
      phone: FRIEND_A_PHONE,
      uid: 'uidA',
      candidateToken: lic,
    });
    assert.equal(finalTok, lic);

    const wk = await ensureWebhookKey(store, VIN_A, FRIEND_A_PHONE);
    assert.ok(wk.startsWith('wk_'));

    // Wipe removes both API tokens and webhook keys for VIN_A
    await revokeTokensForVin(store, VIN_A);

    const appReq = new Request('https://example.workers.dev/api/trips', {
      headers: { Authorization: `Bearer ${finalTok}` },
    });
    const appRes = await resolveAppAuth(store, db, isMasterAdmin, appReq, new URL(appReq.url));
    assert.equal(appRes.ok, false);

    const hookReq = new Request(`https://example.workers.dev/api/trip/stop?key=${wk}`);
    const hookRes = await resolveWebhookAuth(store, db, isMasterAdmin, hookReq, new URL(hookReq.url));
    assert.equal(hookRes.ok, false);
  });
});
