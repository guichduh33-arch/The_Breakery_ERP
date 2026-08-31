# Audit b2b-credit — 2026-08-31

## Synthèse

Périmètre réellement couvert : les 15 objets B2B live du projet V3 dev `ikcyvlovptebroadgtvd`
(corps `pg_get_functiondef`, `pg_policies`, `pg_proc.proacl`,
`information_schema.column_privileges`), les deux ledgers append-only, les deux vues, les
deux surfaces d'aging, les 16 hooks + 7 composants de `apps/backoffice/src/features/btob/`,
la page Settings B2B et le panneau dettes du POS. Les trois volets de la checklist de la
skill (A. Intégrité AR / B. Sécurité / C. Traçabilité) ont été passés.

Verdict : **l'intégrité AR des données dev est parfaite** (0 dérive, 0 solde négatif, 0
sur-allocation, 0 facture `voided` dans la vue, 0 JE `sale` sur une commande B2B, 100 % des
`actor_id` résolus en `user_profiles.id`) et **la sécurité est propre** (4 écrivains de
`b2b_current_balance` exactement, aucune RPC B2B ouverte à `anon` ou `PUBLIC`, ledgers en
SELECT seul, PIN vérifié avec verrouillage). **Mais le code, lui, ne tient pas.**

**LE P0 : `record_b2b_payment_v2` perd silencieusement le reliquat d'un paiement.** Le solde
est décrémenté du montant PLEIN avant l'allocation, la JE est postée au montant PLEIN, puis
les deux boucles d'allocation s'arrêtent quand elles n'ont plus de facture à servir — et
`v_remaining` est jeté sans exception, sans trace, sans ligne de ledger. Prouvé en live sous
`BEGIN; … ROLLBACK;` : **300 000 IDR encaissés, 100 000 alloués, 200 000 évaporés**, retour
`idempotent_replay: false` et solde à 0 comme si tout s'était bien passé. Pire, le seul
contrôle qui existe (`reconcile_b2b_balance_v1`) est aveugle à ce cas précis, puisque le
cache et le dérivé bougent du même côté. La modale, elle, **promet à l'écran** que l'excédent
sera réalloué en FIFO.

Compte : **P0 · 1** — **P1 · 4** — **P2 · 6** — **P3 · 4**.

---

## Findings

