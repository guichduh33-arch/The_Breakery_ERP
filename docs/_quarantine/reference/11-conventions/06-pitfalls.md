<!-- STALE-V2 -->
> ⚠️ **DOC HISTORIQUE — PÉRIMÉE (V2), NE FAIT PLUS FOI.** Ce fichier décrit en grande partie l'architecture **V2** (mono-app AppGrav, npm/Vercel, PWA/Capacitor, projet Supabase `abjabuniwkqpfsenxljp` = **prod incompatible**, versions RPC obsolètes). **Ne jamais l'appliquer tel quel** (migration, config, archi). Sources de vérité actuelles : `CLAUDE.md` (patterns + workplan) et `docs/workplan/remise-a-plat/` (référence modules réel-vs-demandé). Hiérarchie complète : `docs/README.md`. Régénération depuis le code prévue en Phase 3.

# 06 — Pitfalls

> **Last verified**: 2026-05-03

Catalogue des **pièges connus** dans V2 (et certains spécifiques à la cohabitation V2↔V3). Chaque entrée suit le format :

> **Pitfall** · **Pourquoi c'est dangereux** · **Bon vs mauvais** · **Référence**

Source primaire : section "Pitfalls" du `CLAUDE.md` racine, étendue avec les retrospectives epic-005 / epic-016b.

---

## 1. Optional chaining sur données async

**Pitfall** : oublier `?.` sur des données qui peuvent être `undefined` au premier render.

**Pourquoi** : react-query renvoie `data: undefined` avant la première résolution. Sans optional chaining → `TypeError: Cannot read properties of undefined`.

```ts
// ❌
const { data } = useProducts()
return <ul>{data.map(p => <li>{p.name}</li>)}</ul>   // crash au render initial

// ✅
const { data, isLoading } = useProducts()
if (isLoading) return <Skeleton />
return <ul>{data?.map(p => <li key={p.id}>{p.name}</li>)}</ul>
```

**Référence** : pattern observé dans tous les hooks `src/hooks/`.

---

## 2. RLS obligatoire sur toute nouvelle table

**Pitfall** : créer une table sans `ENABLE ROW LEVEL SECURITY` ni policy.

**Pourquoi** : Supabase expose **toutes** les tables publiques via PostgREST. Sans RLS = lecture/écriture anonyme depuis n'importe quel client web. Risque sécurité critique.

```sql
-- ❌ Table créée sans RLS
CREATE TABLE public.audit_logs (id uuid primary key, action text);
-- Accessible par anon → fuite immédiate

-- ✅ Pattern obligatoire
CREATE TABLE public.audit_logs (id uuid primary key, action text);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read" ON public.audit_logs
  FOR SELECT USING (public.is_authenticated());
CREATE POLICY "Permission-based write" ON public.audit_logs
  FOR INSERT WITH CHECK (public.user_has_permission(auth.uid(), 'admin.audit'));
```

**Référence** : utiliser `/create-migration` qui scaffold le pattern RLS automatiquement. Voir [`07-security/02-rls-patterns.md`](../07-security/02-rls-patterns.md).

---

## 3. `/gen-types` après chaque migration SQL

**Pitfall** : modifier le schéma SQL sans régénérer `database.generated.ts`.

**Pourquoi** : les types TS deviennent **mensongers**. Les hooks compilent mais lèvent erreurs runtime (colonne manquante, enum incorrect). Symptômes : casts `as never`, `as any`, HTTP 400 Supabase.

```bash
# Après toute migration touchant tables/enums/RPCs :
/gen-types
```

**Hook protecteur** : `protect-files.sh` bloque toute édition manuelle de `database.generated.ts`. Ne pas contourner.

**Référence** : skill `/db-schema-audit` détecte le drift. Voir [`03-database/07-migrations-history.md`](../03-database/07-migrations-history.md).

---

## 4. Locked cart items → PIN obligatoire pour modifier

**Pitfall** : tenter de modifier un item de panier après envoi en cuisine sans demander le PIN manager.

**Pourquoi** : règle métier — une commande envoyée au KDS est en cours de production. Modifier sans contrôle = perte fournisseur, ticket erroné, contestation comptable.

