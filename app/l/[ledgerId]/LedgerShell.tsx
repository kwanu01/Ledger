import Link from 'next/link';
import LangPicker from '../../Prefs.tsx';
import SignOut from '../../SignOut.tsx';
import Account from '../../Account.tsx';
import { currentUser } from '../../../lib/auth-client.ts';
import { translator } from '../../../lib/i18n.ts';
import type { Locale } from '../../../lib/domain/money.ts';
import Logo from '../../Logo.tsx';
import BookSwitch from './BookSwitch.tsx';
import { amOwner, teamLedgers } from '../../actions/teams.ts';

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
  // 이 팀이 가진 장부들과, 내가 소유자인지. 장부 전환 자리가 쓴다.
  const [books, owner] = await Promise.all([
    teamLedgers(ledgerId).catch(() => []),
    amOwner(ledgerId).catch(() => false),
  ]);

  return (
    <header>
      <div className="topbar">
        <Logo />
        {/*
          오른쪽 위의 차례. **계정이 먼저, 언어가 그 다음이다.**

          이 자리에서 계정 이름은 '지금 누구로 들어와 있는가'라는 사실이고,
          언어는 그저 고르는 값이다. 사실이 먼저 오고 설정이 뒤에 온다.
          누르는 횟수로 봐도 그렇다 — 언어는 한 번 고르면 그만이고, 계정은
          로그아웃하러 다시 찾는 자리다. 자주 찾는 것을 끝에 두면 매번
          눈으로 훑어야 한다.
        */}
        <span className="who">
          {/* 팀에서의 내 이름. 좁은 화면에서는 계정 이름과 겹쳐 보여서 접는다. */}
          <span className="who-name">{who}</span>
          {me && (
            <Account me={me} lang={lang}>
              <SignOut lang={lang} />
            </Account>
          )}
          <LangPicker value={lang} />
        </span>
      </div>

      {/* 팀 이름과 장부 이름. 한 팀이 장부를 여럿 가지므로, 장부 이름은
          '지금 어디를 보고 있는가'이면서 동시에 바꾸는 손잡이다. */}
      <div className="masthead" style={{ marginTop: 22 }}>
        <span className="team">{teamName}</span>
        <BookSwitch
          ledgerId={ledgerId}
          bookName={bookName}
          books={books}
          owner={owner}
          lang={lang}
        />
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
