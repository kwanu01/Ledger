import { translator } from '../lib/i18n.ts';
import type { Locale } from '../lib/domain/money.ts';
import Link from 'next/link';
import { MADE_ON } from './Logo.tsx';

/**
 * 연락처 (§20)
 *
 * 화면 맨 아래 한 줄. 어디로 물어보면 되는지, 그것뿐이다.
 *
 * 이 서비스는 팀원들 사이에 돈이 오가는 자리라서, 뭔가 이상할 때 물어볼 데가
 * 있어야 한다. 물어볼 데가 없는 정산 서비스는 믿기 어렵다. 그렇다고 만든
 * 사람 이름까지 적을 일은 아니다. 이름은 이 장부와 아무 상관이 없다.
 *
 * 메일 주소는 환경변수로 둔다. 개인 주소라서 코드에 박아 두지 않는다.
 * 없으면 이 줄 자체가 빠진다.
 */

const MAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

export default function Footer({ lang }: { lang: Locale }) {
  const T = translator(lang);

  return (
    <footer>
      <span>Ledger {MADE_ON.replace(/ · .*/, '')}</span>
      {/* 무엇을 어디로 보내는지 적어 둔 곳. 광고를 붙이려면 있어야 하고,
          광고가 없어도 남의 돈 이야기를 맡아 두는 이상 있어야 한다. */}
      <span className="foot-sep" aria-hidden="true" />
      <Link href="/privacy">{T('privacy')}</Link>
      {MAIL && (
        <>
          <span className="foot-sep" aria-hidden="true" />
          <a href={`mailto:${MAIL}`}>{T('contact')}</a>
        </>
      )}
    </footer>
  );
}
