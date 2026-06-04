# Session 29 — Reports Export + Z-Report PDF (Vague A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer la Vague A du module Reports — Z-Report PDF signable au close_shift (compliance 7 ans), helper CSV centralisé + boutons CSV/PDF sur 13 pages reports, EF `generate-pdf` générique (12 templates), comparison vs previous period sur 5 reports finance/sales.

**Architecture:** Schema `z_reports` append-only avec snapshot JSONB figé au close_shift, flow 2-temps (close_shift_v2 crée draft → EF génère PDF async → manager signe via PIN-en-header). Helper domain `csv.ts` + `period.ts` IO-free testés Vitest. EF Deno avec `pdf-lib` (pure, pas de Chromium), 12 templates dans `_shared/pdf-templates/`. 2 buckets Storage : `zreports/` (7 ans) + `reports-exports/` (TTL 30j). Comparison front-end 2 fetches React-Query parallèles, pas de bump RPC.

**Tech Stack:** PostgreSQL (Supabase cloud `ikcyvlovptebroadgtvd`), Deno (Edge Functions), `pdf-lib@1.17.1` via esm.sh, TypeScript (monorepo pnpm/turbo), React 18 + Tailwind + Radix (BO), React-Query v5, Vitest, pgTAP.

**Spec:** [`../specs/2026-05-24-session-29-spec.md`](../../specs/archive/2026-05-24-session-29-spec.md)

**Branche cible:** `swarm/session-29` (à créer depuis `master` @ `66f77d6`)

**Migration block:** `20260606000010..035`

---

## Wave 0 — Branch + Spec commit

### Task 0.1 : Créer la branche + commit spec

**Files:**
- Existing: `docs/workplan/specs/2026-05-24-session-29-spec.md` (déjà écrit)

- [ ] **Step 1: Créer la branche depuis master**

```bash
git checkout master && git pull origin master
git checkout -b swarm/session-29
```

Expected: branch `swarm/session-29` créée à partir de `66f77d6`.

- [ ] **Step 2: Commit le spec doc**

```bash
git add docs/workplan/specs/2026-05-24-session-29-spec.md
git commit -m "$(cat <<'EOF'
docs(s29): wave 0 — session 29 spec (Vague A: Reports Export + Z-Report PDF)

Closes TASK-14-005 (compare toggle), TASK-12-002 (Z-Report PDF), gap 14-3 (CSV/PDF uniforme).
Plan multi-sessions: docs/workplan/plans/2026-05-19-S24-to-S30-plan.md §S29.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: 1 commit, working tree clean.

---

## Wave 1 — DB (table + RPCs + storage + perms)

> Stream DB. Peut runner en parallèle avec Wave 2 (Domain). Toutes les migrations passent par `mcp__plugin_supabase_supabase__apply_migration` sur project_id `ikcyvlovptebroadgtvd`.

### Task 1.1 : Migration `_010` — ENUM `z_report_status`

**Files:**
- Create: `supabase/migrations/20260606000010_create_enum_z_report_status.sql`

- [ ] **Step 1: Créer le fichier migration**

```sql
-- 20260606000010_create_enum_z_report_status.sql
-- S29 Wave 1.1 — ENUM des status Z-Report.
CREATE TYPE z_report_status AS ENUM ('draft', 'signed', 'voided');

COMMENT ON TYPE z_report_status IS
  'S29 : status d''un Z-Report. draft = créé au close_shift, signed = signé par manager via PIN, voided = invalidé admin avec reason.';
```

- [ ] **Step 2: Apply via MCP**

```
mcp__plugin_supabase_supabase__apply_migration
project_id: ikcyvlovptebroadgtvd
name: create_enum_z_report_status
query: <SQL ci-dessus>
```

Expected: success, ENUM créé. Verify via `mcp__plugin_supabase_supabase__execute_sql` :
```sql
SELECT enumlabel FROM pg_enum
WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'z_report_status')
ORDER BY enumsortorder;
```
Expected: 3 rows `draft`, `signed`, `voided`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260606000010_create_enum_z_report_status.sql
git commit -m "feat(db): session 29 — wave 1.1 — create ENUM z_report_status"
```

### Task 1.2 : Migration `_011` — Table `z_reports`

**Files:**
- Create: `supabase/migrations/20260606000011_create_table_z_reports.sql`

- [ ] **Step 1: Créer le fichier migration**

```sql
-- 20260606000011_create_table_z_reports.sql
-- S29 Wave 1.2 — table z_reports (append-only metadata, signature via UPDATE RPC).
CREATE TABLE z_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id            UUID NOT NULL REFERENCES pos_sessions(id) ON DELETE RESTRICT,
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  signed_at           TIMESTAMPTZ NULL,
  signed_by           UUID NULL REFERENCES user_profiles(id),
  voided_at           TIMESTAMPTZ NULL,
  voided_by           UUID NULL REFERENCES user_profiles(id),
  void_reason         TEXT NULL,
  pdf_storage_path    TEXT NULL,
  status              z_report_status NOT NULL DEFAULT 'draft',
  snapshot            JSONB NOT NULL,
  CONSTRAINT uniq_zreport_shift UNIQUE (shift_id),
  CONSTRAINT zreport_status_signed_consistency CHECK (
    (status = 'signed') = (signed_at IS NOT NULL AND signed_by IS NOT NULL)
  ),
  CONSTRAINT zreport_status_voided_consistency CHECK (
    (status = 'voided') = (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL AND length(void_reason) >= 10)
  )
);

CREATE INDEX idx_zreports_shift ON z_reports (shift_id);
CREATE INDEX idx_zreports_status_generated ON z_reports (status, generated_at DESC);

ALTER TABLE z_reports ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON z_reports FROM authenticated, anon, PUBLIC;
GRANT SELECT ON z_reports TO authenticated;

CREATE POLICY zreports_select_auth ON z_reports
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE z_reports IS
  'S29 : Z-Report archive 7 ans (compliance ID). UNIQUE(shift_id) = un Z-Report par shift. Snapshot figé au close_shift. Status draft → signed (PIN manager) | voided (admin avec reason).';
COMMENT ON COLUMN z_reports.snapshot IS
  'JSONB figé au close_shift : period_start, period_end, opening_cash, closing_cash_expected, closing_cash_counted, variance, totals_by_payment_method, sales_total, refunds_total, voids_total, top_products[], expenses_cash_total, ...';
```

- [ ] **Step 2: Apply via MCP** (name = `create_table_z_reports`)

- [ ] **Step 3: Verify**

