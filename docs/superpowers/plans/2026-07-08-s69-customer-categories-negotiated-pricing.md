# S69 — CRUD Customer Categories + Prix négocié par client (B2B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exposer le CRUD des catégories client + l'édition des overrides prix catégorie, et ajouter une couche de prix négocié **par client** appliquée automatiquement aux commandes B2B (serveur autoritaire).

**Architecture:** Deux volets. **A** (hors money-path) : RPCs SECURITY DEFINER pour `customer_categories` + `product_category_prices`, et activation de l'UI BO read-only. **B** (sous garde money-path) : nouvelle table `customer_product_prices` + perm `customer_prices.manage`, résolution serveur du prix ligne dans un `create_b2b_order_v5` (bump additif de v4), UI d'édition sur la fiche client. La money-path POS (`complete_order_with_payment_v17`, `_resolve_line_price_v1`, `get_customer_product_price`) est **inchangée**.

**Tech Stack:** Supabase cloud V3 dev (`ikcyvlovptebroadgtvd`, MCP `apply_migration`/`execute_sql`/`generate_typescript_types`), PostgreSQL/plpgsql, pgTAP, React + TypeScript + Tailwind + `@breakery/ui`, TanStack Query, pnpm/turbo.

## Global Constraints

- **DB cloud only** — appliquer via MCP `mcp__claude_ai_Supabase__apply_migration` (project `ikcyvlovptebroadgtvd`), jamais Docker. pgTAP via `execute_sql` en enveloppe `BEGIN … ROLLBACK`.
- **Numérotation migrations monotone** — max local actuel `20260710000134`. Confirmer le max **live** via `list_migrations` avant le 1er apply ; démarrer au suivant (`20260710000135` sauf drift).
- **Jamais de `BEGIN;`/`COMMIT;`** dans le corps d'une migration (le MCP wrappe déjà).
- **Trio REVOKE anon** sur toute fonction/table admin : `REVOKE ALL … FROM PUBLIC` + `REVOKE ALL … FROM anon` + `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`. `REVOKE FROM anon` seul est insuffisant (anon hérite via PUBLIC).
- **RPC versioning monotone** — `create_b2b_order_v5` = nouvelle fonction + `DROP FUNCTION create_b2b_order_v4(<args>)` dans la même migration. `GRANT EXECUTE TO authenticated` obligatoire (l'EF/BO appelle via JWT utilisateur).
- **Corps d'un bump = LIVE** (DEV-S57-02) : le corps de `create_b2b_order_v5` part de `pg_get_functiondef('create_b2b_order_v4')` récupéré via MCP, **jamais** du fichier de migration `_130`.
- **Types regen obligatoire** après tout changement de schéma → `packages/supabase/src/types.generated.ts`, committé. Cause n°1 de CI cassée.
- **Audit** = table `audit_logs` (`actor_id`/`action`/`entity_type`/`entity_id`/`metadata`), jamais d'INSERT direct depuis l'app.
- **UI** : primitifs `@breakery/ui` uniquement, **pas de `Select`/`RadioGroup` exportés** → select natif ; tokens sémantiques, **zéro hex codé en dur**.
- **Après chaque migration** : `pnpm typecheck` + suite ciblée doivent rester verts avant de committer.

---

# VAGUE 1 — Volet A : CRUD Customer Categories (hors money-path)

### Task 1: RPCs CRUD `customer_categories`

**Files:**
- Create: `supabase/migrations/20260710000135_create_customer_category_crud_rpcs.sql`
- Test: `supabase/tests/customer_category_crud.test.sql`

**Interfaces:**
- Produces:
  - `create_customer_category_v1(p_name text, p_slug text, p_price_modifier_type price_modifier_type, p_discount_percentage numeric, p_points_multiplier numeric, p_loyalty_enabled boolean, p_color text, p_icon text, p_is_default boolean) RETURNS customer_categories`
  - `update_customer_category_v1(p_id uuid, p_name text, p_slug text, p_price_modifier_type price_modifier_type, p_discount_percentage numeric, p_points_multiplier numeric, p_loyalty_enabled boolean, p_color text, p_icon text, p_is_default boolean) RETURNS customer_categories`
  - `delete_customer_category_v1(p_id uuid) RETURNS void`
- Error codes (typed): `slug_taken` (P0001), `invalid_discount` (P0001), `category_not_found` (P0002), `cannot_delete_default` (P0001), `default_required` (P0001), `category_in_use` (P0001), `permission_denied: …` (P0003).

- [ ] **Step 1: Confirm live migration max**

Run (MCP): `mcp__claude_ai_Supabase__list_migrations` on `ikcyvlovptebroadgtvd`. Confirm the highest version. If a version ≥ `20260710000135` already exists live, shift all S69 file numbers up by the drift and note it in the session INDEX. Expected: max = `…134`, so `…135` is free.

- [ ] **Step 2: Write the failing pgTAP suite**

Create `supabase/tests/customer_category_crud.test.sql`:

```sql
BEGIN;
SELECT plan(14);

-- Seed a manager identity with the required perms (helper pattern from existing suites).
-- (Reuse the project's test auth helper; here we assume set_auth_as_role('ADMIN') exists;
--  if not, mirror the JWT/claims setup used by customer_* suites.)

-- create: happy path
SELECT lives_ok($$SELECT create_customer_category_v1('Hotels','hotels','custom',0,1.0,true,'#fff','crown',false)$$, 'create custom category');
SELECT is((SELECT price_modifier_type::text FROM customer_categories WHERE slug='hotels'), 'custom', 'modifier persisted');

-- create: duplicate slug
SELECT throws_ok($$SELECT create_customer_category_v1('Dup','hotels','retail',0,1.0,true,null,null,false)$$, 'P0001', NULL, 'duplicate slug rejected');

-- create: discount out of bounds
SELECT throws_ok($$SELECT create_customer_category_v1('BadPct','badpct','discount_percentage',150,1.0,true,null,null,false)$$, 'P0001', NULL, 'discount > 100 rejected');

-- create with is_default=true unsets previous default
SELECT create_customer_category_v1('NewDefault','newdef','retail',0,1.0,true,null,null,true);
SELECT is((SELECT count(*)::int FROM customer_categories WHERE is_default AND deleted_at IS NULL), 1, 'exactly one default after switch');

-- update: rename
SELECT lives_ok($$SELECT update_customer_category_v1((SELECT id FROM customer_categories WHERE slug='hotels'),'Hotels Group','hotels','custom',0,1.0,true,null,null,false)$$, 'update name');
SELECT is((SELECT name FROM customer_categories WHERE slug='hotels'), 'Hotels Group', 'name updated');

-- update: unknown id
SELECT throws_ok($$SELECT update_customer_category_v1(gen_random_uuid(),'X','x','retail',0,1.0,true,null,null,false)$$, 'P0002', NULL, 'update unknown → category_not_found');

-- delete: default protected
SELECT throws_ok($$SELECT delete_customer_category_v1((SELECT id FROM customer_categories WHERE is_default AND deleted_at IS NULL))$$, 'P0001', NULL, 'cannot delete default');

-- delete: in use
UPDATE customers SET category_id = (SELECT id FROM customer_categories WHERE slug='hotels') WHERE id = (SELECT id FROM customers WHERE deleted_at IS NULL LIMIT 1);
SELECT throws_ok($$SELECT delete_customer_category_v1((SELECT id FROM customer_categories WHERE slug='hotels'))$$, 'P0001', NULL, 'category_in_use blocks delete');

-- delete: free category soft-deletes
UPDATE customers SET category_id = NULL WHERE category_id = (SELECT id FROM customer_categories WHERE slug='hotels');
SELECT lives_ok($$SELECT delete_customer_category_v1((SELECT id FROM customer_categories WHERE slug='hotels'))$$, 'delete unused category');
SELECT isnt((SELECT deleted_at FROM customer_categories WHERE slug='hotels'), NULL, 'soft-deleted');

-- delete: idempotent
SELECT lives_ok($$SELECT delete_customer_category_v1((SELECT id FROM customer_categories WHERE slug='hotels'))$$, 're-delete is no-op');

-- ACL: anon cannot execute (mirror project pattern) — assert via has_function_privilege
SELECT is(has_function_privilege('anon','create_customer_category_v1(text,text,price_modifier_type,numeric,numeric,boolean,text,text,boolean)','EXECUTE'), false, 'anon cannot create');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3: Run the suite to verify it fails**

Run (MCP `execute_sql`): paste the suite. Expected: FAIL — functions do not exist yet (`function … does not exist`).

- [ ] **Step 4: Write the migration**

Create `supabase/migrations/20260710000135_create_customer_category_crud_rpcs.sql`:

```sql
-- 20260710000135_create_customer_category_crud_rpcs.sql
-- S69 Volet A — CRUD RPCs for customer_categories (perms seeded S13, RLS already gated).
-- Closes deviation D-W6-CUSTCAT-01 (page was read-only for lack of write RPCs).

-- CREATE ------------------------------------------------------------------
CREATE FUNCTION create_customer_category_v1(
  p_name text, p_slug text, p_price_modifier_type price_modifier_type,
  p_discount_percentage numeric, p_points_multiplier numeric,
  p_loyalty_enabled boolean, p_color text, p_icon text, p_is_default boolean
) RETURNS customer_categories
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_actor UUID;
  v_row customer_categories;
BEGIN
  IF NOT has_permission(v_uid, 'customer_categories.create') THEN
    RAISE EXCEPTION 'permission_denied: customer_categories.create' USING ERRCODE = 'P0003';
  END IF;
  IF p_slug IS NULL OR btrim(p_slug) = '' THEN
    RAISE EXCEPTION 'slug_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_discount_percentage < 0 OR p_discount_percentage > 100 THEN
    RAISE EXCEPTION 'invalid_discount' USING ERRCODE = 'P0001';
  END IF;
  IF p_points_multiplier < 0 THEN
    RAISE EXCEPTION 'invalid_multiplier' USING ERRCODE = 'P0001';
  END IF;
  IF p_is_default THEN
    UPDATE customer_categories SET is_default = false WHERE is_default AND deleted_at IS NULL;
  END IF;
  BEGIN
    INSERT INTO customer_categories(
      name, slug, price_modifier_type, discount_percentage, points_multiplier,
      loyalty_enabled, color, icon, is_default, is_active
    ) VALUES (
      p_name, p_slug, p_price_modifier_type, p_discount_percentage, p_points_multiplier,
      COALESCE(p_loyalty_enabled, true), p_color, p_icon, COALESCE(p_is_default, false), true
    ) RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'slug_taken' USING ERRCODE = 'P0001';
  END;

  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'customer_category.created', 'customer_categories', v_row.id,
          jsonb_build_object('slug', v_row.slug, 'modifier', v_row.price_modifier_type));
  RETURN v_row;
