# S56 — UI déférées + reliquat B2B/compta : design

- **Date** : 2026-07-03 · **Branche** : `swarm/session-56`
- **Sources** : DEV-S54-01 (INDEX S54 §Décisions 5), DEV-S52-03 (INDEX S52 §8/§10), audit intégral §7 P2.2 (« consolidation audit 1 table ») — `docs/workplan/audits/2026-06-27-audit-integral-par-module.md`
- **Exploration** : 3 agents (cockpit compta / surface B2B / fragmentation audit) + vérifications live cloud `ikcyvlovptebroadgtvd` (contrôleur)

## 0. Périmètre

| Chantier | Ticket | Nature |
|---|---|---|
| **A** | DEV-S54-01 — bouton cockpit « Clôture annuelle » + erreur `period_undefined` | UI BO (accounting) + fix mapping erreurs |
| **B** | DEV-S52-03 — liste-factures B2B : allocation ciblée + Cancel par facture | UI BO (btob) + 1 hook lecture |
| **C** | P2.2 reliquat — consolidation audit `audit_log`/`audit_logs` | DB (migrations) + pgTAP |

Hors périmètre : P2.1 (promo caps), P2.3/P2.4 (UX POS/BO), credit-notes B2B (TASK-09-014), due_date/terms aging.

---

## Chantier A — DEV-S54-01 : UI clôture annuelle + `period_undefined`

### État des lieux (explore-accounting, vérifié)

- Le RPC **`close_fiscal_year_v1(p_fiscal_year INT, p_manager_pin TEXT) RETURNS JSONB`** existe (S54, `20260710000080`), gate DB `accounting.year.close` (MANAGER/ADMIN/SUPER_ADMIN) + `_verify_pin_with_lockout`.
- Retour succès : `{fiscal_year, je_id, entry_number, net_result, line_count, retained_earnings_account:'3200', periods_seeded_next_year}`. **`line_count=0` (zéro activité) est un succès** avec `je_id=null` — les 12 périodes N+1 sont quand même seedées.
- Page hôte : `apps/backoffice/src/features/accounting/pages/SettingsAccountingPage.tsx` (route `settings/accounting`, `PermissionGate required="accounting.period.close"` — `routes/index.tsx:931-938`). Patron modal 2-étapes : `FiscalPeriodModal.tsx` (step 1 sélection, step 2 PIN 6 chiffres `/^\d{6}$/` + bandeau amber). Hook patron : `useCloseFiscalPeriod.ts` (RPC direct — le PIN en arg SQL est le pattern légitime des RPC cockpit, S25 ne s'applique qu'aux EFs).
- **`accounting.year.close` ABSENT du type `PermissionCode`** (`packages/supabase/src/rls/permissions.ts:134-139`) — à ajouter, sinon pas de gating typé.
- Erreurs RAISE de `close_fiscal_year_v1` à mapper (8) : `fiscal_year_invalid` P0001, `pin_required` P0001, `forbidden` P0003, `invalid_pin` P0003, `fiscal_year_periods_missing: X of 12 seeded for YYYY` P0002, `fiscal_year_periods_open: X period(s) of YYYY not closed/locked` P0003, `year_already_closed: YYYY` P0003, `retained_earnings_account_missing: 3200` P0002.
- `period_undefined` : message exact **`period_undefined: no fiscal period covers <date>`** (P0004, `_077`). Surfaces BO : `CreateManualJEModal` (affiche `error.message` brut) et les 3 hooks B2B. **Bug de mapping découvert** : les `classify()` de `useCreateB2bOrder`/`useRecordB2bPayment`/`useCancelB2bOrder` testent `message.includes('fiscal_period')` — sous-chaîne absente du message fail-closed (`no fiscal period` avec espace) → l'erreur retombe en `unknown` aujourd'hui.

### Design

