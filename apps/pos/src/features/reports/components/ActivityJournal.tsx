// apps/pos/src/features/reports/components/ActivityJournal.tsx
//
// S72 Lot 4 — the POS operational audit journal (Activity tab, "Journal" view).
// Renders the immutable pos_events stream for the period: every operator
// manipulation on every terminal (cart gestures, kitchen, payment, drawer,
// session), newest first, with:
//   * family filter chips (cart / kitchen / payment / control / session)
//   * device + operator selects (facets from page 1 of get_pos_events_v1)
//   * per-ticket timeline: clicking a ticket ref narrows to that order_id
//   * control signals (manual drawer, payment failures, reprints, voids,
//     discounts) highlighted — the fraud read
//   * keyset infinite scroll (IntersectionObserver sentinel + Load-more)
//   * CSV export of the loaded rows (buildCsv, WITA timestamps)

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  Activity,
  AlertTriangle,
  Banknote,
  ChefHat,
  Download,
  Loader2,
  ShieldAlert,
  ShoppingCart,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Currency, EmptyState, cn } from '@breakery/ui';
import { buildCsv, downloadCsv } from '@breakery/domain';
import type { ReportsPeriod } from '../hooks/useReportsPeriod';
import {
  usePosEventsJournal,
  EMPTY_JOURNAL_FILTERS,
  type PosJournalEvent,
  type PosJournalFilters,
} from '../hooks/usePosEventsJournal';

// ─── Event taxonomy ──────────────────────────────────────────────────────────

type Family = 'cart' | 'kitchen' | 'payment' | 'control' | 'session';

const FAMILY_TYPES: Record<Family, string[]> = {
  cart: [
    'order_opened', 'order_type_changed', 'table_assigned', 'table_transferred',
    'item_added', 'item_qty_changed', 'note_added',
  ],
  kitchen: ['sent_to_kitchen', 'kitchen_bumped', 'kitchen_recalled', 'order_held', 'order_resumed'],
  payment: [
    'payment_started', 'payment_method_selected', 'payment_completed',
    'change_given', 'sale_completed', 'receipt_printed',
  ],
  control: [
    'item_removed_pre_fire', 'item_voided_post_fire', 'discount_applied', 'discount_removed',
    'payment_failed', 'receipt_reprinted', 'refund_issued', 'cash_drawer_opened',
    'manager_pin_used', 'paid_in', 'paid_out',
  ],
  session: ['session_opened', 'session_closed', 'login', 'logout', 'device_switch'],
};

const FAMILY_LABELS: Record<Family | 'all', string> = {
  all: 'All',
  cart: 'Cart',
  kitchen: 'Kitchen',
  payment: 'Payment',
  control: 'Control',
  session: 'Session',
};

const TYPE_LABELS: Record<string, string> = {
  order_opened: 'Order opened', order_type_changed: 'Order type changed',
  table_assigned: 'Table assigned', table_transferred: 'Table transferred',
  item_added: 'Item added', item_qty_changed: 'Qty changed',
  item_removed_pre_fire: 'Item removed', item_voided_post_fire: 'Item voided (post-fire)',
  discount_applied: 'Discount applied', discount_removed: 'Discount removed',
  note_added: 'Note added', sent_to_kitchen: 'Sent to kitchen',
  kitchen_bumped: 'Kitchen bumped', kitchen_recalled: 'Kitchen recalled',
  order_held: 'Order held', order_resumed: 'Order resumed',
  payment_started: 'Payment started', payment_method_selected: 'Method selected',
  payment_completed: 'Payment completed', payment_failed: 'Payment FAILED',
  change_given: 'Change given', receipt_printed: 'Receipt printed',
  receipt_reprinted: 'Receipt REPRINTED', refund_issued: 'Refund issued',
  sale_completed: 'Sale completed', session_opened: 'Session opened',
  session_closed: 'Session closed', cash_drawer_opened: 'Cash drawer opened',
  paid_in: 'Paid in', paid_out: 'Paid out', manager_pin_used: 'Manager PIN used',
  login: 'Login', logout: 'Logout', device_switch: 'Device switch',
};

function familyOf(type: string): Family {
  for (const [fam, types] of Object.entries(FAMILY_TYPES) as [Family, string[]][]) {
    if (types.includes(type)) return fam;
  }
  return 'cart';
}

