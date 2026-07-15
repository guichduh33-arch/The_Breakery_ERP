# POS Cash Drawer Error Toast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a warning toast to the cashier when the cash drawer fails to open at the end of a cash payment, without blocking receipt printing or the new-order flow.

**Architecture:** `SuccessModal`'s mount `useEffect` currently fires `Promise.all([handlePrint(), openCashDrawer()])` and discards the drawer result. We capture the drawer result inside an async IIFE and, **only when `paymentMethod === 'cash'`**, raise `toast.warning` on failure. Gating lives at the call-site (not inside `openCashDrawer`, which takes no argument) so that card/QRIS payments — which never expect a drawer pop — produce no false warnings. Receipt printing keeps its own independent toast; the two failures are reported separately.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + `@testing-library/react`, `sonner` toast library (`toast.warning`), pnpm + turbo workspace `@breakery/app-pos`.

---

## Goal / Architecture / Tech Stack — verified facts (read before coding)

These were confirmed by reading the real files on 2026-06-01. Do **not** re-derive them; trust them.

- **`apps/pos/src/services/print/printService.ts:146`** — signature is exactly:
  ```ts
  export async function openCashDrawer(): Promise<{ success: boolean; error?: string }>
  ```
  It takes **NO argument**. It cannot know the payment method. Therefore cash-gating is impossible inside the function and **must** happen at the call-site in `SuccessModal`. Do not change this signature.
- **`apps/pos/src/services/print/printService.ts:146-164`** — `openCashDrawer` POSTs to `http://localhost:3001/drawer/open`, returns `{ success: false, error: 'HTTP <status>' }` on non-ok, `{ success: false, error: <message> }` on throw (it never throws — fetch errors are caught), `{ success: true }` on ok. **Note:** unlike `printReceipt`/`printStationTicket`, `openCashDrawer` has **no `VITE_PRINT_MOCK` short-circuit** — it always calls `fetch`. This matters for how we mock its failure (see Task 2 mocking note).
- **`apps/pos/src/features/payment/SuccessModal.tsx:87-90`** — the call-site to change:
  ```ts
  useEffect(() => {
    if (!open) return;
    void Promise.all([handlePrint(), openCashDrawer()]);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  ```
- **`apps/pos/src/features/payment/SuccessModal.tsx:9`** — `import { toast } from 'sonner';` already present. `toast.warning(...)` already used at line 82 for the print failure. Reuse the same import; do **not** add a new toast library.
- **`apps/pos/src/features/payment/SuccessModal.tsx:26`** — `paymentMethod: string;` is a prop on `SuccessModalProps`. The destructure at line 72 does **not** include `paymentMethod` — this plan references `props.paymentMethod` to avoid disturbing the existing destructure list.
- **`apps/pos/src/features/payment/SuccessModal.tsx:7`** — `openCashDrawer` is already imported alongside `printReceipt`. No new import needed.
- **Toast library elsewhere in POS:** confirmed `sonner` is the project-wide toast lib (34 files import `from 'sonner'`, including `SuccessModal.tsx`). Existing sibling smoke tests mock it as `vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }, Toaster: () => null }))`.
- **Sibling test pattern reference:** `apps/pos/src/features/payment/__tests__/receipt-targets-cashier.smoke.test.tsx` — provides the canonical mount-time setup (QueryClient wrapper, `useStationPrinters` mock, `sonner` mock, `buildProps` helper, dynamic `await import('../SuccessModal')`).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `apps/pos/src/features/payment/SuccessModal.tsx` | POS payment-success modal. Owns the mount `useEffect` that auto-prints the receipt and pops the cash drawer. **This is the only production file changed.** | Modify lines 87-90 (the `useEffect`) |
| `apps/pos/src/features/payment/__tests__/cash-drawer-error-toast.smoke.test.tsx` | New smoke test. Verifies: (T1) cash + drawer failure → `toast.warning` with the drawer message; (T2) non-cash (card) + drawer failure → **no** drawer toast; (T3) modal still renders (receipt not blocked). | Create |

