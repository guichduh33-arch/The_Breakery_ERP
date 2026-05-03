# The Breakery — ERP/POS Monorepo

ERP/POS pour The Breakery (boulangerie artisanale, Lombok).
Monorepo Turborepo + pnpm. 2 apps spécialisées par persona, 4 packages partagés.

## Architecture

| Path | Description |
|---|---|
| `apps/pos/` | SPA tactile : caisse, KDS, customer display, tablette serveur (port 5173) |
| `apps/backoffice/` | SPA desktop : manager, comptable, reports (port 5174) |
| `packages/ui/` | Composants partagés (shadcn vendus) + tokens Luxe Dark + tailwind preset |
| `packages/supabase/` | Client + types générés + auth wrappers |
| `packages/domain/` | Logique métier pure (cart, payment, orders) |
| `packages/utils/` | Plomberie partagée (idr, safeStorage, dates, env) |
| `supabase/` | Migrations SQL, seed, Edge Functions Deno |

## Prerequisites

- Node.js >= 22.12.0
- pnpm >= 9.0
- Supabase CLI >= 2.0 (https://supabase.com/docs/guides/cli/getting-started)
- Docker (pour `supabase start`)

## Quick start

```bash
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
```

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

```bash
pnpm test                                 # tous les packages
pnpm --filter @breakery/domain test       # un package
pnpm --filter @breakery/app-pos test:watch
pnpm --filter @breakery/supabase-tests test  # nécessite supabase start
```

Couverture : 90% domain, 85% utils, 70% ui, smoke tests apps.

## Documentation

- **Spec V3** : [`docs/superpowers/specs/2026-05-03-breakery-split-2apps-design.md`](docs/superpowers/specs/2026-05-03-breakery-split-2apps-design.md)
- **Plans d'implémentation** : [`docs/superpowers/plans/`](docs/superpowers/plans/)
- **Référence V2** (legacy doc) : [`v2-reference/`](v2-reference/)
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
- Custom session token (UUID v4 -> SHA-256 stored) + Supabase JWT en parallèle
- Timeout : 30 min inactivity / 24h hard cap
- RLS sur toutes les tables `public.*` (helper `is_authenticated()` + `has_permission()`)
- Edge Functions rate-limit IP 20/min

## License

Privé.
