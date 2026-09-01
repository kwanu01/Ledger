import 'server-only';
import { db } from './client.ts';

/**
 * 사진 저장소 (§7)
 *
 * 영수증과 대표 사진을 Supabase Storage 에 둔다. 버킷은 공개하지 않는다.
 * 브라우저는 저장소를 직접 부르지 않고, 우리 주소(/l/<장부>/img/<경로>)로
 * 받는다. 그 자리에서 이 장부의 사람인지 판정한 다음에 파일을 꺼내 준다.
 *
 * 경로는 `<장부>/<지출>/<종류>-<난수>.<확장자>` 다. 장부와 지출이 앞에 있어서
 * 장부를 지울 때 그 아래를 통째로 지울 수 있고, 난수가 뒤에 있어서 사진을
 * 바꿔 끼울 때 브라우저가 옛 그림을 캐시에서 꺼내 오지 않는다.
 */

export const BUCKET = 'expense-images';

export type ImageKind = 'receipt' | 'item';

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const ALLOWED_TYPES = Object.keys(EXT);
export const MAX_BYTES = 5 * 1024 * 1024;

/** 이 장부의 사진이 맞는지. 남의 장부 경로를 넣어 꺼내 가지 못하게 한다. */
export function belongsTo(path: string, ledgerId: string): boolean {
  return path.startsWith(`${ledgerId}/`) && !path.includes('..');
}

export async function putImage(args: {
  ledgerId: string;
  expenseId: string;
  kind: ImageKind;
  bytes: ArrayBuffer;
  contentType: string;
}): Promise<string> {
  const ext = EXT[args.contentType];
  if (!ext) throw new Error('사진 파일만 올릴 수 있습니다.');

  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${args.ledgerId}/${args.expenseId}/${args.kind}-${stamp}${rand}.${ext}`;

  const { error } = await db.storage.from(BUCKET).upload(path, args.bytes, {
    contentType: args.contentType,
    // 같은 이름이 두 번 나올 일은 없지만, 났다면 덮어쓰는 쪽이 낫다.
    upsert: true,
  });
  if (error) throw new Error(error.message);
  return path;
}

/** 바꿔 끼우거나 지울 때, 쓰지 않게 된 파일을 남겨 두지 않는다. */
export async function dropImage(path: string | null | undefined): Promise<void> {
  if (!path) return;
  await db.storage.from(BUCKET).remove([path]);
}

/** 서버에서만 부른다. 화면으로 내보낼 바이트와 그 종류. */
export async function readImage(
  path: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return { bytes: await data.arrayBuffer(), contentType: data.type || 'image/jpeg' };
}

/** 장부를 지울 때 그 아래 사진도 함께 지운다. */
export async function dropLedgerImages(ledgerId: string): Promise<void> {
  // 저장소에는 폴더가 없다. 앞이 같은 것을 모아 지운다.
  const { data } = await db.storage.from(BUCKET).list(ledgerId, { limit: 1000 });
  if (!data?.length) return;

  const paths: string[] = [];
  for (const entry of data) {
    const { data: inner } = await db.storage
      .from(BUCKET)
      .list(`${ledgerId}/${entry.name}`, { limit: 1000 });
    for (const f of inner ?? []) paths.push(`${ledgerId}/${entry.name}/${f.name}`);
  }
  if (paths.length) await db.storage.from(BUCKET).remove(paths);
}

/** 지출 한 줄의 사진 경로를 갈아 끼운다. */
export async function setExpenseImage(args: {
  expenseId: string;
  kind: ImageKind;
  path: string | null;
}): Promise<void> {
  const column = args.kind === 'receipt' ? 'receipt_path' : 'representative_image_path';
  const { error } = await db
    .from('expenses')
    .update({ [column]: args.path })
    .eq('id', args.expenseId);
  if (error) throw new Error(error.message);
}

/** 지금 붙어 있는 사진 경로. 바꿔 끼우기 전에 옛 파일을 지우려면 필요하다. */
export async function currentImage(
  expenseId: string,
  kind: ImageKind,
): Promise<{ ledgerId: string; path: string | null } | null> {
  const column = args_column(kind);
  const { data, error } = await db
    .from('expenses')
    .select(`ledger_id, ${column}`)
    .eq('id', expenseId)
    .single();
  if (error || !data) return null;
  const row = data as unknown as Record<string, string | null>;
  return { ledgerId: row.ledger_id as string, path: row[column] };
}

function args_column(kind: ImageKind) {
  return kind === 'receipt' ? 'receipt_path' : 'representative_image_path';
}
