'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  requireUser,
  requireLedgerAccess,
  currentPass,
  issuePass,
  clearPass,
  teamForInvite,
  isTeamOwner,
} from '../../lib/access.ts';
import { currentUser } from '../../lib/auth-client.ts';
import { db } from '../../lib/db/client.ts';
import { dropLedgerImages } from '../../lib/db/images.ts';
import { setTeamOwner } from '../../lib/db/repo.ts';
import { CURRENCIES, type CurrencyCode } from '../../lib/domain/money.ts';
import { failed } from '../../lib/fail.ts';

/**
 * 계정과 장부를 잇는 자리.
 *
 * 통화는 여기서만 정한다. 장부를 만든 뒤에는 바꿀 수 없고, 지출이 하나라도
 * 기입되면 DB 트리거가 변경을 막는다(0005_currency.sql).
 */

export type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { value?: never } : { value: T }))
  | { ok: false; message: string };


/**
 * 로그인한 사용자의 프로필 행을 보장한다.
 *
 * `members.user_id` 는 `profiles.id` 를 가리킨다. 그래서 계정에 이름표를 다는
 * 모든 자리는 그 전에 이 줄이 있어야 한다. 없으면 외래키가 거절한다.
 *
 * 예전에는 팀 목록 화면에서만 이 함수를 불렀다. 장부를 만든 사람은 언제나
 * 그 화면을 지나가므로 문제가 드러나지 않았지만, **초대 링크로 온 사람은
 * 그 화면을 지나가지 않는다.** 로그인하고 곧바로 이름을 적는 화면으로 가서
 * 팀에 들어가려 하면, 프로필이 없어 거기서 막혔다. 초대받은 사람만 못 들어오는
 * 상태가 그래서 생겼다.
 *
 * 이제 계정에 무언가를 붙이기 직전마다 부른다. 여러 번 불러도 한 줄이다.
 */
