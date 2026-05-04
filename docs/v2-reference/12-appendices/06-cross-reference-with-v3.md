# 06 — Cross-reference V2 → V3

> **Last verified**: 2026-05-03

Cette page établit la **carte de migration** entre la structure V2 (monolith Vite/React dans `src/`) et la structure V3 (Turborepo monorepo dans `breakery-platform/`). Elle sert de référence aux stories BMAD pour identifier les correspondances et aux développeurs qui touchent les deux côtés.

> Source de vérité V3 : [`breakery-platform/CLAUDE.md`](../../../breakery-platform/CLAUDE.md) + `_bmad/output/planning-artifacts/architecture/project-structure-boundaries.md`.

---

## 1. Cartographie générale

```
appGrav-v2/                              ← racine repo
├── src/                                 ← V2 monolith (Vite + React)
│   ├── components/   pages/  hooks/
│   ├── services/     stores/  types/
│   └── routes/       layouts/
├── supabase/                            ← partagé V2 + V3 (DB, migrations, Edge Fn)
│   ├── migrations/
│   └── functions/
├── public/                              ← assets V2
└── breakery-platform/                   ← V3 Turborepo monorepo
    ├── apps/
    │   ├── caissapp/                    ← future POS V3
    │   ├── backoffice/                  ← future BackOffice V3
    │   ├── kitchen/                     ← future KDS V3
    │   └── comptable/                   ← future Comptable V3
    └── packages/
        ├── core/                        ← logique métier partagée
        ├── tokens/                      ← design tokens
        ├── types/                       ← types DB partagés
        ├── supabase/                    ← client + helpers
        ├── ui/                          ← primitives UI partagées
        ├── testing/                     ← helpers tests
        ├── eslint-config/               ← preset ESLint
        └── typescript-config/           ← presets tsconfig
```

---

## 2. Mapping modules métier

| Module V2 | Chemin V2 | App V3 cible | Chemin V3 prévu | Statut migration |
|---|---|---|---|---|
| POS — terminal de caisse | `src/components/pos/`, `src/pages/pos/` | **caissapp** | `breakery-platform/apps/caissapp/src/...` | ⏳ planifié (epic-008+) |
| Cart & order management | `src/stores/cartStore.ts`, `src/stores/orderStore.ts` | **caissapp** + `@breakery/core` | `apps/caissapp/src/cart/` + `packages/core/src/cart/` | ⏳ planifié |
| Payments & split | `src/stores/paymentStore.ts`, `src/stores/splitItemStore.ts` | **caissapp** + `@breakery/core` | `apps/caissapp/src/payment/` + `packages/core/src/payment/` | ⏳ planifié |
| KDS Kitchen | `src/components/kds/`, `src/pages/kds/` | **kitchen** | `breakery-platform/apps/kitchen/src/...` | ⏳ planifié |
| Customer display | `src/stores/displayStore.ts` + `src/pages/display/` | **caissapp** sub-route | `apps/caissapp/src/display/` | ⏳ planifié |
| Tablet ordering | `src/components/tablet/`, `src/stores/tabletOrderStore.ts` | **caissapp** | `apps/caissapp/src/tablet/` | ⏳ planifié |
| Mobile shell | `src/components/mobile/`, `src/stores/mobileStore.ts` | **caissapp** (responsive) | `apps/caissapp/src/mobile/` | ⏳ planifié |
| Products & categories | `src/components/products/`, `src/pages/products/` | **backoffice** | `breakery-platform/apps/backoffice/src/products/` | ⏳ planifié |
| Inventory & stock | `src/components/inventory/`, `src/pages/inventory/` | **backoffice** | `apps/backoffice/src/inventory/` | ⏳ planifié |
| Purchasing | `src/components/purchasing/`, `src/pages/purchasing/` | **backoffice** | `apps/backoffice/src/purchasing/` | ⏳ planifié |
| Customers & loyalty | `src/components/customers/`, `src/pages/customers/` | **backoffice** | `apps/backoffice/src/customers/` | ⏳ planifié |
| B2B wholesale | `src/components/b2b/`, `src/pages/b2b/` | **backoffice** | `apps/backoffice/src/b2b/` | ⏳ planifié |
| Expenses | `src/components/expenses/`, `src/pages/expenses/` | **backoffice** + **comptable** | dual : `apps/backoffice/expenses/` (saisie) + `apps/comptable/expenses/` (validation) | ⏳ planifié |
| Accounting (double-entry) | `src/components/accounting/`, `src/pages/accounting/` | **comptable** | `breakery-platform/apps/comptable/src/...` | ⏳ planifié |
| Reports & analytics | `src/components/reports/`, `src/pages/reports/` | **backoffice** + **comptable** | dual selon catégorie | ⏳ planifié |
| Settings & RBAC | `src/components/settings/`, `src/pages/settings/`, `src/pages/users/` | **backoffice** | `apps/backoffice/src/settings/` | ⏳ planifié |
| LAN architecture | `src/services/lan/`, `src/stores/lanStore.ts`, `src/stores/terminalStore.ts` | `@breakery/core` (lib partagée) | `packages/core/src/lan/` | ⏳ planifié |
| Auth & permissions | `src/stores/authStore.ts`, `src/components/auth/` | `@breakery/core` + `@breakery/supabase` | `packages/core/src/auth/` + `packages/supabase/src/auth/` | ⏳ planifié |
| Promotions engine | `src/services/promotion/`, `src/hooks/promotions/` | `@breakery/core` | `packages/core/src/promotions/` | ⏳ planifié |

