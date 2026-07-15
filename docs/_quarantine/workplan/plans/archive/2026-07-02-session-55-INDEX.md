# Session 55 — INDEX : P1.5 « Durcissement EF restant (T7) »

- **Date** : 2026-07-02 (mergé master 2026-07-03, PR #138, commit `3567993`)
- **Branche** : `swarm/session-55` (squash-mergée)
- **Spec** : [`docs/superpowers/specs/2026-07-02-ef-hardening-p15-design.md`](../../superpowers/specs/2026-07-02-ef-hardening-p15-design.md)
- **Plan** : [`docs/superpowers/plans/2026-07-02-session-55-ef-hardening-p15.md`](../../superpowers/plans/2026-07-02-session-55-ef-hardening-p15.md)
- **Audit source** : §4 P1.5 (T7) de `docs/workplan/audits/2026-06-27-audit-integral-par-module.md`
- **Note closeout** : cet INDEX + le bump CLAUDE.md (Task 9 du plan) n'ont pas été livrés dans la PR #138 — rattrapés en ouverture de S56 (voir DEV-S55-03).

## Objectif

Fermer **T7** : idempotency EF-retry-safety (flavor 1 S25) sur void-order/cancel-item, et sortie du PIN discount des args SQL de la money-path (v15 → v16 + nonce single-use vérifié dans l'EF).

## Constat T0 (2 items déjà couverts, attestés dans le source repo)

- `auth-change-pin` : rate-limit durable présent (`checkRateLimitDurable`, `supabase/functions/auth-change-pin/index.ts:50`).
- `notification-dispatch` : secret lu en header `x-dispatch-secret` (S50 V2a-i T6), plus de `?secret=` query param.

## Livré

1. **`void_order_rpc_v4`** (`_082`, DROP v3) : replay idempotent via `refunds.idempotency_key` (lookup en tête + catch `unique_violation` sur l'INSERT `refunds`) ; enveloppe v3 + `idempotent_replay: true` sur replay.
2. **`cancel_order_item_rpc_v3`** (`_083`, DROP v2) : nouvelle colonne **`order_items.cancel_idempotency_key UUID`** + index unique partiel ; replay renvoie l'enveloppe du premier cancel au lieu de « Item already cancelled ».
3. **REVOKE reversal v4/v3 from `authenticated`** (`_084`, migration ajoutée hors plan — DEV-S55-01) + refresh de la suite de régression `reversal_rpc_revoke`.
4. **Table `discount_authorizations`** (`_085`) : nonce single-use service-role-only (TTL 60 s, `consumed_at`/`consumed_order_id`, RLS deny par défaut).
5. **`complete_order_with_payment_v16`** (`_086`, DROP v15) : `p_manager_pin text` → **`p_discount_auth_id uuid`** ; consommation atomique du nonce (même manager, non consommé, non expiré) sinon P0003 mot-pour-mot v15 ; trace `consumed_order_id`. ⚠️ **caveat S51 reporté sur v16 : `GRANT EXECUTE TO authenticated` OBLIGATOIRE** (l'EF appelle avec le JWT utilisateur).
6. **EFs `void-order` / `cancel-item`** : lisent `x-idempotency-key` (`getIdempotencyKey`, 400 `invalid_idempotency_key` si malformée) → relaient `p_idempotency_key` aux RPCs v4/v3 ; redéployées.
7. **EF `process-payment`** : vérifie le PIN discount **in-EF** (helpers `_shared/manager-pin.ts` : lockout per-IP, `checkPermissionForRole('sales.discount')`), **mint le nonce** et appelle v16 — `p_discount_authorized_by` désormais **dérivé du PIN vérifié**, plus aucun PIN en arg SQL ; bloc S38 `record_pin_failure_v1` supprimé ; redéployée.
8. **POS** : clés d'idempotence per-modal (`useRef(crypto.randomUUID())`, rotation à la fermeture) sur `VoidOrderModal`/`BottomActionBar`/`CancelItemModal` ; hooks `useVoidOrder`/`useCancelOrderItem`/`useVoidServerOrder` acceptent `idempotencyKey` ; smoke `void-idempotency-header.smoke.test.tsx` (239 l.).

## Migrations

| # | Fichier |
|---|---|
| `20260710000082` | `void_order_rpc_v4_idempotency` |
| `20260710000083` | `cancel_order_item_rpc_v3_idempotency` |
| `20260710000084` | `revoke_reversal_v4_v3_from_authenticated` |
| `20260710000085` | `create_discount_authorizations` |
| `20260710000086` | `complete_order_v16_discount_auth_nonce` |

Types regénérés (`types.generated.ts`, commit « chore(types): regen … _082..086 »).

## Tests

- **Nouvelles suites pgTAP** : `reversal_idempotency.test.sql` (void + cancel : replay, race, clé étrangère → 23514) ; `discount_auth_nonce.test.sql` (T1-T6 : NULL → P0003, nonce valide consommé, replay/expiré/mauvais manager → P0003, chemin sans discount intact).
- **Suites repointées v16/v4/v3** (sweep) : `canonical_line_price`, `combo_reversal`, `combo_sale`, `modifier_ingredient_deduction`, `order_discount_gate`, `reversal_rpc_revoke`, `s44_money_gates`, `s44_display_symmetry`, `sale_flag_aware_deduction`, `loyalty_transactions_append_only` — **11 suites re-passées vertes via runner API** après correction des trous de sweep (DEV-S55-02).
- **App** : smoke POS void-idempotency + suites void/cancel/refund existantes ; typecheck/build verts (gate CI types-regen passé).

## Déviations

| ID | Quoi | Pourquoi | Risque |
|---|---|---|---|
| DEV-S55-01 | Migration supplémentaire `_084` (REVOKE v4/v3 from `authenticated`) → `discount_authorizations` décalée en `_085` et v16 en `_086` (le plan disait `_084`/`_085`) | Les reversals sont EF-only (service_role) ; le grant `authenticated` hérité était superflu — durcissement saisi en cours de session | Informational |
| DEV-S55-02 | Trous de sweep détectés au run live : 3 suites pgTAP appelaient encore `void_order_rpc_v3` (droppée par `_082`) + fixture UUID non-hexadécimale (`55dn`→`55da`) dans `discount_auth_nonce` | Sweep grep initial incomplet | Corrigé pré-merge |
| DEV-S55-03 | **Closeout Task 9 non livré dans la PR** (INDEX + bump CLAUDE.md) | Session close sans la passe docs | Rattrapé en ouverture S56 (ce fichier) |

## Suite

- **S56** : UI déférées + reliquat B2B/compta — **DEV-S54-01** (cockpit « Clôture annuelle » + erreur `period_undefined`), **DEV-S52-03** (liste-factures B2B, allocation ciblée `invoiceIds` + Cancel par facture), **P2.2 reliquat** (consolidation audit `audit_log`/`audit_logs` sur 1 table).
