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
import { FOCUS_RING } from '@/components/focusRing.js';

export interface TableFormDialogProps {
  mode:      'create' | 'edit';
  table?:    RestaurantTable | undefined;
  sections:  TableSection[];
  onClose:   () => void;
}

const NO_SECTION = '__none__';

// Id unique du message d'erreur — la modale est un singleton (une seule ouverte
// à la fois), comme les ids de champ déjà écrits en dur plus bas.
const ERROR_ID = 'table-form-error';

/** Champ mis en cause par l'erreur courante — null pour une erreur serveur. */
type ErrorField = 'name' | 'seats' | null;

export function TableFormDialog({ mode, table, sections, onClose }: TableFormDialogProps): JSX.Element {
  const [name, setName] = useState(table?.name ?? '');
  const [seats, setSeats] = useState(table?.seats ?? 4);
  const [sectionId, setSectionId] = useState(table?.section_id ?? NO_SECTION);
  const [sortOrder, setSortOrder] = useState(table?.sort_order ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<ErrorField>(null);

  const createTable = useCreateTable();
  const updateTable = useUpdateTable();
  const isPending = createTable.isPending || updateTable.isPending;

  // Sections available to pick from: active ones + the table's current
  // section even if it's since been deactivated (so its assignment stays legible).
  const options = sections.filter((s) => s.is_active || s.id === table?.section_id);

  // Un refus SERVEUR n'est imputable à aucun champ : `errorField` reste null et
  // seul le bandeau `role="alert"` parle. Un refus de SAISIE marque son champ.
  function fail(field: ErrorField, message: string) {
    setErrorField(field);
    setError(message);
  }

  function handleSubmit() {
    if (name.trim().length < 1) {
      fail('name', 'Name is required.');
      return;
    }
    if (seats < 1 || seats > 20) {
      fail('seats', 'Seats must be between 1 and 20.');
      return;
    }
    setError(null);
    setErrorField(null);
    const resolvedSectionId = sectionId === NO_SECTION ? null : sectionId;
    if (mode === 'create') {
      createTable.mutate(
        { name: name.trim(), seats, section_id: resolvedSectionId, sort_order: sortOrder },
        {
          onSuccess: () => onClose(),
          onError: (e) => { fail(null, mapFloorPlanError(e.message)); },
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
          onError: (e) => { fail(null, mapFloorPlanError(e.message)); },
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
            <label htmlFor="table-name" className="font-data font-semibold block text-xs uppercase tracking-wider text-text-secondary mb-1">
              Name
            </label>
            {/* Le champ fautif se DIT : `aria-invalid` le marque, et
                `aria-describedby` le relie au message — sans quoi l'erreur
                n'existe que pour l'œil (WCAG 3.3.1). Le lien n'est posé que
                pour le champ réellement en cause : décrire « Name » par un
                refus serveur de section serait un mensonge de plus. */}
            <input
              id="table-name"
              value={name}
              onChange={(e) => { setName(e.target.value); }}
              aria-invalid={errorField === 'name'}
              {...(errorField === 'name' ? { 'aria-describedby': ERROR_ID } : {})}
              className={`w-full px-2 py-2 text-sm bg-bg-base border border-border-strong rounded ${FOCUS_RING}`}
              maxLength={80}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="table-seats" className="font-data font-semibold block text-xs uppercase tracking-wider text-text-secondary mb-1">
                Seats
              </label>
              <input
                id="table-seats"
                type="number"
                min={1}
                max={20}
                value={seats}
                onChange={(e) => { setSeats(Number(e.target.value)); }}
                aria-invalid={errorField === 'seats'}
                {...(errorField === 'seats' ? { 'aria-describedby': ERROR_ID } : {})}
                className={`w-full px-2 py-2 text-sm bg-bg-base border border-border-strong rounded ${FOCUS_RING}`}
              />
            </div>
            <div>
              <label htmlFor="table-sort" className="font-data font-semibold block text-xs uppercase tracking-wider text-text-secondary mb-1">
                Sort order
              </label>
              <input
                id="table-sort"
                type="number"
                value={sortOrder}
                onChange={(e) => { setSortOrder(Number(e.target.value)); }}
                className={`w-full px-2 py-2 text-sm bg-bg-base border border-border-strong rounded ${FOCUS_RING}`}
              />
            </div>
          </div>

          <div>
            <label htmlFor="table-section" className="font-data font-semibold block text-xs uppercase tracking-wider text-text-secondary mb-1">
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

          {/* `role="alert"` : le message apparaît APRÈS la tentative, hors du
              flux de lecture. Sans lui, un refus de validation est muet. */}
          {error !== null && (
            <div id={ERROR_ID} role="alert" className="text-xs text-danger bg-danger-soft px-2 py-1.5 rounded">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button variant="ink" onClick={handleSubmit} disabled={isPending} data-testid="table-form-submit">
            {isPending
              ? (mode === 'create' ? 'Creating…' : 'Saving…')
              : (mode === 'create' ? 'Create' : 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
