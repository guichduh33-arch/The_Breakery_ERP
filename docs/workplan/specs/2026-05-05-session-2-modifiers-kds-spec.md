# The Breakery — Session 2 Spec : Modifiers + Send to Kitchen + KDS

> **Date** : 2026-05-05
> **Auteur** : guichduh33@gmail.com (via session brainstorming)
> **Statut** : Approuvé pour implémentation
> **Cible** : ajouter le support des modifiers produit, l'envoi à la cuisine, et un Kitchen Display System (KDS) intégré dans `apps/pos`.

---

## 0. Contexte

Session 1 a livré le vertical POS minimal (login PIN → open shift → cart → cash → order paid avec JE auto-créée).
La session 2 ajoute :
- les **modifiers produit** (ex : HOT/ICE pour boissons, type de lait, sucre, taille…) avec impact sur le prix de ligne
- le bouton **Send to Kitchen** qui verrouille les items envoyés et crée des tickets KDS
- une route `/kds` dans `apps/pos` qui affiche les tickets en temps réel via Supabase Realtime, avec routing par station (`kitchen` / `barista` / `bakery`) et flux 3 statuts (`pending → preparing → ready`)

Cette session **ne touche pas** :
- au backoffice (CRUD products + modifiers réservé à session 7)
- au paiement (la session 1 reste intacte)
- au LAN architecture (BroadcastChannel + hub-client = session 15)
- au customer display, tablet ordering, refund/void

## 1. Décisions actées (10 points)

