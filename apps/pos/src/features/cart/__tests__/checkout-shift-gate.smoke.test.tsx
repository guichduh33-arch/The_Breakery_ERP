// apps/pos/src/features/cart/__tests__/checkout-shift-gate.smoke.test.tsx
//
// Critique run 4 lot 8 — shift-gate (décision C du 2026-08-15).
// Composer une commande reste LIBRE sans session de caisse ; les deux gestes qui
// ENGAGENT ne partent pas :
//   1. Checkout sans session → pas de terminal de paiement, le formulaire
//      d'ouverture de session est demandé (tapable-et-explique, aria-disabled).
//   2. Checkout avec session → parcours inchangé (le terminal s'ouvre).
//   3. Send to Kitchen sans session → aucune RPC, ouverture de session demandée,
//      et la garde de TABLE (fiche 02 D2.5) n'est même pas atteinte : la garde
//      de session passe d'abord.
// Les throw `no_open_shift` de useCheckout / useFireToStations restent le filet.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import type { ReactNode } from 'react';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { clearMockPrintBuffer } from '@/services/print/printService';
import { BottomActionBar } from '../BottomActionBar';
import { SendToKitchenButton } from '../SendToKitchenButton';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]): unknown => rpcMock(...a) as unknown,
    auth: {
      setSession: vi.fn(),
      signOut: vi.fn().mockResolvedValue({}),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
          not: vi.fn(() => ({ not: vi.fn().mockResolvedValue({ data: [], error: null }) })),
        })),
        not: vi.fn(() => ({ not: vi.fn().mockResolvedValue({ data: [], error: null }) })),
      })),
    })),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

// La garde lit le MÊME store que le filet client (`no_open_shift`) ; la requête
// ne sert qu'à distinguer « pas de session » de « on ne sait pas encore ». On la
// fige donc à « réponse connue » et on pilote le seul store.
vi.mock('@/features/shift/hooks/useShift', () => ({
  useCurrentShift: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/features/cart/hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({
    data: new Map([['barista', { ip_address: '192.168.1.11', port: 9100, name: 'Barista' }]]),
  }),
}));

vi.mock('@/features/cart/hooks/useStationMap', () => {
  const STATION_MAP: Record<string, string[]> = { 'p-barista': ['barista'] };
  return {
    useStationMap: () => ({ data: STATION_MAP }),
    getStationMap: () => Promise.resolve(STATION_MAP),
  };
});

// Le plan de salle ne doit JAMAIS s'ouvrir dans ces scénarios (la garde de
// session tranche avant) — mocké pour que son montage éventuel soit visible
// sans toucher supabase.
vi.mock('@/features/tables/hooks/useRestaurantTables', () => ({
  useRestaurantTables: () => ({
    data: [{ id: 't1', name: 'T-01', seats: 2, sort_order: 1, is_active: true, section_id: null }],
  }),
}));
vi.mock('@/features/tables/hooks/useTableOccupancy', () => ({
  useTableOccupancy: () => ({}),
}));

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const ITEM = {
  id: 'l1',
  product_id: 'p-barista',
  name: 'Latte',
  unit_price: 30_000,
  quantity: 1,
  modifiers: [] as never[],
};

function seedCart(orderType: string): void {
  useCartStore.setState({
    cart: { items: [ITEM], order_type: orderType },
    lockedItemIds: [],
    printedItemIds: [],
    appliedPromotions: [],
    attachedCustomer: null,
    pickedUpOrderId: null,
  } as never);
}

describe('shift-gate — les gestes qui engagent mènent à l’ouverture de session', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_PRINT_MOCK', '1');
    clearMockPrintBuffer();
    vi.mocked(toast.info).mockClear();
    vi.mocked(toast.warning).mockClear();
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({
      data: { order_id: 'order-db-1', order_number: '#0042', idempotent_replay: false },
      error: null,
    });
    usePaymentStore.setState({ isOpen: false });
    useAuthStore.setState({
      user: { id: 'u1', full_name: 'Tester', role_code: 'CASHIER', employee_code: 'EMP1' },
      sessionToken: 'tok',
      permissions: ['pos.sale.create'],
      isAuthenticated: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sans session : Checkout n’ouvre pas le terminal et demande l’ouverture de session', () => {
    useShiftStore.setState({ current: null });
    seedCart('take_out');
    const onOpenShift = vi.fn();
    render(wrapper(<BottomActionBar onOpenShift={onOpenShift} />));

    const checkout = screen.getByTestId('checkout-cta');
    expect(checkout).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(checkout);

    expect(usePaymentStore.getState().isOpen).toBe(false);
    expect(onOpenShift).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/no shift open/i));
  });

  it('session ouverte : le parcours d’encaissement est inchangé', () => {
    useShiftStore.setState({ current: { id: 'sess-1', opened_at: '', opening_cash: 0 } });
    seedCart('take_out');
    const onOpenShift = vi.fn();
    render(wrapper(<BottomActionBar onOpenShift={onOpenShift} />));

    const checkout = screen.getByTestId('checkout-cta');
    expect(checkout).toHaveAttribute('aria-disabled', 'false');

    fireEvent.click(checkout);

    expect(usePaymentStore.getState().isOpen).toBe(true);
    expect(onOpenShift).not.toHaveBeenCalled();
  });

  it('sans session : l’envoi en cuisine ne part pas, et la garde de table n’est pas atteinte', async () => {
    useShiftStore.setState({ current: null });
    // dine_in SANS table : si la garde de table passait en premier, on verrait
    // son avertissement et le plan de salle au lieu de l’ouverture de session.
    seedCart('dine_in');
    const onRequireShift = vi.fn();
    render(wrapper(<SendToKitchenButton onRequireShift={onRequireShift} />));

    const send = screen.getByRole('button', { name: /send to kitchen/i });
    expect(send).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(send);

    await waitFor(() => { expect(onRequireShift).toHaveBeenCalledTimes(1); });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/no shift open/i));
    expect(toast.warning).not.toHaveBeenCalledWith(
      expect.stringMatching(/dine-in orders need a table/i),
    );
    expect(screen.queryByTestId('floor-plan-canvas')).toBeNull();
  });
});