export async function ensureProfile(): Promise<{ id: string; displayName: string }> {
  const user = await requireUser();
  const { data } = await db.from('profiles').select('id, display_name').eq('id', user.id).maybeSingle();
  if (data) return { id: data.id, displayName: data.display_name };

  // 두 화면이 동시에 부를 수 있다. 이미 있으면 조용히 지나간다.
  const { error } = await db
    .from('profiles')
    .upsert({ id: user.id, display_name: user.displayName }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return { id: user.id, displayName: user.displayName };
}

export type MyLedger = {
  ledgerId: string;
  ledgerName: string;
  teamId: string;
  teamName: string;
  currency: CurrencyCode;
  archivedAt: string | null;
  /** 이 팀의 소유자가 나인가. 목록에서 내 자리를 구분해 적는다. */
  mine: boolean;
};

/** 내가 들어가 있는 팀의 장부 전부. 수업이 둘이면 팀도 둘이다. */
export async function myLedgers(): Promise<MyLedger[]> {
  const user = await requireUser();

  const { data: memberships } = await db.from('members').select('team_id').eq('user_id', user.id);
  const teamIds = [...new Set((memberships ?? []).map((m) => m.team_id as string))];
  if (!teamIds.length) return [];

  const { data } = await db
    .from('ledgers')
    .select('id, name, currency, archived_at, team_id, teams(name, owner_id)')
    .in('team_id', teamIds)
    .order('created_at');

  return (data ?? []).map((l: Record<string, unknown>) => {
    const team = l.teams as { name: string; owner_id: string | null };
    return {
      ledgerId: l.id as string,
      ledgerName: l.name as string,
      teamId: l.team_id as string,
      teamName: team.name,
      currency: (l.currency as CurrencyCode) ?? 'KRW',
      archivedAt: (l.archived_at as string) ?? null,
      mine: Boolean(team.owner_id) && team.owner_id === user.id,
    };
  });
}

/**
 * 팀과 첫 장부를 한 번에 만든다.
 *
 * 만든 사람은 members에 자기 행이 생기고 user_id가 붙는다. 그래서 이후에는
 * 로그인만으로 이 장부에 들어올 수 있다. 나머지 팀원은 user_id 없이 이름만 있고
 * 초대 링크로 들어온다.
 */
export async function createTeamAndLedger(input: {
  teamName: string;
  ledgerName: string;
  currency: CurrencyCode;
  myName: string;
}): Promise<Result<{ ledgerId: string }>> {
  try {
    const user = await requireUser();
    await ensureProfile();

    if (!input.teamName.trim()) return { ok: false, message: '팀 이름을 적어 주세요.' };
    if (!input.ledgerName.trim()) return { ok: false, message: '장부 이름을 적어 주세요.' };
    if (!input.myName.trim()) return { ok: false, message: '본인 이름을 적어 주세요.' };
    if (!CURRENCIES[input.currency]) return { ok: false, message: '쓸 수 없는 통화입니다.' };

    const { data: team, error: teamError } = await db
      .from('teams')
      .insert({ name: input.teamName.trim(), owner_id: user.id })
      .select('id')
      .single();
    if (teamError) throw new Error(teamError.message);

    // 만든 사람만 넣는다. 나머지는 초대 링크로 들어와 스스로 이름을 적는다(joinTeam).
    // 명단 순서가 나머지 1원 배분 순서를 결정하므로, 들어온 차례가 곧 순서가 된다.
    const { error: memberError } = await db.from('members').insert({
      team_id: team.id,
      display_name: input.myName.trim(),
      sort_order: 1,
      user_id: user.id,
    });
    if (memberError) throw new Error(memberError.message);

    const { data: ledger, error: ledgerError } = await db
      .from('ledgers')
      .insert({ team_id: team.id, name: input.ledgerName.trim(), currency: input.currency })
      .select('id')
      .single();
    if (ledgerError) throw new Error(ledgerError.message);

    revalidatePath('/teams');
    return { ok: true, value: { ledgerId: ledger.id as string } };
  } catch (e) {
    return failed(e);
  }
}

/**
 * 한 팀 안에 장부 하나 더 (§5.2)
 *
 * 팀과 장부는 처음부터 다른 것이었다. 팀은 사람의 묶음이고 장부는 돈의
 * 묶음이다. DB 도 그렇게 되어 있었는데(ledgers.team_id), 화면에서는 팀을
 * 만들 때 장부 하나를 같이 만들고 그걸로 끝이었다.
 *
 * 그런데 한 수업에서 과제가 셋이면 장부도 셋이어야 한다. 사람은 그대로고
 * 돈만 갈라지는 것이다. 같은 사람들끼리 팀을 세 번 만들고 초대 링크를 세 번
 * 돌리는 것은 같은 일을 세 번 하는 것이다.
 *
 * 그래서 장부만 더한다. **팀원 명단도 초대 링크도 그대로 쓴다.**
 *
 * 통화는 장부마다 정한다. 한 장부는 통화 하나만 쓰기 때문이다(0005).
 * 만드는 것은 소유자만 한다 — 장부가 늘면 팀원 모두의 화면에 늘어난다.
 */
export async function addLedgerToTeam(args: {
  ledgerId: string;
  name: string;
  currency: CurrencyCode;
}): Promise<Result<{ ledgerId: string }>> {
  try {
    const pass = await requireLedgerAccess(args.ledgerId);
    if (!(await isOwner(pass))) {
      return { ok: false, message: '장부는 이 팀을 만든 사람만 더할 수 있습니다.' };
    }
    if (!args.name.trim()) return { ok: false, message: '장부 이름을 적어 주세요.' };
    if (!CURRENCIES[args.currency]) return { ok: false, message: '쓸 수 없는 통화입니다.' };

    const { data, error } = await db
      .from('ledgers')
      .insert({ team_id: pass.teamId, name: args.name.trim(), currency: args.currency })
      .select('id')
      .single();
    if (error) throw new Error(error.message);

    revalidatePath('/teams');
    revalidatePath(`/l/${args.ledgerId}`, 'layout');
    return { ok: true, value: { ledgerId: data.id as string } };
  } catch (e) {
    return failed(e);
  }
}

/** 이 팀이 가진 장부 전부. 머리글의 장부 전환 자리가 쓴다. */
export async function teamLedgers(
  ledgerId: string,
): Promise<{ id: string; name: string; here: boolean }[]> {
  const pass = await requireLedgerAccess(ledgerId);
  const { data } = await db
    .from('ledgers')
    .select('id, name')
    .eq('team_id', pass.teamId)
    .order('created_at');
  return (data ?? []).map((l) => ({
    id: l.id as string,
    name: l.name as string,
    here: (l.id as string) === ledgerId,
  }));
}

/**
 * 초대 링크 발급 (§5.2)
 *
 * 링크를 가진 사람은 이 팀에 들어와 장부 전체를 본다. 문을 여는 열쇠를 만드는
 * 일이라 장부를 만든 사람만 한다. 아무 팀원이나 만들 수 있으면, 한 사람만
 * 흔들려도 팀 전체의 기록이 열린다.
 *
 * 회수와 만료가 함께 있는 것도 같은 이유다.
 */
export async function createInvite(args: {
  ledgerId: string;
  expiresInDays?: number;
}): Promise<Result<{ token: string }>> {
  try {
    const pass = await requireLedgerAccess(args.ledgerId);
    if (!pass.userId) return { ok: false, message: '초대 링크는 로그인한 사람만 만들 수 있습니다.' };
    if (!(await isOwner(pass))) {
      return { ok: false, message: '초대 링크는 이 장부를 만든 사람만 발급할 수 있습니다.' };
    }

    // 기간은 넣더라도 한 해를 넘기지 않는다. 오래된 열쇠는 잊힌 채 남는다.
    const days = Math.min(Math.max(Math.trunc(args.expiresInDays ?? 120), 1), 365);
    const { data, error } = await db
      .from('invites')
      .insert({
        team_id: pass.teamId,
        created_by: pass.userId,
        expires_at: new Date(Date.now() + days * 86400000).toISOString(),
      })
      .select('token')
      .single();
    if (error) throw new Error(error.message);

    return { ok: true, value: { token: data.token as string } };
  } catch (e) {
    return failed(e);
  }
}

export async function revokeInvite(args: { ledgerId: string; token: string }): Promise<Result> {
  try {
    const pass = await requireLedgerAccess(args.ledgerId);
    if (!(await isOwner(pass))) {
      return { ok: false, message: '초대 링크는 이 장부를 만든 사람만 회수할 수 있습니다.' };
    }
    const { error } = await db
      .from('invites')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token', args.token)
      .eq('team_id', pass.teamId);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}


/** 팀을 고르면 그 장부로 들어간다. */
export async function openLedger(ledgerId: string): Promise<never> {
  redirect(`/l/${ledgerId}`);
}

/* ── 팀원 관리 (§21.9) ──────────────────────────────────────────────────── */

/**
 * 팀원은 지우지 않는다. 과거 지출의 부담자로 계속 남아야 하기 때문이다.
 * 나간 사람은 active를 내려 앞으로의 지출에서만 빠진다.
 */

export type TeamMember = {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
  isMe: boolean;
  hasAccount: boolean;
  /** 이 장부의 소유자인가. 화면에 표시하고, 넘길 대상에서 제외하는 데 쓴다. */
  isOwner: boolean;
  bank: string;
  accountNo: string;
};

export async function teamMembers(ledgerId: string): Promise<TeamMember[]> {
  const pass = await requireLedgerAccess(ledgerId);
  const [{ data }, { data: team }] = await Promise.all([
    db
      .from('members')
      .select('id, display_name, active, sort_order, user_id, bank, account_no')
      .eq('team_id', pass.teamId)
      .order('sort_order'),
    db.from('teams').select('owner_id').eq('id', pass.teamId).maybeSingle(),
  ]);
  const ownerId = (team?.owner_id as string | null) ?? null;

  return (data ?? []).map((m: Record<string, unknown>) => ({
    id: m.id as string,
    name: m.display_name as string,
    active: m.active as boolean,
    sortOrder: m.sort_order as number,
    isMe: (m.id as string) === pass.memberId,
    hasAccount: Boolean(m.user_id),
    isOwner: Boolean(ownerId) && m.user_id === ownerId,
    bank: (m.bank as string) ?? '',
    accountNo: (m.account_no as string) ?? '',
  }));
}

/**
 * 소유권 넘기기 (§21.9)
 *
 * 소유자를 만든 사람으로 못 박아 두면, 그 사람이 학기 중에 빠질 때 장부가
 * 굳는다. 초대 링크도 못 만들고 이름도 못 바꾸고, 안 닫히는 송금을 대신
 * 확인할 사람도 없어진다.
 *
 * 넘기는 것은 지금 소유자만 할 수 있고, 받는 사람은 **계정이 있는 활성
 * 팀원**이어야 한다. 초대 링크로만 들어온 사람에게 넘기면 그 장부에는 다시
 * 들어올 수 있는 소유자가 없어진다 — 되돌릴 방법이 없는 실수라서 막는다.
 *
 * 한 번 넘기면 넘긴 사람은 더 이상 소유자가 아니다. 되돌리려면 새 소유자가
 * 다시 넘겨야 한다. 소유자는 언제나 한 사람이다.
 */
export async function handOverOwnership(args: {
  ledgerId: string;
  memberId: string;
}): Promise<Result> {
  try {
    const pass = await requireLedgerAccess(args.ledgerId);
    if (!(await isOwner(pass))) {
      return { ok: false, message: '소유권은 지금 소유자만 넘길 수 있습니다.' };
    }
    if (args.memberId === pass.memberId) {
      return { ok: false, message: '이미 소유자입니다.' };
    }
    await setTeamOwner(pass.teamId, args.memberId);
    revalidatePath(`/l/${args.ledgerId}`, 'layout');
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/** 이 사람이 이 장부의 소유자인가. 판정은 lib/access.ts 한 곳에서만 한다. */
const isOwner = isTeamOwner;

/** 지금 보고 있는 사람이 이 장부를 만든 사람인지. 화면에서 버튼을 가리는 데 쓴다. */
export async function amOwner(ledgerId: string): Promise<boolean> {
  const pass = await requireLedgerAccess(ledgerId);
  return isOwner(pass);
}

/**
 * 이름 고치기. 지출에는 memberId가 박혀 있으므로 이름만 바뀌고 계산은 그대로다.
 *
 * 자기 이름은 자기가 고친다. 오타가 난 채로 나간 사람이 있을 수 있으므로,
 * 장부를 만든 사람에게만 예외를 둔다.
 */
export async function renameMember(args: {
  ledgerId: string;
  memberId: string;
  name: string;
}): Promise<Result> {
  try {
    const pass = await requireLedgerAccess(args.ledgerId);
    if (args.memberId !== pass.memberId && !(await isOwner(pass))) {
      return { ok: false, message: '이름은 본인이 고칩니다.' };
    }

    const name = args.name.trim();
    if (!name) return { ok: false, message: '이름을 적어 주세요.' };

    const { error } = await db
      .from('members')
      .update({ display_name: name })
      .eq('id', args.memberId)
      .eq('team_id', pass.teamId);
    if (error) throw new Error(error.message);

    // 내 이름이면 계정 쪽 이름도 같이 맞춰 둔다. 두 곳이 어긋나면 헷갈린다.
    if (args.memberId === pass.memberId && pass.userId) {
      await db.from('profiles').update({ display_name: name }).eq('id', pass.userId);
    }

    revalidatePath(`/l/${args.ledgerId}`, 'layout');
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/**
 * 나감 / 돌아옴. 행을 지우지 않는 이유는 위 주석대로다.
 * 나간 사람도 이미 기입된 지출에서는 계속 부담자로 남는다.
 */
export async function setMemberActive(args: {
  ledgerId: string;
  memberId: string;
  active: boolean;
}): Promise<Result> {
  try {
    const pass = await requireLedgerAccess(args.ledgerId);
    if (args.memberId !== pass.memberId && !(await isOwner(pass))) {
      return { ok: false, message: '명단은 본인이나 장부를 만든 사람이 정리합니다.' };
    }

    if (!args.active) {
      const { count } = await db
        .from('members')
        .select('id', { count: 'exact', head: true })
        .eq('team_id', pass.teamId)
        .eq('active', true);
      if ((count ?? 0) <= 1) return { ok: false, message: '팀에 한 사람은 남아 있어야 합니다.' };
    }

    const { error } = await db
      .from('members')
      .update({ active: args.active })
      .eq('id', args.memberId)
      .eq('team_id', pass.teamId);
    if (error) throw new Error(error.message);

    revalidatePath(`/l/${args.ledgerId}`, 'layout');
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

export type InviteRow = { token: string; createdAt: string; expiresAt: string | null };

/**
 * 살아 있는 초대 링크만. 회수했거나 기간이 지난 것은 보여 주지 않는다.
 *
 * 링크 자체가 열쇠라서, 발급할 수 있는 사람에게만 보인다. 팀원이라도
 * 만든 사람이 아니면 빈 목록을 받는다.
 */
export async function liveInvites(ledgerId: string): Promise<InviteRow[]> {
  const pass = await requireLedgerAccess(ledgerId);
  if (!(await isOwner(pass))) return [];
  const { data } = await db
    .from('invites')
    .select('token, created_at, expires_at, revoked_at')
    .eq('team_id', pass.teamId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  const now = Date.now();
  return (data ?? [])
    .filter((i: Record<string, unknown>) => !i.expires_at || new Date(i.expires_at as string).getTime() > now)
    .map((i: Record<string, unknown>) => ({
      token: i.token as string,
      createdAt: i.created_at as string,
      expiresAt: (i.expires_at as string) ?? null,
    }));
}

/* ── 초대 링크로 들어오기 (§5.2) ────────────────────────────────────────── */

/**
 * 팀원은 초대 링크로만 늘어난다.
 *
 * 장부를 만든 사람이 남의 이름을 대신 적어 두는 방식은, 그 사람이 실제로
 * 들어오지 않아도 명단에 남아 정산 대상이 되어 버린다. 링크를 받아 스스로
 * 이름을 적은 사람만 명단에 올린다.
 *
 * 링크는 문을 열어 줄 뿐이고, 이름표는 계정에 붙는다. 그래서 들어올 때 로그인을
 * 한 번 거친다. 그러면 그 사람의 장부 목록에 이 장부가 남고, 다음에 어느 기기에서
 * 들어오든 같은 사람으로 인식된다. 보냈어요·받았어요가 성립하는 근거다.
 */
export async function joinTeam(args: {
  token: string;
  name: string;
}): Promise<Result<{ ledgerId: string | null }>> {
  try {
    const teamId = await teamForInvite(args.token);
    if (!teamId) return { ok: false, message: '이 초대 링크는 더 이상 쓸 수 없습니다.' };

    const name = args.name.trim();
    if (!name) return { ok: false, message: '이름을 적어 주세요.' };

    // 링크는 문을 열어 줄 뿐, 이름표를 다는 것은 계정이다. 로그인하지 않으면
    // 나중에 이 사람이 다시 들어왔을 때 아까 그 사람인지 알 방법이 없고,
    // 보냈어요·받았어요처럼 본인만 할 수 있는 일도 성립하지 않는다.
    const user = await currentUser();
    if (!user) return { ok: false, message: '로그인한 뒤에 들어올 수 있습니다.' };

    // 이름표를 계정에 붙이기 전에 그 계정의 프로필 줄부터 있어야 한다.
    // 초대 링크로 온 사람은 팀 목록 화면을 지나오지 않으므로 여기가 처음이다.
    await ensureProfile();

    // 이미 이 팀의 멤버라면 새로 만들지 않는다. 링크를 두 번 눌러도 사람이 둘이 되면 안 된다.
    const { data: mine } = await db
      .from('members')
      .select('id')
      .eq('team_id', teamId)
      .eq('user_id', user.id)
      .maybeSingle();
    let memberId: string | null = (mine?.id as string) ?? null;

    // 계정 없이 이름만 적고 들어와 있던 사람이 이제 로그인해서 다시 눌렀다면,
    // 새로 만들지 않고 그 줄을 이 계정에 붙인다.
    if (!memberId) {
      const existing = await currentPass();
      if (existing?.teamId === teamId) {
        const { data: row } = await db
          .from('members')
          .select('id, user_id')
          .eq('id', existing.memberId)
          .maybeSingle();
        if (row && !row.user_id) {
          memberId = row.id as string;
          await db.from('members').update({ user_id: user.id }).eq('id', memberId);
        }
      }
    }

    if (memberId) {
      await db.from('members').update({ display_name: name, active: true }).eq('id', memberId);
    } else {
      const { data: last } = await db
        .from('members')
        .select('sort_order')
        .eq('team_id', teamId)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data, error } = await db
        .from('members')
        .insert({
          team_id: teamId,
          display_name: name,
          sort_order: ((last?.sort_order as number) ?? 0) + 1,
          user_id: user.id,
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      memberId = data.id as string;
    }

    // 통행증은 이 계정으로 발급한다. 화면마다 팀원 조회를 다시 하지 않아도 되고,
    // 다른 계정으로 로그인하면 계정이 이겨서 이 통행증은 무시된다(lib/access.ts).
    await issuePass({ teamId, memberId, memberName: name, userId: user.id });

    const { data: ledger } = await db
      .from('ledgers')
      .select('id')
      .eq('team_id', teamId)
      .is('archived_at', null)
      .order('created_at')
      .limit(1)
      .maybeSingle();

    revalidatePath('/teams');
    return { ok: true, value: { ledgerId: (ledger?.id as string) ?? null } };
  } catch (e) {
    return failed(e);
  }
}

/**
 * 통행증으로만 들어와 있던 사람이 나중에 계정을 만들어 로그인했을 때,
 * 그 멤버 행을 계정에 묶어 준다. 그래야 장부 목록에서 그 장부가 보인다.
 */
export async function claimMembership(): Promise<void> {
  const [user, pass] = await Promise.all([currentUser(), currentPass()]);
  if (!user || !pass) return;

  const { data } = await db
    .from('members')
    .select('id, user_id')
    .eq('id', pass.memberId)
    .maybeSingle();
  if (!data || data.user_id) return;

  // 여기서도 계정에 줄을 붙인다. 프로필이 먼저다.
  await ensureProfile();

  // 한 사람이 한 팀에 두 줄로 있으면 안 된다. 이미 계정으로 묶인 줄이 있으면 두지 않는다.
  const { data: mine } = await db
    .from('members')
    .select('id')
    .eq('team_id', pass.teamId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (mine) return;

  await db.from('members').update({ user_id: user.id }).eq('id', pass.memberId);
}

/**
 * 팀 이름 바꾸기.
 *
 * 만든 사람만 바꾼다. 팀 이름은 모두의 화면에 뜨고 카카오톡으로 나가는 글의
 * 첫 줄이기도 하다. 초대 링크로 들어온 사람이 바꿀 수 있으면, 그 링크를 받은
 * 누구든 남의 팀 이름을 갈아 끼울 수 있게 된다.
 *
 * 지난 정산 글에 이미 옛 이름이 적혀 나갔더라도 그건 그대로 둔다. 보낸 글은
 * 보낸 그대로가 맞다.
 */
export async function renameTeam(args: { ledgerId: string; name: string }): Promise<Result> {
  try {
    const pass = await requireLedgerAccess(args.ledgerId);
    if (!(await isOwner(pass))) {
      return { ok: false, message: '팀을 만든 사람만 이름을 바꿀 수 있습니다.' };
    }

    const name = args.name.trim();
    if (!name) return { ok: false, message: '팀 이름을 적어 주세요.' };
    if (name.length > 60) return { ok: false, message: '팀 이름이 너무 깁니다.' };

    const { error } = await db.from('teams').update({ name }).eq('id', pass.teamId);
    if (error) throw new Error(error.message);

    revalidatePath(`/l/${args.ledgerId}`, 'layout');
    revalidatePath('/teams');
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

/* ── 장부 지우기 ────────────────────────────────────────────────────────── */

/**
 * 팀을 통째로 지운다. 장부, 지출, 정산, 송금, 초대 링크가 함께 사라진다.
 * (스키마의 on delete cascade가 처리한다.)
 *
 * 만든 사람만 지울 수 있다. 초대 링크로 들어온 사람이 남의 장부를 없앨 수 있으면
 * 이 서비스는 아무것도 기록해 두지 못한다.
 *
 * 되돌릴 수 없다. 그래서 화면에서 두 번 눌러야 실행된다.
 */
/**
 * 팀에서 나가기 (§21.9)
 *
 * 나가는 것과 명단에서 내려가는 것은 다르다.
 *
 *   나감(active=false) — 이름은 남는다. 지난 지출의 부담자로 계속 세어야 하므로
 *                        줄을 지울 수 없다. 이미 돈이 얽힌 사람이다.
 *   탈퇴(이 함수)      — 줄을 아예 지운다. **한 번도 돈에 얽히지 않은 사람만**
 *                        할 수 있다. 잘못 들어왔거나, 들어와 놓고 쓰지 않은 경우다.
 *
 * 지출 한 줄에라도 이름이 들어 있으면 지울 수 없다. 결제자로든, 부담자로든,
 * 기록 시점 명단으로든 마찬가지다. 그 이름이 빠지면 그 지출의 계산이 성립하지
 * 않는다. 그때는 명단에서 내려가는 쪽(setMemberActive)을 쓴다.
 *
 * 장부를 만든 사람은 나갈 수 없다. 팀의 주인이 없어지면 초대도 이름 변경도
 * 아무도 못 하게 된다. 그 사람에게는 장부를 지우는 길이 따로 있다.
 */
export async function leaveTeam(args: { ledgerId: string }): Promise<Result> {
  try {
    const pass = await requireLedgerAccess(args.ledgerId);

    if (await isOwner(pass)) {
      return {
        ok: false,
        message: '장부를 만든 사람은 나갈 수 없습니다. 장부를 지우는 것으로 정리해 주세요.',
      };
    }

    // 이 팀의 장부 전부에서 이 사람을 찾는다. 한 팀에 장부가 여럿일 수 있다.
    const { data: ledgers } = await db.from('ledgers').select('id').eq('team_id', pass.teamId);
    const ids = (ledgers ?? []).map((l) => l.id as string);

    if (ids.length) {
      const me = pass.memberId;

      // 세 갈래로 나눠 센다. 배열 안에 들었는지 묻는 조건은 한 문장에 섞어
      // 쓰면 따옴표가 꼬이기 쉬워서, 각각 제 방식으로 묻는다.
      //   기록 시점 명단 — 그때 팀에 있었다면 공동 지출의 부담자다
      //   결제자·귀속자 — 그 지출이 이 사람을 가리킨다
      const [roster, part, paid] = await Promise.all([
        db.from('expenses').select('id', { count: 'exact', head: true })
          .in('ledger_id', ids).contains('team_member_ids', [me]),
        db.from('expenses').select('id', { count: 'exact', head: true })
          .in('ledger_id', ids).contains('participant_member_ids', [me]),
        db.from('expenses').select('id', { count: 'exact', head: true })
          .in('ledger_id', ids).or(`payer_member_id.eq.${me},owner_member_id.eq.${me}`),
      ]);
      const err = roster.error ?? part.error ?? paid.error;
      if (err) throw new Error(err.message);

      const touched = (roster.count ?? 0) + (part.count ?? 0) + (paid.count ?? 0);
      if (touched > 0) {
        return {
          ok: false,
          message:
            '이미 지출에 이름이 들어 있어 나갈 수 없습니다. 팀 화면에서 명단만 내려 주세요.',
        };
      }
    }

    const { error } = await db
      .from('members')
      .delete()
      .eq('id', pass.memberId)
      .eq('team_id', pass.teamId);
    if (error) throw new Error(error.message);

    // 통행증에 적힌 사람이 이제 없다. 남겨 두면 없는 팀원으로 계속 들어온다.
    await clearPass();

    revalidatePath('/teams');
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}

export async function deleteTeam(args: { ledgerId: string }): Promise<Result> {
  try {
    const pass = await requireLedgerAccess(args.ledgerId);
    if (!pass.userId) return { ok: false, message: '장부를 만든 사람만 지울 수 있습니다.' };

    const { data: team } = await db
      .from('teams')
      .select('owner_id')
      .eq('id', pass.teamId)
      .maybeSingle();
    if (!team || team.owner_id !== pass.userId) {
      return { ok: false, message: '장부를 만든 사람만 지울 수 있습니다.' };
    }

    // 지우는 순서가 중요하다. 송금 → 정산 → 지출 → 팀. 그 이유와 순서는
    // 데이터베이스 함수 안에 적혀 있다(0008). 한 트랜잭션으로 돌아야 반쯤
    // 지워진 장부가 남지 않으므로, 여기서 네 번 나눠 부르지 않는다.
    const { error } = await db.rpc('delete_team', { p_team_id: pass.teamId });
    if (error) {
      // 데이터베이스가 영어로 돌려주는 말을 그대로 화면에 올리지 않는다.
      console.error('delete_team', error);
      return { ok: false, message: '장부를 지우지 못했습니다. 잠시 뒤에 다시 시도해 주세요.' };
    }

    // 줄은 지워졌지만 사진은 저장소에 남는다. 장부가 없어졌으니 그 사진을
    // 볼 수 있는 사람도 없다. 못 지워도 장부 삭제는 이미 끝났으므로 막지 않는다.
    try {
      await dropLedgerImages(args.ledgerId);
    } catch (err) {
      console.error('drop images', err);
    }

    revalidatePath('/teams');
    return { ok: true };
  } catch (e) {
    return failed(e);
  }
}
