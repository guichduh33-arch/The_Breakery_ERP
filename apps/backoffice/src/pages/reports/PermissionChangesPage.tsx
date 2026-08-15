// apps/backoffice/src/pages/reports/PermissionChangesPage.tsx
//
// Lot G (campagne Reports 2026-08-15) — vague Journaux, page 4/5. Migrée sur le
// socle Report shell v2 (archétype maquette 4c, patron : PurchaseItemsPage).
//
// C'EST LA TRACE DES DROITS : qui a accordé ou retiré quelle permission à quel
// rôle, et quand. Pas de bande de KPI — compter les octrois d'une période ne
// dit rien —, et pas de comparaison : une révocation ne se met pas en regard de
// celle du mois dernier.
//
// CE QUI NE CHANGE PAS : les lignes viennent de `get_permission_changes_v1` et
// sont servies telles quelles ; la pastille d'action garde son code couleur
// (accordé = vert, révoqué = rouge, le reste neutre) ; `detail` reste rendu
// brut, en `<code>` — c'est un contexte libre, il n'a ni schéma ni ordre.
//
// PAS DE LIEN VERS LA LIGNE D'AUDIT : la RPC ne sert AUCUN identifiant
// d'`audit_logs` (les champs sont `changed_at`, `actor_name`, `action`,
// `role_code`, `permission_code`, `detail`). Il n'y avait donc rien à conserver
// ici, et rien ne peut être posé sans un bump additif de la RPC — hors campagne.
// Le drill-down acteur est dans le même cas : `actor_name` est un LIBELLÉ, pas
// un id ; `DrilldownLink` rendrait un lien mort.
//
// Params URL : `start` / `end` — les bornes portaient DÉJÀ les noms du socle
// (`useUrlState('start'/'end')`), aucun repli legacy n'est nécessaire. Seul le
// défaut change : 29 jours maison → 28 jours du socle.

import { useMemo, type JSX } from 'react';
import { cn } from '@breakery/ui';
import type { CsvColumn } from '@breakery/domain';
import { PanelCard } from '@/components/PanelCard.js';
import { ReportShell } from '@/features/reports/components/ReportShell.js';
import { PeriodControl } from '@/features/reports/components/PeriodControl.js';
import { ExportMenu } from '@/features/reports/components/ExportMenu.js';
import { SortableTh } from '@/features/reports/components/SortableTh.js';
import { useReportPeriod } from '@/features/reports/hooks/useReportPeriod.js';
import { useSortedRows, type SortSpec } from '@/features/reports/hooks/useSortedRows.js';
import { periodLabel } from '@/features/reports/utils/reportFigures.js';
import {
  usePermissionChanges,
  type PermissionChangeLine,
} from '@/features/reports/hooks/usePermissionChanges.js';

const csvColumns: CsvColumn<PermissionChangeLine>[] = [
  { header: 'Date',       accessor: (r) => r.changed_at.slice(0, 10), format: 'text' },
  { header: 'Actor',      accessor: (r) => r.actor_name,              format: 'text' },
  { header: 'Action',     accessor: (r) => r.action,                  format: 'text' },
  { header: 'Role',       accessor: (r) => r.role_code ?? '',         format: 'text' },
  { header: 'Permission', accessor: (r) => r.permission_code ?? '',   format: 'text' },
  { header: 'Detail',     accessor: (r) => JSON.stringify(r.detail),  format: 'text' },
];

type SortKey = 'date' | 'actor' | 'action' | 'role' | 'permission';

const SORT_SPECS: Record<SortKey, SortSpec<PermissionChangeLine>> = {
  date:       { kind: 'date',   value: (r) => r.changed_at },
  actor:      { kind: 'string', value: (r) => r.actor_name },
  action:     { kind: 'string', value: (r) => r.action },
  role:       { kind: 'string', value: (r) => r.role_code },
  permission: { kind: 'string', value: (r) => r.permission_code },
};

