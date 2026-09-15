/** Actual money → item form → allocation → storage mapping. No AI, database or network. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const compiled = await build({
  stdin: { contents: `
    export { default as ItemLines, toItemLines, newDraft } from './app/l/[ledgerId]/add/ItemLines.tsx';
    export * from './lib/domain/money.ts';
    export { sharesOfLines, checkItemLines } from './lib/domain/settlement.ts';
    export { toExpenseInsert } from './lib/db/mapping.ts';
    export { parseAction } from './lib/mobile/validation.ts';
  `, resolveDir: root, loader: 'ts' },
  bundle: true, packages: 'external', platform: 'node', format: 'cjs', jsx: 'automatic', write: false,
});
const module = { exports: {} };
vm.runInNewContext(compiled.outputFiles[0].text, { module, exports: module.exports, require, process, Response, Headers });
const { ItemLines, toItemLines, newDraft, parseMoney, parseSignedMoney, formatNumber,
  sharesOfLines, checkItemLines, toExpenseInsert, parseAction } = module.exports;
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const drafts = () => [
  newDraft({ name: '상품 A', amount: '12,000', memberIds: [A] }),
  newDraft({ name: '상품 B', amount: '10,000', memberIds: [B] }),
  newDraft({ name: '즉시할인', amount: '-1,000', memberIds: [A, B] }),
];
const plain = value => JSON.parse(JSON.stringify(value));

test('discount signs from typing, receipt formatting and accounting notation remain negative', () => {
  for (const text of ['-1,000', '−1,000', '－１，０００', '﹣1,000', ' (1,000) ', ' -1,000원 ']) {
    assert.equal(parseSignedMoney(text, 'KRW'), -1000, text);
  }
  assert.equal(parseSignedMoney('1,000'), 1000);
  assert.equal(parseSignedMoney(''), 0);
  assert.equal(Object.is(parseSignedMoney('-0'), -0), false);
  assert.equal(parseSignedMoney('-10.259', 'USD'), -1025);
  assert.equal(parseSignedMoney('−1.001', 'JPY'), -1);
  assert.equal(parseMoney('-1,000'), 1000, 'ordinary positive amount parser remains unchanged');
});

test('reported receipt is 21,000 total, split 11,500 / 9,500, including edit roundtrip', () => {
  const lines = toItemLines(drafts(), 'KRW');
  assert.equal(lines[2].amount, -1000);
  assert.equal(lines.reduce((sum, line) => sum + line.amount, 0), 21000);
  assert.deepEqual(plain(sharesOfLines(lines, [A, C, B])).map(s => [s.memberId, s.amount]), [[A, 11500], [B, 9500]]);
  assert.deepEqual(plain(checkItemLines({ lines, total: 21000, roster: [A, C, B] })), []);
  const edited = lines.map(line => newDraft({ ...line, amount: formatNumber(line.amount, 'KRW', 'ko') }));
  assert.deepEqual(plain(toItemLines(edited, 'KRW')), plain(lines));
});

test('same form renders the negative amount, correct sum and per-person totals', () => {
  const html = renderToStaticMarkup(createElement(ItemLines, {
    drafts: drafts(), onDrafts() {}, onTotal() {}, total: 21000, currency: 'KRW', lang: 'ko',
    roster: [A, C, B], members: [{ id: A, name: '가' }, { id: B, name: '나' }, { id: C, name: '다' }],
  }));
  for (const text of ['value="-1,000"', '21,000원', '11,500원', '9,500원']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('23,000원'));
  assert.ok(!html.includes('12,500원'));
});

test('localized receipt and edit amounts roundtrip without multiplying decimal currencies', () => {
  for (const locale of ['ko', 'en', 'ja', 'zh', 'es', 'vi']) {
    for (const currency of ['KRW', 'JPY', 'USD', 'EUR', 'GBP']) {
      for (const amount of [123456, -123456, -29]) {
        const displayed = formatNumber(amount, currency, locale);
        assert.equal(parseSignedMoney(displayed, currency, locale), amount, `${currency}/${locale}: ${displayed}`);
        assert.equal(parseMoney(displayed, currency, locale), Math.abs(amount));
      }
    }
    const localized = [1234, -29].map((amount, i) => newDraft({ name: String(i), amount: formatNumber(amount, 'EUR', locale), memberIds: [A, B] }));
    const lines = toItemLines(localized, 'EUR', locale);
    assert.equal(lines.reduce((sum, line) => sum + line.amount, 0), 1205);
    assert.equal(sharesOfLines(lines, [A, B]).reduce((sum, share) => sum + share.amount, 0), 1205);
  }
});

test('saving allocation preserves negative discount in API input and DB insert mapping', () => {
  const allocation = { type: 'items', lines: toItemLines(drafts(), 'KRW') };
  const entry = { title: '배달', date: '2026-09-15', amount: 21000, payerId: A, allocation };
  const parsed = parseAction('recordExpense', entry).input;
  assert.equal(parsed.allocation.lines[2].amount, -1000);
  const row = toExpenseInsert({ ...entry, ledgerId: C, teamMemberIds: [A, C, B] });
  assert.equal(row.item_lines[2].amount, -1000);
  assert.equal(row.amount, row.item_lines.reduce((sum, line) => sum + line.amount, 0));
});

test('delivery fee adds, several discounts subtract and odd-won division preserves the total', () => {
  const lines = toItemLines([...drafts(),
    newDraft({ name: '배달비', amount: '3,000', memberIds: [A, B] }),
    newDraft({ name: '추가 쿠폰', amount: '−501', memberIds: [A, B] }),
  ], 'KRW');
  const shares = sharesOfLines(lines, [A, C, B]);
  assert.equal(lines.reduce((sum, line) => sum + line.amount, 0), 23499);
  assert.equal(shares.reduce((sum, share) => sum + share.amount, 0), 23499);
  const splitDiscount = sharesOfLines([{ name: '쿠폰', amount: -1000, memberIds: [A, B, C] }], [A, B, C]);
  assert.equal(splitDiscount.reduce((sum, share) => sum + share.amount, 0), -1000);
  assert.ok(splitDiscount.every(share => share.amount < 0));
});
