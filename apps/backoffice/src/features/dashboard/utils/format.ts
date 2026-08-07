// apps/backoffice/src/features/dashboard/utils/format.ts
//
// Écran 1c — formatage des valeurs du dashboard.
//
// Une seule règle traverse ce fichier : **une donnée absente ne se rend pas en
// zéro**. Le RPC renvoie `null` quand une comparaison est impossible (base à 0)
// ou qu'un bloc est restreint ; afficher « 0 % » ou « Rp 0 » dans ces cas dirait
// « rien n'a bougé » ou « la caisse est vide », deux mensonges. Tout ce qui est
// nul sort en tiret cadratin.

/** Sens d'une variation. `none` = pas de comparaison possible. */
export type DeltaDirection = 'up' | 'down' | 'flat' | 'none';

export interface DeltaView {
  direction: DeltaDirection;
  /** Glyphe seul — rendu `aria-hidden`, la valeur est portée par `text`. */
  glyph: string;
  /** Valeur formatée, unité comprise : « 12,4% », « 1,4pt », « — ». */
  text: string;
}

const TIRET = '—';

function fixed1(v: number): string {
  return Math.abs(v).toLocaleString('id-ID', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/**
 * Vue d'une variation. `unit` distingue les deux registres :
 *   · `pct` — variation RELATIVE d'une mesure (CA, commandes…).
 *   · `pt`  — écart en POINTS entre deux pourcentages (marge brute). Comparer
 *     deux taux en relatif est le classique du rapport faux, la RPC renvoie
 *     donc déjà des points ; l'unité affichée doit suivre.
 */
export function deltaView(v: number | null | undefined, unit: 'pct' | 'pt' = 'pct'): DeltaView {
  if (v === null || v === undefined || Number.isNaN(v)) {
    return { direction: 'none', glyph: '', text: TIRET };
  }
  const suffix = unit === 'pct' ? '%' : 'pt';
  if (v === 0) return { direction: 'flat', glyph: '=', text: `0,0${suffix}` };
  if (v > 0)   return { direction: 'up',   glyph: '▲', text: `${fixed1(v)}${suffix}` };
  return { direction: 'down', glyph: '▼', text: `${fixed1(v)}${suffix}` };
}

/** IDR complet — « Rp34.100 ». Montants unitaires, lignes de détail. */
export function formatIdr(v: number | null | undefined): string {
  if (v === null || v === undefined) return TIRET;
  return v.toLocaleString('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  });
}

/** IDR compact — « Rp 8,42 jt ». Valeurs de tuile KPI et totaux de carte. */
export function formatIdrShort(v: number | null | undefined): string {
  if (v === null || v === undefined) return TIRET;
  return v.toLocaleString('id-ID', {
    style: 'currency', currency: 'IDR', notation: 'compact', maximumFractionDigits: 2,
  });
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

/** Durée en minutes → « 12 min », « 1 h 24 ». */
export function formatMinutes(v: number | null | undefined): string {
  if (v === null || v === undefined) return TIRET;
  const m = Math.max(0, Math.round(v));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${String(rest).padStart(2, '0')}`;
}

/** Heure locale courte — « 09:42 ». */
export function formatClock(iso: string | null | undefined): string {
  if (iso === null || iso === undefined) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
