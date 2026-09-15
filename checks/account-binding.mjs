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
  vm.runInNewContext(source, { module, exports: module.exports, Error,
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
    return { ok: true, removedBooks: 0, appleCleanup: 'not_required' };
  } },
  '../../lib/fail.ts': { failed(e) { return { ok: false, message: e.message }; } },
});

function client(accountId) {
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
    '../actions/account.ts': { withdraw(id) { calls.push(id); return action.withdraw(id); } },
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
click(late); click(late);
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
console.log('PASS displayed A/current B deletes nothing; fresh B deletes only B; unmounted response has no UI effects; server page binds and keys confirmation by verified account. No network or real deletions.');
