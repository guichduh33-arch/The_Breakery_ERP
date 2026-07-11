# Design — Bouton HOLD de premier niveau au POS (caisse)

> Date : 2026-07-10 · Branche : `feat/pos-hold-button` · Portée : `apps/pos` (UI pure, **zéro RPC / zéro migration**)

## Problème (rapporté par le propriétaire)

Une commande Held **rouverte** ne peut « pas être renvoyée en Held si aucun item n'est ajouté ».
Cas d'usage : le caissier rouvre une commande pour la vérifier, puis veut basculer sur une autre
commande — il doit pouvoir la remettre en attente sans être forcé d'ajouter un article.

## Constat de code (état `master`, 2026-07-10)

La capacité **existe déjà** (commit « Spec A fix », test vert `rehold-fired-order.smoke.test.tsx`) :

- Dans `BottomActionBar`, quand une commande **fired** est rouverte (`pickedUpOrderId` non-null),
  l'action **Hold** re-park la commande via `hold_fired_order_v1` et libère le terminal —
  **sans exiger d'item ajouté**. Elle n'est désactivée que s'il reste des lignes **neuves
  non-firées** (dans ce cas : passer d'abord par « Send to Kitchen » qui fire **et** park).
- Un panier frais/draft avec items → `hold_order_v1` via `HoldOrderButton` (chemin draft, note optionnelle).

**La cause du ressenti « impossible » = découvrabilité** : ce Hold est enterré dans le menu
**« More ▾ »** du bottom bar. Le caissier ne voit pas de bouton « Hold » évident.

## Invariant à préserver (vérifié intact — NE JAMAIS modifier)

Il reste **impossible de ré-envoyer en cuisine un item déjà envoyé** :

- `useFireToStations` : `firableCount` ne compte que les lignes **non imprimées** ; le fire n'envoie
  au RPC que `unprinted.filter(non-locked)` ; après un fire les lignes sont scellées
  `markLocked` + `markPrinted` → exclues de tout fire ultérieur.
- « Send to Kitchen » est `disabled` dès que `firableCount === 0` (commande entièrement firée).

Ce changement **ne touche aucune de ces logiques** (fire / lock / print) — l'invariant reste intact.
Un test de non-régression le verrouille.

## Décision (validée par le propriétaire, 2026-07-10)

Promouvoir HOLD en **bouton dédié visible** dans le groupe gauche « management » du bottom bar,
**juste après « Held Orders »**, et **le retirer du menu « More ▾ »** (pas de doublon).

## Design

Relocaliser le bloc Hold existant (deux branches) depuis le menu `More ▾` vers un slot de premier
niveau dans le groupe gauche, stylé comme les autres boutons ghost (`GHOST_BTN`, `h-11`) :

- **Commande fired rouverte** (`pickedUpOrderId !== null`) → bouton dédié `hold_fired_order_v1`
  (`handleReholdFired`, déjà présent). Désactivé si `hasUnfiredItems || holdFired.isPending`,
  avec `title` « Send the new items to the kitchen first ».
- **Sinon** (panier frais/draft) → `<HoldOrderButton>` (chemin `hold_order_v1` + `HoldNoteModal`
  inchangés), rendu avec `className={GHOST_BTN}`. Désactivé quand le panier est vide (comportement
  existant du composant). Toujours visible (désactivé plutôt que masqué) pour éviter le décalage de
  layout — cohérent avec le bouton « Held Orders » (désactivé quand `heldCount === 0`).

L'entrée « Hold » disparaît du menu `More ▾` (ne restent que « Apply discount » / « Redeem points »).

Icône `PauseCircle`, libellé « Hold » (cohérent avec la copie existante et la casse des autres
boutons ghost).

## Réutilisation / limites de la modif

- `HoldOrderButton` reste un composant réutilisable **inchangé** (il possède la note modal +
  `hold_order_v1` + clear cart). Ses tests standalone (`hold-order-db.smoke`, `held-orders.smoke`)
  restent verts (ils le rendent en isolation, indépendamment du placement).
- Le `cn` (tailwind-merge) de `@breakery/ui` `Button` résout le conflit de hauteur en faveur du
  `className` → `GHOST_BTN` (`h-11`) gouverne l'apparence, comme la branche `MENU_ITEM` actuelle.

## Tests

- **Adapter** `rehold-fired-order.smoke.test.tsx` : cibler le bouton HOLD de premier niveau (plus
  besoin d'ouvrir `More ▾`) ; garder les deux assertions (re-park via `hold_fired_order_v1` sans
  changement ; désactivé s'il y a des lignes non-firées) + vérifier que « Hold » n'est plus dans
  `More ▾`.
- **Non-régression invariant** : conserver `send-to-kitchen-holds.smoke.test.tsx` (fire → hold →
  reset) et l'existant qui prouve qu'une ligne firée n'est pas re-firable.
- Draft-hold : `hold-order-db.smoke.test.tsx` / `held-orders.smoke.test.tsx` inchangés (verts).

## Hors périmètre

- Tablette (WAITER) : la plainte vise le **caissier** (CAISSE desktop / `BottomActionBar`). Pas de
  changement `TabletCartPanel` dans cette passe.
- Aucun changement serveur (RPC / migration / EF).