```sql
SELECT count(*) FROM information_schema.tables WHERE table_name = 'z_reports';
SELECT count(*) FROM information_schema.columns WHERE table_name = 'z_reports';
SELECT relrowsecurity FROM pg_class WHERE relname = 'z_reports';
```
Expected: 1, 11, true.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260606000011_create_table_z_reports.sql
git commit -m "feat(db): session 29 — wave 1.2 — create table z_reports (append-only, snapshot JSONB, RLS)"
```

### Task 1.3 : Migration `_012` — Storage buckets

**Files:**
- Create: `supabase/migrations/20260606000012_create_storage_buckets_zreports_and_exports.sql`

- [ ] **Step 1: Créer le fichier migration**

```sql
-- 20260606000012_create_storage_buckets_zreports_and_exports.sql
-- S29 Wave 1.3 — Storage buckets pour Z-Report (7 ans) + exports user-triggered (TTL 30j).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('zreports',        'zreports',        false, 10485760, ARRAY['application/pdf']),
  ('reports-exports', 'reports-exports', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

COMMENT ON COLUMN storage.buckets.id IS
  'S29 : zreports = 7 ans retention compliance ID ; reports-exports = TTL 30j PDF user-triggered régénérables.';
```

- [ ] **Step 2: Apply via MCP** (name = `create_storage_buckets_zreports_and_exports`)

- [ ] **Step 3: Verify**

```sql
SELECT id, public, file_size_limit FROM storage.buckets WHERE id IN ('zreports', 'reports-exports');
```
Expected: 2 rows, both `public=false`, both `file_size_limit=10485760`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260606000012_create_storage_buckets_zreports_and_exports.sql
git commit -m "feat(db): session 29 — wave 1.3 — create storage buckets zreports/ + reports-exports/"
```

### Task 1.4 : Migration `_013` — Storage policies

**Files:**
- Create: `supabase/migrations/20260606000013_create_storage_policies_zreports_and_exports.sql`

- [ ] **Step 1: Créer le fichier migration**

```sql
-- 20260606000013_create_storage_policies_zreports_and_exports.sql
-- S29 Wave 1.4 — RLS policies sur storage.objects pour les 2 buckets.

-- zreports/ : SELECT requires zreports.read permission ; INSERT/UPDATE/DELETE = postgres role only (via service_role key dans EF generate-zreport-pdf).
CREATE POLICY zreports_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'zreports' AND user_has_permission('zreports.read'));

-- reports-exports/ : SELECT + INSERT pour owner uniquement (path prefix user_id).
CREATE POLICY reports_exports_select_own ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'reports-exports' AND owner = auth.uid());

CREATE POLICY reports_exports_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'reports-exports' AND owner = auth.uid());

CREATE POLICY reports_exports_delete_own ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'reports-exports' AND owner = auth.uid());

COMMENT ON POLICY zreports_select ON storage.objects IS
  'S29 : metadata Z-Report row accessible auth, mais le PDF binary nécessite zreports.read perm (manager+).';
```

- [ ] **Step 2: Apply via MCP** (name = `create_storage_policies_zreports_and_exports`)

- [ ] **Step 3: Verify**

```sql
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage'
  AND policyname LIKE 'zreports%' OR policyname LIKE 'reports_exports%';
```
Expected: 4 policies (`zreports_select`, `reports_exports_select_own`, `reports_exports_insert_own`, `reports_exports_delete_own`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260606000013_create_storage_policies_zreports_and_exports.sql
git commit -m "feat(db): session 29 — wave 1.4 — storage RLS policies (zreports gated by perm, reports-exports owner-only)"
```

### Task 1.5 : Migration `_014` — Helper `_build_zreport_snapshot`

**Files:**
- Create: `supabase/migrations/20260606000014_create_helper_build_zreport_snapshot.sql`

- [ ] **Step 1: Créer le fichier migration**

```sql
-- 20260606000014_create_helper_build_zreport_snapshot.sql
-- S29 Wave 1.5 — Helper qui agrège les données d'un shift pour figer le snapshot Z-Report.
-- Fonction interne (préfixe _) appelée par close_shift_v2 ; pas exposée aux clients.
CREATE OR REPLACE FUNCTION _build_zreport_snapshot(p_shift_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session         pos_sessions%ROWTYPE;
  v_snapshot        JSONB;
  v_payment_totals  JSONB;
  v_top_products    JSONB;
  v_sales_total     NUMERIC(15,2);
  v_refunds_total   NUMERIC(15,2);
  v_voids_total     NUMERIC(15,2);
  v_expenses_cash   NUMERIC(15,2);
BEGIN
  SELECT * INTO v_session FROM pos_sessions WHERE id = p_shift_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift % not found', p_shift_id USING ERRCODE = 'P0002';
  END IF;

  -- Totals by payment method (sur orders de la session)
  SELECT COALESCE(jsonb_object_agg(method, total), '{}'::jsonb) INTO v_payment_totals
  FROM (
    SELECT op.method, SUM(op.amount) AS total
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
    WHERE o.session_id = p_shift_id
      AND o.status NOT IN ('voided', 'cancelled')
    GROUP BY op.method
  ) t;

  -- Sales total (non-voided, non-refunded)
  SELECT COALESCE(SUM(total), 0) INTO v_sales_total
  FROM orders
  WHERE session_id = p_shift_id
    AND status NOT IN ('voided', 'cancelled');

  -- Refunds total (somme des refund_orders FK)
  SELECT COALESCE(SUM(ro.refunded_total), 0) INTO v_refunds_total
  FROM refund_orders ro
  JOIN orders o ON o.id = ro.original_order_id
  WHERE o.session_id = p_shift_id;

  -- Voids total (sale_void je amount)
  SELECT COALESCE(SUM(total), 0) INTO v_voids_total
  FROM orders
  WHERE session_id = p_shift_id
    AND status = 'voided';

  -- Top 10 products (qty)
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_top_products
  FROM (
    SELECT
      oi.product_id,
      oi.product_name,
      SUM(oi.quantity)::numeric    AS qty,
      SUM(oi.line_total)::numeric  AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.session_id = p_shift_id
      AND o.status NOT IN ('voided', 'cancelled')
    GROUP BY oi.product_id, oi.product_name
    ORDER BY qty DESC
    LIMIT 10
  ) t;

  -- Expenses cash payment_method (sync S28)
  SELECT COALESCE(SUM(amount + COALESCE(vat_amount, 0)), 0) INTO v_expenses_cash
  FROM expenses e
  WHERE e.payment_method = 'cash'
    AND e.status = 'paid'
    AND e.paid_at >= v_session.opened_at
    AND (v_session.closed_at IS NULL OR e.paid_at <= v_session.closed_at);

  v_snapshot := jsonb_build_object(
    'shift_id',              p_shift_id,
    'session_number',        v_session.session_number,
    'opened_at',             v_session.opened_at,
    'closed_at',             v_session.closed_at,
    'opened_by',             v_session.opened_by,
    'closed_by',             v_session.closed_by,
    'cashier_terminal_id',   v_session.cashier_terminal_id,
    'opening_cash',          v_session.opening_cash,
    'closing_cash_expected', v_session.cash_expected,
    'closing_cash_counted',  v_session.cash_counted,
    'cash_variance',         COALESCE(v_session.cash_counted - v_session.cash_expected, 0),
    'cash_in_total',         COALESCE(v_session.cash_in_total, 0),
    'cash_out_total',        COALESCE(v_session.cash_out_total, 0),
    'totals_by_payment_method', v_payment_totals,
    'sales_total',           v_sales_total,
    'refunds_total',         v_refunds_total,
    'voids_total',           v_voids_total,
    'expenses_cash_total',   v_expenses_cash,
    'top_products',          v_top_products,
    'generated_at',          now()
  );

  RETURN v_snapshot;
END;
$$;

COMMENT ON FUNCTION _build_zreport_snapshot(UUID) IS
  'S29 : helper interne agrégeant orders/order_payments/refund_orders/expenses pour figer le snapshot Z-Report au close_shift. SECURITY DEFINER. Appelé par close_shift_v2 uniquement.';

REVOKE EXECUTE ON FUNCTION _build_zreport_snapshot(UUID) FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 2: Apply via MCP** (name = `create_helper_build_zreport_snapshot`)

- [ ] **Step 3: Verify**

```sql
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc WHERE proname = '_build_zreport_snapshot';
```
Expected: 1 row, `args = 'p_shift_id uuid'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260606000014_create_helper_build_zreport_snapshot.sql
git commit -m "feat(db): session 29 — wave 1.5 — helper _build_zreport_snapshot (internal, REVOKE all)"
```

### Task 1.6 : Migration `_015` — Bump `close_shift_v2` avec draft z_reports

**Files:**
- Create: `supabase/migrations/20260606000015_bump_close_shift_v2_with_zreport_draft.sql`

> **NOTE** : Cette task nécessite de lire `close_shift_v1` actuel via `mcp__plugin_supabase_supabase__execute_sql` :
> `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'close_shift_v1';`
> Le corps v2 = corps v1 + INSERT INTO z_reports à la fin. Signature inchangée.

- [ ] **Step 1: Fetch v1 source pour préserver le comportement**

Run via MCP `execute_sql` :
```sql
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'close_shift_v1';
```
Copier le résultat dans le fichier migration comme base.

- [ ] **Step 2: Écrire la migration**

```sql
-- 20260606000015_bump_close_shift_v2_with_zreport_draft.sql
-- S29 Wave 1.6 — close_shift bump v2 : ajout INSERT z_reports draft à la fin.
-- Signature inchangée côté caller. Drop v1 dans la même migration (CLAUDE.md RPC versioning rule).

CREATE OR REPLACE FUNCTION close_shift_v2(
  p_session_id     UUID,
  p_closing_cash   NUMERIC(15,2),
  p_manager_pin    TEXT,
  p_notes          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id      UUID := auth.uid();
  v_session        pos_sessions%ROWTYPE;
  v_variance       NUMERIC(15,2);
  v_zreport_id     UUID;
  v_snapshot       JSONB;
BEGIN
  -- (Coller ici le corps de close_shift_v1 — auth gate, perm check, manager PIN verify,
  --  variance calc, status update, audit_log row.)
  -- ... [body identique v1] ...

  -- S29 add : insert z_reports draft row à la fin de la transaction.
  v_snapshot := _build_zreport_snapshot(p_session_id);

  INSERT INTO z_reports (shift_id, snapshot, status)
  VALUES (p_session_id, v_snapshot, 'draft')
  RETURNING id INTO v_zreport_id;

  -- Audit dedié
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_id, 'zreport.draft_created', 'z_report', v_zreport_id,
    jsonb_build_object('shift_id', p_session_id));

  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'variance',   v_variance,
    'zreport_id', v_zreport_id,
    'status',     'closed'
  );
END;
$$;

COMMENT ON FUNCTION close_shift_v2(UUID, NUMERIC, TEXT, TEXT) IS
  'S29 : bump v1 — ajout INSERT z_reports draft à la fin. Signature inchangée. Returns enrichi avec zreport_id.';

-- Drop v1 dans la même migration (CLAUDE.md RPC versioning rule).
DROP FUNCTION IF EXISTS close_shift_v1(UUID, NUMERIC, TEXT, TEXT);
```

> **IMPORTANT** : Le corps `[body identique v1]` doit être remplacé par le SQL exact de v1 lors de l'écriture finale. Si v1 n'existe pas (close_shift n'a jamais été versionné), créer v2 comme fonction nouvelle en s'appuyant sur le flow existant `pos_sessions` UPDATE.

- [ ] **Step 3: Apply via MCP** (name = `bump_close_shift_v2_with_zreport_draft`)

- [ ] **Step 4: Verify**

```sql
SELECT proname FROM pg_proc WHERE proname IN ('close_shift_v1', 'close_shift_v2');
```
Expected: 1 row `close_shift_v2`.

- [ ] **Step 5: REVOKE pair (S25 canonique)**

Créer immédiatement migration `_016` (REVOKE pair) :

```sql
-- 20260606000016_revoke_pair_close_shift_v2.sql
REVOKE EXECUTE ON FUNCTION close_shift_v2(UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

Apply via MCP (name = `revoke_pair_close_shift_v2`).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260606000015_bump_close_shift_v2_with_zreport_draft.sql
git add supabase/migrations/20260606000016_revoke_pair_close_shift_v2.sql
git commit -m "feat(db): session 29 — wave 1.6 — bump close_shift_v2 with zreport draft + REVOKE pair"
```

### Task 1.7 : Migration `_017` — RPC `sign_zreport_v1`

**Files:**
- Create: `supabase/migrations/20260606000017_create_sign_zreport_v1_rpc.sql`
- Create: `supabase/migrations/20260606000018_revoke_pair_sign_zreport_v1.sql`

- [ ] **Step 1: Migration RPC sign**

```sql
-- 20260606000017_create_sign_zreport_v1_rpc.sql
-- S29 Wave 1.7 — sign_zreport_v1 : transition draft → signed, PIN-en-header (S25 pattern).
CREATE OR REPLACE FUNCTION sign_zreport_v1(p_zreport_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id  UUID := auth.uid();
  v_zreport    z_reports%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT user_has_permission('zreports.sign') THEN
    RAISE EXCEPTION 'Permission denied: zreports.sign' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_zreport FROM z_reports WHERE id = p_zreport_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Z-Report % not found', p_zreport_id USING ERRCODE = 'P0002';
  END IF;

  IF v_zreport.status = 'voided' THEN
    RAISE EXCEPTION 'Cannot sign voided Z-Report' USING ERRCODE = 'P0003';
  END IF;

  IF v_zreport.status = 'signed' THEN
    -- Idempotency replay
    RETURN jsonb_build_object(
      'zreport_id',         v_zreport.id,
      'status',             v_zreport.status,
      'signed_at',          v_zreport.signed_at,
      'signed_by',          v_zreport.signed_by,
      'pdf_storage_path',   v_zreport.pdf_storage_path,
      'idempotent_replay',  true
    );
  END IF;

  UPDATE z_reports
  SET status = 'signed',
      signed_at = now(),
      signed_by = v_caller_id
  WHERE id = p_zreport_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_id, 'zreport.sign', 'z_report', p_zreport_id,
    jsonb_build_object('shift_id', v_zreport.shift_id));

  RETURN jsonb_build_object(
    'zreport_id',         p_zreport_id,
    'status',             'signed',
    'signed_at',          now(),
    'signed_by',          v_caller_id,
    'pdf_storage_path',   v_zreport.pdf_storage_path,
    'idempotent_replay',  false
  );
END;
$$;

COMMENT ON FUNCTION sign_zreport_v1(UUID) IS
  'S29 : sign Z-Report draft → signed. PIN-en-header vérifié côté EF wrapper (RPC checks perm uniquement). Idempotent : re-call sur signed retourne idempotent_replay=true.';
```

- [ ] **Step 2: Apply migration `_017`** (name = `create_sign_zreport_v1_rpc`)

- [ ] **Step 3: REVOKE pair `_018`**

```sql
-- 20260606000018_revoke_pair_sign_zreport_v1.sql
REVOKE EXECUTE ON FUNCTION sign_zreport_v1(UUID) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

Apply via MCP (name = `revoke_pair_sign_zreport_v1`).

- [ ] **Step 4: Verify**

```sql
SELECT proname FROM pg_proc WHERE proname = 'sign_zreport_v1';
SELECT has_function_privilege('anon', 'sign_zreport_v1(uuid)', 'execute') AS anon_can_exec;
```
Expected: 1 row sign_zreport_v1, `anon_can_exec = false`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260606000017_create_sign_zreport_v1_rpc.sql
git add supabase/migrations/20260606000018_revoke_pair_sign_zreport_v1.sql
git commit -m "feat(db): session 29 — wave 1.7 — sign_zreport_v1 + REVOKE pair"
```

### Task 1.8 : Migration `_019` + `_020` — RPC `void_zreport_v1` + REVOKE pair

**Files:**
- Create: `supabase/migrations/20260606000019_create_void_zreport_v1_rpc.sql`
- Create: `supabase/migrations/20260606000020_revoke_pair_void_zreport_v1.sql`

- [ ] **Step 1: Migration RPC void**

```sql
-- 20260606000019_create_void_zreport_v1_rpc.sql
-- S29 Wave 1.8 — void_zreport_v1 admin-only avec reason (min 10 char).
CREATE OR REPLACE FUNCTION void_zreport_v1(p_zreport_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id  UUID := auth.uid();
  v_zreport    z_reports%ROWTYPE;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT user_has_permission('zreports.void') THEN
    RAISE EXCEPTION 'Permission denied: zreports.void' USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'Reason must be at least 10 characters' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_zreport FROM z_reports WHERE id = p_zreport_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Z-Report % not found', p_zreport_id USING ERRCODE = 'P0002';
  END IF;

  IF v_zreport.status = 'voided' THEN
    -- Idempotency
    RETURN jsonb_build_object(
      'zreport_id',         v_zreport.id,
      'status',             v_zreport.status,
      'voided_at',          v_zreport.voided_at,
      'idempotent_replay',  true
    );
  END IF;

  UPDATE z_reports
  SET status = 'voided',
      voided_at = now(),
      voided_by = v_caller_id,
      void_reason = trim(p_reason)
  WHERE id = p_zreport_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_caller_id, 'zreport.void', 'z_report', p_zreport_id,
    jsonb_build_object('shift_id', v_zreport.shift_id, 'reason', trim(p_reason)));

  RETURN jsonb_build_object(
    'zreport_id', p_zreport_id,
    'status',     'voided',
    'voided_at',  now(),
    'idempotent_replay', false
  );
END;
$$;

COMMENT ON FUNCTION void_zreport_v1(UUID, TEXT) IS
  'S29 : void Z-Report (admin only). Préserve pdf_storage_path pour audit trail.';
```

- [ ] **Step 2: Apply migration `_019`** (name = `create_void_zreport_v1_rpc`)

- [ ] **Step 3: REVOKE pair `_020`**

```sql
-- 20260606000020_revoke_pair_void_zreport_v1.sql
REVOKE EXECUTE ON FUNCTION void_zreport_v1(UUID, TEXT) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

Apply via MCP (name = `revoke_pair_void_zreport_v1`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260606000019_create_void_zreport_v1_rpc.sql
git add supabase/migrations/20260606000020_revoke_pair_void_zreport_v1.sql
git commit -m "feat(db): session 29 — wave 1.8 — void_zreport_v1 (admin, reason min 10 char) + REVOKE pair"
```

### Task 1.9 : Migration `_021` + `_022` — RPC `get_zreport_snapshot_v1` + REVOKE pair

**Files:**
- Create: `supabase/migrations/20260606000021_create_get_zreport_snapshot_v1_rpc.sql`
- Create: `supabase/migrations/20260606000022_revoke_pair_get_zreport_snapshot_v1.sql`

- [ ] **Step 1: Migration**

```sql
-- 20260606000021_create_get_zreport_snapshot_v1_rpc.sql
-- S29 Wave 1.9 — get_zreport_snapshot_v1 : SELECT enrichi pour l'EF generate-zreport-pdf.
CREATE OR REPLACE FUNCTION get_zreport_snapshot_v1(p_zreport_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id    UUID := auth.uid();
  v_result       JSONB;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT user_has_permission('zreports.read') THEN
    RAISE EXCEPTION 'Permission denied: zreports.read' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'id',                z.id,
    'shift_id',          z.shift_id,
    'generated_at',      z.generated_at,
    'signed_at',         z.signed_at,
    'signed_by',         z.signed_by,
    'signed_by_name',    up.full_name,
    'voided_at',         z.voided_at,
    'voided_by',         z.voided_by,
    'void_reason',       z.void_reason,
    'pdf_storage_path',  z.pdf_storage_path,
    'status',            z.status,
    'snapshot',          z.snapshot
  )
  INTO v_result
  FROM z_reports z
  LEFT JOIN user_profiles up ON up.id = z.signed_by
  WHERE z.id = p_zreport_id;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Z-Report % not found', p_zreport_id USING ERRCODE = 'P0002';
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_zreport_snapshot_v1(UUID) IS
  'S29 : SELECT enrichi (jointure user_profiles signed_by → full_name) pour le rendering PDF côté EF.';
```

- [ ] **Step 2: Apply `_021`** (name = `create_get_zreport_snapshot_v1_rpc`)

- [ ] **Step 3: REVOKE pair `_022`**

```sql
-- 20260606000022_revoke_pair_get_zreport_snapshot_v1.sql
REVOKE EXECUTE ON FUNCTION get_zreport_snapshot_v1(UUID) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260606000021_create_get_zreport_snapshot_v1_rpc.sql
git add supabase/migrations/20260606000022_revoke_pair_get_zreport_snapshot_v1.sql
git commit -m "feat(db): session 29 — wave 1.9 — get_zreport_snapshot_v1 + REVOKE pair"
```

### Task 1.10 : Migration `_023` — Permissions seed

**Files:**
- Create: `supabase/migrations/20260606000023_seed_zreports_permissions.sql`

- [ ] **Step 1: Migration**

```sql
-- 20260606000023_seed_zreports_permissions.sql
-- S29 Wave 1.10 — seed 3 permissions zreports.{read,sign,void} + role_permissions.
INSERT INTO permissions (code, name, description, category) VALUES
  ('zreports.read', 'Read Z-Reports', 'View Z-Report history and PDF archives', 'reports'),
  ('zreports.sign', 'Sign Z-Reports', 'Sign a Z-Report draft (PIN-gated)', 'reports'),
  ('zreports.void', 'Void Z-Reports', 'Void a signed Z-Report with reason (admin only)', 'reports')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('MANAGER',     'zreports.read'),
  ('MANAGER',     'zreports.sign'),
  ('ADMIN',       'zreports.read'),
  ('ADMIN',       'zreports.sign'),
  ('ADMIN',       'zreports.void'),
  ('SUPER_ADMIN', 'zreports.read'),
  ('SUPER_ADMIN', 'zreports.sign'),
  ('SUPER_ADMIN', 'zreports.void')
ON CONFLICT (role_code, permission_code) DO NOTHING;
```

- [ ] **Step 2: Apply via MCP** (name = `seed_zreports_permissions`)

- [ ] **Step 3: Verify**

```sql
SELECT code, name FROM permissions WHERE code LIKE 'zreports.%' ORDER BY code;
SELECT role_code, permission_code FROM role_permissions WHERE permission_code LIKE 'zreports.%' ORDER BY role_code, permission_code;
```
Expected: 3 permissions, 8 role_permissions rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260606000023_seed_zreports_permissions.sql
git commit -m "feat(db): session 29 — wave 1.10 — seed zreports.{read,sign,void} permissions"
```

### Task 1.11 : Types regen

**Files:**
- Modify: `packages/supabase/src/types.generated.ts`
- Modify: `packages/utils/src/permissions.ts` (ajouter 3 codes au type union `PermissionCode`)

- [ ] **Step 1: Regen types via MCP**

```
mcp__plugin_supabase_supabase__generate_typescript_types
project_id: ikcyvlovptebroadgtvd
```

Écrire la sortie dans `packages/supabase/src/types.generated.ts` (overwrite complet).

- [ ] **Step 2: Add 3 permission codes to PermissionCode union**

Lire `packages/utils/src/permissions.ts`, trouver le type `PermissionCode` (union string literals), ajouter `'zreports.read' | 'zreports.sign' | 'zreports.void'`.

- [ ] **Step 3: Run typecheck**

```bash
pnpm typecheck
```
Expected: 6/6 PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/supabase/src/types.generated.ts packages/utils/src/permissions.ts
git commit -m "feat(types): session 29 — wave 1.11 — regen types + extend PermissionCode union"
```

### Task 1.12 : pgTAP tests Wave 1

**Files:**
- Create: `supabase/tests/zreports.test.sql`

- [ ] **Step 1: Écrire le fichier de tests pgTAP**

Structure attendue (14 cas — voir spec §7.1) :

```sql
BEGIN;
SELECT plan(14);

-- Setup : create a fake closed shift + insert draft z_report manually for tests
-- (Cannot easily call close_shift_v2 without full POS setup, so we test the RPCs directly
-- by inserting fixtures.)
DO $$
DECLARE
  v_shift_id UUID;
  v_zreport_id UUID;
  v_manager_id UUID;
BEGIN
  -- ... fixture setup ...
  PERFORM set_config('breakery.test_shift_id', v_shift_id::text, false);
  PERFORM set_config('breakery.test_zreport_id', v_zreport_id::text, false);
  PERFORM set_config('breakery.test_manager_id', v_manager_id::text, false);
END
$$;

-- T1: close_shift_v2 happy path inserts z_reports draft (mock via _build_zreport_snapshot)
-- T2: UNIQUE(shift_id) prevents duplicate
-- T3-T7: sign_zreport_v1 happy/idempotent/perm denied/not found/voided
-- T8-T10: void_zreport_v1 happy/perm denied/reason too short
-- T11: z_reports RLS SELECT ok, INSERT/UPDATE/DELETE blocked from authenticated
-- T12: storage.objects RLS zreports requires zreports.read
-- T13: storage.objects RLS reports-exports owner-only
-- T14: REVOKE EXECUTE from anon on 3 zreport RPCs

SELECT * FROM finish();
ROLLBACK;
```

> **NOTE** : Le contenu exact des 14 cas suit le pattern S28 `expense_governance.test.sql`. Utiliser `breakery.test_*` GUCs pour chaîner les fixtures entre DO blocks (pattern S25).

- [ ] **Step 2: Run pgTAP via MCP**

```
mcp__plugin_supabase_supabase__execute_sql
project_id: ikcyvlovptebroadgtvd
query: <contenu du fichier zreports.test.sql>
```

Expected: 14/14 PASS (`ok 1...ok 14`).

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/zreports.test.sql
git commit -m "test(db): session 29 — wave 1.12 — pgTAP zreports 14/14 PASS"
```

---

## Wave 2 — Domain helpers (parallèle Wave 1)

> Stream Domain. Peut runner indépendamment de Wave 1 (pas de dépendance DB). Pure TypeScript, IO-free.

### Task 2.1 : Helper `csv.ts`

**Files:**
- Create: `packages/domain/src/reports/csv.ts`
- Create: `packages/domain/src/reports/__tests__/csv.test.ts`
- Modify: `packages/domain/src/reports/index.ts` (export)
- Modify: `packages/domain/src/index.ts` (re-export `./reports/csv`)

- [ ] **Step 1: Écrire le test FIRST (TDD)**

`packages/domain/src/reports/__tests__/csv.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { buildCsv, type CsvColumn } from '../csv.js';

interface Row { name: string; amount: number; date: string }

describe('buildCsv', () => {
  it('builds header + rows with comma delimiter and BOM by default', () => {
    const cols: CsvColumn<Row>[] = [
      { header: 'Name',   accessor: (r) => r.name },
      { header: 'Amount', accessor: (r) => r.amount, format: 'number' },
    ];
    const csv = buildCsv([{ name: 'A', amount: 10, date: '' }], cols);
    expect(csv.charCodeAt(0)).toBe(0xFEFF); // BOM
    expect(csv).toContain('Name,Amount\r\n');
    expect(csv).toContain('A,10\r\n');
  });

  it('escapes cells containing comma/quote/newline per RFC 4180', () => {
    const cols: CsvColumn<{ v: string }>[] = [{ header: 'V', accessor: (r) => r.v }];
    const csv = buildCsv(
      [{ v: 'has,comma' }, { v: 'has"quote' }, { v: 'has\nnewline' }],
      cols, { bom: false }
    );
    expect(csv).toContain('"has,comma"');
    expect(csv).toContain('"has""quote"');
    expect(csv).toContain('"has\nnewline"');
  });

  it('formats idr-round100 with id-ID locale', () => {
    const cols: CsvColumn<{ v: number }>[] = [
      { header: 'V', accessor: (r) => r.v, format: 'idr-round100' },
    ];
    const csv = buildCsv([{ v: 1500099 }], cols, { bom: false });
    // 1500099 round 100 = 1500000 → "1.500.000" en id-ID
    expect(csv).toContain('1.500.000');
  });

  it('uses semicolon delimiter when configured', () => {
    const cols: CsvColumn<{ a: string; b: string }>[] = [
      { header: 'A', accessor: (r) => r.a },
      { header: 'B', accessor: (r) => r.b },
    ];
    const csv = buildCsv([{ a: '1', b: '2' }], cols, { bom: false, delimiter: ';' });
    expect(csv).toContain('A;B');
    expect(csv).toContain('1;2');
  });

  it('handles null/undefined cells as empty string', () => {
    const cols: CsvColumn<{ v: number | null }>[] = [
      { header: 'V', accessor: (r) => r.v },
    ];
    const csv = buildCsv([{ v: null }, { v: 5 }], cols, { bom: false });
    expect(csv).toContain('V\r\n\r\n5\r\n');
  });

  it('formats percent (2 decimals + %)', () => {
    const cols: CsvColumn<{ p: number }>[] = [
      { header: 'P', accessor: (r) => r.p, format: 'percent' },
    ];
    const csv = buildCsv([{ p: 0.123 }], cols, { bom: false });
    expect(csv).toContain('12.30%');
  });

  it('formats date (yyyy-MM-dd from ISO)', () => {
    const cols: CsvColumn<{ d: string }>[] = [
      { header: 'D', accessor: (r) => r.d, format: 'date' },
    ];
    const csv = buildCsv([{ d: '2026-05-24T15:30:00Z' }], cols, { bom: false });
    expect(csv).toContain('2026-05-24');
  });

  it('returns header-only when rows array is empty', () => {
    const cols: CsvColumn<Row>[] = [{ header: 'Name', accessor: (r) => r.name }];
    const csv = buildCsv([], cols, { bom: false });
    expect(csv).toBe('Name\r\n');
  });
});
```

- [ ] **Step 2: Run test → expect FAIL**

```bash
pnpm --filter @breakery/domain test reports/csv
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implémenter `csv.ts`**

`packages/domain/src/reports/csv.ts` :

```ts
// packages/domain/src/reports/csv.ts
//
// S29 Wave 2.1 — CSV builder centralisé (IO-free, browser-callable via downloadCsv).
// Used by all report pages with CSV export. Replaces 4 ad-hoc implementations
// (Recipe Overview/Timeline, ProductionYield, TrialBalance) via 1 unified helper.

export type CsvFormat = 'idr' | 'idr-round100' | 'number' | 'percent' | 'date' | 'datetime' | 'text';

export interface CsvColumn<T> {
  header:   string;
  accessor: (row: T) => string | number | null | undefined;
  format?:  CsvFormat;
}

export interface CsvOptions {
  bom?:       boolean;
  delimiter?: ',' | ';';
  locale?:    string;
}

const DEFAULT_OPTS: Required<CsvOptions> = {
  bom:       true,
  delimiter: ',',
  locale:    'id-ID',
};

function escapeCell(v: string, delimiter: string): string {
  if (v.includes('"') || v.includes(delimiter) || v.includes('\n') || v.includes('\r')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function formatCell(value: string | number | null | undefined, format: CsvFormat | undefined, locale: string): string {
  if (value === null || value === undefined) return '';
  if (format === undefined || format === 'text') return String(value);

  const num = typeof value === 'number' ? value : Number(value);
  if (format === 'idr' || format === 'idr-round100') {
    if (!Number.isFinite(num)) return '';
    const rounded = format === 'idr-round100' ? Math.round(num / 100) * 100 : num;
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(rounded);
  }
  if (format === 'number') {
    if (!Number.isFinite(num)) return '';
    return String(num);
  }
  if (format === 'percent') {
    if (!Number.isFinite(num)) return '';
    return `${(num * 100).toFixed(2)}%`;
  }
  if (format === 'date') {
    return String(value).slice(0, 10); // yyyy-MM-dd
  }
  if (format === 'datetime') {
    return String(value).slice(0, 19).replace('T', ' '); // yyyy-MM-dd HH:mm:ss
  }
  return String(value);
}

export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[], opts?: CsvOptions): string {
  const o = { ...DEFAULT_OPTS, ...opts };
  const lines: string[] = [];

  lines.push(columns.map((c) => escapeCell(c.header, o.delimiter)).join(o.delimiter));

  for (const row of rows) {
    lines.push(
      columns
        .map((c) => escapeCell(formatCell(c.accessor(row), c.format, o.locale), o.delimiter))
        .join(o.delimiter)
    );
  }

  const body = lines.join('\r\n') + '\r\n';
  return o.bom ? '﻿' + body : body;
}

export function downloadCsv(csv: string, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Add exports**

`packages/domain/src/reports/index.ts` :
```ts
export * from './csv.js';
// + existing exports
```

`packages/domain/src/index.ts` (vérifier que `./reports/index.js` est re-exporté ; sinon ajouter `export * from './reports/index.js';`).

- [ ] **Step 5: Run test → expect PASS**

```bash
pnpm --filter @breakery/domain test reports/csv
```
Expected: PASS 8/8.

- [ ] **Step 6: Run typecheck**

```bash
pnpm typecheck
```
Expected: 6/6 PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/reports/csv.ts \
        packages/domain/src/reports/__tests__/csv.test.ts \
        packages/domain/src/reports/index.ts \
        packages/domain/src/index.ts
git commit -m "feat(domain): session 29 — wave 2.1 — buildCsv + downloadCsv helpers (8/8 PASS)"
```

### Task 2.2 : Helper `period.ts`

**Files:**
- Create: `packages/domain/src/reports/period.ts`
- Create: `packages/domain/src/reports/__tests__/period.test.ts`
- Modify: `packages/domain/src/reports/index.ts`

- [ ] **Step 1: Test FIRST**

`packages/domain/src/reports/__tests__/period.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { previousPeriod, formatDelta } from '../period.js';

describe('previousPeriod', () => {
  it('shifts a calendar month back', () => {
    expect(previousPeriod('2026-05-01', '2026-05-31'))
      .toEqual({ start: '2026-04-01', end: '2026-04-30' });
  });

  it('shifts a 7-day window back by 7 days', () => {
    expect(previousPeriod('2026-05-15', '2026-05-21'))
      .toEqual({ start: '2026-05-08', end: '2026-05-14' });
  });

  it('handles year crossing', () => {
    expect(previousPeriod('2026-01-01', '2026-01-31'))
      .toEqual({ start: '2025-12-01', end: '2025-12-31' });
  });

  it('handles same-day range (1-day period)', () => {
    expect(previousPeriod('2026-05-24', '2026-05-24'))
      .toEqual({ start: '2026-05-23', end: '2026-05-23' });
  });

  it('falls back to n-day shift when calendar-month not aligned', () => {
    // 12-day window → shift 12 days back
    expect(previousPeriod('2026-05-10', '2026-05-21'))
      .toEqual({ start: '2026-04-28', end: '2026-05-09' });
  });
});

describe('formatDelta', () => {
  it('returns abs + pct + sign for normal case', () => {
    expect(formatDelta(120, 100)).toEqual({ abs: 20, pct: 0.20, sign: 1 });
  });

  it('returns negative sign when current < previous', () => {
    expect(formatDelta(80, 100)).toEqual({ abs: -20, pct: -0.20, sign: -1 });
  });

  it('returns null pct when previous is zero', () => {
    expect(formatDelta(50, 0)).toEqual({ abs: 50, pct: null, sign: 1 });
  });

  it('returns sign=0 when both zero', () => {
    expect(formatDelta(0, 0)).toEqual({ abs: 0, pct: null, sign: 0 });
  });
});
```

- [ ] **Step 2: Run test → expect FAIL**

```bash
pnpm --filter @breakery/domain test reports/period
```

- [ ] **Step 3: Implémenter `period.ts`**

```ts
// packages/domain/src/reports/period.ts
//
// S29 Wave 2.2 — previousPeriod : calcule la fenêtre symétrique précédente
// pour le comparison toggle sur reports. Calendar-aware pour mois pleins,
// n-day shift sinon.

function parseDate(s: string): Date {
  // Treat as UTC midnight to avoid TZ drift.
  return new Date(s + 'T00:00:00Z');
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isFirstOfMonth(d: Date): boolean {
  return d.getUTCDate() === 1;
}

function isLastOfMonth(d: Date): boolean {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
  return next.getUTCMonth() !== d.getUTCMonth();
}

export function previousPeriod(start: string, end: string): { start: string; end: string } {
  const startDate = parseDate(start);
  const endDate   = parseDate(end);

  // Calendar-month case : 1st → last of month → shift to previous month full range.
  if (isFirstOfMonth(startDate) && isLastOfMonth(endDate)
      && startDate.getUTCFullYear() === endDate.getUTCFullYear()
      && startDate.getUTCMonth() === endDate.getUTCMonth()) {
    const prevMonthStart = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() - 1, 1));
    const prevMonthEnd   = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 0));
    return { start: toIso(prevMonthStart), end: toIso(prevMonthEnd) };
  }

  // Generic n-day shift back.
  const dayMs = 86_400_000;
  const lengthDays = Math.round((endDate.getTime() - startDate.getTime()) / dayMs) + 1;
  const prevEnd   = new Date(startDate.getTime() - dayMs);
  const prevStart = new Date(prevEnd.getTime() - (lengthDays - 1) * dayMs);
  return { start: toIso(prevStart), end: toIso(prevEnd) };
}

export interface Delta { abs: number; pct: number | null; sign: 1 | -1 | 0 }

export function formatDelta(current: number, previous: number): Delta {
  const abs = current - previous;
  const sign: 1 | -1 | 0 = abs > 0 ? 1 : abs < 0 ? -1 : 0;
  const pct = previous === 0 ? null : abs / previous;
  return { abs, pct, sign };
}
```

- [ ] **Step 4: Update reports/index.ts**

```ts
export * from './csv.js';
export * from './period.js';
// + existing
```

- [ ] **Step 5: Run test → expect PASS**

```bash
pnpm --filter @breakery/domain test reports/period
```
Expected: 9/9 PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/reports/period.ts \
        packages/domain/src/reports/__tests__/period.test.ts \
        packages/domain/src/reports/index.ts
git commit -m "feat(domain): session 29 — wave 2.2 — previousPeriod + formatDelta helpers (9/9 PASS)"
```

---

## Wave 3 — Edge Functions (dépend Wave 1 — buckets RLS)

> EF stream. Génère les PDF. Deploy via `mcp__plugin_supabase_supabase__deploy_edge_function`.

### Task 3.1 : EF `_shared/pdf-layout.ts` (header/footer commun)

**Files:**
- Create: `supabase/functions/_shared/pdf-layout.ts`

- [ ] **Step 1: Écrire le helper**

```ts
// supabase/functions/_shared/pdf-layout.ts
//
// S29 Wave 3.1 — header/footer commun à tous les PDF templates.
// pdf-lib API : every page has a coordinate system y=0 bottom, x=0 left.

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';

export interface BusinessInfo {
  name:    string;
  npwp?:   string;
  address?: string;
}

export interface LayoutContext {
  doc:      PDFDocument;
  font:     PDFFont;
  fontBold: PDFFont;
  business: BusinessInfo;
}

export async function initLayout(business: BusinessInfo): Promise<LayoutContext> {
  const doc      = await PDFDocument.create();
  const font     = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, font, fontBold, business };
}

export function drawHeader(
  page: PDFPage,
  ctx: LayoutContext,
  title: string,
  period?: { start: string; end: string }
): number /* y position for content start */ {
  const { width, height } = page.getSize();
  // Business name top-left
  page.drawText(ctx.business.name, {
    x: 40, y: height - 50, size: 14, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1)
  });
  if (ctx.business.npwp) {
    page.drawText(`NPWP: ${ctx.business.npwp}`, {
      x: 40, y: height - 65, size: 8, font: ctx.font, color: rgb(0.3, 0.3, 0.3)
    });
  }
  // Title top-right
  page.drawText(title, {
    x: width - 40 - ctx.fontBold.widthOfTextAtSize(title, 16),
    y: height - 50, size: 16, font: ctx.fontBold, color: rgb(0.1, 0.1, 0.1)
  });
  // Period subtitle
  if (period) {
    const periodStr = `${period.start} — ${period.end}`;
    page.drawText(periodStr, {
      x: width - 40 - ctx.font.widthOfTextAtSize(periodStr, 10),
      y: height - 65, size: 10, font: ctx.font, color: rgb(0.3, 0.3, 0.3)
    });
  }
  // Separator line
  page.drawLine({
    start: { x: 40, y: height - 80 },
    end:   { x: width - 40, y: height - 80 },
    thickness: 0.5, color: rgb(0.7, 0.7, 0.7)
  });
  return height - 100; // content starts here
}

export function drawFooter(page: PDFPage, ctx: LayoutContext, pageNum: number, totalPages: number): void {
  const { width } = page.getSize();
  const generated = `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} WIB`;
  page.drawText(generated, {
    x: 40, y: 30, size: 8, font: ctx.font, color: rgb(0.5, 0.5, 0.5)
  });
  const pageStr = `Page ${pageNum} / ${totalPages}`;
  page.drawText(pageStr, {
    x: width - 40 - ctx.font.widthOfTextAtSize(pageStr, 8),
    y: 30, size: 8, font: ctx.font, color: rgb(0.5, 0.5, 0.5)
  });
}

export function formatIDR(value: number, locale = 'id-ID'): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    .format(Math.round(value / 100) * 100);
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/pdf-layout.ts
git commit -m "feat(ef): session 29 — wave 3.1 — _shared/pdf-layout.ts (header/footer + formatIDR)"
```

### Task 3.2 : 12 PDF templates — pattern shared, one file each

**Files:**
- Create: `supabase/functions/_shared/pdf-templates/pnl.ts`
- Create: `supabase/functions/_shared/pdf-templates/bs.ts`
- Create: `supabase/functions/_shared/pdf-templates/cf.ts`
- Create: `supabase/functions/_shared/pdf-templates/basket.ts`
- Create: `supabase/functions/_shared/pdf-templates/recipe_overview.ts`
- Create: `supabase/functions/_shared/pdf-templates/recipe_timeline.ts`
- Create: `supabase/functions/_shared/pdf-templates/sales_by_hour.ts`
- Create: `supabase/functions/_shared/pdf-templates/sales_by_category.ts`
- Create: `supabase/functions/_shared/pdf-templates/sales_by_staff.ts`
- Create: `supabase/functions/_shared/pdf-templates/stock_variance.ts`
- Create: `supabase/functions/_shared/pdf-templates/production_yield.ts`
- Create: `supabase/functions/_shared/pdf-templates/audit.ts`
- Create: `supabase/functions/_shared/pdf-templates/index.ts` (export Record)

> **Pattern shared par template** : chaque template exporte une fonction `render(ctx: LayoutContext, data: SpecificData, period: Period): Promise<void>` qui ajoute des pages au `ctx.doc` via `ctx.doc.addPage()`, dessine header (via `drawHeader`), corps tabulaire, et footer en fin.

- [ ] **Step 1: Implémenter pattern de template (exemple : pnl)**

`supabase/functions/_shared/pdf-templates/pnl.ts` :

```ts
import { PDFPage, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { LayoutContext, drawFooter, drawHeader, formatIDR } from '../pdf-layout.ts';

export interface PnlData {
  revenue: { sales: number; discounts: number; adjustments: number; total: number };
  cogs:    { production: number; waste: number; other: number; total: number };
  gross_profit: number;
  opex: { salary: number; rent: number; utilities: number; supplies: number; marketing: number; maintenance: number; other: number; total: number };
  operating_profit: number;
  net_profit:       number;
  lines: Array<{ code: string; name: string; debit: number; credit: number; balance: number }>;
}

export async function render(
  ctx: LayoutContext,
  data: PnlData,
  period: { start: string; end: string }
): Promise<void> {
  const page = ctx.doc.addPage([595, 842]); // A4 portrait
  let y = drawHeader(page, ctx, 'Profit & Loss', period);

  const drawRow = (label: string, value: number, indent = 0, bold = false): void => {
    const font = bold ? ctx.fontBold : ctx.font;
    page.drawText(label, { x: 40 + indent * 12, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
    const valStr = formatIDR(value);
    page.drawText(valStr, {
      x: 555 - ctx.font.widthOfTextAtSize(valStr, 10),
      y, size: 10, font, color: rgb(0.1, 0.1, 0.1)
    });
    y -= 16;
  };

  drawRow('Revenue', data.revenue.total, 0, true);
  drawRow('Sales',       data.revenue.sales,       1);
  drawRow('Discounts',   data.revenue.discounts,   1);
  drawRow('Adjustments', data.revenue.adjustments, 1);
  y -= 4;

  drawRow('COGS', data.cogs.total, 0, true);
  drawRow('Production', data.cogs.production, 1);
  drawRow('Waste',      data.cogs.waste,      1);
  drawRow('Other',      data.cogs.other,      1);
  y -= 4;

  drawRow('Gross Profit', data.gross_profit, 0, true);
  y -= 4;

  drawRow('Operating Expenses', data.opex.total, 0, true);
  drawRow('Salary & Wages', data.opex.salary,      1);
  drawRow('Rent',           data.opex.rent,        1);
  drawRow('Utilities',      data.opex.utilities,   1);
  drawRow('Supplies',       data.opex.supplies,    1);
  drawRow('Marketing',      data.opex.marketing,   1);
  drawRow('Maintenance',    data.opex.maintenance, 1);
  drawRow('Other',          data.opex.other,       1);
  y -= 4;

  drawRow('Net Profit', data.net_profit, 0, true);

  drawFooter(page, ctx, 1, 1);
}
```

- [ ] **Step 2: Implémenter les 11 autres templates**

Tous suivent le pattern : 1 page A4 portrait, header + table corps + footer. Pour les templates avec beaucoup de lignes (basket top 100, audit, sales_by_hour 24 lignes) : pagination en multi-pages via boucle `if (y < 80) { y = drawHeader(page = ctx.doc.addPage(...)); }`.

Skeletons à fournir (chaque ~80 lignes) :
- `bs.ts` — Balance Sheet (assets / liab / equity sections)
- `cf.ts` — Cash Flow (operating / investing / financing 3-sections S21)
- `basket.ts` — table 5 cols (Product A | Product B | Co-occurrence | Confidence | Lift)
- `recipe_overview.ts` — table 6 cols (product | unit cost | baseline | delta % | change count | created_at)
- `recipe_timeline.ts` — table 4 cols (version | cost | delta | created_at) + texte produit
- `sales_by_hour.ts` — table 24 lignes (hour | revenue | orders) avec recharts skip
- `sales_by_category.ts` — table N lignes (category | revenue | qty)
- `sales_by_staff.ts` — table N lignes (staff | total | orders | avg basket)
- `stock_variance.ts` — table N lignes (product | expected | current | variance | variance %)
- `production_yield.ts` — table 6 cols (production_number | recipe | expected_yield | actual_yield | variance % | status)
- `audit.ts` — table 4 cols (timestamp | action | entity | actor) pagination by 30 rows/page

- [ ] **Step 3: Créer le registry `index.ts`**

```ts
// supabase/functions/_shared/pdf-templates/index.ts
import { LayoutContext } from '../pdf-layout.ts';
import * as pnl from './pnl.ts';
import * as bs from './bs.ts';
import * as cf from './cf.ts';
import * as basket from './basket.ts';
import * as recipeOverview from './recipe_overview.ts';
import * as recipeTimeline from './recipe_timeline.ts';
import * as salesByHour from './sales_by_hour.ts';
import * as salesByCategory from './sales_by_category.ts';
import * as salesByStaff from './sales_by_staff.ts';
import * as stockVariance from './stock_variance.ts';
import * as productionYield from './production_yield.ts';
import * as audit from './audit.ts';

export type TemplateName =
  | 'pnl' | 'bs' | 'cf' | 'basket'
  | 'recipe_overview' | 'recipe_timeline'
  | 'sales_by_hour' | 'sales_by_category' | 'sales_by_staff'
  | 'stock_variance' | 'production_yield' | 'audit';

export const TEMPLATES: Record<TemplateName, {
  render: (ctx: LayoutContext, data: unknown, period: { start: string; end: string } | null) => Promise<void>;
  permission: string;
}> = {
  pnl:               { render: pnl.render as any,             permission: 'reports.financial.read' },
  bs:                { render: bs.render as any,              permission: 'reports.financial.read' },
  cf:                { render: cf.render as any,              permission: 'reports.financial.read' },
  basket:            { render: basket.render as any,          permission: 'reports.sales.read' },
  recipe_overview:   { render: recipeOverview.render as any,  permission: 'reports.financial.read' },
  recipe_timeline:   { render: recipeTimeline.render as any,  permission: 'reports.financial.read' },
  sales_by_hour:     { render: salesByHour.render as any,     permission: 'reports.sales.read' },
  sales_by_category: { render: salesByCategory.render as any, permission: 'reports.sales.read' },
  sales_by_staff:    { render: salesByStaff.render as any,    permission: 'reports.sales.read' },
  stock_variance:    { render: stockVariance.render as any,   permission: 'reports.inventory.read' },
  production_yield:  { render: productionYield.render as any, permission: 'inventory.read' },
  audit:             { render: audit.render as any,           permission: 'reports.audit.read' },
};
```

- [ ] **Step 4: Commit (1 commit pour les 12 templates + index)**

```bash
git add supabase/functions/_shared/pdf-templates/
git commit -m "feat(ef): session 29 — wave 3.2 — 12 PDF templates (pnl, bs, cf, basket, recipe×2, sales×3, stock_variance, production_yield, audit) + registry"
```

### Task 3.3 : EF `generate-pdf` (générique)

**Files:**
- Create: `supabase/functions/generate-pdf/index.ts`

- [ ] **Step 1: Implémenter l'EF**

```ts
// supabase/functions/generate-pdf/index.ts
//
// S29 Wave 3.3 — EF générique : pose les arguments, call template render,
// upload PDF dans reports-exports/, return signed URL.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { TEMPLATES, type TemplateName } from '../_shared/pdf-templates/index.ts';
import { initLayout } from '../_shared/pdf-layout.ts';
import { getIdempotencyKey } from '../_shared/idempotency.ts';
// rate limit + responses helpers existants S19/S22
import { checkRateLimitDurable } from '../_shared/rate-limit.ts';
import { json, rateLimited429, withRetryAfter } from '../_shared/responses.ts';

interface RequestBody {
  template: TemplateName;
  data:     Record<string, unknown>;
  period?:  { start: string; end: string } | null;
  filename: string;
  comparePrevious?: { data: Record<string, unknown> } | null;
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Auth
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } }
  );
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return json({ error: 'missing_auth' }, 401);

  // Rate limit
  const rl = await checkRateLimitDurable(`generate-pdf:${userData.user.id}`, 30, 60);
  if (!rl.ok) return withRetryAfter(rateLimited429('Rate limit exceeded'), rl.retry_after);

  let body: RequestBody;
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const template = TEMPLATES[body.template];
  if (!template) return json({ error: 'invalid_template' }, 400);

  // Permission check
  const { data: hasPerm } = await supabase.rpc('user_has_permission', { p_permission_code: template.permission });
  if (!hasPerm) return json({ error: 'permission_denied' }, 403);

  // Build PDF
  const { data: bizConfig } = await supabase.from('business_config').select('business_name, npwp, address').single();
  const ctx = await initLayout({
    name:    bizConfig?.business_name || 'The Breakery',
    npwp:    bizConfig?.npwp || undefined,
    address: bizConfig?.address || undefined,
  });
  try {
    await template.render(ctx, body.data, body.period ?? null);
    if (body.comparePrevious) {
      // Render previous period as a second page section (template-specific layout handles delta).
      await template.render(ctx, body.comparePrevious.data, body.period ?? null);
    }
  } catch (err) {
    return json({ error: 'generation_failed', detail: String(err) }, 500);
  }
  const pdfBytes = await ctx.doc.save();

  // Upload
  const now = new Date();
  const path = `${userData.user.id}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${body.filename}.pdf`;
  const { error: uploadErr } = await supabase.storage.from('reports-exports').upload(path, pdfBytes, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (uploadErr) return json({ error: 'upload_failed', detail: uploadErr.message }, 500);

  const { data: signed } = await supabase.storage.from('reports-exports').createSignedUrl(path, 3600);
  return json({
    storage_path: `reports-exports/${path}`,
    signed_url:   signed?.signedUrl,
    expires_at:   new Date(Date.now() + 3600_000).toISOString(),
  });
});
```

- [ ] **Step 2: Deploy via MCP**

```
mcp__plugin_supabase_supabase__deploy_edge_function
project_id: ikcyvlovptebroadgtvd
name: generate-pdf
files: [{ name: 'index.ts', content: <contenu ci-dessus> }]
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/generate-pdf/
git commit -m "feat(ef): session 29 — wave 3.3 — generate-pdf generic EF (12 templates, auth, rate-limit, upload)"
```

### Task 3.4 : EF `generate-zreport-pdf` (spécifique)

**Files:**
- Create: `supabase/functions/_shared/pdf-templates/zreport.ts`
- Create: `supabase/functions/generate-zreport-pdf/index.ts`

- [ ] **Step 1: Template Z-Report**

`supabase/functions/_shared/pdf-templates/zreport.ts` — layout legal Indonesia avec signature box. Pattern identique aux 12 autres mais corps plus dense :
- Business header (name + NPWP + address)
- Shift period + session_number
- Opening cash | Closing cash counted | Variance
- Totals by payment method (table)
- Sales / Refunds / Voids / Expenses cash
- Top 10 products (table)
- Signature box : "Signed by: __________________  Date: __________  Role: __________"

(~120 lignes pdf-lib drawing code.)

- [ ] **Step 2: EF**

```ts
// supabase/functions/generate-zreport-pdf/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { render as renderZReport } from '../_shared/pdf-templates/zreport.ts';
import { initLayout } from '../_shared/pdf-layout.ts';
import { getIdempotencyKey } from '../_shared/idempotency.ts';
import { json } from '../_shared/responses.ts';

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const idempotencyKey = getIdempotencyKey(req, { required: true });
  if (typeof idempotencyKey !== 'string') {
    return json({ error: 'missing_idempotency_key' }, 400);
  }

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } }
  );
  const { data: userData } = await userClient.auth.getUser();
  if (!userData.user) return json({ error: 'missing_auth' }, 401);

  let body: { zreport_id: string };
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!body.zreport_id) return json({ error: 'missing_zreport_id' }, 400);

  // Get snapshot via RPC (perm gate inside)
  const { data: snap, error: snapErr } = await userClient.rpc('get_zreport_snapshot_v1', { p_zreport_id: body.zreport_id });
  if (snapErr) return json({ error: 'rpc_failed', detail: snapErr.message }, snapErr.code === '42501' ? 403 : 500);
  if (!snap) return json({ error: 'zreport_not_found' }, 404);

  // Idempotent : if pdf_storage_path already set, return existing signed URL.
  const serviceClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  if (snap.pdf_storage_path) {
    const path = snap.pdf_storage_path.replace(/^zreports\//, '');
    const { data: signed } = await serviceClient.storage.from('zreports').createSignedUrl(path, 3600);
    return json({
      storage_path: snap.pdf_storage_path,
      signed_url:   signed?.signedUrl,
      expires_at:   new Date(Date.now() + 3600_000).toISOString(),
      status:       snap.status,
      idempotent_replay: true,
    });
  }

  // Build & upload
  const { data: bizConfig } = await serviceClient.from('business_config').select('business_name, npwp, address').single();
  const ctx = await initLayout({
    name:    bizConfig?.business_name || 'The Breakery',
    npwp:    bizConfig?.npwp || undefined,
    address: bizConfig?.address || undefined,
  });
  await renderZReport(ctx, snap.snapshot, null);
  const pdfBytes = await ctx.doc.save();

  const now = new Date();
  const ts  = now.toISOString().replace(/[:.]/g, '-');
  const path = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${snap.shift_id}_${ts}.pdf`;
  const { error: uploadErr } = await serviceClient.storage.from('zreports').upload(path, pdfBytes, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (uploadErr) return json({ error: 'upload_failed', detail: uploadErr.message }, 500);

  const fullPath = `zreports/${path}`;
  await serviceClient.from('z_reports').update({ pdf_storage_path: fullPath }).eq('id', body.zreport_id);

  const { data: signed } = await serviceClient.storage.from('zreports').createSignedUrl(path, 3600);
  return json({
    storage_path: fullPath,
    signed_url:   signed?.signedUrl,
    expires_at:   new Date(Date.now() + 3600_000).toISOString(),
    status:       snap.status,
    idempotent_replay: false,
  });
});
```

- [ ] **Step 3: Deploy via MCP** (name = `generate-zreport-pdf`)

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/pdf-templates/zreport.ts \
        supabase/functions/generate-zreport-pdf/
git commit -m "feat(ef): session 29 — wave 3.4 — generate-zreport-pdf + zreport template (idempotent, service-role upload)"
```

### Task 3.5 : Vitest live EF tests

**Files:**
- Create: `supabase/tests/functions/generate-pdf.test.ts`
- Create: `supabase/tests/functions/generate-zreport-pdf.test.ts`
- Create: `supabase/tests/functions/sign-zreport.test.ts`

> Live tests requièrent `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env vars (pattern S25 — `it.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)`).

- [ ] **Step 1: Test files** (suivre pattern `supabase/tests/functions/refund-order.test.ts` S25 pour la structure setup + JWT impersonation)

- [ ] **Step 2: Commit**

```bash
git add supabase/tests/functions/
git commit -m "test(ef): session 29 — wave 3.5 — Vitest live EF tests (generate-pdf, generate-zreport-pdf, sign-zreport)"
```

---

## Wave 4 — BO Exports (dépend Wave 2 + Wave 3)

> Stream BO Exports. Branche le helper csv et le bouton PDF sur 13 pages.

### Task 4.1 : Composant `<ExportButtons>` partagé

**Files:**
- Create: `apps/backoffice/src/features/reports/components/ExportButtons.tsx`
- Create: `apps/backoffice/src/features/reports/components/__tests__/ExportButtons.smoke.test.tsx`
- Create: `apps/backoffice/src/features/reports/hooks/useGeneratePdf.ts`

- [ ] **Step 1: Hook `useGeneratePdf`**

```ts
// apps/backoffice/src/features/reports/hooks/useGeneratePdf.ts
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export type PdfTemplate =
  | 'pnl' | 'bs' | 'cf' | 'basket'
  | 'recipe_overview' | 'recipe_timeline'
  | 'sales_by_hour' | 'sales_by_category' | 'sales_by_staff'
  | 'stock_variance' | 'production_yield' | 'audit';

export interface GeneratePdfArgs {
  template:        PdfTemplate;
  data:            object;
  period?:         { start: string; end: string };
  filename:        string;
  comparePrevious?: { data: object };
}

export function useGeneratePdf() {
  return useMutation({
    mutationFn: async (args: GeneratePdfArgs): Promise<{ signed_url: string }> => {
      const { data, error } = await supabase.functions.invoke('generate-pdf', { body: args });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
  });
}
```

- [ ] **Step 2: Composant `<ExportButtons>`**

```tsx
// apps/backoffice/src/features/reports/components/ExportButtons.tsx
import { Button } from '@breakery/ui';
import { Download, FileText, Loader2 } from 'lucide-react';
import { buildCsv, downloadCsv, type CsvColumn } from '@breakery/domain';
import { useGeneratePdf, type GeneratePdfArgs, type PdfTemplate } from '../hooks/useGeneratePdf.js';

export interface ExportButtonsProps<T> {
  csv?: {
    rows:     T[];
    columns:  CsvColumn<T>[];
    filename: string;
  };
  pdf?: {
    template:         PdfTemplate;
    data:             object;
    period?:          { start: string; end: string };
    filename:         string;
    comparePrevious?: { data: object };
  };
  disabled?: boolean;
}

export function ExportButtons<T>({ csv, pdf, disabled }: ExportButtonsProps<T>): JSX.Element {
  const generatePdf = useGeneratePdf();

  const handleCsv = (): void => {
    if (!csv) return;
    const out = buildCsv(csv.rows, csv.columns);
    downloadCsv(out, csv.filename);
  };

  const handlePdf = async (): Promise<void> => {
    if (!pdf) return;
    const args: GeneratePdfArgs = {
      template: pdf.template,
      data: pdf.data,
      filename: pdf.filename,
    };
    if (pdf.period)          args.period = pdf.period;
    if (pdf.comparePrevious) args.comparePrevious = pdf.comparePrevious;
    const result = await generatePdf.mutateAsync(args);
    if (result.signed_url) window.open(result.signed_url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="flex items-center gap-2">
      {csv && (
        <Button variant="ghost" size="sm" onClick={handleCsv} disabled={disabled} data-testid="export-csv">
          <Download className="h-4 w-4 mr-1" /> CSV
        </Button>
      )}
      {pdf && (
        <Button variant="ghost" size="sm" onClick={handlePdf} disabled={disabled || generatePdf.isPending} data-testid="export-pdf">
          {generatePdf.isPending
            ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            : <FileText className="h-4 w-4 mr-1" />} PDF
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Smoke test**

```tsx
// apps/backoffice/src/features/reports/components/__tests__/ExportButtons.smoke.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExportButtons } from '../ExportButtons.js';

vi.mock('@breakery/domain', async (orig) => ({
  ...await orig(),
  downloadCsv: vi.fn(),
}));

const supabaseInvoke = vi.fn().mockResolvedValue({ data: { signed_url: 'https://example/signed' }, error: null });
vi.mock('@/lib/supabase.js', () => ({ supabase: { functions: { invoke: supabaseInvoke } } }));

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe('ExportButtons', () => {
  it('triggers CSV download with proper filename', async () => {
    const { downloadCsv } = await import('@breakery/domain');
    render(wrap(<ExportButtons csv={{ rows: [{ a: 1 }], columns: [{ header: 'A', accessor: (r: any) => r.a }], filename: 'test' }} />));
    fireEvent.click(screen.getByTestId('export-csv'));
    expect(downloadCsv).toHaveBeenCalled();
  });

  it('triggers PDF EF call with template/data/period and opens signed_url', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(wrap(<ExportButtons pdf={{ template: 'pnl', data: { revenue: { total: 100 } }, period: { start: '2026-05-01', end: '2026-05-31' }, filename: 'pnl' }} />));
    fireEvent.click(screen.getByTestId('export-pdf'));
    await vi.waitFor(() => expect(supabaseInvoke).toHaveBeenCalledWith('generate-pdf', expect.objectContaining({ body: expect.objectContaining({ template: 'pnl' }) })));
    await vi.waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://example/signed', '_blank', 'noopener,noreferrer'));
  });
});
```

- [ ] **Step 4: Run smoke test**

```bash
pnpm --filter @breakery/app-backoffice test ExportButtons
```
Expected: 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/src/features/reports/components/ExportButtons.tsx \
        apps/backoffice/src/features/reports/components/__tests__/ExportButtons.smoke.test.tsx \
        apps/backoffice/src/features/reports/hooks/useGeneratePdf.ts
git commit -m "feat(backoffice): session 29 — wave 4.1 — ExportButtons + useGeneratePdf (2/2 smoke PASS)"
```

