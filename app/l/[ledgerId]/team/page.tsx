import { headers } from 'next/headers';
import { getLang } from '../../../../lib/lang.ts';
import LedgerShell from '../LedgerShell.tsx';
import TeamPanel from './TeamPanel.tsx';
import { requireLedgerAccess } from '../../../../lib/access.ts';
import { loadLedger } from '../../../../lib/db/repo.ts';
import { amOwner, liveInvites, teamMembers } from '../../../actions/teams.ts';

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

  // 초대 링크에 붙일 주소. 배포한 도메인에서든 로컬에서든 지금 열려 있는 주소를 쓴다.
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');

  return (
    <main>
      <LedgerShell
        ledgerId={ledgerId}
        teamName={ledger.teamName}
        bookName={ledger.name}
        who={pass.memberName}
        current="/team"
        lang={lang}
        signedIn={Boolean(pass.userId)}
      />
      <TeamPanel
        ledgerId={ledgerId}
        teamName={ledger.teamName}
        members={members}
        invites={invites}
        origin={`${proto}://${host}`}
        lang={lang}
        owner={owner}
      />
    </main>
  );
}
