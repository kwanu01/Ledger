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
 * 없던 기록이 된다.
 *
 * 아직 정산에 안 들어간 줄이면 그냥 사라진다. 흔들릴 계산이 없다.
 *
 * 정산에 들어간 줄이면 **그 정산까지 함께 걷어진다.** 정산이 반쯤 맞는 상태로
 * 남는 것보다 없는 편이 낫기 때문이다 — 걷어진 정산의 나머지 지출은 미정산으로
 * 돌아가므로 다시 정산하면 된다. 그래서 그때는 무엇이 함께 사라지는지 미리
 * 말해 준다. 눌러 보고 알게 되면 늦다.
 *
 * 되돌릴 수 없으므로 한 번 더 묻되, 창을 띄우지는 않는다 — 단추가
 * '정말 지울까요'로 바뀐다.
 */
export default function DeleteExpense({
  ledgerId,
  expenseId,
  title,
  settled = false,
  lang,
}: {
  ledgerId: string;
  expenseId: string;
  /** 무엇을 지우는지 되묻는 말에 넣는다. 줄이 여럿 펼쳐져 있을 수 있다. */
  title: string;
  /** 이미 정산에 들어간 줄인가. 그러면 그 정산까지 사라진다고 먼저 알린다. */
  settled?: boolean;
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
      <button
        className="plain"
        disabled={pending}
        onClick={(e) => {
          setAsking(true);
          // 무엇이 함께 사라지는지는 수증이가 말한다. 이 자리에 문장을 넣으면
          // 펼친 줄이 옆으로 벌어진다. 여기 남는 것은 단추뿐이다.
          say(T(settled ? 'deleteSettledWarn' : 'deleteEntryWarn', { title }), 'warn', e.currentTarget);
        }}
      >
        {pending ? T('working') : T('deleteEntry')}
      </button>
    );
  }

  return (
    <span className="acts">
      <button className="plain danger" disabled={pending} onClick={drop}>
        {T('deleteForReal')}
      </button>
      <button className="plain" onClick={() => setAsking(false)}>
        {T('close')}
      </button>
    </span>
  );
}
