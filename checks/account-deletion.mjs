/**
 * Account deletion regression checks against actual source with an isolated DB mock.
 * Run: node checks/account-deletion.mjs
 * No credentials, environment files, database endpoints or network are loaded.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as crypto from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const ts = createRequire(path.join(root, 'package.json'))('typescript');
const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let passed = 0;

function load(relative, imports, extra = {}) {
  const filename = path.join(root, relative), module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Error,
    require(id) { if (!(id in imports)) throw new Error(`Unexpected import ${id}`); return imports[id]; },
    fetch() { throw new Error('Network disabled'); }, console: { error() {} }, ...extra,
  }, { filename });
  return module.exports;
}

const normal = {
  membership: { data: [{ id: 'member-1', team_id: 'team-1' }, { id: 'member-2', team_id: 'team-2' }], count: 2, error: null },
  ownership: { data: [{ id: 'team-1', name: 'Fixture one' }, { id: 'team-2', name: 'Fixture two' }], count: 2, error: null },
  'others:team-1': { data: null, count: 0, error: null },
  'others:team-2': { data: null, count: 0, error: null },
  'book:team-1': { data: { id: 'book-1' }, error: null },
  'book:team-2': { data: { id: 'book-2' }, error: null },
  entries: { data: null, count: 3, error: null },
};
const deletionOrder = ['apple', 'rpc', 'storage', 'auth'].map(stage => `${stage}:${userId}`);

function fixture({ reads = {}, deletionFailure, throws = false, remainingMembers = [], rpcResult, appleStatus = 'not_required', imageReadinessFailure = false } = {}) {
  const mutations = [], queries = [], lifecycle = [];
  const answers = { ...normal, ...reads };
  function mutate(key) {
    mutations.push(key);
    if (key === deletionFailure) {
      if (throws) throw new Error('fixture transport failure');
      return { data: null, error: { message: 'fixture returned failure' } };
    }
    if (key === `rpc:${userId}`) for (const member of remainingMembers) if (member.user_id === userId) {
      member.active = false; member.user_id = null; member.account_deleted_at = '2026-09-15T00:00:00Z';
      member.display_name = '탈퇴한 팀원'; member.bank = null; member.account_no = null;
    }
    return { data: null, error: null };
  }
  const db = {
    async rpc(name, args) {
      assert.equal(name, 'wipe_account_data'); assert.equal(args.p_user_id, userId);
      const answer = mutate(`rpc:${args.p_user_id}`);
      return { ...answer, data: answer.error ? null : rpcResult === undefined ? answers.ownership.data.length : rpcResult };
    },
    from(table) {
      const request = { table, filters: [], options: null, columns: '', deleting: false, updating: false, limit: undefined };
      const builder = {
        select(columns, options) { request.columns = columns; request.options = options; return builder; },
        eq(column, value) { request.filters.push(['eq', column, value]); return builder; },
        neq(column, value) { request.filters.push(['neq', column, value]); return builder; },
        not(column, op, value) { request.filters.push(['not', column, op, value]); return builder; },
        in(column, value) { request.filters.push(['in', column, value]); return builder; },
        limit(value) { request.limit = value; return builder; },
        maybeSingle() { return builder; },
        delete() { request.deleting = true; return builder; },
        update(value) {
          assert.equal(table, 'members'); assert.equal(value.active, false); assert.deepEqual(Object.keys(value), ['active']);
          request.updating = true; return builder;
        },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            if (request.deleting || request.updating) {
              if (request.updating) assert.deepEqual(request.filters, [['eq', 'user_id', userId]]);
              return mutate(`${table}:${request.filters[0][2]}`);
            }
            queries.push(request);
            const team = request.filters.find(([op, column]) => op === 'eq' && column === 'team_id')?.[2];
            const key = table === 'members' ? request.options?.head ? `others:${team}` : 'membership'
              : table === 'teams' ? 'ownership' : table === 'ledgers' ? `book:${team}` : table === 'expenses' ? 'entries' : null;
            assert.ok(key in answers, `Unexpected query ${key}`);
            const response = answers[key];
            if (response instanceof Error) throw response;
            // PostgREST provides no exact total unless the request asks for it.
            return { ...response, count: request.options?.count === 'exact' ? response.count : null };
          }).then(resolve, reject);
        },
      };
      return builder;
    },
    auth: { admin: { async deleteUser(id) { return mutate(`auth:${id}`); } } },
  };
  const account = load('lib/db/account.ts', { 'server-only': {}, './client.ts': { db },
    './images.ts': { assertAccountImageCleanupReady: async () => { if (imageReadinessFailure) throw new Error('fixture image migration unavailable'); },
      cleanupAccountImages: async id => { const result = mutate(`storage:${id}`); if (result.error) throw new Error('fixture Storage failure'); } },
    '../mobile/apple.ts': { async revokeAppleForAccountDeletion(id) {
      const result = mutate(`apple:${id}`); if (result.error) throw new Error('fixture Apple failure');
      return { status: appleStatus };
    } },
  });
  const access = { AccessError: class extends Error {}, requireUser: async () => ({ id: userId }), clearPass: async () => lifecycle.push('clearPass') };
  const { failed } = load('lib/fail.ts', { 'server-only': {}, './access.ts': access });
  const actions = load('app/actions/account.ts', {
    'next/cache': { revalidatePath: () => lifecycle.push('revalidate') },
    '../../lib/access.ts': access, '../../lib/db/account.ts': account, '../../lib/fail.ts': { failed },
  });
  return { ...account, withdraw: () => actions.withdraw(userId), withdrawAs: actions.withdraw, mutations, queries, lifecycle };
}

async function check(label, run) { await run(); passed++; console.log(`PASS ${label}`); }

await check('complete lookup preserves ownership, membership and entry facts', async () => {
  const f = fixture(), facts = await f.accountFacts(userId);
  assert.equal(facts.teams, 2); assert.equal(facts.entries, 3);
  assert.equal(facts.owned.length, 2); assert.equal(facts.owned[0].ledgerId, 'book-1');
  assert.deepEqual(f.mutations, []);
});
await check('normal deletion completes every stage before reporting success', async () => {
  const f = fixture(), result = await f.withdraw();
  assert.equal(result.ok, true); assert.equal(result.value.done, true); assert.equal(result.value.removedBooks, 2);
  assert.deepEqual(f.mutations, deletionOrder);
  assert.deepEqual(f.lifecycle, ['clearPass', 'revalidate']);
});
for (const expectedUserId of [undefined, null, 42, {}, '', 'fixture-user', `${userId} `,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', userId.toUpperCase()]) {
  await check(`unconfirmed or different displayed account (${String(expectedUserId)}) cannot delete the current account`, async () => {
    const f = fixture(), result = await f.withdrawAs(expectedUserId);
    assert.equal(result.ok, false); assert.match(result.message, /계정 화면을 새로/);
    assert.deepEqual(f.mutations, []); assert.deepEqual(f.queries, []); assert.deepEqual(f.lifecycle, []);
  });
}
await check('shared owned team blocks all deletion, including otherwise-alone teams', async () => {
  const f = fixture({ reads: { 'others:team-2': { count: 1, data: null, error: null } } });
  const result = await f.withdraw();
  assert.equal(result.ok, true); assert.equal(result.value.done, false); assert.equal(result.value.blocked[0].teamId, 'team-2');
  assert.deepEqual(f.mutations, []); assert.deepEqual(f.lifecycle, []);
});

for (const key of ['membership', 'ownership']) {
  const cases = {
    'returned error': { ...normal[key], error: { message: 'fixture failed read' } },
    'null exact count': { ...normal[key], count: null },
    'truncated result': { ...normal[key], count: 1001 },
    'null rows': { data: null, count: 0, error: null },
    'fractional count': { ...normal[key], count: 2.5 },
    'negative count': { data: [], count: -1, error: null },
    'transport rejection': new Error('fixture transport read failure'),
  };
  for (const [issue, answer] of Object.entries(cases)) await check(`${key}: ${issue} causes zero deletes`, async () => {
    const f = fixture({ reads: { [key]: answer } });
    await assert.rejects(() => f.accountFacts(userId));
    const result = await f.withdraw();
    assert.equal(result.ok, false); assert.deepEqual(f.mutations, []); assert.deepEqual(f.lifecycle, []);
  });
}
for (const key of ['others:team-1', 'others:team-2', 'entries']) {
  for (const [issue, answer] of Object.entries({
    'returned error': { data: null, count: 0, error: { message: 'fixture count failed' } },
    'null count': { data: null, count: null, error: null },
    'negative count': { data: null, count: -1, error: null },
    'fractional count': { data: null, count: 0.5, error: null },
  })) await check(`${key}: ${issue} causes zero deletes`, async () => {
    const f = fixture({ reads: { [key]: answer } });
    const result = await f.withdraw();
    assert.equal(result.ok, false); assert.match(result.message, /계정 정보를 확인하지 못했습니다/);
    assert.deepEqual(f.mutations, []); assert.deepEqual(f.lifecycle, []);
  });
}
await check('representative ledger query failure causes zero deletes', async () => {
  const f = fixture({ reads: { 'book:team-1': { data: null, error: { message: 'fixture failed ledger' } } } });
  assert.equal((await f.withdraw()).ok, false); assert.deepEqual(f.mutations, []); assert.deepEqual(f.lifecycle, []);
});
await check('legitimate zero counts and a team without a ledger remain valid', async () => {
  const f = fixture({ reads: { entries: { data: null, count: 0, error: null }, 'book:team-1': { data: null, error: null } } });
  const facts = await f.accountFacts(userId);
  assert.equal(facts.entries, 0); assert.equal(facts.owned[0].ledgerId, null);
  assert.equal((await f.wipeAccount(userId)).ok, true);
});
await check('empty account still removes invites, profile and authentication account', async () => {
  const f = fixture({ reads: { membership: { data: [], count: 0, error: null }, ownership: { data: [], count: 0, error: null } } });
  const facts = await f.accountFacts(userId);
  assert.equal(facts.teams, 0); assert.equal(facts.entries, 0); assert.equal(facts.owned.length, 0);
  const result = await f.wipeAccount(userId);
  assert.equal(result.ok, true); assert.equal(result.removedBooks, 0);
  assert.deepEqual(f.mutations, deletionOrder);
});

for (const deletionFailure of deletionOrder) for (const throws of [false, true]) {
  await check(`${deletionFailure}: ${throws ? 'transport rejection' : 'returned error'} stops subsequent stages and cannot report success`, async () => {
    const f = fixture({ deletionFailure, throws }), result = await f.withdraw();
    assert.equal(result.ok, false);
    assert.deepEqual(f.mutations, deletionOrder.slice(0, deletionOrder.indexOf(deletionFailure) + 1));
    assert.deepEqual(f.lifecycle, []);
  });
}

await check('retained shared membership cannot revive an older signed guest cookie after profile deletion', async () => {
  assert.match(fs.readFileSync(path.join(root, 'supabase/migrations/0001_schema.sql'), 'utf8'),
    /user_id\s+uuid references public\.profiles \(id\) on delete set null/);
  const member = { id: 'retained-member', team_id: 'shared-team', display_name: 'Fixture name', active: true,
    user_id: userId, account_deleted_at: null, bank: 'Fixture bank', account_no: '000-fixture' };
  const otherAccount = { active: true, user_id: 'someone-else' }, unclaimed = { active: true, user_id: null };
  const jarValues = new Map();
  const jar = { get: key => jarValues.has(key) ? { value: jarValues.get(key) } : undefined,
    set: (key, value) => jarValues.set(key, value), delete: key => jarValues.delete(key) };
  const policy = load('lib/mobile/auth-policy.ts', {});
  const access = load('lib/access.ts', {
    'server-only': {}, 'next/headers': { cookies: async () => jar }, 'node:crypto': crypto,
    './auth-client.ts': { currentUser: async () => null }, './mobile/auth-policy.ts': policy,
    './db/client.ts': { db: { from(table) {
      const builder = { select: () => builder, eq: () => builder, maybeSingle: async () => ({ error: null,
        data: table === 'ledgers' ? { id: 'shared-book', team_id: 'shared-team' } : { ...member } }) };
      return builder;
    } } },
  }, { Buffer, process: { env: { LEDGER_COOKIE_SECRET: 'fixture-only-cookie-key-at-least-32-chars', NODE_ENV: 'test' } } });
  await access.issuePass({ teamId: 'shared-team', memberId: member.id, memberName: member.display_name });
  await assert.rejects(() => access.requireLedgerAccess('shared-book'), /접근할 권한/);
  // Control: the old profile-only deletion really does revive the same signed cookie.
  member.user_id = null;
  assert.equal((await access.requireLedgerAccess('shared-book')).memberId, member.id);
  member.user_id = userId;
  const f = fixture({ remainingMembers: [member, otherAccount, unclaimed], reads: {
    membership: { data: [...normal.membership.data, { id: member.id, team_id: member.team_id }], count: 3, error: null },
  } });
  assert.equal((await f.wipeAccount(userId)).ok, true);
  assert.equal(member.user_id, null); assert.equal(member.active, false);
  assert.equal(member.display_name, '탈퇴한 팀원');
  assert.equal(member.bank, null); assert.equal(member.account_no, null);
  assert.equal(otherAccount.active, true); assert.equal(otherAccount.user_id, 'someone-else');
  assert.equal(unclaimed.active, true); assert.equal(unclaimed.user_id, null);
  await assert.rejects(() => access.requireLedgerAccess('shared-book'), /접근할 권한/);
  member.active = true; // Even an inconsistent row from a mock must not restore access.
  await assert.rejects(() => access.requireLedgerAccess('shared-book'), /접근할 권한/);
});
await check('DB transaction failure prevents profile FK nulling and auth deletion', async () => {
  const member = { active: true, user_id: userId };
  const f = fixture({ deletionFailure: `rpc:${userId}`, remainingMembers: [member] });
  assert.equal((await f.withdraw()).ok, false);
  assert.equal(member.user_id, userId); assert.equal(member.active, true);
  assert.ok(!f.mutations.some(key => key.startsWith('profiles:') || key.startsWith('auth:')));
});
for (const value of [null, -1, 0.5, '2', Number.MAX_SAFE_INTEGER + 1]) await check(`invalid RPC result ${value} never deletes Auth`, async () => {
  const f = fixture({ rpcResult: value });
  assert.equal((await f.withdraw()).ok, false);
  assert.deepEqual(f.mutations, deletionOrder.slice(0, 2)); assert.deepEqual(f.lifecycle, []);
});
for (const appleStatus of ['not_required', 'revoked', 'manual_required']) await check(`Apple result ${appleStatus} is preserved`, async () => {
  const result = await fixture({ appleStatus }).wipeAccount(userId);
  assert.equal(result.ok, true); assert.equal(result.appleCleanup, appleStatus);
});
await check('missing image-cleanup migration blocks before Apple or DB mutations', async () => {
  const f=fixture({imageReadinessFailure:true});assert.equal((await f.withdraw()).ok,false);assert.deepEqual(f.mutations,[]);
});
console.log(JSON.stringify({ passedScenarios: passed, actualSource: ['lib/db/account.ts', 'app/actions/account.ts', 'lib/fail.ts', 'lib/access.ts', 'lib/mobile/auth-policy.ts'], liveAccountDeletions: 0, networkRequests: 0 }));
