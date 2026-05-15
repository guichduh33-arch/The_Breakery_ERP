# Travail — LAN Architecture

> Last updated: 2026-05-03
> Référence : [`../06-lan-architecture/`](../06-lan-architecture/) (`01-hub-client-model.md`, `02-discovery.md`, `03-heartbeat-and-state.md`)
> Sources audit : `docs/audit/08-operations-lan-audit.md` §1 (LAN, full), §1.4 reliability summary, §2 (Edge Functions print), `docs/audit/01-architecture-security-audit.md` §SSRF prevention

## Objectifs du module

1. Éliminer le risque de double-livraison BroadcastChannel + Realtime — cible : 0 message dupliqué observé sur 1h de POS actif (P1 audit).
2. Élargir la couverture d'orchestration du hub : passer de 5/35 message types traités → 12+ (KDS ACK, status, sync) — cible : POS reflète l'état KDS en temps réel.
3. Robustifier le print routing : retry queue pour pannes printer, résultats ciblés (pas broadcast) — cible : 0 ticket perdu sur outage de < 5 min.
4. Restaurer l'état hub après crash sans perdre les devices enregistrés — cible : devices reviennent en < 30 s sans reconfig manuelle.
5. UX device discovery & registration : marquer les fausses détections (browser probe), donner un feedback clair — cible : manager comprend en 1 coup d'œil l'état du LAN.

---

## Tâches

### TASK-21-001 — Déduplication messages dual-channel [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 5.A. V3 evidence: `packages/domain/src/lan/messageDedup.ts` (UUID + TTL ring buffer) with unit tests `messageDedup.test.ts` and integration test `apps/pos/src/features/lan/__tests__/lanHub.dedup.test.ts`. Commit `bdf21aa`.
**Contexte** : `docs/audit/08-operations-lan-audit.md` §1.1 P1 FINDING — *"Both channels receive the same message simultaneously. No deduplication between channels. Same-origin tabs will receive it on both channels. The hub also broadcasts on both, so same-origin hub + client will get 2x delivery."*
**Critère d'acceptation** :
- [ ] `processMessage()` (hub + client) maintient un `Set<string>` des derniers 200 message IDs reçus, TTL 5 s
- [ ] Si `message.id` déjà vu → drop silencieux (debug log)
- [ ] Tests : envoi 1 message → réception unique côté handler ; spam 100 messages → tous traités sans doublon
- [ ] Métriques : compteur `lan.dedup.dropped` exposé via Sentry breadcrumb
**Fichiers concernés** : `src/services/lan/lanHub.ts`, `src/services/lan/lanClient.ts`, nouveau `src/services/lan/messageDedup.ts`
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : si `message.id` est non unique (bug producteur), faux positif drop → vérifier que tous les `LANMessage` ont `id: crypto.randomUUID()`
**Notes** : aligner avec `addOrder` dedup KDS qui fait déjà partial defense

### TASK-21-002 — Hub handlers KDS_ORDER_ACK + KDS_ITEM_READY [P2] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 5.A (minimal V3 contract). V3 evidence: `apps/pos/src/features/lan/lanHubMessageHandler.ts` handles `kds.bump`, `kds.recall`, `kds.undo` (D-W5-5A-05) — state mutations remain in the Phase 4.B KDS RPCs ; the hub is the fanout + print-queue trigger layer. Commit `bdf21aa`.
**Contexte** : `docs/audit/08-operations-lan-audit.md` §1.1 P2 FINDING + §4.4 P2 + Appendix B — *"Hub handles only 5 of 35 message types. KDS_ORDER_ACK, KDS_ORDER_READY, KDS_ITEM_PREPARING/READY are unhandled — limits operational visibility for the POS operator."*
**Critère d'acceptation** :
- [ ] `lanHubMessageHandler.processMessage()` ajoute case pour : `KDS_ORDER_ACK`, `KDS_ORDER_READY`, `KDS_ORDER_BUMP`, `KDS_ITEM_PREPARING`, `KDS_ITEM_READY`
- [ ] Hub met à jour table `order_items.kds_status` ou broadcast vers display/POS pour synchro UI
- [ ] POS affiche pastille temps réel "2/5 items ready" sur les commandes en cours
- [ ] Tests : KDS marque item ready → POS reflète sous 1 s
**Fichiers concernés** : `src/services/lan/lanHubMessageHandler.ts`, `src/services/lan/lanProtocol.ts` (typing), `src/components/orders/OrderRow.tsx` ou similaire
**Dépend de** : TASK-21-001 (dedup en place sinon doubles updates)
**Estimation** : `L`
**Risques** : volume messages augmente (chaque item changement) — vérifier perf hub
**Notes** : commencer par ACK (le plus simple), valider, étendre

