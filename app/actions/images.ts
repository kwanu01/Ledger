'use server';

import { revalidatePath } from 'next/cache';
import { requireLedgerAccess } from '../../lib/access.ts';
import { failed } from '../../lib/fail.ts';
import {
  ALLOWED_TYPES,
  MAX_BYTES,
  currentImage,
  dropImage,
  putImage,
  setExpenseImage,
  type ImageKind,
} from '../../lib/db/images.ts';

/**
 * 사진 붙이기·바꾸기·떼기 (§7)
 *
 * 두 자리가 있다.
 *   영수증 사진 — 그 지출이 진짜 있었다는 근거. 장부의 줄을 펼치면 나온다.
 *   품목 사진   — 무엇을 샀는지 보이는 사진. 품목 화면의 카드에 걸린다.
 *
 * 영수증을 자동으로 저장하지 않는 이유가 있다. 영수증에는 카드 뒷번호와 매장,
 * 시각이 찍혀 있고 그것이 팀원 전체에게 보인다. 남길지 말지는 올린 사람이
 * 정할 일이라서, 읽기(AI)와 남기기(저장)를 갈라 두었다.
 *
 * 지출을 고칠 수 있는 사람이면 사진도 바꿀 수 있다. 정산이 끝난 지출이라도
 * 사진은 바꿀 수 있게 둔다. 금액이 아니라 그 금액의 근거이기 때문이다.
 */

export type ImageResult = { ok: true; path: string | null } | { ok: false; message: string };

const oops = (e: unknown) => failed(e, '사진을 저장하지 못했습니다.');

export async function attachImage(formData: FormData): Promise<ImageResult> {
  try {
    const ledgerId = String(formData.get('ledgerId') ?? '');
    const expenseId = String(formData.get('expenseId') ?? '');
    const kind = String(formData.get('kind') ?? 'receipt') as ImageKind;
    await requireLedgerAccess(ledgerId);

    const file = formData.get('image');
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, message: '사진을 골라 주세요.' };
    }
    if (file.size > MAX_BYTES) {
      return { ok: false, message: '사진이 너무 큽니다. 5MB 아래로 줄여 주세요.' };
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return { ok: false, message: 'JPG · PNG · WEBP만 올릴 수 있습니다.' };
    }

    // 이 지출이 정말 이 장부의 것인지 확인한다. 남의 장부 지출 id를 넣어
    // 우리 장부 권한으로 고치는 일을 막는다.
    const now = await currentImage(expenseId, kind);
    if (!now || now.ledgerId !== ledgerId) {
      return { ok: false, message: '이 장부의 지출이 아닙니다.' };
    }

    const path = await putImage({
      ledgerId,
      expenseId,
      kind,
      bytes: await file.arrayBuffer(),
      contentType: file.type,
    });

    // 저장소에 올린 다음 장부의 칸을 채운다. 칸을 채우다 막히면 방금 올린
    // 파일은 아무도 가리키지 않는 채로 남는다. 그래서 실패하면 되돌린다.
    try {
      await setExpenseImage({ expenseId, kind, path });
    } catch (e) {
      await dropImage(path);
      throw e;
    }

    // 바꿔 끼웠으면 옛 파일은 쓸 데가 없다.
    await dropImage(now.path);

    revalidatePath(`/l/${ledgerId}`, 'layout');
    return { ok: true, path };
  } catch (e) {
    return oops(e);
  }
}

export async function removeImage(args: {
  ledgerId: string;
  expenseId: string;
  kind: ImageKind;
}): Promise<ImageResult> {
  try {
    await requireLedgerAccess(args.ledgerId);

    const now = await currentImage(args.expenseId, args.kind);
    if (!now || now.ledgerId !== args.ledgerId) {
      return { ok: false, message: '이 장부의 지출이 아닙니다.' };
    }

    await setExpenseImage({ expenseId: args.expenseId, kind: args.kind, path: null });
    await dropImage(now.path);

    revalidatePath(`/l/${args.ledgerId}`, 'layout');
    return { ok: true, path: null };
  } catch (e) {
    return oops(e);
  }
}