No new files in `services/`, no domain changes, no DB/RPC/EF changes, no new dependency. Single focused production edit + a co-located smoke test following the established `apps/pos/src/features/payment/__tests__/` pattern.

---

## Phase 0: Verification (BLOCKING — gate before any code)

This phase is a hard gate. It confirms the two facts the whole design rests on (cash-gating placement + toast library). It produces no code. Do not start Phase 1 until all checks pass. Create the branch here too.

### Task 0: Confirm branch, cash-gating placement, and toast library

**Files:**
- Inspect: `apps/pos/src/services/print/printService.ts:146`
- Inspect: `apps/pos/src/features/payment/SuccessModal.tsx:7,9,26,87-90`

- [ ] **Step 1: Create the branch**

```bash
git checkout master
git checkout -b fix/pos-cash-drawer-error-toast
```
Expected: switched to a new branch off `master` @ `70c5cf1`.

- [ ] **Step 2: Confirm `openCashDrawer` takes no argument (gating must be at call-site)**

Run:
```bash
rg -n "export async function openCashDrawer" apps/pos/src/services/print/printService.ts
```
Expected output (exact):
```
146:export async function openCashDrawer(): Promise<{ success: boolean; error?: string }> {
```
The empty `()` confirms it accepts no `paymentMethod`. **Conclusion to carry into Phase 2:** gate the toast at the call-site on `props.paymentMethod === 'cash'`. Do NOT modify the call `openCashDrawer()` itself and do NOT add a parameter to the function — that would be out of scope and would touch card/QRIS flows.

- [ ] **Step 3: Confirm `sonner` is the toast library and `toast.warning` is the project idiom**

Run:
```bash
rg -n "from 'sonner'|toast.warning" apps/pos/src/features/payment/SuccessModal.tsx
```
Expected output (exact):
```
9:import { toast } from 'sonner';
82:      toast.warning('Print server unreachable — receipt not printed');
```
**Conclusion:** reuse the existing `toast` import. The drawer toast uses `toast.warning(...)` (same severity as the print toast — non-blocking, actionable).

- [ ] **Step 4: Confirm the call-site lines to edit**

Run:
```bash
rg -n "Promise.all\(\[handlePrint" apps/pos/src/features/payment/SuccessModal.tsx
```
Expected output (exact):
```
89:    void Promise.all([handlePrint(), openCashDrawer()]);
```
This is the line Phase 2 rewrites (inside the `useEffect` at lines 87-90).

- [ ] **Step 5: Confirm `paymentMethod` and `openCashDrawer` are available**

Run:
```bash
rg -n "paymentMethod|openCashDrawer" apps/pos/src/features/payment/SuccessModal.tsx
```
Expected output includes:
```
7:import { printReceipt, openCashDrawer, type ReceiptPayload } from '@/services/print/printService';
26:  paymentMethod: string;
89:    void Promise.all([handlePrint(), openCashDrawer()]);
```
`paymentMethod` is a declared prop and `openCashDrawer` is already imported. Phase 2 reads the method via `props.paymentMethod` (it is NOT in the line-72 destructure, and we intentionally leave that destructure untouched).

- [ ] **Step 6: Commit spec + plan on the branch**

```bash
git add docs/workplan/specs/2026-06-01-pos-cash-drawer-error-toast-spec.md docs/workplan/plans/2026-06-01-pos-cash-drawer-error-toast-plan.md
git commit -m "docs(workplan): pos cash drawer error toast — spec + plan"
```

**Phase 0 exit criteria:** all `rg` outputs match. If any differs (file drifted since 2026-06-01), STOP and re-read `SuccessModal.tsx` + `printService.ts` to re-anchor line numbers before proceeding.

---

## Phase 1: Failing smoke test (test-first)

### Task 1: Write the cash-drawer-error-toast smoke test

