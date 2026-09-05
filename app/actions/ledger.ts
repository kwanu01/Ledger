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
  renameGroup,
  setExpenseChecked,
  insertIncome,
  removeIncome,
  setLedgerKind,
  setLedgerBudget,
  setTermClosed,
} from '../../lib/db/repo.ts';
import { checkItemLines, currentRoster } from '../../lib/domain/settlement.ts';
import { failed } from '../../lib/fail.ts';
import type { Allocation, FundSource, IncomeKind } from '../../lib/domain/types.ts';
import { collectsDues, usesFund } from '../../lib/domain/closing.ts';
import { MAX_BATCH } from '../../lib/limits.ts';

/**
 * 부담 방식이 성립하는가 (§10)
 *
 * 화면에서도 같은 것을 검사한다. 그래도 여기서 다시 하는 이유는, 서버 액션은
 * 화면을 거치지 않고도 부를 수 있기 때문이다. DB 에도 같은 규칙이 걸려 있다
 * (0002_guards.sql, 0018_item_lines.sql). 회계 규칙은 세 겹으로 둔다.
 *
 * 맞으면 null, 틀리면 사람이 읽을 수 있는 첫 이유 하나를 돌려준다.
 */
function vetAllocation(a: Allocation, amount: number, roster: string[]): string | null {
  if (a.type === 'partial' && a.participantIds.length === 0) {
    return '부담할 사람을 골라 주세요.';
  }
  if (a.type === 'items') {
    const bad = checkItemLines({ lines: a.lines, total: amount, roster });
    if (bad.length > 0) return bad[0];
  }
  return null;
}

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
  /** 지출 묶음 이름 (§11.3). 계산에 들어가지 않는 이름표다. */
  group?: string;
  productLink?: string;
  receiptPath?: string;
  note?: string;
  /**
   * AI 가 사진에서 읽은 금액 (§13.2)
   *
   * 사람이 폼에서 금액을 고쳐도 이 값은 읽은 그대로 온다. 둘이 다르면
   * 나중에 검사가 묻는다 — 읽은 값을 버리면 못 잡는 종류의 오류가 있다.
   */
  readAmount?: number;
};

