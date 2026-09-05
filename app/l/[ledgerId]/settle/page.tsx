import { getLang } from '../../../../lib/lang.ts';
import LedgerShell from '../LedgerShell.tsx';
import SettlePanel from './SettlePanel.tsx';
import { requireLedgerAccess } from '../../../../lib/access.ts';
import { loadLedger, openTransfers } from '../../../../lib/db/repo.ts';

/** 금액이 적힌 화면이라 광고를 넣지 않는다. AdSlot 주석 참고. */
export default async function Settle({ params }: { params: Promise<{ ledgerId: string }> }) {
  const { ledgerId } = await params;
  const pass = await requireLedgerAccess(ledgerId);
  const lang = await getLang();
  const [ledger, open] = await Promise.all([loadLedger(ledgerId), openTransfers(ledgerId)]);

  // 아직 오가지 않은 송금이 남아 있는 정산 회차. 그 회차에만 보내기 버튼을 둔다.
  const openSeqs = [...new Set(open.map((t) => t.seq))];

  return (
    <>
      <LedgerShell
        ledgerId={ledgerId}
        teamName={ledger.teamName}
        bookName={ledger.name}
        who={pass.memberName}
        current="/settle"
        lang={lang}
        signedIn={Boolean(pass.userId)}
        fund={ledger.fundSource ?? 'each'}
      />

      <main>
        <SettlePanel ledger={ledger} meId={pass.memberId} lang={lang} openSeqs={openSeqs} />
      </main>
    </>
  );
}
