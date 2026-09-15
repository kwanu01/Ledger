import type { Metadata } from 'next';
import Link from 'next/link';
import { sharedExpenseExample } from './example.ts';
import styles from './guide.module.css';

const title = '회비와 개인 결제, 어떻게 정산하나요? | 차곡';
const description = '공금으로 낸 식사비와 개인 돈으로 먼저 낸 준비물 비용. 세 사람의 예시로 공금 잔액과 주고받을 금액을 구분해 보세요.';
export const metadata: Metadata = {
  title, description,
  alternates: { canonical: 'https://teamledger.net/guides/shared-expenses' },
  openGraph: {
    title, description, type: 'article', locale: 'ko_KR',
    url: 'https://teamledger.net/guides/shared-expenses',
    images: [{ url: 'https://teamledger.net/chagok/opengraph-image', width: 1200, height: 630 }],
  },
};

const won = (amount: number) => `${amount.toLocaleString('ko-KR')}원`;

export default function SharedExpensesGuide() {
  const { ledger, fund, result } = sharedExpenseExample();
  const name = (id: string) => ledger.members.find(member => member.id === id)!.name;
  const sharedCost = result.sharedAmount;
  return <main className={styles.page} lang="ko">
    <nav className={styles.nav} aria-label="도움말 탐색">
      <Link href="/chagok">← 차곡 소개</Link><span>정산 도움말</span>
    </nav>
    <article>
      <header className={styles.header}>
        <p className={styles.eyebrow}>회비 · 공금 · 개인 결제</p>
        <h1>회비와 개인 결제,<br />어떻게 정산하나요?</h1>
        <p>같이 쓴 돈이어도 어디서 돈이 나갔는지는 다릅니다. 공금으로 이미 낸 비용과 개인 돈으로 먼저 낸 비용을 구분해 보세요.</p>
      </header>

      <section className={styles.section} aria-labelledby="guide-example-title">
        <div className={styles.sectionHead}><h2 id="guide-example-title">세 사람의 장부</h2><span>가상 기록</span></div>
        <p>민수, 지우, 서연이 회비를 {won(ledger.duesPerHead!)}씩 냈습니다. 모인 돈으로 식사하고, 준비물은 민수가 개인 돈으로 먼저 샀어요. 두 비용 모두 세 사람이 함께 썼습니다.</p>
        <dl className={styles.entries}>
          <div><dt>회비 <small>3명 × {won(ledger.duesPerHead!)}</small></dt><dd>{won(fund.dues)}</dd></div>
          <div><dt>식사 <small>모아 둔 공금으로 결제</small></dt><dd>{won(fund.spent)}</dd></div>
          <div><dt>준비물 <small>민수가 개인 돈으로 결제</small></dt><dd>{won(sharedCost)}</dd></div>
        </dl>
      </section>

      <section className={styles.section} aria-labelledby="guide-fund-title">
        <p className={styles.step}>01</p><h2 id="guide-fund-title">공금은 남은 돈을 확인합니다.</h2>
        <p>식사비는 이미 모아 둔 회비에서 나갔습니다. 이 돈을 다시 세 사람에게 청구하지 않습니다.</p>
        <div className={styles.equation}>
          <span>모은 회비 − 공금으로 쓴 돈</span>
          <p>{won(fund.received)} − {won(fund.spent)}</p>
          <strong>남은 공금 {won(fund.left)}</strong>
        </div>
        <p className={styles.note}>이 예시에서 남은 {won(fund.left)}은 공금으로 남습니다. 개인 결제를 정산한다고 자동으로 나누거나 돌려주지는 않습니다.</p>
      </section>

      <section className={styles.section} aria-labelledby="guide-people-title">
        <p className={styles.step}>02</p><h2 id="guide-people-title">개인 돈으로 낸 비용을 나눕니다.</h2>
        <p>준비물 {won(sharedCost)}은 세 사람이 똑같이 나누기로 했습니다. 한 사람당 {won(sharedCost / ledger.members.length)}입니다.</p>
        <div className={styles.equation}>
          <span>민수가 먼저 낸 돈 − 민수가 나눠 낼 돈</span>
          <p>{won(result.balances[0].totalPaid)} − {won(result.balances[0].totalOwed)}</p>
          <strong>민수가 받을 돈 {won(result.balances[0].netBalance)}</strong>
        </div>
        <ul className={styles.transfers} aria-label="예시에서 주고받을 금액">
          {result.transfers.map(transfer => <li key={transfer.fromMemberId}>
            <span aria-label={`보내는 사람 ${name(transfer.fromMemberId)}, 받는 사람 ${name(transfer.toMemberId)}`}>{name(transfer.fromMemberId)} <span aria-hidden="true">→</span> {name(transfer.toMemberId)}</span>
            <strong>{won(transfer.amount)}</strong>
          </li>)}
        </ul>
        <p className={styles.note}>위 금액은 계산 예시입니다. 차곡이 은행 이체를 실행하지는 않습니다.</p>
      </section>

      <section className={styles.section} aria-labelledby="guide-record-title">
        <h2 id="guide-record-title">장부에는 이렇게 구분해 적으세요.</h2>
        <ol className={styles.steps}>
          <li><strong>들어온 회비를 기록합니다.</strong><span>누가 얼마를 냈는지 수입으로 남깁니다.</span></li>
          <li><strong>공금으로 낸 식사비는 ‘공금’으로.</strong><span>공금 잔액에서 빠지고 사람 사이의 정산에는 넣지 않습니다.</span></li>
          <li><strong>개인 돈으로 낸 준비물은 결제자와 함께 나눌 사람을.</strong><span>민수를 결제자로 적고 세 사람을 고릅니다. 개인 카드로 결제했다는 이유만으로 ‘개인’ 귀속을 선택하지는 않습니다.</span></li>
        </ol>
        <p className={styles.takeaway}>공금 잔액과 개인 결제 정산을 나눠 보면, 아직 주고받아야 할 금액이 분명해집니다.</p>
      </section>

      <section className={styles.cta} aria-labelledby="guide-demo-title">
        <h2 id="guide-demo-title">나눌 사람이 달라지면?</h2>
        <p>가상 장부에서 금액과 참여자를 바꾸고 계산 과정을 확인해 보세요.</p>
        <Link href="/demo">가입 없이 정산 체험 <span aria-hidden="true">→</span></Link>
      </section>
    </article>
  </main>;
}
