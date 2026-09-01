import { nameOf } from './domain/settlement.ts';
import { t } from './i18n.ts';
import type { Locale } from './domain/money.ts';
import type { Expense, Member } from './domain/types.ts';

/**
 * 화면에 붙는 이름표.
 *
 * 도메인(lib/domain)은 어느 나라 말로 보여 줄지 몰라야 한다. 정산 계산이
 * 화면의 언어에 묶이면 엔진을 따로 검증할 수 없게 된다. 그래서 말이 붙는 일은
 * 여기서만 한다.
 */

export function allocationLabel(expense: Expense, members: Member[], locale: Locale): string {
  const a = expense.allocation;
  switch (a.type) {
    case 'all':
      return t(locale, 'allocAll', { n: expense.teamMemberIds.length });
    case 'partial':
      return t(locale, 'allocPartial', { n: a.participantIds.length });
    case 'personal':
      // 결제한 사람이 곧 가져가는 사람이면 이름을 두 번 적지 않는다.
      // 화면에는 결제자가 바로 옆에 있어서 '서민영 · 서민영 개인'이 된다.
      return a.ownerId === expense.payerId
        ? t(locale, 'allocSelf')
        : t(locale, 'allocPersonal', { who: nameOf(members, a.ownerId) });
  }
}

export function adjustmentLabel(expense: Expense, locale: Locale): string {
  if (!expense.adjustment) return '';
  return t(locale, expense.adjustment.kind === 'refund' ? 'refund' : 'correction');
}
