# ADR-008 — Module Production & Recipes : arbitrages issus de l'audit croisé code × objectifs

> **Date** : 2026-07-17
> **Statut** : 🟡 Proposé — décisions à trancher par le propriétaire
> **Décideurs** : propriétaire The Breakery (guichduh33)
> **Supersedes** : —
> **Contexte** : audit à l'aveugle du module Production (2026-07-17, code
>   uniquement : lignée complète des migrations `production_records` /
>   `production_batches` / `recipes`, corps live vs fichiers, `packages/domain/
>   src/production`, hooks BO `inventory-production`), puis croisement avec la
>   fiche `docs/objectifs/PRODUCTION.md` (archivée — la référence canonique
>   `docs/reference/04-modules/15-production-recipes.md` qu'elle désigne
>   n'existe plus dans l'arborescence vivante). L'audit confirme les acquis V3
>   (sous-recettes, versioning, baker's %, yield, marge-cible, batch atomique,
>   idempotence UI, valorisation FG au coût matières réel, defense-in-depth
>   PUBLIC de juillet) et identifie huit points où le code contredit soit un
>   invariant affiché du module, soit l'intention métier écrite, soit un
>   pattern projet. Cet ADR liste les décisions ; aucune n'est actée tant que
>   la case « Décision » n'est pas remplie.

## D1 — Conversion d'unités dans la cascade sous-recettes 🔴

**État du code** : le CTE récursif de `record_production_v1` (corps live,
`20260710000024`) multiplie la quantité du parent — exprimée dans l'unité libre
de la ligne recette — par la quantité de la recette enfant (« par 1 unité de
produit »), **sans convertir vers l'unité de stockage de l'intermédiaire**.
`convert_quantity` n'est appliquée qu'au niveau feuille. Une ligne « 500 g » d'un
semi-fini stocké en kg expanse sa recette ×500 au lieu de ×0,5 (facteur 1000).
Rien ne contraint `recipes.unit` (texte libre 1-16 chars, `upsert_recipe_v1` ne
valide que non-vide). Le miroir client documente le trou (D7 « identity
conversion », `expandRecipeCascade.ts`) et renvoie au serveur comme source de
vérité — qui a le même angle mort.

**Intention doc** : invariant n°2 de la fiche objectifs (« Conversion d'unités
automatique… le système convertit »), étendu de fait aux sous-recettes livrées
en V3.

**Options** :
- **(a)** Contraindre à l'écriture : toute ligne recette dont le `material_id`
  est lui-même un produit à recette DOIT utiliser l'unité de stockage de ce
  produit (validation dans `upsert_recipe_v1` + audit/backfill des lignes
  existantes). Simple, vérifiable, zéro ambiguïté runtime.
- **(b)** Convertir entre niveaux dans le CTE : à chaque descente, convertir la
  quantité du parent (`recipe_unit`) vers `products.unit` de l'intermédiaire
  avant multiplication. Plus souple, mais complexifie un CTE déjà dense et le
  miroir client doit suivre.
- **(c)** a court terme + b comme cible.

**Recommandation** : (a) — avec un audit SQL préalable des lignes existantes
pour mesurer l'exposition réelle.

**Décision** : ☐

## D2 — Comptabilisation du waste : capitalisé ou passé en charge 🔴

**État du code** : aucun mouvement `production_waste`, aucune écriture
5210 Waste Expense. Le coût matières de la portion ratée est capitalisé dans le
stock produits finis (`production_in.unit_cost = coût_matières_total /
actual_yield`, le total incluant le waste). Le stock FG est survalorisé du coût
des ratés, invisible au P&L jusqu'à la vente.

**Intention doc** : §5.2 et §12 promettent un mouvement waste dédié et
Dr 5210 Production Waste Expense — le coût des ratés passe directement en
charge et alimente le chiffrage « coût des ratés » (§6).

**Options** :
- **(a)** Statu quo assumé (IAS 2 : le rebut *normal* est absorbé dans le coût
  de production) — mettre à jour la doc, renoncer au report « coût des ratés »
  comptable (il resterait calculable en analytique via `quantity_waste`).
