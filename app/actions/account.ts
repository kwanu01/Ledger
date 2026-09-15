'use server';

import { revalidatePath } from 'next/cache';
import { requireUser, clearPass } from '../../lib/access.ts';
import { accountFacts, wipeAccount, type AccountFacts, type OwnedBook } from '../../lib/db/account.ts';
import { failed } from '../../lib/fail.ts';

/**
 * 내 계정 (§21.15)
 *
 * 여기서 하는 일은 전부 **나에 대한 것**이다. 그래서 권한 판정이 한 줄이다 —
 * 로그인했는가. 삭제 대상은 requireUser()가 검증한 계정으로만 정한다.
 * 화면의 expectedUserId는 권한이 아니라, 다른 탭에서 계정이 바뀌었을 때
 * 이전 화면이 새 계정을 지우지 못하도록 비교하는 확인값이다.
 */

type Result<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; value: T })
  | { ok: false; message: string };

export async function myAccountFacts(): Promise<Result<AccountFacts>> {
  try {
    const user = await requireUser();
    return { ok: true, value: await accountFacts(user.id) };
  } catch (e) {
    return failed(e);
  }
}

export type WithdrawOutcome =
  | { done: true; removedBooks: number; appleCleanup?: 'not_required' | 'revoked' | 'manual_required' }
  | { done: false; blocked: OwnedBook[] };

export async function withdraw(expectedUserId: string): Promise<Result<WithdrawOutcome>> {
  try {
    const user = await requireUser();
    if (typeof expectedUserId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expectedUserId)
        || expectedUserId !== user.id) {
      return { ok: false, message: '로그인한 계정이 바뀌었거나 확인할 수 없습니다. 계정 화면을 새로 열어 주세요.' };
    }
    const r = await wipeAccount(user.id);

    if (!r.ok) {
      // 막힌 것은 오류가 아니다. 무엇을 먼저 해야 하는지 알려 주는 대답이다.
      return { ok: true, value: { done: false, blocked: r.blocked } };
    }

    // 통행증도 함께 버린다. 계정이 없어졌는데 쿠키만 남아 있으면, 그 쿠키로
    // 장부에 들어가는 길이 잠깐이라도 열려 있게 된다.
    await clearPass();

    revalidatePath('/', 'layout');
    return { ok: true, value: { done: true, removedBooks: r.removedBooks, ...('appleCleanup' in r ? { appleCleanup: r.appleCleanup } : {}) } };
  } catch (e) {
    return failed(e);
  }
}
