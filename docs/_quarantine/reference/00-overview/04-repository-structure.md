<!-- STALE-V2 -->
> ⚠️ **DOC HISTORIQUE — PÉRIMÉE (V2), NE FAIT PLUS FOI.** Ce fichier décrit en grande partie l'architecture **V2** (mono-app AppGrav, npm/Vercel, PWA/Capacitor, projet Supabase `abjabuniwkqpfsenxljp` = **prod incompatible**, versions RPC obsolètes). **Ne jamais l'appliquer tel quel** (migration, config, archi). Sources de vérité actuelles : `CLAUDE.md` (patterns + workplan) et `docs/workplan/remise-a-plat/` (référence modules réel-vs-demandé). Hiérarchie complète : `docs/README.md`. Régénération depuis le code prévue en Phase 3.

# 03 — Repository Structure

> **Last verified**: 2026-05-03

## Vue d'ensemble du repo

```
appGrav-v2/
├── src/                       # ← Monolith V2 (objet de cette doc)
├── supabase/                  # ← Migrations + Edge Functions V2
├── public/                    # Assets statiques (PWA icons, offline.html)
├── android/ · ios/            # Capacitor native projects (générés)
├── breakery-platform/         # ⛔ V3 reconstruction — IGNORER pour cette doc
│   ├── apps/{caissapp,backoffice,kitchen,comptable}/
│   ├── packages/{tokens,core,types,supabase,ui,...}/
│   ├── _bmad/                 # Artefacts BMAD (epics, PRD, stories)
│   └── CLAUDE.md              # Conventions V3 (séparées)
├── docs/
│   ├── v2/                    # Spec V2 historique (11 modules + APP_REFERENCE)
│   ├── v2-reference/          # ← CETTE DOCUMENTATION
│   ├── audit/                 # 8 rapports d'audit (2026-04-09)
│   └── _archive/              # V1 + stories pré-BMAD archivées
├── scripts/                   # Scripts utilitaires repo-wide (ex. setup-vercel)
├── .claude/                   # Settings + hooks + skills + commandes BMAD
├── CLAUDE.md                  # Instructions principales agents IA
├── DESIGN.md                  # Source design Luxe Dark
├── CURRENT_STATE.md           # Sprint progress vivant
├── README.md                  # Intro repo
├── package.json
├── vite.config.ts             # Build SPA
├── tsconfig.json + tsconfig.node.json
├── tailwind.config.js · postcss.config.js
├── eslint.config.js
├── components.json            # shadcn/ui registry
├── capacitor.config.ts        # Bundle ID, app name natif
├── vercel.json                # Deploy Vercel
├── index.html                 # Entry HTML Vite
└── .env(.example)             # Variables d'environnement
```

## V2 vs V3 — règle d'or

| Si tu travailles sur... | Tu es dans... | Conventions à suivre |
|---|---|---|
| Le POS production actuel | `src/` + `supabase/` | Cette doc + `CLAUDE.md` racine |
| La reconstruction Turborepo | `breakery-platform/` | `breakery-platform/CLAUDE.md` |
| Documentation V2 | `docs/reference/` (cette doc) | Conventions de cette doc |
| Stories BMAD V3 | `breakery-platform/_bmad/` | Pipeline BMAD |

**Ne mélange jamais V2 et V3 dans le même fichier.** Si une story V3 importe du V2, elle doit être conçue pour ne pas modifier `src/` directement (cf. pitfall « V2↔V3 stories +3pts » dans `CLAUDE.md`).

## Détail `src/` (monolith V2)

```
src/
├── main.tsx                   # Entry — monte React, init Sentry, Capacitor
├── App.tsx                    # Root component — providers + router
├── index.css                  # CSS variables Luxe Dark + Tailwind base
├── components/                # 248 fichiers — par feature (16 dossiers)
│   ├── pos/ (86) · settings/ (30) · ui/ (29 shadcn primitives)
│   ├── customers/ (25) · reports/ (17) · accounting/ · auth/
│   ├── expenses/ · inventory/ · kds/ · lan/ · mobile/
│   ├── orders/ · permissions/ · products/ · purchasing/
├── pages/                     # 364 fichiers — par route (19 dossiers)
│   ├── reports/ (93) · inventory/ (64) · settings/ (42)
│   ├── b2b/ (37) · products/ (30) · accounting/ · admin/
│   ├── auth/ · customers/ · expenses/ · kds/ · mobile/
│   ├── orders/ · pos/ · production/ · purchasing/ · tablet/ · users/
├── hooks/                     # 166 fichiers — react-query hooks (18 sous-dossiers)
│   ├── pos/ (26) · settings/ (20) · inventory/ (18)
│   ├── products/ (15) · purchasing/ (15) · accounting/ (13)
│   ├── kds/ (9) · lan/ (6) · reports/ (6) · customers/ (5)
│   ├── expenses/ (4) · auth/ (3) · promotions/ (2)
│   ├── b2b · orders · pricing · shift · tablet (1 chacun)
├── services/                  # 101 fichiers — logique métier (27 modules)
│   ├── pos/ (14) · financial/ (10) · accounting/ (10)
│   ├── lan/ (8) · payment/ (7) · auth/ · b2b/ · customers/
│   ├── export/ · inventory/ · kds/ · mobile/ · print/
│   ├── promotion/ · purchasing/ · reports/ · settings/
│   └── ... (voir 04-modules/00-modules-index.md)
├── stores/                    # 14 stores Zustand (voir 01-architecture/03)
│   ├── authStore.ts · cartStore.ts · paymentStore.ts
│   ├── orderStore.ts · displayStore.ts · mobileStore.ts
│   ├── lanStore.ts · terminalStore.ts · tabletOrderStore.ts
│   ├── posLocalSettingsStore.ts · splitItemStore.ts
│   ├── settingsStore.ts (+ coreSettingsStore facade)
│   └── resetAllStores.ts
├── types/                     # 19 fichiers
│   ├── database.generated.ts  # ⚠️ généré par Supabase CLI — ne pas éditer
│   ├── database.enums.ts      # ⚠️ source of truth pour les enums
│   ├── accounting.ts · auth.ts · orders.ts · payment.ts
│   └── customers · inventory · pos · products · etc.
├── routes/                    # 9 fichiers de routing (~116 routes au total)
│   ├── index.tsx (root + composition)
│   ├── posRoutes.tsx · inventoryRoutes.tsx · accountingRoutes.tsx
│   ├── salesRoutes.tsx · productRoutes.tsx · customerRoutes.tsx
│   ├── mobileRoutes.tsx · adminRoutes.tsx
├── layouts/
│   └── BackOfficeLayout.tsx   # Sidebar + header pour /backoffice
├── lib/                       # Plomberie partagée
│   ├── supabase.ts            # Client singleton
│   ├── sentry.ts              # Init monitoring
│   ├── safeStorage.ts         # localStorage guard (Capacitor compat)
│   └── utils.ts               # cn() helper, etc.
└── utils/                     # Utilitaires métier
    ├── stockStatus.ts · unitConversion.ts · helpers.ts
    └── ... (+ tests)
```

