# S61 — Findings S58 F-2 + F-5 + décommissionnement péremption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** Fermer les deux findings S58 restants (F-2 contrat d'erreur oversell vitrine, F-5 allowlist stations d'import désynchronisée) et exécuter le décommissionnement léger de l'infra péremption/lots acté par le propriétaire le 2026-07-04 (fiche 06 D3.1).

**Architecture :** Deux migrations in-place (corps live via `pg_get_functiondef`, leçon DEV-S57-02) sur `_record_sale_stock_v1` et `import_catalog_v1`, une migration de désactivation du cron `mark_expired_lots_hourly`, et une purge frontend BO des surfaces péremption (routes, sidebar, pages, hooks, badge, tests). `stock_lots`, ses RPCs et la fonction cron restent **dormants en base** — aucun DROP.

**Tech stack :** Supabase cloud V3 dev `ikcyvlovptebroadgtvd` via MCP (`apply_migration`, `execute_sql`) ; pgTAP en enveloppe `BEGIN…ROLLBACK` ; pnpm 9.15 + turbo ; React/TS (apps/backoffice).

## Global Constraints

- **DB = Supabase cloud, jamais Docker** : migrations via `mcp__plugin_supabase_supabase__apply_migration` (project_id `ikcyvlovptebroadgtvd`), pgTAP via `execute_sql`. Ne JAMAIS lancer `supabase start`, `pnpm db:reset`, `run_pgtap.sh`.
- **Jamais de `BEGIN;`/`COMMIT;` dans le corps d'une migration** (MCP wrappe déjà).
- **Migration in-place = partir du corps live** (`SELECT pg_get_functiondef(...)`), jamais du fichier de migration d'origine (DEV-S57-02). Diff visuel avant application.
- **Numérotation NAME-block** : dernière = `20260710000106` → cette session utilise `20260710000107..109`.
- **Money-path** : `_record_sale_stock_v1` est appelé par `complete_order_with_payment_v17`, `pay_existing_order_v11`, `create_b2b_order_v3`. Après T1, re-passer les ancres live listées en T4. **Interdiction de toucher v17/v11/fire_v4 eux-mêmes.**
- Signatures inchangées (CREATE OR REPLACE même signature) → pas de bump de version, pas de REVOKE à re-poser (les ACLs survivent au REPLACE) ; vérifier quand même en fin de T1.
- Types TS : aucun changement de schéma attendu → check no-drift en T4 (pas de commit de types).
- Commits conventionnels, co-author Claude. Branche : `swarm/session-61` (créée depuis `origin/master` = `abb4564`).

---

## Contexte vérifié (recherche 2026-07-05, DB live + code)