END $$;

-- UPDATE ------------------------------------------------------------------
CREATE FUNCTION update_customer_category_v1(
  p_id uuid, p_name text, p_slug text, p_price_modifier_type price_modifier_type,
  p_discount_percentage numeric, p_points_multiplier numeric,
  p_loyalty_enabled boolean, p_color text, p_icon text, p_is_default boolean
) RETURNS customer_categories
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_actor UUID;
  v_was_default boolean;
  v_row customer_categories;
BEGIN
  IF NOT has_permission(v_uid, 'customer_categories.update') THEN
    RAISE EXCEPTION 'permission_denied: customer_categories.update' USING ERRCODE = 'P0003';
  END IF;
  SELECT is_default INTO v_was_default FROM customer_categories WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'category_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_discount_percentage < 0 OR p_discount_percentage > 100 THEN
    RAISE EXCEPTION 'invalid_discount' USING ERRCODE = 'P0001';
  END IF;
  IF p_points_multiplier < 0 THEN
    RAISE EXCEPTION 'invalid_multiplier' USING ERRCODE = 'P0001';
  END IF;
  IF v_was_default AND NOT p_is_default THEN
    RAISE EXCEPTION 'default_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_is_default AND NOT v_was_default THEN
    UPDATE customer_categories SET is_default = false WHERE is_default AND deleted_at IS NULL;
  END IF;
  BEGIN
    UPDATE customer_categories SET
      name = p_name, slug = p_slug, price_modifier_type = p_price_modifier_type,
      discount_percentage = p_discount_percentage, points_multiplier = p_points_multiplier,
      loyalty_enabled = COALESCE(p_loyalty_enabled, true), color = p_color, icon = p_icon,
      is_default = COALESCE(p_is_default, false)
    WHERE id = p_id RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'slug_taken' USING ERRCODE = 'P0001';
  END;

  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'customer_category.updated', 'customer_categories', v_row.id,
          jsonb_build_object('slug', v_row.slug));
  RETURN v_row;
END $$;

