import { getLang } from '../../../../lib/lang.ts';
import LedgerShell from '../LedgerShell.tsx';
import ExpenseForm from './ExpenseForm.tsx';
import { requireLedgerAccess } from '../../../../lib/access.ts';
import { loadLedger } from '../../../../lib/db/repo.ts';
import { currentRoster } from '../../../../lib/domain/settlement.ts';

/** 지출 기입 화면. 폼 자체는 손이 많이 가서 클라이언트 컴포넌트로 뺐다. */
export default async function AddExpense({ params }: { params: Promise<{ ledgerId: string }> }) {
  const { ledgerId } = await params;
  const pass = await requireLedgerAccess(ledgerId);
  const lang = await getLang();
  const ledger = await loadLedger(ledgerId);

  // 오늘 날짜는 서버에서 만들어 넘긴다. 브라우저 시간대에 따라 하루가 밀리지 않도록.
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main>
      <LedgerShell
        ledgerId={ledgerId}
        teamName={ledger.teamName}
        bookName={ledger.name}
        who={pass.memberName}
        current=""
        lang={lang}
        signedIn={Boolean(pass.userId)}
      />
      <ExpenseForm
        ledgerId={ledgerId}
        members={ledger.members}
        roster={currentRoster(ledger)}
        currency={ledger.currency ?? 'KRW'}
        meId={pass.memberId}
        today={today}
        lang={lang}
      />
    </main>
  );
}
