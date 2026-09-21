import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import Wordmark from '../Wordmark.tsx';
import styles from './marketing.module.css';
const START = '/login?next=%2Fteams%2Fnew';
const APP_STORE = 'https://apps.apple.com/kr/app/teamledger/id6812596640';
const title = '함께 쓰는 장부, teamLedger';
const description = '각자 쓴 돈과 회비, 지원금을 한 장부에. 계산 과정을 확인하고 정산 결과를 회차별로 남기세요.';
export const metadata: Metadata = {
  metadataBase: new URL('https://teamledger.net'),
  title, description,
  alternates: { canonical: 'https://teamledger.net/teamledger' },
  openGraph: { title, description, url: 'https://teamledger.net/teamledger', siteName: 'teamLedger', locale: 'ko_KR', type: 'website' },
};

const questions = [
  ['팀원과는 어떻게 함께 쓰나요?', '웹 장부의 초대 링크를 공유하면 팀원이 로그인한 뒤 참여할 수 있어요. 같은 장부의 지출과 정산 내역을 함께 확인합니다.'],
  ['teamLedger에서 실제로 돈을 보내나요?', 'teamLedger는 누가 누구에게 얼마를 보낼지 계산하고 기록합니다. 실제 송금은 사용하던 은행 앱에서 진행해 주세요. 보냄·받음 표시는 사용자가 확인해 남기는 기록이에요.'],
  ['수증이는 어떤 일을 도와주나요?', '한 줄로 적은 내용과 영수증 사진을 정리하고, 웹 장부에 대한 질문에 답해요. 읽은 금액과 내용을 직접 확인한 뒤 저장하세요. AI 기능에는 장부별 사용 한도가 있습니다.'],
  ['iPhone 앱은 어디서 받나요?', 'App Store에서 teamLedger를 검색해 설치할 수 있어요. 웹 장부와 같은 계정으로 로그인하면 참여 중인 장부를 이어서 볼 수 있습니다.'],
];

function Arrow() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function TeamLedgerIntroduction() {
  return <div className={styles.page} lang="ko">
    <a className={styles.skip} href="#teamledger-main">본문으로 이동</a>
    <header className={styles.nav}>
      <Link className={styles.wordmark} href="/teamledger" aria-label="teamLedger 소개 홈"><Wordmark /></Link>
      <Link className={styles.navLink} href={START}>웹 장부 시작 <Arrow /></Link>
    </header>

    <main id="teamledger-main" className={styles.main}>
      <section className={styles.hero} aria-labelledby="teamledger-title">
        <div className={styles.intro}>
          <p className={styles.eyebrow}>공동 지출 · 회비 · 정산</p>
          <h1 id="teamledger-title">함께 쓰는 장부,<br />teamLedger.</h1>
          <p className={styles.lead}>각자 쓴 돈도, 함께 모은 돈도.<br />한 장부에 적고 분명하게 정산하세요.</p>
          <div className={styles.actions}>
            <Link className={styles.primary} href={START}>웹 장부 시작 <Arrow /></Link>
            <a className={styles.secondary} href={APP_STORE}>iPhone 앱</a>
          </div>
          <p className={styles.availability}>하나의 계정으로 웹과 iPhone에서 이어서 사용</p>
        </div>

        <figure className={styles.preview} aria-label="teamLedger 장부 화면 예시">
          <div className={styles.appFrame}>
            <div className={styles.appTop}>
              <span>여행 장부</span>
              <span>3명</span>
            </div>
            <div className={styles.appTotal}>
              <small>이번 정산</small>
              <strong>148,500원</strong>
            </div>
            <div className={styles.appRows}>
              <div><span>숙소</span><b>96,000</b></div>
              <div><span>저녁</span><b>38,500</b></div>
              <div><span>택시</span><b>14,000</b></div>
            </div>
            <div className={styles.appSettle}>
              <span>민수</span><i aria-hidden="true">→</i><span>지우</span><strong>25,500원</strong>
            </div>
            <div className={styles.appFoot}><span>계산 과정 보기</span></div>
          </div>
          <figcaption>기록에서 정산까지 한 흐름으로 이어집니다.</figcaption>
        </figure>
      </section>

      <section className={styles.features} aria-label="teamLedger로 정리하는 세 가지">
        <article className={styles.feature}>
          <span className={styles.number}>01</span>
          <h2>각자 결제해도</h2>
          <p>결제한 사람과 함께 나눌 사람을 적으세요. 개인 카드로 먼저 낸 돈도 놓치지 않아요.</p>
        </article>
        <article className={styles.feature}>
          <span className={styles.number}>02</span>
          <h2>회비와 지원금도</h2>
          <p>함께 모은 돈과 쓴 돈을 나란히. 공금이 얼마나 남았는지 같은 장부에서 확인하세요.</p>
        </article>
        <article className={styles.feature}>
          <span className={styles.number}>03</span>
          <h2>정산한 뒤에도</h2>
          <p>계산 과정을 펼쳐 보고 결과를 회차별로 남기세요. 다음 정산과 총무 교대에도 참고할 수 있어요.</p>
        </article>
      </section>

      <section className={styles.assistant} aria-labelledby="assistant-title">
        <div className={styles.assistantDrawing}><Image src="/helper/point.png" width={90} height={90} alt="" sizes="90px" /></div>
        <div><p className={styles.eyebrow}>수증이의 입력 도움</p><h2 id="assistant-title">적는 일은 조금 가볍게.</h2><p>한 줄로 적거나 영수증을 읽고,<br className={styles.mobileBreak} /> 확인한 뒤 장부에 넣으세요.</p></div>
        <span className={styles.assistantNote}>웹 장부에서 이용할 수 있어요.</span>
      </section>

      <section className={styles.faq} aria-labelledby="faq-title">
        <div className={styles.faqHeading}><p className={styles.eyebrow}>시작하기 전에</p><h2 id="faq-title">궁금한 점</h2></div>
        <div className={styles.questions}>{questions.map(([question, answer]) => <details key={question} className={styles.question}>
          <summary>{question}<span className={styles.plus} aria-hidden="true" /></summary><p>{answer}</p>
        </details>)}</div>
      </section>

      <section className={styles.last} aria-labelledby="last-title">
        <div><h2 id="last-title">팀의 장부를 시작하세요.</h2><p>로그인한 뒤 장부를 만들고 팀원을 초대할 수 있어요.</p></div>
        <Link className={styles.primary} href={START}>웹 장부 시작 <Arrow /></Link>
      </section>
    </main>
  </div>;
}
