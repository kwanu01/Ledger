'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { CURRENCY_FOR } from '../lib/i18n.ts';
import { CURRENCIES, formatMoney, parseMoney, type CurrencyCode, type Locale } from '../lib/domain/money.ts';
import { assessDecision, calculateWeek, dateKey, readWeeklyPlan, type PendingDecision, type WeeklyPlan } from '../lib/personal/weekly.ts';
import styles from './WeeklyMoney.module.css';

const STORAGE_KEY = 'teamledger:weekly-plan:v1';

const words = {
  ko: {
    title: '이거 해도 될까?', setup: '먼저 지금 돈 상황을 적어 주세요.',
    balance: '현재 잔액', payday: '다음 돈 들어올 날', fixed: '그전에 빠질 돈', reserve: '꼭 남겨둘 돈', purpose: '무엇을 위해 남기나요? (선택)',
    optional: '없으면 0', save: '시작하기', edit: '금액 수정', cancel: '취소',
    question: '무엇을 고민 중인가요?', thing: '하고 싶은 일', thingHint: '예: 주말 여행',
    cost: '예상 금액', now: '지금 한다면', later: '미룬다면',
    remains: '그날까지 남는 돈', perDay: '하루 평균', days: (n: number) => '다음 돈 들어올 날까지 ' + n + '일',
    gap: (amount: string) => '남겨둘 돈과 예정된 지출을 지키려면 ' + amount + ' 부족해요.',
    comparison: '입력한 잔액과 예정된 지출만 반영했어요. 실제 결제나 계좌 잔액은 확인하지 않습니다.',
    decide: '하기로 함', defer: '나중에 보기', saved: '생각해 둔 일', planned: '하기로 한 일', deferred: '미뤄둔 일',
    paid: '결제했어요', reconsider: '다시 보기', remove: '지우기',
    spent: '쓴 돈 적기', spentTitle: '무엇에 썼나요?', spentAmount: '쓴 금액', add: '기록',
    history: '지출 기록', calculation: '금액 계산 보기', hide: '계산 닫기',
    committed: '하기로 한 일', available: '남은 돈', expired: '날짜가 지났어요. 잔액과 날짜를 다시 적어 주세요.',
    shortfall: '빠질 돈과 남겨둘 돈이 잔액보다 많아요.',
    local: '이 브라우저에만 저장돼요. 계좌와 연결되지 않습니다.',
    clear: '개인 기록 지우기', clearConfirm: '이 브라우저에 저장된 개인 금액과 기록을 모두 지울까요?',
    error: '금액과 날짜를 확인해 주세요.', decisionError: '할 일과 금액을 적어 주세요.',
    spentError: '쓴 금액을 적어 주세요.', storageError: '저장하지 못했습니다. 새로고침하면 입력한 내용이 사라질 수 있어요.',
    currency: '통화', noName: '지출',
  },
  en: {
    title: 'Can I do this?', setup: 'Start with where your money stands today.',
    balance: 'Current balance', payday: 'Next income date', fixed: 'Payments due before then', reserve: 'Money to keep aside', purpose: 'What is it for? (optional)',
    optional: '0 if none', save: 'Continue', edit: 'Edit amounts', cancel: 'Cancel',
    question: 'What are you considering?', thing: 'What you want to do', thingHint: 'e.g. a weekend trip',
    cost: 'Estimated cost', now: 'Do it now', later: 'Wait',
    remains: 'Left until then', perDay: 'Daily average', days: (n: number) => n + ' days until your next income',
    gap: (amount: string) => 'You would be ' + amount + ' short while keeping your bills and set-aside money intact.',
    comparison: 'This uses only the amounts you entered. It does not check your bank balance or payments.',
    decide: 'I plan to do it', defer: 'Save for later', saved: 'Things to consider', planned: 'Planned', deferred: 'Saved for later',
    paid: 'I paid for it', reconsider: 'Look again', remove: 'Remove',
    spent: 'Add spending', spentTitle: 'What was it for?', spentAmount: 'Amount spent', add: 'Add',
    history: 'Spending history', calculation: 'Show amounts', hide: 'Hide amounts',
    committed: 'Planned spending', available: 'Left to use', expired: 'The date has passed. Update your balance and date.',
    shortfall: 'Upcoming payments and money set aside exceed your balance.',
    local: 'Saved only in this browser. Bank accounts are not connected.',
    clear: 'Clear personal data', clearConfirm: 'Clear the personal amounts and records saved in this browser?',
    error: 'Check the amounts and date.', decisionError: 'Enter what you want to do and its cost.',
    spentError: 'Enter the amount spent.', storageError: 'Could not save here. Your entries may disappear after a refresh.',
    currency: 'Currency', noName: 'Spending',
  },
  ja: {
    title: '今、使っても大丈夫？', setup: 'まず現在のお金の状況を入力してください。',
    balance: '現在の残高', payday: '次の収入日', fixed: 'それまでの支払い', reserve: '残しておくお金', purpose: '何のために残しますか？（任意）',
    optional: 'なければ0', save: '続ける', edit: '金額を編集', cancel: 'キャンセル',
    question: '何を考えていますか？', thing: 'したいこと', thingHint: '例：週末の旅行',
    cost: '予想金額', now: '今する場合', later: '後にする場合',
    remains: 'その日まで残るお金', perDay: '1日平均', days: (n: number) => '次の収入まで' + n + '日',
    gap: (amount: string) => '支払いと残しておくお金を守るには' + amount + '足りません。',
    comparison: '入力した金額だけを使って計算します。口座残高や決済は確認しません。',
    decide: 'することに決める', defer: '後で見る', saved: '考えていること', planned: '決めたこと', deferred: '後で考えること',
    paid: '支払いました', reconsider: 'もう一度見る', remove: '削除',
    spent: '支出を記録', spentTitle: '何に使いましたか？', spentAmount: '使った金額', add: '記録',
    history: '支出記録', calculation: '金額を見る', hide: '閉じる',
    committed: '予定した支出', available: '残るお金', expired: '日付が過ぎました。残高と日付を更新してください。',
    shortfall: '支払いと残しておくお金が残高を超えています。',
    local: 'このブラウザにのみ保存されます。口座とは連携しません。',
    clear: '個人記録を消去', clearConfirm: 'このブラウザの個人記録をすべて消去しますか？',
    error: '金額と日付を確認してください。', decisionError: 'したいことと金額を入力してください。',
    spentError: '使った金額を入力してください。', storageError: '保存できませんでした。再読み込みすると消える場合があります。',
    currency: '通貨', noName: '支出',
  },
  zh: {
    title: '现在可以花这笔钱吗？', setup: '先填入目前的资金情况。',
    balance: '当前余额', payday: '下次收入日期', fixed: '此前需支付的金额', reserve: '需要留存的金额', purpose: '这笔钱留作什么用途？（可选）',
    optional: '没有则填0', save: '继续', edit: '修改金额', cancel: '取消',
    question: '你在考虑什么？', thing: '想做的事', thingHint: '例如：周末旅行',
    cost: '预计金额', now: '现在做', later: '以后再做',
    remains: '届时剩余金额', perDay: '每日平均', days: (n: number) => '距下次收入还有' + n + '天',
    gap: (amount: string) => '保留预定支出和留存金额后，还差' + amount + '。',
    comparison: '仅根据你输入的金额计算，不会读取账户余额或交易。',
    decide: '决定要做', defer: '留待以后', saved: '考虑中的事', planned: '已决定', deferred: '以后再看',
    paid: '已经付款', reconsider: '重新查看', remove: '删除',
    spent: '记录支出', spentTitle: '用于什么？', spentAmount: '支出金额', add: '记录',
    history: '支出记录', calculation: '查看金额', hide: '收起',
    committed: '已计划支出', available: '剩余金额', expired: '日期已过，请更新余额和日期。',
    shortfall: '预定支出和留存金额超过余额。',
    local: '仅保存在此浏览器，不连接银行账户。',
    clear: '清除个人记录', clearConfirm: '清除此浏览器中的个人金额和记录？',
    error: '请检查金额和日期。', decisionError: '请输入想做的事和金额。',
    spentError: '请输入支出金额。', storageError: '无法保存。刷新后内容可能消失。',
    currency: '货币', noName: '支出',
  },
  es: {
    title: '¿Puedo hacerlo?', setup: 'Empieza por tu situación de hoy.',
    balance: 'Saldo actual', payday: 'Próximo ingreso', fixed: 'Pagos antes de esa fecha', reserve: 'Dinero que quieres reservar', purpose: '¿Para qué lo reservas? (opcional)',
    optional: '0 si no hay', save: 'Continuar', edit: 'Editar importes', cancel: 'Cancelar',
    question: '¿Qué estás pensando hacer?', thing: 'Lo que quieres hacer', thingHint: 'Ej.: viaje de fin de semana',
    cost: 'Coste estimado', now: 'Hacerlo ahora', later: 'Esperar',
    remains: 'Queda hasta el ingreso', perDay: 'Media diaria', days: (n: number) => n + ' días hasta el ingreso',
    gap: (amount: string) => 'Faltan ' + amount + ' si mantienes tus pagos y el dinero reservado.',
    comparison: 'Solo se usan los importes que has escrito. No se consulta tu cuenta bancaria.',
    decide: 'He decidido hacerlo', defer: 'Guardar para después', saved: 'Cosas por decidir', planned: 'Decidido', deferred: 'Para después',
    paid: 'Ya lo pagué', reconsider: 'Volver a mirar', remove: 'Eliminar',
    spent: 'Añadir gasto', spentTitle: '¿En qué gastaste?', spentAmount: 'Importe gastado', add: 'Añadir',
    history: 'Gastos anotados', calculation: 'Ver importes', hide: 'Ocultar importes',
    committed: 'Gastos previstos', available: 'Dinero restante', expired: 'La fecha pasó. Actualiza el saldo y la fecha.',
    shortfall: 'Los pagos y la reserva superan el saldo.',
    local: 'Solo se guarda en este navegador. No se conecta al banco.',
    clear: 'Borrar datos personales', clearConfirm: '¿Borrar los importes y registros personales de este navegador?',
    error: 'Comprueba los importes y la fecha.', decisionError: 'Escribe qué quieres hacer y cuánto cuesta.',
    spentError: 'Introduce el importe gastado.', storageError: 'No se pudo guardar. Los datos pueden desaparecer al actualizar.',
    currency: 'Moneda', noName: 'Gasto',
  },
  vi: {
    title: 'Mình có thể chi khoản này không?', setup: 'Trước tiên, nhập tình hình tiền hiện tại.',
    balance: 'Số dư hiện tại', payday: 'Ngày có thu nhập tiếp theo', fixed: 'Khoản cần trả trước ngày đó', reserve: 'Tiền muốn giữ lại', purpose: 'Giữ lại cho việc gì? (không bắt buộc)',
    optional: '0 nếu không có', save: 'Tiếp tục', edit: 'Sửa số tiền', cancel: 'Hủy',
    question: 'Bạn đang cân nhắc việc gì?', thing: 'Việc muốn làm', thingHint: 'Ví dụ: chuyến đi cuối tuần',
    cost: 'Chi phí dự kiến', now: 'Làm ngay', later: 'Để sau',
    remains: 'Còn lại đến ngày đó', perDay: 'Trung bình mỗi ngày', days: (n: number) => 'Còn ' + n + ' ngày đến khoản thu tiếp theo',
    gap: (amount: string) => 'Còn thiếu ' + amount + ' nếu giữ nguyên các khoản cần trả và tiền để dành.',
    comparison: 'Chỉ tính các số tiền bạn đã nhập. Không đọc số dư hay giao dịch ngân hàng.',
    decide: 'Quyết định làm', defer: 'Để xem sau', saved: 'Điều đang cân nhắc', planned: 'Đã quyết định', deferred: 'Để sau',
    paid: 'Đã thanh toán', reconsider: 'Xem lại', remove: 'Xóa',
    spent: 'Ghi khoản chi', spentTitle: 'Chi cho việc gì?', spentAmount: 'Số tiền đã chi', add: 'Ghi',
    history: 'Khoản chi đã ghi', calculation: 'Xem số tiền', hide: 'Ẩn số tiền',
    committed: 'Khoản đã dự định', available: 'Tiền còn lại', expired: 'Ngày đã qua. Hãy cập nhật số dư và ngày.',
    shortfall: 'Khoản cần trả và tiền giữ lại lớn hơn số dư.',
    local: 'Chỉ lưu trên trình duyệt này. Không kết nối ngân hàng.',
    clear: 'Xóa dữ liệu cá nhân', clearConfirm: 'Xóa số tiền và ghi chép cá nhân trong trình duyệt này?',
    error: 'Kiểm tra số tiền và ngày.', decisionError: 'Nhập việc muốn làm và chi phí.',
    spentError: 'Nhập số tiền đã chi.', storageError: 'Không thể lưu. Dữ liệu có thể mất khi tải lại.',
    currency: 'Tiền tệ', noName: 'Chi tiêu',
  },
};

