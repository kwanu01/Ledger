import 'server-only';
import type { CurrencyCode } from '../domain/money.ts';
import { ENDPOINT, MODEL, meter, type Usage } from './usage.ts';

/**
 * 한 줄로 적기 (§11.4)
 *
 * "어제 호미화방에서 폼보드 2만7천, 다 같이" → 폼 한 벌.
 *
 * ── 왜 이것이 필요한가
 *
 * 기입이 밀리면 장부는 죽는다. 영수증 사진을 찍어 두는 것도 일이고, 폼의 칸
 * 여섯 개를 채우는 것도 일이다. 그런데 사람은 그 자리에서 **말로는 이미 알고
 * 있다.** 말한 것을 그대로 받아 적는 길이 있으면 미룰 이유가 줄어든다.
 *
 * ── 무엇을 하고 무엇을 안 하는가
 *
 * 하는 일은 **옮겨 적기**다. '2만7천'을 27000으로, '어제'를 날짜로, '다 같이'를
 * 부담 방식으로. 전부 사람이 이미 말한 것을 형식만 바꾸는 일이다.
 *
 * 안 하는 일은 **셈**이다. "만원씩 넷"에서 40000을 만들지 않는다. 그건 계산이고,
 * 이 장부에서 계산은 서버가 한다(lib/domain). 모델이 곱한 숫자가 조용히 장부에
 * 들어가면 검산이 무너진다. 적히지 않은 총액은 빈칸으로 둔다.
 *
 * 사람 이름도 모델이 정하지 않는다. 팀원 이름 목록을 건네고 **그 목록에 있는
 * 이름만** 돌려받은 뒤, id 로 바꾸는 일은 서버가 한다. 모델이 id 를 만들어
 * 낼 자리를 아예 두지 않는다.
 *
 * ── 저장하지 않는다
 *
 * 읽은 값은 폼에 채워질 뿐이다. 마지막으로 보는 것은 언제나 사람이다.
 * 영수증 읽기와 같은 규칙이다(§7).
 */

/** 짧은 글이고, 사람이 타자를 친 직후다. 빠른 쪽이 낫다 — 기본 모델을 쓴다. */
const TIMEOUT_MS = Number(process.env.LEDGER_AI_JOT_TIMEOUT_MS ?? 12000);

/** 한 줄로 적는 자리다. 이보다 길면 폼으로 적는 편이 빠르다. */
export const MAX_CHARS = 300;

export type Jotted = {
  title: string;
  /** 적히지 않았으면 비운다. 지어내지 않는다. */
  amount?: number;
  currency?: CurrencyCode;
  date?: string;
  vendor?: string;
  category?: string;
  /** 팀원 이름 그대로. id 로 바꾸는 일은 서버가 한다. */
  payerName?: string;
  bearers?: 'all' | 'some' | 'one';
  bearerNames?: string[];
  /** 읽어 내지 못한 것들. 화면이 "이건 직접 적어 주세요"라고 말할 근거다. */
  missing: string[];
};

export type JotResult =
  | { ok: true; value: Jotted; usage: Usage }
  | { ok: false; message: string; usage?: Usage };

function schema(names: string[]) {
  return {
    name: 'jot',
    description: '한 줄로 적은 지출을 장부의 칸으로 옮긴 것',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '무엇을 샀는지. 장부 한 줄에 적힐 이름.' },
        amount: {
          type: 'number',
          description:
            '적힌 그대로의 총액을 통화 최소 단위 정수로. 2만7천 → 27000. ' +
            '총액이 적히지 않았으면 이 칸을 비웁니다. **곱하거나 더하지 마세요.**',
        },
        currency: { type: 'string', enum: ['KRW', 'JPY', 'USD', 'EUR', 'GBP'] },
        date: { type: 'string', description: 'YYYY-MM-DD. 오늘 날짜는 아래에 적혀 있습니다.' },
        vendor: { type: 'string', description: '가게 이름. 안 적혔으면 비웁니다.' },
        category: { type: 'string', description: '분류. 적히지 않았으면 비웁니다 — 짐작하지 마세요.' },
        payerName: {
          type: 'string',
          description: `결제한 사람. 아래 팀원 이름 중 하나여야 합니다: ${names.join(', ')}. 안 적혔으면 비웁니다.`,
        },
        bearers: {
          type: 'string',
          enum: ['all', 'some', 'one'],
          description:
            "all = 팀 전체가 나눔('다 같이', '다같이 나눠'). " +
            "some = 몇 명만('나랑 현우', '현우랑 성주만'). " +
            "one = 한 사람이 가져감('내 거', '현우 개인'). 안 적혔으면 비웁니다.",
        },
        bearerNames: {
          type: 'array',
          items: { type: 'string' },
          description: `bearers 가 some 또는 one 일 때, 그 사람들의 이름. 위 팀원 목록 안의 이름만 씁니다.`,
        },
        missing: {
          type: 'array',
          items: { type: 'string', enum: ['amount', 'date', 'payer', 'bearers', 'title'] },
          description: '글에 적히지 않아 채우지 못한 칸들. 짐작해서 채우는 대신 여기 적습니다.',
        },
      },
      required: ['title', 'missing'],
    },
  };
}

