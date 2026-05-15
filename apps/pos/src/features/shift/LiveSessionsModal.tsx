// apps/pos/src/features/shift/LiveSessionsModal.tsx
//
// Session 14 — Phase 2.D — Modal listing currently-open POS sessions.
//
// Visual ref: 85-pos-…-modal.jpg (screenshot is mis-named — this is the
// Live Sessions modal, not POS Settings).
//
// Layout:
//   ┌───────────────────────────────────────────────────────┐
//   │ [icon] LIVE SESSIONS    2 active   [⟳] [X]          │
//   ├───────────────────────────────────────────────────────┤
//   │ ● TERM-MOJM2MV7                          Rp 0        │
//   │   🕓 11m   💳 Opening: Rp 200,000   0 TRANSACTIONS  │
//   ├───────────────────────────────────────────────────────┤
//   │ ● TERM-MN5PIGRM                          Rp 0        │
//   │   🕓 368h 29m  💳 Opening: Rp 100,000   0 TRANS…   │
//   └───────────────────────────────────────────────────────┘
//
// Triggered from SideMenuDrawer "Live Sessions". Auto-refreshes every 30s.

import { type JSX } from 'react';
import { X, Monitor, Clock, CreditCard, RefreshCw } from 'lucide-react';
import {
  Button,
  CenterModal,
  Currency,
  DialogDescription,
  DialogTitle,
  EmptyState,
  SectionLabel,
  cn,
} from '@breakery/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLiveSessions, type LiveSession } from './hooks/useLiveSessions';

export interface LiveSessionsModalProps {
  open: boolean;
  onClose: () => void;
}

export function LiveSessionsModal({ open, onClose }: LiveSessionsModalProps): JSX.Element {
  const sessions = useLiveSessions();
  const queryClient = useQueryClient();

  function refresh(): void {
    void queryClient.invalidateQueries({ queryKey: ['pos-live-sessions'] });
  }

  const rows = sessions.data ?? [];

  return (
    <CenterModal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      className="w-[min(640px,92vw)]"
      data-testid="live-sessions-modal"
    >
      <header className="px-5 py-4 flex items-center justify-between border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <Monitor className="h-5 w-5 text-gold" aria-hidden />
          <DialogTitle asChild>
            <SectionLabel as="h2" size="sm" className="text-text-primary">
              Live Sessions
            </SectionLabel>
          </DialogTitle>
          <span className="text-text-secondary text-xs">{rows.length} active</span>
        </div>
        <div className="inline-flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            aria-label="Refresh"
            data-testid="live-sessions-refresh"
          >
            <RefreshCw className={cn('h-4 w-4', sessions.isFetching && 'animate-spin')} aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" aria-hidden />
          </Button>
        </div>
      </header>

      <DialogDescription className="sr-only">
        List of currently open POS terminal sessions across the venue.
      </DialogDescription>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {sessions.isLoading && <p className="text-text-secondary text-sm">Loading sessions…</p>}
        {sessions.isError && <p className="text-red text-sm">Failed to load sessions.</p>}
        {!sessions.isLoading && rows.length === 0 && (
          <EmptyState
            icon={Monitor}
            title="No live sessions"
            description="No cashier is currently signed in to a POS terminal."
            size="md"
          />
        )}
        <ul className="space-y-3">
          {rows.map((s) => (
            <LiveSessionRow key={s.id} session={s} />
          ))}
        </ul>
      </div>

      <footer className="px-5 py-3 border-t border-border-subtle text-center text-xs text-text-muted">
        Auto-refreshes every 30 seconds
      </footer>
    </CenterModal>
  );
}

function formatElapsed(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return `${hours}h ${rem}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function LiveSessionRow({ session }: { session: LiveSession }): JSX.Element {
  return (
    <li
      className="rounded-lg border border-border-subtle bg-bg-base/40 p-4"
      data-testid={`live-session-${session.id}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 min-w-0">
          <span
            aria-hidden
            className="h-2 w-2 rounded-full bg-green shadow-[0_0_6px_rgba(45,179,72,0.8)]"
          />
          <span className="font-mono text-sm font-bold text-text-primary truncate">
            {session.terminal_label}
          </span>
          <span className="text-xs text-text-muted">·</span>
          <span className="text-xs text-text-secondary truncate">{session.cashier_name}</span>
        </div>
        <Currency amount={session.cash_movements_total} emphasis="gold" />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <div className="inline-flex items-center gap-3 text-text-secondary">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden /> {formatElapsed(session.opened_at)}
          </span>
          <span className="inline-flex items-center gap-1">
            <CreditCard className="h-3 w-3" aria-hidden /> Opening:{' '}
            <Currency amount={session.opening_cash} className="font-mono" />
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-widest text-text-muted font-semibold">
          {session.order_count} transactions
        </span>
      </div>
    </li>
  );
}