| # | Sév. | Zone | Constat (fichier:ligne + ancre stable) | Preuve (SQL/grep exécuté) | Correctif proposé |
|---|---|---|---|---|---|
| 1 | **P0** | Money-path AR | **Reliquat de paiement perdu sans trace.** `supabase/migrations/20260710000067_record_b2b_payment_v2.sql:142` (ancre : `record_b2b_payment_v2`) décrémente `b2b_current_balance` de `p_amount` PLEIN et poste la JE `Dr Cash / Cr B2B_AR` du montant plein, AVANT toute allocation. `:146` pose `v_remaining := p_amount` ; la boucle ciblée `:150` et la boucle FIFO `:194` sortent toutes deux sur `EXIT WHEN v_remaining <= 0` ; `:213` écrit `allocation = v_alloc_json` et **la fonction retourne sans jamais tester `v_remaining > 0`**. Aucun CHECK, aucun trigger, aucun test n'impose `Σ b2b_payment_allocations.amount_applied = b2b_payments.amount`. Deux chemins d'atteinte, tous deux normaux : (a) solde gonflé par `adjust_b2b_balance_v2` (fonctionnalité prévue — la contrepartie 1132⇄6520 ne crée aucune facture) ; (b) une facture B2B dans un statut autre que `b2b_pending` : elle compte dans `view_b2b_invoices.outstanding` (donc autorise le montant via la garde d'overpayment) mais la boucle FIFO `:190` ne scanne QUE `o.status = 'b2b_pending'` et ne peut pas l'atteindre. Aggravant : `apps/backoffice/src/features/btob/components/RecordB2bPaymentModal.tsx:266-267` **affiche à l'opérateur** « the excess will be allocated FIFO across the remaining ones » — une promesse que le serveur ne tient pas ; et le seul garde-fou de la modale (`:103-105`, `overpaying`) compare au **cache** `b2b_current_balance`, jamais à Σ outstanding. | `pg_get_functiondef('record_b2b_payment_v2')` sur le corps live. Puis simulation live sous `BEGIN; … ROLLBACK;` (JWT d'un profil ADMIN, 1 facture ouverte de 100 000, solde porté à 300 000 comme après un `adjust` de +200 000, encaissement de 300 000) → `paid=300000 · allocated=100000.00 · lost=200000.00 · balance_after=0.00 · je_amount=300000.00 · alloc_rows=1`, **aucune exception levée**. Vérification post-ROLLBACK : `orders_residus=0, paiements_residus=0, je_residus=0, soldes_non_nuls=0`. `grep -rn "remaining\|unallocated\|reliquat\|excess" supabase/tests/b2b_*.sql` → **0 résultat** : aucun pgTAP ne couvre le cas. | Bumper `record_b2b_payment_v3` : après la boucle FIFO, `IF v_remaining > 0 THEN RAISE EXCEPTION 'payment_not_fully_allocated (remaining: %)', v_remaining USING ERRCODE='P0011'; END IF;` — refuser plutôt que perdre. Si Mamat veut au contraire autoriser l'acompte non affecté (avance client), c'est un **changement d'architecture AR** (escalade de la skill) : il faut alors une ligne d'allocation vers un compte d'attente et une contrepartie GL, pas un silence. Dans les deux cas : ajouter `unallocated` au payload de retour, corriger le libellé `RecordB2bPaymentModal.tsx:266-267`, borner le champ montant sur Σ outstanding et non sur le cache, et écrire le pgTAP manquant dans `supabase/tests/b2b_settlement.test.sql`. |
| 2 | **P1** | Sécurité / fuite AR + PII | **`get_pos_b2b_debts_v3` n'a AUCUNE gate de permission.** `supabase/migrations/20260710000071_get_pos_b2b_debts_v3.sql:19` (ancre : `get_pos_b2b_debts_v3`) se contente de `IF auth.uid() IS NULL THEN RAISE 'Not authenticated'`. La fonction est SECURITY DEFINER, `GRANT EXECUTE … TO authenticated` (`:42`), et avec `p_customer_id = NULL` elle rend **tout le carnet de créances** : nom du client, **téléphone**, plafond de crédit, solde courant et chaque commande impayée. Toutes les autres lectures B2B sont gardées (`reconcile_b2b_balance_v1` et `get_b2b_dashboard_counters_v1` et `get_b2b_invoice_v1` → `b2b.read` ; `get_ar_aging_v1` → `reports.financial.read`). Celle-ci est la seule porte ouverte, et c'est celle du POS, donc de tous les comptes caissiers. | `SELECT proacl` sur les 15 fonctions B2B → `authenticated=X/postgres` ; scan `prosrc ~ 'has_permission'` → **`get_pos_b2b_debts_v3` = false**, seule de la liste des lectures. Corps live confirmé. | Bumper `get_pos_b2b_debts_v4` avec `has_permission(auth.uid(), 'b2b.read')`, ou une permission POS dédiée si le caissier doit garder l'accès en consultation ; paire REVOKE refaite sur la nouvelle signature. À défaut, imposer `p_customer_id NOT NULL` pour supprimer l'énumération globale. |
| 3 | **P1** | Stock / annulation | **`cancel_b2b_order_v1` ne restitue pas le stock vitrine.** `supabase/migrations/20260710000068_cancel_b2b_order_v1.sql:85-86` (ancre : `cancel_b2b_order_v1`) réinjecte uniquement `products.current_stock` et un `stock_movements` `sale_void`. Or la création passe par `_record_sale_stock_v1`, qui pour un `is_display_item` décrémente **à la fois** `products.current_stock` **et** `display_stock.quantity`, et écrit une ligne `display_movements`. L'annulation ne fait ni l'un ni l'autre côté vitrine : le stock vitrine part définitivement, et `display_movements` perd une entrée. Asymétrie exacte entre la porte d'entrée et la porte de sortie. | Corps live de `_record_sale_stock_v1` (branche `IF v_is_display THEN … UPDATE display_stock SET quantity = quantity - p_quantity`) confronté au corps live de `cancel_b2b_order_v1` (aucune occurrence de `display`). `grep -n "display" supabase/migrations/20260710000068_cancel_b2b_order_v1.sql` → 0 résultat. | Bumper `cancel_b2b_order_v2` en appelant un helper de restitution symétrique de `_record_sale_stock_v1` (à créer, ou branche `p_reverse` du helper existant) plutôt que de recopier la logique — c'est la recopie qui a produit la divergence. pgTAP à ajouter dans `supabase/tests/b2b_display_aware_stock.test.sql`. |
| 4 | **P1** | Saisie perdue | **Date de retrait et notes saisies à la création d'un ordre B2B ne sont jamais enregistrées.** `apps/backoffice/src/features/btob/components/CreateB2bOrderModal.tsx:354` propose un champ « Pickup date » et `:381` un champ notes (« Optional — PO reference, pickup instructions… ») ; `hooks/useCreateB2bOrder.ts:128` les envoie en `p_delivery_date` / `p_notes`. Mais `supabase/migrations/20260816000004_bump_create_b2b_order_v6_source_numbering.sql:186-187` (ancre : `create_b2b_order_v6`, `INSERT INTO orders`) n'écrit **ni `orders.pickup_date` ni `orders.notes`** — les deux colonnes existent pourtant. `p_delivery_date` finit uniquement dans `audit_logs.metadata` (`:273`) ; `p_notes` **n'est écrit nulle part**. Conséquence visible : la colonne « Pickup » de `apps/backoffice/src/pages/btob/B2BOrdersPage.tsx:269-280` est structurellement vide. | `SELECT column_name FROM information_schema.columns WHERE table_name='orders' AND column_name IN ('notes','pickup_date')` → les deux existent. `SELECT COUNT(*) FILTER (WHERE pickup_date IS NULL) … WHERE order_type='b2b'` → **22/22 NULL**. `SELECT string_agg(proname) FROM pg_proc WHERE prosrc ~ 'pickup_date'` → **NULL, aucune fonction live n'écrit cette colonne**. | Bumper `create_b2b_order_v7` en ajoutant `pickup_date` et `notes` à l'`INSERT INTO orders`. Renommer l'argument `p_delivery_date` → `p_pickup_date` au passage (la migration `20260808000001_orders_pickup_date.sql` explique justement que « delivery » est un faux nom : la marchandise est retirée au magasin). Régénérer les types. |
| 5 | **P1** | Réglages fantômes | **La page B2B Settings est entièrement décorative.** `apps/backoffice/src/pages/btob/B2BSettingsPage.tsx` (routée : `apps/backoffice/src/routes/index.tsx:140` et `:608`) édite et persiste `default_payment_terms`, `available_payment_terms`, `critical_overdue_days` et `aging_buckets`, avec une validation serveur complète (`update_b2b_settings_v1`, contiguïté des buckets, etc.). **Aucun de ces quatre réglages n'a le moindre consommateur.** L'aging du module B2B est figé en dur 30/60/90 dans la vue `view_ar_aging` ; celui du module Reports est figé en dur `current / 1-30 / 31-60 / 61-90 / 90+` dans `get_ar_aging_v1`. La migration d'origine l'assume (`20260623000010_create_b2b_settings_table.sql:19` : « aging_buckets ne pilote pas (encore) view_ar_aging ») mais **rien ne le dit à l'utilisateur**, qui déplace des seuils et voit ses chiffres inchangés. | `grep -rn "aging_buckets\|critical_overdue_days\|default_payment_terms" apps/ packages/ --include=*.ts --include=*.tsx` hors `__tests__` → **seules occurrences : la page Settings elle-même et son hook**. `pg_get_viewdef('view_ar_aging')` → `CASE WHEN age_days <= 30 … <= 60 … <= 90 …` en dur. Corps live de `get_ar_aging_v1` → buckets littéraux `('current',1),('late_1_30',2),…`. | Arbitrage Mamat : soit brancher les réglages (l'aging devient paramétrique, et c'est le même chantier que le finding 6), soit retirer la page. Position intermédiaire acceptable et immédiate : afficher un bandeau « not wired yet » sur la carte Aging buckets pour cesser de mentir, et ouvrir le chantier. |
| 6 | P2 | Cohérence des rapports | **Deux définitions concurrentes de « AR aging » dans la même application.** `view_ar_aging` (consommée par `get_b2b_dashboard_counters_v1`, donc le dashboard B2B et l'onglet Aging de `B2BPaymentsPage.tsx:341`) bucke sur l'**âge depuis l'émission** et couvre toute facture non-`voided` avec outstanding > 0. `get_ar_aging_v1` (ancre : `get_ar_aging_v1`, consommée par `apps/backoffice/src/pages/reports/ArAgingPage.tsx`) bucke sur le **retard vs échéance** (`issued_on + COALESCE(b2b_payment_terms_days, 30)`) et ne couvre QUE `status = 'b2b_pending'`. Les buckets ET le total peuvent différer. L'en-tête de `ArAgingPage.tsx:11` documente l'intention (« LE RETARD, PAS L'ÂGE ») mais aucun des deux écrans ne prévient qu'il existe un autre chiffre ailleurs sous le même nom. | `pg_get_viewdef('view_ar_aging')` vs corps live de `get_ar_aging_v1`. Le premier lit `view_b2b_invoices` (`status <> 'voided'`), le second `WHERE o.status = 'b2b_pending'`. | Arbitrage produit. Trancher UNE définition de l'aging (l'échéance est la bonne réponse comptable) et faire converger la seconde surface ; à défaut, étiqueter explicitement chaque écran (« by invoice age » / « by days past due »). Lié au finding 5. |
| 7 | P2 | Contrôle de dérive | **La bannière de dérive n'est jamais rafraîchie après les opérations qui créent la dérive.** `apps/backoffice/src/features/btob/hooks/useAdjustB2bBalance.ts:47` est le **seul** endroit qui invalide `B2B_DRIFT_QK`. `useRecordB2bPayment.ts:104-108`, `useCancelB2bOrder.ts:78-80` et `useCreateB2bOrder.ts:147-148` ne l'invalident pas — or c'est précisément `record_b2b_payment` (finding 1) qui peut la produire. Le dashboard affiche donc un verdict périmé juste après le geste à surveiller. | `grep -n "invalidateQueries" useRecordB2bPayment.ts useCancelB2bOrder.ts useCreateB2bOrder.ts useAdjustB2bBalance.ts` → `B2B_DRIFT_QK` absent des trois premiers. | Ajouter `qc.invalidateQueries({ queryKey: B2B_DRIFT_QK })` aux trois hooks. |
| 8 | P2 | Migrations | **Collision de numérotation NAME-block, dont une sur le périmètre B2B.** `supabase/migrations/20260818000006_bump_create_sale_journal_entry_b2b_guard.sql` et `supabase/migrations/20260818000006_get_ar_aging_v1.sql` partagent le même préfixe — l'ordre d'application sur un dépôt neuf n'est plus déterminé par le numéro. Le premier des deux est justement le garde-fou anti-double-JE de revenu B2B. Quatre autres collisions : `20260710000135`, `20260710000136`, `20260818000007`, `20260818000008`. | `ls supabase/migrations/ \| sed 's/_.*//' \| sort \| uniq -d` → 5 doublons. CLAUDE.md §Migrations : « numérotation NAME-block monotone ». | Renuméroter les cadets (les migrations sont déjà appliquées en cloud ; le renommage de fichier est sans effet sur `schema_migrations` — à confirmer avec Mamat avant tout geste, cf. bookkeeping cloud abîmé). |
| 9 | P2 | RLS | **Policy asymétrique entre les deux ledgers.** `b2b_payments` porte la policy `auth_read` avec `roles = {public}` ; `b2b_payment_allocations` porte `b2b_alloc_auth_read` correctement scopée `roles = {authenticated}`. Aujourd'hui sans effet (aucun GRANT SELECT à `anon` sur la table), mais c'est exactement la défense-en-profondeur que CLAUDE.md exige : le jour où un GRANT de trop est posé, l'un des deux ledgers s'ouvre et l'autre non. | `SELECT tablename, policyname, cmd, roles FROM pg_policies WHERE tablename IN ('b2b_payments','b2b_payment_allocations')` → `auth_read \| SELECT \| public` vs `b2b_alloc_auth_read \| SELECT \| authenticated`. `information_schema.table_privileges` → aucun grant `anon`, INSERT/UPDATE/DELETE absents pour les deux. | Recréer `auth_read` avec `TO authenticated`. |
| 10 | P2 | Compteurs | **`get_b2b_dashboard_counters_v1` compte `pending_orders` sur le critère abandonné.** Corps live : `'pending_orders', (SELECT COUNT(*) FROM inv i WHERE i.paid_at IS NULL)`. Le critère canonique depuis la refonte des allocations est `is_unpaid` (= `outstanding > 0`), que la même vue expose déjà et que `outstanding_ar` utilise deux lignes plus haut. Les deux coïncident tant que `paid_at` est posé exactement au règlement complet — c'est une redondance qui divergera au premier bug de `paid_at`, pas un invariant. | Corps live de `get_b2b_dashboard_counters_v1`. Contrôle croisé : `SELECT … FROM view_b2b_invoices WHERE order_status='paid' AND outstanding > 0` → 0 ligne aujourd'hui. | Remplacer par `WHERE i.is_unpaid` et ajouter `is_unpaid` à la CTE `inv`. |
| 11 | P2 | Helper unique | **`cancel_b2b_order_v1` recopie la logique de mouvement de stock** (`20260710000068_cancel_b2b_order_v1.sql:79-91` : résolution `track_inventory` / `deduct_stock`, `_resolve_recipe_consumption_v1`, INSERT `stock_movements` + UPDATE `products`) au lieu de passer par un helper. C'est la cause racine du finding 3 : `_record_sale_stock_v1` a évolué (vitrine), la copie non. | Comparaison des deux corps live. CLAUDE.md §Critical patterns : « Déduction stock de vente via l'unique helper `_record_sale_stock_v1` ». | Voir finding 3 : un helper de restitution, appelé par les deux côtés. |
| 12 | P2 | POS | **La fenêtre de `get_pos_b2b_debts_v3` masque les vieilles dettes.** `v_lookback int := LEAST(GREATEST(COALESCE(p_lookback_days,180),1),730)` : par défaut 180 jours, plafond dur 730. Une créance impayée de plus de 2 ans **disparaît** de l'écran Debts du POS, sans indication qu'un filtre est appliqué — alors qu'elle reste dans le solde du client. | Corps live de `get_pos_b2b_debts_v3`, ligne `v_lookback`. | Soit retirer le plafond, soit afficher dans `CustomerDebtsPanel` que la liste est fenêtrée et donner le total hors fenêtre. |
| 13 | P3 | Numérotation | `create_b2b_order_v6` incrémente `order_sequences` (`ON CONFLICT … last_number + 1`) **avant** d'évaluer la gate de crédit `validate_b2b_credit_limit_v1`. Un refus `credit_limit_exceeded` annule la transaction, donc la séquence aussi — mais l'ordre des deux gestes reste fragile si un COMMIT partiel apparaissait un jour. | Corps live de `create_b2b_order_v6` : `INSERT INTO order_sequences …` puis `v_credit_check := validate_b2b_credit_limit_v1(…)`. | Déplacer la gate de crédit avant la réservation du numéro. Cosmétique tant que l'atomicité tient. |
| 14 | P3 | Performance | L'idempotence de `adjust_b2b_balance_v2` et `cancel_b2b_order_v1` se résout par `metadata->>'idempotency_key' = …` sur `audit_logs`, sans index d'expression. Table appelée à grossir indéfiniment ; le scan devient le coût dominant du replay. | Corps live des deux fonctions ; aucun index correspondant. | Index d'expression partiel sur `audit_logs ((metadata->>'idempotency_key')) WHERE action LIKE 'b2b.%'`. |
| 15 | P3 | Produit | `customers.b2b_payment_terms_days` est renseignable et **n'est pas utilisé par le module B2B** (ni `view_ar_aging`, ni `get_b2b_dashboard_counters_v1`, ni la modale de paiement) ; seul `get_ar_aging_v1`, côté Reports, s'en sert. **Signalement, pas décision** — la skill classe explicitement ce point en escalade produit. | `pg_get_viewdef('view_ar_aging')` (aucune référence aux termes) vs corps live de `get_ar_aging_v1` (`COALESCE(c.b2b_payment_terms_days, 30)`). | Arbitrage Mamat, lié aux findings 5 et 6. |
| 16 | P3 | Hygiène privilèges | `authenticated` détient `TRIGGER` et `REFERENCES` sur `b2b_payments` et `b2b_payment_allocations`, deux ledgers append-only. Non exploitable en l'état — `authenticated` n'a que `USAGE` sur le schéma `public`, donc ne peut pas créer la fonction qu'un trigger exigerait — mais c'est du privilège qui ne sert à rien sur une table en écriture interdite. | `information_schema.table_privileges` → `TRIGGER`, `REFERENCES`, `SELECT` pour `authenticated`. `SELECT nspacl FROM pg_namespace WHERE nspname='public'` → `authenticated=U/pg_database_owner` (pas de `C`). | `REVOKE TRIGGER, REFERENCES ON b2b_payments, b2b_payment_allocations FROM authenticated`. |

---

## Dérives de la skill

1. **La skill ignore `get_ar_aging_v1`.** Sa section « Views » ne connaît que `view_ar_aging`
   (« clé = `invoice_date` (pas de `due_date`) »), et sa ligne d'escalade dit « L'aging
   doit-il basculer sur `b2b_payment_terms_days` (échéance) au lieu de l'âge de la facture ?
   La colonne existe et n'est pas utilisée ». **C'est faux depuis le 2026-08-18** :
   `get_ar_aging_v1` (`supabase/migrations/20260818000006_get_ar_aging_v1.sql`) bucke bel et
   bien sur `issued_on + COALESCE(c.b2b_payment_terms_days, 30)`, calcule un `due_date`, un
   `days_late` et un DSO 90 j, et alimente `apps/backoffice/src/pages/reports/ArAgingPage.tsx`.
   La bascule a été faite — sur une seule des deux surfaces. La question ouverte n'est plus
   « faut-il basculer ? » mais « pourquoi deux définitions coexistent ? » (finding 6).

2. **La skill ne mentionne nulle part la page B2B Settings ni ses réglages morts.** Son
   tableau « BO surface » liste bien `hooks/useB2bSettings.ts` et `B2BSettingsPage`, mais rien
   n'indique qu'**aucun** des quatre réglages persistés n'est consommé (finding 5). Un agent
   qui suit la skill supposera que `aging_buckets` pilote l'aging.

3. **La skill présente `p_delivery_date` comme un paramètre légitime de `create_b2b_order`**
   (mental model : « create_b2b_order … ↓ INSERT orders (b2b_pending) ») et sa checklist
   « Avant de bumper `create_b2b_order` » énumère `order_number`, `invoice_number`, le prix
   serveur, `_record_sale_stock_v1` et le solde — **mais jamais `pickup_date` ni `notes`**,
   qui sont perdus (finding 4). Sa section « `orders` table — champs B2B » omet les deux
   colonnes alors que `pickup_date` est exposée par `view_b2b_invoices` et affichée par le BO.

4. **La skill affirme la parité des ledgers RLS** : « RLS : SELECT `authenticated` seulement »
   pour les deux tables. En réalité la policy de `b2b_payments` est ouverte à `public`
   (finding 9) ; seule celle de `b2b_payment_allocations` est scopée `authenticated`.

5. **La skill présente `cancel_b2b_order` comme « stock rendu (`sale_void`) »** sans réserve,
   et sa checklist « Avant de toucher au règlement » ne demande nulle part la symétrie avec
   `_record_sale_stock_v1`. Le stock vitrine n'est pas rendu (finding 3).

6. **La skill place `get_pos_b2b_debts` dans la liste « REVOKE pair sur CHAQUE RPC B2B »**,
   ce qui est vrai, mais sa checklist « Gates dédiées présentes » ne teste que les RPC
   **d'écriture** (« aucune RPC B2B d'écriture ne retombe sur le générique `customers.update` »).
   Résultat : la seule lecture B2B non gardée du projet passe entre les mailles (finding 2).
   La checklist devrait porter sur les lectures aussi, comme le fait déjà sa ligne REVOKE.

