# report-audit — modèle, contrats et repères

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Contexte et conventions
- When to Use
- DEFER (do NOT do here)
- V3 Architecture Context (verified)
- Anti-lois de cette fiche

# Report Audit — The Breakery V3 (apps/backoffice)

Systematic auditor for the V3 reporting module. Reads the **real** code across the V3 stack to find errors,
inconsistencies, and gaps — then proposes interactive fixes one by one with user confirmation.

> **Ancrages re-vérifiés contre le code le 2026-08-31.** Tout ce qui suit (chemins, composants, familles de
> RPC, conventions) a été relevé dans l'arbre à cette date. Le module bouge vite : au-delà de quelques
> semaines, re-vérifie un chemin ou un nom **avant** de le citer dans un finding. Un nombre gravé est une
> dette — cette fiche n'en pose aucun et renvoie aux commandes de relevé.

**This is the AUDIT skill.** Its sibling `reports-exports` is the GUIDE/BUILD skill (surface map, how to wire
a new report, export pipeline). When you need the canonical surface map (full RPC list, PDF templates,
Z-report flow, drill-down entities), read `reports-exports` instead of re-deriving it. `CLAUDE.md` is the
source of truth for global patterns (RPC versioning, REVOKE pair, PIN header, idempotency).

## When to Use

