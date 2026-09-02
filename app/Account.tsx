'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { translator } from '../lib/i18n.ts';
import type { Locale } from '../lib/domain/money.ts';
import type { Provider } from '../lib/auth-client.ts';

/**
 * 내 계정 (§21.8)
 *
 * 오른쪽 위에 '로그아웃'만 있으면, 지금 누구로 들어와 있는지 알 수 없다.
 * 구글로 들어왔는지 이메일 링크로 들어왔는지도 모른다. 계정이 둘이면
 * (학교 메일과 개인 메일처럼) 엉뚱한 계정에 장부를 만들고도 모른다.
 *
 * 그래서 이름을 먼저 적고, 누르면 이 계정의 사실을 펼친다. 판단하지 않고
 * 적기만 한다 — 이름, 이메일, 어떻게 들어왔는지, 언제 만들었는지, 계정 번호.
 * 로그아웃도 이 안에 둔다. 나가는 문은 내가 누구인지 확인한 다음에 있어야 한다.
 */

export type Me = {
  id: string;
  displayName: string;
  email?: string;
  provider: Provider;
  createdAt?: string;
  lastSignInAt?: string;
};

export default function Account({
  me,
  lang,
  children,
}: {
  me: Me;
  lang: Locale;
  /** 로그아웃 폼. 서버에서 만들어 이 안에 넣는다. */
  children: ReactNode;
}) {
  const T = translator(lang);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const how =
    me.provider === 'google'
      ? T('viaGoogle')
      : me.provider === 'kakao'
        ? T('viaKakao')
        : me.provider === 'email'
          ? T('viaEmail')
          : T('viaOther');

  // 날짜는 그 사람의 언어로. 시각까지는 필요 없고, 언제부터인지가 궁금한 것이다.
  const day = (iso?: string) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(lang === 'ko' ? 'ko-KR' : lang, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return (
    <div className="acct-me" ref={box}>
      <button
        className="acct-name"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={T('accountTitle')}
      >
        {me.displayName}
      </button>

      {open && (
        <div className="acct-card">
          <div className="acct-head">{T('accountTitle')}</div>
          <table className="facts">
            <tbody>
              <tr>
                <td className="k">{T('accountName')}</td>
                <td>{me.displayName}</td>
              </tr>
              <tr>
                <td className="k">{T('accountEmail')}</td>
                <td className={me.email ? '' : 'faint'}>{me.email ?? T('accountNoEmail')}</td>
              </tr>
              <tr>
                <td className="k">{T('accountHow')}</td>
                <td>{how}</td>
              </tr>
              {day(me.createdAt) && (
                <tr>
                  <td className="k">{T('accountSince')}</td>
                  <td>{day(me.createdAt)}</td>
                </tr>
              )}
              {day(me.lastSignInAt) && (
                <tr>
                  <td className="k">{T('accountLast')}</td>
                  <td>{day(me.lastSignInAt)}</td>
                </tr>
              )}
              <tr>
                <td className="k">{T('accountId')}</td>
                {/* 계정 번호는 문의할 때만 쓴다. 작게, 그러나 숨기지는 않는다. */}
                <td className="num acct-uuid">{me.id}</td>
              </tr>
            </tbody>
          </table>
          {/*
            자세한 것은 따로 본다.

            이 카드에는 '지금 누구인가'만 둔다. 이 계정에 장부가 몇 개
            매달려 있는지, 나가면 무엇이 남는지는 좁은 카드에서 답할 수
            있는 분량이 아니고, 탈퇴는 지나가듯 눌릴 자리에 두면 안 된다.
          */}
          <div className="acct-out">
            <a className="plain" href="/account">
              {T('myInfo')}
            </a>
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
