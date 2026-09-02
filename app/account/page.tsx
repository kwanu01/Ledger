import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLang } from '../../lib/lang.ts';
import { currentUser } from '../../lib/auth-client.ts';
import { accountFacts } from '../../lib/db/account.ts';
import { translator } from '../../lib/i18n.ts';
import SignOut from '../SignOut.tsx';
import Withdraw from './Withdraw.tsx';

/**
 * 내 정보 (§21.15)
 *
 * 오른쪽 위 계정 카드는 지금 누구로 들어와 있는지만 말한다. 그 자리에서
 * 답할 수 없는 질문이 둘 있다.
 *
 *   · 이 계정에 **무엇이 매달려 있나** — 장부 몇 개, 내 이름으로 적힌 지출 몇 건.
 *   · 나가면 **무엇이 남고 무엇이 사라지나.**
 *
 * 둘 다 좁은 카드에 넣을 수 있는 분량이 아니고, 무엇보다 탈퇴는 되돌릴 수
 * 없는 일이라 좁은 자리에서 지나가듯 눌리면 안 된다. 그래서 화면을 따로 둔다.
 *
 * 숫자를 먼저 적고 그다음에 나가는 문을 둔다 — 무엇을 두고 나가는지 본 다음에
 * 결정하는 순서다.
 */
export default async function AccountPage() {
  const lang = await getLang();
  const user = await currentUser();
  if (!user) redirect('/login');

  const T = translator(lang);
  const facts = await accountFacts(user.id);
  const blocked = facts.owned.filter((b) => b.others > 0);

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

  const how =
    user.provider === 'google'
      ? T('viaGoogle')
      : user.provider === 'kakao'
        ? T('viaKakao')
        : user.provider === 'email'
          ? T('viaEmail')
          : T('viaOther');

  return (
    <main>
      <section>
        <div className="caption">{T('myInfo')}</div>

        <table className="facts" style={{ marginTop: 16 }}>
          <tbody>
            <tr>
              <td className="k">{T('accountName')}</td>
              <td>{user.displayName}</td>
            </tr>
            <tr>
              <td className="k">{T('accountEmail')}</td>
              <td className={user.email ? '' : 'faint'}>{user.email ?? T('accountNoEmail')}</td>
            </tr>
            <tr>
              <td className="k">{T('accountHow')}</td>
              <td>{how}</td>
            </tr>
            {day(user.createdAt) && (
              <tr>
                <td className="k">{T('accountSince')}</td>
                <td>{day(user.createdAt)}</td>
              </tr>
            )}
            <tr>
              <td className="k">{T('accountBooks')}</td>
              <td className="num">{facts.teams}</td>
            </tr>
            <tr>
              <td className="k">{T('accountEntries')}</td>
              <td className="num">{facts.entries}</td>
            </tr>
            <tr>
              <td className="k">{T('accountId')}</td>
              <td className="num acct-uuid">{user.id}</td>
            </tr>
          </tbody>
        </table>

        <div className="row" style={{ marginTop: 22 }}>
          <SignOut lang={lang} />
        </div>
      </section>

      {/*
        내가 소유한 장부.

        탈퇴가 되는지 안 되는지가 여기서 갈리므로, 탈퇴 단추보다 **먼저**
        보여야 한다. 눌러 보고 막히는 것보다, 막힐 것을 미리 아는 편이 낫다.
      */}
      {facts.owned.length > 0 && (
        <section>
          <div className="caption">{T('myBooks')}</div>
          <table className="facts" style={{ marginTop: 14 }}>
            <tbody>
              {facts.owned.map((b) => (
                <tr key={b.teamId}>
                  <td className="k">{b.teamName}</td>
                  <td>
                    {b.others === 0 ? (
                      <span className="faint">{T('accountAlone')}</span>
                    ) : b.ledgerId ? (
                      <Link href={`/l/${b.ledgerId}/team`} className="plain">
                        {T('handOverFirst')}
                      </Link>
                    ) : (
                      <span className="faint">{T('accountShared', { n: b.others })}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <div className="caption">{T('withdrawTitle')}</div>

        {/*
          무엇이 남고 무엇이 사라지는지를 나란히 둔다. 한쪽만 적으면
          사람은 나머지를 최악으로 짐작한다 — '내 지출도 다 지워지나?'
        */}
        <div className="two-up" style={{ marginTop: 16 }}>
          <div>
            <div className="two-up-head">{T('accountWhatStays')}</div>
            <p className="aside">{T('accountStays1')}</p>
            <p className="aside">{T('accountStays2')}</p>
          </div>
          <div>
            <div className="two-up-head">{T('accountGoes')}</div>
            <p className="aside">{T('accountGoes1')}</p>
            <p className="aside">{T('accountGoes2')}</p>
          </div>
        </div>

        <Withdraw lang={lang} blockedAtFirst={blocked} />
      </section>
    </main>
  );
}
