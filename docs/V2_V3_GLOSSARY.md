# Glossaire V2 ↔ V3

> **Last updated** : 2026-05-20
> **Statut V2** : ⛔ Jamais déployée en production. Conservée comme **cahier des charges métier théorique** dans `docs/reference/` et `docs/_archive/objectif-travail-v2/`.
> **Statut V3** : ✅ Code vivant — monorepo pnpm + turbo (`apps/pos` + `apps/backoffice` + `packages/*`). Sessions S1→S25+ mergées.
> **Mission V3** : reprendre la vision V2 + l'améliorer + diviser en 2 apps spécialisées par persona (POS + BackOffice).

Ce glossaire mappe les noms V2 (qui apparaissent dans la doc business) vers leurs équivalents V3 réels (ce qui existe dans le code). Quand un dev cherche un symbole V2 et ne le trouve pas, c'est ici qu'il regarde.

---

## Conventions

- ✅ **EXISTE EN V3** : nom V2 → nom V3 équivalent (parfois identique, parfois renommé)
- 🔄 **RENOMMÉ EN V3** : changement de nom explicite
- 🆕 **AJOUT V3** : symbole qui n'existait pas en V2 (amélioration au-delà du cahier des charges)
- ❌ **PAS ENCORE EN V3** : à livrer dans une session future
- 📂 **CHEMIN DÉPLACÉ** : path V2 → path V3 (le path translation Session 13 fait référence détaillée)

---

## 1. RPCs critiques

| V2 (fiches `docs/_archive/objectif-travail-v2/`) | V3 réel | Statut | Notes |
|---|---|---|---|
| `complete_order_with_payments` | `complete_order` (v9) | 🔄 | Versionné, atomique, multi-method, idempotent S25 |
| `pay_existing_order_with_payments` | `pay_existing_order` (v6) | 🔄 | Versionné |
| `create_tablet_order` | `create_tablet_order_v2` | 🔄 | + idempotency_keys (S25), client_uuid lifecycle |
| `add_loyalty_points` | `adjust_loyalty_points_v1` | 🔄 | + S15 hardening (column grants) |
| `get_customer_product_price` | `get_customer_product_price` | ✅ | Identique |
| `evaluate_promotions` | `evaluate_promotions_v1` | 🔄 | + auto-eval realtime hook côté POS |
| `calculate_vat_payable` | `calculate_vat_payable_rpc` | ✅ | PB1 10/110 |
| `approve_expense_with_journal` | (présent via `expense_rpcs` S17) | ✅ | 5 RPCs au total |
| `create_sale_journal_entry` (trigger) | `refactor_create_sale_journal_entry` | 🔄 | S17 refactor |
| `create_purchase_journal_entry` (trigger) | `create_purchase_journal_entry_trigger` | ✅ | S17 |
| — | `update_cost_price_v1` | 🆕 | WAC manual override + replay envelope (S26) |
| — | `record_rate_limit_v1` | 🆕 | Rate limiting durable Postgres (S19) |
| — | `validate_recipe_no_cycle` | 🆕 | Anti-cycle sub-recipes 5-niveaux (S19) |
| — | `recipe_bom_full_v1` | 🆕 | Cascade cost calc complète (S21) |
| — | `record_batch_production_v1` | 🆕 | Yield-aware production (S19) |
| — | `validate_b2b_credit_limit_v1` | 🆕 | B2B Foundation (S24) |
| — | `record_b2b_payment_v1` | 🆕 | B2B Foundation (S24) |

## 2. Hooks POS

