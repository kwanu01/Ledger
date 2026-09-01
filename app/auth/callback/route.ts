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

  /**
   * 돌아갈 자리는 반드시 이 사이트 안이어야 한다.
   *
   * `//evil.com` 은 프로토콜 상대 주소라 바깥으로 나가고, `@evil.com` 은
   * 앞부분이 사용자 정보로 읽혀 `teamledger.net@evil.com` 의 진짜 호스트가
   * evil.com 이 된다. `\evil.com` 도 브라우저에 따라 같은 일이 일어난다.
   * 로그인 직후에 남의 사이트로 튕기면, 그 화면을 우리 것으로 믿게 된다.
   *
   * 그래서 슬래시 하나로 시작하고, 그다음 글자가 슬래시도 역슬래시도
   * 아닌 것만 통과시킨다. 쿠키든 쿼리든 같은 잣대로 본다.
   */
  const inside = (v: string | null | undefined) => (v && /^\/[^/\\]/.test(v) ? v : null);
  const next = inside(saved) ?? inside(searchParams.get('next')) ?? '/teams';
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
