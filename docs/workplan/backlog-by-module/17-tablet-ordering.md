# Travail — Tablet Ordering

> Last updated: 2026-05-20 (Session 25 — Hardening Idempotency Cross-EF)

## S25 deliverables (2026-05-20)

Closes the online-side idempotence gap (TASK-17-002) — prerequisite for any future offline queue work :

- **DB** : `create_tablet_order` v1 dropped and bumped to `create_tablet_order_v2(p_client_uuid UUID, p_waiter_id UUID, p_table_number TEXT, p_order_type order_type, p_items JSONB)` in the same migration (CLAUDE.md RPC versioning rule). New dedicated table `tablet_order_idempotency_keys (client_uuid PK, order_id FK, created_at)` — isolation pattern from S24 b2b_payments, not a NULL column on `orders`. Replay path : SELECT on PK → return existing `order_id` ; concurrent race handled by `EXCEPTION WHEN unique_violation` re-read. Migrations applied : `20260602000010` (table) + `_011` (RPC v2 + drop v1) + `_012` (REVOKE EXECUTE FROM anon) + corrective `_013` (`ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`, defense-in-depth template) + `_014` (relax `orders.session_id` NOT NULL to allow `created_via='tablet'` — caught by pgTAP T1 ; was a latent S24 bug).
- **POS** : `useCreateTabletOrder.ts` signature now requires `clientUuid: string` ; calls `create_tablet_order_v2` with `p_client_uuid`. Both call sites (`TabletOrderPage.tsx` and `TabletCheckoutButton.tsx`) generate their own `clientUuidRef = useRef(crypto.randomUUID())` and reset on success — each component owns its own lifecycle.
- **Tests** : pgTAP `idempotency_hardening.test.sql` 8/8 PASS via cloud MCP (T1-T3, T6-T8 cover tablet) ; Vitest live `idempotency-hardening.test.ts` TS1-TS2 cover happy path + retry semantics ; POS smoke `tablet-send-idempotent.smoke.test.tsx` 2/2 PASS.

Reference plan : [`../plans/2026-05-19-session-25-INDEX.md`](../plans/2026-05-19-session-25-INDEX.md). Closes TASK-17-002 (DONE) + gap audit S23 17-1. Tablet PWA offline queue (TASK-17-001 — IndexedDB queue + sync) remains deferred ; S25 ships the online idempotence prerequisite that the offline retry path will rely on.

---

> Référence : [docs/reference/04-modules/17-tablet-ordering.md](../04-modules/17-tablet-ordering.md)
> Sources d'audit : `docs/audit/08-operations-lan-audit.md` (TABLET_ORDER_SUBMIT processed by hub, dual-channel risks), `docs/audit/07-product-backlog-audit.md` ("Online-only architecture, no offline fallback Lombok"), `docs/audit/05-uiux-design-audit.md` (touch targets — tablet ordering)

## Objectifs du module

