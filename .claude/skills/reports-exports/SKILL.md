---
name: reports-exports
description: Reports, exports & Z-reports expert — report RPCs (S29-S33), generate-pdf EF (17 templates), CSV (buildCsv domain helper), Z-report 2-step sign flow, drill-down navigation (buildDrilldownUrl). Guide new reports and export wiring.
pathPatterns:
  - 'apps/backoffice/src/features/reports/**'
  - 'apps/backoffice/src/pages/reports/**'
  - 'apps/backoffice/src/features/zreports/**'
  - 'apps/backoffice/src/pages/zreports/**'
  - 'supabase/functions/generate-pdf/**'
  - 'supabase/functions/generate-zreport-pdf/**'
  - 'supabase/functions/_shared/pdf-templates/**'
  - 'supabase/migrations/*report*.sql'
  - 'supabase/migrations/*zreport*.sql'
  - 'packages/domain/src/reports/**'
promptSignals:
  phrases:
    - 'report'
    - 'export'
    - 'CSV'
    - 'PDF'
    - 'Z-report'
    - 'zreport'
    - 'drill-down'
    - 'drilldown'
    - 'generate-pdf'
    - 'ExportButtons'
    - 'buildCsv'
    - 'compare period'
    - 'wastage report'
    - 'payment by method'
    - 'perishable turnover'
    - 'previousPeriod'
    - 'DrilldownLink'
---

# Reports & Exports — The Breakery ERP

Expert on the reports/exports pipeline: report RPCs, PDF generation, CSV exports, Z-report sign flow, and drill-down navigation across all 17+ BO reports.

**`CLAUDE.md` est la source de vérité** pour les patterns globaux (REVOKE pair, idempotency 2-flavors, PIN header, RPC versioning). Ce skill ajoute la surface map reports/exports, les checklists métier, et les pointeurs vers les fichiers réels.

---

## Mental model — Pipeline reports & exports

```
RPC (SECURITY DEFINER)          Domain helpers (IO-free)         EF Deno
──────────────────────          ────────────────────────         ────────
get_wastage_report_v1           buildCsv<T>(rows, cols, opts?)   generate-pdf
get_payments_by_method_v1        ↓ RFC 4180 + UTF-8 BOM            ↓ 17 templates
get_pb1_report_v1                ↓ id-ID locale (IDR)              ↓ rate-limit 30/min durable
get_stock_movements_v2           previousPeriod(start, end)        ↓ bucket reports-exports/ TTL 30d
get_perishable_turnover_v1       formatDelta(curr, prev) → Delta
get_orders_list_v2 (S33)        downloadCsv(csv, filename)       generate-zreport-pdf
                                                                    ↓ idempotent x-idempotency-key
                                buildDrilldownUrl(entity, id,       ↓ bucket zreports/ 7 ans
                                  filter?) → string|null           ↓ PIN header x-manager-pin
                                DrilldownLink component
```

---

## Surface map (vérifiée 2026-05-31)

### Domain helpers — `packages/domain/src/reports/`
| Fichier | Exports |
|---------|---------|
| `csv.ts` | `buildCsv<T>`, `downloadCsv`, `CsvColumn<T>`, `CsvFormat`, `CsvOptions` |
| `period.ts` | `previousPeriod(start, end)`, `formatDelta(curr, prev) → Delta` |

`buildDrilldownUrl` et `DrilldownLink` sont dans **`apps/backoffice/src/features/reports/`** (pas dans `packages/domain` — vérification S31 confirmée). IO-free rule tenue : `buildCsv` + `previousPeriod` + `formatDelta` = pure TS, pas de fetch/Supabase.

### EF `generate-pdf` — `supabase/functions/_shared/pdf-templates/`

17 templates enregistrés dans `index.ts` (TEMPLATES record, source vérifiée) :

| Template | Permission |
|----------|-----------|
| `pnl`, `bs`, `cf`, `recipe_overview`, `recipe_timeline`, `payment_by_method`, `pb1` | `reports.financial.read` |
| `basket`, `sales_by_hour`, `sales_by_category`, `sales_by_staff` | `reports.sales.read` |
| `wastage`, `stock_variance`, `stock_movements`, `perishable_turnover` | `reports.inventory.read` |
| `audit` | `reports.audit.read` |
| `production_yield` | `inventory.read` |

