// packages/utils/src/format.ts
// Formatage unique des montants et des quantités du back-office (audit UX/UI
// 2026-08-13). Locale métier : id-ID — séparateur de milliers « . », décimale
// « , ». La devise s'écrit avec le préfixe maison `Rp ` (style 'decimal' +
// préfixe, PAS style 'currency' : selon la version d'ICU, 'currency' insère un
// NBSP après « Rp » et casse les assertions de tests par égalité stricte).
//
// NOTE périmètre : `formatIdr` (idr.ts, locale en-US) reste la voie du POS et
// des primitives partagées Currency/KpiTile tant que la bascule POS n'est pas
// décidée. Le back-office migre sur les fonctions de ce fichier.

const _fmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

// Compact : id-ID rend « jt » (juta) et « rb » (ribu). 2 décimales max —
// « Rp 1,26 jt ». Réservé aux tuiles KPI ; le call-site DOIT exposer la
// valeur exacte via title={formatCurrency(v)}.
const _compactFmt = new Intl.NumberFormat('id-ID', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

// Quantités : jamais plus de 3 décimales (unités fractionnables), et l'arrondi
// est fait par Intl lui-même — pas de toFixed qui fabrique des zéros morts.
const _qtyFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 });
const _qtyIntFmt = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

// Le compact id-ID sépare la valeur du suffixe (jt/rb) par une espace
// insécable (U+00A0, parfois U+202F selon l'ICU) — normalisée en espace
// simple pour un rendu copiable et des tests stables.
const NBSP_RE = /[  ]/g;

// Les montants arrivent parfois en string (colonnes numeric sérialisées par
// PostgREST) ou en null. On tolère, on ne devine pas : non-numérique → tiret.
function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : null;
}

export interface FormatCurrencyOptions {
  /** Notation compacte id-ID (jt/rb) — réservée aux tuiles KPI. */
  compact?: boolean;
}

export function formatCurrency(
  value: number | string | null | undefined,
  options?: FormatCurrencyOptions,
): string {
  const n = toFiniteNumber(value);
  if (n === null) return '—';
  const isNegative = n < 0;
  const abs = Math.abs(n);
  const body = options?.compact
    ? _compactFmt.format(abs).replace(NBSP_RE, ' ')
    : _fmt.format(abs);
  return `${isNegative ? '-' : ''}Rp ${body}`;
}

// Les unités de comptage et de contenant (pcs, roll, pack, bag… — le registre
// `public.units`, dimensions count/container) s'affichent en entier strict.
// Masse, volume et unité inconnue gardent jusqu'à 3 décimales : arrondir une
// unité qu'on ne connaît pas fabriquerait du stock. La comparaison est
// insensible à la casse parce que le registre contient des doublons de casse
// (ROLL/roll, PACK/pack) ; la normalisation de cette taxonomie est un
// chantier séparé.
const COUNT_UNITS = new Set([
  'pcs',
  'piece',
  'pieces',
  'pc',
  'roll',
  'pack',
  'bag',
  'can',
  'set',
  'plate',
  'box',
  'unit',
]);

export function formatQuantity(
  value: number | string | null | undefined,
  unit: string | null | undefined,
): string {
  const n = toFiniteNumber(value);
  if (n === null) return '—';
  const unitCode = unit?.trim() ?? '';
  const isCount = COUNT_UNITS.has(unitCode.toLowerCase());
  const body = isCount ? _qtyIntFmt.format(n) : _qtyFmt.format(n);
  return unitCode ? `${body} ${unitCode}` : body;
}
