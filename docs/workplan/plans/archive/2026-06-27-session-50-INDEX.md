# Session 50 — INDEX — Vague 1 « cutover sain »

> Branch `swarm/session-50` · Spec `2026-06-27-session-50-spec.md` · Plan `2026-06-27-session-50-plan.md`
> DB layer applied + verified live on cloud `ikcyvlovptebroadgtvd` by the main session (MCP);
> file-producing + UI + CI work by the swarm (db-engineer / backoffice / test-engineer).

## 1. Summary

- **Drift #125 closed** — the missing dispatch objects (`_resolve_dispatch_stations_v1`, `categories.dispatch_station`, `products.dispatch_stations`) reapplied idempotently; verified present live.
- **Financial/report RPCs gated** — `get_general_ledger`, `get_trial_balance`, `get_profit_loss`, `get_balance_sheet`, `get_sales_by_hour` bumped to `_v2` with an internal `has_permission` gate (a cashier could previously read the whole GL via PostgREST). pgTAP `financial_rpc_perm_gates` 13/13.
- **Leaks closed** — `audit_log` view → `security_invoker=true`; `mv_pl_monthly`/`mv_sales_daily`/`mv_stock_variance` → `REVOKE SELECT FROM authenticated + PUBLIC`. pgTAP `security_leak_guard` 11/11 (+2 skipped, deferred POS views).
- **BO gates wired** — products/B2B/settings-security routes+sidebar gated on real codes (`products.read`, new `b2b.read`, new `settings.security.manage`); customer-search RPCs internally gated (`search_customers_v3`/`get_customer_v3`); 12 dead `as PermissionCode` casts removed. Full `pnpm typecheck` green (6/6).
- **CI net activated** — `supabase/tests` in the workspace (+lockfile), nightly live-RPC + drift-check jobs, `pgtap-pr` flipped to blocking, types-regen sync gate.

## 2. Migrations applied (local NAME-block → cloud version clock-assigned by main)

| File timestamp | Object |
|---|---|
| `20260710000051_reapply_dispatch_drift` | drift reapply: `_resolve_dispatch_stations_v1`, `categories.dispatch_station`, `products.dispatch_stations`, category mapping (idempotent) |
| `20260710000052_gate_financial_report_rpcs` | `get_general_ledger_v2`, `get_trial_balance_v2`, `get_profit_loss_v2`, `get_balance_sheet_v2`, `get_sales_by_hour_v2` (+DROP v1) |
| `20260710000053_seed_b2b_settings_security_perms` | seed `b2b.read`, `settings.security.manage` + role grants |
| `20260710000054_gate_customer_search_rpcs` | `search_customers_v3`, `get_customer_v3` (internal `has_permission`) + `role_permissions` seed (`waiter` lowercase) |
| `20260710000055_close_definer_view_mv_leaks` | `audit_log` security_invoker; MV REVOKEs; POS views deferred (comments) |
| `20260710000056_search_path_index_hardening` | `SET search_path` on 3 DEFINER fns + `idx_orders_paid_at_status` (CONCURRENTLY, out-of-txn) |

## 3. New files

- **DB tests:** `supabase/tests/security_leak_guard.test.sql`, `supabase/tests/financial_rpc_perm_gates.test.sql`
- **Workplan:** spec, plan, this INDEX.

## 4. Files modified

