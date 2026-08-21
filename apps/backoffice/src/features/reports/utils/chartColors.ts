// apps/backoffice/src/features/reports/utils/chartColors.ts
import { formatCurrency } from '@breakery/utils';
//
// Cost & Spend Analytics — the "two cost families" chart language.
//
//   COGS / material purchasing  → BLUE family   (the backoffice accent)
//   OpEx / operating expenses   → AMBER family
//
// Carried consistently across every cost chart so a reader instantly knows
// which P&L cost bucket a series belongs to.
//
// Audit /impeccable 2026-08-08 — l'en-tête disait encore « ivory cards on a
// warm neutral ». L'ivoire chaud a été retiré le 2026-08-05 : les cartes sont
// blanches sur un papier gris chaud. Les valeurs, elles, avaient déjà suivi ;
// seule la phrase était restée.
//
// Recharts pose ses couleurs en props JS, pas en classes : ce fichier est le
// SEUL endroit où une couleur du thème est recopiée côté Backoffice. Un `var()`
// est valide dans un attribut de présentation SVG (`fill`, `stroke`) — les
// neutres, CATEGORICAL_SERIES et les onze graphes livrés le prouvent — vérifié
// en direct le 2026-08-18 : `var(--info)` posé en `fill` rendait alors
// `rgb(43, 108, 156)`, soit le #2b6c9c qu'il remplaçait, à l'octet près — ce
// qui prouvait le MÉCANISME, et le mécanisme n'a pas bougé quand la valeur du
// token a changé le 2026-08-21 (voir plus bas). On ne
// passe donc JAMAIS par `getComputedStyle`, qui exige la feuille chargée et un
// élément portant `.theme-backoffice` : en test (jsdom) il rend `''`, et une
// couleur vide emporte les snapshots.
//
// ─────────────────────────────────────────────────────────────────────────────
// LA RÈGLE DU FICHIER (lot F, campagne design 2026-08-18)
//
// Un littéral hexadécimal n'est légitime ici QUE s'il ne duplique aucun token
// du thème. Les cinq qui en dupliquaient un sont passés en `var()` :
//   #2b6c9c → var(--info) (ancrage sémantique de la famille COGS) puis
//             var(--chart-1) dans les rampes · #4f93bf → var(--chart-2)
//   #8cc3e0 → var(--chart-3) · #8a5a10 → var(--warning)
//
// Les QUATORZE valeurs restantes sont en dur DÉLIBÉRÉMENT. Ce sont deux rampes
// ANALYTIQUES de huit pas, locales au module reports. Le thème n'expose qu'une
// rampe séquentielle de quatre pas (--chart-1..4), monochrome bleue : y mapper
// les deux rampes fusionnerait les familles COGS et OpEx, qui existent
// justement pour se distinguer d'un coup d'œil. C'est un arbitrage de data-viz,
// pas une dette. La garde `scripts/ci/hardcoded-theme-colors.mjs` les porte en
// baseline et refuse toute recopie NEUVE d'un hex du thème.
//
// CONTRASTE MESURÉ sur la carte blanche (--surface-2/3 = #ffffff), calculé au
// 2026-08-18 :
//   COGS_RAMP  5,63 · 10,00 · 3,36 · 6,95 · 2,37 · 4,88 · 11,44 · 1,91
//   OPEX_RAMP  5,91 ·  4,20 · 3,09 · 8,63 · 2,24 · 11,83 ·  4,27 · 1,79
//
// ⚠️ LE PREMIER CRAN DE CHAQUE RAMPE A BOUGÉ DEPUIS (2026-08-21). `--info` et
// `--warning` ont été assombris parce que le chip d'état du primitif Badge les
// posait sur leur propre teinte douce et tombait sous AA. Les deux têtes de
// rampe montent donc en contraste — COGS 5,63 → 6,61, OpEx 5,91 → 6,58 — et
// aucun autre cran ne bouge, les quatorze suivants étant en dur. Un graphe ne
// perd rien : il gagne. Les DEUX crans sous le plancher 3:1 listés plus bas
// restent exactement où ils étaient.
// Deux crans sont sous le plancher 3:1 des objets graphiques (WCAG 1.4.11) —
// #d9a44a à 2,24:1 et #e0bd7d à 1,79:1, plus #6fb0d6 à 2,37:1 et #8cc3e0 à
// 1,91:1 côté bleus. Un troisième PASSE mais à 3 % du seuil : #c2872a, 3,09:1,
// et rien ne le surveille. Ils restent légaux parce que chaque graphe du module
// garde des étiquettes directes et une table sous le graphe : la couleur n'y
// porte jamais seule l'identité d'une série.
//
// ⚠️ NON PORTABLE VERS LA CAISSE. Les tokens --chart-1..4 sont INVERSÉS entre
// les deux thèmes (backoffice #2b6c9c → #c9dcea, POS #8cc3e0 → #3f7096) : en
// sombre la lisibilité monte avec la clarté. Un graphe POS qui importerait ce
// fichier verrait sa rampe COGS se retourner. Vérifié le 2026-08-18 : les 52
// fichiers qui importent `chartColors` vivent tous sous `apps/backoffice/`.
// ─────────────────────────────────────────────────────────────────────────────