---

## 3. Mapping infrastructure / partagé

| Élément V2 | Type | V3 destination |
|---|---|---|
| `src/lib/supabase.ts` (client singleton) | infra | **`@breakery/supabase`** (`packages/supabase/`) |
| `src/types/database.generated.ts` | types auto-gen | **`@breakery/types`** (`packages/types/src/database.generated.ts`) — généré par `pnpm gen-types` |
| `src/types/database.enums.ts` | enums | **`@breakery/types`** (`packages/types/src/enums.ts`) |
| `src/types/database.ts` (interfaces métier) | types | **`@breakery/types`** ou par app selon scope |
| `src/utils/logger.ts` | utility | **`@breakery/core`** (`packages/core/src/logger/`) |
| `src/utils/formatters.ts` (round_idr, formatIdr) | utility | **`@breakery/core`** (`packages/core/src/formatters/`) |
| `src/services/errorReporting.ts` | utility | **`@breakery/core`** + Sentry init dans chaque app |
| `src/lib/sentry.ts` | infra | dupliqué par app, config commune dans `@breakery/core/sentry` |
| Design tokens (couleurs, spacing) | design | **`@breakery/tokens`** (`packages/tokens/`) |
| Composants UI primitifs (`src/components/ui/`) | UI | **`@breakery/ui`** (`packages/ui/`) — migration progressive |
| `src/components/ui/ModuleErrorBoundary.tsx` | UI | **`@breakery/ui`** |
| Hooks utilitaires (`useIsMobile`, `useToast`) | utility | **`@breakery/ui`** ou **`@breakery/core`** |

---

## 4. Mapping Supabase (DB & Edge Functions)

| Élément V2 | V3 destination |
|---|---|
| `supabase/migrations/*.sql` | **Inchangé** — `supabase/` reste à la racine repo, partagé V2 + V3 |
| `supabase/functions/*` (16 Edge Fn) | **Inchangé** au plan code. Les Edge Fn lisent les types via `supabase/functions/_shared/types.ts` synchronisé par `pnpm sync-shared` (V3) |
| RPCs PostgreSQL (`complete_order_with_payments`, etc.) | **Inchangées** — types auto-gen partagés |
| RLS policies | **Inchangées** — pattern `is_authenticated()` + `user_has_permission()` reste source de vérité |
| Realtime channels | **Inchangées** au plan DB. Côté app : potentielle évolution vers convention `@breakery/supabase/realtime/` |

---

## 5. Stratégie hybride V2 ↔ V3 — phases

### Phase actuelle (mai 2026) : V2 monolith en prod, V3 en construction

- V2 sert toute la production
- V3 construit les packages partagés (`@breakery/types`, `@breakery/core`, `@breakery/supabase`, `@breakery/tokens`, `@breakery/ui`)
- Aucune app V3 encore déployée
- Migrations DB et Edge Functions partagées

### Phase intermédiaire (planifiée) : V2 importe certains packages V3

