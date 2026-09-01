'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSampleLedger } from '../actions/teams.ts';
import { translator } from '../../lib/i18n.ts';
import { formatMoney, type CurrencyCode, type Locale } from '../../lib/domain/money.ts';
import { useHelper } from '../helper/HelperContext.tsx';

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
 * 처음 온 사람에게는 빈 목록만 보이므로, 눌러 볼 수 있는 샘플을 함께 둔다.
 */
export default function TeamsList({ rows, lang }: { rows: LedgerRow[]; lang: Locale }) {
  const router = useRouter();
  // 경고는 도우미 말풍선 한 자리로 모인다(app/helper).
  const { say } = useHelper();
  const T = translator(lang);
  const [busy, setBusy] = useState(false);

  async function sample() {
        setBusy(true);
    const r = await createSampleLedger();
    setBusy(false);
    if (!r.ok) return say(r.message);
    router.push(`/l/${r.value.ledgerId}`);
    router.refresh();
  }

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

        {/* 지어낸 데이터라는 것이 이름에 드러난다. 눌러 보고 지우면 된다. */}
        <button className="choice" onClick={sample} disabled={busy}>
          {busy ? T('making') : T('sampleBook')}
          <span className="sub">{T('sampleSub')}</span>
        </button>
      </div>
    </>
  );
}
