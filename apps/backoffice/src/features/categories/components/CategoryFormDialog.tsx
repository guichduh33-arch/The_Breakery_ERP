// apps/backoffice/src/features/categories/components/CategoryFormDialog.tsx
// Session 27b — Create/Edit category modal.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
  selectClassName, cn,
} from '@breakery/ui';
import { useCreateCategory, useUpdateCategory } from '../hooks/useCategoryMutations.js';
import type { CategoryRow, CategoryType } from '../hooks/useAllCategories.js';

const CATEGORY_TYPES: readonly { value: CategoryType; label: string }[] = [
  { value: 'raw_material',  label: 'Raw material' },
  { value: 'semi_finished', label: 'Semi-finished' },
  { value: 'finished',      label: 'Finished product' },
];

const DISPATCH_STATIONS = ['none', 'kitchen', 'barista', 'display'] as const;
const KDS_STATIONS = ['expo', 'kitchen', 'bar', 'pastry', 'bakery'] as const;

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
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="cat-name" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Name
            </label>
            <input
              id="cat-name"
              value={name}
              onChange={(e) => { setName(e.target.value); }}
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
              maxLength={120}
            />
          </div>

          <div>
            <label htmlFor="cat-slug" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Slug (optional — auto-derived from name)
            </label>
            <input
              id="cat-slug"
              value={slug}
              onChange={(e) => { setSlug(e.target.value); }}
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded font-mono"
              placeholder="coffee"
              maxLength={120}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="cat-disp" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
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
              <label htmlFor="cat-kds" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
                KDS station
              </label>
              <select
                id="cat-kds"
                value={kds}
                onChange={(e) => { setKds(e.target.value); }}
                className={cn(selectClassName)}
              >
                {KDS_STATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {CATEGORY_TYPES.map((t) => {
                const on = catType === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setCatType(t.value)}
                    aria-pressed={on}
                    className={`rounded-md border px-2 py-2 text-xs font-medium transition-colors ${
                      on
                        ? 'border-gold bg-gold/10 text-text-primary'
                        : 'border-border-subtle text-text-secondary hover:bg-bg-overlay'
                    }`}
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
            <div className="text-xs text-danger bg-danger-soft px-2 py-1.5 rounded">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending} data-testid="category-form-submit">
            {isPending
              ? (mode === 'create' ? 'Creating…' : 'Saving…')
              : (mode === 'create' ? 'Create' : 'Save')}
          </Button>
        </DialogFooter>
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
        className={`mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-gold' : 'bg-border-subtle'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
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
