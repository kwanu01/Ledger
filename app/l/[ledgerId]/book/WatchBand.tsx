'use client';

import { useState, useTransition } from 'react';
import { markChecked } from '../../../actions/ledger.ts';
import { translator } from '../../../../lib/i18n.ts';
import { formatMoney } from '../../../../lib/domain/money.ts';
import { useHelper } from '../../../helper/HelperContext.tsx';
import type { CurrencyCode, Locale } from '../../../../lib/domain/money.ts';
import type { Flag } from '../../../../lib/domain/watch.ts';
import type { Ledger } from '../../../../lib/domain/types.ts';

/**
 * 확인할 것 (§13)
 *
 * 검사가 찾아낸 물음들이 서는 자리. 장부 표 바로 위다.
 *
 * ── 왜 새 화면이 아닌가
 *
 * 검사 결과가 따로 있는 화면에 살면, 거기 들어가 보는 사람만 검사를 받는다.
 * 그런데 검사가 필요한 사람은 대개 들어가 보지 않는 사람이다. 물음은
 * **이미 보고 있는 화면 위**에 서야 한다.
 *
 * ── 물음이 없으면 아무것도 그리지 않는다
 *
 * "확인할 것 없음"이라는 줄은 그 자체로 잡음이다. 장부가 조용하다는 것은
 * 화면이 조용한 것으로 말한다.
 *
 * ── 접혀 있다
 *
 * 펴진 채로 서면 표보다 먼저 읽히는데, 이 화면에 온 사람이 보러 온 것은
 * 표다. 몇 가지인지만 한 줄로 말하고, 볼지 말지는 사람이 정한다.
 *
 * ── "괜찮습니다"를 누른 줄은 그 자리에 잠깐 남는다
 *
 * 바로 사라지면 잘못 누른 것을 되돌릴 자리가 없다. 그래서 회색으로 가라앉히고
 * 되돌리기를 옆에 둔다. 화면을 다시 열면 그때는 없다 — 되돌릴 일은 대개
 * 누른 직후에 알아차린다.
 */
export default function WatchBand({
  ledger,
  flags,
  lang,
}: {
  ledger: Ledger;
  flags: Flag[];
  lang: Locale;
}) {
  const T = translator(lang);
  const { say } = useHelper();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  /** 이번에 눌러서 넘긴 줄들. 화면을 다시 열면 비워진다. */
  const [hushed, setHushed] = useState<Set<string>>(new Set());

  if (flags.length === 0) return null;

  const currency: CurrencyCode = ledger.currency ?? 'KRW';
  const cash = (n: number) => formatMoney(n, currency, lang);
  const rowOf = (id?: string) => ledger.expenses.find((e) => e.id === id);
  const nameOf = (id?: string) => ledger.members.find((m) => m.id === id)?.name ?? '';

  /** 아직 안 넘긴 것만 센다 — 눌렀는데 숫자가 그대로면 눌린 것 같지 않다. */
  const left = flags.filter((f) => !f.expenseId || !hushed.has(f.expenseId)).length;

  function hush(expenseId: string, checked: boolean) {
    start(async () => {
      const r = await markChecked({ ledgerId: ledger.id, expenseId, checked });
      if (!r.ok) return say(r.message);
      setHushed((prev) => {
        const next = new Set(prev);
        if (checked) next.add(expenseId);
        else next.delete(expenseId);
        return next;
      });
    });
  }

  /** 물음 한 줄의 말. 여섯 개 언어로 옮겨야 해서 화면이 만든다(watch.ts 는 뼈대만 준다). */
  function sentence(f: Flag): string {
    const row = rowOf(f.expenseId);
    if (f.kind === 'twin') {
      const other = rowOf(f.otherId);
      return T('watchTwin', {
        title: row?.title ?? '',
        other: other?.title ?? '',
        date: other?.date.slice(5).replace('-', '.') ?? '',
        amount: cash(f.facts.amount),
      });
    }
    if (f.kind === 'spike') {
      return T('watchSpike', {
        title: row?.title ?? '',
        amount: cash(f.facts.amount),
        usual: cash(f.facts.usual),
        times: f.facts.times,
      });
    }
    if (f.kind === 'offReceipt') {
      return T('watchOff', {
        title: row?.title ?? '',
        read: cash(f.facts.read),
        amount: cash(f.facts.amount),
        gap: cash(Math.abs(f.facts.gap)),
      });
    }
    return T('watchLeft', { who: nameOf(f.memberId), rows: f.facts.rows });
  }

  return (
    <div className="watch">
      <button className="watch-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`caret${open ? ' on' : ''}`} aria-hidden="true">›</span>
        {T('watchN', { n: left })}
      </button>

      {open && (
        <ul className="watch-list">
          {flags.map((f, i) => {
            const done = Boolean(f.expenseId && hushed.has(f.expenseId));
            return (
              <li key={`${f.kind}-${f.expenseId ?? f.memberId}-${i}`} className={done ? 'gone' : undefined}>
                <span className="ask">{sentence(f)}</span>
                {/*
                  줄에 붙는 물음만 넘길 수 있다. '빠진 사람'은 줄이 아니라
                  사람에 대한 물음이라, 넘기는 대신 그 사람을 어느 줄엔가
                  넣으면 저절로 사라진다.
                */}
                {f.expenseId && (
                  <button className="plain" disabled={pending}
                    onClick={() => hush(f.expenseId as string, !done)}>
                    {done ? T('watchUndo') : T('watchOk')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
