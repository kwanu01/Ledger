import { handleMobile, publicConfiguration } from '../../../../../lib/mobile/server.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => handleMobile(request, async () => publicConfiguration(), true);
export const OPTIONS = GET;
