import { useState } from 'react';
import { Button } from '@/components/BackofficeUi.js';
import type { BankLine, GlLine } from './contracts.js';
import type { BankPostPreset } from './BankPostDialog.js';
import { bankMoney, decimalCents, decimalText } from './money.js';
import { formatRate, proposeSettlements, proposeTransferFees, standaloneFeeLines } from './groupSuggestions.js';
import { useBankClearingDays } from './useBankQueries.js';

export interface GroupPost { preset: BankPostPreset; bankLines: BankLine[]; glLines: GlLine[] }
type Tab = 'settlements' | 'transfers' | 'fees';
const CHANNEL: Record<string, string> = { '1115': 'QRIS', '1116': 'Card (EDC)' };

/** Propositions groupées : chaque bouton ouvre le formulaire pré-rempli, rien n'est posté sans PIN. */
export function BankGroupSuggestions({ reconciliationId, bankLines, glLines, allLoaded, canPost, busy, onPost }: {
  reconciliationId: string; bankLines: BankLine[]; glLines: GlLine[]; allLoaded: boolean; canPost: boolean;
  /** Rechargement en cours : les boutons attendent, le panneau garde son onglet. */
  busy: boolean; onPost: (group: GroupPost) => void;
}) {
  const days = useBankClearingDays(reconciliationId, canPost);
  const settlements = proposeSettlements(bankLines, days.data ?? []);
  const tooLarge = (days.data ?? []).filter((d) => d.line_ids === null);
  const transfers = proposeTransferFees(bankLines, glLines);
  const fees = standaloneFeeLines(bankLines, glLines, new Set(transfers.flatMap((t) => [t.payment.id, t.feeLine.id])));
  const feeTotal = fees.reduce((sum, line) => sum + decimalCents(line.amount), 0n);
  const counts: Record<Tab, number> = { settlements: settlements.length, transfers: transfers.length, fees: fees.length };
  const [tab, setTab] = useState<Tab>('settlements');
  if (!canPost) return null;
  const tabs: [Tab, string][] = [['settlements', 'Card / QRIS payouts'], ['transfers', 'Transfers with fees'], ['fees', 'Bank charges']];
  return <section aria-label="Grouped reconciliation" className="space-y-3 rounded border border-border-subtle bg-bg-elevated p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="font-medium">Grouped reconciliation</h2>
      <p className="text-xs text-text-secondary">{allLoaded ? 'Built from every statement line.' : 'Built from loaded lines. Load all lines to see every proposal.'}</p>
    </div>
    <div role="tablist" aria-label="Proposal type" className="flex flex-wrap gap-2">
      {tabs.map(([key, label]) => <Button key={key} role="tab" aria-selected={tab === key} variant={tab === key ? 'primary' : 'secondary'} size="sm"
        onClick={() => setTab(key)}>{label} ({counts[key]})</Button>)}
    </div>
    {tab === 'settlements' && <div role="tabpanel" className="space-y-2">
      <p className="text-sm text-text-secondary">Each payout is matched with one day of card or QRIS sales. The difference is the bank fee (MDR).</p>
      {days.isLoading && <p role="status">Loading sales clearing…</p>}
      {days.error && <p role="alert" className="text-sm text-danger">{days.error.message}<Button variant="secondary" onClick={() => { void days.refetch(); }}>Retry</Button></p>}
      {!days.isLoading && !days.error && settlements.length === 0 && <p className="text-sm">No payout matches a day of sales with a fee under 5%.</p>}
      {tooLarge.length > 0 && <p className="text-sm text-warning">{tooLarge.map((d) => `${CHANNEL[d.account_code] ?? d.account_code} ${d.entry_date}`).join(', ')}: more than 1,000 payments in one day. Use Settlement / fees to split it.</p>}
      <ul className="divide-y divide-border-subtle">{settlements.map((s) => {
        const channel = CHANNEL[s.day.account_code] ?? s.day.account_code;
        return <li key={s.bankLine.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
          <div className="min-w-0"><p><span className="font-medium">{channel}</span> · sales of {s.day.entry_date} ({s.day.line_count} payments) → paid {s.bankLine.transaction_date}</p>
            <p className="text-text-secondary"><span className="font-data">{bankMoney(s.day.gross)}</span> sales − <span className="font-data">{bankMoney(s.fee)}</span> fee ({formatRate(s.rateBasisPoints)}) = <span className="font-data">{bankMoney(s.bankLine.amount)}</span> received</p>
            {s.ambiguous && <p className="text-warning">Another sales day also fits this amount. Check the date before posting.</p>}</div>
          <Button variant="secondary" disabled={busy} onClick={() => onPost({ bankLines: [s.bankLine], glLines: [], preset: { kind: 'settlement', clearingIds: s.day.line_ids ?? [], clearingGross: s.day.gross,
            clearingLabel: `${channel} sales of ${s.day.entry_date}`, description: `${channel} payout ${s.bankLine.transaction_date} for sales of ${s.day.entry_date}` } })}>Review payout</Button>
        </li>;
      })}</ul>
    </div>}
    {tab === 'transfers' && <div role="tabpanel" className="space-y-2">
      <p className="text-sm text-text-secondary">An outgoing transfer next to its transfer fee line on the same day. Both are matched with the existing payment entry, and only the fee is posted.</p>
      {transfers.length === 0 && <p className="text-sm">No transfer with a separate fee line among the loaded lines.</p>}
      <ul className="divide-y divide-border-subtle">{transfers.map((t) => <li key={t.payment.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
        <div className="min-w-0"><p className="break-words">{t.payment.transaction_date} · {t.payment.description.replace(/"/g, '') || 'Transfer'}</p>
          <p className="text-text-secondary"><span className="font-data">{bankMoney(t.payment.amount)}</span> payment ({t.gl.entry_number}) + <span className="font-data">{bankMoney(t.fee)}</span> fee</p></div>
        <Button variant="secondary" disabled={busy} onClick={() => onPost({ bankLines: [t.payment, t.feeLine], glLines: [t.gl],
          preset: { kind: 'net_fee', description: `Transfer fee ${t.payment.transaction_date} · ${t.gl.entry_number}` } })}>Review transfer</Button>
      </li>)}</ul>
    </div>}
    {tab === 'fees' && <div role="tabpanel" className="space-y-2">
      <p className="text-sm text-text-secondary">Small bank debits with no description or a fee label, and no ledger entry. They are posted together as one bank charges entry.</p>
      {fees.length === 0 ? <p className="text-sm">No standalone bank charges.</p> : <>
        <p className="text-sm">{fees.length} lines · total <span className="font-data">{bankMoney(decimalText(feeTotal))}</span></p>
        <ul className="max-h-48 overflow-auto text-xs text-text-secondary">{fees.map((l) => <li key={l.id}>{l.transaction_date} · <span className="font-data">{bankMoney(l.amount)}</span> · {l.description.replace(/"/g, '') || 'No description'}</li>)}</ul>
        <Button variant="secondary" disabled={busy || fees.length > 1000} onClick={() => onPost({ bankLines: fees, glLines: [],
          preset: { kind: 'fee', description: `Bank charges ${fees[0]!.transaction_date} to ${fees.at(-1)!.transaction_date}` } })}>Review bank charges</Button>
      </>}
    </div>}
  </section>;
}
