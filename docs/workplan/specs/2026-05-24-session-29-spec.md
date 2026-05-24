# Session 29 — Reports Export + Z-Report PDF (Vague A) (Spec)

> **Date** : 2026-05-24
> **Branche cible** : `swarm/session-29`
> **Base** : `master` après merge S28 (`66f77d6`)
> **Effort estimé** : ~2 jours wall-time (L)
> **Status** : draft pour ratification user (avant Wave 0 spec commit)
> **Predecessor** : [`./2026-05-24-session-28-spec.md`](./2026-05-24-session-28-spec.md) — S29 enchaîne sur module 14 (Reports & Analytics) qui n'a pas reçu de nouveaux exports depuis S18 (Recipe Cost History).
> **Plan multi-sessions** : [`../plans/2026-05-19-S24-to-S30-plan.md`](../plans/2026-05-19-S24-to-S30-plan.md) §S29
> **Audit préparatoire** : audit en direct dans la session, présenté à l'user comme synthèse 14 gaps (G1..G14) → split en 3 vagues A/B/C. Cette session ferme **Vague A uniquement** ; Vagues B/C re-checkées post-merge S29.

---

## 1. Contexte

Le module 14 (Reports & Analytics) compte aujourd'hui **17 pages livrées** :
- **Sales (4)** : SalesByHour, SalesByCategory, SalesByStaff, BasketAnalysis (S13 + S16)
- **Inventory (3)** : StockVariance, ProductionYield, MarginWatch (S13 + S15)
- **Finance (3)** : ProfitLoss, BalanceSheet, CashFlow (S13 + S21 3-sections)
- **Recipe (2)** : RecipeCostOverview, RecipeCostTimeline (S18)
- **Audit (1)** : AuditLog cursor-paginé (S13)
- **Marketing (4)** : Cohorts, Segments, PromoROI, Birthdays (S13)

**Gaps structurels identifiés par l'audit en session** (avant Vague A) :
- **G1 Export incohérent** : seules 4/17 pages ont un export CSV (RecipeCostOverview, RecipeCostTimeline, ProductionYield, TrialBalance accounting), **0 page n'a d'export PDF**. Impossible d'archiver / remettre au comptable.
- **G2 Pas de comparison vs previous period** (TASK-14-005 P2 TODO depuis S13). Pas de "vs mois dernier".
- **G3 Z-Report PDF absent** (TASK-12-002 P2 TODO depuis S13) : `close_shift_v1` existe mais aucun PDF généré, pas de bucket Storage `zreports/`, pas de signature manager. **Compliance Indonésie : obligation archive comptable 7 ans signable manager.**

**Décision business 2026-05-24** (héritée du plan S24-S30 §S29) :
- Z-Report PDF généré au close_shift, stocké Storage `zreports/`, signature manager via PIN. Retention 7 ans.
- CSV+PDF cohérents sur **P&L, BS, Cash Flow, Basket Analysis, Recipe Cost Overview/Timeline** (plan officiel) + extension Wave A à toutes les pages dont l'export est trivial à câbler avec le helper centralisé (13 pages au total).
- Headers IDR avec rounding 100 (convention business existante S26).
- Comparison vs previous period activable par toggle ; wiring Wave A sur 5 reports prioritaires (P&L, BS, CashFlow, SalesByHour, SalesByCategory).

**Hors scope explicite Vague A** (renvoyé Vagues B/C ou backlog) :
- Vague B : nouveaux reports métier bakery (Wastage & Spoilage, Payment by Method, VAT/PB1 Report, Stock Movement history, Perishable Turnover)
- Vague C : Drill-down navigation (TASK-14-009), UnifiedReportFilters extra dims (TASK-14-005 reste), Mobile responsive (TASK-14-010), Hub mini-KPI + favorites (G13, G14)
- Backlog : Scheduled email reports (TASK-14-008), Unusual Transactions (TASK-14-013), Custom report builder (TASK-14-007), Peak Hour Staffing (TASK-14-015), Brand/Returns/TableTurnover/OutgoingStocks (TASK-14-016..020)

---

## 2. Architecture

