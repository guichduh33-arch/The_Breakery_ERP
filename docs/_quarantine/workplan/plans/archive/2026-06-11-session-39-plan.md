# Session 39 Implementation Plan — Backoffice Completion Bundle (BO-04 / BO-09 / BO-10 / BO-15)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fermer les 4 stubs backoffice : B2B settings persistant (BO-15, seul chantier DB), Units panel write-mode (BO-09), Costing panel breakdown + correction (BO-10), ProductPicker réel dans EditOrderItemsModal (BO-04).

**Architecture:** Wave A (DB) crée la table singleton `b2b_settings` + 2 RPCs SECURITY DEFINER gated `settings.read`/`settings.update` + pgTAP. Wave B (products) câble `UnitsPanel` sur les tables S27 + `set_product_units_v1`, et crée `CostingPanel` sur `recipe_bom_full_v1` (S17) + `update_cost_price_v1` (S22). Wave C (orders + B2B page) crée le `ProductPicker` (pur front, orchestrateur S33 inchangé) et fait persister `B2BSettingsPage` sur les RPCs Wave A. Wave D : pattern-guardian, sweeps, E2E navigateur, INDEX, PR. Waves B et C parallélisables après A (C2 dépend des types regen Wave A).

**Tech Stack:** Postgres (Supabase cloud V3 dev `ikcyvlovptebroadgtvd` via MCP), React + TanStack Query BO, Vitest, pgTAP, Chrome MCP (E2E).

**Spec:** [`docs/workplan/specs/2026-06-11-session-39-spec.md`](../../specs/archive/2026-06-11-session-39-spec.md)

**Migrations:** NAME-block `20260623000010..012` — vérifier d'abord `list_migrations` (prior max NAME attendu `20260622000016`).

**Conventions transverses (tous les subagents) :**
- Lire CLAUDE.md §Critical patterns avant de coder. RPC versioning monotone ; REVOKE pair canonique S25 ; jamais d'INSERT direct dans les ledgers.
- Imports/style hooks BO : suivre les voisins du même dossier (ex. `features/btob/hooks/useB2bDashboard.ts`, `features/expenses/hooks/useExpenseThresholds.ts`). Client Supabase : même import que le voisin.
- `audit_logs` : vérifier les colonnes réelles avant d'écrire (S27 utilisait `payload`, S28 `metadata` — les deux existent ; utiliser `metadata` pour les nouvelles actions).
- Tests co-localisés `__tests__/` ; data-testid pour les smokes.

---

## Wave A — DB : b2b_settings (subagent `db-engineer`)

### Task A1: Table singleton + seed (migration `_010`)

**Files:**
- Create: `supabase/migrations/20260623000010_create_b2b_settings_table.sql`

- [ ] **Step 1: Vérifier la base** — MCP `list_migrations` : confirmer prior max NAME `20260622000016`. Si différent, adapter et signaler en déviation.

- [ ] **Step 2: Écrire la migration**

```sql
-- 20260623000010_create_b2b_settings_table.sql
-- Session 39 \ Wave A \ Task A1 (BO-15) — table singleton b2b_settings + seed.
-- Ferme la déviation D-W6-B2BSET-01 (S14). Accès uniquement via RPCs SECURITY
-- DEFINER (_011) — RLS enabled sans policy + REVOKE table (pattern S25/S35
-- idempotency tables). Les aging_buckets persistés ne pilotent PAS view_ar_aging
-- (décision utilisateur S39 — refactor déféré).

CREATE TABLE public.b2b_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_payment_terms TEXT NOT NULL DEFAULT 'net_30',
  available_payment_terms JSONB NOT NULL DEFAULT '["cod","net_7","net_14","net_30","net_60"]',
  critical_overdue_days INT NOT NULL DEFAULT 30 CHECK (critical_overdue_days BETWEEN 1 AND 365),
  aging_buckets JSONB NOT NULL DEFAULT '[{"label":"Current","min":0,"max":30},{"label":"Overdue","min":31,"max":60},{"label":"Critical","min":61,"max":null}]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL REFERENCES public.user_profiles(id)
);

COMMENT ON TABLE public.b2b_settings IS
  'S39 BO-15 — singleton (id=1). Réglages B2B globaux. Accès via get/update_b2b_settings_v1 uniquement. aging_buckets ne pilote pas (encore) view_ar_aging.';

INSERT INTO public.b2b_settings (id) VALUES (1);

ALTER TABLE public.b2b_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.b2b_settings FROM PUBLIC;
REVOKE ALL ON TABLE public.b2b_settings FROM anon;
REVOKE ALL ON TABLE public.b2b_settings FROM authenticated;
```

