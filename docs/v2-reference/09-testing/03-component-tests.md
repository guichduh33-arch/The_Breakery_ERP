# 03 — Component Tests

> **Last verified**: 2026-05-03

## Scope

Component tests render React via `@testing-library/react` 16.3.1 in a `jsdom` 26.1.0 environment, then assert on the resulting DOM. They cover UI primitives and pages where behaviour is non-trivial enough to warrant browser-level assertions.

## Inventory

| File | Subject |
|------|---------|
| `src/components/lan/__tests__/LanConnectionIndicator.test.tsx` | LAN status pill (icon + label per state) |
| `src/components/orders/__tests__/OrderItemStatusBadge.test.tsx` | Order item status badge variants |
| `src/components/pos/__tests__/LoyaltyBadge.test.tsx` | Loyalty tier badge (Bronze/Silver/Gold/Platinum) |
| `src/components/pos/__tests__/ComboGrid.test.tsx` | Combo selector grid |
| `src/components/reports/__tests__/ReportSkeleton.test.tsx` | Report loading skeleton |
| `src/components/reports/__tests__/ReportPlaceholder.test.tsx` | Report empty/placeholder state |
| `src/pages/dashboard/__tests__/DashboardPage.test.tsx` | Dashboard page (smoke) |
| `src/pages/settings/__tests__/CompanySettingsPage.test.tsx` | Company settings form |
| `src/pages/settings/__tests__/PrintingSettingsPage.test.tsx` | Printing settings form |

Total: ~9 `.tsx` test files.

## Setup

`src/setupTests.ts` is registered via `vite.config.ts` (`test.setupFiles`) and contains a single import:

```ts
import '@testing-library/jest-dom';
```

This adds custom matchers (`toBeInTheDocument`, `toHaveClass`, `toBeDisabled`, ...) to every test file. No global wrapper is registered; each test file constructs its own provider tree.

## The render-with-providers wrapper

Most pages need React Query, Router, and (sometimes) the theme provider. Inline this wrapper at the top of the file rather than extracting a shared helper — it keeps tests self-contained.

```tsx
import { ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

function renderWithProviders(
  ui: ReactNode,
  { route = '/', ...options }: { route?: string } & RenderOptions = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
    options,
  );
}
```

When the component reads from `next-themes` (`useTheme`), wrap with `<ThemeProvider attribute="class">`; when it reads from a Zustand store, set the store state via `useStore.setState({...})` in `beforeEach` rather than mocking the module.

## Pattern 1 — A11y queries

Prefer accessibility-first queries. Order of preference (per Testing Library guidance):

1. `getByRole('button', { name: /save/i })`
2. `getByLabelText('Email')`
3. `getByPlaceholderText('Enter email')`
4. `getByText(/welcome/i)`
5. `getByDisplayValue('current value')`
6. `getByTestId('save-button')` — last resort

```tsx
// src/components/lan/__tests__/LanConnectionIndicator.test.tsx (pattern)
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanConnectionIndicator } from '@/components/lan/LanConnectionIndicator';

describe('LanConnectionIndicator', () => {
  it('renders connected state with green check', () => {
    render(<LanConnectionIndicator status="connected" />);

    const indicator = screen.getByRole('status');
    expect(indicator).toHaveTextContent(/connected/i);
    expect(indicator).toHaveClass('text-emerald-500');
  });

  it('renders error state with red icon', () => {
    render(<LanConnectionIndicator status="error" />);
    expect(screen.getByRole('status')).toHaveTextContent(/error/i);
  });
});
```

## Pattern 2 — `userEvent` vs `fireEvent`

Use `userEvent` (from `@testing-library/user-event`) for interactions — it dispatches the full sequence of pointer/keyboard events a real user would. Reach for `fireEvent` only when you need to fire a single DOM event without the realistic sequence (e.g. `fireEvent.scroll`).

```tsx
import userEvent from '@testing-library/user-event';

it('opens the dialog on click', async () => {
  const user = userEvent.setup();
  render(<MyComponent />);

  await user.click(screen.getByRole('button', { name: /open/i }));

  expect(await screen.findByRole('dialog')).toBeInTheDocument();
});
```

Note: `userEvent` is already a transitive dep through `@testing-library/react`; if you need it directly, add it explicitly to `devDependencies`.

## Pattern 3 — Async UI

Use `findBy*` (returns a Promise) for assertions that depend on async work. Use `waitFor` only when you need to assert on a non-element condition.

```tsx
it('shows loaded data after fetch', async () => {
  render(<DashboardPage />);

  // Skeleton first
  expect(screen.getByText(/loading/i)).toBeInTheDocument();

  // Data after fetch (auto-retries until found or timeout)
  expect(await screen.findByRole('heading', { name: /sales today/i })).toBeInTheDocument();
});
```

## Pattern 4 — Mocking child components

For pages that compose 10+ children and you only care about one slot:

```tsx
vi.mock('@/components/dashboard/SalesChart', () => ({
  SalesChart: () => <div data-testid="sales-chart-mock">CHART</div>,
}));
```

Place every `vi.mock` at the very top, before importing the SUT.

## Snapshot tests — avoid

The repo deliberately has **no snapshot tests**. Reasons:

| Issue | Why it bites |
|-------|--------------|
| Brittle | Trivial markup changes break unrelated tests |
| Low signal | A passing snapshot says "unchanged", not "correct" |
| Review burden | PRs accumulate stale `.snap` diffs nobody reads |

Use focused assertions on roles, text, and ARIA attributes instead. The only acceptable exception is a serialised data structure (e.g. `expect(buildJournalEntry(...)).toMatchInlineSnapshot(...)`), and even then prefer `toEqual({ ... })` with an explicit shape.

## Component test smell catalogue

| Smell | Fix |
|-------|-----|
| `getByText('Save')` fails because the button has `aria-label="Save changes"` | Switch to `getByRole('button', { name: /save/i })` |
| Test passes locally, fails in CI | Add `await waitFor(...)` — race condition between fetch and assertion |
| `act() warning` in console | Wrap state-changing interaction in `await user.click(...)` (userEvent already handles act) |
| `useTheme` returns undefined | Wrap with `<ThemeProvider attribute="class" defaultTheme="dark">` |
| Router-dependent component crashes | Wrap with `<MemoryRouter initialEntries={[route]}>` |
| Test leaks into next test | New `QueryClient` per render; reset Zustand stores in `beforeEach` |

## Cleanup

`@testing-library/react` 16+ automatically calls `cleanup()` after each test when `globals: true` is set in Vitest config (it is — see `vite.config.ts` line 226). No manual cleanup needed.

## Cross-references

- Mocking Supabase: see `02-unit-tests.md` Pattern 2.
- Running a single component test: `npx vitest run src/components/lan` (see `05-running-tests.md`).
- Known limitations: see `04-known-failures.md`.
