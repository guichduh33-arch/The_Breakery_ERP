# 02 — Unit Tests

> **Last verified**: 2026-05-03

## Scope

Unit tests cover pure logic: store mutations, service functions, custom hooks, utilities. They do not render React, do not hit a real DB, and run in a jsdom environment with mocked Supabase.

## Inventory by domain

| Domain | Path | Test files | Notable |
|--------|------|-----------|---------|
| Stores (Zustand) | `src/stores/__tests__/`, `src/stores/terminalStore.test.ts`, `src/stores/settings/__tests__/` | 8 | `cartStore`, `cartStoreCombo`, `paymentStore`, `orderStore`, `authStore`, `displayStore`, `splitItemStore`, `terminalStore`, `coreSettingsStore` |
| Services — payment | `src/services/payment/__tests__/` | 3 | `paymentService`, `paymentIntegration`, `splitItemValidation` |
| Services — accounting | `src/services/accounting/__tests__/` | 4 | `accountingService`, `accountingEngine`, `journalEntryValidation`, `vatService` |
| Services — financial | `src/services/financial/__tests__/` | 5 | `auditService`, `securityAudit`, `voidService`, `refundService`, `financialOperationService` |
| Services — reporting | `src/services/reporting/__tests__/` | 3 | `reportingSalesService`, `reportingInventoryService`, `reportingFinancialService` |
| Services — pos | `src/services/pos/__tests__/` | 2 | `orderService`, `promotionEngine` |
| Services — inventory | `src/services/inventory/__tests__/` | 2 | `inventoryAlerts`, `stockManagementAudit` |
| Services — kds | `src/services/kds/__tests__/` | 2 | `kdsStatusService`, `orderCompletionService` |
| Services — b2b | `src/services/b2b/__tests__/` | 2 | `arService`, `b2bPosOrderService` |
| Services — print / lan / reports / auth | various | 5 | `printService`, `lanHub`, `lanProtocol`, `csvExport`, `authService` |
| Hooks | `src/hooks/**/__tests__/` | 14 | Inventory, products, kds, pos, lan, settings, purchasing, dashboard |
| Utils | `src/utils/__tests__/` | 3 | `helpers`, `stockStatus`, `unitConversion` |

Total: ~55 unit-test files (out of 65 total).

## Pattern 1 — Zustand store

```ts
// src/stores/__tests__/cartStore.test.ts (excerpt of the canonical pattern)
import { describe, it, expect, beforeEach } from 'vitest';
import { useCartStore } from '@/stores/cartStore';

describe('cartStore', () => {
  beforeEach(() => {
    // Reset to initial state — Zustand stores persist across tests in the same file
    useCartStore.setState(useCartStore.getInitialState());
  });

  it('adds a product to the cart', () => {
    const { addItem } = useCartStore.getState();
    addItem({ kind: 'product', productId: 'p1', name: 'Croissant', price: 25000, quantity: 1 });

    const items = useCartStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.price).toBe(25000);
  });

  it('locks an item once kitchen-sent', () => {
    const { addItem, lockItem } = useCartStore.getState();
    addItem({ kind: 'product', productId: 'p1', name: 'Croissant', price: 25000, quantity: 1 });
    lockItem(useCartStore.getState().items[0]!.id);

    expect(useCartStore.getState().items[0]?.locked).toBe(true);
  });
});
```

Key rules:
- Always reset the store in `beforeEach` (use `getInitialState()` if the store exposes it, or call a custom `reset()` action).
- Test actions through `getState()` — never the React hook itself in unit tests.
- Assert on the slice that changed, not the entire state object.

## Pattern 2 — Service with mocked Supabase

```ts
// src/services/payment/__tests__/paymentService.test.ts (canonical mock setup)
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'ord-1' }, error: null }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
  },
}));

import { processPayment, validatePayment } from '@/services/payment/paymentService';

describe('paymentService.validatePayment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts cash with sufficient cashReceived', () => {
    const result = validatePayment(
      { method: 'cash', amount: 100_000, cashReceived: 150_000 },
      100_000,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects cash with cashReceived < amount', () => {
    const result = validatePayment(
      { method: 'cash', amount: 100_000, cashReceived: 50_000 },
      100_000,
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Cash received must be at least the payment amount');
  });
});
```

