# Phase 4 — Shared Packages (utils, domain, ui, supabase)

> **Trace historique** : ce fichier documente une session de travail datée. Le contenu de fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure documentaire (voir [`docs/README.md`](../../../README.md)).
> **Last refreshed** : 2026-05-13

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Remplir les 4 packages internes avec leur logique réelle (vs squelettes Phase 1) — TDD strict pour `domain` et `utils`, composants + tests RTL pour `ui`, client + types générés pour `supabase`.

**Spec source:** `docs/workplan/specs/2026-05-03-breakery-split-2apps-design.md` sections 5, 6, 7.

**Dépend de :** Phase 1 (squelettes), Phase 2 (DB pour types). Peut commencer en parallèle de Phase 3 sauf le `supabase` qui veut les tables.

**À la fin :**
- `@breakery/utils` : safeStorage, env (Zod), logger, dates, idr → tests ≥ 85%
- `@breakery/domain` : cart, payment, orders, types → tests ≥ 90%
- `@breakery/ui` : tokens.css complet, tailwind preset complet, 9 primitives shadcn vendues, 6 composants domain (Numpad, NumpadPin, Currency, QuantityStepper, OrderTypeTabs, FullScreenModal) → tests ≥ 70% sur critiques
- `@breakery/supabase` : client singleton, types générés depuis DB, helpers RLS

---

## 4A — `@breakery/utils`

### Task 4.1 — `idr.ts` (round_idr + format)

**Files:**
- Create: `packages/utils/src/idr.ts`
- Create: `packages/utils/src/__tests__/idr.test.ts`

- [ ] **Step 1: Test failing**

```ts
// packages/utils/src/__tests__/idr.test.ts
import { describe, it, expect } from 'vitest';
import { roundIdr, formatIdr } from '../idr';

describe('roundIdr', () => {
  it('rounds to nearest 100', () => {
    expect(roundIdr(123)).toBe(100);
    expect(roundIdr(150)).toBe(200);
    expect(roundIdr(149)).toBe(100);
    expect(roundIdr(7273.5)).toBe(7300);
    expect(roundIdr(0)).toBe(0);
  });
  it('handles negatives (refund)', () => {
    expect(roundIdr(-150)).toBe(-200);
    expect(roundIdr(-149)).toBe(-100);
  });
});

describe('formatIdr', () => {
  it('formats with Rp prefix and thousands separator', () => {
    expect(formatIdr(35000)).toBe('Rp 35,000');
    expect(formatIdr(7273)).toBe('Rp 7,273');
    expect(formatIdr(0)).toBe('Rp 0');
    expect(formatIdr(1234567)).toBe('Rp 1,234,567');
  });
  it('handles negatives', () => {
    expect(formatIdr(-35000)).toBe('-Rp 35,000');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @breakery/utils test
```

Expected: FAIL with "Cannot find module '../idr'".

- [ ] **Step 3: Implementation**

```ts
// packages/utils/src/idr.ts
export function roundIdr(amount: number): number {
  return Math.round(amount / 100) * 100;
}

export function formatIdr(amount: number): string {
  const isNegative = amount < 0;
  const absStr = Math.abs(amount).toLocaleString('en-US');
  return `${isNegative ? '-' : ''}Rp ${absStr}`;
}
```

- [ ] **Step 4: Run test pass**

```bash
pnpm --filter @breakery/utils test
```

Expected: PASS.

- [ ] **Step 5: Export from index**

```ts
// packages/utils/src/index.ts
export { roundIdr, formatIdr } from './idr.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/utils/src/
git commit -m "feat(utils): add roundIdr + formatIdr with tests"
```

---

### Task 4.2 — `safeStorage.ts`

**Files:**
- Create: `packages/utils/src/safeStorage.ts`
- Create: `packages/utils/src/__tests__/safeStorage.test.ts`

- [ ] **Step 1: Test failing**

```ts
// packages/utils/src/__tests__/safeStorage.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { safeStorage } from '../safeStorage';

describe('safeStorage', () => {
  beforeEach(() => {
    // jsdom provides sessionStorage. Clear it.
    if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
  });

  it('get returns null for missing key', async () => {
    const v = await safeStorage.get('missing');
    expect(v).toBeNull();
  });

  it('set + get roundtrips', async () => {
    await safeStorage.set('foo', 'bar');
    expect(await safeStorage.get('foo')).toBe('bar');
  });

  it('remove deletes the key', async () => {
    await safeStorage.set('foo', 'bar');
    await safeStorage.remove('foo');
    expect(await safeStorage.get('foo')).toBeNull();
  });

  it('returns null silently if sessionStorage throws', async () => {
    const original = sessionStorage.getItem;
    sessionStorage.getItem = vi.fn(() => { throw new Error('quota'); });
    try {
      const v = await safeStorage.get('any');
      expect(v).toBeNull();
    } finally {
      sessionStorage.getItem = original;
    }
  });
});
```

- [ ] **Step 2: Switch test env to jsdom for this package**

Modifier `packages/utils/vitest.config.ts` :

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',           // changed from 'node'
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      thresholds: { lines: 85, statements: 85, functions: 85, branches: 80 },
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts']
    }
  }
});
```

Add `jsdom` to devDeps :

```bash
pnpm --filter @breakery/utils add -D jsdom@^26
```

- [ ] **Step 3: Run test fails**

```bash
pnpm --filter @breakery/utils test
```

Expected: FAIL with "Cannot find module '../safeStorage'".

- [ ] **Step 4: Implementation**

```ts
// packages/utils/src/safeStorage.ts
// Wrappage localStorage/sessionStorage Capacitor-ready.
// En web : sessionStorage (tab-scoped, cleared on close).
// En Capacitor (futur) : @capacitor/preferences.
// L'API est asynchrone partout pour préparer Capacitor.

export interface SafeStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

function isWeb(): boolean {
  return typeof sessionStorage !== 'undefined';
}

