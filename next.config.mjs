/** @type {import('next').NextConfig} */
export default {
  // 도메인 로직은 .ts 확장자를 명시해서 import 한다.
  // 그래야 Next 없이도 `node --experimental-strip-types scripts/simulate.ts` 가 그대로 돈다.
  typescript: { ignoreBuildErrors: false },

  /*
   * 서버 액션이 받는 본문 크기 (§7)
   *
   * 기본값은 1MB 다. 영수증 사진 한 장이 그 선을 넘으면 **우리 코드가
   * 시작되기 전에** 프레임워크가 요청을 끊는다. 그러면 오류를 잡아 수증이에게
   * 넘길 수도 없고, 화면에는 'Application error: a server-side exception'
   * 만 뜬다. 사진을 골랐더니 서비스가 죽은 것처럼 보인다 — 실제로 그랬다.
   *
   * 4MB 로 올린다. 배포 환경의 요청 한도가 4.5MB 라서 그보다 위로는 올려도
   * 소용이 없다. 다만 이 값은 **그물**이지 계획이 아니다. 보내는 쪽에서
   * 900KB 아래로 줄이고(lib/shrink.ts), 그래도 큰 것은 보내기 전에
   * 막는다. 상한에 기대는 설계는 상한이 바뀌는 날 그대로 무너진다.
   */
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
  },

  async headers() {
    return [
      {
        /*
         * 활자 조각은 영원히 캐시해도 된다.
         *
         * 파일 이름에 내용을 줄인 값이 박혀 있어서(app/fonts.css), 활자가
         * 바뀌면 이름이 바뀐다. 같은 이름이면 같은 내용이라는 뜻이므로
         * 다시 물어볼 이유가 없다. next/font 로 심었을 때 Next 가 해 주던
         * 일을, 직접 심었으니 여기서 대신 적어 준다.
         */
        source: '/fonts/:file*.woff2',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};
