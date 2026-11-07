import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import type { PrintJob } from '@/services/print/printJobs';
import type * as PrintJobsModule from '@/services/print/printJobs';
import { usePrintJobs } from '@/services/print/printJobs';
import { PrintJobsPanel } from '../PrintJobsPanel';

const mocks = vi.hoisted(() => ({ station: vi.fn(), receipt: vi.fn(), receipts: [{ id: 'receipt', status: 'confirmed', payload: { order: { id: 'order', order_number: 'RECEIPT' }, payment: { amount: 0 } } }] }));
vi.mock('@/services/print/printService', () => ({ printStationTicket: vi.fn() }));
vi.mock('@/services/print/printJobs', async (original) => ({
  ...await original<typeof PrintJobsModule>(), runPrintJob: mocks.station,
}));
vi.mock('@/services/print/receiptJobs', () => ({
  useReceiptJobs: (select: (state: unknown) => unknown) => select({ jobs: mocks.receipts }),
  runReceiptJob: mocks.receipt,
}));
vi.mock('../hooks/useStationPrinters', () => ({ useStationPrinters: () => ({ data: new Map() }) }));

const job = (id: string, kind: PrintJob['payload']['kind'], status: PrintJob['status']): PrintJob => ({
  id, status, attempts: 1,
  payload: { kind, role: kind === 'shift_close' ? 'cashier' : 'kitchen', order_number: id,
    created_at: '2026-11-02T00:00:00Z', server_name: 'Cashier', items: [] },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.receipts = [{ id: 'receipt', status: 'confirmed', payload: { order: { id: 'order', order_number: 'RECEIPT' }, payment: { amount: 0 } } }];
  mocks.station.mockResolvedValue({ success: true });
  mocks.receipt.mockResolvedValue({ success: true });
  usePrintJobs.setState({ jobs: [job('PREP', 'prep', 'confirmed'), job('WAITER', 'waiter', 'confirmed'),
    job('UNKNOWN', 'prep', 'unknown'), job('REPORT', 'shift_close', 'confirmed')] });
});

describe('station reprint restriction', () => {
  it('disables acknowledged station tickets while keeping uncertain jobs and cashier documents actionable', () => {
    render(<PrintJobsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Printing/ }));
    for (const id of ['PREP', 'WAITER']) {
      const row = screen.getByText(new RegExp(`^${id} ·`)).parentElement!;
      const button = within(row).getByRole('button', { name: 'Already printed' });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(mocks.station).not.toHaveBeenCalled();
    for (const id of ['UNKNOWN', 'REPORT', 'RECEIPT']) {
      const row = screen.getByText(new RegExp(`^${id} ·`)).parentElement!;
      expect(within(row).getByRole('button', { name: 'Reprint duplicate' })).toBeEnabled();
    }
    fireEvent.click(within(screen.getByText(/^UNKNOWN ·/).parentElement!).getByRole('button'));
    expect(mocks.station).toHaveBeenCalledWith(expect.objectContaining({ order_number: 'UNKNOWN' }), undefined, 1, expect.objectContaining({ status: 'unknown' }));
  });
});

it('retries the exact payment job when two receipts share the same order', async () => {
  mocks.receipts = [
    { id: 'payment-1', status: 'unknown', payload: { order: { id: 'order', order_number: 'SAME' }, payment: { amount: 3000 } } },
    { id: 'payment-2', status: 'unknown', payload: { order: { id: 'order', order_number: 'SAME' }, payment: { amount: 7000 } } },
  ];
  render(<PrintJobsPanel />);
  fireEvent.click(screen.getByRole('button', { name: /Printing/ }));
  const rows = screen.getAllByText('SAME · Receipt').map((label) => label.parentElement!);
  fireEvent.click(within(rows[0]!).getByRole('button'));
  await waitFor(() => expect(within(rows[1]!).getByRole('button')).toBeEnabled());
  fireEvent.click(within(rows[1]!).getByRole('button'));
  expect(mocks.receipt).toHaveBeenNthCalledWith(1, mocks.receipts[1]!.payload, undefined, 'payment-2');
  expect(mocks.receipt).toHaveBeenNthCalledWith(2, mocks.receipts[0]!.payload, undefined, 'payment-1');
});
