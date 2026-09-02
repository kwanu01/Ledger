'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Lightbox from './Lightbox.tsx';
import { attachImage, removeImage } from './actions/images.ts';
import { imageSrc } from '../lib/img.ts';
import { shrinkImage } from '../lib/shrink.ts';
import { translator } from '../lib/i18n.ts';
import type { Locale } from '../lib/domain/money.ts';

/**
 * 사진 한 자리 (§7)
 *
 * 붙이고, 바꾸고, 뗀다. 셋 다 이 한 칸에서 한다.
 *
 * 사진이 있으면 점으로 찍힌 작은 그림이 보이고 누르면 원본이 열린다(Lightbox).
 * 없으면 빈 자리가 그대로 **누를 수 있는 자리**가 된다. 빈 네모 아래에 작은
 * 글씨로 '사진 올리기'가 따로 있으면, 그 글씨를 찾아야 올릴 수 있다. 비어
 * 있는 자리는 그 자리를 누르는 것이 당연하다. 있을 때와 없을 때 자리가 크게
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
  const file = useRef<HTMLInputElement>(null);

  function pick(f: File | null) {
    if (!f) return;
    setError(null);
    start(async () => {
      /*
       * 올리기 전에 브라우저에서 한 번 그린다. 세 가지가 한꺼번에 풀린다.
       *
       *   형식 — 아이폰 사진은 HEIC다. 저장소는 JPG·PNG·WEBP만 받는다.
       *   크기 — 요즘 폰 사진은 5MB 제한을 그냥 넘는다.
       *   시간 — 4MB를 그대로 올리면 LTE에서 몇 초씩 걸린다.
       *
       * 예전에는 원본을 그대로 보내서, 폰에서 고른 사진이 자주 거절당했다.
       */
      const small = await shrinkImage(f);

      const fd = new FormData();
      fd.set('ledgerId', ledgerId);
      fd.set('expenseId', expenseId);
      fd.set('kind', kind);
      fd.set('image', small);

      const r = await attachImage(fd);
      if (!r.ok) setError(r.message);
      else router.refresh();
    });
  }

  function drop() {
    /*
     * 되묻는 일은 확인창에 맡긴다.
     *
     * 전에는 단추가 빨갛게 겨눠졌다가 한 번 더 눌러야 지워졌다. 같은 자리가
     * 두 가지 일을 하니, 무엇이 겨눠져 있는지 색으로만 알 수 있었다.
     * 확인창은 무엇을 지우는지 글로 말하고, 취소가 같은 자리에 있다.
     */
    if (!window.confirm(T('photoDropWarn'))) return;
    start(async () => {
      const r = await removeImage({ ledgerId, expenseId, kind });
      if (!r.ok) setError(r.message);
      else router.refresh();
    });
  }

  return (
    <div className={`imgfield${wide ? ' wide' : ''}`}>
      {/* 사진과 그 옆의 단추는 한 줄이다. 오류 문구는 그 아래 제 줄에 온다. */}
      <div className="imgfield-row">
      {path ? (
        <Lightbox src={imageSrc(ledgerId, path)} alt={alt} caption={caption} wide={wide} />
      ) : (
        // 빈 자리 자체가 단추다. 누르면 바로 사진을 고른다.
        <button
          type="button"
          className="empty-plate"
          disabled={pending}
          onClick={() => file.current?.click()}
        >
          <span className="plus" aria-hidden="true">+</span>
          <span>
            {pending
              ? T('working')
              : kind === 'receipt'
                ? T('addReceiptHere')
                : T('addItemPhotoHere')}
          </span>
        </button>
      )}

      {/*
        사진 옆의 두 가지 — 바꾸기와 지우기.

        글자로 두었더니 사진 밑에 파란 밑줄 두 줄이 왼쪽으로 붙어, 사진보다
        먼저 읽혔다. 사진이 주인공인 자리에서 그 밑의 곁다리가 더 눈에 띄면
        차례가 뒤집힌다. 그래서 **글자 크기만 한 그림 두 개**로 줄이고
        사진 오른쪽에 세로로 세운다 — 사진 아래에 두면 세로로 긴 영수증과
        가로로 긴 품목 사진의 단추 높이가 서로 어긋난다. 옆에 세우면
        어느 사진이든 단추가 같은 자리에서 시작한다.

        무엇인지는 눌러 보기 전에 알아야 하므로 같은 말을 title 과
        aria-label 에 그대로 남긴다.
      */}
      <div className="imgfield-do">
        {path && (
          <button
            type="button"
            className="iconbtn"
            disabled={pending}
            onClick={() => file.current?.click()}
            title={pending ? T('working') : T('replacePhoto')}
            aria-label={pending ? T('working') : T('replacePhoto')}
          >
            {/* 되돌아오는 화살표 한 바퀴 — 같은 자리에 다른 것을 넣는다는 뜻 */}
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M13 8a5 5 0 1 1-1.6-3.7" />
              <path d="M13 2.2V5h-2.8" />
            </svg>
          </button>
        )}
        {path && (
          <button
            type="button"
            className="iconbtn"
            disabled={pending}
            onClick={drop}
            title={T('deletePhoto')}
            aria-label={T('deletePhoto')}
          >
            {/* 휴지통. 누르면 무엇을 지우는지 적힌 확인창이 먼저 뜬다. */}
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.5 4.5h9" />
              <path d="M6.4 4.5V3.2h3.2v1.3" />
              <path d="M4.6 4.5l.6 8.3h5.6l.6-8.3" />
            </svg>
          </button>
        )}
      </div>
      </div>

      {error && <p className="faint" style={{ color: 'var(--debit)', fontSize: 12.5 }}>{error}</p>}

      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          pick(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
    </div>
  );
}
