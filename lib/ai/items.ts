import 'server-only';
import type { CurrencyCode } from '../domain/money.ts';
import { callTool, type ToolSchema } from './call.ts';
import { ITEM_MODEL, type Usage } from './usage.ts';

/**
 * 영수증을 줄 단위로 읽기 (§10.4)
 *
 * 같이 배달을 시키고 한 사람이 결제했을 때, 각자 시킨 것을 각자에게 청구하려면
 * 영수증 안의 **줄 하나하나**를 읽어야 한다. 총액만 읽는 것과는 다른 일이다.
 *
 * 여기서 가장 중요한 것은 정확도다. 총액은 크게 한 번 찍히고 틀리면 눈에 띄지만,
 * 열두 줄 중 한 줄이 틀리는 것은 아무도 못 본다. 그래서 이 파일은 전부 그
 * 한 가지를 위해 짜여 있다.
 *
 *   1. 더 큰 모델을 쓴다 (usage.ts 의 ITEM_MODEL). 이 자리는 기다릴 수 있다.
 *   2. 구조를 만들기 전에 **보이는 대로 옮겨 적게** 한다. read 칸이 그것이다.
 *      먼저 옮겨 적고 나서 숫자를 세우면 눈에 띄게 덜 틀린다.
 *   3. 읽어 온 합이 읽어 온 총액과 맞는지 **우리가 다시 센다.** 안 맞으면
 *      조용히 고치지 않고 안 맞는다고 말한다 (§23.3 계산은 숨기지 않는다).
 *
 * 어떤 경우에도 읽은 값이 그대로 저장되지는 않는다. 폼에 채워질 뿐이고,
 * 마지막으로 맞는지 보는 것은 언제나 사람이다.
 */

/** 총액 하나를 읽을 때보다 길게 기다린다. 이 자리는 기다릴 수 있는 자리다. */
const TIMEOUT_MS = Number(process.env.LEDGER_AI_ITEM_TIMEOUT_MS ?? 22000);

/** 한 장에서 읽어 낼 줄의 상한. 이보다 긴 영수증은 손으로 적는 편이 빠르다. */
export const MAX_LINES = 40;

export type ReadLine = {
  /** 영수증에 적힌 그대로의 이름 */
  name: string;
  /** 수량. 안 적혀 있으면 1 */
  qty: number;
  /** 이 줄에 찍힌 금액 (단가가 아니라 줄 합계) */
  amount: number;
  /**
   * 이 줄이 무엇인가.
   *   item     시킨 것 — 시킨 사람에게 청구한다
   *   shared   배달비·수수료처럼 누구의 것도 아닌 것 — 기본값이 모두 나눔이다
   *   discount 할인·쿠폰·포인트 — 음수다
   */
  kind: 'item' | 'shared' | 'discount';
};

export type ExtractedItems = {
  /** 모델이 보이는 대로 옮겨 적은 것. 어긋났을 때 어디가 어긋났는지 보려고 남긴다. */
  read: string;
  lines: ReadLine[];
  currency: CurrencyCode;
  /** 영수증 총액. 읽지 못했으면 폼에 보여 줄 품목 합계이며 totalRead가 false다. */
  total: number;
  /** 영수증의 총액을 실제로 읽었는가. 추정 합계는 검산 근거로 쓰지 않는다. */
  totalRead: boolean;
  /** 읽어 온 줄들의 합 */
  sum: number;
  /** sum 과 total 이 같은가. 다르면 화면이 그 자리에서 말한다. */
  balanced: boolean;
  vendor?: string;
  date?: string;
  title?: string;
};

export type ItemsResult =
  | { ok: true; value: ExtractedItems; usage: Usage }
  | { ok: false; message: string; usage?: Usage };

