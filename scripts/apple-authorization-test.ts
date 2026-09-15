import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { generateKeyPair, exportPKCS8, jwtVerify, SignJWT } from 'jose';
import { appleConfig, createAppleClient, encryptAppleToken, decryptAppleToken, type AppleConfig } from '../lib/mobile/apple-crypto.ts';
import { createAppleAuthorizationService, type AppleGrant, type AppleGrantStore } from '../lib/mobile/apple.ts';

// Disposable cryptographic fixtures stay in memory. No Apple keys, accounts or network are used.
const developer = await generateKeyPair('ES256', { extractable: true });
const issuer = await generateKeyPair('RS256');
const fixtureConfig: AppleConfig = { clientId: 'net.teamledger.app', teamId: 'TESTTEAM01', keyId: 'TESTKEY001', privateKey: await exportPKCS8(developer.privateKey), activeKeyId: 'one', encryptionKeys: { one: randomBytes(32) } };
const makeToken = (claims: Record<string, unknown> = {}, audience = fixtureConfig.clientId, issuerUrl = 'https://appleid.apple.com') => new SignJWT({ sub: 'apple-user-a', ...claims })
  .setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(issuerUrl).setAudience(audience).setIssuedAt().setExpirationTime('5m').sign(issuer.privateKey);

test('server configuration fails closed; encryption binds ciphertext to account/grant and supports retained keys', () => {
  assert.throws(() => appleConfig({}), { code: 'APPLE_NOT_CONFIGURED' });
  const ciphertext = encryptAppleToken('fixture-refresh', 'account-a/grant-a', fixtureConfig);
  assert.equal(ciphertext.includes('fixture-refresh'), false);
  assert.equal(decryptAppleToken(ciphertext, 'account-a/grant-a', fixtureConfig), 'fixture-refresh');
  assert.throws(() => decryptAppleToken(ciphertext, 'account-b/grant-a', fixtureConfig), { code: 'APPLE_TOKEN_UNAVAILABLE' });
  const parts = ciphertext.split('.'); parts[4] = (parts[4][0] === 'a' ? 'b' : 'a') + parts[4].slice(1);
  assert.throws(() => decryptAppleToken(parts.join('.'), 'account-a/grant-a', fixtureConfig), { code: 'APPLE_TOKEN_UNAVAILABLE' });
  const rotated = { ...fixtureConfig, activeKeyId: 'two', encryptionKeys: { ...fixtureConfig.encryptionKeys, two: randomBytes(32) } };
  assert.equal(decryptAppleToken(ciphertext, 'account-a/grant-a', rotated), 'fixture-refresh');
  assert.match(encryptAppleToken('next-refresh', 'account-a/grant-b', rotated), /^v1\.two\./);
  assert.throws(() => decryptAppleToken(ciphertext, 'account-a/grant-a', { ...rotated, encryptionKeys: { two: rotated.encryptionKeys.two } }), { code: 'APPLE_TOKEN_UNAVAILABLE' });
});

test('Apple token transport validates JWT signature, issuer, audience and server-authenticated subject', async () => {
  let identity = await makeToken(), calls = 0;
  const client = createAppleClient(fixtureConfig, async (url, options) => {
    calls++;
    assert.equal(String(url), 'https://appleid.apple.com/auth/token');
    assert.equal(options?.redirect, 'error'); assert.equal(options?.credentials, 'omit');
    const form = new URLSearchParams(options?.body as URLSearchParams);
    assert.equal(form.get('client_id'), fixtureConfig.clientId);
    assert.equal(form.get('grant_type'), 'authorization_code');
    assert.equal(form.get('code'), 'fixture/code+1=', 'the opaque code survives form encoding unchanged');
    assert.equal(form.get('redirect_uri'), null, 'native authorization did not use a web redirect URI');
    const secret = await jwtVerify(form.get('client_secret')!, developer.publicKey, { algorithms: ['ES256'], issuer: fixtureConfig.teamId, audience: 'https://appleid.apple.com' });
    assert.equal(secret.payload.sub, fixtureConfig.clientId);
    assert.ok(secret.payload.exp! - secret.payload.iat! <= 300);
    return Response.json({ id_token: identity, refresh_token: 'fixture-refresh' });
  }, async () => issuer.publicKey);
  assert.deepEqual(await client.exchange('fixture/code+1=', ['apple-user-a']), { subject: 'apple-user-a', refreshToken: 'fixture-refresh' });
  await assert.rejects(() => client.exchange('fixture/code+1=', ['other-subject']), { code: 'APPLE_IDENTITY_MISMATCH' });
  identity = await makeToken({}, 'other.app');
  await assert.rejects(() => client.exchange('fixture/code+1=', ['apple-user-a']), { code: 'APPLE_IDENTITY_MISMATCH' });
  identity = await makeToken({}, fixtureConfig.clientId, 'https://wrong-issuer.test');
  await assert.rejects(() => client.exchange('fixture/code+1=', ['apple-user-a']), { code: 'APPLE_IDENTITY_MISMATCH' });
  identity = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJhcHBsZS11c2VyLWEifQ.';
  await assert.rejects(() => client.exchange('fixture/code+1=', ['apple-user-a']), { code: 'APPLE_IDENTITY_MISMATCH' });
  assert.equal(calls, 5);
});

