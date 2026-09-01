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

      // 건수만 알면 되므로 장부 전체를 읽지 않는다. 목록 화면이 장부 수만큼
      // 느려지면 안 된다. 개수는 데이터베이스가 세게 한다.
      const [{ count: total }, { count: settled }] = await Promise.all([
        db.from('expenses').select('id', { count: 'exact', head: true }).eq('ledger_id', l.ledgerId),
        db
          .from('expenses')
          .select('id, settlement_expenses!inner(expense_id)', { count: 'exact', head: true })
          .eq('ledger_id', l.ledgerId),
      ]);

      return {
        ledgerId: l.ledgerId,
        teamName: l.teamName,
        currency: l.currency,
        net,
        openCount: Math.max(0, (total ?? 0) - (settled ?? 0)),
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
            <LangPicker value={lang} />
            <Account me={user!} lang={lang}>
              <SignOut lang={lang} />
            </Account>
          </span>
        </div>
      </header>

      <main className="gate">
        <TeamsList rows={rows} lang={lang} />
      </main>
    </>
  );
}
