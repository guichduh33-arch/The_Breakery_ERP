# Module 18 — Application mobile (téléphone)

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 18. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** À venir (reporté à un chantier dédié)
> **Verdict global de l'analyse :** La doc est fidèle — aucun shell mobile dédié n'existe dans le code ; seuls quelques préparatifs dormants (dépendance PWA inutilisée, wrapper de stockage « Capacitor-ready ») subsistent, exactement comme la doc le décrit.

## A. Ce qui fonctionne réellement (code vérifié)

- **Aucune app mobile dédiée** : le monorepo ne contient que `apps/pos` et `apps/backoffice` (vérifié `ls apps/`). Pas de `apps/mobile`, pas de projet Capacitor (`capacitor.config.*` absent, `@capacitor/*` absent des dépendances), pas de projet Tauri (`apps/pos/src-tauri` inexistant), pas de manifest PWA (`apps/pos/public/` ne contient que `favicon.svg`), pas de service worker.
- **Dépendance PWA dormante** : `vite-plugin-pwa@^1.0.0` est déclaré dans `apps/pos/package.json:44` mais **jamais importé** — `apps/pos/vite.config.ts` ne charge que `@vitejs/plugin-react` (ligne 6, `plugins: [react()]`). Dépendance morte, aucun effet au build. [NON-CÂBLÉ par nature — préparatif]
- **Wrapper de stockage « Capacitor-ready »** : `packages/utils/src/safeStorage.ts:2-6` — abstraction async sur `localStorage`/`sessionStorage`, explicitement commentée « En Capacitor (futur) : @capacitor/preferences. L'API est asynchrone partout pour préparer Capacitor. » Consommé par ex. par `apps/pos/src/stores/kdsStore.ts:4`. C'est le seul artefact « mobile » réel : une graine, pas un shell. [UI câblée, mais comme simple wrapper web]
- **Accès web sur téléphone de fait** : les deux apps sont des SPA Vite/React responsives servies par navigateur ; le mode waiter/tablette du POS (module 17) est utilisable sur un téléphone via le navigateur, sans installation ni notifications. C'est ce que la doc décrit (« fonctionne comme un site web utilisable sur téléphone »).

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qui existe aujourd'hui »)
- B1.1 — La version actuelle fonctionne comme un site web utilisable sur téléphone.
- B1.2 — L'application mobile dédiée (V2 : PIN, navigation au pouce, favoris, APK Android) n'a **pas** été reconstruite — chantier volontairement reporté. (Revendication d'absence, à confirmer telle quelle.)

### B2. Annoncé « À venir »
- B2.1 — Reconstruire l'application téléphone dans la nouvelle version.
- B2.2 — Application Android installable (APK/TWA).
- B2.3 — Indicateur réseau honnête + retour tactile (haptique).
- B2.4 — Notifications même application fermée (« commande prête », « stock bas »).
- B2.5 — Scanner de codes-barres via l'appareil photo pour les réceptions de stock.
- B2.6 — Version iPhone envisagée après l'Android.

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Utilisable comme site web sur téléphone | SPAs Vite/React responsives ; mode tablette waiter du POS accessible par navigateur mobile (`apps/pos/src/features/tablet/`) | ✅ CONFORME |
| B1.2 | Pas d'app mobile dédiée (reportée) | Confirmé : ni Capacitor, ni PWA active, ni manifest, ni service worker, ni `apps/mobile`. Seuls vestiges : `vite-plugin-pwa` non importé (`apps/pos/package.json:44`) et `safeStorage.ts` Capacitor-ready | ✅ CONFORME |

**Bonus code (le code fait plus que la doc) :** 🔵 `packages/utils/src/safeStorage.ts` — abstraction de stockage async déjà généralisée dans le POS, qui réduira le coût du futur portage Capacitor (non mentionné par la doc).

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
- **Purger ou activer `vite-plugin-pwa`** : la dépendance est déclarée mais inutilisée (`apps/pos/package.json:44`). Soit la retirer (hygiène deps ; done = `pnpm install` + build 2/2 verts), soit — si on veut un premier pas mobile à très bas coût — l'activer avec un manifest minimal (installable en écran d'accueil Android, pas de notifications). Décision produit à trancher avant.
- **Ajouter les meta viewport/theme-color cohérents** pour l'usage navigateur mobile si absents (vérifier `apps/pos/index.html`). Done : rendu correct sur un téléphone en 360px.

### D2. Chantiers moyens (1 session, plan requis)
- **PWA installable complète pour le POS waiter** : manifest + service worker (precache shell uniquement, PAS de cache des données — les writes passent par RPC et l'offline est explicitement un chantier module 17), icônes, indicateur réseau honnête (B2.3, partie visuelle). Prérequis : décision produit PWA vs Capacitor.

### D3. Chantiers lourds (spec dédiée avant code)
- **Reconstruction de l'app téléphone (B2.1/B2.2/B2.4/B2.5)** : spec dédiée obligatoire — choix du shell (PWA vs Capacitor ; `safeStorage` prépare Capacitor), périmètre v1 (consultation + alerte « plat prêt » ?), notifications push app fermée (nécessite FCM ou équivalent + une EF `notification-dispatch` côté serveur — une EF `notification-dispatch` existe déjà, à évaluer comme point d'ancrage), scanner code-barres caméra (module stock), auth PIN sur mobile (le fetch-wrapper PIN JWT de `packages/supabase` doit fonctionner dans le shell choisi). Ne pas démarrer sans trancher la dépendance au chantier offline du module 17 (la doc le dit elle-même : besoin n°1).

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
- Aucun amendement nécessaire : le module 18 est l'un des rares où la doc est exactement alignée sur le code. Optionnel : mentionner que des préparatifs techniques existent déjà (stockage Capacitor-ready), pour crédibiliser le « reporté » plutôt qu'« abandonné ».

## E. Dépendances croisées

- **Module 17 (tablette serveur)** : la doc y place l'offline-first en besoin n°1 — le shell mobile doit hériter de cette décision, pas la dupliquer.
- **Module 21 (réseau local)** : un téléphone hors LAN passera par internet ; l'indicateur réseau honnête (B2.3) dépend du vocabulaire d'état réseau du lanHub.
- **Module 3/stock (scanner codes-barres B2.5)** : la réception de stock (RPCs `receive_stock_v1`/`record_incoming_stock_v1`) est la cible du scanner.
- **Module 25 (sécurité)** : auth PIN JWT + timeout de session par rôle devront être re-validés dans un shell natif.
