// apps/pos/src/__tests__/customer-pricing.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
//
// Smoke tests for customer category pricing.
// Spec §4.4 CC7–CC9.
//   - VIP customer (5% discount) → tap product (retail 35000) → cart line at 33250
//   - Detach customer → toast "Pricing not auto-recomputed"
//
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCartStore } from '@/stores/cartStore';
import { useCustomerProductPrice } from '@/features/customerCategories/hooks/useCustomerProductPrice';
import type { CustomerWithCategory } from '@/stores/cartStore';
import type { CustomerCategory } from '@breakery/domain';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
    rpc: mockRpc,
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          is: vi.fn(() => ({
            limit: vi.fn(() => ({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            })),
          })),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    })),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
    removeChannel: vi.fn(),
  },
  supabaseUrl: 'http://localhost:54321',
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VIP_CATEGORY: CustomerCategory = {
  id: 'cat-vip',
  name: 'VIP',
  slug: 'vip',
  color: '#F59E0B',
  icon: null,
  price_modifier_type: 'discount_percentage',
  discount_percentage: 5,
  loyalty_enabled: true,
  points_multiplier: 1.2,
  is_default: false,
};

const VIP_CUSTOMER: CustomerWithCategory = {
  id: 'cust-vip-001',
  name: 'Loyal Gold Customer',
  phone: '+62811111111',
  email: null,
  customer_type: 'retail',
  loyalty_points: 500,
  lifetime_points: 2000,
  total_spent: 0,
  total_visits: 0,
  last_visit_at: null,
  category: VIP_CATEGORY,
};

const AMERICANO_PRODUCT = {
  id: 'prod-amer',
  sku: 'BEV-AMER',
  name: 'Americano',
  category_id: 'cat-bev',
  retail_price: 35000,
  wholesale_price: null,
  product_type: 'finished' as const,
  tax_inclusive: true,
  image_url: null,
  current_stock: 10,
  is_active: true,
  is_favorite: true,
};

function wrapper(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Customer pricing smoke — RPC get_customer_product_price', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCartStore.setState({ cart: { items: [], order_type: 'dine_in' }, lockedItemIds: [], attachedCustomer: null });
  });

  it('calls RPC with correct args and returns discounted price (33250)', async () => {
    const discountedPrice = 33250; // 35000 * 0.95 = 33250
    mockRpc.mockResolvedValue({ data: discountedPrice, error: null });

    const { result } = renderHook(() => useCustomerProductPrice(), { wrapper: ({ children }) => wrapper(children) });
    const price = await result.current(AMERICANO_PRODUCT.id, VIP_CUSTOMER.id);

    expect(mockRpc).toHaveBeenCalledWith('get_customer_product_price', {
      p_product_id: AMERICANO_PRODUCT.id,
      p_customer_id: VIP_CUSTOMER.id,
    });
    expect(price).toBe(33250);
  });

  it('returns retail price when customer id is null', async () => {
    mockRpc.mockResolvedValue({ data: 35000, error: null });

    const { result } = renderHook(() => useCustomerProductPrice(), { wrapper: ({ children }) => wrapper(children) });
    const price = await result.current(AMERICANO_PRODUCT.id, null);

    // The hook omits p_customer_id when null (exactOptionalPropertyTypes-safe;
    // generated Args type is `{ p_customer_id?: string }` so passing `null`
    // would be rejected). RPC defaults p_customer_id → NULL server-side.
    expect(mockRpc).toHaveBeenCalledWith('get_customer_product_price', {
      p_product_id: AMERICANO_PRODUCT.id,
    });
    expect(price).toBe(35000);
  });

  it('cartStore.add with unit_price override stores discounted price in cart line', () => {
    const discountedPrice = 33250;

    act(() => {
      useCartStore.getState().add(AMERICANO_PRODUCT, [], discountedPrice);
    });

    const items = useCartStore.getState().cart.items;
    expect(items).toHaveLength(1);
    expect(items[0]?.unit_price).toBe(33250);
    expect(items[0]?.name).toBe('Americano');
  });

  it('cartStore.add without override uses retail_price', () => {
    act(() => {
      useCartStore.getState().add(AMERICANO_PRODUCT, []);
    });

    const items = useCartStore.getState().cart.items;
    expect(items[0]?.unit_price).toBe(35000);
  });

  // S44 P0-C(2) — multiplier resolved server-side (v12); the client payload omits it.
  it('VIP customer: buildOrderPayload omits loyalty_multiplier (S44)', async () => {
    const { buildOrderPayload } = await import('@breakery/domain');
    const cart = {
      order_type: 'dine_in' as const,
      items: [{ id: 'l1', product_id: 'prod-amer', name: 'Americano', unit_price: 33250, quantity: 1, modifiers: [] as never[] }],
      customerId: VIP_CUSTOMER.id,
    };
    const payload = buildOrderPayload('sess-1', cart, { method: 'cash', amount: 33250 });
    expect('loyalty_multiplier' in payload).toBe(false);
  });
});
