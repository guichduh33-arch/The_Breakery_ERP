# Session 32 — Reports Vague C close-out drill-down + /backoffice/orders list (Spec)

> **Date** : 2026-05-26
> **Branche cible** : `swarm/session-32`
> **Base** : `master` après merge S31 (`c74e295`)
> **Effort estimé** : ~2-3 jours wall-time (L)
> **Status** : draft pour ratification user (avant Wave 0 spec commit)
> **Predecessor** : [`./2026-05-22-session-31-spec.md`](./2026-05-22-session-31-spec.md) — S32 ferme les 7 reports "terminal documentés" laissés par S31 (4 accounting + StockMovements product drill + PaymentByMethod + SalesByHour) et crée la page `/backoffice/orders` filtrable.

---

## 1. Contexte

S31 a livré le composant `<DrilldownLink>` + helper `buildDrilldownUrl` + 13/17 reports wirés. Les 4 reports restants ont été "terminal documentés" pour deux raisons distinctes :

1. **4 reports accounting** (P&L, Balance Sheet, Cash Flow, PB1) — les RPCs `get_profit_loss_v1` / `get_balance_sheet_v1` / `get_cash_flow_v1` retournent les lines avec `code` (3-4 chiffres) mais pas `account_id UUID`. La page cible `/accounting/general-ledger` (S26b) attend un UUID. Drill-down impossible sans bump RPC.
2. **2 reports POS** (Payment by Method, Sales by Hour) — leur drill naturel pointe vers une **liste d'orders filtrée** par méthode/heure. Mais aucune page `/backoffice/orders` (list) n'existe — uniquement `/backoffice/orders/:id` (detail S31).
3. **1 report inventory** (Stock Movement History, DEV-S31-3.B-01) — marqué "RPC ne retourne pas product_id". **Inexact** : le RPC S30 6-arg expose déjà `product_id` dans son JSONB. Seule le hook BO `useStockMovementsReport` ne le surface pas dans son interface TypeScript.

S32 ferme ces 3 gaps + un quatrième identifié à la lecture du code S26b :
4. **`GeneralLedgerPage`** utilise `useState('')` pour `accountId`, ne lit pas `?account_id=` depuis l'URL. Donc même avec les bumps DB, le drill landing n'aurait pas le compte pré-sélectionné.

**Hors scope S32** (renvoyé S33+ ou backlog) :
- "+ New Order" button + flow sur `/backoffice/orders` (RPC distincte de `create_tablet_order` / `complete_order`)
- Actions sur OrderDetailPage (refund/void/edit) — déjà déféré S31
- Compare toggle sur 5 reports S30
- UnifiedReportFilters extra dims category/terminal/customer
- Hub mini-KPI bar + favorites/pinning
- Mobile responsive detail pages + reports
- 6 Soon cards restantes (Daily Sales, Purchase ×3, Production Report, Staff Performance, Price Changes, Permission Change Log)
- Saved filter presets / shareable URL collections sur OrdersListPage
- B2B-specific filter UX (déjà couvert par filter `customer_type=b2b`)

---

## 2. Architecture

**Choix structurant 1** : **3 bumps DB additifs** (`CREATE OR REPLACE` sans changement de signature). Les RPCs P&L / BS / CF retournent JSONB ; ajouter une clé `account_id` au `jsonb_build_object` des lines ne change ni les args en entrée ni le type de retour. Consumers existants ignorent la nouvelle clé. **Pas de bump v2** (ne s'applique qu'aux changements de signature SQL).

**Choix structurant 2** : **1 nouvelle RPC** `get_orders_list_v1(p_start TEXT, p_end TEXT, p_filters JSONB, p_limit INT, p_cursor TIMESTAMPTZ)` retournant JSONB `{ lines, next_cursor }`. SECURITY DEFINER + gate `orders.read` (perm seedée S31). REVOKE pair canonique S25 (`FROM PUBLIC` + `FROM anon` + `ALTER DEFAULT PRIVILEGES`).