const SCHEMA: ToolSchema = {
  name: 'receipt_lines',
  description: '영수증·주문 내역에서 줄 단위로 읽어낸 값',
  input_schema: {
    type: 'object',
    // 칸의 순서가 곧 읽는 순서다. read 를 맨 앞에 두는 것은 그래서다.
    properties: {
      read: {
        type: 'string',
        description:
          '구조를 만들기 전에, 품목이 적힌 부분을 보이는 그대로 한 줄씩 옮겨 적으세요. ' +
          '수량과 금액까지 붙은 채로, 위에서 아래 순서대로. 여기서 고치거나 정리하지 마세요.',
      },
      lines: {
        type: 'array',
        description: '실제 상품, 별도로 청구된 요금, 한 번만 반영할 실제 할인을 읽은 순서대로 작성합니다. read의 합계·안내·이미 포함된 금액은 복사하지 않습니다.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '영수증에 적힌 그대로의 품목 이름' },
            qty: { type: 'number', description: '수량. 안 적혀 있으면 1.' },
            amount: {
              type: 'number',
              description:
                '이 줄에 찍힌 금액. 단가가 아니라 **줄 합계**입니다. ' +
                '단가만 찍혀 있으면 단가 × 수량을 적습니다. 통화의 최소 단위 정수.',
            },
            kind: {
              type: 'string',
              enum: ['item', 'shared', 'discount', 'summary', 'information', 'included', 'uncertain'],
              description:
                'item = 누군가 시킨 것. shared = 배달비·배달팁·수수료·포장비처럼 ' +
                '별도로 청구된 금액. discount = 현재 주문에 실제 적용되며 다른 항목 금액에는 아직 반영되지 않은 할인(음수). ' +
                'summary = 주문·결제 합계. information = 안내·예상 혜택·0원 옵션. ' +
                'included = 다른 항목 가격에 이미 포함된 옵션·할인 또는 같은 할인 합계의 반복. ' +
                'uncertain = 별도 청구/차감인지 확인할 수 없는 금액. 이 네 종류는 정산 항목에서 제외됩니다.',
            },
          },
          required: ['name', 'qty', 'amount', 'kind'],
        },
      },
      total: {
        type: 'number',
        description: "영수증에 찍힌 **최종 결제 금액**. '총 결제금액' '결제금액' '합계'로 적힌 값.",
      },
      currency: { type: 'string', enum: ['KRW', 'JPY', 'USD', 'EUR', 'GBP'] },
      vendor: { type: 'string', description: '판매처 상호. 안 보이면 비웁니다.' },
      date: { type: 'string', description: 'YYYY-MM-DD. 안 보이면 비웁니다.' },
      title: {
        type: 'string',
        description: "장부 한 줄에 적을 이름. '배달(마라탕 외 3건)' 꼴.",
      },
    },
    required: ['read', 'lines', 'total', 'currency'],
  },
};

