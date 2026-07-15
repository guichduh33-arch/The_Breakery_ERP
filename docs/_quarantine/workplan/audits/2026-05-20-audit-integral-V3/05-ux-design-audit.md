# Vague 5 — UX/UI Backoffice Audit

> **Date** : 2026-05-20
> **Skill** : anthropic-skills:app-design-specialist (chargée)
> **Scope** : layouts (3 fichiers), 69 pages BO sous `apps/backoffice/src/pages/**`, 27 features, `packages/ui` (Luxe Dark + tokens + primitives shadcn vendus)
> **Effort réel** : ~45 minutes (lecture pure + grep ciblés)

---

## TL;DR (5 lignes max)

Le design system est **techniquement excellent** : 0 import shadcn npm dans `apps/`, 0 violation `no-raw-modal-overlay`, primitives Radix-backed vendues (`packages/ui/src/primitives`), tokens cream/ivoire + dark dual-theme propres (`packages/ui/src/tokens/`), DataTable avec skeleton loaders intégrés. **Mais l'adoption à l'app-side est fortement driftée** : 142 occurrences de palette Tailwind brute (`bg-red-500`, `text-emerald-600`, etc.) dans 53 fichiers court-circuitent les tokens sémantiques (`text-danger`, `bg-success-soft`). 12 occurrences de classes `dark:` cassent le système variable-based (warning explicite du SKILL). Sidebar **non-collapsible** sur tablet (always w-60). Score qualité global **63/100** — fondations solides, hygiène d'usage à reprendre.

---

## Score qualité par pilier

| Pilier | Score | Notes |
|---|---|---|
| Cohérence design system (tokens) | **5/10** | 142 hardcoded palette Tailwind / 53 fichiers — drift majeur |
| shadcn primitives vendus (0 import npm direct) | **OK** | 0 import depuis `@radix-ui` ou `shadcn-ui` dans `apps/backoffice/src/` |
| Focus-trap S22 lock-in (`no-raw-modal-overlay`) | **LOCKED** | ESLint rule `'error'` + 0 violation détectée + 1 commentaire historique uniquement |
| Layouts (sidebar, nav) | **PARTIAL** | Sidebar groupée bien hiérarchisée mais **non-responsive** (w-60 fixe partout) |
| Tableaux (pattern cohérent) | **PARTIAL** | `DataTable` primitive avec skeleton+empty+sort excellent mais **N pages bypass** (tables manuelles dans BalanceSheet, ProfitLoss, StockVariance, Users, Mappings) |
| Modales / Dialogs | **OK** | Tous les modals consomment `Dialog` (`@breakery/ui`) Radix-backed, focus trap + ESC + a11y gratis |
| Dark mode | **N/A** | BO est `theme-backoffice` (cream) — pas de dark mode active. 12 `dark:` classes sont dead code |
| Responsive | **FAIL** | Sidebar pas collapsible, KEY: 0 `md:hidden`/`md:flex` sur Sidebar.tsx, BO desktop-only par défaut |
| Skeleton loaders | **PARTIAL** | `DataTable` skeleton built-in, mais pages avec table manuelle affichent `Loading…` text (66 occurrences) |
| Accessibility (WCAG AA) | **PARTIAL** | `SkipToContent` mount au App.tsx ✓, focus-visible cohérent dans primitives, mais `role="switch"` que dans 2 features (GeneralPanel, BoulangerModeToggle), labels ARIA inégaux |
| Inconsistances visuelles | **65 findings** | mix tokens cream + palette tailwind 50-700, classes `dark:` orphelines, `text-[10px]/[11px]/[9px]` ad-hoc |

---

## Findings

### 🔴 Critiques (bloque persona usage)

