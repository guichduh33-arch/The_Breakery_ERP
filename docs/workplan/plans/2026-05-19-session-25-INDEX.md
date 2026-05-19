# Session 25 — INDEX (Hardening Idempotency Cross-EF)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. 1 stream serial Wave 1 (DB+EF+client tightly coupled) → Wave 2 tests → Wave 3 closeout.

**Goal :** Hardening idempotency sur 2 flux mutateurs critiques. (1) `refund-order` EF : PIN body → header `x-manager-pin` (hard cutover) + wire `p_idempotency_key` au RPC `refund_order_rpc_v2` via header `x-idempotency-key`. (2) `create_tablet_order` → `create_tablet_order_v2(p_client_uuid, …)` avec table dédiée `tablet_order_idempotency_keys`, drop v1 même migration. Closes TASK-17-002 + TASK-03-006 partiel + gaps 03-1/03-2/17-1.

**Architecture :** Wave 0 (spec/INDEX/branch) serial → Wave 1 serial DB+EF+client (couplage fort) → Wave 2 tests → Wave 3 closeout serial. Cloud-only via Supabase MCP — no Docker.

**Tech Stack :** Postgres `tablet_order_idempotency_keys` table dédiée (PK = client_uuid), SECURITY DEFINER RPC v2 avec replay sur PK lookup + `EXCEPTION WHEN unique_violation` re-read, Deno helper `_shared/idempotency.ts` (1 export `getIdempotencyKey`), POS `useRef(crypto.randomUUID())` UUID lifecycle, pgTAP via MCP, Vitest live RPC.

**Date :** 2026-05-19
**Branch :** `swarm/session-25` (off `1749d92` post-S24 merge)
**Spec :** [`../specs/2026-05-19-session-25-spec.md`](../specs/2026-05-19-session-25-spec.md)
**Migration block réservé :** `20260602000010..099`
**Multi-session plan parent :** [`./2026-05-19-S24-to-S30-plan.md`](./2026-05-19-S24-to-S30-plan.md)

---

## 1. Goal global

| # | Item | Phase | Estim |
|---|------|-------|-------|
| 1 | 3 migrations DDL (`_010` table + `_011` v2 RPC + drop v1 + `_012` REVOKE anon) | 1.A | S ~45min |
| 2 | Helper `supabase/functions/_shared/idempotency.ts` | 1.A | XS ~15min |
| 3 | EF `refund-order/index.ts` : PIN header + idempotency wiring | 1.A | S ~30min |
| 4 | POS `useRefundOrder.ts` + `RefundOrderModal.tsx` : headers + UUID lifecycle | 1.A | S ~45min |
| 5 | POS `useCreateTabletOrder.ts` + caller `TabletOrderPage.tsx` : client_uuid lifecycle | 1.A | S ~45min |
| 6 | Types regen MCP + typecheck | 1.A | XS ~15min |
| 7 | pgTAP `idempotency_hardening.test.sql` (8 cas T1-T8) | 2.A | M ~1h |
| 8 | Vitest live `idempotency-hardening.test.ts` (5 scénarios TS1-TS5) | 2.A | M ~1h |
| 9 | POS smoke tablet-send-idempotent (2 cas) + refund-modal-pin-header (2 cas) | 2.A | S ~45min |
| 10 | Closeout (status notes, roadmap, CLAUDE.md Critical patterns, INDEX §10, PR) | 3.A | M ~1h |

**Total :** ~7-8h serial.

---

## 2. Architecture en vagues

```
Wave 0 (planning) — Phase 0.1
  └─► Spec ✓ + INDEX (this file) + branche `swarm/session-25` ✓
        │
        ▼
Wave 1 — Phase 1.A (1 stream serial — DB+EF+client couplage fort)
  · Sub-phase 1.A.0 — Pre-flight DB introspection (10min)
  · Sub-phase 1.A.1 — 3 migrations DDL (_010 / _011 / _012)
  · Sub-phase 1.A.2 — Helper `_shared/idempotency.ts`
  · Sub-phase 1.A.3 — EF `refund-order` modify
  · Sub-phase 1.A.4 — POS refund hook + modal
  · Sub-phase 1.A.5 — POS tablet hook + caller
  · Sub-phase 1.A.6 — Types regen
        │
        ▼
Wave 2 — Phase 2.A : tests (1 stream serial)
  · Sub-phase 2.A.1 — pgTAP 8 cas
  · Sub-phase 2.A.2 — Vitest live 5 scénarios
  · Sub-phase 2.A.3 — POS smoke tablet
  · Sub-phase 2.A.4 — POS smoke refund modal
        │
        ▼
Wave 3 — Phase 3.A : closeout
  · Quality gates final
  · Status notes 03-payments + 17-tablet-ordering
  · Roadmap globale §Sessions + §Indicateurs
  · CLAUDE.md current session + Critical patterns block enrichi
  · INDEX §10 deviations
  · Commit + push + PR
```

---

## 3. Wave 0 — Prerequisites

### Phase 0.1 — Spec + INDEX + branch

- [x] Spec dated 2026-05-19, 8 sections + 7 décisions + 6 risques.
- [x] Branche `swarm/session-25` créée off `1749d92`.
- [x] Spec commité (`8353eb0`).
- [ ] INDEX (this file) committé.

**Complexity :** S (~30min). **Suggested executor :** lead.

---

## 4. Wave 1 — Phase 1.A : DB + EF + client (1 stream serial)

**Module(s) :** 03-payments-split (refund), 17-tablet-ordering.
**Migration sub-block :** `20260602000010..012`.
**Executor :** 1 subagent `backend-dev` sonnet, name `stream-a`.

### Sub-phase 1.A.0 — Pre-flight empirical checks (10min)

Avant d'écrire la moindre migration, exécuter via MCP `execute_sql` sur `ikcyvlovptebroadgtvd` :