/** Headline color for each cost bucket. */
// Audit cohérence 2026-08-01 — les deux familles s'ancrent désormais sur les
// teintes sémantiques du thème (--info et --amber-warn) au lieu du bleu royal
// #1e55d6, qui n'était là que parce qu'il était l'ancien accent Backoffice.
// L'accent, lui, est l'or encre (#8a6820) : il ne porte aucune famille de coût.
export const COGS_BASE = 'var(--info)';    // famille COGS / achats matière
export const OPEX_BASE = 'var(--warning)'; // famille OpEx

/**
 * Category ramps — family-coherent but mutually distinguishable. Used for
 * donut slices / multi-category bars. Cycles if a series exceeds its length.
 * Retendues pour l'ivoire chaud : plus de bleus saturés clairs, illisibles
 * sur un fond clair.
 */
const COGS_RAMP = [
  'var(--chart-1)', '#17456b', 'var(--chart-2)', '#0d5f8a',
  '#6fb0d6', '#1e78a8', '#0a3d5c', 'var(--chart-3)',
] as const;

const OPEX_RAMP = [
  'var(--warning)', '#a8701c', '#c2872a', '#6b430a',
  '#d9a44a', '#4f3106', '#b06a15', '#e0bd7d',
] as const;

export type CostFamily = 'cogs' | 'opex';

/** Pick the ramp for a family. */
export function familyRamp(family: CostFamily): readonly string[] {
  return family === 'cogs' ? COGS_RAMP : OPEX_RAMP;
}

/** Color for slice `i` within a family (cycles). */
export function familyColor(family: CostFamily, i: number): string {
  const ramp = familyRamp(family);
  return ramp[i % ramp.length]!;
}

/** Base accent for a family. */
export function familyBase(family: CostFamily): string {
  return family === 'cogs' ? COGS_BASE : OPEX_BASE;
}

// --- Categorical series (family-agnostic) -----------------------------------
//
// Multi-series line / pie charts that don't map to a single cost family
// (e.g. per-supplier price trends) draw from one shared, mutually-legible
// hue set instead of ad-hoc per-file hex. Cycles if series exceed length.
//
// Lot B (campagne Reports 2026-08-15) — recomposée sur les deux familles de la
// direction (bleus COGS / ambres OpEx alternés) : l'or est une encre de sens
// (jamais une série), et le vert/rouge sont réservés au vocabulaire d'état —
// une « série 4 » rouge lisait comme une alerte. Les deux bleus médians sont
// remontés en chroma (les crans de rampe #4f93bf/#0d5f8a tombaient sous le
// plancher « reads gray »). Palette VALIDÉE au validateur data-viz du
// 2026-08-15 (lightness band, chroma, ΔE CVD 19,4, ΔE normal 23,1) ; l'ambre
// clair #d9a44a est sous 3:1 sur blanc → légal parce que chaque graphe du
// module garde étiquettes directes + table.
export const CATEGORICAL_SERIES = [
  'var(--chart-1)', // bleu #2b6c9c — même cran que COGS_BASE
  '#a8701c', // ambre — OPEX_RAMP[1]
  '#3f92cc', // bleu clair (chroma remonté depuis COGS_RAMP[2])
  '#c2872a', // ambre clair — OPEX_RAMP[2]
  '#0e63a8', // bleu profond (chroma remonté depuis COGS_RAMP[3])
  '#d9a44a', // ambre pâle — OPEX_RAMP[4]
] as const;

/** Color for categorical series `i` (cycles). */
export function categoricalColor(i: number): string {
  return CATEGORICAL_SERIES[i % CATEGORICAL_SERIES.length]!;
}