-- DELETE (soft) -----------------------------------------------------------
CREATE FUNCTION delete_customer_category_v1(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_actor UUID;
  v_is_default boolean;
  v_deleted timestamptz;
BEGIN
  IF NOT has_permission(v_uid, 'customer_categories.delete') THEN
    RAISE EXCEPTION 'permission_denied: customer_categories.delete' USING ERRCODE = 'P0003';
  END IF;
  SELECT is_default, deleted_at INTO v_is_default, v_deleted FROM customer_categories WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'category_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_deleted IS NOT NULL THEN
    RETURN; -- idempotent
  END IF;
  IF v_is_default THEN
    RAISE EXCEPTION 'cannot_delete_default' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM customers WHERE category_id = p_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'category_in_use' USING ERRCODE = 'P0001';
  END IF;
  UPDATE customer_categories SET deleted_at = now(), is_active = false WHERE id = p_id;

  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'customer_category.deleted', 'customer_categories', p_id, '{}'::jsonb);
END $$;

-- REVOKE trio (anon inherits EXECUTE via PUBLIC — must revoke PUBLIC too) ---
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'create_customer_category_v1(text,text,price_modifier_type,numeric,numeric,boolean,text,text,boolean)',
    'update_customer_category_v1(uuid,text,text,price_modifier_type,numeric,numeric,boolean,text,text,boolean)',
    'delete_customer_category_v1(uuid)'
  ]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

Apply via MCP `apply_migration` (name `create_customer_category_crud_rpcs`).

- [ ] **Step 5: Run the suite to verify it passes**

Run (MCP `execute_sql`): the suite from Step 2. Expected: `ok 1..14`, all pass. If the test auth helper differs, adapt the identity-seeding preamble to the pattern used in `supabase/tests/customer_*` suites (do **not** weaken assertions).

- [ ] **Step 6: Regen types & commit**

Run (MCP): `generate_typescript_types` → write to `packages/supabase/src/types.generated.ts`.
Run: `pnpm typecheck`. Expected: pass.

```bash
git add supabase/migrations/20260710000135_create_customer_category_crud_rpcs.sql supabase/tests/customer_category_crud.test.sql packages/supabase/src/types.generated.ts
git commit -m "feat(customers): customer_categories CRUD RPCs (S69 Volet A) — closes D-W6-CUSTCAT-01"
```

---

### Task 2: RPCs upsert/delete `product_category_prices`

**Files:**
- Create: `supabase/migrations/20260710000136_create_product_category_price_rpcs.sql`
- Test: extend `supabase/tests/customer_category_crud.test.sql` (add a block) OR new `supabase/tests/product_category_prices.test.sql`.

**Interfaces:**
- Consumes: `customer_categories` rows from Task 1.
- Produces:
  - `upsert_product_category_price_v1(p_category_id uuid, p_product_id uuid, p_price numeric) RETURNS product_category_prices`
  - `delete_product_category_price_v1(p_category_id uuid, p_product_id uuid) RETURNS void`
- Error codes: `invalid_price` (P0001), `category_not_found` (P0002), `product_not_found` (P0002), `permission_denied` (P0003).

- [ ] **Step 1: Write the failing test** (new file `supabase/tests/product_category_prices.test.sql`)

```sql
BEGIN;
SELECT plan(6);
-- seed: a category + a product exist (reuse seed data or insert one)
SELECT create_customer_category_v1('Bulk','bulk','custom',0,1.0,true,null,null,false);
-- upsert
SELECT lives_ok($$SELECT upsert_product_category_price_v1(
  (SELECT id FROM customer_categories WHERE slug='bulk'),
  (SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1), 5000)$$, 'insert override');
SELECT is((SELECT price::int FROM product_category_prices
  WHERE customer_category_id=(SELECT id FROM customer_categories WHERE slug='bulk')), 5000, 'price stored');
-- upsert conflict updates
SELECT upsert_product_category_price_v1(
  (SELECT id FROM customer_categories WHERE slug='bulk'),
  (SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1), 4200);
SELECT is((SELECT price::int FROM product_category_prices
  WHERE customer_category_id=(SELECT id FROM customer_categories WHERE slug='bulk')), 4200, 'conflict updated');
-- negative price rejected
SELECT throws_ok($$SELECT upsert_product_category_price_v1(
  (SELECT id FROM customer_categories WHERE slug='bulk'),
  (SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1), -1)$$, 'P0001', NULL, 'negative price rejected');
-- delete idempotent
SELECT lives_ok($$SELECT delete_product_category_price_v1(
  (SELECT id FROM customer_categories WHERE slug='bulk'),
  (SELECT id FROM products WHERE deleted_at IS NULL LIMIT 1))$$, 'delete override');
SELECT is((SELECT count(*)::int FROM product_category_prices
  WHERE customer_category_id=(SELECT id FROM customer_categories WHERE slug='bulk')), 0, 'override removed');
SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run to verify it fails** (MCP `execute_sql`) — functions missing.

- [ ] **Step 3: Write the migration** `20260710000136_create_product_category_price_rpcs.sql`:

```sql
-- 20260710000136_create_product_category_price_rpcs.sql
-- S69 Volet A — write RPCs for category-level product price overrides.

CREATE FUNCTION upsert_product_category_price_v1(
  p_category_id uuid, p_product_id uuid, p_price numeric
) RETURNS product_category_prices
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID; v_row product_category_prices;
BEGIN
  IF NOT has_permission(v_uid, 'customer_categories.update') THEN
    RAISE EXCEPTION 'permission_denied: customer_categories.update' USING ERRCODE = 'P0003';
  END IF;
  IF p_price IS NULL OR p_price < 0 THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customer_categories WHERE id = p_category_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'category_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO product_category_prices(product_id, customer_category_id, price)
  VALUES (p_product_id, p_category_id, p_price)
  ON CONFLICT (product_id, customer_category_id) DO UPDATE SET price = EXCLUDED.price
  RETURNING * INTO v_row;

  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'product_category_price.upserted', 'customer_categories', p_category_id,
          jsonb_build_object('product_id', p_product_id, 'price', p_price));
  RETURN v_row;
END $$;

CREATE FUNCTION delete_product_category_price_v1(p_category_id uuid, p_product_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID;
BEGIN
  IF NOT has_permission(v_uid, 'customer_categories.update') THEN
    RAISE EXCEPTION 'permission_denied: customer_categories.update' USING ERRCODE = 'P0003';
  END IF;
  DELETE FROM product_category_prices WHERE product_id = p_product_id AND customer_category_id = p_category_id;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'product_category_price.deleted', 'customer_categories', p_category_id,
          jsonb_build_object('product_id', p_product_id));
