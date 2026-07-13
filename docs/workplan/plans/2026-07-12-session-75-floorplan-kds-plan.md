# S75 — Floor Plan BO + KDS Configuration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer les 2 dernières tuiles « Planned » du hub Settings BO — un CRUD Floor Plan (tables + sections, rendu POS inchangé) et une page KDS Configuration (seuils org + auto-archivage + chips StationFilter enfin câblés).

**Architecture:** Lot 1 = migration `table_sections` + `section_id` + 6 RPCs CRUD gatées `tables.*` → page BO → groupement POS par vraie section. Lot 2 = 3 clés `business_config` catégorie `kds` (extension `get_settings_by_category_v1`/`set_setting_v1` **depuis le corps live**, DEV-S57-02) → hook POS `useKdsConfig` → câblage chips + fix `CategoryFormDialog` → page BO. Money-path non touché.

**Tech Stack:** Supabase cloud V3 dev `ikcyvlovptebroadgtvd` via MCP (pas de Docker), pgTAP via `execute_sql` BEGIN/ROLLBACK, React + TanStack Query + `@breakery/ui`, Vitest, pnpm/turbo.

**Spec:** `docs/superpowers/specs/2026-07-12-s75-floorplan-kds-design.md` (décision 4 révisée : réutiliser `tables.*`, pas de `floor_plan.manage`).

## Global Constraints

- Branche : `swarm/session-75-floorplan-kds`. Commits conventionnels, co-author Claude.
- **Subagents ne peuvent PAS appeler le MCP Supabase** (MEMORY) : toute application de migration, run pgTAP, et regen types = **étape CONTRÔLEUR** (marquée ⚙️ CONTROLLER). Les subagents écrivent le SQL/fichiers.
- Migrations : NAME-block suivant = `20260712000161` puis `_162` (re-vérifier `ls supabase/migrations/ | sort | tail -1` avant apply). **Jamais de BEGIN/COMMIT dans le corps.**
- Après chaque migration : types **greffés** (DEV-S69-03) — regen via MCP puis diff ciblé sur `packages/supabase/src/types.generated.ts`, ne prendre QUE les hunks de cette session (le regen brut inclut du bruit `pos_events_2026_*` et `get_stock_levels_v1`).
- Tout RPC : SECURITY DEFINER + `SET search_path TO 'public'` + REVOKE trio (PUBLIC + anon, GRANT authenticated) — modèle `20260710000135`.
- `set_setting_v1`/`get_settings_by_category_v1` : CREATE OR REPLACE **depuis `pg_get_functiondef` live**, jamais depuis un fichier de migration (DEV-S57-02).
- Zéro couleur hex en dur — tokens Tailwind (`bg-bg-base`, `text-gold`, …). Fichiers < 500 lignes.
- Tests ciblés par workspace : `pnpm --filter @breakery/pos test <file>` / `@breakery/backoffice` — la CI est le seul filet full-suite (D-5 S72).

---

## Lot 1 — Floor Plan

### Task 1: Migration `_161` — table_sections + CRUD RPCs + pgTAP

**Files:**
- Create: `supabase/migrations/20260712000161_floor_plan_sections_crud.sql`
- Create: `supabase/tests/floor_plan_crud.test.sql`

**Interfaces (produces):**
- Table `table_sections(id, name, sort_order, is_active, created_at, updated_at, deleted_at)` ; colonne `restaurant_tables.section_id UUID NULL FK`.
- RPCs : `create_table_section_v1(p_name text, p_sort_order int) RETURNS table_sections` · `update_table_section_v1(p_id uuid, p_name text, p_sort_order int, p_is_active boolean) RETURNS table_sections` · `delete_table_section_v1(p_id uuid) RETURNS void` · `create_restaurant_table_v1(p_name text, p_seats int, p_section_id uuid, p_sort_order int) RETURNS restaurant_tables` · `update_restaurant_table_v1(p_id uuid, p_name text, p_seats int, p_section_id uuid, p_sort_order int, p_is_active boolean) RETURNS restaurant_tables` · `delete_restaurant_table_v1(p_id uuid) RETURNS void`.
- Erreurs typées : `P0003` permission · `P0001` `name_required|name_taken|invalid_seats|section_not_found|section_in_use|table_occupied` · `P0002` `*_not_found`.

- [ ] **Step 1: Écrire la migration** (corps complet ; gates = `tables.create/update/delete`, seedées S11 — MANAGER a create/update, delete = ADMIN+) :

