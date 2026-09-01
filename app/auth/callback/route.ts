import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { authClient } from '../../../lib/auth-client.ts';

/**
 * 로그인 돌아오는 자리.
 *
 * 이메일 매직링크와 카카오 OAuth 둘 다 여기로 돌아온다.
 * code를 세션으로 바꾸는 것 말고는 아무것도 하지 않는다.
 * 프로필 생성은 /teams 에서 처음 들어올 때 한다.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  // 로그인 전에 적어 둔 자리로 돌아간다. 초대 링크를 눌렀다가 여기까지 온 사람은
  // 그 링크로 돌아가야 이름을 적고 팀에 들어갈 수 있다.
  const jar = await cookies();
  const saved = jar.get('ledger_next')?.value;
  const next =
    saved && saved.startsWith('/') && !saved.startsWith('//')
      ? saved
      : (searchParams.get('next') ?? '/teams');
  jar.delete('ledger_next');

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await authClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=exchange_failed`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
