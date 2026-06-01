# POS Print-Bridge Deploy + Runtime Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** De-hardcode the POS print-server URL in `printService.ts` via a new `VITE_PRINT_SERVER_URL` env var (fallback `http://localhost:3001`), seed 5 dev `lan_devices` printer rows so `useStationPrinters` resolves without hardware, and hand off a concrete runbook (endpoint contract + bridge deployment + prod provisioning) for the out-of-repo print-bridge — closing the P0 finding "100% of prints fail in prod without the bridge" (DEV-S34-W0-02).

**Architecture:** Two cleanly separated tracks. The **REPO track** (mergeable, TDD) edits one constant in `printService.ts`, documents the env var, adds one POS smoke, and seeds dev printer rows via MCP `execute_sql` against V3 dev (`ikcyvlovptebroadgtvd`) — **zero schema migration**, because printer IPs are hardware/site-specific. The **EXTERNAL track** (not mergeable code) is a runbook delivered to the ops/bridge team: the frozen S34 endpoint contract, the bridge deployment procedure, and the prod `lan_devices` provisioning procedure. The editable manager UI for the print URL is explicitly out of scope — it is S35 F-009 (`usePosSettingsStore` Printing tab), which will layer a store *above* the env var introduced here.

**Tech Stack:** pnpm 9.15 + turbo monorepo; React + Vitest + React Query (`apps/pos`); Vite env vars (`import.meta.env.VITE_*`, files in `apps/pos/.env.local`, `envDir` unset); Supabase cloud V3 dev (`ikcyvlovptebroadgtvd`) via MCP `execute_sql` for the dev seed (no Docker, no migration); external Node/Express ESC/POS bridge (`localhost:3001` in dev → configurable URL in prod, source lives outside this monorepo).

**Spec:** [`../specs/2026-06-01-pos-print-bridge-deploy-spec.md`](../specs/2026-06-01-pos-print-bridge-deploy-spec.md)
**Branch:** `fix/pos-print-bridge-config` (create from `master` @ `70c5cf1`)
**Cross-ref S35 (DO NOT duplicate):** [`../specs/2026-05-29-session-35-spec.md`](../specs/2026-05-29-session-35-spec.md) §5 — F-009 Printing tab + F-015. S35 will add `usePosSettingsStore` reading the **same** key; canonical resolution order will be `store (S35) > VITE_PRINT_SERVER_URL (this plan) > 'http://localhost:3001'`.

---

## Verified code facts (checked `file:line` before planning)

- `apps/pos/src/services/print/printService.ts:4` — `const SERVER_URL = 'http://localhost:3001';` **confirmed hardcoded**. Read by 4 call-sites: `checkPrintServer` (`:97`, `${SERVER_URL}/health`), `printReceipt` (`:128`, `/print/receipt`), `openCashDrawer` (`:150`, `/drawer/open`), `printStationTicket` (`:183`, `/print/ticket`). `VITE_PRINT_SERVER_URL` does **not** appear anywhere in source today (only in spec/INDEX docs).
- Body shapes differ between the two POST helpers (verified, contract must reflect both): `printReceipt:125-127` sends `JSON.stringify({ ...payload, printer })` (printer spread last, and **omitted entirely** when `printer` is undefined); `printStationTicket:186` sends `JSON.stringify({ printer, ...payload })` (printer first, always present).
- Mock short-circuit (verified `:117` and `:175`): when `import.meta.env.VITE_PRINT_MOCK` is truthy, `printReceipt` and `printStationTicket` push to `_mockBuffer` and `return { success: true }` **before** any `fetch`. `checkPrintServer` (`:93`) and `openCashDrawer` (`:146`) do **not** check the mock flag — they always `fetch`. So a URL smoke must run in **non-mock** mode to exercise `fetch`.
- `SERVER_URL` is evaluated **once at module load** (top-level `const`). Therefore a Vitest case that wants a specific env value must `vi.stubEnv` + `vi.resetModules()` **before** dynamically `import()`-ing the module — a static top-of-file import would freeze the fallback value. (S34 smokes already use dynamic `await import(...)` for the component under test; we extend that to the service module itself.)
- `apps/pos/src/features/cart/hooks/useStationPrinters.ts:42-69` — selects `lan_devices` `device_type='printer'` + `is_active=true` + `deleted_at IS NULL`, then builds `Map<PrinterRole,{ip_address,port,name}>` keyed by `capabilities['station']`. Skips a row when `station` is not a non-empty string, OR `ip_address == null`, OR `port == null`.
- `supabase/migrations/20260517000171_init_lan_devices.sql` — columns: `code TEXT UNIQUE NOT NULL`, `name TEXT NOT NULL`, `device_type TEXT CHECK (IN ('printer','kiosk_display','kds','tablet','pos'))`, `ip_address INET` (**not** text), `port INT`, `capabilities JSONB NOT NULL DEFAULT '{}'`, `is_active BOOLEAN NOT NULL DEFAULT TRUE`, `deleted_at TIMESTAMPTZ`. INSERT/UPDATE/DELETE gated by RLS perm `lan.devices.manage`. **A seed row must supply a unique non-null `code`** or it violates `code UNIQUE NOT NULL`.
- No `apps/pos/.env*` file exists yet (verified by glob — none found). No `supabase/tests/fixtures/` directory exists. The dev seed will live as a plain SQL file under `supabase/tests/` (sibling of the existing `*.test.sql` files) and is executed via MCP, never via Docker.
- S34 smokes confirmed present under `apps/pos/src/features/{cart,payment}/__tests__/`: `fire-to-stations`, `fire-printer-unreachable`, `print-bill`, `checkout-autofire`, `receipt-targets-cashier`. They run under `vi.stubEnv('VITE_PRINT_MOCK','1')` with `vi.unstubAllEnvs()` in `afterEach` (hygiene from S34 W4 commit `f525bca`).
- Existing ref doc `docs/reference/05-integrations/06-print-server.md` documents the **V2-era** endpoints (`/print/kitchen`, `/print/barista`, …). The S34/V3 station-routing contract (`/print/ticket` + `kind` + `role` in body) is **different** — the runbook section appends the V3 contract, it does **not** rewrite the V2 history.

