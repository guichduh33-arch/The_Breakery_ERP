#!/usr/bin/env node
// GARDE 7 — aucune classe de police qui nomme le contraire de ce qu'elle fait.
//
// LE DÉFAUT, et pourquoi il est retors. Sous `.theme-backoffice`, `--font-display`
// est REMAPPÉ sur la pile du corps et `--font-serif` n'en est qu'un alias : une
// classe `font-display` ou `font-serif` écrite dans le back-office ne produit
// donc AUCUN serif. Le rendu est correct. Le mot est faux.
//
// Ce n'est pas une violation de The Playfair-Is-Brand-Only Rule — cette règle
// porte sur ce qui REND, et rien ne rend en Playfair hors de la marque. C'est un
// défaut d'une autre espèce, et plus durable : un auteur qui LIT ces classes
// croit la règle enfreinte et « corrige » ce qui va bien ; un auteur qui les
// RECOPIE propage le mensonge dans un fichier neuf. Le jour où quelqu'un déremappe
// `--font-display`, elles se mettent toutes à rendre du serif d'un coup, et
// personne n'aura décidé ça.
//
// LA MARQUE A SON UTILITAIRE, ET LUI SEUL : `font-brand` (`--font-brand`). Il est
// exposé par le preset depuis le 2026-08-18 — avant cette date le monogramme
// portait `font-display` et ne rendait donc pas Playfair : le seul endroit où le
// serif devait survivre était précisément le seul qui ne le produisait pas,
// pendant que trois documents affirmaient l'inverse. C'est l'histoire de cette
// classe de défaut, et la raison de cette garde.
//
// CIBLE : zéro. La baseline recense ce qui existait le jour de la naissance de la
// garde ; chaque fichier touché la fait descendre.
//
// PÉRIMÈTRE — `apps/backoffice/src/`. Sous le thème de la caisse le remappage
// n'existe pas : `font-display` y rend ce qu'il annonce, et la même classe n'est
// pas la même faute.
//
// RÉGIME — PLAFOND COMPTÉ, JAMAIS PLANCHER.

import { runGuard } from './_guard-lib.mjs';

const LYING = /\bfont-(?:serif|display)\b/g;

function collect(file, masked, raw) {
  const lines = masked.split('\n');
  const rawLines = raw.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    LYING.lastIndex = 0;
    let m;
    while ((m = LYING.exec(lines[i]))) {
      hits.push({
        key: file,
        file,
        line: i + 1,
        text: `« ${m[0]} » ne rend aucun serif sous ce thème · ${(rawLines[i] ?? '').trim().slice(0, 120)}`,
      });
    }
  }
  return hits;
}

runGuard({
  number: 7,
  title: 'aucune classe de police qui nomme le contraire de ce qu\'elle fait',
  baselinePath: 'scripts/ci/lying-font-classes-baseline.txt',
  scanned: ['apps/backoffice/src/'],
  extRe: /\.(tsx|ts|css)$/,
  collect,
  scannedLabel: 'occurrences de font-serif / font-display',
  whatToDo: [
    'QUOI FAIRE — choisis selon ce que la surface EST :',
    '',
    '  1. C\'est la MARQUE — le monogramme de la barre, la marque du splash ? Prends',
    '     `font-brand`. C\'est le seul utilitaire qui sorte Playfair sous ce thème.',
    '',
    '  2. C\'est un TITRE de page, de carte, de section ? Retire simplement la classe :',
    '     la pile du corps est déjà ce qui rend, et le rôle se porte par le corps et',
    '     la graisse (§ Typography). Le rendu ne bougera pas d\'un pixel.',
    '',
    '  3. C\'est une DONNÉE — un montant, un compteur, un horodatage, un SKU ? Alors la',
    '     classe était doublement fausse : prends `font-data` (mono tabulaire), que',
    '     The Mono-Carries-Data Rule exige.',
  ],
});
