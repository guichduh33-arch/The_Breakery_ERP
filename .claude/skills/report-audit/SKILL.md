---
name: report-audit
description: >
  Systematic AUDITOR of the V3 backoffice reports/analytics module (apps/backoffice) — scans every report
  page under `apps/backoffice/src/pages/reports/` across the full V3 stack (report RPC → React Query hook →
  page component → chart wrappers/tables → CSV/PDF export) to find broken data bindings, dead RPC/view
  references, type-vs-payload mismatches, decorative date filters, misleading charts (dual-axis, missing
  stackId, duplicate render), French leaking into the English UI, and coverage gaps. Produces a
  prioritized audit report (P0–P3) then offers interactive fixes one by one. Complementary to the
  `reports-exports` skill (which GUIDES building/wiring reports) — this skill FINDS bugs. Use whenever the
  user reports a broken/inaccurate report, a chart that "doesn't match the data", missing reports, graph
  errors, analytics inconsistencies, a date picker that doesn't filter, or wants a quality audit of reports.
  DEFER: money/fraud/RBAC integrity → security-fraud-guard ; CLAUDE.md pattern compliance of a diff →
  pattern-guardian ; JE/COA/PB1 math correctness → accounting ; WAC/recipe-cost/inventory math →
  stock-management ; building a NEW report or export wiring → reports-exports.
pathPatterns:
  - 'apps/backoffice/src/features/reports/**'
  - 'apps/backoffice/src/pages/reports/**'
  - 'packages/domain/src/reports/**'
promptSignals:
  phrases:
    - 'report audit'
    - 'audit reports'
    - 'broken report'
    - 'report bug'
    - 'inaccurate report'
    - 'chart issue'
    - 'graph error'
    - "chart doesn't match"
    - 'bars don\'t match'
    - 'missing report'
    - 'report data inconsistency'
    - 'analytics problem'
    - 'date filter not working'
    - 'report quality'
    - 'verify reports'
    - 'french in the reports UI'
---

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
        → Export                ExportMenu → ExportButtons → buildCsv (domain) + useGeneratePdf (generate-pdf EF)
