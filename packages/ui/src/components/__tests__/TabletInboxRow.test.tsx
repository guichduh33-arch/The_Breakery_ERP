import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, act } from '@testing-library/react';
import { TabletInboxRow, type TabletOrderEntry } from '../TabletInboxRow.js';

const makeEntry = (overrides: Partial<TabletOrderEntry> = {}): TabletOrderEntry => ({
  id: 'order-1',
  order_number: '#0042',
  table_number: 'T-03',
  order_type: 'dine_in',
  waiter_id: 'waiter-1',
  waiter_name: 'Waiter Demo',
  sent_to_kitchen_at: new Date(Date.now() - 150_000).toISOString(),
  items_count: 3,
  items_total: 105_000,
  notes: null,
  ...overrides,
});

const baseProps = {
  onPickup: vi.fn(),
};

describe('TabletInboxRow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders order number', () => {
    render(<TabletInboxRow entry={makeEntry()} {...baseProps} />);
    expect(screen.getByText('#0042')).toBeInTheDocument();
  });

  it('renders table number badge', () => {
    render(<TabletInboxRow entry={makeEntry()} {...baseProps} />);
    expect(screen.getByText('T-03')).toBeInTheDocument();
  });

  it('renders order type as Dine in', () => {
    render(<TabletInboxRow entry={makeEntry({ order_type: 'dine_in' })} {...baseProps} />);
    expect(screen.getByText('Dine in')).toBeInTheDocument();
  });

  it('renders order type as Take out', () => {
    render(<TabletInboxRow entry={makeEntry({ order_type: 'take_out' })} {...baseProps} />);
    expect(screen.getByText('Take out')).toBeInTheDocument();
  });

  it('renders item count', () => {
    render(<TabletInboxRow entry={makeEntry()} {...baseProps} />);
    expect(screen.getByText('3 items')).toBeInTheDocument();
  });

  it('renders singular item label when count is 1', () => {
    render(<TabletInboxRow entry={makeEntry({ items_count: 1 })} {...baseProps} />);
    expect(screen.getByText('1 item')).toBeInTheDocument();
  });

  it('renders waiter name', () => {
    render(<TabletInboxRow entry={makeEntry()} {...baseProps} />);
    expect(screen.getByText('Waiter Demo')).toBeInTheDocument();
  });

  it('renders age timer on mount', () => {
    render(<TabletInboxRow entry={makeEntry({ sent_to_kitchen_at: new Date(Date.now() - 150_000).toISOString() })} {...baseProps} />);
    const timer = screen.getByTestId('age-timer');
    expect(timer.textContent).toMatch(/\d+m \d+s/);
  });

  it('age timer updates after 1 second', () => {
    const sentAt = new Date(Date.now() - 10_000).toISOString();
    render(<TabletInboxRow entry={makeEntry({ sent_to_kitchen_at: sentAt })} {...baseProps} />);
    const timerBefore = screen.getByTestId('age-timer').textContent;

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const timerAfter = screen.getByTestId('age-timer').textContent;
    expect(timerAfter).not.toBe(timerBefore);
  });

  it('calls onPickup with order id when Pickup button is clicked', () => {
    const onPickup = vi.fn();
    render(<TabletInboxRow entry={makeEntry()} onPickup={onPickup} />);
    fireEvent.click(screen.getByRole('button', { name: /Pickup order #0042/i }));
    expect(onPickup).toHaveBeenCalledWith('order-1');
  });

  it('disables Pickup button when isPicking is true', () => {
    render(<TabletInboxRow entry={makeEntry()} {...baseProps} isPicking={true} />);
    expect(screen.getByRole('button', { name: /Pickup/i })).toBeDisabled();
  });

  it('enables Pickup button when isPicking is false', () => {
    render(<TabletInboxRow entry={makeEntry()} {...baseProps} isPicking={false} />);
    expect(screen.getByRole('button', { name: /Pickup/i })).not.toBeDisabled();
  });

  it('does not render table badge when table_number is null', () => {
    render(<TabletInboxRow entry={makeEntry({ table_number: null })} {...baseProps} />);
    expect(screen.queryByText('T-03')).not.toBeInTheDocument();
  });

  // Session 59 (17 D1.1) — order-level note surfaced on the pickup screen.
  it('renders the order note when notes is set', () => {
    render(<TabletInboxRow entry={makeEntry({ notes: 'No gluten — nut allergy' })} {...baseProps} />);
    expect(screen.getByTestId('tablet-inbox-note')).toHaveTextContent('No gluten — nut allergy');
  });

  it('renders no note element when notes is null', () => {
    render(<TabletInboxRow entry={makeEntry({ notes: null })} {...baseProps} />);
    expect(screen.queryByTestId('tablet-inbox-note')).not.toBeInTheDocument();
  });
});
