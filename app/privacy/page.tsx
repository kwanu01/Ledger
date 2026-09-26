import Logo from '../Logo.tsx';
import { getLang } from '../../lib/lang.ts';
import PrivacyEnglish from './PrivacyEnglish.tsx';

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const requested = (await searchParams).lang;
  const lang = requested === 'en' ? 'en' : await getLang();
  return { title: lang === 'en' ? 'Privacy Policy — teamLedger' : '개인정보 처리방침 — teamLedger' };
}

const MAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || 'rekuac01@gmail.com';
const ADS = Boolean(process.env.NEXT_PUBLIC_ADSENSE_CLIENT);
const rowHeading = {
  width: 96, padding: '12px 18px 12px 0', textAlign: 'left', verticalAlign: 'top',
  fontSize: 13, fontWeight: 500, lineHeight: 1.95,
} as const;

// Publish with the matching account/Apple/content-cleanup implementation.
// Open operator decisions are recorded in the App Store privacy preparation notes.
export default async function Privacy({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const requested = (await searchParams).lang;
  const lang = requested === 'en' ? 'en' : await getLang();
  return (
    <>
      <header><div className="topbar"><Logo /></div></header>
      <main className="doc">
        {lang === 'en' ? <PrivacyEnglish /> : <>
        <h1>개인정보 처리방침</h1>
        <p className="faint">최종 수정 2026년 9월 26일</p>
        <p>
          teamLedger는 함께 쓴 돈을 기록하고 정산하는 웹서비스와 iPhone 앱입니다.
          이 방침은 어떤 정보를 다루고, 어디에 보관하며, 어떻게 삭제를 요청할 수 있는지
          설명합니다.
        </p>

        <h2>기기 장부와 연결한 장부</h2>
        <p>
          웹 첫 화면의 개인 계산에 입력한 잔액, 급여일, 남겨둘 돈과 지출 기록은
          해당 브라우저에만 저장합니다. 계정이나 팀 장부에 연결되지 않으며,
          다른 기기와 동기화되지 않습니다. 첫 화면의 ‘기록 지우기’로 지울 수 있습니다.
        </p>
        <p>
          앱에서 로그인 없이 사용하는 기기 장부와 작성 중인 내용, 화면·소리·알림 설정은
          기기에 저장됩니다. 계정을 연결해도 기존 기기 장부를 서버에 자동으로 올리거나
          웹 장부와 합치지 않습니다.
        </p>
        <p>
          계정으로 연결한 장부에 저장한 기록은 서버에 보관하며, 그 장부에 접근할 수 있는
          팀원과 공유됩니다. PDF·CSV 보고서를 내보내면 이용자가 선택한 앱이나 저장 위치로
          파일이 전달됩니다. 리마인더는 기기에서 허용하고 켠 경우에 예약하며, 팀원 활동을
          서버에서 보내는 원격 푸시는 제공하지 않습니다.
        </p>

        <h2>처리하는 정보와 목적</h2>
        <p>
          <b>계정.</b> 로그인과 장부 접근 확인을 위해 이메일, 표시 이름, 사용자 식별자와
          인증 정보를 처리합니다. 외부 계정으로 로그인하면 해당 제공자가 동의에 따라
          전달한 정보를 받습니다. Apple 로그인에서는 이용자가 선택한 비공개 이메일
          주소를 사용할 수 있습니다. 외부 계정의 비밀번호는 받지 않습니다.
        </p>
        <p>
          <b>장부.</b> 항목·금액·날짜·구입처·분류·메모·결제자·분담 내역, 수입·회비·예산과
          정산·송금 확인 기록을 보관합니다. 이용자가 입력한 내용뿐 아니라 계산 결과와
          변경·확인 상태도 포함됩니다. 은행 거래를 자동 조회하거나 실제 이체를 실행하지
          않습니다.
        </p>
        <p>
          <b>사진.</b> 영수증 읽기를 요청하면 선택한 사진을 AI 처리 업체로 보냅니다.
          앱의 사진 읽기는 사진을 장부 첨부 파일로 자동 저장하지 않습니다. 웹에서
          사진을 장부에 남기거나 별도로 첨부한 경우에는 서버에 보관하고, 장부 접근 권한을
          확인한 뒤 같은 장부의 팀원에게 보여 줍니다.
        </p>
        <p>
          <b>사용·접속 기록.</b> AI 사용 한도와 처리 상태를 관리하기 위해 장부 ID,
          사용한 모델, 처리량·비용, 성공 여부와 시각 등을 저장합니다. 이 기록은 장부와
          연결됩니다. 호스팅·인증 서비스에서는 접속과 오류 기록을 처리하며, 서비스 운영과
          보안·장애 확인에 사용합니다.
        </p>
        <p><b>문의.</b> 이용자가 보낸 연락처와 문의 내용은 답변과 문제 해결을 위해 처리합니다.</p>

        <h2>수증이와 AI 전송</h2>
        <p>
          수증이 기능은 이용자가 요청할 때 서버를 거쳐 Anthropic의 Claude API를 사용합니다.
          앱에서는 전송할 내용과 처리 업체를 안내하고 동의를 받은 뒤 요청을 실행합니다.
        </p>
        <table className="facts">
          <tbody>
            <tr>
              <th scope="row" style={rowHeading}>장부 질문</th>
              <td>질문과 최근 대화, 팀·장부 이름, 팀원 이름, 지출·분담 내역과 회계 요약.
                요약에는 항목·금액·날짜·판매처·메모가 포함될 수 있습니다.</td>
            </tr>
            <tr>
              <th scope="row" style={rowHeading}>한 줄 입력</th>
              <td>입력한 문장, 팀원 이름과 입력자, 장부 통화와 날짜</td>
            </tr>
            <tr><th scope="row" style={rowHeading}>영수증 읽기</th><td>직접 선택하고 읽기를 요청한 영수증 사진</td></tr>
            <tr><th scope="row" style={rowHeading}>납부 요청문</th><td>요청하는 사람과 받는 사람의 이름, 금액과 요청 종류</td></tr>
          </tbody>
        </table>
        <p>
          웹에서 장부를 열지 않고 서비스에 관해 질문하는 경우에는 질문과 최근 대화를
          보내며, 장부 내용은 포함하지 않습니다. 앱에서는 사진을 고르기만 해서는 AI로 전송하지
          않습니다. AI가 정리한 입력은 확인한 뒤 저장하며, 요청문을 만든다고 상대방에게
          메시지가 자동 발송되지는 않습니다.
        </p>
        <p>
          앱에서 AI 전송을 거절해도 직접 입력과 계산을 사용할 수 있습니다. 수증이 화면에서
          동의를 해제할 수 있으며, 화면을 떠나거나 계정·장부를 바꾸면 다시 확인합니다.
          해제는 이후 요청에 적용되고, 이미 전송한 정보를 회수하는 기능은 아닙니다.
        </p>
        <p>
          AI 처리 업체는 요청 처리 외에도 보안·정책 준수·법적 요구에 따라 전송 내용과
          응답을 보관할 수 있습니다. 장부에 사진을 첨부하지 않는 것과 처리 업체의 보관은
          별개입니다. 자세한 기준은{' '}
          <a href="https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data"
            target="_blank" rel="noreferrer noopener">Anthropic의 API 데이터 보관 안내</a>
          에서 확인할 수 있습니다.
        </p>

        <h2>로그인 정보와 기기 저장</h2>
        <p>
          iPhone의 로그인 유지 정보는 기기의 보안 저장소에 보관합니다. 웹에서는 로그인,
          초대 장부 접근, 화면 언어와 로그인 후 복귀를 위한 쿠키를 사용합니다.
        </p>
        <p>
          Apple 로그인을 사용하는 경우 서버에서 인증 코드를 확인하고, 나중에 Apple 연결을
          해제하는 데 필요한 토큰을 암호화해 보관합니다. 인증 코드는 그대로 저장하지 않으며,
          계정과 인증 요청을 확인하기 위한 식별 정보와 처리 상태를 보관합니다.
          계정 삭제 때 Apple 연결 해제를 요청하고, 자동 해제를 확인하지 못한 경우
          수동 해제가 필요한지 안내합니다.
        </p>

        <h2>처리를 맡기는 곳과 지역</h2>
        <table className="facts">
          <tbody>
            <tr><th scope="row" style={rowHeading}>Supabase</th><td>로그인, 계정·연결 장부와 첨부 사진 보관</td></tr>
            <tr><th scope="row" style={rowHeading}>Vercel</th><td>웹·앱 서버 요청 처리, 호스팅과 접속·오류 기록</td></tr>
            <tr><th scope="row" style={rowHeading}>Anthropic</th><td>이용자가 요청한 AI 질문 응답과 입력·영수증 분석</td></tr>
            <tr><th scope="row" style={rowHeading}>Apple</th><td>Apple 로그인과 인증 연결 해제</td></tr>
            <tr><th scope="row" style={rowHeading}>Google</th><td>구글 로그인{ADS ? ', 웹 광고 게재' : ''}</td></tr>
            <tr><th scope="row" style={rowHeading}>카카오</th><td>웹에서 카카오 로그인·공유를 이용하는 경우의 처리</td></tr>
          </tbody>
        </table>
        <p>
          계정과 장부를 보관하는 기본 데이터베이스는 Supabase의 서울 지역을 사용합니다.
          이것이 모든 정보가 국내에서만 처리된다는 뜻은 아닙니다. 인증·호스팅·AI 처리와
          업체의 운영 과정에서 정보가 국외로 전송되거나 처리될 수 있습니다.
        </p>

        {ADS && (
          <>
            <h2>웹 광고</h2>
            <p>
              웹의 품목·아카이브 화면에서 구글 애드센스 광고를 제공합니다.
              iPhone 앱에는 광고를 넣지 않습니다. 구글 등 광고 공급업체는 광고를 위해
              쿠키를 사용할 수 있습니다. 서비스는 장부 내용을 광고 요청에 넣지 않습니다.
              맞춤 광고는{' '}
              <a href="https://myadcenter.google.com/" target="_blank" rel="noreferrer noopener">
                구글 광고 설정
              </a>
              에서 조정할 수 있습니다.
            </p>
          </>
        )}

        <h2>보관과 삭제</h2>
        <p>
          서버의 계정과 장부 정보는 로그인·기록·정산 기능을 제공하는 동안 보관합니다.
          삭제를 요청할 때는 계정 화면에서 삭제할 정보와 먼저 정리할 장부를 확인합니다.
          다른 팀원이 있는 장부의 소유자는 소유권을 먼저 넘겨야 할 수 있습니다.
        </p>
        <p>
          계정 삭제가 완료되면 계정·프로필을 지우고, 남는 공동 장부의 팀원 이름은
          &lsquo;탈퇴한 팀원&rsquo;으로 바꿉니다. 공동 장부의 금액·분담·정산 기록은 다른
          팀원의 계산과 기록을 위해 남습니다. 본인이 작성한 것으로 확인할 수 있는
          일부 입력 내용과 사진도 삭제 또는 비식별 처리합니다.
        </p>
        <p>
          과거 기록이나 여러 사람이 편집한 내용, 품목별 이름처럼 작성자를 구분할 수 없는
          내용은 자동으로 모두 지우지 않습니다. 여기에 개인정보가 남아 있다면 삭제 전에
          확인하거나 아래 연락처로 정리를 요청해 주세요. 삭제 과정의 오류나 확인이
          필요한 작업은 완료로 처리하지 않고 재시도 또는 문의를 안내합니다.
        </p>
        <p>
          서버 계정을 삭제해도 기기에 따로 보관한 장부와 이미 내보낸 보고서는 삭제되지
          않습니다. 다른 팀원이 내려받은 파일도 별도로 남을 수 있습니다. 백업·보안 로그와
          외부 처리 업체의 보관은 서비스 화면에서 기록을 삭제하는 것과 구분되며,
          적용되는 보관·삭제 조건에 관한 문의는 아래 연락처로 접수합니다.
        </p>

        <h2>이용자의 권리와 문의</h2>
        <p>
          자신의 정보에 대해 열람·정정·삭제·처리 정지를 요청할 수 있습니다. 서비스 안에서
          직접 처리하기 어렵거나 공동 기록에 개인정보가 남아 있다면 아래로 알려 주세요.
        </p>
        <p>
          {MAIL ? (
            <>앱 이용과 개인정보 관련 문의는 <a href={`mailto:${MAIL}`}>{MAIL}</a>로 보내 주세요.</>
          ) : (
            '앱 이용과 개인정보 관련 문의는 화면 아래의 연락처로 보내 주세요.'
          )}
        </p>

        <h2>만 14세 미만</h2>
        <p>이 서비스는 만 14세 미만 아동을 대상으로 하지 않습니다.</p>

        <h2>변경</h2>
        <p>
          방침을 바꾸면 수정일을 갱신합니다. 이용자의 권리에 영향을 주는 중요한 변경은
          적용 전에 서비스 화면에서 안내합니다.
        </p>
        </>}
      </main>
    </>
  );
}
