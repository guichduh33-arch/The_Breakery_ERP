import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PrinterTarget, StationTicketPayload } from '@breakery/domain';
import { printStationTicket } from './printService';
import { readPaymentAttempt } from '@/stores/paymentAttempt';

export interface PrintJob {
  id: string;
  payload: StationTicketPayload;
  status: 'pending' | 'confirmed' | 'unknown';
  error?: string;
  attempts: number;
}
const JOURNAL_KEY = 'breakery.print-jobs.v1';
interface PrintJobsState { jobs: PrintJob[]; put: (job: PrintJob) => Promise<void> }
export const usePrintJobs = create<PrintJobsState>()(persist((set) => ({
  jobs: [],
  put: (job) => withJob(job.id, () => withJournal((jobs) => { writeJob(jobs, job, set); })),
}), { name: JOURNAL_KEY, storage: createJSONStorage(() => localStorage) }));

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function readJobs(): PrintJob[] {
  const raw = localStorage.getItem(JOURNAL_KEY);
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.version !== 0 || !record(value.state) || !Array.isArray(value.state.jobs)
    || !value.state.jobs.every((job: unknown) => record(job) && typeof job.id === 'string' && record(job.payload)
      && typeof job.attempts === 'number' && Number.isInteger(job.attempts) && job.attempts > 0
      && (job.status === 'pending' || job.status === 'confirmed' || job.status === 'unknown')
      && (job.error === undefined || typeof job.error === 'string'))) {
    throw new Error('Print journal is invalid — check print jobs before reprinting');
  }
  return value.state.jobs as PrintJob[];
}
async function withJob<T>(id: string, work: () => Promise<T>): Promise<T> {
  if (!navigator.locks?.request) throw new Error('Secure print locking unavailable — check print jobs before reprinting');
  return await navigator.locks.request(`${JOURNAL_KEY}:job:${id}`, { mode: 'exclusive', ifAvailable: true }, (lock) => {
    if (!lock) throw new Error('This print job is being checked in another tab');
    return work();
  });
}
function withJournal<T>(work: (jobs: PrintJob[]) => T): Promise<T> {
  return navigator.locks.request(JOURNAL_KEY, { mode: 'exclusive' }, () => work(readJobs()));
}
function writeJob(jobs: PrintJob[], job: PrintJob, apply = usePrintJobs.setState): void {
  const attempt = readPaymentAttempt();
  const activePrefix = attempt ? `payment:${attempt.context.idempotencyKey}:` : null;
  const merged = [...jobs.filter((item) => item.id !== job.id), job].filter((item, index, all) =>
    item.id.startsWith('tablet:') || (activePrefix !== null && item.id.startsWith(activePrefix))
    || item.status !== 'confirmed' || index >= all.length - 50);
  apply({ jobs: merged });
  if (JSON.stringify(readJobs()) !== JSON.stringify(merged)) throw new Error('Print journal storage could not be verified');
}

/** Aucun appel de création de commande : ce journal ne fait qu'imprimer les snapshots. */
export async function runPrintJob(payload: StationTicketPayload, printer: PrinterTarget | undefined, copies = 1, previous?: PrintJob, automaticId?: string, current = () => true) {
  const id = previous?.id ?? automaticId ?? crypto.randomUUID();
  try {
    // Tous les appelants, y compris le geste manuel, coordonnent le même job.
    return await withJob(id, async () => {
      const claim = await withJournal<{ existing: PrintJob } | { job: PrintJob }>((jobs) => {
        if (!current()) throw new Error('Your session changed — check print jobs before reprinting');
        const existing = jobs.find((item) => item.id === id);
        if (automaticId && !previous && existing) {
          usePrintJobs.setState({ jobs });
          return { existing };
        }
        const original = previous ? existing ?? previous : undefined;
        const job: PrintJob = { id, payload: original?.payload ?? payload, status: 'pending', attempts: (original?.attempts ?? 0) + 1 };
        writeJob(jobs, job);
        return { job };
      });
      if ('existing' in claim) return { success: claim.existing.status === 'confirmed',
        ...(claim.existing.status !== 'confirmed' ? { error: claim.existing.error ?? 'Check the existing print job before reprinting' } : {}) };
      const job = claim.job;
      try {
        if (!printer) throw new Error('Printer not configured');
        for (let copy = 0; copy < copies; copy++) {
          if (!current()) throw new Error('Your session changed — check print jobs before reprinting');
          const result = await printStationTicket(printer, previous ? { ...job.payload, duplicate: true, server_name: `DUPLICATE · ${job.payload.server_name}` } : job.payload);
          if (!result.success) throw new Error(result.error ?? 'Printer acknowledgement unavailable');
        }
        await withJournal((jobs) => { writeJob(jobs, { ...job, status: 'confirmed' }); });
        return { success: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Print confirmation unavailable';
        // La relecture sous verrou conserve les jobs écrits pendant l'envoi matériel.
        try { await withJournal((jobs) => { writeJob(jobs, { ...job, status: 'unknown', error: message }); }); } catch { /* le pending durable interdit un renvoi automatique */ }
        return { success: false, error: message };
      }
    });
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Print confirmation unavailable' };
  }
}
