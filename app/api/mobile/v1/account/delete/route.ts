import { handleMobile } from '../../../../../../lib/mobile/server.ts';
import { MobileError, readJson } from '../../../../../../lib/mobile/http.ts';
import { object, uuid } from '../../../../../../lib/mobile/validation.ts';
import { wipeAccount } from '../../../../../../lib/db/account.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => handleMobile(request, async user => {
  const input = object(await readJson(request), ['confirm', 'expectedUserId']);
  if (input.confirm !== 'delete-account') throw new MobileError(400, 'CONFIRMATION_REQUIRED', '삭제 안내를 확인해 주세요.');
  if (uuid(input.expectedUserId) !== user.id)
    throw new MobileError(409, 'ACCOUNT_CHANGED', '로그인한 계정이 바뀌었습니다. 삭제 안내를 다시 확인해 주세요.');
  const result = await wipeAccount(user.id);
  return { ok: true, value: result.ok
    ? { done: true, removedBooks: result.removedBooks, ...('appleCleanup' in result ? { appleCleanup: result.appleCleanup } : {}) }
    : { done: false, blocked: result.blocked } };
});
export const OPTIONS = POST;
