# Travail — KDS / Kitchen

> Last updated: 2026-05-03
> Référence : `docs/reference/04-modules/04-kds-kitchen.md` (à créer)
> Audits sources : `04-reports-testing-audit.md`, `05-uiux-design-audit.md`, `08-operations-lan-audit.md`

## Objectifs du module

1. **Hub orchestre vraiment le KDS flow** : tracking ACK + status au niveau hub pour visibilité POS. Critère : POS voit l'état temps réel de chaque item (preparing/ready) sans se reconnecter.
2. **Performance rendu KDS** : 50+ orders en file sans drop framerate. Critère : 60 fps sur tablet kitchen mid-range.
3. **Robustesse coupures réseau** : KDS continue à fonctionner localement et resync proprement à la reconnexion. Critère : test débranchement 5 min → resync OK.
4. **Configuration UI station** : créer/éditer/router stations sans toucher au DB. Critère : un manager configure stations en 2 minutes.

---

## Tâches

### TASK-04-001 — Hub processe `KDS_ORDER_ACK` + status messages [P2] [TODO]
**Status note (2026-05-14)** : Partial — LAN hub ported in Phase 5.A (`apps/pos/src/features/lan/lanHub.ts`, `lanHubMessageHandler.ts`, `lanClient.ts`, `__tests__/lanHub.dedup.test.ts`) with message dedup. Phase 4.B `useKdsRealtime` exposes `onEvent` callback that 5.A wires to `useLanClient.send` for peer-to-peer bumps. The specific `KDS_ORDER_ACK` semantic (POS-side "kitchen received" badge) is not explicitly built; the bump broadcast covers the inverse direction. Manual review.
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
**Status note (2026-05-14)** : Partial — DB foundation shipped via migration `20260517000150_add_categories_kds_station.sql` (Phase 4.B) which adds `categories.kds_station` enum + permission `kds.operate` + legacy `dispatch_station` mapping (D-W4-4B-01). No `/settings/kds-stations` BO CRUD page or drag-and-drop UI was built. Carry-over for the UI half.
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

### TASK-04-003 — Status flow gaps [P2] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 4.B. V3 evidence: `order_items.prep_started_at` + `bumped_at` columns added in migration `20260517000150_add_categories_kds_station.sql`; RPCs `kds_start_prep_timer_v1`, `kds_bump_item_v1`, `kds_undo_bump_v1`, `kds_recall_order_v1` in `…000151`; service-speed signal surfaced via `ServiceSpeedIndicator.tsx` (Phase 4.A consumes `get_sales_by_hour_v1` + client-side avg, per D-W4-4A-03). `ready_at`/`served_at` already existed in V3. Commit `bdf21aa`.
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
**Status note (2026-05-14)** : Genuinely undone. No `@tanstack/react-virtual` integration in V3 KDS (`apps/pos/src/features/kds/components/KdsOrderCard.tsx` rendered via plain map). Carry-over; revisit only if a real-shop test surfaces FPS drop.
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
**Status note (2026-05-14)** : Genuinely undone. No DnD on `apps/pos/src/features/kds/components/KdsOrderCard.tsx`. Not in Session 13 scope.
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
**Status note (2026-05-14)** : Partial — Phase 5.A LAN port shipped (`apps/pos/src/features/lan/`) with message dedup, but no `KdsConnectionBanner.tsx` or "stale state" UX visible in `apps/pos/src/features/kds/` (grep for `KdsConnection` returns 0 hits). UI-banner half remains undone.
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
**Status note (2026-05-14)** : Genuinely undone. No `product_kds_stations` junction table in V3 migrations. Carry-over to a future products/KDS phase.
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
**Status note (2026-05-14)** : Genuinely undone. No `KdsSoundService` in V3 (`apps/pos/src/features/kds/` has no audio files or sound hook); per Phase 4.C deviation `D-W4-4C-04`, audio chime is deferred to Phase 5.A LAN handlers. Carry-over.
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

## Backlog métier (objectif fonctionnel)

> Items issus de `docs/_archive/objectif-travail-v2/KDS.md` §16 — vision produit du module.
> Ajoutés 2026-05-13 lors de la cascade docs (session 13).

