import 'server-only';
import { ENDPOINT } from './usage.ts';

export type MessageBody = {
  content: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[];
  usage?: { input_tokens?: number; output_tokens?: number };
};

type MessageResult =
  | { ok: true; body: MessageBody }
  | { ok: false; message: string };

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** One deadline covers connection, headers and the complete response body. */
export async function requestMessage(body: Record<string, unknown>, timeoutMs: number): Promise<MessageResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, message: '아직 설정되지 않았습니다. 직접 적어 주세요.' };

  const stop = new AbortController();
  const duration = Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, 120_000) : 12_000;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<MessageResult>((resolve) => {
    timer = setTimeout(() => {
      stop.abort();
      resolve({ ok: false, message: '응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.' });
    }, duration);
  });

  const read = async (): Promise<MessageResult> => {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        signal: stop.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text();
        if (res.status === 401) return { ok: false, message: 'API 키가 맞지 않습니다.' };
        if (res.status === 429) return { ok: false, message: '잠시 뒤에 다시 시도해 주세요.' };
        if (detail.includes('credit balance')) return { ok: false, message: '크레딧이 부족합니다.' };
        return { ok: false, message: '응답을 받지 못했습니다. 다시 시도해 주세요.' };
      }
      const raw: unknown = await res.json();
      if (!object(raw) || !Array.isArray(raw.content)) {
        return { ok: false, message: '응답을 읽지 못했습니다. 다시 시도해 주세요.' };
      }
      const content: MessageBody['content'] = raw.content.filter(object).map((entry) => ({
        type: typeof entry.type === 'string' ? entry.type : '',
        text: typeof entry.text === 'string' ? entry.text : undefined,
        name: typeof entry.name === 'string' ? entry.name : undefined,
        input: object(entry.input) ? entry.input : undefined,
      }));
      const tokens = (value: unknown) =>
        typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
      const usage = object(raw.usage)
        ? { input_tokens: tokens(raw.usage.input_tokens), output_tokens: tokens(raw.usage.output_tokens) }
        : undefined;
      return { ok: true, body: { content, usage } };
    } catch {
      return {
        ok: false,
        message: stop.signal.aborted
          ? '응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.'
          : '응답을 읽지 못했습니다. 다시 시도해 주세요.',
      };
    }
  };

  try {
    // The race also bounds a body reader that fails to react to AbortSignal.
    return await Promise.race([read(), deadline]);
  } finally {
    clearTimeout(timer!);
  }
}
