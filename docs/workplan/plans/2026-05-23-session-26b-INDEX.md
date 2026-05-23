# Session 26b — INDEX (Comptable Cockpit UI core)

> **Date** : 2026-05-23
> **Branche** : `swarm/session-26b`
> **Base** : `master` @ `6b796b7` (post-merge PR #31 — S26 Wave 1 DB hardening)
> **Spec** : [`docs/workplan/specs/2026-05-23-session-26b-spec.md`](../specs/2026-05-23-session-26b-spec.md)
> **Effort réel** : ~1 séance (compressé via exécution séquentielle in-thread)
> **Status** : 6/6 waves DONE — prêt à merger

---

## 1. Commits

| # | Wave | SHA | Description |
|---|---|---|---|
| 0 | Spec | `da38421` | Spec S26b (ce fichier) |
| 1 | 1 | `ee43d3b` | Chart of Accounts — RPC `update_account_active_v1` + page + pgTAP 4/4 + smoke 3/3 |
| 2 | 2 | `a16119b` | Journal Entries — page + modal saisie OD (stepper 2 steps + PIN) + 2 smoke 3/3 |
| 3 | 3+4 | `a2007bb` | General Ledger drilldown + Trial Balance + CSV export — 2 + 2 smoke = 4/4 |
| 4 | 5 | `69d2df8` | FiscalPeriod close/lock modal + Settings/Accounting page — smoke 2/2 |
| 5 | 6 | `4f054be` | Wiring routes + sidebar + AccountingIndexPage (4 tiles) |

Total : **5 commits feat** + 1 spec = **6 commits** sur la branche.

---

## 2. Migrations DB (1)

Session 26b ne devait avoir **aucune migration** (UI only). Pre-flight Wave 1 a confirmé R1/DEV-S26b-1.A-01 : `accounts` table a RLS SELECT-only (`auth_read` policy) sans policy WRITE → besoin d'une RPC pour le toggle inline du ChartOfAccountsPage.

| Version cloud | Fichier local | Description |
|---|---|---|
| `20260523135820` | `20260523135820_create_update_account_active_v1_rpc.sql` | RPC `update_account_active_v1(p_account_id UUID, p_is_active BOOLEAN)` SECURITY DEFINER, gate `accounting.coa.write`, audit_log row `accounting.account.active_toggled`, idempotent no-op si état déjà demandé, REVOKE pair S20 canonique inline + ALTER DEFAULT PRIVILEGES idempotent. |

> Le timestamp local matche le timestamp cloud assigné par `mcp__plugin_supabase_supabase__apply_migration` (clock-based) — convention héritée de S27 (cf. CLAUDE.md note "Migration sequence active").

---

## 3. Pages livrées (6)

| # | Page | Route | Permission (route gate) | Composants |
|---|---|---|---|---|
| 1 | AccountingIndexPage | `/accounting` | (toujours visible, tiles filtrées per perm) | 4 tiles vers les pages |
| 2 | ChartOfAccountsPage | `/accounting/chart-of-accounts` | `accounting.coa.read` (toggle gated `accounting.coa.write`) | Table 6 cols + filter class + search code/name + toggle inline |
| 3 | JournalEntriesPage | `/accounting/journal-entries` | `accounting.gl.read` | Table 6 cols + filter période + drawer drilldown + modal saisie OD |
| 4 | GeneralLedgerPage | `/accounting/general-ledger` | `accounting.gl.read` | Account selector + date range + table avec running_balance + Load more |
| 5 | TrialBalancePage | `/accounting/trial-balance` | `accounting.tb.read` | Date range + table + badge balanced + CSV export Intl id-ID |
| 6 | SettingsAccountingPage | `/settings/accounting` | `accounting.period.close` | Table périodes + Close/Lock modal stepper avec PIN |

---

## 4. Composants livrés (5)

- `JournalEntryDetailDrawer` — Sheet right slide-in drilldown JE lines.
- `CreateManualJEModal` — Dialog stepper 2 steps (header + lines table balanced check + PIN 6 digits).
- `FiscalPeriodModal` — Dialog stepper 2 steps (period select + lock checkbox + PIN).
- `exportTrialBalanceCsv` — `buildTrialBalanceCsv(payload)` (UTF-8 BOM + Intl id-ID) + `downloadTrialBalanceCsv` (Blob + URL.createObjectURL).
- `AccountingIndexPage` (sous Pages) — Hub 4 tiles cards.

---

## 5. Hooks livrés (9)

| Hook | Fichier | Description |
|---|---|---|
| `useChartOfAccounts` | hooks/useChartOfAccounts.ts | SELECT accounts ORDER BY code (auth_read) |
| `useUpdateAccountActive` | hooks/useUpdateAccountActive.ts | RPC `update_account_active_v1` |
| `useJournalEntries({ startDate?, endDate? })` | hooks/useJournalEntries.ts | SELECT journal_entries LIMIT 200 entry_date DESC, id DESC |
| `useJournalEntryLines(entryId)` | hooks/useJournalEntryLines.ts | SELECT journal_entry_lines + JOIN accounts (code+name) |
| `useCreateManualJournalEntry` | hooks/useCreateManualJournalEntry.ts | RPC `create_manual_je_v1` |
| `usePostableAccounts` | hooks/usePostableAccounts.ts | SELECT accounts WHERE is_postable + is_active (mirror S13 + retourne `id` requis par RPC) |
| `useGeneralLedger({ accountId, startDate, endDate, cursor?, limit? })` | hooks/useGeneralLedger.ts | RPC `get_general_ledger_v1` cursor-paginate |
| `useTrialBalance(start, end)` | hooks/useTrialBalance.ts | RPC `get_trial_balance_v1` |
| `useFiscalPeriods` | hooks/useFiscalPeriods.ts | SELECT fiscal_periods LIMIT 48 |
| `useCloseFiscalPeriod` | hooks/useCloseFiscalPeriod.ts | RPC `close_fiscal_period_v1` |

---

## 6. Tests

### pgTAP (1 fichier, 4/4 PASS via cloud MCP)
- `supabase/tests/update_account_active_v1.test.sql` :
  - T1 — SUPER_ADMIN happy path toggle mutates `accounts.is_active`.
  - T2 — MANAGER (no `accounting.coa.write`) raises `P0003 forbidden`.
  - T3 — Unknown account_id raises `P0002 account_not_found`.
  - T4 — `audit_log` row `accounting.account.active_toggled` inserted with `old_is_active` + `new_is_active` payload keys.

### BO smoke (6 fichiers S26b, 12/12 PASS — sweep accounting 15/15 inclut 3 S13)
- `chart-of-accounts.smoke.test.tsx` 3/3 — renders + filter narrows + toggle perm allow/deny.
- `journal-entries.smoke.test.tsx` 2/2 — renders + opens modal + balanced 2-line submit calls `create_manual_je_v1` shape.
- `journal-entries-modal-validation.smoke.test.tsx` 1/1 — unbalanced surfaces inline error `je-modal-error` + asserts RPC NOT called.
- `general-ledger.smoke.test.tsx` 2/2 — select account triggers RPC + Load more passes `p_cursor` from page 1.
- `trial-balance.smoke.test.tsx` 2/2 — renders balanced badge + 2 rows + `buildTrialBalanceCsv` emits BOM + locale `1.500.000`.
- `fiscal-period-modal.smoke.test.tsx` 2/2 — PIN trop court surface error + lock=true checkbox propagé au RPC `p_lock`.

### Typecheck
- `pnpm --filter @breakery/app-backoffice typecheck` : erreurs **pré-existantes** sur `@dnd-kit/*`, `recharts`, `sonner` (env install incomplet, reproduit sur master, non lié S26b). Aucun fichier S26b nouvellement créé ne fail.

---

## 7. Permissions / Roles utilisés

Toutes seedées par S26 Wave 1.I migration `_026` (cf. CLAUDE.md S26 closeout) :

| Permission | Roles seeded |
|---|---|
| `accounting.coa.read` | MANAGER, ADMIN, SUPER_ADMIN |
| `accounting.coa.write` | SUPER_ADMIN only |
| `accounting.gl.read` | MANAGER, ADMIN, SUPER_ADMIN |
| `accounting.tb.read` | MANAGER, ADMIN, SUPER_ADMIN |
| `accounting.je.create_manual` | ADMIN, SUPER_ADMIN |
| `accounting.period.close` | MANAGER, ADMIN, SUPER_ADMIN |

---

## 8. Closes (TASK + gaps)

- **TASK-10-011** UI partie (visualisation cockpit) — **DONE** (4 pages livrées + index hub).
- **TASK-10-016** month-close foundation — **DONE** (FiscalPeriodModal + Settings/Accounting page livrés).
- INDEX S26 §8 **S26b** — **DONE** (6 waves cockpit core).

---

## 9. Hors scope (déféré S26c — backlog post-merge)

- **PB1ManagementPage** (renommée VATManagementPage → PB1ManagementPage) — pour aider à la déclaration PB1 mensuelle.
- **ARAgingPage** consommant `view_ar_aging` (S24).
- **BankReconciliationPage** + `ReconciliationDetailPage`.
- **CALK SAK EMKM page** (notes annexes aux états financiers).
- **Vrai keyset paginate JE** (S26b utilise LIMIT 200 ordered DESC, suffisant pour cardinalité Breakery).
- **Wave 4 tests BO complets** (couverture full des 9 pages plannées) — S26b couvre 6/9 (les 3 manquantes = scope S26c).
- **Wave 5 docs ref rebase** (`docs/reference/04-modules/10-accounting-double-entry.md` Partie II) — S26c.

---

## 10. Déviations & DEV log

| ID | Wave | Description | Status |
|---|---|---|---|
| DEV-S26b-1.A-01 | 1 | RLS UPDATE sur `accounts` indisponible → RPC `update_account_active_v1` créée (1 migration `20260523135820` + 1 pgTAP) | **Confirmé** post pre-flight, livré |
| DEV-S26b-1.A-02 | 1 | Pas d'ERRCODE `42501` mais `P0003 forbidden` pour cohérence avec S26 Wave 1.I family (close_fiscal_period_v1 + create_manual_je_v1 utilisent P0003) | Informationnel |
| DEV-S26b-1.A-03 | 1 | RPC inclut idempotent no-op (return `no_op: true`) si `accounts.is_active` est déjà celui demandé — pas dans spec mais évite audit_log row inutile | Informationnel (mieux) |
| DEV-S26b-2.A-01 | 2 | `useJournalEntries` utilise simple LIMIT 200 ordered DESC, pas vrai keyset paginate. Cardinalité Breakery estimée ~30-50 JE/mois → 200 = 4-6 mois. Vrai keyset déféré S26c | Acceptable MVP |
| DEV-S26b-2.B-01 | 2 | Drawer = Sheet right slide-in (`@breakery/ui/Sheet`) plutôt que Dialog modal. UX adaptée pour drilldown comparatif avec table de derrière toujours visible | Acceptable |
| DEV-S26b-2.C-01 | 2 | Modal saisie OD utilise Input password type pour PIN (pas NumpadPin de @breakery/ui qui est touch-optimized POS). BO desktop → input plus pratique | Acceptable |
| DEV-S26b-2.C-02 | 2 | Validation client minimum 2 lines hardcoded (matches RPC). Add/remove buttons disabled quand `lines.length <= 2` pour le remove | Informationnel |
| DEV-S26b-3.A-01 | 3 | `running_balance` calculé client-side à partir de `opening_balance` + cumul delta selon `account.balance_type`. RPC ne retourne pas running, juste opening + lines + totals. Coût négligeable pour ~50 lignes/page | Acceptable |
| DEV-S26b-3.A-02 | 3 | useState `pages: GLLineRaw[][]` accumulator + useEffect pour pousser chaque nouvelle page (déduplique via comparaison first.je_id pour éviter doubles renders). Reset complet quand account/période changent. Pattern simple mais pas SOTA — `useInfiniteQuery` aurait été plus propre, déféré S26c | Informationnel |
| DEV-S26b-4.A-01 | 4 | CSV format hardcoded id-ID locale (1500000 → "1.500.000"). Si admin EN ouvre le CSV dans Excel EN-US il verra "1.500.000" et risque mauvaise interprétation. Acceptable — Breakery est mono-locale Indonesia | Informationnel |
| DEV-S26b-5.A-01 | 5 | FiscalPeriodModal périodes filter `status === 'open' OR 'closed'` (locked exclu). Liste limitée à 48 (4 ans) — suffisant pour Breakery | Acceptable |
| DEV-S26b-5.A-02 | 5 | SettingsAccountingPage status badge color-coded (open=green, closed=amber, locked=red) — pas dans spec mais UX clair | Acceptable (mieux) |
| DEV-S26b-6.A-01 | 6 | Sidebar : nouvelle section Accounting est juste 4 entries indent:1 sous la ligne 'Accounting' existante (style consistent avec Reports/Inventory). Pas de nouvelle SectionLabel séparée | Acceptable |
| DEV-S26b-6.A-02 | 6 | AccountingIndexPage tiles filtrent par permission via `hasPerm` callback — empty state si aucune perm | Informationnel |

---

## 11. Métriques

- **Files créés** : 21 (1 migration, 1 pgTAP test, 4 BO pages, 4 BO components, 9 BO hooks, 2 misc + 1 spec + 1 INDEX)
- **Files modifiés** : 3 (types.generated.ts, layouts/Sidebar.tsx, routes/index.tsx)
- **Lignes ajoutées** (estimé via `git diff --stat HEAD~5..HEAD`) : ~1700
- **Tests** : 1 pgTAP suite (4 asserts) + 6 BO smoke files (12 tests) → 16/16 PASS
- **DB migrations** : 1 (`20260523135820`)

---

## 12. PR

**Title** : `feat(accounting): session 26b — comptable cockpit UI core (6 pages)`

**Branch** : `swarm/session-26b` → `master`

**Body** : Pointer à ce fichier (`docs/workplan/plans/2026-05-23-session-26b-INDEX.md`) pour le récap complet ; merge squash recommandé pour préserver les 5 commits feat séparés (Wave 1, 2, 3+4, 5, 6).
