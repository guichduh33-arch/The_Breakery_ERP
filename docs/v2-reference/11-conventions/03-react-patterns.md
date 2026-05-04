# 03 — React patterns

> **Last verified**: 2026-05-03

Cette page documente les **patterns React + react-query + Zustand** utilisés dans V2 : hooks custom, error boundaries, lazy loading, memoization, forms, accessibility.

---

## 1. Custom hooks — une responsabilité par hook

Règle : un hook = une question (lecture) ou une action (mutation).

```ts
// ✅ src/hooks/useActiveUsers.ts — lecture isolée
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { UserProfile } from '@/types/database'

export function useActiveUsers() {
  return useQuery({
    queryKey: ['active-users'],
    queryFn: async (): Promise<UserProfile[]> => {
      const { data, error } = await supabase.rpc('get_active_users_for_login')
      if (error) throw error
      return (data ?? []) as UserProfile[]
    },
  })
}
```

```ts
// ✅ Mutation avec invalidation ciblée
export function useUpdateProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; patch: Partial<IProduct> }) => {
      const { data, error } = await supabase
        .from('products')
        .update(input.patch)
        .eq('id', input.id)
        .select('id, name, price, stock_quantity')
        .single()
      if (error) throw error
      return data
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['products'] })
      queryClient.invalidateQueries({ queryKey: ['product', vars.id] })
    },
  })
}
```

**Anti-pattern** : un hook qui fait lecture + 5 mutations + realtime. Splitter en `useXxx`, `useUpdateXxx`, `useDeleteXxx`, `useXxxRealtime`.

---

## 2. ModuleErrorBoundary — un par module

Source : `src/components/ui/ModuleErrorBoundary.tsx` (~100 lignes). Pattern de classe (les error boundaries React doivent être des classes), avec :

- `getDerivedStateFromError` → met `hasError: true`
- `componentDidCatch` → log via `logError` + push Sentry via `reportError`
- `render` fallback : carte + boutons Retry / Home
- Détails techniques visibles **uniquement en dev** (`import.meta.env.DEV`)

### Usage canonique dans une route

```tsx
// src/routes/inventoryRoutes.tsx
import { ModuleErrorBoundary } from '@/components/ui/ModuleErrorBoundary'

<Route
  path="/inventory"
  element={
    <RouteGuard permission="inventory.view">
      <ModuleErrorBoundary moduleName="Inventory">
        <InventoryLayout />
      </ModuleErrorBoundary>
    </RouteGuard>
  }
/>
```

### Règle

**Chaque grand module a son propre boundary**. Si POS plante, Reports continue de fonctionner. Le boundary racine reste un dernier filet (cf. `src/App.tsx`). Liste actuelle des `moduleName` utilisés : `POS`, `Cafe Stock`, `POS Outstanding`, `KDS`, `Tablet`, `Mobile`, `Inventory`, `Customers`, `Products`, `Reports`, `Users`, `Settings`.

### Snippet pattern

```tsx
export class ModuleErrorBoundary extends Component<Props, State> {
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logError(`[${this.props.moduleName}] Error:`, error)
    reportError(error, { componentStack: errorInfo.componentStack ?? undefined })
  }

  render() {
    if (this.state.hasError) return <FallbackUI moduleName={this.props.moduleName} onReset={this.handleReset} />
    return this.props.children
  }
}
```

Voir [`05-error-handling.md`](./05-error-handling.md) pour la stratégie complète.

---

## 3. Lazy loading par page route — `React.lazy`

```tsx
// src/routes/adminRoutes.tsx
import { lazy, Suspense } from 'react'

const ReportsPage = lazy(() => import('@/pages/reports/ReportsPage'))
const UsersPage = lazy(() => import('@/pages/users/UsersPage'))

<Route
  path="/reports"
  element={
    <Suspense fallback={<PageSkeleton />}>
      <ModuleErrorBoundary moduleName="Reports">
        <ReportsPage />
      </ModuleErrorBoundary>
    </Suspense>
  }
/>
```

**Règle** : toute **page** (composant routé) doit être lazy. Les composants utilitaires (`Button`, `Modal`, `Card`) restent en import direct.

> Bénéfice : code-splitting automatique par Vite → bundle initial < 200 KB gz, modules lourds (Recharts, jsPDF, XLSX) ne sont chargés que sur leur route.

---

## 4. Suspense fallback — Skeletons, pas de Spinner global

`src/components/ui/Skeleton.tsx` expose :

- `<Skeleton />` (variante `default | subtle | gold`)
- `<SkeletonCard />`
- `<SkeletonTableRow columns={4} />`
- `<SkeletonChart />`

```tsx
// ✅ Fallback contextuel
<Suspense fallback={<SkeletonChart />}>
  <SalesChart />
</Suspense>

// ❌ Spinner générique : casse la perception de stabilité layout
<Suspense fallback={<div className="loading">...</div>}>
```

