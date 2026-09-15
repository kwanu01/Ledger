import 'server-only';
import { db } from './client.ts';
import { randomUUID } from 'node:crypto';
import { MobileError } from '../mobile/http.ts';

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
  memberId: string;
  userId: string | null;
  kind: ImageKind;
  bytes: ArrayBuffer;
  contentType: string;
}): Promise<{ path: string; operationId: string }> {
  if (!['receipt', 'item'].includes(args.kind) || args.bytes.byteLength > MAX_BYTES) throw new Error('사진 정보를 확인해 주세요.');
  // 적어 보낸 종류가 아니라 파일이 실제로 무엇인지로 정한다.
  const real = sniff(args.bytes);
  if (!real || real !== args.contentType) {
    throw new Error('JPG · PNG · WEBP 사진만 올릴 수 있습니다.');
  }
  const ext = EXT[real];
  if (!ext) throw new Error('사진 파일만 올릴 수 있습니다.');

  const path = `${args.ledgerId}/${args.expenseId}/${args.kind}-${randomUUID()}.${ext}`;
  const { data: operation, error: operationError } = await db.rpc('begin_image_upload', {
    p_ledger_id: args.ledgerId, p_expense_id: args.expenseId, p_path: path,
    p_member_id: args.memberId, p_user_id: args.userId,
  });
  if (operationError || typeof operation !== 'string') throw new Error('사진 업로드를 시작하지 못했습니다. 장부 상태를 확인해 주세요.');

  const { error } = await db.storage.from(BUCKET).upload(path, args.bytes, {
    contentType: args.contentType,
    upsert: false,
  });
  // Keep the durable operation on any unconfirmed response: the remote write
  // may still complete. Account deletion must wait for reconciliation.
  if (error) throw new Error('사진 업로드 결과를 확인하지 못했습니다. 계속 실패하면 문의해 주세요.');
  return { path, operationId: operation };
}

export async function finishImageUpload(operationId: string, path: string): Promise<void> {
  const { data: finished, error: finishError } = await db.rpc('finish_image_upload', { p_operation_id: operationId, p_path: path });
  if (finishError || finished !== true) throw new Error('사진 업로드 상태를 확인하지 못했습니다. 계속 실패하면 문의해 주세요.');
}

