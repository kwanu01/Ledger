import 'server-only';
import { db } from '../db/client.ts';
import { toExpense, type ExpenseRow } from '../db/mapping.ts';
import type { ExpenseInput } from '../../app/actions/ledger.ts';
import { matchesExpenseRequest } from './idempotency.ts';

export async function findExpenseReplay(id: string, input: ExpenseInput): Promise<string | null> {
  const { data, error } = await db.from('expenses').select('*').eq('id', id).eq('ledger_id', input.ledgerId).maybeSingle<ExpenseRow>();
  if (error) throw new Error('이미 저장된 기록을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  if (!data) return null;
  if (!matchesExpenseRequest(toExpense(data), input)) throw new Error('이 기록 번호로 다른 내용이 이미 저장되어 있습니다. 장부에서 기존 기록을 확인해 주세요.');
  return data.id;
}