`zreport.ts` existe dans le dossier mais est utilisé UNIQUEMENT par `generate-zreport-pdf` — PAS dans le registry 17-templates.

### Report RPCs (S29-S33, tous SECURITY DEFINER + REVOKE pair S25)

| RPC | Gate | Cursor |
|-----|------|--------|
| `get_wastage_report_v1(text, text)` | `reports.inventory.read` | non |
| `get_payments_by_method_v1(text, text)` | `reports.financial.read` | non (by_day pivot = 6 méthodes + `other` + total, M9(b)) |
| `get_pb1_report_v1(int, int)` | `reports.financial.read` | non |
| `get_stock_movements_v2(text, text, uuid, text, int, text)` | `reports.inventory.read` | oui — keyset `(created_at, id)` via token TEXT `"<created_at>\|<id>"` (M9(a), v1 6-arg droppé ; 8-arg S13 RETURNS TABLE distinct) |
| `get_perishable_turnover_v1(text, text)` | `reports.inventory.read` | non |
| `get_orders_list_v2(p_start, p_end, p_filters JSONB, p_limit, p_cursor)` | `orders.read` | oui (cursor-paginé) |

`get_orders_list_v2` est un cas hybride — scope orders mais consommé par un report drill-down (`order_list` entity). Voir skill `orders` pour l'édition et la liste BO.

### Z-report flow 2 temps (S29)

1. `close_shift_v2` → INSERT draft row `z_reports` (snapshot JSONB figé : orders + payments + refunds + expenses du shift)
2. EF `generate-zreport-pdf` (idempotent `x-idempotency-key`, non-bloquant via pg_net) → PDF → bucket `zreports/` 7 ans (conformité Indonésie)
3. Manager signe via BO → `sign_zreport_v1(p_zreport_id)` (PIN header `x-manager-pin`, gate `zreports.sign`, audit_log `zreport.signed`, replay idempotent)
4. Optionnel : `void_zreport_v1(p_zreport_id, p_reason)` (reason ≥ 10 chars, gate `zreports.sign`)
5. `get_zreport_snapshot_v1(p_zreport_id)` (gate `zreports.read`)

Perms seedées : `zreports.{read, sign, void}`.

### Drill-down navigation (S31-S32)

`buildDrilldownUrl(entity, id, filter?)` supporte 11 `DrilldownEntity` values. Cas particulier : `order_list` est **filter-only** (id ignoré, URL = `/backoffice/orders` + params). Retourne `null` si combo non viable → `DrilldownLink` affiche texte brut.

---

## Critical patterns (vérifiés, ne pas enfreindre)

1. **Chaque RPC report a un REVOKE pair S25 canonique** (3 lignes : `FROM PUBLIC` + `FROM anon` + `ALTER DEFAULT PRIVILEGES`). Vérifier que toute nouvelle RPC report suit le même bloc.

2. **`buildCsv` est IO-free et dans `packages/domain`** — ne jamais ajouter de fetch/import Supabase. `downloadCsv` déclenche le download navigateur (guard `typeof window`).

3. **`generate-pdf` rate-limit 30/min durable** (S19 `record_rate_limit_v1`). Bucket `reports-exports/` TTL 30d. Ajout d'un template = ajouter dans le TEMPLATES registry de `index.ts` + permission correspondante.

4. **Z-report non-bloquant** : `close_shift_v2` appelle `generate-zreport-pdf` via `pg_net` en async — si le PDF échoue, le draft row reste en DB pour retry BO. Ne pas rendre le flow POS bloquant.

5. **PIN Z-report en header** (`x-manager-pin`), jamais en body JSON — pattern S25. Hard cutover appliqué.

6. **`ExportButtons` générique** (`apps/backoffice/src/features/reports/components/ExportButtons.tsx`) câblé sur les 17 pages reports. Ne pas créer de bouton export ad-hoc.

7. **Compare period** : `<DateRangePickerWithCompare>` + `<DeltaPct>` câblés sur les 5 reports qui supportent la comparaison (P&L, BS, CF, SalesByHour, SalesByCategory). `previousPeriod` est calendar-aware (mois complet vs n-day shift).

---

## Checklists (avant de livrer)

### A — Ajouter un nouveau report BO

