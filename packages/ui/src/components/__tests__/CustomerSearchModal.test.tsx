import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import type { Customer } from '@breakery/domain';
import { CustomerSearchModal } from '../CustomerSearchModal.js';

const makeCustomer = (overrides: Partial<Customer> = {}): Customer => ({
  id: 'c1',
  name: 'Test Customer',
  phone: '+62811111111',
  email: null,
  customer_type: 'retail',
  loyalty_points: 0,
  lifetime_points: 0,
  total_spent: 0,
  total_visits: 0,
  last_visit_at: null,
  ...overrides,
});

const GOLD_CUSTOMER = makeCustomer({
  id: 'c2',
  name: 'Loyal Gold Customer',
  phone: '+62833333333',
  loyalty_points: 2500,
  lifetime_points: 2500,
});

describe('CustomerSearchModal', () => {
  it('renders search input when open', () => {
    render(
      <CustomerSearchModal
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        searchFn={vi.fn().mockResolvedValue([])}
      />,
    );
    expect(screen.getByPlaceholderText('Phone or name…')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(
      <CustomerSearchModal
        open={false}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        searchFn={vi.fn().mockResolvedValue([])}
      />,
    );
    expect(screen.queryByPlaceholderText('Phone or name…')).not.toBeInTheDocument();
  });

  it('debounces search — does not call searchFn before 300ms', async () => {
    vi.useFakeTimers();
    const searchFn = vi.fn().mockResolvedValue([]);
    render(
      <CustomerSearchModal
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        searchFn={searchFn}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('Phone or name…'), {
      target: { value: '62833' },
    });
    expect(searchFn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(299);
    expect(searchFn).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(searchFn).toHaveBeenCalledWith('62833');
    vi.useRealTimers();
  });

  it('shows "+ New customer" when query >= 2 chars and no results', async () => {
    vi.useFakeTimers();
    const searchFn = vi.fn().mockResolvedValue([]);
    render(
      <CustomerSearchModal
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        searchFn={searchFn}
        createFn={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('Phone or name…'), {
      target: { value: 'unknown' },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(screen.getByText('New customer')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('does not show "+ New customer" when no createFn', async () => {
    vi.useFakeTimers();
    const searchFn = vi.fn().mockResolvedValue([]);
    render(
      <CustomerSearchModal
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        searchFn={searchFn}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('Phone or name…'), {
      target: { value: 'unknown' },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(screen.queryByText('New customer')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('quick-create form calls createFn then onSelect', async () => {
    vi.useFakeTimers();
    const searchFn = vi.fn().mockResolvedValue([]);
    const newCustomer = makeCustomer({ id: 'new1', name: 'Alice', phone: '+6281' });
    const createFn = vi.fn().mockResolvedValue(newCustomer);
    const onSelect = vi.fn();

    render(
      <CustomerSearchModal
        open
        onClose={vi.fn()}
        onSelect={onSelect}
        searchFn={searchFn}
        createFn={createFn}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Phone or name…'), {
      target: { value: 'Alice' },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(screen.getByText('New customer')).toBeInTheDocument();
    fireEvent.click(screen.getByText('New customer'));

    vi.useRealTimers();
    await waitFor(() => expect(screen.getByPlaceholderText('Name *')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Name *'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByPlaceholderText('Phone *'), { target: { value: '+6281' } });
    fireEvent.click(screen.getByRole('button', { name: /Create/i }));

    await waitFor(() => {
      expect(createFn).toHaveBeenCalledWith({ name: 'Alice', phone: '+6281' });
      expect(onSelect).toHaveBeenCalledWith(newCustomer);
    });
  });

  it('fires onSelect when a search result is clicked', async () => {
    vi.useFakeTimers();
    const searchFn = vi.fn().mockResolvedValue([GOLD_CUSTOMER]);
    const onSelect = vi.fn();

    render(
      <CustomerSearchModal
        open
        onClose={vi.fn()}
        onSelect={onSelect}
        searchFn={searchFn}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('Phone or name…'), {
      target: { value: '62833' },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText('Loyal Gold Customer')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Loyal Gold Customer'));
    expect(onSelect).toHaveBeenCalledWith(GOLD_CUSTOMER);
  });

  it('calls onClose when Cancel button pressed', () => {
    const onClose = vi.fn();
    render(
      <CustomerSearchModal
        open
        onClose={onClose}
        onSelect={vi.fn()}
        searchFn={vi.fn().mockResolvedValue([])}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows LoyaltyBadge for customer with loyalty_points > 0', async () => {
    vi.useFakeTimers();
    const searchFn = vi.fn().mockResolvedValue([GOLD_CUSTOMER]);

    render(
      <CustomerSearchModal
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        searchFn={searchFn}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('Phone or name…'), {
      target: { value: '62833' },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText('Gold')).toBeInTheDocument());
  });
});
