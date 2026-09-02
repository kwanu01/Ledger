'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
 *
 * ── 점은 그려지는 크기로 찍어야 한다 ────────────────────────────────
 *
 * 처음에는 늘 260px 로 찍고 CSS 로 칸에 맞췄다. 그게 사진을 뭉갠 원인이다.
 *
 * 디더링의 결과는 **검정 아니면 흰색인 점뿐**이라 중간값이 없다. 그것을
 * 0.6배로 줄이면 브라우저가 이웃한 점들을 섞어 중간 회색을 만드는데, 그
 * 중간 회색이 바로 디더링이 없애려던 것이다. 없앤 회색이 다시 들어오면서
 * 규칙적이던 점이 얼룩으로 뭉친다 — 화면에서 본 그 지저분함이다.
 *
 * 그래서 칸의 실제 너비를 재서 그 크기로 찍는다. 점 하나가 화면의 점 하나에
 * 그대로 앉으면 줄어들 일이 없다. 칸이 달라지면 다시 찍는다(ResizeObserver).
 *
 * ── 어두운 사진을 살리는 일 ─────────────────────────────────────────
 *
 * 밝기 128을 문턱으로 자르면, 책상 위에서 찍은 영수증처럼 **바탕이 어두운
 * 사진은 통째로 검정**이 된다. 영수증만 하얗게 남고 나머지가 다 잉크가 되니
 * 무엇을 찍은 것인지 알 수가 없다.
 *
 * 문턱을 옮기는 것으로는 안 된다. 사진마다 어두운 정도가 다르기 때문이다.
 * 대신 **그 사진이 실제로 쓰고 있는 밝기 구간을 찾아 0~255로 펴 준다.**
 * 위아래 1.5%는 버린다 — 형광등 반사 한 점과 그림자 한 점이 구간 전체를
 * 정하게 두면 아무것도 안 펴진다. 편 다음 감마로 가운데를 조금 들어 올린다.
 * 종이가 종이답게 희어지고, 어두운 바탕은 검정 대신 성긴 점이 된다.
 */

/** 이보다 좁은 칸에 찍으면 점이 글자를 다 먹는다. 이보다 넓으면 헛수고다. */
const MIN_W = 96;
const MAX_W = 520;
/** 이만큼은 달라져야 다시 찍는다. 한두 픽셀마다 다시 찍을 일은 없다. */
const REDRAW_SLOP = 12;

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
  const wrap = useRef<HTMLSpanElement>(null);
  /** 다 받아 둔 원본. 칸이 달라지면 이걸로 다시 찍는다. */
  const photo = useRef<HTMLImageElement | null>(null);
  /** 마지막으로 찍은 너비. 같은 너비로 두 번 찍지 않는다. */
  const drawnAt = useRef(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  const draw = useCallback((width: number) => {
    const img = photo.current;
    const el = canvas.current;
    if (!img || !el) return;

    const W = Math.round(Math.max(MIN_W, Math.min(MAX_W, width)));
    if (Math.abs(W - drawnAt.current) < REDRAW_SLOP && drawnAt.current) return;
    const H = Math.max(1, Math.round((img.height / img.width) * W));
    drawnAt.current = W;
    el.width = W;
    el.height = H;

    const ctx = el.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, W, H);

    const data = ctx.getImageData(0, 0, W, H);
    const p = data.data;
    const N = W * H;

    // 밝기 한 장으로 줄인다. 색은 어차피 버린다.
    const grey = new Float32Array(N);
    const hist = new Uint32Array(256);
    for (let i = 0; i < N; i += 1) {
      const v = 0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2];
      grey[i] = v;
      hist[v | 0] += 1;
    }

    // 이 사진이 실제로 쓰는 구간을 찾는다. 양 끝 1.5%는 버린다.
    const cut = Math.max(1, Math.round(N * 0.015));
    let lo = 0;
    let hi = 255;
    for (let acc = 0; lo < 255; lo += 1) {
      acc += hist[lo];
      if (acc >= cut) break;
    }
    for (let acc = 0; hi > lo + 1; hi -= 1) {
      acc += hist[hi];
      if (acc >= cut) break;
    }
    // 구간이 너무 좁으면 늘리는 것이 아니라 잡음을 키우는 일이 된다.
    const span = Math.max(40, hi - lo);

    for (let i = 0; i < N; i += 1) {
      let v = (grey[i] - lo) / span;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      /*
       * 감마 — 가운데를 들어 올린다.
       *
       * 어두운 바탕이 통째로 검정이 되지 않게 하는 것이 목적이다. 0.72는
       * 어두운 사진에서는 책상이 성긴 점무늬로 풀리고, 밝고 평평한 원고에서는
       * 아무것도 달라지지 않는 값이다(둘 다 놓고 견줘서 고른 값이다).
       *
       * 예전에 걸어 두던 대비 보정(×1.18)은 뺀다. 그건 구간을 안 펴던 시절
       * 어두운 사진을 억지로 갈라 놓으려던 것이라, 이제는 두 번 미는 셈이다.
       */
      grey[i] = Math.pow(v, 0.72) * 255;
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

    for (let i = 0; i < N; i += 1) {
      const v = grey[i];
      p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = v;
      p[i * 4 + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    setReady(true);
  }, []);

  useEffect(() => {
    let alive = true;
    drawnAt.current = 0;
    setReady(false);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (!alive) return;
      photo.current = img;
      draw(wrap.current?.clientWidth || MIN_W);
    };
    img.onerror = () => alive && setFailed(true);
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src, draw]);

  /* 칸이 달라지면 그 크기로 다시 찍는다. 창을 줄였다고 점이 뭉치면 안 된다. */
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => draw(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  // 캔버스를 못 그리면 사진을 그대로 둔다. 아무것도 없는 것보다 낫다.
  if (failed) {
    return <img className={className} src={src} alt={alt} />;
  }

  return (
    <span ref={wrap} className={`dither${ready ? ' on' : ''} ${className ?? ''}`}>
      <canvas ref={canvas} aria-hidden="true" />
      {/* 마우스를 올리면 원본. 확인해야 할 때가 있다. */}
      <img src={src} alt={alt} loading="lazy" />
    </span>
  );
}
