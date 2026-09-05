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
  /** 영수증에 찍힌 최종 결제 금액 */
  total: number;
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
        description: '위에서 옮겨 적은 것을 그대로 줄로 세운 것. 순서도 같아야 합니다.',
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
              enum: ['item', 'shared', 'discount'],
              description:
                'item = 누군가 시킨 것. shared = 배달비·배달팁·수수료·포장비처럼 ' +
                '누구의 것도 아닌 것. discount = 할인·쿠폰·포인트 사용(음수).',
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
정리하거나 고치지 말고 그냥 옮겨 적기만 하세요. 그다음에 그것을 보고
lines 를 세웁니다. 옮겨 적은 것과 lines 의 개수와 순서는 같아야 합니다.

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
- 옵션 추가금이 별도 줄로 찍혀 있으면 그 옵션이 딸린 품목의 금액에 더하지
  말고, 그대로 별도 줄로 두되 이름 앞에 어느 품목의 옵션인지 그대로 적습니다.

kind — 줄을 세 갈래로 나눕니다:
- item     누군가 시킨 것. 음식, 물건, 옵션.
- shared   배달비, 배달팁, 배달요금, 수수료, 포장비, 봉투값처럼 **아무도
           시키지 않았지만 다 같이 내야 하는 것**. 이 줄들은 뒤에서 팀원
           모두에게 나눠집니다. 놓치면 시킨 사람 한 명이 배달비를 다 냅니다.
- discount 할인, 쿠폰, 포인트 사용, 적립금 사용. **반드시 음수**로 적습니다.
           (-3000 처럼) 영수증에 '-3,000' 이나 '3,000원 할인'으로 찍힙니다.

줄로 세우면 안 되는 것 — 이것들은 lines 에 넣지 마세요:
- 소계, 상품금액 합계, 총 결제금액, 부가세 같은 **합계 줄**
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
  const lines: ReadLine[] = (Array.isArray(raw.lines) ? raw.lines : [])
    .slice(0, MAX_LINES)
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
        amount: Number.isFinite(amount) ? amount : 0,
        kind,
      };
    })
    // 이름도 금액도 없는 줄은 읽은 것이 아니다.
    .filter((l) => l.name !== '' || l.amount !== 0);

  if (lines.length === 0) {
    return { ok: false, message: '항목을 하나도 읽지 못했습니다. 직접 적어 주세요.', usage: r.usage };
  }

  /*
   * 할인 줄의 부호를 여기서 한 번 바로잡는다.
   *
   * '3,000원 할인'을 3000 으로 읽어 오는 일이 있다. 그대로 두면 할인이
   * 지출로 더해져 합이 6,000원 어긋난다. 할인이라고 스스로 말한 줄이
   * 양수인 경우는 읽기 실수지 다른 뜻일 수가 없으므로, 이것만은 고친다.
   */
  for (const l of lines) {
    if (l.kind === 'discount' && l.amount > 0) l.amount = -l.amount;
  }

  const sum = lines.reduce((a, l) => a + l.amount, 0);
  const readTotal = Math.round(Number(raw.total));
  /*
   * 총액을 못 읽었으면 줄의 합을 총액으로 삼는다. 그 경우 둘은 당연히 맞고,
   * 맞는다는 표시는 뜻이 없다 — 그래서 balanced 는 총액을 실제로 읽었을 때만
   * 뜻이 있다. 화면은 어느 쪽이든 사람에게 총액을 다시 보여 준다.
   */
  const total = Number.isFinite(readTotal) && readTotal !== 0 ? readTotal : sum;

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const date = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : undefined;

  return {
    ok: true,
    usage: r.usage,
    value: {
      read: str(raw.read) ?? '',
      lines,
      currency,
      total,
      sum,
      balanced: sum === total,
      vendor: str(raw.vendor),
      date,
      title: str(raw.title),
    },
  };
}
