// apps/pos/src/features/kds/__tests__/AllReadyButton.smoke.test.tsx
// Session 60 (04 D1.2) — RTL smoke for the order-level "All ready" CTA.
// Mirrors BumpButton.smoke.test.tsx.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { KdsOrderCard } from '../components/KdsOrderCard';
import type { KdsItemRow } from '../hooks/useKdsOrders';

const rpcMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

function makeItem(overrides: Partial<KdsItemRow>): KdsItemRow {
  return {
    id: 'oi-1',
    order_id: 'ord-1',
    product_id: 'prod-1',
    product_name: 'Test product',
    quantity: 1,
    unit_price: 10000,
    modifiers: [],
    modifiers_total: 0,
    kitchen_status: 'pending',
    dispatch_station: 'kitchen',
    dispatch_stations: null,
    order_number: '#B-1',
    order_status: 'draft',
    order_notes: null,
    sent_to_kitchen_at: new Date().toISOString(),
    ready_at: null,
    prep_started_at: null,
    is_cancelled: false,
    cancelled_at: null,
    cancelled_reason: null,
    ...overrides,
  } as KdsItemRow;
}

describe('AllReadyButton (KdsOrderCard header)', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('renders "All ready" when the order has pending/preparing items', () => {
    const items = [
      makeItem({ id: 'oi-1', kitchen_status: 'pending' }),
      makeItem({ id: 'oi-2', kitchen_status: 'preparing' }),
    ];
    render(withQuery(<KdsOrderCard items={items} />));
    expect(screen.getByRole('button', { name: /bump all items to ready/i })).toBeInTheDocument();
  });

  it('is absent when all items are already ready or cancelled', () => {
    const items = [
      makeItem({ id: 'oi-1', kitchen_status: 'ready' }),
      makeItem({ id: 'oi-2', kitchen_status: 'pending', is_cancelled: true }),
    ];
    render(withQuery(<KdsOrderCard items={items} />));
    expect(screen.queryByRole('button', { name: /bump all items to ready/i })).not.toBeInTheDocument();
  });

  it('calls kds_bump_order_v1 with the order id and an idempotency key on click', async () => {
    rpcMock.mockResolvedValue({ data: 2, error: null });

    const items = [
      makeItem({ id: 'oi-1', order_id: 'ord-1', kitchen_status: 'pending' }),
      makeItem({ id: 'oi-2', order_id: 'ord-1', kitchen_status: 'preparing' }),
    ];
    render(withQuery(<KdsOrderCard items={items} />));
    fireEvent.click(screen.getByRole('button', { name: /bump all items to ready/i }));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith('kds_bump_order_v1', expect.objectContaining({
        p_order_id: 'ord-1',
        p_idempotency_key: expect.any(String),
      }));
    });
  });
});
