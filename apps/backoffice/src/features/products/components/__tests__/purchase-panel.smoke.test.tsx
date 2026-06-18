// apps/backoffice/src/features/products/components/__tests__/purchase-panel.smoke.test.tsx
//
// Product detail "Purchase" tab smoke. Mocks useProductPurchaseItems so the
// component renders without touching @/lib/supabase.
//
// Coverage:
//   1. Empty state when the product has no purchase orders.
//   2. Renders a row per purchase line item + the summary KPIs.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ProductPurchaseItem } from '../../hooks/useProductPurchaseItems.js';
import { PurchasePanel } from '../PurchasePanel.js';

const mockUse = vi.fn();
vi.mock('@/features/products/hooks/useProductPurchaseItems.js', () => ({
  useProductPurchaseItems: (...args: unknown[]) => mockUse(...args),
  PRODUCT_PURCHASE_ITEMS_QUERY_KEY: ['product-purchase-items'],
}));

const ITEMS: ProductPurchaseItem[] = [
  {
    po_id: 'po-2', po_number: 'PO-0002', order_date: '2026-06-10', status: 'received',
    received_date: '2026-06-11', supplier_name: 'Flour Co', quantity: 50, received_quantity: 50,
    unit: 'kg', unit_cost: 12000, subtotal: 600000,
  },
  {
    po_id: 'po-1', po_number: 'PO-0001', order_date: '2026-05-01', status: 'partial',
    received_date: null, supplier_name: 'Flour Co', quantity: 20, received_quantity: 10,
    unit: 'kg', unit_cost: 11000, subtotal: 220000,
  },
];

describe('PurchasePanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the empty state when there is no purchase history', () => {
    mockUse.mockReturnValue({ data: [], isLoading: false, error: null });
    render(<PurchasePanel productId="prod-1" />);
    expect(screen.getByText(/no purchase history yet/i)).toBeInTheDocument();
  });

  it('renders a row per line item and the summary KPIs', () => {
    mockUse.mockReturnValue({ data: ITEMS, isLoading: false, error: null });
    render(<PurchasePanel productId="prod-1" />);
    expect(screen.getByText('PO-0002')).toBeInTheDocument();
    expect(screen.getByText('PO-0001')).toBeInTheDocument();
    // Two suppliers cells + summary count KPI.
    expect(screen.getAllByText('Flour Co')).toHaveLength(2);
    expect(screen.getByText('Purchases')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
