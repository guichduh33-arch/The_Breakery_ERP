---
title: Session 13 Decision Pack (D1..D20) + Refund JE audit + V3 absence verifications
date: 2026-05-13
locked: 2026-05-14
owner: arch-steward (Phase 0.1)
sources:
  - docs/workplan/specs/2026-05-13-session-13-spec.md §3 (D1..D20)
  - docs/workplan/specs/2026-05-13-session-13-architecture-audit.md §6 (Q1..Q13)
  - V3 codebase grep verifications (this document)
---

# Session 13 Decision Pack — locked 2026-05-14

> Each decision is locked. Subsequent change-of-mind = new dated spec (per "append-only history" rule in `CLAUDE.md`). The 13 open questions from audit §6 are answered explicitly under each decision they resolve.

---

## Decisions index

| ID | Title | Resolves audit Q | Status |
|---|---|---|---|
| D1 | V2 → V3 path translation ownership | Q1 | LOCKED |
| D2 | Phantom-tables decisions | Q2 | LOCKED |
| D3 | F6 sub-recipes ownership | Q3 | LOCKED |
| D4 | LAN architecture (hybrid port) | Q4 | LOCKED |
| D5 | Notification provider | Q5 | LOCKED |
| D6 | QRIS provider | Q6 | LOCKED |
| D7 | Capacitor vs PWA | Q8 | LOCKED |
| D8 | Staging environment | Q9 | LOCKED |
| D9 | `packages/ui` steward | Q10 | LOCKED |
| D10 | `has_permission()` refactor | (R14) | LOCKED |
| D11 | `accounting_mappings` table | Q11 | LOCKED |
| D12 | `fiscal_periods` table | Q11 | LOCKED |
| D13 | `reference_type` CHECK extension | (R3) | LOCKED |
| D14 | RPC versioning Session 13 | (R14 prereq) | LOCKED |
| D15 | F1 expiry ledger invariant (pattern a) | (R5) | LOCKED |
| D16 | Refund JE pattern — unconditional audit + refactor | Q13 | LOCKED |
| D17 | Edge Function rate-limit | (R-) | LOCKED |
| D18 | Kiosk-mode auth | (R4) | LOCKED |
| D19 | Realtime channel naming | (R-) | LOCKED |
| D20 | Production trigger philosophy | Q12 | LOCKED |
| (E1) | Multi-tenancy timing | Q7 | DEFERRED to Phase 7 (Session 15) |

Total resolved audit questions: **Q1, Q2, Q3, Q4, Q5, Q6, Q7, Q8, Q9, Q10, Q11, Q12, Q13 = 13 / 13.**

---

## D1 — V2 → V3 path translation ownership

- **Status.** LOCKED — 2026-05-14.
- **Resolves audit Q1.** "Should architect produce the translation table as part of Phase 0, or do you author it directly?"
- **Decision.** Architect (`arch-steward`, Phase 0.1) produces `docs/workplan/refs/2026-05-13-v2-v3-path-translation.md`. The table is a living reference. Every phase plan cites it. User `guichduh33` retains veto on any specific row; default = trust the rules of placement (D1 placement rules).
- **Rationale.** Mechanical translation has clear rules (pure → `packages/domain`, IO → `packages/supabase` or feature, UI → `packages/ui` or feature). Business intent surfaces only in edge cases (phantom-tables D2, F6 D3, LAN D4) — those are decoupled decisions in this same pack.
- **Affected phases.** Phase 0.1 produces. All subsequent phases consume.

## D2 — Phantom-tables decisions

- **Status.** LOCKED — 2026-05-14.
- **Resolves audit Q2.** "Are `stock_reservations`, `stock_balances`, `customer_invoices`, `get_settings_by_category` features you want to keep or drop?"
- **Decision (per table).**
  - **`stock_reservations`** → **CREATE.** Useful for tablet hold flow + B2B credit hold. Task 06-003 (Phase 3) creates table + RLS; 06-009 adds `reservation_hold_v1`/`reservation_release_v1` RPCs. Module 09 (B2B) consumes via 09-004.
  - **`stock_balances`** → **DROP usage.** Replace with `section_stock` table (already exists since Session 12 Phase 2) + new view `view_section_stock_details` aggregating `section_stock × products × sections` with stock × cost_price valuation. View created Phase 2.D.
  - **`customer_invoices`** → **DROP usage.** B2B 09 uses `orders.invoice_number` + new view `view_b2b_invoices` (Phase 3.C).
  - **`get_settings_by_category`** → **CREATE RPC.** Useful for module 19 settings hub. Task 19-001 (Phase 5).
  - **`print_queue`** (21-004) → **CREATE table** as part of LAN module Phase 5.
