# S63 — Dashboard BO réel : `get_dashboard_overview_v1` + câblage de la page d'accueil

> **Date :** 2026-07-06 · **Session :** S63 (branche `swarm/session-63`) · **Statut :** spec validée en brainstorming (sections 1 et 2 approuvées par le propriétaire)
> **Source :** fiche [`docs/workplan/remise-a-plat/14-reports-analytics.md`](../../workplan/remise-a-plat/14-reports-analytics.md) §D2.1 — « Câbler le Dashboard d'accueil ».
> **Constat de départ :** `apps/backoffice/src/pages/Dashboard.tsx` est un stub à zéros (`emptyOverview()`, lignes 52-61) ; le RPC `get_dashboard_overview_v1` évoqué en TODO (ligne 16) n'existe ni en migrations, ni en DB live, ni dans `types.generated.ts` ; aucun hook `useDashboardOverview` n'existe.

## 1. Objectif et périmètre

Câbler la page d'atterrissage du BackOffice sur des données réelles : **page complète** — les 5 tuiles KPI **et** les 5 panneaux (tendance 30 j, revenu par type de commande, top produits du jour, ventes horaires, moyens de paiement) avec de vrais graphiques recharts.

**Hors périmètre (YAGNI, décisions actées au brainstorming) :**
- Pas de sélecteur de période ni de comparaison période précédente (le hub Rapports les fournit déjà).
- Pas de drill-down ni d'export sur le Dashboard v1.
- Pas de realtime — polling React Query 60 s + bouton refresh manuel existant.
- Aucune nouvelle permission — réutilisation de `reports.read`.
- Money-path intouchée : RPC de **lecture pure**, aucune écriture, aucun RPC de vente modifié.

## 2. Architecture retenue (approche A — RPC unique)

Un seul RPC agrégé `get_dashboard_overview_v1` renvoyant toute l'enveloppe en un round-trip, consommé par un seul hook `useDashboardOverview`, pollé à 60 s.

Alternatives écartées :
- **B — composer les RPCs rapports existants côté client** : 5-6 round-trips par refresh, gates hétérogènes (`reports.sales.read` vs `reports.financial.read` → page cassée partiellement selon le rôle), et il manquerait de toute façon les KPIs jour, le top produits et le revenu par type.
- **C — hybride** (RPC neuf pour les KPIs + RPCs existants pour les panneaux) : cumule migration ET multi-appels.

## 3. Contrat serveur — `get_dashboard_overview_v1`

### 3.1 Signature et propriétés

```sql
CREATE OR REPLACE FUNCTION public.get_dashboard_overview_v1()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
```

