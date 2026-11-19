import { useState, type ReactNode } from 'react';
import { Button } from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import type { BankLine, GlLine } from './contracts.js';
import type { BankPostPreset } from './BankPostDialog.js';
import { BANK_LABEL, BANK_TD, BANK_TH } from './bankUi.js';
import { bankMoney, decimalCents, decimalText } from './money.js';
import { formatRate, proposeSettlements, proposeTransferFees, standaloneFeeLines } from './groupSuggestions.js';
import { useBankClearingDays } from './useBankQueries.js';

export interface GroupPost { preset: BankPostPreset; bankLines: BankLine[]; glLines: GlLine[] }
type Tab = 'settlements' | 'transfers' | 'fees';
const CHANNEL: Record<string, string> = { '1115': 'QRIS', '1116': 'Card (EDC)' };
const clean = (text: string) => text.replace(/"/g, '').trim();
const NUM = `${BANK_TD} whitespace-nowrap text-right font-data tabular-nums`;

function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[40rem] text-sm"><thead><tr>{head}</tr></thead><tbody>{children}</tbody></table></div>;
}
const Th = ({ children, right }: { children?: ReactNode; right?: boolean }) => <th scope="col" className={`${BANK_TH} ${right ? 'text-right' : ''}`}>{children}</th>;

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
  const intro: Record<Tab, string> = {
    settlements: 'Each payout is paired with one day of card or QRIS sales. The gap is the bank fee (MDR).',
    transfers: 'An outgoing transfer and the fee line next to it, matched with the payment entry. Only the fee is posted.',
    fees: 'Small debits with no ledger entry, posted together as one bank charges entry.',
  };
  return <section aria-label="Grouped reconciliation" className="overflow-hidden rounded-md border border-border-subtle bg-bg-elevated">
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3.5">
      <h2 className="text-lg font-medium tracking-tight">Grouped reconciliation</h2>
      <p className="text-xs text-text-muted">{allLoaded ? 'Built from every statement line.' : 'Built from loaded lines only.'}</p>
    </div>
    <div role="tablist" aria-label="Proposal type" className="mt-2 flex gap-5 overflow-x-auto overflow-y-hidden border-b border-border-subtle px-4">
      {tabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
        className={`-mb-px flex h-10 shrink-0 items-center gap-2 border-b-2 text-sm font-medium transition-colors ${FOCUS_RING} ${tab === key ? 'border-gold text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
        {label}<span className={`rounded-sm px-1.5 font-data text-xs tabular-nums ${counts[key] > 0 ? 'bg-surface-4 text-text-primary' : 'text-text-muted'}`}>{counts[key]}</span></button>)}
    </div>
    <div role="tabpanel" aria-label={tabs.find(([key]) => key === tab)![1]}>
      <p className="px-4 py-2.5 text-sm text-text-secondary">{intro[tab]}</p>
      {tab === 'settlements' && <>
        {days.isLoading && <p role="status" className="px-4 pb-3 text-sm">Loading sales clearing…</p>}
        {days.error && <p role="alert" className="px-4 pb-3 text-sm text-danger">{days.error.message} <Button variant="secondary" onClick={() => { void days.refetch(); }}>Retry</Button></p>}
        {tooLarge.length > 0 && <p className="px-4 pb-3 text-sm text-warning">{tooLarge.map((d) => `${CHANNEL[d.account_code] ?? d.account_code} ${d.entry_date}`).join(', ')}: more than 1,000 payments in one day. Use Settlement / fees to split it.</p>}
        {!days.isLoading && !days.error && settlements.length === 0 ? <p className="px-4 pb-4 text-sm">No payout matches a day of sales with a fee under 5%.</p>
          : settlements.length > 0 && <Table head={<><Th>Channel</Th><Th>Sales day → paid</Th><Th right>Sales</Th><Th right>Fee</Th><Th right>Received</Th><Th><span className="sr-only">Action</span></Th></>}>
            {settlements.map((s) => {
              const channel = CHANNEL[s.day.account_code] ?? s.day.account_code;
              return <tr key={s.bankLine.id} className="border-t border-border-row">
                <td className={BANK_TD}><span className={`${BANK_LABEL} text-text-primary`}>{channel}</span><p className="text-xs text-text-muted">{s.day.line_count} payments</p></td>
                <td className={`${BANK_TD} whitespace-nowrap font-data text-xs tabular-nums`}>{s.day.entry_date} → {s.bankLine.transaction_date}
                  {s.ambiguous && <p className="font-body text-warning">Another day also fits</p>}</td>
                <td className={NUM}>{bankMoney(s.day.gross)}</td>
                <td className={NUM}>{bankMoney(s.fee)}<p className="text-xs text-text-muted">{formatRate(s.rateBasisPoints)}</p></td>
                <td className={`${NUM} text-success`}>{bankMoney(s.bankLine.amount)}</td>
                <td className={`${BANK_TD} text-right`}><Button variant="secondary" disabled={busy} onClick={() => onPost({ bankLines: [s.bankLine], glLines: [], preset: { kind: 'settlement', clearingIds: s.day.line_ids ?? [], clearingGross: s.day.gross,
                  clearingLabel: `${channel} sales of ${s.day.entry_date}`, description: `${channel} payout ${s.bankLine.transaction_date} for sales of ${s.day.entry_date}` } })}>Review payout</Button></td>
              </tr>;
            })}
          </Table>}
      </>}
      {tab === 'transfers' && (transfers.length === 0 ? <p className="px-4 pb-4 text-sm">No transfer with a separate fee line among the loaded lines.</p>
        : <Table head={<><Th>Transfer</Th><Th>Ledger entry</Th><Th right>Payment</Th><Th right>Fee</Th><Th><span className="sr-only">Action</span></Th></>}>
          {transfers.map((t) => <tr key={t.payment.id} className="border-t border-border-row">
            <td className={`${BANK_TD} break-words`}><p>{clean(t.payment.description) || 'Transfer'}</p><p className="font-data text-xs text-text-muted">{t.payment.transaction_date}</p></td>
            <td className={`${BANK_TD} whitespace-nowrap font-data text-xs`}>{t.gl.entry_number}</td>
            <td className={NUM}>{bankMoney(t.payment.amount)}</td>
            <td className={NUM}>{bankMoney(t.fee)}</td>
            <td className={`${BANK_TD} text-right`}><Button variant="secondary" disabled={busy} onClick={() => onPost({ bankLines: [t.payment, t.feeLine], glLines: [t.gl],
              preset: { kind: 'net_fee', description: `Transfer fee ${t.payment.transaction_date} · ${t.gl.entry_number}` } })}>Review transfer</Button></td>
          </tr>)}
        </Table>)}
      {tab === 'fees' && (fees.length === 0 ? <p className="px-4 pb-4 text-sm">No standalone bank charges.</p> : <>
        <div className="max-h-56 overflow-auto"><Table head={<><Th>Date</Th><Th>Description</Th><Th right>Amount</Th></>}>
          {fees.map((l) => <tr key={l.id} className="border-t border-border-row"><td className={`${BANK_TD} whitespace-nowrap font-data text-xs`}>{l.transaction_date}</td>
            <td className={BANK_TD}>{clean(l.description) || <span className="text-text-muted">No description</span>}</td><td className={NUM}>{bankMoney(l.amount)}</td></tr>)}
        </Table></div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle bg-surface-inert px-4 py-2.5">
          <p className="text-sm">{fees.length} {fees.length === 1 ? 'line' : 'lines'} · total <span className="font-data tabular-nums">{bankMoney(decimalText(feeTotal))}</span></p>
          <Button variant="secondary" disabled={busy || fees.length > 1000} onClick={() => onPost({ bankLines: fees, glLines: [],
            preset: { kind: 'fee', description: `Bank charges ${fees[0]!.transaction_date} to ${fees.at(-1)!.transaction_date}` } })}>Review bank charges</Button>
        </div>
      </>)}
    </div>
  </section>;
}
