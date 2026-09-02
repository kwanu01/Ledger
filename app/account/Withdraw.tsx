'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { withdraw } from '../actions/account.ts';
import { translator } from '../../lib/i18n.ts';
import { useHelper } from '../helper/HelperContext.tsx';
import type { Locale } from '../../lib/domain/money.ts';
import type { OwnedBook } from '../../lib/db/account.ts';

/**
 * 탈퇴 (§21.15)
 *
 * 되돌릴 수 없는 일이므로 두 번 눌러야 한다. 다만 단추는 **제자리에, 같은
 * 글씨로** 남고 무게만 바뀐다 — 글씨가 바뀌면 방금 누른 것이 어디 갔는지
 * 한 번 찾게 되고, 문장이 끼어들면 아래가 밀린다. 무엇이 사라지는지는
 * 수증이가 이 단추 옆으로 걸어와서 말한다(§21.10).
 *
 * 막히는 경우가 오류가 아니라는 점이 중요하다. 팀원이 있는 장부의 소유자면
 * 탈퇴가 안 되는데, 그건 잘못한 것이 아니라 **먼저 할 일이 있다**는 뜻이다.
 * 그래서 빨간 오류로 띄우지 않고, 어느 장부인지 이름을 적고 그 장부의 팀
 * 화면으로 가는 길을 함께 둔다.
 */
export default function Withdraw({ lang, blockedAtFirst }: { lang: Locale; blockedAtFirst: OwnedBook[] }) {
  const T = translator(lang);
  const router = useRouter();
  const { say } = useHelper();
  const [pending, start] = useTransition();
  const [armed, setArmed] = useState(false);
  const [blocked, setBlocked] = useState<OwnedBook[]>(blockedAtFirst);
  const btn = useRef<HTMLButtonElement>(null);
  const bell = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (bell.current) clearTimeout(bell.current); }, []);

  function press() {
    if (!armed) {
      setArmed(true);
      say(T('withdrawWarn'), 'warn', btn.current);
      if (bell.current) clearTimeout(bell.current);
      // 수증이의 말이 지나가면 겨눈 상태도 같이 풀린다.
      bell.current = setTimeout(() => setArmed(false), 5000);
      return;
    }
    if (bell.current) clearTimeout(bell.current);
    setArmed(false);

    start(async () => {
      const r = await withdraw();
      if (!r.ok) return say(r.message);

      if (!r.value.done) {
        setBlocked(r.value.blocked);
        return say(T('withdrawBlocked'));
      }

      say(T('withdrawDone'), 'info');
      router.replace('/');
    });
  }

  return (
    <>
      {blocked.length > 0 && (
        <div className="blocked">
          <p className="empty-how">{T('withdrawBlocked')}</p>
          <ul className="blocked-list">
            {blocked.map((b) => (
              <li key={b.teamId}>
                <span>{b.teamName}</span>
                <span className="faint">{T('accountShared', { n: b.others })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="row" style={{ marginTop: 22 }}>
        <button
          ref={btn}
          className={`plain${armed ? ' arm' : ''}`}
          disabled={pending || blocked.length > 0}
          onClick={press}
        >
          {T('withdraw')}
        </button>
        <Link href="/teams" className="plain">
          {T('backHome')}
        </Link>
      </div>
    </>
  );
}
