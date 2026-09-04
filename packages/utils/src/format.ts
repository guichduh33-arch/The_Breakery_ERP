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

// ─── POURCENTAGES ────────────────────────────────────────────────────────────
//
// POURQUOI CETTE FONCTION EXISTE (critique du BO, 2026-08-21, P1-3).
//
// `toFixed()` rend un POINT décimal quelle que soit la locale — c'est une
// méthode de `Number`, elle ne consulte aucun réglage régional. Les montants,
// eux, passent par Intl en id-ID, où le point est le séparateur de MILLIERS.
// Résultat mesuré à l'écran, à deux clics d'écart :
//
//   Rp 3.257.500   ← le point sépare les milliers
//   -99.90%        ← le même point sépare les décimales
//
// Un lecteur ne peut pas apprendre les deux. La marge devient lisible comme
// « moins quatre-vingt-dix-neuf mille quatre-vingt-dix » le jour où elle est
// assez grande pour en avoir l'air. Un pourcentage s'écrit donc avec la MÊME
// locale que la monnaie, et la décimale est une virgule : `-99,9%`.
//
// PÉRIMÈTRE. Cette fonction est pour l'AFFICHAGE. Une colonne d'export CSV
// garde son point décimal : un tableur qui ouvre le fichier en locale anglaise
// lirait « 12,5 » comme deux colonnes, et un chiffre coupé en deux est pire
// qu'un chiffre au mauvais format. La règle n'est pas « une seule écriture
// partout », elle est « une seule écriture par surface de lecture ».
const _pctFmt = new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const _pctFmt2 = new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const _pctFmt0 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

export interface FormatPercentOptions {
  /** Décimales rendues : 0, 1 (défaut) ou 2. */
  digits?: 0 | 1 | 2;
  /** Préfixe `+` sur les valeurs positives — pour un écart, pas pour une part. */
  signed?: boolean;
}

/**
 * Un pourcentage DÉJÀ exprimé en points de pourcentage (`12.5` → `12,5%`).
 * Une valeur nulle ou non numérique rend le tiret, comme les montants.
 */
export function formatPercent(
  value: number | string | null | undefined,
  options?: FormatPercentOptions,
): string {
  const n = toFiniteNumber(value);
  if (n === null) return '—';
  const digits = options?.digits ?? 1;
  const fmt = digits === 0 ? _pctFmt0 : digits === 2 ? _pctFmt2 : _pctFmt;
  const sign = options?.signed === true && n > 0 ? '+' : '';
  return `${sign}${fmt.format(n)}%`;
}

// ─── NOMBRES NUS ─────────────────────────────────────────────────────────────
//
// Le remplaçant de `toFixed()` pour un nombre sans unité ni symbole : jours de
// stock (`2,5 d`), articles par commande, compteur d'un plafond (`5.000 rows`).
// Même argument que le pourcentage ci-dessus — critique du BO du 2026-09-04 :
// huit `toFixed()` rendaient encore un point décimal à l'écran, et un
// « cap 5,000 rows » groupait à l'américaine à côté de `Rp 5.000`. `digits`
// est un nombre de décimales FIXE (comme `toFixed`), pas un plafond : `2` avec
// `{ digits: 1 }` rend `2,0`, pour que la colonne s'aligne.
const _numFmts = new Map<number, Intl.NumberFormat>();
function _numFmt(digits: number): Intl.NumberFormat {
  let fmt = _numFmts.get(digits);
  if (fmt === undefined) {
    fmt = new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    _numFmts.set(digits, fmt);
  }
  return fmt;
}

export interface FormatNumberOptions {
  /** Décimales rendues, fixes : 0 (défaut), 1, 2 ou 3. */
  digits?: 0 | 1 | 2 | 3;
}

/** Un nombre nu en locale métier (`2.5` → `2,5`, `5000` → `5.000`). */
export function formatNumber(
  value: number | string | null | undefined,
  options?: FormatNumberOptions,
): string {
  const n = toFiniteNumber(value);
  if (n === null) return '—';
  return _numFmt(options?.digits ?? 0).format(n);
}
