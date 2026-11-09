// apps/pos/src/features/cart/__tests__/fire-waiter-copies.smoke.test.tsx
//
// S1-22 — useFireToStations honore le nombre de copies du ticket serveur
// (business_config.kot_copies_waiter, réglage Settings → Printing) :
//   • waiter = 2 → deux entrées 'waiter' dans le buffer d'impression ;
//   • waiter = 0 → aucun ticket serveur, les tickets de poste sortent quand même ;
//   • réglage absent (cache ancien) → 1 copie, comportement historique.
// Structure calquée sur fire-kot-copies.smoke.test.tsx.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installPrintLocks } from '@/services/print/__tests__/printBrowser';
import { usePrintJobs } from '@/services/print/printJobs';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';
import { getMockPrintBuffer, clearMockPrintBuffer } from '@/services/print/printService';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

const { rpcMock, copiesRef } = vi.hoisted(() => {
  const ref: { current: Record<string, number> } = { current: {} };
  return { rpcMock: vi.fn(), copiesRef: ref };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]): unknown => rpcMock(...a) as unknown,
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) },
  },
  supabaseUrl: 'http://localhost:54321',
}));

vi.mock('@/features/settings/hooks/useKotCopies', () => ({
  KOT_COPIES_DEFAULTS: { barista: 1, kitchen: 1, display: 1, waiter: 1 },
  useKotCopies: () => ({ data: copiesRef.current }),
  getKotCopies: () => Promise.resolve(copiesRef.current),
}));

const PRINTERS_MAP = new Map([
  ['kitchen', { ip_address: '192.168.1.12', port: 9100, name: 'Kitchen' }],
  ['waiter', { ip_address: '192.168.1.13', port: 9100, name: 'Waiter' }],
]);

vi.mock('@/features/cart/hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({ data: PRINTERS_MAP }),
}));

const PRODUCTS = [{ id: 'p-kitchen', name: 'Omelette', dispatch_station: 'kitchen' }];

vi.mock('@/features/products/hooks/useProducts', () => ({
  useProducts: () => ({ data: PRODUCTS }),
}));

vi.mock('@/features/cart/hooks/useStationMap', () => {
  const STATION_MAP: Record<string, string[]> = { 'p-kitchen': ['kitchen'] };
  return {
    useStationMap: () => ({ data: STATION_MAP }),
    getStationMap: () => Promise.resolve(STATION_MAP),
  };
});

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['products'], PRODUCTS);
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

async function fire() {
  const { SendToKitchenButton } = await import('../SendToKitchenButton');
  render(withQuery(<SendToKitchenButton />));
  const btn = screen.getByRole('button', { name: /send to kitchen/i });
  await act(async () => {
    btn.click();
    await Promise.resolve();
  });
  // Le ticket de poste sort dans tous les cas : il sert de témoin de fin d'envoi.
  await waitFor(() => {
    expect(getMockPrintBuffer().filter((entry) => entry.kind === 'prep')).toHaveLength(1);
  });
}

const waiterEntries = () => getMockPrintBuffer().filter((entry) => entry.kind === 'waiter');

describe('SendToKitchenButton — waiter ticket copies (S1-22)', () => {
  beforeEach(() => {
    usePrintJobs.setState({ jobs: [] });
    installPrintLocks();
    vi.stubEnv('VITE_PRINT_MOCK', '1');
    clearMockPrintBuffer();
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({
      data: { order_id: 'order-db-1', order_number: '#0042', idempotent_replay: false },
      error: null,
    });
    useShiftStore.setState({ current: { id: 'sess-1', opened_at: '', opening_cash: 0 } });
    useCartStore.setState({
      cart: {
        items: [{ id: 'line-kitchen', product_id: 'p-kitchen', name: 'Omelette', unit_price: 45_000, quantity: 1, modifiers: [] }],
        order_type: 'dine_in',
        tableNumber: 'T-01',
      },
      printedItemIds: [],
      lockedItemIds: [],
      attachedCustomer: null,
      pickedUpOrderId: null,
      appliedPromotions: [],
      dismissedPromotionIds: new Set<string>(),
      isOffline: false,
    });
    useAuthStore.setState({
      user: { id: 'u1', full_name: 'Tester', role_code: 'CASHIER', employee_code: 'EMP1' },
      sessionToken: 'tok',
      permissions: ['pos.sale.create'],
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prints the configured number of waiter tickets', async () => {
    copiesRef.current = { barista: 1, kitchen: 1, display: 1, waiter: 2 };
    await fire();
    await waitFor(() => expect(waiterEntries()).toHaveLength(2));
  });

  it('prints no waiter ticket when the setting is 0', async () => {
    copiesRef.current = { barista: 1, kitchen: 1, display: 1, waiter: 0 };
    await fire();
    // Laisse le temps à un éventuel ticket serveur de sortir après le ticket de poste.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(waiterEntries()).toHaveLength(0);
  });

  it('falls back to one waiter ticket when the setting is missing', async () => {
    copiesRef.current = { barista: 1, kitchen: 1, display: 1 };
    await fire();
    await waitFor(() => expect(waiterEntries()).toHaveLength(1));
  });
});