### Tasks 4.2-4.5 : Migration 4 CSV existants vers helper

**Files modifiés** :
- `apps/backoffice/src/pages/reports/RecipeCostOverviewPage.tsx` (supprimer `csvCell` + `rowsToCsv` locaux → `buildCsv`)
- `apps/backoffice/src/pages/reports/RecipeCostTimelinePage.tsx` (idem)
- `apps/backoffice/src/pages/reports/ProductionYieldPage.tsx` (idem)
- `apps/backoffice/src/features/accounting/components/exportTrialBalanceCsv.ts` (idem)

- [ ] **Step 1: Pour chaque fichier**

1. Définir le `CsvColumn<T>[]` correspondant aux colonnes existantes (mapping 1-1 vers `accessor` + `format` adapté).
2. Remplacer le block `csvCell` / `rowsToCsv` / `new Blob([csv])` par :
   ```ts
   const csv = buildCsv(rows, columns);
   downloadCsv(csv, filename);
   ```
3. Supprimer le helper local.

- [ ] **Step 2: Smoke test diff identique**

Pour chaque fichier, ajouter à `__tests__/<page>.csv-helper-migration.smoke.test.tsx` :
```tsx
it('produces byte-identical output vs pre-S29 ad-hoc helper', () => {
  // 1. Construct test data
  // 2. Run buildCsv with new columns def
  // 3. Compare against fixed expected string captured before refactor
  expect(csv).toEqual(EXPECTED);
});
```