const PROMPT = `이 이미지는 배달 주문 내역, 장바구니, 또는 영수증입니다.
여러 사람이 각자 시킨 것을 한 사람이 결제한 상황이고, 지금 그것을 각자에게
나눠 청구하려는 참입니다. **줄 하나가 사람 한 명의 부담이 됩니다.**
그래서 한 줄이라도 빠지거나 금액이 어긋나면 누군가 남의 몫을 냅니다.

먼저 read 칸에 품목이 적힌 부분을 **보이는 그대로 옮겨 적으세요.**
위에서 아래로, 한 줄씩, 수량과 금액이 붙어 있으면 붙은 채로.
read에는 확인 근거를 남기고, lines에는 실제로 나눌 항목만 세웁니다.
**read와 lines의 개수는 같을 필요가 없습니다.** read에 보이는 합계나
안내 문구를 lines에 모두 복사하지 마세요. 남기는 항목의 상대적인 순서만 유지합니다.

**글자는 한 글자도 바꾸지 마세요.**
상품명은 낯설거나 틀린 말처럼 보여도 화면에 적힌 그대로 씁니다. 뜻이 통하게
고치거나, 비슷한 발음의 다른 낱말로 바꾸거나, 띄어쓰기를 임의로 손보지
마세요. 옵션이 딸린 줄('마라탕 - 중간맛, 면 추가')은 딸린 것까지 이름에
그대로 둡니다 — 그것이 누가 시킨 것인지 알아보는 표시입니다.
흐려서 확신이 없으면 지어내지 말고 그 줄의 이름을 비웁니다.

금액 — 여기가 제일 자주 틀리는 곳입니다:
- 각 줄에는 **줄 합계**를 적습니다. 단가가 아닙니다.
- '마라탕 2개 9,000원' 처럼 단가만 찍혀 있으면 9,000 × 2 = 18,000 을 적습니다.
  수량과 금액이 나란히 있을 때, 그 금액이 단가인지 줄 합계인지 반드시
  확인하세요. 대개 오른쪽 끝의 큰 숫자가 줄 합계입니다.
- 옵션 추가금이 기본 상품 금액에 아직 포함되지 않은 실제 추가금일 때만 별도
  줄로 둡니다. 상품 가격에 이미 포함된 옵션 금액은 다시 더하지 마세요.
- 0원 옵션, 무료 서비스, 무료 배달 안내는 줄로 만들지 않습니다. 선택한 맛·크기
  같은 0원 옵션의 이름은 필요하면 원래 상품 이름에 남길 수 있습니다.

kind — 줄을 세 갈래로 나눕니다:
- item     누군가 시킨 것. 음식, 물건, 옵션.
- shared   배달비, 배달팁, 배달요금, 수수료, 포장비, 봉투값처럼 **아무도
           시키지 않았지만 다 같이 내야 하는 것**. 이 줄들은 뒤에서 팀원
           모두에게 나눠집니다. 놓치면 시킨 사람 한 명이 배달비를 다 냅니다.
           상품 가격 외에 실제로 추가 청구된 부가세·VAT도 shared입니다.
           세금이라는 이름만 보고 빼지 마세요. 상품 가격에 이미 포함된
           세금의 안내만 included 또는 information으로 제외합니다.
- discount 할인, 쿠폰, 포인트 사용, 적립금 사용. **반드시 음수**로 적습니다.
           (-3000 처럼) 영수증에 '-3,000' 이나 '3,000원 할인'으로 찍힙니다.
           단, 현재 주문에서 실제 차감되고 앞의 상품·요금에는 아직 반영되지
           않은 금액만 해당합니다. '할인세트', 구매한 '적립금 상품권'은
           상품 이름일 뿐이므로 item으로 두고 구매금액을 양수로 유지합니다.

할인을 중복해서 빼지 마세요:
- 상품 12,000 + 상품 10,000 - 즉시할인 1,000 = 결제 21,000이면
  두 상품과 -1,000 할인 한 줄을 남깁니다. 할인 표시가 양수여도 실제 차감이면 음수입니다.
- 이미 할인된 상품 가격 11,000 + 상품 10,000 = 결제 21,000이고 아래에
  '1,000원 할인받았어요'가 다시 적혔으면 그 안내는 included입니다. 또 빼지 않습니다.
- 개별 쿠폰/할인과 그 합계가 같이 나오면 개별 할인만 한 번 반영합니다.
  같은 할인 금액이 결제 요약이나 혜택 영역에 반복되었다고 추가 할인으로 만들지 않습니다.
- 개별 할인 없이 '총 할인금액 1,000'만 실제로 차감된 경우에는 그 한 줄을
  discount로 남깁니다. '합계'라는 이름만으로 유일한 실제 할인을 버리지 않습니다.
- 적립 예정, 할인 가능, 최대 혜택, 다음 주문 쿠폰, 멤버십 가입 시 혜택은
  information입니다. 현재 주문의 실제 차감액이 아닙니다.
- 별도 할인인지 이미 가격에 반영된 것인지 확인할 수 없으면 uncertain으로
  분류하거나 제외합니다. 최종 결제금액과 맞추려고 할인·차액을 만들어 내지 마세요.

줄로 세우면 안 되는 것 — 이것들은 lines 에 넣지 마세요:
- 소계, 상품금액 합계, 주문금액, 총 결제금액 같은 **합계 줄**
- 이미 상품금액에 포함된 부가세·공급가액·면세금액 안내
- 결제수단(카드명, 간편결제), 승인번호, 주소, 요청사항, 주문번호
- 매장 이름, 전화번호, 사업자번호

total 은 영수증에 찍힌 최종 결제 금액입니다. lines 의 합과 total 이 맞아야
정상입니다. 맞지 않으면 빠뜨린 줄이나 못 본 할인 줄이 있는 것이니
다시 한번 훑어보세요. 그래도 맞지 않으면 **억지로 맞추지 말고** 읽은
그대로 두세요 — 사람이 보고 고칩니다. 없는 줄을 지어내는 것이 훨씬 나쁩니다.

currency: 통화 기호를 확인하세요. ₩ ￦ 원이면 KRW, $이면 USD, ¥·엔이면 JPY.
소수점이 있는 통화는 최소 단위 정수로 바꿉니다. $49.95 → 4995.

사진이 돌아가 있거나 기울어져 있으면 글자 방향을 스스로 맞춰 읽으세요.
돌아가 있다는 이유로 비우지 마세요.`;

