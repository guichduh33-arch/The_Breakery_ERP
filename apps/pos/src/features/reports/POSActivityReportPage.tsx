// apps/pos/src/features/reports/POSActivityReportPage.tsx
//
// Session 14 — Phase 2.D — POS Reports / Activity tab.
// S72 Lot 4 — split into two views:
//   * Sales   — the Lot G sales-event timeline (get_pos_activity_v1), gated
//               reports.sales.read like the rest of the reports.
//   * Journal — the full operational audit journal (pos_events via
//               get_pos_events_v1): every operator manipulation on every
//               terminal, filterable, infinite-scroll, CSV. Gated
//               reports.audit.read — the toggle only shows with that perm.
//
// Visual ref: 84-pos-reports-activity-month.jpg.

import { useMemo, useState, type JSX } from 'react';
import {
  Activity,
  Clock,
  ShoppingCart,
  type LucideIcon,
} from 'lucide-react';
import { Currency, EmptyState, cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';
import { POSReportsLayout } from './components/POSReportsLayout';
import { ActivityJournal } from './components/ActivityJournal';
import {
  usePOSReportsActivity,
  type POSReportsEvent,
  type POSReportsEventKind,
} from './hooks/usePOSReports';
import type { ReportsPeriod } from './hooks/useReportsPeriod';
import { ReportsForbidden } from './components/ReportsForbidden';

type Filter = 'all' | POSReportsEventKind;

const FILTER_LABELS: Record<Filter, string> = {
  all: 'All',
  sale: 'Sales',
};

export default function POSActivityReportPage(): JSX.Element {
  const canRead = useAuthStore((s) => s.hasPermission('reports.sales.read'));
  const canAudit = useAuthStore((s) => s.hasPermission('reports.audit.read'));
  const [view, setView] = useState<'sales' | 'journal'>('sales');
  if (!canRead) return <ReportsForbidden />;

  return (
    <POSReportsLayout activeTab="activity">
      {(period) => (
        <div className="space-y-4">
          {canAudit ? (
            <div role="tablist" aria-label="Activity view" className="inline-flex rounded-lg border border-border-subtle bg-bg-elevated p-0.5">
              {(['sales', 'journal'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    'px-4 h-8 rounded-md text-xs font-semibold uppercase tracking-wider',
                    'transition-colors motion-reduce:transition-none',
                    view === v ? 'bg-gold-soft text-gold' : 'text-text-secondary hover:text-text-primary',
                  )}
                  data-testid={`activity-view-${v}`}
                >
                  {v === 'sales' ? 'Sales' : 'Journal'}
                </button>
              ))}
            </div>
          ) : null}
          {view === 'journal' && canAudit
            ? <ActivityJournal period={period} />
            : <ActivityList period={period} />}
        </div>
      )}
    </POSReportsLayout>
  );
}

function ActivityList({ period }: { period: ReportsPeriod }): JSX.Element {
  const { data, isLoading, isError } = usePOSReportsActivity(period);
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, sale: 0 };
    for (const e of data ?? []) {
      c.all++;
      c[e.kind]++;
    }
    return c;
  }, [data]);

  const visible = useMemo(() => {
    if (!data) return [];
    if (filter === 'all') return data;
    return data.filter((e) => e.kind === filter);
  }, [data, filter]);

  if (isLoading) return <p className="text-text-secondary text-sm">Loading activity…</p>;
  if (isError) return <p className="text-red text-sm">Failed to load activity.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 h-8 rounded-full border text-xs font-semibold',
              'transition-colors motion-reduce:transition-none',
              filter === f
                ? 'bg-gold-soft border-gold text-gold'
                : 'bg-bg-elevated border-border-subtle text-text-secondary hover:text-text-primary',
            )}
          >
            <span>{FILTER_LABELS[f]}</span>
            <span className="opacity-80 font-normal">{counts[f]}</span>
          </button>
        ))}
      </div>

      <div className="text-xs text-text-muted">{visible.length} events</div>

      {visible.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activity"
          description="No events recorded for this filter and period."
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((e) => (
            <EventRow key={e.id} event={e} />
          ))}
        </ul>
      )}
    </div>
  );
}

function eventTone(_kind: POSReportsEventKind): {
  bg: string;
  fg: string;
  icon: LucideIcon;
  label: string;
} {
  // Single event kind since Lot D (sales only); session events live in the
  // Sessions tab.
  return { bg: 'bg-green/15', fg: 'text-green', icon: ShoppingCart, label: 'SALE' };
}

function EventRow({ event }: { event: POSReportsEvent }): JSX.Element {
  const tone = eventTone(event.kind);
  const Icon = tone.icon;
  const dt = new Date(event.at);
  const date = dt.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  const time = dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <li
      className="rounded-lg border border-border-subtle bg-bg-elevated px-4 py-3 flex items-center gap-3"
      data-testid={`activity-${event.id}`}
    >
      <div
        aria-hidden
        className={cn('h-10 w-10 rounded-md inline-flex items-center justify-center', tone.bg, tone.fg)}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs">
          <span className={cn('font-bold uppercase tracking-widest', tone.fg)}>{tone.label}</span>
          <span className="font-mono text-text-muted truncate">#{event.reference}</span>
        </div>
        <div className="text-sm text-text-primary">{event.label}</div>
      </div>
      <div className="text-right shrink-0">
        {event.amount !== null ? (
          <Currency amount={event.amount} emphasis="gold" />
        ) : null}
        <div className="text-xs text-text-muted inline-flex items-center gap-1">
          <Clock className="h-3 w-3" aria-hidden /> {date}, {time}
        </div>
      </div>
    </li>
  );
}
