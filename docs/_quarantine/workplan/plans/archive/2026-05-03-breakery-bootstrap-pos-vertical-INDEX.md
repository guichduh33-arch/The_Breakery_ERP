# Breakery Bootstrap + POS Vertical — Master Plan (Index)

> **Trace historique** : ce fichier documente une session de travail datée. Le contenu de fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure documentaire (voir [`docs/README.md`](../../../README.md)).
> **Last refreshed** : 2026-05-13

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement these plans task-by-task.

**Goal:** Bootstrap monorepo Turborepo + pnpm avec 2 apps (`pos`, `backoffice`) et 4 packages partagés (`ui`, `supabase`, `domain`, `utils`), puis livrer un module POS vertical end-to-end (auth PIN → open shift → cart → cash payment → order persisté).

**Spec source:** `docs/workplan/specs/2026-05-03-breakery-split-2apps-design.md`

**Architecture:** Turborepo monorepo. 2 apps Vite SPA. 4 packages internes. Backend Supabase (Postgres + Edge Functions Deno) en local CLI. Auth PIN custom + Supabase JWT. Tests Vitest + pgTAP. CI GitHub Actions.

**Tech Stack:** React 18, TypeScript 5.3 strict, Vite 5, Tailwind 3.4, shadcn/ui, Radix, Zustand 4, TanStack Query 5, Supabase JS 2, Vitest 2, Turborepo 2, pnpm 9, Sentry React 10, Lucide, Sonner.

---

## Découpage en 7 plans

Exécuter dans l'ordre. Chaque phase produit une partie testable et peut être commitée indépendamment.

| # | Plan | Fichier | Dépend de |
|---|---|---|---|
| 1 | **Foundation** — git init, pnpm workspace, Turborepo, configs racines, `apps/*` et `packages/*` vides qui boot | `2026-05-03-breakery-01-foundation.md` | — |
| 2 | **Database** — 9 migrations SQL (extensions, enums, auth, catalog, POS, inventory, settings, helpers, RLS, RPC central), seed | `2026-05-03-breakery-02-database.md` | 1 |
| 3 | **Edge Functions** — `auth-verify-pin`, `auth-get-session`, `auth-logout`, `auth-change-pin`, `process-payment` + `_shared/` middleware | `2026-05-03-breakery-03-edge-functions.md` | 2 |
| 4 | **Shared packages** — `utils`, `domain`, `ui` (tokens + 9 primitives shadcn + composants Numpad etc.), `supabase` (client + types) | `2026-05-03-breakery-04-shared-packages.md` | 1 (parallèle avec 2-3) |
| 5 | **App POS** — login, shift, cart, payment terminal, intégration Supabase, store Zustand, hooks TanStack | `2026-05-03-breakery-05-app-pos.md` | 2, 3, 4 |
| 6 | **App Backoffice** — login, layout, page products read-only | `2026-05-03-breakery-06-app-backoffice.md` | 2, 3, 4 |
| 7 | **CI + finalisation** — GitHub Actions, smoke tests E2E des critères d'acceptation, tag v0.1.0 | `2026-05-03-breakery-07-ci-finalize.md` | 5, 6 |

## Parallélisation possible

- **2 et 4** peuvent démarrer en parallèle (DB est indépendante des packages frontend)
- **3** peut démarrer dès que **2** a posé les types de tables (migration auth + RPC)
- **5** et **6** peuvent démarrer en parallèle dès que 2-3-4 sont complets
- **7** est séquentiel à la fin

Pour exécution Ruflo swarm : phases 2/4 lancées en même temps, puis 3, puis 5/6, puis 7.

## Critères d'acceptation finaux

Repris du spec section 10. **Status à jour 2026-05-10** (après sessions 1-8) :

- [x] `pnpm install` clean
- [x] `pnpm dev` démarre les 2 apps (pos:5173, backoffice:5174)
- [x] `pnpm lint` 0 warning — validé 2026-05-10
- [x] `pnpm typecheck` 0 erreur — validé 2026-05-10
- [x] `pnpm test` ≥ 90% `domain`, ≥ 85% `utils`, ≥ 70% `ui`, smoke tests OK — 643/643 tests green
- [x] `pnpm build` produit `dist/` propre pour les 2 apps — fixé 2026-05-10 (target es2022)
- [x] `supabase start` + `supabase db reset` applique les migrations + seed — 16 migrations en session 8
- [x] Login PIN `1234` ouvre POS, modal "Open Shift" apparaît — session 1
- [x] Open Shift opening_cash 100,000 → session créée — session 1
- [x] Tap 2 produits → cart mis à jour, totaux PB1 corrects — session 1
- [x] Tap CHECKOUT → payment terminal full-screen — session 1
- [x] Tap CASH + Exact + PROCESS PAYMENT → success modal Order #XXXX — session 1
- [x] DB : `orders` + `order_items` + `order_payments` + `stock_movements` créés, `products.current_stock` baissé — session 1
- [x] `audit_logs` contient `session.open` + `order.complete` — session 1
- [x] Backoffice login + `/backoffice/products` affiche 8 produits seedés — session 1
- [x] Sentry init capture une erreur volontaire — `apps/pos/src/lib/sentry.ts`
- [ ] CI verte sur le commit final — workflow runs only on master/main; pending merge of `swarm/session-8`

## Conventions de commit

`<type>(<scope>): <message>` en anglais. Types : `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `build`, `ci`. Scopes : `monorepo`, `db`, `edge`, `ui`, `domain`, `utils`, `supabase`, `pos`, `backoffice`, `ci`.

Exemples :
- `chore(monorepo): init turborepo + pnpm workspaces`
- `feat(db): add init_pos migration with orders + order_items`
- `feat(ui): add Numpad component with tests`
- `feat(pos): wire CartStore to Supabase via useCheckout`
