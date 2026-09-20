import Link from 'next/link';
import Wordmark from './Wordmark.tsx';

/** 원래의 필기체 워드마크와 흑백 바코드만 쓰는 간결한 로고. */

/** 이 장부 프로그램이 만들어진 해. 화면 맨 아래 줄에 적힌다. */
export const MADE_ON = '2026 · 09 · 01';

export default function Logo({ plain = false }: { plain?: boolean }) {
  // 첫 화면에서는 같은 주소로의 Link가 화면을 다시 그리지 않는다. 계산기를
  // 처음 상태로 되돌리려면 진짜로 다시 들어가야 해서 <a>를 쓴다.
  const inner = (
    <>
      <Wordmark className="logo-word" />
      <svg className="logo-barcode" viewBox="0 0 30 10" aria-hidden="true">
        <path d="M1 0v10M3 0v10M6 0v10M8 0v10M12 0v10M13.5 0v10M17 0v10M20 0v10M22 0v10M26 0v10M29 0v10" />
      </svg>
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
