// apps/pos/src/features/display/__tests__/CustomerDisplayPage.smoke.test.tsx
//
// Session 13 / Phase 4.C — smoke tests for the customer-display root.
// Mocks `useKioskAuth`, `readKioskPairing`, and the supabase client to
// assert the 3 main render branches :
//   1. authenticated + paired + orders → branded layout + queue ticker.
//   2. unpaired → PairDevicePrompt.
//   3. pin_fallback → PairDevicePrompt with error hint.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────

const useKioskAuthMock = vi.fn();
const readKioskPairingMock = vi.fn();

vi.mock('../hooks/useKioskAuth', () => ({
  useKioskAuth: () => useKioskAuthMock(),
}));

vi.mock('@/lib/kioskAuth', () => ({
  readKioskPairing: () => readKioskPairingMock(),
  writeKioskPairing: vi.fn().mockResolvedValue(undefined),
}));

const fromMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
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
  });

  it('renders branded layout + current card + queue when authenticated', async () => {
    useKioskAuthMock.mockReturnValue({
      status: 'authenticated',
      expiresAt: Date.now() / 1000 + 3600,
      error: null,
      retry: vi.fn(),
    });
    readKioskPairingMock.mockResolvedValue({ kiosk_id: 'screen-front-1' });
    fromMock.mockReturnValue(
      ordersBuilder([
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
      ]),
    );

    const Wrapper = withProviders();
    render(
      <Wrapper>
        <CustomerDisplayPage />
      </Wrapper>,
    );

    // Branded layout header (token-only).
    expect(await screen.findByText('The Breakery')).toBeInTheDocument();
    expect(screen.getByText(/French Bakery/i)).toBeInTheDocument();

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
