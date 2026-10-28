import { useState } from 'react';
import { Dialog, DialogDescription, Input, Select } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import type { BankPostSnapshot } from '@/lib/bankAttemptSchema.js';
import type { BankAccount, BankLine, BankReconciliation, GlLine } from './contracts.js';
import { bankMoney, decimalCents, decimalText } from './money.js';
import { useBankClearing } from './useBankQueries.js';

export function BankPostDialog({ reconciliation, bankLines, glLines, accounts, onClose, onReady }: {
  reconciliation: BankReconciliation; bankLines: BankLine[]; glLines: GlLine[]; accounts: BankAccount[];
  onClose: () => void; onReady: (payload: BankPostSnapshot) => void;
}) {
  const [kind,setKind] = useState<BankPostSnapshot['kind']>('settlement');
  const [selected,setSelected] = useState<string[]>([]);
  const [fee,setFee] = useState('0.00');
  const [counter,setCounter] = useState('');
  const [date,setDate] = useState(reconciliation.period_end);
  const [description,setDescription] = useState('');
  const [error,setError] = useState('');
  const clearing = useBankClearing(reconciliation.id,kind === 'settlement');
  const available = clearing.data?.pages.flatMap((p) => p.items) ?? [];
  const chosen = available.filter((line) => selected.includes(line.id));
  const bankTotal = bankLines.reduce((sum,line) => sum + decimalCents(line.amount),0n);
  const sourceTotal = (kind === 'net_fee' ? glLines : chosen).reduce((sum,line) => sum + decimalCents(line.amount),0n);
  let feeAmount: bigint | null = null;
  try { feeAmount = decimalCents(fee); } catch { /* Le message est affiché à la confirmation. */ }
  const needsCounter = kind !== 'settlement' || (feeAmount !== null && feeAmount > 0n);
  const eligible = accounts.filter((a) => a.account_class === (kind === 'interest' ? 4 : 6));
  const relation = kind === 'fee' ? bankTotal < 0n : kind === 'interest' ? bankTotal > 0n
    : feeAmount !== null && bankTotal === sourceTotal - feeAmount;
  const okay = bankLines.length > 0 && bankLines.length <= 1000 && bankTotal !== 0n && relation && feeAmount !== null && feeAmount >= 0n
    && (kind !== 'settlement' || (chosen.length > 0 && chosen.length === selected.length && selected.length <= 1000))
    && (kind !== 'net_fee' || (glLines.length > 0 && glLines.length <= 1000 && bankTotal > 0n && feeAmount > 0n))
    && (!needsCounter || eligible.some((a) => a.id === counter)) && date >= reconciliation.period_start && date <= reconciliation.period_end
    && description.trim().length >= 3 && description.trim().length <= 1000;
  function next() {
    if (!okay) { setError('Check source lines, exact totals, actual fee, date and counter account.'); return; }
    onReady({ reconciliationId: reconciliation.id,kind,bankIds: bankLines.map((l) => l.id).sort(),
      clearingIds: kind === 'settlement' ? [...selected].sort() : [], bankGlIds: kind === 'net_fee' ? glLines.map((l) => l.id).sort() : [],
      counterAccountId: needsCounter ? counter : null, fee: kind === 'fee' || kind === 'interest' ? '0.00' : decimalText(feeAmount!), date,description: description.trim() });
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
    <DialogTitle>Prepare bank entry</DialogTitle><DialogDescription>Select existing sources and actual bank fees. Confirmation requires a manager PIN.</DialogDescription>
    <div className="grid grid-cols-2 gap-3">
      <label className="space-y-1 text-sm">Entry type<Select value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setCounter(''); setSelected([]); setFee('0.00'); }}>
        <option value="settlement">Card / QRIS clearing settlement</option><option value="net_fee">Fees on an existing bank receipt (including B2B)</option>
        <option value="fee">Bank fee without a ledger entry</option><option value="interest">Bank interest without a ledger entry</option>
      </Select></label>
      <label className="space-y-1 text-sm">Entry date<Input type="date" min={reconciliation.period_start} max={reconciliation.period_end} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      {(kind === 'settlement' || kind === 'net_fee') && <label className="space-y-1 text-sm">Actual fee (IDR, decimal point)<Input value={fee} onChange={(e) => setFee(e.target.value)} /></label>}
      {needsCounter && <label className="space-y-1 text-sm">{kind === 'interest' ? 'Revenue account' : 'Expense account'}<Select value={counter} onChange={(e) => setCounter(e.target.value)}>
        <option value="">Choose counter account</option>{eligible.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></label>}
      <label className="col-span-2 space-y-1 text-sm">Description<Input maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    </div>
    <div className="grid grid-cols-3 gap-3 text-sm"><p>Selected bank movements<br /><strong className="font-data">{bankMoney(decimalText(bankTotal))}</strong></p>
      <p>{kind === 'net_fee' ? 'Selected existing bank receipts' : 'Selected clearing'}<br /><strong className="font-data">{bankMoney(decimalText(sourceTotal))}</strong></p>
      <p>{relation ? 'Exact amount check passed' : 'Amounts do not match'}<br /><span className="text-text-secondary">{kind === 'settlement' || kind === 'net_fee' ? 'Bank = source − actual fee' : 'Bank amount determines the journal entry'}</span></p></div>
    {kind === 'net_fee' && <p className="text-sm text-text-secondary">Select the existing bank receipt lines in the ledger panel before opening this form. Only the actual fee is posted; the receipt is not created again.</p>}
    {kind === 'settlement' && <section aria-label="Available clearing lines" className="space-y-2">
      <p className="font-medium">Unsettled card / QRIS ledger lines</p>
      {clearing.isLoading && <p role="status">Loading clearing…</p>}
      {clearing.error && <p role="alert" className="text-danger">{clearing.error.message}<Button variant="secondary" onClick={() => { void clearing.refetch(); }}>Retry</Button></p>}
      <div className="max-h-64 overflow-auto border border-border-subtle"><table className="w-full text-sm"><thead><tr><th>Select</th><th>Date / entry</th><th>Source</th><th>Amount</th></tr></thead><tbody>
        {available.map((line) => <tr key={line.id}><td><input className={FOCUS_RING} type="checkbox" aria-label={`Select clearing ${line.entry_number} ${line.id.slice(0,8)}`} checked={selected.includes(line.id)}
          onChange={(e) => setSelected((old) => e.target.checked ? [...old,line.id] : old.filter((id) => id !== line.id))} /></td><td className="whitespace-nowrap">{line.entry_date}<br />{line.entry_number}</td><td className="max-w-sm break-words">{line.account_code} · {line.description}</td><td className="whitespace-nowrap font-data">{bankMoney(line.amount)}</td></tr>)}
      </tbody></table></div>
      {!clearing.isLoading && !clearing.error && available.length === 0 && <p>No eligible clearing lines.</p>}
      {clearing.hasNextPage && <Button variant="secondary" disabled={clearing.isFetchingNextPage} onClick={() => { void clearing.fetchNextPage(); }}>Load more clearing</Button>}
    </section>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Close</Button><Button disabled={!okay} onClick={next}>Review journal entry</Button></div>
  </DialogContent></Dialog>;
}
