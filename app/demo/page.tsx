import type { Metadata } from 'next';
import DemoLedger from './DemoLedger.tsx';
export const metadata: Metadata = {
  title: '차곡 체험 — 함께 쓴 돈의 계산 과정까지',
  description: '예시 장부의 금액과 참여자를 바꾸며 공동 지출과 정산을 직접 계산해 보세요. 로그인 없이 사용할 수 있습니다.',
  alternates: { canonical: 'https://teamledger.net/demo' },
  openGraph: { title: '함께 쓴 돈, 계산 과정까지 — 차곡 체험', description: '금액을 바꾸고, 누구에게 얼마를 보내는지 바로 확인하세요.', url: 'https://teamledger.net/demo', type: 'website', images: [{ url: 'https://teamledger.net/chagok/opengraph-image', width: 1200, height: 630 }] },
};
export default function DemoPage() { return <DemoLedger />; }
