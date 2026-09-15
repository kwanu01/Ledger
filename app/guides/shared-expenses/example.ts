import { fundBook } from '../../../lib/domain/closing.ts';
import { computeSettlement } from '../../../lib/domain/settlement.ts';
import type { Ledger } from '../../../lib/domain/types.ts';

/** Fictional records only. The guide uses the same fund and settlement calculations as the app. */
export function sharedExpenseExample() {
  const members = [
    { id: 'minsu', name: '민수' },
    { id: 'jiu', name: '지우' },
    { id: 'seoyeon', name: '서연' },
  ];
  const ledger: Ledger = {
    id: 'guide-example', teamName: '세 사람의 모임', name: '회비와 개인 결제 예시',
    startedAt: '2026-09-01', currency: 'KRW', fundSource: 'dues', duesPerHead: 20_000,
    members, settlements: [],
    incomes: members.map(member => ({
      id: `dues-${member.id}`, ledgerId: 'guide-example', date: '2026-09-01',
      title: '회비', amount: 20_000, kind: 'dues', memberId: member.id, createdAt: '',
    })),
    expenses: [
      { id: 'fund-meal', ledgerId: 'guide-example', date: '2026-09-01', title: '식사',
        amount: 45_000, payerId: 'minsu', teamMemberIds: members.map(member => member.id),
        allocation: { type: 'common' }, createdAt: '', createdBy: 'minsu' },
      { id: 'personal-payment', ledgerId: 'guide-example', date: '2026-09-01', title: '준비물',
        amount: 30_000, payerId: 'minsu', teamMemberIds: members.map(member => member.id),
        allocation: { type: 'all' }, createdAt: '', createdBy: 'minsu' },
    ],
  };
  return { ledger, fund: fundBook(ledger), result: computeSettlement(ledger.expenses, members) };
}
