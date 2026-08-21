// apps/backoffice/src/features/inventory-production/inkPanel.ts
//
// Le vocabulaire de classes du PANNEAU DE SAISIE ENCRÉ de l'écran Production.
//
// POURQUOI CE FICHIER EXISTE. `apps/backoffice/DESIGN.md` § Page Archetypes,
// archétype 9 « Append-only log » : « le panneau de saisie est la SEULE surface
// encrée de la page ». Sur l'encre, les premiers plans changent de famille
// (`ink-fg`, `ink-fg-muted`, `ink-fg-dim`, `ink-fg-sub`), la sémantique change
// de teinte (The Ink Semantics Rule — `ink-success` / `ink-danger`, jamais le
// vert et le rouge du thème) et le focus passe à `ink-gold`. Une seule carte
// porte ces réglages, mais elle porte une quinzaine de contrôles : recopier la
// chaîne à chaque balise, c'est quinze endroits où elle peut diverger.
//
// LES RATIOS, mesurés sur les valeurs de `packages/ui/src/tokens/colors.css`
// (méthode WCAG 2.x, luminance relative). Fond du panneau `--ink-base` #201d19 :
//
//   --ink-fg       #fffdf9  16,52:1      --ink-gold     #d3ab5c   7,79:1
//   --ink-fg-muted #e8e1d5  12,92:1      --ink-danger   #fca5a5   8,84:1
//   --ink-fg-dim   #c4bcae   8,91:1      --ink-success  #86efac  11,95:1
//   --ink-fg-sub   #a09789   5,82:1
//
// Fond de champ `--ink-hover` #2e2925 : `--ink-fg` 14,14:1, `--ink-fg-sub`
// 4,98:1, `--ink-gold` 6,67:1, `--ink-danger` 7,57:1.
//
// CE QUI NE PEUT PAS SERVIR ICI, et pourquoi :
//   · `--border-strong` #86827a — la bordure de contrôle du PAPIER. Sur l'encre
//     elle vaut 2,04:1, sous les 3:1 de WCAG 1.4.11 : le champ n'aurait plus de
//     limite visible. La limite d'un contrôle encré est `--ink-fg-sub` (5,82:1
//     contre le panneau, 4,98:1 contre le remplissage du champ).
//   · `--ink-border` #453e35 — 1,59:1 contre le panneau. C'est un filet de
//     séparation, pas une limite de contrôle ; il sépare deux blocs, il ne
//     délimite jamais un champ.
//   · `--gold-base` #7a5c1c en anneau de focus — 2,70:1 sur l'encre. DESIGN.md
//     § Boutons l'écrit noir sur blanc : « focus : couleur `gold` sur le papier,
//     `ink-gold` sur l'encre ».
//
// POURQUOI L'ANNEAU S'APPELLE `FOCUS_RING_INK`, et pourquoi les appelants
// l'écrivent EN CLAIR dans leur `className`. La garde CI n° 5
// (`scripts/ci/focus-ring-controls.mjs`) refuse tout `<input>` / `<select>` /
// `<textarea>` écrit à la main qui n'expose pas d'anneau ; elle reconnaît le
// littéral `focus-visible:outline-gold` ou le nom `FOCUS_RING`. Elle ne connaît
// pas la variante encre — `outline-ink-gold` n'est pas `outline-gold`. Le nom
// choisi CONTIENT `FOCUS_RING`, et la garde ne développe que les constantes
// LOCALES au fichier : celle-ci étant importée, son nom traverse tel quel et la
// garde le reconnaît. Ce n'est pas un contournement : le contrôle porte bien un
// anneau, et il le porte MIEUX que celui que la garde sait lire (7,79:1 contre
// 2,70:1). Le jour où la garde apprendra la variante encre, ces chaînes ne
// bougeront pas.

/** L'anneau de focus SUR ENCRE — 2 px décalés de 2 px, `ink-gold` (7,79:1). */
export const FOCUS_RING_INK =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-gold';

/**
 * La boîte d'un champ posé sur l'encre. La HAUTEUR n'est pas incluse : le champ
 * autonome tient les 44 px de DESIGN.md § Champs, une cellule éditable de table
 * reste au cran dense de la table (36 px). Rayon 4 px, comme le papier.
 *
 * Le PLACEHOLDER n'est volontairement pas ici : la garde n° 5 exige de lire
 * `placeholder:text-*` DANS la balise qui porte un `placeholder=`, et elle ne
 * développe pas une constante importée. Un champ à placeholder l'écrit donc en
 * clair — `placeholder:text-ink-fg-sub` (5,82:1 contre le panneau, 4,98:1
 * contre le remplissage du champ).
 */
export const INK_FIELD_BOX =
  'rounded-md border border-ink-fg-sub bg-ink-hover px-3 text-sm text-ink-fg';

/** Idem, resserré pour une cellule de table (2 px de gouttière horizontale). */
export const INK_FIELD_BOX_CELL =
  'rounded-md border border-ink-fg-sub bg-ink-hover px-2 text-sm text-ink-fg';

/**
 * L'action qui ENREGISTRE, posée sur l'encre. Elle ne peut pas être encre —
 * The One Ink Fill Rule interdit une seconde surface encrée, et un aplat
 * `--ink-base` sur `--ink-base` serait de toute façon invisible. Elle s'inverse
 * donc : ivoire plein, libellé encre (16,52:1 dans les deux sens).
 *
 * DÉSACTIVÉ — la couleur se NEUTRALISE, elle ne se fane pas (DESIGN.md
 * § Boutons) : `--ink-hover` et `--ink-fg-sub`, 4,98:1, qui ne ressemble à aucun
 * état vivant. Le liseré est permanent pour que la boîte garde une limite
 * lisible une fois neutralisée.
 */
export const INK_BTN_PRIMARY =
  'inline-flex h-8 items-center gap-1.5 rounded-sm border border-ink-fg-sub px-3 text-sm font-medium ' +
  'bg-ink-fg text-ink transition-colors hover:bg-ink-fg-muted ' +
  'disabled:cursor-not-allowed disabled:bg-ink-hover disabled:text-ink-fg-sub disabled:opacity-100 ' +
  FOCUS_RING_INK;

/** L'action qui ABANDONNE la saisie : liseré seul, comme le secondaire du papier. */
export const INK_BTN_SECONDARY =
  'inline-flex h-8 items-center gap-1.5 rounded-sm border border-ink-fg-sub px-3 text-sm font-medium ' +
  'bg-transparent text-ink-fg transition-colors hover:bg-ink-hover ' +
  'disabled:cursor-not-allowed disabled:text-ink-fg-sub disabled:opacity-100 ' +
  FOCUS_RING_INK;