- **Sans argument** : « aujourd'hui » et « 30 jours » sont fixes.
- **Migration :** `20260710000113` (S62 s'est arrêtée à `_112` ; re-vérifier le plus haut NAME-block au moment du plan).
- **Gate :** `IF auth.uid() IS NULL OR NOT has_permission(auth.uid(), 'reports.read') THEN RAISE ... ERRCODE '42501'` — même permission que le hub Rapports, aucune permission nouvelle.
- **Trio S20 :** `REVOKE ALL ... FROM PUBLIC` + `REVOKE EXECUTE ... FROM anon` + `GRANT EXECUTE ... TO authenticated` + `COMMENT ON FUNCTION`.

### 3.2 Définition commune « commande valide » (miroir exact de `get_daily_sales_v1`, migration `20260624000011`)

- `status IN ('paid', 'completed')`
- `voided_at IS NULL`
- `paid_at IS NOT NULL`
- Jour/heure locaux = `paid_at AT TIME ZONE v_tz` avec `v_tz = COALESCE(MAX(timezone), 'Asia/Makassar') FROM business_config WHERE id = 1`.

Conséquence assumée : **le B2B ne compte qu'une fois payé** — les commandes `b2b_pending` n'apparaissent pas dans le CA du jour (cohérent avec la réalité de caisse et avec Daily Sales).

### 3.3 Enveloppe retournée

| Clé | Forme | Définition |
|---|---|---|
| `kpis.revenue_today` | numeric | **Net** = Σ `orders.total` des commandes valides du jour local − Σ `refunds.total` du jour local (miroir du `net` de Daily Sales) |
| `kpis.orders_today` | int | COUNT des commandes valides du jour |
| `kpis.items_sold` | numeric | Σ `order_items.quantity` des commandes valides du jour, **hors lignes annulées** (prédicat exact d'exclusion à vérifier sur le schéma live au moment du plan — `cancelled_at`/statut de ligne) |
| `kpis.avg_basket` | numeric | brut ÷ `orders_today` (miroir de l'`aov` existant : `ROUND(SUM(gross)/count, 2)`, 0 si aucune commande) |
| `kpis.customers_today` | int | COUNT(DISTINCT `customer_id`) non nul sur les commandes valides du jour |
| `revenue_30d` | `[{date, net, order_count}]` | 30 derniers jours locaux **y compris aujourd'hui**, série **continue** (jours sans vente présents à 0, via `generate_series`) |
| `revenue_by_type` | `[{order_type, gross, order_count}]` | aujourd'hui, sur l'enum `order_type` (`dine_in`/`take_out`/`delivery`/`b2b`) ; seuls les types présents sont retournés |
| `top_products` | `[{product_id, name, qty, revenue}]` | top **5** par revenu du jour, depuis `order_items` (snapshot de nom de la ligne — colonne exacte à confirmer au plan), lignes annulées exclues |
| `hourly_sales` | `[{hour, gross, order_count}]` | aujourd'hui, `hour` = heure locale 0-23, seules les heures avec ventes retournées |
| `payment_methods` | `[{method, amount, count}]` | paiements du jour local depuis `order_payments` (rattachés aux commandes valides ; colonnes exactes méthode/montant à confirmer au plan) |
| `generated_at` | timestamptz | `now()` serveur — alimente « Last updated » |

Erreurs : `42501` (permission) ; aucune autre erreur métier attendue (lecture seule, pas d'input).

## 4. Frontend

### 4.1 Hook `useDashboardOverview`

- Fichier : `apps/backoffice/src/features/dashboard/hooks/useDashboardOverview.ts` (nouveau dossier feature, convention co-location).
- React Query : `queryKey: ['dashboard-overview']`, `supabase.rpc('get_dashboard_overview_v1')`, `refetchInterval: 60_000`, `staleTime: 30_000`.
- Types dérivés de `types.generated.ts` après regen (pas de types dupliqués à la main).
- Classification d'erreur : `42501` → `permission_denied` ; le reste → erreur générique.

### 4.2 Câblage `Dashboard.tsx`

- La page appelle le hook directement (comme annoncé par son TODO « will read directly from a co-located hook »).
- La prop `data?` (override de test) est **conservée** : quand elle est fournie, le hook n'est pas sollicité — les tests existants continuent de mocker sans réseau.
- États : squelette loading existant conservé ; bandeau erreur existant conservé ; **nouvel état « accès restreint »** propre quand `permission_denied` (tuiles masquées + message explicatif, pas d'erreur brute) ; « Last updated » passe sur `generated_at` serveur.
- L'interface locale `DashboardOverview` du stub est remplacée par le type dérivé du RPC.

### 4.3 Les 5 panneaux (recharts `^2.13`, déjà en dépendance ; palette `features/reports/utils/chartColors.ts` existante)

| Panneau | Rendu |
|---|---|
| Tendance 30 j | `LineChart` (net/jour, série continue — les jours à zéro se voient) |
| Revenu par type | `PieChart` donut + légende (4 types max) |
| Top produits | **liste** 5 lignes (nom, qté, revenu) — pas de graphe, plus lisible |
| Ventes horaires | `BarChart` par heure locale — l'UI complète les heures absentes à 0 côté client (axe 0-23 continu) |
| Moyens de paiement | **liste** montants + part en % |

Chaque panneau garde son `EmptyState` actuel quand sa série est vide (décision canonique « chargé, sans erreur, zéro ligne », comme `ReportPage`).

## 5. Tests et vérifications

1. **pgTAP** `supabase/tests/dashboard_overview.test.sql` (exécutée via MCP `execute_sql` en `BEGIN ... ROLLBACK`) :
   - seed de commandes (payées, voided, `b2b_pending`, avec refund, multi-types, multi-heures) → assertions sur chaque clé de l'enveloppe ;
   - série `revenue_30d` continue (30 points) ;
   - exclusion des voided et des `b2b_pending` ;
   - bucketing timezone (une commande à cheval UTC/local tombe dans le bon jour) ;
   - refus `42501` sans `reports.read` ;
   - EXECUTE `anon` révoqué (ACL vérifiée).
2. **Smoke BO** : `Dashboard.test.tsx` mis à jour — états loading / erreur / accès restreint / données (mock du hook).
3. **Chaîne standard** : regen types (`generate_typescript_types` → `packages/supabase/src/types.generated.ts`, commit), `pnpm typecheck`, `pnpm build`, suites ciblées.
4. Aucune ancre money-path requise (RPC lecture pure) — mais la suite `s44_money_gates` reste disponible si la revue de branche le souhaite.

## 6. Points à vérifier en début de plan (DB live via MCP)

- Le plus haut NAME-block de migration (≥ `_113`).
- Prédicat exact d'exclusion des lignes annulées sur `order_items` (`cancelled_at` ? statut ?).
- Colonne snapshot du nom produit sur `order_items` (`name_snapshot` d'après S60 — à confirmer).
- Colonnes exactes de `order_payments` (méthode, montant, timestamp).
- Que `reports.read` est bien seedée pour les rôles attendus (admin/manager) — lecture seule, aucun changement de seed prévu.

## 7. Dépendances et impacts

- **Module 19** : `business_config.timezone` pilote tout le bucketing (pattern `_094`).
- **Module 20** : le cloisonnement repose sur le mapping rôles→`reports.read` existant.
- **Fiche 14** : à mettre à jour au closeout (D2.1 → ✅ soldé) ; le constat « Dashboard stub » de la fiche disparaît.
- **Doc v1.3** : l'amendement D4.4 (« câblage du tableau de bord d'accueil » en À venir) devient caduc — à basculer en revendication réelle.
