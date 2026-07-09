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

> **DB target is Supabase cloud, not local Docker.** As of 2026-05-14 the local Docker / `supabase start` stack is **retired**. All DB work (migrations, RPCs, pgTAP, types regen) runs against the **cloud V3 dev** project `ikcyvlovptebroadgtvd` (`the-breakery-v3-dev`, `ap-southeast-1`) via the Supabase MCP tools. **Do NOT run** `supabase start`, `supabase db reset`, or `pnpm db:reset` — they need Docker and will fail. See `CLAUDE.md` → *Critical patterns* and *Build & Test* for the full workflow.

## Quick start

```bash
# 1. Install deps
pnpm install

# 2. Configure env — create apps/pos/.env.local AND apps/backoffice/.env.local
#    with VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY pointing at the cloud V3 dev project.
#    (Vite envDir is unset, so the repo-root .env.example is not auto-loaded.)

# 3. Start the apps (they connect to the cloud DB directly)
pnpm dev
```

POS : http://localhost:5173
Backoffice : http://localhost:5174
Supabase dashboard : https://supabase.com/dashboard/project/ikcyvlovptebroadgtvd

DB migrations, SQL, pgTAP and type regen are applied through the Supabase MCP tools against the cloud project — never `supabase db reset`.

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
| `pnpm db:types` | Régénère `packages/supabase/src/types.generated.ts` (préférer le MCP `generate_typescript_types`) |

> `pnpm db:start` / `pnpm db:reset` (Docker-based) sont obsolètes — la DB cible est le projet cloud V3 dev, géré via les outils Supabase MCP. Voir `CLAUDE.md`.

## Testing

```bash
pnpm test                                 # tous les packages
pnpm --filter @breakery/domain test       # un package
pnpm --filter @breakery/app-pos test:watch
pnpm --filter @breakery/supabase test inventory   # Vitest live RPC contre le cloud V3 dev (env requise)
```

Couverture : 90% domain, 85% utils, 70% ui, smoke tests apps.

## Documentation

- **État courant + conventions + patterns critiques** : [`CLAUDE.md`](CLAUDE.md) → *Active Workplan* (**source de vérité**)
- **Référence modules (réel-vs-demandé)** : [`docs/workplan/remise-a-plat/`](docs/workplan/remise-a-plat/) — autorité actuelle par module (Phase 3 = régénération depuis le code)
- **Spec V3 (split 2 apps)** : [`docs/workplan/specs/archive/2026-05-03-breakery-split-2apps-design.md`](docs/workplan/specs/archive/2026-05-03-breakery-split-2apps-design.md)
- **Workplan (plans/specs datés)** : [`docs/workplan/`](docs/workplan/)
- **Référence historique** : [`docs/reference/`](docs/reference/) — ⚠️ **majoritairement V2/périmée** (bandeau STALE en tête de chaque fichier) ; ne fait plus foi, cf. `docs/README.md` pour la hiérarchie de vérité.

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
