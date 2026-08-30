# Carte des écrans POS — chemins relevés dans `apps/pos/src/`

> **Photo datée du 2026-08-31** (relevé complet contre le code ; la photo précédente datait du
> 2026-06-25 et avait dérivé sur une quinzaine de points).
>
> **Cette carte n'est PAS la vérité — le code l'est.** Elle sert à ouvrir le bon fichier vite,
> rien de plus. Dès qu'un chemin, une classe ou une dimension citée ici contredit ce que tu lis
> dans `apps/pos/src`, **le code gagne, sans discussion** : tu audites ce que tu viens de lire,
> et tu signales la dérive de la carte dans ton rapport (elle sera recorrigée hors session).
> Ne juge JAMAIS un écran sur son entrée de carte — ouvre le composant.
>
> **Les dimensions et les grilles ci-dessous sont des compteurs vivants**, vrais au 2026-08-31.
> Un audit qui veut citer une largeur ou un nombre de colonnes **relit la classe dans le
> fichier** au lieu de recopier cette carte.
>
> **Les gros écrans sont des conteneurs.** `PaymentTerminal`, `ProductGrid`, `TabletOrderPage`
> importent leur rendu réel depuis des sous-composants. Ouvre le conteneur, **suis ses imports**,
> juge là où le JSX vit.

## Plateformes — ce que sont réellement les deux profils

| Profil | Surface | Empaquetage réel |
|---|---|---|
| **CAISSE** | comptoir, écran fixe + périphériques | **web app Vite** servie dans un navigateur. **Aucun Tauri, aucun Electron** : le dépôt ne contient ni dépendance ni dossier natif desktop. |
| **WAITER** | tablette de salle | **web app Vite** empaquetée **Capacitor Android** (`@capacitor/android`, ADR-029). `lib/nativeShell.ts` détecte la coque ; la coque démarre sur `/tablet`, le web sur `/pos`. |

Conséquence d'audit : pas d'API desktop native, pas de fenêtre système, pas de menu OS à juger.
Ce qui est spécifique au natif côté WAITER se limite à ce que Capacitor apporte (safe-areas,
barre gestuelle Android, clavier tactile système).

## Routes & shells

Source : `routes/index.tsx` · racine : `main.tsx`, `App.tsx` (BootGate, spinner, `ErrorState` de boot).

| Route | Composant d'entrée | Shell / layout | Profil |
|---|---|---|---|
| `/login` | `pages/Login.tsx` | **split-panel** : aside de marque à gauche (`45%`), colonne PIN à droite ; sous ~860 px le panneau bascule en bandeau au-dessus | Auth PIN (caisse + tablette) |
| `/pos` | `pages/Pos.tsx` | **PosPage** : header · 3 colonnes (`CategoryNav` · `ProductTapHandler`→`ProductGrid` · `ActiveOrderPanel`) · `BottomActionBar` pleine largeur. Sous `md` les 3 colonnes s'empilent. | **CAISSE** |
| `/pos/stock` | `features/stock/POSStockView.tsx` | surface annexe plein écran | Caisse |
| `/pos/reports` | `features/reports/POSReportsOverviewPage.tsx` | `features/reports/components/POSReportsLayout.tsx` | Caisse/Manager |
| `/pos/reports/payments` | `POSPaymentsReportPage.tsx` | idem | Caisse/Manager |
| `/pos/reports/voids` | `POSVoidsReportPage.tsx` | idem | Caisse/Manager |
| `/pos/reports/sessions` | `POSSessionsReportPage.tsx` | idem | Caisse/Manager |
| `/pos/reports/mix` | `POSMixReportPage.tsx` | idem | Caisse/Manager |
| `/pos/reports/products` | `POSProductsReportPage.tsx` | idem | Caisse/Manager |
| `/pos/reports/margin` | `POSMarginReportPage.tsx` | idem | Caisse/Manager |
| `/pos/reports/activity` | `POSActivityReportPage.tsx` | idem | Caisse/Manager |
| `/pos/settings` | `features/settings/POSSettingsPage.tsx` | surface annexe | Caisse |
| `/pos/debts` | `features/customers/CustomerDebtsPanel.tsx` | surface annexe | Caisse |
| `/kds` | `pages/Kds.tsx` → `features/kds/KdsBoard.tsx` | plein-écran, grille de tickets | Cuisine |
| `/display` | `features/display/CustomerDisplayPage.tsx` | `features/display/components/BrandedLayout.tsx` | Client (écran secondaire, non protégé — JWT kiosk) |
| `/tablet` | `pages/tablet/TabletLayout.tsx` | **TabletLayout** : header serveur · `<Outlet>` · bottom-nav (`pb-safe-bottom`) | **WAITER** |
| `/tablet/order` | **`features/tablet/TabletOrderPage.tsx`** | menu (`TabletMenuView`) + `TabletCartPanel`, avec overlay `FloorPlanView` | Waiter |
| `/tablet/orders` | `pages/tablet/TabletOrdersPage.tsx` | onglet sous TabletLayout | Waiter |

