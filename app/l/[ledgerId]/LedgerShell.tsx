import Link from 'next/link';
import LangPicker from '../../Prefs.tsx';
import SignOut from '../../SignOut.tsx';
import Account from '../../Account.tsx';
import { currentUser } from '../../../lib/auth-client.ts';
import { translator } from '../../../lib/i18n.ts';
import type { Locale } from '../../../lib/domain/money.ts';
import Logo from '../../Logo.tsx';

/**
 * 장부 화면의 머리글 (§21.2)
 *
 * 모든 탭이 이 머리글을 함께 쓴다. 팀 이름과 장부 이름, 두 줄 괘선, 그리고 탭 줄.
 * 지출 기입만 오른쪽 끝에 따로 세운다. 다른 탭은 보는 일이고 그것만 쓰는 일이라서다.
 */

export const TABS = [
  ['', 'tabHome'],
  ['/book', 'tabBook'],
  ['/goods', 'tabGoods'],
  ['/settle', 'tabSettle'],
  ['/archive', 'tabArchive'],
  ['/team', 'tabTeam'],
] as const;

export type TabKey = (typeof TABS)[number][0];

export default async function LedgerShell({
  ledgerId,
  teamName,
  bookName,
  who,
  current,
  lang,
  signedIn = false,
}: {
  ledgerId: string;
  teamName: string;
  bookName: string;
  who: string;
  current: TabKey;
  lang: Locale;
  /** 초대 링크로만 들어온 사람에게는 로그아웃할 계정이 없다. */
  signedIn?: boolean;
}) {
  const base = `/l/${ledgerId}`;
  const T = translator(lang);
  // 계정으로 들어온 사람에게는 '지금 누구로 들어와 있는지'를 함께 보여 준다.
  // 통행증(초대 링크)으로만 들어온 사람에게는 계정이 없으니 이 자리도 비운다.
  const me = signedIn ? await currentUser().catch(() => null) : null;

  return (
    <header>
      <div className="topbar">
        <Logo />
        <span className="who">
          {who}
          <LangPicker value={lang} />
          {me && (
            <Account me={me} lang={lang}>
              <SignOut lang={lang} />
            </Account>
          )}
        </span>
      </div>

      <div className="masthead" style={{ marginTop: 22 }}>
        <span className="team">{teamName}</span>
        <span className="book">{bookName}</span>
      </div>
      <div className="rule-double" />

      <nav>
        {TABS.map(([path, key]) => (
          <Link
            key={path}
            href={`${base}${path}`}
            className="tab"
            aria-current={path === current ? 'page' : undefined}
          >
            {T(key)}
          </Link>
        ))}
        <span className="spacer" />
        <Link href={`${base}/add`} className="act small primary">
          {T('addExpense')}
        </Link>
      </nav>
    </header>
  );
}