END $$;

DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'upsert_product_category_price_v1(uuid,uuid,numeric)',
    'delete_product_category_price_v1(uuid,uuid)'
  ]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 4: Run to verify it passes** (MCP `execute_sql`). Expected `ok 1..6`.

- [ ] **Step 5: Regen types & commit**

```bash
git add supabase/migrations/20260710000136_create_product_category_price_rpcs.sql supabase/tests/product_category_prices.test.sql packages/supabase/src/types.generated.ts
git commit -m "feat(customers): product_category_prices upsert/delete RPCs (S69 Volet A)"
```

---

### Task 3: BO — activate CustomerCategoriesPage CRUD + CategoryFormModal

**Files:**
- Create: `apps/backoffice/src/features/customers/hooks/useCustomerCategoryMutations.ts`
- Create: `apps/backoffice/src/features/customers/components/CategoryFormModal.tsx`
- Modify: `apps/backoffice/src/pages/customers/CustomerCategoriesPage.tsx`
- Test: `apps/backoffice/src/features/customers/__tests__/customer-categories-crud.smoke.test.tsx`

**Interfaces:**
- Consumes: RPCs from Task 1. `useCustomerCategories()` (existing) + `CustomerCategoryRow`.
- Produces: `useCreateCustomerCategory`, `useUpdateCustomerCategory`, `useDeleteCustomerCategory` (each returns a TanStack `useMutation`, invalidating `CUSTOMER_CATEGORIES_QUERY_KEY`), `classifyCategoryError(err): string`.

- [ ] **Step 1: Write the mutations hook** (`useCustomerCategoryMutations.ts`)

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { CUSTOMER_CATEGORIES_QUERY_KEY } from './useCustomerCategories.js';

export interface CategoryInput {
  name: string; slug: string;
  price_modifier_type: 'retail' | 'wholesale' | 'discount_percentage' | 'custom';
  discount_percentage: number; points_multiplier: number;
  loyalty_enabled: boolean; color: string | null; icon: string | null; is_default: boolean;
}

export function classifyCategoryError(err: unknown): string {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('slug_taken') || msg.includes('slug_required')) return 'This slug is already in use.';
  if (msg.includes('invalid_discount')) return 'Discount must be between 0 and 100.';
  if (msg.includes('invalid_multiplier')) return 'Points multiplier must be ≥ 0.';
  if (msg.includes('category_in_use')) return 'Cannot delete: customers are still assigned to this category.';
  if (msg.includes('cannot_delete_default')) return 'The default category cannot be deleted.';
  if (msg.includes('default_required')) return 'There must always be one default category.';
  if (msg.includes('category_not_found')) return 'Category not found.';
  if (msg.includes('permission_denied')) return 'You do not have permission for this action.';
  return 'Something went wrong. Please try again.';
}

export function useCreateCustomerCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CategoryInput) => {
      const { data, error } = await supabase.rpc('create_customer_category_v1', {
        p_name: input.name, p_slug: input.slug, p_price_modifier_type: input.price_modifier_type,
        p_discount_percentage: input.discount_percentage, p_points_multiplier: input.points_multiplier,
        p_loyalty_enabled: input.loyalty_enabled, p_color: input.color, p_icon: input.icon,
        p_is_default: input.is_default,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CUSTOMER_CATEGORIES_QUERY_KEY }),
  });
}

export function useUpdateCustomerCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CategoryInput & { id: string }) => {
      const { data, error } = await supabase.rpc('update_customer_category_v1', {
        p_id: input.id, p_name: input.name, p_slug: input.slug,
        p_price_modifier_type: input.price_modifier_type,
        p_discount_percentage: input.discount_percentage, p_points_multiplier: input.points_multiplier,
        p_loyalty_enabled: input.loyalty_enabled, p_color: input.color, p_icon: input.icon,
        p_is_default: input.is_default,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CUSTOMER_CATEGORIES_QUERY_KEY }),
  });
}

export function useDeleteCustomerCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('delete_customer_category_v1', { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CUSTOMER_CATEGORIES_QUERY_KEY }),
  });
}
```

- [ ] **Step 2: Write `CategoryFormModal.tsx`**

Use `@breakery/ui` `Dialog`, `Input`, `Button`. Native `<select>` for `price_modifier_type` (no `Select` primitive — see breakery-ui-kit). Fields: name, slug, price_modifier_type, discount_percentage (shown only when type = `discount_percentage`), points_multiplier, loyalty_enabled (checkbox), is_default (checkbox), color, icon. Props: `{ open, onClose, initial?: CustomerCategoryRow, onSubmit(input: CategoryInput), pending, errorText }`. Tokens only (no hex). Follow an existing modal in `apps/backoffice/src/features` for structure (e.g. a settings or product form modal).

- [ ] **Step 3: Wire `CustomerCategoriesPage.tsx`**

- Remove the SCOPE-CUT header comment (lines 9-13) and the `info`/deviation banner.
- `New Category` button: enabled when `canWrite`, opens `CategoryFormModal` (no `initial`).
- Card `Edit` button: opens modal with `initial=cat`.
- Card `Delete` button: opens a confirm, then `useDeleteCustomerCategory().mutate(cat.id)`, surfacing `classifyCategoryError` on failure (esp. `category_in_use`).
- On submit: `useCreateCustomerCategory` or `useUpdateCustomerCategory`; close on success, show `classifyCategoryError(error)` in the modal on failure.

- [ ] **Step 4: Write the smoke test** (`customer-categories-crud.smoke.test.tsx`)

Render `CustomerCategoriesPage` with a mocked `useCustomerCategories` (one category) and mocked mutation hooks. Assert: (a) `New Category` is enabled with write perm, (b) clicking it opens the modal, (c) Edit opens modal pre-filled, (d) Delete triggers the delete mutation. Mirror the mocking style of an existing BO smoke test.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @breakery/backoffice test customer-categories`. Expected: pass. Run `pnpm --filter @breakery/backoffice typecheck`. Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add apps/backoffice/src/features/customers/hooks/useCustomerCategoryMutations.ts apps/backoffice/src/features/customers/components/CategoryFormModal.tsx apps/backoffice/src/pages/customers/CustomerCategoriesPage.tsx apps/backoffice/src/features/customers/__tests__/customer-categories-crud.smoke.test.tsx
git commit -m "feat(bo): customer categories CRUD UI (S69 Volet A) — CategoryFormModal + activate page"
```

---

### Task 4: BO — make PricingTab overrides editable

**Files:**
- Modify: `apps/backoffice/src/features/customers/hooks/useCustomerCategoryPrices.ts` (add mutations)
- Modify: `apps/backoffice/src/pages/customers/customer-detail/PricingTab.tsx`
- Test: `apps/backoffice/src/features/customers/__tests__/pricing-tab-edit.smoke.test.tsx`

**Interfaces:**
- Consumes: RPCs from Task 2, `useCustomerCategoryPrices(categoryId)` (existing read).
- Produces: `useUpsertCategoryPrice`, `useDeleteCategoryPrice` (mutations invalidating `customerCategoryPricesKey(categoryId)`).

- [ ] **Step 1: Add mutations to `useCustomerCategoryPrices.ts`**

```ts
export function useUpsertCategoryPrice(categoryId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { productId: string; price: number }) => {
      const { error } = await supabase.rpc('upsert_product_category_price_v1', {
        p_category_id: categoryId, p_product_id: v.productId, p_price: v.price,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: customerCategoryPricesKey(categoryId) }),
  });
}

