// apps/backoffice/src/pages/print-queue/PrintQueuePage.tsx
// Session 13 / Phase 5.A — operator view of active print jobs.

import { PrintQueueTable } from '@/features/print-queue/components/PrintQueueTable.js';

export default function PrintQueuePage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-serif">Print Queue</h1>
        <p className="text-sm text-text-secondary">
          Active jobs across all printers — queued, printing, and failed
          tickets. Use the cancel action to drop a stuck row.
        </p>
      </header>
      <PrintQueueTable />
    </div>
  );
}
