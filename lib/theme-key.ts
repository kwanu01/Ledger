/**
 * 테마 쿠키의 이름과 값 (§20)
 *
 * 서버와 브라우저 양쪽에서 같은 이름을 써야 한다. 그래서 'server-only'가
 * 붙지 않은 이 파일에 따로 둔다 (lib/lang-cookie.ts 와 같은 이유).
 */
export const THEME_COOKIE = 'ledger_theme';

/** 'light' · 'dark' · 없음(기기 설정을 따름) */
export type Theme = 'light' | 'dark';
