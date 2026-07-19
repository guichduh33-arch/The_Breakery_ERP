# Spec 006x — Hub LAN : continuité locale des échanges inter-appareils

> **ADR parent** : ADR-006, décision 5 (pages LAN Network / Network Devices +
> système hub garantissant la continuité des échanges quand internet tombe).
> ADR-006 §4 : cette spec précise transport, topologie et resynchronisation
> sans nouvel ADR, sauf remise en cause du principe.
> **Statut** : actée — arbitrages §3 tranchés par le propriétaire le 2026-07-19.
> Contenu proposé par l'agent, relu et commit ordonné par Mamat.
> Meurt à la livraison du chantier (règle CLAUDE.md n°4) ; résiduel → ADR-006 (§8).

## 1. Objectif et périmètre

Quand la connexion internet de la boutique tombe, les appareils (caisse,
KDS, tablette serveur, customer display) doivent continuer à communiquer
entre eux sur le réseau local, et le travail effectué hors-ligne doit se
resynchroniser vers Supabase au retour d'internet, sans doublon ni perte.

Périmètre fonctionnel offline (arbitrage A1) :
- prise de commande caisse et tablette (panier local, déjà acquis) ;
- envoi en cuisine : la commande atteint le KDS et les imprimantes KOT
  via le hub, sans cloud ;
- statuts cuisine (preparing/ready) relayés KDS → caisse/tablette ;
- encaissement CASH enregistré localement en file durable, rejoué vers
  `process-payment` au retour (idempotence existante) ;
- customer display : file pickup/ready alimentée par le hub.

Hors périmètre offline : paiements non-cash, remises PIN (nonce serveur),
B2B (prix résolus serveur), promotions à plafond (advisory lock serveur),
toute écriture stock. Ces flux restent online-only ; l'UI les désactive
proprement hors-ligne.

## 2. État des lieux (audit code 2026-07-19)

- Communication inter-surfaces : 100 % cloud (9 canaux Realtime
  `postgres_changes`, aucun `broadcast`). Seul canal local :
  BroadcastChannel POS→display (`useCartBroadcast.ts`), même navigateur.
- Serveur local unique : `apps/print-bridge` (Express :3001, service
  Windows, scan TCP `scan.ts`, guard IP privées `ipGuard.ts`, URL
  per-terminal `posSettingsStore.printerUrl`). Surfaces = SPA web pures
  (pas de Tauri/Capacitor) — aucune autre ne peut héberger un serveur.
- Registre : `lan_devices` (+ heartbeat cloud 10 s via
  `update_lan_heartbeat_v1`, monté sur POS/KDS/tablette), page BO
  `LanDevicesPage`, permissions `lan.devices.read/manage`. `pos_devices`
  = identité logique distincte (audit).
- File durable existante (modèle à répliquer) : outbox d'audit
  IndexedDB (`outbox.ts` + `emitPosEvent.ts`), write-first, flush
  idempotent vers `record_pos_events_v1`.
- Idempotence : `p_client_uuid` (RPC) + `x-idempotency-key` (EF),
  replay renvoie le résultat de la 1ʳᵉ exécution.
- Mesh précédent purgé (migration `20260710000110_drop_print_queue.sql`) —
  ne pas ressusciter `print_queue`.

## 3. Arbitrages tranchés (propriétaire, 2026-07-19)

- **A1 — Périmètre offline : (b)** commande + cuisine + impression +
  cash différé (détail §1). Le money-path complet offline est REJETÉ :
  il dupliquerait côté client les invariants serveur (RPC-only, promos,
  B2B, stock) — classe de bugs et de fraude inacceptable.
- **A2 — Hôte du hub : (a)** extension du print-bridge — même process
  Node, déjà déployé/supervisé (NSSM/pm2), même URL déjà configurée par
  terminal. Un second service dédié doublerait l'ops sans bénéfice.
- **A3 — Topologie : (a)** hub fixe unique (le PC boutique). Une seule
  localisation (ADR-006 déc. 10 rejette le multi-site) et le PC caisse
  porte déjà le bridge. L'élection dynamique est REJETÉE (split-brain
  sans besoin métier). Hub down = mode dégradé actuel (cloud si
  internet, sinon impression directe seule).
- **A4 — Politique de replay cash : accepter.** Au retour d'internet,
  un replay peut violer un plafond promo ou faire passer un stock en
  négatif : le serveur ACCEPTE le replay (la vente a eu lieu) et marque
  l'écart dans `audit_logs` (metadata `offline_replay: true`) ; jamais
  de rejet silencieux d'une vente encaissée.
- **A5 — Fenêtre offline maximale : 4 heures.** Au-delà, le POS refuse
  de continuer en cash offline ; bannière rouge et blocage de nouveaux
  encaissements jusqu'au retour du cloud.

## 4. Architecture cible

### 4.1 Transport
- WebSocket sur le LAN : le hub expose `ws://<hub>:3001/ws` (même
  process Express, lib `ws`). Les navigateurs ne font ni TCP brut ni
  mDNS : le WS est le seul transport local viable pour des SPA.
- Découverte : URL du hub = réglage per-terminal (réutilise le pattern
  `printerUrl` ; par défaut, la même origine que le print-bridge).
  Pas de mDNS (impossible côté navigateur, inutile côté ops).
- Contenu mixte (HTTPS→ws non sécurisé) : à valider sur le déploiement
  réel ; mitigation candidate : servir les SPA depuis le hub en LAN,
  ou exception navigateur pour IP privée (à tester en boutique, lot 1).

