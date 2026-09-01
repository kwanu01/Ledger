'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  requireUser,
  requireLedgerAccess,
  currentPass,
  issuePass,
  teamForInvite,
  AccessError,
} from '../../lib/access.ts';
import { currentUser } from '../../lib/auth-client.ts';
import { db } from '../../lib/db/client.ts';
import { dropLedgerImages } from '../../lib/db/images.ts';
import { CURRENCIES, type CurrencyCode } from '../../lib/domain/money.ts';

/**
 * 계정과 장부를 잇는 자리.
 *
 * 통화는 여기서만 정한다. 장부를 만든 뒤에는 바꿀 수 없고, 지출이 하나라도
 * 기입되면 DB 트리거가 변경을 막는다(0005_currency.sql).
 */

export type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { value?: never } : { value: T }))
  | { ok: false; message: string };

function failed(e: unknown): { ok: false; message: string } {
  if (e instanceof AccessError) return { ok: false, message: e.message };
  return { ok: false, message: e instanceof Error ? e.message : '알 수 없는 오류가 발생했습니다.' };
}

/** 로그인한 사용자의 프로필 행을 보장한다. 처음 들어올 때 한 번 만들어진다. */
export async function ensureProfile(): Promise<{ id: string; displayName: string }> {
  const user = await requireUser();
  const { data } = await db.from('profiles').select('id, display_name').eq('id', user.id).maybeSingle();
  if (data) return { id: data.id, displayName: data.display_name };

  await db.from('profiles').insert({ id: user.id, display_name: user.displayName });
  return { id: user.id, displayName: user.displayName };
}

export type MyLedger = {
  ledgerId: string;
  ledgerName: string;
  teamId: string;
  teamName: string;
  currency: CurrencyCode;
  archivedAt: string | null;
};

/** 내가 들어가 있는 팀의 장부 전부. 수업이 둘이면 팀도 둘이다. */
export async function myLedgers(): Promise<MyLedger[]> {
  const user = await requireUser();

  const { data: memberships } = await db.from('members').select('team_id').eq('user_id', user.id);
  const teamIds = [...new Set((memberships ?? []).map((m) => m.team_id as string))];
  if (!teamIds.length) return [];

  const { data } = await db
    .from('ledgers')
    .select('id, name, currency, archived_at, team_id, teams(name)')
    .in('team_id', teamIds)
    .order('created_at');

  return (data ?? []).map((l: Record<string, unknown>) => ({
    ledgerId: l.id as string,
    ledgerName: l.name as string,
    teamId: l.team_id as string,
    teamName: (l.teams as { name: string }).name,
    currency: (l.currency as CurrencyCode) ?? 'KRW',
    archivedAt: (l.archived_at as string) ?? null,
  }));
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

/** 초대 링크 발급. 링크를 아는 사람은 팀에 들어올 수 있으므로 회수와 만료가 가능하다. */
export async function createInvite(args: {
  ledgerId: string;
  expiresInDays?: number;
}): Promise<Result<{ token: string }>> {
  try {
    const pass = await requireLedgerAccess(args.ledgerId);
    if (!pass.userId) return { ok: false, message: '초대 링크는 로그인한 사람만 만들 수 있습니다.' };

    const days = args.expiresInDays ?? 120;
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
  bank: string;
  accountNo: string;
};

export async function teamMembers(ledgerId: string): Promise<TeamMember[]> {
  const pass = await requireLedgerAccess(ledgerId);
  const { data } = await db
    .from('members')
    .select('id, display_name, active, sort_order, user_id, bank, account_no')
    .eq('team_id', pass.teamId)
    .order('sort_order');

  return (data ?? []).map((m: Record<string, unknown>) => ({
    id: m.id as string,
    name: m.display_name as string,
    active: m.active as boolean,
    sortOrder: m.sort_order as number,
    isMe: (m.id as string) === pass.memberId,
    hasAccount: Boolean(m.user_id),
    bank: (m.bank as string) ?? '',
    accountNo: (m.account_no as string) ?? '',
  }));
}

/** 이 사람이 장부를 만든 사람인가. 명단 정리는 만든 사람도 할 수 있어야 한다. */
async function isOwner(pass: { teamId: string; userId?: string }): Promise<boolean> {
  if (!pass.userId) return false;
  const { data } = await db.from('teams').select('owner_id').eq('id', pass.teamId).maybeSingle();
  return Boolean(data && data.owner_id === pass.userId);
}

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

/** 살아 있는 초대 링크만. 회수했거나 기간이 지난 것은 보여 주지 않는다. */
export async function liveInvites(ledgerId: string): Promise<InviteRow[]> {
  const pass = await requireLedgerAccess(ledgerId);
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