---

## Faux positifs écartés

- **« Le JSONB `b2b_payments.allocation` est encore écrit »** — pas un défaut : la skill
  (§Critical patterns 7) le documente comme snapshot legacy conservé pour continuité, et
  `record_b2b_payment_v2` écrit bien les lignes réelles à côté. Le chantier des allocations
  par facture est LIVRÉ et réel (`p_invoice_ids` honoré, ciblage puis FIFO) — rien à signaler.
- **« Le PIN de `adjust_b2b_balance_v2` voyage en argument RPC »** — CORRECT. Arbitrage du
  2026-08-31 gravé dans CLAUDE.md : header = Edge Function, **argument = RPC**, parce qu'une
  RPC PostgREST ne lit pas les en-têtes. Vérifié en outre qu'elle le VÉRIFIE réellement, avec
  verrouillage : `IF NOT public._verify_pin_with_lockout(v_profile_id, p_manager_pin) THEN
  RAISE 'invalid_pin'`, précédé d'un `length(p_manager_pin) < 4` et de la gate
  `b2b.balance.adjust`.
- **« Un 5ᵉ écrivain de `b2b_current_balance` »** — il n'y en a pas. Le scan des corps live
  (`prosrc ~* 'SET\s+b2b_current_balance'`) rend exactement quatre fonctions :
  `create_b2b_order_v6`, `record_b2b_payment_v2`, `adjust_b2b_balance_v2`,
  `cancel_b2b_order_v1`. `attach_tab_customer_v3`, `get_ar_aging_v1`,
  `get_b2b_dashboard_counters_v1`, `get_pos_b2b_debts_v3`, `reconcile_b2b_balance_v1` et
  `validate_b2b_credit_limit_v1` la **lisent** seulement. Colonne non UPDATE-able par
  `authenticated` (seul `SELECT` accordé), conformément à `20260601000013`.