**Choix structurant 1** : **PDF généré par `pdf-lib`** dans Edge Function (pure Deno, pas de Chromium dans EF — léger, déterministe, ~80 KB bundle, idéal pour cold-start Fluid Compute).

**Choix structurant 2** : **flow Z-Report en 2 temps** (pattern S25/S28) — `close_shift_v2` insère le draft `z_reports` row avec snapshot figé ; EF `generate-zreport-pdf` génère le PDF async et upload ; manager signe ensuite via modal séparé (`sign_zreport_v1` avec PIN-en-header). Permet une contre-signature différée (caissier ferme, manager arrive 30 min plus tard).

**Choix structurant 3** : **2 buckets Storage distincts** — `zreports/` privé retention 7 ans (compliance) ; `reports-exports/` éphémère TTL 30j (PDF user-triggered, régénérable depuis la donnée).

**Choix structurant 4** : **CSV côté client, PDF côté serveur** — CSV trivial à générer côté browser (Blob + a.download), PDF demande layout + Intl + auth ; sépare les responsabilités.

**Choix structurant 5** : **comparison vs previous period = 2 fetches React-Query parallèles côté front**, pas de bump de signature des RPCs existants. Helper domain `previousPeriod(start, end)` produit la fenêtre symétrique. KISS, cache RQ gère le coût.

### 2.1 Schema changes

```sql
-- Migration _010 : ENUM z_report_status
CREATE TYPE z_report_status AS ENUM ('draft', 'signed', 'voided');

-- Migration _011 : table z_reports (append-only par row, signature ré-écrite via UPDATE par RPC)
CREATE TABLE z_reports (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id            UUID NOT NULL REFERENCES pos_sessions(id) ON DELETE RESTRICT,
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  signed_at           TIMESTAMPTZ NULL,
  signed_by           UUID NULL REFERENCES user_profiles(id),
  voided_at           TIMESTAMPTZ NULL,
  voided_by           UUID NULL REFERENCES user_profiles(id),
  void_reason         TEXT NULL,
  pdf_storage_path    TEXT NULL,   -- "zreports/2026/05/<shift_id>_<ts>.pdf"
  status              z_report_status NOT NULL DEFAULT 'draft',
  snapshot            JSONB NOT NULL,  -- figé au close_shift : { period_start, period_end, opening_cash, closing_cash_expected, closing_cash_counted, variance, totals_by_payment_method, sales_total, refunds_total, voids_total, top_products[], expenses_cash_total, ... }
  CONSTRAINT uniq_zreport_shift UNIQUE (shift_id),
  CONSTRAINT zreport_status_signed_consistency CHECK (
    (status = 'signed') = (signed_at IS NOT NULL AND signed_by IS NOT NULL)
  ),
  CONSTRAINT zreport_status_voided_consistency CHECK (
    (status = 'voided') = (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL)
  )
);

CREATE INDEX idx_zreports_shift ON z_reports (shift_id);
CREATE INDEX idx_zreports_status_generated ON z_reports (status, generated_at DESC);

ALTER TABLE z_reports ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON z_reports FROM authenticated, anon, PUBLIC;
GRANT SELECT ON z_reports TO authenticated;
CREATE POLICY zreports_select_auth ON z_reports
  FOR SELECT TO authenticated USING (true);
  -- Table policy USING(true) intentionnel : tout authenticated peut SELECT la metadata Z-Report.
  -- Le gate `zreports.read` est appliqué (1) à l'UI level via PermissionGate route, (2) au storage.objects
  -- level via la policy zreports_select ci-dessous (le PDF binary est gated, pas la row metadata).

COMMENT ON TABLE z_reports IS
  'S29 : Z-Report archive 7 ans (compliance ID). UNIQUE(shift_id) = un Z-Report par shift. Snapshot figé au close_shift. Status draft → signed (PIN manager) | voided (admin avec reason).';

-- Migration _012 : storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES
  ('zreports', 'zreports', false),
  ('reports-exports', 'reports-exports', false)
ON CONFLICT (id) DO NOTHING;

-- Migration _013 : storage.objects RLS policies
-- zreports/ : INSERT seul postgres role (via SECURITY DEFINER EF) ; SELECT auth users avec gate zreports.read (vérifié UI + RLS function helper)
-- reports-exports/ : INSERT auth users (own PDF) ; SELECT owner only via path prefix user_id

CREATE POLICY zreports_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'zreports' AND user_has_permission('zreports.read'));

CREATE POLICY reports_exports_select_own ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'reports-exports' AND owner = auth.uid());

CREATE POLICY reports_exports_insert_own ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'reports-exports' AND owner = auth.uid());
```

