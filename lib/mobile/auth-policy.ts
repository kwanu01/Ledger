/** Shared by web requests and the mobile API. A supplied credential never falls back. */
export class AuthenticationError extends Error {
  constructor(message = '로그인이 만료되었습니다. 다시 연결해 주세요.') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export function bearerToken(header: string | null, required = false): string | null {
  if (header === null) {
    if (required) throw new AuthenticationError('로그인이 필요합니다.');
    return null;
  }
  const match = /^Bearer ([A-Za-z0-9._~+\/-]+=*)$/i.exec(header);
  if (!match || match[1].length > 8192) throw new AuthenticationError();
  return match[1];
}

export async function resolveRequestUser<T>(
  authorization: string | null,
  verifyToken: (token: string) => Promise<T | null>,
  readCookieUser: () => Promise<T | null>,
): Promise<T | null> {
  const token = bearerToken(authorization);
  if (token === null) return readCookieUser();
  const user = await verifyToken(token);
  if (!user) throw new AuthenticationError();
  return user;
}

/** Account identity wins even when that account does not belong to this team. */
export async function resolveLedgerIdentity<T>(
  signedIn: boolean,
  accountMember: () => Promise<T | null>,
  anonymousMember: () => Promise<T | null>,
): Promise<T | null> {
  return signedIn ? accountMember() : anonymousMember();
}

export function anonymousMemberIsAvailable(member: { active: boolean; user_id: string | null } | null): boolean {
  return !!member?.active && member.user_id === null;
}
