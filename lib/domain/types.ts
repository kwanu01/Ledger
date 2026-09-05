/**
 * Ledger — Core Domain Types
 *
 * 원칙 (Master Context §28)
 * - Expense와 Settlement는 분리한다. 정산해도 Expense 원본은 절대 변경/삭제하지 않는다.
 * - member.total_paid / total_owed / net_balance 를 언제든 쉽게 계산할 수 있어야 한다.
 * - 모든 금액은 원(KRW) 정수. 부동소수점을 쓰지 않는다.
 */

import type { CurrencyCode } from './money.ts';

export type MemberId = string;
export type ExpenseId = string;
export type SettlementId = string;

export type Member = {
  id: MemberId;
  name: string;
  /** 이탈한 팀원은 false. 과거 지출에서는 여전히 부담자로 남는다 */
  active?: boolean;
};

/**
 * 영수증 한 장 안의 한 줄 (§10.4)
 *
 * 같이 배달을 시키고 한 사람이 결제하면, 영수증 한 장 안에서 부담이 갈린다.
 * 마라탕은 시킨 사람이, 배달비는 다 같이. 이 타입은 그 한 줄이다.
 *
 * memberIds 가 여럿이면 그 줄 안에서 다시 균등하게 나뉜다. 배달비는
 * 팀원 전원이 들어 있는 줄일 뿐, 특별한 종류의 줄이 아니다 — 그래야
 * "배달비도 두 명만 부담" 같은 경우가 예외 없이 그냥 된다.
 */
export type ItemLine = {
  /** 영수증에 적힌 그대로의 품목 이름 */
  name: string;
  /** 장부 통화의 최소 단위 정수. 할인 줄은 음수일 수 있다. */
  amount: number;
  /** 이 줄을 부담할 사람. 비어 있으면 안 된다. */
  memberIds: MemberId[];
};

/**
 * 부담 방식 (§10)
 * - all      전체 팀 공동 부담 (기본값)
 * - partial  일부 인원만 부담
 * - personal 개인 귀속 — 프로젝트 총지출에는 포함, 공동 정산 대상 금액에서는 제외
 * - items    영수증 줄마다 부담자가 다름 (§10.4)
 * - common   공금에서 나감 — 아무도 개인적으로 부담하지 않는다 (§12)
 *
 * 개인 귀속이라도 "결제자 ≠ 귀속자"인 경우에는 귀속자가 결제자에게 갚아야 하므로
 * balance 계산에는 반영된다. 결제자 = 귀속자이면 자연히 상계되어 영향이 0이 된다.
 *
 * items 는 앞의 셋을 전부 흉내 낼 수 있지만 셋을 대체하지 않는다. 한 장부의
 * 대부분은 여전히 "다 같이 낸 것"이고, 그 줄까지 품목으로 쪼개 적게 하면
 * 적는 일이 무거워진다. 갈라야 할 때만 가른다.
 */
export type Allocation =
  | { type: 'all' }
  | { type: 'partial'; participantIds: MemberId[] }
  | { type: 'personal'; ownerId: MemberId }
  | { type: 'items'; lines: ItemLine[] }
  /**
   * 공금에서 나가는 지출 (§12)
   *
   * 부담자가 없다. 회비나 지원금으로 모아 둔 돈에서 나갔으므로 갚을 사람도
   * 받을 사람도 없다. **정산에서 통째로 빠지고 결산에만 들어간다** —
   * 결제자조차 잔액을 움직이지 않는다. 누가 집행했는지는 기록으로만 남는다.
   */
  | { type: 'common' };

/**
 * 보정과 환불은 원본을 고치지 않고 별도 Expense로 기록한다.
 * - correction 금액 오타·부담 방식 오지정을 바로잡는 차액 (양수/음수)
 * - refund    반품·부분 환불로 되돌아온 금액 (항상 음수)
 * 원본 Expense와 확정된 Settlement snapshot은 어느 쪽으로도 변경되지 않는다.
 */
export type Adjustment = {
  kind: 'correction' | 'refund';
  targetExpenseId: ExpenseId;
  reason?: string;
};

export type Expense = {
  id: ExpenseId;
  ledgerId: string;
  date: string; // YYYY-MM-DD
  title: string;
  /** KRW 정수. 보정·환불 항목은 음수일 수 있다 */
  amount: number;
  payerId: MemberId;
  /**
   * 기록 시점의 팀원 명단. '전체 팀 공동'은 "지금 팀원 전원"이 아니라
   * "이 지출이 생겼을 때의 팀원 전원"을 뜻한다.
   * 이 값을 박아두지 않으면 나중에 팀원이 한 명 늘어날 때 과거 지출까지 다시 나뉜다.
   */
  teamMemberIds: MemberId[];
  adjustment?: Adjustment;

  /**
   * 해외 결제일 때만 채운다. 영수증에 적힌 통화와 금액이다.
   * 정산은 언제나 amount(장부 통화의 실제 청구액)로 한다. 환율은 쓰지 않는다.
   */
  originalCurrency?: CurrencyCode;
  originalAmount?: number;

  vendor?: string;
  category?: string;
  /**
   * 지출 묶음 (§11.3) — '1차 MT', '중간발표' 같은 덩어리의 이름.
   *
   * 계산에 한 푼도 들어가지 않는 이름표다. 장부를 접어 보고, 정산할 것을
   * 골라 담는 기준으로만 쓴다. 없으면 undefined.
   */
  group?: string;
  allocation: Allocation;
  productLink?: string;
  receiptImage?: string; // 증빙 (§9)
  representativeImage?: string; // 시각적 썸네일 — 증빙 아님 (§9)
  note?: string;
  createdAt: string;
  createdBy: MemberId;
};