### TASK-21-003 — Print result targeted (pas broadcast) [P2] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 5.A. V3 evidence: `print.result` envelopes in `apps/pos/src/features/lan/lanHubMessageHandler.ts` carry `to=msg.from` for targeted reply (D-W5-5A-05). Commit `bdf21aa`.
**Contexte** : `docs/audit/08-operations-lan-audit.md` §1.2 P2 FINDING — *"Print result is broadcast, not targeted. handlePrintRequest broadcasts the PRINT_RESULT to ALL devices, not just the requesting device. Should use sendToFn when available."*
**Critère d'acceptation** :
- [ ] `handlePrintRequest` utilise `sendToFn(message.from, ...)` au lieu de broadcast
- [ ] Fallback broadcast si `sendToFn` indispo (legacy clients)
- [ ] Trafic Realtime mesuré avant/après — réduction visible
**Fichiers concernés** : `src/services/lan/lanHubMessageHandler.ts`
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : minime ; cas edge si requesting device s'est déconnecté entre demande et réponse
**Notes** : pattern déjà utilisé pour `handleTabletOrderSubmit`

### TASK-21-004 — Print queue retry persistence [P2] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 5.A. V3 evidence: migration `20260517000170_init_print_queue.sql` ships `print_queue` table + `enqueue_print_job_v1`, `claim_print_job_v1`, `mark_print_failed_v1` with 3-retry-then-fail semantics (D-W5-5A-02). UI: `apps/backoffice/src/features/print-queue/components/PrintQueueTable.tsx`. Commit `bdf21aa`.
**Contexte** : `docs/audit/08-operations-lan-audit.md` §1.2 P3 FINDING — *"No print queue. If the print server is down, printLocally returns failure and the result is broadcast. There is no retry queue or persistence. In a busy bakery, a temporary printer outage means lost tickets."*
**Critère d'acceptation** :
- [ ] Table `print_queue (id, ticket_type, payload jsonb, status [pending|sent|failed], attempts, created_at, last_attempt_at)` + RLS
- [ ] Hub : sur échec print, INSERT row avec status=`pending`
- [ ] Worker (interval 5 s) : retry tickets `pending` (3 attempts max, backoff 5 s, 15 s, 60 s)
- [ ] Après 3 échecs → status `failed`, alerte UI manager + Sonner toast
- [ ] UI `/settings/printing/queue` : liste tickets en attente + bouton retry/cancel
**Fichiers concernés** : `supabase/migrations/<date>_create_print_queue.sql`, `src/services/print/printQueue.ts`, `src/services/lan/lanHub.ts`, `src/pages/settings/PrintQueuePage.tsx`
**Dépend de** : aucune
**Estimation** : `L`
**Risques** : queue grandit si printer reste down longtemps — TTL 24h pour cleanup auto
**Notes** : prioritaire pour fiabilité en heures de pointe

### TASK-21-005 — Hub failover et zombie state cleanup [P2] [BLOCKED]
**Status note (2026-05-14)** : Deferred per D-W5-5A-05 explicit statement : "21-005..011 (failover, persistence, diagnostics, etc.) : OUT OF SCOPE for Phase 5.A — deferred to Wave 6+". To be picked up in a follow-up wave.
**Contexte** : `docs/audit/08-operations-lan-audit.md` §1.1 P3 FINDING — *"After max reconnect attempts, the hub sets connectionStatus disconnected but does NOT call stop(). The hub remains in isRunning = true state with stale timers still running."*
**Critère d'acceptation** :
- [ ] Après max attempts (10) : appel `stop()` complet (clear timers, isRunning=false, channels closed)
- [ ] UI `/settings/network-devices` affiche état "Hub stopped — manual restart required"
- [ ] Bouton "Restart Hub" qui réinitialise et relance
- [ ] Optionnel : failover automatique vers un client capable de devenir hub (election simple par device_id alphabétique)
**Fichiers concernés** : `src/services/lan/lanHub.ts`, `src/pages/settings/NetworkDevicesPage.tsx`
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : failover automatique = complexité grosse, garder out-of-scope (juste cleanup zombie pour cette tâche)
**Notes** : —

