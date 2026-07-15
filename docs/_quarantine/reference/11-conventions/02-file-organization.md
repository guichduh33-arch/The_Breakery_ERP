<!-- STALE-V2 -->
> ⚠️ **DOC HISTORIQUE — PÉRIMÉE (V2), NE FAIT PLUS FOI.** Ce fichier décrit en grande partie l'architecture **V2** (mono-app AppGrav, npm/Vercel, PWA/Capacitor, projet Supabase `abjabuniwkqpfsenxljp` = **prod incompatible**, versions RPC obsolètes). **Ne jamais l'appliquer tel quel** (migration, config, archi). Sources de vérité actuelles : `CLAUDE.md` (patterns + workplan) et `docs/workplan/remise-a-plat/` (référence modules réel-vs-demandé). Hiérarchie complète : `docs/README.md`. Régénération depuis le code prévue en Phase 3.

# 02 — File organization

> **Last verified**: 2026-05-03

Cette page documente comment **organiser** un fichier (taille, exports, co-location) et **où** poser un nouveau fichier dans `src/`.

---

## 1. Taille maximale par fichier — 300 lignes

Règle inscrite dans `CLAUDE.md` (section "Coding Conventions"). Au-delà de 300 lignes, **décomposer**.

**Pourquoi** :

- Les fichiers > 300 lignes mélangent presque toujours plusieurs responsabilités.
- Les revues `/bmad-code-review` et `code-review` lèvent des warnings sur les gros fichiers.
- Le contexte LLM (création de stories, dev) consomme inutilement des tokens.
- L'audit `docs/audit/03-code-quality-schema-audit.md` a identifié **7 fichiers > 500 lignes** à décomposer (item T4 du backlog `CURRENT_STATE.md`).

**Comment décomposer** :

| Pattern | Découpage |
|---|---|
| Composant page > 300 lignes | Extraire sous-composants dans un dossier `components/` adjacent ou créer `src/components/{feature}/{Page}/` |
| Hook > 300 lignes | Splitter par opération (`useXxxRead`, `useXxxMutations`, `useXxxRealtime`) |
| Service > 300 lignes | Splitter par capacité (`xxxQueries.ts`, `xxxMutations.ts`, `xxxValidation.ts`) |
| Store Zustand > 300 lignes | Slices via `subscribeWithSelector` ou store composé |

**Exemple historique** : `App.tsx` est passé de 527 → 228 lignes en sortant les routes vers 9 fichiers `src/routes/{posRoutes,mobileRoutes,...}.tsx` (Sprint 1 S6).

---

## 2. Named exports — toujours, sauf exception React.lazy

```tsx
// ✅ Named export — auto-completion, refactor sûr, DevTools nommés
export function ProductCard(...) { ... }
export const PRODUCT_CARD_DEFAULT_HEIGHT = 96
```

```tsx
// ❌ Default export — fragmente la nomenclature
export default function (...) { ... }   // anonyme = "default" partout
export default ProductCard               // un import peut renommer arbitrairement
```

**Exception unique** : `React.lazy()` exige un default export. On utilise alors un wrapper :

```ts
// src/pages/reports/ReportsPage.tsx
export function ReportsPage() { ... }
export default ReportsPage   // uniquement pour React.lazy()
```

```ts
// src/routes/adminRoutes.tsx
const ReportsPage = lazy(() => import('@/pages/reports/ReportsPage'))
```

---

## 3. Structure de dossiers `src/`

Vue résumée (cf. [`01-architecture/02-frontend-architecture.md`](../01-architecture/02-frontend-architecture.md) pour le détail) :

```
src/
├── components/    # Par feature : 16 dossiers (accounting, auth, customers, expenses,
│                  #   inventory, kds, lan, mobile, orders, permissions, pos, products,
│                  #   purchasing, reports, settings, ui)
├── pages/         # Par route : 19 dossiers
├── hooks/         # ~150 hooks. Plats si génériques (`useActiveUsers.ts`),
│                  #   regroupés en sous-dossier si feature lourde (`hooks/accounting/...`)
├── services/      # 27 modules métier (auth, settings, promotion, reporting, accounting,
│                  #   b2b, pos, inventory, purchasing, export, print, ...)
├── stores/        # 14 stores Zustand
├── types/         # 19 .ts. Sources de vérité :
│                  #   - database.enums.ts (enums SQL → TS)
│                  #   - database.generated.ts (Supabase auto-gen, NE PAS éditer)
│                  #   - database.ts (interfaces métier)
├── routes/        # 9 fichiers de routes (posRoutes, mobileRoutes, inventoryRoutes,
│                  #   salesRoutes, customerRoutes, productRoutes, accountingRoutes,
│                  #   adminRoutes, index)
├── layouts/       # BackOfficeLayout + layouts modules
├── lib/           # supabase.ts (singleton), utils, sentry.ts
└── utils/         # logger, formatters, helpers partagés
```