- `packages/supabase/src/rls/permissions.ts` — `PermissionCode` union += `b2b.read`, `settings.security.manage`.
- `packages/supabase/src/types.generated.ts` — regenerated post-apply (by main).
- `apps/backoffice/src/routes/index.tsx` — gate products + products/:id (`products.read`), b2b/b2b-payments (`b2b.read`), settings/security (`settings.security.manage`).
- `apps/backoffice/src/layouts/Sidebar.tsx` — B2B items → `b2b.read`, Products item gated, 12 dead casts removed.
- `apps/backoffice/.../{useGeneralLedger,useTrialBalance,useBalanceSheet,useProfitLoss,useSalesByHour,useCustomerSearch}.ts`, `apps/pos/.../{useReopenHeldOrder,useRestoreHeldOrder}.ts`, `apps/pos/src/pages/Pos.tsx` — call-sites bumped to `_v2`/`_v3` (by db-engineer).
- `.github/workflows/{ci,pgtap-nightly,pgtap-pr}.yml`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` — CI nets + workspace member.

## 5. Tests run

| Suite | Count | Status |
|---|---|---|
| pgTAP `security_leak_guard` | 11 pass / 2 skip | PASS (live, by main) |
| pgTAP `financial_rpc_perm_gates` | 13 | PASS (live, by main) |
| `pnpm typecheck` (full) | 6 projects | PASS |
| `@breakery/supabase` / `@breakery/app-backoffice` typecheck | — | PASS |

## 6. Permissions seeded

- `b2b.read` → MANAGER / ADMIN / SUPER_ADMIN (B2B Dashboard + Payments).
- `settings.security.manage` → ADMIN / SUPER_ADMIN (settings/security route).

## 7. RPCs added / bumped

| Action | RPC | Notes |
|---|---|---|
| bump | `get_general_ledger_v1→v2` | + `has_permission` gate |
| bump | `get_trial_balance_v1→v2` | + gate |
| bump | `get_profit_loss_v1→v2` | + gate |
| bump | `get_balance_sheet_v1→v2` | + gate |
| bump | `get_sales_by_hour_v1→v2` | + gate |
| bump | `search_customers_v2→v3` | internal `customers.read` (or `pos.sale.create`) gate |
| bump | `get_customer_v2→v3` | internal gate |

## 8. Deferred S51+ / follow-ups

1. **POS views** `v_product_available_stock` + `view_product_allergens_resolved` — `security_invoker=on` deferred (would break CASHIER/waiter cascade via `inventory.read` RLS on recipes/stock_reservations). Needs a scoped POS grant or a DEFINER+internal-gate rewrite. (DEV-S50-1.5-01)
2. **search_path** — only the 3 SECURITY DEFINER functions hardened this session; the remaining INVOKER functions flagged by the advisor are deferred. (DEV-S50-1.6-01)
3. **Storage bucket `product-images`** — privatization not applied (risk: app renders via public URLs; making it private requires switching to signed URLs first). Confirm + implement next. (DEV-S50-1.5-03)
4. **Leaked Password Protection (Auth)** — not toggled via MCP; manual dashboard/Management-API action. (DEV-S50-1.6-03)
5. **B2B views** `view_b2b_invoices` / `view_ar_aging` — `b2b.read` gate seeded but RLS gating on these views deferred until BO is wired (annotated in `_055`).
6. **`SUPABASE_SERVICE_ROLE_KEY` repo secret** — must be added by the repo owner for the nightly live-RPC job (see PR description).

## 9. Deviations vs spec/plan

| ID | Section | Original | What happened | Reason | Risk |
|---|---|---|---|---|---|
| DEV-S50-PRE-01 | Orchestration | db-engineer applies via MCP | MCP only on main; db-engineer produced SQL files, main applied + verified | MCP not mounted in subagent contexts | Informational |
| DEV-S50-1.1-01 | Item 1 | `resolve_dispatch_stations_v1` / `product_categories.default_dispatch_stations` | real objects are `_resolve_dispatch_stations_v1` / `categories.dispatch_station` | brief paraphrased; reconciled to source | Informational |
| DEV-S50-1.5-01 | Item 2 | align `v_product_available_stock` + `view_product_allergens_resolved` (security_invoker) | DEFERRED — would break POS reads | `inventory.read` RLS cascade on recipes/stock_reservations for CASHIER/waiter | Medium (deferred, tracked) |
| DEV-S50-1.5-03 | Item 2 | bucket `product-images` private | not applied | app likely uses public URLs; needs signed-URL migration first | Medium (deferred) |
| DEV-S50-1.6-01 | Item 6 | search_path on all 16 advisor-flagged fns | only 3 DEFINER fns hardened | INVOKER fns lower-risk; deferred to keep scope tight | Informational |
| DEV-S50-1.6-02 | Item 6 | index `orders(created_at DESC)` | index `idx_orders_paid_at_status` (CONCURRENTLY) | report query shape favours paid_at+status | Informational |
| DEV-S50-1.6-03 | Item 6 | Leaked Password Protection on | not toggled (manual) | Auth setting not exposed via MCP | Informational (manual follow-up) |
| DEV-S50-2b-01 | Item 5 | — | pgtap-pr referenced wrong test filename (`financial_rpc_permission_gate`) | corrected to `financial_rpc_perm_gates` before the blocking gate could fail | Informational (fixed) |
| DEV-S50-2b-02 | Item 5 | — | adding `supabase/tests` to workspace needed `pnpm-lock.yaml` regen | committed lockfile update | Informational (fixed) |

## 10. Acceptance criteria

- [x] A1 — drift dispatch objects present live; informational schema_migrations drift gate added (nightly).
- [x] A3 — 5 financial/report RPCs gated; permission-denied pgTAP 13/13.
- [x] A4 — products/B2B/settings-security routes+sidebar gated; customer RPCs internally gated; 12 casts removed; typecheck green.
- [x] A5 — `supabase/tests` in workspace (+lockfile); nightly live-RPC job; `pgtap-pr` blocking; types-regen sync gate. (needs `SUPABASE_SERVICE_ROLE_KEY` secret — user action)
- [~] A2 — audit_log + MVs closed + recurring pgTAP guard; **POS views + storage bucket deferred**.
- [~] A6 — 3 DEFINER fns search_path + index added; **INVOKER fns + Leaked Password Protection deferred**.
