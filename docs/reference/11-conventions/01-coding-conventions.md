# 01 — Coding conventions

> **Last verified**: 2026-05-03

Cette page consolide les règles de nommage, d'organisation et de qualité du code V2. Elle complète `CLAUDE.md` (section "Coding Conventions") avec des exemples bons / mauvais issus du code réel `src/`.

---

## 1. Tableau de synthèse

| Élément | Convention | Exemple correct | Exemple à éviter |
|---|---|---|---|
| Composant React | `PascalCase.tsx` | `ProductCard.tsx`, `ModuleErrorBoundary.tsx` | `productCard.tsx`, `product-card.tsx` |
| Hook custom | `useCamelCase.ts` | `useActiveUsers.ts`, `useB2BOrders.ts` | `UseActiveUsers.ts`, `getActiveUsers.ts` |
| Service | `camelCase.ts` ou `domainCamelCase.ts` | `arService.ts`, `printService.ts` | `AR_Service.ts` |
| Store Zustand | `camelCaseStore.ts` | `cartStore.ts`, `authStore.ts` | `Cart.store.ts`, `cart_store.ts` |
| Fonction / variable | `camelCase` | `handleSubmit`, `totalAmount` | `HandleSubmit`, `total_amount` |
| Constante module-level | `UPPER_SNAKE` quand vraie constante | `MAX_RETRIES = 3` | `maxRetries` (si réellement immuable) |
| Interface | Préfixe `I` | `IProduct`, `IB2BOrder` | `Product`, `ProductInterface` |
| Type alias | Préfixe `T` | `TOrderStatus`, `TPaymentMethod` | `OrderStatusType` |
| Enum DB (TS mirror) | Préfixe `T`, suffixe selon contexte | `TOrderType`, `TItemStatus` | `ORDER_TYPE` |
| Colonne DB | `snake_case` | `created_at`, `customer_id` | `createdAt` |
| Table DB | `snake_case` pluriel | `order_items`, `purchase_orders` | `OrderItems`, `order_item` |
| Clé primaire | `id` UUID | `id uuid primary key` | `order_id` (pour l'auto-id) |
| Clé étrangère | `{table_singular}_id` | `customer_id`, `purchase_order_id` | `id_customer`, `customerId` |
| Test | `*.test.ts` co-localisé | `cartCalculations.test.ts` | `tests/cart-calc.spec.ts` |

---

## 2. TypeScript — strict mode

`tsconfig.json` impose :

```json
{
  "strict": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noFallthroughCasesInSwitch": true,
  "forceConsistentCasingInFileNames": true
}
```

**Conséquences pratiques :**

- `noImplicitAny` est implicite via `strict`. **Aucun `any` toléré** dans `src/` (Sprint 1 S7 a éliminé les 40 derniers).
- Variables / paramètres non utilisés cassent le build → préfixer `_` pour ignorer (`function fn(_unusedArg) {}`).
- Switch sans `break` ni `return` au cas suivant échoue le build.
- Casing cohérent obligatoire — `import { foo } from './Foo'` et `from './foo'` lèvent erreur sur Linux/CI.

**Exception ESLint** : `@typescript-eslint/no-explicit-any` est `warn` (pas `error`) globalement, désactivé dans `**/__tests__/**` et `**/*.test.{ts,tsx}` pour les mocks.

---

## 3. ESLint — règles clés

Source : `eslint.config.js`. Limite globale : `--max-warnings 80` (objectif T9 = baisser ce seuil).

| Règle | Niveau | Pourquoi |
|---|---|---|
| `react/react-in-jsx-scope` | `off` | React 18 + JSX runtime auto, plus besoin d'importer React |
| `react-hooks/exhaustive-deps` | `warn` | Force la déclaration des dépendances, mais n'échoue pas le build |
| `@typescript-eslint/no-unused-vars` | `warn` | Ignore les args préfixés `_` (`argsIgnorePattern: '^_'`) |
| `@typescript-eslint/no-explicit-any` | `warn` | Exception `off` dans tests pour faciliter les mocks |

**Globally ignored** (ne sont pas lintés) :
`dist/`, `dev-dist/`, `android/`, `node_modules/`, `*.config.{js,ts}`, `**/*.backup.ts`, `_legacy/`, `print-server/`, `artifacts/`, `scripts/`, `supabase/functions/` (ESLint flat config ne couvre pas Deno), `docs/`, `.agent/`, `.agents/`, `.claude/worktrees/`, `.cleanup-quarantine/`, `archive/`, `breakery-platform/`, `apps/`, `packages/`.

> Le hook `auto-lint.sh` (PostToolUse Edit/Write) lance `eslint --fix` automatiquement après chaque sauvegarde de fichier `.ts`/`.tsx`. Le hook `protect-files.sh` bloque toute modification sur `.env`, lock files, `database.generated.ts`.

---

## 4. Path alias

Source : `tsconfig.json` + `vite.config.ts`.

```ts
"paths": {
  "@/*": ["src/*"]
}
```

**Toujours** utiliser `@/` pour les imports cross-module dans `src/`.

```ts
// ✅ Bon
import { supabase } from '@/lib/supabase'
import { useActiveUsers } from '@/hooks/useActiveUsers'
import type { IProduct } from '@/types/database'

// ❌ Mauvais (chemin relatif fragile)
import { supabase } from '../../../lib/supabase'
```

**Exception** : pour des fichiers très proches (même dossier ou parent immédiat), le relatif reste lisible :

```ts
// Acceptable dans src/components/pos/POSTerminalWrapper.tsx
import { ProductGrid } from './ProductGrid'
import { CartPanel } from '../cart/CartPanel'
```

---

## 5. Imports — ordre conventionnel

Pas de plugin ESLint qui force l'ordre, mais convention observée dans le code :

```ts
// 1. React + libs externes
import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'

// 2. Imports `@/` (alias)
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { Button } from '@/components/ui/button'

// 3. Imports de types (séparés si possible avec `import type`)
import type { IProduct, TOrderStatus } from '@/types/database'

// 4. Imports relatifs (proches)
import { ProductCardSkeleton } from './ProductCardSkeleton'
```

**Règle** : `import type` quand on importe uniquement des types (réduit le bundle et clarifie l'intention).

---

## 6. Bons / mauvais snippets — composants

### Composant fonction nommé + named export

```tsx
// ✅ src/components/products/ProductCard.tsx
import type { IProduct } from '@/types/database'

interface IProductCardProps {
  product: IProduct
  onSelect: (product: IProduct) => void
  isSelected?: boolean
}

export function ProductCard({ product, onSelect, isSelected = false }: IProductCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(product)}
      aria-pressed={isSelected}
      className="..."
    >
      {product.name}
    </button>
  )
}
```

### À éviter

```tsx
// ❌ default export anonyme + props non typées
export default function (props) {           // pas de nom → DevTools illisibles
  return <div onClick={props.onSelect}>     // div cliquable sans rôle a11y
    {props.product.name}                    // pas d'optional chaining
  </div>
}
```

---

## 7. Bons / mauvais snippets — types

```ts
// ✅ Interface I-prefixed pour entités
export interface IB2BOrder {
  id: string
  order_number: string         // snake_case car miroir DB
  customer_id: string
  status: TOrderStatus         // type union réutilisé
  total_amount: number
}

// ✅ Type T-prefixed pour unions / alias
export type TOrderStatus =
  | 'draft'
  | 'confirmed'
  | 'processing'
  | 'ready'
  | 'partially_delivered'
  | 'delivered'
  | 'cancelled'
```

```ts
// ❌ Pas de préfixe → ambigu, conflit possible avec composant
export interface Order { ... }              // collision visuelle avec un composant <Order />

// ❌ camelCase pour colonnes DB → casse le mapping Supabase
export interface IOrder {
  orderNumber: string                       // la DB renvoie order_number
}
```

---

## 8. Naming des fichiers de tests

Tests co-localisés `*.test.ts` à côté du fichier testé :

```
src/services/cart/cartCalculations.ts
src/services/cart/cartCalculations.test.ts
src/hooks/__tests__/useActiveUsers.test.ts   # ou regroupés sous __tests__/
```

Voir [`09-testing/01-test-strategy.md`](../09-testing/01-test-strategy.md) pour la stratégie complète.

---

## 9. Conventions DB ↔ TS

| Élément SQL | Mapping TS |
|---|---|
| `order_items` (table) | `IOrderItem` (interface), `OrderItem` jamais utilisé seul |
| `created_at timestamptz` | `created_at: string` (Supabase JSON sérialise en ISO 8601) |
| `total numeric(12,2)` | `total: number` (attention précision — pour le calcul comptable, formater côté DB) |
| Enum SQL `order_status` | `TOrderStatus` dans `src/types/database.enums.ts` |
| RPC `complete_order_with_payments` | Auto-typé via `database.generated.ts` (ne pas redéclarer manuellement) |

> **Rappel pitfall** : après toute migration touchant le schéma, lancer `/gen-types` (cf. [`06-pitfalls.md`](./06-pitfalls.md)). Le hook `protect-files.sh` interdit l'édition manuelle de `database.generated.ts`.

---

## 10. Liens

- [`02-file-organization.md`](./02-file-organization.md) — taille fichiers, exports, structure dossiers
- [`03-react-patterns.md`](./03-react-patterns.md) — hooks, error boundaries, lazy
- [`04-supabase-patterns.md`](./04-supabase-patterns.md) — `select`, RPC, realtime
- [`05-error-handling.md`](./05-error-handling.md) — boundaries, toasts, Sentry
- [`06-pitfalls.md`](./06-pitfalls.md) — pièges connus
- [`../03-database/02-tables-reference.md`](../03-database/02-tables-reference.md) — référence colonnes