- **« Balance = Σ `b2b_pending` »** — formule proscrite, non utilisée. `reconcile_b2b_balance_v1`
  dérive bien `SUM(view_b2b_invoices.outstanding) WHERE is_unpaid`, partial-payment aware.
- **« `create_b2b_order` a perdu la gate de crédit »** — non : `v_credit_check :=
  validate_b2b_credit_limit_v1(p_customer_id, v_items_total)` est appelée **après** le
  `SELECT … FOR UPDATE` sur `customers` et **avant** l'`INSERT INTO orders`. TOCTOU couvert.
- **« Double JE de revenu sur une commande B2B passée à `paid` »** — le garde-fou tient :
  `SELECT COUNT(*) FROM journal_entries je JOIN orders o ON o.id=je.reference_id WHERE
  je.reference_type='sale' AND o.order_type='b2b'` → **0**.
- **« `actor_id` = `auth.uid()` »** — aucune des quatre RPC ne le fait ; toutes résolvent
  `SELECT id FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL`. Contrôle
  sur les données : 263 lignes `audit_logs` en `b2b.%`, **0** dont l'`actor_id` ne soit pas un
  `user_profiles.id`.
- **« `reference_id` NULL sur les JE de paiement/ajustement »** — comportement documenté par
  la skill (§Traçabilité) pour éviter la collision sur la contrainte d'idempotence
  `(reference_type, reference_id)` ; le paiement le repose après coup
  (`UPDATE journal_entries SET reference_id = v_payment_id`).