Key rules:
- `vi.mock('@/lib/supabase', ...)` at the **top of the file**, before any imports of the SUT (Vitest hoists it).
- The chainable mock (`select().eq().single()`) uses `mockReturnThis()` for chain methods and `mockResolvedValue` for terminal ones.
- Reset mocks with `vi.clearAllMocks()` in `beforeEach`, not `vi.restoreAllMocks()` (the latter wipes the mock implementation).

## Pattern 3 — Custom hook with QueryClient wrapper

Hooks that use `@tanstack/react-query` need a provider. The standard wrapper:

```ts
// src/hooks/inventory/__tests__/useLocations.test.ts (pattern)
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{ id: 'loc-1', name: 'Main warehouse' }],
        error: null,
      }),
    })),
  },
}));

import { useLocations } from '@/hooks/inventory/useLocations';

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe('useLocations', () => {
  it('returns locations from Supabase', async () => {
    const { result } = renderHook(() => useLocations(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.name).toBe('Main warehouse');
  });
});
```

Key rules:
- New `QueryClient` per test → no cache leakage between tests.
- `retry: false` is mandatory — react-query's default 3-retry policy will exhaust your `testTimeout`.
- `gcTime: 0` immediately drops cached queries when the wrapper unmounts.
- Always `await waitFor(...)` before reading `result.current.data` — the first render is `isLoading: true`.

## Pattern 4 — Pure utility

```ts
// src/utils/__tests__/helpers.test.ts (excerpt)
import { describe, it, expect } from 'vitest';
import { formatCurrency, roundToHundred } from '@/utils/helpers';

describe('formatCurrency', () => {
  it('formats IDR with grouping', () => {
    expect(formatCurrency(1_500_000)).toBe('Rp 1.500.000');
  });

  it('rounds to nearest 100 before formatting', () => {
    expect(formatCurrency(1_549)).toBe('Rp 1.500');
  });
});

describe('roundToHundred', () => {
  it('rounds 1549 down to 1500', () => {
    expect(roundToHundred(1549)).toBe(1500);
  });
  it('rounds 1550 up to 1600', () => {
    expect(roundToHundred(1550)).toBe(1600);
  });
});
```

No mocks needed; pure-function tests are the cheapest and most stable in the suite.

## Common Supabase mock patterns

| Operation | Mock |
|-----------|------|
| Single row read | `single: vi.fn().mockResolvedValue({ data: { ... }, error: null })` |
| List read | `order: vi.fn().mockResolvedValue({ data: [...], error: null })` |
| Insert | `insert: vi.fn().mockResolvedValue({ data: [...], error: null })` |
| RPC | `rpc: vi.fn().mockResolvedValue({ data: <result>, error: null })` |
| Error path | `mockResolvedValue({ data: null, error: new Error('boom') })` |
| Auth session | `auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { ... } }, error: null }) }` |

## Pitfalls

- **Hoist order**: `vi.mock()` is hoisted by Vitest. If you import the SUT before the mock, you get the real module.
- **Stateful Zustand**: a previous test's `setState` leaks into the next one if you forget the `beforeEach` reset. Symptom: tests pass solo, fail in suite.
- **Promise unwrapping**: `await expect(promise).resolves.toBe(x)` is preferred over `expect(await promise).toBe(x)` — better failure messages.
- **Date-dependent logic**: use `vi.useFakeTimers({ now: new Date('2026-05-03T08:00:00Z') })` and `vi.useRealTimers()` in afterEach.
- **`vi.stubEnv`** must be called before the SUT reads `import.meta.env`. Pattern: place at the top of the file alongside `vi.mock`.

## Cross-references

- See `03-component-tests.md` for `.tsx` rendering patterns.
- See `04-known-failures.md` for the `authService.test.ts` Edge Function gap.
- See `05-running-tests.md` to invoke a single file or filter by name.
