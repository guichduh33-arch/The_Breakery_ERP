# ADR-012 — Domaine Produits : résiduels de garde money-path et cohérence POS (post-audit code-vs-doc)

> **Date** : 2026-07-23
> **Statut** : ✅ Accepted (2026-07-23)
> **Décideurs** : propriétaire The Breakery (guichduh33)
> **Supersedes** : — (complète ADR-007 et ADR-011 sans les modifier)

## Contexte

Le 2026-07-23, un audit code-vs-doc du module products a comparé le code
(BO, POS, migrations, live V3 dev) à la fiche `docs/objectifs/PRODUCTS.md`
rev. 2 et aux ADR-007/011. Les chantiers ADR-007/011 sont confirmés livrés
et l'intégrité des données est saine (0 anomalie re-vérifiée). L'audit a en
revanche exposé trois trous de cohérence que ni les ADR ni le backlog ne
couvraient, tous trois dans la zone « le serveur est seul juge de la
vendabilité » (invariant 1 de la fiche) ou dans sa traduction à l'écran.

## 1. Décisions

### Décision 1 — Le refus des produits-parents s'étend aux composants de combo

**Le constat** : `complete_order_with_payment_v19` refuse un produit-parent
en ligne de commande (`product_is_parent`), mais ses composants de combo ne
sont contrôlés qu'en inactif/soft-deleted — un combo dont un composant est
un produit-parent passe la garde. La fiche rev. 2 affirmait à tort que les
composants étaient couverts ; le BO n'empêche pas aujourd'hui de configurer
un parent comme option de combo.

**La décision** : le refus `product_is_parent` s'applique aussi à chaque
composant de combo, avec la même erreur explicite. Chantier money-path
dédié : bump `_v20` + DROP v19 dans la même migration (règle ADR-011 déc. 4),
redéploiement des EFs consommatrices, pgTAP obligatoires (cas : combo avec
composant parent → refus ; combo sain → OK). En complément, hors money-path :
`upsert_combo_v1` (à son prochain bump, qui doit aussi DROPper
`combo_available_from/to`) refusera d'enregistrer un parent comme option.

### Décision 2 — La modale de variantes juge le sold-out comme la grille

**Le constat** : la tuile POS évalue la vendabilité via le helper domain
`isSellable` (compteur vitrine `display_stock` d'abord, fallback
`current_stock`). La modale `VariantSelectModal` teste, elle,
`deduct_stock && current_stock ≤ 0` sur des données qui n'incluent ni
`display_stock` ni `track_inventory` : une variante vitrine est jugée sur le
mauvais compteur. Deux définitions du « épuisé » coexistent pour le même
écran.

**La décision** : une seule règle de vendabilité affichée — la modale
s'aligne sur `isSellable` (le hook `useProductVariants` sélectionne les
champs manquants). Le check auto-pick ADR-011 §3 suit la même règle.
Rappel : c'est un confort d'affichage ; le filet opposable reste la garde
serveur (invariant 1 inchangé).

### Décision 3 — Les tuiles de produits-parents deviennent identifiables

**Le constat** : sur la grille POS, une tuile parent-à-variantes est
visuellement identique à un standalone ; seul le tap révèle la modale. Les
combos, eux, ont leur badge. Un caissier ne peut pas anticiper qu'une tuile
ouvrira un choix de variantes.

**La décision** : les tuiles parents portent un badge « Variantes »
(même mécanique que le badge combo, `has_variants` existe déjà côté
`useProducts`). Pur chantier UI POS, hors money-path.

## 2. Corrections sans décision (enregistrement)

- **pgTAP `catalog_import.test.sql` stale** : la suite asserte encore qu'un
  MANAGER peut importer/exporter, à rebours d'ADR-011 déc. 1 (permission
  retirée par `_200`). À corriger : les cas MANAGER attendent désormais
  `42501`, et le refus MANAGER devient une assertion explicite. Correction
  de tests, pas de changement de comportement — aucune décision à prendre.
- **Surfaces mortes UI** : zéros codés en dur affichés comme des données
  (OverviewPanel, bloc « Performance 30d »), `StubPanel.tsx` orphelin,
  onglet `analytics` fantôme du type `ProductDetailTab` — à brancher ou
  retirer au fil de l'eau (invariant 5 de la fiche), sans ADR.

## 3. Conséquences

- Chantiers, par ordre : (a) correction pgTAP import [petit, immédiat] ;
  (b) money-path `_v20` composants combo + pgTAP + redéploiement EFs
  [lourd, prioritaire] ; (c) parité sold-out modale [petit] ; (d) badge
  parent [petit] ; les surfaces mortes §2 au fil de l'eau.
- La fiche `docs/objectifs/PRODUCTS.md` passe en rev. 3 : compte de colonnes
  (36), portée exacte de la garde combo (alignée sur la décision 1), items
  backlog remplacés par les références à cet ADR.
- La garde étendue (déc. 1) respecte le versioning durci ADR-011 déc. 4 :
  aucun `CREATE OR REPLACE` sur v19.

## 4. Révision

Les décisions 1 à 3 ne se rouvrent que par un nouvel ADR. Les items du §2
sont des corrections d'hygiène, au fil de l'eau.
