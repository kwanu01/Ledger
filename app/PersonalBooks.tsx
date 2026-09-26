'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { CURRENCY_FOR } from '../lib/i18n.ts';
import { CURRENCIES, formatMoney, parseMoney, type CurrencyCode, type Locale } from '../lib/domain/money.ts';
import styles from './PersonalBooks.module.css';

type Entry = { id: string; title: string; amount: number; state: 'planned' | 'paid'; at: string };
type Book = { id: string; name: string; currency: CurrencyCode; budget: number | null; entries: Entry[]; createdAt: string };
const KEY = 'teamledger:personal-books:v1';

const copy = {
  ko: { title: '내 장부', name: '장부 이름', budget: '예산 (선택)', create: '장부 만들기', newBook: '새 장부', book: '장부', paid: '쓴 돈', planned: '앞으로 쓸 돈', total: '전체 비용', left: '예산에서 남은 돈', over: '예산 초과', add: '항목 추가', item: '무엇에 쓰나요?', amount: '금액', record: '적기', editEntry: '수정', saveEntry: '수정하기', plan: '예정', done: '결제함', markPaid: '결제했어요', remove: '삭제', removeConfirm: '이 항목을 지울까요?', deleteBook: '장부 삭제', deleteBookConfirm: '이 장부와 기록을 모두 지울까요?', noEntries: '첫 항목을 적으면 여기에 쌓입니다.', changeBudget: '예산 수정', saveBudget: '저장', cancel: '취소', setBudget: '예산 정하기', local: '이 브라우저에 저장됩니다. 다른 기기와는 연결되지 않습니다.', error: '이름과 금액을 확인해 주세요.', storageError: '저장하지 못했습니다. 새로고침하면 기록이 사라질 수 있어요.', currency: '통화' },
  en: { title: 'My books', name: 'Book name', budget: 'Budget (optional)', create: 'Create book', newBook: 'New book', book: 'Book', paid: 'Paid', planned: 'Still to pay', total: 'Total cost', left: 'Left in budget', over: 'Over budget', add: 'Add an item', item: 'What is it for?', amount: 'Amount', record: 'Add', editEntry: 'Edit', saveEntry: 'Save changes', plan: 'Planned', done: 'Paid', markPaid: 'Mark paid', remove: 'Remove', removeConfirm: 'Remove this item?', deleteBook: 'Delete book', deleteBookConfirm: 'Delete this book and all its entries?', noEntries: 'Your first item will appear here.', changeBudget: 'Edit budget', saveBudget: 'Save', cancel: 'Cancel', setBudget: 'Set a budget', local: 'Saved in this browser only. It will not appear on another device.', error: 'Check the name and amount.', storageError: 'Could not save. Your records may disappear after a refresh.', currency: 'Currency' },
  ja: { title: '自分の帳簿', name: '帳簿名', budget: '予算（任意）', create: '帳簿を作る', newBook: '新しい帳簿', book: '帳簿', paid: '支払済み', planned: 'これから払う', total: '費用合計', left: '予算の残り', over: '予算超過', add: '項目を追加', item: '何に使いますか？', amount: '金額', record: '追加', editEntry: '編集', saveEntry: '変更を保存', plan: '予定', done: '支払済み', markPaid: '支払った', remove: '削除', removeConfirm: 'この項目を削除しますか？', deleteBook: '帳簿を削除', deleteBookConfirm: 'この帳簿と記録をすべて削除しますか？', noEntries: '最初の項目がここに表示されます。', changeBudget: '予算を編集', saveBudget: '保存', cancel: 'キャンセル', setBudget: '予算を設定', local: 'このブラウザだけに保存されます。他の端末とは同期しません。', error: '名前と金額を確認してください。', storageError: '保存できませんでした。再読み込みすると記録が消える場合があります。', currency: '通貨' },
  zh: { title: '我的账本', name: '账本名称', budget: '预算（可选）', create: '创建账本', newBook: '新账本', book: '账本', paid: '已支付', planned: '待支付', total: '总费用', left: '预算剩余', over: '超出预算', add: '添加项目', item: '用于什么？', amount: '金额', record: '添加', editEntry: '编辑', saveEntry: '保存修改', plan: '计划', done: '已支付', markPaid: '标为已支付', remove: '删除', removeConfirm: '删除此项目？', deleteBook: '删除账本', deleteBookConfirm: '删除此账本及其所有记录？', noEntries: '第一笔项目会显示在这里。', changeBudget: '修改预算', saveBudget: '保存', cancel: '取消', setBudget: '设置预算', local: '仅保存在此浏览器，不会同步到其他设备。', error: '请检查名称和金额。', storageError: '无法保存。刷新后记录可能消失。', currency: '货币' },
  es: { title: 'Mis libros', name: 'Nombre del libro', budget: 'Presupuesto (opcional)', create: 'Crear libro', newBook: 'Nuevo libro', book: 'Libro', paid: 'Pagado', planned: 'Por pagar', total: 'Coste total', left: 'Presupuesto restante', over: 'Sobre el presupuesto', add: 'Añadir gasto', item: '¿Para qué es?', amount: 'Importe', record: 'Añadir', editEntry: 'Editar', saveEntry: 'Guardar cambios', plan: 'Previsto', done: 'Pagado', markPaid: 'Marcar pagado', remove: 'Eliminar', removeConfirm: '¿Eliminar este gasto?', deleteBook: 'Eliminar libro', deleteBookConfirm: '¿Eliminar este libro y todos sus gastos?', noEntries: 'El primer gasto aparecerá aquí.', changeBudget: 'Editar presupuesto', saveBudget: 'Guardar', cancel: 'Cancelar', setBudget: 'Fijar presupuesto', local: 'Se guarda solo en este navegador. No se sincroniza con otros dispositivos.', error: 'Comprueba el nombre y el importe.', storageError: 'No se pudo guardar. Los datos pueden desaparecer al actualizar.', currency: 'Moneda' },
  vi: { title: 'Sổ của tôi', name: 'Tên sổ', budget: 'Ngân sách (không bắt buộc)', create: 'Tạo sổ', newBook: 'Sổ mới', book: 'Sổ', paid: 'Đã chi', planned: 'Sắp chi', total: 'Tổng chi phí', left: 'Ngân sách còn lại', over: 'Vượt ngân sách', add: 'Thêm khoản', item: 'Chi cho việc gì?', amount: 'Số tiền', record: 'Thêm', editEntry: 'Sửa', saveEntry: 'Lưu thay đổi', plan: 'Dự kiến', done: 'Đã trả', markPaid: 'Đã thanh toán', remove: 'Xóa', removeConfirm: 'Xóa khoản này?', deleteBook: 'Xóa sổ', deleteBookConfirm: 'Xóa sổ này và mọi khoản đã ghi?', noEntries: 'Khoản đầu tiên sẽ hiện ở đây.', changeBudget: 'Sửa ngân sách', saveBudget: 'Lưu', cancel: 'Hủy', setBudget: 'Đặt ngân sách', local: 'Chỉ lưu trong trình duyệt này, không đồng bộ với thiết bị khác.', error: 'Kiểm tra tên và số tiền.', storageError: 'Không thể lưu. Dữ liệu có thể mất khi tải lại.', currency: 'Tiền tệ' },
};

