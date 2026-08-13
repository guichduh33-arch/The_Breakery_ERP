// apps/backoffice/src/components/focusRing.ts
//
// L'anneau de focus de la direction : contour de 2 px décalé de 2 px, couleur
// `gold`. Même parti que `toolbarButton.ts` — une CHAÎNE de classes et non un
// composant, pour s'appliquer indifféremment à un `<button>`, un `<input>`, un
// `<select>` ou un `<a>`.
//
// Les primitifs de `@breakery/ui` le portent déjà. Cette constante est pour les
// contrôles écrits à la main dans les features, qui retombaient sinon sur
// l'anneau par défaut du navigateur — mesuré à 2,09-2,40:1, sous le seuil de
// 3:1 des objets graphiques (WCAG 1.4.11 / 2.4.11). Audit du 2026-08-11.
export const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold';

// Même anneau, porté par le CONTENEUR. À réserver aux champs dont la boîte
// visible n'est pas le contrôle lui-même — un `<input>`/`<select>` transparent
// posé dans une boîte bordée qui porte aussi une icône. Un anneau sur le
// contrôle seul se dessinerait alors À L'INTÉRIEUR de la bordure, chevauchant
// le liseré au lieu de désigner le champ. Le contrôle renonce à son anneau
// natif (`focus-visible:outline-none`) pour ne pas en afficher deux.
export const FOCUS_WITHIN_RING =
  'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-gold';
