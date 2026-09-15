import { handleMobile } from '../../../../../../lib/mobile/server.ts';
import { readJson } from '../../../../../../lib/mobile/http.ts';
import { object, text } from '../../../../../../lib/mobile/validation.ts';
import { registerAppleAuthorization } from '../../../../../../lib/mobile/apple.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = (request: Request) => handleMobile(request, async user => {
  const body = object(await readJson(request), ['authorizationCode']);
  await registerAppleAuthorization(user.id, text(body.authorizationCode, 4096));
  return { ok: true };
});
export const OPTIONS = POST;
