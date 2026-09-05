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
  duesGuess,
  currency,
  lang,
  owner,
}: {
  ledgerId: string;
  fundSource: FundSource;
  termCarry: boolean;
  duesPerHead?: number;
  /** 장부가 스스로 알아낸 1인당 회비. 빈칸일 때 이 값이 기준이 된다. */
  duesGuess?: number;
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
  const [dues, setDues] = useState(
    duesPerHead ? formatNumber(duesPerHead, currency, lang) : '',
  );

  const dirty = fund !== fundSource || parseMoney(dues, currency) !== (duesPerHead ?? 0);

  function save() {
    start(async () => {
      const per = parseMoney(dues, currency);
      const r = await setBookKind({
        ledgerId,
        fundSource: fund,
        // 묻지 않게 된 값이다. 이미 적혀 있는 것을 그대로 되돌려 준다 —
        // 설정 한 번이 다른 축의 값을 말없이 바꾸면 안 된다.
        termCarry,
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

      {/*
        회기 이월을 여기서 묻지 않는다 (§12.2)

        예전에는 체크칸이 하나 더 있었다. 그런데 그 칸이 켜고 끄는 것은
        '다음으로 넘길 돈' 한 줄의 표시뿐이었다 — 넘길 돈은 켜든 끄든
        잔고에서 이미 나오는 숫자다. 이 파일이 스스로 적어 둔 규칙에 걸린다:
        **고르는 순간 달라지는 게 없으면 장식이다.**

        그리고 넘길지 말지는 장부를 만드는 날 정할 일이 아니라 회기를 닫는
        날 정할 일이다. 그때는 남은 금액이 손에 있고, 없는 숫자를 두고
        정하는 것보다 있는 숫자를 두고 정하는 편이 언제나 쉽다.
      */}
      {/*
        1인당 회비는 **적어야 하는 칸이 아니다** (§12.2)

        비워 두면 장부가 걷힌 회비에서 알아낸다 — 열여덟이 3만원씩 냈으면
        기준은 3만원이다. 세는 일이지 묻는 일이 아니라서, 장부를 쓰기 전에
        설정을 하나 더 하게 만들 이유가 없다.

        알아낸 값을 빈칸의 흐린 글씨로 미리 비춘다. 그러면 이 칸은 '안 적으면
        안 돌아가는 칸'이 아니라 '틀렸을 때 고치는 칸'이 된다.
      */}
      {fund === 'dues' && (
        <div className="fields" style={{ marginTop: 16 }}>
          <label className="field">
            <span className="lab">{T('duesPerHead')}</span>
            <input
              type="text"
              inputMode="decimal"
              className="num"
              value={dues}
              placeholder={duesGuess ? formatNumber(duesGuess, currency, lang) : ''}
              disabled={!owner || pending}
              onChange={(e) => setDues(e.target.value)}
            />
          </label>
          <p className="aside" style={{ flexBasis: '100%', marginTop: 6 }}>
            {duesGuess ? T('duesFromBook') : T('duesOptional')}
          </p>
        </div>
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
