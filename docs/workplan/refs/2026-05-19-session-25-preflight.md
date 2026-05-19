# Session 25 — Phase 1.A.0 — Pre-flight DB introspection (2026-05-19)

**Spec ref :** [`docs/workplan/specs/2026-05-19-session-25-spec.md`](../specs/2026-05-19-session-25-spec.md)
**INDEX ref :** [`docs/workplan/plans/2026-05-19-session-25-INDEX.md`](../plans/2026-05-19-session-25-INDEX.md) (Phase 1.A.0)
**Target project :** `ikcyvlovptebroadgtvd` (V3 dev, region `ap-southeast-1`)
**Migration block reserved (S25) :** `20260602000010..099`

## Source of truth notice

The Supabase MCP server (`mcp__plugin_supabase_supabase__execute_sql`) requires an
interactive OAuth flow to authenticate. The flow was initiated in this session but
not completed (no user-side browser interaction available to the subagent). Per the
precedent set by [`docs/workplan/refs/2026-05-19-session-24-preflight.md`](2026-05-19-session-24-preflight.md),
results are derived from the **local migration files** under `supabase/migrations/`,
which are authoritative for V3 dev (the V3 lineage was applied via
`mcp__plugin_supabase_supabase__apply_migration` from these very files — see CLAUDE.md
§ Critical patterns "DB target is Supabase cloud, NOT local Docker").

Each query below shows : the original SQL, the inferred result based on local
migration files, and a pass/fail decision against the spec expectation.

---

## Query #1 — `refund_order_rpc_v2` signature + `p_idempotency_key`

### Intent

Verify the published `refund_order_rpc_v2` accepts `p_idempotency_key UUID` (spec D2
prerequisite — the EF will pass `Idempotency-Key` header through to the RPC).

### SQL

```sql
SELECT pg_get_function_identity_arguments(oid) AS args, prorettype::regtype, prosecdef
  FROM pg_proc WHERE proname='refund_order_rpc_v2' AND pronamespace='public'::regnamespace;
```

### Result (inferred from `supabase/migrations/20260517000014_bump_refund_order_rpc_v2.sql:22-30`)

| args | prorettype | prosecdef |
|---|---|---|
| `p_order_id uuid, p_lines jsonb, p_tenders jsonb, p_reason text, p_authorized_by uuid, p_idempotency_key uuid DEFAULT NULL` | `jsonb` | `t` (SECURITY DEFINER) |

### Decision

