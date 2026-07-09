---
name: security-fraud-guard
description: Cross-cutting security & anti-fraud authority for the ERP/POS — money flows (refund/void/discount/cash/manual JE), RBAC integrity, audit-log completeness, PII & information-leak surfaces, anon/PUBLIC hardening, and append-only ledger integrity. Two modes — AUDIT the system for fraud/manipulation/leak gaps (executable SQL checks) AND INTERVENE to add the controls (permissions, REVOKE pairs, audit_log writes, manager-PIN gates, pgTAP). Use this skill WHENEVER the user mentions security, fraud, manipulation by employees, "qui peut faire quoi", permissions/RBAC/roles, audit logs/traçabilité, refund/void/discount/cash-drawer/manual-journal-entry abuse, manager PIN, data leak / fuite d'information / PII, RLS / REVOKE / anon hardening, append-only ledgers, or "sécuriser / contrôler / enregistrer les actions" — even if they don't say the word "audit". Boundary vs security-auth: security-auth owns the AUTH MECHANICS (building an RLS policy or RPC gate, REVOKE/anon defense-in-depth, the PIN-JWT fetch wrapper, durable rate-limit, per-role session timeout); THIS skill owns the cross-cut FRAUD/MONEY/PII/traceability AUDIT and the addition of anti-fraud controls — reach here for "qui peut faire quoi", refund/void/discount/cash abuse, audit-log completeness, and data-leak surfaces. Defer inventory-specific security to stock-management and POS-flow technical correctness to pos-flow-audit; this skill owns the money, identity, traceability, and data-exposure cross-cut.
pathPatterns:
  - 'supabase/migrations/*permission*.sql'
  - 'supabase/migrations/*has_permission*.sql'
  - 'supabase/migrations/*rbac*.sql'
  - 'supabase/migrations/*role*.sql'
  - 'supabase/migrations/*audit*.sql'
  - 'supabase/migrations/*revoke*.sql'
  - 'supabase/migrations/*rate_limit*.sql'
  - 'supabase/migrations/*refund*.sql'
  - 'supabase/migrations/*void*.sql'
  - 'supabase/migrations/*cash*.sql'
  - 'supabase/migrations/*manual_je*.sql'
  - 'supabase/migrations/*session_timeout*.sql'
  - 'supabase/functions/auth-verify-pin/**'
  - 'supabase/functions/auth-change-pin/**'
  - 'supabase/functions/refund-order/**'
  - 'supabase/functions/void-order/**'
  - 'supabase/functions/cancel-item/**'
  - 'supabase/functions/_shared/**'
  - 'supabase/tests/security*.test.sql'
  - 'packages/supabase/src/rls/**'
  - 'packages/utils/src/pin-strength.ts'
  - 'apps/backoffice/src/stores/authStore.ts'
  - 'apps/backoffice/src/features/settings/**'
  - 'apps/backoffice/src/pages/reports/AuditPage.tsx'
promptSignals:
  phrases:
    - 'security'
    - 'securite'
    - 'fraud'
    - 'fraude'
    - 'manipulation'
    - 'qui peut faire quoi'
    - 'permission'
    - 'RBAC'
    - 'role'
    - 'audit log'
    - 'tracabilite'
    - 'manager PIN'
    - 'refund abuse'
    - 'void abuse'
    - 'discount abuse'
    - 'cash drawer'
    - 'data leak'
    - 'fuite information'
    - 'PII'
    - 'append-only'
    - 'separation of duties'
    - 'SOD'
---

# Security & Fraud Guard — The Breakery ERP/POS