/** 한 Expense에 대해 각 멤버가 실제로 부담하는 금액 (합 = expense.amount) */
export type Share = {
  memberId: MemberId;
  amount: number;
  /** 나머지 1원 배분을 받은 경우 true — UI에서 "13,500 (+1)" 같이 정직하게 드러낸다 */
  roundingAdjusted: boolean;
};

export type ExpenseBreakdown = {
  expense: Expense;
  shares: Share[];
  /** 공동 정산 대상 금액에 포함되는가 (personal은 제외) */
  countsTowardShared: boolean;
};

/** 정산 검산의 최소 단위 (§13.2, §28.3) */
export type MemberBalance = {
  memberId: MemberId;
  /** 이 멤버가 직접 결제한 총액 */
  totalPaid: number;
  /** 이 멤버가 부담해야 하는 총액 */
  totalOwed: number;
  /** totalPaid - totalOwed. 양수=받을 돈, 음수=보낼 돈 */
  netBalance: number;
};

export type Transfer = {
  fromMemberId: MemberId; // 보내는 사람
  toMemberId: MemberId; // 받는 사람
  amount: number;
};

/** 특정 Expense 집합에 대한 정산 계산 결과 */
export type SettlementResult = {
  expenseIds: ExpenseId[];
  /** 대상 Expense 총액 (개인 귀속 포함) */
  totalAmount: number;
  /** 공동 부담(all/partial) Expense 합계 */
  sharedAmount: number;
  /** 개인 귀속(personal) Expense 합계 */
  personalAmount: number;
  balances: MemberBalance[];
  transfers: Transfer[];
  breakdowns: ExpenseBreakdown[];
};

/**
 * 확정된 정산 이벤트 (§12.2)
 * 계산 결과의 snapshot을 그대로 보존한다. 이후 Expense가 수정되어도
 * 이미 확정된 Settlement의 숫자는 바뀌지 않는다.
 */
export type Settlement = {
  id: SettlementId;
  ledgerId: string;
  seq: number; // 1차, 2차, ...
  date: string;
  label: string;
  isFinal: boolean;
  snapshot: SettlementResult;
};

/**
 * 돈이 어디서 오는가 (§12)
 *
 * 장부의 성격을 정하는 축. 이 값 하나로 수입 화면, 결산, 공금 부담이
 * 함께 켜지고 꺼진다.
 *
 *   each   각자 결제하고 나중에 나눈다 — 팀플. 지금까지의 Ledger.
 *   dues   회비를 모아서 쓴다 — 동아리, 학회, 반 모임.
 *   grant  밖에서 받은 예산 안에서 쓴다 — 지원금.
 */
export type FundSource = 'each' | 'dues' | 'grant';

/** 들어온 돈의 갈래 (§12) */
export type IncomeKind = 'dues' | 'grant' | 'donation' | 'carryover';

/**
 * 들어온 돈 한 줄.
 *
 * 지출과 나란한 것이지 지출의 일종이 아니다. 지분도 부담자도 없고,
 * 정산에 들어가지 않는다.
 */
export type Income = {
  id: string;
  ledgerId: string;
  date: string; // YYYY-MM-DD
  title: string;
  /** 최소 단위 정수. 잘못 걷은 회비를 돌려줄 때는 음수다. */
  amount: number;
  kind: IncomeKind;
  /** 회비일 때 낸 사람. 다른 갈래에서는 비어 있다. */
  memberId?: MemberId;
  note?: string;
  createdAt: string;
  createdBy?: MemberId;
};

export type Ledger = {
  id: string;
  teamName: string;
  name: string;
  startedAt: string;
  /** 돈의 출처. 없으면 'each' — 지금까지의 장부는 전부 그것이다. */
  fundSource?: FundSource;
  /** 회기를 닫을 때 남은 돈을 다음으로 넘기는가 */
  termCarry?: boolean;
  /** 1인당 회비. 미납자를 세는 기준. 없으면 세지 않는다. */
  duesPerHead?: number;
  /** 회기를 닫은 시각. 닫힌 뒤에는 수입을 못 고친다. */
  closedAt?: string;
  incomes: Income[];
  /**
   * 이 장부의 통화. 금액은 전부 이 통화의 최소 단위 정수로 저장된다.
   * (KRW면 원, USD면 센트) 장부 하나는 통화 하나만 쓴다.
   */
  currency?: CurrencyCode;
  members: Member[];
  expenses: Expense[];
  settlements: Settlement[];
};
