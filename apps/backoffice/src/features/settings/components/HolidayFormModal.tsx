// apps/backoffice/src/features/settings/components/HolidayFormModal.tsx
//
// Session 13 / Phase 5.C — Create/edit dialog for the holiday calendar.
// Plain React state + inline validation, mirroring the suppliers / promotions
// modal pattern.

import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@breakery/ui';
import {
  useCreateHoliday,
  useUpdateHoliday,
  type HolidayRow,
  type HolidayType,
} from '../hooks/useHolidays.js';

interface Draft {
  name: string;
  date: string; // ISO date (yyyy-mm-dd)
  type: HolidayType;
  is_recurring: boolean;
  notes: string;
}

const DEFAULT: Draft = {
  name: '',
  date: new Date().toISOString().slice(0, 10),
  type: 'company',
  is_recurring: false,
  notes: '',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validate(d: Draft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (d.name.trim() === '')        errors.name = 'Name is required';
  else if (d.name.trim().length > 120) errors.name = '≤ 120 chars';
  if (!DATE_RE.test(d.date))       errors.date = 'Date must be YYYY-MM-DD';
  if (!['national', 'religious', 'company'].includes(d.type)) errors.type = 'Invalid type';
  if (d.notes.trim().length > 500) errors.notes = '≤ 500 chars';
  return errors;
}

function rowToDraft(row: HolidayRow): Draft {
  return {
    name: row.name,
    date: row.date,
    type: row.type as HolidayType,
    is_recurring: row.is_recurring,
    notes: row.notes ?? '',
  };
}

function draftToPayload(d: Draft) {
  return {
    name: d.name.trim(),
    date: d.date,
    type: d.type,
    is_recurring: d.is_recurring,
    notes: d.notes.trim() === '' ? null : d.notes.trim(),
  };
}

export interface HolidayFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: HolidayRow | undefined;
  onClose: () => void;
}

export function HolidayFormModal({ open, mode, initial, onClose }: HolidayFormModalProps) {
  const createMut = useCreateHoliday();
  const updateMut = useUpdateHoliday();

  const [draft, setDraft]             = useState<Draft>(initial ? rowToDraft(initial) : DEFAULT);
  const [errors, setErrors]           = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(initial ? rowToDraft(initial) : DEFAULT);
      setErrors({});
      setServerError(null);
    }
  }, [open, initial]);

  const pending = createMut.isPending || updateMut.isPending;

  function setField<K extends keyof Draft>(k: K, v: Draft[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }

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
      setServerError(e instanceof Error ? e.message : 'Failed to save holiday');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogTitle>{mode === 'create' ? 'New holiday' : `Edit ${initial?.name ?? ''}`}</DialogTitle>
        <DialogDescription>
          Mark a national, religious, or company-level non-working day.
        </DialogDescription>

        <div className="grid grid-cols-2 gap-4 py-4">
          <div className="col-span-2">
            <label htmlFor="hol-name" className="text-xs uppercase tracking-widest text-text-secondary">Name *</label>
            <input id="hol-name" value={draft.name} maxLength={120}
              onChange={(e) => setField('name', e.target.value)}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
            {errors.name && <p className="text-red text-xs mt-1">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="hol-date" className="text-xs uppercase tracking-widest text-text-secondary">Date *</label>
            <input id="hol-date" type="date" value={draft.date}
              onChange={(e) => setField('date', e.target.value)}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary" />
            {errors.date && <p className="text-red text-xs mt-1">{errors.date}</p>}
          </div>
          <div>
            <label htmlFor="hol-type" className="text-xs uppercase tracking-widest text-text-secondary">Type *</label>
            <select id="hol-type" value={draft.type}
              onChange={(e) => setField('type', e.target.value as HolidayType)}
              className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary">
              <option value="national">National</option>
              <option value="religious">Religious</option>
              <option value="company">Company</option>
            </select>
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <input id="hol-recurring" type="checkbox" checked={draft.is_recurring}
              onChange={(e) => setField('is_recurring', e.target.checked)} />
            <label htmlFor="hol-recurring" className="text-sm">
              Recurring (moveable across years — Eid, Lunar New Year, etc.)
            </label>
          </div>
          <div className="col-span-2">
            <label htmlFor="hol-notes" className="text-xs uppercase tracking-widest text-text-secondary">Notes</label>
            <textarea id="hol-notes" rows={2} value={draft.notes} maxLength={500}
              onChange={(e) => setField('notes', e.target.value)}
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
