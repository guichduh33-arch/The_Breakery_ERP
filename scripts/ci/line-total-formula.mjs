#!/usr/bin/env node
// GARDE 10 — la formule d'un prix de ligne ne se réécrit pas hors du domaine.
//
// LA RÈGLE. Le prix d'une ligne de panier — base + surcharges d'options +
// ajustements des modificateurs de composants de combo (ADR-017), arrondi —
// a UNE source : `lineTotalOf` / `lineUnitEach` dans
// `packages/domain/src/cart/lineTotal.ts`, la même formule que `calculateTotals`
// facture et que le serveur résout. Toute recomposition locale
// (`unit_price + …`, `… + price_adjustment`) est un fork de cette formule qui
// diverge au premier changement.
//
// POURQUOI ELLE NAÎT LE 2026-08-29. Le même bug est ressuscité TROIS fois en un
// mois : corrigé dans CartLineRow le 2026-07-31, rené dans OrderSummaryPanel le
// 2026-08-28 (commit 4e06714d, sous-facturation des combos face au client),
// retrouvé le 2026-08-29 dans le split (somme des payeurs ≠ grand total →
// split REJETÉ devant les clients), l'écran client (lignes qui ne
// s'additionnent plus au Total) et le repli du reçu. Le helper créé pour tuer
// la classe de bug n'empêche pas d'écrire la formule à la main — seule une
// garde le fait. C'est le relevé fondateur des gardes 5-8 : sur ce dépôt, les
// seuls invariants tenus sont ceux qui ont un script.
//
// L'EXCEPTION LÉGITIME, NOMMÉE ET CLOSE — la baseline gèle UNE entrée :
//   · kdsOfflineStore.ts — `modifiers_total` d'une ligne KDS offline : une
//     somme de modificateurs SEULS pour l'affichage cuisine, sur le type
//     `BusModifierLine` du bus (pas un CartItem), sans unit_price ni quantité.
//     Ce n'est pas un total de ligne ; le jour où le payload bus transporte les
//     composants (extension additive à décider, ADR-017 conséquence 5), ce site
//     migrera vers un helper et l'entrée tombera.
//
// PÉRIMÈTRE — apps/ (pos ET backoffice). `packages/domain` est LA maison de la
// formule : il n'est pas balayé. `packages/ui` ne manipule pas de CartItem.
//
// RÉGIME — PLAFOND COMPTÉ, JAMAIS PLANCHER.

import { runGuard } from './_guard-lib.mjs';

// Trois formes de la recomposition, sur le masque sans commentaires :
//   · `.unit_price +`            — la base qu'on additionne à la main ;
//   · `+ x.price_adjustment`     — l'accumulation d'ajustements (reduce) ;
//   · `price_adjustment +`       — la même, opérande gauche.
// Un simple TRANSPORT (`price_adjustment: m.price_adjustment`) ou un ternaire
// (`sl.unit_price : item.unit_price`) ne matchent pas : sans opérateur `+`
// collé au champ, il n'y a pas de formule.
const PATTERNS = [
  /\.unit_price\s*\+/g,
  /\+\s*[A-Za-z_$][\w$]*\.price_adjustment\b/g,
  /\.price_adjustment\s*\+/g,
];

function collect(file, masked, raw) {
  const lines = masked.split('\n');
  const rawLines = raw.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    for (const re of PATTERNS) {
      re.lastIndex = 0;
      if (re.test(lines[i])) {
        hits.push({
          key: file,
          file,
          line: i + 1,
          text: `« ${(rawLines[i] ?? '').trim().slice(0, 120)} »`,
        });
        break; // une ligne = une occurrence, même si plusieurs motifs matchent
      }
    }
  }
  return hits;
}

runGuard({
  number: 10,
  title: 'la formule de prix de ligne ne se réécrit pas hors domaine',
  baselinePath: 'scripts/ci/line-total-formula-baseline.txt',
  scanned: ['apps/'],
  extRe: /\.(tsx|ts)$/,
  collect,
  scannedLabel: 'recompositions de prix de ligne',
  whatToDo: [
    'QUOI FAIRE — dans cet ordre :',
    '',
    '  1. Le prix d\'une ligne se demande, il ne se recalcule pas :',
    '     `lineTotalOf(item)` pour le total (arrondi compris),',
    '     `lineUnitEach(item)` pour le prix unitaire effectif —',
    '     `import { lineTotalOf, lineUnitEach } from \'@breakery/domain\'`.',
    '',
    '  2. Ta formule locale « marche » ? Elle a déjà eu raison trois fois avant',
    '     de sous-facturer les combos : elle ignore les ajustements des',
    '     modificateurs de composants (ADR-017) et l\'arrondi de facturation.',
    '     La formule du domaine et la tienne divergent au premier changement.',
    '',
    '  3. Tu additionnes des price_adjustment SEULS (pas un total de ligne) ?',
    '     C\'est `calculatePriceAdjustment(modifiers)` du domaine — même import.',
    '',
    '  4. Un cas qui n\'est vraiment ni l\'un ni l\'autre (type hors CartItem,',
    '     payload de bus…) s\'écrit d\'abord comme exception NOMMÉE dans l\'en-tête',
    '     de cette garde, validée par le propriétaire — la baseline ne',
    '     s\'allonge pas d\'elle-même.',
  ],
});
