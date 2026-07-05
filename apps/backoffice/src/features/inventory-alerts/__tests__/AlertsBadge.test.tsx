// apps/backoffice/src/features/inventory-alerts/__tests__/AlertsBadge.test.tsx
// Session 13 / Phase 2.D — AlertsBadge renders the topbar count.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { AlertsBadge } from '../components/AlertsBadge.js';
import * as lowStockMod from '../hooks/useLowStock.js';
import type { LowStockRow } from '../hooks/useLowStock.js';
import * as reorderMod from '../hooks/useReorderSuggestions.js';
import type { ReorderSuggestion } from '../hooks/useReorderSuggestions.js';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

function fakeQuery<T>(data: T): UseQueryResult<T, Error> {
  return { data, isLoading: false, error: null } as unknown as UseQueryResult<T, Error>;
}

describe('AlertsBadge', () => {
  it('renders zero state when no alerts', () => {
    vi.spyOn(lowStockMod, 'useLowStock').mockReturnValue(fakeQuery<LowStockRow[]>([]));
    vi.spyOn(reorderMod, 'useReorderSuggestions').mockReturnValue(fakeQuery<ReorderSuggestion[]>([]));

    render(wrap(<AlertsBadge />));
    expect(screen.getByLabelText(/No inventory alerts/i)).toBeInTheDocument();
  });

  it('renders total count when alerts present', () => {
    vi.spyOn(lowStockMod, 'useLowStock').mockReturnValue(fakeQuery([
      { product_id: '1' }, { product_id: '2' },
    ] as LowStockRow[]));
    vi.spyOn(reorderMod, 'useReorderSuggestions').mockReturnValue(fakeQuery([
      { product_id: '3' },
    ] as ReorderSuggestion[]));

    render(wrap(<AlertsBadge />));
    // total = 2 + 1 = 3
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByLabelText(/3 active inventory alerts/i)).toBeInTheDocument();
  });
});
