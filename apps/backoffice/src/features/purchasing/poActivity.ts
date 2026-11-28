// apps/backoffice/src/features/purchasing/poActivity.ts
//
// Historique d'un bon de commande : qui a fait quoi, et quand.
//
// Source unique : `audit_logs`. Les fonctions des achats y écrivent sous deux
// noms d'entité pour le bon (`purchase_order`, `purchase_orders`) et sous
// `goods_receipt_notes` pour l'annulation d'une réception (l'entité est alors
// la réception, rattachée au bon par la liste de ses réceptions). Les paiements
// y sont tous tracés (`po.payment_recorded`, `po.payment_reversed`) : les relire
// aussi dans le grand livre les doublerait.
//
// La fonction est pure : le hook lit, elle met en forme.

import type { Json } from '@breakery/supabase';
import { formatCurrency, formatDateShortWita } from '@breakery/utils';

export interface PoAuditRow {
  id:         number;
  action:     string;
  created_at: string;
  metadata:   Json | null;
  payload:    Json | null;
  actor:      { full_name: string } | null;
}

export interface PoActivityEvent {
  id:      string;
  at:      string;
  action:  string;
  person:  string | null;
  detail?: string;
}

const ACTION_LABEL: Record<string, string> = {
  'purchase_order.create':   'Order created',
  'po.updated':              'Order edited',
  'po.invoice_updated':      'Supplier invoice changed',
  'purchase_order.received': 'Goods received',
  'goods_receipt.cancelled': 'Receipt cancelled',
  'po.payment_recorded':     'Payment recorded',
  'po.payment_reversed':     'Payment reversed',
  'purchase_order.cancel':   'Order cancelled',
  'po.correction_started':   'Order correction (super admin)',
};

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash', transfer: 'Bank transfer', qris: 'QRIS', card: 'Card', edc: 'EDC',
};

/** Code inconnu → libellé lisible, jamais le code brut ni un « activity » vague. */
function humanizeAction(action: string): string {
  const last = action.split('.').pop() ?? action;
  const words = last.replace(/_/g, ' ').trim();
  return words === '' ? action : words.charAt(0).toUpperCase() + words.slice(1);
}

function obj(v: Json | null | undefined): Record<string, Json | undefined> {
  return v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

function num(v: Json | undefined): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function str(v: Json | undefined): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function money(v: Json | undefined): string | null {
  const n = num(v);
  return n === null ? null : formatCurrency(n);
}

function join(parts: readonly (string | null)[]): string | undefined {
  const text = parts.filter((p): p is string => p !== null).join(' · ');
  return text === '' ? undefined : text;
}

function method(v: Json | undefined): string | null {
  const m = str(v);
  return m === null ? null : (METHOD_LABEL[m] ?? m);
}

function auditDetail(row: PoAuditRow): string | undefined {
  const m = obj(row.metadata);
  const p = obj(row.payload);
  switch (row.action) {
    case 'purchase_order.create':
    case 'po.updated':
      return join([money(m.total_amount) !== null ? `Total ${money(m.total_amount)}` : null,
        num(m.item_count) !== null ? `${num(m.item_count)} line(s)` : null,
        str(m.payment_terms) === 'cash' ? 'Cash on delivery' : str(m.payment_terms) === 'credit' ? 'Credit' : null]);
    case 'purchase_order.received':
      return join([str(m.grn_number), money(m.subtotal) !== null ? `Subtotal ${money(m.subtotal)}` : null]);
    case 'goods_receipt.cancelled':
      return join([str(m.grn_number), str(m.reason) !== null ? `Reason: ${str(m.reason)}` : null]);
    case 'po.payment_recorded': {
      const paidAt = str(m.paid_at);
      return join([money(m.amount), method(m.method),
        paidAt !== null ? `paid ${formatDateShortWita(paidAt)}` : null,
        str(m.reference) !== null ? `ref ${str(m.reference)}` : null,
        str(m.payment_group_id) !== null ? 'grouped payment' : null]);
    }
    case 'po.payment_reversed': {
      const paidAt = str(p.paid_at);
      return join([money(p.amount), method(p.method),
        paidAt !== null ? `paid ${formatDateShortWita(paidAt)}` : null,
        str(m.reason) !== null ? `Reason: ${str(m.reason)}` : null]);
    }
    case 'purchase_order.cancel':
      return str(m.reason) !== null ? `Reason: ${str(m.reason)}` : undefined;
    case 'po.correction_started': {
      // ADR-050 : la correction enchaîne contre-passations et annulations,
      // chacune déjà tracée à part ; cette ligne dit le geste et son motif.
      const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
      return join([
        `${count(m.reversed_payment_ids)} payment(s) reversed`,
        `${count(m.cancelled_grn_ids)} receipt(s) cancelled`,
        str(m.reason) !== null ? `Reason: ${str(m.reason)}` : null,
      ]);
    }
    case 'po.invoice_updated': {
      const path = obj(p.invoice_path);
      if (str(path.to) !== null && str(path.from) === null) return 'Invoice attached';
      if (str(path.to) === null && str(path.from) !== null) return 'Invoice removed';
      if (str(path.to) !== null) return 'Invoice replaced';
      return undefined;
    }
    default:
      return undefined;
  }
}

/** Les plus récents d'abord. */
export function buildPoActivity(audit: readonly PoAuditRow[]): PoActivityEvent[] {
  return audit
    .map((row) => {
      const detail = auditDetail(row);
      return {
        id: `audit-${row.id}`,
        at: row.created_at,
        action: ACTION_LABEL[row.action] ?? humanizeAction(row.action),
        person: row.actor?.full_name ?? null,
        ...(detail !== undefined ? { detail } : {}),
      };
    })
    // Même instant : l'identifiant d'audit, numérique, départage (jamais en texte : « 9 » > « 10 »).
    .sort((x, y) => Date.parse(y.at) - Date.parse(x.at)
      || Number(y.id.slice('audit-'.length)) - Number(x.id.slice('audit-'.length)));
}