1. **`PermissionCode`** : ajouter `| 'accounting.year.close'` (`permissions.ts`, bloc accounting).
2. **Hook `useCloseFiscalYear.ts`** (`features/accounting/hooks/`) : mutation `supabase.rpc('close_fiscal_year_v1', {p_fiscal_year, p_manager_pin})` ; **pattern mappé** (recommandation explorateur) : type `CloseFiscalYearErrorCode` + `classify(message)` sur les 8 messages ci-dessus ; invalide `FISCAL_PERIODS_KEY` + clés journal-entries/TB.
3. **`AnnualCloseModal.tsx`** (`features/accounting/components/`), calqué sur `FiscalPeriodModal` :
   - Step 1 : `<select>` natif (ui-kit : pas de Select exporté) des années dérivées de `useFiscalPeriods` (années distinctes, défaut = plus ancienne année entièrement `closed`/`locked` sinon année courante −1) + rappel des préconditions (12 périodes closed/locked, carry-forward → 3200, seed N+1).
   - Step 2 : PIN inline 6 chiffres (copie exacte du champ `FiscalPeriodModal.tsx:131-141`) + bandeau amber « irréversible ».
   - Succès : panneau récap — `entry_number`, `net_result` (formatIdr, signe → « Bénéfice reporté » / « Perte reportée »), `periods_seeded_next_year` ; cas `je_id=null` → message info « Aucun mouvement 4/5/6 sur l'exercice — périodes N+1 seedées ».
   - Erreurs : `switch` sur le code classifié → libellés FR (bloc `role="alert"`, pas de toast — convention BO).
4. **Bouton « Clôture annuelle »** dans `SettingsAccountingPage.tsx`, à côté de « Close a period », gaté `hasPermission('accounting.year.close')` (pattern `canClose` existant L20).
5. **`period_undefined`** :
   - `CreateManualJEModal` : mapper le message brut → libellé FR « Aucune période fiscale ne couvre cette date — lancez la clôture annuelle pour seeder l'exercice suivant » (détection `includes('period_undefined')`).
   - Fix des 3 `classify()` B2B : ajouter la branche `message.includes('period_undefined') || message.includes('no fiscal period')` → code `fiscal_period_closed` existant (libellé déjà câblé).

### Critères d'acceptation (A)

- **A-1** : MANAGER/ADMIN voit le bouton ; un rôle sans `accounting.year.close` ne le voit pas (typé, pas de cast).
- **A-2** : clôture d'une année valide → panneau succès avec JE + 12 périodes N+1 ; re-clic → erreur FR « déjà clôturé ».
- **A-3** : chaque code d'erreur du RPC a un libellé FR distinct (8 cas) ; le message Postgres brut n'apparaît plus.
- **A-4** : une JE manuelle datée dans un exercice non seedé affiche le libellé FR `period_undefined` (plus de message brut) ; les 3 hooks B2B classifient `period_undefined` en `fiscal_period_closed` (test unitaire sur `classify`).

---

## Chantier B — DEV-S52-03 : liste-factures B2B (allocation ciblée + Cancel)

### État des lieux (explore-b2b, vérifié)

- Backend + hooks **prêts** : `useRecordB2bPayment` accepte déjà `invoiceIds?: string[]` → `p_invoice_ids` (`record_b2b_payment_v2`, ordre du tableau puis FIFO) et retourne `allocations[]` ; `useCancelB2bOrder` (→ `cancel_b2b_order_v1`, **pas de PIN**, erreurs classifiées dont `order_has_payments` P0011, `order_not_cancellable` — seul `status='b2b_pending'` est annulable, `reason` ≥ 3 car.) est **défini mais consommé nulle part**.
- **Aucun hook ne lit `view_b2b_invoices`** (grep apps/ = 0). Colonnes (S52 `_070`) : `invoice_id, order_number, customer_id, b2b_company_name, customer_name, invoice_total, invoice_date, paid_at, order_status, age_days, is_unpaid, amount_paid, outstanding`.
- `B2BPaymentsPage.tsx` : 3 onglets (Received / Outstanding agrégat par client / Aging). `RecordB2bPaymentModal` a un prop `initialCustomerId` jamais alimenté ; aucune liste de factures dans le modal ; garde anti-surpaiement sur le solde client global.
- Gating in-page : `hasPermission('b2b.payment.record')` désactive « Record Payment » ; **`b2b.order.cancel` n'est vérifié nulle part** dans l'UI.
- `useRecordB2bPayment` n'invalide pas `['b2b-invoices']` (clé déjà invalidée par `useCancelB2bOrder` — à aligner).

