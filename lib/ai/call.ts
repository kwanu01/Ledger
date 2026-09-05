import 'server-only';
import { ENDPOINT, meter, type Usage } from './usage.ts';

/**
 * 모델을 한 번 부른다 (§7)
 *
 * 영수증 읽기와 항목별 읽기가 같은 자리를 쓴다. 기다림에 끝을 두는 방식,
 * 오류를 사람 말로 바꾸는 방식이 두 벌이면 한쪽만 고쳐진다.
 *
 * 실패해도 던지지 않는다. 이 자리에서 실패는 흔한 일이고, 흔한 일은
 * 예외가 아니라 결과여야 한다. 어느 쪽이든 손으로 적는 길은 열려 있다.
 */

export type ToolSchema = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type CallResult =
  | { ok: true; input: Record<string, unknown>; usage: Usage }
  | { ok: false; message: string; usage?: Usage };

export async function callTool(args: {
  model: string;
  /** 이 시간이 지나면 우리가 먼저 끊고, 끊었다고 말한다. */
  timeoutMs: number;
  maxTokens: number;
  tool: ToolSchema;
  prompt: string;
  base64: string;
  mediaType: string;
}): Promise<CallResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { ok: false, message: '영수증 분석이 아직 설정되지 않았습니다. 직접 적어 주세요.' };
  }

  const stop = new AbortController();
  const bell = setTimeout(() => stop.abort(), args.timeoutMs);

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
        model: args.model,
        max_tokens: args.maxTokens,
        tools: [args.tool],
        tool_choice: { type: 'tool', name: args.tool.name },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: args.mediaType, data: args.base64 },
              },
              { type: 'text', text: args.prompt },
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

  const usage = meter(body.usage, args.model);
  const block = body.content?.find((c) => c.type === 'tool_use' && c.name === args.tool.name);
  if (!block?.input) return { ok: false, message: '읽지 못했습니다. 직접 적어 주세요.', usage };

  return { ok: true, input: block.input, usage };
}
