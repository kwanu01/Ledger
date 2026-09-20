import wordmark from './teamLedgerWordmark.json';

export default function Wordmark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${wordmark.width} ${wordmark.height}`}
      role="img"
      aria-label="teamLedger"
      focusable="false"
    >
      <path d={wordmark.path} fill="currentColor" />
    </svg>
  );
}
