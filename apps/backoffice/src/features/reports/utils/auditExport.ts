// Export CSV du journal. Les 13 premières colonnes sont historiques : des classeurs
// s'appuient sur leur nom et leur ordre, elles ne bougent pas. Toute nouvelle
// colonne s'ajoute À DROITE, une valeur par case, vide quand la trace ne la porte pas.
import type { CsvColumn } from '@breakery/domain';
import { formatIsoWita } from '@breakery/utils';
import type { AuditLogRow } from '../hooks/useAuditLogs.js';
import { auditActorName, auditActionLabel, describeAuditLog } from './auditDescription.js';
import { auditEntityLabel } from './auditLabels.js';
import {
  DEFAULT_AUDIT_THRESHOLDS, auditEvidenceCode, auditEvidenceNote, auditReviewCue, auditSourceLabel,
  type AuditThresholds,
} from './auditReview.js';
import { auditFields, buildOrderLinks, linkAuditFields, type AuditFields } from './auditFields.js';
import { buildAuditSignals, type AuditSignal } from './auditSignals.js';

export interface AuditExportRow {
  row: AuditLogRow;
  fields: AuditFields & { linkKey: string | null };
  signal: AuditSignal;
  /** Rang chronologique dans l'export : 1 = l'événement le plus ancien. */
  sequence: number;
}

/**
 * Prépare les lignes d'export. `rows` doit être le jeu COMPLET de la période,
 * dans l'ordre du serveur (du plus récent au plus ancien, identifiant en départage).
 */
export function buildAuditExportRows(
  rows: readonly AuditLogRow[],
  thresholds: AuditThresholds = DEFAULT_AUDIT_THRESHOLDS,
): AuditExportRow[] {
  const links = buildOrderLinks(rows);
  const signals = buildAuditSignals(rows, thresholds);
  return rows.map((row, index) => ({
    row,
    fields: linkAuditFields(auditFields(row), links),
    signal: signals.get(row.id) ?? { severity: null, group: null, groupSize: null },
    sequence: rows.length - index,
  }));
}

const SEVERITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;

// Une valeur chiffrée sort en nombre : en texte, un « -3 » recevrait l'apostrophe
// qui protège le tableur des formules et ne se lirait plus comme une quantité.
function numberOrText(value: string | null): string | number | null {
  if (value === null || !/^-?\d+(?:\.\d+)?$/.test(value)) return value;
  return Number(value);
}

export const AUDIT_LEGACY_HEADERS = [
  'Event reference', 'Timestamp', 'Event', 'Action code', 'Description', 'Account',
  'Account role in event', 'Source', 'Record type', 'Record ID', 'Review cue', 'Evidence note', 'Actor ID',
] as const;

export const AUDIT_CSV_COLUMNS: CsvColumn<AuditExportRow>[] = [
  { header: 'Event reference', accessor: (e) => e.row.id, format: 'text' },
  { header: 'Timestamp',   accessor: (e) => e.row.created_at, format: 'datetime' },
  { header: 'Event',       accessor: (e) => auditActionLabel(e.row.action), format: 'text' },
  { header: 'Action code', accessor: (e) => e.row.action, format: 'text' },
  { header: 'Description', accessor: (e) => describeAuditLog(e.row), format: 'text' },
  { header: 'Account',     accessor: (e) => auditActorName(e.row), format: 'text' },
  { header: 'Account role in event', accessor: (e) => e.row.action === 'login.failed' ? 'Target account' : 'Recorded actor', format: 'text' },
  { header: 'Source',      accessor: (e) => auditSourceLabel(e.row.source), format: 'text' },
  { header: 'Record type', accessor: (e) => auditEntityLabel(e.row.entity_type), format: 'text' },
  { header: 'Record ID',   accessor: (e) => e.row.entity_id, format: 'text' },
  { header: 'Review cue',  accessor: (e) => auditReviewCue(e.row), format: 'text' },
  { header: 'Evidence note', accessor: (e) => auditEvidenceNote(e.row), format: 'text' },
  { header: 'Actor ID',    accessor: (e) => e.row.actor_id, format: 'text' },
  // ── Colonnes ajoutées : jamais insérées plus haut, jamais renommées. ──
  { header: 'Timestamp ISO', accessor: (e) => Number.isNaN(Date.parse(e.row.created_at)) ? '' : formatIsoWita(e.row.created_at), format: 'text' },
  { header: 'Sequence',     accessor: (e) => e.sequence, format: 'number' },
  { header: 'Order number', accessor: (e) => e.fields.orderNumber, format: 'text' },
  { header: 'Order ID',     accessor: (e) => e.fields.orderId, format: 'text' },
  { header: 'Terminal ID',  accessor: (e) => e.fields.terminalId, format: 'text' },
  { header: 'Shift ID',     accessor: (e) => e.fields.shiftId, format: 'text' },
  { header: 'Table',        accessor: (e) => e.fields.table, format: 'text' },
  { header: 'Product',      accessor: (e) => e.fields.product, format: 'text' },
  { header: 'Product ID',   accessor: (e) => e.fields.productId, format: 'text' },
  { header: 'Quantity',     accessor: (e) => e.fields.quantity, format: 'number' },
  { header: 'Unit',         accessor: (e) => e.fields.unit, format: 'text' },
  { header: 'Amount',       accessor: (e) => e.fields.amount, format: 'number' },
  { header: 'Payment method', accessor: (e) => e.fields.paymentMethod, format: 'text' },
  { header: 'Value before', accessor: (e) => numberOrText(e.fields.before), format: 'text' },
  { header: 'Value after',  accessor: (e) => numberOrText(e.fields.after), format: 'text' },
  { header: 'Reason code',  accessor: (e) => e.fields.reasonCode, format: 'text' },
  { header: 'Reason note',  accessor: (e) => e.fields.reasonNote, format: 'text' },
  { header: 'Outcome',      accessor: (e) => e.fields.outcome, format: 'text' },
  { header: 'Severity',     accessor: (e) => e.signal.severity === null ? null : SEVERITY_LABEL[e.signal.severity], format: 'text' },
  { header: 'Signal group', accessor: (e) => e.signal.group, format: 'text' },
  { header: 'Group size',   accessor: (e) => e.signal.groupSize, format: 'number' },
  { header: 'Link key',     accessor: (e) => e.fields.linkKey, format: 'text' },
  { header: 'Evidence code', accessor: (e) => auditEvidenceCode(e.row), format: 'text' },
  // ── Contexte résolu à la lecture. Le rôle est celui du compte AUJOURD'HUI, l'en-tête le dit. ──
  { header: 'Account role (current)', accessor: (e) => e.row.actor_role ?? null, format: 'text' },
  { header: 'Terminal',     accessor: (e) => e.row.device_label ?? null, format: 'text' },
  { header: 'Terminal sequence', accessor: (e) => e.row.device_seq ?? null, format: 'number' },
];