function readBooks(value: string | null): Book[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((book): book is Book => {
      if (!book || typeof book !== 'object') return false;
      const b = book as Partial<Book>;
      return typeof b.id === 'string' && typeof b.name === 'string' && !!b.name.trim()
        && typeof b.currency === 'string' && b.currency in CURRENCIES
        && (b.budget === null || (Number.isSafeInteger(b.budget) && (b.budget ?? -1) >= 0))
        && Array.isArray(b.entries);
    }).map((book) => ({ ...book, entries: book.entries.filter((entry) =>
      !!entry && typeof entry.id === 'string' && typeof entry.title === 'string'
      && Number.isSafeInteger(entry.amount) && entry.amount > 0
      && (entry.state === 'planned' || entry.state === 'paid')) }));
  } catch { return []; }
}

export default function PersonalBooks({ locale }: { locale: Locale }) {
  const t = copy[locale];
  const [loaded, setLoaded] = useState(false);
  const [books, setBooks] = useState<Book[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [budgetText, setBudgetText] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>(CURRENCY_FOR[locale]);
  const [item, setItem] = useState('');
  const [amountText, setAmountText] = useState('');
  const [entryState, setEntryState] = useState<Entry['state']>('paid');
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editingBudget, setEditingBudget] = useState(false);
  const [error, setError] = useState(false);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    try {
      const saved = readBooks(localStorage.getItem(KEY));
      setBooks(saved);
      setSelectedId(saved[0]?.id ?? '');
    } catch { /* Storage can be unavailable. */ }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event('ledger:layout-changed')));
    return () => cancelAnimationFrame(frame);
  }, [loaded, books, selectedId, creating, editingBudget, editingEntryId]);

  const book = books.find((b) => b.id === selectedId) ?? books[0];
  const cash = (n: number, code = book?.currency ?? currency) => formatMoney(n, code, locale);
  const paid = book?.entries.filter((e) => e.state === 'paid').reduce((sum, e) => sum + e.amount, 0) ?? 0;
  const planned = book?.entries.filter((e) => e.state === 'planned').reduce((sum, e) => sum + e.amount, 0) ?? 0;
  const total = paid + planned;

  function save(next: Book[]) {
    setBooks(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); setStorageError(false); }
    catch { setStorageError(true); }
  }

  function updateBook(next: Book) { save(books.map((b) => b.id === next.id ? next : b)); }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const budget = budgetText.trim() ? parseMoney(budgetText, currency, locale) : null;
    if (!name.trim() || (budget !== null && (!Number.isSafeInteger(budget) || budget < 0))) { setError(true); return; }
    const next: Book = { id: crypto.randomUUID(), name: name.trim().slice(0, 60), currency, budget, entries: [], createdAt: new Date().toISOString() };
    save([next, ...books]);
    setSelectedId(next.id); setName(''); setBudgetText(''); setCreating(false); setEditingEntryId(null); setItem(''); setAmountText(''); setError(false);
  }

  function addEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!book) return;
    const amount = parseMoney(amountText, book.currency, locale);
    if (!item.trim() || !Number.isSafeInteger(amount) || amount <= 0) { setError(true); return; }
    const old = book.entries.find((entry) => entry.id === editingEntryId);
    const next = { id: old?.id ?? crypto.randomUUID(), title: item.trim().slice(0, 60), amount, state: entryState, at: old?.at ?? new Date().toISOString() };
    updateBook({ ...book, entries: old ? book.entries.map((entry) => entry.id === old.id ? next : entry) : [next, ...book.entries] });
    setItem(''); setAmountText(''); setEditingEntryId(null); setError(false);
  }

  function changeBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!book) return;
    const budget = budgetText.trim() ? parseMoney(budgetText, book.currency, locale) : null;
    if (budget !== null && (!Number.isSafeInteger(budget) || budget < 0)) { setError(true); return; }
    updateBook({ ...book, budget }); setEditingBudget(false); setBudgetText(''); setError(false);
  }

  return <section className={styles.root} aria-label={t.title}>
    <header className={styles.heading}><h1>{t.title}</h1>{book && <button type="button" className={styles.link} onClick={() => { setCreating(true); setError(false); }}>{t.newBook}</button>}</header>
    {!loaded ? <div className={styles.placeholder} /> : (!book || creating) ? <form className={styles.create} onSubmit={create}>
      <label>{t.name}<input autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} required /></label>
      <div className={styles.createBottom}><label>{t.budget}<input inputMode="decimal" placeholder="0" value={budgetText} onChange={(e) => setBudgetText(e.target.value)} /></label>
        <label>{t.currency}<select value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>{Object.keys(CURRENCIES).map((code) => <option key={code}>{code}</option>)}</select></label></div>
      <div className={styles.buttons}><button type="submit" className={styles.primary}>{t.create}</button>{book && <button type="button" className={styles.link} onClick={() => { setCreating(false); setError(false); }}>{t.cancel}</button>}</div>
      {error && <p className={styles.error} role="alert">{t.error}</p>}
    </form> : <>
      <div className={styles.bookTitle}><label>{t.book}<select value={book.id} onChange={(e) => { setSelectedId(e.target.value); setEditingEntryId(null); setItem(''); setAmountText(''); setError(false); }}>
        {books.map((b) => <option value={b.id} key={b.id}>{b.name}</option>)}
      </select></label><span>{book.currency}</span></div>
      <div className={styles.summary}>
        <div><span>{t.paid}</span><strong>{cash(paid)}</strong></div><div><span>{t.planned}</span><strong>{cash(planned)}</strong></div>
        <div className={styles.total}><span>{t.total}</span><strong>{cash(total)}</strong></div>
        {book.budget !== null && <div className={styles.remaining}><span>{total > book.budget ? t.over : t.left}</span><strong>{cash(Math.abs(book.budget - total))}</strong></div>}
      </div>
      {editingBudget ? <form className={styles.budgetForm} onSubmit={changeBudget}><label>{t.budget}<input autoFocus inputMode="decimal" value={budgetText} onChange={(e) => setBudgetText(e.target.value)} /></label><button type="submit">{t.saveBudget}</button><button type="button" onClick={() => setEditingBudget(false)}>{t.cancel}</button></form>
        : <button type="button" className={styles.link} onClick={() => { setBudgetText(book.budget === null ? '' : String(book.budget / 10 ** CURRENCIES[book.currency].decimals)); setEditingBudget(true); }}>{book.budget === null ? t.setBudget : t.changeBudget}</button>}
      <form className={styles.add} onSubmit={addEntry}><h2>{editingEntryId ? t.editEntry : t.add}</h2><div className={styles.entryFields}>
        <label>{t.item}<input maxLength={60} value={item} onChange={(e) => setItem(e.target.value)} required /></label>
        <label>{t.amount}<input inputMode="decimal" placeholder="0" value={amountText} onChange={(e) => setAmountText(e.target.value)} required /></label></div>
        <div className={styles.buttons}><div className={styles.segment} role="group" aria-label={t.add}><button type="button" aria-pressed={entryState === 'paid'} onClick={() => setEntryState('paid')}>{t.done}</button><button type="button" aria-pressed={entryState === 'planned'} onClick={() => setEntryState('planned')}>{t.plan}</button></div><button className={styles.primary} type="submit">{editingEntryId ? t.saveEntry : t.record}</button>{editingEntryId && <button type="button" className={styles.link} onClick={() => { setEditingEntryId(null); setItem(''); setAmountText(''); }}>{t.cancel}</button>}</div>
        {error && <p className={styles.error} role="alert">{t.error}</p>}
      </form>
      <div className={styles.entries}>{book.entries.length === 0 ? <p className={styles.emptyEntries}>{t.noEntries}</p> : book.entries.map((entry) => <div className={styles.entry} key={entry.id}>
        <div><strong>{entry.title}</strong><span>{entry.state === 'paid' ? t.done : t.plan}</span></div><strong>{cash(entry.amount)}</strong>
        <div className={styles.entryActions}><button type="button" onClick={() => { setEditingEntryId(entry.id); setItem(entry.title); setAmountText(String(entry.amount / 10 ** CURRENCIES[book.currency].decimals)); setEntryState(entry.state); setError(false); }}>{t.editEntry}</button>{entry.state === 'planned' && <button type="button" onClick={() => updateBook({ ...book, entries: book.entries.map((e) => e.id === entry.id ? { ...e, state: 'paid' } : e) })}>{t.markPaid}</button>}
          <button type="button" aria-label={`${t.remove}: ${entry.title}`} onClick={() => { if (confirm(t.removeConfirm)) updateBook({ ...book, entries: book.entries.filter((e) => e.id !== entry.id) }); }}>{t.remove}</button></div>
      </div>)}</div>
      <button type="button" className={styles.deleteBook} onClick={() => { if (!confirm(t.deleteBookConfirm)) return; const next = books.filter((b) => b.id !== book.id); save(next); setSelectedId(next[0]?.id ?? ''); setEditingEntryId(null); }}>{t.deleteBook}</button>
    </>}
    {loaded && <p className={storageError ? styles.error : styles.note}>{storageError ? t.storageError : t.local}</p>}
  </section>;
}
