// packages/ui/src/components/CustomerForm.tsx
//
// Shared customer form. Used by the BO loyalty module for create/edit.
// Validation: name required (>=2 chars trimmed); phone optional; email
// optional but RFC-lite-validated when present.

import { useState, useMemo, type FormEvent, type JSX } from 'react';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';

export interface CustomerFormValues {
  name:  string;
  phone: string | null;
  email: string | null;
}

export interface CustomerFormProps {
  mode: 'create' | 'edit';
  initialValues?: CustomerFormValues;
  onSubmit: (values: CustomerFormValues) => Promise<void> | void;
  onCancel: () => void;
  submitting?: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CustomerForm({
  mode, initialValues, onSubmit, onCancel, submitting,
}: CustomerFormProps): JSX.Element {
  const [name,  setName ] = useState(initialValues?.name  ?? '');
  const [phone, setPhone] = useState(initialValues?.phone ?? '');
  const [email, setEmail] = useState(initialValues?.email ?? '');
  const [emailError, setEmailError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const isNameValid = trimmedName.length >= 2;
  const canSubmit = isNameValid && !submitting;

  const submitLabel = useMemo(
    () => (mode === 'create' ? 'Save' : 'Save changes'),
    [mode],
  );

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    if (!isNameValid) return;
    if (email !== '' && !EMAIL_RE.test(email)) {
      setEmailError('Invalid email');
      return;
    }
    setEmailError(null);
    void onSubmit({
      name:  trimmedName,
      phone: phone === '' ? null : phone,
      email: email === '' ? null : email,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="space-y-1">
        <label htmlFor="cf-name" className="text-xs uppercase tracking-widest text-text-secondary">Name</label>
        <Input id="cf-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
      </div>
      <div className="space-y-1">
        <label htmlFor="cf-phone" className="text-xs uppercase tracking-widest text-text-secondary">Phone (optional)</label>
        <Input id="cf-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+33612345678" />
      </div>
      <div className="space-y-1">
        <label htmlFor="cf-email" className="text-xs uppercase tracking-widest text-text-secondary">Email (optional)</label>
        <Input id="cf-email" value={email} type="email" onChange={(e) => { setEmail(e.target.value); setEmailError(null); }} />
        {emailError !== null && <p className="text-red text-xs">{emailError}</p>}
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!canSubmit}>{submitLabel}</Button>
      </div>
    </form>
  );
}
