'use client';

import { useId, useState } from 'react';
import { sharesOfLines } from '../../../../lib/domain/settlement.ts';
import { translator } from '../../../../lib/i18n.ts';
import { formatMoney, formatNumber, parseMoney, type CurrencyCode, type Locale } from '../../../../lib/domain/money.ts';
import type { ItemLine, Member } from '../../../../lib/domain/types.ts';

/**
 * 항목별 청구 — 줄 고르는 자리 (§10.4)
 *
 * 같이 배달을 시키고 한 사람이 결제했을 때 쓰는 자리다. 영수증 한 장이
 * 여러 줄이 되고, 줄마다 부담자가 다르다.
 *
 * 세 가지를 지키려고 이 모양이 됐다.
 *
 * **부담자를 고르는 일이 첫째다.** 이름과 금액은 대개 AI가 읽어 온다.
 * 사람이 실제로 하는 일은 "이건 누가 시켰지"를 줄마다 고르는 것 하나뿐이다.
 * 그래서 이름·금액 칸보다 팀원 단추가 크고, 손가락으로 바로 누를 수 있다.
 * 고르지 않은 줄은 테두리로 표시해 둔다 — 스무 줄을 훑다 하나를 빠뜨리는
 * 것이 여기서 제일 흔한 실수다.
 *
 * **합계는 늘 보인다.** 줄의 합과 결제 금액이 다르면 지분의 합이 어긋난다.
 * 저장할 때 막는 것으로는 늦다. 어긋나는 순간 그 자리에서 얼마가 어긋나는지
 * 보여 주고, 한 번 눌러 맞출 수 있게 한다. (§23.3 계산은 숨기지 않는다)
 *
 * **배달비는 특별한 종류가 아니다.** 팀원 전원이 골라진 줄일 뿐이다.
 * 그래야 "배달비도 두 명만" 같은 경우가 예외 없이 그냥 된다.
 *
 * ── 고르는 길이 둘이다 (§10.4)
 *
 * **목록**은 줄을 전부 늘어놓는다. 이름과 금액을 고치고, 줄을 넣고 빼는 자리다.
 * 읽어 온 것이 맞는지 훑어보기에 좋고, 줄이 서넛일 때는 이것으로 충분하다.
 *
 * **하나씩**은 항목 하나를 앞에 두고 "이건 누가 시켰나"만 묻는다. 다음 항목,
 * 다음 항목. 목록이 열두 줄이 되면 이쪽이 낫다 — 늘어놓으면 훑는 눈이 줄
 * 사이를 오가며 자리를 잃고, 실제로 빠뜨리는 것은 언제나 가운데 어디쯤이다.
 * 한 번에 하나만 보이면 빠뜨릴 자리가 없다.
 *
 * 위에는 항목 수만큼의 점을 둔다. 고른 것과 안 고른 것이 한눈에 보이고,
 * 눌러서 바로 그 항목으로 건너뛴다. 진행 막대가 아니라 **지도**다 —
 * 얼마나 왔는지보다 어디가 비었는지가 더 알고 싶은 것이기 때문이다.
 *
 * 두 길은 같은 데이터를 본다. 어느 쪽으로 고르든 결과는 하나다.
 */

export type Draft = {
  /** React 목록의 열쇠. 줄을 지우거나 넣어도 입력 칸이 튀지 않게 한다. */
  key: string;
  name: string;
  /** 사람이 적는 대로 둔다. 저장할 때만 최소 단위 정수로 되돌린다. */
  amount: string;
  memberIds: string[];
};

let seq = 0;
export function newDraft(over: Partial<Draft> = {}): Draft {
  seq += 1;
  return { key: `l${seq}`, name: '', amount: '', memberIds: [], ...over };
}

/** 화면의 줄들을 도메인의 줄들로. 저장 직전과 미리보기에 같은 것을 쓴다. */
export function toItemLines(drafts: Draft[], currency: CurrencyCode): ItemLine[] {
  return drafts.map((d) => ({
    name: d.name.trim(),
    amount: parseMoney(d.amount, currency),
    memberIds: d.memberIds,
  }));
}