- **(b)** Aligner sur la doc : jambe JE séparée pour la part waste
  (Dr Waste Expense / Cr Raw Materials au prorata `waste/(produced+waste)`), le
  reste seul capitalisé dans FG.
- **(c)** Hybride seuil : waste ≤ seuil % capitalisé (normal), au-delà passé en
  charge (anormal).

**Recommandation** : (b) — c'est l'intention métier écrite et ça rend le coût
des ratés pilotable ; (c) si le bruit comptable inquiète.

**Décision** : ☐

## D3 — Raison de waste structurée 🟠

**État du code** : `production_records` n'a que `notes` libre.
`yield_variance_reason` concerne le rendement, pas les ratés.

**Intention doc** : §6 — raison catégorisée (mal cuit, mal levé, esthétique,
démonstration, test recette, dégustation) alimentant un suivi du taux de waste
par produit.

**Options** : (a) enum Postgres `waste_reason` + colonne (+ UI select) ;
(b) statu quo notes libres, doc mise à jour.

**Recommandation** : (a) — faible coût, forte valeur analytique ; source unique
enum côté Postgres (pattern projet).

**Décision** : ☐

## D4 — Production à stock insuffisant : forçage explicite ou laisser-passer par défaut 🔴

**État du code** : le gate `insufficient_stock` est neutralisé dès que
`business_config.allow_negative_stock` est vrai — et le défaut est
`COALESCE(..., true)` (deux fois) : sans ligne de config, tout passe
silencieusement en stock négatif.

**Intention doc** : §11 — blocage par défaut, forçage **explicite** par
l'utilisateur (permission dédiée + warning).

**Options** :
- **(a)** Défaut `false` (blocage) + le forçage redevient un acte : soit le
  réglage global assumé, soit un paramètre `p_force` gated par une permission.
- **(b)** Statu quo assumé (boulangerie : la production ne doit jamais être
  bloquée par un stock théorique faux) — doc mise à jour, mais alors corriger au
  moins le double COALESCE pour que l'absence de config ne vaille pas « oui ».

**Recommandation** : (a) pour l'intégrité du stock ; si (b), seeder
explicitement `allow_negative_stock` et documenter.

**Décision** : ☐

## D5 — Comportement au débordement de profondeur de cascade 🔴

