import { useRef, useState } from 'react';
import { Dialog, DialogDescription, Input, Select } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import type { BankPostSnapshot } from '@/lib/bankAttemptSchema.js';
import type { BankAccount, BankLine, BankReconciliation, GlLine } from './contracts.js';
import { bankMoney, decimalCents, decimalText } from './money.js';
import { formatRate, rateBp } from './groupSuggestions.js';
import { useBankClearing } from './useBankQueries.js';

type Kind = BankPostSnapshot['kind'];
/** Pré-remplissage venu d'une proposition groupée : le serveur revalide tout. */
export interface BankPostPreset {
  kind: Kind; clearingIds?: string[]; clearingGross?: string; clearingLabel?: string; description?: string;
}
/** Compte de charge proposé par défaut pour tout frais bancaire. */
export const BANK_CHARGES_CODE = '6122';
const KIND_LABEL: Record<Kind, string> = {
  settlement: 'Card / QRIS clearing settlement', net_fee: 'Fees on an existing bank movement (receipt or transfer)',
  fee: 'Bank fee without a ledger entry', interest: 'Bank interest without a ledger entry',
};
const sameSet = (a: string[], b: string[]) => a.length === b.length && b.every((x) => a.includes(x));
const lineCount = (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`;

export function BankPostDialog({ reconciliation, bankLines, glLines, accounts, clearingAccounts = [], preset, onClose, onReady }: {
  reconciliation: BankReconciliation; bankLines: BankLine[]; glLines: GlLine[]; accounts: BankAccount[];
  clearingAccounts?: BankAccount[]; preset?: BankPostPreset; onClose: () => void; onReady: (payload: BankPostSnapshot) => void;
}) {
  const defaultCounter = (k: Kind) => k === 'interest' ? '' : accounts.find((a) => a.code === BANK_CHARGES_CODE && a.account_class === 6)?.id ?? '';
  const [kind,setKindState] = useState<Kind>(preset?.kind ?? 'settlement');
  // Le chargement d'une journée est asynchrone : un changement de type pendant
  // ce temps ne doit pas recevoir la sélection d'un versement.
  const kindRef = useRef(kind);
  const setKind = (value: Kind) => { kindRef.current = value; setKindState(value); };
  const [selected,setSelected] = useState<string[]>(preset?.clearingIds ?? []);
  const [counter,setCounter] = useState(() => defaultCounter(preset?.kind ?? 'settlement'));
  // Le serveur exige que les écritures sources précèdent l'écriture : la date par
  // défaut est la plus tardive des lignes banque ET grand livre choisies.
  const lastDate = [...bankLines.map((l) => l.transaction_date), ...glLines.map((l) => l.entry_date)].sort().at(-1) ?? reconciliation.period_end;
  const [date,setDate] = useState(lastDate >= reconciliation.period_start && lastDate <= reconciliation.period_end ? lastDate : reconciliation.period_end);
  const [description,setDescription] = useState(preset?.description ?? '');
  const [error,setError] = useState('');
  const [day,setDay] = useState('');
  const [dayAccount,setDayAccount] = useState('');
  const [loadingDay,setLoadingDay] = useState(false);
  const presetActive = Boolean(preset?.clearingIds && preset.clearingGross && sameSet(selected, preset.clearingIds));
  const clearing = useBankClearing(reconciliation.id,kind === 'settlement' && !presetActive);
  const available = clearing.data?.pages.flatMap((p) => p.items) ?? [];
  // Les comptes du catalogue d'abord : un compte absent des lignes déjà chargées
  // doit rester proposé.
  const clearingCodes = [...new Set([...clearingAccounts.map((a) => a.code), ...available.map((line) => line.account_code)])].sort();
  // Une journée de ventes compte des centaines de lignes carte / QRIS : le filtre
  // limite l'affichage au jour choisi, sans jamais cacher une ligne déjà cochée.
  const shown = day ? available.filter((line) => selected.includes(line.id)
    || (line.entry_date === day && (!dayAccount || line.account_code === dayAccount))) : available;
  const chosen = available.filter((line) => selected.includes(line.id));
  async function selectDay() {
    if (!day || !dayAccount) { setError('Choose a sales date and a clearing account.'); return; }
    setError(''); setLoadingDay(true);
    try {
      let pages = clearing.data?.pages ?? [];
      let hasNext = clearing.hasNextPage;
      // Toutes les pages d'abord : les lignes sont triées par identifiant, pas par date.
      // Plafond de tours : une page qui n'avance plus ne doit pas boucler sans fin.
      for (let turn = 0; hasNext; turn += 1) {
        if (turn >= 500) throw new Error('Clearing lines did not finish loading. Try again.');
        const next = await clearing.fetchNextPage();
        if (next.error) throw next.error;
        const before = pages.length;
        pages = next.data?.pages ?? pages; hasNext = next.hasNextPage;
        if (hasNext && pages.length === before) throw new Error('Clearing lines did not finish loading. Try again.');
      }
      if (kindRef.current !== 'settlement') return;
      const lines = pages.flatMap((p) => p.items).filter((line) => line.entry_date === day && line.account_code === dayAccount);
      if (lines.length === 0) { setError('No unsettled clearing lines for this date and account.'); return; }
      // Ajout, pas remplacement : un jour où la caisse a mal ventilé carte et QRIS
      // se règle en une seule écriture sur les deux comptes d'attente.
      setSelected((old) => {
        const union = [...new Set([...old, ...lines.map((line) => line.id)])];
        if (union.length > 1000) { setError('More than 1,000 lines in one entry. Settle this date in two entries.'); return old; }
        return union;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the clearing lines. Try again.');
    } finally { setLoadingDay(false); }
  }
  const bankTotal = bankLines.reduce((sum,line) => sum + decimalCents(line.amount),0n);
  const sourceTotal = kind === 'net_fee' ? glLines.reduce((sum,line) => sum + decimalCents(line.amount),0n)
    : presetActive ? decimalCents(preset!.clearingGross!) : chosen.reduce((sum,line) => sum + decimalCents(line.amount),0n);
  // Le frais n'est jamais saisi : c'est l'écart exact source − banque, que le
  // serveur recalcule au centime.
  const computedFee = kind === 'settlement' || kind === 'net_fee' ? sourceTotal - bankTotal : 0n;
  const feeAbs = kind === 'fee' || kind === 'interest' ? (bankTotal < 0n ? -bankTotal : bankTotal) : computedFee;
  const rate = sourceTotal === 0n ? 0 : rateBp(computedFee, sourceTotal < 0n ? -sourceTotal : sourceTotal);
  const needsCounter = kind !== 'settlement' || computedFee > 0n;
  const eligible = accounts.filter((a) => a.account_class === (kind === 'interest' ? 4 : 6));
  const sameDirection = (bankTotal > 0n && sourceTotal > 0n) || (bankTotal < 0n && sourceTotal < 0n);
  const relation = kind === 'fee' ? bankTotal < 0n : kind === 'interest' ? bankTotal > 0n
    : kind === 'settlement' ? computedFee >= 0n && bankTotal > 0n : computedFee > 0n && sameDirection;
  const selectionOkay = kind !== 'settlement' || (selected.length > 0 && selected.length <= 1000 && (presetActive || chosen.length === selected.length));
  const okay = bankLines.length > 0 && bankLines.length <= 1000 && bankTotal !== 0n && relation && selectionOkay
    && (kind !== 'net_fee' || (glLines.length > 0 && glLines.length <= 1000))
    && (!needsCounter || eligible.some((a) => a.id === counter)) && date >= reconciliation.period_start && date <= reconciliation.period_end
    && description.trim().length >= 3 && description.trim().length <= 1000;
  function next() {
    if (!okay) { setError('Check source lines, exact totals, date, description and expense account.'); return; }
    onReady({ reconciliationId: reconciliation.id,kind,bankIds: bankLines.map((l) => l.id).sort(),
      clearingIds: kind === 'settlement' ? [...selected].sort() : [], bankGlIds: kind === 'net_fee' ? glLines.map((l) => l.id).sort() : [],
      counterAccountId: needsCounter ? counter : null, fee: kind === 'fee' || kind === 'interest' ? '0.00' : decimalText(computedFee), date,description: description.trim() });
  }
  const relationText = relation ? 'Amounts check out'
    : kind === 'settlement' ? 'The bank amount must be positive and not exceed the selected sales'
    : kind === 'net_fee' ? 'The bank movement must go the same way as the ledger lines and include a fee'
    : kind === 'fee' ? 'Select money going out of the bank' : 'Select money coming into the bank';
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
    <DialogTitle>Prepare bank entry</DialogTitle><DialogDescription>The bank fee is computed from the selected lines. Confirmation requires a manager PIN.</DialogDescription>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm">Entry type<Select value={kind} onChange={(e) => { const k = e.target.value as Kind; setKind(k); setCounter(defaultCounter(k)); setSelected([]); }}>
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
      </Select></label>
      <label className="space-y-1 text-sm">Entry date<Input type="date" min={reconciliation.period_start} max={reconciliation.period_end} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      {needsCounter && <label className="space-y-1 text-sm">{kind === 'interest' ? 'Revenue account' : 'Expense account'}<Select value={counter} onChange={(e) => setCounter(e.target.value)}>
        <option value="">Choose counter account</option>{eligible.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></label>}
      <label className="space-y-1 text-sm sm:col-span-2">Description<Input maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    </div>
    <dl className="grid gap-3 rounded border border-border-subtle bg-bg-elevated p-3 text-sm sm:grid-cols-3">
      <div><dt className="text-text-secondary">Bank movements ({bankLines.length})</dt><dd className="font-data text-base">{bankMoney(decimalText(bankTotal))}</dd></div>
      {(kind === 'settlement' || kind === 'net_fee') && <div><dt className="text-text-secondary">{kind === 'net_fee' ? `Ledger lines (${glLines.length})` : `Sales clearing (${lineCount(selected.length)})`}</dt>
        <dd className="font-data text-base">{bankMoney(decimalText(sourceTotal))}</dd></div>}
      <div><dt className="text-text-secondary">{kind === 'interest' ? 'Interest' : 'Bank fee'}</dt>
        <dd className="font-data text-base">{feeAbs < 0n ? '—' : bankMoney(decimalText(feeAbs))}{(kind === 'settlement' || kind === 'net_fee') && computedFee >= 0n && sourceTotal !== 0n && <span className="ml-2 text-xs text-text-secondary">{formatRate(rate)}</span>}</dd></div>
      <p aria-live="polite" className={`sm:col-span-3 ${relation ? 'text-success' : 'text-danger'}`}>{relationText}</p>
    </dl>
    {kind === 'net_fee' && <p className="text-sm text-text-secondary">The existing ledger lines stay as they are. Only the fee is posted, then everything is matched together.</p>}
    {kind === 'settlement' && presetActive && <p className="text-sm">Sales to settle: <strong>{preset?.clearingLabel}</strong> · {lineCount(selected.length)}.
      <Button variant="ghost" size="sm" onClick={() => setSelected([])}>Choose other sales</Button></p>}
    {kind === 'settlement' && !presetActive && <section aria-label="Available clearing lines" className="space-y-2">
      <p className="font-medium">Unsettled card / QRIS ledger lines</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-sm">Sales date<Input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
        <label className="space-y-1 text-sm">Clearing account<Select value={dayAccount} onChange={(e) => setDayAccount(e.target.value)}>
          <option value="">Choose account</option>{clearingCodes.map((code) => <option key={code} value={code}>{code}</option>)}</Select></label>
        <Button variant="secondary" disabled={loadingDay || !day || !dayAccount} onClick={() => { void selectDay(); }}>{loadingDay ? 'Loading all lines…' : 'Add the whole day'}</Button>
        {selected.length > 0 && <Button variant="secondary" onClick={() => setSelected([])}>Clear selection</Button>}
      </div>
      <p role="status" className="text-sm text-text-secondary">{selected.length} lines selected. Bank fee = selected clearing − bank movement.</p>
      {clearing.isLoading && <p role="status">Loading clearing…</p>}
      {clearing.error && <p role="alert" className="text-danger">{clearing.error.message}<Button variant="secondary" onClick={() => { void clearing.refetch(); }}>Retry</Button></p>}
      <div className="max-h-64 overflow-auto border border-border-subtle"><table className="w-full text-sm"><thead><tr><th>Select</th><th>Date / entry</th><th>Source</th><th>Amount</th></tr></thead><tbody>
        {shown.map((line) => <tr key={line.id}><td><input className={FOCUS_RING} type="checkbox" aria-label={`Select clearing ${line.entry_number} ${line.id.slice(0,8)}`} checked={selected.includes(line.id)}
          onChange={(e) => setSelected((old) => e.target.checked ? [...old,line.id] : old.filter((id) => id !== line.id))} /></td><td className="whitespace-nowrap">{line.entry_date}<br />{line.entry_number}</td><td className="max-w-sm break-words">{line.account_code} · {line.description}</td><td className="whitespace-nowrap font-data">{bankMoney(line.amount)}</td></tr>)}
      </tbody></table></div>
      {!clearing.isLoading && !clearing.error && available.length === 0 && <p>No eligible clearing lines.</p>}
      {clearing.hasNextPage && <Button variant="secondary" disabled={clearing.isFetchingNextPage || loadingDay} onClick={() => { void clearing.fetchNextPage(); }}>Load more clearing</Button>}
    </section>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Close</Button><Button disabled={!okay} onClick={next}>Review journal entry</Button></div>
  </DialogContent></Dialog>;
}
