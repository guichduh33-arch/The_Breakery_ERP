// apps/backoffice/src/features/inventory-production/__tests__/BatchSelector.smoke.test.tsx
// Session 15 / Phase 4.A — BatchSelector row smoke tests.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BatchSelector, type BatchItem } from '../components/BatchSelector.js';

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: [], error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
          }),
        }),
      }),
    }),
  },
}));

function makeItem(overrides: Partial<BatchItem> = {}): BatchItem {
  return {
    rowId:            'r-1',
    productId:        null,
    productName:      null,
    productUnit:      null,
    quantityProduced: '',
    quantityWaste:    '0',
    ...overrides,
  };
}

function renderRow(value: BatchItem, props?: Partial<React.ComponentProps<typeof BatchSelector>>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  const onRemove = vi.fn();
  return {
    onChange,
    onRemove,
    ...render(
      <QueryClientProvider client={qc}>
        <BatchSelector
          value={value}
          onChange={onChange}
          onRemove={onRemove}
          {...props}
        />
      </QueryClientProvider>,
    ),
  };
}

describe('BatchSelector smoke', () => {
  it('renders the empty picker + qty + waste inputs', () => {
    renderRow(makeItem());
    expect(screen.getByText(/Recipe \/ finished product/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Quantity produced/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Waste quantity/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remove this row/i })).toBeInTheDocument();
  });

  it('renders the selected product name and a Change link when a product is set', () => {
    renderRow(makeItem({
      productId:   'p-1',
      productName: 'Test Sourdough',
      productUnit: 'pcs',
      quantityProduced: '5',
    }));
    expect(screen.getByText(/Test Sourdough/)).toBeInTheDocument();
    expect(screen.getByText(/pcs/)).toBeInTheDocument();
    expect(screen.getByText(/Change/i)).toBeInTheDocument();
  });

  it('calls onChange when the quantity input is edited', () => {
    const { onChange } = renderRow(makeItem({
      productId:        'p-1',
      productName:      'Loaf',
      productUnit:      'pcs',
      quantityProduced: '1',
    }));
    fireEvent.change(screen.getByLabelText(/Quantity produced/i), {
      target: { value: '3' },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ quantityProduced: '3' }));
  });

  it('calls onRemove when Remove is clicked', () => {
    const { onRemove } = renderRow(makeItem());
    fireEvent.click(screen.getByRole('button', { name: /Remove this row/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('disables the Remove button when removable is false', () => {
    renderRow(makeItem(), { removable: false });
    expect(screen.getByRole('button', { name: /Remove this row/i })).toBeDisabled();
  });
});
