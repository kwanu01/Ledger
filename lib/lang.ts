import { cookies } from 'next/headers';
import { LANGS } from './i18n.ts';
import { LANG_COOKIE } from './lang-cookie.ts';
import type { Locale } from './domain/money.ts';

/**
 * 화면 언어를 어디에 두는가 (§21.1)
 *
 * 브라우저 저장소가 아니라 쿠키에 둔다. 이 앱의 화면은 대부분 서버에서 그려지는데,
 * 서버는 브라우저 저장소를 볼 수 없다. 저장소에 두면 첫 화면만 영어로 바뀌고
 * 장부로 넘어가는 순간 한국어로 돌아가 버린다.
 *
 * 쿠키는 요청과 함께 서버로 오므로, 어느 화면이든 처음 그려질 때부터 옳은 언어로 나온다.
 */

export async function getLang(): Promise<Locale> {
  const jar = await cookies();
  const v = jar.get(LANG_COOKIE)?.value as Locale | undefined;
  return v && LANGS.some((l) => l.code === v) ? v : 'ko';
}
