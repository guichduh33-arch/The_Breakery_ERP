// packages/ui/src/components/__tests__/RefundLineRow.test.tsx
// Session 10 — RefundLineRow + RefundTenderSplitter smoke.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RefundLineRow, type RefundLineRowItem } from '../RefundLineRow.js';
import { RefundTenderSplitter } from '../RefundTenderSplitter.js';

const item = (overrides: Partial<RefundLineRowItem> = {}): RefundLineRowItem => ({
  order_item_id: 'oi-1',
  name: 'Latte',
  quantity: 2,
  line_total: 60_000,
  qty_already_refunded: 0,
  is_cancelled: false,
  ...overrides,
});

describe('RefundLineRow', () => {
  it('checking the box selects the remaining qty', () => {
    const onChange = vi.fn();
    render(<RefundLineRow item={item()} selectedQty={0} refundAmount={0} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('disabled when fully refunded', () => {
    const onChange = vi.fn();
    render(
      <RefundLineRow
        item={item({ qty_already_refunded: 2 })}
        selectedQty={0}
        refundAmount={0}
        onChange={onChange}
      />,
    );
    expect(screen.getByText(/fully refunded/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('disabled when cancelled', () => {
    render(
      <RefundLineRow
        item={item({ is_cancelled: true })}
        selectedQty={0}
        refundAmount={0}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('shows the qty stepper when remaining > 1 and selected', () => {
    render(<RefundLineRow item={item()} selectedQty={2} refundAmount={60_000} onChange={() => undefined} />);
    expect(screen.getByLabelText(/decrease/i)).toBeInTheDocument();
  });
});

describe('RefundTenderSplitter', () => {
  it('renders one row per method, indicating remaining', () => {
    render(
      <RefundTenderSplitter
        refundTotal={50_000}
        methods={[
          { method: 'cash', paid: 60_000, already_refunded: 0 },
          { method: 'card', paid: 40_000, already_refunded: 0 },
        ]}
        values={[]}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByTestId('refund-tender-method-cash')).toBeInTheDocument();
    expect(screen.getByTestId('refund-tender-method-card')).toBeInTheDocument();
  });

  it('emits onChange with parsed numeric value per method', () => {
    const onChange = vi.fn();
    render(
      <RefundTenderSplitter
        refundTotal={50_000}
        methods={[{ method: 'cash', paid: 60_000, already_refunded: 0 }]}
        values={[]}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText(/refund amount for cash/i);
    fireEvent.change(input, { target: { value: '30000' } });
    expect(onChange).toHaveBeenCalledWith([{ method: 'cash', amount: 30_000 }]);
  });
});