**État du code** : la récursion s'arrête à `depth < 5`, donc le
`RAISE recipe_depth_exceeded` de la RPC est inatteignable (code mort). Un arbre
de 6 niveaux est constructible (le trigger anti-cycle ne compte la profondeur
que SOUS l'arête insérée) : l'intermédiaire non expansé en profondeur 5 est
**exclu de la consommation** (filtre `is_intermediate = FALSE`) →
sous-consommation silencieuse. Le client, lui, throw `RecipeDepthExceededError`
(divergence préview/serveur).

**Options** :
- **(a)** Échec franc : dans la RPC, si un intermédiaire non expansé subsiste à
  la profondeur max → `RAISE recipe_depth_exceeded`. Aligne serveur et client.
- **(b)** Prévention à l'écriture : renforcer le trigger pour rejeter toute
  arête créant un chemin > 5 depuis n'importe quelle racine (plus coûteux à
  l'écriture, marginal en pratique).
- **(c)** a + b.

**Recommandation** : (a) minimum immédiat — une production qui consomme
partiellement en silence est pire qu'une erreur.

**Décision** : ☐

## D6 — Sémantique `deduct_stock` en production et JE asymétrique 🟠

**État du code** (Task 5, juillet) : si le produit FINI a `deduct_stock=false`,
la consommation matières est sautée mais `production_in` est quand même émise
et valorisée au coût matières calculé → Dr Finished Goods / Cr PRODUCTION_COGS
sans la contre-jambe → solde créditeur orphelin sur PRODUCTION_COGS.

**Intention doc** : §12 — transfert équilibré matières → produits finis. Le
flag `deduct_stock` n'existe pas dans la vision métier.

**Options** :
- **(a)** Si `deduct_stock=false` : `production_in` valorisée à 0 ou à
  `cost_price` (pas de JE de transfert du tout — cohérent avec « ce produit ne
  suit pas le stock »).
- **(b)** Interdire `record_production` sur un produit `deduct_stock=false`
  (une production sans consommation n'a pas de sens métier).
- **(c)** Statu quo assumé et documenté (accepter le solde transitoire).

**Recommandation** : (b), sauf cas d'usage réel identifié pour produire sans
consommer — alors (a).

**Décision** : ☐

## D7 — Revert d'une production dont le lot est déjà entamé + bypass du primitive 🔴

**État du code** : `revert_production_v1` fait des INSERT directs dans
`stock_movements` et des hand-updates de `products.current_stock` /
`section_stock` (duplication de la logique de `record_stock_movement_v1`,
UPDATE `section_stock` silencieux si la ligne n'existe pas), insère les
contre-JE sans `check_fiscal_period_open`, et **ne garde pas le cas du lot
partiellement vendu** : produire 10, vendre 4, revert < 24 h → contre-mouvement
−10 (au lieu de −6), lot forcé à 0, contre-JE sur la valeur totale → stock et
compta faux.

**Options** :
- **(a)** Refuser le revert si le lot (ou le stock produit) a bougé depuis la
  production (`already_consumed`) — le correctif passe alors par opname/ajustement.
- **(b)** Revert au prorata du restant (complexe, valeur douteuse).
- **(c)** a + refactor du revert pour passer par `record_stock_movement_v1`
  (paramètre skip-JE ou flag metadata) au lieu du bypass, + fiscal guard sur les
  contre-JE.

**Recommandation** : (c) — la garde (a) est le minimum ; le retour au primitive
élimine une classe entière de drift futur.

**Décision** : ☐

## D8 — Autorisation du revert : PIN manager ou permission 🟡

**État du code** : gate `inventory.production.delete` (ADMIN+), fenêtre 24 h,
pas de PIN. **Intention doc** (§7) : « suppression avec PIN manager ». Le
pattern projet PIN-in-header existe (discounts POS).

**Options** : (a) statu quo (permission + fenêtre 24 h), doc mise à jour ;
(b) ajouter le PIN manager in-header en plus de la permission.

**Recommandation** : (a) — le revert est une opération BO rare, ADMIN+, déjà
tracée ; le PIN apporte peu ici.

**Décision** : ☐

## D9 — Lot de dette technique production (à lotir tel quel) 🟡

Un seul GO/NO-GO pour le paquet, pas de redesign :
1. Idempotence RPC : catch `unique_violation` + re-read (pattern projet) dans
   `record_production_v1` et le batch (aujourd'hui : SELECT-then-INSERT, la
   course renvoie une erreur brute classée `unknown`).
2. Supprimer les `COALESCE(convert_quantity(...), qty)` morts et trompeurs
   (`convert_quantity` raise, ne renvoie jamais NULL) ; mapper
   `unit_conversion_missing` et `section_required` dans les `classify()` des
   hooks (le code d'erreur `unit_conversion_failed` est mort depuis la v1
   d'origine).
3. `DROP TABLE IF EXISTS pg_temp._bom_flatten/_leaf_consumption` défensif DANS
   `record_production_v1` (aujourd'hui seul le batch nettoie les temp tables de
   son callee — couplage par nom, et le commentaire de `_103` prétend à tort que
   le fix est dans `_006`).
4. Révoquer l'EXECUTE client de `record_batch_production_v1` (v2 wrapper est
   l'entrée canonique ; v1 reste l'implémentation interne).

**Décision** : ☐

## Constats sans décision (signalements)

- **Fichiers de migration ≠ corps live** : tous les corps production dans
  `supabase/migrations/` contiennent encore `INSERT INTO audit_log` (vue
  droppée en `_088` ; corps live réécrits par le sweep `_087`). Le garde-fou
  CLAUDE.md « tout bump part du corps live `pg_get_functiondef` » est la seule
  protection — vigilance sur tout futur bump production.
- **Lien documentaire cassé** : `docs/objectifs/PRODUCTION.md` (archivé) désigne
  `docs/reference/04-modules/15-production-recipes.md` comme canonique — ce
  fichier n'existe plus dans l'arborescence vivante. La fiche objectifs est de
  fait la seule doc fonctionnelle du module ; nommage des mouvements
  (`ingredient`/`production_waste`) et §7 y sont datés V2.