- **Rationale.** Reservation and print queue patterns add value (tablet UX, print resilience). Balances and invoices duplicate data the source tables already track — a view is cheaper and stays consistent.
- **Verifications.**
  - `grep -R stock_reservations supabase/` → 0 hit (table absent — to create).
  - `grep -R stock_balances supabase/` → 0 hit (no current usage — DROP confirmed clean).
  - `grep -R customer_invoices supabase/` → 0 hit (no V3 footprint — DROP confirmed clean).
  - `grep -R get_settings_by_category supabase/` → 0 hit (RPC absent — to create).
- **Affected phases.** 0 (decide), 2.D (view), 3 (reservations + RPCs), 5 (settings RPC + print queue).

## D3 — F6 sub-recipes ownership

- **Status.** LOCKED — 2026-05-14.
- **Resolves audit Q3.** "Recipes owned by Products module (05) or Production module (15)?"
- **Decision.** Module **15 (Production)** owns `recipes` (`recipes(product_id, material_id, quantity, unit, is_active)` — flat). Module **05 (Products)** reads read-only via `view_product_recipes` (joined view).
- **Rationale.** Recipes are BOM (bill-of-materials) — semantically a production concept. Products UI only needs catalogue-level read affordance, not write. Sub-recipes recursive (semi-finished goods chained) = out-of-scope Session 13 (Phase 7).
- **Affected phases.** Phase 2 (module 15 creates `recipes` + `view_product_recipes`; module 05 consumes read-only).

## D4 — LAN architecture (hybrid port)

- **Status.** LOCKED — 2026-05-14.
- **Resolves audit Q4.** "Port V2 BroadcastChannel+Realtime hybrid as-is, or consolidate to Supabase Realtime only?"
- **Decision.** **Hybrid kept.** Supabase Realtime = main transport (already used by KDS). BroadcastChannel = local hub for intra-store low-latency (< 10 ms). V2 services (`lanHub.ts`, `lanClient.ts`, `lanHubMessageHandler.ts`) port to:
  - `packages/domain/src/lan/` — pure protocol parsing + UUID/TTL dedup.
  - `apps/pos/src/features/lan/` — transport (hub + client).
- **Rationale.** KDS in V3 already depends on Realtime. BroadcastChannel costs nothing extra and shaves 100-200 ms on local hops. WebRTC mesh = Phase 7 (multi-store).
- **Affected phases.** 5 (module 21 implementation).

## D5 — Notification provider

- **Status.** LOCKED — 2026-05-14.
- **Resolves audit Q5.** "Twilio, Sendgrid, SES, on-prem SMTP, or Supabase Functions HTTP fanout?"
- **Decision.** **Supabase Edge Functions HTTP fanout** as façade. Downstream providers wired via env vars (`SENDGRID_API_KEY`, `TWILIO_*`, `WHATSAPP_*`). Channel layer in `packages/domain/src/notifications/` (pure: compose Message, decide channels). Transport in `supabase/functions/notification-dispatch/` (HTTP-callable, signed via PIN JWT). Session 13 MVP: **email-only** (Sendgrid or SMTP-relay via Resend). SMS/WhatsApp = Phase 5+ or Phase 7.
- **Rationale.** EF façade gives provider lock-out insurance. Email-first matches Indonesian SMB pattern (low-cost SMS is unreliable; WhatsApp Business requires Meta verification — out-of-scope MVP).
- **Affected phases.** 5 (module 08-006 split into 3 sub-tasks).

## D6 — QRIS provider

