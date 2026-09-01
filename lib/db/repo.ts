import 'server-only';
import { cache } from 'react';
import { db } from './client.ts';
import {
  toLedger,
  toExpenseInsert,
  type ExpenseRow,
  type LedgerRow,
  type MemberRow,
  type NewExpense,
  type SettlementRow,
} from './mapping.ts';
import { computeSettlement, unsettledExpenses } from '../domain/settlement.ts';
import type { Expense, Ledger } from '../domain/types.ts';

/**
 * DB와 도메인 사이의 유일한 통로.
 *
 * 규칙: 이 파일은 계산을 하지 않는다. 계산은 전부 domain/settlement.ts가 한다.
 * 여기서는 읽어서 도메인 객체로 조립하고, 도메인이 내놓은 결과를 저장만 한다.
 */

/** 장부 하나를 통째로 읽어 도메인 Ledger로 조립한다. */
/**
 * 한 요청 안에서 같은 장부를 두 번 읽지 않는다.
 *
 * 접근 확인과 화면 그리기가 각각 장부를 부르면 같은 질의가 두 번 나간다.
 * 데이터베이스가 서울에 있어도 왕복은 왕복이다.
 */
export const loadLedger = cache(_loadLedger);

async function _loadLedger(ledgerId: string): Promise<Ledger> {
  const { data: ledger, error } = await db
    .from('ledgers')
    .select('id, team_id, name, started_at, archived_at, currency, teams(name)')
    .eq('id', ledgerId)
    .single<LedgerRow & { teams: { name: string } }>();
  if (error || !ledger) throw new Error('장부를 찾을 수 없습니다.');

  const [{ data: members }, { data: expenses }, { data: settlements }] = await Promise.all([
    db.from('members').select('*').eq('team_id', ledger.team_id).order('sort_order'),
    db.from('expenses').select('*').eq('ledger_id', ledgerId).order('spent_on').order('id'),
    db.from('settlements').select('*').eq('ledger_id', ledgerId).order('seq'),
  ]);

  return toLedger(
    ledger,
    ledger.teams.name,
    (members ?? []) as MemberRow[],
    (expenses ?? []) as ExpenseRow[],
    (settlements ?? []) as SettlementRow[],
  );
}

/* ── 지출 ─────────────────────────────────────────────────────────────── */

export async function insertExpense(expense: NewExpense): Promise<string> {
  const { data, error } = await db
    .from('expenses')
    .insert(toExpenseInsert(expense))
    .select('id')
    .single();
  // DB 트리거가 내는 메시지는 사용자에게 그대로 보여줘도 되도록 한국어로 써 두었다.
  if (error) throw new Error(error.message);
  return data.id as string;
}

/**
 * 보정·환불 항목. 부담 구조는 반드시 원본에서 그대로 가져온다.
 * (DB 트리거도 같은 것을 검사하지만, 애초에 어긋난 값을 만들지 않는 편이 낫다)
 */
export async function insertAdjustment(args: {
  ledgerId: string;
  targetId: string;
  kind: 'correction' | 'refund';
  amount: number;
  date: string;
  title: string;
  payerId: string;
  reason?: string;
}): Promise<string> {
  const { data: target, error } = await db
    .from('expenses')
    .select('*')
    .eq('id', args.targetId)
    .single<ExpenseRow>();
  if (error || !target) throw new Error('보정 대상 지출을 찾을 수 없습니다.');

  if (args.kind === 'refund' && args.amount >= 0) {
    throw new Error('환불 금액은 음수여야 합니다.');
  }
  if (args.amount === 0) throw new Error('보정할 차액이 없습니다.');

  const { data, error: insertError } = await db
    .from('expenses')
    .insert({
      ledger_id: args.ledgerId,
      spent_on: args.date,
      title: args.title,
      amount: args.amount,
      payer_member_id: args.payerId,
      // 원본의 부담 구조를 그대로 물려받는다
      team_member_ids: target.team_member_ids,
      allocation: target.allocation,
      participant_member_ids: target.participant_member_ids,
      owner_member_id: target.owner_member_id,
      adjustment_kind: args.kind,
      adjustment_target_id: args.targetId,
      adjustment_reason: args.reason ?? null,
      vendor: target.vendor,
      category: target.category,
    })
    .select('id')
    .single();
  if (insertError) throw new Error(insertError.message);
  return data.id as string;
}

/* ── 정산 ─────────────────────────────────────────────────────────────── */

/**
 * 정산 확정.
 *
 * expenseIds를 주면 그 항목만(§15 단일/선택 정산), 안 주면 미정산 전체를 대상으로 한다.
 * 계산 결과 전체를 snapshot으로 박아두고, 송금은 실행 상태를 따로 관리해야 하므로
 * transfers 테이블에도 행으로 남긴다.
 */
