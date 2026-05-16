// apps/backoffice/src/features/inventory-production/__tests__/ProductionSchedulePage.smoke.test.tsx
// Session 15 / Phase 4.B — ProductionSchedulePage smoke tests.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProductionSchedulePage from '@/pages/inventory/ProductionSchedulePage.js';

const mockRpc = vi.fn();
const mockFromSelect = vi.fn();

let currentPerms = new Set<string>(['inventory.read', 'inventory.production.schedule']);
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

interface RpcResult { data: unknown; error: unknown }

vi.mock('@/lib/supabase.js', () => {
  function buildChain(table: string) {
    const result = { data: mockFromSelect(table), error: null };
    const chain: any = {
      select: () => chain,
      eq:     () => chain,
      gte:    () => chain,
      lte:    () => chain,
      is:     () => chain,
      order:  () => chain,
      limit:  () => Promise.resolve(result),
      single: () => Promise.resolve(result),
      then:   (onResolve: (v: RpcResult) => unknown) => Promise.resolve(result).then(onResolve),
      insert: () => chain,
      update: () => chain,
      delete: () => chain,
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => buildChain(table),
      rpc:  (fn: string, args: unknown) => {
        const out = mockRpc(fn, args) as RpcResult | undefined;
        if (out !== undefined) return Promise.resolve(out);
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ProductionSchedulePage />
    </QueryClientProvider>,
  );
}

describe('ProductionSchedulePage smoke', () => {
  beforeEach(() => {
    currentPerms = new Set(['inventory.read', 'inventory.production.schedule']);
    mockRpc.mockReset();
    mockFromSelect.mockReset();
    mockFromSelect.mockImplementation(() => []);
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'suggest_production_schedule_v1') {
        return {
          data: {
            target_date: '2026-05-18',
            target_dow:  1,
            window_start: '2026-04-20',
            suggestions: [
              { product_id: 'p-1', product_name: 'Croissant', suggested_qty: 24, avg_daily_sales: 22, margin_pct: 65, ranking_score: 1430, has_sufficient_history: true, sale_days: 12 },
              { product_id: 'p-2', product_name: 'Baguette',  suggested_qty: 12, avg_daily_sales: 10, margin_pct: 55, ranking_score: 600,  has_sufficient_history: true, sale_days: 10 },
            ],
          },
          error: null,
        };
      }
      return { data: null, error: null };
    });
  });

  it('renders header + grid + suggestions panel when permitted', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Production Schedule/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('production-calendar-grid')).toBeInTheDocument();
    });
    expect(screen.getByTestId('suggestions-panel')).toBeInTheDocument();
    expect(screen.getByLabelText(/Week start date/i)).toBeInTheDocument();
  });

  it('renders suggestions list with items from the RPC', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('suggestions-list')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('Croissant')).toBeInTheDocument();
      expect(screen.getByText('Baguette')).toBeInTheDocument();
    });
  });

  it('blocks the page when permission is missing', () => {
    currentPerms = new Set(['inventory.read']);
    renderPage();
    expect(
      screen.getByText(/You do not have permission to plan production schedules/i),
    ).toBeInTheDocument();
  });
});