- [ ] **Step 3: Run all migrated tests**

```bash
pnpm --filter @breakery/app-backoffice test csv-helper-migration
```
Expected: 4/4 PASS.

- [ ] **Step 4: Commit (1 commit pour les 4 migrations)**

```bash
git add apps/backoffice/src/pages/reports/RecipeCostOverviewPage.tsx \
        apps/backoffice/src/pages/reports/RecipeCostTimelinePage.tsx \
        apps/backoffice/src/pages/reports/ProductionYieldPage.tsx \
        apps/backoffice/src/features/accounting/components/exportTrialBalanceCsv.ts \
        apps/backoffice/src/pages/reports/__tests__/*csv-helper-migration*
git commit -m "refactor(backoffice): session 29 — wave 4.2-4.5 — migrate 4 ad-hoc CSV exports to buildCsv helper (byte-identical, 4/4 PASS)"
```

### Tasks 4.6-4.15 : Ajouter `<ExportButtons>` sur 10 pages

**Pages cibles** (toutes hors les 4 déjà migrés) :
- SalesByHourPage, SalesByCategoryPage, SalesByStaffPage, BasketAnalysisPage
- StockVariancePage
- ProfitLossPage, BalanceSheetPage, CashFlowPage
- AuditPage (PDF + CSV via current loaded pages)
- MarginWatchPage (CSV only)

