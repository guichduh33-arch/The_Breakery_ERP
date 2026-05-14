// apps/backoffice/src/features/accounting-mappings/components/MappingEditDialog.tsx
//
// Session 13 / Phase 6.C — Edit dialog for a single accounting_mappings row.
// Account picker is filtered to is_postable + is_active accounts. The reason
// is required (3..200 chars) and surfaces in the `audit_logs` row.

import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Input,
} from '@breakery/ui';
import { useUpdateMapping } from '../hooks/useUpdateMapping.js';
import { usePostableAccounts, type MappingRow } from '../hooks/useMappings.js';

interface Draft {
  account_code: string;
  is_active:    boolean;
  reason:       string;
}

function rowToDraft(row: MappingRow): Draft {
  return {
    account_code: row.account_code,
    is_active:    row.is_active,
    reason:       '',
  };
}

function validate(d: Draft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (d.account_code.trim() === '') errors.account_code = 'Required';
  const r = d.reason.trim();
  if (r.length < 3)   errors.reason = 'Reason must be at least 3 characters';
  if (r.length > 200) errors.reason = 'Reason must be 200 chars or less';
  return errors;
}

export interface MappingEditDialogProps {
  open:    boolean;
  initial: MappingRow | undefined;
  onClose: () => void;
}

export function MappingEditDialog({ open, initial, onClose }: MappingEditDialogProps) {
  const accounts = usePostableAccounts();
  const update   = useUpdateMapping();

  const [draft, setDraft]       = useState<Draft>({
    account_code: '',
    is_active: true,
    reason: '',
  });
  const [errors, setErrors]     = useState<Record<string, string>>({});
  const [serverErr, setServer]  = useState<string | null>(null);

  useEffect(() => {
    if (open && initial) {
      setDraft(rowToDraft(initial));
      setErrors({});
      setServer(null);
    }
  }, [open, initial]);

  if (!initial) return null;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validate(draft);
    setErrors(v);
    if (Object.keys(v).length > 0) return;

    setServer(null);
    update.mutate(
      {
        mapping_key:  initial!.mapping_key,
        account_code: draft.account_code,
        is_active:    draft.is_active,
        reason:       draft.reason.trim(),
      },
      {
        onSuccess: () => onClose(),
        onError: (err) => setServer(err.message ?? 'Update failed'),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Edit mapping: {initial.mapping_key}</DialogTitle>
        <DialogDescription>
          Rewire this symbolic mapping key to a different posting account, or
          deactivate it. Only postable + active accounts are listed. Every
          change is logged in <code>audit_logs</code>.
        </DialogDescription>

        <form onSubmit={onSubmit} className="space-y-4 mt-2">
          {initial.description && (
            <p className="text-xs text-text-secondary italic">{initial.description}</p>
          )}

          <div className="space-y-1">
            <label htmlFor="account_code" className="text-xs uppercase tracking-widest text-text-secondary">
              Account
            </label>
            <select
              id="account_code"
              value={draft.account_code}
              onChange={(e) => setDraft({ ...draft, account_code: e.target.value })}
              className="w-full h-10 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
              disabled={accounts.isLoading}
            >
              <option value="" disabled>Select an account…</option>
              {accounts.data?.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
            {errors.account_code && (
              <div className="text-xs text-red">{errors.account_code}</div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              id="is_active"
              type="checkbox"
              checked={draft.is_active}
              onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
              className="h-4 w-4"
            />
            <label htmlFor="is_active" className="text-sm">
              Active (mapping is consulted by JE triggers)
            </label>
          </div>

          <div className="space-y-1">
            <label htmlFor="reason" className="text-xs uppercase tracking-widest text-text-secondary">
              Reason for change (3..200 chars)
            </label>
            <Input
              id="reason"
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
              placeholder="e.g. Move PB1 to new tax ledger account 2111"
              maxLength={200}
            />
            {errors.reason && (
              <div className="text-xs text-red">{errors.reason}</div>
            )}
          </div>

          {serverErr && (
            <div className="text-sm text-red bg-red-soft px-3 py-2 rounded-md">
              {serverErr}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
