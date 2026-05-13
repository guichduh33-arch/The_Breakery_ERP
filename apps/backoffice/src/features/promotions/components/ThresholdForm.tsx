// apps/backoffice/src/features/promotions/components/ThresholdForm.tsx
//
// Session 13 / Phase 2.C — BO Threshold promotion form.
//
// Lets an admin define "cart subtotal/quantity ≥ X ⇒ discount". Submits
// via the existing `useCreatePromotion`/`useUpdatePromotion` mutations
// so the row lands in the `promotions` table with `type='threshold'`.
//
// `max_discount_amount` doubles as the rate-vs-fixed switch on the SQL
// side : when set, `evaluate_promotions_v1` treats `discount_value` as
// a percent (with cap) ; when null, fixed IDR. Mirrored here via the
// `discount_kind` radio.

import { useState, type FormEvent, type JSX } from 'react';
import { Button, Input, type PromotionFormValues } from '@breakery/ui';
import { emptyThresholdValues } from '../utils/emptyPromotionDefaults';

export interface ThresholdFormProps {
  mode: 'create' | 'edit';
  initialValues?: PromotionFormValues;
  onSubmit: (values: PromotionFormValues) => Promise<void> | void;
  onCancel: () => void;
}

export function ThresholdForm({
  mode,
  initialValues,
  onSubmit,
  onCancel,
}: ThresholdFormProps): JSX.Element {
  const [values, setValues] = useState<PromotionFormValues>(() =>
    initialValues ?? emptyThresholdValues(),
  );
  // discount_kind is derived from the form values: percent when
  // max_discount_amount is set, else fixed.
  const [discountKind, setDiscountKind] = useState<'percent' | 'fixed'>(() =>
    (initialValues?.max_discount_amount ?? null) !== null ? 'percent' : 'fixed',
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof PromotionFormValues>(
    k: K,
    v: PromotionFormValues[K],
  ): void {
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  function setKind(next: 'percent' | 'fixed'): void {
    setDiscountKind(next);
    if (next === 'fixed') {
      // Drop the cap so the SQL function reads "fixed".
      update('max_discount_amount', null);
    } else if (values.max_discount_amount == null) {
      // Provide a sane default cap (no clamp) — admins can lower it.
      update('max_discount_amount', 100_000);
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    if (values.name.trim().length < 3) { setError('Name must be at least 3 characters.'); return; }
    if (!/^[a-z0-9-]+$/.test(values.slug)) { setError('Slug must use lowercase, digits, and hyphens.'); return; }
    if (values.threshold_amount == null || values.threshold_amount <= 0) { setError('Threshold amount must be greater than 0.'); return; }
    if (values.threshold_type == null) { setError('Pick a threshold type.'); return; }
    if (values.discount_value == null || values.discount_value <= 0) { setError('Discount value must be greater than 0.'); return; }
    if (discountKind === 'percent' && values.discount_value > 100) {
      setError('Percent cannot exceed 100.');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-labelledby="threshold-form-title">
      <header className="flex items-center justify-between">
        <h2 id="threshold-form-title" className="text-lg font-semibold text-text-primary">
          {mode === 'create' ? 'New threshold promotion' : 'Edit threshold promotion'}
        </h2>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <label className="space-y-1 text-sm">
          <span className="text-xs uppercase tracking-widest text-text-secondary">Name</span>
          <Input
            value={values.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="Spend 100k get 10% off"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs uppercase tracking-widest text-text-secondary">Slug</span>
          <Input
            value={values.slug}
            onChange={(e) => update('slug', e.target.value)}
            placeholder="threshold-100k-10"
          />
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs uppercase tracking-widest text-text-secondary">Threshold type</legend>
        <div className="flex gap-3 text-sm">
          {(['subtotal', 'quantity'] as const).map((t) => (
            <label key={t} className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="threshold-type"
                value={t}
                checked={values.threshold_type === t}
                onChange={() => update('threshold_type', t)}
              />
              {t === 'subtotal' ? 'Cart subtotal (IDR)' : 'Cart quantity (units)'}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-4">
        <label className="space-y-1 text-sm">
          <span className="text-xs uppercase tracking-widest text-text-secondary">
            Threshold {values.threshold_type === 'quantity' ? '(units)' : '(IDR)'}
          </span>
          <Input
            aria-label="threshold-amount"
            type="number"
            min={0}
            step={values.threshold_type === 'quantity' ? 1 : 1000}
            value={values.threshold_amount ?? ''}
            onChange={(e) => update('threshold_amount', e.target.value === '' ? null : Number(e.target.value))}
          />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-xs uppercase tracking-widest text-text-secondary">Discount kind</legend>
          <div className="flex gap-3 text-sm">
            {(['percent', 'fixed'] as const).map((k) => (
              <label key={k} className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="discount-kind"
                  checked={discountKind === k}
                  onChange={() => setKind(k)}
                />
                {k}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="space-y-1 text-sm">
          <span className="text-xs uppercase tracking-widest text-text-secondary">
            {discountKind === 'percent' ? 'Discount (%)' : 'Discount (IDR)'}
          </span>
          <Input
            aria-label="discount-value"
            type="number"
            min={0}
            max={discountKind === 'percent' ? 100 : undefined}
            step={discountKind === 'percent' ? 0.5 : 1000}
            value={values.discount_value ?? ''}
            onChange={(e) => update('discount_value', e.target.value === '' ? null : Number(e.target.value))}
          />
        </label>
        {discountKind === 'percent' && (
          <label className="space-y-1 text-sm">
            <span className="text-xs uppercase tracking-widest text-text-secondary">Max cap (IDR)</span>
            <Input
              aria-label="max-discount-amount"
              type="number"
              min={0}
              step={1000}
              value={values.max_discount_amount ?? ''}
              onChange={(e) => update('max_discount_amount', e.target.value === '' ? null : Number(e.target.value))}
            />
          </label>
        )}
      </div>

      {error !== null && (
        <p className="text-sm text-red" role="alert">{error}</p>
      )}

      <footer className="flex justify-end gap-3 pt-2 border-t border-border-subtle">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Saving…' : mode === 'create' ? 'Create threshold' : 'Save changes'}
        </Button>
      </footer>
    </form>
  );
}