### 2.2 RPCs (4 nouvelles + 1 bump + 4 REVOKE pairs)

**`close_shift_v2`** (bump v1 — signature inchangée côté caller) :
- Tout le comportement v1 préservé (variance calc, cash drawer, audit row).
- Add : à la fin, INSERT INTO z_reports (shift_id, snapshot, status=draft) — snapshot calculé via une jointure sur orders/order_payments/expenses/stock_movements de la période.
- DROP FUNCTION close_shift_v1 (...) dans la même migration (CLAUDE.md RPC versioning rule).
- Le helper `_build_zreport_snapshot(p_shift_id) RETURNS JSONB` est extrait dans une migration distincte (testable, réutilisable).

**`sign_zreport_v1(p_zreport_id UUID)`** :
- SECURITY DEFINER, perm gate `zreports.sign`, audit_log row `action='zreport.sign'`.
- PIN-en-header `x-manager-pin` (pattern S25) → résolu côté EF wrapper qui pose la session via `set_config('breakery.manager_pin_verified_user_id', ...)`.
- Idempotency : si déjà signed → return existing row + flag `idempotent_replay: true`. UNIQUE(shift_id) sur z_reports garantit qu'on retombe sur la même row.
- Transition status `draft` → `signed`, set `signed_at = now()`, `signed_by = caller`.
- Raise P0002 si Z-Report introuvable, P0003 si déjà voided.

**`void_zreport_v1(p_zreport_id UUID, p_reason TEXT)`** :
- SECURITY DEFINER, perm gate `zreports.void` (admin only), audit_log row `action='zreport.void'`.
- CHECK length(p_reason) >= 10 (force justification minimale).
- Transition status `signed | draft` → `voided`. Préserve `pdf_storage_path` (audit-traceable).

**`get_zreport_snapshot_v1(p_zreport_id UUID) RETURNS JSONB`** :
- SECURITY DEFINER, perm gate `zreports.read`.
- Retourne `snapshot` enrichi des champs `status`, `generated_at`, `signed_at`, `signed_by_name` (jointure user_profiles), `pdf_storage_path`. Évite à l'EF de devoir faire 2 fetches.

**REVOKE pair canonique S25** sur chacune des 4 RPCs (5 migrations REVOKE).

### 2.3 Permissions seedées (3 nouvelles)

```sql
INSERT INTO permissions (code, name, description, category) VALUES
  ('zreports.read', 'Read Z-Reports', 'View Z-Report history and PDF archives', 'reports'),
  ('zreports.sign', 'Sign Z-Reports', 'Sign a Z-Report draft (PIN-gated)', 'reports'),
  ('zreports.void', 'Void Z-Reports', 'Void a signed Z-Report with reason (admin only)', 'reports')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('MANAGER',     'zreports.read'),
  ('MANAGER',     'zreports.sign'),
  ('ADMIN',       'zreports.read'),
  ('ADMIN',       'zreports.sign'),
  ('ADMIN',       'zreports.void'),
  ('SUPER_ADMIN', 'zreports.read'),
  ('SUPER_ADMIN', 'zreports.sign'),
  ('SUPER_ADMIN', 'zreports.void')
ON CONFLICT DO NOTHING;
```

---

## 3. Edge Functions

### 3.1 `supabase/functions/generate-pdf/index.ts` (générique)

