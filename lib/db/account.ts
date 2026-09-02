import 'server-only';
import { db } from './client.ts';

/**
 * 계정 (§21.15)
 *
 * ── 탈퇴할 때 무엇이 남고 무엇이 사라지는가 ────────────────────────
 *
 * 이 서비스에서 계정과 장부는 같은 것이 아니다. 계정은 **한 사람이 들어오는
 * 문**이고, 장부는 **여럿이 함께 쓴 기록**이다. 문을 닫는다고 기록이 없어지면,
 * 남은 팀원들의 장부에서 지출 절반이 사라진다. 그건 그 사람들의 기록까지
 * 지우는 것이다.
 *
 * 그래서 이렇게 나눈다.
 *
 *   사라지는 것 — 계정 그 자체. 이메일, 로그인 수단, 계정 번호.
 *                 그리고 이 사람이 만든 초대 링크(더 쓸 데가 없다).
 *   남는 것     — 장부의 지출과 정산. 팀원 명단에 적힌 **이름**.
 *
 * 이름이 남는 이유는 장부가 검산 가능해야 하기 때문이다. '누가 냈는가'가
 * 빠지면 그 줄은 계산에 쓸 수 없다. 다만 그 이름은 이제 아무 계정과도
 * 이어져 있지 않다 — members.user_id 가 NULL 이 된다(0001_schema.sql 의
 * on delete set null). 이름은 그 장부 안의 기록일 뿐, 사람을 가리키는
 * 열쇠가 아니게 된다.
 *
 * ── 소유한 장부가 있으면 먼저 정리한다 ─────────────────────────────
 *
 * teams.owner_id 는 on delete restrict 다. 즉 **데이터베이스가 먼저 막는다.**
 * 소유자가 사라진 장부는 초대도 이름 바꾸기도 삭제도 할 수 없는, 아무도
 * 손댈 수 없는 장부가 되기 때문이다.
 *
 * 그래서 탈퇴 전에 두 가지로 나눈다.
 *
 *   나 혼자인 장부   → 함께 지운다. 아무의 기록도 아니므로 남길 이유가 없다.
 *   팀원이 있는 장부 → 막는다. 소유자를 넘기고 오라고 말한다. 이건 우리가
 *                      대신 정할 수 없다 — 누구에게 넘길지는 그 팀의 일이다.
 */

export type OwnedBook = {
  teamId: string;
  teamName: string;
  /**
   * 이 팀의 장부 하나. 소유자 넘기기는 장부 주소 아래의 '팀' 화면에 있어서,
   * 팀 번호만으로는 그리로 갈 수 없다. 장부가 여럿이면 아무거나 하나면 된다 —
   * 팀 화면은 어느 장부로 들어가든 같은 곳이다.
   */
  ledgerId: string | null;
  /** 나 말고 아직 명단에 있는 사람 수. 0이면 나 혼자다. */
  others: number;
};

export type AccountFacts = {
  /** 내가 소유한 장부들. 탈퇴 화면이 이걸로 판단한다. */
  owned: OwnedBook[];
  /** 내가 들어가 있는 팀 수 (소유 여부와 무관). */
  teams: number;
  /** 내 이름으로 적힌 지출 수. 탈퇴해도 남는 것들이다. */
  entries: number;
};

/** 이 계정에 무엇이 매달려 있는가. 판단하지 않고 세기만 한다. */
export async function accountFacts(userId: string): Promise<AccountFacts> {
  const [{ data: memberRows }, { data: ownedTeams }] = await Promise.all([
    db.from('members').select('id, team_id').eq('user_id', userId),
    db.from('teams').select('id, name').eq('owner_id', userId),
  ]);

  const myMemberIds = (memberRows ?? []).map((m) => m.id as string);
  const teams = new Set((memberRows ?? []).map((m) => m.team_id as string)).size;

  const owned: OwnedBook[] = await Promise.all(
    (ownedTeams ?? []).map(async (t) => {
      /* 나를 뺀 나머지가 몇인지 센다. '아직 명단에 있는 사람'만 센다 —
         나간 사람은 이 장부를 이어받을 수 없다. */
      const [{ count }, { data: book }] = await Promise.all([
        db
          .from('members')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', t.id as string)
          .eq('active', true)
          .not('user_id', 'is', null)
          .neq('user_id', userId),
        db.from('ledgers').select('id').eq('team_id', t.id as string).limit(1).maybeSingle(),
      ]);
      return {
        teamId: t.id as string,
        teamName: (t.name as string) ?? '',
        ledgerId: (book?.id as string) ?? null,
        others: count ?? 0,
      };
    }),
  );

  let entries = 0;
  if (myMemberIds.length > 0) {
    const { count } = await db
      .from('expenses')
      .select('id', { count: 'exact', head: true })
      .in('payer_member_id', myMemberIds);
    entries = count ?? 0;
  }

  return { owned, teams, entries };
}

/**
 * 계정을 지운다.
 *
 * 순서가 중요하다. 뒤에서부터 막히면 앞의 것만 지워진 반쪽 상태가 남는다.
 *
 *   1. 넘겨받을 사람이 있는 장부가 남아 있으면 **아무것도 하지 않고 돌려보낸다.**
 *   2. 나 혼자인 장부를 지운다. teams 를 지우면 members·ledgers·expenses 가
 *      함께 따라간다(on delete cascade).
 *   3. 내가 만든 초대 링크를 지운다. on delete restrict 라 남아 있으면
 *      프로필을 못 지운다.
 *   4. 프로필을 지운다. 이때 members.user_id 가 NULL 이 되고, 이름은 남는다.
 *   5. 로그인 계정(auth.users)을 지운다. 이게 진짜 '문을 닫는' 일이다.
 *
 * 5번이 실패해도 4번까지는 되돌리지 않는다. 프로필이 없는 로그인 계정은
 * 다시 들어와도 아무 장부에 닿지 못하는 빈 계정이라, 위험한 상태가 아니다.
 * 반대로 되돌렸다가 절반만 살아나는 쪽이 훨씬 나쁘다.
 */
export type WipeResult =
  | { ok: true; removedBooks: number }
  | { ok: false; blocked: OwnedBook[] };

export async function wipeAccount(userId: string): Promise<WipeResult> {
  const { owned } = await accountFacts(userId);

  const blocked = owned.filter((b) => b.others > 0);
  if (blocked.length > 0) return { ok: false, blocked };

  const alone = owned.filter((b) => b.others === 0);
  for (const b of alone) {
    await db.from('teams').delete().eq('id', b.teamId);
  }

  await db.from('invites').delete().eq('created_by', userId);
  await db.from('profiles').delete().eq('id', userId);

  // 여기서 실패해도 위는 이미 끝났다. 던지지 않고 조용히 넘어간다 —
  // 사람 쪽에서 보면 계정은 이미 아무 데도 닿지 못하는 상태다.
  try {
    await db.auth.admin.deleteUser(userId);
  } catch {
    /* 로그인 계정만 남는다. 프로필이 없어 아무 장부에도 닿지 못한다. */
  }

  return { ok: true, removedBooks: alone.length };
}
