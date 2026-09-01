import Link from 'next/link';

/**
 * 로고 (§20)
 *
 * 필기체 글자 하나만 놓으면 장부가 아니라 상표처럼 읽힌다. 그래서 그 위에
 * 도장을 하나 찍었다. 이 장부 프로그램이 만들어진 날짜다.
 *
 * 종이 장부의 첫 장에는 언제나 날짜가 있었다. 접수한 날, 기표한 날, 결재한 날.
 * 도장은 그중에서도 "이때 이 종이가 여기를 지나갔다"는 표시다. 그 표시를
 * 서비스 자신에게 찍어 둔다. 이 장부가 언제부터의 것인지가 첫 화면에 있다.
 *
 * 날짜는 고정이다. 보는 사람의 오늘이 아니라 만들어진 날이라서, 내일 열어도
 * 같은 날짜가 찍혀 있어야 한다.
 */

/** 이 장부 프로그램이 만들어진 날. 도장에 찍히는 날짜다. */
export const MADE_ON = '2026 · 08 · 31';

export default function Logo({ plain = false }: { plain?: boolean }) {
  // 첫 화면에서는 같은 주소로의 Link가 화면을 다시 그리지 않는다. 계산기를
  // 처음 상태로 되돌리려면 진짜로 다시 들어가야 해서 <a>를 쓴다.
  const inner = (
    <>
      <span className="logo-word">Ledger</span>
      <span className="logo-stamp" aria-hidden="true">
        {MADE_ON}
      </span>
    </>
  );

  return plain ? (
    <a href="/" className="logo" aria-label="Ledger 첫 화면으로">
      {inner}
    </a>
  ) : (
    <Link href="/" className="logo" aria-label="Ledger 첫 화면으로">
      {inner}
    </Link>
  );
}