## Détail `supabase/`

```
supabase/
├── migrations/                # 223+ fichiers SQL chronologiques
│   └── YYYYMMDDHHMMSS_<slug>.sql
├── functions/                 # 17 Edge Functions Deno
│   ├── auth-get-session/      # Récupère session courante
│   ├── auth-verify-pin/       # Login PIN
│   ├── auth-change-pin/       # Changement PIN
│   ├── auth-logout/           # Logout
│   ├── set-user-pin/          # Set/reset PIN admin
│   ├── auth-user-management/  # CRUD users
│   ├── create-admin-user/     # Bootstrap admin
│   ├── list-auth-users/       # List + filtres
│   ├── generate-invoice/      # PDF invoice (jsPDF côté Deno)
│   ├── send-to-printer/       # Pont vers print server LAN
│   ├── calculate-daily-report/# End-of-day summaries
│   ├── claude-proxy/          # LLM proxy
│   ├── purchase_order_module/ # Logique PO (validation, transitions)
│   ├── intersection_stock_movements/ # Calculs stock
│   ├── send-test-email/       # Test SMTP
│   └── ... (config.json par fonction)
├── seed.sql                   # (si présent) seed initial
└── config.toml                # Config CLI Supabase (si présent)
```

## Conventions de nommage

| Élément | Convention | Exemple |
|---|---|---|
| Composants React | `PascalCase.tsx` | `ProductCard.tsx`, `PaymentModal.tsx` |
| Hooks | `useCamelCase.ts` | `useProducts.ts`, `useCartPromotions.ts` |
| Services | `camelCaseService.ts` ou `camelCase.ts` | `accountingEngine.ts`, `printService.ts` |
| Stores | `camelCaseStore.ts` | `authStore.ts`, `cartStore.ts` |
| Types | `camelCase.ts` | `accounting.ts`, `payment.ts` |
| Pages | `PascalCase.tsx` | `OrderDetail.tsx`, `CashReconciliation.tsx` |
| Migrations SQL | `YYYYMMDDHHMMSS_snake_case.sql` | `20260423143000_add_kds_stations.sql` |
| Tables DB | `snake_case_plural` | `order_items`, `journal_entries` |
| Colonnes DB | `snake_case` | `created_at`, `total_amount_idr` |
| Enums DB | `snake_case` ou `enum_name` | `order_status`, `payment_method_type` |
| FKs | `{table_singular}_id` | `customer_id`, `product_id` |
| Edge Functions | `kebab-case` ou `snake_case` | `auth-verify-pin`, `purchase_order_module` |
| Permissions | `module.action` | `sales.create`, `accounting.journal.create` |

## Fichiers de config racine

| Fichier | Rôle |
|---|---|
| `vite.config.ts` | Build Vite, plugins (React, PWA, Sentry, visualizer), aliases, server options |
| `tsconfig.json` + `tsconfig.node.json` | TypeScript app + TypeScript Node tooling |
| `tailwind.config.js` | Theme Luxe Dark, content scan, plugins (animate) |
| `postcss.config.js` | Tailwind + autoprefixer |
| `eslint.config.js` | Flat config — règles TS / React / hooks |
| `components.json` | Registry shadcn/ui (style, paths, aliases) |
| `capacitor.config.ts` | Bundle ID, app name, plugins natifs |
| `vercel.json` | Build command + rewrites SPA |
| `index.html` | Entry HTML — script `/src/main.tsx`, meta PWA |
| `.env(.example)` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `VITE_PLATFORM` |
| `.eslintignore`, `.gitignore` | Exclusions |
| `package.json` + `package-lock.json` | Dépendances |

## Fichiers protégés

Le hook `protect-files.sh` (cf. `.claude/settings.json`) bloque toute édition AI sur :
- `.env`, `.env.*`
- `package-lock.json`
- `src/types/database.generated.ts` (régénérer via `/gen-types`)

## Liens

- Convention détaillées : [`11-conventions/01-coding-conventions.md`](../11-conventions/01-coding-conventions.md)
- Frontend détaillé : [`01-architecture/02-frontend-architecture.md`](../01-architecture/02-frontend-architecture.md)
- Routing détaillé : [`01-architecture/04-routing.md`](../01-architecture/04-routing.md)
