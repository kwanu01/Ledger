'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createInvite,
  deleteTeam,
  leaveTeam,
  handOverOwnership,
  renameMember,
  renameTeam,
  revokeInvite,
  setMemberActive,
  type InviteRow,
  type TeamMember,
} from '../../../actions/teams.ts';
import { translator } from '../../../../lib/i18n.ts';
import { membersCount } from '../../../../lib/labels.ts';
import type { Locale } from '../../../../lib/domain/money.ts';
import { useHelper } from '../../../helper/HelperContext.tsx';

/**
 * 팀 (§21.9)
 *
 * 이름은 언제든 고칠 수 있다. 지출에는 사람의 id가 박혀 있어서, 이름을 바꿔도
 * 지난 계산은 한 푼도 움직이지 않는다.
 *
 * 나간 팀원은 지우지 않는다. 지우면 그 사람이 부담하던 지난 지출의 몫이 갈 곳을
 * 잃는다. 대신 명단에서 내려 두고, 앞으로 기입하는 지출에서만 빠진다.
 *
 * 자기 줄만 고칠 수 있다. 계좌는 돈이 실제로 도착하는 자리라 남이 대신 적으면
 * 안 되고, 이름도 본인 것이다. 명단 정리(나감·돌아옴)만 장부를 만든 사람에게
 * 열어 둔다. 연락이 끊긴 사람을 아무도 못 내리면 명단이 굳어 버린다.
 */

