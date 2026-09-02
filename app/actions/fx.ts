'use server';

import { requireLedgerAccess } from '../../lib/access.ts';
import { fxRate } from '../../lib/fx.ts';

/**
 * 환율 물어보기 (§21.14)
 *
 * 브라우저에서 바로 부르지 않고 서버를 거친다. 두 가지 때문이다 —
 * 밖으로 나가는 자리를 한 군데로 모아 두는 편이 낫고, 서버에서 부르면
 * 여러 사람이 물어도 한 번만 나갔다 온다(lib/fx.ts 의 보관).
 *
 * 이 장부를 볼 수 있는 사람만 부를 수 있다. 환율 자체는 비밀이 아니지만,
 * 우리 서버를 남의 환율 조회기로 쓰게 둘 이유도 없다.
 */
export async function lookUpRate(args: {
  ledgerId: string;
  from: string;
  to: string;
  date: string;
}): Promise<{ rate: number; on: string } | null> {
  await requireLedgerAccess(args.ledgerId);
  const r = await fxRate(args.from, args.to, args.date);
  return r ? { rate: r.rate, on: r.on } : null;
}