```sql
-- 1) Verify refund_order_rpc_v2 already has p_idempotency_key + replay
SELECT pg_get_function_identity_arguments(oid) AS args, prorettype::regtype, prosecdef
  FROM pg_proc WHERE proname='refund_order_rpc_v2' AND pronamespace='public'::regnamespace;

-- 2) Verify refunds.idempotency_key column + UNIQUE index exist
SELECT column_name, data_type, is_nullable FROM information_schema.columns
  WHERE table_name='refunds' AND column_name='idempotency_key';
SELECT indexname, indexdef FROM pg_indexes
  WHERE tablename='refunds' AND indexname='refunds_idempotency_key_uidx';

-- 3) Verify create_tablet_order v1 signature still exists
SELECT pg_get_function_identity_arguments(oid) AS args, prosecdef
  FROM pg_proc WHERE proname='create_tablet_order' AND pronamespace='public'::regnamespace;

-- 4) Verify tablet_order_idempotency_keys table does NOT yet exist
SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name='tablet_order_idempotency_keys';

-- 5) Verify create_tablet_order_v2 does NOT yet exist
SELECT proname FROM pg_proc
  WHERE proname='create_tablet_order_v2' AND pronamespace='public'::regnamespace;

-- 6) Check has_permission function signature (used by RPC)
SELECT pg_get_function_identity_arguments(oid)
  FROM pg_proc WHERE proname='has_permission' AND pronamespace='public'::regnamespace;

-- 7) Verify last applied migration to confirm clean baseline
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;

-- 8) Check ALTER DEFAULT PRIVILEGES baseline (S20 pattern)
SELECT defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl
  FROM pg_default_acl
  WHERE defaclnamespace = 'public'::regnamespace;
```

**Decisions selon résultats :**
- Si `refund_order_rpc_v2` n'a pas `p_idempotency_key` → STOP + alerter lead (le spec D2 deviendrait faux).
- Si `tablet_order_idempotency_keys` existe déjà → STOP + alerter lead.
- Si `create_tablet_order_v2` existe déjà → STOP + alerter lead.
- Si dernière migration appliquée n'est pas dans le block `20260601000xxx` (S24) → vérifier que le `_010` ne collisionne pas.

Rapport synthèse à conserver inline dans le 1er commit Wave 1.

- [ ] **Step 1** — Exécuter les 8 requêtes via MCP `execute_sql`.
- [ ] **Step 2** — Documenter les findings dans `docs/workplan/refs/2026-05-19-session-25-preflight.md`.
- [ ] **Step 3** — Commit : `docs(workplan): session 25 — phase 1.A.0 — pre-flight DB introspection`.

### Sub-phase 1.A.1 — Migrations DDL (_010 / _011 / _012)

**Fichiers :**
- `supabase/migrations/20260602000010_create_tablet_order_idempotency_keys_table.sql` (CREATE)
- `supabase/migrations/20260602000011_bump_create_tablet_order_v2.sql` (CREATE+DROP v1)
- `supabase/migrations/20260602000012_revoke_anon_create_tablet_order_v2.sql` (REVOKE)

**Steps :**

- [ ] **Step 1** — Apply `_010` via MCP `apply_migration(project_id='ikcyvlovptebroadgtvd', name='create_tablet_order_idempotency_keys_table', query=<SQL>)`. SQL :

```sql
CREATE TABLE tablet_order_idempotency_keys (
  client_uuid UUID PRIMARY KEY,
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tablet_order_idempotency_keys_order_id_idx
  ON tablet_order_idempotency_keys(order_id);

ALTER TABLE tablet_order_idempotency_keys ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE tablet_order_idempotency_keys FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE tablet_order_idempotency_keys FROM authenticated;
GRANT SELECT ON TABLE tablet_order_idempotency_keys TO authenticated;

CREATE POLICY tablet_order_idempotency_keys_select_auth
  ON tablet_order_idempotency_keys FOR SELECT
  TO authenticated USING (true);

COMMENT ON TABLE tablet_order_idempotency_keys IS
  'S25 — idempotency ledger for create_tablet_order_v2 RPC. client_uuid is generated POS-side.';
```

- [ ] **Step 2** — Apply `_011`. SQL :

```sql
-- Drop v1 (CLAUDE.md RPC versioning rule, pattern S13 refund_order_rpc)
DO $drop$
DECLARE _r RECORD;
BEGIN
  FOR _r IN SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE proname = 'create_tablet_order' AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || _r.sig::text || ' CASCADE';
  END LOOP;
END $drop$;

CREATE OR REPLACE FUNCTION create_tablet_order_v2(
  p_client_uuid  UUID,
  p_waiter_id    UUID,
  p_table_number TEXT,
  p_order_type   order_type,
  p_items        JSONB
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id            UUID;
  v_existing_order_id  UUID;
  v_order_id           UUID;
  v_order_number       TEXT;
  v_seq_number         INTEGER;
  v_item               JSONB;
  v_product_id         UUID;
  v_quantity           DECIMAL(10,3);
  v_unit_price         DECIMAL(12,2);
  v_modifiers          JSONB;
  v_modifiers_per_unit DECIMAL(12,2);
  v_modifiers_total    DECIMAL(12,2);
  v_line_total         DECIMAL(12,2);
  v_dispatch_station   TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF p_client_uuid IS NULL THEN
    RAISE EXCEPTION 'client_uuid required' USING ERRCODE = 'check_violation';
  END IF;

  -- Idempotent replay check FIRST (before permission check, before any writes)
  SELECT order_id INTO v_existing_order_id
    FROM tablet_order_idempotency_keys
    WHERE client_uuid = p_client_uuid;

  IF v_existing_order_id IS NOT NULL THEN
    RETURN v_existing_order_id;
  END IF;

  IF NOT has_permission(v_user_id, 'sales.create') THEN
    RAISE EXCEPTION 'Permission denied: sales.create' USING ERRCODE = 'P0003';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Order must contain at least one item' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO order_sequences (date, last_number)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE
      SET last_number = order_sequences.last_number + 1
    RETURNING last_number INTO v_seq_number;

  v_order_number := '#' || LPAD(v_seq_number::TEXT, 4, '0');

  INSERT INTO orders (
    order_number, order_type, status, created_via,
    waiter_id, table_number, sent_to_kitchen_at,
    subtotal, tax_amount, total
  ) VALUES (
    v_order_number, p_order_type, 'pending_payment', 'tablet',
    p_waiter_id, p_table_number, now(),
    0, 0, 0
  ) RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_product_id := (v_item->>'product_id')::UUID;
    v_quantity   := (v_item->>'quantity')::DECIMAL;
    v_unit_price := (v_item->>'unit_price')::DECIMAL;
    v_modifiers  := COALESCE(v_item->'modifiers', '[]'::jsonb);

    SELECT COALESCE(SUM((m->>'price_adjustment')::DECIMAL(12,2)), 0)
      INTO v_modifiers_per_unit
      FROM jsonb_array_elements(v_modifiers) m;

    v_modifiers_total := round_idr(v_modifiers_per_unit * v_quantity);
    v_line_total      := round_idr((v_unit_price + v_modifiers_per_unit) * v_quantity);

    SELECT c.dispatch_station
      INTO v_dispatch_station
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.id = v_product_id;

    INSERT INTO order_items (
      order_id, product_id, name_snapshot, unit_price, quantity, line_total,
      modifiers, modifiers_total, dispatch_station,
      is_locked, kitchen_status, sent_to_kitchen_at
    )
    SELECT
      v_order_id, p.id, p.name, v_unit_price, v_quantity, v_line_total,
      v_modifiers, v_modifiers_total, v_dispatch_station,
      true, 'pending', now()
    FROM products p WHERE p.id = v_product_id;
  END LOOP;

  -- Idempotency key insert : if another concurrent call won the race, re-read & return their order_id
  BEGIN
    INSERT INTO tablet_order_idempotency_keys (client_uuid, order_id)
      VALUES (p_client_uuid, v_order_id);
  EXCEPTION WHEN unique_violation THEN
    -- Concurrent insert won the race. Rollback would require SAVEPOINT — instead, accept
    -- that we created orphan order+items rows (will be cleaned by a follow-up purge if needed).
    -- Return the winner's order_id.
    SELECT order_id INTO v_existing_order_id
      FROM tablet_order_idempotency_keys
      WHERE client_uuid = p_client_uuid;
    RETURN v_existing_order_id;
  END;

  RETURN v_order_id;
END $$;

GRANT EXECUTE ON FUNCTION create_tablet_order_v2 TO authenticated;
REVOKE EXECUTE ON FUNCTION create_tablet_order_v2 FROM PUBLIC, anon;

COMMENT ON FUNCTION create_tablet_order_v2 IS
  'S25 idempotent variant — p_client_uuid generated POS-side. Replay returns the existing order_id. v1 dropped in same migration (CLAUDE.md RPC versioning rule).';
```

