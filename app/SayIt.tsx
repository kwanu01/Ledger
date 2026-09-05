'use client';

import { useState } from 'react';
import { askToPay } from './actions/receipt.ts';
import ShareButton from './ShareButton.tsx';
import { translator } from '../lib/i18n.ts';
import { useHelper } from './helper/HelperContext.tsx';
import type { Locale } from '../lib/domain/money.ts';
import type { SayWhy } from '../lib/ai/say.ts';

/**
 * 말 대신 써 주기 (§15.2)
 *
 * 받을 돈 얘기를 꺼내는 문장을 장부가 대신 쓴다. 정산 화면의 안 보낸 사람
 * 옆과, 결산 화면의 회비 미납자 옆에 같은 모양으로 선다.
 *
 * ── 접혀 있다
 *
 * 단추 하나만 보인다. 독촉은 늘 하는 일이 아니라 **가끔, 마음먹고** 하는
 * 일이라서, 화면에 늘 펴져 있으면 그 자체가 재촉이 된다.
 *
 * ── 만든 문장은 고칠 수 있어야 한다
 *
 * 그래서 <pre> 가 아니라 글자 칸에 넣는다. 이 말은 **사람이 자기 이름으로
 * 보내는 말**이지 장부가 보내는 말이 아니다. 한 글자도 못 고치게 해 두면,
 * 어색한 문장을 그대로 보내거나 아예 안 보내거나 둘 중 하나가 된다.
 *
 * ── 말투는 두 가지뿐이다
 *
 * 정중하게와 편하게. 셋을 넘어가면 고르는 일이 쓰는 일보다 커진다.
 * 고른 값은 남기지 않는다 — 같은 팀 안에서도 상대에 따라 달라지는 것이라,
 * 지난번 값을 기억해 두면 그게 더 자주 틀린다.
 */
export default function SayIt({
  ledgerId,
  toMemberId,
  toName,
  why,
  lang,
}: {
  ledgerId: string;
  toMemberId: string;
  toName: string;
  why: SayWhy;
  lang: Locale;
}) {
  const T = translator(lang);
  const { say } = useHelper();
  const [busy, setBusy] = useState(false);
  const [warm, setWarm] = useState(false);
  const [text, setText] = useState<string | null>(null);

  async function write(tone: boolean) {
    setBusy(true);
    say('');
    const r = await askToPay({ ledgerId, toMemberId, why, warm: tone, lang });
    setBusy(false);
    if (!r.ok) return say(r.message);
    setText(r.text);
  }

  if (text === null) {
    return (
      <button className="plain" disabled={busy} onClick={() => write(warm)}>
        {busy ? T('sayWriting') : T('sayIt')}
      </button>
    );
  }

  return (
    <div className="sayit">
      <div className="caption">{T('sayFor', { who: toName })}</div>

      {/* 말투. 누르면 그 자리에서 다시 쓴다 — 고르고 나서 또 눌러야 하면
          두 번 일이다. */}
      <div className="chips" style={{ marginTop: 8 }}>
        {[false, true].map((t) => (
          <button key={String(t)} type="button"
            className={`chip${warm === t ? ' on' : ''}`}
            disabled={busy}
            onClick={() => { setWarm(t); write(t); }}>
            {T(t ? 'sayWarm' : 'sayPolite')}
          </button>
        ))}
      </div>

      <textarea className="msg-edit" rows={4} value={text}
        onChange={(e) => setText(e.target.value)} />

      <div className="row" style={{ marginTop: 12 }}>
        <ShareButton text={text} lang={lang} withLink={false} />
        <button className="plain" disabled={busy} onClick={() => write(warm)}>
          {busy ? T('sayWriting') : T('sayAgain')}
        </button>
        <button className="plain" onClick={() => setText(null)}>{T('close')}</button>
      </div>
    </div>
  );
}