- [ ] **Step 3: Appliquer** — MCP `apply_migration` (project_id `ikcyvlovptebroadgtvd`, name `create_b2b_settings_table`).

- [ ] **Step 4: Vérification immédiate** — MCP `execute_sql` :

```sql
SELECT count(*) AS rows FROM b2b_settings;                                   -- attendu : 1
SELECT has_table_privilege('authenticated', 'public.b2b_settings', 'SELECT') AS auth_sel,
       has_table_privilege('anon', 'public.b2b_settings', 'SELECT') AS anon_sel;  -- attendu : false / false
```

- [ ] **Step 5: Commit** — `git add supabase/migrations/20260623000010_*.sql && git commit -m "feat(db): session 39 — wave A1 — b2b_settings singleton table (BO-15)"`

### Task A2: RPCs get/update (migration `_011`)

**Files:**
- Create: `supabase/migrations/20260623000011_create_b2b_settings_rpcs.sql`

- [ ] **Step 1: Écrire la migration**

```sql
-- 20260623000011_create_b2b_settings_rpcs.sql
-- Session 39 \ Wave A \ Task A2 (BO-15) — get_b2b_settings_v1 + update_b2b_settings_v1.
-- Gates : settings.read / settings.update (existantes depuis 20260517000030 —
-- aucune nouvelle permission seedée). Patch partiel ; validations strictes ;
-- audit b2b_settings.updated (metadata old/new).

CREATE OR REPLACE FUNCTION public.get_b2b_settings_v1()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_row JSONB;
BEGIN
  IF NOT has_permission(v_uid, 'settings.read') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  SELECT to_jsonb(s.*) INTO v_row FROM b2b_settings s WHERE s.id = 1;
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'b2b_settings_missing' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_b2b_settings_v1(p_patch JSONB)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_old       b2b_settings%ROWTYPE;
  v_terms     JSONB;
  v_default   TEXT;
  v_overdue   INT;
  v_buckets   JSONB;
  v_b         JSONB;
  v_prev_max  INT := NULL;
  v_i         INT := 0;
  v_n         INT;
  v_allowed   TEXT[] := ARRAY['default_payment_terms','available_payment_terms','critical_overdue_days','aging_buckets'];
  v_k         TEXT;
BEGIN
  IF NOT has_permission(v_uid, 'settings.update') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'patch_must_be_object' USING ERRCODE = 'P0001';
  END IF;
  FOR v_k IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_k <> ALL(v_allowed) THEN
      RAISE EXCEPTION 'unknown_settings_key: %', v_k USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  SELECT * INTO v_old FROM b2b_settings WHERE id = 1 FOR UPDATE;

  -- merge patch -> valeurs candidates
  v_default := COALESCE(p_patch->>'default_payment_terms', v_old.default_payment_terms);
  v_terms   := COALESCE(p_patch->'available_payment_terms', v_old.available_payment_terms);
  v_overdue := COALESCE((p_patch->>'critical_overdue_days')::INT, v_old.critical_overdue_days);
  v_buckets := COALESCE(p_patch->'aging_buckets', v_old.aging_buckets);

  -- available_payment_terms : array non vide de TEXT uniques
  IF jsonb_typeof(v_terms) <> 'array' OR jsonb_array_length(v_terms) = 0 THEN
    RAISE EXCEPTION 'available_payment_terms_must_be_nonempty_array' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_terms) e WHERE jsonb_typeof(e.value) <> 'string') THEN
    RAISE EXCEPTION 'available_payment_terms_must_be_strings' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*), count(DISTINCT e.value) INTO v_n, v_i FROM jsonb_array_elements_text(v_terms) e;
  IF v_n <> v_i THEN
    RAISE EXCEPTION 'available_payment_terms_must_be_unique' USING ERRCODE = 'P0001';
  END IF;

  -- default ∈ available
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_terms) e WHERE e.value = v_default) THEN
    RAISE EXCEPTION 'default_payment_terms_not_in_available: %', v_default USING ERRCODE = 'P0001';
  END IF;

  -- critical_overdue_days 1..365 (le CHECK table couvre aussi, mais message clair ici)
  IF v_overdue IS NULL OR v_overdue < 1 OR v_overdue > 365 THEN
    RAISE EXCEPTION 'critical_overdue_days_out_of_range: %', v_overdue USING ERRCODE = 'P0001';
  END IF;

  -- aging_buckets : array non vide, objets {label, min, max}, contigus, dernier max=null
  IF jsonb_typeof(v_buckets) <> 'array' OR jsonb_array_length(v_buckets) = 0 THEN
    RAISE EXCEPTION 'aging_buckets_must_be_nonempty_array' USING ERRCODE = 'P0001';
  END IF;
  v_n := jsonb_array_length(v_buckets);
  v_i := 0;
  v_prev_max := NULL;
  FOR v_b IN SELECT * FROM jsonb_array_elements(v_buckets) LOOP
    v_i := v_i + 1;
    IF jsonb_typeof(v_b) <> 'object'
       OR COALESCE(btrim(v_b->>'label'), '') = ''
       OR v_b->>'min' IS NULL THEN
      RAISE EXCEPTION 'aging_bucket_%_invalid_shape', v_i USING ERRCODE = 'P0001';
    END IF;
    IF v_i = 1 AND (v_b->>'min')::INT <> 0 THEN
      RAISE EXCEPTION 'aging_bucket_first_min_must_be_0' USING ERRCODE = 'P0001';
    END IF;
    IF v_i > 1 AND (v_b->>'min')::INT <> v_prev_max + 1 THEN
      RAISE EXCEPTION 'aging_buckets_not_contiguous_at_%', v_i USING ERRCODE = 'P0001';
    END IF;
    IF v_i < v_n THEN
      IF v_b->'max' IS NULL OR jsonb_typeof(v_b->'max') = 'null' THEN
        RAISE EXCEPTION 'aging_bucket_%_max_required_before_last', v_i USING ERRCODE = 'P0001';
      END IF;
      IF (v_b->>'max')::INT < (v_b->>'min')::INT THEN
        RAISE EXCEPTION 'aging_bucket_%_max_lt_min', v_i USING ERRCODE = 'P0001';
      END IF;
      v_prev_max := (v_b->>'max')::INT;
    ELSE
      IF v_b->'max' IS NOT NULL AND jsonb_typeof(v_b->'max') <> 'null' THEN
        RAISE EXCEPTION 'aging_bucket_last_max_must_be_null' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;

  UPDATE b2b_settings SET
    default_payment_terms   = v_default,
    available_payment_terms = v_terms,
    critical_overdue_days   = v_overdue,
    aging_buckets           = v_buckets,
    updated_at              = now(),
    updated_by              = v_uid
  WHERE id = 1;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_uid, 'b2b_settings.updated', 'b2b_settings', NULL,
          jsonb_build_object('old', to_jsonb(v_old), 'patch', p_patch));

  RETURN (SELECT to_jsonb(s.*) FROM b2b_settings s WHERE s.id = 1);
END;
$$;

COMMENT ON FUNCTION public.get_b2b_settings_v1() IS
  'S39 BO-15 — lecture singleton b2b_settings. Gate settings.read.';
COMMENT ON FUNCTION public.update_b2b_settings_v1(JSONB) IS
  'S39 BO-15 — patch partiel singleton b2b_settings. Gate settings.update. Validations : terms uniques non vides, default ∈ available, overdue 1..365, buckets contigus (first min=0, last max=null). Audit b2b_settings.updated.';
```

