'use server';

import { requireLedgerAccess, AccessError } from '../../lib/access.ts';
import {
  loadLedger,
  aiUsageThisMonth,
  recordAiUsage,
  MONTHLY_AI_LIMIT,
} from '../../lib/db/repo.ts';
import { askAboutLedger, type AskResult, type Turn } from '../../lib/ai/ask.ts';

/**
 * 수증이에게 이 장부에 대해 묻는다 (§21.10)
 *
 * 물어볼 수 있는 사람은 그 장부에 들어와 있는 사람뿐이다. 장부의 내용이
 * 통째로 모델에 실려 나가므로, 접근 확인이 첫 줄에 있어야 한다.
 *
 * 영수증 읽기와 같은 월 상한을 함께 쓴다. 두 기능 다 같은 키로 같은 모델을
 * 부르고 그 값은 키 주인이 낸다. 한쪽에만 상한을 두면 다른 쪽으로 새어 나간다.
 */

/** 앞선 대화도 화면에서 올라오는 값이다. 갯수와 길이를 여기서 한 번 자른다. */
const MAX_TURNS = 6;
const MAX_TURN_CHARS = 1000;

function trim(history: unknown): Turn[] {
  if (!Array.isArray(history)) return [];
  return history.slice(-MAX_TURNS).map((t) => {
    const turn = t as { role?: unknown; text?: unknown };
    return {
      role: turn.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      text: String(turn.text ?? '').slice(0, MAX_TURN_CHARS),
    };
  });
}

export async function askHelper(args: {
  ledgerId: string;
  question: string;
  history: Turn[];
}): Promise<AskResult> {
  try {
    const q = args.question.trim();
    if (!q) return { ok: false, message: '무엇이 궁금한지 적어 주세요.' };
    if (q.length > 500) return { ok: false, message: '질문이 너무 깁니다.' };

    const pass = await requireLedgerAccess(args.ledgerId);

    const used = await aiUsageThisMonth(args.ledgerId);
    if (used >= MONTHLY_AI_LIMIT) {
      return {
        ok: false,
        message: `이번 달에 물어볼 수 있는 횟수를 다 썼습니다(${MONTHLY_AI_LIMIT}건). 다음 달에 다시 물어봐 주세요.`,
      };
    }

    const ledger = await loadLedger(args.ledgerId);

    const r = await askAboutLedger({
      ledger,
      meId: pass.memberId,
      question: q,
      history: trim(args.history),
    });

    // 성공이든 실패든 부른 만큼은 기록한다. 상한이 뜻을 가지려면 그래야 한다.
    if (r.usage) {
      await recordAiUsage({
        ledgerId: args.ledgerId,
        model: r.usage.model,
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
        costMicroUsd: r.usage.costMicroUsd,
        succeeded: r.ok,
      });
    }

    return r;
  } catch (e) {
    if (e instanceof AccessError) return { ok: false, message: e.message };
    return { ok: false, message: '대답하지 못했습니다.' };
  }
}
