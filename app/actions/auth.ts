'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authClient } from '../../lib/auth-client.ts';
import { clearPass } from '../../lib/access.ts';

/**
 * 로그인 (§5.2, §21.8)
 *
 * 비밀번호를 두지 않는다. 프로젝트 하나 하자고 새 비밀번호를 하나 더 외우게 하는 것은
 * 이 서비스가 요구할 만한 일이 아니고, 잊었을 때의 재설정 흐름까지 떠안게 된다.
 *
 * 그래서 두 갈래만 둔다.
 *   구글  — 구글 화면으로 넘어갔다가 돌아오면 로그인되어 있다. 아무것도 외우지 않는다.
 *   이메일 — 메일로 온 링크를 누르면 들어온다. 구글 계정을 쓰지 않는 사람을 위한 길.
 *
 * 카카오는 Supabase가 account_email 을 반드시 요구하고 그 동의항목은 비즈앱에서만
 * 켤 수 있어서, 전환이 끝난 뒤 NEXT_PUBLIC_KAKAO_LOGIN=1 로 켠다.
 */

type Provider = 'google' | 'kakao';

async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export type AuthResult = { ok: true; message?: string } | { ok: false; message: string };

/**
 * 로그인이 끝난 뒤 돌아갈 자리.
 *
 * 초대 링크를 눌렀다가 로그인으로 보내진 사람은 로그인을 마치면 그 링크로
 * 돌아와야 한다. 주소를 구글까지 들려 보내는 대신 잠깐 쿠키에 적어 둔다.
 * 밖에서 준 주소를 그대로 믿지 않도록, 이 사이트 안의 경로만 받는다.
 */
const NEXT_COOKIE = 'ledger_next';

export async function rememberNext(next: string | undefined): Promise<void> {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return;
  const jar = await cookies();
  jar.set(NEXT_COOKIE, next, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 900, // 15분. 로그인 한 번에 쓰고 버린다.
  });
}

/** Supabase가 영어로 돌려주는 말을 그대로 보여 주지 않는다. */
function readable(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('rate limit') || m.includes('too many') || m.includes('security purposes')) {
    return '잠시 뒤에 다시 시도해 주세요.';
  }
  if (m.includes('not authorized') || m.includes('error sending')) {
    return '메일을 보내지 못했습니다. 구글로 계속하기를 써 주세요.';
  }
  if (m.includes('signups not allowed') || m.includes('disabled')) {
    return '지금은 이 방법으로 들어올 수 없습니다.';
  }
  return message;
}

/** 이메일로 로그인 링크 보내기. 가입과 로그인이 같은 동작이다. */
export async function sendEmailLink(formData: FormData): Promise<AuthResult> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email || !email.includes('@')) return { ok: false, message: '이메일 주소를 확인해 주세요.' };

  await rememberNext(String(formData.get('next') ?? '') || undefined);

  const supabase = await authClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/callback` },
  });

  if (error) return { ok: false, message: readable(error.message) };
  return { ok: true, message: `${email} 으로 링크를 보냈습니다. 메일함에서 눌러 주세요.` };
}

/** 구글·카카오로 로그인. 그쪽 화면으로 넘겼다가 /auth/callback 으로 돌아온다. */
export async function signInWith(provider: Provider, next?: string): Promise<void> {
  await rememberNext(next);
  const supabase = await authClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${await siteOrigin()}/auth/callback`,
      // 다시 고를 수 있게 계정 선택 화면을 띄운다. 공용 컴퓨터에서 남의 계정으로
      // 그냥 들어가 버리는 일을 막는다.
      queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
    },
  });

  if (error || !data.url) {
    redirect(`/login?error=${encodeURIComponent(error?.message ?? provider)}`);
  }
  redirect(data.url);
}

export async function signOut(): Promise<void> {
  const supabase = await authClient();
  await supabase.auth.signOut();
  // 계정만 나가고 통행증이 남으면, 로그아웃한 사람이 계속 그 팀원으로 보인다.
  await clearPass();
  redirect('/');
}
