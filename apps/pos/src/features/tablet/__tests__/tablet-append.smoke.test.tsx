// apps/pos/src/features/tablet/__tests__/tablet-append.smoke.test.tsx
//
// Ajout d'une tournée à une commande de salle déjà envoyée (décision
// propriétaire 2026-08-01). Le geste se prend PAR LA TABLE, sur le plan de
// salle : une table servie devient touchable quand sa commande est née en
// salle et n'est pas payée.
//
// Ce que ces tests protègent :
//   - le `p_order_id` part bien vers le serveur (sans lui, on crée un doublon
//     et la table reçoit deux additions) ;
//   - le garde « table obligatoire » ne s'applique PAS en ajout — la table
//     vient de la commande visée ;
//   - hors ligne, l'ajout est refusé AVANT toute mise en file (ADR-018 D7).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// `useCreateTabletOrder` chains `.abortSignal(...)` on the `rpc()` builder
// (Critique 2026-08-24 P0, 15s timeout) — the mock must expose it.
function rpcResult(data: unknown, error: unknown = null) {
  return { abortSignal: () => Promise.resolve({ data, error }) };
}
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

const isOfflineModeMock = vi.hoisted(() => vi.fn(() => false));
vi.mock('@/features/lan/offlineMode', () => ({
  isOfflineMode: isOfflineModeMock,
  useOfflineMode: () => isOfflineModeMock(),
}));

const enqueueIntentMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('@/features/lan/offlineOutbox', () => ({
  enqueueIntent: enqueueIntentMock,
  nextIntentSeq: () => 1,
}));
const publishMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/lan/hubBusClient', () => ({ hubBus: { publish: publishMock } }));
vi.mock('@/features/lan/localOrderNumber', () => ({ nextLocalOrderNumber: () => 'L-1' }));
vi.mock('@/features/cart/hooks/useStationMap', () => ({ getStationMap: () => Promise.resolve({}) }));

// Table 7 servie, sa commande de salle est complétable.
const tableOrdersMock = vi.hoisted(() => ({
  data: { '7': { id: 'order-open-1', order_number: '#0042', appendable: true } },
}));
vi.mock('@/features/tables/hooks/useTableOrders', () => ({
  useTableOrders: () => ({ data: tableOrdersMock.data }),
}));

vi.mock('./../components/TabletMenuView', () => ({
  TabletMenuView: ({ toolbar }: { toolbar?: ReactNode }) => <div>{toolbar}</div>,
}));

import { TabletOrderPage } from '../TabletOrderPage';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { useAuthStore } from '@/stores/authStore';

const TABLES = [
  { id: 't7', name: '7', seats: 4, sort_order: 1, is_active: true, section_id: null, grid_x: null, grid_y: null },
  { id: 't8', name: '8', seats: 2, sort_order: 2, is_active: true, section_id: null, grid_x: null, grid_y: null },
];

function wrap(node: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );
}

function renderPage() {
  return render(
    wrap(
      <TabletOrderPage
        tablesOverride={TABLES as never}
        occupancyOverride={{ '7': true }}
      />,
    ),
  );
}

/** Entre en mode ajout comme le ferait Made : plan de salle → table servie.
 *  Critique 2026-08-24 (P1) — panier vide et sans table, la vue INITIALE est
 *  déjà le plan de salle : pas besoin (et pas moyen) de taper le chip table. */
function enterAppendMode(): void {
  fireEvent.click(screen.getByRole('button', { name: /Table 7/i }));
}

beforeEach(() => {
  mocks.rpc.mockReset().mockReturnValue(rpcResult('order-cloud-1'));
  enqueueIntentMock.mockClear();
  publishMock.mockClear();
  isOfflineModeMock.mockReturnValue(false);
  tableOrdersMock.data = { '7': { id: 'order-open-1', order_number: '#0042', appendable: true } };
  useTabletCartStore.setState({
    items: [],
    tableNumber: null,
    orderType: 'dine_in',
    notes: null,
    appendToOrderId: null,
    appendToOrderNumber: null,
  });
  useAuthStore.setState({
    user: { id: 'waiter-001', full_name: 'Made', role_code: 'waiter', employee_code: 'EMP1' },
    permissions: ['sales.create'],
    isAuthenticated: true,
    sessionToken: 'tok',
    isLoading: false,
    error: null,
  });
});

describe('ajout à une commande de salle existante', () => {
  it('une table servie ouvre le mode ajout et l’annonce sans ambiguïté', () => {
    renderPage();
    enterAppendMode();

    const banner = screen.getByTestId('tablet-append-banner');
    expect(banner).toHaveTextContent('#0042');
    expect(banner).toHaveTextContent('Table 7');
    expect(useTabletCartStore.getState().appendToOrderId).toBe('order-open-1');
  });

  it('transmet p_order_id — sans lui la table recevrait deux additions', async () => {
    renderPage();
    enterAppendMode();
    // Le rendu doit avoir integre les lignes AVANT le clic, sinon le bouton
    // est encore desactive et le clic ne declenche rien.
    act(() => {
      useTabletCartStore.setState({
        items: [{ id: 'l1', product_id: 'p1', name: 'Tiramisu', unit_price: 40000, quantity: 1, modifiers: [] }],
      });
    });

    fireEvent.click(screen.getByTestId('tablet-order-send'));

    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith(
        'create_tablet_order_v8',
        expect.objectContaining({ p_order_id: 'order-open-1' }),
      );
    });
  });

  it('sort du mode ajout après l’envoi (la tournée suivante est neuve)', async () => {
    renderPage();
    enterAppendMode();
    // Le rendu doit avoir integre les lignes AVANT le clic, sinon le bouton
    // est encore desactive et le clic ne declenche rien.
    act(() => {
      useTabletCartStore.setState({
        items: [{ id: 'l1', product_id: 'p1', name: 'Tiramisu', unit_price: 40000, quantity: 1, modifiers: [] }],
      });
    });

    fireEvent.click(screen.getByTestId('tablet-order-send'));

    await waitFor(() => {
      expect(useTabletCartStore.getState().appendToOrderId).toBeNull();
    });
  });

  it('une table dont la commande vient du comptoir reste inerte', () => {
    tableOrdersMock.data = { '7': { id: 'order-pos-1', order_number: '#0050', appendable: false } };
    renderPage();
    // Vue initiale = plan de salle (panier vide, pas de table).
    fireEvent.click(screen.getByRole('button', { name: /Table 7/i }));

    expect(screen.queryByTestId('tablet-append-banner')).not.toBeInTheDocument();
    expect(useTabletCartStore.getState().appendToOrderId).toBeNull();
  });

  it('hors ligne, l’ajout est refusé AVANT toute mise en file (ADR-018 D7)', async () => {
    isOfflineModeMock.mockReturnValue(true);
    renderPage();
    enterAppendMode();
    // Le rendu doit avoir integre les lignes AVANT le clic, sinon le bouton
    // est encore desactive et le clic ne declenche rien.
    act(() => {
      useTabletCartStore.setState({
        items: [{ id: 'l1', product_id: 'p1', name: 'Tiramisu', unit_price: 40000, quantity: 1, modifiers: [] }],
      });
    });

    fireEvent.click(screen.getByTestId('tablet-order-send'));

    const { toast } = await import('sonner');
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/unavailable offline/i));
    });
    // Le point critique : rien en file, donc aucun drain à bloquer au retour.
    expect(enqueueIntentMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
