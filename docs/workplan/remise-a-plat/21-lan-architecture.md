# Module 21 — Réseau local (postes, imprimantes)

> ⚠️ **Mise à jour S62 (2026-07-06, `swarm/session-62`)** : décision 2 (internet-first) EXÉCUTÉE — **mesh LAN purgé** (`lanHub`/`lanClient`/`lanHubMessageHandler`/`useLanHub`/`useLanClient` + `domain/src/lan/` entier ; les heartbeats S59 restent, `useLanHeartbeat` réduit au RPC) et **`print_queue` DROPPÉE** (`_110` : table vide + 5 RPCs `*_print_job_v1` + permissions + page BO — le vrai print POST directement au bridge externe via `printService.ts`). Chantier restant : versionner le print-bridge dans le repo. Voir `docs/workplan/plans/2026-07-06-session-62-INDEX.md`.

> ⚠️ **Mise à jour S59 (2026-07-04, `swarm/session-59`)** : **D1.1 (heartbeats) livré** — `useLanHeartbeat` est monté sur POS/KDS/tablette (tick 10 s, RPC `update_lan_heartbeat_v1`), la page BO « LAN Devices » affiche du vrai online/stale ; le mesh LAN mort reste **non monté** (décision 2 gelée). Dettes ouvertes : le hook **avale les erreurs RPC en silence** (mauvais `deviceCode` = échec muet en boucle) et il n'existe **aucun flux d'enregistrement d'appareil** (`LanDevicesPage` read-only) ; le `deviceCode` doit être renseigné par terminal (seed dev `KDS-CUISINE-1`/`TABLETTE-1` à adapter). Voir `docs/workplan/plans/2026-07-04-session-59-INDEX.md`.

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 21. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel pour un magasin mono-site
> **Verdict global de l'analyse :** C'est le module le plus surclamé des quatre. Le « système nerveux » réel est **Supabase Realtime (internet) + impression HTTP directe vers un print-bridge externe**. Tout le mesh LAN décrit par la doc (double canal dédoublonné, file d'impression avec retry ×3, heartbeats, réponses d'impression ciblées) existe en code **mais n'est monté nulle part** : `useLanHub`/`useLanClient`/`useLanHeartbeat` ont zéro call-site production. Conséquences concrètes : la file d'impression ne reçoit ni ne sert aucun ticket, et la page BO « LAN Devices » affiche tous les appareils « stale » en permanence.

## A. Ce qui fonctionne réellement (code vérifié)

**Transport inter-appareils effectif (le vrai « réseau ») :**
- **Supabase Realtime (via internet)** porte tous les flux inter-postes : tablette→caisse (`usePendingTabletOrders`, filtre `created_via=eq.tablet`), caisse/tablette→KDS (`useKdsRealtime`), commandes→écran client (`useDisplayRealtime`) — chacun doublé d'un **poll filet 30 s** et d'un **resync à la reconnexion** (`apps/pos/src/lib/useReconnectInvalidate.ts`, utilisé par KDS/tablette/display). [UI câblée]
- **Dédoublonnage effectif en prod** : uniquement le listener tablette (Set borné 1000 clés, replays realtime absorbés) — `features/tablet/hooks/useTabletOrderStatusListener.ts:17-64`. [UI câblée]
- **BroadcastChannel même-poste** : miroir panier + `payment_complete` caisse→écran client (`breakery-cart`) — cf. module 16. [UI câblée]