**Contract** :
```ts
POST /functions/v1/generate-pdf
Headers: { Authorization: Bearer <jwt>, x-idempotency-key?: <uuid> }
Body: {
  template: 'pnl' | 'bs' | 'cf' | 'basket' | 'recipe_overview' | 'recipe_timeline'
          | 'sales_by_hour' | 'sales_by_category' | 'sales_by_staff'
          | 'stock_variance' | 'production_yield' | 'audit',
  // 12 templates Wave A (Z-Report = template dédié dans generate-zreport-pdf, hors cette liste).
  // MarginWatch reporté Vague C (CSV seulement Wave A, PDF dépend du drill-down design).
  data: object,                                  // shape per template
  period: { start: string, end: string } | null, // null pour audit
  filename: string,
  comparePrevious?: { data: object } | null      // optional comparison block
}
Response 200: {
  storage_path: 'reports-exports/<user_id>/<yyyy>/<mm>/<filename>.pdf',
  signed_url:   string,    // expires_at + 1h
  expires_at:   ISO string
}
Errors:
  401 missing_auth | 403 permission_denied | 400 invalid_template | 400 invalid_data | 429 rate_limited | 500 generation_failed
```

**Implémentation** :
- `pdf-lib` via `https://esm.sh/pdf-lib@1.17.1` (esm.sh CDN supporté en Deno).
- Templates dans `supabase/functions/_shared/pdf-templates/<template>.ts` — chaque template exporte `function render(doc: PDFDocument, data, period, opts): Promise<void>`.
- Layout shared via `supabase/functions/_shared/pdf-layout.ts` : header (logo placeholder + business name from `business_config` + period range), footer (page X/Y + generated timestamp WIB).
- Auth : checkAuth required, perms route via `template` → `templateToPermission(template)` map.
- Rate-limit durable bucket `generate-pdf:<user_id>` via `record_rate_limit_v1` (S19) — 30 req/min.
- IDR formatting : `new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(value / 100) * 100)`.
- Storage upload : path `<user_id>/<yyyy>/<mm>/<filename>.pdf` dans `reports-exports/`, signed URL 1h via `createSignedUrl`.

### 3.2 `supabase/functions/generate-zreport-pdf/index.ts` (spécifique)

**Contract** :
```ts
POST /functions/v1/generate-zreport-pdf
Headers: { Authorization: Bearer <jwt>, x-idempotency-key: <uuid> }   // idempotency REQUIRED
Body: { zreport_id: UUID }
Response 200: { storage_path, signed_url, expires_at, status: 'draft'|'signed' }
Errors: 401 | 403 zreports.read | 404 zreport_not_found | 429 | 500
```

**Implémentation** :
- Lit `get_zreport_snapshot_v1(zreport_id)` (auth-passthrough).
- Template Z-Report dédié `_shared/pdf-templates/zreport.ts` : layout legal Indonesia — entreprise + NPWP + adresse + shift period + opening cash + closing cash counted vs expected + variance + breakdown par payment method + refunds total + voids total + top 10 products + expenses cash total + signature box (name + role + timestamp si signed).
- Upload bucket **`zreports/`** au lieu de `reports-exports/`. Path `<yyyy>/<mm>/<shift_id>_<generated_at_ts>.pdf`.
- INSERT INTO storage.objects nécessite role postgres → EF utilise service role key pour le upload zreports (override de la policy storage), **uniquement pour ce template**.
- Idempotency `x-idempotency-key` REQUIRED : si re-call avec même key → re-fetch existing pdf_storage_path et return.
- À la fin : UPDATE z_reports SET pdf_storage_path = ... WHERE id = zreport_id AND pdf_storage_path IS NULL (idempotent write-once).

### 3.3 Wiring `close_shift` côté POS

Le POS appelle `close_shift_v2` (RPC) — qui retourne le `z_report_id`. Le POS enchaîne avec `generate-zreport-pdf` (EF) avec ce z_report_id. Si le call EF échoue (network), pas grave : le draft row existe en DB, l'utilisateur peut retry depuis l'UI Z-Report history.

---

## 4. Domain helpers

### 4.1 `packages/domain/src/reports/csv.ts`

```ts
export interface CsvColumn<T> {
  header: string;
  accessor: (row: T) => string | number | null | undefined;
  format?: 'idr' | 'idr-round100' | 'number' | 'percent' | 'date' | 'datetime' | 'text';
}

export interface CsvOptions {
  bom?:       boolean;   // default true (UTF-8 BOM, Excel id-ID compat)
  delimiter?: ',' | ';'; // default ','
  locale?:    string;    // default 'id-ID'
}

export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[], opts?: CsvOptions): string;
// Quote cells per RFC 4180 (double inner quotes, wrap if contains delimiter/newline/quote).
// 'idr-round100' applique Math.round(v / 100) * 100 puis formatte 'id-ID' sans décimales.

export function downloadCsv(csv: string, filename: string): void;
// Browser-only : Blob → URL.createObjectURL → anchor click. No-op si window undefined.
```

