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

### TASK-02-001 — Décomposer `cartStore.ts` (625 lignes) en slices [P2] [TODO]
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

### TASK-02-002 — Edge cases lockedItems sur network split / re-mount POS [P1] [TODO]
**Contexte** : Quand le POS perd la connexion après envoi en cuisine puis se remonte, l'état locked peut diverger entre cartStore (sessionStorage) et l'état réel des order_items côté DB. Risque : un item cuisiné devient modifiable côté POS. Inferred from code review + LAN audit (message dedup absent).
**Critère d'acceptation** :
- [ ] Au mount POS, refetch les `order_items` actifs et reconstruire le set `lockedItems` depuis la DB plutôt que la session.
- [ ] Si conflit (item local non-locked mais DB le considère envoyé), appliquer la version DB et logger un warning.
- [ ] Tests d'intégration : simulation perte réseau → POS reconnect → état restauré.
- [ ] Documenter le pattern dans `docs/v2-reference/04-modules/02-pos-cart-orders.md`.
**Fichiers concernés** : `src/stores/cartStore.ts`, `src/hooks/pos/useCartHydration.ts` (à créer), `src/services/pos/orderService.ts`.
**Dépend de** : `TASK-02-001` (slices propres avant cette logique)
**Estimation** : `M`
**Risques** : Refetch trop fréquent → coût Supabase. Limiter au mount POS et après visibilitychange.

### TASK-02-003 — Optimisations cart re-render [P2] [TODO]
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

### TASK-02-004 — VirtualKeypad UX improvements [P2] [TODO]
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

### TASK-02-007 — Performance bundle size POS page [P2] [TODO]
**Contexte** : Vite split déjà actif, mais POS page bundle pourrait être réduit (Recharts inutile sur POS, jsPDF lazy à confirmer). Source : `docs/audit/08-operations-lan-audit.md§5.4` (vendor-react ~620KB).
**Critère d'acceptation** :
- [ ] `npm run build -- --mode=analyze` (ou `vite-bundle-visualizer`).
- [ ] POS page chunk principal < 250 KB gzipped.
- [ ] Recharts, jsPDF, XLSX exclus du POS chunk (chargés à la demande backoffice).
- [ ] Lighthouse mobile POS Performance ≥ 85.
- [ ] Documenter dans `docs/v2-reference/10-deployment-ops/` les chunks attendus.
**Fichiers concernés** : `vite.config.ts`, `src/routes/posRoutes.tsx`, audit dynamiques imports dans `src/components/pos/`.
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Casser un import dynamique mal configuré → erreur runtime. Tester chaque page POS après split.

### TASK-02-008 — Supprimer le double checkout (`POSCheckoutWrapper` legacy) [P2] [TODO]
**Contexte** : Deux UIs de checkout coexistent : `POSCheckoutWrapper.tsx` (simpler, station hardcoded) et `PaymentModal.tsx` (full split-payment). Le wrapper semble dead code mais reste dans le bundle. Source : `docs/audit/05-uiux-design-audit.md§U1` + `§POS-P2`.
**Critère d'acceptation** :
- [ ] Confirmer via grep + git history que `POSCheckoutWrapper.tsx` n'est plus utilisé en runtime.
- [ ] Supprimer le composant + ses imports.
- [ ] Mettre à jour `docs/v2-reference/04-modules/02-pos-cart-orders.md` (référence obsolète).
- [ ] Tests visuels : le checkout actif (`PaymentModal`) couvre tous les cas.
**Fichiers concernés** : `src/components/pos/POSCheckoutWrapper.tsx` (suppression), `src/components/pos/POSTerminalWrapper.tsx`, `src/pages/pos/POSPage.tsx`.
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : Supprimer un usage caché (lazy route). Grep + tests E2E avant merge.

### TASK-02-009 — Cmd+K (CommandPalette) sur POS [P3] [TODO]
**Contexte** : CommandPalette existe en BackOffice mais pas en POS. Un cashier rapide peut bénéficier de raccourcis (Hold order, Discount, Customer search). Source : `docs/audit/05-uiux-design-audit.md§N1`.
**Critère d'acceptation** :
- [ ] CommandPalette POS avec actions : Hold order, New order, Customer search, Discount, Cash drawer, Z-report.
- [ ] Raccourci Cmd+K (Mac) / Ctrl+K (Windows / Linux) sur POSTerminalWrapper.
- [ ] Filtrage par fuzzy search (cmdk lib, déjà dépendance).
- [ ] `shouldFilter={false}` si on alimente côté Supabase (cf. Pitfall epic-016b).
- [ ] Documenter les raccourcis dans `docs/v2-reference/02-design-system/`.
**Fichiers concernés** : `src/components/pos/POSCommandPalette.tsx` (à créer), `src/components/pos/POSTerminalWrapper.tsx`.
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Conflit raccourcis avec navigateur ou Capacitor. Tester cross-platform.

### TASK-02-010 — Wire up Account button (CategoryNav bottom) [P3] [TODO]
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

## Notes transverses

- **Pitfall locked items** : tests obligatoires sur la modification d'un item « kitchen-sent » sans PIN — c'est le rempart UX principal.
- **Subscription pattern** : `cartStore.subscribeWithSelector` alimente `useDisplayBroadcast`. Toute modif store doit préserver ce comportement.
- **Promotions auto** : `useCartPromotions` se déclenche sur chaque mutation cart. Toute optimisation perf doit valider que les promos restent calculées.
- **POSAccessGuard** : protège la route POS via permission. Le panier peut être chargé avant que le guard finisse → race condition potentielle, à investiguer.
