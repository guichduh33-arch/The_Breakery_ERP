# Travail — KDS / Kitchen

> Last updated: 2026-05-03
> Référence : `docs/v2-reference/04-modules/04-kds-kitchen.md` (à créer)
> Audits sources : `04-reports-testing-audit.md`, `05-uiux-design-audit.md`, `08-operations-lan-audit.md`

## Objectifs du module

1. **Hub orchestre vraiment le KDS flow** : tracking ACK + status au niveau hub pour visibilité POS. Critère : POS voit l'état temps réel de chaque item (preparing/ready) sans se reconnecter.
2. **Performance rendu KDS** : 50+ orders en file sans drop framerate. Critère : 60 fps sur tablet kitchen mid-range.
3. **Robustesse coupures réseau** : KDS continue à fonctionner localement et resync proprement à la reconnexion. Critère : test débranchement 5 min → resync OK.
4. **Configuration UI station** : créer/éditer/router stations sans toucher au DB. Critère : un manager configure stations en 2 minutes.

---

## Tâches

### TASK-04-001 — Hub processe `KDS_ORDER_ACK` + status messages [P2] [TODO]
**Contexte** : Sur les 35 LAN message types, le hub n'en traite que 5. KDS envoie `KDS_ORDER_ACK`, `KDS_ORDER_READY`, `KDS_ITEM_PREPARING`, `KDS_ITEM_READY`, `KDS_ORDER_BUMP` mais le hub les laisse tomber dans le `default`. Conséquence : le POS ne sait pas si un order a été acknowledgé par la cuisine. Source : `docs/audit/08-operations-lan-audit.md§P2-1` + `§4.4 P2`.
**Critère d'acceptation** :
- [ ] Handlers ajoutés dans `lanHubMessageHandler.processMessage()` pour les 5 KDS_* messages.
- [ ] Hub met à jour un état partagé (table `kds_order_status` ou store) avec timestamp ACK / preparing / ready.
- [ ] POS subscribe à cet état pour afficher badge « In kitchen » / « Ready » sur les held orders.
- [ ] Idempotence : recevoir 2 fois le même ACK = no-op.
- [ ] Tests : E2E POS → KDS → ACK → POS voit l'état.
**Fichiers concernés** : `src/services/lan/lanHubMessageHandler.ts`, `src/stores/orderStore.ts`, nouveau hook `useKdsOrderStatus.ts` côté POS.
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Augmenter le trafic LAN. Vérifier que les handlers ne re-broadcastent pas inutilement.

### TASK-04-002 — Station configuration UI improvements [P2] [TODO]
**Contexte** : `kds_stations` table existe (cf. `CLAUDE.md` LAN section). UI actuelle dans `/settings/kds` (ou équivalent) est basique. Manager devrait pouvoir créer une station, lui assigner des catégories produits, et router via drag & drop. Inferred from code review + UX gap.
**Critère d'acceptation** :
- [ ] Page `/settings/kds-stations` : liste + CRUD stations.
- [ ] Edit station : nom, type (kitchen/barista/bar/cold), couleur, catégories produits assignées (multi-select).
- [ ] Preview en temps réel : « si je commande X, ça part à station Y ».
- [ ] Drag & drop catégories entre stations (réutiliser @dnd-kit déjà dépendance).
- [ ] Validation : au moins 1 station active obligatoire.
**Fichiers concernés** : `src/pages/settings/KdsStationsSettingsPage.tsx` (à créer ou refactor), `src/hooks/kds/useKdsStations.ts`, modal d'édition.
**Dépend de** : aucune
**Estimation** : `L`
**Risques** : Re-routing en plein service = chaos. Empêcher les modifs si stations actives.

