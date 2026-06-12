# Spec — POS realtime channel uniqueness fix (3 hooks) (V1)

- **Date** : 2026-06-01
- **Topic** : `pos-realtime-channel-uniqueness-fix`
- **Type** : correctif ciblé post-audit (hors cycle session numéroté)
- **Branche cible suggérée** : `fix/pos-realtime-channel-uniqueness`
- **Base** : `master` @ `70c5cf1`
- **Effort estimé** : **S** (~0.5 jour — 3 hooks micro-édités + 3 tests d'unicité)
- **Status** : draft pour ratification
- **Origine** : audit POS `pos-specialist` 2026-06-01 — finding **P1 « channel realtime non-unique par mount »**

---

## 1. Contexte — ce qui est cassé (preuve `fichier:ligne`)

Le projet documente explicitement un anti-pattern dangereux dans `apps/pos/src/features/kds/hooks/useKdsRealtime.ts:28-32` :

> « we generate the UUID INSIDE the effect, NOT via a component-body `useMemo`. In StrictMode the useMemo from the first render is discarded and the second-render UUID is reused across both effect mounts → channel-name collision. »

C'est aussi un **Critical pattern** du CLAUDE.md : « Realtime channel names must be unique per mount — StrictMode double-mounts components and shared channel names collide silently. »

**Trois hooks POS violent ce pattern** en générant l'UUID de channel via `useMemo(() => crypto.randomUUID(), [])` au niveau du corps du composant, et non dans l'effet :

| Hook | Preuve | Channel construit |
|---|---|---|
| `apps/pos/src/features/promotions/hooks/usePromotionsRealtime.ts:19` | `const mountId = useMemo(() => crypto.randomUUID(), []);` puis `.channel(`promotions-changes-${mountId}`)` ligne 23 | `promotions-changes-<mountId>` |
| `apps/pos/src/features/tables/hooks/useTableOccupancy.ts:36` | `const mountId = useMemo(() => crypto.randomUUID(), []);` puis `.channel(`table_occupancy_realtime-${mountId}`)` ligne 46 | `table_occupancy_realtime-<mountId>` |
| `apps/pos/src/features/tablet/hooks/useTabletOrderStatusListener.ts:19` | `const mountId = useMemo(() => crypto.randomUUID(), []);` puis `.channel(`tablet-order-status-${mountId}`)` ligne 30 | `tablet-order-status-<mountId>` |

Ironie : les **commentaires** des 3 hooks citent déjà `useKdsRealtime` comme référence (« Pattern ref: …useKdsRealtime.ts (C2 fix) »), mais l'**implémentation** a divergé du pattern : ils mémoïsent l'UUID au render au lieu de le créer dans l'effet. Sous `<StrictMode>` (dev) le `useMemo` du 1er render est jeté, le 2e render fournit un UUID unique partagé par les deux montages d'effet → **collision de channel silencieuse** : le `.on()` du 2e montage s'attache au channel encore-souscrit du 1er (car `removeChannel` est async), et les events suivants peuvent être perdus en silence.

### Pattern correct de référence (à appliquer)
- `apps/pos/src/features/kds/hooks/useKdsRealtime.ts:54-55` : `useEffect(() => { const channelName = \`kds-${station}-${crypto.randomUUID()}\`; ... }, [...])` — UUID généré **dans** l'effet.
- `apps/pos/src/features/display/hooks/useDisplayRealtime.ts:28-29` : idem, `const channelName = \`display-${screenId}-${crypto.randomUUID()}\`;` dans l'effet.

---

## 2. Architecture / approche proposée

Migrer les 3 hooks vers la génération de l'UUID **à l'intérieur du `useEffect`**, et **retirer** le `useMemo` + l'import `useMemo` devenu inutile + le `mountId` des dépendances de l'effet.

Avant (anti-pattern, `usePromotionsRealtime.ts`) :
```ts
const mountId = useMemo(() => crypto.randomUUID(), []);
useEffect(() => {
  const channel = supabase.channel(`promotions-changes-${mountId}`)...
}, [qc, mountId]);
```

Après (pattern correct) :
```ts
useEffect(() => {
  const channelName = `promotions-changes-${crypto.randomUUID()}`;
  const channel = supabase.channel(channelName)...
  return () => { void supabase.removeChannel(channel); };
}, [qc]);
```

Spécificités par hook :
- `useTableOccupancy.ts` : conserve `useQuery` (occupancy) inchangé ; seul le bloc `useEffect` realtime est migré ; retirer `mountId` du deps array (reste `[queryClient]`).
- `useTabletOrderStatusListener.ts` : conserve `seenRef` (dedupe) + le guard `if (!userId) return` ; retirer `mountId` du deps array (reste `[userId, queryClient]`).
- `usePromotionsRealtime.ts` : deps array devient `[qc]`.

Aucun changement de comportement runtime hors StrictMode ; le correctif rend l'unicité robuste sous double-montage dev (et tout futur remount).

---

## 3. Critères d'acceptation

- [ ] Les 3 hooks génèrent l'UUID de channel **dans** le `useEffect`, plus aucun `useMemo(() => crypto.randomUUID(), [])` au corps du composant.
- [ ] L'import `useMemo` est retiré des 3 fichiers s'il n'est plus utilisé par ailleurs.
- [ ] Le deps array de chaque effet ne contient plus `mountId`.
- [ ] Sous `<StrictMode>`, chaque hook ouvre **2 channels au noms distincts** (vérifié par test).
- [ ] Hors StrictMode, chaque hook ouvre **1 channel** par jeu d'arguments.
- [ ] Comportement métier inchangé (invalidation de query, dedupe tablet, toast).
- [ ] `pnpm --filter @breakery/app-pos typecheck` PASS.

## 4. Tests attendus

Trois tests d'unicité, **calqués exactement** sur `apps/pos/src/features/kds/__tests__/useKdsRealtime.uniqueChannel.test.tsx` (mock `@/lib/supabase` avec un `channelSpy`, render sous `<StrictMode>`, assert `channelSpy` appelé 2× avec deux noms distincts ; render hors StrictMode → 1 appel) :

- `apps/pos/src/features/promotions/__tests__/usePromotionsRealtime.uniqueChannel.test.tsx` — préfixe `promotions-changes-`.
- `apps/pos/src/features/tables/__tests__/useTableOccupancy.uniqueChannel.test.tsx` — préfixe `table_occupancy_realtime-` (mock aussi `useQuery`/occupancy si besoin pour éviter le fetch).
- `apps/pos/src/features/tablet/__tests__/useTabletOrderStatusListener.uniqueChannel.test.tsx` — préfixe `tablet-order-status-` ; nécessite un `authStore.user.id` non-null (sinon l'effet `return` tôt) — fournir un user mocké.

Référence d'autres tests d'unicité existants à imiter : `useDisplayRealtime.uniqueChannel`, `useLanHub.uniqueChannel`.

Non-régression : `pnpm --filter @breakery/app-pos test promotions tables tablet`.

## 5. Hors scope

- Audit d'autres hooks realtime hors POS (BO `useOrdersRealtime` etc.) — à traiter séparément si l'audit BO le révèle.
- Refactor d'un helper partagé `useUniqueChannelName()` — tentant mais non demandé ; les 3 hooks restent indépendants (pas de sur-abstraction).
- Tout changement de logique de souscription / filtre / payload.

## 6. Risques / dépendances

- **Risque quasi nul** : changement mécanique, couvert par tests d'unicité ; aucune dépendance DB/EF.
- Vérifier que `useTableOccupancy` n'a pas un autre consommateur de `mountId` (il n'en a pas — usage unique dans le channel name, vérifié `useTableOccupancy.ts:36-46`).
- Le seul comportement observable change uniquement sous StrictMode (dev) — pas de risque prod.
