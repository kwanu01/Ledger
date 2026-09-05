import { getLang } from '../../../../lib/lang.ts';
import LedgerShell from '../LedgerShell.tsx';
import IncomePanel from './IncomePanel.tsx';
import { requireLedgerAccess } from '../../../../lib/access.ts';
import { loadLedger } from '../../../../lib/db/repo.ts';
import { duesBoard, fundBook, usesFund, collectsDues } from '../../../../lib/domain/closing.ts';
import { redirect } from 'next/navigation';

/**
 * 들어온 돈과 결산 (§12)
 *
 * 공금을 쓰는 장부에만 있는 탭이다. 각자 결제하는 장부에는 모아 둔 주머니가
 * 없으니 셀 잔고도 없다 — 주소를 직접 쳐서 들어와도 장부 첫 화면으로 돌린다.
 * 빈 화면을 보여 주는 것보다 낫다.
 *
 * 계산은 전부 lib/domain/closing.ts 가 한다. 이 파일은 부르고 넘길 뿐이다.
 */
export default async function IncomePage({ params }: { params: Promise<{ ledgerId: string }> }) {
  const { ledgerId } = await params;
  const pass = await requireLedgerAccess(ledgerId);
  const lang = await getLang();
  const ledger = await loadLedger(ledgerId);

  if (!usesFund(ledger)) redirect(`/l/${ledgerId}`);

  return (
    <>
      <LedgerShell
        ledgerId={ledgerId}
        teamName={ledger.teamName}
        bookName={ledger.name}
        who={pass.memberName}
        current="/income"
        lang={lang}
        signedIn={Boolean(pass.userId)}
        fund={ledger.fundSource ?? 'each'}
      />
      <main>
        <IncomePanel
          ledger={ledger}
          members={ledger.members}
          book={fundBook(ledger)}
          dues={collectsDues(ledger) && ledger.duesPerHead ? duesBoard(ledger, ledger.members) : []}
          meId={pass.memberId}
          today={new Date().toISOString().slice(0, 10)}
          lang={lang}
        />
      </main>
    </>
  );
}
