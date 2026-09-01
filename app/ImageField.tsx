'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Lightbox from './Lightbox.tsx';
import { attachImage, removeImage } from './actions/images.ts';
import { imageSrc } from '../lib/img.ts';
import { translator } from '../lib/i18n.ts';
import type { Locale } from '../lib/domain/money.ts';

/**
 * 사진 한 자리 (§7)
 *
 * 붙이고, 바꾸고, 뗀다. 셋 다 이 한 칸에서 한다.
 *
 * 사진이 있으면 점으로 찍힌 작은 그림이 보이고 누르면 원본이 열린다(Lightbox).
 * 없으면 빈 자리와 '사진 올리기'만 보인다. 있을 때와 없을 때 자리가 크게
 * 달라지면 줄이 들썩이므로, 빈 자리도 같은 크기로 둔다.
 *
 * 지우기는 되돌릴 수 없어서 한 번 더 묻는다. 다만 창을 띄우지는 않는다 —
 * 단추가 '정말 지울까요'로 바뀌고, 다른 데를 누르면 원래대로 돌아온다.
 */
export default function ImageField({
  ledgerId,
  expenseId,
  kind,
  path,
  alt,
  caption,
  lang,
  wide = false,
}: {
  ledgerId: string;
  expenseId: string;
  kind: 'receipt' | 'item';
  /** 지금 붙어 있는 사진의 저장소 경로. 없으면 빈 자리. */
  path?: string;
  alt: string;
  caption?: string;
  lang: Locale;
  /** 품목 카드처럼 칸을 다 쓰는 자리 */
  wide?: boolean;
}) {
  const T = translator(lang);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  function pick(f: File | null) {
    if (!f) return;
    setError(null);
    const fd = new FormData();
    fd.set('ledgerId', ledgerId);
    fd.set('expenseId', expenseId);
    fd.set('kind', kind);
    fd.set('image', f);
    start(async () => {
      const r = await attachImage(fd);
      if (!r.ok) setError(r.message);
      else router.refresh();
    });
  }

  function drop() {
    setAsking(false);
    start(async () => {
      const r = await removeImage({ ledgerId, expenseId, kind });
      if (!r.ok) setError(r.message);
      else router.refresh();
    });
  }

  return (
    <div className={`imgfield${wide ? ' wide' : ''}`}>
      {path ? (
        <Lightbox src={imageSrc(ledgerId, path)} alt={alt} caption={caption} wide={wide} />
      ) : (
        <div className="plate empty-plate">{T(kind === 'receipt' ? 'noReceipt' : 'noPhoto')}</div>
      )}

      <div className="imgfield-do">
        <button className="plain" disabled={pending} onClick={() => file.current?.click()}>
          {pending ? T('working') : path ? T('replacePhoto') : T('addPhoto')}
        </button>
        {path &&
          (asking ? (
            <button className="plain danger" disabled={pending} onClick={drop}>
              {T('reallyDelete')}
            </button>
          ) : (
            <button className="plain" disabled={pending} onClick={() => setAsking(true)}>
              {T('deletePhoto')}
            </button>
          ))}
      </div>

      {error && <p className="faint" style={{ color: 'var(--debit)', fontSize: 12.5 }}>{error}</p>}

      <input
        ref={file}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          pick(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
    </div>
  );
}
