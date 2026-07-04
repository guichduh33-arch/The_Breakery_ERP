# Module 15 — Production & recettes

> ⚠️ **Mise à jour S59 (2026-07-04, `swarm/session-59`)** : **D1.1 (doublon suggestions) résorbé** — l'UI orpheline `ProductionSuggestions.tsx` + `useProductionSuggestions.ts` est purgée. Le RPC `get_production_suggestions_v1` est **conservé** (2ᵉ consommateur actif découvert : `ProductionAlertsTab`) — pas de DROP. Voir `docs/workplan/plans/2026-07-04-session-59-INDEX.md`.

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 15. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel
> **Verdict global de l'analyse :** La doc est **fidèle** — les cinq revendications « aujourd'hui » sont réelles, câblées et souvent plus riches que décrites (planning de production avec calendrier, revert, rapports yield/efficiency, allergènes déjà en base et affichés au POS). Deux nuances : le composant « suggestions du matin » historique est orphelin (la fonction vit dans la page Planning) et plusieurs « à venir » sont en réalité déjà partiellement livrés (lots datés à la production, allergènes).

## A. Ce qui fonctionne réellement (code vérifié)

- **Fiche technique par produit** [UI câblée] : `RecipeBuilder` monté dans l'onglet recette de `ProductDetailPage` (`apps/backoffice/src/pages/products/ProductDetailPage.tsx:30,135`) — lignes ingrédients (`recipes` table, `20260517000060`), `upsert_recipe_v1`, validation anti-cycle (`20260519000001`), sous-recettes (cascade `20260519000006`), réordonnancement, duplication (`duplicate_recipe_v1`, `20260519000082`).
- **Pourcentages de boulanger** [UI câblée] : colonne dédiée (`20260519000150`), `upsert_recipe_v1` baker-aware (`20260519000151`), `BoulangerModeToggle` + `useBakerRecipeMode` + `BakerPreviewPanel` (`features/inventory-production/`).
- **Coût matière + marge en direct** [UI câblée] : `RecipeCostPreviewCard` dans le builder (`features/recipes/components/RecipeBuilder.tsx:293`), RPCs `calculate_recipe_cost` (`20260519000002`), `recipe_bom_full_v1` (`20260521000020`, conversions d'unités `20260630000019`), `recipe_direct_cost_v1` (`20260630000022`).
- **Saisie des fournées** [UI câblée] : `/inventory/production` + `/inventory/production/batch` gatées `inventory.read`/`inventory.production.create` (`routes/index.tsx:282-297`). `record_production_v1` (version live `20260710000024`, flag-aware `allow_negative_stock`) : déduction matières via `_resolve_recipe_consumption_v1` (conversions g/kg `_try_convert_quantity`, `20260710000022:44-50`), crédit produits finis, **création d'un lot daté** (`create_stock_lot_v1`, `:311-318`), JE automatique via trigger mouvement (`20260517000022/23` : `production_in`/`production_out`). **Plusieurs recettes d'un coup** : `record_batch_production_v2(p_batch, p_items)` (`20260706000015`), `BatchProductionPage` + `IngredientAggregatePreview` (agrégat des matières du batch, `BatchProductionPage.tsx:203`).
- **Vérification préalable de faisabilité** [UI câblée] : `checkFeasibility()` du domaine pur (`packages/domain/src/production/bomResolver.ts`) exécutée en live dans `ProductionForm.tsx:93-97` + `FeasibilityBadge` (success/warning/error) ; re-garde serveur : `record_production_v1` lève `insufficient_stock` avec le détail JSON des manques (`{shortfall, material_stock}`, `20260710000024:289-303`) — exactement le « il manque 2,5 kg de farine » de la doc.
- **Ratés / taux de gâche** [UI câblée] : colonnes yield (`20260519000040`, RPC yield-aware `20260519000042`), `YieldVarianceModal` — raison obligatoire ≥ 5 caractères quand `|variance| > seuil`, miroir du check serveur `variance_reason_too_short` (`YieldVarianceModal.tsx:3-6`) ; rapports `/reports/production-yield` (`routes/index.tsx:683-690`) et `/reports/production-efficiency` (`20260624000018`).
- **Suggestions de production** [UI câblée] : `suggest_production_schedule_v1` (`20260519000121`) affichée dans le panneau « Suggestions » de `/inventory/production/schedule` avec ajout en un clic (`pages/inventory/ProductionSchedulePage.tsx:43,165-197`). ⚫ Doublon : `get_production_suggestions_v1` (`20260517000065`, vélocité ventes 7 j → qty suggérée + priorité) + composant `ProductionSuggestions.tsx` **jamais importé nulle part** (grep : seuls le composant et son hook se référencent).
- **Historique des versions de recette** [UI câblée] : `recipe_versions` (`20260519000003`), snapshot automatique à chaque modification avec coût figé (`20260520000020`, helper cascade `20260521000010/11`), `RecipeVersionHistory` monté dans `RecipeBuilder.tsx:495` ; timeline de coût `/reports/recipe-cost[/:productId]` (`recipe_cost_history_v1`, `20260522000010`).
- **Alerte de marge** [UI câblée] : table `margin_alerts` (`20260519000141`) recalculée par **pg_cron** (`20260519000142`), page `/inventory/production/margin-watch` (`routes/index.tsx:306-312`) avec acquittement gaté (`useMarginAlerts` + trigger `margin_alerts_ack_only_guard`).
- **EN PLUS de la doc** : planning de production par calendrier/sections (`production_schedules`, `20260519000120`, `ProductionCalendarGrid`) ; **revert d'une production** (`revert_production_v1`, `20260517000064` + `RevertProductionDialog`) ; batchs multi-recettes persistés (`production_batches`, `20260519000100..103`) avec backdate ; stations de production seedées (`20260706000014`) ; valorisation production au coût réel (`20260626000015`) ; **allergènes déjà en base ET affichés au POS** (enum + `products.allergens` + vue résolue `20260519000160..162`, `apps/pos/src/features/products/ProductCard.tsx` + `useProductAllergens`) alors que la doc les annonce « à venir ».

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Fiche technique par produit (ingrédients, quantités, pourcentages boulanger) + coût matière et marge théorique en direct.
- B1.2 Saisir les fournées du jour, plusieurs recettes d'un coup, avec vérification préalable de faisabilité (manques chiffrés).
- B1.3 Déclarer les ratés avec raison (mal cuit, mal levé…) et suivre le taux de gâche par produit.
- B1.4 Suggestions de production du matin basées sur les ventes.
- B1.5 Historique des versions de recette + alerte quand un produit passe sous la marge cible.

### B2. Annoncé « À venir »
- B2.1 Lots et dates de péremption (traçabilité fine, FIFO) — « prochain grand chantier ».
- B2.2 Coût figé au moment de la vente (snapshot COGS).
- B2.3 Saisie sur tablette en cuisine.
- B2.4 Affichage des allergènes sur le ticket et l'écran client.
- B2.5 Prévision de production.

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Fiche technique + baker % + coût/marge en direct | `RecipeBuilder` + baker mode + `RecipeCostPreviewCard` + RPCs coût, tout câblé | ✅ CONFORME |
| B1.2 | Fournées, multi-recettes, faisabilité préalable | `record_production_v1`/`record_batch_production_v2`, `checkFeasibility` live + garde serveur avec manques chiffrés | ✅ CONFORME |
| B1.3 | Ratés avec raison, taux de gâche | Yield variance (raison obligatoire au-delà du seuil) + rapports yield/efficiency. Nuance : la raison n'est exigée que si l'écart dépasse `production_yield_variance_threshold_pct` | ✅ CONFORME |
| B1.4 | Suggestions du matin basées sur les ventes | Livré via le panneau Suggestions de la page Planning (`suggest_production_schedule_v1`). Le composant historique `ProductionSuggestions` + `get_production_suggestions_v1` est **orphelin** (RPC sans call-site) | ✅ CONFORME (avec doublon ⚫ à résorber) |
| B1.5 | Versions de recette + alerte marge cible | `recipe_versions` snapshotées avec coût + `margin_alerts` recalculées par cron + page Margin Watch | ✅ CONFORME |

**Bonus code (le code fait plus que la doc) :**
- 🔵 Planning de production (calendrier par jour/section, slots, suggestions intégrées) — non mentionné.
- 🔵 Revert d'une production (contre-passation complète) — non mentionné.
- 🔵 Chaque production crée un **lot daté** (péremption dérivée de `default_shelf_life_hours`) — infrastructure réelle mais **qui ne sera pas utilisée** (décision propriétaire 2026-07-04 : pas de péremption/FIFO — décommissionnement léger, cf. module 6 D3.1).
- 🔵 Allergènes : schéma complet + affichage sur la grille produits POS (B2.4 partiellement livré ; manquent ticket et écran client).
- 🔵 Coût snapshoté dans chaque version de recette (`20260520000020`) — brique utile pour B2.2.
- 🔵 Rapports production report / efficiency / yield + valorisation au coût réel.

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
1. **Résorber le doublon suggestions** : supprimer le composant orphelin `features/inventory-production/components/ProductionSuggestions.tsx` + `useProductionSuggestions.ts` et déprécier `get_production_suggestions_v1`, **ou** le monter sur `/inventory/production` (panneau « À produire ce matin » hors planning). Done : plus de RPC sans call-site, un seul chemin de suggestions.
2. **Allergènes sur le ticket / écran client (B2.4)** : la donnée est déjà résolue (`view_product_allergens_resolved`) — l'ajouter au template de ticket et à `CustomerDisplayView`. Done : allergènes visibles sur les deux surfaces.

### D2. Chantiers moyens (1 session, plan requis)
1. **Saisie tablette cuisine (B2.3)** : la logique existe (RPCs + domain `checkFeasibility`) ; il s'agit d'une surface POS/tablette (`apps/pos`) réutilisant `record_batch_production_v2` — plan UI requis (offline/idempotence déjà couverts par `p_idempotency_key`).
2. **Prévision de production (B2.5)** : étendre `suggest_production_schedule_v1` (moyennes jour-de-semaine, jours fériés via `settings/holidays`) — plan données requis.

### D3. Chantiers lourds (spec dédiée avant code)
1. **Coût figé au moment de la vente (B2.2, = snapshot COGS)** : décider la source (WAC au moment du `stock_movement` de vente vs coût de la `recipe_version` active) ; impacte `_record_sale_stock_v1`, `get_gross_margin_by_product_v1` (caveat WAC courant documenté) et les rapports marge. **Découplé des lots** (décision 2026-07-04 : pas de FIFO) — la piste « coût par lot » est écartée, la source sera le WAC au moment de la vente.
2. ~~FIFO / péremption à la vente (B2.1)~~ — **ABANDONNÉ (décision propriétaire 2026-07-04)** ; cf. module 6 D3.1 (décommissionnement léger de l'infra lots).

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
1. B2.1 : **retirer le chantier « lots et dates de péremption » des « À venir »** (abandonné — décision propriétaire 2026-07-04 ; le suivi en quantité globale est le modèle retenu).
2. B2.4 : préciser « déjà visible sur la grille POS ; reste ticket + écran client ».
3. Ajouter au « aujourd'hui » : planning de production (calendrier), annulation d'une fournée (revert), rapports rendement/efficacité — fonctionnalités livrées et invisibles dans la doc.
4. B1.3 : nuancer « avec raison » → « raison obligatoire au-delà d'un seuil d'écart configurable ».

## E. Dépendances croisées
- **Module 6 (Stock)** : la production écrit le ledger, crée les lots, consomme via conversions — D3.1/D3.2 sont un chantier commun 6+15.
- **Module 5 (Catalogue)** : recette portée par la fiche produit (`RecipeBuilder` dans `ProductDetailPage`) ; allergènes sur `products`.
- **Module 10 (Comptabilité)** : JE `production_in/out` par trigger ; le snapshot COGS (D3.1) change la valorisation.
- **Module 14 (Rapports)** : recipe-cost overview/timeline, production yield/efficiency, gross margin — tous consommateurs des coûts recette.
- **Modules 2/16 (Caisse / Écran client)** : D1.2 (allergènes ticket + customer display) touche ces surfaces.
