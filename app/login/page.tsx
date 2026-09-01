import { redirect } from 'next/navigation';
import AuthForm from './AuthForm.tsx';
import { currentUser } from '../../lib/auth-client.ts';
import { signInWith } from '../actions/auth.ts';
import { getLang } from '../../lib/lang.ts';
import { translator, type Key } from '../../lib/i18n.ts';
import { Say } from '../helper/HelperContext.tsx';
import Logo from '../Logo.tsx';

/**
 * 로그인 (§5.2)
 *
 * 장부를 만드는 사람도, 초대 링크를 받은 팀원도 여기를 한 번 지난다.
 * 링크는 문을 열어 줄 뿐이고, 누가 들어왔는지는 계정이 기억한다.
 *
 * next 는 로그인을 마치면 돌아갈 자리다. 초대 링크에서 온 사람은 그 링크로
 * 돌아가 이름을 적는다. 밖에서 준 주소를 그대로 믿지 않도록 이 사이트 안의
 * 경로만 받는다.
 */
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; why?: string; next?: string }>;
}) {
  const q = await searchParams;
  const next = q.next && q.next.startsWith('/') && !q.next.startsWith('//') ? q.next : undefined;

  if (await currentUser()) redirect(next ?? '/teams');
  const lang = await getLang();
  const T = translator(lang);

  /**
   * 로그인 링크가 안 통했을 때.
   *
   * 돌아오는 자리(app/auth/callback)는 짧은 말만 붙여 보낸다. 화면에 적는 문장은
   * 여기서 고른다 — 사람이 읽는 말은 언어를 따라가야 하고, 주소창에 문장이
   * 그대로 실려 있으면 그 문장을 밖에서 바꿔 넣을 수 있다.
   */
  const WHY: Record<string, Key> = {
    expired: 'linkExpired',
    otherBrowser: 'linkOtherBrowser',
    failed: 'linkFailed',
  };
  const why = q.why && WHY[q.why] ? T(WHY[q.why]) : undefined;

  async function google() {
    'use server';
    await signInWith('google', next);
  }

  async function kakao() {
    'use server';
    await signInWith('kakao', next);
  }

  return (
    <main className="landing">
      <Logo plain />

      <Say text={why ?? q.error} />
      {/*
        카카오는 Supabase가 account_email 을 반드시 요구하고, 그 동의항목은
        비즈앱으로 전환해야 켤 수 있다. 준비가 끝나면 NEXT_PUBLIC_KAKAO_LOGIN=1 로 켠다.
      */}
      <AuthForm
        google={google}
        kakao={kakao}
        kakaoReady={process.env.NEXT_PUBLIC_KAKAO_LOGIN === '1'}
        locale={lang}
        next={next}
      />
    </main>
  );
}