### TASK-21-006 — Persistance connectedDevices côté hub [P3] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 5.A. V3 evidence: migration `20260517000171_init_lan_devices.sql` creates the `lan_devices` table used as the source of truth for device registration (D-W5-5A-01). Heartbeat-driven persistence supersedes the V2 in-memory list. Commit `bdf21aa`.
**Contexte** : `docs/audit/08-operations-lan-audit.md` §1.1 P3 FINDING — *"connectedDevices array is NOT persisted. On hub restart, all device registrations are lost. Tablet has auto-recovery, KDS / display have no such recovery."*
**Critère d'acceptation** :
- [ ] Persistance via `lan_nodes` table (existe déjà selon `CLAUDE.md`) au lieu de in-memory uniquement
- [ ] Au démarrage, hub charge devices avec heartbeat < 120 s comme actifs
- [ ] Auto-deregister après 120 s sans heartbeat (logique existante côté store reste)
- [ ] Tests : restart hub → devices toujours listés s'ils continuent à envoyer heartbeats
**Fichiers concernés** : `src/services/lan/lanHub.ts`, `src/stores/lanStore.ts`, requête startup
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : conflit entre source DB et BroadcastChannel — privilégier DB comme source of truth
**Notes** : `lan_nodes` peut nécessiter colonnes supplémentaires (vérifier)

### TASK-21-007 — Discovery : marquer browser probe comme "unverified" [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred per D-W5-5A-05 — "21-005..011 ... OUT OF SCOPE for Phase 5.A — deferred to Wave 6+". V3 `apps/pos/src/features/lan/` does not ship a `networkDiscovery.ts`. To be picked up alongside hub failover work.
**Contexte** : `docs/audit/08-operations-lan-audit.md` §1.3 P3 FINDING — *"Browser probes use mode no-cors, cannot read response. 'Success' = no exception thrown (could be a 404, redirect, or anything). False positives for any HTTP server on the scanned port."*
**Critère d'acceptation** :
- [ ] `networkDiscovery.ts` ajoute champ `verified: boolean` (true si TCP probe via print server, false si browser fallback)
- [ ] UI `/settings/network-devices` badge "Verified" (vert) ou "Unverified" (orange) à côté de chaque device détecté
- [ ] Tooltip explique : "Browser-detected — may be a false positive. Run the print server for reliable discovery."
**Fichiers concernés** : `src/services/lan/networkDiscovery.ts`, `src/components/settings/NetworkDeviceRow.tsx`
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : aucun
**Notes** : cohérent avec audit recommandation

### TASK-21-008 — Heartbeat optimisation (latence + back-pressure) [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred per D-W5-5A-05 — "21-005..011 ... OUT OF SCOPE for Phase 5.A — deferred to Wave 6+". V3 ships a basic `useLanHeartbeat` hook ; batching/back-pressure tuning is downstream work.
**Contexte** : `docs/audit/08-operations-lan-audit.md` §1.1 — heartbeat 30 s broadcast-only sans validation. Si 10 devices → 10 messages toutes les 30 s. Pas critique aujourd'hui mais à monitorer.
**Critère d'acceptation** :
- [ ] Heartbeat batchés : un seul `HUB_HEARTBEAT` toutes les 30 s avec liste connected devices
- [ ] Clients ne broadcast leur heartbeat individuel que toutes les 60 s (vs 30 s)
- [ ] Mesure : trafic Realtime divisé par 2 minimum
- [ ] Stale threshold passe à 180 s (180 = 60×3)
**Fichiers concernés** : `src/services/lan/lanHub.ts`, `src/services/lan/lanClient.ts`, `src/stores/lanStore.ts`
**Dépend de** : TASK-21-001 (dedup avant batch)
**Estimation** : `M`
**Risques** : stale detection plus lente — vérifier impact UX KDS (commande non routée si KDS apparu offline 3 min)
**Notes** : prioriser uniquement si > 8 devices LAN actifs

