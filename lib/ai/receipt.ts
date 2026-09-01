import 'server-only';
import type { CurrencyCode } from '../domain/money.ts';

/**
 * 영수증 읽기 (§7, §18.4)
 *
 * 이미지에서 항목·금액·통화·날짜·판매처·분류를 뽑는다. 뽑은 값은 그대로 저장되지
 * 않고 폼에 채워질 뿐이다. 마지막으로 맞는지 보는 것은 언제나 사람이다.
 *
 * 통화를 함께 읽는 이유는, 해외 결제 화면을 올렸을 때 47,500을 원화로 읽으면
 * 장부가 통째로 틀어지기 때문이다. 한국어 영수증이면 대개 원화지만 대개가 늘은 아니다.
 */

/**
 * 기본값이 Sonnet인 이유: 한국어 상품명을 정확히 옮겨 적는 일에서 작은 모델은
 * '패리시 팬츠'를 '파리시 펜츠'로 바꿔 놓는다. 장부에 남는 이름이 틀리면
 * 나중에 그 줄이 무엇이었는지 알 수 없게 된다. 한 건에 십몇 원 더 드는 대신
 * 이름이 맞는 쪽을 고른다. 비용을 줄이려면 LEDGER_AI_MODEL 로 바꿀 수 있다.
 */
const MODEL = process.env.LEDGER_AI_MODEL || 'claude-sonnet-4-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

// 1M 토큰당 USD. 100만분의 1달러 단위 정수로 센다.
const PRICES: Record<string, [number, number]> = {
  'claude-sonnet-4-5': [3_000_000, 15_000_000],
  'claude-haiku-4-5': [1_000_000, 5_000_000],
};
const [IN_PER_MTOK, OUT_PER_MTOK] = PRICES[MODEL] ?? PRICES['claude-sonnet-4-5'];

export type Extracted = {
  title: string;
  amount: number; // 해당 통화의 최소 단위 정수
  currency: CurrencyCode;
  date?: string;
  vendor?: string;
  category?: string;
};

export type ExtractResult =
  | { ok: true; value: Extracted; fields: string[]; usage: Usage }
  | { ok: false; message: string; usage?: Usage };

export type Usage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
};

const SCHEMA = {
  name: 'receipt',
  description: '영수증 또는 결제 화면에서 읽어낸 값',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '무엇을 샀는지. 상품명 위주로 짧게.' },
      amount: {
        type: 'number',
        description:
          '최종 결제 금액. 통화의 최소 단위 정수. 원·엔은 그대로(12000), 달러·유로·파운드는 센트 단위(4995 = $49.95).',
      },
      currency: { type: 'string', enum: ['KRW', 'JPY', 'USD', 'EUR', 'GBP'] },
      date: { type: 'string', description: 'YYYY-MM-DD. 안 보이면 비운다.' },
      vendor: { type: 'string', description: '판매처 상호. 안 보이면 비운다.' },
      category: {
        type: 'string',
        description: '재료비·제작비·출력비·운반비·식비·기타 중 하나로 짐작해서.',
      },
    },
    required: ['title', 'amount', 'currency'],
  },
} as const;

