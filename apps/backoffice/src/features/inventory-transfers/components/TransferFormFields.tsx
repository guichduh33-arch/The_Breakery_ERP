// apps/backoffice/src/features/inventory-transfers/components/TransferFormFields.tsx
//
// Session 12 — Phase 3 — header fields for the New Transfer form.
//   - From section (select)
//   - To section   (select) — the chosen From option is disabled here.
//   - Notes (textarea)
//   - Send-directly checkbox
//
// Sections are passed in by the parent (page-level useSections query). Keeping
// this component dumb makes it trivial to unit-test without a QueryClient.

import { useId, type JSX } from 'react';
import type { Section } from '../hooks/useSections.js';

const NOTES_MAX = 500;

export interface TransferFormFieldsValue {
  fromSectionId: string;
  toSectionId:   string;
  notes:         string;
  sendDirectly:  boolean;
}

export interface TransferFormFieldsProps {
  value:    TransferFormFieldsValue;
  onChange: (next: TransferFormFieldsValue) => void;
  sections: Section[];
  disabled?: boolean;
}

export function TransferFormFields({
  value,
  onChange,
  sections,
  disabled = false,
}: TransferFormFieldsProps): JSX.Element {
  const reactId        = useId();
  const fromId         = `${reactId}-from`;
  const toId           = `${reactId}-to`;
  const notesId        = `${reactId}-notes`;
  const sendDirectlyId = `${reactId}-send-directly`;

  function patch(p: Partial<TransferFormFieldsValue>): void {
    onChange({ ...value, ...p });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor={fromId} className="text-xs uppercase tracking-widest text-text-secondary">
            From section
          </label>
          <select
            id={fromId}
            value={value.fromSectionId}
            onChange={(e) => patch({ fromSectionId: e.target.value })}
            disabled={disabled}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          >
            <option value="">— Select source —</option>
            {sections.map((s) => (
              <option
                key={s.id}
                value={s.id}
                disabled={s.id === value.toSectionId}
              >
                {s.name} ({s.code})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor={toId} className="text-xs uppercase tracking-widest text-text-secondary">
            To section
          </label>
          <select
            id={toId}
            value={value.toSectionId}
            onChange={(e) => patch({ toSectionId: e.target.value })}
            disabled={disabled}
            className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          >
            <option value="">— Select destination —</option>
            {sections.map((s) => (
              <option
                key={s.id}
                value={s.id}
                disabled={s.id === value.fromSectionId}
              >
                {s.name} ({s.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor={notesId} className="text-xs uppercase tracking-widest text-text-secondary">
          Notes <span className="normal-case text-text-muted">(optional)</span>
        </label>
        <textarea
          id={notesId}
          value={value.notes}
          onChange={(e) => patch({ notes: e.target.value })}
          rows={2}
          maxLength={NOTES_MAX}
          disabled={disabled}
          placeholder="Reference, batch, or context."
          className="w-full rounded-md border border-border-subtle bg-bg-input p-2 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        />
        <p className="text-text-secondary text-[10px]">
          {value.notes.length}/{NOTES_MAX}
        </p>
      </div>

      <label htmlFor={sendDirectlyId} className="flex items-start gap-2 text-sm text-text-primary">
        <input
          id={sendDirectlyId}
          type="checkbox"
          checked={value.sendDirectly}
          onChange={(e) => patch({ sendDirectly: e.target.checked })}
          disabled={disabled}
          className="mt-1"
        />
        <span>
          Send directly
          <span className="block text-text-secondary text-xs">
            Receive immediately (skip pending status). Stock movements emit on submit.
          </span>
        </span>
      </label>
    </div>
  );
}
