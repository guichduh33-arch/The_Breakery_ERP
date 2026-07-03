// apps/pos/src/features/kds/__tests__/kds-board-error.smoke.test.tsx
//
// S57 P2.3 (C-D1) — a failed KDS fetch must surface a distinct error panel, NOT
// "No active tickets" — the kitchen would otherwise believe the queue is empty
// and stop cooking. Tapping Retry re-runs the query.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { KdsBoard } from '../KdsBoard';

const refetch = vi.fn();

vi.mock('../hooks/useKdsOrders', () => ({
  useKdsOrders: () => ({ data: [], isLoading: false, isError: true, refetch }),
}));
vi.mock('../hooks/useAgeTimer', () => ({
  useAgeTimer: () => Date.parse('2026-05-14T12:00:00.000Z'),
}));

const storeState = {
  selectedStation: 'kitchen' as const,
  setStation: vi.fn(),
  kdsStationFilter: 'all' as const,
  setKdsStationFilter: vi.fn(),
};
vi.mock('@/stores/kdsStore', () => ({
  useKdsStore: <T,>(selector: (s: typeof storeState) => T) => selector(storeState),
}));

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

describe('KdsBoard — load error (C-D1)', () => {
  beforeEach(() => refetch.mockClear());

  it('renders the error panel instead of the empty state on fetch error', () => {
    render(wrap(<KdsBoard />));

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/connexion au kds perdue/i)).toBeInTheDocument();
    expect(screen.queryByText(/no active tickets/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
