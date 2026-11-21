// apps/backoffice/src/features/promotions/components/PromotionFormModal.tsx
//
// Modal that wraps the shared <PromotionForm> from @breakery/ui. Owns the
// reference-data fetch and dispatches create/update mutations. Closes on
// success.
//
// Spec ref: docs/superpowers/specs/2026-05-10-session-9-promotions-spec.md §4.5

import { useState } from 'react';
import { Dialog, DialogDescription, PromotionForm, type PromotionFormValues } from '@breakery/ui';
import { DialogContent, DialogTitle } from '@/components/BackofficeUi.js';
import { useCreatePromotion } from '../hooks/useCreatePromotion.js';
import { usePromotionReferenceData } from '../hooks/usePromotionReferenceData.js';
import { useUpdatePromotion } from '../hooks/useUpdatePromotion.js';
import type { PromotionListRow } from '../hooks/usePromotionsList.js';
import { PromotionActivateConfirm } from './PromotionActivateConfirm.js';

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

  // ADR-045 déc. 4 : ACTIVER se confirme aussi depuis le formulaire (création
  // active, ou édition qui passe d'inactive à active), pas seulement depuis
  // l'interrupteur de la liste. Le formulaire attend la promesse : Cancel la
  // résout sans rien écrire et laisse le formulaire ouvert.
  const [confirming, setConfirming] = useState<{
    row: PromotionListRow;
    resolve: (confirmed: boolean) => void;
  } | null>(null);

  async function persist(values: PromotionFormValues): Promise<void> {
    if (mode === 'create') {
      await createMut.mutateAsync(values);
    } else if (initialRow !== undefined) {
      await updateMut.mutateAsync({ id: initialRow.id, values });
    }
    onClose();
  }

  async function handleSubmit(values: PromotionFormValues): Promise<void> {
    const activates = values.is_active && (mode === 'create' || initialRow?.is_active !== true);
    if (!activates) {
      await persist(values);
      return;
    }
    const confirmed = await new Promise<boolean>((resolve) => {
      setConfirming({
        row: { ...values, id: initialRow?.id ?? 'new', created_at: initialRow?.created_at ?? '' },
        resolve,
      });
    });
    setConfirming(null);
    if (confirmed) await persist(values);
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
          <div role="alert" className="text-danger py-12 text-center">
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
      <PromotionActivateConfirm
        row={confirming?.row}
        pending={createMut.isPending || updateMut.isPending}
        onConfirm={() => { confirming?.resolve(true); }}
        onClose={() => { confirming?.resolve(false); }}
      />
    </Dialog>
  );
}
