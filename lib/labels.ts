import { nameOf } from './domain/settlement.ts';
import { t } from './i18n.ts';
import type { Locale } from './domain/money.ts';
import type { Expense, FundSource, Member } from './domain/types.ts';

/**
 * 사람들을 뭐라고 부르는가 (§12)
 *
 * 팀플에서는 '팀원'이지만 동아리에서는 '회원'이다. 학회도 반 모임도
 * 그렇다. 같은 화면에 팀플의 말이 박혀 있으면 그 장부는 남의 옷을 입은
 * 것처럼 읽힌다.
 *
 * **한국어에서만 갈린다.** 영어의 member 도, 일본어의 メンバー도, 다른
 * 말들도 두 경우를 다 덮는다. 안 갈리는 말을 억지로 갈라 두면 번역이
 * 여섯 벌에서 열두 벌이 되고, 그중 절반은 다음 판에서 어긋난다.
 */
export function memberWord(locale: Locale, fund: FundSource | undefined): string {
  if (locale !== 'ko') return t(locale, 'memberWord');
  return (fund ?? 'each') === 'each' ? '팀원' : '회원';
}

/** '팀원 3명' 처럼 수와 함께 쓸 때. */
export function membersCount(locale: Locale, fund: FundSource | undefined, n: number): string {
  if (locale !== 'ko') return t(locale, 'membersN', { n });
  return `${memberWord(locale, fund)} ${n}명`;
}

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
    case 'items':
      return t(locale, 'allocItems', { n: a.lines.length });
    case 'common':
      return t(locale, 'allocCommon');
  }
}

export function adjustmentLabel(expense: Expense, locale: Locale): string {
  if (!expense.adjustment) return '';
  return t(locale, expense.adjustment.kind === 'refund' ? 'refund' : 'correction');
}
