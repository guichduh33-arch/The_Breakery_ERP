# Module 22 — Charte graphique & cohérence visuelle

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 22. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Partiel (fondations solides, finitions en cours)
> **Verdict global de l'analyse :** La doc est fidèle et même prudente — toutes ses revendications « aujourd'hui » sont vérifiées dans le code (bibliothèque partagée, garde-fou anti-modale, ratchet lint, cibles 44 px, emptyState), et sa liste « À venir » correspond bien aux trous réels (couleurs en dur, contrastes, annonces lecteur d'écran).

## A. Ce qui fonctionne réellement (code vérifié)

- **Bibliothèque partagée `@breakery/ui`** : 11 primitives (`packages/ui/src/primitives/` — Badge, Button, Card, Dialog, EmptyState, Input, ScrollArea, Separator, Sheet, Tabs, Toast) + 41 composants métier (`packages/ui/src/components/` — Numpad, PinVerificationModal, DataTable, PromotionForm, etc.). 39 des 41 composants ont un fichier de test co-localisé (`packages/ui/src/components/__tests__/`). [UI câblée]
- **Système de tokens à 2 thèmes** : 9 fichiers CSS de tokens (`packages/ui/src/tokens/` : `luxe-dark.css` (POS sombre/or), `colors.css`, `semantic.css` (intent success/warning/danger/info, `semantic.css:12-24`), `elevation.css`, `motion.css`, `payment.css`, `spacing.css`, `typography.css`, `index.css`). Le thème clair BO `theme-backoffice` est défini dans `colors.css`/`index.css` et appliqué par `apps/backoffice/src/index.css` + `apps/backoffice/src/layouts/BackofficeLayout.tsx`. Exposition Tailwind via `packages/ui/tailwind-preset.ts`. [UI câblée]
- **Cibles tactiles 44 px tokenisées** : `--touch-min: 44px / --touch-comfy: 56px / --touch-large: 80px` (`packages/ui/src/tokens/luxe-dark.css:53-55`), exposées en classes Tailwind (`tailwind-preset.ts:150-152`) et consommées par les primitives `Button.tsx`/`Input.tsx` et des surfaces POS (Numpad, QwertyLayout, FloorPlanView, TabletOrderPage, modales stock vitrine). [UI câblée]
- **Garde-fou anti-modale non conforme** : règle ESLint maison `breakery-local/no-raw-modal-overlay` (`tools/eslint-rules/no-raw-modal-overlay.mjs`, avec ses propres tests dans `tools/eslint-rules/__tests__/`), branchée en `'error'` dans `eslint.config.mjs:46` — interdit tout overlay `fixed inset-0` hors primitives canoniques (`packages/ui` exempté). Le scénario doc « un développeur tente une fenêtre maison → refusé » est réel au lint. [Câblé en CI via lint-ratchet]
- **A11y des dialogues testée** : tests de focus-trap dédiés `CenterModal.focus-trap.test.tsx` et `FullScreenModal.focus-trap.test.tsx` (fermeture Escape, piège Tab) dans `packages/ui/src/components/__tests__/` ; les modales canoniques sont Radix-backed (Dialog/Sheet — focus-trap + Esc + scroll-lock natifs, cf. commentaire d'intention de la règle lint). Composant `SkipToContent.tsx` présent et testé. [UI câblée]
- **États vides normalisés** : primitive `EmptyState.tsx` + prop `emptyState` de `ReportPage` (`apps/backoffice/src/features/reports/components/ReportPage.tsx`), consommée par ~19 pages de rapports (GrossMarginPage, DailySalesPage, AuditPage…) + ProductsTable, ExpensesListPage, PurchaseOrdersListPage. Smoke test dédié `ReportPage.emptyState.smoke.test.tsx`. [UI câblée]
- **Ratchet qualité bloquant en CI** : `.github/workflows/ci.yml:128-144` — lint bloquant sur les seuls fichiers `**/src/**/*.ts(x)` touchés par la PR (le lint full-repo reste non-bloquant, ~250 erreurs de dette pré-existante, `ci.yml:105-112`). `max-lines` 500 en warn (`eslint.config.mjs:34`). Dernières exécutions CI : vertes (run 28660964213 du 2026-07-03). [CI]
- **Cohérence navigation BO** : hook `useUrlState` (`apps/backoffice/src/hooks/useUrlState.ts`, testé) utilisé par les pages de rapports (filtres dans l'URL).

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 — Bibliothèque de composants partagés en place et bien gardée.
- B1.2 — Pages vides : message explicite + action proposée (pas d'écran blanc).
- B1.3 — Dialogues conformes a11y (Échap, clavier), vérifiés par tests automatiques ; garde-fou bloquant toute nouvelle fenêtre non conforme.
- B1.4 — Vérification qualité du code bloquant les régressions à chaque PR.
- B1.5 — Cibles tactiles caisse agrandies à la norme ; navigation BO mise en cohérence.

### B2. Annoncé « À venir »
- B2.1 — Purger les couleurs codées en dur restantes.
- B2.2 — Corriger le contraste des textes discrets (légèrement sous la norme).
- B2.3 — Homogénéiser les écrans de chargement.
- B2.4 — Annonces vocales lecteurs d'écran sur les changements en direct (live regions).
- B2.5 — Illustrations de marque pour états vides et pages d'erreur.

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Bibliothèque partagée bien gardée | 11 primitives + 41 composants, 39 testés ; tokens 2 thèmes ; frontières packages ESLint | ✅ CONFORME |
| B1.2 | États vides avec message + action | `EmptyState` primitive + prop `emptyState` sur `ReportPage` (~19 pages) + tables produits/dépenses/achats ; smoke test dédié. Couverture large mais pas exhaustive (pages hors rapports non auditées une à une) | ✅ CONFORME |
| B1.3 | Dialogues a11y testés + garde-fou bloquant | Tests focus-trap CenterModal/FullScreenModal (Escape/Tab) ; règle `no-raw-modal-overlay` en error, bloquante via lint-ratchet CI. Nuance : pas de plugin `eslint-plugin-jsx-a11y` généralisé — le garde-fou couvre les overlays, pas toute l'a11y | ✅ CONFORME |
| B1.4 | Contrôle qualité bloquant à chaque PR | lint-ratchet bloquant sur fichiers touchés (`ci.yml:128-144`) + typecheck + tests + build bloquants ; lint full-repo encore non-bloquant (dette ~250 erreurs) — c'est exactement le design « ratchet » | ✅ CONFORME |
| B1.5 | Cibles 44 px + navigation BO cohérente | Tokens `--touch-min:44px` dans les primitives Button/Input + surfaces POS clés ; `useUrlState` + pages rapports. Non vérifié écran par écran (l'audit S57 ne couvrait que ProductGrid/TabletGrid/KDS) | 🟠 PARTIEL |

**Bonus code (le code fait plus que la doc) :**
- 🔵 Tokens de motion, d'élévation et de paiement dédiés (`motion.css`, `elevation.css`, `payment.css`) — vocabulaire plus riche que « mêmes boutons, mêmes fenêtres ».
- 🔵 `VirtualKeypadProvider`/`NumpadVirtual`/`QwertyLayout` : clavier virtuel maison partagé, thème-aware.
- 🔵 Règle lint maison testée (`tools/eslint-rules/__tests__/`) — le garde-fou a ses propres tests unitaires.

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
- **Échantillon couleurs en dur (B2.1)** : 15 fichiers dans `apps/*/src` contiennent encore des hex `#rrggbb` (mesuré par grep). La majorité est légitime/centralisée (`apps/backoffice/src/features/reports/utils/chartColors.ts`, `apps/pos/src/features/products/categoryTints.ts`, 4 smoke tests) ; les vrais candidats à purger : `SalesVelocityChart.tsx`, `StockAnalyticsPanel.tsx`, 3 composants suppliers, `AnalyticsTab.tsx` (customers), `RecipeCostTimelinePage.tsx`, `SalesByCategoryPage.tsx`, `SalesByHourPage.tsx`. Done : ces fichiers consomment `chartColors.ts`/tokens ; grep hex ≤ fichiers centralisés + tests.
- **Documenter la portée du garde-fou** : ajouter dans `tools/eslint-rules/no-raw-modal-overlay.mjs` (ou un README court) que la couverture a11y est « overlays uniquement » pour éviter la sur-confiance. Done : note en tête de fichier.

### D2. Chantiers moyens (1 session, plan requis)
- **Audit 44 px systématique (clore B1.5)** : passer les écrans POS restants (payment, shifts, held-orders, customer display) au crible des tokens touch ; remplacer les tailles ad hoc par `touch-min/comfy`. Livrable : liste d'écrans conformes + tests.
- **Contraste des textes discrets (B2.2)** : mesurer les paires `text-*-muted`/fond des deux thèmes (outil axe/contrast-ratio), ajuster les tokens dans `colors.css`/`luxe-dark.css` uniquement (pas de fix par écran). Done : ratios ≥ 4.5:1 (ou 3:1 pour large text) documentés.
- **Écrans de chargement homogènes (B2.3)** : inventorier spinners/skeletons existants, promouvoir un composant `LoadingState` dans `packages/ui/src/primitives`, migrer les pages rapports d'abord (elles partagent `ReportPage`).

### D3. Chantiers lourds (spec dédiée avant code)
- **A11y temps réel (B2.4)** : live regions ARIA pour KDS/commandes entrantes/toasts — interagit avec le realtime (canaux uniques par mount, cf. CLAUDE.md) et le rythme des rushes ; spec courte nécessaire pour définir quoi annoncer sans spammer le lecteur d'écran.
- **Illustrations de marque (B2.5)** : dépend d'assets design externes ; hors pur code.

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
- Préciser dans B1.3 que le garde-fou automatique couvre **les fenêtres/overlays** ; l'a11y générale (labels, ordres de focus hors modales) n'a pas de lint dédié — c'est cohérent avec le statut « Partiel » mais mérite la nuance.
- B1.5 : reformuler « agrandies à la norme » en « normées via tokens sur les primitives et les écrans audités (S57) » tant que l'audit systématique (D2) n'est pas fait.

## E. Dépendances croisées

- **Module 23 (Qualité & tests)** : le garde-fou (B1.3) et le ratchet (B1.4) ne mordent que parce que `ci.yml` est vert et bloquant — toute évolution du lint-ratchet se fait là-bas.
- **Modules 2/17 (caisse, tablette)** : les cibles tactiles restantes (D2) se corrigent dans `apps/pos`.
- **Module 6/BO rapports** : `ReportPage`/`emptyState`/`useUrlState` sont le socle de l'homogénéisation des rapports ; l'ajout de `LoadingState` (D2) doit y passer en premier.