export function useDeleteCategoryPrice(categoryId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (productId: string) => {
      const { error } = await supabase.rpc('delete_product_category_price_v1', {
        p_category_id: categoryId, p_product_id: productId,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: customerCategoryPricesKey(categoryId) }),
  });
}
```

Add the `useMutation`/`useQueryClient` imports.

- [ ] **Step 2: Make the overrides table editable in `PricingTab.tsx`**

When `modifier === 'custom'` and the viewer has `customer_categories.update`: add an "Add override" row (product picker — reuse an existing product-search component or a simple async combobox over `products`; if none exists, a minimal `<select>` populated from a `useQuery` on `products` is acceptable) + a price input, calling `useUpsertCategoryPrice`. Each existing override row gets an inline edit (price input) and a delete button (`useDeleteCategoryPrice`). Add a one-line note: "These prices apply to every customer in this category." Tokens only.

- [ ] **Step 3: Write the smoke test** (`pricing-tab-edit.smoke.test.tsx`)

Render `PricingTab` with a `custom`-category customer + mocked overrides and mutations. Assert add/edit/delete call the right mutations. Mirror an existing smoke test's mocking.

- [ ] **Step 4: Run & commit**

Run: `pnpm --filter @breakery/backoffice test pricing-tab` and `typecheck`. Expected: pass.

```bash
git add apps/backoffice/src/features/customers/hooks/useCustomerCategoryPrices.ts apps/backoffice/src/pages/customers/customer-detail/PricingTab.tsx apps/backoffice/src/features/customers/__tests__/pricing-tab-edit.smoke.test.tsx
git commit -m "feat(bo): editable category price overrides in PricingTab (S69 Volet A)"
```

---

# VAGUE 2 — Volet B : Prix négocié par client (B2B, sous garde money-path)

### Task 5: Table `customer_product_prices` + permission `customer_prices.manage`

**Files:**
- Create: `supabase/migrations/20260710000137_init_customer_product_prices.sql`
- Test: `supabase/tests/customer_product_prices_rls.test.sql`

**Interfaces:**
- Produces: table `customer_product_prices(customer_id uuid, product_id uuid, price numeric, created_at, updated_at, PK(customer_id, product_id))`; permission `customer_prices.manage` seeded to MANAGER/ADMIN/SUPER_ADMIN.

- [ ] **Step 1: Write the failing RLS test** (`customer_product_prices_rls.test.sql`)

```sql
BEGIN;
SELECT plan(4);
-- table exists with expected PK
SELECT has_table('customer_product_prices');
SELECT col_is_pk('customer_product_prices', ARRAY['customer_id','product_id'], 'composite PK');
-- authenticated has no direct INSERT (writes go through SECURITY DEFINER RPCs)
SELECT is(has_table_privilege('authenticated','customer_product_prices','INSERT'), false, 'no direct INSERT for authenticated');
-- permission seeded
SELECT isnt((SELECT id FROM permissions WHERE code = 'customer_prices.manage'), NULL, 'perm seeded');
SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run to verify it fails** (MCP `execute_sql`).

- [ ] **Step 3: Write the migration** `20260710000137_init_customer_product_prices.sql`:

```sql
-- 20260710000137_init_customer_product_prices.sql
-- S69 Volet B — per-customer negotiated prices (B2B). Read: authenticated (RLS).
-- Writes go through SECURITY DEFINER RPCs gated on customer_prices.manage.

CREATE TABLE customer_product_prices (
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
  price       DECIMAL(12,2) NOT NULL CHECK (price >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, product_id)
);

CREATE TRIGGER customer_product_prices_set_updated_at
  BEFORE UPDATE ON customer_product_prices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE customer_product_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON customer_product_prices FOR SELECT USING (is_authenticated());

-- Role-level lockdown: no direct DML for app roles (RPC-only writes).
REVOKE ALL ON TABLE customer_product_prices FROM PUBLIC;
REVOKE ALL ON TABLE customer_product_prices FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE customer_product_prices FROM authenticated;
GRANT SELECT ON TABLE customer_product_prices TO authenticated;

-- Permission + role grants (mirror seed_backoffice_crud_perms pattern).
INSERT INTO permissions (code, module, action, description)
VALUES ('customer_prices.manage', 'customer_prices', 'manage', 'Manage per-customer negotiated prices')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role, permission_code)
SELECT r, 'customer_prices.manage'
FROM unnest(ARRAY['MANAGER','ADMIN','SUPER_ADMIN']) AS r
ON CONFLICT DO NOTHING;
```

> **Verify before applying:** confirm the exact column names of `permissions` and `role_permissions` and the role enum values via `list_tables` / a quick `execute_sql` against the live schema — adapt the two INSERTs if they differ (e.g. `role_permissions(role_name, …)`).

- [ ] **Step 4: Run to verify it passes** (MCP `execute_sql`). Expected `ok 1..4`.

- [ ] **Step 5: Regen types & commit**

```bash
git add supabase/migrations/20260710000137_init_customer_product_prices.sql supabase/tests/customer_product_prices_rls.test.sql packages/supabase/src/types.generated.ts
git commit -m "feat(b2b): customer_product_prices table + customer_prices.manage perm (S69 Volet B)"
```

---

### Task 6: RPCs upsert/delete `customer_product_prices`

