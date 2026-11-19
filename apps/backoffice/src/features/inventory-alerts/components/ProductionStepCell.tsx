// apps/backoffice/src/features/inventory-alerts/components/ProductionStepCell.tsx
//
// S3-09 — le pas métier d'un produit, lu et réglé dans l'onglet des
// suggestions de production. La suggestion s'arrondit au pas supérieur côté
// serveur ; l'écran ne recalcule rien, il pose le pas et relit la liste.
// Réglage réservé à products.update, comme la fonction serveur l'exige.

import { useState, type FormEvent, type JSX } from 'react';
import { Button, Input } from '@breakery/ui';
import { formatQuantity } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore.js';
import { useSetProductionRoundingStep } from '../hooks/useProductionSuggestions.js';

interface Props {
  productId:   string;
  productName: string;
  step:        number | null;
}

export function ProductionStepCell({ productId, productName, step }: Props): JSX.Element {
  const canEdit = useAuthStore((s) => s.hasPermission('products.update'));
  const save = useSetProductionRoundingStep();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const label = step === null ? '—' : formatQuantity(step, null);

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="font-data text-xs tabular-nums">{label}</span>
        {canEdit && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Edit production step for ${productName}`}
            onClick={() => {
              setDraft(step === null ? '' : String(step));
              save.reset();
              setEditing(true);
            }}
          >
            Edit
          </Button>
        )}
      </span>
    );
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const trimmed = draft.trim();
    const value = trimmed === '' ? null : Number(trimmed);
    if (value !== null && (!Number.isFinite(value) || value <= 0)) return;
    save.mutate({ productId, step: value }, { onSuccess: () => setEditing(false) });
  };

  const invalid = draft.trim() !== '' && !(Number(draft) > 0);

  return (
    <form className="flex flex-wrap items-center justify-end gap-2" onSubmit={submit}>
      <Input
        type="number"
        inputMode="decimal"
        min="0"
        step="any"
        className="h-9 w-20 text-right"
        aria-label={`Production step for ${productName}`}
        aria-invalid={invalid || undefined}
        placeholder="None"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
      />
      <Button type="submit" size="sm" disabled={save.isPending || invalid}>
        Save
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {save.isError && (
        <span role="alert" className="w-full text-right text-xs text-danger-as-text">
          {save.error.message}
        </span>
      )}
    </form>
  );
}
