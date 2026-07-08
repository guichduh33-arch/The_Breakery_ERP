// apps/backoffice/src/features/customers/__tests__/negotiated-prices.smoke.test.tsx
// S69 Volet B (Task 8) — smoke test for NegotiatedPricesSection (add / edit /
// delete wire to the right mutations; write controls hide without
// customer_prices.manage). Mirrors the mocking style of
// pricing-tab-edit.smoke.test.tsx (Task 4, same session).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import { NegotiatedPricesSection } from '../components/NegotiatedPricesSection.js';
import * as pricesMod from '../hooks/useCustomerNegotiatedPrices.js';
import * as productsMod from '@/features/orders/hooks/useProductsForOrderEdit.js';
import type { NegotiatedPrice } from '../hooks/useCustomerNegotiatedPrices.js';
import type { OrderEditProduct } from '@/features/orders/hooks/useProductsForOrderEdit.js';

// Neither the RPC-calling hooks nor the section's real Supabase client are
// exercised (all mutation/query hooks are mocked below) — mocking
// '@/lib/supabase.js' just short-circuits the module's env-var validation
// (parseAppEnv) which otherwise throws under vitest with no VITE_* env set.
vi.mock('@/lib/supabase.js', () => ({ supabase: {} }));

let currentPerms: Record<string, boolean> = {};
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms[p] ?? false }),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

function fakeQuery<T>(data: T, overrides: Partial<UseQueryResult<T, Error>> = {}): UseQueryResult<T, Error> {
  return { data, isLoading: false, error: null, ...overrides } as unknown as UseQueryResult<T, Error>;
}

function fakeMutation(mutate: ReturnType<typeof vi.fn>): unknown {
  return {
    mutate,
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    data: undefined,
    reset: vi.fn(),
  };
}

const NEGOTIATED: NegotiatedPrice = {
  product_id: 'prod-1',
  product_name: 'Croissant',
  product_sku: 'CRO-01',
  retail_price: 25_000,
  negotiated_price: 20_000,
};

const PRODUCTS: OrderEditProduct[] = [
  { id: 'prod-1', sku: 'CRO-01', name: 'Croissant', retail_price: 25_000, variant_label: null },
  { id: 'prod-2', sku: 'BAG-01', name: 'Bagel', retail_price: 18_000, variant_label: null },
];

describe('NegotiatedPricesSection', () => {
  let upsertMutate: ReturnType<typeof vi.fn>;
  let deleteMutate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    currentPerms = {
      'customer_prices.manage': true,
    };

    vi.spyOn(pricesMod, 'useCustomerNegotiatedPrices').mockReturnValue(fakeQuery([NEGOTIATED]));
    vi.spyOn(productsMod, 'useProductsForOrderEdit').mockReturnValue(fakeQuery(PRODUCTS));

    upsertMutate = vi.fn();
    deleteMutate = vi.fn();
    vi.spyOn(pricesMod, 'useUpsertNegotiatedPrice').mockReturnValue(
      fakeMutation(upsertMutate) as ReturnType<typeof pricesMod.useUpsertNegotiatedPrice>,
    );
    vi.spyOn(pricesMod, 'useDeleteNegotiatedPrice').mockReturnValue(
      fakeMutation(deleteMutate) as ReturnType<typeof pricesMod.useDeleteNegotiatedPrice>,
    );
  });

  it('shows the "applied automatically" note', () => {
    render(wrap(<NegotiatedPricesSection customerId="cust-1" />));
    expect(screen.getByText(/applied automatically to this customer's b2b orders/i)).toBeInTheDocument();
  });

  it('deletes a negotiated price', () => {
    render(wrap(<NegotiatedPricesSection customerId="cust-1" />));
    fireEvent.click(screen.getByRole('button', { name: /remove croissant negotiated price/i }));
    expect(deleteMutate).toHaveBeenCalledWith('prod-1', expect.anything());
  });

  it('edits a negotiated price inline', () => {
    render(wrap(<NegotiatedPricesSection customerId="cust-1" />));
    const priceInput = screen.getByLabelText(/price for croissant/i);
    fireEvent.change(priceInput, { target: { value: '22000' } });
    fireEvent.click(screen.getByRole('button', { name: /save croissant price/i }));
    expect(upsertMutate).toHaveBeenCalledWith({ productId: 'prod-1', price: 22_000 }, expect.anything());
  });

  it('adds a new negotiated price', () => {
    render(wrap(<NegotiatedPricesSection customerId="cust-1" />));
    fireEvent.change(screen.getByLabelText(/product to add/i), { target: { value: 'prod-2' } });
    fireEvent.change(screen.getByLabelText(/new price/i), { target: { value: '15000' } });
    fireEvent.click(screen.getByRole('button', { name: /add negotiated price/i }));
    expect(upsertMutate).toHaveBeenCalledWith({ productId: 'prod-2', price: 15_000 }, expect.anything());
  });

  it('hides write controls without customer_prices.manage', () => {
    currentPerms['customer_prices.manage'] = false;
    render(wrap(<NegotiatedPricesSection customerId="cust-1" />));
    expect(screen.queryByRole('button', { name: /remove croissant negotiated price/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/product to add/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add negotiated price/i })).not.toBeInTheDocument();
    // Read-only: the price still renders as plain text.
    expect(screen.getByText('Rp 20,000')).toBeInTheDocument();
  });
});
