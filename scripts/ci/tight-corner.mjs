#!/usr/bin/env node
// GARDE 9 — aucun coin entièrement rond dans le back-office (The Tight-Corner Rule).
//
// LA RÈGLE, telle que DESIGN.md § Named Rules la nomme : « Au-delà de 6 px, un
// rayon dans le back-office est une erreur. La rondeur appartient à la caisse,
// dont les cibles tactiles font 44 px et plus. » `rounded-full` est le cas
// extrême et le seul mesurable sans réimplémenter Tailwind : il ne demande pas
// 8 px ou 12 px, il demande un demi-cercle.
//
// POURQUOI ELLE NAÎT LE 2026-08-21. Les quatre dettes de design relevées le
// 2026-08-18 ont toutes été résorbées, mais UNE SEULE n'avait pas de garde :
// celle-ci. Le compte est passé de 41 à 21 sans qu'aucun exécuteur ne tienne le
// nouveau plancher — et le relevé du 2026-08-18 avait déjà établi que les seuls
// invariants tenus sur ce dépôt sont exactement ceux qui ont un script. Une
// dette qu'on vient de payer et qu'on laisse sans garde se re-creuse en silence ;
// c'est ce qui est arrivé aux quatre règles nommées entre leur écriture et leur
// outillage.
//
// LES EXCEPTIONS LÉGITIMES, NOMMÉES ET CLOSES — ce sont les 21 survivants du
// relevé du 2026-08-21, et la baseline est cette liste rendue opposable :
//
//   · SPINNER (2) — un indicateur de chargement qui tourne. Un carré qui tourne
//     n'est pas une attente, c'est une animation. `App`, `CommandPalette`.
//   · PASTILLE D'AVATAR (2) — la seule forme ronde que DESIGN.md autorise
//     explicitement. `CustomerAvatar`, l'initiale de `TopBar`.
//   · PISTE ET CURSEUR D'INTERRUPTEUR (6, soit trois interrupteurs) — retirer la
//     rondeur d'un interrupteur en fait une case à cocher : la forme PORTE
//     l'affordance. C'est déjà l'une des exceptions closes de la garde 6.
//     `CategoryFormDialog`, `BoulangerModeToggle`, `GeneralPanel`.
//   · POINT D'ÉTAT (11) — une puce de 6 à 8 px dont le remplissage EST
//     l'information (connecté, plus haut / plus bas, série de graphe active,
//     permission accordée). Carrée, elle lit comme une puce de liste.
//     `OrderDetailDrawer`, `StockAnalyticsPanel` ×2, `SupplierPriceEvolutionTab`,
//     `PanelCard`, `CustomerCategoriesPage`, `B2BDashboardPage`,
//     `OrderDetailPage`, `OrdersListPage`, `SettingsPermissionsPage` ×2.
//
// La liste ne s'allonge pas d'elle-même. Une quatrième famille d'exception
// s'écrit d'abord dans DESIGN.md § Named Rules, validée par le propriétaire —
// exactement comme pour les aplats d'or.
//
// CE QUE LA GARDE NE VOIT PAS, et il faut le savoir : un rayon intermédiaire
// (`rounded-xl`, `rounded-[10px]`) dépasse aussi les 6 px de la règle, mais
// l'échelle de Tailwind ne dit pas seule combien de pixels vaut un nom, et le
// preset peut la redéfinir. On tient donc le cas EXTRÊME, celui qui ne se
// discute pas, plutôt qu'un test approximatif qui crierait sur des rayons
// légitimes.
//
// PÉRIMÈTRE — `apps/backoffice/src/`. La caisse garde sa rondeur : `.theme-pos`
// est un autre système, avec d'autres cibles tactiles.
//
// RÉGIME — PLAFOND COMPTÉ, JAMAIS PLANCHER.

import { runGuard } from './_guard-lib.mjs';

// `rounded-full` seul, et ses variantes de préfixe (`hover:`, `sm:`, `group-`…)
// que la frontière de mot laisse passer devant. `rounded-full` ne prend pas de
// suffixe : `\b` ferme derrière.
const FULL = /\brounded-full\b/g;

function collect(file, masked, raw) {
  const lines = masked.split('\n');
  const rawLines = raw.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    FULL.lastIndex = 0;
    let m;
    while ((m = FULL.exec(lines[i]))) {
      hits.push({
        key: file,
        file,
        line: i + 1,
        text: `« ${m[0]} » · ${(rawLines[i] ?? '').trim().slice(0, 120)}`,
      });
    }
  }
  return hits;
}

runGuard({
  number: 9,
  title: 'aucun coin entièrement rond hors baseline',
  baselinePath: 'scripts/ci/tight-corner-baseline.txt',
  scanned: ['apps/backoffice/src/'],
  extRe: /\.(tsx|ts)$/,
  collect,
  scannedLabel: 'utilitaires rounded-full',
  whatToDo: [
    'QUOI FAIRE — dans cet ordre :',
    '',
    '  1. Applique le TEST DE LA RÈGLE : la rondeur PORTE-t-elle une information',
    '     ou une affordance ? Un point d\'état, une piste d\'interrupteur, une',
    '     pastille d\'avatar et un spinner disent quelque chose par leur forme —',
    '     ils sont dans la baseline. Un onglet, une pilule de filtre, un badge, un',
    '     bouton, une carte : la rondeur n\'y est qu\'un décor de caisse égaré.',
    '',
    '  2. Le remplacement par défaut est `rounded-sm` (3 px) pour un contrôle et',
    '     `rounded-md` (4 px) pour une surface — les deux crans que le back-office',
    '     emploie. Au-delà de 6 px, DESIGN.md § Named Rules dit « erreur ».',
    '',
    '  3. Une PILE de pilules rondes se lit comme une rangée de boutons de caisse.',
    '     Le back-office est un instrument : ses coins sont serrés, sa densité est',
    '     haute, et le pointeur n\'a pas besoin de 44 px.',
    '',
    '  4. Tu crois avoir une cinquième famille d\'exception ? Elle ne s\'ajoute pas',
    '     ici. Elle s\'écrit d\'abord dans DESIGN.md § Named Rules, avec son motif,',
    '     validée par le propriétaire — la liste ne s\'allonge pas d\'elle-même.',
  ],
});
