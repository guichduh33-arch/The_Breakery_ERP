// apps/backoffice/src/features/inventory-alerts/__tests__/AlertsBadge.test.tsx
// Session 13 / Phase 2.D — AlertsBadge renders the topbar count.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertsBadge } from '../components/AlertsBadge.js';
import * as lowStockMod from '../hooks/useLowStock.js';
import * as reorderMod from '../hooks/useReorderSuggestions.js';
import * as expiringMod from '@/features/inventory/hooks/useExpiringLots.js';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeQuery(data: unknown): any {
  return { data, isLoading: false, error: null };
}

describe('AlertsBadge', () => {
  it('renders zero state when no alerts', () => {
    vi.spyOn(lowStockMod, 'useLowStock').mockReturnValue(fakeQuery([]));
    vi.spyOn(reorderMod, 'useReorderSuggestions').mockReturnValue(fakeQuery([]));
    vi.spyOn(expiringMod, 'useExpiringLots').mockReturnValue(fakeQuery([]));

    render(wrap(<AlertsBadge />));
    expect(screen.getByLabelText(/No inventory alerts/i)).toBeInTheDocument();
  });

  it('renders total count when alerts present', () => {
    vi.spyOn(lowStockMod, 'useLowStock').mockReturnValue(fakeQuery([
      { product_id: '1' }, { product_id: '2' },
    ]));
    vi.spyOn(reorderMod, 'useReorderSuggestions').mockReturnValue(fakeQuery([
      { product_id: '3' },
    ]));
    vi.spyOn(expiringMod, 'useExpiringLots').mockReturnValue(fakeQuery([
      { id: 'l1' }, { id: 'l2' }, { id: 'l3' },
    ]));

    render(wrap(<AlertsBadge />));
    // total = 2 + 1 + 3 = 6
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByLabelText(/6 active inventory alerts/i)).toBeInTheDocument();
  });
});
