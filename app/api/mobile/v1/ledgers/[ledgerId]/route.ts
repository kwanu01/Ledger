import { handleMobile } from '../../../../../../lib/mobile/server.ts';
import { mobileLedger } from '../../../../../../lib/mobile/data.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ ledgerId: string }> };
export const GET = (request: Request, context: Context) => handleMobile(request, async () => mobileLedger((await context.params).ledgerId));
export const OPTIONS = GET;
