import { getLang } from '../../../../lib/lang.ts';
import LedgerShell from '../LedgerShell.tsx';
import BookTable from './BookTable.tsx';
import WatchBand from './WatchBand.tsx';
import { watch } from '../../../../lib/domain/watch.ts';
import { requireLedgerAccess } from '../../../../lib/access.ts';
import { loadLedger, openTransfers } from '../../../../lib/db/repo.ts';

export default async function Book({ params }: { params: Promise<{ ledgerId: string }> }) {
  const { ledgerId } = await params;
  const pass = await requireLedgerAccess(ledgerId);
  const lang = await getLang();
  /*
   * 아직 확인되지 않은 송금도 함께 읽는다.
   *
   * 도장은 "숫자를 확정했다"가 아니라 **"돈이 다 오갔다"**는 표시다. 정산
   * 화면은 처음부터 그렇게 하고 있었는데, 장부 화면은 정산에 들어갔다는
   * 것만 보고 도장을 찍고 있었다. 같은 장부의 두 화면이 다른 말을 하면
   * 어느 쪽이 사실인지 알 수 없다.
   */
  const [ledger, open] = await Promise.all([loadLedger(ledgerId), openTransfers(ledgerId)]);
  const openSeqs = [...new Set(open.map((t) => t.seq))];

  return (
    <>
      <LedgerShell
        ledgerId={ledgerId}
        teamName={ledger.teamName}
        bookName={ledger.name}
        who={pass.memberName}
        current="/book"
        lang={lang}
        signedIn={Boolean(pass.userId)}
        fund={ledger.fundSource ?? 'each'}
      />

      <main>
        {/*
          확인할 것 (§13)

          검사는 순수 함수라 서버에서 그냥 부른다 — 질의도, 모델 호출도
          없다. 물음이 없으면 WatchBand 가 아무것도 그리지 않는다.
        */}
        <WatchBand ledger={ledger} flags={watch(ledger, ledger.members)} lang={lang} />
        <BookTable ledger={ledger} lang={lang} openSeqs={openSeqs} />
      </main>
    </>
  );
}
