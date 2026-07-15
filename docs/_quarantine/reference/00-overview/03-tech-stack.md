<!-- STALE-V2 -->
> ⚠️ **DOC HISTORIQUE — PÉRIMÉE (V2), NE FAIT PLUS FOI.** Ce fichier décrit en grande partie l'architecture **V2** (mono-app AppGrav, npm/Vercel, PWA/Capacitor, projet Supabase `abjabuniwkqpfsenxljp` = **prod incompatible**, versions RPC obsolètes). **Ne jamais l'appliquer tel quel** (migration, config, archi). Sources de vérité actuelles : `CLAUDE.md` (patterns + workplan) et `docs/workplan/remise-a-plat/` (référence modules réel-vs-demandé). Hiérarchie complète : `docs/README.md`. Régénération depuis le code prévue en Phase 3.

# 02 — Tech Stack

> **Last verified**: 2026-05-03 (versions extraites de `package.json`)

## Pile complète

### Frontend
| Technologie | Version | Rôle |
|---|---|---|
| **React** | 18.2.0 | Framework UI |
| **React DOM** | 18.2.0 | Rendu DOM |
| **TypeScript** | 5.2.2 | Typage statique |
| **Vite** | 5.0.8 | Build tool + dev server (port 3000) |
| **React Router DOM** | 6.21.1 | Routing client SPA |
| **Zustand** | 4.4.7 | State management global (14 stores) |
| **TanStack Query** | 5.17.0 | Data fetching, cache, synchronisation Supabase |

> ⚠️ **Pas Next.js**. Ignorer toute suggestion `'use client'`, `proxy.ts`, App Router, Server Components, etc.

### UI / Design
| Technologie | Version | Rôle |
|---|---|---|
| **Tailwind CSS** | 3.4.19 | Utility-first styling |
| **tailwindcss-animate** | 1.0.7 | Animations utilitaires |
| **Radix UI** | divers | Primitives accessibles (dialog, select, tabs, tooltip, scroll-area, separator, slot, alert-dialog, toast) |
| **shadcn/ui** | (vendu) | 29 composants `src/components/ui/` basés sur Radix |
| **Lucide React** | 0.303.0 | Iconographie |
| **next-themes** | 0.4.6 | Switch dark/light (la prod tourne en dark "Luxe Dark") |
| **class-variance-authority** | 0.7.1 | Variants composants type-safe |
| **clsx** | 2.1.1 + **tailwind-merge** 3.4.0 | Composition `className` |
| **Sonner** | 2.0.7 | Toast notifications |
| **cmdk** | 1.1.1 | Command palette (recherche globale) |
| **Recharts** | 3.6.0 | Charts pour reports (BarChart, LineChart, PieChart, etc.) |
| **react-day-picker** | 9.13.0 | Date picker |
| **@dnd-kit/core** | 6.3.1 + sortable 10.0.0 + utilities 3.2.2 | Drag & drop (KDS, ordering) |

### Backend (BaaS)
| Technologie | Version | Rôle |
|---|---|---|
| **Supabase JS** | 2.93.3 | Client Postgres + Auth + Realtime + Storage + Edge Functions |
| **Supabase CLI** | 2.75.0 | Migrations + types generation + deploy |
| **PostgreSQL** | 15+ (Supabase managed) | Base de données |
| **Deno** | (Supabase Edge runtime) | Runtime des 17 Edge Functions |

### Mobile / Native
| Technologie | Version | Rôle |
|---|---|---|
| **Capacitor Core** | 7.5.0 | Bridge web ↔ natif Android/iOS |
| **@capacitor/android** | 7.5.0 | Android plugin |
| **@capacitor/ios** | 7.5.0 | iOS plugin |
| **@capacitor/app** | 7.1.2 | Lifecycle app native |
| **@capacitor/keyboard** | 7.0.4 | Gestion clavier mobile |
| **@capacitor/splash-screen** | 7.0.5 | Splash screen |
| **@capacitor/status-bar** | 7.0.5 | Status bar |
| **@capacitor/cli** | 7.5.0 | CLI build |
| **@capacitor/assets** | 3.0.5 | Génération icônes/splash |

### PWA
| Technologie | Version | Rôle |
|---|---|---|
| **vite-plugin-pwa** | 1.2.0 | Manifest + service worker |
| **workbox-window** | 7.4.0 | Workbox côté client |