test('revocation accepts only Apple 200, sends refresh-token hint, and does not expose already-invalid status', async () => {
  let status = 200;
  const client = createAppleClient(fixtureConfig, async (url, options) => {
    assert.equal(String(url), 'https://appleid.apple.com/auth/revoke');
    const form = new URLSearchParams(options?.body as URLSearchParams);
    assert.equal(form.get('token'), 'fixture-refresh'); assert.equal(form.get('token_type_hint'), 'refresh_token');
    return new Response('', { status });
  });
  assert.equal(await client.revoke('fixture-refresh'), undefined);
  assert.equal(await client.revoke('fixture-refresh'), undefined);
  status = 400;
  await assert.rejects(() => client.revoke('fixture-refresh'), { code: 'APPLE_REVOCATION_FAILED' });
  const offline = createAppleClient(fixtureConfig, async () => { throw new Error('offline'); });
  await assert.rejects(() => offline.revoke('fixture-refresh'), { code: 'APPLE_UNAVAILABLE' });
});

function fixture() {
  const grants: AppleGrant[] = [], hashes = new Map<string, AppleGrant>();
  let subjects = ['apple-user-a'], frozen = false, failSave = false, failRevoke = false, failMark = false, exchanges = 0, revokes = 0;
  const store: AppleGrantStore = {
    subjects: async () => subjects,
    reserve: async (userId, clientId, hash) => {
      if (frozen) throw new Error('deletion started');
      const existing = hashes.get(hash); if (existing) return { grant: existing, created: false };
      const grant: AppleGrant = { id: `grant-${grants.length}`, user_id: userId, client_id: clientId, apple_subject: null, state: 'pending', encrypted_token: null };
      hashes.set(hash, grant); grants.push(grant); return { grant, created: true };
    },
    save: async (grant, subject, encrypted) => { if (failSave) throw new Error('disk failed'); Object.assign(grant, { state: 'active', apple_subject: subject, encrypted_token: encrypted }); },
    uncertain: async grant => { if (grant.state === 'pending') grant.state = 'uncertain'; },
    freeze: async () => { frozen = true; return grants; },
    markRevoked: async grant => { if (failMark) throw new Error('database failed'); Object.assign(grant, { state: 'revoked', encrypted_token: null }); },
  };
  const service = createAppleAuthorizationService(store, () => fixtureConfig, () => ({
    exchange: async () => { exchanges++; return { subject: 'apple-user-a', refreshToken: `refresh-${exchanges}` }; },
    revoke: async token => { assert.match(token, /^refresh-/); revokes++; if (failRevoke) throw new Error('Apple unavailable'); },
  }));
  return { service, grants, counts: () => ({ exchanges, revokes }), subjects: (value: string[]) => { subjects = value; }, failSave: () => { failSave = true; }, failRevoke: () => { failRevoke = true; }, failMark: (value: boolean) => { failMark = value; } };
}
test('registration is idempotent by code hash, retains separate grants, and freezes new registrations during deletion', async () => {
  const f = fixture();
  await f.service.register('user-a', 'code-one'); await f.service.register('user-a', 'code-one'); await f.service.register('user-a', 'code-two');
  assert.equal(f.counts().exchanges, 2); assert.equal(f.grants.length, 2);
  assert.ok(f.grants.every(grant => grant.encrypted_token?.startsWith('v1.')));
  assert.deepEqual(await f.service.revoke('user-a'), { status: 'revoked' });
  assert.equal(f.counts().revokes, 2); assert.ok(f.grants.every(grant => grant.encrypted_token === null));
  await assert.rejects(() => f.service.register('user-a', 'code-three'), /deletion started/);
});
test('historical missing grants and lost exchanges produce manual cleanup, never a false automatic revoke', async () => {
  const historical = fixture(); assert.deepEqual(await historical.service.revoke('user-a'), { status: 'manual_required' });
  const other = fixture(); other.subjects([]); assert.deepEqual(await other.service.revoke('user-a'), { status: 'not_required' });
  const lost = fixture(); lost.failSave(); await assert.rejects(() => lost.service.register('user-a', 'code-one'), /disk failed/);
  assert.equal(lost.grants[0].state, 'uncertain'); assert.deepEqual(await lost.service.revoke('user-a'), { status: 'manual_required' });
  const unlinked = fixture(); unlinked.subjects([]); await assert.rejects(() => unlinked.service.register('user-a', 'code-one'), { code: 'APPLE_IDENTITY_REQUIRED' });
  assert.equal(unlinked.counts().exchanges, 0);
});
test('Apple or database failures retain recoverable ciphertext and cannot return deletion success', async () => {
  const f = fixture(); await f.service.register('user-a', 'code-one'); f.failRevoke();
  await assert.rejects(() => f.service.revoke('user-a'), /Apple unavailable/);
  assert.equal(f.grants[0].state, 'active'); assert.ok(f.grants[0].encrypted_token);
  const retry = fixture(); await retry.service.register('user-a', 'code-one'); retry.failMark(true);
  await assert.rejects(() => retry.service.revoke('user-a'), /database failed/);
  assert.equal(retry.grants[0].state, 'active'); retry.failMark(false);
  assert.deepEqual(await retry.service.revoke('user-a'), { status: 'revoked' }); assert.equal(retry.counts().revokes, 2);
});