- [ ] **Step 1: Pour chaque page (pattern uniforme)**

Dans la prop `filters` de `<ReportPage>`, ajouter `<ExportButtons csv={...} pdf={...} />` à droite du `<DateRangePicker>`.

Exemple pour `ProfitLossPage.tsx` :
```tsx
const exportColumns: CsvColumn<PnlLine>[] = [
  { header: 'Code',    accessor: (r) => r.code },
  { header: 'Name',    accessor: (r) => r.name },
  { header: 'Debit',   accessor: (r) => r.debit,   format: 'idr-round100' },
  { header: 'Credit',  accessor: (r) => r.credit,  format: 'idr-round100' },
  { header: 'Balance', accessor: (r) => r.balance, format: 'idr-round100' },
];

// dans le JSX :
filters={
  <div className="flex items-center gap-3">
    <DateRangePicker .../>
    {data && (
      <ExportButtons
        csv={{ rows: data.lines, columns: exportColumns, filename: `pnl-${start}_${end}` }}
        pdf={{ template: 'pnl', data, period: { start, end }, filename: `pnl-${start}_${end}` }}
      />
    )}
  </div>
}
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```
Expected: 6/6 PASS.

- [ ] **Step 3: Commit (1 commit pour les 10 pages)**

```bash
git add apps/backoffice/src/pages/reports/*.tsx \
        apps/backoffice/src/pages/inventory/MarginWatchPage.tsx
git commit -m "feat(backoffice): session 29 — wave 4.6-4.15 — wire ExportButtons on 10 pages (CSV+PDF, MarginWatch CSV-only)"
```

