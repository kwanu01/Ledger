import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTVerifyGetKey } from 'jose';
import { MobileError } from './http.ts';

export type AppleConfig = { clientId: string; teamId: string; keyId: string; privateKey: string; activeKeyId: string; encryptionKeys: Record<string, Buffer> };
const unavailable = () => new MobileError(503, 'APPLE_NOT_CONFIGURED', 'Apple 계정 연결을 준비하고 있습니다. 다른 로그인 방법을 이용해 주세요.');
export function appleConfig(env: Record<string, string | undefined> = process.env): AppleConfig {
  try {
    const clientId = env.APPLE_CLIENT_ID ?? '';
    const teamId = env.APPLE_TEAM_ID ?? '', keyId = env.APPLE_KEY_ID ?? '';
    const privateKey = (env.APPLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
    const activeKeyId = env.APPLE_TOKEN_ACTIVE_KEY_ID ?? '';
    const encoded: unknown = JSON.parse(env.APPLE_TOKEN_ENCRYPTION_KEYS ?? '{}');
    if (clientId !== 'net.teamledger.app' || !/^[A-Z0-9]{10}$/.test(teamId) || !/^[A-Z0-9]{10}$/.test(keyId) ||
      !privateKey.startsWith('-----BEGIN PRIVATE KEY-----') || !encoded || typeof encoded !== 'object' || Array.isArray(encoded)) throw unavailable();
    const encryptionKeys: Record<string, Buffer> = {};
    for (const [name, value] of Object.entries(encoded)) {
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(name) || typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw unavailable();
      const key = Buffer.from(value, 'base64');
      if (key.length !== 32 || key.toString('base64') !== value) throw unavailable();
      encryptionKeys[name] = key;
    }
    if (!Object.hasOwn(encryptionKeys, activeKeyId) || Object.keys(encryptionKeys).length > 8) throw unavailable();
    return { clientId, teamId, keyId, privateKey, activeKeyId, encryptionKeys };
  } catch { throw unavailable(); }
}
export async function validateAppleSigningKey(config: AppleConfig) {
  try { await importPKCS8(config.privateKey, 'ES256'); } catch { throw unavailable(); }
}
export function encryptAppleToken(token: string, context: string, config: AppleConfig): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.encryptionKeys[config.activeKeyId], iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', config.activeKeyId, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}
export function decryptAppleToken(envelope: string, context: string, config: AppleConfig): string {
  try {
    const [version, keyId, encodedIv, encodedTag, encodedValue, extra] = envelope.split('.');
    if (version !== 'v1' || extra || !Object.hasOwn(config.encryptionKeys, keyId) || ![encodedIv, encodedTag, encodedValue].every(value => /^[A-Za-z0-9_-]+$/.test(value))) throw new Error();
    const iv = Buffer.from(encodedIv, 'base64url'), tag = Buffer.from(encodedTag, 'base64url');
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', config.encryptionKeys[keyId], iv);
    decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(encodedValue, 'base64url')), decipher.final()]).toString('utf8');
  } catch { throw new MobileError(503, 'APPLE_TOKEN_UNAVAILABLE', 'Apple 연결 정보를 안전하게 읽지 못했습니다. 삭제는 완료되지 않았습니다.'); }
}
const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'), { timeoutDuration: 10000 });
export function createAppleClient(config: AppleConfig, request: typeof fetch = fetch, getKey: JWTVerifyGetKey = appleKeys) {
  const secret = async () => {
    try {
      const key = await importPKCS8(config.privateKey, 'ES256');
      return await new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: config.keyId }).setIssuer(config.teamId)
        .setSubject(config.clientId).setAudience('https://appleid.apple.com').setIssuedAt().setExpirationTime('5m').sign(key);
    } catch { throw unavailable(); }
  };
  const post = async (path: 'token' | 'revoke', fields: Record<string, string>) => {
    const body = new URLSearchParams({ client_id: config.clientId, client_secret: await secret(), ...fields });
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await request(`https://appleid.apple.com/auth/${path}`, { method: 'POST', body, signal: controller.signal,
        redirect: 'error', credentials: 'omit', cache: 'no-store', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } });
      const text = await response.text();
      if (text.length > 65536) throw new Error();
      return { status: response.status, ok: response.ok, text };
    } catch { throw new MobileError(503, 'APPLE_UNAVAILABLE', 'Apple 연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
    finally { clearTimeout(timeout); }
  };
  return {
    async exchange(code: string, subjects: readonly string[]): Promise<{ subject: string; refreshToken: string }> {
      const response = await post('token', { code, grant_type: 'authorization_code' });
      if (!response.ok) throw new MobileError(422, 'APPLE_REAUTH_REQUIRED', 'Apple 로그인을 다시 진행해 주세요. 인증 코드는 한 번만 사용할 수 있습니다.');
      let data: unknown;
      try { data = JSON.parse(response.text); } catch { throw new MobileError(503, 'APPLE_INVALID_RESPONSE', 'Apple 인증 응답을 확인하지 못했습니다. 다시 로그인해 주세요.'); }
      if (!data || typeof data !== 'object' || !('id_token' in data) || typeof data.id_token !== 'string' || !('refresh_token' in data) || typeof data.refresh_token !== 'string' || !data.refresh_token || data.refresh_token.length > 16384)
        throw new MobileError(503, 'APPLE_INVALID_RESPONSE', 'Apple 연결 정보를 받지 못했습니다. 다시 로그인해 주세요.');
      try {
        const { payload } = await jwtVerify(data.id_token, getKey, { algorithms: ['RS256'], issuer: 'https://appleid.apple.com', audience: config.clientId, requiredClaims: ['sub', 'exp', 'iat'], maxTokenAge: '10m', clockTolerance: 5 });
        if (typeof payload.sub !== 'string' || !subjects.includes(payload.sub)) throw new Error();
        return { subject: payload.sub, refreshToken: data.refresh_token };
      } catch { throw new MobileError(403, 'APPLE_IDENTITY_MISMATCH', '현재 계정과 Apple 인증 정보가 일치하지 않습니다. 같은 계정으로 다시 로그인해 주세요.'); }
    },
    async revoke(token: string): Promise<void> {
      const response = await post('revoke', { token, token_type_hint: 'refresh_token' });
      // Apple's 200 response deliberately does not distinguish already-invalid tokens.
      if (response.status !== 200) throw new MobileError(503, 'APPLE_REVOCATION_FAILED', 'Apple 연결 해제를 확인하지 못했습니다. 삭제는 완료되지 않았습니다. 다시 시도해 주세요.');
    },
  };
}
