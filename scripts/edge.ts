/** 빈 장부·모서리 값에서 새 함수들이 죽지 않는가. 배포 전 한 번은 봐야 한다. */
import type { Ledger, Member } from '../lib/domain/types.ts';
import { fundBook, duesBoard, unpaid, guessDuesPerHead, carryOut, usesFund } from '../lib/domain/closing.ts';
import { burn, budgetOf } from '../lib/domain/ahead.ts';
import { watch, twins, spikes, offReceipt, leftOut, median } from '../lib/domain/watch.ts';
import { nudges, weeksSinceSettle } from '../lib/domain/nudge.ts';
import { recallSeed, recallFor, categoriesOf } from '../lib/domain/recall.ts';
import { computeSettlement, summarizeLedger, unsettledExpenses } from '../lib/domain/settlement.ts';

let bad = 0;
function ok(name: string, fn: () => void) {
  try { fn(); console.log('  ✓', name); }
  catch (e) { bad++; console.log('  ✗', name, '—', e instanceof Error ? e.message : e); }
}

const today = '2026-09-05';

/* 1. 방금 만든 장부 — 아무것도 없다 */
const brandNew: Ledger = {
  id: 'x', teamName: '팀', name: '장부', startedAt: today,
  members: [], expenses: [], settlements: [], incomes: [],
};
ok('빈 장부 — fundBook', () => { fundBook(brandNew); });
ok('빈 장부 — burn (예산 0으로 나누기)', () => {
  const b = burn(brandNew, today);
  if (!Number.isFinite(b.ran)) throw new Error('ran 이 NaN/Infinity');
  if (b.weeksLeft !== null) throw new Error('말할 근거가 없는데 말한다');
});
ok('빈 장부 — watch', () => { if (watch(brandNew, []).length) throw new Error('빈 장부에 물음'); });
ok('빈 장부 — nudges', () => { if (nudges(brandNew, [], today).length) throw new Error('빈 장부에 말 검'); });
ok('빈 장부 — duesBoard / unpaid', () => { duesBoard(brandNew, []); unpaid(brandNew, []); });
ok('빈 장부 — guessDuesPerHead', () => { if (guessDuesPerHead(brandNew) !== null) throw new Error('없는 기준을 만듦'); });
ok('빈 장부 — recall', () => { recallFor(recallSeed(brandNew), { vendor: '아무데나' }); categoriesOf(brandNew); });
ok('빈 장부 — computeSettlement', () => {
  const r = computeSettlement([], []);
  if (r.transfers.length) throw new Error('송금이 생김');
});
ok('빈 장부 — summarizeLedger', () => { summarizeLedger(brandNew); });
ok('빈 장부 — carryOut', () => { if (carryOut(fundBook(brandNew)) !== 0) throw new Error('넘길 돈이 생김'); });

/* 2. 팀원 한 명 */
const solo: Ledger = { ...brandNew, members: [{ id: 'a', name: '나' }] };
ok('혼자 쓰는 장부 — nudges', () => { nudges(solo, solo.members, today); });
ok('혼자 쓰는 장부 — leftOut (줄이 없으면 아무도 안 묻는다)', () => {
  if (leftOut(solo, solo.members).length) throw new Error('줄이 없는데 빠졌다고 함');
});

/* 3. 오늘 만들고 오늘 한 줄 적은 장부 */
const day1: Ledger = {
  ...solo,
  members: [{ id: 'a', name: '나' }, { id: 'b', name: '너' }],
  expenses: [{
    id: 'e1', ledgerId: 'x', date: today, title: '커피', amount: 9000,
    payerId: 'a', teamMemberIds: ['a', 'b'], allocation: { type: 'all' },
    createdAt: `${today}T00:00:00Z`, createdBy: 'a',
  }],
};
ok('첫날 한 줄 — 말을 걸지 않는다', () => {
  if (nudges(day1, day1.members, today).length) throw new Error('첫날부터 독촉');
});
ok('첫날 한 줄 — 튀는 금액을 말하지 않는다', () => {
  if (spikes(day1.expenses).length) throw new Error('한 줄짜리 장부에서 보통을 말함');
});
ok('첫날 한 줄 — 정산이 성립한다', () => {
  const r = computeSettlement(day1.expenses, day1.members);
  const sum = r.balances.reduce((x, b) => x + b.netBalance, 0);
  if (sum !== 0) throw new Error('balance 합이 0이 아님');
});

/* 4. 모서리 숫자 */
ok('median([]) = 0', () => { if (median([]) !== 0) throw new Error('빈 배열'); });
ok('금액 0인 줄이 섞여도 안 죽는다', () => {
  spikes([...day1.expenses, { ...day1.expenses[0], id: 'z', amount: 0 }]);
});
ok('예산 0에서 집행률이 0', () => {
  const b = burn({ ...day1, expenses: [] }, today);
  if (b.ran !== 0) throw new Error(`ran=${b.ran}`);
});
ok('오늘이 시작일보다 앞서도 안 죽는다', () => {
  const b = burn(day1, '2020-01-01');
  if (!Number.isFinite(b.weeks) || b.weeks < 1) throw new Error(`weeks=${b.weeks}`);
});
ok('정산 날짜가 오늘보다 뒤여도 음수 주가 안 나온다', () => {
  const w = weeksSinceSettle({ ...day1, settlements: [{ id: 's', ledgerId: 'x', seq: 1,
    date: '2099-01-01', label: '1차', isFinal: true,
    snapshot: { expenseIds: [], totalAmount: 0, sharedAmount: 0, personalAmount: 0,
      balances: [], transfers: [], breakdowns: [] } }] }, today);
  if (w < 0) throw new Error(`weeks=${w}`);
});
ok('공금만 있고 수입이 없는 장부 — 결산이 음수로 나온다', () => {
  const f: Ledger = { ...day1, fundSource: 'grant',
    expenses: [{ ...day1.expenses[0], allocation: { type: 'common' } }] };
  const b = fundBook(f);
  if (b.left !== -9000) throw new Error(`left=${b.left}`);
  if (carryOut(b) !== 0) throw new Error('빚을 이월함');
  const bu = burn(f, today);
  if (bu.ran !== 0) throw new Error('예산 0인데 집행률이 남');
});
ok('usesFund 없는 옛 장부는 each 로 읽힌다', () => {
  if (usesFund(brandNew)) throw new Error('fundSource 없는 장부가 공금 장부로 읽힘');
});

console.log(bad === 0 ? '\n빈 장부와 모서리 값에서 전부 통과.\n' : `\n실패 ${bad}건\n`);
process.exit(bad === 0 ? 0 : 1);