- [ ] **Step 3** — Apply `_012`. SQL :

```sql
-- Pattern S20 defense-in-depth : REVOKE FROM PUBLIC en plus de anon explicite.
REVOKE EXECUTE ON FUNCTION create_tablet_order_v2 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_tablet_order_v2 FROM anon;

-- Future-proof : default privileges (idempotent — ALTER DEFAULT PRIVILEGES is safe to re-run)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- Defense-in-depth pour la table d'idempotency (déjà fait dans _010, explicit ici)
REVOKE ALL ON TABLE tablet_order_idempotency_keys FROM PUBLIC, anon;
```

- [ ] **Step 4** — Smoke check via `execute_sql` :

```sql
-- Verify v1 dropped
SELECT proname FROM pg_proc WHERE proname='create_tablet_order' AND pronamespace='public'::regnamespace;
-- expect: 0 rows

-- Verify v2 exists
SELECT pg_get_function_identity_arguments(oid) FROM pg_proc
  WHERE proname='create_tablet_order_v2' AND pronamespace='public'::regnamespace;
-- expect: 1 row, args=p_client_uuid uuid, p_waiter_id uuid, p_table_number text, p_order_type order_type, p_items jsonb

-- Verify table + index + policy exist
SELECT table_name FROM information_schema.tables WHERE table_name='tablet_order_idempotency_keys';
SELECT indexname FROM pg_indexes WHERE tablename='tablet_order_idempotency_keys';
SELECT policyname FROM pg_policies WHERE tablename='tablet_order_idempotency_keys';

-- Verify anon REVOKE
SELECT has_function_privilege('anon', 'create_tablet_order_v2(uuid, uuid, text, order_type, jsonb)', 'EXECUTE');
-- expect: false
```

- [ ] **Step 5** — Commit : `feat(db): session 25 — phase 1.A.1 — create_tablet_order_v2 + idempotency table + REVOKE anon`.

### Sub-phase 1.A.2 — Helper `_shared/idempotency.ts`

**Fichier :** `supabase/functions/_shared/idempotency.ts` (NEW)

- [ ] **Step 1** — Read `supabase/functions/_shared/manager-pin.ts` pour pattern (style export, error classes).

- [ ] **Step 2** — Write the file :

```ts
// supabase/functions/_shared/idempotency.ts
// S25 — read x-idempotency-key header, UUID v4 validation.
// Returns string|null. If `required: true` and header is absent, throws.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MissingIdempotencyKeyError extends Error {
  readonly code = 'missing_idempotency_key';
  constructor(message = 'x-idempotency-key header required') {
    super(message);
    this.name = 'MissingIdempotencyKeyError';
  }
}

export class InvalidIdempotencyKeyError extends Error {
  readonly code = 'invalid_idempotency_key';
  constructor(message = 'x-idempotency-key must be UUID v4') {
    super(message);
    this.name = 'InvalidIdempotencyKeyError';
  }
}

export function getIdempotencyKey(
  req: Request,
  opts: { required?: boolean } = {},
): string | null {
  const raw = req.headers.get('x-idempotency-key');
  if (!raw) {
    if (opts.required) throw new MissingIdempotencyKeyError();
    return null;
  }
  if (!UUID_REGEX.test(raw)) {
    throw new InvalidIdempotencyKeyError();
  }
  return raw;
}
```

- [ ] **Step 3** — Commit : `feat(edge): session 25 — phase 1.A.2 — _shared/idempotency.ts helper`.

### Sub-phase 1.A.3 — EF `refund-order/index.ts` modify

**Fichier :** `supabase/functions/refund-order/index.ts` (MODIFY)

- [ ] **Step 1** — Read current file (already done — see spec §4.2.2). Identify all references to `body.manager_pin`, `RefundOrderPayload.manager_pin`.

