import { STAMP_WORD } from './Logo.tsx';

/**
 * 인장 (§20)
 *
 * 옛 장부에 찍히던 둥근 도장이다. 테를 두 겹 두르고 그 사이로 글자가 돌고,
 * 가운데에는 서명 글자가 앉는다. 파비콘에 쓴 그 L과 같은 글자다 — 탭에 있는
 * 표식과 로고에 찍히는 도장이 같아야 둘이 한 서비스의 것으로 읽힌다.
 *
 * 글자를 한 바퀴에 몰아 돌리면 아래쪽 절반이 거꾸로 선다. 실제 인장은 그렇게
 * 새기지 않는다. 위는 왼쪽에서 오른쪽으로, 아래는 오른쪽에서 왼쪽으로 도는
 * 두 개의 호에 나누어 새겨야 둘 다 바로 읽힌다.
 *
 * 글자는 글꼴이 아니라 외곽선으로 박아 두었다. 글꼴이 아직 안 왔거나 없는
 * 곳에서도 도장은 같은 모양이어야 한다. 잉크가 고르게 묻지 않은 것은
 * CSS 쪽에서 마스크로 준다.
 */
export default function Stamp() {
  return (
    <svg className="seal" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        {/* 위 — 왼쪽에서 오른쪽으로 넘어가는 호 */}
        <path id="seal-top" d="M13,50 A37,37 0 0 1 87,50" fill="none" />
        {/* 아래 — 왼쪽에서 오른쪽으로 도는 아래쪽 호.
            글자의 위쪽은 진행 방향의 왼편이라, 아래에서는 이 방향이라야 바로 선다. */}
        <path id="seal-bottom" d="M12,50 A36,36 0 0 0 88,50" fill="none" />
      </defs>

      {/* 바깥 테 — 눌린 자국이라 굵다 */}
      <circle cx="50" cy="50" r="46.5" fill="none" stroke="currentColor" strokeWidth="3.2" />
      {/* 안쪽 테 — 글자가 도는 길의 안쪽 벽 */}
      <circle cx="50" cy="50" r="31" fill="none" stroke="currentColor" strokeWidth="1.1" />

      <text className="seal-rim-text" fill="currentColor">
        <textPath href="#seal-top" startOffset="50%" textAnchor="middle">
          LEDGER
        </textPath>
      </text>
      <text className="seal-rim-text seal-foot" fill="currentColor" dy="7.5">
        <textPath href="#seal-bottom" startOffset="50%" textAnchor="middle">
          {STAMP_WORD.toUpperCase()}
        </textPath>
      </text>

      {/* 양옆의 점 — 위아래 글자를 갈라 주는 자리 */}
      <circle cx="7.5" cy="50" r="1.7" fill="currentColor" />
      <circle cx="92.5" cy="50" r="1.7" fill="currentColor" />

      {/* 가운데 — 서명 한 글자 */}
      <g fill="currentColor" stroke="currentColor" strokeWidth="7" strokeLinejoin="round">
        <g transform="translate(36.00,61.58) scale(0.03027,-0.03027)"><path d="M0 -53Q0 -4 89.0 76.0Q178 156 272 172Q291 196 334.0 253.0Q377 310 404 344Q489 456 540 513Q336 459 123 459Q79 459 79 472Q79 479 91.0 487.0Q103 495 114 495Q168 488 217 488Q378 488 567 544Q748 742 873 742Q925 742 925 718Q925 685 832.0 629.0Q739 573 596 529Q544 467 446.0 335.0Q348 203 325 174Q417 170 484 112Q512 89 538 66Q602 11 674 11Q708 11 748.5 32.5Q789 54 794.5 54.0Q800 54 800 49Q800 31 749.0 9.5Q698 -12 648.0 -12.0Q598 -12 558.0 4.5Q518 21 491.5 45.0Q465 69 440 93Q381 152 312 157Q223 44 155.0 -18.0Q87 -80 34 -80Q0 -80 0 -53ZM41 -53Q76 -53 129.0 0.0Q182 53 258 153Q180 135 101.5 65.5Q23 -4 23 -39Q23 -53 41 -53ZM855 724Q766 724 624 563Q736 601 812.5 644.0Q889 687 889 710Q889 724 855 724Z"/></g>
      </g>
    </svg>
  );
}