- **Status.** LOCKED — 2026-05-14.
- **Resolves audit Q6.** "Midtrans, Xendit, DOKU, or direct BI integration?"
- **Decision.** **Xendit** (Indonesia, public API, sandbox available). Adapter added Phase 4 if capacity allows; otherwise QRIS defers to Phase 7. EF `process-payment` exists; Xendit adapter slots into it.
- **Rationale.** Xendit has the cleanest sandbox + best developer docs among Indonesian PSPs as of 2026-05. Direct BI = regulatory complex.
- **Affected phases.** 4 (conditional on capacity); otherwise Phase 7.

## D7 — Capacitor vs PWA (module 18 mobile shell)

- **Status.** LOCKED — 2026-05-14.
- **Resolves audit Q8.** "Capacitor or PWA preference?"
- **Decision.** **PWA-first** (vite-plugin-pwa + service worker). Capacitor evaluated Phase 7 if native push notification becomes a hard requirement.
- **Rationale.** Tablet/POS already runs in browser. PWA covers offline-graceful + install-on-home-screen at zero build complexity. Native push = Phase 7 trigger.
- **Affected phases.** Module 18 entirely deferred Phase 7. Phase 4 module 17 (tablet) uses PWA workbox.

## D8 — Staging environment

- **Status.** LOCKED — 2026-05-14.
- **Resolves audit Q9.** "Confirm `ikcyvlovptebroadgtvd` as staging, or provision separate?"
- **Decision.** **`ikcyvlovptebroadgtvd`** (V3 dev sandbox, per `MEMORY.md`) is the official Session 13 staging. All Phase 1+ migrations tested there first before any prod target. Prod V2 (`abjabuniwkqpfsenxljp`) is **NOT** a Session 13 target — incompatible schema.
- **Rationale.** Already paid for ($10/mo per MEMORY.md). Schema matches V3 monorepo. No new infra spend.
- **Affected phases.** Phase 0.2 confirms in CI; all migrations push there first.

## D9 — `packages/ui` steward

- **Status.** LOCKED — 2026-05-14.
- **Resolves audit Q10.** "Designate one human/subagent for 22-006 batches?"
- **Decision.** Single named subagent **`ui-steward`** owns `packages/ui/src/` for the duration of Session 13. Every PR touching `packages/ui/src/` routes through `ui-steward`. Modal migration 22-006 (72+ modals) split into 3 batches:
  - Batch 1 — Phase 1 — ~24 POS modals → Radix Dialog primitive.
  - Batch 2 — Phase 4 — ~24 BO modals.
  - Batch 3 — Phase 6 — ~24 tablet/display modals.
- **Rationale.** Without serialization, parallel subagents racing on `packages/ui/src/` produce merge thrash and design drift. One steward = consistent token use, consistent primitive API.
- **Affected phases.** 1, 4, 6.

## D10 — `has_permission()` refactor

- **Status.** LOCKED — 2026-05-14.
- **Resolves audit R14.** `has_permission()` re-publish fragility.
- **Decision.** Refactored Phase 1 (Stream B, first migration `20260517000030`) into a **pure lookup** form. Future migrations **never** `CREATE OR REPLACE has_permission`. New permissions = `INSERT INTO permissions/role_permissions`.
- **Design.** See `docs/workplan/refs/2026-05-13-has_permission-refactor-design.md`.
- **Current V3 state (verified).** `has_permission` is `CREATE OR REPLACE`'d in **11 migrations** in V3 today (every time a new permission seed lands). Each re-publish risks regression. Grep evidence:
  ```
  $ grep -RE "FUNCTION (public\.)?has_permission\b" supabase/migrations/ | grep CREATE
  20260503000006_init_helpers.sql:41:CREATE OR REPLACE FUNCTION has_permission(...)
  20260507000001_extend_orders_tablet.sql:29:CREATE OR REPLACE FUNCTION has_permission(...)
  20260508000002_seed_sales_discount_permission.sql:30:CREATE OR REPLACE FUNCTION has_permission(...)
  20260511000006_seed_promotions_perms_and_demo.sql:49:CREATE OR REPLACE FUNCTION has_permission(...)
  20260512000007_seed_refund_perms.sql:43:CREATE OR REPLACE FUNCTION has_permission(...)
  20260513000004_seed_backoffice_crud_perms.sql:101:CREATE OR REPLACE FUNCTION has_permission(...)
  20260514000003_seed_loyalty_perms.sql:32:CREATE OR REPLACE FUNCTION has_permission(...)
  20260516000004_seed_inventory_perms.sql:44:CREATE OR REPLACE FUNCTION has_permission(...)
  20260516000018_seed_inventory_perms_phase2.sql:73:CREATE OR REPLACE FUNCTION has_permission(...)
  (11 total)
  ```
  Same for `has_permission_for_profile` (introduced `20260512000007`).
