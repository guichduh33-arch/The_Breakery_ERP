import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Input } from '@breakery/ui';
import { Button } from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { useAuthStore } from '@/stores/authStore.js';
import type { BankManageSnapshot, BankPostSnapshot, BankFinalizeSnapshot } from '@/lib/bankAttemptSchema.js';
import type { BankCatalog } from './contracts.js';
import { BankAttemptDialog } from './BankAttemptDialog.js';
import { BankImportDialog } from './BankImportDialog.js';
import { BankBalanceDialog } from './BankBalanceDialog.js';
import { BankPostDialog } from './BankPostDialog.js';
import { BankFinalizeDialog } from './BankFinalizeDialog.js';
import { BankUnmatchDialog } from './BankUnmatchDialog.js';
import { BankRecovery } from './BankRecovery.js';
import { BankLinesTable } from './BankLinesTable.js';
import { BankSuggestions } from './BankSuggestions.js';
import { useBankDetail } from './useBankQueries.js';
import { bankMoney, decimalCents, decimalText } from './money.js';

type Action = { operation: 'bank_manage'; payload: BankManageSnapshot } | { operation: 'bank_post'; payload: BankPostSnapshot } | { operation: 'bank_finalize'; payload: BankFinalizeSnapshot };
export function BankWorkspace({ reconciliationId, catalog }: { reconciliationId: string; catalog: BankCatalog }) {
  const query = useBankDetail(reconciliationId);
  const canManage = useAuthStore((s) => s.hasPermission('accounting.bank.manage'));
  const canValidate = useAuthStore((s) => s.hasPermission('accounting.bank.validate'));
  const canReadLedger = useAuthStore((s) => s.hasPermission('accounting.gl.read'));
  const canPost = useAuthStore((s) => s.hasPermission('accounting.bank.settle') && s.hasPermission('accounting.bank.manage') && s.hasPermission('accounting.je.create_manual'));
  const [bankIds,setBankIds] = useState<string[]>([]);
  const [glIds,setGlIds] = useState<string[]>([]);
  const [search,setSearch] = useState('');
  const [unmatchedOnly,setUnmatchedOnly] = useState(false);
  const [form,setForm] = useState<null | 'import' | 'balances' | 'post' | 'finalize'>(null);
  const [unmatch,setUnmatch] = useState<string | null>(null);
  const [action,setAction] = useState<Action | null>(null);
  const pages = query.data?.pages ?? [];
  const data = pages.at(-1);
  if (!data) return <div className="py-10"><p role={query.error ? 'alert' : 'status'}>{query.error?.message ?? 'Loading reconciliation…'}</p>{query.error && <Button onClick={() => { void query.refetch(); }}>Retry</Button>}</div>;
  const rec = data.reconciliation;
  const bank = [...new Map(pages.flatMap((p) => p.bank_lines).map((line) => [line.id,line])).values()];
  const gl = [...new Map(pages.flatMap((p) => p.gl_lines).map((line) => [line.id,line])).values()];
  const selectedBank = bank.filter((line) => bankIds.includes(line.id) && !line.match_id);
  const selectedGl = gl.filter((line) => glIds.includes(line.id) && !line.match_id);
  const bankSum = selectedBank.reduce((sum,line) => sum + decimalCents(line.amount),0n);
  const glSum = selectedGl.reduce((sum,line) => sum + decimalCents(line.amount),0n);
  const editable = canManage && rec.status === 'draft' && !query.isFetching && !query.isError;
  const account = catalog.bank_accounts.find((a) => a.id === rec.account_id);
  const displayBank = bank.filter((line) => (!unmatchedOnly || !line.match_id) && `${line.description} ${line.reference} ${line.transaction_date}`.toLowerCase().includes(search.toLowerCase()));
  const displayGl = gl.filter((line) => (!unmatchedOnly || !line.match_id) && `${line.description} ${line.entry_number} ${line.entry_date}`.toLowerCase().includes(search.toLowerCase()));
  const toggle = (setter: typeof setBankIds) => (id: string, checked: boolean) => setter((old) => checked ? [...new Set([...old,id])] : old.filter((entry) => entry !== id));
  const manage = (payload: BankManageSnapshot) => { setForm(null); setUnmatch(null); setAction({ operation: 'bank_manage',payload }); };
  const balanceDelta = data.balances.bank_closing === null ? null : decimalText(decimalCents(data.balances.gl_closing) - decimalCents(data.balances.bank_closing));
  const allLoaded = query.hasNextPage === false && !query.isFetching && !query.isError;
  const finalizeReady = canValidate && rec.status === 'draft' && allLoaded && bank.every((line) => Boolean(line.match_id))
    && rec.opening_balance !== null && rec.closing_balance !== null && data.source_integrity?.state !== 'changed';
  return <div className="min-w-0 space-y-4">
    <BankRecovery target={rec.id} />
    <div className="flex flex-wrap justify-between items-start gap-3"><div><h2 className="text-lg font-medium">{account?.code} · {account?.name ?? 'Bank account'}</h2><p className="text-sm text-text-secondary">{rec.period_start} → {rec.period_end} · {rec.status === 'finalized' ? 'Finalized · frozen snapshot' : 'Draft'}</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={query.isFetching} onClick={() => { setBankIds([]); setGlIds([]); void query.refetch(); }}>Refresh</Button>
        {canManage && <><Button variant="secondary" disabled={!editable} onClick={() => setForm('balances')}>Statement balances</Button><Button variant="secondary" disabled={!editable} onClick={() => setForm('import')}>Add statement file</Button></>}
        {canValidate && <Button disabled={!finalizeReady} onClick={() => setForm('finalize')}>Finalize</Button>}</div>
    </div>
    {query.error && <p role="alert" className="text-sm text-danger">{query.error.message}. Loaded data may be outdated. Refresh before continuing.</p>}
    {data.source_integrity?.state === 'changed' && <p role="alert" className="rounded border border-danger p-3 text-sm text-danger">The ledger changed after the recorded finalization. The frozen result is preserved; investigate the source changes before finalizing the next period. Recorded closing {bankMoney(data.source_integrity.recorded_gl_closing)} · current closing {bankMoney(data.source_integrity.current_gl_closing)}.</p>}
    <div className="grid grid-cols-4 gap-3">{[
      ['Bank opening',bankMoney(data.balances.bank_opening)],['Bank closing',bankMoney(data.balances.bank_closing)],['Ledger closing',bankMoney(data.balances.gl_closing)],['Ledger − bank',bankMoney(balanceDelta)],
    ].map(([label,value]) => <div key={label} className="min-w-0 rounded border border-border-subtle bg-bg-elevated p-3"><p className="text-xs text-text-secondary">{label}</p><p className="overflow-x-auto whitespace-nowrap font-data text-lg tabular-nums">{value}</p></div>)}</div>
    <div className="flex flex-wrap items-center gap-3"><Input className="max-w-sm" aria-label="Filter loaded bank and ledger lines" placeholder="Filter loaded descriptions or references" value={search} onChange={(e) => setSearch(e.target.value)} />
      <label className="flex gap-2 items-center text-sm"><input className={FOCUS_RING} type="checkbox" checked={unmatchedOnly} onChange={(e) => setUnmatchedOnly(e.target.checked)} />Unmatched only</label>
      <span className="text-xs text-text-muted">Filters apply to loaded lines. {allLoaded ? 'All pages loaded.' : 'More pages may remain.'}</span></div>
    <div className="grid min-w-0 grid-cols-2 gap-4">
      <BankLinesTable title="Bank statement" lines={displayBank.map((l) => ({ id: l.id,date: l.transaction_date,label: l.description,reference: l.reference,amount: l.amount,matchId: l.match_id }))} selected={bankIds} editable={editable} onToggle={toggle(setBankIds)} onUnmatch={setUnmatch} />
      <BankLinesTable title="Bank ledger" lines={displayGl.map((l) => ({ id: l.id,date: l.entry_date,label: l.description,reference: `${l.entry_number} · ${l.reference_type}`,amount: l.amount,matchId: l.match_id }))} selected={glIds} editable={editable} onToggle={toggle(setGlIds)} onUnmatch={setUnmatch} />
    </div>
    {query.hasNextPage && <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => { void query.fetchNextPage(); }}>{query.isFetchingNextPage ? 'Loading…' : 'Load more statement and ledger lines'}</Button>}
    {rec.status === 'draft' && <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-border-strong bg-bg-elevated p-3">
      <div className="text-sm"><p>{selectedBank.length} bank movements: <span className="font-data">{bankMoney(decimalText(bankSum))}</span> ↔ {selectedGl.length} ledger lines: <span className="font-data">{bankMoney(decimalText(glSum))}</span></p>
        <p className="text-text-secondary">Difference <span className="font-data">{bankMoney(decimalText(bankSum-glSum))}</span>. Exact amounts only.</p></div>
      <div className="flex gap-2"><Button variant="secondary" onClick={() => { setBankIds([]); setGlIds([]); }}>Clear selection</Button>
        {canPost && <Button variant="secondary" disabled={!editable || selectedBank.length === 0} onClick={() => setForm('post')}>Settlement / fees</Button>}
        {canManage && <Button disabled={!editable || selectedBank.length === 0 || selectedGl.length === 0 || selectedBank.length > 1000 || selectedGl.length > 1000 || bankSum !== glSum} onClick={() => manage({ kind: 'match',reconciliationId: rec.id,bankIds: selectedBank.map((l) => l.id).sort(),glIds: selectedGl.map((l) => l.id).sort() })}>Review match</Button>}</div>
    </div>}
    {canManage && rec.status === 'draft' && <BankSuggestions reconciliationId={rec.id} onReview={manage} />}
    {canValidate && rec.status === 'draft' && !finalizeReady && <p className="text-sm text-text-secondary">To finalize, load every page, explain every bank line, enter statement balances and resolve any source integrity warning. Unmatched ledger lines require individual transit reasons.</p>}
    <details className="rounded border border-border-subtle bg-bg-elevated p-4"><summary className="cursor-pointer font-medium">Sources, journal entries and match history</summary><div className="mt-3 space-y-3 text-sm">
      {data.imports.map((i) => <p className="break-all" key={i.id}>{i.file_name} · {i.sheet_name}<br /><span className="font-data text-xs">SHA-256 {i.source_sha256}</span></p>)}
      {data.entries.map((entry) => <p key={entry.id}>{entry.kind} · fee {bankMoney(entry.fee_amount)} · {canReadLedger && <Link className={`text-gold underline ${FOCUS_RING}`} to={`/backoffice/accounting/general-ledger?account_id=${rec.account_id}&start=${rec.period_start}&end=${rec.period_end}`}>View bank ledger</Link>} · <span className="font-data text-xs">{entry.journal_entry_id}</span></p>)}
      {data.matches.map((match) => <p key={match.id}>{bankMoney(match.amount)} · {match.bank_line_ids.length} bank / {match.gl_line_ids.length} ledger · {match.removed_at ? `Removed: ${match.removal_reason}` : 'Active'}</p>)}
      {data.match_history_truncated && <p>Only the 100 most recent associations are shown. Use the audit log for the full history; linked rows can still be unlinked from either panel.</p>}
      {rec.snapshot_sha256 && <p className="break-all font-data text-xs">Frozen snapshot SHA-256 {rec.snapshot_sha256}</p>}
    </div></details>
    {form === 'import' && <BankImportDialog accounts={catalog.bank_accounts} existing={rec} onClose={() => setForm(null)} onReady={(statement) => manage({ kind: 'import',statement })} />}
    {form === 'balances' && <BankBalanceDialog reconciliation={rec} onClose={() => setForm(null)} onReady={manage} />}
    {form === 'post' && <BankPostDialog reconciliation={rec} bankLines={selectedBank} glLines={selectedGl} accounts={catalog.counter_accounts} onClose={() => setForm(null)} onReady={(payload) => { setForm(null); setAction({ operation: 'bank_post',payload }); }} />}
    {form === 'finalize' && <BankFinalizeDialog reconciliationId={rec.id} unmatched={gl.filter((l) => !l.match_id)} onClose={() => setForm(null)} onReady={(payload) => { setForm(null); setAction({ operation: 'bank_finalize',payload }); }} />}
    {unmatch && <BankUnmatchDialog reconciliationId={rec.id} matchId={unmatch} onClose={() => setUnmatch(null)} onReady={manage} />}
    {action && <BankAttemptDialog operation={action.operation} target={rec.id} payload={action.payload} onClose={() => setAction(null)} onSuccess={() => { setBankIds([]); setGlIds([]); }} />}
  </div>;
}