| V2 (fiches métier) | V3 réel | Statut |
|---|---|---|
| `useCartPromotions` | `useEvaluatePromotions` + `usePromotionsAutoEval` + `usePromotionsRealtime` | 🔄 (3 hooks séparés) |
| `useKdsStatusListener` | (équivalent dans `apps/pos/src/features/kds/hooks/`) | 🔄 |
| `useDisplayBroadcast` | (présent dans `apps/pos/src/features/display/`) | 🔄 |
| `useTabletOrderReceiver` | `useTabletOrderStatusListener` + side du hub via `lanHubMessageHandler` | 🔄 |
| `useKdsUrgentAlertLoop` | (présent dans `apps/pos/src/features/kds/hooks/`) | 🔄 |
| `useOrderAutoRemove` | (présent dans `apps/pos/src/features/kds/hooks/`) | 🔄 |
| `useRestoreHeldOrders` | (présent dans `apps/pos/src/features/heldOrders/hooks/`) | 🔄 |
| `useLockedItemCancellation` | (présent dans `apps/pos/src/features/cart/hooks/`) | 🔄 |
| `useCreateTabletOrder` | `useCreateTabletOrder` (v2) | ✅ |
| `useTabletOffline` | `useTabletOffline` | 🆕 (S25) |

## 3. Pages BackOffice

### 3.1 Accounting (gros gap — couvert par S26)
| V2 | V3 | Statut |
|---|---|---|
| `ChartOfAccountsPage` | — | ❌ S26 |
| `JournalEntriesPage` | — | ❌ S26 |
| `GeneralLedgerPage` | — | ❌ S26 |
| `TrialBalancePage` | — | ❌ S26 |
| `BalanceSheetPage` | `apps/backoffice/src/pages/reports/BalanceSheetPage.tsx` | ✅ (sous /reports) |
| `IncomeStatementPage` | `apps/backoffice/src/pages/reports/ProfitLossPage.tsx` | ✅ (renommé, sous /reports) |
| `VATManagementPage` | — | ❌ S26 |
| `ARAgingPage` | — | ❌ S26 (view_ar_aging existe en DB) |
| `BankReconciliationPage` | — | ❌ S26 |
| `ReconciliationDetailPage` | — | ❌ S26 |
| `CALKPage` | — | ❌ S26 |
| `FiscalPeriodModal` | — | ❌ S26 (RPC + table existent S17) |
| — | `apps/backoffice/src/pages/accounting/MappingsPage.tsx` | 🆕 (S17 — Accounting Mappings) |
| — | `apps/backoffice/src/pages/reports/CashFlowPage.tsx` | 🆕 (S21 — 3 sections) |

### 3.2 Expenses (gap modéré — couvert par S28)
| V2 | V3 | Statut |
|---|---|---|
| `ExpensesListPage` | `apps/backoffice/src/pages/expenses/ExpensesListPage.tsx` | ✅ |
| `ExpenseDetailPage` | `apps/backoffice/src/pages/expenses/ExpenseDetailPage.tsx` | ✅ |
| `ExpenseFormPage` | — | ❌ S28 |
| `ExpenseCategoriesPage` | — | ❌ S28 |

### 3.3 Reports (gros gap — couvert par S29)
13 reports livrés sur ~61 demandés. Voir détail dans `docs/workplan/backlog-by-module/14-reports-analytics.md`.

### 3.4 Settings (gap modéré)
6 pages livrées sur ~23. Settings actuelles : `SettingsGeneralPage`, `SettingsHubPage`, `SettingsHolidaysPage`, `SettingsEmailTemplatesPage`, `SettingsReceiptTemplatesPage`, `SettingsPermissionsPage` + dossier `security/`.

## 4. Tables DB

| V2 | V3 | Statut |
|---|---|---|
| `audit_log` (singulier) | `audit_logs` (pluriel) | 🔄 (renommé S13 pour cohérence avec `journal_entries`, `stock_movements`, `user_sessions`) |
| `customer_invoices` | n/a (jamais créée) | ❌ phantom V2 — invoice_number sur `orders` + `view_b2b_invoices` est le chemin canonique V3 |
| `system_alerts` | n/a | ❌ phantom V2 |
| `stock_reservations` | `init_stock_reservations` S17 | ✅ |
| `display_promotions` | (à vérifier — feature display POS existe) | ❓ |
| `b2b_price_lists` | (à vérifier) | ❓ |
| — | `idempotency_keys` | 🆕 (S25) |
| — | `recipe_versions` | 🆕 (S19) |
| — | `production_schedules` | 🆕 (S19) |
| — | `margin_alerts` | 🆕 (S19) |
| — | `internal_transfers` | 🆕 (S17) |
| — | `inventory_counts` (opname) | 🆕 (S17) |
| — | `lan_devices` | 🆕 (S17) |
| — | `print_queue` | 🆕 (S17) |
| — | `notification_templates` | 🆕 (S17) |

