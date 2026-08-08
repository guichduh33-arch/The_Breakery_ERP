// apps/backoffice/src/pages/cash-register/ZReportsListPage.tsx
//
// Archétype LIST (direction « Instrument ») — les archives de fin de service.
//
// Refonte 2026-08-07. L'écran précédent était une table écrite à la main dans
// une Card, sous un titre en Playfair, avec un `<select>` de statut posé dans le
// bandeau. Trois choses changent, et aucune n'est cosmétique :
//
//   · Les compteurs SONT les filtres. Un `<select>` cache le nombre de rapports
//     dans chaque état ; la bande le montre et le rend cliquable d'un geste.
//   · Attendu / compté / ÉCART entrent dans la liste. C'est le cœur de la
//     refonte : signer est irréversible, donc l'écart doit être lisible AVANT
//     la signature. Le lire dans le PDF après coup ne protège personne.
//   · La table passe au DataTable partagé — en-tête sur remplissage inerte,
//     libellés mono, pied toujours rendu, état vide correct.
//
// Les trois actions de ligne (PDF, signer, annuler) et leurs testids sont
// conservés tels quels : la refonte porte sur la lecture, pas sur les gestes.

import { useMemo, useState, type JSX } from 'react';
import { FileDown, FileText, Loader2, Signature, XOctagon } from 'lucide-react';
import { Badge, DataTable, type DataTableColumn } from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { PageHeader } from '@/components/PageHeader.js';
import { ListCounterStrip, type ListCounter } from '@/components/ListCounterStrip.js';
import { TOOLBAR_BTN_SECONDARY, TOOLBAR_ICON } from '@/components/toolbarButton.js';
import { useZReports, type ZReportStatus, type ZReportListRow } from '../../features/cash-register/hooks/useZReports.js';
import { useGenerateZReportPdf } from '../../features/cash-register/hooks/useGenerateZReportPdf.js';
import { SignZReportModal } from '../../features/cash-register/components/SignZReportModal.js';
import { VoidZReportModal } from '../../features/cash-register/components/VoidZReportModal.js';
import { DateRangePicker } from '../../features/reports/components/DateRangePicker.js';
import { useAuthStore } from '@/stores/authStore.js';

function formatDateTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—';
  return iso.slice(0, 16).replace('T', ' ');
}

/** Un montant absent n'est pas un montant nul — il se rend en tiret. */
function money(value: number | null): string {
  return value === null ? '—' : formatIdr(value);
}

function statusBadgeVariant(status: ZReportStatus): 'default' | 'secondary' | 'destructive' {
  if (status === 'signed') return 'default';
  if (status === 'voided') return 'destructive';
  return 'secondary';
}

/** L'écart porte sa couleur : nul = neutre, non nul = alerte, inconnu = muet. */
function varianceTone(value: number | null): string {
  if (value === null) return 'text-text-muted';
  if (Math.abs(value) < 0.005) return 'text-text-primary';
  return 'text-danger';
}