---

## Wave 5 — BO Comparison (parallèle Wave 4)

> Stream Compare. Toggle "vs previous period" + 2-fetch React-Query.

### Task 5.1 : Composants `<DateRangePickerWithCompare>` + `<DeltaPct>`

**Files:**
- Create: `apps/backoffice/src/features/reports/components/DateRangePickerWithCompare.tsx`
- Create: `apps/backoffice/src/features/reports/components/DeltaPct.tsx`
- Create: `apps/backoffice/src/features/reports/components/__tests__/DateRangePickerWithCompare.smoke.test.tsx`
- Create: `apps/backoffice/src/features/reports/components/__tests__/DeltaPct.smoke.test.tsx`

- [ ] **Step 1: `<DeltaPct>`**

```tsx
// apps/backoffice/src/features/reports/components/DeltaPct.tsx
import { formatDelta } from '@breakery/domain';

export interface DeltaPctProps {
  current:  number;
  previous: number;
  /** Suffix (default '%'). */
  suffix?: string;
}

export function DeltaPct({ current, previous, suffix = '%' }: DeltaPctProps): JSX.Element {
  const { pct, sign } = formatDelta(current, previous);
  if (pct === null) return <span className="text-text-secondary text-xs">—</span>;
  const color = sign > 0 ? 'text-green-600' : sign < 0 ? 'text-red-600' : 'text-text-secondary';
  const signStr = sign > 0 ? '+' : '';
  return (
    <span className={`text-xs ${color}`} data-testid="delta-pct">
      {signStr}{(pct * 100).toFixed(1)}{suffix}
    </span>
  );
}
```