/** Pastille d'action — un octroi et une révocation ne se lisent pas au même
 *  rythme, la couleur porte le sens avant le mot. */
function ActionBadge({ action }: { action: string }): JSX.Element {
  const lower = action.toLowerCase();
  const tone = lower.includes('grant')
    ? 'bg-success-soft text-success'
    : lower.includes('revoke')
      ? 'bg-danger-soft text-danger'
      : 'bg-surface-4 text-text-secondary';
  return (
    <span className={cn('inline-flex rounded px-1.5 py-0.5 text-xs font-medium', tone)}>
      {action}
    </span>
  );
}

export default function PermissionChangesPage(): JSX.Element {
  const period = useReportPeriod();
  const { start, end } = period;

  const { data, isLoading, error } = usePermissionChanges({ start, end });

  const changes = useMemo(() => data?.changes ?? [], [data]);
  const sorted = useSortedRows(changes, SORT_SPECS);
  const truncated = data?.truncated === true;

  const toolbar = (
    <>
      <PeriodControl period={period} />
      <ExportMenu
        csv={{ rows: changes, columns: csvColumns, filename: `permission-changes-${start}_${end}` }}
        disabled={changes.length === 0}
      />
    </>
  );

  return (
    <ReportShell
      title="Permission Change Log"
      subtitle={`${periodLabel(start, end)} · grants and revocations, newest first`}
      breadcrumb={[{ label: 'Reports', to: '/backoffice/reports' }, { label: 'Audit' }]}
      toolbar={toolbar}
      error={error}
      isEmpty={!isLoading && error === null && data !== undefined && changes.length === 0}
      emptyState={{
        title: 'No permission changes',
        description: 'No permission was granted or revoked over this period.',
      }}
    >
      {truncated && (
        <p role="status" className="rounded-sm border border-warning bg-warning-soft px-4 py-2 text-sm text-warning">
          First 500 rows shown — narrow the date range to see all changes.
        </p>
      )}

      <PanelCard
        title="Permission changes"
        className={truncated ? 'mt-3' : ''}
        subtitle="One line per grant or revocation, with its author and its context."
        isLoading={isLoading}
        testId="permission-changes-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Date, actor, action, role, permission and free-form detail per permission change
            </caption>
            <thead>
              <tr className="border-b border-border-subtle text-text-secondary">
                <SortableTh label="Date"       sortKey="date"       sorted={sorted} />
                <SortableTh label="Actor"      sortKey="actor"      sorted={sorted} />
                <SortableTh label="Action"     sortKey="action"     sorted={sorted} />
                <SortableTh label="Role"       sortKey="role"       sorted={sorted} />
                <SortableTh label="Permission" sortKey="permission" sorted={sorted} />
                {/* `detail` est un contexte libre : il n'a pas d'ordre. */}
                <SortableTh label="Detail"                          sorted={sorted} />
              </tr>
            </thead>
            <tbody>
              {sorted.rows.map((r, idx) => (
                <tr key={`${r.changed_at}-${idx}`} className="border-b border-border-subtle">
                  <td className="whitespace-nowrap py-2 font-data text-xs text-text-secondary">
                    {r.changed_at.slice(0, 10)}
                  </td>
                  <td className="py-2">{r.actor_name}</td>
                  <td className="py-2"><ActionBadge action={r.action} /></td>
                  <td className="py-2 text-text-secondary">{r.role_code ?? '—'}</td>
                  <td className="py-2 text-text-secondary">{r.permission_code ?? '—'}</td>
                  <td className="py-2">
                    {r.detail !== null && r.detail !== undefined ? (
                      <code className="break-all rounded bg-surface-4 px-1 py-0.5 text-xs text-text-secondary">
                        {JSON.stringify(r.detail)}
                      </code>
                    ) : (
                      <span className="text-text-secondary">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCard>
    </ReportShell>
  );
}
