import { handleMobile } from '../../../../../lib/mobile/server.ts';
import { listMobileLedgers } from '../../../../../lib/mobile/data.ts';
import { aiReservationReady } from '../../../../../lib/db/repo.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handleMobile(request, async (user) => {
  const [ledgers, ai] = await Promise.all([listMobileLedgers(user), process.env.ANTHROPIC_API_KEY ? aiReservationReady() : Promise.resolve(false)]);
  return { ok: true, version: 1, user, ledgers, capabilities: { ai, entryIdempotency: true, serverTransferConfirmation: true } };
});
export const OPTIONS = GET;
