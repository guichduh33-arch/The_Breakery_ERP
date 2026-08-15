// apps/backoffice/src/features/inventory-opname/components/CreateOpnameModal.tsx
// Session 13 / Phase 2.D — modal to create a new opname session.
// Phase 4.D — migrated from ad-hoc <div> overlay to @breakery/ui Radix Dialog.
//
// ADR-027 — le comptage est GLOBAL : plus de sélecteur de section, la création
// n'exige plus rien. Les notes restent facultatives.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useCreateOpname } from '../hooks/useOpnameMutations.js';

export interface CreateOpnameModalProps {
  onCreated: (countId: string) => void;
  onClose:   () => void;
}

export function CreateOpnameModal({ onCreated, onClose }: CreateOpnameModalProps): JSX.Element {
  const [notes, setNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const createOpname = useCreateOpname();

  function handleSubmit() {
    setError(null);
    createOpname.mutate(
      { notes: notes.trim() === '' ? undefined : notes },
      {
        onSuccess: (data) => { onCreated(data.count_id); },
        onError: (e) => { setError(e.message); },
      },
    );
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New stock count</DialogTitle>
          <DialogDescription className="sr-only">
            Create a new stock-count session over the whole stock.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="opname-notes" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">Notes</label>
            <textarea
              id="opname-notes"
              value={notes}
              onChange={(e) => { setNotes(e.target.value); }}
              rows={3}
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
              placeholder="Why are we counting? e.g. monthly cycle / spot audit"
            />
          </div>

          {error !== null && (
            <div role="alert" className="text-sm text-red">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="ink" onClick={handleSubmit} disabled={createOpname.isPending}>
            {createOpname.isPending ? 'Creating…' : 'Create count'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
