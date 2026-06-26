# Spec B-1 — Dispatch/Print Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corriger l'axe de routage de vente du POS — renommer la station `bakery`→`display`, router toutes les catégories POS, ajouter un ticket `waiter` récapitulatif, puis permettre à un produit de router vers plusieurs stations (article entier sur chaque KOT).

**Architecture:** Deux axes de « station » restent décorrélés : la **production** (`sections`, intouché) et le **dispatch de vente** (`dispatch_station`). Phase 1 corrige le vocabulaire + le mapping + le ticket waiter en mono-station par catégorie (shippable seule). Phase 2 ajoute un override produit multi-valué (`products.dispatch_stations text[]`) résolu et snapshotté server-side dans `order_items.dispatch_stations`.

**Tech Stack:** TypeScript, React, Zustand, React-Query (apps/pos, apps/backoffice) ; `@breakery/domain` (TS pur IO-free) ; Supabase Postgres (RPC SECURITY DEFINER, pgTAP) ; pnpm + turbo + Vitest.

## Global Constraints

- **DB cible = Supabase cloud V3 dev `ikcyvlovptebroadgtvd`** — appliquer les migrations via MCP `mcp__plugin_supabase_supabase__apply_migration` (`project_id='ikcyvlovptebroadgtvd'`), SQL/pgTAP via `execute_sql` (envelope `BEGIN … ROLLBACK`). **JAMAIS** `supabase start` / `db reset` / Docker.
- **Numérotation migration monotone** : prochain NAME-block libre = `20260710000030` (le plus haut existant est `20260710000025`). Phase 1 : `…030..032`. Phase 2 : `…040..045`.
- **RPC versioning monotone** : ne jamais éditer une signature publiée. Si la signature change → `_vN+1` + `DROP FUNCTION …(<old args>)` même migration + maj call-sites + EF. Si l'extension est **interne au corps** (signature inchangée) → REPLACE en place autorisé (précédent : `complete_order_with_payment_v14` #122).
- **Paire REVOKE S25** sur tout nouveau RPC/helper : `REVOKE EXECUTE … FROM PUBLIC` **et** `FROM anon` **et** `ALTER DEFAULT PRIVILEGES FOR ROLE postgres … REVOKE EXECUTE … FROM PUBLIC`.
- **Écritures via RPC uniquement** : aucune écriture brute sur `orders`/`order_items` depuis l'app ou les tests.
- **Regen types** après TOUTE migration de schéma (colonnes) : `mcp__plugin_supabase_supabase__generate_typescript_types` → écrire `packages/supabase/src/types.generated.ts` → commit. Un CHECK seul ou un UPDATE data ne change PAS les types générés (pas de regen).
- **`packages/domain` est IO-free** — pas de fetch/Supabase/React.
- **Vocabulaire dispatch canonique** : `'kitchen' | 'barista' | 'display' | 'none'`. `'bakery'` est supprimé du dispatch de vente. `'waiter'` n'est PAS une valeur de `dispatch_station` — c'est un rôle d'imprimante / type de ticket transversal.
- Fichiers < 500 lignes. Tests après chaque changement. `pnpm` (jamais `npm`).

---

# PHASE 1 — Vocabulaire `display` + mapping complet + ticket `waiter` (livrable seul)

## Task 1: Migration vocabulaire `bakery → display` (CHECK + données)

**Files:**
- Create (MCP apply_migration, name `20260710000030_dispatch_station_bakery_to_display`): voir SQL ci-dessous
- Create local mirror: `supabase/migrations/20260710000030_dispatch_station_bakery_to_display.sql` (même contenu, pour le lineage local)

**Interfaces:**
- Produces: `categories_dispatch_station_check = ('kitchen','barista','display','none')` ; toutes les lignes `categories`/`order_items` portant `'bakery'` deviennent `'display'`.

- [ ] **Step 1: Écrire le SQL de migration (up)**

```sql
-- 20260710000030_dispatch_station_bakery_to_display.sql
-- Spec B-1 Ph1 Bloc 1.1 — le dispatch de vente cesse d'emprunter le nom de
-- production 'bakery' : la station de récupération à la vente est 'display'
-- (vitrine). Axe production (sections) NON touché.

-- 1. Remplacer la contrainte CHECK (DROP + ADD, atomique dans la migration).
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_dispatch_station_check;
ALTER TABLE categories
  ADD CONSTRAINT categories_dispatch_station_check
  CHECK (dispatch_station IN ('kitchen', 'barista', 'display', 'none'));

-- 2. Migrer les données (idempotent : no-op si déjà 'display').
UPDATE categories  SET dispatch_station = 'display' WHERE dispatch_station = 'bakery';
UPDATE order_items SET dispatch_station = 'display' WHERE dispatch_station = 'bakery';

-- 3. Mettre à jour les commentaires (citaient encore 'bakery').
COMMENT ON COLUMN categories.dispatch_station IS
  'Station de dispatch de VENTE : kitchen | barista | display | none. Copié sur order_items.dispatch_station au send-to-kitchen. Distinct de la station de PRODUCTION (sections).';
COMMENT ON COLUMN order_items.dispatch_station IS
  'Copié de categories.dispatch_station au INSERT du RPC. Valeurs : kitchen | barista | display | none.';
```

