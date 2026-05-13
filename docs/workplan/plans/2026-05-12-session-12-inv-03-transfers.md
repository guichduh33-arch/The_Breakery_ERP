# Session 12 — Phase 3 sub-plan : Transfers (inter-section)

> **Date** : 2026-05-13
> **Branche** : `swarm/session-12-phase-3`
> **Parent INDEX** : [`./2026-05-12-session-12-inventory-complete-INDEX.md`](./2026-05-12-session-12-inventory-complete-INDEX.md)
> **Spec source** : [`../specs/2026-05-12-session-12-inventory-complete-spec.md`](../specs/2026-05-12-session-12-inventory-complete-spec.md) §3.2.4-3.2.5, §3.3 (Phase 3), §4.2-4.4, §5.x, §6.4

## Contexte (état au démarrage)

Phase 1 + Phase 2 sont en prod sur `swarm/session-12-phase-2` (commits 751980… → 2f37087) :

- ✅ `sections` (5 seedées) + `stock_locations` + `section_stock` cache
- ✅ `movement_type` enum étendu : `transfer_in`, `transfer_out`, `incoming`, `adjustment_in/out`, `opname_in/out`, `production_in/out`
- ✅ `stock_movements` extensions : `from_section_id`, `to_section_id`, `unit` (NOT NULL), `unit_cost`, `reason`, `supplier_id`, `idempotency_key`, `metadata`
- ✅ CHECK `chk_stock_movements_transfer_both_sections` (transfer_in/out exigent BOTH sections)
- ✅ Permissions Phase 1 seedées : `inventory.transfer.create`, `inventory.transfer.receive` (MANAGER+ via has_permission v8)
- ✅ Primitive `record_stock_movement_v1` (v2 avec p_unit + idempotency) — INTERNAL REVOKE EXECUTE
- ✅ Page `/backoffice/inventory` (Stock) + `/backoffice/inventory/incoming` opérationnelles

**Périmètre Phase 3** = livrer le cycle transferts inter-sections complet : tables + 3 RPCs + UI 3 pages + tests (pgTAP T21-T40 + Vitest live + BO).

## Décisions

- **Migrations** : prochaine séquence monotonic à partir de `20260516000022` (next slot après `…21_create_record_incoming_stock_rpc.sql`). Plan : 2 migrations seulement (init tables + RPCs combinés ; helper fonction `emit_transfer_movements` inline dans le RPC `receive_internal_transfer_v1` pour économiser un slot).
- **State machine** : `draft` → `pending` (créé par `create_internal_transfer_v1` mode normal) → `received` (par `receive_internal_transfer_v1`). Mode `send_directly=true` → bypass pending et fait `pending` → `received` atomiquement dans la même transaction. `cancelled` accessible depuis `draft` ou `pending` seulement (jamais après réception).
  - `in_transit` mentionné dans la spec mais non utilisé MVP — pas de mouvement physique géré séparément ; on garde le statut dans la check constraint pour usage futur. Pas de RPC qui le set en Phase 3.
- **Format `transfer_number`** : `TRF-YYYYMMDD-XXXX` où XXXX est un compteur quotidien — calculé inline via `count(*) + 1` filtré sur la même date (lock advisory si besoin futur ; conflit faible volume). Cohérent avec format `purchase_order_number` en spec Purchasing.
- **Émission mouvements** (réception) : par item appellé via `record_stock_movement_v1` 2 fois :
  - `transfer_out` quantity = `-qty_received`, `from_section_id` = source, `to_section_id` = dest
  - `transfer_in`  quantity = `+qty_received`, `from_section_id` = source, `to_section_id` = dest
  - Les 2 mouvements ont `metadata` contenant `{ transfer_id, transfer_number, transfer_item_id }` pour le drill-down de Phase 6.
  - **CHECK** `chk_stock_movements_transfer_both_sections` (migration `…16`) impose BOTH sections sur transfer_in/out → on passe les 2 IDs aux 2 mouvements.
