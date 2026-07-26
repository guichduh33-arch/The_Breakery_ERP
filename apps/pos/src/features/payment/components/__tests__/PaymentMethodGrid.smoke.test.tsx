import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { PaymentMethod } from '@breakery/domain';

// S64 — PaymentMethodGrid now reads useEnabledPaymentMethods (React Query),
// so every render needs a QueryClientProvider ancestor.
const enabledMock = vi.hoisted(() => ({ current: new Set<PaymentMethod>() }));

vi.mock('@/features/settings/hooks/useEnabledPaymentMethods', () => ({
  useEnabledPaymentMethods: () => enabledMock.current,
}));

import { PaymentMethodGrid } from '../PaymentMethodGrid';
import { useCartStore, type CustomerWithCategory } from '@/stores/cartStore';

const ALL_SIX: PaymentMethod[] = ['cash', 'card', 'qris', 'edc', 'transfer', 'store_credit'];

// ADR-013 Lot 4 (D8) — la tuile store_credit exige un client rattaché.
const FAKE_CUSTOMER = {
  id: 'cust-1',
  name: 'Budi',
  phone: null,
  email: null,
  customer_type: 'retail',
  loyalty_points: 0,
  lifetime_points: 0,
  total_spent: 0,
  total_visits: 0,
  last_visit_at: null,
  store_credit_balance: 50_000,
  category: null,
} as unknown as CustomerWithCategory;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('PaymentMethodGrid', () => {
  beforeEach(() => {
    useCartStore.setState({ attachedCustomer: null });
  });

  it('renders all 6 method tiles with their testids (all enabled, customer attached)', () => {
    enabledMock.current = new Set(ALL_SIX);
    useCartStore.setState({ attachedCustomer: FAKE_CUSTOMER });
    render(<PaymentMethodGrid selectedMethod={null} onSelect={vi.fn()} />, { wrapper });
    for (const value of ALL_SIX) {
      expect(screen.getByTestId(`pay-method-${value}`)).toBeInTheDocument();
    }
  });

  // ADR-013 Lot 4 (D8) — sans client rattaché, store_credit disparaît de la
  // grille (gate serveur P0015 ; même pattern que l'exclusion offline).
  it('hides store_credit when no customer is attached (ADR-013 Lot 4)', () => {
    enabledMock.current = new Set(ALL_SIX);
    render(<PaymentMethodGrid selectedMethod={null} onSelect={vi.fn()} />, { wrapper });
    expect(screen.queryByTestId('pay-method-store_credit')).not.toBeInTheDocument();
    expect(screen.getByTestId('pay-method-cash')).toBeInTheDocument();
    expect(screen.getByTestId('pay-method-transfer')).toBeInTheDocument();
  });

  it('calls onSelect with the tapped method', () => {
    enabledMock.current = new Set(ALL_SIX);
    const onSelect = vi.fn();
    render(<PaymentMethodGrid selectedMethod={null} onSelect={onSelect} />, { wrapper });
    fireEvent.click(screen.getByTestId('pay-method-qris'));
    expect(onSelect).toHaveBeenCalledWith('qris');
  });

  it('renders method labels at text-sm for rush legibility (LOT 7)', () => {
    enabledMock.current = new Set(ALL_SIX);
    render(<PaymentMethodGrid selectedMethod={null} onSelect={vi.fn()} />, { wrapper });
    const cashTile = screen.getByTestId('pay-method-cash');
    const label = cashTile.querySelector('span');
    expect(label?.className).toContain('text-sm');
    expect(label?.className).not.toContain('text-xs');
  });

  // ADR-006 déc. 9 lot A — the BO-configured order (Set insertion order)
  // drives the tile order, not the METHODS constant.
  it('renders tiles in the enabled-set order', () => {
    enabledMock.current = new Set<PaymentMethod>(['qris', 'cash', 'card']);
    render(<PaymentMethodGrid selectedMethod={null} onSelect={vi.fn()} />, { wrapper });
    const tiles = screen.getAllByTestId(/^pay-method-/);
    expect(tiles.map((t) => t.getAttribute('data-testid'))).toEqual([
      'pay-method-qris', 'pay-method-cash', 'pay-method-card',
    ]);
  });

  // S64 (fiche 19 D2.1) — the grid must only render BO-enabled methods.
  it('hides disabled methods and keeps enabled ones (S64)', () => {
    enabledMock.current = new Set<PaymentMethod>(['cash', 'card']);
    render(<PaymentMethodGrid selectedMethod={null} onSelect={vi.fn()} />, { wrapper });
    expect(screen.getByTestId('pay-method-cash')).toBeInTheDocument();
    expect(screen.getByTestId('pay-method-card')).toBeInTheDocument();
    expect(screen.queryByTestId('pay-method-qris')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pay-method-edc')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pay-method-transfer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pay-method-store_credit')).not.toBeInTheDocument();
  });
});
