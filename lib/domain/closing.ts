/**
 * Ledger — 결산 (§12)
 *
 * 한 주머니의 잔고를 세는 계산이다.
 *
 *     이월금 + 수입 − 공금 지출 = 남은 돈
 *
 * ── 왜 파일이 따로인가
 *
 * 정산(settlement.ts)과 **다른 계산**이기 때문이다. 이름이 비슷해서 자꾸
 * 한 덩어리로 보이지만, 세는 대상이 아예 다르다.
 *
 *   정산  사람 사이의 채권 관계. "각자 낸 것 − 각자 부담할 것 = 잔액"
 *         지분의 합이 금액과 같아야 하고, 그 위에 불변식 쉰 개가 서 있다.
 *   결산  한 주머니의 잔고. 지분도 부담자도 없다.
 *
 * 같은 엔진에 밀어 넣으면 "지분의 합 = 금액"이라는 전제를 느슨하게 풀어야
 * 하는데, 그러면 지금 맞는 것들까지 못 믿게 된다. 정산 엔진은 손대지 않는다.
 *
 * ── 두 계산은 서로를 침범하지 않는다
 *
 * 공금 지출(allocation.type === 'common')만 결산에 들어가고, 나머지 지출은
 * 전부 정산에만 들어간다. 한 줄이 양쪽에 동시에 서는 일은 없다.
 * settlement.inSettlement() 와 여기의 fromFund() 가 서로의 여집합이다.
 *
 * 이 파일도 순수 함수만 있다. 시뮬레이션에서 그대로 검증된다.
 */

import type { Expense, Income, Ledger, Member, MemberId } from './types.ts';

/** 이 지출이 공금에서 나갔는가 — 결산이 세는 유일한 지출이다. */
export function fromFund(e: Expense): boolean {
  return e.allocation.type === 'common';
}

export type FundBook = {
  /** 회기의 시작 잔고 */
  carriedIn: number;
  /** 이월금을 뺀 들어온 돈 */
  received: number;
  /** 그중 회비 */
  dues: number;
  /** 공금에서 나간 돈 (양수로 센다) */
  spent: number;
  /** 시작 잔고 + 수입 − 지출 */
  left: number;
  /** 갈래별 수입 합계 */
  byKind: { kind: Income['kind']; amount: number; count: number }[];
};

/**
 * 공금의 잔고.
 *
 * 지출은 **부호를 뒤집어 양수로** 센다. 장부에서 지출은 양수로 적히지만
 * 잔고에서는 빠지는 것이라, 화면이 "쓴 돈"이라고 부를 수 있는 숫자가
 * 있어야 한다. left 를 낼 때만 다시 뺀다.
 *
 * 환불로 음수인 공금 지출이 있으면 spent 가 그만큼 줄어든다. 옳다 —
 * 돌려받은 돈은 주머니로 돌아온 것이다.
 */
export function fundBook(ledger: Ledger): FundBook {
  const incomes = ledger.incomes ?? [];
  const carriedIn = incomes
    .filter((i) => i.kind === 'carryover')
    .reduce((a, i) => a + i.amount, 0);
  const received = incomes
    .filter((i) => i.kind !== 'carryover')
    .reduce((a, i) => a + i.amount, 0);
  const dues = incomes.filter((i) => i.kind === 'dues').reduce((a, i) => a + i.amount, 0);
  const spent = ledger.expenses.filter(fromFund).reduce((a, e) => a + e.amount, 0);

  const order: Income['kind'][] = ['carryover', 'dues', 'grant', 'donation'];
  const byKind = order
    .map((kind) => {
      const rows = incomes.filter((i) => i.kind === kind);
      return { kind, amount: rows.reduce((a, i) => a + i.amount, 0), count: rows.length };
    })
    .filter((k) => k.count > 0);

  return { carriedIn, received, dues, spent, left: carriedIn + received - spent, byKind };
}

export type DuesRow = {
  memberId: MemberId;
  /** 지금까지 낸 금액. 여러 번 나눠 냈으면 합이다. */
  paid: number;
  /** 내야 할 금액 (장부의 1인당 회비). 기준이 없으면 0 */
  due: number;
  /** 모자란 금액. 0 이하면 다 냈거나 더 냈다. */
  short: number;
};

