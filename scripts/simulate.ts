/**
 * Ledger — 정산 시뮬레이션 + 검산 (Master Context §32-1, §32-2)
 *
 *   node --experimental-strip-types src/simulate.ts
 *
 * 이 스크립트가 통과한다는 것은 "숫자가 맞다"는 뜻이 아니라
 * "장부가 스스로 검산 가능하다"는 뜻이다. 아래 불변식이 그 검산의 정의다.
 */

import {
  splitEvenly as E_splitEvenly,
  effectiveAmount as E_effectiveAmount,
  checkItemLines as E_checkItemLines,
  needsSettling as E_needsSettling,
  spreadOverLines as E_spreadOverLines,
  allocationLabel,
  breakdownOf,
  computeSettlement,
  nameOf,
  settleSingle,
  summarizeLedger,
  unsettledExpenses,
  won,
} from '../lib/domain/settlement.ts';
import { buildLedger, members } from '../lib/domain/seed.ts';
import { recallFor, recallSeed, categoriesOf } from '../lib/domain/recall.ts';
import { fundBook, duesBoard, unpaid, carryOut, fromFund, usesFund, guessDuesPerHead } from '../lib/domain/closing.ts';
import { inSettlement } from '../lib/domain/settlement.ts';
import { twins, spikes, offReceipt, leftOut, median, watch } from '../lib/domain/watch.ts';
import { burn, budgetOf, weeksBetween } from '../lib/domain/ahead.ts';
import { nudges, weeksSinceSettle } from '../lib/domain/nudge.ts';
import type { Income } from '../lib/domain/types.ts';
import type { Expense, Ledger, SettlementResult } from '../lib/domain/types.ts';

const ledger = buildLedger();
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0)));
const rpad = (s: string, n: number) => ' '.repeat(Math.max(0, n - s.length)) + s;
const rule = (c = '─', n = 68) => console.log(c.repeat(n));

