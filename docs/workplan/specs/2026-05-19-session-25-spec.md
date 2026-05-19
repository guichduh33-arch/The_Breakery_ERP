# Session 25 — Spec : Hardening Idempotency Cross-EF

**Date :** 2026-05-19
**Branch :** `swarm/session-25` (off `1749d92` post-S24 merge)
**Source de la décision :** plan multi-sessions [`../plans/2026-05-19-S24-to-S30-plan.md`](../plans/2026-05-19-S24-to-S30-plan.md) §3 S25.
**INDEX :** [`../plans/2026-05-19-session-25-INDEX.md`](../plans/2026-05-19-session-25-INDEX.md) (à rédiger Wave 0.1)
**Migration block réservé :** `20260602000010..020`.

---

## 1. Goal

Sweep sécurité ciblé sur deux flux mutateurs critiques exposés par l'audit S23 §2 :

1. **`refund-order` EF** : envoie le PIN manager **en clair dans le body JSON** + ne propage **pas** `p_idempotency_key` au RPC `refund_order_rpc_v2` (alors que ce dernier supporte déjà l'idempotency depuis S13). Conséquence : double-click utilisateur ou retry réseau = double refund + double mouvement de stock + double JE.
2. **`create_tablet_order` RPC** : signature v1 **sans `p_idempotency_key`** depuis 2026-05-07. Asymétrie avec `complete_order_v9` (POS) qui l'a. Un retry tablette = double commande + items en double envoyés à la KDS.

S25 ferme **3 gaps** :

1. Migration PIN manager `refund-order` body → header HTTP `x-manager-pin` (hard cutover) + wire `p_idempotency_key` au RPC `refund_order_rpc_v2` via header `x-idempotency-key`.
2. Bump `create_tablet_order` → `create_tablet_order_v2(p_client_uuid UUID, ...)` avec idempotent replay via table dédiée `tablet_order_idempotency_keys` ; drop v1 dans la même migration (RPC versioning monotonic).
3. Établir le pattern projet : helper Deno `_shared/idempotency.ts` + bloc "Critical patterns" dans CLAUDE.md documentant les deux flavors (HTTP header vs RPC arg).

**Closes** : TASK-17-002 (tablet idempotency), TASK-03-006 partiel (refund PIN-en-header + idempotency wiring), gaps audit 03-1 / 03-2 / 17-1.

**Hors scope (out-of-scope explicite) :**

- Sweep autres EF mutateurs (`void-order`, `cancel-item`, mutations `kiosk-issue-jwt`) : déféré post-S30 si audit identifie des gaps. Le user a explicitement choisi "garder le scope ratifié" lors du brainstorming (2026-05-19).
- pg_cron purge des tables idempotency : reporté S26 (peut s'intégrer dans le batch Comptable Cockpit) ou laissé sans purge vu la volumétrie (~10-50 refunds/jour + ~50-200 tablet orders/jour = ~100k lignes/an, négligeable Postgres).
- BO refund (n'existe pas en V3, sera ajouté post-S30 si besoin) : utilisera la même EF `refund-order` post-S25, donc bénéficie du hardening sans travail supplémentaire.
- Tablet PWA offline queue + sync (TASK-17-001) : reste deferred. S25 ne touche pas l'offline path, juste rend l'online path idempotent (pré-requis pour offline retry plus tard).
- Migration de `useRefundOrder.ts` vers `supabase.functions.invoke()` : conservé en `fetch()` raw (le hook utilise déjà ce pattern pour les headers custom), pas de refactor de surface.

---

## 2. Décisions clés (D1-D7)

| ID | Décision | Rationale |
|----|----------|-----------|
| **D1** | **Hard cutover** PIN body → header. `refund-order` EF n'accepte que `x-manager-pin` dans le header HTTP, drop le champ `manager_pin` du body. POS push dans le même PR. | User a explicitement choisi cette option lors du brainstorming (vs dual-mode ou version bump). Seul caller = POS, deploy atomique faisable. Plus simple à maintenir. PIN en body laisse traces dans access logs / proxies / pgaudit ; header est moins indexé. |
| **D2** | **`refund_order_rpc_v2` n'est PAS bumpée en v3.** L'EF wire `p_idempotency_key` (header `x-idempotency-key`) au RPC existant. | Audit code lors du brainstorming a révélé que `refund_order_rpc_v2` (migration S13 `20260517000014`) **a déjà** `p_idempotency_key UUID DEFAULT NULL` + replay envelope + `refunds.idempotency_key UNIQUE`. La gap est uniquement EF + client, pas DB. Bump v3 serait une migration no-op coûteuse. |
| **D3** | `create_tablet_order_v2` utilise une **table dédiée `tablet_order_idempotency_keys(client_uuid UUID PK, order_id UUID NOT NULL, created_at)`**, pas une colonne `idempotency_key` sur `orders`. | Pattern S24 `b2b_payments` : isolation des keys, pas de NULL columns polluant `orders`, REVOKE plus simple. La table peut être purgée indépendamment sans toucher `orders`. |
| **D4** | **client_uuid généré côté POS** via `crypto.randomUUID()` au moment du tap "Send to kitchen", stocké en `useRef` du composant. Reset uniquement sur success ou dismiss. | Idempotence sémantique métier "ce panier-ci, ce tap-ci". Re-render React preserve l'UUID (useRef). Server génère pas de fallback : si absent → 400 missing_client_uuid (force la migration POS). |
| **D5** | Drop `create_tablet_order` v1 dans **la même migration** que la création de v2 (pattern S13 refund). Hook `useCreateTabletOrder.ts` migré en même temps. | CLAUDE.md "RPC versioning is monotonic — DROP v1 in same migration if replacing". Atomic deploy : DB migration + POS hook commit dans la même session, pas de fenêtre où v1 est gone mais hook l'appelle encore. |
| **D6** | `_shared/idempotency.ts` est un **helper Deno minimaliste** : `getIdempotencyKey(req, opts?)` lit header `x-idempotency-key`, valide UUID v4 regex, retourne `string \| null`. Optional `required: true` → throw `missing_idempotency_key`. | Surface minimale (1 fonction exportée). Pattern conservateur : retourne null si absent (caller décide), ne fait pas de génération côté serveur (briserait l'idempotence client-driven). Documenté en "Critical patterns" CLAUDE.md. |
| **D7** | **Aucune nouvelle perm RBAC.** `create_tablet_order_v2` garde `pos.sale.create` (perm identique à v1). EF `refund-order` garde `pos.sale.refund` côté RPC. | Le hardening ne change pas le modèle d'autorisation, juste les chemins de transport (header vs body). |

---

## 3. Architecture overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Wave 0 — Phase 0.1 : spec + INDEX + branch                          │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Wave 1 — Phase 1.A : DB + EF + client (1 stream serial)             │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Sub-phase 1.A.0 — Pre-flight DB introspection (MCP)          │   │
│  │ Sub-phase 1.A.1 — Migrations _010 / _011 / _012              │   │
│  │ Sub-phase 1.A.2 — Helper _shared/idempotency.ts              │   │
│  │ Sub-phase 1.A.3 — refund-order EF (PIN header + idempotency) │   │
│  │ Sub-phase 1.A.4 — useRefundOrder hook + RefundOrderModal     │   │
│  │ Sub-phase 1.A.5 — useCreateTabletOrder hook (client_uuid)    │   │
│  │ Sub-phase 1.A.6 — Types regen MCP                            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│                     ▼ sync gate (Wave 1 DONE)                       │
│                                                                     │
│  Wave 2 — Phase 2.A : tests                                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ pgTAP idempotency_hardening.test.sql (T1-T8)                 │   │
│  │ Vitest live functions/idempotency-hardening.test.ts (TS1-TS5)│   │
│  │ POS smoke tablet-send-idempotent.smoke.test.tsx              │   │
│  │ POS smoke refund-modal-pin-header.smoke.test.tsx             │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│                     ▼ sync gate (Wave 2 DONE)                       │
│                                                                     │
│  Wave 3 — Phase 3.A : closeout                                       │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Quality gates (typecheck + build + test)                     │   │
│  │ Status notes 03-payments / 17-tablet-ordering                │   │
│  │ Roadmap globale §Sessions + §Indicateurs                     │   │
│  │ CLAUDE.md : bump current session + Critical patterns block   │   │
│  │ INDEX §10 deviations (post-execution)                        │   │
│  │ Commit closeout + push + PR                                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

**Topologie** : 1 stream serial (couplage DB + EF + client trop fort pour paralléliser : tester EF sans hook ou hook sans RPC v2 n'apporte rien).

---

## 4. Détails techniques

### 4.1 — DB layer (3 migrations)

#### 4.1.1 — `20260602000010_create_tablet_order_idempotency_keys_table.sql` (NEW)

```sql
CREATE TABLE tablet_order_idempotency_keys (
  client_uuid UUID PRIMARY KEY,
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tablet_order_idempotency_keys_order_id_idx
  ON tablet_order_idempotency_keys(order_id);

ALTER TABLE tablet_order_idempotency_keys ENABLE ROW LEVEL SECURITY;

-- No direct INSERT/UPDATE/DELETE from authenticated.
REVOKE ALL ON TABLE tablet_order_idempotency_keys FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE tablet_order_idempotency_keys FROM authenticated;
GRANT SELECT ON TABLE tablet_order_idempotency_keys TO authenticated;

CREATE POLICY tablet_order_idempotency_keys_select_auth
  ON tablet_order_idempotency_keys FOR SELECT
  TO authenticated USING (true);

COMMENT ON TABLE tablet_order_idempotency_keys IS
  'S25 — idempotency ledger for create_tablet_order_v2 RPC. client_uuid is generated POS-side.';
```

#### 4.1.2 — `20260602000011_bump_create_tablet_order_v2.sql` (BUMP + DROP v1)

```sql
-- Drop v1 (S5 pattern, also CLAUDE.md RPC versioning rule)
DO $drop$
DECLARE _r RECORD;
BEGIN
  FOR _r IN SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE proname = 'create_tablet_order' AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || _r.sig::text || ' CASCADE';
  END LOOP;
END $drop$;

CREATE OR REPLACE FUNCTION create_tablet_order_v2(
  p_client_uuid  UUID,
  p_waiter_id    UUID,
  p_table_number TEXT,
  p_order_type   order_type,
  p_items        JSONB
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id            UUID;
  v_existing_order_id  UUID;
  v_order_id           UUID;
  -- (... locals identical to v1 ...)
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  IF p_client_uuid IS NULL THEN
    RAISE EXCEPTION 'client_uuid required' USING ERRCODE = 'check_violation';
  END IF;

  -- Idempotent replay check FIRST (before any other work)
  SELECT order_id INTO v_existing_order_id
    FROM tablet_order_idempotency_keys
    WHERE client_uuid = p_client_uuid;

  IF v_existing_order_id IS NOT NULL THEN
    RETURN v_existing_order_id;  -- replay : same UUID back
  END IF;

  IF NOT has_permission(v_user_id, 'sales.create') THEN
    RAISE EXCEPTION 'Permission denied: sales.create' USING ERRCODE = 'P0003';
  END IF;

  -- (... body identical to v1 — order_sequences, INSERT orders, FOR loop items ...)

  -- After successful insert, write the idempotency key
  INSERT INTO tablet_order_idempotency_keys (client_uuid, order_id)
    VALUES (p_client_uuid, v_order_id);

  RETURN v_order_id;
END $$;

GRANT EXECUTE ON FUNCTION create_tablet_order_v2 TO authenticated;
REVOKE EXECUTE ON FUNCTION create_tablet_order_v2 FROM PUBLIC, anon;

COMMENT ON FUNCTION create_tablet_order_v2 IS
  'S25 idempotent variant — p_client_uuid generated POS-side. Replay returns the existing order_id. v1 dropped in same migration (CLAUDE.md RPC versioning rule).';
```

**Note** : la concurrence (deux calls simultanés avec même `client_uuid`) est gérée par le PK sur `tablet_order_idempotency_keys.client_uuid` — le second INSERT échoue avec `unique_violation` (23505), que le RPC catch via `EXCEPTION WHEN unique_violation` + re-read. Pattern à inclure dans le body final.

#### 4.1.3 — `20260602000012_revoke_anon_create_tablet_order_v2.sql` (REVOKE defense-in-depth)

```sql
-- Pattern S20 defense-in-depth : REVOKE FROM PUBLIC en plus de anon explicite.
REVOKE EXECUTE ON FUNCTION create_tablet_order_v2 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_tablet_order_v2 FROM anon;

-- Future-proof : default privileges
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- Defense-in-depth pour la table d'idempotency (déjà fait dans _010 mais explicite ici)
REVOKE ALL ON TABLE tablet_order_idempotency_keys FROM PUBLIC, anon;
```

### 4.2 — EF layer

#### 4.2.1 — `supabase/functions/_shared/idempotency.ts` (NEW)

```ts
// Reads x-idempotency-key header. UUID v4 validation.
// Returns string|null. If `required: true` and header is absent, throws.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class MissingIdempotencyKeyError extends Error {
  readonly code = 'missing_idempotency_key';
}

export class InvalidIdempotencyKeyError extends Error {
  readonly code = 'invalid_idempotency_key';
}

export function getIdempotencyKey(
  req: Request,
  opts: { required?: boolean } = {},
): string | null {
  const raw = req.headers.get('x-idempotency-key');
  if (!raw) {
    if (opts.required) throw new MissingIdempotencyKeyError('x-idempotency-key header required');
    return null;
  }
  if (!UUID_REGEX.test(raw)) {
    throw new InvalidIdempotencyKeyError('x-idempotency-key must be UUID v4');
  }
  return raw;
}
```

#### 4.2.2 — `supabase/functions/refund-order/index.ts` (MODIFY)

Diff résumé :
- Drop `manager_pin: string` du type `RefundOrderPayload`.
- Drop validation `if (!body.manager_pin || ...)`.
- Lire `x-manager-pin` header avant validation body : `const managerPin = req.headers.get('x-manager-pin')`.
- Return 400 `missing_manager_pin` si null.
- Lire `x-idempotency-key` header via `getIdempotencyKey(req)` (optional).
- Passer `p_idempotency_key: idempotencyKey` au RPC `refund_order_rpc_v2`.
- Sur `idempotent_replay: true` dans la réponse RPC, log un entry `audit_logs` avec `action='refund.replay'`.

Erreurs nouvelles : `invalid_idempotency_key` (400) si header présent mais malformé.

#### 4.2.3 — `apps/pos/src/features/order-history/hooks/useRefundOrder.ts` (MODIFY)

Diff résumé :
- `RefundArgs` ajoute champ optionnel `idempotencyKey?: string`.
- `mutationFn` lit `idempotencyKey` (généré par le modal), l'envoie via header `x-idempotency-key` au lieu du body.
- `managerPin` envoyé via header `x-manager-pin`, retiré du body.
- Body ne contient plus que `{ order_id, lines, tenders, reason }`.

```ts
const res = await fetch(`${supabaseUrl}/functions/v1/refund-order`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'x-manager-pin': managerPin,
    ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
  },
  body: JSON.stringify({ order_id: orderId, lines, tenders, reason }),
});
```

#### 4.2.4 — `apps/pos/src/features/order-history/components/RefundOrderModal.tsx` (MODIFY)

Diff résumé :
- Au mount, `useRef(crypto.randomUUID())` stocke un UUID v4. Survit aux re-renders.
- À chaque submit (incluant retry après échec réseau), passe le même UUID à `useRefundOrder.mutate({ ..., idempotencyKey: ref.current })`.
- Sur close du modal (success ou cancel), reset via `ref.current = ''` (nouveau UUID au prochain open).

#### 4.2.5 — `apps/pos/src/features/tablet/hooks/useCreateTabletOrder.ts` (MODIFY)

Diff résumé :
- Signature `mutationFn` prend `clientUuid: string` en paramètre.
- Call `supabase.rpc('create_tablet_order_v2', { p_client_uuid: clientUuid, ... })`.
- Caller (TabletOrderPage) génère et passe l'UUID via `useRef`.

### 4.3 — Tests

#### 4.3.1 — pgTAP `supabase/tests/idempotency_hardening.test.sql` (NEW)

8 cas, plan(8) :

| # | Test | Assertion |
|---|------|-----------|
| T1 | `create_tablet_order_v2` premier call insert orders + idempotency key | `lives_ok` ; ordres + key existent |
| T2 | `create_tablet_order_v2` même `p_client_uuid` deuxième call | retourne même `order_id`, pas de double INSERT orders (`SELECT COUNT(*) FROM orders WHERE ...` = 1) |
| T3 | `create_tablet_order` v1 dropped | `hasnt_function('public', 'create_tablet_order')` |
| T4 | `refund_order_rpc_v2` premier call avec `p_idempotency_key` | refund inséré, replay = false |
| T5 | `refund_order_rpc_v2` même `p_idempotency_key` deuxième call | replay envelope, pas de double stock_movement (`SELECT COUNT(*) FROM stock_movements ...` inchangé) |
| T6 | `tablet_order_idempotency_keys` REVOKE | anon n'a aucun privilège SELECT/INSERT |
| T7 | `tablet_order_idempotency_keys` policy authenticated SELECT | authenticated peut lire ses rows |
| T8 | `create_tablet_order_v2` EXECUTE REVOKE | anon n'a pas EXECUTE (vérifier via `has_function_privilege`) |

Bootstrap : 1 user_profile manager + 1 user_profile cashier + 1 pos_session ouverte + 1 product + 1 order paid pour les tests refund.

#### 4.3.2 — Vitest live `supabase/tests/functions/idempotency-hardening.test.ts` (NEW)

5 scénarios :

| # | Scénario | Assertion |
|---|----------|-----------|
| TS1 | `create_tablet_order_v2` happy path via supabase-js client | retourne order_id valide |
| TS2 | `create_tablet_order_v2` retry même client_uuid | retourne même order_id, `COUNT(orders)` inchangé |
| TS3 | `refund-order` EF avec headers `x-manager-pin` + `x-idempotency-key` happy path | 200, `idempotent_replay: false` |
| TS4 | `refund-order` EF retry même `x-idempotency-key` | 200, `idempotent_replay: true`, `audit_logs.action='refund.replay'` présent |
| TS5 | `refund-order` EF **sans** `x-manager-pin` header | 400 `missing_manager_pin` (hard cutover vérif) |

Cleanup : `afterAll` supprime customers/orders/refunds/idempotency_keys de test (pattern S22 / S24).

#### 4.3.3 — POS smoke `apps/pos/src/features/tablet/__tests__/tablet-send-idempotent.smoke.test.tsx` (NEW)

2 cas :
- `useCreateTabletOrder` mutate avec un clientUuid → RPC reçoit exactement ce UUID en p_client_uuid.
- Re-mutate sans reset → même UUID, RPC mock retourne même order_id, query cache invalidé une seule fois.

#### 4.3.4 — POS smoke `apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx` (NEW)

2 cas :
- Modal ouvre → `useRef` génère un UUID v4. Submit envoie `x-manager-pin` + `x-idempotency-key` dans headers (via fetch mock).
- Retry après échec → même UUID dans header. Close + reopen → nouveau UUID.

---

## 5. Risques + mitigations (R1-R6)

| ID | Risque | Probabilité | Mitigation |
|----|--------|-------------|------------|
| **R1** | Drop `create_tablet_order` v1 + tablette qui n'a pas encore rechargé le bundle JS = 404 RPC | M | Hard cutover OK car single-site mono-tenant et POS web (pas mobile compilé). Recommandation OPS : forcer un hard refresh tablette avant deploy. À documenter dans la PR description. |
| **R2** | `refund_order_rpc_v2.idempotency_key` UNIQUE INDEX est `WHERE idempotency_key IS NOT NULL` (S13 migration `20260517000014:307-313`) — donc 2 refunds sans idempotency_key sont possibles (NULL = NULL en SQL) | L | C'est désiré : un appel sans idempotency est non-idempotent (legacy behavior preserved). S25 EF passe toujours une UUID (ou null si POS retry-safe désactivé temporairement). |
| **R3** | EF `refund-order` retire `manager_pin` du body schema → caller externe (Postman, curl scripts admin manuels) break sans warning | L | Pas de caller documenté hors POS. Mention dans CLAUDE.md "Critical patterns" block + commit message explicite. |
| **R4** | UUID v4 généré par `crypto.randomUUID()` n'est pas dispo sur tous les browsers anciens | L | Tablette terrain = Chromium récent (Android tablet 12+, ChromeBook). `crypto.randomUUID` dispo depuis Chrome 92 (2021). Pas de fallback — si déploiement sur un browser plus ancien identifié, ajouter `import { v4 as uuidv4 } from 'uuid'` (package déjà transitivement présent via supabase-js). Sub-phase 1.A.5 vérifiera la dispo `crypto.randomUUID` côté build target. |
| **R5** | Pattern `_shared/idempotency.ts` documenté mais d'autres EFs ne l'utilisent pas → la "Critical patterns" CLAUDE.md note serait incomplète | M | Préciser en CLAUDE.md que c'est un pattern à appliquer pour tout EF mutateur futur. Audit reste à faire (S26+) pour migrer void-order / cancel-item / kiosk-issue-jwt. Marker en backlog. |
| **R6** | Race condition entre check idempotency + INSERT order = duplicate possible si 2 calls simultanés avec même client_uuid arrivent en parallèle | M | Mitigation dans le RPC : check + insert dans une transaction (déjà implicite avec PL/pgSQL), + EXCEPTION `WHEN unique_violation` qui re-read `tablet_order_idempotency_keys`. Pattern à inclure dans le body migration `_011`. Test pgTAP T2 valide implicitement. |

---

## 6. Definition of Done (DoD)

### Wave 1 (DB + EF + client)

- [ ] 3 migrations `_010..012` apply_migration via MCP sur `ikcyvlovptebroadgtvd` sans erreur.
- [ ] `mcp__plugin_supabase_supabase__list_migrations` confirme les 3 versions présentes.
- [ ] `_shared/idempotency.ts` créé.
- [ ] `refund-order/index.ts` : PIN body retiré, header `x-manager-pin` requis, `p_idempotency_key` propagé.
- [ ] `useRefundOrder.ts` + `RefundOrderModal.tsx` : headers + UUID lifecycle.
- [ ] `useCreateTabletOrder.ts` : signature avec `clientUuid`, RPC v2.
- [ ] Types regen MCP committed dans `packages/supabase/src/types.generated.ts`.

### Wave 2 (tests)

- [ ] pgTAP 8/8 passes via MCP `execute_sql` BEGIN/ROLLBACK envelope.
- [ ] Vitest live 5/5 passes : `cd supabase/tests && npx vitest run functions/idempotency-hardening`.
- [ ] POS smoke 4/4 passes : `pnpm --filter @breakery/app-pos test idempotent` + `... test pin-header`.
- [ ] `pnpm typecheck` global green.
- [ ] `pnpm build` global green.

### Wave 3 (closeout)

- [ ] Status notes datées sur `03-payments-split.md` (TASK-03-006 partiel DONE) + `17-tablet-ordering.md` (TASK-17-002 DONE).
- [ ] Roadmap globale §Sessions ligne S25 + §Indicateurs 2 lignes.
- [ ] CLAUDE.md : current session pointer bump + Critical patterns block enrichi (PIN-en-header + Idempotency 2-flavors).
- [ ] INDEX §10 deviations finalisé.
- [ ] PR créée vers master, mergée par le user.

---

## 7. Liens

- Plan multi-sessions parent : [`../plans/2026-05-19-S24-to-S30-plan.md`](../plans/2026-05-19-S24-to-S30-plan.md) §3 S25
- Roadmap globale : [`../backlog-by-module/00-roadmap-globale.md`](../backlog-by-module/00-roadmap-globale.md)
- Backlogs modules concernés :
  - [`../backlog-by-module/03-payments-split.md`](../backlog-by-module/03-payments-split.md)
  - [`../backlog-by-module/17-tablet-ordering.md`](../backlog-by-module/17-tablet-ordering.md)
- Pattern idempotency précédent (S13 refund_order_rpc_v2) : `supabase/migrations/20260517000014_bump_refund_order_rpc_v2.sql`
- Pattern idempotency S24 (b2b_payments) : `supabase/migrations/20260601000010_create_b2b_payments_table.sql`
- Pattern REVOKE defense-in-depth S20 : `supabase/migrations/20260524000020..031`
- Conventions code : [`../../../CLAUDE.md`](../../../CLAUDE.md)

---

## 8. Out-of-scope confirmé (déféré post-S25)

- Sweep autres EF mutateurs (`void-order`, `cancel-item`, `kiosk-issue-jwt` mutations) : audit + migration à programmer post-S30.
- pg_cron purge tables idempotency : laissé sans purge (volumétrie négligeable) ou intégré en S26 batch.
- BO refund UI (n'existe pas) : utilisera le même EF post-S25, pas de travail supplémentaire.
- Tablet PWA offline queue + sync (TASK-17-001) : reste deferred. S25 est un pré-requis (idempotence online), pas une livraison offline.
- Migration `useRefundOrder.ts` vers `supabase.functions.invoke()` : pas de refactor de surface, conservé en `fetch()` raw.