- **« `_verify_pin_with_lockout(v_profile_id, …)` vérifie le PIN de l'appelant, pas d'un
  manager tiers »** — c'est une ré-authentification de l'acteur, et la gate
  `b2b.balance.adjust` restreint déjà à SUPER_ADMIN/ADMIN/MANAGER. Pas un défaut.

---

## Ce que je n'ai pas pu vérifier

- **Le comportement live de `cancel_b2b_order_v1`** : `SELECT action, COUNT(*) FROM audit_logs
  WHERE action LIKE 'b2b.%'` rend `b2b.order.created` 63, `b2b.payment.recorded` 130,
  `b2b.balance.adjusted` 70 et **`b2b.order.cancelled` 0**. Aucune annulation n'a jamais été
  jouée sur la base dev : les findings 3 et 11 sont établis par lecture des deux corps live et
  non par exécution. Rejouer `supabase/tests/b2b_display_aware_stock.test.sql` étendu à
  l'annulation le trancherait.
- **La reproduction du chemin (b) du P0** (facture B2B dans un statut autre que
  `b2b_pending`) : les 22 commandes B2B de dev sont toutes en `paid`, aucune n'a jamais quitté
  `b2b_pending` autrement que par règlement. Le chemin est démontré par lecture (`FIFO … WHERE
  o.status = 'b2b_pending'` vs `view_b2b_invoices … status <> 'voided'`), pas par exécution.
  Le chemin (a) — solde gonflé par un ajustement — est, lui, **prouvé en live**, et suffit à
  établir le P0.
- **La suite de tests JS** : consigne de ne pas lancer la suite complète, et aucun finding
  n'exigeait un test ciblé (tous sont établis sur le corps live ou sur un grep exhaustif).
  Le contrôle « la modale ment » (finding 1) est une lecture de JSX, pas un rendu ;
  `record-payment-invoice-selection.smoke.test.tsx` existe mais ne couvre pas le reliquat.
- **La prod `abjabuniwkqpfsenxljp`** : hors périmètre par consigne. Tous les chiffres
  d'intégrité de ce rapport sont ceux de **V3 dev** : 68 clients B2B, 22 commandes,
  46 paiements, 64 lignes d'allocation — dont **aucun paiement** dont le montant s'écarte de
  la somme de ses allocations. Volume trop faible pour que « 0 dérive » constitue une preuve
  de robustesse, et l'absence de reliquat observé ne dédouane pas le code. C'est
  d'ailleurs cohérent avec le P0 : le reliquat perdu ne laisse **aucune** trace détectable
  après coup, donc son absence dans les données ne prouve rien.
