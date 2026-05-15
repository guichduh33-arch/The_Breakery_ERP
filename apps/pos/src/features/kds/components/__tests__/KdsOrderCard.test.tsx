// apps/pos/src/features/kds/components/__tests__/KdsOrderCard.test.tsx
//
// Session 14 / Phase 3.A — unit tests for the live-order tile.
//
// Verifies:
//   1. Order number renders in tabular mono (font-mono + tabular-nums) per
//      `live order.jpg` (gold tabular numerals).
//   2. Age timer renders MM:SS in mono and the data-age-band attribute
//      escalates: <300s = 'fresh', >=300s = 'warning', >=600s = 'urgent'
//      (thresholds from `kds configue.jpg`).
//   3. CTA wiring: a pending item shows a "Start" button; a cancelled
//      item shows the "Cancelled" badge instead of any CTA.
//
// No Supabase, no MSW. The mutation hooks are mocked at module level.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { KdsOrderCard } from '../KdsOrderCard';
import type { KdsItemRow } from '../../hooks/useKdsOrders';

// Mock the bump / serve mutations so we never touch supabase or realtime.
vi.mock('../../hooks/useBumpItem', () => ({
  useBumpItem: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../hooks/useMarkItemServed', () => ({
  useMarkItemServed: () => ({ mutate: vi.fn(), isPending: false }),
}));

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

function makeItem(overrides: Partial<KdsItemRow> = {}): KdsItemRow {
  return {
    id: 'oi-1',
    order_id: 'ord-1',
    product_id: 'prod-1',
    product_name: 'Americano',
    quantity: 1,
    unit_price: 35000,
    modifiers: [],
    modifiers_total: 0,
    kitchen_status: 'pending',
    dispatch_station: 'kitchen',
    sent_to_kitchen_at: new Date('2026-05-14T12:00:00.000Z').toISOString(),
    ready_at: null,
    order_number: 'A-001',
    is_cancelled: false,
    cancelled_at: null,
    cancelled_reason: null,
    ...overrides,
  };
}

describe('KdsOrderCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the order number in tabular mono and exposes age band "fresh" under 5min', () => {
    const item = makeItem({
      sent_to_kitchen_at: new Date('2026-05-14T11:59:00.000Z').toISOString(), // 60s ago
    });

    render(wrap(<KdsOrderCard items={[item]} />));

    // Order number prefixed with `#`, mono + tabular-nums for the gold display.
    const orderNum = screen.getByText('#A-001');
    expect(orderNum).toBeInTheDocument();
    expect(orderNum.className).toMatch(/font-mono/);
    expect(orderNum.className).toMatch(/tabular-nums/);
    expect(orderNum.className).toMatch(/text-gold/);

    // Age band attribute exposes the urgency tier for visual + a11y assertions.
    const card = orderNum.closest('article');
    expect(card?.getAttribute('data-age-band')).toBe('fresh');

    // Timer shows MM:SS in mono.
    const timer = screen.getByLabelText(/order age/i);
    expect(timer.textContent).toBe('01:00');
    expect(timer.className).toMatch(/font-mono/);
    expect(timer.className).toMatch(/tabular-nums/);
  });

  it('escalates the age band to "warning" at 300s and "urgent" at 600s (kds configue thresholds)', () => {
    const warningItem = makeItem({
      id: 'oi-warn',
      order_id: 'ord-warn',
      order_number: 'A-002',
      sent_to_kitchen_at: new Date('2026-05-14T11:55:00.000Z').toISOString(), // 5min ago
    });
    const urgentItem = makeItem({
      id: 'oi-urg',
      order_id: 'ord-urg',
      order_number: 'A-003',
      sent_to_kitchen_at: new Date('2026-05-14T11:50:00.000Z').toISOString(), // 10min ago
    });

    const { rerender } = render(wrap(<KdsOrderCard items={[warningItem]} />));
    const warnCard = screen.getByText('#A-002').closest('article');
    expect(warnCard?.getAttribute('data-age-band')).toBe('warning');
    expect(warnCard?.className).toMatch(/border-amber-warn/);

    rerender(wrap(<KdsOrderCard items={[urgentItem]} />));
    const urgCard = screen.getByText('#A-003').closest('article');
    expect(urgCard?.getAttribute('data-age-band')).toBe('urgent');
    expect(urgCard?.className).toMatch(/border-red/);
    expect(urgCard?.className).toMatch(/animate-pulse/);
  });

  it('shows a Start CTA for a pending item and a Cancelled badge (no CTA) for a cancelled item', () => {
    const pending = makeItem({ kitchen_status: 'pending' });
    const cancelled = makeItem({
      id: 'oi-x',
      order_id: 'ord-x',
      order_number: 'A-004',
      kitchen_status: 'pending',
      is_cancelled: true,
      cancelled_at: new Date().toISOString(),
      cancelled_reason: 'Customer request',
    });

    const { rerender } = render(wrap(<KdsOrderCard items={[pending]} />));
    expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument();

    rerender(wrap(<KdsOrderCard items={[cancelled]} />));
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start/i })).not.toBeInTheDocument();
    // Reason is surfaced for the operator.
    expect(screen.getByText(/Customer request/i)).toBeInTheDocument();
  });

  it('uses the oldest item in the order to compute card age (FIFO fairness)', () => {
    const old = makeItem({
      id: 'oi-old',
      sent_to_kitchen_at: new Date('2026-05-14T11:50:00.000Z').toISOString(), // 10min ago
    });
    const fresh = makeItem({
      id: 'oi-new',
      sent_to_kitchen_at: new Date('2026-05-14T11:59:30.000Z').toISOString(), // 30s ago
      product_name: 'Croissant',
    });

    render(wrap(<KdsOrderCard items={[old, fresh]} />));
    // Should clamp to the older 10min item → urgent band.
    const card = screen.getByText('#A-001').closest('article');
    expect(card?.getAttribute('data-age-band')).toBe('urgent');
    expect(screen.getByLabelText(/order age/i).textContent).toBe('10:00');
  });
});