---

## File Structure

### Created
| Path | Responsibility |
|---|---|
| `apps/pos/.env.example` | Document POS Vite env vars including the new `VITE_PRINT_SERVER_URL`. Committed (no secrets). |
| `apps/pos/src/services/print/__tests__/print-server-url-config.smoke.test.tsx` | Prove `printStationTicket`/`printReceipt` POST to the URL from `VITE_PRINT_SERVER_URL`, falling back to `localhost:3001` when unset. |
| `supabase/tests/seed_dev_printers.sql` | Dev-only fixture: 5 `lan_devices` printer rows (one per station role) with fake LAN IPs. Run via MCP `execute_sql`; **never** applied in prod. |
| `docs/workplan/plans/2026-06-01-pos-print-bridge-deploy-INDEX.md` | Closeout INDEX (created in Wave 4). |

### Modified
| Path | Change |
|---|---|
| `apps/pos/src/services/print/printService.ts:4` | Replace the frozen `const SERVER_URL = 'http://localhost:3001'` with `import.meta.env.VITE_PRINT_SERVER_URL ?? 'http://localhost:3001'` + a comment naming the S35 resolution order. Single read point; the 4 call-sites are unchanged. |
| `docs/reference/05-integrations/06-print-server.md` | Append a "V3 station-routing contract (S34)" section: `/print/ticket` (kind+role), `/print/receipt`, `/drawer/open`, `/health`, plus body shapes, return codes, timeouts, bridge deployment runbook, and prod `lan_devices` provisioning. (External/ops deliverable — Wave 3.) |
| `CLAUDE.md` | Bump §Active Workplan: env var introduced, dev seed applied, contract delivered, DEV-S34-W0-02 updated. (Wave 4.) |

> **Layout note (CLAUDE.md "NEVER create files unless absolutely necessary"):** the contract/runbook is **appended to the existing** `docs/reference/05-integrations/06-print-server.md` — no new ref page. The dev seed is a plain `.sql` under `supabase/tests/` (no `fixtures/` subdir is created since none exists). `apps/pos/.env.example` is the one genuinely new file (no POS env example exists today; CLAUDE.md secrets rule forbids committing the real `.env.local`).

---

## Task 1: Branch + baseline confirmation

**Files:** none changed (branch + read-only verification)

- [ ] **Step 1.1: Create the branch from the pinned base**

```bash
git checkout master
git pull --ff-only
git checkout -b fix/pos-print-bridge-config
git log -1 --oneline
```

Expected: HEAD resolves at or after `70c5cf1` and the new branch is checked out.

- [ ] **Step 1.2: Confirm the hardcoded constant and its 4 call-sites still match the plan**

```bash
git grep -n "SERVER_URL" apps/pos/src/services/print/printService.ts
```

Expected output (5 lines): the `const SERVER_URL = 'http://localhost:3001';` definition at line 4, and `${SERVER_URL}` in `checkPrintServer` (`/health`), `printReceipt` (`/print/receipt`), `openCashDrawer` (`/drawer/open`), `printStationTicket` (`/print/ticket`). If the line numbers drifted, re-read the file and adjust the Task 2 edit anchor — do not proceed with a stale anchor.

- [ ] **Step 1.3: Confirm `VITE_PRINT_SERVER_URL` does not yet exist in source**

```bash
git grep -n "VITE_PRINT_SERVER_URL" apps/pos packages
```

Expected: **no matches** in `apps/` or `packages/` (it currently appears only in `docs/`). This confirms we are introducing it, not colliding with an existing reader.

- [ ] **Step 1.4: Commit the spec + this plan**

```bash
git add docs/workplan/specs/2026-06-01-pos-print-bridge-deploy-spec.md docs/workplan/plans/2026-06-01-pos-print-bridge-deploy-plan.md
git commit -m "docs(workplan): pos print-bridge deploy + runtime config — spec + plan"
```

Expected: one commit recorded on `fix/pos-print-bridge-config`.

---

## Task 2: De-hardcode the print-server URL (REPO, TDD)

**Files:**
- Modify: `apps/pos/src/services/print/printService.ts:4`
- Test: `apps/pos/src/services/print/__tests__/print-server-url-config.smoke.test.tsx` (create)

- [ ] **Step 2.1: Write the failing smoke test**

Create `apps/pos/src/services/print/__tests__/print-server-url-config.smoke.test.tsx` with exactly this content. The test stubs the env var, stubs `VITE_PRINT_MOCK` off, `vi.resetModules()` so the top-level `const SERVER_URL` re-evaluates, dynamically imports the service, and asserts the URL passed to a mocked `fetch`.