> Note : `audit_logs.entity_id` est UUID — `b2b_settings.id` est SMALLINT, donc `entity_id = NULL` et l'identité passe par `entity_type` (singleton). Vérifier que `entity_id` est nullable (précédent : DEV-S19-1.B-01 rows avec entity_id NULL). Si NOT NULL, utiliser `gen_random_uuid()` constant documenté ou la colonne `payload` — signaler en déviation.

- [ ] **Step 2: Appliquer** — MCP `apply_migration` (name `create_b2b_settings_rpcs`).

- [ ] **Step 3: Vérification immédiate** — MCP `execute_sql` (en service_role, hors gate) :

```sql
SELECT public.get_b2b_settings_v1();  -- attendu : P0003 (auth.uid() NULL n'a pas la perm) OU row si service bypass — vérifier juste que la fonction existe et compile
SELECT proname, provolatile FROM pg_proc WHERE proname IN ('get_b2b_settings_v1','update_b2b_settings_v1');  -- 2 rows
```

- [ ] **Step 4: Commit** — `git commit -m "feat(db): session 39 — wave A2 — get/update_b2b_settings_v1 RPCs (BO-15)"`

### Task A3: REVOKE pair canonique (migration `_012`)

**Files:**
- Create: `supabase/migrations/20260623000012_revoke_pair_b2b_settings_rpcs.sql`

