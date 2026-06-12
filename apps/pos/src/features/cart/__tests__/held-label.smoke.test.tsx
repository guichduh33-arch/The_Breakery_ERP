// apps/pos/src/features/cart/__tests__/held-label.smoke.test.tsx
//
// Session 43 — Wave E (P2-3): held order cards show a human label
// "Held {local time} · {Table N | No table}" instead of the raw
// HELD-<uuid> order_number. The full order_number stays available in the
// `title` attribute for support lookups.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const ROWS = [
  {
    id: 'o-1',
    order_number: 'HELD-9b1f2c3d-0000-4000-8000-000000000001',
    table_number: '5',
    notes: null,
    total: 70000,
    created_at: '2026-06-12T07:30:00.000Z',
  },
  {
    id: 'o-2',
    order_number: 'HELD-9b1f2c3d-0000-4000-8000-000000000002',
    table_number: null,
    notes: null,
    total: 35000,
    created_at: '2026-06-12T08:15:00.000Z',
  },
];

vi.mock('@/features/heldOrders/hooks/useHeldOrdersQuery', () => ({
  useHeldOrdersQuery: () => ({ data: ROWS, isLoading: false }),
}));
vi.mock('@/features/heldOrders/hooks/useRestoreHeldOrder', () => ({
  useRestoreHeldOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/heldOrders/hooks/useDiscardHeldOrder', () => ({
  useDiscardHeldOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/features/heldOrders/hooks/useHeldOrdersRealtime', () => ({
  useHeldOrdersRealtime: () => undefined,
}));

import { useCartStore } from '@/stores/cartStore';
import { HeldOrdersModal } from '../HeldOrdersModal';

// Same formatting call as the component — keeps the assertion locale-proof.
function expectedTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

beforeEach(() => {
  vi.clearAllMocks();
  useCartStore.setState({
    cart: { items: [], order_type: 'dine_in' },
  });
});

describe('P2-3 — held order label', () => {
  it('shows "Held {time} · Table N" instead of the raw HELD-<uuid> number', () => {
    render(<HeldOrdersModal open onClose={vi.fn()} />);

    const label = screen.getByText(`Held ${expectedTime(ROWS[0]!.created_at)} · Table 5`);
    expect(label).toBeInTheDocument();
    // Full order_number kept for support via title=.
    expect(label).toHaveAttribute('title', ROWS[0]!.order_number);
    // The raw HELD-<uuid> is no longer rendered as visible text.
    expect(screen.queryByText(ROWS[0]!.order_number)).not.toBeInTheDocument();
  });

  it('falls back to "No table" when the held order has no table', () => {
    render(<HeldOrdersModal open onClose={vi.fn()} />);

    const label = screen.getByText(`Held ${expectedTime(ROWS[1]!.created_at)} · No table`);
    expect(label).toBeInTheDocument();
    expect(label).toHaveAttribute('title', ROWS[1]!.order_number);
  });
});
