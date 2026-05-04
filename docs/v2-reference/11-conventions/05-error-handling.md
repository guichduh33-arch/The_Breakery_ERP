# 05 — Error handling

> **Last verified**: 2026-05-03

Cette page consolide la stratégie d'**erreur de bout en bout** : boundaries React, toasts utilisateur, capture Sentry, états loading/empty/retry.

---

## 1. Architecture en 3 niveaux

```
┌─────────────────────────────────────────────────┐
│ App-level ErrorBoundary (src/App.tsx)           │  ← dernier filet, page entière de fallback
├─────────────────────────────────────────────────┤
│ ModuleErrorBoundary (par route module)          │  ← isole les modules entre eux
├─────────────────────────────────────────────────┤
│ react-query onError + try/catch local + toasts  │  ← UX standard — l'utilisateur voit un toast
└─────────────────────────────────────────────────┘
              │
              └──→ Sentry (production) via reportError() / captureException()
```

**Règle** : une erreur attendue (validation, 4xx) → toast + état UI. Une erreur inattendue (5xx, exception JS) → boundary + Sentry.

---

## 2. ModuleErrorBoundary — pattern complet

Source : `src/components/ui/ModuleErrorBoundary.tsx`. Snippet :

```tsx
import { Component, ErrorInfo, ReactNode } from 'react'
import { logError } from '@/utils/logger'
import { reportError } from '@/services/errorReporting'

interface IProps {
  children: ReactNode
  moduleName: string
  onReset?: () => void
}

interface IState {
  hasError: boolean
  error?: Error
}

export class ModuleErrorBoundary extends Component<IProps, IState> {
  constructor(props: IProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): IState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logError(`[${this.props.moduleName}] Error caught by boundary:`, error)
    reportError(error, {
      componentStack: errorInfo.componentStack ?? undefined,
    })
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined })
    this.props.onReset?.()
  }

  render() {
    if (this.state.hasError) {
      return <ModuleFallbackUI
        moduleName={this.props.moduleName}
        error={this.state.error}
        onReset={this.handleReset}
      />
    }
    return this.props.children
  }
}
```

### Règles d'usage

