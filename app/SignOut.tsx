import { signOut } from './actions/auth.ts';
import { translator } from '../lib/i18n.ts';
import type { Locale } from '../lib/domain/money.ts';

/**
 * 로그아웃.
 *
 * 어느 화면에서든 오른쪽 위 같은 자리에 있어야 한다. 찾으러 다니게 하지 않는다.
 */
export default function SignOut({ lang }: { lang: Locale }) {
  async function out() {
    'use server';
    await signOut();
  }

  return (
    <form action={out}>
      <button className="plain" type="submit">
        {translator(lang)('signOut')}
      </button>
    </form>
  );
}
