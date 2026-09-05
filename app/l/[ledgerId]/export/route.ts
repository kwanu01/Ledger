import { requireLedgerAccess, AccessError } from '../../../../lib/access.ts';
import { loadLedger } from '../../../../lib/db/repo.ts';
import { getLang } from '../../../../lib/lang.ts';
import { expensesCsv, incomesCsv, fileName } from '../../../../lib/domain/csv.ts';
import { usesFund } from '../../../../lib/domain/closing.ts';

/**
 * 내보내기 (§16)
 *
 * 서버 액션이 아니라 **경로**인 이유는, 이것이 화면이 아니라 파일이기
 * 때문이다. 브라우저가 직접 받으면 이름이 붙은 진짜 내려받기가 되고,
 * 사파리의 내려받기 목록에도 남는다. 액션으로 문자열을 받아 Blob 을 만들면
 * 그 두 가지가 다 안 된다.
 *
 * ── 사진 경로와 같은 문
 *
 * 접근 확인이 첫 줄이다(lib/access.ts). 주소만 알면 남의 장부를 통째로
 * 내려받을 수 있게 두면, 지금까지 화면에 걸어 둔 모든 판정이 무의미해진다.
 *
 * ── 캐시하지 않는다
 *
 * 장부는 계속 바뀌고, 무엇보다 이 응답에는 그 팀의 지출이 통째로 들어 있다.
 * 중간 어디에도 남으면 안 된다.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ ledgerId: string }> },
) {
  const { ledgerId } = await params;
  try {
    await requireLedgerAccess(ledgerId);
    const [ledger, lang] = await Promise.all([loadLedger(ledgerId), getLang()]);

    const what = new URL(req.url).searchParams.get('what') === 'incomes' ? 'incomes' : 'expenses';
    // 각자 결제하는 장부에는 들어온 돈이 없다. 빈 파일을 주는 대신 막는다.
    if (what === 'incomes' && !usesFund(ledger)) {
      return new Response('이 장부에는 들어온 돈이 없습니다.', { status: 404 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const body = what === 'incomes' ? incomesCsv(ledger, lang) : expensesCsv(ledger, lang);
    const name = fileName(ledger, what, today);

    return new Response(body, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        /*
         * 이름을 두 벌로 적는다. 옛 브라우저는 filename= 만 읽고 한글을
         * 못 받으므로 로마자 이름을 주고, 요즘 브라우저는 filename*= 의
         * UTF-8 이름을 쓴다. 한 벌만 적으면 한쪽이 깨진다 (RFC 5987).
         */
        'content-disposition':
          `attachment; filename="ledger-${what}-${today}.csv"; ` +
          `filename*=UTF-8''${encodeURIComponent(name)}`,
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof AccessError) return new Response(e.message, { status: 403 });
    return new Response('내보내지 못했습니다.', { status: 500 });
  }
}
