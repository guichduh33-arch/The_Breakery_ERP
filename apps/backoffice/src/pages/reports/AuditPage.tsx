// apps/backoffice/src/pages/reports/AuditPage.tsx
//
// Lot G (campagne Reports 2026-08-15) — vague Journaux, page 1/5. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : PurchaseItemsPage).
//
// C'EST UN JOURNAL, PAS UN AGRÉGAT. Pas de bande de KPI : l'écran ne porte
// aucun compteur de synthèse, et en inventer un (« 312 entrées ») ne dirait
// rien — le nombre d'écritures d'audit d'une semaine n'est ni un objectif ni un
// signal. Pas de comparaison non plus : une trace ne se met pas en regard de la
// trace précédente, ligne à ligne. Le gain du lot est ailleurs — le shell, le
// TRI DE COLONNE, et des filtres au format du bandeau.
//
// CE QUI NE CHANGE PAS : la pagination par curseur (`get_audit_logs_v3`, pages
// de 50, « Load more » qui APPEND — jamais de `LIMIT 5000` ni d'offset, cf. fix
// 14-002) ; le dépliage par ligne montrant `metadata` ; le déclencheur de
// dépliage focusable posé au lot A2 ; les drill-downs entité et acteur ; et le
// lien profond `?action=` du hub Settings (« Settings History »), qui pré-remplit
// le filtre Action au lieu de déverser tout le flux.
//
// `audit_logs.payload` (la colonne de diff avant/après, S19) n'est TOUJOURS pas
// servie par `get_audit_logs_v3` : seul `metadata` est affichable ici. La
// surfacer demanderait un bump additif de la RPC — hors campagne.
//
// Params URL : `start` / `end` (bornes du socle) + `action` (lien profond).
// AUCUN repli legacy : cet écran n'avait PAS de bornes en URL — ses dates
// vivaient dans un `useState` de la barre de filtres, donc dans aucun lien
// partageable. Conséquence assumée et déclarée : la vue est désormais BORNÉE
// par défaut (fenêtre du socle) là où elle s'ouvrait sur le flux entier.
//
// LIMITE DU TRI, dite à l'écran : trier réordonne les lignes DÉJÀ CHARGÉES. Sur
// une liste à curseur, il ne peut pas en être autrement sans un ORDER BY
// serveur — que la RPC ne prend pas. Le sous-titre de la carte le dit ; il ne
// laisse pas croire que « le plus ancien » remonte tout l'historique.

import { Fragment, useMemo, useState, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@breakery/ui';
import type { CsvColumn } from '@breakery/domain';
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
import { useAuditLogs, type AuditLogRow } from '@/features/reports/hooks/useAuditLogs.js';
import {
  AuditLogFilters,
  EMPTY_AUDIT_LOG_FILTERS,
  type AuditLogFilterValues,
} from '@/features/reports/components/AuditLogFilters.js';

const csvColumns: CsvColumn<AuditLogRow>[] = [
  { header: 'Timestamp',   accessor: (r) => r.created_at,  format: 'datetime' },
  { header: 'Action',      accessor: (r) => r.action,      format: 'text' },
  { header: 'Entity Type', accessor: (r) => r.entity_type, format: 'text' },
  { header: 'Actor ID',    accessor: (r) => r.actor_id,    format: 'text' },
];

type SortKey = 'timestamp' | 'action' | 'entity' | 'actor';

// Défini au niveau module : l'objet entre dans les dépendances du tri.
const SORT_SPECS: Record<SortKey, SortSpec<AuditLogRow>> = {
  timestamp: { kind: 'date',   value: (r) => r.created_at },
  action:    { kind: 'string', value: (r) => r.action },
  entity:    { kind: 'string', value: (r) => r.entity_type },
  actor:     { kind: 'string', value: (r) => r.actor_id },
};

/** Entités pour lesquelles `buildDrilldownUrl` sait produire une cible. */
const LINKABLE = new Set(['product', 'order', 'expense', 'customer']);

function formatMetadata(metadata: unknown): string {
  if (metadata === null || metadata === undefined) return '—';
  try {
    return JSON.stringify(metadata, null, 2);
  } catch {
    return '[unserializable]';
  }
}

function EntityCell({ row }: { row: AuditLogRow }): JSX.Element {
  if (row.entity_id === null || !LINKABLE.has(row.entity_type)) {
    return <>{row.entity_type}</>;
  }
  return (
    <DrilldownLink
      entity={row.entity_type as 'product' | 'order' | 'expense' | 'customer'}
      id={row.entity_id}
      label={`${row.entity_type} ${row.entity_id.slice(0, 8)}`}
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
  const [expandedId, setExpandedId] = useState<number | null>(null);

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
  const sorted = useSortedRows(rows, SORT_SPECS);

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <AuditLogFilters value={filters} onChange={setFilters} />
      <ExportMenu
        csv={{ rows, columns: csvColumns, filename: `audit-log-${start}_${end}` }}
        pdf={{
          template: 'audit', data: rows,
          period: { start, end },
          filename: `audit-log-${start}_${end}`,
        }}
        disabled={rows.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Audit Log"
      subtitle={`${periodLabel(start, end)} · system-wide audit trail, newest first`}
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
        title="Audit entries"
        aside={
          <span className="font-data text-xs text-text-muted">
            {formatCount(rows.length)} loaded
          </span>
        }
        subtitle="Sorting reorders the entries loaded so far — load more to widen it."
        isLoading={isLoading}
        testId="audit-log-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Timestamp, action, entity and actor per audit entry, with an expandable context panel
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <th scope="col" className="w-8 py-2 text-left">
                  <span className="sr-only">Expand</span>
                </th>
                <SortableTh label="Timestamp" sortKey="timestamp" sorted={sorted} />
                <SortableTh label="Action"    sortKey="action"    sorted={sorted} />
                <SortableTh label="Entity"    sortKey="entity"    sorted={sorted} />
                <SortableTh label="Actor"     sortKey="actor"     sorted={sorted} />
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
                      <td className="py-2">{r.action}</td>
                      <td className="py-2"><EntityCell row={r} /></td>
                      <td className="py-2 text-xs text-text-secondary">
                        {r.actor_id !== null
                          ? <DrilldownLink entity="user" id={r.actor_id} label={r.actor_id.slice(0, 8)} icon={false} />
                          : '—'}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-border-subtle bg-surface-inert" data-testid={`audit-detail-${r.id}`}>
                        <td />
                        <td colSpan={4} className="py-2">
                          <div className="text-xs uppercase tracking-widest text-text-secondary">
                            Metadata (context)
                          </div>
                          <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-text-secondary">
                            {formatMetadata(r.metadata)}
                          </pre>
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
              variant="ghost"
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
