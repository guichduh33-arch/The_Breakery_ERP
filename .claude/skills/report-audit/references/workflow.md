# report-audit — méthode ciblée

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Audit Process
- Output Format
- Interactive Fix Phase

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
- **Export coverage** — tabular reports offer CSV/PDF via `ExportMenu` (le menu de l’archétype ; il réutilise le helper `exportErrorDetail` d’`ExportButtons`, pas son composant). Confirm CSV columns map to real payload fields and use the right `CsvFormat` from `packages/domain/src/reports/csv.ts` (`idr` / `idr-round100` / `number` / `percent` / `date` / `datetime` / `text`) — `idr-round100` for money. **Un export qui échoue doit le DIRE** : un chemin CSV ou PDF qui part en silence est un finding.
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

Présenter les constats prouvés, leur impact et la correction proposée. Un audit seul n’autorise pas les changements ; une demande de correction déjà précise n’exige pas une nouvelle confirmation par finding. Appliquer les corrections autorisées dans leur périmètre, selon CLAUDE.md.

Pour les modifications : lire `reports-exports`, lancer les tests concernés (localisés par glob), les contrôles de types et la suite BO complète requise par CLAUDE.md. Pour une RPC, lire `db-migrations`, préserver le bump/DROP et régénérer les types. Une review ne remplace pas ces tests ; une délégation suit les règles de la session. Rendre les résultats et limites constatés.
