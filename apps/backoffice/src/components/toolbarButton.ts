// apps/backoffice/src/components/toolbarButton.ts
//
// Les boutons d'action d'un bandeau de page (direction « Instrument »).
//
// Ce sont des CHAÎNES de classes et non un composant : les mêmes trois styles
// doivent s'appliquer indifféremment à un `<button>`, à un `<Link>` de
// react-router et à un `<a>`. Un composant obligerait à un `as` polymorphe pour
// zéro gain — ici on compose.
//
// Le primaire est ENCRE, pas or. L'or a cessé d'être un remplissage à la
// refonte : il ne sert plus que d'encre de sens (nav active, liens, prix
// retail). Un seul bouton par bandeau porte le remplissage encre — celui qui
// crée quelque chose.

// DÉSACTIVÉ — la chaîne NEUTRALISE sa couleur au lieu de la faner, comme le
// primitif partagé le fait déjà (`Button` variants `ink` / `gold` / `primary` :
// `disabled:bg-surface-4 disabled:text-text-muted disabled:opacity-100`).
// DESIGN.md § Boutons : « les variants remplis neutralisent leur couleur au lieu
// de la faner ». `disabled:opacity-50` fanait l'aplat encre en un gris #888683
// sur le papier de page, où le libellé ivoire tombait à 2,04:1 — un bouton mort
// qui garde l'allure d'un bouton vivant (mesuré le 2026-08-18). Le cran neutre
// vaut 4,50:1 pour le texte muet, et il ne ressemble à aucun état vivant.
export const TOOLBAR_BTN =
  'inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-sm font-medium ' +
  'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ' +
  'disabled:cursor-not-allowed disabled:bg-surface-4 disabled:text-text-muted disabled:opacity-100';

export const TOOLBAR_BTN_SECONDARY =
  `${TOOLBAR_BTN} border border-border-strong bg-bg-elevated text-text-primary hover:bg-surface-4`;

export const TOOLBAR_BTN_PRIMARY =
  `${TOOLBAR_BTN} bg-ink text-ink-fg hover:bg-ink-hover`;

/** Icône posée dans un bouton secondaire — grise, elle ne concurrence pas le libellé. */
export const TOOLBAR_ICON = 'h-3.5 w-3.5 text-text-muted';