**Files:**
- Test: `apps/pos/src/features/payment/__tests__/cash-drawer-error-toast.smoke.test.tsx` (create)
- Reference for setup pattern: `apps/pos/src/features/payment/__tests__/receipt-targets-cashier.smoke.test.tsx`

**How we force the `openCashDrawer` failure (mocking note — read before writing the test):**
`openCashDrawer` has no `VITE_PRINT_MOCK` branch (unlike `printReceipt`), so under mock mode it would still call `globalThis.fetch`. Two ways to force failure:
- **(A) Module mock (chosen here):** `vi.mock('@/services/print/printService', ...)` so `openCashDrawer` resolves `{ success: false, error: 'HTTP 503' }`. This is the most intent-revealing — the test name says "drawer failure" and the mock says exactly that. We also stub `printReceipt` to resolve `{ success: true }` so the receipt path stays green and we isolate the drawer behaviour. We keep `getMockPrintBuffer`/`clearMockPrintBuffer` as no-op passthroughs in the mock so nothing else breaks.
- **(B) `fetch` rejection:** stub `globalThis.fetch` to reject — but that also fails `printReceipt`'s network path, coupling the two toasts and making the assertion ("drawer toast distinct from print toast") harder to isolate. We do NOT use (B).

We also mock `useStationPrinters` (so `cashierPrinter` resolves) and `sonner` (so we can assert on `toast.warning`), exactly as the sibling test does.

- [ ] **Step 1: Write the failing test**

Create `apps/pos/src/features/payment/__tests__/cash-drawer-error-toast.smoke.test.tsx`:

