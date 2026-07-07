# Carte des écrans POS — chemins vérifiés (`apps/pos/src/`)

> Vérifié 2026-06-25 contre le code. Les chemins bougent : si un fichier a disparu/migré, **fais confiance au code** et note la dérive. Vérifie le N° de ligne avant de le citer.
>
> **Les gros écrans sont souvent refactorés en sous-composants** après cette carte (un `PaymentTerminal`/`ProductGrid` devient un conteneur qui importe `PaymentMethodGrid`, `QuickPayRow`, etc.). Quand un écran « conteneur » est listé, **ouvre-le et suis ses imports** pour trouver où vit le rendu réel — ne juge pas un écran sur la seule entrée de la carte.

## Routes & shells

| Route | Composant d'entrée | Shell / layout | Profil | Plateforme |
|---|---|---|---|---|
| `/login` | `pages/Login.tsx` | plein-écran, carte centrée | Auth PIN | Caisse + Tablette |
| `/pos` | `pages/Pos.tsx` | **PosPage** (3 colonnes : CategoryNav 104px · ProductGrid · ActiveOrderPanel 350px · BottomActionBar) | **CAISSE** | Desktop/Tauri |
| `/kds` | `pages/Kds.tsx` → `features/kds/KdsBoard.tsx` | plein-écran grille | Cuisine | Desktop |
| `/display` | `features/display/CustomerDisplayPage` | `features/display/components/BrandedLayout.tsx` | Client | Écran secondaire |
| `/pos/stock` | `features/stock/POSStockView.tsx` | panneau annexe | Caisse | Desktop |
| `/pos/reports` (+ `/products`, `/activity`) | `features/reports/POSReportsOverviewPage.tsx` … | `features/reports/components/POSReportsLayout.tsx` | Caisse/Manager | Desktop |
| `/pos/settings` | `features/settings/POSSettingsPage.tsx` | panneau annexe | Caisse | Desktop |
| `/pos/debts` | `features/customers/CustomerDebtsPanel.tsx` | 2 colonnes | Caisse | Desktop |
| `/tablet` | `pages/tablet/TabletLayout.tsx` | **TabletLayout** (header serveur + Outlet + bottom-nav) | **WAITER** | Tablette/Capacitor |
| `/tablet/order` | `pages/tablet/TabletOrderPage.tsx` | 2 colonnes (menu + cart 300px) | Waiter | Tablette |
| `/tablet/orders` | `pages/tablet/TabletOrdersPage.tsx` | onglet sous TabletLayout | Waiter | Tablette |

Router : `routes/index.tsx` · racine : `main.tsx`, `App.tsx` (BootGate, spinner, ErrorState boot).

## Écrans clés → composants

**Grille produits & registre (CAISSE)**
- `features/products/ProductGrid.tsx` — grille 4 colonnes (`grid-cols-4 gap-4 p-6`), barre de recherche, skeleton (8 cartes), `EmptyState tone="branded"`.
- `features/products/ProductCard.tsx` — tuile : image aspect-square, badge promo (haut-g), étoile favori (haut-d), bandeau low-stock, nom, prix mono/gold, état `disabled` (opacity-50 + label « SOLD OUT »).
- `features/products/CategoryNav.tsx` — sidebar 104px, tuiles catégorie (tint dynamique via `--cat-tint`/`--cat-accent`), accent gold actif, favoris/combos épinglés, cog réglages en bas.

**Panier (CAISSE)**
- `features/cart/ActiveOrderPanel.tsx` — header commande + tabs type service (Dine-In/Take-Out/Delivery) + badges client/table + liste `CartLineRow` + `CartTotals`.
- `features/cart/CartLineRow.tsx` — trash à gauche, nom/modificateurs, stepper quantité ; lignes lockées = icône cadenas + « Request cancel ».
- `features/cart/CartTotals.tsx` — sous-total, redemption, points, taxe, promos, TOTAL gras/gold (mono).
- `features/cart/BottomActionBar.tsx` — barre pleine largeur `h-14`, boutons `h-11` (Held · History · Table · Customer · Print · More ▾ | Void · Send to Kitchen · Checkout).

**Modales sélection**
- `features/cart/VariantSelectModal.tsx` — grille 3 colonnes de variantes.
- `ModifierModal` (depuis `@breakery/ui`) — groupes de modificateurs.
- `features/combos/components/ComboConfigModal.tsx` — builder combo.

