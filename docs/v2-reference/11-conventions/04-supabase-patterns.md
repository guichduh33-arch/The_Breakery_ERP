# 04 — Supabase patterns

> **Last verified**: 2026-05-03

Cette page consolide les **patterns Supabase** utilisés dans V2 : queries ciblées, RPC, realtime, optimistic updates, error handling, Edge Functions, Storage, Auth.

---

## 1. TOUJOURS targeted select — jamais `select('*')`

### Règle

```ts
// ✅ Targeted — précise les colonnes utilisées
const { data, error } = await supabase
  .from('products')
  .select('id, name, price, stock_quantity, category_id')
  .eq('is_active', true)
```

```ts
// ❌ select('*') — plus aucune occurrence dans src/ depuis Sprint 1 S2
const { data } = await supabase.from('products').select('*')
```

### Pourquoi

- **Performance réseau** : on rapatrie 5 colonnes au lieu de 30+ (certaines tables ont des `jsonb` lourds)
- **Sécurité** : `select('*')` sur une jointure peut exposer des colonnes sensibles (`pin_hash`, `notes_internal`)
- **Régression à la migration** : ajouter une colonne `jsonb` géante ne casse pas la perf si `select('*')` n'est pas utilisé
- L'audit Sprint 1 S2 a remplacé **107 occurrences** historiques. Maintenir le score à **0**.

### Embeddings (jointures)

```ts
// ✅ Cibler aussi les colonnes des relations
.select(`
  id, order_number, total,
  customer:customers(name, company_name, phone)
`)
```

> Voir [`04-modules/09-b2b-wholesale.md`](../04-modules/09-b2b-wholesale.md) pour le pattern complet `useB2BOrders`.

---

## 2. RPC vs query directe

| Choisir RPC | Choisir query directe |
|---|---|
| Transaction atomique multi-tables | Lecture simple |
| Calcul serveur (taxe, agrégat) | Insert / update simple |
| Logique réutilisée par plusieurs apps | CRUD trivial |
| Bypass RLS contrôlé (`SECURITY DEFINER`) | Accès lecture standard via RLS |

### Exemples critiques V2

```ts
// ✅ Split payment atomique
const { data, error } = await supabase.rpc('complete_order_with_payments', {
  p_order_id: orderId,
  p_payments: payments,
})

// ✅ Approbation de dépense + journal entry en transaction
await supabase.rpc('approve_expense_with_journal', {
  p_expense_id: id,
  p_approver_id: userId,
})

// ✅ Liste users actifs depuis page login (pas de session, donc SECURITY DEFINER)
await supabase.rpc('get_active_users_for_login')
```

### Anti-pattern : split payment "manuel"

```ts
// ❌ Ne JAMAIS faire (cf. CLAUDE.md pitfalls)
await createOrder(...)
await processPayment(...)
await processPayment(...)   // Si crash ici → order créée mais payments incohérents
```

---

## 3. Realtime — channel cleanup obligatoire

### Pattern correct

```ts
useEffect(() => {
  const channel = supabase
    .channel('orders-kds')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'orders' },
      (payload) => {
        queryClient.invalidateQueries({ queryKey: ['orders', 'kds'] })
      },
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)   // ← OBLIGATOIRE
  }
}, [queryClient])
```

### Pourquoi

Sans cleanup :

- Channel ouvert reste actif → fuite WebSocket
- Plusieurs souscriptions superposées → callbacks dupliqués
- En POS multi-jour, accumulation jusqu'au plantage navigateur

### Retry exponential backoff (Sprint 0 C7)

Le wrapper realtime `src/services/realtime/realtimeRetry.ts` ré-essaie automatiquement avec backoff exponentiel sur déconnexion.

> Voir [`05-integrations/01-supabase.md`](../05-integrations/01-supabase.md) section "Realtime" et [`06-lan-architecture/01-hub-client-model.md`](../06-lan-architecture/01-hub-client-model.md) pour le pattern hub LAN.

---

## 4. Optimistic updates avec react-query

```ts
useMutation({
  mutationFn: async ({ id, status }: { id: string; status: TOrderStatus }) =>
    updateOrderStatus(id, status),
  onMutate: async ({ id, status }) => {
    await queryClient.cancelQueries({ queryKey: ['orders'] })
    const previous = queryClient.getQueryData<IOrder[]>(['orders'])
    queryClient.setQueryData<IOrder[]>(['orders'], (old) =>
      old?.map((o) => (o.id === id ? { ...o, status } : o))
    )
    return { previous }
  },
  onError: (_err, _vars, context) => {
    if (context?.previous) queryClient.setQueryData(['orders'], context.previous)
    toast.error('Could not update order — reverting')
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['orders'] })
  },
})
```

**Règle** : optimistic uniquement pour mutations **fréquentes** où la latence perçue importe (KDS update status, cart toggle). Pour les écritures comptables, **NE PAS** faire d'optimistic — attendre la confirmation serveur (atomicité comptable).

