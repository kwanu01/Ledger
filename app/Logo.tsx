import Link from 'next/link';
import Stamp from './Stamp.tsx';

/**
 * 로고 (§20)
 *
 * 필기체 글자만 놓으면 장부가 아니라 상표처럼 읽힌다. 그래서 도장을 하나 둔다.
 * 다만 **찍혀 있지 않다.** 마우스를 올려야 그때 내려와 찍힌다.
 *
 * 도장은 원래 누가 찍어야 찍히는 것이다. 처음부터 찍혀 있으면 그건 도장이
 * 아니라 인쇄다. 이 서비스가 정산을 끝낼 때 도장을 찍는 것처럼, 로고도
 * 손이 닿았을 때 찍힌다.
 *
 * 찍히는 말은 이 장부가 끝났다는 말이다. 정산 완료 도장과 같은 낱말을 쓴다.
 */

/** 로고에 찍히는 말. 화면 안의 완료 도장과 같은 낱말이다. */
export const STAMP_WORD = 'Completed';

/** 이 장부 프로그램이 만들어진 해. 화면 맨 아래 줄에 적힌다. */
export const MADE_ON = '2026 · 09 · 01';

export default function Logo({ plain = false }: { plain?: boolean }) {
  // 첫 화면에서는 같은 주소로의 Link가 화면을 다시 그리지 않는다. 계산기를
  // 처음 상태로 되돌리려면 진짜로 다시 들어가야 해서 <a>를 쓴다.
  const inner = (
    <>
      <span className="logo-word">Ledger</span>
      <span className="logo-stamp" aria-hidden="true">
        <Stamp />
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
