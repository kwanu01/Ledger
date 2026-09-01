'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createInvite,
  deleteTeam,
  renameMember,
  revokeInvite,
  setMemberAccount,
  setMemberActive,
  type InviteRow,
  type TeamMember,
} from '../../../actions/teams.ts';
import { translator } from '../../../../lib/i18n.ts';
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
}: {
  ledgerId: string;
  teamName: string;
  members: TeamMember[];
  invites: InviteRow[];
  origin: string;
  lang: Locale;
  /** 이 장부를 만든 사람인가. 명단 정리 버튼만 여기에 달린다. */
  owner: boolean;
}) {
  const router = useRouter();
  // 경고는 도우미 말풍선 한 자리로 모인다(app/helper).
  const { say } = useHelper();
  const T = translator(lang);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [editAcct, setEditAcct] = useState<string | null>(null);
  const [bank, setBank] = useState('');
  const [acct, setAcct] = useState('');

  async function run(fn: () => Promise<{ ok: boolean; message?: string }>) {
        setBusy(true);
    const r = await fn();
    setBusy(false);
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

  async function copyAccount(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // 복사가 막혀 있으면 계좌가 화면에 그대로 있으니 손으로 고르면 된다.
    }
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
        <div className="caption">{T('membersN', { n: active.length })}</div>

        <div className="scroll" style={{ marginTop: 14 }}>
          <table className="book">
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className={m.active ? undefined : 'left'}>
                  <td style={{ width: '45%' }}>
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
                    {m.isMe ? T('me') : m.hasAccount ? '' : T('notLinked')}
                  </td>
                  <td>
                    {!m.isMe ? (
                      // 계좌는 본인만 적는다. 남의 줄에는 적힌 것만 보이고,
                      // 누르면 복사된다. 복사 버튼을 따로 세우지 않는다.
                      m.bank && m.accountNo ? (
                        <span className="remit-to">
                          <button
                            className="acct num"
                            title={T('copyAccount')}
                            onClick={() => copyAccount(m.id, `${m.bank} ${m.accountNo}`)}
                          >
                            {m.bank} {m.accountNo}
                            {copied === m.id && <span className="acct-done"> {T('copied')}</span>}
                          </button>
                        </span>
                      ) : (
                        <span className="muted" style={{ whiteSpace: 'nowrap' }}>
                          {T('noAccount')}
                        </span>
                      )
                    ) : editAcct === m.id ? (
                      <span className="acct-fields">
                        <input
                          type="text"
                          className="bank"
                          placeholder={T('bank')}
                          value={bank}
                          autoFocus
                          onChange={(e) => setBank(e.target.value)}
                        />
                        <input
                          type="text"
                          className="no num"
                          inputMode="numeric"
                          placeholder={T('accountNo')}
                          value={acct}
                          onChange={(e) => setAcct(e.target.value)}
                        />
                        <button
                          className="act small"
                          disabled={busy}
                          onClick={async () => {
                            await run(() =>
                              setMemberAccount({ ledgerId, memberId: m.id, bank, accountNo: acct }),
                            );
                            setEditAcct(null);
                          }}
                        >
                          {T('save')}
                        </button>
                        <button className="plain" onClick={() => setEditAcct(null)}>
                          {T('close')}
                        </button>
                      </span>
                    ) : (
                      <button
                        className="plain"
                        style={{ whiteSpace: 'nowrap' }}
                        onClick={() => {
                          setEditAcct(m.id);
                          setBank(m.bank);
                          setAcct(m.accountNo);
                        }}
                      >
                        {m.bank && m.accountNo ? `${m.bank} ${m.accountNo}` : T('noAccount')}
                      </button>
                    )}
                  </td>
                  <td className="muted">{m.active ? '' : T('gone')}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {(m.isMe || owner) && (
                      <button
                        className="plain"
                        disabled={busy}
                        onClick={() => run(() => setMemberActive({ ledgerId, memberId: m.id, active: !m.active }))}
                      >
                        {m.active ? T('markGone') : T('bringBack')}
                      </button>
                    )}
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
          <br />
          {T('accountHint')}
        </p>

      </section>

      <section>
        <div className="caption">{T('inviteLinks')}</div>

        {invites.length === 0 ? (
          <p className="muted" style={{ marginTop: 16 }}>
            {T('none')}
          </p>
        ) : (
          <div className="scroll" style={{ marginTop: 14 }}>
            <table className="book">
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

        <div className="row" style={{ marginTop: 20 }}>
          <button
            className="act small"
            disabled={busy}
            onClick={() => run(() => createInvite({ ledgerId }))}
          >
            {T('makeInvite')}
          </button>
        </div>
      </section>

      <section>
        <div className="caption">{T('bookSection')}</div>
        <table className="facts" style={{ marginTop: 14, minWidth: 320 }}>
          <tbody>
            <tr>
              <td className="k">{T('teamName')}</td>
              <td className="v">{teamName}</td>
            </tr>
          </tbody>
        </table>

        {/* 되돌릴 수 없는 일이라 두 번 눌러야 실행된다. 만든 사람만 지운다. */}
        <div className="row" style={{ marginTop: 26, display: owner ? undefined : 'none' }}>
          {armed ? (
            <>
              <span className="debit">{T('deleteWarn')}</span>
              <button
                className="act small danger"
                disabled={busy}
                onClick={async () => {
                  const r = await run(() => deleteTeam({ ledgerId }));
                  if (r?.ok) router.push('/teams');
                }}
              >
                {T('deleteForReal')}
              </button>
              <button className="plain" onClick={() => setArmed(false)}>
                {T('close')}
              </button>
            </>
          ) : (
            <button className="plain" onClick={() => setArmed(true)}>
              {T('deleteBook')}
            </button>
          )}
        </div>
      </section>
    </>
  );
}
