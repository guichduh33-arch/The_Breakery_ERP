# Session 14 — INDEX (UX Completion)

**Date:** 2026-05-14
**Branch:** `swarm/session-14`
**Spec:** [`../specs/2026-05-14-session-14-spec.md`](../../specs/archive/2026-05-14-session-14-spec.md)
**Audit:** [`../refs/2026-05-14-session-14-screenshot-audit.md`](../../refs/2026-05-14-session-14-screenshot-audit.md)
**Seed:** [`../refs/2026-05-14-session-14-seed-plan.md`](../../refs/2026-05-14-session-14-seed-plan.md)

---

## 1. Goal global

Combler le gap UX/visuel découvert au smoke test de Session 13. Amener les 5 surfaces (POS, KDS, Customer Display, Tablet, Backoffice) à matcher les 122 screenshots de `docs/Design/` à ≥ 90% de fidélité visuelle.

**Total phases exécutables : 18** (Phases 0.1, 0.2, 1.A, 1.B, 1.C, 2.A, 2.B, 2.C, 2.D, 3.A, 3.B, 3.C, 4.A, 4.B, 4.C, 5.A, 5.B, 6.A)

**Budget effort estimé : 60-100h** (suiveur Session 13 = 22 phases ~120h, donc Session 14 = 18 phases UX ≈ 60-100h selon profondeur).

---

## 2. Architecture en vagues

```
Wave 0 (planning, pas de code) — Wave 0 DOCUMENTAIRE déjà partiellement écrite
   ├── Phase 0.1 Spec + INDEX + audit + seed plan (CE DOC)
   └── Phase 0.2 Setup branch + Wave 0 review gate
        │
        ▼
Wave 1 (Foundations design system + seed) — 3 phases parallèles
   ├── Phase 1.A Design tokens + polices + primitives UI v2 (Card / KpiTile / SectionLabel / BrandMark / EmptyState v2)
   ├── Phase 1.B Seed bakery démo (produits, catégories, combos, recettes, customers, suppliers, ventes simulées)
   └── Phase 1.C BrandMark + Logo "B" + iconographie alignment (Lucide audit)
        │
        ▼ Wave 1 sync gate : tokens green, build green, seed appliqué
Wave 2 (POS surface — face client) — 4 phases parallèles
   ├── Phase 2.A POS main grid + category nav + product cards (refs 01-06)
   ├── Phase 2.B POS cart + active order panel + cart actions (refs 30-32, 50-51)
   ├── Phase 2.C POS shift + modifiers + payment + held orders (refs 10-13, 20-23, 60-63)
   └── Phase 2.D POS stock + transaction history + floor plan (refs 40-41, 70-73, 80)
        │
        ▼
Wave 3 (KDS + Customer Display + Tablet) — 3 phases parallèles
   ├── Phase 3.A KDS station view + timers + age styling
   ├── Phase 3.B Customer Display + branded empty + active order with photos
   └── Phase 3.C Tablet floor plan + order entry + waiter view
        │
        ▼
Wave 4 (Backoffice navigation + dashboard) — 3 phases parallèles
   ├── Phase 4.A BO sidebar + dashboard + topbar + global layout
   ├── Phase 4.B Products + Categories + Combos + Recipes + Units pages
   └── Phase 4.C Inventory (stock + opname + waste + movements + transfers)
        │
        ▼
Wave 5 (Backoffice modules métier) — 2 phases parallèles
   ├── Phase 5.A Purchasing + Suppliers + PO + Expenses
   └── Phase 5.B Customers + Loyalty + Promotions + Combos + B2B
        │
        ▼
Wave 6 (Backoffice analytics + settings + final polish) — 1 phase
   └── Phase 6.A Reports + Settings + Users + RBAC + Print queue + LAN + closeout audit
```

---

## 3. Wave 0 — Prerequisites (no code)

### Phase 0.1 — Spec + INDEX + screenshot audit + seed plan (DONE — ce doc)

**Goal** : Produire les 4 artefacts canoniques de Session 14.

**Module(s)** : transversal.

**Files** :
- `docs/workplan/specs/2026-05-14-session-14-spec.md` ✓
- `docs/workplan/plans/2026-05-14-session-14-INDEX.md` ✓ (ce fichier)
- `docs/workplan/refs/2026-05-14-session-14-screenshot-audit.md` ✓
- `docs/workplan/refs/2026-05-14-session-14-seed-plan.md` ✓

