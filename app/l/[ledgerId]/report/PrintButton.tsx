'use client';

/**
 * 인쇄 단추 (§15.3)
 *
 * 하는 일은 window.print() 하나다. 그런데도 파일이 따로인 이유는, 보고서
 * 페이지가 서버 컴포넌트이기 때문이다 — 그 파일에 'use client' 를 붙이면
 * 장부를 읽는 자리가 통째로 브라우저 쪽으로 넘어간다.
 *
 * 인쇄가 곧 PDF 다. 브라우저의 인쇄 대화창에 '대상: PDF 로 저장'이 이미
 * 있어서, 서버에서 PDF 를 만들 이유가 없다(page.tsx 의 머리글 참고).
 */
export default function PrintButton({ label }: { label: string }) {
  return (
    <button className="act small" onClick={() => window.print()}>
      {label}
    </button>
  );
}
