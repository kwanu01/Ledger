import 'server-only';
import { cache } from 'react';
import { db } from './client.ts';
import { dropImage } from './images.ts';
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
import type { Allocation } from '../domain/types.ts';
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
/**
 * 지출 한 줄을 지운다.
 *
 * 판정은 전부 데이터베이스 함수 안에 있다(0012_delete_settled.sql). 정산에
 * 들어간 줄이면 그 정산을 통째로 걷어 내고 지우는데, 그 둘은 한 트랜잭션
 * 안에서 일어나야 한다. 여기서 나눠 부르면 정산만 사라지고 지출은 남는
 * 중간 상태가 생길 수 있다.
 *
 * 사진은 줄이 사라지기 전에 걷어 낸다. 줄이 먼저 없어지면 어떤 사진이
 * 붙어 있었는지 알 길이 없다.
 */
export async function removeExpense(expenseId: string, ledgerId: string): Promise<void> {
  const { data: row } = await db
    .from('expenses')
    .select('receipt_path, representative_image_path')
    .eq('id', expenseId)
    .eq('ledger_id', ledgerId)
    .maybeSingle();

  const { error } = await db.rpc('delete_expense_deep', {
    p_expense_id: expenseId,
    p_ledger_id: ledgerId,
  });
  if (error) throw new Error(error.message);

  for (const path of [row?.receipt_path, row?.representative_image_path]) {
    if (path) await dropImage(path as string).catch(() => {});
  }
}

/**
 * 지출 한 줄을 고친다.
 *
 * 정산에 들어간 줄은 데이터베이스가 막는다(0002_guards.sql). 확정된 정산의
 * 숫자는 그대로 두고, 그런 줄은 보정 항목으로 바로잡는다 — 원래의 규칙이다.
 *
 * 기록 시점의 팀원 명단(team_member_ids)은 건드리지 않는다. 그 줄이 적힌
 * 순간에 팀에 누가 있었는지는 나중에 바뀔 수 있는 사실이 아니다.
 */
export async function editExpense(args: {
  expenseId: string;
  ledgerId: string;
  date: string;
  title: string;
  amount: number;
  payerId: string;
  allocation: Allocation;
  vendor?: string;
  category?: string;
  productLink?: string;
  note?: string;
}): Promise<void> {
  const a = args.allocation;
  const { error } = await db
    .from('expenses')
    .update({
      spent_on: args.date,
      title: args.title,
      amount: args.amount,
      payer_member_id: args.payerId,
      allocation: a.type,
      participant_member_ids: a.type === 'partial' ? a.participantIds : null,
      owner_member_id: a.type === 'personal' ? a.ownerId : null,
      vendor: args.vendor ?? null,
      category: args.category ?? null,
      product_link: args.productLink ?? null,
      note: args.note ?? null,
    })
    .eq('id', args.expenseId)
    .eq('ledger_id', args.ledgerId);
  if (error) throw new Error(error.message);
}

/**
 * 이름표만 고친다 (§12)
 *
 * 정산이 끝난 뒤에도 고칠 수 있는 것들 — 항목 이름, 판매처, 분류, 메모,
 * 구매 링크. 어느 것도 정산에 들어가지 않는다.
 *
 * 숫자에 닿는 칸(금액·날짜·결제자·부담 방식)은 여기에 아예 없다. 있는데
 * 안 쓰는 것이 아니라 **없다.** 실수로 섞여 들어갈 자리를 만들지 않는 편이,
 * 섞여 들어가지 않도록 조심하는 것보다 낫다. DB 에도 같은 규칙이 걸려 있다
 * (0013_relabel_settled.sql).
 */
export async function relabelExpense(args: {
  expenseId: string;
  ledgerId: string;
  title: string;
  vendor?: string;
  category?: string;
  productLink?: string;
  note?: string;
}): Promise<void> {
  const { error } = await db
    .from('expenses')
    .update({
      title: args.title,
      vendor: args.vendor ?? null,
      category: args.category ?? null,
      product_link: args.productLink ?? null,
      note: args.note ?? null,
    })
    .eq('id', args.expenseId)
    .eq('ledger_id', args.ledgerId);
  if (error) throw new Error(error.message);
}

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
  // 같은 장부의 지출만 보정 대상이 된다. 남의 장부 지출 id를 넣어 그 줄의
  // 부담 구조·판매처·분류를 우리 장부로 옮겨 오는 길을 여기서 막는다.
  // (DB 가드에도 같은 규칙이 있다. 두 겹으로 둔다.)
  const { data: target, error } = await db
    .from('expenses')
    .select('*')
    .eq('id', args.targetId)
    .eq('ledger_id', args.ledgerId)
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
/**
 * 정산 취소.
 *
 * 장부 id를 함께 넘긴다. 정산 id 하나만으로 지우면, 그 id를 아는 사람은
 * 어느 장부의 회원이든 그 정산을 지울 수 있다. 권한을 판정한 장부와 실제로
 * 건드리는 자원이 같은지는 언제나 따로 확인해야 한다(0010).
 */
