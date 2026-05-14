// apps/backoffice/src/features/inventory-opname/components/CreateOpnameModal.tsx
// Session 13 / Phase 2.D — modal to create a new opname session.
// Phase 4.D — migrated from ad-hoc <div> overlay to @breakery/ui Radix Dialog.

import { useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useSections } from '@/features/inventory-transfers/hooks/useSections.js';
import { useCreateOpname } from '../hooks/useOpnameMutations.js';

export interface CreateOpnameModalProps {
  onCreated: (countId: string) => void;
  onClose:   () => void;
}

export function CreateOpnameModal({ onCreated, onClose }: CreateOpnameModalProps): JSX.Element {
  const sections = useSections();
  const [sectionId, setSectionId] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const createOpname = useCreateOpname();

  function handleSubmit() {
    if (sectionId === '') {
      setError('Pick a section.');
      return;
    }
    setError(null);
    createOpname.mutate(
      { sectionId, notes: notes.trim() === '' ? undefined : notes },
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
            Create a new stock-count session for the selected section.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="opname-section" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">Section</label>
            <select
              id="opname-section"
              value={sectionId}
              onChange={(e) => { setSectionId(e.target.value); }}
              className="w-full px-2 py-2 text-sm bg-bg-base border border-border-subtle rounded"
            >
              <option value="">— Select a section —</option>
              {(sections.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

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
          <Button onClick={handleSubmit} disabled={createOpname.isPending}>
            {createOpname.isPending ? 'Creating…' : 'Create count'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
