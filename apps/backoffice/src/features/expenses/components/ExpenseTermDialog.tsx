import { useState, type JSX } from 'react';
import { Dialog, DialogDescription, Input, Select } from '@breakery/ui';
import { Button, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/BackofficeUi.js';
import { FormField } from '@/components/FormField.js';
import { useExpenseCategories } from '../hooks/useExpensesList.js';
import { useSaveExpenseTerm, type ExpenseTerm } from '../hooks/useExpenseTerms.js';

export function ExpenseTermDialog({ term, onClose }: { term?: ExpenseTerm; onClose: () => void }): JSX.Element {
  const categories = useExpenseCategories();
  const save = useSaveExpenseTerm();
  const [code, setCode] = useState(term?.code ?? '');
  const [name, setName] = useState(term?.name ?? '');
  const [category, setCategory] = useState(term?.category_id ?? '');
  const [aliases, setAliases] = useState(term?.aliases.join(', ') ?? '');
  const [active, setActive] = useState(term?.is_active ?? true);
  return <Dialog open onOpenChange={open => { if (!open && !save.isPending) onClose(); }}>
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>{term ? 'Edit expense term' : 'New expense term'}</DialogTitle>
        <DialogDescription>Use one standard name per product or service. Synonyms help users find it.</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={event => {
        event.preventDefault();
        if (!code.trim() || !name.trim() || !category || save.isPending) return;
        save.mutate({ ...(term ? {id: term.id} : {}), code, name, category_id: category,
          aliases: aliases.split(',').map(a => a.trim()).filter(Boolean), is_active: active }, {onSuccess: onClose});
      }}>
        <FormField id="term-code" label="Code" required><Input value={code} required maxLength={64}
          disabled={Boolean(term) || save.isPending} onChange={e => setCode(e.target.value)} /></FormField>
        <FormField id="term-name" label="Standard name" required><Input value={name} required maxLength={120}
          disabled={term?.is_used === true || save.isPending} onChange={e => setName(e.target.value)} /></FormField>
        <FormField id="term-category" label="Category" required><Select value={category} required
          disabled={term?.is_used === true || save.isPending || categories.isLoading || categories.isError} onChange={e => setCategory(e.target.value)}>
          <option value="">Select a category…</option>
          {term && !categories.data?.some(c => c.id === term.category_id) && <option value={term.category_id}>{term.category_name} (unavailable)</option>}
          {(categories.data ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select></FormField>
        {categories.error && <p role="alert" className="text-sm text-danger">Failed to load categories.</p>}
        {term?.is_used && <p className="text-sm text-text-secondary">The name and category are locked because this term has been used.</p>}
        {term && <p className="text-sm text-text-secondary">Current account: {term.account_code} — {term.account_name}</p>}
        <FormField id="term-aliases" label="Search synonyms"><Input value={aliases} maxLength={6000}
          disabled={save.isPending} onChange={e => setAliases(e.target.value)} placeholder="Comma-separated names, e.g. PLN, Listrik" /></FormField>
        <p className="text-sm text-text-secondary">Each name or synonym can belong to only one term, including inactive terms.</p>
        <FormField id="term-status" label="Status"><Select value={active ? 'active' : 'inactive'} disabled={save.isPending}
          onChange={e => setActive(e.target.value === 'active')}><option value="active">Active</option><option value="inactive">Inactive</option></Select></FormField>
        {save.error && <p role="alert" className="text-sm text-danger">{save.error.message}</p>}
        <DialogFooter><Button type="button" variant="secondary" disabled={save.isPending} onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save term'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
