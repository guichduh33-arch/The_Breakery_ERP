# S54 — P1.3 (T6) Correctness compta : garde fiscale fail-closed + clôture annuelle

- **Date** : 2026-07-02 · **Branche** : `swarm/session-54`
- **Audit source** : §4 P1.3 (T6, C10) + §5 T6 de `docs/workplan/audits/2026-06-27-audit-integral-par-module.md`
- **Périmètre CLAUDE.md** : TB cumulative as-of (vérifier `get_trial_balance_v3`), dédup PB1 void+refund (vérifier), garde fiscale fail-closed, clôture annuelle (carry-forward → 3200).

## 1. État des 4 items

| Item | État | Reste à faire |
|---|---|---|
| Dédup PB1 void+refund (C10) | **Livré S51** (`20260710000057`, suite `pb1_dedup_void_refund.test.sql`) | Re-run ancre |
| TB cumulative as-of | **Livré S51** (`20260710000061`, suite `trial_balance_v3_cumulative.test.sql`) | Re-run ancre **+ D4 (leak suspect)** |
| Garde fiscale fail-closed | **À faire** | D1 |
| Clôture annuelle → 3200 | **À faire** (remontée de P2.2 par le workplan) | D2 + D3 |

## 2. Décisions de design

### D1 — `check_fiscal_period_open` devient fail-closed (in-place)
`20260517000002` documente le choix fail-open : « no covering period → RETURN silencieux » (lignes 73-76). Conséquence : toute JE datée hors des 24 périodes seedées (jan 2026 → déc 2027) passe sans garde — l'audit le classe 🟠.

**Fix** : quand aucune période ne couvre `p_date` → `RAISE 'period_undefined' ERRCODE P0004` (même code que `period_locked` : les 34 call-sites traitent déjà P0004 comme un rejet de garde). `CREATE OR REPLACE` in-place — signature inchangée, bugfix de garde (précédent : dédup PB1 `_057`).

- Le statut `draft` reste autorisé au posting (workflow `draft→open` inutilisé en pratique, seeds tous `open`) — **hors scope**, comportement inchangé.
- Le risque « bombe à retardement jan 2028 » (fail-closed + seed épuisé) est neutralisé par D2 : la clôture annuelle seede l'exercice N+1.

### D2 — `close_fiscal_year_v1(p_fiscal_year INT, p_manager_pin TEXT) RETURNS JSONB`
Nouveau RPC SECURITY DEFINER, pattern cockpit S26 (`close_fiscal_period_v1`) :

