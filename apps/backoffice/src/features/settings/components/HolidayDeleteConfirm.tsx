// apps/backoffice/src/features/settings/components/HolidayDeleteConfirm.tsx
//
// Session 13 / Phase 5.C — Confirms a soft-delete of a holiday row.

import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@breakery/ui';
import { useDeleteHoliday, type HolidayRow } from '../hooks/useHolidays.js';

export interface HolidayDeleteConfirmProps {
  open: boolean;
  row?: HolidayRow | undefined;
  onClose: () => void;
}

export function HolidayDeleteConfirm({ open, row, onClose }: HolidayDeleteConfirmProps) {
  const mut = useDeleteHoliday();
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!row) return;
    setError(null);
    try {
      await mut.mutateAsync(row.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete holiday');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle>Delete holiday?</DialogTitle>
        <DialogDescription>
          {row ? `“${row.name}” on ${row.date} will be removed from the calendar.` : null}
        </DialogDescription>
        {error && <p className="text-red text-sm mt-3" role="alert">{error}</p>}
        <DialogFooter className="gap-2 mt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={mut.isPending}>Cancel</Button>
          <Button type="button" variant="ghostDestructive" onClick={() => { void handleDelete(); }} disabled={mut.isPending}>
            {mut.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
