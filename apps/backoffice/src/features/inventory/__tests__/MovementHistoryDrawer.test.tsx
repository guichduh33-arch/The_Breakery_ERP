import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MovementHistoryDrawer } from '../components/MovementHistoryDrawer.js';
import type { StockLevelRow } from '../hooks/useStockLevels.js';

const mocks = vi.hoisted(() => ({ error: false, refetch: vi.fn() }));
vi.mock('../hooks/useStockMovements.js', () => ({
  PAGE_SIZE: 1,
  useStockMovements: (_id: string, page: number) => ({
    data: page === 0 ? [{
      id: 'mv', product_id: 'product', movement_type: 'incoming', quantity: 1.375, unit: 'kg',
      reason: 'Receipt', unit_cost: null, supplier_id: null, reference_type: 'admin_action',
      reference_id: null, idempotency_key: null, created_at: '2026-09-13T01:00:00Z',
      created_by: 'author', supplier: null, author: { full_name: 'Manager' },
    }] : [],
    isLoading: false, isFetching: false,
    error: mocks.error ? new Error('offline') : null, refetch: mocks.refetch,
  }),
}));
const product: StockLevelRow = {
  product_id: 'product', sku: 'FLOUR', name: 'Flour', unit: 'kg', current_stock: 1.375,
  category_id: null, category_name: null, min_stock_threshold: 0, track_inventory: true,
  stock_value: 0, last_movement_at: null,
};
describe('movement history recovery', () => {
  beforeEach(() => { mocks.error = false; vi.clearAllMocks(); });
  it('shows the movement unit and keeps Previous on an empty last page', () => {
    render(<MovementHistoryDrawer product={product} onClose={vi.fn()} />);
    expect(screen.getByText('+1,375 kg')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('No more movements on this page.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('+1,375 kg')).toBeInTheDocument();
  });
  it('withholds stale rows on error and offers recovery', () => {
    mocks.error = true;
    render(<MovementHistoryDrawer product={product} onClose={vi.fn()} />);
    expect(screen.queryByText('+1,375 kg')).not.toBeInTheDocument();
    expect(screen.getByText('Stock movements could not be loaded.')).toBeInTheDocument();
  });
});
