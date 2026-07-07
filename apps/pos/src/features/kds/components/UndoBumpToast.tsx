// apps/pos/src/features/kds/components/UndoBumpToast.tsx
//
// Session 13 / Phase 4.B — 60-second undo countdown surface.
// Renders a small floating chip with a live countdown and an "Undo" CTA.
// Disappears after 60 seconds (matches the backend P0012 window).

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useKdsUndoBump } from '../hooks/useKdsUndoBump';

const UNDO_WINDOW_MS = 60_000;

interface UndoBumpToastProps {
  orderItemId: string;
  /** Time the bump was recorded — used to compute the live countdown. */
  bumpedAtMs: number;
  onClose: () => void;
}

export function UndoBumpToast({ orderItemId, bumpedAtMs, onClose }: UndoBumpToastProps) {
  const undo = useKdsUndoBump();
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  const elapsed = now - bumpedAtMs;
  const remaining = Math.max(0, UNDO_WINDOW_MS - elapsed);

  useEffect(() => {
    if (remaining <= 0) {
      onClose();
    }
  }, [remaining, onClose]);

  if (remaining <= 0) return null;

  const remainingSec = Math.ceil(remaining / 1_000);

  const handleUndo = () => {
    undo.mutate(orderItemId, {
      onSuccess: () => {
        toast.success('Bump undone');
        onClose();
      },
      onError: (err: Error & { code?: string }) => {
        // Window expired between click and RPC arriving — treat as silent close.
        if (err.code === 'P0012') {
          onClose();
          return;
        }
        toast.error(err.message || 'Could not undo bump');
      },
    });
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-elevated px-4 py-3 shadow-lg"
    >
      <span className="text-sm text-text-secondary">
        Bumped. Undo in{' '}
        <span className="font-mono font-bold text-text-primary">{remainingSec}s</span>
      </span>
      <button
        type="button"
        onClick={handleUndo}
        disabled={undo.isPending}
        className="rounded-md border border-amber-warn px-3 py-1 text-sm font-semibold text-amber-warn hover:bg-amber-warn hover:text-bg-base"
        aria-label="Undo bump"
      >
        Undo
      </button>
    </div>
  );
}
