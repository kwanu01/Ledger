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
import type { MemberBalance, SettlementResult } from '../lib/domain/types.ts';

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
const jsWith = whole.balances.find((b) => b.memberId === 'js')!.netBalance;
const jsWithout = withoutE18.balances.find((b) => b.memberId === 'js')!.netBalance;
check('결제자 ≠ 귀속자인 개인 귀속은 귀속자 채무로 반영 (e18 드라이버)',
  jsWithout - jsWith === 39000, `지수 balance ${won(jsWithout)} → ${won(jsWith)}`);

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
check('총지출 = 정산 완료 + 미정산', summary.totalSpent === summary.settledAmount + summary.unsettledAmount,
  `${won(summary.totalSpent)} = ${won(summary.settledAmount)} + ${won(summary.unsettledAmount)}`);
check('중간 정산을 해도 Expense 원본은 전부 그대로 남는다', ledger.expenses.length === 22, '22건');

console.log('\n[팀원 변동 · 보정 · 환불]');
const firstCycleExpenses = ledger.expenses.filter((e) => ledger.settlements[0].snapshot.expenseIds.includes(e.id));
const recomputedWithNewMember = computeSettlement(firstCycleExpenses, members);
check('태윤이 나중에 합류해도 1차 정산 결과는 한 푼도 바뀌지 않는다',
  recomputedWithNewMember.balances.every((b) => {
    const old = first.balances.find((x) => x.memberId === b.memberId);
    return old && old.netBalance === b.netBalance;
  }) && recomputedWithNewMember.balances.length === 4,
  '1차 정산 대상자 4명 유지');
check('10월 지출은 5인으로 나뉜다 (e17 전시 판넬)',
  breakdownOf(ledger.expenses.find((e) => e.id === 'e17')!).shares.length === 5,
  `96,000/5 = ${(96000 / 5).toLocaleString('ko-KR')}`);
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

rule();
console.log(failures === 0 ? `\n모든 불변식 통과 — 이 장부는 검산 가능하다.\n` : `\n실패 ${failures}건\n`);
process.exit(failures === 0 ? 0 : 1);