**DoD** :
- [x] 4 docs créés
- [x] Spec décrit 15 décisions D1-D15
- [x] INDEX liste 18 phases / 6 waves
- [x] Audit map 122 screenshots → React files
- [x] Seed plan list ~40 produits + autres entités

**Complexity** : S (~2h).

**Dependencies** : aucune (point de départ).

**Suggested executor** : lead (vous) directement.

**Parallelization tag** : sequential (Wave 0).

---

### Phase 0.2 — Setup branch + Wave 0 review gate

**Goal** : Confirmer Wave 0 review passé, branch ready, types regen pas nécessaire (pas de schema change).

**Files** :
- `CLAUDE.md` — update Active Workplan status pour pointer Session 14.

**DoD** :
- [ ] Branch `swarm/session-14` créée depuis master (DONE)
- [ ] CLAUDE.md status updated
- [ ] Wave 0 docs committed sur swarm/session-14
- [ ] PR draft "Session 14 — UX completion" opened (optionnel — peut attendre Wave 1 complete)

**Complexity** : XS (~30 min).

**Dependencies** : Phase 0.1 ✓.

---

## 4. Wave 1 — Foundations

### Phase 1.A — Design tokens + polices + primitives UI v2

**Goal** : Établir le design system complet avant tout refactor de page. Tokens (color/spacing/typography/motion) extended, polices loaded, primitives Card/KpiTile/SectionLabel/BrandMark/EmptyState v2 dispos dans `packages/ui`.

**Module(s)** : 22 (Design tokens + a11y).

**Files** :
- `packages/ui/src/tokens/colors.css` (EXTEND) — ajouter `--surface-3`, `--surface-4`, `--gold-soft`, `--gold-strong`, `--cream`, etc.
- `packages/ui/src/tokens/typography.css` (CREATE) — `--font-display` (Playfair italic), `--font-body` (Inter), `--font-data` (Fraunces), `--font-mono` (JetBrains Mono).
- `packages/ui/src/tokens/spacing.css` (REVIEW) — vérifier 4px-base scale.
- `packages/ui/src/tokens/elevation.css` (CREATE) — shadow tokens.
- `apps/{pos,backoffice}/index.html` (UPDATE) — `<link rel="preload">` pour 4 polices.
- `apps/{pos,backoffice}/src/index.css` (UPDATE) — import `@fontsource-variable/inter`, `@fontsource/playfair-display`, `@fontsource-variable/fraunces`, `@fontsource-variable/jetbrains-mono`.
- `packages/ui/src/components/Card.tsx` (CREATE) — base card primitive.
- `packages/ui/src/components/SectionLabel.tsx` (CREATE) — uppercase tracking-widest signature.
- `packages/ui/src/components/BrandMark.tsx` (CREATE) — logo "B" rond.
- `packages/ui/src/components/KpiTile.tsx` (CREATE) — KPI carré avec value + label + delta.
- `packages/ui/src/components/Stat.tsx` (CREATE) — stat inline (Active Orders : 12).
- `packages/ui/src/components/EmptyState.tsx` (REWRITE) — version v2 avec illustration + Playfair title.
- `packages/ui/src/components/NumpadVirtual.tsx` (CREATE if missing) — virtual numpad pour POS.
- `packages/ui/src/components/DataTable.tsx` (REVIEW or CREATE) — base table avec sort/filter.
- `packages/ui/src/__tests__/Card.test.tsx`, idem pour chaque primitive.

**DoD** :
- [ ] 4 polices loaded sans flash.
- [ ] Tokens couvrent 100% des cas usage des screenshots.
- [ ] 8 primitives nouvelles ou v2 dans `packages/ui`, exports propres.
- [ ] `pnpm typecheck` + `pnpm test` green.
- [ ] `pnpm build` taille bundle pas +50KB vs baseline.

**Complexity** : **L** (~10h).

**Dependencies** : Wave 0.

**Suggested executor** : `ui-foundation` (architect + coder).

**Parallelization tag** : parallel with 1.B / 1.C.

---

### Phase 1.B — Seed bakery démo

**Goal** : Migration de seed The Breakery — 40+ produits avec photos URLs, 8 catégories, 6 combos, 12 recettes, 4-5 customers, 2 suppliers, 1 journée de ventes simulées.

**Module(s)** : 01 (Products), 02 (POS), 06 (Inventory), 07 (Purchasing), 09 (Customers), 12 (Cash Register), 13 (Promotions), 15 (Production).

**Files** :
- `supabase/migrations/20260518000001_seed_breakery_demo.sql` (CREATE) — gros script idempotent, env-gated.

