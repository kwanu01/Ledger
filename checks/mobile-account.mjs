/** Actual account routes and HTTP boundary, with isolated Auth/DB. No network. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const ts = createRequire(path.join(root, 'package.json'))('typescript');
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
let user = { id: A }, authCalls = 0, wipeCalls = [], factsCalls = [], nextResult, failure;
const facts = { owned: [], teams: 1, entries: 3 };
const cache = new Map();
function load(relative) {
  const file = path.resolve(root, relative);
  if (cache.has(file)) return cache.get(file);
  if (file === path.join(root, 'lib/db/account.ts')) return {
    accountFacts: async id => { factsCalls.push(id); return facts; },
    wipeAccount: async id => { wipeCalls.push(id); if (failure) throw new Error('private database detail'); return nextResult; },
  };
  if (file === path.join(root, 'lib/mobile/server.ts')) return {
    handleMobile: (request, run) => load('lib/mobile/http.ts').mobileHandler({
      authenticate: async () => { authCalls++; return user; }, run,
    })(request),
  };
  const module = { exports: {} };
  cache.set(file, module.exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Request, Response, Headers, URL, TextDecoder, Uint8Array,
    require(id) { assert.ok(id.startsWith('.'), `Unexpected dependency: ${id}`); return load(path.resolve(path.dirname(file), id)); },
    fetch() { throw new Error('Network disabled'); },
  }, { filename: file });
  return module.exports;
}
const details = load('app/api/mobile/v1/account/route.ts');
const deletion = load('app/api/mobile/v1/account/delete/route.ts');
function request({ body = { confirm: 'delete-account', expectedUserId: A }, bearer = 'Bearer fixture-token', origin, method = 'POST', contentType = 'application/json' } = {}) {
  const headers = {};
  if (bearer !== null) headers.authorization = bearer;
  if (origin) headers.origin = origin;
  if (contentType) headers['content-type'] = contentType;
  return new Request('https://teamledger.net/api/mobile/v1/account/delete', {
    method, headers, ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
}
let passed = 0;
async function check(name, fn) {
  user = { id: A }; authCalls = 0; wipeCalls = []; factsCalls = []; failure = false;
  nextResult = { ok: true, removedBooks: 1, appleCleanup: 'revoked' };
  await fn(); passed++; console.log('PASS ' + name);
}
await check('details uses authenticated ID and is read-only', async () => {
  const response = await details.GET(request({ method: 'GET' }));
  const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.accountId, A);
  assert.deepEqual(data.facts, facts); assert.deepEqual(factsCalls, [A]); assert.equal(wipeCalls.length, 0);
});
for (const bearer of [null, 'Basic fixture', 'Bearer']) await check('missing/malformed Bearer blocks all account work: ' + bearer, async () => {
  const response = await deletion.POST(request({ bearer, body: 'not-json' }));
  assert.equal(response.status, 401); assert.equal(authCalls, 0); assert.equal(wipeCalls.length, 0);
});
await check('invalid authenticated user cannot delete', async () => {
  user = null; assert.equal((await deletion.POST(request())).status, 401); assert.equal(wipeCalls.length, 0);
});
await check('preflight never authenticates or deletes', async () => {
  assert.equal((await deletion.OPTIONS(request({ method: 'OPTIONS', bearer: null, origin: 'http://localhost:8088' }))).status, 204);
  assert.equal(authCalls, 0); assert.equal(wipeCalls.length, 0);
});
await check('untrusted origin fails before authentication', async () => {
  assert.equal((await deletion.POST(request({ origin: 'https://untrusted.invalid' }))).status, 403);
  assert.equal(authCalls, 0); assert.equal(wipeCalls.length, 0);
});
for (const body of [{}, { confirm: 'delete-account' }, { confirm: 'no', expectedUserId: A }, { confirm: 'delete-account', expectedUserId: A, userId: B }, { confirm: 'delete-account', expectedUserId: 'invalid' }]) {
  await check('invalid confirmation/body never deletes: ' + JSON.stringify(body), async () => {
    assert.equal((await deletion.POST(request({ body }))).status, 400); assert.equal(wipeCalls.length, 0);
  });
}
await check('account switch between confirmation and dispatch is refused', async () => {
  user = { id: B };
  const response = await deletion.POST(request());
  assert.equal(response.status, 409); assert.equal((await response.json()).code, 'ACCOUNT_CHANGED'); assert.equal(wipeCalls.length, 0);
});
await check('malformed JSON is checked after authentication', async () => {
  assert.equal((await deletion.POST(request({ body: '{' }))).status, 400); assert.equal(authCalls, 1); assert.equal(wipeCalls.length, 0);
});
await check('form body cannot trigger deletion', async () => {
  assert.equal((await deletion.POST(request({ contentType: 'application/x-www-form-urlencoded' }))).status, 415); assert.equal(wipeCalls.length, 0);
});
await check('confirmed deletion uses only authenticated ID', async () => {
  const response = await deletion.POST(request());
  assert.equal(response.status, 200); assert.deepEqual(wipeCalls, [A]);
  assert.deepEqual((await response.json()).value, { done: true, removedBooks: 1, appleCleanup: 'revoked' });
  assert.match(response.headers.get('cache-control'), /no-store/);
});
await check('ownership block preserves unfinished result', async () => {
  nextResult = { ok: false, blocked: [{ teamId: 'fixture-team', teamName: 'Fixture', ledgerId: null, others: 1 }] };
  const response = await deletion.POST(request());
  assert.equal(response.status, 200); assert.equal((await response.json()).value.done, false);
});
await check('manual Apple cleanup is explicit after account deletion', async () => {
  nextResult = { ok: true, removedBooks: 0, appleCleanup: 'manual_required' };
  assert.equal((await (await deletion.POST(request())).json()).value.appleCleanup, 'manual_required');
});
await check('failure never reports deletion success or leaks DB details', async () => {
  failure = true;
  const response = await deletion.POST(request());
  assert.equal(response.status, 500); const data = await response.json();
  assert.equal(data.ok, false); assert.equal(data.value, undefined); assert.ok(!JSON.stringify(data).includes('private database detail'));
});
console.log(`${passed} mobile account route checks passed; no real accounts, databases, or network used.`);