**Choix structurant 3** : **Filtres via JSONB `p_filters`** au lieu de 10+ args nommés. Pattern emprunté à `evaluate_promotions` (jsonb context). Chaque clé optionnelle ; NULL ou absente → ignored. Documenté en `COMMENT ON FUNCTION` avec la liste exhaustive des clés acceptées. Inconnu silently ignored (pas d'erreur 22P02) pour faciliter l'évolution future.

**Choix structurant 4** : **Cursor pagination** identique au pattern S30 `get_stock_movements_v1` — clamp `p_limit` à [1, 200] (default 50), `next_cursor` = `created_at` de la (N+1)ᵉ row. Pas de `total_count` (coûteux sur table 100k+ rows en l'absence de denormalization).

**Choix structurant 5** : **Computed cols inline** dans la RPC (LEFT JOIN aux tables annexes plutôt que côté hook) :
- `refund_status` ∈ `{none, partial, full}` via `LEFT JOIN refunds` + `SUM(refunds.amount)` vs `orders.total`
- `has_modifiers` via `EXISTS (SELECT 1 FROM order_items WHERE order_id=o.id AND modifiers IS NOT NULL AND jsonb_array_length(modifiers) > 0)`
- `customer_type` via `LEFT JOIN customers ON o.customer_id = c.id` → `c.customer_type` (NULL si walk-in)
- `payment_method_primary` agrégé depuis `order_payments` (méthode unique si une seule, `'mixed'` si N>1)
- `items_count` via `COUNT(order_items)`
- `customer_name` via `LEFT JOIN customers`
- `served_by_name` via `LEFT JOIN user_profiles ON o.served_by = up.id`

**Choix structurant 6** : **URL state = source of truth** pour OrdersListPage. Tous les filtres lus depuis `useSearchParams` avec defaults raisonnables (date range = last 7 days). Permet aux `<DrilldownLink filter={...}>` d'arriver pre-filled. Convention déjà introduite par `<DrilldownLink>` S31, étendue aux multi-filtres.

**Choix structurant 7** : **GeneralLedgerPage `useSearchParams` seed** — lit `?account_id=` + `?start=` + `?end=` au mount, sets initial useState. Pas de sync 2-way (les changements user via les selectors ne writent pas l'URL) pour éviter regression — S33+ si demandé.

**Choix structurant 8** : **`buildDrilldownUrl` extension** — ajouter entity `'order_list'` qui mappe vers `/backoffice/orders` avec filter object spread comme query params. Unit tests +3-5 cas.

### 2.1 Routes touchées

| Route | Action S32 | Notes |
|---|---|---|
| `/backoffice/orders` | NEW (list) | Nouvelle page filtrable cursor-paginée |
| `/backoffice/orders/:id` | inchangée | S31 OrderDetailPage |
| `/accounting/general-ledger` | extend | accepte `?account_id=`, `?start=`, `?end=` URL params |
| 7 reports pages | re-wire | retire "terminal comments" → `<DrilldownLink>` actif |

---

## 3. DB changes (Wave 1)

### 3.1 `get_profit_loss_v1` bump additif

Migration `20260617000010_bump_get_profit_loss_v1_expose_account_id.sql` :

```sql
CREATE OR REPLACE FUNCTION public.get_profit_loss_v1(
  p_date_start  DATE,
  p_date_end    DATE,
  p_section_id  UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public
AS $$
-- ... corps inchangé sauf bloc `jsonb_agg(jsonb_build_object(...))`
--     ajoute `'account_id', account_id` AVANT 'code'
$$;
```

Le CTE `agg` SELECT déjà `a.id AS account_id` mais ne le sortait pas dans le JSONB. Pure addition.

### 3.2 `get_balance_sheet_v1` bump additif

Migration `20260617000011_bump_get_balance_sheet_v1_expose_account_id.sql` — même pattern. Si le CTE actuel ne SELECT pas `a.id`, l'ajouter.

### 3.3 `get_cash_flow_v1` bump additif

Migration `20260617000012_bump_get_cash_flow_v1_expose_account_id.sql` — idem.

### 3.4 `get_orders_list_v1` nouvelle RPC

Migration `20260617000013_create_get_orders_list_v1_rpc.sql` :

```sql
CREATE OR REPLACE FUNCTION public.get_orders_list_v1(
  p_start    TEXT,                    -- 'YYYY-MM-DD'
  p_end      TEXT,                    -- 'YYYY-MM-DD'
  p_filters  JSONB        DEFAULT '{}'::JSONB,
  p_limit    INT          DEFAULT 50,
  p_cursor   TIMESTAMPTZ  DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_clamp     INT  := LEAST(GREATEST(p_limit, 1), 200);
  v_start     TIMESTAMPTZ := (p_start || 'T00:00:00Z')::timestamptz;
  v_end       TIMESTAMPTZ := (p_end   || 'T23:59:59Z')::timestamptz;
  v_lines     JSONB;
  v_next      TIMESTAMPTZ;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT has_permission(v_caller_id, 'orders.read') THEN
    RAISE EXCEPTION 'Permission denied: orders.read' USING ERRCODE = '42501';
  END IF;

  WITH filtered AS (
    SELECT
      o.id,
      o.order_number,
      o.order_type,
      o.status,
      o.total,
      o.created_at,
      o.customer_id,
      c.customer_type,
      COALESCE(c.full_name, c.display_name) AS customer_name,
      o.served_by,
      up.full_name AS served_by_name,
      o.terminal_id,
      -- refund_status computed
      CASE
        WHEN COALESCE(rsum.amount, 0) = 0 THEN 'none'
        WHEN COALESCE(rsum.amount, 0) >= o.total THEN 'full'
        ELSE 'partial'
      END AS refund_status,
      -- has_modifiers computed
      EXISTS (
        SELECT 1 FROM order_items oi
        WHERE oi.order_id = o.id
          AND oi.modifiers IS NOT NULL
          AND jsonb_array_length(oi.modifiers) > 0
      ) AS has_modifiers,
      -- payment_method_primary computed
      (
        SELECT CASE WHEN COUNT(DISTINCT op.method) > 1 THEN 'mixed'
                    ELSE MIN(op.method)::text END
        FROM order_payments op WHERE op.order_id = o.id
      ) AS payment_method_primary,
      -- items_count computed
      (SELECT COUNT(*) FROM order_items WHERE order_id = o.id)::INT AS items_count,
      ROW_NUMBER() OVER (ORDER BY o.created_at DESC) AS rn
    FROM orders o
    LEFT JOIN customers     c   ON c.id  = o.customer_id
    LEFT JOIN user_profiles up  ON up.id = o.served_by
    LEFT JOIN LATERAL (
      SELECT SUM(r.amount) AS amount FROM refunds r WHERE r.order_id = o.id
    ) rsum ON TRUE
    WHERE o.created_at BETWEEN v_start AND v_end
      AND (p_cursor IS NULL OR o.created_at < p_cursor)
      -- filters from JSONB
      AND (p_filters->>'status'        IS NULL OR o.status::text     = p_filters->>'status')
      AND (p_filters->>'order_type'    IS NULL OR o.order_type::text = p_filters->>'order_type')
      AND (p_filters->>'customer_id'   IS NULL OR o.customer_id      = (p_filters->>'customer_id')::uuid)
      AND (p_filters->>'served_by'     IS NULL OR o.served_by        = (p_filters->>'served_by')::uuid)
      AND (p_filters->>'terminal_id'   IS NULL OR o.terminal_id::text = p_filters->>'terminal_id')
      AND (p_filters->>'total_min'     IS NULL OR o.total >= (p_filters->>'total_min')::numeric)
      AND (p_filters->>'total_max'     IS NULL OR o.total <= (p_filters->>'total_max')::numeric)
      AND (p_filters->>'customer_type' IS NULL OR c.customer_type::text = p_filters->>'customer_type')
      -- payment_method requires subquery against order_payments
      AND (p_filters->>'payment_method' IS NULL OR EXISTS (
        SELECT 1 FROM order_payments op
        WHERE op.order_id = o.id AND op.method::text = p_filters->>'payment_method'
      ))
    ORDER BY o.created_at DESC
    LIMIT v_clamp + 1
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id',                     f.id,
      'order_number',           f.order_number,
      'order_type',             f.order_type,
      'status',                 f.status,
      'total',                  f.total,
      'created_at',             f.created_at,
      'customer_id',            f.customer_id,
      'customer_name',          f.customer_name,
      'customer_type',          f.customer_type,
      'served_by',              f.served_by,
      'served_by_name',         f.served_by_name,
      'terminal_id',            f.terminal_id,
      'refund_status',          f.refund_status,
      'has_modifiers',          f.has_modifiers,
      'payment_method_primary', f.payment_method_primary,
      'items_count',            f.items_count
    ) ORDER BY f.created_at DESC) FILTER (WHERE f.rn <= v_clamp), '[]'::jsonb)
  INTO v_lines
  FROM filtered f;

  -- refund_status / has_modifiers can also be filter axes — applied post-aggregation if requested
  -- (kept out of WHERE to preserve cursor monotonicity; if perf becomes an issue,
  --  push computed-filters down via subquery — S33+ optimization)

  SELECT MIN(created_at) INTO v_next FROM filtered WHERE rn > v_clamp;

  RETURN jsonb_build_object('lines', v_lines, 'next_cursor', v_next);
END;
$$;

COMMENT ON FUNCTION public.get_orders_list_v1 IS
  'S32 — Orders list cursor-paginated. p_filters JSONB keys: status, order_type, '
  'customer_id, served_by, terminal_id, total_min, total_max, customer_type, '
  'payment_method. Computed cols in output: refund_status (none|partial|full), '
  'has_modifiers, payment_method_primary (or ''mixed''), items_count, customer_name, '
  'customer_type, served_by_name. Gated reports.orders / orders.read.';

GRANT EXECUTE ON FUNCTION public.get_orders_list_v1 TO authenticated;
```

**Deviation possible** : si `refund_status='full'` ou `has_modifiers=true/false` doivent **filter** la liste (pas juste apparaître dans output), il faut wrapper le SELECT principal dans un sub-WHERE. La V1 ne filtre pas sur ces 2 axes en `p_filters` — à ajouter en correctif si demandé.

### 3.5 REVOKE pair canonique

Migration `20260617000014_revoke_anon_get_orders_list_v1.sql` :

```sql
REVOKE EXECUTE ON FUNCTION public.get_orders_list_v1(TEXT, TEXT, JSONB, INT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_orders_list_v1(TEXT, TEXT, JSONB, INT, TIMESTAMPTZ) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

### 3.6 Types regen

Via MCP `generate_typescript_types` post `_014` → écrit `packages/supabase/src/types.generated.ts` et commit. Pas une migration au sens DB.

---

## 4. BO hooks + types (Wave 2)

### 4.1 `useProfitLoss` / `useBalanceSheet` / `useCashFlow` interface bump

Ajouter `account_id: string` à `PnlLine` / `BalanceSheetLine` / `CashFlowLine`. **Required**, pas optional — après bump DB, toujours présent.

### 4.2 `useStockMovementsReport` interface bump

Ajouter `product_id: string` à `StockMovementLine` (déjà retourné par la RPC depuis S30, juste pas dans l'interface TS).

### 4.3 `usePb1Report` resolve `account_id`

`Pb1ReportPage` drill cible le compte `2110 PB1 Payable`. Deux options :

**A.** Hook `usePb1Report` accepte un `chartOfAccounts` et résout `account_id` du code `'2110'` côté client (sync) — léger.
**B.** Bump `get_pb1_report_v1` pour retourner `account_id` du compte payable. Plus propre mais 1 migration de plus.

**Choix** : A (côté client) — le ChartOfAccounts est de toute façon chargé via `useChartOfAccounts` pour GeneralLedgerPage. Évite un bump RPC.

### 4.4 `useOrdersList` nouveau hook

```ts
export interface OrdersListLine {
  id:                     string;
  order_number:           string;
  order_type:             'dine_in' | 'takeaway' | 'tablet' | 'b2b' | string;
  status:                 string;
  total:                  number;
  created_at:             string;
  customer_id:            string | null;
  customer_name:          string | null;
  customer_type:          'retail' | 'b2b' | null;
  served_by:              string | null;
  served_by_name:         string | null;
  terminal_id:            string | null;
  refund_status:          'none' | 'partial' | 'full';
  has_modifiers:          boolean;
  payment_method_primary: 'cash' | 'card' | 'qris' | 'edc' | 'transfer' | 'store_credit' | 'mixed' | null;
  items_count:            number;
}

export interface OrdersListPage {
  lines:       OrdersListLine[];
  next_cursor: string | null;
}

export interface OrdersListFilters {
  status?:         string;
  order_type?:     string;
  customer_id?:    string;
  served_by?:      string;
  terminal_id?:    string;
  total_min?:      number;
  total_max?:      number;
  customer_type?:  'retail' | 'b2b';
  payment_method?: string;
}

export interface UseOrdersListParams {
  start:    string;          // 'YYYY-MM-DD'
  end:      string;
  filters?: OrdersListFilters;
  limit?:   number;
}

export function useOrdersList(params: UseOrdersListParams) {
  return useInfiniteQuery<OrdersListPage, Error>({
    queryKey: ['orders', 'list', params],
    queryFn: async ({ pageParam }) => { /* RPC call */ },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: Boolean(params.start && params.end),
  });
}
```

**File path** : `apps/backoffice/src/features/orders/hooks/useOrdersList.ts`.

---

## 5. OrdersListPage UX (Wave 3)

### 5.1 Layout

```
┌─ Page header
│   "Orders" + count badge + ExportButtons (CSV only — pagination → no PDF, suit S30 DEV-S30-4.X-01)
├─ Filters bar (collapsible card)
│   Row 1 (always visible) :
│     DateRangePicker (start/end, default last 7d)
│     Status multi-select (open|completed|voided|refunded)
│     Order type multi-select (dine_in|takeaway|tablet|b2b)
│   Row 2 :
│     Payment method multi-select
│     Refund status select (none|partial|full)
│     Has modifiers toggle (any|true|false)
│   Row 3 (advanced — collapsed by default) :
│     Customer typeahead
│     Served by typeahead (users)
│     Terminal select (from list of distinct terminal_id)
│     Total min/max (numeric)
│     Customer type select (retail|b2b)
├─ Active filter chips (Apple-pill style, click to remove)
├─ Results count + "Showing X of Y orders" + sort indicator
├─ Table
│   | Date+Time | Order # | Customer | Type | Status | Total IDR | Payment | Refund | Items | Served by |
│   row click → /backoffice/orders/:id (S31 OrderDetailPage)
└─ "Load more" button (or auto-trigger on scroll)
```

### 5.2 URL state mapping

| URL param | Maps to filter | Notes |
|---|---|---|
| `?start=` | `params.start` | default last 7 days |
| `?end=` | `params.end` | default today |
| `?status=` | `filters.status` | multi (comma-separated) |
| `?order_type=` | `filters.order_type` | multi |
| `?payment_method=` | `filters.payment_method` | single (RPC takes single) — multi requires `?payment_method=cash,qris` parsed + N RPC calls or `IN` clause future bump |
| `?customer_id=` | `filters.customer_id` | single UUID |
| `?served_by=` | `filters.served_by` | single UUID |
| `?terminal_id=` | `filters.terminal_id` | single |
| `?refund_status=` | client-side filter (RPC not aware in V1) | Filter applied after RPC fetch |
| `?has_modifiers=` | client-side filter (V1) | true/false/all |
| `?total_min=` / `?total_max=` | `filters.total_min/max` | numeric |
| `?customer_type=` | `filters.customer_type` | 'retail'\|'b2b' |
| `?hour=` (from SalesByHour drill) | client-side filter on `created_at` hour | 0-23, applied on currently-loaded page (V1 client-side, see DEV-S32-3.A-01) |

**Deviation acceptée V1** : `refund_status`, `has_modifiers`, `hour` filtrés **client-side** sur la page courante chargée (pas pushed down dans le WHERE de la RPC). Pour `refund_status` notamment, cela peut mener à 0 résultat sur la première page si peu de refunds — UI doit afficher "Load more" pour continuer à filtrer plus loin. **Pas idéal** mais évite de complexifier la RPC V1. Tracké comme DEV-S32-3.A-01 dans INDEX. À promouvoir en server-side filter S33+ si nécessaire.

### 5.3 Components à créer

- `apps/backoffice/src/pages/orders/OrdersListPage.tsx` (nouvelle page)
- `apps/backoffice/src/features/orders/components/OrdersFiltersBar.tsx`
- `apps/backoffice/src/features/orders/components/OrdersTable.tsx`
- `apps/backoffice/src/features/orders/components/ActiveFilterChips.tsx`

**Réutilise** :
- `<DateRangePicker>` (S29)
- `<ExportButtons>` (S29)
- `<ReportPage>` wrapper si applicable, sinon layout custom (Orders n'est pas un "report" sémantiquement)
- `<CustomerTypeahead>` si existe, sinon créer (peut être déféré S33+ et utiliser un Input + customer_id manual)

### 5.4 Sidebar nav

Ajouter entry `Orders` dans `apps/backoffice/src/layout/Sidebar.tsx` sous la section appropriée (probablement Sales group), icon `lucide:ShoppingCart`, gate `orders.read`. Position : entre `POS Sessions` et `Customers` si applicable.

### 5.5 Permission gate

- Route-level : `<PermissionGate permission="orders.read">` wrapping `<OrdersListPage>`
- Pas de "+ New Order" button visible dans S32 (action déférée)

---

## 6. Drill-down wiring (Wave 3 suite)

### 6.1 Reports à re-wirer (retire les "terminal comments" S31)

| Report | Page | Drill config |
|---|---|---|
| Profit & Loss | `ProfitLossPage` | line cells → `<DrilldownLink entity="account" id={line.account_id} filter={{start, end}} />` |
| Balance Sheet | `BalanceSheetPage` | idem |
| Cash Flow | `CashFlowPage` | idem |
| PB1 Report | `Pb1ReportPage` | `entity="account"` `id={resolvedAccountId('2110')}` `filter={{start: monthStart, end: monthEnd}}` |
| Stock Movement History | `StockMovementHistoryPage` | column product → `<DrilldownLink entity="product" id={line.product_id} />` |
| Payment by Method | `PaymentByMethodPage` | row → `<DrilldownLink entity="order_list" filter={{payment_method: line.method, start, end}} />` |
| Sales by Hour | `SalesByHourPage` | row → `<DrilldownLink entity="order_list" filter={{hour: line.hour, start, end}} />` (the report's current date range) |

### 6.2 `buildDrilldownUrl` extension

Ajouter case `'order_list'` qui produit `/backoffice/orders?<filter-spread>`. Le `filter` object est sérialisé clé-par-clé en query params (skip undefined/null). Unit tests +3-5 cas :
- T14 entity `order_list` filter `{payment_method: 'cash', start: '2026-05-01', end: '2026-05-31'}`
- T15 entity `order_list` filter `{hour: 14, start: '2026-05-15', end: '2026-05-15'}`
- T16 entity `order_list` filter empty → `/backoffice/orders` sans query
- T17 entity `order_list` filter avec `customer_id`
- T18 entity `order_list` filter avec `served_by` + `terminal_id`

### 6.3 `GeneralLedgerPage` URL-seeded

Modifier `apps/backoffice/src/features/accounting/pages/GeneralLedgerPage.tsx` :

```ts
import { useSearchParams } from 'react-router-dom';

const [searchParams] = useSearchParams();
const initialAccountId = searchParams.get('account_id') ?? '';
const initialStart     = searchParams.get('start')      ?? defaultPeriodStart();
const initialEnd       = searchParams.get('end')        ?? defaultPeriodEnd();

const [accountId, setAccountId] = useState<string>(initialAccountId);
const [startDate, setStartDate] = useState(initialStart);
const [endDate,   setEndDate]   = useState(initialEnd);
```

**Sync 2-way URL←→state défèré S33+** — les changements user via selectors ne writent pas l'URL. Acceptable pour V1.

---

## 7. Test plan (Wave 4)

| Suite | Compte | File path |
|---|---|---|
| pgTAP `get_orders_list_v1` | ~9 | `supabase/tests/orders_list_v1.test.sql` |
| pgTAP `accounting_account_id_exposed` | ~3 | `supabase/tests/accounting_account_id_exposed.test.sql` |
| Unit `buildDrilldownUrl` extension | +5 | `apps/backoffice/src/features/reports/utils/__tests__/buildDrilldownUrl.test.ts` |
| BO smoke `orders-list-page` | ~3 | `apps/backoffice/src/pages/orders/__tests__/OrdersListPage.smoke.test.tsx` |
| BO smoke wiring samples (5 reports) | ~5 | reports `__tests__/` dir |
| BO smoke `general-ledger-url-param` | 1 | `apps/backoffice/src/features/accounting/pages/__tests__/GeneralLedgerPage.smoke.test.tsx` |
| BO unit `useOrdersList` | 2 | `apps/backoffice/src/features/orders/hooks/__tests__/useOrdersList.test.ts` |
| `pnpm typecheck` | 6/6 | turbo |

### 7.1 pgTAP cases détaillés

**`get_orders_list_v1`** :
- T1 perm gate : CASHIER → 42501 (no orders.read)
- T2 happy basic : MANAGER + 2026-05-01..2026-05-26 → lines array shape complet
- T3 filter `status=completed` → exclut voided/open
- T4 filter `payment_method=cash` → only orders w/ ≥1 cash payment
- T5 filter `customer_id=<uuid>` → only that customer
- T6 cursor pagination : limit=2, p_cursor=row3.created_at → returns rows 4,5
- T7 limit clamp : p_limit=500 → returns at most 200
- T8 computed col `refund_status` : seed 1 order w/ full refund → `'full'` ; 1 partial → `'partial'`
- T9 computed col `has_modifiers` : seed 1 order w/ modifier → true ; w/o → false

**`accounting_account_id_exposed`** :
- T1 P&L → first line has `account_id` UUID matching `accounts.id WHERE code = line.code`
- T2 BS idem
- T3 CF idem

### 7.2 BO smoke cases

**`OrdersListPage.smoke.test.tsx`** :
- T1 default mount → API call `useOrdersList` invoked w/ default date range + empty filters
- T2 URL params `?payment_method=cash&customer_id=X` → `useOrdersList` invoked with those filters (assert via RPC mock spy)
- T3 row click → navigates to `/backoffice/orders/<id>` (assert via `useNavigate` mock or `<MemoryRouter>` history)

**Wiring samples** (5 BO smoke files) :
- `profit-loss-drilldown.smoke.test.tsx` — assert `<DrilldownLink>` rendered with `to="/accounting/general-ledger?account_id=...&start=...&end=..."`
- `balance-sheet-drilldown.smoke.test.tsx` — idem
- `payment-by-method-drilldown.smoke.test.tsx` — assert `to="/backoffice/orders?payment_method=cash&start=...&end=..."`
- `stock-movements-drilldown.smoke.test.tsx` — assert `to="/backoffice/inventory/recipes/<product_id>"`
- `sales-by-hour-drilldown.smoke.test.tsx` — assert `to="/backoffice/orders?hour=14&start=...&end=..."`

**`GeneralLedgerPage.smoke.test.tsx`** :
- T1 `<MemoryRouter initialEntries={['/accounting/general-ledger?account_id=<uuid>&start=2026-05-01&end=2026-05-26']}>` → assert account selector value = `<uuid>` and date inputs = those dates

---

## 8. Permissions

Aucune nouvelle permission seedée. `orders.read` (S31) couvre OrdersListPage + RPC gate.

---

## 9. Migrations applied

Block `20260617000010..014` (5 migrations) :

| # | Object | Type |
|---|---|---|
| `_010` | `get_profit_loss_v1` | CREATE OR REPLACE additive |
| `_011` | `get_balance_sheet_v1` | CREATE OR REPLACE additive |
| `_012` | `get_cash_flow_v1` | CREATE OR REPLACE additive |
| `_013` | `get_orders_list_v1` | NEW CREATE FUNCTION |
| `_014` | REVOKE pair on `get_orders_list_v1` | REVOKE FROM PUBLIC + FROM anon + ALTER DEFAULT PRIVILEGES |

Plus 1 type regen committé en chore commit (pas une migration).

---

## 10. Risks & deviations to anticipate

| ID | Risk | Mitigation |
|---|---|---|
| R-S32-1 | `orders.terminal_id` peut ne pas exister sur le schema cloud | Wave 1.D vérifie via `execute_sql \d orders` AVANT d'écrire la RPC ; doc en deviation si missing — fallback : remove filter axis |
| R-S32-2 | `customers.full_name` vs `customers.display_name` schema discovery | Wave 1.D vérifie ; pattern S31 DEV-S31-2.A-01..02 |
| R-S32-3 | `payment_method_primary` ambigü sur split orders | RPC retourne `'mixed'` ; doc dans COMMENT ON FUNCTION |
| R-S32-4 | Bump P&L/BS/CF JSONB → consumers existants doivent absorber le nouveau field | Pure additive — TypeScript optional ou required selon hook. Si optional partout suffit, garder optional |
| R-S32-5 | `refund_status` filter client-side V1 → "Load more" UX bizarre si peu de refunds | Tracké DEV-S32-3.A-01 ; promouvoir server-side S33+ si feedback user |
| R-S32-6 | 7 tests vitest BO flaky en sweep complet (S31 DEV-S31-4.A-02) | Pas dans scope S32 ; isoler suite par filtre si besoin |
| R-S32-7 | `get_pb1_report_v1` ne retourne pas account_id → resolve côté client via ChartOfAccounts | §4.3 option A documenté ; pas de bump RPC |

---

## 11. Acceptance criteria

- [ ] 3 migrations P&L/BS/CF apply OK + JSONB lines contiennent `account_id` (pgTAP 3/3 PASS)
- [ ] Migration `get_orders_list_v1` + REVOKE pair apply OK + pgTAP 9/9 PASS
- [ ] Types regen committé + 4 hooks BO interfaces étendues (PnL/BS/CF/StockMovements lines)
- [ ] `useOrdersList` hook créé + 2 unit tests PASS
- [ ] `OrdersListPage` créée + 3 smoke tests PASS + route `/backoffice/orders` + sidebar entry + permission gate
- [ ] `buildDrilldownUrl` étendu avec `entity='order_list'` + 5 unit tests PASS
- [ ] 7 reports re-wirés (P&L, BS, CF, PB1, StockMovements, PaymentByMethod, SalesByHour) + 5 BO smoke samples PASS
- [ ] `GeneralLedgerPage` lit `?account_id=&start=&end=` URL params + 1 smoke test PASS
- [ ] `pnpm typecheck` 6/6 packages PASS
- [ ] INDEX `2026-05-26-session-32-INDEX.md` créé + CLAUDE.md Active Workplan bumpé

---

## 12. Out of scope (S33+ candidates)

1. "+ New Order" button + flow on `/backoffice/orders`
2. Actions sur OrderDetailPage (refund/void/edit) — déféré S31
3. Compare toggle sur 5 reports S30
4. UnifiedReportFilters extra dims (category/terminal/customer)
5. Hub mini-KPI bar + favorites/pinning sur ReportsIndexPage
6. Mobile responsive detail pages + reports
7. 6 Soon cards restantes (Daily Sales, Purchase ×3, Production Report, Staff Performance, Price Changes, Permission Change Log)
8. Saved filter presets / shareable filter collections
9. `refund_status` + `has_modifiers` server-side filtering (V1 client-side)
10. Multi-payment_method filter (V1 single)
11. GeneralLedgerPage 2-way URL sync
12. Bump `get_pb1_report_v1` to expose `account_id` directly (V1 resolves client-side)