Tests unit Vitest co-localisés dans `packages/domain/src/reports/__tests__/csv.test.ts`. Coverage : escaping RFC 4180, BOM toggle, formatters, delimiter switch, idr rounding.

Migration des 4 implémentations existantes (`RecipeCostOverviewPage`, `RecipeCostTimelinePage`, `ProductionYieldPage`, `exportTrialBalanceCsv.ts`) → utiliser `buildCsv` + `downloadCsv`, **comportement output identique** (test diff line-by-line dans la migration commit).

### 4.2 `packages/domain/src/reports/period.ts`

```ts
export function previousPeriod(start: string, end: string): { start: string; end: string };
// 2026-05-01..2026-05-31 → 2026-04-01..2026-04-30 (calendar-aware mois)
// 2026-05-15..2026-05-21 (week 7j) → 2026-05-08..2026-05-14 (week précédente)
// generic case : decale de (end - start + 1) jours en arrière

export function formatDelta(current: number, previous: number): { abs: number; pct: number | null; sign: 1 | -1 | 0 };
// pct = null si previous === 0 (eviter division par zero, UI affiche '—')
```

Tests Vitest co-localisés. Coverage : month boundary (avril 30j vs mai 31j), generic n-day window, year-cross (jan-feb 2027 → dec 2026-jan 2027).

---

## 5. BackOffice UI

### 5.1 `<ExportButtons>` composant partagé

`apps/backoffice/src/features/reports/components/ExportButtons.tsx` :
```tsx
interface ExportButtonsProps<T> {
  csv?: {
    rows:    T[];
    columns: CsvColumn<T>[];
    filename: string;     // sans extension
  };
  pdf?: {
    template:  PdfTemplate;  // type union des templates dispo
    data:      object;
    period?:   { start: string; end: string };
    filename:  string;
    comparePrevious?: { data: object };
  };
  disabled?: boolean;
}
// Rend 2 buttons "Export CSV" + "Export PDF" (icons Download / FileText).
// PDF appelle EF generate-pdf, ouvre signed_url dans new tab.
// CSV appelle buildCsv + downloadCsv local.
```

### 5.2 Pages câblées Vague A (13 pages)

| Page | CSV | PDF | Notes |
|---|---|---|---|
| SalesByHourPage | ✅ | ✅ | + comparePrevious |
| SalesByCategoryPage | ✅ | ✅ | + comparePrevious |
| SalesByStaffPage | ✅ | ✅ | — |
| BasketAnalysisPage | ✅ | ✅ | — |
| StockVariancePage | ✅ | ✅ | — |
| ProfitLossPage | ✅ | ✅ | + comparePrevious |
| BalanceSheetPage | ✅ | ✅ | + comparePrevious (BS = snapshot date, compare = same date previous month) |
| CashFlowPage | ✅ | ✅ | + comparePrevious |
| AuditPage | ✅ | ✅ | CSV via current loaded pages (pas le 100% du log) ; PDF idem |
| MarginWatchPage | ✅ | — | inventory feature, CSV seulement Wave A (PDF reporté Vague C avec drill-down) |
| RecipeCostOverviewPage | ✅ migré helper | ✅ ajout | — |
| RecipeCostTimelinePage | ✅ migré helper | ✅ ajout | — |
| ProductionYieldPage | ✅ migré helper | ✅ ajout | — |

Marketing pages (Cohorts, Segments, PromoROI, Birthdays) reportées Vague C (UX rework prévu).

### 5.3 `<DateRangePickerWithCompare>` wrapper

`apps/backoffice/src/features/reports/components/DateRangePickerWithCompare.tsx` :
- Wrappe `<DateRangePicker>` existant + checkbox "Compare to previous period" (state local hoisted ou contrôlé).
- Quand toggle activé, le hook concerné fait 2 fetches (current + prev) via React-Query parallèles.
- Le rendu UI gère l'affichage delta : composant helper `<DeltaPct value={current} previous={prev} />` qui rend `+12.3%` (vert), `-4.1%` (rouge), `—` (gris si prev=0).

