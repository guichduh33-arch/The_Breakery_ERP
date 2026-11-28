// apps/backoffice/src/features/products/components/__tests__/purchase-panel.smoke.test.tsx
//
// Product detail "Purchase" tab smoke. Mocks useProductPurchaseItems so the
// component renders without touching @/lib/supabase.
//
// Coverage:
//   1. Empty state when the product has no purchase orders.
//   2. Renders a row per purchase line item + the summary KPIs.
//   3. PO number and supplier are links; the reception filter narrows rows.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ProductPurchaseItem } from '../../hooks/useProductPurchaseItems.js';
import { PurchasePanel } from '../PurchasePanel.js';

const mockUse = vi.fn<(...args: unknown[]) => unknown>();
vi.mock('@/features/products/hooks/useProductPurchaseItems.js', () => ({
  useProductPurchaseItems: (...args: unknown[]) => mockUse(...args),
  PRODUCT_PURCHASE_ITEMS_QUERY_KEY: ['product-purchase-items'],
}));

const ITEMS: ProductPurchaseItem[] = [
  {
    po_id: 'po-2', po_number: 'PO-0002', order_date: '2026-06-10', status: 'received',
    received_date: '2026-06-11', supplier_id: 'sup-1', supplier_name: 'Flour Co', quantity: 50, received_quantity: 50,
    unit: 'kg', unit_cost: 12000, subtotal: 600000,
  },
  {
    po_id: 'po-1', po_number: 'PO-0001', order_date: '2026-05-01', status: 'partial',
    received_date: null, supplier_id: 'sup-1', supplier_name: 'Flour Co', quantity: 20, received_quantity: 10,
    unit: 'kg', unit_cost: 11000, subtotal: 220000,
  },
];

function renderPanel(): void {
  render(<MemoryRouter><PurchasePanel productId="prod-1" /></MemoryRouter>);
}

describe('PurchasePanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the empty state when there is no purchase history', () => {
    mockUse.mockReturnValue({ data: [], isLoading: false, error: null });
    renderPanel();
    expect(screen.getByText(/no purchase history yet/i)).toBeInTheDocument();
  });

  it('renders a row per line item and the summary KPIs', () => {
    mockUse.mockReturnValue({ data: ITEMS, isLoading: false, error: null });
    renderPanel();
    expect(screen.getByRole('link', { name: 'PO-0002' })).toHaveAttribute('href', '/backoffice/purchasing/purchase-orders/po-2');
    expect(screen.getByRole('link', { name: 'PO-0001' })).toBeInTheDocument();
    // Two supplier links, one per line.
    expect(screen.getAllByRole('link', { name: 'Flour Co' })).toHaveLength(2);
    expect(screen.getByText('Purchases')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-purchases-count')).toHaveTextContent('2');
  });

  it('filters lines by reception status', () => {
    mockUse.mockReturnValue({ data: ITEMS, isLoading: false, error: null });
    renderPanel();
    fireEvent.change(screen.getByLabelText('Reception filter'), { target: { value: 'partial' } });
    expect(screen.queryByRole('link', { name: 'PO-0002' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PO-0001' })).toBeInTheDocument();
  });
});
