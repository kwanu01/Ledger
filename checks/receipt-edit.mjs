/**
 * Execute EditExpense's real input and save handlers in memory.
 * React hooks, navigation, helper messages and the server action are mocked;
 * money parsing and ItemLines conversion are the actual source modules.
 * Run: node checks/receipt-edit.mjs
 * No browser, credentials, database, AI or external request is used.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const ts = createRequire(path.join(root, 'package.json'))('typescript');
const sourceFiles = new Set([
  'app/l/[ledgerId]/book/EditExpense.tsx',
  'app/l/[ledgerId]/add/ItemLines.tsx',
  'lib/domain/money.ts',
  'lib/domain/settlement.ts',
]);
let active;
const hooks = {
  useState(initial) {
    const state = active;
    const index = state.cursor++;
    if (!(index in state.slots)) state.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [state.slots[index], next => {
      state.slots[index] = typeof next === 'function' ? next(state.slots[index]) : next;
    }];
  },
  useId() { return 'fixture-group'; },
  useTransition() {
    const state = active;
    return [false, callback => { state.transitions.push(Promise.resolve(callback())); }];
  },
};
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const cache = new Map();
function load(relative) {
  if (cache.has(relative)) return cache.get(relative);
  assert.ok(sourceFiles.has(relative), `Source import not allowed: ${relative}`);
  const filename = path.join(root, relative);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(id) {
      if (id === 'react') return hooks;
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fixture-fragment' };
      if (id === 'next/navigation') {
        // useRouter is called during render, after this module has loaded.
        return { useRouter: () => ({ refresh: () => { active.refreshes++; } }) };
      }
      const resolved = path.relative(root, path.resolve(path.dirname(filename), id));
      if (resolved === 'app/actions/ledger.ts') return {
        async editExpenseLine(input) {
          const state = active;
          state.requests.push(JSON.parse(JSON.stringify(input)));
          return state.actionResult;
        },
      };
      if (resolved === 'app/helper/HelperContext.tsx') return {
        useHelper: () => ({ say: message => { active.messages.push(message); } }),
      };
      if (resolved === 'lib/i18n.ts') return {
        translator: () => (key, values) => key + (values ? JSON.stringify(values) : ''),
      };
      return load(resolved);
    },
    fetch() { throw new Error('External requests are forbidden'); },
  }, { filename });
  cache.set(relative, module.exports);
  return module.exports;
}
const EditExpense = load('app/l/[ledgerId]/book/EditExpense.tsx').default;
const ItemLines = load('app/l/[ledgerId]/add/ItemLines.tsx').default;
const members = [
  { id: '00000000-0000-4000-8000-000000000001', name: '가', active: true },
  { id: '00000000-0000-4000-8000-000000000002', name: '나', active: true },
];
const roster = members.map(member => member.id);
const ledgerId = '00000000-0000-4000-8000-000000000010';
function expense(overrides = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000020',
    title: '원래 이름', date: '2026-09-15', amount: 21000,
    payerId: roster[0], teamMemberIds: roster,
    allocation: { type: 'all' }, ...overrides,
  };
}
function nodes(element, predicate, found = []) {
  if (Array.isArray(element)) {
    for (const child of element) nodes(child, predicate, found);
  } else if (element && typeof element === 'object') {
    if (predicate(element)) found.push(element);
    nodes(element.props?.children, predicate, found);
  }
  return found;
}
function start(original, currency = 'KRW', lang = 'ko') {
  const state = {
    cursor: 0, slots: [], transitions: [], requests: [], messages: [],
    done: 0, refreshes: 0, actionResult: { ok: true }, tree: undefined,
  };
  const props = {
    ledgerId, expense: original, members, groups: [], fund: 'each', currency, lang,
    onDone: () => { state.done++; },
  };
  const render = () => {
    active = state; state.cursor = 0; state.tree = EditExpense(props);
  };
  const find = predicate => {
    const matches = nodes(state.tree, predicate);
    assert.equal(matches.length, 1, 'Expected exactly one matching UI element');
    return matches[0];
  };
  const changeTitle = value => {
    const input = find(node => node.type === 'input' && node.props.value === original.title);
    input.props.onChange({ target: { value } }); render();
  };
  const save = async () => {
    active = state;
    find(node => node.type === 'button' && node.props.className === 'act small primary').props.onClick();
    await Promise.all(state.transitions.splice(0));
  };
  render();
  return { state, render, find, changeTitle, save };
}
function saved(form, expectedAmount) {
  const { state } = form;
  assert.deepEqual(state.messages, []);
  assert.equal(state.requests.length, 1);
  assert.equal(state.requests[0].amount, expectedAmount);
  assert.equal(state.requests[0].ledgerId, ledgerId);
  assert.equal(state.done, 1);
  assert.equal(state.refreshes, 1);
  return state.requests[0];
}
let passed = 0;
async function check(name, callback) {
  await callback(); passed++; console.log(`PASS ${name}`);
}

for (const kind of ['correction', 'refund']) {
  await check(`editing only a negative ${kind} title preserves -1000`, async () => {
    const form = start(expense({ amount: -1000, adjustment: { kind, targetExpenseId: 'original' } }));
    form.changeTitle('고친 이름'); await form.save();
    const input = saved(form, -1000);
    assert.equal(input.title, '고친 이름');
    assert.deepEqual(input.allocation, { type: 'all' });
  });
}

function itemExpense(amounts, extra = {}) {
  return expense({
    amount: amounts.reduce((sum, amount) => sum + amount, 0),
    allocation: {
      type: 'items',
      lines: amounts.map((amount, index) => ({
        name: index === amounts.length - 1 ? '할인' : `상품 ${index + 1}`,
        amount, memberIds: index === 0 ? [roster[0]] : roster,
      })),
    }, ...extra,
  });
}
await check('12000 + 10000 - 1000 item edit saves 21000 with the original participants', async () => {
  const original = itemExpense([12000, 10000, -1000]);
  const form = start(original); form.changeTitle('배달 주문');
  const editor = form.find(node => node.type === ItemLines);
  assert.equal(editor.props.total, 21000);
  assert.equal(editor.props.drafts[2].amount, '-1,000');
  await form.save();
  assert.deepEqual(saved(form, 21000).allocation, original.allocation);
});

for (const lang of ['es', 'vi']) {
  await check(`${lang} EUR item edit preserves grouped amounts and a negative decimal discount`, async () => {
    const original = itemExpense([1200034, 1000056, -100089]);
    const form = start(original, 'EUR', lang);
    assert.equal(form.find(node => node.type === ItemLines).props.total, 2100001);
    form.changeTitle('수정한 주문'); await form.save();
    assert.deepEqual(saved(form, 2100001).allocation, original.allocation);
  });
  await check(`${lang} EUR title-only correction retains the negative minor units`, async () => {
    const form = start(expense({ amount: -1234, adjustment: { kind: 'correction', targetExpenseId: 'original' } }), 'EUR', lang);
    form.changeTitle('수정한 보정'); await form.save(); saved(form, -1234);
  });
}

await check('USD 12.34 + 10.00 - 0.29 retains cents without floating-point drift', async () => {
  const original = itemExpense([1234, 1000, -29]);
  const form = start(original, 'USD', 'en'); await form.save();
  assert.deepEqual(saved(form, 2205).allocation, original.allocation);
});
await check('changing an item discount and applying its subtotal uses the updated draft', async () => {
  const form = start(itemExpense([12000, 10000, -1000]));
  const editor = form.find(node => node.type === ItemLines);
  editor.props.onDrafts(previous => previous.map((draft, index) => index === 2 ? { ...draft, amount: '-2,000' } : draft));
  editor.props.onTotal(20000); form.render(); await form.save();
  const input = saved(form, 20000);
  assert.deepEqual(input.allocation.lines.map(line => line.amount), [12000, 10000, -2000]);
});
await check('an unmatched item subtotal does not call the action or close the editor', async () => {
  const form = start(itemExpense([12000, 10000, -1000], { amount: 22000 }));
  await form.save();
  assert.equal(form.state.requests.length, 0);
  assert.equal(form.state.messages.length, 1);
  assert.ok(form.state.messages[0].startsWith('sumOff'));
  assert.equal(form.state.done, 0); assert.equal(form.state.refreshes, 0);
});
await check('a rejected server save keeps the editor open and reports the actual failure', async () => {
  const form = start(itemExpense([12000, 10000, -1000]));
  form.state.actionResult = { ok: false, message: '저장 거절 확인용' };
  await form.save();
  assert.equal(form.state.requests.length, 1);
  assert.deepEqual(form.state.messages, ['저장 거절 확인용']);
  assert.equal(form.state.done, 0); assert.equal(form.state.refreshes, 0);
});
await check('a signed item adjustment preserves both its total and every negative subline', async () => {
  const original = itemExpense([-500, -300, -200], { adjustment: { kind: 'refund', targetExpenseId: 'original' } });
  const form = start(original);
  assert.equal(form.find(node => node.type === ItemLines).props.total, -1000);
  form.changeTitle('환불 이름 수정'); await form.save();
  assert.deepEqual(saved(form, -1000).allocation, original.allocation);
});

console.log(JSON.stringify({ passed, actualSource: [...sourceFiles], externalRequests: 0, databaseRequests: 0 }));
