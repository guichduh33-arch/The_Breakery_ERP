// Signaux calculés sur la période ENTIÈRE : répétitions et lots.
// À n'appeler que sur un jeu complet (l'export), jamais sur une page partielle de l'écran.
import type { AuditLogRow } from '../hooks/useAuditLogs.js';
import { auditFields, buildOrderLinks, linkAuditFields, type OrderLinks } from './auditFields.js';
import {
  DEFAULT_AUDIT_THRESHOLDS, auditNegativeStockOverride, auditRowSeverity,
  type AuditSeverity, type AuditThresholds,
} from './auditReview.js';

export interface AuditSignal {
  severity: AuditSeverity | null;
  /** Identifiant commun aux lignes d'une même répétition ou d'un même lot. */
  group: string | null;
  groupSize: number | null;
}

interface Family {
  name: string;
  /** Clé de regroupement, ou null si la ligne n'appartient pas à la famille. */
  key: (row: AuditLogRow, links: OrderLinks) => string | null;
  /** Écart maximal entre deux lignes voisines d'un même groupe, en millisecondes. */
  gapMs: (thresholds: AuditThresholds) => number;
  severity: (size: number, own: AuditSeverity | null, thresholds: AuditThresholds) => AuditSeverity | null;
}

const RANK: Record<AuditSeverity, number> = { low: 1, medium: 2, high: 3 };
function strongest(a: AuditSeverity | null, b: AuditSeverity | null): AuditSeverity | null {
  if (a === null) return b;
  if (b === null) return a;
  return RANK[a] >= RANK[b] ? a : b;
}
function byCount(size: number, medium: number, high: number): AuditSeverity | null {
  return size >= high ? 'high' : size >= medium ? 'medium' : null;
}
const windowMs = (t: AuditThresholds): number => t.repeatWindowMinutes * 60_000;
const actor = (row: AuditLogRow): string => row.actor_id ?? 'unknown';

const FAMILIES: Family[] = [
  {
    name: 'reprint',
    // Un ticket se compte sur toute la période : trois copies dans la journée
    // comptent autant que trois copies en deux minutes.
    key: (row, links) => {
      if (row.action !== 'pos.receipt_reprinted') return null;
      const fields = linkAuditFields(auditFields(row), links);
      return fields.orderNumber ?? fields.orderId;
    },
    gapMs: () => Number.POSITIVE_INFINITY,
    severity: (size, own, t) => strongest(own, byCount(size, t.reprintRepeatMedium, t.reprintRepeatHigh)),
  },
  {
    name: 'payment-failed',
    // Sans montant, deux échecs n'ont rien qui les relie : pas de groupe.
    key: (row) => {
      const amount = row.action === 'pos.payment_failed' ? auditFields(row).amount : null;
      return amount === null ? null : `${actor(row)}-${String(amount)}`;
    },
    gapMs: windowMs,
    severity: (size, own, t) => strongest(own, byCount(size, t.paymentFailRepeatMedium, t.paymentFailRepeatHigh)),
  },
  {
    name: 'pin-failed',
    key: (row) => row.action === 'manager_pin.failed' ? actor(row) : null,
    gapMs: windowMs,
    severity: (size, own, t) => strongest(own, size >= t.pinFailRepeatHigh ? 'high' : null),
  },
  {
    name: 'negative-stock',
    key: (row) => auditNegativeStockOverride(row) ? actor(row) : null,
    gapMs: windowMs,
    severity: (_size, own) => own,
  },
  {
    // Le terminal émet une ligne par frappe : le groupe désigne UNE saisie de note.
    name: 'note-typing',
    key: (row) => row.action === 'pos.note_added'
      ? `${actor(row)}-${auditFields(row).terminalId ?? 'unknown'}` : null,
    gapMs: () => 5_000,
    severity: (_size, own) => own,
  },
  {
    // Un recalcul de coût écrit toutes ses lignes dans la même transaction.
    name: 'cost-batch',
    key: (row) => row.action === 'product.cost_recomputed' ? actor(row) : null,
    gapMs: () => 2_000,
    severity: (_size, own) => own,
  },
];

function epoch(row: AuditLogRow): number {
  const time = Date.parse(row.created_at);
  return Number.isNaN(time) ? 0 : time;
}

export function buildAuditSignals(
  rows: readonly AuditLogRow[],
  thresholds: AuditThresholds = DEFAULT_AUDIT_THRESHOLDS,
): Map<string, AuditSignal> {
  const signals = new Map<string, AuditSignal>();
  for (const row of rows) {
    signals.set(row.id, { severity: auditRowSeverity(row, thresholds), group: null, groupSize: null });
  }

  const links = buildOrderLinks(rows);
  for (const family of FAMILIES) {
    const buckets = new Map<string, AuditLogRow[]>();
    for (const row of rows) {
      const key = family.key(row, links);
      if (key === null) continue;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(row); else buckets.set(key, [row]);
    }
    const gap = family.gapMs(thresholds);
    for (const [key, bucket] of buckets) {
      bucket.sort((a, b) => epoch(a) - epoch(b) || a.id.localeCompare(b.id));
      let cluster: AuditLogRow[] = [];
      const close = (): void => {
        const head = cluster[0];
        if (head === undefined || cluster.length < 2) { cluster = []; return; }
        const group = `${family.name}:${key}@${head.created_at}`;
        for (const member of cluster) {
          const own = signals.get(member.id)?.severity ?? null;
          signals.set(member.id, {
            severity: family.severity(cluster.length, own, thresholds), group, groupSize: cluster.length,
          });
        }
        cluster = [];
      };
      for (const row of bucket) {
        const previous = cluster[cluster.length - 1];
        if (previous !== undefined && epoch(row) - epoch(previous) > gap) close();
        cluster.push(row);
      }
      close();
    }
  }
  return signals;
}
