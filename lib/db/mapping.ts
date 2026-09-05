/**
 * Ledger — DB row ↔ 도메인 타입 매핑
 *
 * 정산 엔진(settlement.ts)은 DB를 전혀 모른다. 이 파일이 유일한 접점이다.
 * 여기만 바꾸면 Supabase가 아니라 다른 무엇으로도 갈아끼울 수 있다.
 */

import type {
  Allocation,
  Expense,
  FundSource,
  Income,
  IncomeKind,
  ItemLine,
  Ledger,
  Member,
  Settlement,
  SettlementResult,
} from '../domain/types.ts';
import type { CurrencyCode } from '../domain/money.ts';

/* ── DB row 모양 (0001_schema.sql과 1:1) ─────────────────────────────── */

export type MemberRow = {
  id: string;
  team_id: string;
  user_id: string | null;
  display_name: string;
  active: boolean;
  sort_order: number;
};

export type ExpenseRow = {
  id: string;
  ledger_id: string;
  spent_on: string;
  title: string;
  amount: number | string; // bigint는 드라이버에 따라 문자열로 온다
  payer_member_id: string;
  team_member_ids: string[];
  allocation: 'all' | 'partial' | 'personal' | 'items' | 'common';
  participant_member_ids: string[] | null;
  owner_member_id: string | null;
  /** allocation = 'items' 일 때만. [{ name, amount, memberIds }] */
  item_lines: unknown[] | null;
  adjustment_kind: 'correction' | 'refund' | null;
  adjustment_target_id: string | null;
  adjustment_reason: string | null;
  original_currency: CurrencyCode | null;
  original_amount: number | string | null;
  vendor: string | null;
  category: string | null;
  group_name: string | null;
  product_link: string | null;
  receipt_path: string | null;
  representative_image_path: string | null;
  note: string | null;
  /** AI 가 사진에서 읽은 금액. 한 번 적히면 안 바뀐다 (0021) */
  read_amount: number | string | null;
  /** 검사의 물음에 사람이 답한 시각 (0021) */
  checked_at: string | null;
  created_at: string;
  created_by_member_id: string | null;
};

export type SettlementRow = {
  id: string;
  ledger_id: string;
  seq: number;
  settled_on: string;
  label: string;
  is_final: boolean;
  snapshot: SettlementResult;
};

export type LedgerRow = {
  id: string;
  team_id: string;
  name: string;
  started_at: string;
  archived_at: string | null;
  currency: CurrencyCode;
  /* ── 0020 이후. 옛 장부에는 없을 수 있으므로 전부 옵셔널로 받는다. ── */
  fund_source?: FundSource | null;
  term_carry?: boolean | null;
  dues_per_head?: number | string | null;
  closed_at?: string | null;
  /** 0022. 없는 데이터베이스도 있어서 optional 이다 */
  budget?: number | string | null;
};

/** 들어온 돈 (0020_income_and_fund.sql 과 1:1) */
export type IncomeRow = {
  id: string;
  ledger_id: string;
  received_on: string;
  title: string;
  amount: number | string;
  kind: IncomeKind;
  member_id: string | null;
  note: string | null;
  created_at: string;
  created_by_member_id: string | null;
};

/* ── row → 도메인 ────────────────────────────────────────────────────── */

/** bigint가 문자열로 와도 원 단위 정수로 되돌린다. 부동소수점을 거치지 않는다. */
const won = (v: number | string): number => (typeof v === 'number' ? v : Number.parseInt(v, 10));

export function toMember(row: MemberRow): Member {
  return { id: row.id, name: row.display_name, active: row.active };
}

/** 팀원 정렬은 sort_order 하나로만 정한다. 나머지 1원 배분 순서가 여기에 달려 있다. */
export function toMembers(rows: MemberRow[]): Member[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order).map(toMember);
}

/**
 * jsonb 로 온 줄들을 도메인 타입으로 세운다.
 *
 * jsonb 는 무엇이든 담을 수 있으므로 여기서 한 번 걸러야 한다. 금액이
 * 문자열로 오거나 memberIds 가 없는 줄이 그대로 계산으로 흘러가면
 * 지분의 합이 어긋난다. 모양이 아닌 줄은 버리지 않고 0원짜리로 세운다 —
 * 조용히 사라지는 것보다 0원으로 눈에 띄는 편이 낫다.
 */
function toItemLines(raw: unknown[] | null): ItemLine[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => {
    const o = (v ?? {}) as Record<string, unknown>;
    const amount = typeof o.amount === 'number' ? o.amount : Number.parseInt(String(o.amount), 10);
    return {
      name: typeof o.name === 'string' ? o.name : '',
      amount: Number.isFinite(amount) ? Math.round(amount) : 0,
      memberIds: Array.isArray(o.memberIds) ? o.memberIds.filter((x): x is string => typeof x === 'string') : [],
    };
  });
}

function toAllocation(row: ExpenseRow): Allocation {
  switch (row.allocation) {
    case 'all':
      return { type: 'all' };
    case 'partial':
      return { type: 'partial', participantIds: row.participant_member_ids ?? [] };
    case 'personal':
      return { type: 'personal', ownerId: row.owner_member_id! };
    case 'items':
      return { type: 'items', lines: toItemLines(row.item_lines) };
    case 'common':
      return { type: 'common' };
  }
}

