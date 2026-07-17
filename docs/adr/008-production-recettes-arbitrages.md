# ADR-008 — Module Production & Recipes : arbitrages issus de l'audit croisé code × objectifs

> **Date** : 2026-07-17
> **Statut** : ✅ Accepted (2026-07-17)
> **Décideurs** : propriétaire The Breakery (guichduh33)
> **Supersedes** : —

## Contexte

Le 2026-07-17, un audit « à l'aveugle » du module Production a été mené sur le
code uniquement : toute la lignée des migrations `production_records`,
`production_batches` et `recipes`, la comparaison des corps de fonctions en
production avec les fichiers de migration, le code partagé
`packages/domain/src/production`, et les hooks du back-office
`inventory-production`. Le résultat a ensuite été croisé avec la fiche
`docs/objectifs/PRODUCTION.md` (aujourd'hui archivée — le document de
référence qu'elle désigne comme canonique n'existe plus).

L'audit confirme que les acquis de la V3 sont solides : sous-recettes,
versioning des recettes, baker's %, rendement, marge-cible, production par
lot atomique, idempotence côté interface, valorisation des produits finis au
coût matières réel, et le durcissement des droits PUBLIC de juillet.

En revanche, il identifie huit points où le code contredit soit un invariant
affiché du module, soit l'intention métier écrite, soit un pattern du projet.
Cet ADR tranche ces huit points, plus un lot de dette technique.

## D1 🔴 — Conversion d'unités dans les sous-recettes : contrainte à l'écriture

**Le problème** : quand une recette utilise un semi-fini, le calcul de
production ne convertit pas les unités entre les niveaux. Exemple concret :
une ligne « 500 g » d'un semi-fini stocké en kilogrammes fait exploser la
recette du semi-fini ×500 au lieu de ×0,5 — un facteur d'erreur de 1000.
Rien ne contraint l'unité saisie dans une ligne de recette (texte libre).
Le code côté client documente le trou et renvoie au serveur comme source de
vérité… qui a exactement le même angle mort.

**La décision** : on impose une règle simple à la sauvegarde de la recette :
toute ligne qui pointe vers un produit ayant lui-même une recette DOIT
utiliser l'unité de stockage de ce produit. La validation se fait dans
`upsert_recipe_v1`, et un audit SQL des lignes existantes sera mené d'abord
pour mesurer l'exposition réelle et corriger ce qui doit l'être.

La conversion automatique entre niveaux n'est pas retenue : elle
complexifierait un calcul déjà dense, côté serveur comme côté client.

## D2 🔴 — Le coût des ratés passe en charge comptable

**Le problème** : aujourd'hui, le coût des portions ratées (waste) est
absorbé silencieusement dans le coût du stock de produits finis. Le stock
est donc survalorisé du coût des ratés, et ce coût est invisible au compte
de résultat jusqu'à la vente. La doc métier promettait un mouvement de
stock dédié et une charge comptable visible (compte 5210 Production Waste
Expense).

**La décision** : on aligne le code sur l'intention métier. La part ratée
d'une production génère sa propre écriture comptable (débit Waste Expense /
crédit Matières premières, au prorata `waste / (produit + waste)`). Seul le
coût de ce qui est réellement produit est capitalisé dans le stock de
produits finis. Le coût des ratés devient visible et pilotable.

## D3 🟠 — La raison des ratés devient une catégorie structurée

**Le problème** : la seule information sur un raté est un champ de notes en
texte libre. Impossible d'en faire des statistiques.

**La décision** : on crée un enum Postgres `waste_reason` (mal cuit, mal
levé, esthétique, démonstration, test recette, dégustation), une colonne
dédiée sur `production_records`, et un menu déroulant dans l'interface.
Coût faible, forte valeur analytique : on pourra suivre le taux de ratés
par produit ET par cause. La source unique de l'enum est Postgres, comme
partout dans le projet.

## D4 🔴 — Production à stock insuffisant : blocage par défaut

**Le problème** : le garde-fou « stock insuffisant » est neutralisé dès que
le réglage `allow_negative_stock` vaut vrai — et en l'absence de réglage, le
défaut vaut « vrai » (deux fois dans le code). Autrement dit : sans
configuration explicite, toute production passe silencieusement en stock
négatif. La doc voulait l'inverse : blocage par défaut, forçage explicite.

**La décision** : le défaut devient « bloquer ». Forcer une production
malgré un stock insuffisant redevient un acte volontaire : soit via le
réglage global assumé, soit via un paramètre de forçage protégé par une
permission dédiée, avec avertissement à l'utilisateur.

## D5 🔴 — Recette trop profonde : erreur franche au lieu du silence

**Le problème** : le calcul de production s'arrête à 5 niveaux
d'imbrication. Un arbre de 6 niveaux est constructible, et dans ce cas le
semi-fini non déplié au niveau 5 est simplement **exclu de la
consommation** — le stock est sous-consommé en silence. Pendant ce temps,
le client affiche une erreur : la prévisualisation et le serveur divergent.
L'erreur `recipe_depth_exceeded` prévue dans la RPC est du code mort,
inatteignable.