- [ ] **Step 2: `<DateRangePickerWithCompare>`**

```tsx
// apps/backoffice/src/features/reports/components/DateRangePickerWithCompare.tsx
import { DateRangePicker } from './DateRangePicker.js';

export interface DateRangePickerWithCompareProps {
  start: string;
  end:   string;
  onStartChange: (s: string) => void;
  onEndChange:   (s: string) => void;
  compare: boolean;
  onCompareChange: (c: boolean) => void;
}

export function DateRangePickerWithCompare(p: DateRangePickerWithCompareProps): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <DateRangePicker start={p.start} end={p.end} onStartChange={p.onStartChange} onEndChange={p.onEndChange} />
      <label className="flex items-center gap-1 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={p.compare}
          onChange={(e) => p.onCompareChange(e.target.checked)}
          data-testid="compare-toggle"
        />
        Compare to previous period
      </label>
    </div>
  );
}
```

- [ ] **Step 3: Smoke tests** (2 fichiers, 2-3 cas chacun) — voir spec §7.3

- [ ] **Step 4: Run tests + commit**

```bash
pnpm --filter @breakery/app-backoffice test DeltaPct DateRangePickerWithCompare
```
Expected: 5/5 PASS.

```bash
git add apps/backoffice/src/features/reports/components/DateRangePickerWithCompare.tsx \
        apps/backoffice/src/features/reports/components/DeltaPct.tsx \
        apps/backoffice/src/features/reports/components/__tests__/DateRangePickerWithCompare.smoke.test.tsx \
        apps/backoffice/src/features/reports/components/__tests__/DeltaPct.smoke.test.tsx
git commit -m "feat(backoffice): session 29 — wave 5.1 — DateRangePickerWithCompare + DeltaPct (5/5 PASS)"
```

### Tasks 5.2-5.6 : Wire 5 reports avec compare

**Pages cibles** : ProfitLoss, BalanceSheet, CashFlow, SalesByHour, SalesByCategory.

- [ ] **Step 1: Pour chaque page**

1. Remplacer `<DateRangePicker>` par `<DateRangePickerWithCompare>` + state local `compare`.
2. Si `compare === true`, calculer `prev = previousPeriod(start, end)` puis call le hook `useXxx(start, end)` ET `useXxx(prev.start, prev.end)` en parallèle.
3. Dans le rendering des KPI (ex : Revenue, COGS, Net Profit pour P&L), ajouter `<DeltaPct current={data.x} previous={prev.x} />` à droite de la valeur.

- [ ] **Step 2: Smoke test 1 fichier (P&L compare)**

```tsx
// apps/backoffice/src/features/reports/__tests__/ProfitLossPage.compare.smoke.test.tsx
// - render with compare=on
// - assert that supabase.rpc('get_profit_loss_v1', ...) is called twice (current + prev)
// - assert that delta-pct testid is rendered
```

- [ ] **Step 3: Run typecheck + tests + commit**

```bash
pnpm typecheck
pnpm --filter @breakery/app-backoffice test compare.smoke
git add apps/backoffice/src/pages/reports/ProfitLossPage.tsx \
        apps/backoffice/src/pages/reports/BalanceSheetPage.tsx \
        apps/backoffice/src/pages/reports/CashFlowPage.tsx \
        apps/backoffice/src/pages/reports/SalesByHourPage.tsx \
        apps/backoffice/src/pages/reports/SalesByCategoryPage.tsx \
        apps/backoffice/src/features/reports/__tests__/ProfitLossPage.compare.smoke.test.tsx
git commit -m "feat(backoffice): session 29 — wave 5.2-5.6 — wire compare toggle on 5 reports (P&L, BS, CF, SbH, SbC)"
```

---

## Wave 6 — BO Z-Report UI

### Task 6.1 : Hooks Z-Report

**Files:**
- Create: `apps/backoffice/src/features/cash-register/hooks/useZReports.ts`
- Create: `apps/backoffice/src/features/cash-register/hooks/useZReport.ts`
- Create: `apps/backoffice/src/features/cash-register/hooks/useSignZReport.ts`
- Create: `apps/backoffice/src/features/cash-register/hooks/useVoidZReport.ts`
- Create: `apps/backoffice/src/features/cash-register/hooks/useGenerateZReportPdf.ts`

- [ ] **Step 1: Pattern hooks**

Pour `useSignZReport` (PIN-en-header + idempotency, pattern S28) :

```ts
// apps/backoffice/src/features/cash-register/hooks/useSignZReport.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { supabase } from '@/lib/supabase.js';

export function useSignZReport() {
  const idempotencyRef = useRef<string>(crypto.randomUUID());
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ zreportId, managerPin }: { zreportId: string; managerPin: string }) => {
      const { data, error } = await supabase.rpc('sign_zreport_v1', { p_zreport_id: zreportId }, {
        headers: {
          'x-manager-pin':       managerPin,
          'x-idempotency-key':   idempotencyRef.current,
        },
      } as any);
      if (error) throw error;
      return data as { zreport_id: string; status: string; signed_at: string; signed_by: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['z_reports'] });
      idempotencyRef.current = crypto.randomUUID();
    },
  });

  return { ...mutation, resetIdempotency: () => { idempotencyRef.current = crypto.randomUUID(); } };
}
```

(Pattern analogue pour les autres hooks.)

- [ ] **Step 2: Commit**

```bash
git add apps/backoffice/src/features/cash-register/hooks/useZReports.ts \
        apps/backoffice/src/features/cash-register/hooks/useZReport.ts \
        apps/backoffice/src/features/cash-register/hooks/useSignZReport.ts \
        apps/backoffice/src/features/cash-register/hooks/useVoidZReport.ts \
        apps/backoffice/src/features/cash-register/hooks/useGenerateZReportPdf.ts
git commit -m "feat(backoffice): session 29 — wave 6.1 — 5 Z-Report hooks (PIN-en-header + idempotency)"
```

### Task 6.2 : `<SignZReportModal>` + `<VoidZReportModal>`

**Files:**
- Create: `apps/backoffice/src/features/cash-register/components/SignZReportModal.tsx`
- Create: `apps/backoffice/src/features/cash-register/components/VoidZReportModal.tsx`
- Create: `apps/backoffice/src/features/cash-register/components/__tests__/SignZReportModal.smoke.test.tsx`
- Create: `apps/backoffice/src/features/cash-register/components/__tests__/VoidZReportModal.smoke.test.tsx`

- [ ] **Step 1: Modal designs**

`<SignZReportModal>` : Dialog Radix, 2 steps (snapshot summary + PIN 6 digits), submit → `useSignZReport`, success toast + auto-open PDF.

`<VoidZReportModal>` : Dialog avec textarea reason (min 10 char enforced UI), perm gate `zreports.void`, submit → `useVoidZReport`.

(Pattern S28 `ApproveDialog` + S25 `RefundOrderModal`.)

- [ ] **Step 2: Smoke tests** (4 cas total)

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @breakery/app-backoffice test SignZReportModal VoidZReportModal
git add apps/backoffice/src/features/cash-register/components/SignZReportModal.tsx \
        apps/backoffice/src/features/cash-register/components/VoidZReportModal.tsx \
        apps/backoffice/src/features/cash-register/components/__tests__/SignZReportModal.smoke.test.tsx \
        apps/backoffice/src/features/cash-register/components/__tests__/VoidZReportModal.smoke.test.tsx
