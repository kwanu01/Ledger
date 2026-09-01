'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { recordExpense } from '../../../actions/ledger.ts';
import { attachImage } from '../../../actions/images.ts';
import { analyzeReceipt } from '../../../actions/receipt.ts';
import { splitEvenly } from '../../../../lib/domain/settlement.ts';
import { translator } from '../../../../lib/i18n.ts';
import {
  CURRENCIES,
  formatMoney,
  formatNumber,
  parseMoney,
  type CurrencyCode,
  type Locale,
} from '../../../../lib/domain/money.ts';
import type { Allocation, Member } from '../../../../lib/domain/types.ts';
import { useHelper } from '../../../helper/HelperContext.tsx';

/**
 * 지출 기입 (§21.5)
 *
 * 장부의 통화는 그 장부의 사실이라 여기서 바꿀 수 없다. 다만 해외 결제처럼
 * 다른 통화로 산 것은 원래 금액을 남기고, 실제로 청구된 장부 통화 금액을 따로 적는다.
 * 환율을 우리가 계산하지 않는 이유는, 카드사가 이미 계산해서 청구했기 때문이다.
 */

const FOREIGN: CurrencyCode[] = ['KRW', 'JPY', 'USD', 'EUR', 'GBP'];

export default function ExpenseForm({
  ledgerId,
  members,
  roster,
  currency,
  meId,
  today,
  lang,
}: {
  ledgerId: string;
  members: Member[];
  roster: string[];
  currency: CurrencyCode;
  meId: string;
  today: string;
  lang: Locale;
}) {
  const router = useRouter();
  // 경고는 도우미 말풍선 한 자리로 모인다(app/helper).
  const { say } = useHelper();
  const T = translator(lang);

  const [title, setTitle] = useState('');
  const [curr, setCurr] = useState<CurrencyCode>(currency);
  const [amount, setAmount] = useState('');
  const [charged, setCharged] = useState('');
  const [date, setDate] = useState(today);
  const [vendor, setVendor] = useState('');
  const [category, setCategory] = useState('');
  const [payerId, setPayerId] = useState(meId);
  const [kind, setKind] = useState<Allocation['type']>('all');
  const [participants, setParticipants] = useState<string[]>(roster);
  const [ownerId, setOwnerId] = useState(meId);
  const [productLink, setProductLink] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // 사진 먼저, 폼은 그다음. 손으로 적겠다고 하면 곧장 빈 폼으로 간다.
  const [step, setStep] = useState<'photo' | 'reading' | 'form'>('photo');
  const [thumb, setThumb] = useState<string | null>(null);
  /* 읽은 뒤에도 파일을 들고 있는다. 남길지 말지는 저장할 때 정한다. */
  const [photo, setPhoto] = useState<File | null>(null);
  const [keepPhoto, setKeepPhoto] = useState(false);
  const [read, setRead] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 화면을 캡처해서 그대로 붙여넣는 편이 파일로 저장했다 고르는 것보다 빠르다.
  // 사진 받는 단계에 있을 때만 듣는다.
  useEffect(() => {
    if (step !== 'photo') return;
    function onPaste(e: ClipboardEvent) {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        analyze(file);
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function analyze(file: File) {
    say('');
    setPhoto(file);
    setThumb(URL.createObjectURL(file));
    setStep('reading');

    const fd = new FormData();
    fd.set('ledgerId', ledgerId);
    fd.set('image', file);
    const r = await analyzeReceipt(fd);

    if (!r.ok) {
      // 못 읽어도 막지 않는다. 사진은 남겨 두고 손으로 마저 적게 한다.
      say(r.message);
      setStep('form');
      return;
    }

    const v = r.value;
    if (v.title) setTitle(v.title);
    if (v.date) setDate(v.date);
    if (v.vendor) setVendor(v.vendor);
    if (v.category) setCategory(v.category);
    setCurr(v.currency);
    // 폼에는 사람이 읽는 형태로 채운다. 저장할 때 다시 최소 단위로 되돌린다.
    setAmount(formatNumber(v.amount, v.currency, lang));
    setRead(r.fields);
    setStep('form');
  }

  const foreign = curr !== currency;
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? id;

  // 장부에 적히는 금액은 언제나 장부의 통화다. 해외 결제면 청구액 칸이 그 자리를 대신한다.
  const booked = foreign ? parseMoney(charged, currency) : parseMoney(amount, currency);

  const bearers =
    kind === 'all' ? roster : kind === 'partial' ? participants : [ownerId];

  const preview =
    booked > 0 && bearers.length > 0
      ? splitEvenly(booked, bearers)
      : [];
  const each = [...new Set(preview.map((s) => s.amount))];

  function toggle(id: string) {
    setParticipants((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function save() {
    say('');
    if (!title.trim()) return say(T('needTitle'));
    if (!booked) return say(foreign ? T('needCharged', { code: currency }) : T('needAmount'));
    if (kind === 'partial' && participants.length === 0) {
      return say(T('needBearers'));
    }

    const allocation: Allocation =
      kind === 'all'
        ? { type: 'all' }
        : kind === 'partial'
          ? { type: 'partial', participantIds: participants }
          : { type: 'personal', ownerId };

    setBusy(true);
    const r = await recordExpense({
      ledgerId,
      date,
      title: title.trim(),
      amount: booked,
      payerId,
      allocation,
      vendor: vendor.trim() || undefined,
      category: category.trim() || undefined,
      productLink: productLink.trim() || undefined,
      note: note.trim() || undefined,
    });
    setBusy(false);

    if (!r.ok) return say(r.message);

    // 남기기로 했으면 지출이 만들어진 뒤에 사진을 붙인다. 사진을 못 붙여도
    // 지출은 이미 적혔으므로 막지 않는다. 사진은 장부에서 다시 올릴 수 있다.
    if (keepPhoto && photo) {
      const fd = new FormData();
      fd.set('ledgerId', ledgerId);
      fd.set('expenseId', r.value.id);
      fd.set('kind', 'receipt');
      fd.set('image', photo);
      const up = await attachImage(fd);
      if (!up.ok) say(up.message);
    }

    router.push(`/l/${ledgerId}/book`);
    router.refresh();
  }

  // 먼저 사진을 받는다. 영수증 한 장이면 아래 칸들이 대부분 채워진다.
  if (step === 'photo') {
    return (
      <section>
        <div className="caption">{T('expenseEntry')}</div>

        {/* 브라우저 기본 파일 버튼은 영어로 나오고 생김새도 제각각이라 라벨로 감싼다. */}
        <div
          className={`drop${dragging ? ' over' : ''}`}
          style={{ marginTop: 16 }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
            if (f) analyze(f);
          }}
        >
          <label className="act primary">
            {T('pickPhoto')}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) analyze(f);
              }}
            />
          </label>

          {/* 무엇을 찍어야 하는지, 사진이 어디로 가는지는 미리 알려 준다. */}
          <table className="facts" style={{ margin: '22px auto 0', textAlign: 'left', maxWidth: 400 }}>
            <tbody>
              <tr>
                <td className="k">{T('photoReads')}</td>
                <td>{T('photoReadsV')}</td>
              </tr>
              <tr>
                <td className="k">{T('photoKinds')}</td>
                <td>{T('photoKindsV')}</td>
              </tr>
              <tr>
                <td className="k">{T('photoHow')}</td>
                <td>{T('photoHowV')}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="aside" style={{ marginTop: 16, maxWidth: 520 }}>
          {T('photoSentTo')}
        </p>

        <p style={{ marginTop: 18 }}>
          <button className="plain" onClick={() => setStep('form')}>
            {T('writeManually')}
          </button>
        </p>
      </section>
    );
  }

  if (step === 'reading') {
    return (
      <section>
        <div className="caption">{T('expenseEntry')}</div>
        {thumb && (
          <img
            src={thumb}
            alt={T('uploaded')}
            style={{ maxHeight: 160, border: '1px solid var(--rule)', marginTop: 16 }}
          />
        )}
        <p className="muted" style={{ marginTop: 20 }}>
          {T('reading')}
        </p>
      </section>
    );
  }

  const fromAI = (f: string) => (read.includes(f) ? <span className="ai-mark">{T('fromAI')}</span> : null);

  return (
    <section>
      <div className="caption">{T('expenseEntry')}</div>

      {thumb && (
        <>
          <img
            src={thumb}
            alt={T('uploaded')}
            style={{ maxHeight: 160, border: '1px solid var(--rule)', marginTop: 16 }}
          />
          {/* 자동으로 남기지 않는다. 영수증에는 카드 뒷번호와 매장과 시각이
              찍혀 있고, 그게 팀원 전체에게 보인다. 남길지는 올린 사람이 정한다. */}
          <label className="row" style={{ marginTop: 12, fontSize: 13.5 }}>
            <input
              type="checkbox"
              checked={keepPhoto}
              onChange={(e) => setKeepPhoto(e.target.checked)}
            />
            {T('keepReceipt')}
          </label>
        </>
      )}

      <div className="fields" style={{ marginTop: 22 }}>
        <label className="field" style={{ gridColumn: 'span 2' }}>
          <span className="lab">{T('itemName')}{fromAI('title')}</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>

        <label className="field">
          <span className="lab">
            {foreign ? T('paidIn', { code: curr }) : T('amount')}
            {fromAI('amount')}
          </span>
          <input
            type="text"
            inputMode="decimal"
            className="num"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="lab">{T('currency')}{fromAI('currency')}</span>
          <select value={curr} onChange={(e) => setCurr(e.target.value as CurrencyCode)}>
            {FOREIGN.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        {/* 환율은 우리가 계산하지 않는다. 카드사가 청구한 금액을 그대로 받아 적는다. */}
        {foreign && (
          <label className="field">
            <span className="lab">{T('chargedIn', { code: currency })}</span>
            <input
              type="text"
              inputMode="decimal"
              className="num"
              value={charged}
              onChange={(e) => setCharged(e.target.value)}
            />
          </label>
        )}

        <label className="field">
          <span className="lab">{T('date')}{fromAI('date')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        <label className="field">
          <span className="lab">{T('vendor')}{fromAI('vendor')}</span>
          <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        </label>

        <label className="field">
          <span className="lab">{T('category')}{fromAI('category')}</span>
          <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} />
        </label>

        <label className="field">
          <span className="lab">{T('payer')}</span>
          <select value={payerId} onChange={(e) => setPayerId(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset style={{ marginTop: 26 }}>
        <legend>{T('whoSplits')}</legend>

        <label className="pick">
          <input
            type="radio"
            name="alloc"
            checked={kind === 'all'}
            onChange={() => setKind('all')}
          />
          <span>{T('wholeTeam', { n: roster.length })}</span>
        </label>

        <label className="pick">
          <input
            type="radio"
            name="alloc"
            checked={kind === 'partial'}
            onChange={() => setKind('partial')}
          />
          <span>{T('someOnly')}</span>
        </label>
        {kind === 'partial' && (
          <div className="pick-sub">
            {roster.map((id) => (
              <label key={id}>
                <input
                  type="checkbox"
                  checked={participants.includes(id)}
                  onChange={() => toggle(id)}
                />{' '}
                {name(id)}
              </label>
            ))}
          </div>
        )}

        <label className="pick">
          <input
            type="radio"
            name="alloc"
            checked={kind === 'personal'}
            onChange={() => setKind('personal')}
          />
          <span>{T('onePersonTakes')}</span>
        </label>
        {kind === 'personal' && (
          <div className="pick-sub">
            <label>
              {T('whoTakes')}{' '}
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </fieldset>

      <div className="fields" style={{ marginTop: 24 }}>
        <label className="field">
          <span className="lab">{T('productLink')}</span>
          <input
            type="text"
            value={productLink}
            onChange={(e) => setProductLink(e.target.value)}
            placeholder="https://"
          />
        </label>
        <label className="field">
          <span className="lab">{T('noteField')}</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      <div className="row" style={{ marginTop: 28 }}>
        <button className="act primary" onClick={save} disabled={busy}>
          {busy ? T('working') : T('writeToBook')}
        </button>
        <Link href={`/l/${ledgerId}`} className="plain">
          {T('giveUp')}
        </Link>
        {/* 저장하기 전에 어떻게 갈라지는지 미리 보여 준다. 저장한 뒤에 놀랄 일이 없어야 한다. */}
        {each.length > 0 && (
          <span className="faint">
            {T('perPerson', {
              n: bearers.length,
              amount:
                formatMoney(each[0], currency, lang) +
                (each.length > 1 ? ` / ${formatMoney(each[1], currency, lang)}` : ''),
            })}
          </span>
        )}
      </div>

      {CURRENCIES[currency] && foreign && (
        <p className="aside" style={{ marginTop: 18, maxWidth: 520 }}>
          {T('foreignNote', { from: curr, to: currency })}
        </p>
      )}
    </section>
  );
}