```tsx
// apps/pos/src/services/print/__tests__/print-server-url-config.smoke.test.tsx
//
// fix/pos-print-bridge-config — printService reads VITE_PRINT_SERVER_URL.
//
// printService.ts reads `const SERVER_URL = import.meta.env.VITE_PRINT_SERVER_URL
// ?? 'http://localhost:3001'` ONCE at module load. So each case must:
//   1. vi.stubEnv(...) the desired value (and turn VITE_PRINT_MOCK off — the
//      mock branch short-circuits before fetch),
//   2. vi.resetModules() so the const re-evaluates,
//   3. dynamically import the module,
//   4. inspect the URL passed to a mocked global fetch.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = globalThis.fetch;

function mockFetchOk() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({}),
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const PRINTER = { ip_address: '192.168.1.10', port: 9100 };

const STATION_PAYLOAD = {
  kind: 'prep' as const,
  role: 'kitchen' as const,
  order_number: 'ORD-1',
  created_at: '2026-06-01T00:00:00.000Z',
  server_name: 'Tester',
  items: [{ name: 'Omelette', quantity: 1 }],
};

const RECEIPT_PAYLOAD = {
  business: { name: 'The Breakery', address: 'Bali' },
  order: {
    order_number: 'ORD-1',
    created_at: '2026-06-01T00:00:00.000Z',
    cashier_name: 'Tester',
    order_type: 'dine_in' as const,
  },
  items: [{ name: 'Espresso', quantity: 1, unit_price: 25_000, line_total: 25_000 }],
  totals: { items_total: 25_000, redemption_amount: 0, total: 25_000, tax_amount: 0 },
  payment: { method: 'cash' as const, amount: 25_000, cash_received: 30_000, change_given: 5_000 },
};

