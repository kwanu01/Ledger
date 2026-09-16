/** Independent review of actual Storage cleanup code. In-memory objects/DB only, no live requests. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const ts = createRequire(path.join(root, 'package.json'))('typescript');
class MobileError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
function fixture({ paths = ['ledger-a/expense-1/receipt-a.jpg'], pending = 0, queueCount, truncated = false,
  falseRemove = false, failRemoveAt = 0, failListAt = 0, duplicatePage = false } = {}) {
  const objects = new Set(paths), removed = [], lists = [], writes = [];
  let completed = false, removeCalls = 0;
  const storage = {
    async list(prefix, options) {
      lists.push({ prefix, ...options });
      if (lists.length === failListAt) return { data: null, error: { message: 'fixture listing failure' } };
      const children = new Map();
      for (const key of objects) if (key.startsWith(prefix + '/')) {
        const rest = key.slice(prefix.length + 1), [name, ...nested] = rest.split('/');
        children.set(name, { name, id: nested.length ? null : 'file-' + name });
      }
      const values = [...children.values()].sort((a, b) => a.name < b.name ? -1 : 1);
      const offset = duplicatePage && options.offset > 0 ? 0 : options.offset;
      return { data: values.slice(offset, offset + options.limit), error: null };
    },
    async remove(keys) {
      removeCalls++;
      if (removeCalls === failRemoveAt) return { data: null, error: { message: 'fixture delete failure' } };
      if (!falseRemove) for (const key of keys) { objects.delete(key); removed.push(key); }
      return { data: falseRemove ? [] : keys.map(name => ({ name })), error: null };
    },
  };
  const db = { storage: { from(bucket) { assert.equal(bucket, 'expense-images'); return storage; } },
    from(table) {
      const query = { filters: [], range: [0, 99], update: null };
      const builder = {
        select() { return builder; }, eq(key, value) { query.filters.push([key, value]); return builder; },
        order() { return builder; }, range(from, to) { query.range = [from, to]; return builder; },
        update(value) { query.update = value; return builder; }, maybeSingle() { return builder; },
        then(resolve, reject) { return Promise.resolve().then(() => {
          if (table === 'image_upload_operations') return { data: null, count: pending, error: null };
          if (table === 'account_content_cleanup') return { data: [], count: 0, error: null };
          assert.equal(table, 'account_image_cleanup');
          assert.ok(query.filters.some(([key, value]) => key === 'user_id' && value === 'user-a'));
          if (query.update) {
            assert.ok(query.filters.some(([key, value]) => key === 'ledger_id' && value === 'ledger-a'));
            writes.push(query); completed = true; return { data: { ledger_id: 'ledger-a' }, error: null };
          }
          return { data: truncated ? [] : [{ ledger_id: 'ledger-a', completed_at: completed ? 'fixture-completed' : null }].slice(query.range[0], query.range[1] + 1),
            count: queueCount === undefined ? 1 : queueCount, error: null };
        }).then(resolve, reject); },
      }; return builder;
    },
  };
  const imports = { 'server-only': {}, './client.ts': { db }, 'node:crypto': { randomUUID }, '../mobile/http.ts': { MobileError } };
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, 'lib/db/images.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Error, Date, Set, Uint8Array,
    require(id) { if (!(id in imports)) throw Error(`Unexpected import ${id}`); return imports[id]; },
    fetch() { throw Error('Network forbidden'); },
  });
  return { code: module.exports, objects, removed, lists, writes, get completed() { return completed; } };
}
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('PASS ' + name); }
await check('all folder and file pages are collected before deletion; another ledger is untouched', async () => {
  const own = [...Array.from({ length: 1105 }, (_, i) => `ledger-a/big/receipt-${String(i).padStart(4, '0')}.jpg`),
    ...Array.from({ length: 105 }, (_, i) => `ledger-a/expense-${String(i).padStart(3, '0')}/receipt.jpg`)];
  const f = fixture({ paths: [...own, 'ledger-b/private/receipt.jpg'] });
  await f.code.cleanupAccountImages('user-a');
  assert.deepEqual([...f.objects], ['ledger-b/private/receipt.jpg']); assert.equal(f.removed.length, own.length);
  assert.ok(f.lists.some(call => call.prefix === 'ledger-a/big' && call.offset >= 1000));
  assert.ok(f.lists.some(call => call.prefix === 'ledger-a' && call.offset === 100));
  assert.equal(f.completed, true);
});
await check('a successful remove envelope with files still present cannot mark cleanup complete', async () => {
  const f = fixture({ falseRemove: true }); await assert.rejects(() => f.code.cleanupAccountImages('user-a'));
  assert.equal(f.objects.size, 1); assert.equal(f.completed, false); assert.equal(f.writes.length, 0);
});
await check('single-file compensation also rejects a success envelope when the exact object remains', async () => {
  const f = fixture({ falseRemove: true }); await assert.rejects(() => f.code.dropImage('ledger-a/expense-1/receipt-a.jpg'));
  assert.equal(f.objects.size, 1);
});
await check('single-file absence verification failure is not an acknowledged compensation', async () => {
  const f = fixture({ failListAt: 1 }); await assert.rejects(() => f.code.dropImage('ledger-a/expense-1/receipt-a.jpg'));
  assert.equal(f.objects.size, 0);
  await f.code.dropImage('ledger-a/expense-1/receipt-a.jpg');
});
await check('verification listing failure cannot mark cleanup complete even after remote removal', async () => {
  const f = fixture({ failListAt: 3 }); await assert.rejects(() => f.code.cleanupAccountImages('user-a'));
  assert.equal(f.objects.size, 0); assert.equal(f.completed, false);
  await f.code.cleanupAccountImages('user-a'); assert.equal(f.completed, true);
});
await check('partial batch removal failure preserves reservation and a retry completes remaining objects', async () => {
  const own = Array.from({ length: 205 }, (_, i) => `ledger-a/expense/receipt-${String(i).padStart(3, '0')}.jpg`);
  const f = fixture({ paths: own, failRemoveAt: 2 }); await assert.rejects(() => f.code.cleanupAccountImages('user-a'));
  assert.equal(f.objects.size, 105); assert.equal(f.completed, false);
  await f.code.cleanupAccountImages('user-a'); assert.equal(f.objects.size, 0); assert.equal(f.completed, true);
});
await check('pending upload blocks Storage cleanup without clearing its durable reservation', async () => {
  const f = fixture({ pending: 1 }); await assert.rejects(() => f.code.cleanupAccountImages('user-a'));
  assert.equal(f.lists.length, 0); assert.equal(f.writes.length, 0); assert.equal(f.objects.size, 1);
});
for (const options of [{ queueCount: null }, { queueCount: -1 }, { queueCount: 0.5 }, { truncated: true }]) {
  await check('missing or incomplete exact queue count fails closed before Storage changes', async () => {
    const f = fixture(options); await assert.rejects(() => f.code.cleanupAccountImages('user-a'));
    assert.equal(f.lists.length, 0); assert.equal(f.writes.length, 0);
  });
}
await check('repeated Storage page is rejected rather than silently dropping or duplicating paths', async () => {
  const f = fixture({ paths: Array.from({ length: 105 }, (_, i) => `ledger-a/expense/receipt-${String(i).padStart(3, '0')}.jpg`), duplicatePage: true });
  await assert.rejects(() => f.code.cleanupAccountImages('user-a'));
  assert.equal(f.objects.size, 105); assert.equal(f.removed.length, 0); assert.equal(f.completed, false);
});
await check('path traversal from a malformed Storage result is rejected before deletion', async () => {
  const f = fixture({ paths: ['ledger-a/../private.jpg'] }); await assert.rejects(() => f.code.cleanupAccountImages('user-a'));
  assert.equal(f.objects.size, 1); assert.equal(f.removed.length, 0); assert.equal(f.completed, false);
});
function imageAction({ guest = false, linkFails = false, dropFails = false } = {}) {
  const calls = [], pass = { memberId: guest ? 'guest-member' : 'member-a', ...(guest ? {} : { userId: 'user-a' }) };
  const images = {
    MAX_BYTES: 4 * 1024 * 1024, ALLOWED_TYPES: ['image/jpeg'],
    async currentImage() { calls.push(['read']); return { ledgerId: 'ledger-a', path: 'ledger-a/expense/old.jpg' }; },
    async putImage(args) { calls.push(['upload', args]); return { path: 'ledger-a/expense/new.jpg', operationId: 'operation-a' }; },
    async setExpenseImage(args) { calls.push(['link', args]); if (linkFails) throw Error('fixture account revoked'); },
    async dropImage(path) { calls.push(['drop', path]); if (dropFails) throw Error('fixture unconfirmed removal'); },
    async finishImageUpload(...args) { calls.push(['finish', ...args]); },
  };
  const imports = { 'next/cache': { revalidatePath() {} }, '../../lib/access.ts': { async requireLedgerAccess() { calls.push(['access']); return pass; } },
    '../../lib/fail.ts': { failed(error) { return { ok: false, message: error.message }; } }, '../../lib/db/images.ts': images };
  const module = { exports: {} }, source = ts.transpileModule(fs.readFileSync(path.join(root, 'app/actions/images.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Error, File,
    require(id) { if (!(id in imports)) throw Error(`Unexpected import ${id}`); return imports[id]; },
    fetch() { throw Error('Network forbidden'); },
  });
  const form = new FormData(); form.set('ledgerId', 'ledger-a'); form.set('expenseId', 'expense'); form.set('kind', 'receipt');
  form.set('image', new File([new Uint8Array([255, 216, 255])], 'fixture.jpg', { type: 'image/jpeg' }));
  form.set('userId', 'user-b'); form.set('memberId', 'member-b');
  return { code: module.exports, form, calls, pass };
}
for (const guest of [false, true]) await check('upload and metadata use one verified actor, ignoring supplied user/member fields', async () => {
  const f = imageAction({ guest }), result = await f.code.attachImage(f.form);
  assert.equal(result.ok, true);
  for (const stage of ['upload', 'link']) {
    const call = f.calls.find(([name]) => name === stage)[1];
    assert.equal(call.memberId, f.pass.memberId); assert.equal(call.userId, f.pass.userId ?? null);
  }
  assert.equal(f.calls.find(([stage]) => stage === 'link')[1].expectedPath, 'ledger-a/expense/old.jpg');
  assert.deepEqual(f.calls.map(([stage]) => stage), ['access', 'read', 'upload', 'link', 'drop', 'finish']);
});
await check('revoked metadata link compensates new file before releasing the pending operation', async () => {
  const f = imageAction({ linkFails: true }), result = await f.code.attachImage(f.form);
  assert.equal(result.ok, false); assert.deepEqual(f.calls.map(([stage]) => stage), ['access', 'read', 'upload', 'link', 'drop', 'finish']);
  assert.equal(f.calls.find(([name]) => name === 'drop')[1], 'ledger-a/expense/new.jpg');
});
for (const linkFails of [false, true]) await check('unconfirmed previous/compensating deletion retains the operation', async () => {
  const f = imageAction({ linkFails, dropFails: true }), result = await f.code.attachImage(f.form);
  assert.equal(result.ok, false); assert.ok(!f.calls.some(([stage]) => stage === 'finish'));
});
await check('unconfirmed explicit removal does not unlink the file and lose the retry path', async () => {
  const f = imageAction({ dropFails: true }), result = await f.code.removeImage({ ledgerId: 'ledger-a', expenseId: 'expense', kind: 'receipt', userId: 'user-b' });
  assert.equal(result.ok, false); assert.ok(!f.calls.some(([stage]) => stage === 'link'));
});
console.log(JSON.stringify({ passedScenarios: passed, actualSource: ['lib/db/images.ts', 'app/actions/images.ts'], liveStorageRequests: 0, liveDatabaseOperations: 0 }));
