// apps/backoffice/src/features/btob/b2bOrderActivity.ts
//
// Historique d'une commande B2B : qui a fait quoi, et quand.
//
// Deux sources, sans doublon possible :
// - `audit_logs` sur l'entité commande (création, édition, date de retrait,
//   collecte, annulation) — l'acteur est le profil qui a fait le geste ;
// - les allocations de paiement sur cette facture — la personne est
//   `b2b_payments.created_by`. Les paiements ne passent PAS par l'audit de la
//   commande (leur trace d'audit porte l'entité `b2b_payments`) : les lire
//   par les allocations couvre aussi les règlements antérieurs à cette trace.
//
// La fonction est pure : le hook lit, elle met en forme.

import type { Json } from '@breakery/supabase';
import { formatCurrency, formatDateShortWita } from '@breakery/utils';

export interface B2bOrderAuditRow {
  id:         number;
  action:     string;
  created_at: string;
  metadata:   Json | null;
  actor:      { full_name: string } | null;
}

export interface B2bOrderAllocationRow {
  id:             string;
  amount_applied: number;
  created_at:     string;
  payment: {
    payment_number: string;
    method:         string;
    paid_at:        string | null;
    created_at:     string;
    creator:        { full_name: string } | null;
  } | null;
}

export interface B2bOrderActivityEvent {
  id:      string;
  at:      string;
  action:  string;
  person:  string | null;
  detail?: string;
}

const ACTION_LABEL: Record<string, string> = {
  'b2b.order.created':        'Order created',
  'b2b.order.edited':         'Order edited',
  'b2b.order.pickup_updated': 'Pickup date changed',
  'b2b.order.delivered':      'Collected',
  'b2b.order.cancelled':      'Order cancelled',
};

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash', transfer: 'Bank transfer', qris: 'QRIS', card: 'Card', edc: 'EDC', store_credit: 'Store credit',
};

/** Code inconnu → libellé lisible, jamais le code brut ni un « activity » vague. */
function humanizeAction(action: string): string {
  const last = action.split('.').pop() ?? action;
  const words = last.replace(/_/g, ' ').trim();
  return words === '' ? action : words.charAt(0).toUpperCase() + words.slice(1);
}

function meta(row: B2bOrderAuditRow): Record<string, Json | undefined> {
  return row.metadata !== null && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
    ? row.metadata : {};
}

function num(v: Json | undefined): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function str(v: Json | undefined): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function auditDetail(row: B2bOrderAuditRow): string | undefined {
  const m = meta(row);
  switch (row.action) {
    case 'b2b.order.created': {
      const parts = [str(m.invoice_number), num(m.items_total) !== null ? formatCurrency(num(m.items_total) ?? 0) : null];
      const pickup = str(m.delivery_date);
      if (pickup !== null) parts.push(`pickup ${formatDateShortWita(pickup)}`);
      const text = parts.filter((p): p is string => p !== null).join(' · ');
      return text === '' ? undefined : text;
    }
    case 'b2b.order.edited': {
      const delta = num(m.total_delta);
      if (delta === null) return undefined;
      if (delta === 0) return 'Total unchanged';
      return `Total ${delta > 0 ? '+' : '−'}${formatCurrency(Math.abs(delta))}`;
    }
    case 'b2b.order.pickup_updated': {
      const pickup = str(m.pickup_date);
      return pickup === null ? 'Pickup date cleared' : `New pickup date ${formatDateShortWita(pickup)}`;
    }
    case 'b2b.order.cancelled': {
      const reason = str(m.reason);
      return reason === null ? undefined : `Reason: ${reason}`;
    }
    default:
      return undefined;
  }
}

/** Les plus récents d'abord, comme la liste des commandes. */
export function buildB2bOrderActivity(
  audit: readonly B2bOrderAuditRow[],
  allocations: readonly B2bOrderAllocationRow[],
): B2bOrderActivityEvent[] {
  const events: B2bOrderActivityEvent[] = [];
  for (const row of audit) {
    const detail = auditDetail(row);
    events.push({
      id: `audit-${row.id}`,
      at: row.created_at,
      action: ACTION_LABEL[row.action] ?? humanizeAction(row.action),
      person: row.actor?.full_name ?? null,
      ...(detail !== undefined ? { detail } : {}),
    });
  }
  for (const a of allocations) {
    const p = a.payment;
    const method = p === null ? null : (METHOD_LABEL[p.method] ?? humanizeAction(p.method));
    const detail = [p?.payment_number ?? null, method, `${formatCurrency(Number(a.amount_applied))} applied`]
      .filter((x): x is string => x !== null).join(' · ');
    events.push({
      id: `alloc-${a.id}`,
      at: p?.paid_at ?? p?.created_at ?? a.created_at,
      action: 'Payment received',
      person: p?.creator?.full_name ?? null,
      detail,
    });
  }
  return events.sort((x, y) => Date.parse(y.at) - Date.parse(x.at) || x.id.localeCompare(y.id));
}