### TASK-21-009 — LAN diagnostics UI dashboard [P2] [BLOCKED]
**Status note (2026-05-14)** : Deferred per D-W5-5A-05 — "21-005..011 ... OUT OF SCOPE for Phase 5.A — deferred to Wave 6+". No `LANDiagnosticsPage` or `useLANDiagnostics` hook exists in V3 ; print queue table view (`PrintQueueTable.tsx`) is the only operator-facing LAN surface today.
**Contexte** : Pas mentionné explicitement audit mais implicite §5.3 DR matrix : "Hub fails / clients lose LAN messages". Manager n'a pas de cockpit pour voir l'état LAN en un coup d'œil.
**Critère d'acceptation** :
- [ ] Page `/settings/network-devices/diagnostics` (ou tab existante)
- [ ] Affiche : statut hub (running, last heartbeat), liste devices (type, name, IP, last seen, latency), trafic dernières 60 s (msg/s in/out)
- [ ] Bouton "Send test message" qui broadcast un PING et mesure RTT par device
- [ ] Logs en streaming des 50 derniers messages (filtrable par type)
**Fichiers concernés** : `src/pages/settings/LANDiagnosticsPage.tsx`, hook `useLANDiagnostics`, route à enregistrer
**Dépend de** : TASK-21-002 (handlers complets pour mesures fiables)
**Estimation** : `L`
**Risques** : log streaming → conserver max 50 messages côté client (pas DB)
**Notes** : critique pour onboarder un manager terrain au LAN

### TASK-21-010 — Cross-network LAN (Realtime fallback robustness) [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred per D-W5-5A-05 — "21-005..011 ... OUT OF SCOPE for Phase 5.A — deferred to Wave 6+". No ADR `adr-003-lan-fallback-strategy.md` shipped.
**Contexte** : Architecture hybride BroadcastChannel (intra-tab) + Realtime (cross-network) actuelle suppose Supabase Realtime fiable. Si la connexion internet de Lombok casse mais le LAN fonctionne, le Realtime est down → fallback uniquement BroadcastChannel (limité même origin).
**Critère d'acceptation** :
- [ ] Investigation : tester WebRTC ou WebSocket peer-to-peer LAN-only via print server (port 3001) comme 3e canal
- [ ] ADR rédigé `adr-003-lan-fallback-strategy.md` : pros/cons WebRTC vs broker local
- [ ] Pas d'implémentation immédiate — décision documentée
**Fichiers concernés** : ADR
**Dépend de** : aucune
**Estimation** : `M` (recherche)
**Risques** : sur-ingénierie ; à ne déclencher que si 1 incident réel reporté
**Notes** : Lombok = connexion 4G parfois instable, situation possible

### TASK-21-011 — Multi-LAN segmentation (P3 multi-store future) [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred to Wave 7 per INDEX line 1089 : "LAN multi-site (Session 17)" + D-W5-5A-05 "21-005..011 OUT OF SCOPE". Gated on TASK-19-008 multi-tenancy foundation.
**Contexte** : Lié à TASK-19-008 (multi-tenancy). Si 2 boutiques → 2 LANs distincts → channel `appgrav-lan` partagé causera collision.
**Critère d'acceptation** :
- [ ] Channel name dynamique : `appgrav-lan-${storeId}` au lieu de `appgrav-lan`
- [ ] Idem `lan-hub` Realtime : suffixé par store_id
- [ ] Configuration par environnement (variable `VITE_STORE_ID`)
- [ ] ADR aligné avec TASK-19-008
**Fichiers concernés** : `src/services/lan/lanHub.ts`, `src/services/lan/lanClient.ts`, env config
**Dépend de** : TASK-19-008
**Estimation** : `M`
**Risques** : breaking change pour clients existants — bumper version protocol
**Notes** : reporter tant que mono-store

---

## Synthèse priorité

| Priorité | Tâches |
|----------|--------|
| P1 | 21-001 |
| P2 | 21-002, 21-003, 21-004, 21-005, 21-009 |
| P3 | 21-006, 21-007, 21-008, 21-010, 21-011 |
