// apps/pos/src/features/display/__tests__/CustomerDisplayPage.smoke.test.tsx
//
// Session 13 / Phase 4.C — smoke tests for the customer-display root.
// Mocks `useKioskAuth`, `readKioskPairing`, and the supabase client to
// assert the main render branches :
//   1. au repos, interrupteur ÉTEINT (défaut ADR-023 déc. 3) → vitrine, et
//      aucune file de retrait.
//   2. au repos, sélection vide → la marque occupe les deux moitiés.
//   3. interrupteur ALLUMÉ → l'écran d'avant : current card + queue ticker.
//   4. unpaired → PairDevicePrompt.
//   5. pin_fallback → PairDevicePrompt with error hint.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────

const useKioskAuthMock = vi.fn();
const readKioskPairingMock = vi.fn();

vi.mock('../hooks/useKioskAuth', () => ({
  useKioskAuth: () => useKioskAuthMock() as unknown,
}));

vi.mock('@/lib/kioskAuth', () => ({
  readKioskPairing: () => readKioskPairingMock() as unknown,
  writeKioskPairing: vi.fn().mockResolvedValue(undefined),
}));

const fromMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args) as unknown,
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn(),
  },
}));

import CustomerDisplayPage from '../CustomerDisplayPage';

function ordersBuilder(rows: unknown[]) {
  // Mimic Supabase query-builder chain : .select().in().gte().order().limit()
  const limit = vi.fn().mockResolvedValue({ data: rows, error: null });
  const order = vi.fn(() => ({ limit }));
  const gte = vi.fn(() => ({ order }));
  const inFn = vi.fn(() => ({ gte }));
  const select = vi.fn(() => ({ in: inFn }));
  return { select };
}

// Session 59 (16 D1.2) — mimics the `order_items` chain used by
// `useReadyOrders` : .select().eq().eq().order().
function readyOrdersBuilder(rows: unknown[]) {
  const order = vi.fn().mockResolvedValue({ data: rows, error: null });
  const eq2 = vi.fn(() => ({ order }));
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const select = vi.fn(() => ({ eq: eq1 }));
  return { select };
}

// S73 Lot 2 — mimics the `business_config` chain used by
// `useOrgDisplaySettings` : .select().limit().maybeSingle(). The hook is a
// top-level unconditional call in CustomerDisplayPage/CDBrandPanel, so every
// render branch of this test needs a working builder for it.
// ADR-023 — la ligne porte aussi l'interrupteur de la file et la sélection de
// vitrine ; `null` (défaut ci-dessous) vaut interrupteur ÉTEINT, sélection vide.
function businessConfigBuilder(row: Record<string, unknown> | null = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  const limit = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ limit }));
  return { select };
}

// ADR-023 — mimics the `products` chain used by `useShowcaseProducts` :
// .select().in().eq().eq().
function showcaseProductsBuilder(rows: unknown[]) {
  const eq2 = vi.fn().mockResolvedValue({ data: rows, error: null });
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const inFn = vi.fn(() => ({ eq: eq1 }));
  const select = vi.fn(() => ({ in: inFn }));
  return { select };
}

const CROISSANT_ID = '11111111-1111-4111-8111-111111111111';
const ECLAIR_ID = '22222222-2222-4222-8222-222222222222';

function withProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

