# Travail — Customer Display

> Last updated: 2026-05-03
> Référence : [docs/reference/04-modules/16-display-customer.md](../04-modules/16-display-customer.md)
> Sources d'audit : `docs/audit/05-uiux-design-audit.md` (CDIdleView / CDActiveCartView P1-5 hardcoded colors), `docs/audit/08-operations-lan-audit.md` (DISPLAY_CART message handling), `docs/audit/ux-gap-analysis-2026-05-01.md` ("Customer Display App MANQUANT en V3 epic-046")

## Objectifs du module

1. **Layouts personnalisables** par établissement (logo, couleurs, slogans) sans toucher au code.
2. **Animations & transitions** entre les états (idle → active cart → payment success → thank-you) fluides et brand-consistent.
3. **Multi-display sync** : 2 écrans physiques en parallèle (un grand mur, un comptoir) qui restent synchronisés via le hub LAN.
4. **Promotion banners rotation** quand le display est idle.
5. **Branding video loop** (loop produit/marque) en idle.

## Tâches

### TASK-16-001 — Layouts customisables (config admin) [P2] [TODO]
**Status note (2026-05-14)** : Partial — Phase 4.C delivered `display_screens` registry (migration `…000160`), token-only `BrandedLayout.tsx` (no hardcoded hex per D-W4-4C-04 verification), pair-device flow, kiosk JWT auth gate, queue ticker. The admin Settings CRUD page for theme/logo/layout-variant and `display_configurations` table are NOT built. The token foundation is in place so the polish belongs in Session 14 Wave 2/3. Visual fidelity work tracked: docs/workplan/plans/2026-05-14-session-14-INDEX.md.
**Contexte** : Audit Sally P1-5 — couleurs hardcodées dans `CDIdleView.tsx` et `CDActiveCartView.tsx`. Pas d'admin pour personnaliser. Justification : permettre au manager de changer logo/palette/layout pour campagnes saisonnières (Ramadan, Noël, événements) sans toucher au code.
**Critère d'acceptation** :
- [ ] Table `display_configurations(id, terminal_id NULLABLE, theme_jsonb, logo_url, layout_variant: 'classic' | 'minimal' | 'video', is_active)`.
- [ ] Page Settings `/settings/customer-display` : preview live + selectors couleurs (BG, accent, text), upload logo, upload background image.
- [ ] `CustomerDisplayPage` lit la config par terminal (fallback global).
- [ ] Plus aucun hex hardcodé dans `CD*.tsx` — tout via tokens ou JSONB config.
- [ ] Hot reload via Realtime channel `display-config:{terminal_id}` (pas besoin de F5 sur l'écran client).
**Fichiers concernés** : migration + RLS, page settings, `src/pages/display/*` refactor, hook `useDisplayConfig`.
**Dépend de** : aucune
**Estimation** : L
**Risques** : régression visuelle si refactor mal fait — screenshots avant/après obligatoires.
**Notes** : C2 audit Sally "69 hardcoded hex" — partie de ce gros nettoyage.

### TASK-16-002 — Animations & transitions entre états [P2] [BLOCKED]
**Status note (2026-05-14)** : Visual fidelity scope reassigned to Session 14 Waves 2-3 (UX completion). Phase 4.C MVP intentionally excluded transitions (D-W4-4C-04); the `BrandedLayout` shell is ready to accept `<DisplayTransition>` wrappers. Tracking: docs/workplan/plans/2026-05-14-session-14-INDEX.md.
**Contexte** : Aujourd'hui changement de vue (idle → cart) = swap brutal. Manque de raffinement pour un customer-facing surface. Audit Sally Loading patterns 8/10 mais transitions absentes.
**Critère d'acceptation** :
- [ ] Composant `<DisplayTransition mode="fade-slide" duration={400}>` wrapper autour de `CDIdleView` / `CDActiveCartView` / `CDPaymentSuccessView` / `CDThankYouView`.
- [ ] Animation fade + slide vertical 20px ; respect `prefers-reduced-motion` (audit Sally A1-2).
- [ ] Cart items in/out : slide-in à l'ajout, fade-out à la suppression (Framer Motion ou CSS keyframes).
- [ ] Total updates : count-up animation (chiffres défilent).
- [ ] Tests visuels : pas de jank > 16ms par frame.
**Fichiers concernés** : `src/pages/display/CustomerDisplayPage.tsx`, composants CD*.
**Dépend de** : `TASK-16-001` (config-driven duration possible).
**Estimation** : M
**Risques** : perf dégradée sur vieux écrans (Raspberry Pi) — fallback `motion-reduce`.
**Notes** : Framer Motion ajoute du bundle ; préférer CSS si possible.

### TASK-16-003 — Multi-display sync via hub LAN [P2] [TODO]
**Status note (2026-05-14)** : Partial — Phase 5.A LAN hub port shipped (`apps/pos/src/features/lan/lanHub.ts`, dedup test in place). Display-side LAN cart mirror (`DISPLAY_CART` handler + multi-screen sync overlay) explicitly deferred per D-W4-4C-04 ("CDActiveCartView lands in Phase 5.A with the LAN port"). The 5.A port itself is partial — no `displaySyncService.ts` re-broadcast layer to display devices. Carry-over.
**Contexte** : Audit Bob `08-operations-lan-audit.md` — hub gère 5/35 message types only. `DISPLAY_CART` n'est pas activement processé par le hub. Si 2 displays connectés, pas garanti qu'ils restent en sync.
**Critère d'acceptation** :
- [ ] Hub écoute `DISPLAY_CART`, `DISPLAY_TOTAL`, `DISPLAY_WELCOME` et re-broadcast à TOUS les `device_type='display'` connectés.
- [ ] Message dedup (Bob P1-1 → cf. global LAN tasks) appliqué pour éviter doublons écran.
- [ ] Heartbeat status visible : un display déconnecté affiche un overlay "Reconnecting…".
- [ ] Test LAN avec 2 displays : ajouter item au POS → 2 displays se mettent à jour < 500ms.
**Fichiers concernés** : `src/services/lan/lanHubMessageHandler.ts`, `src/services/lan/displaySyncService.ts` (nouveau), composant overlay reconnect.
**Dépend de** : tasks LAN globales (dedup, reconnect fix Bob P1-2/P1-3).
**Estimation** : M
**Risques** : si hub down, displays perdent sync — fallback Realtime Supabase (déjà dual-channel).
**Notes** : critique si The Breakery installe écran mur + écran comptoir.

### TASK-16-004 — Promotion banner rotation (idle screen) [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. Per D-W4-4C-04, idle promo rotation explicitly excluded ("display_promotions table doesn't exist in V3 yet"). Carry-over.
**Contexte** : Display idle = brand video uniquement. Manque possibilité d'afficher promos en cours (cohérent avec engine promo TASK-13-*).
**Critère d'acceptation** :
- [ ] Composant `<PromoBanner>` lit les `promotions WHERE is_active AND start_date <= now() AND (end_date IS NULL OR end_date >= now())`.
- [ ] Carrousel auto 5s/promo + transitions fade.
- [ ] Affiche image promo (uploaded) + titre + description courte.
- [ ] Si aucune promo → fallback brand video.
- [ ] Settings `/settings/customer-display` toggle "Show promo banners on idle".
**Fichiers concernés** : `src/pages/display/CDIdleView.tsx`, hook `useActivePromotions`, `promotions` ajout colonne `display_image_url`.
**Dépend de** : `TASK-13-001` (engine promo) et `TASK-16-001` (config display).
**Estimation** : M
**Risques** : trop de promos = surcharge visuelle — limite affichage 5 max.
**Notes** : promo time-based (TASK-13-004) doit être respecté (ne pas afficher Happy Hour à 10h).

### TASK-16-005 — Branding video loop [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No `display-assets` Storage bucket and no `<video>` element in `apps/pos/src/features/display/components/BrandedLayout.tsx`. Carry-over.
**Contexte** : Owner souhaite afficher vidéo marque (production bakery, équipe, plats) en idle. Pas implémenté.
**Critère d'acceptation** :
- [ ] Upload vidéo (.mp4) via settings, stocké Storage `display-assets/branding-{terminal_id}.mp4`.
- [ ] Lecture autoplay loop muted dans `CDIdleView`.
- [ ] Limit taille (max 50 MB) + format checks.
- [ ] Fallback image si vidéo échoue (réseau lent).
- [ ] Cache navigateur agressif (les displays sont online-only mais doivent éviter re-download chaque jour).
**Fichiers concernés** : settings page, `CDIdleView.tsx`, RLS Storage.
**Dépend de** : `TASK-16-001`.
**Estimation** : S
**Risques** : bande passante si vidéo lourde + fréquente — privilégier upload optimisé.
**Notes** : alternative simple = lien YouTube embed, mais dépend du réseau.

---

## Backlog métier (objectif fonctionnel)

> Items issus de `docs/_archive/objectif-travail-v2/CUSTOMER_DISPLAY.md` §13 — vision produit du module.
> Ajoutés 2026-05-13 lors de la cascade docs (session 13). La vidéo en idle est déjà couverte par TASK-16-005.

### TASK-16-006 — QR de paiement digital affiché [P2] [BLOCKED]
**Status note (2026-05-14)** : Depends on TASK-03-005 (QRIS provider integration) which is BLOCKED. No PAYMENT_QR_DISPLAY LAN message type or QR component. Carry-over to whenever Xendit/Midtrans adapter lands.
**Contexte** : pour QRIS / e-wallets, le client doit scanner un QR depuis sa propre application — aujourd'hui le caissier doit lui passer un imprimé ou un QR sur son téléphone à lui. Pas pratique, pas hygiénique.
**Bénéfice attendu** : afficher directement sur le Customer Display le QR de paiement généré au moment de la finalisation → le client scanne sans contact avec le staff.
**Critère d'acceptation** :
- [ ] Message LAN `PAYMENT_QR_DISPLAY` envoyé par le POS au display avec payload {qr_data, amount, expires_at}.
- [ ] `CDActiveCartView` affiche le QR en grand pendant la phase paiement.
- [ ] Auto-refresh quand le QR expire (typique QRIS = 60s).
- [ ] Bascule "Order Confirmed" dès que le paiement est validé côté POS.
**Dépend de** : intégration QRIS provider (BCA, Mandiri, OVO…) côté POS.
**Estimation** : M
**Risques** : sécurité — vérifier que le QR affiché correspond bien à la commande en cours (anti-substitution).
**Notes** : V1 QRIS dynamique ; V2 NFC + tap-to-pay.

### TASK-16-007 — Affichage "commande prête" enrichi (style aéroport) [P2] [TODO]
**Status note (2026-05-14)** : Partial — Phase 4.C ships `OrderQueueTicker.tsx` (5 most recent orders with status pills) + `CurrentOrderCard.tsx` (top-of-queue hero). The full `CDReadyBoardView` alternative idle layout with slide-in animation + auto-retrait timer is undone. Carry-over for the "airport board" polish.
**Contexte** : aujourd'hui `ORDER_READY` affiche juste un numéro. Pour les clients en salle ou take-away avec attente, un affichage type "tableau d'aéroport" (multi-commandes simultanées) serait plus lisible.
**Bénéfice attendu** : un panneau "Commandes prêtes" en grand qui scale au volume sans crieur staff.
**Critère d'acceptation** :
- [ ] Nouvelle vue `CDReadyBoardView` (alternative à `CDIdleView` activable par config).
- [ ] Liste des commandes `ready` non encore retirées avec : numéro, nom client (si lié), table (si dine-in), heure prêt.
- [ ] Animation : nouvelle commande slide-in + son optionnel.
- [ ] Auto-retrait après N minutes (configurable, défaut 5min).
**Dépend de** : `TASK-16-001` (layout customisable).
**Estimation** : M
**Risques** : si beaucoup de commandes simultanées, lisibilité dégradée — limiter à 8 visibles + scroll.
**Notes** : option d'affichage : seulement dernier numéro vs board complet.

### TASK-16-008 — Animations programme fidélité [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone — depends on TASK-16-003 (LAN cart mirror w/ `points_earned` propagation) which is partial. Carry-over.
**Contexte** : aujourd'hui le gain de points est affiché en texte simple. Pour valoriser le programme et inciter, animation visuelle marquante au moment du gain.
**Bénéfice attendu** : "Vous gagnez 45 points pour atteindre Silver dans 200 points !" en animation joyeuse → client réalise la valeur, programme paraît plus attractif.
**Critère d'acceptation** :
- [ ] Animation déclenchée au `CART_UPDATE` quand `points_earned > 0`.
- [ ] Affichage des points gagnés + jauge palier (progression vers tier suivant).
- [ ] Animation de bonus si palier atteint à cette commande.
- [ ] Toggleable dans Settings (`show_loyalty_animation`).
**Dépend de** : aucune.
**Estimation** : M
**Risques** : trop "casino" → ton sobre, palette signature The Breakery.
**Notes** : se référer aux principes du design system (luxe-dark + or `#C9A55C`).

### TASK-16-009 — Multilingue affichage [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. No i18n integration on display surface; CLAUDE.md confirms "i18n suspended" repo-wide. Carry-over.
**Contexte** : aujourd'hui français uniquement. Pour une clientèle touristique (Bali), passer en EN / ID dynamiquement améliore l'expérience.
**Bénéfice attendu** : bascule auto FR / EN / ID selon préférence shop ou horaires (touristes au déjeuner = EN, locaux au matin = ID).
**Critère d'acceptation** :
- [ ] Setting `display.languages` + `display.default_language`.
- [ ] Toutes les chaînes affichées passent par un dictionnaire i18n (`fr.json`, `en.json`, `id.json`).
- [ ] Toggle config "Auto-language by time slot" (matin = ID, midi = EN, soir = FR par ex.).
- [ ] Promos `display_promotions` ont des champs `title_en`, `title_id`, etc.
**Dépend de** : refactor i18n côté display (utiliser `react-i18next` déjà en dep si existant).
**Estimation** : L
**Risques** : maintenance des traductions — outil de traduction collaborative.
**Notes** : commencer par 2 langues (FR+EN) ; ID en V2.

### TASK-16-010 — Météo et heure [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. Not in Session 13 scope; low-priority polish item.
**Contexte** : ajouter un détail discret en idle pour rendre l'écran "vivant" sans être distrayant.
**Bénéfice attendu** : indication heure + météo locale → l'écran paraît actif même quand promos en rotation.
**Critère d'acceptation** :
- [ ] Widget discret coin idle screen avec heure (HH:mm) + météo (icône + température).
- [ ] Source météo : API publique (OpenWeather ou équivalent free tier).
- [ ] Cache 15 min côté display pour pas spammer l'API.
- [ ] Toggle Settings.
**Dépend de** : connexion internet du display (LAN seulement = fallback heure seule).
**Estimation** : S
**Risques** : météo offline si pas internet — fallback gracieux.
**Notes** : pour Bali, mettre la météo de la ville la plus proche du shop.

### TASK-16-011 — Compteur de visiteurs [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone. Not in Session 13 scope.
**Contexte** : gamification douce — "Notre 10 000ᵉ client cette année !" en idle.
**Bénéfice attendu** : engagement client + valorisation business "ça tourne".
**Critère d'acceptation** :
- [ ] Compteur `total_orders_ytd` depuis Reports, affiché en idle.
- [ ] Animation quand un palier rond est atteint (10k, 50k, 100k).
- [ ] Toggle Settings.
**Dépend de** : aucune.
**Estimation** : S
**Risques** : si compteur bas (boutique récente), effet inverse → ne pas afficher si < seuil.
**Notes** : palettes : 10000, 25000, 50000, 100000.

### TASK-16-012 — A/B testing visuel des promos [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone — depends on TASK-16-004 (promo banners) which is itself undone. Carry-over.
**Contexte** : aucun moyen de mesurer quelle variante visuelle d'une promo génère plus de ventes.
**Bénéfice attendu** : tester deux variantes d'affichage d'une promo et mesurer l'impact ventes correspondantes.
**Critère d'acceptation** :
- [ ] Table `display_promotion_variants` (parent_promo_id, variant_label, image_url, title).
- [ ] Rotation alternée des variantes (50/50 ou pondérée).
- [ ] Lien promo affichée → ventes : track via cookie / session timestamp pour corrélation.
- [ ] Report "Promo variant performance" : conversion par variante.
**Dépend de** : `TASK-14-XXX` (Reports analytics).
**Estimation** : L
**Risques** : attribution causale fragile (pas tout est lié au display) — méthodo claire.
**Notes** : V1 expérimental sur 1-2 promos premium ; généraliser ensuite.

### TASK-16-013 — Mode "vitrine externe" [P3] [TODO]
**Status note (2026-05-14)** : Genuinely undone — depends on TASK-16-001 (config admin) which is partial. Carry-over.
**Contexte** : un écran placé en vitrine (visible depuis la rue) ne devrait jamais montrer le cart d'un client en cours d'encaissement (vie privée + sécurité).
**Bénéfice attendu** : mode dédié vitrine qui ignore les `CART_UPDATE` et affiche en permanence les promos en grand.
**Critère d'acceptation** :
- [ ] Setting `display.mode` = `customer | window` par display.
- [ ] Mode `window` : skip tous les `CART_UPDATE` + `ORDER_READY`, plein écran promos.
- [ ] Layout plus large + texte plus grand (visible depuis la rue).
- [ ] Tournoyance plus lente (15-30s).
**Dépend de** : `TASK-16-001` (layouts customisables).
**Estimation** : S
**Risques** : confusion config si un staff change le mode par erreur — verrou par PIN.
**Notes** : utile pour les boutiques à grande façade vitrée.

## Vue transversale

### Dépendances inter-tâches

```
TASK-16-001 (config admin) ← prérequis tout le reste
    ↓
TASK-16-002 (transitions) ← peut être en parallèle
TASK-16-003 (multi-display sync) ← dépend tasks LAN globales
TASK-16-004 (promo banner) → dépend TASK-13-001 (engine promo)
TASK-16-005 (branding video) → indépendant — quick win
```

### Métriques de succès

| Métrique | Baseline 2026-04 | Cible Q3 2026 |
|---|---|---|
| Couleurs hardcoded display | nombreuses | 0 (TASK-16-001) |
| Multi-display sync latency | non testé | < 500ms (TASK-16-003) |
| Branding personnalisable owner | non | oui (TASK-16-001 + 16-005) |

### Pitfalls connus

- Display est un client LAN passif → si hub down, écran fige (cf. audit Bob — fallback Realtime activable).
- `prefers-reduced-motion` doit être respecté (audit Sally A1-2) sur TASK-16-002.
- Cache navigateur agressif video (TASK-16-005) : invalidation par hash URL nécessaire.

### Risques transversaux

- **Régression UX** : si CD* refactor casse l'affichage live, impact direct expérience client en magasin.
- **Performance vieux écrans** : Raspberry Pi / Android cheap → tester perf transitions.
- **Coordination hub** : TASK-16-003 dépend que les tasks LAN globales (dedup, reconnect) soient faites — sinon multi-display restera fragile.

### Couverture audits

| Tâche | Source audit | Section |
|---|---|---|
| TASK-16-001 | 05-uiux-design-audit.md | P1-5 hardcoded colors CDIdleView/CDActiveCartView |
| TASK-16-002 | 05-uiux-design-audit.md | A1-2 motion-reduce |
| TASK-16-003 | 08-operations-lan-audit.md | DISPLAY_CART non processé hub |
| TASK-16-004 | besoin marketing | — |
| TASK-16-005 | besoin owner | — |

### Fichiers V2 à connaître avant intervention

| Fichier | Rôle |
|---|---|
| `src/pages/display/CustomerDisplayPage.tsx` | Container principal (route `/display`) |
| `src/pages/display/CDIdleView.tsx` | Vue idle (logo + animations) — couleurs hardcoded à corriger |
| `src/pages/display/CDActiveCartView.tsx` | Vue panier en cours — affiche items + total |
| `src/pages/display/CDPaymentSuccessView.tsx` | Vue confirmation paiement |
| `src/pages/display/CDThankYouView.tsx` | Vue merci (3s puis retour idle) |
| `src/services/lan/displayBroadcast.ts` | Service envoi messages depuis POS |
| `src/hooks/useDisplayBroadcast.ts` | Hook côté POS qui pousse l'état panier |
| `src/services/lan/lanProtocol.ts` | DISPLAY_CART, DISPLAY_TOTAL, DISPLAY_WELCOME, DISPLAY_ORDER_READY message types |

### Stratégie de roll-out recommandée

1. **Sprint S+1** : TASK-16-001 (config admin) — base nécessaire pour tout le reste, atomic et faible risque.
2. **Sprint S+2** : TASK-16-002 (transitions) + TASK-16-005 (branding video) en parallèle — peu de risque.
3. **Sprint S+3** : TASK-16-003 (multi-display sync) une fois les tasks LAN globales (Bob audit) terminées.
4. **Sprint S+4** : TASK-16-004 (promo banner) si TASK-13-001 (engine promo) livré.