**Wiring Wave A** : P&L, BS, CashFlow, SalesByHour, SalesByCategory (5 reports).

### 5.4 Z-Report UI

Nouvelle page `apps/backoffice/src/pages/cash-register/ZReportsListPage.tsx` (route `/backoffice/cash-register/zreports`) :
- Table 5 cols : shift period | generated_at | status badge (draft/signed/voided) | signed_by | actions.
- Filtre status + filtre date range (default last 30 days).
- Actions par row : "View PDF" (signed_url generate-zreport-pdf), "Sign" (modal PIN), "Void" (modal reason — admin only).
- Empty state si aucun Z-Report.

`<SignZReportModal>` :
- Dialog Radix, 2 steps : preview snapshot summary + PIN 6 digits.
- Submit → mutation `useSignZReport` qui call RPC `sign_zreport_v1` avec header `x-manager-pin` + idempotency.
- Success → toast + invalidate `z_reports` query + auto-open PDF.

`<VoidZReportModal>` :
- Dialog avec textarea reason (min 10 char) + admin perm check.
- Submit → `useVoidZReport` mutation.

Sidebar BO : nouvelle entrée sous "Cash Register" → "Z-Reports" (icon `FileSignature`, perm `zreports.read`).

`ReportsIndexPage` reste inchangé Wave A : Z-Reports vit sous CashRegister (artefact opérationnel par-shift, pas un report analytique). La card "Daily Sales (Soon)" reste en place — sortie Vague B (livré comme vrai report) ou retirée si décision business.

### 5.5 Hooks nouveaux

- `useZReports(filters)` — list paginé via SELECT z_reports + jointure user_profiles.
- `useZReport(id)` — single fetch.
- `useSignZReport()` mutation avec PIN-en-header + idempotency `useRef(crypto.randomUUID())`.
- `useVoidZReport()` mutation avec idempotency.
- `useGenerateZReportPdf()` mutation pour retry depuis UI.
- `useGeneratePdf()` mutation générique (template + data) pour le bouton PDF sur 13 pages.

---

## 6. Permissions matrix (S29 deltas)

| Permission | CASHIER | WAITER | MANAGER | ADMIN | SUPER_ADMIN |
|---|---|---|---|---|---|
| `zreports.read` | — | — | ✓ | ✓ | ✓ |
| `zreports.sign` | — | — | ✓ | ✓ | ✓ |
| `zreports.void` | — | — | — | ✓ | ✓ |

---

## 7. Tests

### 7.1 pgTAP `supabase/tests/zreports.test.sql` (≥ 12 cas)
- T1 close_shift_v2 happy → z_reports draft row inserted + snapshot non-null + UNIQUE(shift_id) respect
- T2 close_shift_v2 idempotence : 2e call sur même shift_id raises UNIQUE violation handled gracefully
- T3 sign_zreport_v1 happy : draft → signed, signed_at/by populated, audit_log row
- T4 sign_zreport_v1 idempotence : re-sign returns idempotent_replay
- T5 sign_zreport_v1 CASHIER → 42501 (perm denied)
- T6 sign_zreport_v1 not found → P0002
- T7 sign_zreport_v1 already voided → P0003
- T8 void_zreport_v1 happy : signed → voided
- T9 void_zreport_v1 MANAGER → 42501
- T10 void_zreport_v1 reason < 10 char → CHECK violation
- T11 z_reports RLS : authenticated SELECT works ; INSERT/UPDATE/DELETE blocked
- T12 storage.objects RLS zreports/ : SELECT requires `zreports.read` perm
- T13 storage.objects RLS reports-exports/ : SELECT owner-only
- T14 REVOKE EXECUTE FROM anon on 3 RPCs

### 7.2 Vitest live EF tests (4 nouveaux fichiers)
- `supabase/tests/functions/generate-pdf.test.ts` — happy + invalid_template + rate-limited + perm denied (5 cas)
- `supabase/tests/functions/generate-zreport-pdf.test.ts` — happy + idempotency replay + not_found (4 cas)
- `supabase/tests/functions/sign-zreport.test.ts` — PIN-en-header valid + invalid PIN + audit (3 cas)

