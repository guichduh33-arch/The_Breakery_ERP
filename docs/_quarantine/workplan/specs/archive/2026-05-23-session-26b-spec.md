# Session 26b — Comptable Cockpit (UI core)

> **Date** : 2026-05-23
> **Branche** : `swarm/session-26b`
> **Base** : `master` @ `6b796b7` (post-merge PR #31 — S26 Wave 1 DB hardening)
> **Effort estimé** : **3-4 j·h** (5 pages)
> **Migration block** : **aucune migration prévue** (UI only) — bloc `20260604000010..099` réservé pour correctives pgTAP si découvertes

---

## 1. Objectifs

Livrer les **5 pages BO cockpit comptable** qui consomment les 4 RPCs + permissions seedées en S26 Wave 1 (PR #31 mergée). Toutes les RPCs et permissions sont déjà en place sur V3 dev cloud (`ikcyvlovptebroadgtvd`) — S26b est **100% UI scaffolding** sans changement DB attendu.

Cette session ferme la moitié `S26b` du split documenté dans [INDEX S26 §8](../../plans/archive/2026-05-20-session-26-INDEX.md). Les pages PB1 / AR Aging / Bank Reconciliation / CALK + Wave 4 tests + Wave 5 docs rebase restent pour **S26c**.

---

## 2. Scope (Waves)

### Wave 1 — ChartOfAccounts (~0.5j)

| Item | Détail |
|---|---|
| Route | `/accounting/chart-of-accounts` |
| Permission | `accounting.coa.read` (table+lecture) + `accounting.coa.write` (toggle is_active) |
| Hook(s) | `useChartOfAccounts` (SELECT direct `accounts` ordered by `code`) + `useToggleAccountActive` (UPDATE via RPC à créer si besoin, sinon UPDATE direct gated par RLS) |
| Page | Table 5 colonnes (code / name / class / balance_type / is_active) + filter par class + search par name/code + toggle active inline (perm gate) |
| Tests | `chart-of-accounts.smoke.test.tsx` : renders + filter + toggle (mock perm allow + deny) |

**Décision micro-archi** : `accounts.is_active` est-il toggleable via RLS direct UPDATE pour `accounting.coa.write` ou nécessite RPC `update_account_active_v1` ? → Pre-flight : `\d+ accounts` policies via MCP. Si pas de policy WRITE, on créé RPC SECURITY DEFINER `update_account_active_v1(p_account_id, p_is_active)` avec perm gate + audit_log row.

### Wave 2 — JournalEntries viewer + modal saisie OD (~1j)

| Item | Détail |
|---|---|
| Route | `/accounting/journal-entries` |
| Permission | `accounting.gl.read` (lecture) + `accounting.je.create_manual` (modal saisie OD) |
| Hook(s) | `useJournalEntries` (SELECT `journal_entries` + `journal_entry_lines` aggregat via VIEW ou subquery, paginate keyset `entry_date DESC, id DESC`) + `useCreateManualJournalEntry` (call RPC `create_manual_je_v1`) |
| Page | Table 6 colonnes (entry_date / je_number / description / total_debit / total_credit / source) + filter par période + click row drilldown lines |
| Modal | Stepper 2 steps : (1) header (description + entry_date), (2) lines table (account picker + debit/credit + auto-balanced check + PIN final) ; submit → RPC ; perm gate `accounting.je.create_manual` |
| Tests | `journal-entries.smoke.test.tsx` : renders + opens modal + balanced check + RPC payload assertion ; `journal-entries-modal-validation.smoke.test.tsx` : unbalanced raises inline error |

**Permission gate dans la modal** : bouton "+ New manual JE" gated visible. PIN entry via composant `PinPad` réutilisé de POS (ou primitive shadcn équivalente) — header `x-manager-pin` non applicable ici car RPC arg.

### Wave 3 — GeneralLedger drilldown (~0.75j)

| Item | Détail |
|---|---|
| Route | `/accounting/general-ledger` |
| Permission | `accounting.gl.read` |
| Hook(s) | `useGeneralLedger(accountId, start, end, cursor?)` → RPC `get_general_ledger_v1` cursor-paginate (limit=50 default), retourne `{ opening_balance, lines, totals, next_cursor }` |
| Page | Account selector (combobox alimenté par `accounts` actifs) + date range picker (default = current month) + tableau lines (date / je_number / description / debit / credit / running_balance) + footer totals + "Load more" si `next_cursor` |
| Tests | `general-ledger.smoke.test.tsx` : renders + select account + paginate (2 pages assertion) |

**Détail UX** : running_balance calculé côté client à partir de `opening_balance` + cumul des lines (le RPC retourne opening + lines bruts, pas running). Si plus tard on rajoute opening au RPC, on bumpera ce hook.

### Wave 4 — TrialBalance + CSV export (~0.5j)

| Item | Détail |
|---|---|
| Route | `/accounting/trial-balance` |
| Permission | `accounting.tb.read` |
| Hook | `useTrialBalance(start, end)` → RPC `get_trial_balance_v1`, retourne array `{ account_code, account_name, account_class, debit, credit }` + flag `balanced` |
| Page | Date range picker + tableau (code / name / class / debit / credit) + footer totals + balanced badge (green if balanced, red if not) + bouton "Export CSV" |
| CSV | UTF-8 BOM + header line + locale-aware NUMERIC (uses `Intl.NumberFormat('id-ID')`) + filename `trial-balance_YYYY-MM-DD_to_YYYY-MM-DD.csv` |
| Tests | `trial-balance.smoke.test.tsx` : renders + balanced badge + CSV header structure assertion (no DOM file download, juste le content) |

### Wave 5 — FiscalPeriodModal embeddé Settings (~0.5j)

| Item | Détail |
|---|---|
| Route | Embeddé dans `/settings/accounting` (ou nouvelle sous-tab si Settings n'a pas de section accounting) |
| Permission | `accounting.period.close` |
| Hook | `useFiscalPeriods` (SELECT `fiscal_periods` ORDER BY `period_start DESC`) + `useCloseFiscalPeriod` (RPC `close_fiscal_period_v1`) |
| Modal | Stepper 2 steps : (1) period selector + "lock backdating" checkbox + summary (revenue + expense + net), (2) PIN entry + confirm ; submit → RPC ; perm gate `accounting.period.close` |
| Audit | RPC émet déjà `audit_logs.action='period.closed'` row — UI doit afficher le row au retour pour confirmer |
| Tests | `fiscal-period-modal.smoke.test.tsx` : renders + PIN required + RPC payload (p_lock=true) |

### Wave 6 — Wiring routes + sidebar + perm gates (~0.25j)

| Item | Détail |
|---|---|
| `apps/backoffice/src/routes/index.tsx` | 5 nouvelles routes sous `accounting/*` avec `PermissionGate` wrappers ; remplacer le `<ComingSoonPage module="Accounting" />` placeholder par un index page `/accounting` (dashboard simple : 4 tiles vers les pages) |
| Sidebar | Section "Accounting" avec 5 entries (existante pour Mappings — ajouter les 4 nouvelles + tile Settings → FiscalPeriod) |
| `apps/backoffice/src/features/accounting/index.ts` | Barrel exports |

---

## 3. RPCs consommées (toutes existantes — S26 Wave 1)

| RPC | Signature (cf. types.generated.ts) | Usage S26b |
|---|---|---|
| `close_fiscal_period_v1` | `(p_period_id UUID, p_manager_pin TEXT, p_lock BOOLEAN DEFAULT FALSE) → JSONB` | FiscalPeriodModal |
| `get_general_ledger_v1` | `(p_account_id UUID, p_start DATE, p_end DATE, p_limit INT DEFAULT 50, p_cursor JSONB) → JSONB` | GeneralLedger |
| `get_trial_balance_v1` | `(p_start DATE, p_end DATE) → TABLE(...)` | TrialBalance |
| `create_manual_je_v1` | `(p_description TEXT, p_entry_date DATE, p_lines JSONB, p_manager_pin TEXT) → JSONB` | JournalEntries modal |

**RPC potentiellement à créer** (Wave 1 ChartOfAccounts) :
- `update_account_active_v1(p_account_id UUID, p_is_active BOOLEAN) → JSONB` — SECURITY DEFINER, perm gate `accounting.coa.write`, audit_logs row. **Décision finale** après inspection RLS policies sur `accounts`. Si oui : 1 migration `20260604000010_create_update_account_active_v1_rpc.sql` + REVOKE pair S25 canonique + 1 pgTAP.

---

## 4. Hooks BO à créer

```
apps/backoffice/src/features/accounting/
├── hooks/
│   ├── useChartOfAccounts.ts
│   ├── useToggleAccountActive.ts          (ou useUpdateAccountActive.ts si RPC)
│   ├── useJournalEntries.ts
│   ├── useJournalEntryLines.ts            (drilldown)
│   ├── useCreateManualJournalEntry.ts
│   ├── useGeneralLedger.ts
│   ├── useTrialBalance.ts
│   ├── useFiscalPeriods.ts
│   └── useCloseFiscalPeriod.ts
├── pages/
│   ├── ChartOfAccountsPage.tsx
│   ├── JournalEntriesPage.tsx
│   ├── GeneralLedgerPage.tsx
│   └── TrialBalancePage.tsx
├── components/
│   ├── AccountSelector.tsx                (combobox réutilisable WAVE 2-3)
│   ├── CreateManualJEModal.tsx
│   ├── JournalEntryDetailDrawer.tsx
│   ├── FiscalPeriodModal.tsx              (consommé depuis Settings)
│   └── exportTrialBalanceCsv.ts
├── __tests__/
│   ├── chart-of-accounts.smoke.test.tsx
│   ├── journal-entries.smoke.test.tsx
│   ├── general-ledger.smoke.test.tsx
│   ├── trial-balance.smoke.test.tsx
│   └── fiscal-period-modal.smoke.test.tsx
└── index.ts
```

---

## 5. Risques

| ID | Risque | Mitigation |
|---|---|---|
| R1 | `accounts.is_active` n'est pas writable via RLS direct → besoin RPC | Pre-flight `\d+ accounts` ; si pas de policy, créer `update_account_active_v1` (1 migration + pgTAP). Coût ~1h supplémentaire — acceptable. |
| R2 | `get_general_ledger_v1` cursor schema mal documenté → bug paginate | Lire la migration `20260603000023` au début de Wave 3 pour confirmer le shape `{ next_cursor: { entry_date, je_id } }` exact. |
| R3 | PIN entry component dupliqué entre POS et BO | Réutiliser `PinPad` de `packages/ui` (S19 a normalisé l'usage). |
| R4 | `account_class` enum drift (ADR-003 a reclassé 5910 class 5→6) | Vérifier `types.generated.ts` reflète bien la nouvelle valeur `'expense'` sur 5910 + 3200 `'equity'`. Si non : regen types via MCP. |
| R5 | Pas de route `/settings/accounting` existante → où embedde-t-on FiscalPeriodModal ? | Créer nouvelle sous-tab `/settings/security` style → `/settings/accounting` avec section "Fiscal Periods" + bouton "+ Close period". Aligné sur la convention S19. |
| R6 | RLS sur `journal_entries` + `journal_entry_lines` restreint lecture | Vérifier que les SELECT directs marchent pour MANAGER (perm `accounting.gl.read`). Si la RLS est trop stricte, encapsuler dans RPC dédiée (ou bumper `get_general_ledger_v1` pour retourner aussi le header). |

---

## 6. Deviations attendues

| ID | Description | Statut |
|---|---|---|
| DEV-S26b-1.A-01 | Si RLS UPDATE sur `accounts` indisponible : créer RPC `update_account_active_v1` + 1 migration `20260604000010` (1h+) | Conditionnel pre-flight |
| DEV-S26b-5.A-01 | FiscalPeriodModal hébergé sous `/settings/accounting` plutôt que `/settings/security` (cohérence module) | Acceptable |
| DEV-S26b-6.A-01 | Sidebar reorg : créer une vraie section "Accounting" si pas déjà existante (S27 a créé Categories — précédent existe) | Acceptable |

---

## 7. Quality gates

- pgTAP : aucun nouveau test attendu (S26 Wave 1.J couvre déjà les 4 RPCs) **sauf** si `update_account_active_v1` créée → +1 pgTAP file (3-4 asserts : happy / not_found / perm_denied / audit_logs row)
- BO smoke : **5 fichiers × 1-2 cas chacun ≈ 8-10 PASS** via `pnpm --filter @breakery/backoffice test accounting`
- `pnpm typecheck` : **6/6 PASS** (pré-existant `@breakery/ui` fail à ignorer comme en S26)
- `pnpm build` : PASS
- Visual sanity : 5 pages screenshot via Chrome DevTools MCP (optional, manuel)

---

## 8. Closes (TASK + gaps)

- **TASK-10-011** UI partie (visualisation cockpit) — **DONE** (Chart of Accounts + Journal Entries + General Ledger + Trial Balance livrés)
- **TASK-10-016** month-close foundation — **DONE** (FiscalPeriodModal livré, le batch close global reste hors scope V3 — backlog post-prod)
- INDEX S26 §8 **S26b** — **DONE** (5 pages cockpit core)

---

## 9. Hors scope (déféré S26c)

- PB1ManagementPage (renommée VATManagementPage → PB1ManagementPage)
- ARAgingPage (consomme `view_ar_aging` S24)
- BankReconciliationPage + ReconciliationDetailPage
- CALK SAK EMKM page
- Wave 4 tests BO complets (couverture full des 9 pages) — S26b fait juste les 5 siennes
- Wave 5 docs ref rebase (`docs/reference/04-modules/10-accounting-double-entry.md` Partie II) — S26c

---

## 10. Ordre d'exécution recommandé

1. **Pre-flight DB** : MCP `execute_sql` `\d+ accounts` + `\d+ journal_entries` + `\d+ journal_entry_lines` + `\d+ fiscal_periods` pour confirmer policies RLS et schéma exacts (15 min)
2. **Wave 1** ChartOfAccounts (avec conditional RPC) — sequential
3. **Wave 2-3-4** en parallèle (3 sous-agents possibles, JournalEntries / GeneralLedger / TrialBalance indépendants)
4. **Wave 5** FiscalPeriodModal (dépend uniquement de `useFiscalPeriods` qui est isolé)
5. **Wave 6** wiring routes + sidebar — sequential, en dernier
6. **Tests + typecheck** sweep final
7. **INDEX S26b + CLAUDE.md closeout**
8. **PR S26b** vers master
