'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { LANGS } from '../lib/i18n.ts';
import { LANG_COOKIE } from '../lib/lang-cookie.ts';
import type { Locale } from '../lib/domain/money.ts';

/**
 * 언어 고르기 (§21.1)
 *
 * 쿠키에 적고 화면을 다시 그리게 한다. 서버가 그 쿠키를 보고 처음부터
 * 그 언어로 그려 주므로, 탭을 옮겨도 언어가 풀리지 않는다.
 *
 * 화폐는 여기서 고르지 않는다. 장부의 통화는 장부를 만들 때 정하고
 * 그 뒤로는 그 장부의 사실이 된다.
 */
export default function LangPicker({ value }: { value: Locale }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function set(lang: Locale) {
    // 넉넉하게 1년. 이 값이 없어도 한국어로 동작하므로 잃어도 문제는 없다.
    document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    start(() => router.refresh());
  }

  return (
    <span className="prefs">
      <select
        aria-label="Language"
        value={value}
        disabled={pending}
        onChange={(e) => set(e.target.value as Locale)}
      >
        {LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </span>
  );
}
