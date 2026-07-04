# Module 04 — Écran cuisine (KDS)

> ⚠️ **Mise à jour S59 (2026-07-04, `swarm/session-59`)** : **D1.1/D1.3 livrés** — undo-bump 60 s, recall, prep-timer câblés (RPCs `kds_*_v1`) + alarme sonore WebAudio à la nouvelle commande (dédup + toggle mute persisté). **D1.2 « Tout prêt » (bump en masse) reste au lot 2 (S60)** car sous règle money-path. Voir `docs/workplan/plans/2026-07-04-session-59-INDEX.md`.

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 4. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel
> **Verdict global de l'analyse :** Le socle (routage par poste, chronos, couleurs, cycle Prêt/Servi, temps réel) est réel et robuste, mais la doc surclame nettement : pas d'alarme sonore, pas de « Tout prêt », pas de notes/allergies, pas de vue serveur agrégée, pas de compteur du jour, aucun réglage par poste — et le « canal de secours internet » décrit à l'envers (l'internet est le canal nominal, le mesh LAN est du code mort).

## A. Ce qui fonctionne réellement (code vérifié)

- **Route `/kds` protégée (PIN staff), lazy-loadée** — `apps/pos/src/routes/index.tsx:9,74-83`. [UI câblée]
- **Un écran par poste** : sélecteur 3 postes Kitchen / Barista / Display-Vitrine, choix persisté par appareil (sessionStorage) — `apps/pos/src/features/kds/components/KdsStationSelector.tsx:10-14`, `apps/pos/src/stores/kdsStore.ts`. [UI câblée]
- **Routage automatique famille → poste, avec override produit multi-postes** : `categories.dispatch_station` + `products.dispatch_stations[]` résolus par le helper interne `_resolve_dispatch_stations_v1` (REVOKE anon/authenticated/PUBLIC) et **snapshotés sur `order_items` à la création** (create_tablet/fire_counter/complete_order) — migrations `20260710000041`, `20260710000042`. La query KDS filtre en dual-branch (array `dispatch_stations` contient le poste, fallback legacy `dispatch_station`) — `apps/pos/src/features/kds/hooks/useKdsOrders.ts:128-133`. [RPC + UI câblée]
- **Temps réel < 1 s** : subscription `postgres_changes` sur `order_items` filtrée par poste, invalidation TanStack — `apps/pos/src/features/kds/hooks/useKdsRealtime.ts:54-78` (pattern canal-unique StrictMode). **Filet** : refetch poll 30 s (`useKdsOrders.ts:109`) + resync après reconnexion réseau `useReconnectInvalidate` — `apps/pos/src/pages/Kds.tsx:20-24`. [UI câblée]
- **Chronomètre par commande** (âge du plus ancien item, MM:SS, tick 1 s) + **code couleur 3 bandes** : vert (< 300 s), orange (≥ 300 s), rouge **clignotant** `animate-pulse` (≥ 600 s) — `apps/pos/src/features/kds/components/KdsOrderCard.tsx:45-46,61-81,147-186`. Seuils **codés en dur** (pas réglables). [UI câblée]
- **Cycle par article** : `Start` (pending→preparing) → `Bump Ready` (preparing→ready, pose `ready_at`) → `Mark Served` (RPC `mark_item_served`, migration `20260506000004`) — `KdsOrderCard.tsx:96-138`, `hooks/useBumpItem.ts`, `hooks/useMarkItemServed.ts`. Transitions gardées par `canTransition` (`@breakery/domain`). [UI câblée]
- **Badge PAID** sur le ticket quand la commande est déjà payée — `KdsOrderCard.tsx:174-178`. [UI câblée]
- **Lignes annulées** : strikethrough + badge « Cancelled » + raison — `KdsOrderCard.tsx:88-94,222-226`. [UI câblée]
- **Auto-archivage** : les items `ready` disparaissent seuls après 5 min (client-side, la ligne DB reste) — `apps/pos/src/features/kds/KdsBoard.tsx:48,143-149`. [UI câblée]
- **État d'erreur honnête** : un échec de fetch affiche « Connexion au KDS perdue » + bouton Retry, jamais un faux « file vide » — `KdsBoard.tsx:108-117`. [UI câblée]
- **Tickets papier par poste** : au fire, impression directe des KOT par station + ticket waiter consolidé, persist-first en DB (l'échec d'impression n'invalide pas la commande : « saved to KDS, not printed ») — `apps/pos/src/features/cart/hooks/useFireToStations.ts:200-298` (cf. module 21). [UI câblée]
- **Chips de filtre granulaire** hot/cold/bar/prep/expo — `apps/pos/src/features/kds/components/StationFilter.tsx`. ⚠️ **No-op fonctionnel** : le prédicat n'applique le chip que si le champ `kds_station` existe sur la row, or la query ne le sélectionne jamais (`KdsBoard.tsx:151-159`, commentaire « if that column ever surfaces ») — seuls les chips ≠ 'all' ne filtrent donc rien. [UI câblée mais inerte]

**Présent sur le disque mais NON-CÂBLÉ (⚫)** — composants jamais importés hors tests, RPCs live sans call-site :
- **Undo-bump 60 s** : `components/BumpButton.tsx` + `UndoBumpToast.tsx` + RPCs `kds_bump_item_v1`/`kds_undo_bump_v1` (migration `20260517000151`).
- **Recall d'une commande servie** (dialog + raison) : `components/RecallButton.tsx` + RPC `kds_recall_order_v1` (`20260517000151`).
- **Prep timer serveur** : `components/PrepTimer.tsx` + RPC `kds_start_prep_timer_v1` + colonne `order_items.prep_started_at` (`20260517000150-151`).
- **Auth kiosque KDS** : `features/kds/hooks/useKioskAuth.ts` (scope 'kds') — aucun consommateur ; la route `/kds` exige une session PIN staff.

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Chaque poste voit uniquement ses articles ; routage automatique selon la famille du produit.
- B1.2 Chaque article a son tempo (le cappuccino part en 1 min, le croque-monsieur en 8).
- B1.3 Code couleur selon l'attente : vert / orange / rouge clignotant **avec alarme sonore** (critique, > 12 min).
- B1.4 « Prêt » par article ; bouton « Tout prêt » par commande **qui fait sonner la caisse** ; appui long → note allergie en grand.
- B1.5 Vue serveur : un écran qui agrège tous les postes (table complète).
- B1.6 Compteur du jour (« Cappuccino : 47 préparés ») ; les commandes terminées disparaissent seules.
- B1.7 Résilience réseau : si le wifi local vacille, un canal de secours par internet prend le relais (< 1 s dans les deux cas).
- B1.8 Réglable par poste : seuils d'alerte, sons, taille de police, disposition.

### B2. Annoncé « À venir »
- B2.1 Tableau de bord « vitesse de service » par poste.
- B2.2 Alerte de saturation (20 cafés en 30 s).
- B2.3 Accusé de réception formel côté caisse.
- B2.4 Bouton URGENT + transfert manuel d'un article vers un autre poste.
- B2.5 Mode de secours en cas de panne totale (wifi + internet).

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Un écran par poste, routage auto par famille | Sélecteur 3 postes + filtre serveur `dispatch_station(s)` snapshoté à la commande, override produit multi-postes (`useKdsOrders.ts:128-133`, migrations `_041/_042`) | ✅ CONFORME |
| B1.2 | Tempo par article (cappuccino 1 min, croque 8 min) | Aucun modèle de temps de préparation par produit (ni colonne, ni logique) ; seule la séparation par poste différencie le service | 🔴 MANQUANT |
| B1.3 | Vert / orange / rouge clignotant + **alarme sonore** > 12 min | Couleurs + pulse ✓ mais seuils **5/10 min hardcodés** (pas 12) et **zéro audio dans tout le POS** (grep `audio|beep|sound|AudioContext` : 0 hit hors commentaire) — `KdsOrderCard.tsx:45-46` | 🟠 PARTIEL |
| B1.4 | Prêt par article + « Tout prêt » qui sonne la caisse + appui long note allergie | Prêt par article ✓ (`Bump Ready`) ; **aucun bouton « Tout prêt » par commande**, **aucun son côté caisse**, **aucune note/allergie** (pas de colonne note sur `order_items`, pas d'appui long) | 🟠 PARTIEL |
| B1.5 | Vue serveur agrégée tous postes | Inexistante — un seul poste affiché à la fois ; les chips hot/cold/… sont no-op (`KdsBoard.tsx:151-159`) | 🔴 MANQUANT |
| B1.6 | Compteur du jour + disparition auto des terminées | Compteur du jour : **inexistant**. Disparition auto : ✓ archive 5 min (`KdsBoard.tsx:48,143-149`) | 🟠 PARTIEL |
| B1.7 | Canal de secours par internet si le wifi local vacille | Inversé : **Supabase Realtime (internet) EST le canal nominal** + poll 30 s + resync reconnexion ; le mesh LAN hybride (BroadcastChannel+Realtime) existe mais n'est **jamais monté** (cf. module 21) | 🟠 PARTIEL — *le 🟠 reflète le filet poll/resync réel, pas une résilience locale : le même mesh mort est noté 🔴/⚫ en fiche 21, qui fait foi sur le transport local* |
| B1.8 | Réglable par poste : seuils, sons, police, disposition | Rien : seuils hardcodés, pas de sons, pas de réglage police/disposition ; le settings store POS n'a aucun champ KDS (`posSettingsStore.ts:18-35`) | 🔴 MANQUANT |

**Bonus code (le code fait plus que la doc) :**
- 🔵 Badge **PAID** sur le ticket (la cuisine sait que c'est déjà encaissé) — `KdsOrderCard.tsx:174`.
- 🔵 Lignes **annulées** visibles avec raison (strikethrough + badge) — la cuisine ne prépare pas un item annulé.
- 🔵 État d'erreur + Retry (jamais de fausse file vide) et triple filet realtime + poll 30 s + reconnect-invalidate.
- 🔵 (⚫ non câblés mais prêts) Undo-bump 60 s, Recall d'une commande servie avec raison, prep-timer serveur — RPCs live + composants testés.

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
1. **Alarme sonore seuil critique** : jouer un bip (WebAudio, pas d'asset) quand une carte passe en bande `urgent`, avec toggle mute persisté dans `kdsStore`. Fichiers : `KdsBoard.tsx` (ou hook dédié `useKdsAlarm`), `kdsStore.ts`. Done : son émis une fois par passage de bande, toggle visible dans le header KDS.
2. **Bouton « Tout prêt » par commande** : bump en masse des items pending/preparing d'une carte (boucle `useBumpItem` ou RPC dédié). Fichiers : `KdsOrderCard.tsx`. Done : un tap passe toute la carte en ready.
3. **Câbler l'undo-bump, le recall et le prep-timer existants** : remplacer le CTA `Bump Ready` par `BumpButton` (undo 60 s), ajouter `RecallButton` sur les cartes servies, et monter `PrepTimer` sur le CTA `Start` (RPC `kds_start_prep_timer_v1` + colonne `prep_started_at` déjà en DB) — les RPCs `kds_bump_item_v1`/`kds_undo_bump_v1`/`kds_recall_order_v1` sont déjà live. Fichiers : `KdsOrderCard.tsx`. Done : undo visible 60 s après bump, recall accessible, timer de préparation affiché sur les items démarrés.
4. **Supprimer ou câbler les chips StationFilter** : soit sélectionner `categories.kds_station` dans `useKdsOrders` et filtrer réellement, soit retirer la rangée de chips (UI mensongère). Fichiers : `useKdsOrders.ts`, `KdsBoard.tsx`, `StationFilter.tsx`. Done : un chip actif change la liste affichée (ou n'existe plus).
5. **Compteur du jour** : agrégat client des items `ready`+`served` du jour par produit (query dédiée) affiché dans le header. Fichiers : nouveau hook `useKdsDayCounter.ts`, `KdsBoard.tsx`. Done : « Cappuccino : N » visible et à jour.

### D2. Chantiers moyens (1 session, plan requis)
1. **Réglages par poste** : seuils warning/urgent, mute son, taille de police — champs dans `kdsStore` (persisté par appareil) + panneau réglages sur l'écran KDS ; remplacer les constantes `WARNING_THRESHOLD_MS`/`URGENT_THRESHOLD_MS` par le store.
2. **Vue serveur agrégée** : mode « Expo/All stations » du board (query sans filtre station, groupement par table avec indicateur « complet » = tous items ready), accessible depuis le sélecteur de poste.
3. **Notes de commande sur le KDS** : afficher `orders.notes` (colonne existante) sur la carte + zoom appui long ; dépend du module 17 pour la saisie côté tablette (D2 croisé).

### D3. Chantiers lourds (spec dédiée avant code)
1. **Tempo par article** (temps de préparation cible par produit, tri de lancement, « fire différé » du café) — nouveau modèle de données + logique d'ordonnancement ; toucher `products`, la query KDS et l'UX carte.
2. **Mode secours panne totale** (B2.5) + accusé de réception formel caisse (B2.3) — dépend de la remise à plat du module 21 (transport local réel).

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
- Corriger B1.7 : décrire le réel — « le KDS passe par internet (Supabase Realtime) avec rattrapage automatique en ≤ 30 s ; il n'y a pas de canal local » — ou garder la promesse et pointer D3 module 21.
- B1.3 : corriger « plus de 12 minutes » → 5 min (orange) / 10 min (rouge) tant que D2.1 n'est pas fait.
- Retirer de « aujourd'hui » : tempo par article, vue serveur, compteur du jour, réglages par poste, « Tout prêt », alarme sonore, notes allergie (les déplacer en « À venir »).
- Mentionner ce qui existe vraiment : badge PAID, lignes annulées, undo/recall (une fois câblés — D1.3).

## E. Dépendances croisées
- **Module 17 (Tablette)** : les notes/allergies n'arrivent au KDS que si la tablette (et la caisse) les saisit — chantier commun D2.3.
- **Module 21 (Réseau local)** : « canal de secours », mode panne totale, sonnerie caisse inter-postes reposent sur un transport inter-appareils réel (le mesh LAN est aujourd'hui du code mort).
- **Module 5 (Catalogue)** : le routage dépend de `categories.dispatch_station` / `products.dispatch_stations` (admin BO) ; le tempo par article (D3.1) ajouterait un champ produit.
- **Module 16 (Écran client)** : « votre commande est prête » côté client supposerait de brancher le display sur `kitchen_status` (aujourd'hui il n'écoute que les commandes payées).
