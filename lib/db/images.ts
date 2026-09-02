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
/* 서버가 받아 두는 한도. next.config.mjs 의 본문 상한(4MB)과 같은 값이어야
   한다 — 여기가 더 크면 통과시킬 생각으로 적어 둔 숫자를 프레임워크가 먼저
   끊고, 그 오류는 우리가 잡을 수 없다. */
export const MAX_BYTES = 4 * 1024 * 1024;

/**
 * 정말 그림 파일인지 앞머리를 보고 판정한다.
 *
 * 브라우저가 보내 주는 종류(Content-Type)는 보내는 쪽이 적는 값이다. 그 말만
 * 믿으면 어떤 파일이든 image/png 라고 적어 올릴 수 있다. 그렇게 올라간 파일은
 * 우리 주소로 다시 나가므로, 파일의 앞 몇 바이트를 직접 본다.
 *
 * 세 가지만 받는다. 앞머리가 아래와 다르면 종류를 뭐라고 적었든 받지 않는다.
 */
export function sniff(bytes: ArrayBuffer): string | null {
  const b = new Uint8Array(bytes);
  if (b.length < 12) return null;

  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (PNG.every((v, i) => b[i] === v)) return 'image/png';

  // WEBP: 'RIFF' .... 'WEBP'
  const ascii = (i: number, s: string) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';

  return null;
}

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
  // 적어 보낸 종류가 아니라 파일이 실제로 무엇인지로 정한다.
  const real = sniff(args.bytes);
  if (!real || real !== args.contentType) {
    throw new Error('JPG · PNG · WEBP 사진만 올릴 수 있습니다.');
  }
  const ext = EXT[real];
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
