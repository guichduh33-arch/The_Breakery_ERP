#!/usr/bin/env node
// GARDE 8 — les chaînes `TOOLBAR_BTN_*` n'existent que dans un bandeau de page.
//
// LA RÈGLE, telle que DESIGN.md § Boutons la nomme : « Ces chaînes appartiennent
// au bandeau de page, et à lui seul. Une action de panneau, de carte, de modale
// ou de formulaire prend le primitif partagé. »
//
// LE DÉFAUT QUE ÇA PRODUIT, mesuré. Les deux familles n'ont pas la même hauteur :
// la chaîne de bandeau fait 32 px, le primitif partagé rend 56 px par défaut
// (`defaultVariants: { size: 'md' }`) et 36 px en `sm`. Franchir la frontière
// dans un sens ou dans l'autre met donc DEUX HAUTEURS DE BOUTON SUR LE MÊME
// ÉCRAN. Relevé du 2026-08-18 : cinq rangées où un bouton de 32 px est collé à
// un bouton de 56 px, et le même contrôle « Load more » existait en 32, 36 et
// 56 px sur six pages. DESIGN.md annonçait « la frontière a été franchie une
// fois dans les deux sens » ; le compte réel était de trente-cinq.
//
// LE TEST, volontairement grossier et donc tenable : un fichier qui emploie
// `TOOLBAR_BTN_*` doit rendre `<PageHeader`. C'est une approximation — un fichier
// peut rendre un bandeau ET une modale — mais elle attrape la classe entière du
// défaut sans jamais demander à la garde de deviner ce qu'est un « bandeau ».
//
// TROIS CAS LÉGITIMES QUE LE TEST NE SAIT PAS VOIR, et que la baseline porte :
// les composants de bandeau INJECTÉS dans le `actions` d'un `PageHeader` par un
// autre fichier (`ExportMenu`, `PeriodControl`, servis par `ReportShell`), et le
// bandeau de fiche écrit à la main de la page client. Ce sont des exceptions de
// STRUCTURE, pas de règle.
//
// PÉRIMÈTRE — `apps/backoffice/src/`. Les chaînes n'existent pas ailleurs.
//
// RÉGIME — PLAFOND COMPTÉ, JAMAIS PLANCHER.

import { runGuard, lineOf } from './_guard-lib.mjs';

const USE = /\bTOOLBAR_BTN_[A-Z_]+\b/g;
const DECLARES_HEADER = /<PageHeader[\s/>]/;
// Le fichier qui DÉFINIT les chaînes n'en est pas un usage.
const SOURCE = /\/components\/toolbarButton\.ts$/;

function collect(file, masked, raw) {
  if (SOURCE.test(file)) return [];
  if (DECLARES_HEADER.test(masked)) return [];

  const lines = masked.split('\n');
  const rawLines = raw.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    // Un import n'est pas un emploi : c'est la ligne qui RÉFÉRENCE la chaîne
    // dans du JSX qui pose le bouton.
    if (/^\s*import\b/.test(lines[i])) continue;
    USE.lastIndex = 0;
    let m;
    while ((m = USE.exec(lines[i]))) {
      hits.push({
        key: file,
        file,
        line: i + 1,
        text: `« ${m[0] } » hors d'un fichier qui rend <PageHeader> · ${(rawLines[i] ?? '').trim().slice(0, 120)}`,
      });
    }
  }
  return hits;
}

runGuard({
  number: 8,
  title: 'aucune chaîne TOOLBAR_BTN_* hors d\'un bandeau de page',
  baselinePath: 'scripts/ci/toolbar-button-scope-baseline.txt',
  scanned: ['apps/backoffice/src/'],
  extRe: /\.(tsx|ts)$/,
  collect,
  scannedLabel: 'emplois de TOOLBAR_BTN_*',
  whatToDo: [
    'QUOI FAIRE :',
    '',
    '  1. Le bouton est dans une MODALE, un PIED DE TABLE, un PANNEAU, une CARTE, un',
    '     FORMULAIRE ? Prends le primitif partagé, en `sm` :',
    '       <Button size="sm" variant="ink">…</Button>      (l\'action qui engage)',
    '       <Button size="sm" variant="secondary">…</Button> (tout le reste)',
    '     `size="sm"` n\'est pas optionnel : sans lui le primitif rend son défaut `md`,',
    '     soit 56 px, et tu auras déplacé le problème au lieu de le régler.',
    '',
    '  2. Le bouton est bien dans un BANDEAU DE PAGE ? Alors passe par `<PageHeader',
    '     actions={…}>` — c\'est la source unique du bandeau, et c\'est ce que la garde',
    '     cherche. Un bandeau écrit à la main est un second défaut, pas une exception.',
    '',
    '  3. Le composant est INJECTÉ dans le `actions` d\'un PageHeader rendu ailleurs ?',
    '     C\'est le cas des composants servis par `ReportShell`. Ceux qui existaient au',
    '     2026-08-18 sont dans la baseline ; un nouveau se discute avant d\'être écrit,',
    '     parce que chacun rend la frontière un peu moins lisible.',
  ],
});