- [ ] **Step 2: Appliquer via MCP**

Appeler `mcp__plugin_supabase_supabase__apply_migration` avec `project_id='ikcyvlovptebroadgtvd'`, `name='20260710000030_dispatch_station_bakery_to_display'`, `query=<SQL Step 1>`.
Expected: succès (transaction commit).

- [ ] **Step 3: Vérifier (execute_sql)**

Run (`execute_sql`):
```sql
SELECT
  (SELECT COUNT(*) FROM categories  WHERE dispatch_station = 'bakery') AS cat_bakery,
  (SELECT COUNT(*) FROM order_items WHERE dispatch_station = 'bakery') AS oi_bakery,
  (SELECT COUNT(*) FROM categories  WHERE dispatch_station = 'display') AS cat_display,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='categories_dispatch_station_check') AS def;
```
Expected: `cat_bakery=0`, `oi_bakery=0`, `cat_display≥3`, `def` contient `'display'` et PAS `'bakery'`.

- [ ] **Step 4: Vérifier que le CHECK rejette `bakery` (pgTAP, ROLLBACK)**

Run (`execute_sql`):
```sql
BEGIN;
SELECT throws_ok(
  $$ UPDATE categories SET dispatch_station='bakery' WHERE id=(SELECT id FROM categories LIMIT 1) $$,
  '23514'  -- check_violation
);
SELECT lives_ok(
  $$ UPDATE categories SET dispatch_station='display' WHERE id=(SELECT id FROM categories LIMIT 1) $$
);
ROLLBACK;
```
Expected: 2 tests pass.

- [ ] **Step 5: Écrire le mirror local + commit**

Écrire le même SQL dans `supabase/migrations/20260710000030_dispatch_station_bakery_to_display.sql`.

```bash
git add supabase/migrations/20260710000030_dispatch_station_bakery_to_display.sql
git commit -m "feat(pos): dispatch_station bakery->display (CHECK + data migration) — Spec B-1 Ph1"
```

---

## Task 2: Migration mapping complet des catégories (données, idempotent)

**Files:**
- Create (MCP + mirror): `supabase/migrations/20260710000031_dispatch_station_full_category_mapping.sql`

**Interfaces:**
- Consumes: vocabulaire `display` (Task 1).
- Produces: chaque catégorie `finished`/`show_in_pos=true` porte sa station ; aucune catégorie `show_in_pos=false` n'est routée.

- [ ] **Step 1: Écrire le SQL (cibler par `name`, garde-fou `category_type`/`show_in_pos`)**

```sql
-- 20260710000031_dispatch_station_full_category_mapping.sql
-- Spec B-1 Ph1 Bloc 1.2 — mapping métier complet (validé utilisateur).
-- Garde-fou : ne router QUE les catégories finished + show_in_pos.

-- barista
UPDATE categories SET dispatch_station = 'barista'
 WHERE category_type='finished' AND show_in_pos=true
   AND name IN ('Coffee','Speciale Latte','Special Drinks');

-- kitchen (préparés/chauffés à la commande)
UPDATE categories SET dispatch_station = 'kitchen'
 WHERE category_type='finished' AND show_in_pos=true
   AND name IN ('Panini','Simple Plate','Plate','Savoury','Sandwiches',
                'Savoury Croissant','Bagel','Classic Sandwiches','Sandwiches Baguette');

-- display (vitrine : pré-faits / embouteillés)
UPDATE categories SET dispatch_station = 'display'
 WHERE category_type='finished' AND show_in_pos=true
   AND name IN ('Bread','Pastry','Viennoiserie','Buns','Cake','Classic Breads',
                'Classic Viennoiserie','Individual Pastries','Others Viennoiserie',
                'Sourdough Breads','Savouries','Other drinks','HASIL BOHEMI');

-- Filet de sécurité : aucune catégorie non vendue ne doit rester routée.
UPDATE categories SET dispatch_station = 'none'
 WHERE (show_in_pos=false OR category_type <> 'finished')
   AND dispatch_station <> 'none';
```

- [ ] **Step 2: Appliquer via MCP** (`apply_migration`, name `20260710000031_dispatch_station_full_category_mapping`).

- [ ] **Step 3: Vérifier le mapping + idempotence**

Run (`execute_sql`):
```sql
SELECT dispatch_station, COUNT(*) AS cats,
       SUM(CASE WHEN show_in_pos AND category_type='finished' THEN 1 ELSE 0 END) AS sellable
FROM categories WHERE deleted_at IS NULL
GROUP BY dispatch_station ORDER BY dispatch_station;
-- Attendu : aucune catégorie show_in_pos=false avec dispatch_station <> 'none'
SELECT COUNT(*) AS leaks FROM categories
 WHERE show_in_pos=false AND dispatch_station <> 'none';
```
Expected: `leaks=0` ; `barista`, `kitchen`, `display` peuplés ; relancer le SQL Step 1 → 0 ligne modifiée (idempotent).

- [ ] **Step 4: mirror local + commit**

```bash
git add supabase/migrations/20260710000031_dispatch_station_full_category_mapping.sql
git commit -m "feat(pos): full category->dispatch_station mapping — Spec B-1 Ph1"
```

---

## Task 3: Swap vocabulaire `bakery → display` côté TypeScript (domain + POS + BO + catalog-import)

