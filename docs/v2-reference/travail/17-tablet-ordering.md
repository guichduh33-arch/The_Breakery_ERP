# Travail — Tablet Ordering

> Last updated: 2026-05-03
> Référence : [docs/v2-reference/04-modules/17-tablet-ordering.md](../04-modules/17-tablet-ordering.md)
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

### TASK-17-002 — Sync resilience + idempotence après reconnect [P1] [TODO]
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

### TASK-17-003 — Touch UX optimisé tablette (10") [P2] [TODO]
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
