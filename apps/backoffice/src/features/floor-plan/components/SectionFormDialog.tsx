// apps/backoffice/src/features/floor-plan/components/SectionFormDialog.tsx
// S75 Task 3 — Create/Edit table section modal.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import type { TableSection } from '@breakery/domain';
import { useCreateSection, useUpdateSection, mapFloorPlanError } from '../hooks/useFloorPlanAdmin.js';

export interface SectionFormDialogProps {
  mode:     'create' | 'edit';
  section?: TableSection | undefined;
  onClose:  () => void;
}

export function SectionFormDialog({ mode, section, onClose }: SectionFormDialogProps): JSX.Element {
  const [name, setName] = useState(section?.name ?? '');
  const [sortOrder, setSortOrder] = useState(section?.sort_order ?? 0);
  const [error, setError] = useState<string | null>(null);

  const createSection = useCreateSection();
  const updateSection = useUpdateSection();
  const isPending = createSection.isPending || updateSection.isPending;

  function handleSubmit() {
    if (name.trim().length < 1) {
      setError('Name is required.');
      return;
    }
    setError(null);
    if (mode === 'create') {
      createSection.mutate(
        { name: name.trim(), sort_order: sortOrder },
        {
          onSuccess: () => onClose(),
          onError: (e) => setError(mapFloorPlanError(e.message)),
        },
      );
    } else if (section) {
      updateSection.mutate(
        { id: section.id, name: name.trim(), sort_order: sortOrder, is_active: section.is_active },
        {
          onSuccess: () => onClose(),
          onError: (e) => setError(mapFloorPlanError(e.message)),
        },
      );
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm" data-testid="section-form-dialog">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New section' : 'Edit section'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="section-name" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Name
            </label>
            <input
              id="section-name"
              value={name}
              onChange={(e) => { setName(e.target.value); }}
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
              maxLength={80}
            />
          </div>

          <div>
            <label htmlFor="section-sort" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Sort order
            </label>
            <input
              id="section-sort"
              type="number"
              value={sortOrder}
              onChange={(e) => { setSortOrder(Number(e.target.value)); }}
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
            />
          </div>

          {error !== null && (
            <div className="text-xs text-danger bg-danger-soft px-2 py-1.5 rounded">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending} data-testid="section-form-submit">
            {isPending
              ? (mode === 'create' ? 'Creating…' : 'Saving…')
              : (mode === 'create' ? 'Create' : 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