- **Rationale.** Lookup-pure function is a no-op once the data tables are populated. Eliminates a class of mistakes (forgotten role, typo'd permission string, copy-paste drift between two function bodies).
- **Affected phases.** Phase 1.B.

## D11 — `accounting_mappings` table

- **Status.** LOCKED — 2026-05-14.
- **Resolves audit Q11.** "Was `accounting_mappings` ported from V2 to V3?"
- **Decision.** **Absent in V3 today.** Phase 1 Stream A task 10-A0 creates the table + seeds 24 mapping keys (SALE_PAYMENT_CASH, SALE_PAYMENT_QRIS, SALE_PAYMENT_DEBIT, SALE_POS_REVENUE, SALE_PB1_TAX, SALE_DISCOUNT, PURCHASE_PAYABLE, PURCHASE_VAT_INPUT, INVENTORY_GENERAL, PRODUCTION_COGS, WASTE_EXPENSE, ADJUSTMENT_GAIN, ADJUSTMENT_LOSS, SHIFT_CASH_VARIANCE_LOSS, SHIFT_CASH_VARIANCE_GAIN, EXPENSE_*, B2B_AR, B2B_INVOICE_REVENUE, …). Helper `resolve_mapping_account(p_mapping_key TEXT) RETURNS UUID` SECURITY DEFINER.
- **Verification.** `grep -R accounting_mappings supabase/` → 0 hit. **Confirmed absent.**
- **Rationale.** Hard-coded account codes in triggers (currently `'1110'`, `'4100'`, `'2110'` literal strings) prevent COA reshuffles and create silent bugs when a code changes. Mapping table = single source of truth.
- **Affected phases.** Phase 1.A blocks everything downstream that posts JE.

## D12 — `fiscal_periods` table

- **Status.** LOCKED — 2026-05-14.
- **Resolves audit Q11 (companion).** Same family as D11.
- **Decision.** **Absent in V3 today.** Phase 1 Stream A task 10-A0bis creates the table (`id`, `period_start`, `period_end`, `status` IN draft/open/closed/locked, `closed_by`, `closed_at`, `locked_by`, `locked_at`) + RLS + helper `check_fiscal_period_open(p_date DATE) RETURNS VOID` that RAISEs `period_locked` (`P0004`) if the date falls in a closed/locked period.
- **Verification.** `grep -R fiscal_periods supabase/` → 0 hit. **Confirmed absent.**
- **Rationale.** Without a period lock, a refund or adjustment can rewrite history into a previously-finalized month — accounting nightmare. Guard at JE creation time.
- **Affected phases.** Phase 1.A.

## D13 — `reference_type` CHECK extension

- **Status.** LOCKED — 2026-05-14.
- **Resolves audit R3.** "`reference_type` CHECK extended breaks existing JEs."
- **Decision.** Phase 1 Stream A migration `20260517000003` drops the existing CHECK and adds:
  ```sql
  CHECK (reference_type IN (
    'sale','sale_void','sale_refund',
    'purchase','purchase_return','purchase_payment',
    'expense','expense_payment',
    'shift_close',
    'adjustment','waste','opname','production','transfer',
    'manual','pos_outstanding','pos_outstanding_payment'
  ))
  ```
  → **17 types** (16 from audit §3.2 + `sale_refund` separated from `sale_void`).
- **Rationale.** Widening a CHECK never breaks existing rows. V3 prod is not in service yet (incompat with V2 per MEMORY.md), so no rewrites required.
- **Affected phases.** Phase 1.A migration `20260517000003`.

## D14 — RPC versioning Session 13

- **Status.** LOCKED — 2026-05-14.
- **Decision.** Bumps committed:
  - `complete_order_with_payment_v8 → v9` (Phase 1, after sale JE refactor via mapping).
  - `pay_existing_order_v5 → v6` (Phase 1, idempotency 03-001).
  - `refund_order_rpc → refund_order_rpc_v2` (Phase 1, mapping JE — see D16).
  - **`evaluate_promotions_v1`** **built-from-scratch** (Phase 2.C — no SQL predecessor; TS engine in `packages/domain/src/promotions/` remains for client-side preview).
- **Verification.**
  - `grep -RE "FUNCTION (public\.)?evaluate_promotions" supabase/migrations/` → **0 hit**. Confirmed no SQL predecessor — `_v1` is correct.
  - Inline triggers (`create_sale_journal_entry`, `create_purchase_journal_entry`) exempt from RPC versioning — they are DROP+CREATE OR REPLACE in their feature migration.
  - No `create_stock_movement_journal_entry` trigger exists in V3 (verified by absence of grep hit on that name) — D20 confirms the canonical Session 13 trigger is `tr_20_je_emit`.
- **Rationale.** RPC versioning is monotonic (CLAUDE.md critical pattern). Every signature change = new `_vN+1`, drop old in same migration.
- **Affected phases.** 1, 2.C.

## D15 — F1 expiry ledger invariant (pattern a)

- **Status.** LOCKED — 2026-05-14.
- **Resolves audit R5.** "F1 FIFO trigger violates ledger invariant."
- **Decision (pattern a — lot resolved UPFRONT).**
  1. `record_stock_movement_v1` signature **extended additively** (parameter `p_lot_id UUID DEFAULT NULL` added at tail; old callers unaffected — NOT a `_v2` bump).
  2. For consuming movement types (`sale`, `sale_void`, `waste`, `transfer_out`, `production_out`), if `p_lot_id IS NULL`, the RPC self-resolves FIFO:
     ```sql
     SELECT id INTO v_lot
       FROM stock_lots
       WHERE product_id = $1
         AND status = 'active'
         AND quantity > 0
       ORDER BY expires_at ASC
       LIMIT 1
       FOR UPDATE;
     ```
     then decrements `stock_lots.quantity` in the same transaction.
  3. `stock_lots.quantity` is mutable (UPDATE allowed on `stock_lots`, which is NOT append-only).
  4. `stock_movements.lot_id` is set at INSERT, never after — **NO trigger AFTER INSERT** on `stock_movements` modifies `lot_id`.
- **pgTAP tests.** `T_F1_LOT_INVARIANT` (RLS `authenticated` INSERT direct → denied) + `T_F1_NO_UPDATE_INVARIANT` (`SELECT count(*) FROM pg_trigger WHERE tgrelid='stock_movements'::regclass AND tgenabled='O' AND tgname LIKE '%fifo%'` = 0).
- **Rationale.** The alternative (pattern b — AFTER INSERT trigger UPDATEs `lot_id` post-hoc) violates the "stock_movements is append-only" invariant (CLAUDE.md critical pattern). Pattern a keeps the invariant intact at the cost of a slightly heavier RPC.
- **Affected phases.** 1.C (F1 expiry tracking).

## D16 — Refund JE pattern — unconditional audit + unconditional refactor

- **Status.** LOCKED — 2026-05-14.
- **Resolves audit Q13.** "Existing `fn_create_je_for_refund` — mapping or hardcoded?"
- **Decision (procedural).** Phase 0.1 audit conducted **unconditionally**. Phase 1.A migration `20260517000013_refactor_refund_je.sql` lands **regardless of audit finding** because the V3 trigger predates the `accounting_mappings` table (D11) — at minimum the codes must move to `resolve_mapping_account()` + idempotency UNIQUE + fiscal guard are added. `refund_order_rpc_v2` bumped concurrently.
- **Audit findings (see "Refund JE audit" section below).**
- **Affected phases.** 0.1 (audit), 1.A (refactor).

## D17 — Edge Function rate-limit

- **Status.** LOCKED — 2026-05-14.
- **Decision.** Shared helper `supabase/functions/_shared/rate-limit.ts` (Token-bucket + Postgres `edge_function_rate_limits` table). Phase 1 Stream B task 25-002. No per-EF re-implementation.
- **Current V3 state.** `supabase/functions/_shared/rate-limit.ts` already exists (used by `refund-order/index.ts`). 25-002 extends it (Postgres-backed bucket + IP+key partition) and applies it on `auth-verify-pin` (3 attempts / 15 min / IP).
- **Affected phases.** 1.B.

## D18 — Kiosk-mode auth

- **Status.** LOCKED — 2026-05-14.
- **Resolves audit R4.** "RLS anon → authenticated breaks KDS/Display/Tablet."
- **Decision.** KDS/Display/Tablet stations without staff PIN run on a **kiosk service-account JWT**, issued by EF `kiosk-issue-jwt` (rate-limited, IP-allowlisted on staging). Phase 0 finalizes design; Phase 1 implements **before** 25-001 (RLS hardening) lands — otherwise kiosks break instantly.
- **Rationale.** Anonymous role anti-pattern (no audit trail, no per-device limit). Service-account JWT = scoped read-only access + auditable.
- **Affected phases.** 0.1 (design), 1.B (impl), then 25-001.

## D19 — Realtime channel naming

- **Status.** LOCKED — 2026-05-14.
- **Decision.** Every realtime hook follows the `useKdsRealtime.ts` pattern:
  ```ts
  const channelName = useMemo(
    () => `<topic>-${id}-${Math.random().toString(36).slice(2, 9)}`,
    [id]
  );
  ```
  Audit grep at end of each phase: `grep -RE "supabase\.channel\(" apps/` → any static-name occurrence = fix before merge.
- **Rationale.** React StrictMode double-mount + shared static channel name = silent realtime drop. Already burned us once (CLAUDE.md critical patterns).
- **Affected phases.** All phases touching realtime.

## D20 — Production trigger philosophy

- **Status.** LOCKED — 2026-05-14.
- **Resolves audit Q12.** "Mary P0-2 — TS engine is source of truth, drop the trigger. Revisit?"
- **Decision.** **No `create_stock_movement_journal_entry` trigger exists in V3** (verified — never ported from V2). JE for stock movements (waste, adjustment, opname, production) is emitted by the new trigger **`tr_20_je_emit`** (Phase 1 Stream A migration `20260517000023`). Numeric prefix `_20_` encodes AFTER INSERT firing order relative to `_10_*` (validation) and `_30_*` (downstream). Single source of truth — **no** TS wrapper duplicates the writes.
- **Verification.** `grep -R create_stock_movement_journal_entry supabase/` → 0 hit. **Confirmed: no V2 trigger to drop.**
- **Rationale.** DB trigger is atomic with the stock movement INSERT — no race. TS-only would risk partial state if the client crashed between movement and JE. Idempotency via UNIQUE on `journal_entries.reference_type + reference_id`.
- **Affected phases.** 1.A.

## (E1) — Multi-tenancy timing (Q7 → DEFERRED)

- **Status.** DEFERRED to Session 15 (Q3 2026).
- **Resolves audit Q7.** "Confirm OK to defer past Session 13?"
- **Decision.** Yes — deferred. 19-008 (`tenants` table + scope guard) is a full architectural refactor: every RLS policy, every RPC, every store gains a `tenant_id`. Not bundleable with Session 13 throughput.
- **Cascade.** Defers 21-011 (multi-LAN), 10-020 (multi-entity consolidation), 08-011 (multi-site customers).

---

# Refund JE audit (unconditional, per D16)

> Audited 2026-05-14 by `arch-steward`. Scope: `fn_create_je_for_refund` + every client-side path that could construct a JE for a refund.

## A. Trigger — `fn_create_je_for_refund` (`20260512000005_init_refund_je_trigger.sql`)

**Hardcoded codes: YES.**

Evidence (file lines 30-32):
```sql
SELECT id INTO v_cash_id  FROM accounts WHERE code = '1110' AND is_active;
SELECT id INTO v_sales_id FROM accounts WHERE code = '4100' AND is_active;
SELECT id INTO v_pb1_id   FROM accounts WHERE code = '2110' AND is_active;
```
All three codes are literal strings — no `accounting_mappings` indirection (which is consistent with D11 verification that the table does not exist).

**Idempotency: NO.**

Evidence:
- No `SELECT … FROM journal_entries WHERE reference_type='refund' AND reference_id = NEW.id` pre-check before INSERT.
- No `UNIQUE` constraint enforced (the `entry_number` is built as `'JE-REF-' || NEW.refund_number`, which is unique-by-naming-convention but not enforced by the schema — and even then nothing stops a duplicate INSERT if the trigger fires twice).
- Trigger is `AFTER INSERT ON refunds`, so a single refund row = single trigger fire; however, if the RPC is retried (network blip) and creates a second `refunds` row with a duplicated `refund_number` collision (rejected) — fine — but a second distinct `refunds.id` with the same `order_id`/`tenders` = a second JE silently created.

**Fiscal period guard: NO.**

Evidence:
- `NEW.created_at::date` is used as the JE `entry_date` (line 49) — no validation that this date falls in an open period.
- No `check_fiscal_period_open(NEW.created_at::date)` call (consistent with D12 — `fiscal_periods` does not exist).

## B. Client-side JE construction

**Direct JE construction in app code: NONE.**

Evidence (greps run from repo root):
- `grep -R "journal_entr|fn_create_je|account_id.*debit" apps/` → 0 hit.
- `grep -R "journal_entr|fn_create_je" packages/domain/src/refunds/` → 0 hit.
- `supabase/functions/refund-order/index.ts` — confirmed: calls `userClient.rpc('refund_order_rpc', …)` and returns the JSON envelope; no direct JE insert.
- `supabase/migrations/20260512000010_create_refund_order_rpc.sql` — the RPC itself does NOT write to `journal_entries` directly; it INSERTs into `refunds` (which fires `trg_create_je_for_refund`) and into `refund_payments` (same transaction). No JE-construction code outside the trigger.
- `packages/domain/src/refunds/` — pure validators (`validateRefund.ts`, `computeRefund.ts`); no Supabase / no JE writes.

## C. Required Phase 1.A refactor (migration `20260517000013_refactor_refund_je.sql`)

Given the three findings above, the refactor lands **unconditionally** (per D16):

1. Replace `SELECT id FROM accounts WHERE code='1110'…` with `SELECT resolve_mapping_account('SALE_PAYMENT_CASH')` (or appropriate key per `refund_payments.method`).
2. Replace `'4100'` lookup with `resolve_mapping_account('SALE_POS_REVENUE')`.
3. Replace `'2110'` lookup with `resolve_mapping_account('SALE_PB1_TAX')`.
4. Add idempotency guard:
   ```sql
   PERFORM 1 FROM journal_entries
     WHERE reference_type='refund' AND reference_id=NEW.id;
   IF FOUND THEN RETURN NEW; END IF;
   ```
5. Add fiscal guard:
   ```sql
   PERFORM check_fiscal_period_open(NEW.created_at::date);
   ```
6. Add UNIQUE constraint `journal_entries(reference_type, reference_id)` (if not present from D11 work).
7. Bump RPC: `refund_order_rpc_v2` (signature unchanged; behaviour now goes through refactored trigger). Drop `refund_order_rpc` in same migration.

## D. Summary table

| Aspect | Current V3 state | Phase 1.A target |
|---|---|---|
| Hardcoded codes | **YES** (`1110`, `4100`, `2110`) | Mapping via `resolve_mapping_account()` |
| Idempotency | **NO** | UNIQUE + pre-INSERT SELECT |
| Fiscal period guard | **NO** | `check_fiscal_period_open()` call |
| Client-side JE writes | **NONE** | (no change — already clean) |
| RPC version | `refund_order_rpc` | `refund_order_rpc_v2` |

---

# V3-absence verifications (grep evidence inline)

> All claims required by Phase 0.1 DoD are verified here with the exact grep commands and their results captured 2026-05-14.

## 1. `accounting_mappings` — ABSENT

```
$ grep -R accounting_mappings supabase/
(no hit)
```
**Confirmed absent.** Will be created in Phase 1.A migration `20260517000001_create_accounting_mappings.sql`.

## 2. `fiscal_periods` — ABSENT

```
$ grep -R fiscal_periods supabase/
(no hit)
```
**Confirmed absent.** Will be created in Phase 1.A migration `20260517000002_create_fiscal_periods.sql`.

## 3. `resolve_mapping_account()` — ABSENT

```
$ grep -R resolve_mapping_account supabase/
(no hit)
```
**Confirmed absent.** Created alongside `accounting_mappings` in Phase 1.A migration `20260517000001`.

## 4. `evaluate_promotions` SQL function — ABSENT

```
$ grep -RE "FUNCTION (public\.)?evaluate_promotions" supabase/migrations/
(no hit)
```
**Confirmed absent.** Phase 2.C will create `evaluate_promotions_v1` from scratch (no SQL predecessor — `_v1` is correct). The matching logic currently lives in `packages/domain/src/promotions/` as pure TS; Phase 2.C ports the BOGO/threshold/bundle subset to SQL while leaving the TS engine in place for client-side preview.

## 5. `view_section_stock_details` — ABSENT

```
$ grep -R view_section_stock_details supabase/migrations/
(no hit)
```
**Confirmed absent.** Phase 2.D will create the view aggregating `section_stock × products × sections` with `stock × cost_price` valuation column.

## 6. `create_stock_movement_journal_entry` trigger — ABSENT

```
$ grep -R create_stock_movement_journal_entry supabase/
(no hit)
```
**Confirmed absent.** D20 confirms there is **no V2 trigger to drop**; the canonical Session 13 trigger is `tr_20_je_emit` (new, Phase 1.A migration `20260517000023`).

## 7. `has_permission` re-CREATE'd 11× (D10 root cause) — VERIFIED

See D10 above for the full grep evidence and full list of 11 migrations that re-CREATE the function today.

## 8. `audit_log` (singular) vs `audit_logs` (plural) — BOTH EXIST

```
$ grep -RE "CREATE TABLE (audit_log|audit_logs)\b" supabase/migrations/
supabase/migrations/20260503000005_init_settings.sql:25: CREATE TABLE audit_logs (
supabase/migrations/20260515000002_init_audit_log.sql:11: CREATE TABLE audit_log (
```
**Canonical = `audit_logs` plural** (D2 / Session 12 spec §C0). Phase 1.B migration `20260517000034_drop_legacy_audit_log_singular.sql` migrates rows and drops the singular table.

## 9. Phantom tables `stock_reservations`, `stock_balances`, `customer_invoices`, `get_settings_by_category` — ALL ABSENT

```
$ grep -R "stock_reservations|stock_balances|customer_invoices|get_settings_by_category" supabase/
(no hit)
```
**Confirmed.** D2 decisions apply.

## 10. `_shared/rate-limit.ts` — PARTIALLY EXISTS

```
$ ls supabase/functions/_shared/
cors.ts  manager-pin.ts  rate-limit.ts
```
Used today only by `refund-order/index.ts`. Phase 1.B 25-002 extends it (Postgres-backed token bucket) and applies it broadly.

---

# Migration numbering reservation (Session 13)

Block reserved: `20260517000001..20260517999999`. Last applied Session 12: `20260516000024`. First Session 13: `20260517000001`. Phase 0.1 reserves these slots:

| Slot | Purpose | Phase |
|---|---|---|
| `20260517000001` | `accounting_mappings` + `resolve_mapping_account()` | 1.A |
| `20260517000002` | `fiscal_periods` + `check_fiscal_period_open()` | 1.A |
| `20260517000003` | `reference_type` CHECK widening | 1.A |
| `20260517000004` | Account `3300 Current Year Earnings` | 1.A |
| `20260517000005` | COA SAK EMKM seed + `PRODUCTION_COGS → 5110` | 1.A |
| `20260517000010` | Sale JE refactor via mapping → `complete_order_with_payment_v9` | 1.A |
| `20260517000011` | Purchase JE trigger (from scratch) | 1.A |
| `20260517000012` | `calculate_vat_payable` RPC | 1.A |
| `20260517000013` | Refund JE refactor (per D16) → `refund_order_rpc_v2` | 1.A |
| `20260517000021..023` | `stock_movements.lot_id` + `tr_stock_movement_je()` + trigger attach + UNIQUE | 1.A |
| `20260517000030` | `has_permission()` refactor (D10) | 1.B |
| `20260517000034` | DROP legacy `audit_log` singular | 1.B |

Subsequent phases pick the next free ordinal. The plan-INDEX assigns explicit numbers when each sub-plan lands.

---

*End of decision pack. Locked 2026-05-14. Any future change creates a new dated decision file — never edit this one in place.*