**La décision** : si un semi-fini non déplié subsiste à la profondeur
maximale, la production échoue avec l'erreur `recipe_depth_exceeded`. Une
production qui consomme partiellement en silence est pire qu'une erreur
franche. Le serveur et le client redeviennent cohérents.

## D6 🟠 — Produire un produit qui ne suit pas le stock : interdit

**Le problème** : si le produit fini est marqué `deduct_stock = false`
(« ne suit pas le stock »), la production saute la consommation des
matières mais crée quand même une entrée de stock valorisée. Résultat : une
écriture comptable déséquilibrée — débit Produits finis / crédit
PRODUCTION_COGS sans contre-partie, laissant un solde orphelin.

**La décision** : `record_production` refuse un produit fini marqué
`deduct_stock = false`, avec une erreur claire. Produire sans consommer de
matières n'a pas de sens métier. Si un vrai cas d'usage apparaît un jour,
il fera l'objet d'un nouvel ADR.

## D7 🔴 — Revert d'une production entamée : refus + retour au helper standard

**Le problème** : l'annulation d'une production (`revert_production_v1`) a
deux défauts graves. D'abord, elle ne vérifie pas si le lot a déjà bougé :
produire 10, en vendre 4, puis annuler dans les 24 h retire 10 du stock au
lieu de 6 — le stock ET la comptabilité deviennent faux. Ensuite, elle
contourne le helper standard des mouvements de stock (INSERT directs,
mises à jour manuelles des quantités, contre-écritures comptables sans
vérification de période fiscale ouverte).

**La décision** : deux corrections.

1. Le revert est **refusé** si le lot (ou le stock du produit) a bougé
   depuis la production (erreur `already_consumed`). Dans ce cas, le
   correctif passe par un inventaire ou un ajustement de stock.
2. Le revert est **réécrit** pour passer par le helper standard
   `record_stock_movement_v1` au lieu de le contourner, et les
   contre-écritures comptables passent sous la garde de période fiscale.
   Ce retour au primitive élimine toute une classe de dérives futures.

## D8 🟡 — Autorisation du revert : la permission suffit, pas de PIN

**Le problème** : la vieille doc parlait d'un « PIN manager » pour
supprimer une production. Le code actuel exige la permission
`inventory.production.delete` (ADMIN et plus) dans une fenêtre de 24 h,
sans PIN.

**La décision** : le statu quo est acté. Le revert est une opération
back-office rare, déjà restreinte aux admins et tracée dans l'audit. Le PIN
n'apporterait presque rien ici. La doc sera mise à jour.

## D9 🟡 — Lot de dette technique : GO

Les quatre corrections suivantes sont acceptées en bloc, comme un seul
chantier, sans redesign :

1. **Vraie idempotence des RPCs production** : remplacer le
   SELECT-puis-INSERT actuel (qui laisse passer une course et renvoie une
   erreur brute) par le pattern projet : catch `unique_violation` + relecture.
2. **Nettoyage du code mort et trompeur** : supprimer les
   `COALESCE(convert_quantity(...), qty)` inutiles (`convert_quantity` lève
   une erreur, elle ne renvoie jamais NULL), et mapper les codes d'erreur
   `unit_conversion_missing` et `section_required` dans les hooks pour que
   l'utilisateur voie un message compréhensible.
3. **Nettoyage défensif des tables temporaires** dans
   `record_production_v1` elle-même (aujourd'hui seul le batch nettoie les
   tables temporaires de la fonction qu'il appelle — un couplage fragile).
4. **Révoquer l'accès client direct à `record_batch_production_v1`** : le
   wrapper v2 est l'entrée canonique ; la v1 reste une implémentation
   interne.

## Constats sans décision (signalements)

- **Les fichiers de migration ne reflètent plus les fonctions en
  production** : tous les corps production dans `supabase/migrations/`
  contiennent encore `INSERT INTO audit_log` (une vue supprimée depuis ;
  les corps live ont été réécrits par un sweep ultérieur). La règle
  CLAUDE.md « tout bump part du corps live `pg_get_functiondef` » est la
  seule protection — vigilance absolue sur tout futur bump d'une RPC
  production.
- **Lien documentaire cassé** : la fiche `docs/objectifs/PRODUCTION.md`
  (archivée) désigne comme canonique un document de référence qui n'existe
  plus. La fiche objectifs est de fait la seule doc fonctionnelle du
  module, et certaines sections y sont datées V2.

## Conséquences

- Les décisions D1, D2, D4, D5, D6 et D7 touchent des RPCs publiées : chaque
  correction passe par une nouvelle version (`_vN+1`) créée à partir du corps
  live, avec tests pgTAP et régénération des types.
- D2 et D7 touchent la comptabilité : les écritures passent sous la garde de
  période fiscale et doivent rester équilibrées.
- D3 ajoute un enum + une colonne (migration + UI).
- D9 est un lot unique de mise en conformité, sans changement de
  comportement métier.

## Révision

Ces décisions ne se rouvrent que par un nouvel ADR.