/** 바꿔 끼우거나 지울 때, 쓰지 않게 된 파일을 남겨 두지 않는다. */
export async function dropImage(path: string | null | undefined): Promise<void> {
  if (!path) return;
  const { data, error } = await db.storage.from(BUCKET).remove([path]);
  if (error || !Array.isArray(data)) throw new Error('사진을 삭제하지 못했습니다. 다시 시도해 주세요.');
  const parent = path.slice(0, path.lastIndexOf('/'));
  if (!parent || (await ledgerImagePaths(parent)).includes(path)) throw new Error('사진 삭제 결과를 확인하지 못했습니다. 다시 시도해 주세요.');
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
async function ledgerImagePaths(ledgerId: string): Promise<string[]> {
  const paths: string[] = [], folders = [ledgerId], visited = new Set<string>();
  while (folders.length) {
    const folder = folders.pop()!;
    if (visited.has(folder) || visited.size > 100000 || folder.split('/').length > 8) throw new Error('사진 목록이 너무 큽니다. 문의해 주세요.');
    visited.add(folder);
    const names = new Set<string>();
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await db.storage.from(BUCKET).list(folder, { limit: 100, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error || !Array.isArray(data) || data.length > 100) throw new Error('사진 목록을 확인하지 못했습니다. 다시 시도해 주세요.');
      for (const file of data) {
        if (!file || typeof file.name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(file.name) || ['.', '..'].includes(file.name) || names.has(file.name)) throw new Error('사진 경로를 확인하지 못했습니다. 문의해 주세요.');
        names.add(file.name);
        const path = `${folder}/${file.name}`;
        if (file.id === null) folders.push(path);
        else if (typeof file.id === 'string' && file.id) paths.push(path);
        else throw new Error('사진 목록을 확인하지 못했습니다.');
        if (paths.length + folders.length > 100000) throw new Error('사진 목록이 너무 큽니다. 문의해 주세요.');
      }
      if (data.length < 100) break;
    }
  }
  return paths;
}
export async function dropLedgerImages(ledgerId: string): Promise<void> {
  // Read every page before removing files so offsets cannot skip rows we delete.
  const paths = await ledgerImagePaths(ledgerId);
  for (let offset = 0; offset < paths.length; offset += 100) {
    const { data, error } = await db.storage.from(BUCKET).remove(paths.slice(offset, offset + 100));
    if (error || !Array.isArray(data)) throw new Error('사진을 삭제하지 못했습니다. 다시 시도해 주세요.');
  }
  if ((await ledgerImagePaths(ledgerId)).length) throw new Error('남아 있는 사진을 확인했습니다. 삭제를 다시 시도해 주세요.');
}

export async function assertAccountImageCleanupReady(): Promise<void> {
  const { data, error } = await db.rpc('account_image_cleanup_ready');
  if (error || data !== true) throw new MobileError(503, 'IMAGE_CLEANUP_UNAVAILABLE', '사진 삭제 기능을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.');
}

export async function cleanupAccountImages(userId: string): Promise<void> {
  // This also covers a departing member's upload into a retained shared ledger.
  const ownedUploads = await db.from('image_upload_operations').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  assertNoPendingUploads(ownedUploads);
  let total: number | null = null;
  for (let offset = 0; ; offset += 100) {
    const { data, count, error } = await db.from('account_image_cleanup')
      .select('ledger_id, completed_at', { count: 'exact' }).eq('user_id', userId)
      .order('ledger_id').range(offset, offset + 99);
    if (error || !Array.isArray(data) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0
        || (total !== null && count !== total) || data.length !== Math.min(100, Math.max(0, count - offset))) {
      throw new MobileError(503, 'IMAGE_CLEANUP_UNAVAILABLE', '삭제할 사진 목록을 확인하지 못했습니다. 다시 시도해 주세요.');
    }
    total = count;
    for (const row of data) {
      if (row.completed_at) continue;
      const pending = await db.from('image_upload_operations').select('id', { count: 'exact', head: true }).eq('ledger_id', row.ledger_id);
      assertNoPendingUploads(pending);
      try { await dropLedgerImages(row.ledger_id); }
      catch { throw new MobileError(503, 'IMAGE_CLEANUP_FAILED', '사진 삭제를 완료하지 못했습니다. 계정 삭제를 다시 시도해 주세요.'); }
      const updated = await db.from('account_image_cleanup').update({ completed_at: new Date().toISOString() })
        .eq('ledger_id', row.ledger_id).eq('user_id', userId).select('ledger_id').maybeSingle();
      if (updated.error || !updated.data) throw new MobileError(503, 'IMAGE_CLEANUP_UNAVAILABLE', '사진 삭제 결과를 기록하지 못했습니다. 다시 시도해 주세요.');
    }
    if (offset + data.length >= total) break;
  }
}

function assertNoPendingUploads(pending: { count: number | null; error: unknown }): void {
  if (pending.error || typeof pending.count !== 'number' || !Number.isSafeInteger(pending.count) || pending.count < 0) throw new MobileError(503, 'IMAGE_CLEANUP_UNAVAILABLE', '사진 업로드 상태를 확인하지 못했습니다. 다시 시도해 주세요.');
  if (pending.count > 0) throw new MobileError(409, 'IMAGE_UPLOAD_PENDING', '사진 업로드 결과를 확인하고 있습니다. 잠시 후 삭제를 다시 시도하고, 계속되면 문의해 주세요.');
}

/** 지출 한 줄의 사진 경로를 갈아 끼운다. */
export async function setExpenseImage(args: {
  ledgerId: string;
  expenseId: string;
  memberId: string;
  userId: string | null;
  kind: ImageKind;
  path: string | null;
  expectedPath: string | null;
}): Promise<void> {
  if (!['receipt', 'item'].includes(args.kind)) throw new Error('사진 종류를 확인해 주세요.');
  const { data, error } = await db.rpc('set_expense_image', {
    p_ledger_id: args.ledgerId, p_expense_id: args.expenseId,
    p_member_id: args.memberId, p_user_id: args.userId,
    p_kind: args.kind, p_path: args.path, p_expected_path: args.expectedPath,
  });
  if (error || data !== true) throw new Error('지출이 삭제되었거나 권한이 변경되었습니다. 사진을 연결하지 못했습니다.');
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
