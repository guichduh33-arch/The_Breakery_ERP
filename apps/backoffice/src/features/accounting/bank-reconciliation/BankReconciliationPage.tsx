import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Upload } from 'lucide-react';
import { Select } from '@breakery/ui';
import { Button, EmptyState } from '@/components/BackofficeUi.js';
import { PageHeader } from '@/components/PageHeader.js';
import { TOOLBAR_BTN_PRIMARY, TOOLBAR_ICON } from '@/components/toolbarButton.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { useAuthStore } from '@/stores/authStore.js';
import { bankUuid, type BankImportPayload } from '@/lib/bankAttemptSchema.js';
import { record } from './contracts.js';
import { useBankCatalog, useBankList } from './useBankQueries.js';
import { BankRecovery } from './BankRecovery.js';
import { BankImportDialog } from './BankImportDialog.js';
import { BankAttemptDialog } from './BankAttemptDialog.js';
import { BankWorkspace } from './BankWorkspace.js';
import { BankBreadcrumb, BankStatus, BANK_LABEL, BANK_TD, BANK_TH } from './bankUi.js';
import { bankMoney } from './money.js';

export default function BankReconciliationPage() {
  const identity = useAuthStore((s) => `${s.user?.id ?? ''}:${s.sessionToken ?? ''}`);
  return <BankPageSession key={identity} />;
}
function BankPageSession() {
  const [params,setParams] = useSearchParams();
  const selected = params.get('statement') ?? '';
  const [account,setAccount] = useState('');
  const [importOpen,setImportOpen] = useState(false);
  const [statement,setStatement] = useState<BankImportPayload | null>(null);
  const catalog = useBankCatalog();
  const list = useBankList(account);
  const canRead = useAuthStore((s) => s.hasPermission('accounting.bank.read'));
  const canManage = useAuthStore((s) => s.hasPermission('accounting.bank.manage'));
  if (!canRead) return <p role="alert">Bank reconciliation access is restricted.</p>;
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const catalogError = catalog.error && <p role="alert" className="text-sm text-danger">{catalog.error.message} <Button variant="secondary" onClick={() => { void catalog.refetch(); }}>Retry accounts</Button></p>;
  const dialogs = <>
    {importOpen && catalog.data && <BankImportDialog accounts={catalog.data.bank_accounts} onClose={() => setImportOpen(false)} onReady={(payload) => { setImportOpen(false); setStatement(payload); }} />}
    {statement && <BankAttemptDialog operation="bank_manage" target="new" payload={{ kind: 'import',statement }} onClose={() => setStatement(null)} onSuccess={(result) => {
      const response = record(result); if (bankUuid(response.reconciliation_id)) setParams({ statement: response.reconciliation_id });
    }} />}
  </>;
  if (selected) return <div className="min-w-0 space-y-5">
    {catalogError}
    {!bankUuid(selected) ? <><BankBreadcrumb /><p role="alert">Invalid statement address.</p></>
      : catalog.data ? <BankWorkspace key={selected} reconciliationId={selected} catalog={catalog.data} onBack={() => setParams({})} />
      : <><BankBreadcrumb /><p role="status" className="text-sm text-text-secondary">Loading bank accounts…</p></>}
    {dialogs}
  </div>;
  return <div className="min-w-0 space-y-5">
    <BankBreadcrumb />
    <PageHeader title="Bank reconciliation" subtitle="Match each bank statement with the ledger, explain the fees, and freeze the result once the balances agree."
      actions={canManage ? <button type="button" className={TOOLBAR_BTN_PRIMARY} disabled={!catalog.data} onClick={() => setImportOpen(true)}>
        <Upload className={TOOLBAR_ICON} aria-hidden />Import statement</button> : undefined} />
    {catalogError}
    <BankRecovery />
    <section aria-label="Bank statements" className="overflow-hidden rounded-md border border-border-subtle bg-bg-elevated">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-3.5 py-2.5">
        <label className="flex items-center gap-2 text-sm"><span className={BANK_LABEL}>Account</span>
          <Select className="h-9 w-64" value={account} onChange={(e) => setAccount(e.target.value)}><option value="">All bank accounts</option>
            {catalog.data?.bank_accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></label>
        {list.isLoading && <p role="status" className="text-sm text-text-secondary">Loading statements…</p>}
      </div>
      {list.error && <p role="alert" className="p-3.5 text-sm text-danger">{list.error.message} <Button variant="secondary" onClick={() => { void list.refetch(); }}>Retry statements</Button></p>}
      {!list.isLoading && !list.isError && items.length === 0 ? <div className="p-6"><EmptyState title="No bank statements" description="Import a statement to review its movements alongside the bank ledger." /></div>
        : items.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[44rem] text-sm">
          <thead><tr><th scope="col" className={BANK_TH}>Account · period</th><th scope="col" className={BANK_TH}>Explained</th>
            <th scope="col" className={`${BANK_TH} text-right`}>Opening</th><th scope="col" className={`${BANK_TH} text-right`}>Closing</th>
            <th scope="col" className={BANK_TH}>Status</th><th scope="col" className={BANK_TH}><span className="sr-only">Open</span></th></tr></thead>
          <tbody>{items.map((item) => {
            const done = item.row_count ? Math.round(((item.matched_count ?? 0) / item.row_count) * 100) : 0;
            return <tr key={item.id} className="border-t border-border-row hover:bg-surface-inert">
              <td className={BANK_TD}><p className="font-medium">{item.account_code} · {item.account_name}</p><p className="font-data text-xs text-text-secondary">{item.period_start} → {item.period_end}</p></td>
              <td className={BANK_TD}><p className="font-data tabular-nums">{item.matched_count ?? '—'} / {item.row_count ?? '—'}</p>
                <div aria-hidden className="mt-1 h-1 w-24 overflow-hidden rounded-sm bg-border-subtle"><div className="h-full bg-success" style={{ width: `${done}%` }} /></div></td>
              <td className={`${BANK_TD} whitespace-nowrap text-right font-data tabular-nums`}>{bankMoney(item.opening_balance)}</td>
              <td className={`${BANK_TD} whitespace-nowrap text-right font-data tabular-nums`}>{bankMoney(item.closing_balance)}</td>
              <td className={BANK_TD}><BankStatus finalized={item.status === 'finalized'} /></td>
              <td className={`${BANK_TD} text-right`}><Link className={`text-sm font-medium text-gold underline-offset-4 hover:underline ${FOCUS_RING}`} to={`?statement=${item.id}`}>Open</Link></td>
            </tr>;
          })}</tbody></table></div>}
      <div className="flex items-center justify-between gap-3 border-t border-border-subtle bg-surface-inert px-3.5 py-2 text-xs text-text-muted">
        <span className="font-data">{items.length} {items.length === 1 ? 'statement' : 'statements'} loaded{list.hasNextPage ? ' · more exist' : ''}</span>
        {list.hasNextPage && <Button variant="secondary" disabled={list.isFetchingNextPage} onClick={() => { void list.fetchNextPage(); }}>Load more statements</Button>}
      </div>
    </section>
    {dialogs}
  </div>;
}
