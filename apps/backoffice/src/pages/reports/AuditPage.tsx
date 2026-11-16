// Journal des audits métier et des gestes POS synchronisés.
// Pagination serveur commune et tri des lignes chargées.
// Le CSV recharge toute la période : il ne dépend pas de ce que l'écran a déroulé.
// Le contexte et le diff restent distincts dans les détails dépliables.

import { Fragment, useCallback, useMemo, useState, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/BackofficeUi.js';
import { formatDateTimeWita } from '@breakery/utils';
import { PanelCard } from '@/components/PanelCard.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { SortableTh } from '@/features/reports/components/SortableTh.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { useSortedRows, type SortSpec } from '@/features/reports/hooks/useSortedRows.js';
import { formatCount, periodLabel } from '@/features/reports/utils/reportFigures.js';
import { fetchAllAuditLogs, useAuditLogs, type AuditLogRow } from '@/features/reports/hooks/useAuditLogs.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { auditActorName, auditActionLabel, describeAuditLog } from '@/features/reports/utils/auditDescription.js';
import { auditEntityLabel } from '@/features/reports/utils/auditLabels.js';
import { DEFAULT_AUDIT_THRESHOLDS, auditEvidenceNote, auditReviewCue, auditSourceLabel } from '@/features/reports/utils/auditReview.js';
import { auditNumber, auditSafeDetails } from '@/features/reports/utils/auditValues.js';
import { AUDIT_CSV_COLUMNS, buildAuditExportRows, type AuditExportRow } from '@/features/reports/utils/auditExport.js';
import {
  AuditLogFilters,
  EMPTY_AUDIT_LOG_FILTERS,
  type AuditLogFilterValues,
} from '@/features/reports/components/AuditLogFilters.js';

// Jeu vide : le CSV passe toujours par `loadRows`, qui lit la période entière.
const NO_EXPORT_ROWS: AuditExportRow[] = [];

type SortKey = 'timestamp' | 'action' | 'entity' | 'actor';

// Défini au niveau module : l'objet entre dans les dépendances du tri.
const SORT_SPECS: Record<SortKey, SortSpec<AuditLogRow>> = {
  timestamp: { kind: 'date',   value: (r) => r.created_at },
  action:    { kind: 'string', value: (r) => auditActionLabel(r.action) },
  entity:    { kind: 'string', value: (r) => auditEntityLabel(r.entity_type) },
  actor:     { kind: 'string', value: auditActorName },
};

/** Entités pour lesquelles `buildDrilldownUrl` sait produire une cible. */
const ENTITY_LINKS: Record<string, 'product' | 'order' | 'expense' | 'customer'> = {
  product: 'product', products: 'product', order: 'order', orders: 'order',
  expense: 'expense', expenses: 'expense', customer: 'customer', customers: 'customer',
};

function EntityCell({ row }: { row: AuditLogRow }): JSX.Element {
  const entity = ENTITY_LINKS[row.entity_type];
  if (row.entity_id === null || !entity) {
    return <>{auditEntityLabel(row.entity_type)}</>;
  }
  return (
    <DrilldownLink
      entity={entity}
      id={row.entity_id}
      label={`${auditEntityLabel(row.entity_type)} ${row.entity_id.slice(0, 8)}`}
      icon={false}
    />
  );
}

export default function AuditPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end } = period;

  const [searchParams] = useSearchParams();
  // Le hub Settings pointe ici avec `?action=setting.update` (S73) : la tuile
  // « Settings History » atterrit pré-filtrée.
  const [filters, setFilters] = useState<AuditLogFilterValues>(() => ({
    ...EMPTY_AUDIT_LOG_FILTERS,
    action: searchParams.get('action') ?? '',
  }));
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // exactOptionalPropertyTypes : on ne pose la clé que si le filtre est non
  // vide — un `actorId: undefined` explicite est refusé, la clé doit être absente.
  const rpcFilters: Parameters<typeof useAuditLogs>[0] = { dateStart: start, dateEnd: end };
  if (filters.actorId !== '')    rpcFilters.actorId    = filters.actorId;
  if (filters.action !== '')     rpcFilters.action     = filters.action;
  if (filters.entityType !== '') rpcFilters.entityType = filters.entityType;

  const {
    data, isLoading, error, hasNextPage, isFetchingNextPage, fetchNextPage,
  } = useAuditLogs(rpcFilters);

  const rows = useMemo<AuditLogRow[]>(() => (data?.pages ?? []).flat(), [data]);

  // Le seuil d'écart de caisse suit le réglage existant ; sans droit de lecture
  // des réglages, la valeur par défaut s'applique.
  const posSettings = useSettings('pos');
  const refetchPosSettings = posSettings.refetch;
  const posSettingsData = posSettings.data;
  const { actorId, action, entityType } = filters;
  const loadExportRows = useCallback(async (): Promise<AuditExportRow[]> => {
    const all = await fetchAllAuditLogs({
      dateStart: start, dateEnd: end,
      ...(actorId !== '' ? { actorId } : {}),
      ...(action !== '' ? { action } : {}),
      ...(entityType !== '' ? { entityType } : {}),
    });
    // Le réglage est attendu avant l'export : la gravité ne dépend pas de l'état du cache.
    const settings = posSettingsData ?? (await refetchPosSettings()).data;
    const varianceAbs = auditNumber(settings?.settings.shift_variance_threshold_abs);
    return buildAuditExportRows(all, varianceAbs !== null && varianceAbs >= 0
      ? { ...DEFAULT_AUDIT_THRESHOLDS, varianceAbs } : DEFAULT_AUDIT_THRESHOLDS);
  }, [start, end, actorId, action, entityType, posSettingsData, refetchPosSettings]);
  const sorted = useSortedRows(rows, SORT_SPECS);

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <AuditLogFilters value={filters} onChange={setFilters} actors={rows} />
      <ExportMenu
        csv={{ rows: NO_EXPORT_ROWS, columns: AUDIT_CSV_COLUMNS, filename: `audit-log-${start}_${end}`, loadRows: loadExportRows }}
        pdf={{
          template: 'audit', data: rows.map((row) => ({
            id: row.id, created_at: row.created_at, action: row.action,
            entity_type: row.entity_type, entity_id: row.entity_id, actor_id: row.actor_id,
            description: describeAuditLog(row), actor_name: auditActorName(row),
            entity_label: auditEntityLabel(row.entity_type),
            actor_context: row.action === 'login.failed' ? 'Target account' : 'Recorded actor',
            source_label: auditSourceLabel(row.source), review_cue: auditReviewCue(row),
          })),
          period: { start, end },
          filename: `audit-log-${start}_${end}`,
        }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Activity & Control Log"
      subtitle={`${periodLabel(start, end)} · recorded business operations and device activity`}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Audit' }]}
      toolbar={toolbar}
      error={error}
      isEmpty={!isLoading && error === null && rows.length === 0}
      emptyState={{
        title: 'No audit entries',
        description: 'No audit entry was recorded for this period and these filters.',
      }}
    >
      <PanelCard
        title="Recorded events"
        aside={
          <span className="font-data text-xs text-text-muted">
            {formatCount(rows.length)} loaded
          </span>
        }
        subtitle="Server audits and device reports. Review cues prompt a check; they do not prove fraud. Sorting and PDF cover loaded entries; CSV exports the whole period."
        isLoading={isLoading}
        testId="audit-log-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Business time, event, record, account and evidence source, with expandable context and review cues
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="w-8 py-2 text-left">
                  <span className="sr-only">Expand</span>
                </th>
                <SortableTh label="Time (WITA)" sortKey="timestamp" sorted={sorted} />
                <SortableTh label="Event & context" sortKey="action" sorted={sorted} />
                <SortableTh label="Record" sortKey="entity" sorted={sorted} />
                <SortableTh label="Account" sortKey="actor" sorted={sorted} />
                <th scope="col" className="py-2 text-left">Source</th>
              </tr>
            </thead>
            <tbody>
              {sorted.rows.map((r) => {
                const expanded = expandedId === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr
                      className="cursor-pointer border-b border-border-subtle hover:bg-surface-4"
                      onClick={() => { setExpandedId(expanded ? null : r.id); }}
                      data-testid={`audit-row-${r.id}`}
                    >
                      <td className="py-2 text-text-secondary">
                        {/* Lot A2 — la ligne dépliable n'était atteignable qu'à
                            la souris : le chevron est un vrai bouton focusable. */}
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={expanded ? 'Collapse entry details' : 'Expand entry details'}
                          data-testid={`audit-toggle-${r.id}`}
                          className="flex h-6 w-6 items-center justify-center rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
                          onClick={(e) => { e.stopPropagation(); setExpandedId(expanded ? null : r.id); }}
                        >
                          {expanded
                            ? <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                            : <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                        </button>
                      </td>
                      <td className="py-2 font-data tabular-nums text-text-secondary">
                        {formatDateTimeWita(r.created_at)}
                      </td>
                      <td className="py-2">
                        <div>{describeAuditLog(r)}</div>
                        {auditReviewCue(r) && <p className="mt-1 text-xs text-warning">Review cue: {auditReviewCue(r)}</p>}
                        <div className="text-xs text-text-muted">{r.action}</div>
                      </td>
                      <td className="py-2"><EntityCell row={r} /></td>
                      <td className="py-2 text-xs text-text-secondary">
                        {r.actor_id !== null
                          ? <DrilldownLink entity="user" id={r.actor_id} label={auditActorName(r)} icon={false} />
                          : auditActorName(r)}
                        {r.action === 'login.failed' && <div className="mt-1 text-xs text-text-muted">Target account</div>}
                      </td>
                      <td className="py-2 text-xs text-text-secondary">{auditSourceLabel(r.source)}</td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-border-subtle bg-surface-inert" data-testid={`audit-detail-${r.id}`}>
                        <td />
                        <td colSpan={5} className="py-2">
                          <p className="mb-2 text-sm">{describeAuditLog(r)}</p>
                          <p className="mb-2 text-xs text-text-secondary">{auditEvidenceNote(r)}</p>
                          <div className="font-data font-semibold text-xs uppercase tracking-widest text-text-secondary">
                            Recorded context
                          </div>
                          <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-text-secondary">
                            {auditSafeDetails(r.metadata)}
                          </pre>
                          {r.payload != null && (
                            <>
                              <div className="mt-3 font-data text-xs font-semibold uppercase tracking-widest text-text-secondary">Changes / event details</div>
                              <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-text-secondary">{auditSafeDetails(r.payload)}</pre>
                            </>
                          )}
                          <p className="mt-2 text-xs text-text-muted">Event reference {r.id} · Record reference {r.entity_id ?? 'Not recorded'} · Account reference {r.actor_id ?? 'Not recorded'}</p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {hasNextPage && (
          <div className="flex justify-center pt-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={isFetchingNextPage}
              onClick={() => { void fetchNextPage(); }}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </PanelCard>
    </ReportShell>
  );
}
