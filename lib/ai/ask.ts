import 'server-only';
import type { Ledger } from '../domain/types.ts';
import { computeSettlement, nameOf, settledExpenseIds } from '../domain/settlement.ts';
import { formatNumber } from '../domain/money.ts';

/**
 * 장부에 대해 묻기 (§21.10)
 *
 * 도우미가 장부를 읽고 대답한다. 한 가지 규칙이 있다.
 *
 *   **숫자는 이 파일이 계산해서 넘긴다. 모델은 계산하지 않는다.**
 *
 * 정산 엔진은 검산이 되는 순수 함수다(lib/domain). 그 결과를 모델이 다시
 * 어림해서 말하면, 화면에 적힌 숫자와 도우미가 말하는 숫자가 어긋난다.
 * 장부에서 그것보다 나쁜 일은 없다. 그래서 모델에게는 이미 계산이 끝난 표를
 * 건네고, 그 표에 있는 숫자만 쓰라고 못 박는다.
 */

const MODEL = process.env.LEDGER_AI_MODEL || 'claude-sonnet-4-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

/** 너무 큰 장부는 최근 것부터 자른다. 잘랐다는 사실도 함께 알린다. */
const MAX_ROWS = 200;

export type Turn = { role: 'user' | 'assistant'; text: string };

export type AskResult = { ok: true; answer: string } | { ok: false; message: string };

/**
 * 장부를 글로 옮긴다. 화면에 있는 것과 같은 사실만 담는다.
 * 사진·영수증 파일 이름처럼 대답에 쓸모없는 것은 넣지 않는다.
 */
export function digest(ledger: Ledger, meId: string | null): string {
  const cur = ledger.currency ?? 'KRW';
  const money = (n: number) => formatNumber(n, cur, 'ko');
  const who = (id: string) => nameOf(ledger.members, id);

  const out: string[] = [];
  out.push(`장부: ${ledger.name} (팀 ${ledger.teamName}), 통화 ${cur}`);
  out.push(
    `팀원: ${ledger.members.map((m) => `${m.name}${m.id === meId ? '(=지금 묻는 사람)' : ''}`).join(', ')}`,
  );

  const settled = settledExpenseIds(ledger);
  const rows = [...ledger.expenses].sort((a, b) => (a.date < b.date ? -1 : 1));
  const shown = rows.length > MAX_ROWS ? rows.slice(-MAX_ROWS) : rows;
  if (shown.length < rows.length) {
    out.push(`(지출이 ${rows.length}건이라 최근 ${MAX_ROWS}건만 옮겼습니다)`);
  }

  out.push('', '지출 (날짜 | 항목 | 결제 | 금액 | 부담 | 상태)');
  for (const e of shown) {
    const a = e.allocation;
    const bears =
      a.type === 'all'
        ? `공동 ${e.teamMemberIds.length}인`
        : a.type === 'partial'
          ? `일부 ${a.participantIds.map(who).join('·')}`
          : `${who(a.ownerId)} 개인`;
    const extra = [
      e.vendor,
      e.category,
      e.adjustment ? (e.adjustment.kind === 'refund' ? '환불' : '보정') : '',
      e.note,
    ]
      .filter(Boolean)
      .join(' / ');
    out.push(
      `${e.date} | ${e.title} | ${who(e.payerId)} | ${money(e.amount)} | ${bears} | ` +
        `${settled.has(e.id) ? '정산 완료' : '미정산'}${extra ? ` | ${extra}` : ''}`,
    );
  }

  for (const s of ledger.settlements) {
    const snap = s.snapshot;
    out.push('', `${s.label} — ${s.date} 확정, ${snap.expenseIds.length}건 ${money(snap.totalAmount)}`);
    for (const b of snap.balances) {
      out.push(
        `  ${who(b.memberId)}: 결제 ${money(b.totalPaid)}, 부담 ${money(b.totalOwed)}, 차액 ${money(b.totalPaid - b.totalOwed)}`,
      );
    }
    for (const t of snap.transfers) {
      out.push(`  송금: ${who(t.fromMemberId)} → ${who(t.toMemberId)} ${money(t.amount)}`);
    }
  }

  const pending = ledger.expenses.filter((e) => !settled.has(e.id));
  if (pending.length) {
    const r = computeSettlement(pending, ledger.members);
    out.push('', `아직 정산하지 않은 ${pending.length}건 ${money(r.totalAmount)} (지금 정산하면)`);
    for (const b of r.balances) {
      out.push(
        `  ${who(b.memberId)}: 결제 ${money(b.totalPaid)}, 부담 ${money(b.totalOwed)}, 차액 ${money(b.totalPaid - b.totalOwed)}`,
      );
    }
    for (const t of r.transfers) {
      out.push(`  송금: ${who(t.fromMemberId)} → ${who(t.toMemberId)} ${money(t.amount)}`);
    }
  } else {
    out.push('', '아직 정산하지 않은 지출은 없습니다.');
  }

  return out.join('\n');
}

