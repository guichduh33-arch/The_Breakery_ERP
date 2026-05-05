import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HeldOrdersModal, type HeldOrder } from '../HeldOrdersModal.js';

const makeEntry = (overrides: Partial<HeldOrder> = {}): HeldOrder => ({
  id: 'held-1',
  heldAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  cart: {
    items: [
      { id: 'i1', product_id: 'p1', name: 'Americano', quantity: 2, unit_price: 35000, modifiers: [] },
      { id: 'i2', product_id: 'p2', name: 'Croissant', quantity: 1, unit_price: 25000, modifiers: [] },
    ],
    customerId: null,
    loyaltyPointsToRedeem: 0,
    orderType: 'dine_in',
    tableNumber: 'T-01',
  },
  ...overrides,
});

const baseProps = {
  open: true,
  onClose: vi.fn(),
  onRestore: vi.fn(),
  onDelete: vi.fn(),
  cartHasItems: false,
};

describe('HeldOrdersModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders "No held orders" and Cancel button when entries is empty', () => {
    render(<HeldOrdersModal {...baseProps} entries={[]} />);
    expect(screen.getByText('No held orders')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(<HeldOrdersModal {...baseProps} entries={[]} open={false} />);
    expect(screen.queryByText('No held orders')).not.toBeInTheDocument();
  });

  it('shows entry count in header', () => {
    const entry = makeEntry();
    render(<HeldOrdersModal {...baseProps} entries={[entry]} />);
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  it('renders item count for each held order row', () => {
    const entry = makeEntry();
    render(<HeldOrdersModal {...baseProps} entries={[entry]} />);
    expect(screen.getByText(/3 items/)).toBeInTheDocument();
  });

  it('shows relative timestamp for each row', () => {
    const entry = makeEntry();
    render(<HeldOrdersModal {...baseProps} entries={[entry]} />);
    expect(screen.getByText(/min ago/)).toBeInTheDocument();
  });

  it('shows "Customer attached" when customerId is not null', () => {
    const entry = makeEntry({ cart: { ...makeEntry().cart, customerId: 'cust-1' } });
    render(<HeldOrdersModal {...baseProps} entries={[entry]} />);
    expect(screen.getByText('Customer attached')).toBeInTheDocument();
  });

  it('does not show "Customer attached" when customerId is null', () => {
    const entry = makeEntry();
    render(<HeldOrdersModal {...baseProps} entries={[entry]} />);
    expect(screen.queryByText('Customer attached')).not.toBeInTheDocument();
  });

  it('shows note in italic when present', () => {
    const entry = makeEntry({ notes: 'for Mr. Tan' });
    render(<HeldOrdersModal {...baseProps} entries={[entry]} />);
    expect(screen.getByText('for Mr. Tan')).toBeInTheDocument();
  });

  it('sorts entries desc by heldAt (most recent first)', () => {
    const older = makeEntry({ id: 'held-1', heldAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(), notes: 'older' });
    const newer = makeEntry({ id: 'held-2', heldAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(), notes: 'newer' });
    render(<HeldOrdersModal {...baseProps} entries={[older, newer]} />);
    const notes = screen.getAllByText(/older|newer/);
    expect(notes[0]?.textContent).toBe('newer');
    expect(notes[1]?.textContent).toBe('older');
  });

  it('calls onRestore directly and onClose when cartHasItems is false', () => {
    const onRestore = vi.fn();
    const onClose = vi.fn();
    const entry = makeEntry();
    render(
      <HeldOrdersModal
        {...baseProps}
        entries={[entry]}
        onRestore={onRestore}
        onClose={onClose}
        cartHasItems={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Restore/i }));
    expect(onRestore).toHaveBeenCalledWith('held-1');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows confirm dialog when cartHasItems is true and Restore is tapped', () => {
    const entry = makeEntry();
    render(<HeldOrdersModal {...baseProps} entries={[entry]} cartHasItems={true} />);
    fireEvent.click(screen.getByRole('button', { name: /Restore/i }));
    expect(screen.getByText('Discard current cart?')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('calls onRestore and onClose when Replace is clicked in confirm dialog', () => {
    const onRestore = vi.fn();
    const onClose = vi.fn();
    const entry = makeEntry();
    render(
      <HeldOrdersModal
        {...baseProps}
        entries={[entry]}
        onRestore={onRestore}
        onClose={onClose}
        cartHasItems={true}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Restore/i }));
    fireEvent.click(screen.getByRole('button', { name: /Replace/i }));
    expect(onRestore).toHaveBeenCalledWith('held-1');
    expect(onClose).toHaveBeenCalled();
  });

  it('dismisses confirm dialog without calling onRestore when Cancel is clicked', () => {
    const onRestore = vi.fn();
    const entry = makeEntry();
    render(<HeldOrdersModal {...baseProps} entries={[entry]} onRestore={onRestore} cartHasItems={true} />);
    fireEvent.click(screen.getByRole('button', { name: /Restore/i }));
    expect(screen.getByText('Discard current cart?')).toBeInTheDocument();

    const cancelButtons = screen.getAllByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelButtons[cancelButtons.length - 1]!);
    expect(onRestore).not.toHaveBeenCalled();
    expect(screen.queryByText('Discard current cart?')).not.toBeInTheDocument();
  });

  it('calls onDelete when Delete button is tapped', () => {
    const onDelete = vi.fn();
    const entry = makeEntry();
    render(<HeldOrdersModal {...baseProps} entries={[entry]} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: /Delete/i }));
    expect(onDelete).toHaveBeenCalledWith('held-1');
  });

  it('calls onClose when the X button is pressed', () => {
    const onClose = vi.fn();
    const entry = makeEntry();
    render(<HeldOrdersModal {...baseProps} entries={[entry]} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Close/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
