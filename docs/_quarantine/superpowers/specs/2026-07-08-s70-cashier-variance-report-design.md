# S70 — Rapport des écarts de caisse par caissier (fiche 12 D2.4)

> **Date :** 2026-07-08 · **Session :** S70 · **Vague :** 2 · **Branche cible :** `swarm/session-70` (base `1b1e68eb` = master post-#177)
> **Ferme :** fiche **12 D2.4** (« Rapport écarts par caissier côté BO ») + le sous-verdict 🟠 du scénario multi-caissiers (fiche 12 §C : « aucun rapport tendance des écarts par caissier »).
> **Nature :** report **lecture pure**. Zéro écriture DB, **aucun bump money-path**, aucune migration destructive.

## 1. Problème & objectif

La fiche 12 (Caisse physique & shifts) recense un scénario propriétaire non couvert : *« Plusieurs caissiers se relaient sur le même terminal, chacun sa session ; le gérant repère un **manque récurrent par caissier** dans l'historique »* — typiquement « tel caissier manque le mardi ». Aujourd'hui le BO n'offre que la **liste des Z-reports** (`ZReportsListPage`) ; il n'existe **aucune agrégation des écarts par caissier**.

**Objectif :** un rapport BO qui agrège les écarts de clôture de shift **par caissier**, avec une **ventilation par jour de la semaine** pour faire ressortir la récurrence, sur une plage de dates choisie.

## 2. Décisions (validées 2026-07-08)

1. **Portée = 3 volets** (cash + QRIS + carte) dans la ligne résumé par caissier.
2. **Attribution = `pos_sessions.opened_by`** (le propriétaire du tiroir, responsable réel du fond) — pas `closed_by`. En opération normale `opened_by == closed_by` ; le seul cas divergent (manager clôturant une session oubliée) doit laisser le manque au caissier qui tenait le tiroir.
3. **Ventilation jour-de-semaine = cash seul** (le signal de fraude ; une matrice 3 volets × 7 jours par caissier serait illisible). Les totaux QRIS/carte restent dans la ligne résumé.
4. **Export = CSV seul** en v1 (via `buildCsv` + `ExportButtons`). **Pas de template PDF** (resterait dans le périmètre « lecture pure » ; un PDF exigerait un template dans l'EF `generate-pdf`).
5. **Aucun changement de schéma** sur `pos_sessions`. Les écarts non-cash sont lus depuis des données **déjà figées au close**, pas recomputés.

## 3. Modèle de données (existant, non modifié)

Colonnes `pos_sessions` pertinentes (vérifiées en DB live) :
- `opened_by uuid`, `closed_by uuid`, `opened_at`, `closed_at`, `status` (enum, valeur close = `'closed'`).
- `variance_total numeric` = **écart cash figé** = `counted_cash − expected_cash` → **négatif = manque (short), positif = excédent (over)**.
- `counted_qris numeric`, `counted_card numeric` (montants comptés ; `NULL` = volet non compté).
- `expected_cash`, `closing_cash` (pour info).

**Expected/variance QRIS & carte** : **pas de colonne** dédiée. `close_shift_v5` les calcule au close et les écrit (figés) dans la ligne **`audit_logs` action `'shift.close'`**, `metadata` :
`expected_qris`, `variance_qris`, `expected_card`, `variance_card`, `counted_qris`, `counted_card`, `variance` (cash), `expected_cash`, `counted_cash`.

> **Choix de source (fidélité + stabilité) :** cash depuis `pos_sessions.variance_total` (figé) ; QRIS/carte depuis `audit_logs.metadata` de la clôture (figé). **On NE recompute PAS** l'expected depuis `order_payments` : un ordre de la session voidé *après* la clôture ferait dériver le chiffre rétroactivement. Sessions closes **avant S67** → clés non-cash absentes → volets QRIS/carte à `NULL` (rendus « — »).

Le carte (« card ») fusionne `card`+`edc` — déjà fait par `close_shift_v5`, donc `variance_card`/`expected_card` de la metadata portent déjà cette fusion. Rien à refaire.

## 4. RPC `get_cashier_variance_v1`

```
get_cashier_variance_v1(p_start_date date, p_end_date date) RETURNS jsonb
```

- **SECURITY DEFINER STABLE**, `SET search_path = public, pg_temp`.
- **Gate :** `IF NOT public.has_permission(auth.uid(),'reports.read') THEN RAISE 'forbidden' ERRCODE 'P0003'`.
- **Trio S20 :** `REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated;` + `COMMENT`.
- **Validation args :** `p_start_date`/`p_end_date` non nuls, `p_start_date <= p_end_date` (sinon `invalid_date_range` P0001).
- **Timezone :** lire `business_config.timezone` ; bucketer `closed_at` en date locale : `(ps.closed_at AT TIME ZONE v_tz)::date`. `dow` = `EXTRACT(DOW FROM (closed_at AT TIME ZONE v_tz))` (0=dimanche … 6=samedi).
- **Périmètre :** `status='closed'` ET `closed_at` non nul ET date locale ∈ `[p_start_date, p_end_date]`. `GROUP BY opened_by`.
- **Nom du caissier :** `user_profiles` joint sur `opened_by` (`full_name`/`name` selon le schéma réel — à vérifier à l'apply, cf. autres rapports qui résolvent le nom staff).

**Structure de retour :**

```jsonc
{
  "generated_at": "<now()>",
  "start_date": "<p_start_date>",
  "end_date": "<p_end_date>",
  "timezone": "<business_config.timezone>",
  "cashiers": [
    {
      "cashier_id": "<uuid>",
      "cashier_name": "<text>",
      "sessions_count": 12,
      "cash": {
        "total_variance": -180000,     // Σ variance_total
        "avg_variance": -15000,        // total_variance / sessions_count
        "total_short": -220000,        // Σ des variance_total < 0
        "short_count": 8,              // # sessions variance_total < 0
        "over_count": 3,               // # sessions variance_total > 0
        "worst_variance": -75000       // min(variance_total) (plus gros manque)
      },
      "qris": { "counted_sessions": 5, "total_variance": -12000 },  // ignore sessions sans compte QRIS
      "card": { "counted_sessions": 4, "total_variance": 0 },
      "dow_cash": [
        { "dow": 2, "sessions": 3, "total_variance": -150000 },     // mardi = signal
        { "dow": 4, "sessions": 2, "total_variance": -30000 }
        // seuls les dow présents ; le front complète les 7 jours
      ]
    }
  ],
  "totals": {
    "sessions_count": 24,
    "cash": { "total_variance": …, "total_short": …, "short_count": …, "over_count": … },
    "qris": { "counted_sessions": …, "total_variance": … },
    "card": { "counted_sessions": …, "total_variance": … }
  }
}
```

- `cashiers` trié par `total_short` croissant (le plus gros manque cumulé en premier — c'est ce que le gérant cherche).
- Null-safety non-cash : les agrégats `qris`/`card` n'additionnent que les sessions où `counted_qris`/`counted_card IS NOT NULL` **et** dont la metadata de clôture porte la clé `variance_qris`/`variance_card`. `counted_sessions=0` → `total_variance` = 0 (rendu « — » côté UI si 0 session comptée).
- Aucune ligne si aucune session close sur la plage → `cashiers: []`, `totals` à zéro (l'UI affiche l'état vide).

**Implémentation SQL (esquisse, à finaliser dans le plan) :** CTE `sessions` = jointure `pos_sessions` ↔ `LATERAL` sur la ligne `audit_logs` `shift.close` (`entity_type='pos_sessions'`, `entity_id=ps.id`, `action='shift.close'`, `LIMIT 1`) pour extraire `variance_qris`/`variance_card` de `metadata` ; puis agrégats `GROUP BY opened_by` et un CTE `dow` `GROUP BY opened_by, dow` réinjecté en `jsonb_agg`.

## 5. Backoffice

Miroir strict du pattern rapports (`get_sales_by_staff_v1` / `useSalesByStaff` / `SalesByStaffPage`).

- **Hook** `apps/backoffice/src/features/reports/hooks/useCashierVariance.ts` — appelle le RPC, `classify` 42501→`permission_denied`, clé de query `['cashier-variance', start, end]`.
- **Page** `apps/backoffice/src/pages/reports/CashierVariancePage.tsx` (+ feature component si besoin) :
  - `DateRangePicker` (défaut 30 derniers jours).
  - Enveloppe `ReportPage` avec prop `emptyState` (aucune session close sur la plage).
  - **Tableau résumé** — 1 ligne/caissier trié par plus gros manque :
    | Caissier | Sessions | Σ écart cash | Moy. | # short | # over | Pire | Σ QRIS | Σ carte |
    - Montants `tabular-nums` ; écart cash coloré rouge (<0) / vert (>0) via tokens sémantiques (pas de hex brut — cf. lock ESLint palette).
    - QRIS/carte : « — » si `counted_sessions=0`.
  - **Ventilation jour-de-semaine (cash)** — sous chaque caissier (bloc dépliable) ou une heatmap 7 colonnes L→D : Σ variance cash + nb sessions par jour. Le front complète les 7 jours (jours absents = 0/vide). Libellés jours localisés.
  - **Export** `ExportButtons` : **CSV** uniquement (`buildCsv`, colonnes = **tableau résumé aplati, une ligne par caissier**). La ventilation jour-de-semaine reste **hors CSV** en v1 (visible seulement à l'écran).
- **Route** `apps/backoffice/src/routes/index.tsx` : `const CashierVariancePage = lazy(...)`, entrée sous le groupe Reports, **gate `reports.read`**.
- **Sidebar** : entrée « Écarts caissiers » (groupe Reports) gatée `reports.read`.
- **Tuile** `ReportsIndexPage` : carte vers la page, gatée `reports.read`.

## 6. Tests

- **pgTAP `supabase/tests/cashier_variance.test.sql`** (exécution MCP `execute_sql` en `BEGIN … ROLLBACK`, capture pass/fail par table temp — cf. workflow projet) :
  - Seed 2 caissiers (`user_profiles` + auth), plusieurs `pos_sessions` **closes** à `variance_total` connus, sur des jours de semaine distincts, + lignes `audit_logs` `shift.close` avec `variance_qris`/`variance_card` connus.
  - Asserte : agrégats cash (Σ, moy, total_short, short/over count, worst) ; attribution par **`opened_by`** y compris une session où `closed_by ≠ opened_by` (manager) → manque au `opened_by` ; ventilation `dow_cash` correcte ; bord **minuit tz locale** (une session à 23:30 UTC bascule de jour local) ; volets QRIS/carte lus depuis la metadata (+ session pré-S67 sans clés → volet `NULL`/ignoré) ; **filtre plage de dates** (session hors plage exclue) ; **gate** : appel anon refusé + utilisateur sans `reports.read` refusé (42501/P0003).
  - Ancre : re-vérifier `s44_money_gates` **non impacté** (aucune écriture) — sanity only.
- **Smoke BO** `apps/backoffice/src/features/reports/__tests__/CashierVariancePage.smoke.test.tsx` : rendu du tableau avec données mockées (1+ caissier), état vide, colonne cash colorée, « — » QRIS/carte quand 0 session comptée.

## 7. Séquençage (subagent-driven, branche `swarm/session-70`)

1. **Migration `20260710000140`** — `get_cashier_variance_v1` + trio REVOKE/GRANT/COMMENT. Apply via MCP `apply_migration`. Insérer le bookkeeping (horloge locale UTC+8) si nécessaire.
2. **Types regen** via MCP `generate_typescript_types` → `packages/supabase/src/types.generated.ts`. **Greffe** si le générateur diverge (drift `get_stock_levels_v1`/fns internes, cf. DEV-S69-03) : partir des types master + ajouter le seul delta `get_cashier_variance_v1`.
3. **pgTAP** `cashier_variance` (contrôleur, MCP).
4. **BO** : hook + page + route + sidebar + tuile ReportsIndex.
5. **Smoke** BO.
6. **Revue** `pattern-guardian` (read-only) + closeout : INDEX `docs/workplan/plans/2026-07-08-session-70-INDEX.md`, bump fiche 12 (D2.4 ✅) + 00-INDEX + CLAUDE.md Active Workplan.

## 8. Hors périmètre (YAGNI v1)

- Export PDF (template EF).
- Ventilation jour-de-semaine pour QRIS/carte.
- Drill-down session-par-session par caissier (le tableau + dow suffit au scénario ; extension possible en v2).
- Toute alerte proactive / notification de manque récurrent (report seulement).
- Colonnes `expected_qris/expected_card/variance_qris/variance_card` matérialisées sur `pos_sessions` (aurait exigé un bump `close_shift_v6` + backfill — hors « lecture pure »).

## 9. Risques & garde-fous

- **Aucune écriture DB** : RPC `STABLE`, aucun `INSERT/UPDATE`. Money-path (`complete_order_with_payment_v17`, `close_shift_v5`) **non touchée**.
- **Dépendance à la forme de `audit_logs.metadata`** : si la clé `variance_qris`/`variance_card` change de nom dans une future version de `close_shift`, les volets non-cash retomberaient à `NULL` (dégradation silencieuse, pas de crash). À documenter comme dette.
- **tz** : réutiliser exactement le pattern de bucketing des rapports existants (`get_daily_sales_v1`) pour cohérence.
- **Nom du caissier** : vérifier la vraie colonne de `user_profiles` à l'apply (déviation probable, cf. DEV-S69 sur les colonnes réelles).
