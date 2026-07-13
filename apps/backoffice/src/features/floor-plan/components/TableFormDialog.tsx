// apps/backoffice/src/features/floor-plan/components/TableFormDialog.tsx
// S75 Task 3 — Create/Edit restaurant table modal.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
  selectClassName, cn,
} from '@breakery/ui';
import type { RestaurantTable, TableSection } from '@breakery/domain';
import { useCreateTable, useUpdateTable, mapFloorPlanError } from '../hooks/useFloorPlanAdmin.js';

export interface TableFormDialogProps {
  mode:      'create' | 'edit';
  table?:    RestaurantTable | undefined;
  sections:  TableSection[];
  onClose:   () => void;
}

const NO_SECTION = '__none__';

export function TableFormDialog({ mode, table, sections, onClose }: TableFormDialogProps): JSX.Element {
  const [name, setName] = useState(table?.name ?? '');
  const [seats, setSeats] = useState(table?.seats ?? 4);
  const [sectionId, setSectionId] = useState(table?.section_id ?? NO_SECTION);
  const [sortOrder, setSortOrder] = useState(table?.sort_order ?? 0);
  const [error, setError] = useState<string | null>(null);

  const createTable = useCreateTable();
  const updateTable = useUpdateTable();
  const isPending = createTable.isPending || updateTable.isPending;

  // Sections available to pick from: active ones + the table's current
  // section even if it's since been deactivated (so its assignment stays legible).
  const options = sections.filter((s) => s.is_active || s.id === table?.section_id);

  function handleSubmit() {
    if (name.trim().length < 1) {
      setError('Name is required.');
      return;
    }
    if (seats < 1 || seats > 20) {
      setError('Seats must be between 1 and 20.');
      return;
    }
    setError(null);
    const resolvedSectionId = sectionId === NO_SECTION ? null : sectionId;
    if (mode === 'create') {
      createTable.mutate(
        { name: name.trim(), seats, section_id: resolvedSectionId, sort_order: sortOrder },
        {
          onSuccess: () => onClose(),
          onError: (e) => setError(mapFloorPlanError(e.message)),
        },
      );
    } else if (table) {
      updateTable.mutate(
        {
          id: table.id,
          name: name.trim(),
          seats,
          section_id: resolvedSectionId,
          sort_order: sortOrder,
          is_active: table.is_active,
        },
        {
          onSuccess: () => onClose(),
          onError: (e) => setError(mapFloorPlanError(e.message)),
        },
      );
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm" data-testid="table-form-dialog">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New table' : 'Edit table'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="table-name" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Name
            </label>
            <input
              id="table-name"
              value={name}
              onChange={(e) => { setName(e.target.value); }}
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
              maxLength={80}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="table-seats" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
                Seats
              </label>
              <input
                id="table-seats"
                type="number"
                min={1}
                max={20}
                value={seats}
                onChange={(e) => { setSeats(Number(e.target.value)); }}
                className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
              />
            </div>
            <div>
              <label htmlFor="table-sort" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
                Sort order
              </label>
              <input
                id="table-sort"
                type="number"
                value={sortOrder}
                onChange={(e) => { setSortOrder(Number(e.target.value)); }}
                className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
              />
            </div>
          </div>

          <div>
            <label htmlFor="table-section" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Section
            </label>
            <select
              id="table-section"
              value={sectionId}
              onChange={(e) => { setSectionId(e.target.value); }}
              className={cn(selectClassName)}
            >
              <option value={NO_SECTION}>No section (Interior)</option>
              {options.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.is_active ? '' : ' (inactive)'}</option>
              ))}
            </select>
          </div>

          {error !== null && (
            <div className="text-xs text-danger bg-danger-soft px-2 py-1.5 rounded">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending} data-testid="table-form-submit">
            {isPending
              ? (mode === 'create' ? 'Creating…' : 'Saving…')
              : (mode === 'create' ? 'Create' : 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
