import { useState, type JSX } from 'react';
import { Button } from '@/components/BackofficeUi.js';
import { useAuthStore } from '@/stores/authStore.js';
import { useExpenseCategoriesAdmin, type ExpenseCategoryAdmin } from '../hooks/useExpenseCategoriesAdmin.js';
import { ExpenseCategoryDialog } from './ExpenseCategoryDialog.js';

export function ExpenseCategoriesTab(): JSX.Element {
  const canManage = useAuthStore((s) => s.hasPermission('expenses.categories.manage'));
  const query = useExpenseCategoriesAdmin();
  const [editing, setEditing] = useState<ExpenseCategoryAdmin | 'new' | null>(null);
  if (query.isLoading) return <p role="status">Loading categories…</p>;
  if (query.error) return <p role="alert" className="text-danger">Failed to load categories: {query.error.message}</p>;
  const data = query.data;
  if (!data) return <p role="alert">Categories are unavailable.</p>;
  return (
    <div className="space-y-4">
      {canManage && <Button onClick={() => setEditing('new')}>New category</Button>}
      {data.categories.length === 0 ? <p>No expense categories.</p> : (
        <div className="overflow-x-auto rounded-md border border-border-subtle">
          <table className="w-full text-sm">
            <caption className="sr-only">Expense categories, account and status</caption>
            <thead><tr>
              {['Code', 'Name', 'Description', 'Account', 'Status', ...(canManage ? ['Actions'] : [])].map((h) => (
                <th key={h} scope="col" className="px-4 py-3 text-left font-semibold">{h}</th>
              ))}
            </tr></thead>
            <tbody>{data.categories.map((c) => <tr key={c.id} className="border-t border-border-subtle">
              <td className="px-4 py-3 font-mono">{c.code}</td>
              <td className="px-4 py-3">{c.name}</td>
              <td className="px-4 py-3">{c.description ?? '—'}</td>
              <td className="px-4 py-3">{c.account_code} — {c.account_name}</td>
              <td className="px-4 py-3">{c.is_active ? 'Active' : 'Inactive'}</td>
              {canManage && <td className="px-4 py-3"><Button variant="secondary" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c)}>Edit</Button></td>}
            </tr>)}</tbody>
          </table>
        </div>
      )}
      {editing !== null && <ExpenseCategoryDialog
        {...(editing === 'new' ? {} : { category: editing })} accounts={data.accounts} onClose={() => setEditing(null)} />}
    </div>
  );
}