**DoD** :
- [ ] Migration applied via MCP.
- [ ] `SELECT COUNT(*) FROM products WHERE is_active = true` = 40+.
- [ ] Toutes les rows seedées ont une `image_url` non-null pour produits affichables au POS.
- [ ] 1 session POS open + 1 closed (avec opening_cash et closing_cash).
- [ ] 5-10 orders complétés sur l'open session avec différents payment methods.
- [ ] Seed re-runnable (ON CONFLICT DO NOTHING).

**Complexity** : **L** (~8h — recherche photos + écriture SQL).

**Dependencies** : Wave 0.

**Suggested executor** : `seed-author` (researcher + coder).

**Parallelization tag** : parallel with 1.A / 1.C.

---

### Phase 1.C — BrandMark + Logo "B" + iconographie alignment

**Goal** : Audit Lucide usage actuel + créer SVG assets pour le logo "B" (Playfair italique gold). Vérifier qu'aucun emoji n'est utilisé.

**Module(s)** : 22 (Design system).

**Files** :
- `packages/ui/src/assets/brand-mark.svg` (CREATE) — SVG inline logo.
- `packages/ui/src/components/BrandMark.tsx` (depend on 1.A).
- Grep tous les `.tsx` pour repérer les emojis (🛒, etc.) et les remplacer par Lucide.
- Audit des Lucide imports — éviter les doublons (`Users` vs `User`, etc.).

**DoD** :
- [ ] `grep -r "[\u{1F600}-\u{1F6FF}]" apps/ packages/` = 0 results.
- [ ] BrandMark visible dans POS top-left, BO sidebar, login pages.
- [ ] Aucune autre icon library (font-awesome, heroicons, etc.) en dependencies.

**Complexity** : **S** (~3h).

**Dependencies** : Phase 1.A (BrandMark component).

**Suggested executor** : `brand-steward` (coder).

**Parallelization tag** : after 1.A unblocks.

---

## 5. Wave 2 — POS surface

Cf. audit screenshots pour mapping détaillé.

### Phase 2.A — POS main grid + category nav + product cards

**Goal** : Match screenshots `01-06` (bagel/beverage/coffee/bread grids avec different cart states).

**Module(s)** : 02 (POS) + 03 (Products at POS).

**Files** :
- `apps/pos/src/features/products/ProductGrid.tsx` (REWRITE) — 3-col layout (cat nav | grid | cart panel).
- `apps/pos/src/features/products/CategoryNav.tsx` (REWRITE) — vertical text uppercase, gold active.
- `apps/pos/src/features/products/ProductCard.tsx` (REWRITE) — photo + nom + prix + favorite star.
- `apps/pos/src/features/products/ComboCard.tsx` (REWRITE) — combo styling distinct.
- `apps/pos/src/pages/POSMainPage.tsx` (UPDATE) — 6 zones layout.

**DoD** :
- [ ] Screenshots 01-06 reproductibles à ≥ 90%.
- [ ] Hover/active states identical to refs.
- [ ] Stock badge (out-of-stock) visible.

**Complexity** : **M** (~6h).

**Dependencies** : Wave 1 (tokens + Card primitive).

**Parallelization tag** : parallel with 2.B / 2.C / 2.D.

---

### Phase 2.B — POS cart + active order panel + cart actions

**Goal** : Match screenshots `30-32` (active cart 2items dine-in, takeout customer bronze, locked items after kitchen).

**Module(s)** : 02 (POS).

**Files** :
- `apps/pos/src/features/cart/ActiveOrderPanel.tsx` (REWRITE) — header order #, mode toggle DINE IN/TAKE-OUT/DELIVERY, ADD CLIENT, HELD ORDERS, CLEAR.
- `apps/pos/src/features/cart/CartLineRow.tsx` (REWRITE) — qty + name + modifiers + price + remove button.
- `apps/pos/src/features/cart/CartTotals.tsx` (REWRITE) — Subtotal/Loyalty/Promotions/Discount/Tax/Total stack.
- `apps/pos/src/features/cart/CartActionsBar.tsx` (REWRITE) — Hold / Discount / Send to KDS / Pay.
- `apps/pos/src/features/cart/EmptyCart.tsx` (REWRITE) — empty state with "B" mark.

**DoD** :
- [ ] Screenshots 30-32 + 50-51 (customer attach, held orders) reproductibles ≥ 90%.
- [ ] Locked state visible after kitchen send (faded items + lock icon).

