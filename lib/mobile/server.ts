import 'server-only';
import { currentUser, type AuthUser } from '../auth-client.ts';
import { AccessError, isTeamOwner, requireLedgerAccess } from '../access.ts';
import { MobileError, mobileHandler } from './http.ts';
import { uuid } from './validation.ts';

export const configuredOrigins = () => [process.env.NEXT_PUBLIC_SITE_URL ?? '', ...(process.env.MOBILE_ALLOWED_ORIGINS ?? '').split(',')]
  .map((origin) => origin.trim()).filter(Boolean);

export function handleMobile(request: Request, run: (user: AuthUser) => Promise<unknown>, isPublic = false): Promise<Response> {
  return mobileHandler({ origins: configuredOrigins(), authenticate: async () => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY)
      throw new MobileError(503, 'NOT_CONFIGURED', '서버 연결을 준비하고 있습니다.');
    return currentUser();
  }, public: isPublic, run })(request);
}

export async function mobileAccess(id: string) {
  const ledgerId = uuid(id);
  try {
    const pass = await requireLedgerAccess(ledgerId);
    return { ledgerId, pass, isOwner: await isTeamOwner(pass) };
  } catch (error) {
    if (error instanceof AccessError) throw new MobileError(403, 'ACCESS_DENIED', '이 장부에 접근할 수 없습니다.');
    throw error;
  }
}

export function publicConfiguration() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const unavailable = () => { throw new MobileError(503, 'NOT_CONFIGURED', '서버 연결을 준비하고 있습니다.'); };
  if (!url || !anonKey) return unavailable();
  try {
    const parsed = new URL(url);
    const localDevelopment = process.env.NODE_ENV !== 'production' && parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if ((parsed.protocol !== 'https:' && !localDevelopment) || parsed.username || parsed.password || parsed.search || parsed.hash) return unavailable();
    // Fail closed if a private key was accidentally put in the public environment variable.
    if (!anonKey.startsWith('sb_publishable_')) {
      const payload = JSON.parse(Buffer.from(anonKey.split('.')[1] ?? '', 'base64url').toString());
      if (payload.role !== 'anon') return unavailable();
    }
  } catch { return unavailable(); }
  return { ok: true, version: 1, auth: { url, anonKey } };
}
