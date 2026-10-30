import { useState, type JSX } from 'react';
import { Input, Select } from '@breakery/ui';
import { useExpenseTerms, type ExpenseTerm } from '../hooks/useExpenseTerms.js';

export function ExpenseTermPicker({ value, onSelect, id, required, disabled,
  'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedby,
}: { value: string; onSelect: (term: ExpenseTerm | undefined) => void; id?: string;
  required?: boolean; disabled?: boolean; 'aria-invalid'?: boolean; 'aria-describedby'?: string }): JSX.Element {
  const query = useExpenseTerms();
  const [search, setSearch] = useState('');
  const selected = query.data?.find(t => t.id === value);
  const needle = search.trim().toLocaleLowerCase();
  const terms = (query.data ?? []).filter(t => t.id === value ||
    [t.name, t.code, ...t.aliases].some(label => label.toLocaleLowerCase().includes(needle)));
  return <div className="space-y-2">
    <Input aria-label="Search expense terms" placeholder="Search a name or synonym…" value={search}
      maxLength={120} disabled={disabled} onChange={e => setSearch(e.target.value)} />
    <Select id={id} value={value} required={required} disabled={disabled === true || query.isLoading || query.isError}
      aria-invalid={ariaInvalid} aria-describedby={ariaDescribedby}
      onChange={e => onSelect(query.data?.find(t => t.id === e.target.value))}>
      <option value="">Select an expense term…</option>
      {value && !selected && <option value={value} disabled>Unavailable term — select another</option>}
      {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
    </Select>
    {query.isLoading && <p role="status" className="text-sm text-text-secondary">Loading expense terms…</p>}
    {query.error && <p role="alert" className="text-sm text-danger">Failed to load expense terms. <button type="button" className="underline" onClick={() => { void query.refetch(); }}>Retry</button></p>}
    {!query.isLoading && !query.isError && terms.length === 0 && <p role="status" className="text-sm text-text-secondary">No matching terms. Ask an authorized manager to add the required term.</p>}
    {selected && <p className="text-sm text-text-secondary">{selected.category_name} · {selected.account_code} — {selected.account_name}</p>}
  </div>;
}
