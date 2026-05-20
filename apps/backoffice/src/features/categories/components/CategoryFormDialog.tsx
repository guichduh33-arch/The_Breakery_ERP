// apps/backoffice/src/features/categories/components/CategoryFormDialog.tsx
// Session 27b — Create/Edit category modal.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useCreateCategory, useUpdateCategory } from '../hooks/useCategoryMutations.js';
import type { CategoryRow } from '../hooks/useAllCategories.js';

const DISPATCH_STATIONS = ['none', 'kitchen', 'bar', 'pastry', 'bakery'] as const;
const KDS_STATIONS = ['expo', 'kitchen', 'bar', 'pastry', 'bakery'] as const;

export interface CategoryFormDialogProps {
  mode:      'create' | 'edit';
  category?: CategoryRow;
  onClose:   () => void;
}

export function CategoryFormDialog({ mode, category, onClose }: CategoryFormDialogProps): JSX.Element {
  const [name,     setName]     = useState(category?.name ?? '');
  const [slug,     setSlug]     = useState(category?.slug ?? '');
  const [dispatch, setDispatch] = useState(category?.dispatch_station ?? 'none');
  const [kds,      setKds]      = useState(category?.kds_station ?? 'expo');
  const [active,   setActive]   = useState(category?.is_active ?? true);
  const [error,    setError]    = useState<string | null>(null);

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
                className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
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
                className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
              >
                {KDS_STATIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => { setActive(e.target.checked); }}
            />
            Active
          </label>

          {error !== null && (
            <div className="text-xs text-red bg-red-soft px-2 py-1.5 rounded">{error}</div>
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
