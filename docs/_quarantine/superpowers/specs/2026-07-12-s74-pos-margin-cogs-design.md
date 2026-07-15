# S74 — Onglet Margin (Reports POS) : marge/COGS WAC courant, lecture pure

> **Date :** 2026-07-12 · **Session :** S74 · **Statut :** spec approuvée (brainstorm 2026-07-12)
> **Contexte :** dernier lot de la refonte module Reports POS (`apps/pos/src/features/reports`,
> lots A→G mergés #189–#194, fix Overview #207). L'« Option A » actée = **marge sur WAC courant,
> lecture pure** — le snapshot COGS à la vente (`order_items.unit_cost`) reste en Vague 3
> (décision propriétaire 2026-07-07). **Money-path v17/v11/v5 non touché.**

## Décisions actées (brainstorm 2026-07-12)

| Question | Décision |
|---|---|
| Option A | Marge **WAC courant** (`products.cost_price`), RPC lecture pure — pas de snapshot, zéro contact money-path |
| Gate | **`reports.financial.read`** (comme la marge BO) — pas `reports.sales.read` : les coûts/profits ne sont pas visibles d'un simple lecteur de ventes |
| Forme UI | **Onglet « Margin » dédié**, masqué sans la permission |
| Backend | **Approche 1** : nouveau RPC `get_pos_margin_v1` sur le périmètre partagé du module (réconcilie l'Overview ; diverge du BO Gross Margin qui inclut le B2B — assumé) |
| Cadeaux-promo | **Inclus dans le COGS avec revenue 0** (un produit offert consomme du stock) — seule divergence volontaire avec `items_sold` Overview |

## 1. Backend — RPC `get_pos_margin_v1` (migration `20260712000160`)

`get_pos_margin_v1(p_start_date TEXT, p_end_date TEXT) RETURNS JSONB`,
`plpgsql STABLE SECURITY DEFINER`, `SET search_path = public, pg_temp`.

- **Gate** : `auth.uid()` non NULL + `has_permission(auth.uid(), 'reports.financial.read')` → sinon `42501`.
- **Gardes** (pattern lots A→G) : dates castées, `end < start` → `P0001`, clamp 366 jours, tz depuis `business_config` (défaut `Asia/Makassar`).
- **REVOKE trio** : `REVOKE ALL … FROM PUBLIC, anon` + `GRANT EXECUTE … TO authenticated`.
- **COMMENT ON FUNCTION** documentant le caveat WAC + le périmètre.
- **Types greffés** sur `packages/supabase/src/types.generated.ts` (DEV-S69-03 — pas de regen complet, le générateur MCP diverge).

### Périmètre (≡ Overview `_146`/`_153`, invariant du module)

Commandes : `status IN ('paid','completed')` · `voided_at IS NULL` · `paid_at IS NOT NULL`
· `order_type <> 'b2b'` · `is_historical_import = false` · exclusion des commandes contenant
un produit `is_test`. Datation : `(paid_at AT TIME ZONE tz)::date` dans la plage.
Lignes : `is_cancelled = false`.

### Règles de calcul

- **COGS ligne** = `oi.quantity × p.cost_price` (WAC courant — caveat UI, snapshot en Vague 3).
- **Revenue marge** = `oi.line_total` (HT, net remise ligne — même base que le BO ; les remises
  panier ne sont pas redistribuées par ligne, caveat documenté).
- **Cadeaux-promo** : lignes incluses (qty + COGS, revenue 0).
- **Produit sans coût** (`cost_price` NULL ou 0) : COGS 0, compté dans `products_without_cost`.

### Enveloppe de retour

```jsonc
{
  "start_date": "…", "end_date": "…", "timezone": "…",
  "summary": {
    "revenue_ttc": 0,        // SUM(orders.total) — ≡ Overview au centime (asserté pgTAP)
    "revenue_ht": 0,         // SUM(line_total) lignes valides
    "cogs": 0,
    "gross_margin": 0,       // revenue_ht - cogs
    "margin_pct": 0,         // gross_margin / NULLIF(revenue_ht,0) × 100
    "orders": 0,
    "products_without_cost": 0
  },
  "by_product": [ { "product_id": "…", "product_name": "…", "category_name": "…",
                    "qty": 0, "revenue_ht": 0, "cogs": 0, "margin": 0, "margin_pct": 0 } ],
  "by_category": [ { "category_id": "…", "category_name": "…",
                     "qty": 0, "revenue_ht": 0, "cogs": 0, "margin": 0, "margin_pct": 0 } ]
}
```

Non-catégorisé → `category_id` null / `(uncategorized)` (miroir Lot E).

## 2. Frontend — `apps/pos/src/features/reports/`

- **Hook** `usePOSMarginReport` (`hooks/`, même moule que les hooks des 7 onglets).
- **Page** `POSMarginReportPage.tsx` : range picker partagé du layout, 4 KPI cards
  (CA TTC · COGS · Marge brute · Marge %), tableau **par produit** triable
  (qty, CA HT, COGS, marge, marge %), section **par catégorie**, **export CSV** par vue
  (helper `buildCsv` du domaine).
- **Caveat permanent** : bandeau « COGS = WAC courant, pas un coût figé à la vente »
  + badge d'alerte si `products_without_cost > 0` (« N produits sans coût — marge surestimée »).
- **Onglet « Margin »** dans `POSReportsLayout`, **masqué sans `reports.financial.read`** ;
  route gatée → `ReportsForbidden` en accès direct.

## 3. Tests

- **pgTAP live** (MCP `execute_sql`, enveloppe `BEGIN…ROLLBACK`, pattern temp-table
  d'assertions) : gate 42501 · gardes P0001 · enveloppe/tz · **`summary.revenue_ttc` ≡
  `get_pos_sales_overview_v1().revenue` au centime** (réconciliation croisée) ·
  `SUM(by_product.revenue_ht) = summary.revenue_ht` (idem cogs) · recompute ligne-à-ligne
  d'un produit témoin · produit sans coût → `products_without_cost` incrémenté, COGS 0 ·
  cadeau-promo → qty+COGS comptés, revenue 0 · REVOKE anon/PUBLIC effectifs.
  Fichier co-localisé `supabase/tests/pos_margin.test.sql`.
- **POS** : smoke page + hook (Vitest, mocks stables `vi.hoisted`), suite reports re-verte,
  `pnpm typecheck`, build POS.

## 4. Livraison & process

- Branche `feat/pos-reports-margin`, **1 PR**, squash-merge.
- Revue **pattern-guardian** du diff avant merge (lot financier → revue exigeante,
  cf. mention « revue opus » de la décision d'origine).
- Closeout : bump CLAUDE.md — la **refonte Reports POS est soldée** (lots A→G + Overview
  + Margin) ; bandeau « Mise à jour S74 » sur la fiche
  `docs/workplan/remise-a-plat/14-reports-analytics.md` ; checklist anti-dérive.

## Hors périmètre (explicite)

- Snapshot COGS à la vente (`order_items.unit_cost`) — **Vague 3**, reportée.
- Toute modification des RPCs money-path v17/v11/v5 ou `_record_sale_stock_v1`.
- La page BO Gross Margin (`get_gross_margin_by_product_v1`) — intacte ; la divergence
  de périmètre POS↔BO (B2B, `is_test`) est assumée et documentée dans le COMMENT du RPC.
