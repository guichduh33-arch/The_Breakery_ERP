# The Breakery — Split 2-Apps Design Spec

> **Trace historique** : ce fichier documente une session de travail datée. Le contenu de fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure documentaire (voir [`docs/README.md`](../../../README.md)).
> **Last refreshed** : 2026-05-13

> **Date** : 2026-05-03
> **Auteur** : guichduh33@gmail.com (via session brainstorming)
> **Statut** : Approuvé pour implémentation
> **Cible** : reconstruction propre de l'ERP/POS de The Breakery, en monorepo Turborepo + 2 apps spécialisées par persona, livré incrémentalement par sessions de swarm Ruflo.

---

## 0. Contexte

The Breakery est une boulangerie artisanale française à Lombok (Indonésie). L'ERP V2 (AppGrav) est un monolith React/Vite/Supabase de 248 composants, 364 pages, 166 hooks, 101 services, 14 stores et 223 migrations SQL — **jamais déployé en production**, conservé comme référence métier théorique. Une reconstruction V3 est documentée dans `breakery-platform/` (Turborepo, 4 micro-apps).

Cette spec définit une **voie médiane** : split monolith V2 en **2 apps** (`pos`, `backoffice`) plutôt que 4. Capture 80% du bénéfice de la séparation par persona pour 20% de la complexité, adapté au volume cible (~200 tx/jour, ~20 utilisateurs, 4-6 devices LAN — chiffres aspirationnels, V2 n'ayant pas atteint la production).

Le projet est livré en sessions :
- **Session 1 (cette spec)** : bootstrap monorepo + premier vertical POS end-to-end (cart → cash → order persisté).
- **Sessions 2+** : modules suivants (modifiers, KDS, B2B, accounting, reports, etc.) chacun avec sa propre spec.

## 1. Décisions actées

| # | Décision | Choix |
|---|---|---|
| Architecture | Split en 2 apps (vs monolith ou 4 apps V3) | **2 apps** : `pos` (caisse + KDS + display + tablette) et `backoffice` (manager + comptable + reports) |
| Premier livrable | Bootstrap + 1 module POS vertical end-to-end | Module **POS Cart + Cash + Order** avec auth PIN, open shift, RLS, stock decrement |
| Build orchestrator | Turborepo vs pnpm seul vs npm | **Turborepo 2.x + pnpm 9 workspaces** |
| Backend cette session | Cloud frais vs cloner V2 vs local | **Local Supabase CLI** d'abord, projet cloud en session de déploiement |
| Mobile | Capacitor maintenant vs jamais vs ready | **Web/PWA-only avec patterns Capacitor-ready** (`safeStorage`, etc.) |

## 2. Stack technique

### Frontend
- React 18.2 + TypeScript 5.3 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- Vite 5
- Tailwind CSS 3.4 + tailwindcss-animate
- shadcn/ui (vendu dans `packages/ui`) sur Radix UI primitives
- Zustand 4 (state global)
- TanStack Query 5 (data fetching/cache Supabase)
- React Router DOM 6 (SPA routing)
- Lucide React (icônes)
- Sonner (toasts)
- Recharts 3 (graphiques backoffice — sessions futures)
- @dnd-kit (drag-drop — sessions futures pour KDS)
- vite-plugin-pwa (sur `apps/pos` uniquement)
- @sentry/react 10 (DSN par app)
- Fonts : `@fontsource-variable/inter`, `@fontsource-variable/fraunces`, `@fontsource-variable/jetbrains-mono`

### Backend
- Supabase (Postgres 15, Auth, Realtime, Storage, Edge Functions Deno)
- Supabase CLI 2.x (migrations + types gen + local dev)
- pgcrypto (bcrypt PIN, gen_random_uuid)
- Pas de pgvector / pg_cron en v1

### Mobile
- Pas de Capacitor en session 1 (web/PWA only)
- Code écrit Capacitor-ready : pas de `localStorage` direct, pas de `window.open`, pas d'iframe

### Tests
- Vitest 2 + @vitest/coverage-v8
- @testing-library/react 16 + jsdom
- pgTAP pour tests RPC SQL
- Pas de Playwright/Cypress en session 1 (sessions 3+)

### Lint / format / build
- ESLint 8 flat config + typescript-eslint 8 (seuil **0 warnings**)
- Prettier 3
- pnpm 9
- Turborepo 2.x

### Hosting
- Vercel : 2 projets séparés (`the-breakery-pos`, `the-breakery-backoffice`)
- Supabase cloud : projet dédié provisionné après validation locale

### Engines
- Node.js ≥ 22.12.0
- pnpm ≥ 9.0
- Deno (fourni par Supabase Edge runtime)

---

## 3. Architecture monorepo

### Structure complète

```
the-breakery/
├── apps/
│   ├── pos/                          # SPA tactile — caisse, KDS, display, tablette serveur
│   │   ├── src/
│   │   │   ├── main.tsx · App.tsx · index.css
│   │   │   ├── pages/                # Login, Pos
│   │   │   ├── routes/               # posRoutes.tsx
│   │   │   ├── features/             # auth, shift, cart, payment, products
│   │   │   ├── stores/               # cartStore, shiftStore, authStore, paymentStore
│   │   │   └── lib/                  # supabase client, sentry init
│   │   ├── public/                   # PWA icons, manifest
│   │   ├── index.html
│   │   ├── vite.config.ts            # vite + PWA plugin + sentry plugin
│   │   ├── tailwind.config.ts        # consume @breakery/ui preset
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── backoffice/                   # SPA desktop — manager, comptable, reports (sessions 2+)
│       ├── src/
│       │   ├── main.tsx · App.tsx · index.css
│       │   ├── pages/                # Login, Products (read-only en v1), ComingSoon
│       │   ├── routes/               # backofficeRoutes.tsx
│       │   ├── features/             # auth, products
│       │   ├── stores/               # authStore
│       │   └── lib/
│       ├── public/
│       ├── index.html
│       ├── vite.config.ts            # vite + sentry (pas de PWA)
│       ├── tailwind.config.ts
│       ├── tsconfig.json
│       └── package.json
│
├── packages/
│   ├── ui/                           # Composants partagés Luxe Dark
│   │   ├── src/
│   │   │   ├── primitives/           # shadcn (Button, Dialog, Input, Tabs, Toast, ScrollArea, Separator, Badge, Card)
│   │   │   ├── components/           # Numpad, NumpadPin, Currency, QuantityStepper, OrderTypeTabs, EmptyState, ComingSoon
│   │   │   ├── tokens/               # luxe-dark.css
│   │   │   ├── icons/                # ré-export Lucide curé
│   │   │   └── index.ts
│   │   ├── tailwind-preset.ts        # consommé par les apps
│   │   ├── package.json              # exports: ./*, ./tailwind-preset, ./tokens.css
│   │   └── tsconfig.json
│   │
│   ├── supabase/                     # Couche d'accès Supabase
│   │   ├── src/
│   │   │   ├── client.ts             # createClient + singleton
│   │   │   ├── types.generated.ts    # `supabase gen types typescript`
│   │   │   ├── enums.ts              # source of truth enums
│   │   │   ├── auth/                 # PIN flow client wrappers
│   │   │   └── rls/                  # helpers (hasPermission, requireRole)
│   │   ├── migrations/               # symlink vers ../../supabase/migrations
│   │   └── package.json
│   │
│   ├── domain/                       # Logique métier pure (zéro dep React/Supabase)
│   │   ├── src/
│   │   │   ├── cart/                 # calculateTotals, addItem, removeItem, updateQuantity
│   │   │   ├── pricing/              # tier pricing (en v1: retail uniquement)
│   │   │   ├── orders/               # buildOrderPayload, status transitions
│   │   │   ├── payment/              # calculateChange, validatePayment
│   │   │   ├── idr/                  # round_idr, formatIDR
│   │   │   └── types/                # Cart, Order, Product, Payment, Shift
│   │   └── package.json              # zéro dep runtime
│   │
│   └── utils/                        # Plomberie partagée
│       ├── src/
│       │   ├── safeStorage.ts        # localStorage wrappé Capacitor-ready
│       │   ├── env.ts                # validation Zod env vars
│       │   ├── result.ts             # Result<T,E> type
│       │   ├── dates.ts              # wrappers date-fns (timezone Asia/Makassar)
│       │   └── logger.ts             # console wrapper (Sentry breadcrumb)
│       └── package.json
│
├── supabase/                         # Backend partagé
│   ├── migrations/                   # 9 fichiers init
│   │   ├── 20260503000000_init_extensions_enums.sql
│   │   ├── 20260503000001_init_auth.sql
│   │   ├── 20260503000002_init_catalog.sql
│   │   ├── 20260503000003_init_pos.sql
│   │   ├── 20260503000004_init_inventory.sql
│   │   ├── 20260503000005_init_settings.sql
│   │   ├── 20260503000006_init_helpers.sql
│   │   ├── 20260503000007_init_rls.sql
│   │   └── 20260503000008_init_complete_order_rpc.sql
│   ├── seed.sql
│   ├── functions/                    # Edge Functions Deno
│   │   ├── _shared/
│   │   │   ├── session-auth.ts       # middleware x-session-token
│   │   │   ├── rate-limit.ts         # in-memory LRU
│   │   │   └── cors.ts
│   │   ├── auth-verify-pin/
│   │   ├── auth-get-session/
│   │   ├── auth-logout/
│   │   ├── auth-change-pin/
│   │   └── process-payment/
│   ├── tests/
│   │   ├── rpc/complete_order_with_payment.test.ts
│   │   └── functions/{auth-verify-pin,process-payment}.test.ts
│   └── config.toml
│
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-05-03-breakery-split-2apps-design.md   # ce document
│
├── .github/workflows/
│   └── ci.yml                        # lint + typecheck + test + build via Turborepo
│
├── .claude/                          # Settings + hooks Ruflo (déjà présent, à enrichir)
├── turbo.json                        # pipeline build/dev/lint/test/typecheck
├── pnpm-workspace.yaml               # apps/* + packages/*
├── pnpm-lock.yaml
├── package.json                      # racine — scripts turbo
├── tsconfig.base.json                # config TS partagée
├── .prettierrc + .prettierignore
├── .eslintrc.cjs                     # racine, étendu par apps/packages
├── .gitignore
├── .env.example
└── README.md
```

### Frontières strictes (ESLint `import/no-restricted-paths`)

- `packages/domain` : pure TypeScript, **interdit** d'importer React, Supabase, jsdom, ou tout package non-Node.
- `packages/ui` : peut importer React + Radix + Lucide. **Interdit** d'importer `@breakery/supabase` ou `@breakery/domain`.
- `packages/supabase` : peut importer types de `@breakery/domain`. **Interdit** d'importer React.
- `packages/utils` : pure TypeScript.
- `apps/*` : peuvent tout importer.

### Pipeline Turborepo

```jsonc
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": [".env"],
  "tasks": {
    "build":     { "dependsOn": ["^build"], "outputs": ["dist/**", ".vite/**"] },
    "dev":       { "cache": false, "persistent": true },
    "lint":      { "dependsOn": ["^build"] },
    "typecheck": { "dependsOn": ["^build"] },
    "test":      { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "test:watch": { "cache": false, "persistent": true }
  }
}
```

Scripts racine :
```json
{
  "scripts": {
    "dev": "turbo run dev --parallel",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "test:watch": "turbo run test:watch --parallel",
    "db:reset": "supabase db reset",
    "db:types": "supabase gen types typescript --local > packages/supabase/src/types.generated.ts"
  }
}
```

---

## 4. Scope du premier vertical POS

### Objectif livrable session 1

> Un caissier peut ouvrir sa session, ajouter des produits au panier, encaisser en cash, et l'order est persisté en DB avec impact stock.

### Parcours utilisateur (happy path)

1. Ouvrir `apps/pos` → écran login PIN
2. Saisir PIN 4 chiffres → vérification Edge Function `auth-verify-pin`
3. Si pas de shift ouvert → modal `OPEN SHIFT` : opening cash via numpad → shift créé
4. Arrivée écran POS : sidebar catégories | grid produits | active order panel
5. Sélectionner catégorie → grid filtré
6. Tap produit → ajouté au cart (qty=1, sans modifier en v1)
7. +/-/× → ajuster qty, supprimer
8. Choisir DINE IN / TAKE-OUT / DELIVERY (default DINE IN)
9. Tap CHECKOUT → ouvre payment terminal full-screen
10. Tap CASH → numpad + quick amounts
11. Tap "Exact" ou saisir → CASH RECEIVED rempli
12. Tap PROCESS PAYMENT → RPC transactionnel insère order + items + payment + stock_movements + audit_log
13. Affiche success modal "Payment successful! Order #XXXX" + change
14. Tap NEW ORDER → cart cleared

### Écrans à livrer

| # | Route | Fichier | Source UX-reference |
|---|---|---|---|
| 1 | `/login` | `apps/pos/src/pages/Login.tsx` | (custom, pas de screen — logo + PIN dots + numpad) |
| 2 | modal sur `/pos` | `apps/pos/src/features/shift/OpenShiftModal.tsx` | `12-shift-open-cash-modal-numpad.jpg`, `13-shift-open-cash-modal-filled.jpg` |
| 3 | `/pos` | `apps/pos/src/pages/Pos.tsx` | `01-grid-bagel-empty-cart-dine-in.jpg`, `30-cart-active-2items-dine-in-totals.jpg` |
| 4 | modal full-screen | `apps/pos/src/features/payment/PaymentTerminal.tsx` | `60-payment-terminal-method-selection.jpg`, `61-payment-terminal-cash-entry-numpad.jpg`, `62-payment-terminal-payment-added-success.jpg`, `63-payment-success-modal.jpg` |

### Composants `packages/ui` à créer

**Primitives shadcn vendues** : Button, Input, Dialog, Tabs, Toast (Sonner), ScrollArea, Separator, Badge, Card.

**Domain-spécifiques** : Numpad, NumpadPin, Currency (display IDR formaté), QuantityStepper, OrderTypeTabs, FullScreenModal, ModalCard, EmptyState, ComingSoon.

### Logique `packages/domain`

- `cart/calculateTotals.ts` — subtotal, tax PB1 (10% incluse extraite), total, round_idr
- `cart/addItem.ts`, `removeItem.ts`, `updateQuantity.ts` — pure functions sur `Cart`
- `payment/calculateChange.ts` — `received - total`
- `payment/validatePayment.ts` — checks (montant > 0, cash_received >= amount pour cash)
- `orders/buildOrderPayload.ts` — `Cart` → payload Supabase RPC
- `idr/round.ts` — arrondi à la centaine la plus proche
- `idr/format.ts` — formatage `Rp 80,000`

### Hooks (`apps/pos/src/features/*/hooks/`)

- `useProducts()` — TanStack Query, fetch products + categories, cache 5min
- `useCart()` — wrapper sur `cartStore` Zustand
- `useShift()` — current shift + open/close mutations
- `useCheckout()` — mutation create order + payment + stock_movement (1 RPC transactional)
- `useAuth()` — login/logout/validateSession

### Stores Zustand (`apps/pos/src/stores/`)

- `cartStore.ts` — items, orderType, addItem/removeItem/clear
- `shiftStore.ts` — currentShift, openingCash
- `authStore.ts` — currentUser, sessionToken, permissions, hasPermission
- `paymentStore.ts` — selected method, amount entered, terminal open/close

### Edge Functions (Deno)

- `auth-verify-pin` — login (rate-limit, bcrypt verify, mint Supabase JWT via magic-link, audit)
- `auth-get-session` — probe/refresh activity, return user+permissions
- `auth-logout` — set ended_at, end_reason='logout'
- `auth-change-pin` — change PIN (own ou admin override)
- `process-payment` — wrapper sur RPC `complete_order_with_payment`, capture Sentry server-side

### Hors scope (sessions 2+)

❌ Modifiers produit (HOT/ICE, milk, etc.) ❌ Send to Kitchen / KDS ❌ Held orders ❌ Customer attach + loyalty ❌ Floor plan / table assignment ❌ Discounts / promotions ❌ Split payment ❌ Receipt printing (juste affichage écran) ❌ Refund / void ❌ Customer display device séparé ❌ Tablet ordering ❌ Backoffice fonctionnel (uniquement bootstrap + login + page products read-only) ❌ Capacitor Android/iOS ❌ Sentry source maps en prod ❌ E2E Playwright

### Backoffice scope minimal (preuve d'archi)

`apps/backoffice/` doit boot pour valider que les packages partagés fonctionnent cross-app :
- Login PIN (réutilise `Numpad`, `NumpadPin` de `@breakery/ui`)
- Layout : sidebar (Dashboard / Products / Inventory / placeholder) + topbar
- 1 page : `/backoffice/products` — liste read-only des 8 produits seedés (hook `useProducts` partagé)
- Toutes les autres routes : `<ComingSoon module="X" />`

---

## 5. Design system Luxe Dark

### Tokens (CSS variables, dans `packages/ui/src/tokens/luxe-dark.css`)

```css
:root, .dark {
  /* Surfaces (4 layers) */
  --bg-base:     #0a0a0c;
  --bg-elevated: #131316;
  --bg-overlay:  #1c1c20;
  --bg-input:    #18181b;

  /* Borders */
  --border-subtle: #26262b;
  --border-strong: #3a3a42;
  --border-focus:  #c9a557;

  /* Text */
  --text-primary:   #f5f5f7;
  --text-secondary: #a1a1a8;
  --text-muted:     #6b6b73;
  --text-disabled:  #4a4a52;

  /* Accents */
  --gold-base:    #c9a557;
  --gold-hover:   #d4b06a;
  --gold-pressed: #b8954a;
  --gold-soft:    #c9a55720;

  --green-base:   #10b981;
  --green-hover:  #14d690;
  --green-pressed:#0e9a6e;

  --red-base:     #ef4444;
  --red-soft:     #ef444420;

  --blue-info:    #3b82f6;
  --amber-warn:   #f59e0b;

  /* Typography */
  --font-sans:  'Inter', system-ui, sans-serif;
  --font-serif: 'Fraunces', Georgia, serif;
  --font-mono:  'JetBrains Mono', ui-monospace, monospace;

  /* Radii */
  --radius-sm:  4px;
  --radius-md:  6px;
  --radius-lg:  8px;
  --radius-xl:  12px;
  --radius-2xl: 16px;

  /* Touch targets */
  --touch-min:    44px;
  --touch-comfy:  56px;
  --touch-large:  80px;

  /* Elevations */
  --shadow-sm:    0 1px 2px rgba(0,0,0,0.4);
  --shadow-md:    0 4px 12px rgba(0,0,0,0.5);
  --shadow-lg:    0 12px 32px rgba(0,0,0,0.6);
  --shadow-modal: 0 24px 64px rgba(0,0,0,0.7);

  /* Backdrop */
  --backdrop:      rgba(0,0,0,0.7);
  --backdrop-blur: 8px;
}
```

### Tailwind preset partagé

`packages/ui/tailwind-preset.ts` expose ces tokens en classes utilitaires (`bg-bg-base`, `text-text-primary`, `bg-gold`, `bg-green`, etc.). Chaque app fait `presets: [import('@breakery/ui/tailwind-preset')]`.

### Patterns de composants

| Composant | Variantes / classes |
|---|---|
| Button `primary` | `bg-green hover:bg-green-hover text-white h-touch-large rounded-md uppercase tracking-wide font-semibold` |
| Button `gold` | `bg-gold hover:bg-gold-hover text-bg-base h-touch-comfy rounded-md uppercase tracking-wide font-semibold` |
| Button `secondary` | `bg-bg-overlay border border-border-subtle text-text-primary h-touch-comfy rounded-md` |
| Button `outline-gold` | `bg-transparent border border-gold text-gold hover:bg-gold-soft uppercase tracking-wide` |
| Button `ghost-destructive` | `bg-transparent text-red hover:bg-red-soft` |
| Numpad key | `bg-bg-input border border-border-subtle text-2xl font-semibold h-touch-comfy w-full rounded-md hover:bg-bg-overlay active:scale-95` |
| Numpad clear/back | `bg-red-soft border border-red text-red hover:bg-red/30` |
| Tabs (DINE IN/TAKE-OUT/DELIVERY) actif | `bg-gold-soft text-gold border border-gold uppercase tracking-wide` |
| Card produit | `bg-bg-elevated rounded-lg border border-border-subtle hover:border-border-strong overflow-hidden cursor-pointer` |
| Modal overlay | `fixed inset-0 bg-backdrop backdrop-blur-md z-50` |
| Modal card | `bg-bg-overlay rounded-xl shadow-modal p-8 max-w-md mx-auto` |
| Modal title | `font-serif text-2xl text-text-primary` |

### Layout POS

```
<div class="h-screen flex bg-bg-base text-text-primary">
  <CategorySidebar class="w-20 bg-bg-elevated border-r border-border-subtle" />
  <main class="flex-1 flex flex-col">
    <Header class="h-16 px-6 flex items-center gap-4" />
    <ProductGrid class="flex-1 p-6 grid grid-cols-4 gap-4 overflow-y-auto" />
  </main>
  <ActiveOrderPanel class="w-[340px] bg-bg-elevated border-l border-border-subtle flex flex-col" />
</div>
```

### Layout payment terminal (full-screen modal)

```
<FullScreenModal>
  <Header class="h-14 flex items-center justify-between px-6">
    [logo + "Terminal"] ... [Server: name + BACK TO CART + ×]
  </Header>
  <div class="flex-1 grid grid-cols-2 gap-px bg-border-subtle">
    <OrderSummary class="bg-bg-base p-6" />
    <PaymentControls class="bg-bg-base p-6">
      [TOTAL AMOUNT (gold xl)]
      [CASH EXACT button vert pleine largeur + SPLIT BY ITEM gold outline]
      [grid 3x2 méthodes paiement]
      [conditionnel: numpad si CASH sélectionné]
    </PaymentControls>
  </div>
  <Footer class="h-16 flex justify-between px-6">
    [CANCEL] ... [PROCESS PAYMENT]
  </Footer>
</FullScreenModal>
```

### Accessibilité

- Tous contrastes ≥ WCAG AA (`text-primary` sur `bg-base` = 17.4:1, `text-secondary` sur `bg-elevated` = 7.1:1)
- Focus visible : `outline outline-2 outline-offset-2 outline-gold` sur tout focusable
- Touch targets ≥ 44×44px partout
- Pas de couleur seule pour véhiculer info (toujours icône + label)
- Modals avec `role="dialog"` + focus trap (Radix natif)

---

## 6. Schéma DB

### Conventions (héritées V2)

- UUID PK (`gen_random_uuid()`)
- FK : `{table_singular}_id`
- Audit : `created_at`, `updated_at`, parfois `created_by`
- Soft delete : `deleted_at TIMESTAMPTZ`
- Money : `DECIMAL(12,2)` (IDR arrondi à 100)
- Quantity : `DECIMAL(10,3)`
- Bool : préfixe `is_*`
- Enums : Postgres `CREATE TYPE`
- Timezone DB : `Asia/Makassar` (WITA, UTC+8)
- RLS : obligatoire sur toutes les tables `public.*`

### 14 tables (v1)

**Auth & Users (4)** : `roles`, `permissions`, `user_profiles`, `user_sessions`
**Catalog (2)** : `categories`, `products`
**POS & Orders (4)** : `pos_sessions`, `orders`, `order_items`, `order_payments`
**Inventory (1)** : `stock_movements`
**Settings & system (3)** : `business_config`, `order_sequences`, `audit_logs`

### DDL critiques

```sql
-- ENUMS
CREATE TYPE shift_status   AS ENUM ('open', 'closed');
CREATE TYPE order_type     AS ENUM ('dine_in', 'take_out', 'delivery');
CREATE TYPE order_status   AS ENUM ('draft', 'paid', 'voided');
CREATE TYPE payment_method AS ENUM ('cash', 'card', 'qris', 'edc', 'transfer', 'store_credit');
CREATE TYPE movement_type  AS ENUM ('sale', 'sale_void', 'production', 'purchase', 'waste', 'adjustment');

-- USER PROFILES
CREATE TABLE user_profiles (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id           UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  employee_code          TEXT UNIQUE NOT NULL,
  full_name              TEXT NOT NULL,
  pin_hash               TEXT NOT NULL,
  role_code              TEXT NOT NULL REFERENCES roles(code),
  is_active              BOOLEAN NOT NULL DEFAULT true,
  failed_login_attempts  INTEGER NOT NULL DEFAULT 0,
  locked_until           TIMESTAMPTZ,
  last_login_at          TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ
);

-- USER SESSIONS (custom session token, hashé par trigger)
CREATE TABLE user_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES user_profiles(id),
  session_token_hash   TEXT NOT NULL UNIQUE,
  device_type          TEXT NOT NULL,
  ip_address           INET,
  user_agent           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at             TIMESTAMPTZ,
  end_reason           TEXT
);

-- POS SESSIONS (shift)
CREATE TABLE pos_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_by       UUID NOT NULL REFERENCES user_profiles(id),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  opening_cash    DECIMAL(12,2) NOT NULL CHECK (opening_cash >= 0),
  opening_notes   TEXT,
  closed_at       TIMESTAMPTZ,
  closed_by       UUID REFERENCES user_profiles(id),
  closing_cash    DECIMAL(12,2),
  expected_cash   DECIMAL(12,2),
  status          shift_status NOT NULL DEFAULT 'open',
  CONSTRAINT one_open_session_per_user EXCLUDE USING gist (
    opened_by WITH =
  ) WHERE (status = 'open')
);

-- ORDERS
CREATE TABLE orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number    TEXT UNIQUE NOT NULL,
  session_id      UUID NOT NULL REFERENCES pos_sessions(id),
  served_by       UUID NOT NULL REFERENCES user_profiles(id),
  order_type      order_type NOT NULL DEFAULT 'dine_in',
  status          order_status NOT NULL DEFAULT 'draft',
  subtotal        DECIMAL(12,2) NOT NULL,
  tax_amount      DECIMAL(12,2) NOT NULL,
  total           DECIMAL(12,2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at         TIMESTAMPTZ
);

-- (autres tables : order_items, order_payments, products, categories, stock_movements,
--  business_config, order_sequences, audit_logs — voir migrations)
```

### RPC central `complete_order_with_payment`

`SECURITY DEFINER` Postgres function. Atomique. Étapes :
1. Vérifie session ouverte du caller
2. Lock products `FOR UPDATE` + check stock dispo
3. Calcule `subtotal`, `tax_amount` (extraite, PB1 incluse)
4. Génère `order_number` via `order_sequences` (séquence quotidienne, `#XXXX`)
5. INSERT `orders` (status = paid)
6. INSERT `order_items` (boucle)
7. INSERT `stock_movements` (boucle, type `sale`, quantity négative)
8. UPDATE `products.current_stock`
9. INSERT `order_payment`
10. INSERT `audit_logs` (`order.complete`)
11. RETURN `{order_id, order_number, total, tax_amount, change_given}`

Erreurs typées (`P0001` no_open_session, `P0002` insufficient_stock).

### Helpers

```sql
CREATE FUNCTION round_idr(amount DECIMAL) RETURNS DECIMAL
LANGUAGE sql IMMUTABLE AS $$ SELECT ROUND(amount / 100) * 100 $$;

CREATE FUNCTION is_authenticated() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT auth.uid() IS NOT NULL
$$;

CREATE FUNCTION has_permission(p_uid UUID, p_perm TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_role TEXT;
BEGIN
  SELECT role_code INTO v_role FROM user_profiles WHERE auth_user_id = p_uid;
  RETURN CASE
    WHEN v_role IN ('SUPER_ADMIN', 'ADMIN') THEN true
    WHEN v_role = 'MANAGER' THEN p_perm IN (
      'pos.session.open','pos.session.close_own','pos.session.close_other',
      'pos.session.view_all','pos.sale.create','pos.sale.void','pos.sale.update',
      'products.read','products.create','products.update'
    )
    WHEN v_role = 'CASHIER' THEN p_perm IN (
      'pos.session.open','pos.session.close_own','pos.sale.create','products.read'
    )
    ELSE false
  END;
END $$;
```

### Seed (`supabase/seed.sql`)

- 1 ligne `business_config` (The Breakery, IDR, PB1 0.10, tax_inclusive true)
- 4 rôles : SUPER_ADMIN, ADMIN, MANAGER, CASHIER
- 13 permissions (cf. Section 5)
- 1 admin : `EMP000` / Mamat (Owner) / PIN `1234` / SUPER_ADMIN
- 1 cashier : `EMP001` / Test Cashier / PIN `5678` / CASHIER
- 4 catégories : Beverage, Bread, Pastry, Sandwiches
- 8 produits avec images (placeholders), prix réalistes IDR, `current_stock` = 50

---

## 7. Authentification & RLS

### Flow PIN (résumé)

1. UI POS : grille 6 PIN dots + numpad (composant `NumpadPin` partagé)
2. POST Edge Function `auth-verify-pin` `{ user_id, pin, device_type: 'pos' }`
3. Edge Function : rate-limit IP 20/min → SELECT user → check `is_active` + `locked_until` → `verify_user_pin()` (bcrypt) → si OK : reset compteur, mint Supabase JWT via `auth.admin.generateLink({ type: 'magiclink' })`, génère sessionToken UUID v4, INSERT `user_sessions` (token sera SHA-256-hashé par trigger), audit
4. Réponse `{ user, session: { token, expires_at }, auth: { token, refresh_token }, permissions[] }`
5. Client : `authStore` persist `{user, sessionToken}` en `safeStorage` (sessionStorage en web), `supabase.auth.setSession()` pour activer le JWT RLS
6. Redirect `/pos`

### Lockout & timeout

| Setting | Value |
|---|---|
| Max failed attempts | 5 |
| Lockout duration | 15 minutes |
| Activity timeout (client + server) | 30 minutes |
| Max session age (hard cap) | 24 heures |

### Edge Functions auth (4)

| Function | Auth header | Rôle |
|---|---|---|
| `auth-verify-pin` | aucun | login (rate-limited) |
| `auth-get-session` | `x-session-token` | probe + refresh activity |
| `auth-logout` | `x-session-token` | end session |
| `auth-change-pin` | `x-session-token` | change PIN |

Middleware partagé `_shared/session-auth.ts` (hash, lookup, timeout check, hard-cap check, refresh activity).

### RLS (3 policies par table)

```sql
ALTER TABLE public.{t} ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON public.{t}
  FOR SELECT USING (is_authenticated());

CREATE POLICY "perm_create" ON public.{t}
  FOR INSERT WITH CHECK (has_permission(auth.uid(), '{module}.{entity}.create'));

CREATE POLICY "perm_update" ON public.{t}
  FOR UPDATE USING (has_permission(auth.uid(), '{module}.{entity}.update'));
```

Pas de DELETE policy (soft delete via `deleted_at`).

`orders`, `order_items`, `order_payments`, `stock_movements`, `audit_logs` : INSERT **uniquement via RPC `SECURITY DEFINER`** (`complete_order_with_payment`). Garantit atomicité + audit + bonne ordre des FK.

`user_sessions` : INSERT/UPDATE uniquement via Edge Functions (service role).

### Permissions catalogue v1

13 permissions (`pos.session.*`, `pos.sale.*`, `products.*`, `users.*`). Mapping role→perm hardcodé dans `has_permission()` v1, remplacé par jointure dynamique en session 2.

### authStore (Zustand) — partialize

Persiste **uniquement** `{ user.{id, full_name, role_code}, sessionToken, isAuthenticated }` dans `safeStorage`.
**Jamais** `{ permissions, pin, ... }` (toujours re-fetch du serveur).

### Guard composant

`POSAccessGuard` redirige `/login` si non-auth, affiche `<NoAccess />` si pas la perm `pos.sale.create`.

### Variables d'env

```bash
# .env.example
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<anon_key_local>
VITE_SENTRY_DSN_POS=
VITE_SENTRY_DSN_BACKOFFICE=

# Edge Functions secrets
SUPABASE_SERVICE_ROLE_KEY=<service_role_local>
SUPABASE_JWT_SECRET=<jwt_secret_local>
```

`packages/utils/src/env.ts` valide via Zod au boot. Throw immédiatement si manquant.

---

## 8. Stratégie de tests

### Cibles de couverture

| Layer | Cible | Outils |
|---|---|---|
| `packages/domain` | ≥ 90% lines | Vitest pure node |
| `packages/utils` | ≥ 85% | Vitest pure node |
| `packages/ui` | ≥ 70% (composants critiques) | Vitest + RTL + jsdom |
| `apps/pos` features | smoke tests golden path | Vitest + RTL |
| `apps/backoffice` | smoke test | Vitest + RTL |
| Edge Functions | 1 integration test par fonction | Vitest + supabase local |
| RPC SQL | pgTAP + Vitest via supabase-js | 5 cas pour `complete_order_with_payment` |

### TDD London (via `ruflo-testgen`)

Mock-first, outside-in. Test du composant `<PaymentTerminal>` d'abord avec hook mocké, puis descend. Services + RPC testés contre **vraie DB Supabase locale**, pas de mock du DB layer.

### Lint + typecheck strict

ESLint **0 warnings**. TS `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. Pas d'`any`.

### CI GitHub Actions

```yaml
on: [push, pull_request]
jobs:
  ci:
    steps:
      - checkout
      - pnpm setup + Node 22
      - pnpm install --frozen-lockfile
      - turbo run lint typecheck test build
      - upload coverage
```

---

## 9. Orchestration Ruflo swarm

### Topology

**Hierarchical** : 1 coordinator → groupes spécialisés. ~15-20 agents en pic.

```
ruflo-swarm:coordinator (queen)
├── Phase 1 — Foundation        ruflo-swarm:architect (setup turborepo + pnpm)
├── Phase 2 — Backend & DB      coder ×2 (migrations, edge functions) + tester (pgTAP)
├── Phase 3 — Shared packages   coder ×4 (domain, utils, ui, supabase) + tester ×4
├── Phase 4 — Apps              coder ×2 (pos, backoffice) + tester ×2
├── Phase 5 — Quality gates     security-audit + reviewer + docs-writer
└── Phase 6 — Drive autopilot   autopilot-coordinator (boucle progress)
```

### Mémoire partagée (`agentdb_hierarchical-store`)

| Key | Content |
|---|---|
| `breakery/architecture` | Section 3 (structure monorepo) |
| `breakery/scope-vertical` | Section 4 (parcours, écrans) |
| `breakery/design-tokens` | Section 5 (tokens, patterns) |
| `breakery/db-schema` | Section 6 (DDL + RPC) |
| `breakery/auth-rls` | Section 7 (auth flow, policies) |
| `breakery/conventions/v2` | Extraits de `v2-reference/11-conventions/` |
| `breakery/ux-refs` | Mapping screen → fichier `Ux-reference/*.jpg` |

### Hooks anti-drift

- `pre-edit` : empêche `apps/pos` d'importer `apps/backoffice` (frontières)
- `pre-edit` : empêche import `react`, `@supabase/*`, `@radix-ui/*` dans `packages/domain`
- `post-edit` migration SQL → trigger regen types TS
- `pre-task` : lookup mémoire `breakery/design-tokens` + `breakery/db-schema` avant tout code

### Coordination

Chaque agent claim son périmètre via `claims_claim`, release via `claims_release`. Conflits → `claims_handoff` ou `claims_steal` (rare).

### Autopilot

`autopilot_enable` avec `criteria` = critères d'acceptation Section 10. `autopilot_progress` checke chaque tour. `autopilot_predict` propose la prochaine action si bloqué. Stop quand 100% verts.

### Estimation

- ~15-20 agents en pic
- ~3-5 heures wall-clock
- ~5-10M tokens cumulés
- Interruption à tout moment possible (commits incrémentaux par agent sur branches `swarm/<agent>/<feature>`)

---

## 10. Critères d'acceptation (= "done" session 1)

- [ ] Repo Git initialisé, monorepo Turborepo + pnpm bootstrap
- [ ] `pnpm install` clean
- [ ] `pnpm dev` démarre les 2 apps (pos:5173, backoffice:5174)
- [ ] `pnpm lint` 0 warning
- [ ] `pnpm typecheck` 0 erreur
- [ ] `pnpm test` ≥ 90% `domain`, ≥ 85% `utils`, ≥ 70% `ui`, smoke tests passent
- [ ] `pnpm build` produit `dist/` propre pour les 2 apps
- [ ] Supabase local : `supabase start` + `supabase db reset` applique les 9 migrations + seed
- [ ] Login PIN `1234` ouvre POS, modal "Open Shift" apparaît si pas de session active
- [ ] Open Shift avec opening_cash `100,000` → session créée, modal disparaît
- [ ] Tap 2 produits dans 2 catégories → cart mis à jour avec qty +/-, totaux corrects PB1 incluse
- [ ] Tap CHECKOUT → payment terminal full-screen, montant total correct
- [ ] Tap CASH → numpad apparaît, "Exact" pré-rempli, quick amounts cliquables
- [ ] Tap PROCESS PAYMENT → success modal "Payment successful! Order #XXXX"
- [ ] DB : `SELECT * FROM orders` montre la ligne, `order_items` les 2 produits, `order_payments` la ligne cash, `stock_movements` les 2 décréments, `products.current_stock` baissé
- [ ] `audit_logs` contient `session.open`, `order.complete`
- [ ] Backoffice login PIN + `/backoffice/products` affiche les 8 produits seedés
- [ ] Sentry init (DSN dev) capture une erreur volontaire de test
- [ ] CI GitHub Actions verte sur le commit final

---

## 11. Roadmap des sessions suivantes (indicatif)

| Session | Module |
|---|---|
| 2 | Modifiers produit + Send to Kitchen + KDS station |
| 3 | Customer attach + loyalty (Bronze/Silver/Gold/Platinum) + receipts impression |
| 4 | Held orders + floor plan + tablet ordering |
| 5 | Discounts + promotions + combos |
| 6 | Split payment + refund/void |
| 7 | Backoffice products CRUD + categories + suppliers |
| 8 | Inventory : stock counts + transfers + production records |
| 9 | Purchasing : POs, receiving, supplier management |
| 10 | B2B : wholesale orders, deliveries, invoicing |
| 11 | Accounting : COA, journal entries, tax filings PB1, fiscal periods |
| 12 | Reports & analytics : daily KPIs, hourly sales, P&L, AR aging |
| 13 | Capacitor Android wrap (POS + KDS pour tablettes locales) |
| 14 | RBAC dynamique (remplace `has_permission()` hardcodé) |
| 15 | LAN architecture : hub-client model, printer routing |
| 16 | Migration progressive depuis V2 (export/import data) + sunset V2 |

Chaque session démarre par sa propre brainstorming → spec → plan → swarm → review.

---

## 12. Liens

- Documentation référence V2 (source) : `v2-reference/`
- UX reference (screenshots) : `Ux-reference/caissapp/v2-reference/` + `Ux-reference/backoffice/`
- Conventions héritées : `v2-reference/11-conventions/`
- DB schema V2 (référence) : `v2-reference/03-database/`
- Auth flow V2 : `v2-reference/07-security/01-auth-flow-pin.md`
