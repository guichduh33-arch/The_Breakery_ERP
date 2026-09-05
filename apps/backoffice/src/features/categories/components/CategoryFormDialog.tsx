// apps/backoffice/src/features/categories/components/CategoryFormDialog.tsx
// Session 27b — Create/Edit category modal.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  selectClassName, cn,
} from '@breakery/ui';
import { FOCUS_RING } from '@/components/focusRing.js';
import { useCreateCategory, useUpdateCategory } from '../hooks/useCategoryMutations.js';
import type { CategoryRow, CategoryType } from '../hooks/useAllCategories.js';

const CATEGORY_TYPES: readonly { value: CategoryType; label: string }[] = [
  { value: 'raw_material',  label: 'Raw material' },
  { value: 'semi_finished', label: 'Semi-finished' },
  { value: 'finished',      label: 'Finished product' },
];

const DISPATCH_STATIONS = ['none', 'kitchen', 'barista', 'display'] as const;
// S75 (task 7) — mirrors the DB CHECK on categories.kds_station (migration
// 20260517000150_add_categories_kds_station.sql): hot|cold|bar|prep|expo.
// The previous list ('kitchen'/'pastry'/'bakery') violated the constraint —
// a latent bug fixed here.
const KDS_STATIONS = [
  { value: 'hot',  label: 'Hot kitchen' },
  { value: 'cold', label: 'Cold prep' },
  { value: 'bar',  label: 'Bar' },
  { value: 'prep', label: 'Prep / Bakery' },
  { value: 'expo', label: 'Expo / Pickup' },
] as const;

export interface CategoryFormDialogProps {
  mode:      'create' | 'edit';
  category?: CategoryRow;
  onClose:   () => void;
}

