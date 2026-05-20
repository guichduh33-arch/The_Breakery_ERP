# Vague 6 — Complétude Fonctionnelle V3 vs Vision V2

> **Date** : 2026-05-20
> **Skill** : (manual analysis — pas de skill dédiée)
> **Scope** : 16 fiches V2 (`docs/objectif travail/*.md`), 21 modules référence (`docs/reference/04-modules/*.md`), 26 features BO, 24 features POS, 13 reports livrés, 78 pages BO routées, ~280 tâches dans 25 backlogs modules
> **Effort réel** : ~75 minutes (lecture exhaustive + croisement code + rédaction)
> **Sources croisées** : `docs/V2_V3_GLOSSARY.md` (158 lignes), `docs/workplan/plans/2026-05-19-S24-to-S30-plan.md` (plan séquencé S24→S30), `docs/workplan/backlog-by-module/00-roadmap-globale.md`, audits Vague 1 (DB schema) + Vague 2 (Supabase best practices)

---

## TL;DR

**Complétude V3 ≈ 72%** de la vision V2 (14 modules DONE, 5 PARTIEL, 2 MAJEUR, 1 ABSENT/WONTFIX-confirmable). **Le plan S26→S30 est globalement valide et chiffré correctement**, mais 3 ajustements s'imposent : (1) **avancer S28 Expense Governance avant S26** (`ExpenseFormPage` est prérequis comptable réel — un comptable ne peut pas auditer un mois si la moitié des dépenses sont saisies en SQL) ; (2) **S30 Mobile Shell = NO-GO recommandé** (0 dépendance Capacitor dans le repo, 0 app mobile, web/PWA suffit pour le mono-site Bali, et toute la doc `18-mobile-shell.md` est aspirationnelle) ; (3) **insérer une "S29.5 Settings Critical" avant S30** pour livrer 4 pages settings P0 absentes (Tax, Payment Methods, KDS Config, Display Config) qui aujourd'hui forcent des modifications SQL directes — non-négociable pour passer en prod. Top 5 gaps **bloquants prod** : Trial Balance + GL viewer absents (audit externe impossible), saisie JE manuelle absente (comptable sans porte d'entrée), ExpenseFormPage absente (passage par SQL), Tax/PB1 settings sans UI (taux et comptes éditables seulement par SQL), Z-Report PDF inexistant (obligation archivage 7 ans). **3 décisions business à trancher avant cutover** : (a) Mobile Shell GO/NO-GO, (b) statut PKP The Breakery (débloque/enterre I1/I2/I3 e-Faktur), (c) WONTFIX formel allergens UI + multi-site/tenant/LAN/loyalty.

---

## Vue d'ensemble par module

Tableau de macro-statut pour les 21 modules métier (16 fiches V2 + 5 modules transverses 18 mobile / 21 LAN / 22 design / 23 tests / 24 deploy / 25 security — les modules 22-25 sont hors-périmètre fonctionnel et exclus ici).

| # | Module V2 | V3 status | Session(s) cibles | Bloquant prod ? |
|---|---|---|---|---|
| 01 | Auth & Permissions | 🟢 DONE | — | non |
| 02 | POS Cart & Orders | 🟢 DONE | (polish post-S30 dans backlog : offline, pre-auth carte, reservation) | non |
| 02b | Orders BO (Control Tower) | 🟡 PARTIEL — vue read existe, manque filters/bulk/heatmap | Post-S30 (2 sessions Control Tower S1+S2) | non |
| 03 | Payments (split, refund) | 🟢 DONE (hardening idempotency S25) | — | non |
| 04 | KDS Kitchen | 🟢 DONE (4 stations + waiter + LAN + sound + auto-remove) | Post-S30 (Observability, Robustness LAN, Station Admin) | non |
| 05 | Products & Categories | 🟢 DONE (S27 CRUD + S27b create + categories DnD) | S27c (bulk, variants UI) | non |
| 06 | Inventory & Stock | 🟢 DONE + dépassé (WAC, FIFO, opname, alerts, recipes versioning) | — | non |
| 07 | Purchasing & Suppliers | 🟢 DONE + dépassé (landed cost pro-rata S23) | Post-S30 (Supplier Ops, AP Aging, PO PDF) | non |
| 08 | Customers & Loyalty | 🟢 DONE | Post-S30 (Customer Detail + Dedup, Loyalty Engagement) | non |
| 09 | B2B Wholesale | 🟡 PARTIEL — Foundation S24 (dashboard, payments, view_ar_aging) ; reste devis/abonnements/relances/portal | Post-S30 (B2B Quotes + Recurring) | non |
| 10 | Accounting (Double-Entry) | 🟡 PARTIEL **MAJEUR** — 4 pages livrées sur 11 (Mappings + BS/PL/CashFlow sous /reports) | **S26 Comptable Cockpit (10 pages)** | **OUI (bloquant audit comptable externe)** |
| 11 | Expenses | 🟡 PARTIEL — 2 pages livrées sur 4 (ListPage + DetailPage) ; manque Form + Categories + workflow approval | **S28 Expense Governance** | **OUI (saisie dépense impossible sans SQL — actuellement page `NewExpensePage` existe en routes mais ExpenseFormPage métier absent — voir matrice §3)** |
| 12 | Cash Register & Shift | 🟢 DONE | Post-S30 (Shift Robustness : handover, auto-close, dual-auth) | non |
| 13 | Promotions & Combos | 🟢 DONE (engine + auto-eval + realtime) | Post-S30 (stacking, coupons sérialisés, segments) | non |
| 14 | Reports & Analytics | 🔴 MAJEUR — 13 reports livrés sur ~61 (parité ~21%) | **S29 Reports Export + Z-Report PDF** | **OUI partiellement (Z-Report PDF obligation 7 ans archivage)** |
| 15 | Production & Recipes | 🟢 DONE + dépassé (sub-recipes, baker %, versioning, batch yield, margin alerts) | — | non |
| 16 | Customer Display | 🟡 PARTIEL — feature `display/` existe, à vérifier (display_promotions, ORDER_READY notification, animations) | Post-S30 (Display Admin Config) | non |
| 17 | Tablet Ordering | 🟢 DONE + dépassé (idempotency, PIN, ACK hub, useTabletOffline) | Post-S30 (Tablet Offline Complete) | non |
| 18 | Mobile Shell | 🔴 ABSENT — **0 dépendance Capacitor**, **0 page mobile** dans `apps/`, doc 18-mobile-shell.md aspirationnelle | **S30 — décision GO/NO-GO recommandée NO-GO** | non (PWA-only OK) |
| 19 | Settings | 🟡 PARTIEL — 6 pages livrées sur ~23 (General, Hub, Holidays, EmailTemplates, ReceiptTemplates, Permissions, Security) | **S29.5 Settings Critical (proposé) + S30 cleanup** | **OUI partiellement (Tax/PB1, Payment Methods, KDS Config, Display Config absents)** |
| 20 | Users & RBAC | 🟢 DONE (S17 RPCs + matrice + audit + RBAC) | Post-S30 (Bulk Users + RBAC Templates) | non |
| 21 | LAN Architecture | 🟢 DONE (hub + client + heartbeat + dedup TTL 5s) | Post-S30 (LAN Reliability) | non |

**Bloquants prod (top 5 gaps majeurs)** :
1. Accounting Cockpit (Trial Balance, GL, JE manuelle saisie) — bloque audit externe (S26)
2. ExpenseFormPage métier — bloque saisie quotidienne par non-dev (S28)
3. Settings critiques (Tax/PB1, Payment Methods, KDS, Display) — force édition SQL pour paramètres business courants (S29.5 proposé)
4. Z-Report PDF + bucket Storage + retention 7 ans — obligation légale archivage comptable (S29)
5. CALK page + Bank Reconciliation — conformité SAK EMKM PME indonésienne (S26)

---

## Matrice exhaustive features × statut × session

Format : **Module · Sub-feature V2 · V3 path (réel) · Statut · Session cible · Priorité**.

Légende statut : ✅ DONE — 🟡 PARTIEL — 🔴 ABSENT — ❌ WONTFIX (mono-site permanent ou décision user).
Légende priorité : **P0** = bloquant prod / business critique — **P1** = impact business immédiat post-cutover — **P2** = qualité/ergonomie/polish — **P3** = nice-to-have.

### Module 01 — Auth & Permissions

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| LoginPage email/password | `apps/backoffice/src/pages/Login.tsx`, `apps/pos/src/pages/Login.tsx` | ✅ | — | — |
| PIN auth (`auth-verify-pin` EF) | `supabase/functions/auth-verify-pin/` | ✅ | — | — |
| PIN change (warn-only strength) | `supabase/functions/auth-change-pin/` + `evaluatePinStrength` (S19) | ✅ | — | — |
| Rate limiting durable Postgres | `record_rate_limit_v1` RPC + 5 EFs câblés (S19) | ✅ | — | — |
| Session timeout per role | `roles.session_timeout_minutes` + `useIdleTimeout` (S19) | ✅ | — | — |
| Permission matrix UI | `apps/backoffice/src/pages/users/PermissionsMatrixPage.tsx` | ✅ | — | — |
| ChangePinModal POS | `apps/pos/src/features/auth/` (S19) | ✅ | — | — |
| 2FA TOTP / SMS | — | 🔴 | Post-S30 (Defense-in-depth RBAC) | P3 |
| Sessions multiples par utilisateur (kill remote) | — | 🔴 | Post-S30 | P2 |
| Délégation temporaire de droits | — | 🔴 | Post-S30 | P3 |
| Détection auto-escalade privilèges | — | 🔴 | Post-S30 (Defense-in-depth RBAC) | P1 |
| Permissions à seuil (`sales.discount < 5% solo, 10% avec manager`) | — | 🔴 | Post-S30 | P2 |

### Module 02 — POS Cart & Orders

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| POSMainPage 6 zones | `apps/pos/src/pages/Pos.tsx` + `features/cart`, `features/products`, `features/promotions` | ✅ | — | — |
| OpenShiftModal | `features/shift/` | ✅ | — | — |
| TableSelectionModal floor plan | `features/floor-plan/`, `features/tables/` | ✅ | — | — |
| QR scan area (camera) | `features/products/QRScanArea` | ✅ (à vérifier en démo prod) | — | — |
| ComboSelectorModal | `features/combos/` | ✅ | — | — |
| ModifierModal + VariantModal | `features/cart/` | ✅ | — | — |
| DiscountModal + PIN seuil | `features/discounts/` | ✅ | — | — |
| CustomerSearchModal + CreateCustomerForm | `features/customers/` | ✅ | — | — |
| Send to Kitchen + cart locked | `features/cart/` + KDS realtime | ✅ | — | — |
| HeldOrdersModal (held orders) | `features/heldOrders/` | ✅ | — | — |
| PaymentModal split méthode | `features/payment/` | ✅ | — | — |
| SplitByItemModal | `features/payment/` | ✅ | — | — |
| Outstanding page (`/pos/outstanding`) | manquant — TASK-02-* dans backlog | 🟡 | Post-S30 (POS Cart Hardening) | P2 |
| VoidModal + RefundModal (PIN) | `features/cart/` + EF `refund-order` v7 idempotent | ✅ | — | — |
| VirtualKeypad / Numpad | `packages/ui/` | ✅ | — | — |
| TransactionHistoryModal | `features/order-history/` | ✅ | — | — |
| LiveSessionsModal | `features/shift/` | ✅ | — | — |
| CashierAnalyticsModal | `features/shift/` | ✅ | — | — |
| useTabletOrderReceiver (réception tablette) | `features/inbox/` | ✅ | — | — |
| Mode dégradé offline | — | 🔴 | Post-S30 (POS Cart Hardening) | P1 (mais hors scope cutover initial — Bali réseau 4G stable) |
| Pre-authorization cartes dine-in | — | 🔴 | Post-S30 | P2 |
| Réservation / pré-commande client | — | 🔴 | Post-S30 | P1 (cas gâteau sur mesure récurrent boulangerie) |
| Tableau "Tables ouvertes" vue principale | — | 🔴 | Post-S30 | P2 |
| Quick reorder ("refaire la même") | — | 🔴 | Post-S30 | P2 |
| Voice search | — | 🔴 | jamais | P3 |
| Suggested upsell (basket analysis) | — | 🔴 | Post-S30 (cross Reports) | P3 |
| Customer-facing payment QR | — | 🔴 | Post-S30 | P2 |
| Multi-currency | — | ❌ WONTFIX | (Multi-devise hors scope V3) | — |

### Module 02b — Orders BO (Control Tower)

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| /orders liste filtrable Realtime | (page absente — voir doc `02b-orders.md` Partie II "TODO à rédiger") | 🟡 PARTIEL | Post-S30 (Orders BO Control Tower S1) | P1 |
| 5 KPI strip | — | 🔴 | Post-S30 (S1) | P1 |
| Filters status/type/payment/search/date | — | 🔴 | Post-S30 (S1) | P1 |
| Modale détail commande + actions void/refund | (via POS history seulement aujourd'hui) | 🟡 | Post-S30 (S1) | P1 |
| Filtre par cashier/serveur | — | 🔴 | Post-S30 (S1) | P1 |
| Bulk actions "marquer payées" multi-rows | — | 🔴 | Post-S30 (S1) | P1 |
| Filtre rapide "Mes commandes" | — | 🔴 | Post-S30 (S2) | P2 |
| Heatmap visuelle des commandes en cours | — | 🔴 | Post-S30 (S2) | P2 |
| Notification toast riche au "ready" | — | 🔴 | Post-S30 (S2) | P2 |
| Édition de commande après coup (PIN + audit) | — | 🔴 | Post-S30 (S2) | P2 |
| Vue calendrier des commandes différées | — | 🔴 | Post-S30 (S2) | P2 |
| Export PDF par commande | — | 🔴 | Post-S30 (S2) | P3 |
| Lien direct vers KDS depuis Orders | — | 🔴 | Post-S30 (S2) | P3 |

### Module 03 — Payments

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| `complete_order` atomique v9 | `supabase/migrations/*` | ✅ | — | — |
| `pay_existing_order` v6 | idem | ✅ | — | — |
| Refund EF idempotent + PIN header | `supabase/functions/refund-order/` v7 (S25) | ✅ | — | — |
| Methods : Cash, Card, QRIS, GoPay, OVO, DANA, Bank, B2B credit, Outstanding | `features/payment/` | ✅ | — | — |
| Cash change calculation arrondie 100 IDR | domain helper | ✅ | — | — |
| Split par item dine-in (SplitByItem) | `features/payment/` | ✅ | — | — |

### Module 04 — KDS

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| 4 stations (hot_kitchen, barista, display, waiter) | `apps/pos/src/features/kds/` | ✅ | — | — |
| KDSStationSelector | `features/kds/components/` | ✅ | — | — |
| KDSMainPage avec OrderGrid + countdown bar | `features/kds/` | ✅ | — | — |
| Sound service (urgent alert loop) | `features/kds/hooks/` | ✅ | — | — |
| Mode Waiter aggrégeant toutes stations | `features/kds/` | ✅ | — | — |
| Auto-remove (useOrderAutoRemove) | `features/kds/hooks/` | ✅ | — | — |
| LAN client + fallback Realtime | `features/lan/` + `useKdsRealtime` | ✅ | — | — |
| Service Speed report | — | 🔴 | Post-S30 (KDS Observability) | P1 |
| Throttling intelligent (alerte file saturée) | — | 🔴 | Post-S30 (KDS Robustness LAN) | P2 |
| Chat inter-stations | — | 🔴 | Post-S30 | P3 |
| Mode urgences (force item en haut + rouge) | — | 🔴 | Post-S30 | P2 |
| Reroute manuel item → autre station | — | 🔴 | Post-S30 | P2 |
| Persistance offline | — | 🔴 | jamais (out of scope V3) | P3 |
| Mode présentation public (cuisine ouverte) | — | 🔴 | jamais | P3 |
| Station Admin Page `/settings/kds-stations` + DnD | — | 🔴 | Post-S30 (KDS Station Admin) | P2 |
| ACK badge KDS-side | — | 🔴 | Post-S30 (KDS Robustness LAN) | P2 |
| Reconnect banner | — | 🔴 | Post-S30 (KDS Robustness LAN) | P2 |

### Module 05 — Products & Categories

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| ProductsPage liste + create | `apps/backoffice/src/pages/Products.tsx` + S27 + S27b | ✅ | S27 + S27b mergés | — |
| ProductDetailPage update | `apps/backoffice/src/pages/products/ProductDetailPage.tsx` (S27) | ✅ | — | — |
| Recipe tab | `features/recipes/` (S15) | ✅ | — | — |
| Costing tab (margin alerts) | features/inventory + margin-watch | ✅ | — | — |
| Variants tab — stubs minimum viable | (stub seulement) | 🟡 | S27c (déferé) | P2 |
| Categories CRUD + DnD reorder | `apps/backoffice/src/pages/categories/CategoriesPage.tsx` (S27b) | ✅ | — | — |
| Bulk operations (toggle active, change cat multi-rows) | — | 🔴 | S27c (déferé) | P2 |
| Sub-recipes (sub-recipes anti-cycle 5-niveaux + BOM cascade) | S15+S17+S19+S21 | ✅ + dépassé V2 | — | — |
| Allergens module structuré | — | ❌ WONTFIX (décision user 2026-05-17 — memory `project_allergens_wontfix`) | — | — |
| Combos avec groupes | `features/combos/` | ✅ | — | — |
| `update_cost_price_v1` WAC + replay envelope | RPC (S26) | ✅ + amélioration V3 | — | — |

### Module 06 — Inventory & Stock

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| Inventory dashboard | `apps/backoffice/src/pages/Inventory.tsx` + features/inventory-dashboard | ✅ | — | — |
| Stock movements page (append-only ledger) | `pages/inventory/StockMovementsPage.tsx` | ✅ | — | — |
| Adjustments / waste / receive / transfer (RPCs SECURITY DEFINER) | 5 RPCs + `record_stock_movement_v1` primitive | ✅ | — | — |
| Opname (inventory counts) | `pages/inventory/OpnameListPage.tsx` + `OpnameDetailPage.tsx` (S17) | ✅ | — | — |
| Internal transfers (sections) | `pages/{TransfersList,TransferDetail,TransferForm}.tsx` | ✅ | — | — |
| Margin Watch (alerts pg_cron) | `pages/inventory/MarginWatchPage.tsx` (S19) | ✅ | — | — |
| Alerts page (low stock + critical) | `pages/inventory/AlertsPage.tsx` | ✅ | — | — |
| Sections page | `pages/inventory/SectionsPage.tsx` | ✅ | — | — |
| Idempotency `p_idempotency_key UUID` sur RPCs inventory | (S12 family) | ✅ + amélioration V3 | — | — |
| Ghost stock movements report (audit fraude) | — | 🔴 | Post-S30 (Inventory Polish) | P2 |
| POS quick-waste | — | 🔴 | Post-S30 (Inventory Polish) | P2 |
| Cost correction report | — | 🔴 | Post-S30 (Inventory Polish) | P2 |

### Module 07 — Purchasing & Suppliers

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| Suppliers list + create + detail | `pages/{Suppliers,suppliers/SupplierDetailPage}.tsx` | ✅ | — | — |
| Purchase Orders list + new + detail | `pages/purchasing/{PurchaseOrdersListPage,NewPurchaseOrderPage,PurchaseOrderDetailPage}.tsx` | ✅ | — | — |
| Incoming stock | `pages/IncomingStock.tsx` | ✅ | — | — |
| Receive PO + auto stock + WAC | RPCs `create_po`, `receive_po`, `cancel_po` + WAC `update_cost_price_v1` | ✅ | — | — |
| Landed cost shipping pro-rata | S23 | ✅ + amélioration V3 | — | — |
| Skip WAC sample/promo opt-out | (DEV-S17-1.C-01 — Post-S30) | 🟡 | Post-S30 (Inventory Polish) | P3 |
| QC reject par ligne PO | — | 🔴 | Post-S30 (Supplier Ops) | P2 |
| Performance scoring fournisseur | — | 🔴 | Post-S30 (Supplier Ops) | P2 |
| AP Aging report | (vue à créer — pendant du AR aging S24) | 🟡 | Post-S30 (AP Aging + PO PDF) | P1 |
| PO PDF generation | — | 🔴 | Post-S30 (AP Aging + PO PDF) | P1 |
| Email PO au fournisseur | — | 🔴 | Post-S30 (AP Aging + PO PDF) | P2 |
| Avoirs / credit notes | — | 🔴 | Post-S30 | P3 |
| Workflow approval multi-niveaux PO | — | 🔴 | Post-S30 | P3 |
| Multi-devise PO | — | ❌ WONTFIX | — | — |

### Module 08 — Customers & Loyalty

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| Customers list + filters + stats | `pages/customers/CustomersListPage.tsx` | ✅ | — | — |
| Customer categories (pricing tiers) | `pages/customers/CustomerCategoriesPage.tsx` | ✅ | — | — |
| Customer creation/edit (QR code + membership_number auto) | `features/customers/` | ✅ | — | — |
| Loyalty page (tiers Bronze→Platinum, ledger immutable) | `pages/Loyalty.tsx` + features/loyalty | ✅ | — | — |
| `adjust_loyalty_points_v1` + RPC | ✅ + hardening S15 | ✅ | — | — |
| Customer detail (360° dashboard, tabs Loyalty/Orders/Analytics) | — | 🟡 PARTIEL | Post-S30 (Customer Detail + Dedup) | P1 |
| `parent_customer_id` + phone_normalized + dedup UI | — | 🔴 | Post-S30 (Customer Detail + Dedup) | P1 |
| Customer merge UI | — | 🔴 | Post-S30 (Customer Detail + Dedup) | P2 |
| Tier upgrade auto + expiration job + analytics | (partiellement — `useUpgradeTier`) | 🟡 | Post-S30 (Loyalty Engagement) | P2 |
| Marketing : Birthday + Cohort + Segments + Promo ROI | `pages/marketing/{Birthday,CohortReport,Segments,PromoRoi}Page.tsx` | ✅ | — | — |
| Customer birthday cron (`pg_net` S21) | ✅ + amélioration V3 | ✅ | — | — |
| Bulk import customers from CSV/Excel | (import assistant) | 🟡 PARTIEL (à vérifier) | Post-S30 | P2 |
| Multi-établissement loyalty | — | ❌ WONTFIX (mono-site permanent, ratifié 2026-05-19) | — | — |
| Programme parrainage automatisé | — | 🔴 | jamais | P3 |
| Expiration automatique points (cron) | — | 🔴 | Post-S30 (Loyalty Engagement) | P2 |
| App mobile dédiée client | — | ❌ WONTFIX (hors scope V3) | — | — |

### Module 09 — B2B Wholesale

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| Dashboard B2B (KPI, top clients, recent, aging) | `pages/btob/B2BDashboardPage.tsx` (S24) | ✅ | — | — |
| `view_b2b_invoices` + `view_ar_aging` views | (S24) | ✅ | — | — |
| `record_b2b_payment_v1` + `adjust_b2b_balance_v1` RPCs | (S24) | ✅ | — | — |
| `validate_b2b_credit_limit_v1` câblé dans `complete_order_v9` | (S24) | ✅ | — | — |
| RecordB2bPaymentModal + B2BPaymentsPage Received tab | `pages/btob/B2BPaymentsPage.tsx` (S24) | ✅ | — | — |
| CreateB2bOrderModal (active "+ New B2B Order" button) | (S24) | ✅ | — | — |
| B2B settings page | `pages/btob/B2BSettingsPage.tsx` | ✅ | — | — |
| Liste des commandes B2B `/b2b/orders` séparée | (probablement onglet du dashboard ou page absente) | 🟡 | Post-S30 (B2B Quotes + Recurring) | P1 |
| Détail commande B2B 4 onglets (Items, Deliveries, Payments, History) | — | 🔴 | Post-S30 | P1 |
| Listes de prix B2B dédiées (`b2b_price_lists`) | (à vérifier — `b2b_price_lists` listée comme "❓" dans glossaire §4) | 🟡 | Post-S30 | P2 |
| Auto-approval workflow par seuil | — | 🔴 | Post-S30 | P2 |
| Détection self-approval (créateur = approbateur) | (report `b2b_self_approval_risk` cité dans Reports) | 🔴 | Post-S30 (cross Reports) | P1 |
| Commandes récurrentes / abonnements | — | 🔴 | Post-S30 (B2B Quotes + Recurring) | P2 |
| Relances automatiques (J-3, J+0, J+7, J+15) | — | 🔴 | Post-S30 | P2 |
| Devis (quote) avant commande | — | 🔴 | Post-S30 (B2B Quotes + Recurring) | P2 |
| Génération facture PDF + EF `generate-invoice` + Storage | — | 🔴 | Post-S30 (S29 Reports Export cross) | P1 |
| Envoi facture par email | — | 🔴 | Post-S30 | P2 |
| Portal client B2B (self-service) | — | 🔴 | jamais (out of scope) | P3 |
| Avoirs / credit notes | — | 🔴 | Post-S30 | P3 |
| Tarification par volume (prix dégressifs) | — | 🔴 | jamais | P3 |

### Module 10 — Accounting (gap majeur — couvert par S26)

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| MappingsPage (COA mappings) | `pages/accounting/MappingsPage.tsx` (S17) | ✅ + amélioration V3 | — | — |
| Triggers JE auto (sale, purchase, expense approve, production, waste, refund, void, écart de caisse) | `refactor_create_sale_journal_entry` + `create_purchase_journal_entry_trigger` + `approve_expense_with_journal` etc. | ✅ | — | — |
| ChartOfAccountsPage | — | 🔴 | **S26** | **P0** |
| JournalEntriesPage (viewer + saisie manuelle) | — | 🔴 | **S26** + RPC `create_manual_je_v1` SECURITY DEFINER + PIN gate | **P0** |
| GeneralLedgerPage (drilldown par compte, pagination cursor) | — | 🔴 | **S26** | **P0** |
| TrialBalancePage + RPC `get_trial_balance_v1(p_start, p_end)` + export CSV/PDF | — | 🔴 | **S26** | **P0** |
| BalanceSheetPage | `pages/reports/BalanceSheetPage.tsx` (sous /reports — à renommer ou cloner sous /accounting) | ✅ | (re-route S26) | — |
| IncomeStatementPage (= ProfitLoss) | `pages/reports/ProfitLossPage.tsx` | ✅ | (re-route S26) | — |
| VATManagementPage (PB1 — consomme `calculate_vat_payable_v1` livré S13 sans consumer) | — | 🔴 | **S26** | **P0** |
| ARAgingPage (consomme `view_ar_aging` S24 + CSV/PDF) | — | 🔴 | **S26** | **P0** |
| BankReconciliationPage (CSV upload + auto-match + manual match + adjustments) | — | 🔴 | **S26** | **P1** (audit comptable, mais peut être manuel Excel à court terme) |
| ReconciliationDetailPage | — | 🔴 | **S26** | **P1** |
| CALKPage (notes annexes SAK EMKM) | — | 🔴 | **S26** | **P1** |
| FiscalPeriodModal (open/closed/pending_closure — RPC + table existent S17) | — | 🔴 | **S26** | **P0** (sinon période jamais clôturée → tout modifiable) |
| Cash Flow 3 sections (Operating/Investing/Financing) | `pages/reports/CashFlowPage.tsx` (S21) | ✅ + amélioration V3 (Investing/Financing ajoutés vs V2 Operating-only) | — | — |
| E-Faktur / e-Bupot integration | — | 🔴 | Post-S30 conditionnel (statut PKP) | P1 conditionnel |
| Amortissement auto immobilisations | — | 🔴 | jamais (saisie OD manuelle) | P2 |
| Closing checklist mensuelle workflow | — | 🔴 | Post-S30 (Closeout & Period Lock) | P2 |
| Budget vs réel | — | 🔴 | Post-S30 | P2 |
| Export Accurate / MYOB | — | 🔴 | Post-S30 | P2 |
| Multi-devise | — | ❌ WONTFIX | — | — |
| Consolidation multi-entité | — | ❌ WONTFIX (mono-site permanent, ratifié 2026-05-19) | — | — |
| Tax planning simulation | — | 🔴 | jamais | P3 |

### Module 11 — Expenses (couvert par S28)

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| ExpensesListPage | `pages/expenses/ExpensesListPage.tsx` | ✅ | — | — |
| ExpenseDetailPage | `pages/expenses/ExpenseDetailPage.tsx` | ✅ | — | — |
| **ExpenseFormPage (create/edit)** | `pages/expenses/NewExpensePage.tsx` existe (route `/expenses/new`) — **à vérifier complétude** vs vision V2 (10 champs : date, catégorie, description, montant, fournisseur, méthode, date paiement, ref, justificatif, notes) | 🟡 PARTIEL | **S28** | **P0** |
| **ExpenseCategoriesPage CRUD admin** | — | 🔴 | **S28** | **P0** (sinon catégories en seed.sql + plan comptable lié, non éditable) |
| Workflow approval (Draft → Approved → Paid, séparation tâches, seuils) | (5 RPCs S17 livrées : `approve_expense_with_journal` etc.) UI partielle | 🟡 | **S28** | **P0** |
| `approve_expense_with_journal` block creator=approver | — | 🔴 | **S28** | **P1** |
| Sync `expense.payment_method='cash'` ↔ `pos_sessions.cash_out_total` (trigger ou RPC) | — | 🔴 | **S28** | **P1** |
| Table `expense_thresholds(category_id, max_amount, requires_role[])` + seed | — | 🔴 | **S28** | **P1** |
| Dépenses récurrentes programmées | — | 🔴 | Post-S30 | P1 (loyer mensuel) |
| OCR de factures | — | 🔴 | jamais | P3 |
| Budget par catégorie | — | 🔴 | Post-S30 | P2 |
| Remboursement note de frais workflow dédié | — | 🔴 | Post-S30 | P2 |
| Multi-devise expense | — | ❌ WONTFIX | — | — |
| Lien PO service ↔ dépense | — | 🔴 | Post-S30 | P3 |
| Catégorisation auto par IA | — | 🔴 | jamais | P3 |
| Export pour comptable (CSV format Accurate/MYOB) | — | 🔴 | Post-S30 (S29 Reports cross) | P2 |

### Module 12 — Cash Register & Shift

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| OpenShiftModal + counting opening_cash | `features/shift/` | ✅ | — | — |
| CloseShiftModal + ShiftReconciliationModal | `features/shift/` | ✅ | — | — |
| ShiftStatsModal (CA, panier moyen, méthodes, voids, refunds) | `features/shift/` | ✅ | — | — |
| ShiftHistoryModal (N dernières sessions) | `features/shift/` | ✅ | — | — |
| Multi-terminal LiveSessionsModal | `features/shift/` | ✅ | — | — |
| `close_shift_rpc` + écriture JE écart auto | `supabase/migrations/*` | ✅ | — | — |
| **Z-Report PDF** | — | 🔴 | **S29** + EF `generate-zreport-pdf` + bucket Storage `zreports/` + retention 7 ans policy + signature manager PIN | **P0** (obligation légale archivage) |
| Cash-in / cash-out en cours de session (`record_cash_movement_rpc` existe — UI ?) | (RPC livrée, UI à vérifier) | 🟡 | Post-S30 (Shift Robustness) | P1 |
| Validation à deux mains pour gros écarts | — | 🔴 | Post-S30 (Shift Robustness) | P2 |
| Compte des coupures obligatoire (par 5k/10k/20k/50k/100k) | — | 🔴 | Post-S30 (Shift Robustness) | P2 |
| Alerte écart en temps réel (cash théorique > seuil) | — | 🔴 | Post-S30 | P3 |
| Session pause/reprise | — | 🔴 | Post-S30 | P3 |
| Auto-clôture programmée minuit | — | 🔴 | Post-S30 (Shift Robustness) | P2 |
| Dépôt bancaire intégré (avec photo bordereau) | — | 🔴 | Post-S30 | P2 |
| KSeF / certification fiscale Indonésie | — | 🔴 conditionnel | dépend statut PKP | P1 conditionnel |
| Coffre-fort intégré | — | 🔴 | jamais | P3 |

### Module 13 — Promotions & Combos

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| Promotions list + cards | `pages/Promotions.tsx` + features/promotions | ✅ | — | — |
| 4 types : percentage, fixed_amount, buy_x_get_y, free_product | features/promotions + engine | ✅ | — | — |
| Conditions : période, jours, produits, catégories, min panier, min qty, type client, type commande, méthode paiement, code promo, limites | engine | ✅ | — | — |
| `evaluate_promotions_v1` + auto-eval realtime hook | `usePromotionsAutoEval` + `usePromotionsRealtime` | ✅ + amélioration V3 (realtime) | — | — |
| ComboFormGeneral + Groups + PricePreview | `pages/products/CombosPage.tsx` + features/combos | ✅ | — | — |
| ComboSelectorModal POS | `features/combos/` | ✅ | — | — |
| Codes promo client | engine | ✅ (à vérifier UI complète) | — | — |
| Limites d'usage (max total, max par client, max par jour) | engine | ✅ | — | — |
| Stacking configurable (cumul promos) | — | 🔴 | Post-S30 (Promo Stacking + Coupons) | P2 |
| Promotion effectiveness report (ROI mesuré) | — | 🔴 | Post-S30 (cross S29 Reports) | P1 |
| Coupons sérialisés QR uniques | — | 🔴 | Post-S30 (Promo Stacking + Coupons) | P2 |
| Promotions par segment client (dormants 60j) | — | 🔴 | Post-S30 | P2 |
| A/B testing intégré | — | 🔴 | jamais | P3 |
| Programme parrainage | — | 🔴 | jamais | P3 |
| Combos dynamiques (règles conditionnelles) | — | 🔴 | Post-S30 | P3 |
| Smart suggest au POS ("ajoutez 1 baguette pour activer BOGO") | — | 🔴 | jamais | P3 |
| Calendrier visuel des promos | — | 🔴 | Post-S30 | P3 |

### Module 14 — Reports & Analytics (gap majeur — ~48 reports manquants)

Reports **livrés** (13) :
1. ✅ ReportsIndexPage
2. ✅ SalesByCategoryPage
3. ✅ SalesByHourPage
4. ✅ SalesByStaffPage
5. ✅ BasketAnalysisPage
6. ✅ StockVariancePage
7. ✅ ProductionYieldPage
8. ✅ RecipeCostOverviewPage (S18 — amélioration V3)
9. ✅ RecipeCostTimelinePage (S18 — amélioration V3)
10. ✅ AuditPage
11. ✅ ProfitLossPage
12. ✅ BalanceSheetPage
13. ✅ CashFlowPage (S21 — 3 sections Operating/Investing/Financing, amélioration V3)

Reports **manquants** par catégorie V2 :

#### 14.1 Overview (1 manquant)

| Report V2 | V3 status | Priorité S29 |
|---|---|---|
| General Dashboard (Overview KPI consolidé) | 🔴 | **P0** (page d'entrée gérant le matin) |

#### 14.2 Sales (15 manquants sur 16)

| Report V2 | V3 status | Priorité S29 |
|---|---|---|
| All in 1 Sales Summary | 🔴 | P1 |
| Daily Sales (courbe chronologique) | 🔴 | **P0** |
| Sales By Date (journal détaillé) | 🔴 | **P0** |
| Sales Items By Date (drill-down items) | 🔴 | P1 |
| Daily Items Sold Detail (heure envoi/paiement) | 🔴 | P2 |
| Product Sales By SKU | 🔴 | **P0** |
| Sales By Customer | 🔴 | P1 |
| Order Type Distribution | 🔴 | P2 |
| Gross Margin by Product | 🔴 | **P0** (essentiel pricing) |
| ABC Product Analysis (Pareto) | 🔴 | P1 |
| Customer Lifetime Value | 🔴 | P2 |
| Loyalty & Retention | 🔴 | P2 |
| Sales Cancellation Details | 🔴 | P1 |
| Sales By Brand (placeholder) | 🔴 | P3 |
| Discount Details | 🔴 | P1 |

#### 14.3 Inventory (10 manquants sur 11)

| Report V2 | V3 status | Priorité S29 |
|---|---|---|
| Product Stock Balance | 🔴 | **P0** |
| Stock Movement (historique complet) | 🟡 (page exists `StockMovementsPage` côté Inventory, manque export PDF) | P1 |
| Stock Movement Analytics (courbe valeur) | 🔴 | P2 |
| Wastage & Spoilage | 🔴 | **P0** (boulangerie périssable) |
| Incoming Raw Materials | 🟡 (page `IncomingStock` exists) | P2 |
| Stock Transfer | 🟡 (page exists) | P2 |
| Product Stock Warning | 🟡 (page Alerts exists, manque rapport) | P1 |
| Product Unsold (SKU morts) | 🔴 | P1 |
| Expired Stock | 🔴 | **P0** (alerte sanitaire) |
| Product Materials (recette + coût) | 🔴 | P2 |
| Outgoing Stocks (placeholder) | 🔴 | P3 |

#### 14.4 Purchases (5 manquants sur 6)

| Report V2 | V3 status | Priorité S29 |
|---|---|---|
| Purchase Items (prix unitaire) | 🔴 | P1 |
| Purchase Details (par PO) | 🔴 | P1 |
| Purchase By Date | 🔴 | P2 |
| Purchase By Supplier | 🔴 | **P0** (négociation) |
| Outstanding Payment (AP) | 🔴 | **P0** (cash flow) |
| Purchase Returns | 🔴 | P3 |

#### 14.5 Finance & Payments (10 manquants sur 12)

| Report V2 | V3 status | Priorité S29 |
|---|---|---|
| Payment By Method | 🔴 | **P0** (négo commissions banque) |
| Sales Cash Balance (réconcil session) | 🔴 | **P0** (fraude détection) |
| Expenses by Date | 🔴 | **P0** |
| Receivables (global clients) | 🔴 | P1 |
| B2B Receivables Aging (consomme `view_ar_aging`) | 🔴 (vue existe) | **P0** |
| POS Outstanding | 🔴 | P1 |
| POS Outstanding History | 🔴 | P2 |
| Revenue Forecast (moyenne mobile 7j) | 🔴 | P2 |
| P&L Monthly Trend | 🔴 | P1 |
| VAT / Tax Report (PB1 mensuel) | 🔴 | **P0** (déclaration fiscale) |
| Discounts & Voids | 🔴 | P1 |
| (Profit & Loss livré ✅, Balance Sheet livré ✅) | — | — |

#### 14.6 Operations (4 manquants sur 5)

| Report V2 | V3 status | Priorité S29 |
|---|---|---|
| Staff Performance | 🔴 | P1 |
| Production Report | 🔴 | P1 |
| Production Efficiency | 🟡 (page ProductionYield exists, à vérifier exhaustivité) | P2 |
| COGS Production Report | 🔴 | P1 |
| KDS Service Speed | 🔴 | P1 |

#### 14.7 Logs & Audit (9 manquants sur 10)

| Report V2 | V3 status | Priorité S29 |
|---|---|---|
| Price Changes | 🔴 | P1 |
| Product Deleted | 🔴 | P2 |
| General Audit Log | ✅ (AuditPage livrée) | — |
| Permission Change Log | 🔴 | **P0** (détection escalade) |
| Void & Discount Abuse | 🔴 | **P0** (sweethearting) |
| Cash Variance Trend | 🔴 | **P0** (vol progressif) |
| Loyalty Adjustments Audit | 🔴 | P1 |
| Ghost Stock Movements | 🔴 | P1 |
| Duplicate Transactions | 🔴 | P2 |
| Alerts Dashboard | 🔴 | P2 |
| Unusual Transaction Patterns (hors horaires, montants aberrants) | 🔴 | **P0** |
| B2B Self-Approval Risk | 🔴 | **P0** (audit fraude) |

**Top 10 P0 reports prioritaires pour S29** (sur ~48 manquants) :
1. Daily Sales (courbe revenue)
2. Product Sales By SKU
3. Gross Margin by Product
4. Wastage & Spoilage
5. Expired Stock
6. Purchase By Supplier
7. Outstanding Payment AP
8. Payment By Method
9. VAT / Tax Report (PB1 déclaration)
10. B2B Receivables Aging + Z-Report PDF (bonus EF generic + IDR rounding 100 + comparison vs prev period)

#### Reports exports / PDF (transverse)

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| CSV export tous reports | (présent sur reports livrés — à vérifier exhaustivité) | 🟡 PARTIEL | S29 | P1 |
| PDF export tous reports avec en-tête The Breakery + filigrane | — | 🔴 | S29 (EF `generate-pdf` générique) | **P0** |
| EF `generate-pdf` générique réutilisable | — | 🔴 | S29 | P0 |
| Drill-down avec breadcrumb | — | 🔴 | Post-S30 (Reports UX Uplift) | P2 |
| Custom report builder drag&drop | — | 🔴 | jamais (TASK-14-007) | P3 |
| Scheduled reports email | — | 🔴 | jamais (TASK-14-008) | P3 |

### Module 15 — Production & Recipes (dépassé vs V2)

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| ProductionPage saisie | `pages/inventory/ProductionPage.tsx` | ✅ | — | — |
| Batch production page | `pages/inventory/BatchProductionPage.tsx` (S19) | ✅ | — | — |
| Schedule page (suggestions) | `pages/inventory/ProductionSchedulePage.tsx` (S19) | ✅ + amélioration V3 (V2 backlog 🔴) | — | — |
| Recipe editor | `pages/inventory/RecipeEditorPage.tsx` (S15) | ✅ | — | — |
| Sub-recipes anti-cycle 5-niveaux + cost cascade | RPCs S15+S17+S19+S21 | ✅ + amélioration V3 (V2 marquait "ne supporte pas") | — | — |
| Recipe versioning + snapshot avec cost | `recipe_versions` table + helper (S20+S21) | ✅ + amélioration V3 (V2 marquait "ne fait pas") | — | — |
| Baker's percentages | `extend_recipes_baker_percentage` (S19) | ✅ + amélioration V3 | — | — |
| Yield tracking | (S15) | ✅ + amélioration V3 | — | — |
| Margin alerts pg_cron | (S19) | ✅ + amélioration V3 | — | — |
| Production scheduling suggestions | `suggest_production_schedule_v1` (S19) | ✅ + amélioration V3 | — | — |
| Conversion d'unités auto (g↔kg, mL↔L) | helper domain | ✅ | — | — |
| Production infaisable alerte | (à vérifier) | 🟡 | Post-S30 | P2 |
| Allergènes structurés | — | ❌ WONTFIX | — | — |
| Plan production hebdomadaire (instanciation 1 clic) | — | 🔴 | Post-S30 | P2 |
| Mode mobile saisie | — | 🔴 | hors scope V3 (PWA OK) | P3 |
| IoT four | — | 🔴 | jamais | P3 |
| Yield calculator ("80 couverts demain") | — | 🔴 | Post-S30 | P3 |

### Module 16 — Customer Display

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| CustomerDisplayPage layout | `apps/pos/src/features/display/CustomerDisplayPage.tsx` | ✅ | — | — |
| CDActiveCartView (cart live + totaux) | `features/display/CustomerDisplayView.tsx` | ✅ | — | — |
| CDIdleView (logo + promos rotatives) | `features/display/` (à vérifier promo rotation) | 🟡 | Post-S30 (Display Admin Config) | P2 |
| `useDisplayBroadcast` (synchro POS) | `features/display/hooks/` | ✅ | — | — |
| `display_promotions` table (marketing visuel) | (vérifié par audit Vague 1 : "❓") | 🟡 | Post-S30 (Display Admin Config) | P2 |
| ORDER_READY notification cross KDS→Display | (probablement partiel, voir audit Vague 1 enum drift `take_away`) | 🟡 | Post-S30 | P2 |
| Animations fidélité points en direct | — | 🔴 | Post-S30 (Display Admin Config) | P3 |
| Configuration Settings → Display | — | 🔴 | S29.5 proposé ou Post-S30 | P1 (sinon idle timeout codé en dur) |
| QR paiement digital affiché | — | 🔴 | Post-S30 | P2 |
| Vidéos courtes idle | — | 🔴 | jamais | P3 |
| Multilingue affichage | — | 🔴 | Post-S30 | P3 |
| Compteur visiteurs gamification | — | 🔴 | jamais | P3 |

### Module 17 — Tablet Ordering

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| TabletLayout PIN auth + LAN client | `apps/pos/src/pages/tablet/TabletLayout.tsx` | ✅ | — | — |
| TabletOrderPage composition commande | `apps/pos/src/pages/tablet/TabletOrderPage.tsx` | ✅ | — | — |
| TabletOrdersPage historique | `pages/tablet/TabletOrdersPage.tsx` | ✅ | — | — |
| `create_tablet_order_v2(p_client_uuid)` + idempotency keys | (S25) | ✅ + amélioration V3 | — | — |
| `useCreateTabletOrder` v2 + client_uuid lifecycle | `features/tablet/hooks/` (S25) | ✅ | — | — |
| `useTabletOffline` cache local | (S25) | ✅ + amélioration V3 | — | — |
| ACK hub `TABLET_ORDER_RECEIVED` | `features/lan/` | ✅ | — | — |
| Queue offline complet (IndexedDB + sync RPC) | (S25 partial — second half deferred) | 🟡 | Post-S30 (Tablet Offline Complete) | P2 |
| Auto-send cuisine optionnel (bypass cashier) | — | 🔴 | Post-S30 | P2 |
| Modifier engine complet (parité POS) | — | 🔴 | Post-S30 | P2 |
| Combos sélectionnables tablette | — | 🔴 | Post-S30 | P2 |
| Création client depuis tablette | — | 🔴 | Post-S30 | P2 |
| Pre-bill table sans encaissement | — | 🔴 | Post-S30 | P2 |
| Notification push KDS→tablette ("table 7 ready") | — | 🔴 | Post-S30 | P2 |
| Photos plats HD | — | 🔴 | jamais | P3 |
| Mode "menu client" (kiosk) | — | 🔴 | jamais | P3 |
| **C-01 bug fix : `order_items.name_snapshot`** (audit Vague 1) | `apps/pos/src/features/tablet/hooks/useMyTabletOrders.ts:31` | 🔴 BUG critique | Pré-S26 fast-follow | **P0** |

### Module 18 — Mobile Shell — **0 LIGNE DE CODE EN V3**

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| Capacitor wrap Android | **AUCUN — `package.json` ne contient pas `@capacitor/*`** | 🔴 | **Décision S30 GO/NO-GO recommandée NO-GO** | — |
| `apps/mobile/` ou `/mobile/*` routes | **AUCUN — aucune page `/mobile/*` dans `apps/pos` ni `apps/backoffice`** | 🔴 | NO-GO | — |
| iOS build pipeline | aucun | 🔴 | NO-GO | — |
| `useCapacitorInit`, splash, status bar, hardware back btn | aucun | 🔴 | NO-GO | — |
| `mobileStore` Zustand, `useMobileAuth`, `useSessionTimeout` | aucun (POS a `useIdleTimeout` global) | 🔴 | NO-GO | — |
| MobileLoginPage, MobileHomePage, MobileCatalogPage, MobileCartPage, MobileOrdersPage, ProfilePage | aucun | 🔴 | NO-GO | — |

**Recommandation** : si BYOD serveur est nécessaire, **tablette Android existante (module 17) suffit**. Si gérant mobile veut consulter reports en déplacement, **PWA installable sur iOS Safari + Android Chrome répond au besoin** sans Capacitor. 6 backlog items TASK-18-001..006 sont tous BLOCKED depuis S14.

### Module 19 — Settings

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| SettingsHubPage | `pages/settings/SettingsHubPage.tsx` | ✅ | — | — |
| SettingsGeneralPage (Company, BusinessHours) | `pages/settings/SettingsGeneralPage.tsx` | ✅ | — | — |
| SettingsHolidaysPage | `pages/settings/SettingsHolidaysPage.tsx` | ✅ | — | — |
| SettingsEmailTemplatesPage | `pages/settings/SettingsEmailTemplatesPage.tsx` | ✅ | — | — |
| SettingsReceiptTemplatesPage | `pages/settings/SettingsReceiptTemplatesPage.tsx` | ✅ | — | — |
| SettingsPermissionsPage | `pages/settings/SettingsPermissionsPage.tsx` | ✅ | — | — |
| SecuritySettingsPage (PIN + session timeout per role) | `pages/settings/security/SecuritySettingsPage.tsx` (S19) | ✅ | — | — |
| **Tax (PB1 10%, mode inclus, comptes 2110/2143)** | — | 🔴 | **S29.5 proposé** | **P0** (sinon édition SQL) |
| **Payment Methods (toggle Cash/Card/QRIS/GoPay/etc + ordre + commissions + compte JE)** | — | 🔴 | **S29.5 proposé** | **P0** |
| Loyalty Program config (ratio, paliers, bonus anniv, expiration) | — | 🔴 | Post-S30 (Loyalty Engagement) | P1 |
| Inventory Configuration (seuils, FIFO, fractions) | — | 🔴 | Post-S30 (Settings UX Uplift) | P2 |
| Product Categories admin (couleurs, ordre — distinct du `categories.read` BO) | (livré S27b sous `/backoffice/categories`) | ✅ | — | — |
| Product Types | — | 🔴 | Post-S30 | P3 |
| **KDS Configuration (stations actives, seuils couleur, sons, auto-remove, layout, police)** | — | 🔴 | **S29.5 proposé** ou Post-S30 (KDS Station Admin) | **P0** |
| **Customer Display Configuration** | — | 🔴 | **S29.5 proposé** | **P1** |
| B2B Settings | `pages/btob/B2BSettingsPage.tsx` | ✅ | — | — |
| Printing config + routage | — | 🔴 | Post-S30 (Settings UX Uplift) | P1 |
| Notifications scheduler (stock bas matin 7h) | — | 🔴 | Post-S30 | P2 |
| Financial / Accounting config (COA mappings) | `pages/accounting/MappingsPage.tsx` | ✅ | — | — |
| Roles & Permissions admin (clonage, suppression) | `pages/users/PermissionsMatrixPage.tsx` | ✅ | — | — |
| Audit Log viewer (settings.audit) | (via `pages/reports/AuditPage.tsx`) | ✅ | — | — |
| LAN Network diag | (à vérifier — feature LAN existe) | 🟡 | Post-S30 (LAN Reliability) | P2 |
| Network Devices register | `pages/lan-devices/LanDevicesPage.tsx` (S17) | ✅ | — | — |
| Settings History (rollback) | — | 🔴 | Post-S30 | P2 |
| Floor Plan layout DnD | (`features/floor-plan/` côté POS) | ✅ (à vérifier édition admin) | — | — |
| Sections admin | `pages/inventory/SectionsPage.tsx` | ✅ | — | — |
| Approval workflows configurables | — | 🔴 | Post-S30 | P2 |
| Pricing horaire (happy hour) | — | 🔴 | Post-S30 | P2 |
| Templates tickets éditables (déjà partiellement via ReceiptTemplatesPage) | (✅) | ✅ | — | — |
| Multi-boutique scoping | — | ❌ WONTFIX (mono-site permanent) | — | — |
| Export/Import config JSON | — | 🔴 | Post-S30 | P3 |
| Wizard installation | — | 🔴 | jamais | P3 |
| Multi-devise | — | ❌ WONTFIX | — | — |

### Module 20 — Users & RBAC

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| UsersListPage filtres + stats | `pages/users/UsersListPage.tsx` | ✅ | — | — |
| NewUserPage + UserDetailPage | `pages/users/{NewUserPage,UserDetailPage}.tsx` | ✅ | — | — |
| PermissionsMatrixPage (rôles × ~70 perms) | `pages/users/PermissionsMatrixPage.tsx` | ✅ | — | — |
| PIN reset par manager | `reset_user_pin_v1` RPC | ✅ | — | — |
| Soft delete utilisateur | (audit chain) | ✅ | — | — |
| Roles CRUD + cloner | (présent — à vérifier UI complète) | 🟡 | Post-S30 (Bulk Users + RBAC Templates) | P2 |
| Bulk users CSV | — | 🔴 | Post-S30 (Bulk Users + RBAC Templates) | P2 |
| `is_system` rôles verrouillés (Owner) | (verrouillé en RPC) | ✅ | — | — |
| Audit log nominatif | `audit_logs` table | ✅ | — | — |
| Cleanup users | — | 🔴 | Post-S30 | P3 |
| Export annuaire PDF/Excel | — | 🔴 | Post-S30 | P3 |

### Module 21 — LAN Architecture

| Sub-feature V2 | V3 path | Statut | Session | Priorité |
|---|---|---|---|---|
| LAN hub + client + heartbeat 30s | `features/lan/` | ✅ | — | — |
| Dedup TTL 5s (S13 + S21 GC tests) | ✅ | — | — | — |
| Channel `breakery-lan` BroadcastChannel + Realtime fallback | ✅ | — | — | — |
| KDS handler granulaire | — | 🔴 | Post-S30 (LAN Reliability) | P2 |
| Zombie cleanup | — | 🔴 | Post-S30 (LAN Reliability) | P2 |
| Diagnostics UI | — | 🔴 | Post-S30 (LAN Reliability) | P2 |
| Multi-LAN segmentation | — | ❌ WONTFIX (mono-LAN permanent, ratifié 2026-05-19) | — | — |

---

## Findings

### 🔴 Critiques (bloque prod V3)

| ID | Module | Finding | Impact |
|---|---|---|---|
| **VC-01** | 10 Accounting | Trial Balance, General Ledger, Journal Entries (saisie manuelle), Chart of Accounts **absents** — `MappingsPage` est la seule page accounting livrée. | **Audit comptable externe impossible**. Le comptable indonésien qui demande "donne-moi la balance au 30 avril" doit recevoir un export SQL brut. Inacceptable pour PME en règle SAK EMKM. |
| **VC-02** | 11 Expenses | `ExpenseFormPage` métier incomplet (à vérifier complétude vs vision V2 10 champs : date, catégorie, description, montant, fournisseur, méthode, date paiement, ref, justificatif, notes). `ExpenseCategoriesPage` absent → catégories en seed.sql, non éditables en UI. | Saisie quotidienne de dépense impossible sans dev. Loyer mensuel, électricité, emballages → tous en SQL aujourd'hui. |
| **VC-03** | 19 Settings | Tax (PB1 10%) + Payment Methods + KDS Configuration + Customer Display Configuration **absents en UI**. | Modifier le taux PB1 si le gouvernement le change = migration SQL. Désactiver QRIS si panne machine = SQL. Configurer la KDS station seuils = SQL. **Non-négociable pour passer en prod**. |
| **VC-04** | 12 Cash + 14 Reports | **Z-Report PDF absent**. Générer au `close_shift_v1`, stocker bucket Storage `zreports/`, retention 7 ans, signature manager PIN. | **Obligation légale Indonésie 7 ans archive comptable**. Sans Z-Report PDF signé, audit fiscal impossible. |
| **VC-05** | 02 POS / 17 Tablet | **Bug `order_items.name_snapshot`** (audit Vague 1 C-01) : `apps/pos/src/features/tablet/hooks/useMyTabletOrders.ts:31` sélectionne `name` au lieu de `name_snapshot` → **HTTP 400 PostgREST garanti à l'exécution**. | Page TabletOrdersPage cassée. Fast-follow immédiat avant cutover. |
| **VC-06** | 16 Display | **Bug enum drifté `'take_away'`** (audit Vague 1 C-02) : 3 occurrences testant `order_type === 'take_away'` alors que enum DB est `'take_out'`. | Branche morte silencieuse — pour les pickup orders, l'UI affiche la valeur brute. Renommer 3 occurrences. |

### 🟠 Élevés (impact business immédiat post-cutover)

| ID | Module | Finding | Impact |
|---|---|---|---|
| **VH-01** | 14 Reports | **~48 reports manquants** dont 10 P0 (Daily Sales, Product Sales By SKU, Gross Margin, Wastage, Expired Stock, Purchase By Supplier, Outstanding Payment AP, Payment By Method, VAT Tax Report, B2B Receivables Aging). | Pilotage business à l'aveugle post-cutover. Le gérant ouvre Reports → 13 reports sur 61. **S29 prioritaire**. |
| **VH-02** | 02b Orders BO | **Page Orders BO Control Tower absente** (juste route placeholder). Pas de filtres status/type/payment, pas de KPI strip, pas de modal détail commande BO. | Manager ne peut pas piloter le service en cours. Tout passe par le POS history limité. |
| **VH-03** | 10 Accounting | **FiscalPeriodModal absent** alors que RPC + table existent depuis S17. | Période fiscale jamais clôturée = tout modifiable rétroactivement. Risque comptable majeur. |
| **VH-04** | 09 B2B | Liste des commandes B2B `/b2b/orders` + détail 4 onglets (Items/Deliveries/Payments/History) **absents**. Génération facture PDF B2B (EF `generate-invoice` + bucket Storage) **absente**. | B2B Foundation S24 a livré le dashboard + payments mais pas le workflow commande complet. Hôtel qui demande sa facture officielle = blocage. |
| **VH-05** | 11 Expenses | Workflow approval seuils + sync `payment_method='cash'` ↔ `pos_sessions.cash_out_total` **absents**. | Cash sortie de caisse pour expense non réconciliée → écart de caisse à la clôture. |
| **VH-06** | 14 Reports + 19 Settings | **8 reports audit fraude P0 absents** : Permission Change Log, Void & Discount Abuse, Cash Variance Trend, Unusual Transaction Patterns, B2B Self-Approval Risk. | Sweethearting / fraude staff non détectable à l'usage normal. |
| **VH-07** | 02 POS | **Mode dégradé offline absent**. Une coupure courte = ventes bloquées. | Bali ISP fluctuant — 1-2 coupures/semaine attendues. POS Cart Hardening post-S30. |
| **VH-08** | 08 Customers | CustomerDetailPage (vue 360°) + `parent_customer_id` dedup + merge UI **absents**. | Doublons clients s'accumulent. Vue commerçant pour préparer rendez-vous B2B = impossible. |

### 🟡 Moyens (qualité/ergonomie/polish)

| ID | Module | Finding | Impact |
|---|---|---|---|
| **VM-01** | 14 Reports | Drill-down avec breadcrumb absent. | Ping-pong entre reports pour suivre un fil. |
| **VM-02** | 04 KDS | Service Speed report, Throttling intelligent, Mode urgences, Reroute manuel absents. | KDS opérationnel mais sans observability. |
| **VM-03** | 16 Display | display_promotions UI admin + ORDER_READY notification + animations fidélité absents. | Display fonctionne mais Idle mode peu valorisé. |
| **VM-04** | 17 Tablet | Queue offline complète (IndexedDB + sync) S25 partial — second half deferred. | Coupure LAN = tablet bloquée (Bali OK généralement). |
| **VM-05** | 21 LAN | Diagnostics UI, KDS handler granulaire, Zombie cleanup. | Dépannage LAN = inspection logs. |
| **VM-06** | 02b Orders BO | Bulk actions, heatmap, calendrier réservations, lien direct KDS. | Tous Control Tower S2. |
| **VM-07** | 19 Settings | Loyalty Program config UI absent (paliers seedés, modification SQL). | Tier upgrade fonctionne mais paramétrage = dev. |
| **VM-08** | 19 Settings | Printing config + routage absent. | Impression OK via templates mais routage hardcoded. |
| **VM-09** | Multiple | Auto-S28-style approval workflows configurables (expenses, void, refund, discount, settings) absents. | Approval en code RPC, pas configurable en UI. |
| **VM-10** | Multiple | Closing checklist mensuelle workflow absent. | Comptable doit se rappeler des étapes. |

### 🟢 Bas (info, WONTFIX, déjà déféré)

| ID | Module | Statut | Note |
|---|---|---|---|
| **VL-01** | 08 Customers | ❌ WONTFIX | Multi-établissement loyalty (mono-site permanent — ratifié 2026-05-19) |
| **VL-02** | 10 Accounting | ❌ WONTFIX | Consolidation multi-entité (pas de 2e entité juridique prévue) |
| **VL-03** | 19 Settings | ❌ WONTFIX | Multi-tenancy foundation (`store_id` propagation inutile) |
| **VL-04** | 21 LAN | ❌ WONTFIX | Multi-LAN segmentation (channel non scopé OK) |
| **VL-05** | 15 Production / Display / Receipt | ❌ WONTFIX | Allergens UI (décision user 2026-05-17 — memory `project_allergens_wontfix`) |
| **VL-06** | 18 Mobile Shell | ❌ WONTFIX recommandé | 0 dépendance Capacitor, 6 tasks BLOCKED depuis S14, PWA suffit |
| **VL-07** | 02/07/10/11/15/19 | ❌ WONTFIX | Multi-devise (IDR-only, mono-pays) |
| **VL-08** | 02/09/14/19 | ❌ WONTFIX | A/B testing intégré (out of scope V3) |
| **VL-09** | 02/13 | ❌ WONTFIX | Voice search, NFC, IoT four (jamais — hors scope V3) |
| **VL-10** | 04 KDS | ❌ WONTFIX | Reconnaissance vocale, caméra QC (jamais) |
| **VL-11** | 09 B2B | ❌ WONTFIX | Portal client B2B self-service (out of scope V3) |

---

## Plan de finition consolidé S26→S30 (validé + ajusté)

### Ajustement global

**Réordonner la séquence ainsi** :

```
S26 Comptable Cockpit (10 pages)
  ↓ dépend du S24 view_ar_aging (déjà livré ✅)
S27 (DONE — Product CRUD + Categories) + S27b (DONE — create + categories DnD)
S28 Expense Governance — RECOMMANDÉ AVANT S29
  ↓ rationale : S28 livre ExpenseFormPage + ExpenseCategoriesPage qui sont prérequis du Reports Expenses by Date P0 (S29)
S29 Reports Export + Z-Report PDF (focus top 10 P0 sur ~48 manquants)
S29.5 Settings Critical (NOUVEAU — proposé)
  ↓ rationale : 4 pages settings P0 (Tax, Payment Methods, KDS Config, Display Config) sans lesquelles cutover prod = édition SQL
S30 Decision Sprint + Cleanup
  - Mobile Shell GO/NO-GO : recommandation NO-GO formelle
  - Settings restantes (printing, notifications, loyalty config, settings history)
  - WONTFIX formalisés (allergens UI, multi-site/tenant/LAN/loyalty)
  - ADR-003 statut PKP (débloque/enterre I1/I2/I3)
  - ADR-004 multi-currency (probable WONTFIX confirmé)
  - Cleanup doc référence Partie II
  - Module 02b Orders BO doc + spec (page Control Tower → Post-S30 sessions S1+S2)
```

### S26 — Comptable Cockpit (10 pages) — **P0**

**Effort** : L (2 jours)
**Migration block** : `20260603000010..030`

**Pages BO à livrer (ordre suggéré)** :
1. **ChartOfAccountsPage** (`/accounting/chart-of-accounts`) — viewer + edit COA, AccountModal create/edit, AccountTree hierarchy display
2. **JournalEntriesPage** (`/accounting/journal-entries`) — viewer + `JournalEntryForm` manuelle (RPC `create_manual_je_v1` SECURITY DEFINER avec PIN gate + period check + balanced validation)
3. **GeneralLedgerPage** (`/accounting/general-ledger`) — drilldown par compte avec pagination cursor-based + filtres période/contrepartie/montant + export CSV/PDF
4. **TrialBalancePage** (`/accounting/trial-balance`) — RPC `get_trial_balance_v1(p_start, p_end)` + filtre par classe + export CSV/PDF
5. **ARAgingPage** (`/accounting/ar-aging`) — consomme `view_ar_aging` (S24 ✅) + CSV/PDF + drilldown par client
6. **VATManagementPage** (`/accounting/vat-management`) — consomme `calculate_vat_payable_v1` (S13 livré sans consumer ✅) + génération déclaration PB1 mensuelle PDF + marquage "déclaré+payé"
7. **FiscalPeriodModal** — RPC + table déjà existants S17 ✅ → juste UI (Open/Close/Reopen périodes + gate des écritures)
8. **BankReconciliationPage + ReconciliationDetailPage** (`/accounting/bank-rec` + `/accounting/bank-rec/:id`) — CSV/Excel upload + bankStatementParser + auto-match + ManualMatchModal + AdjustmentForm + validation finale (P1, peut être pris en S26b si débordement)
9. **CALKPage** (`/accounting/calk`) — éditeur structuré (`calkService`) avec sections pré-remplies + commentaires narratifs (P1)

**RPCs à créer** :
- `create_manual_je_v1(p_date, p_journal, p_description, p_ref, p_lines jsonb, p_pin text)` SECURITY DEFINER + balance check + period check
- `get_trial_balance_v1(p_start date, p_end date)` SECURITY DEFINER + SQL aggregate

**Re-route** : `BalanceSheetPage` + `ProfitLossPage` accessibles aussi sous `/accounting/*` en plus de `/reports/*`.

**Closes** : VC-01, VH-03.

### S28 — Expense Governance (RECOMMANDÉ AVANT S29) — **P0**

**Effort** : M (1 jour)
**Migration block** : `20260605000010..020`

**Deliverables** :
- **ExpenseFormPage complétée** (`/expenses/new` existe en route mais vérifier complétude 10 champs vision V2 : date, catégorie, description, montant, fournisseur, méthode, date paiement, ref facture, justificatif upload Supabase Storage bucket `expense-receipts`, notes)
- **ExpenseCategoriesPage** (`/settings/expense-categories` ou `/expenses/categories`) CRUD admin (perm `expenses.categories.manage` ou `settings.update`)
- Table `expense_thresholds(category_id, max_amount, requires_role[])` + seed cohérent (seuil_1 / seuil_2 / seuil_3 par catégorie)
- Modif `approve_expense_v1` : block `approver = creator` (separation of duties) + validation chaîne approval selon seuil
- Sync `expense.payment_method='cash'` ↔ `pos_sessions.cash_out_total` (trigger ou hook RPC `record_cash_movement_rpc`)
- Workflow `Draft → Approved → Paid` + rejet avec raison obligatoire
- Tests pgTAP séparation tâches
- Bouton "Clone" sur ExpenseDetailPage (loyer mensuel duplication)

**Closes** : VC-02, VH-05.

### S29 — Reports Export + Z-Report PDF — **P0**

**Effort** : L (2 jours)
**Migration block** : `20260606000010..020`

**Deliverables — EF generic** :
- **EF `generate-pdf` générique réutilisable** (puppeteer ou pdf-lib + headers The Breakery + filigrane + IDR rounding 100)
- **EF `generate-zreport-pdf` spécifique** appelée au `close_shift_v1`

**Deliverables — Storage** :
- Bucket Storage `zreports/` + retention 7 ans policy + RLS authenticated read manager+
- Signature manager via PIN dans le PDF (audit chain)

**Top 10 P0 reports à livrer** :
1. **Daily Sales** — courbe + table chronologique + CSV/PDF
2. **Product Sales By SKU** — Pareto + filtres catégorie/période + CSV/PDF
3. **Gross Margin by Product** — Revenue − coût matière (consomme `recipe_bom_full_v1` ✅) + CSV/PDF
4. **Wastage & Spoilage** — par jour, par produit, taux + CSV/PDF
5. **Expired Stock** — alerte sanitaire (lots tracés FIFO)
6. **Purchase By Supplier** — top fournisseurs + tendance prix
7. **Outstanding Payment (AP)** — créances fournisseur impayées (créer view `view_ap_aging` similaire à `view_ar_aging` S24)
8. **Payment By Method** — cash/card/QRIS/e-wallet répartition + commissions
9. **VAT / Tax Report** — PB1 collecté mensuel (déclaration ready)
10. **B2B Receivables Aging** — consomme `view_ar_aging` ✅ S24 + CSV/PDF

**Bonus si débordement S29b** :
- Sales Cash Balance (réconciliation cash session — fraude détection)
- Permission Change Log + Void & Discount Abuse + Cash Variance Trend (audit fraude P0)

**Comparison vs previous period** (TASK-14-005 partial) sur les top 10 P0.

**Closes** : VC-04, VH-01, VH-06.

### S29.5 — Settings Critical (NOUVEAU — proposé) — **P0**

**Effort** : M (1 jour)
**Migration block** : `20260606500010..020` (ou inséré dans S29)

**Deliverables** :
- **SettingsTaxPage** (`/settings/tax`) — PB1 nom + 10% taux + mode `inclus` + comptes 2110/2143 + audit log
- **SettingsPaymentMethodsPage** (`/settings/payment-methods`) — toggle activation Cash/Card/QRIS/GoPay/OVO/DANA/Bank/B2B credit/Outstanding + ordre + libellé + icône + frais + compte JE débit
- **SettingsKDSPage** (`/settings/kds`) — stations actives (hot_kitchen/barista/display) + seuils couleur (vert<3min, orange<7, rouge<12) + sons par station + auto-remove delay + layout grille H/V + police
- **SettingsDisplayPage** (`/settings/display`) — idle timeout + promo rotation interval + show ready orders toggle + sound on ready + welcome message + theme + show wifi QR + show fidélité animation

**RPCs/table** : 4 wrappers `update_*_settings_v1` SECURITY DEFINER + audit_logs trigger sur `settings.update`.

**Closes** : VC-03.

### S30 — Decision Sprint + Cleanup — **P1/P2 mixte**

**Effort** : M (1 jour)
**Migration block** : `20260607000010..099` (réservé, probablement non utilisé)

**Deliverables — Décisions ratifiées + ADRs** :
- **ADR-002** : Mobile Shell **NO-GO recommandé** (PWA-only suffit pour mono-site Bali ; 0 Capacitor dans repo ; 6 tasks BLOCKED depuis S14)
- **ADR-003** : statut PKP The Breakery → débloque ou enterre I1/I2/I3 (compliance fiscale e-Faktur)
- **ADR-004** : Multi-currency activation → WONTFIX confirmé (mono-pays IDR)
- **WONTFIX formalisés** :
  - Allergens UI (DEV-S15-5.C-01 — memory `project_allergens_wontfix`)
  - Multi-établissement loyalty (TASK-08-011)
  - Consolidation multi-entité (TASK-10-020)
  - Multi-tenancy settings foundation (TASK-19-008)
  - Multi-LAN segmentation (TASK-21-011)
  - Capacitor mobile shell (TASK-18-001..006)

**Deliverables — Cleanup** :
- Module 15 : status notes des 8 items marqués TODO/BLOCKED/PARTIAL alors DONE depuis S15-S17 (rebase batch — déjà acté dans S24-S30 plan §6)
- Doc référence Partie II : `02b-orders.md` (page BO orders absente — Post-S30 sessions S1+S2), `18-mobile-shell.md` (toute la doc capacitor → marquer WONTFIX), `10-accounting-double-entry.md` (rebase post-S26 — 10 pages livrées)
- Sweep `select('*')` : ~14 occurrences identifiées par audit Vague 1 → remplacement par columns explicites
- Roadmap globale refresh post-S29.5
- Fix audit Vague 1 critique VC-05 (`order_items.name_snapshot` rename) + VC-06 (3× `take_away → take_out`) — peut être fait pré-S26 fast-follow

**Deliverables — Settings restantes (P2)** :
- **SettingsLoyaltyPage** — ratio + paliers + bonus anniv + expiration
- **SettingsInventoryPage** — seuils + FIFO + fractions
- **SettingsPrintingPage** — imprimantes + routage
- **SettingsNotificationsPage** — canaux + seuils + scheduler
- **SettingsFinancialPage** — numérotation JE + comptes par défaut + premier mois fiscal
- **SettingsHistoryPage** — `audit_logs` filtrés `action='setting.update'` + rollback manuel (consultation seulement, pas auto-revert)

### Sessions ajoutées proposées (post-S30, séquence flexible)

| Session candidate | Items | Effort |
|---|---|---|
| **S31 Orders BO Control Tower S1** (TASK-02-011+012+014 + 5 KPI strip) | Filtre cashier + bulk paid + mes commandes + KPI strip | L |
| **S32 Orders BO Control Tower S2** (TASK-02-013+015..019) | Heatmap + toast + édition + calendar + PDF + KDS link | XL |
| **S33 Customer Detail + Dedup** (TASK-08-003+004 + CustomerDetailPage + merge UI) | Vue 360° + parent_id + phone normalization + merge | L |
| **S34 Loyalty Engagement** (TASK-08-001+002+007) | Tier upgrade + expiration cron + analytics | M |
| **S35 KDS Observability** (TASK-04-009 + colonnes ack/preparing + RPC dédiée) | Service speed page + observability | L |
| **S36 KDS Robustness LAN** (TASK-04-001+006+010) | ACK badge + reconnect banner + throttle | L |
| **S37 KDS Station Admin** (TASK-04-002 + page BO `/settings/kds-stations` + DnD) | Station admin page | M |
| **S38 Supplier Ops + AP Aging + PO PDF** (TASK-07-003+004+005+009+010 + SupplierDetail enrichi) | QC reject + scoring + AP aging view + email + PDF | L |
| **S39 Tablet Offline Complete** (TASK-17-001 second half) | IndexedDB queue + sync RPC | XL |
| **S40 Display Admin Config** (TASK-16-001+002+003+007) | Promotions + transitions + sync + ready board | L |
| **S41 Promo Stacking + Coupons** (TASK-13-002+003+005+009) | Stacking + coupons sérialisés + segments + QR | L |
| **S42 Bulk Users + RBAC Templates** (TASK-20-003..006+016) | CSV + is_system + diff + cleanup + export | L |
| **S43 LAN Reliability** (TASK-21-002+005+009) | KDS handler + zombie cleanup + diag UI | L |
| **S44 Reports UX Uplift** (TASK-14-009+013+016) | Drilldown + unusual + perishable turnover | L |
| **S45 Settings UX Uplift** (TASK-19-003+004+009+011) | zod + export/import + history UI + notif scheduler | L |
| **S46 Defense-in-depth RBAC** (TASK-20-010+011+013) | Escalade detection + four-eyes + sessions UI | XL |
| **S47 Closeout & Period Lock** (TASK-10-011 UI + 10-016 + 10-009 bank reco MVP) | Fiscal periods UI + month-close + bank reco MVP | L |
| **S48 Shift Robustness** (TASK-12-005+006+008+009) | Handover + auto-close + dual-auth + bank deposit | M |
| **S49 POS Cart Hardening** (TASK-02-003+005+006+009) | Perf + reprice + draft DB + Cmd+K | L |
| **S50 Inventory Polish** (TASK-06-007+009 + cost_correction report) | Ghost stock + POS quick-waste + cost correction | M |
| **S51 B2B Quotes + Recurring** (devis + abonnements + relances + Self-Approval Risk) | Workflow complet B2B | XL |

**Total post-S30 estimé** : ~21 sessions = **4-6 mois à cadence S22** (1 session tous les 1-3 jours).

---

## WONTFIX à confirmer avec le propriétaire

Liste consolidée des décisions WONTFIX déjà partiellement ratifiées 2026-05-19 + nouvelles propositions à confirmer.

| ID | WONTFIX | Module(s) | Justification | À ratifier ? |
|---|---|---|---|---|
| W-01 | Multi-établissement loyalty | 08 | Mono-site permanent Bali | ✅ déjà ratifié 2026-05-19 |
| W-02 | Consolidation multi-entité | 10 | Pas de 2e entité juridique prévue | ✅ déjà ratifié 2026-05-19 |
| W-03 | Multi-tenancy settings foundation | 19 | `store_id` propagation inutile | ✅ déjà ratifié 2026-05-19 |
| W-04 | Multi-LAN segmentation | 21 | Channel non scopé OK | ✅ déjà ratifié 2026-05-19 |
| W-05 | Allergens UI structurés | 15 / 16 / receipt | Décision user 2026-05-17 (memory `project_allergens_wontfix`) — pas d'allergens module | ✅ déjà ratifié |
| W-06 | **Mobile Shell Capacitor** (apps/mobile + iOS + Android APK + plugins natifs) | 18 | 0 dépendance Capacitor dans repo, 0 page mobile, PWA installable sur iOS Safari + Android Chrome suffit pour BYOD serveur + gérant mobile reports | 🔴 **À ratifier en S30 (ADR-002)** |
| W-07 | **Multi-currency** (USD pour expat, multi-devise B2B) | 02 / 07 / 10 / 11 / 15 / 19 | Mono-pays Indonésie IDR, pas de tourisme grossiste prévu | 🔴 **À ratifier en S30 (ADR-004)** |
| W-08 | A/B testing intégré (visuel + promos + display) | 13 / 16 | Out of scope V3, cas d'usage absent | 🟡 à confirmer |
| W-09 | Voice search POS + reconnaissance vocale KDS | 02 / 04 | Out of scope V3, hardware déjà déterminé tactile | 🟡 à confirmer |
| W-10 | NFC, IoT four, caméra QC | 02 / 04 / 15 | Out of scope V3, hardware déjà déterminé | 🟡 à confirmer |
| W-11 | Portal client B2B self-service | 09 | Out of scope V3, équipe commerciale traite manuellement | 🟡 à confirmer (mais probable WONTFIX) |
| W-12 | Programme parrainage automatisé | 08 | Out of scope V3 | 🟡 à confirmer |
| W-13 | App mobile dédiée client (fidélité) | 08 / 16 | QR code imprimé suffit | 🟡 à confirmer (mais probable WONTFIX) |
| W-14 | Custom report builder drag&drop | 14 | Out of scope V3 (TASK-14-007), rapport sur mesure = dev | 🟡 à confirmer |
| W-15 | Scheduled reports email | 14 | Out of scope V3 (TASK-14-008) | 🟡 à confirmer |
| W-16 | Wizard installation guidé | 19 | Onboarding = dev only, pas grand public | 🟡 à confirmer |

---

## Améliorations V3 à conserver (gains nets vs V2)

Liste mise à jour des **améliorations V3 au-delà du cahier des charges V2**, basée sur le glossaire §6 + ajouts découverts pendant l'audit.

| # | Amélioration V3 | Statut | Session origine | Impact business |
|---|---|---|---|---|
| 1 | **Idempotency cross-EF** (`idempotency_keys` + client_uuid + replay envelope + 2 flavors HTTP/RPC) | LOCKED | S25 | Anti-double-débit refund, anti-double-création tablet order |
| 2 | **GRANT hardening defense-in-depth** (REVOKE anon tables/views/functions + ALTER DEFAULT PRIVILEGES) | LOCKED | S20 | Defense post-RLS, anti-bypass-RLS via PUBLIC inheritance |
| 3 | **Sub-recipes complet** (anti-cycle 5-niveaux, BOM cascade, batch yield-aware, recipe_versions snapshot avec cost) | LOCKED | S15+S17+S19+S21 | Pâte feuilletée → croissants ET pains au choco ET chaussons en 1 prod |
| 4 | **WAC `update_cost_price_v1` + landed cost pro-rata** (shipping coast cascade ancêtres recursive) | LOCKED | S17+S23+S26 | Coût matière auto-recalculé à chaque réception PO |
| 5 | **RLS helpers `has_permission()` v7** (SECURITY DEFINER + cache) | LOCKED | S13+S17 refactor | RBAC propre, perf O(1) |
| 6 | **Rate limiting durable Postgres** (`record_rate_limit_v1` + pg_cron purge + 5 EFs câblés) | LOCKED | S19 | Anti-bruteforce PIN + EFs sensitives |
| 7 | **Playwright E2E nightly cron** | LOCKED | S21 | Régression smoke quotidienne |
| 8 | **Focus-trap Radix ESLint lock-in** (`no-raw-modal-overlay`) | LOCKED | S22 | A11y conforme + verrouillage architectural |
| 9 | **Recipe versioning + snapshot avec cost** | LOCKED | S20+S21 | Historique recettes traçable, marge analysable dans le temps |
| 10 | **Margin alerts pg_cron recompute** | LOCKED | S19 | Alerte automatique baisse marge produit |
| 11 | **Baker's percentages** | LOCKED | S19 | Recettes en % de farine pour boulangers traditionnels |
| 12 | **Production scheduling suggestions** (`suggest_production_schedule_v1`) | LOCKED | S19 | Pull au lieu de push, anticipation production matin |
| 13 | **Customer birthday cron pg_net** | LOCKED | S21 | Email/notification anniversaire client auto |
| 14 | **Cash Flow 3 sections** (Operating/Investing/Financing) | LOCKED | S21 | Au-delà du V2 (Operating-only) — conformité SAK EMKM |
| 15 | **Recipe cost history v1** | LOCKED | S22 | Tendance coût recette par version |
| 16 | **PIN/auth secrets en header HTTP** (jamais en body JSON) | LOCKED | S25 | Anti-log-leak PostgREST/pgaudit |
| 17 | **B2B Foundation** (`view_b2b_invoices`, `view_ar_aging`, `record_b2b_payment_v1`, `validate_b2b_credit_limit_v1` câblé) | LOCKED | S24 | KPI aging réel (pas proxy `last_visit_at`) |
| 18 | **312 migrations monotonic timestamp + 0 doublon** | LOCKED | continu S1→S27b | Schema lineage auditable |
| 19 | **`pg_trgm` GIN indexes on `products.name`/`sku`** + trigram ranking in `search_ingredients_v1` | LOCKED | S16 | Search ingredients perf O(log n) au lieu de O(n) |
| 20 | **`products.is_semi_finished` boolean flag + maintenance trigger** | LOCKED | S16 | Identification recettes intermédiaires |

---

## Décisions business à prendre

### Décision 1 — Mobile Shell : GO ou NO-GO ?

**Recommandation : NO-GO**.

**Contexte** :
- 0 dépendance `@capacitor/*` dans `package.json` (apps/pos et apps/backoffice)
- 0 page `/mobile/*` dans `apps/`
- 0 dossier `apps/mobile/`
- 6 tâches TASK-18-001..006 toutes BLOCKED depuis S14 (1 an)
- Doc `docs/reference/04-modules/18-mobile-shell.md` aspirationnelle (décrit ce qui *serait* à faire)
- App store cible probablement : Google Play Indonésie (compte développeur Indonésie nécessaire) + éventuellement Apple App Store ($99/an)

**Alternatives PWA pour les use cases mobile** :
- **Serveur BYOD pour prise commande salle** → tablette Android déjà couverte par module 17 (Tablet Ordering ✅ DONE)
- **Gérant mobile reports en déplacement** → PWA installable iOS Safari + Android Chrome (déjà fonctionnel sur le code Vite actuel)
- **Cashier mobile pour caisse mobile événement** → Tablette Android avec le POS web fullscreen suffit

**Si malgré tout GO** : effort estimé ~XL session unique (Capacitor port + 3 plugins natifs + 6 pages mobile + CI Android + signature keystore) = 2-3 semaines wall-time minimum + maintenance plug-ins continue.

**Question business à trancher** : *"Y a-t-il un cas d'usage métier réel pour une vraie app native (push notifications natives, NFC, capteurs Android) que la PWA ne couvre pas ?"* — Si non → NO-GO.

### Décision 2 — Statut PKP The Breakery (ADR-003)

**Contexte** : I1 Faktur Pajak / I2 e-Faktur / I3 DJP integration sont BLOCKED tant que ce statut n'est pas confirmé. Le module Accounting actuel gère **PB1** (Pajak Restoran 10% local restaurant tax) — **pas la PPN/TVA nationale**.

**Question business à trancher** : *"The Breakery est-elle assujettie à la PPN (besoin Faktur Pajak / e-Faktur officiels) ou seulement à la PB1 locale 10% ?"*

**Si PKP confirmé** → débloque programme XL (S31++) sur e-Faktur. **Si non-PKP** → I1/I2/I3 enterrés définitivement, module Accounting actuel suffit + Tax PB1 settings (S29.5) ferme la boucle.

### Décision 3 — Prod cutover : quels gaps sont vraiment bloquants ?

**Recommandation** : exiger 5 livrables avant cutover prod.

| Livrable | Session | Pourquoi bloquant |
|---|---|---|
| 1. Comptable Cockpit (10 pages dont Trial Balance + GL + JE + Fiscal Periods) | **S26** | Audit comptable externe impossible sans |
| 2. Expense Governance (ExpenseFormPage + Categories + workflow + sync cash) | **S28** | Saisie quotidienne sans dev |
| 3. Reports Top 10 P0 + Z-Report PDF + EF generic | **S29** | Pilotage + obligation légale 7 ans archive |
| 4. Settings Critical (Tax + Payment Methods + KDS + Display) | **S29.5** | Paramétrage business courant sans SQL |
| 5. Bug fixes audit Vague 1 (C-01 `name_snapshot` + C-02 `take_away`) | **fast-follow** | Bugs runtime déjà identifiés |

**Total wall-time avant cutover** : ~8 jours (~3-4 semaines à cadence S22). Tout le reste (Orders BO Control Tower, B2B Quotes, Mobile Shell, etc.) → **Post-S30 backlog confortable**.

---

## Annexes

### Annexe A1 — Détail par fiche objectif travail (16 fiches)

| Fiche V2 | Lignes | Sections "backlog métier" | Items P0 V2 (rouge) | Items P1 V2 (orange) | Mapping V3 |
|---|---|---|---|---|---|
| POS.md | 372 | §18 | Mode offline, Pre-auth carte | Réservation, Vue Tables ouvertes, Quick reorder | 🟢 DONE backbone + 7 polish post-S30 |
| ORDERS.md | 305 | §14 | Filtre cashier, Bulk actions | Heatmap, "Mes commandes", Toast riche | 🟡 PARTIEL — Page Orders BO absente, sessions S1+S2 post-S30 |
| KDS.md | 287 | §16 | Service Speed report, Throttling intelligent | Chat inter-stations, Mode urgences, Reroute | 🟢 DONE (4 stations + LAN + sound) + 4 sessions post-S30 |
| ACCOUNTING.md | 354 | §18 | E-Faktur (PKP-conditional), Amortissement | Closing checklist, Budget vs réel, Export Accurate/MYOB | 🔴 MAJEUR — 4/11 pages, S26 covers |
| B2B.md | 371 | §16 | Auto-approval workflow, Détection self-approval | Récurrentes/abonnements, Relances auto, Devis quote | 🟡 PARTIEL — S24 Foundation, post-S30 sessions |
| CASH_REGISTER.md | 289 | §15 | Cash-in/out en session, Validation deux mains | Dépôt bancaire, Compte coupures, Alerte écart temps réel | 🟢 DONE + Z-Report PDF S29 + Shift Robustness post-S30 |
| CUSTOMERS.md | 309 | §13 (limites V2) | — | Customer Detail 360°, Dedup, Loyalty engagement | 🟢 DONE + post-S30 Customer Detail |
| CUSTOMER_DISPLAY.md | 253 | §13 | QR paiement digital, Ready board enrichi | Vidéos courtes, Animation fidélité, Multilingue | 🟡 PARTIEL — feature exists, post-S30 Display Admin |
| EXPENSES.md | 333 | §15 | Récurrentes programmées, Approval visuel | OCR, Budget catégorie, Note de frais structurée | 🟡 PARTIEL — S28 covers FormPage+Categories+workflow |
| PRODUCTION.md | 295 | §16 (mise à jour V3) | — (V3 a dépassé V2 sur sub-recipes/baker/yield/versioning) | Plan hebdo, Mobile saisie | 🟢 DONE + amélioration V3 |
| PROMOTIONS_AND_COMBOS.md | 305 | §15 | Stacking, Promotion effectiveness | Coupons sérialisés, Segments, A/B testing | 🟢 DONE + post-S30 Promo Stacking + Coupons |
| PURCHASING_AND_SUPPLIERS.md | 157 | §7 (limites V2) | — | (limites V2 marquées "envisagé V3") | 🟢 DONE + landed cost S23 + post-S30 Supplier Ops |
| REPORTS.md | 318 | §15 | KDS Service Speed, Unusual Patterns, B2B Self-Approval Risk | Cohort analysis, Basket Analysis ✅, Promo Effectiveness | 🔴 MAJEUR — 13/61, S29 covers top 10 P0 |
| SETTINGS.md | 430 | §12 | Approval workflows visuel, Pricing horaire | Notif scheduler, Templates editables, Multi-boutique | 🟡 PARTIEL — 6/23 pages, S29.5 + S30 + post-S30 covers |
| TABLET_ORDERING.md | 239 | §13 | Queue offline + sync, Auto-send cuisine | Modifier complet, Combos, Création client | 🟢 DONE + post-S30 Tablet Offline Complete |
| USERS_AND_PERMISSIONS.md | 325 | §11 | Détection auto-escalade, Approval workflow perm sensibles | Permissions à seuil, Sessions multiples, 2FA | 🟢 DONE + post-S30 Defense-in-depth RBAC |

### Annexe A2 — Détail par module référence (21 modules)

| Module ref | Statut V3 (selon code) | Notes |
|---|---|---|
| 00-modules-index.md | — | Index navigation |
| 01-auth-permissions.md | 🟢 | DONE — S13/S17/S19/S20 |
| 02-pos-cart-orders.md | 🟢 | DONE backbone, Outstanding page partiel |
| 02b-orders.md | 🟡 | Partie II "TODO à rédiger" — page absente — post-S30 |
| 03-payments-split.md | 🟢 | DONE — S13/S25 |
| 04-kds-kitchen.md | 🟢 | DONE — S13/S22 |
| 05-products-categories.md | 🟢 | DONE — S15/S27/S27b |
| 06-inventory-stock.md | 🟢 | DONE + amélioration WAC + FIFO + opname |
| 07-purchasing-suppliers.md | 🟢 | DONE + landed cost S23 |
| 08-customers-loyalty.md | 🟢 | DONE, Customer Detail manquant |
| 09-b2b-wholesale.md | 🟡 | Foundation S24, workflow commande complet post-S30 |
| 10-accounting-double-entry.md | 🟡 | 4/11 pages — Partie II rebase S26 |
| 11-expenses.md | 🟡 | 2/4 pages — S28 covers |
| 12-cash-register-shift.md | 🟢 | DONE + Z-Report PDF S29 |
| 13-promotions-discounts.md | 🟢 | DONE + autoeval realtime S17 |
| 14-reports-analytics.md | 🔴 | 13/61 — S29 covers top 10 P0 |
| 15-production-recipes.md | 🟢 | DONE + dépassé V2 |
| 16-display-customer.md | 🟡 | Feature exists, post-S30 admin config |
| 17-tablet-ordering.md | 🟢 | DONE + S25 idempotency, offline complet post-S30 |
| 18-mobile-shell.md | 🔴 | 0 ligne en V3 — **WONTFIX recommandé** (ADR-002) |
| 19-settings-configuration.md | 🟡 | 6/23 pages — S29.5 + S30 + post-S30 covers |

### Annexe A3 — Mises à jour suggérées du glossaire V2↔V3

Le glossaire `docs/V2_V3_GLOSSARY.md` (158 lignes) est globalement à jour. Suggestions de mise à jour mineure :

1. **§1 RPCs critiques** : ajouter `create_product_v1` + `create_category_v1` + `update_category_v1` + `reorder_categories_v1` (S27b) au tableau.
2. **§3.4 Settings** : préciser que 4 pages settings critiques (Tax, Payment Methods, KDS, Display) sont planifiées pour **S29.5 (nouvelle session proposée)** — actuellement glossaire dit juste "6 pages livrées sur ~23".
3. **§4 Tables DB** : confirmer le statut `display_promotions` (marqué "❓") — checker en S30 cleanup + ajouter `b2b_price_lists` clarification (probable post-S30 sessions B2B Quotes).
4. **§6 Améliorations V3** : passer de 15 à **20 items** (ajouter PIN secrets en header HTTP, B2B Foundation S24, 312 migrations monotonic, pg_trgm GIN indexes, `is_semi_finished` flag).
5. **§ nouvelle — "Modules WONTFIX confirmés"** : ajouter section listant les 6+ WONTFIX du tableau ci-dessus avec justification (ratifié 2026-05-19 ou à ratifier S30).
6. **§5 mapping path** : ajouter mapping `src/pages/accounting/*` → `apps/backoffice/src/pages/accounting/*` (préparation S26).