```sql
-- 20260712000161_floor_plan_sections_crud.sql
-- S75 Lot 1 — real floor sections + RPC-only writes on restaurant_tables.
-- Replaces the sort_order>=100 front-end hack (FloorPlanModal/FloorPlanView).

CREATE TABLE table_sections (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
ALTER TABLE table_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_read ON table_sections FOR SELECT TO authenticated USING (true);
REVOKE ALL ON table_sections FROM anon, PUBLIC;
GRANT SELECT ON table_sections TO authenticated;  -- writes via RPCs only

ALTER TABLE restaurant_tables ADD COLUMN section_id UUID REFERENCES table_sections(id);

-- Seed + backfill from the legacy front hack (sort_order >= 100 = Terrace).
INSERT INTO table_sections (name, sort_order) VALUES ('Interior', 0), ('Terrace', 100);
UPDATE restaurant_tables SET section_id =
  (SELECT id FROM table_sections WHERE name = CASE WHEN sort_order >= 100 THEN 'Terrace' ELSE 'Interior' END);

-- S11 direct-write policies bypass the occupied-guard + audit below → RPC-only now.
DROP POLICY IF EXISTS perm_create ON restaurant_tables;
DROP POLICY IF EXISTS perm_update ON restaurant_tables;

CREATE FUNCTION create_table_section_v1(p_name text, p_sort_order int)
RETURNS table_sections LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID; v_row table_sections;
BEGIN
  IF NOT has_permission(v_uid, 'tables.create') THEN
    RAISE EXCEPTION 'permission_denied: tables.create' USING ERRCODE = 'P0003';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO table_sections (name, sort_order) VALUES (btrim(p_name), COALESCE(p_sort_order, 0))
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'name_taken' USING ERRCODE = 'P0001';
  END;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'table_section.created', 'table_sections', v_row.id, jsonb_build_object('name', v_row.name));
  RETURN v_row;
END $$;

CREATE FUNCTION update_table_section_v1(p_id uuid, p_name text, p_sort_order int, p_is_active boolean)
RETURNS table_sections LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID; v_old table_sections; v_row table_sections;
BEGIN
  IF NOT has_permission(v_uid, 'tables.update') THEN
    RAISE EXCEPTION 'permission_denied: tables.update' USING ERRCODE = 'P0003';
  END IF;
  SELECT * INTO v_old FROM table_sections WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'section_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;
  -- Deactivating a section that still holds active tables would orphan them on POS.
  IF v_old.is_active AND COALESCE(p_is_active, true) = false
     AND EXISTS (SELECT 1 FROM restaurant_tables WHERE section_id = p_id AND is_active) THEN
    RAISE EXCEPTION 'section_in_use' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    UPDATE table_sections SET name = btrim(p_name), sort_order = COALESCE(p_sort_order, sort_order),
      is_active = COALESCE(p_is_active, is_active), updated_at = now()
    WHERE id = p_id RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'name_taken' USING ERRCODE = 'P0001';
  END;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'table_section.updated', 'table_sections', p_id,
          jsonb_build_object('before', jsonb_build_object('name', v_old.name, 'sort_order', v_old.sort_order, 'is_active', v_old.is_active),
                             'after',  jsonb_build_object('name', v_row.name, 'sort_order', v_row.sort_order, 'is_active', v_row.is_active)));
  RETURN v_row;
END $$;

CREATE FUNCTION delete_table_section_v1(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID; v_deleted timestamptz;
BEGIN
  IF NOT has_permission(v_uid, 'tables.delete') THEN
    RAISE EXCEPTION 'permission_denied: tables.delete' USING ERRCODE = 'P0003';
  END IF;
  SELECT deleted_at INTO v_deleted FROM table_sections WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'section_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_deleted IS NOT NULL THEN RETURN; END IF;  -- idempotent
  IF EXISTS (SELECT 1 FROM restaurant_tables WHERE section_id = p_id AND is_active) THEN
    RAISE EXCEPTION 'section_in_use' USING ERRCODE = 'P0001';
  END IF;
  UPDATE table_sections SET deleted_at = now(), is_active = false, updated_at = now() WHERE id = p_id;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'table_section.deleted', 'table_sections', p_id, '{}'::jsonb);
END $$;

CREATE FUNCTION create_restaurant_table_v1(p_name text, p_seats int, p_section_id uuid, p_sort_order int)
RETURNS restaurant_tables LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID; v_row restaurant_tables;
BEGIN
  IF NOT has_permission(v_uid, 'tables.create') THEN
    RAISE EXCEPTION 'permission_denied: tables.create' USING ERRCODE = 'P0003';
  END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_seats IS NULL OR p_seats < 1 OR p_seats > 20 THEN
    RAISE EXCEPTION 'invalid_seats' USING ERRCODE = 'P0001';
  END IF;
  IF p_section_id IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM table_sections WHERE id = p_section_id AND is_active AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'section_not_found' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    INSERT INTO restaurant_tables (name, seats, section_id, sort_order)
    VALUES (btrim(p_name), p_seats, p_section_id, COALESCE(p_sort_order, 0)) RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'name_taken' USING ERRCODE = 'P0001';
  END;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'table.created', 'restaurant_tables', v_row.id, jsonb_build_object('name', v_row.name, 'seats', v_row.seats));
  RETURN v_row;
END $$;

CREATE FUNCTION update_restaurant_table_v1(p_id uuid, p_name text, p_seats int, p_section_id uuid, p_sort_order int, p_is_active boolean)
RETURNS restaurant_tables LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID; v_old restaurant_tables; v_row restaurant_tables;
BEGIN
  IF NOT has_permission(v_uid, 'tables.update') THEN
    RAISE EXCEPTION 'permission_denied: tables.update' USING ERRCODE = 'P0003';
  END IF;
  SELECT * INTO v_old FROM restaurant_tables WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'table_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'name_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_seats IS NULL OR p_seats < 1 OR p_seats > 20 THEN
    RAISE EXCEPTION 'invalid_seats' USING ERRCODE = 'P0001';
  END IF;
  IF p_section_id IS NOT NULL AND NOT EXISTS
     (SELECT 1 FROM table_sections WHERE id = p_section_id AND is_active AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'section_not_found' USING ERRCODE = 'P0001';
  END IF;
  -- orders.table_number references the table BY NAME: renaming or deactivating a
  -- table under a live order would orphan it (occupancy map keyed by name).
  IF (btrim(p_name) <> v_old.name OR (v_old.is_active AND COALESCE(p_is_active, true) = false))
     AND EXISTS (SELECT 1 FROM orders WHERE table_number = v_old.name
                 AND status NOT IN ('completed', 'voided')) THEN
    RAISE EXCEPTION 'table_occupied' USING ERRCODE = 'P0001';
  END IF;
  BEGIN
    UPDATE restaurant_tables SET name = btrim(p_name), seats = p_seats, section_id = p_section_id,
      sort_order = COALESCE(p_sort_order, sort_order), is_active = COALESCE(p_is_active, is_active),
      updated_at = now()
    WHERE id = p_id RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'name_taken' USING ERRCODE = 'P0001';
  END;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'table.updated', 'restaurant_tables', p_id,
          jsonb_build_object('before', jsonb_build_object('name', v_old.name, 'seats', v_old.seats, 'section_id', v_old.section_id, 'is_active', v_old.is_active),
                             'after',  jsonb_build_object('name', v_row.name, 'seats', v_row.seats, 'section_id', v_row.section_id, 'is_active', v_row.is_active)));
  RETURN v_row;
END $$;

CREATE FUNCTION delete_restaurant_table_v1(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid UUID := auth.uid(); v_actor UUID; v_old restaurant_tables;
BEGIN
  IF NOT has_permission(v_uid, 'tables.delete') THEN
    RAISE EXCEPTION 'permission_denied: tables.delete' USING ERRCODE = 'P0003';
  END IF;
  SELECT * INTO v_old FROM restaurant_tables WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'table_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_old.deleted_at IS NOT NULL THEN RETURN; END IF;  -- idempotent
  IF EXISTS (SELECT 1 FROM orders WHERE table_number = v_old.name
             AND status NOT IN ('completed', 'voided')) THEN
    RAISE EXCEPTION 'table_occupied' USING ERRCODE = 'P0001';
  END IF;
  UPDATE restaurant_tables SET deleted_at = now(), is_active = false, updated_at = now() WHERE id = p_id;
  SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor, 'table.deleted', 'restaurant_tables', p_id, jsonb_build_object('name', v_old.name));
END $$;

DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'create_table_section_v1(text,int)', 'update_table_section_v1(uuid,text,int,boolean)',
    'delete_table_section_v1(uuid)',
    'create_restaurant_table_v1(text,int,uuid,int)',
    'update_restaurant_table_v1(uuid,text,int,uuid,int,boolean)',
    'delete_restaurant_table_v1(uuid)'
  ]) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', fn);
  END LOOP;
END $$;
```

