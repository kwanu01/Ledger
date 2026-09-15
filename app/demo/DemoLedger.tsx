'use client';
import Link from 'next/link';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { calculateDemo, demoMembers, demoShareText, starterEntries, type DemoEntry } from '../../lib/demo.ts';
import styles from './demo.module.css';

const won = (amount: number) => `${amount.toLocaleString('ko-KR')}원`;
const who = (id: string) => demoMembers.find(member => member.id === id)!.name;
export default function DemoLedger() {
  const [entries, setEntries] = useState(() => starterEntries.map(entry => ({ ...entry })));
  const [tab, setTab] = useState<'book' | 'settle'>('book');
  const [proof, setProof] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false), [copied, setCopied] = useState(false), [copyError, setCopyError] = useState(false);
  const { result, errors } = useMemo(() => calculateDemo(entries), [entries]);
  const text = demoShareText(entries);
  const navigateTabs = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'book' : event.key === 'End' ? 'settle' : tab === 'book' ? 'settle' : 'book';
    setTab(next);
    event.currentTarget.querySelector<HTMLButtonElement>(`#demo-${next}-tab`)?.focus();
  };
  const update = (id: string, value: Partial<DemoEntry>) => {
    setEntries(previous => previous.map(entry => entry.id === id ? { ...entry, ...value } : entry));
    setCopied(false); setShareOpen(false); setProof(null);
  };
  return <main className={styles.page} lang="ko">
    <nav className={styles.top}><Link href="/chagok" aria-label="차곡 소개로 돌아가기">← 차곡</Link><span>예시 장부</span></nav>
    <header className={styles.header}>
      <p className={styles.eyebrow}>셋이 함께 쓴 돈</p>
      <h1>금액을 바꿔 보세요.</h1>
      <p>각자 낸 돈과 함께 나눌 사람에 따라 정산이 달라져요.</p>
    </header>
    <div className={styles.total} aria-live="polite" aria-atomic="true">
      <span>총 지출</span><strong>{result ? won(result.totalAmount) : '금액을 확인해 주세요'}</strong>
    </div>
    <div className={styles.tabs} role="tablist" aria-label="체험 화면" onKeyDown={navigateTabs}>
      <button role="tab" id="demo-book-tab" tabIndex={tab === 'book' ? 0 : -1} aria-controls="demo-panel" aria-selected={tab === 'book'} onClick={() => setTab('book')}>장부</button>
      <button role="tab" id="demo-settle-tab" tabIndex={tab === 'settle' ? 0 : -1} aria-controls="demo-panel" aria-selected={tab === 'settle'} onClick={() => setTab('settle')}>정산</button>
    </div>
    <section role="tabpanel" id="demo-panel" aria-labelledby={tab === 'book' ? 'demo-book-tab' : 'demo-settle-tab'} className={styles.panel}>
      {tab === 'book' ? <>
        {entries.map(entry => <div key={entry.id} className={styles.entry}>
          <div className={styles.entryTop}><div><h2>{entry.title}</h2><span>{who(entry.payerId)} 결제</span></div>
            <div className={styles.amountField}><input aria-label={`${entry.title} 금액`} aria-invalid={!!errors[entry.id]} aria-describedby={errors[entry.id] ? `error-${entry.id}` : undefined}
              inputMode="numeric" value={entry.amount} onChange={event => update(entry.id, { amount: event.target.value })} maxLength={13} /><span>원</span></div>
          </div>
          <div className={styles.participants} role="group" aria-label={`${entry.title} — 나눌 사람`}>
            <button aria-pressed={entry.together} onClick={() => update(entry.id, { together: true })}>셋이 함께</button>
            <button aria-pressed={!entry.together} onClick={() => update(entry.id, { together: false })}>지우 · 서연만</button>
          </div>
          {errors[entry.id] ? <p id={`error-${entry.id}`} className={styles.error} role="alert">{errors[entry.id]}</p> : null}
        </div>)}
        <button className={styles.primary} onClick={() => setTab('settle')} disabled={!result}>정산 확인하기 <span aria-hidden>→</span></button>
      </> : result ? <>
        {result.transfers.length ? <p className={styles.note}>이렇게 보내면 각자 나눠 낼 금액이 맞아져요.</p> : null}
        {result.transfers.map(transfer => <div key={`${transfer.fromMemberId}-${transfer.toMemberId}`} className={styles.transfer}>
          <div><span aria-label={`보내는 사람 ${who(transfer.fromMemberId)}, 받는 사람 ${who(transfer.toMemberId)}`}>{who(transfer.fromMemberId)} <span aria-hidden>→</span> {who(transfer.toMemberId)}</span><strong>{won(transfer.amount)}</strong></div>
        </div>)}
        {!result.transfers.length ? <p>주고받을 금액이 없어요.</p> : null}
        <h2 className={styles.sectionTitle}>계산 과정</h2>
        {result.balances.map(balance => {
          const amount = balance.totalPaid - balance.totalOwed;
          const open = proof === balance.memberId;
          return <div className={styles.balance} key={balance.memberId}>
            <button aria-expanded={open} aria-controls={`proof-${balance.memberId}`} onClick={() => setProof(open ? null : balance.memberId)}>
              <span>{who(balance.memberId)}</span><span>{amount > 0 ? '받을 금액' : amount < 0 ? '보낼 금액' : '주고받을 금액'} {won(Math.abs(amount))}</span><span aria-hidden>{open ? '−' : '+'}</span>
            </button>
            {open ? <div id={`proof-${balance.memberId}`} className={styles.proof}>
              <dl className={styles.shareBreakdown}>{result.breakdowns.map(item => {
                const share = item.shares.find(part => part.memberId === balance.memberId);
                return <div key={item.expense.id}><dt>{item.expense.title} {share?.roundingAdjusted ? '(1원 조정)' : ''}</dt><dd>{share ? won(share.amount) : '함께 나누지 않음'}</dd></div>;
              })}</dl>
              <dl><div><dt>결제한 금액</dt><dd>{won(balance.totalPaid)}</dd></div><div><dt>나눠 낼 금액</dt><dd>{won(balance.totalOwed)}</dd></div></dl>
              <p>{amount === 0 ? '결제한 금액과 나눠 낼 금액이 같아요.' : amount < 0 ? `${won(balance.totalOwed)} − ${won(balance.totalPaid)} = ${won(-amount)} 보내기` : `${won(balance.totalPaid)} − ${won(balance.totalOwed)} = ${won(amount)} 받기`}</p>
            </div> : null}
          </div>;
        })}
        <button className={styles.secondary} onClick={() => { setShareOpen(!shareOpen); setCopied(false); setCopyError(false); }}>공유할 내용 확인</button>
        {shareOpen && text ? <div className={styles.share}>
          <p>내용을 확인한 뒤 직접 보내 주세요.</p><pre>{text}</pre>
          <button className={styles.primary} onClick={() => {
            setCopyError(false);
            void Promise.resolve().then(() => navigator.clipboard.writeText(text)).then(() => setCopied(true)).catch(() => setCopyError(true));
          }}>{copied ? '복사했어요' : '내용 복사'}</button>
          <p role="status">{copyError ? '복사하지 못했어요. 위 내용을 직접 선택해 복사할 수 있어요.' : copied ? '보낼 채팅방에 붙여 넣어 주세요.' : ''}</p>
        </div> : null}
      </> : <><p className={styles.error}>장부에서 입력한 금액을 확인해 주세요.</p><button className={styles.secondary} onClick={() => setTab('book')}>장부로 돌아가기</button></>}
    </section>
    <section className={styles.start}>
      <h2>이제 우리 팀 장부로.</h2><p>회비와 개인 결제를 함께 기록하고, 확정한 정산을 남겨 두세요.</p>
      <Link className={styles.primary} href="/login?next=%2Fteams%2Fnew">새 장부 만들기 <span aria-hidden>↗</span></Link>
    </section>
    <div className={styles.footnote}><p>체험용 이름과 기록입니다. 입력은 이 화면에서만 사용하며 서버에 저장하지 않습니다. 새로고침하면 초기화됩니다.</p>
      <button onClick={() => { setEntries(starterEntries.map(entry => ({ ...entry }))); setTab('book'); setProof(null); setShareOpen(false); setCopied(false); setCopyError(false); }}>처음 상태로</button>
    </div>
  </main>;
}