**F-2** — corps live de `_record_sale_stock_v1` (récupéré via `pg_get_functiondef`) :
- La garde display existe : `IF NOT p_allow_negative AND COALESCE(v_disp_qty, 0) < p_quantity THEN RAISE EXCEPTION 'Insufficient display stock…'` — **deux défauts** :
  1. `RAISE EXCEPTION` sans ERRCODE → **P0001**, que l'EF `process-payment` classe en `no_open_session` (contresens pour le caissier, `index.ts:295-305`) ;
  2. quand `allow_negative_stock=true`, la garde est sautée et l'UPDATE viole la CHECK `display_stock_quantity_check (quantity >= 0)` → **23514** brut → `check_violation` 422 générique. Le flag négatif **ne peut pas** s'appliquer à la vitrine (la CHECK l'interdit structurellement) : la garde display doit être inconditionnelle.
- La garde tracked non-display a le même défaut ERRCODE (P0001) mais reste légitimement flag-aware.
- L'EF classe déjà `P0002` → `insufficient_stock` 409 (`index.ts:307`) : aligner les gardes sur P0002 suffit, **zéro changement EF/POS**.
- Suites existantes : `sale_stock_unification.test.sql` T13 attrape en `WHEN OTHERS` (agnostique au code d'erreur) ; `sale_flag_aware_deduction.test.sql` D1 asserte P0002 sur l'insuffisance **matière** (cascade recette, chemin différent) — **aucune ancre verte n'asserte P0001/23514 pour ces gardes** : le fix ne casse rien.

**F-5** — CHECK live `categories_dispatch_station_check` = `{kitchen, barista, display, none}` ; l'allowlist de validation d'`import_catalog_v1` (posée par `20260629000013`, lignes ~185-187) valide `{kitchen,barista,bakery,none}` → catégorie `display` inimportable (faux rejet de validation), `bakery` passe la validation puis crashe sur la contrainte. `catalog_import.test.sql` ne teste que `kitchen`.

**D3.1** — cron live : jobid 1 `mark_expired_lots_hourly`, schedule `7 * * * *`, `active=true`. Surfaces frontend BO : route `inventory/expiring` (`routes/index.tsx:251`) + `reports/perishable-turnover` (`:788`) ; sidebar `Sidebar.tsx:98` + `:160` ; tuile `ReportsIndexPage.tsx:57` ; `ExpiringStockPage` + smoke test ; `PerishableTurnoverPage` + smoke test + `usePerishableTurnover` ; `ExpiringLotsBadge` + `useExpiringLots` ; `AlertsBadge` (compte l'expiring dans le total) + son test ; panneaux « expiring lots » dans `ProductStockPage.tsx` et `ProductDashboardPage.tsx` ; type PDF `perishable_turnover` dans `useGeneratePdf.ts:15`.

---

### Task 1 : F-2 — contrat P0002 dans `_record_sale_stock_v1` (migration `_107`)

**Files:**
- Create: `supabase/tests/display_oversell_contract.test.sql`
- Create: `supabase/migrations/20260710000107_record_sale_stock_v1_p0002_contract.sql` (appliquée via MCP `apply_migration`, name `record_sale_stock_v1_p0002_contract`)

**Interfaces:**
- Consumes: `_record_sale_stock_v1(p_product_id, p_quantity, p_reference_id, p_created_by, p_reason, p_movement_type, p_reference_type, p_unit, p_allow_negative)` — signature INCHANGÉE.
- Produces: mêmes gardes, mais `USING ERRCODE = 'P0002'`, et garde display **sans** condition `NOT p_allow_negative`. Aucun consommateur à repointer.

- [ ] **Step 1 : écrire la suite pgTAP (rouge d'abord)**

Créer `supabase/tests/display_oversell_contract.test.sql` :

```sql
-- display_oversell_contract.test.sql — S61 F-2
-- Contrat d'erreur des gardes d'insuffisance de _record_sale_stock_v1 :
--   T1 : display, flag OFF, stock insuffisant → P0002 (était P0001)
--   T2 : display, flag ON,  stock insuffisant → P0002 (était 23514 via CHECK)
--   T3 : tracked non-display, flag OFF, stock 0 → P0002 (était P0001)
--   T4 : display, stock suffisant → déduction OK (display_stock 5-2=3, pas de régression)
-- Lancer via MCP execute_sql (BEGIN…ROLLBACK porté par ce fichier).
BEGIN;
SELECT plan(4);

CREATE TEMP TABLE _ids AS
SELECT gen_random_uuid() AS disp, gen_random_uuid() AS trk,
       (SELECT id FROM categories LIMIT 1) AS cat,
       (SELECT id FROM user_profiles LIMIT 1) AS prof,
       gen_random_uuid() AS ord;
INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, unit, is_display_item)
SELECT disp, 'S61F2-DISP', 's61 disp', cat, 1000, 100, 'pcs', true FROM _ids;
INSERT INTO products (id, sku, name, category_id, retail_price, current_stock, unit, track_inventory, is_display_item)
SELECT trk, 'S61F2-TRK', 's61 trk', cat, 1000, 0, 'pcs', true, false FROM _ids;
-- le trigger display crée la ligne display_stock ; forcer quantity=5
UPDATE display_stock SET quantity = 5 WHERE product_id = (SELECT disp FROM _ids);

SELECT throws_ok(
  format($q$SELECT _record_sale_stock_v1(%L::uuid, 6, %L::uuid, %L::uuid, 't1', p_allow_negative := false)$q$,
         (SELECT disp FROM _ids), (SELECT ord FROM _ids), (SELECT prof FROM _ids)),
  'P0002', NULL, 'T1: display oversell flag OFF -> P0002');

SELECT throws_ok(
  format($q$SELECT _record_sale_stock_v1(%L::uuid, 6, %L::uuid, %L::uuid, 't2', p_allow_negative := true)$q$,
         (SELECT disp FROM _ids), (SELECT ord FROM _ids), (SELECT prof FROM _ids)),
  'P0002', NULL, 'T2: display oversell flag ON -> P0002 (garde inconditionnelle, plus de 23514)');

SELECT throws_ok(
  format($q$SELECT _record_sale_stock_v1(%L::uuid, 1, %L::uuid, %L::uuid, 't3', p_allow_negative := false)$q$,
         (SELECT trk FROM _ids), (SELECT ord FROM _ids), (SELECT prof FROM _ids)),
  'P0002', NULL, 'T3: tracked non-display insuffisant flag OFF -> P0002');

SELECT lives_ok(
  format($q$SELECT _record_sale_stock_v1(%L::uuid, 2, %L::uuid, %L::uuid, 't4', p_allow_negative := false)$q$,
         (SELECT disp FROM _ids), (SELECT ord FROM _ids), (SELECT prof FROM _ids)),
  'T4: display avec stock suffisant passe');
SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2 : la lancer et vérifier qu'elle échoue**

Run : MCP `execute_sql` (project `ikcyvlovptebroadgtvd`) avec le contenu du fichier.
Expected : T1/T2/T3 `not ok` (T1/T3 lèvent P0001, T2 lève 23514), T4 ok.

- [ ] **Step 3 : re-vérifier le corps live puis appliquer la migration `_107`**

D'abord `execute_sql` : `SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='_record_sale_stock_v1';` — diff avec le corps ci-dessous (qui EST le corps live du 2026-07-05 + les 3 changements marqués `-- S61`). Si le live a bougé, re-porter les changements sur le live.

Puis MCP `apply_migration` (name `record_sale_stock_v1_p0002_contract`) ET écrire le même contenu dans `supabase/migrations/20260710000107_record_sale_stock_v1_p0002_contract.sql` :

```sql
-- S61 F-2 : contrat d'erreur des gardes d'insuffisance de _record_sale_stock_v1.
-- 1) garde display INCONDITIONNELLE (la CHECK display_stock_quantity_check interdit
--    le négatif quoi qu'il arrive — allow_negative_stock ne s'applique pas à la vitrine ;
--    avant : flag ON => CHECK brute 23514, classée check_violation 422 par l'EF)
-- 2) ERRCODE P0002 sur les 2 gardes (avant : P0001, que process-payment classe
--    en no_open_session — contresens caissier). L'EF mappe déjà P0002 -> insufficient_stock 409.
-- In-place depuis le corps live (DEV-S57-02), signature inchangée — les ACLs
-- (REVOKE anon/authenticated/PUBLIC de _073) survivent au CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public._record_sale_stock_v1(p_product_id uuid, p_quantity numeric, p_reference_id uuid, p_created_by uuid, p_reason text, p_movement_type movement_type DEFAULT 'sale'::movement_type, p_reference_type text DEFAULT 'orders'::text, p_unit text DEFAULT NULL::text, p_allow_negative boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_display boolean;
  v_track      boolean;
  v_current    numeric;
  v_unit       text;
  v_name       text;
  v_disp_qty   numeric;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Invalid sale quantity % for product %', p_quantity, p_product_id;
  END IF;

  SELECT is_display_item, COALESCE(track_inventory, true), current_stock, COALESCE(p_unit, unit, 'pcs'), name
    INTO v_is_display, v_track, v_current, v_unit, v_name
    FROM products WHERE id = p_product_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;

  IF v_is_display THEN
    SELECT quantity INTO v_disp_qty FROM display_stock WHERE product_id = p_product_id;
    -- S61 F-2 : garde inconditionnelle (plus de NOT p_allow_negative) + ERRCODE P0002
    IF COALESCE(v_disp_qty, 0) < p_quantity THEN
      RAISE EXCEPTION 'Insufficient display stock for product % (need %, have %)',
        v_name, p_quantity, COALESCE(v_disp_qty, 0)
        USING ERRCODE = 'P0002';
    END IF;
  ELSIF v_track THEN
    IF NOT p_allow_negative AND COALESCE(v_current, 0) < p_quantity THEN
      -- S61 F-2 : ERRCODE P0002 (l'EF process-payment mappe P0002 -> insufficient_stock 409)
      RAISE EXCEPTION 'Insufficient stock for product % (need %, have %)',
        v_name, p_quantity, COALESCE(v_current, 0)
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reference_type, reference_id, created_by
  ) VALUES (
    p_product_id, p_movement_type, -p_quantity, v_unit, p_reference_type, p_reference_id, p_created_by
  );

  UPDATE products
    SET current_stock = current_stock - p_quantity, updated_at = now()
    WHERE id = p_product_id;

  IF v_is_display THEN
    INSERT INTO display_movements (
      product_id, movement_type, quantity, reason, reference_type, reference_id, created_by
    ) VALUES (
      p_product_id, p_movement_type::text::display_movement_type, -p_quantity, p_reason, 'order', p_reference_id, p_created_by
    );
    UPDATE display_stock
      SET quantity = quantity - p_quantity, updated_at = now()
      WHERE product_id = p_product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No display_stock row for display product % — run add_display_stock_v1 first', p_product_id;
    END IF;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public._record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean) IS
  'S53 P1.4 internal sale-stock helper (EF-only, REVOKEd). S61 F-2: insufficiency guards raise P0002 (insufficient_stock contract); display guard unconditional — allow_negative_stock never applies to the display counter (CHECK >= 0).';
```

- [ ] **Step 4 : re-lancer la suite → verte, puis les ACLs**

Run : `execute_sql` avec `display_oversell_contract.test.sql` → 4/4 ok.
Puis vérifier les ACLs : `SELECT proacl FROM pg_proc WHERE proname='_record_sale_stock_v1';` — expected : pas de grant `anon`/`authenticated`/`PUBLIC` exécutable (le REVOKE S53 survit).

- [ ] **Step 5 : re-passer les ancres live impactées**

Via `execute_sql`, une par une : `sale_stock_unification.test.sql` (T13/T14 exercent les gardes), `sale_flag_aware_deduction.test.sql` (6/6), `s44_display_symmetry.test.sql`, `b2b_display_aware_stock.test.sql`, `pay_existing_flag_aware.test.sql`, `combo_sale.test.sql` (T5 P0002).
Expected : tout vert / `num_failed=0`.

- [ ] **Step 6 : commit**

```bash
git add supabase/migrations/20260710000107_record_sale_stock_v1_p0002_contract.sql supabase/tests/display_oversell_contract.test.sql
git commit -m "fix(db): S58 F-2 — P0002 contract on _record_sale_stock_v1 insufficiency guards, unconditional display guard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2 : F-5 — allowlist stations d'`import_catalog_v1` (migration `_108`)

**Files:**
- Modify: `supabase/tests/catalog_import.test.sql` (ajouter 2 asserts stations)
- Create: `supabase/migrations/20260710000108_import_catalog_v1_station_allowlist.sql`

**Interfaces:**
- Consumes: `import_catalog_v1` live (signature inchangée) — le corps est volumineux : le récupérer via `pg_get_functiondef` au moment d'écrire la migration.
- Produces: validation `dispatch_station IN ('kitchen','barista','display','none')` alignée sur la CHECK live `categories_dispatch_station_check`.

- [ ] **Step 1 : étendre `catalog_import.test.sql` (rouge d'abord)**

Ajouter à la suite existante (respecter son style/compteur `plan(n)` — l'incrémenter de 2) deux cas sur le payload categories :
1. catégorie `{"name":"S61 Display Cat","dispatch_station":"display"}` → l'import **réussit** et la catégorie existe avec `dispatch_station='display'` (aujourd'hui : rejet `invalid_dispatch_station` en validation).
2. catégorie `{"name":"S61 Bakery Cat","dispatch_station":"bakery"}` → l'import la **rejette en validation** (`invalid_dispatch_station` dans les erreurs retournées), sans lever de 23514 (aujourd'hui : passe la validation puis crashe sur la CHECK).

Reprendre le pattern d'appel existant du fichier (ligne ~354 : `jsonb_build_object('name','S41 Test Cat','dispatch_station','kitchen')`) pour construire ces payloads ; les asserts suivent la forme des asserts voisins de la suite (résultat JSON de l'RPC : compteurs/erreurs).

- [ ] **Step 2 : lancer la suite → les 2 nouveaux asserts échouent**

Run : `execute_sql` avec le fichier complet. Expected : les asserts existants restent verts, les 2 nouveaux sont `not ok`.

- [ ] **Step 3 : migration `_108` in-place depuis le corps live**

`execute_sql` : `SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='import_catalog_v1';`

Dans le corps récupéré, exactement **2 occurrences** à patcher (miroir des lignes 186-187 de `20260629000013`) :

```
AVANT : format('dispatch_station "%s" must be kitchen|barista|bakery|none', dispatch_station)
APRÈS : format('dispatch_station "%s" must be kitchen|barista|display|none', dispatch_station)

AVANT : WHERE dispatch_station NOT IN ('kitchen','barista','bakery','none');
APRÈS : WHERE dispatch_station NOT IN ('kitchen','barista','display','none');
```

Aucune autre modification. En-tête de migration :

```sql
-- S61 F-5 : aligne l'allowlist dispatch_station d'import_catalog_v1 sur la CHECK live
-- categories_dispatch_station_check {kitchen,barista,display,none}. Avant : 'display'
-- inimportable (faux rejet), 'bakery' passait la validation puis crashait en 23514.
-- In-place depuis le corps live (DEV-S57-02), signature inchangée.
```

Appliquer via `apply_migration` (name `import_catalog_v1_station_allowlist`) + écrire le fichier local `20260710000108_import_catalog_v1_station_allowlist.sql`.

- [ ] **Step 4 : re-lancer la suite → verte**

Run : `execute_sql` avec `catalog_import.test.sql`. Expected : tout vert, y compris les 2 nouveaux asserts.

- [ ] **Step 5 : commit**

```bash
git add supabase/migrations/20260710000108_import_catalog_v1_station_allowlist.sql supabase/tests/catalog_import.test.sql
git commit -m "fix(db): S58 F-5 — align import_catalog_v1 station allowlist on live CHECK (display importable, bakery rejected)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3 : Décommissionnement léger péremption (06 D3.1, migration `_109`)

**Files:**
- Create: `supabase/migrations/20260710000109_deactivate_mark_expired_lots_cron.sql`
- Modify: `apps/backoffice/src/routes/index.tsx` (retirer routes + lazy imports `inventory/expiring` et `reports/perishable-turnover`)
- Modify: `apps/backoffice/src/layouts/Sidebar.tsx:98,160` (retirer les 2 entrées + icônes devenues inutilisées)
- Modify: `apps/backoffice/src/pages/reports/ReportsIndexPage.tsx:57` (retirer la tuile Perishable Turnover)
- Modify: `apps/backoffice/src/features/inventory-alerts/components/AlertsBadge.tsx` (retirer le terme expiring du total/title, garder low+reorder) + `__tests__/AlertsBadge.test.tsx`
- Modify: `apps/backoffice/src/pages/inventory/ProductStockPage.tsx` et `ProductDashboardPage.tsx` (retirer le panneau « expiring lots » ; le champ `expiring_lots` reste dans le type `useProductDashboard.ts` — payload RPC inchangé)
- Modify: `apps/backoffice/src/features/reports/hooks/useGeneratePdf.ts:15` (retirer `'perishable_turnover'` de l'union)
- Delete: `apps/backoffice/src/features/inventory/pages/ExpiringStockPage.tsx`, `features/inventory/__tests__/ExpiringStockPage.smoke.test.tsx`, `features/inventory/components/ExpiringLotsBadge.tsx`, `features/inventory/hooks/useExpiringLots.ts`, `pages/reports/PerishableTurnoverPage.tsx`, `pages/reports/__tests__/PerishableTurnoverPage.smoke.test.tsx`, `features/reports/hooks/usePerishableTurnover.ts`

**Interfaces:**
- Consumes: rien des tasks précédentes.
- Produces: plus aucune surface péremption navigable au BO ; cron inactif. **Restent dormants (pas de DROP)** : table `stock_lots`, RPCs `get_expiring_lots_v1`/`mark_expired_lots_hourly`, template PDF `perishable_turnover` côté EF `generate-pdf`.

- [ ] **Step 1 : migration `_109` — cron inactif**

```sql
-- S61 (06 D3.1) : décision propriétaire 2026-07-04 — pas de péremption/FIFO stock.
-- Désactive le job pg_cron mark_expired_lots_hourly (jobid résolu par nom, pas de DROP :
-- la fonction et stock_lots restent dormantes ; réactivation = active := true).
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'mark_expired_lots_hourly';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(v_jobid, active := false);
  END IF;
END $$;
```

Appliquer via `apply_migration` (name `deactivate_mark_expired_lots_cron`) + fichier local. Vérifier : `SELECT jobname, active FROM cron.job WHERE jobname='mark_expired_lots_hourly';` → `active = false`.

- [ ] **Step 2 : grep de contrôle avant purge**

Run : `rg -l "ExpiringStockPage|PerishableTurnoverPage|ExpiringLotsBadge|useExpiringLots|usePerishableTurnover|perishable" apps/ packages/`
Expected : uniquement les fichiers listés ci-dessus. Tout consommateur supplémentaire découvert = le traiter dans ce même step (retrait de l'import/usage).

- [ ] **Step 3 : purge frontend**

Supprimer les 7 fichiers listés en Delete ; retirer routes/lazy-imports, entrées sidebar, tuile ReportsIndex, terme expiring d'AlertsBadge (total = low + reorder ; title sans « expiring »), panneaux expiring des 2 pages produit, `'perishable_turnover'` de l'union `useGeneratePdf`. Mettre à jour `AlertsBadge.test.tsx` (plus de mock useExpiringLots).

- [ ] **Step 4 : vérification**

Run : `pnpm typecheck && pnpm --filter @breakery/backoffice test && pnpm build`
Expected : exit 0 partout (plus aucune référence orpheline).

- [ ] **Step 5 : commit**

```bash
git add -A apps/backoffice supabase/migrations/20260710000109_deactivate_mark_expired_lots_cron.sql
git commit -m "feat(backoffice,db): decommission expiry/lots surfaces per 2026-07-04 owner decision (cron off, pages purged, stock_lots dormant)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4 : Closeout S61

**Files:**
- Create: `docs/workplan/plans/2026-07-05-session-61-INDEX.md`
- Modify: `docs/workplan/remise-a-plat/00-INDEX.md` (§3 : F-2/F-5 soldés, D3.1 Vague 2 soldé ; fiche 06 note de mise à jour ; fiche 05 si stations mentionnées)
- Modify: `CLAUDE.md` (Active Workplan : merged S61, next-session)

- [ ] **Step 1 : re-passe finale des ancres money-path live** (même liste que T1 Step 5 + `s44_money_gates` 12/12) — via `execute_sql`, consigner les compteurs.
- [ ] **Step 2 : types no-drift** : `generate_typescript_types` → diff avec `packages/supabase/src/types.generated.ts` → attendu : zéro drift (signatures inchangées). Si drift : STOP, investiguer avant de committer quoi que ce soit.
- [ ] **Step 3 : suite monorepo** : `pnpm typecheck && pnpm build && pnpm test` → exit 0.
- [ ] **Step 4 : docs** : INDEX session S61 (tasks, migrations `_107..109`, ancres, dettes éventuelles), notes fiches 05/06, 00-INDEX §3, CLAUDE.md bump (S61 merged + prochaine session).
- [ ] **Step 5 : commit docs + PR**

```bash
git add docs/ CLAUDE.md
git commit -m "docs(workplan): closeout S61 — F-2/F-5 fixed + expiry decommission (INDEX, 00-INDEX, CLAUDE.md)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin swarm/session-61
gh pr create --title "S61 — Findings S58 F-2/F-5 + décommissionnement péremption" --base master
```

Body de PR : résumé des 3 chantiers + compteurs d'ancres + mention « stock_lots dormante, pas de DROP » + footer 🤖.

---

## Self-review (fait à l'écriture)

1. **Couverture** : F-2 (T1), F-5 (T2), D3.1 (T3), critères transverses money-path/types/docs (T4) — complet. Hors scope assumé : `get_expiring_lots_v1`/fonction cron/template PDF EF restent dormants (cohérent avec « pas de DROP », consigné dans l'INDEX S61 comme dette documentée).
2. **Placeholders** : aucun — corps `_107` complet (live + 3 changements marqués), patch `_108` en AVANT/APRÈS exacts, `_109` complet, listes de fichiers exhaustives (vérifiées par grep le 2026-07-05).
3. **Cohérence types/signatures** : signatures SQL inchangées dans les 2 migrations in-place ; aucun symbole TS nouveau.
