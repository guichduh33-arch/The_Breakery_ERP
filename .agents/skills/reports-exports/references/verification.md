# reports-exports — contrôles et sources

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Checklists (avant de livrer)
- Sources de vérité (pointeurs)
- Verification before completion
- When to escalate

## Checklists (avant de livrer)

### A — Ajouter un nouveau report BO

- [ ] RPC `get_<name>_v1` SECURITY DEFINER + gate `reports.<domain>.read` + REVOKE pair + `audit_logs`
- [ ] Hook React Query (`use<Name>Report`) dans `apps/backoffice/src/features/reports/hooks/`
- [ ] Page dans `apps/backoffice/src/pages/reports/<Name>Page.tsx` montée sur `<ReportShell>`, avec `<ExportMenu>` et `<PeriodControl>` dans le `toolbar`
- [ ] Route dans `src/routes/index.tsx` + `<PermissionGate required="reports.<domain>.read">` (la prop est **`required`**, pas `gate`)
- [ ] Sidebar entry (groupe Reports, indent 1) + tile dans `ReportsIndexPage` hub
- [ ] pgTAP : happy path + perm denied + shape (colonnes retournées) + clamp dates
- [ ] Template PDF dans `pdf-templates/<name>.ts` + enregistrer dans le registry `TEMPLATES` si PDF requis

### B — Ajouter un template `generate-pdf`

- [ ] Créer `supabase/functions/_shared/pdf-templates/<name>.ts` (exporte `render`)
- [ ] Ajouter l'import + l'entrée dans `TemplateName` **et** dans `TEMPLATES` dans `index.ts`, avec la permission correcte
- [ ] Tester via Vitest live `supabase/tests/functions/generate-pdf.test.ts` (env-gated)

### C — Wiring drill-down sur un report

- [ ] Identifier l'entity target (`DrilldownEntity` — si nouvelle, l'ajouter au type ET à la bonne table de routes dans `buildDrilldownUrl.ts` : détail, liste-par-id, ou filter-only)
- [ ] Ajouter le cas dans `features/reports/utils/__tests__/buildDrilldownUrl.test.ts`
- [ ] Wrapper la cellule avec `<DrilldownLink entity=... id=... filter=...>`

---

## Sources de vérité (pointeurs)

```
Migrations — repère la PLUS HAUTE de chaque famille avant d'écrire :
  ls supabase/migrations | grep -Ei "wastage|payments_by_method|pb1|stock_movement|perishable|orders_list|zreport"

BO — ossature et export
  apps/backoffice/src/features/reports/components/ReportShell.tsx       # archétype Report
  apps/backoffice/src/features/reports/components/ExportMenu.tsx        # standard export
  apps/backoffice/src/features/reports/components/PeriodControl.tsx     # période + compare
  apps/backoffice/src/features/reports/components/ExportButtons.tsx     # ancêtre + exportErrorDetail
  apps/backoffice/src/features/reports/components/DrilldownLink.tsx
  apps/backoffice/src/features/reports/utils/buildDrilldownUrl.ts
  apps/backoffice/src/features/reports/hooks/                           # un hook par famille RPC
  apps/backoffice/src/pages/reports/                                    # les pages + ReportsIndexPage (hub)

Domain helpers (pure TS)
  packages/domain/src/reports/                                          # façade index.ts

Z-report
  apps/pos/src/features/shift/hooks/useCloseShift.ts                    # chaîne l'EF, non bloquant
  apps/backoffice/src/features/cash-register/hooks/useSignZReport.ts
  apps/backoffice/src/features/cash-register/hooks/useVoidZReport.ts
  apps/backoffice/src/features/cash-register/hooks/useGenerateZReportPdf.ts

PDF
  supabase/functions/_shared/pdf-templates/index.ts   # registry = source of truth
  supabase/functions/generate-pdf/index.ts
  supabase/functions/generate-zreport-pdf/index.ts

Tests SQL (liste vivante : ls supabase/tests | grep -Ei "report|zreport|orders_list|pb1|payment")
  supabase/tests/zreports.test.sql
  supabase/tests/sign_zreport_pin.test.sql
  supabase/tests/void_zreport_v2_manager_pin.test.sql
  supabase/tests/bakery_reports.test.sql
  supabase/tests/orders_list_v4.test.sql  (+ _envelope, _sort)
  supabase/tests/payments_by_method_v3_timezone.test.sql
  supabase/tests/refunds_report.test.sql

Test unitaire drill-down
  apps/backoffice/src/features/reports/utils/__tests__/buildDrilldownUrl.test.ts
```

---

## Verification before completion

```bash
# Type check
pnpm typecheck

# Domain unit (buildCsv + previousPeriod + agrégations)
pnpm --filter @breakery/domain test reports

# BO smoke — report pages (les fichiers de test sont souvent en kebab-case :
# localiser par glob, un filtre sur le nom de composant en rate la moitié)
pnpm --filter @breakery/app-backoffice test reports

# Z-reports BO
pnpm --filter @breakery/app-backoffice test zreports

# Drill-down unit
pnpm --filter @breakery/app-backoffice test buildDrilldownUrl
```

La suite **BO complète** tourne en local (~5-6 min) et c'est le seul filet qui voit une régression inter-fichiers : la lancer avant de conclure.

Vitest live EF tests (`generate-pdf`, `generate-zreport-pdf`, `sign-zreport`) nécessitent `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` exportés (env-gated).

---

## When to escalate

- Ajout d'un nouveau bucket Storage ou changement de TTL/retention (conformité 7 ans zreports)
- Bump RPC report majeur (changement de signature → `_vN+1` + DROP `_vN` dans la même migration)
- Nouveau `DrilldownEntity` qui pointe vers une page inexistante
- Changement de la permission `reports.*` seedée (impact RBAC transverse)
- `generate-pdf` rate-limit insuffisant pour le trafic prod (30/min durable)
