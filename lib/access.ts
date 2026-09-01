import 'server-only';
import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from './db/client.ts';
import { currentUser, type AuthUser } from './auth-client.ts';

/**
 * 접근 제어.
 *
 * 이 서비스에는 신분이 두 가지 있다.
 *
 *   1. 로그인한 사용자  — 장부를 만든 사람. Supabase Auth 세션으로 판정한다.
 *   2. 초대 링크로 들어온 팀원 — 가입하지 않는다. 링크를 한 번 통과하면
 *      서명된 쿠키(통행증)를 발급하고 이후에는 그것으로 판정한다.
 *
 * 둘 다 결국 "이 팀의 어느 멤버인가"로 환원된다. 그래서 아래 requireLedgerAccess는
 * 어느 쪽으로 들어왔든 같은 Pass를 돌려준다. 판정은 이 파일에서만 한다.
 *
 * 이건 팀플 규모에 맞춘 신뢰 모델이다. 링크를 아는 사람은 장부를 보고 쓸 수 있다.
 * 대신 링크는 회수(revoked_at)와 만료(expires_at)가 가능하다.
 */

const COOKIE = 'ledger_pass';
const MAX_AGE = 60 * 60 * 24 * 120; // 넉 달

export type Pass = {
  teamId: string;
  memberId: string;
  /** 이 세션에서 "나"로 취급할 사람. 검산 화면의 기준이 된다. */
  memberName: string;
  /** 로그인해서 들어왔으면 그 계정 id. 초대 링크로만 들어왔으면 없다. */
  userId?: string;
};

function secret(): string {
  const s = process.env.LEDGER_COOKIE_SECRET;
  if (!s || s.length < 32) {
    throw new Error('LEDGER_COOKIE_SECRET(32자 이상)이 필요합니다. .env.example을 참고하세요.');
  }
  return s;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function seal(pass: Pass): string {
  const payload = Buffer.from(JSON.stringify(pass)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function unseal(raw: string | undefined): Pass | null {
  if (!raw) return null;
  const [payload, mac] = raw.split('.');
  if (!payload || !mac) return null;
  const expected = sign(payload);
  // 길이가 다르면 timingSafeEqual이 던지므로 먼저 거른다.
  if (mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()) as Pass;
  } catch {
    return null;
  }
}

/** 초대 링크를 통과했을 때 호출한다. */
export async function issuePass(pass: Pass): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, seal(pass), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });
}

/**
 * 통행증을 버린다. 로그아웃하면 계정만 나가고 통행증이 남는 일이 없어야 한다.
 * 남아 있으면 로그아웃한 사람이 계속 그 팀원으로 보인다.
 */
export async function clearPass(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function currentPass(): Promise<Pass | null> {
  const jar = await cookies();
  return unseal(jar.get(COOKIE)?.value);
}

/**
 * 초대 토큰을 검증하고 팀을 돌려준다. 만료·회수된 토큰은 통과하지 못한다.
 * (판정 자체는 DB 함수 team_for_invite에 있다)
 */
export async function teamForInvite(token: string): Promise<string | null> {
  const { data, error } = await db.rpc('team_for_invite', { p_token: token });
  if (error) return null;
  return (data as string | null) ?? null;
}

export class AccessError extends Error {}

/**
 * 로그인한 사용자가 이 팀의 멤버인지 찾는다.
 * 장부를 만든 사람은 members에 자기 행이 있으므로 그것으로 이어진다.
 */
async function memberOfTeam(user: AuthUser, teamId: string): Promise<Pass | null> {
  const { data } = await db
    .from('members')
    .select('id, display_name')
    .eq('team_id', teamId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!data) return null;
  return { teamId, memberId: data.id, memberName: data.display_name, userId: user.id };
}

/** 로그인한 사용자가 접근할 수 있는 팀 id 목록 */
export async function myTeamIds(user: AuthUser): Promise<string[]> {
  const { data } = await db.from('members').select('team_id').eq('user_id', user.id);
  return [...new Set((data ?? []).map((r) => r.team_id as string))];
}

/**
 * 이 장부를 볼 수 있는지 확인하고, 볼 수 있다면 "나"가 누구인지 돌려준다.
 * 모든 서버 액션은 이 함수를 첫 줄에서 부른다.
 */
export async function requireLedgerAccess(ledgerId: string): Promise<Pass> {
  // 장부 조회와 신분 확인은 서로를 기다릴 이유가 없다. 같이 보낸다.
  // 통행증은 서명만 맞춰 보면 되므로 네트워크를 쓰지 않는다.
  const [{ data, error }, cookiePass, user] = await Promise.all([
    db.from('ledgers').select('id, team_id').eq('id', ledgerId).maybeSingle(),
    currentPass(),
    currentUser(),
  ]);
  if (error || !data) throw new AccessError('장부를 찾을 수 없습니다.');

  // 로그인해 있으면 계정이 먼저다. "나"를 정하는 것은 계정이지 쿠키가 아니다.
  // 보냈어요·받았어요·계좌가 사람을 가리는 이상, 브라우저에 남아 있던 통행증이
  // 다른 계정으로 로그인한 사람을 그 사람으로 만들어서는 안 된다.
  if (user) {
    // 이 계정으로 발급한 통행증이면 그대로 믿는다. 왕복이 한 번 줄어든다.
    if (cookiePass && cookiePass.teamId === data.team_id && cookiePass.userId === user.id) {
      return cookiePass;
    }
    const pass = await memberOfTeam(user, data.team_id);
    if (pass) return pass;
  }

  // 아직 계정에 묶이지 않은 사람. 예전 초대 링크로 이름만 적고 들어온 경우다.
  // 로그인하면 claimMembership이 이 줄을 계정에 붙이고, 그다음부터는 위로 온다.
  if (cookiePass && cookiePass.teamId === data.team_id && !cookiePass.userId) {
    return cookiePass;
  }

  throw new AccessError('이 장부에 접근할 권한이 없습니다. 초대 링크로 다시 들어와 주세요.');
}

/** 로그인만 확인한다. 팀을 만들기 전 화면에서 쓴다. */
export async function requireUser(): Promise<AuthUser> {
  const user = await currentUser();
  if (!user) throw new AccessError('로그인이 필요합니다.');
  return user;
}
