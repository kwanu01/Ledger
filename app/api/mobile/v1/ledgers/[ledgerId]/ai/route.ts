import { handleMobile } from '../../../../../../../lib/mobile/server.ts';
import { dispatchAI, dispatchReceipt } from '../../../../../../../lib/mobile/actions.ts';
import { readJson, readMultipart } from '../../../../../../../lib/mobile/http.ts';
import { envelope } from '../../../../../../../lib/mobile/validation.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
type Context = { params: Promise<{ ledgerId: string }> };
export const POST = (request: Request, context: Context) => handleMobile(request, async () => {
  const { ledgerId } = await context.params;
  if (request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data'))
    return dispatchReceipt(ledgerId, await readMultipart(request));
  const { action, input } = envelope(await readJson(request));
  return dispatchAI(ledgerId, action, input);
});
export const OPTIONS = POST;