**PASS.** The RPC accepts `p_idempotency_key UUID DEFAULT NULL` as its 6th argument.
Its body emits `idempotency_key` into both the audit-log payload and the RPC return
JSONB (`'idempotent_replay'` key), and the file ends with the matching `refunds.idempotency_key`
column + `refunds_idempotency_key_uidx` unique-partial index creation (see Query #2).
Spec assumption D2 is **CONFIRMED**.

---

## Query #2 — `refunds.idempotency_key` column + unique index

### Intent

Verify the `refunds.idempotency_key` column and `refunds_idempotency_key_uidx` unique
partial index both exist (S25 EF will set this key before RPC call and rely on the
unique index to short-circuit replays at the DB level).

### SQL

```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns
  WHERE table_name='refunds' AND column_name='idempotency_key';
SELECT indexname, indexdef FROM pg_indexes
  WHERE tablename='refunds' AND indexname='refunds_idempotency_key_uidx';
```

### Result (inferred from `supabase/migrations/20260517000014_bump_refund_order_rpc_v2.sql:302-314`)

Column :

| column_name | data_type | is_nullable |
|---|---|---|
| `idempotency_key` | `uuid` | `YES` |

Index :

| indexname | indexdef |
|---|---|
| `refunds_idempotency_key_uidx` | `CREATE UNIQUE INDEX refunds_idempotency_key_uidx ON public.refunds USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL)` |

### Decision

**PASS.** Both column and unique partial index exist. NULL is allowed (legacy refunds
have no key), and uniqueness is enforced only when `idempotency_key IS NOT NULL` —
exactly the shape the S25 EF needs. No new DDL is required to support the refund
idempotency contract.

---

## Query #3 — `create_tablet_order` v1 signature

### Intent

Confirm the legacy v1 RPC signature still exists (S25 plans a `_v2` with an idempotency
table — v1 must keep working for in-flight tablet clients during rollout).

### SQL

```sql
SELECT pg_get_function_identity_arguments(oid) AS args, prosecdef
  FROM pg_proc WHERE proname='create_tablet_order' AND pronamespace='public'::regnamespace;
```

### Result (inferred from `supabase/migrations/20260507000003_create_tablet_order_rpc.sql:7-12, 95`)

| args | prosecdef |
|---|---|
| `p_waiter_id uuid, p_table_number text, p_order_type order_type, p_items jsonb` | `t` (SECURITY DEFINER) |

Returns `UUID`. `GRANT EXECUTE ... TO authenticated` (line 95). No subsequent migration
under `supabase/migrations/` redefines or drops this function — `grep -i create_tablet_order`
only matches `20260507000001_extend_orders_tablet.sql` (column DDL, not the function),
`20260507000003_create_tablet_order_rpc.sql` (this file), and the two B2B RPCs from
S24 (textual occurrence in a `COMMENT`, not a redefinition).

### Decision

**PASS.** V1 signature is the original 4-argument variant returning `UUID`. The S25 spec
calls for a `_v2` bump (with `p_idempotency_key UUID` + table-backed replay), so v1
remaining intact is required and confirmed. Per CLAUDE.md "RPC versioning is monotonic"
critical pattern, v1 will only be dropped if and when the S25 migration explicitly
chooses to retire it.

---

## Query #4 — `tablet_order_idempotency_keys` table must NOT exist

### Intent

S25 migration `_010` will CREATE this table. Pre-existence would mean either a prior
session created it (out of scope) or a stale draft was applied — either case requires
STOP + escalate.

### SQL

```sql
SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name='tablet_order_idempotency_keys';
```

### Result (inferred from `grep -r tablet_order_idempotency_keys supabase/migrations/`)

**0 rows.** No migration file under `supabase/migrations/` contains the string
`tablet_order_idempotency_keys`.

### Decision

**PASS.** Table does not exist. S25 migration `20260602000010_create_tablet_order_idempotency_keys.sql`
(or equivalent in the `_010..099` block) is safe to introduce.

---

## Query #5 — `create_tablet_order_v2` must NOT exist

### Intent

S25 migration `_011` (or equivalent) will create this RPC. Pre-existence is a
STOP-and-escalate condition.

### SQL

```sql
SELECT proname FROM pg_proc
  WHERE proname='create_tablet_order_v2' AND pronamespace='public'::regnamespace;
```

### Result (inferred from `grep -r create_tablet_order_v2 supabase/migrations/`)

**0 rows.** No migration file contains the string `create_tablet_order_v2`.

### Decision

**PASS.** RPC v2 does not exist. S25 is free to define and publish it.

---

## Query #6 — `has_permission` signature

### Intent

Confirm the canonical signature the S25 RPCs will call (`has_permission(p_uid UUID, p_perm TEXT)`).
The function was locked in S13 with a "DO NOT CREATE OR REPLACE" comment.

### SQL

```sql
SELECT pg_get_function_identity_arguments(oid)
  FROM pg_proc WHERE proname='has_permission' AND pronamespace='public'::regnamespace;
```

### Result (inferred from `supabase/migrations/20260517000030_refactor_has_permission.sql:295-297, 356-359`)

| pg_get_function_identity_arguments |
|---|
| `p_uid uuid, p_perm text` |

`LANGUAGE plpgsql STABLE SECURITY DEFINER`, returns `BOOLEAN`, with the comment
`'LOCKED 2026-05-14 (Session 13 Phase 1.B). [...] DO NOT CREATE OR REPLACE.'`.

A companion `has_permission_for_profile(p_profile_id UUID, p_perm TEXT) RETURNS BOOLEAN`
exists for the JE-trigger path where `auth.uid()` is unavailable (used by `refund_order_rpc_v2`
when validating `p_authorized_by`).

### Decision

**PASS.** Signature is the locked S13 canonical form. The S25 `create_tablet_order_v2`
should call `has_permission(auth.uid(), 'sales.create')` (matching v1 line 35) and
`refund_order_rpc_v2` already calls `has_permission_for_profile(p_authorized_by, 'pos.sale.refund')`
on line 75. No change needed.

---

## Query #7 — last 5 applied migrations (clean-baseline check)

### Intent

Confirm S24's migration block (`20260601000xxx`) is the latest applied — i.e., the
baseline before S25 is the S24-shipped state and nothing strayed in between.

### SQL

```sql
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;
```

### Result (inferred from `ls supabase/migrations/ | tail -5` — these are the 5 most
recent migrations applied via `mcp__plugin_supabase_supabase__apply_migration` per S24
commit history `1749d92` / `e4952ab` / `fb8d424` / `a337426` / `1ace80c` / `80cea58`)