export function CategoryFormDialog({ mode, category, onClose }: CategoryFormDialogProps): JSX.Element {
  const [name,        setName]        = useState(category?.name ?? '');
  const [slug,        setSlug]        = useState(category?.slug ?? '');
  const [dispatch,    setDispatch]    = useState(category?.dispatch_station ?? 'none');
  const [kds,         setKds]         = useState(category?.kds_station ?? 'expo');
  const [showInPos,   setShowInPos]   = useState(category?.show_in_pos ?? true);
  const [catType,     setCatType]     = useState<CategoryType>(category?.category_type ?? 'finished');
  const [active,      setActive]      = useState(category?.is_active ?? true);
  const [error,       setError]       = useState<string | null>(null);

  const createCat = useCreateCategory();
  const updateCat = useUpdateCategory();
  const isPending = createCat.isPending || updateCat.isPending;

  function handleSubmit() {
    if (name.trim().length < 2) {
      setError('Name must be at least 2 characters.');
      return;
    }
    setError(null);
    const slugTrimmed = slug.trim() === '' ? undefined : slug.trim().toLowerCase();
    if (mode === 'create') {
      createCat.mutate(
        {
          name: name.trim(),
          ...(slugTrimmed !== undefined ? { slug: slugTrimmed } : {}),
          is_active: active,
          dispatch_station: dispatch,
          kds_station: kds,
          show_in_pos: showInPos,
          category_type: catType,
        },
        {
          onSuccess: () => onClose(),
          onError: (e) => {
            setError(e.message.includes('slug_taken')
              ? `Slug "${slugTrimmed}" is already taken.`
              : e.message);
          },
        },
      );
    } else if (category) {
      updateCat.mutate(
        {
          categoryId: category.id,
          patch: {
            name: name.trim(),
            ...(slugTrimmed !== undefined ? { slug: slugTrimmed } : {}),
            is_active: active,
            dispatch_station: dispatch,
            kds_station: kds,
            show_in_pos: showInPos,
            category_type: catType,
          },
        },
        {
          onSuccess: () => onClose(),
          onError: (e) => setError(e.message),
        },
      );
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="category-form-dialog">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New category' : 'Edit category'}</DialogTitle>
          <DialogDescription>
            Categories group products for the POS grid and for inventory reporting.
          </DialogDescription>
        </DialogHeader>

        {/* Une vraie balise <form> : sans elle, la touche Entrée ne validait
            rien et l'attribut `required` d'un champ ne se déclenchait jamais. */}
        <form
          onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
          className="space-y-3"
          data-testid="category-form"
        >
          <div>
            <label htmlFor="cat-name" className="font-data font-semibold block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Name <span className="text-red" aria-hidden>*</span>
            </label>
            <input
              id="cat-name"
              value={name}
              onChange={(e) => { setName(e.target.value); }}
              className={`w-full px-2 py-2 text-sm bg-bg-base border border-border-strong rounded ${FOCUS_RING}`}
              maxLength={120}
            />
          </div>

          <div>
            <label htmlFor="cat-slug" className="font-data font-semibold block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Slug (optional — auto-derived from name)
            </label>
            <input
              id="cat-slug"
              value={slug}
              onChange={(e) => { setSlug(e.target.value); }}
              className={`w-full px-2 py-2 text-sm bg-bg-base border border-border-strong rounded font-mono placeholder:text-text-muted ${FOCUS_RING}`}
              placeholder="coffee"
              maxLength={120}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="cat-disp" className="font-data font-semibold block text-xs uppercase tracking-wider text-text-secondary mb-1">
                Dispatch station
              </label>
              <select
                id="cat-disp"
                value={dispatch}
                onChange={(e) => { setDispatch(e.target.value); }}
                className={cn(selectClassName)}
              >
                {DISPATCH_STATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cat-kds" className="font-data font-semibold block text-xs uppercase tracking-wider text-text-secondary mb-1">
                KDS station
              </label>
              <select
                id="cat-kds"
                value={kds}
                onChange={(e) => { setKds(e.target.value); }}
                className={cn(selectClassName)}
              >
                {KDS_STATIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            {/* Choix mutuellement exclusif : `aria-pressed` annonce une
                bascule, pas « un parmi trois » — ni le nombre d'options ni la
                position n'étaient lisibles au lecteur d'écran. */}
            <span id="cat-type-label" className="font-data font-semibold block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Type
            </span>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="cat-type-label">
              {CATEGORY_TYPES.map((t) => {
                const on = catType === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setCatType(t.value)}
                    role="radio"
                    aria-checked={on}
                    className={`rounded-md border px-2 py-2 text-xs font-medium transition-colors ${
                      on
                        // The Ink-Not-Gold Rule : le liseré or porte seul l'état
                        // sélectionné, l'aplat était un décor.
                        ? 'border-gold text-text-primary'
                        : 'border-border-subtle text-text-secondary hover:bg-surface-4'
                    } ${FOCUS_RING}`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-xs text-text-secondary">
              Classifies the category for inventory (raw material → semi-finished → finished product).
            </p>
          </div>

          <div className="space-y-1 pt-1">
            <ToggleRow
              checked={showInPos}
              onChange={setShowInPos}
              label="Show in POS"
              description="Category appears in the POS product grid."
            />
            <ToggleRow
              checked={active}
              onChange={setActive}
              label="Active"
              description="Inactive categories are hidden everywhere."
            />
          </div>

          {error !== null && (
            <div role="alert" className="text-xs text-danger bg-danger-soft px-2 py-1.5 rounded">{error}</div>
          )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button variant="ink" type="submit" disabled={isPending} data-testid="category-form-submit">
            {isPending
              ? (mode === 'create' ? 'Creating…' : 'Saving…')
              : (mode === 'create' ? 'Create' : 'Save')}
          </Button>
        </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ToggleRowProps {
  checked:     boolean;
  onChange:    (next: boolean) => void;
  label:       string;
  description: string;
}

function ToggleRow({ checked, onChange, label, description }: ToggleRowProps): JSX.Element {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${FOCUS_RING} ${
          // Piste OR — exception « piste d'interrupteur » de The Ink-Not-Gold
          // Rule (DESIGN.md § Colors) : ici le remplissage n'est pas un décor,
          // c'est le porteur de l'état. L'encre aurait posé un second aplat
          // #201d19 dans une modale qui en a déjà un sur son action terminale.
          // Le curseur blanc vaut 6,22:1 sur l'or allumé et 3,83:1 sur la piste
          // éteinte (--border-strong remonté à #86827a) : l'état se lit par la
          // position du curseur, perceptible sur les deux fonds.
          checked ? 'bg-gold' : 'bg-border-strong'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-bg-elevated shadow-sm transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
      <div className="leading-tight">
        <div className="text-sm font-medium text-text-primary">{label}</div>
        <div className="text-xs text-text-secondary">{description}</div>
      </div>
    </div>
  );
}