**Impression (chemin réel « Path A », S34) :**
- **printService HTTP direct** vers un print-bridge **externe au repo** : `POST {url}/print/receipt`, `/print/ticket`, `/drawer/open`, `GET /health` ; URL résolue à l'appel (override par terminal `posSettingsStore.printerUrl` > `VITE_PRINT_SERVER_URL` > `http://localhost:3001`), timeout 5 s, mode mock pour les tests — `apps/pos/src/services/print/printService.ts:10-216`. [UI câblée, dépendance à un process externe non versionné ici]
- **Routage station→imprimante par la DB** : `lan_devices` (`device_type='printer'`, `is_active`, `capabilities->>'station'`, ip/port) indexées en `Map<PrinterRole, printer>` — `features/cart/hooks/useStationPrinters.ts:37-70` ; table `lan_devices` migration `20260517000171` (persistante : les appareils enregistrés survivent à tout redémarrage). [UI câblée]
- **Fire persist-first** : `fire_counter_order_v4` (idempotent `p_client_uuid`) persiste AVANT d'imprimer ; impression best-effort par station + **ticket waiter consolidé** ; échec → toast honnête « {station} printer unreachable — ticket saved to KDS, not printed » + warning items non routés — `features/cart/hooks/useFireToStations.ts:140-298`, `features/cart/SendToKitchenButton.tsx:34-79`. **Pas de file, pas de retry automatique** à cette couche. [UI câblée]
- **Reçu + tiroir-caisse** sur le SuccessModal (auto-print/auto-drawer réglables par terminal ; échec → toast) — `features/payment/SuccessModal.tsx:143-176` ; test d'impression dans POS Settings → Devices (`DevicesSettingsTab.tsx:55-63`). [UI câblée]

**Administration BO :**
- **Page « LAN Devices »** (route + sidebar, gate `lan.devices.read`) : KPIs total/online/stale/printers, statut « online » = heartbeat < 60 s — `apps/backoffice/src/pages/lan-devices/LanDevicesPage.tsx`, `routes/index.tsx:972-976`, `layouts/Sidebar.tsx:224`. ⚠️ **Aucun heartbeat n'est jamais émis en prod** (voir ⚫ ci-dessous) → tout est « stale » en permanence. [UI câblée, données mortes]
- **Page « Print Queue »** (gate `print_queue.read`) : lecture + **cancel** de jobs — `pages/print-queue/PrintQueuePage.tsx`, `features/print-queue/hooks/useCancelPrintJob.ts`. **Pas de bouton retry/relance**. [UI câblée, file vide en pratique]

**Infrastructure DB de file d'impression (live mais orpheline) :**
- Table `print_queue` + RPCs `enqueue_print_job_v1` / `claim_print_job_v1` / `mark_print_done_v1` / `mark_print_failed_v1` (**3 retries max puis statut terminal `failed`**) / `cancel_print_job_v1` — migration `20260517000170`. **Producteur** : seul `lanHubMessageHandler` (code mort) + un chemin legacy derrière `VITE_LEGACY_KITCHEN_CHIT==='1'` (OFF par défaut, `lanHubMessageHandler.ts:95-122`). **Consommateur** : `claim_print_job_v1` n'a aucun call-site dans le repo (un « print server » externe est supposé le poller). [RPC seul]

**⚫ NON-CÂBLÉ — le mesh LAN hybride entier (Session 13 Phase 5.A) :**
- `LanHub` / `LanClient` (double transport BroadcastChannel `breakery-lan` + Realtime broadcast, dédup `MessageDedup` 200/5 s, ciblage `to=`), `lanHubMessageHandler` (routage kds.bump / print.request / print.result / heartbeat / device.registered), `useLanHub` / `useLanClient` / `useLanHeartbeat` (tick 10 s vers `update_lan_heartbeat_v1`) — `features/lan/*`, `packages/domain/src/lan/*`. **Zéro call-site production** (grep : seuls les tests et un commentaire dans `useKdsRealtime.ts:19` les référencent). Le RPC `update_lan_heartbeat_v1` (migration `20260517000171`) n'est appelé par personne.
- ⚠️ Bug suspecté dans ce code mort : hub et clients s'abonnent à des **topics Realtime différents** (`lan-hub-<id>-<uuid>` vs `lan-client-<id>-<uuid>`, `lanHub.ts:62`, `lanClient.ts:50`) — sur Supabase, le nom du channel EST le topic, donc les broadcasts ne se croiseraient pas même une fois monté. Le commentaire (« broadcast hits the topic, not the name ») semble erroné. ⚠️ à confirmer en conditions réelles avant tout re-câblage.

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Les messages qui arrivaient en double (deux canaux en parallèle) sont désormais dédoublonnés.
- B1.2 File d'attente d'impression : conserve les tickets si une imprimante tombe, réessaie automatiquement (3 tentatives), puis **alerte au gérant avec relance manuelle possible**.
- B1.3 Les appareils enregistrés survivent à un redémarrage du poste principal ; les réponses d'impression vont au bon poste.
- (Scénarios) L'imprimante bloquée 5 min ne perd aucun ticket, tout ressort à la reprise ; le gérant voit quel appareil « n'a plus donné signe de vie ».

