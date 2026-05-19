# Session 25 — Phase 1.A.0 — Pre-flight DB introspection (2026-05-19)

**Spec ref :** [`docs/workplan/specs/2026-05-19-session-25-spec.md`](../specs/2026-05-19-session-25-spec.md)
**INDEX ref :** [`docs/workplan/plans/2026-05-19-session-25-INDEX.md`](../plans/2026-05-19-session-25-INDEX.md) (Phase 1.A.0)
**Target project :** `ikcyvlovptebroadgtvd` (V3 dev, region `ap-southeast-1`)
**Migration block reserved (S25) :** `20260602000010..099`

## Source of truth notice

Results below are from **live cloud introspection** against project `ikcyvlovptebroadgtvd`
via `mcp__plugin_supabase_supabase__execute_sql` (auth completed by lead post-implementer
report). The subagent's initial draft inferred results from local migration files because
OAuth was not yet completed at that point — this revision replaces the inferred values
with live cloud values where they differ. Two divergences were found and corrected :
Q7 version format (cloud uses apply-time timestamps, not filename prefixes), and Q8
default-ACL row count (6 rows total, including `supabase_admin` platform defaults).
All 8 queries still PASS — spec assumptions are intact.

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

### Cloud result (live)

| args | prorettype | prosecdef |
|---|---|---|
| `p_order_id uuid, p_lines jsonb, p_tenders jsonb, p_reason text, p_authorized_by uuid, p_idempotency_key uuid` | `jsonb` | `true` (SECURITY DEFINER) |

(`DEFAULT NULL` is in the source SQL but `pg_get_function_identity_arguments` strips defaults — confirmed in the migration body.)

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

### Cloud result (live)

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

### Cloud result (live)

| args | prosecdef |
|---|---|
| `p_waiter_id uuid, p_table_number text, p_order_type order_type, p_items jsonb` | `true` (SECURITY DEFINER) |

Single overload, original 4-argument v1. Per `supabase/migrations/20260507000003_create_tablet_order_rpc.sql`,
returns `UUID` with `GRANT EXECUTE ... TO authenticated`. No intermediate migration
redefined or dropped the function — cloud signature matches the file exactly.

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

### Cloud result (live)

`COUNT(*) = 0`. Table does not exist in cloud `public` schema. Cross-check : no
migration file under `supabase/migrations/` mentions the string `tablet_order_idempotency_keys`.

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

### Cloud result (live)

`COUNT(*) = 0`. RPC does not exist in cloud `public` schema. Cross-check : no
migration file mentions `create_tablet_order_v2`.

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

### Cloud result (live)

| pg_get_function_identity_arguments |
|---|
| `p_uid uuid, p_perm text` |

Per `supabase/migrations/20260517000030_refactor_has_permission.sql`, `LANGUAGE plpgsql STABLE SECURITY DEFINER`,
returns `BOOLEAN`, with `LOCKED 2026-05-14 (Session 13 Phase 1.B)` comment. A companion
`has_permission_for_profile(p_profile_id UUID, p_perm TEXT) RETURNS BOOLEAN` exists
for the JE-trigger path where `auth.uid()` is unavailable (used by `refund_order_rpc_v2`
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

### Cloud result (live)

| version (apply-time) | name (filename prefix) | session |
|---|---|---|
| `20260519184835` | `s24_create_b2b_order_v1` | S24 |
| `20260519184748` | `s24_create_adjust_b2b_balance_v1` | S24 |
| `20260519184721` | `s24_create_record_b2b_payment_v1` | S24 |
| `20260519184640` | `s24_seed_b2b_payment_bank_mapping` | S24 |
| `20260519184631` | `s24_revoke_update_b2b_current_balance` | S24 |

**Important nuance discovered :** Supabase's `apply_migration` records `version` as the
**apply-time timestamp** (when the call was made), NOT the filename's numeric prefix.
The `name` column reproduces what was passed to `apply_migration(name=...)`. So the
S25 reserved block `20260602000010..099` is a **filename / `name` convention** for local
sort order, not the cloud `version` value. Monotonic-numbering rule still holds because
filenames remain sorted ; cloud versions will be `20260519xxxxxx` or later (whatever the
apply-time is when we run S25 today).

### Decision

**PASS.** Latest applied is S24's `s24_create_b2b_order_v1`. Nothing stray between S24
and S25. The S25 filename block `20260602000010..099` is safe to use.

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

### Cloud result (live — 6 rows)

| defaclrole | defaclobjtype | defaclacl |
|---|---|---|
| `supabase_admin` | `S` (SEQUENCES) | `{postgres=rwU/sa, anon=rwU/sa, authenticated=rwU/sa, service_role=rwU/sa}` |
| `supabase_admin` | `r` (TABLES) | `{postgres=arwdDxtm/sa, anon=arwdDxtm/sa, authenticated=arwdDxtm/sa, service_role=arwdDxtm/sa}` |
| `supabase_admin` | `f` (FUNCTIONS) | `{postgres=X/sa, anon=X/sa, authenticated=X/sa, service_role=X/sa}` |
| `postgres` | `r` (TABLES) | `{postgres=arwdDxtm/postgres, authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres}` — **anon ABSENT** |
| `postgres` | `S` (SEQUENCES) | `{postgres=rwU/postgres, authenticated=rwU/postgres, service_role=rwU/postgres}` — **anon ABSENT** |
| `postgres` | `f` (FUNCTIONS) | `{postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}` — **anon ABSENT** |

The 3 `supabase_admin` rows are platform-managed (Supabase-internal extensions, pgtap
helpers — pgtap residuals are tracked under DEV-S20-2.A-01/02 and not user-revocable).
The 3 `postgres` rows are user-controlled and were established by S20 migrations
`20260524000020/030/031`. Crucially, the `postgres` defaults **exclude** `anon` for
all three object types — meaning any new public-schema object created by `postgres`
(which is what `apply_migration` uses) inherits zero anon privileges by default.

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
- Baseline is S24's `s24_create_b2b_order_v1` (cloud version `20260519184835`). S25
  filename block `20260602000010..099` is sortable monotonic from the local S24 block
  `20260601000010..022` (and from older S20 `20260524*` etc.). Cloud `version` is
  apply-time so monotonic by construction.

### Note on Supabase versioning convention (discovered during this preflight)

Supabase's `apply_migration` records two distinct values :
- `version` = apply-time timestamp (when the MCP call was made)
- `name` = the value passed to `apply_migration(name=...)`, which by repo convention
  reproduces the local filename prefix

This means : the "migration block reserved `20260602000010..099`" in spec/INDEX is a
**local filename convention**, not a cloud `version` value. Both still maintain a
strict ordering. No impact on the plan ; just worth noting for future preflight docs.
