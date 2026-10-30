import { useState } from 'react';
import { Printer } from 'lucide-react';
import { Button, Sheet, SheetContent, SheetTitle, SheetDescription } from '@breakery/ui';
import { usePrintJobs, runPrintJob } from '@/services/print/printJobs';
import { useReceiptJobs, runReceiptJob } from '@/services/print/receiptJobs';
import { useStationPrinters } from './hooks/useStationPrinters';

export function PrintJobsPanel({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const receipts = useReceiptJobs((s) => s.jobs);
  const jobs = usePrintJobs((s) => s.jobs);
  const { data: printers } = useStationPrinters();
  const unresolved = jobs.filter((job) => job.status !== 'confirmed').length + receipts.filter((job) => job.status !== 'confirmed').length;
  const label = `Printing${unresolved > 0 ? ` · ${unresolved} to check` : ''}`;
  return <>
    <Button variant="ghost" size={compact ? 'icon' : 'md'}
      className={compact ? 'relative h-11 min-h-11 w-11 shrink-0 px-0' : 'w-full justify-start min-h-11'}
      aria-label={label} title={label} onClick={() => setOpen(true)}>
      {compact ? <>
        <Printer className="h-5 w-5" aria-hidden />
        {unresolved > 0 && <span aria-hidden className="absolute top-0 right-0 min-w-4 h-4 px-1 rounded-full bg-gold text-gold-fg text-xs font-mono">{unresolved}</span>}
      </> : label}
    </Button>
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
