import 'server-only';
import { cookies } from 'next/headers';
import { THEME_COOKIE, type Theme } from './theme-key.ts';

/**
 * 밝은 화면 · 어두운 화면 (§20)
 *
 * 셋이다. 밝게, 어둡게, 그리고 **아무것도 고르지 않음**.
 * 고르지 않으면 기기 설정을 따른다. 그게 기본값이고, 대부분은 그대로 둔다.
 *
 * 고른 값은 언어와 같은 방식으로 쿠키에 적는다. 서버가 그 값을 보고 처음부터
 * 그 색으로 그려 주기 때문에, 화면이 한 번 희게 번쩍였다가 어두워지는 일이 없다.
 * 브라우저에만 적어 두면 그림이 다 그려진 뒤에야 색이 바뀌어서 그 번쩍임이 생긴다.
 */

export async function getTheme(): Promise<Theme | null> {
  const v = (await cookies()).get(THEME_COOKIE)?.value;
  return v === 'light' || v === 'dark' ? v : null;
}
