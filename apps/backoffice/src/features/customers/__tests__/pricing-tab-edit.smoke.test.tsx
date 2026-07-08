// apps/backoffice/src/features/customers/__tests__/pricing-tab-edit.smoke.test.tsx
// S69 Volet A (Task 4) — smoke test for the now-editable PricingTab overrides
// table (add / inline edit / delete), mirroring the mocking style of
// customer-categories-crud.smoke.test.tsx (module-level authStore mock +
// vi.spyOn on the feature hooks) and RetailCreditLimitSection.smoke.test.tsx
// (RTL render + fireEvent assertions).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import { PricingTab } from '@/pages/customers/customer-detail/PricingTab.js';
import * as pricesMod from '../hooks/useCustomerCategoryPrices.js';
import * as productsMod from '@/features/orders/hooks/useProductsForOrderEdit.js';
import type { CategoryPriceOverride } from '../hooks/useCustomerCategoryPrices.js';
import type { OrderEditProduct } from '@/features/orders/hooks/useProductsForOrderEdit.js';
import type { CustomerDetailRow } from '../hooks/useCustomerDetail.js';

// Neither the RPC-calling hooks nor the page's real Supabase client are
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

type PricesQuery = UseQueryResult<CategoryPriceOverride[], Error>;
type ProductsQuery = UseQueryResult<OrderEditProduct[], Error>;

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

const CUSTOMER: CustomerDetailRow = {
  id: 'cust-1',
  name: 'Toko Roti',
  customer_type: 'retail',
  email: null,
  phone: null,
  category_id: 'cat-1',
  category: {
    id: 'cat-1',
    name: 'VIP',
    slug: 'vip',
    price_modifier_type: 'custom',
    discount_percentage: 0,
    points_multiplier: 1,
    loyalty_enabled: true,
  },
  loyalty_points: 0,
  lifetime_points: 0,
  total_spent: 0,
  total_visits: 0,
  last_visit_at: null,
  birth_date: null,
  marketing_consent: false,
  deleted_at: null,
  b2b_company_name: null,
  b2b_tax_id: null,
  b2b_payment_terms_days: null,
  b2b_credit_limit: null,
  b2b_current_balance: 0,
  retail_credit_limit: null,
  created_at: '2026-01-01T00:00:00Z',
};

const OVERRIDE: CategoryPriceOverride = {
  product_id: 'prod-1',
  product_name: 'Croissant',
  product_sku: 'CRO-01',
  retail_price: 25_000,
  custom_price: 20_000,
};

const PRODUCTS: OrderEditProduct[] = [
  { id: 'prod-1', sku: 'CRO-01', name: 'Croissant', retail_price: 25_000, variant_label: null },
  { id: 'prod-2', sku: 'BAG-01', name: 'Bagel', retail_price: 18_000, variant_label: null },
];

describe('PricingTab — editable category overrides', () => {
  let upsertMutate: ReturnType<typeof vi.fn>;
  let deleteMutate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    currentPerms = {
      'customer_categories.update': true,
    };

    vi.spyOn(pricesMod, 'useCustomerCategoryPrices').mockReturnValue(fakeQuery([OVERRIDE]) as PricesQuery);
    vi.spyOn(productsMod, 'useProductsForOrderEdit').mockReturnValue(fakeQuery(PRODUCTS) as ProductsQuery);

    upsertMutate = vi.fn();
    deleteMutate = vi.fn();
    vi.spyOn(pricesMod, 'useUpsertCategoryPrice').mockReturnValue(
      fakeMutation(upsertMutate) as ReturnType<typeof pricesMod.useUpsertCategoryPrice>,
    );
    vi.spyOn(pricesMod, 'useDeleteCategoryPrice').mockReturnValue(
      fakeMutation(deleteMutate) as ReturnType<typeof pricesMod.useDeleteCategoryPrice>,
    );
  });

  it('shows the "applies to every customer" note for a custom category', () => {
    render(wrap(<PricingTab customer={CUSTOMER} />));
    expect(screen.getByText(/appl(y|ies) to every customer in this category/i)).toBeInTheDocument();
  });

  it('deletes an override', () => {
    render(wrap(<PricingTab customer={CUSTOMER} />));
    fireEvent.click(screen.getByRole('button', { name: /remove croissant override/i }));
    expect(deleteMutate).toHaveBeenCalledWith('prod-1', expect.anything());
  });

  it('edits an override price inline', () => {
    render(wrap(<PricingTab customer={CUSTOMER} />));
    const priceInput = screen.getByLabelText(/price for croissant/i);
    fireEvent.change(priceInput, { target: { value: '22000' } });
    fireEvent.click(screen.getByRole('button', { name: /save croissant price/i }));
    expect(upsertMutate).toHaveBeenCalledWith({ productId: 'prod-1', price: 22_000 }, expect.anything());
  });

  it('adds a new override', () => {
    render(wrap(<PricingTab customer={CUSTOMER} />));
    fireEvent.change(screen.getByLabelText(/product to add/i), { target: { value: 'prod-2' } });
    fireEvent.change(screen.getByLabelText(/new price/i), { target: { value: '15000' } });
    fireEvent.click(screen.getByRole('button', { name: /add override/i }));
    expect(upsertMutate).toHaveBeenCalledWith({ productId: 'prod-2', price: 15_000 }, expect.anything());
  });

  it('hides write controls without customer_categories.update', () => {
    currentPerms['customer_categories.update'] = false;
    render(wrap(<PricingTab customer={CUSTOMER} />));
    expect(screen.queryByRole('button', { name: /remove croissant override/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/product to add/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add override/i })).not.toBeInTheDocument();
    // Read-only: the price still renders as plain text.
    expect(screen.getByText('Rp 20,000')).toBeInTheDocument();
  });
});
