'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { CURRENCY_FOR } from '../lib/i18n.ts';
import { CURRENCIES, formatMoney, parseMoney, type CurrencyCode, type Locale } from '../lib/domain/money.ts';
import { calculateWeek, dateKey, readWeeklyPlan, type WeeklyPlan } from '../lib/personal/weekly.ts';
import styles from './WeeklyMoney.module.css';

const STORAGE_KEY = 'teamledger:weekly-plan:v1';

const words = {
  ko: {
    title: '이번 주에 쓸 수 있는 돈', setup: '잔액과 다음 급여일을 적어 주세요.',
    balance: '현재 잔액', payday: '다음 급여일', fixed: '급여일 전 빠질 돈', reserve: '남겨둘 돈',
    optional: '없으면 0', save: '계산하기', edit: '금액 수정', spend: '쓴 돈 적기', amount: '쓴 금액',
    what: '무엇에 썼나요? (선택)', add: '기록', cancel: '취소', calculation: '계산 보기', hide: '계산 닫기',
    untilPayday: '급여일까지 쓸 수 있는 돈', days: (n: number) => `급여일까지 ${n}일`,
    formula: (n: number) => `${n}일 중 ${Math.min(n, 7)}일치`, recent: '최근 기록',
    empty: '잔액을 입력하면 여기서 바로 볼 수 있습니다.', expired: '급여일이 지났어요. 날짜와 잔액을 다시 적어 주세요.',
    shortfall: '빠질 돈과 남겨둘 돈이 잔액보다 많아요.', local: '이 브라우저에만 저장돼요. 계좌와 연결되지는 않습니다.',
    clear: '기록 지우기', clearConfirm: '이 브라우저에 저장된 개인 금액과 기록을 모두 지울까요?',
    remove: '삭제', error: '금액과 급여일을 확인해 주세요.', spendError: '쓴 금액을 입력해 주세요.',
    spent: '지출', removeHint: '기록을 지우면 잔액도 되돌아갑니다.', storageError: '이 브라우저에 저장하지 못했습니다. 새로고침하면 입력한 내용이 사라질 수 있어요.',
  },
  en: {
    title: 'Available to spend this week', setup: 'Set aside upcoming bills and savings, then spread the rest until payday.',
    balance: 'Current balance', payday: 'Next payday', fixed: 'Bills before payday', reserve: 'Keep aside',
    optional: '0 if none', save: 'Calculate', edit: 'Edit amounts', spend: 'Add spending', amount: 'Amount spent',
    what: 'What was it for? (optional)', add: 'Add', cancel: 'Cancel', calculation: 'Show calculation', hide: 'Hide calculation',
    untilPayday: 'Available until payday', days: (n: number) => `${n} days until payday`,
    formula: (n: number) => `${Math.min(n, 7)} of ${n} days`, recent: 'Recent entries',
    empty: 'Enter your balance to see your number here.', expired: 'Payday has passed. Update the date and balance.',
    shortfall: 'Bills and money set aside exceed your current balance.', local: 'Saved only in this browser. Bank accounts are not connected.',
    clear: 'Clear data', clearConfirm: 'Clear your saved amounts and entries from this browser?',
    remove: 'Remove', error: 'Check the amount and payday.', spendError: 'Enter an amount spent.',
    spent: 'Spent', removeHint: 'Removing an entry adds its amount back to your balance.', storageError: 'Could not save in this browser. Your entries may disappear after a refresh.',
  },
  ja: {
    title: '今週使えるお金', setup: '給料日までの支払いと残しておくお金を差し引いて計算します。',
    balance: '現在の残高', payday: '次の給料日', fixed: '給料日までの支払い', reserve: '残しておくお金',
    optional: 'なければ0', save: '計算する', edit: '金額を編集', spend: '支出を記録', amount: '使った金額',
    what: '使い道（任意）', add: '記録', cancel: 'キャンセル', calculation: '計算を見る', hide: '計算を閉じる',
    untilPayday: '給料日まで使えるお金', days: (n: number) => `給料日まで${n}日`,
    formula: (n: number) => `${n}日中${Math.min(n, 7)}日分`, recent: '最近の記録',
    empty: '残高を入力すると、ここに表示されます。', expired: '給料日が過ぎました。日付と残高を更新してください。',
    shortfall: '支払いと残しておくお金が残高を超えています。', local: 'このブラウザにのみ保存されます。銀行口座とは連携しません。',
    clear: '記録を消去', clearConfirm: '保存した金額と記録をすべて消去しますか？',
    remove: '削除', error: '金額と給料日を確認してください。', spendError: '使った金額を入力してください。',
    spent: '支出', removeHint: '記録を消すと残高も戻ります。', storageError: 'このブラウザに保存できませんでした。再読み込みすると消える場合があります。',
  },
  zh: {
    title: '本周可用金额', setup: '扣除发薪日前的账单和预留金额，再按天计算。',
    balance: '当前余额', payday: '下次发薪日', fixed: '发薪日前的账单', reserve: '预留金额',
    optional: '没有则填0', save: '计算', edit: '修改金额', spend: '记录支出', amount: '支出金额',
    what: '用途（可选）', add: '记录', cancel: '取消', calculation: '查看计算', hide: '收起计算',
    untilPayday: '发薪日前可用金额', days: (n: number) => `距离发薪日还有${n}天`,
    formula: (n: number) => `${n}天中的${Math.min(n, 7)}天`, recent: '最近记录',
    empty: '输入余额后即可在此查看。', expired: '发薪日已过，请更新日期和余额。',
    shortfall: '账单和预留金额超过当前余额。', local: '仅保存在此浏览器，不连接银行账户。',
    clear: '清除记录', clearConfirm: '清除此浏览器中保存的金额和记录？',
    remove: '删除', error: '请检查金额和发薪日。', spendError: '请输入支出金额。',
    spent: '支出', removeHint: '删除记录后，金额会加回余额。', storageError: '无法保存在此浏览器。刷新后输入的内容可能会消失。',
  },
  es: {
    title: 'Disponible para esta semana', setup: 'Resta los pagos pendientes y lo que quieres reservar hasta tu próximo ingreso.',
    balance: 'Saldo actual', payday: 'Próximo ingreso', fixed: 'Pagos antes del ingreso', reserve: 'Dinero reservado',
    optional: '0 si no hay', save: 'Calcular', edit: 'Editar importes', spend: 'Añadir gasto', amount: 'Importe gastado',
    what: '¿En qué? (opcional)', add: 'Añadir', cancel: 'Cancelar', calculation: 'Ver cálculo', hide: 'Ocultar cálculo',
    untilPayday: 'Disponible hasta el ingreso', days: (n: number) => `${n} días hasta el ingreso`,
    formula: (n: number) => `${Math.min(n, 7)} de ${n} días`, recent: 'Movimientos recientes',
    empty: 'Introduce tu saldo para verlo aquí.', expired: 'La fecha de ingreso pasó. Actualiza la fecha y el saldo.',
    shortfall: 'Los pagos y la reserva superan tu saldo.', local: 'Solo se guarda en este navegador. No se conecta al banco.',
    clear: 'Borrar datos', clearConfirm: '¿Borrar los importes y movimientos guardados en este navegador?',
    remove: 'Eliminar', error: 'Comprueba el importe y la fecha.', spendError: 'Introduce el importe gastado.',
    spent: 'Gasto', removeHint: 'Al eliminar un gasto, su importe vuelve al saldo.', storageError: 'No se pudo guardar en este navegador. Los datos pueden desaparecer al actualizar.',
  },
  vi: {
    title: 'Có thể chi trong tuần này', setup: 'Trừ các khoản sắp trả và tiền muốn giữ lại, rồi chia đến ngày nhận lương.',
    balance: 'Số dư hiện tại', payday: 'Ngày nhận lương tới', fixed: 'Khoản phải trả trước ngày lương', reserve: 'Tiền giữ lại',
    optional: '0 nếu không có', save: 'Tính', edit: 'Sửa số tiền', spend: 'Ghi khoản chi', amount: 'Số tiền đã chi',
    what: 'Chi cho việc gì? (không bắt buộc)', add: 'Ghi', cancel: 'Hủy', calculation: 'Xem phép tính', hide: 'Đóng phép tính',
    untilPayday: 'Có thể chi đến ngày lương', days: (n: number) => `Còn ${n} ngày đến ngày lương`,
    formula: (n: number) => `${Math.min(n, 7)} trong ${n} ngày`, recent: 'Ghi chép gần đây',
    empty: 'Nhập số dư để xem tại đây.', expired: 'Đã qua ngày lương. Hãy cập nhật ngày và số dư.',
    shortfall: 'Khoản phải trả và tiền giữ lại lớn hơn số dư.', local: 'Chỉ lưu trên trình duyệt này. Không kết nối tài khoản ngân hàng.',
    clear: 'Xóa dữ liệu', clearConfirm: 'Xóa số tiền và ghi chép đã lưu trên trình duyệt này?',
    remove: 'Xóa', error: 'Kiểm tra số tiền và ngày nhận lương.', spendError: 'Nhập số tiền đã chi.',
    spent: 'Đã chi', removeHint: 'Xóa ghi chép sẽ cộng lại số tiền vào số dư.', storageError: 'Không thể lưu trên trình duyệt này. Dữ liệu có thể mất khi tải lại.',
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
  const [payday, setPayday] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(CURRENCY_FOR[locale]);
  const [spendText, setSpendText] = useState('');
  const [spendTitle, setSpendTitle] = useState('');

  useEffect(() => {
    let stored: WeeklyPlan | null = null;
    try { stored = readWeeklyPlan(localStorage.getItem(STORAGE_KEY)); } catch { /* Private browsing can block storage. */ }
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
  }, [loaded, plan, editing, showSpend, showWork]);

  useEffect(() => {
    if (!plan) setCurrency(CURRENCY_FOR[locale]);
  }, [locale]);

  const cash = (amount: number) => formatMoney(amount, plan?.currency ?? currency, locale);
  const result = plan && today ? calculateWeek(plan, today) : null;

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
      setBalanceText(String(result.balance / 10 ** CURRENCIES[plan.currency].decimals));
      setFixedText(String(plan.fixedBeforePayday / 10 ** CURRENCIES[plan.currency].decimals));
      setReserveText(String(plan.keepAside / 10 ** CURRENCIES[plan.currency].decimals));
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
    if (!/\d/.test(balanceText) || !payday || payday <= today || ![balance, fixed, reserve].every(Number.isSafeInteger)) {
      setError(w.error);
      return;
    }
    const entries = plan?.currency === currency ? plan.entries : [];
    save({ version: 1, currency, startingBalance: balance + entries.reduce((sum, item) => sum + item.amount, 0),
      payday, fixedBeforePayday: fixed, keepAside: reserve, entries });
    setEditing(false);
    setError('');
  }

  function submitSpend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!plan) return;
    const amount = parseMoney(spendText, plan.currency, locale);
    if (!Number.isSafeInteger(amount) || amount <= 0) { setError(w.spendError); return; }
    save({ ...plan, entries: [{ id: crypto.randomUUID(), amount, title: spendTitle.trim(), at: new Date().toISOString() }, ...plan.entries] });
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
          </div>
          <div className={styles.actions}>
            <select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>
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
            <div className={styles.answer} aria-live="polite">
              <div className={styles.figure}>{cash(result.thisWeek)}</div>
              <div className={styles.meta}>{result.days <= 7 ? w.untilPayday : w.days(result.days)}</div>
              {result.shortfall > 0 && <p className={styles.error}>{w.shortfall}</p>}
            </div>
          ) : <p className={styles.expired}>{w.expired}</p>}

          <div className={styles.toolbar}>
            {result.ready && <button className={styles.primary} type="button" onClick={() => { setShowSpend(!showSpend); setError(''); }}>{w.spend}</button>}
            <button className={styles.textButton} type="button" aria-expanded={showWork} onClick={() => setShowWork(!showWork)}>{showWork ? w.hide : w.calculation}</button>
          </div>

          {showSpend && result.ready && (
            <form className={styles.spendForm} onSubmit={submitSpend}>
              <label>{w.amount}<input autoFocus inputMode="decimal" placeholder="0" value={spendText} onChange={(e) => setSpendText(e.target.value)} required /></label>
              <label>{w.what}<input maxLength={60} value={spendTitle} onChange={(e) => setSpendTitle(e.target.value)} /></label>
              <button className={styles.primary} type="submit">{w.add}</button>
              {error && <p className={styles.error} role="alert">{error}</p>}
            </form>
          )}

          {showWork && (
            <div className={styles.work}>
              <div><span>{w.balance}</span><strong>{cash(result.balance)}</strong></div>
              <div><span>{w.fixed}</span><strong>− {cash(plan.fixedBeforePayday)}</strong></div>
              <div><span>{w.reserve}</span><strong>− {cash(plan.keepAside)}</strong></div>
              <div className={styles.total}><span>{w.untilPayday}</span><strong>{cash(Math.max(0, result.uncommitted))}</strong></div>
              {result.ready && <p>{w.formula(result.days)}</p>}
            </div>
          )}

          {plan.entries.length > 0 && (
            <div className={styles.recent}>
              <h2>{w.recent}</h2>
              {plan.entries.slice(0, 5).map((entry) => (
                <div className={styles.entry} key={entry.id}>
                  <span>{entry.title || w.spent}</span>
                  <span>− {cash(entry.amount)}</span>
                  <button className={styles.remove} type="button" aria-label={`${w.remove}: ${entry.title || w.spent}`} title={w.removeHint}
                    onClick={() => save({ ...plan, entries: plan.entries.filter((item) => item.id !== entry.id) })}>×</button>
                </div>
              ))}
            </div>
          )}
          <div className={styles.bottom}><span>{w.local}</span><button className={styles.textButton} type="button" onClick={() => { if (confirm(w.clearConfirm)) { save(null); setEditing(false); setBalanceText(''); setPayday(''); setFixedText(''); setReserveText(''); } }}>{w.clear}</button></div>
          {storageError && <p className={styles.error} role="alert">{w.storageError}</p>}
        </>
      )}
    </section>
  );
}