export const safeStorage: SafeStorage = {
  async get(key) {
    if (!isWeb()) return null;
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    if (!isWeb()) return;
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // ignore quota / disabled storage
    }
  },
  async remove(key) {
    if (!isWeb()) return;
    try {
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
  async clear() {
    if (!isWeb()) return;
    try {
      sessionStorage.clear();
    } catch {
      // ignore
    }
  },
};
```

- [ ] **Step 5: Run test pass + add export**

```bash
pnpm --filter @breakery/utils test
```

Expected: PASS.

```ts
// packages/utils/src/index.ts
export { roundIdr, formatIdr } from './idr.js';
export { safeStorage, type SafeStorage } from './safeStorage.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/utils/
git commit -m "feat(utils): add safeStorage with sessionStorage backend"
```

---

### Task 4.3 — `env.ts` (Zod validation)

**Files:**
- Create: `packages/utils/src/env.ts`
- Create: `packages/utils/src/__tests__/env.test.ts`

- [ ] **Step 1: Test**

```ts
// packages/utils/src/__tests__/env.test.ts
import { describe, it, expect } from 'vitest';
import { parseAppEnv } from '../env';

describe('parseAppEnv', () => {
  it('parses valid app env', () => {
    const env = parseAppEnv({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'anon-key',
      VITE_SENTRY_DSN_POS: 'https://example@sentry.io/1',
    });
    expect(env.VITE_SUPABASE_URL).toBe('http://127.0.0.1:54321');
  });

  it('throws on missing required', () => {
    expect(() => parseAppEnv({})).toThrow(/SUPABASE_URL/);
  });

  it('allows empty Sentry DSN (dev)', () => {
    const env = parseAppEnv({
      VITE_SUPABASE_URL: 'http://x',
      VITE_SUPABASE_ANON_KEY: 'k',
    });
    expect(env.VITE_SENTRY_DSN_POS).toBeUndefined();
  });
});
```

- [ ] **Step 2: Implementation**

```ts
// packages/utils/src/env.ts
import { z } from 'zod';

const AppEnvSchema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
  VITE_SENTRY_DSN_POS: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  VITE_SENTRY_DSN_BACKOFFICE: z.string().url().optional().or(z.literal('').transform(() => undefined)),
});

export type AppEnv = z.infer<typeof AppEnvSchema>;

export function parseAppEnv(input: Record<string, string | undefined>): AppEnv {
  const result = AppEnvSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}
```

- [ ] **Step 3: Add export + commit**

```ts
// packages/utils/src/index.ts (append)
export { parseAppEnv, type AppEnv } from './env.js';
```

```bash
pnpm --filter @breakery/utils test
git add packages/utils/
git commit -m "feat(utils): add env validation via Zod"
```

---

### Task 4.4 — `dates.ts` + `logger.ts`

**Files:**
- Create: `packages/utils/src/dates.ts`
- Create: `packages/utils/src/logger.ts`
- Create: `packages/utils/src/__tests__/dates.test.ts`
- Create: `packages/utils/src/__tests__/logger.test.ts`

- [ ] **Step 1: Add date-fns dep**

```bash
pnpm --filter @breakery/utils add date-fns@^4.1.0 date-fns-tz@^3.2.0
```

- [ ] **Step 2: `dates.ts`**

```ts
// packages/utils/src/dates.ts
import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

export const TIMEZONE = 'Asia/Makassar';