describe('printService — VITE_PRINT_SERVER_URL', () => {
  beforeEach(() => {
    // Ensure the mock branch is OFF so fetch is actually exercised.
    vi.stubEnv('VITE_PRINT_MOCK', '');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('printStationTicket POSTs to the configured VITE_PRINT_SERVER_URL', async () => {
    vi.stubEnv('VITE_PRINT_SERVER_URL', 'http://10.0.0.9:4000');
    vi.resetModules();
    const fetchMock = mockFetchOk();

    const { printStationTicket } = await import('../printService');
    await printStationTicket(PRINTER, STATION_PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://10.0.0.9:4000/print/ticket');
  });

  it('printReceipt POSTs to the configured VITE_PRINT_SERVER_URL', async () => {
    vi.stubEnv('VITE_PRINT_SERVER_URL', 'http://10.0.0.9:4000');
    vi.resetModules();
    const fetchMock = mockFetchOk();

    const { printReceipt } = await import('../printService');
    await printReceipt(RECEIPT_PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://10.0.0.9:4000/print/receipt');
  });

  it('falls back to http://localhost:3001 when VITE_PRINT_SERVER_URL is unset', async () => {
    // No stubEnv for VITE_PRINT_SERVER_URL → undefined → fallback.
    vi.resetModules();
    const fetchMock = mockFetchOk();

    const { printStationTicket } = await import('../printService');
    await printStationTicket(PRINTER, STATION_PAYLOAD);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('http://localhost:3001/print/ticket');
  });
});
```

- [ ] **Step 2.2: Run the test to verify it fails for the right reason**

```bash
pnpm --filter @breakery/app-pos test print-server-url-config
```

Expected: the first two cases FAIL. The configured-URL assertions expect `http://10.0.0.9:4000/...` but the un-edited module still posts to `http://localhost:3001/...`. The third (fallback) case may already PASS. This confirms the test exercises the real code path before the fix.

- [ ] **Step 2.3: Apply the one-line de-hardcode in `printService.ts`**

Replace the single line at `apps/pos/src/services/print/printService.ts:4`.

Old:
```ts
const SERVER_URL = 'http://localhost:3001';
```

New:
```ts
// Print-bridge base URL. Resolution order once S35 lands its Printing tab:
//   usePosSettingsStore (S35 F-009) > VITE_PRINT_SERVER_URL (this fix) > fallback.
// This fix introduces ONLY the env var; the editable store is S35 F-009/F-015.
// Read once at module load — tests must vi.resetModules() after stubbing the env.
const SERVER_URL = import.meta.env.VITE_PRINT_SERVER_URL ?? 'http://localhost:3001';
```

Do **not** touch the 4 call-sites — they already interpolate `${SERVER_URL}`. Do **not** add a store or any S35 logic here.

- [ ] **Step 2.4: Run the test to verify it passes**

```bash
pnpm --filter @breakery/app-pos test print-server-url-config
```

Expected: PASS — all 3 cases green (configured URL for ticket + receipt, fallback when unset).

- [ ] **Step 2.5: Typecheck the POS package**

```bash
pnpm --filter @breakery/app-pos typecheck
```

Expected: PASS, no new errors. (`import.meta.env.VITE_PRINT_SERVER_URL` is `string | undefined` in Vite's ImportMetaEnv; `?? 'http://localhost:3001'` narrows to `string`, matching every `${SERVER_URL}` template usage.)

- [ ] **Step 2.6: Commit**

```bash
git add apps/pos/src/services/print/printService.ts apps/pos/src/services/print/__tests__/print-server-url-config.smoke.test.tsx
git commit -m "fix(pos): de-hardcode print server URL via VITE_PRINT_SERVER_URL + smoke"
```

Expected: one commit; both the edit and the new smoke recorded.

---

## Task 3: Document the env var (`apps/pos/.env.example`)

**Files:**
- Create: `apps/pos/.env.example`

- [ ] **Step 3.1: Create the POS env example**

No `apps/pos/.env*` file exists today. Create `apps/pos/.env.example` (committed; it is documentation, contains **no** secrets). Real values go in `apps/pos/.env.local` (git-ignored, never committed — CLAUDE.md secrets rule + memory `project_local_dev_env_files`: `envDir` is unset so the file must live inside `apps/pos`).

```dotenv
# apps/pos/.env.example — copy to apps/pos/.env.local and fill real values.
# NEVER commit .env.local (contains real Supabase keys).

# Supabase (V3 dev project ikcyvlovptebroadgtvd)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Print bridge base URL.
# - CI / tests: leave unset and set VITE_PRINT_MOCK=1 (network is mocked).
# - Dev: http://localhost:3001 (default fallback if this var is unset).
# - Prod: the LAN address of the print-bridge on the counter PC, e.g.
#     VITE_PRINT_SERVER_URL=http://192.168.1.50:3001
# Resolution order once S35 ships its Printing tab:
#   usePosSettingsStore (S35) > VITE_PRINT_SERVER_URL > http://localhost:3001
VITE_PRINT_SERVER_URL=

# Print mock — set to 1 in CI/tests to buffer prints instead of hitting the network.
VITE_PRINT_MOCK=
```

- [ ] **Step 3.2: Confirm no real `.env.local` is staged**

```bash
git status --porcelain apps/pos
```

Expected: only `apps/pos/.env.example` shows as a new file (`??` or `A`). If `apps/pos/.env.local` appears, **do not** add it — it is git-ignored and must stay local.

- [ ] **Step 3.3: Commit**

```bash
git add apps/pos/.env.example
git commit -m "docs(pos): document VITE_PRINT_SERVER_URL in .env.example"
```

Expected: one commit; only `.env.example` recorded.

---

## Task 4: Seed dev `lan_devices` printers (REPO fixture, no migration)

**Files:**
- Create: `supabase/tests/seed_dev_printers.sql`

> No schema migration: printer IPs are hardware/site-specific (spec §C, risk 4). This is a **dev fixture** run via MCP against V3 dev; prod provisioning is the ops runbook in Task 6.

- [ ] **Step 4.1: Write the dev seed SQL**

Create `supabase/tests/seed_dev_printers.sql`. Five rows, one per station role. `code` is unique+non-null (else `code UNIQUE NOT NULL` violation). `ip_address` is `INET` so values are valid IP literals. `port=9100` (ESC/POS raw). `ON CONFLICT (code) DO NOTHING` makes re-runs idempotent.

```sql
-- supabase/tests/seed_dev_printers.sql
-- DEV FIXTURE ONLY — run via MCP execute_sql against V3 dev (ikcyvlovptebroadgtvd).
-- NOT a migration, NOT for prod (prod IPs are site-specific — see ops runbook in
-- docs/reference/05-integrations/06-print-server.md).
-- Seeds 5 lan_devices printer rows so useStationPrinters resolves a 5-entry Map
-- without physical hardware. ip_address is INET (valid IP literals required).

INSERT INTO lan_devices (code, name, device_type, ip_address, port, is_active, capabilities)
VALUES
  ('DEV-PRINTER-BARISTA', 'Barista printer (dev)', 'printer', '192.168.99.11'::inet, 9100, TRUE, jsonb_build_object('station', 'barista')),
  ('DEV-PRINTER-KITCHEN', 'Kitchen printer (dev)', 'printer', '192.168.99.12'::inet, 9100, TRUE, jsonb_build_object('station', 'kitchen')),
  ('DEV-PRINTER-BAKERY',  'Bakery printer (dev)',  'printer', '192.168.99.13'::inet, 9100, TRUE, jsonb_build_object('station', 'bakery')),
  ('DEV-PRINTER-CASHIER', 'Cashier printer (dev)', 'printer', '192.168.99.14'::inet, 9100, TRUE, jsonb_build_object('station', 'cashier')),
  ('DEV-PRINTER-WAITER',  'Waiter printer (dev)',  'printer', '192.168.99.15'::inet, 9100, TRUE, jsonb_build_object('station', 'waiter'))
ON CONFLICT (code) DO NOTHING;
```

- [ ] **Step 4.2: Apply the seed to V3 dev via MCP**

Run the file contents through MCP `mcp__plugin_supabase_supabase__execute_sql` with `project_id='ikcyvlovptebroadgtvd'`. (MCP runs as `postgres`/service-role → bypasses the `lan.devices.manage` RLS gate, which is correct for a dev seed; prod inserts must go through a `lan.devices.manage`-holding account per the ops runbook.)

Expected: success, `INSERT 0 5` on a clean DB (or `INSERT 0 0` if already seeded — `ON CONFLICT DO NOTHING` is idempotent). **Do NOT** run `pnpm db:reset` / `supabase start` — Docker is retired.

- [ ] **Step 4.3: Verify resolution would produce a 5-entry Map (sanity SQL via MCP)**

Run via MCP `execute_sql` (`project_id='ikcyvlovptebroadgtvd'`):

```sql
SELECT name,
       ip_address,
       port,
       capabilities ->> 'station' AS station
FROM lan_devices
WHERE device_type = 'printer'
  AND is_active
  AND deleted_at IS NULL
  AND capabilities ->> 'station' IN ('barista', 'kitchen', 'bakery', 'cashier', 'waiter')
ORDER BY station;
```

Expected: exactly **5 rows** (bakery, barista, cashier, kitchen, waiter), every row with non-null `ip_address` and `port`. This is the exact filter `useStationPrinters` applies, so a 5-row result proves the hook would build a 5-entry `Map<PrinterRole, …>`.

- [ ] **Step 4.4: Commit the fixture**

```bash
git add supabase/tests/seed_dev_printers.sql
git commit -m "test(pos): dev fixture — seed 5 lan_devices printers (no migration)"
```

Expected: one commit; only the seed SQL recorded.

---

## Task 5 (EXTERNAL — runbook, not TDD): print-bridge endpoint contract

> **Hors-repo / ops deliverable.** Documentation only — no application code. The bridge source lives outside this monorepo; this section is the contract handed to the ops/bridge team. Appended to the existing ref doc — no new file. The contract is the **frozen S34 contract** read from the current `printService.ts`, not a redesign.

**Files:**
- Modify: `docs/reference/05-integrations/06-print-server.md` (append a new section)

- [ ] **Step 5.1: Append the V3 station-routing contract section**

Append the following section to the **end** of `docs/reference/05-integrations/06-print-server.md` (do not edit the existing V2 sections — they are history). The endpoints, body shapes, timeouts, and return-code handling below are transcribed verbatim from `printService.ts` (`/health` `:97`, `/print/receipt` `:128` body `{ ...payload, printer }`, `/drawer/open` `:150`, `/print/ticket` `:183` body `{ printer, ...payload }`; non-`res.ok` → `{ success:false, error:'HTTP <status>' }`; timeouts: 2s health/drawer, 5s ticket/receipt).

````markdown
## V3 station-routing contract (Session 34 — current code)

> **Last verified**: 2026-06-01 against `apps/pos/src/services/print/printService.ts`.

S34 replaced the V2 per-printer endpoints (`/print/kitchen`, `/print/barista`, …)
with a single station-routing endpoint. The bridge receives the target printer in
the request body and opens an ESC/POS connection to `printer.ip_address:printer.port`.

### Base URL
The POS reads the base URL from `VITE_PRINT_SERVER_URL` (fallback `http://localhost:3001`).
In prod, set it to the bridge's LAN address on the counter PC (e.g. `http://192.168.1.50:3001`).
S35 (F-009) will add a manager-editable override stored in `usePosSettingsStore`
(resolution: store > env var > fallback).

### Endpoints

| Method | Endpoint | Caller | Timeout | Body |
|--------|----------|--------|---------|------|
| GET  | `/health`         | `checkPrintServer`   | 2 s | — |
| POST | `/print/ticket`   | `printStationTicket` | 5 s | `{ printer, ...StationTicketPayload }` |
| POST | `/print/receipt`  | `printReceipt`       | 5 s | `{ ...ReceiptPayload, printer? }` (printer field omitted when absent) |
| POST | `/drawer/open`    | `openCashDrawer`     | 2 s | — |

`Content-Type: application/json` on the two POST-with-body endpoints. The bridge MUST
return a 2xx on success; any non-2xx makes the client return `{ success:false, error:'HTTP <status>' }`.
A network error / abort makes the client return `{ success:false, error:<message> }`.

### `/print/ticket` body — `{ printer, ...StationTicketPayload }`

`printer` is first in the object; the payload fields are spread after it:

- `printer`: `{ ip_address: string, port: number }` — the target station printer.
- `kind`: `'prep' | 'bill' | 'receipt'` (`PrintKind`).
- `role`: one of `'barista' | 'kitchen' | 'bakery' | 'cashier' | 'waiter'` (`PrinterRole`).
- `order_number`: string.
- `table_number?`: string.
- `created_at`: ISO string.
- `server_name`: string.
- `items[]`: `{ name: string, quantity: number, modifiers?: string[], note?: string }`.
- `totals?`: `{ subtotal, tax, total }` (present for `bill` and `receipt`).
- `payment?`: `{ method, amount, change_given }` (present for `receipt` only).

### `/print/receipt` body — `{ ...ReceiptPayload, printer? }`

`printer` is spread **last** and is **omitted** when the POS has no cashier printer to route to:

- `business`: `{ name, address, phone?, tax_id? }`.
- `order`: `{ order_number, created_at, cashier_name, order_type: 'dine_in'|'take_out' }`.
- `customer?`: `{ name, loyalty_tier? }`.
- `items[]`: `{ name, quantity, unit_price, modifiers?: { label, price_adjustment }[], line_total }`.
- `totals`: `{ items_total, redemption_amount, total, tax_amount }`.
- `payment`: `{ method: 'cash', amount, cash_received, change_given }`.
- `loyalty?`: `{ points_earned, balance_after }`.
- `footer?`: string.
- `printer?`: `{ ip_address, port }` when a cashier printer is resolved.

### `/drawer/open` and `/health`
`/drawer/open` takes no body (POST), pulses the cash drawer, returns 2xx on success.
`/health` is a GET liveness probe used by `checkPrintServer` (2 s timeout, returns `res.ok`).
````

- [ ] **Step 5.2: Commit the contract**

```bash
git add docs/reference/05-integrations/06-print-server.md
git commit -m "docs(print): document V3 station-routing bridge contract (S34)"
```

Expected: one commit; only the ref doc recorded.

---

## Task 6 (EXTERNAL — runbook, not TDD): bridge deployment + prod `lan_devices` provisioning

> **Hors-repo / ops deliverable.** No application code. Appended to the same ref doc. Concrete commands and verification criteria — no placeholders.

**Files:**
- Modify: `docs/reference/05-integrations/06-print-server.md` (append a runbook section)

- [ ] **Step 6.1: Append the deployment + provisioning runbook**

Append the following to the **end** of `docs/reference/05-integrations/06-print-server.md` (after the contract section from Task 5).

````markdown
## Bridge deployment runbook (ops — counter PC)

> The bridge source is **outside this monorepo**. This runbook deploys the
> compiled bridge on the counter PC and verifies it against the contract above.

### Prerequisites
- Counter PC on the same LAN as the thermal printers (barista/kitchen/bakery prep
  + cashier/waiter document) — each printer reachable at `ip:9100` (ESC/POS raw).
- Node 18+ on the counter PC.
- A fixed LAN IP for the counter PC (e.g. `192.168.1.50`) so the POS env var is stable.

### Deploy
1. Copy the bridge build to the counter PC (e.g. `C:\breakery-print-bridge\`).
2. Configure the listen port (default `3001`).
3. Start it as a supervised service so it restarts on boot/crash:
   - Windows: register via NSSM or a Scheduled Task at logon.
   - Linux: a `systemd` unit with `Restart=always`.

### Verify (run from the counter PC, then from a POS tablet on the LAN)
```bash
# Liveness — expect HTTP 200.
curl -i http://192.168.1.50:3001/health

# Station ticket — expect 2xx and a physical ticket on the kitchen printer.
curl -i -X POST http://192.168.1.50:3001/print/ticket \
  -H 'Content-Type: application/json' \
  -d '{"printer":{"ip_address":"192.168.1.12","port":9100},"kind":"prep","role":"kitchen","order_number":"TEST-1","created_at":"2026-06-01T00:00:00Z","server_name":"ops","items":[{"name":"Test item","quantity":1}]}'

# Drawer kick — expect 2xx and the cashier drawer opens.
curl -i -X POST http://192.168.1.50:3001/drawer/open
```
Acceptance: `/health` returns 200; `/print/ticket` prints on the addressed printer;
`/drawer/open` pulses the drawer.

### Wire the POS
Set `VITE_PRINT_SERVER_URL=http://192.168.1.50:3001` in `apps/pos/.env.local` on each
tablet (or via S35's Printing tab once shipped) and rebuild/reload the POS.

## Prod `lan_devices` provisioning (ops — per site)

> The dev fixture (`supabase/tests/seed_dev_printers.sql`) is for dev only.
> Prod rows carry the site's **real** printer IPs and must be inserted by an
> account holding `lan.devices.manage` (RLS gate).

For each of the 5 station roles, insert one `lan_devices` row:

| `code` (unique) | `name` | `device_type` | `capabilities` | `ip_address` / `port` |
|---|---|---|---|---|
| e.g. `LBK-PRINTER-BARISTA` | Barista printer | `printer` | `{"station":"barista"}` | real LAN IP / 9100 |
| e.g. `LBK-PRINTER-KITCHEN` | Kitchen printer | `printer` | `{"station":"kitchen"}` | real LAN IP / 9100 |
| e.g. `LBK-PRINTER-BAKERY`  | Bakery printer  | `printer` | `{"station":"bakery"}`  | real LAN IP / 9100 |
| e.g. `LBK-PRINTER-CASHIER` | Cashier printer | `printer` | `{"station":"cashier"}` | real LAN IP / 9100 |
| e.g. `LBK-PRINTER-WAITER`  | Waiter printer  | `printer` | `{"station":"waiter"}`  | real LAN IP / 9100 |

Rules:
- `code` must be unique and non-null (`code UNIQUE NOT NULL`).
- `ip_address` is `INET` — a valid IP literal, not a hostname string.
- `is_active = TRUE`, `deleted_at` NULL.
- A missing role is non-fatal: `useStationPrinters` simply won't resolve it and the
  S34 flow shows "no printer configured for [station]" (no crash).

A BO "Devices" management UI is the intended long-term entry point (out of scope here;
tracked as a separate backlog item).
````

- [ ] **Step 6.2: Open/assign the external dependency tracking**

This is the bridge deployment + hardware repro, which cannot be done in this PR. Record it as the carry-over P0-operational dependency in the Wave-7 INDEX §"External dependency" and assign an ops owner there (see Task 7.5). No code change in this step — it is the cross-reference that keeps DEV-S34-W0-02 open until hardware is provisioned.

- [ ] **Step 6.3: Commit the runbook**

```bash
git add docs/reference/05-integrations/06-print-server.md
git commit -m "docs(print): bridge deployment + prod lan_devices provisioning runbook"
```

Expected: one commit; only the ref doc recorded.

---

## Task 7: Non-regression, typecheck, INDEX, CLAUDE.md, PR (closeout)

**Files:**
- Create: `docs/workplan/plans/2026-06-01-pos-print-bridge-deploy-INDEX.md`
- Modify: `CLAUDE.md`

- [ ] **Step 7.1: Run the new URL smoke + all 5 S34 print smokes (no regression)**

```bash
pnpm --filter @breakery/app-pos test print-server-url-config fire-to-stations fire-printer-unreachable checkout-autofire print-bill receipt-targets-cashier
```

Expected: all 6 files PASS. Specifically the 5 S34 smokes stay at 7/7 under `VITE_PRINT_MOCK=1`. The new file must not leak env state — confirm it does `vi.unstubAllEnvs()` + restores `fetch` + `vi.resetModules()` in `afterEach` (Step 2.1). If any S34 smoke flips red, the new smoke polluted the mock flag — fix the `afterEach` before proceeding.

- [ ] **Step 7.2: POS typecheck + full sweep**

```bash
pnpm --filter @breakery/app-pos typecheck
pnpm typecheck
```

Expected: `@breakery/app-pos` PASS. Full sweep PASS **except** the pre-existing `@breakery/ui` env-gated failure documented on `master` (not a regression — this plan touched zero `@breakery/ui` files). If any package other than the known baseline fails, investigate before merge.

- [ ] **Step 7.3: Write the INDEX**

Create `docs/workplan/plans/2026-06-01-pos-print-bridge-deploy-INDEX.md` with these sections (project INDEX format): **Summary** (env var introduced; dev seed applied; bridge contract + deployment + provisioning runbook delivered; bridge hardware deploy remains P0-operational, deferred); **Migrations applied** (table — **none**, data-only dev fixture, no schema change); **New files** (`apps/pos/.env.example`, `print-server-url-config.smoke.test.tsx`, `supabase/tests/seed_dev_printers.sql`); **Files modified** (`printService.ts` de-hardcode; `06-print-server.md` V3 contract + runbook; `CLAUDE.md` bump); **Tests run** (table — `print-server-url-config` 3 PASS; 5 S34 smokes 7/7 PASS; `app-pos typecheck` PASS); **Permissions seeded** (none); **RPCs added/bumped** (none); **Deferred** (bridge hardware deploy + prod provisioning = external; S35 F-009 editable UI); **Deviations** (table, see candidates below); **Acceptance criteria** (mirror spec §3 with the deferred physical-repro item marked).

- [ ] **Step 7.4: Bump `CLAUDE.md` §Active Workplan**

Add a "Current chantier" note under §Active Workplan: `fix/pos-print-bridge-config` — `printService.ts` de-hardcoded via `VITE_PRINT_SERVER_URL` (partial F-015), dev seed of 5 `lan_devices` printers applied to V3 dev, V3 station-routing bridge contract + deployment + prod-provisioning runbook documented in `docs/reference/05-integrations/06-print-server.md`. **Migration sequence: NONE** (data-only dev fixture; no schema/prod migration). Update DEV-S34-W0-02: URL de-hardcoded + contract delivered; physical bridge deployment remains a P0-operational ops dependency, deferred. Explicit cross-ref: editable URL UI stays **S35 F-009/F-015 — do not re-spec**.

- [ ] **Step 7.5: Commit closeout docs**

```bash
git add docs/workplan/plans/2026-06-01-pos-print-bridge-deploy-INDEX.md CLAUDE.md
git commit -m "docs(workplan): pos print-bridge — INDEX + CLAUDE.md bump"
```

Expected: one commit.

- [ ] **Step 7.6: Open the PR**

```bash
gh pr create --base master --head fix/pos-print-bridge-config \
  --title "fix(pos): de-hardcode print server URL via VITE_PRINT_SERVER_URL + bridge deploy contract" \
  --body "De-hardcodes the POS print server URL (VITE_PRINT_SERVER_URL, fallback localhost:3001), adds a config smoke, seeds 5 dev lan_devices printers (no migration), and documents the V3 station-routing bridge contract + deployment + prod provisioning runbook. The external bridge hardware deployment remains a P0-operational ops dependency NOT resolved by this PR (DEV-S34-W0-02). Editable URL UI is out of scope — S35 F-009.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: PR opened. Squash-merge after review.

---

## Acceptance criteria (mirror spec §3)

- [ ] `printService.ts` reads the bridge URL via `VITE_PRINT_SERVER_URL` (fallback `localhost:3001`) — no frozen constant. *(Task 2)*
- [ ] Resolution order documented and compatible with S35 F-009 store (store > env > fallback). *(Task 2.3 comment + Task 7.4)*
- [ ] Bridge endpoint contract documented (`/print/ticket`, `/print/receipt`, `/drawer/open`, `/health`) and handed to the bridge team. *(Task 5)*
- [ ] 5-printer `lan_devices` registration procedure documented (ops) + dev seed fixture. *(Task 4, Task 6.1)*
- [ ] Real repro (mixed order → 3 prep tickets + cashier receipt) — **deferred**, checklist in INDEX, depends on the deployed bridge. *(Task 6 runbook + Task 7.3 INDEX)*
- [ ] `pnpm --filter @breakery/app-pos typecheck` PASS. *(Task 7.2)*

---

## Critical patterns to respect (CLAUDE.md)

- **DB cloud V3 via MCP** — dev seed via `mcp__plugin_supabase_supabase__execute_sql` only; **no** `supabase start` / `db reset` / Docker; **no** migration in this plan.
- **No committed secrets** — only `apps/pos/.env.example`; never commit a real `.env.local`.
- **`ip_address` is `INET`** — seed/provisioning use valid IP literals, not hostnames.
- **RLS `lan.devices.manage`** — prod inserts go through a gated account; the dev MCP seed bypasses RLS as service-role (dev only).
- **Mock-first** — `VITE_PRINT_MOCK` short-circuits `printReceipt`/`printStationTicket` before `fetch`; the URL smoke runs in non-mock mode and cleans up env in `afterEach` (S34 `f525bca` hygiene).
- **Module-load const** — `SERVER_URL` is read once; tests `vi.resetModules()` after `vi.stubEnv`.
- **Do not duplicate S35 F-009** — env var only here; the editable store/UI is S35.

---

## Dependencies & risks (mirror spec §6)

1. **External blocking dependency (P0-operational)** — without a reachable, deployed multi-printer bridge at the configured URL, no real printing. De-hardcoding alone is insufficient. *(Task 6 runbook + Task 6.2 tracking)*
2. **Prod `lan_devices` provisioning** — without rows, `useStationPrinters` returns empty → "no printer configured" toast. *(Task 6.1)*
3. **S35 F-009 overlap** — risk of double-implementing the URL config. Mitigation: env var only here; the editable UI is S35 reading the same key (store > env > fallback). *(Task 2.3, Task 7.4)*
4. **Per-site variable printer IPs** — no prod migration possible; config per deployment. *(Task 4 = dev fixture only)*

### Inter-spec dependencies
- **`pos-refund-test-investigation`** (the other 2026-06-01 P0): **no direct functional dependency** — disjoint scope (printing vs order-history refund), parallelizable. Only link: both require a clean `pnpm --filter @breakery/app-pos test` before merge; the non-regression in Task 7.1 must stay green.
- **S35 (`2026-05-29-session-35-spec.md` §5, F-009/F-015)**: this plan is the **precursor** of the S35 Printing tab. S35 adds `usePosSettingsStore` above the env var (same key, store wins). **Do not re-spec.**

---

## Deviations log (fill during execution)

| ID | Section | Original | What happened | Reason | Risk |
|---|---|---|---|---|---|
| _(to fill)_ | | | | | |

Anticipated candidates:
- **DEV-PB-T6-01** (informational) — physical bridge deploy + prod `lan_devices` provisioning are external/non-mergeable; physical repro deferred (S34-FOLLOWUP, DEV-S34-W0-02 stays open).
- **DEV-PB-T4-01** (informational) — `lan_devices` dev seed uses fake `192.168.99.x` IPs; prod provisioning is per-site ops, no migration.
- **DEV-PB-T2-01** (informational, possible) — env var only (no store) by design; editable UI deferred to S35 F-009.

---

## Self-Review (run against the spec — completed)

**1. Spec coverage** — every spec section maps to a task:
- Spec §1 (proof of breakage) → Task 1.2–1.3 confirm the hardcoded constant + 4 call-sites.
- Spec §2.A (de-hardcode URL) → Task 2 (TDD edit `printService.ts:4` + smoke). Resolution order with S35 → Task 2.3 comment + Task 7.4.
- Spec §2.B (bridge external) → Task 5 (contract) + Task 6 (deployment runbook), clearly marked external.
- Spec §2.C (`lan_devices`) → Task 4 (dev seed) + Task 6.1 (prod provisioning runbook).
- Spec §3 acceptance → mirrored 1:1 in the Acceptance criteria section.
- Spec §4 tests → Task 2.1 (URL smoke) + Task 7.1 (5 S34 non-regression) + Task 6.1 (deferred physical repro checklist in runbook + INDEX).
- Spec §5 out-of-scope → Non-Goal in header + Task 5/6 "external" framing + S35 cross-refs (no UI/store/BO Devices/auto-discovery here).
- Spec §6 risks → mirrored in Dependencies & risks. **No gaps found.**

**2. Placeholder scan** — searched for TBD / TODO / "add error handling" / "implement later" / "similar to Task N" / undefined types. Every code step shows complete code; every command step shows the exact command + expected output; the runbook uses concrete `curl` commands and a concrete IP table (no "fill in IP" prose beyond the deliberately site-specific prod cells, which are correctly marked "real LAN IP" because they are intrinsically per-site and not knowable at plan time). **No actionable placeholder remains.**

**3. Type consistency** — verified against `printService.ts`: `printStationTicket(printer: PrinterTarget, payload: StationTicketPayload)` and `printReceipt(payload: ReceiptPayload, printer?: PrinterTarget)` signatures match the smoke test's call sites; `PrintKind` (`'prep'|'bill'|'receipt'`) and `PrinterRole` (`'barista'|'kitchen'|'bakery'|'cashier'|'waiter'`) used consistently in the test payloads and the contract; `SERVER_URL` is the single read point named identically in Task 2 and the contract; `lan_devices` columns (`code`, `name`, `device_type`, `ip_address INET`, `port`, `is_active`, `capabilities`) match the seed, the sanity query, and the provisioning table; `capabilities->>'station'` filter matches `useStationPrinters`. **No naming/shape drift found.**

---

## Execution Handoff

Plan complete and saved to `docs/workplan/plans/2026-06-01-pos-print-bridge-deploy-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task with two-stage review between tasks. Recommended here: Tasks 2 and 4 are independent (URL edit vs DB seed) and can run in parallel; Tasks 5–6 (external runbook) need no DB/CI and can run alongside; Task 7 closeout is sequential after 2 + 4. Suggested agents: `pos-specialist` (Task 2), `db-engineer` (Task 4), a technical-writer-style general agent (Tasks 5–6), `test-engineer` + `session-coordinator` (Task 7). **REQUIRED SUB-SKILL:** superpowers:subagent-driven-development.

**2. Inline Execution** — execute tasks in this session with checkpoints (after Task 2, Task 4, Task 6, Task 7). Viable because the repo footprint is small (1 edited file + 3 new files + 2 doc appends). **REQUIRED SUB-SKILL:** superpowers:executing-plans.

Which approach?