- [ ] **Step 2** — Apply the diff :
  - Drop `manager_pin: string;` from `RefundOrderPayload` interface (line ~27).
  - Insert import : `import { getIdempotencyKey, InvalidIdempotencyKeyError } from '../_shared/idempotency.ts';`
  - After `if (req.method !== 'POST')` block (line ~34), insert PIN header read :

```ts
const managerPin = req.headers.get('x-manager-pin');
if (!managerPin || managerPin.trim().length === 0) {
  return jsonResponse({ error: 'missing_manager_pin' }, 400);
}

let idempotencyKey: string | null = null;
try {
  idempotencyKey = getIdempotencyKey(req);
} catch (err) {
  if (err instanceof InvalidIdempotencyKeyError) {
    return jsonResponse({ error: err.code, message: err.message }, 400);
  }
  throw err;
}
```

  - Drop the body validation block for `body.manager_pin` (lines ~81-83).
  - Change `verifyManagerPin(body.manager_pin)` → `verifyManagerPin(managerPin)` (line ~85).
  - Change the RPC call (line ~101-107) to pass `p_idempotency_key`:

```ts
const { data, error } = await userClient.rpc('refund_order_rpc_v2', {
  p_order_id:        body.order_id,
  p_lines:           body.lines,
  p_tenders:         body.tenders,
  p_reason:          body.reason,
  p_authorized_by:   mgr.manager_profile_id,
  p_idempotency_key: idempotencyKey,
});
```

  - After successful RPC + before final `return jsonResponse(...)` (line ~119), insert replay audit log :

```ts
if (data?.idempotent_replay === true) {
  await userClient.from('audit_logs').insert({
    actor_id:    mgr.manager_profile_id,
    action:      'refund.replay',
    entity_type: 'orders',
    entity_id:   body.order_id,
    metadata: {
      idempotency_key: idempotencyKey,
      refund_id:       data.refund_id,
    },
  });
}
```

- [ ] **Step 3** — Verify locally : `pnpm --filter @breakery/supabase exec deno check supabase/functions/refund-order/index.ts` (si deno installé) ou simplement re-read pour cohérence.

- [ ] **Step 4** — Commit : `feat(edge): session 25 — phase 1.A.3 — refund-order PIN header + idempotency wiring`.

### Sub-phase 1.A.4 — POS `useRefundOrder` + `RefundOrderModal`

**Fichiers :**
- `apps/pos/src/features/order-history/hooks/useRefundOrder.ts` (MODIFY)
- `apps/pos/src/features/order-history/components/RefundOrderModal.tsx` (MODIFY)

- [ ] **Step 1** — Read both files to confirm current shape (hook already read — see spec §4.2.3 ; modal not yet read).

- [ ] **Step 2** — Update `useRefundOrder.ts` :
  - Add `idempotencyKey?: string` to `RefundArgs` interface.
  - Update `mutationFn` headers + body :

```ts
mutationFn: async ({ orderId, lines, tenders, reason, managerPin, idempotencyKey }: RefundArgs): Promise<RefundResponse> => {
  const accessToken = await getAccessToken();
  const headers: Record<string, string> = {
    'Content-Type':   'application/json',
    Authorization:    `Bearer ${accessToken}`,
    'x-manager-pin':  managerPin,
  };
  if (idempotencyKey) headers['x-idempotency-key'] = idempotencyKey;

  const res = await fetch(`${supabaseUrl}/functions/v1/refund-order`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      order_id: orderId,
      lines,
      tenders,
      reason,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as RefundResponse;
    throw Object.assign(new Error(err.error ?? 'refund_failed'), { details: err, status: res.status });
  }
  return await res.json() as RefundResponse;
},
```

- [ ] **Step 3** — Update `RefundOrderModal.tsx` :
  - Add `import { useRef } from 'react';` if not already imported.
  - In the component body, before the submit handler : `const idempotencyKeyRef = useRef<string>(crypto.randomUUID());`
  - In the submit handler call site, pass `idempotencyKey: idempotencyKeyRef.current` along with the existing args.
  - In the modal `onOpenChange` / dismiss handler, reset : `idempotencyKeyRef.current = crypto.randomUUID();` (so next open gets fresh UUID).
  - On submit success, also reset the ref via the same line in the success cleanup.

- [ ] **Step 4** — Run `pnpm --filter @breakery/app-pos typecheck` — expect green.

- [ ] **Step 5** — Commit : `feat(pos): session 25 — phase 1.A.4 — refund modal PIN header + idempotency UUID lifecycle`.

### Sub-phase 1.A.5 — POS `useCreateTabletOrder` + caller

**Fichiers :**
- `apps/pos/src/features/tablet/hooks/useCreateTabletOrder.ts` (MODIFY)
- `apps/pos/src/features/tablet/TabletOrderPage.tsx` (MODIFY — locate the caller of useCreateTabletOrder)

- [ ] **Step 1** — Read `TabletOrderPage.tsx` to find the `.mutate(...)` call site and understand the UUID generation point (probably tied to the "Send to kitchen" button).

- [ ] **Step 2** — Update `useCreateTabletOrder.ts` :

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { buildSubmitPayload } from '@breakery/domain';
import type { TabletCart } from '@breakery/domain';
import type { Json } from '@breakery/supabase';
import { supabase } from '@/lib/supabase';

interface CreateTabletOrderArgs {
  cart:        TabletCart;
  waiterId:    string;
  clientUuid:  string;
}