Changement de rename cohérent et atomique : un seul reviewer logique. Termine sur un build vert.

**Files:**
- Modify: `packages/domain/src/kitchen/types.ts` (union + 2 arrays)
- Modify: `packages/domain/src/printing/groupItemsByStation.ts:12` (PREP_STATIONS local)
- Modify: `packages/domain/src/printing/__tests__/groupItemsByStation.test.ts` (fixtures `bakery`→`display`)
- Modify: `apps/pos/src/features/cart/hooks/useFireToStations.ts:21` + JSDoc lignes 64-79 (PREP_STATIONS)
- Modify: `apps/pos/src/features/kds/components/KdsStationSelector.tsx:10-14` (tab + label)
- Modify: `apps/backoffice/src/features/categories/components/CategoryFormDialog.tsx:18` (valeurs canoniques, corrige le bug `bar`/`pastry`)
- Modify: `apps/backoffice/src/features/catalog-import/templateDefinition.ts:40` + `apps/backoffice/src/features/catalog-import/__tests__/export-roundtrip.test.ts:8` + `…/parse-catalog-workbook.test.ts:130` (exemples `bakery`→`display`)
- Test: domain test ci-dessus + `apps/pos/src/features/cart/__tests__/station-map-variants.smoke.test.tsx` (si référence `bakery`)

**Interfaces:**
- Produces: `DispatchStation = 'kitchen' | 'barista' | 'display' | 'none'` ; `PrepStation = Exclude<DispatchStation,'none'>` (donc `'kitchen'|'barista'|'display'`) ; `KdsStation` (kdsStore) suit automatiquement.