### B2. Annoncé « À venir »
- B2.1 Redémarrage propre du poste principal après une panne (état bloqué possible).
- B2.2 Tableau de bord de diagnostic (état du réseau, test de chaque appareil).
- B2.3 Marquage des fausses détections d'appareils.
- B2.4 Plan de secours documenté « internet coupé mais réseau local vivant ».

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Doubles dédoublonnés (2 canaux parallèles) | Le double-canal (BroadcastChannel+Realtime) et `MessageDedup` existent et sont testés, mais **le mesh n'est monté nulle part** → il n'y a en prod qu'UN canal (Realtime) ; le seul dédoublonnage actif est celui du listener tablette | ⚫ NON-CÂBLÉ (dédup tablette : ✅) |
| B1.2 | File d'impression, retry ×3 auto, alerte gérant, relance manuelle | Table + RPCs avec retry ×3 **existent en DB** (`20260517000170`) mais : producteur mort (hub non monté, flag legacy OFF), **aucun consommateur** dans le repo, **aucune alerte gérant**, **aucun bouton relance** (BO = lecture + cancel). Le chemin d'impression réel est direct, best-effort, sans persistance : une imprimante bloquée 5 min = tickets **perdus** (mais la commande survit en DB/KDS) | 🔴 MANQUANT (infra ⚫) |
| B1.3 | Appareils persistants ; réponses d'impression au bon poste | `lan_devices` en DB ✓ (survit à tout) ; le ciblage `print.result to=` est dans le code mort ⚫ ; en prod la réponse d'impression est la réponse HTTP synchrone du bridge (pas de routage nécessaire) | 🟠 PARTIEL |
| B1.4 (scénario) | Le gérant voit quel appareil n'a plus donné signe de vie | La page BO existe et calcule online/stale à 60 s, mais **aucun poste n'émet de heartbeat** (`useLanHeartbeat` sans call-site, `update_lan_heartbeat_v1` orphelin) → tous « stale », information sans valeur | ⚫ NON-CÂBLÉ |