### TASK-04-003 — Status flow gaps [P2] [TODO]
**Contexte** : Audit reports détecte que `service_speed` report est caché car RPC `get_kds_service_speed_stats` manquant. Le flow actuel n'enregistre pas tous les timestamps nécessaires. Source : `docs/audit/04-reports-testing-audit.md§P1-3` + `§Phase 6 missing report`.
**Critère d'acceptation** :
- [ ] Migration : colonnes timestamps sur `order_items` : `acked_at`, `preparing_at`, `ready_at`, `served_at`.
- [ ] Triggers ou hooks qui setent ces timestamps lors des transitions status.
- [ ] RPC `get_kds_service_speed_stats(date_from, date_to)` qui retourne avg/p95 par étape, par station.
- [ ] Unhide `service_speed` report dans `ReportsConfig.tsx`.
- [ ] Tests : commande complète → report montre des durées plausibles.
**Fichiers concernés** : nouvelle migration, `src/hooks/kds/useKdsOrderActions.ts`, `src/services/reporting/reportingFinancialService.ts:184`, `src/pages/reports/ReportsConfig.tsx`.
**Dépend de** : `TASK-04-001` (ACK timestamp doit venir du hub)
**Estimation** : `L`
**Risques** : Migration sur table volumineuse → backfill long. Faire en deux temps (colonnes nullables d'abord, backfill après).

### TASK-04-004 — Performance rendu (large queues) [P2] [TODO]
**Contexte** : `KDSOrderGrid` rend tous les orders dans le DOM. À 50+ orders, perf chute. Pas de virtualisation détectée. Inferred from code review + `docs/audit/03-code-quality-schema-audit.md§B5` (virtualization not checked).
**Critère d'acceptation** :
- [ ] Mesure baseline : 50 orders → FPS / mount time / memory.
- [ ] Si seuil dépassé : intégrer `@tanstack/react-virtual` (pas encore dépendance).
- [ ] Conserver le grid responsive 1-6 colonnes (cf. UX audit `KDSOrderGrid`).
- [ ] Cible : 60 fps avec 100 orders en file.
- [ ] Smoke test sur tablet réelle avant merge.
**Fichiers concernés** : `src/components/kds/KDSOrderGrid.tsx`, `src/components/kds/KDSOrderCard.tsx`.
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Virtualisation casse les hauteurs dynamiques (cards expandables). Tester chaque interaction.

### TASK-04-005 — Drag & drop UX (réordonnancement orders) [P3] [TODO]
**Contexte** : Cuisine veut parfois reprioriser visuellement (ex : VIP, allergie). Pas de DnD actuellement. Inferred from observed kitchen workflow.
**Critère d'acceptation** :
- [ ] DnD sur les cards orders dans `KDSOrderGrid` (réutiliser @dnd-kit).
- [ ] L'ordre custom est local au KDS (pas push DB).
- [ ] Sauvegarde dans sessionStorage pour survivre refresh.
- [ ] Touch-friendly (long-press pour drag).
- [ ] Reset bouton « Restore default order ».
**Fichiers concernés** : `src/components/kds/KDSOrderGrid.tsx`, nouveau hook `useKdsOrderManualSort.ts`.
**Dépend de** : `TASK-04-004` (idéalement après virtualisation)
**Estimation** : `M`
**Risques** : Sur-feature pour ~200 tx/jour. Valider avec cuisine avant.

### TASK-04-006 — Real-time gracieux si LAN client perdu [P2] [TODO]
**Contexte** : `lanClient` reconnecte avec backoff (1s base, 60s max, 10 attempts) mais le KDS UI peut afficher un état stale sans alerter l'utilisateur. Source : `docs/audit/08-operations-lan-audit.md§1.1 reconnection`.
**Critère d'acceptation** :
- [ ] Banner KDS visible si `lanStore.connectionStatus !== 'connected'`.
- [ ] Mode dégradé : KDS continue à afficher les orders en cache, marque chaque card avec timestamp dernière sync.
- [ ] À la reconnexion : full sync request automatique au hub.
- [ ] Sound alert si disconnect > 60s (configurable).
- [ ] Tests : kill du hub, vérifier UX KDS.
**Fichiers concernés** : `src/pages/kds/KdsStationPage.tsx`, `src/components/kds/KdsConnectionBanner.tsx` (à créer).
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Faux positifs (perte momentanée WiFi normale). Seuil 60s pour éviter alert fatigue.

### TASK-04-007 — Multi-station routing rules avancées [P3] [TODO]
**Contexte** : Routing actuel : produit → catégorie → station via mapping simple. Cas complexes (un produit avec plusieurs étapes, ex : sandwich = bread + filling depuis 2 stations) pas géré. Inferred from product complexity + bakery workflow.
**Critère d'acceptation** :
- [ ] Schema : un product peut avoir N stations (table `product_kds_stations`).
- [ ] Combo dispatch déjà OK (cf. `CURRENT_STATE.md` C4) → étendre aux produits multi-station.
- [ ] UI dans `/products/edit` : multi-select stations.
- [ ] Tests : produit assigné à 2 stations → 2 KDS reçoivent l'item.
**Fichiers concernés** : nouvelle migration, `src/services/kds/kdsDispatcher.ts`, `src/components/products/ProductForm.tsx`.
**Dépend de** : `TASK-04-002`
**Estimation** : `L`
**Risques** : Complexité métier. Valider avec bakery owner.

### TASK-04-008 — Bell sound / customizable per-station [P3] [TODO]
**Contexte** : `KdsSoundService` minimal : 3 sons fixes (new/urgent/ready), 1 toggle global. Pas de volume, pas de son par station, pas de visual-only mode. Source : `docs/audit/08-operations-lan-audit.md§4.4 P3` + `§5 Recommendations P3-10`.
**Critère d'acceptation** :
- [ ] Setting volume slider (0-100).
- [ ] Sound pack par station (kitchen / bar / cold) avec fichiers MP3 customisables.
- [ ] Mode « visual only » (LED-style flash visuel à la place du son).
- [ ] Test sound button dans settings.
- [ ] Persistance par device (localStorage scoped device_id).
**Fichiers concernés** : `src/services/kds/kdsSoundService.ts`, `src/pages/settings/KdsSoundSettingsPage.tsx` (à créer).
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Fichiers audio embarqués augmentent bundle. Lazy load.

---

## Notes transverses

- **Combo KDS dispatch** : déjà OK depuis Sprint 0 C4 (cf. `CURRENT_STATE.md`). Toute nouvelle logique routing doit préserver le combo handling.
- **Real-time channels** : KDS dépend de Supabase Realtime (`'lan-hub'`) ET BroadcastChannel (`'appgrav-lan'`). Toute modif doit gérer les deux.
- **Dedup orders** : `useKdsOrderQueue.addOrder` dedup par `order.id`. Pitfall : le dedup global LAN (TASK-11-XXX si module LAN créé) compléterait ce safety net.
- **Pages docs** : créer `docs/v2-reference/04-modules/04-kds-kitchen.md` après les premières tâches DONE.
