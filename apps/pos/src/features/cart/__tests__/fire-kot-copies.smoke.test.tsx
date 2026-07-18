// apps/pos/src/features/cart/__tests__/fire-kot-copies.smoke.test.tsx
//
// Chantier KOT copies (migration _195) — useFireToStations honore les copies
// papier par station lues de business_config (Settings → Printing) :
//   • kitchen = 2 → deux entrées 'prep' kitchen dans le buffer d'impression ;
//   • barista = 0 → station sautée AVANT la résolution imprimante (aucune
//     entrée, aucun toast d'erreur — le KDS écran a déjà reçu via la DB) ;
//   • le ticket waiter consolidé n'est PAS couvert par le réglage (inchangé).
// Structure calquée sur fire-to-stations.smoke.test.tsx.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';
import {
  getMockPrintBuffer,
  clearMockPrintBuffer,
} from '@/services/print/printService';

// ── Static mocks ──────────────────────────────────────────────────────────────

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]): unknown => rpcMock(...a) as unknown,
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) },
  },
  supabaseUrl: 'http://localhost:54321',
}));

// Copies par station : kitchen 2, barista 0 (paperless), display 1.
vi.mock('@/features/settings/hooks/useKotCopies', () => ({
  KOT_COPIES_DEFAULTS: { barista: 1, kitchen: 1, display: 1 },
  useKotCopies: () => ({ data: { barista: 0, kitchen: 2, display: 1 } }),
  getKotCopies: () => Promise.resolve({ barista: 0, kitchen: 2, display: 1 }),
}));

const BARISTA_PRINTER = { ip_address: '192.168.1.11', port: 9100, name: 'Barista' };
const KITCHEN_PRINTER = { ip_address: '192.168.1.12', port: 9100, name: 'Kitchen' };

const PRINTERS_MAP = new Map([
  ['barista', BARISTA_PRINTER],
  ['kitchen', KITCHEN_PRINTER],
]);

vi.mock('@/features/cart/hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({ data: PRINTERS_MAP }),
}));

const PRODUCTS = [
  { id: 'p-barista', name: 'Latte', dispatch_station: 'barista' },
  { id: 'p-kitchen', name: 'Omelette', dispatch_station: 'kitchen' },
];

vi.mock('@/features/products/hooks/useProducts', () => ({
  useProducts: () => ({ data: PRODUCTS }),
}));

vi.mock('@/features/cart/hooks/useStationMap', () => {
  const STATION_MAP: Record<string, string[]> = { 'p-barista': ['barista'], 'p-kitchen': ['kitchen'] };
  return {
    useStationMap: () => ({ data: STATION_MAP }),
    getStationMap: () => Promise.resolve(STATION_MAP),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(['products'], PRODUCTS);
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SendToKitchenButton — KOT copies per station', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PRINT_MOCK', '1');
    clearMockPrintBuffer();
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();

    rpcMock.mockReset();
    rpcMock.mockResolvedValue({
      data: { order_id: 'order-db-1', order_number: '#0042', idempotent_replay: false },
      error: null,
    });
    useShiftStore.setState({ current: { id: 'sess-1', opened_at: '', opening_cash: 0 } });

    useCartStore.setState({
      cart: {
        items: [
          { id: 'line-barista', product_id: 'p-barista', name: 'Latte', unit_price: 30_000, quantity: 1, modifiers: [] },
          { id: 'line-kitchen', product_id: 'p-kitchen', name: 'Omelette', unit_price: 45_000, quantity: 1, modifiers: [] },
        ],
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

  it('prints 2 kitchen copies, skips the paperless barista without an error', async () => {
    const { SendToKitchenButton } = await import('../SendToKitchenButton');

    render(withQuery(<SendToKitchenButton />));

    const btn = screen.getByRole('button', { name: /send to kitchen/i });
    expect(btn).not.toBeDisabled();

    await act(async () => {
      btn.click();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /send to kitchen/i })).toBeInTheDocument();
    });

    const buf = getMockPrintBuffer();
    const prepEntries = buf.filter((e) => e.kind === 'prep');
    const roles = prepEntries.map((e) => (e.payload as { role: string }).role);

    // kitchen = 2 copies, barista = 0 (skipped before printer resolution).
    expect(roles.filter((r) => r === 'kitchen')).toHaveLength(2);
    expect(roles.filter((r) => r === 'barista')).toHaveLength(0);

    // Both stations report success (barista is paperless-by-config, not a
    // failure — its items reached the KDS via the DB persist).
    expect(toast.error).not.toHaveBeenCalled();
    const successMessages = vi.mocked(toast.success).mock.calls.map((c) => c[0] as string);
    expect(successMessages.some((m) => /barista/i.test(m))).toBe(true);
    expect(successMessages.some((m) => /kitchen/i.test(m))).toBe(true);
  });
});
