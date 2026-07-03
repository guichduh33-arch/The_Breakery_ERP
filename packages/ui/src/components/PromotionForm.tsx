// packages/ui/src/components/PromotionForm.tsx
//
// Dynamic create/edit form for the four promotion types (percentage,
// fixed_amount, bogo, free_product). Three-tab layout: General / Conditions /
// Stacking. Validation is dispatched per-type and mirrors the DB CHECK
// constraints documented in the spec §3.1.
//
// The form is split into co-located pieces under ./promotion-form/ (types,
// validation, field primitives, one file per tab) to stay under the 500-line
// budget. This module is the orchestrator and re-exports the public surface so
// `@breakery/ui` consumers see no change.
//
// Spec refs:
//   docs/superpowers/specs/2026-05-10-session-9-promotions-spec.md §1, §3.1, §4.2
//   docs/superpowers/specs/2026-07-03-s57-p2-governance-ux-design.md A-D4 / A-D9 / E-D4

import { useCallback, useMemo, useState, type FormEvent, type JSX } from 'react';
import type { PromotionType } from '@breakery/domain';
import { Button } from '../primitives/Button.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../primitives/Tabs.js';
import { PromotionTypeBadge } from './PromotionTypeBadge.js';
import { ConditionsTab } from './promotion-form/ConditionsTab.js';
import { GeneralTab } from './promotion-form/GeneralTab.js';
import { StackingTab } from './promotion-form/StackingTab.js';
import { validatePromotion } from './promotion-form/validation.js';
import {
  emptyPromotionValues,
  type PromotionFormProps,
  type PromotionFormValues,
} from './promotion-form/types.js';

// Public API re-exports — keep the `@breakery/ui` surface identical.
export {
  emptyPromotionValues,
  validatePromotion,
};
export type {
  PromotionFormProps,
  PromotionFormValues,
  PromotionFormOption,
  PromotionFormErrors,
  PromotionScope,
} from './promotion-form/types.js';

export function PromotionForm({
  mode,
  initialValues,
  productOptions,
  categoryOptions,
  customerCategoryOptions,
  customerTierOptions,
  onSubmit,
  onCancel,
}: PromotionFormProps): JSX.Element {
  const [values, setValues] = useState<PromotionFormValues>(() =>
    initialValues ?? emptyPromotionValues(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const errors = useMemo(() => validatePromotion(values), [values]);
  const hasErrors = Object.keys(errors).length > 0;

  const update = useCallback(<K extends keyof PromotionFormValues>(
    key: K,
    next: PromotionFormValues[K],
  ) => {
    setValues((prev) => ({ ...prev, [key]: next }));
  }, []);

  const setType = useCallback((nextType: PromotionType) => {
    setValues((prev) => ({
      ...prev,
      type: nextType,
      // Reset scope: NULL for bogo/free_product per spec P2
      scope: nextType === 'bogo' || nextType === 'free_product' ? null : (prev.scope ?? 'cart'),
    }));
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setSubmitted(true);
      if (hasErrors) return;
      setSubmitting(true);
      setServerError(null);
      try {
        await onSubmit(values);
      } catch (err) {
        setServerError(err instanceof Error ? err.message : 'Failed to save promotion');
      } finally {
        setSubmitting(false);
      }
    },
    [hasErrors, onSubmit, values],
  );

  const showError = (key: keyof PromotionFormValues): string | undefined =>
    submitted ? errors[key] : undefined;

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} className="flex flex-col gap-4" noValidate>
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-serif text-2xl text-text-primary">
            {mode === 'create' ? 'New promotion' : 'Edit promotion'}
          </h2>
          <PromotionTypeBadge type={values.type} />
        </div>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={values.is_active}
            onChange={(e) => update('is_active', e.target.checked)}
          />
          Active
        </label>
      </header>

      <Tabs defaultValue="general" className="flex-1">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="conditions">Conditions</TabsTrigger>
          <TabsTrigger value="stacking">Stacking</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <GeneralTab
            values={values}
            update={update}
            setType={setType}
            showError={showError}
            productOptions={productOptions}
            categoryOptions={categoryOptions}
          />
        </TabsContent>

        <TabsContent value="conditions" className="space-y-4">
          <ConditionsTab
            values={values}
            update={update}
            showError={showError}
            customerCategoryOptions={customerCategoryOptions}
            customerTierOptions={customerTierOptions}
          />
        </TabsContent>

        <TabsContent value="stacking" className="space-y-4">
          <StackingTab values={values} update={update} />
        </TabsContent>
      </Tabs>

      {serverError !== null && (
        <p className="text-sm text-red" role="alert">
          {serverError}
        </p>
      )}
      {submitted && hasErrors && (
        <p className="text-sm text-red" role="alert">
          Please fix the errors above before saving.
        </p>
      )}

      <footer className="flex justify-end gap-3 pt-2 border-t border-border-subtle">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Saving…' : mode === 'create' ? 'Create promotion' : 'Save changes'}
        </Button>
      </footer>
    </form>
  );
}
