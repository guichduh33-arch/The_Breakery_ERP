#!/usr/bin/env node
// GARDE 6 — l'or ne remplit rien dans le back-office (The Ink-Not-Gold Rule).
//
// LA RÈGLE, telle que DESIGN.md § Colors la nomme : « L'or ne remplit jamais une
// surface dans le back-office. Il souligne, il colore un texte, il marque un
// focus. Un bouton doré appartient à la caisse, pas ici. » Le test de la règle
// est écrit à côté d'elle : si vous retirez tous les aplats d'or de l'écran,
// rien ne doit disparaître — seul le sens de lecture s'appauvrit.
//
// TROIS EXCEPTIONS, NOMMÉES ET CLOSES : la piste d'interrupteur et le point
// d'état, que le test de la règle excuse parce que retirer leur remplissage
// supprime l'INFORMATION D'ÉTAT ; et la plaque du monogramme, maintenue par
// arbitrage du propriétaire et qui, elle, échoue au test. DESIGN.md le dit :
// « la liste ne s'allonge pas d'elle-même ». La baseline de cette garde est ce
// non-allongement rendu opposable.
//
// CE QUE LA GARDE VOIT : les utilitaires de REMPLISSAGE — `bg-gold*` — et
// `variant="gold"` écrit dans le back-office. `text-gold`, `border-gold`,
// `outline-gold`, `ring-gold`, `decoration-gold` sont l'or COMME ENCRE : la
// règle les autorise explicitement, la garde les ignore.
//
// CE QU'ELLE NE VOIT PAS, et il faut le savoir : un primitif PARTAGÉ qui remplit
// en or dans son propre code. `EmptyState` rend son action-objet en
// `<Button variant="gold">` sans que l'appelant écrive le mot « gold » — la
// garde ne peut donc pas l'attraper depuis `apps/backoffice/`. C'est un écart
// relevé le 2026-08-18 et nommé dans DESIGN.md ; il se corrige dans le primitif,
// pas ici. Étendre la garde à `packages/ui/` demanderait de distinguer ce qui
// rend sous le thème back-office de ce qui rend sous la caisse, où un bouton
// doré est légitime — c'est un autre chantier.
//
// PÉRIMÈTRE — `apps/backoffice/src/` seulement, pour cette raison exacte.
//
// RÉGIME — PLAFOND COMPTÉ, JAMAIS PLANCHER.

import { runGuard, maskComments, lineOf } from './_guard-lib.mjs';

// Remplissage seulement. La liste vient du preset : `gold`, `gold-hover`,
// `gold-strong`, `gold-soft`, `gold-fg`, `ink-gold`.
const FILL = /\bbg-(?:ink-)?gold(?:-(?:hover|strong|soft|fg))?\b(?:\/\d+)?/g;
const VARIANT = /variant\s*=\s*["']gold["']/g;

function collect(file, masked, raw) {
  const lines = masked.split('\n');
  const rawLines = raw.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    for (const re of [FILL, VARIANT]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(lines[i]))) {
        hits.push({
          key: file,
          file,
          line: i + 1,
          text: `« ${m[0]} » · ${(rawLines[i] ?? '').trim().slice(0, 120)}`,
        });
      }
    }
  }
  return hits;
}

runGuard({
  number: 6,
  title: 'aucun aplat d\'or hors baseline',
  baselinePath: 'scripts/ci/gold-fills-baseline.txt',
  scanned: ['apps/backoffice/src/'],
  extRe: /\.(tsx|ts)$/,
  collect,
  scannedLabel: 'utilitaires bg-gold* et variant="gold"',
  whatToDo: [
    'QUOI FAIRE — dans cet ordre :',
    '',
    '  1. Applique le TEST DE LA RÈGLE, il est dans DESIGN.md : retire le remplissage.',
    '     Si l\'écran ne perd que du sens de lecture, l\'or était un décor — passe à',
    '     `text-gold` (lien, prix), `border-gold` ou `outline-gold` (focus, état actif).',
    '     Si l\'écran perd une INFORMATION D\'ÉTAT, tu es sur une piste d\'interrupteur ou',
    '     un point d\'état : ce sont les deux seules exceptions que le test excuse, et',
    '     elles sont déjà dans la baseline.',
    '',
    '  2. Un bouton qui doit peser prend l\'ENCRE, pas l\'or — `TOOLBAR_BTN_PRIMARY`',
    '     dans un bandeau de page, `<Button variant="ink">` ailleurs. Et un seul par',
    '     écran : The One Ink Fill Rule.',
    '',
    '  3. Tu crois avoir une quatrième exception ? Elle ne s\'ajoute pas ici. Elle',
    '     s\'écrit d\'abord dans DESIGN.md § Named Rules, avec son motif et sa mesure de',
    '     contraste, validée par le propriétaire — la liste des aplats d\'or ne',
    '     s\'allonge pas d\'elle-même.',
  ],
});