| # | Décision | Choix |
|---|---|---|
| **M1** | Stockage modifiers sur l'order | **JSONB** dans `order_items.modifiers` (aligné V2) |
| **M2** | Scope modifier groups | **Product + category fallback** via contrainte XOR `product_id`/`category_id` (V2) |
| **M3** | Règles min/max | **v1 simple** : `group_required BOOL`, 0..1 sélection par groupe. Multi-select reporté à session 5 (combos) |
| **K1** | KDS app placement | **Route `/kds` dans `apps/pos`** (spec parent : 2 apps total, KDS n'a pas son app) |
| **K2** | Status flow item | **3 statuts** : `pending → preparing → ready`. "Served" reporté à session 4 (tablet ordering) |
| **K3** | Send-to-kitchen | **Incrémental** : peut envoyer un batch puis ajouter d'autres items qui créeront un nouveau ticket |
| **K4** | Sync temps réel | **Supabase Realtime seul** sur `order_items`. BroadcastChannel reporté à session 15 (LAN) |
| **K5** | Routing par station | **Category-level uniquement** : `categories.dispatch_station` enum. Override par produit reporté à session 7 |
| **D9** | Auto-archive ticket ready | **5 min après `ready`** (queue locale uniquement, ligne DB reste) |
| **D10** | Cancel item après send | **Interdit complet en v1**. Erreur UI si tentative. Manager-PIN cancel arrive session 6 (refund/void) |

---

## 2. Stack technique additions

Aucun ajout majeur sur la stack session 1 :
- `@supabase/supabase-js` realtime déjà inclus (channel `postgres_changes`)
- Pas de nouveau package npm
- Pas de nouvelle Edge Function (toutes les transitions item_status passent par RLS direct sur `order_items`)

## 3. Schéma DB — additions

### 3.1 Nouvelle table `product_modifiers`

```sql
CREATE TYPE modifier_group_type AS ENUM ('single_select', 'multi_select');
-- v1 utilise UNIQUEMENT single_select. multi_select prévu pour session 5.

CREATE TABLE product_modifiers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         UUID REFERENCES products(id)   ON DELETE CASCADE,
  category_id        UUID REFERENCES categories(id) ON DELETE CASCADE,
  group_name         TEXT NOT NULL,                          -- ex: "Temperature", "Milk"
  group_sort_order   INTEGER NOT NULL DEFAULT 0,
  group_required     BOOLEAN NOT NULL DEFAULT false,         -- si true, le caissier DOIT choisir
  group_type         modifier_group_type NOT NULL DEFAULT 'single_select',
  option_label       TEXT NOT NULL,                          -- ex: "Hot", "Ice", "Oat milk"
  option_icon        TEXT,                                   -- emoji ou nom Lucide (optionnel)
  option_sort_order  INTEGER NOT NULL DEFAULT 0,
  price_adjustment   DECIMAL(12,2) NOT NULL DEFAULT 0,       -- additif sur unit_price
  is_default         BOOLEAN NOT NULL DEFAULT false,         -- pré-coché à l'ouverture du modal
  is_active          BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ,
  -- XOR : un modifier est attaché soit au produit, soit à la catégorie, jamais les deux
  CONSTRAINT product_modifiers_xor_scope CHECK (
    (product_id IS NOT NULL AND category_id IS NULL) OR
    (product_id IS NULL     AND category_id IS NOT NULL)
  ),
  -- Un default unique par groupe-produit (et par groupe-categorie)
  UNIQUE NULLS NOT DISTINCT (product_id, category_id, group_name, option_label)
);

CREATE INDEX idx_pmod_product_active ON product_modifiers(product_id) WHERE deleted_at IS NULL AND is_active;
CREATE INDEX idx_pmod_category_active ON product_modifiers(category_id) WHERE deleted_at IS NULL AND is_active;
```

### 3.2 Modifications sur tables existantes

```sql
-- categories : routage KDS
ALTER TABLE categories
  ADD COLUMN dispatch_station TEXT NOT NULL DEFAULT 'none'
    CHECK (dispatch_station IN ('kitchen', 'barista', 'bakery', 'none'));

-- order_items : modifiers JSONB + état KDS + verrou
ALTER TABLE order_items
  ADD COLUMN modifiers JSONB NOT NULL DEFAULT '[]'::jsonb,    -- snapshot des options choisies
  ADD COLUMN modifiers_total DECIMAL(12,2) NOT NULL DEFAULT 0, -- somme price_adjustment * quantity
  ADD COLUMN kitchen_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (kitchen_status IN ('pending', 'preparing', 'ready')),
  ADD COLUMN dispatch_station TEXT,                            -- copié de la categorie au moment du send
  ADD COLUMN sent_to_kitchen_at TIMESTAMPTZ,                   -- timestamp du send
  ADD COLUMN ready_at TIMESTAMPTZ,                             -- timestamp du bump ready
  ADD COLUMN is_locked BOOLEAN NOT NULL DEFAULT false;         -- true après send-to-kitchen

CREATE INDEX idx_oi_kds_station ON order_items(dispatch_station, kitchen_status)
  WHERE kitchen_status IN ('pending', 'preparing');
```

### 3.3 Schéma JSONB `order_items.modifiers`

```json
[
  {
    "group_name": "Temperature",
    "option_label": "Hot",
    "price_adjustment": 0
  },
  {
    "group_name": "Milk",
    "option_label": "Oat milk",
    "price_adjustment": 5000
  }
]
```

### 3.4 Calcul de prix

```
modifiers_total_per_unit = Σ price_adjustment
unit_total              = unit_price + modifiers_total_per_unit
line_total              = unit_total × quantity
modifiers_total (DB)    = modifiers_total_per_unit × quantity
```

PB1 reste inchangée : `tax_amount = ROUND(total × 10/110)` (incluse, extraite).

### 3.5 RPC `complete_order_with_payment` — extension

La signature reste identique. Le payload `p_items JSONB` accepte désormais `modifiers` :
```json
{
  "product_id": "...",
  "quantity": 1,
  "unit_price": 25000,
  "modifiers": [{"group_name": "...", "option_label": "...", "price_adjustment": 5000}]
}
```

Le RPC :
1. calcule `modifiers_total = SUM(price_adjustment) × quantity` par item
2. calcule `line_total = (unit_price + modifiers_total/quantity) × quantity`
3. INSERT `order_items` avec `modifiers`, `modifiers_total`, `dispatch_station = (SELECT dispatch_station FROM categories WHERE products.category_id = ...)`
4. PAS de send-to-kitchen automatique (les items naissent avec `is_locked=false`, `kitchen_status='pending'`)

### 3.6 Nouvelle RPC `send_items_to_kitchen`

```sql
CREATE FUNCTION send_items_to_kitchen(p_item_ids UUID[])
RETURNS SETOF order_items
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  -- Validation : tous les items existent et n'ont pas encore is_locked=true
  -- Erreur P0010 already_locked si déjà sent
  RETURN QUERY
    UPDATE order_items
    SET is_locked = true,
        sent_to_kitchen_at = now(),
        kitchen_status = 'pending'  -- déjà default mais explicite
    WHERE id = ANY(p_item_ids)
      AND is_locked = false
    RETURNING *;
END $$;
```

Permissions : `pos.sale.create` suffit (le caissier).

### 3.7 RLS additions

```sql
-- product_modifiers
ALTER TABLE product_modifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON product_modifiers FOR SELECT
  USING (is_authenticated() AND deleted_at IS NULL AND is_active);
-- Pas de policy WRITE en v1 (CRUD via session 7 backoffice + service_role pour seed)

-- order_items : la transition kitchen_status doit être permise au KDS
-- v1 : tout user authentifié peut UPDATE kitchen_status (pas de role kitchen séparé en v1)
CREATE POLICY "kds_update_kitchen_status" ON order_items
  FOR UPDATE USING (
    is_authenticated() AND is_locked = true
  )
  WITH CHECK (
    is_authenticated() AND is_locked = true
  );
```

### 3.8 Seed — modifiers de démo

Ajout dans `seed.sql` :
```sql
-- Catégorie Beverage : Temperature (Hot/Ice obligatoire) + Milk (optionnel)
INSERT INTO product_modifiers (category_id, group_name, group_sort_order, group_required, option_label, option_icon, option_sort_order, price_adjustment, is_default) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Temperature', 1, true,  'Hot', '☕', 1, 0, true),
  ('11111111-1111-1111-1111-111111111111', 'Temperature', 1, true,  'Ice', '🧊', 2, 0, false),
  ('11111111-1111-1111-1111-111111111111', 'Milk',        2, false, 'Whole milk',  '🥛', 1, 0,    true),
  ('11111111-1111-1111-1111-111111111111', 'Milk',        2, false, 'Oat milk',    '🌾', 2, 5000, false),
  ('11111111-1111-1111-1111-111111111111', 'Milk',        2, false, 'Almond milk', '🌰', 3, 5000, false);

-- categories.dispatch_station
UPDATE categories SET dispatch_station = 'barista' WHERE slug = 'beverage';
UPDATE categories SET dispatch_station = 'bakery'  WHERE slug IN ('bread', 'pastry');
UPDATE categories SET dispatch_station = 'kitchen' WHERE slug = 'sandwiches';
```

### 3.9 Migrations à créer

```
20260505000001_init_modifiers.sql       # product_modifiers + RLS + index
20260505000002_extend_categories.sql    # dispatch_station enum + default
20260505000003_extend_order_items.sql   # modifiers JSONB + kitchen_status + locked + index
20260505000004_send_items_rpc.sql       # send_items_to_kitchen RPC
20260505000005_seed_modifiers.sql       # ou inline dans seed.sql (préféré)
```

---

## 4. Frontend — additions

### 4.1 Nouveau composant `packages/ui` : `ModifierModal`

```
Props: {
  open: boolean,
  product: { id, name, retail_price },
  groups: ModifierGroup[],
  onClose: () => void,
  onConfirm: (selections: SelectedModifier[]) => void
}
```

Layout : full-screen modal touch-friendly. Affiche :
- En-tête : nom produit + prix de base
- Une `Card` par groupe avec son nom + indicateur `Required` si `group_required`
- Boutons gros (`h-touch-large`) pour chaque option, avec son icône + label + price_adjustment
- Sélection visuelle : `bg-gold-soft text-gold border-gold` sur l'option active
- Footer : prix calculé en temps réel + bouton "Add to cart"
- "Cancel" en haut à droite

### 4.2 `apps/pos/src/features/cart` — extension

- `cartStore.addItem(product, modifiers?)` : modifiers dans `IcartItem.modifiers`
- `cartStore.lockedItemIds: string[]` : snapshot après send
- `cartStore.canEdit(itemId): boolean` : false si locked
- Cart UI : modifiers affichés en sous-ligne sous le nom produit en `text-text-secondary text-xs`

### 4.3 `apps/pos/src/features/products` — UX

- Tap produit dans `ProductGrid` :
  - Si le produit n'a aucun modifier (et pas de category fallback non plus) → `addItem(product, [])` direct
  - Sinon → ouvrir `ModifierModal` avec les groupes mergés (product-level + category fallback)

### 4.4 `apps/pos/src/features/kitchen` — nouveau

- Hook `useSendToKitchen()` : mutation RPC `send_items_to_kitchen` avec `p_item_ids` = items courants non-lockés
- Bouton "Send to Kitchen" dans le cart panel, à côté du bouton CHECKOUT
- Disabled si tous les items sont déjà lockés ou si cart vide

### 4.5 `apps/pos` — nouvelle route `/kds`

- `apps/pos/src/pages/Kds.tsx`
- `apps/pos/src/features/kds/`
  - `useKdsOrders(station)` : query TanStack `order_items` filtré par `dispatch_station = station` + `kitchen_status IN ('pending', 'preparing')` ordered by `sent_to_kitchen_at ASC`
  - `useKdsRealtime(station)` : subscribe `order_items` postgres_changes → invalide la query quand event reçu
  - `useBumpItem()` : mutation UPDATE `kitchen_status` (pending→preparing au tap "Start", preparing→ready au tap "Bump Ready")
  - `useAutoArchive()` : retire visuellement les tickets ready depuis > 5 min (côté query data, pas DB)
- Composant `KdsOrderCard.tsx` : tile par order, affiche order_number, items + modifiers, age (count-up timer en font-mono), bouton "Start" (si pending) / "Bump Ready" (si preparing)
- Stations choisissables via dropdown ou param URL `/kds?station=barista` (default `kitchen`)
- Layout : `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-6`

### 4.6 Stores Zustand — additions

```
apps/pos/src/stores/
├── cartStore.ts        # + lockedItemIds, canEdit, sendCurrentBatch
├── kdsStore.ts (NEW)   # selectedStation (persist sessionStorage)
```

### 4.7 Domain — additions

```
packages/domain/src/
├── modifiers/
│   ├── types.ts                       # ModifierGroup, ModifierOption, SelectedModifier
│   ├── mergeGroups.ts                 # merge product-level + category fallback (XOR-aware)
│   ├── calculatePriceAdjustment.ts    # Σ price_adjustment
│   └── validateSelections.ts          # check group_required satisfaction
├── kitchen/
│   ├── types.ts                       # KitchenStatus enum, DispatchStation enum
│   └── transitions.ts                 # canTransition(from, to)
```

---

## 5. Tests

| Layer | Cas |
|---|---|
| domain `modifiers/calculatePriceAdjustment` | sum simple, qty multiplier, empty modifiers |
| domain `modifiers/mergeGroups` | product-only, category-only, product overrides category |
| domain `modifiers/validateSelections` | group_required missing → fail, optional empty → pass |
| domain `kitchen/transitions` | pending→preparing OK, preparing→ready OK, ready→preparing forbidden, ready→pending forbidden |
| ui `ModifierModal` | render groupes, sélection radio, total update, "required" guard |
| ui `KdsOrderCard` | render age, bump callbacks, modifiers displayed |
| pgTAP `send_items_to_kitchen` | locks item, second call P0010 already_locked |
| EF `process-payment` | accept items with modifiers, modifiers_total computed |
| Vitest smoke `apps/pos/__tests__/kds.smoke.test.tsx` | subscribe Realtime mocké, bump callback fires UPDATE |

---

## 6. Critères d'acceptation session 2

- [ ] Migrations 000011 → 000015 passent sans erreur
- [ ] Seed insère 5 modifiers (Temperature × 2 + Milk × 3) sur catégorie Beverage
- [ ] `pnpm lint` 0 warning, `pnpm typecheck` 0 erreur, `pnpm test` 100+ tests passent (couverture domain ≥ 90%)
- [ ] **POS** : tap "Americano" → `ModifierModal` s'ouvre avec 2 groupes (Temperature requis, Milk optionnel)
- [ ] **POS** : sélection Hot + Oat milk → "Add to cart" → cart affiche `Americano + Hot + Oat milk` sous-ligne, prix `35000 + 5000 = 40000`
- [ ] **POS** : tap "Send to Kitchen" sur cart non vide → items lockés (impossible à modifier) + un toast "Sent to kitchen"
- [ ] **POS** : ajouter un 2e item (ex: Croissant) après send → ce 2e item est new, modifiable
- [ ] **POS** : 2e tap "Send to Kitchen" → seul le 2e item part (les premiers sont déjà lockés)
- [ ] **POS** : tap CHECKOUT puis CASH → paiement OK (1 order avec tous les items, JE balanced)
- [ ] **KDS `/kds?station=barista`** : voit les Americano envoyés, pas les Croissants
- [ ] **KDS** : tap "Start" sur le ticket → status passe `preparing` (vu en Realtime depuis un autre onglet)
- [ ] **KDS** : tap "Bump Ready" → status `ready`, tile change de couleur (vert)
- [ ] **KDS** : 5 min après ready → tile disparaît de la queue locale (mais ligne DB toujours là)
- [ ] **DB** : `order_items.modifiers` contient le JSONB des choix, `modifiers_total` calculé, `dispatch_station = 'barista'` pour Americano
- [ ] Cancel item après send → erreur UI (toast rouge "Item already sent. Cannot cancel.")

---

## 7. Roadmap session 3+

(reprend la spec parent §11, modulo session 2 livrée)

| Session | Module |
|---|---|
| 3 | Customer attach + loyalty + receipts impression |
| 4 | Held orders + floor plan + tablet ordering (item served) |
| 5 | Discounts + promotions + combos (multi-select modifiers) |
| 6 | Split payment + refund/void (cancel item après send avec manager-PIN) |
| 7 | Backoffice products CRUD + categories + suppliers (modifier override per-product) |
| ... | (idem spec parent) |
