import 'server-only';
import { callTool, type ToolSchema } from './call.ts';
import { MODEL, type Usage } from './usage.ts';

/**
 * 말 대신 써 주기 (§15.2)
 *
 * 팀 회계에서 진짜 고통은 계산이 아니라 **말 꺼내기**다. 32,500원을 세는 데
 * 걸리는 시간보다, "야 그거 좀…"을 어떻게 시작할지 정하는 데 걸리는 시간이
 * 길다. 그래서 다들 미루고, 미루면 더 어려워지고, 결국 낸 사람이 삼킨다.
 *
 * 수증이는 처음부터 "돈 얘기는 미루면 더 어려워져요"라고 말해 왔다.
 * 그 말이 약속한 기능이 이것이다.
 *
 * ── ask.ts 와 무엇이 다른가
 *
 * ask.ts 는 **묻는 사람에게 답한다** — 장부를 읽고 "내가 얼마 내야 해?"에
 * 대답하는 자리다. 이 파일은 **다른 사람에게 보낼 말을 쓴다.** 읽는 사람이
 * 다르고, 그래서 지켜야 할 것도 다르다. 한 파일에 두면 말투 규칙이 섞인다.
 *
 * ── 여기서도 계산은 안 한다
 *
 * 금액은 **서버가 세어서 넘긴 것을 글자로 옮겨 적을 뿐**이다. 모델이
 * 더하거나 나누는 자리는 없다. 이름도 받은 것만 쓴다.
 * (lib/ai/jot.ts 와 같은 규칙 — 돈을 나누는 숫자는 모델을 거치지 않는다)
 *
 * ── 왜 문장을 저장하지 않는가
 *
 * 한 번 쓰고 보내는 말이다. 남겨 두면 "지난번에 뭐라고 보냈더라"를 되짚는
 * 자리가 생기는데, 그건 장부가 할 일이 아니다. 만들어서 보여 주고, 사람이
 * 고쳐서 보내면 끝이다.
 *
 * ── 부드럽게, 그러나 흐리지 않게
 *
 * 독촉이 너무 부드러우면 무슨 말인지 모르고 넘어가고, 너무 세면 관계가
 * 상한다. 규칙은 하나다 — **금액과 무엇 때문인지는 또렷하게, 재촉하는 말은
 * 짧게.** 사과하지 않는다. 받을 돈을 받는 일에 사과할 것이 없고, 사과로
 * 시작하는 문장은 받는 사람을 더 불편하게 만든다.
 */

const TIMEOUT_MS = Number(process.env.LEDGER_AI_JOT_TIMEOUT_MS ?? 12000);

/** 무엇 때문에 보내는 말인가 */
export type SayWhy = 'transfer' | 'dues';

export type SayResult =
  | { ok: true; value: { text: string }; usage: Usage }
  | { ok: false; message: string; usage?: Usage };

const schema: ToolSchema = {
  name: 'message',
  description: '보낼 사람에게 그대로 붙여 넣을 수 있는 짧은 메시지',
  input_schema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description:
          '두세 문장. 인사 한 마디, 무엇 때문인지와 금액, 부탁 한 마디. ' +
          '금액은 주어진 그대로 적습니다. 계산하지 마세요.',
      },
    },
    required: ['text'],
  },
};

function system(args: {
  team: string;
  from: string;
  to: string;
  amount: string;
  why: SayWhy;
  what: string;
  warm: boolean;
  lang: string;
}) {
  return `${args.from} 님이 ${args.to} 님에게 보낼 짧은 메시지를 대신 써 주세요.
'${args.team}' 팀의 장부에서 나온 말입니다.

${
    args.why === 'dues'
      ? `${args.to} 님이 아직 안 낸 회비가 ${args.amount} 있습니다.`
      : `${args.to} 님이 ${args.from} 님에게 보낼 정산 금액이 ${args.amount} 있습니다.`
  }
무엇 때문인지: ${args.what}

${args.lang} 로 씁니다.

지켜야 할 것:

1. **금액은 위에 적힌 그대로 씁니다.** 더하거나 나누거나 반올림하지 마세요.
   ${args.amount} 를 그대로 옮겨 적습니다. 다른 숫자를 지어내지 마세요.

2. **이름도 위에 적힌 그대로 씁니다.** 없는 사람을 만들지 마세요.

3. **두세 문장.** 길면 안 읽힙니다. 인사 한 마디, 금액과 이유, 부탁 한 마디.

4. **사과하지 않습니다.** "미안한데", "죄송하지만"으로 시작하지 마세요.
   받을 돈을 받는 일이라 사과할 것이 없고, 사과로 시작하면 받는 사람이 더
   불편해집니다.

5. **재촉하는 말은 짧게.** "언제까지"를 못 박지 마세요 — 그건 사람이 정할
   일입니다. "확인해 주세요" 정도면 충분합니다.

6. 계좌번호나 주소를 지어내지 마세요. 없는 것은 안 씁니다.

7. 말투는 ${args.warm ? '친한 사이의 편한 말' : '정중한 존댓말'} 입니다.

보기(정중, 정산):
  "안녕하세요. 지난 MT 정산 32,500원 확인 부탁드립니다. 보내주시면 장부에 표시해 둘게요."

보기(편하게, 회비):
  "3월 회비 30,000원 아직 안 들어왔더라. 시간 될 때 한 번만 확인해 줘!"`;
}

export async function sayFor(args: {
  team: string;
  from: string;
  to: string;
  /** 사람이 읽는 형태로 이미 다듬어진 금액. 서버가 만든 것을 그대로 넘긴다. */
  amount: string;
  why: SayWhy;
  /** 무엇 때문인지 한 마디 — '2차 정산', '3월 회비' */
  what: string;
  /** 반말로 쓸 것인가 */
  warm: boolean;
  /** 어느 말로 쓸 것인가 — 사람이 읽는 언어 이름 */
  lang: string;
}): Promise<SayResult> {
  const r = await callTool({
    model: MODEL,
    timeoutMs: TIMEOUT_MS,
    maxTokens: 400,
    tool: schema,
    system: system(args),
    prompt: '위 규칙대로 메시지를 써 주세요.',
  });
  if (!r.ok) return r;

  const text = typeof r.input.text === 'string' ? r.input.text.trim() : '';
  if (!text) return { ok: false, message: '문장을 만들지 못했습니다.', usage: r.usage };
  return { ok: true, usage: r.usage, value: { text } };
}
