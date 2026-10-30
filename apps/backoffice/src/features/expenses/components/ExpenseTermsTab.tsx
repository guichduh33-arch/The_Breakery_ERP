import { useState, type JSX } from 'react';
import { Input } from '@breakery/ui';
import { Button } from '@/components/BackofficeUi.js';
import { useAuthStore } from '@/stores/authStore.js';
import { useExpenseTerms, type ExpenseTerm } from '../hooks/useExpenseTerms.js';
import { ExpenseTermDialog } from './ExpenseTermDialog.js';

export function ExpenseTermsTab(): JSX.Element {
  const canManage = useAuthStore(s => s.hasPermission('expenses.categories.manage'));
  const query = useExpenseTerms(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ExpenseTerm | 'new' | null>(null);
  if (query.isLoading) return <p role="status">Loading expense terms…</p>;
  if (query.error) return <p role="alert" className="text-danger">Failed to load expense terms: {query.error.message}</p>;
  const needle = search.trim().toLocaleLowerCase();
  const rows = (query.data ?? []).filter(t => [t.code,t.name,t.category_name,t.account_code,...t.aliases]
    .some(v => v.toLocaleLowerCase().includes(needle)));
  return <div className="space-y-4">
    <p className="text-sm text-text-secondary">Standard names determine the category and its existing accounting account. Add transaction details in Remarks.</p>
    <div className="flex items-center gap-3"><Input aria-label="Search terms" placeholder="Search names or synonyms…" value={search}
      maxLength={120} onChange={e => setSearch(e.target.value)} />
      {canManage && <Button size="sm" onClick={() => setEditing('new')}>New term</Button>}</div>
    {rows.length === 0 ? <p>No matching expense terms.</p> : <div className="overflow-x-auto rounded-md border border-border-subtle">
      <table className="w-full text-sm"><caption className="sr-only">Standard expense terms and accounting accounts</caption>
        <thead><tr>{['Code','Standard name','Synonyms','Category','Account','Status',...(canManage ? ['Actions'] : [])]
          .map(h => <th key={h} scope="col" className="px-4 py-3 text-left font-semibold">{h}</th>)}</tr></thead>
        <tbody>{rows.map(t => <tr key={t.id} className="border-t border-border-subtle">
          <td className="px-4 py-3 font-mono">{t.code}</td><td className="px-4 py-3">{t.name}</td>
          <td className="px-4 py-3">{t.aliases.join(', ') || '—'}</td><td className="px-4 py-3">{t.category_name}</td>
          <td className="px-4 py-3">{t.account_code} — {t.account_name}</td><td className="px-4 py-3">{t.is_available ? 'Active' : 'Unavailable'}</td>
          {canManage && <td className="px-4 py-3"><Button size="sm" variant="secondary" aria-label={'Edit ' + t.name} onClick={() => setEditing(t)}>Edit</Button></td>}
        </tr>)}</tbody>
      </table>
    </div>}
    {editing !== null && <ExpenseTermDialog {...(editing === 'new' ? {} : {term: editing})} onClose={() => setEditing(null)} />}
  </div>;
}