- **Gates** : permission dédiée **`accounting.year.close`** (seed MANAGER/ADMIN/SUPER_ADMIN comme `accounting.period.close`, mig. pattern `_026`) + PIN via **`_verify_pin_with_lockout`** (S38).
- **Préconditions** : les **12 périodes mensuelles** de l'exercice existent et sont **toutes `closed`/`locked`** — sélectionnées `FOR UPDATE` (sérialise deux clôtures concurrentes) ; pas de JE `year_close` déjà postée pour l'exercice (`entry_date = 31/12`, status posted/locked) sinon `year_already_closed`.
- **JE de clôture** datée **31/12** de l'exercice, `reference_type='year_close'`, `reference_id NULL`, `status='posted'` : une ligne par compte de classe **4/5/6** à net non nul (débit du net créditeur pour les revenus, crédit du net débiteur pour les charges) + ligne d'équilibre sur **3200 Retained Earnings** (CR si profit, DR si perte). Agrégat avec le **filtre canonique de dédup** `sale_void`+refund (mirror P&L v2/TB v3). Zéro activité P&L → pas de JE (`je_id: null`), le reste s'exécute quand même.
- La garde D1 n'est **pas appelée** (appel explicite dans les corps de RPC, aucun trigger table) : la JE du 31/12 s'insère dans une période fermée **par design** — c'est l'écriture de clôture.
- **Seed N+1** : 12 périodes mensuelles de l'exercice suivant `ON CONFLICT (period_end) DO NOTHING`, status `open`.
- **Audit** : row `accounting.year.closed` (payload : year, net_result, line_count, entry_number, periods_seeded).
- REVOKE PUBLIC+anon / GRANT authenticated (defense-in-depth S20).
- 3300 « Current Year Earnings » (`is_postable=false`) n'est **pas touché** : il est dérivé live ; après clôture les nets 4/5/6 de l'exercice lisent 0 → CYE retombe à 0 et 3200 porte le cumul (l'intention du seed `_019` est respectée sans poster sur un compte non postable).

### D3 — Exclusion de `year_close` des colonnes de résultat
La JE de clôture zérote les classes 4/5/6 au 31/12 → sans exclusion, le P&L de décembre (ou de l'année) lirait **0** après clôture.

- **`get_profit_loss_v2`** : `AND je.reference_type IS DISTINCT FROM 'year_close'` dans le WHERE (in-place, bugfix de rapport).
- **`get_trial_balance_v3`** : exclusion de `year_close` des **colonnes de période uniquement** (`per_debit`/`per_credit`, donc aussi `total_debit`/`total_credit`/invariant Σ) ; `opening_balance` et le **cumul as-of** l'**incluent** (3200 doit porter le report ; les 4/5/6 rouvrent à 0). L'invariant Σ débit = Σ crédit reste vrai (on exclut la JE entière, toutes classes).
- **`get_balance_sheet_v2`** : **aucun changement attendu** — CYE dérivé des nets 4/5/6 cumulés : la JE de clôture les remet à 0 et 3200 prend le relais → BS toujours équilibré. Vérifié par pgTAP post-clôture (si le body dérive CYE autrement, ajustement en déviation numérotée).
- `calculate_pb1_payable_v1` : 2110 (classe 2) jamais touché par la clôture → aucun changement.

### D4 — Leak suspect dans le cumul TB v3 (vérification workplan « déjà v3 — vérifier »)
Lecture de `_061` : `accounts LEFT JOIN journal_entry_lines jel LEFT JOIN journal_entries je ON (… filtres status/date/dédup …)`. Si le join `je` échoue (JE draft, datée > `p_date_end`, ou void dédupliquée), la ligne `jel` **survit avec `je` NULL** et `cum_debit/cum_credit = SUM(jel.*)` **inconditionnel** l'absorbe → pollution du solde cumulé des comptes permanents.

**Protocole** : test pgTAP rouge (JE draft + JE future + void dédupliquée → le cumul doit les exclure). Si confirmé → fix in-place : join interne parenthésé `LEFT JOIN (jel JOIN je ON …filtres…) ON jel.account_id = a.id`. Si non confirmé → le test reste comme ancre, pas de migration.

### D5 — UI différée
Pas de surface BO pour la clôture annuelle dans cette vague (RPC-only, comme l'audit le formule). Bouton cockpit + affichage `period_undefined` → **DEV-S54-01**, backlog module 02-accounting.

## 3. Migrations (NAME-block, après `20260710000076`)

| # | Contenu |
|---|---|
| `20260710000077` | D1 — `check_fiscal_period_open` fail-closed (COR in-place) |
| `20260710000078` | D4 — fix leak cumul `get_trial_balance_v3` (COR in-place, **si bug confirmé**) |
| `20260710000079` | D2 — seed permission `accounting.year.close` |
| `20260710000080` | D2 — `close_fiscal_year_v1` + REVOKE pair |
| `20260710000081` | D3 — exclusions `year_close` : P&L v2 + TB v3 (COR in-place) |

Types regénérés après (nouveau RPC dans `types.generated.ts`).

## 4. Tests

- **Nouvelles suites pgTAP** : `fiscal_guard_fail_closed.test.sql`, `close_fiscal_year_v1.test.sql` (+ cas ajoutés à `trial_balance_v3_cumulative.test.sql` pour D4/D3).
- **Ancres re-run (MCP, BEGIN/ROLLBACK)** : `trial_balance_v3_cumulative`, `pb1_dedup_void_refund`, `accounting`, `reports_pnl_bs_cf`, `financial_rpc_perm_gates`.
- **App** : typecheck + build (aucun call-site UI nouveau ; regen types seul risque).