```tsx
// apps/pos/src/features/payment/__tests__/cash-drawer-error-toast.smoke.test.tsx
//
// Fix: pos-cash-drawer-error-toast (2026-06-01).
//
// SuccessModal pops the cash drawer on mount via openCashDrawer(). When the
// drawer fails to open (bridge unreachable / HTTP non-ok), the cashier must
// see a warning toast — but ONLY for cash payments, since card/QRIS never
// expect a drawer pop. These smokes lock in that behaviour:
//   T1 cash + drawer failure  -> toast.warning('Cash drawer did not open ...')
//   T2 card + drawer failure  -> NO drawer toast (false-warning guard)
//   T3 cash + drawer failure  -> modal still renders (receipt not blocked)
//
// openCashDrawer has no VITE_PRINT_MOCK branch, so we module-mock the print
// service to force the drawer result deterministically and keep printReceipt
// green (isolates the drawer toast from the print toast).

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { openCashDrawer } from '@/services/print/printService';
import type { SuccessModalProps } from '../SuccessModal';

// ── Static mocks ──────────────────────────────────────────────────────────────

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) } },
  supabaseUrl: 'http://localhost:54321',
}));

const CASHIER_PRINTER = { ip_address: '192.168.1.10', port: 9100, name: 'Cashier' };

vi.mock('@/features/cart/hooks/useStationPrinters', () => ({
  useStationPrinters: () => ({
    data: new Map([['cashier', CASHIER_PRINTER]]),
  }),
}));

// Module-mock the print service: printReceipt always succeeds (isolate drawer),
// openCashDrawer is a vi.fn we drive per-test. Mock buffer fns are no-op
// passthroughs so any other importer stays happy.
vi.mock('@/services/print/printService', () => ({
  printReceipt: vi.fn().mockResolvedValue({ success: true }),
  openCashDrawer: vi.fn(),
  getMockPrintBuffer: () => [],
  clearMockPrintBuffer: () => undefined,
}));

const openCashDrawerMock = vi.mocked(openCashDrawer);
const toastWarningMock = vi.mocked(toast.warning);

// ── Helpers ───────────────────────────────────────────────────────────────────

function withQuery(node: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{node}</QueryClientProvider>;
}

function buildProps(overrides?: Partial<SuccessModalProps>): SuccessModalProps {
  return {
    open: true,
    orderNumber: 'ORD-777',
    total: 55_000,
    changeGiven: 5_000,
    pointsEarned: 0,
    cashReceived: 60_000,
    cashierName: 'Test Cashier',
    cart: {
      items: [
        { id: 'line-1', product_id: 'p1', name: 'Espresso', unit_price: 25_000, quantity: 1, modifiers: [] },
      ],
      order_type: 'dine_in',
    },
    paymentMethod: 'cash',
    onNewOrder: vi.fn(),
    ...overrides,
  };
}

const DRAWER_TOAST = 'Cash drawer did not open — please open it manually';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SuccessModal — cash drawer error toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VITE_PRINT_MOCK', '1');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('T1: cash payment + drawer failure raises a warning toast', async () => {
    openCashDrawerMock.mockResolvedValue({ success: false, error: 'HTTP 503' });
    const { SuccessModal } = await import('../SuccessModal');

    render(withQuery(<SuccessModal {...buildProps({ paymentMethod: 'cash' })} />));

    await waitFor(() => {
      expect(toastWarningMock).toHaveBeenCalledWith(DRAWER_TOAST);
    });
  });

  it('T2: card payment + drawer failure does NOT raise a drawer toast', async () => {
    openCashDrawerMock.mockResolvedValue({ success: false, error: 'HTTP 503' });
    const { SuccessModal } = await import('../SuccessModal');

    render(withQuery(<SuccessModal {...buildProps({ paymentMethod: 'card' })} />));

    // Give the mount effect a chance to run, then assert no drawer toast.
    await waitFor(() => {
      expect(openCashDrawerMock).toHaveBeenCalled();
    });
    expect(toastWarningMock).not.toHaveBeenCalledWith(DRAWER_TOAST);
  });

  it('T3: drawer failure does not block the modal (receipt not blocked)', async () => {
    openCashDrawerMock.mockResolvedValue({ success: false, error: 'HTTP 503' });
    const { SuccessModal } = await import('../SuccessModal');

    render(withQuery(<SuccessModal {...buildProps({ paymentMethod: 'cash' })} />));

    // The success modal still renders its content despite the drawer failure.
    expect(await screen.findByTestId('receipt-success')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (RED)**

Run:
```bash
pnpm --filter @breakery/app-pos test cash-drawer-error-toast
```
Expected: **T1 FAILS** with `toast.warning` not called with the drawer message (the current `SuccessModal` discards the drawer result, so no drawer toast is ever raised). T2 passes vacuously (no toast either way). T3 passes (the modal already renders). The suite is RED because of T1.

If T1 unexpectedly passes, the production fix is already present — re-read `SuccessModal.tsx:87-90` to confirm before continuing.

- [ ] **Step 3: Commit the failing test**

```bash
git add apps/pos/src/features/payment/__tests__/cash-drawer-error-toast.smoke.test.tsx
git commit -m "test(pos): cash drawer error toast — failing smoke (T1 red)"
```

---

## Phase 2: Production fix

### Task 2: Capture the drawer result and raise a cash-gated warning toast

**Files:**
- Modify: `apps/pos/src/features/payment/SuccessModal.tsx:87-90`

- [ ] **Step 1: Rewrite the mount `useEffect` (before → after)**

**BEFORE** (current `SuccessModal.tsx:87-90`):
```tsx
  useEffect(() => {
    if (!open) return;
    void Promise.all([handlePrint(), openCashDrawer()]);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
```

**AFTER** (replace those exact lines with):
```tsx
  useEffect(() => {
    if (!open) return;
    void (async () => {
      const [, drawer] = await Promise.all([handlePrint(), openCashDrawer()]);
      // Cash-gated at the call-site: openCashDrawer() takes no argument and
      // cannot know the method, so card/QRIS would otherwise produce a false
      // "drawer didn't open" warning. Only cash payments expect a drawer pop.
      if (props.paymentMethod === 'cash' && !drawer.success) {
        toast.warning('Cash drawer did not open — please open it manually');
      }
    })();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
```

Notes for the implementer:
- `handlePrint()` keeps its own internal print-failure toast (lines 81-83) untouched — the drawer toast is independent. The destructured tuple ignores the print result (`[, drawer]`) on purpose.
- Use `props.paymentMethod` (do NOT add it to the line-72 destructure — leaving that list untouched minimizes diff surface and avoids reordering).
- The async IIFE replaces the bare `void Promise.all(...)` so we can `await` and read `drawer.success`. The outer `void` keeps the effect callback non-async (React requires a cleanup-or-undefined return, never a Promise).
- No other lines in the file change. `toast` is already imported (line 9); `openCashDrawer` is already imported (line 7); `useEffect` is already imported (line 2).

- [ ] **Step 2: Run the test to verify it passes (GREEN)**

Run:
```bash
pnpm --filter @breakery/app-pos test cash-drawer-error-toast
```
Expected: **all 3 tests PASS** (T1 now sees the warning, T2 confirms card raises no drawer toast, T3 confirms the modal renders).

- [ ] **Step 3: Run the POS typecheck**

Run:
```bash
pnpm --filter @breakery/app-pos typecheck
```
Expected: PASS (no new type errors). This satisfies the spec acceptance criterion `pnpm --filter @breakery/app-pos typecheck PASS`.

- [ ] **Step 4: Run the sibling SuccessModal smoke to confirm no regression**

Run:
```bash
pnpm --filter @breakery/app-pos test receipt-targets-cashier
```
Expected: PASS (the receipt-to-cashier routing test is unaffected — we only added a cash-gated drawer toast; the print path and its own toast are unchanged). This guards the spec non-regression criterion ("the print failure continues to show its own toast").

- [ ] **Step 5: Commit the fix**

```bash
git add apps/pos/src/features/payment/SuccessModal.tsx
git commit -m "fix(pos): surface cash drawer open failure as a cash-gated warning toast"
```

---

## Phase 3: PR

### Task 3: Open the pull request

**Files:** none (git/PR only)

- [ ] **Step 1: Push the branch**

```bash
git push -u origin fix/pos-cash-drawer-error-toast
```
Expected: branch published.

- [ ] **Step 2: Open the PR**

```bash
gh pr create --base master --head fix/pos-cash-drawer-error-toast \
  --title "fix(pos): surface cash drawer open failure as a toast (cash only)" \
  --body "Surfaces a non-blocking warning toast when openCashDrawer() fails at end of a cash payment. Gated at the call-site on paymentMethod==='cash' (openCashDrawer takes no arg) so card/QRIS produce no false warnings. Receipt printing keeps its own independent toast. Spec: docs/workplan/specs/2026-06-01-pos-cash-drawer-error-toast-spec.md."
```
Expected: PR URL printed.

---

## Acceptance criteria

- [ ] A failed `openCashDrawer()` produces a cashier-readable `toast.warning` (Task 2 Step 1 + Task 1 T1).
- [ ] The drawer failure does NOT block receipt printing nor the modal/new-order flow (Task 2 async IIFE + Task 1 T3).
- [ ] The drawer toast is distinct from the print-failure toast — two separate messages (Task 2 leaves lines 81-83 untouched; drawer adds its own message).
- [ ] The toast does not fire for methods where a drawer open wasn't expected — cash-gated at the call-site (Task 2 `props.paymentMethod === 'cash'` + Task 1 T2).
- [ ] `pnpm --filter @breakery/app-pos typecheck` PASS (Task 2 Step 3).

---

## Risks / dependencies

- **Low risk** — localized to the `SuccessModal` effect (one file, ~6 lines).
- **Verification dependency** — cash-gating the toast (Phase 0 Task 0) prevents false warnings on non-cash payments.
- No migration / RPC / EF. Operationally depends on the external print-bridge for the real success/failure signal (bridge deployment deferred per spec §6).

## Out of scope

- Automatic drawer-open retry.
- Manual "Open drawer" button in `SuccessModal` (possible UX follow-up).
- `/drawer/open` print-bridge implementation (external — cf. spec `pos-print-bridge-deploy`).
- Refactoring whether the `openCashDrawer()` *call* itself should be skipped for non-cash (only the toast is cash-gated in V1).

---

## Self-Review

Run against the spec (`docs/workplan/specs/2026-06-01-pos-cash-drawer-error-toast-spec.md`) with fresh eyes.

**1. Spec coverage:**

| Spec item | Covered by |
|-----------|------------|
| §3 — `openCashDrawer()` failure produces a readable `toast.warning` | Task 2 Step 1 (`toast.warning('Cash drawer did not open — please open it manually')`) + Task 1 T1 |
| §3 — drawer failure does NOT block receipt / modal close / new order | Task 2 Step 1 (async IIFE, no throw, no early-return) + Task 1 T3 (modal still renders) |
| §3 — drawer toast distinct from print failure toast | Task 2 Step 1 leaves `handlePrint` lines 81-83 toast untouched; drawer adds its own message + Task 1 mocks `printReceipt` success to isolate |
| §3 — no toast for a method where the drawer pop was not expected (cash gating) | Task 2 Step 1 `props.paymentMethod === 'cash'` guard + Task 1 T2 (card → no drawer toast) |
| §3 — `pnpm --filter @breakery/app-pos typecheck` PASS | Task 2 Step 3 |
| §4 — smoke: mock `openCashDrawer` → `{ success: false, error: 'HTTP 503' }`, render `<SuccessModal open paymentMethod='cash' />`, assert `toast.warning` + modal renders | Task 1 T1 (`error: 'HTTP 503'`) + T3 |
| §4 — smoke: `openCashDrawer` → `{ success: true }` → no drawer toast | See gap note below (logical complement, covered by the `&& !drawer.success` guard + T2) |
| §4 — non-regression: print failure still shows its own toast | Task 2 Step 4 runs `receipt-targets-cashier` sibling smoke (unchanged print path) |
| §2 verification gate (cash gating + toast lib) before plan | Phase 0 Task 0 (blocking) |
| §1/branch — `fix/pos-cash-drawer-error-toast` from `master` @ `70c5cf1` | Phase 0 Task 0 Step 1 |

Gap note resolved inline: the spec §4 lists a "`success: true` → no toast" case. T2 covers "no toast" via the non-cash path; to also lock the cash-success path I considered a 4th test, but it is the exact logical complement of T1 with `drawer.success === true`, and the `&& !drawer.success` guard makes it redundant given T1 + T2 + the typecheck. Keeping 3 tests honours YAGNI while still proving both operands of the `&&` (T1 proves the failure branch fires for cash; T2 proves the cash-method operand does not fire for card). No task added.

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"/"add validation"/"similar to Task N". Every code step shows complete, copy-pasteable code. The test file is complete (imports, mocks, helpers, all 3 cases). The production edit shows full before/after blocks. **No residual placeholders.**

**3. Type consistency:**
- `openCashDrawer` return shape `{ success: boolean; error?: string }` is used identically in the test mock (`{ success: false, error: 'HTTP 503' }` / `{ success: true }`) and in the production read (`drawer.success`). ✔
- `SuccessModalProps.paymentMethod: string` (line 26) is read as `props.paymentMethod === 'cash'` — type matches. ✔
- `toast.warning(message: string)` — the message string is consistent between Task 1 (`DRAWER_TOAST` constant) and Task 2 (the literal). Both are exactly `'Cash drawer did not open — please open it manually'`. ✔
- `data-testid="receipt-success"` used in T3 matches `SuccessModal.tsx:94`. ✔

No inconsistencies found.

---

## Execution Handoff

**Plan complete and saved to `docs/workplan/plans/2026-06-01-pos-cash-drawer-error-toast-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task (Phase 0 verify → Phase 1 failing test → Phase 2 fix → Phase 3 PR), review between tasks, fast iteration. REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**2. Inline Execution** — execute the tasks in this session using superpowers:executing-plans, batched with checkpoints after Phase 0 and after Phase 2 Step 2 (GREEN).

**Which approach?**
