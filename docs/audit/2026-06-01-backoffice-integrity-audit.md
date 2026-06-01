# Back-Office — Audit d'intégrité métier

**Date :** 2026-06-01
**Périmètre :** intégrité métier (business-logic) du back-office (`apps/backoffice/`) + RPC/EF de support.
**Méthode :** 7 agents parallèles, un par domaine, chargeant les skills `.claude/skills/` (accounting, b2b-credit, expense-governance, stock-management, orders, products-catalog, reports-exports). Findings vérifiés contre le schéma réel (`supabase/migrations/` + `packages/supabase/src/types.generated.ts`), pas seulement la doc.
**Nature :** rapport **read-only** — aucun fichier de code modifié pendant l'audit.

> **Verdict global.** Les *moteurs* métier sont sains (JE balancés, dedup void/refund, append-only ledgers, WAC, production cascade, SOD, credit-gate, snapshot-at-submit, Z-report sign-flow, helpers domain). Les défauts graves sont quasi tous des **désynchronisations de contrat front↔backend** introduites par des bumps récents (S32→S34) que les smoke-tests mockés n'ont pas attrapées.

## Résolution (2026-06-01)

**Corrigés + vérifiés** (Critical + High + 7/9 Medium) :

| Finding | Sévérité | Fix | Vérif |
|---|---|---|---|
| C1 void header | Critical | `useVoidOrder` → header `x-manager-pin` | typecheck |
| C2–C5 report hooks | Critical | args/shape alignés au contrat RPC réel | 4 smoke réalignés ✓ |
| H1 approve PIN | High | `approve_expense_v3(p_expense_id, p_manager_pin)` + `verify_user_pin` (drop v2) — migration `20260601181353` | pgTAP 20/20 |
| H2 tax inclusif | High | `_recalc_order_totals` PB1-inclusif — migration `20260601181324` | pgTAP 3/3 |
| H3 filtres enum | High | `OrdersListPage` vraies valeurs `order_status`/`order_type` | typecheck |
| H4 reorder variants | High | `VariantsPanel` n'envoie que les `is_active` | typecheck |
| M1 garde 1151 | Medium | `update_account_active_v1` bloque réactivation 1151 — migration `20260601183044` | pgTAP ✓ |
| M2 prédicat PB1 | Medium | `calculate_pb1_payable_v1` `status IN (posted,locked)` — migration `20260601183100` | pgTAP ✓ |
| M3 « Rp NaN » | Medium | payload aligné (`available`, total panier client-side) | typecheck |
| M4 idempotency transfers | Medium | clé en `useRef`, rotée on-success (create/receive) | typecheck |
| M5 idempotency opname/edit | Medium | `useRef`/Map de clés stables, rotées on-success | typecheck |
| M6 void button | Medium | gate `status==='paid'` (matche `void_order_rpc_v2`) | typecheck |
| M8 SKU pre-check | Medium | `create_variant_v1` raise `sku_taken` — migration `20260601183121` | pgTAP ✓ |

**Restants — décisions de design/contrat (non corrigés, à arbitrer)** :

- **M7** (`is_display_item` sans `display_stock`) : le vrai correctif est un **avertissement BO** (« initialiser le compteur vitrine ») et/ou un seed de ligne zéro-qty — un seed seul ne rend pas le produit vendable (stock 0). Choix produit requis.
- **M9** (curseur `get_stock_movements_v1` + pivot `by_day`) : le tiebreaker propre `(created_at, id)` change le **contrat** (signature RPC + hook + page + regen types) ; le pivot hardcodé (6 méthodes) demande un choix (`other` bucket vs dynamique). Impact faible (<500 mvts/jour). À planifier en bump dédié.
- **Low/Info** (~20) : non traités (cf. tableaux ci-dessous).

