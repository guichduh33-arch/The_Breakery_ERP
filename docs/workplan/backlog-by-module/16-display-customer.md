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
**Contexte** : Audit Sally P1-5 — couleurs hardcodées dans `CDIdleView.tsx` et `CDActiveCartView.tsx`. Pas d'admin pour personnaliser. Logo The Breakery et palette stables aujourd'hui mais avant un éventuel multi-établissement, doit être config-driven.
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

### TASK-16-002 — Animations & transitions entre états [P2] [TODO]
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