- Wrap **chaque** module routé. Listes des `moduleName` actuels : `POS`, `Cafe Stock`, `POS Outstanding`, `KDS`, `Tablet`, `Mobile`, `Inventory`, `Customers`, `Products`, `Reports`, `Users`, `Settings`.
- Toujours **après** `RouteGuard` (pour ne pas masquer une erreur d'auth).
- Détails d'erreur affichés **uniquement en dev** (`import.meta.env.DEV`).
- `onReset` peut déclencher un `queryClient.invalidateQueries()` pour relancer les requêtes.

---

## 3. Toasts utilisateur — Sonner

V2 utilise **Sonner** (et NON `next-themes`, retiré lors de l'audit avril 2026).

```ts
import { toast } from 'sonner'

// Succès
toast.success('Order #1234 completed')

// Erreur attendue
toast.error('Insufficient stock for "Croissant"', {
  description: 'Only 3 units available, you requested 5.',
})

// Info
toast.info('Realtime reconnected')

// Warning
toast.warning('Session will expire in 2 minutes')

// Promise (chargement → résolution auto)
toast.promise(
  saveOrder(),
  {
    loading: 'Saving order...',
    success: 'Saved',
    error: (err) => `Save failed: ${err.message}`,
  }
)
```

### Quand utiliser un toast

| Situation | Toast ? |
|---|---|
| Mutation réussie | ✅ `success` court |
| Mutation échouée (4xx attendu : validation, conflit, permission) | ✅ `error` avec `description` actionnable |
| Mutation échouée (5xx, exception) | ✅ `error` minimaliste + `reportError()` Sentry |
| Erreur de chargement initial | ❌ → état UI inline (`<EmptyState onRetry>`) |
| Notification système (KDS new order) | ✅ `info` ou `<Notification>` ciblé |

---

## 4. Capture Sentry — `reportError()`

Source : `src/services/errorReporting.ts` + config `src/lib/sentry.ts`.

```ts
import { reportError } from '@/services/errorReporting'

try {
  await complexOperation()
} catch (err) {
  reportError(err, {
    context: 'pos.cart.checkout',
    extra: { orderId, totalAmount },
  })
  toast.error('Checkout failed, please try again')
}
```

**Comportement** :

- **Production uniquement** (Sentry désactivé en dev — `import.meta.env.PROD`)
- DSN via `VITE_SENTRY_DSN`
- PII scrubbée (cf. `src/lib/sentry.ts` — pas d'email, pas de PIN, pas de carte bancaire)
- Traces : 20 % des transactions, replay : 10 % (100 % sur erreur)
- Sourcemaps `hidden` mode, uploadées au build via `SENTRY_AUTH_TOKEN`

> Voir [`05-integrations/03-sentry-monitoring.md`](../05-integrations/03-sentry-monitoring.md) pour la config complète et le runbook alertes.

---

## 5. React Query — `onError` global + ciblé

### Global (queryClient)

```ts
new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Erreur de fetch silencieuse → log + Sentry
      reportError(error, { queryKey: query.queryKey })
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      // Mutations sans onError local → toast générique
      toast.error('Operation failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    },
  }),
})
```

### Ciblé (useMutation)

```ts
useMutation({
  mutationFn: voidOrder,
  onError: (err) => {
    if (err.message.includes('PERMISSION_DENIED')) {
      toast.error('You need manager PIN to void an order')
    } else {
      toast.error('Could not void order', { description: err.message })
    }
  },
})
```

**Règle** : un `onError` ciblé **remplace** le global, donc penser à toaster explicitement quand on en met un.

---

## 6. Patterns d'affichage d'erreur

| Contexte | Pattern UI |
|---|---|
| Mutation utilisateur (form submit) | Toast `error` + ré-affiche le form |
| Validation form champ par champ | Inline sous le champ (react-hook-form errors) |
| Chargement échoué d'une page | `<EmptyState>` + bouton "Retry" qui invalide |
| Erreur récupérable cellule de tableau | Badge inline `<span className="text-destructive">Failed</span>` |
| Erreur catastrophique d'un module | `ModuleErrorBoundary` fallback |
| Confirmation destructive échouée | Modal alerte (shadcn `<AlertDialog>`) |

---

## 7. Loading states — Skeleton vs Spinner

| Cas | Composant |
|---|---|
| Page entière | `<PageSkeleton />` (compose `<SkeletonCard>` etc.) |
| Liste de cards | `<SkeletonCard />` × N |
| Tableau | `<SkeletonTableRow columns={N} />` × N |
| Graphique | `<SkeletonChart />` |
| Bouton en cours de mutation | `<Loader2 className="animate-spin" />` interne au bouton |
| Petit indicateur ponctuel | `<Spinner />` (rare) |

**Règle** : préférer **Skeletons** pour préserver le layout et éviter le shift visuel. Spinners uniquement pour les actions ponctuelles (save, refresh).

```tsx
// ✅
<Suspense fallback={<SkeletonChart />}>
  <SalesChart />
</Suspense>

// ❌
<Suspense fallback={<div>Loading...</div>}>   // shift de layout, mauvais ressenti
```

---

## 8. Empty states

```tsx
// Pattern réutilisable
{data?.length === 0 ? (
  <div className="text-center py-12">
    <Inbox className="w-12 h-12 mx-auto text-content-muted mb-3" />
    <h3 className="text-lg font-semibold mb-1">No orders yet</h3>
    <p className="text-sm text-content-muted mb-4">
      Orders will appear here once customers start placing them.
    </p>
    <Button onClick={onCreateOrder}>Create first order</Button>
  </div>
) : (
  <OrdersList orders={data} />
)}
```

**Règle** : un empty state explique **pourquoi** c'est vide et **quoi faire** (CTA).

---

## 9. Retry strategies

| Type | Stratégie |
|---|---|
| react-query queries | Default `retry: 2` avec backoff exponentiel (queryClient global) |
| react-query mutations | `retry: 0` par défaut (l'utilisateur clique à nouveau) |
| Realtime channels | Backoff exponentiel maison (`src/services/realtime/realtimeRetry.ts`) |
| Edge Functions invoke | Pas de retry auto — laisser l'UI proposer un bouton "Retry" |
| Print server (port 3001) | Retry 3× avec délai 1s, puis fallback PDF |

---

## 10. Cas spéciaux V2

### Erreur d'auth → reset session

```ts
if (error?.message === 'JWT expired') {
  await supabase.auth.signOut()
  navigate('/login')
}
```

### Erreur RLS (PostgREST 42501)

```ts
if (error?.code === '42501') {
  toast.error('You do not have permission to do this')
  reportError(error, { context: 'rls.denied' })
}
```

### Edge Function 401 / 403

```ts
const { error } = await supabase.functions.invoke(...)
if (error?.context?.status === 403) {
  toast.error('Permission denied for this operation')
} else if (error) {
  toast.error('Server error, please retry')
  reportError(error)
}
```

---

## 11. Liens

- [`03-react-patterns.md`](./03-react-patterns.md) — `ModuleErrorBoundary` côté pattern
- [`04-supabase-patterns.md`](./04-supabase-patterns.md) — `if (error) throw error`
- [`06-pitfalls.md`](./06-pitfalls.md) — pièges courants
- [`../05-integrations/03-sentry-monitoring.md`](../05-integrations/03-sentry-monitoring.md) — Sentry config + runbook
- [`../09-testing/04-known-failures.md`](../09-testing/04-known-failures.md) — tests pré-existants
- [`../10-deployment-ops/07-monitoring-runbook.md`](../10-deployment-ops/07-monitoring-runbook.md) — runbook alertes
