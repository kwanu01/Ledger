/**
 * Ledger — Settlement Engine
 *
 * 이 파일은 UI, 프레임워크, DB에 전혀 의존하지 않는다.
 * 순수 함수만 있으므로 Node에서도 브라우저에서도 그대로 돈다.
 *
 * 설계 기준 (Master Context §13, §28.3)
 * - 정확한 것보다 "사용자가 머릿속으로 검산할 수 있는 것"이 먼저다.
 * - 따라서 결과 숫자뿐 아니라 그 숫자가 나온 경로(shares, paid, owed)를 항상 함께 반환한다.
 */

import { formatMoney } from './money.ts';
import type {
  Expense,
  ExpenseId,
  ExpenseBreakdown,
  Ledger,
  Member,
  MemberBalance,
  MemberId,
  SettlementResult,
  Share,
  Transfer,
} from './types.ts';

/* ------------------------------------------------------------------ */
/* 1. 지분 계산                                                        */
/* ------------------------------------------------------------------ */

/**
 * 금액을 인원수로 나눈다. 원 단위 정수이므로 나머지가 생길 수 있다.
 *
 * 나머지는 버리거나 반올림하지 않는다. 1원씩 앞사람부터 배분하여
 * 지분의 합이 항상 원래 금액과 정확히 같도록 한다.
 *   21,500 / 3명 → 7,167 · 7,167 · 7,166
 *
 * 환불·보정으로 음수 금액이 들어와도 같은 규칙이 그대로 성립한다.
 *   -2,501 / 4명 → -625 · -625 · -625 · -626
 *
 * 배분받은 사람은 roundingAdjusted = true 로 표시해서
 * UI가 "7,166 (+1)" 처럼 숨기지 않고 드러낼 수 있게 한다. (§23.3 계산은 숨기지 않는다)
 */
export function splitEvenly(amount: number, memberIds: MemberId[]): Share[] {
  if (memberIds.length === 0) return [];
  const base = Math.floor(amount / memberIds.length);
  const remainder = amount - base * memberIds.length;
  return memberIds.map((memberId, i) => ({
    memberId,
    amount: base + (i < remainder ? 1 : 0),
    roundingAdjusted: i < remainder,
  }));
}

/**
 * 부담 방식에 따라 실제로 비용을 나눠 갖는 멤버 목록.
 *
 * '전체 팀'의 기준은 현재 팀원이 아니라 **지출에 박아둔 기록 시점 명단**이다.
 * 팀원이 나중에 합류하거나 빠져도 과거 지출의 지분은 흔들리지 않는다.
 */
export function bearersOf(expense: Expense): MemberId[] {
  const roster = expense.teamMemberIds;
  switch (expense.allocation.type) {
    case 'all':
      return roster;
    case 'partial': {
      // 명단 순서를 유지해야 나머지 배분이 결정적(deterministic)이다.
      const picked = expense.allocation.participantIds;
      return roster.filter((id) => picked.includes(id));
    }
    case 'personal':
      return [expense.allocation.ownerId];
  }
}

export function breakdownOf(expense: Expense): ExpenseBreakdown {
  return {
    expense,
    shares: splitEvenly(expense.amount, bearersOf(expense)),
    countsTowardShared: expense.allocation.type !== 'personal',
  };
}

/** 이 지출을 보정하거나 환불한 항목들 */
export function adjustmentsFor(expenses: Expense[], targetId: ExpenseId): Expense[] {
  return expenses.filter((e) => e.adjustment?.targetExpenseId === targetId);
}

/** 원 지출 + 그에 달린 보정·환불을 합친 실효 금액 */
export function effectiveAmount(expenses: Expense[], expense: Expense): number {
  return expense.amount + adjustmentsFor(expenses, expense.id).reduce((a, e) => a + e.amount, 0);
}

/* ------------------------------------------------------------------ */
/* 2. Balance 계산                                                     */
/* ------------------------------------------------------------------ */

/**
 * balance = 실제 결제한 금액 - 본인이 부담해야 할 금액   (§13.2)
 *   양수 → 받을 돈
 *   음수 → 보낼 돈
 *
 * 개인 귀속 비용은 "제외"하는 것이 아니라 귀속자 1인이 100% 부담하는 것으로 처리한다.
 * 결제자 = 귀속자인 경우 paid와 owed가 같은 금액으로 상쇄되어 공동 정산 영향이 0이 된다. (§10.3)
 * 결제자 ≠ 귀속자인 경우(팀원이 대신 결제)에는 귀속자가 결제자에게 갚아야 하므로 반영된다.
 */
export function computeBalances(expenses: Expense[], members: Member[]): MemberBalance[] {
  const paid = new Map<MemberId, number>(members.map((m) => [m.id, 0]));
  const owed = new Map<MemberId, number>(members.map((m) => [m.id, 0]));

  for (const expense of expenses) {
    paid.set(expense.payerId, (paid.get(expense.payerId) ?? 0) + expense.amount);
    for (const share of breakdownOf(expense).shares) {
      owed.set(share.memberId, (owed.get(share.memberId) ?? 0) + share.amount);
    }
  }

  return members.map((m) => {
    const totalPaid = paid.get(m.id) ?? 0;
    const totalOwed = owed.get(m.id) ?? 0;
    return { memberId: m.id, totalPaid, totalOwed, netBalance: totalPaid - totalOwed };
  });
}

