# Travail — Design System ("Luxe Dark")

> Last updated: 2026-05-03
> Référence : [`../02-design-system/`](../02-design-system/) (`01-luxe-dark-overview.md`, `02-tokens.md`, `03-shadcn-primitives.md`, `04-feature-components.md`, `05-layouts.md`, `06-iconography-illustrations.md`)
> Sources audit : `docs/audit/05-uiux-design-audit.md` (full), `docs/audit/ux-gap-analysis-2026-05-01.md` §Découvertes transversales / Composants à inclure, `docs/audit/00-executive-summary.md` §UI/UX

## Objectifs du module

1. Forcer la conformité tokens (purger les hex hardcodés et les utilitaires Tailwind couleur natives `text-slate-*`/`bg-gray-*`) — cible : 354 → < 30 occurrences hardcodées (audit C1/C2).
2. Atteindre WCAG 2.2 AA sur les surfaces critiques (POS, KDS, /reports) — cible : 0 finding A0/A1 audit UI/UX restant.
3. Compléter la palette de composants manquants identifiés en gap V2/V3 (KPI card, progress bar, combo card, floor plan token, split wizard) — cible : 6 composants ajoutés à `components/ui/` ou `components/feature/`.
4. Harmoniser loading / empty / error states — cible : 100 % des pages utilisent les patterns `Skeleton*`, `EmptyState`, `ErrorState`.
5. Documenter les guidelines animations (motion-reduce) et exposer un dark mode toggle (P3 user setting).

---

## Tâches

### TASK-22-001 — Purger hex hardcodés + classes Tailwind hors tokens [P1] [TODO]
**Status note (2026-05-14)** : Partial / still applicable, scheduled Session 14+. V3 evidence: tokens exist in `packages/ui/src/tokens/{colors,semantic,luxe-dark,payment}.css` and Phase 1.D commit `a9bb4ac` purged 5 hardcoded literals (TransferStatusBadge, IncomingStockForm, OrderDetailDrawer). Session 14 Phase 1.A continues this work (`docs/Design/` is now source of truth, "zero hardcoded color" is D1 decision). Codemod sweep across all 30+ files not yet complete.
**Contexte** : `docs/audit/05-uiux-design-audit.md` §C1/C2 — *"354 hardcoded Tailwind color classes (`text-slate-*`, `bg-gray-*`, `text-zinc-*`) across 30+ files bypass the token system. 69 hardcoded hex values in component files."* Top offenders : `KDSHeader.tsx`, `DashboardPage.tsx` (`PAYMENT_COLORS`), `CashierAnalyticsModal.tsx`, `CategoryFormModal.tsx`, `PaymentModal.tsx` (emerald/violet/amber).
**Critère d'acceptation** :
- [ ] Codemod ou recherche/remplace : `text-slate-X` / `bg-gray-X` → tokens (`text-content-secondary`, `bg-surface-2`)
- [ ] Hex `#C9A55C` → `bg-gold` ou `var(--gold)` selon contexte
- [ ] Couleurs Payment (`bg-emerald-600`, `bg-violet-500`, `bg-amber-500`) → tokens semantic ou créer tokens dédiés `--payment-cash`, `--payment-card`, etc.
- [ ] Eslint rule custom optionnelle `no-tailwind-color-utilities` pour empêcher régression
- [ ] Verif : `grep -rE "(text|bg|border)-(slate|gray|zinc|emerald|violet|amber)-" src/` retourne < 30 occurrences (justifiables)
**Fichiers concernés** : 30+ composants identifiés audit ; priorité KDSHeader, DashboardPage, PaymentModal
**Dépend de** : aucune
**Estimation** : `L`
**Risques** : régression visuelle sur surface critique — diff visuel avec Percy ou screenshots avant/après
**Notes** : faire par batch (5-10 fichiers/PR) pour faciliter review

