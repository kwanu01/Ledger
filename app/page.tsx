import QuickSplit from './QuickSplit.tsx';
import { currentUser } from '../lib/auth-client.ts';
import { myLedgers } from './actions/teams.ts';
import { getLang } from '../lib/lang.ts';
import Logo from './Logo.tsx';
import PersonalBooks from './PersonalBooks.tsx';

/**
 * 첫 화면 (§21.1)
 *
 * 개인 장부와 팀 장부를 같은 첫 화면에서 시작한다.
 */
export default async function Landing() {
  // 로그인 전에도 첫 화면은 떠야 한다. 환경변수가 비어 있어도 여기서 멈추지 않는다.
  const lang = await getLang();
  let signedIn = false;
  let ledgerCount = 0;
  try {
    signedIn = Boolean(await currentUser());
    if (signedIn) ledgerCount = (await myLedgers()).length;
  } catch {
    signedIn = false;
  }

  return (
    <main className="landing landing-personal">
      {/*
        첫 화면에서는 로고가 "처음으로 되돌리기"다. Link로는 이미 / 에 있어서
        계산 중이던 상태가 그대로 남는다. 그래서 여기서만 진짜로 다시 연다.
      */}
      <Logo plain />

      <PersonalBooks locale={lang} />
      <QuickSplit signedIn={signedIn} ledgerCount={ledgerCount} locale={lang} />
    </main>
  );
}
