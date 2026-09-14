import { MobileError } from './http.ts';

/** Pure permission decision shared with route tests; the row must first be scoped to the URL ledger. */
export function transferDecision(
  transfer: { fromMemberId: string; toMemberId: string; sentAt?: string; receivedAt?: string },
  memberId: string,
  isOwner: boolean,
  operation: { action: 'markTransferSent'; undo?: boolean } | { action: 'markTransferReceived'; onBehalf?: boolean },
): 'write' | 'unchanged' {
  const forbidden = () => { throw new MobileError(403, 'ACTION_FORBIDDEN', '이 작업을 할 권한이 없습니다.'); };
  if (operation.action === 'markTransferSent') {
    if (transfer.fromMemberId !== memberId) return forbidden();
    if (operation.undo && transfer.receivedAt)
      throw new MobileError(409, 'ACTION_REJECTED', '입금이 확인되어 보낸 기록을 취소할 수 없습니다.');
    return !!transfer.sentAt === !operation.undo ? 'unchanged' : 'write';
  }
  if (operation.onBehalf ? !isOwner : transfer.toMemberId !== memberId) return forbidden();
  return transfer.receivedAt ? 'unchanged' : 'write';
}
