'use client';

import { useEffect, useState } from 'react';
import Dithered from './Dithered.tsx';

/**
 * 사진 (§21.3)
 *
 * 작게 붙어 있을 때는 점으로 찍는다. 이 장부는 검정과 흰색뿐이라, 색 사진 한 장이
 * 줄 옆에 그대로 앉으면 그것만 다른 데서 오려 붙인 것처럼 떠 보인다. 점으로
 * 환원하면 종이에 인쇄된 것이 된다.
 *
 * 누르면 원본이 화면을 덮고 크게 열린다. 점은 이 장부의 규칙이지만, 무엇을
 * 샀는지 확인하려고 여는 창에서까지 점일 이유는 없다. 거기서는 읽혀야 한다.
 */
export default function Lightbox({
  src,
  alt,
  caption,
  label,
  wide = false,
}: {
  src: string;
  alt: string;
  /** 크게 열었을 때 아래에 적히는 한 줄. 대개 항목 이름과 금액. */
  caption?: string;
  /** 썸네일 아래 작은 글씨. 없으면 안 적는다. */
  label?: string;
  /** 품목 카드처럼 칸을 다 쓰는 자리 */
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    // 뒤에 있는 글이 같이 움직이면 창이 아니라 얼룩처럼 보인다.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', esc);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button className={`shot${wide ? ' wide' : ''}`} onClick={() => setOpen(true)} title={alt}>
        <Dithered src={src} alt={alt} />
        {label && <span className="shot-label">{label}</span>}
      </button>

      {open && (
        <div className="lightbox" onClick={() => setOpen(false)} role="dialog" aria-modal="true">
          <figure onClick={(e) => e.stopPropagation()}>
            <img src={src} alt={alt} />
            {caption && <figcaption>{caption}</figcaption>}
          </figure>
          <button className="lightbox-x" onClick={() => setOpen(false)} aria-label="닫기">
            ✕
          </button>
        </div>
      )}
    </>
  );
}
