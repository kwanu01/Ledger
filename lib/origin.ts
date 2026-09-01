import 'server-only';
import { headers } from 'next/headers';

/**
 * 이 사이트의 주소 (§21.8)
 *
 * 로그인 링크와 초대 링크에 들어가는 주소다. 메일로 나가는 링크의 주소이므로,
 * 여기서 잘못된 주소가 만들어지면 로그인 링크가 남의 사이트로 향한다.
 *
 * 그래서 순서가 있다.
 *
 *   1. NEXT_PUBLIC_SITE_URL — 우리가 적어 둔 값. 요청과 무관하므로 흔들리지 않는다.
 *   2. 요청에 실려 온 Host — 위 값이 없을 때만. 개발용(localhost)과 미리보기용이다.
 *
 * Host 머리글은 요청을 보내는 쪽이 적는 값이다. 앞에 프록시가 있으면 대개는
 * 바로잡히지만, 그 값을 믿고 메일을 보내는 것과 우리가 적어 둔 값을 쓰는 것은
 * 다른 일이다. 배포 환경에는 반드시 1번을 채워 둔다.
 *
 * (마지막 방어선은 Supabase의 Redirect URL 목록이다. 거기 없는 주소로는
 *  로그인 링크가 나가지 않는다. 이 함수는 그 앞단이다.)
 */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