export function useCreateTabletOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ cart, waiterId, clientUuid }: CreateTabletOrderArgs) => {
      const payload = buildSubmitPayload(cart, waiterId);
      const { data, error } = await supabase.rpc('create_tablet_order_v2', {
        p_client_uuid:  clientUuid,
        p_waiter_id:    payload.p_waiter_id,
        p_table_number: payload.p_table_number ?? '',
        p_order_type:   payload.p_order_type,
        p_items:        payload.p_items as unknown as Json,
      });
      if (error) throw Object.assign(new Error(error.message), { details: error });
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tablet-orders'] });
    },
  });
}
```

- [ ] **Step 3** — Update `TabletOrderPage.tsx` caller :
  - Import `useRef` if not already imported.
  - Add `const clientUuidRef = useRef<string>(crypto.randomUUID());` near the cart state.
  - At the `.mutate(...)` call site, pass `clientUuid: clientUuidRef.current` along with existing `cart` + `waiterId`.
  - On mutation success (after cart cleared), reset : `clientUuidRef.current = crypto.randomUUID();` so the next order gets a fresh UUID.

- [ ] **Step 4** — Run `pnpm --filter @breakery/app-pos typecheck` — expect green (might fail if `Database['public']['Functions']` types are stale ; sub-phase 1.A.6 will fix).

- [ ] **Step 5** — Commit : `feat(pos): session 25 — phase 1.A.5 — useCreateTabletOrder v2 + client_uuid lifecycle`.

### Sub-phase 1.A.6 — Types regen post-Wave 1

**Fichier :** `packages/supabase/src/types.generated.ts` (MODIFY via MCP)

- [ ] **Step 1** — Regen via MCP `generate_typescript_types(project_id='ikcyvlovptebroadgtvd')`.

- [ ] **Step 2** — Write result to `packages/supabase/src/types.generated.ts`.

- [ ] **Step 3** — `pnpm typecheck` global — expect green (after regen, `create_tablet_order_v2` should appear in `Database['public']['Functions']` and `create_tablet_order` should disappear).

- [ ] **Step 4** — Commit : `chore(types): session 25 — phase 1.A.6 — regen post idempotency hardening migrations`.

**DoD Wave 1 :**

- 3 migrations DDL appliquées sur V3 dev cloud (verifiable via `list_migrations`).
- `_shared/idempotency.ts` créé.
- `refund-order` EF accepte uniquement `x-manager-pin` header, propage `p_idempotency_key`.
- 4 fichiers POS modifiés avec UUID lifecycle via `useRef`.
- `pnpm typecheck` global green.
- 6-7 commits sur `swarm/session-25`.

**Complexity :** L (~3-4h). **Dependencies :** Phase 0.1.

---

## 5. Wave 2 — Phase 2.A : tests (1 stream serial)

**Module(s) :** 03-payments-split, 17-tablet-ordering.
**Executor :** 1 subagent `tester` sonnet, name `stream-tests`, **après** Wave 1.

### Sub-phase 2.A.1 — pgTAP `idempotency_hardening.test.sql`

**Fichier :** `supabase/tests/idempotency_hardening.test.sql` (NEW)

- [ ] **Step 1** — Read `supabase/tests/b2b_foundation.test.sql` (S24) + `supabase/tests/inventory.test.sql` pour pattern (fixtures, role switching, plan, BEGIN/ROLLBACK).

- [ ] **Step 2** — Author 8 cas T1-T8 :

```sql
BEGIN;
SET LOCAL search_path = public;
SELECT plan(8);

-- Bootstrap : manager user_profile + cashier user_profile + pos_session open + product + paid order for refund tests
-- (see b2b_foundation.test.sql bootstrap pattern for exact statements)

-- T1 : create_tablet_order_v2 first call inserts orders + idempotency key
SELECT lives_ok(
  $$ SELECT create_tablet_order_v2('11111111-1111-1111-1111-111111111111'::uuid, ...) $$,
  'T1: create_tablet_order_v2 first call succeeds'
);

-- T2 : create_tablet_order_v2 same client_uuid second call returns same order_id, no double INSERT
SELECT is(
  (SELECT create_tablet_order_v2('11111111-1111-1111-1111-111111111111'::uuid, ...)),
  (SELECT order_id FROM tablet_order_idempotency_keys WHERE client_uuid='11111111-1111-1111-1111-111111111111'),
  'T2: same client_uuid returns same order_id'
);
SELECT is(
  (SELECT COUNT(*) FROM orders WHERE created_via='tablet' AND ...),
  1::bigint,
  'T2: COUNT(orders) unchanged after replay'
);

-- T3 : create_tablet_order v1 dropped
SELECT hasnt_function('public', 'create_tablet_order', 'T3: v1 dropped');

-- T4 : refund_order_rpc_v2 first call with p_idempotency_key
SELECT lives_ok(
  $$ SELECT refund_order_rpc_v2(...p_idempotency_key:='22222222-2222-2222-2222-222222222222'::uuid) $$,
  'T4: refund first call succeeds'
);

-- T5 : refund_order_rpc_v2 same idempotency_key replay
SELECT is(
  (SELECT (refund_order_rpc_v2(...p_idempotency_key:='22222222-2222-2222-2222-222222222222'::uuid))->>'idempotent_replay'),
  'true',
  'T5: refund replay returns idempotent_replay=true'
);
SELECT is(
  (SELECT COUNT(*) FROM stock_movements WHERE reference_id IN (SELECT id FROM refunds WHERE idempotency_key='22222222-2222-2222-2222-222222222222')),
  <expected_count>::bigint,
  'T5: stock_movements not duplicated on replay'
);

-- T6 : tablet_order_idempotency_keys REVOKE anon
SELECT is(
  has_table_privilege('anon', 'tablet_order_idempotency_keys', 'SELECT'),
  false,
  'T6: anon has no SELECT on idempotency table'
);

-- T7 : authenticated can SELECT idempotency table
SELECT is(
  has_table_privilege('authenticated', 'tablet_order_idempotency_keys', 'SELECT'),
  true,
  'T7: authenticated can SELECT idempotency table'
);

-- T8 : create_tablet_order_v2 EXECUTE REVOKE for anon
SELECT is(
  has_function_privilege('anon', 'create_tablet_order_v2(uuid, uuid, text, order_type, jsonb)', 'EXECUTE'),
  false,
  'T8: anon has no EXECUTE on create_tablet_order_v2'
);

