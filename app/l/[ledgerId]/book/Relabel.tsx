'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { relabelExpenseLine } from '../../../actions/ledger.ts';
import { translator } from '../../../../lib/i18n.ts';
import { useHelper } from '../../../helper/HelperContext.tsx';
import type { Locale } from '../../../../lib/domain/money.ts';
import type { Expense } from '../../../../lib/domain/types.ts';

/**
 * 정산이 끝난 줄의 이름표 고치기 (§12)
 *
 * 정산이 끝났다고 해서 그 줄에 대해 더 알게 될 것이 없는 것은 아니다.
 * 오히려 반대다 — 학기가 끝나고 아카이브를 열어 보면서 "이건 식비가 아니라
 * 재료비였네" 하는 순간이 온다. 분류는 그때 제대로 붙는다.
 *
 * 그래서 여기서는 **계산에 들어가지 않는 것들만** 고친다.
 *
 *   고칠 수 있다   항목 이름 · 판매처 · 분류 · 구매 링크 · 메모
 *   못 고친다      금액 · 날짜 · 결제자 · 부담 방식
 *
 * 뒤의 넷은 이 화면에 아예 없다. 잠긴 칸을 보여 주고 못 누르게 하는 것보다,
 * 여기서 할 수 있는 일만 놓아 두는 편이 낫다. 금액을 바로잡아야 한다면
 * 그건 고치는 일이 아니라 **보정 항목을 새로 적는 일**이고, 그 길은 따로 있다.
 * DB 에도 같은 선이 그어져 있다 (0013_relabel_settled.sql).
 */
export default function Relabel({
  ledgerId,
  expense,
  lang,
  onDone,
}: {
  ledgerId: string;
  expense: Expense;
  lang: Locale;
  onDone: () => void;
}) {
  const T = translator(lang);
  const router = useRouter();
  const { say } = useHelper();
  const [pending, start] = useTransition();

  const [title, setTitle] = useState(expense.title);
  const [vendor, setVendor] = useState(expense.vendor ?? '');
  const [category, setCategory] = useState(expense.category ?? '');
  const [note, setNote] = useState(expense.note ?? '');

  function save() {
    start(async () => {
      const r = await relabelExpenseLine({
        ledgerId,
        expenseId: expense.id,
        title,
        vendor,
        category,
        note,
      });
      if (!r.ok) return say(r.message);
      onDone();
      router.refresh();
    });
  }

  return (
    <div className="editline">
      {/* 무엇을 못 고치는지 먼저 말한다. 고치려다 없는 것을 찾는 편보다,
          없다는 것을 알고 시작하는 편이 낫다. */}
      <p className="aside" style={{ maxWidth: 520 }}>
        {T('relabelOnly')}
      </p>

      <div className="fields" style={{ marginTop: 20 }}>
        <label className="field wide">
          <span className="lab">{T('itemName')}</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <label className="field">
          <span className="lab">{T('vendor')}</span>
          <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        </label>

        <label className="field">
          <span className="lab">{T('category')}</span>
          <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} />
        </label>

        <label className="field wide">
          <span className="lab">{T('noteField')}</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      <div className="row" style={{ marginTop: 22 }}>
        <button className="act small primary" disabled={pending} onClick={save}>
          {pending ? T('working') : T('saveEdit')}
        </button>
        <button className="plain" onClick={onDone}>
          {T('close')}
        </button>
      </div>
    </div>
  );
}
