import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TabletOrderCard, type TabletOrderCardOrder } from '../TabletOrderCard.js';

const makeOrder = (overrides: Partial<TabletOrderCardOrder> = {}): TabletOrderCardOrder => ({
  id: 'ord-1',
  order_number: '#0099',
  table_number: 'T-03',
  order_type: 'dine_in',
  sent_to_kitchen_at: new Date(Date.now() - 90_000).toISOString(),
  status: 'pending_payment',
  items: [
    { id: 'i1', name: 'Americano', quantity: 2, kitchen_status: 'pending' },
    { id: 'i2', name: 'Croissant', quantity: 1, kitchen_status: 'preparing' },
    { id: 'i3', name: 'Latte', quantity: 1, kitchen_status: 'ready' },
  ],
  ...overrides,
});

describe('TabletOrderCard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders order number', () => {
    render(<TabletOrderCard order={makeOrder()} />);
    expect(screen.getByText('#0099')).toBeInTheDocument();
  });

  it('renders status badge — pending_payment', () => {
    render(<TabletOrderCard order={makeOrder({ status: 'pending_payment' })} />);
    expect(screen.getByText('Pending Payment')).toBeInTheDocument();
  });

  it('renders status badge — draft', () => {
    render(<TabletOrderCard order={makeOrder({ status: 'draft' })} />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('renders status badge — paid', () => {
    render(<TabletOrderCard order={makeOrder({ status: 'paid' })} />);
    expect(screen.getByText('Paid')).toBeInTheDocument();
  });

  it('renders status badge — voided', () => {
    render(<TabletOrderCard order={makeOrder({ status: 'voided' })} />);
    expect(screen.getByText('Voided')).toBeInTheDocument();
  });

  it('renders table number', () => {
    render(<TabletOrderCard order={makeOrder()} />);
    expect(screen.getByText('T-03')).toBeInTheDocument();
  });

  it('renders order type label', () => {
    render(<TabletOrderCard order={makeOrder({ order_type: 'dine_in' })} />);
    expect(screen.getByText('Dine in')).toBeInTheDocument();
  });

  it('renders Take out label', () => {
    render(<TabletOrderCard order={makeOrder({ order_type: 'take_out' })} />);
    expect(screen.getByText('Take out')).toBeInTheDocument();
  });

  it('renders all item names', () => {
    render(<TabletOrderCard order={makeOrder()} />);
    expect(screen.getByText('Americano')).toBeInTheDocument();
    expect(screen.getByText('Croissant')).toBeInTheDocument();
    expect(screen.getByText('Latte')).toBeInTheDocument();
  });

  it('renders kitchen_status pending pill', () => {
    render(<TabletOrderCard order={makeOrder()} />);
    expect(screen.getAllByText('pending').length).toBeGreaterThan(0);
  });

  it('renders kitchen_status preparing pill', () => {
    render(<TabletOrderCard order={makeOrder()} />);
    expect(screen.getByText('preparing')).toBeInTheDocument();
  });

  it('renders kitchen_status ready pill', () => {
    render(<TabletOrderCard order={makeOrder()} />);
    expect(screen.getByText('ready')).toBeInTheDocument();
  });

  it('renders kitchen_status served pill', () => {
    render(
      <TabletOrderCard
        order={makeOrder({
          items: [{ id: 'i1', name: 'Tea', quantity: 1, kitchen_status: 'served' }],
        })}
      />,
    );
    expect(screen.getByText('served')).toBeInTheDocument();
  });

  it('shows Cancel button when status is pending_payment and onCancel provided', () => {
    render(<TabletOrderCard order={makeOrder({ status: 'pending_payment' })} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
  });

  it('calls onCancel with order id when Cancel is clicked', () => {
    const onCancel = vi.fn();
    render(<TabletOrderCard order={makeOrder({ status: 'pending_payment' })} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalledWith('ord-1');
  });

  it('does not show Cancel button when status is draft', () => {
    render(<TabletOrderCard order={makeOrder({ status: 'draft' })} onCancel={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Cancel/i })).not.toBeInTheDocument();
  });

  it('does not show Cancel button when status is paid', () => {
    render(<TabletOrderCard order={makeOrder({ status: 'paid' })} onCancel={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Cancel/i })).not.toBeInTheDocument();
  });

  it('does not show Cancel button when status is voided', () => {
    render(<TabletOrderCard order={makeOrder({ status: 'voided' })} onCancel={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Cancel/i })).not.toBeInTheDocument();
  });

  it('does not show Cancel button when onCancel is not provided', () => {
    render(<TabletOrderCard order={makeOrder({ status: 'pending_payment' })} />);
    expect(screen.queryByRole('button', { name: /Cancel/i })).not.toBeInTheDocument();
  });

  it('disables Cancel button when isCancelling is true', () => {
    render(
      <TabletOrderCard order={makeOrder({ status: 'pending_payment' })} onCancel={vi.fn()} isCancelling={true} />,
    );
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeDisabled();
  });

  it('renders age timer', () => {
    render(<TabletOrderCard order={makeOrder()} />);
    expect(screen.getByTestId('card-age-timer').textContent).toMatch(/\d+m \d+s/);
  });
});
