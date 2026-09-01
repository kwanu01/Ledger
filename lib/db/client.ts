import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * 서버 전용 Supabase 클라이언트.
 *
 * 브라우저는 DB에 직접 붙지 않는다. RLS가 anon/authenticated에 아무 정책도 주지 않기
 * 때문에, 모든 읽기·쓰기는 이 service_role 클라이언트를 거친 서버 액션에서만 일어난다.
 * 권한 판단은 access.ts 한 곳에서 한다.
 *
 * SUPABASE_SERVICE_ROLE_KEY는 절대 NEXT_PUBLIC_ 접두사를 붙이지 않는다.
 * 'server-only' import가 클라이언트 번들에 섞이는 순간 빌드를 깨뜨린다.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다. .env.example을 참고하세요.',
  );
}

export const db = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
