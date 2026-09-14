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
const makeClient = (url: string, key: string) => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
type Client = ReturnType<typeof makeClient>;
let client: Client | undefined;
function configuredClient(): Client {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('서버 연결을 준비하고 있습니다.');
  client = makeClient(url, serviceKey);
  return client;
}

// Keep the existing db.from/rpc API while allowing builds and /config without private env values.
// This client carries only the server credential; it never receives a user's session.
export const db: Client = new Proxy({} as Client, {
  get(_target, property) {
    const current = configuredClient();
    const value = Reflect.get(current, property, current);
    return typeof value === 'function' ? value.bind(current) : value;
  },
});
