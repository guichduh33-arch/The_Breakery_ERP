import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auth, pair, rpc, from } = vi.hoisted(() => ({
  auth: vi.fn(), pair: vi.fn(), rpc: vi.fn(), from: vi.fn(),
}));
vi.mock('../hooks/useKioskAuth', () => ({ useKioskAuth: auth }));
vi.mock('@/lib/kioskAuth', () => ({ readKioskPairing: pair, pairKiosk: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc, from } }));
import CustomerDisplayPage from '../CustomerDisplayPage';

const empty = { footer: 'Welcome', slogan: '', show_ready_orders: false, products: [], orders: [], ready_orders: [] };
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><CustomerDisplayPage /></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  auth.mockReturnValue({ status: 'authenticated', expiresAt: 9999999999, error: null, retry: vi.fn() });
  pair.mockResolvedValue({ kiosk_id: 'device' });
  rpc.mockResolvedValue({ data: empty, error: null });
});
describe('écran client — projection limitée', () => {
  it('montre la vitrine dans l’ordre serveur sans lire les tables', async () => {
    rpc.mockResolvedValue({ data: { ...empty, products: [
      { id: 'a', name: 'Croissant', image_url: null, retail_price: 25000 },
      { id: 'b', name: 'Éclair', image_url: null, retail_price: 38000 },
    ] }, error: null });
    renderPage();
    expect(await screen.findByTestId('cd-showcase-panel')).toBeInTheDocument();
    expect(screen.getAllByTestId('cd-showcase-name').map((node) => node.textContent)).toEqual(['Croissant', 'Éclair']);
    expect(screen.queryByTestId('display-queue-ticker')).not.toBeInTheDocument();
    expect(from).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('get_kiosk_display_v1');
  });
  it('garde la marque seule si la sélection est vide', async () => {
    renderPage();
    expect(await screen.findByTestId('display-authenticated')).toBeInTheDocument();
    expect(screen.queryByTestId('cd-showcase-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('display-queue-ticker')).not.toBeInTheDocument();
    expect(from).not.toHaveBeenCalled();
  });
  it('montre les numéros de retrait quand le réglage serveur l’autorise', async () => {
    rpc.mockResolvedValue({ data: { ...empty, show_ready_orders: true,
      orders: [{ id: 'order', order_number: 'P16082026001', status: 'paid', order_type: 'dine_in', table_number: '4', paid_at: new Date().toISOString() }],
      ready_orders: [{ order_id: 'ready', order_number: 'T116082026002', order_type: 'take_out', table_number: null, ready_at: new Date().toISOString() }],
    }, error: null });
    renderPage();
    expect(await screen.findByText('P-001')).toBeInTheDocument();
    expect(screen.getByText('T1-002')).toBeInTheDocument();
    expect(from).not.toHaveBeenCalled();
  });
  it('demande un appairage sans appeler la RPC si l’écran est inconnu', async () => {
    pair.mockResolvedValue(null);
    auth.mockReturnValue({ status: 'pin_fallback', error: 'kiosk_unpaired', retry: vi.fn() });
    renderPage();
    expect(await screen.findByTestId('display-pair-prompt')).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
  it('cache tout affichage protégé quand le serveur refuse l’accès', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'kiosk_unauthorized' } });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('display-pair-error')).toHaveTextContent('access is unavailable'));
    expect(screen.queryByTestId('display-authenticated')).not.toBeInTheDocument();
    expect(from).not.toHaveBeenCalled();
  });
});
