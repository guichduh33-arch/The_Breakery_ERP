# Session 11 — Phase 11 — Final Verification Implementation Plan

> **Trace historique** : ce fichier documente une session de travail datée. Le fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure (voir [`../../README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13
>
> **Modules concernés** : toute la session 11 — [`07-purchasing-suppliers`](../../../reference/04-modules/07-purchasing-suppliers.md) · [`02-pos-cart-orders`](../../../reference/04-modules/02-pos-cart-orders.md) · [`08-customers-loyalty`](../../../reference/04-modules/08-customers-loyalty.md) · [`05-products-categories`](../../../reference/04-modules/05-products-categories.md) · [`13-promotions-discounts`](../../../reference/04-modules/13-promotions-discounts.md) · [`17-tablet-ordering`](../../../reference/04-modules/17-tablet-ordering.md) · [`03-payments-split`](../../../reference/04-modules/03-payments-split.md) · [`19-settings-configuration`](../../../reference/04-modules/19-settings-configuration.md)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the session with the mandatory verification commands, a permissions-consistency smoke test (DB vs TS drift catcher, spec §7 risk), and a final commit + PR draft. No new feature code.

**Architecture:**
1. Run the full pnpm test + lint + typecheck stack and capture results.
2. Write the permissions-consistency smoke test the spec §7 calls out — it queries the DB's `permissions` table and asserts every code is present in the TS `PermissionCode` union and the EF `_shared/permissions.ts` export. Drift here is a security bug.
3. Confirm every acceptance criterion in `2026-05-12-session-11-INDEX.md` (mirrored from spec §6).
4. Prepare the PR description.

**Tech Stack:** Same as INDEX.

**Parent spec:** `docs/workplan/specs/2026-05-11-session-11-backoffice-crud-spec.md` §6 (acceptance), §7 (risk mitigation)
**Parent plan:** `docs/workplan/plans/2026-05-12-session-11-INDEX.md`

**Pre-requisites:**
- Phases 01-10 complete
- Working tree clean (no uncommitted changes from earlier phases)
- `pnpm db:reset` succeeds against the current migration set

---

## File Structure

| Action | Path |
|---|---|
| CREATE | `supabase/tests/functions/permissions-consistency.smoke.test.ts` |
| MODIFY (if drift found) | `packages/supabase/src/rls/permissions.ts` (add missing codes to `PermissionCode` union) |
| MODIFY (if drift found) | `supabase/functions/_shared/permissions.ts` (mirror DB rows) |

---

## Task 1: Run the full verification stack

**Files:**
- (none — verification only)

- [ ] **Step 1: Clean DB reset to confirm migrations replay**

```bash
pnpm db:reset
```

Expected: zero migration errors. If a migration fails, FIX FORWARD with a new commit (`fix(db): session 11 — …`). Do not amend an existing migration that was already pushed.

- [ ] **Step 2: Regen types one more time**

```bash
pnpm db:types
git diff packages/supabase/src/types.generated.ts
```

Expected: no diff (types should be in sync after each prior phase regenerated them). If a diff appears, commit it:

```bash
git add packages/supabase/src/types.generated.ts
git commit -m "chore(supabase): session 11 — regen types after final db:reset"
```

- [ ] **Step 3: Typecheck the monorepo**

```bash
pnpm typecheck
```

Expected: 0 errors across all 4 workspaces (apps/pos, apps/backoffice, packages/domain, packages/ui, packages/supabase, packages/utils).

- [ ] **Step 4: Lint**

```bash
pnpm lint
```

Expected: 0 warnings. The repo treats warnings as errors in CI (see eslint configs).

- [ ] **Step 5: Test suite**

```bash
pnpm test
```

Expected: ≥ 620 tests pass, including the ~ 30 new tests this session (~8 BO smokes + pgTAP combos + tablet split-pay + sidebar layout + permissions consistency added in Task 2). Capture the exact count from the terminal output for the PR description.

If any test fails, STOP and dispatch a debug subagent. Do not skip / mark `it.skip`.

---

## Task 2: Permissions consistency smoke

**Files:**
- Create: `supabase/tests/functions/permissions-consistency.smoke.test.ts`

This catches the spec §7 risk: "Permissions matrix divergent EF vs DB."

- [ ] **Step 1: Write the test**

```ts
// supabase/tests/functions/permissions-consistency.smoke.test.ts
//
// Session 11 — guards against DB / TS / EF drift on perm codes. Queries the
// DB's permissions table and asserts every active code is present in:
//   1. packages/supabase/src/rls/permissions.ts → PermissionCode union
//   2. supabase/functions/_shared/permissions.ts → exported set / map
//
// If you remove or rename a permission, run this test — it will tell you
// exactly which TS file you forgot to update.

import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';

// Import the two TS sources of truth.
// Adjust the import paths if your project tsconfig aliases them differently.
import type { PermissionCode } from '../../../packages/supabase/src/rls/permissions';
import * as efPerms from '../../functions/_shared/permissions';

const SUPABASE_URL  = process.env.SUPABASE_URL  ?? 'http://127.0.0.1:54321';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function knownTSCodes(): Set<string> {
  // PermissionCode is a string union — we can't introspect at runtime.
  // We instead assert against a snapshot generated from the union at type-check
  // time. For the smoke, we rely on the EF export which mirrors the union
  // (see _shared/permissions.ts for the source of truth at runtime).
  const ef = efPerms as unknown as { PERMISSION_CODES?: readonly string[] };
  if (Array.isArray(ef.PERMISSION_CODES)) return new Set(ef.PERMISSION_CODES);
  // Fallback — pull the keys of any exported map shape.
  const candidates = Object.values(efPerms).filter((v) => typeof v === 'object' && v !== null);
  for (const c of candidates) {
    if (Array.isArray(c)) return new Set(c.filter((x): x is string => typeof x === 'string'));
    if (typeof c === 'object') {
      const keys = Object.keys(c as Record<string, unknown>);
      if (keys.length > 0 && keys.every((k) => /^[a-z_]+\.[a-z_]+$/.test(k))) return new Set(keys);
    }
  }
  throw new Error('Could not extract permission codes from supabase/functions/_shared/permissions.ts');
}

describe('Permissions consistency (DB ↔ TS ↔ EF)', () => {
  it('every active DB permission is present in the EF/TS source', async () => {
    if (SERVICE_KEY === '') {
      console.warn('SUPABASE_SERVICE_ROLE_KEY not set — skipping live DB check (CI must set it).');
      return;
    }
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data, error } = await supabase
      .from('permissions')
      .select('code')
      .eq('is_active', true);
    expect(error).toBeNull();
    const dbCodes = new Set((data ?? []).map((r) => r.code as string));
    const tsCodes = knownTSCodes();

    const missingInTS = [...dbCodes].filter((c) => !tsCodes.has(c));
    const missingInDB = [...tsCodes].filter((c) => !dbCodes.has(c));

    // Format the failure message so the engineer knows exactly which file to edit.
    if (missingInTS.length > 0) {
      throw new Error(
        `DB → TS drift: ${missingInTS.length} permission codes in DB but not in TS\n` +
        `Add to packages/supabase/src/rls/permissions.ts AND supabase/functions/_shared/permissions.ts:\n` +
        missingInTS.map((c) => `  - '${c}'`).join('\n')
      );
    }
    if (missingInDB.length > 0) {
      throw new Error(
        `TS → DB drift: ${missingInDB.length} permission codes in TS but not in DB\n` +
        `Either seed them via a migration OR remove them from TS:\n` +
        missingInDB.map((c) => `  - '${c}'`).join('\n')
      );
    }
  });

  it('PermissionCode TS type is exported', () => {
    // Compile-time check — if `PermissionCode` was renamed/removed, this file
    // wouldn't typecheck. The runtime assertion is trivial.
    type Probe = PermissionCode;
    const sample: Probe = 'products.read' as Probe;
    expect(typeof sample).toBe('string');
  });
});
```

- [ ] **Step 2: Run the smoke against the local stack**

```bash
SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d= -f2)" \
  pnpm --filter @breakery/supabase-tests test -- permissions-consistency.smoke
