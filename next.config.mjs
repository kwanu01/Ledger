/** @type {import('next').NextConfig} */
export default {
  // 도메인 로직은 .ts 확장자를 명시해서 import 한다.
  // 그래야 Next 없이도 `node --experimental-strip-types scripts/simulate.ts` 가 그대로 돈다.
  typescript: { ignoreBuildErrors: false },

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