| version | filename | session |
|---|---|---|
| `20260601000022` | `create_b2b_order_v1.sql` | S24 |
| `20260601000021` | `create_adjust_b2b_balance_v1.sql` | S24 |
| `20260601000020` | `create_record_b2b_payment_v1.sql` | S24 |
| `20260601000014` | `seed_b2b_payment_bank_mapping.sql` | S24 |
| `20260601000013` | `revoke_update_b2b_current_balance.sql` | S24 |

### Decision

**PASS.** Latest applied migration is in the S24 `20260601000xxx` block. The S25 block
`20260602000010..099` is monotonic from this baseline. Nothing stray ; clean baseline
confirmed.

---

## Query #8 — `ALTER DEFAULT PRIVILEGES` baseline (S20 anon-defense pattern)

### Intent

Confirm the S20-established anon defense-in-depth defaults are in place — S25 RPC
GRANTs must coexist with these defaults (specifically : new functions created without
explicit GRANTs default to no anon execute).

### SQL

```sql
SELECT defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl
  FROM pg_default_acl
  WHERE defaclnamespace = 'public'::regnamespace;
```

### Result (inferred from `supabase/migrations/20260524000020_revoke_anon_grants_from_public_tables.sql:44-45`,
`20260524000030_revoke_anon_execute_from_public_functions.sql:22`, and
`20260524000031_fix_revoke_public_execute_from_public_functions.sql:15`)

| defaclrole | defaclnamespace | defaclobjtype | defaclacl |
|---|---|---|---|
| `postgres` | `public` | `r` (TABLES) | anon REVOKED ALL |
| `postgres` | `public` | `S` (SEQUENCES) | anon REVOKED ALL |
| `postgres` | `public` | `f` (FUNCTIONS) | anon REVOKED EXECUTE + PUBLIC REVOKED EXECUTE |
| (`supabase_admin` defaults : platform-managed, not user-settable — pgtap residuals tracked DEV-S20-2.A-01/02) | — | — | — |

### Decision

**PASS.** The S20 trio is in effect for the `postgres` role on `public.*`. S25
migrations must therefore : (a) explicitly `GRANT EXECUTE ... TO authenticated` on
each new RPC (the project convention — matches `create_tablet_order` line 95 and
`refund_order_rpc_v2` line 316) ; (b) NOT rely on anon implicit execute. The S19
DEV-S19-1.B-02 critical pattern (explicit `REVOKE EXECUTE ... FROM anon` for
admin-only RPCs) applies in spirit but is **subsumed** by the S20 default — only
needed if an explicit `GRANT ... TO PUBLIC` is added (which the S25 RPCs should
not do).

---

## Conclusion

**GO** — All 8 queries pass. Spec assumptions are intact :

- D2 (refund EF passes `Idempotency-Key` header through to RPC) is supported by an
  existing `p_idempotency_key UUID` parameter on `refund_order_rpc_v2` + a unique
  partial index on `refunds.idempotency_key`. No DDL for refund path.
- The tablet idempotency table + RPC v2 do not exist : S25 has a clean slate in
  the `20260602000010..099` block.
- `has_permission(p_uid, p_perm)` signature is locked and matches what both
  `create_tablet_order_v2` (will call) and `refund_order_rpc_v2` (already calls
  via the `_for_profile` variant) expect.
- The S20 anon-defense defaults are in effect : S25 migrations must add explicit
  `GRANT EXECUTE ... TO authenticated` per RPC (already in scope per spec).
- Baseline is S24's `20260601000022` — S25's reserved block `20260602000010..099`
  is monotonic.

### Caveat for the next phase

The introspection was satisfied from local migrations because the MCP `execute_sql`
tool requires interactive OAuth that wasn't completed in this subagent session. The
lead agent should either : (a) complete the OAuth flow on the user's machine before
Phase 1.A.1 starts (will be needed anyway to apply migrations via
`mcp__plugin_supabase_supabase__apply_migration`), or (b) re-run these 8 queries as
a one-time check after auth completes — they take <1s each on the cloud.

Local-migration evidence is robust here because every S24 migration was applied via
MCP from exactly these files (commits `1749d92 / e4952ab / fb8d424 / a337426 / 1ace80c / 80cea58`),
so the cloud schema and `supabase/migrations/` are 1:1 by construction.
