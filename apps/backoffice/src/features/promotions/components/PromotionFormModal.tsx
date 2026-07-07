// apps/backoffice/src/features/promotions/components/PromotionFormModal.tsx
//
// Modal that wraps the shared <PromotionForm> from @breakery/ui. Owns the
// reference-data fetch and dispatches create/update mutations. Closes on
// success.
//
// Spec ref: docs/superpowers/specs/2026-05-10-session-9-promotions-spec.md §4.5

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  PromotionForm,
  type PromotionFormValues,
} from '@breakery/ui';
import { useCreatePromotion } from '../hooks/useCreatePromotion.js';
import { usePromotionReferenceData } from '../hooks/usePromotionReferenceData.js';
import { useUpdatePromotion } from '../hooks/useUpdatePromotion.js';
import type { PromotionListRow } from '../hooks/usePromotionsList.js';

export interface PromotionFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  initialRow?: PromotionListRow | undefined;
  onClose: () => void;
}

function rowToFormValues(row: PromotionListRow): PromotionFormValues {
  // Strip the read-only fields and pass the rest through. The form deals with
  // null/empty consistently so no extra normalisation needed here.
  const { created_at: _created, ...rest } = row;
  void _created;
  return rest;
}

export function PromotionFormModal({ open, mode, initialRow, onClose }: PromotionFormModalProps) {
  const createMut = useCreatePromotion();
  const updateMut = useUpdatePromotion();
  const ref = usePromotionReferenceData();

  async function handleSubmit(values: PromotionFormValues): Promise<void> {
    if (mode === 'create') {
      await createMut.mutateAsync(values);
    } else if (initialRow !== undefined) {
      await updateMut.mutateAsync({ id: initialRow.id, values });
    }
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogTitle className="sr-only">
          {mode === 'create' ? 'Create promotion' : 'Edit promotion'}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Configure name, type, conditions, and stacking rules for this promotion.
        </DialogDescription>

        {ref.isLoading ? (
          <div className="text-text-secondary py-12 text-center">Loading reference data…</div>
        ) : ref.error ? (
          <div className="text-danger py-12 text-center">
            Failed to load reference data: {ref.error.message}
          </div>
        ) : ref.data ? (
          <PromotionForm
            mode={mode}
            {...(mode === 'edit' && initialRow !== undefined
              ? { initialValues: rowToFormValues(initialRow) }
              : {})}
            productOptions={ref.data.products}
            categoryOptions={ref.data.categories}
            customerCategoryOptions={ref.data.customerCategories}
            customerTierOptions={ref.data.customerTiers}
            onSubmit={handleSubmit}
            onCancel={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
