// apps/pos/src/features/tablet/__tests__/TabletLayout.header.test.tsx
//
// LOT 6 (POS P0 hardening, audit 2026-06-25) — the tablet header gains an
// active-table chip, a persistent online/offline pill, and a live order count
// badge on the Orders tab.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useTabletCartStore } from '@/stores/tabletCartStore';

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
  supabaseUrl: 'http://localhost:54321',
}));

const offlineMock = vi.hoisted(() => ({ isOnline: true }));
vi.mock('@/features/tablet/hooks/useTabletOffline', () => ({
  useTabletOffline: () => ({ isOnline: offlineMock.isOnline, lastSync: null }),
}));

const ordersMock = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock('@/features/tablet/hooks/useMyTabletOrders', () => ({
  useMyTabletOrders: () => ({ data: ordersMock.data }),
}));

function wrap(node: ReactNode): ReactNode {
  return <MemoryRouter initialEntries={['/tablet/order']}>{node}</MemoryRouter>;
}

describe('TabletLayout header (LOT 6)', () => {
  beforeEach(() => {
    offlineMock.isOnline = true;
    ordersMock.data = [];
    useAuthStore.setState({
      user: { id: 'w1', full_name: 'Demo Waiter', role_code: 'waiter', employee_code: 'EMP1' },
      permissions: ['sales.create'],
      isAuthenticated: true,
      sessionToken: 'tok',
      isLoading: false,
      error: null,
    });
    useTabletCartStore.setState({ items: [], tableNumber: null, orderType: 'dine_in' });
  });

  it('shows "No table" when none picked and the active table when set', async () => {
    const { default: TabletLayout } = await import('@/pages/tablet/TabletLayout');
    const { rerender } = render(wrap(<TabletLayout />));
    expect(screen.getByTestId('tablet-active-table')).toHaveTextContent(/no table/i);

    useTabletCartStore.setState({ tableNumber: 'T7' });
    rerender(wrap(<TabletLayout />));
    expect(screen.getByTestId('tablet-active-table')).toHaveTextContent(/table t7/i);
  });

  it('shows an Online pill when connected and Offline when not', async () => {
    const { default: TabletLayout } = await import('@/pages/tablet/TabletLayout');
    const { rerender } = render(wrap(<TabletLayout />));
    expect(screen.getByTestId('tablet-connection-pill')).toHaveTextContent(/online/i);

    offlineMock.isOnline = false;
    rerender(wrap(<TabletLayout />));
    expect(screen.getByTestId('tablet-connection-pill')).toHaveTextContent(/offline/i);
  });

  it('badges the Orders tab with the live order count', async () => {
    ordersMock.data = [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }];
    const { default: TabletLayout } = await import('@/pages/tablet/TabletLayout');
    render(wrap(<TabletLayout />));
    expect(screen.getByLabelText(/3 orders/i)).toHaveTextContent('3');
  });
});