**Complexity** : **M** (~5h).

**Parallelization tag** : parallel with 2.A / 2.C / 2.D.

---

### Phase 2.C — POS shift + modifiers + payment + held orders

**Goal** : Match screenshots `10-13` (shift open flow), `20-23` (modifier selectors), `60-63` (payment flow).

**Module(s)** : 02 (POS) + 05 (Payment).

**Files** :
- `apps/pos/src/features/shift/OpenShiftModal.tsx` (REWRITE) — pin → cash counting numpad → opening cash filled.
- `apps/pos/src/features/products/ModifierGroupSelector.tsx` (REWRITE) — required indicator, multi-group support.
- `apps/pos/src/features/payment/PaymentTerminal.tsx` (REWRITE) — method selection → cash entry numpad → added success → final success modal.

**DoD** :
- [ ] Screenshots 10-13 + 20-23 + 60-63 reproductibles ≥ 90%.

**Complexity** : **M** (~7h).

**Parallelization tag** : parallel with 2.A / 2.B / 2.D.

---

### Phase 2.D — POS stock + transaction history + floor plan

**Goal** : Match screenshots `40-41` (floor plan), `70-73` (cafe stock), `80` (transaction history).

**Module(s)** : 02 (POS) + 04 (POS-side stock view).

**Files** :
- `apps/pos/src/features/floor-plan/FloorPlanModal.tsx` (REWRITE).
- `apps/pos/src/features/products/POSStockView.tsx` (REWRITE).
- `apps/pos/src/features/order-history/OrderHistoryPanel.tsx` (REWRITE).

**DoD** :
- [ ] Screenshots 40-41 + 70-73 + 80 reproductibles ≥ 90%.

**Complexity** : **M** (~5h).

**Parallelization tag** : parallel with 2.A / 2.B / 2.C.

> **2026-05-14 closeout note (Phase 2.D scope expansion).** During Wave 2 dogfooding, Phase 2.D absorbed four extra POS-side surfaces beyond the original scope above. They ship as commits `dc62fee` (live sessions modal — new), `53cba34` (POS reports surfaces — pulled forward from Wave 6.A), `3a0322e` (POS settings page — pulled forward from Wave 6.A), `874f1e6` (customer debts panel + auxiliary routes — closest plan home was Wave 5.B). Each was added because it shares the SideMenu-aux-surface pattern and was reachable from the new POS shell. **See §9 Wave 6.A for the corresponding scope decrement.** The BO-side equivalents (canonical settings persistence, full reports module) remain Wave 6.A work; this expansion delivers POS-shell views only.

---

## 6. Wave 3 — KDS + Display + Tablet

### Phase 3.A — KDS station view + timers + age styling

**Goal** : Match `kds configue.jpg` + `live order.jpg` + `live order2.jpg`. Timers JetBrains Mono.

**Module(s)** : 04 (KDS).

**Files** :
- `apps/pos/src/features/kds/KdsBoard.tsx` (REWRITE).
- `apps/pos/src/features/kds/components/KdsOrderCard.tsx` (REWRITE — timers + age styling).

**Complexity** : **M** (~4h).

**Parallelization tag** : parallel with 3.B / 3.C.

---

### Phase 3.B — Customer Display

**Goal** : Match `customer display.jpg`. Branded full-screen.

**Module(s)** : 16 (Customer Display).

**Files** :
- `apps/pos/src/features/display/CustomerDisplayView.tsx` (REWRITE).

**Complexity** : **S** (~3h).

**Parallelization tag** : parallel with 3.A / 3.C.

---

### Phase 3.C — Tablet (Waiter floor view + order entry)

**Goal** : Match `plan de table.jpg` côté tablet. Tactile spacing.

**Module(s)** : 17 (Tablet).

**Files** :
- `apps/pos/src/features/tablet/FloorPlanView.tsx` (REWRITE).
- `apps/pos/src/features/tablet/TabletOrderPage.tsx` (REWRITE).

**Complexity** : **M** (~4h).

**Parallelization tag** : parallel with 3.A / 3.B.

---

## 7. Wave 4 — Backoffice nav + Products

### Phase 4.A — BO sidebar + dashboard + topbar + layout

**Goal** : Match `Dashboard.jpg`. Sidebar groupée par section avec icons + labels uppercase ; topbar avec brand + user menu.

**Module(s)** : 22 (Design — BO surface).