function compactLabel(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '').replace(/[：:]/g, '');
}

function isDiscountTotal(name: string): boolean {
  return /^(?:총할인(?:금액|액)?|할인(?:금액)?합계|할인총액|totaldiscount)(?:[₩￦$€£¥]?[\d,.]+(?:원|엔)?)?$/.test(compactLabel(name));
}

function isNonChargeLabel(name: string): boolean {
  const label = compactLabel(name);
  // Exact accounting labels, not substring matches against merchandise names.
  const summary = /^(?:소계|중간합계|합계|총액|상품(?:금액|합계|금액합계)|총상품금액|주문(?:금액|합계|금액합계)|총주문금액|결제(?:금액|합계|예정금액)|총결제(?:금액|액)?|최종결제(?:금액|액)?|받을금액|받은금액|거스름돈|공급가액|과세금액|면세금액|subtotal|grandtotal|total)(?:\([^)]*\))?(?:[₩￦$€£¥]?[\d,.]+(?:원|엔)?)?$/;
  const includedTax = /^(?:부가세|vat|tax)(?:포함(?:안내)?|안내|included|\((?:포함|안내|included)\))(?:[₩￦$€£¥]?[\d,.]+(?:원|엔)?)?$/;
  const notice = /^(?:할인안내|혜택안내|결제안내|적립안내|예상혜택|총혜택|최대혜택|할인적용가|할인후가격|최종혜택가)(?:[₩￦$€£¥]?[\d,.]+(?:원|엔)?)?$/;
  const futureBenefit = /(?:적립예정|적립예상|예상적립|할인예정|할인가능|최대할인|다음주문.*(?:쿠폰|할인)|쿠폰받기|가입시.*(?:할인|혜택))/;
  const includedBenefit = /(?:이미(?:적용|반영|포함)된?할인|할인받았(?:어요|습니다)|절약했(?:어요|습니다))/;
  return summary.test(label) || includedTax.test(label) || notice.test(label) || futureBenefit.test(label) || includedBenefit.test(label);
}

