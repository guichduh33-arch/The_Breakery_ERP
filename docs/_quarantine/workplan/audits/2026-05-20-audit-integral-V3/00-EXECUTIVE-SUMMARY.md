# Audit intégral V3 — Synthèse exécutive

> **Date** : 2026-05-20
> **Cible** : propriétaire The Breakery (guichduh33) — décision Go/No-Go S26→S30 et cutover prod
> **Lecture** : 15 minutes
> **Méthode** : 6 vagues d'audit indépendantes (DB schema, Supabase best practices, Comptable SAK EMKM, Sécurité OWASP-like, UX BackOffice, Complétude V3 vs vision V2) — 1 orchestrateur consolidant
> **Posture** : V2 (AppGrav monolithe) **jamais déployée en prod** ; V3 (monorepo) **jamais déployé non plus** mais est le seul code vivant. L'audit compare V3 ↔ vision V2 (cahier des charges théorique), pas V3 ↔ V2 prod.

---

## 1. TL;DR (5-10 lignes)

**État du projet V3** : **production-ready en architecture, partiellement-ready en surface**. Le système nerveux (DB, RPCs, RLS, idempotency, comptabilité double-entry SAK EMKM) est mature et solide ; les 6 audits convergent sur un même verdict : pas de défaut bloquant en cœur applicatif. **MAIS** 2 vulnérabilités sécurité Critiques exploitables aujourd'hui (secret cron hardcodé en clair + perms `users.create/users.update` jamais seedées → console RBAC inaccessible à tous rôles), 2 bugs runtime Critiques (colonne fantôme `order_items.name` casse l'app tablette + enum `take_away` mort sur Customer Display), 1 risque latent Critique comptable (PB1 hardcoded `10/110` dans 3 triggers vs `business_config.tax_rate` dynamic — si admin passe à 11% en 2025, JE déséquilibrée silencieuse). **Complétude vs vision V2 ≈ 72%** : 14 modules DONE, 5 PARTIEL, 2 MAJEUR (Accounting Cockpit + Reports), 1 ABSENT (Mobile Shell — NO-GO recommandé). Plan séquencé S26→S30 globalement valide avec **3 ajustements** proposés : avancer S28 (Expense Governance) avant S26, insérer une S29.5 Settings Critical, et trancher S30 Mobile Shell = NO-GO. **Effort consolidé pour cutover prod : ~8-12 jours-homme** sur S26+S28+S29+S29.5 avec 2-3 devs en parallèle, après remediation immédiate des 5 fixes Critiques (≈ 1 journée).

---

## 2. Findings Critiques — top 10 toutes vagues