function signedVariance(value: number | null): string {
  if (value === null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatIdr(value)}`;
}

type StatusFilter = ZReportStatus | 'all';

export default function ZReportsListPage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canSign = hasPermission('zreports.sign');
  const canVoid = hasPermission('zreports.void');

  const [status, setStatus] = useState<StatusFilter>('all');
  const [startDate, setStart] = useState<string>('');
  const [endDate, setEnd] = useState<string>('');
  const [signOpen, setSignOpen] = useState<string | null>(null);
  const [voidOpen, setVoidOpen] = useState<string | null>(null);
  const [pendingPdfId, setPendingPdfId] = useState<string | null>(null);

  // La plage de dates est envoyée au serveur ; le statut est filtré ICI, pour
  // que les compteurs restent stables quand on en sélectionne un. Un compteur
  // qui se recalcule sur son propre filtre afficherait « Signed 12 » puis
  // « Signed 12, Draft 0 » — il ne compterait plus rien d'utile.
  const dateFilters: { startDate?: string; endDate?: string } = {};
  if (startDate !== '') dateFilters.startDate = startDate;
  if (endDate !== '') dateFilters.endDate = endDate;

  const { data, isLoading, error } = useZReports(dateFilters);
  const pdfMutation = useGenerateZReportPdf();

  const allRows = useMemo(() => data ?? [], [data]);
  const rows = useMemo(
    () => (status === 'all' ? allRows : allRows.filter((r) => r.status === status)),
    [allRows, status],
  );

  const counters = useMemo<ListCounter[]>(() => {
    const by = (s: ZReportStatus): number => allRows.filter((r) => r.status === s).length;
    // Un rapport non signé dont l'écart est non nul est ce que cet écran sert à
    // attraper. Il ne filtre pas — c'est un signal, et il vaut pour la période
    // affichée, pas pour le filtre de statut courant.
    const unresolved = allRows.filter(
      (r) => r.status === 'draft' && r.variance_total !== null && Math.abs(r.variance_total) >= 0.005,
    ).length;

    return [
      { id: 'all', label: 'All reports', value: allRows.length, onSelect: () => { setStatus('all'); } },
      { id: 'draft', label: 'Draft', value: by('draft'), tone: by('draft') > 0 ? 'warning' : 'neutral', onSelect: () => { setStatus('draft'); } },
      { id: 'signed', label: 'Signed', value: by('signed'), tone: 'success', onSelect: () => { setStatus('signed'); } },
      { id: 'voided', label: 'Voided', value: by('voided'), onSelect: () => { setStatus('voided'); } },
      {
        id: 'unresolved',
        label: 'Unsigned w/ variance',
        value: unresolved,
        tone: unresolved > 0 ? 'danger' : 'neutral',
        title: 'Drafts whose cash count does not match the expected amount. Signing is irreversible — resolve these first.',
      },
    ];
  }, [allRows]);

  const handleViewPdf = async (row: ZReportListRow): Promise<void> => {
    setPendingPdfId(row.id);
    try {
      const result = await pdfMutation.mutateAsync({ zreportId: row.id });
      if (result.signed_url !== null && result.signed_url !== undefined && result.signed_url !== '') {
        window.open(result.signed_url, '_blank', 'noopener,noreferrer');
      }
    } finally {
      setPendingPdfId(null);
    }
  };

  const columns: DataTableColumn<ZReportListRow>[] = [
    {
      id: 'generated_at',
      header: 'Generated',
      render: (r) => <span className="font-data text-[12.5px] tabular-nums">{formatDateTime(r.generated_at)}</span>,
    },
    {
      id: 'expected_cash',
      header: 'Declared',
      align: 'right',
      render: (r) => <span className="font-data text-[12.5px]">{money(r.expected_cash)}</span>,
    },
    {
      id: 'counted_cash',
      header: 'Counted',
      align: 'right',
      render: (r) => <span className="font-data text-[12.5px]">{money(r.counted_cash)}</span>,
    },
    {
      id: 'variance_total',
      header: 'Variance',
      align: 'right',
      render: (r) => (
        <span className={`font-data text-[12.5px] font-semibold ${varianceTone(r.variance_total)}`}>
          {signedVariance(r.variance_total)}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      render: (r) => <Badge variant={statusBadgeVariant(r.status)}>{r.status}</Badge>,
    },
    {
      id: 'signed',
      header: 'Signed',
      render: (r) => (
        <span className="text-[12.5px] text-text-secondary">
          {r.signed_by_name ?? '—'}
          {r.signed_at !== null && (
            <span className="ml-2 font-data text-[11px] text-text-muted tabular-nums">
              {formatDateTime(r.signed_at)}
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => { void handleViewPdf(r); }}
            disabled={pendingPdfId === r.id}
            data-testid={`view-pdf-${r.id}`}
            className={TOOLBAR_BTN_SECONDARY}
          >
            {pendingPdfId === r.id
              ? <Loader2 className={`${TOOLBAR_ICON} animate-pulse motion-reduce:animate-none`} aria-hidden />
              : <FileText className={TOOLBAR_ICON} aria-hidden />}
            PDF
          </button>
          {r.status === 'draft' && canSign && (
            <button
              type="button"
              onClick={() => { setSignOpen(r.id); }}
              data-testid={`sign-${r.id}`}
              className={TOOLBAR_BTN_SECONDARY}
            >
              <Signature className={TOOLBAR_ICON} aria-hidden />Sign
            </button>
          )}
          {r.status !== 'voided' && canVoid && (
            <button
              type="button"
              onClick={() => { setVoidOpen(r.id); }}
              data-testid={`void-${r.id}`}
              className={TOOLBAR_BTN_SECONDARY}
            >
              <XOctagon className={TOOLBAR_ICON} aria-hidden />Void
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-[13px]">
      <PageHeader
        title="Z-Reports"
        subtitle="End-of-shift archives. Signing is irreversible — check the variance first. Retention: 7 years (Indonesia compliance)."
        actions={
          <>
            <DateRangePicker
              start={startDate}
              end={endDate}
              onStartChange={setStart}
              onEndChange={setEnd}
            />
            <button type="button" className={TOOLBAR_BTN_SECONDARY} data-testid="export-zreports" disabled>
              <FileDown className={TOOLBAR_ICON} aria-hidden />Export
            </button>
          </>
        }
      />

      <ListCounterStrip
        counters={counters}
        activeId={status}
        ariaLabel="Z-Report status filters"
        data-testid="zreports-counters"
      />

      {error !== null && error !== undefined ? (
        <p className="text-sm text-danger" role="alert">
          {error.message === '' ? 'Failed to load Z-Reports.' : error.message}
        </p>
      ) : (
        <DataTable<ZReportListRow>
          columns={columns}
          rows={rows}
          getRowKey={(r) => r.id}
          isLoading={isLoading}
          density="compact"
          emptyTitle="No Z-Reports found"
          emptyDescription={
            status === 'all'
              ? 'Z-Reports appear here once a shift is closed.'
              : `No report in the “${status}” state for this period.`
          }
          data-testid="zreports-table"
          footer={
            <span className="font-data text-[11px] text-text-muted tabular-nums">
              {rows.length} of {allRows.length}
              {status !== 'all' && ` · ${status}`}
            </span>
          }
        />
      )}

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
