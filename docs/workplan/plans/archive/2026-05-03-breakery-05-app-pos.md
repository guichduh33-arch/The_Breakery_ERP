# Phase 5 — App POS (Auth + Shift + Cart + Payment)

> **Trace historique** : ce fichier documente une session de travail datée. Le contenu de fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure documentaire (voir [`docs/README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Câbler l'app `@breakery/app-pos` end-to-end : login PIN, open shift, écran POS (sidebar + grid + cart), payment terminal full-screen avec cash, success modal, persistance Supabase. Critères d'acceptation Section 10 du spec.

**Spec source:** `docs/workplan/specs/2026-05-03-breakery-split-2apps-design.md` sections 4, 5, 7.

**Dépend de :** Phases 2, 3, 4.

**À la fin :** parcours utilisateur complet jouable en local (login → shift → cart → checkout cash → order persisté).

---

## Task 5.1 — Setup Supabase client + Sentry init + providers

**Files:**
- Create: `apps/pos/src/lib/supabase.ts`
- Create: `apps/pos/src/lib/sentry.ts`
- Create: `apps/pos/src/lib/queryClient.ts`
- Modify: `apps/pos/src/main.tsx`
- Modify: `apps/pos/src/App.tsx`

- [ ] **Step 1: `lib/supabase.ts`**

```ts
// apps/pos/src/lib/supabase.ts
import { getSupabaseClient } from '@breakery/supabase';
import { parseAppEnv } from '@breakery/utils';

const env = parseAppEnv(import.meta.env as Record<string, string | undefined>);

export const supabase = getSupabaseClient({
  url: env.VITE_SUPABASE_URL,
  anonKey: env.VITE_SUPABASE_ANON_KEY,
});

export const supabaseUrl = env.VITE_SUPABASE_URL;
```

- [ ] **Step 2: `lib/sentry.ts`**

```ts
// apps/pos/src/lib/sentry.ts
import * as Sentry from '@sentry/react';
import { setBreadcrumbHook } from '@breakery/utils';

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN_POS;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.2,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
  });
  setBreadcrumbHook((level, message, data) => {
    Sentry.addBreadcrumb({ level, message, data });
  });
}
```

- [ ] **Step 3: `lib/queryClient.ts`**

```ts
// apps/pos/src/lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,    // 5 min
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
```

- [ ] **Step 4: Modifier `main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initSentry } from './lib/sentry';
import './index.css';

initSentry();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 5: Modifier `App.tsx` (router + providers)**

```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { queryClient } from './lib/queryClient';
import { AppRoutes } from './routes';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
        <Toaster theme="dark" position="top-right" />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 6: Stub `routes/index.tsx`**

```tsx
// apps/pos/src/routes/index.tsx
import { Routes, Route } from 'react-router-dom';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<div className="p-8">Home (placeholder)</div>} />
    </Routes>
  );
}
```

- [ ] **Step 7: Verify boot**

```bash
pnpm dev
```

POS http://localhost:5173 affiche "Home (placeholder)". OK.

- [ ] **Step 8: Commit**

```bash
git add apps/pos/
git commit -m "feat(pos): wire supabase client + sentry + react-query + router providers"
```

---

## Task 5.2 — `authStore` Zustand + safeStorage persistence

**Files:**
- Create: `apps/pos/src/stores/authStore.ts`
- Create: `apps/pos/src/stores/__tests__/authStore.test.ts`

- [ ] **Step 1: Implementation**

```ts
// apps/pos/src/stores/authStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  loginWithPin,
  getSession,
  logoutSession,
  type LoginResponse,
  type PermissionCode,
  hasPermission as has,
} from '@breakery/supabase';
import { safeStorage, logger } from '@breakery/utils';
import { supabase, supabaseUrl } from '../lib/supabase';

interface AuthUser {
  id: string;
  full_name: string;
  role_code: string;
  employee_code: string;
}

interface AuthState {
  user: AuthUser | null;
  sessionToken: string | null;
  permissions: string[];
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  login: (userId: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
  validateSession: () => Promise<void>;
  hasPermission: (code: PermissionCode) => boolean;
  setError: (msg: string | null) => void;
}

const STORAGE_KEY = 'breakery-pos-auth';

const asyncStorage = {
  getItem: (name: string) => safeStorage.get(name),
  setItem: (name: string, value: string) => safeStorage.set(name, value),
  removeItem: (name: string) => safeStorage.remove(name),
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      sessionToken: null,
      permissions: [],
      isAuthenticated: false,
      isLoading: false,
      error: null,

      async login(userId, pin) {
        set({ isLoading: true, error: null });
        try {
          const res: LoginResponse = await loginWithPin(supabaseUrl, {
            user_id: userId,
            pin,
            device_type: 'pos',
          });
          await supabase.auth.setSession({
            access_token: res.auth.access_token,
            refresh_token: res.auth.refresh_token,
          });
          set({
            user: res.user,
            sessionToken: res.session.token,
            permissions: res.permissions,
            isAuthenticated: true,
            isLoading: false,
          });
          logger.info('login.success', { user_id: res.user.id });
        } catch (err: unknown) {
          const e = err as { details?: { error?: string }; message?: string };
          set({ error: e.details?.error ?? e.message ?? 'login_failed', isLoading: false });
          logger.warn('login.failed', { reason: e.details?.error ?? e.message });
          throw err;
        }
      },

      async logout() {
        const token = get().sessionToken;
        if (token) {
          try { await logoutSession(supabaseUrl, token); } catch { /* ignore */ }
        }
        await supabase.auth.signOut().catch(() => {});
        set({ user: null, sessionToken: null, permissions: [], isAuthenticated: false, error: null });
      },

      async validateSession() {
        const token = get().sessionToken;
        if (!token) return;
        try {
          const session = await getSession(supabaseUrl, token);
          set({
            user: { id: session.id, full_name: session.full_name, role_code: session.role_code, employee_code: session.employee_code },
            permissions: session.permissions,
            isAuthenticated: true,
          });
        } catch (err: unknown) {
          const e = err as { status?: number };
          if (e.status === 401) {
            await get().logout();
          } else {
            // Network error : keep local session
            logger.warn('validateSession.transient_error');
          }
        }
      },

      hasPermission(code) {
        return has(get().permissions, code);
      },

      setError(msg) { set({ error: msg }); },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => asyncStorage),
      partialize: (state) => ({
        user: state.user,
        sessionToken: state.sessionToken,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
```

- [ ] **Step 2: Test minimal**

```ts
// apps/pos/src/stores/__tests__/authStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '../authStore';

describe('authStore initial state', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, sessionToken: null, permissions: [], isAuthenticated: false, isLoading: false, error: null });
  });

  it('is unauthenticated by default', () => {
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('hasPermission returns false when no permissions', () => {
    expect(useAuthStore.getState().hasPermission('pos.sale.create')).toBe(false);
  });

  it('hasPermission returns true when granted', () => {
    useAuthStore.setState({ permissions: ['pos.sale.create'] });
    expect(useAuthStore.getState().hasPermission('pos.sale.create')).toBe(true);
  });
});
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @breakery/app-pos test
git add apps/pos/src/
git commit -m "feat(pos): add authStore (Zustand + safeStorage persist)"
```

---

## Task 5.3 — `cartStore`, `shiftStore`, `paymentStore`

**Files:**
- Create: `apps/pos/src/stores/cartStore.ts`
- Create: `apps/pos/src/stores/shiftStore.ts`
- Create: `apps/pos/src/stores/paymentStore.ts`

- [ ] **Step 1: `cartStore.ts`**

```ts
// apps/pos/src/stores/cartStore.ts
import { create } from 'zustand';
import { addItem, removeItem, updateQuantity, clearCart, setOrderType } from '@breakery/domain';
import type { Cart, OrderType, Product } from '@breakery/domain';

