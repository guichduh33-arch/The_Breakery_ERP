# Travail — POS / Cart / Orders

> Last updated: 2026-05-03
> Référence : [`../04-modules/02-pos-cart-orders.md`](../04-modules/02-pos-cart-orders.md)
> Audits sources : `01-architecture-security-audit.md`, `03-code-quality-schema-audit.md`, `05-uiux-design-audit.md`, `08-operations-lan-audit.md`

## Objectifs du module

1. **Décomposer `cartStore` (625 lignes)** en slices modulaires sans casser la subscription pattern. Critère : aucun fichier store > 300 lignes.
2. **Hardening locked items** : aucun edge case où une commande envoyée en cuisine devient modifiable sans PIN. Critère : tests d'intégration couvrent network split / re-mount POS.
3. **Performance POS** : First Contentful Paint POS < 1.5s sur tablette milieu de gamme, ré-render cart < 16 ms (60 fps). Critère : profiling React DevTools + Lighthouse.
4. **Recovery & UX** : sauvegarde brouillon de commande pour survivre crash, Cmd+K POS, suppression checkout legacy. Critère : F-test « débrancher POS au milieu d'une commande » → restore au reboot.

---

## Tâches

### TASK-02-001 — Décomposer `cartStore.ts` (625 lignes) en slices [P2] [OBSOLETE]
**Status note (2026-05-14)** : V3 rewrite already collapsed the V2 monolith — `apps/pos/src/stores/cartStore.ts` is 425 lines (vs V2's 625) and domain logic (`addItem`, `removeItem`, `attachCustomer`, `setRedeemPoints`, `pointsToValue`) is fully extracted to `@breakery/domain`. The "slice it 4 ways" V2 prescription no longer maps. Any further trim is cosmetic and tracked via session 14 polish, not as a logic refactor.
**Contexte** : `cartStore.ts` excède la convention 300 lignes et mélange items, pricing, promotions, locked items, customer category, order context. Difficile à tester unitairement et à maintenir. Source : `docs/audit/01-architecture-security-audit.md§Weakness-1` + `docs/audit/03-code-quality-schema-audit.md§B1`.
**Critère d'acceptation** :
- [ ] Créer slices : `cartItemsSlice`, `cartPromotionSlice`, `cartLockedSlice`, `cartCustomerSlice`.
- [ ] Combiner via Zustand `combine` ou pattern slice classique.
- [ ] Tests stores existants passent sans modification (sinon migrer en parallèle).
- [ ] Aucun fichier > 300 lignes.
- [ ] `subscribeWithSelector` toujours fonctionnel (display broadcast continue de marcher).
**Fichiers concernés** : `src/stores/cartStore.ts`, nouveaux `src/stores/cart/*.ts`, tests `src/stores/__tests__/cartStore.test.ts`.
**Dépend de** : aucune
**Estimation** : `L`
**Risques** : Casser la persistence sessionStorage, briser display broadcast, régresser locked-items. Faire en plusieurs PRs petites.

### TASK-02-002 — Edge cases lockedItems sur network split / re-mount POS [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 4.A. V3 evidence: `apps/pos/src/stores/cartStore.ts` exposes `isOffline` state + `initNetworkListener` helper + persisted `lockedItemIds`; covered by `apps/pos/src/stores/__tests__/cartStore.networkSplit.test.ts` (StrictMode double-mount, online/offline event, locked-items preservation across reload). Commit `bdf21aa` (squashed PR #13).
**Contexte** : Quand le POS perd la connexion après envoi en cuisine puis se remonte, l'état locked peut diverger entre cartStore (sessionStorage) et l'état réel des order_items côté DB. Risque : un item cuisiné devient modifiable côté POS. Inferred from code review + LAN audit (message dedup absent).
**Critère d'acceptation** :
- [ ] Au mount POS, refetch les `order_items` actifs et reconstruire le set `lockedItems` depuis la DB plutôt que la session.
- [ ] Si conflit (item local non-locked mais DB le considère envoyé), appliquer la version DB et logger un warning.
- [ ] Tests d'intégration : simulation perte réseau → POS reconnect → état restauré.
- [ ] Documenter le pattern dans `docs/reference/04-modules/02-pos-cart-orders.md`.
**Fichiers concernés** : `src/stores/cartStore.ts`, `src/hooks/pos/useCartHydration.ts` (à créer), `src/services/pos/orderService.ts`.
**Dépend de** : `TASK-02-001` (slices propres avant cette logique)
**Estimation** : `M`
**Risques** : Refetch trop fréquent → coût Supabase. Limiter au mount POS et après visibilitychange.

### TASK-02-003 — Optimisations cart re-render [P2] [TODO]
**Status note (2026-05-14)** : Uncertain — manual review needed. V3 cart components (`apps/pos/src/features/cart/CartItemRow.tsx`, `ActiveOrderPanel.tsx`) exist but no Phase 4.A profiling task touched re-render granularity. Defer to Session 14 polish or measure after Session 13 surface lands.
**Contexte** : `CartItemRow`, `CartTotals`, `CartActions` sont déjà décomposés (cf. UX audit), mais le sélecteur Zustand n'est pas toujours granulaire. Modifier la quantité d'un item peut re-render toute la liste. Inferred from code review.
**Critère d'acceptation** :
- [ ] Profiling React DevTools : identifier les composants qui re-render à chaque mutation.
- [ ] Utiliser `useShallow` ou sélecteurs spécifiques sur `useCartStore`.
- [ ] `React.memo` ciblé sur `CartItemRow` avec comparator `prev.id === next.id && prev.quantity === next.quantity && ...`.
- [ ] Mesure avant/après (FPS sur 30 items dans le panier).
- [ ] Aucun bug visuel (ex : total qui ne se met pas à jour).
**Fichiers concernés** : `src/components/pos/cart/CartItemRow.tsx`, `src/components/pos/cart/CartTotals.tsx`, `src/components/pos/cart/CartActions.tsx`.
**Dépend de** : `TASK-02-001` (slices granulaires aident la sélection)
**Estimation** : `M`
**Risques** : Sur-mémoization peut briser des refresh légitimes (promotions auto-évaluées). Tester avec promo engine.

### TASK-02-004 — VirtualKeypad UX improvements [P2] [OBSOLETE]
**Status note (2026-05-14)** : V2 `VirtualKeypadProvider` was not ported to V3. POS payment UI uses the `@breakery/ui` `Numpad` primitive directly inside `PaymentTerminal.tsx` (no global provider, no context-switch focus management gap). The original V2 scope no longer exists.
**Status note (2026-05-18)** : S22 update — the `A1-3 focus management` audit reference cited below is fully addressed at the modal-primitive level via S22 lock-in (16 RTL focus-trap regression tests on `Dialog`/`Sheet`/`FullScreenModal`/`CenterModal`). The `Numpad` primitive itself is non-modal so it's out of scope, but any future modal-resident Numpad surface inherits Radix's focus-trap automatically through the parent `Dialog`/`Sheet`. See `22-design-system.md` TASK-22-006 + S22 INDEX §4.
**Contexte** : `VirtualKeypadProvider` enveloppe le POS mais l'UX du clavier numérique (saisie quantité, paiement) souffre de placement variable et focus management incertain. Inferred from `docs/audit/05-uiux-design-audit.md§A1-3` (focus management) + revue UX.
**Critère d'acceptation** :
- [ ] Audit UX : lister les 5 contextes où le clavier apparaît (qty, prix manual, paiement, recherche, code promo).
- [ ] Position uniformisée (ancré bas droite, escape pour fermer, click-outside pour valider).
- [ ] Focus management : retour focus à l'input source à la fermeture.
- [ ] Touch targets ≥ 44px (déjà OK selon UX audit, à vérifier).
- [ ] Mode `motion-reduce` respecté pour les animations d'apparition.
**Fichiers concernés** : `src/components/pos/VirtualKeypad/`, `src/contexts/VirtualKeypadContext.tsx`.
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Régresser un workflow actif. Faire valider par un cashier réel avant merge.

### TASK-02-005 — Order context switching mid-cart [P2] [TODO]
**Contexte** : Si un cashier change le type de commande (dine_in → takeaway) ou le client (B2B → retail) après avoir ajouté des items, les prix peuvent rester ceux de la catégorie initiale. Inferred from code review (`get_customer_product_price` est appelé à l'add, pas au switch).
**Status note (2026-05-14)** : Genuinely undone. Phase 4.A scope (POS UX hardening) did not address mid-cart context switching reprice. Carry-over to Session 14 polish or later.
**Critère d'acceptation** :
- [ ] Au switch order_type ou customer, recalculer les prix de tous les items (sauf locked items qui gardent leur prix initial).
- [ ] Toast de confirmation : « Prices updated for X items ».
- [ ] Locked items NON impactés (validation visuelle).
- [ ] Tests : switch pendant un panier de 5 items mixtes (locked + non-locked).
**Fichiers concernés** : `src/stores/cartStore.ts`, `src/hooks/pos/useCustomerSwitch.ts` (à créer), `src/services/pos/cartCalculations.ts`.
**Dépend de** : `TASK-02-001`
**Estimation** : `M`
**Risques** : Comportement client inattendu (« pourquoi le prix a changé ? »). Toast obligatoire.

### TASK-02-006 — Save draft order (POS crash recovery) [P2] [TODO]
**Status note (2026-05-14)** : Genuinely undone. Phase 4.A delivered cart-store `isOffline` flag + read-only graceful degrade, but no `cart_drafts` table or DB-persisted draft restore was built. Carry-over.
**Contexte** : Cart en sessionStorage seulement → fermeture onglet ou crash = perte. Pour ~200 tx/jour à Lombok (réseau parfois capricieux), un mécanisme de brouillon DB est utile. Inferred from `docs/audit/07-product-backlog-audit.md§Critical-online-only-risk`.
**Critère d'acceptation** :
- [ ] Migration : table `cart_drafts` (id, terminal_id, user_id, payload jsonb, updated_at).
- [ ] Auto-save toutes les 30s ou à chaque mutation cart > 3 items.
- [ ] Au mount POS, si draft < 1h existant pour ce terminal+user → proposer restore.
- [ ] Cleanup : drafts > 24h supprimés via cron Supabase (pg_cron) ou trigger.
- [ ] Tests : crash simulé (window.close) → restore au reboot.
**Fichiers concernés** : nouvelle migration, `src/stores/cartStore.ts`, `src/hooks/pos/useCartDraft.ts` (à créer), modal `RestoreDraftModal.tsx`.
**Dépend de** : `TASK-02-001`
**Estimation** : `L`
**Risques** : Restore d'un draft pollué (items invalides après suppression produit). Valider chaque item au restore.

### TASK-02-007 — Performance bundle size POS page [P2] [OBSOLETE]
**Status note (2026-05-14)** : V2-only concern. V3 splits POS and BO into separate Vite apps (`apps/pos` vs `apps/backoffice`) — Recharts/jsPDF/XLSX are not part of `apps/pos` dependency graph by construction. The original "exclude Recharts from POS chunk" prescription no longer applies; a fresh bundle audit belongs in Session 14+ if perf signals require it.
**Contexte** : Vite split déjà actif, mais POS page bundle pourrait être réduit (Recharts inutile sur POS, jsPDF lazy à confirmer). Source : `docs/audit/08-operations-lan-audit.md§5.4` (vendor-react ~620KB).
**Critère d'acceptation** :
- [ ] `npm run build -- --mode=analyze` (ou `vite-bundle-visualizer`).
- [ ] POS page chunk principal < 250 KB gzipped.
- [ ] Recharts, jsPDF, XLSX exclus du POS chunk (chargés à la demande backoffice).
- [ ] Lighthouse mobile POS Performance ≥ 85.
- [ ] Documenter dans `docs/reference/10-deployment-ops/` les chunks attendus.
**Fichiers concernés** : `vite.config.ts`, `src/routes/posRoutes.tsx`, audit dynamiques imports dans `src/components/pos/`.
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Casser un import dynamique mal configuré → erreur runtime. Tester chaque page POS après split.

### TASK-02-008 — Supprimer le double checkout (`POSCheckoutWrapper` legacy) [P2] [OBSOLETE]
**Status note (2026-05-14)** : V2-only cleanup. Neither `POSCheckoutWrapper.tsx` nor `PaymentModal.tsx` exists in V3 — checkout uses `apps/pos/src/features/payment/PaymentTerminal.tsx` (single full-screen modal, multi-tender via session-10 design). No legacy to remove.
**Contexte** : Deux UIs de checkout coexistent : `POSCheckoutWrapper.tsx` (simpler, station hardcoded) et `PaymentModal.tsx` (full split-payment). Le wrapper semble dead code mais reste dans le bundle. Source : `docs/audit/05-uiux-design-audit.md§U1` + `§POS-P2`.
**Critère d'acceptation** :
- [ ] Confirmer via grep + git history que `POSCheckoutWrapper.tsx` n'est plus utilisé en runtime.
- [ ] Supprimer le composant + ses imports.
- [ ] Mettre à jour `docs/reference/04-modules/02-pos-cart-orders.md` (référence obsolète).
- [ ] Tests visuels : le checkout actif (`PaymentModal`) couvre tous les cas.
**Fichiers concernés** : `src/components/pos/POSCheckoutWrapper.tsx` (suppression), `src/components/pos/POSTerminalWrapper.tsx`, `src/pages/pos/POSPage.tsx`.
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : Supprimer un usage caché (lazy route). Grep + tests E2E avant merge.

### TASK-02-009 — Cmd+K (CommandPalette) sur POS [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No POSCommandPalette / cmdk integration in `apps/pos/src/` (grep returns 0 hits). Not part of Phase 4.A / 6.C scope. Carry-over.
**Contexte** : CommandPalette existe en BackOffice mais pas en POS. Un cashier rapide peut bénéficier de raccourcis (Hold order, Discount, Customer search). Source : `docs/audit/05-uiux-design-audit.md§N1`.
**Critère d'acceptation** :
- [ ] CommandPalette POS avec actions : Hold order, New order, Customer search, Discount, Cash drawer, Z-report.
- [ ] Raccourci Cmd+K (Mac) / Ctrl+K (Windows / Linux) sur POSTerminalWrapper.
- [ ] Filtrage par fuzzy search (cmdk lib, déjà dépendance).
- [ ] `shouldFilter={false}` si on alimente côté Supabase (cf. Pitfall epic-016b).
- [ ] Documenter les raccourcis dans `docs/reference/02-design-system/`.
**Fichiers concernés** : `src/components/pos/POSCommandPalette.tsx` (à créer), `src/components/pos/POSTerminalWrapper.tsx`.
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Conflit raccourcis avec navigateur ou Capacitor. Tester cross-platform.

### TASK-02-010 — Wire up Account button (CategoryNav bottom) [P3] [OBSOLETE]
**Status note (2026-05-14)** : V2-only artefact. V3 POS does not ship a `CategoryNav` sidebar component (`apps/pos/src/` grep for `CategoryNav` / `UserMenu` returns 0 hits). Account/logout flow is owned by the PIN auth surface (`apps/pos/src/features/auth/`), with no bottom-of-sidebar button to wire.
**Contexte** : Le bouton User en bas de la sidebar POS n'a pas d'`onClick`. Source : `docs/audit/05-uiux-design-audit.md§N2`.
**Critère d'acceptation** :
- [ ] Click → ouvre un menu contextuel (avatar, name, role, change PIN, logout).
- [ ] Modal/popover cohérent avec le design « Luxe Dark ».
- [ ] Logout passe par `auth-logout` Edge Function (pas de session orpheline).
- [ ] Touch target ≥ 44px.
**Fichiers concernés** : `src/components/pos/CategoryNav.tsx`, nouveau `src/components/pos/UserMenuPopover.tsx`.
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : Aucun majeur. UX simple.

---

## Backlog métier (objectif fonctionnel — page /orders)

> Items issus de `docs/_archive/objectif-travail-v2/ORDERS.md` §14 — vision produit de la page Orders (consultation/inspection des commandes, distincte du POS de saisie).
> Ajoutés 2026-05-13 lors de la cascade docs (session 13).

### TASK-02-011 — Filtre par cashier / serveur [P2] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No `/orders` BO page or POS OrderHistoryPanel cashier filter delivered in Session 13. Phase 6.C `D-W6-6C-04` confirms POS/KDS polish targets were retargeted to existing files only — the Orders-page cascade (02-011..019) was not built. Carry-over.
**Contexte** : aujourd'hui, impossible de filtrer la liste Orders par staff qui a créé la commande. Audit performance individuelle limité.
**Bénéfice attendu** : voir d'un coup toutes les commandes d'un staff donné — utile pour audit, performance, calcul commission.
**Critère d'acceptation** :
- [ ] Filtre `created_by` (user picker autocomplete) dans `OrdersPage`.
- [ ] Filtre persistant en query string (`/orders?cashier=xxx`).
- [ ] Visible uniquement si user a permission `sales.view_all` (sinon filtre auto sur soi-même).
- [ ] Stats du panel filtré (somme orders, total).
**Dépend de** : aucune.
**Estimation** : S
**Risques** : confidentialité — staff junior ne doit pas voir les commandes des autres.
**Notes** : pose le socle pour le filtre "Mes commandes" (TASK-02-014).

### TASK-02-012 — Bulk actions (marquer payées en masse) [P2] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No bulk-mark-paid action in V3 (`apps/pos/src/features/order-history/` is single-row only). Per Phase 6.C deviation `D-W6-6C-04`, the Orders-page cascade was descoped. Carry-over.
**Contexte** : pour solder des ardoises de groupe (ex: une entreprise paie en bloc 15 tickets de ses employés), aujourd'hui il faut traiter chaque commande individuellement.
**Bénéfice attendu** : sélection multiple de commandes unpaid → marquer payées en un coup avec un seul moyen de paiement et un seul PIN manager.
**Critère d'acceptation** :
- [ ] Checkbox par ligne + checkbox "select all visible" dans la table Orders.
- [ ] Barre d'actions flottante quand sélection > 0 : "Mark all as paid (X commandes — total Y IDR)".
- [ ] Modal de confirmation : méthode de paiement unique + PIN manager.
- [ ] Génération d'un JE compta agrégé OU N JE individuels (choix config).
- [ ] Audit log de l'action bulk avec liste des order IDs.
**Dépend de** : aucune.
**Estimation** : M
**Risques** : faux clic → bulk → catastrophe — confirmation explicite + undo dans 30s.
**Notes** : V1 mark as paid ; V2 bulk void/refund (plus risqué).

### TASK-02-013 — Heatmap visuelle des commandes en cours [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. Heatmap view not present in V3 OrderHistoryPanel or any BO page. Out of scope for Session 13 ; not slated for Session 14 either.
**Contexte** : la liste tabulaire est efficace pour la consultation mais ne donne pas une "image" instantanée de l'état du service en cours.
**Bénéfice attendu** : vue compacte (carrés colorés) montrant l'âge de chaque commande en cours (vert / orange / rouge selon le temps d'attente).
**Critère d'acceptation** :
- [ ] Toggle "Vue heatmap" en haut de page (alternative à la table).
- [ ] Une case par commande active (preparing/ready non encore servie).
- [ ] Code couleur progressif identique à KDS (vert/orange/rouge/clignotant).
- [ ] Clic → ouvre la modale détail.
- [ ] Auto-refresh toutes les 30s.
**Dépend de** : aucune.
**Estimation** : M
**Risques** : si volume très élevé (>100 commandes simultanées) la heatmap devient illisible — limiter à un quadrillage 10×10 avec scroll.
**Notes** : utile pour les services denses (samedi midi).

### TASK-02-014 — Filtre rapide "Mes commandes" [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. Depends on TASK-02-011 (cashier filter) which is itself undone. Carry-over.
**Contexte** : un serveur veut souvent ne voir que les commandes qu'il a saisies, pas celles des autres.
**Bénéfice attendu** : raccourci 1-clic "Mes commandes" qui filtre sur `created_by = current_user`.
**Critère d'acceptation** :
- [ ] Toggle "Mes commandes" visible en haut.
- [ ] Active automatiquement le filtre `cashier=current_user`.
- [ ] Persistant entre navigation.
**Dépend de** : `TASK-02-011`.
**Estimation** : S
**Risques** : aucun.
**Notes** : configuration par défaut "ON" pour les serveurs/cashiers (selon rôle).

### TASK-02-015 — Notification toast riche [P3] [TODO]
**Status note (2026-05-14)** : Uncertain — manual review needed. `sonner` toast wired in `PaymentTerminal.tsx` and tablet `useTabletOrderStatusListener` for "Item ready" events (Phase 4.D, D-W4-4D-02), but a POS-side rich toast with "Voir détail" CTA tied to KDS_ORDER_READY is not explicitly delivered. Verify in Session 14 polish.
**Contexte** : le son `playOrderReadySound` est joué quand un order passe en `ready`, mais aucun toast visuel cliquable n'apparaît.
**Bénéfice attendu** : toast riche avec numéro de commande + bouton "Voir détail" qui ouvre la modale.
**Critère d'acceptation** :
- [ ] À chaque `KDS_ORDER_READY` reçu, afficher un toast (sonner + visuel).
- [ ] Toast : "Commande #124 prête — Table 5" + bouton.
- [ ] Auto-dismiss 10s.
- [ ] Click → ouvre la modale détail de la commande.
- [ ] Toggle Settings.
**Dépend de** : aucune (déjà du KDS listener).
**Estimation** : S
**Risques** : surcharge si beaucoup de ready simultanés — empiler max 5 puis "X autres".
**Notes** : utiliser le toast pattern déjà en place (`sonner` ou équivalent).

### TASK-02-016 — Édition de la commande après coup [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. V3 ships Cancel item (`useCancelOrderItem.ts`) but no post-kitchen edit flow with PIN gate + JE compensation. Not in Session 13 scope.
**Contexte** : aujourd'hui, pour modifier une commande déjà envoyée en cuisine (ajouter un item, retirer), il faut voider + recréer. Lourd et bruyant en audit.
**Bénéfice attendu** : édition contrôlée avec PIN manager + raison + audit complet.
**Critère d'acceptation** :
- [ ] Bouton "Modifier" dans la modale détail (visible seulement si statut ≤ ready).
- [ ] Modal d'édition : ajout/retrait d'items, modif quantités.
- [ ] PIN manager obligatoire + champ raison.
- [ ] Audit log de la modif (avant/après JSON).
- [ ] Recalcul automatique tax PB1 + JE auto compensatoire si différence montant.
- [ ] Re-envoi KDS des nouveaux items (les anciens restent).
**Dépend de** : aucune.
**Estimation** : L
**Risques** : casse de l'intégrité order-payment-JE — testing exhaustif.
**Notes** : ne pas confondre avec void+recreate ; ici on garde l'order_id et son numéro.

### TASK-02-017 — Vue calendrier des commandes différées [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No `/orders/calendar` page or calendar component. Not in Session 13 scope.
**Contexte** : pour les commandes pré-réservées (B2B livré dans 3 jours, événement client à venir), pas de vue planning visuelle.
**Bénéfice attendu** : calendrier (jour/semaine/mois) montrant les commandes par date de livraison/échéance.
**Critère d'acceptation** :
- [ ] Nouvelle page `/orders/calendar` ou onglet sur `OrdersPage`.
- [ ] Vue jour : timeline horaire avec slots de commandes.
- [ ] Vue semaine : grille 7 colonnes.
- [ ] Vue mois : calendrier classique avec badges.
- [ ] Filtre par type (B2B, takeaway prévu, delivery).
- [ ] Click → modale détail.
**Dépend de** : aucune.
**Estimation** : L
**Risques** : duplication avec module B2B calendar (si existe) — réutiliser composant.
**Notes** : librarie `react-big-calendar` ou équivalent.

### TASK-02-018 — Export PDF par commande [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No `generate-receipt-pdf` Edge Function in `supabase/functions/` (only `process-payment`, `refund-order`, etc.). Carry-over.
**Contexte** : aujourd'hui l'export Orders est CSV uniquement. Pour envoyer un ticket en e-mail à un client après coup, il faut un PDF.
**Bénéfice attendu** : re-générer le ticket en PDF (mise en forme reçu thermique ou A4 facture).
**Critère d'acceptation** :
- [ ] Bouton "PDF" dans modale détail Orders.
- [ ] Génération via Edge Function `generate-receipt-pdf` (réutilise le template existant).
- [ ] Download direct + option "Envoyer par email" (champ destinataire).
- [ ] Format imprimable A5 + version thermique 80mm.
**Dépend de** : Edge Function `generate-receipt-pdf` (doit exister ou être créée).
**Estimation** : M
**Risques** : timeout Edge Function si bcp d'items — paginer le PDF si > 30 lignes.
**Notes** : aligne sur le template de la facture B2B pour cohérence visuelle.

### TASK-02-019 — Lien direct vers le KDS [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No `?highlight=` query-param wired in V3 KDS (`apps/pos/src/features/kds/`). Carry-over.
**Contexte** : depuis la modale détail Orders, pas de raccourci pour aller voir un item au KDS.
**Bénéfice attendu** : bouton "Voir au KDS" qui ouvre la station correspondante avec l'item surligné.
**Critère d'acceptation** :
- [ ] Bouton par item dans la modale détail.
- [ ] Action : nav vers `/kds/<station>?highlight=<order_item_id>`.
- [ ] Côté KDS : surlignage visuel 5s + scroll auto vers l'item.
**Dépend de** : aucune.
**Estimation** : S
**Risques** : aucun.
**Notes** : utile pour le manager qui veut accélérer un cas.

---

## Backlog métier (objectif fonctionnel — app POS)

> Items issus de `docs/_archive/objectif-travail-v2/POS.md` §18 — vision produit de l'app POS (caisse).
> Ajoutés 2026-05-13 lors de la cascade docs (session 13). Customer-facing payment QR est déjà couvert par TASK-16-006 (cascade Customer Display).

### TASK-02-020 — Mode dégradé offline (POS resilience) [P2] [TODO]
**Status note (2026-05-14)** : Partial — read-only offline shipped. Phase 4.A delivered `isOffline` flag + `initNetworkListener` + browse-cached-products graceful degrade (`apps/pos/src/stores/cartStore.ts:63-156`). Full IndexedDB queue + `sync_offline_transactions` RPC NOT built — that's a Wave 7+ XL effort. Keep TODO for the queue-write half.
**Contexte** : aujourd'hui une coupure réseau bloque toute transaction POS. Pour une boutique en zone à connexion fragile, c'est rédhibitoire.
**Bénéfice attendu** : continuer à encaisser pendant une coupure courte (<10 min), queue local sync au retour réseau.
**Critère d'acceptation** :
- [ ] Cache IndexedDB des produits + clients + sessions actives.
- [ ] Queue locale `pending_transactions` lors de coupure (chiffrée).
- [ ] Bandeau "Mode dégradé — N transactions en attente de sync".
- [ ] Sync auto au retour réseau (RPC `sync_offline_transactions`).
- [ ] Réconciliation : conflit numérotation séquentielle → re-numérotation à la sync.
- [ ] Limite stricte : refuser nouvelles transactions au-delà de 15 min offline (intégrité comptable).
**Dépend de** : refonte significative du flow POS.
**Estimation** : XL
**Risques** : intégrité comptable — chaque transaction offline doit produire un JE rétroactif cohérent ; testing exhaustif obligatoire.
**Notes** : pattern Square / Shopify POS — étudier leurs solutions.

### TASK-02-021 — Pre-authorization cartes [P2] [BLOCKED]
**Status note (2026-05-14)** : Deferred to Session 18+ (payment-provider integration). Requires Stripe Terminal or local Indonesian equivalent + capture/auth flow — not on Session 13/14 roadmap. INDEX Wave 7 lists payment-provider work as out-of-scope.
**Contexte** : pour dine-in, le client paie en fin de repas. Si la carte est refusée au paiement final, conflit. Pré-autoriser le montant estimé à l'arrivée résout le risque.
**Bénéfice attendu** : "tap card on entry" → montant estimé pré-autorisé → finalisation au départ (capture exacte).
**Critère d'acceptation** :
- [ ] Intégration provider paiement (Stripe Terminal ou équivalent local) qui supporte auth+capture.
- [ ] UI : à l'ouverture d'une table, option "Pré-autoriser carte".
- [ ] Montant pré-auth = montant estimé (ex: panier moyen × N couverts).
- [ ] À la clôture commande : capture exacte du montant final.
- [ ] Si capture > pre-auth : capture du delta en seconde transaction.
- [ ] Si client part sans payer : capture forcée après timeout.
**Dépend de** : provider de paiement compatible (à valider avec partenaire indonésien).
**Estimation** : XL
**Risques** : friction client (sortir la carte 2 fois) — UX et formation staff cruciales.
**Notes** : pattern restaurants haut de gamme US/Europe ; rare en Indonésie.

### TASK-02-022 — Réservation / pré-commande client (avec acompte) [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No `reserved` status on `orders.status` (V3 schema). Not in Session 13 scope.
**Contexte** : pour les commandes spéciales (gâteau anniversaire, événement), pas de workflow réservation avec acompte. Tout se gère par téléphone + Excel.
**Bénéfice attendu** : prendre une commande à retirer plus tard, encaisser un acompte, finaliser à la livraison.
**Critère d'acceptation** :
- [ ] Statut `reserved` ajouté à `orders.status` (avant `pending`).
- [ ] UI POS : nouveau mode "Réservation" avec date/heure de retrait + acompte.
- [ ] Acompte = paiement partiel marqué.
- [ ] Page `/pos/reservations` : liste des réservations à venir + relances J-1.
- [ ] À la conversion en commande active : reprendre les items + solder le reste.
**Dépend de** : `TASK-02-017` (vue calendrier) pour visualisation.
**Estimation** : L
**Risques** : annulation par client → politique d'acompte (remboursable ou non).
**Notes** : critique pour la pâtisserie d'événement.

### TASK-02-023 — Tableau "Tables ouvertes" en vue principale [P3] [TODO]
**Contexte** : le `TableSelectionModal` montre le floor plan mais ce n'est pas la vue principale du POS dine-in. Le manager doit naviguer pour savoir l'état des tables.
**Status note (2026-05-14)** : Genuinely undone. V3 has `apps/pos/src/features/tables/components/TableSelectorButton.tsx` (modal-based) but no "main view toggle" with permanent floor occupancy. Carry-over.
**Bénéfice attendu** : vue principale dédiée dine-in qui affiche en permanence le statut de chaque table (vide / commandée / servie / à encaisser).
**Critère d'acceptation** :
- [ ] Toggle "Vue Tables" en haut du POS (alternative à grille produits).
- [ ] Grille tactile des tables avec : numéro, couverts, durée occupée, total commande en cours, statut (couleur).
- [ ] Click table → ouvre directement le cart en cours.
- [ ] Timer "table assise depuis Xmin" pour anticipation rotations.
**Dépend de** : aucune.
**Estimation** : M
**Risques** : encombrement écran si beaucoup de tables — limite à 30 visibles + scroll.
**Notes** : pattern POS restaurant haut volume.

### TASK-02-024 — Quick reorder (refaire la même commande) [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No "Reorder" button in V3 OrderHistoryPanel or customer fiche. Carry-over.
**Contexte** : pour les habitués, refaire la même commande qu'hier ou la semaine dernière nécessite de tout retaper.
**Bénéfice attendu** : depuis l'historique client, bouton "Refaire" qui pré-remplit le cart avec les items de la commande précédente.
**Critère d'acceptation** :
- [ ] Bouton "Reorder" dans la modale détail commande + dans la fiche client.
- [ ] Clone des items + modifiers dans le cart courant.
- [ ] Si produits indisponibles (stock zéro, retirés du catalogue), affichage alerte.
- [ ] Recalcul prix au tarif actuel (pas le tarif d'origine).
**Dépend de** : aucune.
**Estimation** : M
**Risques** : confusion sur les modifications produit/prix depuis la commande source — bien indiquer "prix recalculés".
**Notes** : UX critique pour les habitués matin/café.

### TASK-02-025 — Voice search produit/client [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred to Session 19+ per INDEX Wave 7 deferral list ("Voice ordering / advanced ML / OCR / 2FA (Session 19+)").
**Contexte** : en rush, taper sur le clavier virtuel pour rechercher un client ou un produit est lent.
**Bénéfice attendu** : "Cappuccino" ou "Maya" prononcés à voix → recherche instantanée.
**Critère d'acceptation** :
- [ ] Web Speech API (Chromium).
- [ ] Bouton micro dans la barre de recherche.
- [ ] Confidence threshold haute (>80%) pour éviter faux positifs en cuisine bruyante.
- [ ] Toggle Settings (off par défaut).
**Dépend de** : navigateur compatible.
**Estimation** : M
**Risques** : faux positifs en bruit — confirmation visuelle pré-action.
**Notes** : pattern Apple Store Genius — validé en environnement bruyant.

### TASK-02-026 — Suggested upsell (basket analysis) [P3] [TODO]
**Status note (2026-05-14)** : Partial — basket-analysis RPC shipped (`supabase/migrations/20260517000213_create_basket_analysis_rpc.sql`, Phase 6.A) but no POS-side upsell badge UI consumes it. Suggestion engine half-built; UI half is undone.
**Contexte** : aucune suggestion de complément aujourd'hui. Manque d'opportunité commerciale.
**Bénéfice attendu** : "Voulez-vous un café avec ?" basé sur l'analyse des paniers historiques.
**Critère d'acceptation** :
- [ ] RPC `get_upsell_suggestions(p_cart_items)` qui retourne les top 3 produits fréquemment co-achetés.
- [ ] UI : badge discret "Suggestion" sur certains produits quand on en ajoute un déclencheur.
- [ ] Toggle Settings.
- [ ] Tracking : combien de suggestions acceptées (conversion).
**Dépend de** : volume historique 3 mois minimum.
**Estimation** : M
**Risques** : trop intrusif → cashier rejette la suggestion → frustration. Discret, jamais bloquant.
**Notes** : pattern recommendation engine classique.

### TASK-02-027 — Multi-currency POS [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred to Session 14 per INDEX Wave 7 deferred list ("Multi-currency end-to-end | 14"). Depends on TASK-10-019.
**Contexte** : touriste paie en USD ou EUR — aujourd'hui conversion manuelle.
**Bénéfice attendu** : encaisser une commande en devise étrangère avec conversion auto au taux du jour.
**Critère d'acceptation** :
- [ ] `PaymentMethodSelector` ajoute "Cash USD/EUR" si toggle Settings actif.
- [ ] Taux du jour récupéré via `exchangeRateService` (TASK-10-019).
- [ ] Conversion auto vers IDR pour l'enregistrement comptable.
- [ ] Écriture compta double : encaissement IDR + écart de change.
**Dépend de** : `TASK-10-019` (multi-devise Accounting).
**Estimation** : L
**Risques** : taux mal ajusté → perte ou conflit client — afficher clairement le taux appliqué.
**Notes** : niche mais valorisant en zone touristique Bali.

---

## Notes transverses

- **Pitfall locked items** : tests obligatoires sur la modification d'un item « kitchen-sent » sans PIN — c'est le rempart UX principal.
- **Subscription pattern** : `cartStore.subscribeWithSelector` alimente `useDisplayBroadcast`. Toute modif store doit préserver ce comportement.
- **Promotions auto** : `useCartPromotions` se déclenche sur chaque mutation cart. Toute optimisation perf doit valider que les promos restent calculées.
- **POSAccessGuard** : protège la route POS via permission. Le panier peut être chargé avant que le guard finisse → race condition potentielle, à investiguer.


**S21 update (2026-05-18):** `ChangePinModal` UX polish — (b) PIN strength hint surfaces at step 2 (entry) not step 3 (confirm), (c) on new/confirm mismatch, wizard resets to step 2 (entry) preserving current PIN. (a) `NumpadPin` → `PinPad` swap NOT viable (`PinPad` is EF-wired verification-only ; DEV-S21-1.C.4-01 documented in-file). Closes DEV-S19-3.C-02/03 ; DEV-S19-3.C-01 superseded by accepted deviation.
