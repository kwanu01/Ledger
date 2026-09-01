import 'server-only';

/**
 * 부른 만큼 세기 (§7, §21.10)
 *
 * 영수증 읽기와 장부 질문은 둘 다 같은 모델을 부르고, 그 비용은 키 주인이 낸다.
 * 그래서 두 곳 모두 같은 자로 재야 한다. 재는 자가 두 벌이면 한쪽만 고쳐지고
 * 상한이 조용히 어긋난다.
 *
 * 돈은 정수로만 센다. 100만분의 1달러 단위다.
 */

export const MODEL = process.env.LEDGER_AI_MODEL || 'claude-sonnet-4-5';
export const ENDPOINT = 'https://api.anthropic.com/v1/messages';

/** 1M 토큰당 USD를 100만분의 1달러 정수로 적은 것. */
const PRICES: Record<string, [number, number]> = {
  'claude-sonnet-4-5': [3_000_000, 15_000_000],
  'claude-haiku-4-5': [1_000_000, 5_000_000],
};
const [IN_PER_MTOK, OUT_PER_MTOK] = PRICES[MODEL] ?? PRICES['claude-sonnet-4-5'];

export type Usage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
};

/** 응답에 실려 온 토큰 수를 사용량 한 줄로 만든다. */
export function meter(raw: { input_tokens?: number; output_tokens?: number } | undefined): Usage {
  const inputTokens = raw?.input_tokens ?? 0;
  const outputTokens = raw?.output_tokens ?? 0;
  return {
    model: MODEL,
    inputTokens,
    outputTokens,
    costMicroUsd: Math.round(
      (inputTokens * IN_PER_MTOK) / 1_000_000 + (outputTokens * OUT_PER_MTOK) / 1_000_000,
    ),
  };
}