/* ------------------------------------------------------------------ */
/* 3. 송금 관계 단순화                                                 */
/* ------------------------------------------------------------------ */

/**
 * 채권/채무를 송금 목록으로 바꾼다. (§13.4)
 *
 * 최소 송금 횟수를 구하는 문제는 NP-hard지만, 여기서는 일부러 풀지 않는다.
 * "가장 많이 낼 사람 → 가장 많이 받을 사람" 순으로 큰 것부터 상계하는
 * greedy 방식은 최대 (인원수 - 1)회로 줄여주면서, 결과를 사람이 눈으로 따라갈 수 있다.
 * 최적해를 위해 이해 불가능한 송금 조합을 만드는 것은 UX 실패다. (§13.4)
 */
export function minimizeTransfers(balances: MemberBalance[]): Transfer[] {
  const creditors = balances
    .filter((b) => b.netBalance > 0)
    .map((b) => ({ id: b.memberId, remaining: b.netBalance }))
    .sort((a, b) => b.remaining - a.remaining);
  const debtors = balances
    .filter((b) => b.netBalance < 0)
    .map((b) => ({ id: b.memberId, remaining: -b.netBalance }))
    .sort((a, b) => b.remaining - a.remaining);

  const transfers: Transfer[] = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const credit = creditors[ci];
    const debt = debtors[di];
    const amount = Math.min(credit.remaining, debt.remaining);
    if (amount > 0) {
      transfers.push({ fromMemberId: debt.id, toMemberId: credit.id, amount });
      credit.remaining -= amount;
      debt.remaining -= amount;
    }
    if (credit.remaining === 0) ci += 1;
    if (debt.remaining === 0) di += 1;
  }
  return transfers;
}

/* ------------------------------------------------------------------ */
/* 4. 정산 결과                                                        */
/* ------------------------------------------------------------------ */

/**
 * 이 지출 묶음에 실제로 얽힌 팀원만 추린다.
 * 나중에 합류한 팀원이 과거 정산 화면에 0원짜리 줄로 나타나지 않도록 하기 위한 것.
 */
export function relevantMembers(expenses: Expense[], allMembers: Member[]): Member[] {
  const ids = new Set<MemberId>();
  for (const e of expenses) {
    ids.add(e.payerId);
    for (const id of bearersOf(e)) ids.add(id);
  }
  return allMembers.filter((m) => ids.has(m.id));
}

export function computeSettlement(expenses: Expense[], allMembers: Member[]): SettlementResult {
  const breakdowns = expenses.map((e) => breakdownOf(e));
  const balances = computeBalances(expenses, relevantMembers(expenses, allMembers));
  const sum = (list: ExpenseBreakdown[]) => list.reduce((acc, b) => acc + b.expense.amount, 0);

  return {
    expenseIds: expenses.map((e) => e.id),
    totalAmount: sum(breakdowns),
    sharedAmount: sum(breakdowns.filter((b) => b.countsTowardShared)),
    personalAmount: sum(breakdowns.filter((b) => !b.countsTowardShared)),
    balances,
    transfers: minimizeTransfers(balances),
    breakdowns,
  };
}

/* ------------------------------------------------------------------ */
/* 5. 누적 장부 (§12)                                                  */
/* ------------------------------------------------------------------ */

/** 이미 확정된 Settlement에 포함된 Expense id 집합 */
export function settledExpenseIds(ledger: Ledger): Set<string> {
  const ids = new Set<string>();
  for (const s of ledger.settlements) {
    for (const id of s.snapshot.expenseIds) ids.add(id);
  }
  return ids;
}

/**
 * 정산할 것이 있는 지출인가 (§13.2)
 *
 * 자기가 사서 자기가 가져가는 지출은 아무에게도 줄 것도 받을 것도 없다.
 * 프로젝트 총지출에는 들어가지만 공동 balance는 한 푼도 움직이지 않는다.
 *
 * 그런 줄이 '아직 정산 안 함'에 쌓여 있으면 화면이 거짓말을 한다. 정산해야
 * 할 것이 남은 것처럼 보이는데, 정산을 눌러도 그 줄에서는 아무 송금도 나오지
 * 않는다. 그래서 처음부터 정산 대상에서 뺀다.
 *
 * 결제자와 귀속자가 다른 개인 지출은 다르다. 대신 사 준 것이므로 귀속자가
 * 결제자에게 갚아야 한다 — 그건 정산 대상이다.
 */
export function needsSettling(expense: Expense): boolean {
  const a = expense.allocation;
  if (a.type !== 'personal') return true;
  return a.ownerId !== expense.payerId;
}

