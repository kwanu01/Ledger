'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { editExpenseLine } from '../../../actions/ledger.ts';
import { translator } from '../../../../lib/i18n.ts';
import { formatNumber, parseMoney } from '../../../../lib/domain/money.ts';
import { useHelper } from '../../../helper/HelperContext.tsx';
import type { CurrencyCode, Locale } from '../../../../lib/domain/money.ts';
import type { Allocation, Expense, Member } from '../../../../lib/domain/types.ts';
import ItemLines, { newDraft, toItemLines, type Draft } from '../add/ItemLines.tsx';

/**
 * 지출 한 줄 고치기 (§12)
 *
 * 아직 정산에 들어가지 않은 줄만 여기서 고친다. 정산에 들어간 줄은 보정
 * 항목으로 바로잡는다 — 확정된 정산의 숫자를 건드리지 않기 위해서다.
 *
 * 고치는 자리를 새 화면으로 두지 않는다. 줄을 펼친 그 자리에서 바로 고친다.
 * 어느 줄을 고치는 중인지 눈에서 놓치지 않는 편이 낫고, 고치고 나면 바로
 * 그 줄이 바뀌는 것이 보인다.
 *
 * 기록 시점의 팀원 명단은 고치지 않는다. '전체 공동'이 누구를 뜻하는지는
 * 그 줄을 적던 순간의 사실이지, 지금 다시 정하는 것이 아니다.
 */