export default function TeamPanel({
  ledgerId,
  teamName,
  members,
  invites,
  origin,
  lang,
  owner,
  fund,
}: {
  ledgerId: string;
  teamName: string;
  members: TeamMember[];
  invites: InviteRow[];
  origin: string;
  lang: Locale;
  /** 이 장부를 만든 사람인가. 명단 정리 버튼만 여기에 달린다. */
  owner: boolean;
  /** 돈의 출처 (§12). 부르는 이름이 여기서 갈린다 — 팀원 / 회원. */
  fund?: string;
}) {
  const router = useRouter();
  // 경고는 도우미 말풍선 한 자리로 모인다(app/helper).
  const { say } = useHelper();
  const T = translator(lang);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  /*
   * 지금 무엇을 하는 중인가 (§21.16)
   *
   * `busy` 하나로는 "무언가 돌고 있다"까지만 알 수 있다. 그러면 어느 단추가
   * 일하는 중인지 그 단추 위에 적을 수가 없어서, 화면 전체가 잿빛이 될 뿐
   * 기다리라는 말은 아무 데도 없다. 초대 링크를 만들 때가 그랬다.
   */
  const [doing, setDoing] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [editTeam, setEditTeam] = useState(false);
  /** 되묻는 중인 팀원과, 무엇을 되묻는지. 되돌리기 어려운 일이라 한 번 더 묻는다. */
  const [ask, setAsk] = useState<{ id: string; kind: 'hand' | 'leave' } | null>(null);
  const [newTeam, setNewTeam] = useState('');
  const [armed, setArmed] = useState(false);
  /** 수증이가 이 단추 옆으로 걸어오게 하려면 그 자리를 알려 줘야 한다. */
  const dropBtn = useRef<HTMLButtonElement>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current); }, []);
  const [leaving, setLeaving] = useState(false);

  async function run(fn: () => Promise<{ ok: boolean; message?: string }>, tag?: string) {
    setBusy(true);
    if (tag) setDoing(tag);
    const r = await fn();
    setBusy(false);
    setDoing(null);
    if (!r.ok) return say(r.message ?? '알 수 없는 오류가 발생했습니다.');
    router.refresh();
    return r;
  }

  async function saveName(memberId: string) {
    const name = draft.trim();
    if (!name) return setEditing(null);
    await run(() => renameMember({ ledgerId, memberId, name }));
    setEditing(null);
  }



  async function copy(link: string, token: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // 복사가 막혀 있으면 주소가 화면에 그대로 있으니 손으로 골라 복사하면 된다.
    }
  }

  const active = members.filter((m) => m.active);

  return (
    <>

      <section>
        <div className="caption">{membersCount(lang, fund as never, active.length)}</div>

        <div className="scroll" style={{ marginTop: 14 }}>
          <table className="book members">
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className={m.active ? undefined : 'left'}>
                  <td className="nameCell">
                    {editing === m.id ? (
                      <input
                        type="text"
                        value={draft}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => saveName(m.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveName(m.id);
                          if (e.key === 'Escape') setEditing(null);
                        }}
                      />
                    ) : m.isMe || owner ? (
                      <button
                        className="subject"
                        onClick={() => {
                          setEditing(m.id);
                          setDraft(m.name);
                        }}
                      >
                        {m.name}
                      </button>
                    ) : (
                      // 남의 이름은 읽기만 한다. 고치는 건 그 사람 몫이다.
                      <span>{m.name}</span>
                    )}
                  </td>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                    {/* 소유자는 이름 옆에 적어 둔다. 누가 초대 링크를 만들고
                        장부를 지울 수 있는지는 팀원 모두가 알아야 하는 사실이다. */}
                    {m.isOwner ? (
                      <span className="tag">{T('ownerTag')}</span>
                    ) : m.isMe ? (
                      T('me')
                    ) : m.hasAccount ? (
                      ''
                    ) : (
                      T('notLinked')
                    )}
                  </td>
                  <td className="muted">{m.active ? '' : T('gone')}</td>
                  {/*
                    할 수 있는 일들.

                    **되묻는 말은 이 칸에 넣지 않는다.** 넣어 봤더니 긴 문장이
                    표를 벌려서, 이름이 'J/o/s/e/p/h' 처럼 한 글자씩 세로로
                    쪼개졌다. 표의 칸은 낱말이 들어가는 자리지 문장이 들어가는
                    자리가 아니다.

                    그래서 말은 수증이가 한다. 누른 단추 옆으로 걸어와서 붉은
                    글씨로 한 줄. 이 칸에는 단추만 남는다.
                  */}
                  <td>
                    <span className="acts">
                      {ask?.id === m.id ? (
                        <>
                          <button
                            className="act small sure"
                            disabled={busy}
                            onClick={() => {
                              const go = ask.kind;
                              setAsk(null);
                              run(() =>
                                go === 'hand'
                                  ? handOverOwnership({ ledgerId, memberId: m.id })
                                  : setMemberActive({
                                      ledgerId,
                                      memberId: m.id,
                                      active: !m.active,
                                    }),
                              );
                            }}
                          >
                            {ask.kind === 'hand' ? T('handOverDo') : T('goneDo')}
                          </button>
                          <button className="plain" onClick={() => setAsk(null)}>
                            {T('close')}
                          </button>
                        </>
                      ) : (
                        <>
                          {/* 소유권 넘기기. 지금 소유자만, 계정 있는 활성
                              팀원에게만. 초대 링크로만 들어온 사람에게 넘기면
                              그 장부에 다시 들어올 수 있는 소유자가 없어진다. */}
                          {owner && !m.isOwner && m.active && m.hasAccount && (
                            <button
                              className="plain"
                              disabled={busy}
                              onClick={(e) => {
                                setAsk({ id: m.id, kind: 'hand' });
                                say(T('handOverWarn', { who: m.name }), 'warn', e.currentTarget);
                              }}
                            >
                              {T('handOver')}
                            </button>
                          )}
                          {(m.isMe || owner) && (
                            <button
                              className="plain"
                              disabled={busy}
                              onClick={(e) => {
                                // 다시 넣는 것은 되묻지 않는다. 잃는 것이 없다.
                                if (!m.active) {
                                  return run(() =>
                                    setMemberActive({ ledgerId, memberId: m.id, active: true }),
                                  );
                                }
                                setAsk({ id: m.id, kind: 'leave' });
                                say(T('goneWarn', { who: m.name }), 'warn', e.currentTarget);
                              }}
                            >
                              {m.active ? T('markGone') : T('bringBack')}
                            </button>
                          )}
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="aside" style={{ marginTop: 16, maxWidth: 560 }}>
          {T('membersJoinByLink')}
          <br />
          {T('renameHint')}
        </p>

      </section>

      {/*
        초대 링크는 이 장부의 문을 여는 열쇠다. 만드는 것도 회수하는 것도
        장부를 만든 사람만 하므로, 다른 팀원에게는 아예 보이지 않게 둔다.
        보이는데 눌리지 않는 단추만큼 헷갈리는 것이 없다.
      */}
      {owner && (
      <section>
        <div className="caption">{T('inviteLinks')}</div>

        {invites.length === 0 ? (
          <p className="muted" style={{ marginTop: 16 }}>
            {T('none')}
          </p>
        ) : (
          <div className="scroll" style={{ marginTop: 14 }}>
            <table className="book invites">
              <tbody>
                {invites.map((i) => {
                  const link = `${origin}/join/${i.token}`;
                  return (
                    <tr key={i.token}>
                      <td style={{ wordBreak: 'break-all' }}>{link}</td>
                      <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                        {i.expiresAt
                          ? T('until', { date: i.expiresAt.slice(0, 10) })
                          : T('noExpiry')}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="plain" onClick={() => copy(link, i.token)}>
                          {copied === i.token ? T('copied') : T('copy')}
                        </button>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button
                          className="plain"
                          disabled={busy}
                          onClick={() => run(() => revokeInvite({ ledgerId, token: i.token }))}
                        >
                          {T('revoke')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="aside" style={{ marginTop: 16, maxWidth: 560 }}>
          {T('inviteHint')}
        </p>

        {/*
          만드는 데 시간이 든다. 서버가 열쇠를 하나 찍어서 넣고 오는 동안
          화면에는 아무 일도 안 일어나므로, 안 먹은 줄 알고 또 누르게 된다.
          글씨가 바뀌고 아래를 선 하나가 지나간다. 단추는 제자리다(.swap).
        */}
        <div className="row" style={{ marginTop: 20 }}>
          <button
            className={`act small${doing === 'invite' ? ' waiting' : ''}`}
            disabled={busy}
            aria-busy={doing === 'invite' || undefined}
            onClick={() => run(() => createInvite({ ledgerId }), 'invite')}
          >
            <span className={`swap${doing === 'invite' ? ' on' : ''}`}>
              <span className="rest">{T('makeInvite')}</span>
              <span className="wait">{T('making')}</span>
            </span>
          </button>
        </div>
      </section>
      )}

      <section>
        <div className="caption">{T('bookSection')}</div>
        <table className="facts roomy" style={{ marginTop: 14 }}>
          <tbody>
            <tr>
              <td className="k">{T('teamName')}</td>
              {/* 팀 이름은 만든 사람만 고친다. 모두의 화면에 뜨는 이름이라서. */}
              <td className="v">
                {!owner ? (
                  teamName
                ) : editTeam ? (
                  <span className="row" style={{ gap: 8 }}>
                    <input
                      type="text"
                      value={newTeam}
                      autoFocus
                      style={{ width: 200 }}
                      onChange={(e) => setNewTeam(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          await run(() => renameTeam({ ledgerId, name: newTeam }));
                          setEditTeam(false);
                        }
                        if (e.key === 'Escape') setEditTeam(false);
                      }}
                    />
                    <button
                      className="act small"
                      disabled={busy}
                      onClick={async () => {
                        await run(() => renameTeam({ ledgerId, name: newTeam }));
                        setEditTeam(false);
                      }}
                    >
                      {T('rename')}
                    </button>
                    <button className="plain" onClick={() => setEditTeam(false)}>
                      {T('close')}
                    </button>
                  </span>
                ) : (
                  <button
                    className="plain"
                    onClick={() => {
                      setNewTeam(teamName);
                      setEditTeam(true);
                    }}
                  >
                    {teamName}
                  </button>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        {/*
          장부 지우기. 되돌릴 수 없어서 두 번 눌러야 실행된다.

          되묻는 말을 이 줄 안에 넣었더니 두 가지가 어긋났다. 경고 문장과
          단추 두 개가 한꺼번에 나타나 **줄이 늘어나면서 아래가 밀렸고**,
          단추 글씨까지 '삭제합니다'로 바뀌어서 방금 누른 것이 어디로 갔는지
          한 번 찾아야 했다.

          그래서 단추는 **제자리에 그대로, 같은 글씨로** 둔다. 달라지는 것은
          무게뿐이다(.sure). 무엇이 사라지는지는 수증이가 이 단추 옆으로
          걸어와서 말한다 — 말하는 자리는 이 서비스에 하나뿐이다(§21.10).

          5초 뒤 수증이의 말이 스스로 지나가므로, 겨눈 상태도 같이 풀린다.
          눌러 놓고 잊은 단추가 빨간 채로 남아 있지 않게.
        */}
        <div className="row" style={{ marginTop: 26, display: owner ? undefined : 'none' }}>
          <button
            ref={dropBtn}
            className={`plain${armed ? ' arm' : ''}`}
            disabled={busy}
            onClick={async () => {
              if (!armed) {
                setArmed(true);
                say(T('deleteWarn'), 'warn', dropBtn.current);
                if (armTimer.current) clearTimeout(armTimer.current);
                armTimer.current = setTimeout(() => setArmed(false), 5000);
                return;
              }
              if (armTimer.current) clearTimeout(armTimer.current);
              setArmed(false);
              const r = await run(() => deleteTeam({ ledgerId }));
              if (r?.ok) router.push('/teams');
            }}
          >
            {T('deleteBook')}
          </button>
        </div>

        {/*
          팀에서 나가기.

          만든 사람에게는 위의 '장부 지우기'가 있으므로 여기는 나머지 팀원의
          자리다. 지출에 이름이 한 번이라도 들어갔으면 서버가 막고, 그때는
          명단에서 내려가는 쪽을 쓰라고 알려 준다.
        */}
        {!owner && (
          <div className="row" style={{ marginTop: 26 }}>
            {leaving ? (
              <>
                <span className="debit">{T('leaveWarn')}</span>
                <button
                    className="act small sure"
                  disabled={busy}
                  onClick={async () => {
                    const r = await run(() => leaveTeam({ ledgerId }));
                    if (r?.ok) router.push('/teams');
                  }}
                >
                  {T('leaveForReal')}
                </button>
                <button className="plain" onClick={() => setLeaving(false)}>
                  {T('close')}
                </button>
              </>
            ) : (
              <button className="plain" onClick={() => setLeaving(true)}>
                {T('leaveTeam')}
              </button>
            )}
          </div>
        )}
      </section>
    </>
  );
}
