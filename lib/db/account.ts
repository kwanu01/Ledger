import 'server-only';
import { db } from './client.ts';
import { revokeAppleForAccountDeletion } from '../mobile/apple.ts';
import { assertAccountImageCleanupReady, cleanupAccountImages } from './images.ts';

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
 *   남는 것     — 공동 장부의 지출·정산과 금액 계산에 필요한 팀원 식별자.
 *                 이름은 '탈퇴한 팀원', 은행·계좌번호는 NULL로 바꾼다.
 *
 * members.account_deleted_at은 영구 접근 회수 상태다. user_id가 NULL이 되어도
 * 게스트로 바뀌지 않으며, 이름 변경·재활성화·재연결은 DB가 거절한다.
 * 검증된 단독 작성자/업로더 증거가 있는 자유 입력·첨부는 삭제 marker의
 * 트리거와 파일 queue가 정리한다. 과거·공동편집·귀속 불명 콘텐츠는 임의
 * 삭제하지 않는다. checks/CONTENT-OWNERSHIP.md의 범위와 한계를 따른다.
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

const READ_FAILED = '계정 정보를 확인하지 못했습니다. 잠시 뒤에 다시 시도해 주세요.';

/** A partial response must never be mistaken for the account's complete ownership graph. */
function completeRows<T>(result: { data: T[] | null; count: number | null; error: unknown }): T[] {
  if (result.error || !Array.isArray(result.data) || !Number.isSafeInteger(result.count)
      || result.data.length !== result.count) throw new Error(READ_FAILED);
  return result.data;
}

function exactCount(result: { count: number | null; error: unknown }): number {
  if (result.error || typeof result.count !== 'number' || !Number.isSafeInteger(result.count)
      || result.count < 0) throw new Error(READ_FAILED);
  return result.count;
}

/** 이 계정에 무엇이 매달려 있는가. 판단하지 않고 세기만 한다. */
export async function accountFacts(userId: string): Promise<AccountFacts> {
  const [membership, ownership] = await Promise.all([
    db.from('members').select('id, team_id, account_deleted_at', { count: 'exact' }).eq('user_id', userId),
    db.from('teams').select('id, name', { count: 'exact' }).eq('owner_id', userId),
  ]);
  const memberRows = completeRows(membership);
  const ownedTeams = completeRows(ownership);

  const myMemberIds = memberRows.map((m) => m.id as string);
  const teams = new Set(memberRows.map((m) => m.team_id as string)).size;

  const owned: OwnedBook[] = await Promise.all(
    ownedTeams.map(async (t) => {
      /* 나를 뺀 나머지가 몇인지 센다. '아직 명단에 있는 사람'만 센다 —
         나간 사람은 이 장부를 이어받을 수 없다. */
      const [otherMembers, firstBook] = await Promise.all([
        db
          .from('members')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', t.id as string)
          .eq('active', true)
          .not('user_id', 'is', null)
          .neq('user_id', userId),
        db.from('ledgers').select('id').eq('team_id', t.id as string).limit(1).maybeSingle(),
      ]);
      const others = exactCount(otherMembers);
      if (firstBook.error) throw new Error(READ_FAILED);
      return {
        teamId: t.id as string,
        teamName: (t.name as string) ?? '',
        ledgerId: (firstBook.data?.id as string) ?? null,
        others,
      };
    }),
  );

  let entries = 0;
  if (myMemberIds.length > 0) {
    const entryCount = await db
      .from('expenses')
      .select('id', { count: 'exact', head: true })
      .in('payer_member_id', myMemberIds);
    entries = exactCount(entryCount);
  }

  return { owned, teams, entries };
}

/**
 * 계정을 지운다.
 *
 * 소유권·사진 정리 준비 확인 → Apple 권한 해제 → DB 트랜잭션 → Storage 정리 → Auth 삭제.
 * RPC는 잠금 후 소유권을 다시 확인하고 DB 변경을 전부 성공시키거나 되돌린다.
 * 외부 Auth 실패 시 삭제 진행 marker가 프로필 재생성을 차단하며 재시도할 수 있다.
 * Auth 삭제 성공 시 marker는 FK cascade로 제거된다. Apple·Auth 외부 요청까지
 * 하나의 트랜잭션은 아니므로, 외부 실패를 성공으로 숨기지 않는다.
 */
export type WipeResult =
  | { ok: true; removedBooks: number; appleCleanup: 'not_required' | 'revoked' | 'manual_required' }
  | { ok: false; blocked: OwnedBook[] };

export async function wipeAccount(userId: string): Promise<WipeResult> {
  const { owned } = await accountFacts(userId);

  const blocked = owned.filter((b) => b.others > 0);
  if (blocked.length > 0) return { ok: false, blocked };

  await assertAccountImageCleanupReady();
  const apple = await revokeAppleForAccountDeletion(userId);
  const { data: removedBooks, error } = await db.rpc('wipe_account_data', { p_user_id: userId });
  if (error) throw new Error('계정 데이터를 삭제하지 못했습니다. 장부 소유권을 확인한 뒤 다시 시도해 주세요.');
  if (typeof removedBooks !== 'number' || !Number.isSafeInteger(removedBooks) || removedBooks < 0) {
    throw new Error('계정 삭제 결과를 확인하지 못했습니다. 다시 시도해 주세요.');
  }

  await cleanupAccountImages(userId);
  const { error: authError } = await db.auth.admin.deleteUser(userId);
  if (authError) throw new Error('로그인 계정을 삭제하지 못했습니다. 계정 삭제를 완료하지 못했습니다.');

  return { ok: true, removedBooks, appleCleanup: apple.status };
}
