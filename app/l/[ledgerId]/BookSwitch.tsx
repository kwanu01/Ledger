'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addLedgerToTeam } from '../../actions/teams.ts';
import { translator } from '../../../lib/i18n.ts';
import { CURRENCIES, type CurrencyCode, type Locale } from '../../../lib/domain/money.ts';
import { useHelper } from '../../helper/HelperContext.tsx';

/**
 * 장부 바꾸기 (§5.2)
 *
 * 팀 이름 옆에 장부 이름이 적혀 있던 자리다. 장부가 하나뿐일 때는 그냥
 * 이름이었는데, 여럿이 되면 **지금 어느 장부를 보고 있는지**가 되고, 그러면
 * 바꾸는 자리도 거기여야 한다. 이름이 곧 손잡이가 된다.
 *
 * 장부가 하나뿐이면 손잡이로 만들지 않는다. 고를 것이 없는 자리를 누를 수
 * 있게 두면, 눌러 보고 나서야 고를 것이 없다는 것을 알게 된다.
 *
 * 새 장부는 소유자만 만든다. 장부가 늘면 팀원 모두의 화면에 늘어나기 때문이다.
 */
export default function BookSwitch({
  ledgerId,
  bookName,
  books,
  owner,
  lang,
}: {
  ledgerId: string;
  bookName: string;
  books: { id: string; name: string; here: boolean }[];
  owner: boolean;
  lang: Locale;
}) {
  const T = translator(lang);
  const router = useRouter();
  const { say } = useHelper();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [curr, setCurr] = useState<CurrencyCode>('KRW');
  const [pending, start] = useTransition();

  // 고를 것도 만들 것도 없으면 그냥 이름이다.
  if (books.length < 2 && !owner) return <span className="book">{bookName}</span>;

  function make() {
    start(async () => {
      const r = await addLedgerToTeam({ ledgerId, name, currency: curr });
      if (!r.ok) return say(r.message);
      setAdding(false);
      setOpen(false);
      setName('');
      router.push(`/l/${r.value.ledgerId}`);
      router.refresh();
    });
  }

  return (
    <span className="bookpick">
      <button
        className="book bookpick-now"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
          setAdding(false);
        }}
      >
        {bookName}
        <span className="bookpick-caret" aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="bookpick-list">
          {books.map((b) =>
            b.here ? (
              <span key={b.id} className="bookpick-item here">
                {b.name}
              </span>
            ) : (
              <a key={b.id} href={`/l/${b.id}`} className="bookpick-item">
                {b.name}
              </a>
            ),
          )}

          {owner &&
            (adding ? (
              <div className="bookpick-new">
                <input
                  type="text"
                  value={name}
                  autoFocus
                  placeholder={T('bookNamePlaceholder')}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') make();
                    if (e.key === 'Escape') setAdding(false);
                  }}
                />
                <select value={curr} onChange={(e) => setCurr(e.target.value as CurrencyCode)}>
                  {Object.keys(CURRENCIES).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <span className="acts">
                  <button className="plain" disabled={pending} onClick={make}>
                    {pending ? T('working') : T('makeBook')}
                  </button>
                  <button className="plain" onClick={() => setAdding(false)}>
                    {T('close')}
                  </button>
                </span>
              </div>
            ) : (
              <button className="bookpick-item add" onClick={() => setAdding(true)}>
                {T('newBookPlus')}
              </button>
            ))}
        </div>
      )}
    </span>
  );
}