function prompt(args: { today: string; names: string[]; me: string; currency: CurrencyCode }) {
  return `아래는 팀 장부에 지출 한 건을 적으려고 사람이 한 줄로 쓴 글입니다.
이것을 장부의 칸으로 옮겨 적으세요.

오늘은 ${args.today} 입니다. '어제', '지난 금요일' 같은 말은 이 날짜를 기준으로 셉니다.
이 장부의 통화는 ${args.currency} 입니다.
팀원은 이렇게 있습니다: ${args.names.join(', ')}
글을 쓴 사람은 ${args.me} 입니다. '내가', '나', '제가'는 이 사람을 뜻합니다.

지켜야 할 것:

1. **옮겨 적기만 합니다. 계산하지 마세요.**
   '2만7천' → 27000 은 옮겨 적기입니다. 표기를 숫자로 바꾼 것뿐입니다.
   '만원씩 넷' → 40000 은 계산입니다. **하지 마세요.** 총액이 글에 없으므로
   amount 를 비우고 missing 에 amount 를 넣습니다.
   '3만원 정도' 처럼 어림한 말도 그대로 30000 으로 옮기되, 사람이 확인할 것이므로
   지어내지는 마세요.

2. **적히지 않은 것은 비웁니다.** 분류가 안 적혔으면 짐작해서 '식비'를 넣지
   마세요. 가게 이름이 없으면 비웁니다. 빈 칸은 missing 에 적습니다.
   빈 칸은 사람이 채웁니다. 틀린 값이 채워져 있는 것보다 낫습니다.

3. **사람 이름은 위 목록에 있는 것만 씁니다.** 목록에 없는 이름이 나오면
   그 이름을 쓰지 말고 missing 에 payer 또는 bearers 를 넣으세요.

4. 날짜가 안 적혔으면 오늘로 둡니다. 이건 짐작이 아니라 기본값입니다 —
   사람은 대개 방금 쓴 돈을 적습니다. 다만 missing 에 date 는 넣지 않습니다.

5. title 은 무엇을 샀는지입니다. 가게 이름이 아니라 물건이나 일의 이름입니다.
   '호미화방에서 폼보드' → title 은 '폼보드', vendor 는 '호미화방'.

보기:
  "어제 호미화방에서 폼보드 2만7천, 다 같이"
  → title 폼보드 / amount 27000 / date 어제 날짜 / vendor 호미화방 /
    bearers all / missing [category]

  "점심 3만 2천 내가 냈어 현우랑 성주랑 셋이"
  → title 점심 / amount 32000 / payerName 글쓴이 / bearers some /
    bearerNames [글쓴이, 현우, 성주] / missing [vendor, category]

  "택시비"
  → title 택시비 / missing [amount, payer, bearers, ...]`;
}

export async function jot(args: {
  text: string;
  today: string;
  names: string[];
  me: string;
  currency: CurrencyCode;
}): Promise<JotResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, message: '아직 설정되지 않았습니다. 직접 적어 주세요.' };

  const tool = schema(args.names);
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
        max_tokens: 700,
        tools: [tool],
        tool_choice: { type: 'tool', name: 'jot' },
        system: prompt(args),
        messages: [{ role: 'user', content: args.text.slice(0, MAX_CHARS) }],
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
    if (res.status === 429) return { ok: false, message: '잠시 뒤에 다시 시도해 주세요.' };
    return { ok: false, message: '읽지 못했습니다. 직접 적어 주세요.' };
  }

  const body = (await res.json()) as {
    content?: { type: string; name?: string; input?: Record<string, unknown> }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const usage = meter(body.usage, MODEL);
  const raw = body.content?.find((c) => c.type === 'tool_use' && c.name === 'jot')?.input;
  if (!raw) return { ok: false, message: '읽지 못했습니다. 직접 적어 주세요.', usage };

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const amount = Math.round(Number(raw.amount));
  const bearers = (['all', 'some', 'one'] as const).includes(raw.bearers as never)
    ? (raw.bearers as Jotted['bearers'])
    : undefined;

  /* 목록에 없는 이름은 여기서 버린다. 모델이 지켰기를 믿지 않고 다시 확인한다 —
     엉뚱한 이름이 통과하면 화면은 그 이름을 못 찾아 조용히 결제자를 비운다. */
  const known = new Set(args.names);
  const names = Array.isArray(raw.bearerNames)
    ? raw.bearerNames.filter((n): n is string => typeof n === 'string' && known.has(n))
    : undefined;
  const payerName = str(raw.payerName);

  return {
    ok: true,
    usage,
    value: {
      title: str(raw.title) ?? '',
      amount: Number.isFinite(amount) && amount !== 0 ? amount : undefined,
      currency: (['KRW', 'JPY', 'USD', 'EUR', 'GBP'] as CurrencyCode[]).includes(
        raw.currency as CurrencyCode,
      )
        ? (raw.currency as CurrencyCode)
        : undefined,
      date: typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : undefined,
      vendor: str(raw.vendor),
      category: str(raw.category),
      payerName: payerName && known.has(payerName) ? payerName : undefined,
      bearers,
      bearerNames: names && names.length > 0 ? names : undefined,
      missing: Array.isArray(raw.missing)
        ? raw.missing.filter((m): m is string => typeof m === 'string')
        : [],
    },
  };
}
