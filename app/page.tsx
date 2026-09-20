import { currentUser } from '../lib/auth-client.ts';
import { getLang } from '../lib/lang.ts';
import Logo from './Logo.tsx';
import Link from 'next/link';

/**
 * 첫 화면 (§21.1)
 *
 * 처음 온 사람이 해야 할 일은 하나다. 로그인해서 자기 장부를 여는 것.
 * 빠른 계산기를 첫 화면에 두면 서비스의 중심이 일회성 더치페이처럼 보이고,
 * 실제 장부를 찾는 사람은 어디서 시작해야 할지 다시 읽어야 했다.
 */
export default async function Landing() {
  // 로그인 전에도 첫 화면은 떠야 한다. 환경변수가 비어 있어도 여기서 멈추지 않는다.
  const lang = await getLang();
  let signedIn = false;
  try {
    signedIn = Boolean(await currentUser());
  } catch {
    signedIn = false;
  }

  return (
    <main className="landing">
      {/*
        첫 화면에서는 로고가 "처음으로 되돌리기"다. Link로는 이미 / 에 있어서
        계산 중이던 상태가 그대로 남는다. 그래서 여기서만 진짜로 다시 연다.
      */}
      <Logo plain />
      <div className="landing-intro">
        <h1>{lang === 'en' ? 'One ledger for the whole team.' : '함께 쓴 돈을 한 장부에.'}</h1>
        <p>{lang === 'en' ? 'Record expenses, check the split, and keep each settlement.' : '기록하고, 나누고, 정산한 내역까지 남기세요.'}</p>
      </div>
      <div className="landing-actions">
        <Link className="landing-primary" href={signedIn ? '/teams' : '/login?next=%2Fteams'}>
          {lang === 'en' ? (signedIn ? 'Open my ledgers' : 'Sign in') : (signedIn ? '내 장부 열기' : '로그인')}
        </Link>
        <Link className="landing-secondary" href="/teamledger">
          {lang === 'en' ? 'See how it works' : 'teamLedger 알아보기'}
        </Link>
      </div>
      <p className="landing-note">{lang === 'en' ? 'The same ledgers on web and iPhone.' : '웹과 iPhone에서 같은 장부를 이어서 씁니다.'}</p>
    </main>
  );
}
