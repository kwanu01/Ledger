/**
 * Ledger — 내보내기 (§16)
 *
 * 결산 보고서(§15.3)가 **사람이 읽는 종이**라면 이쪽은 **기계가 읽는 것**이다.
 * 둘은 다른 물건이라 하나로 합칠 수 없다. 보고서는 인쇄해서 총회에 내고,
 * CSV 는 엑셀로 열어 다음 학기 담당자에게 넘긴다.
 *
 * ── 왜 사람마다 한 칸인가
 *
 * 지출 한 줄에 부담자가 넷이면, 흔한 방식은 줄을 넷으로 늘리는 것이다
 * (지출×사람). 그런데 그러면 **엑셀에서 총액을 세는 순간 네 배가 된다.**
 *
 * 그래서 줄은 그대로 두고 **사람을 칸으로 편다.**
 *
 *     날짜 | 항목 | 금액 | 결제자 | 관우 | 현우 | 성주 | 유란
 *
 * 이 모양의 값은 두 방향으로 다 맞는다는 것이다. **가로로 더하면 금액이 되고,
 * 세로로 더하면 그 사람이 부담한 총액이 된다.** 이 서비스가 화면에서 하는
 * "눈으로 검산이 된다"를 엑셀에서도 그대로 할 수 있다. 지분의 합 = 금액이라는
 * 불변식이 파일 안에 그대로 실려 나간다.
 *
 * ── 엑셀이 수식으로 읽는 것을 막는다
 *
 * `=`, `+`, `-`, `@` 로 시작하는 칸을 엑셀은 **수식으로 실행한다.** 장부는
 * 여러 사람이 적는 물건이라, 남이 적은 항목 이름이 내 엑셀에서 실행될 수
 * 있다는 뜻이다. 그래서 그런 칸 앞에 작은따옴표를 하나 붙인다.
 *
 * 순수 함수다. fetch 도 파일 쓰기도 없고, 시뮬레이션에서 검증된다.
 */

import { breakdownOf, nameOf, settledExpenseIds } from './settlement.ts';
import { adjustmentLabel, allocationLabel } from '../labels.ts';
import type { Locale } from './money.ts';
import type { Ledger } from './types.ts';

/**
 * 칸 하나를 CSV 로 옮긴다.
 *
 * 쉼표·따옴표·줄바꿈이 들어 있으면 통째로 따옴표로 감싸고, 안쪽 따옴표는
 * 둘로 늘린다(RFC 4180). 항목 이름에 쉼표가 들어가는 일은 아주 흔하다 —
 * "폼보드, 아크릴".
 */