---

## 5. Error handling — pattern strict

```ts
const { data, error } = await supabase.from('products').select('id, name')

// ✅ Toujours throw : react-query traite via onError + Sentry capture
if (error) throw error

// ✅ Coalesce data (Supabase peut renvoyer null sur empty)
return (data ?? []) as IProduct[]
```

```ts
// ❌ Erreur silencieuse
const { data } = await supabase.from('products').select('id')   // erreur ignorée
return data || []
```

### Casts `as never` — signal de drift

`as never` ou `as any` à la sortie d'une query Supabase = **drift** entre `database.generated.ts` et la DB. Action : `/gen-types` puis vérifier via `/db-schema-audit`.

---

## 6. Edge Functions — invoke

### Côté client

```ts
const { data, error } = await supabase.functions.invoke('generate-invoice', {
  body: { orderId },
})

if (error) throw error
return data as { url: string }
```

### Côté Edge Function (Deno) — toujours `verify_jwt: true` + check permission

```ts
// supabase/functions/generate-invoice/index.ts
import { createClient } from 'jsr:@supabase/supabase-js'

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization')
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: auth ?? '' } } }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { data: hasPerm } = await supabase.rpc('user_has_permission', {
    p_uid: user.id,
    p_code: 'sales.view',
  })
  if (!hasPerm) return new Response('Forbidden', { status: 403 })

  // ... logique métier
})
```

### Config — toujours

```toml
# supabase/config.toml
[functions.generate-invoice]
verify_jwt = true
```

> Voir [`05-integrations/02-edge-functions.md`](../05-integrations/02-edge-functions.md) pour les 16 Edge Functions et [`07-security/04-edge-function-security.md`](../07-security/04-edge-function-security.md).

---

## 7. Storage — upload + signed URL

```ts
// Upload privé
const { data, error } = await supabase.storage
  .from('invoices')
  .upload(`${customerId}/${invoiceId}.pdf`, blob, {
    contentType: 'application/pdf',
    upsert: false,
  })
if (error) throw error

// Signed URL temporaire (1h)
const { data: signed } = await supabase.storage
  .from('invoices')
  .createSignedUrl(data.path, 3600)
```

**Règle** : pour tout document privé (factures, exports) → bucket privé + signed URL. Bucket public uniquement pour les avatars / images produits exposées au customer display.

---

## 8. Auth — `getSession()` vs `getUser()`

| Appel | Comportement | Usage |
|---|---|---|
| `supabase.auth.getSession()` | Retourne la session **du localStorage** sans hit serveur. Rapide, mais session peut être révoquée. | Composants UI, premier render, listings utilisateurs |
| `supabase.auth.getUser()` | Hit serveur, valide la session côté Supabase. Plus lent mais sûr. | Edge Functions, opérations sensibles, auth-verify-pin |

```ts
// ✅ UI : rapide
const { data: { session } } = await supabase.auth.getSession()

// ✅ Edge Function : sûr (la session a pu être révoquée)
const { data: { user } } = await supabase.auth.getUser()
```

> Voir [`07-security/01-auth-flow-pin.md`](../07-security/01-auth-flow-pin.md) pour le flow auth complet (4 Edge Functions).

---

## 9. Pagination — `.range()` + count

```ts
const PAGE_SIZE = 50
const { data, count, error } = await supabase
  .from('orders')
  .select('id, order_number, total, created_at', { count: 'exact' })
  .order('created_at', { ascending: false })
  .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
```

**Règle** : toute requête susceptible de retourner > 1000 lignes doit paginer. Reports avec `.limit()` (audit Sprint avril 2026 a corrigé les unbounded queries).

---

## 10. Filtres — utiliser `.in()`, `.match()`, `.or()`

```ts
// ✅ Plusieurs valeurs
.in('status', ['confirmed', 'processing', 'ready'])

// ✅ Match plusieurs colonnes (égalité)
.match({ status: 'completed', payment_status: 'paid' })

// ✅ OR
.or('status.eq.draft,status.eq.confirmed')
```

---

## 11. Liens

- [`05-integrations/01-supabase.md`](../05-integrations/01-supabase.md) — client singleton, auth, realtime
- [`05-integrations/02-edge-functions.md`](../05-integrations/02-edge-functions.md) — 16 Edge Functions
- [`07-security/02-rls-patterns.md`](../07-security/02-rls-patterns.md) — `is_authenticated()`, `user_has_permission()`
- [`07-security/04-edge-function-security.md`](../07-security/04-edge-function-security.md) — `verify_jwt: true`
- [`03-database/03-rpc-functions.md`](../03-database/03-rpc-functions.md) — référence RPCs
- [`06-pitfalls.md`](./06-pitfalls.md) — pièges Supabase courants
