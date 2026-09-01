import { requireLedgerAccess, AccessError } from '../../../../../lib/access.ts';
import { belongsTo, readImage } from '../../../../../lib/db/images.ts';

/**
 * 사진 내보내는 자리 (§7)
 *
 * 저장소를 공개해 두면 주소만 아는 사람은 누구나 영수증을 볼 수 있다. 영수증에는
 * 카드 뒷번호와 매장과 시각이 찍혀 있다. 그래서 저장소는 닫아 두고, 사진은 이
 * 자리를 거쳐 나간다. 여기서 하는 일은 둘뿐이다.
 *
 *   1. 이 장부에 들어올 수 있는 사람인지 판정한다(계정이든 초대 통행증이든).
 *   2. 그 사진이 정말 이 장부의 것인지 확인한다. 남의 장부 경로를 끼워 넣어
 *      우리 권한으로 꺼내 가는 길을 막는다.
 *
 * 파일 이름에 난수가 들어 있어 한 번 만들어진 주소의 내용은 바뀌지 않는다.
 * 그래서 길게 캐시해도 되지만, 그 캐시는 **브라우저 안에만** 둔다(private).
 * 중간 서버가 들고 있다가 다른 사람에게 건네주면 판정을 한 뜻이 없어진다.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ ledgerId: string; path: string[] }> },
) {
  const { ledgerId, path } = await ctx.params;
  const key = path.join('/');

  try {
    await requireLedgerAccess(ledgerId);
  } catch (e) {
    const status = e instanceof AccessError ? 403 : 500;
    return new Response('Not allowed', { status });
  }

  if (!belongsTo(key, ledgerId)) return new Response('Not found', { status: 404 });

  const file = await readImage(key);
  if (!file) return new Response('Not found', { status: 404 });

  return new Response(file.bytes, {
    headers: {
      'content-type': file.contentType,
      'cache-control': 'private, max-age=86400',
      // 사진이 다른 곳에 박혀 돌아다니지 않게 한다.
      'x-content-type-options': 'nosniff',
    },
  });
}