### 4.2 Bus de messages
- Enveloppe : `{v, msg_id (uuid), device_code, ts, topic, payload}`.
- Topics (miroir des canaux Realtime actuels) : `order.fired`,
  `order.item_status`, `order.paid_offline`, `cart.mirror`,
  `presence.heartbeat`, `settings.changed`.
- Le hub est un RELAIS + JOURNAL, pas une base : il rediffuse aux
  abonnés et garde un ring-buffer persistant (SQLite ou JSONL local)
  pour le rattrapage des appareils qui (re)joignent.
- Dédup côté consommateur par `msg_id` (StrictMode double-mount :
  même discipline que les channel names uniques par mount).

### 4.3 Modes de fonctionnement
- **ONLINE (nominal)** : rien ne change — cloud source de vérité,
  Realtime inchangé. Le bus LAN ne porte que `presence.heartbeat`
  (10 s vers le hub, qui agrège et pousse vers `lan_devices` en un
  seul écrivain cloud — remplace N heartbeats individuels).
- **OFFLINE (internet down, LAN up)** : détection par échec du ping
  cloud (pattern `useTabletOffline`) + hub joignable. Le POS/tablette
  écrit chaque geste dans son outbox durable (IndexedDB, modèle
  `outbox.ts`) PUIS publie sur le bus. KDS/display consomment le bus.
  Numérotation locale des commandes : préfixe `L-` + compteur
  par terminal (collision impossible au replay grâce au client_uuid).
- **RETOUR ONLINE** : replay séquentiel de l'outbox par terminal
  (fire → paiement cash), vers les RPCs/EF EXISTANTES avec les
  idempotency keys d'origine. Aucune RPC « spéciale offline » côté
  money-path : le serveur reste l'unique autorité (A4 pour les
  écarts). Le KDS re-bascule sur Realtime après rattrapage.

### 4.4 Ce qui n'est PAS construit
- Pas de base locale répliquée, pas de CRDT, pas de sync bidirectionnelle
  générique. L'outbox est un journal d'INTENTIONS rejouées vers les
  RPCs existantes — le cloud reste l'unique source de vérité.
- Pas de `print_queue` ressuscitée : l'impression reste en POST direct.

## 5. Settings & données

- Pages BO : la section Network du hub Settings existe déjà
  (`SettingsHubPage.tsx` L100-106, sidebar L262-267, `LanDevicesPage`).
  Évolutions : (1) tuile hub gatée `lan.devices.read` (aujourd'hui sans
  gate — incohérence à corriger) ; (2) panneau « Hub » sur
  LanDevicesPage : état du hub, appareils connectés VUS PAR LE HUB
  (présence temps réel locale vs heartbeat cloud), taille des outbox.
- Nouvelle catégorie `business_config` `network` (dictionnaire
  `settings-keys.ts` + branches `set_setting_v4`→`_v5` /
  `get_settings_by_category_v3`→`_v4`, même migration) :
  `offline_cash_enabled` (bool, défaut false — activation explicite),
  `offline_max_hours` (int, défaut 4 — arbitrage A5).
- Per-terminal (localStorage, `posSettingsStore`) : `hubUrl` (défaut =
  `printerUrl`), `deviceCode` (existant).
- DB : `lan_devices` inchangée (le hub devient l'écrivain unique du
  heartbeat via `update_lan_heartbeat_v1` bumpée en `_v2` batch).
  Pas de nouvelle table cloud.

## 6. Sécurité

- Le hub ne reçoit AUCUN secret : pas de PIN, pas de JWT cloud dans
  les messages (règle « secrets en header, jamais en body » étendue :
  jamais de secret sur le bus LAN du tout).
- Adhésion au bus : le hub n'accepte que les `device_code` présents
  dans sa copie locale de `lan_devices` (rafraîchie quand online) +
  origine IP privée (réutilise `ipGuard.ts`). Un secret partagé
  boutique (env du bridge, header `x-hub-token` à l'upgrade WS) coupe
  les connexions parasites.
- Le replay est signé par rien de local : ce sont les credentials
  NORMAUX du terminal (PIN JWT) qui rejouent les RPCs — un appareil
  non authentifié peut publier sur le bus mais ne peut rien écrire
  en cloud.

## 7. Lots de réalisation

1. **Hub socle** : WS server dans print-bridge, enveloppe, presence,
   ring-buffer, panneau BO « Hub ». Validation mixed-content en
   boutique. Aucun changement de flux métier.
2. **Heartbeat via hub** : bascule des heartbeats individuels vers
   l'agrégation hub (bump `update_lan_heartbeat_v2` batch, un écrivain).
3. **KDS offline** : `order.fired`/`order.item_status` sur le bus,
   consommation KDS + display en mode OFFLINE, impression KOT inchangée.
4. **Outbox commande + cash différé** : outbox durable POS/tablette,
   replay idempotent, gates UI (flux online-only désactivés), A4/A5.
5. **Durcissement** : chaos tests (coupure en plein fire, hub down,
   double replay), mesure du rattrapage, runbook d'exploitation.

Chaque lot = une PR reviewable, testée (vitest pour le bus et l'outbox,
pgTAP pour les bumps RPC, test manuel boutique pour lots 1 et 3).

## 8. Résiduel à la mort de la spec

À noter dans ADR-006 à la livraison : périmètre offline retenu (A1),
politique de replay (A4), fenêtre offline 4 h (A5), et la liste des
flux restés online-only.
