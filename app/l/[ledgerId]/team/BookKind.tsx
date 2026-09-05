'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setBookKind } from '../../../actions/ledger.ts';
import { translator } from '../../../../lib/i18n.ts';
import { formatNumber, parseMoney } from '../../../../lib/domain/money.ts';
import { useHelper } from '../../../helper/HelperContext.tsx';
import type { CurrencyCode, Locale } from '../../../../lib/domain/money.ts';
import type { FundSource } from '../../../../lib/domain/types.ts';

/**
 * 이 장부의 돈은 어디서 오나 (§12)
 *
 * 고르는 순간 화면이 실제로 달라진다 — '들어온 돈' 탭이 서고, 부담 방식에
 * '공금'이 생기고, 회비를 걷는 장부면 미납을 센다. **아무것도 안 달라지는
 * 값은 두지 않는다.** 확장 설계는 축을 넷으로 적어 두었지만, 고르는 순간
 * 달라지는 것이 없는 축은 장식이고 장식은 나중에 진짜 기능을 넣을 때
 * 걸림돌이 된다. 그래서 실제로 작동하는 둘만 여기 있다.
 *
 * 팀 화면에 두는 이유는, 이것이 지출 한 줄이 아니라 **장부 자체의 사실**이기
 * 때문이다. 팀 이름을 바꾸는 자리 옆이 맞다.
 */
export default function BookKind({
  ledgerId,
  fundSource,
  termCarry,
  duesPerHead,
  currency,
  lang,
  owner,
}: {
  ledgerId: string;
  fundSource: FundSource;
  termCarry: boolean;
  duesPerHead?: number;
  currency: CurrencyCode;
  lang: Locale;
  /** 장부의 성격은 만든 사람만 정한다. 화면이 통째로 달라지는 일이라서. */
  owner: boolean;
}) {
  const T = translator(lang);
  const router = useRouter();
  const { say } = useHelper();
  const [pending, start] = useTransition();

  const [fund, setFund] = useState<FundSource>(fundSource);
  const [carry, setCarry] = useState(termCarry);
  const [dues, setDues] = useState(
    duesPerHead ? formatNumber(duesPerHead, currency, lang) : '',
  );

  const dirty =
    fund !== fundSource ||
    carry !== termCarry ||
    parseMoney(dues, currency) !== (duesPerHead ?? 0);

  function save() {
    start(async () => {
      const per = parseMoney(dues, currency);
      const r = await setBookKind({
        ledgerId,
        fundSource: fund,
        termCarry: carry,
        duesPerHead: fund !== 'each' && per > 0 ? per : undefined,
      });
      if (!r.ok) return say(r.message);
      router.refresh();
    });
  }

  const rows: [FundSource, string, string][] = [
    ['each', T('kindEach'), T('kindEachSay')],
    ['dues', T('kindDuesBook'), T('kindDuesSay')],
    ['grant', T('kindGrantBook'), T('kindGrantSay')],
  ];

  return (
    <section style={{ marginTop: 40 }}>
      <div className="caption">{T('bookKind')}</div>

      <fieldset style={{ marginTop: 12 }}>
        {rows.map(([v, name, say2]) => (
          <label className="pick" key={v}>
            <input
              type="radio"
              name="fund"
              checked={fund === v}
              disabled={!owner || pending}
              onChange={() => setFund(v)}
            />
            <span>
              {name}
              <span className="pick-say">{say2}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {/* 회기 이월은 돈의 출처와 다른 축이다. 공금을 쓰는 장부에만 뜻이 있다. */}
      {fund !== 'each' && (
        <>
          <label className="pick" style={{ marginTop: 10 }}>
            <input
              type="checkbox"
              checked={carry}
              disabled={!owner || pending}
              onChange={(e) => setCarry(e.target.checked)}
            />
            <span>
              {T('carryOn')}
              <span className="pick-say">{T('carryOnSay')}</span>
            </span>
          </label>

          {fund === 'dues' && (
            <div className="fields" style={{ marginTop: 16 }}>
              <label className="field">
                <span className="lab">{T('duesPerHead')}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="num"
                  value={dues}
                  disabled={!owner || pending}
                  onChange={(e) => setDues(e.target.value)}
                />
              </label>
            </div>
          )}
        </>
      )}

      {owner && dirty && (
        <div className="row" style={{ marginTop: 18 }}>
          <button className="act small primary" disabled={pending} onClick={save}>
            {pending ? T('working') : T('saveEdit')}
          </button>
        </div>
      )}
    </section>
  );
}
