/**
 * ads.txt (§27 수익화)
 *
 * 구글은 이 파일을 보고 "이 사이트의 광고 자리를 팔 권한이 누구에게 있는지"를
 * 확인한다. 없으면 광고가 붙어도 수익이 제한되거나 아예 안 나온다.
 *
 * 정적 파일로 두지 않고 여기서 만드는 이유는 하나다. 게시자 번호가
 * 환경변수에 이미 있는데 같은 번호를 public/ads.txt 에 한 번 더 적어 두면,
 * 둘 중 하나만 고쳤을 때 조용히 어긋난다. 번호가 한 군데에만 있어야 한다.
 *
 * 애드센스 승인 전(환경변수가 비어 있을 때)에는 404를 돌려준다.
 * 빈 ads.txt 는 "아무에게도 권한이 없다"는 뜻이라 없느니만 못하다.
 */

const CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;

/** 구글 애드센스의 고정값. 모든 게시자가 같은 값을 쓴다. */
const GOOGLE_TAG_ID = 'f08c47fec0942fa0';

export function GET() {
  if (!CLIENT) return new Response('Not found', { status: 404 });

  // client 는 'ca-pub-0000000000000000' 모양으로 들어온다. ads.txt 에는
  // 'pub-…' 부터 적는다.
  const publisher = CLIENT.replace(/^ca-/, '');
  const body = `google.com, ${publisher}, DIRECT, ${GOOGLE_TAG_ID}\n`;

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  });
}
