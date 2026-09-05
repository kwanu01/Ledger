'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { recordExpense, recordExpenses } from '../../../actions/ledger.ts';
import { MAX_BATCH } from '../../../../lib/limits.ts';
import { attachImage } from '../../../actions/images.ts';
import { analyzeReceipt, analyzeReceiptLines, jotExpense } from '../../../actions/receipt.ts';
import { lookUpRate } from '../../../actions/fx.ts';
import { splitEvenly } from '../../../../lib/domain/settlement.ts';
import { recallFor, type Recallable } from '../../../../lib/domain/recall.ts';
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
import ItemLines, { newDraft, toItemLines, type Draft } from './ItemLines.tsx';
import BatchRows, { batchSum, ready as rowReady, type Row } from './BatchRows.tsx';
import { shrinkImage, tooBigToSend } from '../../../../lib/shrink.ts';
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
  groups,
  categories,
  vendors,
  past,
  currency,
  meId,
  today,
  lang,
}: {
  ledgerId: string;
  members: Member[];
  roster: string[];
  /** 이 장부에 이미 쓰인 묶음 이름들 (§11.3). 고르는 목록으로 쓴다. */
  groups: string[];
  /** 이미 쓴 분류·판매처. 자유 입력 칸의 갈라짐을 줄인다 (§11.4). */
  categories: string[];
  vendors: string[];
  /** 되돌아볼 지난 기록. 세는 데 필요한 칸만 온다 (lib/domain/recall.ts). */
  past: Recallable[];
  currency: CurrencyCode;
  meId: string;
  today: string;
  lang: Locale;
}) {
  const router = useRouter();
  // 경고는 도우미 말풍선 한 자리로 모인다(app/helper).
  const { say } = useHelper();
  const T = translator(lang);
  const groupListId = useId();
  const catListId = useId();
  const vendorListId = useId();

  const [title, setTitle] = useState('');
  const [curr, setCurr] = useState<CurrencyCode>(currency);
  const [amount, setAmount] = useState('');
  const [charged, setCharged] = useState('');
  const [date, setDate] = useState(today);
  const [vendor, setVendor] = useState('');
  const [category, setCategory] = useState('');
  const [group, setGroup] = useState('');
  const [payerId, setPayerId] = useState(meId);
  const [kind, setKind] = useState<Allocation['type']>('all');
  const [participants, setParticipants] = useState<string[]>(roster);
  const [ownerId, setOwnerId] = useState(meId);
  /* 항목별 청구 (§10.4) — 영수증 한 장 안에서 줄마다 부담자가 다를 때 */
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [readingLines, setReadingLines] = useState(false);
  /* 한 줄로 적기 (§11.4) — 사진도 폼도 아닌 세 번째 문 */
  const [line, setLine] = useState('');
  const [jotting, setJotting] = useState(false);
  /* 몰아서 적기 (§11.4) — 사진 여러 장을 한꺼번에 던졌을 때 */
  const [rows, setRows] = useState<Row[]>([]);
  const [big, setBig] = useState<string | null>(null);
  const [productLink, setProductLink] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * 그날의 환율 (§21.14)
   *
   * 장부에 적히는 것은 언제나 **실제로 청구된 금액**이다. 카드사가 이미
   * 환산해서 청구했고, 그 환율은 우리가 보는 것과 다르다 — 전신환매도율에
   * 해외 수수료가 붙고 매입일도 며칠 어긋난다. 우리가 계산한 숫자를 넣으면
   * 통장에서 빠져나간 금액과 다른 숫자가 팀원들 사이에 나뉜다.
   *
   * 그래서 환율은 두 가지만 한다 — 청구액을 모르면 **미리 채워 주고**,
   * 적었으면 얼마나 벌어지는지 **알려만 준다.** 막지 않는다.
   */
  const [fx, setFx] = useState<{ rate: number; on: string } | null>(null);

  // 사진 먼저, 폼은 그다음. 손으로 적겠다고 하면 곧장 빈 폼으로 간다.
  const [step, setStep] = useState<'photo' | 'reading' | 'batch' | 'form'>('photo');
  /** 읽기가 길어지고 있는가. 잠자코 기다리게 두지 않으려고 둔다. */
  const [slow, setSlow] = useState(false);
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
  const [read, setRead] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const receiptRef = useRef<HTMLInputElement>(null);
  const itemRef = useRef<HTMLInputElement>(null);

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

  /*
   * 기다림에 끝을 둔다 (client)
   *
   * 서버에도 끝이 있다(lib/ai/receipt.ts, 9초). 그런데 그 끝은 **모델을 부르는
   * 구간**에만 걸린다. 사람이 실제로 기다리는 시간은 사진을 올려 보내는
   * 시간까지 포함하고, 그 구간은 폰의 회선에 달렸다. 서버 쪽이 멀쩡히 끊겨도
   * 그 대답이 돌아오지 못하면 화면에는 '읽는 중'만 남는다.
   *
   * 그래서 이쪽에도 끝을 둔다. 이쪽이 더 길다 — 서버가 스스로 끊고 이유를
   * 말할 기회를 먼저 주고, 그 말조차 오지 않을 때만 여기서 끊는다.
   */
  const WAIT_MS = 15000;
  /** 이만큼 지나면 '조금 더 걸린다'고 알린다. 잠자코 있으면 멈춘 줄 안다. */
  const SLOW_MS = 6000;
  /** 몇 번째 읽기인가. 사람이 먼저 나가 버린 뒤 도착한 대답을 버리는 데 쓴다. */
  const runId = useRef(0);

  /*
   * 사진 여러 장 (§11.4)
   *
   * 한 장이면 지금까지처럼 읽어서 폼으로 간다. 두 장부터는 다른 화면이다 —
   * 폼 한 벌에 열 장을 담을 수 없기 때문이다.
   *
   * 읽기는 **한 장씩 차례로** 한다. 열 장을 동시에 던지면 서버 액션 열 개가
   * 한꺼번에 뜨고, 월 상한 검사도 서로를 못 본 채 열 번 통과한다. 차례로
   * 읽으면 상한이 상한답게 걸리고, 화면은 몇 장째인지 말해 줄 수 있다.
   */
  async function takeMany(files: File[]) {
    say('');
    const picked = files.slice(0, MAX_BATCH);
    if (files.length > MAX_BATCH) say(T('batchSaveAll', { n: MAX_BATCH }));

    const seeded: Row[] = picked.map((f, i) => ({
      key: `b${Date.now()}-${i}`,
      file: f,
      thumb: URL.createObjectURL(f),
      reading: true,
      title: '',
      amount: '',
      date: today,
      payerId: meId,
    }));
    setRows(seeded);
    setStep('batch');

    for (const [i, row] of seeded.entries()) {
      const small = await shrinkImage(row.file);
      if (tooBigToSend(small)) {
        setRows((prev) =>
          prev.map((r) => (r.key === row.key ? { ...r, reading: false, failed: T('photoTooBig') } : r)),
        );
        continue;
      }

      const fd = new FormData();
      fd.set('ledgerId', ledgerId);
      fd.set('image', small);
      const r = await analyzeReceipt(fd);

      setRows((prev) =>
        prev.map((x) => {
          if (x.key !== row.key) return x;
          // 줄인 사진으로 갈아 둔다. 저장할 때 붙는 것도 이 사진이다.
          const base = { ...x, file: small, reading: false };
          if (!r.ok) return { ...base, failed: r.message };
          return {
            ...base,
            title: r.value.title,
            amount: formatNumber(r.value.amount, currency, lang),
            date: r.value.date ?? x.date,
            vendor: r.value.vendor,
            category: r.value.category,
          };
        }),
      );
      // 화면이 몇 장째인지 말한다. 열 장이면 꽤 걸린다.
      if (i < seeded.length - 1) say(T('batchReading', { done: i + 1, n: seeded.length }));
    }
    say(T('batchTitle', { n: picked.length }));
  }

  /** 훑은 줄들을 한꺼번에 적는다. 사진은 줄이 생긴 뒤에 붙는다. */
  async function saveBatch() {
    const keep = rows.filter((r) => rowReady(r, currency));
    if (keep.length === 0) return say(T('batchNeed'));

    setBusy(true);
    const r = await recordExpenses({
      ledgerId,
      rows: keep.map((x) => ({
        date: x.date,
        title: x.title.trim(),
        amount: parseMoney(x.amount, currency),
        payerId: x.payerId,
        allocation: { type: 'all' as const },
        vendor: x.vendor,
        category: x.category,
      })),
    });
    if (!r.ok) {
      setBusy(false);
      return say(r.message);
    }

    /*
     * 사진은 줄이 적힌 뒤에 붙는다. 붙이다 실패해도 줄은 남는다 —
     * 사진이 없는 줄은 고쳐 붙일 수 있지만, 줄이 없으면 아무것도 없다.
     */
    for (const { at, id } of r.value.saved) {
      const src = keep[at];
      if (!src) continue;
      const fd = new FormData();
      fd.set('ledgerId', ledgerId);
      fd.set('expenseId', id);
      fd.set('kind', 'receipt');
      fd.set('image', src.file);
      await attachImage(fd).catch(() => {});
    }

    setBusy(false);
    const bad = r.value.failed.length;
    say(
      bad === 0
        ? T('batchDone', { n: r.value.saved.length })
        : T('batchSome', { ok: r.value.saved.length, bad }),
    );
    router.push(`/l/${ledgerId}/book`);
  }

  async function analyze(original: File) {
    const mine = ++runId.current;
    say('');
    setSlow(false);
    setThumb(URL.createObjectURL(original));
    setStep('reading');

    const slowBell = setTimeout(() => {
      if (runId.current === mine) setSlow(true);
    }, SLOW_MS);

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
    if (runId.current !== mine) return;
    /* 줄이기가 실패했을 수 있다. 그대로 보내면 서버 액션 상한에 걸려
       우리가 잡을 수 없는 오류가 난다 — 여기서 말하고 폼으로 넘긴다. */
    if (tooBigToSend(file)) {
      runId.current += 1;
      say(T('photoTooBig'));
      setStep('form');
      return;
    }
    setPhoto(file);

    const fd = new FormData();
    fd.set('ledgerId', ledgerId);
    fd.set('image', file);

    /*
     * 먼저 오는 쪽을 받는다 — 대답이거나, 우리가 정한 끝이거나.
     *
     * 서버 일을 실제로 멈출 수는 없다. 다만 그 결과를 **쓰지 않는다.**
     * 값이 이미 손으로 적힌 칸을 늦게 도착한 대답이 덮어써 버리면,
     * 사람이 방금 적은 것이 눈앞에서 바뀐다. 그것이 기다리는 것보다 나쁘다.
     */
    const r = await Promise.race([
      analyzeReceipt(fd),
      new Promise<null>((done) => setTimeout(() => done(null), WAIT_MS)),
    ]);
    clearTimeout(slowBell);

    // 사람이 먼저 '직접 적기'로 나갔다. 이 대답은 버린다.
    if (runId.current !== mine) return;

    if (r === null) {
      // 스스로 그만둔다. 사진은 남겨 두고 손으로 마저 적게 한다.
      runId.current += 1;
      say(T('readGaveUp'));
      setStep('form');
      return;
    }

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
    if (tooBigToSend(file)) return say(T('photoTooBig'));
    setPhoto(file);
    setThumb(URL.createObjectURL(file));
    setKeepPhoto(true);
  }

  async function pickItem(original: File) {
    const file = await shrinkImage(original);
    if (tooBigToSend(file)) return say(T('photoTooBig'));
    setItem(file);
    setItemThumb(URL.createObjectURL(file));
  }

  const foreign = curr !== currency;

  const name = (id: string) => members.find((m) => m.id === id)?.name ?? id;

  /* 통화나 날짜가 달라지면 그날 환율을 다시 묻는다. 지난달에 산 것을 오늘
     적을 수도 있고, 그때는 오늘 환율이 아니라 그날 환율로 재야 한다. */
  useEffect(() => {
    if (!foreign) return setFx(null);
    let alive = true;
    setFx(null);
    lookUpRate({ ledgerId, from: curr, to: currency, date })
      .then((r) => alive && setFx(r))
      .catch(() => alive && setFx(null));
    return () => {
      alive = false;
    };
  }, [foreign, curr, currency, date, ledgerId]);

  // 장부에 적히는 금액은 언제나 장부의 통화다. 해외 결제면 청구액 칸이 그 자리를 대신한다.
  const booked = foreign ? parseMoney(charged, currency) : parseMoney(amount, currency);

  /* 환율로 재 본 값. 적어 넣은 청구액과 나란히 두면 자릿수 실수가 눈에 띈다. */
  const paidAbroad = parseMoney(amount, curr);
  const guess =
    fx && paidAbroad > 0
      ? Math.round((paidAbroad / 10 ** (CURRENCIES[curr]?.decimals ?? 0)) * fx.rate *
          10 ** (CURRENCIES[currency]?.decimals ?? 0))
      : 0;
  const gap = guess > 0 && booked > 0 ? ((booked - guess) / guess) * 100 : null;

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

  /*
   * 영수증을 줄 단위로 읽는다 (§10.4)
   *
   * 처음 사진을 올릴 때는 하지 않는다. 총액 하나를 읽는 것보다 오래 걸리고
   * 값도 더 나가는데, 항목별로 나눌 영수증은 전체의 일부다. 사람이
   * "항목별로 나눠 청구"를 고른 뒤에, 이미 손에 들고 있는 사진으로 부른다.
   *
   * 읽어 온 줄을 기존 줄에 **덧붙이지 않고 갈아 끼운다.** 두 번 눌렀을 때
   * 줄이 두 벌이 되면 합계가 두 배가 되는데, 그건 눈에 잘 띄지 않는다.
   */
  const LINE_WAIT_MS = 30000;

  /*
   * 한 줄로 적기 (§11.4)
   *
   * 사진도 폼도 아닌 세 번째 문이다. "어제 호미화방에서 폼보드 2만7천,
   * 다 같이" 한 줄이면 칸이 채워진다.
   *
   * **저장하지 않는다.** 채워 넣고 폼으로 넘길 뿐이고, 못 읽은 칸은
   * 무엇이 비었는지 말한다. 짐작해서 채운 값은 확인할 방법이 없어서
   * 빈칸보다 나쁘다 — 이 자리의 규칙은 영수증 읽기와 같다(§7).
   */
  async function writeLine() {
    const text = line.trim();
    if (!text) return say(T('jotEmpty'));

    say('');
    setJotting(true);
    const r = await jotExpense({ ledgerId, text });
    setJotting(false);
    if (!r.ok) return say(r.message);

    const v = r.value;
    setTitle(v.title);
    if (v.amount) setAmount(formatNumber(v.amount, currency, lang));
    if (v.date) setDate(v.date);
    if (v.vendor) setVendor(v.vendor);
    if (v.category) setCategory(v.category);
    if (v.payerId) setPayerId(v.payerId);
    if (v.allocation) {
      setKind(v.allocation.type);
      if (v.allocation.type === 'partial') setParticipants(v.allocation.participantIds);
      if (v.allocation.type === 'personal') setOwnerId(v.allocation.ownerId);
    }

    /* 어느 칸이 AI 가 채운 것인지 표시해 둔다. 사람이 무엇을 확인해야 하는지
       알 수 있어야 하고, 그건 영수증으로 읽었을 때와 같은 규칙이다. */
    setRead(
      (['title', 'amount', 'date', 'vendor', 'category'] as const).filter(
        (k) => v[k] !== undefined && v[k] !== '',
      ),
    );
    setStep('form');

    const what = v.missing
      .filter((m) => ['amount', 'payer', 'bearers'].includes(m))
      .map((m) =>
        T(m === 'amount' ? 'jotMissAmount' : m === 'payer' ? 'jotMissPayer' : 'jotMissBearers'),
      );
    say(what.length > 0 ? T('jotMissing', { what: what.join(', ') }) : T('jotFilled'));
  }

  /*
   * 장부가 이미 아는 것 (§11.4)
   *
   * 판매처(없으면 항목 이름)로 지난 기록을 되짚어, 되풀이된 값을 찾는다.
   * 전부 순수 함수라 서버를 부르지 않는다 — 세는 일에 모델을 쓸 이유가 없다.
   *
   * 값을 몰래 채우지 않고 **몇 번 중 몇 번이었는지와 함께** 제안한다.
   * 조용히 채워진 '재료비'는 확인할 방법이 없고, 확인할 수 없는 값은
   * 없는 값보다 나쁘다.
   */
  const recall = recallFor(past, { vendor, title });

  /*
   * 제안에 붙일 짧은 이름.
   *
   * 장부의 표에서는 '일부 2인'으로 적는다(lib/labels.ts) — 칸이 좁고 이름은
   * 옆 칸에 이미 있어서다. 여기는 다르다. "지난 3번 중 3번 일부 2인"은
   * 어느 둘인지 말해 주지 않아서 누를지 말지를 정할 수가 없다. 이름을 적는다.
   */
  const whoName = (id: string) => members.find((m) => m.id === id)?.name ?? id;
  function bearsSay(a: Allocation): string {
    if (a.type === 'all') return T('wholeTeam', { n: roster.length });
    if (a.type === 'partial') return a.participantIds.map(whoName).join(' · ');
    if (a.type === 'personal') return T('allocPersonal', { who: whoName(a.ownerId) });
    return '';
  }

  async function pullLines() {
    say('');
    if (!photo) return say(T('needPhotoFirst'));

    setReadingLines(true);
    const fd = new FormData();
    fd.set('ledgerId', ledgerId);
    fd.set('image', photo);

    const r = await Promise.race([
      analyzeReceiptLines(fd),
      new Promise<null>((done) => setTimeout(() => done(null), LINE_WAIT_MS)),
    ]);
    setReadingLines(false);

    if (r === null) return say(T('linesGaveUp'));
    if (!r.ok) return say(r.message);

    const v = r.value;

    /*
     * 다른 통화로 적힌 영수증은 줄을 채우지 않는다.
     *
     * 장부에 적히는 금액은 언제나 **실제로 청구된 장부 통화 금액**이다
     * (§21.14). 환율은 우리가 계산하지 않는다. 그러니 엔화로 읽어 온
     * 줄들을 원화 장부에 그대로 채워 넣으면, 합계는 맞아 보이는데
     * 장부의 숫자는 통째로 틀린다. 조용히 틀리는 것이 가장 나쁘다.
     */
    if (v.currency !== currency) {
      return say(T('linesForeign', { code: v.currency, book: currency }));
    }

    setDrafts(
      v.lines.map((l) =>
        newDraft({
          // 수량이 여럿이면 이름에 남긴다. 그래야 누가 시킨 것인지 알아본다.
          name: l.qty > 1 ? `${l.name} ×${l.qty}` : l.name,
          amount: formatNumber(l.amount, currency, lang),
          // 배달비·수수료는 처음부터 모두로 둔다. 대개 그것이 맞고,
          // 아니면 단추 한 번으로 푼다. 시킨 것은 비워 둔다 — 우리는 모른다.
          memberIds: l.kind === 'item' ? [] : [...roster],
        }),
      ),
    );

    /* 읽어 온 총액으로 금액 칸도 채운다. 여기까지 왔으면 그 금액은 장부
       통화이므로, 장부 통화를 담는 칸에 넣는다 — 해외 결제 중이면 청구액
       칸이 그 자리다. 줄의 합과 맞는지는 화면이 늘 보여 준다. */
    if (v.total > 0) (foreign ? setCharged : setAmount)(formatNumber(v.total, currency, lang));
    if (v.vendor && !vendor) setVendor(v.vendor);
    if (v.date && !read.includes('date')) setDate(v.date);
    if (v.title && !title.trim()) setTitle(v.title);

    say(T(v.balanced ? 'linesRead' : 'linesReadOff', { n: v.lines.length }));
  }


  async function save() {
    say('');
    if (!title.trim()) return say(T('needTitle'));
    if (!booked) return say(foreign ? T('needCharged', { code: currency }) : T('needAmount'));
    if (kind === 'partial' && participants.length === 0) {
      return say(T('needBearers'));
    }

    let lines: ReturnType<typeof toItemLines> = [];
    if (kind === 'items') {
      /*
       * 여기서 세 가지를 본다. 서버도 DB도 같은 것을 본다(§10.4).
       * 세 겹으로 두는 이유는, 어긋난 줄이 통과하면 정산 화면의 숫자가
       * 조용히 틀리기 때문이다. 틀린 채로 송금까지 끝나면 되돌릴 길이 없다.
       */
      lines = toItemLines(drafts, currency).filter((l) => l.name !== '' || l.amount !== 0);
      if (lines.length === 0) return say(T('needLines'));
      if (lines.some((l) => l.memberIds.length === 0)) return say(T('needLineWho'));
      const sum = lines.reduce((a, l) => a + l.amount, 0);
      if (sum !== booked) {
        return say(
          T('sumOff', {
            gap: `${sum - booked > 0 ? '+' : '−'}${formatNumber(Math.abs(sum - booked), currency, lang)}`,
          }),
        );
      }
      // 이름이 없는 줄은 DB 가 막는다. 여기서 자리 이름을 붙여 준다.
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
      group: group.trim() || undefined,
      productLink: productLink.trim() || undefined,
      note: note.trim() || undefined,
    });
    if (!r.ok) {
      setBusy(false);
      return say(r.message);
    }

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

    /*
     * 적고 나면 장부로 간다.
     *
     * 여기 push 뒤에 refresh 가 한 줄 더 있었다. 그 두 줄이 서로를 밟았다 —
     * recordExpense 가 revalidatePath 로 이 장부의 layout 을 통째로 무르므로,
     * push 로 시작한 이동이 끝나기 전에 refresh 가 **지금 있는 화면**을 다시
     * 그린다. 그러면 이동이 취소되고 기입 화면에 그대로 남는다. 지출은 이미
     * 적혔으니, 사람 눈에는 '눌렀는데 아무 일도 안 일어난' 것이 된다.
     *
     * 무르는 일은 서버가 이미 했다. 여기서는 옮기기만 하면 된다.
     *
     * replace 인 이유 — 다 적고 넘어간 기입 화면으로 뒤로 가기가 돌아오면
     * 방금 적은 것을 또 적게 된다.
     */
    router.replace(`/l/${ledgerId}/book`);
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
            const got = [...e.dataTransfer.files].filter((x) => x.type.startsWith('image/'));
            if (got.length === 1) analyze(got[0]);
            else if (got.length > 1) takeMany(got);
          }}
        >
          <label className="act primary">
            {T('pickPhoto')}
            {/* 여러 장을 한꺼번에 고를 수 있다. 한 장이면 지금까지와 같고,
                두 장부터는 몰아서 적는 화면으로 간다 (§11.4). */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                const got = [...(e.target.files ?? [])];
                if (got.length === 1) analyze(got[0]);
                else if (got.length > 1) takeMany(got);
                e.target.value = '';
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

        {/*
          세 번째 문 — 한 줄로 적기 (§11.4)

          사진을 찍어 두는 것도 일이고 칸 여섯 개를 채우는 것도 일이다.
          그런데 사람은 그 자리에서 이미 말로 알고 있다. 말한 것을 그대로
          받아 적는 길을 두면 미룰 이유가 하나 줄어든다. 기입이 밀리면
          장부는 죽으므로, 이 자리는 사진 다음이 아니라 사진 옆이다.
        */}
        <div className="jot">
          <div className="caption">{T('jotOr')}</div>
          <div className="jot-row">
            <input
              type="text"
              value={line}
              placeholder={T('jotPlace')}
              maxLength={300}
              onChange={(e) => setLine(e.target.value)}
              onKeyDown={(e) => {
                // 한글 조합 중의 Enter 는 글자를 고르는 것이지 보내는 것이 아니다.
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                e.preventDefault();
                writeLine();
              }}
            />
            <button className="act" disabled={jotting} onClick={writeLine}>
              <span className={`swap${jotting ? ' on' : ''}`}>
                <span className="rest">{T('jotDo')}</span>
                <span className="wait">{T('jotDoing')}</span>
              </span>
            </button>
          </div>
        </div>

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

  if (step === 'batch') {
    const keep = rows.filter((r) => rowReady(r, currency));
    const busyReading = rows.some((r) => r.reading);
    return (
      <section>
        <div className="caption">{T('expenseEntry')}</div>

        <BatchRows
          rows={rows}
          onRows={setRows}
          members={members}
          roster={roster}
          currency={currency}
          lang={lang}
          onOpen={setBig}
        />

        {/*
          훑고 나서 "이게 다 맞나"를 한 숫자로 확인하는 자리.
          몇 줄이 적히는지, 합이 얼마인지. 빠지는 줄이 있으면 그것도 말한다 —
          조용히 빼고 성공했다고 하면 사람은 열 줄을 적은 줄 안다.
        */}
        <div className="batch-foot">
          <span className="lab">{T('batchOf', { n: keep.length })}</span>
          <strong className="num">{batchSum(rows, currency, lang)}</strong>
          {keep.length < rows.length && (
            <span className="debit">{T('batchNeed')}</span>
          )}
        </div>

        <div className="row" style={{ marginTop: 20 }}>
          <button
            className={`act primary${busy ? ' waiting' : ''}`}
            disabled={busy || busyReading || keep.length === 0}
            onClick={saveBatch}
          >
            <span className={`swap${busy ? ' on' : ''}`}>
              <span className="rest">{T('batchSaveAll', { n: keep.length })}</span>
              <span className="wait">{T('batchSaving')}</span>
            </span>
          </button>
          <button
            className="plain"
            disabled={busy}
            onClick={() => {
              setRows([]);
              setStep('photo');
            }}
          >
            {T('close')}
          </button>
        </div>

        {/* 사진을 크게 본다. 대조는 이 자리에서 일어난다. */}
        {big && (
          <div className="lightbox" role="dialog" onClick={() => setBig(null)}>
            <figure onClick={(e) => e.stopPropagation()}>
              <img src={big} alt="" />
            </figure>
          </div>
        )}
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
        {/* 길어지면 길어진다고 말한다. 아무 말도 없으면 멈춘 줄 안다. */}
        {slow && (
          <p className="faint" style={{ marginTop: 6, textAlign: 'center' }}>
            {T('stillReading')}
          </p>
        )}
        {/* 막다른 골목을 두지 않는다. 오래 걸린다 싶으면 손으로 적으면 된다.
            나가면서 runId 를 올린다 — 그래야 늦게 도착한 대답이 이미 손으로
            적어 둔 칸을 덮어쓰지 못한다. */}
        <p style={{ marginTop: 16, textAlign: 'center' }}>
          <button
            className="plain"
            onClick={() => {
              runId.current += 1;
              setStep('form');
            }}
          >
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

        {/*
          환율은 우리가 계산하지 않는다. 카드사가 청구한 금액을 그대로 받아
          적는다. 다만 **그 숫자가 그럴듯한지는 재 준다.**

          비어 있으면 그날 환율로 계산한 값을 눌러서 채울 수 있다. 채운 뒤에도
          고칠 수 있다 — 카드 명세서가 오면 그 숫자가 맞다.

          적었으면 얼마나 벌어지는지 적어 준다. 5% 안쪽은 정상이다(해외 이용
          수수료 1~2% + 매입일 차이). 그보다 크게 벌어지면 자릿수를 의심할
          만하니 붉게 적는다. 막지는 않는다 — 실제 청구액이 우리 계산보다 늘
          옳다.
        */}
        {foreign && (
          <label className="field">
            <span className="lab">
              {T('chargedIn', { code: currency })}
              {fx && <span className="ai-mark">{T('rateOn', { date: fx.on })}</span>}
            </span>
            <input
              type="text"
              inputMode="decimal"
              className="num"
              value={charged}
              onChange={(e) => setCharged(e.target.value)}
            />
            {guess > 0 && (
              <span className="fxnote">
                {booked > 0 ? (
                  <span className={gap !== null && Math.abs(gap) > 5 ? 'debit' : 'muted'}>
                    {T('rateSays', {
                      amount: formatMoney(guess, currency, lang),
                      gap: gap === null ? '0' : (gap > 0 ? '+' : '') + gap.toFixed(1),
                    })}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="plain"
                    onClick={() => setCharged(formatNumber(guess, currency, lang))}
                  >
                    {T('useRate', { amount: formatMoney(guess, currency, lang) })}
                  </button>
                )}
              </span>
            )}
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
      {/* 지난 기록이 아는 것. 근거를 그대로 적고, 누르면 그렇게 채운다. */}
      {recall?.allocation && kind !== recall.allocation.value.type && (
        <p className="recall">
          <span>
            {T(recall.allocation.sameVendor ? 'recallSame' : 'recallLike', {
              by: recall.by,
              times: recall.allocation.times,
              of: recall.allocation.of,
              value: bearsSay(recall.allocation.value),
            })}
          </span>
          <button
            type="button"
            className="plain"
            onClick={() => {
              const a = recall.allocation!.value;
              setKind(a.type);
              if (a.type === 'partial') setParticipants(a.participantIds);
              if (a.type === 'personal') setOwnerId(a.ownerId);
            }}
          >
            {T('recallUse')}
          </button>
        </p>
      )}


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

        {/*
          항목별 청구 (§10.4)

          앞의 셋 다음에 둔다. 대부분의 지출은 여전히 다 같이 낸 것이고,
          이건 배달처럼 한 장 안에서 부담이 갈릴 때만 고르는 자리다.
          맨 위에 두면 매번 지나쳐야 하는 문이 된다.
        */}
        <label className="pick">
          <input
            type="radio"
            name="alloc"
            checked={kind === 'items'}
            onChange={() => {
              setKind('items');
              // 처음 고르면 빈 줄 하나. 무엇을 하는 자리인지 보여야 한다.
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
            roster={roster}
            currency={currency}
            lang={lang}
            total={booked}
            onTotal={(n) => (foreign ? setCharged : setAmount)(formatNumber(n, currency, lang))}
            onRead={pullLines}
            reading={readingLines}
          />
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

        한때 이 칸들을 접어 두었다. 지출 한 줄을 적는 데 꼭 있어야 하는 것은
        항목·금액·날짜·결제자·나눌 사람 다섯이고, 판매처와 카테고리와 구매
        링크와 메모는 없어도 적을 수 있다 — 그러니 필요한 사람만 펴라는 뜻이었다.

        접어 두니 **카테고리가 안 채워졌다.** 카테고리는 나중에 이 장부를
        다시 읽을 때 제일 쓸모 있는 칸인데, 접혀 있으면 그런 칸이 있다는 것
        자체를 모른다. 있는 줄 모르는 칸은 없는 칸이다.

        그래서 다 펴 둔다. 채우고 말고는 적는 사람이 정할 일이고, 우리가 할
        일은 무엇을 적을 수 있는지 보여 주는 것까지다. 빈 칸으로 남는 것은
        아무 문제가 되지 않는다 — 장부의 칸은 원래 그렇다.
      */}
      <div className="fields" style={{ marginTop: 24 }}>
        {/*
          분류와 판매처는 자유롭게 적는 칸이다. 자유롭게 적으면 '식비'와
          '식대'와 '밥값'이 따로 선다. 쓰던 것을 먼저 보여 주는 것만으로
          그 갈라짐이 크게 준다 — 고르게 강제하지 않으면서.
        */}
        <label className="field">
          <span className="lab">{T('category')}{fromAI('category')}</span>
          <input type="text" list={catListId} value={category}
            onChange={(e) => setCategory(e.target.value)} />
          <datalist id={catListId}>
            {categories.map((c) => <option key={c} value={c} />)}
          </datalist>
          {recall?.category && category.trim() !== recall.category.value && (
            <span className="recall">
              <span>
                {T(recall.category.sameVendor ? 'recallSame' : 'recallLike', {
                  by: recall.by,
                  times: recall.category.times,
                  of: recall.category.of,
                  value: recall.category.value,
                })}
              </span>
              <button type="button" className="plain"
                onClick={() => setCategory(recall.category!.value)}>
                {T('recallUse')}
              </button>
            </span>
          )}
        </label>
        <label className="field">
          <span className="lab">{T('vendor')}{fromAI('vendor')}</span>
          <input type="text" list={vendorListId} value={vendor}
            onChange={(e) => setVendor(e.target.value)} />
          <datalist id={vendorListId}>
            {vendors.map((v) => <option key={v} value={v} />)}
          </datalist>
        </label>

        {/*
          묶음 (§11.3)

          자유롭게 적되 **이미 쓴 이름이 먼저 보인다.** 목록에서 고르게만 하면
          새 묶음을 만들 때 따로 만드는 자리를 찾아야 하고, 그냥 적게만 하면
          '1차 MT'와 '1차MT'가 따로 선다. datalist 는 둘 다 된다.
        */}
        <label className="field">
          <span className="lab">{T('groupField')}</span>
          <input
            type="text"
            list={`${groupListId}`}
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

      {/* 마무리 줄. 폰에서는 화면 아래에 붙어 따라온다 — 다 적고 나서
          저장 단추를 찾아 스크롤을 되짚어 내려가지 않게. */}
      <div className="formbar">
        {/* 저장하기 전에 어떻게 갈라지는지 미리 보여 준다. 저장한 뒤에 놀랄 일이 없어야 한다.
            항목별일 때는 사람마다 금액이 다르므로 줄 판 안에서 이미 보여 주고 있다. */}
        {kind !== 'items' && each.length > 0 && (
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
