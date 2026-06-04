# The Breakery — Session 4 Spec : Held Orders + Floor Plan + Item Served

> **Trace historique** : ce fichier documente une session de travail datée. Le fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure documentaire (voir [`../../README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13
>
> **Voir aussi** pour la spec complète (4 parties) :
> - Held orders → [`../../reference/04-modules/02-pos-cart-orders.md`](../../reference/04-modules/02-pos-cart-orders.md)
> - Item served / KDS lifecycle → [`../../reference/04-modules/04-kds-kitchen.md`](../../reference/04-modules/04-kds-kitchen.md)

> **Date** : 2026-05-06
> **Auteur** : guichduh33@gmail.com (via session brainstorming)
> **Statut** : Approuvé pour implémentation
> **Cible** : ajouter held orders (ephemeral, localStorage), table selection (floor plan v1 — liste de tables seedées), et statut `served` sur les items KDS.

---

## 0. Contexte

Session 3 a livré customer attach + loyalty + receipts.
Session 4 ajoute :
- **Held orders** : mettre en pause un cart en cours (avant send-to-kitchen ou avant payment), le restaurer plus tard. Persistance locale uniquement.
- **Floor plan v1** : choisir la table pour un order `dine_in`. Liste seedée (8-10 tables), pas de coords x/y.
- **Item served** : extend KDS avec un 4e statut terminal `served` après `ready`. Bouton "Mark Served" sur KdsOrderCard, auto-archive immédiat.

Cette session **ne touche pas** :
- **tablet ordering** (route `/tablet`, waiter PIN, `tabletCartStore`, inbox POS) — déplacé à session 5
- LAN architecture (BroadcastChannel, hub-client) — session 15 (inchangé)
- Floor plan visuel (coords x/y, drag-drop layout, table shape) — session 7+ (backoffice)
- DB persistence des held orders (par exemple `orders.status='draft'`) — possible amélioration future
- Auto-completion d'order quand tous items=served — l'order reste à `paid` ; closing reste manuel via end-of-day session

## 1. Décisions actées (12 points)

| # | Décision | Choix |
|---|---|---|
| **H1** | Held orders persistence | **localStorage** via Zustand `persist` middleware. Survit au refresh, perd au logout/clear |
| **H2** | Held order shape | snapshot complet du cart : `items` (avec modifiers), `customerId`, `loyaltyPointsToRedeem`, `orderType`, `tableNumber`, `notes`, `heldAt: ISO` |
| **H3** | Hold trigger | Bouton "Hold" dans cart panel, à côté de Send-to-Kitchen et Checkout. Disabled si cart vide |
| **H4** | Restore behavior | **Replace** : remplace le cart courant entièrement. Si cart courant non-vide → confirm dialog "Discard current cart?" |
| **H5** | Held orders cap | **20 max**. UI warning "Held orders limit reached" sur le 21e tap (force restore/delete d'un avant) |
| **H6** | Hold permission | `pos.access` suffit (cashier). Pas de permission distincte en v1 |
| **F1** | Floor plan schema | **liste plate** : table `restaurant_tables` (id, name, seats, sort_order, is_active). Pas de `floor_plan_items` avec coords. `orders.table_number TEXT` (FK pas mise en v1, varchar souple) |
| **F2** | Table selection trigger | `order_type='dine_in'` → modal **suggéré** avant send-to-kitchen OU avant checkout. Optional (skip OK) |
| **F3** | Table occupancy indicator | live via TanStack query + Supabase Realtime sur `orders WHERE table_number = X AND status NOT IN ('completed', 'voided', 'paid_closed')`. Card verte = libre, rouge = occupée |
| **F4** | Tap occupied table | Bloqué en v1 avec toast "Table occupied". Pas de "view active order" en v1 |
| **K1** | Item served status | extend enum `kitchen_status` avec `served`. Terminal (pas de retour en arrière) |
| **K2** | Mark served UI | bouton "Mark Served" sur `KdsOrderCard` quand `kitchen_status='ready'`. Auto-archive immédiat (retire de la queue locale, ligne DB reste). KDS countdown 5min de session 2 reste pour ready non-served |

---

## 2. Stack technique additions

| Addition | Raison |
|---|---|
| Zustand `persist` middleware | déjà inclus, pas de nouveau package |
| Aucun ajout npm | tout fait avec Supabase + Zustand existants |
| Domain `packages/domain/src/heldOrders/` | sérialisation snapshot |
| Domain `packages/domain/src/tables/` | types RestaurantTable |
| UI `packages/ui/src/components/{TableSelectorModal,HeldOrdersModal}.tsx` | nouveaux composants |

---

## 3. Schéma DB — additions

### 3.1 Nouvelle table `restaurant_tables`

```sql
CREATE TABLE restaurant_tables (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,                       -- ex: "T-01", "Patio 1"
  seats        INTEGER NOT NULL DEFAULT 4
               CHECK (seats > 0 AND seats <= 20),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at   TIMESTAMPTZ,
  UNIQUE NULLS NOT DISTINCT (name)
);

CREATE INDEX idx_restaurant_tables_sort
  ON restaurant_tables(sort_order, name)
  WHERE deleted_at IS NULL AND is_active;
```

### 3.2 Modifications sur tables existantes

```sql
-- orders : table_number stocké en TEXT (cohérence avec V2 reference, pas de FK rigide)
ALTER TABLE orders
  ADD COLUMN table_number TEXT;

-- index sparse pour Realtime occupancy (filtre table_number IS NOT NULL)
CREATE INDEX idx_orders_active_table
  ON orders(table_number)
  WHERE table_number IS NOT NULL
    AND status NOT IN ('completed', 'voided');
```

### 3.3 Extension enum `kitchen_status` — ajout `served`

```sql
-- order_items.kitchen_status est CHECK (text IN (...)) pas un vrai TYPE en session 2.
-- Si TYPE existe : ALTER TYPE kitchen_status ADD VALUE 'served';
-- Si CHECK : drop + recreate avec nouvelle valeur.
ALTER TABLE order_items
  DROP CONSTRAINT IF EXISTS order_items_kitchen_status_check;
ALTER TABLE order_items
  ADD CONSTRAINT order_items_kitchen_status_check
  CHECK (kitchen_status IN ('pending', 'preparing', 'ready', 'served'));

-- Snapshot served_at + served_by
ALTER TABLE order_items
  ADD COLUMN served_at TIMESTAMPTZ,
  ADD COLUMN served_by UUID REFERENCES user_profiles(id) ON DELETE SET NULL;

-- Index KDS queue exclut désormais served (déjà excluded car index WHERE kitchen_status IN ('pending','preparing'))
-- Aucun changement nécessaire sur idx_oi_kds_station de session 2.
```

### 3.4 RPC `mark_item_served`

```sql
CREATE FUNCTION mark_item_served(p_item_id UUID)
RETURNS order_items
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_row order_items;
BEGIN
  UPDATE order_items
    SET kitchen_status = 'served',
        served_at      = now(),
        served_by      = auth.uid()
    WHERE id = p_item_id
      AND kitchen_status = 'ready'
    RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Item must be ready before serving' USING ERRCODE = 'P0011';
  END IF;
  RETURN v_row;
END $$;
```

### 3.5 RLS additions

```sql
ALTER TABLE restaurant_tables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON restaurant_tables FOR SELECT
  USING (is_authenticated() AND deleted_at IS NULL AND is_active);
-- Pas de WRITE en v1 — CRUD = session 7 (backoffice)

-- order_items : la transition ready → served est permise au KDS / cashier authentifié
-- (la policy session 2 "kds_update_kitchen_status" couvre déjà UPDATE quand is_locked=true)
```

### 3.6 Seed — tables de démo

```sql
INSERT INTO restaurant_tables (name, seats, sort_order) VALUES
  ('T-01', 2, 1),
  ('T-02', 2, 2),
  ('T-03', 4, 3),
  ('T-04', 4, 4),
  ('T-05', 6, 5),
  ('Patio-1', 4, 6),
  ('Patio-2', 4, 7),
  ('Bar-1',  2, 8),
  ('Bar-2',  2, 9),
  ('VIP',    8, 10);
```

### 3.7 Migrations à créer

```
20260506000001_init_restaurant_tables.sql        # table + RLS + index + seed inline
20260506000002_add_orders_table_number.sql       # ALTER orders + index
20260506000003_extend_kitchen_status_served.sql  # CHECK update + served_at/by columns
20260506000004_mark_item_served_rpc.sql          # RPC
```

---

## 4. Frontend — additions

### 4.1 Domain `packages/domain/src/`

```
heldOrders/
├── types.ts                 # HeldOrder (snapshot du cart sérialisé)
├── serialize.ts             # toHeldOrder(cart) → HeldOrder, fromHeldOrder(held) → Cart
├── index.ts
└── __tests__/

tables/
├── types.ts                 # RestaurantTable
└── index.ts

kitchen/
├── transitions.ts           # EXTEND : ready → served allowed, served terminal, transitions étendues
└── __tests__/transitions.test.ts  # ajout cas served (16+ tests total)
```

`HeldOrder` shape :
```ts
export interface HeldOrder {
  id: string;                       // local UUID
  heldAt: string;                   // ISO
  cart: {
    items: CartItem[];              // session 2 shape avec modifiers
    customerId: string | null;
    loyaltyPointsToRedeem: number;  // 0 = no redeem
    orderType: 'dine_in' | 'take_out';
    tableNumber: string | null;
  };
  notes?: string;                   // optional cashier note
}
```

### 4.2 UI components `packages/ui/src/components/`

| Composant | Rôle |
|---|---|
| `TableSelectorModal.tsx` | grid 3-4 colonnes de cards table. Card affiche name + seats + occupancy badge. Tap libre → onSelect(table). Tap occupé → toast "Table occupied". Bouton "No table" / "Skip" en bas |
| `HeldOrdersModal.tsx` | list de held orders triée desc par `heldAt`. Chaque row : timestamp relatif ("5 min ago"), item count, customer name si attaché, note. Actions : "Restore" (avec confirm si cart courant non-vide), "Delete" |

### 4.3 POS app `apps/pos/src/features/`

```
heldOrders/
├── components/
│   ├── HoldOrderButton.tsx          # bouton "Hold" dans cart panel
│   └── HeldOrdersInboxButton.tsx    # bouton "Held (3)" badge avec count → ouvre modal
├── hooks/
│   ├── useHoldOrder.ts              # snapshot cart → push to heldOrdersStore + reset cart
│   └── useRestoreHeldOrder.ts       # pop from store → replace cart
tables/
├── components/
│   └── TableSelectorButton.tsx      # bouton "Table: T-03 ▾" ou "Pick table" si dine_in et pas encore choisie
├── hooks/
│   ├── useRestaurantTables.ts       # TanStack query SELECT * FROM restaurant_tables
│   └── useTableOccupancy.ts         # Realtime sur orders.table_number, retourne Map<tableName, isOccupied>
kds/
├── hooks/
│   └── useMarkItemServed.ts         # mutation RPC mark_item_served, invalidation queue
└── components/
    └── KdsOrderCard.tsx             # EXTEND : affiche "Mark Served" si status='ready'. Auto-retire de la queue après served (utilise local pruning, pas la DB)
```

### 4.4 Stores Zustand

```
apps/pos/src/stores/
├── cartStore.ts                  # EXTEND : tableNumber: string | null,
│                                 #   setTableNumber(name: string | null), reset le clear sur checkout
├── heldOrdersStore.ts            # NEW : Zustand persist (localStorage),
│                                 #   { entries: HeldOrder[], add, remove, restore, clear, count }
```

`heldOrdersStore` shape :
```ts
{
  entries: HeldOrder[],
  add: (held: HeldOrder) => void,                  // cap à 20, throw si dépassé
  remove: (id: string) => void,
  clear: () => void,
}
```

### 4.5 Cart panel additions

- `ActiveOrderPanel.tsx` :
  - Si `orderType === 'dine_in'` et `tableNumber !== null` → `TableSelectorButton` affiche "Table: T-03"
  - Si `orderType === 'dine_in'` et `tableNumber === null` → `TableSelectorButton` affiche "Pick table" (CTA encore optionnelle)
  - Boutons row : `HoldOrderButton` + `SendToKitchenButton` + `CheckoutButton`
  - `HeldOrdersInboxButton` dans le header avec badge count

### 4.6 KDS extension

- `KdsOrderCard.tsx` : transitions visuelles
  - `pending` → bouton "Start" (existing)
  - `preparing` → bouton "Bump Ready" (existing)
  - `ready` → bouton **"Mark Served"** (NEW, vert outline)
  - `served` → tile retire de la queue immédiatement (pas le countdown 5min de session 2 — qui reste pour `ready` non-servi)
- `useKdsOrders` filter : `kitchen_status IN ('pending', 'preparing', 'ready')` (exclut served)

### 4.7 Domain transitions étendues

```ts
// kitchen/transitions.ts EXTEND
const TRANSITIONS: Record<KitchenStatus, KitchenStatus[]> = {
  pending:   ['preparing'],
  preparing: ['ready'],
  ready:     ['served'],         // NEW
  served:    [],                  // terminal
};
```

---

## 5. Tests

| Layer | Cas |
|---|---|
| domain `heldOrders/serialize` | round-trip cart ↔ held, modifiers preserved, customer preserved, redeem points preserved, dates ISO valid |
| domain `kitchen/transitions` (EXTEND) | ready → served OK, served → ready forbidden, served → preparing forbidden, served terminal (no out-edges), pending → served forbidden direct |
| domain `tables/types` | type-only, no logic test |
| ui `TableSelectorModal` | render grid, occupied → toast, skip → onSelect(null), select → onSelect(table) |
| ui `HeldOrdersModal` | list rendering, restore confirm dialog when cart non-empty, restore replaces cart, delete removes entry |
| pgTAP `mark_item_served` | ready → served OK, pending → P0011, preparing → P0011, served → P0011 (idempotent fail) |
| Vitest smoke `apps/pos/__tests__/held-orders.smoke.test.tsx` | hold flow : add items → hold → cart cleared → list shows 1 → restore → cart restored |
| Vitest smoke `apps/pos/__tests__/table-selector.smoke.test.tsx` | dine_in order → modal opens → select T-03 → cart shows "Table T-03" → checkout → orders.table_number='T-03' |
| Vitest smoke `apps/pos/__tests__/kds-served.smoke.test.tsx` | KDS Bump Ready → "Mark Served" appears → tap → tile disappears → DB has served_at |
| Smoke `apps/pos/__tests__/golden-path.smoke.test.tsx` | EXTEND session 1+2+3 happy path : ajouter étape held + restore avant le send-to-kitchen, et étape table selection avant checkout |

---

## 6. Critères d'acceptation session 4

- [ ] Migrations 20260506000001 → 20260506000004 passent sans erreur
- [ ] Seed insère 10 tables (T-01 à VIP)
- [ ] `pnpm lint` 0 warning, `pnpm typecheck` 0 erreur, `pnpm test` 280+ tests passent
- [ ] **POS Held** : ajouter 2 items au cart, tap "Hold", saisir note "for Mr. Tan" → cart cleared, badge "Held (1)" apparaît
- [ ] **POS Held** : tap badge → modal avec 1 entrée → tap "Restore" → cart restauré avec les 2 items + leurs modifiers
- [ ] **POS Held** : restore alors que cart courant non-vide → confirm dialog → tap "Replace" → cart remplacé
- [ ] **POS Held** : ajouter 21 holds → 21e tap échoue avec toast "Held orders limit reached"
- [ ] **POS Held** : refresh navigateur → held orders toujours là (localStorage)
- [ ] **POS Tables** : select order_type='dine_in' → "Pick table" CTA visible → tap → modal grid de 10 tables → tap T-03 (libre) → cart affiche "Table: T-03"
- [ ] **POS Tables** : ouvrir un 2e POS sur autre device, créer un order pending sur T-04 → premier device voit T-04 en rouge "Occupied" via Realtime
- [ ] **POS Tables** : tap T-04 (occupied) → toast "Table occupied", aucune sélection
- [ ] **POS Tables** : checkout cash → `orders.table_number='T-03'`
- [ ] **KDS Served** : item passe pending → preparing → ready → tap "Mark Served" → tile disparaît immédiat de la queue, DB a `kitchen_status='served'`, `served_at` set
- [ ] **KDS Served** : autre KDS dans 2e onglet voit le tile retiré via Realtime
- [ ] **KDS Served** : impossible de re-bump après served (pas de bouton, RPC raise P0011 si forcé)
- [ ] **DB** : `restaurant_tables` 10 rows, `orders.table_number` colonne créée + index, `order_items.kitchen_status` accepte 'served' avec served_at/by

---

## 7. Roadmap session 5+

(reprend la spec parent §11, modulo sessions 1-4 livrées)

| Session | Module |
|---|---|
| 5 | **Tablet ordering** : route `/tablet`, TabletLayout (waiter PIN), `tabletCartStore`, insert orders `created_via='tablet'` + `status='pending_payment'`, POS hub Realtime inbox, cashier pickup |
| 6 | Discounts + promotions + combos (multi-select modifiers + loyalty multipliers + customer_categories) |
| 7 | Split payment + refund/void (cancel item après send avec manager-PIN) |
| 8 | Backoffice products CRUD + categories + suppliers + customers CRUD + tables CRUD (modifier override per-product, floor plan visuel x/y) |
| 9 | Customer display + QR scan loyalty |
| 10 | B2B customers + credit + invoicing |
| ... | (idem spec parent) |
