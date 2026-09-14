import { createHash } from 'node:crypto';
import type { Expense } from '../domain/types.ts';

export function expenseRequestId(userId: string, ledgerId: string, clientId: string): string {
  if (!userId || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(clientId)) throw new Error('기록 번호를 확인해 주세요.');
  const bytes = createHash('sha256').update(JSON.stringify(['chagok-expense-v1', userId, ledgerId, clientId])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const value = bytes.toString('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

type ReplayInput = Pick<Expense, 'ledgerId' | 'date' | 'title' | 'amount' | 'payerId' | 'allocation' | 'vendor' | 'category' | 'group' | 'productLink' | 'note' | 'readAmount'> & { receiptPath?: string };
const normalized = (input: ReplayInput) => ({
  ledgerId: input.ledgerId, date: input.date, title: input.title.trim(), amount: input.amount, payerId: input.payerId,
  allocation: input.allocation, vendor: input.vendor ?? null, category: input.category ?? null,
  group: input.group?.trim() || null, productLink: input.productLink ?? null, note: input.note ?? null,
  readAmount: input.readAmount ?? null, receiptPath: input.receiptPath ?? null,
});
function canonical(value: unknown): string {
  const ordered = (item: unknown): unknown => Array.isArray(item) ? item.map(ordered) : item && typeof item === 'object'
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, ordered(v)])) : item;
  return JSON.stringify(ordered(value));
}

/** Current roster and timestamps are not part of the request: a retry keeps the original snapshot. */
export function matchesExpenseRequest(expense: Expense, input: ReplayInput): boolean {
  return !expense.adjustment && canonical(normalized({ ...expense, receiptPath: expense.receiptImage })) === canonical(normalized(input));
}
