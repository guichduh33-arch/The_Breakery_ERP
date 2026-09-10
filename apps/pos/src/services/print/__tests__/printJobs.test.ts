import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StationTicketPayload } from '@breakery/domain';
import { runPrintJob, usePrintJobs } from '../printJobs';
const send = vi.hoisted(() => vi.fn());
vi.mock('../printService', () => ({ printStationTicket: send }));
const ticket: StationTicketPayload = { kind: 'prep', role: 'kitchen', order_number: 'P-001', created_at: '2026-09-10T00:00:00Z', server_name: 'Cashier', items: [{ name: 'Coffee', quantity: 1 }] };
beforeEach(() => { usePrintJobs.setState({ jobs: [] }); send.mockReset(); });
describe('print acknowledgement and duplicates', () => {
  it('keeps a failed print and replays only its saved paper payload as a duplicate', async () => {
    const failed = await runPrintJob(ticket, undefined);
    expect(failed.success).toBe(false);
    const job = usePrintJobs.getState().jobs[0]!;
    expect(job.status).toBe('unknown');
    expect(send).not.toHaveBeenCalled();
    send.mockResolvedValue({ success: true });
    await runPrintJob(job.payload, { ip_address: '127.0.0.1', port: 9100 }, 1, job);
    expect(send).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duplicate: true, order_number: 'P-001' }));
    expect(usePrintJobs.getState().jobs).toHaveLength(1);
    expect(usePrintJobs.getState().jobs[0]?.status).toBe('confirmed');
  });
  it('does not confirm a job until all configured copies are acknowledged', async () => {
    send.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, error: 'paper_out' });
    await runPrintJob(ticket, { ip_address: '127.0.0.1', port: 9100 }, 2);
    expect(usePrintJobs.getState().jobs[0]?.status).toBe('unknown');
  });
});
