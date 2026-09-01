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

export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  // 이미 작으면 그대로 보낸다. 다시 그리면 화질만 한 번 더 깎인다.
  if (file.size <= LEAVE_ALONE) return file;

  try {
    // 'from-image' 는 파일에 적힌 방향 표시를 따라 세워서 넘겨준다.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const long = Math.max(bitmap.width, bitmap.height);
    const scale = long > MAX_EDGE ? MAX_EDGE / long : 1;
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((done) =>
      canvas.toBlob(done, 'image/jpeg', 0.82),
    );
    if (!blob || blob.size >= file.size) return file;

    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch {
    // 브라우저가 못 하겠다고 하면 원본을 보낸다. 느릴 뿐 못 읽는 것은 아니다.
    return file;
  }
}
