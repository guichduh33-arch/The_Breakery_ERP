import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Lock, RefreshCw } from 'lucide-react';
import { Input } from '@breakery/ui';
import { Button } from '@/components/BackofficeUi.js';
import { PageHeader } from '@/components/PageHeader.js';
import { TOOLBAR_BTN_PRIMARY, TOOLBAR_BTN_SECONDARY, TOOLBAR_ICON } from '@/components/toolbarButton.js';
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
import { BankGroupSuggestions, type GroupPost } from './BankGroupSuggestions.js';
import { BankRail } from './BankRail.js';
import { BankBreadcrumb, BankStatus, BANK_LABEL } from './bankUi.js';
import { selectionVerdict } from './groupSuggestions.js';
import { useBankDetail } from './useBankQueries.js';
import { bankMoney, decimalCents, decimalText } from './money.js';

type Action = { operation: 'bank_manage'; payload: BankManageSnapshot } | { operation: 'bank_post'; payload: BankPostSnapshot } | { operation: 'bank_finalize'; payload: BankFinalizeSnapshot };
export function BankWorkspace({ reconciliationId, catalog, onBack }: { reconciliationId: string; catalog: BankCatalog; onBack?: () => void }) {
  const query = useBankDetail(reconciliationId);
  const canManage = useAuthStore((s) => s.hasPermission('accounting.bank.manage'));
  const canValidate = useAuthStore((s) => s.hasPermission('accounting.bank.validate'));
  const canReadLedger = useAuthStore((s) => s.hasPermission('accounting.gl.read'));
  const canPost = useAuthStore((s) => s.hasPermission('accounting.bank.settle') && s.hasPermission('accounting.bank.manage') && s.hasPermission('accounting.je.create_manual'));
  const [bankIds,setBankIds] = useState<string[]>([]);
  const [glIds,setGlIds] = useState<string[]>([]);
  const [search,setSearch] = useState('');
  const [unmatchedOnly,setUnmatchedOnly] = useState(true);
  const [form,setForm] = useState<null | 'import' | 'balances' | 'finalize'>(null);
  const [post,setPost] = useState<GroupPost | null>(null);
  const [unmatch,setUnmatch] = useState<string | null>(null);
  const [action,setAction] = useState<Action | null>(null);
  const pages = query.data?.pages ?? [];
  const data = pages.at(-1);
  const back = onBack && <button type="button" className={TOOLBAR_BTN_SECONDARY} onClick={onBack}><ArrowLeft className={TOOLBAR_ICON} aria-hidden />All statements</button>;
  if (!data) return <div className="space-y-5"><BankBreadcrumb current="Statement" /><PageHeader title="Bank statement" actions={back} />
    <p role={query.error ? 'alert' : 'status'} className="text-sm text-text-secondary">{query.error?.message ?? 'Loading reconciliation…'}</p>
    {query.error && <Button variant="secondary" onClick={() => { void query.refetch(); }}>Retry</Button>}</div>;
  const rec = data.reconciliation;
  const bank = [...new Map(pages.flatMap((p) => p.bank_lines).map((line) => [line.id,line])).values()];
  const gl = [...new Map(pages.flatMap((p) => p.gl_lines).map((line) => [line.id,line])).values()];
  const selectedBank = bank.filter((line) => bankIds.includes(line.id) && !line.match_id);
  const selectedGl = gl.filter((line) => glIds.includes(line.id) && !line.match_id);
  const bankSum = selectedBank.reduce((sum,line) => sum + decimalCents(line.amount),0n);
  const glSum = selectedGl.reduce((sum,line) => sum + decimalCents(line.amount),0n);
  const verdict = selectionVerdict(bankSum,glSum,selectedBank.length,selectedGl.length);
  const editable = canManage && rec.status === 'draft' && !query.isFetching && !query.isError;
  const account = catalog.bank_accounts.find((a) => a.id === rec.account_id);
  const needle = search.toLowerCase();
  const displayBank = bank.filter((line) => (!unmatchedOnly || !line.match_id) && `${line.description} ${line.reference} ${line.transaction_date} ${line.amount}`.toLowerCase().includes(needle));
  const displayGl = gl.filter((line) => (!unmatchedOnly || !line.match_id) && `${line.description} ${line.entry_number} ${line.entry_date} ${line.amount}`.toLowerCase().includes(needle));
  const toggle = (setter: typeof setBankIds) => (id: string, checked: boolean) => setter((old) => checked ? [...new Set([...old,id])] : old.filter((entry) => entry !== id));
  const manage = (payload: BankManageSnapshot) => { setForm(null); setUnmatch(null); setAction({ operation: 'bank_manage',payload }); };
  const allLoaded = query.hasNextPage === false && !query.isFetching && !query.isError;
  const explained = bank.filter((line) => Boolean(line.match_id)).length;
  const openBank = bank.filter((line) => !line.match_id);
  const openAmount = openBank.reduce((sum,line) => sum + decimalCents(line.amount),0n);
  const finalizeReady = canValidate && rec.status === 'draft' && allLoaded && bank.every((line) => Boolean(line.match_id))
    && rec.opening_balance !== null && rec.closing_balance !== null && data.source_integrity?.state !== 'changed';
  const draft = rec.status === 'draft';
  const clearSelection = () => { setBankIds([]); setGlIds([]); };
  const verdictText = verdict.kind === 'exact' ? 'Exact match.' : verdict.kind === 'fee' ? `The bank kept ${bankMoney(verdict.fee)} as a fee.`
    : verdict.kind === 'mismatch' ? 'Amounts do not fit as a match or a fee.' : 'Select lines on both sides, or bank lines only for a bank entry.';
  return <div className="min-w-0 space-y-5">
    <BankBreadcrumb current={`${account?.code ?? rec.account_code} · ${rec.period_start.slice(0,7)}`} />
    <PageHeader title={`${account?.code ?? rec.account_code} · ${account?.name ?? rec.account_name ?? 'Bank account'}`}
      subtitle={<span className="flex flex-wrap items-center gap-2"><span className="font-data">{rec.period_start} → {rec.period_end}</span><BankStatus finalized={!draft} /></span>}
      actions={<>{back}
        <button type="button" className={TOOLBAR_BTN_SECONDARY} disabled={query.isFetching} onClick={() => { clearSelection(); void query.refetch(); }}><RefreshCw className={TOOLBAR_ICON} aria-hidden />Refresh</button>
        {canManage && <><button type="button" className={TOOLBAR_BTN_SECONDARY} disabled={!editable} onClick={() => setForm('balances')}>Statement balances</button>
          <button type="button" className={TOOLBAR_BTN_SECONDARY} disabled={!editable} onClick={() => setForm('import')}>Add statement file</button></>}
        {canValidate && <button type="button" className={TOOLBAR_BTN_PRIMARY} disabled={!finalizeReady} onClick={() => setForm('finalize')}><Lock className="h-3.5 w-3.5" aria-hidden />Finalize</button>}</>} />
    <BankRecovery target={rec.id} />
    {query.error && <p role="alert" className="text-sm text-danger">{query.error.message}. Loaded data may be outdated. Refresh before continuing.</p>}
    {data.source_integrity?.state === 'changed' && <p role="alert" className="rounded-md border border-danger bg-bg-elevated p-3 text-sm text-danger">The ledger changed after the recorded finalization. The frozen result is preserved; investigate the source changes before finalizing the next period. Recorded closing {bankMoney(data.source_integrity.recorded_gl_closing)} · current closing {bankMoney(data.source_integrity.current_gl_closing)}.</p>}
    {canValidate && draft && !finalizeReady && <p className="text-sm text-text-secondary">Finalize unlocks when every page is loaded, every bank line is explained, both statement balances are entered and no integrity warning remains.</p>}
    <div className="grid min-w-0 gap-[22px] lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-[22px]">
        {draft && canManage && <BankGroupSuggestions reconciliationId={rec.id} bankLines={bank} glLines={gl} allLoaded={allLoaded} canPost={canPost} busy={!editable} onPost={setPost} />}
        {canManage && draft && <BankSuggestions reconciliationId={rec.id} onReview={manage} />}
        <section aria-label="Manual matching" className="space-y-3">
          <div className="flex flex-wrap items-center gap-3"><h2 className="text-lg font-medium tracking-tight">Manual matching</h2>
            <Input className="h-9 max-w-xs" aria-label="Filter loaded bank and ledger lines" placeholder="Description, reference, date or amount" value={search} onChange={(e) => setSearch(e.target.value)} />
            <label className="flex items-center gap-2 text-sm"><input className={FOCUS_RING} type="checkbox" checked={unmatchedOnly} onChange={(e) => setUnmatchedOnly(e.target.checked)} />Unmatched only</label>
            <span className="text-xs text-text-muted">{allLoaded ? 'All lines loaded.' : 'Filters apply to loaded lines.'}</span></div>
          <div className="grid min-w-0 gap-4 2xl:grid-cols-2">
            <BankLinesTable title="Bank statement" lines={displayBank.map((l) => ({ id: l.id,date: l.transaction_date,label: l.description,reference: l.reference,amount: l.amount,matchId: l.match_id }))} selected={bankIds} editable={editable} onToggle={toggle(setBankIds)} onUnmatch={setUnmatch} />
            <BankLinesTable title="Bank ledger" lines={displayGl.map((l) => ({ id: l.id,date: l.entry_date,label: l.description,reference: `${l.entry_number} · ${l.reference_type}`,amount: l.amount,matchId: l.match_id }))} selected={glIds} editable={editable} onToggle={toggle(setGlIds)} onUnmatch={setUnmatch} />
          </div>
          {query.hasNextPage && <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => { void query.fetchNextPage(); }}>{query.isFetchingNextPage ? 'Loading…' : 'Load more statement and ledger lines'}</Button>}
        </section>
        {draft && <div className="bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border-strong bg-bg-elevated px-4 py-3 shadow-lg sm:sticky">
          <div className="min-w-0 text-sm"><p className="font-data tabular-nums"><span className={BANK_LABEL}>Bank</span> {selectedBank.length} · {bankMoney(decimalText(bankSum))} <span className="text-text-inert">↔</span> <span className={BANK_LABEL}>Ledger</span> {selectedGl.length} · {bankMoney(decimalText(glSum))}</p>
            <p className={verdict.kind === 'exact' ? 'text-success' : verdict.kind === 'mismatch' ? 'text-danger' : 'text-text-secondary'}>Difference <span className="font-data">{bankMoney(decimalText(bankSum-glSum))}</span>. {verdictText}</p></div>
          <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={clearSelection}>Clear selection</Button>
            {canPost && <Button variant="secondary" disabled={!editable || selectedBank.length === 0} onClick={() => setPost({ bankLines: selectedBank,glLines: selectedGl,preset: { kind: selectedGl.length > 0 ? 'net_fee' : 'settlement' } })}>Settlement / fees</Button>}
            {canPost && verdict.kind === 'fee' && <Button variant="secondary" disabled={!editable || selectedBank.length > 1000 || selectedGl.length > 1000} onClick={() => setPost({ bankLines: selectedBank,glLines: selectedGl,
              preset: { kind: 'net_fee',description: `Bank fee on ${selectedGl.map((l) => l.entry_number).slice(0,3).join(', ')}` } })}>Match with fee {bankMoney(verdict.fee)}</Button>}
            {canManage && <Button variant="secondary" disabled={!editable || verdict.kind !== 'exact' || selectedBank.length > 1000 || selectedGl.length > 1000} onClick={() => manage({ kind: 'match',reconciliationId: rec.id,bankIds: selectedBank.map((l) => l.id).sort(),glIds: selectedGl.map((l) => l.id).sort() })}>Review match</Button>}</div>
        </div>}
        <details className="rounded-md border border-border-subtle bg-bg-elevated px-4 py-3"><summary className={`cursor-pointer ${BANK_LABEL}`}>Sources, journal entries and match history</summary><div className="mt-3 space-y-3 text-sm">
          {data.imports.map((i) => <p className="break-all" key={i.id}>{i.file_name} · {i.sheet_name}<br /><span className="font-data text-xs text-text-muted">SHA-256 {i.source_sha256}</span></p>)}
          {data.entries.map((entry) => <p key={entry.id}>{entry.kind} · fee <span className="font-data">{bankMoney(entry.fee_amount)}</span> · {canReadLedger && <Link className={`text-gold underline ${FOCUS_RING}`} to={`/backoffice/accounting/general-ledger?account_id=${rec.account_id}&start=${rec.period_start}&end=${rec.period_end}`}>View bank ledger</Link>} · <span className="font-data text-xs text-text-muted">{entry.journal_entry_id}</span></p>)}
          {data.matches.map((match) => <p key={match.id}><span className="font-data">{bankMoney(match.amount)}</span> · {match.bank_line_ids.length} bank / {match.gl_line_ids.length} ledger · {match.removed_at ? `Removed: ${match.removal_reason}` : 'Active'}</p>)}
          {data.match_history_truncated && <p>Only the 100 most recent associations are shown. Use the audit log for the full history; linked rows can still be unlinked from either panel.</p>}
          {rec.snapshot_sha256 && <p className="break-all font-data text-xs">Frozen snapshot SHA-256 {rec.snapshot_sha256}</p>}
          {data.imports.length + data.entries.length + data.matches.length === 0 && <p className="text-text-muted">Nothing recorded yet.</p>}
        </div></details>
      </div>
      <BankRail data={data} explained={explained} total={rec.row_count ?? bank.length} openCount={openBank.length} openAmount={openAmount} allLoaded={allLoaded} />
    </div>
    {form === 'import' && <BankImportDialog accounts={catalog.bank_accounts} existing={rec} onClose={() => setForm(null)} onReady={(statement) => manage({ kind: 'import',statement })} />}
    {form === 'balances' && <BankBalanceDialog reconciliation={rec} onClose={() => setForm(null)} onReady={manage} />}
    {post && <BankPostDialog key={`${post.preset.kind}:${post.bankLines.map((l) => l.id).join(',')}`} reconciliation={rec} bankLines={post.bankLines} glLines={post.glLines} preset={post.preset}
      accounts={catalog.counter_accounts} clearingAccounts={catalog.clearing_accounts} onClose={() => setPost(null)} onReady={(payload) => { setPost(null); setAction({ operation: 'bank_post',payload }); }} />}
    {form === 'finalize' && <BankFinalizeDialog reconciliationId={rec.id} unmatched={gl.filter((l) => !l.match_id)} onClose={() => setForm(null)} onReady={(payload) => { setForm(null); setAction({ operation: 'bank_finalize',payload }); }} />}
    {unmatch && <BankUnmatchDialog reconciliationId={rec.id} matchId={unmatch} onClose={() => setUnmatch(null)} onReady={manage} />}
    {action && <BankAttemptDialog operation={action.operation} target={rec.id} payload={action.payload} onClose={() => setAction(null)} onSuccess={clearSelection} />}
  </div>;
}