---

## 5. Composition vs prop drilling

| Profondeur | Solution |
|---|---|
| 1-2 niveaux | Props directes |
| 3+ niveaux **ou** state partagé entre frères | Zustand store (cf. les 14 stores listés `CLAUDE.md`) |
| State serveur (DB) | react-query (hook custom) |
| Context React | **Évité** sauf cas très ciblé (`VirtualKeypadProvider` dans POS) |

```tsx
// ❌ Prop drilling sur 4 niveaux
<App user={user}>
  <Layout user={user}>
    <Header user={user}>
      <Avatar user={user} />

// ✅ Zustand store
const user = useAuthStore(state => state.user)
```

---

## 6. Memoization — `useMemo`, `useCallback`

**Quand** : vraiment quand ça mesure une différence (calcul lourd, identité d'une dépendance dans un `useEffect`).

```ts
// ✅ Calcul O(n²) sur le panier
const totals = useMemo(
  () => calculateCartTotals(items, promotions),
  [items, promotions]
)

// ✅ Callback passée à composant memoisé enfant
const handleSelect = useCallback(
  (productId: string) => setSelected(productId),
  []
)
```

**Quand pas** : variables primitives, JSX trivial, callbacks utilisées qu'à 1 endroit non memoisé.

```tsx
// ❌ Sur-optimisation
const title = useMemo(() => 'Reports', [])           // string littérale, 0 gain
const onClick = useCallback(() => alert('x'), [])    // callback consommée par <button> natif
```

---

## 7. Forms — controlled simples, react-hook-form pour les complexes

**Forms simples** (1-3 champs, pas de validation lourde) : controlled state local.

```tsx
const [pin, setPin] = useState('')
return <input value={pin} onChange={e => setPin(e.target.value)} />
```

**Forms complexes** (validation, multi-step, soumissions) : react-hook-form + zod (déjà utilisé dans plusieurs modules — settings, b2b, accounting).

```tsx
const { register, handleSubmit, formState: { errors } } = useForm<IB2BOrderInput>({
  resolver: zodResolver(b2bOrderSchema),
})

return <form onSubmit={handleSubmit(onSubmit)}>...</form>
```

**Règle** : pas de `defaultValue` non controlled qui se transforme en controlled à mi-parcours (warning React).

---

## 8. Accessibility — checklist minimale

| Élément | Règle |
|---|---|
| Bouton cliquable | `<button type="button">` ou `<a>`, jamais `<div onClick>` |
| Si vraiment `<div onClick>` | Ajouter `role="button"`, `tabIndex={0}`, `onKeyDown` (Enter + Space) |
| Image | `alt=""` significatif, ou `alt=""` si décorative |
| Form input | `<label>` lié via `htmlFor` ou `aria-label` |
| Icon-only button | `aria-label="Action description"` |
| État pressé/sélectionné | `aria-pressed={isSelected}` ou `aria-selected` |
| Modal / Dialog | shadcn `<Dialog>` gère focus trap + Esc, à utiliser systématiquement |
| Keyboard nav grille de produits | `onKeyDown` qui mappe Enter/Space → sélection (cf. `POSTerminalWrapper.tsx:456`) |

```tsx
// ✅ Pattern observé dans POSTerminalWrapper.tsx
<div
  role="button"
  tabIndex={0}
  onClick={() => onProductSelect(product)}
  onKeyDown={(e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !isSoldOut) {
      e.preventDefault()
      onProductSelect(product)
    }
  }}
  aria-disabled={isSoldOut}
>
  ...
</div>
```

> Item T8 du backlog (`CURRENT_STATE.md`) : compléter ARIA sur tables data. Item U-06 (V3 readiness) : 4 a11y gaps acceptés post-P1 (voice control, high-contrast, left-handed, screen magnifier).

---

## 9. React Query defaults — appliqués globalement

`src/lib/queryClient.ts` (Sprint 1 S4) :

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,   // POS : on ne veut pas un refetch à chaque alt-tab
      staleTime: 30_000,
      retry: 2,
    },
  },
})
```

Surcharge possible par hook si besoin (`useQuery({ ..., staleTime: Infinity })` pour des données vraiment immuables).

---

## 10. Liens

- [`02-file-organization.md`](./02-file-organization.md) — où poser composants / hooks
- [`04-supabase-patterns.md`](./04-supabase-patterns.md) — patterns react-query + Supabase
- [`05-error-handling.md`](./05-error-handling.md) — boundaries, toasts, Sentry
- [`../01-architecture/03-state-management.md`](../01-architecture/03-state-management.md) — stores Zustand détaillés
- [`../02-design-system/03-shadcn-primitives.md`](../02-design-system/03-shadcn-primitives.md) — composants UI primitifs
