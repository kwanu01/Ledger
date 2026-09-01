import { getLang } from '../../../../lib/lang.ts';
import LedgerShell from '../LedgerShell.tsx';
import { imageSrc } from '../../../../lib/img.ts';
import AdSlot from '../../../AdSlot.tsx';
import GoodsGrid, { type Good } from './Goods.tsx';
import { requireLedgerAccess } from '../../../../lib/access.ts';
import { loadLedger } from '../../../../lib/db/repo.ts';
import { effectiveAmount, nameOf } from '../../../../lib/domain/settlement.ts';
import { allocationLabel } from '../../../../lib/labels.ts';
import { translator } from '../../../../lib/i18n.ts';
import type { CurrencyCode } from '../../../../lib/domain/money.ts';

/**
 * 품목 (§21.6)
 *
 * 장부가 숫자의 목록이라면 여기는 산 물건의 목록이다. 같은 것을 두 번 샀으면
 * 그렇다고 적어 둔다. 다음 팀이 이 장부를 열었을 때 쓸모 있는 건 그런 쪽이다.
 *
 * 금액이 오가는 화면이 아니므로 광고를 여기에 둔다.
 */
export default async function Goods({ params }: { params: Promise<{ ledgerId: string }> }) {
  const { ledgerId } = await params;
  const pass = await requireLedgerAccess(ledgerId);
  const lang = await getLang();
  const ledger = await loadLedger(ledgerId);
  const currency: CurrencyCode = ledger.currency ?? 'KRW';
  const T = translator(lang);

  // 보정과 환불은 물건이 아니라 정정이다. 목록에서 뺀다.
  const list = [...ledger.expenses].filter((e) => !e.adjustment);

  // 전표 번호는 장부와 같은 번호여야 한다. 그래야 여기서 본 물건을 장부에서
  // 다시 찾을 수 있다. 그래서 보정·환불까지 포함한 시간 순서로 매긴다.
  const slips = new Map<string, string>();
  [...ledger.expenses]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1))
    .forEach((e, i) => slips.set(e.id, String(i + 1).padStart(3, '0')));

  const counts = new Map<string, number>();
  for (const e of list) {
    const k = e.productLink || e.title;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const items: Good[] = list.map((e) => ({
    id: e.id,
    slip: slips.get(e.id) ?? '',
    title: e.title,
    date: e.date,
    amount: e.amount,
    effective: effectiveAmount(ledger.expenses, e),
    payer: nameOf(ledger.members, e.payerId),
    bears: allocationLabel(e, ledger.members, lang),
    category: e.category || T('etc'),
    vendor: e.vendor,
    productLink: e.productLink,
    image: firstImage(ledgerId, e.representativeImage ?? e.receiptImage),
    dup: (counts.get(e.productLink || e.title) ?? 0) > 1,
  }));

  return (
    <main>
      <LedgerShell
        ledgerId={ledgerId}
        teamName={ledger.teamName}
        bookName={ledger.name}
        who={pass.memberName}
        current="/goods"
        lang={lang}
        signedIn={Boolean(pass.userId)}
      />

      {items.length === 0 ? (
        <section>
          <div className="empty faint">{T('none')}</div>
        </section>
      ) : (
        <GoodsGrid items={items} currency={currency} lang={lang} />
      )}

      <AdSlot />
    </main>
  );
}

/** 저장소 경로가 있으면 화면이 쓸 주소로 바꾼다. 없으면 그대로 비운다. */
function firstImage(ledgerId: string, path?: string) {
  return path ? imageSrc(ledgerId, path) : undefined;
}
