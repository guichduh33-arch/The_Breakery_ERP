// apps/pos/src/features/reports/__tests__/ActivityJournal.test.tsx
//
// S72 Lot 4 smoke — the Activity tab's Journal view (pos_events audit journal).
// Validates: audit-perm gating of the Sales|Journal toggle, the journal rows
// (operator/device/ticket), control-signal (hot) highlighting for a manual
// drawer kick, the per-ticket filter chip, and the load-more pagination
// affordance. Mocks usePosEventsJournal + useAuthStore.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import POSActivityReportPage from '../POSActivityReportPage';
import type { PosJournalEvent } from '../hooks/usePosEventsJournal';

// ── Mocks ────────────────────────────────────────────────────────────────────

const sales = { current: { data: [] as unknown[], isLoading: false, isError: false } };
vi.mock('../hooks/usePOSReports', () => ({
  usePOSReportsActivity: () => sales.current,
}));

const journal = vi.hoisted(() => ({
  current: {
    data: undefined as { pages: unknown[] } | undefined,
    isLoading: false,
    isError: false,
    error: null as Error | null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  },
  lastFilters: null as unknown,
}));
vi.mock('../hooks/usePosEventsJournal', () => ({
  EMPTY_JOURNAL_FILTERS: { eventTypes: null, deviceId: null, actorId: null, orderId: null },
  usePosEventsJournal: (_period: unknown, filters: unknown) => {
    journal.lastFilters = filters;
    return journal.current;
  },
}));

const perms = { current: new Set(['reports.sales.read', 'reports.audit.read']) };
vi.mock('@/stores/authStore', () => ({
  useAuthStore: <T,>(selector: (s: { hasPermission: (code: string) => boolean }) => T) =>
    selector({ hasPermission: (code: string) => perms.current.has(code) }),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

function evt(over: Partial<PosJournalEvent>): PosJournalEvent {
  return {
    id: crypto.randomUUID(),
    event_type: 'item_added',
    occurred_at: '2026-07-11T02:00:00Z',
    device_id: 'dev-1',
    device_label: 'Caisse 1',
    device_kind: 'counter',
    device_seq: 1,
    actor_id: 'u-1',
    actor_name: 'Alice',
    session_id: null,
    order_id: null,
    order_number: null,
    order_item_id: null,
    amount: null,
    reason: null,
    payload: {},
    ...over,
  };
}

function page(events: PosJournalEvent[], extra: Record<string, unknown> = {}) {
  return {
    timezone: 'Asia/Makassar',
    total_count: events.length,
    next_cursor: null,
    devices: [{ id: 'dev-1', label: 'Caisse 1', kind: 'counter', is_registered: true }],
    actors: [{ id: 'u-1', name: 'Alice' }],
    events,
    ...extra,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <POSActivityReportPage />
    </MemoryRouter>,
  );
}

function openJournal() {
  fireEvent.click(screen.getByTestId('activity-view-journal'));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Activity — Journal view (S72 Lot 4)', () => {
  beforeEach(() => {
    sales.current = { data: [], isLoading: false, isError: false };
    journal.current = {
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    };
    journal.lastFilters = null;
    perms.current = new Set(['reports.sales.read', 'reports.audit.read']);
  });

  it('hides the Sales|Journal toggle without reports.audit.read', () => {
    perms.current = new Set(['reports.sales.read']);
    renderPage();
    expect(screen.queryByTestId('activity-view-journal')).not.toBeInTheDocument();
  });

  it('renders journal rows with operator, device and hot control-signal styling', () => {
    journal.current.data = {
      pages: [page([
        evt({ id: 'e-1', event_type: 'cash_drawer_opened', payload: { trigger: 'manual' } }),
        evt({ id: 'e-2', event_type: 'item_added' }),
      ])],
    };
    renderPage();
    openJournal();

    const hot = screen.getByTestId('journal-e-1');
    expect(within(hot).getByText('Cash drawer opened')).toBeInTheDocument();
    expect(hot.className).toContain('border-red');
    const normal = screen.getByTestId('journal-e-2');
    expect(normal.className).not.toContain('border-red');
    expect(within(normal).getByText(/Alice · Caisse 1/)).toBeInTheDocument();
    expect(screen.getByTestId('journal-counts')).toHaveTextContent('2 of 2 events');
  });

  it('clicking a ticket ref narrows the filters to that order (per-ticket timeline)', () => {
    journal.current.data = {
      pages: [page([
        evt({ id: 'e-3', event_type: 'payment_completed', order_id: 'ord-9', order_number: '#0042', amount: 55_000 }),
      ])],
    };
    renderPage();
    openJournal();

    fireEvent.click(screen.getByRole('button', { name: '#0042' }));
    expect((journal.lastFilters as { orderId: string | null }).orderId).toBe('ord-9');
    // The clearable ticket chip appears.
    expect(screen.getByRole('button', { name: /Ticket #0042/ })).toBeInTheDocument();
  });

  it('shows Load more when a next page exists and fetches it on click', () => {
    journal.current.data = { pages: [page([evt({ id: 'e-4' })], { next_cursor: 'c1' })] };
    journal.current.hasNextPage = true;
    renderPage();
    openJournal();

    const btn = screen.getByTestId('journal-load-more');
    fireEvent.click(btn);
    expect(journal.current.fetchNextPage).toHaveBeenCalled();
  });

  it('renders the empty state when the period has no events', () => {
    journal.current.data = { pages: [page([])] };
    renderPage();
    openJournal();
    expect(screen.getByText('No journal events')).toBeInTheDocument();
  });

  it('renders a server-derived void as hot with the server badge (S72 Lot 5)', () => {
    journal.current.data = {
      pages: [page([
        evt({
          id: 'e-5',
          event_type: 'order_voided',
          order_number: '#0007',
          amount: 120_000,
          reason: 'wrong order',
          device_label: 'Server (money-path)',
          device_kind: 'server',
          payload: { source: 'server' },
        }),
      ])],
    };
    renderPage();
    openJournal();

    const row = screen.getByTestId('journal-e-5');
    expect(within(row).getByText('Order VOIDED')).toBeInTheDocument();
    expect(row.className).toContain('border-red'); // hot control signal
    expect(within(row).getByText('server')).toBeInTheDocument(); // derived badge
    expect(within(row).getByText(/Server \(money-path\)/)).toBeInTheDocument();
  });
});
