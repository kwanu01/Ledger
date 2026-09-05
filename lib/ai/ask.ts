import 'server-only';
import type { Ledger } from '../domain/types.ts';
import { computeSettlement, nameOf, settledExpenseIds } from '../domain/settlement.ts';
import { collectsDues, duesBoard, fundBook, usesFund } from '../domain/closing.ts';
import { formatNumber } from '../domain/money.ts';
import { ENDPOINT, MODEL, meter, type Usage } from './usage.ts';

/**
 * 장부에 대해 묻기 (§21.10)
 *
 * 수증이가 장부를 읽고 대답한다. 한 가지 규칙이 있다.
 *
 *   **숫자는 이 파일이 계산해서 넘긴다. 모델은 계산하지 않는다.**
 *
 * 정산 엔진은 검산이 되는 순수 함수다(lib/domain). 그 결과를 모델이 다시
 * 어림해서 말하면, 화면에 적힌 숫자와 수증이가 말하는 숫자가 어긋난다.
 * 장부에서 그것보다 나쁜 일은 없다. 그래서 모델에게는 이미 계산이 끝난 표를
 * 건네고, 그 표에 있는 숫자만 쓰라고 못 박는다.
 */

/** 너무 큰 장부는 최근 것부터 자른다. 잘랐다는 사실도 함께 알린다. */
const MAX_ROWS = 200;

/**
 * 앞선 대화는 여섯 마디까지, 한 마디는 1000자까지만 싣는다.
 *
 * 앞선 대화는 화면에서 올라오는 값이라 얼마든지 길어질 수 있다. 길이를 재지
 * 않으면 한 번 부르는 값이 부르는 쪽 마음대로 커진다. 그 값은 키 주인이 낸다.
 */
const MAX_TURNS = 6;
const MAX_TURN_CHARS = 1000;

export type Turn = { role: 'user' | 'assistant'; text: string };