```ts
// ❌ Modif directe
cartStore.updateItemQty(itemId, newQty)

// ✅ Vérifier le lock + demander PIN
if (item.locked) {
  await openManagerPinModal()
  if (!pinValid) return
}
cartStore.updateItemQty(itemId, newQty)
```

**Référence** : `cartStore` expose `locked` sur chaque item. Cf. [`04-modules/02-pos-cart-orders.md`](../04-modules/02-pos-cart-orders.md) section "Locked items".

---

## 5. Pas de `t()` ni i18next — anglais uniquement

**Pitfall** : tenter d'utiliser `useTranslation()`, `t('key')`, ou ajouter `react-i18next`.

**Pourquoi** : i18n a été **suspendu**. Toute UI est en anglais (chaînes en dur, lisibles dans le code). Réintroduire i18n nécessite décision produit explicite.

```tsx
// ❌
import { useTranslation } from 'react-i18next'
const { t } = useTranslation()
return <button>{t('checkout.confirm')}</button>

// ✅
return <button>Confirm checkout</button>
```

**Référence** : décision produit `CLAUDE.md` § Project Overview. Audit avril 2026 a remplacé les dernières chaînes françaises restantes.

---

## 6. Split payment → RPC `complete_order_with_payments` uniquement

**Pitfall** : appeler `createOrder` puis plusieurs `processPayment` séparés.

**Pourquoi** : non-atomique. Si crash entre les deux → order créée avec payments incohérents (audit comptable cassé, pas de journal entry valide).

```ts
// ❌
const order = await createOrder(...)
for (const payment of payments) {
  await processPayment(order.id, payment)   // crash possible ici
}

// ✅ Atomique côté DB
const { data, error } = await supabase.rpc('complete_order_with_payments', {
  p_order_id: orderId,
  p_payments: payments,
})
if (error) throw error
```

**Référence** : Sprint 0 C1. Voir [`08-flows-end-to-end/02-pos-sale-split-payment.md`](../08-flows-end-to-end/02-pos-sale-split-payment.md).

---

## 7. Production records → triggers gèrent stock

**Pitfall** : tenter de mettre à jour `products.stock_quantity` manuellement après une production.

**Pourquoi** : `useProduction.create` insère dans `production_records`. Un trigger SQL **déduit les ingrédients** et **incrémente le finished product**. Une mise à jour manuelle en plus = double comptage.

```ts
// ❌
await createProduction(...)
await updateStock(productId, +qty)   // double-comptage !

// ✅ Le trigger s'occupe de tout
await useProduction.create.mutateAsync({ recipeId, quantity })
```

**Référence** : Sprint 0 C2. Cf. [`04-modules/15-production-recipes.md`](../04-modules/15-production-recipes.md), [`08-flows-end-to-end/12-production-stock-impact.md`](../08-flows-end-to-end/12-production-stock-impact.md).

---

## 8. Promotion engine — `useCartPromotions` auto-évalue

**Pitfall** : appeler `evaluatePromotions()` manuellement après un changement de cart.

**Pourquoi** : `useCartPromotions` s'abonne déjà à `cartStore.items`. Évaluation manuelle = double évaluation, totaux instables.

```ts
// ❌
addItemToCart(item)
const promos = await evaluatePromotions(cart)   // déjà géré ailleurs

// ✅
addItemToCart(item)
// useCartPromotions remonte les promos via store, calculateTotals les consomme
```

**Référence** : voir [`04-modules/13-promotions-discounts.md`](../04-modules/13-promotions-discounts.md), [`08-flows-end-to-end/09-promotion-evaluation.md`](../08-flows-end-to-end/09-promotion-evaluation.md).

---

## 9. Edge Functions → `verify_jwt: true` obligatoire

**Pitfall** : déployer une Edge Function avec `verify_jwt: false`.

**Pourquoi** : la fonction devient ouverte au monde. N'importe qui peut l'invoquer. Risque RLS contourné, fuites données.

```toml
# supabase/config.toml
[functions.generate-invoice]
verify_jwt = true   # ← obligatoire (sauf cas exceptionnel documenté)
```

**Côté code** : doubler avec un check `user_has_permission(auth.uid(), 'module.action')`.

**Référence** : `scripts/check-edge-functions-jwt.mjs` (côté V3) audite ça en CI. Voir [`07-security/04-edge-function-security.md`](../07-security/04-edge-function-security.md).

