import { redirect } from 'next/navigation';
import TeamsList, { type LedgerRow } from './TeamsList.tsx';
import { currentUser } from '../../lib/auth-client.ts';
import { claimMembership, ensureProfile, myLedgers } from '../actions/teams.ts';
import { db } from '../../lib/db/client.ts';
import { getLang } from '../../lib/lang.ts';
import LangPicker from '../Prefs.tsx';
import SignOut from '../SignOut.tsx';
import Account from '../Account.tsx';
import Logo from '../Logo.tsx';

/**
 * 내 장부 목록 (팀 고르기)
 *
 * 한 계정이 팀을 여럿 가진다. 수업이 둘이면 팀도 둘이다.
 *
 * 줄 오른쪽에는 그 장부의 총액이 아니라 **내 몫**을 적는다. 팀 전체의 미정산
 * 합계는 내가 무엇을 해야 하는지 알려 주지 않는다. 알고 싶은 것은 언제나
 * "여기서 내가 보낼 돈이 있나"다.
 */
export default async function Teams() {
  if (!(await currentUser())) redirect('/login');
  await ensureProfile();
  // 통행증으로만 들어와 있던 장부가 있으면 이 계정에 붙인다.
  await claimMembership();

  const lang = await getLang();
  const user = await currentUser();
  const ledgers = await myLedgers();

  // 팀마다 내가 누구인지
  const { data: mine } = await db
    .from('members')
    .select('id, team_id')
    .eq('user_id', user!.id);
  const meIn = new Map((mine ?? []).map((m) => [m.team_id as string, m.id as string]));

  const rows: LedgerRow[] = await Promise.all(
    ledgers.map(async (l) => {
      const meId = meIn.get(l.teamId);

      // 확정된 정산에서 아직 오가지 않은 송금 중 내가 걸린 것
      const { data } = await db.rpc('open_transfers', { p_ledger_id: l.ledgerId });
      const open = (data ?? []) as { amount: number; from_member_id: string; to_member_id: string }[];
      const net = open.reduce((a, t) => {
        if (t.from_member_id === meId) return a - Number(t.amount);
        if (t.to_member_id === meId) return a + Number(t.amount);
        return a;
      }, 0);

      /*
       * 건수만 알면 되므로 장부 전체를 읽지 않는다. 목록 화면이 장부 수만큼
       * 느려지면 안 된다. 개수는 데이터베이스가 세게 한다.
       *
       * 미정산 건수는 뺄셈으로 세지 않는다. '전체 − 정산에 든 것'으로 세면
       * **'정산 불필요'가 미정산으로 잡힌다** — 자기가 사서 자기가 가져간
       * 줄은 정산에 들어가지 않지만, 아직 안 한 것이 아니라 할 것이 없는
       * 것이다. 장부 화면은 그 구분을 하는데 목록만 몰라서, 열어 보면
       * 아무것도 없는 장부에 '미정산 1건'이 떠 있었다.
       *
       * 판정 조건은 한 곳에만 있어야 한다(0017_open_expense_count.sql).
       */
      const [{ count: total }, { data: openCount }] = await Promise.all([
        db.from('expenses').select('id', { count: 'exact', head: true }).eq('ledger_id', l.ledgerId),
        db.rpc('open_expense_count', { p_ledger_id: l.ledgerId }),
      ]);

      return {
        ledgerId: l.ledgerId,
        teamName: l.teamName,
        ledgerName: l.ledgerName,
        mine: l.mine,
        currency: l.currency,
        net,
        openCount: Math.max(0, Number(openCount ?? 0)),
        hasAny: (total ?? 0) > 0,
      };
    }),
  );

  return (
    <>
      <header>
        <div className="topbar">
          <Logo />
          <span className="who">
            <Account me={user!} lang={lang}>
              <SignOut lang={lang} />
            </Account>
            <LangPicker value={lang} />
          </span>
        </div>
      </header>

      <main className="gate">
        <TeamsList rows={rows} lang={lang} />
      </main>
    </>
  );
}