```

### Where things actually live (V3)

| Layer | Location | Notes |
|-------|----------|-------|
| Report pages | `apps/backoffice/src/pages/reports/*.tsx` | one file per report + the hub, no central config. Pour un décompte : `ls apps/backoffice/src/pages/reports/` |
| Hub | `apps/backoffice/src/pages/reports/ReportsIndexPage.tsx` | tuiles groupées par famille, dérivées d'une table locale ; pas un fichier de config. Compte par famille dérivé, jamais écrit à la main |
| Routing | `apps/backoffice/src/routes/index.tsx` | lazy routes, each wrapped in `<PermissionGate required="reports.*.read">` — `required` accepts a **string or an array** of codes |
| Hooks | `apps/backoffice/src/features/reports/hooks/use*.ts` | one per report; each calls one RPC via React Query. `useReportPeriod` porte la période + le comparatif |
| Shared components | `apps/backoffice/src/features/reports/components/` | relever par `ls` ; l'ossature vivante est `ReportShell`, `KpiBand`, `PeriodControl`, `ExportMenu` (→ `ExportButtons`), `BreakdownCard`, `SortableTh`, `DeltaPct`, `DrilldownLink`, `VarianceLegend` |
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
- **Build/test is pnpm + turbo**, never `npm`. This is a Vite+React SPA (no Next.js). DB targets Supabase **cloud** V3 dev `ikcyvlovptebroadgtvd` via MCP (Docker retired) — verify RPC/view existence by reading `supabase/migrations/` or `mcp__claude_ai_Supabase__execute_sql`, **never** `supabase db reset`.

## Audit Process

Read **actual** code — don't guess. Hooks are small; RPC SQL lives in `supabase/migrations/` (grep the RPC
name, read the body). For a single-report complaint, jump to **Single-Report Mode** at the end.

### Phase 1 — Wiring integrity

1. Read `routes/index.tsx` → list every `/reports/*` route, its lazy component, and its `PermissionGate` code.
2. Read `ReportsIndexPage.tsx` → list every card/tile.
3. Cross-reference page files in `pages/reports/` against routes and hub tiles.

Findings:
- `UNROUTED` — page file exists but no route (unreachable)
- `NO_HUB_TILE` — routed report not surfaced on the hub
- `DEAD_ROUTE` — route points to a missing/renamed component
- `PERM_MISMATCH` — route gate code doesn't match the report's domain (e.g. a finance report gated `reports.sales.read`)

### Phase 2 — RPC ↔ schema ↔ payload verification (highest-value)

For each report's hook, follow the chain hook → RPC → typed interface.

**a) RPC exists & is the right version.** The hook calls `supabase.rpc('get_<name>_vN', {...})`. Grep
`supabase/migrations/` for `get_<name>_v` — confirm the called version exists and isn't superseded by a
later `_vN+1` the hook forgot to adopt. Missing RPC → runtime crash.

**b) Argument names match.** Confirm the RPC signature uses exactly the param names/types the hook passes.
A renamed param silently fails or errors. **Piège vivant du module : DEUX conventions de nommage des bornes
coexistent** — `p_date_start`/`p_date_end` et `p_start_date`/`p_end_date`, chacune sur une part substantielle
des hooks. Ne jamais présumer laquelle : lire la signature. Pour l'état des lieux :
`grep -rho "p_[a-z_]*:" apps/backoffice/src/features/reports/hooks/ | sort | uniq -c | sort -rn`.
C'est la première cause de `WRONG_ARG` quand un rapport est copié depuis un voisin.

**c) Payload → interface alignment.** Hooks map the RPC JSON/rows into a co-located TS interface (see
`useProfitLoss.ts` `ProfitLoss`). Read the RPC's `RETURNS`/`SELECT` and confirm every interface field is
actually produced. Flag:
- `DEAD_FIELD` — interface field the RPC never returns → always `0`/`undefined`
- `PLACEHOLDER` — hardcoded dummy in the hook/page (e.g. `items_sold: 0`)
- `UNCHECKED_CAST` — `supabase.rpc` est typé `Json` : un `as unknown as X` ne vérifie RIEN, et un payload
  dégradé (période vide, fallback serveur partiel) traverse jusqu'au rendu et blanchit la page. Le module a
  ses normaliseurs pour ça dans `features/reports/utils/parse.ts` — un hook qui caste sans les passer est un
  finding, pas un détail de style.

**d) Date filter actually applied (P0 class).** If the page has a date range but the RPC ignores it (no
`p_date_start`/`p_date_end` in the call, or the RPC body doesn't filter on them), the picker is decorative.
Verify the dates reach the RPC **and** the query key includes them so React Query refetches.

**e) Inside-RPC column checks** (read the RPC SQL): wrong column/relationship names, `select *` in the body,
and date comparisons that should respect `Asia/Makassar`. For deep accounting/stock correctness, DEFER to
`accounting` / `stock-management`.

Findings: `MISSING_RPC`, `STALE_RPC_VERSION`, `WRONG_ARG`, `DEAD_FIELD`, `PLACEHOLDER`, `UNCHECKED_CAST`,
`DATE_IGNORED`, `WRONG_COLUMN`, `SELECT_STAR`, `TIMEZONE_BUG`.

### Phase 3 — Component-level audit

For each page component:
- **Query key completeness** — every filter (date range, section, category) is in the React Query key, else stale data on filter change (`STALE_QUERY`).
- **Field consumption** — JSX/table/export reference only fields the hook returns (`EXPORT_MISMATCH` when an `ExportButtons` CSV column accessor points at a field the payload lacks → empty column).
- **States** — optional chaining on async data (`NULL_CRASH`), empty state (`NO_EMPTY_STATE`), loading skeleton, error propagation (la bannière d'erreur unifiée est une des responsabilités de `ReportShell` — une page qui avale son erreur ailleurs est un finding).
- **Right data source** — page uses the hook intended for it (`WRONG_HOOK`).
- **Ossature** — la page est-elle sur `ReportShell` (l'archétype vivant) ou encore sur le `ReportPage`
  hérité, qui enferme tout le contenu dans UNE `Card` ? La migration s'est faite par vagues et n'est pas
  terminée : `LEGACY_SHELL` est un finding **P3** (dette de convergence), pas un bug — sauf si la page mélange
  les deux.
- **UI en anglais** — passe `FRENCH_IN_UI` sur tout ce que la page rend : titres, sous-titres, libellés de
  colonne, `aria-label`, états vides, toasts, entrées de légende et en-têtes de colonnes CSV.

### Phase 4 — Chart & graph coherence

Most "it looks wrong" bugs live here. **Mais le point d'attaque a changé** : Recharts n'est plus appelé
directement par chaque page. Le module passe par des **wrappers** dans
`features/reports/components/charts/`, chacun portant une SÉMANTIQUE :

| Wrapper | Lecture qu'il affirme |
|---------|----------------------|
| `PairedBarsChart` | période courante vs période de comparaison, **appariées** |
| `StackedBarsChart` | des séries qui **s'additionnent** à un total (méthodes de paiement, familles de coût) |
| `TrendLineChart` | tendance, ligne pleine + comparaison pointillée |
| `ParetoChart` | « qu'est-ce qui pèse » : barres triées + ligne de cumul, **même unité, même axe** |
| `HeatmapGrid` | matrice teintée — une vraie `<table>`, pas de Recharts ; `VarianceLegend` obligatoire à côté |

Deux conséquences pour l'audit :

- **Le premier finding est le CHOIX du wrapper**, pas le `dataKey`. `WRONG_CHART_SEMANTICS` — des séries qui
  s'additionnent rendues en `PairedBarsChart` invitent à les comparer entre elles ; des séries rivales
  empilées inventent un total qui n'existe pas.
- **Le second est le CONTOURNEMENT.** Une page qui importe Recharts en direct sort du socle et reperd les
  garanties (axe unique, légende, comparaison, couleurs de `chartColors.ts`). Pour relever les contournements
  vivants : `grep -rl "from 'recharts'" apps/backoffice/src/pages/`. Chacun se justifie ou se signale
  (`RAW_RECHARTS`). Les checks 4A–4D ci-dessous s'appliquent **en plein** à ces pages-là, et aux wrappers
  eux-mêmes.

**4A Data binding**
- `WRONG_DATAKEY` — `dataKey` on `<Bar>/<Line>/<Pie>/<Area>` (and `XAxis dataKey`) must match a real key in the data array. Grep the hook for the field name.
- `DUPLICATE_RENDER` — same `dataKey` on both `<Bar>` and `<Line>` → duplicate tooltip/legend entries.

**4B Scale & axis truthfulness**
- `DUAL_AXIS_MISLEADING` — a `ComposedChart` with two `<YAxis>` auto-scales each axis independently; a Rp 500K profit line can sit as tall as a Rp 50M revenue bar. The #1 "chart doesn't match data" cause. Check whether series share `yAxisId`; if a dual axis is intended, it must be clearly labeled/distinguished. **Le socle a tranché contre le double axe** : `ParetoChart` cumule en VALEUR sur l'axe unique plutôt qu'en % sur un second axe (le coude tombe au même endroit, le tooltip porte le %). Un double axe neuf dans le module va donc contre une décision prise — signale-le comme tel.
- `MISSING_STACKID` — bars described as "stacked" (COGS + expenses) must share a `stackId`; without it Recharts renders them grouped, contradicting the label.

**4C Tooltip & legend**
- `TOOLTIP_ERROR` — custom formatter must output the right unit (IDR via `formatIdrFull` / `formatIdrCompact` / `formatIdrPrecise`, %, count).
- Legend `name` props human-readable **et en anglais** ("Revenue", not `total_revenue`, and not « Chiffre d'affaires ») ; custom legend lookup maps cover all keys.
- **Légende obligatoire dès deux séries** — c'est la règle du socle, pas une préférence ; et un signal de
  couleur non légendé (barème de variance) est un code privé : `VarianceLegend` accompagne toute
  `HeatmapGrid` ou toute cellule teintée par `varianceScale.ts`.

**4D Visual integrity**
- `NO_RESPONSIVE` — every chart wrapped in `<ResponsiveContainer>` (les wrappers du socle le font déjà ; c'est un contournement Recharts direct qui l'oublie).
- Pie slices sum to the expected total; color semantics consistent — les couleurs viennent de `chartColors.ts` et de LUI SEUL : familles de coût (`COGS_BASE` / `OPEX_BASE` et leurs rampes via `familyRamp`/`familyColor`), séries catégorielles via `categoricalColor`, série de comparaison `CHART_SERIES_COMPARE`, série éteinte `CHART_SERIES_OFF`, grille/axes `CHART_GRID_STROKE` / `CHART_AXIS_STROKE` / `CHART_AXIS_TICK`. Un hex en dur dans un graphe est un finding (et la garde CI `hardcoded-theme-colors` ne couvre pas tout).
- `CHART_TABLE_ORDER` — chart chronological (oldest→left) while table is reverse-chronological (newest→top) confuses "first bar vs first row".

**4E Comparison charts** — le comparatif n'est plus l'apanage de quelques rapports : il est **porté par le
socle**. `useReportPeriod` expose `compare` (persisté dans l'URL) et `compareRange`, dérivé par
`previousPeriod()` de `packages/domain/src/reports/period.ts` ; le bouton « Compare » vit dans
`PeriodControl`, à côté du sélecteur de période. Pour savoir qui l'exploite réellement :
`grep -rl compareRange apps/backoffice/src/pages/reports/`.

Vérifie : `previousPeriod()` est calendar-aware (décalage mois plein vs n jours) ; la requête de la période
précédente part bien (et sa clé React Query la contient) ; et **une comparaison impossible sort un tiret,
jamais « 0,0 % »** — un zéro affirmerait que rien n'a bougé. `COMPARE_LIES` quand la page invente un zéro.

### Phase 5 — Cross-cutting

- **Permission coverage** — confirmed at route level (Phase 1). Reports must not be reachable by URL without the gate.
- **Export coverage** — tabular reports offer CSV/PDF via `ExportMenu` (le menu unique de l'archétype, qui délègue à `ExportButtons` ; `ExportButtons` reste utilisé en direct hors du module, ex. les pages inventaire — ce n'est pas un vestige). Confirm CSV columns map to real payload fields and use the right `CsvFormat` from `packages/domain/src/reports/csv.ts` (`idr` / `idr-round100` / `number` / `percent` / `date` / `datetime` / `text`) — `idr-round100` for money. **Un export qui échoue doit le DIRE** : un chemin CSV ou PDF qui part en silence est un finding.
- **Langue des exports** — les en-têtes de colonnes CSV et les libellés des templates PDF sont de l'UI : anglais (`FRENCH_IN_UI`).
- **Accessibility** — charts need an aria-label / sr-only summary; `HeatmapGrid` étant une vraie `<table>`, sa sémantique lignes/colonnes EST son accessibilité — ne pas la « corriger » vers un graphe.
- **Business rules** — flag *suspicious* outputs (e.g. "Net Revenue" equal to gross, i.e. tax not removed) but **DEFER the actual math** to `accounting` (PB1 is NON-PKP, computed server-side by the `get_pb1_report` family).

### Phase 6 — Gap analysis

- **Unused data sources** — le module est RPC-first (les vues y sont rares), donc l'écart se mesure entre les
  RPC de rapport définies et celles réellement appelées. Les deux relevés à croiser :
  ```bash
  # familles servies par un hook
  grep -rho "supabase\.rpc('[a-z0-9_]*'" apps/backoffice/src/features/reports/hooks/ | sed "s/.*rpc('//;s/'//" | sort -u
  # familles définies côté base
  grep -rhoi "create or replace function [a-z_]*get_[a-z0-9_]*" supabase/migrations/ | sort -u
  ```
  Une RPC de rapport définie et jamais appelée est soit un rapport jamais livré, soit une version orpheline
  qu'un DROP a manquée — les deux se signalent, aucun ne se supprime ici.
- **Missing bakery-critical reports** — la boulangerie a besoin de lire la production contre les ventes
  (planification de la demande), la consommation d'ingrédients, et la performance d'un fournisseur.
  **Vérifie avant de déclarer un manque** : le module sert déjà la production (rapport, efficacité,
  rendement), la trajectoire du coût de recette et les tendances de prix d'achat — les nommer comme
  « absents » est le faux gap classique. Le relevé de départ est `ls apps/backoffice/src/pages/reports/`,
  et un écart mesuré n'est pas un défaut tant qu'on n'en a pas cherché la cause (un rapport peut avoir été
  retiré par un ADR : `grep -rn` dans `docs/` AVANT de proposer de combler une absence).
- **Chart/export opportunities** — table-only reports that would benefit from a chart; reports lacking CSV/PDF.

## Output Format

```markdown
# Report Module Audit — [DATE]

## Executive Summary
- Reports audited: X/Y (Y = compte relevé au moment de l'audit) · Issues: P0:X P1:X P2:X P3:X · Charts audited: X · Gaps: X

## P0 — Critical (broken / crashing / decorative date filter)
### [ID] [Report] — [Type]
**Location**: `path` + ancre stable (nom de fonction, de composant, ou texte cité — **pas** un numéro de ligne, il pourrit)
**Problem**: …  **Impact**: …  **Fix**: …

## P1 — High (wrong data / misleading charts / French on a permanently visible label)
## P2 — Medium (missing states / export gaps / French elsewhere in the UI)
## P3 — Low (style / readability / legacy shell)

## Coverage Gaps
## Chart Coherence Summary
| Report | Wrapper (ou Recharts direct) | Sémantique juste ? | dataKey | Axes | Stack | Tooltip | Legend | Issues |
## UI Language Pass
| Report | Libellé français trouvé | Où (titre / colonne / toast / légende / export) | Remplacement anglais |
```

## Interactive Fix Phase

1. Present the full audit report.
2. Ask: "I found X issues. Want me to fix them, P0 first, showing each fix before applying?"
3. Per issue, in priority order: show current snippet → explain → show proposed fix → wait for confirmation → apply → note related updates (co-located types, smoke test, ExportButtons columns).
4. **If you touch the working tree, isolate first** (this repo enforces a worktree for edits in background jobs) and after fixes run:
   ```bash
   pnpm typecheck
   pnpm --filter @breakery/app-backoffice test reports
   pnpm --filter @breakery/domain test reports
   ```
5. If a fix changed a report **RPC**, regen types via `mcp__claude_ai_Supabase__generate_typescript_types` → write to `packages/supabase/src/types.generated.ts`, and consider running `pattern-guardian` on the diff (REVOKE pair, versioning). Rappel : une RPC publiée ne s'édite jamais — on crée `_vN+1` et on DROP l'ancienne dans la MÊME migration, puis on adopte la nouvelle version au call-site.
6. Summarize all changes.

The user is always in control — they can skip, modify, or stop at any point.

## Single-Report Mode

When the user names one report (or complains it "looks wrong"):
1. Locate its three artifacts: `pages/reports/<Name>Page.tsx`, `features/reports/hooks/use<Name>.ts`, and the backing RPC of the `get_<name>` family in migrations. **La version live se lit au call-site, jamais devinée** — le module fait cohabiter plusieurs générations de `_vN`, et un numéro se périme entre deux sessions.
2. Run Phase 2 (hook→RPC→interface) and Phase 3 on just that report.
3. Run Phase 4 on every chart in the page — this is where most "it looks wrong" bugs live.
4. Skip Phases 1/5/6 unless asked.

Most common chart root causes: **wrapper à la sémantique fausse (apparié là où c'est additif)**, **dual
Y-axis with independent scales** sur une page qui appelle Recharts en direct, **missing `stackId`**, **chart
vs table ordering**, **duplicate Bar+Line on one dataKey**.

## Known baseline (don't flag as new)

- Env-gated live tests (`generate-pdf`, Vitest live RPC) **fail without `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`** exported — that's the known baseline, not a report bug.
- DB is cloud-only (Docker retired). Verify RPC/view existence by reading migrations or MCP `execute_sql`, never `supabase db reset`.
- **Les commentaires et en-têtes de fichier en français sont la RÈGLE**, pas une dette : ne jamais les compter comme `FRENCH_IN_UI`.
- **Deux conventions de nommage des bornes de date** (`p_date_start`/`p_date_end` et `p_start_date`/`p_end_date`) coexistent volontairement dans les signatures existantes. Ce n'est pas un finding en soi — seul un hook qui passe la MAUVAISE des deux en est un.
- **Le hub montre les tuiles de rapports que l'utilisateur ne peut pas ouvrir** — décision assumée, la `PermissionGate` refuse à l'entrée de la route.
- **`ReportPage` cohabite encore avec `ReportShell`** : la migration vers l'archétype s'est faite par vagues et n'est pas soldée. C'est de la dette connue (`LEGACY_SHELL`, P3), pas une régression.
- Les filtres vitest matchent le **nom de fichier**, pas le `describe`, et beaucoup de tests du BO sont en **kebab-case** — localiser par glob, jamais par nom de composant, sinon un filtre vert ne prouve rien.

## Anti-lois de cette fiche

Quand tu la rédiges ou la cites :
- **Pas de `_vN` pour désigner un objet vivant** — on nomme la FAMILLE (`get_pb1_report`), on lit la version au call-site.
- **Pas de `fichier:ligne`** dans un finding destiné à survivre — ancre stable (nom de composant, de fonction, texte cité).
- **Pas de compteur gravé** — un nombre de pages, de templates ou de rapports se relève par une commande, ou se DATE. Cette fiche n'en contient aucun ; ne lui en ajoute pas.
