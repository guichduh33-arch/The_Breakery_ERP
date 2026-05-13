// apps/backoffice/src/features/suppliers/components/SupplierFormModal.tsx
//
// Create / edit dialog for the suppliers BO. Plain React state + inline
// validation that emits a path → message error map. Mirrors the session 9/10
// modal pattern: shared @breakery/ui Dialog primitives, single submit handler,
// server errors surfaced as a banner.

import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@breakery/ui';
import { useCreateSupplier } from '../hooks/useCreateSupplier.js';
import { useUpdateSupplier } from '../hooks/useUpdateSupplier.js';
import type { SupplierRow } from '../hooks/useSuppliersList.js';

interface Draft {
  code: string;
  name: string;
  contact_phone: string;
  contact_email: string;
  address: string;
  payment_terms_days: number;
  notes: string;
  is_active: boolean;
}

const DEFAULT: Draft = {
  code: '',
  name: '',
  contact_phone: '',
  contact_email: '',
  address: '',
  payment_terms_days: 30,
  notes: '',
  is_active: true,
};

// Conservative RFC-5322-ish email check — good enough for an internal back
// office form. The DB column is plain TEXT so the real validation is UX-only.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(d: Draft): Record<string, string> {
  const errors: Record<string, string> = {};
  const code = d.code.trim();
  if (code.length === 0) errors.code = 'Code is required';
  else if (code.length > 32) errors.code = '≤ 32 chars';

  const name = d.name.trim();
  if (name.length === 0) errors.name = 'Name is required';
  else if (name.length > 120) errors.name = '≤ 120 chars';

  if (d.contact_phone.trim().length > 32) errors.contact_phone = '≤ 32 chars';

  const email = d.contact_email.trim();
  if (email.length > 0) {
    if (email.length > 120) errors.contact_email = '≤ 120 chars';
    else if (!EMAIL_RE.test(email)) errors.contact_email = 'Invalid email';
  }

  if (d.address.trim().length > 255) errors.address = '≤ 255 chars';

  if (!Number.isInteger(d.payment_terms_days)) {
    errors.payment_terms_days = 'Must be an integer';
  } else if (d.payment_terms_days < 0) {
    errors.payment_terms_days = 'Must be ≥ 0';
  } else if (d.payment_terms_days > 365) {
    errors.payment_terms_days = '≤ 365';
  }

  if (d.notes.trim().length > 500) errors.notes = '≤ 500 chars';

  return errors;
}

function rowToDraft(row: SupplierRow): Draft {
  return {
    code: row.code,
    name: row.name,
    contact_phone: row.contact_phone ?? '',
    contact_email: row.contact_email ?? '',
    address: row.address ?? '',
    payment_terms_days: row.payment_terms_days,
    notes: row.notes ?? '',
    is_active: row.is_active,
  };
}

function draftToPayload(d: Draft) {
  return {
    code: d.code.trim(),
    name: d.name.trim(),
    contact_phone: d.contact_phone.trim() === '' ? null : d.contact_phone.trim(),
    contact_email: d.contact_email.trim() === '' ? null : d.contact_email.trim(),
    address:       d.address.trim()       === '' ? null : d.address.trim(),
    notes:         d.notes.trim()         === '' ? null : d.notes.trim(),
    payment_terms_days: d.payment_terms_days,
    is_active: d.is_active,
  };
}

export interface SupplierFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: SupplierRow | undefined;
  onClose: () => void;
}

export function SupplierFormModal({ open, mode, initial, onClose }: SupplierFormModalProps) {
  const createMut = useCreateSupplier();
  const updateMut = useUpdateSupplier();

  const [draft, setDraft] = useState<Draft>(initial ? rowToDraft(initial) : DEFAULT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(initial ? rowToDraft(initial) : DEFAULT);
      setErrors({});
      setServerError(null);
    }
  }, [open, initial]);

  const pending = createMut.isPending || updateMut.isPending;

  async function handleSubmit() {
    setServerError(null);
    const issues = validate(draft);
    if (Object.keys(issues).length > 0) {
      setErrors(issues);
      return;
    }
    setErrors({});
    const payload = draftToPayload(draft);
    try {
      if (mode === 'create') {
        await createMut.mutateAsync(payload);
      } else if (initial !== undefined) {
        await updateMut.mutateAsync({ id: initial.id, values: payload });
      }
      onClose();
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Failed to save supplier');
    }
  }

  function setField<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogTitle>{mode === 'create' ? 'New supplier' : `Edit ${initial?.name ?? ''}`}</DialogTitle>
        <DialogDescription>Suppliers feed the inventory receiving flow. Code must be unique.</DialogDescription>

        <div className="grid grid-cols-2 gap-4 py-4">
          <div className="col-span-1">
            <label htmlFor="sup-code" className="text-xs uppercase tracking-widest text-text-secondary">Code *</label>
            <input id="sup-code" value={draft.code} onChange={(e) => setField('code', e.target.value)}
              maxLength={32} disabled={mode === 'edit'}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm font-mono uppercase text-text-primary disabled:opacity-50" />
            {errors.code && <p className="text-red text-xs mt-1">{errors.code}</p>}
          </div>
          <div className="col-span-1">
            <label htmlFor="sup-name" className="text-xs uppercase tracking-widest text-text-secondary">Name *</label>
            <input id="sup-name" value={draft.name} onChange={(e) => setField('name', e.target.value)} maxLength={120}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
            {errors.name && <p className="text-red text-xs mt-1">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="sup-phone" className="text-xs uppercase tracking-widest text-text-secondary">Phone</label>
            <input id="sup-phone" value={draft.contact_phone} onChange={(e) => setField('contact_phone', e.target.value)} maxLength={32}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
            {errors.contact_phone && <p className="text-red text-xs mt-1">{errors.contact_phone}</p>}
          </div>
          <div>
            <label htmlFor="sup-email" className="text-xs uppercase tracking-widest text-text-secondary">Email</label>
            <input id="sup-email" type="email" value={draft.contact_email} onChange={(e) => setField('contact_email', e.target.value)} maxLength={120}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
            {errors.contact_email && <p className="text-red text-xs mt-1">{errors.contact_email}</p>}
          </div>
          <div className="col-span-2">
            <label htmlFor="sup-addr" className="text-xs uppercase tracking-widest text-text-secondary">Address</label>
            <input id="sup-addr" value={draft.address} onChange={(e) => setField('address', e.target.value)} maxLength={255}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
          </div>
          <div>
            <label htmlFor="sup-terms" className="text-xs uppercase tracking-widest text-text-secondary">Payment terms (days)</label>
            <input id="sup-terms" type="number" min={0} max={365} value={draft.payment_terms_days}
              onChange={(e) => setField('payment_terms_days', Number(e.target.value) || 0)}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
            {errors.payment_terms_days && <p className="text-red text-xs mt-1">{errors.payment_terms_days}</p>}
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.is_active} onChange={(e) => setField('is_active', e.target.checked)} />
              Active
            </label>
          </div>
          <div className="col-span-2">
            <label htmlFor="sup-notes" className="text-xs uppercase tracking-widest text-text-secondary">Notes</label>
            <textarea id="sup-notes" rows={3} value={draft.notes} onChange={(e) => setField('notes', e.target.value)} maxLength={500}
              className="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm text-text-primary" />
          </div>
        </div>

        {serverError && <p className="text-red text-sm" role="alert">{serverError}</p>}

        <DialogFooter className="gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="button" variant="primary" onClick={() => { void handleSubmit(); }} disabled={pending}>
            {pending ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
