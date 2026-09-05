import { getLang } from '../../../../lib/lang.ts';
import LedgerShell from '../LedgerShell.tsx';
import TeamPanel from './TeamPanel.tsx';
import BookKind from './BookKind.tsx';
import { requireLedgerAccess } from '../../../../lib/access.ts';
import { loadLedger } from '../../../../lib/db/repo.ts';
import { amOwner, liveInvites, teamMembers } from '../../../actions/teams.ts';
import { siteOrigin } from '../../../../lib/origin.ts';

export default async function Team({ params }: { params: Promise<{ ledgerId: string }> }) {
  const { ledgerId } = await params;
  const pass = await requireLedgerAccess(ledgerId);
  const lang = await getLang();
  const [ledger, members, invites, owner] = await Promise.all([
    loadLedger(ledgerId),
    teamMembers(ledgerId),
    liveInvites(ledgerId),
    amOwner(ledgerId),
  ]);

  // 초대 링크에 붙일 주소. 적어 둔 주소가 있으면 그것, 없으면 지금 열려 있는 주소.
  const origin = await siteOrigin();

  return (
    <>
      <LedgerShell
        ledgerId={ledgerId}
        teamName={ledger.teamName}
        bookName={ledger.name}
        who={pass.memberName}
        current="/team"
        lang={lang}
        signedIn={Boolean(pass.userId)}
        fund={ledger.fundSource ?? 'each'}
      />

      <main>
        <TeamPanel
          ledgerId={ledgerId}
          teamName={ledger.teamName}
          members={members}
          invites={invites}
          origin={origin}
          lang={lang}
          owner={owner}
          fund={ledger.fundSource ?? 'each'}
        />

        {/* 장부 자체의 사실이라 팀 이름을 바꾸는 자리 옆에 둔다 (§12). */}
        <BookKind
          ledgerId={ledgerId}
          fundSource={ledger.fundSource ?? 'each'}
          termCarry={ledger.termCarry ?? false}
          duesPerHead={ledger.duesPerHead}
          currency={ledger.currency ?? 'KRW'}
          lang={lang}
          owner={owner}
        />
      </main>
    </>
  );
}