- V2 commence à consommer `@breakery/types` (déjà partiellement via `sync-shared`)
- V2 peut adopter `@breakery/core` pour des utilitaires (formatters, logger)
- **Pré-requis** : wiring foundational complet (cf. pitfall #12 dans `11-conventions/06-pitfalls.md`)

### Phase cible : V3 prend la production app par app

- caissapp V3 remplace `/pos`, `/kds`, `/display`, `/tablet`, `/mobile`
- backoffice V3 remplace `/products`, `/inventory`, `/purchasing`, `/customers`, `/b2b`, `/settings`, `/users`, `/reports`
- comptable V3 prend `/accounting` + reports financiers
- V2 monolith déprécié, conservé en archive le temps de la transition

> Calendrier dans `_bmad/output/planning-artifacts/` (pas figé — guidé par les épics BMAD).

---

## 6. Pitfall critique — wiring foundational

Avant qu'un fichier V2 (`src/`, `supabase/functions/*`) puisse importer un package `@breakery/*`, **les 4 conditions** doivent être réunies (sinon coût caché +3 pts dans toute story) :

1. `breakery-platform/pnpm-workspace.yaml` glob couvre l'entrée V2
2. `package.json` racine déclare la dépendance workspace `@breakery/*`
3. `vite.config.ts` V2 résout le package (alias ou paths)
4. `tsconfig.json` V2 paths matchent

**Référence** : [`11-conventions/06-pitfalls.md`](../11-conventions/06-pitfalls.md) §12 (retro epic-005 SB-007).

---

## 7. Conventions divergentes V2 vs V3

| Sujet | V2 | V3 |
|---|---|---|
| Package manager | `npm` | `pnpm` (avec `pnpm-workspace.yaml`) |
| Build tool | Vite (monolith) | Turborepo + Vite par app |
| Tests runner | Vitest (config racine) | Vitest par package + Turbo orchestration |
| ESLint | flat config racine | flat config par package + `--no-config-lookup` en lint-staged |
| Pre-commit hooks | hook Claude `auto-lint.sh`, `protect-files.sh` | husky v9 (`breakery-platform/.husky/`) + lint-staged routing |
| Path alias | `@/` → `src/` | `@/` interne par app, `@breakery/*` cross-package |
| Documentation | `docs/v2-reference/` (cette doc) + `docs/v2/` (legacy) | `_bmad/output/planning-artifacts/` (architecture, epics, PRD) |

---

## 8. Quand toucher V2 vs V3

| Situation | Modifier où ? |
|---|---|
| Fix urgent prod | **V2 uniquement** (`src/`, `supabase/`) — ship vite |
| Nouvelle feature opérationnelle | **V2** sauf si la feature est explicitement positionnée dans l'épic V3 actif |
| Évolution schéma DB | **V2** (migration dans `supabase/migrations/`) → puis `pnpm gen-types` côté V3 répercute dans `@breakery/types` |
| Nouveau composant UI partagé | **V3** dans `@breakery/ui`, puis V2 peut le consommer si wiring OK |
| Nouvelle utility métier (calc taxe, etc.) | **V3** dans `@breakery/core`, puis V2 peut l'importer si wiring OK |
| Story BMAD planifiée | Suit l'épic V3 — voir `_bmad/output/implementation-artifacts/` |

---

## 9. Documents de référence V3

| Doc | Lien | Contenu |
|---|---|---|
| **CLAUDE.md V3** | [`breakery-platform/CLAUDE.md`](../../../breakery-platform/CLAUDE.md) | Conventions monorepo V3, husky, lint-staged, sync-shared |
| **Project structure boundaries** | `_bmad/output/planning-artifacts/architecture/project-structure-boundaries.md` | Frontière apps / packages / scripts |
| **Architecture V3** | `_bmad/output/planning-artifacts/architecture/` | Décisions techniques V3 |
| **PRD V3** | `_bmad/output/planning-artifacts/prd/` | Product Requirements V3 |
| **Epics & stories** | `_bmad/output/planning-artifacts/epics/` | Découpage backlog V3 |
| **Sprint status** | `_bmad/output/implementation-artifacts/sprint-status.yaml` | Statut sprint courant |
| **YOLO trace** | `_bmad/output/implementation-artifacts/yolo-trace.md` | Log chronologique pipeline BMAD |

---

## 10. Liens

- [`05-known-issues-backlog.md`](./05-known-issues-backlog.md) — backlog V2 + sources
- [`../11-conventions/06-pitfalls.md`](../11-conventions/06-pitfalls.md) — pitfall #12 wiring V2↔V3
- [`../00-overview/03-repository-structure.md`](../00-overview/03-repository-structure.md) — structure repo V2 vs V3
- [`../01-architecture/02-frontend-architecture.md`](../01-architecture/02-frontend-architecture.md) — architecture V2 détaillée
- [`breakery-platform/CLAUDE.md`](../../../breakery-platform/CLAUDE.md) — source de vérité V3
- `CLAUDE.md` racine — sections "V3 Reconstruction" et "Chemins canoniques V3"