/** Control signals that warrant a hard visual flag (the fraud read). */
const HOT_TYPES = new Set([
  'payment_failed', 'receipt_reprinted', 'item_voided_post_fire',
  'refund_issued', 'manager_pin_used', 'paid_out',
]);

function toneOf(e: PosJournalEvent): { bg: string; fg: string; icon: LucideIcon } {
  const fam = familyOf(e.event_type);
  // A manual drawer kick (no sale attached) is the #1 signal — always hot.
  const manualDrawer =
    e.event_type === 'cash_drawer_opened' &&
    (e.payload as { trigger?: string }).trigger === 'manual';
  if (HOT_TYPES.has(e.event_type) || manualDrawer) {
    return { bg: 'bg-red/15', fg: 'text-red', icon: ShieldAlert };
  }
  switch (fam) {
    case 'control': return { bg: 'bg-gold-soft', fg: 'text-gold', icon: AlertTriangle };
    case 'payment': return { bg: 'bg-green/15', fg: 'text-green', icon: Banknote };
    case 'kitchen': return { bg: 'bg-gold-soft', fg: 'text-gold', icon: ChefHat };
    case 'session': return { bg: 'bg-bg-elevated', fg: 'text-text-secondary', icon: UserRound };
    default:        return { bg: 'bg-bg-elevated', fg: 'text-text-secondary', icon: ShoppingCart };
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ActivityJournal({ period }: { period: ReportsPeriod }): JSX.Element {
  const [family, setFamily] = useState<Family | 'all'>('all');
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [actorId, setActorId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderRef, setOrderRef] = useState<string | null>(null);

  const filters: PosJournalFilters = useMemo(() => ({
    ...EMPTY_JOURNAL_FILTERS,
    eventTypes: family === 'all' ? null : FAMILY_TYPES[family],
    deviceId,
    actorId,
    orderId,
  }), [family, deviceId, actorId, orderId]);

  const q = usePosEventsJournal(period, filters);

  // Page-1 facets survive across cursor pages (later pages return []).
  const firstPage = q.data?.pages[0];
  const devices = firstPage?.devices ?? [];
  const actors = firstPage?.actors ?? [];
  const timezone = firstPage?.timezone ?? 'Asia/Makassar';
  const totalCount = firstPage?.total_count ?? 0;
  const events = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.events), [q.data]);

  // Infinite scroll — auto-fetch when the sentinel enters the viewport.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting) && q.hasNextPage && !q.isFetchingNextPage) {
        void q.fetchNextPage();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [q.hasNextPage, q.isFetchingNextPage, q.fetchNextPage, q]);

  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }),
    [timezone],
  );

  function exportCsv(): void {
    const csv = buildCsv(events, [
      { header: 'Time (WITA)', accessor: (e) => timeFmt.format(new Date(e.occurred_at)) },
      { header: 'Event', accessor: (e) => TYPE_LABELS[e.event_type] ?? e.event_type },
      { header: 'Operator', accessor: (e) => e.actor_name ?? '' },
      { header: 'Device', accessor: (e) => e.device_label },
      { header: 'Ticket', accessor: (e) => e.order_number ?? '' },
      { header: 'Amount', accessor: (e) => e.amount, format: 'idr' },
      { header: 'Reason', accessor: (e) => e.reason ?? '' },
      { header: 'Detail', accessor: (e) => JSON.stringify(e.payload) },
    ]);
    downloadCsv(csv, `pos-journal_${period.startDate}_${period.endDate}.csv`);
  }

  function filterByTicket(e: PosJournalEvent): void {
    if (!e.order_id) return;
    setOrderId(e.order_id);
    setOrderRef(e.order_number ?? e.order_id.slice(0, 8));
  }

  if (q.isLoading) return <p className="text-text-secondary text-sm">Loading journal…</p>;
  if (q.isError) {
    const denied = (q.error as Error).message.includes('42501')
      || (q.error as Error).message.toLowerCase().includes('permission');
    return (
      <p className="text-red text-sm">
        {denied ? 'You do not have permission to read the audit journal (reports.audit.read).' : 'Failed to load the journal.'}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Family chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {(Object.keys(FAMILY_LABELS) as (Family | 'all')[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFamily(f)}
            aria-pressed={family === f}
            className={cn(
              'inline-flex items-center px-3 h-8 rounded-full border text-xs font-semibold',
              'transition-colors motion-reduce:transition-none',
              family === f
                ? 'bg-gold-soft border-gold text-gold'
                : 'bg-bg-elevated border-border-subtle text-text-secondary hover:text-text-primary',
            )}
          >
            {FAMILY_LABELS[f]}
          </button>
        ))}
      </div>

      {/* Device / operator selects + ticket chip + export */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          aria-label="Filter by device"
          value={deviceId ?? ''}
          onChange={(e) => setDeviceId(e.target.value || null)}
          className="h-8 rounded-md bg-bg-elevated border border-border-subtle text-xs text-text-primary px-2"
        >
          <option value="">All devices</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>{d.label}{d.is_registered ? '' : ' (unregistered)'}</option>
          ))}
        </select>
        <select
          aria-label="Filter by operator"
          value={actorId ?? ''}
          onChange={(e) => setActorId(e.target.value || null)}
          className="h-8 rounded-md bg-bg-elevated border border-border-subtle text-xs text-text-primary px-2"
        >
          <option value="">All operators</option>
          {actors.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        {orderId ? (
          <button
            type="button"
            onClick={() => { setOrderId(null); setOrderRef(null); }}
            className="inline-flex items-center gap-1.5 px-3 h-8 rounded-full border bg-gold-soft border-gold text-gold text-xs font-semibold"
          >
            Ticket {orderRef} <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
        <div className="flex-1" />
        <button
          type="button"
          onClick={exportCsv}
          disabled={events.length === 0}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 h-8 rounded-md border text-xs font-semibold',
            'bg-bg-elevated border-border-subtle text-text-secondary hover:text-text-primary disabled:opacity-50',
          )}
        >
          <Download className="h-3.5 w-3.5" aria-hidden /> CSV
        </button>
      </div>

      <div className="text-xs text-text-muted" data-testid="journal-counts">
        {events.length} of {totalCount} events · timezone {timezone}
      </div>

      {events.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No journal events"
          description="No operator activity recorded for this filter and period."
        />
      ) : (
        <ul className="space-y-1.5" data-testid="journal-list">
          {events.map((e) => (
            <JournalRow key={e.id} event={e} timeFmt={timeFmt} onTicket={filterByTicket} />
          ))}
        </ul>
      )}

      {/* Infinite-scroll sentinel + explicit fallback */}
      <div ref={sentinelRef} aria-hidden className="h-1" />
      {q.hasNextPage ? (
        <button
          type="button"
          onClick={() => void q.fetchNextPage()}
          disabled={q.isFetchingNextPage}
          className="w-full h-9 rounded-md border border-border-subtle bg-bg-elevated text-xs font-semibold text-text-secondary hover:text-text-primary"
          data-testid="journal-load-more"
        >
          {q.isFetchingNextPage
            ? <span className="inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Loading…</span>
            : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}

function JournalRow({
  event: e,
  timeFmt,
  onTicket,
}: {
  event: PosJournalEvent;
  timeFmt: Intl.DateTimeFormat;
  onTicket: (e: PosJournalEvent) => void;
}): JSX.Element {
  const tone = toneOf(e);
  const Icon = tone.icon;
  const hot = tone.fg === 'text-red';

  return (
    <li
      className={cn(
        'rounded-lg border px-3 py-2 flex items-center gap-3',
        hot ? 'border-red/40 bg-red/5' : 'border-border-subtle bg-bg-elevated',
      )}
      data-testid={`journal-${e.id}`}
    >
      <div aria-hidden className={cn('h-8 w-8 rounded-md inline-flex items-center justify-center shrink-0', tone.bg, tone.fg)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <span className={cn('font-bold uppercase tracking-wider', tone.fg)}>
            {TYPE_LABELS[e.event_type] ?? e.event_type}
          </span>
          {e.order_number ? (
            <button
              type="button"
              onClick={() => onTicket(e)}
              className="font-mono text-text-muted hover:text-gold underline-offset-2 hover:underline"
              title="Show this ticket's timeline"
            >
              {e.order_number}
            </button>
          ) : null}
          {e.reason ? <span className="text-text-muted truncate">— {e.reason}</span> : null}
        </div>
        <div className="text-xs text-text-secondary truncate">
          {e.actor_name ?? 'Unknown operator'} · {e.device_label}
        </div>
      </div>
      <div className="text-right shrink-0">
        {e.amount !== null ? (
          <Currency amount={e.amount} emphasis="gold" {...(hot ? { className: 'text-red' } : {})} />
        ) : null}
        <div className="text-[11px] text-text-muted font-mono">{timeFmt.format(new Date(e.occurred_at))}</div>
      </div>
    </li>
  );
}
