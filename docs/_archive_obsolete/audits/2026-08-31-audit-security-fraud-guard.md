# Audit security-fraud-guard — 2026-08-31

## Synthèse

Périmètre réellement couvert : les 5 dimensions de la skill, menées contre le **corps live** de
V3 dev `ikcyvlovptebroadgtvd` (`pg_proc`, `pg_get_functiondef`, `pg_policies`, `pg_class`,
`has_*_privilege`, données `audit_logs`), recoupées avec le dépôt. Dimension E (search_path,
ledgers append-only) est **propre** : zéro `SECURITY DEFINER` sans `search_path` épinglé, et les
13 ledgers testés refusent tous INSERT/UPDATE/DELETE à `authenticated`. Le Pattern 5 **ne** régresse
**pas** ce coup-ci : `refund_order_rpc_v10`, `void_order_rpc_v10`, `cancel_order_item_rpc_v6` sont
tous les trois `auth_exec = false`.

**LE P0 : `verify_user_pin(uuid, text)` est toujours `GRANT EXECUTE TO authenticated`.** C'est un
oracle bcrypt sans verrouillage, sans rate-limit et sans audit, appelable en direct par PostgREST
depuis n'importe quel terminal connecté. La faille n°7 du 2026-05-31 a été refermée par l'ajout de
`_verify_pin_with_lockout` mais **la vieille porte n'a jamais été révoquée** : aucune RPC live ne
l'appelle plus (seules deux EF en `service_role` le font), donc le grant est purement résiduel — et
`orders.discount_authorized_by` / `voided_by`, lisibles par tout `authenticated`, fournissent
gratuitement l'`uuid` du manager à brute-forcer. Un second P0 accompagne : `view_b2b_invoices` a
**perdu son `security_invoker`** le 2026-08-08, ré-ouvrant une fuite mesurée et fermée cinq jours plus tôt.

Compte : **2 P0 · 4 P1 · 5 P2 · 1 P3**.

## Findings

