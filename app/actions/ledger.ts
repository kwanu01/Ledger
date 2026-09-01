'use server';

import { revalidatePath } from 'next/cache';
import { requireLedgerAccess } from '../../lib/access.ts';
import {
  cancelSettlement,
  confirmSettlement,
  confirmTransfer,
  markSent,
  unmarkSent,
  insertAdjustment,
  insertExpense,
  loadLedger,
} from '../../lib/db/repo.ts';
import { currentRoster } from '../../lib/domain/settlement.ts';
import { failed } from '../../lib/fail.ts';
import type { Allocation } from '../../lib/domain/types.ts';

/**
 * 서버 액션.
 *
 * 규칙 세 가지
 *   1. 첫 줄은 언제나 requireLedgerAccess. 예외 없다.
 *   2. 계산은 도메인이, 저장은 repo가 한다. 여기서는 둘을 잇고 오류를 사람 말로 바꾼다.
 *   3. 실패를 예외로 던지지 않고 { ok: false, message } 로 돌려준다.
 *      정산 화면에서 오류는 흔한 일이고, 사용자에게 그 자리에서 보여줘야 하기 때문이다.
 */

export type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { value?: never } : { value: T }))
  | { ok: false; message: string };


/* ── 지출 기록 ────────────────────────────────────────────────────────── */

export type ExpenseInput = {
  ledgerId: string;
  date: string;
  title: string;
  amount: number;
  payerId: string;
  allocation: Allocation;
  vendor?: string;
  category?: string;
  productLink?: string;
  receiptPath?: string;
  note?: string;
};

export async function recordExpense(input: ExpenseInput): Promise<Result<{ id: string }>> {
  try {
    const pass = await requireLedgerAccess(input.ledgerId);
    if (!input.title.trim()) return { ok: false, message: '항목 이름을 입력하세요.' };
    if (!Number.isInteger(input.amount) || input.amount === 0) {
      return { ok: false, message: '금액은 0이 아닌 정수여야 합니다.' };
    }

    const ledger = await loadLedger(input.ledgerId);

    const id = await insertExpense({
      ledgerId: input.ledgerId,
      date: input.date,
      title: input.title.trim(),
      amount: input.amount,
      payerId: input.payerId,
      // '전체 팀'은 지금 팀원이 아니라 기록하는 이 순간의 팀원을 뜻한다.
      teamMemberIds: currentRoster(ledger),
      allocation: input.allocation,
      vendor: input.vendor,
      category: input.category,
      productLink: input.productLink,
      receiptImage: input.receiptPath,
      note: input.note,
      createdBy: pass.memberId,
    });

    revalidatePath(`/l/${input.ledgerId}`);
    return { ok: true, value: { id } };
  } catch (e) {
    return failed(e);
  }
}

/** 금액 보정 — 원본은 고치지 않고 차액만 새 줄로 남긴다. */
export async function recordCorrection(args: {
  ledgerId: string;
  targetId: string;
  actualAmount: number;
  originalAmount: number;
  date: string;
  title: string;
  payerId: string;
  reason?: string;
}): Promise<Result<{ id: string }>> {
  try {
    await requireLedgerAccess(args.ledgerId);
    const diff = args.actualAmount - args.originalAmount;
    if (diff === 0) return { ok: false, message: '원본과 금액이 같습니다. 보정할 차액이 없습니다.' };

    const id = await insertAdjustment({
      ledgerId: args.ledgerId,
      targetId: args.targetId,
      kind: 'correction',
      amount: diff,
      date: args.date,
      title: args.title,
      payerId: args.payerId,
      reason: args.reason,
    });
    revalidatePath(`/l/${args.ledgerId}`);
    return { ok: true, value: { id } };
  } catch (e) {
    return failed(e);
  }
}

/** 환불 — 돌려받은 금액을 음수로 기록한다. */
export async function recordRefund(args: {
  ledgerId: string;
  targetId: string;
  refundedAmount: number; // 양수로 받아서 음수로 저장한다
  date: string;
  title: string;
  payerId: string;
  reason?: string;
}): Promise<Result<{ id: string }>> {
  try {
    await requireLedgerAccess(args.ledgerId);
    if (args.refundedAmount <= 0) return { ok: false, message: '환불 금액을 입력하세요.' };

    const id = await insertAdjustment({
      ledgerId: args.ledgerId,
      targetId: args.targetId,
      kind: 'refund',
      amount: -Math.abs(args.refundedAmount),
      date: args.date,
      title: args.title,
      payerId: args.payerId,
      reason: args.reason,
    });
    revalidatePath(`/l/${args.ledgerId}`);
    return { ok: true, value: { id } };
  } catch (e) {
    return failed(e);
  }
}

/* ── 정산 ─────────────────────────────────────────────────────────────── */

export async function settle(args: {
  ledgerId: string;
  expenseIds?: string[];
  label?: string;
  isFinal?: boolean;
}): Promise<Result<{ settlementId: string; transferCount: number }>> {
  try {
    await requireLedgerAccess(args.ledgerId);
    const value = await confirmSettlement(args);
    revalidatePath(`/l/${args.ledgerId}`);
    return { ok: true, value };
  } catch (e) {
    return failed(e);
  }
}

export async function undoSettlement(args: {
  ledgerId: string;
  settlementId: string;
}): Promise<Result> {
  try {
    await requireLedgerAccess(args.ledgerId);
    await cancelSettlement(args.settlementId, args.ledgerId);
    revalidatePath(`/l/${args.ledgerId}`);
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/**
 * 보냈다고 표시. 보낸 사람 본인만 가능하다.
 *
 * 송금하는 순간을 아는 것은 보낸 사람이다. 받은 사람은 통장을 봐야 알기 때문에,
 * 먼저 표시해 두면 받은 사람은 맞는지만 보면 된다.
 */
export async function markTransferSent(args: {
  ledgerId: string;
  transferId: string;
  undo?: boolean;
}): Promise<Result> {
  try {
    const pass = await requireLedgerAccess(args.ledgerId);
    if (args.undo) await unmarkSent(args.transferId, pass.memberId);
    else await markSent(args.transferId, pass.memberId);
    revalidatePath(`/l/${args.ledgerId}`, 'layout');
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/** 송금 받았다고 표시. 받은 사람 본인만 가능하다. */
export async function markTransferReceived(args: {
  ledgerId: string;
  transferId: string;
}): Promise<Result> {
  try {
    const pass = await requireLedgerAccess(args.ledgerId);
    await confirmTransfer(args.transferId, pass.memberId);
    revalidatePath(`/l/${args.ledgerId}`);
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}
