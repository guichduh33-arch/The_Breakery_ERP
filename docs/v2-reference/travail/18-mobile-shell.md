# Travail — Mobile Shell

> Last updated: 2026-05-03
> Référence : [`../04-modules/18-mobile-shell.md`](../04-modules/18-mobile-shell.md)
> Sources audit : `docs/audit/08-operations-lan-audit.md` §3, `docs/audit/05-uiux-design-audit.md`, `docs/audit/ux-gap-analysis-2026-05-01.md`

## Objectifs du module

1. Réduire l'écart "WebView wrapper" en exposant les capacités natives Capacitor utiles aux serveurs de salle (haptique, network state, push) — cible : ≥ 4 plugins natifs réellement utilisés (vs 3 aujourd'hui : SplashScreen, StatusBar, Keyboard).
2. Stabiliser la pipeline de build Android, automatiser `cap sync` + signature dans la CI, et documenter la procédure — cible : 1 release APK reproductible en < 30 min.
3. Préparer l'option iOS sans s'engager sur une release : projet Xcode présent, build manuel validé une fois, doc minimale.
4. Améliorer l'UX mobile-first des pages `/mobile/*` (skeletons, états vides, indicateur réseau réel) — cible : 0 page mobile sans skeleton ni état vide.
5. Maintenir Capacitor à jour (cible : suivre la branche stable, upgrade dans les 6 mois suivant la sortie majeure).

---

## Tâches

