// apps/backoffice/src/routes/__tests__/owner-report-access.test.tsx
//
// S3-19 — « Production vs Sales » est réservé au propriétaire (décision du
// 2026-11-10). La route l'impose AVANT le montage : `SuperAdminGate` dans le
// `PermissionGate` de `reports.inventory.read`, comme les rapports financiers
// réservés (gabarit `financial-report-access.test.tsx`). La page réelle est
// montée ici, et la RPC espionnée : un refus de route ne doit déclencher aucun
// appel, la garde serveur P0003 restant la seconde ligne.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Outlet } from 'react-router-dom';

const state = vi.hoisted(() => {
  const user: { role_code: string | undefined } = { role_code: 'ADMIN' };
  return {
    isAuthenticated: true,
    user,
    hasPermission: vi.fn((_code: string) => true),
    rpc: vi.fn((_fn: string, _args: unknown) => Promise.resolve({ data: null, error: null })),
  };
});
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: typeof state) => unknown) => selector(state),
}));
vi.mock('@/layouts/BackofficeLayout.js', () => ({
  BackofficeLayout: () => <div><nav data-testid="shell-nav" /><Outlet /></div>,
}));
vi.mock('@/lib/supabase.js', () => ({
  supabase: { rpc: (fn: string, args: unknown) => state.rpc(fn, args) },
}));
import { AppRoutes } from '@/routes/index.js';

class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

function openReport() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/backoffice/reports/production-vs-sales?start=2026-11-01&end=2026-11-02']}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function reportCalls(): number {
  return state.rpc.mock.calls.filter(([fn]) => fn === 'get_production_vs_sales_v3').length;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.user.role_code = 'ADMIN';
  // Le rôle refusé PORTE le droit d'inventaire : seul le rôle le distingue.
  state.hasPermission.mockImplementation((code: string) => code === 'reports.inventory.read');
});
afterEach(cleanup);

describe('production-vs-sales access', () => {
  it.each(['ADMIN', 'MANAGER', undefined])('denies role %s before mounting the page, with no RPC call', async (role) => {
    state.user.role_code = role;
    openReport();
    expect(await screen.findByTestId('route-denied')).toHaveTextContent('Super admin');
    expect(screen.getByTestId('shell-nav')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Production vs Sales' })).toBeNull();
    expect(reportCalls()).toBe(0);
  });

  it('lets the Owner mount the page, which then calls the report RPC', async () => {
    state.user.role_code = 'SUPER_ADMIN';
    openReport();
    // La page réelle est chargée en lazy : le premier import peut dépasser 1 s.
    expect(await screen.findByRole('heading', { name: 'Production vs Sales', level: 1 }, { timeout: 10_000 }))
      .toBeInTheDocument();
    expect(screen.queryByTestId('route-denied')).not.toBeInTheDocument();
    await waitFor(() => { expect(reportCalls()).toBeGreaterThan(0); });
  });

  it('keeps the inventory permission check for the Owner', async () => {
    state.user.role_code = 'SUPER_ADMIN';
    state.hasPermission.mockReturnValue(false);
    openReport();
    expect(await screen.findByTestId('route-denied')).toHaveTextContent('reports.inventory.read');
    expect(reportCalls()).toBe(0);
  });
});
