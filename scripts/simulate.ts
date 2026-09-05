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
import type { Expense, SettlementResult } from '../lib/domain/types.ts';

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

rule();
console.log(failures === 0 ? `\n모든 불변식 통과 — 이 장부는 검산 가능하다.\n` : `\n실패 ${failures}건\n`);
process.exit(failures === 0 ? 0 : 1);