---

## 10. 9 tests pré-existants en échec — connus, non-régression

**Pitfall** : croire qu'on a cassé les tests parce que `vitest run` montre 9 échecs.

**Pourquoi** : `src/services/__tests__/authService.test.ts` (9 tests) **nécessite** une instance Supabase live pour les Edge Functions auth. Connu, accepté, **pas une régression**.

```bash
# Vérification rapide qu'on n'a rien introduit
npx vitest run --reporter=verbose 2>&1 | grep -A1 "FAIL"
# → si seul authService.test.ts apparaît → OK
```

**Référence** : `CURRENT_STATE.md` "Known Issues". Voir [`09-testing/04-known-failures.md`](../09-testing/04-known-failures.md).

---

## 11. JAMAIS `select('*')`

**Pitfall** : commodité d'écrire `select('*')` pour "tout récupérer".

**Pourquoi** :
- Perf réseau dégradée
- Risque sécu (colonnes `pin_hash`, `notes_internal`)
- Régression silencieuse à l'ajout d'une colonne `jsonb` lourde

```ts
// ❌
.select('*')

// ✅
.select('id, name, price, stock_quantity')
```

**Référence** : Sprint 1 S2 a éliminé 107 occurrences. Score actuel : **0**. Cf. [`04-supabase-patterns.md`](./04-supabase-patterns.md) §1.

---

## 12. V2↔V3 stories — coût caché +3 pts

**Pitfall** : estimer une story qui importe `@breakery/*` depuis le monolith V2 sans vérifier le wiring foundational.

**Pourquoi** : si l'une des 4 conditions ci-dessous manque, la story porte +3 pts de wiring avant son vrai travail.

**Checklist (les 4 conditions doivent être vraies)** :

1. `breakery-platform/pnpm-workspace.yaml` glob couvre l'entrée V2
2. `package.json` racine déclare la dépendance workspace `@breakery/*`
3. `vite.config.ts` V2 résout le package (alias ou paths)
4. `tsconfig.json` V2 paths matchent

