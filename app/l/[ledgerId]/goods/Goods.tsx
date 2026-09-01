'use client';

import { useMemo, useState } from 'react';
import Lightbox from '../../../Lightbox.tsx';
import { translator } from '../../../../lib/i18n.ts';
import { formatMoney, type CurrencyCode, type Locale } from '../../../../lib/domain/money.ts';

/**
 * 품목 (§21.6)
 *
 * 장부가 숫자의 목록이라면 여기는 산 물건의 목록이다.
 *
 * 카드가 격자로 늘어서면 순서가 눈에 안 보인다. 표는 위에서 아래로 읽히니까
 * 순서가 저절로 드러나지만 격자는 그렇지 않다. 그래서 두 가지를 둔다.
 *   · 무엇으로 줄 세울지 고르는 자리 (날짜 · 금액 · 분류)
 *   · 카드마다 전표 번호. 장부의 그 줄과 같은 번호라서, 여기서 본 물건을
 *     장부에서 다시 찾을 수 있다.
 *
 * 분류로 세우면 소제목이 생긴다. 그래야 묶였다는 것이 보인다.
 */

export type Good = {
  id: string;
  slip: string;
  title: string;
  date: string;
  amount: number;
  effective: number;
  payer: string;
  bears: string;
  category: string;
  vendor?: string;
  productLink?: string;
  image?: string;
  dup: boolean;
};

type Key = 'date' | 'amount' | 'category';

export default function Goods({
  items,
  currency,
  lang,
}: {
  items: Good[];
  currency: CurrencyCode;
  lang: Locale;
}) {
  const T = translator(lang);
  const cash = (n: number) => formatMoney(n, currency, lang);
  const [key, setKey] = useState<Key>('date');

  const groups = useMemo(() => {
    const list = [...items];
    if (key === 'amount') {
      list.sort((a, b) => b.effective - a.effective);
      return [{ head: null as string | null, list }];
    }
    if (key === 'category') {
      list.sort((a, b) =>
        a.category === b.category ? (a.date < b.date ? 1 : -1) : a.category < b.category ? -1 : 1,
      );
      const out: { head: string | null; list: Good[] }[] = [];
      for (const g of list) {
        const last = out[out.length - 1];
        if (last && last.head === g.category) last.list.push(g);
        else out.push({ head: g.category, list: [g] });
      }
      return out;
    }
    list.sort((a, b) => (a.date < b.date ? 1 : -1));
    return [{ head: null as string | null, list }];
  }, [items, key]);

  const tab = (k: Key, label: string) => (
    <button
      key={k}
      className={`sortkey${key === k ? ' on' : ''}`}
      onClick={() => setKey(k)}
      aria-pressed={key === k}
    >
      {label}
    </button>
  );

  return (
    <section>
      <div className="row sortbar">
        <span className="caption">{T('sortBy')}</span>
        {tab('date', T('colDate'))}
        {tab('amount', T('colAmount'))}
        {tab('category', T('category'))}
      </div>

      {groups.map((g) => (
        <div key={g.head ?? '·'}>
          {g.head && <div className="group-head">{g.head}</div>}
          <div className="goods">
            {g.list.map((e) => (
              <div className="good" key={e.id}>
                {/* 사진이 있으면 점으로 찍어 보여 준다. 누르면 원본이 크게 열린다. */}
                {e.image ? (
                  <Lightbox
                    src={e.image}
                    alt={e.title}
                    wide
                    caption={`${e.title} · ${cash(e.effective)} · ${e.date}`}
                  />
                ) : (
                  <div className="plate">{e.category}</div>
                )}

                <div className="good-slip">{e.slip}</div>
                <h3>{e.title}</h3>
                <div className="price">{cash(e.effective)}</div>
                {e.effective !== e.amount && (
                  <div className="faint" style={{ fontSize: 12.5 }}>
                    {T('firstPaid', { amount: cash(e.amount) })}
                  </div>
                )}

                <table className="facts">
                  <tbody>
                    <tr>
                      <td className="k">{T('date')}</td>
                      <td>{e.date.slice(5).replace('-', '.')}</td>
                    </tr>
                    <tr>
                      <td className="k">{T('colPayer')}</td>
                      <td>{e.payer}</td>
                    </tr>
                    <tr>
                      <td className="k">{T('colBears')}</td>
                      <td>{e.bears}</td>
                    </tr>
                    {e.vendor && (
                      <tr>
                        <td className="k">{T('vendor')}</td>
                        <td>{e.vendor}</td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {e.productLink && (
                  <div style={{ marginTop: 9 }}>
                    <a href={e.productLink} target="_blank" rel="noopener">
                      {T('buyLink')}
                    </a>
                  </div>
                )}
                {e.dup && <div className="again">{T('boughtTwice')}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