⚠️ Piège de chemin : la page de prise de commande vit dans **`features/tablet/`**, pas dans
`pages/tablet/`. Le doublon appauvri qui vivait sous `pages/` a été supprimé.

Les satellites caisse passent par `ProtectedLazy` (clavier virtuel + `TerminalLockedOverlay`) ;
`/tablet` porte sa propre redirection, son garde de rôle et son verrou ; `/kds` n'est jamais
verrouillé.

## Écrans clés → composants

**Grille produits & registre (CAISSE)**
- `features/products/ProductTapHandler.tsx` — enveloppe la grille : gère le tap produit, ouvre
  `VariantSelectModal` / `ModifierModal` / `ComboConfigModal`. C'est LUI que `Pos.tsx` monte.
- `features/products/ProductGrid.tsx` — en-tête (titre + compteur mono + champ de recherche
  `h-11`), grille auto-remplie (`grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3`),
  squelette de 12 cartes, `EmptyState tone="branded"` (heading `h2`), `ErrorState` + retry.
- `features/products/ProductCard.tsx` — tuile : image `aspect-square` (fallback `BrandMark`),
  badge promo en haut-gauche, étoile favori en haut-droite, overlay désactivé
  (« Sold out » / « Expired », `opacity-50`), nom sur 2 lignes, prix mono.
- `features/products/CategoryNav.tsx` — rail catégories caisse : `w-[116px]` au 2026-08-31,
  bascule en bande horizontale scrollable sous `md`. Teintes résolues vers les tokens `cat-*`
  (`categoryTints.ts` + `CAT_TOKEN_CLASSES` — **classes littérales**, jamais interpolées),
  barre d'accent à gauche sur l'actif, monogramme quand aucune icône ne matche, cog en bas.
- `features/products/components/ServiceSpeedIndicator.tsx` + `hooks/useServiceSpeed.ts`.

**Panier (CAISSE)**
- `features/cart/ActiveOrderPanel.tsx` — `w-[340px]` au 2026-08-31 (sous `md` : pleine largeur,
  hauteur `42%`). Header commande + onglets type de service + badges client/table + liste de
  `CartLineRow` + **le pied de totaux rendu inline dans ce fichier** (Subtotal, redemption,
  remise, taxe, `Total` en or mono `text-3xl`). Il n'existe **plus** de composant `CartTotals` :
  seul survit le **type** `CartTotals` de `@breakery/domain` (`packages/domain/src/types/cart.ts`),
  consommé par `calculateTotals` et par `features/payment/components/OrderSummaryPanel.tsx`.
- `features/cart/CartLineRow.tsx` — trash à gauche, nom/modificateurs, stepper de quantité ;
  lignes verrouillées = cadenas + « Request cancel ».
- `features/cart/BottomActionBar.tsx` — barre pleine largeur (`pb-safe-bottom-gutter`) : ghosts
  `h-11` (Held · History · Table · Customer · Print · More ▾) puis `Send to Kitchen` et
  `Checkout` (Button `lg`, dominant). Le plancher tactile 44 px y est explicitement gravé.
- Autour : `QtyEditModal.tsx`, `CancelItemModal.tsx`, `SendToKitchenButton.tsx`,
  `PrintBillButton.tsx`, `CustomerAttachModal.tsx`, `CustomerBadge.tsx`.

**Modales de sélection**
- `features/cart/VariantSelectModal.tsx` — grille `grid-cols-2 sm:grid-cols-3`.
- `ModifierModal` (importée de `@breakery/ui`) — groupes de modificateurs.
- `features/combos/components/ComboConfigModal.tsx` — builder combo · `ComboBadge.tsx`.