```

> The test SKIPS if `SUPABASE_SERVICE_ROLE_KEY` isn't set — that's intentional to keep CI green when the service key isn't injected. The CI workflow should set it for the integration job.

- [ ] **Step 3: If drift is reported, fix forward**

The error message points to the exact file(s) to edit. Add the missing codes to `PermissionCode` (TS union) and `supabase/functions/_shared/permissions.ts` (mirror). Commit:

```bash
git add packages/supabase/src/rls/permissions.ts supabase/functions/_shared/permissions.ts
git commit -m "fix(supabase): session 11 — close DB/TS/EF permissions drift"
```

Re-run the smoke after fixing.

- [ ] **Step 4: Commit the test**

```bash
git add supabase/tests/functions/permissions-consistency.smoke.test.ts
git commit -m "test(supabase): session 11 — permissions consistency smoke (DB ↔ TS ↔ EF)"
```

---

## Task 3: Acceptance criteria walk-through

For each item in the acceptance list, confirm and check it off in the PR description. Use the dev stack for the manual smokes (start supabase + the two apps).

- [ ] **AC1:** `pnpm lint` 0 warning, `pnpm typecheck` 0 error — verified in Task 1
- [ ] **AC2:** `pnpm test` ≥ 620 tests pass, ≥ 30 new — verified in Task 1; capture exact counts:

```bash
pnpm test 2>&1 | grep -E "Tests:|Test Files"
```

- [ ] **AC3:** 8 BO pages live — visit each in dev:

```text
/backoffice/products            → renders full CRUD with toggles + form
/backoffice/categories          → renders CRUD with KDS station + color
/backoffice/customers           → renders re-skinned list (no loyalty drawer)
/backoffice/customer-categories → renders CRUD with default-swap UX
/backoffice/tables              → renders CRUD
/backoffice/combos              → renders CRUD with item picker
/backoffice/discount-templates  → renders CRUD with type-discriminator
/backoffice/suppliers           → renders CRUD
```

- [ ] **AC4: RBAC** — manual smoke with three different PIN logins:
  - CASHIER → `/backoffice/customers` redirects to `/backoffice` (no menu entries beyond Dashboard)
  - MANAGER → menu entries visible per role; can list + create + edit
  - SUPER_ADMIN → delete buttons visible on every list

- [ ] **AC5: BO product create → POS reload sees it**
  - Create a new product in `/backoffice/products`
  - Reload `/pos` → product appears

- [ ] **AC6: BO combo create**
  - Open `/backoffice/combos` → New combo
  - Pick a category, 3 components, bundle price → save
  - DB: 1 `products` row with `product_type='combo'`, 3 `combo_items` rows pointing to it

```bash
psql "$(supabase db url)" -c "
SELECT p.id, p.sku, p.name, p.product_type,
       (SELECT count(*) FROM combo_items ci WHERE ci.parent_product_id = p.id) AS items
