# ADR-007 — Domaine Produits/Catalogue : périmètre, garde-fous money-path, sort des champs morts

> **Date** : 2026-07-17
> **Statut** : ✅ Accepted (2026-07-17)
> **Décideurs** : propriétaire The Breakery (guichduh33)
> **Supersedes** : —

## Contexte

Le 2026-07-17, un audit en lecture seule a été mené sur tout le domaine
Produits/Catalogue : les écrans produits, catégories, sections et recettes,
ainsi que l'usage réel de chacune des 39 colonnes de la table `products`
(vérifié dans le code et dans les migrations en production).

Le bilan général est bon : l'import/export du catalogue est fiable et
rejouable sans doublon, et l'historique des ventes ne bouge pas quand on
modifie le catalogue. En revanche, l'audit a trouvé deux problèmes de
gouvernance, trois fonctionnalités « fantômes » (des champs qu'on peut
remplir mais qui ne servent à rien), et un périmètre du domaine qui n'avait
jamais été formellement décidé.

## 1. Décisions

### Décision 1 — Le domaine est découpé en deux fiches d'objectifs

Il y aura deux documents de référence distincts :

- **`docs/objectifs/PRODUCTS.md`** couvre le catalogue : les produits, les
  catégories, les modifiers, les variantes, les combos, les recettes et
  semi-finis, et le calcul des coûts. Cette fiche répond à la question :
  « qu'est-ce qui est vendable, comment c'est composé, et combien ça coûte ? »
- **`docs/objectifs/INVENTORY.md`** couvrira le stock : les quantités, les
  inventaires (opname), les pertes, les transferts et les ajustements. Cette
  fiche répondra à la question : « qu'est-ce qu'on possède et comment ça
  bouge ? » Un audit dédié reste à mener avant de l'écrire.

La frontière entre les deux : les recettes et les semi-finis appartiennent à
PRODUCTS ; les mouvements de stock qu'ils provoquent appartiennent à INVENTORY.

### Décision 2 — Un produit inactif ne peut plus être vendu (refus strict)

**Le constat** : aujourd'hui, la RPC de paiement
(`complete_order_with_payment_v18`) accepte de vendre un produit désactivé
(`is_active = false`) ou masqué du POS (`visible_on_pos = false`). Ces deux
drapeaux ne servent qu'à cacher le produit à l'écran — rien n'empêche de
l'encaisser quand même.

**La décision** : la RPC de paiement refusera désormais de vendre un produit
inactif, avec une erreur explicite affichée au caissier.

La règle est stricte, sans exception : si un produit est désactivé après
avoir été ajouté au panier mais avant le paiement, le paiement est refusé
avec un message clair du type « produit X désactivé, retirez-le du panier ».
Il n'y a pas de tolérance pour les produits déjà présents dans le panier.

Le drapeau `visible_on_pos` ne change pas : il reste un simple filtre
d'affichage. Un produit masqué du POS reste vendable (masqué ≠ invendable).

**Conséquence technique** : c'est un chantier money-path. Il faudra une
nouvelle version de la RPC (`_vN+1`, jamais de modification de la version
publiée) et des tests pgTAP obligatoires.

### Décision 3 — La fenêtre horaire des combos est supprimée

**Le constat** : les champs `combo_available_from` et `combo_available_to`
sont remplis par le formulaire de combo, mais aucun code ne les lit jamais.
C'est une fonctionnalité fantôme. Par ailleurs, le besoin « happy hour »
est déjà couvert par le système de promotions (ADR-006, décision 10 : les
fenêtres par jour et par horaire sont livrées et réellement appliquées par
`evaluate_promotions_v2`).

**La décision** : on retire ces champs du formulaire combo et on déprécie
les colonnes. Il n'y aura qu'un seul mécanisme horaire dans le produit :
les promotions.

### Décision 4 — La colonne `products.tax_inclusive` est supprimée

