import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { authClient } from '../../../lib/auth-client.ts';

/**
 * 로그인 돌아오는 자리.
 *
 * 여기로 두 가지가 돌아온다.
 *
 *   1. **메일로 보낸 링크** — `token_hash` 와 `type` 을 달고 온다.
 *      verifyOtp 로 확인한다. 이 확인은 브라우저에 아무것도 남아 있지 않아도
 *      된다. 그래서 **메일 앱이 자기 창에서 링크를 열어도** 들어와진다.
 *
 *   2. **구글·카카오** — `code` 를 달고 온다.
 *      exchangeCodeForSession 으로 바꾼다. 이쪽은 로그인을 시작한 그 브라우저로
 *      그대로 돌아오므로 PKCE 검증자가 자리에 있다.
 *
 * 처음에는 메일 링크도 2번으로 처리했다. 그게 틀렸다. PKCE 검증자는 메일을
 * **요청한 브라우저의 쿠키**에 들어 있는데, 아이폰의 메일·지메일 앱은 링크를
 * 자기 안의 작은 브라우저에서 연다. 그 창에는 쿠키가 없다. 그래서 코드를
 * 세션으로 바꾸지 못하고 로그인 화면으로 되돌아왔다. 초대받은 사람이 계정을
 * 만들지 못한 것이 전부 이 때문이었다.
 *
 * (1번이 동작하려면 Supabase의 메일 서식이 {{ .TokenHash }} 를 쓰도록 되어
 *  있어야 한다. 서식을 아직 안 고쳤으면 2번으로 오므로, 둘 다 받는다.)
 */

/** 돌아갈 자리는 반드시 이 사이트 안이어야 한다.
 *
 * `//evil.com` 은 프로토콜 상대 주소라 바깥으로 나가고, `@evil.com` 은 앞부분이
 * 사용자 정보로 읽혀 `teamledger.net@evil.com` 의 진짜 호스트가 evil.com 이 된다.
 * `\evil.com` 도 브라우저에 따라 같은 일이 일어난다. 로그인 직후에 남의 사이트로
 * 튕기면, 그 화면을 우리 것으로 믿게 된다.
 *
 * 슬래시 하나로 시작하고, 그다음 글자가 슬래시도 역슬래시도 아닌 것만 통과시킨다.
 */
const inside = (v: string | null | undefined) => (v && /^\/[^/\\]/.test(v) ? v : null);

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);

  const jar = await cookies();

  /**
   * 로그인 전에 적어 둔 자리로 돌아간다. 초대 링크를 눌렀다가 여기까지 온 사람은
   * 그 링크로 돌아가야 이름을 적고 팀에 들어갈 수 있다.
   *
   * 주소(next)를 쿠키에만 적어 두면, 메일 앱의 창처럼 쿠키가 없는 곳에서 열었을 때
   * 그 사람은 팀 목록으로 떨어진다. 목록은 비어 있고, 왜 비어 있는지 알 길이 없다.
   * 그래서 링크에도 같이 실어 보내고, 둘 중 있는 것을 쓴다. 어느 쪽이든 이 사이트
   * 안의 경로인지 같은 잣대로 본다.
   */
  const next = inside(searchParams.get('next')) ?? inside(jar.get('ledger_next')?.value) ?? '/teams';
  jar.delete('ledger_next');

  // 실패해도 가려던 자리는 들고 간다. 다시 로그인하면 그 자리로 이어진다.
  const back = (why: string) =>
    NextResponse.redirect(
      `${origin}/login?why=${why}${next === '/teams' ? '' : `&next=${encodeURIComponent(next)}`}`,
    );

  // Supabase가 먼저 거절한 경우(만료·이미 쓴 링크)는 여기로 이유가 실려 온다.
  const denied = searchParams.get('error_code') ?? searchParams.get('error');
  if (denied) return back(/expired|otp_expired/i.test(denied) ? 'expired' : 'failed');

  const supabase = await authClient();

  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const code = searchParams.get('code');

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return back(/expired|invalid/i.test(error.message) ? 'expired' : 'failed');
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // 이 실패의 대부분은 "메일을 부른 브라우저와 링크를 연 브라우저가 다르다"이다.
    // 만료와 구분해서 알려 줘야 사람이 다음에 무엇을 할지 안다.
    if (error) return back('otherBrowser');
  } else {
    return back('failed');
  }

  return NextResponse.redirect(`${origin}${next}`);
}
