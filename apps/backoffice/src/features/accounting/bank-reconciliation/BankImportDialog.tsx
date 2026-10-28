import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogDescription, Input, Select } from '@breakery/ui';
import { Button, DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { captureFinancialSession } from '@/lib/useFinancialAttempt.js';
import type { BankImportPayload } from '@/lib/bankAttemptSchema.js';
import type { BankAccount, BankReconciliation } from './contracts.js';
import { bankMoney, localizedBankAmount } from './money.js';
import { defaultMapping, makeImportPayload, normalizeStatement, readStatement, type StatementFile, type StatementMapping } from './statementParser.js';
import { previewBankImport } from './api.js';

export function BankImportDialog({ accounts, existing, onClose, onReady }: {
  accounts: BankAccount[]; existing?: BankReconciliation; onClose: () => void; onReady: (payload: BankImportPayload) => void;
}) {
  const [file,setFile] = useState<StatementFile | null>(null);
  const [sheetIndex,setSheetIndex] = useState(0);
  const [separator,setSeparator] = useState<',' | ';' | '\t'>(',');
  const [mapping,setMapping] = useState<StatementMapping>(defaultMapping);
  const [account,setAccount] = useState(existing?.account_id ?? '');
  const [start,setStart] = useState(existing?.period_start ?? '');
  const [end,setEnd] = useState(existing?.period_end ?? '');
  const [opening,setOpening] = useState(existing?.opening_balance ?? '');
  const [closing,setClosing] = useState(existing?.closing_balance ?? '');
  const [acknowledged,setAcknowledged] = useState(false);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [preview,setPreview] = useState<{ payload: BankImportPayload; result: Awaited<ReturnType<typeof previewBankImport>> } | null>(null);
  const revision = useRef(0);
  useEffect(() => () => { revision.current++; }, []);
  const changed = () => { revision.current++; setPreview(null); setError(''); setBusy(false); };
  const sheet = file?.sheets[sheetIndex];
  const parsed = sheet ? normalizeStatement(sheet,mapping) : null;
  const headers = sheet?.rows[mapping.headerRow - 1] ?? [];
  const setColumn = (field: keyof StatementMapping, value: number | string) => { changed(); setMapping((old) => ({ ...old,[field]: value })); };

  async function chooseFile(value: File | undefined) {
    changed(); setFile(null); if (!value) return;
    const generation = revision.current; const session = captureFinancialSession(); setBusy(true);
    try {
      const result = await readStatement(value,separator);
      if (generation === revision.current && session.current()) { setFile(result); setSheetIndex(0); setMapping(defaultMapping); }
    } catch (failure) { if (generation === revision.current && session.current()) setError((failure as Error).message); }
    finally { if (generation === revision.current && session.current()) setBusy(false); }
  }
  async function check() {
    if (!file || !sheet) return;
    const generation = ++revision.current; const session = captureFinancialSession(); setError(''); setBusy(true);
    try {
      const payload = makeImportPayload(file,sheet,mapping,{ account_id: account, ...(existing ? { reconciliation_id: existing.id } : {}),
        period_start: start, period_end: end,
        opening_balance: existing ? existing.opening_balance : (opening.trim() ? localizedBankAmount(opening,mapping.numbers) : null),
        closing_balance: existing ? existing.closing_balance : (closing.trim() ? localizedBankAmount(closing,mapping.numbers) : null), duplicate_acknowledged: acknowledged });
      const result = await previewBankImport(payload);
      if (generation === revision.current && session.current()) setPreview({ payload,result });
    } catch (failure) { if (generation === revision.current && session.current()) setError((failure as Error).message); }
    finally { if (generation === revision.current && session.current()) setBusy(false); }
  }
  function column(label: string, field: 'date' | 'description' | 'reference' | 'balance' | 'amount' | 'debit' | 'credit', optional = false) {
    return <label className="space-y-1 text-sm">{label}<Select value={mapping[field]} onChange={(e) => setColumn(field,Number(e.target.value))}>
      <option value={-1}>{optional ? 'Not provided' : 'Choose column'}</option>
      {headers.map((h,index) => <option key={index} value={index}>{index + 1} · {typeof h === 'string' || typeof h === 'number' ? String(h).slice(0,100) : '(blank)'}</option>)}
    </Select></label>;
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
    <DialogTitle>Import bank statement</DialogTitle><DialogDescription>Review columns, transaction direction and exact balances before saving.</DialogDescription>
    <div className="grid grid-cols-3 gap-3">
      <label className="space-y-1 text-sm">Bank account<Select value={account} disabled={Boolean(existing)} onChange={(e) => { changed(); setAccount(e.target.value); }}>
        <option value="">Choose bank account</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></label>
      <label className="space-y-1 text-sm">Period start<Input type="date" value={start} disabled={Boolean(existing)} onChange={(e) => { changed(); setStart(e.target.value); }} /></label>
      <label className="space-y-1 text-sm">Period end<Input type="date" value={end} disabled={Boolean(existing)} onChange={(e) => { changed(); setEnd(e.target.value); }} /></label>
      <label className="space-y-1 text-sm">CSV separator<Select value={separator} disabled={Boolean(file)} onChange={(e) => { changed(); setSeparator(e.target.value as typeof separator); }}><option value=",">Comma</option><option value=";">Semicolon</option><option value={'\t'}>Tab</option></Select></label>
      <label className="col-span-2 space-y-1 text-sm">Statement file<Input type="file" accept=".csv,.xlsx,.xls,.xlsb" onChange={(e) => { void chooseFile(e.target.files?.[0]); }} /></label>
    </div>
    {file && <>
      <div className="grid grid-cols-4 gap-3">
        <label className="space-y-1 text-sm">Sheet<Select value={sheetIndex} onChange={(e) => { changed(); setSheetIndex(Number(e.target.value)); }}>
          {file.sheets.map((s,index) => <option key={s.name} value={index}>{s.name}</option>)}</Select></label>
        <label className="space-y-1 text-sm">Header row<Input type="number" min={1} max={1000} value={mapping.headerRow} onChange={(e) => setColumn('headerRow',Number(e.target.value))} /></label>
        <label className="space-y-1 text-sm">Number format<Select value={mapping.numbers} onChange={(e) => setColumn('numbers',e.target.value)}><option value="dot">1,234.56</option><option value="comma">1.234,56</option></Select></label>
        <label className="space-y-1 text-sm">Date format<Select value={mapping.dates} onChange={(e) => setColumn('dates',e.target.value)}><option value="iso">YYYY-MM-DD</option><option value="dmy">DD/MM/YYYY</option><option value="mdy">MM/DD/YYYY</option></Select></label>
        {column('Transaction date','date')}{column('Description','description')}{column('Reference','reference',true)}{column('Running balance','balance',true)}
        <label className="space-y-1 text-sm">Amount columns<Select value={mapping.mode} onChange={(e) => setColumn('mode',e.target.value)}><option value="signed">Signed amount (+ money in)</option><option value="debit-credit">Separate debit and credit</option></Select></label>
        {mapping.mode === 'signed' ? column('Signed amount','amount') : <>{column('Debit','debit')}{column('Credit','credit')}
          <label className="space-y-1 text-sm">Credit direction<Select value={mapping.creditDirection} onChange={(e) => setColumn('creditDirection',e.target.value)}><option value="in">Credit = money in</option><option value="out">Credit = money out</option></Select></label></>}
        <label className="space-y-1 text-sm">Opening balance (optional)<Input value={opening} disabled={Boolean(existing)} placeholder="Unavailable" onChange={(e) => { changed(); setOpening(e.target.value); }} /></label>
        <label className="space-y-1 text-sm">Closing balance (optional)<Input value={closing} disabled={Boolean(existing)} placeholder="Unavailable" onChange={(e) => { changed(); setClosing(e.target.value); }} /></label>
      </div>
      <p className="break-all text-xs text-text-muted">SHA-256 {file.sha256}</p>
      {parsed && <div className="space-y-2">
        <p className="text-sm">{parsed.rows.length} valid rows · {parsed.errors.length} issues. Preview shows the first 10 rows.</p>
        {parsed.errors.length > 0 && <ul className="max-h-32 overflow-auto text-sm text-danger">{parsed.errors.slice(0,30).map((message) => <li key={message}>{message}</li>)}{parsed.errors.length > 30 && <li>More issues must be resolved before import.</li>}</ul>}
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th>Source row</th><th>Date</th><th>Description</th><th>Signed amount</th></tr></thead><tbody>
          {parsed.rows.slice(0,10).map((row) => <tr key={row.source_row}><td>{row.source_row}</td><td className="whitespace-nowrap">{row.date}</td><td className="max-w-sm break-words">{row.description}</td><td className="whitespace-nowrap font-data">{bankMoney(row.amount)}</td></tr>)}
        </tbody></table></div>
      </div>}
      <label className="flex items-start gap-2 text-sm"><input className={FOCUS_RING} type="checkbox" checked={acknowledged} onChange={(e) => { changed(); setAcknowledged(e.target.checked); }} />I reviewed any identical transactions in this file and confirm they are separate real movements.</label>
    </>}
    {preview && <div role="status" className="rounded border border-border-subtle bg-bg-elevated p-3 text-sm">
      Server checked {preview.result.count} rows · total {bankMoney(preview.result.total)} · balances {preview.result.balanceCheck}.
      {preview.result.alreadyImported && <p>This source is already imported. Confirmation retrieves the original result.</p>}
      {preview.result.warnings.length > 0 && <p>{preview.result.warnings.length} potential duplicate rows require explicit review and acknowledgement.</p>}
    </div>}
    {error && <p role="alert" className="whitespace-pre-line text-sm text-danger">{error}</p>}
    <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Close</Button>
      <Button disabled={busy || !file || !account || !start || !end || Boolean(parsed?.errors.length)} onClick={() => { void check(); }}>{busy ? 'Checking…' : 'Validate preview'}</Button>
      {preview && <Button disabled={busy || (preview.result.warnings.length > 0 && !acknowledged)} onClick={() => onReady(preview.payload)}>Continue to confirmation</Button>}
    </div>
  </DialogContent></Dialog>;
}