export default function EditExpense({
  ledgerId,
  expense,
  members,
  groups,
  currency,
  lang,
  onDone,
}: {
  ledgerId: string;
  expense: Expense;
  members: Member[];
  /** 이 장부에 이미 쓰인 묶음 이름들 (§11.3) */
  groups: string[];
  currency: CurrencyCode;
  lang: Locale;
  onDone: () => void;
}) {
  const T = translator(lang);
  const router = useRouter();
  const { say } = useHelper();
  const [pending, start] = useTransition();

  const a = expense.allocation;
  const [title, setTitle] = useState(expense.title);
  const [amount, setAmount] = useState(formatNumber(expense.amount, currency, lang));
  const [date, setDate] = useState(expense.date);
  const [payerId, setPayerId] = useState(expense.payerId);
  const [kind, setKind] = useState<Allocation['type']>(a.type);
  const [participants, setParticipants] = useState<string[]>(
    a.type === 'partial' ? a.participantIds : [],
  );
  const [ownerId, setOwnerId] = useState(a.type === 'personal' ? a.ownerId : expense.payerId);
  /* 항목별 청구 (§10.4). 읽어 온 줄이 틀렸을 때 고치는 자리는 여기다. */
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    a.type === 'items'
      ? a.lines.map((l) => newDraft({ name: l.name, amount: formatNumber(l.amount, currency, lang), memberIds: l.memberIds }))
      : [],
  );
  const [vendor, setVendor] = useState(expense.vendor ?? '');
  const [category, setCategory] = useState(expense.category ?? '');
  const [group, setGroup] = useState(expense.group ?? '');
  const groupListId = useId();
  const [note, setNote] = useState(expense.note ?? '');
  // 기입할 때 받아 놓고 고칠 때는 못 고치던 칸. 링크야말로 나중에 고쳐야
  // 하는 것이다 — 적을 때는 장바구니 주소였다가 나중에 상품 주소가 된다.
  const [productLink, setProductLink] = useState(expense.productLink ?? '');

  // 부담할 사람을 고르는 자리는 그 줄을 적던 순간의 명단 안에서만 고른다.
  const roster = members.filter((m) => expense.teamMemberIds.includes(m.id));
  const who = (id: string) => members.find((m) => m.id === id)?.name ?? id;

  function toggle(id: string) {
    setParticipants((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  function save() {
    const money = parseMoney(amount, currency);

    let lines: ReturnType<typeof toItemLines> = [];
    if (kind === 'items') {
      lines = toItemLines(drafts, currency).filter((l) => l.name !== '' || l.amount !== 0);
      if (lines.length === 0) return say(T('needLines'));
      if (lines.some((l) => l.memberIds.length === 0)) return say(T('needLineWho'));
      const sum = lines.reduce((acc, l) => acc + l.amount, 0);
      if (sum !== money) {
        return say(
          T('sumOff', {
            gap: `${sum - money > 0 ? '+' : '\u2212'}${formatNumber(Math.abs(sum - money), currency, lang)}`,
          }),
        );
      }
      lines = lines.map((l, i) => ({ ...l, name: l.name || `${T('newLine')} ${i + 1}` }));
    }

    const allocation: Allocation =
      kind === 'all'
        ? { type: 'all' }
        : kind === 'partial'
          ? { type: 'partial', participantIds: participants }
          : kind === 'items'
            ? { type: 'items', lines }
            : { type: 'personal', ownerId };

    start(async () => {
      const r = await editExpenseLine({
        ledgerId,
        expenseId: expense.id,
        date,
        title,
        amount: money,
        payerId,
        allocation,
        vendor,
        category,
        group,
        note,
        productLink,
      });
      if (!r.ok) return say(r.message);
      onDone();
      router.refresh();
    });
  }

  return (
    <div className="editline">
      <div className="fields">
        <label className="field wide">
          <span className="lab">{T('itemName')}</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <label className="field">
          <span className="lab">{T('amount')}</span>
          <input
            type="text"
            inputMode="decimal"
            className="num"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="lab">{T('date')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        <label className="field">
          <span className="lab">{T('payer')}</span>
          <select value={payerId} onChange={(e) => setPayerId(e.target.value)}>
            {roster.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="lab">{T('vendor')}</span>
          <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        </label>

        <label className="field">
          <span className="lab">{T('category')}</span>
          <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} />
        </label>

        <label className="field">
          <span className="lab">{T('groupField')}</span>
          <input
            type="text"
            list={groupListId}
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          />
          <datalist id={groupListId}>
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </label>

        <label className="field">
          <span className="lab">{T('productLink')}</span>
          <input
            type="text"
            value={productLink}
            onChange={(e) => setProductLink(e.target.value)}
            placeholder="https://"
          />
        </label>

        <label className="field wide">
          <span className="lab">{T('noteField')}</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      <fieldset style={{ marginTop: 20 }}>
        <legend>{T('whoSplits')}</legend>

        <label className="pick">
          <input
            type="radio"
            checked={kind === 'all'}
            onChange={() => setKind('all')}
          />
          <span>{T('wholeTeam', { n: expense.teamMemberIds.length })}</span>
        </label>

        <label className="pick">
          <input
            type="radio"
            checked={kind === 'partial'}
            onChange={() => setKind('partial')}
          />
          <span>{T('someOnly')}</span>
        </label>
        {kind === 'partial' && (
          <div className="pick-sub">
            {roster.map((m) => (
              <label key={m.id}>
                <input
                  type="checkbox"
                  checked={participants.includes(m.id)}
                  onChange={() => toggle(m.id)}
                />{' '}
                {m.name}
              </label>
            ))}
          </div>
        )}

        <label className="pick">
          <input
            type="radio"
            checked={kind === 'items'}
            onChange={() => {
              setKind('items');
              if (drafts.length === 0) setDrafts([newDraft()]);
            }}
          />
          <span>
            {T('byItem')}
            <span className="pick-say">{T('byItemHint')}</span>
          </span>
        </label>
        {kind === 'items' && (
          <ItemLines
            drafts={drafts}
            onDrafts={setDrafts}
            members={members}
            roster={expense.teamMemberIds}
            currency={currency}
            lang={lang}
            total={parseMoney(amount, currency)}
            onTotal={(n) => setAmount(formatNumber(n, currency, lang))}
          />
        )}

        <label className="pick">
          <input
            type="radio"
            checked={kind === 'personal'}
            onChange={() => setKind('personal')}
          />
          <span>{T('onePersonTakes')}</span>
        </label>
        {kind === 'personal' && (
          <div className="pick-sub">
            <label>
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                {roster.map((m) => (
                  <option key={m.id} value={m.id}>
                    {who(m.id)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </fieldset>

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
