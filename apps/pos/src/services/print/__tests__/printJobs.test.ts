import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StationTicketPayload } from '@breakery/domain';
import { runPrintJob, usePrintJobs, type PrintJob } from '../printJobs';
import { installPrintLocks } from './printBrowser';
const send = vi.hoisted(() => vi.fn());
vi.mock('../printService', () => ({ printStationTicket: send }));
const ticket: StationTicketPayload = { kind: 'prep', role: 'kitchen', order_number: 'P-001', created_at: '2026-09-10T00:00:00Z', server_name: 'Cashier', items: [{ name: 'Coffee', quantity: 1 }] };
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); usePrintJobs.setState({ jobs: [] }); send.mockReset(); installPrintLocks(); });
const target = { ip_address: '192.168.1.13', port: 9100 };
const readDurable = () => (JSON.parse(localStorage.getItem('breakery.print-jobs.v1')!) as { state: { jobs: PrintJob[] } }).state.jobs;
const otherTabWrite = (jobs: PrintJob[]) => localStorage.setItem('breakery.print-jobs.v1', JSON.stringify({ state: { jobs }, version: 0 }));
describe('print acknowledgement and duplicates', () => {
  it('bounds settled confirmations while preserving pending/unknown and the persisted payment attempt', async () => {
    localStorage.setItem('breakery.payment-attempt.v1', JSON.stringify({ version: 1, context: { idempotencyKey: 'active' }, cart: { items: [] }, tenders: [] }));
    const put = usePrintJobs.getState().put;
    await put({ id: 'payment:active:kitchen', payload: ticket, status: 'confirmed', attempts: 1 });
    await put({ id: 'payment:unknown:kitchen', payload: ticket, status: 'unknown', attempts: 1 });
    await put({ id: 'payment:pending:kitchen', payload: ticket, status: 'pending', attempts: 1 });
    for (let i = 0; i < 60; i++) await put({ id: `payment:settled-${i}:kitchen`, payload: ticket, status: 'confirmed', attempts: 1 });
    expect(usePrintJobs.getState().jobs.filter((job) => job.id.startsWith('payment:settled-'))).toHaveLength(50);
    expect(usePrintJobs.getState().jobs.map((job) => job.id)).toEqual(expect.arrayContaining(['payment:active:kitchen', 'payment:unknown:kitchen', 'payment:pending:kitchen']));
    localStorage.removeItem('breakery.payment-attempt.v1');
    await put({ id: 'payment:next:kitchen', payload: ticket, status: 'confirmed', attempts: 1 });
    expect(usePrintJobs.getState().jobs.some((job) => job.id === 'payment:active:kitchen')).toBe(false);
    expect(usePrintJobs.getState().jobs.map((job) => job.status)).toEqual(expect.arrayContaining(['pending', 'unknown']));
  });
  it('never automatically repeats a pending, unknown or acknowledged tablet job', async () => {
    const target = { ip_address: '192.168.1.13', port: 9100 };
    let resolve!: (value: { success: boolean }) => void;
    send.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const first = runPrintJob(ticket, target, 1, undefined, 'tablet:uuid:kitchen');
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect((await runPrintJob(ticket, target, 1, undefined, 'tablet:uuid:kitchen')).success).toBe(false);
    resolve({ success: false });
    await first;
    await runPrintJob(ticket, target, 1, undefined, 'tablet:uuid:kitchen');
    expect(send).toHaveBeenCalledTimes(1);
    const unknown = usePrintJobs.getState().jobs[0]!;
    send.mockResolvedValue({ success: true });
    await runPrintJob(ticket, target, 1, unknown);
    await runPrintJob(ticket, target, 1, undefined, 'tablet:uuid:kitchen');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[1]).toMatchObject({ duplicate: true });
  });
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
  it('preserves a durable payment marker when an unrelated classic fire starts from a stale store', async () => {
    const confirmed: PrintJob = { id: 'payment:original:kitchen', payload: ticket, status: 'confirmed', attempts: 1 };
    otherTabWrite([confirmed]); // L'autre document n'a pas mis à jour le store Zustand courant.
    expect(usePrintJobs.getState().jobs).toEqual([]);
    send.mockResolvedValue({ success: true });
    await runPrintJob({ ...ticket, order_number: 'CLASSIC' }, target);
    expect(readDurable()).toEqual(expect.arrayContaining([confirmed]));
    usePrintJobs.getState().jobs.splice(0); // Même retard d'état après un remount dans l'autre document.
    expect((await runPrintJob(ticket, target, 1, undefined, confirmed.id)).success).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('shows an existing unknown job to a stale tab without changing its journal or printing', async () => {
    const locks = installPrintLocks();
    const unknown: PrintJob = { id: 'payment:other-tab:kitchen', payload: ticket, status: 'unknown', attempts: 2, error: 'Acknowledgement lost' };
    otherTabWrite([unknown]);
    const saved = localStorage.getItem('breakery.print-jobs.v1');
    expect(usePrintJobs.getState().jobs).toEqual([]);
    const shown = vi.fn();
    const unsubscribe = usePrintJobs.subscribe((state) => {
      expect(locks.held.has('breakery.print-jobs.v1')).toBe(true);
      shown(state.jobs);
    });
    try {
      const result = await runPrintJob(ticket, target, 1, undefined, unknown.id);
      expect(result).toEqual({ success: false, error: unknown.error });
      expect(shown).toHaveBeenCalledWith([unknown]);
      expect(usePrintJobs.getState().jobs).toEqual([unknown]);
      expect(localStorage.getItem('breakery.print-jobs.v1')).toBe(saved);
      expect(send).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });
  it.each([true, false])('merges other-tab markers at completion, success=%s, and manual duplicate also rereads durable state', async (success) => {
    let finish!: (value: { success: boolean }) => void;
    send.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const running = runPrintJob(ticket, target, 1, undefined, 'tablet:running:kitchen');
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const other: PrintJob = { id: 'payment:other:kitchen', payload: ticket, status: 'confirmed', attempts: 1 };
    otherTabWrite([...readDurable(), other]);
    finish({ success }); await running;
    expect(readDurable()).toEqual(expect.arrayContaining([other]));
    const previous = readDurable().find((job) => job.id === 'tablet:running:kitchen')!;
    const newer: PrintJob = { ...other, id: 'payment:newer:kitchen' };
    otherTabWrite([...readDurable(), newer]);
    send.mockResolvedValue({ success: true });
    await runPrintJob({ ...ticket, order_number: 'Changed caller' }, target, 1, previous);
    expect(readDurable()).toEqual(expect.arrayContaining([other, newer]));
    expect(send.mock.calls[1]?.[1]).toMatchObject({ order_number: ticket.order_number, duplicate: true });
  });
  it('coordinates every mutation under the journal lock and refuses concurrent manual/automatic sends of one job', async () => {
    const locks = installPrintLocks();
    const original = localStorage.setItem.bind(localStorage);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'breakery.print-jobs.v1') expect(locks.held.has(key)).toBe(true);
      original(key, value);
    });
    let finish!: (value: { success: boolean }) => void;
    send.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const running = runPrintJob(ticket, target, 1, undefined, 'payment:locked:kitchen');
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const previous = readDurable()[0]!;
    expect((await runPrintJob(ticket, target, 1, previous)).success).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    finish({ success: true }); await running;
    await usePrintJobs.getState().put({ ...previous, id: 'external-writer', status: 'unknown' });
    expect(readDurable()).toHaveLength(2);
  });
  it('fails closed without locks or with a corrupt durable journal', async () => {
    Object.defineProperty(navigator, 'locks', { value: undefined });
    expect((await runPrintJob(ticket, target)).success).toBe(false);
    installPrintLocks(); localStorage.setItem('breakery.print-jobs.v1', '{');
    expect((await runPrintJob(ticket, target)).success).toBe(false);
    expect(localStorage.getItem('breakery.print-jobs.v1')).toBe('{'); expect(send).not.toHaveBeenCalled();
  });
  it('checks the current session again after the journal await and preserves the saved job when it changes', async () => {
    let current = true;
    const original = localStorage.setItem.bind(localStorage);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      original(key, value);
      if (key === 'breakery.print-jobs.v1') current = false;
    });
    const result = await runPrintJob(ticket, target, 1, undefined, 'payment:session:kitchen', () => current);
    expect(result.success).toBe(false); expect(send).not.toHaveBeenCalled();
    expect(readDurable()[0]).toMatchObject({ id: 'payment:session:kitchen', status: 'unknown', payload: ticket });
  });
});