**Bonus code (le code fait plus que la doc) :**
- 🔵 **Persist-first au fire** : l'échec d'impression ne perd jamais la commande (DB + KDS font foi) + toasts par station honnêtes + warning « items non routés » — plus sûr que ce que la doc décrit.
- 🔵 Ticket **waiter consolidé** par fire (Spec B-1) et test d'impression/tiroir depuis les réglages du terminal.
- 🔵 URL du print-bridge réglable **par terminal** à chaud (`posSettingsStore.printerUrl`, résolue à l'appel).
- 🔵 Idempotence du fire (`p_client_uuid` conservé entre retries) — un retry réseau ne duplique pas les lignes.

## D. Plan de correction du module

> Décision préalable requise : **assumer l'architecture réelle** (internet-first + print-bridge HTTP) et jeter/geler le mesh LAN, **ou** le réhabiliter. Les deux branches ci-dessous ; ne pas faire les deux.

### D1. Quick wins (< 1 session, pas de spec)
1. **Heartbeats réels** : monter `useLanHeartbeat` (RPC `update_lan_heartbeat_v1` existe déjà) sur les surfaces POS/KDS/tablette avec le device-code du terminal — sans le mesh (l'appel RPC suffit). Fichiers : `pages/Pos.tsx` (ou shell commun), `pages/Kds.tsx`, `pages/tablet/TabletLayout.tsx`. Done : la page BO « LAN Devices » montre du vrai online/stale.
2. **Relance manuelle d'un job échoué** : RPC `retry_print_job_v1` (status `failed`→`queued`, remise à zéro du compteur) + bouton BO. Fichiers : nouvelle migration, `features/print-queue/*`. Done : un job failed est re-queuable. (N'a de sens que si D2/D3 rend la file vivante — sinon différer.)
3. **Nettoyage du code mort trompeur** : si la décision est « architecture réelle », supprimer (ou déplacer en `docs/attic`) `lanHub/lanClient/useLanHub/useLanClient/lanHubMessageHandler` + le flag `VITE_LEGACY_KITCHEN_CHIT` — un module entier de transport non monté est un piège pour les prochaines sessions. Done : grep `useLanHub|useLanClient` → 0 hit hors historique git.

### D2. Chantiers moyens (1 session, plan requis)
1. **File d'impression réellement branchée (côté production)** : faire passer `useFireToStations`/`SuccessModal` par `enqueue_print_job_v1` quand le POST direct échoue (fallback persistant), et notifier le gérant (toast + page BO badge) quand un job atteint `failed`. Pré-requis : un consommateur (D3.1).
2. **Tableau de diagnostic** (B2.2) : page BO enrichie — dernier heartbeat par appareil (D1.1), bouton « test print » par imprimante (réutilise `printService`), état du print-bridge (`/health`).

### D3. Chantiers lourds (spec dédiée avant code)
1. **Print-server consommateur** : le poller de `claim_print_job_v1` n'existe pas dans le repo — écrire/versionner le print-bridge (ou documenter et intégrer l'existant hors-repo), avec claim/done/failed et la boucle retry ×3 déjà en DB. Sans lui, B1.2 est infalsifiable. ⚠️ à confirmer : existence et capacités du print-bridge réellement déployé en magasin (hors repo).
2. **Réhabilitation du mesh LAN** (seulement si la décision le retient) : corriger le bug de topic (hub/clients doivent partager un topic commun, p.ex. `lan-<store_id>` fixe + noms d'objets uniques par mount), définir l'élection du hub, monter hub/clients, tests multi-appareils. Couvre B1.1/B1.3 et prépare B2.4 (« internet coupé, LAN vivant » — aujourd'hui **rien** ne survit à une coupure internet, le canal « LAN » passant lui-même par Supabase).
3. **Plan de secours « internet coupé »** (B2.4) : dépend directement de D3.2 ou d'une alternative locale (le print-bridge est le seul composant purement local aujourd'hui).

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
- Réécrire le statut : « Opérationnel » ne tient que pour l'impression directe + le transport internet ; B1.1 et B1.2 doivent passer en « À venir » (ou être reformulés : « les tickets non imprimés restent visibles au KDS et la commande n'est jamais perdue »).
- Corriger le scénario imprimante : aujourd'hui un blocage de 5 min = tickets papier perdus (pas de file) — la protection réelle est le persist-first DB/KDS.
- Corriger le scénario gérant : la liste des appareils existe mais le « signe de vie » ne fonctionne pas tant que D1.1 n'est pas fait.
- Documenter la dépendance au **print-bridge externe** (process séparé, URL configurable, `/health`) — invisible dans la doc actuelle.

## E. Dépendances croisées
- **Module 4 (KDS)** : les KOT papier et le filet « saved to KDS, not printed » ; le mode secours KDS dépend de D3.2/D3.3.
- **Module 16 (Écran client)** : le miroir panier multi-appareils (module 16 D2.1) est le même chantier transport que D3.2 — mutualiser.
- **Module 17 (Tablette)** : hors-ligne écrivain (module 17 D3.1) et fiabilité réseau partagent le même socle.
- **Module 19 (Réglages)** : URL print-bridge, auto-print, auto-drawer sont des réglages par terminal ; les seuils de heartbeat/alerte iraient au même endroit.
- **Module 24 (Exploitation)** : le print-bridge hors-repo doit entrer dans la stratégie de déploiement/mise à jour.
