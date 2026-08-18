#!/usr/bin/env node
// GARDE 5 — aucun contrôle écrit à la main sans anneau de focus ni placeholder
// tokenisé, dans le back-office.
//
// LE DÉFAUT. Un `<input>`, `<select>` ou `<textarea>` écrit à la main, hors du
// primitif `Input`/`Select`, ne tombe pas dans le vide : il retombe sur l'anneau
// de focus du NAVIGATEUR. C'est ce qui rend le défaut invisible — quelque chose
// s'affiche. Mesuré au navigateur le 2026-08-18 : `auto 1px` à 2,398:1 sur la
// feuille blanche, sous les 3:1 des objets graphiques (WCAG 1.4.11 / 2.4.11).
// Même mécanique pour le placeholder : sans `placeholder:text-*`, il prend le
// `gray-400` du Preflight Tailwind, 2,208:1 sur le papier de page (WCAG 1.4.3).
//
// POURQUOI CETTE GARDE EXISTE. Le relevé de DESIGN.md annonçait « trente-cinq
// champs dans quinze fichiers ». Le chiffre était exact pour la SIGNATURE DE
// CLASSE qu'il décrivait et faux comme compte de population : il en existait
// cent-soixante-dix-huit à cent-quatre-vingt-six, dans un second dialecte que la
// recherche par signature ne pouvait pas voir. La PR #415 les a tous corrigés.
// Sans garde, le prochain formulaire écrit naît non conforme et personne ne le
// sait — c'est exactement ce qui s'est passé entre les deux relevés.
//
// LA BASELINE EST VIDE, ET C'EST LE POINT. Cette garde ne gèle aucune dette :
// elle part de zéro et refuse la première régression. C'est la seule des quatre
// gardes de règles nommées dans ce cas, parce que son chantier est livré.
//
// CE QUI N'EST PAS UNE VIOLATION, et pourquoi :
//  · `type="hidden"` — rien à focaliser ;
//  · un contrôle `sr-only` retiré de l'ordre de tabulation (`tabIndex={-1}`) —
//    le motif du champ de fichier caché derrière un bouton qui, lui, a son
//    anneau ;
//  · un contrôle qui renonce explicitement à son anneau (`focus-visible:
//    outline-none`) DANS un fichier qui porte `FOCUS_WITHIN_RING` — c'est le
//    motif documenté du champ transparent posé dans une boîte bordée, où
//    l'anneau appartient au conteneur ;
//  · un `className` qui consomme `selectClassName` / `inputClassName` de
//    @breakery/ui — ces chaînes canoniques portent déjà l'anneau ;
//  · l'écran de connexion, stylé par des règles CSS `.login-*` qui posent leur
//    propre focus, hors shell et hors direction ;
//  · les tests.
//
// PÉRIMÈTRE — `apps/backoffice/src/`. Le POS a ses propres cibles tactiles et sa
// propre doctrine de focus ; l'y étendre est un autre arbitrage.

import { runGuard, readOpenTag, localClassConstants, expandConstants, lineOf } from './_guard-lib.mjs';

const RING = /FOCUS_RING|focus-visible:outline-gold|focus-visible:ring|focus:ring|focus-visible:shadow-focus/;
const CANONICAL = ['selectClassName', 'inputClassName'];
const EXCLUDED = /\/Login\.tsx$/;

function collect(file, masked, raw) {
  if (EXCLUDED.test(file)) return [];
  const consts = localClassConstants(masked);
  const hasWithinRing = /FOCUS_WITHIN_RING|focus-within:outline/.test(masked);
  const imported = CANONICAL.filter((n) => new RegExp(`import[^;]*\\b${n}\\b[^;]*from`).test(masked));
  const hits = [];

  for (const tagName of ['input', 'select', 'textarea']) {
    const re = new RegExp(`<${tagName}(?=[\\s/>])`, 'g');
    let m;
    while ((m = re.exec(masked))) {
      const span = readOpenTag(masked, m.index);
      if (span === null) continue;
      const tag = masked.slice(span.start, span.end);

      if (/type=["']hidden["']/.test(tag)) continue;
      if (/\bsr-only\b|className="hidden"/.test(tag) && /tabIndex=\{-1\}/.test(tag)) continue;

      let seen = expandConstants(tag, consts);
      for (const n of imported) {
        if (new RegExp(`\\b${n}\\b`).test(tag)) seen += ' focus-visible:outline-gold ';
      }

      const optsOut = /focus-visible:outline-none|focus:outline-none/.test(seen) && hasWithinRing;
      const noRing = !RING.test(seen) && !optsOut;
      const nakedPlaceholder = /placeholder=/.test(tag) && !/placeholder:text-/.test(seen);
      if (!noRing && !nakedPlaceholder) continue;

      const line = lineOf(masked, m.index);
      const what = noRing && nakedPlaceholder ? 'ni anneau de focus ni placeholder tokenisé'
        : noRing ? 'pas d\'anneau de focus'
        : 'placeholder non tokenisé';
      hits.push({
        key: file,
        file,
        line,
        text: `<${tagName}> — ${what} · ${(raw.split(/\r?\n/)[line - 1] ?? '').trim().slice(0, 120)}`,
      });
    }
  }
  return hits;
}

runGuard({
  number: 5,
  title: 'aucun contrôle sans anneau de focus ni placeholder tokenisé',
  baselinePath: 'scripts/ci/focus-ring-controls-baseline.txt',
  scanned: ['apps/backoffice/src/'],
  extRe: /\.tsx$/,
  collect,
  scannedLabel: 'balises input/select/textarea écrites à la main',
  whatToDo: [
    'QUOI FAIRE — dans cet ordre :',
    '',
    '  1. Prends le primitif `Input` ou `Select` de @breakery/ui quand la géométrie',
    '     s\'y prête. Ils portent l\'anneau, le placeholder tokenisé et la bordure.',
    '',
    '  2. Sinon, ajoute `${FOCUS_RING}` (@/components/focusRing.js) à la chaîne de',
    '     classe, et `placeholder:text-text-muted` si le contrôle a un placeholder.',
    '     Forme cible :',
    '       `… bg-bg-base border border-border-subtle rounded',
    '        placeholder:text-text-muted ${FOCUS_RING}`',
    '',
    '  3. Si la boîte visible n\'est PAS le contrôle — champ transparent dans un',
    '     conteneur bordé qui porte aussi une icône — pose `FOCUS_WITHIN_RING` sur le',
    '     conteneur et `focus-visible:outline-none` sur le contrôle. Un anneau sur le',
    '     contrôle seul se dessinerait à l\'intérieur de la bordure.',
    '',
    '  4. La classe vient d\'une CONSTANTE ? Corrige la constante, pas ses appels.',
  ],
});