- [ ] **Step 1: Écrire la migration**

```sql
-- 20260623000012_revoke_pair_b2b_settings_rpcs.sql
-- Session 39 \ Wave A \ Task A3 — REVOKE pair canonique S25 sur les 2 RPCs BO-15.

REVOKE ALL ON FUNCTION public.get_b2b_settings_v1() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_b2b_settings_v1() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_b2b_settings_v1() TO authenticated;

REVOKE ALL ON FUNCTION public.update_b2b_settings_v1(JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_b2b_settings_v1(JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_b2b_settings_v1(JSONB) TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 2: Appliquer + vérifier** — MCP `apply_migration` puis `execute_sql` :

```sql
SELECT has_function_privilege('anon', 'public.get_b2b_settings_v1()', 'EXECUTE') AS g_anon,
       has_function_privilege('anon', 'public.update_b2b_settings_v1(jsonb)', 'EXECUTE') AS u_anon,
       has_function_privilege('authenticated', 'public.get_b2b_settings_v1()', 'EXECUTE') AS g_auth,
       has_function_privilege('authenticated', 'public.update_b2b_settings_v1(jsonb)', 'EXECUTE') AS u_auth;
-- attendu : false / false / true / true
```

- [ ] **Step 3: Commit** — `git commit -m "feat(db): session 39 — wave A3 — REVOKE pair b2b_settings RPCs"`

### Task A4: Types regen

- [ ] **Step 1:** MCP `generate_typescript_types` → écrire dans `packages/supabase/src/types.generated.ts`.
- [ ] **Step 2:** `pnpm --filter @breakery/supabase typecheck` (ou `pnpm typecheck`) → PASS.
- [ ] **Step 3: Commit** — `git commit -m "chore(supabase): session 39 — types regen post b2b_settings"`

### Task A5: pgTAP `b2b_settings.test.sql`

**Files:**
- Create: `supabase/tests/b2b_settings.test.sql`

- [ ] **Step 1: Écrire la suite** (10 tests, pattern GUC S25 pour chaîner les DO blocks ; users de test : réutiliser les fixtures des suites récentes — voir `supabase/tests/order_discount_gate.test.sql` pour le setup caller MANAGER vs CASHIER via `request.jwt.claims`) :
  - T1 : caller avec `settings.read` → `get_b2b_settings_v1()` retourne le singleton (clés présentes).
  - T2 : caller sans perm → P0003.
  - T3 : caller avec `settings.update` → update happy (patch complet) ; row modifiée ; `updated_by` = caller.
  - T4 : caller sans `settings.update` → P0003.
  - T5 : `default_payment_terms` ∉ available → P0001.
  - T6 : buckets non contigus (`[{0..30},{32..null}]`) → P0001.
  - T7 : `critical_overdue_days = 0` → P0001.
  - T8 : patch partiel `{"critical_overdue_days": 45}` ne modifie pas les autres colonnes.
  - T9 : `has_function_privilege` anon/PUBLIC = false sur les 2 RPCs.
  - T10 : audit row `action='b2b_settings.updated'` créée par T3.
- [ ] **Step 2: Exécuter** — MCP `execute_sql` avec envelope `BEGIN; ... ROLLBACK;` → 10/10 PASS. Itérer si FAIL.
- [ ] **Step 3: Commit** — `git commit -m "test(db): session 39 — wave A5 — pgTAP b2b_settings 10/10"`

---

## Wave B — Products : Units + Costing (subagent `backoffice-specialist`) — après A4 (pas de dépendance types pour B, mais sweep final commun)

### Task B1: UnitsPanel write-mode (BO-09)

**Files:**
- Create: `apps/backoffice/src/features/products/hooks/useProductUnits.ts`
- Create: `apps/backoffice/src/features/products/hooks/useSetProductUnits.ts`
- Modify: `apps/backoffice/src/features/products/components/UnitsPanel.tsx` (réécriture controlled)
- Modify: `apps/backoffice/src/pages/products/ProductDetailPage.tsx` (passer productId/baseUnit au panel si pas déjà fait)
- Create: `apps/backoffice/src/features/products/__tests__/units-panel-write.smoke.test.tsx`

- [ ] **Step 1: Hook lecture**

```typescript
// useProductUnits.ts — lit les vraies tables S27.
// Shape retournée alignée sur le payload de set_product_units_v1.
import { useQuery } from '@tanstack/react-query';
// import du client supabase : suivre le voisin (ex. useProductDetail.ts)