**Files:**
- Create: `supabase/migrations/20260710000138_create_customer_product_price_rpcs.sql`
- Test: extend `supabase/tests/customer_product_prices_rls.test.sql` (add a block, bump `plan`).

**Interfaces:**
- Produces:
  - `upsert_customer_product_price_v1(p_customer_id uuid, p_product_id uuid, p_price numeric) RETURNS customer_product_prices`
  - `delete_customer_product_price_v1(p_customer_id uuid, p_product_id uuid) RETURNS void`
- Error codes: `invalid_price` (P0001), `customer_not_found` (P0002), `product_not_found` (P0002), `permission_denied` (P0003).

- [ ] **Step 1: Add failing test block**

```sql
-- append inside the BEGIN/ROLLBACK, bump plan() accordingly
SELECT lives_ok($$SELECT upsert_customer_product_price_v1(
  (SELECT id FROM customers WHERE deleted_at IS NULL LIMIT 1),
  (SELECT id FROM products  WHERE deleted_at IS NULL LIMIT 1), 7500)$$, 'upsert negotiated price');
SELECT throws_ok($$SELECT upsert_customer_product_price_v1(
  (SELECT id FROM customers WHERE deleted_at IS NULL LIMIT 1),
  (SELECT id FROM products  WHERE deleted_at IS NULL LIMIT 1), -5)$$, 'P0001', NULL, 'negative rejected');
SELECT lives_ok($$SELECT delete_customer_product_price_v1(
  (SELECT id FROM customers WHERE deleted_at IS NULL LIMIT 1),
  (SELECT id FROM products  WHERE deleted_at IS NULL LIMIT 1))$$, 'delete negotiated price');
```

- [ ] **Step 2: Run to verify it fails** (MCP `execute_sql`).

- [ ] **Step 3: Write the migration** `20260710000138_create_customer_product_price_rpcs.sql`:

```sql
-- 20260710000138_create_customer_product_price_rpcs.sql
-- S69 Volet B — write RPCs for per-customer negotiated prices.

CREATE FUNCTION upsert_customer_product_price_v1(
  p_customer_id uuid, p_product_id uuid, p_price numeric
) RETURNS customer_product_prices
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID; v_row customer_product_prices;
BEGIN
  IF NOT has_permission(v_uid, 'customer_prices.manage') THEN
    RAISE EXCEPTION 'permission_denied: customer_prices.manage' USING ERRCODE = 'P0003';
  END IF;
  IF p_price IS NULL OR p_price < 0 THEN
    RAISE EXCEPTION 'invalid_price' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'customer_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO customer_product_prices(customer_id, product_id, price)
  VALUES (p_customer_id, p_product_id, p_price)
  ON CONFLICT (customer_id, product_id) DO UPDATE SET price = EXCLUDED.price
  RETURNING * INTO v_row;

  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'customer_price.upserted', 'customers', p_customer_id,
          jsonb_build_object('product_id', p_product_id, 'price', p_price));
  RETURN v_row;
END $$;

CREATE FUNCTION delete_customer_product_price_v1(p_customer_id uuid, p_product_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID;
BEGIN
  IF NOT has_permission(v_uid, 'customer_prices.manage') THEN
    RAISE EXCEPTION 'permission_denied: customer_prices.manage' USING ERRCODE = 'P0003';
  END IF;
  DELETE FROM customer_product_prices WHERE customer_id = p_customer_id AND product_id = p_product_id;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'customer_price.deleted', 'customers', p_customer_id,
          jsonb_build_object('product_id', p_product_id));
END $$;

DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'upsert_customer_product_price_v1(uuid,uuid,numeric)',
    'delete_customer_product_price_v1(uuid,uuid)'
  ]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 4: Run to verify it passes** (MCP `execute_sql`).

- [ ] **Step 5: Regen types & commit**

```bash
git add supabase/migrations/20260710000138_create_customer_product_price_rpcs.sql supabase/tests/customer_product_prices_rls.test.sql packages/supabase/src/types.generated.ts
git commit -m "feat(b2b): upsert/delete_customer_product_price RPCs (S69 Volet B)"
```

---

### Task 7: Helper `_resolve_b2b_line_price_v1` + `create_b2b_order_v5`

**Files:**
- Create: `supabase/migrations/20260710000139_bump_create_b2b_order_v5.sql`
- Test: `supabase/tests/b2b_negotiated_price.test.sql`

**Interfaces:**
- Consumes: `customer_product_prices` (Task 5), `get_customer_product_price(uuid, uuid)` (existing), `products.retail_price`.
- Produces:
  - internal `_resolve_b2b_line_price_v1(p_customer_id uuid, p_product_id uuid) RETURNS numeric` (SECURITY DEFINER STABLE, REVOKE anon+authenticated+PUBLIC).
  - `create_b2b_order_v5(p_customer_id uuid, p_items jsonb, p_notes text, p_delivery_date date, p_idempotency_key uuid) RETURNS jsonb` (same signature as v4). Client-sent `unit_price` is **ignored**; billed price = resolved.

- [ ] **Step 1: Write the failing pgTAP suite** (`b2b_negotiated_price.test.sql`)

```sql
BEGIN;
SELECT plan(4);
-- Setup: a B2B customer in a 'custom' category, one product with retail_price known,
-- a category override, and a per-customer negotiated price. (Seed via inserts / existing helpers.)
-- Assert helper resolution order: customer > category(custom override) > retail.

-- 1. negotiated customer price wins
-- (insert customer_product_prices = 3000, product_category_prices = 4000, retail = 5000)
SELECT is(_resolve_b2b_line_price_v1(:'cust', :'prod')::int, 3000, 'customer negotiated price wins');

-- 2. remove customer price → category custom override applies
-- DELETE FROM customer_product_prices ...
SELECT is(_resolve_b2b_line_price_v1(:'cust', :'prod')::int, 4000, 'category custom override next');

-- 3. remove override → retail fallback
-- DELETE FROM product_category_prices ...
SELECT is(_resolve_b2b_line_price_v1(:'cust', :'prod')::int, 5000, 'retail fallback');

-- 4. create_b2b_order_v5 ignores client unit_price (send 999999, expect billed at resolved retail 5000)
-- SELECT create_b2b_order_v5(:'cust', jsonb_build_array(jsonb_build_object('product_id',:'prod','quantity',1,'unit_price',999999)), NULL, NULL, gen_random_uuid());
SELECT is((SELECT line_total::int FROM order_items WHERE order_id = <new_order_id> LIMIT 1), 5000, 'v5 bills resolved price, ignores client unit_price');

