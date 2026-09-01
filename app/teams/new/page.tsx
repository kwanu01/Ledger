import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '../../../lib/auth-client.ts';
import { CURRENCIES, type CurrencyCode } from '../../../lib/domain/money.ts';
import { createTeamAndLedger } from '../../actions/teams.ts';
import { getLang } from '../../../lib/lang.ts';
import { translator } from '../../../lib/i18n.ts';
import LangPicker from '../../Prefs.tsx';
import SignOut from '../../SignOut.tsx';
import Account from '../../Account.tsx';
import { Say } from '../../helper/HelperContext.tsx';
import Logo from '../../Logo.tsx';

/**
 * 새 장부 만들기
 *
 * 통화는 여기서만 정한다. 만든 뒤에는 바꿀 수 없다. 이미 원화로 적힌 금액이
 * 다른 통화로 다시 읽히면 아무도 낸 적 없는 숫자가 되기 때문이다.
 */
export default async function NewLedger({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const q = await searchParams;
  const lang = await getLang();
  const T = translator(lang);

  async function create(formData: FormData) {
    'use server';
    const r = await createTeamAndLedger({
      teamName: String(formData.get('teamName') ?? ''),
      ledgerName: String(formData.get('ledgerName') ?? ''),
      currency: String(formData.get('currency') ?? 'KRW') as CurrencyCode,
      myName: String(formData.get('myName') ?? ''),
    });

    if (!r.ok) redirect(`/teams/new?error=${encodeURIComponent(r.message)}`);
    redirect(`/l/${r.value.ledgerId}`);
  }

  return (
    <>
      <header>
        <div className="topbar">
          <Logo />
          <span className="who">
            <LangPicker value={lang} />
            {user && (
              <Account me={user} lang={lang}>
                <SignOut lang={lang} />
              </Account>
            )}
          </span>
        </div>
      </header>

      <main className="gate">
        <Say text={q.error} />

        <form action={create} style={{ marginTop: q.error ? 26 : 0 }}>
          <div className="fields">
            <label className="field">
              <span className="lab">{T('teamName')}</span>
              <input type="text" name="teamName" required />
            </label>
            <label className="field">
              <span className="lab">{T('bookName')}</span>
              <input type="text" name="ledgerName" required />
            </label>
            <label className="field">
              <span className="lab">{T('currency')}</span>
              <select name="currency" defaultValue="KRW">
                {(Object.keys(CURRENCIES) as CurrencyCode[]).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="lab">{T('myName')}</span>
              <input type="text" name="myName" defaultValue={user.displayName} required />
            </label>
          </div>

          {/* 통화는 만든 뒤 바꿀 수 없다는 것만 알린다. 설명이 아니라 상태다. */}
          <p className="aside" style={{ marginTop: 18, maxWidth: 460 }}>
            {T('currencyLocked')}
            <br />
            {T('membersJoinByLink')}
          </p>

          <div className="row" style={{ marginTop: 24 }}>
            <button className="act primary" type="submit">
              {T('create')}
            </button>
            <Link href="/teams">{T('back')}</Link>
          </div>
        </form>
      </main>
    </>
  );
}
