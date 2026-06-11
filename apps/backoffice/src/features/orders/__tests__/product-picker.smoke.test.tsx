// apps/backoffice/src/features/orders/__tests__/product-picker.smoke.test.tsx
// Session 39 / Wave C1 — ProductPicker + EditOrderItemsModal integration smoke.
//
// T1: mock 3 products where one is referenced as parent by another →
//     search "croiss" filters; parent absent from list.
// T2: click a row in the modal → diff.adds gets {product_id, qty: 1};
//     preview shows real name + price.
// T3: pick the same product twice → single add with qty 2.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// ── Data fixtures ─────────────────────────────────────────────────────────────
// prod-parent: has a variant referencing it as parent_product_id → excluded.
// prod-variant: variant of prod-parent → listed (it sells directly).
// prod-standalone: no parent → listed.
const PRODUCTS_RAW = [
  { id: 'prod-parent',     sku: 'SKU-P', name: 'Croissant',        retail_price: 25_000, variant_label: null,     parent_product_id: null },
  { id: 'prod-variant',    sku: 'SKU-V', name: 'Croissant Butter',  retail_price: 27_000, variant_label: 'Butter', parent_product_id: 'prod-parent' },
  { id: 'prod-standalone', sku: 'SKU-S', name: 'Pain au Chocolat',  retail_price: 30_000, variant_label: null,     parent_product_id: null },
];

// ── supabase mock (from().select chain) ───────────────────────────────────────
const rpcMock = vi.fn();

vi.mock('@/lib/supabase.js', () => {
  function buildChain(result: { data: unknown; error: null }) {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq:     () => chain,
      order:  () => chain,
      then:   (resolve: (v: unknown) => unknown) => resolve(result),
    };
    return chain;
  }
  return {
    supabase: {
      from: () => buildChain({ data: PRODUCTS_RAW, error: null }),
      rpc:  (...a: unknown[]) => rpcMock(...a),
    },
  };
});

// ── imports after mocks ────────────────────────────────────────────────────────
import { EditOrderItemsModal } from '../components/EditOrderItemsModal.js';
import type { OrderItemEdit } from '../types.js';

// ── helpers ───────────────────────────────────────────────────────────────────
const NO_ITEMS: OrderItemEdit[] = [];

function Providers({ children, qc }: { children: ReactNode; qc: QueryClient }) {
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe('ProductPicker smoke [S39-W-C1]', () => {
  let qc: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null });
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('T1: parent excluded; search "croiss" shows variant but not parent', async () => {
    render(
      <Providers qc={qc}>
        <EditOrderItemsModal
          open
          onClose={vi.fn()}
          orderId="ord-1"
          orderNumber="ORD-0001"
          currentItems={NO_ITEMS}
        />
      </Providers>,
    );

    // Wait for products to load
    await waitFor(() => {
      expect(screen.queryByText(/loading products/i)).not.toBeInTheDocument();
    });

    // All non-parent products should be listed initially
    expect(screen.getByTestId('picker-row-prod-variant')).toBeInTheDocument();
    expect(screen.getByTestId('picker-row-prod-standalone')).toBeInTheDocument();
    // Parent must be excluded
    expect(screen.queryByTestId('picker-row-prod-parent')).not.toBeInTheDocument();

    // Type "croiss" in the search input
    fireEvent.change(screen.getByTestId('picker-search'), { target: { value: 'croiss' } });

    // After filter: variant matches "Croissant Butter", standalone does not
    expect(screen.getByTestId('picker-row-prod-variant')).toBeInTheDocument();
    expect(screen.queryByTestId('picker-row-prod-standalone')).not.toBeInTheDocument();
    expect(screen.queryByTestId('picker-row-prod-parent')).not.toBeInTheDocument();
  });

  it('T2: clicking a row adds it to diff and shows name + price in preview', async () => {
    render(
      <Providers qc={qc}>
        <EditOrderItemsModal
          open
          onClose={vi.fn()}
          orderId="ord-1"
          orderNumber="ORD-0001"
          currentItems={NO_ITEMS}
        />
      </Providers>,
    );

    // Wait for products
    await waitFor(() => {
      expect(screen.queryByText(/loading products/i)).not.toBeInTheDocument();
    });

    // Pick "Pain au Chocolat"
    fireEvent.click(screen.getByTestId('picker-row-prod-standalone'));

    // Preview should now show the product name and (new) badge
    await waitFor(() => {
      // The cart preview pane contains a row with the name
      const cartPreview = screen.getByTestId('cart-preview');
      expect(cartPreview).toHaveTextContent('Pain au Chocolat');
    });
    expect(screen.getByText('(new)')).toBeInTheDocument();

    // Apply button should be enabled (1 pending change)
    expect(screen.getByTestId('apply-changes')).not.toBeDisabled();
  });

  it('T3: picking the same product twice produces a single add with qty 2', async () => {
    render(
      <Providers qc={qc}>
        <EditOrderItemsModal
          open
          onClose={vi.fn()}
          orderId="ord-1"
          orderNumber="ORD-0001"
          currentItems={NO_ITEMS}
        />
      </Providers>,
    );

    // Wait for products
    await waitFor(() => {
      expect(screen.queryByText(/loading products/i)).not.toBeInTheDocument();
    });

    // Pick "Pain au Chocolat" twice
    fireEvent.click(screen.getByTestId('picker-row-prod-standalone'));
    fireEvent.click(screen.getByTestId('picker-row-prod-standalone'));

    // The qty input for the single pending row should show 2
    await waitFor(() => {
      const qtyInput = screen.getByTestId('qty-__pending-0') as HTMLInputElement;
      expect(qtyInput.value).toBe('2');
    });

    // Only one "(new)" badge — not two
    const newBadges = screen.getAllByText('(new)');
    expect(newBadges).toHaveLength(1);
  });
});