interface CartState {
  cart: Cart;
  add: (product: Product) => void;
  update: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  setOrderType: (type: OrderType) => void;
}

export const useCartStore = create<CartState>((set) => ({
  cart: { items: [], order_type: 'dine_in' },
  add: (product) => set((s) => ({ cart: addItem(s.cart, product) })),
  update: (id, qty) => set((s) => ({ cart: updateQuantity(s.cart, id, qty) })),
  remove: (id) => set((s) => ({ cart: removeItem(s.cart, id) })),
  clear: () => set((s) => ({ cart: clearCart(s.cart) })),
  setOrderType: (type) => set((s) => ({ cart: setOrderType(s.cart, type) })),
}));
```

- [ ] **Step 2: `shiftStore.ts`**

```ts
// apps/pos/src/stores/shiftStore.ts
import { create } from 'zustand';

export interface ActiveShift {
  id: string;
  opened_at: string;
  opening_cash: number;
}

interface ShiftState {
  current: ActiveShift | null;
  setCurrent: (s: ActiveShift | null) => void;
  clear: () => void;
}

export const useShiftStore = create<ShiftState>((set) => ({
  current: null,
  setCurrent: (s) => set({ current: s }),
  clear: () => set({ current: null }),
}));
```

- [ ] **Step 3: `paymentStore.ts`**

```ts
// apps/pos/src/stores/paymentStore.ts
import { create } from 'zustand';
import type { PaymentMethod } from '@breakery/domain';

interface PaymentState {
  isOpen: boolean;
  selectedMethod: PaymentMethod | null;
  cashReceivedStr: string;          // string raw du numpad
  open: () => void;
  close: () => void;
  selectMethod: (m: PaymentMethod) => void;
  setCashReceivedStr: (v: string) => void;
  reset: () => void;
}

export const usePaymentStore = create<PaymentState>((set) => ({
  isOpen: false,
  selectedMethod: null,
  cashReceivedStr: '',
  open: () => set({ isOpen: true, selectedMethod: 'cash', cashReceivedStr: '' }),
  close: () => set({ isOpen: false }),
  selectMethod: (m) => set({ selectedMethod: m, cashReceivedStr: '' }),
  setCashReceivedStr: (v) => set({ cashReceivedStr: v }),
  reset: () => set({ isOpen: false, selectedMethod: null, cashReceivedStr: '' }),
}));
```

- [ ] **Step 4: Commit**

```bash
git add apps/pos/src/stores/
git commit -m "feat(pos): add cartStore, shiftStore, paymentStore (Zustand)"
```

---

## Task 5.4 — Hooks TanStack Query : `useProducts`, `useCategories`, `useShift`, `useCheckout`

**Files:**
- Create: `apps/pos/src/features/products/hooks/useProducts.ts`
- Create: `apps/pos/src/features/products/hooks/useCategories.ts`
- Create: `apps/pos/src/features/shift/hooks/useShift.ts`
- Create: `apps/pos/src/features/payment/hooks/useCheckout.ts`

- [ ] **Step 1: `useProducts.ts`**

```ts
// apps/pos/src/features/products/hooks/useProducts.ts
import { useQuery } from '@tanstack/react-query';
import type { Product } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: async (): Promise<Product[]> => {
      const { data, error } = await supabase
        .from('products')
        .select('id, sku, name, category_id, retail_price, tax_inclusive, image_url, current_stock, is_active, is_favorite')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });
}
```

- [ ] **Step 2: `useCategories.ts`**

```ts
// apps/pos/src/features/products/hooks/useCategories.ts
import { useQuery } from '@tanstack/react-query';
import type { Category } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, name, slug, sort_order, is_active')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []) as Category[];
    },
  });
}
```

- [ ] **Step 3: `useShift.ts`**

```ts
// apps/pos/src/features/shift/hooks/useShift.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore, type ActiveShift } from '@/stores/shiftStore';

export function useCurrentShift() {
  const userId = useAuthStore((s) => s.user?.id);
  const setCurrent = useShiftStore((s) => s.setCurrent);

  return useQuery({
    queryKey: ['pos_sessions', 'current', userId],
    enabled: !!userId,
    queryFn: async (): Promise<ActiveShift | null> => {
      const { data, error } = await supabase
        .from('pos_sessions')
        .select('id, opened_at, opening_cash')
        .eq('opened_by', userId)
        .eq('status', 'open')
        .maybeSingle();
      if (error) throw error;
      const shift = data as ActiveShift | null;
      setCurrent(shift);
      return shift;
    },
  });
}