/** Neutral swatch for an "off / disabled" series (legend toggles) and for the
 *  DASHED comparison line of a trend chart. Suit `--text-inert` (#c2beb5). */
export const CHART_SERIES_OFF = 'var(--text-inert)';

/**
 * Série de COMPARAISON (période précédente) dans un graphe à deux séries.
 * Le cran le plus pâle de la rampe séquentielle : même famille que la série
 * courante — c'est la même mesure, à une autre date — mais assez pâle pour
 * rester en arrière-plan. Suit `--chart-4` (#c9dcea en Backoffice).
 */
export const CHART_SERIES_COMPARE = 'var(--chart-4)';

// --- Rampe séquentielle du thème --------------------------------------------
// `--chart-1..4`, du plus soutenu au plus clair. C'est une rampe SÉQUENTIELLE
// (une teinte, lisibilité par luminosité) : jamais quatre identités
// catégorielles — les paires courant/comparaison prennent les EXTRÊMES
// (chart-1 vs chart-4), les ventilations à pistes la descendent dans l'ordre.
export const CHART_1 = 'var(--chart-1)';
export const CHART_2 = 'var(--chart-2)';
export const CHART_3 = 'var(--chart-3)';
export const CHART_4 = 'var(--chart-4)';

/** Gris inerte du thème — chevrons éteints, cellules vides de heatmap. */
export const TEXT_INERT = 'var(--text-inert)';

// --- Neutrals (light theme) -------------------------------------------------
// Miroirs des tokens `.theme-backoffice`. Recharts pose ses couleurs en props
// JS, pas en classes : ce fichier est le SEUL endroit où le hex du thème est
// recopié, et il doit suivre le thème.
//
// Refonte shell 2026-08-05 — l'ivoire chaud a laissé la place au neutre
// refroidi ; ces quatre valeurs suivent (sans quoi les graphes traçaient une
// grille beige sur des cartes blanches).
//
// Audit /impeccable 2026-08-08 — un libellé d'axe est du TEXTE. Il y avait ici
// deux crans, dont un (`#9b968d`, 2,94:1) sous le seuil AA à 10 px. Le cran
// discret est supprimé plutôt que remonté : le token `--text-subtle` ne porte
// plus que du non-texte, et deux gris de libellé d'axe ne disaient rien qu'un
// seul ne dise mieux.
export const CHART_GRID_STROKE = 'var(--border-muted)';
export const CHART_AXIS_STROKE = 'var(--border-subtle)'; // ligne de base
export const CHART_AXIS_TICK   = 'var(--text-muted)';    // du TEXTE : ≥4,5:1 partout

/** Shared recharts <Tooltip contentStyle> — white card, subtle border. */
export const CHART_TOOLTIP_STYLE = {
  background: 'var(--surface-3)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--text-primary)',
  // L'infobulle FLOTTE au-dessus de la page : --shadow-lg (0 8px 24px) est le
  // cran qui correspond au `0 8px 20px` écrit en dur ici, pas --shadow-md
  // (0 2px 8px), qui est l'ombre d'une carte survolée.
  boxShadow: 'var(--shadow-lg)',
} as const;

// --- IDR formatters ---------------------------------------------------------
// Audit UX/UI 2026-08-13 (lot 1) : les deux formatteurs de montants délèguent
// à `formatCurrency` (@breakery/utils, id-ID, préfixe « Rp  ») — une seule
// source de vérité pour toute l'app. Les alias `formatIdrFull`/`formatIdrCompact`
// restent exportés pour ne pas toucher les ~22 pages de reports consommatrices.

/** Full IDR — "Rp 2.364.545". */
export function formatIdrFull(v: number): string {
  return formatCurrency(v);
}

/** Compact IDR for axis ticks / dense labels — "Rp 2,4 jt". */
export function formatIdrCompact(v: number): string {
  return formatCurrency(v, { compact: true });
}

/**
 * IDR with 2 decimals — "Rp1.234,56".
 *
 * Audit 2026-08-01 (R-15) : le module affichait la monnaie de six façons
 * différentes. Tout est ramené sur ces formatteurs. `formatIdrFull` (0 décimale)
 * couvre les montants ; celui-ci existe pour les COÛTS UNITAIRES, où la
 * précision sous-roupie porte du sens (coût au gramme d'une matière première)
 * et où arrondir à l'entier effacerait l'information.
 */
export function formatIdrPrecise(v: number): string {
  return v.toLocaleString('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
