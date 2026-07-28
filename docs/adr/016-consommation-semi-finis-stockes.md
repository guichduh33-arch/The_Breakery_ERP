# ADR-016 — Une production consomme un semi-fini stocké depuis son stock

> **Date :** 2026-07-28 · **Statut : ACTÉ** (décision propriétaire, séance ADR-008 phase 1)
> **Précise :** ADR-008 D1

## Décision

Lorsqu'une production rencontre, dans la cascade d'une recette, un produit
intermédiaire **suivi en stock** (`track_inventory = true`), elle **consomme ce
produit depuis son stock** et **s'arrête là**. Elle ne descend pas jusqu'aux
matières premières qui le composent.

Seuls les intermédiaires **non suivis en stock** (`track_inventory = false`)
continuent d'être dépliés jusqu'aux feuilles.

Cette règle de descente est **unique pour tout le système**. Le chemin de vente
l'applique déjà ; le chemin de production s'y aligne.

## Contexte

Au 2026-07-28, deux résolveurs de cascade coexistaient avec des règles de
descente contradictoires, vérifiées sur les corps de fonctions en base :

- le résolveur de **consommation à la vente** ne descend que dans les
  intermédiaires non stockés — il traite un semi-fini stocké comme une feuille ;
- le résolveur de **production** (unitaire et par lot) et la vue de nomenclature
  complète descendent dans **tout** produit ayant une recette.

La même pâte à croissant était donc un article de stock quand on vendait un
croissant, et un simple intermédiaire de calcul quand on produisait une
chocolatine. Aucune décision antérieure ne tranchait.

Deux conséquences mesurées sur le code en place :

1. **Double déduction de matière première.** Déclarer une production de pâte
   consomme la farine et crédite le stock de pâte ; produire ensuite un fini à
   partir de cette pâte re-consomme la farine en traversant la pâte, sans jamais
   décrémenter le stock de pâte. Le stock de semi-fini ne pouvait que croître.
2. **Erreur d'unité d'un facteur mille.** En descendant d'un niveau, l'unité de
   la ligne parent était perdue : une ligne « 90 gr » d'une pâte stockée en
   kilogrammes multipliait la recette de la pâte par 90 au lieu de 0,09. Au
   2026-07-28, 163 lignes de recette actives sur les 199 qui pointent vers un
   produit ayant lui-même une recette portaient une unité de ligne différente de
   l'unité de stockage de ce produit.

Aucune production enregistrée à cette date n'avait emprunté ce chemin : le
blocage par défaut acté en ADR-008 D4 a joué le rôle de coupe-circuit, une
production infaisable étant refusée pour stock insuffisant.

## Conséquences

1. **La cascade de production s'arrête au premier intermédiaire stocké.** Les
   familles `record_production` et `record_batch_production` adoptent la règle de
   descente du résolveur de vente. Correction par nouvelle version de RPC,
   construite sur le corps en base.
2. **L'affichage de la nomenclature d'un produit suit la même règle** : un
   semi-fini stocké y apparaît comme une ligne d'ingrédient à part entière,
   valorisée à son propre coût, et non plus décomposé en ses matières.
   **Le calcul du coût de revient est hors périmètre de cet ADR** : il continue
   de se construire depuis les recettes. L'écart entre cette méthode et une
   valorisation au coût réellement constaté en production sera mesuré produit
   par produit, puis tranché séparément.
3. **Le stock de semi-fini devient significatif** et baisse à chaque production
   qui le consomme.
4. **Produire un fini exige d'avoir déclaré la production de ses semi-finis.**
   À défaut, la production est refusée pour stock insuffisant — comportement
   voulu, cohérent avec ADR-008 D4. Le forçage reste possible sous la permission
   dédiée.
5. **La contrainte d'unité d'ADR-008 D1 est précisée.** Une ligne de recette est
   acceptée dès lors que son unité se convertit vers l'unité de stockage de
   l'article visé, et refusée sinon. L'unité identique n'est pas exigée : une
   pâte stockée au kilogramme se saisit en grammes, la conversion s'applique.
   Ce qui est fermé, c'est la conversion impossible — une quantité en grammes
   vers un article compté à la pièce — qui était jusqu'ici absorbée en silence,
   la quantité brute étant alors prise telle quelle.
6. **`track_inventory` devient le discriminant métier** entre « semi-fini que je
   gère en stock » et « étape intermédiaire de recette ». Le drapeau cesse d'être
   un simple réglage d'inventaire.

## Réversibilité

Repasser un semi-fini de stocké à non stocké suffit à le faire redéplier : la
règle est portée par la donnée, pas par le code. Revenir à un dépliage
systématique jusqu'aux feuilles exigerait un nouvel ADR et la réécriture de la
conversion d'unités entre niveaux, écartée ici.
