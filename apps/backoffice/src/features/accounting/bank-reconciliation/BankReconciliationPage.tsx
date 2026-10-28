import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Select } from '@breakery/ui';
import { Button, EmptyState } from '@/components/BackofficeUi.js';
import { PageHeader } from '@/components/PageHeader.js';
import { useAuthStore } from '@/stores/authStore.js';
import { bankUuid, type BankImportPayload } from '@/lib/bankAttemptSchema.js';
import { record } from './contracts.js';
import { useBankCatalog, useBankList } from './useBankQueries.js';
import { BankRecovery } from './BankRecovery.js';
import { BankImportDialog } from './BankImportDialog.js';
import { BankAttemptDialog } from './BankAttemptDialog.js';
import { BankWorkspace } from './BankWorkspace.js';
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
  return <div className="min-w-0 space-y-5">
    <PageHeader title="Bank reconciliation" subtitle="Compare bank statements with posted transactions, resolve actual fees and validate exact balances."
      actions={canManage && !selected ? <Button disabled={!catalog.data} onClick={() => setImportOpen(true)}>Import statement</Button> : undefined} />
    {catalog.error && <p role="alert" className="text-danger">{catalog.error.message}<Button variant="secondary" onClick={() => { void catalog.refetch(); }}>Retry accounts</Button></p>}
    {selected ? <>
      <Button variant="secondary" onClick={() => setParams({})}>Back to statements</Button>
      {!bankUuid(selected) ? <p role="alert">Invalid statement address.</p> : catalog.data ? <BankWorkspace key={selected} reconciliationId={selected} catalog={catalog.data} /> : <p role="status">Loading bank accounts…</p>}
    </> : <>
      <BankRecovery />
      <label className="block max-w-sm space-y-1 text-sm">Bank account<Select value={account} onChange={(e) => setAccount(e.target.value)}><option value="">All bank accounts</option>{catalog.data?.bank_accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</Select></label>
      {list.isLoading && <p role="status">Loading statements…</p>}
      {list.error && <p role="alert" className="text-danger">{list.error.message}<Button variant="secondary" onClick={() => { void list.refetch(); }}>Retry statements</Button></p>}
      {!list.isLoading && !list.isError && items.length === 0 && <EmptyState title="No bank statements" description="Import a statement to review its movements alongside the bank ledger." />}
      {items.length > 0 && <div className="overflow-x-auto rounded border border-border-subtle bg-bg-elevated"><table className="w-full text-sm"><thead><tr><th>Account / period</th><th>Movements</th><th>Opening</th><th>Closing</th><th>Status</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>
        {items.map((item) => <tr key={item.id} className="border-t border-border-subtle"><td>{item.account_code} · {item.account_name}<p className="whitespace-nowrap text-xs text-text-secondary">{item.period_start} → {item.period_end}</p></td>
          <td>{item.matched_count ?? '—'} / {item.row_count ?? '—'} matched</td><td className="whitespace-nowrap font-data">{bankMoney(item.opening_balance)}</td><td className="whitespace-nowrap font-data">{bankMoney(item.closing_balance)}</td><td>{item.status === 'finalized' ? 'Finalized' : 'Draft'}</td>
          <td><Link className="text-gold underline" to={`?statement=${item.id}`}>Open</Link></td></tr>)}
      </tbody></table></div>}
      {list.hasNextPage && <Button variant="secondary" disabled={list.isFetchingNextPage} onClick={() => { void list.fetchNextPage(); }}>Load more statements</Button>}
    </>}
    {importOpen && catalog.data && <BankImportDialog accounts={catalog.data.bank_accounts} onClose={() => setImportOpen(false)} onReady={(payload) => { setImportOpen(false); setStatement(payload); }} />}
    {statement && <BankAttemptDialog operation="bank_manage" target="new" payload={{ kind: 'import',statement }} onClose={() => setStatement(null)} onSuccess={(result) => {
      const response = record(result); if (bankUuid(response.reconciliation_id)) setParams({ statement: response.reconciliation_id });
    }} />}
  </div>;
}
