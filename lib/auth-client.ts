import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/**
 * 로그인한 사용자의 세션을 다루는 클라이언트.
 *
 * db/client.ts 의 service_role 클라이언트와 역할이 다르다.
 *   auth-client  누가 로그인했는지 판정한다. anon 키를 쓴다.
 *   db/client    실제 읽기·쓰기를 한다. service_role 키를 쓴다.
 *
 * 권한 판정은 access.ts 한 곳에서만 하고, 판정이 끝난 뒤에야 db/client 로 간다.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function authClient() {
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_ANON_KEY가 필요합니다. .env.example을 참고하세요.',
    );
  }
  const jar = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) jar.set(name, value, options);
        } catch {
          // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 세션 갱신은 미들웨어가 맡는다.
        }
      },
    },
  });
}

/** 어떻게 들어왔는지. 계정 화면에 그대로 적힌다. */
export type Provider = 'google' | 'kakao' | 'email' | 'other';

export type AuthUser = {
  id: string;
  /** 카카오는 비즈앱 전환 전에는 이메일을 주지 않는다. 없을 수 있다. */
  email?: string;
  displayName: string;
  /** 이 계정을 만든 수단. 여러 개면 이번에 쓴 것. */
  provider: Provider;
  /** 계정을 만든 날 (ISO) */
  createdAt?: string;
  /** 이번 로그인 시각 (ISO) */
  lastSignInAt?: string;
};

/**
 * 로그인한 사용자. 없으면 null.
 * 한 요청 안에서 여러 번 불러도 Supabase에는 한 번만 물어본다.
 */
export const currentUser = cache(_currentUser);

async function _currentUser(): Promise<AuthUser | null> {
  const supabase = await authClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const meta = data.user.user_metadata ?? {};

  // 로그인 수단. Supabase는 app_metadata.provider 에 이번에 쓴 것을 적어 준다.
  // 이메일 링크로 들어오면 'email'이다.
  const raw = String((data.user.app_metadata as { provider?: string } | undefined)?.provider ?? 'email');
  const provider: Provider =
    raw === 'google' ? 'google' : raw === 'kakao' ? 'kakao' : raw === 'email' ? 'email' : 'other';

  return {
    id: data.user.id,
    email: data.user.email ?? undefined,
    provider,
    createdAt: data.user.created_at ?? undefined,
    lastSignInAt: data.user.last_sign_in_at ?? undefined,
    // 가입할 때 적은 이름이 먼저다. 카카오는 nickname을 준다.
    // 둘 다 없으면 이메일 앞부분을 쓴다.
    displayName:
      meta.display_name ??
      meta.name ??
      meta.nickname ??
      meta.full_name ??
      data.user.email?.split('@')[0] ??
      '이름 없음',
  };
}