SELECT * FROM finish();
ROLLBACK;
```

(L'executor remplit les bootstrap fixtures + `<expected_count>` selon le pattern S24.)

- [ ] **Step 3** — Run via MCP `execute_sql` avec BEGIN/ROLLBACK envelope déjà dans le fichier.

- [ ] **Step 4** — Expect 8/8 passes. Si fail : itération.

- [ ] **Step 5** — Commit : `test(db): session 25 — phase 2.A.1 — pgTAP idempotency_hardening 8 cas`.

### Sub-phase 2.A.2 — Vitest live `idempotency-hardening.test.ts`

**Fichier :** `supabase/tests/functions/idempotency-hardening.test.ts` (NEW)

- [ ] **Step 1** — Read `supabase/tests/functions/inventory-*.test.ts` ou S24 `record-b2b-payment.test.ts` pour pattern (bootstrap via service-role client, supabase-js anon for RPC calls, cleanup `afterAll`).

- [ ] **Step 2** — Author 5 scénarios TS1-TS5 :

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const URL          = process.env.SUPABASE_URL!;
const ANON         = process.env.SUPABASE_ANON_KEY!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

describe('S25 idempotency hardening', () => {
  let admin: ReturnType<typeof createClient>;
  let user:  ReturnType<typeof createClient>;
  // bootstrap state : userProfileId, productId, paidOrderId for refund tests

  beforeAll(async () => {
    admin = createClient(URL, SERVICE_ROLE);
    // (...bootstrap test customer/product/session/paid order via admin client...)
    // (...sign in test user via PIN to get JWT, build `user` client...)
  });

  afterAll(async () => {
    // cleanup : delete idempotency_keys, orders, refunds, stock_movements created during tests
  });

  it('TS1: create_tablet_order_v2 happy path', async () => {
    const clientUuid = crypto.randomUUID();
    const { data, error } = await user.rpc('create_tablet_order_v2', {
      p_client_uuid: clientUuid,
      p_waiter_id:   userProfileId,
      p_table_number: 'T1',
      p_order_type:  'dine_in',
      p_items:       [{ product_id: productId, quantity: 1, unit_price: 25000 }],
    });
    expect(error).toBeNull();
    expect(data).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('TS2: retry-with-same-client-uuid returns same order', async () => {
    const clientUuid = crypto.randomUUID();
    const first  = await user.rpc('create_tablet_order_v2', { p_client_uuid: clientUuid, ... });
    const second = await user.rpc('create_tablet_order_v2', { p_client_uuid: clientUuid, ... });
    expect(second.data).toEqual(first.data);
    // verify only one order exists with this client_uuid
    const { data: keys } = await admin
      .from('tablet_order_idempotency_keys')
      .select('order_id')
      .eq('client_uuid', clientUuid);
    expect(keys).toHaveLength(1);
  });

  it('TS3: refund-order EF with x-manager-pin + x-idempotency-key happy path', async () => {
    const idemKey = crypto.randomUUID();
    const res = await fetch(`${URL}/functions/v1/refund-order`, {
      method: 'POST',
      headers: {
        'Content-Type':     'application/json',
        Authorization:      `Bearer ${userAccessToken}`,
        'x-manager-pin':    managerPin,
        'x-idempotency-key': idemKey,
      },
      body: JSON.stringify({ order_id: paidOrderId, lines: [...], tenders: [...], reason: 'test refund' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.idempotent_replay).toBe(false);
  });

  it('TS4: refund-order EF retry same idempotency_key returns replay envelope', async () => {
    const idemKey = crypto.randomUUID();
    // first call : succeeds
    await fetch(...);
    // second call : same idemKey
    const res = await fetch(...);
    const body = await res.json();
    expect(body.idempotent_replay).toBe(true);
    // verify audit_logs.action='refund.replay' entry exists
    const { data: audit } = await admin
      .from('audit_logs')
      .select('action, metadata')
      .eq('action', 'refund.replay')
      .eq('metadata->>idempotency_key', idemKey);
    expect(audit).toHaveLength(1);
  });

  it('TS5: refund-order EF without x-manager-pin returns 400', async () => {
    const res = await fetch(`${URL}/functions/v1/refund-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${userAccessToken}`,
        // x-manager-pin OMITTED
      },
      body: JSON.stringify({ order_id: paidOrderId, lines: [...], tenders: [...], reason: 'test' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing_manager_pin');
  });
});
```

- [ ] **Step 3** — Run : `cd supabase/tests && npx vitest run functions/idempotency-hardening`.

- [ ] **Step 4** — Vérifier 5/5 passes. Cleanup propre via `afterAll`.

- [ ] **Step 5** — Commit : `test(db,supabase): session 25 — phase 2.A.2 — Vitest live idempotency hardening 5 scénarios`.

### Sub-phase 2.A.3 — POS smoke tablet-send-idempotent

**Fichier :** `apps/pos/src/features/tablet/__tests__/tablet-send-idempotent.smoke.test.tsx` (NEW)

- [ ] **Step 1** — Read `apps/pos/src/features/tablet/__tests__/TabletOrderPage.test.tsx` pour pattern (mock supabase rpc, render component with QueryClientProvider).

- [ ] **Step 2** — Author 2 cas :

```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreateTabletOrder } from '../hooks/useCreateTabletOrder';

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}));

import { supabase } from '@/lib/supabase';

describe('S25 useCreateTabletOrder — idempotency wiring', () => {
  it('passes the provided clientUuid as p_client_uuid', async () => {
    (supabase.rpc as any).mockResolvedValue({ data: 'order-id-1', error: null });
    const qc = new QueryClient();
    const wrapper = ({ children }: any) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useCreateTabletOrder(), { wrapper });
    const myUuid = '11111111-1111-1111-1111-111111111111';
    // TabletCart shape from @breakery/domain — see buildSubmitPayload tests for example.
    // Minimal valid cart : { items: [{ product_id, quantity, unit_price, modifiers: [] }], table_number?, order_type }
    const minimalCart = { items: [{ product_id: 'p-1', quantity: 1, unit_price: 25000, modifiers: [] }], table_number: 'T1', order_type: 'dine_in' as const };
    await act(async () => {
      await result.current.mutateAsync({ cart: minimalCart as any, waiterId: 'w-1', clientUuid: myUuid });
    });
    expect(supabase.rpc).toHaveBeenCalledWith('create_tablet_order_v2',
      expect.objectContaining({ p_client_uuid: myUuid }));
  });

  it('retry with same clientUuid passes the same UUID to RPC', async () => {
    (supabase.rpc as any).mockResolvedValue({ data: 'order-id-1', error: null });
    // ... same as TS1 ; call mutate twice with same clientUuid ;
    // assert both calls received same p_client_uuid
  });
});
```

- [ ] **Step 3** — Run : `pnpm --filter @breakery/app-pos test tablet-send-idempotent`.

