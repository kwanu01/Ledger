'use client';

import Script from 'next/script';
import { useEffect, useRef } from 'react';

/**
 * 광고 슬롯.
 *
 * ⚠️ 이 컴포넌트는 **품목과 아카이브 화면에만** 넣는다.
 *    홈 · 장부 · 정산 내역 · 지출 기입에는 절대 넣지 않는다.
 *
 * 이유: 그 화면들에는 누가 누구에게 얼마를 보내야 하는지가 적혀 있다.
 * 정산 금액 옆에 서드파티 광고가 붙으면 §13.1이 요구하는 신뢰가 깨지고,
 * 광고 스크립트가 그 페이지에서 트래킹을 시작한다.
 *
 * 환경변수가 비어 있으면 아무것도 그리지 않는다. 그래서 개발 중이나
 * 심사 전에는 슬롯이 존재하지 않는 것과 같다.
 */

const CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
const SLOT = process.env.NEXT_PUBLIC_ADSENSE_SLOT;

export default function AdSlot() {
  const pushed = useRef(false);

  useEffect(() => {
    if (!CLIENT || !SLOT || pushed.current) return;
    pushed.current = true;
    try {
      // 스크립트가 아직 안 왔으면 배열만 만들어 두고, 오면 그때 처리된다.
      const w = window as unknown as { adsbygoogle?: unknown[] };
      w.adsbygoogle = w.adsbygoogle ?? [];
      w.adsbygoogle.push({});
    } catch {
      // 광고가 안 뜨는 것은 장부의 문제가 아니다. 조용히 넘어간다.
    }
  }, []);

  if (!CLIENT || !SLOT) return null;

  return (
    <div className="adslot">
      <Script
        id="adsbygoogle"
        strategy="lazyOnload"
        crossOrigin="anonymous"
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`}
      />
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={CLIENT}
        data-ad-slot={SLOT}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
