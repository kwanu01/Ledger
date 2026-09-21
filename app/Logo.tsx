import Link from 'next/link';
import Stamp from './Stamp.tsx';
import Wordmark from './Wordmark.tsx';

/** 로고에 찍히는 말. 화면 안의 완료 도장과 같은 낱말이다. */
export const STAMP_WORD = 'Completed';

/** 이 장부 프로그램이 만들어진 해. 화면 맨 아래 줄에 적힌다. */
export const MADE_ON = '2026 · 09 · 01';

export default function Logo({ plain = false }: { plain?: boolean }) {
  // 첫 화면에서는 같은 주소로의 Link가 화면을 다시 그리지 않는다. 계산기를
  // 처음 상태로 되돌리려면 진짜로 다시 들어가야 해서 <a>를 쓴다.
  const inner = (
    <>
      <Wordmark className="logo-word" />
      <span className="logo-stamp" aria-hidden="true">
        <Stamp />
      </span>
    </>
  );

  return plain ? (
    <a href="/" className="logo" aria-label="teamLedger">
      {inner}
    </a>
  ) : (
    <Link href="/" className="logo" aria-label="teamLedger">
      {inner}
    </Link>
  );
}