/** 아직 정산하지 않았고, 정산할 것이 남아 있는 지출 */
export function unsettledExpenses(ledger: Ledger): Expense[] {
  const settled = settledExpenseIds(ledger);
  return ledger.expenses.filter((e) => !settled.has(e.id) && needsSettling(e));
}

/** 정산할 것이 애초에 없는 지출 — 자기가 사서 자기가 가져간 것 */
export function selfPaidExpenses(ledger: Ledger): Expense[] {
  const settled = settledExpenseIds(ledger);
  return ledger.expenses.filter((e) => !settled.has(e.id) && !needsSettling(e));
}

export type LedgerSummary = {
  /** 프로젝트 전체 기간 총지출 (개인 귀속 포함) — 정산해도 절대 초기화되지 않는다 */
  totalSpent: number;
  settledAmount: number;
  unsettledAmount: number;
  /** 정산할 것이 애초에 없는 금액 — 자기가 사서 자기가 가져간 것 */
  selfPaidAmount: number;
  /** 공동 정산 대상 금액 (총지출 ≠ 정산 대상, §23.4) */
  sharedTotal: number;
  personalTotal: number;
  expenseCount: number;
  /** 지금 정산하면 나올 결과 */
  pending: SettlementResult;
};

export function summarizeLedger(ledger: Ledger): LedgerSummary {
  const settled = settledExpenseIds(ledger);
  // 아직 정산하지 않은 줄 중에서도, 주고받을 것이 있는 것만 '미정산'이다.
  const open = ledger.expenses.filter((e) => !settled.has(e.id) && needsSettling(e));
  const mine = ledger.expenses.filter((e) => !settled.has(e.id) && !needsSettling(e));
  const total = (list: Expense[]) => list.reduce((acc, e) => acc + e.amount, 0);
  const all = computeSettlement(ledger.expenses, ledger.members);

  return {
    totalSpent: total(ledger.expenses),
    settledAmount: total(ledger.expenses.filter((e) => settled.has(e.id))),
    unsettledAmount: total(open),
    selfPaidAmount: total(mine),
    sharedTotal: all.sharedAmount,
    personalTotal: all.personalAmount,
    expenseCount: ledger.expenses.length,
    pending: computeSettlement(open, ledger.members),
  };
}

/**
 * 지금 지출을 기록한다면 박아둘 팀원 명단.
 * 이탈한 팀원은 빠지지만, 과거 지출에 이미 박힌 명단은 건드리지 않는다.
 */
export function currentRoster(ledger: Ledger): MemberId[] {
  return ledger.members.filter((m) => m.active !== false).map((m) => m.id);
}

/** 단일 항목 정산 (§15) — 전체 누적 정산과 별개로 제공 */
export function settleSingle(expense: Expense, members: Member[]): SettlementResult {
  return computeSettlement([expense], members);
}

/* ------------------------------------------------------------------ */
/* 6. 표시 보조                                                        */
/* ------------------------------------------------------------------ */

/** 기본 표기(원). 통화·언어를 바꿔 쓸 때는 money.ts의 formatMoney를 직접 쓴다. */
export function won(n: number): string {
  return formatMoney(n, 'KRW', 'ko');
}

export function nameOf(members: Member[], id: MemberId): string {
  return members.find((m) => m.id === id)?.name ?? id;
}

/**
 * 표의 한 칸에 들어갈 부담 방식 표기.
 * 가운뎃점 같은 구분자를 쓰지 않는다. 한 칸에는 한 덩어리만 넣는다.
 */
export function allocationLabel(expense: Expense, members: Member[]): string {
  const a = expense.allocation;
  switch (a.type) {
    case 'all':
      return `공동 ${expense.teamMemberIds.length}인`;
    case 'partial':
      return `일부 ${a.participantIds.length}인`;
    case 'personal':
      return `${nameOf(members, a.ownerId)} 개인`;
  }
}


/**
 * 장부에서 두 줄의 앞뒤 (§13)
 *
 * 날짜가 먼저다. 같은 날이면 **적은 차례**다.
 *
 * 전에는 같은 날일 때 id 를 비교했다. id 는 무작위라서, 나중에 적은 것이
 * 위로 올라오기도 하고 아래로 가기도 했다 — 같은 날 세 건을 적으면 그 셋의
 * 순서가 매번 다르게 보였다. 장부에서 줄의 앞뒤는 뜻이 있는 정보다.
 * 무엇을 먼저 적었는지가 곧 그 순서여야 한다.
 *
 * 화면에는 날짜만 적는다. 몇 시 몇 분에 적었는지는 정렬에만 쓰지, 사람이
 * 읽을 것이 아니다 — 장부에 필요한 것은 지출이 일어난 날이지 타자를 친
 * 시각이 아니다.
 *
 * createdAt 이 비어 있을 수 있는 옛 줄은 id 로 물러난다. 순서가 흔들리더라도
 * 터지지는 않게.
 */
export function byEntryOrder(a: Expense, b: Expense): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const at = a.createdAt ?? '';
  const bt = b.createdAt ?? '';
  if (at !== bt) return at < bt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}
