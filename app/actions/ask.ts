'use server';

import { requireLedgerAccess, AccessError } from '../../lib/access.ts';
import { loadLedger } from '../../lib/db/repo.ts';
import { askAboutLedger, type AskResult, type Turn } from '../../lib/ai/ask.ts';

/**
 * 도우미에게 이 장부에 대해 묻는다 (§21.10)
 *
 * 물어볼 수 있는 사람은 그 장부에 들어와 있는 사람뿐이다. 장부의 내용이
 * 통째로 모델에 실려 나가므로, 접근 확인이 첫 줄에 있어야 한다.
 */
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
    const ledger = await loadLedger(args.ledgerId);

    return askAboutLedger({
      ledger,
      meId: pass.memberId,
      question: q,
      history: args.history ?? [],
    });
  } catch (e) {
    if (e instanceof AccessError) return { ok: false, message: e.message };
    return { ok: false, message: '대답하지 못했습니다.' };
  }
}