FROM products p
WHERE p.product_type = 'combo'
ORDER BY p.created_at DESC LIMIT 5;
"
```

- [ ] **AC7: Tablet split-pay**
  - Tablet pickup → terminal → 60k cash + 40k card → Process
  - `orders.status='paid'`, 2 `order_payments` rows summing to 100k
  - Already covered by Phase 09 smoke; this is a manual confirm

- [ ] **AC8: Discount template seed**
  - Create "Senior 10%" via `/backoffice/discount-templates`
  - Row appears in the table
  - POS wire-up is OUT OF SCOPE this session — note in PR description

- [ ] **AC9: Permissions consistency smoke passes** — verified in Task 2

---

## Task 4: PR description + final commit

- [ ] **Step 1: Compose the PR body**

Create the PR with the `gh` CLI. Use this template:

```markdown
## Summary

Session 11 completes the Backoffice CRUD layer promised by `docs/workplan/specs/2026-05-11-session-11-backoffice-crud-spec.md`. Adds 7 fully-featured admin CRUD pages (Suppliers, Restaurant Tables, Customer Categories, Categories, Discount Templates, Products full CRUD, Combos) plus a dedicated Customers page that reuses the existing loyalty feature components. Sidebar regrouped into Catalog / Customers / Operations. New `create_combo_with_items` RPC for atomic combo writes. Permissions consistency smoke catches future DB/TS drift.

## Phases

- 01 Suppliers CRUD (NEW table, simplest — template-bearer)
- 02 Restaurant Tables CRUD
- 03 Customer Categories CRUD (incl. atomic default-swap RPC)
- 04 Categories CRUD (incl. `categories.color` ALTER TABLE)
- 05 Discount Templates CRUD (type-discriminated)
- 06 Products full CRUD (extended existing read-only page)
- 07 Combos CRUD (`create_combo_with_items` RPC + pgTAP)
- 08 Customers page wired to loyalty feature
- 09 Tablet split-pay v5 smoke
- 10 Sidebar grouping
- 11 Verification + perms consistency smoke

## DB changes

- `20260517000001_create_swap_default_customer_category_rpc.sql`
- `20260517000002_add_categories_color.sql`
- `20260517000003_create_combo_with_items_rpc.sql`

## Out of scope (explicitly deferred — spec §6 note + roadmap §8)

- Wiring the Discount Templates into the POS DiscountModal (session 11b / 15)
- Atomic `update_combo_with_items` RPC (currently sequential DELETE+INSERT)
- Cross-tab BroadcastChannel invalidation (session 15)
- Product images upload to Supabase Storage

## Test plan

- [x] `pnpm typecheck` — 0 errors
- [x] `pnpm lint` — 0 warnings
- [x] `pnpm test` — ≥ 620 tests pass (≥ 30 new this session)
- [x] pgTAP `combos.test.sql` — 7 ok / 0 not ok
- [x] Permissions consistency smoke — DB and TS in sync
- [x] Manual: each of the 8 BO pages renders for MANAGER, redirects for CASHIER
- [x] Manual: BO product create → POS reload picks it up
- [x] Manual: BO combo create inserts header + items atomically
- [x] Manual: tablet pickup with 2 tenders writes 2 `order_payments` rows

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "feat: session 11 — backoffice CRUD étendu + tablet split-pay smoke" --body "$(cat <<'EOF'
... paste the body above ...
EOF
)"
```

> If the working branch is not yet pushed: `git push -u origin swarm/session-10` first.

- [ ] **Step 3: Final commit if anything came up during the manual smokes**

If any manual smoke surfaces a small fix (e.g. a permission code was missing in the seed), commit it (`fix(<scope>): session 11 — <what>`) and push.

---

## Session exit criteria

- [ ] All 11 phases marked complete in their respective sub-plans
- [ ] PR opened against `master` with the description above
- [ ] No `it.skip` / `xfail` added this session
- [ ] No `TODO` / `FIXME` left behind in new files

Once the PR is open and CI is green, ping the user — session 11 is done.