export async function recordExpense(input: ExpenseInput): Promise<Result<{ id: string }>> {
  try {
    const pass = await requireLedgerAccess(input.ledgerId);
    if (!input.title.trim()) return { ok: false, message: '항목 이름을 입력하세요.' };
    if (!Number.isInteger(input.amount) || input.amount === 0) {
      return { ok: false, message: '금액은 0이 아닌 정수여야 합니다.' };
    }

    const ledger = await loadLedger(input.ledgerId);
    // '전체 팀'은 지금 팀원이 아니라 기록하는 이 순간의 팀원을 뜻한다.
    const roster = currentRoster(ledger);

    const wrong = vetAllocation(input.allocation, input.amount, roster);
    if (wrong) return { ok: false, message: wrong };

    const id = await insertExpense({
      ledgerId: input.ledgerId,
      date: input.date,
      title: input.title.trim(),
      amount: input.amount,
      payerId: input.payerId,
      teamMemberIds: roster,
      allocation: input.allocation,
      vendor: input.vendor,
      category: input.category,
      group: input.group,
      productLink: input.productLink,
      receiptImage: input.receiptPath,
      note: input.note,
      readAmount: input.readAmount,
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

/**
 * 여러 줄을 한꺼번에 적기 (§11.4)
 *
 * 팀플 정산은 대개 "끝나고 몰아서"다. 영수증이 열 장 쌓여 있고, 그걸 한 장씩
 * 폼을 열었다 닫았다 하며 적게 하면 대부분 도중에 그만둔다.
 *
 * 한 번에 보내는 이유는 왕복 횟수만이 아니다. 한 줄씩 보내면 중간에 회선이
 * 끊겼을 때 **몇 줄까지 적혔는지 사람도 화면도 모른다.** 여기서 한 번에
 * 받고, 적힌 줄의 id 를 순서대로 돌려준다 — 사진은 그 id 를 보고 붙는다.
 *
 * 한 줄이 실패해도 나머지는 계속 적는다. 그리고 어느 줄이 실패했는지 말한다.
 * 조용히 반쯤 적어 놓고 성공했다고 하는 것이 가장 나쁘다. (deleteExpenses 와 같은 규칙)
 */
export async function recordExpenses(input: {
  ledgerId: string;
  rows: Omit<ExpenseInput, 'ledgerId'>[];
}): Promise<Result<{ saved: { at: number; id: string }[]; failed: { at: number; why: string }[] }>> {
  try {
    const pass = await requireLedgerAccess(input.ledgerId);
    if (input.rows.length === 0) return { ok: false, message: '적을 줄이 없습니다.' };
    if (input.rows.length > MAX_BATCH) {
      return { ok: false, message: `한 번에 ${MAX_BATCH}줄까지 적을 수 있습니다.` };
    }

    // 장부는 한 번만 읽는다. 줄마다 읽으면 열 줄에 열 번이다.
    const ledger = await loadLedger(input.ledgerId);
    const roster = currentRoster(ledger);

    const saved: { at: number; id: string }[] = [];
    const bad: { at: number; why: string }[] = [];

    for (const [at, row] of input.rows.entries()) {
      try {
        if (!row.title.trim()) throw new Error('항목 이름이 비어 있습니다.');
        if (!Number.isInteger(row.amount) || row.amount === 0) {
          throw new Error('금액이 비어 있습니다.');
        }
        const wrong = vetAllocation(row.allocation, row.amount, roster);
        if (wrong) throw new Error(wrong);

        const id = await insertExpense({
          ledgerId: input.ledgerId,
          date: row.date,
          title: row.title.trim(),
          amount: row.amount,
          payerId: row.payerId,
          teamMemberIds: roster,
          allocation: row.allocation,
          vendor: row.vendor,
          category: row.category,
          group: row.group,
          productLink: row.productLink,
          receiptImage: row.receiptPath,
          note: row.note,
          readAmount: row.readAmount,
          createdBy: pass.memberId,
        });
        saved.push({ at, id });
      } catch (e) {
        bad.push({ at, why: e instanceof Error ? e.message : '적지 못했습니다.' });
      }
    }

    if (saved.length > 0) {
      await reopenLedger(input.ledgerId);
      revalidatePath(`/l/${input.ledgerId}`, 'layout');
      revalidatePath('/teams');
    }
    return { ok: true, value: { saved, failed: bad } };
  } catch (e) {
    return failed(e);
  }
}

/* ── 들어온 돈 (§12) ──────────────────────────────────────────────────── */

/**
 * 수입 한 줄 적기.
 *
 * 지출과 나란한 것이지 지출의 일종이 아니다. 지분도 부담자도 없고 정산에
 * 들어가지 않는다 — 결산에만 들어간다.
 *
 * 각자 결제하는 장부(each)에는 수입이 없다. 들어온 돈이 있다는 것은 모아 둔
 * 주머니가 있다는 뜻이고, 그 주머니가 있으면 그건 이미 다른 성격의 장부다.
 */
export async function recordIncome(input: {
  ledgerId: string;
  date: string;
  title: string;
  amount: number;
  kind: IncomeKind;
  memberId?: string;
  note?: string;
}): Promise<Result<{ id: string }>> {
  try {
    const pass = await requireLedgerAccess(input.ledgerId);
    if (!input.title.trim()) return { ok: false, message: '무엇으로 들어왔는지 적어 주세요.' };
    if (!Number.isInteger(input.amount) || input.amount === 0) {
      return { ok: false, message: '금액을 적어 주세요.' };
    }

    const ledger = await loadLedger(input.ledgerId);
    if (!usesFund(ledger)) {
      return { ok: false, message: '각자 결제하는 장부에는 들어온 돈을 적지 않습니다.' };
    }
    if (ledger.closedAt) {
      return { ok: false, message: '닫힌 회기에는 수입을 적을 수 없습니다. 회기를 다시 열어 주세요.' };
    }
    if (input.kind === 'dues' && !input.memberId) {
      return { ok: false, message: '회비를 낸 사람을 골라 주세요.' };
    }
    if (input.kind === 'dues' && !collectsDues(ledger)) {
      return { ok: false, message: '이 장부는 회비를 걷지 않습니다.' };
    }

    const id = await insertIncome({
      ledgerId: input.ledgerId,
      date: input.date,
      title: input.title.trim(),
      amount: input.amount,
      kind: input.kind,
      memberId: input.kind === 'dues' ? input.memberId : undefined,
      note: input.note?.trim() || undefined,
      createdBy: pass.memberId,
    });

    revalidatePath(`/l/${input.ledgerId}`, 'layout');
    return { ok: true, value: { id } };
  } catch (e) {
    return failed(e);
  }
}

export async function deleteIncome(args: { ledgerId: string; incomeId: string }): Promise<Result> {
  try {
    await requireLedgerAccess(args.ledgerId);
    await removeIncome(args.incomeId, args.ledgerId);
    revalidatePath(`/l/${args.ledgerId}`, 'layout');
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/**
 * 장부의 성격 (§12)
 *
 * 고르는 순간 화면이 실제로 달라진다 — 수입과 결산이 켜지고, 부담 방식에
 * '공금'이 생기고, 회비를 걷는 장부면 미납을 센다. 아무것도 안 달라지는
 * 값은 저장하지 않는다.
 *
 * 성격을 되돌릴 때 이미 적힌 공금 지출이나 수입을 지우지는 않는다. 지우는
 * 것은 사람이 할 일이지 설정 한 번이 할 일이 아니다. 다만 화면에서 그 줄들이
 * 갈 곳이 없어지므로, 그런 줄이 있으면 막는다.
 */
export async function setBookKind(input: {
  ledgerId: string;
  fundSource: FundSource;
  termCarry: boolean;
  duesPerHead?: number;
}): Promise<Result> {
  try {
    await requireLedgerAccess(input.ledgerId);
    const ledger = await loadLedger(input.ledgerId);

    if (input.fundSource === 'each') {
      const fundRows = ledger.expenses.filter((e) => e.allocation.type === 'common').length;
      const inRows = (ledger.incomes ?? []).length;
      if (fundRows > 0 || inRows > 0) {
        return {
          ok: false,
          message:
            `공금 지출 ${fundRows}건과 들어온 돈 ${inRows}건이 이미 적혀 있습니다. ` +
            '그 줄들을 먼저 지워야 각자 결제하는 장부로 되돌릴 수 있습니다.',
        };
      }
    }
    if (input.duesPerHead !== undefined && input.duesPerHead <= 0) {
      return { ok: false, message: '1인당 회비는 0보다 커야 합니다.' };
    }

    await setLedgerKind({
      ledgerId: input.ledgerId,
      fundSource: input.fundSource,
      termCarry: input.termCarry,
      duesPerHead: input.fundSource === 'each' ? undefined : input.duesPerHead,
    });
    revalidatePath(`/l/${input.ledgerId}`, 'layout');
    revalidatePath('/teams');
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/**
 * 회기 닫기·다시 열기 (§12)
 *
 * 닫는다는 것은 "이 회기의 숫자는 이제 고정"이라는 선언이다. 지출의
 * 정산과 같은 성격이라 되돌릴 수 있게 둔다 — 총회에서 숫자가 틀렸다고
 * 하면 다시 열어 고쳐야 하기 때문이다.
 */
export async function closeTerm(input: { ledgerId: string; closed: boolean }): Promise<Result> {
  try {
    await requireLedgerAccess(input.ledgerId);
    await setTermClosed(input.ledgerId, input.closed);
    revalidatePath(`/l/${input.ledgerId}`, 'layout');
    return { ok: true };
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
 * 묶음 이름 바꾸기 (§11.3)
 *
 * 이름을 바꾸고, 합치고, 푸는 일이 전부 이 하나다. 이미 있는 이름을 적으면
 * 두 묶음이 합쳐지고, 비우면 그 줄들이 묶음에서 풀린다. 묶음은 계산에
 * 들어가지 않으므로 정산이 끝난 줄도 함께 바뀐다.
 */
export async function renameExpenseGroup(input: {
  ledgerId: string;
  from: string;
  to: string;
}): Promise<Result> {
  try {
    await requireLedgerAccess(input.ledgerId);
    if (!input.from.trim()) return { ok: false, message: '바꿀 묶음을 고르세요.' };
    if (input.from.trim() === input.to.trim()) return { ok: true };

    await renameGroup({ ledgerId: input.ledgerId, from: input.from, to: input.to });
    revalidatePath(`/l/${input.ledgerId}`, 'layout');
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/**
 * 예산을 적어 둔다 (§14)
 *
 * **비워 두는 것이 기본이다.** 공금 장부에서 예산은 이미 장부 안에 있다 —
 * 들어온 돈이 곧 쓸 수 있는 돈이다(lib/domain/ahead.ts). 이 액션은 그 값이
 * 사실과 다를 때를 위한 자리다: 받기로 했는데 아직 안 들어온 지원금 같은 것.
 *
 * 0 이나 빈 값을 보내면 지운다 — 다시 장부가 알아낸다. '지우기'를 따로
 * 만들지 않는 이유는, 비우는 것과 지우는 것이 사람에게 같은 일이어서다.
 */
export async function setBudget(input: {
  ledgerId: string;
  budget?: number;
}): Promise<Result> {
  try {
    await requireLedgerAccess(input.ledgerId);
    const ledger = await loadLedger(input.ledgerId);
    if (!usesFund(ledger)) {
      return { ok: false, message: '각자 결제하는 장부에는 예산이 없습니다.' };
    }
    if (input.budget !== undefined && (!Number.isInteger(input.budget) || input.budget < 0)) {
      return { ok: false, message: '예산은 0보다 큰 정수여야 합니다.' };
    }

    await setLedgerBudget({
      ledgerId: input.ledgerId,
      budget: input.budget && input.budget > 0 ? input.budget : undefined,
    });
    revalidatePath(`/l/${input.ledgerId}`, 'layout');
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/**
 * 검사의 물음에 "괜찮다"고 답한다 (§13)
 *
 * 지우는 것도 고치는 것도 아니다. **이 줄은 사람이 보고 넘겼다**는 표시
 * 하나를 남길 뿐이고, 그 뒤로 검사는 이 줄을 안 묻는다.
 *
 * ── 왜 되돌릴 수 있어야 하는가
 *
 * 급해서 넘긴 것과 확인하고 넘긴 것이 화면에서 구별되지 않는다. 되돌릴 수
 * 없으면 잘못 누른 한 번이 영영 조용해진다. 그래서 undo 를 함께 둔다.
 *
 * ── 왜 정산된 줄에도 되는가
 *
 * checked_at 은 계산에 안 들어간다(0021). 오히려 검사가 제일 쓸모 있는
 * 순간이 정산 직전이라, 그때 답한 것이 확정 뒤에 되살아나면 아카이브가
 * 물음표로 뒤덮인다.
 */
export async function markChecked(input: {
  ledgerId: string;
  expenseId: string;
  checked: boolean;
}): Promise<Result> {
  try {
    await requireLedgerAccess(input.ledgerId);
    await setExpenseChecked({
      ledgerId: input.ledgerId,
      expenseId: input.expenseId,
      checked: input.checked,
    });
    revalidatePath(`/l/${input.ledgerId}`, 'layout');
    return { ok: true };
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
 * 고른 줄들을 한꺼번에 지우기 (§12)
 *
 * 장부를 정리할 때는 한 줄이 아니라 여러 줄이 잘못돼 있다 — 시험 삼아 넣은
 * 것, 두 번 적힌 것. 그걸 한 줄씩 지우게 하면 되묻는 창이 열 번 뜬다.
 *
 * 한 번에 보내는 이유는 왕복 횟수만이 아니다. 한 줄씩 보내면 중간에 회선이
 * 끊겼을 때 **몇 줄까지 지워졌는지 사람도 화면도 모른다.** 여기서 한 번에
 * 받고, 지운 수를 세어 돌려준다.
 *
 * 한 줄이 실패해도 나머지는 계속 지운다. 그리고 몇 줄이 남았는지 말한다 —
 * 조용히 반쯤 지워 놓고 성공했다고 하는 것이 가장 나쁘다.
 */
export async function deleteExpenses(args: {
  ledgerId: string;
  expenseIds: string[];
}): Promise<Result<{ removed: number; missed: number }>> {
  try {
    await requireLedgerAccess(args.ledgerId);
    if (args.expenseIds.length === 0) return { ok: false, message: '지울 줄을 고르세요.' };

    let removed = 0;
    // 이름을 failed 로 두면 위에서 들여온 failed() 를 가린다.
    let missed = 0;
    for (const id of args.expenseIds) {
      try {
        await removeExpense(id, args.ledgerId);
        removed += 1;
      } catch {
        missed += 1;
      }
    }

    revalidatePath(`/l/${args.ledgerId}`, 'layout');
    revalidatePath('/teams');
    return { ok: true, value: { removed, missed } };
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
  group?: string;
  productLink?: string;
  note?: string;
}): Promise<Result> {
  try {
    await requireLedgerAccess(input.ledgerId);
    if (!input.title.trim()) return { ok: false, message: '항목 이름을 입력하세요.' };
    if (!Number.isInteger(input.amount) || input.amount === 0) {
      return { ok: false, message: '금액은 0이 아닌 정수여야 합니다.' };
    }
    /*
     * 고칠 때의 기준 명단은 **그 줄에 박혀 있는 명단**이다. 지금 팀원이
     * 아니다. team_member_ids 는 고치지 않으므로, 지금 들어온 팀원을
     * 항목 부담자로 고르면 지분 합이 어긋난다.
     */
    const ledger = await loadLedger(input.ledgerId);
    const line = ledger.expenses.find((e) => e.id === input.expenseId);
    if (!line) return { ok: false, message: '고칠 지출을 찾을 수 없습니다.' };

    const wrong = vetAllocation(input.allocation, input.amount, line.teamMemberIds);
    if (wrong) return { ok: false, message: wrong };

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
      group: input.group?.trim() || undefined,
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
  group?: string;
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
      group: input.group?.trim() || undefined,
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
