# 04 — Known Test Failures

> **Last verified**: 2026-05-03

## Summary

There are **9 expected failures** in `src/services/__tests__/authService.test.ts`. They are not regressions; they are the byproduct of testing service code that wraps Supabase Edge Functions without a live Supabase environment. The CI job marks the suite as a failure when these are not stubbed; locally, run `npx vitest run --reporter verbose` to see them isolated.

CLAUDE.md (`Pitfalls` section) records the same status:

> 9 pre-existing test failures (1 file: authService.test.ts) — Edge Function tests requiring live Supabase, known, not regressions

## The 9 failing tests

All sit in `src/services/__tests__/authService.test.ts`. The service under test (`src/services/authService.ts`) calls Supabase Edge Functions via `supabase.functions.invoke('auth-verify-pin', ...)` etc. The mock in the test file stubs `supabase.from(...)` and `supabase.rpc(...)` but does **not** stub `supabase.functions.invoke`, so calls return `undefined` and downstream assertions throw.

| # | Test name (excerpt) | Edge Function called | Why it fails |
|---|--------------------|----------------------|--------------|
| 1 | `loginWithPin > returns user data on success` | `auth-verify-pin` | `functions.invoke` not mocked → response is `undefined` |
| 2 | `loginWithPin > returns error on invalid PIN` | `auth-verify-pin` | Same |
| 3 | `loginWithPin > handles network error` | `auth-verify-pin` | Same |
| 4 | `validateSession > returns true for valid token` | `auth-get-session` | Same |
| 5 | `validateSession > returns false for expired token` | `auth-get-session` | Same |
| 6 | `logout > clears local + remote session` | `auth-logout` | Same |
| 7 | `changePin > succeeds with correct old PIN` | `auth-change-pin` | Same |
| 8 | `changePin > rejects wrong old PIN` | `auth-change-pin` | Same |
| 9 | `changePin > validates new PIN format` | `auth-change-pin` | Same |

All other test files in the suite pass; CI green-lights the build because the failure-counting policy currently tolerates this single file (see Mitigation below).

## Why we did not fix them yet

| Reason | Detail |
|--------|--------|
| Live Supabase coupling | The original tests were written assuming a dev-mode Supabase reachable from the runner — that environment was deprecated when Edge Functions moved to `verify_jwt: true` |
| Mock surface mismatch | Switching to mocked `supabase.functions.invoke` requires touching every helper in the file (~40 mocks), and `authService` itself was refactored after the tests were written |
| Risk vs. reward | The Edge Functions themselves are exercised in production every minute (PIN logins). Re-stubbing the unit test would not catch a regression that production telemetry doesn't already surface |

## How to fix (recommended path)

When someone has time to take this on:

```ts
// Add to the existing vi.mock('@/lib/supabase', ...) block in authService.test.ts:
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      verifyOtp: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
    from: vi.fn(/* ... existing chainable mock ... */),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    // NEW — the missing piece:
    functions: {
      invoke: vi.fn().mockResolvedValue({
        data: { success: true, user: { id: 'u1', role: 'cashier', permissions: [] } },
        error: null,
      }),
    },
  },
}));
```

Then per test, override the default with the scenario-specific response:

```ts
it('returns error on invalid PIN', async () => {
  vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
    data: null,
    error: { message: 'Invalid PIN', name: 'FunctionsHttpError' },
  });
  await expect(authService.loginWithPin('1234')).rejects.toThrow(/Invalid PIN/);
});
```

Estimated work: 2-3 hours. Adds ~50 LoC of mock plumbing and removes 9 red ticks from the suite.

## Mitigation today

| Mitigation | How |
|------------|-----|
| CI tolerates the failures | The `test` job runs `npx vitest run --coverage`; vitest exits non-zero only when overall pass rate drops below the configured threshold (or when a test newly added today fails) |
| PR reviewers know the count | If `authService.test.ts` shows >9 failures, that's a new regression — investigate |
| Local discoverability | `npx vitest run src/services/__tests__/authService.test.ts --reporter verbose` lists exactly which 9 are red |
| Production safety net | Sentry captures any auth Edge Function error in the field (org `the-breakery`, project `appgrav-v2`) |

## Other intentionally skipped or fragile tests

A scan of the suite (`grep -r "it.skip\|test.skip\|describe.skip" src --include="*.test.*"`) shows no `.skip` blocks at the time of last verification. If you encounter one in a future audit:

1. Capture the reason from the surrounding comment.
2. File a GitHub issue tagged `tech-debt` referencing the test file + line.
3. Update this table.

| File | Test | Skip reason | Issue |
|------|------|-------------|-------|
| _none_ | -- | -- | -- |

## Watch list

These tests have been flaky in the past and warrant attention if they start failing:

| File | Pattern | Mitigation |
|------|---------|-----------|
| `src/__tests__/smoke/pos-smoke.test.ts` | Ordering of mock resets | Always `vi.clearAllMocks()` in `beforeEach`, `vi.restoreAllMocks()` in `afterEach` |
| `src/hooks/inventory/__tests__/useInternalTransfers.test.ts` | Async race when react-query revalidates twice | `retry: false` + `gcTime: 0` in test QueryClient |
| `src/components/pos/__tests__/ComboGrid.test.tsx` | Snapshot-like text assertions on dynamically reordered items | Sort items in the assertion, or assert by role |

## Reporting a new failure

1. Reproduce locally: `npx vitest run path/to/file.test.ts`.
2. Confirm it isn't the 9 known cases above.
3. Open a GitHub issue tagged `bug:test`.
4. If blocking master, add a temporary `.skip` with a code comment pointing to the issue, then ship a follow-up.

## Cross-references

- Test runner config and threshold logic: `vite.config.ts` lines 225-265.
- CI gate: `.github/workflows/ci.yml` job `test`.
- How to run a single failing test: `05-running-tests.md`.
