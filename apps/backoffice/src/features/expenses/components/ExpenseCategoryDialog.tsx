import { useState, type JSX } from 'react';
import { Dialog, DialogDescription, Input, Select } from '@breakery/ui';
import { FormField } from '@/components/FormField.js';
import { Button, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/BackofficeUi.js';
import { useSaveExpenseCategory, type ExpenseAccount, type ExpenseCategoryAdmin } from '../hooks/useExpenseCategoriesAdmin.js';

export function ExpenseCategoryDialog({ category, accounts, onClose }: {
  category?: ExpenseCategoryAdmin;
  accounts: ExpenseAccount[];
  onClose: () => void;
}): JSX.Element {
  const [code, setCode] = useState(category?.code ?? '');
  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [account, setAccount] = useState(category?.account_id ?? '');
  const [active, setActive] = useState(category?.is_active ?? true);
  const save = useSaveExpenseCategory();
  const accountMissing = category !== undefined && !accounts.some((a) => a.id === category.account_id);
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !save.isPending) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{category ? 'Edit expense category' : 'New expense category'}</DialogTitle>
          <DialogDescription>Choose the account used when expenses are approved.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || !code.trim() || !account || save.isPending) return;
          save.mutate({
            ...(category ? { id: category.id } : { code: code.trim() }),
            name: name.trim(), description: description.trim() || null,
            account_id: account, is_active: active,
          }, { onSuccess: onClose });
        }}>
          <FormField id="expense-category-code" label="Code" required>
            <Input id="expense-category-code" value={code} onChange={(e) => setCode(e.target.value)}
              required maxLength={64} disabled={category !== undefined || save.isPending} />
          </FormField>
          <FormField id="expense-category-name" label="Name" required>
            <Input id="expense-category-name" value={name} onChange={(e) => setName(e.target.value)}
              required maxLength={120} disabled={save.isPending} />
          </FormField>
          <FormField id="expense-category-description" label="Description">
            <Input id="expense-category-description" value={description} onChange={(e) => setDescription(e.target.value)}
              maxLength={2000} disabled={save.isPending} />
          </FormField>
          <FormField id="expense-category-account" label="Expense account" required>
            <Select id="expense-category-account" value={account} onChange={(e) => setAccount(e.target.value)}
              required disabled={category?.is_used === true || save.isPending}>
              <option value="">Select an account…</option>
              {accountMissing && category && <option value={category.account_id}>{category.account_code} — {category.account_name} (unavailable)</option>}
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </Select>
          </FormField>
          {category?.is_used === true && <p className="text-sm text-text-secondary">The account is locked because this category has been used by an expense.</p>}
          <FormField id="expense-category-status" label="Status">
            <Select id="expense-category-status" value={active ? 'active' : 'inactive'}
              onChange={(e) => setActive(e.target.value === 'active')} disabled={save.isPending}>
              <option value="active">Active</option><option value="inactive">Inactive</option>
            </Select>
          </FormField>
          <p className="text-sm text-text-secondary">Inactive categories cannot be assigned to new expenses. Existing expenses can still be processed.</p>
          {save.error && <p role="alert" className="text-sm text-danger">{save.error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button>
            <Button type="submit" disabled={save.isPending || !name.trim() || !code.trim() || !account}>
              {save.isPending ? 'Saving…' : 'Save category'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
