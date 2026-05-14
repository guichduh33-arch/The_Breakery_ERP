# Session 14 — UX Completion Spec

**Date:** 2026-05-14
**Branch:** `swarm/session-14`
**Predecessor:** Session 13 (merged `bdf21aa`) — code-complete on functions, UX gap discovered during close-out smoke.

---

## 1. Raison d'être

Session 13 a livré le **code fonctionnel** des 22 phases (Waves 0-6) : migrations DB, RPCs, edge functions, hooks, pages BO et POS câblées. La couverture fonctionnelle est de ~95% du périmètre 25-modules.

**Le gap découvert au smoke test de Session 13** est purement **UX/visuel** :
- Les écrans rendus ne respectent pas le design system "Luxe Bakery" documenté dans [`docs/DESIGN_POS_AND_BACKOFFICE.md`](../../DESIGN_POS_AND_BACKOFFICE.md) (POS sombre théâtral · BO clair structuré · gold `#C9A55C` · 4 polices · labels MAJUSCULES tracking large).
- Les 122 screenshots de référence dans [`docs/Design/`](../../Design/) (76 BO + 46 POS) constituent une **maquette quasi-pixel-perfect** que les écrans actuels n'atteignent pas.
- Les images produits, illustrations, empty states, micro-interactions, hiérarchie visuelle sont génériques au lieu d'incarner l'identité "boulangerie premium parisienne".

Session 14 est dédiée à **combler ce gap** en suivant le pattern Session 13 (waves + phases + sub-agents).

---

## 2. Goal global

> Amener POS, KDS, Customer Display, Backoffice et Tablette de **fonctionnel** à **production-ready visuellement** en alignant chaque écran sur sa référence dans `docs/Design/`, respectant strictement le design system "Luxe Bakery".

À la fin de Session 14 :
- Les 122 écrans référencés dans `docs/Design/` ont un équivalent React qui matche la référence à ≥ 90% (layout, typographie, couleurs, micro-interactions).
- Un **seed de démo** peuple la V3 dev avec ~40 produits The Breakery (avec photos), 8 catégories, 6 combos, 12 recettes, 4-5 customers, 2 suppliers, 1-2 jours de ventes simulées — pour que les screenshots ne soient pas trompeurs.
- Les **design tokens** sont étendus et appliqués uniformément (zero hardcoded color, zero police hors-charter).
- Les **primitives UI** manquantes sont ajoutées à `packages/ui` (Card, Stat, KpiTile, AvatarStack, EmptyState étendu, etc.).
- Le doc `DESIGN_POS_AND_BACKOFFICE.md` est mis à jour pour matcher la réalité du code.

---

## 3. Decisions pack (D1-D15)

### D1 — Source de vérité visuelle : screenshots
`docs/Design/{backoffice,caissapp}/*.jpg` (122 fichiers) **gagne** sur tout autre artefact (DESIGN doc, mockups intermédiaires). En cas de désaccord entre un screenshot et le doc, c'est le screenshot qui décide.

### D2 — Design tokens uniquement, zéro hardcoded
Toute couleur, taille, spacing, radius, shadow doit passer par un token CSS variable. Un PR contenant `#hexvalue`, `rgb(...)`, ou `px` magique en dehors des tokens est rejeté.

### D3 — 4 polices canoniques
- `Inter` (sans-serif body)
- `Playfair Display` (serif italique — branding, dashboard titles)
- `Fraunces` (serif optical — data viz, KPI)
- `JetBrains Mono` (monospace tabulaire — montants alignés, timers KDS)

Toute autre police = deviation à logger.

### D4 — Theme strict
- POS surfaces : `.theme-pos` (sombre, `#0C0C0E` background)
- BO surfaces : `.theme-backoffice` (clair, ivoire mat)
- Customer Display : `.theme-pos` (sombre, theatrical)
- KDS : `.theme-pos` (sombre, fullscreen)
- Tablet : `.theme-pos` (sombre, tactile)

Aucun écran ne mélange les deux themes.

### D5 — Labels MAJUSCULES tracking large = signature
Tous les labels de section (`ACTIVE ORDER`, `OPERATIONS`, `TOP PRODUCTS TODAY`, etc.) suivent : `text-xs` (10-12px), `font-bold`, `uppercase`, `tracking-widest` (0.05-0.2em). Composant `<SectionLabel>` à créer si pas déjà.

