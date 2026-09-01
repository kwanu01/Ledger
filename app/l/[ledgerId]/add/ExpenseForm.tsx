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
import { shrinkImage } from '../../../../lib/shrink.ts';
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
  /*
   * 영수증은 **남기는 것이 기본**이다.
   *
   * 처음에는 꺼 두었다. 영수증에는 카드 뒷번호와 매장과 시각이 찍혀 있고
   * 그게 팀원 전체에게 보이니까, 남길지는 올린 사람이 정하라는 뜻이었다.
   * 그런데 실제로는 대부분 남기고 싶어 한다 — 나중에 "이거 뭐였지" 하고
   * 되짚는 자리가 장부이기 때문이다. 켜는 것을 매번 기억해야 하는 쪽이
   * 끄는 것을 가끔 기억하는 쪽보다 훨씬 자주 어긋났다.
   *
   * 그래서 켜 두되, **끄는 자리를 사진 바로 아래**에 둔다. 무엇이 남는지
   * 보면서 끌 수 있어야 하기 때문이다.
   */
  const [keepPhoto, setKeepPhoto] = useState(true);
  /* 품목 사진 — 장부의 '품목' 화면에서 디더링되어 걸리는 그 사진이다.
     영수증은 얼마를 냈는지의 증거고, 이건 무엇을 샀는지의 기록이다.
     예전에는 지출을 적은 뒤 장부에서 다시 찾아 들어가야만 올릴 수 있었다. */
  const [item, setItem] = useState<File | null>(null);
  const [itemThumb, setItemThumb] = useState<string | null>(null);
  /** 나머지 칸을 펴 둘지. 넓은 화면에서는 처음부터 편다(아래 useEffect). */
  const [more, setMore] = useState(false);
  const [read, setRead] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const receiptRef = useRef<HTMLInputElement>(null);
  const itemRef = useRef<HTMLInputElement>(null);

  // 화면을 캡처해서 그대로 붙여넣는 편이 파일로 저장했다 고르는 것보다 빠르다.
  // 사진 받는 단계에 있을 때만 듣는다.
  /* 넓은 화면에서는 나머지 칸도 처음부터 펴 둔다. 자리가 있으니 접을 이유가 없다. */
  useEffect(() => {
    if (window.innerWidth > 640) setMore(true);
  }, []);

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

  async function analyze(original: File) {
    say('');
    setThumb(URL.createObjectURL(original));
    setStep('reading');

    /*
     * 올리기 전에 줄인다.
     *
     * 폰 사진은 4000픽셀에 4MB다. 그대로 보내면 올라가는 데, 실어 보내는 데,
     * 읽는 데 각각 시간이 붙어 20초를 넘긴다. 영수증 글자를 읽는 데 그만한
     * 해상도는 필요 없다(lib/shrink.ts).
     *
     * 남길 사진도 줄인 쪽으로 둔다. 장부에서 다시 볼 때도 이 크기면 충분하고,
     * 저장소도 덜 쓴다.
     */
    const file = await shrinkImage(original);
    setPhoto(file);

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

  /* 폼에서 영수증을 바꾸거나 새로 붙일 때. 여기서는 다시 읽지 않는다 —
     이미 손으로 적어 둔 칸을 사진 한 장이 덮어써 버리면 곤란하다. */
  async function pickReceipt(original: File) {
    const file = await shrinkImage(original);
    setPhoto(file);
    setThumb(URL.createObjectURL(file));
    setKeepPhoto(true);
  }

  async function pickItem(original: File) {
    const file = await shrinkImage(original);
    setItem(file);
    setItemThumb(URL.createObjectURL(file));
  }

  const foreign = curr !== currency;

  const name = (id: string) => members.find((m) => m.id === id)?.name ?? id;

  /* 해외 결제로 읽혔으면 통화 칸이 보여야 한다. 못 보고 지나가면 장부가 틀어진다. */
  useEffect(() => {
    if (foreign) setMore(true);
  }, [foreign]);

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
    const expenseId = r.value.id;
    async function put(kind: 'receipt' | 'item', file: File) {
      const fd = new FormData();
      fd.set('ledgerId', ledgerId);
      fd.set('expenseId', expenseId);
      fd.set('kind', kind);
      fd.set('image', file);
      const up = await attachImage(fd);
      if (!up.ok) say(up.message);
    }
    if (keepPhoto && photo) await put('receipt', photo);
    if (item) await put('item', item);

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

          {/*
            무엇을 찍어야 하는지, 사진이 어디로 가는지는 미리 알려 준다.
            다만 **화면 폭에 따라 얼마나 알려 줄지가 다르다.**

            넓은 화면에서는 세 줄짜리 표가 친절하다. 자리가 있으니까.
            폰에서는 같은 표가 벽이 된다 — 라벨 칸이 좁아 '읽어오/는 정보'로
            접히고, 단추 하나 누르러 온 사람이 여섯 줄을 먼저 읽어야 한다.
            끌어다 놓기도 Ctrl+V도 폰에는 없는 방법이라 더 그렇다.

            그래서 폰에는 한 줄만 남긴다. 무엇을 찍으면 되는지 하나.
            나머지는 눌러 보면 알게 되는 것들이다.
          */}
          <p className="drop-say">{T('photoShort')}</p>

          <table className="facts drop-table">
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

        {/*
          사진이 어디로 가는지는 줄이지 않는다. 줄일 것과 줄이면 안 되는 것은 다르다.
          대신 **한 문장에 한 줄**을 준다. 두 문장이 한 덩어리로 흐르면 어디서
          끊어 읽어야 하는지가 글자 크기와 화면 폭에 따라 매번 달라진다.
          문장이 줄을 하나씩 갖고 있으면 그 자리가 고정된다.
        */}
        <p className="aside" style={{ marginTop: 16, maxWidth: 520 }}>
          {T('photoSentTo')}
          <br />
          {T('photoSentTo2')}
        </p>

        {/* 사진 없이 가는 길. 사진 받는 판과 같은 축에 세운다 — 둘은
            나란한 두 갈래지 본문과 그 아래 딸린 말이 아니다. */}
        <p className="drop-out">
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
        {/* 읽는 동안에도 사진은 가운데. 왼쪽에 붙여 두면 판이 기울어 보인다. */}
        {thumb && (
          <div className="photopair" style={{ marginTop: 16 }}>
            <div className="photoslot">
              <img className="photoslot-img" src={thumb} alt={T('uploaded')} />
            </div>
          </div>
        )}
        <p className="muted" style={{ marginTop: 20, textAlign: 'center' }}>
          {T('reading')}
        </p>
        {/* 막다른 골목을 두지 않는다. 오래 걸린다 싶으면 손으로 적으면 된다.
            읽기가 끝나면 그때 채워지는 것이 아니라, 여기서 나간 사람은 그냥
            빈 폼을 쓴다. 기다림이 강제가 되어서는 안 된다. */}
        <p style={{ marginTop: 16 }}>
          <button className="plain" onClick={() => setStep('form')}>
            {T('writeManually')}
          </button>
        </p>
      </section>
    );
  }

  const fromAI = (f: string) => (read.includes(f) ? <span className="ai-mark">{T('fromAI')}</span> : null);

  return (
    <section>
      <div className="caption">{T('expenseEntry')}</div>

      {/*
        사진 두 자리 (§21.5)

        **영수증**은 얼마를 냈는지의 증거고, **품목 사진**은 무엇을 샀는지의
        기록이다. 둘은 다른 것인데 예전에는 여기서 영수증만 받았고, 품목
        사진은 지출을 다 적은 뒤에 장부에서 그 줄을 다시 찾아 들어가야
        올릴 수 있었다. 물건을 사고 사진을 찍는 것은 같은 순간에 일어나는
        일이니, 적는 자리도 같아야 한다.

        두 자리를 나란히 두고 가운데로 모은다. 사진은 글이 아니라 물건이라,
        줄의 시작선에 맞출 것이 아니라 판 안에 놓이는 편이 맞다.
      */}
      <div className="photopair">
        <div className="photoslot">
          <div className="caption">{T('receipt')}</div>
          {thumb ? (
            <>
              <img className="photoslot-img" src={thumb} alt={T('uploaded')} />
              {/* 남길지 끌지는 무엇이 남는지 보면서 정한다. 그래서 사진 바로 아래다. */}
              <label className="keepline">
                <input
                  type="checkbox"
                  checked={keepPhoto}
                  onChange={(e) => setKeepPhoto(e.target.checked)}
                />
                <span>{T('keepReceipt')}</span>
              </label>
              <button className="plain" onClick={() => receiptRef.current?.click()}>
                {T('replacePhoto')}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="empty-plate"
              onClick={() => receiptRef.current?.click()}
            >
              <span className="plus" aria-hidden="true">+</span>
              <span>{T('addReceiptHere')}</span>
            </button>
          )}
          <input
            ref={receiptRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickReceipt(f);
            }}
          />
        </div>

        <div className="photoslot">
          <div className="caption">{T('itemPhoto')}</div>
          {itemThumb ? (
            <>
              <img className="photoslot-img" src={itemThumb} alt={T('itemPhoto')} />
              <button className="plain" onClick={() => itemRef.current?.click()}>
                {T('replacePhoto')}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="empty-plate"
              onClick={() => itemRef.current?.click()}
            >
              <span className="plus" aria-hidden="true">+</span>
              <span>{T('addItemPhotoHere')}</span>
            </button>
          )}
          <input
            ref={itemRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) pickItem(f);
            }}
          />
        </div>
      </div>

      <div className="fields" style={{ marginTop: 22 }}>
        <label className="field wide">
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

      {/*
        나머지 칸 (§21.5)

        지출 한 줄을 적는 데 꼭 있어야 하는 것은 항목·금액·날짜·결제자·나눌
        사람 다섯이다. 통화는 대개 장부의 통화 그대로고, 판매처와 분류와 구매
        링크와 메모는 있으면 좋은 것이지 없으면 못 적는 것이 아니다.

        폰에서는 그 다섯이 이미 한 화면을 다 쓴다. 나머지를 같이 펼쳐 두면
        스크롤이 길어지고, 꼭 채워야 하는 칸처럼 보인다. 그래서 접어 두고
        필요한 사람만 편다. 넓은 화면에서는 자리가 있으니 처음부터 펴 둔다.

        해외 결제일 때는 접지 않는다. 통화를 못 보고 지나가면 장부가 통째로
        틀어진다.
      */}
      <div className="more" style={{ marginTop: 24 }}>
        {!more && (
          <button className="plain" onClick={() => setMore(true)}>
            {T('moreFields')}
          </button>
        )}

        {more && (
          <div className="fields">
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
            <label className="field">
              <span className="lab">{T('vendor')}{fromAI('vendor')}</span>
              <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} />
            </label>
            <label className="field">
              <span className="lab">{T('category')}{fromAI('category')}</span>
              <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} />
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
        )}
      </div>

      {/* 마무리 줄. 폰에서는 화면 아래에 붙어 따라온다 — 다 적고 나서
          저장 단추를 찾아 스크롤을 되짚어 내려가지 않게. */}
      <div className="formbar">
        {/* 저장하기 전에 어떻게 갈라지는지 미리 보여 준다. 저장한 뒤에 놀랄 일이 없어야 한다. */}
        {each.length > 0 && (
          <span className="split-say">
            {T('perPerson', {
              n: bearers.length,
              amount:
                formatMoney(each[0], currency, lang) +
                (each.length > 1 ? ` / ${formatMoney(each[1], currency, lang)}` : ''),
            })}
          </span>
        )}
        <button className="act primary" onClick={save} disabled={busy}>
          {busy ? T('working') : T('writeToBook')}
        </button>
        <Link href={`/l/${ledgerId}`} className="plain">
          {T('giveUp')}
        </Link>
      </div>

      {CURRENCIES[currency] && foreign && (
        <p className="aside" style={{ marginTop: 18, maxWidth: 520 }}>
          {T('foreignNote', { from: curr, to: currency })}
        </p>
      )}
    </section>
  );
}