export function cell(v: string | number | undefined | null): string {
  if (v === undefined || v === null) return '';
  let s = String(v);

  /*
   * 수식이 되지 않게 막는다.
   *
   * 지우지 않고 작은따옴표를 앞에 붙인다. 지우면 사람이 적은 것이 사라지고,
   * 사라진 것은 되돌릴 수 없다. 따옴표는 엑셀에서 '글자로 읽으라'는 표시라
   * 화면에는 안 보인다.
   *
   * ── 숫자에는 절대 안 붙인다
   *
   * 이 자리에서 한 번 크게 틀렸다. 막는 글자에 `-` 가 들어 있어서
   * **환불 줄의 음수 금액이 전부 따옴표를 달았고**, 엑셀에서 글자가 되어
   * 더해지지 않았다. 하필 그 줄들이 합이 맞는지 제일 확인하고 싶은 줄이다.
   *
   * 숫자로 읽히는 값은 수식이 될 수 없으므로 그냥 통과시킨다. 불변식
   * '가로로 더하면 금액이 된다'가 이걸 잡아냈다 — 이 파일이 검산되는
   * 이유가 그것이다.
   */
  const isNumber = /^-?\d+(\.\d+)?$/.test(s);
  if (!isNumber && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;

  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function row(cells: (string | number | undefined | null)[]): string {
  return cells.map(cell).join(',');
}

/**
 * 엑셀이 한글을 깨뜨리지 않게 하는 세 바이트 (§16)
 *
 * 엑셀은 CSV 를 열 때 인코딩을 묻지 않고 시스템 기본(한국어 윈도우면 CP949)
 * 으로 읽는다. BOM 이 없으면 한글이 통째로 깨지고, 그러면 이 기능은 있으나
 * 마나다. 이걸 빠뜨리는 것이 CSV 내보내기에서 제일 흔한 실수다.
 */
export const BOM = '﻿';

/**
 * 지출 — 사람마다 한 칸 (§16)
 *
 * 공금 지출(§12)은 부담자가 없으므로 사람 칸이 전부 빈다. 0 을 적지 않는
 * 이유는, 0 은 "부담이 0원"이고 빈칸은 "부담 자체가 없다"라서 다른 말이기
 * 때문이다. 엑셀에서 세로로 더할 때도 빈칸은 안 세어진다.
 *
 * 나간 팀원도 칸을 갖는다. 과거 지출에 그 사람의 부담이 남아 있고, 그걸
 * 빼면 가로 합이 금액과 안 맞는다.
 */
export function expensesCsv(ledger: Ledger, lang: Locale): string {
  const settled = settledExpenseIds(ledger);
  const seqOf = new Map<string, number>();
  for (const s of ledger.settlements) {
    for (const id of s.snapshot.expenseIds) seqOf.set(id, s.seq);
  }

  const people = ledger.members;
  const head = [
    '날짜', '항목', '금액', '통화', '결제자', '부담 방식',
    '분류', '판매처', '묶음', '상태', '정산 회차', '보정', '메모',
    ...people.map((m) => m.name),
  ];

  const lines = [row(head)];
  for (const e of [...ledger.expenses].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const shares = new Map(breakdownOf(e).shares.map((s) => [s.memberId, s.amount]));
    lines.push(
      row([
        e.date,
        e.title,
        e.amount,
        ledger.currency ?? 'KRW',
        nameOf(ledger.members, e.payerId),
        allocationLabel(e, ledger.members, lang),
        e.category,
        e.vendor,
        e.group,
        settled.has(e.id) ? '정산 완료' : '미정산',
        seqOf.get(e.id) ?? '',
        e.adjustment ? adjustmentLabel(e, lang) : '',
        e.note,
        // 부담이 없는 줄은 0 이 아니라 빈칸이다.
        ...people.map((m) => shares.get(m.id) ?? ''),
      ]),
    );
  }
  return BOM + lines.join('\r\n') + '\r\n';
}

/**
 * 들어온 돈 (§12)
 *
 * 지출과 나란한 것이지 지출의 일종이 아니라서 파일도 따로다. 한 파일에
 * 섞으면 금액 칸 하나에 들어온 돈과 나간 돈이 같은 부호로 앉는다.
 */
export function incomesCsv(ledger: Ledger, lang: Locale): string {
  const word: Record<string, string> = {
    dues: '회비', grant: '지원금', donation: '후원', carryover: '이월금',
  };
  const head = ['날짜', '이름', '금액', '통화', '무엇으로', '낸 사람', '메모'];
  const lines = [row(head)];
  for (const i of [...ledger.incomes].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    lines.push(
      row([
        i.date,
        i.title,
        i.amount,
        ledger.currency ?? 'KRW',
        word[i.kind] ?? i.kind,
        i.memberId ? nameOf(ledger.members, i.memberId) : '',
        i.note,
      ]),
    );
  }
  return BOM + lines.join('\r\n') + '\r\n';
}

/**
 * 내려받을 때 붙는 이름.
 *
 * 팀 이름과 장부 이름이 파일 이름에 들어가야 한다 — 내려받은 폴더에
 * `expenses.csv` 가 셋이면 어느 장부의 것인지 알 수 없다.
 *
 * 파일 이름에 못 쓰는 글자만 걷어 내고 한글은 그대로 둔다. 브라우저는
 * UTF-8 파일 이름을 받을 수 있고(RFC 5987), 로마자로 옮기면 '스팟'이
 * 'seupas' 같은 것이 되어 오히려 못 알아본다.
 */
export function fileName(ledger: Ledger, what: 'expenses' | 'incomes', today: string): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 40);
  const tail = what === 'expenses' ? '지출' : '들어온돈';
  return `${safe(ledger.teamName)} ${safe(ledger.name)} ${tail} ${today}.csv`;
}