> 🟢 **STATUT DES FAILLES 2026-05-31 — TOUTES CORRIGÉES (re-vérifié live 2026-06-27).** Ce skill décrivait 7 failles « verified critical (2026-05-31) ». **Elles sont soldées — ne pas rouvrir ces chantiers.** Le corps ci-dessous garde la *méthode de détection* (utile à réappliquer), mais les statuts « ouvert/critique » sont périmés. Mapping :
> | Faille 2026-05-31 (Pattern / checklist) | Statut | Correctif |
> |---|---|---|
> | #4 reversal RPCs `refund/void/cancel` PIN-bypass direct PostgREST | ✅ corrigé (régression récurrente, refermée) | Origine `20260619000030` (audit 2026-05-31, service_role only) → **régression → re-REVOKE `20260709000010`** (audit 2026-06-25) → **régression du bump S55 → auto-corrigé `20260710000082/084`** (`void_order_rpc_v4`/`cancel_order_item_rpc_v3` + REVOKE `authenticated`) ; discount-PIN par nonce `discount_authorizations` (`_085/_086`, `_v16`) |
> | #3 PIN en body `void-order`/`cancel-item` | ✅ corrigé | S34/PR #53 — lus depuis header `x-manager-pin` ; `kiosk-issue-jwt` conforme S36 |
> | #9 views `view_b2b_invoices`/`view_ar_aging` sans `security_invoker` + MV `mv_*` SELECT-able par `anon` | ✅ corrigé | **`20260619000020/021`** (audit 2026-05-31) : `security_invoker=on` sur les 2 vues + `REVOKE MV FROM anon, PUBLIC`. ⚠️ **distinct de S50** (`20260710000055` = vue legacy `audit_log` + REVOKE MV depuis `authenticated`) |
> | #2 `audit_log` (legacy singulier) écrit en parallèle + append-only sur RLS seule | ✅ corrigé | **S56 — vue `audit_log` + trigger INSTEAD-OF DROPPÉS (`_087`/`_088`) ; `audit_logs` est la SEULE surface.** Append-only = writes via RPC definer only |
> | checklist D — `customers` PII lisible sans `customers.read` | ✅ corrigé | gate `customers.read` en place (`_043`, re-vérifié 2026-06-27) |
> | checklist D — `user_profiles.pin_hash` lisible par `authenticated` | ✅ corrigé | REVOKE colonne (`_023`, re-vérifié 2026-06-27) |
> | checklist D — MV `mv_sales_daily` SELECT-able par `anon` | ✅ corrigé | `20260619000020` (REVOKE MV FROM anon) — **pas S50** |
>
> **Reste réellement à surveiller** (non couvert par le lot ci-dessus) : `create_manual_je_v1(p_manager_pin)` en argument body (à migrer header — **à vérifier**) ; finding S66 F-1 (lockout `_verify_pin_with_lockout` des RPC PIN-in-arg ne persiste pas les échecs — seul le chemin EF compte). Toujours re-vérifier live avant d'affirmer quoi que ce soit — c'est le mode `AUDIT` de ce skill.

Cross-cutting security authority. The mission, in the owner's words: make **fraud, data manipulation, and information leakage** hard-to-impossible in a system operated daily by employees (cashiers, waiters, managers) who have legitimate access but conflicting incentives. Two modes:

1. **Audit** — hunt for fraud/manipulation/leak gaps against 5 dimensions (see checklists). Every check is an executable SQL query (via MCP `execute_sql` against V3 dev `ikcyvlovptebroadgtvd`) or a `Grep`.
2. **Intervene** — add the missing controls correctly: new permission + role grant, REVOKE pair, audit_log write, manager-PIN-in-header gate, idempotency, SOD constraint, append-only REVOKE, pgTAP coverage.

**`CLAUDE.md` is the source of truth** for project-wide patterns and the active workplan. This skill adds the *security mental model*, the *threat model* (how an employee would actually cheat), audit checklists, and preventive guidance.

## Boundaries — don't duplicate sibling skills

- **`stock-management`** owns inventory-flow security (WAC integrity, lot/FIFO traceability, `stock_movements` append-only, the JE trigger). If the question is "is the stock ledger tamper-proof / is WAC trustworthy", defer there.
- **`pos-flow-audit`** owns POS technical correctness (idempotency keys, RPC versioning, realtime races) and the POS UX flow.
- **This skill** owns the cross-cut: **money** (refund/void/discount/cash/manual JE), **identity** (PIN auth, RBAC integrity, session lifetime), **traceability** (audit_log completeness across ALL modules), **data exposure** (PII, views, anon/PUBLIC), and **append-only integrity** as a system-wide invariant. When a topic overlaps, lead with the fraud/leak angle and cite the sibling skill for the mechanics.

## Mental model — defense in depth (5 layers)

A request from an employee's device passes through 5 gates. Fraud succeeds wherever a gate is missing or misconfigured. Audit each layer.

