/** @type {import('next').NextConfig} */
export default {
  // 도메인 로직은 .ts 확장자를 명시해서 import 한다.
  // 그래야 Next 없이도 `node --experimental-strip-types scripts/simulate.ts` 가 그대로 돈다.
  typescript: { ignoreBuildErrors: false },
};
