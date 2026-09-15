import 'server-only';
import { createHash } from 'node:crypto';
import { db } from '../db/client.ts';
import { MobileError } from './http.ts';
import { appleConfig, createAppleClient, decryptAppleToken, encryptAppleToken, validateAppleSigningKey, type AppleConfig } from './apple-crypto.ts';

export type AppleCleanup = { status: 'not_required' | 'revoked' | 'manual_required' };
export type AppleGrant = { id: string; user_id: string; client_id: string; apple_subject: string | null; state: 'pending' | 'active' | 'uncertain' | 'revoked'; encrypted_token: string | null };
export type AppleGrantStore = {
  subjects(userId: string): Promise<string[]>;
  reserve(userId: string, clientId: string, codeHash: string): Promise<{ grant: AppleGrant; created: boolean }>;
  save(grant: AppleGrant, subject: string, encrypted: string): Promise<void>;
  uncertain(grant: AppleGrant): Promise<void>;
  freeze(userId: string): Promise<AppleGrant[]>;
  markRevoked(grant: AppleGrant): Promise<void>;
};
const storageError = () => new MobileError(503, 'APPLE_STORAGE_UNAVAILABLE', 'Apple 연결 정보를 보관하거나 확인하지 못했습니다. 다시 시도해 주세요.');
const contextOf = (grant: AppleGrant, subject = grant.apple_subject) => JSON.stringify(['chagok.apple.v1', grant.user_id, grant.client_id, subject, grant.id]);
export function createAppleAuthorizationService(store: AppleGrantStore, config: () => AppleConfig, client: (config: AppleConfig) => ReturnType<typeof createAppleClient> = createAppleClient) {
  return {
    async register(userId: string, code: string): Promise<void> {
      if (typeof code !== 'string' || !code || code.length > 4096 || /[\u0000-\u0020\u007f]/.test(code)) throw new MobileError(400, 'INVALID_INPUT', 'Apple 인증 코드를 확인해 주세요.');
      const settings = config();
      const subjects = await store.subjects(userId);
      if (!subjects.length) throw new MobileError(403, 'APPLE_IDENTITY_REQUIRED', '현재 계정에 Apple 로그인이 연결되어 있지 않습니다.');
      const { grant, created } = await store.reserve(userId, settings.clientId, createHash('sha256').update(code).digest('hex'));
      if (!created) {
        if (grant.state === 'active') return; // Retry after a lost HTTP response: do not consume the code twice.
        throw new MobileError(409, 'APPLE_REAUTH_REQUIRED', 'Apple 인증을 다시 진행해 주세요. 이전 요청을 확인할 수 없습니다.');
      }
      try {
        const result = await client(settings).exchange(code, subjects);
        const encrypted = encryptAppleToken(result.refreshToken, contextOf(grant, result.subject), settings);
        await store.save(grant, result.subject, encrypted);
      } catch (error) {
        // A timed-out code exchange can have succeeded at Apple. Preserve uncertainty,
        // never pretend the account has a revocable grant or retry a consumed code.
        await store.uncertain(grant).catch(() => {});
        throw error;
      }
    },
    async revoke(userId: string): Promise<AppleCleanup> {
      const subjects = await store.subjects(userId);
      const grants = await store.freeze(userId);
      if (!grants.length) return { status: subjects.length ? 'manual_required' : 'not_required' };
      const manual = grants.some(grant => grant.state === 'uncertain');
      const active = grants.filter(grant => grant.state === 'active');
      if (active.length) {
        const settings = config(), apple = client(settings);
        for (const grant of active) {
          if (!grant.encrypted_token || !grant.apple_subject || grant.client_id !== settings.clientId) throw storageError();
          const token = decryptAppleToken(grant.encrypted_token, contextOf(grant), settings);
          await apple.revoke(token);
          // Record only after Apple confirms. If this write fails, retry revocation;
          // Apple intentionally treats an already-invalid token as a successful request.
          await store.markRevoked(grant);
        }
      }
      return { status: manual ? 'manual_required' : 'revoked' };
    },
  };
}

const store: AppleGrantStore = {
  async subjects(userId) {
    const { data, error } = await db.auth.admin.getUserById(userId);
    if (error || !data.user) throw new MobileError(503, 'APPLE_ACCOUNT_UNAVAILABLE', '삭제할 계정의 인증 정보를 확인하지 못했습니다. 다시 시도해 주세요.');
    const identities = data.user.identities?.filter(identity => identity.provider === 'apple') ?? [];
    if (!identities.length && (data.user.app_metadata?.provider === 'apple' || data.user.app_metadata?.providers?.includes('apple'))) throw storageError();
    const subjects = identities.map(identity => identity.identity_data?.sub ?? identity.id);
    if (subjects.some(subject => typeof subject !== 'string' || !subject)) throw storageError();
    return subjects as string[];
  },
  async reserve(userId, clientId, codeHash) {
    const { data, error } = await db.rpc('reserve_apple_authorization', { p_user_id: userId, p_client_id: clientId, p_code_hash: codeHash });
    if (error) throw storageError();
    if (data?.blocked) throw new MobileError(409, 'ACCOUNT_DELETION_STARTED', '계정 삭제가 진행 중입니다. 새 로그인 연결을 저장할 수 없습니다.');
    if (!data?.grant?.id || typeof data.created !== 'boolean') throw storageError();
    return data as { grant: AppleGrant; created: boolean };
  },
  async save(grant, subject, encrypted) {
    const { data, error } = await db.rpc('complete_apple_authorization', { p_user_id: grant.user_id, p_grant_id: grant.id, p_subject: subject, p_encrypted_token: encrypted });
    if (error || data !== true) throw storageError();
  },
  async uncertain(grant) {
    const { error } = await db.from('apple_authorization_grants').update({ state: 'uncertain' }).eq('id', grant.id).eq('user_id', grant.user_id).eq('state', 'pending');
    if (error) throw storageError();
  },
  async freeze(userId) {
    const { data, error } = await db.rpc('freeze_apple_authorizations', { p_user_id: userId });
    if (error) throw storageError();
    if (data?.busy) throw new MobileError(409, 'APPLE_CONNECTION_IN_PROGRESS', 'Apple 로그인을 연결 중입니다. 잠시 후 계정 삭제를 다시 시도해 주세요.');
    if (!Array.isArray(data?.grants)) throw storageError();
    return data.grants as AppleGrant[];
  },
  async markRevoked(grant) {
    const { data, error } = await db.from('apple_authorization_grants').update({ state: 'revoked', encrypted_token: null, revoked_at: new Date().toISOString() }).eq('id', grant.id).eq('user_id', grant.user_id).eq('state', 'active').select('id');
    if (error || data?.length !== 1) throw storageError();
  },
};
const service = createAppleAuthorizationService(store, appleConfig);
export const registerAppleAuthorization = (userId: string, code: string) => service.register(userId, code);
export const revokeAppleForAccountDeletion = (userId: string) => service.revoke(userId);
export async function appleRevocationReady(): Promise<boolean> {
  try {
    await validateAppleSigningKey(appleConfig());
    const { data, error } = await db.rpc('apple_authorizations_ready');
    return !error && data === true;
  } catch { return false; }
}
