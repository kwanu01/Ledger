import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { getLang } from '../lib/lang.ts';
import { HelperProvider } from './helper/HelperContext.tsx';
import Helper from './helper/Helper.tsx';

/**
 * 글꼴을 직접 심는다. (§20)
 *
 * 시스템 글꼴 목록에 기대면 윈도우에서는 맑은 고딕, 맥에서는 애플 SD 산돌고딕이
 * 나와서 같은 장부가 컴퓨터마다 다르게 보인다. 장부는 어디서 열어도 같아야 한다.
 *
 * 두 벌을 잘라 함께 보낸다. 장부는 원래 손으로 쓰거나 타자로 친 서류였다.
 * 타자기는 글자 폭이 전부 같아서 금액 칸이 흔들리지 않는다.
 *
 *   Courier Prime      — 로마자와 숫자. 화면에서 읽으라고 다시 그린 쿠리어다.
 *                        숫자 폭이 전부 같아서 금액 칸이 흔들리지 않는다.
 *   나눔명조           — 한글. 우리 인쇄물과 서류의 본문 활자가 오래 명조였다.
 *                        고정폭 한글은 글자 사이가 너무 벌어져 투박해진다 —
 *                        숫자만 폭이 같으면 표는 이미 맞는다.
 *
 * 둘 다 SIL OFL 1.1 (app/fonts/LICENSE-*.txt) — 상업적 사용을 포함해 쓰는 데
 * 제한이 없다. 라이선스 전문을 저장소에 함께 둔다.
 *
 * 이름을 따로 두는 이유: 한 이름 아래 두 벌을 넣으면 같은 굵기끼리 부딪혀
 * 한쪽이 통째로 묻힌다. 이름을 나누고 CSS에서 로마자를 앞에 세우면 글자마다
 * 제 몸에 맞는 활자가 골라진다.
 */
const courier = localFont({
  src: [
    { path: './fonts/CourierPrime-Regular.subset.woff2', weight: '400', style: 'normal' },
    { path: './fonts/CourierPrime-Bold.subset.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-latin',
  display: 'swap',
});

const hanSerif = localFont({
  src: [
    { path: './fonts/NanumMyeongjo-Regular.subset.woff2', weight: '400', style: 'normal' },
    { path: './fonts/NanumMyeongjo-Bold.subset.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-han',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Ledger',
  description: '팀 프로젝트의 지출을 기록하고, 검산 가능하게 정산하고, 하나의 공동 장부로 남긴다.',
  /*
   * 아이콘 (§20)
   *
   * 로고의 서명을 한 글자로 줄여 흑백으로만 그렸다. 도장의 빨강은 뺐다.
   * 탭에 놓이는 16픽셀에서는 색이 아니라 획이 먼저 사라지기 때문이다.
   *
   * favicon.ico 한 파일 안에 16·32·48·64·128·256을 담고, 작은 것일수록
   * 획을 굵혀 따로 그렸다. 같은 그림을 줄이기만 하면 획이 1픽셀 아래로
   * 내려가 회색 얼룩이 된다. sizes="any"로 알려 주어야 브라우저가 그중
   * 제 자리에 맞는 크기를 골라 쓴다.
   */
  icons: {
    icon: [{ url: '/favicon.ico', sizes: 'any' }],
    apple: [{ url: '/apple-icon.png', sizes: '180x180' }],
  },
};

/**
 * 도우미는 모든 화면에 함께 있다(§21.10).
 *
 * 여기 두는 이유는 하나다. 경고와 안내가 화면마다 다른 자리에 뜨면 사용자는
 * 무엇이 잘못됐는지 찾으러 다녀야 한다. 말하는 자리를 하나로 모으려면
 * 그 자리가 모든 화면에 있어야 한다.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang} className={`${courier.variable} ${hanSerif.variable}`}>
      <body>
        <HelperProvider>
          <div className="wrap">{children}</div>
          <Helper lang={lang} />
        </HelperProvider>
      </body>
    </html>
  );
}