- [ ] RPC `get_<name>_v1` SECURITY DEFINER + gate `reports.<domain>.read` + REVOKE pair S25 + audit_logs
- [ ] Hook React Query (`use<Name>Report`) dans `apps/backoffice/src/features/reports/hooks/`
- [ ] Page dans `apps/backoffice/src/pages/reports/<Name>Page.tsx` + `<ExportButtons>` + `<DateRangePickerWithCompare>` si compare actif
- [ ] Route dans `src/routes/index.tsx` + `<PermissionGate gate="reports.<domain>.read">`
- [ ] Sidebar entry (groupe Reports, indent 1) + tile dans `ReportsIndexPage` hub
- [ ] pgTAP : happy path + perm denied + shape (colonnes retournées) + clamp dates
- [ ] Template PDF dans `pdf-templates/<name>.ts` + enregistrer dans `TEMPLATES` registry si PDF requis

### B — Ajouter un template `generate-pdf`

- [ ] Créer `supabase/functions/_shared/pdf-templates/<name>.ts` (exporte `render`)
- [ ] Ajouter l'import + entrée dans `TEMPLATES` dans `index.ts` avec la permission correcte
- [ ] Tester via Vitest live `supabase/tests/functions/generate-pdf.test.ts` (env-gated)

### C — Wiring drill-down sur un report

- [ ] Identifier l'entity target (`DrilldownEntity` — si nouveau, ajouter dans `buildDrilldownUrl.ts`)
- [ ] Ajouter le test unitaire dans `__tests__/buildDrilldownUrl.test.ts` (actuellement 18/18 PASS)
- [ ] Wrapper la cellule avec `<DrilldownLink entity=... id=... filter=...>`

---

## Sources de vérité (pointeurs)

```
Migrations (chronologique)
  supabase/migrations/20260606000010..023   # S29 — z_reports, Z-report RPCs, close_shift_v2
  supabase/migrations/20260524231049..124   # S30 — payments_by_method, pb1
  supabase/migrations/20260615000010..019   # S30 — wastage, stock_movements, perishable_turnover
  supabase/migrations/20260617000013..014   # S32 — get_orders_list_v1
  supabase/migrations/20260618000011..012   # S33 — get_orders_list_v2 server-side filters

Domain helpers (pure TS)
  packages/domain/src/reports/csv.ts        # buildCsv, downloadCsv
  packages/domain/src/reports/period.ts     # previousPeriod, formatDelta

BO components
  apps/backoffice/src/features/reports/components/ExportButtons.tsx
  apps/backoffice/src/features/reports/components/DrilldownLink.tsx
  apps/backoffice/src/features/reports/utils/buildDrilldownUrl.ts

PDF templates (17 + zreport séparé)
  supabase/functions/_shared/pdf-templates/index.ts  # registry source of truth
  supabase/functions/generate-pdf/index.ts
  supabase/functions/generate-zreport-pdf/index.ts

Tests
  supabase/tests/zreports.test.sql
  supabase/tests/bakery_reports.test.sql     # S30 — 15/15 PASS
  supabase/tests/orders_list_v2.test.sql     # S33 — 10/10 PASS
  apps/backoffice/src/features/reports/utils/__tests__/buildDrilldownUrl.test.ts  # 18/18 PASS
```

---

## Verification before completion

```bash
# Type check
pnpm typecheck

# Domain unit (buildCsv + previousPeriod)
pnpm --filter @breakery/domain test reports

# BO smoke — report pages
pnpm --filter @breakery/app-backoffice test reports

# Z-reports BO
pnpm --filter @breakery/app-backoffice test zreports

# Drill-down unit
pnpm --filter @breakery/app-backoffice test buildDrilldownUrl
```

Vitest live EF tests (`generate-pdf`, `generate-zreport-pdf`, `sign-zreport`) nécessitent `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` exportés (env-gated, cf. DEV-S29-2.A-01).

---

## When to escalate

- Ajout d'un nouveau bucket Storage ou changement de TTL/retention (conformité 7 ans zreports)
- Bump RPC report majeur (changement de signature → `_vN+1` + DROP `_vN`)
- Nouveau `DrilldownEntity` qui pointe vers une page inexistante
- Changement de la permission `reports.*` seedée (impact RBAC transverse)
- `generate-pdf` rate-limit insufficient pour traffic prod (30/min durable S19)