SELECT * FROM finish();
ROLLBACK;
```

> Fill the `:'cust'`/`:'prod'`/`<new_order_id>` bindings using the seeding pattern of `supabase/tests/b2b_settlement.test.sql` (which already creates a B2B customer + products). Capture the order id from the v5 return envelope (`->>'order_id'`).

- [ ] **Step 2: Run to verify it fails** (MCP `execute_sql`) — `_resolve_b2b_line_price_v1`/`create_b2b_order_v5` missing.

- [ ] **Step 3: Fetch the LIVE v4 body**

Run (MCP `execute_sql`): `SELECT pg_get_functiondef('public.create_b2b_order_v4'::regprocedure);`
This is the authoritative source (DEV-S57-02) — **not** the `_130` file (they should match, but always confirm).

- [ ] **Step 4: Write the migration** `20260710000139_bump_create_b2b_order_v5.sql`

Structure:

```sql
-- 20260710000139_bump_create_b2b_order_v5.sql
-- S69 Volet B — server-authoritative negotiated pricing for B2B orders.
-- Adds _resolve_b2b_line_price_v1 and bumps create_b2b_order_v4 → v5.
-- Body copied from LIVE v4 (pg_get_functiondef, DEV-S57-02); ONLY the two
-- `v_unit_price := (v_item->>'unit_price')::numeric;` assignments change to
-- resolve server-side. Everything else (TOCTOU credit, JE, display-aware stock,
-- invoice_number S68, idempotence) is byte-identical. DROP v4 same migration.

-- Internal resolver: customer negotiated > category price > retail.
CREATE FUNCTION _resolve_b2b_line_price_v1(p_customer_id uuid, p_product_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT price FROM customer_product_prices
      WHERE customer_id = p_customer_id AND product_id = p_product_id),
    get_customer_product_price(p_product_id, p_customer_id),
    (SELECT retail_price FROM products WHERE id = p_product_id)
  );
