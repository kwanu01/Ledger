import 'server-only';
import { meter, type Usage } from './usage.ts';
import { requestMessage } from './request.ts';

/**
 * 모델을 한 번 부른다 (§7)
 *
 * 영수증 읽기, 항목별 읽기, 한 줄로 적기가 다 이 자리를 쓴다. 기다림에
 * 끝을 두는 방식, 오류를 사람 말로 바꾸는 방식이 여러 벌이면 한쪽만 고쳐진다.
 *
 * 사진은 있을 수도 없을 수도 있다 — 글만 읽는 자리도 같은 문을 쓴다.
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
  /** 사람이 보낸 말. 사진이 있으면 사진 뒤에 붙는다. */
  prompt: string;
  /** 모델에게 미리 일러 두는 규칙. 없으면 prompt 하나로 간다. */
  system?: string;
  /** 사진 없이 글만 읽는 자리도 있다. */
  base64?: string;
  mediaType?: string;
}): Promise<CallResult> {
  const response = await requestMessage({
    model: args.model,
    max_tokens: args.maxTokens,
    tools: [args.tool],
    tool_choice: { type: 'tool', name: args.tool.name },
    ...(args.system ? { system: args.system } : {}),
    messages: [{
      role: 'user',
      content: args.base64
        ? [
            { type: 'image', source: { type: 'base64', media_type: args.mediaType, data: args.base64 } },
            { type: 'text', text: args.prompt },
          ]
        : args.prompt,
    }],
  }, args.timeoutMs);
  if (!response.ok) return response;
  const body = response.body;

  const usage = meter(body.usage, args.model);
  const block = body.content?.find((c) => c.type === 'tool_use' && c.name === args.tool.name);
  if (!block?.input) return { ok: false, message: '읽지 못했습니다. 직접 적어 주세요.', usage };

  return { ok: true, input: block.input, usage };
}