### Design

1. **Hook `useB2bInvoices.ts`** (`features/btob/hooks/`) : query `['b2b-invoices', customerId ?? 'all', unpaidOnly]` sur `view_b2b_invoices` (select typé, filtre `.eq('customer_id', …)` optionnel, `unpaidOnly` → `.gt('outstanding', 0)`, tri `invoice_date` asc — cohérent FIFO serveur).
2. **Onglet « Invoices »** (4ᵉ tab de `B2BPaymentsPage`) : table des factures (`order_number`, client, `invoice_date`, `age_days`, `invoice_total`, `amount_paid`, `outstanding` en font-mono, badge statut payé/impayé/partiel), filtre client (`<select>` natif depuis `useB2bCustomers`) + toggle « impayées seulement » (défaut ON), `EmptyState` ui-kit sinon.
   - **Cancel par facture** : bouton par ligne, visible seulement si `order_status='b2b_pending'` **et** `amount_paid=0`, gaté `hasPermission('b2b.order.cancel')` ; ouvre `CancelB2bOrderModal` (raison ≥ 3 car. requise, bandeau danger, idempotencyKey per-modal `useRef(crypto.randomUUID())` roté à la fermeture — pattern S55) ; erreurs mappées FR (`order_has_payments` → « Facture déjà partiellement réglée — annulez/contre-passez le paiement d'abord », `fiscal_period_closed`, etc.).
   - **Record depuis une ligne** : bouton « Record payment » (gate `b2b.payment.record`) pré-remplissant le modal (client + facture pré-cochée).
3. **`RecordB2bPaymentModal` — sélection de factures** : quand un client est choisi, afficher ses factures ouvertes (`useB2bInvoices(customerId, unpaidOnly)`) en liste cochable ; **l'ordre de coche = ordre d'allocation** (état local `string[]`) ; « Tout sélectionner (FIFO) » = décoché → comportement actuel (FIFO serveur, aucune `invoiceIds` envoyée). Le montant se pré-remplit avec Σ `outstanding` des factures cochées (éditable). Si montant > Σ sélection : note informative « l'excédent sera alloué FIFO sur le reste ». Succès : récap `allocations[]` (facture → montant appliqué, badge « soldée » si `fully_settled`).
4. **`initialCustomerId`** : l'onglet Outstanding passe le client de la ligne au modal (bouton « Record » par ligne).
5. **Invalidations** : ajouter `['b2b-invoices']` aux invalidations de `useRecordB2bPayment`.

### Critères d'acceptation (B)

- **B-1** : l'onglet Invoices liste les factures de `view_b2b_invoices` avec outstanding exact ; filtre client + impayées fonctionnels.
- **B-2** : un paiement avec 2 factures cochées envoie `p_invoice_ids` dans l'ordre de coche et affiche les `allocations[]` retournées ; sans coche, aucun `p_invoice_ids` (FIFO).
- **B-3** : Cancel visible uniquement sur facture `b2b_pending` non allouée + permission ; succès → facture disparaît des impayées (invalidations) ; `order_has_payments` → libellé FR dédié.
- **B-4** : bouton « Record » d'une ligne Outstanding ouvre le modal pré-rempli client.
- **B-5** : smokes BO b2b verts ; typecheck vert ; aucune écriture hors RPCs (lecture seule sur la vue).

---

## Chantier C — consolidation audit `audit_log`/`audit_logs` (P2.2 reliquat)

### État des lieux (vérifié live par le contrôleur + explore-audit)

- **Il n'y a qu'UNE table physique** : `audit_logs(id, actor_id, action, entity_type, entity_id, metadata, created_at, payload)` (append-only). `audit_log` est une **vue de compatibilité** 7 colonnes (`id, occurred_at, actor_profile_id, action, subject_table, subject_id, payload`) avec `security_invoker=on` (S50 W1.5) et un trigger **INSTEAD OF INSERT `audit_log_compat_insert` → `audit_log_insert_trigger()`** qui redirige les écritures vers `audit_logs`.
- Mapping colonnes 1:1 : `occurred_at→created_at`, `actor_profile_id→actor_id`, `subject_table→entity_type`, `subject_id→entity_id`, `payload→payload`.
- **Inventaire (explore-audit, vérifié live)** :
  - **Écrivains via la vue : ~40 call-sites** (vocabulaire `subject_table/subject_id/payload/actor_profile_id`) — familles : stock (`record_stock_movement_v1` et famille, transferts, lots, production, recettes, opname, réservations), PO (create/receive/cancel/update), cash movements, close_shift, fiscal (`close_fiscal_period_v1`, `create_manual_je_v1`, **`close_fiscal_year_v1` `_080:175` — S54, le plus récent**), `update_account_active_v1`, soft-delete customer. Seule la version **live** de chaque fonction compte (les fichiers historiques restent intacts — append-only).
  - **Écrivains directs `audit_logs`** : money-path, reversals, B2B, products CRUD, users, imports, Z-report — déjà sur le vocabulaire canonique.
  - **Lecteurs : ZÉRO surface ne lit la vue.** Les 2 RPC lecteurs (`get_audit_logs_v1`/`_v2`) et leurs hooks BO lisent la table. Grep `from('audit_log'|'audit_logs')` dans `apps/` = 0.
  - **Grants legacy** : la vue garde `GRANT SELECT, INSERT TO authenticated` (S13 `…034:77`) — jamais révoqué.
  - **Dualité JSONB** : `audit_logs.metadata` (915 lignes, contexte free-form ; cible du mapping `payload`→`metadata` du trigger) vs `audit_logs.payload` (144 lignes, diff before/after, colonne S19 invisible depuis la vue).
  - Live : 1043 lignes, 56 actions distinctes.

### Design (principe)

1. **Cible canonique : `audit_logs`** (la table). Migration(s) S56 : **`CREATE OR REPLACE` in-place des fonctions live** dont `pg_proc.prosrc` contient `INSERT INTO audit_log ` (singulier) — l'INSERT devient `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)` (mapping du trigger reproduit à l'identique : le `payload` du writer va dans `metadata`). Aucun changement de signature ni de comportement observable (précédent `_077`/`_078`). Source des corps = **dump live `pg_get_functiondef`** par le contrôleur (pas les fichiers historiques), transformation mécanique revue, découpée en 2 migrations par famille (stock/PO/production ; fiscal/cash/misc).
2. **Démantèlement compat** (migration finale) : `DROP TRIGGER audit_log_compat_insert ON audit_log` + `DROP FUNCTION audit_log_insert_trigger()` + **`DROP VIEW audit_log`** — zéro lecteur vérifié. Gate avant drop : re-grep `audit_log` (singulier, word-boundary) dans `apps/`, `packages/`, `supabase/functions/`, `supabase/tests/` ; si un lecteur inattendu apparaît → repli « vue conservée en lecture seule, REVOKE INSERT » consigné en déviation.
3. **Dualité `metadata`/`payload` : conservée et documentée** (COMMENT ON COLUMN) — `metadata` = contexte free-form (cible des writers), `payload` = diff before/after (S19). Pas de fusion, pas de backfill des 144 lignes (D7).
4. **pgTAP `audit_consolidation.test.sql`** : (i) zéro fonction du schéma public avec `INSERT INTO audit_log ` dans `prosrc` (introspection), (ii) trigger + fonction compat + vue absents, (iii) échantillon de RPCs migrés (stock movement, clôture période, adjust balance) produit ses lignes `audit_logs` (action/entity_type/metadata inchangés), (iv) RLS `audit_logs` intact (`admin_read` seul, pas d'INSERT/UPDATE/DELETE authenticated).
5. **Pas de backfill de données** : la vue n'a jamais stocké (copy S13 déjà faite).
6. Hors périmètre (backlog) : permission `audit_log.read` (seedée S12, inutilisée) — la policy `admin_read` par rôle reste telle quelle.

### Critères d'acceptation (C)

- **C-1** : zéro `INSERT INTO audit_log ` (vue) dans `pg_proc.prosrc` live ; suite pgTAP verte et rejouable.
- **C-2** : trigger, fonction compat et vue droppés (ou repli déviation documentée si lecteur découvert au gate).
- **C-3** : échantillon de flux (stock movement, clôture période, B2B adjust) produit des lignes `audit_logs` identiques avant/après (action, entity_type, metadata).
- **C-4** : ancres vertes post-migration : suites pgTAP des familles touchées (stock, fiscal, B2B) re-passées sans régression.

---

## Décisions

| # | Décision | Alternative rejetée |
|---|---|---|
| D1 | Chantier A : modal dédié `AnnualCloseModal` calqué sur `FiscalPeriodModal`, mapping d'erreurs FR (pattern B2B) | Réutiliser `FiscalPeriodModal` avec un mode « year » (couplage inutile) |
| D2 | Sélecteur d'année dérivé de `useFiscalPeriods` (années distinctes) | Input number libre (laisse passer des années sans périodes → erreurs évitables) |
| D3 | Chantier B : onglet « Invoices » dédié dans `B2BPaymentsPage` | Lignes expandables dans Outstanding (cache la surface, pas de place pour filtres/Cancel) |
| D4 | Ordre de coche = ordre d'allocation (`p_invoice_ids` respecte l'ordre du tableau, S52 D1) | Tri fixe par ancienneté (perd l'intention utilisateur) |
| D5 | Chantier C : writers repointés in-place (dump live `pg_get_functiondef`, pas les fichiers historiques) puis DROP trigger + fonction + **vue** (zéro lecteur vérifié ; gate re-grep avant drop, repli lecture seule si découverte) | Garder la vue en lecture « au cas où » (dette morte : aucun lecteur, grants legacy à traîner) |
| D6 | Pas de PIN sur Cancel B2B ni Record payment (les RPCs n'en exigent pas ; gates `b2b.order.cancel`/`b2b.payment.record` suffisent — SOD S52) | Ajouter un PIN UI sans vérification serveur (théâtre de sécurité) |
| D7 | `metadata`/`payload` : deux colonnes conservées, sémantique documentée par COMMENT (metadata=contexte, payload=diff S19) | Fusion des colonnes + backfill 144 lignes (risque de casse lecteurs RPC pour zéro gain fonctionnel) |

## Plan de test global

- **Typecheck + build** : `pnpm typecheck`, `pnpm build`.
- **BO smokes** : `pnpm --filter @breakery/backoffice test accounting` et `test b2b` (+ nouveaux : rendu modal clôture, gating bouton, classify unitaire ; onglet Invoices, sélection→invoiceIds, Cancel gating).
- **pgTAP** (MCP `execute_sql` BEGIN/ROLLBACK) : nouvelle suite `audit_consolidation` ; re-run ancres : `b2b_settlement` 14/14, `close_fiscal_year_v1` 19/19, `fiscal_guard_fail_closed` 4/4.
- **Migrations** : NAME-block suivant = `20260710000087` (max actuel `_086`) ; regen types après chaque migration ; aucun bump de signature RPC prévu (in-place `CREATE OR REPLACE` uniquement, comportement identique).