1. **Offline graceful degrade** — quand wifi tombe, le serveur peut continuer à prendre commande sur la tablette, queue locale, sync à la reconnexion (besoin opérationnel critique Lombok).
2. **Sync resilience** — assurer qu'aucune commande n'est perdue lors d'un blip réseau ; idempotence côté hub.
3. **Touch UX** optimisé pour tablette en main du serveur (boutons large, scroll fluide, mode portrait).
4. **Send order partiel** — envoi cours par cours (entrées d'abord, plats après) en table service.
5. **Server profile** — préférences serveur (langue, thème, raccourcis favoris).
6. **Multi-server table sharing** — plusieurs serveurs peuvent éditer la même table (passage de service).

## Tâches

### TASK-17-001 — Offline graceful degrade (cache local minimal) [P1] [TODO]
**Status note (2026-05-14)** : Partial — Phase 4.D delivered read-only graceful path: `apps/pos/src/features/tablet/hooks/useTabletOffline.ts` (navigator.onLine + ping), `useTabletMenuCache.ts` (24h localStorage menu snapshot), `OfflineBanner.tsx`, `TabletOffline.test.tsx` (10 RTL tests). Order-create offline queue (IndexedDB + `sync_offline_transactions` RPC) NOT built — that's the XL second half. Keep TODO for the queue+sync portion.
**Contexte** : Audit John P0 risque opérationnel #1 — "Online-only = business stops on internet outage. Lombok infrastructure not Tokyo-reliable". Tablette serveur particulièrement exposée (wifi mou en salle).
**Critère d'acceptation** :
- [ ] Service Worker (vite-plugin-pwa déjà en place — étendre) cache les assets + les data essentielles : products, categories, modifiers, table layout.
- [ ] Cache TTL 1h — refresh background.
- [ ] Quand `navigator.onLine === false` : UI affiche bannière "Offline mode — orders queued".
- [ ] Création d'order en offline : persistée IndexedDB (Dexie ou localforage), status `pending_sync`.
- [ ] À la reconnexion : sync auto sequencée (TASK-17-002), 1 par 1, avec retry exponentiel.
- [ ] Limite : pas de paiement en offline (toujours nécessite serveur pour validation).
**Fichiers concernés** : `vite.config.ts` (PWA workbox), `src/services/tablet/offlineQueueService.ts` (nouveau), `src/hooks/useOnlineStatus.ts`.
**Dépend de** : `TASK-17-002` (sync resilience).
**Estimation** : XL — décomposer :
  1. Service Worker + cache data (M)
  2. UI offline banner (S)
  3. IndexedDB queue order create (M)
  4. Sync mechanism + tests (M)
**Risques** : conflits si même table éditée online et offline (TASK-17-006) — résolution last-write-wins ou merge.
**Notes** : Lombok ISP downtime documenté. Test réel obligatoire en condition dégradée.

### TASK-17-002 — Sync resilience + idempotence après reconnect [P1] [DONE]
**Status note (2026-05-20)** : S25 update — **DONE for the online idempotence side**. `create_tablet_order` v1 bumped to `create_tablet_order_v2(p_client_uuid UUID, ...)` (migrations `20260602000010..015`) with replay via dedicated `tablet_order_idempotency_keys` table (PK = `client_uuid`). POS `useCreateTabletOrder` requires `clientUuid` ; both `TabletOrderPage.tsx` and `TabletCheckoutButton.tsx` own a `useRef(crypto.randomUUID())` reset on success. pgTAP T1-T3 + Vitest live TS1-TS2 + POS smoke 2/2 PASS. The LAN hub `handleTabletOrderSubmit` ack-with-same-UUID retry remains deferred (LAN-side ack flow is part of TASK-21-* hub work) but the core submit-side idempotent upsert is in place — duplicate submits via React-Query retries, double-tap, or browser refresh now return the same `order_id` without double-inserting `orders` or `order_items`.
**Status note (2026-05-14)** : Genuinely undone. `create_tablet_order` RPC (`supabase/migrations/20260507000003_create_tablet_order_rpc.sql`) has NO `p_client_uuid` / `p_idempotency_key` arg and the V3 `useCreateTabletOrder.ts` hook does not pass one. Per Phase 4.D deviation `D-W4-4D-02`, the realtime listener dedups by `(order_item_id, kitchen_status)` keys client-side but the submit-side idempotent upsert remains. Carry-over.
**Contexte** : Audit Bob — `handleTabletOrderSubmit` dans hub message handler. Si connexion WS coupe pendant submit, order peut être créée 2× (côté tablette retry + côté hub déjà reçu).
**Critère d'acceptation** :
- [ ] Chaque order créée tablette a un `client_uuid` (généré tablette, pas serveur).
- [ ] RPC `create_tablet_order(p_client_uuid, p_payload)` upsert sur `client_uuid` (idempotence).
- [ ] Hub `handleTabletOrderSubmit` capture les ack ; si pas d'ack > 5s, retry avec même `client_uuid`.
- [ ] UI tablette montre status par order : `local_only` / `syncing` / `synced` / `failed`.
- [ ] Failed avec raison claire + bouton "Retry manuellement".
**Fichiers concernés** : RPC SQL, `src/services/lan/lanHubMessageHandler.ts`, `src/services/tablet/tabletOrderService.ts`, UI status badge.
**Dépend de** : aucune (peut précéder TASK-17-001)
**Estimation** : M
**Risques** : ack overhead léger acceptable.
**Notes** : pattern classique systèmes distribués — UUID client + upsert.

### TASK-17-003 — Touch UX optimisé tablette (10") [P2] [BLOCKED]
**Status note (2026-05-14)** : Visual fidelity scope reassigned to Session 14 Wave 2/3. Phase 4.D focused on offline polish + 7 ad-hoc modal migrations (D-W4-4D-01). Touch-target audit / 56px button standardisation / bottom-sheet modifier modal belong with Session 14's tablet visual polish. Tracking: docs/workplan/plans/2026-05-14-session-14-INDEX.md.
**Contexte** : Audit Sally R2 — "PaymentModal w-[450px] hardcoded ; sur tablet portrait reste 318px". Tablet ordering surface en mode landscape principalement, mais menu sub-screens parfois portrait.
**Critère d'acceptation** :
- [ ] Tous les boutons d'action min 56px (audit Sally A2-1) sur tablet ordering.
- [ ] Grille produits 3 cols landscape / 2 cols portrait (responsive `useMediaQuery`).
- [ ] Quantity selectors gros (+/- 64px touch zone).
- [ ] Modal modifier en bottom-sheet (au lieu de centré) pour atteignable en pouce.
- [ ] Test sur tablet 10" Samsung A8 (device cible).
- [ ] `@media (hover: hover)` guard sur les hover effects (audit Sally P3 — sticky hover sur tap).
**Fichiers concernés** : `src/pages/tablet/*`, breakpoint utils, composants.
**Dépend de** : aucune
**Estimation** : L
**Risques** : régression desktop si responsive mal testé.
**Notes** : Capacitor wraps in WebView ; tester aussi natif Android (`npm run android:run`).

### TASK-17-004 — Send order partial (cours par cours) [P2] [TODO]
**Contexte** : Service à table : entrées commandées et envoyées en cuisine pendant que client réfléchit aux plats. Aujourd'hui, soit tout, soit rien (1 batch).
**Status note (2026-05-14)** : Genuinely undone. No `course_id` column on `tablet_orders` or `order_items` in V3 migrations. Not in Session 13 scope; validate business pertinence with owner before building.
**Critère d'acceptation** :
- [ ] `tablet_orders.course_id` (1, 2, 3 — entrée/plat/dessert).
- [ ] UI tablette : selector "Course" sur chaque item.
- [ ] Bouton "Send course 1" envoie uniquement les items course=1, marque-les `sent`, déclenche `KDS_NEW_ORDER` filtré.
- [ ] Items course=2,3 restent éditables jusqu'à leur envoi.
- [ ] KDS station reçoit messages séparés par course → boulanger sait quoi préparer en premier.
- [ ] Lock items envoyés (CLAUDE.md pitfall : kitchen-sent items requièrent PIN).
**Fichiers concernés** : migration `tablet_orders.course_id` + `order_items.course_id`, UI tablet, hub print routing par course.
**Dépend de** : aucune
**Estimation** : L
**Risques** : confusion KDS si flow course mal compris — formation cuisine.
**Notes** : pattern fine-dining ; The Breakery boulangerie le fait moins, valider pertinence avec owner.

### TASK-17-005 — Server profile (préférences) [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No `users.tablet_preferences` JSONB column or `/profile/tablet` page in V3. Carry-over.
**Contexte** : Plusieurs serveurs partagent les tablettes. Pas de personnalisation (langue, taille texte, raccourcis favoris).
**Critère d'acceptation** :
- [ ] `users.tablet_preferences` JSONB : `{language, theme: light|dark, font_size, favorites: [product_ids], default_section_id}`.
- [ ] Page `/profile/tablet` accessible depuis settings tablette.
- [ ] Login PIN serveur charge ses préférences.
- [ ] Favoris affichés en tab dédiée pour quick-add (gain temps rush).
- [ ] Default section : tablette ouvre directement sur la section assignée au serveur.
**Fichiers concernés** : migration `users.tablet_preferences`, page profile, hook.
**Dépend de** : aucune
**Estimation** : M
**Risques** : i18n suspended (CLAUDE.md) → langue = English only pour l'instant ; champ JSONB gardé pour le futur.
**Notes** : aligner avec module 18-mobile-shell pour cohérence patterns profil.

### TASK-17-006 — Multi-server table sharing (passage de service) [P2] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No `tablet_orders.assigned_server_id` reassignment flow, no `table_assignments_log` table. Carry-over.
**Contexte** : Service midi → service soir, ou un serveur en pause demande à un collègue de prendre la table. Aujourd'hui : pas de mécanisme clair.
**Critère d'acceptation** :
- [ ] `tablet_orders.assigned_server_id` (peut changer en cours).
- [ ] Action "Reassign table" : selector serveur cible avec PIN gate.
- [ ] Notification (in-app push) au nouveau serveur.
- [ ] Historique des assignments (`table_assignments_log`).
- [ ] Lock optimiste : si 2 serveurs éditent en même temps → 1 reçoit "Table editing by X, refresh ?".
- [ ] Filter "My tables" / "All tables" en dashboard tablette.
**Fichiers concernés** : migration logs + colonne, hook useTableAssignment, UI selectors, optimistic locking.
**Dépend de** : `TASK-17-002` (sync resilience pour conflits).
**Estimation** : L
**Risques** : conflict resolution UX critique sinon double edit perd des items.
**Notes** : reuse pattern shift handover (TASK-12-005) — concept similaire (passer la main).

---

## Backlog métier (objectif fonctionnel)

> Items issus de `docs/objectif travail/TABLET_ORDERING.md` §13 — vision produit du module.
> Ajoutés 2026-05-13 lors de la cascade docs (session 13). Queue offline est déjà couverte par TASK-17-001/002.

### TASK-17-007 — Auto-send à la cuisine optionnel [P2] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No "Send directly to kitchen" toggle in Settings (`/settings/pos`) or tablet UI. Carry-over.
**Contexte** : aujourd'hui une commande tablette ne va en cuisine qu'après acceptation du caissier au POS. Pour le service rapide (drink only, take-away), cette étape ajoute du retard.
**Bénéfice attendu** : toggle "Envoyer directement en cuisine" qui bypass l'acceptation caissier pour certains cas (drink-only, take-away).
**Critère d'acceptation** :
- [ ] Toggle dans Settings → POS → "Tablet auto-send to kitchen".
- [ ] Sur la tablette : option "Send to kitchen" en plus de "Send to POS".
- [ ] Si auto-send actif et commande matche les critères (cf settings) → bypass POS accept, va directement KDS.
- [ ] Audit log : marquer `auto_sent_to_kitchen = true` pour traçabilité.
- [ ] Le caissier voit toujours la commande au POS pour encaissement, mais elle est déjà en cuisine.
**Dépend de** : aucune.
**Estimation** : M
**Risques** : commande non payée déjà préparée → désactivable par cas (allow_unpaid_kitchen_send_categories).
**Notes** : utile pour les bars / cafés à fort débit.

### TASK-17-008 — Modifier engine complet [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No shared `ModifierModal` factored into `packages/ui` between POS and Tablet. Carry-over.
**Contexte** : la tablette supporte des modifiers basiques (sucre, lait, sans X). Certains modifiers POS complexes ne sont pas accessibles.
**Bénéfice attendu** : supporter tous les modifiers du POS pour ne refuser aucune configuration en salle.
**Critère d'acceptation** :
- [ ] Composant `ModifierModal` réutilisé entre POS et Tablet (factoring partagé).
- [ ] Support des modifier groups multi-sélection, modifier requis vs optionnel.
- [ ] Validation : modifiers obligatoires doivent être sélectionnés.
**Dépend de** : factoring du composant `ModifierModal` côté `packages/ui`.
**Estimation** : M
**Risques** : UX tactile plus complexe — adapter les tailles touch.
**Notes** : objectif feature parity tablet ↔ POS.

### TASK-17-009 — Combos sélectionnables sur tablette [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No shared `ComboSelectorModal` factored into `packages/ui`. Carry-over.
**Contexte** : la tablette renvoie au comptoir pour la sélection de combo (sélection multi-groupes). Friction service.
**Bénéfice attendu** : composer un combo directement depuis la tablette.
**Critère d'acceptation** :
- [ ] Réutiliser le composant `ComboSelectorModal` du POS.
- [ ] Validation des règles "1 parmi", "exactement N parmi" identique au POS.
- [ ] Affichage cart : combo en ligne unique avec décomposition pliable.
**Dépend de** : factoring `ComboSelectorModal` côté `packages/ui`.
**Estimation** : M
**Risques** : UX tactile dense — bien tester sur tablette 10".
**Notes** : feature parity.

### TASK-17-010 — Création de client à la table [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No `CreateCustomerForm` in `packages/ui` reused on tablet. Carry-over.
**Contexte** : pour ajouter un nouveau client (pour la fidélité), le serveur doit passer par le caissier. Friction.
**Bénéfice attendu** : saisir un client minimal (nom + téléphone) directement depuis la tablette.
**Critère d'acceptation** :
- [ ] Réutiliser le composant `CreateCustomerForm` simplifié.
- [ ] Champs : nom, téléphone, e-mail optionnel, type (retail par défaut).
- [ ] PIN serveur suffit (pas PIN manager pour création simple retail).
- [ ] Lien automatique à la commande en cours.
**Dépend de** : factoring du formulaire client côté `packages/ui`.
**Estimation** : S
**Risques** : doublons clients — déduplication par téléphone à la création.
**Notes** : feature parity.

### TASK-17-011 — Pre-bill à la table (note imprimable) [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No "Pre-bill" button or PDF Edge Function. Carry-over.
**Contexte** : aucun moyen d'imprimer une note de table sans encaisser. Le client veut souvent voir son addition avant de demander le ticket.
**Bénéfice attendu** : générer une "note" PDF de table imprimable sur tablette ou portable, sans encaissement.
**Critère d'acceptation** :
- [ ] Bouton "Pre-bill" sur l'écran tablette commande.
- [ ] Génération PDF "Note de table" via Edge Function (réutilise template ticket).
- [ ] Mention "Note non officielle — facture finale à la caisse".
- [ ] Possibilité d'envoyer par e-mail au client (si lié).
- [ ] Pre-bill ne change pas le statut de la commande.
**Dépend de** : aucune.
**Estimation** : M
**Risques** : confusion client si note ≠ facture finale (promo non encore appliquée) — bien mentionner.
**Notes** : standard restaurant ; demande fréquente.

### TASK-17-012 — Notifications push KDS → tablet [P3] [TODO]
**Status note (2026-05-14)** : Partial — `useTabletOrderStatusListener.ts` exists with Realtime + dedup (D-W4-4D-02) and fires "Item ready" toasts. `KDS_TABLE_READY` LAN message routing with per-server filter (depends on TASK-17-006) is not built. Keep TODO until 17-006 lands.
**Contexte** : le serveur doit régulièrement aller voir le KDS pour savoir si sa table est prête. Cassage de tempo.
**Bénéfice attendu** : push notification sur la tablette du serveur quand sa table passe en "ready".
**Critère d'acceptation** :
- [ ] Message LAN `KDS_TABLE_READY` envoyé du hub vers la tablette du serveur concerné.
- [ ] Toast push + son discret sur la tablette : "Table 7 prête — 3 items".
- [ ] Click → ouvre la commande détail.
- [ ] Filtrage par `assigned_server_id` (TASK-17-006) si attribué.
**Dépend de** : `TASK-17-006` (assignation serveur).
**Estimation** : M
**Risques** : sons multiples si plusieurs tables ready en même temps — empiler.
**Notes** : pattern serveur Apple Restaurant.

### TASK-17-013 — Photos de plats [P3] [BLOCKED]
**Status note (2026-05-14)** : Visual fidelity scope reassigned to Session 14 Wave 2/3 (photos required per Session 14 spec D8 "photos required"). The `products.image_url_hires` column does not exist yet; Session 14 will add product photos as part of the seed bakery dataset. Tracking: docs/workplan/plans/2026-05-14-session-14-INDEX.md.
**Contexte** : aucune photo sur la tablette. Le serveur ne peut pas aider à la suggestion visuelle.
**Bénéfice attendu** : affichage photos haute qualité des produits pour aide à la suggestion client.
**Critère d'acceptation** :
- [ ] Champ `products.image_url_hires` (en plus du thumbnail) optionnel.
- [ ] Grille tablette : si image existe, tap long → preview full screen.
- [ ] Lazy load + cache local.
- [ ] Toggle Settings (off par défaut, bande passante).
**Dépend de** : photos disponibles dans Supabase Storage.
**Estimation** : S
**Risques** : volume données — cache + compression.
**Notes** : valorisation des plats signature.

### TASK-17-014 — Mode "menu client" (kiosk self-service) [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No kiosk-client toggle in V3. Carry-over (validate commercial value first).
**Contexte** : donner la tablette au client pour qu'il sélectionne lui-même (style fast-casual / pre-order).
**Bénéfice attendu** : mode kiosk dédié — client tape sa commande, serveur valide.
**Critère d'acceptation** :
- [ ] Toggle "Mode client" sur la tablette (PIN manager pour activer/désactiver).
- [ ] UI épurée sans PIN serveur (la commande sera attribuée au serveur "actif" du moment).
- [ ] Validation "Send" déclenche notification serveur qui doit confirmer avant POS.
- [ ] Auto-retour mode serveur après validation ou timeout.
**Dépend de** : aucune.
**Estimation** : L
**Risques** : abus / commandes fausses — limite "Send" pour montants <X IDR sans validation manager.
**Notes** : disruptif comme modèle service — valider commercialement avant build.

## Vue transversale

### Dépendances inter-tâches

```
TASK-17-002 (sync resilience) ← prérequis offline
    ↓
TASK-17-001 (offline degrade) → TASK-17-006 (multi-server sharing)
TASK-17-003 (touch UX) ← indépendant — quick win device cible
TASK-17-004 (course par course) ← indépendant
TASK-17-005 (server profile) ← indépendant — peut rester P3
```

### Métriques de succès

| Métrique | Baseline 2026-04 | Cible Q3 2026 |
|---|---|---|
| Continuité service en wifi down | impossible | 100% prise commandes (TASK-17-001) |
| Orders perdues lors blip réseau | non tracé | 0% (TASK-17-002 idempotence) |
| Touch targets ≥ 56px tablet | partiel | 100% (TASK-17-003) |
| Sync delay reconnect | non tracé | < 5s pour < 50 orders queued |

### Pitfalls connus

- `TABLET_ORDER_SUBMIT` est l'un des 5 messages activement processés par le hub (Bob) — l'idempotence côté hub doit rester (cf. TASK-17-002).
- Capacitor wraps WebView → tester sur device réel (Samsung A8 cible), pas seulement Chrome desktop.
- IndexedDB quota navigateur ≈ 50 MB par défaut — limiter cache produit/image.
- Online-only architecture documentée comme RISQUE OPÉRATIONNEL #1 (audit John P0).

### Risques transversaux

- **Fragmentation données** : TASK-17-001 + TASK-17-006 → conflits possibles. Stratégie merge claire dès le design.
- **Effort XL** : TASK-17-001 doit être décomposée (4 sous-tâches identifiées dans la fiche).
- **Coordination KDS** : TASK-17-004 (course-by-course) impacte le KDS — coordonner avec module 04 KDS.
- **Test conditions réelles** : impossible de simuler vraiment Lombok wifi en dev — staging tests sur réseau dégradé volontaire (Network throttling Chrome).

### Couverture audits

| Tâche | Source audit | Section |
|---|---|---|
| TASK-17-001 | 07-product-backlog-audit.md | "Online-only architecture" risque #1 |
| TASK-17-002 | 08-operations-lan-audit.md | TABLET_ORDER_SUBMIT idempotence |
| TASK-17-003 | 05-uiux-design-audit.md | R2 + A2-1 touch targets |
| TASK-17-004 | besoin métier service à table | — |
| TASK-17-005 | nice-to-have personnalisation | — |
| TASK-17-006 | besoin opérationnel passage de service | — |