Triés par urgence (security d'abord, puis runtime, puis comptable, puis UX).

| # | ID | Vague | Catégorie | Finding | Fichier:ligne | Effort | Action |
|---|---|---|---|---|---|---|---|
| 1 | SEC-S30-CRIT-01 | V4 | Hardcoded credential | Secret cron `BIRTHDAY_CRON_SECRET = 'birthday-cron-daily'` en clair dans 2 migrations Git + 1 test → tout lecteur du repo peut déclencher la cron mail clients (DoS marketing + quota Resend) | `supabase/migrations/20260525000011_schedule_birthday_cron_ef.sql:37`, `20260525000012:23`, `customer-birthday-notify/__tests__/birthday.test.ts:22` | **1h** | Rotation immédiate cloud + migration corrective qui lit depuis env var ou `vault.secrets` ; documenter règle "jamais de secret inline" |
| 2 | SEC-S30-CRIT-02 | V4 | RBAC missing seed | Perms `users.create` + `users.update` jamais seedées → `has_permission()` retourne FALSE pour tous rôles (y compris SUPER_ADMIN) → console RBAC BO inaccessible | `supabase/migrations/20260517000200_create_user_rpcs.sql:80,150,250` + `20260517000030:172-180` (seed sans ces 2 perms) | **2h** | Migration corrective `_seed_users_management_perms.sql` + test pgTAP qui itère toutes les `has_permission(_,'X')` du codebase et assert que X existe dans `permissions` |
| 3 | DB-V1-C-01 | V1 | Colonne fantôme | `useMyTabletOrders` sélectionne `order_items(id, name, ...)` — la col est `name_snapshot` → HTTP 400 PostgREST runtime garanti à chaque ouverture des tablet orders | `apps/pos/src/features/tablet/hooks/useMyTabletOrders.ts:7,31,43` | **5min** | Remplacer `name` → `name_snapshot` dans le select + l'interface `TabletOrderItemRow` + le rendu UI |
| 4 | DB-V1-C-02 | V1 | Enum drifté | Customer Display teste `order_type === 'take_away'` 3 fois — enum DB a `take_out` → branche dead code, l'UI affiche `take_out` brut au lieu de "Pickup" | `apps/pos/src/features/display/components/CurrentOrderCard.tsx:55`, `OrderQueueTicker.tsx:33`, `OrderQueueTicker.test.tsx:48` | **5min** | Sed `take_away` → `take_out` × 3 ; le test fixture qui fabrique `take_away` masquait le bug |
| 5 | F-S26-AC-01 | V3 | PB1 divergence latente | Trigger `create_sale_journal_entry` hardcode `round_idr(NEW.total * 10/110)` mais `complete_order_v9` lit `business_config.tax_rate` (`tax_rate/(1+tax_rate)`) → si admin modifie tax_rate (PPN 11% 2025), JE déséquilibrée silencieuse + sous-déclaration fiscale | `supabase/migrations/20260517000010:58,92`, `_140:78` | **3h** | Refactor le trigger pour lire `business_config.tax_rate` via helper `current_tax_rate()` ; migration `bump_create_sale_journal_entry_use_business_config_tax_rate` ; pgTAP qui flip tax_rate à 0.11 et assert JE balanced |
| 6 | V5-C1 | V5 | Sidebar non-responsive | Sidebar BO `w-60` fixe sans breakpoint → BO inutilisable sur tablette gérante (240px sidebar + 240px viewport restant = tableaux denses BalanceSheet/ProfitLoss/Movements écrasés) | `apps/backoffice/src/layouts/Sidebar.tsx:176` | **4h** | Transformer en `Sheet` Radix sur `< lg` (primitive `Sheet.tsx` déjà vendue) + hamburger Topbar ; conserver fixe `≥ lg` |
| 7 | V5-C2 | V5 | UsersTable bypass DS | Mapping rôle→couleur hardcodé `bg-rose-100 / bg-amber-100 / bg-sky-100 ...` + UserDetailPage 7× `text-rose-600 / text-emerald-600` — pendant que POStatusBadge voisin utilise correctement `bg-warning-soft / text-success` → drift design system majeur dans une feature critique RBAC | `apps/backoffice/src/features/users/components/UsersTable.tsx:14-20` + `UserDetailPage.tsx:68,90,102,115,116,180,188,196` | **2h** | Refactor UsersTable + UserDetailPage avec tokens semantic (pattern POStatusBadge) ; ajout `Button variant="destructive"` first-class pour DeleteUserDialog |
| 8 | F-S26-AC-04 | V3 | Double JE void+refund | Full-void génère 2 JEs concurrentes (`sale_void` reversal + `sale_refund` du mirror inséré par `void_order_rpc`) ; `get_profit_loss_v1` / `get_balance_sheet_v1` ne dédupent PAS → double-reversal silencieux de revenue + double-credit de cash | reports RPC `_210`/`_211` + `void_order_rpc` `_009:14` | **2h** | Soit (a) ajouter exclusion `sale_void` quand `sale_refund` existe pour même `reference_id` dans BS/P&L RPCs ; soit (b) `void_order_rpc` ne crée plus de refund mirror pour les full-voids |
| 9 | V6-prod-1 | V6 | Accounting Cockpit absent | 9 pages BO accounting absentes (ChartOfAccounts, JournalEntries, GeneralLedger, TrialBalance, VATManagement, ARAging, BankReconciliation, ReconciliationDetail, CALK) + FiscalPeriodModal → un comptable indonésien ne peut PAS auditer les écritures, fermer un mois, déclarer la PB1 mensuelle (obligation DJP), tracker l'aging B2B ni générer le CALK SAK EMKM | (à créer) | **10-12 j·h** | **S26 Comptable Cockpit** — backend 100% prêt pour 7/10 pages, juste UI + 3 RPCs (`close_fiscal_period_v1`, `get_general_ledger_v1`, `get_trial_balance_v1`) |
| 10 | V6-prod-2 | V6 | ExpenseFormPage manquante | `NewExpensePage` route existe mais le formulaire métier complet (10 champs : date/cat/desc/montant/fournisseur/méthode/date paiement/ref/justificatif/notes + workflow Draft→Approved→Paid) est incomplet → saisie des dépenses quotidiennes impossible sans dev (passe par SQL aujourd'hui) | `apps/backoffice/src/pages/expenses/NewExpensePage.tsx` (à étoffer) + ExpenseCategoriesPage absente | **3-4 j·h** | **S28 Expense Governance** — 5 RPCs livrées S17, manque que UI form + categories admin + workflow gates |

---

## 3. Findings Élevés — top 20

Sélection (le détail exhaustif est dans les 6 rapports par vague).

### Sécurité (V4) — 3 hauts

| # | ID | Finding | Remediation | Effort |
|---|---|---|---|---|
| 11 | SEC-S30-HIGH-01 | **BackOffice utilise `supabase.auth.setSession()` explicitement interdit par CLAUDE.md** (le POS suit le pattern correct `setSupabaseAccessToken`). RLS probablement non-fonctionnel BO sauf SUPER_ADMIN. `apps/backoffice/src/stores/authStore.ts:67,91` | Aligner BO sur POS — remplacer par `setSupabaseAccessToken(res.auth.access_token)` ; test smoke MANAGER côté BO assert RLS marche | 2h |
| 12 | SEC-S30-HIGH-02 | **`_shared/permissions.ts` lit `user_permission_overrides.override_type` (n'existe pas — vrai nom `is_granted`) ET filtre sur `.eq('user_id', userId)` (vrai nom `user_profile_id`)** → overrides utilisateur silencieusement ignorés à l'login (UI diverge de DB) | Réécrire la requête + test Vitest qui crée un override DENY et assert qu'il est appliqué | 1h30 |
| 13 | SEC-S30-HIGH-03 | **`supabase/config.toml` déclare `verify_jwt` que pour 5/11 EFs** ; les 6 autres héritent du default Supabase → drift local↔cloud possible sur `kiosk-issue-jwt` (doit être false) et `customer-birthday-notify` (doit être false sinon cron rompue) | Ajouter 6 stanzas explicites dans config.toml + règle CLAUDE.md "toute nouvelle EF DOIT déclarer verify_jwt" | 30min |

### Best practices Supabase (V2) — 3 hauts

| # | ID | Finding | Remediation | Effort |
|---|---|---|---|---|
| 14 | V2-SBP-H1 | **`void-order` et `cancel-item` reçoivent encore PIN manager en body JSON** (logs PostgREST/pgaudit par défaut) ; `refund-order` seul migré S25 vers header `x-manager-pin` | Cutover header-only en miroir de `refund-order` (5-line diff par EF) ; documenté CLAUDE.md "deferred post-S30" | 2× 30min |
| 15 | V2-SBP-H2 | **`process-payment` EF n'utilise PAS le helper `getIdempotencyKey()` (S25)** — passe via body field → retries réseau côté POS qui timeout (502/504) peuvent doubler une commande | Migrer vers header `x-idempotency-key` + helper `getIdempotencyKey(req)` (header survit aux retries fetch) | 1h |
| 16 | V2-SBP-H3 | **`process-payment` EF la plus mutante du système sans rate-limit Postgres-backed** — vecteur DoS comptable (un cashier authentifié peut générer milliers d'orders/sec et saturer journal_entries + corrompre mv_pl_monthly) | Câbler `checkRateLimitDurable({ functionName: 'process-payment', bucketKey: 'profile:'+id, maxPerWindow: 60, windowSec: 60 })` | 30min |

### DB schema (V1) — 2 hauts

| # | ID | Finding | Remediation | Effort |
|---|---|---|---|---|
| 17 | DB-V1-H-01 | **21 permissions DB absentes du union TS `PermissionCode`** → force `as never` dans tout le module purchasing (12+ occurrences) + reports + accounting → typing perd sa sécurité statique | Ajouter au union TS les 21 perms manquantes (purchasing.po.*, accounting.post/reverse/period.close, cash_register.*, display.*, kds.operate, kiosk.issue, payments.process, sales.*, etc.) + remove `as never` | 1h |
| 18 | DB-V1-H-02 | **4 hooks BO/POS utilisent `.from('TABLE' as any)`** sur tables présentes dans types.generated.ts (`stock_lots`, `view_product_allergens_resolved`, `lan_devices`, `print_queue`) → legacy bypass typing inutile | Supprimer les `as any` ; le typing fonctionne déjà | 30min |

### Comptable (V3) — 3 hauts

| # | ID | Finding | Remediation | Effort |
|---|---|---|---|---|
| 19 | F-S26-AC-02 | **Sale JE poste TOUS les paiements (cash/QRIS/card/EDC) sur compte 1110** au lieu de splitter par `order_payments.method` vers 1115 QRIS / 1116 Card / 1112 Bank → Cash artificiellement gonflé en Balance Sheet, autres comptes clearing vides | Refactor le trigger pour itérer `order_payments` et émettre 1 DR par méthode (le refund trigger fait déjà ce pattern — copier) | 2h |
| 20 | F-S26-AC-03 | **`record_cash_movement_v1` ne génère pas de JE** → un manager qui met 500k IDR dans la caisse n'a aucune contrepartie comptable ; Balance Sheet sous-affiche Cash 1110 vs réalité physique entre 2 shift closes | Étendre la RPC pour émettre JE selon `reason` (apport, transfert bank, replenishment) + 2 nouveaux mapping keys (CASH_MOVEMENT_OWNER_CAPITAL_IN, CASH_MOVEMENT_BANK_TRANSFER) | 3h |

### UX BO (V5) — 3 hauts

| # | ID | Finding | Remediation | Effort |
|---|---|---|---|---|
| 21 | V5-E1 | **142 occurrences de palette Tailwind hardcodée (`bg-red-500`, `text-emerald-600`...) dans 53 fichiers** bypassent les tokens semantic (`text-danger`, `bg-success-soft`) — adoption design system fortement driftée | Sweep "kill the palette" + ESLint rule `breakery-local/no-tailwind-palette` interdisant `(bg|text|border)-(red|green|blue|...)-(50-900)` hors `packages/ui/` | 1-2 jours |
| 22 | V5-E2 | **12 classes Tailwind `dark:` orphelines** (dead code — le BO est cream-only `theme-backoffice`) — contredit la règle SKILL "variables CSS, pas dark: classes" | Sweep retirer les 12 occurrences (3 fichiers : CustomerCategoryChip, RecipeVersionHistory, CustomersListPage) | 1h |
| 23 | V5-E3 | **~28 pages affichent `Loading…` texte** (66 occurrences) au lieu de skeleton — 11 pages bypass la primitive `DataTable` qui a déjà skeleton built-in | Migrer 11 pages tableaux bruts vers `DataTable` (BalanceSheet, ProfitLoss, CashFlow, StockVariance, BasketAnalysis, Audit, RecipeCostOverview, Mappings, Categories, Users, B2BPayments) | 2 jours |

### Complétude (V6) — 2 hauts

| # | ID | Finding | Remediation | Effort |
|---|---|---|---|---|
| 24 | V6-H-Settings | **Settings critiques absents** : Tax/PB1 rate, Payment Methods (mapping cash/qris/edc → comptes), KDS Config (stations DnD), Display Config — admin force édition SQL pour paramètres business courants | **S29.5 Settings Critical** (proposée) — 4 pages P0 + RPCs déjà existantes (ou minimes à créer) | 3-4 j·h |
| 25 | V6-H-Z-Report | **Z-Report PDF inexistant** + bucket Storage retention 7 ans (obligation légale archivage comptable Indonésie) | **S29 Reports Export** — créer Z-Report PDF template + Storage bucket + cron archive nightly | 2-3 j·h |

---

## 4. Plan de remediation immédiat (avant S26)

**Total : ~1 journée de dev pour les 5 fixes Critiques, puis 3-5 jours pour les 10 Élevés prioritaires.**

### Fast-follow (J+0 — avant tout commencement S26)

1. **SEC-S30-CRIT-01** rotation cron secret + migration corrective (1h)
2. **SEC-S30-CRIT-02** seed users.create/users.update perms + pgTAP coverage test (2h)
3. **DB-V1-C-01** fix `useMyTabletOrders.name_snapshot` (5min)
4. **DB-V1-C-02** fix `take_away` → `take_out` × 3 (5min)
5. **F-S26-AC-01** refactor `create_sale_journal_entry` pour lire `business_config.tax_rate` (3h) — **packagé dans la branche S26 Wave 1**

→ **Une PR fast-follow de ~6h de travail** clôt les 4 premiers ; le 5e bascule logiquement en ouverture S26.

### S26 Wave 1 — extensions critiques (avant les 10 pages)

Ajouter les 3 fixes comptable Critiques/Élevés dans la même branche que S26 :
- F-S26-AC-02 sale JE split par `order_payments.method` (2h)
- F-S26-AC-04 dedupe `sale_void` + `sale_refund` dans BS/P&L (2h)
- F-S26-AC-03 + AC-05 JE pour cash_movements + loyalty adjust (4h, prioritaire P1 → optionnel S27)
- Seed account 3200 Retained Earnings explicit (15min)
- Reclasser 5910 Cash Variance Loss class 5 → class 6 (15min)

### S30 pre-cutover security sweep (5-8h)

- SEC-S30-HIGH-01 BO authStore.ts → setSupabaseAccessToken (2h)
- SEC-S30-HIGH-02 `_shared/permissions.ts` schema fix (1h30)
- SEC-S30-HIGH-03 config.toml verify_jwt × 6 (30min)
- V2-SBP-H1 PIN body→header sur void-order + cancel-item (2× 30min = 1h)
- V2-SBP-H2/H3 process-payment idempotency header + rate-limit (1h30)
- SEC-S30-MED-02 FK violation latent `audit_logs.actor_id` patch (3h)

---

## 5. Validation plan S26→S30 — 3 ajustements proposés

Le plan séquencé existant ([`docs/workplan/plans/2026-05-19-S24-to-S30-plan.md`](../../plans/archive/2026-05-19-S24-to-S30-plan.md)) est globalement valide. Les ajustements ci-dessous proviennent de l'analyse V6 + V3.

### Ajustement 1 — Avancer S28 avant ou en parallèle de S26

**Raison** : `ExpenseFormPage` est **prérequis comptable réel**. Un comptable ne peut pas auditer un mois si la moitié des dépenses sont saisies en SQL direct (S26 livre des viewers, pas des saisies — sauf `create_manual_je_v1` qui couvre OD comptable général mais pas les expenses opérationnelles quotidiennes).

**Proposition** :
- **Track parallèle** : 1 dev sur S26 (BO accounting cockpit) + 1 dev sur S28 (Expense Governance) en parallèle ; merge ensemble fin de période S26+28.
- Ou séquentiel S28 → S26 si manque de bande passante.

### Ajustement 2 — Insérer S29.5 Settings Critical

**Raison** : 4 pages settings P0 absentes forcent édition SQL pour paramètres business courants :
- Tax/PB1 rate (CRITIQUE — combine avec F-S26-AC-01 pour locker le 10/110)
- Payment Methods (mapping cash/qris/edc → comptes)
- KDS Config (stations DnD admin)
- Display Config

**Effort** : 3-4 j·h. Backend RPCs minimes (les tables `business_config`, `accounting_mappings`, `display_screens` existent ; manque `kds_stations` + UI).

**Placement** : entre S29 (Reports Export) et S30 (Decision Sprint + Cleanup).

### Ajustement 3 — S30 Mobile Shell = NO-GO recommandé

**Constat audit V6** :
- **0 dépendance Capacitor** dans le repo (vérifié `package.json` + `apps/*/capacitor.config.*` absent)
- **0 page mobile** dans `apps/`
- Doc `docs/reference/04-modules/18-mobile-shell.md` 100% aspirationnelle
- 6 tasks `TASK-18-*` dans le backlog `18-mobile-shell.md` toutes BLOCKED depuis S14
- Pour mono-site Bali (boulangerie unique, persona "gérant" qui passe la majorité du temps au desk), **PWA suffit** — Capacitor ajoute une complexité disproportionnée

**Recommandation** : ADR-002 formel "Mobile Shell — NO-GO V3 phase 1" → backlog post-prod si besoin réel apparaît (typiquement 6-12 mois après cutover).

**Gain** : ~1-2 sessions de bande passante libérée pour polish UX / fixes Élevés.

### Plan révisé proposé

```
S26 Wave 1 (DB hardening + Accounting Cockpit core) — 5-6 j·h
S26 Wave 2 (Accounting UI extended : ChartOfAccounts, TrialBalance, ARAging, CALK) — 5-6 j·h
S28 Expense Governance (parallèle S26 ou séquentiel) — 3-4 j·h
S29 Reports Export + Z-Report PDF + Storage 7 ans — 4-5 j·h
S29.5 Settings Critical (Tax/Payments/KDS/Display) — 3-4 j·h
S30 Cleanup + Polish (UX sweep palette + Sidebar responsive + DataTable migration + Mobile NO-GO ADR) — 3-4 j·h
```

**Wall-time pré-cutover : ~8-12 jours-homme** avec 2-3 devs en parallèle.

---

## 6. Améliorations V3 à conserver (gains nets vs vision V2)

L'audit confirme les 15 améliorations déjà listées dans le [glossaire V2↔V3 §6](../../../V2_V3_GLOSSARY.md), et en ajoute 5 nouvelles découvertes pendant l'audit :

**Originelles (rappel)** :
1. Idempotency cross-EF (S25 — `idempotency_keys` + `_shared/idempotency.ts` + `client_uuid` lifecycle)
2. GRANT hardening defense-in-depth (S20 — REVOKE anon tables/vues/functions + `ALTER DEFAULT PRIVILEGES`)
3. Sub-recipes complet (S15+S17+S19+S21 — anti-cycle 5 niveaux + BOM cascade + batch yield-aware)
4. WAC `update_cost_price_v1` + landed cost pro-rata (S22+S23)
5. RLS helper `has_permission()` v7 (S13+S17 — pure-lookup 4-tier)
6. Rate limiting durable Postgres (S19 — RPC + pg_cron purge + 5 EFs câblées)
7. Playwright E2E nightly cron (S21)
8. Focus-trap Radix ESLint lock-in S22 (`no-raw-modal-overlay`)
9. Recipe versioning + snapshot avec cost (S20+S21)
10. Margin alerts pg_cron recompute (S19)
11. Baker's percentages (S19)
12. Production scheduling suggestions (S19)
13. Customer birthday cron pg_net (S21)
14. Cash Flow 3 sections Operating/Investing/Financing (S21)
15. Recipe cost history v1 (S22)

**Découvertes additionnelles pendant l'audit** :
16. **Idempotency 2-flavors documenté** (S25) — header HTTP retry-safety vs arg RPC sémantique métier
17. **PIN/auth secrets en header HTTP** (S25) — `x-manager-pin` au lieu de body JSON
18. **`packages/domain` IO-pure** validé à 100% (audit V2) — pas un seul `fetch`/`@supabase`/`react` dans le package, condition pour testabilité unit-stricte
19. **Realtime channels 9/9 UUID-suffixed** (audit V2) — StrictMode-safe, 0 leak subscription détecté
20. **Helper `has_permission()` v7 LOCKED** depuis S13 (audit V4) — aucun `CREATE OR REPLACE` ultérieur, CI grep gate documenté

À ne **PAS** régresser pendant S26-S30. Documenter ces 20 améliorations dans la PR description de cutover prod comme "deltas V3 vs spec V2 originale".

---

## 7. Décisions business à prendre

### Décision 1 — Mobile Shell : GO/NO-GO ?

**Recommandation audit** : **NO-GO** pour V3 phase 1 (cutover prod Lombok).
- 0 dépendance Capacitor dans le repo
- PWA suffit pour mono-site
- Effort estimé GO ≈ 8-12 jours-homme + risque iOS/Android divergence + maintenance App Store ongoing
- Backlog post-prod si besoin réel apparaît

**Format proposé** : ADR-002 "Mobile Shell — NO-GO V3 phase 1, re-évaluation post-cutover + 6 mois"

### Décision 2 — Statut PKP The Breakery ?

**Impact** : débloque ou enterre 3 features (I1 e-Faktur generation, I2 e-Bupot, I3 export DJP XML) tracked dans `docs/objectif travail/10-accounting.md`.
- Si PKP confirmé → S26 doit inclure VAT Output (PPN sortie) en plus de PB1 → effort +30%
- Si non-PKP → la simplification PB1 10/110 actuelle reste suffisante → S26 reste léger

**Recommandation audit** : trancher avant Wave 2 S26. Cf F-S26-AC-08.

**Format proposé** : ADR-003 "Statut PKP The Breakery — implications comptables S26+"

### Décision 3 — WONTFIX formels à confirmer

Liste à entériner :

| WONTFIX candidat | Justification | Confirmer ? |
|---|---|---|
| Multi-site loyalty | Mono-site permanent ratifié 2026-05-19 | OUI |
| Consolidation multi-entité | idem | OUI |
| Multi-tenancy | Hors scope V3 | OUI |
| Multi-LAN | Hors scope mono-LAN | OUI |
| Allergens UI module | Décision user 2026-05-17 (memory `project_allergens_wontfix`) | DÉJÀ confirmé |
| Multi-currency | Hors scope V3 (IDR-only) | OUI (mention `docs/V2_V3_GLOSSARY.md`) |
| App mobile dédiée client | Hors scope V3 phase 1 | OUI (post-cutover ré-eval) |
| Programme parrainage automatisé | Out of scope V3 | OUI |
| Voice search POS | Out of scope V3 | OUI |
| Portal client B2B self-service | Out of scope V3 phase 1 | OUI |

**Format proposé** : ADR-004 "WONTFIX V3 phase 1 — formalisation"

---

## 8. Posture globale par pilier (recap)

| Pilier | Statut | Score | Commentaire |
|---|---|---|---|
| **DB schema integrity** | 🟢 STABLE | 92/100 | 312 migrations monotonic, 0 RPC fantôme, 2 bugs Critiques runtime fixables 5 min |
| **Supabase best practices** | 🟢 FORT | 88/100 | RLS 75/75, has_permission LOCKED, S20 GRANT hardening préservé, idempotency 2-flavors |
| **Comptable SAK EMKM** | 🟡 MATURE | 78/100 | JE matrix 17/24 ACTIVE, COA 4-classes, fiscal guards 10/10 émetteurs ; 4 fixes S26 |
| **Sécurité (OWASP-like)** | 🟡 SOLIDE | 75/100 | 2 Critiques + 3 Hauts (auth flow, perms manquantes, schema mismatch overrides) |
| **UX BackOffice** | 🟡 PARTIEL | 63/100 | Fondations excellentes (tokens, primitives, ESLint lock-in) ; adoption driftée (palette Tailwind, sidebar) |
| **Complétude vs vision V2** | 🟡 PARTIEL | 72/100 | 14 DONE + 5 PARTIEL + 2 MAJEUR + 1 ABSENT ; plan S26→S30 valide + 3 ajustements |
| **Améliorations V3 au-delà V2** | 🟢 GAIN NET | — | 20 items documentés (15 originels + 5 audit) — à ne pas régresser |

**Verdict consolidé** : V3 est **structurellement prêt pour la production**, conditionné à ~8-12 jours-homme de finition concentrée sur le module comptable (S26), les dépenses opérationnelles (S28), les exports légaux (S29) et les paramètres business critiques (S29.5). La remediation des 5 fixes Critiques + 10 Élevés prioritaires (~1-2 jours) est un prérequis sans option.

---

## 9. Prochaines étapes recommandées (ordre opérationnel)

1. **Lecture exécutive (15 min)** — propriétaire valide ce document et tranche les 3 décisions business (Mobile Shell, PKP, WONTFIX).
2. **Fast-follow PR (~6h)** — 4 fixes Critiques quick wins (cron secret + perms users + name_snapshot + take_out).
3. **Ouverture S26 Wave 1** — DB hardening accounting + 3 fixes comptable Critiques/Hauts + FiscalPeriodModal + JournalEntriesPage + GeneralLedgerPage + VATManagementPage.
4. **En parallèle (1 dev dédié)** — S28 Expense Governance (ExpenseFormPage + Categories + workflow).
5. **Continuer séquentiel** — S29 Reports Export → S29.5 Settings Critical → S30 Cleanup + Polish + ADRs Mobile/PKP/WONTFIX.
6. **Cutover prod** — après S30, smoke test full E2E + bascule live Lombok.

**ETA cutover prod** : 8-12 jours-homme de travail effectif, soit 2-4 semaines de calendrier selon parallélisation (2-3 devs).

---

## 10. Annexes — liens vers les 6 rapports détaillés

| Vague | Rapport | Date | Effort | Statut |
|---|---|---|---|---|
| 1 | DB Schema Audit | [`01-db-schema-audit.md`](01-db-schema-audit.md) | ~30 min | ✅ |
| 2 | Supabase Best Practices | [`02-supabase-best-practices.md`](02-supabase-best-practices.md) | ~75 min | ✅ |
| 3 | Accounting Audit (JE Matrix + SAK EMKM) | [`03-accounting-audit.md`](03-accounting-audit.md) | ~45 min | ✅ |
| 4 | Security Review (RBAC + RLS + Auth + EFs) | [`04-security-review.md`](04-security-review.md) | ~95 min | ✅ |
| 5 | UX/UI BackOffice Audit | [`05-ux-design-audit.md`](05-ux-design-audit.md) | ~45 min | ✅ |
| 6 | Complétude V3 vs Vision V2 | [`06-completeness-audit.md`](06-completeness-audit.md) | ~75 min | ✅ |

**Plan d'audit source** : [`docs/workplan/plans/archive/2026-05-20-audit-integral-V3-plan.md`](../../plans/archive/2026-05-20-audit-integral-V3-plan.md)
**Glossaire V2↔V3** : [`docs/V2_V3_GLOSSARY.md`](../../../V2_V3_GLOSSARY.md)
**Mémoire projet** : `~\.claude\projects\C--Users-guich-a-trier-The-Breakery-ERP\memory\`

---

**Audit intégral V3 terminé** — 2026-05-20.
**Effort total cumulé** : ~6 heures (Vague 1 30min + Vague 2 75min + Vagues 3-6 parallèles 60-95min chacune + Vague 7 synthèse).
**Verdict orchestrateur** : 🟡 **PARTIEL-READY** → 🟢 **GO cutover prod** après ~8-12 jours-homme de finition concentrée S26+S28+S29+S29.5.
