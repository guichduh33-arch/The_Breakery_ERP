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
  const { data: loaded, isLoading, error: loadError } = useProductModifiersAdmin(product.id);
  const upsert = useUpsertProductModifiers(product.id);

  const [draft, setDraft] = useState<EditableModifierGroup[]>([]);
  const [errors, setErrors] = useState<ModifierDraftError[]>([]);
  // Harden — le brouillon n'était protégé par rien. Le panneau se démonte au
  // changement d'onglet, la requête n'avait pas de `staleTime`, donc revenir
  // relançait un chargement dont l'arrivée ÉCRASAIT la saisie en cours. On ne
  // resynchronise plus tant que l'utilisateur a des modifications non
  // enregistrées ; le drapeau retombe à l'enregistrement réussi, et le refetch
  // d'invalidation reprend alors la main.
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!loaded) return;
    if (dirty) return;
    setDraft(loaded);
  }, [loaded, dirty]);

  function changeGroup(idx: number, next: EditableModifierGroup): void {
    setDirty(true);
    setDraft((d) => d.map((g, i) => (i === idx ? next : g)));
  }
  function removeGroup(idx: number): void {
    setDirty(true);
    setDraft((d) => d.filter((_, i) => i !== idx));
  }
  function addGroup(): void {
    setDirty(true);
    setDraft((d) => [...d, { ...BLANK_GROUP, options: [] }]);
  }

  function save(): void {
    const errs = validateModifierDraft(draft);
    setErrors(errs);
    if (errs.length > 0) return;
    upsert.mutate(draft, { onSuccess: () => { setDirty(false); } });
  }

  if (isLoading) {
    return <p className="text-sm text-text-muted">Loading modifiers…</p>;
  }

  // Harden — `error` n'était pas même déstructuré : un chargement en échec
  // rendait « No variant types yet », c'est-à-dire qu'un produit AVEC des
  // modificateurs se présentait comme un produit qui n'en a pas. Sur un écran
  // dont le bouton enregistre l'état affiché, cela invitait à écraser la
  // configuration réelle par une configuration vide.
  if (loadError !== null && loadError !== undefined) {
    return (
      <div
        role="alert"
        data-testid="modifiers-load-error"
        className="rounded border border-red bg-red-soft p-3 text-sm text-red"
      >
        Failed to load modifiers: {loadError.message}
        <p className="mt-1 text-xs text-text-secondary">
          Nothing was loaded — do not save from this screen, it would replace the existing options.
        </p>
      </div>
    );
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
          <div className="flex items-center gap-3">
            {dirty && (
              <span className="text-xs text-text-muted">
                Unsaved changes — this view stops refreshing until you save.
              </span>
            )}
            <Button type="button" onClick={save} disabled={upsert.isPending}>
              {upsert.isPending ? 'Saving…' : 'Save modifiers'}
            </Button>
          </div>
        )}
      </div>

      {/* Harden — `bg-red-as-text/5` et `border-red-as-text/40` ne généraient
          aucune règle : Tailwind ne peut pas poser d'alpha sur une couleur
          déclarée `var(--red-as-text)`. La liste de validation rendait donc du
          texte rouge nu, sans encart. `red-soft` porte son alpha dans le token. */}
      {errors.length > 0 && (
        <ul
          role="alert"
          className="space-y-1 rounded border border-red bg-red-soft p-3 text-sm text-red"
        >
          {errors.map((e, i) => (
            <li key={i}>{e.message}</li>
          ))}
        </ul>
      )}

      {/* Harden — un enregistrement en échec ne disait rien : le bouton sortait
          de son état « Saving… » et l'écran restait identique. L'utilisateur
          repartait en croyant avoir enregistré. */}
      {upsert.error !== null && upsert.error !== undefined && (
        <div
          role="alert"
          data-testid="modifiers-save-error"
          className="rounded border border-red bg-red-soft p-3 text-sm text-red"
        >
          Failed to save modifiers: {upsert.error.message}
          <p className="mt-1 text-xs text-text-secondary">
            Your changes are still on screen — fix the problem and save again.
          </p>
        </div>
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

      {/* Harden — « Add variant type » restait actif sans le droit d'enregistrer :
          on pouvait bâtir une configuration entière et découvrir à la fin qu'aucun
          bouton ne la sauvegarderait. Réserve connue : les cartes déjà rendues
          acceptent encore la frappe, elles n'ont pas de mode lecture seule. */}
      {canWrite ? (
        <Button type="button" variant="secondary" onClick={addGroup}>
          <Plus className="mr-1 h-4 w-4" /> Add variant type
        </Button>
      ) : (
        <p className="text-xs text-text-muted">
          Restricted — you don&apos;t have permission to save modifier changes.
        </p>
      )}
    </div>
  );
}
