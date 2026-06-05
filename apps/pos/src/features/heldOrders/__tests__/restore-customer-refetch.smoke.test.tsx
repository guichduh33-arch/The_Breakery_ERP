// apps/pos/src/features/heldOrders/__tests__/restore-customer-refetch.smoke.test.tsx
//
// DEV-S35-C-05 — restore_held_order_v1 returns only customerId, and
// cartStore.restoreCart resets attachedCustomer to null. Restoring a held order
// with a customer must re-fetch the full customer object so the badge (name,
// tier, points) comes back — not just the bare customerId used for pricing/JE.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { rpc, maybeSingle, eqId } = vi.hoisted(() => ({
  rpc: vi.fn(),
  maybeSingle: vi.fn(),
  eqId: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc,
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: eqId })),
    })),
  },
}));

import { useRestoreHeldOrder } from '../hooks/useRestoreHeldOrder';
import { useCartStore } from '@/stores/cartStore';

function wrap({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  useCartStore.getState().clear();
  useCartStore.setState({ attachedCustomer: null } as never);
  // .from('customers').select(...).eq('id', id).is('deleted_at', null).maybeSingle()
  eqId.mockReturnValue({ is: vi.fn(() => ({ maybeSingle })) });
});

describe('held restore re-attaches the customer object (DEV-S35-C-05)', () => {
  it('restores attachedCustomer (badge), not just customerId', async () => {
    rpc.mockResolvedValue({
      data: { order_id: 'o1', order_type: 'dine_in', customerId: 'c1', tableNumber: null, notes: null, items: [] },
      error: null,
    });
    maybeSingle.mockResolvedValue({
      data: { id: 'c1', name: 'Jean Habitué', customer_type: 'retail', loyalty_points: 120, category: null },
      error: null,
    });

    const { result } = renderHook(() => useRestoreHeldOrder(), { wrapper: wrap });
    await result.current.mutateAsync('o1');

    await waitFor(() => {
      const s = useCartStore.getState();
      expect(s.attachedCustomer?.name).toBe('Jean Habitué');
      expect(s.cart.customerId).toBe('c1');
    });
  });

  it('keeps customerId even if the customer lookup fails (best-effort badge)', async () => {
    rpc.mockResolvedValue({
      data: { order_id: 'o2', order_type: 'take_out', customerId: 'c2', tableNumber: null, notes: null, items: [] },
      error: null,
    });
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const { result } = renderHook(() => useRestoreHeldOrder(), { wrapper: wrap });
    await result.current.mutateAsync('o2');

    const s = useCartStore.getState();
    expect(s.cart.customerId).toBe('c2'); // pricing/JE key preserved
    expect(s.attachedCustomer).toBeNull(); // badge simply absent, no crash
  });
});
