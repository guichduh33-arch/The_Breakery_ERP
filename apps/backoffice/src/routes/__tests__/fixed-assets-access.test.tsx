// apps/backoffice/src/routes/__tests__/fixed-assets-access.test.tsx
//
// ADR-047 décision 9 — le registre se lit sous `reports.statements.read`.
// Le refus de route ne doit déclencher aucun appel ; la garde serveur 42501
// reste la seconde ligne.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Outlet } from 'react-router-dom';

const state = vi.hoisted(() => ({
  isAuthenticated: true,
  user: { role_code: 'ADMIN' },
  hasPermission: vi.fn((_code: string) => true),
  rpc: vi.fn((_fn: string, _args: unknown) => Promise.resolve({ data: [] as unknown, error: null })),
}));
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
Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: StubResizeObserver });

function open(path: string): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>
    </QueryClientProvider>,
  );
}
const registerCalls = (): number =>
  state.rpc.mock.calls.filter(([fn]) => fn === 'get_fixed_assets_v1' || fn === 'get_fixed_asset_v1').length;

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe('fixed asset register access', () => {
  it.each(['/backoffice/accounting/fixed-assets', '/backoffice/accounting/fixed-assets/a-1'])(
    'denies %s without reports.statements.read, with no RPC call', async (path) => {
      state.hasPermission.mockImplementation((code: string) => code !== 'reports.statements.read');
      open(path);
      expect(await screen.findByTestId('route-denied')).toHaveTextContent('reports.statements.read');
      expect(screen.getByTestId('shell-nav')).toBeInTheDocument();
      expect(registerCalls()).toBe(0);
    },
  );

  it('mounts the register for a holder of the statements permission', async () => {
    state.hasPermission.mockImplementation((code: string) => code === 'reports.statements.read');
    open('/backoffice/accounting/fixed-assets');
    // Page chargée en lazy : le premier import peut dépasser 1 s.
    expect(await screen.findByRole('heading', { name: 'Fixed assets', level: 1 }, { timeout: 10_000 })).toBeInTheDocument();
    await waitFor(() => { expect(registerCalls()).toBeGreaterThan(0); });
    expect(screen.queryByTestId('fa-register-open')).not.toBeInTheDocument();
  });
});