```
1. AUTHENTICATION    PIN (bcrypt cost 10) → JWT (HS256, custom fetch wrapper). Lockout 5/15min.
   ↓                 À vérifier (non tranché) : chemin mobile_verify_pin — contourne-t-il lockout+audit ?
2. RATE LIMIT        Durable Postgres bucket (S19) on auth-verify-pin, kiosk, refund/void/cancel, pdf EFs.
   ↓                 Weak link: fail-open on DB error (deliberate); not all mutating EFs covered.
3. AUTHORIZATION     has_permission(uid, 'module.action') — 4-tier: override DENY → override GRANT
   ↓                 → role_permissions → false. Raise P0003 on deny. ~145 permission codes, 7 roles.
4. ATOMIC MUTATION   SECURITY DEFINER RPC (never raw INSERT). search_path pinned. Idempotency key.
   ↓                 Money flows ALSO require a manager PIN (second factor) — must be in HTTP HEADER.
5. TRACE             audit_logs row (actor_id/action/entity_type/entity_id/metadata) + append-only ledger.
                     Reste à surveiller: ~2 RPCs status-only sans audit (acceptable, documenté). Le split
                     audit_log/audit_logs est CLOS (legacy droppée S56); PIN-in-body void/cancel migré S34.
```

### The fraud triangle (who cheats, and how)

- **Cashier** — voids/refunds a paid order and pockets cash; applies a fake discount for a friend; under-rings; opens the drawer via a bogus cash movement. *Control: manager PIN on void/refund/discount + audit trail + cash reconciliation at Z-report.*
- **Manager** — approves their own expense; signs off a refund they initiated; edits a price/cost to mask shrinkage; backdates. *Control: separation of duties (SOD), manual-JE PIN gate, append-only ledgers, no self-approval.*
- **Admin/technical** — direct DB write bypassing RPCs; relaxes an RLS/REVOKE; reads PII at scale; disables a trigger. *Control: append-only at GRANT level (not just RLS), search_path pinning, audit on schema-touching RPCs, anon/PUBLIC sweep.*

The job is to make each of these leave an indelible trace and require a second party.

## Critical patterns (verified against V3 dev — always re-verify before shipping)

1. **`has_permission(p_uid UUID, p_perm TEXT)`** (`20260517000030_refactor_has_permission.sql`) is 4-tier: `user_permission_overrides` DENY wins first, then override GRANT, then `role_permissions` via `user_roles`, else FALSE. Companion `has_permission_for_profile(p_profile_id, p_perm)` for the profile path (EFs that already resolved the profile, e.g. manager-PIN verification). Permission denial raises **`P0003`** (some report RPCs use SQL-native `42501` — both mean "denied"). Grep new RPCs for a `has_permission` call before the first mutation; a `SECURITY DEFINER` function with no gate is a hole.

2. **`audit_logs` est la SEULE table d'audit (S56).** Canonical `audit_logs` (`20260503000005_init_settings.sql`: `id BIGSERIAL, actor_id UUID, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id UUID, metadata JSONB, created_at`; `payload JSONB` added S19 `20260523000019`). ~~Legacy `audit_log` (singular)~~ **DROPPÉE S56** (vue compat + trigger INSTEAD-OF supprimés `_087`/`_088`) — ne plus la chercher ni y écrire. Append-only *intended* (writes only inside SECURITY DEFINER RPCs). Toujours re-confirmer un ACL suspect via `relacl` avant d'affirmer une régression — le probe 2026-05-31 qui suggérait un INSERT/UPDATE/DELETE ouvert pour `authenticated` est à re-vérifier live si suspicion (mémoire : traité dans le lot de durcissement 2026-06).

