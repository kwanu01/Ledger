import 'server-only';
import { callTool, type ToolSchema } from './call.ts';
import { MODEL, type Usage } from './usage.ts';
import type { IncomeKind } from '../domain/types.ts';

/**
 * 들어온 돈도 한 줄로 (§12.2)
 *
 * "현우 3월 회비 3만원" → 갈래도 낸 사람도 날짜도 채워진다.
 *
 * ── 왜 이게 있어야 하는가
 *
 * 수입을 적으려면 원래 다섯 칸을 만져야 했다. 이름, 금액, 날짜, 갈래
 * 드롭다운, 낸 사람 드롭다운. 회비는 스무 명이 내면 스무 번이다.
 * **그 다섯 번은 사람이 이미 아는 것을 기계에게 다시 알려 주는 일**이고,
 * 그건 회계 담당자가 엑셀에서 하던 바로 그 일이다. 서비스를 바꿔 봐야
 * 하는 일이 같으면 바꿀 이유가 없다.
 *
 * 갈래를 사람이 고르지 않는다는 것이 핵심이다. '회비'라고 적었으면 회비고,
 * '학과 지원금'이면 지원금이다. 그건 판단이 아니라 읽기다.
 *
 * ── 여기서도 계산은 안 한다
 *
 * "스무 명 회비 걷었어" 에서 600,000 을 만들지 않는다. 적히지 않은 총액은
 * 빈칸이다 — 영수증 읽기와 같은 규칙이다(lib/ai/jot.ts).
 */

const TIMEOUT_MS = Number(process.env.LEDGER_AI_JOT_TIMEOUT_MS ?? 12000);

export type JottedIncome = {
  title: string;
  amount?: number;
  date?: string;
  kind: IncomeKind;
  /** 회비일 때 낸 사람의 이름. id 로 바꾸는 일은 서버가 한다. */
  payerName?: string;
  missing: string[];
};

export type IncomeJotResult =
  | { ok: true; value: JottedIncome; usage: Usage }
  | { ok: false; message: string; usage?: Usage };

function schema(names: string[]): ToolSchema {
  return {
    name: 'income',
    description: '한 줄로 적은 수입을 장부의 칸으로 옮긴 것',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: "무엇으로 들어왔는지. '3월 회비', '학과 지원금' 처럼." },
        amount: {
          type: 'number',
          description:
            '적힌 그대로의 금액을 통화 최소 단위 정수로. 3만원 → 30000. ' +
            '적히지 않았으면 비웁니다. **곱하거나 더하지 마세요.**',
        },
        date: { type: 'string', description: 'YYYY-MM-DD. 오늘 날짜는 아래에 있습니다.' },
        kind: {
          type: 'string',
          enum: ['dues', 'grant', 'donation', 'carryover'],
          description:
            "dues = 회원이 내는 회비. grant = 학교·기관에서 받은 지원금·사업비. " +
            "donation = 후원, 찬조. carryover = 지난 회기에서 넘어온 이월금.",
        },
        payerName: {
          type: 'string',
          description: `회비일 때 낸 사람. 아래 이름 중 하나여야 합니다: ${names.join(', ')}. 아니면 비웁니다.`,
        },
        missing: {
          type: 'array',
          items: { type: 'string', enum: ['amount', 'payer', 'title'] },
          description: '글에 적히지 않아 채우지 못한 칸들.',
        },
      },
      required: ['title', 'kind', 'missing'],
    },
  };
}

function system(args: { today: string; names: string[]; me: string; dues: boolean }) {
  return `아래는 팀 장부에 **들어온 돈** 한 건을 적으려고 사람이 한 줄로 쓴 글입니다.
장부의 칸으로 옮겨 적으세요.

오늘은 ${args.today} 입니다. '어제', '지난주' 는 이 날짜를 기준으로 셉니다.
이 장부의 사람들: ${args.names.join(', ')}
글을 쓴 사람은 ${args.me} 입니다.
${args.dues ? '이 장부는 회비를 걷습니다.' : '이 장부는 회비를 걷지 않습니다. kind 에 dues 를 쓰지 마세요.'}

지켜야 할 것:

1. **옮겨 적기만 합니다. 계산하지 마세요.**
   '3만원' → 30000 은 옮겨 적기입니다. '스무 명이 3만원씩' → 600000 은
   계산입니다. **하지 마세요.** amount 를 비우고 missing 에 amount 를 넣습니다.

2. **갈래(kind)는 글에서 읽습니다.** '회비'라고 적혀 있으면 dues,
   '지원금'·'사업비'면 grant, '후원'·'찬조'면 donation,
   '이월'·'지난 학기에서 넘어온'이면 carryover 입니다.
   어느 쪽인지 모르겠으면 donation 이 아니라 **가장 그럴듯한 하나**를 고르되,
   사람이 확인할 것이므로 지어내지는 마세요.

3. **사람 이름은 위 목록에 있는 것만 씁니다.** 없는 이름이 나오면 그 이름을
   쓰지 말고 missing 에 payer 를 넣으세요. 회비가 아니면 payerName 은 비웁니다.

4. 날짜가 안 적혔으면 오늘로 둡니다. 이건 짐작이 아니라 기본값입니다.

5. title 은 장부에 적힐 이름입니다. 사람 이름을 title 에 넣지 마세요 —
   그건 payerName 자리입니다.

보기:
  "현우 3월 회비 3만원"
  → title '3월 회비' / amount 30000 / kind dues / payerName 현우

  "학과에서 지원금 20만원 들어옴"
  → title '학과 지원금' / amount 200000 / kind grant / missing []

  "지난 학기 남은 돈 4만7천 넘어왔어"
  → title '지난 학기 이월' / amount 47000 / kind carryover`;
}

export async function jotIncome(args: {
  text: string;
  today: string;
  names: string[];
  me: string;
  /** 회비를 걷는 장부인가. 아니면 dues 갈래를 아예 쓰지 않는다. */
  dues: boolean;
}): Promise<IncomeJotResult> {
  const r = await callTool({
    model: MODEL,
    timeoutMs: TIMEOUT_MS,
    maxTokens: 500,
    tool: schema(args.names),
    system: system(args),
    prompt: args.text.slice(0, 300),
  });
  if (!r.ok) return r;

  const raw = r.input;
  const kinds: IncomeKind[] = ['dues', 'grant', 'donation', 'carryover'];
  const kind = kinds.includes(raw.kind as IncomeKind) ? (raw.kind as IncomeKind) : 'donation';
  const amount = Math.round(Number(raw.amount));
  const known = new Set(args.names);
  const payerName = typeof raw.payerName === 'string' ? raw.payerName.trim() : '';

  return {
    ok: true,
    usage: r.usage,
    value: {
      title: typeof raw.title === 'string' ? raw.title.trim() : '',
      amount: Number.isFinite(amount) && amount !== 0 ? amount : undefined,
      date:
        typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : undefined,
      // 회비를 안 걷는 장부에 dues 가 오면 우리가 되돌린다. 모델을 믿지 않는다.
      kind: !args.dues && kind === 'dues' ? 'donation' : kind,
      payerName: kind === 'dues' && known.has(payerName) ? payerName : undefined,
      missing: Array.isArray(raw.missing)
        ? raw.missing.filter((m): m is string => typeof m === 'string')
        : [],
    },
  };
}
