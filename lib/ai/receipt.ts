import 'server-only';
import type { CurrencyCode } from '../domain/money.ts';
import { ENDPOINT, MODEL, meter, type Usage } from './usage.ts';

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
// 모델 이름과 값을 재는 자는 lib/ai/usage.ts 한 군데에 둔다.

/**
 * 여기서 끊는다. 배포 환경의 함수 실행 시간 제한(대개 10초)보다 짧아야
 * 우리가 먼저 끊고 사람 말로 알려 줄 수 있다. 제한에 먼저 걸리면 아무 말도
 * 못 하고 끊긴다.
 */
const TIMEOUT_MS = Number(process.env.LEDGER_AI_TIMEOUT_MS ?? 9000);

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

export type { Usage };

const SCHEMA = {
  name: 'receipt',
  description: '영수증 또는 결제 화면에서 읽어낸 값',
  input_schema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description:
          "무엇을 샀는지 짧게. 품목이 하나면 상품명 그대로, 여럿이면 '식사(마라탕 외 2건)' 꼴로.",
      },
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
- 배달팁·배송비·수수료가 따로 찍혀 있어도 **맨 마지막에 실제로 낸 금액**을 씁니다.
  소계(상품 금액 합)와 총 결제금액이 다르면 총 결제금액입니다.

한 장에 품목이 여럿일 때:
- 이 장부는 영수증 한 장을 한 줄로 적습니다. 금액은 그 영수증의 총액입니다.
- title 은 **'무엇(대표 품목 외 N건)'** 꼴로 씁니다.

    식사(마라탕 외 2건)
    재료(폼보드 5T 외 3건)
    출력(A0 출력 외 1건)

  앞의 낱말은 이 지출이 무엇이었는지를 한 낱말로 말한 것입니다. 영수증에
  적힌 상호와 품목을 보고 판단하세요. 음식점·배달이면 식사, 카페면 간식,
  화방·철물점이면 재료, 출력소면 출력, 택시·배송이면 이동 같은 식입니다.
  장부를 훑을 때 그 줄이 무엇이었는지 낱말 하나로 먼저 보이게 하려는 것입니다.
- 품목이 하나뿐이면 괄호를 쓰지 말고 품목 이름만 그대로 씁니다.
  '폼보드 5T 10장' 처럼요. 하나뿐인 것에 앞말을 붙이면 군더더기입니다.
- 품목을 여러 줄로 나열하지 마세요.

사진이 돌아가 있거나 기울어져 있으면:
- 글자 방향을 스스로 맞춰 읽으세요. 돌아가 있다는 이유로 비우지 마세요.
- 다만 돌아간 채로 흐려 확신이 없으면, 지어내지 말고 그 항목을 비웁니다.

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

  /*
   * 기다림에 끝을 둔다.
   *
   * 끝이 없으면 화면에는 '읽는 중'만 남는다. 사람은 그게 오래 걸리는 것인지
   * 영영 안 오는 것인지 알 수 없어서 계속 기다린다. 그러다 서버 쪽 시간 제한에
   * 먼저 걸리면 대답도 오류도 없이 끊긴다 — 가장 나쁜 끝이다.
   *
   * 그래서 우리가 먼저 끊고, 끊었다고 말한다. 손으로 적는 길은 언제나 열려 있다.
   */
  const stop = new AbortController();
  const bell = setTimeout(() => stop.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: stop.signal,
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
  } catch (e) {
    const timedOut = e instanceof Error && e.name === 'AbortError';
    return {
      ok: false,
      message: timedOut
        ? '읽는 데 너무 오래 걸립니다. 직접 적어 주세요.'
        : '분석 서버에 닿지 못했습니다. 직접 적어 주세요.',
    };
  } finally {
    clearTimeout(bell);
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

  const usage = meter(body.usage);

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