**C1. Sidebar non-collapsible — BO inutilisable sur tablette gérante**
`apps/backoffice/src/layouts/Sidebar.tsx:176` → `w-60 shrink-0` codé en dur, aucun breakpoint, aucune logique d'ouverture/fermeture. Sur tablette 768px (persona gérante mobile envisagée par le CLAUDE.md), 240px de sidebar fixe + 240px de viewport restant = pages tableaux dense (BalanceSheet, ProfitLoss, MovementsTable) inutilisables. **Recommandation** : transformer en `Sheet` Radix sur `< lg`, garder fixe sur `≥ lg`. La primitive `Sheet` existe déjà dans `packages/ui/src/primitives/Sheet.tsx`.

**C2. UsersTable bypass complet du design system**
`apps/backoffice/src/features/users/components/UsersTable.tsx:14-20` → table de couleurs hardcodée :
```ts
const ROLE_BADGE_CLASS = {
  SUPER_ADMIN: 'bg-rose-100 text-rose-700',
  ADMIN:       'bg-amber-100 text-amber-700',
  MANAGER:     'bg-sky-100 text-sky-700',
  CASHIER:     'bg-emerald-100 text-emerald-700',
  waiter:      'bg-violet-100 text-violet-700',
};
```
+ `text-rose-600`, `text-emerald-600` partout dans `UserDetailPage.tsx:68,90,102,115,116,180,188,196`. Aucun token semantic utilisé. **Pendant ce temps**, `POStatusBadge.tsx` fait correctement (`bg-warning-soft`, `text-success`, etc.). Drift entre features.

### 🟠 Élevés (frustration user notable)

**E1. 142 occurrences de palette Tailwind hardcodée dans 53 fichiers**
Pattern grep : `\b(bg|text|border)-(red|green|blue|emerald|rose|sky|amber|violet|fuchsia)-(50|100|200|300|400|500|600|700|800|900)\b`. Top offenders :
- `StockMovementsPage.tsx:115` → `text-success/text-danger` ✓ correct
- `BalanceSheetPage.tsx:48-50` → `bg-green-50 border-green-200 text-green-800 / bg-red-50 border-red-200 text-red-800` ✗
- `ProfitLossPage.tsx:41` → `text-red-500` ✗
- `OpnameStatusBadge.tsx:9-12` → `bg-blue-100 text-blue-700`, `bg-amber-100`, `bg-emerald-100`, `bg-rose-100` (devrait copier `POStatusBadge.tsx`)
- `ScheduleSlotCell.tsx:22-35` → 10 occurrences mix `bg-gray-400`, `bg-blue-500`, `bg-emerald-500`, `bg-red-500`, `bg-amber-500` + tones pâles 50/700
- `RecipeVersionHistory.tsx:103-105` → 4 occurrences `text-emerald-600 bg-emerald-50` `text-red-600 bg-red-50` `text-amber-600 bg-amber-50` + variantes `dark:bg-*-950/30`

**E2. 12 occurrences de Tailwind `dark:` classes — incompatibles avec le système variable-based**
Le SKILL `app-design-specialist` warning explicite : *« This project uses CSS custom properties (var(--surface-0), var(--gold), etc.) for theming — this IS the dark mode system. Do not add Tailwind dark: classes; they conflict with the project's variable-based approach. »* Sources :
- `apps/backoffice/src/features/customers/components/CustomerCategoryChip.tsx` (7 occurrences) — toute la table TONES utilise `dark:text-*-300`
- `apps/backoffice/src/features/inventory-production/components/RecipeVersionHistory.tsx` (4 occurrences)
- `apps/backoffice/src/pages/customers/CustomersListPage.tsx` (1 occurrence)

Le BO étant en `theme-backoffice` cream (light), ces classes `dark:` sont **dead code** et trompent quiconque tente de comprendre le système. Cohérence ↓.

**E3. ~28 pages utilisent `Loading…` texte au lieu de skeleton**
`grep "Loading…|Loading mappings…|Loading users…"` ⇒ 66 occurrences / 30 fichiers. `DataTable` primitive a déjà `isLoading?: boolean` avec skeleton rows built-in (`DataTable.tsx:177-189`). Les pages qui consomment `DataTable` sont OK (Movements, Customers, Expenses). Les pages qui font une table HTML manuelle (`MappingsPage`, `BalanceSheetPage`, `ProfitLossPage`, `CashFlowPage`, `StockVariancePage`, `UsersTable`, `UserDetailPage`, `CategoriesPage`) affichent du texte → layout shift à chaque chargement.