export function formatDateTimeWita(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return formatInTimeZone(date, TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

export function formatTimeWita(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return formatInTimeZone(date, TIMEZONE, 'HH:mm');
}

export function formatDateLong(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return format(date, 'MMMM d, yyyy');
}

export function todayIsoDate(): string {
  return formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd');
}
```

- [ ] **Step 3: Test dates**

```ts
// packages/utils/src/__tests__/dates.test.ts
import { describe, it, expect } from 'vitest';
import { formatDateTimeWita, formatTimeWita, formatDateLong, todayIsoDate } from '../dates';

describe('dates', () => {
  const utc = new Date('2026-05-03T10:30:00Z');  // 18:30 WITA

  it('formatDateTimeWita renders WITA', () => {
    expect(formatDateTimeWita(utc)).toBe('2026-05-03 18:30:00');
  });

  it('formatTimeWita renders HH:mm WITA', () => {
    expect(formatTimeWita(utc)).toBe('18:30');
  });

  it('formatDateLong renders Month d, yyyy', () => {
    expect(formatDateLong(utc)).toMatch(/^May \d+, 2026$/);
  });

  it('todayIsoDate returns YYYY-MM-DD', () => {
    expect(todayIsoDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 4: `logger.ts`**

```ts
// packages/utils/src/logger.ts
// Console wrapper avec hook Sentry breadcrumb (optionnel via injection).

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface BreadcrumbHook {
  (level: LogLevel, message: string, data?: Record<string, unknown>): void;
}

let breadcrumbHook: BreadcrumbHook | null = null;

export function setBreadcrumbHook(hook: BreadcrumbHook | null): void {
  breadcrumbHook = hook;
}

function emit(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  // eslint-disable-next-line no-console
  const fn = console[level === 'debug' ? 'log' : level];
  if (data !== undefined) {
    fn(`[${level}]`, message, data);
  } else {
    fn(`[${level}]`, message);
  }
  if (breadcrumbHook) breadcrumbHook(level, message, data);
}

export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => emit('debug', msg, data),
  info:  (msg: string, data?: Record<string, unknown>) => emit('info', msg, data),
  warn:  (msg: string, data?: Record<string, unknown>) => emit('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => emit('error', msg, data),
};
```

- [ ] **Step 5: Test logger**

```ts
// packages/utils/src/__tests__/logger.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger, setBreadcrumbHook } from '../logger';

describe('logger', () => {
  beforeEach(() => setBreadcrumbHook(null));

  it('calls console.log for debug', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.debug('hi');
    expect(spy).toHaveBeenCalledWith('[debug]', 'hi');
    spy.mockRestore();
  });

  it('forwards to breadcrumb hook if set', () => {
    const hook = vi.fn();
    setBreadcrumbHook(hook);
    logger.info('event', { x: 1 });
    expect(hook).toHaveBeenCalledWith('info', 'event', { x: 1 });
  });
});
```

- [ ] **Step 6: Run tests + export + commit**

```bash
pnpm --filter @breakery/utils test
```

```ts
// packages/utils/src/index.ts (append)
export * from './dates.js';
export { logger, setBreadcrumbHook } from './logger.js';
```

```bash
git add packages/utils/
git commit -m "feat(utils): add dates (WITA) and logger"
```

---

## 4B — `@breakery/domain`

### Task 4.5 — Types métier

**Files:**
- Create: `packages/domain/src/types/cart.ts`
- Create: `packages/domain/src/types/order.ts`
- Create: `packages/domain/src/types/payment.ts`
- Create: `packages/domain/src/types/product.ts`
- Create: `packages/domain/src/types/index.ts`

- [ ] **Step 1: `product.ts`**

```ts
// packages/domain/src/types/product.ts
export interface Product {
  id: string;
  sku: string;
  name: string;
  category_id: string;
  retail_price: number;
  tax_inclusive: boolean;
  image_url: string | null;
  current_stock: number;
  is_active: boolean;
  is_favorite: boolean;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  is_active: boolean;
}
```

- [ ] **Step 2: `cart.ts`**

```ts
// packages/domain/src/types/cart.ts
export type OrderType = 'dine_in' | 'take_out' | 'delivery';

export interface CartItem {
  product_id: string;
  name: string;
  unit_price: number;
  quantity: number;
}

export interface Cart {
  items: CartItem[];
  order_type: OrderType;
}

export interface CartTotals {
  subtotal: number;
  tax_amount: number;
  total: number;
  item_count: number;
}
```

- [ ] **Step 3: `payment.ts`**

```ts
// packages/domain/src/types/payment.ts
export type PaymentMethod = 'cash' | 'card' | 'qris' | 'edc' | 'transfer' | 'store_credit';

export interface PaymentInput {
  method: PaymentMethod;
  amount: number;
  cash_received?: number;
  change_given?: number;
}

export interface PaymentResult {
  ok: true;
  order_id: string;
  order_number: string;
  total: number;
  tax_amount: number;
  change_given: number | null;
}

export interface PaymentError {
  ok: false;
  error: string;
  message?: string;
}
```

- [ ] **Step 4: `order.ts`**

```ts
// packages/domain/src/types/order.ts
import type { OrderType } from './cart.js';
import type { PaymentInput } from './payment.js';

export type OrderStatus = 'draft' | 'paid' | 'voided';

export interface OrderPayload {
  session_id: string;
  order_type: OrderType;
  items: Array<{ product_id: string; quantity: number; unit_price: number }>;
  payment: PaymentInput;
}
```

- [ ] **Step 5: `types/index.ts` + package index**

```ts
// packages/domain/src/types/index.ts
export * from './cart.js';
export * from './order.js';
export * from './payment.js';
export * from './product.js';
```

```ts
// packages/domain/src/index.ts
export * from './types/index.js';
```

- [ ] **Step 6: Commit**

```bash
git add packages/domain/
git commit -m "feat(domain): add core types (Cart, Order, Payment, Product)"
```

---

### Task 4.6 — `cart/calculateTotals.ts` (TDD)

**Files:**
- Create: `packages/domain/src/cart/calculateTotals.ts`
- Create: `packages/domain/src/cart/__tests__/calculateTotals.test.ts`

- [ ] **Step 1: Test failing**

```ts
// packages/domain/src/cart/__tests__/calculateTotals.test.ts
import { describe, it, expect } from 'vitest';
import { calculateTotals } from '../calculateTotals';
import type { Cart } from '../../types/index.js';

const TAX_RATE = 0.10;

describe('calculateTotals', () => {
  it('returns zero for empty cart', () => {
    const cart: Cart = { items: [], order_type: 'dine_in' };
    expect(calculateTotals(cart, TAX_RATE)).toEqual({
      subtotal: 0,
      tax_amount: 0,
      total: 0,
      item_count: 0,
    });
  });

  it('sums one item correctly with PB1 incluse extracted', () => {
    const cart: Cart = {
      items: [{ product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1 }],
      order_type: 'dine_in',
    };
    const t = calculateTotals(cart, TAX_RATE);
    expect(t.subtotal).toBe(35000);
    expect(t.total).toBe(35000);
    // Tax extracted = 35000 * 0.1 / 1.1 = 3181.81 → rounded to 3200
    expect(t.tax_amount).toBe(3200);
    expect(t.item_count).toBe(1);
  });

  it('sums multiple items', () => {
    const cart: Cart = {
      items: [
        { product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1 },
        { product_id: 'p2', name: 'Flat White', unit_price: 45000, quantity: 1 },
      ],
      order_type: 'dine_in',
    };
    const t = calculateTotals(cart, TAX_RATE);
    expect(t.subtotal).toBe(80000);
    expect(t.total).toBe(80000);
    // 80000 * 0.1 / 1.1 = 7272.72 → 7300
    expect(t.tax_amount).toBe(7300);
    expect(t.item_count).toBe(2);
  });

  it('handles quantities > 1', () => {
    const cart: Cart = {
      items: [{ product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 3 }],
      order_type: 'dine_in',
    };
    const t = calculateTotals(cart, TAX_RATE);
    expect(t.subtotal).toBe(105000);
    expect(t.item_count).toBe(3);
  });

  it('rounds line totals individually then sums', () => {
    const cart: Cart = {
      items: [{ product_id: 'p1', name: 'Test', unit_price: 333, quantity: 3 }],
      order_type: 'dine_in',
    };
    const t = calculateTotals(cart, TAX_RATE);
    // 333 * 3 = 999 → round 1000
    expect(t.subtotal).toBe(1000);
  });
});
```

- [ ] **Step 2: Run, fail, implement**

```ts
// packages/domain/src/cart/calculateTotals.ts
import { roundIdr } from '@breakery/utils';
import type { Cart, CartTotals } from '../types/index.js';

export function calculateTotals(cart: Cart, taxRate: number): CartTotals {
  let subtotal = 0;
  let item_count = 0;
  for (const item of cart.items) {
    subtotal += roundIdr(item.unit_price * item.quantity);
    item_count += item.quantity;
  }
  const tax_amount = roundIdr((subtotal * taxRate) / (1 + taxRate));
  return { subtotal, tax_amount, total: subtotal, item_count };
}
```

- [ ] **Step 3: Add @breakery/utils to domain deps**

Edit `packages/domain/package.json` :

```json
{
  "dependencies": { "@breakery/utils": "workspace:*" }
}
```

```bash
pnpm install
```

- [ ] **Step 4: Run + export + commit**

```bash
pnpm --filter @breakery/domain test
```

```ts
// packages/domain/src/index.ts (append)
export { calculateTotals } from './cart/calculateTotals.js';
```

```bash
git add packages/domain/
git commit -m "feat(domain): add calculateTotals (subtotal + PB1 extracted)"
```

---

### Task 4.7 — `cart/mutations.ts` (addItem / updateQuantity / removeItem / clear)

**Files:**
- Create: `packages/domain/src/cart/mutations.ts`
- Create: `packages/domain/src/cart/__tests__/mutations.test.ts`

- [ ] **Step 1: Test**

```ts
// packages/domain/src/cart/__tests__/mutations.test.ts
import { describe, it, expect } from 'vitest';
import { addItem, updateQuantity, removeItem, clearCart } from '../mutations';
import type { Cart, Product } from '../../types/index.js';

const product: Product = {
  id: 'p1', sku: 'SKU', name: 'Americano', category_id: 'c1', retail_price: 35000,
  tax_inclusive: true, image_url: null, current_stock: 50, is_active: true, is_favorite: false,
};

const empty: Cart = { items: [], order_type: 'dine_in' };

describe('addItem', () => {
  it('adds new item with qty=1', () => {
    const c = addItem(empty, product);
    expect(c.items).toHaveLength(1);
    expect(c.items[0]).toMatchObject({ product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1 });
  });
  it('increments existing item quantity', () => {
    const c = addItem(addItem(empty, product), product);
    expect(c.items).toHaveLength(1);
    expect(c.items[0]?.quantity).toBe(2);
  });
  it('does not mutate input', () => {
    addItem(empty, product);
    expect(empty.items).toHaveLength(0);
  });
});

describe('updateQuantity', () => {
  it('updates qty', () => {
    const c1 = addItem(empty, product);
    const c2 = updateQuantity(c1, 'p1', 5);
    expect(c2.items[0]?.quantity).toBe(5);
  });
  it('removes item if qty <= 0', () => {
    const c1 = addItem(empty, product);
    const c2 = updateQuantity(c1, 'p1', 0);
    expect(c2.items).toHaveLength(0);
  });
  it('returns same cart if id not found', () => {
    const c1 = addItem(empty, product);
    const c2 = updateQuantity(c1, 'unknown', 5);
    expect(c2).toEqual(c1);
  });
});

describe('removeItem', () => {
  it('removes by id', () => {
    const c1 = addItem(empty, product);
    const c2 = removeItem(c1, 'p1');
    expect(c2.items).toHaveLength(0);
  });
});

describe('clearCart', () => {
  it('keeps order_type, empties items', () => {
    const c1 = addItem({ ...empty, order_type: 'take_out' }, product);
    const c2 = clearCart(c1);
    expect(c2.items).toHaveLength(0);
    expect(c2.order_type).toBe('take_out');
  });
});
```

- [ ] **Step 2: Implementation**

```ts
// packages/domain/src/cart/mutations.ts
import type { Cart, CartItem, Product } from '../types/index.js';

export function addItem(cart: Cart, product: Product, quantity = 1): Cart {
  const existing = cart.items.find((i) => i.product_id === product.id);
  if (existing) {
    return {
      ...cart,
      items: cart.items.map((i) =>
        i.product_id === product.id ? { ...i, quantity: i.quantity + quantity } : i,
      ),
    };
  }
  const newItem: CartItem = {
    product_id: product.id,
    name: product.name,
    unit_price: product.retail_price,
    quantity,
  };
  return { ...cart, items: [...cart.items, newItem] };
}

export function updateQuantity(cart: Cart, productId: string, quantity: number): Cart {
  if (quantity <= 0) return removeItem(cart, productId);
  const found = cart.items.some((i) => i.product_id === productId);
  if (!found) return cart;
  return {
    ...cart,
    items: cart.items.map((i) =>
      i.product_id === productId ? { ...i, quantity } : i,
    ),
  };
}

export function removeItem(cart: Cart, productId: string): Cart {
  return { ...cart, items: cart.items.filter((i) => i.product_id !== productId) };
}

export function clearCart(cart: Cart): Cart {
  return { ...cart, items: [] };
}

export function setOrderType(cart: Cart, orderType: Cart['order_type']): Cart {
  return { ...cart, order_type: orderType };
}
```

- [ ] **Step 3: Run + export + commit**

```bash
pnpm --filter @breakery/domain test
```

```ts
// packages/domain/src/index.ts (append)
export * from './cart/mutations.js';
```

```bash
git add packages/domain/
git commit -m "feat(domain): add cart mutations (addItem, updateQuantity, removeItem, clearCart, setOrderType)"
```

---

### Task 4.8 — `payment/calculateChange.ts` + `validatePayment.ts`

**Files:**
- Create: `packages/domain/src/payment/calculateChange.ts`
- Create: `packages/domain/src/payment/validatePayment.ts`
- Create: `packages/domain/src/payment/__tests__/calculateChange.test.ts`
- Create: `packages/domain/src/payment/__tests__/validatePayment.test.ts`

- [ ] **Step 1: Tests + impl `calculateChange`**

```ts
// packages/domain/src/payment/__tests__/calculateChange.test.ts
import { describe, it, expect } from 'vitest';
import { calculateChange } from '../calculateChange';

describe('calculateChange', () => {
  it('returns positive change', () => {
    expect(calculateChange(80000, 100000)).toBe(20000);
  });
  it('returns 0 for exact', () => {
    expect(calculateChange(80000, 80000)).toBe(0);
  });
  it('returns 0 if received less than total (clamped, with warning behavior)', () => {
    expect(calculateChange(80000, 50000)).toBe(0);
  });
});
```

```ts
// packages/domain/src/payment/calculateChange.ts
import { roundIdr } from '@breakery/utils';
export function calculateChange(total: number, received: number): number {
  return Math.max(0, roundIdr(received - total));
}
```

- [ ] **Step 2: Tests + impl `validatePayment`**

```ts
// packages/domain/src/payment/__tests__/validatePayment.test.ts
import { describe, it, expect } from 'vitest';
import { validatePayment } from '../validatePayment';
import type { PaymentInput } from '../../types/index.js';

describe('validatePayment', () => {
  it('valid cash payment', () => {
    const p: PaymentInput = { method: 'cash', amount: 80000, cash_received: 100000, change_given: 20000 };
    expect(validatePayment(p, 80000)).toEqual({ ok: true });
  });
  it('rejects amount mismatch', () => {
    const p: PaymentInput = { method: 'cash', amount: 70000, cash_received: 100000, change_given: 30000 };
    expect(validatePayment(p, 80000)).toEqual({ ok: false, error: 'amount_mismatch' });
  });
  it('rejects cash without cash_received', () => {
    const p: PaymentInput = { method: 'cash', amount: 80000 };
    expect(validatePayment(p, 80000)).toEqual({ ok: false, error: 'cash_received_required' });
  });
  it('rejects cash with insufficient cash_received', () => {
    const p: PaymentInput = { method: 'cash', amount: 80000, cash_received: 50000 };
    expect(validatePayment(p, 80000)).toEqual({ ok: false, error: 'cash_received_insufficient' });
  });
  it('valid card payment (no cash_received needed)', () => {
    const p: PaymentInput = { method: 'card', amount: 80000 };
    expect(validatePayment(p, 80000)).toEqual({ ok: true });
  });
});
```

```ts
// packages/domain/src/payment/validatePayment.ts
import type { PaymentInput } from '../types/index.js';

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: 'amount_mismatch' | 'cash_received_required' | 'cash_received_insufficient' };

export function validatePayment(payment: PaymentInput, expectedTotal: number): ValidationResult {
  if (payment.amount !== expectedTotal) {
    return { ok: false, error: 'amount_mismatch' };
  }
  if (payment.method === 'cash') {
    if (payment.cash_received === undefined) {
      return { ok: false, error: 'cash_received_required' };
    }
    if (payment.cash_received < payment.amount) {
      return { ok: false, error: 'cash_received_insufficient' };
    }
  }
  return { ok: true };
}
```

- [ ] **Step 3: Run + export + commit**

```bash
pnpm --filter @breakery/domain test
```

```ts
// packages/domain/src/index.ts (append)
export { calculateChange } from './payment/calculateChange.js';
export { validatePayment, type ValidationResult } from './payment/validatePayment.js';
```

```bash
git add packages/domain/
git commit -m "feat(domain): add calculateChange + validatePayment"
```

---

### Task 4.9 — `orders/buildOrderPayload.ts`

**Files:**
- Create: `packages/domain/src/orders/buildOrderPayload.ts`
- Create: `packages/domain/src/orders/__tests__/buildOrderPayload.test.ts`

- [ ] **Step 1: Test**

```ts
// packages/domain/src/orders/__tests__/buildOrderPayload.test.ts
import { describe, it, expect } from 'vitest';
import { buildOrderPayload } from '../buildOrderPayload';
import type { Cart, PaymentInput } from '../../types/index.js';

describe('buildOrderPayload', () => {
  it('transforms cart to RPC payload', () => {
    const cart: Cart = {
      order_type: 'dine_in',
      items: [
        { product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 2 },
      ],
    };
    const payment: PaymentInput = { method: 'cash', amount: 70000, cash_received: 100000, change_given: 30000 };
    const payload = buildOrderPayload('session-1', cart, payment);
    expect(payload).toEqual({
      session_id: 'session-1',
      order_type: 'dine_in',
      items: [{ product_id: 'p1', quantity: 2, unit_price: 35000 }],
      payment: { method: 'cash', amount: 70000, cash_received: 100000, change_given: 30000 },
    });
  });
});
```

- [ ] **Step 2: Implementation**

```ts
// packages/domain/src/orders/buildOrderPayload.ts
import type { Cart, OrderPayload, PaymentInput } from '../types/index.js';

export function buildOrderPayload(
  sessionId: string,
  cart: Cart,
  payment: PaymentInput,
): OrderPayload {
  return {
    session_id: sessionId,
    order_type: cart.order_type,
    items: cart.items.map((i) => ({
      product_id: i.product_id,
      quantity: i.quantity,
      unit_price: i.unit_price,
    })),
    payment,
  };
}
```

- [ ] **Step 3: Run + export + commit**

```ts
// packages/domain/src/index.ts (append)
export { buildOrderPayload } from './orders/buildOrderPayload.js';
```

```bash
pnpm --filter @breakery/domain test
git add packages/domain/
git commit -m "feat(domain): add buildOrderPayload"
```

---

## 4C — `@breakery/ui`

### Task 4.10 — Compléter `tokens/luxe-dark.css`

**Files:**
- Modify: `packages/ui/src/tokens/luxe-dark.css`

- [ ] **Step 1: Remplacer le contenu placeholder par les tokens complets**

Reproduire le bloc CSS complet de la spec Section 5 (`bg-base`, `bg-elevated`, `bg-overlay`, `bg-input`, borders, text, gold, green, red, blue, amber, fonts, radii, touch targets, shadows, backdrop). Coller exactement le contenu sous `:root, .dark { ... }` du spec.

- [ ] **Step 2: Compléter `tailwind-preset.ts`**

```ts
// packages/ui/tailwind-preset.ts
import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const preset: Partial<Config> = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          base: 'var(--bg-base)',
          elevated: 'var(--bg-elevated)',
          overlay: 'var(--bg-overlay)',
          input: 'var(--bg-input)',
        },
        border: {
          subtle: 'var(--border-subtle)',
          strong: 'var(--border-strong)',
          focus: 'var(--border-focus)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          disabled: 'var(--text-disabled)',
        },
        gold: {
          DEFAULT: 'var(--gold-base)',
          hover: 'var(--gold-hover)',
          pressed: 'var(--gold-pressed)',
          soft: 'var(--gold-soft)',
        },
        green: {
          DEFAULT: 'var(--green-base)',
          hover: 'var(--green-hover)',
          pressed: 'var(--green-pressed)',
        },
        red: {
          DEFAULT: 'var(--red-base)',
          soft: 'var(--red-soft)',
        },
        blue: { info: 'var(--blue-info)' },
        amber: { warn: 'var(--amber-warn)' },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        serif: ['var(--font-serif)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        modal: 'var(--shadow-modal)',
      },
      backdropBlur: { md: 'var(--backdrop-blur)' },
      spacing: {
        'touch-min': 'var(--touch-min)',
        'touch-comfy': 'var(--touch-comfy)',
        'touch-large': 'var(--touch-large)',
      },
    },
  },
  plugins: [animate],
};

export default preset;
```

- [ ] **Step 3: Vérifier que les apps prennent bien les tokens**

```bash
pnpm dev
```

Ouvrir POS http://localhost:5173, devtools → vérifier que `<body>` a bien la couleur `--bg-base`. Si dark mode pas appliqué : ajouter `class="dark"` à `<html>` dans `index.html` (déjà fait Phase 1).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/
git commit -m "feat(ui): complete Luxe Dark tokens + Tailwind preset"
```

---

### Task 4.11 — `lib/cn.ts` (utility classnames)

**Files:**
- Create: `packages/ui/src/lib/cn.ts`

- [ ] **Step 1: Code**

```ts
// packages/ui/src/lib/cn.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: Export + commit**

```ts
// packages/ui/src/index.ts (start)
export { cn } from './lib/cn.js';
```

```bash
git add packages/ui/
git commit -m "feat(ui): add cn() classname helper"
```

---

### Task 4.12 — Primitive `Button` (shadcn-vendu)

**Files:**
- Create: `packages/ui/src/primitives/Button.tsx`
- Create: `packages/ui/src/primitives/__tests__/Button.test.tsx`

- [ ] **Step 1: Test**

```tsx
// packages/ui/src/primitives/__tests__/Button.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../Button';

describe('Button', () => {
  it('renders text', () => {
    render(<Button>Click</Button>);
    expect(screen.getByRole('button', { name: 'Click' })).toBeInTheDocument();
  });
  it('applies variant classes', () => {
    render(<Button variant="primary">P</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-green');
  });
  it('disables when disabled', () => {
    render(<Button disabled>D</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
```

- [ ] **Step 2: Implementation**

```tsx
// packages/ui/src/primitives/Button.tsx
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../lib/cn.js';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
  {
    variants: {
      variant: {
        primary: 'bg-green hover:bg-green-hover text-white uppercase tracking-wide rounded-md',
        gold: 'bg-gold hover:bg-gold-hover text-bg-base uppercase tracking-wide rounded-md',
        secondary: 'bg-bg-overlay border border-border-subtle text-text-primary hover:bg-bg-input rounded-md',
        outlineGold: 'bg-transparent border border-gold text-gold hover:bg-gold-soft uppercase tracking-wide rounded-md',
        ghost: 'bg-transparent text-text-primary hover:bg-bg-overlay rounded-md',
        ghostDestructive: 'bg-transparent text-red hover:bg-red-soft rounded-md',
        link: 'text-gold underline-offset-4 hover:underline bg-transparent',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-touch-comfy px-4 text-sm',
        lg: 'h-touch-large px-6 text-base',
        icon: 'h-touch-comfy w-touch-comfy',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
```

- [ ] **Step 3: Export + run + commit**

```ts
// packages/ui/src/index.ts (append)
export { Button, buttonVariants, type ButtonProps } from './primitives/Button.js';
```

```bash
pnpm --filter @breakery/ui test
git add packages/ui/
git commit -m "feat(ui): add Button primitive (7 variants × 4 sizes)"
```

---

### Task 4.13 — Primitives shadcn restantes (Input, Dialog, Tabs, ScrollArea, Separator, Badge, Card, Toast)

Pour chaque primitive, suivre le pattern shadcn standard. Source : https://ui.shadcn.com/docs/components.

**Approche groupée pour gagner du temps :** Créer les 8 fichiers d'un coup en s'appuyant sur les sources shadcn officielles, ajuster les tokens (utilisation `bg-bg-base` au lieu de `bg-background`, `text-text-primary` au lieu de `text-foreground`).

**Files (à créer chacun avec sa version shadcn adaptée):**
- `packages/ui/src/primitives/Input.tsx`
- `packages/ui/src/primitives/Dialog.tsx`
- `packages/ui/src/primitives/Tabs.tsx`
- `packages/ui/src/primitives/ScrollArea.tsx`
- `packages/ui/src/primitives/Separator.tsx`
- `packages/ui/src/primitives/Badge.tsx`
- `packages/ui/src/primitives/Card.tsx`
- `packages/ui/src/primitives/Toast.tsx` (wrapper Sonner)

- [ ] **Step 1: Pour chaque primitive : copier le composant shadcn, remplacer tokens, adapter au nommage Luxe Dark, exporter depuis `index.ts`**

Référence shadcn https://github.com/shadcn-ui/ui/tree/main/apps/www/registry/default/ui — copier le code des 8 composants ci-dessus.

Ajustements à appliquer systématiquement :
- `bg-background` → `bg-bg-base`
- `bg-card` → `bg-bg-elevated`
- `bg-muted` → `bg-bg-overlay`
- `text-foreground` → `text-text-primary`
- `text-muted-foreground` → `text-text-secondary`
- `border` (sans qualifier) → `border-border-subtle`
- `ring-ring` → `outline-gold`

- [ ] **Step 2: Snapshot tests minimaux pour chaque (1 test par primitive)**

Exemple pour Input :

```tsx
// packages/ui/src/primitives/__tests__/Input.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from '../Input';

describe('Input', () => {
  it('renders with placeholder', () => {
    render(<Input placeholder="type" />);
    expect(screen.getByPlaceholderText('type')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Verify + commit**

```bash
pnpm --filter @breakery/ui test
git add packages/ui/src/primitives/
git commit -m "feat(ui): vendor 8 shadcn primitives (Input, Dialog, Tabs, ScrollArea, Separator, Badge, Card, Toast) adapted to Luxe Dark"
```

---

### Task 4.14 — Composant `Numpad` (touch-optimisé)

**Files:**
- Create: `packages/ui/src/components/Numpad.tsx`
- Create: `packages/ui/src/components/__tests__/Numpad.test.tsx`

- [ ] **Step 1: Test**

```tsx
// packages/ui/src/components/__tests__/Numpad.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Numpad } from '../Numpad';

describe('Numpad', () => {
  it('renders 0-9, C, backspace keys', () => {
    render(<Numpad onChange={() => {}} value="" />);
    for (let i = 0; i <= 9; i++) {
      expect(screen.getByRole('button', { name: String(i) })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Backspace' })).toBeInTheDocument();
  });

  it('digit click appends to value', () => {
    const onChange = vi.fn();
    render(<Numpad onChange={onChange} value="12" />);
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(onChange).toHaveBeenCalledWith('123');
  });

  it('backspace removes last char', () => {
    const onChange = vi.fn();
    render(<Numpad onChange={onChange} value="123" />);
    fireEvent.click(screen.getByRole('button', { name: 'Backspace' }));
    expect(onChange).toHaveBeenCalledWith('12');
  });

  it('clear empties value', () => {
    const onChange = vi.fn();
    render(<Numpad onChange={onChange} value="123" />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('respects maxLength prop', () => {
    const onChange = vi.fn();
    render(<Numpad onChange={onChange} value="123456" maxLength={6} />);
    fireEvent.click(screen.getByRole('button', { name: '7' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implementation**

```tsx
// packages/ui/src/components/Numpad.tsx
import { Delete } from 'lucide-react';
import { cn } from '../lib/cn.js';

export interface NumpadProps {
  value: string;
  onChange: (next: string) => void;
  maxLength?: number;
  className?: string;
}

const KEYS: Array<{ label: string; type: 'digit' | 'clear' | 'back' }> = [
  { label: '1', type: 'digit' }, { label: '2', type: 'digit' }, { label: '3', type: 'digit' },
  { label: '4', type: 'digit' }, { label: '5', type: 'digit' }, { label: '6', type: 'digit' },
  { label: '7', type: 'digit' }, { label: '8', type: 'digit' }, { label: '9', type: 'digit' },
  { label: 'C', type: 'clear' }, { label: '0', type: 'digit' }, { label: 'Back', type: 'back' },
];

export function Numpad({ value, onChange, maxLength, className }: NumpadProps): JSX.Element {
  function handle(key: typeof KEYS[number]) {
    if (key.type === 'clear') return onChange('');
    if (key.type === 'back') return onChange(value.slice(0, -1));
    if (maxLength && value.length >= maxLength) return;
    onChange(value + key.label);
  }

  return (
    <div className={cn('grid grid-cols-3 gap-3', className)} role="group" aria-label="Numpad">
      {KEYS.map((k) => {
        const isAction = k.type !== 'digit';
        const ariaLabel = k.type === 'clear' ? 'Clear' : k.type === 'back' ? 'Backspace' : k.label;
        return (
          <button
            key={k.label}
            type="button"
            onClick={() => handle(k)}
            aria-label={ariaLabel}
            className={cn(
              'h-touch-comfy rounded-md text-2xl font-semibold transition-colors active:scale-95',
              isAction
                ? 'bg-red-soft border border-red text-red hover:bg-red/30'
                : 'bg-bg-input border border-border-subtle text-text-primary hover:bg-bg-overlay',
            )}
          >
            {k.type === 'back' ? <Delete className="h-6 w-6" aria-hidden /> : k.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Run + export + commit**

```bash
pnpm --filter @breakery/ui test
```

```ts
// packages/ui/src/index.ts (append)
export { Numpad, type NumpadProps } from './components/Numpad.js';
```

```bash
git add packages/ui/
git commit -m "feat(ui): add Numpad component (3x4 grid, touch-optimized)"
```

---

### Task 4.15 — Composants `NumpadPin`, `Currency`, `QuantityStepper`, `OrderTypeTabs`, `FullScreenModal`

Application du même pattern (test + impl + export + commit) pour 5 composants supplémentaires.

**`NumpadPin`** : 6 dots qui se remplissent + Numpad maxLength=6, onSubmit appelé à la maxLength atteinte ou via bouton Verify.

```tsx
// packages/ui/src/components/NumpadPin.tsx (squelette)
import { useState } from 'react';
import { Numpad } from './Numpad.js';
import { Button } from '../primitives/Button.js';
import { cn } from '../lib/cn.js';

export interface NumpadPinProps {
  onSubmit: (pin: string) => void;
  maxLength?: number;
  isLoading?: boolean;
  error?: string | null;
}

export function NumpadPin({ onSubmit, maxLength = 6, isLoading, error }: NumpadPinProps): JSX.Element {
  const [pin, setPin] = useState('');
  return (
    <div className="space-y-6">
      <div className="flex justify-center gap-2" aria-label="PIN dots">
        {Array.from({ length: maxLength }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'h-3 w-3 rounded-full border border-border-strong',
              i < pin.length && 'bg-gold border-gold',
            )}
          />
        ))}
      </div>
      <Numpad value={pin} onChange={setPin} maxLength={maxLength} />
      {error && <p className="text-red text-sm text-center">{error}</p>}
      <div className="flex gap-3 justify-center">
        <Button variant="secondary" onClick={() => setPin('')}>Cancel</Button>
        <Button
          variant="gold"
          disabled={pin.length < 4 || isLoading}
          onClick={() => onSubmit(pin)}
        >
          {isLoading ? 'Verifying…' : 'Verify'}
        </Button>
      </div>
    </div>
  );
}
```

**`Currency`** : affichage formaté.

```tsx
// packages/ui/src/components/Currency.tsx
import { formatIdr } from '@breakery/utils';
import { cn } from '../lib/cn.js';

export interface CurrencyProps {
  amount: number;
  className?: string;
  emphasis?: 'normal' | 'gold' | 'large';
}

export function Currency({ amount, className, emphasis = 'normal' }: CurrencyProps): JSX.Element {
  return (
    <span className={cn(
      'font-mono tabular-nums',
      emphasis === 'gold' && 'text-gold',
      emphasis === 'large' && 'text-3xl font-semibold',
      className,
    )}>
      {formatIdr(amount)}
    </span>
  );
}
```

**`QuantityStepper`** : −/qty/+

```tsx
// packages/ui/src/components/QuantityStepper.tsx
import { Minus, Plus } from 'lucide-react';
import { cn } from '../lib/cn.js';

export interface QuantityStepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  className?: string;
}

export function QuantityStepper({ value, onChange, min = 0, max = 999, className }: QuantityStepperProps): JSX.Element {
  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <button
        type="button"
        aria-label="Decrease"
        className="h-8 w-8 rounded-md bg-bg-input border border-border-subtle hover:bg-bg-overlay disabled:opacity-50"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
      >
        <Minus className="h-4 w-4 mx-auto" aria-hidden />
      </button>
      <span className="min-w-[2rem] text-center font-mono tabular-nums">{value}</span>
      <button
        type="button"
        aria-label="Increase"
        className="h-8 w-8 rounded-md bg-bg-input border border-border-subtle hover:bg-bg-overlay disabled:opacity-50"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
      >
        <Plus className="h-4 w-4 mx-auto" aria-hidden />
      </button>
    </div>
  );
}
```

**`OrderTypeTabs`** :

```tsx
// packages/ui/src/components/OrderTypeTabs.tsx
import type { OrderType } from '@breakery/domain';
import { cn } from '../lib/cn.js';

const TYPES: Array<{ value: OrderType; label: string }> = [
  { value: 'dine_in', label: 'Dine In' },
  { value: 'take_out', label: 'Take-Out' },
  { value: 'delivery', label: 'Delivery' },
];

export interface OrderTypeTabsProps {
  value: OrderType;
  onChange: (next: OrderType) => void;
}

export function OrderTypeTabs({ value, onChange }: OrderTypeTabsProps): JSX.Element {
  return (
    <div role="tablist" className="grid grid-cols-3 gap-1 p-1 bg-bg-input rounded-md">
      {TYPES.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn(
            'h-10 rounded-sm uppercase text-xs tracking-wide font-semibold transition-colors',
            value === t.value
              ? 'bg-gold-soft text-gold border border-gold'
              : 'text-text-secondary hover:text-text-primary',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

**`FullScreenModal`** :

```tsx
// packages/ui/src/components/FullScreenModal.tsx
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '../lib/cn.js';

export interface FullScreenModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}

export function FullScreenModal({ open, onOpenChange, children, className }: FullScreenModalProps): JSX.Element {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 bg-backdrop backdrop-blur-md z-50" />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-0 bg-bg-base text-text-primary z-50 flex flex-col focus:outline-none',
            className,
          )}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const FullScreenModalClose = DialogPrimitive.Close;
```

Tests minimaux par composant (1 par composant, smoke render + interaction critique).

- [ ] **Step 1: Créer chacun des 5 composants + 1 test minimal chacun**

- [ ] **Step 2: Exporter depuis `packages/ui/src/index.ts`**

```ts
export { NumpadPin, type NumpadPinProps } from './components/NumpadPin.js';
export { Currency, type CurrencyProps } from './components/Currency.js';
export { QuantityStepper, type QuantityStepperProps } from './components/QuantityStepper.js';
export { OrderTypeTabs, type OrderTypeTabsProps } from './components/OrderTypeTabs.js';
export { FullScreenModal, FullScreenModalClose, type FullScreenModalProps } from './components/FullScreenModal.js';
```

- [ ] **Step 3: Run tests + commit**

```bash
pnpm --filter @breakery/ui test
git add packages/ui/
git commit -m "feat(ui): add NumpadPin, Currency, QuantityStepper, OrderTypeTabs, FullScreenModal"
```

---

## 4D — `@breakery/supabase`

### Task 4.16 — Générer `types.generated.ts`

- [ ] **Step 1: Démarrer Supabase + générer**

```bash
supabase start
pnpm db:types
```

Expected: `packages/supabase/src/types.generated.ts` rempli avec ~500 lignes de types pour les 14 tables + RPC.

- [ ] **Step 2: Créer `enums.ts` (source of truth pour enums utilisés en runtime)**

```ts
// packages/supabase/src/enums.ts
export const ORDER_TYPES = ['dine_in', 'take_out', 'delivery'] as const;
export const PAYMENT_METHODS = ['cash', 'card', 'qris', 'edc', 'transfer', 'store_credit'] as const;
export const SHIFT_STATUSES = ['open', 'closed'] as const;
export const ORDER_STATUSES = ['draft', 'paid', 'voided'] as const;
export const MOVEMENT_TYPES = ['sale', 'sale_void', 'production', 'purchase', 'waste', 'adjustment'] as const;
```

- [ ] **Step 3: Commit**

```bash
git add packages/supabase/src/types.generated.ts packages/supabase/src/enums.ts
git commit -m "chore(supabase): generate types from local DB + add enums"
```

---

### Task 4.17 — Client singleton

**Files:**
- Create: `packages/supabase/src/client.ts`

- [ ] **Step 1: Code**

```ts
// packages/supabase/src/client.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types.generated.js';

let _client: SupabaseClient<Database> | null = null;

export interface BreakerySupabaseConfig {
  url: string;
  anonKey: string;
}

export function getSupabaseClient(config?: BreakerySupabaseConfig): SupabaseClient<Database> {
  if (_client) return _client;
  if (!config) throw new Error('Supabase client not initialized — pass config on first call');
  _client = createClient<Database>(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: false,   // on gère via authStore
      detectSessionInUrl: false,
    },
    global: { headers: { 'x-app': 'breakery' } },
  });
  return _client;
}

export function resetSupabaseClient(): void {
  _client = null;
}
```

- [ ] **Step 2: Index export + commit**

```ts
// packages/supabase/src/index.ts
export { getSupabaseClient, resetSupabaseClient, type BreakerySupabaseConfig } from './client.js';
export type { Database } from './types.generated.js';
export * from './enums.js';
```

```bash
git add packages/supabase/
git commit -m "feat(supabase): add client singleton with Database type"
```

---

### Task 4.18 — Helpers RLS / permissions

**Files:**
- Create: `packages/supabase/src/rls/permissions.ts`

- [ ] **Step 1: Code**

```ts
// packages/supabase/src/rls/permissions.ts
// Helper côté client : vérifie une permission contre la liste retournée
// par auth-verify-pin (cachée dans authStore). Pas de roundtrip serveur.

export type PermissionCode =
  | 'pos.session.open'
  | 'pos.session.close_own'
  | 'pos.session.close_other'
  | 'pos.session.view_all'
  | 'pos.sale.create'
  | 'pos.sale.void'
  | 'pos.sale.update'
  | 'products.read'
  | 'products.create'
  | 'products.update'
  | 'users.create'
  | 'users.update'
  | 'users.view_audit';

export function hasPermission(userPermissions: readonly string[], required: PermissionCode): boolean {
  return userPermissions.includes(required);
}

export function hasAnyPermission(userPermissions: readonly string[], required: readonly PermissionCode[]): boolean {
  return required.some((r) => userPermissions.includes(r));
}
```

- [ ] **Step 2: Export + commit**

```ts
// packages/supabase/src/index.ts (append)
export { hasPermission, hasAnyPermission, type PermissionCode } from './rls/permissions.js';
```

```bash
git add packages/supabase/
git commit -m "feat(supabase): add permission helpers (hasPermission, hasAnyPermission)"
```

---

### Task 4.19 — Auth client wrappers (loginWithPin, logout, getSession, changePin)

**Files:**
- Create: `packages/supabase/src/auth/pinAuth.ts`

- [ ] **Step 1: Code**

```ts
// packages/supabase/src/auth/pinAuth.ts
// Appels typés des Edge Functions auth-*.

export interface LoginRequest {
  user_id: string;
  pin: string;
  device_type: 'pos' | 'backoffice';
}

export interface LoginResponse {
  user: { id: string; full_name: string; role_code: string; employee_code: string };
  session: { token: string; session_id: string; created_at: string };
  auth: { access_token: string; refresh_token: string; expires_at: number };
  permissions: string[];
}

export type LoginError =
  | { error: 'invalid_pin'; attempts_remaining: number }
  | { error: 'account_locked'; minutes_left: number }
  | { error: 'rate_limited'; retry_after_sec: number }
  | { error: 'user_inactive' | 'user_not_found' | 'invalid_pin_format' | 'missing_fields' | 'internal' };

export async function loginWithPin(supabaseUrl: string, body: LoginRequest): Promise<LoginResponse> {
  const res = await fetch(`${supabaseUrl}/functions/v1/auth-verify-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as LoginError;
    throw Object.assign(new Error(errBody.error ?? 'login_failed'), { details: errBody, status: res.status });
  }
  return (await res.json()) as LoginResponse;
}

export async function getSession(supabaseUrl: string, sessionToken: string): Promise<LoginResponse['user'] & { permissions: string[] }> {
  const res = await fetch(`${supabaseUrl}/functions/v1/auth-get-session`, {
    headers: { 'x-session-token': sessionToken },
  });
  if (!res.ok) throw Object.assign(new Error('session_invalid'), { status: res.status });
  const body = await res.json();
  return { ...body.user, permissions: body.permissions };
}

export async function logoutSession(supabaseUrl: string, sessionToken: string): Promise<void> {
  await fetch(`${supabaseUrl}/functions/v1/auth-logout`, {
    method: 'POST',
    headers: { 'x-session-token': sessionToken },
  });
}

export interface ChangePinRequest {
  user_id: string;
  current_pin?: string;
  new_pin: string;
}

export async function changePin(
  supabaseUrl: string,
  sessionToken: string,
  body: ChangePinRequest,
): Promise<void> {
  const res = await fetch(`${supabaseUrl}/functions/v1/auth-change-pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-session-token': sessionToken },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw Object.assign(new Error(errBody.error ?? 'change_pin_failed'), { details: errBody, status: res.status });
  }
}
```

- [ ] **Step 2: Export + commit**

```ts
// packages/supabase/src/index.ts (append)
export { loginWithPin, getSession, logoutSession, changePin } from './auth/pinAuth.js';
export type { LoginRequest, LoginResponse, LoginError, ChangePinRequest } from './auth/pinAuth.js';
```

```bash
git add packages/supabase/
git commit -m "feat(supabase): add typed PIN auth wrappers (loginWithPin, getSession, logoutSession, changePin)"
```

---

## Phase 4 — Done criteria

- [ ] `pnpm --filter @breakery/utils test` ≥ 85% coverage, tous tests passent
- [ ] `pnpm --filter @breakery/domain test` ≥ 90% coverage, tous tests passent
- [ ] `pnpm --filter @breakery/ui test` ≥ 70% coverage, tous tests passent
- [ ] `pnpm --filter @breakery/supabase test` smoke OK
- [ ] `@breakery/utils` exporte `roundIdr`, `formatIdr`, `safeStorage`, `parseAppEnv`, `dates*`, `logger`
- [ ] `@breakery/domain` exporte types + `calculateTotals` + cart mutations + `calculateChange` + `validatePayment` + `buildOrderPayload`
- [ ] `@breakery/ui` exporte 8 primitives shadcn + 6 composants domain + `cn`
- [ ] `@breakery/supabase` exporte client + types + `pinAuth` wrappers + permission helpers
- [ ] `pnpm typecheck` 0 erreur sur tout le repo
- [ ] `pnpm lint` 0 warning

**Next:** Phase 5 — App POS (`2026-05-03-breakery-05-app-pos.md`).
