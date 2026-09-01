/**
 * 사진 주소 (§7)
 *
 * 저장소에 적힌 경로를 화면이 쓸 주소로 바꾼다. 저장소를 직접 가리키지 않는
 * 이유는 그 버킷이 닫혀 있기 때문이다. 사진은 우리 자리를 거쳐 나가고, 그
 * 자리에서 이 장부의 사람인지 판정한다(app/l/[ledgerId]/img).
 */
export function imageSrc(ledgerId: string, path: string): string {
  return `/l/${ledgerId}/img/${path
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}