**Référence** : retrospective epic-005 SB-007 (smoke-migration de 10 hooks V2 différée car V2 n'avait pas de workspace link `@breakery/*`).

---

## 13. Trigger functions ne s'invoquent pas standalone

**Pitfall** : tenter `PERFORM my_trigger_fn()` ou `SELECT my_trigger_fn()` dans un smoke test.

**Pourquoi** : Postgres rejette avec :

```
ERROR: trigger functions can only be called as triggers
```

**Bon pattern smoke test** :

```sql
-- ❌
SELECT public.create_sale_journal_entry();

-- ✅ Vérifier l'enregistrement de la fonction
SELECT 1 FROM pg_proc WHERE proname = 'create_sale_journal_entry';

-- ✅ Vérifier l'attachement à un trigger
SELECT tgname FROM pg_trigger WHERE tgfoid = 'public.create_sale_journal_entry'::regproc;
```

**Référence** : amendement epic-016b 016b-001 §15.4 (TEST 4 PERFORM fail).

---

## 14. `information_schema.role_table_grants` ignore les matviews

**Pitfall** : utiliser `information_schema.role_table_grants` pour vérifier des privilèges sur une **materialized view**.

**Pourquoi** : `information_schema` ne reflète pas les matviews (rel kind `m`). Le check passe en faux positif/négatif.

```sql
-- ❌ Ne marche pas pour matviews
SELECT * FROM information_schema.role_table_grants
WHERE grantee = 'authenticated' AND table_name = 'mv_daily_kpis';

-- ✅ Fonctionne sur tout relkind (tables, views, matviews)
SELECT has_table_privilege('authenticated', 'public.mv_daily_kpis', 'SELECT');
```

**Référence** : amendement epic-016b 016b-001 §15.5 (TEST 7 information_schema fail).

---

## 15. `cmdk` Command — `shouldFilter={false}` quand source serveur

**Pitfall** : utiliser `<Command>` (lib `cmdk`, sous shadcn `CommandDialog`) avec une recherche **server-side** sans désactiver le filtre client.

**Pourquoi** : par défaut `shouldFilter={true}`. Le composant filtre côté client sur la prop `value` de chaque `<CommandItem>`. Si le `value` ne contient pas la sous-chaîne tapée → l'item disparaît, même si le serveur l'a renvoyé.

```tsx
// ❌ Items disparaissent quand l'utilisateur tape
<Command>
  <CommandInput value={query} onValueChange={setQuery} />
  {results.map(r => <CommandItem key={r.id} value={r.title}>{r.title}</CommandItem>)}
</Command>

// ✅ Désactiver le filtre — le serveur filtre, cmdk ne fait que la nav clavier
<Command shouldFilter={false}>
  <CommandInput value={query} onValueChange={setQuery} />
  {results.map(r => <CommandItem key={r.id} value={r.id}>{r.title}</CommandItem>)}
</Command>
```

**Règle bonus** : utiliser `value={r.id}` (stable, unique) plutôt que `value={r.title}` quand on désactive le filter — évite les collisions sur titres identiques.

**Référence** : retro epic-016b 016b-002 [DS]→[CR] (`<GlobalSearchCmdK>` items hidden when typing).

---

## 16. Confondre `getSession()` et `getUser()`

**Pitfall** : utiliser `supabase.auth.getSession()` pour valider une session côté Edge Function ou opération sensible.

**Pourquoi** : `getSession()` lit le localStorage, ne valide pas serveur. Une session révoquée passe quand même.

```ts
// ❌ Edge Function — session peut être révoquée
const { data: { session } } = await supabase.auth.getSession()

// ✅ Hit serveur, session validée
const { data: { user } } = await supabase.auth.getUser()
```

**Référence** : voir [`04-supabase-patterns.md`](./04-supabase-patterns.md) §8.

---

## 17. Realtime sans cleanup

**Pitfall** : oublier `supabase.removeChannel(channel)` dans le `return` de `useEffect`.

**Pourquoi** : channel WebSocket reste ouvert, callbacks doublés à chaque re-render. POS multi-jour finit par planter le navigateur.

```ts
// ❌
useEffect(() => {
  supabase.channel('orders').on(...).subscribe()
}, [])

// ✅
useEffect(() => {
  const channel = supabase.channel('orders').on(...).subscribe()
  return () => { supabase.removeChannel(channel) }
}, [])
```

**Référence** : [`04-supabase-patterns.md`](./04-supabase-patterns.md) §3.

---

## 18. `as never` / `as any` sur queries Supabase

**Pitfall** : forcer un cast sur la sortie d'une query parce que TypeScript râle.

**Pourquoi** : signal que `database.generated.ts` est désynchronisé du schéma DB. Patcher au lieu de fixer = drift permanent.

```ts
// ❌
const { data } = await supabase.from('products').select('id, name, foo')
return data as IProduct[]   // foo n'existe pas en DB

// ✅
// 1. Vérifier le schéma DB
// 2. Lancer /gen-types
// 3. Si la colonne doit exister, la créer via migration
```

**Référence** : skill `/db-schema-audit`. Voir [`04-supabase-patterns.md`](./04-supabase-patterns.md) §5.

---

## 19. Ne pas committer `.env`, lock files, `database.generated.ts` à la main

**Pitfall** : éditer manuellement ces fichiers ou tenter `git add .env`.

**Pourquoi** :
- `.env` contient des secrets (Supabase keys, Sentry token)
- Lock files doivent être régénérés via `npm install`
- `database.generated.ts` doit être régénéré via `/gen-types`

**Hook protecteur** : `protect-files.sh` bloque l'édition (PreToolUse Edit/Write). Le hook `auto-lint.sh` lance `eslint --fix` après sauvegarde.

**Référence** : `.claude/settings.json` + scripts `.claude/hooks/`. Voir [`07-security/05-secrets-and-env.md`](../07-security/05-secrets-and-env.md).

---

## 20. Liens

- [`01-coding-conventions.md`](./01-coding-conventions.md)
- [`04-supabase-patterns.md`](./04-supabase-patterns.md)
- [`05-error-handling.md`](./05-error-handling.md)
- [`../07-security/02-rls-patterns.md`](../07-security/02-rls-patterns.md)
- [`../07-security/04-edge-function-security.md`](../07-security/04-edge-function-security.md)
- [`../09-testing/04-known-failures.md`](../09-testing/04-known-failures.md)
- `CLAUDE.md` racine — section "Pitfalls" source de vérité
