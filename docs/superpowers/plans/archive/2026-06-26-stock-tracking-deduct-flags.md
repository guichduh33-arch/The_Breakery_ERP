# Câblage `track_inventory` / `deduct_stock` + réglage global « stock négatif » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire produire aux deux flags produit (`track_inventory`, `deduct_stock`) le comportement métier voulu à la vente et à la production, et ajouter un réglage global « autoriser le stock négatif ».

**Architecture:** 3 couches DB (colonne `business_config` + RPC settings ; primitive `record_stock_movement_v1` ; money-path vente + RPC production) + 1 helper récursif de cascade recette + UI BackOffice (page Réglages Inventory). Les RPC vente/production sont remplacées **en place** (`CREATE OR REPLACE`, signature inchangée) — pas de bump de version, donc l'EF `process-payment` et les call-sites ne bougent pas. Seul le primitive gagne un paramètre optionnel (DROP + CREATE).

**Tech Stack:** PostgreSQL/plpgsql (Supabase cloud V3 dev `ikcyvlovptebroadgtvd`, via MCP `apply_migration`/`execute_sql`), TypeScript types générés, React/TanStack Query (BackOffice), Vitest live-RPC + pgTAP.

## Global Constraints

- **Cible DB = Supabase cloud V3 dev `ikcyvlovptebroadgtvd`** — appliquer les migrations via MCP `mcp__plugin_supabase_supabase__apply_migration` ; jamais `pnpm db:reset`/`supabase start` (Docker retiré).
- **Numérotation de migration monotone** — préfixe à partir de `20260710000020` (plus haute actuelle : `20260710000012`). Vérifier `supabase/migrations/` avant chaque `apply_migration`.
- **REVOKE pair S25 sur tout RPC nouveau/modifié** : `REVOKE EXECUTE … FROM PUBLIC;` + `REVOKE EXECUTE … FROM anon;` + `ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;`. `REVOKE FROM anon` seul est insuffisant.
- **`stock_movements` append-only** — jamais d'`UPDATE`/`DELETE`. Les écritures passent par `record_stock_movement_v1` (production) ou par les INSERT directs internes au RPC `complete_order_with_payment_v14` (vente) — pattern existant conservé.
- **RPC versioning monotone** — ne jamais éditer une *signature* publiée. Ici les RPC vente/production gardent leur signature → `CREATE OR REPLACE` en place (précédent : `20260622000015_wire_pin_lockout_complete_order_v11.sql`). Le primitive change de signature → `DROP` exact + `CREATE`.
- **Toujours régénérer les types** après un changement de schéma/signature : MCP `generate_typescript_types` → écrire `packages/supabase/src/types.generated.ts` → commit. Cause #1 de CI cassée.
- **Pour pulls de définition live** : `SELECT pg_get_functiondef('public.<fn>'::regprocedure);` via MCP `execute_sql` — copier le corps réel plutôt que se fier au fichier de migration (corps recomposé sur plusieurs migrations).
- **pgTAP** via MCP `execute_sql` enveloppé `BEGIN; … ROLLBACK;`. Tests live-RPC via Vitest (`pnpm --filter @breakery/supabase test <name>`).

### Sémantique cible (rappel — table de vérité)

