'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteExpense } from '../../../actions/ledger.ts';
import { translator } from '../../../../lib/i18n.ts';
import { useHelper } from '../../../helper/HelperContext.tsx';
import type { Locale } from '../../../../lib/domain/money.ts';

/**
 * 지출 한 줄 지우기 (§12)
 *
 * 이 서비스는 원본을 고치지 않는다. 금액이 틀렸으면 차액을 새 줄로 남기고,
 * 환불이면 음수 한 줄을 더한다. 그래야 확정된 정산의 숫자가 영원히 안 바뀐다.
 *
 * 그런데 그 규칙은 **계산에 들어간 줄**을 위한 것이다. 실수로 두 번 적었거나
 * 엉뚱한 장부에 적은 줄까지 영영 남겨 둘 이유는 없다. 아직 아무 정산에도
 * 들어가지 않은 줄이면 지워도 흔들릴 계산이 없다.
 *
 * 그래서 정산 전에만 이 단추가 보인다. 되돌릴 수 없으므로 한 번 더 묻되,
 * 창을 띄우지는 않는다 — 단추가 '정말 지울까요'로 바뀐다.
 */
export default function DeleteExpense({
  ledgerId,
  expenseId,
  title,
  lang,
}: {
  ledgerId: string;
  expenseId: string;
  /** 무엇을 지우는지 되묻는 말에 넣는다. 줄이 여럿 펼쳐져 있을 수 있다. */
  title: string;
  lang: Locale;
}) {
  const T = translator(lang);
  const router = useRouter();
  const { say } = useHelper();
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();

  function drop() {
    setAsking(false);
    start(async () => {
      const r = await deleteExpense({ ledgerId, expenseId });
      if (!r.ok) say(r.message);
      else router.refresh();
    });
  }

  if (!asking) {
    return (
      <button className="plain" disabled={pending} onClick={() => setAsking(true)}>
        {pending ? T('working') : T('deleteEntry')}
      </button>
    );
  }

  return (
    <span className="row" style={{ gap: 14 }}>
      <span className="debit">{T('deleteEntryWarn', { title })}</span>
      <button className="plain danger" disabled={pending} onClick={drop}>
        {T('deleteForReal')}
      </button>
      <button className="plain" onClick={() => setAsking(false)}>
        {T('close')}
      </button>
    </span>
  );
}
