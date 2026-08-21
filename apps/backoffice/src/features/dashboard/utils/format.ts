// apps/backoffice/src/features/dashboard/utils/format.ts
import { formatCurrency, formatTimeWita } from '@breakery/utils';
//
// Écran 1c — formatage des valeurs du dashboard.
//
// Une seule règle traverse ce fichier : **une donnée absente ne se rend pas en
// zéro**. Le RPC renvoie `null` quand une comparaison est impossible (base à 0)
// ou qu'un bloc est restreint ; afficher « 0 % » ou « Rp 0 » dans ces cas dirait
// « rien n'a bougé » ou « la caisse est vide », deux mensonges. Tout ce qui est
// nul sort en tiret cadratin.

// Lot B (campagne Reports 2026-08-15) — deltaView vit désormais en partagé
// (src/components/kpi/deltaView.ts), avec le composant Delta qu'il sert.
export { deltaView, type DeltaView, type DeltaDirection } from '@/components/kpi/deltaView.js';

const TIRET = '—';

/**
 * IDR complet — « Rp 34.100 ». Montants unitaires, lignes de détail.
 * Délègue à formatCurrency (@breakery/utils) — audit UX/UI 2026-08-13, lot 1 :
 * un seul formatteur de devise pour tout le back-office. `null` sort en tiret,
 * règle déjà portée par formatCurrency.
 */
export function formatIdr(v: number | null | undefined): string {
  return formatCurrency(v);
}

/** IDR compact — « Rp 8,42 jt ». Valeurs de tuile KPI et totaux de carte. */
export function formatIdrShort(v: number | null | undefined): string {
  return formatCurrency(v, { compact: true });
}

/** Entier — « 1.084 ». */
export function formatCount(v: number | null | undefined): string {
  if (v === null || v === undefined) return TIRET;
  return Math.round(v).toLocaleString('id-ID');
}

/** Pourcentage à une décimale — « 61,8% ». */
export function formatPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return TIRET;
  return `${v.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** Quantité de stock — entier si entière, sinon 1 décimale (« 2,5 kg »). */
export function formatQty(v: number | null | undefined): string {
  if (v === null || v === undefined) return TIRET;
  return Number.isInteger(v)
    ? v.toLocaleString('id-ID')
    : v.toLocaleString('id-ID', { maximumFractionDigits: 1 });
}

/**
 * Durée en minutes → « 12m », « 1h 24m », « 163h ».
 *
 * Rendait « 12 min » / « 1 h 24 » jusqu'au 2026-08-21 : la typographie
 * FRANÇAISE de la durée, espace avant l'unité et « h » en séparateur, sur un
 * tableau de bord dont tout le reste est en anglais (CLAUDE.md — l'interface
 * parle anglais, les commentaires parlent français). Et « 163 h 07 » laissait
 * le lecteur deviner que 07 était des minutes : le nombre nu n'avait pas
 * d'unité. Elle en a une maintenant.
 */
export function formatMinutes(v: number | null | undefined): string {
  if (v === null || v === undefined) return TIRET;
  const m = Math.max(0, Math.round(v));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h ${String(rest).padStart(2, '0')}m`;
}

/** Heure métier courte — « 09:42 », fuseau WITA (ADR-019), pas celui du poste. */
export function formatClock(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return formatTimeWita(d);
}

/** Libellé de tranche horaire — « 07:00–09:00 ». */
export function formatHourRange(from: number, to: number): string {
  const pad = (h: number): string => `${String(h).padStart(2, '0')}:00`;
  return `${pad(from)}–${pad(to)}`;
}

/**
 * Type de commande → libellé lisible. La source est l'enum Postgres
 * (`order_type`) : aucun littéral n'est dérivé côté TS, on se contente de
 * traduire ce que la base envoie et de laisser passer une valeur inconnue
 * telle quelle plutôt que de l'écraser.
 */
export function orderTypeLabel(t: string): string {
  switch (t) {
    case 'dine_in':  return 'Dine-in';
    case 'take_out': return 'Take-away';
    case 'delivery': return 'Delivery';
    case 'b2b':      return 'B2B';
    default:         return t.replace(/_/g, ' ');
  }
}

/** Méthode de paiement → libellé lisible (même règle que ci-dessus). */
export function paymentMethodLabel(m: string): string {
  switch (m) {
    case 'cash':       return 'Cash';
    case 'card':       return 'Card';
    case 'qris':       return 'QRIS';
    case 'voucher':    return 'Voucher';
    case 'b2b_credit': return 'B2B credit';
    default:           return m.replace(/_/g, ' ');
  }
}
