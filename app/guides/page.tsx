import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './guides.module.css';

export const metadata: Metadata = {
  title: '공동 지출 정리 가이드 | teamLedger',
  description: '여행, 프로젝트, 동아리에서 함께 쓴 돈을 기록하고 정산하는 방법을 teamLedger 사용 흐름으로 안내합니다.',
  alternates: { canonical: 'https://teamledger.net/guides' },
  openGraph: {
    title: '공동 지출 정리 가이드 | teamLedger',
    description: '함께 쓴 돈을 기록하고 정산할 때 놓치기 쉬운 기준과 순서를 정리했습니다.',
    url: 'https://teamledger.net/guides',
    siteName: 'teamLedger',
    locale: 'ko_KR',
    type: 'article',
  },
};

const steps = [
  ['1. 장부의 범위를 먼저 정합니다', '여행 날짜, 프로젝트 기간, 회비를 쓰는 목적처럼 어디까지를 같은 장부에 둘지 먼저 적습니다. 개인 비용과 공동 비용이 섞일 때도 기준이 있으면 나중에 다시 묻지 않아도 됩니다.'],
  ['2. 결제할 때 바로 남깁니다', '가게와 금액만 적는 대신, 누가 먼저 결제했는지와 함께 나눌 사람을 함께 확인합니다. 영수증을 읽었을 때는 할인·쿠폰·환불이 별도 줄로 잡히는지 저장 전에 확인하세요.'],
  ['3. 계산 근거를 확인한 뒤 정산합니다', '정산 결과보다 먼저 각 항목의 참여자와 금액을 살펴봅니다. teamLedger에서는 누가 누구에게 보낼지와 그 계산 과정을 나란히 확인할 수 있습니다.'],
  ['4. 송금 뒤 회차를 남깁니다', '송금을 마쳤다면 그 회차를 확정해 둡니다. 새 지출은 다음 회차에 쌓이므로 이전 결과와 섞이지 않고, 총무가 바뀌어도 기록을 이어 볼 수 있습니다.'],
];

const cases = [
  ['여행', '숙소를 한 사람이 결제하고 식사·교통비를 여러 명이 나눠 냈다면, 항목마다 실제 참여자만 선택하세요. 모두가 쓰지 않은 비용을 균등하게 나누지 않는 것이 가장 중요합니다.'],
  ['팀 프로젝트', '공용 재료비와 개인 준비물은 성격이 다릅니다. 공용 비용은 팀 전체에, 개인 준비물은 필요한 사람만 포함해 기록합니다. 지원금이나 회비는 공금으로 따로 남기면 잔액도 함께 보입니다.'],
  ['동아리·모임', '회비를 걷는 날과 지출한 날을 분리해 기록합니다. 행사 뒤에는 지출 목록을 먼저 공유하고 정산을 확정하면, 다음 모임에서도 같은 장부를 계속 사용할 수 있습니다.'],
];

export default function GuidesPage() {
  return <main className={styles.page}>
    <header className={styles.header}>
      <Link href="/teamledger" className={styles.brand}>teamLedger</Link>
      <Link href="/login?next=%2Fteams%2Fnew" className={styles.start}>웹 장부 시작</Link>
    </header>
    <article>
      <p className={styles.kicker}>공동 지출 정리 가이드</p>
      <h1>함께 쓴 돈을<br />나중에 헷갈리지 않게.</h1>
      <p className={styles.lead}>여행, 팀 프로젝트, 동아리에서 돈이 오갈 때 필요한 것은 복잡한 표가 아니라 같은 기준으로 남긴 기록입니다. 이 페이지는 장부를 시작하고 정산을 마치는 순서를 안내합니다.</p>

      <section className={styles.section} aria-labelledby="process">
        <h2 id="process">기록부터 정산까지</h2>
        <ol className={styles.steps}>{steps.map(([title, body]) => <li key={title}><h3>{title}</h3><p>{body}</p></li>)}</ol>
      </section>

      <section className={styles.section} aria-labelledby="discounts">
        <h2 id="discounts">할인과 환불은 어떻게 적나요?</h2>
        <p>할인·쿠폰·배달비·환불은 물건값과 같은 방식으로 나누면 금액이 어긋나기 쉽습니다. 할인은 원래 결제의 음수 보정으로, 환불은 환불받은 사람과 대상 항목을 연결해 적는 편이 안전합니다. 영수증 인식 결과에 이런 줄이 포함되어 있으면 저장 전 금액 부호와 참여자를 확인하세요.</p>
        <p>예를 들어 12,000원과 10,000원을 주문하고 1,000원 할인을 받았다면, 총액은 21,000원입니다. 할인 줄을 양수로 처리하면 총액이 23,000원이 되므로, 장부에는 반드시 −1,000원으로 반영되어야 합니다.</p>
      </section>

      <section className={styles.section} aria-labelledby="situations">
        <h2 id="situations">상황별로 이렇게 시작하세요</h2>
        <div className={styles.cases}>{cases.map(([title, body]) => <section key={title}><h3>{title}</h3><p>{body}</p></section>)}</div>
      </section>

      <section className={styles.section} aria-labelledby="privacy">
        <h2 id="privacy">기록을 함께 보는 기준</h2>
        <p>초대 링크는 필요한 팀원에게만 공유하고, 장부에 참여한 사람은 같은 지출과 정산 내역을 볼 수 있다는 점을 먼저 알리세요. 팀원과 공유하지 않을 개인 메모나 결제 정보는 장부에 넣지 않는 것이 좋습니다. 데이터 처리와 삭제 방법은 <Link href="/privacy">개인정보 처리방침</Link>에서 확인할 수 있습니다.</p>
      </section>

      <aside className={styles.callout}><p>장부를 만드는 데 오래 걸리지 않습니다.</p><Link href="/login?next=%2Fteams%2Fnew">새 장부 만들기</Link></aside>
    </article>
  </main>;
}