/** 이미지 한 장을 줄 단위로 읽는다. 실패해도 던지지 않고 결과로 돌려준다. */
export async function readReceiptLines(args: {
  base64: string;
  mediaType: string;
}): Promise<ItemsResult> {
  const r = await callTool({
    model: ITEM_MODEL,
    timeoutMs: TIMEOUT_MS,
    // 줄이 많으면 응답도 길어진다. 40줄짜리 영수증이 잘려서 오면 안 된다.
    maxTokens: 4096,
    tool: SCHEMA,
    prompt: PROMPT,
    base64: args.base64,
    mediaType: args.mediaType,
  });
  if (!r.ok) return r;

  const raw = r.input;
  const currency = (['KRW', 'JPY', 'USD', 'EUR', 'GBP'] as CurrencyCode[]).includes(
    raw.currency as CurrencyCode,
  )
    ? (raw.currency as CurrencyCode)
    : 'KRW';

  const kinds = ['item', 'shared', 'discount'] as const;
  const excludedKinds = new Set(['summary', 'information', 'included', 'uncertain']);
  const lines: ReadLine[] = (Array.isArray(raw.lines) ? raw.lines : [])
    .slice(0, MAX_LINES * 3)
    .filter((v) => !excludedKinds.has(String((v as Record<string, unknown> | null)?.kind)))
    .map((v) => {
      const o = (v ?? {}) as Record<string, unknown>;
      const amount = Math.round(Number(o.amount));
      const qty = Math.round(Number(o.qty));
      const kind = kinds.includes(o.kind as (typeof kinds)[number])
        ? (o.kind as ReadLine['kind'])
        : 'item';
      return {
        name: typeof o.name === 'string' ? o.name.trim() : '',
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
        amount: Number.isSafeInteger(amount) ? amount : 0,
        kind,
      };
    })
    // Clear non-charge labels are defensive checks for misclassified model output.
    // Never infer a discount from a product name containing '할인' or '적립금'.
    .filter((l) => l.amount !== 0 && !isNonChargeLabel(l.name));

  // A displayed discount total repeats its detail rows. If it is the only actual
  // discount, retain it. Do not invent a residual discount when its total differs.
  const hasDetailedDiscount = lines.some(l => l.kind === 'discount' && !isDiscountTotal(l.name));
  const seenDiscountTotals = new Set<number>();
  const selected = lines.filter(l => {
    if (l.kind !== 'discount' || !isDiscountTotal(l.name)) return true;
    const amount = Math.abs(l.amount);
    if (hasDetailedDiscount || seenDiscountTotals.has(amount)) return false;
    seenDiscountTotals.add(amount);
    return true;
  }).slice(0, MAX_LINES);

  if (selected.length === 0) {
    return { ok: false, message: '항목을 하나도 읽지 못했습니다. 직접 적어 주세요.', usage: r.usage };
  }

  /*
   * 할인 줄의 부호를 여기서 한 번 바로잡는다.
   *
   * '3,000원 할인'을 3000 으로 읽어 오는 일이 있다. 그대로 두면 할인이
   * 지출로 더해져 합이 6,000원 어긋난다. 할인이라고 스스로 말한 줄이
   * 양수인 경우는 읽기 실수지 다른 뜻일 수가 없으므로, 이것만은 고친다.
   */
  for (const l of selected) {
    if (l.kind === 'discount' && l.amount > 0) l.amount = -l.amount;
  }

  const sum = selected.reduce((a, l) => a + l.amount, 0);
  if (!Number.isSafeInteger(sum)) return { ok: false, message: '항목 금액을 확인하지 못했습니다. 직접 적어 주세요.', usage: r.usage };
  const readTotal = Math.round(Number(raw.total));
  /*
   * 총액을 못 읽었으면 줄의 합을 총액으로 삼는다. 그 경우 둘은 당연히 맞고,
   * 맞는다는 표시는 뜻이 없다 — 그래서 balanced 는 총액을 실제로 읽었을 때만
   * 뜻이 있다. 화면은 어느 쪽이든 사람에게 총액을 다시 보여 준다.
   */
  const totalRead = typeof raw.total === 'number' && Number.isSafeInteger(raw.total) && readTotal > 0;
  const total = totalRead ? readTotal : sum;

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const date = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : undefined;

  return {
    ok: true,
    usage: r.usage,
    value: {
      read: str(raw.read) ?? '',
      lines: selected,
      currency,
      total,
      totalRead,
      sum,
      balanced: totalRead && sum === total,
      vendor: str(raw.vendor),
      date,
      title: str(raw.title),
    },
  };
}