export default function ItemLines({
  drafts,
  onDrafts,
  members,
  roster,
  currency,
  lang,
  total,
  onTotal,
  onRead,
  reading,
}: {
  drafts: Draft[];
  onDrafts: (next: (prev: Draft[]) => Draft[]) => void;
  members: Member[];
  roster: string[];
  currency: CurrencyCode;
  lang: Locale;
  /** 지금 폼에 적힌 결제 금액 */
  total: number;
  /** 결제 금액을 줄의 합으로 맞춘다 */
  onTotal: (amount: number) => void;
  /** 사진에서 읽어 오는 자리. 기입할 때만 있다 — 고칠 때는 사진이 손에 없다. */
  onRead?: () => void;
  reading?: boolean;
}) {
  const T = translator(lang);
  const id = useId();
  const name = (mid: string) => members.find((m) => m.id === mid)?.name ?? mid;

  /* 고르는 길. 줄이 많아지면 하나씩이 낫다 — 위 주석 참고. */
  const [by, setBy] = useState<'list' | 'one'>('list');
  /** 하나씩 훑을 때 지금 보고 있는 항목의 자리. 줄이 줄어들면 따라 당겨진다. */
  const [at, setAt] = useState(0);
  const here = Math.min(at, Math.max(0, drafts.length - 1));

  const lines = toItemLines(drafts, currency);
  const sum = lines.reduce((a, l) => a + l.amount, 0);
  const gap = sum - total;
  const shares = sharesOfLines(lines, roster);
  /** 아직 부담자를 고르지 않은 항목들의 자리. 훑기가 끝났는지 여기서 안다. */
  const empty = drafts.map((d, i) => (d.memberIds.length === 0 ? i : -1)).filter((i) => i >= 0);

  function patch(key: string, over: Partial<Draft>) {
    onDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...over } : d)));
  }
  function toggle(key: string, mid: string) {
    onDrafts((prev) =>
      prev.map((d) =>
        d.key === key
          ? {
              ...d,
              memberIds: d.memberIds.includes(mid)
                ? d.memberIds.filter((x) => x !== mid)
                : // 명단 순서를 지킨다. 나머지 1원이 매번 같은 사람에게 가야 한다.
                  roster.filter((r) => r === mid || d.memberIds.includes(r)),
            }
          : d,
      ),
    );
  }
  /** '모두' 단추 — 다 골라져 있으면 다 푼다. 배달비 항목에서 제일 자주 눌린다. */
  function all(key: string) {
    onDrafts((prev) =>
      prev.map((d) =>
        d.key === key ? { ...d, memberIds: d.memberIds.length === roster.length ? [] : [...roster] } : d,
      ),
    );
  }

  return (
    <div className="pick-sub lines">
      <p className="aside" style={{ margin: '0 0 12px' }}>
        {T('deliveryHint')}
      </p>

      <p className="lines-read">
        {onRead && (
          <button type="button" className="act small" onClick={onRead} disabled={reading}>
            {reading ? T('readingLines') : T('readLines')}
          </button>
        )}
        {/* 고르는 길을 바꾼다. 같은 데이터를 다른 쪽에서 볼 뿐이다. */}
        <span className="byswitch" role="group">
          {(['list', 'one'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`chip${by === mode ? ' on' : ''}`}
              aria-pressed={by === mode}
              onClick={() => setBy(mode)}
            >
              {T(mode === 'list' ? 'byList' : 'byOne')}
            </button>
          ))}
        </span>
      </p>

      {by === 'one' && drafts.length > 0 && (
        <div className="sweep">
          {/*
            지도.

            진행 막대가 아니다. 얼마나 왔는지보다 **어디가 비었는지**가 더
            알고 싶은 것이라서, 항목마다 점 하나를 두고 고른 것만 채운다.
            눌러서 바로 건너뛴다.
          */}
          <div className="sweep-dots" role="group" aria-label={T('whoOrdered')}>
            {drafts.map((d, i) => (
              <button
                key={d.key}
                type="button"
                className={`dot${d.memberIds.length > 0 ? ' filled' : ''}${i === here ? ' now' : ''}`}
                aria-label={T('sweepJump', { n: i + 1 })}
                aria-current={i === here ? 'true' : undefined}
                onClick={() => setAt(i)}
              />
            ))}
          </div>

          <div className="sweep-card">
            {/*
              이름과 금액은 여기서도 고칠 수 있다. 항목 하나를 크게 놓고
              보는 자리라서, 잘못 읽힌 금액이 눈에 띄는 것도 바로 여기다.
              보이는데 못 고치면 목록으로 돌아갔다 와야 한다.
            */}
            <input
              type="text"
              className="sweep-name"
              value={drafts[here].name}
              placeholder={T('newLine')}
              aria-label={T('lineName')}
              onChange={(e) => patch(drafts[here].key, { name: e.target.value })}
            />
            <input
              type="text"
              inputMode="decimal"
              className="num sweep-amt"
              value={drafts[here].amount}
              placeholder="0"
              aria-label={T('lineAmount')}
              onChange={(e) => patch(drafts[here].key, { amount: e.target.value })}
            />

            <p className="sweep-ask">{T('whoOrdered')}</p>
            <div className="chips sweep-chips">
              {roster.map((mid) => (
                <button
                  key={mid}
                  type="button"
                  className={`chip${drafts[here].memberIds.includes(mid) ? ' on' : ''}`}
                  aria-pressed={drafts[here].memberIds.includes(mid)}
                  onClick={() => toggle(drafts[here].key, mid)}
                >
                  {name(mid)}
                </button>
              ))}
              <button
                type="button"
                className={`chip every${drafts[here].memberIds.length === roster.length ? ' on' : ''}`}
                aria-pressed={drafts[here].memberIds.length === roster.length}
                onClick={() => all(drafts[here].key)}
              >
                {T('everyone')}
              </button>
            </div>
          </div>

          <div className="sweep-nav">
            <button
              type="button"
              className="plain"
              disabled={here === 0}
              onClick={() => setAt(here - 1)}
            >
              ← {T('sweepPrev')}
            </button>
            <span className="muted num sweep-at">
              {T('sweepAt', { i: here + 1, n: drafts.length })}
            </span>
            <button
              type="button"
              className="plain"
              disabled={here >= drafts.length - 1}
              onClick={() => setAt(here + 1)}
            >
              {T('sweepNext')} →
            </button>
          </div>

          {/*
            남은 것을 말한다. 훑기의 끝은 마지막 항목에 닿는 것이 아니라
            **빈 항목이 없어지는 것**이다. 둘은 다르고, 사람이 알고 싶은 것은 뒤쪽이다.
          */}
          <p className={`sweep-left${empty.length === 0 ? ' done' : ''}`}>
            {empty.length === 0 ? (
              T('sweepDone')
            ) : (
              /*
                남은 개수가 곧 단추다.

                처음에는 개수를 적어 두고 그 옆에 '거기로' 라는 단추를 뒀다.
                무엇을 가리키는지 말하지 않는 말이라 어색했다 — 거기가 어디인지는
                바로 왼쪽에 적혀 있는데 그것을 다시 가리키느라 낱말을 하나 더
                쓴 셈이다. 셀 것과 갈 곳이 같은 것이면 하나로 둔다.
              */
              <button
                type="button"
                /* 붉게 하지 않는다. 이 판에서 붉은 것은 합계가 어긋났다는
                   말 하나여야 한다 — 경고가 둘이면 둘 다 안 읽힌다. */
                className="plain"
                onClick={() => setAt(empty.find((i) => i > here) ?? empty[0])}
              >
                {T('sweepLeft', { n: empty.length })}
              </button>
            )}
          </p>
        </div>
      )}

      <ul className="lines-list" hidden={by !== 'list'}>
        {drafts.map((d, i) => {
          const picked = d.memberIds.length;
          /* 빈 줄은 아직 잊은 것이 아니라 이제 적을 줄이다. 표시하지 않는다. */
          const written = d.name.trim() !== '' || d.amount.trim() !== '';
          return (
            <li key={d.key} className={`lineitem${picked === 0 && written ? ' unassigned' : ''}`}>
              <div className="linehead">
                <input
                  type="text"
                  className="line-name"
                  value={d.name}
                  placeholder={T('newLine')}
                  aria-label={`${T('lineName')} ${i + 1}`}
                  onChange={(e) => patch(d.key, { name: e.target.value })}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  className="num line-amount"
                  value={d.amount}
                  placeholder="0"
                  aria-label={`${T('lineAmount')} ${i + 1}`}
                  onChange={(e) => patch(d.key, { amount: e.target.value })}
                />
                <button
                  type="button"
                  className="line-drop"
                  aria-label={T('removeLine')}
                  title={T('removeLine')}
                  onClick={() => onDrafts((prev) => prev.filter((x) => x.key !== d.key))}
                >
                  ×
                </button>
              </div>

              <div className="chips" role="group" aria-label={`${T('lineWho')} — ${d.name || i + 1}`}>
                {roster.map((mid) => (
                  <button
                    key={mid}
                    type="button"
                    className={`chip${d.memberIds.includes(mid) ? ' on' : ''}`}
                    aria-pressed={d.memberIds.includes(mid)}
                    onClick={() => toggle(d.key, mid)}
                  >
                    {name(mid)}
                  </button>
                ))}
                <button
                  type="button"
                  className={`chip every${picked === roster.length ? ' on' : ''}`}
                  aria-pressed={picked === roster.length}
                  onClick={() => all(d.key)}
                >
                  {T('everyone')}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {/* 줄을 새로 만드는 것은 줄 기준에서만. 사람 기준은 고르는 자리지 적는 자리가 아니다. */}
      {by === 'list' && (
        <p className="lines-add">
          <button type="button" className="plain" onClick={() => onDrafts((prev) => [...prev, newDraft()])}>
            + {T('addLine')}
          </button>
        </p>
      )}

      {/* 합계는 늘 보인다. 어긋나면 얼마나 어긋나는지까지. */}
      <div className={`linefoot${gap !== 0 ? ' off' : ''}`} id={`${id}-sum`}>
        <span className="lab">{T('lineSum')}</span>
        <strong className="num">{formatMoney(sum, currency, lang)}</strong>
        {gap === 0 ? (
          <span className="muted">{T('sumMatches')}</span>
        ) : (
          <>
            <span className="debit">
              {T('sumOff', { gap: `${gap > 0 ? '+' : '−'}${formatNumber(Math.abs(gap), currency, lang)}` })}
            </span>
            <button type="button" className="plain" onClick={() => onTotal(sum)}>
              {T('useSum')}
            </button>
          </>
        )}
      </div>

      {/* 저장하기 전에 각자 얼마를 내는지 보여 준다. 저장한 뒤에 놀랄 일이 없어야 한다. */}
      {shares.length > 0 && (
        <div className="lines-each">
          <span className="lab">{T('eachOwes')}</span>
          {shares.map((s) => (
            <span key={s.memberId} className="each">
              {name(s.memberId)} <b className="num">{formatMoney(s.amount, currency, lang)}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
