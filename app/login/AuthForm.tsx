'use client';

import { useState } from 'react';
import LangPicker from '../Prefs.tsx';
import { t } from '../../lib/i18n.ts';
import type { Locale } from '../../lib/domain/money.ts';
import { sendEmailLink } from '../actions/auth.ts';
import { useHelper } from '../helper/HelperContext.tsx';

/**
 * 로그인 (§21.8)
 *
 * 가입과 로그인을 나누지 않는다. 처음 온 사람이든 다시 온 사람이든 같은 버튼을 누르고,
 * 계정이 없으면 그때 만들어진다. 외울 것은 없다.
 *
 * 순서는 **잘 되는 것이 위**다.
 *
 * 처음에는 이메일이 위에 있었다. 아무 계정도 요구하지 않는 길이니 그게 맞다고
 * 보았는데, 실제로는 그 길이 가장 잘 끊긴다. 메일은 스팸함으로 가고, 링크는
 * 만료되고, 메일 앱이 자기 창에서 열면 또 한 번 걸린다. 구글은 눌러서 돌아오면
 * 끝이고 중간에 아무것도 없다.
 *
 * 화면에서 가장 크고 진한 것은 그 사람이 성공할 확률이 가장 높은 길이어야 한다.
 * 그래서 구글을 위로, 이메일을 아래로 내렸다. 이메일을 없애지는 않는다 —
 * 구글도 카카오도 쓰지 않는 사람이 있고, 그 사람에게는 이 길뿐이다.
 */

export default function AuthForm({
  google,
  kakao,
  kakaoReady,
  locale,
  next,
  title,
}: {
  google: () => Promise<void>;
  kakao: () => Promise<void>;
  kakaoReady: boolean;
  locale: Locale;
  /** 로그인이 끝나면 돌아갈 자리. 초대 링크를 눌렀다가 온 사람이 그 링크로 돌아간다. */
  next?: string;
  /** 제목을 바꿔야 할 때가 있다. 초대 화면에서는 팀 이름이 제목이다. */
  title?: string;
}) {
  const T = (k: Parameters<typeof t>[1]) => t(locale, k);
  const { say } = useHelper();

  const [busy, setBusy] = useState(false);

  async function submit(formData: FormData) {
    setBusy(true);
    const r = await sendEmailLink(formData);
    setBusy(false);
    // 실패도 성공도 도우미가 말한다. 로그인 화면에도 도우미는 서 있다.
    if (!r.ok) say(r.message);
    else if (r.message) say(r.message, 'info');
  }

  return (
    <div className="auth">
      <h1 className="auth-title">{title ?? T('signIn')}</h1>

      {/* 가장 잘 되는 길이 가장 크다. */}
      <form action={google}>
        <button className="act primary" type="submit" style={{ width: '100%' }}>
          {T('withGoogle')}
        </button>
      </form>

      {/* 카카오는 비즈앱 전환이 끝나야 동작한다. 그전에는 버튼을 두지 않는다. */}
      {kakaoReady && (
        <form action={kakao} style={{ marginTop: 10 }}>
          <button className="act primary" type="submit" style={{ width: '100%' }}>
            {T('withKakao')}
          </button>
        </form>
      )}

      <div className="auth-or">
        <span>{T('or')}</span>
      </div>

      {/* 구글도 카카오도 쓰지 않는 사람의 길. 없애지는 않는다. */}
      <form action={submit}>
        {next && <input type="hidden" name="next" value={next} />}
        <label className="field">
          <span className="lab">{T('email')}</span>
          <input type="email" name="email" required autoComplete="email" />
        </label>
        <button className="act" type="submit" disabled={busy} style={{ marginTop: 14, width: '100%' }}>
          {busy ? T('working') : T('withEmail')}
        </button>
      </form>

      <div className="gate-foot" style={{ marginTop: 34 }}>
        <LangPicker value={locale} />
      </div>
    </div>
  );
}