### TASK-04-009 — Service Speed report [P2] [TODO]
**Status note (2026-05-14)** : Partial — Phase 4.A surfaces a `ServiceSpeedIndicator` badge in POS header (good/busy/slow) but no dedicated `/reports/kds-service-speed` BO page with per-cuisinier breakdown / CSV export. Per D-W4-4A-03, V3 deliberately did not build a `get_avg_fulfillment_by_hour_v1` MV — the indicator does a client-side scan. Carry-over for the full report page.
**Contexte** : aujourd'hui aucune mesure du temps de préparation. Les goulots cuisine restent invisibles.
**Bénéfice attendu** : mesurer le temps moyen de préparation par item / station / cuisinier — identifier les goulots et calibrer les seuils urgence.
**Critère d'acceptation** :
- [ ] Trigger sur `order_items.item_status` qui timestamp chaque transition (`pending→preparing`, `preparing→ready`).
- [ ] Vue `view_service_speed_per_item` : pour chaque order item, durée totale + durée par phase.
- [ ] RPC `get_service_speed_stats(p_start, p_end, p_station, p_product_id)` : moyennes, médianes, P95.
- [ ] Page `/reports/kds-service-speed` : tableau + graphique par station + par cuisinier (si user_id tracé).
- [ ] Export CSV / PDF.
**Dépend de** : tracer `prepared_by` user_id sur item (à ajouter si non présent).
**Estimation** : M
**Risques** : surveillance cuisinier perçue comme flicage — communiquer en transparence + KPI collectif d'abord.
**Notes** : pose le socle pour les futurs reports productivité.

### TASK-04-010 — Throttling intelligent (file d'attente saturée) [P2] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No `KDS_THROTTLE_STATUS` message type or backlog-by-station counter (grep `KDS_THROTTLE` across repo returns 0 hits). Carry-over.
**Contexte** : quand 20 cafés arrivent en 30 secondes au barista, l'écran sature mais aucun signal au caissier qui continue à envoyer.
**Bénéfice attendu** : KDS détecte la saturation → notifie le caissier ("Barista saturé — attendre 2 min") pour mieux calibrer le rythme.
**Critère d'acceptation** :
- [ ] Calcul backlog par station : nb d'items `pending` + `preparing` non encore `ready`.
- [ ] Seuils configurables Settings → KDS Configuration (`throttle_warning_threshold`, `throttle_critical_threshold`).
- [ ] Message LAN `KDS_THROTTLE_STATUS` envoyé au POS hub avec niveau (ok / warning / critical) par station.
- [ ] POS affiche un badge "Barista saturé" sur le bouton "Envoyer" + son optionnel.
- [ ] Pas de blocage hard — c'est un signal, pas un verrou.
**Dépend de** : aucune.
**Estimation** : M
**Risques** : seuils mal calibrés → spam d'alertes ou silence trompeur — itérer avec l'équipe.
**Notes** : `TASK-04-001` (KDS_ORDER_ACK) est un prérequis logique pour le canal de retour.

### TASK-04-011 — Chat inter-stations [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No `kds_messages` table in `supabase/migrations/`. Carry-over.
**Contexte** : aujourd'hui, une station qui veut alerter une autre doit aller crier. Pour les cas borderline ("le sandwich n°124 doit attendre la frite"), c'est inefficace et stressant.
**Bénéfice attendu** : messagerie courte entre stations avec messages prédéfinis + notification sonore.
**Critère d'acceptation** :
- [ ] Table `kds_messages` (from_station, to_station, order_id, message_template, custom_text, created_at, read_at).
- [ ] UI overlay messagerie sur `KDSOrderCard` : bouton "Message à barista" avec templates ("Attendre", "Doubler", "Annulé").
- [ ] Réception : badge sur la carte concernée + son distinct.
- [ ] Auto-archive après ack.
**Dépend de** : aucune.
**Estimation** : M
**Risques** : usage détourné en chat libre → templates verrouillés V1, libre V2.
**Notes** : KISS — 6-8 templates suffisent.

### TASK-04-012 — Mode urgences (URGENT button) [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No `order_items.is_urgent` column or `kds.escalate` permission in V3. Carry-over.
**Contexte** : pas de moyen de forcer un item en haut de la pile pour une commande VIP ou une réclamation client en cours.
**Bénéfice attendu** : bouton "URGENT" qui passe immédiatement l'item en rouge + en tête de file + son d'alerte cuisine.
**Critère d'acceptation** :
- [ ] Bouton "URGENT" sur `KDSOrderCard` (permission `kds.escalate` — manager only).
- [ ] Marquage `order_items.is_urgent = true` + reordering automatique.
- [ ] Son d'alerte spécifique à l'urgence.
- [ ] Audit log de toutes les escalades + raison obligatoire.
**Dépend de** : aucune.
**Estimation** : S
**Risques** : abus → exiger raison + audit visible.
**Notes** : par défaut désactivé en config, activable par cuisine.

