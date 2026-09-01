'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { THEME_COOKIE, type Theme } from '../lib/theme-key.ts';

/**
 * 해와 달 (§20)
 *
 * 오른쪽 위 구석에 작게 하나. 누르면 밝은 화면과 어두운 화면이 바뀐다.
 *
 * 지금 무엇인지가 아니라 **누르면 무엇이 되는지**를 그린다. 어두운 화면을 보고
 * 있으면 해가, 밝은 화면을 보고 있으면 달이 뜬다. 단추에 그려진 것이 지금 상태를
 * 말하면, 누르기 전에 한 번 더 생각해야 한다.
 *
 * 처음 들어온 사람은 아무것도 고르지 않은 상태다. 그때는 기기 설정을 따르고,
 * 이 단추는 그 기기가 지금 무엇인지 물어본 다음 반대쪽을 보여 준다.
 *
 * 눌린 결과를 두 군데에 적는다.
 *   1. 화면에 바로 — 기다림 없이 색이 바뀐다.
 *   2. 쿠키에 — 다음에 들어와도 그대로다. 서버가 처음부터 그 색으로 그린다.
 */
export default function ThemeToggle({ value }: { value: Theme | null }) {
  const router = useRouter();
  const [dark, setDark] = useState<boolean | null>(
    value === 'dark' ? true : value === 'light' ? false : null,
  );

  // 아무것도 고르지 않았으면 기기 설정을 읽는다. 서버는 그것을 알 수 없어서
  // 여기서 한 번 물어본다.
  useEffect(() => {
    if (dark !== null) return;
    setDark(window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  }, [dark]);

  function flip() {
    const next: Theme = dark ? 'light' : 'dark';
    setDark(next === 'dark');
    document.documentElement.dataset.theme = next;
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    // 서버가 그린 조각들(도장 색 같은 것)도 같이 맞춘다.
    router.refresh();
  }

  // 기기 설정을 아직 못 읽은 첫 순간에는 자리만 잡아 둔다. 아무 그림이나
  // 먼저 띄우면 곧바로 반대 그림으로 바뀌어 깜빡인 것처럼 보인다.
  const show = dark === null ? null : dark ? 'sun' : 'moon';

  return (
    <button
      type="button"
      className="theme"
      onClick={flip}
      aria-label={dark ? '밝은 화면으로' : '어두운 화면으로'}
      title={dark ? '밝은 화면으로' : '어두운 화면으로'}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
           stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        {show === 'sun' && (
          <>
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
          </>
        )}
        {show === 'moon' && (
          <path d="M20 13.6A8.2 8.2 0 0 1 10.4 4a8.2 8.2 0 1 0 9.6 9.6z" />
        )}
      </svg>
    </button>
  );
}
