import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PrinterTarget, StationTicketPayload } from '@breakery/domain';
import { printStationTicket } from './printService';

export interface PrintJob {
  id: string;
  payload: StationTicketPayload;
  status: 'pending' | 'confirmed' | 'unknown';
  error?: string;
  attempts: number;
}
interface PrintJobsState { jobs: PrintJob[]; put: (job: PrintJob) => void }
export const usePrintJobs = create<PrintJobsState>()(persist((set) => ({
  jobs: [],
  put: (job) => set((s) => ({ jobs: [...s.jobs.filter((item) => item.id !== job.id), job].filter((item, index, all) => item.status !== 'confirmed' || index >= all.length - 50) })),
}), { name: 'breakery.print-jobs.v1', storage: createJSONStorage(() => localStorage) }));

/** Aucun appel de création de commande : ce journal ne fait qu'imprimer les snapshots. */
export async function runPrintJob(payload: StationTicketPayload, printer: PrinterTarget | undefined, copies = 1, previous?: PrintJob) {
  const job: PrintJob = { id: previous?.id ?? crypto.randomUUID(), payload, status: 'pending', attempts: (previous?.attempts ?? 0) + 1 };
  try {
    usePrintJobs.getState().put(job);
    if (!printer) throw new Error('Printer not configured');
    for (let copy = 0; copy < copies; copy++) {
      const result = await printStationTicket(printer, previous ? { ...payload, duplicate: true, server_name: `DUPLICATE · ${payload.server_name}` } : payload);
      if (!result.success) throw new Error(result.error ?? 'Printer acknowledgement unavailable');
    }
    usePrintJobs.getState().put({ ...job, status: 'confirmed' });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Print confirmation unavailable';
    try { usePrintJobs.getState().put({ ...job, status: 'unknown', error: message }); } catch { /* l'état en mémoire reste disponible */ }
    return { success: false, error: message };
  }
}
