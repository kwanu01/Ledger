import { STAMP_WORD } from './Logo.tsx';

/** 로고 위에 실제 도장처럼 눌려 찍히는 원형 인장. */
export default function Stamp() {
  return (
    <svg className="seal" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <path id="seal-top" d="M13,50 A37,37 0 0 1 87,50" fill="none" />
        <path id="seal-bottom" d="M12,50 A36,36 0 0 0 88,50" fill="none" />
      </defs>
      <circle cx="50" cy="50" r="46.5" fill="none" stroke="currentColor" strokeWidth="3.2" />
      <circle cx="50" cy="50" r="31" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <text className="seal-rim-text" fill="currentColor">
        <textPath href="#seal-top" startOffset="50%" textAnchor="middle">LEDGER</textPath>
      </text>
      <text className="seal-rim-text seal-foot" fill="currentColor" dy="7.5">
        <textPath href="#seal-bottom" startOffset="50%" textAnchor="middle">{STAMP_WORD.toUpperCase()}</textPath>
      </text>
      <circle cx="7.5" cy="50" r="1.7" fill="currentColor" />
      <circle cx="92.5" cy="50" r="1.7" fill="currentColor" />
      <g fill="currentColor" stroke="currentColor" strokeWidth="7" strokeLinejoin="round">
        <g transform="translate(36.00,61.58) scale(0.03027,-0.03027)">
          <path d="M0 -53Q0 -4 89.0 76.0Q178 156 272 172Q291 196 334.0 253.0Q377 310 404 344Q489 456 540 513Q336 459 123 459Q79 459 79 472Q79 479 91.0 487.0Q103 495 114 495Q168 488 217 488Q378 488 567 544Q748 742 873 742Q925 742 925 718Q925 685 832.0 629.0Q739 573 596 529Q544 467 446.0 335.0Q348 203 325 174Q417 170 484 112Q512 89 538 66Q602 11 674 11Q708 11 748.5 32.5Q789 54 794.5 54.0Q800 54 800 49Q800 31 749.0 9.5Q698 -12 648.0 -12.0Q598 -12 558.0 4.5Q518 21 491.5 45.0Q465 69 440 93Q381 152 312 157Q223 44 155.0 -18.0Q87 -80 34 -80Q0 -80 0 -53ZM41 -53Q76 -53 129.0 0.0Q182 53 258 153Q180 135 101.5 65.5Q23 -4 23 -39Q23 -53 41 -53ZM855 724Q766 724 624 563Q736 601 812.5 644.0Q889 687 889 710Q889 724 855 724Z" />
        </g>
      </g>
    </svg>
  );
}