### TASK-22-002 — Composant `EmptyState` réutilisable [P1] [DONE]
**Status note (2026-05-14)** : Delivered in Session 13 Phase 1.D. V3 evidence: `packages/ui/src/primitives/EmptyState.tsx` exists with `__tests__/EmptyState.test.tsx`; Session 14 Phase 1.A shipped EmptyState v2 (commit `1b46559`). 10-page migration is ongoing under Session 14 design polish, but the primitive itself is done. Commit `bdf21aa`.
**Contexte** : `docs/audit/05-uiux-design-audit.md` §L2 + Recommandations §13 — *"Empty state pattern is inconsistent. Cart has icon + label + helper. ProductGrid has icon + text + CTA. But many back-office pages simply show 'No data found' text without illustration or CTA."*
**Critère d'acceptation** :
- [ ] `src/components/ui/EmptyState.tsx` avec props : `icon` (Lucide), `title`, `description`, `actionLabel?`, `onAction?`, `illustration?`
- [ ] Variantes : `default`, `error`, `success`
- [ ] Storybook ou page demo `/_dev/components` avec exemples
- [ ] Migration de 10 pages back-office prioritaires vers EmptyState (DashboardPage, /reports/* sans data, /customers vide, /products vide, /orders vide)
- [ ] aria-live="polite" + role="status" pour screen readers
**Fichiers concernés** : `src/components/ui/EmptyState.tsx`, 10 pages migrations
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : interférer avec `ErrorBoundary` qui fait son propre rendu
**Notes** : pattern aligné avec celui de POS Cart empty state qui est correct

### TASK-22-003 — Harmoniser loading states (Skeleton partout) [P2] [TODO]
**Status note (2026-05-14)** : Still applicable, scheduled Session 14+. V3 evidence: no `Skeleton*` primitive in `packages/ui/src/primitives/` (only Dialog/EmptyState/Sheet/Button/Input/Toast/Card/Badge/ScrollArea/Separator/Tabs); no `<ScreenSkeleton />` exists. Session 13 did not scope this; Session 14 Wave 1 may add it.
**Contexte** : `docs/audit/05-uiux-design-audit.md` §L1 — *"Inconsistent loading patterns. Some pages use Skeleton components (dashboard, accounting), others use animate-pulse on plain divs (ProductGrid, CategoryNav), and a few use simple text ('Loading...' in PaymentModal Suspense fallback). Should standardize on Skeleton everywhere."*
**Critère d'acceptation** :
- [ ] `animate-pulse` brut remplacé par `<Skeleton variant="..." />` sur tous les fichiers identifiés
- [ ] Suspense fallback pour PaymentModal et autres lazy → composant `<ScreenSkeleton />` plutôt que texte "Loading..."
- [ ] Audit : `grep "animate-pulse" src/` retourne < 5 occurrences (cas légitimes ex shimmer custom)
- [ ] Skeletons cohérents avec contenu (taille, forme)
**Fichiers concernés** : `src/components/pos/ProductGrid.tsx`, `src/components/pos/CategoryNav.tsx`, plusieurs pages reports
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : régression visuelle si Skeleton mal dimensionné — préférer purpose-built skeletons (`SkeletonCard`, `SkeletonTableRow`) déjà dispo
**Notes** : —

### TASK-22-004 — A11y : remplacer `<div onClick>` par `<button>` [P1] [TODO]
**Status note (2026-05-14)** : Partial / still applicable, scheduled Session 14+. V3 evidence: Phase 1.D commit `a9bb4ac` made a motion-reduce + a11y sweep on Dialog/Button/FullScreenModal and migrated drawer components, but no broad `<div onClick>` → `<button>` codemod ran across `apps/{pos,backoffice}/src`; `CartItemRow.tsx` (the V2 example) does not exist with that name in V3.
**Contexte** : `docs/audit/05-uiux-design-audit.md` §A0-1 — *"43 div/span with onClick handlers across 28 files without role='button', tabIndex, or keyboard event handlers. Examples: CartItemRow wraps items in a clickable div without keyboard support."*
**Critère d'acceptation** :
- [ ] 43 occurrences identifiées migrées vers `<button>` natif OU `<div role="button" tabIndex={0} onKeyDown={enterOrSpace}>`
- [ ] Tests E2E ou unit : navigation clavier (Tab + Enter) fonctionne sur ces éléments
- [ ] ESLint rule `jsx-a11y/click-events-have-key-events` activée pour empêcher régression
- [ ] CartItemRow en priorité (chemin POS principal)
**Fichiers concernés** : ~28 fichiers identifiés audit, prioritaires : `CartItemRow.tsx`, modal backdrops
**Dépend de** : aucune
**Estimation** : `L`
**Risques** : changement structure DOM peut casser styling — vérifier focus rings
**Notes** : codemod possible pour 80 % des cas, manuel pour complexes

### TASK-22-005 — Skip-to-content sur POS [P1] [DONE]
**Status note (2026-05-14)** : Delivered in Session 13 Phase 1.D. V3 evidence: `packages/ui/src/components/SkipToContent.tsx` + `__tests__/SkipToContent.test.tsx` exist; rendered as first child in both `apps/pos/src/App.tsx` and `apps/backoffice/src/App.tsx`; `id="main-content"` anchors live in `Pos.tsx`, `Kds.tsx`, `BackofficeLayout.tsx`. Commit `bdf21aa`.
**Contexte** : `docs/audit/05-uiux-design-audit.md` §A0-2 — *"No skip-to-content link on POS. Only the BackOfficeLayout has one. POS is the primary surface used ~200 tx/day."*
**Critère d'acceptation** :
- [ ] `<a href="#pos-main" className="sr-only focus:not-sr-only ...">Skip to products</a>` ajouté dans `POSTerminalWrapper.tsx`
- [ ] Cible `#pos-main` présente sur ProductGrid container
- [ ] Tests : Tab → focus skip link visible, Enter saute au grid produits
**Fichiers concernés** : `src/components/pos/POSTerminalWrapper.tsx`, `src/components/pos/ProductGrid.tsx`
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : aucun
**Notes** : 5 min de travail, gain a11y immédiat

### TASK-22-006 — Modal focus trap + Escape (Radix Dialog migration) [P1] [DONE]
**Status note (2026-05-14)** : Delivered in Session 13 Phases 1.D + 4.D. V3 evidence: `packages/ui/src/primitives/Dialog.tsx` (Radix wrapper with focus-trap/Escape) + `Sheet.tsx` exist; per Phase 1.D commit message "V3 found 34 modal sites, 33/34 already Radix Dialog" so batch 1 was re-sized 24→10; Phase 4.D commits `33d310d`, `1f524a6`, `75d6c37` migrated 7 BO ad-hoc modals (opname/production/sections/purchasing) to the primitive. V2's 72-modal backlog is V3-obsolete (V3 was built on Radix from inception). Commit `bdf21aa`.
**Contexte** : `docs/audit/05-uiux-design-audit.md` §A1-3 + §U1 — *"PaymentModal listens for Escape (good) but does not trap focus. PinVerificationModal, TableSelectionModal, DiscountModal lack Escape entirely. Use Radix Dialog (already a dependency via shadcn)."* + audit exec summary mentionne *"Dialog shadcn inutilisé (72+ modals custom)"*.
**Critère d'acceptation** :
- [ ] Audit : lister les 72+ modales custom identifiées
- [ ] Migration prioritaire (10 modales critiques) vers shadcn `<Dialog>` ou `<Sheet>` qui gèrent focus trap, Escape, aria-* automatiquement
- [ ] Tests : Tab dans modal reste dans modal, Esc ferme, focus revient au trigger
- [ ] Backlog des 60+ restantes documenté (`docs/reference/travail/22-design-system-modal-migration.md`)
**Fichiers concernés** : modales `PaymentModal`, `PinVerificationModal`, `TableSelectionModal`, `DiscountModal`, `SplitByItemModal`, `ModifierModal`, `CategoryFormModal`, etc.
**Dépend de** : aucune
**Estimation** : `XL` (XL pour 10, le total 72+ ferait plusieurs sprints)
**Risques** : régression UX : Radix peut changer comportement (animation, backdrop click) — A/B avant déploiement
**Notes** : décomposer en sous-tâches `M` par batch de 3-4 modales

### TASK-22-007 — Améliorer contrast `--text-muted` [P1] [TODO]
**Status note (2026-05-14)** : Uncertain — manual review needed. V3 evidence: `packages/ui/src/tokens/luxe-dark.css` line 16 sets `--text-muted: #6b6b73`, which is close to the V2 `#6E6E78` value flagged in audit — contrast against `--surface-0` should be re-tested (axe DevTools) before deciding. No Session 13 phase touched this token; Session 14 Phase 1.A is the right venue.
**Contexte** : `docs/audit/05-uiux-design-audit.md` §A1-4 — *"text-content-muted maps to #6E6E78 on --surface-0 (#0C0C0E) = ~3.8:1 contrast ratio, below 4.5:1 AA minimum for normal text. Used extensively for labels and metadata."*
**Critère d'acceptation** :
- [ ] `--text-muted` dans `theme-pos` passé de `#6E6E78` à `#8A8A94` (ou valeur testée à 4.5:1+)
- [ ] Vérification équivalente sur `theme-backoffice` (light)
- [ ] Vérif outil : axe DevTools sur 10 pages → 0 erreur "color-contrast" pour text-muted
- [ ] Régression visuelle : screens avant/après pour validation manuelle
**Fichiers concernés** : `src/styles/theme.css` ou `src/index.css` (CSS variables)
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : muted devient moins "discret" visuellement — compromis a11y vs hierarchy
**Notes** : —

### TASK-22-008 — Composants UI manquants : KPI card + Progress bar [P2] [TODO]
**Status note (2026-05-14)** : Partial / still applicable. V3 evidence: `packages/ui/src/components/KpiTile.tsx` + `__tests__/KpiTile.test.tsx` exist (satisfies KPI card half). `ProgressBar` primitive is NOT present (grep returns 0 matches in `packages/ui`). Migration of Dashboard/reports to consume KpiTile is also incomplete. Keep TODO until ProgressBar lands.
**Contexte** : `docs/audit/ux-gap-analysis-2026-05-01.md` §Composants UI à inclure dans tokens/UI package — *"KPI cards (icon + label + value + indicator), Progress bars, Modifier groups, Combo cards, Floor plan tables, Split bill multi-step wizard"* listés comme manquants.
**Critère d'acceptation** :
- [ ] `src/components/ui/KPICard.tsx` : props `icon`, `label`, `value`, `trend?`, `trendLabel?`, `variant`
- [ ] `src/components/ui/ProgressBar.tsx` : props `value`, `max`, `variant` (gold, success, warning, danger)
- [ ] Page demo `/_dev/components` (ou Storybook) montre les 2
- [ ] Migrations : Dashboard et /reports utilisent KPICard (purger custom KPI inline)
- [ ] Documentation dans `02-design-system/03-shadcn-primitives.md` ou `04-feature-components.md`
**Fichiers concernés** : `src/components/ui/KPICard.tsx`, `src/components/ui/ProgressBar.tsx`, migrations
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : duplication si KPI card existait déjà non-documenté — chercher d'abord
**Notes** : —

### TASK-22-009 — Animations + `motion-reduce` partout [P2] [TODO]
**Status note (2026-05-14)** : Partial / still applicable, scheduled Session 14+. V3 evidence: `packages/ui/src/tokens/motion.css` defines `fast/base/slow` durations with `prefers-reduced-motion` overrides; Phase 1.D commit `a9bb4ac` did a motion-reduce sweep on Dialog/Button/FullScreenModal/Sheet (7 packages/ui files). Broader sweep across `apps/{pos,backoffice}/src` animated components not yet complete.
**Contexte** : `docs/audit/05-uiux-design-audit.md` §A1-2 — *"Only 7 files respect prefers-reduced-motion via motion-reduce:. KDS has good coverage but many animations (sidebar fade-in, pulse, shimmer skeletons) run regardless of user preference."*
**Critère d'acceptation** :
- [ ] Audit : grep `transition-` `animate-` `transform` → ajouter `motion-reduce:transition-none` ou `motion-reduce:animate-none` partout
- [ ] CSS keyframes (shimmer skeleton) wrappé dans `@media (prefers-reduced-motion: no-preference)`
- [ ] Tests : Settings macOS "Reduce motion" → Sonner toasts, sidebar, skeleton n'animent pas
- [ ] Doc : guidelines animations dans `02-design-system/` (durée, easing, motion-reduce systématique)
**Fichiers concernés** : `src/index.css`, multiples composants animés
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : aucun
**Notes** : —

### TASK-22-010 — Aria-live regions pour feedback temps réel [P2] [TODO]
**Status note (2026-05-14)** : Partial / still applicable, scheduled Session 14+. V3 evidence: `EmptyState.tsx`, `NumpadVirtual.tsx`, `PromotionForm.tsx`, `RedeemPointsModal.tsx`, `DiscountModal.tsx` use `role="status"`/`aria-live`, but `CartTotals`/`PaymentModal`/`KDSOrderCard` (the audit targets) don't yet announce changes. No dedicated NVDA/VoiceOver test pass logged Session 13.
**Contexte** : `docs/audit/05-uiux-design-audit.md` §A2-2 — *"No aria-live regions for dynamic content. Cart total updates, payment progress, KDS order state changes have no aria-live announcements. Empty cart state correctly uses role='status' aria-live='polite' but pattern not repeated elsewhere."*
**Critère d'acceptation** :
- [ ] CartTotals annonce changement total ("Total: Rp 125,000")
- [ ] PaymentModal annonce progression split payment ("Step 2 of 3, paid Rp 50,000 of Rp 125,000")
- [ ] KDS annonce nouvelle commande ("New order #123, station Hot")
- [ ] Tests avec NVDA / VoiceOver
**Fichiers concernés** : `src/components/pos/CartTotals.tsx`, `src/components/pos/modals/PaymentModal.tsx`, `src/components/kds/KDSOrderCard.tsx`
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : sur-annoncer = bruit screen reader → polite + dédup sur valeurs identiques
**Notes** : —

### TASK-22-011 — Dark mode toggle (exposition utilisateur) [P3] [OBSOLETE]
**Status note (2026-05-14)** : V3 architecture supersedes this. POS is single-theme dark by D-Spec (kiosk bakery), and BO is single-theme light. Session 14 spec D2-D4 reaffirm POS dark / BO light split as fixed. `coreSettingsStore` from V2 doesn't exist in V3 split. No user-facing toggle is a product decision.
**Contexte** : `docs/audit/ux-gap-analysis-2026-05-01.md` §Découvertes transversales — *"Dark theme toggle — pas de toggle, dark = unique mode CaissApp"*. Architecture dual-theme déjà présente (`.theme-pos` dark / `.theme-backoffice` light) mais pas exposée à l'utilisateur en BO.
**Critère d'acceptation** :
- [ ] Toggle dans `/profile` : "Theme: System / Light / Dark"
- [ ] Préférence persistée via `coreSettingsStore` (already exists)
- [ ] Initialisation : respecte préférence user > system pref > default light
- [ ] Documentation use case dans `02-design-system/01-luxe-dark-overview.md`
**Fichiers concernés** : `src/pages/profile/ProfilePage.tsx`, `src/stores/settings/coreSettingsStore.ts`, `src/layouts/BackOfficeLayout.tsx`
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : audit UI/UX note theme-backoffice "less attention to colors" — corriger d'abord les hardcoded (TASK-22-001)
**Notes** : POS reste dark forcé (kiosk bakery sombre)

### TASK-22-012 — Hover guard `@media (hover: hover)` [P3] [TODO]
**Status note (2026-05-14)** : Still applicable, scheduled Session 14+. V3 evidence: no `@media (hover: hover)` utility wrapper in `packages/ui/src/tokens/` or `apps/*/src/index.css`. Session 13 did not address this; relevant when Session 14 polishes tablet POS UI per `docs/Design/`.
**Contexte** : `docs/audit/05-uiux-design-audit.md` §POS-3 P3 — *"Product card hover animation (hover:-translate-y-1 hover:shadow-2xl) is elegant on desktop but may cause layout jitter on touch devices where :hover sticks after tap."*
**Critère d'acceptation** :
- [ ] Helper Tailwind ou CSS custom property pour wrapper hover : `@media (hover: hover) { .hover-lift:hover { ... } }`
- [ ] Migration : ProductCard, CategoryNav cards, modals hover effects
- [ ] Tests Android tablette : tap → pas de hover sticky
**Fichiers concernés** : `src/index.css`, composants concernés
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : aucun
**Notes** : —

### TASK-22-013 — Iconographie / illustrations cohérentes [P3] [TODO]
**Status note (2026-05-14)** : Still applicable, scheduled Session 14+. V3 evidence: no `public/illustrations/` directory in `apps/{pos,backoffice}` and `EmptyState.tsx` does not yet support an `illustration` prop. Session 14 spec scopes branded photography (D-Spec 90% fidelity), but illustration set is not part of Session 13 burndown.
**Contexte** : `docs/audit/05-uiux-design-audit.md` §Icon Consistency 9/10 *"All icons are from Lucide — excellent consistency."* Pas de problème icônes. Mais illustrations manquantes pour empty states, onboarding, error pages → opportunité branding.
**Critère d'acceptation** :
- [ ] 5 illustrations SVG branded (vide cart, no orders, no customers, error 500, no internet) hébergées dans `public/illustrations/`
- [ ] Composant `<EmptyState illustration="cart-empty" />` les utilise
- [ ] Style aligné Luxe Dark (gold accent, dark contour)
- [ ] Documentation `02-design-system/06-iconography-illustrations.md` complétée
**Fichiers concernés** : `public/illustrations/*.svg`, doc design
**Dépend de** : TASK-22-002
**Estimation** : `M` (+ design externe si pas en interne)
**Risques** : coût designer si pas in-house
**Notes** : alternative no-cost : illustrations open-source style Notion/unDraw filtrées dark

---

## Synthèse priorité

| Priorité | Tâches |
|----------|--------|
| P1 | 22-001, 22-002, 22-004, 22-005, 22-006, 22-007 |
| P2 | 22-003, 22-008, 22-009, 22-010 |
| P3 | 22-011, 22-012, 22-013 |