export interface ProductUnitAlt {
  code: string;
  factor_to_base: number;
  tags: string[];
  display_order: number;
}
export interface ProductUnitContexts {
  stock_opname_unit: string;
  recipe_unit: string;
  purchase_unit: string;
  sales_unit: string;
}

export function useProductUnits(productId: string) {
  return useQuery({
    queryKey: ['product-units', productId],
    queryFn: async () => {
      const [alts, ctx] = await Promise.all([
        supabase.from('product_unit_alternatives')
          .select('code, factor_to_base, tags, display_order')
          .eq('product_id', productId).is('deleted_at', null)
          .order('display_order'),
        supabase.from('product_unit_contexts')
          .select('stock_opname_unit, recipe_unit, purchase_unit, sales_unit')
          .eq('product_id', productId).maybeSingle(),
      ]);
      if (alts.error) throw alts.error;
      if (ctx.error) throw ctx.error;
      return { alternatives: (alts.data ?? []) as ProductUnitAlt[], contexts: ctx.data as ProductUnitContexts | null };
    },
    enabled: !!productId,
  });
}
```

> ⚠️ Si le SELECT direct sur ces tables échoue en `authenticated` (REVOKE S20), basculer la lecture sur une approche RPC n'est PAS prévu — vérifier d'abord avec un appel réel : ces tables sont lisibles (le POS/BO lisent `products` en direct ; les tables S27 ont des GRANTs RLS read seedés S27). Si bloqué → déviation + lecture via `update`-RPC return shape en fallback.

- [ ] **Step 2: Hook écriture**

```typescript
// useSetProductUnits.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';

