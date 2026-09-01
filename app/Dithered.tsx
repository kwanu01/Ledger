'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * 디더링 (§20)
 *
 * 사진을 흑백 점으로만 찍는다. 이 장부는 검정·흰색·파랑뿐이라 사진 한 장이
 * 들어오면 그 규칙이 깨진다. 신문의 망점처럼 점으로 환원하면 사진이 장부의
 * 일부가 된다.
 *
 * 회색을 흉내 내는 방식은 Floyd–Steinberg 오차 확산이다. 한 점을 검정이나
 * 흰색으로 정하고 나서 생긴 오차를 아직 안 찍은 이웃 점들에 나눠 넘긴다.
 * 그래서 멀리서 보면 원래 밝기가 남는다.
 *
 * 원본은 마우스를 올리면 나온다. 무엇을 샀는지 확인해야 할 때가 있고,
 * 그때는 점이 아니라 사진이어야 한다.
 */
export default function Dithered({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!alive) return;
      const el = canvas.current;
      if (!el) return;

      // 점이 보여야 디더링이다. 너무 크게 그리면 점이 아니라 얼룩이 된다.
      const W = 260;
      const H = Math.max(1, Math.round((img.height / img.width) * W));
      el.width = W;
      el.height = H;

      const ctx = el.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, W, H);

      const data = ctx.getImageData(0, 0, W, H);
      const p = data.data;

      // 밝기 한 장으로 줄인다. 색은 어차피 버린다.
      const grey = new Float32Array(W * H);
      for (let i = 0; i < W * H; i += 1) {
        grey[i] = 0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2];
      }

      // 종이에 찍히는 잉크라 생각하고 대비를 조금 올린다.
      for (let i = 0; i < grey.length; i += 1) {
        grey[i] = Math.max(0, Math.min(255, (grey[i] - 128) * 1.18 + 132));
      }

      for (let y = 0; y < H; y += 1) {
        for (let x = 0; x < W; x += 1) {
          const i = y * W + x;
          const old = grey[i];
          const next = old < 128 ? 0 : 255;
          grey[i] = next;
          const err = old - next;
          // 오차를 오른쪽·아래로 흘려 보낸다 (7/16, 3/16, 5/16, 1/16)
          if (x + 1 < W) grey[i + 1] += (err * 7) / 16;
          if (y + 1 < H) {
            if (x > 0) grey[i + W - 1] += (err * 3) / 16;
            grey[i + W] += (err * 5) / 16;
            if (x + 1 < W) grey[i + W + 1] += err / 16;
          }
        }
      }

      for (let i = 0; i < W * H; i += 1) {
        const v = grey[i];
        p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = v;
        p[i * 4 + 3] = 255;
      }
      ctx.putImageData(data, 0, 0);
      setReady(true);
    };
    img.onerror = () => alive && setFailed(true);
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src]);

  // 캔버스를 못 그리면 사진을 그대로 둔다. 아무것도 없는 것보다 낫다.
  if (failed) {
    return <img className={className} src={src} alt={alt} />;
  }

  return (
    <span className={`dither${ready ? ' on' : ''} ${className ?? ''}`}>
      <canvas ref={canvas} aria-hidden="true" />
      {/* 마우스를 올리면 원본. 확인해야 할 때가 있다. */}
      <img src={src} alt={alt} loading="lazy" />
    </span>
  );
}
