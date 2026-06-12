# Session 39 — Spec : Backoffice Completion Bundle (BO-04 / BO-09 / BO-10 / BO-15)

- **Date** : 2026-06-11
- **Branche** : `swarm/session-39` (base `master` @ `79d7f13`, post-merge S37 PR #69 + S38 PR #70)
- **Source du scope** : INDEX S37 §9 / INDEX S38 §10 « Hors scope S39+ » — items retenus par l'utilisateur : **BO-04** (ProductPicker pour EditOrderItemsModal), **BO-09** (Units panel write-mode), **BO-10** (Costing panel), **BO-15** (B2B settings backend).
- **Un seul chantier DB** (BO-15 : table `b2b_settings` + 2 RPCs). BO-04/09/10 sont du wiring UI sur des RPCs existants (S33 / S27 / S22 / S17).

---

## 1. Contexte et constat (recherche pré-spec)

### 1.1 BO-04 — l'état réel d'EditOrderItemsModal

- `apps/backoffice/src/features/orders/components/EditOrderItemsModal.tsx` : layout 2 colonnes 60/40. La colonne gauche est un placeholder texte (`lignes 99-102` : « Product picker placeholder (V1 stub — wire to BO product search later) »). La colonne droite (cart preview, qty controls, remove, subtotal) est fonctionnelle.
- L'orchestrateur `useEditOrderItems` (S33) séquence removes→updates→adds avec idempotency keys propres par RPC : `add_order_item_v1(p_order_id, p_product_id, p_qty, p_modifiers, p_idempotency_key)`, `update_order_item_qty_v1`, `remove_order_item_v1` — **aucun changement RPC requis**.
- Référence de pattern picker : `CreateB2bOrderModal` utilise un `<select>` natif alimenté par `useProductsForB2bOrder` (`features/btob/hooks/`, SELECT id/sku/name/price/current_stock/unit sur produits actifs). Pas de composant de recherche produit réutilisable existant en BO.

### 1.2 BO-09 — l'état réel d'UnitsPanel

- `apps/backoffice/src/features/products/components/UnitsPanel.tsx` : entièrement **disabled** avec données d'exemple hardcodées (`SAMPLE_ALT_UNITS`, lignes 29-33). Affiche : base unit (select disabled), liste d'unités alternatives (boutons disabled), 4 contextes (selects disabled).
- Tables réelles (S27, `20260520022244` + `_022314`) : `product_unit_alternatives` (id, product_id, code, factor_to_base, tags, display_order, deleted_at) ; `product_unit_contexts` (product_id PK, stock_opname_unit, recipe_unit, purchase_unit, sales_unit).
- **RPC existante sans consumer depuis S27** : `set_product_units_v1(p_product_id UUID, p_alts JSONB, p_contexts JSONB) RETURNS JSONB` (`20260520023314`) — REPLACE semantics (soft-delete des alts absentes + UPSERT), validation contexts ∈ {base unit, alts actives}, gate `products.units.update` (seedée S27 MANAGER+). REVOKE pair S27 en place.

### 1.3 BO-10 — l'état réel du Costing

- `ProductDetailPage.tsx` lignes 127-132 : `<StubPanel title="Costing arrives later" …>`. Aucun composant Costing n'existe.
- **RPCs existantes** : `update_cost_price_v1(p_product_id, p_new_cost, p_reason, p_idempotency_key) RETURNS JSONB` (S22, `20260526000012`) — gate `inventory.cost_correction` (MANAGER+), émet une row `stock_movements movement_type='cost_price_correction'` qty=0 avec old/new cost en metadata (= la réponse canonique à DEV-S17-1.B-01 « manual cost UPDATE bypasses audit ») ; `recipe_bom_full_v1(p_product_id)` (S17) — décomposition full-cascade par ingrédient (TABLE flat), déjà consommée par `IngredientAggregatePreview`.
- `cost_price` n'est **pas** dans l'allowlist `update_product_v1` (deliberate S27) — la correction passe obligatoirement par `update_cost_price_v1`.

### 1.4 BO-15 — l'état réel de B2BSettingsPage

- `apps/backoffice/src/pages/btob/B2BSettingsPage.tsx` : UI complète (default payment terms select, available terms chips, critical overdue threshold, aging buckets editor) mais **100 % local state** — banner ligne 107 : « Read-only preview — a `b2b_settings` table + `update_b2b_settings_v*` RPC are tracked as deviation D-W6-B2BSET-01 for Session 15+ ».
- Aucune table `b2b_settings` n'existe. Les colonnes per-customer (`b2b_payment_terms_days`, `b2b_credit_limit`, `b2b_current_balance`) sont sur `customers` (S14) et hors scope ici.
- Route gate : `settings.read` (`routes/index.tsx:427`). Permissions `settings.read` / `settings.update` existent depuis `20260517000030` — **réutilisées, aucune nouvelle permission seedée**.
- `view_ar_aging` (S24) a ses buckets 30/60/90 **hardcodés** — décision utilisateur actée : ils le **restent** en S39 ; les `aging_buckets` configurés sont persistés mais pas encore consommés par le dashboard (déviation documentée, refactor déféré).

---

## 2. BO-15 — B2B settings backend (Wave A, seul chantier DB)

### 2.1 Table `b2b_settings` (singleton)

```sql
CREATE TABLE b2b_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_payment_terms TEXT NOT NULL DEFAULT 'net_30',
  available_payment_terms JSONB NOT NULL DEFAULT '["cod","net_7","net_14","net_30","net_60"]',
  critical_overdue_days INT NOT NULL DEFAULT 30 CHECK (critical_overdue_days BETWEEN 1 AND 365),
  aging_buckets JSONB NOT NULL DEFAULT '[{"label":"Current","min":0,"max":30},{"label":"Overdue","min":31,"max":60},{"label":"Critical","min":61,"max":null}]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL REFERENCES user_profiles(id)
);
```

- Seed de la row id=1 dans la même migration (valeurs = defaults actuels de la page).
- RLS enabled ; aucune policy (accès uniquement via RPCs SECURITY DEFINER). REVOKE ALL FROM anon/authenticated/PUBLIC sur la table (pattern S25/S35 idempotency tables).
- CHECK : `default_payment_terms` doit appartenir à `available_payment_terms` — enforced dans la RPC (pas en CHECK SQL, JSONB containment dans un CHECK est fragile).

### 2.2 RPCs

- `get_b2b_settings_v1() RETURNS JSONB` — SECURITY DEFINER, gate `settings.read`, retourne la row singleton en JSONB.
- `update_b2b_settings_v1(p_patch JSONB) RETURNS JSONB` — SECURITY DEFINER, gate `settings.update`. Patch partiel (clés absentes = inchangées). Validations : `default_payment_terms ∈ available_payment_terms` (post-merge du patch) ; `available_payment_terms` array non vide de TEXT uniques ; `critical_overdue_days` 1..365 ; `aging_buckets` array non vide d'objets `{label TEXT, min INT >= 0, max INT|null}`, triés, contigus (`bucket[n].min = bucket[n-1].max + 1`), dernier `max = null`. Erreurs `P0001` avec message explicite par règle. Audit `audit_logs action='b2b_settings.updated'` (metadata : old/new). Set `updated_at`/`updated_by`.
- REVOKE pair canonique S25 sur les 2 RPCs (`REVOKE ALL FROM PUBLIC, anon` + GRANT authenticated + `ALTER DEFAULT PRIVILEGES`).

### 2.3 Front

- Nouveau hook `useB2bSettings()` (query `get_b2b_settings_v1`) + `useUpdateB2bSettings()` (mutation, invalidate on success, toast).
- `B2BSettingsPage` : remplace le local-state-only par query data + dirty state + bouton Save (pattern GeneralPanel) ; **supprime le banner « read-only preview »**.
- Consumer léger : `CreateB2bOrderModal` pré-sélectionne `default_payment_terms` depuis les settings si le champ existe dans le modal (sinon : no-op, documenter en déviation).

---

## 3. BO-09 — Units panel write-mode (Wave B, wiring S27)

- Nouveau hook `useProductUnits(productId)` : SELECT `product_unit_alternatives` (where `deleted_at IS NULL`, order `display_order`) + `product_unit_contexts` (maybeSingle).
- Nouveau hook `useSetProductUnits()` : mutation `set_product_units_v1`, invalidate `['product-units', productId]` + toast.
- `UnitsPanel` réécrit en mode controlled : liste d'alts éditable (code TEXT, factor_to_base NUMERIC > 0, add/remove row — `tags`/`display_order` gérés implicitement : display_order = index), 4 selects contexts (options = base unit + alts actives du draft), dirty flag, Save gated `products.units.update` (perm check via authStore, pattern ProductDetailPage), états loading/error.
- Sémantique REPLACE de la RPC respectée : on envoie **toutes** les alts du draft (celles omises sont soft-deleted server-side).
- Suppression de `SAMPLE_ALT_UNITS`.

---

## 4. BO-10 — Costing panel : breakdown + correction (Wave B, wiring S17/S22)

- Nouveau composant `CostingPanel` (`features/products/components/`) remplaçant le StubPanel :
  - **Header cards** : Current cost (WAC) `products.cost_price`, Retail price, Margin % (`(retail - cost) / retail`, guard division par 0) — données déjà dans `useProductDetail`.
  - **Breakdown** : si le produit a une recette → table via `recipe_bom_full_v1` (ingredient, qty, unit, unit cost, line cost, total) ; nouveau hook `useRecipeBomFull(productId)` (la RPC existe, hook côté products feature). Si pas de recette → EmptyState « No recipe — cost is purchase-driven (WAC) ».
  - **Action « Correct cost price »** : bouton gated `inventory.cost_correction` → dialog (new cost NUMERIC > 0 requis, reason TEXT requis ≥ 5 chars) → `update_cost_price_v1` avec `p_idempotency_key` (`useRef(crypto.randomUUID())`, reset on success/dismiss — flavor 2 S25) → invalidate product detail + toast avec old→new.
- Nouveau hook `useCorrectCostPrice()`.
- **Aucun nouveau RPC.** Le stub `purchase`/`history` du ProductDetailPage reste hors scope.

---

## 5. BO-04 — ProductPicker pour EditOrderItemsModal (Wave C, pur front)

- Nouveau composant `ProductPicker` (`features/orders/components/`) :
  - Search input (filtre client-side nom + SKU, debounce léger) sur produits actifs : nouveau hook `useProductsForOrderEdit` — SELECT id, sku, name, retail_price, parent_product_id, is_active, available_for_sale ; **exclut** : inactifs, `available_for_sale = false`, et les produits **parents de variants** (même règle métier que le POS : un parent ne se vend pas directement ; les variants eux-mêmes sont listés avec leur `variant_label`).
  - Liste compacte scrollable (name + variant_label, SKU, prix formaté IDR) ; clic → `onPick(product)` : si le produit est déjà dans le draft → qty+1, sinon ajout qty 1 (la logique draft existe dans EditOrderItemsModal).
- `EditOrderItemsModal` : remplace le placeholder par `<ProductPicker onPick={…} />`. Le flux Save (orchestrateur S33) est inchangé.
- Détail d'implémentation parent-exclusion : 2-query fallback comme le POS (`useProducts` POS, DEV pattern S27c) ou self-join — au choix de l'implémenteur, documenter.

---

## 6. Tests

| Suite | Contenu | Outil |
|---|---|---|
| pgTAP `b2b_settings.test.sql` | T1 get happy (settings.read) ; T2 get sans perm → P0003/42501 ; T3 update happy + row modifiée + audit row ; T4 update sans perm ; T5 validation default ∉ available → P0001 ; T6 buckets non contigus → P0001 ; T7 critical_overdue_days hors bornes ; T8 patch partiel (1 clé) ne touche pas les autres ; T9 REVOKE anon/PUBLIC EXECUTE = false sur les 2 RPCs ; T10 table inaccessible en direct (SELECT en authenticated → denied) | cloud MCP `execute_sql` BEGIN/ROLLBACK |
| BO smoke `units-panel-write` | render real data (mock query) ; edit factor → dirty → Save appelle `set_product_units_v1` avec le payload complet ; perm gate (pas de Save sans `products.units.update`) | Vitest `@breakery/app-backoffice` |
| BO smoke `costing-panel` | header cards render ; breakdown table avec mock BOM ; correct-cost dialog → `update_cost_price_v1` appelé avec idempotency key + reason | Vitest |
| BO smoke `product-picker` | search filtre la liste ; pick ajoute au draft ; parent exclu de la liste | Vitest |
| BO smoke `b2b-settings-persist` | load depuis `get_b2b_settings_v1` ; edit → Save → `update_b2b_settings_v1` payload ; banner absent | Vitest (le smoke existant `btob-settings.smoke.test.tsx` est mis à jour) |
| E2E browser | BO : ProductDetail → Units (edit + save) → Costing (render + correction dialog) ; Orders → EditOrderItems (search + add product + save) ; B2B Settings (edit + save + reload persiste) | Chrome MCP contre `pnpm --filter @breakery/app-backoffice dev`, session interactive |
| Sweeps | domain / UI / POS / BO complets + `pnpm typecheck` 6/6 | turbo |

---

## 7. Migrations (NAME-block `20260623000010..0xx`)

| # | Nom | Contenu |
|---|---|---|
| `_010` | `create_b2b_settings_table` | table singleton + seed row + RLS + REVOKE table |
| `_011` | `create_b2b_settings_rpcs` | `get_b2b_settings_v1` + `update_b2b_settings_v1` |
| `_012` | `revoke_pair_b2b_settings_rpcs` | REVOKE pair canonique S25 sur les 2 RPCs |

Types regen **requis** (nouvelle table + 2 RPCs) → `packages/supabase/src/types.generated.ts` + commit. Base à vérifier via `list_migrations` (prior max NAME `20260622000016`).

---

## 8. Hors scope S40+

PAT-01/02 auth BO setSession (session dédiée), POS-16 LAN cart mirror, POS-17 course timing, F-010..013/019..024, BO-08 CF account drill, BO-21 Soon cards reports, stubs `purchase`/`history` du ProductDetailPage, wiring `aging_buckets` → `view_ar_aging` (décision actée : déféré), `set_product_sections_v1`/`upsert_product_modifiers_v1` consumers (sections/modifiers restent stubs), bulk operations produits, print-bridge deployment, durcissement smoke `split-modes` (DEV-S38-C-02), wrapper EF par RPC pour comptage PIN BO, gate CI E2E Playwright.

---

## 9. Critères d'acceptation

- [ ] BO-15 — `b2b_settings` persiste : edit → save → reload → valeurs conservées ; validation server-side (buckets contigus, terms cohérents) ; audit row ; pgTAP 10/10 PASS ; banner « read-only preview » supprimé.
- [ ] BO-09 — UnitsPanel lit les vraies tables, save via `set_product_units_v1`, REPLACE semantics respectée ; `SAMPLE_ALT_UNITS` supprimé ; perm gate effectif.
- [ ] BO-10 — CostingPanel : WAC + marge + breakdown BOM (si recette) ; correction de coût via `update_cost_price_v1` avec reason + idempotency ; `stock_movements` row émise (vérif manuelle/E2E).
- [ ] BO-04 — ProductPicker : recherche nom/SKU, ajout au draft, parents de variants exclus ; Save orchestrateur S33 non-régressé.
- [ ] TEST — pgTAP PASS via cloud MCP ; smokes BO PASS ; sweeps domain/UI/POS/BO PASS ; typecheck 6/6 PASS ; types regen committé.
- [ ] E2E — les 4 écrans validés en navigateur (captures), persist B2B settings vérifié après reload.
- [ ] pattern-guardian : aucune violation des Critical patterns.
- [ ] INDEX rempli + CLAUDE.md §Active Workplan bumpé + PR créée vers `master`.
