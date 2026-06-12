# Audit module Stock Management — Backoffice

**Date :** 2026-06-12
**Méthode :** test navigateur réel (Playwright CLI, session SUPER_ADMIN, dev server local `:5174`) sur les 17 routes du module + vérification DB après chaque mutation (cloud V3 dev `ikcyvlovptebroadgtvd`) + sweep SQL précision / automatisation / sécurité / traçabilité (checklist skill `stock-management`).
**Périmètre :** groupe sidebar « Stock Management » hors Products/Categories (couverts par le module catalog) : Stock & Inventory, Incoming, Transfers ×3, Production ×4, Recipes ×2, Opname ×2, Live Movements, Display Stock, Alerts, Sections, Product Dashboard.

---

## Synthèse

| Verdict | Pages / flux |
|---|---|
| ✅ Fonctionnels et vérifiés en DB | Stock & Inventory (Adjust / Receive / Waste / historique / actions), Incoming, Transfers (création + direct receive), Production avec section (+ Revert), Batch production avec section, Schedule, Margin Watch (rendu), Recipes (éditeur + History), Display Stock, Sections |
| ❌ **Morts** (erreur à l'écran, aucune donnée) | **Opname** (toutes mutations), **Live Movements**, **Alerts** (3 onglets), **Product Dashboard** |
| ⚠️ Cassés dans le cas par défaut | Production **sans section** (single + batch, 2 causes distinctes) |
| 🔕 Automatisations mortes (silencieuses) | Cron spoilage `mark_expired_lots_hourly` (échoue **toutes les heures**), cron `recompute-recipe-margins-daily` (échoue **tous les jours** depuis ~17 mai) |

**22 findings** : 4 critiques, 7 majeurs, 11 moyens/mineurs.

---

## 1. CRITIQUES (fonctionnalité down)

### C1 — `supabase.rpc` non lié → 4 pages mortes + tout le cycle Opname
`TypeError: Cannot read properties of undefined (reading 'rest')` constaté à l'écran sur Opname (création), Live Movements, Alerts, Product Dashboard.

**Cause racine** : 8 fichiers extraient la méthode `supabase.rpc` sans la lier (`const rpc = supabase.rpc as unknown as RpcFn` ou `return supabase.rpc as ...`), puis l'appellent sans receveur → `this` est `undefined` et supabase-js fait `this.rest` en interne. Les casts **inline** `(supabase.rpc as ...)(...)` conservent le binding (transfers/purchasing fonctionnent — vérifié live).

Fichiers cassés (vérifiés par grep, pattern assignation/retour) :
- `features/inventory-opname/hooks/useOpnameMutations.ts:20` → **6 mutations opname mortes** (create/add/set/validate/finalize/cancel)
- `features/inventory-movements/hooks/useStockMovementsFeed.ts:48` + `useMovementAggregates.ts:27` → page Live Movements morte
- `features/inventory-alerts/hooks/useLowStock.ts:25` + `useReorderSuggestions.ts:27` + `components/ProductionAlertsTab.tsx:32` → page Alerts morte (3 onglets)
- `features/inventory-dashboard/hooks/useProductDashboard.ts:75` → Product Dashboard mort
- `features/print-queue/hooks/useCancelPrintJob.ts:13` (hors module stock, même bug)

**Fix** : `supabase.rpc.bind(supabase)` ou wrapper `(fn, args) => supabase.rpc(fn, args)`. Les smoke tests ne le voient pas car ils mockent supabase — prévoir un test non mocké ou un lint interdisant l'extraction de méthode.

### C2 — Cron spoilage `mark_expired_lots_hourly` échoue toutes les heures
`cron.job_run_details` : `ERROR: forbidden — CONTEXT: record_stock_movement_v1(...)` à **chaque** exécution sur les 7 derniers jours (historique entier vérifié). Le cron s'exécute sans `auth.uid()` → le gate `has_permission` de la primitive rejette. **L'expiration automatique des lots + auto-waste ne s'exécute jamais.** Échec silencieux : aucune alerte ne remonte.

### C3 — Cron `recompute-recipe-margins-daily` échoue tous les jours
`ERROR: numeric field overflow (precision 5, scale 2)` à chaque run quotidien. Conséquence visible : **Margin Watch affiche « Computed 2026-05-17 »** — les marges n'ont pas été recalculées depuis 26 jours alors que la page annonce « recomputed daily at 02:00 UTC ». Une marge ≥ |999.99| % (produit à cost_price 0 ou prix 0) fait déborder la colonne NUMERIC(5,2).

### C4 — Production sans section : cassée sur les 2 pages (2 causes distinctes)
- **Single** (`/inventory/production`) : section « — none — » → le front envoie `""` au lieu de `null` → `record_production_v1` 400 `22P02 invalid input syntax for type uuid: ""`. Bug front (hook production).
- **Batch** (`/production/batch`) : le front envoie bien NULL mais `record_batch_production_v1` insère `production_in` avec `from/to_section_id` NULL → violation CHECK `chk_stock_movements_section_required` (23514). Bug RPC (le type `production_*` exige au moins une section — S16 `_020`).

Dans les deux cas l'UI affiche **« Error: unknown »** (cf. M4). Le champ est pourtant marqué « Section (optional) ».

---

## 2. MAJEURS

### M1 — Aucune matière première gérable via les modals BO (`is_active` mal employé)
Les **15 ingrédients ING-*** sont tous `is_active = false` (flag sémantiquement « vendable au POS »). Or la recherche produit des modals Adjust / Receive / Waste filtre `is_active=eq.true AND deleted_at=is.null`, alors que la table de la page (RPC `get_stock_levels_v1`) les affiche. Résultat constaté live : Flour visible dans la table, mais « No products match » dans le modal Receive → **impossible de réceptionner/ajuster/jeter une matière première depuis le BO**, et incohérence liste ↔ action. Le filtre devrait porter sur `track_inventory` (ou rien), pas `is_active`.

### M2 — Validation de solde par section inexistante → `section_stock` négatif
Le formulaire Transfer annonce « Items below zero on the source after this transfer are rejected by the server ». Test : transfert de 2 Croissants depuis MAIN_WAREHOUSE (qui n'avait jamais reçu de stock sectionné) → **accepté**, et `section_stock` MAIN_WAREHOUSE = **-2** après coup (vérifié SQL). La promesse UI est fausse ; le cache par section part en négatif.

### M3 — FIFO/lots : non câblé à la consommation, et 2 flux d'entrée sur 3 ne créent pas de lot
- **22/22 mouvements de consommation** (`sale`, `production_out`, `waste`, `transfer_out`) ont `lot_id = NULL` — le backbone FIFO existe en schéma (`stock_lots`) mais n'est jamais consommé.
- Le **Receive du BO** (`receive_stock_v1`, movement `purchase`) ne crée **pas** de `stock_lot` (vérifié live : +5 Croissants, 0 lot). Seul `production_in` en crée un (vérifié : lot +24 h d'expiry).
- `incoming` ne crée pas de lot non plus (connu, re-démontré).
Conséquence : même si le cron spoilage (C2) était réparé, il ne couvrirait quasiment rien. Traçabilité lot → vente impossible.

### M4 — Surfacing d'erreur : « Error: unknown » + faux « All clear »
- Les erreurs non P-codées (22P02, 23514) s'affichent « Error: unknown » (production single + batch). Seules les erreurs métier P0002 sont joliment rendues (« Insufficient stock: Yeast short 25 g… » — vérifié).
- Page Alerts : la card Status affiche **« All clear »** alors que le fetch a échoué (le sous-texte « Failed to load » est en petit) ; le badge sidebar dit 2 alertes actives, la page dit 0. **Faux négatif dangereux.**
- `insufficient_stock` est levé en P0002 → PostgREST le mappe en **HTTP 500** (devrait être un code mappé 4xx, ex. P0001/PT400).

### M5 — Valorisation production incohérente (écart muet en 5110)
Batch vérifié : `production_in` 5 pcs valorisé **35 000** (5 × `cost_price` 7 000) tandis que les `production_out` consomment **72 300** d'ingrédients. L'écart de **37 300** reste dans le compte 5110 sans ligne de variance explicite. Cause : le coût du produit fini est pris sur `products.cost_price`, jamais resynchronisé depuis le coût recette (snapshot v8 = **14 450**/pc, affiché aussi par Margin Watch). La cascade S17 met à jour les snapshots de recettes quand un coût d'ingrédient bouge, mais ne redescend jamais vers `cost_price` du produit de sortie.

### M6 — Incoming et Transfers : features orphelines
`/inventory/incoming` et `/inventory/transfers[/new|/:id]` ont des routes + PermissionGate mais **aucun lien entrant** (ni sidebar, ni page Stock & Inventory) — grep : seuls les liens internes entre pages transfers existent. 0 transfert enregistré depuis toujours, cohérent avec l'inaccessibilité. `ExpiringStockPage.tsx` (features/inventory/pages) n'est **pas routée du tout** (référencée uniquement par son smoke test).

### M7 — Seuils min à 0 partout → alerting structurellement vide
`min_stock_threshold` = 0 sur les **78 produits**. « Critical alerts: 0 », suggestions de production « all finished products are well stocked » (avec 11/12 produits à stock 0), reorder suggestions vides : tout l'alerting est inopérant par construction, indépendamment du bug C1.

---

## 3. MOYENS / MINEURS

| # | Finding | Détail |
|---|---|---|
| m1 | Grants superflus sur `stock_movements` | `authenticated` détient **TRUNCATE**, TRIGGER, REFERENCES. Non exploitable via PostgREST, mais TRUNCATE n'est pas filtré par RLS — contraire à la doctrine REVOKE-all S20. À révoquer. |
| m2 | Parents de variantes traités comme stockables | `PAS-003-PARENT` proposé dans les pickers Adjust/Transfer et présent en vitrine (`display_stock` 6 pcs) alors qu'un parent ne se vend pas directement. |
| m3 | Doublons indistinguables dans le picker Recipes | « American Bagel (pcs) » ×2, « Flat White » ×3, « Pain au Chocolat » ×2, « Sourdough Loaf » ×2 — pas de SKU affiché dans le `<select>`. |
| m4 | Données résiduelles de test | Catégorie « S41E2E Cat », produit « test_smoke », catégories dupliquées « Ingredient » vs « Ingredients », `BEV-CAPP` nommé « Flat White » (3 produits homonymes). |
| m5 | Recipe editor — DOM nesting | `validateDOMNesting: <div> cannot appear as a child of <table>` (HiddenText de dnd-kit dans `<table>`). Console error à chaque rendu. |
| m6 | Recipe History — libellé collé | « Butteradded » (badge diff sans espace), et dates en locale id-ID (« 16 Mei 2026 ») vs en-US partout ailleurs. |
| m7 | Batch production — a11y | Le combobox recette a `aria-label="Search ingredient"` mais placeholder « Search recipe… ». |
| m8 | Auto-submit PIN 6 digits ne se déclenche pas | Constaté au login : il faut cliquer Verify (le safety-net E2E existe pour ça). Mineur mais divergent de la spec NumpadPin. |
| m9 | `audit_logs.entity_id` = id du mouvement | L'audit `stock.movement` pointe le mouvement, pas le produit — toute recherche d'audit par produit passe par `metadata`. Choix discutable, à documenter. |
| m10 | Page Stock & Inventory : « Last movement: today » sur des produits à ledger vide par ailleurs | Baseline seed sans ledger (`current_stock` posé sans mouvement) — connu sur dev, mais toute prod migrée devra entrer le stock initial via le ledger sous peine de casser la réconciliation opname. |
| m11 | Transfert : `from_section_id` ET `to_section_id` renseignés sur les DEUX lignes (in et out) | Fonctionne, mais rend la lecture du ledger ambiguë (l'out et l'in portent les mêmes sections) — convention à documenter. |

---

## 4. Ce qui marche bien (vérifié de bout en bout)

- **Adjust** : stock 45→46, ledger `adjustment +1` signé, unit auto-résolu, reason persistée, idempotency key, audit_log `stock.movement` complet.
- **Receive (purchase)** : stock +5, `unit_cost` persisté, **WAC** mis à jour par trigger (seed au premier coût si cost antérieur ≤ 0 — by design, code du trigger vérifié ; formule pondérée sinon).
- **Waste** : stock -2, **JE émise et équilibrée** (DR 5210 Waste Expense 10 000 / CR 1141 Inventory) — chaîne comptable trigger `tr_20_je_emit` opérationnelle.
- **Production avec section** : gate insufficient_stock exact au gramme près (BOM 6 ingrédients), cascade complète vérifiée — 6 `production_out` + 1 `production_in`, lot créé avec expiry, 7 JE, stocks exacts.
- **Revert production** : restauration intégrale des deux côtés + lot `consumed` + 7 contre-JE (admin-gated, fenêtre 24 h).
- **Batch production** : preview agrégé des ingrédients exact, transaction atomique.
- **Aucun stock global négatif, aucun lot orphelin, aucune reason vide**, triggers JE/WAC/snapshot tous attachés et actifs, **aucune fonction stock exécutable par `anon`** (sweep S20 effectif), tables display SELECT-only.
- Movement history drawer, Schedule (slots + suggestions), Sections CRUD, Display Stock (isolation vitrine/ledger BO respectée).

---

## 5. Recommandations priorisées

1. **Hotfix C1** (1 ligne par fichier ×8) : lier `supabase.rpc` — ressuscite Opname, Live Movements, Alerts, Product Dashboard. Ajouter une règle lint (`@typescript-eslint/unbound-method`) pour empêcher la récidive.
2. **C2** : faire tourner le cron spoilage avec un chemin service (RPC `service_role`-only sans gate `has_permission`, pattern `record_pin_failure_v1` S38) ou bypass explicite quand `auth.uid() IS NULL` ET `current_user = postgres`.
3. **C3** : élargir la colonne marge (NUMERIC(8,2)) ou clamper, et ajouter une alerte sur échec cron (les 2 crons échouent en silence depuis des semaines).
4. **C4** : front — normaliser `'' → null` ; RPC batch — defaulter une section ou retirer « optional » de l'UI.
5. **M1** : filtrer les pickers sur `track_inventory` (pas `is_active`), réactiver la cohérence liste ↔ modals.
6. **M2** : implémenter réellement le gate de solde par section dans la RPC transfer (ou retirer la promesse de l'UI) + contrainte `section_stock.quantity >= 0` si c'est l'invariant voulu.
7. **M3** : décider du sort du FIFO — soit câbler la consommation aux lots (FIFO réel), soit déprécier `stock_lots` ; l'entre-deux actuel donne une fausse assurance de traçabilité.
8. **M5** : valoriser `production_in` au coût recette du snapshot courant, ou poster la variance sur un compte dédié.
9. **M6/M7** : ajouter les entrées sidebar Incoming/Transfers, router ExpiringStockPage, exposer un éditeur de `min_stock_threshold`.
10. **m1** : `REVOKE TRUNCATE, TRIGGER, REFERENCES ON stock_movements FROM authenticated;`.

---

## 6. Effets de bord du test (dev DB)

Mutations laissées en base (dev V3, données de test) :
- PAS-CROI : +1 adjustment, +5 purchase (cost 5000 → WAC seedé 0→5000), +3 incoming, -2 waste, transfert 2 pcs MAIN_WAREHOUSE→FRONT_DISPLAY (section_stock MAIN_WAREHOUSE laissé à **-2** — preuve M2).
- PAS-002 (Croissant Beurre) : production 5 pcs **revertée** (net 0) puis batch 2 pcs **non reverté** (+2, lot actif) ; ingrédients consommés en conséquence.
- Seed SQL direct (hors ledger, volontaire pour le test) : Flour 2000 g, Butter 1000 g, Milk 1000 ml, Sugar 500 g, Salt 100 g, Yeast 100 g — crée un drift ledger↔stock assumé sur ces 6 ingrédients.
- 1 entrée Production Schedule (Croissant Beurre ×1, 2026-06-12 11am).
- 1 transfert TRF-20260612-0001 (received), 1 batch BATCH-20260612-0067, production PROD-20260612-0200 (reverted).
