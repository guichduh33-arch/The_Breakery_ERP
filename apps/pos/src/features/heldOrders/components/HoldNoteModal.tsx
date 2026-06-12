// apps/pos/src/features/heldOrders/components/HoldNoteModal.tsx
//
// Session 43 — Wave E (P2-2). Replaces the historical `window.prompt('Hold
// note (optional):')` with a proper modal: optional note textarea + Cancel /
// Hold buttons. Pure presentation — the parent wires the hold mutation via
// `onConfirm(note)` (note is trimmed; empty submits as null).

import { useEffect, useState, type JSX } from 'react';
import { PauseCircle } from 'lucide-react';
import { Button, CenterModal } from '@breakery/ui';

export interface HoldNoteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  /** Receives the trimmed note, or null when left empty. */
  onConfirm: (note: string | null) => void;
}

export function HoldNoteModal({
  open,
  onOpenChange,
  isPending,
  onConfirm,
}: HoldNoteModalProps): JSX.Element {
  const [note, setNote] = useState('');

  // Re-seed when (re)opened for a fresh gesture.
  useEffect(() => {
    if (open) setNote('');
  }, [open]);

  return (
    <CenterModal
      open={open}
      onOpenChange={onOpenChange}
      title="Hold order"
      className="w-[min(440px,92vw)]"
      data-testid="hold-note-modal"
    >
      <div className="p-6 space-y-5">
        <header className="flex items-center gap-2">
          <PauseCircle className="h-5 w-5 text-gold" aria-hidden />
          <h2 className="font-serif text-xl text-text-primary">Hold this order</h2>
        </header>

        <p className="text-sm text-text-secondary">
          The cart is saved as a held draft and can be restored from Held Orders.
        </p>

        <section className="space-y-2">
          <label htmlFor="hold_note" className="text-xs uppercase tracking-wide text-text-secondary">
            Note (optional)
          </label>
          <textarea
            id="hold_note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="e.g. for Mr. Tan, waiting for table…"
            disabled={isPending}
            data-vkp="qwerty"
            className="w-full bg-bg-input border border-border-subtle rounded-md p-3 text-sm resize-none focus:outline-none focus:border-gold"
          />
        </section>

        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="secondary"
            size="lg"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="gold"
            size="lg"
            onClick={() => onConfirm(note.trim() === '' ? null : note.trim())}
            disabled={isPending}
            data-testid="hold-note-confirm"
          >
            {isPending ? 'Holding…' : 'Hold order'}
          </Button>
        </div>
      </div>
    </CenterModal>
  );
}