export type AskResult =
  | { ok: true; answer: string; usage: Usage }
  | { ok: false; message: string; usage?: Usage };

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

  /*
   * 공금을 쓰는 장부면 결산도 함께 옮긴다 (§12).
   *
   * "얼마 남았어?"는 동아리 장부에서 제일 자주 나오는 물음인데, 그 답은
   * 정산이 아니라 결산에 있다. 숫자는 여기서 계산해 넘긴다 — 모델은
   * 언제나처럼 세지 않는다.
   */
  if (usesFund(ledger)) {
    const b = fundBook(ledger);
    out.push(
      '',
      `공금 결산 — 시작 잔고 ${money(b.carriedIn)} + 들어온 돈 ${money(b.received)} ` +
        `− 공금 지출 ${money(b.spent)} = 남은 돈 ${money(b.left)}`,
    );
    if (ledger.closedAt) out.push('  이 회기는 닫혀 있습니다.');
    for (const k of b.byKind) {
      out.push(`  ${k.kind}: ${money(k.amount)} (${k.count}건)`);
    }
    if (collectsDues(ledger) && ledger.duesPerHead) {
      out.push(`  1인당 회비 ${money(ledger.duesPerHead)}`);
      for (const r of duesBoard(ledger, ledger.members)) {
        out.push(
          `  ${who(r.memberId)}: 낸 돈 ${money(r.paid)}` +
            (r.short > 0 ? `, 모자란 돈 ${money(r.short)}` : ', 다 냄'),
        );
      }
    }
  }

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
          : a.type === 'items'
            ? `항목별 ${a.lines.length}개`
            : a.type === 'common'
              ? '공금 (정산 대상 아님)'
              : `${who(a.ownerId)} 개인`;

    /*
     * 항목별 지출은 줄까지 옮긴다 (§10.4)
     *
     * "내가 얼마 내야 해?"는 이 장부에서 가장 자주 나오는 물음이고, 항목별
     * 지출에서 그 답은 줄 안에 있다. 줄을 빼고 총액만 주면 도우미는
     * 총액을 인원수로 나눈 틀린 답을 하게 된다.
     *
     * 다만 스무 줄짜리 영수증이 몇 건 있으면 옮길 것이 금세 불어난다.
     * 앞의 몇 줄만 옮기고 나머지는 몇 줄이 더 있다고 적는다.
     */
    const LINES_SHOWN = 12;
    const lineNote =
      a.type === 'items'
        ? a.lines
            .slice(0, LINES_SHOWN)
            .map((l) => `${l.name} ${money(l.amount)} → ${l.memberIds.map(who).join('·')}`)
            .join(', ') +
          (a.lines.length > LINES_SHOWN ? ` 외 ${a.lines.length - LINES_SHOWN}줄` : '')
        : '';

    const extra = [
      e.vendor,
      e.category,
      // 묶음은 "MT 때 얼마 썼지" 같은 물음의 답이 걸린 자리다 (§11.3).
      e.group ? `묶음: ${e.group}` : '',
      lineNote,
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

const SYSTEM = `당신은 팀 장부 옆에 서 있는 종이 영수증입니다. 이름은 "수증이"입니다.
이 장부를 읽고, 묻는 말에 답합니다.

말투:
- 자기를 "저"라고 하고, 정중하게 말합니다. "안녕하세요, 저는 수증이예요." 같은 투입니다.
- 이름을 물으면 수증이라고 답합니다. 영수증에서 온 이름입니다.
- **'수증이'는 한국어에서만 쓰는 이름입니다.** 다른 언어로 말할 때는 이름을
  소리 나는 대로 옮기지 말고, 그 말의 '영수증'에 해당하는 낱말을 씁니다.
  영어면 a receipt, 일본어면 レシート, 중국어면 收据, 스페인어면 un recibo,
  베트남어면 một tờ hóa đơn 입니다.
- 조금 어리숙하고 다정하지만, 숫자 앞에서는 정확합니다.
- 스스로를 "도우미", "AI 어시스턴트", "길잡이" 같은 말로 소개하지 않습니다. 수증이입니다.
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


/**
 * 장부 밖에서 묻는 말 (§21.10)
 *
 * 첫 화면과 로그인 화면에도 묻는 창이 열린다. 그 자리에는 장부가 없다.
 *
 * 그래서 **장부 내용을 아예 싣지 않는다.** 서비스가 무엇인지, 어떻게 쓰는지,
 * 정산이 어떻게 계산되는지까지만 안다. 남의 장부는커녕 자기 장부도 못 본다 —
 * 로그인하지 않은 사람도 여는 자리라서, 실을 것이 있으면 그것부터 새어 나간다.
 *
 * 모르는 것은 모른다고 하게 둔다. 여기서 지어낸 말은 아직 아무것도 안 써 본
 * 사람이 처음 듣는 말이 된다.
 */
const OPEN_SYSTEM = `당신은 'Ledger'라는 팀 장부 서비스 옆에 서 있는 종이 영수증입니다. 이름은 "수증이"입니다.
아직 장부를 열지 않은 사람에게 이 서비스를 안내합니다.

말투:
- 자기를 "저"라고 하고, 정중하게 말합니다. "안녕하세요, 저는 수증이예요." 같은 투입니다.
- **'수증이'는 한국어에서만 쓰는 이름입니다.** 다른 언어로 말할 때는 그 말의
  '영수증'에 해당하는 낱말을 씁니다 — 영어면 a receipt, 일본어면 レシート,
  중국어면 收据, 스페인어면 un recibo, 베트남어면 một tờ hóa đơn 입니다.
- 조금 어리숙하고 다정합니다. 짧게 답합니다. 두세 문장이면 충분합니다.
- 사용자가 쓰는 언어로 답합니다.

이 서비스가 하는 일:
- 팀이 함께 쓴 돈을 한 장부에 모읍니다. 팀플·동아리·여행처럼 여러 번 사고
  나중에 한꺼번에 나누는 자리를 위한 것입니다.
- 지출마다 누가 냈는지와 누가 나눠 내는지를 적습니다. 나누는 방식은 다섯입니다 —
  팀 전체 공동, 일부만, 한 사람이 가져감, 항목별로 나눠 청구, 그리고 공금에서.
- 장부를 만들 때 돈이 어디서 오는지 고릅니다. 각자 결제하고 나중에 나누는
  장부(팀플), 회비를 모아서 쓰는 장부(동아리·학회), 정해진 예산 안에서 쓰는
  장부(지원금) 셋입니다.
- 회비나 지원금을 쓰는 장부에는 '들어온 돈' 자리가 생깁니다. 이월금 + 수입 −
  공금 지출 = 남은 돈으로 결산이 나오고, 회비는 누가 얼마나 냈고 얼마가
  모자란지 셉니다. 회기를 닫으면 그 회기의 숫자가 고정됩니다.
- **정산과 결산은 다른 계산입니다.** 정산은 사람 사이에 오갈 돈이고, 결산은
  한 주머니의 잔고입니다. 공금에서 나간 지출은 정산에 들어가지 않습니다.
- 항목별 청구는 같이 배달을 시키고 한 사람이 결제했을 때 씁니다. 영수증
  사진을 읽어 품목을 줄줄이 뽑아 주고, 줄마다 누가 시켰는지 고르면 됩니다.
  배달비처럼 아무도 시키지 않은 항목은 모두로 두면 똑같이 나뉩니다.
- 지출에 '1차 MT', '중간발표' 같은 묶음 이름을 붙일 수 있습니다. 장부를
  묶음·달·분류·결제자 기준으로 접어 소계를 볼 수 있습니다.
- 정산하면 누가 누구에게 얼마를 보낼지 계산합니다. 송금 횟수는 인원수-1을
  넘지 않습니다. 1원 단위까지 맞습니다.
- 한 번에 다 정산하지 않아도 됩니다. 중간 정산을 여러 번 할 수 있고, 확정된
  정산의 숫자는 나중에 지출을 고쳐도 바뀌지 않습니다.
- 영수증 사진을 올리면 항목·금액·날짜·판매처를 읽어 채웁니다.
- 사진 없이 "어제 호미화방에서 폼보드 2만7천, 다 같이"처럼 한 줄로 적어도
  칸이 채워집니다. 못 읽은 칸은 비워 두고 무엇이 비었는지 알려 줍니다.
- 같은 가게에서 여러 번 샀으면 지난 기록을 보고 분류와 부담 방식을 제안합니다.
  "지난 3번 중 3번 재료비였습니다"처럼 근거를 함께 적습니다.
- 팀원은 초대 링크로 들어옵니다. 링크를 받은 사람은 앱을 깔지 않아도 되고,
  로그인 없이도 이름만 적고 들어올 수 있습니다.
- 산 물건 사진은 '품목' 화면에 남습니다. 학기가 끝나도 장부는 남습니다.

지켜야 할 것:
1. **여기서는 어떤 장부도 볼 수 없습니다.** 특정 팀의 지출이나 금액을 묻는
   말에는 "그건 장부 안에서 물어봐 주세요"라고 답합니다. 지어내지 않습니다.
2. 위에 적히지 않은 기능은 모른다고 합니다. 있는 것처럼 말하지 않습니다.
3. 가격·요금제·회사에 대해서는 아는 바가 없다고 합니다.
4. 돈 문제에 대해 판단하거나 훈수하지 않습니다.`;

export async function askAnything(args: {
  question: string;
  history: Turn[];
}): Promise<AskResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, message: '아직 설정되지 않았습니다.' };

  const messages = [
    ...args.history.slice(-MAX_TURNS).map((t) => ({
      role: t.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: String(t.text ?? '').slice(0, MAX_TURN_CHARS),
    })),
    { role: 'user' as const, content: args.question },
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
      body: JSON.stringify({ model: MODEL, max_tokens: 500, system: OPEN_SYSTEM, messages }),
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

  const body = (await res.json()) as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const usage = meter(body.usage);
  const text = (body.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('')
    .trim();

  if (!text) return { ok: false, message: '대답하지 못했습니다.', usage };
  return { ok: true, answer: text, usage };
}

export async function askAboutLedger(args: {
  ledger: Ledger;
  meId: string | null;
  question: string;
  history: Turn[];
}): Promise<AskResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, message: '아직 설정되지 않았습니다.' };

  const messages = [
    ...args.history.slice(-MAX_TURNS).map((t) => ({
      role: t.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: String(t.text ?? '').slice(0, MAX_TURN_CHARS),
    })),
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

  const body = (await res.json()) as {
    content?: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const usage = meter(body.usage);
  const text = (body.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('')
    .trim();

  if (!text) return { ok: false, message: '대답하지 못했습니다.', usage };
  return { ok: true, answer: text, usage };
}
