import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { PrinterTarget, ReceiptPayload } from '@breakery/domain';
import { printReceipt } from './printService';

export interface ReceiptJob {
  id: string;
  payload: ReceiptPayload;
  status: 'pending' | 'confirmed' | 'unknown';
  attempts: number;
  error?: string;
}
interface ReceiptJobsState { jobs: ReceiptJob[]; put: (job: ReceiptJob) => void }
export const useReceiptJobs = create<ReceiptJobsState>()(persist((set) => ({
  jobs: [],
  put: (job) => set((s) => ({ jobs: [...s.jobs.filter((item) => item.id !== job.id), job]
    .filter((item, index, all) => item.status !== 'confirmed' || index >= all.length - 50) })),
}), { name: 'breakery.receipt-jobs.v1', storage: createJSONStorage(() => localStorage) }));

/** Store the original receipt before printing. Retrying only prints that snapshot. */
export async function runReceiptJob(payload: ReceiptPayload, printer?: PrinterTarget) {
  const id = payload.order.id ?? payload.order.order_number;
  const previous = useReceiptJobs.getState().jobs.find((job) => job.id === id);
  const job: ReceiptJob = { id, payload: previous?.payload ?? payload, status: 'pending', attempts: (previous?.attempts ?? 0) + 1 };
  try {
    useReceiptJobs.getState().put(job);
    // The template header also marks duplicates on older print bridges.
    const receipt = previous ? { ...job.payload, template: { ...job.payload.template, header: `*** DUPLICATE ***\n${job.payload.template?.header ?? ''}` } } : job.payload;
    const result = await printReceipt(receipt, printer);
    if (!result.success) throw new Error(result.error ?? 'Printer acknowledgement unavailable');
    useReceiptJobs.getState().put({ ...job, status: 'confirmed' });
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Receipt confirmation unavailable';
    try { useReceiptJobs.getState().put({ ...job, status: 'unknown', error: message }); } catch { /* retain the in-memory job */ }
    return { success: false, error: message };
  }
}
