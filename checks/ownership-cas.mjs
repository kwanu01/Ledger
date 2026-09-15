/** Actual ownership repository/action with isolated PostgREST semantics. No DB or network. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const ts = createRequire(path.join(root, 'package.json'))('typescript');
function load(file, imports) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Error, process: { env: {} },
    require(id) { if (!(id in imports)) throw new Error(`Unexpected import ${id}`); return imports[id]; },
    fetch() { throw new Error('Network disabled'); },
  });
  return module.exports;
}
function fixture({ readError = false, updateError = false, missingTeam = false, member = {}, accountId = 'A', ownerAccess = true } = {}) {
  let owner = 'A';
  const updates = [], refreshes = [];
  let release;
  const transferred = new Promise(resolve => { release = resolve; });
  const db = { from(table) {
    const filters = [], query = { update: null };
    const builder = {
      select() { return builder; }, eq(key, value) { filters.push([key, value]); return builder; },
      update(value) { query.update = value; return builder; }, maybeSingle() { return builder; },
      then(resolve, reject) { return Promise.resolve().then(async () => {
        if (table === 'members') {
          const memberId = filters.find(([key]) => key === 'id')[1];
          if (memberId === 'C') await transferred;
          return { data: { user_id: memberId, team_id: 'team', active: true, account_deleted_at: null, ...member },
            error: readError ? { message: 'fixture read failure' } : null };
        }
        assert.equal(table, 'teams');
        if (updateError) return { data: null, error: { message: 'fixture write failure' } };
        const matches = !missingTeam && filters.every(([key, value]) => key === 'id' ? value === 'team' : key === 'owner_id' && value === owner);
        if (!matches) return { data: null, error: null };
        owner = query.update.owner_id; updates.push({ owner, filters }); release();
        return { data: { id: 'team' }, error: null };
      }).then(resolve, reject); },
    }; return builder;
  } };
  const repo = load('lib/db/repo.ts', { 'server-only': {}, react: { cache: fn => fn }, './client.ts': { db },
    './images.ts': {}, './mapping.ts': {}, '../domain/settlement.ts': {},
  });
  const actions = load('app/actions/teams.ts', {
    'next/cache': { revalidatePath(path) { refreshes.push(path); } }, 'next/navigation': {},
    '../../lib/access.ts': { requireLedgerAccess: async () => ({ teamId: 'team', memberId: 'member-A', userId: accountId }),
      isTeamOwner: async () => ownerAccess },
    '../../lib/auth-client.ts': {}, '../../lib/db/client.ts': { db }, '../../lib/db/images.ts': {},
    '../../lib/db/repo.ts': repo, '../../lib/domain/money.ts': {}, '../../lib/mobile/auth-policy.ts': {},
    '../../lib/fail.ts': { failed: error => ({ ok: false, message: error.message }) },
  });
  return { repo, actions, updates, refreshes, get owner() { return owner; } };
}

const concurrent = fixture();
const [first, stale] = await Promise.all([
  concurrent.actions.handOverOwnership({ ledgerId: 'ledger', memberId: 'B' }),
  concurrent.actions.handOverOwnership({ ledgerId: 'ledger', memberId: 'C' }),
]);
assert.equal(first.ok, true); assert.equal(stale.ok, false); assert.match(stale.message, /소유자가 바뀌었습니다/);
assert.equal(concurrent.owner, 'B'); assert.equal(concurrent.updates.length, 1); assert.equal(concurrent.refreshes.length, 1);

for (const options of [{ readError: true }, { updateError: true }, { missingTeam: true },
  { member: { account_deleted_at: '2026-09-15' } }, { member: { account_deleted_at: undefined } },
  { member: { active: false } }, { member: { user_id: null } }, { member: { team_id: 'other-team' } },
  { accountId: undefined, ownerAccess: false }, { accountId: null, ownerAccess: true }, { ownerAccess: false }]) {
  const f = fixture(options), result = await f.actions.handOverOwnership({ ledgerId: 'ledger', memberId: 'B' });
  assert.equal(result.ok, false); assert.equal(f.owner, 'A'); assert.equal(f.updates.length, 0); assert.equal(f.refreshes.length, 0);
}

const spoof = fixture({ accountId: 'different-authenticated-user' });
const spoofed = await spoof.actions.handOverOwnership({ ledgerId: 'ledger', memberId: 'B', expectedOwnerId: 'A' });
assert.equal(spoofed.ok, false); assert.equal(spoof.owner, 'A');
console.log('PASS concurrent A→B/A→C leaves B owner; stale actor cannot override verified identity; failed/missing/unavailable member and guest paths make no ownership change. No network or live DB operations.');
