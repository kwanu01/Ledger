import { handleMobile } from '../../../../../../../lib/mobile/server.ts';
import { dispatchAction } from '../../../../../../../lib/mobile/actions.ts';
import { readJson } from '../../../../../../../lib/mobile/http.ts';
import { envelope } from '../../../../../../../lib/mobile/validation.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ ledgerId: string }> };
export const POST = (request: Request, context: Context) => handleMobile(request, async () => {
  const { action, input } = envelope(await readJson(request));
  return dispatchAction((await context.params).ledgerId, action, input);
});
export const OPTIONS = POST;
