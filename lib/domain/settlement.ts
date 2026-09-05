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
  ItemLine,
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
 *
 * startAt 은 그 1원을 **누구부터** 주느냐다. 기본값 0 — 명단 맨 앞부터다.
 * 영수증 한 장을 여러 줄로 갈라 적을 때(§10.4)만 줄마다 이 자리를 한 칸씩
 * 미룬다. 안 그러면 줄이 넷이고 넷 다 나머지가 1원이면 맨 앞사람 혼자
 * 4원을 더 낸다. 한 줄에서 1원은 반올림이지만, 스무 줄에서 20원은 오류로 보인다.
 */
export function splitEvenly(amount: number, memberIds: MemberId[], startAt = 0): Share[] {
  const n = memberIds.length;
  if (n === 0) return [];
  const base = Math.floor(amount / n);
  // 금액이 음수여도 floor 때문에 나머지는 언제나 0 이상 n 미만이다.
  const remainder = amount - base * n;
  const from = ((startAt % n) + n) % n;
  return memberIds.map((memberId, i) => {
    const got = ((i - from + n) % n) < remainder;
    return { memberId, amount: base + (got ? 1 : 0), roundingAdjusted: got };
  });
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
    case 'items': {
      const touched = new Set<MemberId>();
      for (const line of expense.allocation.lines) {
        for (const id of line.memberIds) touched.add(id);
      }
      return roster.filter((id) => touched.has(id));
    }
    /*
     * 공금 지출에는 부담자가 없다 (§12).
     *
     * 빈 목록을 돌려주는 것이 이 함수에서 유일하게 "아무도 아님"을 뜻하는
     * 자리다. 다른 갈래는 전부 최소 한 사람이 나온다.
     */
    case 'common':
      return [];
  }
}

/**
 * 영수증 줄들이 성립하는가 (§10.4)
 *
 * 여기서 막지 않으면 지분의 합이 금액과 어긋난다. 그러면 정산 화면의
 * 숫자가 조용히 틀리는데, 장부에서 그것보다 나쁜 일은 없다.
 *
 * 맞으면 빈 배열, 틀리면 사람이 읽을 수 있는 이유들을 돌려준다.
 * 화면에서도 서버에서도 이 함수 하나만 부른다.
 */
export function checkItemLines(args: {
  lines: ItemLine[];
  total: number;
  roster: MemberId[];
}): string[] {
  const bad: string[] = [];
  if (args.lines.length === 0) bad.push('항목이 하나도 없습니다.');

  const known = new Set(args.roster);
  let sum = 0;
  for (const [i, line] of args.lines.entries()) {
    sum += line.amount;
    if (!Number.isInteger(line.amount)) bad.push(`${i + 1}번째 줄의 금액이 정수가 아닙니다.`);
    if (line.memberIds.length === 0) {
      bad.push(`'${line.name || `${i + 1}번째 줄`}'을 누가 부담할지 고르지 않았습니다.`);
    }
    if (new Set(line.memberIds).size !== line.memberIds.length) {
      bad.push(`'${line.name || `${i + 1}번째 줄`}'에 같은 사람이 두 번 들어 있습니다.`);
    }
    for (const id of line.memberIds) {
      if (!known.has(id)) bad.push(`'${line.name || `${i + 1}번째 줄`}'에 이 장부의 팀원이 아닌 사람이 있습니다.`);
    }
  }

  // 이것이 이 함수의 존재 이유다. 줄의 합과 결제 총액은 반드시 같아야 한다.
  if (sum !== args.total) {
    bad.push(`항목 합계(${sum.toLocaleString('ko-KR')})가 결제 금액(${args.total.toLocaleString('ko-KR')})과 다릅니다.`);
  }
  return bad;
}

/**
 * 이 지출에서 각자가 실제로 부담하는 금액.
 *
 * 줄마다 부담자가 다른 지출(items)은 **줄 단위로 나눈 뒤 사람별로 합친다.**
 * 총액을 한 번에 나누는 것이 아니다 — 그러면 마라탕 값과 배달비가 섞여
 * 누가 무엇 때문에 얼마를 내는지 되짚을 수 없게 된다.
 *
 * 어느 경우에도 지분의 합은 expense.amount 와 정확히 같다.
 */
export function sharesOfLines(lines: ItemLine[], roster: MemberId[]): Share[] {
  const total = new Map<MemberId, number>();
  const bumped = new Set<MemberId>();

  for (const [i, line] of lines.entries()) {
    // 명단 순서로 세워야 나머지 1원이 매번 같은 사람에게 간다.
    const on = roster.filter((id) => line.memberIds.includes(id));
    // 줄마다 나머지를 받는 자리를 한 칸씩 미룬다.
    for (const s of splitEvenly(line.amount, on, i)) {
      total.set(s.memberId, (total.get(s.memberId) ?? 0) + s.amount);
      if (s.roundingAdjusted) bumped.add(s.memberId);
    }
  }

  return roster
    .filter((id) => total.has(id))
    .map((id) => ({
      memberId: id,
      amount: total.get(id) ?? 0,
      roundingAdjusted: bumped.has(id),
    }));
}

export function sharesOf(expense: Expense): Share[] {
  const a = expense.allocation;
  if (a.type !== 'items') return splitEvenly(expense.amount, bearersOf(expense));
  return sharesOfLines(a.lines, expense.teamMemberIds);
}

/** 줄마다 누가 얼마를 부담하는지 — 화면에서 "이 항목은 누구 몫"을 보여 줄 때 쓴다. */
export function lineSharesOf(expense: Expense): { line: ItemLine; shares: Share[] }[] {
  const a = expense.allocation;
  if (a.type !== 'items') return [];
  const roster = expense.teamMemberIds;
  return a.lines.map((line, i) => ({
    line,
    shares: splitEvenly(line.amount, roster.filter((id) => line.memberIds.includes(id)), i),
  }));
}

