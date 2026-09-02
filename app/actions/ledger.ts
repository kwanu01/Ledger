'use server';

import { revalidatePath } from 'next/cache';
import { requireLedgerAccess, isTeamOwner as isOwner } from '../../lib/access.ts';
import {
  cancelSettlement,
  confirmSettlement,
  confirmTransfer,
  activeMemberCount,
  archiveLedger,
  reopenLedger,
  confirmTransferAsOwner,
  markSent,
  unmarkSent,
  insertAdjustment,
  insertExpense,
  loadLedger,
  removeExpense,
  editExpense,
  relabelExpense,
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

    // 닫혔던 장부에 다시 적으면 다시 열린다. 닫는 것은 지우는 것이 아니다.
    await reopenLedger(input.ledgerId);
    revalidatePath(`/l/${input.ledgerId}`, 'layout');
    revalidatePath('/teams');
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

/**
 * 지출 한 줄 지우기 (§12)
 *
 * 없던 기록이 된다. 정산에 이미 들어간 줄이라도 지울 수 있고, 그때는 그
 * 정산이 통째로 걷어진다 — 정산이 반쯤 맞는 상태로 남지 않게 하기 위해서다.
 * 걷어진 정산의 나머지 지출은 미정산으로 돌아가므로 다시 정산하면 된다.
 *
 * 한 군데만 막혀 있다. 이미 받았다고 확인된 송금이 있는 정산은 못 지운다.
 * 돈이 실제로 오간 것이고, 그것은 되돌릴 수 없다.
 *
 * 붙어 있던 사진도 함께 지운다. 가리키는 줄이 없어진 사진은 아무도 볼 수 없고
 * 저장소에만 남는다.
 */
export async function deleteExpense(args: {
  ledgerId: string;
  expenseId: string;
}): Promise<Result> {
  try {
    await requireLedgerAccess(args.ledgerId);
    await removeExpense(args.expenseId, args.ledgerId);
    revalidatePath(`/l/${args.ledgerId}`, 'layout');
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/**
 * 지출 한 줄 고치기 (§12)
 *
 * 아직 정산에 들어가지 않은 줄은 원본을 그대로 고친다. 잘못 적은 것을
 * 바로잡는 데 보정 항목까지 남길 이유는 없다 — 그건 이미 계산에 들어간
 * 숫자를 건드리지 않으려고 만든 장치다.
 *
 * 정산에 들어간 줄은 데이터베이스가 막는다. 그때는 기존대로 보정 항목이다.
 */
export async function editExpenseLine(input: {
  ledgerId: string;
  expenseId: string;
  date: string;
  title: string;
  amount: number;
  payerId: string;
  allocation: Allocation;
  vendor?: string;
  category?: string;
  productLink?: string;
  note?: string;
}): Promise<Result> {
  try {
    await requireLedgerAccess(input.ledgerId);
    if (!input.title.trim()) return { ok: false, message: '항목 이름을 입력하세요.' };
    if (!Number.isInteger(input.amount) || input.amount === 0) {
      return { ok: false, message: '금액은 0이 아닌 정수여야 합니다.' };
    }
    if (input.allocation.type === 'partial' && input.allocation.participantIds.length === 0) {
      return { ok: false, message: '부담할 사람을 골라 주세요.' };
    }

    await editExpense({
      expenseId: input.expenseId,
      ledgerId: input.ledgerId,
      date: input.date,
      title: input.title.trim(),
      amount: input.amount,
      payerId: input.payerId,
      allocation: input.allocation,
      vendor: input.vendor?.trim() || undefined,
      category: input.category?.trim() || undefined,
      productLink: input.productLink?.trim() || undefined,
      note: input.note?.trim() || undefined,
    });

    revalidatePath(`/l/${input.ledgerId}`, 'layout');
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/**
 * 이름표 고치기 (§12)
 *
 * 정산이 끝난 줄에도 **분류는 붙일 수 있어야 한다.** 한 학기가 끝나고
 * 아카이브를 보면서 "이건 식비가 아니라 재료비였네" 하는 순간이 온다.
 * 그때 장부가 굳어 있으면 남는 것은 틀린 기록이다.
 *
 * 고칠 수 있는 것은 계산에 들어가지 않는 것들뿐이다. 금액·날짜·결제자·부담
 * 방식은 이 함수의 인자에 아예 없다. 확정된 정산의 숫자는 끝까지 그대로다.
 */
export async function relabelExpenseLine(input: {
  ledgerId: string;
  expenseId: string;
  title: string;
  vendor?: string;
  category?: string;
  productLink?: string;
  note?: string;
}): Promise<Result> {
  try {
    await requireLedgerAccess(input.ledgerId);
    if (!input.title.trim()) return { ok: false, message: '항목 이름을 입력하세요.' };

    await relabelExpense({
      expenseId: input.expenseId,
      ledgerId: input.ledgerId,
      title: input.title.trim(),
      vendor: input.vendor?.trim() || undefined,
      category: input.category?.trim() || undefined,
      productLink: input.productLink?.trim() || undefined,
      note: input.note?.trim() || undefined,
    });

    revalidatePath(`/l/${input.ledgerId}`, 'layout');
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/* ── 정산 ─────────────────────────────────────────────────────────────── */

/**
 * 정산 확정 (§12)
 *
 * expenseIds 를 안 넘기면 **아직 정산하지 않은 것 전부**가 대상이다.
 * 골라서 하는 것이 기본이 아니라, 전부가 기본이고 고르는 것이 선택이다 —
 * 대개는 그날까지의 것을 다 닫는다.
 *
 * 팀원이 한 사람이면 나눌 상대가 없어 송금이 0건이다. 확인을 기다릴 것이
 * 없으니 그 순간 끝나고, 장부도 함께 닫는다. 남은 일이 없는 장부를 열린
 * 채로 두면 목록에서 계속 볼 것이 있는 것처럼 보인다.
 */
export async function settle(args: {
  ledgerId: string;
  expenseIds?: string[];
  label?: string;
  isFinal?: boolean;
}): Promise<Result<{ settlementId: string; transferCount: number; archived: boolean }>> {
  try {
    const pass = await requireLedgerAccess(args.ledgerId);
    const value = await confirmSettlement(args);

    let archived = false;
    if (value.transferCount === 0 && (await activeMemberCount(pass.teamId)) <= 1) {
      await archiveLedger(args.ledgerId);
      archived = true;
    }

    revalidatePath(`/l/${args.ledgerId}`, 'layout');
    revalidatePath('/teams');
    return { ok: true, value: { ...value, archived } };
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

/**
 * 송금 받았다고 표시 (§12)
 *
 * 원칙은 그대로다 — **돈이 오갔다고 판정하는 것은 받은 사람뿐이다.** 보낸
 * 사람의 '보냈어요'는 앞선 신호일 뿐 이 판정을 대신하지 못한다. 팀플에서
 * 제일 흔한 분쟁인 "보냈는데요 / 안 들어왔는데요"가 그래서 안 생긴다.
 *
 * 예외가 하나 있다. **장부 소유자**는 대신 확인할 수 있다. 받는 사람이 안
 * 눌러 주면 그 정산이 영원히 안 닫히기 때문이다 — 학기가 끝나면 아무도 앱에
 * 안 들어온다. 안 닫히는 장부도 틀린 장부다.
 *
 * 대신 눌러도 누가 눌렀는지는 남는다. 권한을 넓히는 것과 기록을 흐리는 것은
 * 다른 일이다.
 */
export async function markTransferReceived(args: {
  ledgerId: string;
  transferId: string;
  /** 내가 받을 돈이 아닌데 소유자로서 대신 누르는 경우. */
  onBehalf?: boolean;
}): Promise<Result> {
  try {
    const pass = await requireLedgerAccess(args.ledgerId);

    if (args.onBehalf) {
      if (!(await isOwner(pass))) {
        return { ok: false, message: '장부를 만든 사람만 대신 확인할 수 있습니다.' };
      }
      await confirmTransferAsOwner({
        transferId: args.transferId,
        byMemberId: pass.memberId,
        ledgerId: args.ledgerId,
      });
    } else {
      await confirmTransfer(args.transferId, pass.memberId);
    }

    revalidatePath(`/l/${args.ledgerId}`, 'layout');
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}