**Files** :
- `apps/backoffice/src/layouts/BackofficeLayout.tsx` (REWRITE).
- `apps/backoffice/src/layouts/Sidebar.tsx` (CREATE/EXTRACT).
- `apps/backoffice/src/pages/Dashboard.tsx` (REWRITE) — KPI tiles + live activity + top products.

**Complexity** : **M** (~5h).

**Parallelization tag** : parallel with 4.B / 4.C.

---

### Phase 4.B — Products + Categories + Combos + Recipes + Units

**Goal** : Match `product page.jpg`, `Product detail1/2.jpg`, `product general 1/2/3.jpg`, `combo management.jpg`, `product recette.jpg`, `product unit.jpg`, etc.

**Module(s)** : 01 (Products), 13 (Promotions / Combos).

**Files** :
- `apps/backoffice/src/pages/Products.tsx` + tous les detail sub-routes.
- `apps/backoffice/src/features/combos/` (full UX pass).
- `apps/backoffice/src/features/recipes/` (full UX pass).

**Complexity** : **L** (~10h — beaucoup d'écrans).

**Parallelization tag** : parallel with 4.A / 4.C.

---

### Phase 4.C — Inventory (stock + opname + waste + movements + transfers)

**Goal** : Match `09-stock-list.jpg`, `stock mouvement.jpg`, `stock opname.jpg`, `stock waste.jpg`, `14-transfers-list.jpg`.

**Module(s)** : 06 (Inventory).

**Files** :
- `apps/backoffice/src/pages/inventory/*` (REWRITE all).

**Complexity** : **L** (~8h).

**Parallelization tag** : parallel with 4.A / 4.B.

---

## 8. Wave 5 — Backoffice modules métier

### Phase 5.A — Purchasing + Suppliers + PO + Expenses

**Goal** : Match `13-incoming-po-list.jpg`, `13b-incoming-po-detail.jpg`, `15-suppliers-list.jpg`, `15b/c/d/e-supplier-detail-*.jpg`, `PO form.jpg`, `PO page.jpg`, `expenses.jpg`, `expenses category.jpg`.

**Module(s)** : 07 (Purchasing), 11 (Expenses).

**Complexity** : **L** (~10h).

**Parallelization tag** : parallel with 5.B.

---

### Phase 5.B — Customers + Loyalty + Promotions + B2B

**Goal** : Match `customer.jpg`, `customer edit.jpg`, `customer category.jpg`, `loyalty programm.jpg`, `combo 2.jpg` + co, `btob dashboard.jpg`, `btob payment.jpg`, `BtoB setting.jpg`.

**Module(s)** : 08 (Loyalty), 09 (Customers), 13 (Promotions), 23 (B2B).

**Complexity** : **L** (~10h).

**Parallelization tag** : parallel with 5.A.

---

## 9. Wave 6 — Backoffice analytics + Settings + closeout

### Phase 6.A — Reports + Settings + Users + RBAC + Print queue + LAN + final audit

**Goal** : Match `report.jpg`, `report finance.jpg`, `inventory report.jpg`, `log report.jpg`, `operations report.jpg`, `purshase report.jpg`, `setting.jpg`, `setting page.jpg`, `pos setting.jpg`, `payment setting.jpg`, `printer setting.jpg`, `kds configue.jpg`, `user.jpg`, `edit user.jpg`, `role et permission.jpg`.

**Module(s)** : 14 (Reports), 19 (Settings), 20 (RBAC), 25 (Print queue + LAN devices).

**Complexity** : **XL** (~15h — beaucoup d'écrans + final cleanup audit pour rattraper les écarts résiduels).

**Parallelization tag** : sequential (Wave 6, dernière).

> **2026-05-14 scope decrement (Phase 2.D pulled forward POS-side surfaces).** The POS-shell views for Reports (`pos setting.jpg` adjacent — POSReportsOverview/Products/Activity) and Settings (`pos setting.jpg`) shipped early in Phase 2.D commits `53cba34` and `3a0322e`. Wave 6.A still owns: canonical BO Settings persistence + the BO-side full Reports module (`report.jpg`, `report finance.jpg`, `inventory report.jpg`, `log report.jpg`, `operations report.jpg`, `purshase report.jpg`, `setting.jpg`, `setting page.jpg`, `payment setting.jpg`, `printer setting.jpg`, `kds configue.jpg`) + Users/RBAC + Print queue + LAN. Revised estimate: **~12h** (was 15h). See §5 Phase 2.D closeout note for the inventory of pulled-forward work.

**Final closeout** :
- [ ] Update `DESIGN_POS_AND_BACKOFFICE.md` pour matcher le code livré.
- [ ] Audit : tous les 122 screenshots ont leur React file ≥ 90% match.
- [ ] Perf check : bundle sizes dans budget (D14).
- [ ] PR Session 14 → master.

---

## 10. File structure récap

| Action | Path | Phase |
|---|---|---|
| EXTEND | `packages/ui/src/tokens/{colors,typography,spacing,elevation}.css` | 1.A |
| CREATE | `packages/ui/src/components/{Card,SectionLabel,BrandMark,KpiTile,Stat,EmptyState,NumpadVirtual,DataTable}.tsx` | 1.A |
| CREATE | `supabase/migrations/20260518000001_seed_breakery_demo.sql` | 1.B |
| REWRITE | `apps/pos/src/features/{products,cart,shift,payment,kds,display,tablet,floor-plan,order-history}/**/*.tsx` | 2.A-D / 3.A-C |
| REWRITE | `apps/backoffice/src/{layouts,pages,features}/**/*.tsx` | 4.A-C / 5.A-B / 6.A |
| UPDATE | `apps/{pos,backoffice}/index.html` (font preload) | 1.A |
| UPDATE | `apps/{pos,backoffice}/src/index.css` | 1.A |
| CREATE | `packages/ui/src/assets/brand-mark.svg` | 1.C |
| UPDATE | `docs/DESIGN_POS_AND_BACKOFFICE.md` | 6.A |

---

## 11. Verification one-shot end-of-session

```bash
# Apply seed
mcp__plugin_supabase_supabase__apply_migration project_id=ikcyvlovptebroadgtvd name=seed_breakery_demo

# Verify seed
mcp__plugin_supabase_supabase__execute_sql "SELECT COUNT(*) FROM products WHERE is_active=true AND image_url IS NOT NULL"
# Expected: ≥ 40

# Build + test
pnpm typecheck && pnpm exec turbo run test --concurrency=1 && pnpm build

# Bundle size check (informational)
ls -lh apps/pos/dist/assets/*.js
ls -lh apps/backoffice/dist/assets/*.js

# Local smoke
pnpm dev
# Manually navigate to:
# POS: http://localhost:5173 (login Mamat 123456)
# BO:  http://localhost:5174 (login Mamat 123456)
# Verify all 122 screenshots ≥ 90% match
```

---

## 12. Parallelization map

| Wave | Phases | Streams parallèles | Estimated h |
|---|---|---|---|
| 0 | 0.1, 0.2 | 2 sequential (docs) | 2.5 |
| 1 | 1.A, 1.B, 1.C | 3 (1.C dépend de 1.A) | 10 + 8 + 3 = 21 |
| 2 | 2.A, 2.B, 2.C, 2.D | 4 parallèles | max(6, 5, 7, 5) = 7 |
| 3 | 3.A, 3.B, 3.C | 3 parallèles | max(4, 3, 4) = 4 |
| 4 | 4.A, 4.B, 4.C | 3 parallèles | max(5, 10, 8) = 10 |
| 5 | 5.A, 5.B | 2 parallèles | max(10, 10) = 10 |
| 6 | 6.A | 1 | 15 |
| **TOTAL** | **18 phases** | **6 waves** | **~70h** (parallel-optimized) |

Solo dev (séquentiel par phase) : ~95h.
Avec swarm 3-4 sub-agents par wave : ~70h.

---

## 13. Comms entre subagents (Session 14)

```
lead (you) ←→ ui-foundation / seed-author / brand-steward (Wave 1)
            ←→ pos-grid / pos-cart / pos-flow / pos-aux (Wave 2)
            ←→ kds / display / tablet (Wave 3)
            ←→ bo-nav / bo-products / bo-inventory (Wave 4)
            ←→ bo-purchasing / bo-crm (Wave 5)
            ←→ bo-analytics-settings (Wave 6)
            ←→ reviewer (gates all merges)
```

Pattern : chaque subagent SendMessage `lead` à completion ; lead route à `reviewer`.

---

## 14. Out of scope (déféré Session 15+)

- Multi-currency end-to-end (10-019)
- Multi-tenancy infra (19-008)
- Multi-entity consolidation (10-020)
- B2B portal complete (09-007..017)
- Mobile shell Capacitor
- e-Faktur DJP (10-014)
- Voice / ML / OCR / 2FA
- LAN multi-site

Session 14 = UX completion **uniquement**. Toute nouvelle feature business attend Session 15+.