**Paiement**
- `features/payment/PaymentTerminal.tsx` — **conteneur** plein écran ; 2 colonnes
  `grid-cols-1 md:grid-cols-[2fr_3fr]` (empilé sous `md`). Le rendu vit dans
  `features/payment/components/` : `PaymentMethodGrid.tsx`, `QuickPayRow.tsx`,
  `TenderDraftPanel.tsx`, `OrderSummaryPanel.tsx`, `RetryBanner.tsx` (+ `paymentMethods.ts`).
- `features/payment/split/SplitPaymentFlow.tsx` — orchestrateur d'un flux à **6 étapes**
  (`SplitStep` dans `split/types.ts`) : `ModeSelectStep` → `PayerCountStep` →
  (`CustomAmountsStep` | `ItemAssignStep`) → `PerPayerMethodStep` → `PerPayerCashStep`.
  3 modes : `items`, `equal`, `custom`.
- `features/payment/SuccessModal.tsx` — n° de commande, total, monnaie, points, CTA.

**Plan de salle & tables**
- `features/floor-plan/FloorPlanModal.tsx` — plein-écran : onglets de **sections lues en base**
  (`sections.ts` groupe par `table_sections`, l'ancienne heuristique Interior/Terrace en dur est
  morte), `FloorCanvas.tsx`, tuiles `TableCell.tsx` (couleur = statut), légende, CTA.
- `features/tablet/FloorPlanView.tsx` — variante tablette (occupation, états de chargement).
- `features/tables/` — `components/TableSelectorButton.tsx` + hooks (`useDineInTableGuard.tsx`,
  `useRestaurantTables`, `useTableOccupancy`, `useTableOrders`, `useTransferOrderTable`).

**Commandes en attente / ardoises / client**
- `features/cart/HeldOrdersModal.tsx` — liste de cartes en attente, tap pour restaurer.
- `features/heldOrders/components/` — **`AttachTabCustomerButton.tsx`, `HeldOrdersInboxButton.tsx`**
  (il n'y a plus de `HoldOrderButton`) + hooks (`useHeldOrdersQuery`, `useHeldOrdersRealtime`,
  `useReopenHeldOrder`, `useDiscardHeldOrder`, `useAttachTabCustomer`).
- `features/customers/` — `CustomerDebtsPanel.tsx`, `components/CustomerAttachButton.tsx`,
  `CustomerAttachedBadge.tsx`, `avatarTint.ts`.

**Remises & PIN manager**
- `features/discounts/components/` — `DiscountButton.tsx`, `LineDiscountButton.tsx` ;
  `managerPinHolder.ts` ; hooks `useApplyCartDiscount`, `useApplyLineDiscount`,
  `useVerifyManagerPin`. Les primitives `DiscountModal` / `PinVerificationModal` viennent de
  `@breakery/ui`.

**Fidélité & promotions**
- `features/loyalty/components/LoyaltyPointsLine.tsx` (ligne de points dans le panier).
- `features/promotions/components/PromotionsList.tsx` + hooks (auto-éval, realtime).

**Shift**
- `features/shift/ShiftClosedState.tsx` (alerte « pas de session » + CTA), `OpenShiftModal.tsx`,
  `LiveSessionsModal.tsx`.
- `features/shift/components/` — `CloseShiftModal.tsx`, `CashInOutModal.tsx`,
  `DenominationGrid.tsx`, `VarianceWarningBadge.tsx`.

**KDS**
- `features/kds/KdsBoard.tsx` — header + filtre stations + grille
  `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`.
