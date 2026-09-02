/**
 * 사진 줄이기 (§7)
 *
 * 폰으로 찍은 영수증은 3~5MB에 4000픽셀이 넘는다. 그걸 그대로 올리면 세 군데서
 * 시간을 잃는다.
 *
 *   1. 올라가는 데 — LTE에서 4MB는 몇 초다.
 *   2. 실어 보내는 데 — 서버가 base64로 바꾸면 크기가 다시 4/3이 된다.
 *   3. 읽는 데 — 그림이 클수록 모델이 보는 조각이 많아지고 그만큼 오래 걸린다.
 *
 * 셋을 합치면 20초를 넘기고, 서버 시간 제한에 걸려 아무 대답도 못 받는 일이
 * 생긴다. 화면에는 '읽는 중'만 남는다.
 *
 * 그런데 영수증을 읽는 데 4000픽셀은 필요 없다. 글자가 읽히면 된다. 긴 변을
 * 1600픽셀로 줄이면 대개 300KB 아래가 되고, 인쇄된 영수증 글자는 그대로 읽힌다.
 *
 * 방향도 여기서 바로잡는다. 폰 사진은 세워 찍어도 파일 안에는 눕혀 저장되고
 * '돌려서 보라'는 표시만 붙는다. 그 표시를 무시하고 그리면 누운 그림이 올라간다.
 */

/** 긴 변의 최대 길이. 영수증 글자가 읽히는 선. */
const MAX_EDGE = 1600;
/** 이보다 작으면 손대지 않는다. 줄여 봤자 얻을 게 없다. */
const LEAVE_ALONE = 400 * 1024;

/**
 * 여기까지는 반드시 줄인다 (§7)
 *
 * 서버 액션은 본문 크기에 상한이 있다. 그 상한을 넘으면 **우리 코드가 시작되기
 * 전에** 프레임워크가 요청을 끊는다. 그러면 오류를 잡아 수증이에게 넘길 수도
 * 없어서, 화면에는 'Application error'만 뜬다 — 사용자 입장에서는 사진을
 * 골랐더니 서비스가 죽은 것이다. 실제로 그렇게 됐다.
 *
 * 상한은 next.config.mjs 에서 4MB 로 올려 두었지만, 그것만 믿지 않는다.
 * 상한에 기대는 대신 **보내는 쪽에서 확실히 줄인다.** 900KB 는 1600픽셀
 * 영수증에 넉넉하고, LTE 에서 올리는 시간도 짧다.
 *
 * 화질을 한 단씩 낮추다가, 그래도 안 되면 크기를 줄인다. 순서가 중요하다 —
 * 글자는 화질보다 크기에 먼저 무너진다. 1200픽셀 흐린 영수증이 900픽셀
 * 선명한 영수증보다 잘 읽힌다.
 */
const FITS = 900 * 1024;
/** 화질을 낮추는 차례. 0.82 는 눈으로 원본과 구분이 안 되는 선이다. */
const QUALITIES = [0.82, 0.7, 0.58, 0.46];
/** 화질로 안 되면 크기를 줄이는 차례. */
const EDGES = [MAX_EDGE, 1200, 900];

/**
 * 저장소가 받는 형식. 이 셋이 아니면 크기와 상관없이 다시 그려서 JPEG로 만든다.
 *
 * 아이폰은 사진을 HEIC로 저장한다. 파일 고르기에서 형식을 걸러도 그대로
 * 올라오는 경우가 있고, 그러면 서버가 받아 주지 않는다. 브라우저는 그 그림을
 * 화면에 그릴 수는 있으므로, 여기서 한 번 그려서 JPEG로 바꿔 보낸다.
 */
const KEEPS = ['image/jpeg', 'image/png', 'image/webp'];

export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') && file.type !== '') return file;

  // 받아 주는 형식이면서 이미 작으면 그대로 보낸다. 다시 그리면 화질만 깎인다.
  if (KEEPS.includes(file.type) && file.size <= LEAVE_ALONE) return file;

  try {
    // 'from-image' 는 파일에 적힌 방향 표시를 따라 세워서 넘겨준다.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

    const draw = async (edge: number, quality: number): Promise<Blob | null> => {
      const long = Math.max(bitmap.width, bitmap.height);
      const scale = long > edge ? edge / long : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', quality));
    };

    /*
     * 900KB 아래로 떨어질 때까지 낮춘다.
     *
     * 크기를 바깥 고리에 둔 것은 글자가 화질보다 크기에 먼저 무너지기
     * 때문이다. 한 크기 안에서 화질을 끝까지 낮춰 보고, 그래도 안 되면
     * 그때 크기를 한 단 줄인다.
     */
    let best: Blob | null = null;
    for (const edge of EDGES) {
      for (const q of QUALITIES) {
        const blob = await draw(edge, q);
        if (!blob) continue;
        if (!best || blob.size < best.size) best = blob;
        if (blob.size <= FITS) {
          best = blob;
          break;
        }
      }
      if (best && best.size <= FITS) break;
    }
    bitmap.close?.();

    if (!best) return file;

    /*
     * 다시 그린 것이 원본보다 크면 원본을 쓰던 자리다. 그런데 그 원본이
     * 4MB 면 보내는 순간 끊긴다 — 실제로 그래서 터졌다. **작은 쪽을
     * 쓰되, 상한을 넘는 것은 어느 쪽이든 쓰지 않는다.**
     */
    if (KEEPS.includes(file.type) && file.size <= best.size && file.size <= FITS) {
      return file;
    }

    return new File([best], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    // 브라우저가 못 하겠다고 하면 원본을 보낸다. 느릴 뿐 못 읽는 것은 아니다.
    // 그래도 큰 것은 보내는 쪽에서 막는다(tooBigToSend).
    return file;
  }
}

/**
 * 보내도 되는 크기인가.
 *
 * 줄이기가 실패했을 수도 있다(브라우저가 그 형식을 못 그리는 경우). 그때
 * 그대로 보내면 서버 액션 상한에 걸려 **우리가 잡을 수 없는 오류**가 난다.
 * 보내기 전에 여기서 걸러 사람에게 말해 주는 편이 낫다.
 *
 * 4MB 는 next.config.mjs 에 적어 둔 상한과 같다. 두 숫자가 어긋나면
 * 한쪽은 통과시키고 다른 쪽이 끊는 일이 생긴다.
 */
export const SEND_LIMIT = 4 * 1024 * 1024;

export function tooBigToSend(file: File): boolean {
  return file.size > SEND_LIMIT;
}
