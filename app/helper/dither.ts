/**
 * 투명한 그림을 점으로 찍기 (§20)
 *
 * app/Dithered.tsx 의 것과 같은 Floyd–Steinberg 오차 확산이지만, 이쪽은 배경이
 * 비어 있는 그림을 다룬다. 캐릭터는 종이 위에 오려 붙인 것처럼 떠 있어야 해서,
 * 투명한 자리는 끝까지 투명해야 한다.
 *
 * 그래서 두 가지가 다르다.
 *   · 밝기를 계산할 때 투명한 점은 아예 셈에서 뺀다. 섞으면 가장자리가 검게 눌린다.
 *   · 흰 점은 찍지 않고 비운다. 종이가 흰색이든 검은색이든 잉크만 남으면
 *     어느 쪽 종이에서도 같은 그림이 된다.
 */

/**
 * 점이 점으로 보이는 크기.
 *
 * 화면에 보이는 크기와 같아야 한다. 크게 찍어 놓고 줄여서 보이면 점과 점이
 * 뭉개져 그냥 얼룩이 된다. 디더링은 화면의 점 하나가 잉크 한 방울일 때만
 * 디더링이다.
 */
export const DITHER_WIDTH = 110;

export function ditherOnto(canvas: HTMLCanvasElement, img: HTMLImageElement, ink: string): boolean {
  const W = DITHER_WIDTH;
  const H = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * W));
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);

  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, W, H);
  } catch {
    return false; // 다른 출처의 그림이면 읽을 수 없다. 그럴 땐 원본을 그대로 둔다.
  }
  const p = data.data;

  const grey = new Float32Array(W * H);
  const solid = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) {
    solid[i] = p[i * 4 + 3] > 128 ? 1 : 0;
    grey[i] = 0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2];
  }

  // 캐릭터는 거의 흰 종이라 그대로 찍으면 점이 거의 안 남는다. 그렇다고 대비만
  // 세게 주면 이번엔 형체가 부서진다. 그래서 이 그림이 실제로 쓰는 밝기 폭을
  // 재서 그 폭을 종이 전체로 늘린다.
  const values: number[] = [];
  for (let i = 0; i < grey.length; i += 1) if (solid[i]) values.push(grey[i]);
  if (!values.length) return false;
  values.sort((a, b) => a - b);
  const lo = values[Math.floor(values.length * 0.04)];
  const hi = values[Math.floor(values.length * 0.97)];
  const span = Math.max(1, hi - lo);

  for (let i = 0; i < grey.length; i += 1) {
    if (!solid[i]) continue;
    const n = Math.max(0, Math.min(1, (grey[i] - lo) / span));
    // 감마를 걸어 가운데 밝기를 어둡게 민다. 그래야 몸통에 점이 절반쯤 찍혀
    // 멀리서 봤을 때 회색으로 읽힌다. 그냥 늘리기만 하면 몸통이 전부 하얘진다.
    grey[i] = Math.pow(n, 1.9) * 255;
  }

  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (!solid[i]) continue;
      const old = grey[i];
      const next = old < 128 ? 0 : 255;
      grey[i] = next;
      const err = old - next;
      // 오차는 아직 안 찍은 이웃에게만 넘긴다. 투명한 곳으로 흘리면 사라진다.
      const give = (j: number, w: number) => {
        if (solid[j]) grey[j] += err * w;
      };
      if (x + 1 < W) give(i + 1, 7 / 16);
      if (y + 1 < H) {
        if (x > 0) give(i + W - 1, 3 / 16);
        give(i + W, 5 / 16);
        if (x + 1 < W) give(i + W + 1, 1 / 16);
      }
    }
  }

  const rgb = inkToRgb(ink);
  for (let i = 0; i < W * H; i += 1) {
    const on = solid[i] && grey[i] < 128;
    p[i * 4] = rgb[0];
    p[i * 4 + 1] = rgb[1];
    p[i * 4 + 2] = rgb[2];
    p[i * 4 + 3] = on ? 255 : 0;
  }
  ctx.putImageData(data, 0, 0);
  return true;
}

/** 잉크 색은 화면의 글자색을 따라간다. 어두운 종이에서는 흰 점이 된다. */
function inkToRgb(ink: string): [number, number, number] {
  const m = ink.match(/-?\d+(\.\d+)?/g);
  if (m && m.length >= 3) return [Number(m[0]), Number(m[1]), Number(m[2])];
  return ink.trim().startsWith('#f') || ink.includes('255') ? [255, 255, 255] : [0, 0, 0];
}