Migrations appliquées sur cloud V3 `ikcyvlovptebroadgtvd`. Aucun commit (closeout laissé à l'utilisateur).

## Récap chiffré

| Sévérité | Count | Domaines |
|---|---|---|
| 🔴 Critical | 5 défauts (6 lignes) | Orders ×1, Reports ×4 |
| 🟠 High | 4 | Expenses, Orders ×2, Products |
| 🟡 Medium | 9 | Accounting, B2B, Stock, Orders, Products, Reports |
| ⚪ Low / Info | ~20 | transverse |

---

## 🔴 CRITICAL — surfaces cassées en runtime

| # | Domaine | Localisation | Défaut | Impact |
|---|---|---|---|---|
| C1 | Orders | `apps/backoffice/src/features/orders/hooks/useVoidOrder.ts:45` + `supabase/functions/void-order/index.ts:47-50` | L'EF `void-order` durcie en S34 lit le PIN **uniquement** dans le header `x-manager-pin` (rejette `missing_manager_pin` 400 sinon). Le hook BO envoie encore `manager_pin` dans le **body** et ne pose jamais le header. Le commentaire « accepts manager_pin in body per DEV-S33-PRE-02 » est périmé (S34 l'a remplacé). | **Tout void depuis `/backoffice/orders` renvoie 400** avant la RPC. Flow d'annulation BO totalement inopérant. |
| C2 | Reports | `apps/backoffice/src/features/reports/hooks/usePaymentsByMethod.ts:31-32, 7-18, 36` | Args `p_start`/`p_end` au lieu de `p_date_start`/`p_date_end` (`types.generated.ts:6051`) **+** lit `data.lines`/`data.total` au lieu de `by_method[]`/`summary.total_amount` (`20260524231049:85-94`). | **Report Payment-by-Method KO** (PGRST202 + shape). Aucune figure ne s'affiche. |
| C3 | Reports | `apps/backoffice/src/features/reports/hooks/usePb1Report.ts:39-42` | Args `p_month`/`p_year` au lieu de `p_period_month`/`p_period_year` (`types.generated.ts:6055`). | **Report PB1 (taxe resto) KO** — surface fiscale non fonctionnelle. |
| C4 | Reports | `apps/backoffice/src/features/reports/hooks/useWastageReport.ts:34-35` | Args `p_start`/`p_end` au lieu de `p_date_start`/`p_date_end` (`types.generated.ts:6253`) + shape `total_value` (vs `summary.total_value`) et `recorded_by` (vs `created_by_name`) désalignés. | **Report Wastage KO.** |
| C5 | Reports | `apps/backoffice/src/features/reports/hooks/usePerishableTurnover.ts:35-36` | Args `p_start`/`p_end` au lieu de `p_date_start`/`p_date_end` (`types.generated.ts:6059`). | **Report Perishable Turnover KO.** |

**Cause racine commune C2–C5 :** les smoke-tests mockent `supabase.rpc` et assertent contre la *mauvaise* signature/shape → ils restent verts en masquant la dérive. 4 reports bakery/finance sur 5 sont morts en prod ; le seul correctement câblé est Stock-Movements (`useStockMovementsReport`).

---

## 🟠 HIGH — intégrité métier compromise