export function useOpenShift() {
  const userId = useAuthStore((s) => s.user?.id);
  const queryClient = useQueryClient();
  const setCurrent = useShiftStore((s) => s.setCurrent);

  return useMutation({
    mutationFn: async (input: { opening_cash: number; opening_notes?: string }) => {
      if (!userId) throw new Error('not_authenticated');
      const { data, error } = await supabase
        .from('pos_sessions')
        .insert({ opened_by: userId, opening_cash: input.opening_cash, opening_notes: input.opening_notes ?? null })
        .select('id, opened_at, opening_cash')
        .single();
      if (error) throw error;
      return data as ActiveShift;
    },
    onSuccess: (shift) => {
      setCurrent(shift);
      void queryClient.invalidateQueries({ queryKey: ['pos_sessions'] });
    },
  });
}
```

- [ ] **Step 4: `useCheckout.ts`**

```ts
// apps/pos/src/features/payment/hooks/useCheckout.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Cart, PaymentInput, PaymentResult } from '@breakery/domain';
import { buildOrderPayload } from '@breakery/domain';
import { supabaseUrl } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';

interface CheckoutInput {
  cart: Cart;
  payment: PaymentInput;
}

export function useCheckout() {
  const sessionId = useShiftStore((s) => s.current?.id);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CheckoutInput): Promise<PaymentResult> => {
      if (!sessionId) throw new Error('no_open_shift');
      const accessToken = await getAccessToken();
      const payload = buildOrderPayload(sessionId, input.cart, input.payment);

      const res = await fetch(`${supabaseUrl}/functions/v1/process-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw Object.assign(new Error(err.error ?? 'checkout_failed'), { details: err, status: res.status });
      }
      const body = await res.json();
      return {
        ok: true,
        order_id: body.order_id,
        order_number: body.order_number,
        total: body.total,
        tax_amount: body.tax_amount,
        change_given: body.change_given,
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
}

async function getAccessToken(): Promise<string> {
  const { supabase } = await import('@/lib/supabase');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('no_auth_session');
  return session.access_token;
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/features/
git commit -m "feat(pos): add hooks (useProducts, useCategories, useShift, useCheckout)"
```

---

## Task 5.5 — Page Login (PIN)

**Files:**
- Create: `apps/pos/src/pages/Login.tsx`
- Create: `apps/pos/src/features/auth/UserPicker.tsx`

- [ ] **Step 1: `UserPicker.tsx`**

Liste les utilisateurs actifs (via Supabase, pas auth-vérifié — table user_profiles est en `auth_read` pour authenticated mais on a besoin du PIN pour s'auth. Solution : la liste est lue via service role à travers une RPC publique `list_login_users()` ou on fait un Edge Function dédié `auth-list-users`. Pour simplifier, on hardcode 2 boutons pour les 2 users seedés en v1.)

```tsx
// apps/pos/src/features/auth/UserPicker.tsx
import { Button } from '@breakery/ui';

const SEED_USERS = [
  { id: '00000000-0000-0000-0000-000000000001', name: 'Mamat (Owner)' },
  { id: '00000000-0000-0000-0000-000000000002', name: 'Test Cashier' },
];

export interface UserPickerProps {
  onSelect: (userId: string) => void;
}

export function UserPicker({ onSelect }: UserPickerProps) {
  // En v1 on liste 2 users hardcodés depuis le seed.
  // Session 2 : remplacer par une RPC list_login_users() qui retourne id+full_name.
  return (
    <div className="space-y-3 w-full max-w-xs">
      <h2 className="text-text-secondary text-sm uppercase tracking-wide text-center">Select user</h2>
      {SEED_USERS.map((u) => (
        <Button
          key={u.id}
          variant="secondary"
          size="lg"
          className="w-full"
          onClick={() => onSelect(u.id)}
        >
          {u.name}
        </Button>
      ))}
    </div>
  );
}
```

> **Note pour session 2 :** créer une RPC publique `list_login_users()` qui retourne `(id, full_name)` pour les `user_profiles is_active = true AND deleted_at IS NULL`. Mettre `SECURITY DEFINER` car la table user_profiles est en RLS authenticated.

- [ ] **Step 2: `pages/Login.tsx`**

```tsx
// apps/pos/src/pages/Login.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NumpadPin, FullScreenModal } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';
import { UserPicker } from '@/features/auth/UserPicker';

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const setError = useAuthStore((s) => s.setError);
  const isLoading = useAuthStore((s) => s.isLoading);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  async function handleSubmit(pin: string) {
    if (!selectedUserId) return;
    setError(null);
    try {
      await login(selectedUserId, pin);
      navigate('/pos', { replace: true });
    } catch {
      // error in store
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-bg-base p-8">
      <div className="space-y-8">
        <div className="text-center space-y-2">
          <h1 className="font-serif text-4xl">The Breakery</h1>
          <p className="text-text-secondary text-sm uppercase tracking-widest">POS Terminal</p>
        </div>

        {!selectedUserId ? (
          <UserPicker onSelect={setSelectedUserId} />
        ) : (
          <FullScreenModal open onOpenChange={(open) => !open && setSelectedUserId(null)}>
            <div className="m-auto bg-bg-overlay rounded-xl p-8 max-w-sm shadow-modal">
              <h2 className="font-serif text-2xl text-center mb-2">Enter PIN</h2>
              <p className="text-text-secondary text-sm text-center mb-6">4-6 digits</p>
              <NumpadPin
                onSubmit={handleSubmit}
                isLoading={isLoading}
                error={error ? friendlyError(error) : null}
              />
            </div>
          </FullScreenModal>
        )}
      </div>
    </div>
  );
}

function friendlyError(err: string): string {
  switch (err) {
    case 'invalid_pin':         return 'Wrong PIN. Try again.';
    case 'account_locked':      return 'Account locked. Try in 15 min.';
    case 'rate_limited':        return 'Too many attempts. Wait a moment.';
    case 'user_inactive':       return 'User inactive.';
    case 'user_not_found':      return 'User not found.';
    case 'invalid_pin_format':  return 'PIN must be 4-6 digits.';
    default:                    return 'Login failed.';
  }
}
```

- [ ] **Step 3: Mettre à jour `routes/index.tsx`**

```tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from '@/pages/Login';
import PosPage from '@/pages/Pos';
import { useAuthStore } from '@/stores/authStore';

function Protected({ children }: { children: React.ReactNode }) {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  return isAuth ? <>{children}</> : <Navigate to="/login" replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/pos" element={<Protected><PosPage /></Protected>} />
      <Route path="*" element={<Navigate to="/pos" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 4: Stub `pages/Pos.tsx`** temporaire

```tsx
// apps/pos/src/pages/Pos.tsx
export default function PosPage() {
  return <div className="p-8">POS placeholder (next task)</div>;
}
```

- [ ] **Step 5: Verify**

```bash
pnpm dev
```

Aller sur http://localhost:5173 → redirige vers `/login`. Choisir Mamat, entrer PIN `1234`, voir page POS placeholder. Tester PIN faux → message d'erreur.

- [ ] **Step 6: Commit**

```bash
git add apps/pos/
git commit -m "feat(pos): add Login page (PIN flow with seeded users)"
```

---

## Task 5.6 — Modal `OpenShiftModal`

**Files:**
- Create: `apps/pos/src/features/shift/OpenShiftModal.tsx`

- [ ] **Step 1: Implementation**

```tsx
// apps/pos/src/features/shift/OpenShiftModal.tsx
import { useState } from 'react';
import { Button, Currency, Numpad, FullScreenModal } from '@breakery/ui';
import { todayIsoDate, formatTimeWita } from '@breakery/utils';
import { useOpenShift } from './hooks/useShift';
import { toast } from 'sonner';

const QUICK_AMOUNTS = [100000, 200000, 300000, 500000, 1000000];

export interface OpenShiftModalProps {
  open: boolean;
}

export function OpenShiftModal({ open }: OpenShiftModalProps) {
  const [amountStr, setAmountStr] = useState('');
  const [notes, setNotes] = useState('');
  const openShift = useOpenShift();

  const amount = Number(amountStr || '0');
  const today = todayIsoDate();
  const time = formatTimeWita(new Date());

  async function handleSubmit() {
    if (amount <= 0) return;
    try {
      await openShift.mutateAsync({ opening_cash: amount, opening_notes: notes || undefined });
      toast.success('Shift opened');
    } catch (err) {
      toast.error('Failed to open shift');
      console.error(err);
    }
  }

  return (
    <FullScreenModal open={open} onOpenChange={() => { /* not closable */ }}>
      <div className="m-auto bg-bg-overlay rounded-xl p-8 max-w-md w-full shadow-modal space-y-6">
        <header className="flex items-center justify-between">
          <h2 className="font-serif text-2xl">Open Shift</h2>
          <div className="text-right text-sm">
            <div className="text-text-primary uppercase tracking-wide">{today}</div>
            <div className="text-text-secondary">{time}</div>
          </div>
        </header>

        <section className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-text-secondary">Opening Cash</label>
          <div className="bg-bg-input border-2 border-gold rounded-md px-4 py-3 text-2xl font-mono text-right tabular-nums">
            Rp {amountStr || '0'}
          </div>
          <div className="text-center">
            <Currency amount={amount} emphasis="gold" className="text-3xl" />
          </div>
        </section>

        <section className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-text-secondary">Quick Amounts</label>
          <div className="grid grid-cols-3 gap-2">
            {QUICK_AMOUNTS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setAmountStr(String(q))}
                className="bg-bg-input border border-border-subtle rounded-md py-2 text-sm hover:bg-bg-overlay"
              >
                <Currency amount={q} />
              </button>
            ))}
          </div>
        </section>

        <Numpad value={amountStr} onChange={setAmountStr} />

        <section className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-text-secondary">Notes (optional)</label>
          <textarea
            className="w-full bg-bg-input border border-border-subtle rounded-md p-3 text-sm focus:outline-none focus:border-gold"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add notes..."
          />
        </section>

        <Button
          variant="gold"
          size="lg"
          className="w-full"
          disabled={amount <= 0 || openShift.isPending}
          onClick={handleSubmit}
        >
          {openShift.isPending ? 'Opening…' : 'Open Shift'}
        </Button>
      </div>
    </FullScreenModal>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/pos/
git commit -m "feat(pos): add OpenShiftModal (numpad + quick amounts + notes)"
```

---

## Task 5.7 — Page POS (sidebar + grid + active order panel)

**Files:**
- Create: `apps/pos/src/features/products/CategorySidebar.tsx`
- Create: `apps/pos/src/features/products/ProductGrid.tsx`
- Create: `apps/pos/src/features/cart/ActiveOrderPanel.tsx`
- Create: `apps/pos/src/features/cart/CartItemRow.tsx`
- Modify: `apps/pos/src/pages/Pos.tsx`

- [ ] **Step 1: `CategorySidebar.tsx`**

```tsx
// apps/pos/src/features/products/CategorySidebar.tsx
import { Star, Package, Coffee, Croissant, Sandwich, Wheat } from 'lucide-react';
import { useCategories } from './hooks/useCategories';
import { cn } from '@breakery/ui';

const ICONS: Record<string, typeof Star> = {
  beverage: Coffee,
  bread: Wheat,
  pastry: Croissant,
  sandwiches: Sandwich,
};

export interface CategorySidebarProps {
  selectedSlug: string | 'favorites' | null;
  onSelect: (slug: string | 'favorites') => void;
}

export function CategorySidebar({ selectedSlug, onSelect }: CategorySidebarProps) {
  const { data: categories = [] } = useCategories();
  return (
    <aside className="w-20 bg-bg-elevated border-r border-border-subtle flex flex-col items-center py-4 gap-1 overflow-y-auto">
      <button
        onClick={() => onSelect('favorites')}
        className={cn(
          'w-16 py-3 flex flex-col items-center gap-1 rounded-md text-[10px] uppercase tracking-wide font-semibold',
          selectedSlug === 'favorites' ? 'bg-gold-soft text-gold' : 'text-text-secondary hover:text-text-primary',
        )}
      >
        <Star className="h-5 w-5" aria-hidden />
        Favorites
      </button>
      {categories.map((cat) => {
        const Icon = ICONS[cat.slug] ?? Package;
        const active = selectedSlug === cat.slug;
        return (
          <button
            key={cat.id}
            onClick={() => onSelect(cat.slug)}
            className={cn(
              'w-16 py-3 flex flex-col items-center gap-1 rounded-md text-[10px] uppercase tracking-wide font-semibold',
              active ? 'bg-gold-soft text-gold' : 'text-text-secondary hover:text-text-primary',
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
            {cat.name}
          </button>
        );
      })}
    </aside>
  );
}
```

- [ ] **Step 2: `ProductGrid.tsx`**

```tsx
// apps/pos/src/features/products/ProductGrid.tsx
import { Currency, cn } from '@breakery/ui';
import { Star } from 'lucide-react';
import type { Product } from '@breakery/domain';
import { useProducts } from './hooks/useProducts';
import { useCategories } from './hooks/useCategories';

export interface ProductGridProps {
  selectedSlug: string | 'favorites' | null;
  onSelect: (product: Product) => void;
}

export function ProductGrid({ selectedSlug, onSelect }: ProductGridProps) {
  const { data: products = [], isLoading } = useProducts();
  const { data: categories = [] } = useCategories();
  const selectedCat = categories.find((c) => c.slug === selectedSlug);
  const filtered = products.filter((p) => {
    if (selectedSlug === 'favorites') return p.is_favorite;
    if (!selectedCat) return true;
    return p.category_id === selectedCat.id;
  });

  if (isLoading) return <div className="p-6 text-text-secondary">Loading products…</div>;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-4 gap-4">
        {filtered.map((p) => {
          const soldOut = p.current_stock <= 0;
          return (
            <button
              key={p.id}
              onClick={() => !soldOut && onSelect(p)}
              disabled={soldOut}
              className={cn(
                'bg-bg-elevated rounded-lg overflow-hidden border border-border-subtle text-left transition-colors',
                soldOut ? 'opacity-50 cursor-not-allowed' : 'hover:border-border-strong cursor-pointer',
              )}
            >
              <div className="relative aspect-square bg-bg-input">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="object-cover w-full h-full" />
                ) : null}
                {p.is_favorite && (
                  <Star className="absolute top-2 right-2 h-4 w-4 fill-gold text-gold" aria-hidden />
                )}
                {soldOut && (
                  <div className="absolute inset-0 grid place-items-center bg-bg-base/70 text-text-muted uppercase tracking-widest text-sm">
                    Sold out
                  </div>
                )}
              </div>
              <div className="p-3 space-y-1">
                <div className="text-sm">{p.name}</div>
                <Currency amount={p.retail_price} emphasis="gold" className="text-sm" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `CartItemRow.tsx`**

```tsx
// apps/pos/src/features/cart/CartItemRow.tsx
import { Trash2 } from 'lucide-react';
import type { CartItem } from '@breakery/domain';
import { Currency, QuantityStepper, Button } from '@breakery/ui';

export interface CartItemRowProps {
  item: CartItem;
  onChangeQty: (qty: number) => void;
  onRemove: () => void;
}

export function CartItemRow({ item, onChangeQty, onRemove }: CartItemRowProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle">
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{item.name}</div>
      </div>
      <QuantityStepper value={item.quantity} onChange={onChangeQty} min={0} />
      <div className="w-24 text-right">
        <Currency amount={item.unit_price * item.quantity} emphasis="gold" className="text-sm" />
      </div>
      <Button variant="ghostDestructive" size="icon" onClick={onRemove} aria-label="Remove item">
        <Trash2 className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: `ActiveOrderPanel.tsx`**

```tsx
// apps/pos/src/features/cart/ActiveOrderPanel.tsx
import { ShoppingBag, Send, CreditCard } from 'lucide-react';
import { Button, Currency, OrderTypeTabs } from '@breakery/ui';
import { calculateTotals } from '@breakery/domain';
import { useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { CartItemRow } from './CartItemRow';

const TAX_RATE = 0.10;

export function ActiveOrderPanel() {
  const cart = useCartStore((s) => s.cart);
  const update = useCartStore((s) => s.update);
  const remove = useCartStore((s) => s.remove);
  const setOrderType = useCartStore((s) => s.setOrderType);
  const clear = useCartStore((s) => s.clear);
  const openPayment = usePaymentStore((s) => s.open);

  const totals = calculateTotals(cart, TAX_RATE);
  const isEmpty = cart.items.length === 0;

  return (
    <aside className="w-[340px] bg-bg-elevated border-l border-border-subtle flex flex-col">
      <header className="p-4 border-b border-border-subtle">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs uppercase tracking-widest font-semibold text-text-primary">Active Order</h2>
          <span className="text-xs text-text-secondary">#NEW</span>
        </div>
        <OrderTypeTabs value={cart.order_type} onChange={setOrderType} />
        <div className="mt-3 flex gap-2">
          <Button variant="outlineGold" size="sm" className="flex-1" disabled>Held Orders</Button>
          <Button variant="ghostDestructive" size="sm" onClick={clear} disabled={isEmpty}>Clear</Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="h-full grid place-items-center text-text-muted">
            <div className="text-center space-y-2">
              <ShoppingBag className="h-12 w-12 mx-auto opacity-50" aria-hidden />
              <div className="text-sm uppercase tracking-widest">Empty Bag</div>
              <div className="text-xs">Select products to begin</div>
            </div>
          </div>
        ) : (
          cart.items.map((item) => (
            <CartItemRow
              key={item.product_id}
              item={item}
              onChangeQty={(q) => update(item.product_id, q)}
              onRemove={() => remove(item.product_id)}
            />
          ))
        )}
      </div>

      {!isEmpty && (
        <footer className="p-4 border-t border-border-subtle space-y-3">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-text-secondary">Subtotal</span>
              <Currency amount={totals.subtotal} />
            </div>
            <div className="flex justify-between text-text-secondary">
              <span>Tax included (10%)</span>
              <Currency amount={totals.tax_amount} />
            </div>
            <div className="flex justify-between pt-2 border-t border-border-subtle">
              <span className="uppercase tracking-wide font-semibold">Total</span>
              <Currency amount={totals.total} emphasis="gold" className="text-lg" />
            </div>
          </div>
          <Button variant="secondary" size="lg" className="w-full" disabled>
            <Send className="h-4 w-4 mr-2" aria-hidden /> Send to Kitchen
          </Button>
          <Button variant="primary" size="lg" className="w-full" onClick={openPayment}>
            <CreditCard className="h-4 w-4 mr-2" aria-hidden /> Checkout · <Currency amount={totals.total} className="ml-1" />
          </Button>
        </footer>
      )}
    </aside>
  );
}
```

- [ ] **Step 5: `pages/Pos.tsx` complet**

```tsx
// apps/pos/src/pages/Pos.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Settings } from 'lucide-react';
import { Button } from '@breakery/ui';
import { CategorySidebar } from '@/features/products/CategorySidebar';
import { ProductGrid } from '@/features/products/ProductGrid';
import { ActiveOrderPanel } from '@/features/cart/ActiveOrderPanel';
import { OpenShiftModal } from '@/features/shift/OpenShiftModal';
import { PaymentTerminal } from '@/features/payment/PaymentTerminal';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { useCurrentShift } from '@/features/shift/hooks/useShift';

export default function PosPage() {
  const navigate = useNavigate();
  const add = useCartStore((s) => s.add);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [selectedSlug, setSelectedSlug] = useState<string | 'favorites' | null>('favorites');

  const { data: currentShift, isLoading: shiftLoading } = useCurrentShift();
  const needsShift = !shiftLoading && !currentShift;

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="h-screen flex flex-col bg-bg-base text-text-primary">
      <header className="h-12 px-4 flex items-center justify-between border-b border-border-subtle bg-bg-elevated">
        <div className="flex items-center gap-3">
          <span className="font-serif text-lg">The Breakery</span>
          <span className="text-text-secondary text-xs uppercase tracking-widest">POS</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-text-secondary text-sm">Server: <span className="text-text-primary font-semibold">{user?.full_name}</span></span>
          <Button variant="ghost" size="icon" aria-label="Settings"><Settings className="h-5 w-5" /></Button>
          <Button variant="ghost" size="icon" aria-label="Logout" onClick={handleLogout}><LogOut className="h-5 w-5" /></Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <CategorySidebar selectedSlug={selectedSlug} onSelect={setSelectedSlug} />
        <main className="flex-1 flex flex-col">
          <div className="h-12 px-6 flex items-center border-b border-border-subtle">
            <h1 className="text-text-secondary text-sm uppercase tracking-widest">
              {selectedSlug === 'favorites' ? 'Favorites' : selectedSlug ?? 'All'}
            </h1>
          </div>
          <ProductGrid selectedSlug={selectedSlug} onSelect={add} />
        </main>
        <ActiveOrderPanel />
      </div>

      <OpenShiftModal open={needsShift} />
      <PaymentTerminal />
    </div>
  );
}
```

- [ ] **Step 6: Commit (PaymentTerminal stub à venir)**

Pour que ça compile, créer un stub `PaymentTerminal.tsx` :

```tsx
// apps/pos/src/features/payment/PaymentTerminal.tsx
export function PaymentTerminal() {
  return null;
}
```

```bash
git add apps/pos/
git commit -m "feat(pos): add Pos page (sidebar + grid + active order panel + open shift gate)"
```

- [ ] **Step 7: Verify**

```bash
pnpm dev
```

Login → Open Shift modal → entrer 100,000 → Open Shift. Voir le POS, cliquer sur catégorie Beverage, cliquer sur Americano + Flat White → cart panel mis à jour avec qty stepper, totaux corrects (subtotal Rp 80,000, tax Rp 7,300, total Rp 80,000 gold). CHECKOUT button cliquable mais pas encore de modal payment (stub).

---

## Task 5.8 — `PaymentTerminal` (full-screen modal cash flow)

**Files:**
- Modify: `apps/pos/src/features/payment/PaymentTerminal.tsx`
- Create: `apps/pos/src/features/payment/SuccessModal.tsx`

- [ ] **Step 1: `SuccessModal.tsx`**

```tsx
// apps/pos/src/features/payment/SuccessModal.tsx
import { Check, Printer, RotateCw } from 'lucide-react';
import { Button, Currency, FullScreenModal } from '@breakery/ui';

export interface SuccessModalProps {
  open: boolean;
  orderNumber: string;
  total: number;
  changeGiven: number | null;
  onNewOrder: () => void;
  onPrint?: () => void;
}

export function SuccessModal({ open, orderNumber, total, changeGiven, onNewOrder, onPrint }: SuccessModalProps) {
  return (
    <FullScreenModal open={open} onOpenChange={() => { /* must click action */ }}>
      <div className="m-auto bg-bg-overlay rounded-xl p-8 max-w-md w-full shadow-modal text-center space-y-6">
        <div className="grid place-items-center">
          <div className="h-16 w-16 rounded-full bg-green-soft border-2 border-green grid place-items-center">
            <Check className="h-8 w-8 text-green" strokeWidth={3} aria-hidden />
          </div>
        </div>
        <div className="space-y-1">
          <h2 className="font-serif text-2xl">Payment successful!</h2>
          <p className="text-text-secondary text-sm">Order completed · {orderNumber}</p>
        </div>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Total</span>
            <Currency amount={total} emphasis="gold" />
          </div>
          {changeGiven !== null && changeGiven > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Change</span>
              <Currency amount={changeGiven} emphasis="gold" />
            </div>
          )}
        </div>
        <div className="flex gap-3">
          {onPrint && (
            <Button variant="secondary" size="lg" className="flex-1" onClick={onPrint}>
              <Printer className="h-4 w-4 mr-2" aria-hidden /> Print
            </Button>
          )}
          <Button variant="gold" size="lg" className="flex-1" onClick={onNewOrder}>
            <RotateCw className="h-4 w-4 mr-2" aria-hidden /> New Order
          </Button>
        </div>
      </div>
    </FullScreenModal>
  );
}
```

- [ ] **Step 2: `PaymentTerminal.tsx` complet**

```tsx
// apps/pos/src/features/payment/PaymentTerminal.tsx
import { useState } from 'react';
import { X, ArrowLeft, Banknote, CreditCard, QrCode, Smartphone, ArrowRightLeft, Wallet, Users } from 'lucide-react';
import { Button, Currency, FullScreenModal, Numpad, cn } from '@breakery/ui';
import { calculateTotals, calculateChange, type PaymentMethod } from '@breakery/domain';
import { useCartStore } from '@/stores/cartStore';
import { usePaymentStore } from '@/stores/paymentStore';
import { useAuthStore } from '@/stores/authStore';
import { useCheckout } from './hooks/useCheckout';
import { SuccessModal } from './SuccessModal';
import { toast } from 'sonner';

const TAX_RATE = 0.10;

const METHODS: Array<{ value: PaymentMethod; label: string; icon: typeof Banknote }> = [
  { value: 'cash',         label: 'Cash',         icon: Banknote },
  { value: 'card',         label: 'Card',         icon: CreditCard },
  { value: 'qris',         label: 'QRIS',         icon: QrCode },
  { value: 'edc',          label: 'EDC',          icon: Smartphone },
  { value: 'transfer',     label: 'Transfer',     icon: ArrowRightLeft },
  { value: 'store_credit', label: 'Store Credit', icon: Wallet },
];

const QUICK_AMOUNTS = [50000, 100000, 150000, 200000, 500000];

export function PaymentTerminal() {
  const isOpen = usePaymentStore((s) => s.isOpen);
  const close = usePaymentStore((s) => s.close);
  const reset = usePaymentStore((s) => s.reset);
  const selectedMethod = usePaymentStore((s) => s.selectedMethod);
  const selectMethod = usePaymentStore((s) => s.selectMethod);
  const cashReceivedStr = usePaymentStore((s) => s.cashReceivedStr);
  const setCashReceivedStr = usePaymentStore((s) => s.setCashReceivedStr);

  const cart = useCartStore((s) => s.cart);
  const clearCartAction = useCartStore((s) => s.clear);
  const user = useAuthStore((s) => s.user);
  const checkout = useCheckout();

  const totals = calculateTotals(cart, TAX_RATE);
  const cashReceived = Number(cashReceivedStr || '0');
  const changeGiven = calculateChange(totals.total, cashReceived);

  const [success, setSuccess] = useState<{ orderNumber: string; total: number; changeGiven: number | null } | null>(null);

  const canProcess = (() => {
    if (selectedMethod === 'cash') return cashReceived >= totals.total;
    if (selectedMethod === null) return false;
    return true;
  })();

  async function handleProcess() {
    if (!selectedMethod || !canProcess) return;
    try {
      const result = await checkout.mutateAsync({
        cart,
        payment: {
          method: selectedMethod,
          amount: totals.total,
          cash_received: selectedMethod === 'cash' ? cashReceived : undefined,
          change_given: selectedMethod === 'cash' ? changeGiven : undefined,
        },
      });
      setSuccess({ orderNumber: result.order_number, total: result.total, changeGiven: result.change_given });
    } catch (err: unknown) {
      const e = err as { details?: { error?: string } };
      toast.error(`Payment failed: ${e.details?.error ?? 'unknown'}`);
    }
  }

  function handleNewOrder() {
    setSuccess(null);
    clearCartAction();
    reset();
  }

  if (success) {
    return (
      <SuccessModal
        open
        orderNumber={success.orderNumber}
        total={success.total}
        changeGiven={success.changeGiven}
        onNewOrder={handleNewOrder}
      />
    );
  }

  return (
    <FullScreenModal open={isOpen} onOpenChange={close}>
      <header className="h-14 flex items-center justify-between px-6 border-b border-border-subtle bg-bg-elevated">
        <div className="flex items-center gap-3">
          <span className="font-serif text-lg">The Breakery</span>
          <span className="text-text-secondary text-xs uppercase tracking-widest">Terminal</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-text-secondary text-sm">Server: <span className="text-text-primary font-semibold">{user?.full_name}</span></span>
          <Button variant="ghost" size="sm" onClick={close}>
            <ArrowLeft className="h-4 w-4 mr-2" aria-hidden /> Back to Cart
          </Button>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={close}>
            <X className="h-5 w-5" aria-hidden />
          </Button>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-2 gap-px bg-border-subtle overflow-hidden">
        {/* LEFT — order summary */}
        <section className="bg-bg-base p-6 overflow-y-auto">
          <h3 className="text-xs uppercase tracking-widest text-text-primary mb-4">Current Order</h3>
          <table className="w-full text-sm">
            <thead className="text-text-secondary text-xs uppercase tracking-wide border-b border-border-subtle">
              <tr>
                <th className="text-left py-2">Item</th>
                <th className="text-right py-2 w-12">Qty</th>
                <th className="text-right py-2 w-24">Price</th>
              </tr>
            </thead>
            <tbody>
              {cart.items.map((it) => (
                <tr key={it.product_id} className="border-b border-border-subtle">
                  <td className="py-3">{it.name}</td>
                  <td className="text-right py-3">{it.quantity}</td>
                  <td className="text-right py-3"><Currency amount={it.unit_price * it.quantity} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-6 space-y-1 text-sm">
            <div className="flex justify-between text-text-secondary">
              <span>Subtotal</span><Currency amount={totals.subtotal} />
            </div>
            <div className="flex justify-between text-text-secondary">
              <span>Tax (incl.)</span><Currency amount={totals.tax_amount} />
            </div>
            <div className="flex justify-between pt-3 border-t border-border-subtle">
              <span className="uppercase tracking-wide font-semibold">Total Amount</span>
              <Currency amount={totals.total} emphasis="gold" className="text-lg" />
            </div>
          </div>
        </section>

        {/* RIGHT — payment controls */}
        <section className="bg-bg-base p-6 overflow-y-auto">
          <div className="space-y-1 mb-6">
            <div className="text-xs uppercase tracking-widest text-text-secondary">Total Amount</div>
            <Currency amount={totals.total} emphasis="gold" className="text-4xl block" />
            <div className="text-xs text-text-secondary">
              Remaining: <Currency amount={Math.max(0, totals.total - cashReceived)} className="text-text-primary" />
            </div>
          </div>

          {selectedMethod === 'cash' && cashReceived >= totals.total && (
            <Button variant="primary" size="lg" className="w-full mb-4" onClick={handleProcess} disabled={checkout.isPending}>
              {checkout.isPending ? 'Processing…' : `Cash Exact — ${formatLabel(totals.total)}`}
            </Button>
          )}

          <div className="text-xs uppercase tracking-widest text-text-secondary mb-2">Select Payment Method</div>
          <div className="grid grid-cols-3 gap-3 mb-6">
            {METHODS.map((m) => {
              const Icon = m.icon;
              const active = selectedMethod === m.value;
              return (
                <button
                  key={m.value}
                  onClick={() => selectMethod(m.value)}
                  className={cn(
                    'h-24 rounded-md border flex flex-col items-center justify-center gap-1 transition-colors',
                    active ? 'border-gold bg-gold-soft text-gold' : 'border-border-subtle bg-bg-input text-text-secondary hover:text-text-primary',
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                  <span className="text-xs uppercase tracking-wide font-semibold">{m.label}</span>
                </button>
              );
            })}
          </div>

          {selectedMethod === 'cash' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs uppercase tracking-widest text-text-secondary mb-2">Enter Amount</div>
                  <div className="bg-bg-input border-2 border-gold rounded-md p-4 text-center">
                    <span className="text-2xl font-mono">Rp {cashReceivedStr || '0'}</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-text-secondary mb-2">Cash Received</div>
                  <div className="bg-bg-input border border-border-subtle rounded-md p-4 text-right">
                    <Currency amount={cashReceived} emphasis="gold" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs uppercase tracking-widest text-text-secondary mb-2">Amount Received</div>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => setCashReceivedStr(String(totals.total))}
                      className={cn(
                        'rounded-md py-3 text-sm border',
                        cashReceived === totals.total
                          ? 'bg-gold text-bg-base border-gold'
                          : 'bg-bg-input border-border-subtle hover:bg-bg-overlay',
                      )}
                    >
                      Exact ({formatLabel(totals.total)})
                    </button>
                    {QUICK_AMOUNTS.filter((q) => q >= totals.total).slice(0, 5).map((q) => (
                      <button
                        key={q}
                        onClick={() => setCashReceivedStr(String(q))}
                        className="rounded-md py-3 text-sm bg-bg-input border border-border-subtle hover:bg-bg-overlay"
                      >
                        {formatLabel(q)}
                      </button>
                    ))}
                  </div>
                </div>
                <Numpad value={cashReceivedStr} onChange={setCashReceivedStr} />
              </div>
            </div>
          )}
        </section>
      </div>

      <footer className="h-16 flex items-center justify-between px-6 border-t border-border-subtle bg-bg-elevated">
        <Button variant="secondary" onClick={close}>Cancel</Button>
        <Button
          variant="primary"
          size="lg"
          disabled={!canProcess || checkout.isPending}
          onClick={handleProcess}
        >
          {checkout.isPending ? 'Processing…' : '✓ Process Payment'}
        </Button>
      </footer>
    </FullScreenModal>
  );
}

function formatLabel(amount: number): string {
  return `Rp ${amount.toLocaleString('en-US')}`;
}
```

- [ ] **Step 3: Verify end-to-end**

```bash
pnpm dev
```

1. Login Mamat / 1234
2. Open Shift opening_cash 100000 → Open Shift
3. Tap Beverage → Americano + Flat White → cart 80,000
4. Tap CHECKOUT → terminal apparaît
5. Tap CASH → numpad apparaît
6. Tap "Exact (Rp 80,000)" → green button "Cash Exact — Rp 80,000" apparaît + change = 0
7. Tap PROCESS PAYMENT → Success modal "Payment successful! Order #0001"
8. Studio Supabase → vérifier `orders`, `order_items`, `order_payments`, `stock_movements`, `audit_logs`
9. Tap NEW ORDER → cart cleared, retour POS

- [ ] **Step 4: Commit**

```bash
git add apps/pos/
git commit -m "feat(pos): add PaymentTerminal + SuccessModal (cash flow end-to-end)"
```

---

## Task 5.9 — Smoke test golden path

**Files:**
- Create: `apps/pos/src/__tests__/golden-path.smoke.test.tsx`

- [ ] **Step 1: Test**

```tsx
// apps/pos/src/__tests__/golden-path.smoke.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useCartStore } from '@/stores/cartStore';
import { ActiveOrderPanel } from '@/features/cart/ActiveOrderPanel';

function wrapper(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

describe('ActiveOrderPanel smoke', () => {
  beforeEach(() => {
    useCartStore.setState({ cart: { items: [], order_type: 'dine_in' } });
  });

  it('shows EMPTY BAG when cart empty', () => {
    render(wrapper(<ActiveOrderPanel />));
    expect(screen.getByText(/empty bag/i)).toBeInTheDocument();
  });

  it('shows totals when items added', () => {
    useCartStore.setState({
      cart: {
        items: [
          { product_id: 'p1', name: 'Americano', unit_price: 35000, quantity: 1 },
          { product_id: 'p2', name: 'Flat White', unit_price: 45000, quantity: 1 },
        ],
        order_type: 'dine_in',
      },
    });
    render(wrapper(<ActiveOrderPanel />));
    expect(screen.getByText(/total/i)).toBeInTheDocument();
    expect(screen.getByText(/Rp 80,000/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter @breakery/app-pos test
git add apps/pos/src/__tests__/
git commit -m "test(pos): add smoke test for ActiveOrderPanel golden path"
```

---

## Phase 5 — Done criteria

- [ ] `pnpm dev` ouvre POS sur http://localhost:5173 → écran login PIN
- [ ] PIN admin `1234` → page POS, modal Open Shift apparaît si pas de shift actif
- [ ] Open Shift opening_cash 100,000 + notes optionnelles → shift créé en DB, modal disparaît
- [ ] Sidebar catégories cliquable, filtre la grid
- [ ] Tap produit → ajout au cart, qty stepper +/− fonctionne
- [ ] Switch DINE IN / TAKE-OUT / DELIVERY met à jour `cart.order_type`
- [ ] Tap CLEAR vide le cart
- [ ] Totaux PB1 corrects (Americano + Flat White = Rp 80,000, tax Rp 7,300 visible)
- [ ] Tap CHECKOUT → payment terminal full-screen
- [ ] Tap CASH → numpad + quick amounts apparaissent
- [ ] Tap "Exact" → green button "Cash Exact — Rp 80,000" apparaît
- [ ] Tap PROCESS PAYMENT → success modal "Payment successful! Order #XXXX"
- [ ] DB : `orders` + `order_items` + `order_payments` + `stock_movements` + `audit_logs` créés, `products.current_stock` baissé
- [ ] Tap NEW ORDER → cart cleared, retour POS pour ordre suivant
- [ ] Logout (icône header) → retour /login
- [ ] Smoke test ActiveOrderPanel passe

**Next:** Phase 6 — App Backoffice (`2026-05-03-breakery-06-app-backoffice.md`).