- [ ] **Step 4** — Commit : `test(pos): session 25 — phase 2.A.3 — tablet send idempotent smoke (2 cas)`.

### Sub-phase 2.A.4 — POS smoke refund-modal-pin-header

**Fichier :** `apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx` (NEW)

- [ ] **Step 1** — Read `apps/pos/src/features/order-history/components/RefundOrderModal.tsx` (modifié en 1.A.4) pour cibler le test correctement.

- [ ] **Step 2** — Author 2 cas :
  - Cas 1 : ouvre le modal, submit refund. Vérifie via fetch mock que les headers `x-manager-pin` et `x-idempotency-key` sont présents et que `manager_pin` n'est PAS dans le body JSON.
  - Cas 2 : ouvre le modal, capture le UUID. Submit échoue (réseau). Retry → même UUID. Close modal + reopen → nouveau UUID.

```tsx
// pattern : mock global fetch + render RefundOrderModal + assert headers
import { describe, it, expect, vi, beforeEach } from 'vitest';
// ...
```

- [ ] **Step 3** — Run : `pnpm --filter @breakery/app-pos test refund-modal-pin-header`.

- [ ] **Step 4** — Commit : `test(pos): session 25 — phase 2.A.4 — refund modal PIN header + UUID lifecycle smoke (2 cas)`.

**DoD Wave 2 :**

- pgTAP 8/8 passes
- Vitest live 5/5 passes
- POS smoke 4/4 passes
- `pnpm typecheck && pnpm build` global green
- 4 commits sur `swarm/session-25`

**Complexity :** M+ (~3h). **Dependencies :** Wave 1 DONE.

---

## 6. Wave 3 — Closeout (Phase 3.A)

**Fichiers :**
- `docs/workplan/backlog-by-module/03-payments-split.md` (MODIFY)
- `docs/workplan/backlog-by-module/17-tablet-ordering.md` (MODIFY)
- `docs/workplan/backlog-by-module/00-roadmap-globale.md` (MODIFY)
- `docs/workplan/plans/2026-05-19-session-25-INDEX.md` (MODIFY — fill §10)
- `CLAUDE.md` (MODIFY — bump current session pointer + Critical patterns block enrichi)

**Steps :**

- [ ] **Step 1** — Final quality gates : `pnpm typecheck && pnpm build && pnpm exec turbo run test --concurrency=1`. Documenter timing dans le commit closeout si flaky.

- [ ] **Step 2** — Status notes :
  - `03-payments-split.md` :
    - TASK-03-006 (refund hardening) : `**Status note (2026-05-19)** : S25 update — PARTIAL DONE. refund-order EF migré PIN body → header x-manager-pin (hard cutover). p_idempotency_key propagé au RPC refund_order_rpc_v2 existant via header x-idempotency-key. POS useRefundOrder.ts + RefundOrderModal.tsx mis à jour avec useRef(crypto.randomUUID()) lifecycle. Closes gaps 03-1, 03-2. Reste deferred : sweep autres EF mutateurs (void-order, cancel-item) — backlog post-S30.`
    - Ajouter section `## S25 deliverables` : 2 gaps fermés + référence INDEX.
  - `17-tablet-ordering.md` :
    - TASK-17-002 (tablet idempotency) : `**Status note (2026-05-19)** : S25 update — DONE. create_tablet_order → create_tablet_order_v2(p_client_uuid UUID, ...) avec table dédiée tablet_order_idempotency_keys. v1 dropped same migration. POS useCreateTabletOrder + TabletOrderPage migrés avec useRef UUID lifecycle. Closes gap 17-1. Tablet PWA offline queue (TASK-17-001) reste deferred — S25 fournit le pré-requis (idempotence online).`
    - Ajouter section `## S25 deliverables`.

- [ ] **Step 3** — Roadmap globale :
  - §Sessions complétées : ajouter ligne S25 (date, branch, thème, commits, migrations count).
  - §Indicateurs : ajouter 2 lignes :
    - `refund-order idempotent | enabled | DONE S25 (p_idempotency_key wired via x-idempotency-key header)`
    - `create_tablet_order idempotent | enabled | DONE S25 (create_tablet_order_v2 avec p_client_uuid + table dédiée)`
    - `PIN-en-header pattern | enabled | DONE S25 (hard cutover refund-order ; pattern à étendre aux autres EF managériaux S26+)`
  - §Actifs : retirer "refund double-click bug" si listé.

- [ ] **Step 4** — CLAUDE.md `## Active Workplan` : bump current session pointer vers S25 ; garder S24 en "Previous session".

- [ ] **Step 5** — CLAUDE.md `### Critical patterns` block : ajouter 2 paragraphes :

```markdown
- **PIN/auth secrets en header HTTP (pas en body JSON)** — Les EFs qui consomment un PIN manager ou tout autre secret de validation doivent le lire via header HTTP (e.g., `x-manager-pin`), JAMAIS depuis le body JSON. Raison : le body est journalisé par défaut dans les access logs / pgaudit / proxies HTTP, le header l'est moins. Hard cutover pattern : drop le champ body en même temps que l'ajout du header read (pas de fallback dual-mode sauf si caller externe non maîtrisé). Référence : S25 `refund-order` migration body → header `x-manager-pin`.

- **Idempotency 2-flavors selon la sémantique** — Deux patterns coexistent :
  1. **HTTP `x-idempotency-key` header (EF retry safety)** — Pour les requêtes HTTP retry-safe à l'EF (réseau flaky, double-click). Le client génère une UUID v4 et l'envoie via header. L'EF lit via `getIdempotencyKey()` (helper `_shared/idempotency.ts`) et propage en arg RPC. Pattern : `refund-order` EF (S25).
  2. **RPC arg `p_client_uuid` / `p_idempotency_key` (idempotence sémantique métier)** — Pour les RPCs où l'idempotence est intrinsèque au flow (e.g., "ce panier-ci" pour tablet, "ce paiement-ci" pour B2B). L'arg est obligatoire, validé NOT NULL côté RPC, et utilisé comme PK d'une table dédiée d'idempotency keys (jamais comme colonne sur la table métier — isole, REVOKE plus simple). Patterns : `create_tablet_order_v2(p_client_uuid)` (S25), `record_b2b_payment_v1(p_idempotency_key)` (S24), `record_stock_movement_v1` & co (S12). Le replay returne le résultat de la première exécution.
```