### TASK-18-001 — Indicateur réseau réel dans MobileLayout [P2] [TODO]
**Contexte** : `docs/audit/08-operations-lan-audit.md` §3.2 P3 FINDING — *"No offline graceful degradation. The Wifi icon is always green and does not reflect actual connection state."*
**Critère d'acceptation** :
- [ ] L'icône `Wifi` du `MobileLayout` reflète `navigator.onLine` ET le statut Realtime Supabase
- [ ] Lorsqu'on est offline, un bandeau discret apparaît en haut de l'écran (texte "Offline — last sync HH:MM")
- [ ] Tap sur l'icône ouvre un mini-popover précisant le statut (LAN hub, Realtime, internet)
**Fichiers concernés** : `src/components/mobile/MobileLayout.tsx`, nouveau hook `src/hooks/useNetworkStatus.ts`, `src/stores/lanStore.ts` (selector connectionStatus)
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : `navigator.onLine` peu fiable sur Android WebView ; ajouter un test ping Supabase périodique (toutes les 30 s)
**Notes** : pré-requis a minima pour TASK-18-002 (haptique sur changement d'état)

### TASK-18-002 — Activer Capacitor Haptics + Network plugins [P2] [TODO]
**Contexte** : `docs/audit/08-operations-lan-audit.md` §3.2 P2 FINDING — *"Limited mobile-specific UX. No native plugin usage beyond SplashScreen/StatusBar/Keyboard. No haptic feedback, no network state monitoring."* + `04-modules/18-mobile-shell.md` mentionne déjà `hapticEnabled` dans le store sans implémentation visible.
**Critère d'acceptation** :
- [ ] Plugins `@capacitor/haptics` + `@capacitor/network` ajoutés à `package.json` et `cap sync` exécuté
- [ ] Haptique léger (`Haptics.impact({ style: 'Light' })`) sur ajout au panier mobile, vibration medium sur "Send to Kitchen", error sur lockout login
- [ ] Network plugin remplace le hack `navigator.onLine` de TASK-18-001
- [ ] Toggle `hapticEnabled` du store réellement câblé (no-op si web ou désactivé)
**Fichiers concernés** : `src/hooks/useCapacitorInit.ts`, `src/hooks/useHaptics.ts` (nouveau), `src/pages/mobile/MobileCartPage.tsx`, `src/pages/mobile/MobileLoginPage.tsx`, `package.json`, `capacitor.config.ts`
**Dépend de** : TASK-18-001
**Estimation** : `M`
**Risques** : régression iOS PWA (Haptics no-op via `Capacitor.isPluginAvailable`)
**Notes** : tester sur device Android réel — émulateur ne vibre pas

### TASK-18-003 — CI/CD build APK Android automatisé [P2] [TODO]
**Contexte** : `docs/audit/08-operations-lan-audit.md` §5.2 ne mentionne aucune pipeline mobile ; `CLAUDE.md` cite `npm run android:build` mais aucune CI n'est documentée. Builds aujourd'hui manuels.
**Critère d'acceptation** :
- [ ] Workflow GitHub Actions `mobile-android.yml` qui : `npm ci` → `npm run build` → `npx cap sync android` → `gradle assembleRelease` → upload artefact APK signé
- [ ] Secrets de signature (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`) configurés dans GitHub repo secrets
- [ ] Trigger : tag `mobile-v*` OU manuel via `workflow_dispatch`
- [ ] Doc `docs/v2-reference/10-deployment-ops/mobile-release.md` créée
**Fichiers concernés** : `.github/workflows/mobile-android.yml`, `android/app/build.gradle` (signing config), nouveau doc release
**Dépend de** : aucune
**Estimation** : `L`
**Risques** : keystore perdu = impossibilité de pousser une mise à jour sur le Play Store (même signature requise) — sauvegarder hors-CI
**Notes** : commencer par génération APK debug pour valider la pipeline, puis ajouter signing

### TASK-18-004 — iOS build pipeline (validation manuelle) [P3] [TODO]
**Contexte** : `04-modules/18-mobile-shell.md` mentionne iOS comme cible secondaire. Aucun build iOS n'a été tenté à ce jour selon `CURRENT_STATE.md`.
**Critère d'acceptation** :
- [ ] `npx cap add ios` exécuté, projet Xcode généré et committé
- [ ] Splash + StatusBar configurés (couleurs alignées Luxe Dark)
- [ ] Build manuel sur Xcode validé sur simulateur iPhone 15
- [ ] Doc `docs/v2-reference/10-deployment-ops/mobile-ios-build.md` (étapes Xcode, certificats Apple Developer)
- [ ] Pas d'engagement sur soumission App Store dans cette tâche
**Fichiers concernés** : `ios/` (généré), `capacitor.config.ts`, doc déploiement
**Dépend de** : TASK-18-002 (haptique/network doivent fonctionner)
**Estimation** : `L`
**Risques** : nécessite macOS + compte Apple Developer ($99/an) ; reporter si hardware indisponible
**Notes** : low priority — focus Android d'abord

### TASK-18-005 — Performance cold start Android (mesure + budget) [P2] [TODO]
**Contexte** : `docs/audit/08-operations-lan-audit.md` §5.4 ne mesure pas le cold start Android. Bundle critical path estimé > 1 MB ; sur Lombok (4G inégal) le cold start peut dépasser 5 s.
**Critère d'acceptation** :
- [ ] Mesure baseline : temps entre tap icône APK et premier paint utile (`MobileLoginPage` ready)
- [ ] Budget cible : < 3 s sur device moyen gamme (Redmi Note 10 ou équivalent)
- [ ] Si dépassement : analyse bundle (`vite-bundle-visualizer`), lazy import additionnels sur la route `/mobile/*`
- [ ] Splash duration ajusté à `launchShowDuration` réel (pas plus que le temps de boot JS)
**Fichiers concernés** : `src/routes/mobileRoutes.tsx`, `vite.config.ts` (chunks), `capacitor.config.ts`
**Dépend de** : TASK-18-003 (besoin d'APK reproductible pour mesurer)
**Estimation** : `M`
**Risques** : optimisations vite peuvent casser le HMR dev — séparer config prod
**Notes** : mesurer avec Android Studio Profiler, pas Chrome DevTools

### TASK-18-006 — Push notifications (orders ready, low-stock) [P3] [TODO]
**Contexte** : `docs/audit/08-operations-lan-audit.md` §3.2 P2 FINDING — *"No push notifications."* Use case : alerte "Commande #1234 prête" pour serveur sur téléphone éloigné.
**Critère d'acceptation** :
- [ ] Plugin `@capacitor/push-notifications` ajouté
- [ ] Backend Edge Function `send-push-notification` (FCM) créée avec auth + permission check
- [ ] Trigger côté serveur : nouveau row dans `orders` avec `status='ready'` envoie push aux devices mobiles enregistrés
- [ ] Table `mobile_push_tokens (user_id, device_id, fcm_token, platform, created_at)` + RLS
- [ ] Toggle utilisateur dans `ProfilePage` pour opt-in/out
**Fichiers concernés** : `supabase/migrations/<date>_create_mobile_push_tokens.sql`, `supabase/functions/send-push-notification/`, `src/hooks/usePushNotifications.ts`, `src/pages/profile/ProfilePage.tsx`
**Dépend de** : TASK-18-002 (plugin Capacitor pipeline validée)
**Estimation** : `XL`
**Risques** : compte Firebase Cloud Messaging à provisionner ; iOS demande APNs (Apple Push) en plus
**Notes** : décomposer en 3 sous-tâches (DB + Edge Function + UI/Capacitor) avant prise

### TASK-18-007 — Deep linking custom scheme [P3] [TODO]
**Contexte** : `04-modules/18-mobile-shell.md` ne mentionne pas le deep linking. Use case : lien `breakery://orders/123` depuis e-mail/SMS pour ouvrir directement une commande.
**Critère d'acceptation** :
- [ ] Plugin `@capacitor/app` configuré pour `appUrlOpen` listener
- [ ] Schemes déclarés : `breakery://` (Android `intent-filter`, iOS `Info.plist`)
- [ ] Routes supportées : `breakery://orders/:id`, `breakery://customers/:id`
- [ ] Universal links HTTPS (vérification du `assetlinks.json` Vercel) — optionnel pour cette tâche
**Fichiers concernés** : `android/app/src/main/AndroidManifest.xml`, `src/hooks/useCapacitorInit.ts`, route handler dans `src/App.tsx`
**Dépend de** : TASK-18-003
**Estimation** : `M`
**Risques** : conflit avec d'autres apps utilisant un scheme proche
**Notes** : tester avec `adb shell am start -a android.intent.action.VIEW -d "breakery://orders/123"`

### TASK-18-008 — Mobile-first redesign pages /mobile/* [P2] [TODO]
**Contexte** : `docs/audit/ux-gap-analysis-2026-05-01.md` ne couvre pas le module mobile en V3 ; `docs/audit/05-uiux-design-audit.md` §Mobile note "Solid" mais "minimal native UX". `04-modules/18-mobile-shell.md` "Pitfalls" : keyboard overlap iOS, sticky hover sur tap.
**Critère d'acceptation** :
- [ ] Toutes les pages `/mobile/*` ont skeletons (pas de spinner générique)
- [ ] États vides avec illustration + CTA (pattern aligné `EmptyState` à créer dans `22-design-system`)
- [ ] Hover transforms wrappés dans `@media (hover: hover)` (cf. P3 audit UI/UX)
- [ ] `scroll-padding-bottom` sur `MobileCartPage` pour éviter overlap clavier iOS
- [ ] Animations respectent `prefers-reduced-motion`
**Fichiers concernés** : `src/pages/mobile/*.tsx`, `src/components/mobile/MobileLayout.tsx`, design tokens
**Dépend de** : TASK-22-005 (EmptyState component)
**Estimation** : `M`
**Risques** : régression desktop si on partage des composants — tester les deux surfaces
**Notes** : aligner avec la roadmap V3 mobile (epic à venir)

### TASK-18-009 — Capacitor 7 → 8 upgrade [P3] [TODO]
**Contexte** : `CLAUDE.md` mentionne "Capacitor 7.5". Capacitor 8 est sorti fin 2025 (suivi standard semestriel). Pas urgent mais à planifier dans les 6 mois.
**Critère d'acceptation** :
- [ ] `package.json` upgrade `@capacitor/core`, `@capacitor/cli`, plugins majors → v8
- [ ] Lecture du migration guide officiel (breaking changes Android API level, Gradle, AndroidX)
- [ ] Build APK testé sur Android 10, 13, 14 (couverture min Lombok)
- [ ] iOS build (si TASK-18-004 fait) testé sur iOS 16, 17
- [ ] Regression testing complet sur les 5 pages `/mobile/*`
**Fichiers concernés** : `package.json`, `android/build.gradle`, `android/app/build.gradle`, `capacitor.config.ts`
**Dépend de** : TASK-18-005 (baseline performance pour comparer)
**Estimation** : `L`
**Risques** : breaking changes plugins tiers (haptics, network) ; vérifier compat avant
**Notes** : faire dans une branche dédiée, ne pas mélanger avec d'autres changements

---

### TASK-18-010 — Camera barcode scanner (mobile inventory) [P3] [TODO]
**Contexte** : `docs/audit/08-operations-lan-audit.md` §3.2 P2 FINDING — *"No native plugin usage beyond SplashScreen/StatusBar/Keyboard. No camera (for barcode scanning)."* Use case : scan rapide des codes barres produit à la réception stock.
**Critère d'acceptation** :
- [ ] Plugin `@capacitor-mlkit/barcode-scanning` ou `@capacitor-community/barcode-scanner` ajouté
- [ ] Bouton scan dans `/mobile/catalog` qui ouvre la caméra et match contre `products.barcode`
- [ ] Permissions caméra demandées proprement (Android `CAMERA`, iOS `NSCameraUsageDescription`)
- [ ] Fallback web (input manuel) si caméra indispo
- [ ] Audit log scan event
**Fichiers concernés** : `src/hooks/useBarcodeScanner.ts`, `src/pages/mobile/MobileCatalogPage.tsx`, manifests Android/iOS
**Dépend de** : TASK-18-002
**Estimation** : `M`
**Risques** : permissions caméra rejetées par utilisateur — UX claire pour réactivation manuelle
**Notes** : utile aussi côté tablet (épaisseur scan barcode produit lors du checkout)

---

## Synthèse priorité

| Priorité | Tâches |
|----------|--------|
| P2 | 18-001, 18-002, 18-003, 18-005, 18-008 |
| P3 | 18-004, 18-006, 18-007, 18-009, 18-010 |

Aucune P0 / P1 — le module est fonctionnel en l'état mais sous-exploité côté natif.
