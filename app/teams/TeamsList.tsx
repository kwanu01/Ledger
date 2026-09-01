'use client';

import Link from 'next/link';
import { translator } from '../../lib/i18n.ts';
import { formatMoney, type CurrencyCode, type Locale } from '../../lib/domain/money.ts';

export type LedgerRow = {
  ledgerId: string;
  teamName: string;
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
 * 한 계정이 팀을 여럿 가진다. 수업이 둘이면 팀도 둘이다.
 */
export default function TeamsList({ rows, lang }: { rows: LedgerRow[]; lang: Locale }) {
  const T = translator(lang);

  return (
    <>

      <div className="choices">
        {rows.map((l) => (
          <Link key={l.ledgerId} href={`/l/${l.ledgerId}`} className="choice">
            {l.teamName}
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
        ))}

        <Link href="/teams/new" className="choice">
          {T('newBookPlus')}
        </Link>
      </div>
    </>
  );
}