export function toIncome(row: IncomeRow): Income {
  return {
    id: row.id,
    ledgerId: row.ledger_id,
    date: row.received_on,
    title: row.title,
    amount: won(row.amount),
    kind: row.kind,
    memberId: row.member_id ?? undefined,
    note: row.note ?? undefined,
    createdAt: row.created_at,
    createdBy: row.created_by_member_id ?? undefined,
  };
}

export function toExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    ledgerId: row.ledger_id,
    date: row.spent_on,
    title: row.title,
    amount: won(row.amount),
    payerId: row.payer_member_id,
    teamMemberIds: row.team_member_ids,
    allocation: toAllocation(row),
    adjustment: row.adjustment_kind
      ? {
          kind: row.adjustment_kind,
          targetExpenseId: row.adjustment_target_id!,
          reason: row.adjustment_reason ?? undefined,
        }
      : undefined,
    originalCurrency: row.original_currency ?? undefined,
    originalAmount: row.original_amount != null ? won(row.original_amount) : undefined,
    vendor: row.vendor ?? undefined,
    category: row.category ?? undefined,
    group: row.group_name ?? undefined,
    productLink: row.product_link ?? undefined,
    receiptImage: row.receipt_path ?? undefined,
    representativeImage: row.representative_image_path ?? undefined,
    note: row.note ?? undefined,
    /* 0021 이전 장부에는 이 칸이 없다. 없는 것은 '읽은 적 없음'이 맞다. */
    readAmount: row.read_amount != null ? won(row.read_amount) : undefined,
    checkedAt: row.checked_at ?? undefined,
    createdAt: row.created_at,
    createdBy: row.created_by_member_id ?? row.payer_member_id,
  };
}

export function toSettlement(row: SettlementRow): Settlement {
  return {
    id: row.id,
    ledgerId: row.ledger_id,
    seq: row.seq,
    date: row.settled_on,
    label: row.label,
    isFinal: row.is_final,
    snapshot: row.snapshot, // 확정 시점 그대로. 절대 재계산하지 않는다.
  };
}

export function toLedger(
  ledger: LedgerRow,
  teamName: string,
  memberRows: MemberRow[],
  expenseRows: ExpenseRow[],
  settlementRows: SettlementRow[],
  incomeRows: IncomeRow[] = [],
): Ledger {
  return {
    id: ledger.id,
    teamName,
    name: ledger.name,
    startedAt: ledger.started_at,
    currency: ledger.currency ?? 'KRW',
    // 0020 이전에 만들어진 장부는 이 칸들이 비어 있다. 전부 '각자 결제'다.
    fundSource: ledger.fund_source ?? 'each',
    termCarry: ledger.term_carry ?? false,
    duesPerHead: ledger.dues_per_head != null ? won(ledger.dues_per_head) : undefined,
    closedAt: ledger.closed_at ?? undefined,
    /* 0022 이전 데이터베이스에는 이 칸이 없다. 없으면 장부가 알아낸다 (§14). */
    budget: ledger.budget != null ? won(ledger.budget) : undefined,
    incomes: incomeRows.map(toIncome).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1)),
    members: toMembers(memberRows),
    expenses: expenseRows.map(toExpense),
    settlements: settlementRows.map(toSettlement).sort((a, b) => a.seq - b.seq),
  };
}

/* ── 도메인 → row (insert용) ─────────────────────────────────────────── */

export type NewIncome = Omit<Income, 'id' | 'createdAt'>;

export function toIncomeInsert(i: NewIncome): Omit<IncomeRow, 'id' | 'created_at'> {
  return {
    ledger_id: i.ledgerId,
    received_on: i.date,
    title: i.title,
    amount: i.amount,
    kind: i.kind,
    // 회비가 아니면 낸 사람 칸은 비어 있어야 한다 (DB 제약이 같은 것을 본다).
    member_id: i.kind === 'dues' ? (i.memberId ?? null) : null,
    note: i.note ?? null,
    created_by_member_id: i.createdBy ?? null,
  };
}

export type NewExpense = Omit<Expense, 'id' | 'createdAt'>;

/*
 * checked_at 은 여기서 안 쓴다. 적히는 순간 '괜찮다'고 답해 둔 줄은 없다 —
 * 아직 아무도 물어보지 않았기 때문이다. 그 칸은 사람이 답할 때만 채워진다.
 */
export function toExpenseInsert(
  e: NewExpense,
): Omit<ExpenseRow, 'id' | 'created_at' | 'checked_at'> {
  const a = e.allocation;
  return {
    ledger_id: e.ledgerId,
    spent_on: e.date,
    title: e.title,
    amount: e.amount,
    payer_member_id: e.payerId,
    team_member_ids: e.teamMemberIds,
    allocation: a.type,
    participant_member_ids: a.type === 'partial' ? a.participantIds : null,
    owner_member_id: a.type === 'personal' ? a.ownerId : null,
    item_lines: a.type === 'items' ? a.lines : null,
    adjustment_kind: e.adjustment?.kind ?? null,
    adjustment_target_id: e.adjustment?.targetExpenseId ?? null,
    adjustment_reason: e.adjustment?.reason ?? null,
    original_currency: e.originalCurrency ?? null,
    original_amount: e.originalAmount ?? null,
    vendor: e.vendor ?? null,
    category: e.category ?? null,
    group_name: e.group?.trim() || null,
    product_link: e.productLink ?? null,
    receipt_path: e.receiptImage ?? null,
    representative_image_path: e.representativeImage ?? null,
    note: e.note ?? null,
    read_amount: e.readAmount ?? null,
    created_by_member_id: e.createdBy ?? null,
  };
}
