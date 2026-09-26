import Link from 'next/link';

export const metadata = { title: '업데이트 — teamLedger' };

const releases = [
  {
    date: '2026.09.26',
    title: '개인 장부 시험 화면을 첫 화면에서 내렸습니다',
    items: [
      '개인 장부가 아직 저장과 팀 장부 연결 면에서 부족해 첫 화면에서 내렸습니다.',
      '이미 적은 개인 기록은 미리보기 화면에서 확인하고 지울 수 있습니다.',
      '첫 화면은 팀 장부와 바로 나누기 두 가지로 돌아갔습니다.',
    ],
  },
  {
    date: '2026.09.21',
    title: '웹과 iPhone을 한 흐름으로 정리했습니다',
    items: [
      '당시 첫 화면에서 일회성 계산기를 빼고 장부 시작에 집중했습니다.',
      'iPhone 앱에 한국어와 영어 화면을 넣고, 웹 장부를 그대로 이어서 볼 수 있게 했습니다.',
      '영수증의 할인·환불·금액 보정을 원래 항목과 연결해 계산합니다.',
      '수증이는 장부 질문, 한 줄 입력, 영수증 읽기를 돕습니다. 저장 전에는 항상 내용을 확인합니다.',
    ],
  },
  {
    date: '2026.09.18',
    title: '정산 과정을 더 쉽게 확인할 수 있습니다',
    items: [
      '누가 누구에게 얼마를 보내는지 먼저 보여 주고, 계산 근거는 필요할 때 펼쳐 봅니다.',
      '확정한 정산은 회차별로 남고, 이후에 추가한 지출과 섞이지 않습니다.',
      '송금 완료와 수령 확인을 각자 기록할 수 있습니다.',
    ],
  },
  {
    date: '2026.09.15',
    title: '공금과 보고서를 추가했습니다',
    items: [
      '회비, 지원금, 이월금과 공금 지출을 개인 정산과 나눠 기록합니다.',
      '월별·분류별 지출을 확인하고 CSV와 PDF로 내보낼 수 있습니다.',
      '장부 초대 링크와 계정 삭제 절차를 정리했습니다.',
    ],
  },
];

export default function Updates() {
  return (
    <main className="updates-page">
      <header className="updates-head">
        <p>teamLedger</p>
        <h1>업데이트</h1>
        <span>달라진 기능만 간단히 기록합니다.</span>
      </header>

      <div className="updates-list">
        {releases.map((release) => (
          <article className="update-entry" key={release.date}>
            <time dateTime={release.date.replaceAll('.', '-')}>{release.date}</time>
            <div>
              <h2>{release.title}</h2>
              <ul>{release.items.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          </article>
        ))}
      </div>

      <nav className="updates-actions" aria-label="업데이트 다음 이동">
        <Link href="/teams">내 장부 열기</Link>
        <Link href="/teamledger">teamLedger 소개</Link>
      </nav>
    </main>
  );
}