### D6 — Photos produits requises
Chaque produit affichable au POS DOIT avoir une `image_url`. Le seed Session 14 fournit les URLs (Unsplash/Pexels CC0 ou bake-related stock photos). Côté UI : fallback à une silhouette neutre (pas un icône emoji).

### D7 — Brand assets (revised 2026-05-14 post-Wave-1 audit)

**Two brand assets**, used selectively per surface :

#### D7.1 — BrandMark "B" (compact mark)
Round gold circle with Playfair italique "B" centered. **Already built** in Phase 1.A (`packages/ui/src/components/BrandMark.tsx` + `assets/brand-mark.svg`).

Used for **compact / repeated** surfaces :
- POS top-left header (size `md` = 40px)
- KDS top-left (size `md`)
- Tablet top-left (size `md`)
- Customer Display empty states (size `xl` = 96px)

#### D7.2 — BrandLogo (full illustration)
Illustrated croissant + "THE BREAKERY" Playfair wordmark + "French Bakery & Pastry" tagline. **Discovered post-Wave-1** in `Capture d'écran 2026-05-01 215219.jpg` (POS Login) and `220247.jpg` (BO sidebar header). NOT YET BUILT.

To be created in early Wave 2 (probably 2.A or 2.C) or appended to 1.C as a hotfix :
- `packages/ui/src/assets/brand-logo.svg` (illustrated croissant + wordmark)
- `packages/ui/src/components/BrandLogo.tsx` (renders the SVG with optional tagline)

Used for **anchored / branded** surfaces :
- POS Login (centered, large — above PIN entry)
- BO Login (centered, large)
- BO sidebar header (compact horizontal with badge counter for notifications)
- Customer Display branded header (large, hero-style)

Choice between BrandMark vs BrandLogo per surface :
- **Single-icon need (small inline)** → BrandMark
- **Full brand statement (centered hero)** → BrandLogo

### D8 — Empty states sont des écrans à part entière
Pas de "No data" en gris clair. Chaque empty state :
- Illustration (silhouette icon, jamais photo)
- Titre Playfair italique
- 1-2 lignes Inter description
- CTA si action utile (ex: "Add your first product")

Cf. `30-cart-active-2items-dine-in-totals.jpg` et empty state du panier POS.

### D9 — Animations restreintes mais présentes
- Tous transitions = `motion-reduce:animate-none` respect `prefers-reduced-motion`
- Modales : fade + scale 0.96→1 sur 200ms
- Sidebar items : color transition 150ms
- Pas de bounce, pas de slide-in agressif. Restraint = signature premium.

### D10 — Iconographie : Lucide uniquement
Déjà la convention. Aucun emoji. Aucune autre icon library. Si une icône manque dans Lucide, on dessine un SVG inline custom (rare).