### TASK-04-013 — Reroute manuel [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No `order_items.station_override` column or "Move to..." UI on KdsOrderCard. Carry-over.
**Contexte** : si un produit est mal catégorisé (`dispatch_station` erroné), l'item arrive sur la mauvaise station. Aujourd'hui personne ne peut le corriger en runtime — il faut modifier la catégorie et re-envoyer.
**Bénéfice attendu** : le manager peut transférer un item d'une station à une autre depuis le KDS (correction ponctuelle).
**Critère d'acceptation** :
- [ ] Bouton "Move to..." sur `KDSOrderCard` (long press item, permission manager).
- [ ] Selector station cible.
- [ ] Update `order_items.station_override`.
- [ ] Audit log de chaque reroute.
**Dépend de** : aucune.
**Estimation** : S
**Risques** : confusion si reroute fréquent → indicateur "Corrigez la catégorie produit" si > 3 reroutes/jour.
**Notes** : aussi utile pour les cas exceptionnels (panne d'équipement station).

### TASK-04-014 — Persistance offline (cache local + sync) [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No IndexedDB caching for KDS in V3. Depends on TASK-04-006 which is itself partial. Carry-over.
**Contexte** : `TASK-04-006` (Real-time gracieux LAN perdu) couvre le fallback Realtime. Mais une double panne (LAN + internet) bloque la réception. Pour les courtes coupures, un cache local serait robuste.
**Bénéfice attendu** : le KDS continue à afficher les dernières commandes connues, et synchronise au retour réseau.
**Critère d'acceptation** :
- [ ] Cache IndexedDB des commandes actives (et leur statut).
- [ ] Au boot KDS : charger depuis cache puis sync.
- [ ] Bandeau "Mode dégradé (cache local)" si pas de connexion.
- [ ] Réconciliation au retour réseau : merge des status changes locaux.
**Dépend de** : `TASK-04-006`.
**Estimation** : L
**Risques** : conflit de status (réseau dit `served`, local dit `preparing`) — règle "le dernier timestamp gagne".
**Notes** : V1 mode lecture seule en cache ; V2 actions queueables.

### TASK-04-015 — Mode présentation public (cuisine ouverte) [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No `kds.display_mode` toggle in V3. Carry-over.
**Contexte** : pour les boutiques à cuisine ouverte, montrer l'activité cuisine via un écran client est valorisant.
**Bénéfice attendu** : un mode adapté qui montre les commandes en cours sans détails sensibles (pas les noms clients, juste les numéros).
**Critère d'acceptation** :
- [ ] Nouveau mode `kds.display_mode = public_view` (sélectionnable depuis le sélecteur de station).
- [ ] Affichage : grille esthétique, noms produits seuls, timer visible, pas d'actions.
- [ ] Animation à chaque "ready" pour effet "vivant".
- [ ] Pas de sons (silencieux par design).
**Dépend de** : aucune.
**Estimation** : M
**Risques** : exposition des erreurs cuisine au client — désactivable par PIN.
**Notes** : utile pour ouvertures festives ou démonstration.

### TASK-04-016 — Reconnaissance vocale "Ready" [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred to Session 19+ per INDEX Wave 7 deferred list ("Voice ordering / advanced ML / OCR / 2FA (Session 19+)").
**Contexte** : un cuisinier les mains pleines ne peut pas taper sur l'écran. La voix est plus naturelle.
**Bénéfice attendu** : le cuisinier dit "Ready 124" à voix haute, le KDS marque l'item.
**Critère d'acceptation** :
- [ ] Web Speech API ou intégration Whisper local.
- [ ] Vocabulaire restreint : "Ready X", "Cancel X", "Pause".
- [ ] Confirmation visuelle + bip (pour éviter les faux positifs).
- [ ] Toggle Settings (off par défaut).
**Dépend de** : navigateur supportant Web Speech (Chromium).
**Estimation** : L
**Risques** : faux positifs en cuisine bruyante — confidence threshold haute + confirmation visuelle.
**Notes** : V1 mode expérimental ; valider taux d'erreur avant généralisation.

### TASK-04-017 — Caméra timer cuisson (QC photo) [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No camera capture / kds-qc storage bucket in V3. Carry-over (low priority — requires hardware).
**Contexte** : pour la qualité (QC), photographier chaque préparation à la sortie pour traçabilité visuelle.
**Bénéfice attendu** : preuve photo de chaque item livré, utile pour les litiges client et l'audit interne qualité.
**Critère d'acceptation** :
- [ ] Webcam ou caméra physique branchée au poste KDS.
- [ ] Au tap "Ready" sur un item, capture auto une photo, upload Storage `kds-qc/{order_id}/{item_id}.jpg`.
- [ ] Lien photo visible sur le détail commande côté POS / BO.
- [ ] Rétention 30 jours par défaut (puis purge auto).
**Dépend de** : matériel caméra + stockage.
**Estimation** : L
**Risques** : RGPD si photos contiennent staff — angle de prise restreint au plat.
**Notes** : valeur QC à mesurer avant scale.

---

## Notes transverses

- **Combo KDS dispatch** : déjà OK depuis Sprint 0 C4 (cf. `CURRENT_STATE.md`). Toute nouvelle logique routing doit préserver le combo handling.
- **Real-time channels** : KDS dépend de Supabase Realtime (`'lan-hub'`) ET BroadcastChannel (`'appgrav-lan'`). Toute modif doit gérer les deux.
- **Dedup orders** : `useKdsOrderQueue.addOrder` dedup par `order.id`. Pitfall : le dedup global LAN (TASK-11-XXX si module LAN créé) compléterait ce safety net.
- **Pages docs** : créer `docs/reference/04-modules/04-kds-kitchen.md` après les premières tâches DONE.