/**
 * 누가 회비를 얼마나 냈는가 (§12)
 *
 * 미납은 '안 냈다'는 표시가 아니라 **모자란 금액**이다. 반만 낸 사람이
 * 안 낸 사람과 같은 칸에 서면 독촉할 말이 틀려진다.
 *
 * 지금 팀에 있는 사람만 센다. 나간 사람의 미납은 걷을 데가 없고, 그 사람이
 * 낸 돈은 이미 잔고에 들어 있다.
 */
export function duesBoard(ledger: Ledger, members: Member[]): DuesRow[] {
  // 적어 둔 값이 먼저, 없으면 장부가 알아낸 값. 둘 다 없으면 안 센다.
  const due = ledger.duesPerHead ?? guessDuesPerHead(ledger)?.amount ?? 0;
  const paidBy = new Map<MemberId, number>();
  for (const i of ledger.incomes ?? []) {
    if (i.kind !== 'dues' || !i.memberId) continue;
    paidBy.set(i.memberId, (paidBy.get(i.memberId) ?? 0) + i.amount);
  }

  return members
    .filter((m) => m.active !== false)
    .map((m) => {
      const paid = paidBy.get(m.id) ?? 0;
      return { memberId: m.id, paid, due, short: Math.max(0, due - paid) };
    });
}

/** 아직 다 안 낸 사람들. 독촉의 입력이 되는 목록이다. */
export function unpaid(ledger: Ledger, members: Member[]): DuesRow[] {
  if (!ledger.duesPerHead && !guessDuesPerHead(ledger)) return [];
  return duesBoard(ledger, members).filter((r) => r.short > 0);
}

/**
 * 이 장부가 공금을 쓰는가 (§12)
 *
 * 수입 화면, 결산 화면, 부담 방식의 '공금'이 전부 이 하나로 켜지고 꺼진다.
 * 값이 없는 옛 장부는 전부 'each' 다 — 지금까지의 Ledger 가 그것이다.
 */
export function usesFund(ledger: Pick<Ledger, 'fundSource'>): boolean {
  return (ledger.fundSource ?? 'each') !== 'each';
}

/** 회비를 걷는 장부인가. 미납 셈은 이때만 뜻이 있다. */
export function collectsDues(ledger: Pick<Ledger, 'fundSource'>): boolean {
  return (ledger.fundSource ?? 'each') === 'dues';
}

/**
 * 회비 기준을 장부가 스스로 알아낸다 (§12.2)
 *
 * 1인당 회비를 사람이 적게 하면, 장부를 쓰기 전에 설정을 하나 더 해야 한다.
 * 그런데 그 값은 **이미 장부 안에 있다** — 세 사람이 3만원씩 냈으면 기준은
 * 3만원이다. 세는 일이지 묻는 일이 아니다.
 *
 * 최빈값으로 고른다. 평균이 아닌 이유는, 반만 낸 사람 하나가 평균을 끌어내려
 * 기준 자체를 틀리게 만들기 때문이다. 스무 명 중 열여덟이 3만원이면 기준은
 * 3만원이지 28,500원이 아니다.
 *
 * 두 사람은 있어야 말한다. 한 번은 우연이다(recall.ts 와 같은 규칙).
 * 사람이 직접 적어 둔 값이 있으면 그것이 이긴다 — 알아낸 것이 적어 둔 것을
 * 덮어쓰지 않는다.
 */
export function guessDuesPerHead(ledger: Ledger): { amount: number; times: number; of: number } | null {
  const paid = new Map<MemberId, number>();
  for (const i of ledger.incomes ?? []) {
    if (i.kind !== 'dues' || !i.memberId) continue;
    paid.set(i.memberId, (paid.get(i.memberId) ?? 0) + i.amount);
  }
  if (paid.size < 2) return null;

  const count = new Map<number, number>();
  for (const v of paid.values()) count.set(v, (count.get(v) ?? 0) + 1);

  let best = 0;
  let times = 0;
  for (const [amount, n] of count) {
    // 같은 횟수면 큰 쪽이 기준이다. 덜 낸 사람이 기준을 정하면 안 된다.
    if (n > times || (n === times && amount > best)) {
      best = amount;
      times = n;
    }
  }
  if (times < 2) return null;
  return { amount: best, times, of: paid.size };
}

/**
 * 회기를 닫을 때 다음으로 넘어갈 돈.
 *
 * 남은 돈이 음수면 넘기지 않는다. 빚을 이월금으로 적으면 다음 회기가
 * 마이너스에서 시작하는데, 그건 이월이 아니라 다른 문제다 — 회기를 닫기
 * 전에 사람이 봐야 한다.
 */
export function carryOut(book: FundBook): number {
  return Math.max(0, book.left);
}