export function useSetProductUnits(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { alts: ProductUnitAlt[]; contexts: ProductUnitContexts }) => {
      const { data, error } = await supabase.rpc('set_product_units_v1', {
        p_product_id: productId,
        p_alts: payload.alts,
        p_contexts: payload.contexts,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['product-units', productId] }); },
  });
}
```

- [ ] **Step 3: Réécrire UnitsPanel** — controlled : draft state initialisé depuis `useProductUnits` (useEffect re-sync on data change, pattern GeneralPanel) ; supprimer `SAMPLE_ALT_UNITS` ; liste alts éditable (code TEXT, factor NUMERIC > 0, bouton add row, bouton remove row — `display_order` = index × 10, `tags` préservés tels quels si présents sinon `[]`) ; 4 selects contexts avec options = `[baseUnit, ...draftAlts.map(a => a.code)]` ; dirty flag (deep compare draft vs server data) ; Save button : disabled si !dirty ou invalid (code vide, factor <= 0, code dupliqué) ; perm gate `products.units.update` via `useAuthStore hasPermission` (pas de Save visible sans perm, inputs disabled) ; loading/error states ; toast on success (suivre le pattern toast du dossier).

- [ ] **Step 4: Smoke test**

```typescript
// units-panel-write.smoke.test.tsx — 3 cas :
// T1 : render avec mock query (2 alts réelles) → les codes s'affichent, pas de SAMPLE data.
// T2 : edit factor → Save enabled → click → supabase.rpc('set_product_units_v1', payload complet
//      avec TOUTES les alts du draft (REPLACE semantics)) appelé.
// T3 : sans perm products.units.update → inputs disabled, pas de bouton Save actif.
// Mock : vi.mock du module client supabase comme les smokes voisins (product-detail-save.smoke.test.tsx).
```

- [ ] **Step 5: Run** — `pnpm --filter @breakery/app-backoffice test units-panel-write` → PASS. Non-régression : `pnpm --filter @breakery/app-backoffice test product` → PASS.

- [ ] **Step 6: Commit** — `git commit -m "feat(backoffice): session 39 — wave B1 — UnitsPanel write-mode via set_product_units_v1 (BO-09)"`

### Task B2: CostingPanel (BO-10)

**Files:**
- Create: `apps/backoffice/src/features/products/hooks/useRecipeBomFull.ts`
- Create: `apps/backoffice/src/features/products/hooks/useCorrectCostPrice.ts`
- Create: `apps/backoffice/src/features/products/components/CostingPanel.tsx`
- Create: `apps/backoffice/src/features/products/components/CorrectCostDialog.tsx`
- Modify: `apps/backoffice/src/pages/products/ProductDetailPage.tsx:127-132` (remplacer le StubPanel costing)
- Create: `apps/backoffice/src/features/products/__tests__/costing-panel.smoke.test.tsx`

- [ ] **Step 1: Hooks**

```typescript
// useRecipeBomFull.ts — RPC S17 (TABLE flat : material_id, material_name,
// material_unit, qty_per_unit, current_stock, cost_price). Gate inventory.read.
export function useRecipeBomFull(productId: string) {
  return useQuery({
    queryKey: ['recipe-bom-full', productId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('recipe_bom_full_v1', { p_product_id: productId });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!productId,
  });
}

// useCorrectCostPrice.ts — RPC S22, idempotency flavor 2 (S25) : useRef(crypto.randomUUID()),
// reset après success/dismiss.
export function useCorrectCostPrice(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { newCost: number; reason: string; idempotencyKey: string }) => {
      const { data, error } = await supabase.rpc('update_cost_price_v1', {
        p_product_id: productId,
        p_new_cost: input.newCost,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
      });
      if (error) throw error;
      return data; // { movement_id, old_cost, new_cost, idempotent_replay }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['product-detail', productId] }); // vérifier la queryKey réelle de useProductDetail
    },
  });
}
```

- [ ] **Step 2: CostingPanel** — 3 header cards (Current cost WAC = `product.cost_price`, Retail = `product.retail_price`, Margin % = `retail > 0 ? ((retail - cost) / retail * 100) : null` affiché `—` si null) ; section breakdown : si `useRecipeBomFull` retourne ≥ 1 row → table (Ingredient, Qty/unit, Unit, Unit cost, Line cost = qty × cost) + footer Total BOM cost ; si 0 rows → EmptyState « No recipe — cost is purchase-driven (WAC) » ; bouton « Correct cost price » gated `inventory.cost_correction` ouvrant `CorrectCostDialog`. Formats IDR `toLocaleString('id-ID')`.

- [ ] **Step 3: CorrectCostDialog** — controlled dialog (pattern des dialogs du dossier, ex. ConvertToParentDialog) : input new cost (number > 0 requis), textarea reason (≥ 5 chars requis), affiche old cost ; submit → `useCorrectCostPrice` avec `idempotencyKeyRef.current` ; success → toast `old → new`, reset key, close ; error → message inline.

- [ ] **Step 4: Wiring ProductDetailPage** — remplacer le `<StubPanel title="Costing arrives later" …/>` par `<CostingPanel product={product} />` (les stubs `purchase`/`history` restent).

- [ ] **Step 5: Smoke test**

```typescript
// costing-panel.smoke.test.tsx — 3 cas :
// T1 : header cards rendent cost/retail/margin depuis le mock product.
// T2 : mock BOM 2 ingrédients → table 2 rows + total.
// T3 : dialog : fill cost+reason → submit → supabase.rpc('update_cost_price_v1',
//      payload avec p_idempotency_key UUID et p_reason) appelé.
```

- [ ] **Step 6: Run** — `pnpm --filter @breakery/app-backoffice test costing-panel` → PASS.

- [ ] **Step 7: Commit** — `git commit -m "feat(backoffice): session 39 — wave B2 — CostingPanel breakdown + cost correction (BO-10)"`

---

## Wave C — Orders + B2B page (subagent `backoffice-specialist` #2) — C1 indépendant ; C2 après Task A4 (types)

### Task C1: ProductPicker pour EditOrderItemsModal (BO-04)

**Files:**
- Create: `apps/backoffice/src/features/orders/hooks/useProductsForOrderEdit.ts`
- Create: `apps/backoffice/src/features/orders/components/ProductPicker.tsx`
- Modify: `apps/backoffice/src/features/orders/components/EditOrderItemsModal.tsx`
- Create: `apps/backoffice/src/features/orders/__tests__/product-picker.smoke.test.tsx`

- [ ] **Step 1: Hook produits**

```typescript
// useProductsForOrderEdit.ts — produits vendables pour l'édition d'ordre BO.
// Exclusion des parents : un produit référencé comme parent_product_id par un
// autre produit actif de la liste est un parent → exclu (même règle métier que
// le POS S27c : un parent ne se vend pas directement). Edge accepté : parent
// dont TOUS les variants sont inactifs reste listé (documenter en déviation si rencontré).
export interface OrderEditProduct {
  id: string;
  sku: string;
  name: string;
  retail_price: number;
  variant_label: string | null;
}