### Monitoring
| Technologie | Version | Rôle |
|---|---|---|
| **@sentry/react** | 10.47.0 | Capture erreurs, traces (20 %), session replay (10 % / 100 % on error), PII scrubbing |
| **@sentry/vite-plugin** | 5.2.0 | Upload sourcemaps `hidden` au build |

### Export / Documents
| Technologie | Version | Rôle |
|---|---|---|
| **jsPDF** | 4.0.0 | Génération PDF (factures, rapports) |
| **jsPDF-AutoTable** | 5.0.7 | Tableaux PDF |
| **xlsx-js-style** | 1.2.0 | Export Excel avec styles |
| **date-fns** | 4.1.0 | Manipulation dates |

### IA / Agent
| Technologie | Version | Rôle |
|---|---|---|
| **@anthropic-ai/sdk** | 0.71.2 (devDep) | Scripts internes (test claude) |
| Edge Function `claude-proxy` | — | Proxy LLM côté serveur |

### Tests
| Technologie | Version | Rôle |
|---|---|---|
| **Vitest** | 2.1.9 | Test runner |
| **@vitest/coverage-v8** | 2.1.9 | Couverture |
| **@testing-library/react** | 16.3.1 | Tests composants |
| **@testing-library/jest-dom** | 6.9.1 | Matchers DOM |
| **jsdom** | 26.1.0 | Environnement DOM Node |

### Lint / Format / Build
| Technologie | Version | Rôle |
|---|---|---|
| **ESLint** | 8.57.1 | Linting (`--max-warnings 80`) |
| **typescript-eslint** | 8.54.0 | Règles TS |
| **eslint-plugin-react** | 7.37.5 | Règles React |
| **eslint-plugin-react-hooks** | 7.0.1 | Règles hooks |
| **PostCSS** | 8.5.6 + **autoprefixer** 10.4.23 | Pipeline CSS |
| **rollup-plugin-visualizer** | 6.0.5 | Analyse bundle (`build:analyze`) |
| **dotenv** | 17.2.3 | Variables d'environnement |
| **ts-node** | 10.9.2 | Exécution scripts TS |

## Hosting & infra

| Service | Détails |
|---|---|
| **Vercel** | Hosting Vite SPA — projet `the-breakery-pos`, URL prod `https://the-breakery-pos.vercel.app/`. Voir [`10-deployment-ops/01-vercel-deployment.md`](../10-deployment-ops/01-vercel-deployment.md). |
| **Supabase** | Project `the-breakery-pos`, ID `abjabuniwkqpfsenxljp`, région `ap-southeast-1` (Singapore). Voir [`10-deployment-ops/02-supabase-environments.md`](../10-deployment-ops/02-supabase-environments.md). |
| **Sentry** | Org `the-breakery`, project `appgrav-v2`. Dashboard `https://the-breakery.sentry.io/`. |

## Engines

- **Node.js** ≥ 22.12.0 (déclaré dans `package.json`)
- **npm** (lock file `package-lock.json`)

## Path alias

| Alias | Cible |
|---|---|
| `@/` | `src/` |

Configuré dans `vite.config.ts` et `tsconfig.json` (section `compilerOptions.paths`).

## Scripts npm clés

| Script | Effet |
|---|---|
| `npm run dev` | Vite dev server, port 3000 |
| `npm run build` | `tsc -b && vite build` |
| `npm run lint` | ESLint avec seuil 80 warnings |
| `npm run preview` | Preview du build prod |
| `npm run test:smoke` | Smoke test POS (vitest) |
| `npx vitest run` | Lance toute la suite (~1770 tests / 71 fichiers) |
| `npm run android:sync` | Build + `cap sync android` |
| `npm run android:build` | Build + sync + `cap open android` |
| `npm run android:live` | `cap run android` |
| `npm run build:analyze` | Build avec rollup-visualizer |
| `npm run assets:generate` | Génère icônes/splash Capacitor |

## Hors scope (suggestions à ignorer)

| Suggestion AI courante | Pourquoi non applicable ici |
|---|---|
| `'use client'` directives | Pas Next.js |
| App Router / `app/` directory | Pas Next.js |
| Server Components | Pas Next.js |
| `getServerSideProps` / `getStaticProps` | Pas Next.js |
| Internationalization (`i18next`, `next-intl`) | i18n explicitement suspendue (anglais only) |
| Offline-first POS | Politique online-only |
