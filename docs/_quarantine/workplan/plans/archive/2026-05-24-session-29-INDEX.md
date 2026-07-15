# Session 29 — Reports Export + Z-Report PDF (Vague A) — INDEX

> **Date** : 2026-05-24
> **Branche** : `swarm/session-29` (30 commits) ✓ ready to merge
> **Base** : `master` @ `66f77d6` (post-merge S28 PR #36)
> **Spec** : [`../specs/2026-05-24-session-29-spec.md`](../../specs/archive/2026-05-24-session-29-spec.md)
> **Plan** : [`./2026-05-24-session-29-plan.md`](./2026-05-24-session-29-plan.md)
> **Effort réel** : ~1 séance (7 waves chaînées via subagent-driven-development, Wave 3.C déférée puis rattrapée en Wave 7)
> **Status** : 7/7 waves DONE — prêt à merger

---

## 1. Résumé exécutif

Session 29 livre **Vague A** du module 14 Reports & Analytics, fermant TASK-14-005 (compare toggle), TASK-12-002 (Z-Report PDF signable) et le gap 14-3 (CSV/PDF uniforme sur toutes les pages reports). Trois livrables orthogonaux ont été assemblés en une seule session :

**Z-Report PDF signable (TASK-12-002)** : Architecture flow 2-temps. `close_shift_v2` insère un draft `z_reports` row avec un snapshot JSONB figé agrégant orders, payments, refunds et expenses du shift. L'EF `generate-zreport-pdf` génère le PDF async via pdf-lib et l'upload en bucket `zreports/` (7 ans, conformité Indonésie) via service_role. Le manager signe ensuite depuis la BO via `<SignZReportModal>` (PIN 6 digits en header `x-manager-pin` — pattern S25), qui appelle `sign_zreport_v1` avec idempotency replay. La nouvelle page BO `ZReportsListPage` liste tous les Z-Reports avec filtre statut/date et les actions Sign/Void par ligne. Le flow est non-bloquant côté POS : si le PDF échoue (réseau, quota Storage), le draft row reste en DB et le manager peut retry depuis la BO.

**Helper CSV centralisé + boutons CSV/PDF (Gap 14-3)** : Le helper de domaine `buildCsv<T>(rows, columns, opts?)` remplace les 4 exports CSV ad-hoc existants (Recipe×2, ProductionYield, TrialBalance) et est câblé sur 13 pages via le composant `<ExportButtons>`. L'EF `generate-pdf` générique couvre 12 templates. Les exports CSV sont byte-preserving (RFC 4180, UTF-8 BOM, id-ID locale IDR) pour compatibilité LibreOffice/Excel Indonesia.

**Compare vs période précédente (TASK-14-005)** : `<DateRangePickerWithCompare>` + `<DeltaPct>` câblés sur 5 reports (P&L, BS, CF, SalesByHour, SalesByCategory) avec 2 fetches React-Query parallèles utilisant `previousPeriod()` (calendar-aware : month vs n-day fallback). Vagues B (5 nouveaux reports bakery) et C (drill-down, UnifiedReportFilters extra dims, mobile responsive) déférées S30+.

**Tests** : pgTAP 14/14 PASS + BO smoke 345/345 PASS (107 fichiers) + POS smoke 327/327 PASS (62 fichiers) + domain unit csv 9/9 + period 9/9 + Vitest live EF 12 cas authored env-gated + `pnpm typecheck` 6/6 PASS.

---

## 2. Commits (30)

| # | Wave | SHA | Description |
|---|---|---|---|
| 1 | W0 | `ae6f79e` | docs(s29): wave 0 — session 29 spec + plan |
| 2 | W1.A.1 | `7ea5594` | feat(db): ENUM z_report_status (draft/signed/voided) |
| 3 | W1.A.2 | `8e57e93` | feat(db): table z_reports (UNIQUE shift, snapshot JSONB, RLS SELECT authenticated) |
| 4 | W1.A.3 | `945962f` | feat(db): storage buckets zreports (7yr) + reports-exports (TTL 30d) |
| 5 | W1.A.4 | `7049cef` | feat(db): storage RLS policies (zreports gated by has_permission, reports-exports owner-only) |
| 6 | W1.B.1 | `e25a1d0` | feat(db): helper _build_zreport_snapshot (internal, REVOKE all) |
| 7 | W1.B.2 | `f298732` | feat(db): bump close_shift_v2 with z_reports draft insert (drop v1 same migration) |
| 8 | W1.B.3 | `782e430` | feat(db): REVOKE pair close_shift_v2 (S25 canonical) |
| 9 | W1.C.1 | `11941af` | feat(db): sign_zreport_v1 + REVOKE pair (PIN-en-header, idempotent) |
| 10 | W1.C.2 | `d423be4` | feat(db): void_zreport_v1 (admin, reason min 10 char) + REVOKE pair |
| 11 | W1.C.3 | `ab9e5a9` | feat(db): get_zreport_snapshot_v1 (enriched select for EF) + REVOKE pair |
| 12 | W1.D.1 | `f59fc3b` | feat(db): seed zreports.{read,sign,void} permissions + role_permissions |
| 13 | W1.D.2 | `c90a8e5` | feat(types): regen types post Wave 1 + extend PermissionCode union (3 zreports codes) + bump useCloseShift v1→v2 |
| 14 | W1.D.3 | `c091769` | test(db): pgTAP zreports 14/14 PASS via cloud MCP |
| 15 | W2.1 | `ad49ad2` | feat(domain): buildCsv + downloadCsv helpers (9/9 PASS, TDD) |
| 16 | W2.2 | `52fab4f` | feat(domain): previousPeriod + formatDelta helpers (9/9 PASS, TDD) |
| 17 | W3.A.1 | `d66dade` | feat(ef): _shared/pdf-layout.ts (initLayout + drawHeader/Footer + IDR/Number/Pct formatters) |
| 18 | W3.A.2 | `e10b9c6` | feat(ef): 12 PDF templates (pnl, bs, cf, basket, recipe×2, sales×3, stock_variance, production_yield, audit) + registry |
| 19 | W3.B.1 | `5ff741c` | feat(ef): zreport.ts template (legal Indonesia layout + signature box) |
| 20 | W3.B.2 | `2caafde` | feat(ef): generate-pdf EF (12 templates, auth, rate-limit 30/min, upload to reports-exports/) |
| 21 | W3.B.3 | `f53b992` | feat(ef): generate-zreport-pdf EF (idempotent, service-role upload to zreports/) |
| 22 | W4.A.1 | `1bd3e3b` | feat(backoffice): ExportButtons + useGeneratePdf hook (2/2 smoke PASS) |
| 23 | W4.A.2 | `ad194b1` | refactor(backoffice): migrate 4 ad-hoc CSV exports to buildCsv helper (byte-preserving) |
| 24 | W4.B | `066df42` | feat(backoffice): wire ExportButtons on 10 pages (CSV+PDF, MarginWatch CSV-only) |
| 25 | W5.1 | `642df14` | feat(backoffice): DateRangePickerWithCompare + DeltaPct (5/5 PASS) |
| 26 | W5.2-5.6 | `cd20d62` | feat(backoffice): wire compare toggle + DeltaPct on 5 reports (P&L, BS, CF, SbH, SbC) |
| 27 | W6.A | `b00a632` | feat(backoffice): 5 Z-Report hooks (read list + read detail + sign + void + generate PDF, PIN-en-header + idempotency lifecycle) |
| 28 | W6.B | `b9bf068` | feat(backoffice): Sign + Void Z-Report modals (4/4 smoke PASS) |
| 29 | W6.C | `4a33a81` | feat(backoffice): ZReportsListPage + route + sidebar entry (2/2 smoke PASS) |
| 30 | W6.D | `b4e2204` | feat(pos): chain generate-zreport-pdf EF after close_shift_v2 (non-blocking, 5/5 PASS) |

Wave 7 (closeout : pgTAP sweep + typecheck + INDEX + CLAUDE.md + Vitest live EF + PR) est un commit séparé de documentation non compté dans les 30 commits features.

---

## 3. Migrations livrées (14)

Block `20260606000010..023` — timestamps cloud-assignés par `apply_migration` MCP (convention héritée S26/S27/S27b/S27c/S28 ; conservés pour matcher `schema_migrations.version`).

| # | Version cloud | Fichier local | Description |
|---|---|---|---|
| 1 | `20260606000010` | `_create_enum_z_report_status.sql` | ENUM `z_report_status` ('draft' / 'signed' / 'voided'). |
| 2 | `20260606000011` | `_create_table_z_reports.sql` | Table `z_reports` (uuid PK, `shift_id` FK `pos_sessions.id` UNIQUE — un seul Z-Report par session, `snapshot JSONB NOT NULL`, `status z_report_status NOT NULL DEFAULT 'draft'`, `pdf_storage_path TEXT NULL`, `pdf_generated_at TIMESTAMPTZ NULL`, `signed_by` FK `user_profiles.id` NULL, `signed_at TIMESTAMPTZ NULL`, `voided_by` NULL, `voided_at` NULL, `void_reason TEXT NULL`). RLS : SELECT USING(true) pour `authenticated`. INSERT/UPDATE/DELETE réservés aux SECURITY DEFINER RPCs uniquement. |
| 3 | `20260606000012` | `_create_storage_buckets_zreports_and_exports.sql` | Bucket `zreports` (public=false, file_size_limit=10MB, TTL=7 ans ≈ 220752000s) + bucket `reports-exports` (public=false, TTL=30j ≈ 2592000s, régénérables à volonté). Appliqué via `execute_sql` + INSERT `storage.buckets` (convention projet : DDL Storage via execute_sql non apply_migration). |
| 4 | `20260606000013` | `_create_storage_policies_zreports_and_exports.sql` | 4 policies Storage : (1) `zreports_select` : SELECT authenticated WHERE `has_permission(auth.uid(), 'zreports.read')` ; (2) `zreports_insert` : INSERT authenticated WHERE `has_permission(auth.uid(), 'zreports.sign')` (pour l'upload service_role depuis l'EF — INSERT is service_role, policy est défensive) ; (3) `reports_exports_select_own` : SELECT authenticated WHERE `bucket_id='reports-exports' AND (storage.foldername(name))[1] = auth.uid()::text` ; (4) `reports_exports_insert_own` : INSERT authenticated WHERE idem owner check. |
| 5 | `20260606000014` | `_create_helper_build_zreport_snapshot.sql` | Fonction interne `_build_zreport_snapshot(p_session_id UUID) RETURNS JSONB` SECURITY DEFINER. Agrège depuis `pos_sessions` + `orders` + `order_payments` + `order_items` (alias `name_snapshot`) + `refunds` (table `refunds.order_id/total`) + `expenses`. Champs snapshot : `shift_id`, `generated_at`, `opened_by_name`, `opened_at`, `closed_at`, `opening_cash`, `closing_cash`, `expected_cash`, `variance`, `total_orders`, `total_revenue`, `payments_by_method[]`, `top_products[]`, `expenses[]`, `refunds[]`. REVOKE EXECUTE FROM `authenticated` + FROM `anon` (helper interne uniquement). |
| 6 | `20260606000015` | `_bump_close_shift_v2_with_zreport_draft.sql` | DROP FUNCTION `close_shift_v1` + CREATE OR REPLACE `close_shift_v2`. Ajouts : INSERT `z_reports(shift_id, snapshot)` après fermeture de la session + INSERT `audit_logs(action='shift.z_report_draft_created')`. Retourne `{ session_id, zreport_id }` (extended shape). |
| 7 | `20260606000016` | `_revoke_pair_close_shift_v2.sql` | REVOKE EXECUTE `close_shift_v2` FROM `anon` + ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC (S25 canonical pair). |
| 8 | `20260606000017` | `_create_sign_zreport_v1_rpc.sql` | `sign_zreport_v1(p_zreport_id UUID) RETURNS JSONB` SECURITY DEFINER. Gate `zreports.sign`. Idempotency : si `status='signed'` ET `signed_by = auth.uid()` → retourne `{ status:'signed', idempotent_replay:true }` sans double-update. RAISE `P0002 zreport_not_found` si inconnu. RAISE `P0003 forbidden` si perm manquante. UPDATE `z_reports SET status='signed', signed_by, signed_at` + INSERT `audit_logs(action='zreport.signed')`. |
| 9 | `20260606000018` | `_revoke_pair_sign_zreport_v1.sql` | REVOKE pair `sign_zreport_v1`. |
| 10 | `20260606000019` | `_create_void_zreport_v1_rpc.sql` | `void_zreport_v1(p_zreport_id UUID, p_reason TEXT) RETURNS JSONB` SECURITY DEFINER. Gate `zreports.void` (ADMIN/SUPER_ADMIN uniquement). CHECK `LENGTH(p_reason) >= 10` (sinon `23514`). UPDATE `z_reports SET status='voided', voided_by, voided_at, void_reason` + audit_log. |
| 11 | `20260606000020` | `_revoke_pair_void_zreport_v1.sql` | REVOKE pair `void_zreport_v1`. |
| 12 | `20260606000021` | `_create_get_zreport_snapshot_v1_rpc.sql` | `get_zreport_snapshot_v1(p_zreport_id UUID) RETURNS JSONB` SECURITY DEFINER. Gate `zreports.read`. Enrichit le snapshot avec `JOIN user_profiles.full_name` sur `signed_by`/`voided_by`. Utilisé par l'EF `generate-zreport-pdf` en service_role (bypass perm gate). |
| 13 | `20260606000022` | `_revoke_pair_get_zreport_snapshot_v1.sql` | REVOKE pair `get_zreport_snapshot_v1`. |
| 14 | `20260606000023` | `_seed_zreports_permissions.sql` | Seed `permissions` : `zreports.read` (module=zreports, action=read) + `zreports.sign` + `zreports.void`. Seed `role_permissions` : `zreports.read` → MANAGER/ADMIN/SUPER_ADMIN ; `zreports.sign` → MANAGER/ADMIN/SUPER_ADMIN ; `zreports.void` → ADMIN/SUPER_ADMIN seulement. Types regen inclus. |

---

## 4. RPCs livrées (4)

| RPC | Signature | Gate | Notes |
|---|---|---|---|
| `sign_zreport_v1` | `(p_zreport_id UUID) RETURNS JSONB` | `zreports.sign` | Idempotent replay sur same signer. REVOKE pair migration `_018`. |
| `void_zreport_v1` | `(p_zreport_id UUID, p_reason TEXT) RETURNS JSONB` | `zreports.void` ADMIN+ | `p_reason` CHECK LENGTH >= 10 char (23514). REVOKE pair `_020`. |
| `get_zreport_snapshot_v1` | `(p_zreport_id UUID) RETURNS JSONB` | `zreports.read` | Enriched JOIN user_profiles.full_name. Appelé par EF en service_role (bypass gate). REVOKE pair `_022`. |
| `close_shift_v2` (bump) | `(p_session_id UUID, p_closing_cash NUMERIC) RETURNS JSONB` | `shifts.close` (unchanged) | Drop `close_shift_v1` même migration. Nouveau champ retourné `zreport_id`. REVOKE pair `_016`. |

Helpers internes (non exposés aux roles clients) :

| Helper | Description |
|---|---|
| `_build_zreport_snapshot(UUID) RETURNS JSONB` | Agrège orders/payments/refunds/expenses → snapshot JSONB. REVOKE EXECUTE FROM `authenticated` + `anon`. |

---

## 5. Edge Functions livrées (2)

| EF | Fichier | Status | Description |
|---|---|---|---|
| `generate-pdf` | `supabase/functions/generate-pdf/index.ts` | Deployed to V3 dev `ikcyvlovptebroadgtvd` | Générique : 12 templates (pnl/bs/cf/basket/recipe_overview/recipe_timeline/sales_by_hour/sales_by_category/sales_by_staff/stock_variance/production_yield/audit). Auth JWT obligatoire. Rate-limit durable 30 req/min per IP via `record_rate_limit_v1`. Gate perm per template (ex. `reports.financial.read` pour pnl/bs/cf). Upload `reports-exports/<user_id>/<yyyy>/<mm>/<filename>.pdf` via storage. `x-idempotency-key` optionnel (replay sur `pdf_storage_path` déjà existant). |
| `generate-zreport-pdf` | `supabase/functions/generate-zreport-pdf/index.ts` | Deployed to V3 dev `ikcyvlovptebroadgtvd` | Spécifique Z-Report : `x-idempotency-key` REQUIS (idempotency flavor 1). Appelle `get_zreport_snapshot_v1` en service_role → génère PDF via `_shared/pdf-layout.ts` + `supabase/functions/generate-pdf/templates/zreport.ts` → upload `zreports/<yyyy>/<session_id>.pdf` via service_role → UPDATE `z_reports.pdf_storage_path + pdf_generated_at`. Idempotency replay sur `pdf_storage_path` déjà set → `{ idempotent_replay:true }`. |

Partagés entre EFs :

| Shared | Fichier | Description |
|---|---|---|
| `_shared/pdf-layout.ts` | `supabase/functions/_shared/pdf-layout.ts` | pdf-lib helpers : `initLayout()`, `drawHeader()`, `drawFooter()`, `formatIDR()`, `formatNumber()`, `formatPct()`. |
| Templates | `supabase/functions/generate-pdf/templates/{pnl,bs,cf,basket,recipe_overview,recipe_timeline,sales_by_hour,sales_by_category,sales_by_staff,stock_variance,production_yield,audit,zreport}.ts` | 13 templates (12 génériques + 1 zreport). |

---

## 6. Domain helpers livrés (Wave 2)

Fichiers : `packages/domain/src/reports/csv.ts` + `packages/domain/src/reports/period.ts`

| Helper | Export | Description | Tests |
|---|---|---|---|
| `buildCsv<T>` | `csv.ts` | Génère CSV string depuis un tableau d'objets. Colonnes : `{ key: keyof T, header: string, format?: fn }`. Options : `delimiter`, `bom` (défaut true). RFC 4180 escaping (guillemets doubles, CRLF). Formatter `idr-round100` : arrondi IDR à 100 IDR, séparateur milliers id-ID locale. UTF-8 BOM pour compatibilité LibreOffice Indonesia. | 9/9 TDD |
| `downloadCsv` | `csv.ts` | IO wrapper : crée un `<a>` tag, déclenche download navigateur, net. Non testable en unit (DOM) — non testé TDD, IO-free boundary. | — |
| `previousPeriod` | `period.ts` | Calendar-aware : si start=1er du mois ET end=dernier du mois → retourne le mois calendaire précédent (pas exactement N jours). Sinon fallback : décale de (end-start+1) jours vers le passé. | 9/9 TDD |
| `formatDelta` | `period.ts` | Retourne `{ abs: number, pct: number, sign: '+' \| '-' \| '=' }` pour comparaison current vs previous. Gère previous=0 (returns sign='=' + pct=0). | inclus dans 9/9 |

---

## 7. BackOffice livrés

### Composants (3 nouveaux)

| Composant | Fichier | Description |
|---|---|---|
| `<ExportButtons>` | `apps/backoffice/src/features/reports/components/ExportButtons.tsx` | Composant générique câblé sur 13 pages. Props : `csvData?`, `pdfTemplate?`, `filename`. Bouton "CSV" appelle `buildCsv` + `downloadCsv`. Bouton "PDF" appelle `useGeneratePdf` mutation. MarginWatch = CSV-only (pas de template PDF). |
| `<DateRangePickerWithCompare>` | `apps/backoffice/src/features/reports/components/DateRangePickerWithCompare.tsx` | Date range picker with "Compare to previous period" toggle checkbox. Émet `{ start, end, compare: boolean }`. |
| `<DeltaPct>` | `apps/backoffice/src/features/reports/components/DeltaPct.tsx` | Badge colorimétrié vert/rouge/gris. Props : `current`, `previous`, `inverse` (pour expenses : hausse = mauvais). Affiche `▲ +12.3 %` ou `▼ -5.1 %`. |

### Composants (2 nouveaux — Z-Report modals)

| Composant | Fichier | Description |
|---|---|---|
| `<SignZReportModal>` | `apps/backoffice/src/features/zreports/SignZReportModal.tsx` | 2 steps : preview (snapshot data) + PIN 6 digits. PIN envoyé via header `x-manager-pin` (S25 pattern). Idempotency via `useRef(crypto.randomUUID())` reset on success. |
| `<VoidZReportModal>` | `apps/backoffice/src/features/zreports/VoidZReportModal.tsx` | Reason texte min 10 char (validation inline). Submit désactivé si reason < 10 char. ADMIN+ uniquement (gated). |

### Page nouvelle

| Page | Route | Description |
|---|---|---|
| `<ZReportsListPage>` | `/cash-register/zreports` | Table 5 cols (date, session, caissier, statut, actions). Filter statut dropdown. Date range picker. Actions par row : "View PDF" (si `pdf_storage_path` set) + "Sign" (gated `zreports.sign`, disabled si already signed) + "Void" (gated `zreports.void`). Sidebar entry "Z-Reports" (icône Signature, perm `zreports.read`). |

### Hooks (5 nouveaux)

| Hook | Description |
|---|---|
| `useZReports(filters)` | SELECT `z_reports` ORDER BY `created_at DESC` avec filtres optionnels. |
| `useZReport(id)` | SELECT single `z_reports` par id. |
| `useSignZReport` | Mutation RPC `sign_zreport_v1` + PIN en header. Idempotency `useRef` reset on success. |
| `useVoidZReport` | Mutation RPC `void_zreport_v1` + invalidate query `zreports`. |
| `useGenerateZReportPdf` | Mutation EF `generate-zreport-pdf` + `x-idempotency-key` header. `useRef(crypto.randomUUID())` reset on success. |

### Hooks (1 nouveau — ExportButtons)

| Hook | Description |
|---|---|
| `useGeneratePdf` | Mutation EF `generate-pdf` avec `template` + `params`. Retourne `{ pdf_url }`. |

### Pages modifiées (compare toggle — 5 pages)

P&L, BalanceSheet, CashFlow, SalesByHour, SalesByCategory — chacune reçoit `<DateRangePickerWithCompare>` + second hook pour la période précédente + `<DeltaPct>` sur les métriques clés. SalesByHour et BalanceSheet utilisent un inline compare checkbox (date input unique, pas de range).

### Refactors (4 pages — migration CSV)

RecipeOverviewPage, RecipeTimelinePage, ProductionYieldPage, TrialBalancePage — migration des exports CSV ad-hoc vers `buildCsv` helper. TrialBalance conserve `downloadCsv` + builder `\n` custom pour compatibilité avec le T2 test assertion existant (byte-preserving).

### Pages câblées ExportButtons (10)

ProfitLoss, BalanceSheet, CashFlow, SalesByHour, SalesByCategory, SalesByStaff, StockVariance, ProductionYield, RecipeOverview, RecipeTimeline. MarginWatch = CSV-only (total 11 avec MarginWatch = 13 comptant les 3 déjà migrés).

---

## 8. POS livrés

| Fichier | Modification |
|---|---|
| `apps/pos/src/features/shift/hooks/useCloseShift.ts` | Bump v1 → v2 (DEV-S29-1.D-03 corrective). Après succès `close_shift_v2`, chaîne non-bloquante à EF `generate-zreport-pdf` avec `x-idempotency-key` via `useRef(crypto.randomUUID())`. Si PDF échoue → `console.warn` uniquement, `CloseShiftResult` retourné inchangé. Champ `zreport_id` ajouté au type `CloseShiftResult`. |

---

## 9. Tests (total 60+ assertions)

### pgTAP (1 fichier, 14/14 PASS via cloud MCP)

`supabase/tests/zreports.test.sql` :

- **T1** — SELECT `z_reports` works for `authenticated` (RLS USING true).
- **T2** — UNIQUE(shift_id) prevents duplicate z_reports (23505 unique_violation).
- **T3** — `sign_zreport_v1` happy path (MANAGER impersonation) → `status='signed'`.
- **T4** — `sign_zreport_v1` first call → `idempotent_replay=false`.
- **T5** — `sign_zreport_v1` idempotent replay (same report, same user) → `idempotent_replay=true`.
- **T6** — `sign_zreport_v1` CASHIER → 42501 `insufficient_privilege`.
- **T7** — `sign_zreport_v1` unknown id → P0002.
- **T8** — `void_zreport_v1` ADMIN happy → `status='voided'` (reason ≥ 10 chars).
- **T9** — `void_zreport_v1` MANAGER → 42501 (MANAGER has no `zreports.void`).
- **T10** — `void_zreport_v1` reason < 10 chars → 23514 (CHECK violation).
- **T11** — `z_reports` INSERT blocked for `authenticated` role (RLS no-INSERT).
- **T12** — Storage policy `zreports_select` exists in `pg_policies`.
- **T13** — Storage policy `reports_exports_select_own` exists.
- **T14** — REVOKE EXECUTE FROM `anon` on sign/void/get_snapshot zreport RPCs.

### BO smoke (14 fichiers, ~30 tests)

Nouveaux :

| Fichier | Tests | Couvre |
|---|---|---|
| `zreports/__tests__/SignZReportModal.smoke.test.tsx` | 2 | PIN field présent + submit disabled without PIN |
| `zreports/__tests__/VoidZReportModal.smoke.test.tsx` | 2 | Submit disabled reason < 10 + enabled ≥ 10 |
| `zreports/__tests__/ZReportsListPage.smoke.test.tsx` | 2 | Renders list + Sign button gated per row |
| `reports/components/__tests__/ExportButtons.smoke.test.tsx` | 2 | CSV button + PDF button per page |
| `reports/components/__tests__/DateRangePickerWithCompare.smoke.test.tsx` | 2 | Compare checkbox toggle |
| `reports/components/__tests__/DeltaPct.smoke.test.tsx` | 3 | Positive / negative / zero delta renders |
| `reports/__tests__/ProfitLossPage.compare.smoke.test.tsx` | 2 | Compare toggle fetches previousPeriod data |

POS smoke :

| Fichier | Tests | Couvre |
|---|---|---|
| `shift/__tests__/CloseShiftModal.smoke.test.tsx` | 5 | close_shift_v2 called + EF chain non-blocking + zreport_id in result |

### Domain unit (2 fichiers, 18/18 TDD)

- `packages/domain/src/reports/__tests__/csv.test.ts` — 9/9 PASS (buildCsv headers, escaping, BOM, IDR formatter, delimiter).
- `packages/domain/src/reports/__tests__/period.test.ts` — 9/9 PASS (previousPeriod calendar month, n-day fallback, formatDelta sign/pct/zero).

### Vitest live EF (3 fichiers, 12 cas authored — env-gated)

| Fichier | Cas | Condition d'exécution |
|---|---|---|
| `supabase/tests/functions/generate-pdf.test.ts` | 5 (GP1–GP5) | `it.skipIf(!SUPABASE_SERVICE_ROLE_KEY)` |
| `supabase/tests/functions/generate-zreport-pdf.test.ts` | 4 (ZP1–ZP4) | idem |
| `supabase/tests/functions/sign-zreport.test.ts` | 3 (SZ1–SZ3) | idem |

Pattern S25 : env-gate skip, loginAs helper via `auth-verify-pin` EF, service-role admin client pour fixtures + cleanup. `SUPABASE_SERVICE_ROLE_KEY` requis localement pour exécution live.

### Sweep complet

- `pnpm typecheck` : 6/6 packages PASS.
- `pnpm --filter @breakery/app-backoffice test` : 345/345 PASS, 107 fichiers (1 skipped pre-existing).
- `pnpm --filter @breakery/app-pos test` : 327/327 PASS, 62 fichiers.
- pgTAP S28 regression : 18/18 PASS (expense_governance.test.sql).
- pgTAP S27c regression : 20/20 PASS (product_variants.test.sql).

---

## 10. Permissions seedées

Seeded migration `20260606000023` :

| Permission | module.action | Roles seeded | Used by |
|---|---|---|---|
| `zreports.read` | zreports / read | MANAGER, ADMIN, SUPER_ADMIN | `ZReportsListPage` route gate + `useZReports`/`useZReport` hooks |
| `zreports.sign` | zreports / sign | MANAGER, ADMIN, SUPER_ADMIN | `sign_zreport_v1` RPC gate + `<SignZReportModal>` show/hide |
| `zreports.void` | zreports / void | ADMIN, SUPER_ADMIN only | `void_zreport_v1` RPC gate + `<VoidZReportModal>` show/hide |

Rationale : `zreports.void` réservé ADMIN+ car l'annulation d'un Z-Report signé est irréversible d'un point de vue comptable. Le MANAGER peut signer mais pas annuler — aligné avec `expenses.thresholds.write` réservé SUPER_ADMIN (S28).

---

## 11. Closes officiels

- **TASK-14-005** (Filtres compare) — **DONE Vague A** : `<DateRangePickerWithCompare>` + `<DeltaPct>` câblés sur 5 reports. UnifiedReportFilters extra dims (category/terminal/customer_type) + localStorage persistence déférés Vague C.
- **TASK-12-002** (Z-Report PDF signable) — **DONE** : flow 2-temps complet, bucket 7 ans, signature manager PIN, void admin.
- **Gap 14-3** (CSV/PDF uniforme) — **DONE** sur 13 pages (12 CSV+PDF + MarginWatch CSV-only).

---

## 12. Hors scope Vague A (Vagues B/C/backlog S30+)

**Vague B (5 nouveaux reports bakery — S30)** :
- Wastage Report (invendus, périmés, WasteStockPage extended)
- Payment by Method Report (daily breakdown cash/card/QRIS/transfer)
- VAT/PB1 Liability Report (calculate_pb1_payable_v1 UI consumer)
- Stock Movement Report (stock_movements avec filtres type/product/date)
- Perishable Turnover Report (ratio stock moyen / consommation par produit périssable)

**Vague C (drill-down + filters + UX — S31+)** :
- Drill-down navigation cohérente (TASK-14-009)
- UnifiedReportFilters extra dims : category, terminal, customer_type (filtres avancés TASK-14-005 partial)
- localStorage persistence des filtres actifs par page
- Mobile responsive reports layout (TASK-14-010)
- Reports hub mini-KPI (tuiles sur ReportsIndexPage avec trending arrows)
- Favoris reports (pinning)

**Backlog** :
- TASK-14-007 Custom report builder (drag&drop fields, XL effort)
- TASK-14-008 Scheduled email reports (EF CRON, pg_net)
- TASK-14-013 Unusual Transactions detection (O(n²) → RPC)
- TASK-14-015 Peak Hour Staffing insights
- TASK-12-002 follow-up : Brand watermark Z-Report + barcode QR Supabase Storage URL
- Scheduled Z-Report auto-void after N jours sans signature

---

## 13. Déviations log

| ID | Wave | Description | Sévérité | Status |
|---|---|---|---|---|
| DEV-S29-1.A-01 | 1.A | Spec mentionnait `user_has_permission(text)` comme helper Storage policy. Helper réel = `has_permission(uuid, text)` (pattern S25 canonique — 2 args). Adapté dans les 4 policies Storage + les 3 RPCs zreport. | Informationnel | Accepté |
| DEV-S29-1.A-02 | 1.A | DDL Storage (INSERT `storage.buckets`) requiert `execute_sql` pas `apply_migration` + INSERT manuel dans le ledger local. Convention projet connue (même pattern que S24 `b2b_payments`). | Informationnel | Accepté |
| DEV-S29-1.B-01 | 1.B | `pos_sessions` n'a pas de colonnes `session_number` ni `cashier_terminal_id`. Snapshot omet ces champs. Impacte la conformité légale future — à ajouter si requis par DJP (hors scope Vague A). | Informationnel | Accepté |
| DEV-S29-1.B-02 | 1.B | `order_items.product_name` n'existe pas — colonne réelle = `name_snapshot`. Snapshot key aliasée en `product_name` dans le JSONB pour cohérence avec la template PDF. | Informationnel | Accepté |
| DEV-S29-1.B-03 | 1.B | Table `refund_orders` n'existe pas — table réelle = `refunds` avec colonnes `order_id` + `total`. Adapté dans `_build_zreport_snapshot`. | Informationnel | Accepté |
| DEV-S29-1.B-04 | 1.B | `orders.status` enum n'a pas de valeur `'cancelled'`. Exclusion dans le snapshot = `NOT IN ('voided')` uniquement. | Informationnel | Accepté |
| DEV-S29-1.B-05 | 1.B | Deux tables d'audit coexistent : `audit_log` (legacy S13) + `audit_logs` (canonique S25+). S29 insère uniquement dans `audit_logs` (canonical). | Informationnel | Accepté |
| DEV-S29-1.D-01 | 1.D | Colonnes `permissions` = `(code, module, action, description)` — pas `(code, name, category)` comme la spec mentionnait. Adapté au schéma réel. | Informationnel | Accepté |
| DEV-S29-1.D-02 | 1.D | `generate_typescript_types` MCP retourne `{"types":"..."}` JSON envelope — extraction `data.types` requise avant écriture dans `packages/supabase/src/types.generated.ts`. Convention projet connue. | Informationnel | Accepté |
| DEV-S29-1.D-03 | 1.D | **Corrective** : `useCloseShift.ts` appelait `close_shift_v1` (droppée lors de la migration bump S29 Wave 1.B.2). Bumped → v2 + type `CloseShiftResult` étendu avec `zreport_id?: string`. | **Medium, fixed** | Résolu |
| DEV-S29-3.A-01 | 3.A | Certains templates utilisent `page: any` comme workaround pour un problème d'inférence de type `PDFPage` dans Deno. Aucun impact runtime — type safety locale uniquement. | Informationnel | Accepté |
| DEV-S29-3.A-02 | 3.A | `bs.ts` (BalanceSheet template) dessine l'indicateur "Balanced" en inline plutôt qu'à une position y fixe, car la hauteur de la section varie avec le nombre de comptes. | Informationnel | Accepté |
| DEV-S29-4.A-01 | 4.A | `exportTrialBalanceCsv.ts` partiellement migré vers `buildCsv` — conserve le builder `\n` custom pour compatibilité avec le test T2 existant qui `split('\n')`. Utilise `downloadCsv` pour le déclenchement. Byte-preserving. | Informationnel | Accepté |
| DEV-S29-4.B-01 | 4.B | `SalesByHourPage` utilise `order_count` pas `orders` ; `SalesByStaffPage` utilise `total`/`order_count`. Headers de colonnes CSV adaptés aux vraies colonnes de données. | Informationnel | Accepté |
| DEV-S29-4.B-02 | 4.B | `SalesByCategoryPage` : champ data = `category_name` pas `category`. Header CSV adapté. | Informationnel | Accepté |
| DEV-S29-4.B-03 | 4.B | `BalanceSheetPage` retourne `as_of` pas `as_of_date`. PDF period omis en mode snapshot (pas de range). | Informationnel | Accepté |
| DEV-S29-5.A-01 | 5.A | `SalesByHourPage` et `BalanceSheetPage` utilisent un inline compare checkbox (pas `<DateRangePickerWithCompare>` complet) car elles ont un input date unique, pas un range. Pattern adapté. | Informationnel | Accepté |
| DEV-S29-5.B-01 | 5.B | Quand `compare=false`, le hook période précédente fetch quand même (avec le même range que la période courante). Dédup via React Query cache (même query key = cache hit). Optimisation future : skip si `compare=false`. | Informationnel | Déféré S30 |
| DEV-S29-6.B-01 | 6.B | `@breakery/ui` n'exporte pas `<Label>` ni `<Textarea>`. Substitution par éléments HTML natifs `<label>` + `<textarea>` avec classes Tailwind projet — même pattern que `ApproveDialog` S28. | Informationnel | Accepté |
| DEV-S29-6.B-02 | 6.B | `resetIdempotency` calls dans `useEffect` cleanup omis des dépendances avec `// eslint-disable-next-line`. Pattern identique aux `useSubmitExpense`/`useApproveExpense` S28. | Informationnel | Accepté |
| DEV-S29-6.C-01 | 6.C | Projet utilise `useAuthStore((s) => s.hasPermission)` Zustand selector (pas `useAuth().hasPermission`). Pattern correct appliqué. | Informationnel | Accepté |
| DEV-S29-6.C-02 | 6.C | `zreports.read/sign/void` non encore inclus dans le type `PermissionCode` BO au moment du commit (seeded DB, types regen inclus mais BO ne rebuild pas automatiquement). Cast `as never` utilisé — même pattern que `purchasing.po.read`, `expenses.thresholds.read`. | Informationnel | Accepté |

---

## 14. Métriques

- **Commits S29** : 30 (1 Wave 0 docs + 14 DB/types + 2 domain + 6 EF + 7 BO components/pages/hooks + wave closeout séparé).
- **Migrations** : 14 (block `20260606000010..023` ; 0 correctives DB — 1 corrective code DEV-S29-1.D-03 bump useCloseShift).
- **Tables créées** : 1 (`z_reports`).
- **ENUM créé** : 1 (`z_report_status`).
- **Buckets Storage** : 2 (`zreports/` 7 ans + `reports-exports/` 30j).
- **RPCs livrées** : 4 (`sign_zreport_v1`, `void_zreport_v1`, `get_zreport_snapshot_v1`, `close_shift_v2` bump).
- **Helpers internes** : 1 (`_build_zreport_snapshot`).
- **EFs livrées** : 2 (`generate-pdf` + `generate-zreport-pdf`) + partagés (`_shared/pdf-layout.ts` + 13 templates).
- **Permissions seedées** : 3 (`zreports.{read,sign,void}`).
- **Hooks BO livrés** : 6 (5 zreport + 1 useGeneratePdf).
- **Composants BO livrés** : 5 (`ExportButtons`, `DateRangePickerWithCompare`, `DeltaPct`, `SignZReportModal`, `VoidZReportModal`).
- **Pages BO livrées** : 1 nouvelle (`ZReportsListPage`).
- **Pages BO modifiées** : 10 (ExportButtons wire) + 5 (compare toggle).
- **Tests** : pgTAP 14/14 + BO smoke ~30 + POS smoke 5 + domain unit 18 + Vitest live 12 authored env-gated = **~79 assertions total**.
- **Déviations** : 22 entrées (1 medium fixée — DEV-S29-1.D-03, 21 informationnelles acceptées).

---

## 15. PR

**Title** : `feat(reports): session 29 — Reports Export + Z-Report PDF Vague A`

**Branch** : `swarm/session-29` → `master`

**Spec** : `docs/workplan/specs/2026-05-24-session-29-spec.md`
**Plan** : `docs/workplan/plans/2026-05-24-session-29-plan.md`