- [ ] **Step 2 ⚙️ CONTROLLER: appliquer** via `mcp__claude_ai_Supabase__apply_migration` (project_id `ikcyvlovptebroadgtvd`, name `floor_plan_sections_crud`). Vérifier : `SELECT count(*) FROM table_sections` → 2 ; `SELECT count(*) FROM restaurant_tables WHERE section_id IS NULL` → 0.
- [ ] **Step 3: Écrire `supabase/tests/floor_plan_crud.test.sql`** — harnais miroir de `customer_category_crud.test.sql` (identité ADMIN EMP000 via `set_config('request.jwt.claims', …)`, `BEGIN; … SELECT plan(N); … finish(); ROLLBACK`). Assertions (≥ 14) :
  1. `lives_ok` create section 'Bar Corner' ; 2. `is` name persisté ; 3. `throws_ok` create section dupliquée → P0001 ; 4. `throws_ok` create section nom vide → P0001 ; 5. `lives_ok` create table 'T-99' 4 sièges dans la section ; 6. `throws_ok` create table seats=0 → P0001 ; 7. `throws_ok` create table section inexistante (gen_random_uuid) → P0001 ; 8. **garde occupée** : `INSERT INTO orders` minimal (status='pending', table_number='T-99', + colonnes NOT NULL requises — copier le seed d'orders de `create_tablet_order_v4_table_guard.test.sql`) puis `throws_ok` rename T-99 → P0001 `table_occupied` ; 9. `throws_ok` deactivate T-99 occupée → P0001 ; 10. UPDATE orders SET status='completed' puis `lives_ok` rename ; 11. `throws_ok` delete section avec table active → P0001 `section_in_use` ; 12. `lives_ok` delete table (soft) + `isnt deleted_at NULL` ; 13. `lives_ok` re-delete idempotent ; 14. audit : `is count(*) >= 1 FROM audit_logs WHERE action='table.created'` ; 15. RLS : `is` policies `perm_create`/`perm_update` absentes de `pg_policies` pour restaurant_tables ; 16. anon : `SELECT has_function_privilege('anon', 'create_restaurant_table_v1(text,int,uuid,int)', 'EXECUTE')` → false.
- [ ] **Step 4 ⚙️ CONTROLLER: exécuter la suite** via `execute_sql` (enveloppe BEGIN…ROLLBACK ; si > ~12 Ko, runner API-from-file — MEMORY). Attendu : tout vert. Si rouge → corriger RPC via nouvelle migration ou fix test, re-run.
- [ ] **Step 5: Commit** `feat(db): S75 lot 1 — table_sections + floor plan CRUD RPCs (tables.* gates, RPC-only writes) + pgTAP`

### Task 2: Types greffés + type domaine

**Files:**
- Modify: `packages/supabase/src/types.generated.ts` (greffe : table `table_sections`, colonne `section_id`, les 6 fonctions)
- Modify: `packages/domain/src/tables/types.ts` + `packages/domain/src/tables/index.ts`

**Interfaces (produces):** `RestaurantTable` gagne `section_id: string | null` et `table_sections?: { name: string; sort_order: number } | null` (shape du nested select) ; nouveau type `TableSection { id; name; sort_order; is_active }`.

- [ ] **Step 1 ⚙️ CONTROLLER:** `generate_typescript_types` → diff vs `types.generated.ts` → **greffer uniquement** les hunks S75 (DEV-S69-03).
- [ ] **Step 2:** Étendre le domaine :

```ts
// packages/domain/src/tables/types.ts
export interface TableSection {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}
export interface RestaurantTable {
  id: string;
  name: string;
  seats: number;
  sort_order: number;
  is_active: boolean;
  /** S75 — real section FK (NULL = legacy/unsectioned, rendered under "Interior"). */
  section_id: string | null;
  /** Shape of the joined nested select; optional so list queries without the join still type. */
  table_sections?: { name: string; sort_order: number } | null;
}
```
```ts
// packages/domain/src/tables/index.ts
export type { RestaurantTable, TableSection } from './types.js';
```
- [ ] **Step 3:** `pnpm --filter @breakery/domain typecheck && pnpm --filter @breakery/supabase typecheck` → PASS. Commit `feat(domain): S75 — RestaurantTable.section_id + TableSection (types greffés)`.

### Task 3: Page BO Floor Plan

**Files:**
- Create: `apps/backoffice/src/features/floor-plan/hooks/useFloorPlanAdmin.ts`
- Create: `apps/backoffice/src/features/floor-plan/components/TableFormDialog.tsx`
- Create: `apps/backoffice/src/features/floor-plan/components/SectionFormDialog.tsx`
- Create: `apps/backoffice/src/pages/settings/SettingsFloorPlanPage.tsx`
- Modify: `apps/backoffice/src/routes/index.tsx` (lazy import + route) ; `apps/backoffice/src/pages/settings/SettingsHubPage.tsx:98` (tuile)
- Test: `apps/backoffice/src/features/floor-plan/__tests__/SettingsFloorPlanPage.test.tsx`

**Interfaces:**
- Consumes: RPCs Task 1, types Task 2.
- Produces: hooks `useFloorPlanTables()` (query `['floor_plan','tables']` — SELECT `id,name,seats,sort_order,is_active,section_id, table_sections(name,sort_order)` **sans** filtre is_active, ORDER sort_order), `useTableSections()` (query `['floor_plan','sections']`, y compris inactives), mutations `useCreateTable/useUpdateTable/useDeleteTable/useCreateSection/useUpdateSection/useDeleteSection` (chacune `supabase.rpc('<rpc>_v1', {...})`, invalidation des 2 query keys + `['restaurant_tables']`).

- [ ] **Step 1: Test smoke d'abord** (mock hooks, pattern des tests S73 de pages settings) :

```tsx
// apps/backoffice/src/features/floor-plan/__tests__/SettingsFloorPlanPage.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsFloorPlanPage from '@/pages/settings/SettingsFloorPlanPage.js';

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));
vi.mock('@/features/floor-plan/hooks/useFloorPlanAdmin.js', () => ({
  useFloorPlanTables: () => ({ data: [
    { id: 't1', name: 'T-01', seats: 4, sort_order: 0, is_active: true, section_id: 's1', table_sections: { name: 'Interior', sort_order: 0 } },
    { id: 't2', name: 'Patio-1', seats: 6, sort_order: 100, is_active: true, section_id: 's2', table_sections: { name: 'Terrace', sort_order: 100 } },
  ], isLoading: false, error: null }),
  useTableSections: () => ({ data: [
    { id: 's1', name: 'Interior', sort_order: 0, is_active: true },
    { id: 's2', name: 'Terrace', sort_order: 100, is_active: true },
  ], isLoading: false, error: null }),
  useCreateTable: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateTable: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTable: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateSection: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSection: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSection: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe('SettingsFloorPlanPage', () => {
  it('groups tables under their section and shows the add CTA', () => {
    render(<SettingsFloorPlanPage />);
    expect(screen.getByText('Interior')).toBeInTheDocument();
    expect(screen.getByText('Terrace')).toBeInTheDocument();
    expect(screen.getByText('T-01')).toBeInTheDocument();
    expect(screen.getByText('Patio-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add table/i })).toBeInTheDocument();
  });
});
```
- [ ] **Step 2:** `pnpm --filter @breakery/backoffice test SettingsFloorPlanPage` → FAIL (page inexistante).
- [ ] **Step 3: Implémenter.** `useFloorPlanAdmin.ts` : modèle `useCategoryMutations.ts` (rpc + invalidate). Page : `PageHeader` + par section active (ordre `sort_order`) une `Card` listant ses tables (name, seats, badge Inactive si `!is_active`, boutons Edit/Deactivate), groupe « Interior » d'accueil pour `section_id NULL`, boutons « Add table » / « Add section », dialogs (`TableFormDialog` : name, seats 1-20, select section natif `selectClassName`, sort_order ; `SectionFormDialog` : name, sort_order) — erreurs RPC mappées (`table_occupied` → « Table has an active order — close it first », `section_in_use`, `name_taken`). Édition gatée `hasPermission('tables.update')` (boutons masqués sinon) ; delete gaté `tables.delete`. Route (modèle `settings/customer-display` `routes/index.tsx:910-917`) : `<PermissionGate required="tables.update">` path `settings/floor-plan`. Tuile hub : remplacer la ligne 98 par `{ to: '/backoffice/settings/floor-plan', permission: 'tables.update', title: 'Floor Plan', blurb: 'Tables + room sections (POS floor plan).', icon: Map }` + MAJ du commentaire d'en-tête (plus que KDS en planned).
- [ ] **Step 4:** re-run test → PASS. `pnpm --filter @breakery/backoffice typecheck`.
- [ ] **Step 5: Commit** `feat(backoffice): S75 lot 1 — Floor Plan settings page (tables + sections CRUD)`

### Task 4: POS/tablette — groupement par vraie section

**Files:**
- Create: `apps/pos/src/features/floor-plan/sections.ts`
- Modify: `apps/pos/src/features/tables/hooks/useRestaurantTables.ts:24` (select) ; `apps/pos/src/features/floor-plan/FloorPlanModal.tsx` (bucketTables/tabs) ; `apps/pos/src/features/tablet/FloorPlanView.tsx` (idem)
- Test: `apps/pos/src/features/floor-plan/__tests__/sections.test.ts`

**Interfaces (produces):**
```ts
export interface FloorSection { key: string; label: string; tables: RestaurantTable[]; }
export function bucketTablesBySection(tables: RestaurantTable[]): FloorSection[];
```
Sections triées par `table_sections.sort_order`, tables `section_id NULL` regroupées sous `{ key: 'unsectioned', label: 'Interior' }` en tête, ordre des tables préservé (le serveur trie par `sort_order`).

- [ ] **Step 1: Test d'abord** :

```ts
// apps/pos/src/features/floor-plan/__tests__/sections.test.ts
import { describe, expect, it } from 'vitest';
import { bucketTablesBySection } from '../sections';
import type { RestaurantTable } from '@breakery/domain';

const t = (name: string, section: { name: string; sort_order: number } | null, id = name): RestaurantTable => ({
  id, name, seats: 4, sort_order: 0, is_active: true,
  section_id: section ? section.name : null, table_sections: section,
});

describe('bucketTablesBySection', () => {
  it('groups by joined section, ordered by section sort_order', () => {
    const out = bucketTablesBySection([
      t('P1', { name: 'Terrace', sort_order: 100 }),
      t('T1', { name: 'Interior', sort_order: 0 }),
    ]);
    expect(out.map((s) => s.label)).toEqual(['Interior', 'Terrace']);
    expect(out[1]?.tables.map((x) => x.name)).toEqual(['P1']);
  });
  it('parks NULL-section tables under a leading Interior fallback', () => {
    const out = bucketTablesBySection([t('Legacy', null), t('P1', { name: 'Terrace', sort_order: 100 })]);
    expect(out[0]).toMatchObject({ key: 'unsectioned', label: 'Interior' });
    expect(out[0]?.tables.map((x) => x.name)).toEqual(['Legacy']);
  });
  it('merges NULL-section tables into a real Interior section when one exists', () => {
    const out = bucketTablesBySection([t('T1', { name: 'Interior', sort_order: 0 }), t('Legacy', null)]);
    expect(out).toHaveLength(1);
    expect(out[0]?.tables.map((x) => x.name)).toEqual(['T1', 'Legacy']);
  });
});
```
- [ ] **Step 2:** run → FAIL. **Step 3: Implémenter** `sections.ts` (Map label→FloorSection ; NULL → label 'Interior' fusionné si une section 'Interior' existe, sinon groupe `unsectioned` en tête ; tri final par sort_order de section, unsectioned = -1).
- [ ] **Step 4:** `useRestaurantTables` : select devient `'id, name, seats, sort_order, is_active, section_id, table_sections(name, sort_order)'` (adapter l'interface builder loose : `.eq` + `.order` inchangés).
- [ ] **Step 5:** `FloorPlanModal` + `FloorPlanView` : supprimer `bucketTables` + le type local `FloorPlanSection` ; état `const [sectionKey, setSectionKey] = useState<string | null>(null)` ; `const sections = useMemo(() => bucketTablesBySection(tables), [tables])` ; section visible = `sections.find(s => s.key === sectionKey) ?? sections[0]` ; tabs rendus en `.map` sur `sections` (icône : `Home` si label 'Interior', `Trees` si 'Terrace', sinon `MapPin` de lucide). Aucune autre logique touchée (occupancy, transfert, CTA identiques).
- [ ] **Step 6:** `pnpm --filter @breakery/pos test sections && pnpm --filter @breakery/pos test FloorPlan` (smokes existants doivent rester verts — MAJ des fixtures mock qui n'ont pas `section_id` : ajouter `section_id: null`). `pnpm --filter @breakery/pos typecheck`.
- [ ] **Step 7: Commit** `feat(pos): S75 lot 1 — floor plan grouped by real table_sections (sort_order hack removed)` puis **PR lot 1** (base master).

---

## Lot 2 — KDS Configuration

### Task 5: Migration `_162` — clés `kds` dans business_config + pgTAP + dictionnaire

**Files:**
- Create: `supabase/migrations/20260712000162_settings_kds_thresholds.sql` (⚙️ corps RPC repris du live)
- Create: `supabase/tests/settings_kds.test.sql`
- Modify: `packages/supabase/src/settings-keys.ts` ; `packages/supabase/src/types.generated.ts` (greffe)

**Interfaces (produces):** colonnes `business_config.kds_warning_threshold_minutes INT NOT NULL DEFAULT 5`, `kds_urgent_threshold_minutes INT NOT NULL DEFAULT 10`, `kds_auto_archive_minutes INT NOT NULL DEFAULT 5` ; catégorie RPC `kds` (3 clés) ; `SettingsCategory` inclut `'kds'`.

- [ ] **Step 1 ⚙️ CONTROLLER:** `execute_sql` → `SELECT pg_get_functiondef('get_settings_by_category_v1(text)'::regprocedure), pg_get_functiondef('set_setting_v1(text,jsonb,text)'::regprocedure)` (ajuster les signatures si le cast échoue — les retrouver via `\df`-équivalent `pg_proc`). **Les corps live font foi** (DEV-S57-02), pas `_159`.
- [ ] **Step 2:** Écrire `_162` : `ALTER TABLE business_config ADD COLUMN` ×3 (avec DEFAULT + NOT NULL) puis les 2 `CREATE OR REPLACE FUNCTION` = corps live + insertions :
  - `get_settings_by_category_v1` — nouvelle branche dans le CASE des catégories :
    ```sql
    WHEN 'kds' THEN
      v_settings := jsonb_build_object(
        'kds_warning_threshold_minutes', v_config.kds_warning_threshold_minutes,
        'kds_urgent_threshold_minutes',  v_config.kds_urgent_threshold_minutes,
        'kds_auto_archive_minutes',      v_config.kds_auto_archive_minutes);
    ```
    (adapter à la forme réelle du corps live — si la fonction liste les catégories valides, y ajouter `'kds'`.)
  - `set_setting_v1` — 3 branches dans le `CASE p_key` (modèle des branches numériques existantes) :
    ```sql
    WHEN 'kds_warning_threshold_minutes' THEN
      IF jsonb_typeof(p_value) <> 'number' OR (p_value)::text::numeric <> floor((p_value)::text::numeric)
         OR (p_value)::text::int NOT BETWEEN 1 AND 120 THEN
        RAISE EXCEPTION 'invalid_value: expected integer 1..120' USING ERRCODE = 'P0001';
      END IF;
      IF (p_value)::text::int >= (SELECT kds_urgent_threshold_minutes FROM business_config WHERE id = 1) THEN
        RAISE EXCEPTION 'invalid_value: warning must be < urgent' USING ERRCODE = 'P0001';
      END IF;
      UPDATE business_config SET kds_warning_threshold_minutes = (p_value)::text::int WHERE id = 1;
    WHEN 'kds_urgent_threshold_minutes' THEN
      -- même garde 1..120 ; puis :
      IF (p_value)::text::int <= (SELECT kds_warning_threshold_minutes FROM business_config WHERE id = 1) THEN
        RAISE EXCEPTION 'invalid_value: urgent must be > warning' USING ERRCODE = 'P0001';
      END IF;
      UPDATE business_config SET kds_urgent_threshold_minutes = (p_value)::text::int WHERE id = 1;
    WHEN 'kds_auto_archive_minutes' THEN
      -- garde 1..120 seulement
      UPDATE business_config SET kds_auto_archive_minutes = (p_value)::text::int WHERE id = 1;
    ```
    (reprendre la syntaxe exacte de lecture du old/new + l'INSERT `audit_logs` du corps live — il est mutualisé en fin de fonction dans `_159` ; vérifier que les 3 clés passent par ce chemin.)
- [ ] **Step 3 ⚙️ CONTROLLER: appliquer** via `apply_migration` (name `settings_kds_thresholds`). Sanity : `SELECT get_settings_by_category_v1('kds')` → 3 clés aux défauts 5/10/5.
- [ ] **Step 4:** `supabase/tests/settings_kds.test.sql` (même harnais EMP000, plan(≥ 9)) : catégorie `kds` retourne les 3 clés ; `lives_ok` set warning=3 ; `throws_ok` warning=0 → P0001 ; `throws_ok` warning=200 → P0001 ; `throws_ok` warning=10 (>= urgent 10) → P0001 ; `throws_ok` urgent=3 (<= warning 3) → P0001 ; `lives_ok` urgent=15 puis warning=12 (ordre urgent-d'abord fonctionne) ; `lives_ok` archive=30 ; audit `setting.update` avec `metadata->>'key'='kds_warning_threshold_minutes'` présent ; clé inconnue `kds_bogus` → P0001/`setting_unknown`.
- [ ] **Step 5 ⚙️ CONTROLLER:** run pgTAP → vert. Regen types → **greffe** (3 colonnes).
- [ ] **Step 6:** `settings-keys.ts` : ajouter `'kds'` à `SETTINGS_CATEGORIES` + `kds: ['kds_warning_threshold_minutes', 'kds_urgent_threshold_minutes', 'kds_auto_archive_minutes']` dans `SETTING_KEYS`. Run son test de conformité : `pnpm --filter @breakery/supabase test settings-keys` → PASS.
- [ ] **Step 7: Commit** `feat(db): S75 lot 2 — business_config kds thresholds + settings RPC category (live-body regrafted) + pgTAP`

### Task 6: POS — `useKdsConfig` consommé partout

**Files:**
- Create: `apps/pos/src/features/kds/hooks/useKdsConfig.ts`
- Modify: `apps/pos/src/features/kds/components/KdsOrderCard.tsx:53-91` ; `apps/pos/src/features/kds/hooks/useKdsAlarm.ts` ; `apps/pos/src/features/kds/KdsBoard.tsx:56,104-107,206-230`
- Test: `apps/pos/src/features/kds/hooks/__tests__/useKdsConfig.test.ts`

**Interfaces (produces):**
```ts
export interface KdsConfig { warningMs: number; urgentMs: number; archiveMs: number; }
export const KDS_CONFIG_DEFAULTS: KdsConfig = { warningMs: 300_000, urgentMs: 600_000, archiveMs: 300_000 };
export function useKdsConfig(): KdsConfig; // jamais undefined — fallback silencieux façon useTaxRate
```

- [ ] **Step 1: Test d'abord** (mock supabase, modèle du test de `useTaxRate` s'il existe, sinon renderHook + QueryClientProvider) : (a) valeurs DB 3/8/2 min → `{180000, 480000, 120000}` ; (b) erreur réseau → `KDS_CONFIG_DEFAULTS` ; (c) row aux colonnes NULL (types legacy) → défauts.
- [ ] **Step 2:** run → FAIL. **Step 3: Implémenter** : `useQuery({ queryKey: ['kds_config'], staleTime: 60_000, refetchInterval: 60_000 })`, SELECT direct `business_config` colonnes `kds_warning_threshold_minutes, kds_urgent_threshold_minutes, kds_auto_archive_minutes` (builder loose comme `useRestaurantTables`), map minutes→ms, `catch`/error → défauts. Retour synchrone : `data ?? KDS_CONFIG_DEFAULTS`.
- [ ] **Step 4: Consommateurs.** `KdsOrderCard` : supprimer les constantes l.55-56 ; `ageStyle(ageMs, cfg)` prend le config ; la carte appelle `const cfg = useKdsConfig()` (dédupé par react-query). `useKdsAlarm` : supprimer `URGENT_THRESHOLD_MS` l.45 ; le hook appelle `useKdsConfig()`, `urgentMs` passe à `hasUrgentUnbumpedOrder(items, now, urgentMs)` et alimente l'interval via un ref (`urgentMsRef.current = urgentMs`). `KdsBoard` : supprimer `ARCHIVE_AFTER_MS` ; `filterAndArchive(item, stationFilter, now, archiveMs)` avec `archiveMs` de `useKdsConfig()`.
- [ ] **Step 5:** MAJ des tests existants du KDS qui référencent les constantes (grep `ARCHIVE_AFTER_MS|URGENT_THRESHOLD_MS|WARNING_THRESHOLD` dans `apps/pos/src/features/kds/**/__tests__`) — mocker `useKdsConfig` → défauts. Run : `pnpm --filter @breakery/pos test kds` → PASS. Typecheck.
- [ ] **Step 6: Commit** `feat(pos): S75 lot 2 — KDS thresholds/auto-archive read from business_config (useKdsConfig)`

### Task 7: POS chips câblés + fix CategoryFormDialog

**Files:**
- Modify: `apps/pos/src/features/kds/hooks/useKdsOrders.ts` (select + `KdsItemRow.kds_station`) ; `apps/pos/src/features/kds/KdsBoard.tsx:224-227` (prédicat réel)
- Modify: `apps/backoffice/src/features/categories/components/CategoryFormDialog.tsx:20` (valeurs CHECK)
- Test: `apps/pos/src/features/kds/__tests__/stationFilter.test.ts` (ou suite KdsBoard existante)

**Interfaces:** `KdsItemRow` gagne `kds_station: string | null` (résolu via `products → categories.kds_station`). Un item `kds_station NULL` passe TOUS les chips (rien ne disparaît en silence).

- [ ] **Step 1: Test d'abord** sur le prédicat exporté `filterAndArchive` : chip `'bar'` + item `kds_station: 'hot'` → false ; chip `'bar'` + `'bar'` → true ; chip `'bar'` + `null` → true ; chip `'all'` → true.
- [ ] **Step 2:** run → FAIL (le champ n'existe pas). **Step 3:** `useKdsOrders` : select `products(name)` devient `products(name, categories(kds_station))` ; `RawRow.products` type `{ name: string; categories: { kds_station: string | null } | { kds_station: string | null }[] | null }` (normaliser via `pickFirst` ×2) ; mapper `kds_station: pickFirst(pickFirst(row.products)?.categories ?? null)?.kds_station ?? null`. `KdsBoard.filterAndArchive` : remplacer le cast l.225 par `if (stationFilter !== 'all' && item.kds_station !== null && item.kds_station !== stationFilter) return false;` + retirer le commentaire « if that column ever surfaces ».
- [ ] **Step 4:** `CategoryFormDialog.tsx:20` :
```ts
const KDS_STATIONS = [
  { value: 'hot',  label: 'Hot kitchen' },
  { value: 'cold', label: 'Cold prep' },
  { value: 'bar',  label: 'Bar' },
  { value: 'prep', label: 'Prep / Bakery' },
  { value: 'expo', label: 'Expo / Pickup' },
] as const;
```
(le `.map` du select rend `value`/`label` ; l'ancienne liste `'kitchen'/'pastry'/'bakery'` violait le CHECK DB — bug latent fixé.) Vérifier qu'un test BO categories existant couvre le dialog ; sinon assertion rapide dans sa suite : les 5 options rendues.
- [ ] **Step 5:** run tests pos kds + backoffice categories → PASS. Typecheck ×2.
- [ ] **Step 6: Commit** `feat(pos): S75 lot 2 — StationFilter chips wired to categories.kds_station (+ fix BO invalid kds_station options)`

### Task 8: Page BO KDS Configuration

**Files:**
- Create: `apps/backoffice/src/pages/settings/SettingsKdsConfigPage.tsx`
- Modify: `apps/backoffice/src/routes/index.tsx` ; `apps/backoffice/src/pages/settings/SettingsHubPage.tsx:66`
- Test: `apps/backoffice/src/features/settings/__tests__/SettingsKdsConfigPage.test.tsx`

**Interfaces (consumes):** `useSettings('kds')` / `useSetSetting()` (catégorie `'kds'` typée depuis Task 5).

- [ ] **Step 1: Test d'abord** (mock `useSettings` → `{ category: 'kds', settings: { kds_warning_threshold_minutes: 5, kds_urgent_threshold_minutes: 10, kds_auto_archive_minutes: 5 } }`, mock `useSetSetting`, mock authStore `settings.update` true) : les 3 inputs rendus avec valeurs ; saisir warning=12 (>= urgent) → message d'erreur client + bouton save désactivé ; saisir warning=8 → save actif.
- [ ] **Step 2:** run → FAIL. **Step 3: Implémenter** sur le moule `SettingsCustomerDisplayPage.tsx` : 3 champs `type="number"` min=1 max=120 (labels « Warning threshold (minutes) », « Urgent threshold (minutes) », « Ready auto-archive (minutes) », helpers expliquant l'effet POS + « applied to all KDS screens within ~1 min ») ; validation client `warning < urgent` (message inline, save bloqué) ; **ordre de save anti-P0001** : si `urgent` augmente → save urgent puis warning, sinon warning puis urgent, archive en dernier ; gate édition `settings.update` (inputs `disabled`), erreurs serveur affichées.
- [ ] **Step 4:** Route `settings/kds` sous `<PermissionGate required="settings.read">` (modèle customer-display) + lazy import. Tuile hub l.66 → `{ to: '/backoffice/settings/kds', title: 'KDS Configuration', blurb: 'Warning/urgent thresholds + ready auto-archive.', icon: Monitor }` — **plus aucune tuile `planned` : simplifier le rendu ou laisser le mécanisme, mais MAJ le commentaire d'en-tête (l.6-10)**.
- [ ] **Step 5:** run test → PASS ; typecheck BO. **Step 6: Commit** `feat(backoffice): S75 lot 2 — KDS Configuration settings page (hub fully de-Sooned)` puis **PR lot 2** (empilée sur lot 1).

---

### Task 9: Closeout S75

- [ ] `pnpm typecheck && pnpm build` racine → verts.
- [ ] ⚙️ CONTROLLER : re-run des 2 suites pgTAP S75 + spot-check `get_settings_by_category_v1('pos')` (non-régression du regreffage live-body).
- [ ] Agent **pattern-guardian** sur le diff de branche (attendu 14/14 — money-path intouché, append-only OK, REVOKE trio présent).
- [ ] Vérifier `git status` racine : zéro junk file 0-byte (MEMORY gh pr body).
- [ ] Docs (checklist CLAUDE.md fin de session) : CLAUDE.md « In flight »/« Merged (latest) » ; bandeau « ⚠️ Mise à jour S75 » sur `docs/workplan/remise-a-plat/04-kds-kitchen.md` (B1.3 seuils réglables org → 🟠/✅ partiel, §2.3 #4 chips **câblés**, D2.1 partiellement soldé — la part org) et `00-INDEX.md` (§2.3 #4) + note fiche 19 (tuiles Planned livrées) ; INDEX `docs/workplan/plans/2026-07-12-session-75-INDEX.md` (déviations DEV-S75-*, dettes — noter d'office : **D-1 candidate : `reserved` legend POS toujours sans producteur** ; **D-2 : sections POS à icône générique au-delà d'Interior/Terrace**).
- [ ] Commit docs `docs(claude-md): S75 closeout — Floor Plan BO + KDS Configuration livrés`.

## Self-review (fait à la rédaction)
- Spec §3/§4/§5 couverts par T1-T8 ; hors-périmètre respecté (pas d'x/y, pas de prep-times, dispatch_station intouché).
- Cohérence types : `bucketTablesBySection`/`FloorSection` (T4) ; `KdsConfig`/`KDS_CONFIG_DEFAULTS` (T6) ; `KdsItemRow.kds_station` (T7) ; signatures RPC identiques entre T1 (SQL), T3 (hooks BO) et pgTAP.
- Pièges connus adressés : DEV-S57-02 (corps live), DEV-S69-03 (types greffés), MEMORY subagents-sans-MCP (steps ⚙️ CONTROLLER), ordre de save warning/urgent, fixtures mock POS sans `section_id`, vi.hoisted pour les DATA de mock si useEffect deps (MEMORY).