const PROMPT = `이 이미지는 영수증, 결제 완료 화면, 주문 내역, 또는 이체 내역입니다.
보이는 그대로 읽어 receipt 도구로 넘기세요.

**글자는 한 글자도 바꾸지 말고 그대로 옮겨 적으세요.**
이것이 가장 중요합니다. 상품명과 상호는 낯설거나 틀린 말처럼 보여도
화면에 적힌 그대로 씁니다. 뜻이 통하게 고치거나, 비슷한 발음의 다른 낱말로
바꾸거나, 띄어쓰기를 임의로 손보지 마세요. 브랜드명·모델명·색상명은 특히
그렇습니다. 흐려서 확신이 없는 글자가 있으면 그 항목 전체를 비워 두세요.
지어낸 이름은 틀린 이름보다 나쁩니다.

title(항목 이름):
- 무엇을 샀는지 적힌 줄을 그대로 씁니다. 보통 '결제상품', '주문상품',
  '상품명' 아래에 있는 줄입니다.
- 상호명, 결제수단, '결제완료' 같은 상태 표시를 상품명으로 착각하지 마세요.
- 수량이나 옵션이 상품명 줄에 같이 있으면 상품명만 남깁니다.

amount(금액):
- 실제로 결제된 최종 금액입니다. 정가, 부가세 전 금액, 할인 전 금액이 아닙니다.
- '총 결제금액', '결제금액', '합계'로 적힌 값을 씁니다.

currency(통화):
- 통화 기호를 반드시 확인하세요. ₩ ￦ 원이면 KRW, $이면 USD, ¥이나 엔이면 JPY.
  숫자만 보고 원화라고 단정하지 마세요.
- 소수점이 있는 통화는 최소 단위 정수로 바꿔서 넘기세요. $49.95 → 4995.

vendor(판매처):
- 물건을 판 곳의 상호를 그대로. (주), 주식회사 같은 표기도 그대로 둡니다.
- 결제대행사(나이스페이먼츠, 토스페이먼츠 등)는 판매처가 아닙니다.

date(날짜):
- 결제한 날. YYYY-MM-DD. 안 보이면 비웁니다.

안 보이는 항목은 비워 두세요.`;

/** 이미지 한 장을 읽는다. 실패해도 던지지 않고 결과로 돌려준다. */
export async function readReceipt(args: {
  base64: string;
  mediaType: string;
}): Promise<ExtractResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, message: '영수증 분석이 아직 설정되지 않았습니다. 직접 적어 주세요.' };

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        tools: [SCHEMA],
        tool_choice: { type: 'tool', name: 'receipt' },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: args.mediaType, data: args.base64 } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      }),
    });
  } catch {
    return { ok: false, message: '분석 서버에 닿지 못했습니다. 직접 적어 주세요.' };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (res.status === 401) return { ok: false, message: 'API 키가 맞지 않습니다.' };
    if (res.status === 429) return { ok: false, message: '잠시 뒤에 다시 시도해 주세요.' };
    if (detail.includes('credit balance')) {
      return { ok: false, message: '크레딧이 부족합니다. 직접 적어 주세요.' };
    }
    return { ok: false, message: '읽지 못했습니다. 직접 적어 주세요.' };
  }

  const body = (await res.json()) as {
    content?: { type: string; name?: string; input?: Record<string, unknown> }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const inputTokens = body.usage?.input_tokens ?? 0;
  const outputTokens = body.usage?.output_tokens ?? 0;
  const usage: Usage = {
    model: MODEL,
    inputTokens,
    outputTokens,
    // 정수 산술만 쓴다. 돈을 부동소수점으로 세지 않는다는 규칙은 여기에도 적용된다.
    costMicroUsd: Math.round(
      (inputTokens * IN_PER_MTOK) / 1_000_000 + (outputTokens * OUT_PER_MTOK) / 1_000_000,
    ),
  };

  const block = body.content?.find((c) => c.type === 'tool_use' && c.name === 'receipt');
  if (!block?.input) return { ok: false, message: '읽지 못했습니다. 직접 적어 주세요.', usage };

  const raw = block.input as Record<string, unknown>;
  const amount = Math.round(Number(raw.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, message: '금액을 읽지 못했습니다. 직접 적어 주세요.', usage };
  }

  const currency = (['KRW', 'JPY', 'USD', 'EUR', 'GBP'] as CurrencyCode[]).includes(
    raw.currency as CurrencyCode,
  )
    ? (raw.currency as CurrencyCode)
    : 'KRW';

  const date = typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : undefined;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

  const value: Extracted = {
    title: str(raw.title) ?? '',
    amount,
    currency,
    date,
    vendor: str(raw.vendor),
    category: str(raw.category),
  };

  // 어느 칸이 AI가 채운 것인지 표시해 두면, 사용자가 무엇을 확인해야 하는지 알 수 있다.
  const fields = Object.entries(value)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k]) => k);

  return { ok: true, value, fields, usage };
}
