# Session 11 — Backoffice CRUD étendu + Tablet split-pay smoke — INDEX

> **Trace historique** : ce fichier documente une session de travail datée. Le fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure (voir [`../../README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13
>
> **Modules concernés (références)** : [`07-purchasing-suppliers`](../../../reference/04-modules/07-purchasing-suppliers.md) · [`02-pos-cart-orders`](../../../reference/04-modules/02-pos-cart-orders.md) · [`08-customers-loyalty`](../../../reference/04-modules/08-customers-loyalty.md) · [`05-products-categories`](../../../reference/04-modules/05-products-categories.md) · [`13-promotions-discounts`](../../../reference/04-modules/13-promotions-discounts.md) · [`17-tablet-ordering`](../../../reference/04-modules/17-tablet-ordering.md) · [`03-payments-split`](../../../reference/04-modules/03-payments-split.md) · [`19-settings-configuration`](../../../reference/04-modules/19-settings-configuration.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the sub-plans referenced below. Steps use checkbox (`- [ ]`) syntax for tracking. **Read this INDEX first**, then dispatch a fresh subagent per sub-plan in execution order.

**Goal:** Ship the 7 backoffice CRUD UIs promised by the session 11 spec (DB layer already shipped via migrations 20260513*), add a `create_combo_with_items` RPC for nested combo writes, extract the existing customer CRUD into a dedicated Customers page, regroup the sidebar, and prove the tablet split-pay v5 path with an end-to-end smoke test.

**Architecture:**
- All BO pages follow the session 9 Promotions / session 10 Loyalty pattern: `pages/<Entity>.tsx` + `features/<entity>/{components,hooks}/`. Three components per entity (`FormModal`, `ListRow`, `DeleteConfirm`), four hooks (list + create + update + delete).
- Soft-delete via `UPDATE deleted_at = now()` (never physical DELETE).
- Form layer: React state + inline Zod (no `react-hook-form`), consistent with `PromotionForm`.
- RBAC: `<PermissionGate required="<module>.read">` around each route + UI buttons gated on `<module>.{create|update|delete}`. DB RLS enforces server-side; UI gates are UX only.
- Combo CRUD is the only nested write — a single SECURITY DEFINER RPC `create_combo_with_items(p_header JSONB, p_items JSONB)` keeps the products header + combo_items inserts atomic.
- The tablet split-pay path (`pay_existing_order` v5) is already wired in `apps/pos/src/features/payment/hooks/useCheckout.ts`; this session adds the smoke test that asserts a 2-tender pickup produces 2 `order_payments` rows.

**Tech Stack:** PostgreSQL + Supabase RLS, React + Vite + Vitest, React Query (TanStack v5), Tailwind (Luxe dark tokens), `react-router-dom`, `supabase-js`, `lucide-react`, Zod.

**Spec:** `docs/workplan/specs/2026-05-11-session-11-backoffice-crud-spec.md`

---

## Pre-existing state (verified against `origin/master` at HEAD `c4135e1`)

| Item | Status |
|---|---|
| Migrations 20260513000001-5 (suppliers, discount_templates, pay_existing_order v5, perms seed, RLS extend) | ✅ Applied |
| Migrations 20260514-16 (loyalty + audit log + inventory) | ✅ Applied |
| `pay_existing_order` v5 RPC | ✅ Live |
| Tablet checkout wiring (`useCheckout.ts` forwards `p_payment` xor `p_payments`) | ✅ Already in repo |
| BO Loyalty page (re-uses customer CRUD via `features/loyalty/`) | ✅ Live at `/backoffice/loyalty` |
| BO Inventory page (session 12) | ✅ Live at `/backoffice/inventory` |
| BO Promotions page (session 9) | ✅ Live at `/backoffice/promotions` |
| BO Products page | ⚠️ Read-only only — must be extended in **Phase 06** |
| `/backoffice/customers` route | ⚠️ Currently `<ComingSoonPage module="Customers" />` |
| `/backoffice/categories` route | ❌ Missing |
| `/backoffice/customer-categories` route | ❌ Missing |
| `/backoffice/tables` route | ❌ Missing |
| `/backoffice/combos` route | ❌ Missing |
| `/backoffice/discount-templates` route | ❌ Missing |
| `/backoffice/suppliers` route | ❌ Missing |
| `create_combo_with_items` RPC | ❌ Missing — created in **Phase 07** |
| Tablet split-pay smoke test | ❌ Missing — added in **Phase 09** |

---

## Sub-plans (execution order)

| # | File | Phase | Est. commits | Depends on |
|---|---|---|---|---|
| 01 | `2026-05-12-session-11-01-suppliers.md`           | Suppliers CRUD (template-bearing detail level — simplest, NEW table) | 6 | — |
| 02 | `2026-05-12-session-11-02-restaurant-tables.md`   | Restaurant Tables CRUD | 6 | 01 (pattern) |
| 03 | `2026-05-12-session-11-03-customer-categories.md` | Customer Categories CRUD (ADMIN-only write) | 6 | 01 |
| 04 | `2026-05-12-session-11-04-categories.md`          | Categories CRUD (color + dispatch_station) | 7 (incl. ALTER TABLE) | 01 |
| 05 | `2026-05-12-session-11-05-discount-templates.md`  | Discount Templates CRUD (NEW table; ADMIN-only write) | 6 | 01 |
| 06 | `2026-05-12-session-11-06-products-full-crud.md`  | Products full CRUD — extend the existing read-only page | 8 | 04 (categories FK) |
| 07 | `2026-05-12-session-11-07-combos.md`              | Combos CRUD + atomic `create_combo_with_items` RPC | 9 | 06 (product picker reuse) |
| 08 | `2026-05-12-session-11-08-customers-page.md`      | Wire `/backoffice/customers` to the existing loyalty-feature components (no rewrites) | 3 | — |
| 09 | `2026-05-12-session-11-09-tablet-splitpay-smoke.md` | Smoke test only — proves `pay_existing_order` v5 from pickup flow | 2 | — |
| 10 | `2026-05-12-session-11-10-sidebar-grouping.md`    | Reorder sidebar into Catalog / Customers / Operations groups | 2 | 01–08 (all routes must exist) |
| 11 | `2026-05-12-session-11-11-verification.md`        | Acceptance criteria run + perms-consistency smoke + final commit | 3 | All |

**Estimated total: ~58 commits across ~11 phases. Plan execution will likely span 3–5 sessions.**

---

## Cross-cutting conventions (referenced by every sub-plan)

### Date / migration numbering

All new migrations live under `supabase/migrations/`. The session 11 DB layer used the slot `20260513*`; session 12 used `20260514-16*`. Any new migrations this session use **`20260517000001`-and-up** to sort after the existing inventory migrations. Sub-plans that need a migration give the exact filename.

### Branch

Work on the current branch `swarm/session-10` (already fast-forwarded to `origin/master`, HEAD `c4135e1`). After session completion, open a PR `swarm/session-10` → `master`. Per repo convention this branch hosts session 11/13/etc. follow-up work.

### Commit messages

Conventional commits with session-scope. Examples:

```
feat(db): session 11 — create_combo_with_items RPC + GRANT
feat(backoffice): session 11 — Suppliers list page + 3 modals + 5 hooks
feat(ui): session 11 — extract DispatchStationBadge to @breakery/ui
test(backoffice): session 11 — suppliers CRUD smoke
chore(supabase): session 11 — regen types after categories ALTER
```

When AI-assisted, append the standard co-author trailer:

```
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Permission codes (already seeded — see `20260513000004_seed_backoffice_crud_perms.sql`)

Cross-checked against `packages/supabase/src/rls/permissions.ts` PermissionCode union. All codes below are live in both DB `has_permission()` and the EF `_shared/permissions.ts`:

| Module | Read | Create | Update | Delete |
|---|---|---|---|---|
| products            | `products.read`            | `products.create`            | `products.update`            | `products.delete`            |
| categories          | `categories.read`          | `categories.create`          | `categories.update`          | `categories.delete`          |
| customers           | `customers.read`           | `customers.create`           | `customers.update`           | `customers.delete`           |
| customer_categories | `customer_categories.read` | `customer_categories.create` | `customer_categories.update` | `customer_categories.delete` |
| restaurant_tables   | `tables.read`              | `tables.create`              | `tables.update`              | `tables.delete`              |
| combos              | `combos.read`              | `combos.create`              | `combos.update`              | `combos.delete`              |
| discount_templates  | `discount_templates.read`  | `discount_templates.create`  | `discount_templates.update`  | `discount_templates.delete`  |
| suppliers           | `suppliers.read`           | `suppliers.create`           | `suppliers.update`           | `suppliers.delete`           |

> Each sub-plan MUST verify the perm codes it uses exist in `PermissionCode` (`packages/supabase/src/rls/permissions.ts`) before using them in a `<PermissionGate>`. If any code is missing from the TS union, regenerate types first via `pnpm db:types` from repo root.

### Shared feature-folder layout (applies to every entity except Customers — Phase 08)

```
apps/backoffice/src/features/<entity>/
├── components/
│   ├── <Entity>FormModal.tsx       # Dialog wrapping the create/edit form
│   ├── <Entity>ListRow.tsx         # Single <tr>
│   └── <Entity>DeleteConfirm.tsx   # Soft-delete confirmation dialog
└── hooks/
    ├── use<Entity>List.ts          # Filtered list query (READ)
    ├── useCreate<Entity>.ts        # INSERT mutation
    ├── useUpdate<Entity>.ts        # UPDATE mutation (handles toggle_active too)
    └── useDelete<Entity>.ts        # Soft-delete mutation
```

And a page at `apps/backoffice/src/pages/<Entity>.tsx` that:
1. Reads `canRead/canCreate/canUpdate/canDelete` from `useAuthStore`
2. Renders a filter bar (per-entity fields — see each sub-plan)
3. Renders a table whose `<tbody>` maps over `use<Entity>List` and renders `<Entity>ListRow`
4. Mounts `<Entity>FormModal` (twice — once create-mode, once edit-mode) and `<Entity>DeleteConfirm`
5. Bails out with a permission-denied notice if `!canRead`

### TanStack Query keys

Each list hook exports a `const <ENTITY>_QUERY_KEY = ['<entity>-bo'] as const;` and invalidates that key on every mutation (`onSuccess`). See `usePromotionsList.ts:25` for the canonical example.

### Form library decision

**No `react-hook-form`.** Use plain React state + Zod inline:

```tsx
const [draft, setDraft] = useState<Draft>(initial ?? DEFAULT);
const [errors, setErrors] = useState<Record<string, string>>({});

async function handleSubmit() {
  const parsed = SCHEMA.safeParse(draft);
  if (!parsed.success) {
    setErrors(Object.fromEntries(parsed.error.issues.map(i => [i.path.join('.'), i.message])));
    return;
  }
  await mutation.mutateAsync(parsed.data);
  onClose();
}
```

### Dialog primitive

All modals use the shared shadcn `Dialog` / `DialogContent` / `DialogTitle` / `DialogDescription` / `DialogFooter` from `@breakery/ui`. See `PromotionFormModal.tsx:9-16` and `CustomerDeleteConfirm.tsx:9-17` for live imports. **Never** roll your own modal with raw divs.

### Soft-delete flow

The delete hook performs `UPDATE <table> SET deleted_at = now() WHERE id = $1`. The list hook excludes soft-deleted rows with `.is('deleted_at', null)`. Never call `.delete()` against the table from the BO.

For entities with FK relationships (categories has products, customer_categories has customers, etc.), the UI must check for dependants before enabling the delete button. The sub-plan for each such entity specifies the exact dependency check query.

### Testing strategy (per sub-plan)

Each entity sub-plan includes:
- **One Vitest smoke** at `apps/backoffice/src/__tests__/<entity>-crud.smoke.test.tsx` that boots the app under a mocked MANAGER session, navigates to the page, opens the create modal, fills the form, submits, asserts the row appears, opens edit, changes a field, asserts the row updates, opens delete confirm, confirms, asserts the row disappears.
- **One unit test** per non-trivial hook (e.g. list filters, mutation payload shape) — only when the hook does meaningful transformation beyond a raw supabase call.

The combo sub-plan additionally writes a pgTAP test against `create_combo_with_items` (atomicity + RLS).

The split-pay sub-plan (09) is **smoke-only** — no new components.

### Permission consistency check

Add a one-off test at `supabase/tests/functions/permissions-consistency.smoke.test.ts` (planned in Phase 11) that compares the `PermissionCode` TS union against `SELECT DISTINCT code FROM permissions` to catch DB/TS drift. Flagged by the spec §7 (Risques).

### Local dev / verification commands

Per sub-plan, the commit step references these:

```bash
# typecheck the whole monorepo
pnpm typecheck

# Lint
pnpm lint

# Unit + smoke tests
pnpm test

# Specific app
pnpm --filter backoffice test

# DB reset (re-applies all migrations, re-runs seed)
pnpm db:reset

# Regen TS types after a migration
pnpm db:types
```

### File-line budget

Per repo convention (CLAUDE.md): **keep files under 500 lines.** If a page hits the cap (most likely Combos due to nested item list), extract sub-components — see Phase 07 for the explicit `ComboItemPicker.tsx` split.

---

## Execution flow

For each sub-plan, the recommended dispatch pattern when using `subagent-driven-development`:

```text
Lead (you) → spawns 1 fresh subagent for the sub-plan with prompt:
  "Read docs/workplan/plans/2026-05-12-session-11-<NN>-<phase>.md and
   docs/workplan/plans/2026-05-12-session-11-INDEX.md. Execute every task
   in order. Commit after each task. When done, run pnpm typecheck + pnpm test
   (filtered to the affected packages) and report results."
```

Phases 01-08 are largely independent and can run in parallel **only after Phase 04 (categories) is done** — Phase 06 (Products) depends on the categories CRUD existing. Phases 09-11 must run last.

Two-stage review between phases:
1. Subagent reports completion → lead reads the diff (`git log --oneline <branch>..HEAD` + `git diff` of last commit per file changed).
2. Lead spawns a code-review subagent on the diff range before moving on. If review surfaces issues, fix forward (new commit, never amend).

---

## Acceptance criteria (mirrored from spec §6, deferred to Phase 11)

- [ ] `pnpm lint` 0 warning, `pnpm typecheck` 0 error
- [ ] `pnpm test` ≥ 620 tests pass (≥ 30 new tests this session)
- [ ] 8 BO pages live: products (full CRUD), categories, customers, customer-categories, restaurant-tables, combos, discount-templates, suppliers
- [ ] BO RBAC: CASHIER login → /backoffice/customers redirects (no menu entry visible). MANAGER login → menu entries visible + access granted. SUPER_ADMIN login → delete buttons visible on every list.
- [ ] BO product create: SKU + name + price + category + product_type → row appears in `/backoffice/products` AND in `/pos` after a reload of the products query
- [ ] BO combo create: header (product_type=combo) + 3 components → DB has 1 new `products` row + 3 `combo_items` rows transactionally
- [ ] Tablet split-pay smoke: pickup order → terminal → 60k cash + 40k card → checkout succeeds → DB `order_payments` has 2 rows summing to 100k, `orders.status='paid'`
- [ ] Discount template seed: create "Senior 10%" template → row visible in `/backoffice/discount-templates`; **wire-up to POS DiscountModal is out of scope** (deferred to session 11b or 15 per spec §6 note)
- [ ] Permissions consistency smoke passes (no DB/TS drift on perm codes)

---

## Status legend used in sub-plans

- `[ ]` — not done
- `[x]` — done (sub-plan task complete)
- `[~]` — partial / blocked (sub-plan reports why; phase cannot be marked complete)
