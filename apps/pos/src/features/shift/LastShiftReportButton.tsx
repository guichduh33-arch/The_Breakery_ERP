import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@breakery/ui';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/authStore';
import { lastClosedShift, printClosedShift } from './shiftClosePrinting';

export function LastShiftReportButton() {
  const actor = useAuthStore((s) => s.user?.id);
  const sessionId = lastClosedShift(actor);
  return sessionId ? <PrintButton sessionId={sessionId} /> : null;
}

function PrintButton({ sessionId }: { sessionId: string }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  return <Button variant="secondary" disabled={busy} onClick={() => {
    setBusy(true);
    void printClosedShift(sessionId, qc, true).then((result) => {
      if (!result.success) toast.warning('Report print unconfirmed — check Printing before reprinting');
    }).catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Report printing failed'))
      .finally(() => setBusy(false));
  }}>{busy ? 'Printing…' : 'Print last closing report'}</Button>;
}
