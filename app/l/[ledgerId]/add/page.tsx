import { getLang } from '../../../../lib/lang.ts';
import LedgerShell from '../LedgerShell.tsx';
import ExpenseForm from './ExpenseForm.tsx';
import { requireLedgerAccess } from '../../../../lib/access.ts';
import { loadLedger } from '../../../../lib/db/repo.ts';
import { currentRoster, groupsOf } from '../../../../lib/domain/settlement.ts';
import { categoriesOf, recallSeed, vendorsOf } from '../../../../lib/domain/recall.ts';

/**
 * 영수증 읽기가 이 화면에서 일어난다.
 *
 * 기본 실행 시간 제한(10초)은 모델이 사진을 읽고 대답하기에 빠듯하다. 제한에
 * 먼저 걸리면 대답도 오류도 없이 끊기고 화면에는 '읽는 중'만 남는다. 여유를
 * 두어, 우리가 정한 시각(lib/ai/receipt.ts)에 우리가 먼저 끊고 사람 말로
 * 알려 줄 수 있게 한다.
 */
export const maxDuration = 30;

/** 지출 기입 화면. 폼 자체는 손이 많이 가서 클라이언트 컴포넌트로 뺐다. */
export default async function AddExpense({ params }: { params: Promise<{ ledgerId: string }> }) {
  const { ledgerId } = await params;
  const pass = await requireLedgerAccess(ledgerId);
  const lang = await getLang();
  const ledger = await loadLedger(ledgerId);

  // 오늘 날짜는 서버에서 만들어 넘긴다. 브라우저 시간대에 따라 하루가 밀리지 않도록.
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <LedgerShell
        ledgerId={ledgerId}
        teamName={ledger.teamName}
        bookName={ledger.name}
        who={pass.memberName}
        current=""
        lang={lang}
        signedIn={Boolean(pass.userId)}
      />

      <main>
        <ExpenseForm
          ledgerId={ledgerId}
          members={ledger.members}
          roster={currentRoster(ledger)}
          groups={groupsOf(ledger)}
          categories={categoriesOf(ledger)}
          vendors={vendorsOf(ledger)}
          past={recallSeed(ledger)}
          currency={ledger.currency ?? 'KRW'}
          meId={pass.memberId}
          today={today}
          lang={lang}
        />
      </main>
    </>
  );
}
