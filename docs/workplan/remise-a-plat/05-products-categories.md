# Module 05 — Catalogue produits & catégories

> ⚠️ **Mise à jour S59 (2026-07-04, `swarm/session-59`)** : **D1.1 livré** — `visible_on_pos` est désormais respecté au POS (`useProducts` **et** `useProductVariants`), un produit masqué en BO disparaît de la grille caisse et du sélecteur de variantes ; C-B1.2 n'est plus 🟠. Dette connexe : le cache offline tablette 24 h peut encore servir un produit masqué (INDEX S59). Voir `docs/workplan/plans/2026-07-04-session-59-INDEX.md`.

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 5. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel à la vente ; partiel sur certains outils d'administration.
> **Verdict global de l'analyse :** Largement fidèle sur le cœur (fiche produit, modifiers, combos, import Excel), mais trois surclames notables : le toggle « visible en caisse » n'a **aucun effet** au POS, la « couleur » des familles n'est pas configurable, et les **prix négociés n'ont aucune UI de saisie** (lecture seule de bout en bout).

## A. Ce qui fonctionne réellement (code vérifié)

- **Catégories produits — CRUD + réordonnancement DnD** [UI câblée] : page `apps/backoffice/src/pages/categories/CategoriesPage.tsx` (route gatée `categories.read`, `apps/backoffice/src/routes/index.tsx:202-209`), drag-and-drop `sort_order` (dnd-kit, CategoriesPage.tsx:2,27), formulaire avec `dispatch_station` + `kds_station` (`apps/backoffice/src/features/categories/components/CategoryFormDialog.tsx:30-31,54-55`) et flag `show_in_pos`. Colonnes réelles : `category_type, dispatch_station, kds_station, show_in_pos, sort_order` (`packages/supabase/src/types.generated.ts:443-457`) — **pas de colonne `color`**.
- **Fiche produit complète** [UI câblée] : `apps/backoffice/src/pages/products/ProductDetailPage.tsx` + panneaux (`GeneralPanel`, `CostingPanel`, `UnitsPanel`, `ModifiersPanel`, `VariantsPanel`, `StationsPanel`, `AllergensPanel`, `PurchasePanel`, `HistoryPanel`). Colonnes vérifiées : `retail_price, wholesale_price, cost_price, image_url, unit, min_stock_threshold, visible_on_pos, track_inventory, deduct_stock, is_display_item, allergens, dispatch_stations[], target_gross_margin_pct` (`types.generated.ts:3497+`). Toggles `visible_on_pos`/`deduct_stock`/`track_inventory` + seuil d'alerte éditables (`GeneralPanel.tsx:195-225,308-310`). Écriture via RPC `update_product_v1`/`create_product_v1` (migrations `20260520023035`, `20260520101735`).
- **Photo produit** [UI câblée] : upload drag-and-drop vers le bucket Storage public `product-images` (`apps/backoffice/src/features/products/components/ProductImageUploader.tsx:4-5,60-64`). (Bucket public — privatisation en dette S51, cf. CLAUDE.md Deferred.)
- **Modifiers avec déduction d'ingrédients par option** [UI câblée + RPC] : groupes/options `product_modifiers` édités par `ModifiersPanel`/`ModifierOptionRow` avec `ingredients_to_deduct` par option (`ModifierOptionRow.tsx:83-86`, `OptionIngredientPicker`), RPC `upsert_product_modifiers_v1` (`20260520023543`). À la vente, `_resolve_modifier_ingredients_v1` (`20260705000011`, REVOKE ×3) déduit les ingrédients de l'option choisie ; POS ouvre `ModifierModal` via `ProductTapHandler` (`apps/pos/src/features/products/ProductTapHandler.tsx:51-55,169-177`).
- **Variantes (architecture parent/enfant)** [UI câblée] : `AddVariantDialog`, `ConvertToParentDialog`, `DissolveParentDialog`, réordonnancement (`useReorderVariants`) ; POS ouvre `VariantSelectModal` sur un parent (`ProductTapHandler.tsx:66-71,81-106`). Non revendiqué en tant que tel par la doc (elle décrit les modifiers) — les deux mécanismes coexistent.
- **Unités multiples** [UI câblée, partiel] : `product_unit_alternatives` + `product_unit_contexts` (4 contextes `stock_opname/recipe/purchase/sales`, migrations `20260520022244/022314/022442`), RPC `set_product_units_v1` (`20260520023314`), UI `UnitsPanel.tsx`. Conversion achat→base à la réception (qty ×facteur, coût ÷facteur — cf. pattern PR #103). **`sales_unit` n'est consommé nulle part côté POS** (aucune occurrence de `product_unit_contexts` dans `apps/pos/src`).
- **Combos/formules server-priced** [UI câblée + RPC] : schéma `combo_groups`/`combo_group_options` (`20260704000010`), builder BO complet (`apps/backoffice/src/features/combos/components/ComboBuilderPage.tsx`, routes `products/combos[/new|/:id/edit]` gatées `combos.*`, `routes/index.tsx:162-185`), RPCs `upsert_combo_v1`/`delete_combo_v1`. POS : `ComboConfigModal` (`apps/pos/src/features/combos/components/ComboConfigModal.tsx`). Serveur : `_resolve_combo_price_v1` (`20260710000090:67-88`) valide la composition (`combo_invalid_component`/`combo_group_violation`) et facture `base + Σ surcharges` ; appelé par `complete_order_with_payment_v17` (`20260710000092:257,644`).
- **Prix par catégorie tarifaire, appliqué automatiquement** [RPC + POS, **lecture seule côté admin**] : `product_category_prices` (`20260509000003`), RPC `get_customer_product_price` (`20260509000006`) appelé par le POS à l'ajout d'article (`ProductTapHandler.tsx:57-64`) **et** re-résolu côté serveur dans `_resolve_line_price_v1` (`20260710000063:45`) — le serveur est l'autorité prix même si la ligne a été ajoutée avant le rattachement client. **Aucune UI d'écriture** : `useCustomerCategoryPrices.ts:8` est explicitement « Read-only — no new RPC » ; `PricingTab` du détail client est en lecture seule.
- **Import/Export Excel catalogue** [UI câblée + RPC] : page `products/import-export` gatée `catalog.import` (`routes/index.tsx:186-193`), template 6 feuilles (Categories, Ingredients, Products, Units, Variants, Recipes — `templateDefinition.ts:31+`), RPC `import_catalog_v1` (`20260625000011` + 5 fixes) et `export_catalog_v1` (`20260625000012`).
- **Marge brute par produit** [UI câblée + RPC] : `GrossMarginPage` route `reports/gross-margin` gate `reports.financial.read` (`routes/index.tsx:707-714`), RPC `get_gross_margin_by_product_v1` (`20260710000093`, coût = WAC courant, caveat snapshot COGS→P3).

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Gérer les familles de produits avec **couleur**, ordre d'affichage en caisse et poste de préparation associé.
- B1.2 Fiche produit complète : prix de vente, prix de gros, prix de revient, photo, unité, seuil d'alerte stock, **visible ou non en caisse**, suivi de stock ou fabriqué à la commande.
- B1.3 Options sans démultiplier le catalogue (un Cappuccino, douze variantes tailles × laits, suppléments + déduction d'ingrédients correcte).
- B1.4 Unités multiples : acheter en sac 25 kg, stocker au gramme, **vendre le sachet de 100 g** — conversions automatiques.
- B1.5 Formules/combos à composition et prix vérifiés par le système central (aucun supplément non facturé).
- B1.6 Lancer des promotions (%, montant, BOGO, happy hour) avec plafonds, appliquées automatiquement en caisse.
- B1.7 Prix négociés **par client professionnel**, appliqués dès que le client est identifié.
- B1.8 Importer un catalogue entier depuis Excel ; consulter la marge brute par produit dans les rapports.

### B2. Annoncé « À venir »
- B2.1 Recettes en cascade (semi-fini dans recette — chantier prioritaire coût de revient).
- B2.2 Modifications en masse (50 prix d'un coup).
- B2.3 Aperçu « ce client paiera X » (4 sources de prix).
- B2.4 Outil de gestion des photos.
- B2.5 Vente au poids avec balance connectée.
- B2.6 Assistant de création de formules plus guidé.

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Familles avec couleur, ordre, poste de prépa | Ordre (`sort_order` + DnD) ✓, postes (`dispatch_station`/`kds_station`) ✓ ; **couleur : aucune colonne** — teintes POS codées en dur par slug (`apps/pos/src/features/products/categoryTints.ts`), non configurables | 🟠 PARTIEL |
| B1.2 | Fiche produit complète, dont « visible ou non en caisse » | Tous les champs existent et sont éditables ✓ ; **mais le POS ne lit jamais `visible_on_pos`** — `useProducts` filtre uniquement `is_active` (`apps/pos/src/features/products/hooks/useProducts.ts:34`) ; le toggle BO (`GeneralPanel.tsx:195-197`) est sans effet | 🟠 PARTIEL |
| B1.3 | Options/modifiers avec déduction d'ingrédients par option | `product_modifiers.ingredients_to_deduct` + `_resolve_modifier_ingredients_v1` + UI complète BO/POS | ✅ CONFORME |
| B1.4 | Unités multiples achat/stock/vente | Achat→base + contextes recette/opname ✓ ; **vente en unité alternative non câblée** (`sales_unit` jamais lu par le POS ; « vendre le sachet de 100 g » passe par un produit distinct) | 🟠 PARTIEL |
| B1.5 | Combos vérifiés et pricés serveur | `_resolve_combo_price_v1` + v17 (composition + surcharges facturées) | ✅ CONFORME |
| B1.6 | Promotions avec plafonds, auto en caisse | Vrai — analysé en détail au module 13 (verdicts ✅/🟠 là-bas) | ✅ CONFORME |
| B1.7 | Prix négociés par client professionnel, appliqués automatiquement | Application automatique ✓ (POS + autorité serveur `_resolve_line_price_v1:45`) ; **mais** la granularité est par **catégorie tarifaire** (pas par client individuel), et **aucune UI/RPC d'écriture** des overrides `product_category_prices` — le scénario « le responsable B2B enregistre le tarif produit par produit » est impossible depuis l'application | 🟠 PARTIEL |
| B1.8 | Import Excel + marge brute par produit | `import_catalog_v1` 6 feuilles + `GrossMarginPage`/`get_gross_margin_by_product_v1` | ✅ CONFORME |

**Bonus code (le code fait plus que la doc) :**
- 🔵 Variantes parent/enfant (axe, tri, conversion parent↔standalone) en plus des modifiers.
- 🔵 Allergènes par produit avec résolution héritée (`AllergensPanel`, `useResolvedAllergensMap`).
- 🔵 Multi-stations d'impression par produit (`dispatch_stations[]`, `StationsPanel`) au-delà du poste par catégorie.
- 🔵 Audit trail produit dans la fiche (`HistoryPanel`/`useProductAuditLog`), correction de coût gouvernée (`CorrectCostDialog`).
- 🔵 Export Excel du catalogue (round-trip import/export testé).
- 🔵 `target_gross_margin_pct` + Margin Watch (module 6/15).

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
1. **Faire respecter `visible_on_pos` au POS** : ajouter `.eq('visible_on_pos', true)` dans `apps/pos/src/features/products/hooks/useProducts.ts` (les 2 requêtes, produits + variantes) ; vérifier que le KDS/tablette utilisent le même hook. Done = un produit masqué en BO disparaît de la grille caisse (test smoke `pos-grid-hides-*`).
2. **Amender la doc** (voir D4) pour couleur/vente au poids si le code ne bouge pas.

### D2. Chantiers moyens (1 session, plan requis)
1. **UI d'écriture des prix négociés** : RPC `upsert_product_category_price_v1` (+ delete) gatée (nouvelle perm ou `customer_categories.update`), édition dans `PricingTab` du client et/ou dans la fiche produit. Dépend du CRUD catégories clients (module 8, D-W6-CUSTCAT-01). Done = créer/modifier/supprimer un override depuis le BO, reflété au POS via `get_customer_product_price`.
2. **Couleur de catégorie configurable** : colonne `categories.color`, form BO, consommation POS (`categoryTints.ts` devient fallback). Done = couleur choisie en BO visible sur le rail POS.
3. **Aperçu « ce client paiera X »** (B2.3) : le RPC `get_customer_product_price` existe déjà — il manque juste un simulateur UI (fiche produit ou fiche client).

### D3. Chantiers lourds (spec dédiée avant code)
1. **Recettes en cascade** (B2.1) — spec coût-de-revient en cascade requise (découplée des lots, abandonnés le 2026-07-04).
2. **Vente au poids / balance connectée** (B2.5) et **vente en unité alternative** (fermeture du gap B1.4 côté vente) — même spec : quantité décimale au POS, prix au poids, périphérique.
3. **Édition en masse** (B2.2) : NB — l'import Excel couvre déjà le « 50 prix d'un coup » par re-import ; une vraie édition en masse in-app reste un chantier UI + RPC batch.

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
- B1.1 : remplacer « avec couleur » par « avec code couleur automatique en caisse » (ou retirer).
- B1.2 : tant que D1.1 n'est pas fait, « visible ou non en caisse » est faux — à retirer ou marquer « en cours ».
- B1.4 : préciser que les conversions couvrent achat/stock/recette ; la vente en unité alternative n'existe pas (le sachet 100 g = produit distinct).
- B1.7 : reformuler « prix négociés par **catégorie de client**, consultables mais non éditables depuis l'application aujourd'hui ».

## E. Dépendances croisées
- **Module 8 (Clients & fidélité)** : D2.1 (prix négociés) dépend du CRUD `customer_categories` (même déviation D-W6-CUSTCAT-01) ; `get_customer_product_price` est partagé.
- **Module 13 (Promotions)** : B1.6 délégué ; les combos du catalogue sont les cibles du pricing serveur v17.
- **Module 6/15 (Stock, Production/recettes)** : `track_inventory`/`deduct_stock`/`min_stock_threshold` alimentent les gardes de stock ; recettes en cascade = chantier P3 commun.
- **Module 2 (Caisse)** : la grille POS consomme `useProducts` — D1.1 la modifie.
- **Module 25 (Sécurité)** : bucket `product-images` public (dette S51) — la privatisation impactera `ProductImageUploader`.