### 🟡 Moyens (polish + cohérence)

**M1. Toggle switches custom (GeneralPanel.tsx, BoulangerModeToggle.tsx) au lieu d'une primitive `Switch`**
`packages/ui/src/primitives/` ne contient pas de `Switch.tsx` (alors qu'il a `Tabs`, `Dialog`, `Sheet`, `ScrollArea`, `Toast`). Du coup, chaque feature qui en a besoin réimplémente un toggle button `role="switch"` à la main (`GeneralPanel.tsx:254-278`). Le toggle DOM HTML/CSS est correct (aria-checked, focus-visible, motion) mais c'est de la duplication.

**M2. text-[10px] / text-[11px] / text-[9px] systématique (83 occurrences / 41 fichiers)**
Section labels et badges utilisent presque tous `text-[10px] uppercase tracking-widest` ou `text-[11px]`. Le design system a `--type-xs: 0.6875rem` (= 11px) et déjà une primitive `SectionLabel` (`packages/ui/src/components/SectionLabel.tsx`). Mais les features préfèrent inliner `text-[10px]`. À 10px on est aussi en dessous du seuil WCAG AA pour la lisibilité agréable.

**M3. 4 hardcoded hex dans recharts charts (acceptable mais nettoyable)**
`SalesByCategoryPage.tsx`, `SalesByHourPage.tsx`, `RecipeCostTimelinePage.tsx`, `SalesVelocityChart.tsx` : `stroke="#e5e7eb"`, `fill="#c89b4f"`, `stroke="#d4a437"`. Recharts ne lit pas les CSS variables nativement — mais on peut utiliser `getComputedStyle(document.documentElement).getPropertyValue('--gold-base')` ou injecter via prop. Faible priorité.

**M4. UserDetailPage : input PIN brut sans primitive Input**
`UserDetailPage.tsx:154-174` : `<input type="password" className="w-40 px-2 py-1.5 text-sm bg-bg-base border border-border-subtle rounded font-mono">`. La primitive `Input` (avec `h-touch-min` + focus-visible + token cohérent) existe — pourquoi ce champ ne l'utilise pas ? Probablement parce que la primitive a `h-touch-min` (44px) jugé "trop grand" pour ce input compact. Réponse : ajouter une variant `size="sm"` à la primitive ou utiliser `cn(inputBaseClass, 'h-9')`.

**M5. CategorySortableRow status pill bypasse les tokens**
`CategorySortableRow.tsx:59` : `bg-green-100 text-green-700` au lieu de `bg-success-soft text-success`. Pattern repeat de E1.

**M6. Inline `<select>` natifs au lieu d'une primitive Select**
`GeneralPanel.tsx:71-80`, `CategoriesPage.tsx`, multiple modals. Pas de `Select` dans `packages/ui/src/primitives/`. Du coup chaque consommateur réimplémente : `className="h-touch-min w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"`. **Manque dans le design system** — Radix Select primitive devrait être vendue.

**M7. CustomerCategoryChip avec couleurs hardcodées et `dark:` variants**
`CustomerCategoryChip.tsx:13-21` : mapping slug → couleur en dur. Devrait piocher depuis `customer_categories.color` côté DB (qui existe d'après les S14) avec un fallback FALLBACK. Aujourd'hui ajouter une nouvelle catégorie nécessite de modifier le code.

### 🟢 Bas (info)

**B1. var(--bg-overlay, rgba(0,0,0,0.04)) fallback dans DnD rows**
`CategorySortableRow.tsx:29`, `RecipeRowSortable.tsx:40` : `backgroundColor: 'var(--bg-overlay, rgba(0,0,0,0.04))'`. Le fallback `rgba` est tellement light qu'il ne sera jamais utilisé en pratique (`--bg-overlay` est défini dans `luxe-dark.css` + `colors.css`). Sécuritaire mais ajoute du bruit.

**B2. Pas de `Skeleton` primitive vendue**
Le projet a `animate-pulse` ad-hoc en quelques endroits (`DataTable.tsx:185`) mais pas de `Skeleton` reusable. Toutes les pages devraient pouvoir importer `<Skeleton className="h-4 w-1/3" />` au lieu de `<div className="h-4 w-1/3 bg-bg-overlay animate-pulse rounded" />`.

**B3. Toaster monté au App.tsx mais pas exposé partout**
`apps/backoffice/src/App.tsx:34` : `<Toaster />` global ✓. Mais beaucoup de mutations affichent leurs erreurs via `<div role="alert">` inline plutôt que de pousser un toast. Convention non standardisée.

**B4. Pas de `loading.tsx` / Suspense boundaries route-level**
La logique de loading est dispersée dans chaque page. Une page entière qui charge affiche `null` ou `Loading…` au lieu d'un layout shell + skeletons. À investiguer pour Session 28+.

**B5. Bouton ghostDestructive existe (`Button.tsx:16`) mais peu utilisé**
La variant `ghostDestructive` (`bg-transparent text-red hover:bg-red-soft`) est définie mais `UserDetailPage:100-105` réimplémente avec `text-rose-600 hover:text-rose-700`. Drift.

---

## Détails par pilier

### 1. Cohérence design system

**Inventaire des tokens (`packages/ui/src/tokens/`)** :
- `luxe-dark.css` → dark base (#0a0a0c, gold #c9a557, surfaces 4 layers, borders, semantic green/red/blue/amber)
- `colors.css` → numeric surface scale 0-4 + theme override `.theme-backoffice` (cream/ivoire #f7f3ec page bg, white #ffffff cards)
- `semantic.css` → aliases `--success`, `--warning`, `--danger`, `--info` + soft variants
- `spacing.css` → 4-px base scale + `--gutter-card/page/section` semantic
- `typography.css` → 4 fonts canoniques (Playfair display, Inter body, Fraunces data, JetBrains mono) + type scale + tracking
- `elevation.css`, `motion.css`, `payment.css` → tokens domaine spécifiques

**Hardcoded count app-side** :
- Hex `#xxx` : 8 occurrences / 4 fichiers (recharts uniquement)
- `rgb()/hsl()` : 2 occurrences (DnD fallbacks)
- Tailwind palette `(red|green|...)-500` etc. : **142 occurrences / 53 fichiers** ← gros morceau
- `dark:` classes : 12 occurrences / 3 fichiers
- `text-[Npx]` arbitrary : 83 occurrences / 41 fichiers
- `min-h-[Npx]`, `w-[Npx]` : déjà comptés ci-dessus

**Tailwind preset OK** : `packages/ui/tailwind-preset.ts` mappe correctement `bg-success`, `text-danger`, `border-gold` vers les CSS variables. Le problème est l'**adoption** dans `apps/backoffice/src/`, pas la définition.

### 2. shadcn primitives

**0 import direct depuis npm** ✓ confirmé. Pattern grep `from\s+['"](@radix-ui|shadcn-ui|@shadcn/ui)` → 0 match dans `apps/backoffice/src/`. Tout passe par `@breakery/ui`. **Excellent isolement.**

Primitives vendues sous `packages/ui/src/primitives/` (11 fichiers) :
- Badge, Button, Card, **Dialog** (Radix-backed), EmptyState, Input, ScrollArea, Separator, **Sheet** (Radix-backed), Tabs, Toast.
- **Manquant** : `Select`, `Switch`, `Skeleton`, `Tooltip`, `Popover`, `DropdownMenu`, `Combobox`, `Calendar/DatePicker` — features les implémentent à la main.

### 3. Focus-trap S22

`tools/eslint-rules/no-raw-modal-overlay.mjs` configurée en `'error'` dans `eslint.config.mjs:42`. Détecte :
1. `className="… fixed inset-0 …"` (tokens whitespace-separated)
2. `style={{ position: 'fixed', inset: 0 | '0' }}`

**Résultats grep `fixed inset-0` dans `apps/backoffice/src/`** : 1 match — un commentaire (`MarginWatchPage.tsx:197` : "replaced raw `fixed inset-0` overlay div with focus-trapped Dialog"). **0 violation réelle. LOCKED.**

`Dialog` primitive (`packages/ui/src/primitives/Dialog.tsx`) :
- Radix-backed (focus-trap, ESC, scroll-lock gratis)
- Backdrop `fixed inset-0 z-50 bg-backdrop backdrop-blur-md` ← seul raw-overlay autorisé, exempt via `packages/ui/**`
- Motion-reduce respecté (`motion-reduce:animate-none`)
- Close button avec `aria-label="Close"` + focus ring gold
- All used uniformly: CreateB2bOrderModal, RecordB2bPaymentModal, CategoryFormDialog, ReceiveModal, AdjustModal, WasteModal, MappingEditDialog, etc.

### 4. Layouts

**BackofficeLayout.tsx** (`apps/backoffice/src/layouts/BackofficeLayout.tsx`) — 30 lignes :
- `h-screen flex` shell desktop-first ✓
- Sidebar fixe-gauche + Topbar + main scrollable ✓
- `theme-backoffice` class appliquée au top-level ✓
- `id="main-content" tabIndex={-1}` pour SkipToContent ✓
- **Manque** : pas de breakpoint mobile (`< md` ne change rien)

**Sidebar.tsx** :
- Groupes structurés `Operations | Management | Admin` ✓
- Section labels SectionLabel reused ✓
- Items permission-filtered via `useAuthStore.hasPermission` ✓
- Active state `bg-gold-soft text-gold border-r-2 border-gold` cohérent ✓
- Indented sub-items (`pl-9 pr-4 text-xs`) lisibles ✓
- AlertsBadge conditionnel ✓
- **Manque** : `w-60` fixe, pas de collapse, pas de hamburger sur mobile

**Topbar.tsx** :
- Slim chrome 56px (h-14) ✓
- User chip + avatar gold-soft + role caps ✓
- Logout button cohérent ✓
- Refresh + last-updated indicator avec `aria-live="polite"` ✓
- **OK pas de drift**

### 5. Tableaux

**Pattern excellent dans `DataTable` primitive** (`packages/ui/src/components/DataTable.tsx`) :
- Generic over row type ✓
- Sort indicator + `aria-sort` ✓
- Skeleton rows loading ✓
- EmptyState integrated ✓
- Striped + hover ✓
- testid + sticky-ready

**Pages consommatrices `DataTable`** : ExpensesListPage, CustomersListPage, StockMovementsPage, PurchaseOrdersListPage, OpnameListPage. **Pages avec table HTML brute** : BalanceSheetPage, ProfitLossPage, CashFlowPage, StockVariancePage, BasketAnalysisPage, AuditPage, RecipeCostOverviewPage, MappingsPage, CategoriesPage, UsersTable, B2BPaymentsPage. → ~50% des pages tableaux bypass la primitive.

**Pas d'export CSV/PDF** systématique. `ExpensesListPage.tsx` importe `Download` icon mais aucun handler implémenté. `ProfitLossPage`, `BalanceSheetPage`, etc. : pas de bouton export.

**Pas de sticky headers** dans les tables HTML brutes. La primitive `DataTable` non plus n'a pas de `sticky` thead. À ajouter pour les longues tables (PermissionMatrix uses `sticky left-0` manuel).

### 6. Modales / Dialogs

**Pattern excellent** : tous les composants `*Modal.tsx` et `*Dialog.tsx` (~25 fichiers) consomment `Dialog` depuis `@breakery/ui`. Examinés :
- `CategoryFormDialog`, `NewProductDialog`, `RecordB2bPaymentModal`, `CreateB2bOrderModal`, `RefundOrderModal`, `MappingEditDialog`, `RoleChangeDialog`, `DeleteUserDialog`, `UserFormDialog`, `ReceiveModal`, `WasteModal`, `AdjustModal`, `YieldVarianceModal`, `RecipeDuplicateModal`, `RevertProductionDialog`.

**Confirm patterns destructive** : `DeleteUserDialog` utilise `Button variant="ghost"` rouge inline (manque variant `destructive` first-class — drift M5). **Pas de double-confirm** systématique (pas de "tapez SUPPRIMER pour confirmer") sur les actions destructives.

**Submit en cours** : la plupart des modals ont `disabled={isPending}` + texte "Saving…" / "Recording…". Pas de spinner SVG primitive.

### 7. Dark mode

BO est en `theme-backoffice` (cream). Le système `dark mode` n'est techniquement pas activé sur le BO — les tokens cream override toutes les variables dark. Donc :
- Pas de problème de contraste dark/light puisque seule la version light est rendue
- Les 12 classes `dark:*` sont dead code (E2)
- Le système est **prêt pour un dark BO** si jamais (juste retirer `theme-backoffice` du shell), mais aucun toggle UI n'est exposé

### 8. Responsive

**Desktop-first par design** assumé. Mais :
- Sidebar non-collapsible (C1)
- Aucun `md:hidden` / `lg:flex` dans Sidebar/Topbar/BackofficeLayout
- Pages cards utilisent bien `grid grid-cols-1 md:grid-cols-3 gap-4` (BalanceSheet) ou `xl:grid-cols-4` (StockMovements KPI) ✓
- Modals : `max-w-lg` par défaut (Dialog.tsx:37) — OK desktop, peut-être trop large sur tablette portrait
- Touch targets ≥ 44px : ✓ via `h-touch-min` / `h-touch-comfy` dans Button + Input primitives (44px / 56px définis dans luxe-dark.css)
- Capacitor mobile shell : pas explicitement testé, BO est web-first

### 9. Skeleton loaders & loading states

**Bonne base** :
- `DataTable.tsx:177-189` rend `loadingRowCount=5` skeleton rows avec `animate-pulse` ✓
- `Dashboard.tsx` : KPI tiles ont une zone réservée ✓ (mais pas de skeleton dans les Card placeholders)

**Manque** :
- Pas de primitive `Skeleton` réutilisable
- Pages avec tables brutes → `Loading…` text (66 occurrences)
- Pas de Suspense boundary route-level → première peinture entièrement vide

### 10. Accessibility (WCAG AA)

**OK** :
- `SkipToContent` mount global (`App.tsx:29`) → tab pour passer chrome ✓
- `Dialog` Radix → focus-trap + ESC + scroll-lock + initial focus ✓
- `Input.tsx`, `Button.tsx` : `focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold` cohérent ✓
- `motion-reduce:` respecté dans Dialog et Button ✓
- `role="status"` / `role="alert"` / `aria-live="polite"` utilisés dans 30 fichiers (Topbar, Dashboard, error containers)
- `aria-sort` correct dans DataTable header (`DataTable.tsx:140-148`)
- ID matching label via `useId()` (RecordB2bPaymentModal, NewExpensePage etc.) ✓
- BackofficeLayout `main` a `tabIndex={-1}` + `id="main-content"` ✓
- Toggle switches `role="switch" aria-checked` correctement implémentés où utilisés (M1)

**Manque** :
- Beaucoup de boutons icon-only sans `aria-label` explicite dans certaines features (à grepper systématiquement Session 28+)
- Pas de check de contraste WCAG documenté pour `theme-backoffice` cream (à audit manuel avec contrast checker)
- `aria-describedby` pour erreurs form pas systématique — la plupart des modals affichent une `<div role="alert">` séparée mais l'input ne pointe pas dessus
- `tabindex` order : à vérifier dans les modals complexes (CreateB2bOrderModal avec items dynamiques)

### 11. Inconsistances visuelles

- **Spacing** : `space-y-6`, `gap-4`, `p-6` cohérents généralement, mais `padding="md"` (= p-6) vs `Card` sans padding + `<div className="p-4">` mélangés selon les pages
- **Typography scale** : `font-serif` (Fraunces) pour titres `h1`, mais 50% des pages utilisent `font-display` (Playfair) pour h2, l'autre 50% utilise `font-serif`. Pas de règle unique. Ex: GeneralPanel.tsx:46 `font-display text-xl`, BalanceSheetPage h2 `text-sm font-medium`.
- **Iconographie** : Lucide partout ✓ cohérent
- **Couleurs status** : drift majeur entre `bg-success/text-success` (POStatusBadge) et `bg-emerald-100/text-emerald-700` (OpnameStatusBadge, UsersTable)
- **Currency** : `Currency` primitive utilisée dans 50% des cas, `formatIdr` util utilisé dans l'autre 50%, parfois `toLocaleString()` brut (BalanceSheetPage)

---

## Recommandations design system (Top 10 polish prioritisées)

1. **Faire la sweep "kill the palette"** — remplacer les 142 `bg-red-500 / text-emerald-600 / ...` par les tokens semantic (`bg-danger-soft / text-success / ...`). Ajouter une ESLint rule `breakery-local/no-tailwind-palette` qui interdit `(bg|text|border)-(red|green|blue|...)-(50-900)` hors `packages/ui/`.
2. **Tuer les 12 classes `dark:`** — dead code. Sweep + retirer.
3. **Sidebar responsive** : `Sheet` Radix sur `< lg` + hamburger dans Topbar. Existing primitive `Sheet.tsx` à consommer.
4. **Vendre 4 primitives manquantes** : `Select`, `Switch`, `Skeleton`, `Tooltip`. Radix existant déjà sub-dependency.
5. **Migrer 11 pages de tableaux bruts vers `DataTable`** — BalanceSheet, ProfitLoss, CashFlow, StockVariance, BasketAnalysis, Audit, RecipeCostOverview, Mappings, Categories, UsersTable, B2BPayments. Hérite skeleton + sort + empty + export gratis.
6. **OpnameStatusBadge** → réécrire en copie de POStatusBadge avec semantic tokens. Quick win.
7. **Sticky thead** dans `DataTable` primitive (CSS `position: sticky; top: 0; z-index: 1`).
8. **Export CSV/PDF helper** dans `packages/utils` consommé par `DataTable` (icon + handler).
9. **Standardiser Toast vs inline error** : règle "mutations → Toast, validation form → inline `aria-describedby`".
10. **Documenter dans `packages/ui/README.md`** : règles d'usage tokens, primitives disponibles, anti-patterns (dark: classes, palette Tailwind brute, raw modals). Aujourd'hui l'historique vit dans les commentaires top-of-file — à condenser.

---

## Annexes

### A1 — Inventaire des pages BO avec statut UI

Légende : ✅ = design system cohérent, ⚠ = drift partiel (palette Tailwind, table brute ou loader text), ❌ = bypass majeur (UsersTable-style)

**Pages racine** (`apps/backoffice/src/pages/*.tsx`) :
| Page | Statut | Notes |
|---|---|---|
| `Dashboard.tsx` | ⚠ | KPI tiles + EmptyState OK, `min-h-[280px]` arbitrary |
| `Login.tsx` | ✅ | Hors layout |
| `Products.tsx` | ⚠ | Table brute |
| `Promotions.tsx` | ⚠ | `text-[10px]` ad-hoc |
| `Suppliers.tsx`, `TransferDetail/Form/List.tsx`, `Inventory.tsx`, `IncomingStock.tsx`, `Loyalty.tsx`, `ComingSoon.tsx` | ⚠ | Mixte |

**Pages catégorisées** (61 fichiers) — résumé par dossier :
| Dossier | Pages | Statut global |
|---|---|---|
| `accounting/` | 1 (MappingsPage) | ⚠ table brute + `Loading…` text |
| `btob/` | 3 | ⚠ palette Tailwind + `text-[10px]` |
| `categories/` | 1 | ⚠ DnD bonne, badge brute |
| `customers/` | 2 | ❌ `dark:` classes |
| `expenses/` | 3 | ✅ Uses DataTable + EmptyState |
| `inventory/` | 11 | ⚠ ScheduleSlotCell hardcoded palette |
| `lan-devices/` | 1 | non-audité |
| `marketing/` | 4 | ⚠ palette Tailwind |
| `print-queue/` | 1 | ✅ semantic tokens |
| `products/` | 2 | ✅ GeneralPanel patterns bons (sauf `text-[10px]`) |
| `purchasing/` | 3 | ✅ POStatusBadge canonical |
| `reports/` | 11 | ⚠ Tables brutes + palette Tailwind 50-800 |
| `settings/` | 6 + 1 (security) | ✅ SettingsHubPage tile pattern propre |
| `suppliers/` | 1 | non-audité |
| `users/` | 4 | ❌ UsersTable + UserDetailPage hardcoded palette |

### A2 — Inventaire composants signature

**Primitives `packages/ui/src/primitives/`** (11) : Badge, Button, Card, **Dialog**, EmptyState, Input, ScrollArea, Separator, **Sheet**, Tabs, Toast — tous Radix-backed pour ceux concernés.

**Composites `packages/ui/src/components/`** (~38) : DataTable, KpiTile, EmptyState pattern, BrandMark, Currency, IngredientPicker, Numpad family, CenterModal/FullScreenModal (wrappers Dialog), TenderListBuilder, SkipToContent, Stat, IdleWarningToast, etc.

**Features BO** (27 dossiers) :
- `auth`, `users`, `categories`, `customers`, `products`, `combos`, `promotions`, `loyalty`, `marketing` (cohorts/segments/promo-roi/birthday)
- `inventory*` (5 dossiers : alerts, dashboard, movements, opname, production, transfers)
- `recipes`, `accounting-mappings`, `purchasing`, `suppliers`, `expenses`, `btob`, `sections`, `reports`, `settings`, `print-queue`, `lan-devices`

### A3 — Tokens design system actuels

**Surfaces (POS/dark)** : `--surface-0: #0c0c0e` → `--surface-4: #25252a`
**Surfaces (theme-backoffice/cream)** : `--surface-0: #f7f3ec` (cream) → `--surface-4: #f1ebe0`
**Gold** : `#c9a557` base + scale (hover, pressed, soft, strong, fg)
**Text (BO)** : `#1a1408` primary → `#c8baa0` disabled
**Semantic** : success (green), warning (amber), danger (red), info (blue) + soft variants à 10-18% alpha
**Type scale** : xs=11px / sm=13px / base=15px / lg=17px / xl=22px / 2xl=28px / 3xl=36px / display=48px
**Fonts** : Playfair Display (display) / Inter (body) / Fraunces (data/KPI) / JetBrains Mono (data tables, montants)
**Tracking widest** : 0.12em (signature uppercase labels)
**Radius** : 4 / 6 / 8 / 12 / 16 px
**Touch** : 44 / 56 / 80 px
**Spacing** : tokens 0-32 (4px base) + semantic `--gutter-card` / `--gutter-page` / `--gutter-section`
**Motion** : `--motion-fast/base/slow` + `--motion-ease-out/in`

---

**Conclusion auditeur** : le design system V3 est **mature côté fondations** (tokens, primitives, ESLint lockdown S22) — c'est l'**adoption** qui drifte. Une session de sweep ciblée (Top 5 recommandations, 1-2 jours) ferait remonter le score de 63 → 85+. La sidebar responsive et la migration vers `DataTable` sont les deux victoires `🔴` à prioriser pour débloquer la persona gérante tablette + densifier les pages reports/accounting.