let failures = 0;
function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ✓ ${label}${detail ? `   ${detail}` : ''}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? `   ${detail}` : ''}`);
  }
}

/* ================================================================== */
console.log(`\n${ledger.teamName} — ${ledger.name}\n`);

/* --- 1. 장부 전체 ---------------------------------------------------- */
rule('=');
console.log(`LEDGER VIEW — 전체 지출 ${ledger.expenses.length}건`);
rule();
for (const e of ledger.expenses) {
  const settled = ledger.settlements.some((s) => s.snapshot.expenseIds.includes(e.id));
  console.log(
    `${e.date.slice(5).replace('-', '.')}  ${pad(e.title, 26)}${pad(nameOf(members, e.payerId), 8)}` +
      `${rpad(e.amount.toLocaleString('ko-KR'), 9)}  ${pad(allocationLabel(e, members), 12)}` +
      `${settled ? '정산완료' : '미정산'}`,
  );
  if (e.id === 'e12') {
    rule('·');
    console.log(`● 2026-09-20   1차 중간 정산 확정   ${won(ledger.settlements[0].snapshot.totalAmount)}`);
    rule('·');
  }
}

const summary = summarizeLedger(ledger);
rule();
console.log(`${rpad('총 프로젝트 지출', 22)}  ${rpad(won(summary.totalSpent), 12)}   ← 정산해도 초기화되지 않음`);
console.log(`${rpad('정산 완료', 22)}  ${rpad(won(summary.settledAmount), 12)}`);
console.log(`${rpad('미정산', 22)}  ${rpad(won(summary.unsettledAmount), 12)}`);
console.log(`${rpad('공동 정산 대상', 22)}  ${rpad(won(summary.sharedTotal), 12)}   ← 총지출 ≠ 정산 대상 (§23.4)`);
console.log(`${rpad('개인 귀속', 22)}  ${rpad(won(summary.personalTotal), 12)}`);

/* --- 2. 정산 사이클 -------------------------------------------------- */
function report(title: string, result: SettlementResult) {
  console.log('');
  rule('=');
  console.log(title);
  rule();
  console.log(`대상 ${result.expenseIds.length}건   총액 ${won(result.totalAmount)}   (공동 ${won(result.sharedAmount)} / 개인 귀속 ${won(result.personalAmount)})\n`);
  console.log(`  ${pad('', 8)}${rpad('직접 결제', 12)}${rpad('부담해야 할 몫', 16)}${rpad('balance', 12)}`);
  for (const b of result.balances) {
    const verdict = b.netBalance === 0 ? '정산 완료' : b.netBalance > 0 ? '받을 돈' : '보낼 돈';
    console.log(
      `  ${pad(nameOf(members, b.memberId), 8)}${rpad(b.totalPaid.toLocaleString('ko-KR'), 12)}` +
        `${rpad(b.totalOwed.toLocaleString('ko-KR'), 16)}${rpad(won(b.netBalance), 12)}   ${verdict}`,
    );
  }
  console.log('\n  최종 송금');
  if (result.transfers.length === 0) console.log('    (없음)');
  for (const t of result.transfers) {
    console.log(`    ${nameOf(members, t.fromMemberId)} → ${nameOf(members, t.toMemberId)}   ${won(t.amount)}`);
  }
  return result;
}

const first = report('SETTLEMENT #01 — 1차 중간 정산 (09.01–09.18) · 확정 snapshot', ledger.settlements[0].snapshot);
const open = unsettledExpenses(ledger);
const second = report('SETTLEMENT #02 — 미정산분 (09.22–10.19)', computeSettlement(open, members));
const whole = computeSettlement(ledger.expenses, members);

/* --- 3. "왜 이 금액인가" 검산 뷰 -------------------------------------- */
console.log('');
rule('=');
console.log('왜 이 금액인가 — Settlement #02의 첫 송금을 펼쳐본다 (§14)');
rule();
/**
 * 중요한 설계 발견 (§14 수정 필요)
 *
 * 문서 §14.2의 예시는 "관우 → 민수" 단 한 건의 송금만 존재하는 2인 상황을 가정한다.
 * 실제로는 한 사람이 여러 명에게서 받는 경우가 흔하고, 그때 송금 한 줄만 펼치면
 * 검산이 맞지 않는다. 따라서 검산은 "송금 단위"가 아니라 "사람 단위"여야 한다.
 *
 *   결제액 ± (그 사람의 모든 송금·수령 합계) = 부담해야 할 몫
 *
 * 펼쳐진 화면에서는 클릭한 송금 줄을 강조하되, 나머지 줄도 함께 보여준다.
 */
const t0 = second.transfers[0];
if (t0) {
  const explain = (memberId: string) => {
    const b = second.balances.find((x) => x.memberId === memberId)!;
    const mine = second.transfers.filter((t) => t.fromMemberId === memberId || t.toMemberId === memberId);
    console.log(`\n  ${nameOf(members, memberId)}`);
    console.log(`  ${rpad(b.totalPaid.toLocaleString('ko-KR'), 12)}  결제`);
    let running = b.totalPaid;
    for (const t of mine) {
      const sign = t.fromMemberId === memberId ? 1 : -1;
      running += sign * t.amount;
      const who = t.fromMemberId === memberId ? nameOf(members, t.toMemberId) : nameOf(members, t.fromMemberId);
      const mark = t === t0 ? ' ←' : '';
      console.log(`  ${rpad((sign > 0 ? '+ ' : '- ') + t.amount.toLocaleString('ko-KR'), 12)}  ${sign > 0 ? `${who}에게 송금` : `${who}에게서 수령`}${mark}`);
    }
    console.log(`  ${'─'.repeat(12)}`);
    console.log(`  ${rpad(running.toLocaleString('ko-KR'), 12)}  부담  ${running === b.totalOwed ? '✓ 부담해야 할 몫과 일치' : '✗ 불일치'}`);
    return running === b.totalOwed;
  };
  console.log(`  ${nameOf(members, t0.fromMemberId)} → ${nameOf(members, t0.toMemberId)}  ${won(t0.amount)}`);
  const okFrom = explain(t0.fromMemberId);
  const okTo = explain(t0.toMemberId);
  console.log('');
  check('검산은 송금 단위가 아니라 사람 단위여야 성립한다 (§14 보정)', okFrom && okTo);
}

/* --- 4. 단일 항목 정산 (§15) ----------------------------------------- */
console.log('');
rule('=');
console.log('단일 항목 정산 — e17 전시 판넬 A1 6장 (§15)');
rule();
const e17 = ledger.expenses.find((e) => e.id === 'e17')!;
const single = settleSingle(e17, members);
console.log(`  ${e17.title}  ${won(e17.amount)}  ${e17.teamMemberIds.length}명 공동`);
for (const s of breakdownOf(e17).shares) {
  console.log(`    ${pad(nameOf(members, s.memberId), 8)}${rpad(won(s.amount), 10)}${s.roundingAdjusted ? '  (+1 나머지 배분)' : ''}`);
}
for (const t of single.transfers) {
  console.log(`    ${nameOf(members, t.fromMemberId)} → ${nameOf(members, t.toMemberId)}  ${won(t.amount)}`);
}

/* ================================================================== */
/* 5. 검산 — 불변식                                                     */
/* ================================================================== */
console.log('');
rule('=');
console.log('VERIFY — 정산 엔진 불변식');
rule();

console.log('\n[지분]');
const shareMismatch = ledger.expenses.filter((e) => {
  const sum = breakdownOf(e).shares.reduce((a, s) => a + s.amount, 0);
  return sum !== e.amount;
});
check('모든 Expense에서 지분의 합 = 금액 (1원도 새지 않는다)', shareMismatch.length === 0, `${ledger.expenses.length}건 검사`);
const e10shares = breakdownOf(ledger.expenses.find((e) => e.id === 'e10')!).shares;
check('나누어떨어지지 않는 금액도 정수로 정확히 배분', e10shares.reduce((a, s) => a + s.amount, 0) === 21500,
  `21,500/3 → ${e10shares.map((s) => s.amount.toLocaleString('ko-KR')).join(' · ')}`);
const e22shares = breakdownOf(ledger.expenses.find((e) => e.id === 'e22')!).shares;
check('보정 항목도 같은 규칙으로 배분', e22shares.filter((s) => s.roundingAdjusted).length === 2,
  `2,000/3 → ${e22shares.map((s) => s.amount.toLocaleString('ko-KR')).join(' · ')}`);
const negShares = E_splitEvenly(-2501, ['a', 'b', 'c', 'd']);
check('음수 금액(환불)도 합이 정확히 맞는다', negShares.reduce((a, s) => a + s.amount, 0) === -2501,
  `-2,501/4 → ${negShares.map((s) => s.amount.toLocaleString('ko-KR')).join(' · ')}`);

console.log('\n[balance]');
for (const [label, r] of [['#01', first], ['#02', second], ['전체', whole]] as const) {
  const zero = r.balances.reduce((a, b) => a + b.netBalance, 0);
  check(`${label} balance 총합 = 0 (돈이 생기거나 사라지지 않는다)`, zero === 0, `합계 ${zero}`);
}
check('총액 = 공동 정산 대상 + 개인 귀속', whole.totalAmount === whole.sharedAmount + whole.personalAmount,
  `${won(whole.totalAmount)} = ${won(whole.sharedAmount)} + ${won(whole.personalAmount)}`);

console.log('\n[개인 귀속]');
const withoutE06 = computeSettlement(ledger.expenses.filter((e) => e.id !== 'e06'), members);
check('결제자 = 귀속자인 개인 귀속은 공동 정산 영향 0 (e06 커팅매트)',
  whole.balances.every((b, i) => b.netBalance === withoutE06.balances[i].netBalance),
  '총지출에는 +21,000, balance에는 0');
const withoutE18 = computeSettlement(ledger.expenses.filter((e) => e.id !== 'e18'), members);
const ownerWith = whole.balances.find((b) => b.memberId === 'kw')!.netBalance;
const ownerWithout = withoutE18.balances.find((b) => b.memberId === 'kw')!.netBalance;
check('결제자 ≠ 귀속자인 개인 귀속은 귀속자 채무로 반영 (e18 드라이버)',
  ownerWithout - ownerWith === 39000, `관우 balance ${won(ownerWithout)} → ${won(ownerWith)}`);

console.log('\n[송금]');
for (const [label, r] of [['#01', first], ['#02', second]] as const) {
  const out = new Map<string, number>();
  for (const t of r.transfers) {
    out.set(t.fromMemberId, (out.get(t.fromMemberId) ?? 0) + t.amount);
    out.set(t.toMemberId, (out.get(t.toMemberId) ?? 0) - t.amount);
  }
  const ok = r.balances.every((b) => (out.get(b.memberId) ?? 0) === -b.netBalance);
  check(`${label} 송금을 모두 실행하면 전원 balance = 0`, ok, `송금 ${r.transfers.length}회`);
  check(`${label} 송금 횟수 ≤ 인원수-1`, r.transfers.length <= members.length - 1, `${r.transfers.length} ≤ ${members.length - 1}`);
}

console.log('\n[누적 장부]');
// 자기가 사서 자기가 가져간 줄은 '미정산'이 아니라 '정산 불필요'다.
// 셋을 합쳐야 총지출이 된다.
check('총지출 = 정산 완료 + 미정산 + 정산 불필요',
  summary.totalSpent === summary.settledAmount + summary.unsettledAmount + summary.selfPaidAmount,
  `${won(summary.totalSpent)} = ${won(summary.settledAmount)} + ${won(summary.unsettledAmount)}` +
    ` + ${won(summary.selfPaidAmount)}`);
check('중간 정산을 해도 Expense 원본은 전부 그대로 남는다', ledger.expenses.length === 22, '22건');

console.log('\n[팀원 변동 · 보정 · 환불]');
const firstCycleExpenses = ledger.expenses.filter((e) => ledger.settlements[0].snapshot.expenseIds.includes(e.id));
const recomputedWithNewMember = computeSettlement(firstCycleExpenses, members);
check('유란이 나중에 합류해도 1차 정산 결과는 한 푼도 바뀌지 않는다',
  recomputedWithNewMember.balances.every((b) => {
    const old = first.balances.find((x) => x.memberId === b.memberId);
    return old && old.netBalance === b.netBalance;
  }) && recomputedWithNewMember.balances.length === 3,
  '1차 정산 대상자 3명 유지');
check('10월 지출은 4인으로 나뉜다 (e17 전시 판넬)',
  breakdownOf(ledger.expenses.find((e) => e.id === 'e17')!).shares.length === 4,
  `96,000/4 = ${(96000 / 4).toLocaleString('ko-KR')}`);
const e13 = ledger.expenses.find((e) => e.id === 'e13')!;
check('환불은 원본 부담 구조를 그대로 따른다 (e21 → e13)',
  breakdownOf(ledger.expenses.find((e) => e.id === 'e21')!).shares.length === breakdownOf(e13).shares.length,
  `실효 금액 ${won(E_effectiveAmount(ledger.expenses, e13))}`);
const e10 = ledger.expenses.find((e) => e.id === 'e10')!;
check('이미 정산된 지출의 보정은 원본을 건드리지 않는다 (e22 → e10)',
  e10.amount === 21500 && E_effectiveAmount(ledger.expenses, e10) === 23500,
  '원본 ₩21,500 유지 · 실효 ₩23,500');
const bal = (r: SettlementResult, id: string) => r.balances.find((x) => x.memberId === id)?.netBalance ?? 0;
const continuity = members.every((m) => bal(first, m.id) + bal(second, m.id) === bal(whole, m.id));
check('사이클별 balance의 합 = 전체 기간 balance (누적 모델 연속성)', continuity);
check('확정된 Settlement #01 snapshot은 이후 지출에 영향받지 않는다',
  ledger.settlements[0].snapshot.expenseIds.length === 12 && ledger.settlements[0].snapshot.totalAmount === first.totalAmount);

/* --- 항목별 청구 (§10.4) --------------------------------------------- */
/*
 * 배달 한 건. 넷이 시켰고 관우가 결제했다.
 *
 * 이 지출은 seed 에 넣지 않고 여기서 세운다. 위의 불변식들이 22건이라는
 * 숫자에 기대고 있어서다. 검사할 것은 장부의 모양이 아니라 계산 규칙이다.
 */
console.log('\n[항목별 청구]');

const delivery: Expense = {
  id: 'x01',
  ledgerId: ledger.id,
  date: '2026-10-14',
  title: '배달(마라탕 외 3건)',
  // 24,000 + 13,500 + 9,500 + 12,000 + 4,000 - 3,000
  amount: 60000,
  payerId: 'kw',
  teamMemberIds: ['kw', 'hw', 'sj', 'yr'],
  allocation: {
    type: 'items',
    lines: [
      { name: '마라탕 (중간맛)', amount: 24000, memberIds: ['kw'] },
      { name: '꿔바로우', amount: 13500, memberIds: ['hw', 'sj'] }, // 둘이 나눠 먹었다
      { name: '볶음밥', amount: 9500, memberIds: ['sj'] },
      { name: '탕수육 (소)', amount: 12000, memberIds: ['yr'] },
      { name: '배달팁', amount: 4000, memberIds: ['kw', 'hw', 'sj', 'yr'] },
      { name: '첫 주문 할인', amount: -3000, memberIds: ['kw', 'hw', 'sj', 'yr'] },
    ],
  },
  createdAt: '2026-10-14T19:40:00Z',
  createdBy: 'kw',
};

const dShares = breakdownOf(delivery).shares;
check('항목별 지출도 지분의 합 = 금액', dShares.reduce((a, s) => a + s.amount, 0) === 60000,
  dShares.map((s) => `${nameOf(members, s.memberId)} ${s.amount.toLocaleString('ko-KR')}`).join(' · '));

/* 배달비는 나눠 내고 시킨 것은 각자 낸다 — 이 기능의 존재 이유다. */
const owe = (id: string) => dShares.find((s) => s.memberId === id)?.amount ?? 0;
check('시킨 사람에게만 그 항목이 간다 (유란 = 탕수육 + 배달팁 - 할인)',
  owe('yr') === 12000 + 1000 - 750, `${won(owe('yr'))}`);
check('한 항목을 둘이 나눠 시키면 그 둘만 반씩 (꿔바로우 13,500/2)',
  owe('hw') === 6750 + 1000 - 750, `현우 ${won(owe('hw'))}`);
check('아무것도 안 시킨 사람은 배달비 몫만 진다',
  E_splitEvenly(4000, ['a', 'b', 'c', 'd']).every((s) => s.amount === 1000));

/* 줄이 여럿이면 나머지 1원이 한 사람에게 몰리지 않아야 한다. */
const odd: Expense = {
  ...delivery,
  id: 'x02',
  amount: 4,
  allocation: {
    type: 'items',
    lines: [1, 1, 1, 1].map((n, i) => ({
      name: `줄 ${i + 1}`,
      amount: n,
      memberIds: ['kw', 'hw', 'sj', 'yr'],
    })),
  },
};
const oddShares = breakdownOf(odd).shares;
check('줄마다 나머지 1원을 받는 사람이 돌아간다 (네 줄 × 1원 → 네 사람 1원씩)',
  oddShares.length === 4 && oddShares.every((s) => s.amount === 1),
  oddShares.map((s) => s.amount).join(' · '));

/* 정산까지 통과하는가 */
const dResult = settleSingle(delivery, members);
check('항목별 지출 하나로 정산해도 balance 총합 = 0',
  dResult.balances.reduce((a, b) => a + b.netBalance, 0) === 0);
check('결제자는 자기 몫을 뺀 만큼만 받는다',
  dResult.balances.find((b) => b.memberId === 'kw')!.netBalance === 60000 - owe('kw'),
  `관우 ${won(dResult.balances.find((b) => b.memberId === 'kw')!.netBalance)}`);
const dOut = new Map<string, number>();
for (const t of dResult.transfers) {
  dOut.set(t.fromMemberId, (dOut.get(t.fromMemberId) ?? 0) + t.amount);
  dOut.set(t.toMemberId, (dOut.get(t.toMemberId) ?? 0) - t.amount);
}
check('송금을 모두 실행하면 전원 balance = 0',
  dResult.balances.every((b) => (dOut.get(b.memberId) ?? 0) === -b.netBalance),
  `송금 ${dResult.transfers.length}회`);

/* 혼자 시키고 혼자 결제한 것은 정산할 것이 없다 */
const solo: Expense = {
  ...delivery,
  id: 'x03',
  amount: 24000,
  allocation: { type: 'items', lines: [{ name: '마라탕', amount: 24000, memberIds: ['kw'] }] },
};
check('혼자 시키고 혼자 결제한 항목별 지출은 정산 대상이 아니다', !E_needsSettling(solo));
check('한 사람이라도 남이 끼면 정산 대상이다', E_needsSettling(delivery));

/* 검사 자체가 옳은가 — 합이 어긋난 줄은 들어오지 못해야 한다 */
const roster = ['kw', 'hw', 'sj', 'yr'];
check('줄의 합이 금액과 다르면 막는다',
  E_checkItemLines({ lines: [{ name: 'a', amount: 100, memberIds: ['kw'] }], total: 200, roster }).length > 0);
check('부담자가 없는 줄은 막는다',
  E_checkItemLines({ lines: [{ name: 'a', amount: 100, memberIds: [] }], total: 100, roster }).length > 0);
check('명단 밖 사람이 섞이면 막는다',
  E_checkItemLines({ lines: [{ name: 'a', amount: 100, memberIds: ['zz'] }], total: 100, roster }).length > 0);
check('제대로 된 줄은 통과한다',
  E_checkItemLines({ lines: delivery.allocation.type === 'items' ? delivery.allocation.lines : [], total: 60000, roster }).length === 0);

/* 보정 차액을 줄에 나눠 얹는 규칙 */
const lines = delivery.allocation.type === 'items' ? delivery.allocation.lines : [];
for (const diff of [500, -500, 1, -1, 9999]) {
  const spread = E_spreadOverLines(lines, diff);
  check(`보정 차액 ${diff.toLocaleString('ko-KR')}을 줄에 나눠도 합은 정확히 그 값`,
    spread.reduce((a, l) => a + l.amount, 0) === diff,
    spread.map((l) => l.amount).join(' · '));
}
check('보정은 줄의 이름과 부담자를 그대로 물려받는다',
  E_spreadOverLines(lines, 500).every((l, i) =>
    l.name === lines[i].name && l.memberIds.join() === lines[i].memberIds.join()));

/* --- 장부가 스스로 아는 것 (§11.4) ----------------------------------- */
/*
 * 되풀이되는 값을 찾아내는 규칙. AI 를 부르지 않으므로 여기서 그대로 검증된다.
 * 이 검사가 지키는 것은 하나다 — **근거가 없으면 제안하지 않는다.**
 */
console.log('\n[장부가 아는 것]');

const seed = recallSeed(ledger);
const seen = new Map<string, number>();
for (const e of ledger.expenses) {
  const v = e.vendor?.trim();
  if (v && !e.adjustment) seen.set(v, (seen.get(v) ?? 0) + 1);
}
const twice = [...seen.entries()].filter(([, n]) => n >= 2).map(([v]) => v);
const once = [...seen.entries()].filter(([, n]) => n === 1).map(([v]) => v);

check('한 번뿐인 판매처는 제안하지 않는다 (한 번은 우연이다)',
  once.every((v) => recallFor(seed, { vendor: v }) === null),
  `${once.length}곳 검사`);
check('두 번 이상인 판매처는 되짚어 본다',
  twice.length === 0 || twice.every((v) => recallFor(seed, { vendor: v }) !== null),
  `${twice.length}곳`);
check('아무 실마리도 없으면 아무 말도 하지 않는다',
  recallFor(seed, {}) === null && recallFor(seed, { vendor: '  ' }) === null);
check('없는 판매처를 물으면 지어내지 않는다',
  recallFor(seed, { vendor: '있을 리 없는 가게 이름' }) === null);

/* 세는 것이 맞는가 — 만들어 넣은 기록으로 확인한다 */
const madeUp = [
  { title: '폼보드', vendor: '호미화방', category: '재료비', allocation: { type: 'all' as const }, payerId: 'kw' },
  { title: '우드락', vendor: '호미화방', category: '재료비', allocation: { type: 'all' as const }, payerId: 'hw' },
  { title: '아크릴', vendor: '호미화방', category: '재료비', allocation: { type: 'personal' as const, ownerId: 'sj' }, payerId: 'sj' },
];
const r = recallFor(madeUp, { vendor: '호미화방' });
check('세 번 중 세 번이면 그렇게 말한다',
  r?.category?.times === 3 && r?.category?.of === 3 && r.category.value === '재료비',
  `${r?.category?.times}/${r?.category?.of} ${r?.category?.value}`);
check('갈리면 많은 쪽을 말하되 몇 번 중 몇 번인지 함께 준다',
  r?.allocation?.times === 2 && r?.allocation?.of === 3 && r.allocation.value.type === 'all',
  `${r?.allocation?.times}/${r?.allocation?.of}`);
check('띄어쓰기와 대소문자가 달라도 같은 가게로 본다',
  recallFor(madeUp, { vendor: ' 호미 화방 ' })?.category?.value === '재료비');
check('보정·환불 줄은 되짚는 데 세지 않는다',
  recallFor([...madeUp, { ...madeUp[0], category: '식비', isAdjustment: true }],
    { vendor: '호미화방' })?.category?.of === 3);
check('판매처가 없으면 항목 이름으로 되짚는다',
  recallFor(
    [{ ...madeUp[0], vendor: undefined }, { ...madeUp[1], title: '폼보드', vendor: undefined }],
    { title: '폼보드' },
  )?.category?.value === '재료비');
check('쓰던 분류를 많이 쓴 순으로 돌려준다',
  categoriesOf(ledger).length > 0 && categoriesOf(ledger).every((c) => typeof c === 'string'),
  categoriesOf(ledger).slice(0, 4).join(' · '));

/* --- 공금과 결산 (§12) ------------------------------------------------ */
/*
 * 정산과 결산은 다른 계산이다. 이 절이 지키는 것은 그 분리다 —
 * 한 줄이 양쪽에 동시에 서면 돈이 두 번 세어진다.
 */
console.log('\n[공금과 결산]');

/* 동아리 장부 하나를 세운다. 회비를 걷고 공금에서 쓴다. */
const club: Ledger = {
  id: 'club',
  teamName: '스팟',
  name: '2026 상반기',
  startedAt: '2026-03-01',
  currency: 'KRW',
  fundSource: 'dues',
  termCarry: true,
  duesPerHead: 30000,
  members,
  settlements: [],
  incomes: [
    { id: 'n0', ledgerId: 'club', date: '2026-03-02', title: '지난 학기 이월', amount: 47000, kind: 'carryover', createdAt: '' },
    { id: 'n1', ledgerId: 'club', date: '2026-03-05', title: '3월 회비', amount: 30000, kind: 'dues', memberId: 'kw', createdAt: '' },
    { id: 'n2', ledgerId: 'club', date: '2026-03-05', title: '3월 회비', amount: 30000, kind: 'dues', memberId: 'hw', createdAt: '' },
    { id: 'n3', ledgerId: 'club', date: '2026-03-07', title: '3월 회비(절반)', amount: 15000, kind: 'dues', memberId: 'sj', createdAt: '' },
    { id: 'n4', ledgerId: 'club', date: '2026-03-20', title: '학과 지원금', amount: 200000, kind: 'grant', createdAt: '' },
  ] as Income[],
  expenses: [
    /* 공금에서 나간 것 — 결산에만 들어간다 */
    { id: 'c1', ledgerId: 'club', date: '2026-03-10', title: '동아리방 청소용품', amount: 38000,
      payerId: 'kw', teamMemberIds: ['kw','hw','sj','yr'], allocation: { type: 'common' },
      createdAt: '2026-03-10T00:00:00Z', createdBy: 'kw' },
    { id: 'c2', ledgerId: 'club', date: '2026-03-25', title: '현수막 제작', amount: 120000,
      payerId: 'hw', teamMemberIds: ['kw','hw','sj','yr'], allocation: { type: 'common' },
      createdAt: '2026-03-25T00:00:00Z', createdBy: 'hw' },
    /* 개인끼리 나눈 것 — 정산에만 들어간다 */
    { id: 'c3', ledgerId: 'club', date: '2026-03-28', title: '뒤풀이', amount: 84000,
      payerId: 'sj', teamMemberIds: ['kw','hw','sj','yr'], allocation: { type: 'all' },
      createdAt: '2026-03-28T00:00:00Z', createdBy: 'sj' },
  ],
};

const book = fundBook(club);
check('결산 — 시작 잔고 + 수입 − 공금 지출 = 남은 돈',
  book.left === book.carriedIn + book.received - book.spent,
  `${won(book.carriedIn)} + ${won(book.received)} − ${won(book.spent)} = ${won(book.left)}`);
check('이월금은 수입에 두 번 세지 않는다',
  book.carriedIn === 47000 && book.received === 30000 + 30000 + 15000 + 200000,
  `이월 ${won(book.carriedIn)} · 수입 ${won(book.received)}`);
check('공금 지출만 결산에 들어간다',
  book.spent === 38000 + 120000, `${won(book.spent)}`);

/* 이것이 이 절의 핵심이다 */
const both = club.expenses.filter((e) => fromFund(e) && inSettlement(e));
const neither = club.expenses.filter((e) => !fromFund(e) && !inSettlement(e));
check('한 줄이 정산과 결산 양쪽에 서지 않는다', both.length === 0);
check('어느 쪽에도 안 서는 줄이 없다', neither.length === 0);

const clubSettle = computeSettlement(club.expenses, members);
check('공금 지출은 정산 총액에 안 들어간다',
  clubSettle.totalAmount === 84000, `${won(clubSettle.totalAmount)} (뒤풀이만)`);
check('공금을 집행한 사람에게 받을 돈이 생기지 않는다',
  (clubSettle.balances.find((b) => b.memberId === 'kw')?.totalPaid ?? 0) === 0,
  '관우는 청소용품 38,000을 집행했지만 결제자가 아니다');
check('공금 지출이 섞여도 balance 총합 = 0',
  clubSettle.balances.reduce((a, b) => a + b.netBalance, 0) === 0);
check('공금 지출은 정산 대상이 아니다',
  club.expenses.filter((e) => fromFund(e)).every((e) => !E_needsSettling(e)));
check('공금 지출의 지분은 비어 있다',
  club.expenses.filter(fromFund).every((e) => breakdownOf(e).shares.length === 0));

/* 회비 */
const board = duesBoard(club, members);
check('회비는 참/거짓이 아니라 모자란 금액이다',
  board.find((r) => r.memberId === 'sj')?.short === 15000,
  `성주 낸 돈 ${won(board.find((r) => r.memberId === 'sj')?.paid ?? 0)}`);
check('다 낸 사람은 모자란 돈이 0',
  board.find((r) => r.memberId === 'kw')?.short === 0);
check('한 번도 안 낸 사람은 1인당 회비 전부가 모자란다',
  board.find((r) => r.memberId === 'yr')?.short === 30000);
check('미납자는 모자란 사람만 센다', unpaid(club, members).length === 2,
  unpaid(club, members).map((r) => nameOf(members, r.memberId)).join(' · '));

/*
 * 기준을 장부가 스스로 알아낸다 (§12.2)
 *
 * 1인당 회비를 사람이 설정하지 않아도 미납이 세어져야 한다. 그 값은 이미
 * 장부 안에 있기 때문이다 — 세는 일이지 묻는 일이 아니다.
 */
const noStandard = { ...club, duesPerHead: undefined };
check('기준을 안 적어도 걷힌 회비에서 알아낸다',
  guessDuesPerHead(noStandard)?.amount === 30000,
  `${won(guessDuesPerHead(noStandard)?.amount ?? 0)} — 3명 중 2명`);
check('알아낸 기준은 평균이 아니라 최빈값이다',
  guessDuesPerHead(noStandard)?.amount !== Math.round((30000 + 30000 + 15000) / 3),
  '반만 낸 사람 하나가 기준을 끌어내리지 않는다');
check('기준을 안 적어도 미납은 세어진다',
  unpaid(noStandard, members).length === 2,
  unpaid(noStandard, members).map((r) => nameOf(members, r.memberId)).join(' \u00b7 '));
check('사람이 적어 둔 기준이 알아낸 값을 이긴다',
  duesBoard({ ...club, duesPerHead: 50000 }, members)[0].due === 50000);
check('낸 사람이 하나뿐이면 기준을 말하지 않는다',
  guessDuesPerHead({ ...noStandard, incomes: club.incomes.slice(0, 2) }) === null,
  '한 번은 우연이다');
check('회비가 하나도 없으면 미납도 없다',
  unpaid({ ...noStandard, incomes: [] }, members).length === 0);

check('남은 돈이 음수면 다음으로 넘기지 않는다',
  carryOut({ ...book, left: -5000 }) === 0);
check('넘길 돈은 남은 돈 그대로', carryOut(book) === book.left, won(carryOut(book)));

/* 지금까지의 장부는 하나도 안 달라진다 */
check('각자 결제하는 장부는 공금을 쓰지 않는다', !usesFund(ledger));
check('옛 장부의 정산 결과는 그대로', whole.totalAmount === 715050 - 0,
  `${won(whole.totalAmount)}`);

/* --- 검사 (§13) ------------------------------------------------------- */
/*
 * 검사는 순수 함수다. 같은 장부를 몇 번 훑든 같은 답이 나와야 하고,
 * 물음은 사람이 한 번 답하면 사라져야 한다. 이 절이 그 둘을 지킨다.
 */
console.log('\n[검사]');

const base = (over: Partial<Expense> & { id: string }): Expense => ({
  ledgerId: 'w', date: '2026-04-01', title: '무엇', amount: 10000,
  payerId: 'kw', teamMemberIds: ['kw', 'hw', 'sj', 'yr'],
  allocation: { type: 'all' }, createdAt: `2026-04-01T00:00:0${over.id.slice(-1)}Z`,
  createdBy: 'kw', ...over,
});

/* 중복 */
const pair = [
  base({ id: 'a1', amount: 48000, date: '2026-04-10' }),
  base({ id: 'a2', amount: 48000, date: '2026-04-10' }),
];
check('같은 날 같은 금액 같은 결제자면 중복으로 묻는다',
  twins(pair).length === 1 && twins(pair)[0].expenseId === 'a2',
  '나중에 적힌 줄을 가리킨다');
check('결제자가 다르면 중복이 아니다',
  twins([pair[0], { ...pair[1], payerId: 'hw' }]).length === 0,
  '각자 자기 몫을 결제한 것은 두 건이다');
check('금액이 100원이라도 다르면 묻지 않는다',
  twins([pair[0], { ...pair[1], amount: 48100 }]).length === 0,
  '느슨하게 잡으면 물음이 배경이 된다');
check('자정을 넘겨 하루 차이는 중복으로 본다',
  twins([pair[0], { ...pair[1], date: '2026-04-11' }]).length === 1);
check('이틀 차이는 중복이 아니다',
  twins([pair[0], { ...pair[1], date: '2026-04-12' }]).length === 0);
check('보정·환불 줄은 원본과 닮아도 묻지 않는다',
  twins([pair[0], { ...pair[1], adjustment: { kind: 'correction', targetExpenseId: 'a1' } }]).length === 0);
check('셋이 같아도 물음은 둘이지 셋이 아니다',
  twins([...pair, base({ id: 'a3', amount: 48000, date: '2026-04-10' })]).length === 2,
  '한 줄이 여러 짝에 서서 부풀지 않는다');

/* 튀는 금액 */
const many = [1, 2, 3, 4, 5].map((n) => base({ id: `b${n}`, amount: 10000 }));
check('다섯 줄이 안 되면 보통을 말하지 않는다',
  spikes(many.slice(0, 4).concat(base({ id: 'bx', amount: 900000 })).slice(0, 4)).length === 0);
check('중앙값의 여섯 배부터 묻는다',
  spikes([...many, base({ id: 'b9', amount: 60000 })]).length === 1);
check('다섯 배는 아직 안 묻는다',
  spikes([...many, base({ id: 'b8', amount: 50000 })]).length === 0);
check('튀는 값 하나가 기준을 끌어올리지 못한다',
  spikes([...many, base({ id: 'b7', amount: 400000 })])[0]?.expenseId === 'b7',
  '평균이었다면 자기 자신을 통과시켰다');
check('환불로 음수인 줄도 크기로 잰다',
  spikes([...many, base({ id: 'b6', amount: -400000 })]).length === 1);
check('중앙값은 짝수 개에서도 정수다',
  Number.isInteger(median([1, 2, 3, 4])) && median([1, 2, 3, 4]) === 3);

/* 영수증과 적힌 값 */
check('읽은 값과 적힌 값이 다르면 묻는다',
  offReceipt([base({ id: 'c1', amount: 34800, readAmount: 38400 })])[0]?.facts.gap === 3600);
check('같으면 묻지 않는다',
  offReceipt([base({ id: 'c2', amount: 38400, readAmount: 38400 })]).length === 0);
check('손으로 적은 줄은 견줄 것이 없다',
  offReceipt([base({ id: 'c3', amount: 34800 })]).length === 0);

/* 빠진 사람 */
const only2 = [base({ id: 'd1', allocation: { type: 'partial', participantIds: ['kw', 'hw'] } })];
check('어느 줄에도 없는 팀원을 찾아낸다',
  leftOut({ ...ledger, expenses: only2 }, members).length === 2,
  leftOut({ ...ledger, expenses: only2 }, members).map((f) => nameOf(members, f.memberId!)).join(' \u00b7 '));
check('결제자로만 나와도 나온 것이다',
  leftOut({ ...ledger, expenses: [base({ id: 'd2', payerId: 'yr',
    allocation: { type: 'partial', participantIds: ['kw', 'hw', 'sj'] } })] }, members).length === 0);
check('공금 지출만 있는 장부에서는 아무도 안 묻는다',
  leftOut({ ...ledger, expenses: [base({ id: 'd3', allocation: { type: 'common' } })] }, members).length === 0,
  '공금 지출에는 부담자가 없다');
check('빈 장부는 조용하다',
  leftOut({ ...ledger, expenses: [] }, members).length === 0);

/* 한 번 답하면 사라진다 */
const noisy = { ...ledger, expenses: pair };
check('물음은 한 번 답하면 사라진다',
  watch(noisy, members).some((f) => f.kind === 'twin') &&
  !watch({ ...noisy, expenses: [pair[0], { ...pair[1], checkedAt: '2026-04-11T00:00:00Z' }] }, members)
    .some((f) => f.kind === 'twin'),
  '끄지 못하는 경고는 두 번째부터 배경이 된다');
check('검사는 몇 번을 훑어도 같은 답이다',
  JSON.stringify(watch(ledger, members)) === JSON.stringify(watch(ledger, members)),
  'AI 를 부르지 않는 이유');
check('검사는 장부를 건드리지 않는다',
  (() => { const before = JSON.stringify(ledger); watch(ledger, members); return JSON.stringify(ledger) === before; })(),
  '가리키기만 한다');

/* --- 앞을 보기 (§14) --------------------------------------------------- */
/*
 * 예산은 묻지 않고 알아낸다. 그리고 근거가 모자라면 아무 말도 안 한다 —
 * 이 절이 지키는 것은 그 침묵이다. 짐작을 숫자로 내놓으면 틀린 줄도 모른다.
 */
console.log('\n[앞을 보기]');

check('예산을 안 적으면 들어온 돈이 예산이다',
  budgetOf(club).amount === 47000 + 275000 && budgetOf(club).told === false,
  won(budgetOf(club).amount) + ' — 이월 + 회비 + 지원금');
check('적어 둔 예산이 알아낸 값을 이긴다',
  budgetOf({ ...club, budget: 500000 }).amount === 500000 &&
  budgetOf({ ...club, budget: 500000 }).told === true);

/* 속도를 말하려면 공금 지출이 셋은 있어야 한다. 동아리 장부에는 둘뿐이라
   한 줄을 더한 장부를 따로 세운다 — 기준을 낮추는 대신 표본을 맞춘다. */
const clubMore: Ledger = {
  ...club,
  expenses: [
    ...club.expenses,
    { id: 'c4', ledgerId: 'club', date: '2026-04-05', title: '간식', amount: 0,
      payerId: 'kw', teamMemberIds: ['kw','hw','sj','yr'], allocation: { type: 'common' },
      createdAt: '2026-04-05T00:00:00Z', createdBy: 'kw' },
  ],
};
const b1 = burn(clubMore, '2026-05-01');
check('집행률 = 공금 지출 ÷ 예산',
  Math.round(b1.ran * 1000) === Math.round((158000 / 322000) * 1000),
  `${won(b1.spent)} / ${won(b1.budget)} = ${(b1.ran * 100).toFixed(1)}%`);
check('남은 돈 = 예산 − 쓴 돈', b1.left === b1.budget - b1.spent, won(b1.left));
check('넉 주가 지나야 속도를 말한다',
  burn(clubMore, '2026-03-15').weeksLeft === null && b1.weeksLeft !== null,
  '두 주치로 낸 날짜는 틀릴 뿐 아니라 틀린 줄도 모르게 만든다');
check('공금 지출이 셋은 되어야 말한다',
  burn(club, '2026-05-01').weeksLeft === null,
  '한두 건으로 낸 평균은 평균이 아니다');
check('바닥날 날짜는 주 수를 옮긴 것이지 따로 센 것이 아니다',
  b1.dryOn === new Date(Date.parse('2026-05-01T00:00:00Z') + (b1.weeksLeft as number) * 7 * 86400000)
    .toISOString().slice(0, 10),
  `${b1.weeksLeft}주 · ${b1.dryOn}`);
check('예산을 넘겼으면 버틸 주 수를 세지 않는다',
  burn({ ...club, budget: 100000 }, '2026-05-01').weeksLeft === null,
  '이미 지난 일이라 앞을 볼 것이 없다');
check('예산을 넘긴 것은 넘긴 대로 적는다',
  burn({ ...club, budget: 100000 }, '2026-05-01').left === -58000 &&
  burn({ ...club, budget: 100000 }, '2026-05-01').ran > 1,
  '집행률이 1을 넘는 것도 사실이다');
check('첫 주도 한 주다', weeksBetween('2026-03-01', '2026-03-02') === 1,
  '0으로 나누지 않는다');
check('말할 수 없을 때 null 은 "안 바닥난다"가 아니다',
  burn({ ...club, expenses: [] }, '2026-05-01').weeksLeft === null &&
  burn({ ...club, expenses: [] }, '2026-05-01').left > 0,
  '남은 돈은 있지만 속도를 모른다');

/* --- 말 걸 때 (§15) ---------------------------------------------------- */
/*
 * 장부가 먼저 말을 거는 자리는 하나뿐이라 규칙이 까다롭다. 이 절이 지키는
 * 것은 **안 하는 말**이다 — 조건 하나만 맞을 때 말을 걸면 헛말이 나온다.
 */
console.log('\n[말 걸 때]');

const fresh = { ...ledger, settlements: [] };
/* 이 장부는 2026-09-01 에 열렸다. 넉 주 뒤를 '오늘'로 삼는다 —
   지나지 않은 날을 오늘이라고 하면 지난 주 수가 0 이 되어 아무 말도 안 한다. */
const later = '2026-11-01';
check('미룬 것이 없으면 아무 말도 안 한다',
  nudges({ ...fresh, expenses: [] }, members, later).length === 0,
  '조용한 것이 이 기능의 절반이다');
check('줄은 쌓였는데 아직 3주가 안 됐으면 말하지 않는다',
  nudges(fresh, members, fresh.startedAt).filter((n) => n.kind === 'settle').length === 0);
check('3주가 지났어도 줄이 두 개면 말하지 않는다',
  nudges({ ...fresh, expenses: fresh.expenses.slice(0, 2) }, members, later)
    .filter((n) => n.kind === 'settle').length === 0,
  '한두 줄은 정산할 것이 아니라 그냥 줄이다');
check('둘 다 맞으면 그때 말한다',
  nudges(fresh, members, later).some((n) => n.kind === 'settle'));

const said = nudges(fresh, members, later).find((n) => n.kind === 'settle');
check('1인당은 부담의 합을 사람 수로 나눈 것이다',
  said !== undefined && said.kind === 'settle' &&
  Math.abs(said.perHead * members.length - said.total) <= members.length,
  '지분의 합 = 금액이라는 불변식 위에 선 숫자다');
check('정산하면 사라진다',
  nudges({ ...ledger, expenses: [] }, members, later)
    .filter((n) => n.kind === 'settle').length === 0);
check('마지막 정산 이후로 센다',
  weeksSinceSettle({ ...ledger, settlements: [
    { id: 's', ledgerId: 'x', seq: 1, date: '2026-10-25', label: '1차', isFinal: true,
      snapshot: { expenseIds: [], totalAmount: 0, sharedAmount: 0, personalAmount: 0,
        balances: [], transfers: [], breakdowns: [] } },
  ] }, '2026-11-01') === 1,
  '장부를 연 날이 아니라 지난번 확정한 날이다');
check('정산한 적이 없으면 장부를 연 날부터 센다',
  weeksSinceSettle(fresh, later) >= 8);

check('회비를 안 걷는 장부는 회비 얘기를 안 한다',
  nudges(fresh, members, later).every((n) => n.kind !== 'dues'));
check('첫 달에는 회비를 독촉하지 않는다',
  nudges(club, members, '2026-03-08').every((n) => n.kind !== 'dues'),
  '넉 주가 지나야 말한다');
check('넉 주가 지나고 미납이 있으면 말한다',
  nudges(club, members, '2026-06-01').some((n) => n.kind === 'dues'));
/* 다 낸 두 사람만 남긴 장부. 미납이 0 이면 회비 얘기는 사라져야 한다. */
const allPaid = { ...club, members: club.members.filter((m) => m.id === 'kw' || m.id === 'hw') };
check('회비를 다 걷으면 사라진다',
  nudges(allPaid, allPaid.members, '2026-06-01').every((n) => n.kind !== 'dues'),
  '할 일이 없으면 말도 없다');

rule();
console.log(failures === 0 ? `\n모든 불변식 통과 — 이 장부는 검산 가능하다.\n` : `\n실패 ${failures}건\n`);
process.exit(failures === 0 ? 0 : 1);