**Paiement**
- `features/payment/PaymentTerminal.tsx` — modale plein-écran, 2 colonnes (méthodes + draft tender + quick-pay | résumé + CTA). **Conteneur** : le détail est éclaté en sous-composants — suis les imports : `PaymentMethodGrid.tsx`, `QuickPayRow.tsx`, `TenderDraftPanel.tsx`, `OrderSummaryPanel.tsx`, `RetryBanner.tsx` (vérifie les noms exacts au moment de l'audit).
- `features/payment/split/SplitPaymentFlow.tsx` → `PayerCountStep.tsx` + `ItemAssignStep.tsx`.
- `features/payment/SuccessModal.tsx` — n° commande, total, monnaie, points, CTA.

**Plan de salle & tables**
- `features/floor-plan/FloorPlanModal.tsx` — plein-écran, tabs sections (Interior/Terrace), scatter de `TableCell.tsx` (couleurs statut), légende, CTA.
- `features/tablet/FloorPlanView.tsx` — variante tablette.

**Commandes en attente / client**
- `features/cart/HeldOrdersModal.tsx` — liste de cartes en attente, tap pour restaurer.
- `features/heldOrders/components/HoldOrderButton.tsx`.
- `features/cart/CustomerAttachModal.tsx` — recherche/création client. · `features/cart/CustomerBadge.tsx`.

**Shift**
- `features/shift/ShiftClosedState.tsx` — alerte « pas de session » + CTA. · `features/shift/OpenShiftModal.tsx`.
- `features/shift/components/CloseShiftModal.tsx` — résumé cash + variance + PIN. · `features/shift/LiveSessionsModal.tsx`.

**KDS**
- `features/kds/KdsBoard.tsx` — header + tabs stations + grille responsive (`grid-cols-1 md:2 lg:3 xl:4`). · `features/kds/components/KdsOrderCard.tsx` (bordure urgence, timer). · `KdsEmptyState.tsx`, `StationFilter.tsx`.

**Customer display**
- `features/display/CustomerDisplayView.tsx` — plein-écran client : empty (BrandMark + welcome) / commande active (photo 96px, Playfair 2xl, prix mono/gold) + footer GRAND TOTAL.

**Historique & remboursements**
- `features/order-history/OrderHistoryPanel.tsx` — KPI strip + liste commandes + drawer détail.
- `components/OrderDetailDrawer.tsx`, `VoidOrderModal.tsx`, `RefundOrderModal.tsx`.

**Stock POS**
- `features/stock/POSStockView.tsx` — header + KPI + recherche + chips catégories + grille 5 colonnes. · `components/POSStockCard.tsx`.

**Reports POS**
- `features/reports/POSReportsOverviewPage.tsx` (KPI 3 col + bar chart CSS), `POSProductsReportPage.tsx`, `POSActivityReportPage.tsx`, `components/POSReportsLayout.tsx`.

**Navigation & auth**
- `features/nav/SideMenuDrawer.tsx` — drawer ~300px (`Sheet`), sections OPERATIONS/SHIFT/SYSTEM.
- `pages/Login.tsx`, `features/auth/PinPad.tsx`, `ChangePinModal.tsx`, `TerminalLockedOverlay.tsx`.

**Tablette (WAITER) — spécifique**
- `features/tablet/components/TabletProductGrid.tsx`, `TabletCartPanel.tsx` (cart 300px), `TabletMenuView.tsx`, `TabletCheckoutButton.tsx`, `OfflineBanner.tsx` (WifiOff + dernière synchro).

**États transverses**
- `components/ErrorState.tsx` (panneau erreur générique). · `EmptyState` (depuis `@breakery/ui`, tone branded/default).
- Skeleton : dans `ProductGrid.tsx`. · Offline : `OfflineBanner.tsx` (tablette uniquement). · Permission : `features/reports/components/ReportsForbidden.tsx`.

## Fichiers à lire en premier (haut rendement pour un audit design)
1. `features/products/ProductGrid.tsx` + `ProductCard.tsx` — le geste #1 (ajouter un produit), densité, skeleton/empty.
2. `features/cart/ActiveOrderPanel.tsx` + `BottomActionBar.tsx` — lecture du panier + barre d'actions (tailles, hiérarchie).
3. `features/payment/PaymentTerminal.tsx` — l'écran le plus critique en rush (méthodes, quick-pay, taps).
4. `features/tablet/TabletOrderPage.tsx` + `components/TabletCartPanel.tsx` — surface WAITER (debout, mobile, offline).
5. `apps/pos/src/index.css` + cf. `breakery-ui-kit` — tokens, `.cat-btn`, scrollbar utilities.