export function useProductsForOrderEdit() {
  return useQuery({
    queryKey: ['products-for-order-edit'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('id, sku, name, retail_price, variant_label, parent_product_id')
        .eq('is_active', true)
        .eq('available_for_sale', true)
        .order('name');
      if (error) throw error;
      const rows = data ?? [];
      const parentIds = new Set(rows.map(r => r.parent_product_id).filter(Boolean));
      return rows.filter(r => !parentIds.has(r.id)) as OrderEditProduct[];
    },
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: ProductPicker**

```typescript
// ProductPicker.tsx — search input (filtre client-side name+SKU, lowercase
// includes) + liste compacte scrollable. onPick(product) remonte au modal.
// data-testid : picker-search, picker-row-<id>.
interface Props { onPick: (p: OrderEditProduct) => void }
// render : input search ; liste filtrée (name + variant_label en suffixe,
// SKU mono, prix toLocaleString('id-ID')) ; bouton row entier clickable ;
// états loading / error / empty (« No products match »).
```

- [ ] **Step 3: Wiring EditOrderItemsModal** — remplacer le placeholder (lignes 99-103) par `<ProductPicker onPick={handlePick} />` :

```typescript
// Ajouts au modal :
// - state addedMeta: Record<string, { name: string; retail_price: number }>
//   (enrichissement local du preview — OrderEditDiff et l'orchestrateur S33 INCHANGÉS).
const handlePick = (p: OrderEditProduct) => {
  setAddedMeta((m) => ({ ...m, [p.id]: { name: p.name, retail_price: p.retail_price } }));
  setDiff((d) => {
    const existing = d.adds.find((a) => a.product_id === p.id);
    if (existing) {
      return { ...d, adds: d.adds.map((a) => a.product_id === p.id ? { ...a, qty: a.qty + 1 } : a) };
    }
    return { ...d, adds: [...d.adds, { product_id: p.id, qty: 1 }] };
  });
};
// previewLines pending : name_snapshot = addedMeta[a.product_id]?.name ?? '(new item)',
// unit_price = addedMeta[a.product_id]?.retail_price ?? 0, line_total = qty * unit_price.
// Garder la mention « Tax + total recalculated server-side at apply » (le prix réel
// peut différer — category pricing server-side).
// Reset addedMeta avec diff dans handleApply success + onClose.
// Les qty inputs des pending rows doivent éditer diff.adds (pas diff.updates) :
// brancher handleUpdateQty sur isPending → update adds.
```

- [ ] **Step 4: Smoke test**

```typescript
// product-picker.smoke.test.tsx — 3 cas :
// T1 : search "croiss" filtre la liste (mock 3 produits dont 1 parent → parent absent).
// T2 : click row → onPick remonte le produit / dans le modal : diff.adds contient
//      {product_id, qty: 1} et le preview affiche le nom + prix.
// T3 : double pick même produit → qty 2 (pas de doublon).
```

- [ ] **Step 5: Run** — `pnpm --filter @breakery/app-backoffice test product-picker` PASS + non-régression `pnpm --filter @breakery/app-backoffice test orders` PASS (le smoke S33 EditOrderItemsModal existant ne doit pas casser).

- [ ] **Step 6: Commit** — `git commit -m "feat(backoffice): session 39 — wave C1 — ProductPicker réel dans EditOrderItemsModal (BO-04)"`

### Task C2: B2BSettingsPage persist (BO-15 front) — requiert types Wave A4

**Files:**
- Create: `apps/backoffice/src/features/btob/hooks/useB2bSettings.ts`
- Create: `apps/backoffice/src/features/btob/hooks/useUpdateB2bSettings.ts`
- Modify: `apps/backoffice/src/pages/btob/B2BSettingsPage.tsx`
- Modify: `apps/backoffice/src/__tests__/btob-settings.smoke.test.tsx`
- Modify (léger): `apps/backoffice/src/features/btob/components/CreateB2bOrderModal.tsx` (pré-remplissage payment terms SEULEMENT si le modal a déjà un champ terms — sinon no-op + déviation)

- [ ] **Step 1: Hooks**

```typescript
// useB2bSettings.ts
export interface B2bSettings {
  default_payment_terms: string;
  available_payment_terms: string[];
  critical_overdue_days: number;
  aging_buckets: Array<{ label: string; min: number; max: number | null }>;
}
export function useB2bSettings() {
  return useQuery({
    queryKey: ['b2b-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_b2b_settings_v1');
      if (error) throw error;
      return data as unknown as B2bSettings;
    },
  });
}

// useUpdateB2bSettings.ts
export function useUpdateB2bSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<B2bSettings>) => {
      const { data, error } = await supabase.rpc('update_b2b_settings_v1', { p_patch: patch });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['b2b-settings'] }); },
  });
}
```

- [ ] **Step 2: Page** — initialiser les 4 states depuis `useB2bSettings` (useEffect re-sync, pattern GeneralPanel draft) ; **supprimer le banner « Read-only preview » (lignes 107-109) + le commentaire SCOPE du header** ; ajouter dirty flag + footer Save bar (Save disabled si !dirty ou mutation pending ; visible seulement si `hasPermission('settings.update')`) ; submit → `useUpdateB2bSettings` avec le patch complet des 4 clés ; success toast ; error → message inline (les messages P0001 server sont explicites : les afficher) ; loading state pendant le fetch initial. Les buckets gardent leur `id` local pour le rendu mais le payload envoie `{label, min, max}` uniquement.

- [ ] **Step 3: Smoke update** — réécrire `btob-settings.smoke.test.tsx` :

```typescript
// T1 : mock get_b2b_settings_v1 → la page affiche les valeurs serveur (pas les SEED hardcodés).
// T2 : edit threshold → Save → rpc('update_b2b_settings_v1', { p_patch }) appelé avec les 4 clés.
// T3 : le banner « Read-only preview » n'existe plus (queryByText → null).
```

- [ ] **Step 4: Run** — `pnpm --filter @breakery/app-backoffice test btob` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(backoffice): session 39 — wave C2 — B2BSettingsPage persiste via b2b_settings RPCs (BO-15)"`

---

## Wave D — Closeout (lead + `pattern-guardian` + `test-engineer`)

### Task D1: Revue pattern-guardian

- [ ] Dispatch `pattern-guardian` (read-only) sur le diff `master..swarm/session-39` → 0 violation des Critical patterns (REVOKE pairs, anon defense-in-depth, idempotency flavors, append-only ledgers, domain IO-free). Corriger si findings.

### Task D2: Sweeps + typecheck

- [ ] `pnpm --filter @breakery/domain test` → PASS (non-régression, S39 ne touche pas domain).
- [ ] `pnpm --filter @breakery/ui test` → PASS.
- [ ] `pnpm --filter @breakery/app-pos test` → PASS.
- [ ] `pnpm --filter @breakery/app-backoffice test` → PASS (baseline env-gated connue : 13 fichiers `VITE_SUPABASE_URL Required` pré-existants — ne pas confondre avec une régression).
- [ ] `pnpm typecheck` → 6/6 PASS.

### Task D3: E2E navigateur (Chrome MCP, BO dev server)

- [ ] `pnpm --filter @breakery/app-backoffice dev` + login BO.
- [ ] Parcours 1 — ProductDetail → Units : éditer un factor → Save → reload → persisté.
- [ ] Parcours 2 — ProductDetail → Costing : cards + breakdown rendus ; ouvrir le dialog correction → soumettre (produit de test) → toast old→new ; vérifier `stock_movements` row `cost_price_correction` via MCP `execute_sql`.
- [ ] Parcours 3 — Orders → EditOrderItems sur un ordre draft/open : search → add produit → Apply → totaux recalculés.
- [ ] Parcours 4 — B2B Settings : éditer threshold + un bucket → Save → reload page → valeurs conservées ; banner absent.
- [ ] Captures d'écran des 4 parcours.

### Task D4: INDEX + CLAUDE.md + PR

- [ ] Remplir `docs/workplan/plans/2026-06-11-session-39-INDEX.md` (status, déviations, hors scope S40+).
- [ ] CLAUDE.md §Active Workplan : bump S39 (+ migration ledger `20260623000010..012`).
- [ ] `git push -u origin swarm/session-39` + `gh pr create` vers `master` (body : résumé waves + tests + déviations).
