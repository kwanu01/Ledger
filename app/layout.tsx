import type { Metadata } from 'next';
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';
import './globals.css';
import { getLang } from '../lib/lang.ts';
import { getTheme } from '../lib/theme.ts';
import SiteControls from './SiteControls.tsx';
import { HelperProvider } from './helper/HelperContext.tsx';
import Footer from './Footer.tsx';

export const metadata: Metadata = {
  title: 'teamLedger',
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
  const [lang, theme] = await Promise.all([getLang(), getTheme()]);
  return (
    /*
     * 고른 색을 여기서 미리 박아 둔다. 브라우저에서 고쳐 넣으면 그림이 다
     * 그려진 뒤에 색이 바뀌어, 어두운 화면을 쓰는 사람에게 흰 화면이 한 번
     * 번쩍인다. 아무것도 고르지 않았으면 아무것도 적지 않는다 — 그때는
     * CSS가 기기 설정을 따른다.
     */
    <html
      lang={lang}
      data-theme={theme ?? undefined}
    >
      <body>
        <HelperProvider>
          <SiteControls lang={lang} theme={theme}>
            <div className="wrap">
              {children}
              <Footer lang={lang} />
            </div>
          </SiteControls>
        </HelperProvider>
      </body>
    </html>
  );
}
