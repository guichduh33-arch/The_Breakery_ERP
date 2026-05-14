// apps/backoffice/src/features/accounting-mappings/__tests__/MappingsPage.smoke.test.tsx
// Session 13 / Phase 6.C — smoke test for the accounting mappings admin page.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MappingsPage from '@/pages/accounting/MappingsPage.js';

const currentPerms = new Set<string>(['accounting.read', 'accounting.mapping.update']);

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

const MOCK_ROWS = [
  {
    mapping_key:  'SALE_POS_REVENUE',
    account_code: '4100',
    description:  'POS sale revenue → CR Sales Revenue',
    is_active:    true,
    updated_at:   '2026-05-14T00:00:00Z',
    accounts:     { name: 'Sales Revenue', is_postable: true, is_active: true },
  },
  {
    mapping_key:  'SALE_PAYMENT_CASH',
    account_code: '1110',
    description:  'Sale payment via cash → DR Cash on Hand',
    is_active:    true,
    updated_at:   '2026-05-14T00:00:00Z',
    accounts:     { name: 'Cash on Hand', is_postable: true, is_active: true },
  },
];

// Mock chain that returns itself for any builder method and resolves on
// `order()` with the right shape per table. `useMappings` uses
// `from('accounting_mappings').select(...).order(...)`. `usePostableAccounts`
// uses `from('accounts').select(...).eq().eq().is().order(...)`.
vi.mock('@/lib/supabase.js', () => {
  function buildChain(table: string) {
    type Resolver = () => Promise<{ data: unknown; error: null }>;
    const resolve: Resolver =
      table === 'accounts'
        ? () => Promise.resolve({ data: [], error: null })
        : () => Promise.resolve({ data: MOCK_ROWS, error: null });
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq:     () => chain,
      is:     () => chain,
      order:  resolve,
    };
    return chain;
  }
  return {
    supabase: {
      from: (t: string) => buildChain(t),
      rpc:  () => Promise.resolve({ data: null, error: null }),
    },
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MappingsPage />
    </QueryClientProvider>,
  );
}

describe('MappingsPage (smoke)', () => {
  beforeEach(() => {
    currentPerms.clear();
    currentPerms.add('accounting.read');
    currentPerms.add('accounting.mapping.update');
  });

  it('renders heading + table rows for each mapping_key', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /accounting mappings/i, level: 1 })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText('SALE_POS_REVENUE').length).toBeGreaterThan(0);
      expect(screen.getAllByText('SALE_PAYMENT_CASH').length).toBeGreaterThan(0);
    });
  });

  it('hides Edit button when accounting.mapping.update is missing', async () => {
    currentPerms.delete('accounting.mapping.update');
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('SALE_POS_REVENUE').length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('blocks page when accounting.read is missing', () => {
    currentPerms.clear();
    renderPage();
    expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
  });
});
