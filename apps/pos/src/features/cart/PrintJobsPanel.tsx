import { useState } from 'react';
import { Button, Sheet, SheetContent, SheetTitle, SheetDescription } from '@breakery/ui';
import { usePrintJobs, runPrintJob } from '@/services/print/printJobs';
import { useReceiptJobs, runReceiptJob } from '@/services/print/receiptJobs';
import { useStationPrinters } from './hooks/useStationPrinters';

export function PrintJobsPanel() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const receipts = useReceiptJobs((s) => s.jobs);
  const jobs = usePrintJobs((s) => s.jobs);
  const { data: printers } = useStationPrinters();
  const unresolved = jobs.filter((job) => job.status !== 'confirmed').length + receipts.filter((job) => job.status !== 'confirmed').length;
  return <>
    <Button variant="ghost" className="w-full justify-start min-h-11" onClick={() => setOpen(true)}>Printing {unresolved > 0 ? `· ${unresolved} to check` : ''}</Button>
    <Sheet open={open} onOpenChange={setOpen}><SheetContent className="theme-pos w-full sm:max-w-lg overflow-y-auto bg-bg-base text-text-primary">
      <SheetTitle>Printing</SheetTitle><SheetDescription>Orders are saved separately. Reprints are marked as duplicates.</SheetDescription>
      <div className="space-y-3 py-4">{jobs.length === 0 && receipts.length === 0 && <p>No print jobs on this terminal yet.</p>}
        {[...receipts].reverse().map((job) => <div key={job.id} className="p-3 border border-border-subtle rounded-md space-y-2">
          <p className="font-semibold break-words">{job.payload.order.order_number} · Receipt</p>
          <p className={job.status === 'confirmed' ? 'text-text-secondary' : 'text-gold'}>{job.status === 'confirmed' ? 'Printer acknowledged' : 'Print to verify'}{job.error ? ` — ${job.error}` : ''}</p>
          <Button variant="secondary" disabled={busy !== null} onClick={() => {
            setBusy(job.id);
            void runReceiptJob(job.payload, printers?.get('cashier')).finally(() => setBusy(null));
          }}>{busy === job.id ? 'Printing…' : 'Reprint duplicate'}</Button>
        </div>)}
        {[...jobs].reverse().map((job) => <div key={job.id} className="p-3 border border-border-subtle rounded-md space-y-2">
          <p className="font-semibold break-words">{job.payload.order_number} · {job.payload.role}</p>
          <p className={job.status === 'confirmed' ? 'text-text-secondary' : 'text-gold'}>{job.status === 'confirmed' ? 'Printer acknowledged' : 'Print to verify'}{job.error ? ` — ${job.error}` : ''}</p>
          <Button variant="secondary" disabled={busy !== null} onClick={() => {
            setBusy(job.id);
            void runPrintJob(job.payload, printers?.get(job.payload.role), 1, job).finally(() => setBusy(null));
          }}>{busy === job.id ? 'Printing…' : 'Reprint duplicate'}</Button>
        </div>)}
      </div>
    </SheetContent></Sheet>
  </>;
}