- `features/kds/components/` — `KdsOrderCard.tsx` (bordure d'urgence, timer), `PrepTimer.tsx`,
  `BumpButton.tsx`, `RecallButton.tsx`, `UndoBumpToast.tsx`, `RecentlyServedStrip.tsx`,
  `StationFilter.tsx`, `KdsStationSelector.tsx`, `KdsEmptyState.tsx`.

**Customer display**
- `features/display/CustomerDisplayPage.tsx` (route) → `CustomerDisplayView.tsx` — plein-écran
  client : titre Playfair (`font-display`), prix mono/or, GRAND TOTAL en pied.
- `features/display/components/` — `BrandedLayout.tsx`, `CDBrandPanel.tsx`, `CDPaymentPanel.tsx`,
  `CurrentOrderCard.tsx`, `ShowcasePanel.tsx` (vitrine), `OrderQueueTicker.tsx`,
  `PairDevicePrompt.tsx` (appairage kiosk).

**Historique, void & remboursement**
- `features/order-history/OrderHistoryPanel.tsx` — bandeau KPI + liste + drawer détail.
- `features/order-history/components/` — **`OrderDetailDrawer.tsx`, `OrderHistoryStats.tsx`,
  `OrderRetryBanner.tsx`, `RefundOrderModal.tsx`, `VoidOrderModal.tsx`** (ces fichiers ne sont
  plus dans `src/components/`).
- ⚠️ Homonyme : un **second** `VoidOrderModal.tsx` vit dans `features/cart/` (annulation depuis
  le panier). Vérifie lequel tu ouvres.

**Stock POS (vitrine)**
- `features/stock/POSStockView.tsx` — header + KPI + recherche + chips catégories +
  **bascule carte/liste persistée en `localStorage`** ; en mode carte la grille est responsive
  (`grid-cols-1 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3` au 2026-08-31), pas figée.
- `features/stock/components/` — `POSStockCard.tsx`, `POSStockRow.tsx`, `AdjustDisplayModal.tsx`,
  `WasteDisplayModal.tsx`, `StockGestureModals.tsx`, `POSStockCategoriesSettings.tsx`.

**Reports POS**
- Huit pages : `POSReportsOverviewPage`, `POSPaymentsReportPage`, `POSVoidsReportPage`,
  `POSSessionsReportPage`, `POSMixReportPage`, `POSProductsReportPage`, `POSMarginReportPage`,
  `POSActivityReportPage` (toutes dans `features/reports/`).
- `features/reports/components/` — `POSReportsLayout.tsx` (header + sélecteur de période +
  nav d'onglets scrollable), `ActivityJournal.tsx`, `ReportsForbidden.tsx` (état permission).

**Réglages POS**
- `features/settings/POSSettingsPage.tsx` — 4 onglets de premier niveau (POS · Printing ·
  Customer Display · Devices) + sous-onglets de configuration.
- `features/settings/components/` — `AdvancedSettingsTab`, `BehaviorSettingsTab`,
  `DevicesSettingsTab`, `DisplaySettingsTab`, `PrintingSettingsTab`, `HubStatusPanel`,
  `NetworkScanPanel`, `PrinterTestPanel`, `ScopeBadge`, `SettingToggle`.

**Navigation & auth**
- `features/nav/SideMenuDrawer.tsx` — tiroir gauche (`Sheet`), `w-[300px] sm:w-[320px]` au
  2026-08-31, sections OPERATIONS / SHIFT / SYSTEM.
- `pages/Login.tsx` — **contient son propre pavé PIN** (touches `h-20`, auto-submit à 6 chiffres,
  points de progression, sélecteur d'utilisateur inline, chip « Switch »). Il n'existe **plus**
  de `features/auth/PinPad.tsx` ; le pavé virtuel générique (`VirtualKeypadProvider`,
  `NumpadVirtual`) vient de `@breakery/ui` et n'est délibérément pas utilisé ici.
- `features/auth/` — `ChangePinModal.tsx`, `TerminalLockedOverlay.tsx`, `UserPicker.tsx`
  (voir « fichiers sans importeur » plus bas), `sessionDeathWatch.ts`, `sessionRefresh.ts`,
  hooks (`useLoginUsers`…).

**Tablette (WAITER) — spécifique**
- `features/tablet/TabletOrderPage.tsx` — orchestre menu ↔ plan de salle, bandeaux d'état
  (envoyé cuisine, hors-ligne), total en barre d'outils.
- `features/tablet/components/` — `TabletMenuView.tsx` (sidebar + grille),
  `TabletCategorySidebar.tsx` (`w-[104px]`, plancher gravé par un test),
  `TabletProductGrid.tsx` (`grid-cols-2 lg:grid-cols-3 gap-4`),
  `TabletCartPanel.tsx` (`w-[340px]`, repliable à `w-20` sauf en paysage — au 2026-08-31),
  `OrderTypeToggle.tsx`, `TabletOrderConfirmation.tsx`, `OfflineBanner.tsx`.

**Boîte de réception comptoir (commandes tablette)**
- `features/inbox/components/` — `TabletInboxButton.tsx`, `TabletInboxModal.tsx` ;
  hooks `usePendingTabletOrders`, `usePickupTabletOrder`, `usePickedUpOrderSync`
  (monté par `Pos.tsx`), `useCloseCancelledTabletOrder`.

**Réseau local, hors-ligne & télémétrie (rendu ambiant à juger)**
- `features/lan/` — `HubPresenceMount.tsx`, `hubBusClient.ts`, `hubConnectionStore.ts`,
  `cloudStatusStore.ts`, `offlineMode.ts`, `offlineOutbox.ts`, `offlineReplay.ts`,
  `localOrderNumber.ts` + hooks (`useCloudPing`, `useOfflineReplay`, `useOfflinePaymentGate`,
  `useOfflinePendingCount`). C'est ce qui alimente les **pastilles de régime** du header caisse
  et le bandeau « checkout disabled ». Tu juges leur RENDU ; le comportement (file, replay,
  idempotence) appartient à `pos-flow-audit`.
- `features/audit/` — `PosEventOutboxMount.tsx`, `emitPosEvent.ts`, `outbox.ts`,
  `deviceIdentity.ts` (télémétrie, aucune surface visible).

**États transverses**
- `components/ErrorState.tsx` (panneau d'erreur générique) · `EmptyState` (de `@breakery/ui`,
  tons `branded` / `default`).
- Squelettes : dans `ProductGrid.tsx` et `TabletProductGrid.tsx`. Hors-ligne :
  `features/tablet/components/OfflineBanner.tsx` (tablette) + pastilles du header caisse
  (`pages/Pos.tsx`). Permission : `features/reports/components/ReportsForbidden.tsx`.
  Verrou : `features/auth/TerminalLockedOverlay.tsx`.
- Montages invisibles dans `components/` : `CatalogRealtimeMount.tsx`, `IdleTimeoutMount.tsx`,
  `SettingsRealtimeMount.tsx`.

## Tokens & CSS

- `apps/pos/src/index.css` ne contient **que** l'import des tokens (`@breakery/ui/tokens.css`),
  les 3 familles de police et l'utilitaire `.scrollbar-none`. **Il n'y a pas de classe `.cat-btn`**
  dans le dépôt (le nom ne survit que dans un commentaire de `CategoryNav.tsx`).
- La vérité des tokens et des familles de couleur est `packages/ui/tailwind-preset.ts` +
  `@breakery/ui/tokens.css` — cf. le skill `breakery-ui-kit`, ne re-déduis pas la liste.
- Primitifs : **`Select` existe** (un `<select>` natif stylé, exporté par `@breakery/ui`).
  **`RadioGroup`, `Checkbox`, `Popover`, `Tooltip` n'existent toujours pas** — prévois le
  fallback natif avant de proposer un import.

## Fichiers sans importeur (au 2026-08-31)

Deux composants n'ont aucun site d'appel : `features/products/CategorySidebar.tsx` (le rail
vivant est `CategoryNav.tsx`) et `features/auth/UserPicker.tsx` (le sélecteur vivant est inline
dans `pages/Login.tsx`). **Ne pose jamais un constat de design sur eux** — un correctif y serait
mort-né. Vérifie l'importeur avant de juger un composant que la carte ne relie à aucune route.

## Fichiers à lire en premier (haut rendement pour un audit design)

1. `features/products/ProductGrid.tsx` + `ProductCard.tsx` — le geste n°1 (ajouter un produit) :
   densité, squelette, états vide/erreur, sold-out.
2. `features/cart/ActiveOrderPanel.tsx` + `BottomActionBar.tsx` — lecture du panier, hiérarchie
   du total, tailles et ordre des actions.
3. `features/payment/PaymentTerminal.tsx` **puis ses sous-composants** `components/` — l'écran le
   plus critique en rush.
4. `features/tablet/TabletOrderPage.tsx` + `components/TabletCartPanel.tsx` +
   `TabletCategorySidebar.tsx` — la surface WAITER (debout, tactile, hors-ligne).
5. `pages/Pos.tsx` — le shell caisse : ce qu'il monte, ce qu'il empile sous `md`, les pastilles
   de régime du header.
6. `packages/ui/tailwind-preset.ts` (via `breakery-ui-kit`) + `apps/pos/src/index.css` — tokens
   disponibles avant toute proposition de couleur ou de classe.
