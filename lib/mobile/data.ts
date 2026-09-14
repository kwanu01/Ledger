import 'server-only';
import type { AuthUser } from '../auth-client.ts';
import { db } from '../db/client.ts';
import { loadLedger } from '../db/repo.ts';
import { MobileError } from './http.ts';
import { mobileAccess } from './server.ts';

export async function listMobileLedgers(user: AuthUser) {
  const { data: memberships, error, count: membershipCount } = await db.from('members').select('team_id, active', { count: 'exact' }).eq('user_id', user.id);
  if (error || !memberships || membershipCount !== memberships.length) throw new Error('Membership query incomplete');
  const teamIds = [...new Set(memberships.map((member) => member.team_id as string))];
  if (teamIds.length === 0) return [];
  const { data: ledgers, error: ledgerError, count: ledgerCount } = await db.from('ledgers')
    .select('id, name, currency, archived_at, team_id, teams(name, owner_id)', { count: 'exact' }).in('team_id', teamIds).order('created_at');
  if (ledgerError || !ledgers || ledgerCount !== ledgers.length) throw new Error('Ledger list query incomplete');
  return ledgers.flatMap((ledger) => {
    const team = (Array.isArray(ledger.teams) ? ledger.teams[0] : ledger.teams) as { name: string; owner_id: string } | null;
    if (!team) throw new Error('Team missing');
    const isOwner = team.owner_id === user.id;
    if (!isOwner && !memberships.some((member) => member.team_id === ledger.team_id && member.active)) return [];
    return [{ id: ledger.id as string, title: ledger.name as string, teamId: ledger.team_id as string,
      teamName: team.name, currency: (ledger.currency as string) ?? 'KRW', archivedAt: (ledger.archived_at as string | null) ?? null, isOwner }];
  });
}

export type MobileTransfer = {
  id: string; settlementId: string; fromMemberId: string; toMemberId: string;
  sentAt?: string; receivedAt?: string; sentByMemberId?: string; receivedByMemberId?: string;
};
type TransferRow = {
  id: string; settlement_id: string; from_member_id: string; to_member_id: string;
  sent_at: string | null; confirmed_at: string | null; sent_by_member_id: string | null; confirmed_by_member_id: string | null;
};
const transferSelect = 'id, settlement_id, from_member_id, to_member_id, sent_at, confirmed_at, sent_by_member_id, confirmed_by_member_id, settlements!inner(ledger_id)';
const toTransfer = (row: TransferRow): MobileTransfer => ({
  id: row.id, settlementId: row.settlement_id, fromMemberId: row.from_member_id, toMemberId: row.to_member_id,
  sentAt: row.sent_at ?? undefined, receivedAt: row.confirmed_at ?? undefined,
  sentByMemberId: row.sent_by_member_id ?? undefined, receivedByMemberId: row.confirmed_by_member_id ?? undefined,
});

export async function transferStatuses(ledgerId: string): Promise<Record<string, MobileTransfer>> {
  const { data, error, count } = await db.from('transfers').select(transferSelect, { count: 'exact' }).eq('settlements.ledger_id', ledgerId);
  if (error || !data || count !== data.length) throw new Error('Transfer query incomplete');
  return Object.fromEntries(data.map((row) => [JSON.stringify([row.settlement_id, row.from_member_id, row.to_member_id]), toTransfer(row)]));
}

export async function scopedTransfer(ledgerId: string, transferId: string): Promise<MobileTransfer> {
  const { data, error } = await db.from('transfers').select(transferSelect)
    .eq('settlements.ledger_id', ledgerId).eq('id', transferId).maybeSingle();
  if (error) throw new Error('Transfer query failed');
  if (!data) throw new MobileError(404, 'TRANSFER_NOT_FOUND', '이 장부의 송금을 찾을 수 없습니다.');
  return toTransfer(data);
}

export async function mobileLedger(id: string) {
  const access = await mobileAccess(id);
  const [ledger, statuses] = await Promise.all([loadLedger(access.ledgerId), transferStatuses(access.ledgerId)]);
  return { ok: true, ledger, memberId: access.pass.memberId, isOwner: access.isOwner, transferStatuses: statuses };
}
