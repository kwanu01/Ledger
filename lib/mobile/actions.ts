import 'server-only';
import { revalidatePath } from 'next/cache';
import * as actions from '../../app/actions/ledger.ts';
import * as ai from '../../app/actions/receipt.ts';
import { askHelper } from '../../app/actions/ask.ts';
import { db } from '../db/client.ts';
import { loadLedger } from '../db/repo.ts';
import { unsettledExpenses } from '../domain/settlement.ts';
import { MobileError } from './http.ts';
import { mobileAccess } from './server.ts';
import { scopedTransfer } from './data.ts';
import { parseAction, parseAI } from './validation.ts';
import { transferDecision } from './permissions.ts';

const rejected = (message: string): never => { throw new MobileError(409, 'ACTION_REJECTED', message); };

export async function dispatchAction(id: string, action: string, value: unknown) {
  const { ledgerId, pass, isOwner } = await mobileAccess(id);
  const command = parseAction(action, value);
  if (command.action === 'markTransferSent' || command.action === 'markTransferReceived') {
    const transfer = await scopedTransfer(ledgerId, command.input.transferId);
    const decision = transferDecision(transfer, pass.memberId, isOwner, { action: command.action, ...command.input });
    if (decision === 'unchanged') return { ok: true };
    if (command.action === 'markTransferSent') {
      return actions.markTransferSent({ ledgerId, ...command.input });
    }
    return actions.markTransferReceived({ ledgerId, ...command.input });
  }

  const ledger = await loadLedger(ledgerId);
  const activeIds = new Set(ledger.members.filter((member) => member.active !== false).map((member) => member.id));
  switch (command.action) {
    case 'recordExpense': {
      const input = command.input;
      if (!activeIds.has(input.payerId)) return rejected('현재 팀에서 결제한 사람을 골라 주세요.');
      const allocation = input.allocation;
      if (allocation.type === 'common' && (ledger.fundSource ?? 'each') === 'each') return rejected('공금 장부에서 사용할 수 있습니다.');
      const bearers = allocation.type === 'partial' ? allocation.participantIds : allocation.type === 'personal' ? [allocation.ownerId]
        : allocation.type === 'items' ? allocation.lines.flatMap((line) => line.memberIds) : [];
      if (bearers.some((memberId) => !activeIds.has(memberId))) return rejected('현재 팀에서 함께 나눌 사람을 골라 주세요.');
      return actions.recordExpense({ ledgerId, ...input });
    }
    case 'recordIncome':
      if (command.input.memberId && !activeIds.has(command.input.memberId)) return rejected('현재 팀에서 회비를 낸 사람을 골라 주세요.');
      return actions.recordIncome({ ledgerId, ...command.input });
    case 'setBookKind': return actions.setBookKind({ ledgerId, ...command.input });
    case 'setBudget': return actions.setBudget({ ledgerId, ...command.input });
    case 'setLedgerSettings': {
      const input = command.input;
      if (input.fundSource === 'each') {
        if (ledger.expenses.some((expense) => expense.allocation.type === 'common') || ledger.incomes.length)
          return rejected('공금 지출이나 수입이 있는 장부는 각자 결제로 바꿀 수 없습니다.');
        if (input.budget !== undefined || input.duesPerHead !== undefined)
          return rejected('각자 결제에서는 예산과 회비를 비워 주세요.');
      }
      // One write: an error cannot save the fund kind while losing the budget.
      const { error } = await db.from('ledgers').update({ fund_source: input.fundSource,
        dues_per_head: input.duesPerHead ?? null, budget: input.budget ?? null }).eq('id', ledgerId);
      if (error) throw new Error('Ledger settings update failed');
      revalidatePath(`/l/${ledgerId}`, 'layout');
      revalidatePath('/teams');
      return { ok: true };
    }
    case 'closeTerm': return actions.closeTerm({ ledgerId, ...command.input });
    case 'settle': {
      const pending = unsettledExpenses(ledger);
      const expenseIds = command.input.expenseIds ?? pending.map((expense) => expense.id);
      if (!expenseIds.length || expenseIds.some((expenseId) => !pending.some((expense) => expense.id === expenseId)))
        return rejected('이미 정산되었거나 정산할 수 없는 항목이 있습니다. 새로고침해 주세요.');
      return actions.settle({ ledgerId, ...command.input, expenseIds });
    }
    case 'markChecked':
      if (!ledger.expenses.some((expense) => expense.id === command.input.expenseId)) return rejected('이 장부의 지출을 찾을 수 없습니다.');
      return actions.markChecked({ ledgerId, ...command.input });
    case 'addAdjustment': {
      const input = command.input;
      const target = ledger.expenses.find((expense) => expense.id === input.targetExpenseId);
      if (!target || target.adjustment) return rejected('환불이나 차액은 원래 지출에서 기록해 주세요.');
      const current = ledger.expenses.filter((expense) => expense.id === target.id || expense.adjustment?.targetExpenseId === target.id)
        .reduce((sum, expense) => sum + expense.amount, 0);
      if (!Number.isSafeInteger(current + input.amount) || current + input.amount < 0) return rejected('현재 지출 금액보다 많이 차감할 수 없습니다.');
      const shared = { ledgerId, targetId: target.id, payerId: target.payerId, date: input.date,
        title: `${target.title} ${input.kind === 'refund' ? '환불' : '수정'}`, reason: input.reason };
      return input.kind === 'refund'
        ? actions.recordRefund({ ...shared, refundedAmount: -input.amount })
        : actions.recordCorrection({ ...shared, originalAmount: current, actualAmount: current + input.amount });
    }
  }
}

export async function dispatchAI(id: string, action: string, value: unknown) {
  const { ledgerId } = await mobileAccess(id);
  const command = parseAI(action, value);
  switch (command.action) {
    case 'askHelper': return askHelper({ ledgerId, ...command.input });
    case 'jotExpense': return ai.jotExpense({ ledgerId, ...command.input });
    case 'jotIncomeLine': return ai.jotIncomeLine({ ledgerId, ...command.input });
    case 'askToPay': return ai.askToPay({ ledgerId, ...command.input });
  }
}

export async function dispatchReceipt(id: string, form: FormData) {
  const { ledgerId } = await mobileAccess(id);
  const action = form.get('action');
  if (action !== 'analyzeReceipt' && action !== 'analyzeReceiptLines')
    throw new MobileError(400, 'UNKNOWN_ACTION', '사진 분석 방식을 확인해 주세요.');
  if ([...form.keys()].some((key) => !['action', 'image'].includes(key)) || form.getAll('image').length !== 1 || form.getAll('action').length !== 1)
    throw new MobileError(400, 'INVALID_INPUT', '사진 한 장을 첨부해 주세요.');
  form.set('ledgerId', ledgerId);
  return action === 'analyzeReceipt' ? ai.analyzeReceipt(form) : ai.analyzeReceiptLines(form);
}