export async function cancelSettlement(settlementId: string, ledgerId: string): Promise<void> {
  const { error } = await db.rpc('cancel_settlement', {
    p_settlement_id: settlementId,
    p_ledger_id: ledgerId,
  });
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

/**
 * 받았다고 확인. 받을 사람 본인만 할 수 있다.
 *
 * DB 트리거에도 같은 규칙이 있지만(0004_transfers.sql), 여기서도 조건에 넣는다.
 * 트리거가 막으면 영어 오류가 올라오고, 여기서 막으면 아무 줄도 바뀌지 않는다.
 */
export async function confirmTransfer(transferId: string, memberId: string): Promise<void> {
  const { error } = await db
    .from('transfers')
    .update({ confirmed_at: new Date().toISOString(), confirmed_by_member_id: memberId })
    .eq('id', transferId)
    .eq('to_member_id', memberId);
  if (error) throw new Error(error.message);
}

/**
 * 소유자가 대신 확인 (§12)
 *
 * 받는 사람이 안 눌러 주면 그 정산은 영원히 '확인 중'으로 남는다. 학기가
 * 끝나면 아무도 앱에 안 들어오기 때문에 실제로 자주 생기는 일이다.
 * 안 닫히는 장부도 틀린 장부라서, 소유자 **한 사람에게만** 길을 연다.
 *
 * 누가 눌렀는지는 지우지 않는다. confirmed_by_member_id 에 소유자의 이름이
 * 남으므로, 이 확인이 받은 사람 본인의 것인지 대신한 것인지 나중에도 구분된다.
 * 권한을 넓히는 것과 기록을 흐리는 것은 다른 일이다.
 *
 * 이 함수를 부르기 전에 부르는 쪽이 소유자인지 확인해야 한다. DB 에도 같은
 * 규칙이 걸려 있다(0014_owner_and_confirm.sql).
 */
export async function confirmTransferAsOwner(args: {
  transferId: string;
  byMemberId: string;
  ledgerId: string;
}): Promise<void> {
  // 남의 장부 송금을 지우지 않도록, 이 장부의 것이 맞는지 먼저 본다.
  const { data: rows } = await db
    .from('transfers')
    .select('id, settlement_id, settlements!inner(ledger_id)')
    .eq('id', args.transferId)
    .is('confirmed_at', null);
  const row = (rows ?? [])[0] as
    | { settlements?: { ledger_id?: string } | { ledger_id?: string }[] }
    | undefined;
  const owner = Array.isArray(row?.settlements) ? row?.settlements[0] : row?.settlements;
  if (!row || owner?.ledger_id !== args.ledgerId) {
    throw new Error('이 장부의 송금이 아닙니다.');
  }

  const { error } = await db
    .from('transfers')
    .update({
      confirmed_at: new Date().toISOString(),
      confirmed_by_member_id: args.byMemberId,
    })
    .eq('id', args.transferId);
  if (error) throw new Error(error.message);
}

/**
 * 소유권 넘기기 (§16)
 *
 * 소유자를 팀을 만든 사람으로 못 박아 두면, 그 사람이 학기 중에 빠질 때
 * 장부가 굳는다. 초대 링크도 못 만들고 이름도 못 바꾸는 상태로 남는다.
 *
 * 받는 사람은 **계정이 있는 활성 팀원**이어야 한다. 초대 링크로만 들어온
 * 사람에게 넘기면, 넘기는 순간 그 장부에는 다시 들어올 수 있는 소유자가
 * 없어진다. DB 에도 같은 조건이 걸려 있다.
 */
export async function setTeamOwner(teamId: string, toMemberId: string): Promise<void> {
  const { data: m } = await db
    .from('members')
    .select('user_id, active, team_id')
    .eq('id', toMemberId)
    .maybeSingle();

  if (!m || m.team_id !== teamId) throw new Error('이 팀의 팀원이 아닙니다.');
  if (!m.active) throw new Error('나간 사람에게는 넘길 수 없습니다.');
  if (!m.user_id) {
    throw new Error('계정으로 들어온 팀원에게만 넘길 수 있습니다. 그 사람이 먼저 로그인해야 합니다.');
  }

  const { error } = await db.from('teams').update({ owner_id: m.user_id }).eq('id', teamId);
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
