import { computeSettlement } from './domain/settlement.ts';
import type { Expense, Member } from './domain/types.ts';

export const demoMembers: Member[] = [
  { id: 'minsu', name: '민수' }, { id: 'jiu', name: '지우' }, { id: 'seoyeon', name: '서연' },
];
export type DemoEntry = { id: string; title: string; amount: string; payerId: string; together: boolean };
export const starterEntries: DemoEntry[] = [
  { id: 'lunch', title: '점심', amount: '48000', payerId: 'minsu', together: true },
  { id: 'supplies', title: '준비물', amount: '27000', payerId: 'jiu', together: false },
  { id: 'taxi', title: '택시', amount: '18000', payerId: 'seoyeon', together: true },
];
export function calculateDemo(entries: DemoEntry[]) {
  const errors: Record<string, string> = {};
  const expenses: Expense[] = entries.map(entry => {
    const input = entry.amount.trim();
    const normalized = /^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(input) ? input.replaceAll(',', '') : '';
    const amount = /^\d{1,9}$/.test(normalized) ? Number(normalized) : NaN;
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100_000_000)
      errors[entry.id] = '1원부터 1억 원까지 입력해 주세요.';
    return { id: entry.id, ledgerId: 'demo', date: '2026-09-01', title: entry.title,
      amount, payerId: entry.payerId, teamMemberIds: demoMembers.map(member => member.id),
      allocation: entry.together ? { type: 'all' as const } : { type: 'partial' as const, participantIds: ['jiu', 'seoyeon'] },
      createdAt: '', createdBy: entry.payerId };
  });
  return { errors, result: Object.keys(errors).length ? null : computeSettlement(expenses, demoMembers) };
}
export function demoShareText(entries: DemoEntry[]): string | null {
  const { result } = calculateDemo(entries);
  if (!result) return null;
  const won = (amount: number) => `${amount.toLocaleString('ko-KR')}원`;
  const name = (id: string) => demoMembers.find(member => member.id === id)!.name;
  const transfers = result.transfers.map(transfer => `${name(transfer.fromMemberId)} → ${name(transfer.toMemberId)}  ${won(transfer.amount)}`);
  return ['차곡 · 예시 장부 정산', '', ...(transfers.length ? transfers : ['주고받을 금액이 없습니다.']),
    '', `총 지출 ${won(result.totalAmount)}`, '가상의 이름과 기록으로 계산한 체험 결과입니다.',
    'https://teamledger.net/demo?ref=share'].join('\n');
}