| Profil | `track_inventory` | `deduct_stock` | Sortie stock à la vente |
|---|---|---|---|
| Matière première | `true` | `false` | déduit son propre stock si vendue en direct ; sinon via cascade d'un parent |
| Semi-fini suivi | `true` | `true` | déduit 1× son stock (nœud d'arrêt) |
| Fini préparé à l'avance | `true` | `true` | déduit 1× son stock |
| Fini fait à la commande | `false` | `true` | **cascade recette**, arrêt aux nœuds suivis |
| Service / non suivi | `false` | `false` | rien |

Règle vente (par ligne) :
- `track_inventory = true` → décrémente `current_stock` du produit (1×). Pas de cascade.
- `track_inventory = false AND deduct_stock = true` → cascade `_resolve_recipe_consumption_v1`.
- `track_inventory = false AND deduct_stock = false` → rien.
- `allow_negative_stock` gouverne tous les blocages d'insuffisance (vente + production).

---

## File Structure

- **Migrations (créées)** sous `supabase/migrations/` :
  - `20260710000020_add_allow_negative_stock_and_inventory_settings.sql` — colonne + extension des 2 RPC settings.
  - `20260710000021_record_stock_movement_v1_allow_negative.sql` — primitive + param.
  - `20260710000022_create_resolve_recipe_consumption_v1.sql` — helper cascade.
  - `20260710000023_complete_order_v14_flag_aware_deduction.sql` — vente en place.
  - `20260710000024_record_production_v1_flag_and_negative_aware.sql` — production en place.
  - `20260710000025_record_batch_production_v2_flag_and_negative_aware.sql` — batch en place.
- **Types (modifié)** : `packages/supabase/src/types.generated.ts` (regen).
- **BackOffice (créés/modifiés)** :
  - Create `apps/backoffice/src/pages/settings/SettingsInventoryPage.tsx`.
  - Modify `apps/backoffice/src/features/settings/hooks/useSettings.ts` (type `SettingsCategory` + `'inventory'`).
  - Modify `apps/backoffice/src/routes/index.tsx` (route `settings/inventory`).
  - Modify `apps/backoffice/src/layouts/Sidebar.tsx` (entrée nav).
  - Modify `apps/backoffice/src/features/products/components/GeneralPanel.tsx` (libellés des toggles).
  - Create `apps/backoffice/src/features/settings/__tests__/SettingsInventoryPage.smoke.test.tsx`.
- **Tests DB** : `supabase/tests/` (pgTAP) + `supabase/tests/functions/` (Vitest live-RPC).

---

## Task 1 : Réglage `allow_negative_stock` (colonne + RPC settings)

**Files:**
- Create: `supabase/migrations/20260710000020_add_allow_negative_stock_and_inventory_settings.sql`
- Test: `supabase/tests/functions/settings-inventory.test.ts`
- Modify (regen): `packages/supabase/src/types.generated.ts`

**Interfaces:**
- Produces : colonne `business_config.allow_negative_stock BOOLEAN NOT NULL DEFAULT true`. `get_settings_by_category_v1('inventory') → { category:'inventory', settings:{ allow_negative_stock: bool } }`. `set_setting_v1('allow_negative_stock', <bool jsonb>, 'inventory')` met à jour la colonne, gate `settings.update`.

- [ ] **Step 1 : Écrire le test live-RPC qui échoue**

Créer `supabase/tests/functions/settings-inventory.test.ts` (calque sur les autres fichiers `supabase/tests/functions/*.test.ts` pour le harness client authentifié ADMIN) :

```ts
import { describe, it, expect } from 'vitest';
import { adminRpc } from './_harness'; // réutiliser le helper d'auth existant du dossier

describe('inventory settings — allow_negative_stock', () => {
  it('reads the inventory category with a boolean default', async () => {
    const { data, error } = await adminRpc('get_settings_by_category_v1', { p_category: 'inventory' });
    expect(error).toBeNull();
    expect(data.category).toBe('inventory');
    expect(typeof data.settings.allow_negative_stock).toBe('boolean');
  });

  it('round-trips a write through set_setting_v1', async () => {
    await adminRpc('set_setting_v1', { p_key: 'allow_negative_stock', p_value: false, p_category: 'inventory' });
    const after = await adminRpc('get_settings_by_category_v1', { p_category: 'inventory' });
    expect(after.data.settings.allow_negative_stock).toBe(false);
    // restore default
    await adminRpc('set_setting_v1', { p_key: 'allow_negative_stock', p_value: true, p_category: 'inventory' });
  });

  it('rejects a non-boolean value', async () => {
    const { error } = await adminRpc('set_setting_v1', { p_key: 'allow_negative_stock', p_value: 'yes', p_category: 'inventory' });
    expect(error).not.toBeNull();
  });
});
```

> Si `_harness` n'existe pas sous ce nom, ouvrir un fichier voisin de `supabase/tests/functions/` et réutiliser exactement son utilitaire d'auth/admin (ne pas inventer une nouvelle connexion).

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `pnpm --filter @breakery/supabase test settings-inventory`
Expected: FAIL — `allow_negative_stock` absent (settings vide pour `inventory`).

- [ ] **Step 3 : Écrire la migration**

Créer `supabase/migrations/20260710000020_add_allow_negative_stock_and_inventory_settings.sql` :

```sql
-- 20260710000020_add_allow_negative_stock_and_inventory_settings.sql
-- Réglage global "autoriser le stock négatif" (vente + production), défaut ON.
-- Stocké sur le singleton business_config (id=1), exposé via la catégorie
-- symbolique 'inventory' des RPC settings (signatures inchangées → REPLACE).

ALTER TABLE public.business_config
  ADD COLUMN IF NOT EXISTS allow_negative_stock BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.business_config.allow_negative_stock IS
  'Quand true (défaut), la vente et la production passent même si le stock des '
  'matières premières est insuffisant (current_stock devient négatif). Quand '
  'false, complete_order_with_payment_v14 et record_production_v1/batch_v2 '
  'lèvent insufficient_stock (P0002).';

-- ── get_settings_by_category_v1 : ajouter la catégorie 'inventory' ───────────
CREATE OR REPLACE FUNCTION public.get_settings_by_category_v1(
  p_category TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_settings JSONB;
  v_row      business_config%ROWTYPE;
BEGIN
  IF NOT has_permission(auth.uid(), 'settings.read') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM business_config WHERE id = 1;

  IF v_row IS NULL THEN
    RETURN jsonb_build_object('category', p_category, 'settings', '{}'::jsonb);
  END IF;

  v_settings :=
    CASE LOWER(COALESCE(p_category, ''))
      WHEN 'business' THEN jsonb_build_object(
        'name', v_row.name, 'fiscal_address', v_row.fiscal_address)
      WHEN 'localization' THEN jsonb_build_object(
        'currency', v_row.currency, 'timezone', v_row.timezone)
      WHEN 'tax' THEN jsonb_build_object(
        'tax_rate', v_row.tax_rate, 'tax_inclusive', v_row.tax_inclusive)
      WHEN 'pos' THEN jsonb_build_object(
        'shift_variance_threshold_pct', v_row.shift_variance_threshold_pct,
        'shift_variance_threshold_abs', v_row.shift_variance_threshold_abs)
      WHEN 'inventory' THEN jsonb_build_object(
        'allow_negative_stock', v_row.allow_negative_stock)
      ELSE '{}'::jsonb
    END;

  RETURN jsonb_build_object('category', p_category, 'settings', v_settings);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_settings_by_category_v1(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_settings_by_category_v1(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_settings_by_category_v1(TEXT) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ── set_setting_v1 : ajouter la clé 'allow_negative_stock' ───────────────────
-- (le corps complet est repris à l'identique + un WHEN ajouté avant le ELSE).
CREATE OR REPLACE FUNCTION public.set_setting_v1(
  p_key      TEXT,
  p_value    JSONB,
  p_category TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor_id  UUID;
  v_old       JSONB;
  v_new       JSONB;
BEGIN
  IF NOT has_permission(auth.uid(), 'settings.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR p_key = '' THEN
    RAISE EXCEPTION 'setting_key_required' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_actor_id FROM user_profiles
    WHERE auth_user_id = auth.uid() AND deleted_at IS NULL LIMIT 1;

  CASE p_key
    WHEN 'name' THEN
      IF jsonb_typeof(p_value) <> 'string' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE='22023', DETAIL='name expects string';
      END IF;
      IF (p_value #>> '{}') IS NULL OR (p_value #>> '{}') = '' THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE='22023', DETAIL='name cannot be empty';
      END IF;
      SELECT to_jsonb(name) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET name = p_value #>> '{}', updated_at = now() WHERE id = 1;
      v_new := p_value;
    WHEN 'fiscal_address' THEN
      IF p_value <> 'null'::jsonb AND jsonb_typeof(p_value) <> 'string' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE='22023', DETAIL='fiscal_address expects string or null';
      END IF;
      SELECT to_jsonb(fiscal_address) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config
        SET fiscal_address = CASE WHEN p_value='null'::jsonb THEN NULL ELSE p_value #>> '{}' END,
            updated_at = now() WHERE id = 1;
      v_new := p_value;
    WHEN 'currency' THEN
      IF jsonb_typeof(p_value) <> 'string' OR (p_value #>> '{}')='' THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE='22023', DETAIL='currency required';
      END IF;
      SELECT to_jsonb(currency) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET currency = p_value #>> '{}', updated_at = now() WHERE id = 1;
      v_new := p_value;
    WHEN 'timezone' THEN
      IF jsonb_typeof(p_value) <> 'string' OR (p_value #>> '{}')='' THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE='22023', DETAIL='timezone required';
      END IF;
      SELECT to_jsonb(timezone) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET timezone = p_value #>> '{}', updated_at = now() WHERE id = 1;
      v_new := p_value;
    WHEN 'tax_rate' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE='22023', DETAIL='tax_rate expects number';
      END IF;
      IF (p_value #>> '{}')::NUMERIC < 0 OR (p_value #>> '{}')::NUMERIC > 1 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE='22023', DETAIL='tax_rate must be in [0, 1]';
      END IF;
      SELECT to_jsonb(tax_rate) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET tax_rate = (p_value #>> '{}')::NUMERIC, updated_at = now() WHERE id = 1;
      v_new := p_value;
    WHEN 'tax_inclusive' THEN
      IF jsonb_typeof(p_value) <> 'boolean' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE='22023', DETAIL='tax_inclusive expects boolean';
      END IF;
      SELECT to_jsonb(tax_inclusive) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET tax_inclusive = (p_value #>> '{}')::BOOLEAN, updated_at = now() WHERE id = 1;
      v_new := p_value;
    WHEN 'shift_variance_threshold_pct' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE='22023', DETAIL='shift_variance_threshold_pct expects number';
      END IF;
      IF (p_value #>> '{}')::NUMERIC < 0 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE='22023', DETAIL='shift_variance_threshold_pct must be >= 0';
      END IF;
      SELECT to_jsonb(shift_variance_threshold_pct) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET shift_variance_threshold_pct = (p_value #>> '{}')::NUMERIC, updated_at = now() WHERE id = 1;
      v_new := p_value;
    WHEN 'shift_variance_threshold_abs' THEN
      IF jsonb_typeof(p_value) <> 'number' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE='22023', DETAIL='shift_variance_threshold_abs expects number';
      END IF;
      IF (p_value #>> '{}')::NUMERIC < 0 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE='22023', DETAIL='shift_variance_threshold_abs must be >= 0';
      END IF;
      SELECT to_jsonb(shift_variance_threshold_abs) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET shift_variance_threshold_abs = (p_value #>> '{}')::NUMERIC, updated_at = now() WHERE id = 1;
      v_new := p_value;
    WHEN 'allow_negative_stock' THEN
      IF jsonb_typeof(p_value) <> 'boolean' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE='22023', DETAIL='allow_negative_stock expects boolean';
      END IF;
      SELECT to_jsonb(allow_negative_stock) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET allow_negative_stock = (p_value #>> '{}')::BOOLEAN, updated_at = now() WHERE id = 1;
      v_new := p_value;
    ELSE
      RAISE EXCEPTION 'setting_unknown' USING ERRCODE='22023', DETAIL='unknown setting key: ' || p_key;
  END CASE;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_actor_id, 'setting.update', 'setting', NULL,
      jsonb_build_object('key', p_key, 'category', p_category,
        'old', COALESCE(v_old, 'null'::jsonb), 'new', v_new));
END;
$function$;

REVOKE ALL ON FUNCTION public.set_setting_v1(TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_setting_v1(TEXT, JSONB, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_setting_v1(TEXT, JSONB, TEXT) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 4 : Appliquer la migration**

Via MCP `mcp__plugin_supabase_supabase__apply_migration` (`project_id='ikcyvlovptebroadgtvd'`, `name='add_allow_negative_stock_and_inventory_settings'`, `query=` contenu du fichier).

- [ ] **Step 5 : Régénérer les types et les écrire**

MCP `mcp__plugin_supabase_supabase__generate_typescript_types` → écrire le résultat dans `packages/supabase/src/types.generated.ts`.

- [ ] **Step 6 : Relancer le test, vérifier le succès**

Run: `pnpm --filter @breakery/supabase test settings-inventory`
Expected: PASS (3 tests verts).

- [ ] **Step 7 : Commit**

```bash
git add supabase/migrations/20260710000020_add_allow_negative_stock_and_inventory_settings.sql \
  supabase/tests/functions/settings-inventory.test.ts packages/supabase/src/types.generated.ts
git commit -m "feat(inventory): allow_negative_stock setting + inventory settings category"
```

---

## Task 2 : Primitive `record_stock_movement_v1` — paramètre `p_allow_negative`

**Files:**
- Create: `supabase/migrations/20260710000021_record_stock_movement_v1_allow_negative.sql`
- Test: `supabase/tests/inventory_allow_negative.test.sql` (pgTAP)
- Modify (regen): `packages/supabase/src/types.generated.ts`

**Interfaces:**
- Consumes : rien.
- Produces : `record_stock_movement_v1(p_product_id UUID, p_movement_type movement_type, p_quantity DECIMAL(10,3), p_reason TEXT, p_unit_cost DECIMAL(14,2) DEFAULT NULL, p_supplier_id UUID DEFAULT NULL, p_idempotency_key UUID DEFAULT NULL, p_unit TEXT DEFAULT NULL, p_allow_negative BOOLEAN DEFAULT false)`. Quand `p_allow_negative=true`, le garde négatif est désactivé. Les appelants par paramètres nommés existants (adjust/receive/waste/transfer) restent compatibles (défaut `false`).

- [ ] **Step 1 : Écrire le test pgTAP qui échoue**

Créer `supabase/tests/inventory_allow_negative.test.sql` :

```sql
BEGIN;
SELECT plan(2);

-- Fixture : un produit avec un petit stock connu (réutiliser un product seed
-- ou en insérer un de test ; ici on suppose un helper d'insertion existant).
-- Remplacer <PID> par l'uuid d'un produit de test à current_stock = 1.

-- 1. Sans p_allow_negative : sortie > stock => insufficient_stock.
SELECT throws_ok(
  $$ SELECT record_stock_movement_v1(
       p_product_id := '<PID>'::uuid, p_movement_type := 'adjustment',
       p_quantity := -5, p_reason := 'test neg block') $$,
  'P0002', NULL, 'blocks negative when p_allow_negative defaults false');

-- 2. Avec p_allow_negative := true : passe en négatif.
SELECT lives_ok(
  $$ SELECT record_stock_movement_v1(
       p_product_id := '<PID>'::uuid, p_movement_type := 'adjustment',
       p_quantity := -5, p_reason := 'test neg allow', p_allow_negative := true) $$,
  'allows negative when p_allow_negative := true');

SELECT * FROM finish();
ROLLBACK;
```

> Pour le fixture, suivre le pattern d'insertion de produit des fichiers `supabase/tests/inventory*.test.sql` existants (mêmes colonnes NOT NULL). Le test tourne via MCP `execute_sql` avec l'enveloppe `BEGIN … ROLLBACK`.

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Exécuter le fichier via MCP `execute_sql`.
Expected: FAIL — `record_stock_movement_v1` n'accepte pas encore `p_allow_negative` (erreur "function … does not exist" sur l'appel nommé).

- [ ] **Step 3 : Écrire la migration**

D'abord récupérer le corps live exact : `SELECT pg_get_functiondef('public.record_stock_movement_v1'::regprocedure);`. Créer `supabase/migrations/20260710000021_record_stock_movement_v1_allow_negative.sql` reprenant ce corps avec **deux** changements : (a) nouveau paramètre final `p_allow_negative BOOLEAN DEFAULT false`, (b) le garde négatif tient compte du flag :

```sql
-- 20260710000021_record_stock_movement_v1_allow_negative.sql
-- Ajoute p_allow_negative au primitive : permet aux flux vente/production de
-- laisser le stock passer en négatif quand business_config.allow_negative_stock
-- est ON. Les wrappers existants (named-param) gardent le défaut false.

DROP FUNCTION IF EXISTS record_stock_movement_v1(
  UUID, movement_type, DECIMAL(10,3), TEXT, DECIMAL(14,2), UUID, UUID, TEXT
);

CREATE OR REPLACE FUNCTION record_stock_movement_v1(
  p_product_id      UUID,
  p_movement_type   movement_type,
  p_quantity        DECIMAL(10,3),
  p_reason          TEXT,
  p_unit_cost       DECIMAL(14,2)  DEFAULT NULL,
  p_supplier_id     UUID           DEFAULT NULL,
  p_idempotency_key UUID           DEFAULT NULL,
  p_unit            TEXT           DEFAULT NULL,
  p_allow_negative  BOOLEAN        DEFAULT false
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_profile  UUID;
  v_current  DECIMAL(10,3);
  v_new      DECIMAL(10,3);
  v_mvt_id   UUID;
  v_unit     TEXT;
BEGIN
  IF p_movement_type IN ('sale', 'sale_void') THEN
    RAISE EXCEPTION 'record_stock_movement_v1 cannot be called with movement_type=%', p_movement_type;
  END IF;
  IF p_quantity = 0 THEN
    RAISE EXCEPTION 'quantity_must_be_nonzero';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_mvt_id FROM stock_movements WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      SELECT current_stock INTO v_new FROM products WHERE id = p_product_id;
      RETURN jsonb_build_object('movement_id', v_mvt_id, 'product_id', p_product_id,
        'new_current_stock', v_new, 'idempotent_replay', true);
    END IF;
  END IF;

  SELECT id INTO v_profile FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT current_stock, unit INTO v_current, v_unit
    FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE='P0002';
  END IF;

  v_unit := COALESCE(p_unit, v_unit, 'pcs');

  v_new := v_current + p_quantity;
  -- Negative-stock guard : désactivable via p_allow_negative (flux vente/prod
  -- quand business_config.allow_negative_stock est ON).
  IF v_new < 0 AND NOT p_allow_negative THEN
    RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002';
  END IF;

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, unit, reason, unit_cost,
    supplier_id, idempotency_key, reference_type, created_by
  ) VALUES (
    p_product_id, p_movement_type, p_quantity, v_unit, p_reason, p_unit_cost,
    p_supplier_id, p_idempotency_key, 'admin_action', v_profile
  ) RETURNING id INTO v_mvt_id;

  UPDATE products SET current_stock = v_new WHERE id = p_product_id;

  INSERT INTO audit_log (action, subject_table, subject_id, payload, actor_profile_id)
  VALUES ('stock.movement', 'stock_movements', v_mvt_id,
    jsonb_build_object('movement_type', p_movement_type, 'quantity', p_quantity,
      'unit', v_unit, 'reason', p_reason, 'new_current_stock', v_new,
      'idempotency_key', p_idempotency_key, 'allow_negative', p_allow_negative),
    v_profile);

  RETURN jsonb_build_object('movement_id', v_mvt_id, 'product_id', p_product_id,
    'new_current_stock', v_new, 'idempotent_replay', false);
END $$;

REVOKE EXECUTE ON FUNCTION record_stock_movement_v1(
  UUID, movement_type, DECIMAL(10,3), TEXT, DECIMAL(14,2), UUID, UUID, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_stock_movement_v1(
  UUID, movement_type, DECIMAL(10,3), TEXT, DECIMAL(14,2), UUID, UUID, TEXT, BOOLEAN) FROM authenticated;
REVOKE EXECUTE ON FUNCTION record_stock_movement_v1(
  UUID, movement_type, DECIMAL(10,3), TEXT, DECIMAL(14,2), UUID, UUID, TEXT, BOOLEAN) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION record_stock_movement_v1(
  UUID, movement_type, DECIMAL(10,3), TEXT, DECIMAL(14,2), UUID, UUID, TEXT, BOOLEAN) IS
  'INTERNAL primitive. v3 : + p_allow_negative (défaut false) pour désactiver le '
  'garde négatif sur les flux vente/production quand allow_negative_stock est ON.';
```

> ⚠️ Si `pg_get_functiondef` révèle un corps différent (autre migration appliquée après `20260516000019`), repartir du corps live — ne garder que les 2 changements (param + garde).

- [ ] **Step 4 : Appliquer la migration** (MCP `apply_migration`, name `record_stock_movement_v1_allow_negative`).

- [ ] **Step 5 : Régénérer les types** → `packages/supabase/src/types.generated.ts`.

- [ ] **Step 6 : Relancer le test pgTAP, vérifier le succès** (MCP `execute_sql`). Expected: 2/2 PASS.

- [ ] **Step 7 : Vérifier la non-régression des wrappers**

Run: `pnpm --filter @breakery/supabase test inventory`
Expected: PASS (adjust/receive/waste/transfer inchangés — appels par paramètres nommés, défaut `false`).

- [ ] **Step 8 : Commit**

```bash
git add supabase/migrations/20260710000021_record_stock_movement_v1_allow_negative.sql \
  supabase/tests/inventory_allow_negative.test.sql packages/supabase/src/types.generated.ts
git commit -m "feat(inventory): record_stock_movement_v1 p_allow_negative param"
```

---

## Task 3 : Helper cascade `_resolve_recipe_consumption_v1` (arrêt aux nœuds suivis)

**Files:**
- Create: `supabase/migrations/20260710000022_create_resolve_recipe_consumption_v1.sql`
- Test: `supabase/tests/recipe_consumption_cascade.test.sql` (pgTAP)

**Interfaces:**
- Consumes : `_try_convert_quantity(NUMERIC, TEXT, TEXT)` (existant).
- Produces : `_resolve_recipe_consumption_v1(p_product_id UUID, p_qty NUMERIC, p_max_depth INT DEFAULT 5) RETURNS TABLE(product_id UUID, qty_base NUMERIC, unit TEXT)` — pour un produit fait-à-la-commande, retourne les nœuds **suivis** (`track_inventory=true`) à décrémenter, quantités converties dans l'unité stock du nœud, en s'arrêtant à chaque nœud suivi et en descendant à travers les nœuds non suivis.

- [ ] **Step 1 : Écrire le test pgTAP qui échoue**

Créer `supabase/tests/recipe_consumption_cascade.test.sql` :

```sql
BEGIN;
SELECT plan(3);

-- Fixture (suivre le pattern des tests recipe_*.test.sql) :
--   - MILK  : track_inventory=true,  deduct_stock=false (matière première)
--   - BEANS : track_inventory=true,  deduct_stock=false
--   - ESPRESSO : track_inventory=false, deduct_stock=true, recette = 18 'g' BEANS
--   - CAPPU : track_inventory=false, deduct_stock=true, recette = 1 ESPRESSO + 150 'ml' MILK
-- (insérer products + recipes ; voir un fichier recipe_*.test.sql pour les colonnes)

-- 1. Vente d'1 CAPPU : la cascade descend dans ESPRESSO (non suivi) et s'arrête
--    sur BEANS + MILK (suivis). Donc 2 lignes.
SELECT is(
  (SELECT count(*)::int FROM _resolve_recipe_consumption_v1('<CAPPU>'::uuid, 1)),
  2, 'cappuccino cascade yields exactly the two tracked leaves (beans + milk)');

-- 2. BEANS est présent avec une quantité > 0.
SELECT ok(
  (SELECT qty_base FROM _resolve_recipe_consumption_v1('<CAPPU>'::uuid, 1)
     WHERE product_id = '<BEANS>'::uuid) > 0,
  'beans consumption is positive');

-- 3. Si ESPRESSO devient suivi (track_inventory=true), la cascade s'arrête sur
--    lui : on attend ESPRESSO + MILK (plus BEANS).
UPDATE products SET track_inventory = true WHERE id = '<ESPRESSO>'::uuid;
SELECT ok(
  EXISTS(SELECT 1 FROM _resolve_recipe_consumption_v1('<CAPPU>'::uuid, 1)
           WHERE product_id = '<ESPRESSO>'::uuid)
  AND NOT EXISTS(SELECT 1 FROM _resolve_recipe_consumption_v1('<CAPPU>'::uuid, 1)
           WHERE product_id = '<BEANS>'::uuid),
  'stops at espresso once it becomes tracked');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec** (MCP `execute_sql`). Expected: FAIL — fonction inexistante.

- [ ] **Step 3 : Écrire la migration**

Créer `supabase/migrations/20260710000022_create_resolve_recipe_consumption_v1.sql` :

```sql
-- 20260710000022_create_resolve_recipe_consumption_v1.sql
-- Helper interne : résout la consommation de recette d'un produit fait-à-la-
-- commande (track_inventory=false) à la VENTE, avec la règle "arrêt aux nœuds
-- suivis" : on descend uniquement à travers les composants non suivis et on
-- émet uniquement les nœuds suivis (track_inventory=true). Mêmes hypothèses de
-- conversion d'unité que recipe_bom_full_v1 (_try_convert_quantity, fallback raw).

CREATE OR REPLACE FUNCTION public._resolve_recipe_consumption_v1(
  p_product_id UUID,
  p_qty        NUMERIC,
  p_max_depth  INT DEFAULT 5
) RETURNS TABLE(product_id UUID, qty_base NUMERIC, unit TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE walk AS (
    SELECT r.material_id,
           (p_qty * r.quantity::NUMERIC) AS qty,
           r.unit AS line_unit,
           1 AS depth,
           ARRAY[r.product_id, r.material_id]::UUID[] AS path
      FROM recipes r
     WHERE r.product_id = p_product_id
       AND r.is_active = TRUE
       AND r.deleted_at IS NULL
    UNION ALL
    SELECT cr.material_id,
           (w.qty * cr.quantity::NUMERIC),
           cr.unit,
           w.depth + 1,
           w.path || cr.material_id
      FROM walk w
      JOIN products wp ON wp.id = w.material_id
      JOIN recipes  cr ON cr.product_id = w.material_id
                       AND cr.is_active = TRUE
                       AND cr.deleted_at IS NULL
     WHERE wp.track_inventory = FALSE          -- descendre uniquement sous les non-suivis
       AND w.depth < p_max_depth
       AND NOT (cr.material_id = ANY(w.path))   -- garde-cycle
  )
  SELECT w.material_id,
         public._try_convert_quantity(SUM(w.qty), MIN(w.line_unit), p.unit) AS qty_base,
         p.unit
    FROM walk w
    JOIN products p ON p.id = w.material_id
   WHERE p.track_inventory = TRUE               -- émettre uniquement les nœuds suivis
   GROUP BY w.material_id, p.unit
  HAVING public._try_convert_quantity(SUM(w.qty), MIN(w.line_unit), p.unit) > 0;
END $$;

REVOKE ALL ON FUNCTION public._resolve_recipe_consumption_v1(UUID, NUMERIC, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._resolve_recipe_consumption_v1(UUID, NUMERIC, INT) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public._resolve_recipe_consumption_v1(UUID, NUMERIC, INT) IS
  'INTERNAL. Cascade de consommation à la vente d''un produit fait-à-la-commande. '
  'Descend à travers les composants non suivis, s''arrête et émet les nœuds suivis '
  '(track_inventory=true). Quantités converties dans l''unité stock du nœud. '
  'Appelé par complete_order_with_payment_v14 (SECURITY DEFINER).';
```

- [ ] **Step 4 : Appliquer la migration** (MCP `apply_migration`, name `create_resolve_recipe_consumption_v1`).

- [ ] **Step 5 : Relancer le test pgTAP, vérifier le succès** (MCP `execute_sql`). Expected: 3/3 PASS.

- [ ] **Step 6 : Commit**

```bash
git add supabase/migrations/20260710000022_create_resolve_recipe_consumption_v1.sql \
  supabase/tests/recipe_consumption_cascade.test.sql
git commit -m "feat(inventory): _resolve_recipe_consumption_v1 stop-at-tracked cascade"
```

---

## Task 4 : Vente — `complete_order_with_payment_v14` (déduction flag-aware, en place)

**Files:**
- Create: `supabase/migrations/20260710000023_complete_order_v14_flag_aware_deduction.sql`
- Test: `supabase/tests/functions/checkout-flag-aware-deduction.test.ts` (Vitest live-RPC)

**Interfaces:**
- Consumes : `_resolve_recipe_consumption_v1(UUID, NUMERIC, INT)` (Task 3) ; `business_config.allow_negative_stock` (Task 1).
- Produces : aucun changement de signature de `complete_order_with_payment_v14(...)` — `CREATE OR REPLACE` en place.

- [ ] **Step 1 : Écrire le test live-RPC qui échoue**

Créer `supabase/tests/functions/checkout-flag-aware-deduction.test.ts` (réutiliser le harness checkout existant : `supabase/tests/functions/` contient déjà des tests `complete_order`/`process-payment` — calquer le setup auth/session/produits) :

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { posSale, readStock, makeProduct, makeRecipe } from './_checkout_harness';
// _checkout_harness : à mapper sur l'utilitaire de checkout déjà présent dans ce dossier.

describe('complete_order — flag-aware deduction', () => {
  it('made-to-order (track=false, deduct=true) deducts recipe leaves, not the finished good', async () => {
    const beans = await makeProduct({ track_inventory: true,  deduct_stock: false, current_stock: 1000, unit: 'g' });
    const coffee = await makeProduct({ track_inventory: false, deduct_stock: true,  current_stock: 0 });
    await makeRecipe(coffee, [{ material: beans, quantity: 18, unit: 'g' }]);

    const before = await readStock(beans);
    await posSale([{ product_id: coffee, quantity: 2 }]);
    const after = await readStock(beans);

    expect(after).toBe(before - 36);            // 2 × 18 g
    expect(await readStock(coffee)).toBe(0);    // fini non suivi → inchangé
  });

  it('pre-made (track=true, deduct=true) deducts only the finished good', async () => {
    const flour = await makeProduct({ track_inventory: true, deduct_stock: false, current_stock: 1000, unit: 'g' });
    const croissant = await makeProduct({ track_inventory: true, deduct_stock: true, current_stock: 10 });
    await makeRecipe(croissant, [{ material: flour, quantity: 50, unit: 'g' }]);

    const flourBefore = await readStock(flour);
    await posSale([{ product_id: croissant, quantity: 3 }]);

    expect(await readStock(croissant)).toBe(7);   // 10 - 3
    expect(await readStock(flour)).toBe(flourBefore); // matières NON retouchées à la vente
  });

  it('service item (track=false, deduct=false) deducts nothing', async () => {
    const svc = await makeProduct({ track_inventory: false, deduct_stock: false, current_stock: 0 });
    await posSale([{ product_id: svc, quantity: 5 }]);
    expect(await readStock(svc)).toBe(0);
  });

  it('respects allow_negative_stock = false (blocks) then true (allows)', async () => {
    const milk = await makeProduct({ track_inventory: true, deduct_stock: false, current_stock: 1, unit: 'ml' });
    const latte = await makeProduct({ track_inventory: false, deduct_stock: true, current_stock: 0 });
    await makeRecipe(latte, [{ material: milk, quantity: 150, unit: 'ml' }]);

    await setSetting('allow_negative_stock', false, 'inventory');
    await expect(posSale([{ product_id: latte, quantity: 1 }])).rejects.toThrow(/insufficient/i);

    await setSetting('allow_negative_stock', true, 'inventory');
    await posSale([{ product_id: latte, quantity: 1 }]);
    expect(await readStock(milk)).toBe(1 - 150);  // négatif autorisé
  });
});
```

> `_checkout_harness`, `setSetting` : mapper sur les utilitaires déjà présents dans `supabase/tests/functions/`. Ne pas créer de nouvelle couche d'auth.

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `pnpm --filter @breakery/supabase test checkout-flag-aware-deduction`
Expected: FAIL — aujourd'hui le fini est décrémenté inconditionnellement et la cascade n'existe pas.

- [ ] **Step 3 : Écrire la migration (remplacement en place)**

Récupérer le corps live : `SELECT pg_get_functiondef('public.complete_order_with_payment_v14'::regprocedure);`. Créer `supabase/migrations/20260710000023_complete_order_v14_flag_aware_deduction.sql` qui fait `CREATE OR REPLACE FUNCTION public.complete_order_with_payment_v14(... signature identique ...)` avec le corps live **modifié** comme suit (5 changements). Réaffirmer la REVOKE pair en fin de fichier.

**Changement A — DECLARE : ajouter les variables** (après `v_mod_ingredients JSONB;`) :

```sql
  v_allow_negative       BOOLEAN;
  v_line_track           BOOLEAN;
  v_line_deduct          BOOLEAN;
  v_cons                 RECORD;
  v_cons_is_display      BOOLEAN;
```

**Changement B — après `SELECT tax_rate INTO v_tax_rate FROM business_config WHERE id = 1;`** ajouter :

```sql
  SELECT allow_negative_stock INTO v_allow_negative FROM business_config WHERE id = 1;
  v_allow_negative := COALESCE(v_allow_negative, true);
```

**Changement C — bloc de VALIDATION non-combo** (remplacer le `IF v_product.is_display_item … ELSE IF v_product.current_stock < v_quantity … END IF;` situé juste avant le check des modificateurs) par :

```sql
      IF v_product.is_display_item THEN
        IF NOT v_allow_negative
           AND COALESCE((SELECT quantity FROM display_stock WHERE product_id = v_product.id), 0) < v_quantity THEN
          RAISE EXCEPTION 'Insufficient display stock for product % (need %)',
            v_product.name, v_quantity USING ERRCODE = 'P0002';
        END IF;
      ELSIF v_product.track_inventory THEN
        IF NOT v_allow_negative AND v_product.current_stock < v_quantity THEN
          RAISE EXCEPTION 'Insufficient stock for product % (have %, need %)',
            v_product.name, v_product.current_stock, v_quantity USING ERRCODE = 'P0002';
        END IF;
      ELSIF v_product.deduct_stock THEN
        -- fait-à-la-commande : valider les nœuds suivis de la cascade
        IF NOT v_allow_negative THEN
          FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v1(v_product.id, v_quantity) LOOP
            SELECT current_stock INTO v_ing_stock FROM products WHERE id = v_cons.product_id FOR UPDATE;
            IF COALESCE(v_ing_stock, 0) < v_cons.qty_base THEN
              RAISE EXCEPTION 'Insufficient stock for recipe component % (need %, have %)',
                v_cons.product_id, v_cons.qty_base, COALESCE(v_ing_stock, 0) USING ERRCODE = 'P0002';
            END IF;
          END LOOP;
        END IF;
      END IF;
```

**Changement D — check des combos** : dans la boucle combo (`ELSIF v_comp_product.track_inventory AND v_comp_product.current_stock < v_comp_qty THEN …`), préfixer la condition par `NOT v_allow_negative AND`, et de même pour le check display combo (`IF NOT v_allow_negative AND COALESCE((SELECT quantity FROM display_stock …),0) < v_comp_qty THEN`). Le check des **modificateurs** (`IF v_ing_track AND COALESCE(v_ing_stock,0) < v_ing.qty_base THEN`) devient `IF NOT v_allow_negative AND v_ing_track AND COALESCE(v_ing_stock, 0) < v_ing.qty_base THEN`.

**Changement E — bloc de DÉDUCTION non-combo** (le `ELSE` qui aujourd'hui fait l'INSERT `'sale'` + `UPDATE products … - v_quantity` + display) à remplacer par :

```sql
    ELSE
      SELECT track_inventory, deduct_stock INTO v_line_track, v_line_deduct
        FROM products WHERE id = v_product_id;

      IF v_line_track THEN
        INSERT INTO stock_movements (
          product_id, movement_type, quantity, unit, reference_type, reference_id, created_by)
        SELECT v_product_id, 'sale', -v_quantity, COALESCE(p.unit, 'pcs'),
               'orders', v_order_id, v_profile_id
        FROM products p WHERE p.id = v_product_id;

        UPDATE products
          SET current_stock = current_stock - v_quantity, updated_at = now()
          WHERE id = v_product_id;

        IF (SELECT is_display_item FROM products WHERE id = v_product_id) THEN
          INSERT INTO display_movements (
            product_id, movement_type, quantity, reason, reference_type, reference_id, created_by)
          VALUES (v_product_id, 'sale', -v_quantity, 'POS sale', 'order', v_order_id, v_profile_id);
          UPDATE display_stock
            SET quantity = quantity - v_quantity, updated_at = now()
            WHERE product_id = v_product_id;
        END IF;

      ELSIF v_line_deduct THEN
        -- fait-à-la-commande : cascade recette, arrêt aux nœuds suivis
        FOR v_cons IN SELECT * FROM _resolve_recipe_consumption_v1(v_product_id, v_quantity) LOOP
          INSERT INTO stock_movements (
            product_id, movement_type, quantity, unit, reference_type, reference_id, created_by)
          VALUES (v_cons.product_id, 'sale', -v_cons.qty_base, COALESCE(v_cons.unit, 'pcs'),
                  'orders', v_order_id, v_profile_id);
          UPDATE products
            SET current_stock = current_stock - v_cons.qty_base, updated_at = now()
            WHERE id = v_cons.product_id;

          SELECT is_display_item INTO v_cons_is_display FROM products WHERE id = v_cons.product_id;
          IF v_cons_is_display THEN
            INSERT INTO display_movements (
              product_id, movement_type, quantity, reason, reference_type, reference_id, created_by)
            VALUES (v_cons.product_id, 'sale', -v_cons.qty_base, 'POS recipe consumption',
                    'order', v_order_id, v_profile_id);
            UPDATE display_stock
              SET quantity = quantity - v_cons.qty_base, updated_at = now()
              WHERE product_id = v_cons.product_id;
          END IF;
        END LOOP;
      END IF;
      -- (track=false AND deduct=false) → aucune déduction
    END IF;
```

Fin de fichier (réaffirmer la REVOKE pair sur la signature exacte ; reprendre la liste d'arguments de `pg_get_functiondef`) :

```sql
REVOKE ALL ON FUNCTION public.complete_order_with_payment_v14(
  uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_order_with_payment_v14(
  uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, text
) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

> Le combo (`product_type='combo'`) garde sa boucle de déduction existante par composant ; ne pas y toucher hormis les checks d'insuffisance du Changement D. La signature ne change pas → l'EF `process-payment` et `useCheckout` n'ont rien à modifier.

- [ ] **Step 4 : Appliquer la migration** (MCP `apply_migration`, name `complete_order_v14_flag_aware_deduction`).

- [ ] **Step 5 : Relancer le test live-RPC, vérifier le succès**

Run: `pnpm --filter @breakery/supabase test checkout-flag-aware-deduction`
Expected: PASS (4 tests).

- [ ] **Step 6 : Non-régression checkout**

Run: `pnpm --filter @breakery/supabase test checkout` puis `… test process-payment`
Expected: PASS. Si un test attend un blocage sur stock insuffisant, fixer `allow_negative_stock=false` dans son setup (cf. Risque #1).

- [ ] **Step 7 : Commit**

```bash
git add supabase/migrations/20260710000023_complete_order_v14_flag_aware_deduction.sql \
  supabase/tests/functions/checkout-flag-aware-deduction.test.ts
git commit -m "feat(pos): flag-aware sale deduction (track_inventory/deduct_stock) + negative-stock setting"
```

---

## Task 5 : Production — `record_production_v1` (gate négatif + deduct_stock, en place)

**Files:**
- Create: `supabase/migrations/20260710000024_record_production_v1_flag_and_negative_aware.sql`
- Test: `supabase/tests/functions/production-flag-aware.test.ts` (Vitest live-RPC)

**Interfaces:**
- Consumes : `record_stock_movement_v1(..., p_allow_negative)` (Task 2) ; `business_config.allow_negative_stock` (Task 1).
- Produces : aucun changement de signature de `record_production_v1(...)` — `CREATE OR REPLACE` en place.

- [ ] **Step 1 : Écrire le test live-RPC qui échoue**

Créer `supabase/tests/functions/production-flag-aware.test.ts` :

```ts
import { describe, it, expect } from 'vitest';
import { recordProduction, makeProduct, makeRecipe, readStock, setSetting } from './_production_harness';

describe('record_production — negative gate + deduct_stock', () => {
  it('blocks when allow_negative_stock=false and material short', async () => {
    const flour = await makeProduct({ track_inventory: true, deduct_stock: false, current_stock: 10, unit: 'g' });
    const bread = await makeProduct({ track_inventory: true, deduct_stock: true, current_stock: 0 });
    await makeRecipe(bread, [{ material: flour, quantity: 100, unit: 'g' }]);
    await setSetting('allow_negative_stock', false, 'inventory');
    await expect(recordProduction({ product: bread, quantity: 1 })).rejects.toThrow(/insufficient/i);
  });

  it('allows negative when allow_negative_stock=true', async () => {
    const flour = await makeProduct({ track_inventory: true, deduct_stock: false, current_stock: 10, unit: 'g' });
    const bread = await makeProduct({ track_inventory: true, deduct_stock: true, current_stock: 0 });
    await makeRecipe(bread, [{ material: flour, quantity: 100, unit: 'g' }]);
    await setSetting('allow_negative_stock', true, 'inventory');
    await recordProduction({ product: bread, quantity: 1 });
    expect(await readStock(flour)).toBe(10 - 100);  // négatif
    expect(await readStock(bread)).toBe(1);
  });

  it('skips material consumption when produced product has deduct_stock=false', async () => {
    const flour = await makeProduct({ track_inventory: true, deduct_stock: false, current_stock: 500, unit: 'g' });
    const widget = await makeProduct({ track_inventory: true, deduct_stock: false, current_stock: 0 });
    await makeRecipe(widget, [{ material: flour, quantity: 100, unit: 'g' }]);
    await recordProduction({ product: widget, quantity: 1 });
    expect(await readStock(flour)).toBe(500);   // matières NON consommées
    expect(await readStock(widget)).toBe(1);    // fini monté
  });
});
```

> `_production_harness` : mapper sur les tests production existants de `supabase/tests/functions/`.

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `pnpm --filter @breakery/supabase test production-flag-aware`
Expected: FAIL (gate non configurable + deduct_stock ignoré).

- [ ] **Step 3 : Écrire la migration (remplacement en place)**

Récupérer le corps live : `SELECT pg_get_functiondef('public.record_production_v1'::regprocedure);`. Créer `supabase/migrations/20260710000024_record_production_v1_flag_and_negative_aware.sql` = `CREATE OR REPLACE` du corps live avec ces changements :

**C1 — DECLARE** : ajouter `v_allow_negative BOOLEAN; v_deduct_stock BOOLEAN;`.

**C2 — après la résolution du produit fini** (là où `v_product_unit`/`v_product_shelf` sont chargés depuis `products`), ajouter :

```sql
  SELECT allow_negative_stock INTO v_allow_negative FROM business_config WHERE id = 1;
  v_allow_negative := COALESCE(v_allow_negative, true);
  SELECT COALESCE(deduct_stock, true) INTO v_deduct_stock FROM products WHERE id = p_product_id;
```

**C3 — gate d'insuffisance** : envelopper le bloc `IF jsonb_array_length(v_missing) > 0 THEN RAISE EXCEPTION 'insufficient_stock' …` par `IF NOT v_allow_negative AND jsonb_array_length(v_missing) > 0 THEN … END IF;` (laisser le calcul de `v_missing` tel quel).

**C4 — consommation des matières** : envelopper la boucle `FOR v_rec IN SELECT * FROM _leaf_consumption … production_out …` par `IF v_deduct_stock THEN … END IF;`. Et sur l'appel `record_stock_movement_v1(... p_movement_type := 'production_out' ...)`, ajouter le paramètre nommé `p_allow_negative := v_allow_negative`.

> `production_in` (montée du fini) reste inchangé. Ne pas envelopper la création du `production_records` ni le `production_in` par `v_deduct_stock`.

Fin de fichier : réaffirmer la REVOKE pair sur la signature exacte (reprise depuis `pg_get_functiondef`) :

```sql
-- Reprendre EXACTEMENT la signature retournée par pg_get_functiondef.
REVOKE ALL     ON FUNCTION public.record_production_v1(/* args… */) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_production_v1(/* args… */) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 4 : Appliquer la migration** (MCP `apply_migration`, name `record_production_v1_flag_and_negative_aware`).

- [ ] **Step 5 : Relancer le test, vérifier le succès**

Run: `pnpm --filter @breakery/supabase test production-flag-aware`
Expected: PASS (3 tests).

- [ ] **Step 6 : Non-régression production**

Run: `pnpm --filter @breakery/supabase test production`
Expected: PASS. Fixer `allow_negative_stock=false` dans les setups qui attendaient un blocage.

- [ ] **Step 7 : Commit**

```bash
git add supabase/migrations/20260710000024_record_production_v1_flag_and_negative_aware.sql \
  supabase/tests/functions/production-flag-aware.test.ts
git commit -m "feat(production): negative-stock gate via setting + deduct_stock-gated consumption"
```

---

## Task 6 : Production batch — `record_batch_production_v2` (miroir, en place)

**Files:**
- Create: `supabase/migrations/20260710000025_record_batch_production_v2_flag_and_negative_aware.sql`
- Test: ajout d'un cas dans `supabase/tests/functions/production-flag-aware.test.ts`

**Interfaces:**
- Consumes : idem Task 5.
- Produces : aucun changement de signature de `record_batch_production_v2(...)`.

- [ ] **Step 1 : Ajouter le test batch qui échoue**

Ajouter à `production-flag-aware.test.ts` :

```ts
it('batch production honors allow_negative_stock', async () => {
  const flour = await makeProduct({ track_inventory: true, deduct_stock: false, current_stock: 10, unit: 'g' });
  const bun = await makeProduct({ track_inventory: true, deduct_stock: true, current_stock: 0 });
  await makeRecipe(bun, [{ material: flour, quantity: 100, unit: 'g' }]);
  await setSetting('allow_negative_stock', false, 'inventory');
  await expect(recordBatchProduction({ items: [{ product: bun, quantity: 1 }] })).rejects.toThrow(/insufficient/i);
  await setSetting('allow_negative_stock', true, 'inventory');
  await recordBatchProduction({ items: [{ product: bun, quantity: 1 }] });
  expect(await readStock(flour)).toBe(10 - 100);
});
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `pnpm --filter @breakery/supabase test production-flag-aware`
Expected: FAIL sur le nouveau cas batch.

- [ ] **Step 3 : Écrire la migration**

`SELECT pg_get_functiondef('public.record_batch_production_v2'::regprocedure);` puis `CREATE OR REPLACE` avec les **mêmes** changements qu'en Task 5 (C1-C4) appliqués à la structure batch : lire `v_allow_negative` une fois ; pour chaque produit fabriqué de la boucle batch, lire son `deduct_stock` ; envelopper le gate `insufficient_stock` (P0002 ligne ~272 d'origine) par `IF NOT v_allow_negative AND …` ; envelopper la consommation par `IF v_deduct_stock THEN` ; passer `p_allow_negative := v_allow_negative` aux `production_out`. Réaffirmer la REVOKE pair sur la signature exacte.

> Si la boucle batch fabrique plusieurs produits, lire `deduct_stock` **par item** (pas une seule fois globale).

- [ ] **Step 4 : Appliquer la migration** (MCP `apply_migration`, name `record_batch_production_v2_flag_and_negative_aware`).

- [ ] **Step 5 : Relancer, vérifier le succès**

Run: `pnpm --filter @breakery/supabase test production-flag-aware`
Expected: PASS (4 tests).

- [ ] **Step 6 : Commit**

```bash
git add supabase/migrations/20260710000025_record_batch_production_v2_flag_and_negative_aware.sql \
  supabase/tests/functions/production-flag-aware.test.ts
git commit -m "feat(production): batch production negative gate + deduct_stock gating"
```

---

## Task 7 : BackOffice — page Réglages Inventory (toggle stock négatif)

**Files:**
- Create: `apps/backoffice/src/pages/settings/SettingsInventoryPage.tsx`
- Modify: `apps/backoffice/src/features/settings/hooks/useSettings.ts:10`
- Modify: `apps/backoffice/src/routes/index.tsx` (import + route)
- Modify: `apps/backoffice/src/layouts/Sidebar.tsx` (entrée nav)
- Create: `apps/backoffice/src/features/settings/__tests__/SettingsInventoryPage.smoke.test.tsx`

**Interfaces:**
- Consumes : `useSettings('inventory')`, `useSetSetting()`, RPC `get/set_settings` (Task 1).

- [ ] **Step 1 : Étendre le type de catégorie**

Modifier `apps/backoffice/src/features/settings/hooks/useSettings.ts:10` :

```ts
export type SettingsCategory = 'business' | 'localization' | 'tax' | 'pos' | 'inventory';
```

- [ ] **Step 2 : Écrire le test smoke qui échoue**

Créer `apps/backoffice/src/features/settings/__tests__/SettingsInventoryPage.smoke.test.tsx` (calquer `SettingsGeneralPage.smoke.test.tsx` pour le mock `supabase.rpc` + le wrapper QueryClient) :

```tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsInventoryPage from '@/pages/settings/SettingsInventoryPage.js';

const rpcCalls: { fn: string; args: unknown }[] = [];
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      if (fn === 'get_settings_by_category_v1') {
        return Promise.resolve({ data: { category: 'inventory', settings: { allow_negative_stock: true } }, error: null });
      }
      return Promise.resolve({ data: null, error: null }); // set_setting_v1
    },
  },
}));
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));

function wrap(ui: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
}

describe('SettingsInventoryPage', () => {
  it('renders the allow_negative_stock toggle from the RPC', async () => {
    render(wrap(<SettingsInventoryPage />));
    await waitFor(() => expect(screen.getByLabelText(/stock négatif/i)).toBeInTheDocument());
    expect((screen.getByLabelText(/stock négatif/i) as HTMLInputElement).checked).toBe(true);
  });

  it('calls set_setting_v1 on save', async () => {
    rpcCalls.length = 0;
    render(wrap(<SettingsInventoryPage />));
    await waitFor(() => screen.getByLabelText(/stock négatif/i));
    fireEvent.click(screen.getByLabelText(/stock négatif/i));
    fireEvent.click(screen.getByRole('button', { name: /save|enregistrer/i }));
    await waitFor(() =>
      expect(rpcCalls.some((c) => c.fn === 'set_setting_v1')).toBe(true));
  });
});
```

- [ ] **Step 3 : Lancer le test, vérifier l'échec**

Run: `pnpm --filter @breakery/backoffice test SettingsInventoryPage`
Expected: FAIL — la page n'existe pas.

- [ ] **Step 4 : Créer la page**

Créer `apps/backoffice/src/pages/settings/SettingsInventoryPage.tsx` :

```tsx
// apps/backoffice/src/pages/settings/SettingsInventoryPage.tsx
//
// Réglages Inventory — toggle global "autoriser le stock négatif" (vente +
// production). Écrit business_config.allow_negative_stock via set_setting_v1.

import { useEffect, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';

export default function SettingsInventoryPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('settings.read');
  const canUpdate = hasPermission('settings.update');

  const inventory  = useSettings('inventory');
  const setSetting = useSetSetting();

  const [draft, setDraft]   = useState<boolean | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [savedAt, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!inventory.data) return;
    setDraft(Boolean(inventory.data.settings.allow_negative_stock));
  }, [inventory.data]);

  if (!canRead) {
    return <div className="text-text-secondary">Accès refusé aux réglages.</div>;
  }

  const original = inventory.data ? Boolean(inventory.data.settings.allow_negative_stock) : null;
  const dirty = draft !== null && draft !== original;

  async function handleSave() {
    if (draft === null) return;
    setError(null);
    try {
      await setSetting.mutateAsync({ key: 'allow_negative_stock', value: draft, category: 'inventory' });
      setSaved(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Échec de l’enregistrement');
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-serif text-3xl">Réglages Inventaire</h1>
        <p className="text-text-secondary text-sm mt-1">
          Contrôles globaux du stock. Chaque changement écrit une entrée d’audit.
        </p>
      </div>

      {inventory.isLoading && <div className="text-text-secondary">Chargement…</div>}
      {inventory.error && <div className="text-red">Échec du chargement : {inventory.error.message}</div>}

      {!inventory.isLoading && !inventory.error && draft !== null && (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
            <label htmlFor="allow_negative_stock" className="text-sm font-medium pt-2">
              Autoriser le stock négatif
            </label>
            <div className="md:col-span-2 space-y-1">
              <label className="inline-flex items-center gap-2 text-sm pt-2">
                <input id="allow_negative_stock" type="checkbox" checked={draft} disabled={!canUpdate}
                  onChange={(e) => setDraft(e.target.checked)} />
                <span>{draft ? 'Oui' : 'Non'}</span>
              </label>
              <p className="text-xs text-text-secondary">
                Quand activé, la vente et la production passent même si les matières
                premières sont insuffisantes (le stock devient négatif).
              </p>
            </div>
          </div>

          {error && <p className="text-red text-sm" role="alert">{error}</p>}
          {savedAt && !dirty && <p className="text-emerald-700 text-xs" role="status">Enregistré à {savedAt}</p>}

          {canUpdate && (
            <Button type="submit" variant="primary" disabled={!dirty || setSetting.isPending}>
              {setSetting.isPending ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Aucun changement'}
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 5 : Brancher la route**

Dans `apps/backoffice/src/routes/index.tsx` : ajouter l'import près de `SettingsGeneralPage` (ligne ~76) :

```tsx
import SettingsInventoryPage from '@/pages/settings/SettingsInventoryPage.js';
```

et, à côté de la route `settings/general` (ligne ~851), une route jumelle :

```tsx
<Route
  path="settings/inventory"
  element={
    <RequirePermission permission="settings.read">
      <SettingsInventoryPage />
    </RequirePermission>
  }
/>
```

> Reproduire **exactement** le wrapper de garde utilisé par la route `settings/general` voisine (même composant `RequirePermission`/`PermissionGate` que dans le fichier).

- [ ] **Step 6 : Ajouter l'entrée de navigation**

Dans `apps/backoffice/src/layouts/Sidebar.tsx`, juste après l'entrée `General settings` (ligne ~207) :

```tsx
{ to: '/backoffice/settings/inventory', label: 'Inventory settings', icon: Settings, permission: 'settings.read' },
```

- [ ] **Step 7 : Lancer le test, vérifier le succès**

Run: `pnpm --filter @breakery/backoffice test SettingsInventoryPage`
Expected: PASS (2 tests).

- [ ] **Step 8 : Commit**

```bash
git add apps/backoffice/src/pages/settings/SettingsInventoryPage.tsx \
  apps/backoffice/src/features/settings/hooks/useSettings.ts \
  apps/backoffice/src/routes/index.tsx apps/backoffice/src/layouts/Sidebar.tsx \
  apps/backoffice/src/features/settings/__tests__/SettingsInventoryPage.smoke.test.tsx
git commit -m "feat(backoffice): Inventory settings page — allow negative stock toggle"
```

---

## Task 8 : Clarifier les libellés des toggles produit

**Files:**
- Modify: `apps/backoffice/src/features/products/components/GeneralPanel.tsx:189-216`

**Interfaces:** aucune (cosmétique). Aucun changement de comportement ni de schéma.

- [ ] **Step 1 : Mettre à jour les sous-titres**

Dans `apps/backoffice/src/features/products/components/GeneralPanel.tsx`, remplacer le `sub` du toggle `Deduct stock` (ligne 191) et du toggle `Track inventory` (ligne 212) :

```tsx
            <ToggleRow
              label="Deduct stock"
              sub="Déduit les matières premières de la recette (à la production si suivi, à la vente sinon)"
              enabled={draft.deduct_stock}
              disabled={readOnly}
              onChange={(v) => update('deduct_stock', v)}
            />
```

```tsx
            <ToggleRow
              label="Track inventory"
              sub="Suit le stock du produit lui-même (décrémenté à la vente, monté à la production)"
              enabled={draft.track_inventory}
              disabled={readOnly}
              onChange={(v) => update('track_inventory', v)}
            />
```

- [ ] **Step 2 : Vérifier le rendu / la non-régression**

Run: `pnpm --filter @breakery/backoffice test products`
Expected: PASS (aucun test ne dépend du texte exact ; sinon ajuster l'assertion).

- [ ] **Step 3 : Commit**

```bash
git add apps/backoffice/src/features/products/components/GeneralPanel.tsx
git commit -m "docs(products): clarify track_inventory/deduct_stock toggle subtitles"
```

---

## Task 9 : Vérification globale + clôture

- [ ] **Step 1 : Typecheck complet**

Run: `pnpm typecheck`
Expected: CLEAN (regen des types appliqué).

- [ ] **Step 2 : Build complet**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3 : Suites ciblées**

Run: `pnpm --filter @breakery/supabase test inventory && pnpm --filter @breakery/supabase test checkout && pnpm --filter @breakery/supabase test production && pnpm --filter @breakery/backoffice test settings`
Expected: PASS.

- [ ] **Step 4 : Advisors sécurité**

MCP `mcp__plugin_supabase_supabase__get_advisors` (`type='security'`) → aucun nouvel avertissement sur les fonctions modifiées (REVOKE/anon).

- [ ] **Step 5 : Bump du CLAUDE.md « Active Workplan »**

Ajouter une ligne « In flight / shipped » pointant ce plan + la spec, avec les migrations `20260710000020..025`.

- [ ] **Step 6 : Commit de clôture**

```bash
git add CLAUDE.md
git commit -m "docs: workplan bump — track/deduct flags + negative-stock setting"
```

---

## Déviations vs spec (assumées)

1. **Pas de bump v15/v2** : la spec proposait `complete_order…v15` et `record_production…v2`. Comme **aucune signature ne change**, on remplace **en place** (`CREATE OR REPLACE`), précédent projet `20260622000015` sur `v11`. Conséquence : **l'EF `process-payment` et les call-sites front ne bougent pas** → risque réduit. Seul le primitive `record_stock_movement_v1` change de signature (param optionnel) → DROP+CREATE, sans impact sur les wrappers (appels par paramètres nommés).
2. **Permission** : la spec citait `settings.manage` ; le code réel utilise `settings.read`/`settings.update` — on s'aligne sur l'existant.
3. **Page BO dédiée** (`SettingsInventoryPage`) plutôt qu'un champ ajouté à la page General — isolation/testabilité, conforme à l'esprit de la spec.

## Risques (rappel)

1. **Défaut permissif** (`allow_negative_stock=true`) : la production qui bloquait passe désormais. Fixer `allow_negative_stock=false` dans les setups de tests qui attendaient un blocage.
2. **Money-path** : `complete_order_with_payment_v14` remplacé en place → exécuter `checkout` + `process-payment` complets avant merge.
3. **Double-déduction** : invariant protégé par le test « pre-made deducts only the finished good » (Task 4, Step 1).
4. **Hors scope** (inchangé) : COGS JE du fait-à-la-commande, FIFO/`lot_id` (mouvements `sale` d'ingrédients en `lot_id NULL`).
