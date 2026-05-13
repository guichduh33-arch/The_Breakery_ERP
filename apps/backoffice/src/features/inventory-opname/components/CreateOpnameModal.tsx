// apps/backoffice/src/features/inventory-opname/components/CreateOpnameModal.tsx
// Session 13 / Phase 2.D — modal to create a new opname session.

import { useState } from 'react';
import { Button } from '@breakery/ui';
import { useSections } from '@/features/inventory-transfers/hooks/useSections.js';
import { useCreateOpname } from '../hooks/useOpnameMutations.js';

export interface CreateOpnameModalProps {
  onCreated: (countId: string) => void;
  onClose:   () => void;
}

export function CreateOpnameModal({ onCreated, onClose }: CreateOpnameModalProps) {
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
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="bg-bg-elevated rounded-md border border-border-subtle w-full max-w-md p-5 shadow-lg">
        <h3 className="text-lg font-serif mb-3">New stock count</h3>

        <label htmlFor="opname-section" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">Section</label>
        <select
          id="opname-section"
          value={sectionId}
          onChange={(e) => { setSectionId(e.target.value); }}
          className="w-full px-2 py-2 mb-3 text-sm bg-bg-base border border-border-subtle rounded"
        >
          <option value="">— Select a section —</option>
          {(sections.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        <label htmlFor="opname-notes" className="block text-xs uppercase tracking-wider text-text-secondary mb-1">Notes</label>
        <textarea
          id="opname-notes"
          value={notes}
          onChange={(e) => { setNotes(e.target.value); }}
          rows={3}
          className="w-full px-2 py-2 mb-3 text-sm bg-bg-base border border-border-subtle rounded"
          placeholder="Why are we counting? e.g. monthly cycle / spot audit"
        />

        {error !== null && (
          <div className="text-sm text-rose-600 mb-3">{error}</div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={createOpname.isPending}>
            {createOpname.isPending ? 'Creating…' : 'Create count'}
          </Button>
        </div>
      </div>
    </div>
  );
}
