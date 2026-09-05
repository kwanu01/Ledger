import { translator } from '../lib/i18n.ts';
import type { Locale } from '../lib/domain/money.ts';
import Link from 'next/link';
import Contact from './Contact.tsx';
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
      {/* 무엇이 달라졌는지. 처방침과 문의 사이 — 이 셋이 '서비스에 대해
          알아보는 자리'로 한 덩어리다. */}
      <span className="foot-sep" aria-hidden="true" />
      <Link href="/updates">{T('updates')}</Link>
      {MAIL && (
        <>
          <span className="foot-sep" aria-hidden="true" />
          {/* 링크가 아니라 단추다. 메일 앱이 없는 폰에서 mailto: 는
              눌러도 아무 일이 없다 — 주소를 화면에 띄우는 편이 확실하다. */}
          <Contact mail={MAIL} lang={lang} />
        </>
      )}
    </footer>
  );
}