$$;
REVOKE ALL ON FUNCTION public._resolve_b2b_line_price_v1(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._resolve_b2b_line_price_v1(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._resolve_b2b_line_price_v1(uuid, uuid) FROM authenticated;

-- create_b2b_order_v5: LIVE v4 body verbatim, with the two price reads replaced.
CREATE FUNCTION create_b2b_order_v5(
  p_customer_id uuid, p_items jsonb, p_notes text DEFAULT NULL,
  p_delivery_date date DEFAULT NULL, p_idempotency_key uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
-- <PASTE LIVE v4 DECLARE…BEGIN…END verbatim, with these EXACT edits:>
--   1. In the validation loop, replace:
--        v_unit_price := (v_item->>'unit_price')::numeric;
--      with:
--        v_unit_price := _resolve_b2b_line_price_v1(p_customer_id, (v_item->>'product_id')::uuid);
--   2. In the insert loop, replace the same assignment identically.
--   3. Remove/relax the `invalid_unit_price` guard (resolved price is always ≥ 0);
--      keep a defensive `IF v_unit_price IS NULL THEN RAISE 'price_unresolved' P0002`.
--   4. Bump the audit metadata 'rpc_version' to 'v5-s69'.
$function$;

DROP FUNCTION IF EXISTS public.create_b2b_order_v4(uuid, jsonb, text, date, uuid);

REVOKE ALL ON FUNCTION public.create_b2b_order_v5(uuid, jsonb, text, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_b2b_order_v5(uuid, jsonb, text, date, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_b2b_order_v5(uuid, jsonb, text, date, uuid) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

> **Critical:** the pasted v4 body reads `unit_price` in **two** places (the validation loop and the insert loop — v4 lines ~118 and ~200). Both must use `_resolve_b2b_line_price_v1`, or the credit-check total and the billed total diverge. Do **not** rename any variable or touch the JE / stock / invoice_number / idempotency blocks.

- [ ] **Step 5: Run the suite to verify it passes** (MCP `execute_sql`). Expected `ok 1..4`.

- [ ] **Step 6: Re-green the B2B money-path anchors (repoint to v5)**

Repoint these suites' `create_b2b_order_v4(` calls to `create_b2b_order_v5(` and run each live (MCP `execute_sql`):
- `supabase/tests/b2b_settlement.test.sql` → expect 14/14
- `supabase/tests/b2b_display_aware_stock.test.sql` → expect 3/3
- `supabase/tests/b2b_order_flag_aware_stock.test.sql` → expect A/B/C green
- `supabase/tests/s44_money_gates.test.sql` → **run unchanged**, expect 12/12 (POS path untouched — this is the non-regression guard).

Also grep `apps/`, `supabase/tests/` for `create_b2b_order_v4` and repoint any remaining call-site to v5.

- [ ] **Step 7: Regen types & commit**

```bash
git add supabase/migrations/20260710000139_bump_create_b2b_order_v5.sql supabase/tests/b2b_negotiated_price.test.sql supabase/tests/b2b_settlement.test.sql supabase/tests/b2b_display_aware_stock.test.sql supabase/tests/b2b_order_flag_aware_stock.test.sql packages/supabase/src/types.generated.ts
git commit -m "feat(b2b): server-authoritative negotiated pricing — create_b2b_order_v5 (S69 Volet B) — closes fiche 09 B1.1"
```

---

### Task 8: BO — negotiated prices UI on the customer detail + B2B modal prefill

**Files:**
- Create: `apps/backoffice/src/features/customers/hooks/useCustomerNegotiatedPrices.ts`
- Create: `apps/backoffice/src/features/customers/components/NegotiatedPricesSection.tsx`
- Modify: the customer detail page to mount the section (e.g. `apps/backoffice/src/pages/customers/customer-detail/PricingTab.tsx` or `InfoTab.tsx` — pick the tab that already shows B2B/pricing info; mount under a clear "Negotiated prices (this customer)" heading).
- Modify: `apps/backoffice/src/features/btob/…/CreateB2bOrderModal.tsx` (prefill) and `apps/backoffice/src/features/btob/…/useCreateB2bOrder.ts` (repoint v5).
- Test: `apps/backoffice/src/features/customers/__tests__/negotiated-prices.smoke.test.tsx`

**Interfaces:**
- Consumes: RPCs from Task 6; `create_b2b_order_v5` from Task 7.
- Produces: `useCustomerNegotiatedPrices(customerId)` (read from `customer_product_prices` via RLS + `useUpsertNegotiatedPrice`/`useDeleteNegotiatedPrice` mutations).

- [ ] **Step 1: Write `useCustomerNegotiatedPrices.ts`**

Read query (select `product_id, price, product:products(name, sku, retail_price)` filtered by `customer_id`), plus `useUpsertNegotiatedPrice`/`useDeleteNegotiatedPrice` calling `upsert_customer_product_price_v1`/`delete_customer_product_price_v1`. Mirror the shape of `useCustomerCategoryPrices.ts` (read) + the mutation pattern from Task 4.

- [ ] **Step 2: Write `NegotiatedPricesSection.tsx`**

A `Card` with a table of negotiated prices (product, retail struck-through, negotiated) + add row (product picker + price) + inline delete. Gate the write controls on `customer_prices.manage`. Note: "Applied automatically to this customer's B2B orders." Tokens only.

- [ ] **Step 3: Mount the section** on the chosen customer-detail tab (only meaningful for customers usable as B2B — render for all, the section is empty by default).

- [ ] **Step 4: Repoint the B2B order modal to v5 + prefill**

- In `useCreateB2bOrder.ts`: change the `.rpc('create_b2b_order_v4', …)` call to `'create_b2b_order_v5'` (same args). Grep to confirm there is exactly one call-site.
- In `CreateB2bOrderModal.tsx`: when adding a line, prefill `unit_price` from `useCustomerNegotiatedPrices(customerId)` if a negotiated price exists for that product, else keep the catalog price. Add a hint: "Final price is set by the server from negotiated/category pricing." (The server is authoritative regardless.)

- [ ] **Step 5: Write the smoke test** (`negotiated-prices.smoke.test.tsx`)

Render `NegotiatedPricesSection` with mocked read + mutations. Assert add/edit/delete wire to the mutations and the write controls hide without `customer_prices.manage`.

- [ ] **Step 6: Run tests & typecheck**

Run: `pnpm --filter @breakery/backoffice test negotiated-prices` + `pnpm --filter @breakery/backoffice typecheck`. Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add apps/backoffice/src/features/customers/hooks/useCustomerNegotiatedPrices.ts apps/backoffice/src/features/customers/components/NegotiatedPricesSection.tsx apps/backoffice/src/pages/customers/customer-detail/ apps/backoffice/src/features/btob/ apps/backoffice/src/features/customers/__tests__/negotiated-prices.smoke.test.tsx
git commit -m "feat(bo): per-customer negotiated prices UI + B2B modal v5 prefill (S69 Volet B)"
```

---

### Task 9: Full-suite verification + session INDEX

**Files:**
- Create: `docs/workplan/plans/2026-07-08-session-69-INDEX.md`
- Modify: `CLAUDE.md` (Active Workplan bump), `docs/workplan/remise-a-plat/00-INDEX.md` (mark 08-D2.1 / 09-B1.1 solved), `docs/workplan/remise-a-plat/08-customers-loyalty.md` + `09-b2b-wholesale.md` (update-notes).

- [ ] **Step 1: Run the full monorepo suite**

Run: `pnpm typecheck && pnpm build && pnpm test`. Expected: all green (exit 0). Fix any drift.

- [ ] **Step 2: Confirm types no-drift**

Run (MCP): `generate_typescript_types`, diff against `packages/supabase/src/types.generated.ts`. Expected: no diff (already regenerated per task). If diff, commit the regen.

- [ ] **Step 3: Re-run the money-path anchor live**

Run (MCP `execute_sql`): `s44_money_gates.test.sql` (POS, expect 12/12) + `b2b_settlement.test.sql` (expect 14/14). Confirms no money-path regression.

- [ ] **Step 4: Write the session INDEX** (`2026-07-08-session-69-INDEX.md`) — résumé livré, migrations `_135..139`, décisions propriétaire, déviations DEV-S69-*, dettes D-*, and mark fiche 08 D2.1 / 09 B1.1 closed. Follow the S68 INDEX format.

- [ ] **Step 5: Bump `CLAUDE.md` Active Workplan** — move S69 into "Merged (latest)" once branch review passes; update the "Prochaine session (S70)" pointer (E2E nightly, or another Vague 2/3 item).

- [ ] **Step 6: Commit docs**

```bash
git add docs/workplan/ CLAUDE.md
git commit -m "docs(s69): session INDEX + workplan bump — customer categories CRUD + B2B negotiated pricing"
```

- [ ] **Step 7: Request code review** — invoke `superpowers:requesting-code-review` (pattern-guardian on the diff vs Critical patterns, then a final branch review). Address Critical/Important before opening the PR.

---

## Self-Review

**Spec coverage:**
- §3 Volet A CRUD catégories → Tasks 1, 3. ✅
- §3 overrides catégorie édition → Tasks 2, 4. ✅
- §4 table + perm → Task 5 ✅ ; RPCs client → Task 6 ✅ ; résolution serveur B2B v5 → Task 7 ✅ ; UI B2B → Task 8 ✅.
- §5 tests : `customer_category_crud` (T1), `product_category_prices` (T2), `customer_product_prices_rls` (T5/T6), `b2b_negotiated_price` (T7), ancres re-vertes (T7/T9), smokes (T3/T4/T8), types regen (each). ✅
- §6 séquencement `_135..139` en 2 vagues → tasks ordonnées. ✅
- §8 critères d'acceptation → couverts T3 (1), T4 (2), T8 (3), T7 (4), T9 (5). ✅

**Placeholder scan:** SQL RPC bodies are complete. The v5 body (T7) is deliberately expressed as "paste live v4 + 2 exact edits" — this is the CLAUDE.md-mandated LIVE-body discipline, not a placeholder; the edits are exact. UI tasks give exact paths + interface contracts + representative code; the product-picker leaves a documented choice (reuse existing vs minimal select) because the exact component depends on what exists in the BO — the implementer confirms by grep.

**Type consistency:** `CategoryInput` (T3) matches the `create/update_customer_category_v1` args (T1). `customerCategoryPricesKey` reused (T4). `_resolve_b2b_line_price_v1(uuid,uuid)` signature consistent T5→T7. `create_b2b_order_v5` signature identical to v4 (T7) and repointed in T8. Perm code `customer_prices.manage` consistent T5→T6→T8.

**Known verification points flagged for the implementer** (not placeholders — live-schema confirmations): (a) migration max via `list_migrations`; (b) `permissions`/`role_permissions` exact column/enum names (T5); (c) pgTAP test-auth helper name used by `customer_*` suites; (d) exact `CreateB2bOrderModal`/`useCreateB2bOrder` paths under `features/btob`.
