import { getLang } from '../../../../lib/lang.ts';
import LedgerShell from '../LedgerShell.tsx';
import BookTable from './BookTable.tsx';
import { requireLedgerAccess } from '../../../../lib/access.ts';
import { loadLedger } from '../../../../lib/db/repo.ts';

export default async function Book({ params }: { params: Promise<{ ledgerId: string }> }) {
  const { ledgerId } = await params;
  const pass = await requireLedgerAccess(ledgerId);
  const lang = await getLang();
  const ledger = await loadLedger(ledgerId);

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
      />

      <main>
        <BookTable ledger={ledger} lang={lang} />
      </main>
    </>
  );
}
