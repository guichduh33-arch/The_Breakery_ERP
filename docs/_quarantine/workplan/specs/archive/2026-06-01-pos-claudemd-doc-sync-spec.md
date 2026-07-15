# Spec — CLAUDE.md doc sync (versions RPC périmées) (V1)

- **Date** : 2026-06-01
- **Topic** : `pos-claudemd-doc-sync`
- **Type** : correctif documentaire (doc-only, hors cycle session numéroté)
- **Branche cible suggérée** : `docs/claudemd-rpc-versions-sync`
- **Base** : `master` @ `70c5cf1`
- **Effort estimé** : **S** (~0.25 jour — édition doc + grep de vérif)
- **Status** : draft pour ratification
- **Origine** : audit POS `pos-specialist` 2026-06-01 — finding **P1 « versions RPC du CLAUDE.md périmées »**

---

## 1. Contexte — ce qui est cassé (preuve `fichier:ligne`)

Le **Critical pattern** « Order writes go through RPCs » du CLAUDE.md cite des **versions d'RPC périmées**, ce qui est trompeur pour tout agent/dev qui s'y fie.

`CLAUDE.md:61` :
> « Order writes go through RPCs — never raw inserts. RPCs: `complete_order` (v6), `pay_existing_order` (v3), `create_tablet_order`, `pickup_tablet_order`, `evaluate_promotions`, `mark_item_served`. »

Vérification des versions **réellement appelées** par le code (2026-06-01) :

| RPC cité CLAUDE.md:61 | Version réelle appelée | Preuve |
|---|---|---|
| `complete_order` **(v6)** | **`complete_order_with_payment_v10`** | `supabase/functions/process-payment/index.ts:149` + migration `supabase/migrations/20260530190828_bump_complete_order_v10.sql`. Note : le POS n'appelle PAS `complete_order` directement — `useCheckout.ts:124` POST l'EF `process-payment` qui appelle l'RPC server-side. |
| `pay_existing_order` **(v3)** | **`pay_existing_order_v6`** | `apps/pos/src/features/payment/hooks/useCheckout.ts:93` (`supabase.rpc('pay_existing_order_v6', ...)`) + type `Database['public']['Functions']['pay_existing_order_v6']` ligne 7. |
| `create_tablet_order` | **`create_tablet_order_v2`** | `apps/pos/src/features/tablet/hooks/useCreateTabletOrder.ts:19` (S25 hardening). |
| `pickup_tablet_order` | `pickup_tablet_order` (non versionné) | `apps/pos/src/features/inbox/hooks/usePickupTabletOrder.ts:43` — **doc OK**. |
| `evaluate_promotions` | **`evaluate_promotions_v1`** | `apps/pos/src/features/promotions/hooks/useEvaluatePromotions.ts:166`. |
| `mark_item_served` | `mark_item_served` (non versionné) | `apps/pos/src/features/kds/hooks/useMarkItemServed.ts:14` — **doc OK**. |

**Divergence vs l'énoncé de l'audit** : l'audit dit « le code utilise `pay_existing_order_v6` (`useCheckout.ts:93`) » — **confirmé** ✓. L'audit ajoute « complete_order v6 vs `complete_order_with_payment_v10` réellement appelé dans `useCheckout.ts` » — **imprécision** : `useCheckout.ts` n'appelle PAS `complete_order_with_payment_v10` directement ; il POST l'EF `process-payment` (`useCheckout.ts:124`), et c'est l'EF (`process-payment/index.ts:149`) qui appelle `complete_order_with_payment_v10`. La correction doc reste valide (la version v6 est bien périmée → v10), mais le point d'appel exact est l'EF, pas le hook.

---

## 2. Architecture / approche proposée

**Doc-only.** Mettre à jour `CLAUDE.md:61` (bullet « Order writes go through RPCs ») pour refléter les versions réelles. Proposition de remplacement :

> « **Order writes go through RPCs** — never raw inserts. RPCs : `complete_order_with_payment_v10` (via l'EF `process-payment`), `pay_existing_order_v6`, `create_tablet_order_v2`, `pickup_tablet_order`, `evaluate_promotions_v1`, `mark_item_served`. They handle JE triggers, loyalty, promotions, table state atomically. »

Ajouter (optionnel) une note rappelant la règle RPC versioning monotone : « les versions évoluent — vérifier `supabase/migrations/` + le call-site avant d'affirmer une version ».

**Pas de code, pas de migration, pas de test.** Édition d'un seul bullet du CLAUDE.md.

---

## 3. Critères d'acceptation

- [ ] `CLAUDE.md:61` cite `complete_order_with_payment_v10`, `pay_existing_order_v6`, `create_tablet_order_v2`, `evaluate_promotions_v1` (versions réelles).
- [ ] La nuance « `complete_order_with_payment_v10` appelé via l'EF `process-payment`, pas directement par le POS » est mentionnée (ou au moins ne suggère pas un appel direct depuis le hook).
- [ ] `pickup_tablet_order` et `mark_item_served` restent non-versionnés (corrects).
- [ ] Aucun autre change (doc-only).

## 4. Tests attendus

Aucun test runtime (doc-only). **Vérif manuelle** : un `grep` de chaque nom d'RPC dans `apps/pos/src` + `supabase/functions` confirme la version citée :
```
grep -rn "complete_order_with_payment_v10" supabase/functions
grep -rn "pay_existing_order_v6\|create_tablet_order_v2\|evaluate_promotions_v1" apps/pos/src
```
Optionnel : sweep des autres mentions de versions RPC dans CLAUDE.md (la section §Active Workplan en cite beaucoup, mais elles sont **historiques par session** et ne doivent pas être réécrites — elles décrivent l'état au moment de chaque session, append-only). Seul le bloc **Critical patterns** (assertions présent-tense sur le code courant) doit être synchronisé.

## 5. Hors scope

- Réécriture des références de version dans §Active Workplan (historique append-only par session — NE PAS toucher).
- Bump réel de n'importe quel RPC (doc-only).
- Audit exhaustif de toutes les versions RPC du projet (seul le bullet Critical patterns « Order writes » est en cause).

## 6. Risques / dépendances

- **Risque nul** : doc-only, aucun impact runtime.
- **Attention append-only** : ne pas confondre le bullet Critical patterns (à corriger) avec les références §Active Workplan (historiques, immuables). La règle projet « specs/plans datés append-only » s'applique aussi aux session references du CLAUDE.md.
- Si une nouvelle migration bumpe une de ces RPC entre la rédaction de cette spec et sa réalisation, re-vérifier la version au call-site avant d'éditer.