export async function confirmSettlement(args: {
  ledgerId: string;
  label?: string;
  expenseIds?: string[];
  isFinal?: boolean;
  createdBy?: string;
  /** 마감 날짜. 기본은 오늘. 지난 날짜로 마감을 재현할 때만 넘긴다. */
  settledOn?: string;
}): Promise<{ settlementId: string; transferCount: number }> {
  const ledger = await loadLedger(args.ledgerId);

  const target: Expense[] = args.expenseIds?.length
    ? ledger.expenses.filter((e) => args.expenseIds!.includes(e.id))
    : unsettledExpenses(ledger);

  if (target.length === 0) throw new Error('정산할 지출이 없습니다.');

  const snapshot = computeSettlement(target, ledger.members);
  const seq = ledger.settlements.length + 1;

  const { data: settlement, error } = await db
    .from('settlements')
    .insert({
      ledger_id: args.ledgerId,
      label: args.label ?? `${seq}차 정산`,
      ...(args.settledOn ? { settled_on: args.settledOn } : {}),
      is_final: args.isFinal ?? false,
      snapshot,
      created_by: args.createdBy ?? null,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const settlementId = settlement.id as string;

  // 여기서 unique(expense_id)에 걸리면 이미 정산된 지출이 섞였다는 뜻이다.
  const { error: linkError } = await db
    .from('settlement_expenses')
    .insert(target.map((e) => ({ settlement_id: settlementId, expense_id: e.id })));
  if (linkError) {
    await db.from('settlements').delete().eq('id', settlementId);
    throw new Error('이미 정산된 지출이 포함되어 있습니다.');
  }

  if (snapshot.transfers.length > 0) {
    const { error: transferError } = await db.from('transfers').insert(
      snapshot.transfers.map((t) => ({
        settlement_id: settlementId,
        from_member_id: t.fromMemberId,
        to_member_id: t.toMemberId,
        amount: t.amount,
      })),
    );
    if (transferError) {
      await db.from('settlements').delete().eq('id', settlementId);
      throw new Error(transferError.message);
    }
  }

  return { settlementId, transferCount: snapshot.transfers.length };
}

/**
 * 정산 취소. 송금이 한 건이라도 확인되었으면 DB 트리거가 막는다.
 * 취소되면 그 지출들은 자동으로 미정산으로 돌아가고 다시 수정할 수 있게 된다.
 */
export async function cancelSettlement(settlementId: string): Promise<void> {
  const { error } = await db.rpc('cancel_settlement', { p_settlement_id: settlementId });
  if (error) throw new Error(error.message);
}

/** 송금 완료 확인. 받은 사람만 가능하다 (DB 트리거가 강제). */
/**
 * 보냈다고 표시한다. 보낸 사람만 할 수 있고, DB 트리거가 그것을 지킨다.
 * 이것만으로 송금이 닫히지는 않는다. 닫는 것은 여전히 받은 사람의 확인이다.
 */
export async function markSent(transferId: string, memberId: string): Promise<void> {
  const { error } = await db
    .from('transfers')
    .update({ sent_at: new Date().toISOString(), sent_by_member_id: memberId })
    .eq('id', transferId)
    .eq('from_member_id', memberId);
  if (error) throw new Error(error.message);
}

/** 보냈다는 표시를 물린다. 아직 확인되지 않은 것만 가능하다. */
export async function unmarkSent(transferId: string, memberId: string): Promise<void> {
  const { error } = await db
    .from('transfers')
    .update({ sent_at: null, sent_by_member_id: null })
    .eq('id', transferId)
    .eq('from_member_id', memberId)
    .is('confirmed_at', null);
  if (error) throw new Error(error.message);
}

export async function confirmTransfer(transferId: string, memberId: string): Promise<void> {
  const { error } = await db
    .from('transfers')
    .update({ confirmed_at: new Date().toISOString(), confirmed_by_member_id: memberId })
    .eq('id', transferId);
  if (error) throw new Error(error.message);
}

export type OpenTransfer = {
  transfer_id: string;
  settlement_id: string;
  seq: number;
  from_member_id: string;
  to_member_id: string;
  amount: number;
  /** 보낸 사람이 보냈다고 표시한 시각. 받은 사람의 확인과는 다른 신호다. */
  sent_at: string | null;
};

/** 아직 확인되지 않은 송금 — 홈의 "내가 보낼 돈 / 받을 돈" */
export async function openTransfers(ledgerId: string): Promise<OpenTransfer[]> {
  const { data, error } = await db.rpc('open_transfers', { p_ledger_id: ledgerId });
  if (error) throw new Error(error.message);
  return (data ?? []) as OpenTransfer[];
}

/* ── AI 사용량 ────────────────────────────────────────────────────────── */

export const MONTHLY_AI_LIMIT = Number(process.env.LEDGER_AI_MONTHLY_LIMIT ?? 200);

export async function aiUsageThisMonth(ledgerId: string): Promise<number> {
  const { data, error } = await db.rpc('ai_usage_this_month', { p_ledger_id: ledgerId });
  if (error) return 0;
  return (data as number) ?? 0;
}

export async function recordAiUsage(args: {
  ledgerId: string;
  expenseId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  succeeded: boolean;
}): Promise<void> {
  await db.from('ai_extractions').insert({
    ledger_id: args.ledgerId,
    expense_id: args.expenseId ?? null,
    model: args.model,
    input_tokens: args.inputTokens,
    output_tokens: args.outputTokens,
    cost_micro_usd: args.costMicroUsd,
    succeeded: args.succeeded,
  });
}
