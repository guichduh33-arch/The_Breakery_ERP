// apps/pos/src/features/tablet/__tests__/tablet-offline-confirmation.smoke.test.tsx
//
// Critique 2026-08-25 (P1) — un envoi HORS-LIGNE ne laissait qu'un toast de 4 s.
// La preuve d'envoi disparaissait au moment où la serveuse doute le plus que la
// commande soit partie, l'invitant à ré-envoyer un doublon à la table.
//
// Ce que ce test protège :
//   - après un envoi offline, une bande de confirmation PERSISTANTE s'affiche
//     (numéro local + table), là où avant il n'y avait qu'un toast éphémère ;
//   - le toast immédiat reste (feedback instantané) ;
//   - la serveuse peut la fermer (Dismiss).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// `useCreateTabletOrder` chains `.abortSignal(...)` on the `rpc()` builder — the
// mock must expose it even though the offline path never reaches the RPC.
function rpcResult(data: unknown, error: unknown = null) {
  return { abortSignal: () => Promise.resolve({ data, error }) };
}
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
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

// Coupure cloud : l'envoi part par le bus LAN, la caisse reste joignable.
vi.mock('@/features/lan/offlineMode', () => ({
  isOfflineMode: () => true,
  useOfflineMode: () => true,
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

// En coupure, le bus LAN est up : l'envoi tablette est autorisé (offline_bus).
vi.mock('../hooks/useTabletConnectionState', () => ({
  useTabletConnectionState: () => ({ state: 'offline_bus', canSendOrders: true }),
}));

// Pas de commande de salle complétable — on reste en commande neuve.
vi.mock('@/features/tables/hooks/useTableOrders', () => ({
  useTableOrders: () => ({ data: {} }),
}));

vi.mock('../components/TabletMenuView', () => ({
  TabletMenuView: ({ toolbar }: { toolbar?: ReactNode }) => <div>{toolbar}</div>,
}));

import { TabletOrderPage } from '../TabletOrderPage';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { useAuthStore } from '@/stores/authStore';

const TABLES = [
  { id: 't7', name: '7', seats: 4, sort_order: 1, is_active: true, section_id: null, grid_x: null, grid_y: null },
];

function wrap(node: ReactNode): ReactNode {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/tablet/order']}>{node}</MemoryRouter>
    </QueryClientProvider>
  );
}

function renderPage() {
  return render(wrap(<TabletOrderPage tablesOverride={TABLES as never} occupancyOverride={{}} />));
}

describe('confirmation d’envoi hors-ligne (persistante)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockReturnValue(rpcResult('unused-offline'));
    // Panier prêt : table + un article, donc la vue initiale est le menu.
    useTabletCartStore.setState({
      items: [{ id: 'l1', product_id: 'p1', name: 'Tiramisu', unit_price: 40000, quantity: 1, modifiers: [] }],
      tableNumber: '7',
      orderType: 'dine_in',
      notes: null,
      appendToOrderId: null,
      appendToOrderNumber: null,
    });
    useAuthStore.setState({
      user: { id: 'waiter-001', full_name: 'Made', role_code: 'waiter', employee_code: 'EMP002' },
      permissions: ['sales.create'],
      isAuthenticated: true,
      sessionToken: 'tok',
      isLoading: false,
      error: null,
    });
  });

  it('affiche une bande de confirmation persistante après un envoi offline', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('tablet-order-send'));

    // L'envoi est bien parti par le bus LAN.
    await waitFor(() => {
      expect(enqueueIntentMock).toHaveBeenCalledTimes(1);
      expect(publishMock).toHaveBeenCalledTimes(1);
    });

    // Preuve PERSISTANTE (pas seulement un toast) : la bande porte le numéro
    // local et la table.
    const banner = await screen.findByTestId('tablet-offline-confirmation');
    expect(banner).toHaveTextContent('L-1');
    expect(banner).toHaveTextContent('Table 7');

    // Le toast immédiat reste (feedback instantané).
    const { toast } = await import('sonner');
    expect(toast.success).toHaveBeenCalledWith('Order L-1 sent to kitchen (offline)');

    // Le panier a bien été vidé — mais la bande, elle, reste affichée.
    expect(useTabletCartStore.getState().items).toHaveLength(0);
    expect(screen.getByTestId('tablet-offline-confirmation')).toBeInTheDocument();
  });

  it('la serveuse peut fermer la bande (Dismiss)', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('tablet-order-send'));

    await screen.findByTestId('tablet-offline-confirmation');
    fireEvent.click(screen.getByTestId('tablet-offline-confirmation-dismiss'));

    await waitFor(() => {
      expect(screen.queryByTestId('tablet-offline-confirmation')).not.toBeInTheDocument();
    });
  });
});
