// apps/pos/src/features/shift/ShiftClosedState.tsx
//
// Session 14 / Phase 2.C — ref `10-shift-no-open-alert.jpg`.
//
// Centered alert modal shown when the cashier opens the POS without an
// active shift. Three CTAs :
//  - Cancel : dismiss (UI hides until next cart action / refresh).
//  - Recover my shift : recover the last closed shift (placeholder for the
//    recover_session_v1 RPC — backlog, surface a toast for now).
//  - Open a Shift : open the gold "Open Shift" multi-step flow
//    (PIN → cash → confirm).
//
// The component is purely presentational — parent owns the "alert open"
// state and decides what to do with each callback. It is rendered AS a
// FullScreenModal so it covers the POS shell entirely (matching the ref
// dimming the underlying grid).

import { Clock } from 'lucide-react';
import type { JSX } from 'react';
import { Button, FullScreenModal } from '@breakery/ui';

export interface ShiftClosedStateProps {
  /** Whether the alert is visible. */
  open: boolean;
  /** Called when the cashier dismisses the alert. */
  onCancel: () => void;
  /** Called when the cashier opts to recover the last closed shift. */
  onRecover: () => void;
  /** Called when the cashier opts to open a fresh shift (-> OpenShiftModal). */
  onOpenShift: () => void;
}

export function ShiftClosedState({
  open,
  onCancel,
  onRecover,
  onOpenShift,
}: ShiftClosedStateProps): JSX.Element {
  return (
    <FullScreenModal open={open} onOpenChange={(o) => !o && onCancel()}>
      <div className="m-auto bg-bg-overlay rounded-2xl border border-border-subtle shadow-modal w-full max-w-md p-8 text-center space-y-6"
           data-testid="shift-closed-state">
        <div className="grid place-items-center">
          <div className="h-12 w-12 grid place-items-center rounded-full bg-gold-soft">
            <Clock className="h-6 w-6 text-gold" aria-hidden />
          </div>
        </div>

        <div className="space-y-1">
          <h2 className="font-display text-2xl text-text-primary">No shift open</h2>
          <p className="text-text-secondary text-sm">
            You must open a shift to perform this action.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="secondary" size="md" onClick={onCancel} data-testid="shift-closed-cancel">
            Cancel
          </Button>
          <Button variant="secondary" size="md" onClick={onRecover} data-testid="shift-closed-recover">
            Recover my shift
          </Button>
          <Button variant="gold" size="md" onClick={onOpenShift} data-testid="shift-closed-open">
            Open a Shift
          </Button>
        </div>
      </div>
    </FullScreenModal>
  );
}
