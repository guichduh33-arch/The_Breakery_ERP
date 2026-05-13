// apps/backoffice/src/features/customers/components/B2BFieldsSection.tsx
// Session 13 / Phase 3.C — collapsible card surfacing the B2B-only fields
// added to `customers`. Pure presentational — the caller wires values and
// the onChange handler.
//
// Rendered only when customer_type === 'b2b'. Locked to read-only mode when
// the caller is not allowed to edit (canEdit=false).

import type { ChangeEvent, JSX } from 'react';

export interface B2BFieldValues {
  b2b_company_name:       string | null;
  b2b_tax_id:             string | null;
  b2b_payment_terms_days: number | null;
  b2b_credit_limit:       number | null;
  b2b_current_balance:    number;
}

export interface B2BFieldsSectionProps {
  values:   B2BFieldValues;
  canEdit:  boolean;
  onChange: (next: B2BFieldValues) => void;
}

export function B2BFieldsSection({ values, canEdit, onChange }: B2BFieldsSectionProps): JSX.Element {
  function update<K extends keyof B2BFieldValues>(key: K, raw: string): void {
    let next: B2BFieldValues[K];
    if (key === 'b2b_payment_terms_days' || key === 'b2b_credit_limit') {
      const num = raw === '' ? null : Number(raw);
      next = (Number.isFinite(num) ? num : null) as B2BFieldValues[K];
    } else if (key === 'b2b_current_balance') {
      // current_balance is system-managed (cached AR) — keep prior value.
      next = values.b2b_current_balance as B2BFieldValues[K];
    } else {
      next = (raw === '' ? null : raw) as B2BFieldValues[K];
    }
    onChange({ ...values, [key]: next });
  }

  const readonly = !canEdit;
  const balanceDisplay = formatIdr(values.b2b_current_balance);

  return (
    <section
      data-testid="b2b-fields-section"
      className="rounded-lg border border-border-subtle bg-bg-overlay p-4 space-y-3"
    >
      <header className="flex items-center justify-between">
        <h3 className="font-serif text-base text-text-primary">B2B details</h3>
        {readonly ? (
          <span className="text-xs text-text-secondary uppercase tracking-wide">read-only</span>
        ) : null}
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field
          label="Company name"
          htmlFor="b2b_company_name"
          value={values.b2b_company_name ?? ''}
          readonly={readonly}
          onChange={(v) => update('b2b_company_name', v)}
          placeholder="PT / CV legal entity"
        />
        <Field
          label="Tax ID (NPWP)"
          htmlFor="b2b_tax_id"
          value={values.b2b_tax_id ?? ''}
          readonly={readonly}
          onChange={(v) => update('b2b_tax_id', v)}
          placeholder="00.000.000.0-000.000"
        />
        <Field
          label="Payment terms (days)"
          htmlFor="b2b_payment_terms_days"
          value={values.b2b_payment_terms_days === null ? '' : String(values.b2b_payment_terms_days)}
          readonly={readonly}
          onChange={(v) => update('b2b_payment_terms_days', v)}
          placeholder="30"
          inputMode="numeric"
        />
        <Field
          label="Credit limit (IDR)"
          htmlFor="b2b_credit_limit"
          value={values.b2b_credit_limit === null ? '' : String(values.b2b_credit_limit)}
          readonly={readonly}
          onChange={(v) => update('b2b_credit_limit', v)}
          placeholder="Unlimited if blank"
          inputMode="numeric"
        />
      </div>

      <div className="flex items-center justify-between border-t border-border-subtle pt-3 text-sm">
        <span className="text-text-secondary">Outstanding AR</span>
        <span className="font-mono text-text-primary" data-testid="b2b-balance">{balanceDisplay}</span>
      </div>
    </section>
  );
}

interface FieldProps {
  label:        string;
  htmlFor:      string;
  value:        string;
  readonly:     boolean;
  onChange:     (next: string) => void;
  placeholder?: string;
  inputMode?:   'text' | 'numeric';
}

function Field({ label, htmlFor, value, readonly, onChange, placeholder, inputMode }: FieldProps): JSX.Element {
  return (
    <label htmlFor={htmlFor} className="block space-y-1">
      <span className="text-xs uppercase tracking-wide text-text-secondary">{label}</span>
      <input
        id={htmlFor}
        name={htmlFor}
        type="text"
        inputMode={inputMode}
        value={value}
        readOnly={readonly}
        placeholder={placeholder}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        className="w-full bg-bg-input border border-border-subtle rounded-md p-2 text-sm focus:outline-none focus:border-gold disabled:opacity-60"
      />
    </label>
  );
}

function formatIdr(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `Rp ${safe.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
}