### D11 — Pixel-perfect = 90% target
"Pixel-perfect" littéral n'est pas l'objectif (la web n'est pas Figma). Le target est ≥ 90% de fidélité visuelle : structure, hiérarchie, couleurs, polices identiques ; pixel-exact width/spacing pas requis si la sensation est juste.

### D12 — Mobile-first ou desktop-first ?
**Desktop-first** pour BO (les screenshots sont desktop-shaped, 1440-1920 wide). **Tablet-first** pour Tablet app. **Touch-optimized fixed-resolution** pour POS, KDS, Customer Display. Aucune surface n'est conçue pour smartphone en Session 14 (mobile shell = Wave 7 déferré).

### D13 — Accessibility maintenue
A11y de Wave 1.D Session 13 préservée : ARIA labels, focus visible, contrast WCAG AA, motion-reduce, skip-to-content. Tout nouveau composant passe par `<VisuallyHidden>` si Radix Dialog sans title visible.

### D14 — Performance budget
Aucune régression > 100KB sur les bundles POS / BO post-Wave 6 (1.46MB BO, ~700KB POS). Si Wave UX ajoute > 100KB → require code-split via `React.lazy()`. Photo assets servis depuis CDN (Supabase storage ou Unsplash direct), pas bundlés.

### D15 — Seed migration = idempotent
Le seed Session 14 va dans une nouvelle migration `20260518000000_seed_breakery_demo.sql` ou similaire. Idempotent (ON CONFLICT DO NOTHING) pour qu'on puisse re-run sans dupliquer. Avec env-gate : `IF current_setting('app.demo_seed', true) = 'enabled'` pour ne PAS l'appliquer en prod.

---

## 4. Conventions

- **Branches** : `swarm/session-14-phase-X.Y` puis squash-merge sur `swarm/session-14`.
- **Commits** : `feat(ui): session 14 — phase X.Y — <topic>` / `fix(pos|bo|kds|display|tablet): ...` / `feat(seed): ...`.
- **Migrations Session 14** : block `20260518000XXX_*` (X = ordinal). Réservé `000001..099` pour seed/setup, `000100..199` pour future schema (s'il y en a).
- **Tests** : tout nouveau composant `packages/ui` a un test `__tests__/`. Smoke render pour chaque page modifiée. Pas de pgTAP (UX = pas de schema change attendu).
- **Plan layout** : `docs/workplan/{plans,specs,refs}/2026-05-14-session-14-*.md` — append-only, dated.

---

## 5. Definition of Done — Session 14

Section 7-style DoD (mirroring Session 13 spec) :

1. **Design tokens** : `packages/ui/src/tokens/` étendu — semantic/payment/motion/typography/spacing tokens. 100% des couleurs/spacing dans le code passent par un token.
2. **Polices** : Inter + Playfair + Fraunces + JetBrains Mono chargées via `@fontsource-variable` dans les 2 apps. Loaded pour POS theme et BO theme.
3. **Primitives UI** : `<Card>`, `<SectionLabel>`, `<BrandMark>`, `<KpiTile>`, `<Stat>`, `<EmptyState v2>`, `<NumpadVirtual>`, `<DataTable>` dans `packages/ui`. Tous avec story/test.
4. **Seed** : migration applied — 40+ produits avec photos, 8 catégories, 6 combos, 12 recettes, 4-5 customers, 2 suppliers, 1 journée de ventes seedées, 2 sessions POS (one open one closed).
5. **POS** : 6 zones polishées (top bar, category nav, product grid, combo grid, cart, cart actions). 46/46 screenshots matchent à ≥ 90%.
6. **KDS** : station-aware view matche `kds configue.jpg` + `live order.jpg`. Timers JetBrains Mono. Cards aged styling.
7. **Customer Display** : centered branded view, current order with photos. Empty state with "B" mark.
8. **Tablet** : floor plan + order entry matche refs. Tactile spacing.
9. **Backoffice** : Dashboard + 40+ pages matchent screenshots BO. Sidebar groupée par section avec icons + labels uppercase.
10. **A11y** : motion-reduce respect partout, focus-visible, ARIA labels sur tous les boutons icon-only.
11. **Tests** : tous les builds passent. Vitest unit pour les primitives. Smoke render pour les pages. Pas de régression Session 13.
12. **Types regen** : aucune migration de schema attendue donc types stables. Seed migration ne touche pas les types.
13. **Docs** : `DESIGN_POS_AND_BACKOFFICE.md` mis à jour pour matcher le code (suppression de tout passage qui mentionne `docs/ux/assets/screens/` inexistant ; remplacement par `docs/Design/`).
14. **Performance** : POS bundle ≤ 800KB, BO ≤ 1.6MB. Photos servies depuis CDN, pas bundlées.

---

## 6. Out of scope

- Nouveau backend / nouvelle migration de schema (pas de tables, pas de RPCs nouvelles).
- Mobile shell Capacitor (Wave 7 déferré).
- Multi-currency, multi-tenancy (Session 15+).
- Voice ordering, ML, OCR, 2FA (Session 19+).
- B2B portal full (Session 17).
- Nouvelle fonctionnalité business non-incluse dans Session 13.

---

## 7. References

- Source visuelle : `docs/Design/backoffice/*.jpg` (76 BO) + `docs/Design/caissapp/*.jpg` (46 POS)
- Design system canonique : `docs/DESIGN_POS_AND_BACKOFFICE.md`
- Objectifs métier par module : `docs/objectif travail/*.md` (16 specs)
- Module reference : `docs/reference/04-modules/` (25 modules)
- Wave 0 INDEX : `docs/workplan/plans/2026-05-14-session-14-INDEX.md`
- Screenshot audit : `docs/workplan/refs/2026-05-14-session-14-screenshot-audit.md`
- Seed plan : `docs/workplan/refs/2026-05-14-session-14-seed-plan.md`
- Predecessor : `docs/workplan/plans/2026-05-13-session-13-INDEX.md` (merged at `bdf21aa`)
