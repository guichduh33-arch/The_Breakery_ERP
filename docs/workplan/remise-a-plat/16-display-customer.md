# Module 16 — Écran côté client

> ⚠️ **Mise à jour S59 (2026-07-04, `swarm/session-59`)** : **D1.2 livré** — le ticker de l'écran client a désormais une section « Prêt à retirer » branchée sur les items réellement `ready` (`useReadyOrders`, plafond 5, tri urgence) ; un bump KDS y fait apparaître la commande sans paiement préalable. C-B1.3 n'est plus 🟠. Voir `docs/workplan/plans/archive/2026-07-04-session-59-INDEX.md`.

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 16. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Partiel
> **Verdict global de l'analyse :** La doc est globalement honnête (statut « Partiel » assumé) : miroir panier, merci/monnaie 8 s et fil des commandes existent. Deux nuances importantes : le « bandeau commandes prêtes » affiche en réalité les commandes *payées* (pas « prêtes » cuisine), et le miroir panier repose sur `BroadcastChannel` — il ne fonctionne que si l'écran client est une fenêtre du **même poste** que la caisse (un appareil séparé appairé en kiosque n'affiche que le fil des commandes, jamais le panier).

## A. Ce qui fonctionne réellement (code vérifié)

- **Route `/display` publique** (pas de PIN staff), lazy — `apps/pos/src/routes/index.tsx:13-17,85-91`. L'accès data passe par un **JWT kiosque** émis par l'EF `kiosk-issue-jwt` (`supabase/functions/kiosk-issue-jwt/`), après **appairage** de l'appareil (code → `display_screens`, migration `20260517000160`) ; UI d'appairage `PairDevicePrompt` + machine d'état auth (`CustomerDisplayPage.tsx:34-125`, `features/display/hooks/useKioskAuth.ts`). [UI câblée + EF]
- **Miroir panier temps réel** : la caisse publie chaque mutation du panier sur `BroadcastChannel('breakery-cart')` (`useCartBroadcast` monté dans `apps/pos/src/features/cart/ActiveOrderPanel.tsx:73`) ; le display l'affiche (lignes qty × prix, nom client attaché, total en gros caractères gold) — `features/display/hooks/useCartBroadcast.ts`, `useCartBroadcastReceiver.ts`, `CDActiveCartView.tsx:44-66`. Le total broadcasté **déduit les promotions appliquées** (`useCartBroadcast.ts:57-63`). ⚠️ Portée : même machine/même origine uniquement (limitation BroadcastChannel). [UI câblée]
- **Écran « Merci » + monnaie 8 s** (S57 C-D4) : à chaque paiement réussi, le `SuccessModal` de la caisse broadcast `payment_complete` (`apps/pos/src/features/payment/SuccessModal.tsx:155`) ; le display affiche « Merci ! / Paiement reçu » + « Monnaie à rendre » **uniquement si méthode = cash et monnaie > 0**, pendant `PAYMENT_COMPLETE_DISPLAY_MS = 8_000`, puis revient à l'accueil ; un nouveau panier interrompt l'écran merci — `useCartBroadcast.ts:8-40`, `useCartBroadcastReceiver.ts:14-28`, `CDActiveCartView.tsx:12-33`. [UI câblée]
- **« Now Serving » + fil des commandes** : carte héro de la dernière commande payée + ticker des 5 commandes `paid`/`completed` des 15 dernières minutes (n° commande, pill statut, Table N / Pickup) — `features/display/hooks/useDisplayOrders.ts` (limit 5, fenêtre 15 min), `components/CurrentOrderCard.tsx`, `components/OrderQueueTicker.tsx`. Rafraîchi < 1 s par realtime `orders` + resync reconnexion — `hooks/useDisplayRealtime.ts:26-50` (`useReconnectInvalidate`). [UI câblée]
- **Mode accueil / identité de marque** : header « The Breakery — French Bakery & Pastry », état vide « Welcome to The Breakery », footer configurable **par terminal** (POS Settings → message d'accueil, `posSettingsStore.displayFooterMessage`, défaut « Open daily · 07:00 — 21:00 ») — `components/BrandedLayout.tsx:28-43`, `CustomerDisplayPage.tsx:31-38`. [UI câblée]
- **Purement récepteur** : aucune écriture DB depuis `/display` (lectures `orders` + réception broadcasts) — conforme au principe de la doc. [vérifié]
- Existe aussi sur le disque : `CustomerDisplayView.tsx` (vue riche avec photos produits, badges promo/annulé, bande de totaux) — **jamais importée hors tests** ; la page utilise `CDActiveCartView`, plus sommaire. [⚫ NON-CÂBLÉ]

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qui existe aujourd'hui »)
- B1.1 Miroir du panier en direct (< 1 s par article, total en gros caractères) — et, selon l'intro, produits **+ remises + points de fidélité** + total.
- B1.2 Fin de paiement espèces : message de remerciement + monnaie à rendre pendant 8 s.
- B1.3 Un bandeau annonce les **commandes prêtes** ; un fil des dernières commandes défile.
- B1.4 (Scénario/intro) En creux, l'écran affiche le logo et les visuels de la maison.

### B2. Annoncé « À venir »
- B2.1 QR code de paiement mobile (attente prestataire).
- B2.2 Personnalisation sans informaticien (couleurs, logo, mise en page depuis les réglages).
- B2.3 Tableau « commandes prêtes » style aéroport.
- B2.4 Rotation de promotions et vidéos en mode veille.
- B2.5 Synchronisation garantie de deux écrans en parallèle.

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Miroir panier < 1 s, total en gros ; produits + remises + points fidélité | Miroir ✓ instantané (BroadcastChannel), total gold 3xl ✓, nom du client ✓, promotions **déduites du total** mais **aucune ligne « remise » affichée** et **aucun affichage de points de fidélité** ; et le miroir ne marche que sur le même poste que la caisse (`CDActiveCartView.tsx`, `useCartBroadcast.ts:57-63`) | 🟠 PARTIEL |
| B1.2 | Merci + monnaie 8 s en fin de paiement espèces | ✓ Exactement implémenté (8 s, masqué si ≠ cash ou monnaie 0, interrompu par le panier suivant) — `CDActiveCartView.tsx:12-33`, `SuccessModal.tsx:155` | ✅ CONFORME |
| B1.3 | Bandeau des commandes **prêtes** + fil des dernières commandes | Le ticker liste les commandes **payées/complétées** des 15 dernières min — il n'écoute **pas** `kitchen_status='ready'` du KDS ; « Now Serving » = dernière payée, pas dernière prête (`useDisplayOrders.ts:44-49`) | 🟠 PARTIEL |
| B1.4 | Logo / visuels de la maison en creux | Accueil brandé (wordmark + welcome) ✓ ; pas de « visuels » (photos/vidéos) ni rotation — cohérent avec B2.4 | ✅ CONFORME |

**Bonus code (le code fait plus que la doc) :**
- 🔵 Appairage kiosque sécurisé complet (code d'appairage `display_screens` + JWT kiosque via EF + refresh auto + fallback ré-appairage) — la doc ne le mentionne pas.
- 🔵 Message d'accueil du footer déjà personnalisable par terminal (petit début de B2.2).
- 🔵 Nom du client fidèle attaché affiché sur le panier.
- 🔵 `CustomerDisplayView` (photos produits, badges promo/annulé) prêt mais non branché (⚫) — candidat gratuit pour enrichir B1.1.

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
1. **Afficher les remises et lignes cadeaux** sur le miroir : enrichir `CartUpdateMessage` (montant promo, lignes `is_promo_gift`) et rendre une ligne « Remise −X » dans `CDActiveCartView`. Fichiers : `useCartBroadcast.ts`, `CDActiveCartView.tsx`. Done : une promo appliquée en caisse apparaît comme ligne dédiée côté client.
2. **Brancher le ticker sur les commandes réellement prêtes** : requête/subscription sur `order_items.kitchen_status='ready'` agrégée par commande (ou vue dédiée), section « Prêt à retirer » distincte du fil « payées ». Fichiers : `useDisplayOrders.ts` (ou nouveau hook), `OrderQueueTicker.tsx`, `CurrentOrderCard.tsx`. Done : bumper un item au KDS fait apparaître la commande côté client sans paiement préalable.
3. **Points de fidélité gagnés** sur l'écran merci : le retour de `complete_order_with_payment_v17` contient les points ; les passer dans `broadcastPaymentComplete`. Fichiers : `SuccessModal.tsx`, `useCartBroadcast.ts`, `CDActiveCartView.tsx`. Done : « +N points » visible pendant les 8 s.

### D2. Chantiers moyens (1 session, plan requis)
1. **Miroir panier multi-appareils** : remplacer/doubler `BroadcastChannel` par un canal Supabase Realtime broadcast scoped au terminal (topic partagé caisse↔display appairé), avec dédup et fallback local — sinon documenter la contrainte « second écran du même poste ».
2. **Réutiliser `CustomerDisplayView`** (photos produits, badges) comme rendu du panier : mapper `CartUpdateMessage` → `CustomerDisplayLine[]`, enrichir `image_url` via le cache produits.
3. **Mode veille riche** (B2.4 partiel) : rotation d'images/promos actives (`promotions` en DB) après N minutes d'inactivité.

### D3. Chantiers lourds (spec dédiée avant code)
1. **QR paiement mobile** (B2.1) — dépend du prestataire de paiement ; toucher money-path (EF `process-payment`) : spec obligatoire.
2. **Personnalisation no-code complète** (B2.2 : couleurs, logo, layout depuis le BO) + **sync garantie multi-écrans** (B2.5) — modèle de config partagé + protocole d'état.

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
- B1.3 : écrire « fil des dernières commandes **payées** » tant que D1.2 n'est pas fait ; réserver « commandes prêtes » à l'à-venir.
- B1.1 : préciser que remises et points de fidélité ne sont pas affichés en lignes (seul le total en tient compte), et que l'écran doit être **une fenêtre du poste caisse** (contrainte technique actuelle).
- Ajouter l'appairage kiosque (code + JWT) à la description — c'est un vrai flux opérateur (première installation).

## E. Dépendances croisées
- **Module 2/3 (Caisse & encaissement)** : source des broadcasts `cart_update` / `payment_complete` ; les points fidélité (D1.3) dépendent du retour de `complete_order_with_payment_v17`.
- **Module 4 (KDS)** : « commandes prêtes » (D1.2) consomme `kitchen_status` posé par le KDS.
- **Module 13 (Promotions)** : rotation des promos en veille (D2.3) lit les promotions actives.
- **Module 21 (Réseau local)** : le miroir multi-appareils (D2.1) est le même besoin de transport que le mesh LAN — à traiter ensemble.
