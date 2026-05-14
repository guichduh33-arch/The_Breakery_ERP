// apps/pos/src/features/reports/POSActivityReportPage.tsx
//
// Session 14 — Phase 2.D — POS Reports / Activity tab.
//
// Visual ref: 84-pos-reports-activity-month.jpg.
//
// Layout: filter chips (All / Sales / Session Open / Session Close), then
// total event count, then a timeline of cards. Each card: type label in
// color, reference id, friendly label, timestamp; sale rows also show the
// amount in gold.

import { useMemo, useState, type JSX } from 'react';
import {
  Activity,
  Clock,
  LogIn,
  LogOut,
  ShoppingCart,
  type LucideIcon,
} from 'lucide-react';
import { Currency, EmptyState, cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';
import { POSReportsLayout } from './components/POSReportsLayout';
import {
  usePOSReportsActivity,
  type POSReportsEvent,
  type POSReportsEventKind,
} from './hooks/usePOSReports';
import { ReportsForbidden } from './components/ReportsForbidden';

type Filter = 'all' | POSReportsEventKind;

const FILTER_LABELS: Record<Filter, string> = {
  all: 'All',
  sale: 'Sales',
  session_open: 'Session Open',
  session_close: 'Session Close',
};

export default function POSActivityReportPage(): JSX.Element {
  const canRead = useAuthStore((s) => s.hasPermission('reports.sales.read'));
  if (!canRead) return <ReportsForbidden />;

  return (
    <POSReportsLayout activeTab="activity">
      {(period) => <ActivityList period={period} />}
    </POSReportsLayout>
  );
}

function ActivityList({
  period,
}: {
  period: { start: string; end: string; label: string };
}): JSX.Element {
  const { data, isLoading, isError } = usePOSReportsActivity(period as Parameters<typeof usePOSReportsActivity>[0]);
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, sale: 0, session_open: 0, session_close: 0 };
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

function eventTone(kind: POSReportsEventKind): {
  bg: string;
  fg: string;
  icon: LucideIcon;
  label: string;
} {
  switch (kind) {
    case 'sale':
      return { bg: 'bg-green/15', fg: 'text-green', icon: ShoppingCart, label: 'SALE' };
    case 'session_open':
      return { bg: 'bg-blue-info/15', fg: 'text-blue-info', icon: LogIn, label: 'SESSION OPEN' };
    case 'session_close':
      return { bg: 'bg-text-muted/15', fg: 'text-text-muted', icon: LogOut, label: 'SESSION CLOSE' };
  }
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
