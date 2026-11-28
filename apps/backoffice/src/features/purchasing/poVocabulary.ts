// Vocabulaire commun des écrans d'achat : les dates d'un bon de commande, leurs
// libellés et leur format.
//
// Pourquoi un module : la même colonne `order_date` s'appelait « Order date »,
// « Date » ou « Ordered » selon l'écran ; `received_date` s'appelait « Actual
// delivery », « Received » ou « Last full receipt » ; `expected_date` était
// affichée comme « Due Date » sur l'onglet des paiements du fournisseur. Et le
// format changeait d'un écran à l'autre (ISO brut, jour/mois numérique, « 5 Aug »
// sans année). Un bon de commande porte SIX dates qui ne disent pas la même
// chose ; chaque écran les nomme désormais d'ici.
//
// Les six dates, et ce qu'elles mesurent :
//   created   — `purchase_orders.created_at` : l'instant où le bon a été saisi.
//   ordered   — `purchase_orders.order_date` : le jour de la commande au
//               fournisseur (choisi à la saisie, peut précéder la saisie).
//   expected  — `purchase_orders.expected_date` : la livraison prévue.
//   received  — `goods_receipt_notes.received_date` : le jour d'une réception ;
//               `purchase_orders.received_date` est celui de la réception qui a
//               soldé le bon.
//   paid      — `purchase_payments.paid_at` : le jour réel du décaissement
//               (ADR-048) ; il date aussi l'écriture comptable.
//   recorded  — `purchase_payments.created_at` : l'instant où le paiement a été
//               saisi dans le back-office.

import { TIMEZONE, formatDateTimeShortWita } from '@breakery/utils';

export const PO_DATE_LABELS = {
  created:  'Created',
  ordered:  'Order date',
  expected: 'Expected delivery',
  received: 'Received',
  paid:     'Paid on',
  recorded: 'Recorded',
} as const;

export const PO_DATE_HINTS = {
  created:  'When the order was entered in the back office.',
  ordered:  'The day the order was placed with the supplier.',
  expected: 'The delivery date planned with the supplier.',
  received: 'The day the goods arrived and were posted to stock.',
  paid:     'The day the money actually left — it dates the accounting entry.',
  recorded: 'When the payment was entered in the back office.',
} as const;

// `Intl` plutôt que `date-fns-tz` : le back-office ne dépend pas de la
// bibliothèque, et le fuseau vient de la constante unique (ADR-019).
const DAY_FMT  = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, day: '2-digit', month: 'short' });
const YEAR_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, year: 'numeric' });

/**
 * Un jour d'achat : « 17 Nov » dans l'année courante, « 17 Nov 2025 » sinon.
 * Les bons importés remontent à plusieurs années : sans l'année, « 3 Mar » ne
 * dit pas laquelle. Absent = tiret.
 *
 * Une date SQL (`2026-11-17`) est lue comme un jour calendaire, sans passer
 * par le fuseau : `new Date('2026-11-17')` vaut minuit UTC, et un fuseau à
 * l'ouest de Greenwich la ferait reculer d'un jour.
 */
export function formatPoDay(d: string | null | undefined): string {
  if (d === null || d === undefined || d === '') return '—';
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(d);
  const date = isDateOnly ? new Date(`${d}T12:00:00+08:00`) : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const year = YEAR_FMT.format(date);
  const day  = DAY_FMT.format(date);
  return year === YEAR_FMT.format(new Date()) ? day : `${day} ${year}`;
}

/** Un instant d'achat (saisie du bon, saisie d'un paiement) : « 17 Nov 2026, 16:53 ». */
export function formatPoInstant(d: string | null | undefined): string {
  if (d === null || d === undefined || d === '') return '—';
  return formatDateTimeShortWita(d);
}
