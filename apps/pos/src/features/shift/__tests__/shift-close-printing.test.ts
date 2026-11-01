import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { installPrintLocks } from '@/services/print/__tests__/printBrowser';
import { usePrintJobs } from '@/services/print/printJobs';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), send: vi.fn(), printers: vi.fn(), actor: 'actor' }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => ({ user: { id: mocks.actor, full_name: 'Cashier A' } }) } }));
vi.mock('@/services/print/printService', () => ({ printStationTicket: mocks.send }));
vi.mock('@/features/cart/hooks/useStationPrinters', () => ({ getStationPrinters: mocks.printers }));
import { buildShiftCloseTicket, printClosedShift } from '../shiftClosePrinting';
const saved = { shift_id: 'closed-shift', closed_at: '2026-11-02T00:00:00Z',
  totals_by_payment_method: { cash: 30000, edc: 20000, qris: 20000, transfer: 20000 },
  receipts_total: 90000, outstanding_collections_total: 90000, opening_cash: 0,
  closing_cash_expected: 30000, closing_cash_counted: 30000, cash_variance: 0 };
const printer = { ip_address: '192.168.1.8', port: 9100 };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); usePrintJobs.setState({ jobs: [] }); installPrintLocks();
  mocks.actor = 'actor';
  mocks.rpc.mockResolvedValue({ data: saved, error: null });
  mocks.printers.mockResolvedValue(new Map([['cashier', printer]]));
  mocks.send.mockResolvedValue({ success: true });
});
describe('shift closing print recovery', () => {
  it('prints automatically once on the cashier printer, even on close retry', async () => {
    const qc = new QueryClient();
    await printClosedShift('closed-shift', qc);
    await printClosedShift('closed-shift', qc);
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledWith(printer, expect.objectContaining({ kind: 'shift_close', role: 'cashier' }));
    expect(usePrintJobs.getState().jobs[0]?.status).toBe('confirmed');
  });
  it('keeps an unconfirmed report and marks a manual retry as duplicate', async () => {
    mocks.send.mockResolvedValueOnce({ success: false, error: 'Printer unreachable' });
    const qc = new QueryClient();
    await printClosedShift('closed-shift', qc);
    expect(usePrintJobs.getState().jobs[0]?.status).toBe('unknown');
    await printClosedShift('closed-shift', qc);
    expect(mocks.send).toHaveBeenCalledOnce();
    await printClosedShift('closed-shift', qc, true);
    expect(mocks.send).toHaveBeenLastCalledWith(printer, expect.objectContaining({ duplicate: true }));
  });
  it('prints saved method totals and rejects invalid monetary values', () => {
    expect(buildShiftCloseTicket(saved, 'Cashier').report_lines).toEqual(expect.arrayContaining([
      { label: 'CASH', amount: 30000 }, { label: 'EDC', amount: 20000 },
      { label: 'QRIS', amount: 20000 }, { label: 'TRANSFER', amount: 20000 },
      { label: 'Outstanding collected', amount: 90000 },
    ]));
    expect(() => buildShiftCloseTicket({ ...saved, receipts_total: 'NaN' }, 'Cashier')).toThrow('Invalid saved shift amount');
  });
  it('resumes a durable job even if the local tab store has not seen it', async () => {
    mocks.send.mockResolvedValueOnce({ success: false, error: 'Unconfirmed' });
    const qc = new QueryClient();
    await printClosedShift('closed-shift', qc);
    const raw = localStorage.getItem('breakery.print-jobs.v1')!;
    usePrintJobs.setState({ jobs: [] });
    localStorage.setItem('breakery.print-jobs.v1', raw);
    await printClosedShift('closed-shift', qc, true);
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenLastCalledWith(printer, expect.objectContaining({ duplicate: true }));
  });
  it('does not print when the cashier changes during the report fetch', async () => {
    mocks.rpc.mockImplementationOnce(() => { mocks.actor = 'another-cashier'; return Promise.resolve({ data: saved, error: null }); });
    await expect(printClosedShift('closed-shift', new QueryClient())).rejects.toThrow('Your session changed');
    expect(mocks.send).not.toHaveBeenCalled();
    expect(usePrintJobs.getState().jobs).toEqual([]);
  });
});