(Live run requires SUPABASE_SERVICE_ROLE_KEY env — same pattern as S25/S28.)

### 7.3 BO smoke tests (10 nouveaux fichiers)
- `__tests__/ExportButtons.smoke.test.tsx` — CSV download trigger + PDF EF call assertion (2 cas)
- `__tests__/DateRangePickerWithCompare.smoke.test.tsx` — toggle on/off + 2-fetch (2 cas)
- `__tests__/DeltaPct.smoke.test.tsx` — pct render + edge previous=0 (2 cas)
- `__tests__/ZReportsListPage.smoke.test.tsx` — list render + filter status + draft action visible (3 cas)
- `__tests__/SignZReportModal.smoke.test.tsx` — PIN-en-header mutation + idempotency reset on dismiss (2 cas)
- `__tests__/VoidZReportModal.smoke.test.tsx` — reason min-length + admin gate (2 cas)
- `__tests__/ProfitLossPage.compare.smoke.test.tsx` — compare toggle wires 2 fetches (1 cas)
- `__tests__/RecipeCostOverviewPage.csv-helper-migration.smoke.test.tsx` — output identique vs pré-S29 (1 cas)
- `__tests__/ProductionYieldPage.csv-helper-migration.smoke.test.tsx` — idem (1 cas)
- `__tests__/sidebar-zreports-entry.smoke.test.tsx` — entry visible avec perm, hidden sans (2 cas)

### 7.4 Domain unit tests Vitest
- `packages/domain/src/reports/__tests__/csv.test.ts` — ≥ 8 cas (escaping, BOM, delimiter, formatters, idr-round100, headers, empty rows, null cells)
- `packages/domain/src/reports/__tests__/period.test.ts` — ≥ 6 cas (mois calendaire, week, generic n-day, year-cross, BS snapshot mode, formatDelta edge cases)

### 7.5 Typecheck

`pnpm typecheck` sur les 6 packages doit rester GREEN après chaque wave.

---

## 8. Migration block

**Bloc réservé** : `20260606000010..035` (≈14 migrations + corrections).

