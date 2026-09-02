'use server';

import { revalidatePath } from 'next/cache';
import { requireUser, clearPass } from '../../lib/access.ts';
import { accountFacts, wipeAccount, type AccountFacts, type OwnedBook } from '../../lib/db/account.ts';
import { failed } from '../../lib/fail.ts';

/**
 * 내 계정 (§21.15)
 *
 * 여기서 하는 일은 전부 **나에 대한 것**이다. 그래서 권한 판정이 한 줄이다 —
 * 로그인했는가. 다른 사람의 계정을 건드리는 길은 이 파일에 없다: userId 를
 * 밖에서 받지 않고 requireUser() 가 돌려준 것만 쓴다. 인자로 받으면 그 순간
 * 남의 계정을 지우는 길이 열린다.
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
  | { done: true; removedBooks: number }
  | { done: false; blocked: OwnedBook[] };

export async function withdraw(): Promise<Result<WithdrawOutcome>> {
  try {
    const user = await requireUser();
    const r = await wipeAccount(user.id);

    if (!r.ok) {
      // 막힌 것은 오류가 아니다. 무엇을 먼저 해야 하는지 알려 주는 대답이다.
      return { ok: true, value: { done: false, blocked: r.blocked } };
    }

    // 통행증도 함께 버린다. 계정이 없어졌는데 쿠키만 남아 있으면, 그 쿠키로
    // 장부에 들어가는 길이 잠깐이라도 열려 있게 된다.
    await clearPass();

    revalidatePath('/', 'layout');
    return { ok: true, value: { done: true, removedBooks: r.removedBooks } };
  } catch (e) {
    return failed(e);
  }
}