- [ ] **Step 6** — Fill INDEX §10 deviations (post-execution). Format `DEV-S25-1.A-NN` / `DEV-S25-2.A-NN` / `DEV-S25-3.A-NN`. All informational unless marked otherwise.

- [ ] **Step 7** — Final commit closeout + push :

```bash
git push -u origin swarm/session-25
gh pr create --title "session 25 — Hardening Idempotency Cross-EF (refund PIN header + tablet client_uuid)" --body "$(cat <<'EOF'
## Summary

Closes **TASK-17-002** (tablet idempotency), **TASK-03-006 partiel** (refund PIN-en-header + idempotency wiring), gaps audit **03-1** / **03-2** / **17-1**.

Hardening ciblé sur 2 flux mutateurs identifiés par l'audit S23 §2 comme exposant un risque de double-effet (double refund, double tablet order).

**DB :**
- 3 migrations (`20260602000010..012`) : `tablet_order_idempotency_keys` table dédiée (PK = client_uuid), `create_tablet_order_v2(p_client_uuid, ...)` avec idempotent replay + drop v1 dans la même migration, REVOKE anon defense-in-depth.
- **Pas de bump refund_order_rpc** — découverte brainstorming : v2 (S13) a déjà `p_idempotency_key` + replay envelope + `refunds.idempotency_key UNIQUE`.

**EF :**
- `_shared/idempotency.ts` helper (1 export `getIdempotencyKey`).
- `refund-order` EF : PIN body → header `x-manager-pin` (hard cutover). Wire `x-idempotency-key` header → `p_idempotency_key` RPC arg. Log `audit_logs.action='refund.replay'` sur replay hit.

**POS :**
- `useRefundOrder.ts` + `RefundOrderModal.tsx` : envoient `x-manager-pin` + `x-idempotency-key` via headers. `useRef(crypto.randomUUID())` lifecycle preserves UUID across re-renders/retries, resets on dismiss.
- `useCreateTabletOrder.ts` + `TabletOrderPage.tsx` : signature avec `clientUuid` requis, RPC v2. Même UUID lifecycle.

**CLAUDE.md :**
- `Critical patterns` enrichi : bloc "PIN-en-header (pas en body)" + bloc "Idempotency 2-flavors (header HTTP vs RPC arg)".

**Tests :**
- pgTAP `idempotency_hardening.test.sql` 8 cas T1-T8.
- Vitest live `idempotency-hardening.test.ts` 5 scénarios TS1-TS5.
- POS smoke : 2 cas tablet + 2 cas refund modal.

**Out of scope (déféré post-S25) :** sweep autres EF mutateurs (void-order, cancel-item, kiosk-issue-jwt) — backlog post-S30 ; pg_cron purge idempotency tables — laissé ou S26 batch ; BO refund UI — n'existe pas en V3.

## Test plan
- [ ] pgTAP `idempotency_hardening.test.sql` 8/8 via cloud MCP.
- [ ] Vitest live `cd supabase/tests && npx vitest run functions/idempotency-hardening`.
- [ ] `pnpm --filter @breakery/app-pos test tablet-send-idempotent` + `pnpm --filter @breakery/app-pos test refund-modal-pin-header` green.
- [ ] `pnpm typecheck && pnpm build && pnpm test --concurrency=1` green.
- [ ] Manual UI : POS open tablet order page, "Send to kitchen", double-click button → 1 order (no double); POS open refund modal, force network retry on PIN failure → no double refund.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

**Complexity :** M (~1h). **Dependencies :** Wave 2 DONE.

---

## 7. Parallelization map

| Wave | Phases | Parallel streams | Estim h wall-time |
|------|--------|------------------|-------------------|
| 0 | 0.1 | sequential | 0.5 |
| 1 | 1.A | sequential (DB→EF→client couplage fort) | 3-4 |
| 2 | 2.A.1 → 2.A.4 | sequential (4 sub-phases) | 3 |
| 3 | 3.A | sequential | 1 |
| **TOTAL** | **5 phases** | — | **~7-8h wall-time serial** |

---

## 8. Comms entre subagents

```
lead (Claude)
  └──► stream-a (backend-dev sonnet, run_in_background)
        · Pre-flight checks
        · 3 DDL migrations (table + v2 RPC + REVOKE)
        · _shared/idempotency.ts helper
        · refund-order EF modify
        · POS useRefundOrder + RefundOrderModal
        · POS useCreateTabletOrder + TabletOrderPage
        · Types regen

After stream-a completes + commits, lead :
  └──► stream-tests (tester sonnet)
        · pgTAP 8 cas
        · Vitest live 5 scénarios
        · POS smoke tablet (2 cas)
        · POS smoke refund modal (2 cas)

After stream-tests complete + commits, lead :
  └──► closeout serial
        · Quality gates
        · Status notes + roadmap
        · CLAUDE.md Critical patterns enrichi
        · INDEX §10
        · PR
```

---

## 9. Out of scope (déféré S26+)

- Sweep autres EF mutateurs (`void-order`, `cancel-item`, `kiosk-issue-jwt` mutations) — backlog post-S30.
- pg_cron purge des tables idempotency — peut s'intégrer S26 (Comptable Cockpit batch) ou rester sans purge.
- BO refund UI — n'existe pas en V3, sera ajouté post-S30 si besoin (utilisera le même EF).
- Tablet PWA offline queue + sync (TASK-17-001) — reste deferred. S25 fournit le pré-requis idempotence online.
- Migration `useRefundOrder.ts` vers `supabase.functions.invoke()` — conservé en `fetch()` raw, pas de refactor de surface.

---

## 10. Deviation packs (Session 25 → Session 26+)

*Finalized post-execution Phase 3.A. Format `DEV-S25-1.A-NN` / `DEV-S25-2.A-NN` / `DEV-S25-3.A-NN`. All informational unless marked otherwise.*

### Wave 1 (DB + EF + client)

*To fill post-execution.*

### Wave 2 (tests)

*To fill post-execution.*

### Wave 3 (closeout)

*To fill post-execution.*
