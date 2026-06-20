// apps/backoffice/src/features/products/components/ModifiersPanel.tsx
//
// Backoffice editor for a product's modifier groups (variant types). Loads the
// product-scoped modifiers, holds an editable draft, validates, and persists
// via upsert_product_modifiers_v1. Price-per-option is applied by the POS
// immediately; ingredients_to_deduct is captured for Phase 2.

import { useEffect, useState, type JSX } from 'react';
import { Button } from '@breakery/ui';
import { Plus } from 'lucide-react';
import {
  validateModifierDraft,
  type EditableModifierGroup,
  type ModifierDraftError,
} from '@breakery/domain';
import { useAuthStore } from '@/stores/authStore.js';
import { useProductModifiersAdmin } from '../hooks/useProductModifiersAdmin.js';
import { useUpsertProductModifiers } from '../hooks/useUpsertProductModifiers.js';
import { ModifierGroupCard } from './ModifierGroupCard.js';

export interface ModifiersPanelProps {
  product: { id: string };
}

const BLANK_GROUP: EditableModifierGroup = {
  group_name: '',
  group_type: 'single_select',
  group_required: false,
  group_sort_order: 0,
  options: [],
};

export function ModifiersPanel({ product }: ModifiersPanelProps): JSX.Element {
  const canWrite = useAuthStore((s) => s.hasPermission('products.modifiers.update'));
  const { data: loaded, isLoading } = useProductModifiersAdmin(product.id);
  const upsert = useUpsertProductModifiers(product.id);

  const [draft, setDraft] = useState<EditableModifierGroup[]>([]);
  const [errors, setErrors] = useState<ModifierDraftError[]>([]);

  // Re-sync the draft whenever a fresh load arrives.
  useEffect(() => {
    if (loaded) setDraft(loaded);
  }, [loaded]);

  function changeGroup(idx: number, next: EditableModifierGroup): void {
    setDraft((d) => d.map((g, i) => (i === idx ? next : g)));
  }
  function removeGroup(idx: number): void {
    setDraft((d) => d.filter((_, i) => i !== idx));
  }
  function addGroup(): void {
    setDraft((d) => [...d, { ...BLANK_GROUP, options: [] }]);
  }

  function save(): void {
    const errs = validateModifierDraft(draft);
    setErrors(errs);
    if (errs.length > 0) return;
    upsert.mutate(draft);
  }

  if (isLoading) {
    return <p className="text-sm text-text-muted">Loading modifiers…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-widest text-text-muted">
            Modifiers / Variant types
          </h3>
          <p className="text-xs text-text-muted">
            Each type lets the cashier pick option(s); price adjusts automatically.
          </p>
        </div>
        {canWrite && (
          <Button type="button" onClick={save} disabled={upsert.isPending}>
            {upsert.isPending ? 'Saving…' : 'Save modifiers'}
          </Button>
        )}
      </div>

      {errors.length > 0 && (
        <ul className="rounded border border-red-fg/40 bg-red-fg/5 p-3 text-sm text-red-fg space-y-1">
          {errors.map((e, i) => (
            <li key={i}>{e.message}</li>
          ))}
        </ul>
      )}

      {draft.length === 0 && (
        <p className="text-sm text-text-muted italic">
          No variant types yet. Add one to offer choices like Milk or Ice/Hot.
        </p>
      )}

      <div className="space-y-4">
        {draft.map((g, idx) => (
          <ModifierGroupCard
            key={idx}
            group={g}
            onChange={(next) => changeGroup(idx, next)}
            onRemove={() => removeGroup(idx)}
          />
        ))}
      </div>

      <Button type="button" variant="secondary" onClick={addGroup}>
        <Plus className="mr-1 h-4 w-4" /> Add variant type
      </Button>
    </div>
  );
}