| # | Sév. | Zone | Constat (fichier:ligne + ancre stable) | Preuve (SQL/grep exécuté) | Correctif proposé |
|---|---|---|---|---|---|
| 1 | **P0** | Identité / argent | `verify_user_pin(p_user_id uuid, p_pin text)` — `SECURITY DEFINER`, `STABLE`, lit `user_profiles.pin_hash`, **aucun** lockout, **aucun** audit, **aucun** gate ; ACL live = `postgres:EXECUTE, authenticated:EXECUTE, service_role:EXECUTE`. Ancre : `supabase/migrations/20260503000006_init_helpers.sql:25` (`CREATE OR REPLACE FUNCTION verify_user_pin`) ; commentaire trompeur `20260619000023_harden_user_profiles_pin_hash_grant.sql:44` (« Read only by service_role auth flows »). Le PIN est à 6 chiffres → 10⁶ essais sans compteur. L'`uuid` cible s'obtient sans privilège : `orders` est `SELECT`-able par `authenticated` (policy `auth_read` = `is_authenticated() OR has_kiosk_jwt(NULL)`) et porte `discount_authorized_by`, `voided_by`, `served_by`. | `SELECT prosecdef, proconfig, pg_get_functiondef(oid), role_routine_grants` sur `verify_user_pin` → `prosecdef=t`, grants incluent `authenticated:EXECUTE`. `SELECT proname FROM pg_proc WHERE pg_get_functiondef(oid) ILIKE '%verify_user_pin(%' AND proname<>'verify_user_pin'` → **[] (aucun appelant SQL live)**. `grep -rn verify_user_pin` → seuls `supabase/functions/_shared/manager-pin.ts:126`, `auth-verify-pin/index.ts:103`, `auth-change-pin/index.ts:69`, tous via `getAdminClient` (service_role). `SELECT column_name FROM information_schema.columns WHERE table_name='orders' AND column_name ILIKE '%\_by%'` → `discount_authorized_by, served_by, voided_by`. | Migration : `REVOKE EXECUTE ON FUNCTION public.verify_user_pin(uuid, text) FROM authenticated, anon, PUBLIC;` (les EF passent en `service_role`, inchangées). Idem pour `hash_pin(text)` (finding 10). Poser un pgTAP de non-régression dans `supabase/tests/security_anon_grants.test.sql` asserant `has_function_privilege('authenticated', 'public.verify_user_pin(uuid,text)', 'EXECUTE') = false`. |
| 2 | **P0** | Exposition / PII | `view_b2b_invoices` s'exécute **avec les droits de son propriétaire** : `reloptions IS NULL` en live. `supabase/migrations/20260803000002_views_security_invoker_and_drop_orphan_balance_sheet.sql:41` (`ALTER VIEW public.view_b2b_invoices SET (security_invoker = true)`) a été **annulé** par `supabase/migrations/20260808000001_orders_pickup_date.sql:37` (`CREATE OR REPLACE VIEW view_b2b_invoices AS`) qui recrée la vue **sans** clause `WITH`. Aggravant : le `COMMENT ON VIEW` posé juste après, `20260808000001_orders_pickup_date.sql:63-66`, affirme « SECURITY INVOKER — respecte les RLS de orders/customers » — le commentaire ment sur l'objet live. La vue projette `b2b_company_name`, `customer_name`, `invoice_total`, `amount_paid`, `outstanding`. | `SELECT relname, relkind, reloptions FROM pg_class WHERE relkind IN ('v','m')` → `view_b2b_invoices` : `reloptions = null` ; `view_ar_aging`, `v_product_available_stock`, `view_product_recipes`, `view_recipe_products` : `{security_invoker=true}`. La preuve d'impact est **écrite dans le dépôt** : `20260803000002…:19-20` mesure `CASHIER view_b2b_invoices 29 -> 0` et `waiter 29 -> 0` au moment du durcissement — ce passage à 0 est aujourd'hui défait. | Migration : `ALTER VIEW public.view_b2b_invoices SET (security_invoker = true);`. Corriger dans la foulée la **méthode**, pas seulement l'instance : toute recréation de vue par `CREATE OR REPLACE VIEW` doit porter `WITH (security_invoker = true)` en ligne. Candidat à une garde CI (`pg_class.reloptions` de toutes les vues `public`) puisque la régression est passée par une migration relue. |
| 3 | P1 | Traçabilité | **~34 RPC live écrivent `auth.uid()` dans `audit_logs.actor_id`.** Le motif est identique partout : `DECLARE v_uid UUID := auth.uid();` (ou `v_caller_id` / `v_user_id` / `v_caller` / `v_caller_uid`) puis `INSERT INTO audit_logs (actor_id, …) VALUES (v_uid, …)`, sans jamais résoudre `WHERE auth_user_id = auth.uid()`. Ancres vérifiées sur corps live : `update_product_v2` (`v_caller_id UUID := auth.uid();`), `recompute_recipe_cost_v1` (`v_uid UUID := auth.uid();`), `record_cash_wallet_movement_v1` (idem — **chemin argent**, action `cash.wallet_movement`), `delete_product_v1`, `discard_held_order_v1`, `add_order_item_v5`, `import_sales_v1`, `create_product_v2`, `set_expense_threshold_v1`, `import_expenses_v1`… `auth-verify-pin/index.ts:180` grave `sub: profile.auth_user_id`, donc `auth.uid()` **est** l'`auth_user_id`, jamais le `user_profiles.id`. | `WITH d AS (… pg_get_functiondef …) SELECT count(*) FILTER (WHERE src ILIKE '%auth_user_id%'), count(*) FILTER (WHERE src NOT ILIKE '%auth_user_id%') FROM d` sur les 130 écrivains d'audit → **93 résolvent le profil, 37 non** (dont 3 triggers légitimes → ~34 RPC). Extraction du `DECLARE` : `recompute_recipe_cost_v1` → `DECLARE v_uid UUID := auth.uid(); …`. | Résoudre le profil avant l'écriture (`SELECT id INTO v_actor FROM user_profiles WHERE auth_user_id = auth.uid() AND deleted_at IS NULL`) — ou, mieux, extraire un helper `_current_profile_id()` et faire porter la correction par un lot unique, la classe étant trop large pour 34 bumps indépendants. **Ne pas bumper au fil de l'eau** : chaque `_vN` non coordonné rouvre le Pattern 5. |
| 4 | P1 | Traçabilité | **L'onglet History d'un produit ne montrera JAMAIS un recalcul de coût** — et c'est un défaut de filtre, pas d'acteur. `apps/backoffice/src/features/products/hooks/useProductAuditLog.ts:34` passe `p_entity_type: 'product'` (**singulier**), alors que `recompute_recipe_cost_v1` écrit `entity_type = 'products'` (**pluriel**) : `INSERT INTO audit_logs (…) VALUES (v_uid, 'product.cost_recomputed', 'products', p_product_id, …)`. Même sort pour `product.costs_recomputed_bulk` et `combo.upserted`. C'est la réponse à « pourquoi ma marge a bougé » qui est invisible dans l'écran prévu pour ça. | `SELECT entity_type, action, count(*) FROM audit_logs WHERE action LIKE 'product%' OR entity_type IN ('product','products') GROUP BY 1,2` → sous `'product'` : `product.update` 56, `product.deleted` 66, `product.sections` 35, `product.units` 30… ; sous `'products'` : **`product.cost_recomputed` 233**, `product.costs_recomputed_bulk` 78, `combo.upserted` 4. Et le corps live de `get_audit_logs_v3` ne filtre **pas** sur `actor_id` (vérifié : la clause `WHERE` ne mentionne `al.actor_id` que via `p_actor_id IS NULL OR …`). | Trancher la valeur canonique d'`entity_type` pour un produit (`'product'`), puis **soit** bumper les RPC fautives vers le singulier, **soit** élargir le filtre du hook. La 1ʳᵉ option est la bonne (l'`entity_type` est une donnée de drill-down), mais elle laisse 315 lignes historiques sous le pluriel : prévoir la migration de données ou un filtre `IN ('product','products')` transitoire. Décision Mamat. |
| 5 | P1 | Identité (gate) | **4 gates de permission fail-open** : le motif `IF <acteur> IS NOT NULL AND NOT has_permission(…) THEN RAISE` laisse passer l'appel entier quand l'acteur est `NULL`. Ancres (corps live) : `recompute_recipe_cost_v1` et `recompute_all_recipe_costs_v1` → `IF v_uid IS NOT NULL AND NOT has_permission(v_uid, 'inventory.cost_correction')` ; `enqueue_notification_v2` → `IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), 'notifications.send')` ; `retry_sale_journal_entry_v4` → `IF v_profile_id IS NOT NULL AND NOT has_permission(v_profile_id, 'pos.sale.create')`. `inventory.cost_correction` garde le coût de revient, donc la marge : c'est un levier de dissimulation de perte (triangle de la fraude, ligne *Manager*). | `SELECT proname, substring(… 'IF[^;]{0,110}IS NOT NULL AND NOT[[:space:]]+has_permission[^;]{0,80}') FROM pg_proc WHERE pg_get_functiondef(oid) ~* 'IS NOT NULL AND NOT[[:space:]]+has_permission'` → les 4 lignes ci-dessus. **La branche fail-open est prouvée empruntée** : `SELECT action, count(*) FROM audit_logs WHERE actor_id IS NULL GROUP BY 1` → `product.cost_recomputed` **233** et `product.costs_recomputed_bulk` **78**, et `count(*) FILTER (WHERE actor_id IS NOT NULL)` = **0** pour `product.cost_recomputed` : ces RPC n'ont *jamais* tourné avec un acteur. | Inverser en fail-closed : `IF v_uid IS NULL OR NOT has_permission(v_uid, …) THEN RAISE EXCEPTION … USING ERRCODE='P0003'`. Si un appel machine (cron, EF) doit passer, lui donner un chemin explicite (`service_role` + helper `_`-préfixé révoqué de `authenticated`), jamais un `NULL` toléré. |
| 6 | P1 | Identité (auth) | `supabase/functions/auth-verify-pin/index.ts:180` — `sub: profile.auth_user_id` est posé **sans garde de nullité**, alors que le JWT est signé lignes 175-188 avec `role: 'authenticated'`. Un profil dont `auth_user_id` est `NULL` reçoit donc un jeton `authenticated` **sans sujet** : `auth.uid()` retourne `NULL`, ce qui fait passer d'un coup les 4 gates fail-open du finding 5. Le cas n'est pas théorique sur cette base. | `SELECT count(*) FILTER (WHERE auth_user_id IS NULL) FROM user_profiles` → **1** profil sur 8. Lecture de `index.ts:126-205` : aucun `if (!profile.auth_user_id) return …` entre la vérification du PIN (l. 103) et la signature (l. 188). | Refuser l'émission : après la vérification du PIN, `if (!profile.auth_user_id) return jsonResponse(redactError('server_misconfigured_no_auth_user'), 500);`. Corrige la cause ; le finding 5 corrige la conséquence — poser les deux. |
| 7 | P2 | Intégrité | `orders` et `order_items` accordent encore des écritures brutes à `authenticated` : `has_table_privilege('authenticated','orders','UPDATE') = true` (idem `INSERT`, `DELETE`), `order_items` `INSERT`/`DELETE` = true. Seule l'**absence** de policy d'écriture les bloque (`relrowsecurity = true`, et `pg_policies` ne rend qu'une policy `auth_read` en `SELECT` pour chaque table). C'est exactement la posture que `CLAUDE.md` (« Order writes = RPCs uniquement, jamais d'insert brut ») et le Pattern 10 refusent : une policy ajoutée par erreur devient immédiatement une porte sur le money-path. | `SELECT has_table_privilege('authenticated', t, 'UPDATE'/'DELETE'/'INSERT')` sur 14 tables → **seules `orders` et `order_items` sont ouvertes** ; les 12 ledgers (`audit_logs`, `stock_movements`, `journal_entries`, `journal_entry_lines`, `b2b_payments`, `expense_approvals`, `loyalty_transactions`, `role_permissions`, `user_permission_overrides`, `discount_authorizations`, `z_reports`, `order_payments`) sont à `false/false/false`. `SELECT tablename, cmd FROM pg_policies WHERE tablename IN ('orders','order_items')` → 2 lignes, `cmd = SELECT` uniquement. | `REVOKE INSERT, UPDATE, DELETE ON public.orders, public.order_items FROM authenticated;` — aucune régression attendue puisque les policies d'écriture n'existent pas. Ajouter les deux tables à `supabase/tests/security_append_only_ledgers.test.sql`. |
| 8 | P2 | Identité (gate) | **8 `SECURITY DEFINER` mutantes, appelables par `authenticated`, sans aucun `has_permission`** : `reservation_hold_v1`, `reservation_consume_v1`, `reservation_release_v1`, `release_expired_reservations`, `next_journal_entry_number(p_date date)`, `pick_notifications_batch_v2(p_limit int)`, `update_lan_heartbeat_v2(p_device_codes text[])`, plus `send_items_to_kitchen(p_item_ids uuid[])` (celui-là **documenté comme toléré** par la skill, je ne le compte pas). La famille `reservation_*` immobilise et relâche du stock — un caissier peut geler le stock d'un produit à volonté. Elle n'a **aucun call-site applicatif** (`grep` sur `**/*.{ts,tsx}` → uniquement `supabase/tests/functions/stock-reservations.test.ts` et des commentaires de `packages/domain/src/inventory/reservations/reservationCalculator.ts:45,61`) : surface vivante côté DB, morte côté produit. | `SELECT proname, prorettype, has_function_privilege('authenticated', oid,'EXECUTE') FROM pg_proc WHERE prosecdef AND proname NOT LIKE '\_%' AND functiondef ~* '(INSERT INTO|UPDATE |DELETE FROM)' AND functiondef NOT ILIKE '%has_permission%'` → 16 lignes, dont 8 triggers (`prorettype = trigger`, exemptés) ; les 8 restantes sont celles listées. | Décision Mamat requise sur la famille `reservation_*` : la **doter d'un gate** (`inventory.adjust` ?) ou la **DROP** si le chantier réservations est abandonné. Les 4 autres sont des helpers d'infrastructure : les renommer `_`-préfixés + `REVOKE … FROM authenticated`, ou leur poser le gate correspondant. |
| 9 | P2 | Identité (auth) | `has_kiosk_jwt(p_required_scope text DEFAULT NULL)` — corps live : `IF v_scope NOT IN ('kds','display','tablet') THEN RETURN FALSE; END IF;`. Si `app_metadata.scope` est **absent**, `v_scope` est `NULL`, `NULL NOT IN (…)` vaut `NULL`, la branche ne se déclenche pas ; puis `IF p_required_scope IS NOT NULL AND …` est sautée quand l'appelant passe `NULL` — et la fonction **`RETURN TRUE`**. Or c'est précisément `has_kiosk_jwt(NULL::text)` qui figure dans la policy `auth_read` de `orders` et `order_items`. Un jeton kiosk sans `scope` obtient donc la lecture des commandes. Latent (dépend de ce que `kiosk-issue-jwt` émet), et **déjà signalé le 2026-08-31** — je le porte comme *toujours ouvert*, pas comme neuf. | `pg_get_functiondef('has_kiosk_jwt')` (corps intégral relu) ; `SELECT policyname, qual FROM pg_policies WHERE tablename IN ('orders','order_items')` → `(is_authenticated() OR has_kiosk_jwt(NULL::text))`. | `IF v_scope IS NULL OR v_scope NOT IN ('kds','display','tablet') THEN RETURN FALSE; END IF;`. Une ligne, fail-closed. |
| 10 | P2 | Identité | `hash_pin(p_pin text)` — `SECURITY DEFINER`, `SELECT crypt(p_pin, gen_salt('bf', 10))`, ACL live `authenticated:EXECUTE`. Aucun consommateur applicatif en `authenticated` : `auth-change-pin/index.ts:83` l'appelle en `service_role`, les autres usages sont des migrations de seed (`20260507000002_seed_waiter_role.sql:47`, `20260517000200_create_user_rpcs.sql:150,474`) et `scripts/e2e/provision-pins.sql:9,15`. Grant résiduel, à révoquer avec le finding 1 (même migration). | `role_routine_grants` sur `hash_pin` → `postgres:EXECUTE, authenticated:EXECUTE, service_role:EXECUTE`. `grep -rn hash_pin` (résultats ci-dessus). | `REVOKE EXECUTE ON FUNCTION public.hash_pin(text) FROM authenticated, anon, PUBLIC;` |
| 11 | P2 | Identité (lockout) | **Pattern 11 confirmé, mais l'ancre de la skill est fausse.** Le 5/15 en dur n'est pas dans `_verify_pin_with_lockout` : ce corps ne fait que `PERFORM record_pin_failure_v1(p_user_id, 'rpc')`. Le codage en dur vit dans **`record_pin_failure_v1(p_user_id uuid, p_source text)`** : `IF v_new >= 5 THEN UPDATE user_profiles SET locked_until = now() + interval '15 minutes'`. Conséquence inchangée : le chemin RPC ignore `pin_max_failed` / `pin_lockout_minutes` (catégorie `security`), donc durcir la politique depuis les réglages ne durcit que le chemin EF. | `pg_get_functiondef('_verify_pin_with_lockout')` → aucun littéral 5 ni 15 ; `pg_get_functiondef('record_pin_failure_v1')` → `v_new >= 5` et `interval '15 minutes'`. | Lire les deux réglages dans `record_pin_failure_v1` (avec les mêmes bornes [3,10] / [5,120] et les défauts 5/15 en repli) et bumper en `_v2`. Corriger aussi l'ancre du Pattern 11 de la skill (cf. *Dérives*). |
| 12 | P3 | Exposition | Les vues d'appoint pgTAP `tap_funky` et `pg_all_foreign_keys` sont dans le schéma `public` et **lisibles par `anon`** (`has_table_privilege('anon', …, 'SELECT') = true`) — les seuls objets `v`/`m` dans ce cas. Elles divulguent la structure (fonctions, contraintes, clés étrangères) à un appelant non authentifié. Constat **dev** : je n'ai pas et ne dois pas vérifier la prod. | `SELECT relname, relkind, has_table_privilege('anon', oid,'SELECT') FROM pg_class WHERE relkind IN ('v','m')` → `tap_funky` et `pg_all_foreign_keys` à `true` ; les 3 MV `mv_*` et les 5 vues applicatives à `false`. | Déplacer l'extension `pgtap` hors de `public` (schéma dédié `tap`), ou `REVOKE ALL ON tap_funky, pg_all_foreign_keys FROM anon, PUBLIC`. À arbitrer avec la question « pgtap est-il installé en prod ? », que je n'ai pas le droit de sonder. |

## Dérives de la skill

1. **Pattern 4 (`SKILL.md:182-188`) est périmé** — signalé par le mandat, confirmé par le code.
   La skill écrit « **Reste ouvert :** la famille `create_manual_je` prend toujours le PIN en
   **argument SQL** (`p_manager_pin`) […] seul item de ce pattern non soldé ». L'arbitrage du
   2026-08-31 gravé dans `CLAUDE.md` dit l'inverse : vers une **RPC Postgres**, le PIN *doit* être un
   argument, une RPC ne lisant pas les en-têtes. Vérification faite, `create_manual_je_v1` **vérifie
   réellement** le PIN avec verrouillage (`pg_get_functiondef` → `_verify_pin_with_lockout` présent,
   `has_permission` présent) : ce n'est pas un défaut, et la ligne « reste ouvert » doit être retirée.
   Même sort pour `approve_expense_v3`, `close_fiscal_period_v1`, `close_fiscal_year_v1`,
   `close_shift_v8`, `sign_zreport_v2`, `void_zreport_v2`, `adjust_b2b_balance_v2` : **les 8 RPC
   PIN-in-arg live câblent toutes le helper à verrouillage** (requête sur
   `pg_get_function_identity_arguments ILIKE '%pin%'`).

2. **Pattern 9 et le tableau des failles closes affirment un fait que la base contredit.** La ligne
   « `view_b2b_invoices` / `view_ar_aging` sans `security_invoker` → corrigé `20260619000020/000021` »
   est **fausse pour `view_b2b_invoices`** : `reloptions IS NULL` en live (finding 2). Le tableau
   « ne pas rouvrir » a ici fait exactement ce que le bandeau de la skill redoute à l'envers — il
   couvre une régression au lieu d'éviter un doublon. Ironie utile : la skill elle-même prescrit au
   Pattern 9 « **ne jamais croire le commentaire de migration — vérifier `SELECT relname, reloptions
   FROM pg_class`** ». C'est cette instruction, et non le tableau, qui a trouvé la faille.

3. **La ligne 7 du tableau des failles closes est incomplète.** « RPC PIN-in-arg sans persistance des
   échecs (brute-force illimité) → helper `_verify_pin_with_lockout` + câblage » décrit un demi-correctif :
   le helper a bien été ajouté et câblé, mais **`verify_user_pin` n'a jamais été révoquée de
   `authenticated`** (finding 1). La faille n'est close qu'au niveau des *appelants*, pas au niveau du
   *grant* — soit précisément la distinction que la skill enseigne au Pattern 5 (« la RPC est la
   frontière de sécurité »). À reformuler en « close côté appelants, **grant résiduel à révoquer** ».

4. **Le contrôle `actor_id` de la checklist C rend un faux négatif sur cette base.** La requête
   prescrite (`LEFT JOIN user_profiles … WHERE p.id IS NULL`) retourne **[]** — non parce que le code
   est correct, mais parce que la fixture dev masque le bug : `SELECT count(*) FILTER (WHERE id =
   auth_user_id) FROM user_profiles` → **6 profils sur 8**. Écrire `auth.uid()` y produit un
   `actor_id` qui *semble* valide. Le contrôle doit porter sur le **code** (grep des corps live pour
   `:= auth.uid()` sans résolution `auth_user_id`), pas sur la donnée — et la checklist devrait le dire.

5. **La ligne « écart connu non expliqué » de la checklist C se trompe de cause.** La skill écrit :
   « l'onglet History d'un produit rendait 5 lignes sur 7, les 2 manquantes étant **exactement celles à
   `actor_id IS NULL`** ». La corrélation est fortuite : ces 2 lignes étaient des
   `product.cost_recomputed`, qui sont *à la fois* sans acteur *et* sous `entity_type = 'products'`.
   La cause réelle est le filtre `p_entity_type: 'product'` du hook (finding 4). La skill avait raison
   de dire « cause ailleurs qu'on ne le croyait » — elle peut maintenant nommer l'ailleurs.

6. **Ancre fausse au Pattern 11** : « le helper SQL `_verify_pin_with_lockout` (`20260622000010`) […]
   code **5/15 en dur** ». Le corps live de ce helper ne contient ni 5 ni 15 ; le codage en dur est
   dans `record_pin_failure_v1` (finding 11). La *conclusion* de la skill tient, son *ancre* pointe à côté.

7. **Compteur périmé, sans conséquence** : « 5 rôles au 2026-08-31 » et « 137 entrées `PermissionCode` »
   sont datés et présentés comme tels par la skill — conforme à sa propre règle, rien à corriger.

## Faux positifs écartés

- **`create_manual_je_v1` / `void_zreport_v2` / `sign_zreport_v2` prenant `p_manager_pin` en argument.**
  Clos par l'arbitrage `CLAUDE.md` du 2026-08-31 (header = EF, argument = RPC) et par l'historique
  `approve_expense` déplacée du header vers l'argument le 2026-06-01 *parce que la RPC ne lisait jamais
  l'en-tête*. Critère appliqué à la place : « la cible vérifie-t-elle le PIN, avec verrouillage ? » →
  oui pour les 8 (cf. *Dérives* 1).
- **Régression du Pattern 5 sur les reversals.** Re-vérifiée comme demandé, elle **n'a pas eu lieu** :
  `refund_order_rpc_v10`, `void_order_rpc_v10`, `cancel_order_item_rpc_v6` sont tous à
  `auth_exec = false, anon_exec = false, svc_exec = true`. Rien à signaler — mais c'est le contrôle
  qui devra être rejoué au prochain `_vN`.
- **`role.permission_granted` / `role.permission_revoked` sans acteur (79 lignes).** Ce sont des
  **lignes historiques** : le dernier `NULL` date du `2026-08-25 01:24:19`, les lignes avec acteur
  reprennent à `2026-08-25 03:14:48` — le correctif `20260825000002` du trigger de matrice fonctionne.
  Ne pas rouvrir.
- **`get_audit_logs_v3` `SECURITY INVOKER`, `GRANT` à `authenticated`, sans `has_permission`.**
  Vérifié conforme au constat de la skill (`prosecdef = false`, `auth_exec = true`, pas de gate) —
  c'est un **arbitrage ouvert assumé**, écrit dans la migration, pas un oubli. Statut inchangé,
  je ne le compte pas comme finding.
- **`send_items_to_kitchen` sans audit ni gate.** Trou documenté et toléré par la checklist C
  (« quelques RPC status-only »). Exclu du finding 8 pour cette raison.
- **Auto-approbation de dépense.** Contrôle passé, aucune ligne `expense.self_approved` en base ; le
  `UNIQUE(expense_id, approver_user_id)` et l'exception SUPER_ADMIN du Pattern 8 restent la règle —
  rien à signaler, et surtout pas « aucune auto-approbation », qui serait faux.
- **Ledgers append-only.** Les 12 ledgers testés sont à `false/false/false` pour `authenticated`.
  Aucune régression de `REVOKE`.
- **`SECURITY DEFINER` sans `search_path`.** `SELECT proname FROM pg_proc WHERE prosecdef AND
  proconfig IS NULL` → **[]**. Dimension E propre sur ce point.
- **Exposition `anon`.** `customers`, `orders`, `audit_logs`, `journal_entries`, `user_profiles` et les
  3 MV `mv_*` : tous à `false`. `user_profiles.pin_hash` reste illisible au niveau colonne
  (`has_column_privilege('authenticated', …, 'pin_hash', 'SELECT') = false`) — le REVOKE tient.

## Ce que je n'ai pas pu vérifier

- **La prod (`abjabuniwkqpfsenxljp`)** : interdite par le mandat. Tous les constats live valent pour
  V3 dev. Les findings 1, 2, 7, 10 et 12 sont des états de **grant/`reloptions`**, qui ne se déduisent
  pas d'une lignée de migrations incompatible : ils devront être re-mesurés sur la base réellement
  exploitée avant d'estimer l'exposition opérationnelle.
- **L'exploitabilité effective du finding 9** (`has_kiosk_jwt` avec `scope` absent) : elle dépend de ce
  que `kiosk-issue-jwt` place réellement dans `app_metadata`. Je n'ai lu ni l'EF ni un jeton émis —
  le défaut de logique `NOT IN`/`NULL` est certain, sa joignabilité ne l'est pas.
- **La suite pgTAP de sécurité** (checklist E) : non exécutée. Le mandat interdit la suite complète et
  aucun finding n'exigeait de la lancer pour être prouvé — tous s'appuient sur le catalogue live ou sur
  un `grep` cité. Les correctifs, eux, la réclameront.
- **Le nombre exact de RPC du finding 3** : j'annonce « ~34 » et non un chiffre ferme. Le comptage
  (37 écrivains sans résolution de profil, moins 3 triggers) repose sur l'absence de la chaîne
  `auth_user_id` dans le corps ; une RPC qui résoudrait le profil par un helper au nom différent serait
  comptée à tort. Les 10 ancres nommées dans le finding, elles, sont vérifiées une à une.
- **`_record_po_payment_internal`** : il reçoit `p_actor` en paramètre. Je n'ai pas remonté ses
  appelants pour savoir si la valeur transmise est un `user_profiles.id` ou un `auth.uid()` — il peut
  appartenir au finding 3 comme en être exempt.
- **`cash_movements`** : le contrôle « retrait avec `reason` NULL/vide » n'a rien pu dire, la table est
  **vide** en dev (0 ligne). Contrôle à rejouer sur des données réelles.