- [ ] **Step 1: Mettre à jour le test domain (rouge d'abord)**

Dans `groupItemsByStation.test.ts`, remplacer les fixtures `croissant: 'bakery'`, `baguette: 'bakery'` par `'display'` et l'attendu `out.bakery` par `out.display` (3 occurrences : lignes 15-16, 27, 55).

- [ ] **Step 2: Lancer le test → échec attendu**

Run: `pnpm --filter @breakery/domain test groupItemsByStation`
Expected: FAIL (`'display'` absent du type / PREP_STATIONS).

- [ ] **Step 3: Modifier le type domain**

`packages/domain/src/kitchen/types.ts` :
```ts
export type DispatchStation = 'kitchen' | 'barista' | 'display' | 'none';
// …
export const DISPATCH_STATIONS: readonly DispatchStation[] = [
  'kitchen', 'barista', 'display', 'none',
] as const;
export const KDS_STATIONS: readonly Exclude<DispatchStation, 'none'>[] = [
  'kitchen', 'barista', 'display',
] as const;
```
(Mettre aussi à jour le commentaire ligne 16-18 : « cold drinks ringed up directly » reste valide.)

`packages/domain/src/printing/groupItemsByStation.ts:12` :
```ts
const PREP_STATIONS: readonly PrepStation[] = ['barista', 'kitchen', 'display'];
```
(Et le commentaire d'en-tête `types.ts:4` qui cite `kitchen|barista|bakery|none` → `kitchen|barista|display|none`.)

- [ ] **Step 4: Lancer le test domain → vert**

Run: `pnpm --filter @breakery/domain test groupItemsByStation`
Expected: PASS.

- [ ] **Step 5: Mettre à jour les consommateurs POS**

`useFireToStations.ts:21` :
```ts
const PREP_STATIONS: readonly DispatchStation[] = ['barista', 'kitchen', 'display'];
```
(JSDoc lignes 64-79 : remplacer `{barista,kitchen,bakery}` par `{barista,kitchen,display}`.)

`KdsStationSelector.tsx:10-14` :
```ts
const STATIONS: readonly { value: KdsStation; label: string }[] = [
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'barista', label: 'Barista' },
  { value: 'display', label: 'Display / Vitrine' },
];
```

- [ ] **Step 6: Mettre à jour BackOffice (form + catalog-import) et corriger le bug de valeurs**

`CategoryFormDialog.tsx:18` (avant : `['none','kitchen','bar','pastry','bakery']` — `bar`/`pastry` invalides au CHECK) :
```ts
const DISPATCH_STATIONS = ['none', 'kitchen', 'barista', 'display'] as const;
```
`catalog-import/templateDefinition.ts:40` et les 2 tests : exemple `dispatch_station: 'bakery'` → `'display'`.

- [ ] **Step 7: Typecheck + tests ciblés (build vert global)**

Run: `pnpm typecheck`
Expected: PASS (aucune référence `'bakery'` résiduelle dans le typage).
Run: `pnpm --filter @breakery/domain test && pnpm --filter @breakery/app-pos test station-map && pnpm --filter @breakery/backoffice test catalog-import`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src apps/pos/src apps/backoffice/src
git commit -m "feat(pos): swap dispatch vocabulary bakery->display (domain+POS+BO) — Spec B-1 Ph1"
```

---

## Task 4: Ticket `waiter` transversal (récap commande entière à chaque fire)

**Files:**
- Modify: `packages/domain/src/printing/types.ts:20` (`PrintKind` + `'waiter'`)
- Modify: `apps/pos/src/features/cart/hooks/useFireToStations.ts` (émettre 1 ticket waiter par fire)
- Test: `apps/pos/src/features/cart/__tests__/fire-waiter-ticket.smoke.test.tsx` (create)

**Interfaces:**
- Consumes: `printStationTicket(printer, StationTicketPayload)`, `useStationPrinters` (rôle `'waiter'` déjà dans `PrinterRole`), `getMockPrintBuffer()`.
- Produces: à chaque fire réussi, exactement **un** `StationTicketPayload { kind:'waiter', role:'waiter', items:<tous les items non annulés> }` envoyé au printer `waiter` s'il existe.

- [ ] **Step 1: Écrire le test smoke (rouge)**

`apps/pos/src/features/cart/__tests__/fire-waiter-ticket.smoke.test.tsx` — modèle sur `send-to-kitchen-holds.smoke.test.tsx` (même harnais : `VITE_PRINT_MOCK`, seed d'un printer `waiter` dans `lan_devices` mocké via le mock de `useStationPrinters`, panier multi-catégories). Assertions :
```ts
// après mutation.mutateAsync()
const buffer = getMockPrintBuffer();
const waiterTickets = buffer.filter((e) => 'payload' in e && e.kind === 'waiter');
expect(waiterTickets).toHaveLength(1);                       // un seul récap
const wp = waiterTickets[0].payload as StationTicketPayload;
expect(wp.role).toBe('waiter');
expect(wp.items.map((i) => i.name).sort())
  .toEqual(['Cappuccino', 'Croissant', 'Sandwich'].sort());  // TOUS les items, même 'none'
```
(Reprendre le setup exact — `QueryClientProvider`, stores, `crypto.randomUUID`, mock `useStationPrinters` retournant une Map avec `'kitchen'`, `'display'`, `'waiter'` — du fichier `send-to-kitchen-holds.smoke.test.tsx`.)

- [ ] **Step 2: Lancer → échec**

Run: `pnpm --filter @breakery/app-pos test fire-waiter-ticket`
Expected: FAIL (`waiterTickets` vide).

- [ ] **Step 3: Étendre `PrintKind`**

`packages/domain/src/printing/types.ts:20` :
```ts
export type PrintKind = 'prep' | 'bill' | 'receipt' | 'waiter';
```

- [ ] **Step 4: Émettre le ticket waiter dans `useFireToStations`**

Dans `useFireToStations.ts`, après le bloc d'impression par station (après `const results = await Promise.all(...)`, avant le `return results`), ajouter :
```ts
      // Spec B-1 Ph1 Bloc 1.4 — un ticket waiter consolidé par fire (best
      // effort, comme les KOT station). Récapitule TOUS les items non annulés
      // (y compris dispatch 'none') pour la distribution table + take-away.
      const waiterPrinter = printersMap?.get('waiter');
      if (waiterPrinter) {
        const waiterItems = unprinted
          .filter((i) => !i.is_cancelled)
          .map((item) => ({
            name: item.name,
            quantity: item.quantity,
            modifiers: item.modifiers.map((m) => m.option_label),
          }));
        if (waiterItems.length > 0) {
          const waiterPayload: StationTicketPayload = {
            kind: 'waiter',
            role: 'waiter',
            order_number: orderNumber ?? persistedOrderNumber ?? '',
            ...(tableNo !== undefined ? { table_number: tableNo } : {}),
            created_at: new Date().toISOString(),
            server_name: serverName,
            items: waiterItems,
            ...(isAdditional ? { additional: true } : {}),
          };
          // Best effort : un échec n'affecte ni la commande ni les results KOT.
          await printStationTicket(waiterPrinter, waiterPayload).catch(() => undefined);
        }
      }
```
(`printersMap` est déjà destructuré ligne 84 ; `unprinted`, `orderNumber`, `persistedOrderNumber`, `tableNo`, `serverName`, `isAdditional` sont déjà en scope.)

- [ ] **Step 5: Lancer → vert**

Run: `pnpm --filter @breakery/app-pos test fire-waiter-ticket`
Expected: PASS.

- [ ] **Step 6: Non-régression fire + typecheck**

Run: `pnpm --filter @breakery/app-pos test fire- && pnpm typecheck`
Expected: PASS (les smokes fire existants ne comptent pas le ticket waiter → leur mock `useStationPrinters` n'expose pas de printer `waiter`, donc aucun ticket émis ; vérifier qu'aucun n'asserte un nombre total de tickets incluant waiter).

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/printing/types.ts apps/pos/src/features/cart
git commit -m "feat(pos): consolidated waiter ticket on every fire — Spec B-1 Ph1"
```

---

### ✅ Jalon Phase 1 (shippable)

Run avant PR :
```bash
pnpm typecheck && pnpm --filter @breakery/domain test && pnpm --filter @breakery/app-pos test fire- && pnpm --filter @breakery/app-pos test kds
```
Livrable : station `display` câblée (KDS + impression via `/print/ticket` role `display`), mapping complet, ticket waiter. Aucune regen de types (CHECK + data uniquement). **Phase 1 peut être mergée seule.**

---

# PHASE 2 — Multi-station au niveau produit (override + résolution + snapshot tableau)

## Task 5: Migration schéma `dispatch_stations text[]` (produits + order_items)

**Files:**
- Create (MCP + mirror): `supabase/migrations/20260710000040_add_product_dispatch_stations.sql`
- Modify: `packages/supabase/src/types.generated.ts` (regen)

**Interfaces:**
- Produces: `products.dispatch_stations text[] NULL` (override) ; `order_items.dispatch_stations text[] NULL` (snapshot). CHECK élément ∈ `('kitchen','barista','display')`.

- [ ] **Step 1: SQL**

```sql
-- 20260710000040_add_product_dispatch_stations.sql
-- Spec B-1 Ph2 Bloc 2.1 — routage multi-station au niveau produit.

ALTER TABLE products
  ADD COLUMN dispatch_stations text[] NULL;

ALTER TABLE order_items
  ADD COLUMN dispatch_stations text[] NULL;

-- Chaque élément doit être une station de prep valide (jamais 'none' : l'absence
-- de routage = tableau NULL/vide). NULL passe le CHECK (override non posé).
ALTER TABLE products
  ADD CONSTRAINT products_dispatch_stations_check
  CHECK (dispatch_stations IS NULL OR dispatch_stations <@ ARRAY['kitchen','barista','display']::text[]);

COMMENT ON COLUMN products.dispatch_stations IS
  'Override produit du routage de vente (multi-station). NULL = hériter [categories.dispatch_station]. Spec B-1 Ph2.';
COMMENT ON COLUMN order_items.dispatch_stations IS
  'Snapshot des stations résolues à la vente (multi). order_items.dispatch_station (single) = 1er élément, legacy. Spec B-1 Ph2.';

-- Index KDS sur le tableau (lecture par station).
CREATE INDEX idx_oi_dispatch_stations_gin ON order_items USING GIN (dispatch_stations);
```

- [ ] **Step 2: Appliquer (MCP) + vérifier**

`apply_migration` name `20260710000040_add_product_dispatch_stations`. Puis :
```sql
SELECT throws_ok($$ UPDATE products SET dispatch_stations=ARRAY['none'] WHERE id=(SELECT id FROM products LIMIT 1) $$, '23514');
SELECT lives_ok($$ UPDATE products SET dispatch_stations=ARRAY['kitchen','display'] WHERE id=(SELECT id FROM products LIMIT 1) $$);
```
(Envelopper `BEGIN … ROLLBACK`.) Expected: 2 pass.

- [ ] **Step 3: Regen types + commit**

Appeler `generate_typescript_types` (`project_id='ikcyvlovptebroadgtvd'`), écrire `packages/supabase/src/types.generated.ts`. Vérifier que `dispatch_stations: string[] | null` apparaît sur `products` et `order_items`.
```bash
git add supabase/migrations/20260710000040_add_product_dispatch_stations.sql packages/supabase/src/types.generated.ts
git commit -m "feat(pos): products/order_items.dispatch_stations[] schema — Spec B-1 Ph2"
```

---

## Task 6: Helper RPC `_resolve_dispatch_stations_v1` (+ paire REVOKE)

**Files:**
- Create (MCP + mirror): `supabase/migrations/20260710000041_create_resolve_dispatch_stations_v1.sql`

**Interfaces:**
- Produces: `_resolve_dispatch_stations_v1(p_product_id uuid) RETURNS text[]` — `COALESCE(products.dispatch_stations, ARRAY[categories.dispatch_station])` filtré de `'none'` (→ `'{}'` si non routé).

- [ ] **Step 1: SQL**

```sql
-- 20260710000041_create_resolve_dispatch_stations_v1.sql
CREATE OR REPLACE FUNCTION _resolve_dispatch_stations_v1(p_product_id uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
           NULLIF(
             ARRAY(SELECT unnest(COALESCE(p.dispatch_stations, ARRAY[c.dispatch_station]))
                   EXCEPT SELECT 'none'),
             ARRAY[]::text[]),
           ARRAY[]::text[])
  FROM products p
  JOIN categories c ON c.id = p.category_id
  WHERE p.id = p_product_id;
$$;

REVOKE EXECUTE ON FUNCTION _resolve_dispatch_stations_v1(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION _resolve_dispatch_stations_v1(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION _resolve_dispatch_stations_v1(uuid) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2: Appliquer (MCP) + pgTAP (ROLLBACK)**

```sql
BEGIN;
-- override produit gagne sur la catégorie ; 'none' filtré
SELECT is(
  _resolve_dispatch_stations_v1((SELECT id FROM products WHERE dispatch_stations IS NULL
     AND category_id=(SELECT id FROM categories WHERE dispatch_station='display' LIMIT 1) LIMIT 1)),
  ARRAY['display'], 'hérite la station catégorie quand override NULL');
ROLLBACK;
```
Expected: pass. (Si pas de produit display dispo, seed-en un en transaction avant l'assertion.)

- [ ] **Step 3: Vérifier REVOKE anon**

```sql
SELECT has_function_privilege('anon', '_resolve_dispatch_stations_v1(uuid)', 'EXECUTE') AS anon_can;
```
Expected: `anon_can = false`.

- [ ] **Step 4: mirror + commit**

```bash
git add supabase/migrations/20260710000041_create_resolve_dispatch_stations_v1.sql
git commit -m "feat(pos): _resolve_dispatch_stations_v1 helper (+REVOKE) — Spec B-1 Ph2"
```

---

## Task 7: Snapshotter `dispatch_stations[]` dans les RPC de création de commande

Extension **interne** (signature inchangée) → REPLACE en place, **pas** de bump (cf. constraint). Appliquer le même patch à chaque RPC qui INSERT `order_items`.

**Files (lire la dernière migration de chaque RPC pour localiser l'INSERT order_items, puis REPLACE le corps via une nouvelle migration `20260710000042_snapshot_dispatch_stations_in_order_rpcs.sql`) :**
- `fire_counter_order_v4` (`supabase/migrations/20260705000014_bump_fire_counter_order_v4.sql`)
- `complete_order_with_payment_v14` (`supabase/migrations/20260710000023_complete_order_v14_flag_aware_deduction.sql`)
- `create_tablet_order_v2` (`supabase/migrations/20260602000011_bump_create_tablet_order_v2.sql`)
- `pay_existing_order_v10` (chercher la dernière migration `*pay_existing_order*`)

**Interfaces:**
- Consumes: `_resolve_dispatch_stations_v1(uuid)` (Task 6).
- Produces: chaque ligne `order_items` insérée porte `dispatch_stations` = résolution multi, et `dispatch_station` (single, legacy) = 1er élément (ou NULL si tableau vide).

- [ ] **Step 1: Localiser l'INSERT dans chaque RPC**

Pour chaque RPC : lire sa dernière migration, repérer le calcul `v_dispatch_station` (pattern `SELECT c.dispatch_station INTO v_dispatch_station FROM products p JOIN categories c …`) et l'`INSERT INTO order_items (… dispatch_station …)`.

- [ ] **Step 2: Écrire la migration REPLACE (un `CREATE OR REPLACE FUNCTION` complet par RPC)**

Pour chaque RPC, recopier le corps EXISTANT à l'identique (depuis sa dernière migration) et appliquer ces 2 changements :
1. Déclarer `v_dispatch_stations text[];` à côté de `v_dispatch_station`.
2. Remplacer le calcul + l'INSERT de la station :
```sql
    -- Spec B-1 Ph2 — résolution multi-station (override produit > catégorie).
    v_dispatch_stations := _resolve_dispatch_stations_v1(v_product_id);
    v_dispatch_station  := v_dispatch_stations[1];  -- legacy single = 1er élément (NULL si vide)
```
et ajouter `dispatch_stations` à la liste de colonnes + `v_dispatch_stations` à la liste de valeurs de l'`INSERT INTO order_items`.
(Garder TOUT le reste du corps inchangé. Aucune signature modifiée → pas de DROP, pas de bump, call-sites/EF intacts.)

- [ ] **Step 3: Appliquer (MCP) la migration `20260710000042_…`**

- [ ] **Step 4: pgTAP — le snapshot est posé (ROLLBACK)**

```sql
BEGIN;
-- seed un produit multi-station, fire-le, assert order_items.dispatch_stations
-- (utiliser le helper de test existant pour fire_counter_order si présent, sinon
--  appeler fire_counter_order_v4 avec p_items minimal et lire la ligne).
SELECT ok(
  (SELECT dispatch_stations FROM order_items ORDER BY created_at DESC LIMIT 1) @> ARRAY['kitchen'],
  'le fire snapshotte dispatch_stations');
ROLLBACK;
```
Expected: pass.

- [ ] **Step 5: mirror + commit**

```bash
git add supabase/migrations/20260710000042_snapshot_dispatch_stations_in_order_rpcs.sql
git commit -m "feat(pos): snapshot dispatch_stations[] in order RPCs (in-place) — Spec B-1 Ph2"
```

---

## Task 8: Domain — `groupItemsByStation` multi-station

**Files:**
- Modify: `packages/domain/src/printing/groupItemsByStation.ts`
- Modify: `packages/domain/src/printing/__tests__/groupItemsByStation.test.ts`

**Interfaces:**
- Produces: `groupItemsByStation(items, stationsByProductId: Readonly<Record<string, DispatchStation[]>>)` — un item dont les stations = `['kitchen','display']` apparaît dans **les deux** buckets ; item sans station → aucun bucket. Signature du 2ᵉ argument passe de `Record<string, DispatchStation>` à `Record<string, DispatchStation[]>`.

- [ ] **Step 1: Réécrire les fixtures + ajouter un cas multi (rouge)**

Dans le test, passer les stations en tableaux et ajouter un cas :
```ts
const stations: Record<string, DispatchStation[]> = {
  latte: ['barista'],
  sandwich: ['kitchen', 'display'],   // multi : handoff cuisine -> vitrine
  croissant: ['display'],
  ingredient: [],                      // non routé
};
it('routes a multi-station item into every bucket', () => {
  const out = groupItemsByStation([item('s1', 'sandwich')], stations);
  expect(out.kitchen?.map((i) => i.id)).toEqual(['s1']);
  expect(out.display?.map((i) => i.id)).toEqual(['s1']);
});
```
(Adapter les autres assertions aux tableaux : `croissant`/`baguette` → `['display']`, etc.)

- [ ] **Step 2: Lancer → échec**

Run: `pnpm --filter @breakery/domain test groupItemsByStation`
Expected: FAIL (type mismatch / item absent du 2ᵉ bucket).

- [ ] **Step 3: Implémenter le multi-bucket**

`groupItemsByStation.ts` :
```ts
export function groupItemsByStation(
  items: readonly CartItem[],
  stationsByProductId: Readonly<Record<string, DispatchStation[]>>,
): Partial<Record<PrepStation, CartItem[]>> {
  const grouped: Partial<Record<PrepStation, CartItem[]>> = {};
  for (const item of items) {
    if (item.is_cancelled) continue;
    const stations = stationsByProductId[item.product_id] ?? [];
    for (const station of stations) {
      if (!isPrepStation(station)) continue;
      (grouped[station] ??= []).push(item);
    }
  }
  return grouped;
}
```

- [ ] **Step 4: Lancer → vert**

Run: `pnpm --filter @breakery/domain test groupItemsByStation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/printing
git commit -m "feat(domain): groupItemsByStation multi-station buckets — Spec B-1 Ph2"
```

---

## Task 9: POS — `useStationMap` + `useFireToStations` multi-station

**Files:**
- Modify: `apps/pos/src/features/cart/hooks/useStationMap.ts` (retourne `Record<string, DispatchStation[]>`)
- Modify: `apps/pos/src/features/cart/hooks/useFireToStations.ts` (firable/unrouted + KOT par bucket)
- Test: `apps/pos/src/features/cart/__tests__/fire-multi-station.smoke.test.tsx` (create)

**Interfaces:**
- Consumes: `products.dispatch_stations`, `categories.dispatch_station`, `groupItemsByStation` (multi).
- Produces: `STATION_MAP_KEY` cache = `Record<string, DispatchStation[]>` ; `getStationMap(qc): Promise<Record<string, DispatchStation[]>>`.

- [ ] **Step 1: Test smoke (rouge) — sandwich multi-station → 2 KOT**

`fire-multi-station.smoke.test.tsx` : seed un produit dont la résolution = `['kitchen','display']`, mock `useStationMap` pour renvoyer `{ [pid]: ['kitchen','display'] }`, printers `kitchen`+`display`. Assert : 2 `StationFireResult` (`kitchen` et `display`), chacun contenant l'item.
```ts
const roles = results.map((r) => r.role).sort();
expect(roles).toEqual(['display', 'kitchen']);
```

- [ ] **Step 2: Lancer → échec**

Run: `pnpm --filter @breakery/app-pos test fire-multi-station`
Expected: FAIL.

- [ ] **Step 3: `useStationMap` → tableaux**

Sélectionner aussi l'override produit, résoudre côté client (fallback catégorie) :
```ts
type Row = {
  id: string;
  dispatch_stations: string[] | null;
  categories: { dispatch_station: string | null } | Array<{ dispatch_station: string | null }> | null;
};
function resolveStations(row: Row): DispatchStation[] {
  if (row.dispatch_stations && row.dispatch_stations.length > 0) {
    return row.dispatch_stations as DispatchStation[];
  }
  const rel = Array.isArray(row.categories) ? row.categories[0] : row.categories;
  const single = (rel?.dispatch_station ?? 'none') as DispatchStation;
  return single === 'none' ? [] : [single];
}
async function fetchStationMap(): Promise<Record<string, DispatchStation[]>> {
  const res = await supabase
    .from('products')
    .select('id, dispatch_stations, categories(dispatch_station)')
    .eq('is_active', true).is('deleted_at', null);
  if (res.error) throw res.error;
  const map: Record<string, DispatchStation[]> = {};
  for (const row of (res.data ?? []) as Row[]) map[row.id] = resolveStations(row);
  return map;
}
```
(Mettre à jour les types de retour de `useStationMap` et `getStationMap`.)

- [ ] **Step 4: `useFireToStations` — firable/unrouted sur tableaux**

```ts
const firableCount = candidates.filter((item) => {
  const stations = stationMap[item.product_id] ?? [];
  return stations.some((s) => (PREP_STATIONS as readonly string[]).includes(s));
}).length;
const unroutedCount = stationMapReady
  ? candidates.filter((item) => {
      const stations = stationMap[item.product_id] ?? [];
      return !stations.some((s) => (PREP_STATIONS as readonly string[]).includes(s));
    }).length
  : 0;
```
(`groupItemsByStation(unprinted, stationByProductId)` ligne ~218 consomme désormais le `Record<string,DispatchStation[]>` renvoyé par `getStationMap` — aucun autre changement d'appel.)

- [ ] **Step 5: Lancer → vert + non-régression**

Run: `pnpm --filter @breakery/app-pos test fire- && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/pos/src/features/cart
git commit -m "feat(pos): multi-station fire (useStationMap[]+groupBy) — Spec B-1 Ph2"
```

---

## Task 10: KDS — lecture par `ANY(dispatch_stations)`

**Files:**
- Modify: `apps/pos/src/features/kds/hooks/useKdsOrders.ts`

**Interfaces:**
- Produces: la requête KDS d'une station retourne aussi les items multi-station dont le tableau contient la station.

- [ ] **Step 1: Basculer le filtre serveur sur le tableau**

Remplacer `.eq('dispatch_station', station)` par un `contains` sur le tableau (PostgREST `cs`), avec repli legacy : sélectionner `dispatch_stations`, et filtrer `.contains('dispatch_stations', [station])`. Garder `dispatch_station` dans le `select` pour les lignes legacy non re-snapshotées (`dispatch_stations` NULL).
```ts
// builder loose — ajouter `contains`
interface SelectBuilder {
  eq: (col: string, val: unknown) => SelectBuilder;
  in: (col: string, vals: readonly unknown[]) => SelectBuilder;
  or: (filter: string) => SelectBuilder;
  order: (col: string, opts: { ascending: boolean }) => Promise<QueryResult<unknown[]>>;
}
// …
.or(`dispatch_stations.cs.{${station}},and(dispatch_stations.is.null,dispatch_station.eq.${station})`)
```
(Ajouter `dispatch_stations` au `select`. Le `.or` couvre : tableau contient la station OU (tableau NULL legacy ET single == station).)

- [ ] **Step 2: Vérifier**

Run: `pnpm --filter @breakery/app-pos test kds`
Expected: PASS (les smokes KDS existants restent verts ; les lignes legacy `dispatch_stations IS NULL` continuent d'apparaître via le single).

- [ ] **Step 3: Commit**

```bash
git add apps/pos/src/features/kds/hooks/useKdsOrders.ts
git commit -m "feat(pos): KDS reads multi-station via ANY(dispatch_stations) — Spec B-1 Ph2"
```

---

## Task 11: BackOffice — override multi-station sur le formulaire produit

**Files:**
- Modify: `apps/backoffice/src/features/products/` (formulaire produit + hook de mutation — localiser via `grep -rn "dispatch_station\|ProductForm" apps/backoffice/src/features/products`)
- Test: smoke produit (create) sous `apps/backoffice/src/features/products/__tests__/`

**Interfaces:**
- Consumes: `products.dispatch_stations` (Task 5).
- Produces: le form expose une multi-sélection (`kitchen`/`barista`/`display`) ; vide = « hériter de la catégorie » (persiste `NULL`).

- [ ] **Step 1: Localiser le formulaire et le hook de mutation produit**

Run: `grep -rn "category_id\|dispatch_station\|useUpdateProduct\|useCreateProduct" apps/backoffice/src/features/products`
Identifier le composant form + le payload de mutation (RPC ou update direct via `products`).

- [ ] **Step 2: Test smoke (rouge)**

Asserter qu'éditer un produit avec stations `['kitchen','display']` envoie `dispatch_stations: ['kitchen','display']` dans le payload de mutation ; vide → `dispatch_stations: null`.

- [ ] **Step 3: Ajouter le multi-select + brancher le payload**

Champ multi-sélection (3 cases `kitchen/barista/display`) initialisé depuis `product.dispatch_stations ?? []`. À la soumission : `dispatch_stations: selected.length > 0 ? selected : null`. Étendre le type/payload de la mutation (et le `select` de lecture du produit) pour inclure `dispatch_stations`.

- [ ] **Step 4: Lancer → vert + typecheck**

Run: `pnpm --filter @breakery/backoffice test products && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/features/products
git commit -m "feat(backoffice): per-product multi-station override — Spec B-1 Ph2"
```

---

### ✅ Jalon Phase 2

Run avant PR :
```bash
pnpm typecheck && pnpm build && pnpm --filter @breakery/domain test && pnpm --filter @breakery/app-pos test && pnpm --filter @breakery/backoffice test products
```
Plus pgTAP (MCP, ROLLBACK) : helper de résolution, snapshot RPC, CHECK array. Livrable : un produit (ex. sandwich) route vers `kitchen` **et** `display`, article entier sur chaque KOT + board KDS, override éditable en BackOffice.

---

## Self-Review — couverture spec

| Spec §  | Tâche(s) |
|---|---|
| Ph1 Bloc 1.1 (bakery→display CHECK+data) | Task 1 |
| Ph1 Bloc 1.2 (mapping complet) | Task 2 |
| Ph1 Bloc 1.3 (câblage display KDS+impression) | Task 3 (domain+POS+BO) ; impression via `/print/ticket` role `display` existant |
| Ph1 Bloc 1.4 (ticket waiter) | Task 4 |
| Ph2 Bloc 2.1 (schéma array) | Task 5 |
| Ph2 Bloc 2.2 (résolution + snapshot RPC) | Task 6 (helper) + Task 7 (RPC) |
| Ph2 Bloc 2.3 (domain+POS+KDS multi-bucket) | Task 8 (domain) + Task 9 (POS) + Task 10 (KDS) |
| Ph2 Bloc 2.4 (override BO produit) | Task 11 |
| Décorrélation production/dispatch | Aucune écriture `sections` dans tout le plan ✓ |
| REVOKE S25 | Task 6 ✓ |
| Regen types | Task 5 (seule migration de colonnes) ✓ |

**Notes d'exécution :**
- **Print-server (hors repo)** : `display`/`waiter` passent par l'endpoint générique `/print/ticket` (déjà existant, `printStationTicket`). Le *rendu* du ticket (template par `role`/`kind`) est côté print-server — si le template `waiter`/`display` manque, le ticket sort en format générique (best effort, non bloquant). Aucun nouvel endpoint requis.
- **Hub LAN** : `useFireToStations` imprime en **direct** (pas via le hub) ; le rejet hub `kitchen|barista` (`lanHubMessageHandler`) ne concerne que les tablettes — hors périmètre B-1. Si une future tablette doit imprimer display/waiter, étendre la validation hub (noté en réserve spec §8, non couvert ici).