git commit -m "feat(backoffice): session 29 — wave 6.2 — SignZReportModal + VoidZReportModal (4/4 PASS)"
```

### Task 6.3 : `ZReportsListPage` + route + sidebar

**Files:**
- Create: `apps/backoffice/src/pages/cash-register/ZReportsListPage.tsx`
- Create: `apps/backoffice/src/pages/cash-register/__tests__/ZReportsListPage.smoke.test.tsx`
- Modify: `apps/backoffice/src/routes/index.tsx` (ajouter route `/cash-register/zreports`)
- Modify: `apps/backoffice/src/layouts/Sidebar.tsx` (ajouter entry "Z-Reports" sous Cash Register, icon `FileSignature`, perm `zreports.read`)

- [ ] **Step 1: Page**

Table 5 cols : `Period | Generated | Status badge | Signed by | Actions`. Filtre status + date range. Actions row : "View PDF" / "Sign" (gated zreports.sign + status='draft') / "Void" (gated zreports.void + status='signed'|'draft').

- [ ] **Step 2: Route**

```tsx
// dans routes/index.tsx, sous le bloc cash-register
<Route
  path="cash-register/zreports"
  element={
    <PermissionGate required="zreports.read">
      <ZReportsListPage />
    </PermissionGate>
  }
/>
```

- [ ] **Step 3: Sidebar entry**

```tsx
{ to: '/backoffice/cash-register/zreports', label: 'Z-Reports', icon: FileSignature, permission: 'zreports.read', indent: 1 },
```

- [ ] **Step 4: Smoke tests** (3 cas — render + filter status + sidebar visibility per perm)

- [ ] **Step 5: Run + commit**

```bash
pnpm --filter @breakery/app-backoffice test ZReportsListPage sidebar-zreports
pnpm typecheck
git add apps/backoffice/src/pages/cash-register/ZReportsListPage.tsx \
        apps/backoffice/src/pages/cash-register/__tests__/ZReportsListPage.smoke.test.tsx \
        apps/backoffice/src/routes/index.tsx \
        apps/backoffice/src/layouts/Sidebar.tsx
git commit -m "feat(backoffice): session 29 — wave 6.3 — ZReportsListPage + route + sidebar entry (3/3 PASS)"
```

### Task 6.4 : Wire close_shift_v2 flow POS → trigger generate-zreport-pdf

**Files:**
- Modify: `apps/pos/src/features/cash-register/hooks/useCloseShift.ts` (consommer v2 returns + dispatch EF)

- [ ] **Step 1: Update hook**

Le hook `useCloseShift` doit :
1. Call `close_shift_v2` (renvoie `{ zreport_id }`).
2. Chain immédiat : `supabase.functions.invoke('generate-zreport-pdf', { body: { zreport_id }, headers: { 'x-idempotency-key': crypto.randomUUID() } })`.
3. Si EF échoue, log + toast warning "PDF generation pending, retry from Z-Reports page" — pas un blocker.

- [ ] **Step 2: Test smoke POS**

`apps/pos/src/features/cash-register/__tests__/close-shift-zreport.smoke.test.tsx` :
- close_shift_v2 returns zreport_id → assert EF generate-zreport-pdf invoked
- EF failure → toast warning shown, shift still closed

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @breakery/app-pos test close-shift-zreport
git add apps/pos/src/features/cash-register/hooks/useCloseShift.ts \
        apps/pos/src/features/cash-register/__tests__/close-shift-zreport.smoke.test.tsx
git commit -m "feat(pos): session 29 — wave 6.4 — close_shift_v2 chains generate-zreport-pdf EF (non-blocking on EF failure)"
```

---

## Wave 7 — Closeout

### Task 7.1 : Full pgTAP cloud sweep

- [ ] **Step 1: Run all pgTAP suites via MCP**

```
mcp__plugin_supabase_supabase__execute_sql
project_id: ikcyvlovptebroadgtvd
query: <contenu de supabase/tests/zreports.test.sql>
```
Expected: 14/14 PASS.

- [ ] **Step 2: Regression sweep**

Run S27c (`product_variants.test.sql`) + S28 (`expense_governance.test.sql`) pour vérifier zéro régression.
Expected: 20/20 + 18/18 PASS.

### Task 7.2 : Full BO smoke sweep

```bash
pnpm --filter @breakery/app-backoffice test
```
Expected: all PASS (~100 files, ~330 tests).

### Task 7.3 : Full typecheck

```bash
pnpm typecheck
```
Expected: 6/6 PASS.

### Task 7.4 : Documentation closeout

**Files:**
- Create: `docs/workplan/plans/2026-05-24-session-29-INDEX.md`
- Modify: `CLAUDE.md` (Active Workplan section, add S29 entry)
- Modify: `docs/workplan/backlog-by-module/14-reports-analytics.md` (Status notes datées TASK-14-005 + nouvelles closes)
- Modify: `docs/workplan/backlog-by-module/12-cash-register-shift.md` (Status note TASK-12-002)
- Modify: `docs/workplan/backlog-by-module/00-roadmap-globale.md` (refresh KPIs)

- [ ] **Step 1: INDEX writeup** — mirror format S28 INDEX :
  - Header + dates + commits + base
  - §1 Spec ratification, §2 Phases livrées, §3 Deliverables par wave, §4 Tests, §5 Hooks/Components nouveaux, §6 Permissions, §7 Migrations, §8 Hors scope, §9 Status notes par TASK, §10 Deviations, §11 Closeout summary

- [ ] **Step 2: CLAUDE.md Active Workplan**

Insérer en haut de la section "Active Workplan" :
```markdown
- **Current session:** Session 29 — Reports Export + Z-Report PDF (Vague A) ✓ ready to merge `swarm/session-29` (X commits, 14 migrations block `20260606000010..023`, INDEX: ..., spec: ...). Closes TASK-14-005, TASK-12-002, gap 14-3, G1/G2/G3 audit en session. [...]
```

(Le précédent "Current session: Session 28" devient "Session 28 reference:".)

- [ ] **Step 3: Commit**

```bash
git add docs/workplan/plans/2026-05-24-session-29-INDEX.md \
        CLAUDE.md \
        docs/workplan/backlog-by-module/
git commit -m "docs(s29): wave 7 — INDEX + CLAUDE.md Active Workplan + backlog status notes"
```

### Task 7.5 : Open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin swarm/session-29
```

- [ ] **Step 2: Open PR via `gh`**

```bash
gh pr create --base master --head swarm/session-29 --title "Session 29 — Reports Export + Z-Report PDF (Vague A)" --body "$(cat <<'EOF'
## Summary
- Z-Report PDF signable au close_shift (compliance 7 ans Indonesia)
- Helper CSV centralisé + boutons CSV/PDF sur 13 pages reports
- EF generate-pdf générique (12 templates) + generate-zreport-pdf spécifique
- 2 buckets Storage : zreports/ (7 ans) + reports-exports/ (TTL 30j)
- Comparison vs previous period sur 5 reports

## Closes
- TASK-14-005 (compare toggle) — complet Vague A
- TASK-12-002 (Z-Report PDF) — complet
- Gap 14-3 (CSV/PDF uniforme) — complet sur 13 pages

## Test plan
- [x] pgTAP zreports.test.sql 14/14 PASS via cloud MCP
- [x] BO smoke (~12 new files) all PASS
- [x] POS smoke close-shift-zreport PASS
- [x] Vitest live EF tests authored (require SUPABASE_SERVICE_ROLE_KEY)
- [x] pnpm typecheck 6/6 PASS

Spec: docs/workplan/specs/2026-05-24-session-29-spec.md
INDEX: docs/workplan/plans/2026-05-24-session-29-INDEX.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review checklist

### Spec coverage

| Spec section | Task(s) | Statut |
|---|---|---|
| §2.1 Schema z_reports + ENUM + storage RLS | 1.1 ENUM, 1.2 table, 1.3 buckets, 1.4 storage RLS | ✓ |
| §2.2 RPCs (close_shift_v2, sign, void, get_snapshot) | 1.5 helper, 1.6 close_shift_v2, 1.7 sign, 1.8 void, 1.9 get_snapshot | ✓ |
| §2.3 Permissions seed | 1.10 | ✓ |
| §3.1 EF generate-pdf (12 templates) | 3.1 layout, 3.2 templates, 3.3 EF | ✓ |
| §3.2 EF generate-zreport-pdf | 3.4 EF + template | ✓ |
| §3.3 POS wiring close_shift | 6.4 | ✓ |
| §4.1 csv.ts | 2.1 | ✓ |
| §4.2 period.ts | 2.2 | ✓ |
| §5.1 ExportButtons component | 4.1 | ✓ |
| §5.2 13 pages câblées | 4.2-4.5 migration + 4.6-4.15 wiring | ✓ |
| §5.3 DateRangePickerWithCompare | 5.1 + 5.2-5.6 wiring | ✓ |
| §5.4 Z-Report UI page + modals + sidebar | 6.2 + 6.3 | ✓ |
| §5.5 Hooks | 6.1 | ✓ |
| §6 Permissions matrix | 1.10 (seed) | ✓ |
| §7 Tests (pgTAP 14, Vitest EF 12, BO smoke 18, domain unit 14) | 1.12 + 3.5 + 2.1/2.2 + tests cumulés Waves 4-6 | ✓ |
| §8 Migration block 20260606000010..035 | Toutes les Tasks 1.x | ✓ |
| §9 Waves 0..7 | Toutes les sections | ✓ |
| §10 Closes officiels | 7.4 INDEX | ✓ |
| §11 Risques | adressés inline (R1 pdf-lib esm.sh, R2 storage policy, etc.) | ✓ |

**Aucun gap spec → task détecté.**

### Placeholder scan

- ✓ Aucun "TBD", "TODO", "implement later" dans le plan
- ✓ Le SQL `_build_zreport_snapshot` est complet (pas de `... [body]`)
- ⚠️ Task 1.6 (close_shift_v2) demande de fetch v1 source avant impl — **acceptable** car le corps v1 n'est pas dans le plan (varies par déploiement). Explicité en NOTE.
- ⚠️ Tasks 3.2 (11 templates restants après le pattern pnl) : skeleton donné, code complet attendu pendant impl. **Risque modéré** : chaque template ~80 lignes pdf-lib drawing — pattern uniforme suffit pour un agent. Si execution swarm dispatché, fournir le pnl.ts comme reference + cibles dimensionnelles.

### Type consistency

- ✓ `PdfTemplate` (4.1 hook) === `TemplateName` (3.2 registry) — 12 values
- ✓ `CsvColumn<T>`, `CsvOptions`, `buildCsv`, `downloadCsv` cohérents entre 2.1 / 4.1 / 4.2-4.5
- ✓ `previousPeriod`, `formatDelta` cohérents entre 2.2 / 5.1 / 5.2-5.6
- ✓ `useSignZReport` returns `{ zreport_id, status, signed_at, signed_by }` cohérent avec RPC `sign_zreport_v1` JSONB return (Task 1.7)
- ✓ `z_reports.snapshot` shape (Task 1.5) cohérent avec `zreport.ts` template render (Task 3.4)

**Aucune incohérence détectée.**

---

## Total estimé

- **Tasks** : ~32 (granularité Wave = sub-tasks)
- **Commits** : ~25
- **Migrations** : 14 (block `20260606000010..023`)
- **EFs** : 2 (`generate-pdf`, `generate-zreport-pdf`)
- **Templates PDF** : 13 (12 reports + 1 Z-Report)
- **Pages BO modifiées** : 13 (exports) + 5 (compare) + 1 nouvelle (ZReportsListPage)
- **Hooks BO nouveaux** : 6 (`useGeneratePdf`, `useZReports`, `useZReport`, `useSignZReport`, `useVoidZReport`, `useGenerateZReportPdf`)
- **Tests nouveaux** : ~58 scenarios (14 pgTAP + 12 Vitest live EF + 18 BO smoke + 14 domain unit)
- **Effort wall-time** : ~2 jours (L) — parallélisable Waves 1+2, puis 3, puis 4+5, puis 6, puis 7