## 5. Chemins V2 → V3 (mapping condensé)

Le mapping complet figé à S13 est dans [`docs/workplan/refs/2026-05-13-v2-v3-path-translation.md`](workplan/refs/2026-05-13-v2-v3-path-translation.md) — 164 paths V2 cartographiés. Règles principales :

| V2 monolithe | V3 monorepo |
|---|---|
| `src/services/<X>.ts` (pure) | `packages/domain/src/<X>/` |
| `src/services/<X>.ts` (IO) | `packages/supabase/src/<X>.ts` ou `apps/<app>/src/features/<X>/api.ts` |
| `src/components/<X>.tsx` (POS) | `apps/pos/src/features/<feature>/components/<X>.tsx` |
| `src/components/<X>.tsx` (BO) | `apps/backoffice/src/features/<feature>/components/<X>.tsx` |
| `src/components/ui/<X>.tsx` | `packages/ui/src/{primitives,components}/<X>.tsx` |
| `src/pages/<X>.tsx` | `apps/<app>/src/pages/<X>.tsx` (thin) + `apps/<app>/src/features/<feature>/` (fat) |
| `src/hooks/<X>.ts` | `apps/<app>/src/features/<feature>/hooks/<X>.ts` |
| `src/stores/<X>.ts` (Zustand) | `apps/<app>/src/features/<feature>/store/<X>.ts` (1 store/feature, jamais global) |
| `src/routes/<X>.tsx` | `apps/<app>/src/routes/index.tsx` (unique) |
| `supabase/migrations/*.sql` | unchanged (append-only monotonic) |
| `supabase/functions/*/index.ts` | unchanged |

## 6. Améliorations V3 sans équivalent V2

Liste des **gains nets V3** au-delà du cahier des charges V2 :

1. **Idempotency cross-EF** (S25) — `idempotency_keys` + client_uuid + replay envelope
2. **GRANT hardening defense-in-depth** (S20) — REVOKE anon sur tables, vues ET fonctions
3. **Sub-recipes complet** (S15+S17+S19+S21) — anti-cycle 5-niveaux, BOM cascade, batch production yield-aware
4. **WAC `update_cost_price_v1` + landed cost pro-rata** (S23+S26)
5. **RLS helpers `has_permission()` v7** (S13+S17 refactor)
6. **Rate limiting durable Postgres** (S19) — `record_rate_limit_v1` + pg_cron purge + 5 EFs câblés
7. **Playwright E2E nightly cron** (S21)
8. **Focus-trap Radix ESLint lock-in** (S22 — `no-raw-modal-overlay`)
9. **Recipe versioning + snapshot avec cost** (S20+S21)
10. **Margin alerts pg_cron recompute** (S19)
11. **Baker's percentages** (S19)
12. **Production scheduling suggestions** (S19)
13. **Customer birthday cron pg_net** (S21)
14. **Cash Flow 3 sections (Operating/Investing/Financing)** (S21)
15. **Recipe cost history v1** (S22)

## 7. Comment maintenir ce glossaire

Quand une session V3 ajoute, renomme ou supprime un symbole V2 :
1. Mettre à jour la ligne correspondante ci-dessus
2. Mettre à jour la fiche `docs/_archive/objectif-travail-v2/<MODULE>.md` correspondante
3. Mettre à jour `docs/reference/04-modules/<NN-module>.md` correspondante
4. Mentionner le glossaire dans la PR description