- **section_stock update** : on UPDATE / UPSERT atomiquement `section_stock(from_section, product)` (décrément) et `section_stock(to_section, product)` (incrément) après chaque paire de mouvements. Si la row n'existe pas, INSERT initial à la `qty_received`. Maintient le cache phase 1.
- **`products.current_stock` ne change PAS** sur transfer (le stock global est inchangé puisqu'on ne fait que déplacer entre sections). `record_stock_movement_v1` actuel met à jour `products.current_stock` — donc on **n'utilise pas** la primitive directement pour transfer (les 2 mouvements signés s'annulent au niveau global) MAIS la primitive accepte des deltas signés correctement : transfer_out=-X + transfer_in=+X → somme = 0 sur products.current_stock. ✅ comportement attendu, on garde l'API primitive.
- **Idempotency `receive_internal_transfer_v1`** : la primitive `record_stock_movement_v1` accepte `p_idempotency_key`. On dérive 2 clés sub-déterministes depuis `p_idempotency_key` + suffixes : `${p_idempotency_key}-out-${item_id}` et `${p_idempotency_key}-in-${item_id}` (via `gen_random_uuid()` n'est pas idéal — on utilise plutôt UUIDv5 manual ou simplement vérifier idempotence au niveau du header transfer : si `status='received'` et même `p_idempotency_key` → return cached result). Stratégie retenue : **idempotence au niveau header** — `internal_transfers` reçoit une nouvelle colonne `received_idempotency_key UUID NULL UNIQUE` ; replay → return existing result, no movements.
- **Idempotency `create_internal_transfer_v1`** : colonne `created_idempotency_key UUID NULL UNIQUE` sur header. Replay → return existing transfer row.
- **Concurrency** : `SELECT … FOR UPDATE` sur `internal_transfers` row avant tout changement de statut (mitige race condition de double-receive).
- **Validations** :
  - `p_from_section_id != p_to_section_id` → `from_to_same_section`
  - `jsonb_array_length(p_items) > 0` → `items_required`
  - chaque item : `product_id` non-null + actif (`is_active=true AND deleted_at IS NULL`) + `quantity > 0` → `product_inactive` / `quantity_must_be_positive`
  - Pas de doublon `product_id` dans `p_items` (DB CHECK via UNIQUE `(transfer_id, product_id)` + pre-check côté RPC pour erreur claire)
  - Lors de la réception : `quantity_received >= 0` (autorise 0 pour "rien reçu" sur cet item) et `<= quantity_requested` → `quantity_received_invalid` (politique restrictive ; on autorise pas de surplus à la réception)
- **Cancel** : `cancel_internal_transfer_v1(p_transfer_id, p_reason)` permis si `status IN ('draft', 'pending')`. Si `status IN ('received', 'cancelled')` → erreur `cancel_not_allowed_in_status`. Reason >= 3 chars. Stocké dans `metadata.cancel_reason`. Status → `cancelled`.
- **Permissions** :
  - `create_internal_transfer_v1` → `inventory.transfer.create` (MANAGER+ via has_permission v8)
  - `receive_internal_transfer_v1` → `inventory.transfer.receive` (MANAGER+ idem)
  - `cancel_internal_transfer_v1` → `inventory.transfer.create` (créateur peut annuler)
- **`send_directly` semantics** : sets `status='received'` directement dans la création + émet les mouvements + bypass approbation. Les `quantity_received = quantity_requested` pour chaque item automatiquement. Utile pour livraisons internes immédiates ("je porte 2 sacs de farine de l'entrepôt vers la cuisine maintenant").
- **Sidebar** : pas de restructuration en Phase 3 (cohérent avec spec C21 — la sidebar reste flat à 1 entrée Inventory pour Phase 2+3 ; le groupe Inventory avec 7 sous-entrées est livré quand Phases 4-7 sont opérationnelles).
- **`approved_by`** : renseigné à `auth.uid()` (le user qui exécute `receive_internal_transfer_v1`).
- **Timestamps** : `transferred_at = now()` quand status → pending ; `received_at = now()` quand status → received. Pour `send_directly`, les 2 timestamps sont identiques.

## File structure cible

| Action | Path | Notes |
|---|---|---|
| CREATE | `supabase/migrations/20260516000022_init_internal_transfers.sql` | tables internal_transfers + transfer_items + RLS lockdown + helper genère transfer_number |
| CREATE | `supabase/migrations/20260516000023_create_internal_transfer_rpcs.sql` | 3 RPCs : create / receive / cancel (helper `emit_transfer_movements_v1` interne inline) |
| MODIFY | `supabase/tests/inventory.test.sql` | APPEND `SELECT plan(40)` (était 20) + T21-T28 (phase 2 gap-closure) + T29-T40 (transfers) |
| CREATE | `supabase/tests/functions/inventory-transfers.test.ts` | Vitest live RPC : full cycle + send_directly + idempotency + concurrent receive |
| CREATE | `packages/domain/src/inventory/types.ts` (MODIFY) | extend with TransferStatus, TransferInput, TransferItemInput, TransferReceiveInput |
| CREATE | `packages/domain/src/inventory/validateTransfer.ts` | pure-TS validators |
| CREATE | `packages/domain/src/inventory/__tests__/validateTransfer.test.ts` | ≥10 unit tests |
| CREATE | `packages/domain/src/inventory/index.ts` (MODIFY) | export new types + validator |
| CREATE | `apps/backoffice/src/features/inventory-transfers/hooks/useInternalTransfers.ts` | list query (status filter, section filter) |
| CREATE | `apps/backoffice/src/features/inventory-transfers/hooks/useTransferDetail.ts` | detail by id |
| CREATE | `apps/backoffice/src/features/inventory-transfers/hooks/useCreateTransfer.ts` | mutation create |
| CREATE | `apps/backoffice/src/features/inventory-transfers/hooks/useReceiveTransfer.ts` | mutation receive |
| CREATE | `apps/backoffice/src/features/inventory-transfers/hooks/useCancelTransfer.ts` | mutation cancel |
| CREATE | `apps/backoffice/src/features/inventory-transfers/components/TransferStatusBadge.tsx` | colored badge |
| CREATE | `apps/backoffice/src/features/inventory-transfers/components/TransferFormFields.tsx` | from/to selects + notes + send_directly toggle |
| CREATE | `apps/backoffice/src/features/inventory-transfers/components/TransferItemsTable.tsx` | items add/remove + qty |
| CREATE | `apps/backoffice/src/features/inventory-transfers/components/TransferReceiveModal.tsx` | per-item qty_received form |
| CREATE | `apps/backoffice/src/features/inventory-transfers/components/TransferCancelConfirm.tsx` | confirm modal reason >=3 chars |
| CREATE | `apps/backoffice/src/pages/TransfersList.tsx` | route page |
| CREATE | `apps/backoffice/src/pages/TransferForm.tsx` | route page (create) |
| CREATE | `apps/backoffice/src/pages/TransferDetail.tsx` | route page (detail + receive + cancel) |
| CREATE | `apps/backoffice/src/features/inventory-transfers/__tests__/TransferFormFields.test.tsx` | validation + send_directly toggle |
| CREATE | `apps/backoffice/src/features/inventory-transfers/__tests__/TransferReceiveModal.test.tsx` | partial + total |
| CREATE | `apps/backoffice/src/pages/__tests__/TransfersList.test.tsx` | smoke |
| MODIFY | `apps/backoffice/src/routes/index.tsx` | 3 nouvelles routes |
| MODIFY (regen) | `packages/supabase/src/types.generated.ts` | via `pnpm db:types` |

## Task A — Migration tables internal_transfers + transfer_items

**File:** `supabase/migrations/20260516000022_init_internal_transfers.sql`

**Contenu**

```sql
-- 20260516000022_init_internal_transfers.sql
-- Session 12 / Phase 3 — Tables internal_transfers + transfer_items.
--
-- État du cycle : draft → pending → (in_transit) → received | cancelled.
--   - draft     : créé en mode brouillon (UI peut sauvegarder sans soumettre).
--   - pending   : soumis, en attente de réception.
--   - in_transit: réservé pour usage futur (mouvements physiques séparés) ; non émis par les RPCs MVP.
--   - received  : réceptionné côté destination, mouvements transfer_in/out émis.
--   - cancelled : annulé avant réception.
--
-- transfer_number format : TRF-YYYYMMDD-XXXX (compteur quotidien).
-- RLS lockdown : auth_read seulement, writes via RPCs SECURITY DEFINER uniquement.

CREATE TABLE internal_transfers (
  id                        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number           TEXT         NOT NULL UNIQUE,
  from_section_id           UUID         NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  to_section_id             UUID         NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  status                    TEXT         NOT NULL DEFAULT 'pending'
                                            CHECK (status IN ('draft','pending','in_transit','received','cancelled')),
  notes                     TEXT,
  created_by                UUID         NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  approved_by               UUID         REFERENCES user_profiles(id) ON DELETE RESTRICT,
  transferred_at            TIMESTAMPTZ,
  received_at               TIMESTAMPTZ,
  created_idempotency_key   UUID         UNIQUE,
  received_idempotency_key  UUID         UNIQUE,
  metadata                  JSONB        NOT NULL DEFAULT '{}'::JSONB,
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (from_section_id <> to_section_id)
);

CREATE INDEX idx_internal_transfers_status_created
  ON internal_transfers(status, created_at DESC);
CREATE INDEX idx_internal_transfers_from_section
  ON internal_transfers(from_section_id, created_at DESC);
CREATE INDEX idx_internal_transfers_to_section
  ON internal_transfers(to_section_id, created_at DESC);

CREATE TRIGGER internal_transfers_set_updated_at
  BEFORE UPDATE ON internal_transfers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE transfer_items (
  id                  UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id         UUID           NOT NULL REFERENCES internal_transfers(id) ON DELETE CASCADE,
  product_id          UUID           NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity_requested  DECIMAL(10,3)  NOT NULL CHECK (quantity_requested > 0),
  quantity_received   DECIMAL(10,3)  CHECK (quantity_received IS NULL OR quantity_received >= 0),
  unit                TEXT           NOT NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),
  UNIQUE (transfer_id, product_id)
);

CREATE INDEX idx_transfer_items_transfer
  ON transfer_items(transfer_id);
CREATE INDEX idx_transfer_items_product
  ON transfer_items(product_id);

CREATE TRIGGER transfer_items_set_updated_at
  BEFORE UPDATE ON transfer_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Helper : générer le prochain transfer_number pour la date courante.
-- Lock advisory (clé = epoch jour) pour éviter doublons en cas d'écriture concurrente.
CREATE OR REPLACE FUNCTION next_transfer_number()
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_day TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDD');
  v_count INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('next_transfer_number-' || v_day));
  SELECT COUNT(*) + 1 INTO v_count
    FROM internal_transfers
   WHERE transfer_number LIKE 'TRF-' || v_day || '-%';
  RETURN 'TRF-' || v_day || '-' || lpad(v_count::text, 4, '0');
END $$;

REVOKE EXECUTE ON FUNCTION next_transfer_number FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION next_transfer_number FROM authenticated;
-- Appelable seulement par les RPCs SECURITY DEFINER owner.

-- ──────────────────────────────────────────────────────────────────────────────
-- RLS : auth_read seulement, writes via RPCs SECURITY DEFINER uniquement.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE internal_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfer_items     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON internal_transfers FOR SELECT
  USING (is_authenticated() AND has_permission(auth.uid(), 'inventory.read'));

CREATE POLICY "auth_read" ON transfer_items FOR SELECT
  USING (is_authenticated() AND has_permission(auth.uid(), 'inventory.read'));

REVOKE INSERT, UPDATE, DELETE ON internal_transfers FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON transfer_items     FROM authenticated;

COMMENT ON TABLE internal_transfers IS
  'Phase 3 — Transferts inter-sections. Source de vérité du cycle de vie. '
  'Mouvements émis via record_stock_movement_v1 par receive_internal_transfer_v1.';
COMMENT ON COLUMN internal_transfers.status IS
  'draft (brouillon) / pending (soumis) / in_transit (réservé futur) / received (clos) / cancelled.';
COMMENT ON COLUMN internal_transfers.created_idempotency_key IS
  'Idempotency UUID pour create_internal_transfer_v1 replay-safe.';
COMMENT ON COLUMN internal_transfers.received_idempotency_key IS
  'Idempotency UUID pour receive_internal_transfer_v1 replay-safe.';
```

**Commit** : `feat(db): session 12 — phase 3 — internal_transfers + transfer_items tables + RLS lockdown`

## Task B — Migration RPCs

**File:** `supabase/migrations/20260516000023_create_internal_transfer_rpcs.sql`

**RPC signatures**

```sql
create_internal_transfer_v1(
  p_from_section_id    UUID,
  p_to_section_id      UUID,
  p_items              JSONB,     -- [{product_id, quantity, unit?, notes?}]
  p_notes              TEXT          DEFAULT NULL,
  p_send_directly      BOOLEAN       DEFAULT false,
  p_idempotency_key    UUID          DEFAULT NULL
) RETURNS JSONB
-- Returns: {transfer_id, transfer_number, status, idempotent_replay, [movements: [...]] when send_directly}

receive_internal_transfer_v1(
  p_transfer_id        UUID,
  p_received_items     JSONB,     -- [{item_id, quantity_received}]
  p_idempotency_key    UUID          DEFAULT NULL
) RETURNS JSONB
-- Returns: {transfer_id, status:'received', movements: [{item_id, transfer_out_movement_id, transfer_in_movement_id}], idempotent_replay}

cancel_internal_transfer_v1(
  p_transfer_id        UUID,
  p_reason             TEXT
) RETURNS JSONB
-- Returns: {transfer_id, status:'cancelled', cancel_reason}
```

**Logique create**

1. `IF NOT has_permission(auth.uid(), 'inventory.transfer.create')` → `forbidden` P0003.
2. Idempotency replay : `SELECT id, transfer_number, status FROM internal_transfers WHERE created_idempotency_key = p_idempotency_key` ; si trouvé → return cached payload + `idempotent_replay=true`.
3. Validations :
   - `p_from_section_id = p_to_section_id` → `from_to_same_section`.
   - Sections existent + actives + non-deleted (lookup x2) → sinon `section_not_found`.
   - `jsonb_array_length(p_items) = 0` → `items_required`.
   - Pour chaque item dans `p_items` : product existe + `is_active` + `deleted_at IS NULL` ; quantity > 0 ; unit fallback `products.unit ?? 'pcs'` si non fourni dans le JSONB ; pas de doublon `product_id` dans la liste → sinon `duplicate_product_in_items`.
4. Lock advisory `next_transfer_number()` → `v_transfer_number`.
5. Insert `internal_transfers` row : status = `p_send_directly ? 'received' : 'pending'`, `transferred_at = now()`, `received_at = (p_send_directly ? now() : NULL)`, `approved_by = (p_send_directly ? v_profile : NULL)`, `created_idempotency_key = p_idempotency_key`.
6. Insert N rows `transfer_items`. Si `p_send_directly` → set `quantity_received = quantity_requested` pour chaque item.
7. Si `p_send_directly` → appelle helper inline `_emit_transfer_movements(v_transfer_id)` (cf. ci-dessous).
8. Audit log.
9. Return JSONB.

**Logique receive**

1. `IF NOT has_permission(auth.uid(), 'inventory.transfer.receive')` → `forbidden` P0003.
2. Lock row : `SELECT … FROM internal_transfers WHERE id = p_transfer_id FOR UPDATE`. Si pas trouvé → `transfer_not_found` P0002.
3. Idempotency replay : si `received_idempotency_key = p_idempotency_key AND status = 'received'` → return cached payload (rebuild movements list from stock_movements WHERE metadata->>'transfer_id' = v_transfer_id::text) + `idempotent_replay=true`.
4. Si `status NOT IN ('pending', 'in_transit')` → `receive_not_allowed_in_status`.
5. Pour chaque entry de `p_received_items` : UPDATE `transfer_items.quantity_received` (CHECK `>= 0 AND <= quantity_requested`).
6. UPDATE `internal_transfers` : `status='received'`, `received_at=now()`, `approved_by=v_profile`, `received_idempotency_key=p_idempotency_key`.
7. Helper inline `_emit_transfer_movements(v_transfer_id)` :
   - Pour chaque `transfer_items` row où `quantity_received > 0` :
     - call `record_stock_movement_v1(product_id, 'transfer_out', -qty_received, reason='Transfer TRF-... out', p_unit=unit, p_supplier_id=NULL)` puis UPDATE `from_section_id`/`to_section_id` + metadata sur la row insérée. **Problème** : la primitive actuelle n'accepte pas sections en paramètres. Approche : **insert direct dans stock_movements** depuis le helper SECURITY DEFINER, sans passer par la primitive (pattern V2 reference §inventory). Plus simple : on **étend la primitive** pour accepter `p_from_section_id`, `p_to_section_id`, `p_metadata` en params optionnels (rétro-compat → DEFAULT NULL).
   - **Décision** : créer une **v3 de `record_stock_movement_v1`** dans cette migration (drop v2, recreate v3) avec ajout de `p_from_section_id`, `p_to_section_id`, `p_metadata` en fin de signature, defaults NULL. Permet aux RPCs Phase 4-5 (production / opname) de réutiliser le même contrat.
     - **Note** : la v3 doit aussi gérer la mise à jour `section_stock` côté delta (signed : `transfer_out` décrémente from, `transfer_in` incrémente to ; pour `purchase`/`incoming`/`adjustment`/`waste` → optionnel selon présence des section IDs).
   - 2 mouvements émis par item : `transfer_out` (qty négatif, from→to) puis `transfer_in` (qty positif, from→to). Les 2 ont BOTH from/to sections renseignées (CHECK respecté).
8. Audit log par mouvement.
9. Return JSONB.

**Logique cancel**

1. `IF NOT has_permission(auth.uid(), 'inventory.transfer.create')` → `forbidden`.
2. `length(trim(p_reason)) < 3` → `reason_required`.
3. Lock row FOR UPDATE.
4. Si `status NOT IN ('draft', 'pending')` → `cancel_not_allowed_in_status`.
5. UPDATE status='cancelled', metadata=metadata || jsonb_build_object('cancel_reason', p_reason, 'cancelled_by', v_profile, 'cancelled_at', now()).
6. Audit log.
7. Return JSONB.

**Migration v3 record_stock_movement_v1** (extends v2)

```sql
DROP FUNCTION IF EXISTS record_stock_movement_v1(
  UUID, movement_type, DECIMAL(10,3), TEXT, DECIMAL(14,2), UUID, UUID, TEXT
);

CREATE OR REPLACE FUNCTION record_stock_movement_v1(
  p_product_id        UUID,
  p_movement_type     movement_type,
  p_quantity          DECIMAL(10,3),
  p_reason            TEXT,
  p_unit_cost         DECIMAL(14,2)  DEFAULT NULL,
  p_supplier_id       UUID           DEFAULT NULL,
  p_idempotency_key   UUID           DEFAULT NULL,
  p_unit              TEXT           DEFAULT NULL,
  p_from_section_id   UUID           DEFAULT NULL,
  p_to_section_id     UUID           DEFAULT NULL,
  p_metadata          JSONB          DEFAULT '{}'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_profile  UUID;
  v_current  DECIMAL(10,3);
  v_new      DECIMAL(10,3);
  v_mvt_id   UUID;
  v_unit     TEXT;
BEGIN
  -- (same body as v2 + INSERT now passes from_section_id, to_section_id, metadata)
  -- + section_stock UPSERT block at the end (if from_section OR to_section provided)
  ...
END $$;
REVOKE EXECUTE ON FUNCTION record_stock_movement_v1 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_stock_movement_v1 FROM authenticated;
```

**Commit** : `feat(db): session 12 — phase 3 — internal transfer RPCs (create/receive/cancel) + record_stock_movement v3 (sections+metadata)`

## Task C — pgTAP T21-T40

**File:** `supabase/tests/inventory.test.sql` (APPEND, bump `SELECT plan(40)`).

### Phase 2 gap-closure T21-T28 (étaient annoncés mais pas écrits)

- T21 — `get_stock_levels_v1` paginated total_count correct (10 produits seedés, limit=5, offset=0 → total_count=10+).
- T22 — `get_stock_levels_v1` p_search filtre SKU + name (insensible casse).
- T23 — `get_stock_levels_v1` p_category_id filtre exact.
- T24 — `get_stock_levels_v1` p_low_stock_only filtre via `min_stock_threshold` (déjà partiellement T12 — étendre).
- T25 — `adjust_stock_v1` p_new_qty `0` autorisé (set stock to 0).
- T26 — `adjust_stock_v1` idempotency replay → même `movement_id` + `idempotent_replay=true` (déjà T4 — supprimer dupli ou ajouter variante avec reason différent).
- T27 — `waste_stock_v1` reason < 3 chars → `reason_required`.
- T28 — `waste_stock_v1` qty > current_stock → `insufficient_stock`.

### Phase 3 transfers T29-T40

- T29 — Création happy path (ADMIN, mode pending) : status='pending', `transfer_number` matches `TRF-YYYYMMDD-0001`, 2 items insérés.
- T30 — `from_section_id = to_section_id` → `from_to_same_section`.
- T31 — `jsonb_array_length(p_items) = 0` → `items_required`.
- T32 — Doublon `product_id` dans p_items → `duplicate_product_in_items`.
- T33 — `send_directly=true` → status='received', `received_at IS NOT NULL`, `approved_by IS NOT NULL`, 2 mouvements émis par item (transfer_out + transfer_in), `section_stock` mis à jour pour les 2 sections.
- T34 — Receive happy path : status='pending' → `receive_internal_transfer_v1` avec qty_received = qty_requested → status='received', 2 mouvements par item, section_stock OK.
- T35 — Receive sur transfer status='cancelled' → `receive_not_allowed_in_status`.
- T36 — Receive idempotent replay : même `p_idempotency_key` → return `idempotent_replay=true`, pas de doublon mouvements.
- T37 — Cancel from status='pending' → status='cancelled', metadata.cancel_reason présent.
- T38 — Cancel from status='received' → `cancel_not_allowed_in_status`.
- T39 — RLS lockdown : direct INSERT dans `internal_transfers` par role `authenticated` → bloqué.
- T40 — Permission gate : CASHIER appelle `create_internal_transfer_v1` → `forbidden` P0003 ; MANAGER appelle → succès.

**Commit** : `test(db): session 12 — phase 3 — pgTAP T21-T40 (transfers + phase 2 gap-closure)`

## Task D — Vitest live RPC

**File:** `supabase/tests/functions/inventory-transfers.test.ts`

**Scenarios** (live RPC via service-role client, local supabase) :
1. Create + Receive full cycle (status transitions, 2 movements par item visibles dans `stock_movements`, `section_stock` updated).
2. `send_directly` mode (un seul appel, status='received' directement, mouvements émis).
3. Cancel-before-receive (status='pending' → cancel OK).
4. Idempotency create (2 appels même `p_idempotency_key` → un seul transfer, `idempotent_replay=true`).
5. Idempotency receive (idem).
6. RLS forbidden : client CASHIER `supabase.rpc('create_internal_transfer_v1', …)` → erreur `forbidden`.
7. Concurrent receive : 2 appels parallèles `Promise.all([rpc, rpc])` avec même `p_idempotency_key` ou différents → un seul réussit (lock FOR UPDATE), l'autre échoue ou hit l'idempotency check.

**Commit** : `test(supabase): session 12 — phase 3 — inventory-transfers live RPC`

## Task E — Domain layer

**Files:**
- `packages/domain/src/inventory/types.ts` (MODIFY) — add `TransferStatus`, `TransferItemInput`, `TransferInput`, `TransferReceiveItem`.
- `packages/domain/src/inventory/validateTransfer.ts` (CREATE) — IO-free validators.
- `packages/domain/src/inventory/__tests__/validateTransfer.test.ts` (CREATE) — ≥10 unit tests.
- `packages/domain/src/inventory/index.ts` (MODIFY) — export barrel.

**`validateTransfer.ts`** :

```ts
export type ValidateTransferResult =
  | { valid: true }
  | { valid: false; code: 'from_to_same_section' | 'items_required' | 'duplicate_product_in_items' | 'quantity_must_be_positive' | 'invalid_quantity_received'; field?: string };

export function validateTransferInput(input: TransferInput): ValidateTransferResult { ... }
export function validateTransferReceive(items: TransferReceiveItem[], requested: Map<itemId, qty>): ValidateTransferResult { ... }
```

**Commit** : `feat(domain): session 12 — phase 3 — transfer types + validateTransfer + unit tests`

## Task F — Backoffice UI

### Hooks (`apps/backoffice/src/features/inventory-transfers/hooks/`)

- `useInternalTransfers(filters: { status?, fromSection?, toSection?, dateRange? })` → list query.
- `useTransferDetail(transferId)` → 1 transfer + items.
- `useCreateTransfer()` → mutation calling `create_internal_transfer_v1`, generates idempotencyKey crypto.randomUUID(), invalidates list.
- `useReceiveTransfer()` → mutation calling `receive_internal_transfer_v1`, invalidates detail+list+stock-levels.
- `useCancelTransfer()` → mutation cancel, invalidates detail+list.

### Components (`apps/backoffice/src/features/inventory-transfers/components/`)

- `TransferStatusBadge` — colored badge per status (gray/blue/orange/green/red).
- `TransferFormFields` — from/to section selects (excludes selected), notes textarea, `send_directly` toggle.
- `TransferItemsTable` — add/remove rows : product typeahead (reuse `ProductTypeahead`), qty input, unit derived from product.
- `TransferReceiveModal` — table editable qty_received per item, validation `<= qty_requested`, submit.
- `TransferCancelConfirm` — modal reason input (≥3 chars), red CTA.

### Pages (`apps/backoffice/src/pages/`)

- `TransfersList.tsx` — filter bar (status, sections, date range) + table avec colonnes : transfer_number, from→to, items count, status badge, created_at, actions (View). Bouton "+ New Transfer" en top.
- `TransferForm.tsx` — formulaire pour `mode='create'` (Phase 3 ne supporte que create — edit deferred). Submit → mutation → redirect vers `/backoffice/inventory/transfers/:id`.
- `TransferDetail.tsx` — header avec status badge + timeline + buttons (Receive si pending, Cancel si draft/pending). Table items. Bouton Receive ouvre `TransferReceiveModal`. Bouton Cancel ouvre `TransferCancelConfirm`.

### Routes (`apps/backoffice/src/routes/index.tsx`)

```tsx
<Route path="inventory/transfers" element={<PermissionGate required="inventory.read"><TransfersList/></PermissionGate>} />
<Route path="inventory/transfers/new" element={<PermissionGate required="inventory.transfer.create"><TransferForm/></PermissionGate>} />
<Route path="inventory/transfers/:id" element={<PermissionGate required="inventory.read"><TransferDetail/></PermissionGate>} />
```

(Route `:id/edit` deferred — Phase 3 livre create only.)

### Tests (`__tests__/`)

- `TransferFormFields.test.tsx` — validation from!=to, send_directly toggle, items required.
- `TransferReceiveModal.test.tsx` — qty_received <= qty_requested, partial vs total receive.
- `TransfersList.test.tsx` — smoke render avec mocks de query.

**Commit** : `feat(backoffice): session 12 — phase 3 — transfers UI (list + form + detail + receive + cancel)`

## Task G — Verification gate

```bash
pnpm db:reset && pnpm db:types
bash supabase/tests/run_pgtap.sh inventory
pnpm --filter @breakery/supabase test inventory
pnpm --filter @breakery/domain test inventory
pnpm --filter @breakery/backoffice test transfers
pnpm typecheck && pnpm lint && pnpm build
```

**Commit final régen types** : `chore(types): regen after phase 3 migrations`

## Phase 3 closing gate

- ✅ Migrations `…22` + `…23` applied clean on `pnpm db:reset`
- ✅ pgTAP T21-T40 (20 nouveaux tests) tous verts → total 40 pgTAP
- ✅ Vitest live `inventory-transfers.test.ts` (≥7 tests) verts
- ✅ Domain `validateTransfer` (≥10 unit tests) verts
- ✅ BO tests transfers (≥3 fichiers) verts
- ✅ `types.generated.ts` régénéré + committed
- ✅ `pnpm typecheck && pnpm lint && pnpm build` clean
- ✅ MANAGER peut créer + recevoir un transfer via UI ; CASHIER bloqué (403)
- ✅ `record_stock_movement_v1` v3 rétro-compatible (signature étendue, anciens wrappers passent named args)
- ✅ Aucun changement de signature des RPCs POS / Phase 2

## Out of scope (Phase 3)

- `in_transit` status (réservé pour usage futur, non émis par les RPCs Phase 3)
- Edit transfer (route `/transfers/:id/edit` non livrée — drafts sont read-only après création MVP)
- Sidebar groupée Inventory (déféré jusqu'à Phase 7 quand toutes les pages existent)
- Couplage comptable transfer (aucun JE émis — comportement attendu cf. spec C12)
- Transferts inter-branch (session 14)