| # | Domaine | Localisation | Défaut | Impact |
|---|---|---|---|---|
| H1 | Expenses | `apps/backoffice/.../hooks/useExpenseActions.ts:60-65` + `supabase/migrations/20260524120104_bump_approve_expense_v2_rpc.sql:7-9` | Le flow collecte un PIN manager et l'envoie en header `x-manager-pin`, mais **aucun backend ne le lit/valide** : `approve_expense_v2(p_expense_id UUID)` ne prend pas de PIN, ne lit aucun header/`current_setting`, et il n'existe pas d'EF `approve-expense`. (Contraste : `close_fiscal_period_v1` prend `p_manager_pin` + `verify_user_pin`.) | **Sécurité théâtrale** : l'approbation n'est gardée que par le JWT GoTrue + SOD. Une session BO oubliée ouverte approuve des dépenses sans re-auth PIN. Le dialog « Enter your manager PIN to confirm » ment sur le contrôle réel. |
| H2 | Orders | `_recalc_order_totals` — `supabase/migrations/20260618000013_*.sql:17-23` | **Tax model mismatch.** Le pricing canonique est **PB1-inclusif** (`tax = total*rate/(1+rate)`, `total = subtotal` — cf. `complete_order_with_payment_v10:280`, `cancel_order_item_rpc_v2:293`, `refund_order_rpc_v3:514`). Le helper calcule en **exclusif** : `tax = subtotal*rate`, `total = subtotal + tax`. | Après toute édition d'items (add/update/remove), `total` gonflé de ~PB1% et `tax_amount` ne matche plus le pricing d'origine ni la JE/le ticket. **Corruption de données persistées** sur les commandes éditables (draft/pending_payment). |
| H3 | Orders | `apps/backoffice/src/pages/orders/OrdersListPage.tsx:44-45` | Valeurs de filtres absentes des enums : `STATUSES=['','open','completed','voided','refunded']` (`'open'`/`'refunded'` n'existent pas dans `order_status`) ; `ORDER_TYPES` utilise `'takeaway'` (enum = `'take_out'`, et omet `'delivery'`). La RPC filtre par `o.status::text = ...`. | Sélectionner Status=open / refunded / Type=takeaway → **zéro ligne silencieusement** (liste vide trompeuse pour un manager auditant les voids/refunds). Les vrais statuts `draft`/`paid`/`pending_payment`/`b2b_pending` ne sont pas sélectionnables. |
| H4 | Products | `apps/backoffice/.../hooks/useProductVariants.ts:47-54` + `VariantsPanel.tsx:208-218` vs `supabase/migrations/20260524003729_create_reorder_variants_v1_rpc.sql:26-35` | `useProductVariants` renvoie variants actifs **+ inactifs** (filtre `deleted_at IS NULL` seul). Le panel DnD envoie tout le set. Mais `reorder_variants_v1` ne compte que `is_active=true` → `incomplete_coverage: expected X, got Y`. (`delete_variant_v1` flippe `is_active=false` en laissant `deleted_at` NULL.) | **Tout reorder DnD échoue en permanence** dès qu'un variant a été soft-deleted une fois. Casse silencieuse proportionnelle à l'usage du cycle de vie. |

---

## 🟡 MEDIUM — robustesse / pièges

| # | Domaine | Localisation | Défaut | Impact |
|---|---|---|---|---|
| M1 | Accounting | `update_account_active_v1` (`20260523135820_*.sql:42-64`) + `ChartOfAccountsPage.tsx:144-153` | Aucun garde-fou contre la réactivation du compte **1151** (VAT Input désactivé ADR-003 NON-PKP). Bouton « Activate » exposé pour tout compte. | Un SUPER_ADMIN peut rallumer 1151 → ré-active silencieusement le chemin VAT-input (`_emit_expense_je`), viole ADR-003. |
| M2 | Accounting | `calculate_pb1_payable_v1` (`20260603000013_*.sql:54`) | PB1 somme `je.status = 'posted'` seul ; GL/TB/P&L/BS utilisent `IN ('posted','locked')`. | Prédicat incohérent ; risque de sous-déclaration PB1 (PEMDA Bali) sur des mois verrouillés si une migration future flippe les JE de période lockée en `locked`. |
| M3 | B2B | `useCreateB2bOrder.ts:31-38` + `CreateB2bOrderModal.tsx:213` | Le type UI déclare `proposed_amount`/`available_credit`, absents du payload RPC réel (`validate_b2b_credit_limit_v1` renvoie `available`, pas `proposed_amount`). `formatIdr(undefined)` → **« Rp NaN »**. | L'opérateur voit « Rp NaN » sur chaque rejet credit-limit — sur l'alerte censée l'aider à décider. |
| M4 | Stock | `useCreateTransfer.ts:69`, `useReceiveTransfer.ts:62`, `useOpnameMutations.ts:41,154` | Clé d'idempotency générée **dans `mutationFn`** via `crypto.randomUUID()` à chaque invocation (vs `useState` ailleurs). | Défait la replay-protection sur le double-commit classique (timeout réseau RPC committée → re-clic → nouvelle clé → transfer/opname/finalize dupliqué). |
| M5 | Orders | `useEditOrderItems.ts:37,42,51` | Idem M4 — clés idempotency régénérées dans `mutationFn` malgré la table dédiée `order_edit_idempotency_keys`. | Un retry React-Query / double « Apply » ré-applique au lieu de replay (item ajouté ×2). |
| M6 | Orders | `OrdersListPage.tsx:298` vs `void_order_rpc_v2` (`20260619000030_*.sql:77-80`) | Bouton Void affiché pour `status IN ('pending_payment','completed','paid')` ; la RPC `check_violation` sauf `'paid'`. | Void d'un `completed`/`pending_payment` échoue après saisie PIN+raison → effort manager gaspillé. |
| M7 | Products | `GeneralPanel.tsx:216-222` + `NewProductDialog.tsx:182-193` | `is_display_item=true` settable sans seeder de ligne `display_stock` (pas de trigger/RPC). | `complete_order_with_payment_v10` lit qty `COALESCE(...,0)` → « Insufficient display stock » pour toute vente → **produit invendable POS** jusqu'à `add_display_stock_v1`. |
| M8 | Products | `create_variant_v1` (`20260524003433_*.sql`) + `AddVariantDialog.tsx:72-76` | Pas de pre-check SKU (contrairement à `convert_product_to_parent_v1`/`create_product_v1`) → repose sur la contrainte 23505 brute. Le mapping `sku_taken` du dialog ne se déclenche jamais. | Doublon SKU sur variant → texte Postgres brut affiché au lieu de « SKU … is already taken ». |
| M9 | Reports | `get_stock_movements_v1` (`20260615000016_*.sql:47,53,92`) **et** `get_payments_by_method_v1` (`20260524231049_*.sql:74-80`) | (a) Curseur keyé sur `created_at` seul, sans tiebreaker `(created_at,id)` → sur un cluster d'égalité (inserts bulk), lignes droppées/dupliquées entre pages. (b) Pivot `by_day` hardcode 6 méthodes + `total = SUM(all)` → un 7e tender (gopay) tombe dans `total` mais aucune colonne → non-réconciliation. | Sous-report de l'historique mouvements ; colonnes/jour ne réconcilient pas au total. |

---

## ⚪ LOW / INFO (sélection)

**Products**
- `update_product_v1` (`20260530192331:106-125`) : `COALESCE` sur champs nullable → `description`/`image_url`/etc. **ne peuvent jamais être remis à NULL** via le BO (save = no-op pour le clear).
- `useDeleteVariant.ts:3` : commentaire « soft delete via `deleted_at` » faux (en réalité `is_active=false`) — alimente directement H4.
- `GeneralPanel.tsx:181-222` : toggles `visible_on_pos`/`deduct_stock`/`track_inventory`/`is_display_item` éditables sur un **parent** (« ne se vend pas directement ») → érosion d'invariant.
- `convert_parent_to_standalone_v1` (dissolve 0-variant) renvoie l'id du parent **qui vient d'être hard-delete** → navigation vers une row inexistante ; `axis = variants[0]` peut lire un variant inactif.

**Reports**
- `get_profit_loss_v1` (`20260603000017_*.sql`) accepte `p_section_id` mais ne l'applique jamais → P&L « section-scoped » renvoie company-wide.
- `void_zreport_v1` (`20260606000019_*.sql:30-37`) ne bloque pas le void d'un Z-report **signé** (artefact légal 7 ans Indonésie) — confirmer l'intention.
- `DeltaPct.tsx:19` : vert=hausse / rouge=baisse universel → trompeur sur COGS/OpEx/Wastage (hausse = mauvais).

**B2B**
- `B2BPaymentsPage.tsx:86-89,215-224` : onglet « Outstanding » piloté par `topClients` (top-50 by `total_spent`, slice 5) → **créances de petits/nouveaux comptes B2B invisibles**. L'onglet aging (`view_ar_aging`) est correct ; l'onglet Outstanding non.
- `useB2bDashboard.ts:120` : count pending utilise statuts morts `'pending'`/`'open'` (réel = `'b2b_pending'`) ; logique portée seulement par `paid_at === null`.
- `record_b2b_payment_v1:135-151` (INFO, by-design) : allocation FIFO = snapshot métadonnée, ne flippe pas `paid_at`/`status` des invoices (per-invoice allocation déféré S26+). Aging et balance peuvent diverger pour comptes partiellement payés.

**Expenses**
- `ThresholdFormDialog.tsx:22` + `set_expense_threshold_v1` : step builder offre **CASHIER** comme approbateur, mais CASHIER n'a pas `expenses.approve` → step `role_codes:["CASHIER"]` = **deadlock workflow** (expense bloquée en `submitted`).
- `set_expense_threshold_v1` (`20260524121337_*.sql:37-46`) : valide la *shape* du step mais pas que les `role_codes` existent dans `roles` → typo (`"MANGER"`) = step silencieusement non-approuvable.
- UI surface les erreurs backend en `error.message` brut (trap VAT NON-PKP P0002 → string cryptique).
- `ExpenseDetailPage.tsx:5-9` : commentaire d'en-tête périmé (référence v1 alors que le code câble v2).

**Accounting**
- `useJournalEntries.ts:33-44` : liste JE sans filtre de statut (afficherait des `draft`/reversed sans badge en vue liste).
- `CreateManualJEModal.tsx` : PIN en body RPC — **légitime** (règle PIN-en-header = EF only ; les args RPC ne sont pas loggés comme les bodies EF). Non-défaut.

**Stock**
- `get_perishable_turnover_v1` (`20260615000018_*.sql:78-94`) : `velocity_score` bucketé sur `avg_days_in_stock` **absolu**, ignore `shelf_life_days_p50` (calculé mais juste affiché) → un produit 2j-de-shelf consommé en 3j (lent) score comme un 30j consommé en 3j (rapide). Le score mésclasse les périssables.
- `avg_days_in_stock` utilise `stock_lots.updated_at` comme proxy `consumed_at` (DEV-S30-1.A-02) → tout touch ultérieur d'une row consommée gonfle `avg_days`.
- `ReceiveModal` (→ `receive_stock_v1`, WAC + lot) vs `IncomingStockForm` (→ `record_incoming_stock_v1`, **pas** de WAC, **pas** de lot) : deux entrées « receive » visuellement proches ; un produit reçu seulement via « incoming » garde un `cost_price` stale/zéro (empoisonne le cost cascade) et n'expire jamais. UX/traçabilité, pas un bug code.

---

## 🧩 Thèmes transverses (priorité, faible coût)

1. **Idempotency-key-in-`mutationFn`** (M4 + M5) — même anti-pattern dans **stock (transfers/opname)** ET **orders (edit-items)**. La clé doit vivre en `useState`/`useRef` au niveau composant, tournée à l'ouverture/succès (le bon pattern existe déjà dans Adjust/Receive/Waste/Production). Casse silencieusement la protection retry partout où il apparaît.

2. **Smoke-tests mockant `supabase.rpc`** — masquent les 4 reports cassés (C2–C5) et le void cassé (C1) en restant verts. Le smoke `PaymentByMethodPage.smoke.test.tsx:52-61` assert même *explicitement* les mauvais noms d'args. **Recommandation :** assertion type-level `hookArgs extends Database['public']['Functions'][fn]['Args']` pour que la dérive de signature casse `pnpm typecheck` au lieu de partir en prod.

---

## ✅ Sain & vérifié (par domaine)

- **Accounting** — JE balance enforcement (lines ≥ 2, debit XOR credit, Σ=Σ, accounts actifs/postable, fiscal-period guard) ; PB1 dynamique (`current_pb1_rate()`, pas de littéral) ; dedup sale_void/refund cohérent sur P&L/BS/GL/TB ; GL running-balance sign correct ; hooks sur les bonnes versions RPC.
- **B2B** — credit-gate câblé dans `create_b2b_order_v1` (ferme le gap S14) ; aging buckets corrects ; `b2b_payments` append-only (RLS + REVOKE) ; idempotency ×3 RPC ; `b2b_current_balance` UPDATE revoked ; garde overpayment ; JE balancés.
- **Expenses** — SOD block 1 (créateur ≠ approbateur) + block 2 (`UNIQUE(expense_id, approver)`) ; snapshot-at-submit freeze ; auto-approve ; fallback legacy NULL 1-step ; multi-step + JE-on-final-only ; validation range/overlap thresholds ; cash-sync trigger.
- **Stock** — append-only ledger (aucun INSERT direct, `unit` toujours peuplé) ; opname finalize math sign/section-correct ; production cascade WITH RECURSIVE anti-cycle depth-5 ; wastage report ; `waste_pct` ; REVOKE pairs + gates + audit_log ; curseur feed `(created_at,id)`.
- **Orders** — edit-items status guard `('draft','pending_payment')` ; list-v2 server filters (refund_status/hour/terminal_id) ; cursor keyset ; idempotency action isolation `(key,action)` ; realtime `useId()` StrictMode-safe ; void/refund reversal RPCs (sale_void stock, loyalty reverse, refund caps, non-repudiation).
- **Products** — variant XOR + anti-nesting trigger + corrective `_012658` ; SKU orphan handling on dissolve ; soft-delete never hard ; category reorder complete-coverage + slugify ; allowlist `update_product_v1` (omet cost_price/unit) ; gates `products.variants.write`.
- **Reports** — `previousPeriod` calendar-aware ; `formatDelta` ; `buildCsv` RFC 4180 + BOM + id-ID IDR ; `buildDrilldownUrl` ; P&L/BS dedup void↔refund ; Z-report snapshot frozen at close ; `sign_zreport_v1` idempotent ; `void_zreport_v1` reason ≥ 10 ; PB1 NON-PKP backing logic (seul le hook casse le consumer).

---

## Annexe — provenance

Audit produit par 7 agents read-only (un par skill), 2026-06-01. Findings ancrés sur `file:line` vérifiables. Aucune RPC exécutée (lecture migrations + `types.generated.ts`). Note : les noms `void_order_rpc`/`refund_order_rpc_v2` cités par le skill `orders` sont périmés d'une génération (droppés `20260619000031`, remplacés par `void_order_rpc_v2`/`refund_order_rpc_v3` en S34) — la seule régression laissée par ce bump est C1.
