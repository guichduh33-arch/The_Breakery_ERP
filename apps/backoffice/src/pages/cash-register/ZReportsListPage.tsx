// apps/backoffice/src/pages/cash-register/ZReportsListPage.tsx
//
// S29 Wave 6.C.1 — list Z-Reports with status filter + date range + actions per row.

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from '@breakery/ui';
import { FileText, Loader2, Signature, XOctagon } from 'lucide-react';
import { useZReports, type ZReportStatus, type ZReportListRow } from '../../features/cash-register/hooks/useZReports.js';
import { useGenerateZReportPdf } from '../../features/cash-register/hooks/useGenerateZReportPdf.js';
import { SignZReportModal } from '../../features/cash-register/components/SignZReportModal.js';
import { VoidZReportModal } from '../../features/cash-register/components/VoidZReportModal.js';
import { DateRangePicker } from '../../features/reports/components/DateRangePicker.js';
import { useAuthStore } from '@/stores/authStore.js';

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return iso.slice(0, 16).replace('T', ' ');
}

function statusBadgeVariant(status: ZReportStatus): 'default' | 'secondary' | 'destructive' {
  if (status === 'signed')  return 'default';
  if (status === 'voided')  return 'destructive';
  return 'secondary';
}

export default function ZReportsListPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canSign = hasPermission('zreports.sign');
  const canVoid = hasPermission('zreports.void');

  const [status, setStatus]     = useState<ZReportStatus | 'all'>('all');
  const [startDate, setStart]   = useState<string>('');
  const [endDate, setEnd]       = useState<string>('');
  const [signOpen, setSignOpen] = useState<string | null>(null);
  const [voidOpen, setVoidOpen] = useState<string | null>(null);
  const [pendingPdfId, setPendingPdfId] = useState<string | null>(null);

  const filters: { status?: ZReportStatus; startDate?: string; endDate?: string } = {};
  if (status !== 'all')  filters.status    = status;
  if (startDate)         filters.startDate = startDate;
  if (endDate)           filters.endDate   = endDate;

  const { data: rows, isLoading, error } = useZReports(filters);
  const pdfMutation = useGenerateZReportPdf();

  const handleViewPdf = async (row: ZReportListRow): Promise<void> => {
    setPendingPdfId(row.id);
    try {
      const result = await pdfMutation.mutateAsync({ zreportId: row.id });
      if (result.signed_url) window.open(result.signed_url, '_blank', 'noopener,noreferrer');
    } finally {
      setPendingPdfId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif">Z-Reports</h1>
          <p className="text-sm text-text-secondary">
            End-of-shift archives. Retention: 7 years (Indonesia compliance).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ZReportStatus | 'all')}
            className="h-9 rounded-md border border-border-subtle bg-bg-base px-2 text-sm"
            data-testid="status-filter"
          >
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="signed">Signed</option>
            <option value="voided">Voided</option>
          </select>
          <DateRangePicker
            start={startDate}
            end={endDate}
            onStartChange={setStart}
            onEndChange={setEnd}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase tracking-widest text-text-secondary">
            Z-Reports
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-text-secondary">Loading…</p>}
          {error !== null && error !== undefined && (
            <p className="text-sm text-red-500" role="alert">
              {(error as Error).message ?? 'Failed to load Z-Reports.'}
            </p>
          )}
          {!isLoading && rows !== undefined && (
            <table className="w-full text-sm" aria-label="Z-Reports">
              <thead>
                <tr className="text-text-secondary border-b border-border-subtle">
                  <th className="py-2 text-left font-normal">Generated</th>
                  <th className="py-2 text-left font-normal">Signed at</th>
                  <th className="py-2 text-left font-normal">Status</th>
                  <th className="py-2 text-left font-normal">Signed by</th>
                  <th className="py-2 text-right font-normal">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-4 text-text-secondary">No Z-Reports found.</td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-b border-border-subtle">
                      <td className="py-2 tabular-nums">{formatDateTime(r.generated_at)}</td>
                      <td className="py-2 tabular-nums">{formatDateTime(r.signed_at)}</td>
                      <td className="py-2">
                        <Badge variant={statusBadgeVariant(r.status)}>{r.status}</Badge>
                      </td>
                      <td className="py-2 text-text-secondary">{r.signed_by_name ?? '—'}</td>
                      <td className="py-2 text-right space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleViewPdf(r)}
                          disabled={pendingPdfId === r.id}
                          data-testid={`view-pdf-${r.id}`}
                        >
                          {pendingPdfId === r.id
                            ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            : <FileText className="h-4 w-4 mr-1" />}
                          PDF
                        </Button>
                        {r.status === 'draft' && canSign && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSignOpen(r.id)}
                            data-testid={`sign-${r.id}`}
                          >
                            <Signature className="h-4 w-4 mr-1" />Sign
                          </Button>
                        )}
                        {r.status !== 'voided' && canVoid && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setVoidOpen(r.id)}
                            data-testid={`void-${r.id}`}
                          >
                            <XOctagon className="h-4 w-4 mr-1" />Void
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <SignZReportModal
        open={signOpen !== null}
        zreportId={signOpen}
        onOpenChange={(o) => { if (!o) setSignOpen(null); }}
      />
      <VoidZReportModal
        open={voidOpen !== null}
        zreportId={voidOpen}
        onOpenChange={(o) => { if (!o) setVoidOpen(null); }}
      />
    </div>
  );
}
