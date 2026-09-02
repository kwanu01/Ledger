'use client';

import Link from 'next/link';
import { translator } from '../../lib/i18n.ts';
import { formatMoney, type CurrencyCode, type Locale } from '../../lib/domain/money.ts';

export type LedgerRow = {
  ledgerId: string;
  teamName: string;
  ledgerName: string;
  /** 이 팀의 소유자가 나인가. */
  mine: boolean;
  currency: CurrencyCode;
  /** 이 장부에서 내가 받을 돈(+)이나 보낼 돈(−). 아직 오가지 않은 송금만 센다. */
  net: number;
  /** 아직 정산하지 않은 지출 건수 */
  openCount: number;
  hasAny: boolean;
};

/**
 * 장부 고르기 (§5.2)
 *
 * 한 계정이 팀을 여럿 가지고, **한 팀이 장부를 여럿 가진다.** 수업이 둘이면
 * 팀도 둘이고, 한 수업 안에서 과제가 셋이면 장부도 셋이다.
 *
 * 그래서 줄마다 팀 이름만 적으면 같은 이름이 여러 번 나온다. 팀 이름을 작게
 * 위에 얹고 **장부 이름을 크게** 적는다 — 여기서 고르는 것은 팀이 아니라
 * 장부이기 때문이다.
 *
 * 소유자인 장부에는 표를 달아 둔다. 초대 링크를 만들고 장부를 지울 수 있는
 * 자리인지 아닌지는, 들어가기 전에 알수록 좋다.
 */
export default function TeamsList({ rows, lang }: { rows: LedgerRow[]; lang: Locale }) {
  const T = translator(lang);
  const owned = rows.filter((r) => r.mine);
  const joined = rows.filter((r) => !r.mine);

  const one = (l: LedgerRow) => (
    <Link key={l.ledgerId} href={`/l/${l.ledgerId}`} className="choice">
      <span className="choice-team">{l.teamName}</span>
      {l.ledgerName}
      {/* 내가 할 일이 있으면 그것을, 없으면 상태를 적는다. */}
      <span className={`sub${l.net < 0 ? ' debit' : ''}`}>
        {l.net !== 0
          ? `${l.net > 0 ? T('toReceive') : T('toPay')} ${formatMoney(Math.abs(l.net), l.currency, lang)}`
          : l.openCount > 0
            ? T('openN', { n: l.openCount })
            : l.hasAny
              ? T('allSettled')
              : l.currency}
      </span>
    </Link>
  );

  return (
    <>
      {/* 내가 만든 것과 초대받아 들어간 것을 나눠 둔다. 할 수 있는 일이
          다르고, 대개 찾는 것도 둘 중 한쪽이다. */}
      {owned.length > 0 && (
        <>
          <div className="caption choice-head">{T('myBooks')}</div>
          <div className="choices">{owned.map(one)}</div>
        </>
      )}

      {joined.length > 0 && (
        <>
          <div className="caption choice-head">{T('joinedBooks')}</div>
          <div className="choices">{joined.map(one)}</div>
        </>
      )}

      <div className="choices">
        <Link href="/teams/new" className="choice">
          {T('newBookPlus')}
        </Link>
      </div>
    </>
  );
}