export default function WeeklyMoney({ locale }: { locale: Locale }) {
  const w = words[locale];
  const [loaded, setLoaded] = useState(false);
  const [today, setToday] = useState('');
  const [plan, setPlan] = useState<WeeklyPlan | null>(null);
  const [editing, setEditing] = useState(false);
  const [showSpend, setShowSpend] = useState(false);
  const [showWork, setShowWork] = useState(false);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [balanceText, setBalanceText] = useState('');
  const [fixedText, setFixedText] = useState('');
  const [reserveText, setReserveText] = useState('');
  const [reservePurpose, setReservePurpose] = useState('');
  const [payday, setPayday] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(CURRENCY_FOR[locale]);
  const [ideaTitle, setIdeaTitle] = useState('');
  const [ideaAmount, setIdeaAmount] = useState('');
  const [editingPendingId, setEditingPendingId] = useState<string | null>(null);
  const [spendTitle, setSpendTitle] = useState('');
  const [spendText, setSpendText] = useState('');

  useEffect(() => {
    let stored: WeeklyPlan | null = null;
    try { stored = readWeeklyPlan(localStorage.getItem(STORAGE_KEY)); } catch { /* Browser storage may be blocked. */ }
    setPlan(stored);
    setToday(dateKey(new Date()));
    setLoaded(true);
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setPlan(readWeeklyPlan(event.newValue));
    };
    const onVisible = () => { if (!document.hidden) setToday(dateKey(new Date())); };
    window.addEventListener('storage', onStorage);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('storage', onStorage);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('ledger:layout-changed')));
    return () => cancelAnimationFrame(frame);
  }, [loaded, plan, editing, showSpend, showWork, ideaAmount !== '']);

  useEffect(() => {
    if (!plan) setCurrency(CURRENCY_FOR[locale]);
  }, [locale, plan]);

  const result = plan && today ? calculateWeek(plan, today) : null;
  const cash = (amount: number) => formatMoney(amount, plan?.currency ?? currency, locale);
  const ideaValue = plan ? parseMoney(ideaAmount, plan.currency, locale) : 0;
  const editingPending = plan?.pending.find((item) => item.id === editingPendingId);
  const decisionBase = result && editingPending?.status === 'planned'
    ? { ...result, uncommitted: result.uncommitted + editingPending.amount }
    : result;
  const impact = decisionBase && Number.isSafeInteger(ideaValue) && ideaValue > 0
    ? assessDecision(decisionBase, ideaValue) : null;

  function save(next: WeeklyPlan | null) {
    setPlan(next);
    try {
      if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else localStorage.removeItem(STORAGE_KEY);
      setStorageError(false);
    } catch { setStorageError(true); }
  }

  function startEdit() {
    if (plan && result) {
      const units = 10 ** CURRENCIES[plan.currency].decimals;
      setBalanceText(String(result.balance / units));
      setFixedText(String(plan.fixedBeforePayday / units));
      setReserveText(String(plan.keepAside / units));
      setReservePurpose(plan.keepAsideFor);
      setPayday(plan.payday);
      setCurrency(plan.currency);
    }
    setError('');
    setEditing(true);
  }

  function submitPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const balance = parseMoney(balanceText, currency, locale);
    const fixed = parseMoney(fixedText, currency, locale);
    const reserve = parseMoney(reserveText, currency, locale);
    if (!/\d/.test(balanceText) || !payday || payday <= today
      || ![balance, fixed, reserve].every((n) => Number.isSafeInteger(n) && n >= 0)) {
      setError(w.error);
      return;
    }
    const entries = plan?.entries ?? [];
    const pending = plan?.pending ?? [];
    const startingBalance = balance + entries.reduce((sum, item) => sum + item.amount, 0);
    if (!Number.isSafeInteger(startingBalance)) { setError(w.error); return; }
    save({ version: 1, currency, startingBalance, payday,
      fixedBeforePayday: fixed, keepAside: reserve, keepAsideFor: reservePurpose.trim(), entries, pending });
    setEditing(false);
    setError('');
  }

  function clearIdea() {
    setIdeaTitle('');
    setIdeaAmount('');
    setEditingPendingId(null);
    setError('');
  }

  function saveDecision(status: PendingDecision['status']) {
    if (!plan || !result?.ready) return;
    const amount = parseMoney(ideaAmount, plan.currency, locale);
    const title = ideaTitle.trim();
    if (!title || !/\d/.test(ideaAmount) || !Number.isSafeInteger(amount) || amount <= 0) {
      setError(w.decisionError);
      return;
    }
    const old = plan.pending.find((item) => item.id === editingPendingId);
    const item: PendingDecision = {
      id: old?.id ?? crypto.randomUUID(), title, amount, status,
      createdAt: old?.createdAt ?? new Date().toISOString(),
    };
    save({ ...plan, pending: [item, ...plan.pending.filter((p) => p.id !== item.id)] });
    clearIdea();
  }

  function markPaid(item: PendingDecision) {
    if (!plan) return;
    save({ ...plan,
      pending: plan.pending.filter((p) => p.id !== item.id),
      entries: [{ id: crypto.randomUUID(), title: item.title, amount: item.amount,
        at: new Date().toISOString() }, ...plan.entries] });
    if (editingPendingId === item.id) clearIdea();
  }

  function submitSpend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!plan) return;
    const amount = parseMoney(spendText, plan.currency, locale);
    if (!/\d/.test(spendText) || !Number.isSafeInteger(amount) || amount <= 0) {
      setError(w.spentError);
      return;
    }
    save({ ...plan, entries: [{ id: crypto.randomUUID(), amount,
      title: spendTitle.trim() || w.noName, at: new Date().toISOString() }, ...plan.entries] });
    setSpendText('');
    setSpendTitle('');
    setShowSpend(false);
    setError('');
  }

  return (
    <section className={styles.root} aria-label={w.title}>
      <div className={styles.head}>
        <h1>{w.title}</h1>
        {loaded && plan && <button className={styles.textButton} type="button" onClick={startEdit}>{w.edit}</button>}
      </div>

      {!loaded ? <div className={styles.placeholder} aria-hidden="true" /> : (!plan || editing) ? (
        <form className={styles.form} onSubmit={submitPlan}>
          {!plan && <p className={styles.hint}>{w.setup}</p>}
          <div className={styles.fields}>
            <label>{w.balance}<input autoComplete="off" inputMode="decimal" placeholder="0" value={balanceText} onChange={(e) => setBalanceText(e.target.value)} required /></label>
            <label>{w.payday}<input type="date" min={today || undefined} value={payday} onChange={(e) => setPayday(e.target.value)} required /></label>
            <label>{w.fixed}<input autoComplete="off" inputMode="decimal" placeholder={w.optional} value={fixedText} onChange={(e) => setFixedText(e.target.value)} /></label>
            <label>{w.reserve}<input autoComplete="off" inputMode="decimal" placeholder={w.optional} value={reserveText} onChange={(e) => setReserveText(e.target.value)} /></label>
            {reserveText && parseMoney(reserveText, currency, locale) > 0 && <label className={styles.purposeField}>{w.purpose}<input maxLength={60} value={reservePurpose} onChange={(e) => setReservePurpose(e.target.value)} /></label>}
          </div>
          <div className={styles.actions}>
            <select aria-label={w.currency} value={currency} disabled={!!plan} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>
              {Object.keys(CURRENCIES).map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
            {plan && <button className={styles.textButton} type="button" onClick={() => { setEditing(false); setError(''); }}>{w.cancel}</button>}
            <button className={styles.primary} type="submit">{w.save}</button>
          </div>
          {error && <p className={styles.error} role="alert">{error}</p>}
          {storageError && <p className={styles.error} role="alert">{w.storageError}</p>}
          <p className={styles.disclosure}>{w.local}</p>
        </form>
      ) : result && (
        <>
          {result.ready ? (
            <div className={styles.decision}>
              <h2>{w.question}</h2>
              <p className={styles.meta}>{w.days(result.days)}</p>
              <div className={styles.decisionFields}>
                <label>{w.thing}<input autoComplete="off" maxLength={60} placeholder={w.thingHint}
                  value={ideaTitle} onChange={(e) => setIdeaTitle(e.target.value)} /></label>
                <label>{w.cost}<input autoComplete="off" inputMode="decimal" placeholder="0"
                  value={ideaAmount} onChange={(e) => setIdeaAmount(e.target.value)} /></label>
              </div>
              {impact && (
                <div className={styles.comparison} aria-live="polite">
                  <div><span>{w.later}</span><strong>{cash(impact.available)}</strong></div>
                  <div><span>{w.now}</span><strong>{cash(Math.max(0, impact.after))}</strong></div>
                  <p>{w.remains} · {w.perDay} {cash(impact.perDayBefore)} → {cash(impact.perDayAfter)}</p>
                  {impact.gap > 0 && <p className={styles.error}>{w.gap(cash(impact.gap))}</p>}
                  {plan.keepAside > 0 && plan.keepAsideFor && <p>{w.reserve}: {plan.keepAsideFor} · {cash(plan.keepAside)}</p>}
                </div>
              )}
              <div className={styles.decisionActions}>
                <button className={styles.primary} type="button" onClick={() => saveDecision('planned')}>{w.decide}</button>
                <button className={styles.secondary} type="button" onClick={() => saveDecision('later')}>{w.defer}</button>
                {editingPendingId && <button className={styles.textButton} type="button" onClick={clearIdea}>{w.cancel}</button>}
              </div>
              {error && <p className={styles.error} role="alert">{error}</p>}
              <p className={styles.disclosure}>{w.comparison}</p>
              {result.shortfall > 0 && <p className={styles.error}>{w.shortfall}</p>}
            </div>
          ) : <p className={styles.expired}>{w.expired}</p>}

          {plan.pending.length > 0 && <div className={styles.pending}>
            <h2>{w.saved}</h2>
            {plan.pending.map((item) => <div className={styles.pendingRow} key={item.id}>
              <div><strong>{item.title}</strong><span>{item.status === 'planned' ? w.planned : w.deferred} · {cash(item.amount)}</span></div>
              <div className={styles.pendingActions}>
                <button type="button" onClick={() => { setIdeaTitle(item.title); setIdeaAmount(String(item.amount / 10 ** CURRENCIES[plan.currency].decimals)); setEditingPendingId(item.id); setError(''); }}>{w.reconsider}</button>
                {item.status === 'planned' && <button type="button" onClick={() => markPaid(item)}>{w.paid}</button>}
                <button type="button" onClick={() => { save({ ...plan, pending: plan.pending.filter((p) => p.id !== item.id) }); if (editingPendingId === item.id) clearIdea(); }}>{w.remove}</button>
              </div>
            </div>)}
          </div>}

          <div className={styles.toolbar}>
            <button className={styles.textButton} type="button" onClick={() => { setShowSpend(!showSpend); setError(''); }}>{w.spent}</button>
            <button className={styles.textButton} type="button" aria-expanded={showWork} onClick={() => setShowWork(!showWork)}>{showWork ? w.hide : w.calculation}</button>
          </div>

          {showSpend && (
            <form className={styles.spendForm} onSubmit={submitSpend}>
              <label>{w.spentTitle}<input maxLength={60} value={spendTitle} onChange={(e) => setSpendTitle(e.target.value)} /></label>
              <label>{w.spentAmount}<input autoFocus inputMode="decimal" placeholder="0" value={spendText} onChange={(e) => setSpendText(e.target.value)} required /></label>
              <button className={styles.primary} type="submit">{w.add}</button>
              {error && <p className={styles.error} role="alert">{error}</p>}
            </form>
          )}

          {showWork && <div className={styles.work}>
            <div><span>{w.balance}</span><strong>{cash(result.balance)}</strong></div>
            <div><span>{w.fixed}</span><strong>− {cash(plan.fixedBeforePayday)}</strong></div>
            <div><span>{plan.keepAsideFor || w.reserve}</span><strong>− {cash(plan.keepAside)}</strong></div>
            <div><span>{w.committed}</span><strong>− {cash(result.committed)}</strong></div>
            <div className={styles.total}><span>{w.available}</span><strong>{cash(Math.max(0, result.uncommitted))}</strong></div>
          </div>}

          {plan.entries.length > 0 && <div className={styles.recent}>
            <h2>{w.history}</h2>
            {plan.entries.slice(0, 5).map((entry) => <div className={styles.entry} key={entry.id}>
              <span>{entry.title || w.noName}</span>
              <span>− {cash(entry.amount)}</span>
              <button className={styles.remove} type="button" aria-label={w.remove + ': ' + (entry.title || w.noName)}
                onClick={() => save({ ...plan, entries: plan.entries.filter((item) => item.id !== entry.id) })}>×</button>
            </div>)}
          </div>}
          <div className={styles.bottom}><span>{w.local}</span><button className={styles.textButton} type="button"
            onClick={() => { if (confirm(w.clearConfirm)) { save(null); setEditing(false); clearIdea(); setBalanceText(''); setPayday(''); setFixedText(''); setReserveText(''); setReservePurpose(''); } }}>{w.clear}</button></div>
          {storageError && <p className={styles.error} role="alert">{w.storageError}</p>}
        </>
      )}
    </section>
  );
}
