# Ledger

**팀 프로젝트의 지출을 기록하고, 검산할 수 있게 정산하고, 끝나면 하나의 공동 장부로 남기는 웹 서비스.**

<https://teamledger.net>

가입 없이 바로 나눌 수도 있고, 로그인해서 팀 장부를 만들 수도 있습니다.
팀원은 초대 링크만 받으면 되고, 아무도 가입하지 않아도 됩니다.

<sub>English version below · [English](#ledger-1)</sub>

---

## 왜 만들었나

학교 팀 프로젝트에서 돈은 늘 이렇게 흩어집니다.

한 사람이 재료를 사고 단톡방에 결제 화면을 캡처해 올립니다. 다른 사람이 출력비를
내고, 또 누군가 택시비를 냅니다. 캡처는 대화에 묻히고, 누가 얼마를 냈는지는
스크롤을 한참 올려야 나옵니다. 그러다 학기 말에 한 사람이 총대를 메고 엑셀을 켭니다.

그 엑셀은 대개 맞습니다. 그런데 받아 본 사람은 그게 맞는지 알 수 없습니다.
"현우 → 지수 18,000원"이라는 한 줄만 봐서는 왜 18,000원인지 알 수 없고,
모르면 결국 각자 다시 계산해 봅니다. 정산이 끝나고 나면 그 기록은 사라지고,
다음 학기에 "그때 그 아크릴 어디서 샀지?"라는 질문에 답할 사람이 없습니다.

세 가지가 문제였습니다.

1. **기록이 흩어진다.** 채팅, 메모, 각자의 머릿속에.
2. **정산 결과를 믿기 어렵다.** 검산할 수 없는 숫자는 결국 다시 계산하게 됩니다.
3. **끝나면 남는 게 없다.** 지출은 프로젝트가 만들어진 과정인데, 정산과 함께 버려집니다.

Ledger는 이 셋을 하나의 흐름으로 묶습니다.

```
기록 → 자동 정리 → 누적 → 검산 가능한 정산 → 카카오톡 공유 → 다시 누적 → 아카이브
```

이름은 회계의 **원장(ledger)** 이면서, 건축·비계에서 여러 부재를 수평으로 잇는
**구조재(ledger)** 이기도 합니다. 지출과 사람과 정산을 하나로 묶는다는 뜻에서
두 의미를 같이 씁니다.

---

## 무엇을 할 수 있나

### 가입 없이 바로 나누기

첫 화면에서 이름과 금액만 넣으면 바로 계산됩니다. 로그인도, 설치도 없습니다.
결과는 카카오톡으로 보낼 수 있습니다. 남겨 두고 싶어질 때 로그인하면 됩니다.

### 팀 장부

로그인한 사람이 팀과 장부를 만들고, 나머지는 **초대 링크**로 들어옵니다.
팀원 전원에게 가입을 요구하지 않습니다. 도입에서 가장 큰 마찰이 그것이라서요.

장부 하나가 프로젝트 하나입니다. 수업이 둘이면 팀도 둘이고, 장부도 둘입니다.

### 영수증을 찍으면 알아서 읽습니다

영수증 사진을 올리면 항목·금액·통화·날짜·판매처·분류를 읽어서 입력칸을 채웁니다.
사진이 누워 있어도 읽고, 배달비가 붙어 있으면 소계가 아니라 실제 결제한 총액을
가져옵니다. 품목이 여럿이면 `식사(마라탕 외 2건)`처럼 무엇을 산 것인지 알아서 묶습니다.

읽은 값은 그대로 저장되지 않습니다. 마지막으로 맞는지 보는 것은 언제나 사람입니다.

### 검산할 수 있는 정산

정산 결과는 송금 목록만 보여 주지 않습니다. 사람마다 이렇게 펼쳐집니다.

```
관우
직접 결제        64,500
공동 부담        88,000
────────────────────
부족한 금액      23,500
```

`결제한 돈 ± 주고받은 돈 = 부담할 돈`이 눈으로 닫힙니다. 머릿속으로 검산이 되면
그때부터 숫자를 믿게 됩니다. 이 서비스가 가장 신경 쓴 자리입니다.

나머지 1원은 버리지도 반올림하지도 않습니다. 명단 순서대로 1원씩 배분하고
화면에 `7,166 (+1)`처럼 드러냅니다.

### 중간 정산을 해도 기록은 남습니다

정산은 지출을 지우는 게 아니라 장부의 시간 위에 찍히는 사건입니다.
1차 정산을 끝내도 그 지출들은 그대로 남고, 그 아래로 새 지출이 계속 쌓입니다.

```
총 지출     715,050
정산 완료   407,600
미정산      307,450
```

### 카카오톡으로 보내기

정산이 끝나면 팀 전체에게 한 번에 보낼 수도 있고, **보낼 사람마다 따로**
보낼 수도 있습니다. 개별 메시지에는 그 사람이 누구에게 얼마를 보내야 하는지만
적힙니다. 단톡방에 모두의 금액이 다 뿌려지는 것이 싫을 때 씁니다.

> 송금 자체는 앱 밖에서 사람이 합니다. 카카오페이와 네이버페이는 외부 개발자에게
> 개인 간 송금 API를 제공하지 않습니다(가맹점 결제 API만 있습니다). 그래서 Ledger는
> 누가 누구에게 얼마를 보내야 하는지를 정확히 알려주고, **받은 사람이 확인해서**
> 그 줄을 닫습니다.

### 품목과 아카이브

산 물건은 사진과 구매 링크가 붙은 카드로 따로 볼 수 있습니다. 프로젝트가 끝나면
기간·총지출·건수·분류 분포·구매 목록이 한 장으로 정리됩니다. 그대로 인쇄하면
종이 장부가 됩니다(인쇄용 스타일시트를 넣어 두었습니다).

### 수증이

화면 구석에 종이 영수증 캐릭터가 서 있습니다. 이름은 **수증이**입니다.
처음 들어오면 이곳이 뭘 하는 곳인지 먼저 알려 주고, 화면마다 지금 할 수 있는 일을
한 마디씩 건넵니다. 장부에 대해 물어보면 대답도 합니다 — 다만 **숫자는 스스로
계산하지 않고** 정산 엔진이 이미 계산해 둔 표에서만 가져옵니다. 화면의 숫자와
수증이의 숫자가 어긋나는 일은 없어야 하니까요.

### 여섯 개 언어, 여러 통화

한국어 · 영어 · 일본어 · 중국어 · 스페인어 · 베트남어. 통화는 장부를 만들 때 정하고
그 뒤로 잠깁니다. **환율은 쓰지 않습니다.** 해외 결제는 카드사가 이미 환산해서
청구하므로 그 청구액을 씁니다.

---

## 어떻게 만들었나

### 스택

Next.js 15 (App Router) · React 19 · TypeScript · Supabase(Postgres · Auth · Storage) · Vercel.
UI 라이브러리를 쓰지 않았고, CSS도 직접 씁니다.

### 계층 규칙 하나

```
계산은 lib/domain/, 저장은 lib/db/repo.ts, 권한은 lib/access.ts.
서버 액션은 이 셋을 잇고 오류를 사람 말로 바꾸는 일만 한다.
```

```
lib/domain/       정산 엔진 — 프레임워크·DB·UI 어디에도 의존하지 않는 순수 함수
lib/db/           DB ↔ 도메인 매핑, 저장소, 사진
lib/access.ts     초대 토큰 검증과 접근 제어 — 모든 서버 액션의 첫 줄
lib/ai/           영수증 읽기, 장부 질문, 사용량 계량
lib/i18n.ts       여섯 언어 문자열
app/              화면과 서버 액션
supabase/         마이그레이션 11개 + 스키마 가드 테스트 30개
scripts/          정산 시뮬레이션, 아이콘·프로토타입 빌드
```

### 정산 엔진이 프레임워크를 모르는 이유

`lib/domain/`은 Next.js도 Supabase도 모릅니다. 순수 함수라서 브라우저에서도,
Node에서도, 테스트에서도 같은 결과를 냅니다. 그래서 **가입 없이 쓰는 빠른 나누기와
팀 장부가 똑같은 엔진을 씁니다.** 검산 로직이 두 벌이 되는 순간 신뢰가 깨지니까요.

`npm run simulate`은 의존성 없이 Node만으로 22건짜리 가상 프로젝트를 돌리고
불변식 25개를 검사합니다.

- 모든 지출에서 지분의 합 = 금액 (음수 금액 포함)
- 어떤 지출 집합에서도 balance 총합 = 0
- 송금을 모두 실행하면 전원 balance = 0, 송금 횟수 ≤ 인원 − 1
- 총지출 = 정산 완료 + 미정산, 중간 정산 후에도 원본 보존
- 팀원이 나중에 합류해도 과거 정산 결과가 바뀌지 않는다
- 이미 정산된 지출의 보정이 원본을 건드리지 않는다

### 회계 규칙을 DB에 새겼습니다

앱 코드가 실수해도 장부가 깨지면 안 됩니다. 그래서 같은 규칙을 Postgres 트리거로
한 번 더 강제합니다(`supabase/migrations/0002_guards.sql`).

- 정산에 들어간 지출은 수정·삭제할 수 없다 (사진 두 칸만 예외)
- 확정된 정산의 snapshot은 바꿀 수 없다
- 한 지출은 한 정산에만 들어간다
- 보정 항목의 부담 구조가 원본과 다르면 거부한다
- 환불 금액은 반드시 음수다
- 송금 완료는 **받은 사람만** 확인할 수 있다
- 확인된 송금이 하나라도 있으면 정산을 취소할 수 없다
- 지출이 있는 장부의 통화는 바꿀 수 없다

`supabase/tests/guards_test.sql`이 이 규칙 30개를 실제 Postgres에서 검사합니다.

### 원본은 고치지 않습니다

금액을 잘못 적었어도 그 줄을 고치지 않습니다. **차액만 새 줄로 남깁니다.**
환불도 같은 방식으로, 음수 금액 지출 한 줄입니다.

이렇게 하면 확정된 정산의 숫자가 영원히 바뀌지 않고, 왜 보정됐는지가 장부에
흔적으로 남습니다. 보정 항목은 원본의 부담 구조를 그대로 물려받습니다 —
4인이 나눠 낸 지출을 5인에게 환급하면 잔액이 남으니까요. 엔진·UI·DB 셋 다
이 규칙을 강제합니다.

지출마다 **기록 시점의 팀원 명단**을 통째로 저장합니다. 그래서 나중에 팀원이
늘어도 과거 지출이 다시 나뉘지 않습니다.

### 금액은 정수로만 셉니다

`715050`은 KRW면 ₩715,050, USD면 $7,150.50입니다. 언제나 그 통화의 **최소 단위
정수**로 저장하므로 정산 엔진은 통화를 몰라도 되고, 소수 두 자리 통화에서도
1센트가 새지 않습니다. 표기할 때만 통화를 씁니다.

### 접근 제어

브라우저는 DB에 직접 붙지 않습니다.

```
브라우저 → Next.js 서버 액션 → (service_role) → Postgres
```

초대 링크 방식이라 "로그인한 사용자"만으로는 권한을 표현할 수 없습니다.
토큰 접근을 RLS 정책으로 푸는 대신, 판정 지점을 서버 액션 한 곳(`lib/access.ts`)에
모았습니다. `anon`/`authenticated` 역할에는 정책을 주지 않아 기본 거부 상태입니다.

신분은 둘이고 둘 다 같은 `Pass`로 환원됩니다.

| 신분 | 어떻게 들어오나 | 판정 |
| --- | --- | --- |
| 장부를 만든 사람 | 이메일 매직링크 · 구글 · 카카오 | Supabase Auth 세션 |
| 나머지 팀원 | 초대 링크 | HMAC-SHA256 서명 쿠키 |

지켜지는 것들:

- 통행증에는 **발급 시각이 박혀 있고**, 넉 달이 지나면 서명이 맞아도 받지 않습니다.
- 통행증만으로 들어오는 사람은 **매번 명단에 아직 있는지 확인**합니다.
  명단에서 내려간 사람의 브라우저에 남은 쿠키로는 문이 열리지 않습니다.
- 로그인해 있으면 **계정이 언제나 쿠키보다 먼저**입니다.
- 초대 링크는 **장부를 만든 사람만** 발급·회수할 수 있습니다.
- 정산 취소·보정·송금 확인·사진 열람은 전부 **그 장부의 것인지**까지 확인합니다.
  "이 사람이 이 장부에 들어올 수 있는가"와 "이 자원이 그 장부의 것인가"는 다른
  질문이라서요.
- 로그인 후 돌아갈 주소는 **이 사이트 안의 경로만** 받습니다.
- 드라이버가 내는 영어 오류는 화면에 띄우지 않습니다. 표 이름과 제약 이름이
  그대로 읽히기 때문입니다.

### 사진

두 자리가 있습니다. 영수증 사진(그 지출의 근거)과 품목 사진(무엇을 샀는지).
둘 다 올리고 바꾸고 뗄 수 있습니다.

**자동으로 저장하지 않습니다.** 영수증을 AI로 읽는 것과 그 사진을 남기는 것은
다른 일입니다. 영수증에는 카드 뒷자리와 매장과 시각이 찍혀 있고 그게 팀원 전체에게
보입니다. 그래서 "이 영수증 사진을 장부에 남기기"를 고른 것만 저장됩니다.

**저장소는 공개하지 않습니다.** 브라우저는 `/l/<장부>/img/<경로>`로 받고, 그 자리에서
접근 권한을 판정한 뒤에 파일을 내보냅니다. 올릴 때는 파일이 적어 보낸 종류를 믿지
않고 **앞머리 바이트를 직접 보고** JPG·PNG·WEBP인지 확인합니다.

### AI

두 곳에서만 씁니다. 영수증 읽기와 장부 질문입니다. 둘 다 **사용자가 실행했을 때만**
동작하고, 장부 단위로 월 사용 한도가 걸려 있습니다(기본 200건). 비용은 키 주인이
내기 때문에 두 기능이 같은 한도를 함께 씁니다.

숫자를 모델에게 계산시키지 않는다는 규칙은 앞에 적은 대로입니다.

### 광고

애드센스는 **품목과 아카이브 화면에만** 들어갑니다. 홈·장부·정산 내역·지출 기입에는
넣지 않습니다. 그 화면들에는 누가 누구에게 얼마를 보내야 하는지가 적혀 있고,
정산 금액 옆에 서드파티 광고가 붙으면 이 서비스가 지키려는 신뢰가 깨집니다.
자동 광고(Auto ads)도 켜지 않습니다 — 켜면 구글이 화면을 고릅니다.

### 시각

순수한 웹의 검정, 흰색, 파랑만 씁니다. 종이 질감이나 색조를 흉내내지 않습니다.
아날로그 장부의 물성은 색이 아니라 **구조**에서 나온다고 보았습니다.

- 금액 칸을 감싸는 **세로 괘선** — 장부를 장부로 보이게 하는 건 가로줄이 아니라 이 선입니다
- **전표 번호** — 각 줄을 번호로 참조합니다. 정렬을 바꿔도 번호는 기입 순서 그대로입니다
- **이중 마감선** — 정산이 확정된 지점을 구획합니다
- **고무도장** — 확정된 자리에 찍힙니다. 줄마다 각도와 위치를 조금씩 어긋나게 뽑고
  SVG 노이즈를 씌워 잉크가 고르게 묻지 않게 했습니다
- **인쇄용 스타일시트** — 아카이브를 그대로 인쇄하면 종이 장부가 됩니다

글꼴은 셋입니다. 본문은 나눔명조, 숫자는 Courier Prime(자릿수가 맞게 떨어집니다),
로고는 19세기 상업 장부의 손글씨를 되살린 Mrs Saint Delafield입니다. 로고 글자만
남기고 잘라 1.4KB woff2로 파일에 직접 심었기 때문에, 오프라인에서도 CSP가 막힌
환경에서도 로고가 그대로 나옵니다. 로고에 마우스를 올리면 오른쪽 아래에 원형 인장이
돌아 들어와 찍힙니다.

**설명 문장을 쓰지 않습니다.** 첫 화면에 카피가 하나도 없습니다. 라벨과 숫자와
조작만 있습니다. 설명이 필요하다고 느껴지면 문장이 없는 게 아니라 화면이 잘못된
것으로 봅니다.

회계 용어라도 낯설면 쓰지 않습니다.

| 안 씀 | 씀 |
| --- | --- |
| 왜 이 금액인가? | 계산 보기 |
| 적요 | 항목 |
| 개인 귀속 | 개인이 가져갈 것 |
| 부담해야 할 몫 | 낼 몫 |
| 공동 정산 대상 | 함께 나눌 돈 |

### 좁은 화면

이 서비스는 폰에서 가장 많이 열립니다. 정산 링크가 카카오톡으로 오가고 받은 사람은
대개 폰으로 누릅니다. 그런데 장부는 원래 넓은 종이라, 여덟 칸을 350픽셀에 밀어 넣으면
글자가 세로로 접혀 "현/우"가 됩니다.

그래서 좁히지 않고 **접습니다.** 640px 아래에서 장부는 날짜·항목·금액만 남기고,
나머지는 줄을 눌렀을 때 펴집니다. 송금·초대·팀원 줄은 표를 접어 세로로 쌓습니다.
입력칸 글자는 `pointer:coarse`에서 16px로 키웁니다 — iOS는 그보다 작은 입력칸에
손을 대면 화면을 확대하고, 확대되면 그 뒤로 모든 것이 어긋나 보입니다.

---

## 직접 돌려보기

```bash
cp .env.example .env.local     # 값 채우기
npm install
npm run dev
```

`.env.local`에 넣을 값은 `.env.example`에 전부 설명해 두었습니다. 최소한 이 넷이
있어야 뜹니다.

| 값 | 어디서 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 프로젝트 설정 > API |
| `SUPABASE_SERVICE_ROLE_KEY` | 같은 자리. **절대 `NEXT_PUBLIC_`을 붙이지 않습니다** |
| `LEDGER_COOKIE_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `ANTHROPIC_API_KEY` | 영수증 읽기와 장부 질문에 씁니다. 없으면 그 기능만 꺼집니다 |

Supabase에서는 `supabase/migrations/`의 SQL을 번호 순서대로 실행합니다
(`supabase db push` 또는 대시보드의 SQL Editor). Authentication > Providers에서
Email을 켭니다.

```bash
npm run simulate     # 정산 시뮬레이션 + 불변식 25개 (의존성 없이 Node만으로)
npm run typecheck
npm run build
psql -d <db> -f supabase/tests/guards_test.sql   # 스키마 가드 30개
```

곁에 있는 문서 둘. 어느 코드도 import 하지 않지만 지우면 안 됩니다.

- `setup-guide.html` — Supabase·구글·카카오·배포까지 처음부터 따라 하는 설치 안내서
- `character-guide.html` — 수증이의 자세와 말투

---

## 확정된 결정

| 주제 | 결정 | 이유 |
| --- | --- | --- |
| 정산 후 지출 수정 | 원본 보존 + 보정 항목 | 확정된 정산 숫자가 영원히 안 바뀐다 |
| 환불 | 음수 금액 지출 | 엔진 수정 없이 부분 환불까지 처리된다 |
| 팀원 변동 | 지출마다 기록 시점 명단을 저장 | 나중에 팀원이 늘어도 과거 지출이 다시 안 나뉜다 |
| 배송비·할인 | 지출 금액에 합산 | 캡처 한 장으로 끝나는 입력 흐름을 유지 |
| 참여 방식 | 생성자만 로그인 + 초대 링크 | 팀원 전원 가입이 도입의 가장 큰 마찰 |
| AI 입력 | 서버에서 호출 + 장부당 월 상한 | 건당 약 4원. 키를 각자 넣게 하는 비용이 API 비용보다 크다 |
| 송금 | 앱 밖에서 사람이 하고 받은 사람이 확인 | 카카오페이·네이버페이는 P2P 송금 API를 주지 않는다 |
| 정산 공유 | 카카오톡 공유 | 검수 없이 쓸 수 있고 보낼 채팅방을 사용자가 고른다 |
| 금액 저장 | 통화의 최소 단위 정수 | 소수 두 자리 통화에서도 1센트가 새지 않는다 |
| 환율 | 쓰지 않는다 | 아무도 내지 않은 금액이 되고, 확정된 정산이 내일 달라진다 |
| 시각 | 순수한 웹의 검정·흰색·파랑 | 종이 질감이나 색조를 흉내내지 않는다 |
| 카피 | 쓰지 않는다 | 설명이 필요하면 화면이 잘못된 것이다 |

## 아직 못 한 것

- 내보내기 (CSV · JSON · Markdown) — 어디로든 갈 수 있는 형태가 먼저입니다
- 노션 연동
- 할인·쿠폰을 지출과 분리해 보여주기 (지금은 합산)
- 보증금·선결제
- 재구매 제안

---
---

# Ledger

**A shared ledger for team projects: record what you spend, settle it in a way
everyone can verify, and keep the whole thing as one archive when the project ends.**

<https://teamledger.net>

Split a bill without signing up, or log in and start a team ledger. Teammates
join through an invite link — nobody but the creator needs an account.

<sub>한국어 버전은 위에 있습니다 · [한국어](#ledger)</sub>

---

## Why this exists

Money on a student team project always scatters the same way.

Someone buys materials and drops a screenshot of the payment into the group chat.
Someone else pays for printing, someone else for a taxi. The screenshots sink into
the conversation. At the end of term one person opens a spreadsheet and works it out.

That spreadsheet is usually correct. The problem is that nobody receiving it can
tell. A line that reads "Hyunwoo → Jisoo ₩18,000" doesn't explain itself, and what
people can't verify, they recompute by hand. Then settlement day comes, the numbers
are paid, and the record disappears — so next term nobody can answer "where did we
buy that acrylic?"

Three problems:

1. **The record scatters** — across chat, notes, and people's memory.
2. **The result is hard to trust.** A number you can't check is a number you'll redo.
3. **Nothing survives.** Spending *is* the record of how a project got made, and it
   gets thrown away with the settlement.

Ledger ties them into one loop:

```
record → auto-organize → accumulate → verifiable settlement → share → accumulate → archive
```

The name is the accounting **ledger**, and also the **ledger** of scaffolding —
the horizontal member that ties other members together. Both meanings apply: it
ties expenses, people, and settlements into one structure.

---

## What it does

### Split without an account

Enter names and amounts on the landing page and it computes immediately. No login,
no install. Share the result to KakaoTalk. Log in only when you want to keep it.

### Team ledgers

The creator logs in; everyone else joins via an **invite link**. Requiring every
teammate to sign up is the single biggest adoption barrier, so it isn't required.

One ledger is one project. Two classes means two teams and two ledgers.

### Photograph a receipt and it reads itself

Upload a receipt and it fills in the item, amount, currency, date, vendor and
category. It reads sideways photos, and when a delivery fee is present it takes
the actual charged total rather than the subtotal. For multi-item receipts it
names what was bought — `Meal (Malatang +2)` — rather than listing everything.

Nothing extracted is saved on its own. A person always confirms.

### A settlement you can check in your head

Results aren't just a list of transfers. Each person expands:

```
Kwanu
Paid            64,500
Share of costs  88,000
────────────────────
Owes            23,500
```

`paid ± transferred = share` closes visibly. Once you can verify a number in your
head, you start trusting it. This is the part of the product that got the most care.

Leftover won (the remainder after division) is neither dropped nor rounded. It's
distributed one unit at a time in roster order and shown as `7,166 (+1)`.

### Mid-project settlements keep the record

A settlement doesn't erase expenses — it's an event stamped onto the ledger's
timeline. Settle once and those lines stay; new spending accumulates below.

```
Total        715,050
Settled      407,600
Outstanding  307,450
```

### Sharing to KakaoTalk

After settling, send the whole team one message — or send **each person their own**,
containing only who they pay and how much. Useful when you'd rather not broadcast
everyone's numbers to the group chat.

> The transfer itself happens outside the app. Neither KakaoPay nor Naver Pay
> exposes a peer-to-peer transfer API to outside developers (merchant payment APIs
> only). So Ledger states precisely who owes whom, and **the recipient confirms**
> to close the line.

### Items and archive

Purchases can be browsed as cards with photos and product links. When the project
ends, the period, total, count, category distribution and purchase list collapse
into a single page — and there's a print stylesheet, so printing it gives you a
paper ledger.

### Sujeungi

A paper-receipt character stands in the corner. Its name is **수증이 (Sujeungi)**.
It explains what the site is on first visit and offers one line of guidance per
screen. It also answers questions about the ledger — but it **never computes
numbers itself**; it reads only from the table the settlement engine already
produced, so the figures on screen and the figures it quotes can never disagree.

### Six languages, many currencies

Korean, English, Japanese, Chinese, Spanish, Vietnamese. Currency is fixed when
the ledger is created and locked afterwards. **No exchange rates.** For foreign
purchases the card issuer has already converted; that charged amount is what's used.

---

## How it's built

### Stack

Next.js 15 (App Router) · React 19 · TypeScript · Supabase (Postgres · Auth · Storage) · Vercel.
No UI library; the CSS is hand-written.

### One layering rule

```
Calculation lives in lib/domain/, storage in lib/db/repo.ts, authorization in lib/access.ts.
Server actions only connect the three and translate errors into human sentences.
```

```
lib/domain/       settlement engine — pure functions, no framework, DB or UI
lib/db/           DB ↔ domain mapping, repository, images
lib/access.ts     invite-token verification and access control — first line of every action
lib/ai/           receipt reading, ledger Q&A, usage metering
lib/i18n.ts       strings for six languages
app/              screens and server actions
supabase/         11 migrations + 30 schema-guard tests
scripts/          settlement simulation, icon and prototype builds
```

### Why the engine knows nothing about the framework

`lib/domain/` doesn't import Next.js or Supabase. Being pure, it produces identical
results in the browser, in Node, and in tests — which is why **the no-signup quick
split and the team ledger run the same engine.** Two copies of the settlement logic
is where trust starts to break.

`npm run simulate` runs a 22-expense simulated project on plain Node, with no
dependencies, and checks 25 invariants:

- shares sum to the amount on every expense (negative amounts included)
- balances sum to zero over any set of expenses
- executing every transfer zeroes everyone; transfer count ≤ members − 1
- total = settled + outstanding, and originals survive mid-project settlements
- a member joining later never changes an earlier settlement
- correcting a settled expense never touches the original

### The accounting rules are carved into the database

The ledger must not break even if the app code does, so the same rules are enforced
again by Postgres triggers (`supabase/migrations/0002_guards.sql`):

- a settled expense can't be edited or deleted (the two photo columns excepted)
- a confirmed settlement's snapshot is immutable
- an expense belongs to at most one settlement
- a correction whose cost structure differs from the original is rejected
- refund amounts must be negative
- **only the recipient** can confirm a transfer
- a settlement with any confirmed transfer can't be cancelled
- currency is locked once a ledger has expenses

`supabase/tests/guards_test.sql` exercises 30 of these against a real Postgres.

### Originals are never edited

A wrong amount isn't corrected in place. **Only the difference is recorded as a new
line.** Refunds work the same way: one expense with a negative amount.

This keeps confirmed settlement figures permanent, and leaves the reason for the
correction visible in the ledger. Corrections inherit the original's cost structure
exactly — refunding four people's purchase across five leaves a remainder. Engine,
UI and database all enforce it.

Every expense stores **the roster as it was at the moment of recording**, so adding
a member later never re-divides past spending.

### Money is always an integer

`715050` is ₩715,050 in KRW and $7,150.50 in USD. Amounts are stored as integers in
the currency's **minor unit**, so the engine doesn't need to know the currency and
no cent leaks in two-decimal currencies. Currency is applied at display time only.

### Access control

The browser never talks to the database.

```
browser → Next.js server action → (service_role) → Postgres
```

Because access can come from an invite link, "logged-in user" isn't enough to express
authorization. Rather than encoding token access in RLS policies, every decision is
made in one place (`lib/access.ts`). The `anon` and `authenticated` roles have no
policies at all — deny by default.

There are two identities, and both reduce to the same `Pass`:

| Identity | How they arrive | Verified by |
| --- | --- | --- |
| Ledger creator | email magic link · Google · Kakao | Supabase Auth session |
| Other members | invite link | HMAC-SHA256 signed cookie |

What that guarantees:

- The cookie **carries its issue time**; after four months it's refused even with a
  valid signature.
- A cookie-only visitor is **re-checked against the roster on every request**. A
  removed member's leftover cookie opens nothing.
- When someone is logged in, **the account always wins over the cookie**.
- Invite links can be issued and revoked **only by the ledger's creator**.
- Cancelling a settlement, correcting, confirming a transfer and viewing a photo all
  verify **that the resource belongs to this ledger**. "May this person enter this
  ledger" and "does this object belong to that ledger" are different questions.
- The post-login return address accepts **paths inside this site only**.
- Raw driver errors never reach the screen — they carry table and constraint names.

### Photos

Two slots: the receipt (evidence for the expense) and the item photo (what was
bought). Both can be added, replaced and removed.

**Nothing is stored automatically.** Having AI read a receipt and keeping that photo
are different acts — receipts carry card digits, store and timestamp, and everything
kept is visible to the whole team. Only photos explicitly kept are stored.

**The bucket is private.** Images are served through `/l/<ledger>/img/<path>`, which
checks access before releasing the file. On upload the declared content type isn't
trusted; the **leading bytes** are inspected to confirm JPG, PNG or WEBP.

### AI

Used in exactly two places: reading receipts and answering questions about the
ledger. Both run **only when a person triggers them**, and both draw on one monthly
per-ledger quota (200 by default), because one key pays for both.

### Ads

AdSense appears **only on the items and archive screens** — never on home, the
ledger, settlements, or expense entry. Those screens state who owes whom; a
third-party ad beside a settlement figure breaks the trust this product is built on.
Auto ads stay off, since they let Google pick the screen.

### Visual language

Only the native web's black, white and blue. No paper textures, no imitation of
warmth. The materiality of an analogue ledger comes from **structure**, not colour:

- **vertical rules** framing the amount column — what makes a ledger read as a
  ledger is these, not horizontal lines
- **slip numbers** on every row, which stay in entry order even when you re-sort
- **double closing rules** marking where a settlement was confirmed
- **rubber stamps** on confirmed positions, each rotated and offset slightly, with an
  SVG noise mask so the ink lands unevenly
- a **print stylesheet** — printing the archive produces a paper ledger

Three typefaces: Nanum Myeongjo for text, Courier Prime for figures (digits align),
and Mrs Saint Delafield — a revival of 19th-century commercial ledger hand — for the
logo. Only the logo's letters were subset, embedded directly as a 1.4KB woff2, so it
renders offline and behind a strict CSP. Hovering the logo rotates a round seal into
place at its lower right.

**There is no marketing copy.** The landing page has none. Labels, numbers and
controls only. If a screen seems to need explaining, the screen is wrong.

---

## Running it

```bash
cp .env.example .env.local     # fill in values
npm install
npm run dev
```

Every value is documented in `.env.example`. At minimum:

| Value | Where |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project settings > API |
| `SUPABASE_SERVICE_ROLE_KEY` | same place. **Never prefix it with `NEXT_PUBLIC_`** |
| `LEDGER_COOKIE_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `ANTHROPIC_API_KEY` | receipt reading and ledger Q&A; without it only those features are off |

Run the SQL in `supabase/migrations/` in numeric order (`supabase db push`, or the
dashboard's SQL Editor), and enable Email under Authentication > Providers.

```bash
npm run simulate     # settlement simulation + 25 invariants, plain Node
npm run typecheck
npm run build
psql -d <db> -f supabase/tests/guards_test.sql   # 30 schema guards
```

Two companion documents. No code imports them, but don't delete them:

- `setup-guide.html` — step-by-step setup for Supabase, Google, Kakao and deployment
- `character-guide.html` — Sujeungi's poses and voice

---

## Decisions

| Topic | Decision | Why |
| --- | --- | --- |
| Editing a settled expense | keep the original, add a correction | confirmed figures never change |
| Refunds | an expense with a negative amount | partial refunds work without touching the engine |
| Roster changes | store the roster on each expense | later members never re-divide past spending |
| Shipping and discounts | folded into the amount | keeps entry down to one screenshot |
| Participation | creator logs in, others use an invite link | universal signup is the biggest adoption barrier |
| AI input | server-side call with a monthly per-ledger cap | ~₩4 per read; bring-your-own-key costs more than the API |
| Transfers | done by people, confirmed by the recipient | no P2P transfer API exists for outside developers |
| Sharing | KakaoTalk share | no review needed, and the user picks the chat room |
| Money storage | integer minor units | no cent leaks in two-decimal currencies |
| Exchange rates | not used | converted figures are amounts nobody paid |
| Visuals | the web's own black, white, blue | no imitation paper |
| Copy | none | if it needs explaining, the screen is wrong |

## Not built yet

- Export (CSV · JSON · Markdown) — a format that can go anywhere comes first
- Notion integration
- Showing discounts and coupons separately (currently folded in)
- Deposits and prepayments
- Repurchase suggestions
