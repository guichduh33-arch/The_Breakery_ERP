import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OutstandingOrdersPanel, type OutstandingOrdersPanelProps, type OutstandingPaymentRequest } from '../OutstandingOrdersPanel.js';

const props: OutstandingOrdersPanelProps = {
  rows: [{ order_id: 'order-1', order_number: 'P-001', customer_name: 'Customer A', created_at: '2026-11-01T00:00:00Z',
    total: 100000, paid: 30000, due: 70000, total_count: 1 }],
  loading: false, search: '', onSearch: vi.fn(), page: 0, onPage: vi.fn(),
  canSettle: true, sessionId: 'receiving-shift', storageKey: 'outstanding-test', onSettle: vi.fn(),
};
beforeEach(() => {
  localStorage.clear();
  const held = new Set<string>();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: (name: string, _options: LockOptions, callback: (lock: { name: string; mode: 'exclusive' } | null) => Promise<void>) => {
      if (held.has(name)) return callback(null);
      held.add(name);
      return callback({ name, mode: 'exclusive' }).finally(() => held.delete(name));
    },
  } });
});
describe('outstanding settlement recovery', () => {
  it('saves before sending and resumes the same key after a lost response and reload', async () => {
    const requests: OutstandingPaymentRequest[] = [];
    const first = render(<OutstandingOrdersPanel {...props} onSettle={(request) => {
      requests.push(request);
      expect(JSON.parse(localStorage.getItem(props.storageKey)!)).toEqual(request);
      return Promise.reject(new Error('Connection lost'));
    }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settle P-001' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Amount received' }), { target: { value: '20000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await screen.findByText('Connection lost');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ amount: 20000, method: 'cash', sessionId: 'receiving-shift' });
    first.unmount();
    const settle = vi.fn().mockResolvedValue(undefined);
    render(<OutstandingOrdersPanel {...props} sessionId={null} canSettle={false} onSettle={settle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume saved payment' }));
    await waitFor(() => expect(settle).toHaveBeenCalledWith(requests[0]));
    await waitFor(() => expect(localStorage.getItem(props.storageKey)).toBeNull());
  });
  it('does not send if durable storage fails', async () => {
    const settle = vi.fn();
    render(<OutstandingOrdersPanel {...props} onSettle={settle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settle P-001' }));
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await screen.findByText('Storage full');
    expect(settle).not.toHaveBeenCalled(); write.mockRestore();
  });
  it('requires an open shift or back-office payment permission for a new receipt', () => {
    render(<OutstandingOrdersPanel {...props} canSettle={false} disabledReason="Open a shift" />);
    expect(screen.getByRole('button', { name: 'Settle P-001' })).toBeDisabled();
    expect(screen.getByText('Open a shift')).toBeInTheDocument();
  });
  it('does not overwrite a payment started in another tab after this view loaded', async () => {
    const settle = vi.fn();
    render(<OutstandingOrdersPanel {...props} onSettle={settle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settle P-001' }));
    const other = { orderId: 'another-order', orderNumber: 'P-002', method: 'cash', amount: 10000,
      idempotencyKey: 'other-tab-key', sessionId: 'receiving-shift' };
    localStorage.setItem(props.storageKey, JSON.stringify(other));
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    await screen.findByText('Resume the saved payment before recording another receipt');
    expect(settle).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(props.storageKey)!)).toEqual(other);
  });
});
