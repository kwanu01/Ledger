import { handleMobile } from '../../../../../lib/mobile/server.ts';
import { accountFacts } from '../../../../../lib/db/account.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handleMobile(request, async user => ({
  ok: true, accountId: user.id, facts: await accountFacts(user.id),
}));
export const OPTIONS = GET;