**Le constat** : cette colonne est morte. Plus rien ne l'écrit depuis la
migration `_180` et plus rien ne la lit. Le mode fiscal est entièrement géré
par `business_config` via le helper `_pb1_split_v1` (Lot 6a).

**La décision** : la colonne sera supprimée (DROP) dans une migration
dédiée, suivie d'une régénération des types TypeScript.

### Décision 5 — L'écran Sections passe par des RPCs comme tout le reste

**Le constat** : le hook `useSectionsList.ts` (lignes 51-85) écrit
directement dans la table `sections`. C'est le seul écran du domaine qui
contourne le pattern habituel : RPC SECURITY DEFINER + traçage dans
`audit_logs`.

**La décision** : le CRUD des sections passera par des RPCs versionnées et
auditées, comme le reste du module. C'est un petit chantier, hors money-path.

### Décision 6 — Le drapeau `is_test` devient posable depuis l'interface

**Le constat** : le drapeau `is_test` est bien lu (il exclut les données de
test des rapports), mais on ne peut le poser qu'en SQL manuel — c'est
l'inverse d'un champ mort. La commande de test géante de la session S78
(3,5 milliards d'IDR à purger des données) est exactement le genre
d'accident que ce drapeau évite.

**La décision** : un interrupteur sera ajouté sur la fiche produit,
réservé aux rôles admin et super-admin.

## 2. Micro-arbitrages renvoyés au backlog de la fiche (pas de décision ADR)

Les points suivants sont réels mais mineurs. Ils vivent dans le backlog de
`docs/objectifs/PRODUCTS.md` et se décideront au fil de l'eau :

- `combo_display_order` est écrit mais jamais appliqué : le POS trie en
  réalité les combos par nom.
- `wholesale_price` est sélectionné et transporté par le POS sans jamais
  servir, puisque le prix B2B est résolu côté serveur. Le POS peut arrêter
  de le charger.
- La `description` d'un produit n'apparaît nulle part côté client (seulement
  dans l'export et le formulaire combo). Soit on la branche quelque part
  (ticket ? écran client ?), soit on assume qu'elle est purement interne.
- La pastille « Recipes » redirige en boucle vers /products (comportement
  verrouillé par un smoke test). Il faut soit créer une vraie liste de
  recettes, soit retirer la pastille.
- L'onglet Modifiers est absent de VALID_TABS : impossible d'y accéder par
  une URL directe.
- `cost_price` reflète le coût moyen pondéré du jour, sans photo au moment
  de la vente : la marge (`get_gross_margin_by_product_v1`) est donc
  valorisée au coût actuel et non au coût historique. C'est une limite
  connue et déjà documentée — aucun chantier n'est ouvert ici.

## 3. Ce qui est confirmé sain (aucune action)

- L'import/export du catalogue : dry-run, commit, et rejouable sans doublon.
- Les photos de vente (`order_items.name_snapshot`, etc.) : l'historique des
  ventes ne change pas si on renomme ou supprime un produit du catalogue.
- La classification des produits est calculée côté client
  (`classifyProduct`) : il n'existe pas d'écran « types de produits », et ce
  n'est pas un manque — la donnée source suffit.
- Les permissions sont bien découpées par onglet
  (products.variants.write, products.modifiers.update, etc.).

## 4. Conséquences

- La fiche `docs/objectifs/PRODUCTS.md` (même date) est alignée sur ces
  décisions.
- Les décisions 2 et 4 touchent le schéma et le money-path : elles exigent
  des migrations versionnées, des tests pgTAP, une régénération des types,
  et des specs courtes si besoin.
- L'audit INVENTORY (opname, pertes, transferts, `stock_movements`) reste à
  mener. Il produira la deuxième fiche et, si nécessaire, son propre ADR.

## 5. Révision

Les décisions 2, 3 et 6 ne se rouvrent que par un nouvel ADR. Les items du
§2 vivent au backlog de la fiche et se décident au fil de l'eau par le
propriétaire.