---

## 4. Quand créer un sous-dossier dans `components/{feature}/`

| Situation | Action |
|---|---|
| 1-3 composants pour la feature | Plat directement dans `components/{feature}/` |
| > 3 composants + sous-features identifiables | Créer sous-dossier (`components/pos/cart/`, `components/pos/modals/`, `components/pos/cafe-stock/`) |
| Composant utilisé partout (Skeleton, Modal, Button) | `components/ui/` |
| Composant uniquement consommé par 1 page | Inline dans la page **ou** sous-dossier `pages/{module}/{PageName}/components/` |

**Exemple réel — POS** :

```
src/components/pos/
├── POSTerminalWrapper.tsx           # Composant racine
├── ProductGrid.tsx
├── cart/                             # Sous-feature panier
│   ├── CartPanel.tsx
│   ├── CartItem.tsx
│   └── CartLockedBadge.tsx
├── modals/                           # Sous-feature modals POS
│   ├── RefundModal.tsx
│   ├── VariantModal.tsx
│   ├── ModifierModal.tsx
│   └── TransactionOrderRow.tsx
└── cafe-stock/                       # Sous-feature stock café
    └── CafeStockProductCard.tsx
```

---

## 5. Conventions hooks — `useNomDescriptif`

| Pattern | Exemple |
|---|---|
| Lecture d'une ressource | `useProducts`, `useB2BOrders`, `useActiveUsers` |
| Mutation isolée | `useUpdateProduct`, `useDeleteOrder` |
| Lecture + mutations groupées | `useProduction` (expose `.create`, `.update`, `.list`) |
| Hook orchestrateur (dérive état) | `useCartPromotions`, `useCartTotals` |
| Hook UI / DOM | `useIsMobile`, `useSessionTimeout`, `useToast` |

**Règle** : un fichier = un hook public. Les hooks privés helpers se mettent dans le même fichier (sans export) ou dans un fichier `_internal.ts` voisin.

```
src/hooks/accounting/
├── useJournalEntries.ts        # public
├── useTrialBalance.ts          # public
└── _journalHelpers.ts          # privé, pas de hook React
```

---

## 6. Services par domaine

`src/services/` contient **27 modules** métier. Conventions :

- Un dossier par domaine (`services/accounting/`, `services/print/`, `services/lan/`)
- Fichiers découpés par capacité (`accountingQueries.ts`, `accountingMutations.ts`, `journalEntryBuilder.ts`)
- Les services sont **pures functions** (pas de hook, pas de state React)
- Ils sont consommés par les hooks (`useXxx` enveloppe `services/xxx/...`)

```ts
// src/services/cart/cartCalculations.ts — pur
export function calculateCartTotals(items: ICartItem[]): ICartTotals { ... }

// src/hooks/pos/useCartTotals.ts — react
export function useCartTotals() {
  const items = useCartStore(state => state.items)
  return useMemo(() => calculateCartTotals(items), [items])
}
```

---

## 7. Co-location des tests

Les tests vivent **à côté** du code testé :

```
src/services/cart/cartCalculations.ts
src/services/cart/cartCalculations.test.ts

src/hooks/__tests__/useActiveUsers.test.ts   # OU regroupés sous __tests__/
```

Pas de dossier `tests/` racine. Le runner Vitest découvre via la convention `*.test.{ts,tsx}` ou `**/__tests__/*`.

Cf. [`09-testing/05-running-tests.md`](../09-testing/05-running-tests.md).

---

## 8. Routes — un fichier par grand domaine

`src/routes/` contient **9 fichiers** :

| Fichier | Domaine |
|---|---|
| `posRoutes.tsx` | `/pos/*`, `/kds/*`, `/display`, `/tablet/*` |
| `mobileRoutes.tsx` | `/mobile/*` |
| `inventoryRoutes.tsx` | `/inventory/*` |
| `salesRoutes.tsx` | `/orders`, `/b2b/*`, `/expenses/*` |
| `customerRoutes.tsx` | `/customers/*` |
| `productRoutes.tsx` | `/products/*` |
| `accountingRoutes.tsx` | `/accounting/*` |
| `adminRoutes.tsx` | `/reports`, `/users/*`, `/settings/*` |
| `index.tsx` | Composition + route racine |

Toute nouvelle route s'ajoute dans le fichier du domaine, pas dans `App.tsx`.

---

## 9. Liens

- [`01-coding-conventions.md`](./01-coding-conventions.md) — naming, ESLint, TypeScript strict
- [`03-react-patterns.md`](./03-react-patterns.md) — patterns hooks, error boundaries
- [`../01-architecture/02-frontend-architecture.md`](../01-architecture/02-frontend-architecture.md) — vue détaillée `src/`
- [`../09-testing/01-test-strategy.md`](../09-testing/01-test-strategy.md) — stratégie tests Vitest
