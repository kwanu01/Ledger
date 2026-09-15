/** Actual web page, client confirmation and server action; isolated auth/React hooks, no network. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const ts = createRequire(path.join(root, 'package.json'))('typescript');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const jsx = (type, props, key) => ({ type, props, key }), runtime = { jsx, jsxs: jsx };
function load(relative, imports, extra = {}) {
  const module = { exports: {} }, filename = path.join(root, relative);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Error, process: { env: {} },
    require(id) { if (!(id in imports)) throw new Error(`Unexpected import ${id}`); return imports[id]; },
    fetch() { throw new Error('Network disabled'); }, ...extra,
  }, { filename });
  return module.exports;
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) {
    const result = find(child, predicate); if (result) return result;
  }
  return null;
}

let currentUser = A, release;
const deleted = [], calls = [], messages = [], navigation = [], lifecycle = [];
const action = load('app/actions/account.ts', {
  'next/cache': { revalidatePath() { lifecycle.push('revalidate'); } },
  '../../lib/access.ts': {
    async requireUser() { return { id: currentUser }; },
    async clearPass() { lifecycle.push('clearPass'); },
  },
  '../../lib/db/account.ts': { async wipeAccount(id) {
    deleted.push(id);
    if (release) await release.promise;
    return { ok: true, removedBooks: 0 };
  } },
  '../../lib/fail.ts': { failed(e) { return { ok: false, message: e.message }; } },
});

function client(accountId, request = id => action.withdraw(id)) {
  const slots = [], cleanups = [], transitions = [];
  let index = 0, effectsRun = false;
  const component = load('app/account/Withdraw.tsx', {
    'react/jsx-runtime': runtime,
    react: {
      useState(initial) { const key = index++; if (!(key in slots)) slots[key] = initial;
        return [slots[key], value => { slots[key] = typeof value === 'function' ? value(slots[key]) : value; }]; },
      useRef(initial) { const key = index++; return slots[key] ??= { current: initial }; },
      useEffect(effect) { if (!effectsRun) cleanups.push(effect()); },
      useTransition() { return [false, run => transitions.push(run())]; },
    },
    'next/link': 'Link', 'next/navigation': { useRouter: () => ({ replace: path => navigation.push(path) }) },
    '../actions/account.ts': { withdraw(id) { calls.push(id); return request(id); } },
    '../../lib/i18n.ts': { translator: () => key => key },
    '../helper/HelperContext.tsx': { useHelper: () => ({ say: text => messages.push(text) }) },
  }, { setTimeout: () => 1, clearTimeout() {} }).default;
  return {
    component,
    render() { index = 0; const tree = component({ accountId, lang: 'ko', blockedAtFirst: [] }); effectsRun = true; return tree; },
    async settle() { await Promise.all(transitions); },
    unmount() { for (const cleanup of cleanups) cleanup?.(); },
  };
}
function click(screen) {
  const button = find(screen.render(), node => node.type === 'button');
  assert.ok(button); button.props.onClick();
}

const stale = client(A);
click(stale); // A was shown when the first confirmation was made.
currentUser = B; // Another tab changes the shared authentication cookie.
click(stale);
await stale.settle();
assert.deepEqual(calls, [A]); assert.deepEqual(deleted, []); assert.deepEqual(lifecycle, []);
assert.match(messages.at(-1), /계정 화면을 새로/); assert.deepEqual(navigation, []);
stale.unmount();

const fresh = client(B);
click(fresh); click(fresh); await fresh.settle();
assert.deepEqual(deleted, [B]); assert.deepEqual(navigation, ['/']);
fresh.unmount();

let finish;
release = { promise: new Promise(resolve => { finish = resolve; }) };
const late = client(B);
const callsBeforePending = calls.length;
click(late); click(late);
click(late); click(late);
assert.equal(calls.length, callsBeforePending + 1);
await new Promise(resolve => setImmediate(resolve));
late.unmount();
const messagesBefore = messages.length, navigationBefore = navigation.length;
finish(); await late.settle();
assert.equal(messages.length, messagesBefore); assert.equal(navigation.length, navigationBefore);

const Withdraw = () => null;
const page = load('app/account/page.tsx', {
  'react/jsx-runtime': runtime, 'next/link': 'Link', 'next/navigation': { redirect() { assert.fail('Unexpected redirect'); } },
  '../../lib/lang.ts': { getLang: async () => 'ko' },
  '../../lib/auth-client.ts': { currentUser: async () => ({ id: A, displayName: 'Fixture', provider: 'email' }) },
  '../../lib/db/account.ts': { accountFacts: async () => ({ owned: [], teams: 0, entries: 0 }) },
  '../../lib/i18n.ts': { translator: () => key => key }, '../SignOut.tsx': 'SignOut', './Withdraw.tsx': { default: Withdraw },
}).default;
const tree = await page({ searchParams: Promise.resolve({}) });
const confirmation = find(tree, node => node.type === Withdraw);
assert.ok(confirmation); assert.equal(confirmation.props.accountId, A); assert.equal(confirmation.key, A);
// Malformed/missing confirmations must fail before any destructive step.
release = undefined;
const beforeInvalid = deleted.length;
for (const id of [undefined, null, '', 'bad-id', {}, A]) {
  const result = await action.withdraw(id);
  assert.equal(result.ok, false);
}
assert.equal(deleted.length, beforeInvalid);

// A transport rejection is an unknown outcome, not a successful deletion.
let transportAttempts = 0;
const transport = client(B, async () => {
  transportAttempts++;
  if (transportAttempts === 1) throw new Error('Fixture connection closed');
  return { ok: true, value: { done: true, removedBooks: 0 } };
});
const navBeforeTransport = navigation.length;
click(transport); click(transport); await transport.settle();
assert.match(messages.at(-1), /삭제 결과를 확인하지 못했습니다/);
assert.equal(navigation.length, navBeforeTransport);
assert.equal(transportAttempts, 1);
click(transport); click(transport); await transport.settle();
assert.equal(transportAttempts, 2, 'finally releases inFlight so a new confirmed attempt runs');
assert.equal(navigation.length, navBeforeTransport + 1);
transport.unmount();

let rejectLateTransport;
const lateTransport = client(B, () => new Promise((_, reject) => { rejectLateTransport = reject; }));
click(lateTransport); click(lateTransport);
const lateTransportMessages = messages.length, lateTransportNavigation = navigation.length;
lateTransport.unmount();
rejectLateTransport(new Error('Fixture late connection failure'));
await lateTransport.settle();
assert.equal(messages.length, lateTransportMessages);
assert.equal(navigation.length, lateTransportNavigation);

// Execute the actual repository against a conditional-write fixture.
const T = 'team-1';
let owner = A, readError = null, updateError = null, rows = 0;
const member = { user_id: B, active: true, team_id: T };
const db = { from(table) {
  const filters = [], request = { payload: null };
  const query = {
    select(columns) { assert.ok(!columns.includes('account_deleted_at')); return query; },
    eq(column, value) { filters.push([column, value]); return query; },
    update(payload) { request.payload = payload; return query; },
    async maybeSingle() {
      if (table === 'members') return { data: member, error: readError };
      assert.equal(table, 'teams');
      assert.deepEqual(filters, [['id', T], ['owner_id', A]]);
      if (updateError) return { data: null, error: updateError };
      if (owner !== A) return { data: null, error: null };
      owner = request.payload.owner_id; rows++;
      return { data: { id: T }, error: null };
    },
  };
  return query;
} };
const repo = load('lib/db/repo.ts', {
  'server-only': {}, react: { cache: fn => fn }, './client.ts': { db },
  './images.ts': {}, './mapping.ts': {}, '../domain/settlement.ts': {},
});
const pass = { teamId: T, memberId: 'owner-member', userId: A };
let allowed = true, handoffRevalidations = 0;
const teamActions = load('app/actions/teams.ts', {
  'next/cache': { revalidatePath() { handoffRevalidations++; } },
  'next/navigation': {}, '../../lib/access.ts': {
    requireLedgerAccess: async () => pass, isTeamOwner: async () => allowed,
  },
  '../../lib/auth-client.ts': {}, '../../lib/db/client.ts': { db },
  '../../lib/db/images.ts': {}, '../../lib/db/repo.ts': repo,
  '../../lib/domain/money.ts': {}, '../../lib/fail.ts': { failed: e => ({ok:false,message:e.message}) },
});
const handoff = () => teamActions.handOverOwnership({ ledgerId: 'ledger-1', memberId: 'next-member' });
owner = 'new-owner';
assert.equal((await handoff()).ok, false); assert.equal(rows, 0); assert.equal(handoffRevalidations, 0);
owner = A;
assert.equal((await handoff()).ok, true); assert.equal(owner, B); assert.equal(rows, 1);
owner = A; rows = 0;
const concurrent = await Promise.all([handoff(), handoff()]);
assert.equal(concurrent.filter(result => result.ok).length, 1); assert.equal(rows, 1);
owner = A; rows = 0; readError = { message: 'fixture read failure' };
assert.equal((await handoff()).ok, false); assert.equal(rows, 0); readError = null;
updateError = { message: 'fixture write failure' };
assert.equal((await handoff()).ok, false); assert.equal(rows, 0); updateError = null;
pass.userId = undefined;
assert.equal((await handoff()).ok, false); assert.equal(rows, 0);
console.log('PASS account A/B binding, invalid IDs, late UI response, rejected transport / retry / unmount, page key, CAS stale ownership, concurrent handoff, read/write failures and anonymous denial. Actual source; mock cookies/DB; no network or real deletions.');
