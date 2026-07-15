# Session 56 — INDEX : UI déférées (DEV-S54-01, DEV-S52-03) + consolidation audit (P2.2)

- **Date** : 2026-07-03 · **Branche** : `swarm/session-56`
- **Spec** : [`docs/superpowers/specs/2026-07-03-s56-deferred-ui-audit-consolidation-design.md`](../../superpowers/specs/2026-07-03-s56-deferred-ui-audit-consolidation-design.md)
- **Plan** : [`docs/superpowers/plans/2026-07-03-session-56-deferred-ui-audit-consolidation.md`](../../superpowers/plans/2026-07-03-session-56-deferred-ui-audit-consolidation.md)
- **Ouverture de session** : closeout rétroactif S55 (INDEX + bump CLAUDE.md, sautés dans la PR #138 — DEV-S55-03) + chore turbo 2.10.2 + nettoyage fichier parasite racine.

## Objectif

Solder les deux UI déférées (cockpit « Annual close » S54 ; liste-factures B2B S52) et le reliquat P2.2 : **consolidation de l'audit-trail sur la seule table `audit_logs`** (démantèlement de la couche compat S13 `audit_log` vue+trigger).

## Livré

### Chantier A — DEV-S54-01 (accounting)
1. `PermissionCode` += **`accounting.year.close`** (le seed DB existait depuis `_079`).
2. **`useCloseFiscalYear`** : mutation `close_fiscal_year_v1` + `classifyCloseFiscalYearError` (8 codes mappés sur les messages RAISE exacts) — test unitaire 9 cas.
3. **`AnnualCloseModal`** (patron `FiscalPeriodModal`) : step 1 sélecteur d'année dérivé de `useFiscalPeriods` (n/12 closed/locked), step 2 PIN 6 chiffres + bandeau irréversible, vue succès (récap `entry_number`/`net_result`→3200/`periods_seeded_next_year` ; cas `je_id=null` = succès dédié) ; garde `isPending` sur la fermeture. Bouton « Annual close » gaté `accounting.year.close` dans `SettingsAccountingPage`.
4. **`period_undefined`** : libellé dédié dans `CreateManualJEModal` + fix des `classify()` des 3 hooks B2B (**bug réel** : `includes('fiscal_period')` ne matche pas `no fiscal period` avec espace → l'erreur tombait en `unknown`) — test unitaire 3 hooks.

### Chantier B — DEV-S52-03 (B2B)
5. **`useB2bInvoices(customerId?, unpaidOnly?, enabled?)`** — premier lecteur de `view_b2b_invoices` (13 colonnes, tri FIFO), clé `['b2b-invoices', …]`.
6. **`RecordB2bPaymentModal`** : liste des factures ouvertes du client cochables — **ordre de coche = ordre d'allocation** (`p_invoice_ids`, D4/S52-D1) ; montant pré-rempli Σ outstanding de la sélection (vidé si sélection vide ; pré-rempli aussi via `initialInvoiceIds`) ; note « excédent → FIFO » ; **vue succès** avec récap `allocations[]` + badge `settled` ; aucune coche → pas de clé (FIFO serveur). Invalidation `['b2b-invoices']` ajoutée à `useRecordB2bPayment`.
7. **Onglet « Invoices »** (4ᵉ tab de `B2BPaymentsPage`, composant `B2bInvoicesTab`) : filtres client + « Unpaid only » (défaut ON) + search page, badges paid/partial/unpaid, **Cancel par facture** (visible ssi `b2b_pending` + `amount_paid=0` + gate `b2b.order.cancel`) via **`CancelB2bOrderModal`** (raison ≥ 3 car., clé d'idempotence per-modal rotée — pattern S55, copy EN mappée dont `order_has_payments`), **Record payment pré-rempli** (client + facture pré-cochée). Lignes Outstanding : bouton « Record payment » pré-rempli client. `useCancelB2bOrder` (S52) enfin consommé.

### Chantier C — P2.2 consolidation audit
8. **`_087` `repoint_audit_writers_to_audit_logs`** : les **26 dernières fonctions** écrivant via la vue compat sont réécrites in-place vers `audit_logs` (mapping du trigger reproduit : `subject_table→entity_type`, `subject_id→entity_id`, `payload→metadata`, `actor_profile_id→actor_id`). 25 par **DO-block auto-vérifiant** (2 regex de listes de colonnes vérifiées live, fail-fast si forme inattendue, assertion compte=25, post-condition zéro référence) ; **`duplicate_recipe_v1` en corps explicite** (il LISAIT aussi la vue pour son replay — `metadata AS payload`, `ORDER BY created_at`).
9. **`_088` `drop_audit_log_compat_view`** : DROP trigger `audit_log_compat_insert` + fonction `audit_log_insert_trigger()` + **vue `audit_log`** ; COMMENTs D7 sur la dualité `metadata` (contexte, cible des writers) / `payload` (diff S19 — ne pas fusionner). **`audit_logs` est désormais l'unique surface de l'audit-trail.**
10. **Sweep tests** : 7 suites (pgTAP + Vitest live) migrées du vocabulaire vue → table ; assertions T20 (`security`) et T4 (`security_leak_guard`) retournées (la vue doit être ABSENTE).
11. **Suite pgTAP `audit_consolidation`** (récurrente, 6 tests) : zéro écriture/lecture de la vue dans `pg_proc.prosrc`, vue+trigger absents, flux échantillon `record_stock_movement_v1` → ligne `audit_logs`, RLS `admin_read` seule policy. Préconditions T5 gardées (messages explicites).

## Migrations

| # | Fichier | Notes |
|---|---|---|
| `20260710000087` | `repoint_audit_writers_to_audit_logs` | in-place ×26, zéro bump |
| `20260710000088` | `drop_audit_log_compat_view` | + COMMENTs metadata/payload |

Types regénérés (le type de la vue disparaît, −38 l. ; `audit_logs` + `get_audit_logs_v1/_v2` intacts).

## Tests (tous verts)

- **pgTAP live (MCP, capture temp-table)** : `audit_consolidation` 6/6 ; ancres re-passées : `close_fiscal_year_v1` **19/19** (T14 audit sur `audit_logs`), `update_account_active_v1` 4/4, `security` 20/20, `security_leak_guard` 13/13, `s26_db_hardening` 15/15 (après refresh, cf. DEV-S56-02) ; blocs sweepés d'`inventory` (T3/T18) vérifiés par équivalents ciblés — suite complète couverte par la nightly CI pooler.
- **Smokes live post-`_087`** : `record_stock_movement_v1` → +1 `audit_logs` ; replay `duplicate_recipe_v1` → `idempotent_replay=true`.
- **App** : typecheck 6/6, build 2/2 ; BO `accounting` 34/34, `b2b` 12/12 ; nouveaux smokes : `annual-close-modal` 3, `close-fiscal-year-classify` 9, `period-undefined-classify` 3, `record-payment-invoice-selection` 2, `b2b-invoices-tab` 5.
- **Revue** : 1 reviewer par tâche (6 tâches subagents) + revue finale de branche → « ready to merge with fixes » ; fixes appliqués (`c2520a6`) : contrat `allocations` honnête (fixture stale `b2b-foundation` corrigée, garde `?? []` retirée), prefill/clear du montant, garde pending sur fermeture modal, docs d'hypothèses (`_087` + T5).

## Déviations

| ID | Quoi | Pourquoi | Risque |
|---|---|---|---|
| DEV-S56-01 | Le gate pré-drop a trouvé **7 suites de tests lisant la vue** (l'exploration avait conclu « zéro lecteur » sur apps/ seulement) → tests migrés vers `audit_logs` au lieu du repli « vue read-only » | Les lecteurs étaient tous des fichiers du projet, pas des surfaces runtime — consolidation complète préférable | Aucun (suites re-passées vertes) |
| DEV-S56-02 | Refresh de 3 ancres stales **pré-existantes** dans `s26_db_hardening` : `is(smallint,int)` ne résout pas, `get_general_ledger_v1`/`get_trial_balance_v1` droppées en S50 (→ v2/v3 + identité pour la gate), COMMENT réécrit en S46 (ancre F-S26-AC-09 disparue) | Révélées par le re-run S56 — la suite n'avait pas été re-passée depuis S50 | Aucun (15/15) |
| DEV-S56-03 | Sélecteur d'année : placeholder « select a year » forçant un choix explicite (la spec suggérait un défaut = plus ancienne année clôturée) ; copy EN (la spec §critères disait « FR » en se contredisant — tranché EN, convention BO) | Choix explicite plus sûr pour un acte irréversible | Informational |
| DEV-S56-04 | Prefill du montant sur `initialInvoiceIds` ajouté **post-revue finale** (omission du plan : l'auto-fill ne vivait que dans le toggle) + montant vidé quand la sélection se vide | Trouvés par la revue finale de branche | Corrigé pré-merge (`c2520a6`) |
| DEV-S56-05 | Commit Task 1 refait par le contrôleur (le subagent avait fait `git add -A` et embarqué 146 fichiers untracked) — dispatches suivants durcis | Discipline git subagent | Corrigé immédiatement |

## Follow-ups (backlog)

- `ERROR_COPY` typé `Record<CloseFiscalYearErrorCode, string>` ; smokes vues succès `AnnualCloseModal` + branche `onError` de `CreateManualJEModal` ; hint de troncature `useB2bInvoices` (`limit(500)`) ; badge compteur sur l'onglet Invoices ; header-comment `useCloseFiscalYear.ts`.
- Skills `accounting`/`b2b-credit` à rafraîchir (encore S26/S24 par endroits : clôture annuelle « non implémentée », allocation « metadata-only D3 » — dépassés par S54/S52/S56).

## Suite

- **P2 restant** : P2.1 (plafonds promo + validation combo), P2.3/P2.4 (UX POS/BO), P2.5 (outillage), P2.6 (marge brute réelle) — triage en ouverture de S57.
