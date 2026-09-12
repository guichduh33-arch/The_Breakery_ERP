import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CountItemRow } from '../components/CountItemRow.js';
import type { OpnameItemRow } from '../hooks/useOpnameDetail.js';

const mutate = vi.fn();
vi.mock('../hooks/useOpnameMutations.js', () => ({
  useSetOpnameCount: () => ({ mutate, isPending: false }),
}));

const item: OpnameItemRow = {
  id: 'item-1', product_id: 'product-1', expected_qty: 12,
  counted_qty: null, variance: null, unit: 'kg', notes: null, movement_id: null,
  product: { name: 'Flour', sku: 'RAW-FLOUR' },
};

function renderRow() {
  return render(<table><tbody><CountItemRow countId="count-1" item={item} revealed={false} locked={false} /></tbody></table>);
}

describe('opname quantity entry', () => {
  beforeEach(() => { mutate.mockReset(); });

  it('shows the unit without revealing expected stock', () => {
    renderRow();
    expect(screen.getByText('kg')).toBeInTheDocument();
    expect(screen.queryByTestId('cell-expected')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cell-variance')).not.toBeInTheDocument();
  });

  it('never saves an empty count as zero on blur or Save', () => {
    renderRow();
    fireEvent.blur(screen.getByLabelText('Counted quantity for Flour'));
    fireEvent.change(screen.getByLabelText('Notes for Flour'), { target: { value: 'Recount later' } });
    fireEvent.blur(screen.getByLabelText('Notes for Flour'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a non-negative quantity');
  });

  it.each(['0', '1.375'])('saves an explicit %s exactly once across blur and click', (quantity) => {
    renderRow();
    const input = screen.getByLabelText('Counted quantity for Flour');
    fireEvent.change(input, { target: { value: quantity } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({ countedQty: Number(quantity) });
  });

  it('allows a retry after a failed save settles', () => {
    renderRow();
    fireEvent.change(screen.getByLabelText('Counted quantity for Flour'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const callbacks = mutate.mock.calls[0]?.[1] as { onSettled: () => void };
    callbacks.onSettled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(mutate).toHaveBeenCalledTimes(2);
  });
});
