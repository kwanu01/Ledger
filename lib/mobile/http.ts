import { AuthenticationError, bearerToken } from './auth-policy.ts';

export class MobileError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'MobileError';
    this.status = status;
    this.code = code;
  }
}

export function responseHeaders(request: Request, configuredOrigins: string[] = []): Headers {
  const headers = new Headers({
    'Cache-Control': 'private, no-store, max-age=0', Pragma: 'no-cache', Expires: '0',
    'X-Content-Type-Options': 'nosniff', Vary: 'Origin',
  });
  const origin = request.headers.get('origin');
  if (!origin) return headers;
  const allowed = new Set([
    new URL(request.url).origin,
    'http://localhost:8088', 'http://127.0.0.1:8088',
    ...configuredOrigins.map((value) => value.replace(/\/+$/, '')),
  ]);
  if (!allowed.has(origin)) throw new MobileError(403, 'ORIGIN_DENIED', '이 주소에서는 연결할 수 없습니다.');
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  // Bearer requests do not need cross-origin cookies or credential wildcards.
  return headers;
}

export function errorResponse(error: unknown, headers?: Headers): Response {
  const known = error instanceof MobileError || error instanceof AuthenticationError;
  const status = error instanceof AuthenticationError ? 401 : error instanceof MobileError ? error.status : 500;
  const code = error instanceof AuthenticationError ? 'UNAUTHORIZED' : error instanceof MobileError ? error.code : 'SERVER_ERROR';
  const safe = headers ?? new Headers({ 'Cache-Control': 'private, no-store', Vary: 'Origin' });
  if (status === 401) safe.set('WWW-Authenticate', 'Bearer');
  return Response.json({ ok: false, code, message: known ? error.message : '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status, headers: safe });
}

/** Auth runs before body parsing and before the route callback, including malformed requests. */
export function mobileHandler<User>(options: {
  origins?: string[];
  authenticate: () => Promise<User | null>;
  run: (user: User) => Promise<unknown>;
  public?: boolean;
}) {
  return async (request: Request): Promise<Response> => {
    let headers: Headers | undefined;
    try {
      headers = responseHeaders(request, options.origins);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      let user: User | null = null;
      if (!options.public) {
        bearerToken(request.headers.get('authorization'), true);
        user = await options.authenticate();
        if (!user) throw new AuthenticationError();
      }
      const result = await options.run(user as User);
      const failure = !!result && typeof result === 'object' && 'ok' in result && result.ok === false;
      return Response.json(failure ? { code: 'ACTION_REJECTED', ...result } : result, { status: failure ? 422 : 200, headers });
    } catch (error) {
      return errorResponse(error, headers);
    }
  };
}

export async function readBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const size = request.headers.get('content-length');
  if (size && (!/^\d+$/.test(size) || Number(size) > maxBytes))
    throw new MobileError(413, 'BODY_TOO_LARGE', '내용이 너무 큽니다. 크기를 줄여 주세요.');
  if (!request.body) throw new MobileError(400, 'INVALID_BODY', '요청 내용을 확인해 주세요.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new MobileError(413, 'BODY_TOO_LARGE', '내용이 너무 큽니다. 크기를 줄여 주세요.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function readJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? ''))
    throw new MobileError(415, 'INVALID_CONTENT_TYPE', 'JSON 형식으로 보내 주세요.');
  const body = await readBytes(request, 64 * 1024);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
  catch { throw new MobileError(400, 'INVALID_JSON', '요청 내용을 읽을 수 없습니다.'); }
}

export async function readMultipart(request: Request): Promise<FormData> {
  const type = request.headers.get('content-type') ?? '';
  if (!/^multipart\/form-data\s*;/i.test(type))
    throw new MobileError(415, 'INVALID_CONTENT_TYPE', '사진 파일을 첨부해 주세요.');
  const bytes = await readBytes(request, 4 * 1024 * 1024);
  try { return await new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': type } }).formData(); }
  catch { throw new MobileError(400, 'INVALID_FORM', '사진을 읽을 수 없습니다.'); }
}