export function breakdownOf(expense: Expense): ExpenseBreakdown {
  const t = expense.allocation.type;
  return {
    expense,
    shares: sharesOf(expense),
    // 개인 귀속도 공금도 '공동 정산 대상'이 아니다. 앞은 한 사람 것이고
    // 뒤는 아무의 것도 아니라서, 이유는 다르지만 결과는 같다.
    countsTowardShared: t !== 'personal' && t !== 'common',
  };
}

/**
 * 이 지출이 정산이라는 계산에 들어가는가 (§12)
 *
 * 공금 지출만 빠진다. 회비나 지원금으로 모아 둔 돈에서 나갔으므로 사람
 * 사이에 오갈 것이 없다 — **결제자조차** 잔액이 움직이지 않는다. 누가
 * 카드를 긁었는지는 기록이지 채권이 아니다.
 *
 * 이 한 줄이 정산과 결산을 가르는 자리다. 여기서 걸러 두면 아래의 모든
 * 계산과 쉰 개 불변식이 지금까지의 전제("지분의 합 = 금액") 위에 그대로 선다.
 */
export function inSettlement(expense: Expense): boolean {
  return expense.allocation.type !== 'common';
}

/**
 * 줄마다 부담자가 다른 지출을 보정할 때, 그 차액을 줄에 어떻게 나눠 얹는가 (§10.4)
 *
 * 보정은 "이 영수증 전체에서 얼마가 달라졌다"를 적는 일이다. 어느 줄이
 * 달라졌는지는 대개 모른다 — 카드 명세서에는 총액 하나만 찍혀 나온다.
 *
 * 그래서 **원래 줄 금액에 비례해서** 나눈다. 5만 원짜리 영수증에서 500원이
 * 어긋났다면 큰 줄이 더 많이 어긋났다고 보는 것이 자연스럽고, 무엇보다
 * 특정 한 사람에게 차액을 통째로 떠넘기지 않는다.
 *
 * 어느 줄이 얼마나 달라졌는지 아는 경우에는 이 함수를 쓰지 않는다. 그때는
 * 그 줄만 담은 보정을 적으면 된다.
 *
 * 합은 언제나 정확히 diff 다 — 최대 나머지 방식으로 1원까지 맞춘다.
 */
export function spreadOverLines(lines: ItemLine[], diff: number): ItemLine[] {
  if (lines.length === 0) return [];

  const weight = lines.reduce((a, l) => a + Math.abs(l.amount), 0);
  // 원본 줄이 전부 0원이면 비율이랄 것이 없다. 첫 줄에 얹는다.
  if (weight === 0) return lines.map((l, i) => ({ ...l, amount: i === 0 ? diff : 0 }));

  const raw = lines.map((l) => (diff * Math.abs(l.amount)) / weight);
  const out = raw.map((x) => Math.floor(x));
  const left = diff - out.reduce((a, b) => a + b, 0);
  // 소수 부분이 큰 줄부터 1원씩. 같으면 앞줄부터 — 매번 같은 결과가 나와야 한다.
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < left; k += 1) out[order[k % order.length].i] += 1;

  return lines.map((l, i) => ({ ...l, amount: out[i] }));
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
    // 공금에서 나간 것은 사람의 돈이 아니다. 낸 쪽에도 진 쪽에도 안 적는다.
    if (!inSettlement(expense)) continue;
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
    if (!inSettlement(e)) continue;
    ids.add(e.payerId);
    for (const id of bearersOf(e)) ids.add(id);
  }
  return allMembers.filter((m) => ids.has(m.id));
}

export function computeSettlement(expenses: Expense[], allMembers: Member[]): SettlementResult {
  // 정산의 대상은 사람 사이에 오갈 것이 있는 지출뿐이다 (§12).
  const breakdowns = expenses.filter(inSettlement).map((e) => breakdownOf(e));
  const balances = computeBalances(expenses, relevantMembers(expenses, allMembers));
  const sum = (list: ExpenseBreakdown[]) => list.reduce((acc, b) => acc + b.expense.amount, 0);

  return {
    expenseIds: breakdowns.map((b) => b.expense.id),
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
  // 공금 지출은 애초에 정산이라는 계산의 바깥에 있다.
  if (a.type === 'common') return false;
  if (a.type === 'personal') return a.ownerId !== expense.payerId;
  /*
   * 줄마다 부담자가 다른 지출도 같은 이유로 걸러진다. 혼자 시켜 먹고
   * 혼자 결제한 것을 줄까지 갈라 적었다면 — 드물지만 있을 수 있다 —
   * 오갈 돈은 여전히 없다. 규칙은 하나다: 결제자 말고 부담자가 있는가.
   */
  if (a.type === 'items') {
    return sharesOf(expense).some((s) => s.memberId !== expense.payerId && s.amount !== 0);
  }
  return true;
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

/**
 * 이 장부에 이미 쓰인 묶음 이름들 (§11.3)
 *
 * 처음 쓰인 순서를 지킨다. 가나다순으로 세우면 '1차 MT' 다음에 '2차 MT'가
 * 아니라 다른 것이 끼어들 수 있고, 무엇보다 **매번 순서가 바뀌면** 고르는
 * 자리에서 손이 기억한 위치가 소용없어진다.
 */
export function groupsOf(ledger: Ledger): string[] {
  const seen: string[] = [];
  for (const e of [...ledger.expenses].sort(byEntryOrder)) {
    const g = e.group?.trim();
    if (g && !seen.includes(g)) seen.push(g);
  }
  return seen;
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
    case 'items':
      return `항목별 ${a.lines.length}개`;
    case 'common':
      return '공금';
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
