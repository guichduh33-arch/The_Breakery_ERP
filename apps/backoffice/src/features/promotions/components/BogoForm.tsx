// apps/backoffice/src/features/promotions/components/BogoForm.tsx
//
// Session 13 / Phase 2.C — BO "new BOGO shape" creation form.
//
// Renders a compact "Buy N get M of product P" editor. Submits via the
// existing `useCreatePromotion`/`useUpdatePromotion` mutations so the
// shape is persisted alongside Session 9 BOGO promos. Per deviation
// D-W2-2C-03, this is a *sub-form* exposed by `PromotionFormModal` —
// not a separate modal — so the existing list/edit flow still works.
//
// Usage:
//   <BogoForm
//     mode="create"
//     productOptions={products}
//     onSubmit={handleSubmit}
//     onCancel={handleCancel}
//   />
//
// `handleSubmit` receives a `PromotionFormValues` with the new BOGO
// shape fields populated and the legacy array-shape left empty.

import { useState, type FormEvent, type JSX } from 'react';
import { Button, Input, selectClassName, cn, type PromotionFormOption, type PromotionFormValues } from '@breakery/ui';
import { emptyBogoNewValues } from '../utils/emptyPromotionDefaults';

export interface BogoFormProps {
  mode: 'create' | 'edit';
  initialValues?: PromotionFormValues;
  productOptions: PromotionFormOption[];
  onSubmit: (values: PromotionFormValues) => Promise<void> | void;
  onCancel: () => void;
}

export function BogoForm({
  mode,
  initialValues,
  productOptions,
  onSubmit,
  onCancel,
}: BogoFormProps): JSX.Element {
  const [values, setValues] = useState<PromotionFormValues>(() =>
    initialValues ?? emptyBogoNewValues(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof PromotionFormValues>(
    k: K,
    v: PromotionFormValues[K],
  ): void {
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    if (values.name.trim().length < 3) { setError('Name must be at least 3 characters.'); return; }
    if (!/^[a-z0-9-]+$/.test(values.slug)) { setError('Slug must use lowercase, digits, and hyphens.'); return; }
    if (values.bogo_buy_quantity == null || values.bogo_buy_quantity < 1) { setError('Buy quantity must be at least 1.'); return; }
    if (values.bogo_get_quantity == null || values.bogo_get_quantity < 1) { setError('Get quantity must be at least 1.'); return; }
    if (values.bogo_get_product_id == null) { setError('Pick a reward product.'); return; }

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
    <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4" aria-labelledby="bogo-form-title">
      <header className="flex items-center justify-between">
        <h2 id="bogo-form-title" className="text-lg font-semibold text-text-primary">
          {mode === 'create' ? 'New BOGO promotion' : 'Edit BOGO promotion'}
        </h2>
      </header>

      <div className="grid grid-cols-2 gap-4">
        <label className="space-y-1 text-sm">
          <span className="text-xs uppercase tracking-widest text-text-secondary">Name</span>
          <Input
            value={values.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="Buy 2 baguettes get 1 free"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs uppercase tracking-widest text-text-secondary">Slug</span>
          <Input
            value={values.slug}
            onChange={(e) => update('slug', e.target.value)}
            placeholder="bogo-2-1-baguette"
          />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <label className="space-y-1 text-sm">
          <span className="text-xs uppercase tracking-widest text-text-secondary">Buy qty</span>
          <Input
            type="number"
            min={1}
            step={1}
            value={values.bogo_buy_quantity ?? ''}
            onChange={(e) => update('bogo_buy_quantity', e.target.value === '' ? null : Number(e.target.value))}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs uppercase tracking-widest text-text-secondary">Get qty</span>
          <Input
            type="number"
            min={1}
            step={1}
            value={values.bogo_get_quantity ?? ''}
            onChange={(e) => update('bogo_get_quantity', e.target.value === '' ? null : Number(e.target.value))}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs uppercase tracking-widest text-text-secondary">Free product</span>
          <select
            value={values.bogo_get_product_id ?? ''}
            onChange={(e) => update('bogo_get_product_id', e.target.value === '' ? null : e.target.value)}
            className={cn(selectClassName)}
          >
            <option value="">— Select —</option>
            {productOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </label>
      </div>

      {error !== null && (
        <p className="text-sm text-danger" role="alert">{error}</p>
      )}

      <footer className="flex justify-end gap-3 pt-2 border-t border-border-subtle">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Saving…' : mode === 'create' ? 'Create BOGO' : 'Save changes'}
        </Button>
      </footer>
    </form>
  );
}
