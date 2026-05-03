# The Breakery — ERP/POS Monorepo

Monorepo Turborepo + pnpm. 2 apps (`pos`, `backoffice`) + 4 packages partagés (`ui`, `supabase`, `domain`, `utils`).

## Prerequisites

- Node.js >= 22.12.0
- pnpm >= 9.0
- Supabase CLI >= 2.0
- Docker (pour `supabase start`)

## Setup

```bash
pnpm install
cp .env.example .env
supabase start
supabase db reset
pnpm dev
```

POS : http://localhost:5173
Backoffice : http://localhost:5174

## Scripts

| Command | Effect |
|---|---|
| `pnpm dev` | Démarre les 2 apps en parallèle |
| `pnpm build` | Build prod des 2 apps |
| `pnpm lint` | ESLint sur tout |
| `pnpm typecheck` | TypeScript strict |
| `pnpm test` | Vitest + couverture |
| `pnpm db:reset` | Reset DB Supabase locale + applique seed |
| `pnpm db:types` | Régénère types TS depuis schéma |

## Spec

Voir [`docs/superpowers/specs/2026-05-03-breakery-split-2apps-design.md`](docs/superpowers/specs/2026-05-03-breakery-split-2apps-design.md).
