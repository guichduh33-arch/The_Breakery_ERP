# Phase 7 — CI + Finalisation

> **Trace historique** : ce fichier documente une session de travail datée. Le contenu de fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure documentaire (voir [`docs/README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** GitHub Actions CI verte, vérification de tous les critères d'acceptation du spec, tag `v0.1.0`, README final.

**Spec source:** `docs/workplan/specs/2026-05-03-breakery-split-2apps-design.md` section 10.

**Dépend de :** Phases 1-6.

**À la fin :** repo prêt à push, CI verte, livrable validé.

---

## Task 7.1 — GitHub Actions CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Code workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-typecheck-test-build:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck

      - name: Unit tests
        run: pnpm test
        env:
          # Tests qui requièrent la stack Supabase ne sont pas lancés ici
          # (ils sont taggés via test config et exécutés séparément).
          VITE_SUPABASE_URL: http://stub-not-used.local
          VITE_SUPABASE_ANON_KEY: stub
          VITE_SENTRY_DSN_POS: ''
          VITE_SENTRY_DSN_BACKOFFICE: ''

      - name: Build
        run: pnpm build
        env:
          VITE_SUPABASE_URL: http://stub-not-used.local
          VITE_SUPABASE_ANON_KEY: stub
          VITE_SENTRY_DSN_POS: ''
          VITE_SENTRY_DSN_BACKOFFICE: ''

      - name: Upload coverage
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage
          path: '**/coverage/**'
          if-no-files-found: ignore

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: dist
          path: 'apps/*/dist/**'
          if-no-files-found: error

  supabase-tests:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: 'pnpm' }

      - name: Setup Supabase CLI
        uses: supabase/setup-cli@v1
        with: { version: latest }

      - name: Start Supabase
        run: supabase start

      - name: Install deps
        run: pnpm install --frozen-lockfile

      - name: Run Supabase integration tests
        run: pnpm --filter @breakery/supabase-tests test
        env:
          VITE_SUPABASE_URL: http://127.0.0.1:54321
          VITE_SUPABASE_ANON_KEY: ${{ env.SUPABASE_ANON_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ env.SUPABASE_SERVICE_ROLE_KEY }}
```

> **Note** : le job `supabase-tests` peut être instable selon la version du Supabase CLI dans Actions runners. Si flake en CI, le mettre `continue-on-error: true` initialement et gérer plus tard.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow (lint, typecheck, test, build, supabase integration)"
```

---

## Task 7.2 — Vérification end-to-end manuelle

Reset complet de l'environnement et exécution du parcours utilisateur complet.

- [ ] **Step 1: Stop tout**

```bash
supabase stop
# Stop tout pnpm dev en cours
```

- [ ] **Step 2: Clean install**

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules .turbo
pnpm install
```

- [ ] **Step 3: Reset Supabase + DB**

```bash
supabase start
supabase db reset
```

- [ ] **Step 4: Démarrer Edge Functions**

Dans un terminal dédié :

```bash
supabase functions serve --no-verify-jwt
```

- [ ] **Step 5: Démarrer apps**

Dans un autre terminal :

```bash
pnpm dev
```

- [ ] **Step 6: Tester le parcours POS**

1. Ouvrir http://localhost:5173
2. Voir page login → choisir Mamat → entrer PIN `1234` → Verify
3. Modal Open Shift → entrer 100,000 via numpad → Open Shift
4. Voir page POS avec sidebar catégories
5. Cliquer Beverage → grid produits filtrée
6. Cliquer Americano → cart panel : 1× Americano Rp 35,000
7. Cliquer Flat White → cart : 2 items, total Rp 80,000, tax (incl) Rp 7,300
8. Cliquer + sur Americano → qty 2, line total Rp 70,000, total Rp 115,000
9. Cliquer − sur Americano → retour à 1
10. Cliquer CHECKOUT
11. Voir payment terminal full-screen, total Rp 80,000 en gold
12. Cliquer CASH → numpad apparaît
13. Cliquer "Exact (Rp 80,000)" → bouton vert "Cash Exact" + "Process Payment" enabled
14. Cliquer PROCESS PAYMENT
15. Voir Success modal "Payment successful! Order #0001" + Change Rp 0
16. Cliquer NEW ORDER → cart vidé, retour POS
17. Recommencer avec Rp 100,000 reçu → Change Rp 20,000 affiché

- [ ] **Step 7: Tester le parcours Backoffice**

1. Ouvrir http://localhost:5174
2. Login Mamat / 1234
3. Arrivée Dashboard
4. Cliquer Products → 8 produits affichés, 2 sont déjà décrémentés (49 ou 48 selon les tests)
5. Cliquer Inventory / Reports → Coming soon
6. Logout → retour /login

- [ ] **Step 8: Vérifier la DB**

Dans Studio (http://127.0.0.1:54323) :

- `orders` : ≥ 2 rows, `status = paid`, `order_number = #0001, #0002`
- `order_items` : ≥ 4 rows
- `order_payments` : ≥ 2 rows, `method = cash`
- `stock_movements` : ≥ 4 rows, `quantity` négative
- `audit_logs` : `login.success`, `order.complete`, etc.
- `pos_sessions` : 1 row `status = open`
- `products` : `current_stock` réduit pour les produits vendus

- [ ] **Step 9: Vérifier Sentry capture**

Si `VITE_SENTRY_DSN_POS` est configuré, ajouter temporairement dans `apps/pos/src/App.tsx` un bouton :

```tsx
<button onClick={() => { throw new Error('test sentry'); }}>Test Sentry</button>
```

Cliquer → exception envoyée à Sentry → vérifier dashboard. Retirer le bouton après test.

(Si pas configuré, étape skippée — le hook breadcrumb fonctionne quand même via console.)

- [ ] **Step 10: Tester `pnpm build` end-to-end**

```bash
pnpm build
```

Expected: `apps/pos/dist/` et `apps/backoffice/dist/` créés. Tester preview :

```bash
pnpm --filter @breakery/app-pos preview
```

Ouvrir http://localhost:5173 → app prod fonctionne.

- [ ] **Step 11: Commit éventuels fixes (si trouvés)**

Si des bugs sont découverts pendant la vérif manuelle, corriger et commit. Sinon passer.

---

## Task 7.3 — README final + CHANGELOG

**Files:**
- Modify: `README.md`
- Create: `CHANGELOG.md`

- [ ] **Step 1: README final**

```markdown
# The Breakery — ERP/POS Monorepo

ERP/POS pour The Breakery (boulangerie artisanale, Lombok).
Monorepo Turborepo + pnpm. 2 apps spécialisées par persona, 4 packages partagés.

## Architecture

| Path | Description |
|---|---|
| `apps/pos/` | SPA tactile : caisse, KDS, customer display, tablette serveur (port 5173) |
| `apps/backoffice/` | SPA desktop : manager, comptable, reports (port 5174) |
| `packages/ui/` | Composants partagés (shadcn vendu) + tokens Luxe Dark + tailwind preset |
| `packages/supabase/` | Client + types générés + auth wrappers |
| `packages/domain/` | Logique métier pure (cart, payment, orders) |
| `packages/utils/` | Plomberie partagée (idr, safeStorage, dates, env) |
| `supabase/` | Migrations SQL, seed, Edge Functions Deno |

## Prerequisites

- Node.js ≥ 22.12.0
- pnpm ≥ 9.0
- Supabase CLI ≥ 2.0 (https://supabase.com/docs/guides/cli/getting-started)
- Docker (pour `supabase start`)

## Quick start

\`\`\`bash
# 1. Install deps
pnpm install

# 2. Start Supabase locally (DB + Auth + Studio)
supabase start

# 3. Apply migrations + seed
supabase db reset

# 4. Copy env template (and paste anon/service keys from `supabase start` output)
cp .env.example .env

# 5. Start Edge Functions in a separate terminal
supabase functions serve --no-verify-jwt

# 6. Start the apps
pnpm dev
\`\`\`

POS : http://localhost:5173
Backoffice : http://localhost:5174
Supabase Studio : http://127.0.0.1:54323

## Seeded credentials

| Role | PIN | Permissions |
|---|---|---|
| Mamat (Owner) — SUPER_ADMIN | `1234` | Toutes |
| Test Cashier — CASHIER | `5678` | POS sale + open shift seulement |

## Scripts

| Command | Effect |
|---|---|
| `pnpm dev` | Démarre les 2 apps en parallèle |
| `pnpm build` | Build prod des 2 apps |
| `pnpm lint` | ESLint sur tout (0 warning toléré) |
| `pnpm typecheck` | TypeScript strict 0 erreur |
| `pnpm test` | Vitest + couverture |
| `pnpm test:watch` | Vitest en watch |
| `pnpm format` | Prettier write |
| `pnpm db:start` | `supabase start` |
| `pnpm db:reset` | Reset DB + applique migrations + seed |
| `pnpm db:types` | Régénère `packages/supabase/src/types.generated.ts` |

## Testing

\`\`\`bash
pnpm test                                 # tous les packages
pnpm --filter @breakery/domain test       # un package
pnpm --filter @breakery/app-pos test:watch
pnpm --filter @breakery/supabase-tests test  # nécessite supabase start
\`\`\`

Couverture : 90% domain, 85% utils, 70% ui, smoke tests apps.

## Documentation

- **Spec V3** : [`docs/workplan/specs/2026-05-03-breakery-split-2apps-design.md`](docs/workplan/specs/2026-05-03-breakery-split-2apps-design.md)
- **Plans d'implémentation** : [`docs/workplan/plans/`](docs/workplan/plans/)
- **Référence V2** (legacy doc) : [`docs/reference/`](../../reference/)
- **UX screenshots** : [`Ux-reference/`](Ux-reference/)

## Conventions

| Élément | Convention |
|---|---|
| Composants React | `PascalCase.tsx` |
| Hooks | `useCamelCase.ts` |
| Stores | `camelCaseStore.ts` |
| Tables DB | `snake_case_plural` |
| Migrations | `YYYYMMDDHHMMSS_snake_case.sql` |
| Permissions | `module.action` (e.g. `pos.sale.create`) |
| Money | `DECIMAL(12,2)` IDR, `roundIdr()` à la centaine |
| Timezone | DB + apps en `Asia/Makassar` (WITA, UTC+8) |

## Sécurité

- PIN bcrypt 4-6 digits, lockout 5 fails / 15 min
- Custom session token (UUID v4 → SHA-256 stored) + Supabase JWT en parallèle
- Timeout : 30 min inactivity / 24h hard cap
- RLS sur toutes les tables `public.*` (helper `is_authenticated()` + `has_permission()`)
- Edge Functions rate-limit IP 20/min

## License

Privé.
```

- [ ] **Step 2: `CHANGELOG.md`**

```markdown
# Changelog

## v0.1.0 — 2026-05-03

Bootstrap monorepo + premier vertical POS end-to-end.

### Added

**Foundation**
- Turborepo + pnpm workspaces (2 apps × 4 packages)
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
- `auth-verify-pin` (bcrypt + lockout + JWT mint via magic-link)
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

### Conventions

- Anglais uniquement (pas d'i18n)
- IDR arrondi à la centaine
- Timezone Asia/Makassar (WITA, UTC+8)
- 0 warning ESLint, 0 erreur TS strict
- Couverture tests : 90% domain, 85% utils, 70% ui, smoke apps

### Hors scope (sessions futures)

Modifiers, KDS, Held orders, Customer/loyalty, Floor plan, Discounts/promotions, Split payment, Receipt printing, Refund/void, Customer display device, Tablet ordering, Backoffice CRUD, Capacitor Android/iOS, RBAC dynamique, LAN architecture.
```

- [ ] **Step 3: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: finalize README + add CHANGELOG v0.1.0"
```

---

## Task 7.4 — Tag v0.1.0

- [ ] **Step 1: Vérifier qu'on est clean + sur main**

```bash
git status
git log --oneline -20
```

Expected: branch main, working tree clean.

- [ ] **Step 2: Tag**

```bash
git tag -a v0.1.0 -m "v0.1.0 — Bootstrap monorepo + POS vertical end-to-end (cart → cash → order persisté)"
```

- [ ] **Step 3: Vérifier le tag**

```bash
git tag -l -n5 v0.1.0
```

- [ ] **Step 4: (optionnel) Push remote**

Si un remote GitHub est configuré :

```bash
git remote add origin <url>           # si pas déjà fait
git push -u origin main
git push origin v0.1.0
```

Sinon : laisser local pour cette session.

---

## Task 7.5 — Vérification finale des critères d'acceptation

Dérouler la check-list complète du spec section 10 :

- [ ] Repo Git initialisé, monorepo Turborepo + pnpm bootstrap → ✓
- [ ] `pnpm install` clean → ✓
- [ ] `pnpm dev` démarre les 2 apps (pos:5173, backoffice:5174) → ✓
- [ ] `pnpm lint` 0 warning → ✓
- [ ] `pnpm typecheck` 0 erreur → ✓
- [ ] `pnpm test` ≥ 90% `domain`, ≥ 85% `utils`, ≥ 70% `ui`, smoke OK → ✓
- [ ] `pnpm build` produit `dist/` propre pour les 2 apps → ✓
- [ ] `supabase start` + `supabase db reset` applique 9 migrations + seed → ✓
- [ ] Login PIN `1234` ouvre POS → ✓
- [ ] Modal "Open Shift" apparaît si pas de session → ✓
- [ ] Open Shift opening_cash 100,000 → session créée → ✓
- [ ] Tap 2 produits → cart, qty +/-, totaux PB1 corrects → ✓
- [ ] Tap CHECKOUT → payment terminal full-screen → ✓
- [ ] Tap CASH → numpad + quick amounts + Exact pré-rempli → ✓
- [ ] Tap PROCESS PAYMENT → success modal "Payment successful! Order #XXXX" → ✓
- [ ] DB : `orders` + `order_items` + `order_payments` + `stock_movements` créés, stock baissé → ✓
- [ ] `audit_logs` contient `session.open` (via insert direct) ou équivalent + `order.complete` → ✓
- [ ] Backoffice login + `/backoffice/products` affiche 8 produits seedés → ✓
- [ ] Sentry init capture une erreur volontaire → ✓ (si DSN configuré)
- [ ] CI GitHub Actions verte sur le commit final → ✓ (à vérifier après push)

Si tous les ✓ : **session 1 livrée**. Sinon, créer un task pour fixer les manquants et re-vérifier.

---

## Phase 7 — Done criteria

- [ ] `.github/workflows/ci.yml` créé et testé (lint + typecheck + test + build)
- [ ] Vérification manuelle end-to-end OK (parcours POS et Backoffice)
- [ ] README.md final avec quickstart, scripts, conventions
- [ ] CHANGELOG.md v0.1.0 listant tout le scope livré
- [ ] Tag git `v0.1.0` créé
- [ ] Tous les critères d'acceptation du spec section 10 cochés ✓

---

# 🎉 Session 1 livrée

À ce stade, tu as :
- Un monorepo propre, lintré, typé strict, testé
- Une base DB Supabase complète avec RLS et RPC atomique
- Un POS fonctionnel : login PIN → shift → cart → cash → order persisté
- Un Backoffice qui boot, partage les packages, affiche les produits

**Next session** (selon roadmap spec section 11) : Modifiers produit + Send to Kitchen + KDS station.

Démarre une nouvelle conversation avec :
> "Brainstorming session 2 : modifiers + send to kitchen + KDS station, à partir du spec V3 existant et des screens `Ux-reference/caissapp/v2-reference/20-23-modifier-*.jpg`."
