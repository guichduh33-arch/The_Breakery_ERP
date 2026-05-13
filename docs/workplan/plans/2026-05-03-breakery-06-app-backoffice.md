# Phase 6 — App Backoffice (Login + Layout + Products List)

> **Trace historique** : ce fichier documente une session de travail datée. Le contenu de fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure documentaire (voir [`docs/README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Câbler l'app `@breakery/app-backoffice` minimale pour valider que les packages partagés (`@breakery/ui`, `@breakery/supabase`, `@breakery/utils`, `@breakery/domain`) fonctionnent cross-app. Login PIN, layout sidebar+topbar, page `/products` read-only listant les 8 produits seedés. Le reste est `<ComingSoon />`.

**Spec source:** `docs/workplan/specs/2026-05-03-breakery-split-2apps-design.md` section 4 (backoffice scope minimal).

**Dépend de :** Phases 2, 3, 4. Peut être réalisée en parallèle de Phase 5.

**À la fin :** Backoffice tourne sur 5174, login PIN 1234 réussit, page /backoffice/products affiche 8 produits seedés, autres routes affichent `Coming Soon`.

---

## Task 6.1 — Setup providers + Supabase + Sentry (mirror de POS)

**Files:**
- Create: `apps/backoffice/src/lib/supabase.ts`
- Create: `apps/backoffice/src/lib/sentry.ts`
- Create: `apps/backoffice/src/lib/queryClient.ts`
- Modify: `apps/backoffice/src/main.tsx`
- Modify: `apps/backoffice/src/App.tsx`

- [ ] **Step 1: Reproduire les 3 fichiers `lib/*.ts` de Phase 5 task 5.1**

Identique à POS, mais remplacer `VITE_SENTRY_DSN_POS` par `VITE_SENTRY_DSN_BACKOFFICE` dans `lib/sentry.ts`.

- [ ] **Step 2: `main.tsx`**

Copie de `apps/pos/src/main.tsx` — pareil.

- [ ] **Step 3: `App.tsx`**

Identique à POS task 5.1 step 5 (QueryClientProvider + BrowserRouter + AppRoutes + Toaster).

- [ ] **Step 4: Stub `routes/index.tsx`**

```tsx
// apps/backoffice/src/routes/index.tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from '@/pages/Login';
import DashboardPage from '@/pages/Dashboard';
import ProductsPage from '@/pages/Products';
import ComingSoonPage from '@/pages/ComingSoon';
import { BackofficeLayout } from '@/layouts/BackofficeLayout';
import { useAuthStore } from '@/stores/authStore';

function Protected({ children }: { children: React.ReactNode }) {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  return isAuth ? <>{children}</> : <Navigate to="/login" replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/backoffice" element={<Protected><BackofficeLayout /></Protected>}>
        <Route index element={<DashboardPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="inventory" element={<ComingSoonPage module="Inventory" />} />
        <Route path="purchasing" element={<ComingSoonPage module="Purchasing" />} />
        <Route path="customers" element={<ComingSoonPage module="Customers" />} />
        <Route path="b2b" element={<ComingSoonPage module="B2B" />} />
        <Route path="accounting" element={<ComingSoonPage module="Accounting" />} />
        <Route path="reports" element={<ComingSoonPage module="Reports" />} />
        <Route path="settings" element={<ComingSoonPage module="Settings" />} />
      </Route>
      <Route path="*" element={<Navigate to="/backoffice" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/backoffice/
git commit -m "feat(backoffice): wire supabase + sentry + react-query + router"
```

---

## Task 6.2 — `authStore` (mirror POS, device_type='backoffice')

**Files:**
- Create: `apps/backoffice/src/stores/authStore.ts`

- [ ] **Step 1: Code**

Copier `apps/pos/src/stores/authStore.ts` exactement, avec ces différences :
- `STORAGE_KEY = 'breakery-backoffice-auth'`
- Dans `login()` : `device_type: 'backoffice'`
- Logger: identique

```ts
// apps/backoffice/src/stores/authStore.ts
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

const STORAGE_KEY = 'breakery-backoffice-auth';

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
            device_type: 'backoffice',
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
          logger.info('login.success', { user_id: res.user.id, app: 'backoffice' });
        } catch (err: unknown) {
          const e = err as { details?: { error?: string }; message?: string };
          set({ error: e.details?.error ?? e.message ?? 'login_failed', isLoading: false });
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
          if (e.status === 401) await get().logout();
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
      partialize: (s) => ({ user: s.user, sessionToken: s.sessionToken, isAuthenticated: s.isAuthenticated }),
    },
  ),
);
```

- [ ] **Step 2: Commit**

```bash
git add apps/backoffice/src/stores/
git commit -m "feat(backoffice): add authStore (mirror of pos with backoffice device_type)"
```

---

## Task 6.3 — Login page (réutilise composants UI partagés)

**Files:**
- Create: `apps/backoffice/src/pages/Login.tsx`
- Create: `apps/backoffice/src/features/auth/UserPicker.tsx`

- [ ] **Step 1: `UserPicker.tsx`** — copie de POS, device hardcodé 2 users seedés.

```tsx
// apps/backoffice/src/features/auth/UserPicker.tsx
import { Button } from '@breakery/ui';

const SEED_USERS = [
  { id: '00000000-0000-0000-0000-000000000001', name: 'Mamat (Owner)' },
  { id: '00000000-0000-0000-0000-000000000002', name: 'Test Cashier' },
];

export interface UserPickerProps {
  onSelect: (userId: string) => void;
}

export function UserPicker({ onSelect }: UserPickerProps) {
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

- [ ] **Step 2: `Login.tsx`** — copie de POS task 5.5, adapter le titre.

```tsx
// apps/backoffice/src/pages/Login.tsx
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
      navigate('/backoffice', { replace: true });
    } catch {
      // error in store
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-bg-base p-8">
      <div className="space-y-8">
        <div className="text-center space-y-2">
          <h1 className="font-serif text-4xl">The Breakery</h1>
          <p className="text-text-secondary text-sm uppercase tracking-widest">Backoffice</p>
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

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/
git commit -m "feat(backoffice): add Login page (PIN flow, redirects to /backoffice)"
```

---

## Task 6.4 — `BackofficeLayout` (sidebar + topbar)

**Files:**
- Create: `apps/backoffice/src/layouts/BackofficeLayout.tsx`

- [ ] **Step 1: Code**

```tsx
// apps/backoffice/src/layouts/BackofficeLayout.tsx
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Package, Boxes, ShoppingCart, Users, Building2,
  Calculator, BarChart3, Settings, LogOut,
} from 'lucide-react';
import { Button, cn } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore';

const NAV = [
  { to: '/backoffice',            label: 'Dashboard',  icon: LayoutDashboard, end: true },
  { to: '/backoffice/products',   label: 'Products',   icon: Package },
  { to: '/backoffice/inventory',  label: 'Inventory',  icon: Boxes },
  { to: '/backoffice/purchasing', label: 'Purchasing', icon: ShoppingCart },
  { to: '/backoffice/customers',  label: 'Customers',  icon: Users },
  { to: '/backoffice/b2b',        label: 'B2B',        icon: Building2 },
  { to: '/backoffice/accounting', label: 'Accounting', icon: Calculator },
  { to: '/backoffice/reports',    label: 'Reports',    icon: BarChart3 },
  { to: '/backoffice/settings',   label: 'Settings',   icon: Settings },
];

export function BackofficeLayout() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="h-screen flex bg-bg-base text-text-primary">
      <aside className="w-56 bg-bg-elevated border-r border-border-subtle flex flex-col">
        <div className="px-4 py-4 border-b border-border-subtle">
          <div className="font-serif text-lg">The Breakery</div>
          <div className="text-xs text-text-secondary uppercase tracking-widest">Backoffice</div>
        </div>
        <nav className="flex-1 py-3 space-y-0.5 overflow-y-auto">
          {NAV.map((n) => {
            const Icon = n.icon;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-4 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-gold-soft text-gold border-r-2 border-gold'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-overlay',
                  )
                }
              >
                <Icon className="h-4 w-4" aria-hidden />
                {n.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="p-3 border-t border-border-subtle text-xs text-text-secondary">
          <div className="text-text-primary font-semibold">{user?.full_name}</div>
          <div>{user?.role_code}</div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-12 px-6 flex items-center justify-end border-b border-border-subtle bg-bg-elevated">
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" aria-hidden /> Logout
          </Button>
        </header>
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backoffice/src/layouts/
git commit -m "feat(backoffice): add BackofficeLayout (sidebar 9 sections + topbar)"
```

---

## Task 6.5 — Pages : Dashboard (placeholder), Products (read-only), ComingSoon

**Files:**
- Create: `apps/backoffice/src/pages/Dashboard.tsx`
- Create: `apps/backoffice/src/pages/ComingSoon.tsx`
- Create: `apps/backoffice/src/pages/Products.tsx`
- Create: `apps/backoffice/src/features/products/hooks/useProducts.ts`

- [ ] **Step 1: `ComingSoon.tsx`**

```tsx
// apps/backoffice/src/pages/ComingSoon.tsx
import { Construction } from 'lucide-react';

export interface ComingSoonProps {
  module: string;
}

export default function ComingSoonPage({ module }: ComingSoonProps) {
  return (
    <div className="h-full grid place-items-center text-text-secondary">
      <div className="text-center space-y-3">
        <Construction className="h-12 w-12 mx-auto opacity-50" aria-hidden />
        <h1 className="font-serif text-2xl text-text-primary">{module}</h1>
        <p className="text-sm">Coming soon — module en cours d'implémentation.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `Dashboard.tsx`**

```tsx
// apps/backoffice/src/pages/Dashboard.tsx
export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Dashboard</h1>
        <p className="text-text-secondary text-sm mt-1">Welcome back. KPIs and reports arrive in a future session.</p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        {['Today\'s sales', 'Orders today', 'Active sessions'].map((label) => (
          <div key={label} className="bg-bg-elevated rounded-lg border border-border-subtle p-6">
            <div className="text-xs uppercase tracking-widest text-text-secondary">{label}</div>
            <div className="font-mono text-2xl mt-2 text-text-disabled">—</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `useProducts.ts`** (réplique POS — pourrait être hoisté dans `@breakery/supabase` plus tard)

```ts
// apps/backoffice/src/features/products/hooks/useProducts.ts
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
        .is('deleted_at', null)
        .order('name');
      if (error) throw error;
      return (data ?? []) as Product[];
    },
  });
}
```

- [ ] **Step 4: `Products.tsx`** (table read-only)

```tsx
// apps/backoffice/src/pages/Products.tsx
import { Currency } from '@breakery/ui';
import { useProducts } from '@/features/products/hooks/useProducts';

export default function ProductsPage() {
  const { data: products = [], isLoading, error } = useProducts();

  if (isLoading) return <div className="text-text-secondary">Loading…</div>;
  if (error) return <div className="text-red">Failed to load products: {(error as Error).message}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-3xl">Products</h1>
        <p className="text-text-secondary text-sm mt-1">Read-only view (CRUD arrives in a future session).</p>
      </div>

      <div className="bg-bg-elevated rounded-lg border border-border-subtle overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="text-left px-4 py-3 w-32">SKU</th>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-right px-4 py-3 w-32">Price</th>
              <th className="text-right px-4 py-3 w-32">Stock</th>
              <th className="text-right px-4 py-3 w-24">Active</th>
              <th className="text-right px-4 py-3 w-24">Favorite</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id} className="border-t border-border-subtle hover:bg-bg-overlay">
                <td className="px-4 py-3 font-mono text-text-secondary">{p.sku}</td>
                <td className="px-4 py-3">{p.name}</td>
                <td className="px-4 py-3 text-right"><Currency amount={p.retail_price} emphasis="gold" /></td>
                <td className="px-4 py-3 text-right font-mono">{p.current_stock}</td>
                <td className="px-4 py-3 text-right">{p.is_active ? '✓' : '—'}</td>
                <td className="px-4 py-3 text-right">{p.is_favorite ? '★' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify**

```bash
pnpm dev
```

Aller sur http://localhost:5174 → redirige `/login` → choisir Mamat → PIN 1234 → arrivée `/backoffice` (Dashboard) → cliquer Products → tableau avec 8 lignes (Americano, Flat White, Capuccino, Sourdough Loaf, Croissant, Pain au Chocolat, American Bagel, Cheesy Brie). Cliquer Inventory / Purchasing / etc. → Coming soon.

- [ ] **Step 6: Commit**

```bash
git add apps/backoffice/src/
git commit -m "feat(backoffice): add Dashboard + Products (read-only) + ComingSoon pages"
```

---

## Task 6.6 — Smoke test

**Files:**
- Create: `apps/backoffice/src/__tests__/products-list.smoke.test.tsx`

- [ ] **Step 1: Test**

```tsx
// apps/backoffice/src/__tests__/products-list.smoke.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ProductsPage from '@/pages/Products';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        is: () => ({
          order: () => Promise.resolve({
            data: [
              { id: '1', sku: 'BEV-AMER', name: 'Americano', category_id: 'c1', retail_price: 35000, tax_inclusive: true, image_url: null, current_stock: 50, is_active: true, is_favorite: true },
            ],
            error: null,
          }),
        }),
      }),
    }),
  },
}));

function wrapper(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>;
}

describe('ProductsPage smoke', () => {
  it('renders product rows', async () => {
    render(wrapper(<ProductsPage />));
    expect(await screen.findByText('Americano')).toBeInTheDocument();
    expect(screen.getByText('BEV-AMER')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter @breakery/app-backoffice test
git add apps/backoffice/src/__tests__/
git commit -m "test(backoffice): smoke test ProductsPage renders mocked rows"
```

---

## Phase 6 — Done criteria

- [ ] `pnpm dev` ouvre Backoffice sur http://localhost:5174 → écran login
- [ ] PIN admin `1234` → page `/backoffice` (Dashboard placeholder)
- [ ] Sidebar 9 entrées cliquable, NavLink active style fonctionne
- [ ] `/backoffice/products` affiche les 8 produits seedés en table read-only avec prix gold + stock + badges
- [ ] Toutes les autres routes affichent `Coming Soon` avec icône + nom du module
- [ ] Logout (header) → retour `/login`
- [ ] PIN cashier `5678` aussi peut se connecter (mais permissions limitées — pas vérifié dans cette page)
- [ ] Smoke test ProductsPage passe
- [ ] Réutilise `@breakery/ui` (Button, NumpadPin, Currency, FullScreenModal, cn) → preuve que packages partagés fonctionnent cross-app

**Next:** Phase 7 — CI + finalisation (`2026-05-03-breakery-07-ci-finalize.md`).