describe('CustomerDisplayPage — smoke', () => {
  beforeEach(() => {
    useKioskAuthMock.mockReset();
    readKioskPairingMock.mockReset();
    fromMock.mockReset();
    // S73 Lot 2 — useOrgDisplaySettings is called unconditionally on every
    // render branch; default every table to the business_config shape unless
    // a test overrides it for `order_items`/orders.
    fromMock.mockImplementation(() => businessConfigBuilder());
  });

  it('au repos, montre la vitrine et AUCUNE file de retrait (interrupteur éteint)', async () => {
    useKioskAuthMock.mockReturnValue({
      status: 'authenticated',
      expiresAt: Date.now() / 1000 + 3600,
      error: null,
      retry: vi.fn(),
    });
    readKioskPairingMock.mockResolvedValue({ kiosk_id: 'screen-front-1' });
    fromMock.mockImplementation((table: string) => {
      if (table === 'business_config') {
        return businessConfigBuilder({
          display_show_ready_orders: false,
          display_showcase_product_ids: [CROISSANT_ID, ECLAIR_ID],
        });
      }
      if (table === 'products') {
        return showcaseProductsBuilder([
          {
            id: ECLAIR_ID,
            name: 'Éclair au chocolat',
            image_url: null,
            retail_price: 38000,
          },
          {
            id: CROISSANT_ID,
            name: 'Croissant au beurre',
            image_url: null,
            retail_price: 25000,
          },
        ]);
      }
      return businessConfigBuilder();
    });

    const Wrapper = withProviders();
    render(
      <Wrapper>
        <CustomerDisplayPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('cd-showcase-panel')).toBeInTheDocument();
    });

    // L'ordre de la SÉLECTION fait foi, pas celui rendu par la requête.
    const names = screen.getAllByTestId('cd-showcase-name').map((n) => n.textContent);
    expect(names).toEqual(['Croissant au beurre', 'Éclair au chocolat']);

    // Le prix vient du catalogue (ADR-023 déc. 2), jamais d'une saisie.
    expect(screen.getByText(/25[.,\s]000/)).toBeInTheDocument();

    // La file de retrait ne s'affiche pas — ni la carte « now serving », ni le
    // ticker, ni la section « Ready for pickup ».
    expect(screen.queryByTestId('display-current-card')).not.toBeInTheDocument();
    expect(screen.queryByTestId('display-queue-ticker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('display-ready-section')).not.toBeInTheDocument();
  });

  it('au repos, sélection vide → la marque occupe les deux moitiés', async () => {
    useKioskAuthMock.mockReturnValue({
      status: 'authenticated',
      expiresAt: Date.now() / 1000 + 3600,
      error: null,
      retry: vi.fn(),
    });
    readKioskPairingMock.mockResolvedValue({ kiosk_id: 'screen-front-1' });

    const Wrapper = withProviders();
    render(
      <Wrapper>
        <CustomerDisplayPage />
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('display-authenticated')).toBeInTheDocument();
    });
    expect(screen.getByTestId('cd-brand-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('cd-showcase-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('display-queue-ticker')).not.toBeInTheDocument();
  });

  it('interrupteur allumé : current card + queue ticker (comportement d’avant)', async () => {
    useKioskAuthMock.mockReturnValue({
      status: 'authenticated',
      expiresAt: Date.now() / 1000 + 3600,
      error: null,
      retry: vi.fn(),
    });
    readKioskPairingMock.mockResolvedValue({ kiosk_id: 'screen-front-1' });
    fromMock.mockImplementation((table: string) => {
      if (table === 'order_items') {
        return readyOrdersBuilder([
          {
            order_id: 'o-2',
            ready_at: new Date().toISOString(),
            orders: { order_number: '1002', order_type: 'take_out', table_number: null },
          },
        ]);
      }
      if (table === 'business_config') {
        return businessConfigBuilder({ display_show_ready_orders: true });
      }
      return ordersBuilder([
        {
          id: 'o-1',
          order_number: '1001',
          status: 'paid',
          order_type: 'dine_in',
          total: 50000,
          table_number: '4',
          paid_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
      ]);
    });

    const Wrapper = withProviders();
    render(
      <Wrapper>
        <CustomerDisplayPage />
      </Wrapper>,
    );

    // Branded layout header (token-only). The split-brand redesign adds a
    // second "French Bakery & Pastry" occurrence (the brand panel slogan).
    expect(await screen.findByText('The Breakery')).toBeInTheDocument();
    expect(screen.getAllByText(/French Bakery/i).length).toBeGreaterThanOrEqual(1);

    // Wait until the authenticated branch finishes mounting and the
    // current-order card surfaces.
    await waitFor(() => {
      expect(screen.getByTestId('display-authenticated')).toBeInTheDocument();
    });

    // Featured "Now Serving" card with the order number.
    await waitFor(() => {
      expect(screen.getByTestId('display-current-card')).toBeInTheDocument();
    });
    expect(screen.getByText('#1001')).toBeInTheDocument();

    // Session 59 (16 D1.2) — "Ready for pickup" section, fed by
    // order_items.kitchen_status='ready', independent of the paid queue.
    await waitFor(() => {
      expect(screen.getByTestId('display-ready-section')).toBeInTheDocument();
    });
    expect(screen.getByText('#1002')).toBeInTheDocument();
  });

  it('shows PairDevicePrompt when the device is unpaired', async () => {
    useKioskAuthMock.mockReturnValue({
      status: 'pin_fallback',
      expiresAt: null,
      error: 'kiosk_unpaired',
      retry: vi.fn(),
    });
    readKioskPairingMock.mockResolvedValue(null);

    const Wrapper = withProviders();
    render(
      <Wrapper>
        <CustomerDisplayPage />
      </Wrapper>,
    );

    expect(await screen.findByTestId('display-pair-prompt')).toBeInTheDocument();
    expect(screen.getByTestId('display-pair-code-input')).toBeInTheDocument();
  });

  it('shows PairDevicePrompt with error hint on pin_fallback even if paired', async () => {
    useKioskAuthMock.mockReturnValue({
      status: 'pin_fallback',
      expiresAt: null,
      error: 'ip_not_allowed',
      retry: vi.fn(),
    });
    readKioskPairingMock.mockResolvedValue({ kiosk_id: 'screen-x' });

    const Wrapper = withProviders();
    render(
      <Wrapper>
        <CustomerDisplayPage />
      </Wrapper>,
    );

    expect(await screen.findByTestId('display-pair-prompt')).toBeInTheDocument();
    expect(await screen.findByTestId('display-pair-error')).toHaveTextContent(
      /ip_not_allowed/,
    );
  });
});