3. **Manager PIN (second factor) goes in an HTTP header, never the JSON body (S25).** Request bodies are logged by PostgREST/pgaudit/proxies/Supabase function logs; headers rarely are. Canonical: `refund-order`, `void-order`, `cancel-item` read `x-manager-pin` (**void/cancel migrés header S34/PR #53** ; `kiosk-issue-jwt` conforme S36). **Reste : `create_manual_je_v1` prend encore `p_manager_pin` en arg body — à vérifier/migrer header** (seul item de ce pattern non confirmé soldé).

4. **The RPC is the security boundary — the Edge Function is NOT.** Money flows (refund / void / cancel-item / manual JE) must require a manager second factor in addition to the permission gate. ✅ **Faille direct-PostgREST 2026-05-31 CORRIGÉE — mais régression récurrente, à surveiller :** fermée à l'origine par `20260619000030` (reversals `service_role only`), **régressée puis re-REVOKE par `20260709000010`** (audit 2026-06-25), **régressée à nouveau par le bump S55 lui-même puis auto-corrigée par `20260710000082/084`** (`void_order_rpc_v4`/`cancel_order_item_rpc_v3`, REVOKE `authenticated`). Le PIN discount transite désormais par un nonce serveur `discount_authorizations` (`_085/_086`, `_v16`) — plus de PIN en arg SQL. **Ce pattern régresse à chaque bump de RPC de reversal : re-vérifier le REVOKE `authenticated` après tout nouveau `_vN`.** **Le principe de contrôle reste vrai et à ré-appliquer sur tout NOUVEAU RPC :** un gate PIN dans une EF ne protège rien si le RPC sous-jacent est appelable indépendamment. Pour chaque EF « manager-PIN-protected », vérifier le RPC appelé — REVOKE de `authenticated` ? second facteur re-vérifié serveur, ou simple UUID de confiance ? Le correct : REVOKE EXECUTE des RPC de reversal depuis `authenticated` (service_role via EF seulement) OU un jeton signé vérifié serveur — jamais un UUID fourni par l'appelant. Et l'`actor_id` d'audit doit être le manager approbateur, pas le caissier.

5. **REVOKE pair is mandatory on every new RPC (S20/S25 canonical):**
   ```sql
   REVOKE EXECUTE ON FUNCTION public.<rpc>(<sig>) FROM PUBLIC;
   REVOKE EXECUTE ON FUNCTION public.<rpc>(<sig>) FROM anon;
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
   ```
   `REVOKE FROM anon` **alone is insufficient** — anon inherits EXECUTE through PUBLIC membership (the `=X/postgres` ACL). The S20 sweep (`20260524000020..031`) revoked anon+PUBLIC across all tables/views/functions and set ALTER DEFAULT PRIVILEGES; `_031` is the corrective that added the FROM PUBLIC line. New objects only stay revoked because of that default-privileges line.

6. **`SECURITY DEFINER` must pin `search_path`.** Every definer function runs with elevated rights; without `SET search_path = public` (or `public, pg_temp`), a caller can hijack it by shadowing a table/function in their own schema. The project standard is explicit `SET search_path`; a definer function missing it is a vulnerability — flag it.

7. **Append-only is enforced at the GRANT level, not just RLS.** Ledgers (`stock_movements`, `audit_logs`, `b2b_payments`, `expense_approvals`, `internal_transfers`, `loyalty_transactions`, `role_permissions`, `user_permission_overrides`) `REVOKE INSERT/UPDATE/DELETE FROM authenticated` (the strongest also revoke from anon+PUBLIC). Writes go only through definer RPCs. Never "fix" data by UPDATE/DELETE on these — add a compensating entry or a `_void_v1` RPC.

8. **Separation of duties (SOD) is a constraint, not a convention.** `expense_approvals` has `UNIQUE(expense_id, approver_user_id)` so one person can't approve two steps, and `approve_expense_v2` blocks `created_by = caller`. When adding any multi-party flow (approvals, sign-offs, reversals), encode "different human" as a DB constraint, not as UI courtesy.

9. **Views run as their owner unless `security_invoker=on`.** A view without `security_invoker=on` (PG15+) executes with the *owner's* (`postgres`) rights and bypasses the caller's RLS — a silent data-leak surface. ✅ **Faille 2026-05-31 CORRIGÉE (`20260619000021`/`_020`) :** `view_b2b_invoices`/`view_ar_aging` (`reloptions = NULL`) sont passées `security_invoker=on`, et les MV `mv_sales_daily`/`mv_pl_monthly`/`mv_stock_variance` (SELECT-able par `anon`, angle mort du sweep S20 car `relkind='m'`) ont reçu `REVOKE ALL … FROM anon, PUBLIC`. ⚠️ **Ne pas confondre avec S50** (`20260710000055`), qui a fermé un trou *distinct* et postérieur : `security_invoker` sur la vue legacy `audit_log` + `REVOKE MV FROM authenticated/PUBLIC`. **La méthode reste à ré-appliquer sur toute NOUVELLE vue/MV :** ne jamais croire le commentaire de migration — vérifier `pg_class.reloptions` (`SELECT relname, reloptions FROM pg_class WHERE relkind IN ('v','m')`) ; fix `ALTER VIEW <v> SET (security_invoker = on)` / `REVOKE ALL ON <mv> FROM anon, PUBLIC`.

10. **PIN strength is warn-only.** `evaluatePinStrength` (`packages/utils/src/pin-strength.ts` + Deno mirror) flags repetition/sequence/leaked-list but does **not** block. `111111` is accepted. Lockout is 5 attempts → 15 min (`user_profiles.failed_login_attempts`, `locked_until`); session token is UUIDv4 to client, SHA-256 in `user_sessions.session_token_hash`; per-role idle timeout via `useIdleTimeout` + `roles.session_timeout_minutes`.

## Audit checklist (5 dimensions: money / identity / traceability / data-exposure / integrity)

Run a section when you suspect a gap. Each is a discrete SQL/grep you can execute.

### A. Money & anti-fraud (reversals, discounts, cash, JE)

- [ ] **Every reversal requires a manager PIN.** For `refund_order_rpc_v2`, `void_order_rpc`, `cancel_order_item_rpc`, confirm a manager-PIN check exists AND the audit row's `actor_id` is the *manager*, not the cashier. A reversal with the cashier as sole actor = fraud vector.
- [ ] **PIN in header, not body.** Grep `supabase/functions/{void-order,cancel-item}/index.ts` and `create_manual_je_v1` for body-read PINs (`body.manager_pin`, `p_manager_pin`). Each one is a secret-in-logs leak — flag for header migration (Pattern #3).
- [ ] **Discount/price override is gated + logged.** Any POS discount or price override checks `sales.discount` (or equivalent) and writes an audit row with the amount and reason. Unlogged discounts are the #1 cashier-fraud channel.
- [ ] **Cash movements reconcile.** Every `record_cash_movement_v2` (apport/withdrawal/bank) writes audit + (where applicable) a JE, and the Z-report close (`close_shift_v2` → `z_reports` snapshot) reconciles `cash_in - cash_out` against counted cash. A cash-out with `reason` NULL/blank = flag.
- [ ] **Manual JE is dual-controlled.** `create_manual_je_v1` requires balanced lines (debit XOR credit, sum=0), a manager PIN, and writes audit `accounting.je.create_manual`. Backdating outside an open fiscal period must be blocked (`close_fiscal_period_v1` lock).
- [ ] **No self-approval.** `approve_expense_v2` blocks `created_by = approver` and `UNIQUE(expense_id, approver_user_id)` holds. Test: try to approve your own expense → expect denial.

### B. Identity & access (RBAC integrity, auth, session)

- [ ] **No definer RPC without a gate.** `SELECT proname FROM pg_proc WHERE prosecdef AND proname NOT LIKE '\_%'` then grep each for `has_permission`. Internal helpers (leading `_`, REVOKEd from authenticated) are exempt; public-callable ones are not.
- [ ] **Permission overrides aren't a backdoor.** `SELECT * FROM user_permission_overrides WHERE grant_type='GRANT'` — every standing GRANT override should have a documented reason. A cashier with an `expenses.approve` override defeats SOD.
- [ ] **Role grants match intent.** Cross-check `role_permissions` for a low role holding a sensitive code (e.g. CASHIER with `pos.sale.refund`, `accounting.*`, `users.*`, `rbac.update`). Use the BO Permissions Matrix (`usePermissionsMatrix`) or query directly.
- [ ] **Lockout & rate-limit cover all auth paths.** Confirm `auth-verify-pin` enforces lockout + rate-limit, and that any alternate path (`mobile_verify_pin`, kiosk) does NOT bypass them. The documented `mobile_verify_pin` bypass is a flag.
- [ ] **Session lifetime is bounded per role.** `roles.session_timeout_minutes` set (CASHIER short, ADMIN longer, 5..480 bounds) and `useIdleTimeout` mounted in POS+BO.

### C. Traceability (audit-log completeness)

- [ ] **Every mutating RPC writes an audit row.** For each `SECURITY DEFINER` function that mutates state, confirm an `INSERT INTO audit_logs` (`audit_log` legacy droppée S56 — ne plus la chercher). Known gaps: `mark_item_served`, `send_items_to_kitchen` (status-only — acceptable, but document). A *money/identity/schema* mutation with no audit row is never acceptable.
- [ ] **`entity_id` populated (or documented NULL).** `SELECT action, count(*) FROM audit_logs WHERE entity_id IS NULL GROUP BY action`. Known: `role.session_timeout_changed` carries `role_code` in payload instead. Anything else with NULL entity_id breaks drill-down → flag.
- [ ] **Replay is distinguishable.** Idempotent retries log a `*.replay` action (e.g. `refund.replay`) so the same operation appearing N times without `.replay` signals a bypassed idempotency layer.
- [ ] **Audit table is read-gated.** `audit_logs` SELECT is gated by an audit-read permission (`reports.audit.read` / `users.view_audit` — verify the exact code) and the viewer (`AuditPage.tsx` → `get_audit_logs_v1`) doesn't leak rows to roles lacking it.
- [ ] **Sensitive reads are logged where it matters.** Bulk PII/financial exports (CSV/PDF) ideally emit an audit row — a manager dumping the full customer list should be visible.

### D. Data exposure (PII & information leak)

- [ ] **anon sees nothing.** `SELECT … ` as anon should return zero rows / permission-denied on `customers`, `orders`, `payments`, `expenses`, `journal_entries`, `audit_logs`. Verify the S20 sweep held (`has_table_privilege('anon','customers','SELECT')` = false). ✅ Le trou MV du sweep (`mv_sales_daily` SELECT-able par `anon`) est **corrigé (`20260619000020`)** ; garder le probe `has_table_privilege('anon','mv_sales_daily','SELECT')` en contrôle de non-régression (doit être `false`).
- [ ] **Customer PII READ is gated.** ✅ **Corrigé (re-vérifié 2026-06-27) :** les lectures `customers` sont désormais gatées `customers.read` (BackOffice) + RPC definer étroit pour le POS. Contrôle de non-régression : la policy SELECT ne doit plus se contenter de `is_authenticated()`.
- [ ] **`pin_hash` is not readable.** ✅ **Corrigé (re-vérifié 2026-06-27) :** `REVOKE SELECT (pin_hash) … FROM authenticated` (column-level) en place ; l'auth passe par des RPC definer (`verify_user_pin`). Contrôle : `pin_hash` ne doit pas réapparaître dans un grant `authenticated`.
- [ ] **Customer PII columns are write-protected.** `customers` allows authenticated INSERT/UPDATE only on `(name, phone, email, customer_type, category_id, birth_date, marketing_consent, b2b_*)`; loyalty/spend/visit columns mutate only via definer RPC (S12 column-grant hardening). Verify no broadening crept in.
- [ ] **Views don't bypass RLS.** Every view touching `customers`/`orders`/financials must have `security_invoker=on` — ✅ `view_b2b_invoices`/`view_ar_aging` corrigées `20260619000021` (Pattern #9) ; contrôle de non-régression sur toute nouvelle vue. MVs (`mv_*`) ne doivent pas être grantées aux rôles bas / anon.
- [ ] **No PII in logs/metadata.** Grep audit `metadata`/`payload` and EF logs for raw phone/email/PIN. Secrets and PII in `metadata` are a leak even if the table is read-gated.
- [ ] **Error messages don't enumerate.** Auth/permission failures return generic messages (no "user not found" vs "wrong PIN" distinction that enables enumeration).

### E. Append-only & schema integrity

- [ ] **Ledgers reject UPDATE/DELETE.** For each append-only table (Pattern #7), `has_table_privilege('authenticated','<t>','UPDATE')` = false. If true, the REVOKE regressed.
- [ ] **search_path pinned on all definers.** `SELECT proname FROM pg_proc WHERE prosecdef AND proconfig IS NULL` (or no `search_path` in `proconfig`) → each result is a hijack risk.
- [ ] **REVOKE pair on every new RPC.** For functions added since the last audited migration, confirm the 3-line block (Pattern #5). Missing ALTER DEFAULT PRIVILEGES = anon inherits via PUBLIC.
- [ ] **pgTAP security suite passes.** Run `supabase/tests/security.test.sql` (T1–T20) + `expense_governance.test.sql` (T18 REVOKE-anon) + `s26_db_hardening.test.sql` via MCP `execute_sql` BEGIN/ROLLBACK.

## Preventive checklists (5 concrete interventions)

### 5.A — Before adding a new sensitive RPC (money/identity/data mutation)
- [ ] `SECURITY DEFINER` + `SET search_path = public` + explicit `has_permission(auth.uid(), 'module.action')` raising `P0003`.
- [ ] If it moves money or reverses a transaction → manager PIN as a **header**-sourced second factor (`x-manager-pin` in the EF, validated before the RPC), and the audit `actor_id` is the approving manager.
- [ ] `p_idempotency_key UUID` if retry-safe; replay returns the prior result and logs `*.replay`.
- [ ] `INSERT INTO audit_logs` with canonical cols + a meaningful `metadata` (amounts, reason) but **no secrets/PII**.
- [ ] REVOKE pair S25 (3 lines, Pattern #5).
- [ ] pgTAP: happy path + permission-denied + (if money) PIN-required + replay + REVOKE-from-anon assertion.
- [ ] Types regen via MCP `generate_typescript_types` → write `packages/supabase/src/types.generated.ts` + commit.

### 5.B — Before adding a new permission code
- [ ] Add to `permissions` (seed migration, `ON CONFLICT DO NOTHING`) AND to the `PermissionCode` union in `packages/supabase/src/rls/permissions.ts`.
- [ ] Grant to roles via `role_permissions` — least privilege: grant to the *highest* role that needs it, not "MANAGER+ by default". Re-justify every CASHIER grant.
- [ ] Wire the gate: BO/POS `PermissionGate` / `authStore.hasPermission` on the UI, `has_permission` in the RPC. UI-only gating is cosmetic.
- [ ] pgTAP that the new code denies a role lacking it.

### 5.C — Before exposing data through a view / report / RPC
- [ ] View: `WITH (security_invoker = on)` so it respects the caller's RLS. Never a definer view over PII without a hard reason.
- [ ] If it aggregates (MV/report), confirm the aggregate itself isn't sensitive and the SELECT is permission-gated.
- [ ] No raw PII in the projection unless the consumer's permission justifies it; mask/omit phone/email where a name suffices.
- [ ] Consider an audit row on bulk export.

### 5.D — Before touching auth, PIN, or session code
- [ ] Lockout + rate-limit preserved on the changed path; no new bypass (the `mobile_verify_pin` lesson).
- [ ] PIN never logged, never returned, never in a body that gets logged; bcrypt cost unchanged (≥10); session token stays hashed at rest.
- [ ] If tightening PIN strength from warn → block, stage it (warn period, then enforce) and surface a clear reason to the user.
- [ ] pgTAP/EF test: locked account is rejected, expired session is rejected.

### 5.E — Before modifying a REVOKE / RLS / append-only constraint
- [ ] Relaxing an append-only REVOKE or an RLS policy almost always covers a latent bug — find the real cause first (the S25 `_014`/`_015` correctives are the cautionary tale).
- [ ] If a table must accept correction, add a compensating-entry RPC or `_void_v1` — never enable UPDATE/DELETE for `authenticated`.
- [ ] Re-run the full security pgTAP suite + any module suite touching the table.
- [ ] New objects: re-confirm the ALTER DEFAULT PRIVILEGES FROM PUBLIC line is still in force.

## Sources de vérité (pointers)

```
RBAC / permissions
  supabase/migrations/20260517000030_refactor_has_permission.sql   # has_permission 4-tier + roles+levels
  supabase/migrations/*seed*permission*.sql                        # seeding pattern (DO block, ON CONFLICT)
  packages/supabase/src/rls/permissions.ts                         # PermissionCode union (~145) + helpers
  apps/backoffice/src/stores/authStore.ts                          # client gate (Zustand, sessionStorage)
  apps/backoffice/src/features/settings/hooks/usePermissionsMatrix.ts

Audit
  supabase/migrations/20260503000005_init_settings.sql             # audit_logs (canonical, SEULE surface)
  # audit_log (legacy singulier) + trigger INSTEAD-OF DROPPÉS S56 (_087/_088) — ne plus référencer
  supabase/migrations/20260523000019_audit_logs_add_payload.sql    # +payload (S19)
  supabase/migrations/20260517000076_paginate_audit_log_rpc.sql    # get_audit_logs_v1
  apps/backoffice/src/pages/reports/AuditPage.tsx                  # viewer

Auth / PIN / rate-limit / session
  supabase/functions/auth-verify-pin/index.ts                      # bcrypt, lockout, rate-limit, JWT
  supabase/functions/_shared/{idempotency.ts,rate-limit.ts}        # shared helpers
  packages/utils/src/pin-strength.ts                               # warn-only strength
  supabase/migrations/20260523000010..012_*rate_limit*.sql         # durable RL (S19)
  supabase/migrations/20260523000020_add_session_timeout_to_roles.sql
  packages/ui/src/hooks/useIdleTimeout.ts

Money flows (verify gate + PIN-location + audit for each)
  supabase/functions/{refund-order,void-order,cancel-item}/index.ts
  supabase/migrations/*refund*  *void*  *cancel*  *cash_movement*  *manual_je*  *expense*approve*.sql

Anon / RLS / append-only hardening
  supabase/migrations/20260524000020..031_*.sql                    # S20 anon+PUBLIC sweep (+ _031 corrective)
  supabase/migrations/*b2b_payments* *expense_approvals* *internal_transfers*   # append-only + SOD

Tests (behavioral truth)
  supabase/tests/security.test.sql                                 # T1–T20
  supabase/tests/expense_governance.test.sql                       # T18 = REVOKE anon
  supabase/tests/s26_db_hardening.test.sql                         # search_path + RPC gates
  supabase/tests/{b2b_foundation,idempotency_hardening,orders_read_perm}.test.sql

Patterns canon
  CLAUDE.md  "Critical patterns" block (PIN-in-header, anon defense-in-depth, RPC versioning, idempotency)
```

## Verification before claiming an audit or fix is complete

```bash
pnpm typecheck
# Security pgTAP via MCP execute_sql with BEGIN/ROLLBACK envelope:
#   security.test.sql, expense_governance.test.sql, s26_db_hardening.test.sql
pnpm --filter @breakery/app-backoffice test settings   # RBAC / permissions matrix smoke
pnpm --filter @breakery/app-backoffice test reports     # audit viewer smoke
```

Always audit against V3 dev cloud `ikcyvlovptebroadgtvd` via the Supabase MCP — never prod (V2 monolith `abjabuniwkqpfsenxljp`, incompatible lineage). Use `BEGIN … ROLLBACK` so probes never mutate.

## When to escalate (flag, don't silently proceed)

- A `SECURITY DEFINER` function with no `has_permission` gate, or no `SET search_path`.
- A money/reversal RPC missing a manager-PIN second factor, with the cashier as the sole audit `actor_id`, OR `GRANT EXECUTE TO authenticated` so it's callable directly via PostgREST bypassing the EF's PIN (Pattern #4 — le trou `refund/void/cancel` d'origine est **refermé** après une régression récurrente : `20260619000030` → `20260709000010` → `20260710000084` ; **il régresse à chaque bump de RPC de reversal** — re-vérifier le REVOKE `authenticated` à tout nouveau `_vN`).
- A manager PIN read from the request body (logged-secret leak) — propose the header migration.
- `user_profiles.pin_hash` (or any secret/hash column) readable by `authenticated`, or `customers` PII readable with no `customers.read` gate.
- A NEW view exposing PII/financials with `reloptions = NULL` (no `security_invoker`), or a materialized view SELECT-able by `anon` (S20 sweep blind spot — les instances connues sont corrigées `20260619000020/021`, surveiller les nouvelles).
- A standing `user_permission_overrides` GRANT with no documented reason, or a low role holding a sensitive permission.
- About to relax an append-only REVOKE or an RLS/REVOKE policy — almost always covers a latent bug.
- A view over PII/financials without `security_invoker=on`, or an MV granted to a low role.
- A mutating money/identity/schema RPC that writes no audit row.
- Any new alternate auth path (mobile/kiosk) that skips lockout, rate-limit, or audit.