const SYSTEM = `당신은 팀 장부 옆에 서 있는 종이 영수증입니다. 이름은 "길잡이"입니다.
이 장부를 읽고, 묻는 말에 답합니다.

말투:
- 자기를 "저"라고 하고, 정중하게 말합니다. "안녕하세요, 저는 영수증이에요." 같은 투입니다.
- 조금 어리숙하고 다정하지만, 숫자 앞에서는 정확합니다.
- 스스로를 "도우미", "AI 어시스턴트" 같은 말로 소개하지 않습니다. 영수증입니다.
- 사용자가 쓰는 언어로 답합니다.

지켜야 할 것:

1. **숫자는 아래 장부에 적힌 것만 씁니다.** 더하거나 나누어 새 숫자를 만들지 마세요.
   합계나 차액이 필요하면 이미 적혀 있는 줄을 그대로 인용합니다. 적혀 있지 않은
   숫자를 물으면 "그건 장부에 계산되어 있지 않아요"라고 말하고, 어느 화면을 보면
   되는지 알려 주세요.
2. 장부에 없는 것은 지어내지 않습니다. 모르면 모른다고 합니다.
3. 짧게 답합니다. 두세 문장이면 충분하고, 여러 줄이 필요하면 줄만 나열합니다.
   요약이나 되묻기로 시작하지 마세요.
4. 사용자가 쓴 말(사람 이름, 항목 이름)은 그대로 옮겨 적습니다.
5. 돈 문제에 대해 판단하거나 훈수하지 않습니다. 누가 더 냈다든가 공평하다든가
   하는 말은 하지 않습니다. 장부에 적힌 사실만 전합니다.`;


export async function askAboutLedger(args: {
  ledger: Ledger;
  meId: string | null;
  question: string;
  history: Turn[];
}): Promise<AskResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, message: '아직 설정되지 않았습니다.' };

  const messages = [
    ...args.history.slice(-6).map((t) => ({ role: t.role, content: t.text })),
    {
      role: 'user' as const,
      content: `장부:\n\n${digest(args.ledger, args.meId)}\n\n---\n\n질문: ${args.question}`,
    },
  ];

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, system: SYSTEM, messages }),
    });
  } catch {
    return { ok: false, message: '지금은 닿지 못했습니다.' };
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    if (res.status === 401) return { ok: false, message: 'API 키가 맞지 않습니다.' };
    if (res.status === 429) return { ok: false, message: '잠시 뒤에 다시 물어봐 주세요.' };
    if (detail.includes('credit balance')) return { ok: false, message: '크레딧이 부족합니다.' };
    return { ok: false, message: '대답하지 못했습니다.' };
  }

  const body = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (body.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('')
    .trim();

  if (!text) return { ok: false, message: '대답하지 못했습니다.' };
  return { ok: true, answer: text };
}