Prévision séquencée (numérotation indicative — l'ordre exact est fixé Wave 1) :
- `_010` create_enum_z_report_status
- `_011` create_table_z_reports
- `_012` create_storage_buckets_zreports_and_exports
- `_013` create_storage_policies_zreports_and_exports
- `_014` create_helper_build_zreport_snapshot
- `_015` bump_close_shift_v2_with_zreport_draft
- `_016` create_sign_zreport_v1_rpc
- `_017` revoke_pair_sign_zreport_v1
- `_018` create_void_zreport_v1_rpc
- `_019` revoke_pair_void_zreport_v1
- `_020` create_get_zreport_snapshot_v1_rpc
- `_021` revoke_pair_get_zreport_snapshot_v1
- `_022` seed_zreports_permissions

Régen types post-Wave 1 via MCP `generate_typescript_types` → `packages/supabase/src/types.generated.ts`.

---

## 9. Waves

| Wave | Stream(s) | Dépendances |
|---|---|---|
| **0** | Spec doc + INDEX | — |
| **1** | DB : table z_reports + ENUM + RPCs + REVOKE pairs + perms seed + buckets RLS + helper snapshot | Wave 0 |
| **2** | Domain helpers : csv.ts + period.ts + Vitest unit | Wave 0 (parallèle Wave 1) |
| **3** | EF : `generate-pdf` + `generate-zreport-pdf` + 11 templates `_shared/pdf-templates/` + Vitest live | Wave 1 (buckets RLS) + Wave 2 (csv pas requis, period pas requis ici) |
| **4** | BO `<ExportButtons>` + `useGeneratePdf` + migration 4 CSV existants vers helper + boutons CSV/PDF sur 13 pages | Wave 2 + Wave 3 |
| **5** | BO `<DateRangePickerWithCompare>` + `<DeltaPct>` + wiring 5 reports + smoke tests | Wave 2 (parallèle Wave 4) |
| **6** | BO Z-Report : `ZReportsListPage` + `SignZReportModal` + `VoidZReportModal` + 5 hooks + sidebar entry + route | Wave 1 (table + RPCs) + Wave 3 (EF generate-zreport-pdf) |
| **7** | Closeout : pgTAP cloud run + BO smoke tests verifies + typecheck full sweep + INDEX writeup + CLAUDE.md Active Workplan update | Toutes |

**Parallélisation** : Wave 1 et Wave 2 démarrent en parallèle (DB stream + Domain stream). Wave 3 attend Wave 1. Wave 4/5/6 démarrent quand leurs deps sont prêts (peut overlap selon agents).

---

## 10. Closes officiels

- **TASK-14-005** (DateRangePicker compare) — **complet Wave A** (toggle + 5 reports câblés ; extension extra dims renvoyée Vague C)
- **TASK-12-002** (Z-Report PDF + signature) — **complet Wave A**
- **Gap 14-3** (CSV/PDF uniforme) — **complet sur 13 pages, le reste en Vague B/C**
- **G1, G2, G3** (audit en session) — **fermés**

---

## 11. Risques

- **R1 `pdf-lib` Deno compat** : esm.sh CDN parfois flaky ; fallback `https://cdn.skypack.dev/pdf-lib`. Bench cold-start ~300-500ms attendu.
- **R2 Storage policies** : la policy SELECT zreports/ référence `user_has_permission` (helper S20) — confirmer qu'elle est disponible dans le contexte storage.objects RLS (le helper existe en schema public, storage.objects en schema storage — passe via SECURITY DEFINER function wrapper si problème).
- **R3 Snapshot Z-Report calcul** : la query agrégée pour `_build_zreport_snapshot` sur orders+order_payments+expenses+stock_movements doit rester < 200ms même sur shifts longs (8h, ~500 orders). Bench Wave 1.
- **R4 PDF templates volume** : 11 templates dans 1 EF = bundle Deno ~200KB. Si tension cold-start, split en 2 EFs (`generate-finance-pdf` + `generate-sales-pdf`). Décidé après Wave 3 bench.
- **R5 CSV migration des 4 existants** : risque de drift output. Mitigé par snapshot test bytes-identical avant/après dans la même commit.
- **R6 Comparison vs prev period sur Balance Sheet** : BS est un snapshot à date donnée, pas un range. "Prev period" = same calendar offset (e.g., end of previous month). Documenté dans `previousPeriod` helper avec mode 'snapshot' optionnel.

---

## 12. Hors scope Vague A (renvoyé Vagues B/C/backlog)

**Vague B candidate** (nouveaux reports métier bakery, post-merge S29) :
- Wastage & Spoilage report (KPI critique boulangerie)
- Payment by Method (split cash/card/QRIS quotidien)
- VAT/PB1 Report (compliance fiscale NON-PKP — PB1 10% sortie monthly)
- Stock Movement history (vue append-only filtrable)
- Perishable Turnover (j moyen avant vente vs casse — TASK-14-016)

**Vague C candidate** (UX & productivité, post-merge S29 + B) :
- Drill-down navigation `<DrilldownLink>` (TASK-14-009)
- UnifiedReportFilters extra dims (category/terminal/customer_type) (TASK-14-005 reste)
- Mobile responsive tables → cards (TASK-14-010)
- Hub mini-KPI bar (revenue/orders/waste du jour)
- Hub favorites/pinned reports per user

**Backlog hors S29-S31** :
- Scheduled email reports (TASK-14-008)
- Unusual Transactions / fraud (TASK-14-013)
- Custom report builder (TASK-14-007)
- Peak Hour Staffing (TASK-14-015)
- Sales by Brand (TASK-14-018), Purchase Returns (TASK-14-019), Outgoing Stocks (TASK-14-020), Table Turnover (TASK-14-017)

---

## 13. Deviations log (slot vide — rempli pendant l'implémentation)

| ID | Wave | Sévérité | Description | Résolution |
|---|---|---|---|---|
| _(à remplir)_ | | | | |

Convention : DEV-S29-{wave}-{seq}-{topic}. Severités : informational / low / medium / high. Medium/high doivent être résolues avant merge ou explicitement acceptées avec justification.
