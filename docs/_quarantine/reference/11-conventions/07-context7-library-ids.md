<!-- STALE-V2 -->
> ⚠️ **DOC HISTORIQUE — PÉRIMÉE (V2), NE FAIT PLUS FOI.** Ce fichier décrit en grande partie l'architecture **V2** (mono-app AppGrav, npm/Vercel, PWA/Capacitor, projet Supabase `abjabuniwkqpfsenxljp` = **prod incompatible**, versions RPC obsolètes). **Ne jamais l'appliquer tel quel** (migration, config, archi). Sources de vérité actuelles : `CLAUDE.md` (patterns + workplan) et `docs/workplan/remise-a-plat/` (référence modules réel-vs-demandé). Hiérarchie complète : `docs/README.md`. Régénération depuis le code prévue en Phase 3.

# 07 — Context7 pinned library IDs

> **Last verified**: 2026-06-17

[Context7](https://context7.com) fournit la documentation **à jour** d'une librairie directement dans l'agent (CLI `ctx7` + skill `find-docs`). Cette page épingle les **IDs Context7 version-matchés** aux dépendances réelles du monorepo, pour que n'importe quel poste (ou agent) tape directement le bon ID/version sans étape de résolution et **sans risquer une doc de mauvaise version**.

## Setup (une fois par poste)

```bash
npx ctx7@latest setup        # CLI + Skills, login Context7 (compte perso)
```

Cela installe globalement `~/.claude/skills/find-docs` + la rule `~/.claude/rules/context7.md`. La table ci-dessous est spécifique au projet et vit dans le dépôt.

## Usage

```bash
# Fetch direct depuis l'ID épinglé (PAS besoin de relancer `library`)
npx ctx7@latest docs <id> "<ta question>"
```

## IDs épinglés (version-matchés)

| Lib (version projet) | Context7 ID | Piège de version évité |
|---|---|---|
| TanStack Query (`^5.62`) | `/websites/tanstack_query_v5` | v4 ; canonique multi-framework = `/tanstack/query` |
| React Router DOM (`^6.28`) | `/websites/reactrouter_6_30_3` | **v7** — ne PAS utiliser `/remix-run/react-router` |
| Zustand (`^4.5`) | `/pmndrs/zustand` | — |
| Recharts (`^2.13`) | `/recharts/recharts` | — |
| Supabase (Edge Fn Deno, RLS, RPC) | `/supabase/supabase` | full llms.txt = `/llmstxt/supabase_llms-full_txt` ; CLI = `/supabase/cli` |
| Tailwind CSS (`^3.4`) | `/websites/v3_tailwindcss` | **v4** — `/websites/tailwindcss` est la v4 |
| dnd-kit (`^6` / sortable `^8`) | `/clauderic/dnd-kit` | — |
| SheetJS xlsx (`^0.18.5`) | `/websites/sheetjs` | — |
| Vitest (`^2.1`) | `/vitest-dev/vitest` | — |
| Playwright (`^1.49`) | `/microsoft/playwright` | — |

React 18.2, sonner 2, `@sentry/react` 10, lucide-react : stables, à résoudre à la demande si besoin (`npx ctx7@latest library "<nom>" "<question>"`).

## Pour une version précise

Utiliser le format `/org/projet/version` retourné par `library` (ex. `/vercel/next.js/v14.3.0`).

## À utiliser pour / pas pour

- **Pour** : syntaxe d'API, options de config, migration de version, setup, debug spécifique à une lib, usage CLI.
- **Pas pour** : refactoring, logique métier, revue de code, concepts de prog généraux.