- A report shows wrong / missing / empty data
- A chart "doesn't match the data" or "the bars are wrong"
- A date picker appears decorative (data doesn't change on date change)
- Hunting for missing reports / coverage gaps
- Periodic quality pass after a schema or RPC change

## DEFER (do NOT do here)

- **Money/fraud/RBAC integrity, audit-log completeness, anon hardening** → `security-fraud-guard`
- **CLAUDE.md pattern compliance of a branch/diff** (REVOKE pairs, append-only ledgers, versioning) → `pattern-guardian`
- **Accounting math** (JE balance, COA mapping, PB1 formula, trial-balance correctness) → `accounting`
- **Inventory/WAC/recipe-cost/production math** → `stock-management`
- **Building a NEW report, export wiring, Z-report flow, drill-down entity** → `reports-exports`

This skill owns **report correctness as displayed**: does the page fetch the right RPC, map the payload to
the right fields, and render a chart that truthfully represents the data?

## V3 Architecture Context (verified)

There is **no `services/reporting` layer and no central `ReportsConfig`** (those were V2). The V3 data flow:

```
Supabase RPC (SECURITY DEFINER, _vN, REVOKE pair)
  → React Query hook            apps/backoffice/src/features/reports/hooks/use<Name>.ts
    → Page component            apps/backoffice/src/pages/reports/<Name>Page.tsx
      → ReportShell / KpiBand / PeriodControl / BreakdownCard / charts wrappers / chartColors
        → Export                ExportMenu → buildCsv (domain) + useGeneratePdf (generate-pdf EF)
```

### Where things actually live (V3)

| Layer | Location | Notes |
|-------|----------|-------|
| Report pages | `apps/backoffice/src/pages/reports/*.tsx` | one file per report + the hub, no central config. Pour un décompte : `ls apps/backoffice/src/pages/reports/` |
| Hub | `apps/backoffice/src/pages/reports/ReportsIndexPage.tsx` | tuiles groupées par famille, dérivées d'une table locale ; pas un fichier de config. Compte par famille dérivé, jamais écrit à la main |
| Routing | `apps/backoffice/src/routes/index.tsx` | lazy routes, each wrapped in `<PermissionGate required="reports.*.read">` — `required` accepts a **string or an array** of codes |
| Hooks | `apps/backoffice/src/features/reports/hooks/use*.ts` | one per report; each calls one RPC via React Query. `useReportPeriod` porte la période + le comparatif |
| Shared components | `apps/backoffice/src/features/reports/components/` | relever par `ls` ; l'ossature vivante est `ReportShell`, `KpiBand`, `PeriodControl`, `ExportMenu`, `BreakdownCard`, `SortableTh`, `DeltaPct`, `DrilldownLink`, `VarianceLegend` |
| Chart wrappers | `apps/backoffice/src/features/reports/components/charts/` | `PairedBarsChart`, `StackedBarsChart`, `TrendLineChart`, `ParetoChart` (Recharts) + `HeatmapGrid` (vraie `<table>`, pas de Recharts) |
| Report-local utils | `apps/backoffice/src/features/reports/utils/` | `buildDrilldownUrl.ts`, `chartColors.ts`, `parse.ts` (normalisation des enveloppes JSONB), `reportFigures.ts` (delta / part / top-N), `varianceScale.ts` (LE barème de variance, légende obligatoire) |
| Domain helpers (pure TS) | `packages/domain/src/reports/` | `csv.ts`, `period.ts`, `toLocalDateStr.ts`, `aggregations.ts`, `customerSales.ts`, `purchasePrices.ts` |
| Types | **co-located with each hook** + `packages/domain/src/reports` | no central `types/reporting.ts` |
| Report RPCs | `supabase/migrations/*report*.sql` (+ others) | famille `get_<name>`, versionnée `_vN`, SECURITY DEFINER |
| PDF | `supabase/functions/generate-pdf/` + `_shared/pdf-templates/` | le registry `TEMPLATES` de `_shared/pdf-templates/index.ts` **est** la liste — lire le fichier, ne jamais citer un nombre |

### V3 conventions (verified — use these, not the V2 ones)

- **Currency: IDR.** Formatters `formatIdrFull` / `formatIdrCompact` / `formatIdrPrecise` in `features/reports/utils/chartColors.ts`; CSV uses the `'idr-round100'` format (rounds to nearest 100) from `packages/domain/src/reports/csv.ts`. Locale `'id-ID'`.
- **Timezone: `Asia/Makassar` (UTC+8).** Use `toLocalDateStr()` / `toLocalDayStartUTC()` / `toLocalDayEndUTC()` from `packages/domain/src/reports/toLocalDateStr.ts` for date-column comparisons — **`.toISOString()` slices for a local-date filter are an off-by-one bug.** (These helpers DO exist in V3.) Côté SQL en revanche, le fuseau métier est un **paramètre de session PostgreSQL posé pour toute la base** : un cast `::date` sur un `timestamptz` rend DÉJÀ le bon jour métier. Ne jamais conclure à un décalage de fuseau dans une RPC sans l'avoir vérifié **sur les données** ; `business_config.timezone` est un miroir, pas l'autorité.
- **No i18n.** No `useTranslation` / i18next — don't flag a missing `t()`. Mais l'absence de lib i18n n'est PAS une absence de règle :
  **l'interface parle ANGLAIS, les commentaires et la doc parlent français** (`CLAUDE.md`). Les chaînes sont
  en dur dans le JSX ; c'est exactement pour ça qu'elles dérapent.
  - Preuve à date : `DailySalesPage.tsx` rend `title="Daily sales"`, `title="Net revenue by day"`,
    `"Revenue by category"`, `"Top products"`, `"Register close"` — anglais, en-tête de fichier français.
  - **Aucune garde CI ne surveille la langue** — les gardes gouvernance de `scripts/ci/` couvrent le design,
    les liens, les couleurs et la formule de prix de ligne ; aucune n'est linguistique (`ls scripts/ci/`). Le
    français glisse par réflexe de session, et deux PR consécutives (#429, #433) n'ont servi qu'à l'en
    ressortir. **L'audit est le seul filet.**
  - Donc : `FRENCH_IN_UI` est un finding **P2** (P1 si le libellé est sur un chemin visible en permanence —
    titre de page, tuile du hub, colonne de tableau, toast d'erreur). Cible : tout libellé, placeholder,
    toast, message d'erreur, `aria-label`, en-tête de colonne, entrée de légende, titre d'export.
  - **Ne jamais « corriger » un commentaire ou une docstring vers l'anglais** : le français y est la règle.
    La frontière est le rendu — ce qui sort dans le DOM ou dans un CSV/PDF est de l'UI, le reste non.
- **`select('*')` is mostly N/A** at the hook layer — report data comes from RPCs. The equivalent check lives **inside the RPC's SQL** and in any page that queries a table directly (e.g. an audit/log page). Flag `select('*')` only where a component/RPC actually does a raw select.
- **Permissions are route-level** via `<PermissionGate required="reports.<domain>.read">` in `routes/index.tsx` (codes : `reports.read`, `reports.sales.read`, `reports.inventory.read`, `reports.financial.read`, `reports.audit.read`). `required` prend aussi un **tableau** de codes pour un rapport à cheval sur deux domaines — un tableau n'est donc pas un `PERM_MISMATCH`. There is **no `useReportPermissions` hook**. Le hub, lui, montre TOUTES les tuiles : le refus est à l'entrée de la route, intentionnellement — un hub qui se réduit en silence ne dit pas à un gérant qu'un rapport existe mais lui est fermé. Ne pas le signaler comme une fuite.
- **Le PDF a sa propre grille de permissions**, portée par le registry `TEMPLATES` (`permission` par template) — elle ne recopie pas mécaniquement celle de la route. Un écart route↔template se signale, il ne se déduit pas.
- **Build/test is pnpm + turbo**, never `npm`. This is a Vite+React SPA (no Next.js). DB targets Supabase **cloud** V3 dev `ikcyvlovptebroadgtvd` via MCP (Docker retired) — verify RPC/view existence by reading `supabase/migrations/` or `execute_sql`, **never** `supabase db reset`.

## Anti-lois de cette fiche

Quand tu la rédiges ou la cites :
- **Pas de `_vN` pour désigner un objet vivant** — on nomme la FAMILLE (`get_pb1_report`), on lit la version au call-site.
- **Pas de `fichier:ligne`** dans un finding destiné à survivre — ancre stable (nom de composant, de fonction, texte cité).
- **Pas de compteur gravé** — un nombre de pages, de templates ou de rapports se relève par une commande, ou se DATE. Cette fiche n'en contient aucun ; ne lui en ajoute pas.
