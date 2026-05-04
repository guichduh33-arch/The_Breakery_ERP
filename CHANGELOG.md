# Changelog

## v0.1.0 — 2026-05-03

Bootstrap monorepo + premier vertical POS end-to-end.

### Added

**Foundation**
- Turborepo + pnpm workspaces (2 apps x 4 packages)
- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- ESLint flat config avec frontières packages strictes
- Prettier 3
- GitHub Actions CI

**Database (14 tables, 9 migrations)**
- Auth & Users : `roles`, `permissions`, `user_profiles`, `user_sessions`
- Catalog : `categories`, `products`
- POS : `pos_sessions`, `orders`, `order_items`, `order_payments`
- Inventory : `stock_movements`
- Settings : `business_config`, `order_sequences`, `audit_logs`
- Helpers : `round_idr`, `is_authenticated`, `has_permission`, `hash_pin`, `verify_user_pin`
- RLS sur toutes les tables, RPC central `complete_order_with_payment` (atomic)

**Edge Functions Deno**
- `auth-verify-pin` (bcrypt + lockout + JWT mint via HS256 + non-null refresh_token)
- `auth-get-session` (probe + refresh activity)
- `auth-logout`
- `auth-change-pin` (self + admin override)
- `process-payment` (wrapper sur RPC SQL)
- `_shared/` : CORS, rate-limit (LRU 20/min), session-auth middleware

**Shared packages**
- `@breakery/utils` : `roundIdr`, `formatIdr`, `safeStorage`, `parseAppEnv`, `dates` (WITA), `logger`
- `@breakery/domain` : types métier, `calculateTotals`, cart mutations, `calculateChange`, `validatePayment`, `buildOrderPayload`
- `@breakery/ui` : tokens Luxe Dark, tailwind preset, 8 primitives shadcn vendues, 6 composants domain (Numpad, NumpadPin, Currency, QuantityStepper, OrderTypeTabs, FullScreenModal)
- `@breakery/supabase` : client singleton, types générés, PIN auth wrappers, permission helpers

**App POS** (Vite + React + Tailwind, port 5173)
- Login PIN avec NumpadPin
- Open Shift modal (numpad + quick amounts + notes)
- Layout 3 colonnes : sidebar catégories | grid produits | active order panel
- Cart store Zustand + qty stepper + order type tabs (DINE IN / TAKE-OUT / DELIVERY)
- Payment terminal full-screen avec cash flow (numpad, quick amounts, exact button, change calc)
- Success modal "Payment successful! Order #XXXX"
- Persistance Supabase via Edge Function `process-payment`
- Sentry init avec breadcrumb hook depuis logger

**App Backoffice** (Vite + React + Tailwind, port 5174)
- Login PIN (réutilise composants UI partagés)
- Layout sidebar 9 sections + topbar
- Dashboard placeholder
- Page Products read-only (8 produits seedés)
- Pages stub `Coming soon` pour les 7 autres modules

### Fixed

- `auth.users` seed : ajout `raw_app_meta_data` + tokens vides pour compatibilité GoTrue scanner
- `auth-verify-pin` : `refresh_token` non-null pour que `supabase.auth.setSession()` fonctionne en browser
- Vitest `pool:forks` sur apps pour éviter OOM Windows VirtualAlloc lors de la couverture

### Conventions

- Anglais uniquement (pas d'i18n)
- IDR arrondi à la centaine
- Timezone Asia/Makassar (WITA, UTC+8)
- 0 warning ESLint, 0 erreur TS strict
- Couverture tests : 90% domain, 85% utils, 70% ui, smoke apps

### Hors scope (sessions futures)

Modifiers, KDS, Held orders, Customer/loyalty, Floor plan, Discounts/promotions, Split payment, Receipt printing, Refund/void, Customer display device, Tablet ordering, Backoffice CRUD, Capacitor Android/iOS, RBAC dynamique, LAN architecture.
