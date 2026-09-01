/**
 * Ledger — DB row ↔ 도메인 타입 매핑
 *
 * 정산 엔진(settlement.ts)은 DB를 전혀 모른다. 이 파일이 유일한 접점이다.
 * 여기만 바꾸면 Supabase가 아니라 다른 무엇으로도 갈아끼울 수 있다.
 */

import type { Allocation, Expense, Ledger, Member, Settlement, SettlementResult } from '../domain/types.ts';
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
  allocation: 'all' | 'partial' | 'personal';
  participant_member_ids: string[] | null;
  owner_member_id: string | null;
  adjustment_kind: 'correction' | 'refund' | null;
  adjustment_target_id: string | null;
  adjustment_reason: string | null;
  original_currency: CurrencyCode | null;
  original_amount: number | string | null;
  vendor: string | null;
  category: string | null;
  product_link: string | null;
  receipt_path: string | null;
  representative_image_path: string | null;
  note: string | null;
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

function toAllocation(row: ExpenseRow): Allocation {
  switch (row.allocation) {
    case 'all':
      return { type: 'all' };
    case 'partial':
      return { type: 'partial', participantIds: row.participant_member_ids ?? [] };
    case 'personal':
      return { type: 'personal', ownerId: row.owner_member_id! };
  }
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
    productLink: row.product_link ?? undefined,
    receiptImage: row.receipt_path ?? undefined,
    representativeImage: row.representative_image_path ?? undefined,
    note: row.note ?? undefined,
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
): Ledger {
  return {
    id: ledger.id,
    teamName,
    name: ledger.name,
    startedAt: ledger.started_at,
    currency: ledger.currency ?? 'KRW',
    members: toMembers(memberRows),
    expenses: expenseRows.map(toExpense),
    settlements: settlementRows.map(toSettlement).sort((a, b) => a.seq - b.seq),
  };
}

/* ── 도메인 → row (insert용) ─────────────────────────────────────────── */

export type NewExpense = Omit<Expense, 'id' | 'createdAt'>;

export function toExpenseInsert(e: NewExpense): Omit<ExpenseRow, 'id' | 'created_at'> {
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
    adjustment_kind: e.adjustment?.kind ?? null,
    adjustment_target_id: e.adjustment?.targetExpenseId ?? null,
    adjustment_reason: e.adjustment?.reason ?? null,
    original_currency: e.originalCurrency ?? null,
    original_amount: e.originalAmount ?? null,
    vendor: e.vendor ?? null,
    category: e.category ?? null,
    product_link: e.productLink ?? null,
    receipt_path: e.receiptImage ?? null,
    representative_image_path: e.representativeImage ?? null,
    note: e.note ?? null,
    created_by_member_id: e.createdBy ?? null,
  };
}
