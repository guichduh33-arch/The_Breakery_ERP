// apps/backoffice/src/pages/print-queue/PrintQueuePage.tsx
// Session 14 / Phase 6.A — operator view of active print jobs, with KPI strip
// (Total / Queued / Printing / Failed) wrapped in a Card.

import { useMemo } from 'react';
import { Printer, Clock, Activity, AlertOctagon } from 'lucide-react';
import { Card, KpiTile } from '@breakery/ui';
import { PrintQueueTable } from '@/features/print-queue/components/PrintQueueTable.js';
import { usePrintQueue } from '@/features/print-queue/hooks/usePrintQueue.js';

export default function PrintQueuePage() {
  const { data } = usePrintQueue();
  const rows = data ?? [];

  const kpis = useMemo(() => {
    let queued = 0;
    let printing = 0;
    let failed = 0;
    for (const r of rows) {
      if (r.status === 'queued')   queued++;
      if (r.status === 'printing') printing++;
      if (r.status === 'failed')   failed++;
    }
    return { total: rows.length, queued, printing, failed };
  }, [rows]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-serif">Print Queue</h1>
        <p className="text-sm text-text-secondary">
          Active jobs across all printers — queued, printing, and failed
          tickets. Use the cancel action to drop a stuck row.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile label="Total active" value={kpis.total}    icon={Printer}      footer="Across all printers" />
        <KpiTile label="Queued"       value={kpis.queued}   icon={Clock}        footer="Waiting for a printer" />
        <KpiTile label="Printing"     value={kpis.printing} icon={Activity}     footer="In flight right now" />
        <KpiTile label="Failed"       value={kpis.failed}   icon={AlertOctagon} footer="Need intervention" />
      </div>

      <Card padding="md">
        <PrintQueueTable />
      </Card>
    </div>
  );
}
