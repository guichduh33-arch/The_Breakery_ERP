# Audit stock-management — 2026-08-31

## Synthèse

Périmètre réellement couvert : les quatre dimensions du protocole de la skill (A précision,
B automatisation, C sécurité, D traçabilité) exécutées sur la **vérité live** V3 dev
`ikcyvlovptebroadgtvd` (corps `pg_get_functiondef` des 20 RPC du domaine, `pg_trigger`,
`pg_policies`, `cron.job`, grants `information_schema`, enum `movement_type`, données du
ledger), croisées avec les call-sites `apps/backoffice` et `apps/pos`.

Verdict : **le socle est sain**. Les invariants durs tiennent — aucune policy UPDATE/DELETE
sur `stock_movements`, `authenticated` n'a que `SELECT` sur les quatre tables du ledger, la
primitive et les cinq helpers internes sont **non exécutables** par `authenticated`/`anon`,
les 20 RPC publiques portent toutes une gate `has_permission`, `tr_20_je_emit` et
`tr_update_product_cost_on_purchase` sont attachés, `mark_expired_lots_hourly` est bien
`active = false`, la dérive WAC est **nulle** (0 produit hors tolérance 0,01 IDR), et la
règle de descente unique d'ADR-016 est respectée **des deux côtés** (vente et production).
Les call-sites applicatifs sont tous alignés sur les versions live des RPC.

**Aucun P0.** Le défaut le plus lourd (F1) est un fallback silencieux de conversion d'unité
sur le chemin de vente, qui écrit des quantités brutes dans un ledger append-only sans
aucun signal — la classe d'erreur ×1000 que le projet combat. Il est classé P1 et non P0
parce que la porte d'entrée est gardée (ADR-008 D1 sur `upsert_recipe_v2`) et qu'**aucun
produit actif n'est exposé aujourd'hui** ; il reste un défaut de code vivant, sans détecteur
ni test.

Compte : **P0 · 0** | **P1 · 5** | **P2 · 5** | **P3 · 2**

---

## Findings

| # | Sév. | Zone | Constat (fichier:ligne + ancre stable) | Preuve (SQL/grep exécuté) | Correctif proposé |
|---|------|------|----------------------------------------|---------------------------|-------------------|
| F1 | **P1** | A — Précision / money-path | Le résolveur de consommation de vente convertit l'unité de recette vers l'unité de stock avec le wrapper **tolérant** `_try_convert_quantity`, qui **avale l'exception `unit_conversion_missing` et retourne la quantité BRUTE**. La production, elle, appelle le `convert_quantity` **strict** et échoue. Même ligne de recette → la production refuse, la vente déduit un nombre faux, en silence, dans un ledger append-only. Ancres : fonction `_resolve_recipe_consumption_v1` (corps live, `SELECT ... _try_convert_quantity(SUM(w.qty), MIN(w.line_unit), p.unit)`) ; `supabase/migrations/20260710000022_create_resolve_recipe_consumption_v1.sql:44` et `:50` ; le fallback lui-même : fonction `_try_convert_quantity`, `supabase/migrations/20260630000019_bump_recipe_bom_full_v1_unit_converted_line_cost.sql:19` (commentaire assumé `:134` « falls back to raw qty for unconvertible unit pairs »). Origine de la dérive : le wrapper a été conçu pour une fonction d'**affichage** de coût (`recipe_bom_full`) puis réutilisé tel quel sur le chemin qui **écrit** le ledger — `20260710000022:6` le dit explicitement. Appelants concernés : `complete_order_with_payment_v27`, `pay_existing_order_v18`, `create_b2b_order_v6`, `cancel_b2b_order_v1`, `_record_order_item_waste_v1`. | 1) `SELECT public._try_convert_quantity(200,'ml','ltr')` → **200** (au lieu de 0,2). 2) Recensement de toutes les lignes de recette actives dont la paire (unité recette → unité stock) est inconvertible : `CREATE FUNCTION pg_temp.conv_ok(a,b) ... PERFORM convert_quantity(1,a,b) ... EXCEPTION RETURN false` puis jointure `recipes × products WHERE track_inventory AND r.unit <> p.unit AND NOT conv_ok(...)` → **2 lignes** : `Syrup Hazelnut` (g → cup), `Pizza Slice` (g → pcs), toutes deux sur le parent `Almond cream`. 3) Appel direct du résolveur : `SELECT * FROM _resolve_recipe_consumption_v1(<Almond cream>, 1, 5)` → **10.000 `cup` de Syrup Hazelnut (1 808 704 IDR) au lieu de 10 g**, et **5 `pcs` de Pizza Slice au lieu de 5 g**. 4) `SELECT ... proname, uses_try, uses_strict FROM pg_proc WHERE definition ILIKE '%convert_quantity%'` → `record_production_v5` / `record_batch_production_v7` = **strict** ; `_resolve_recipe_consumption_v1` / `recipe_bom_full_v2` / `recipe_direct_cost_v1` = **tolérant**. 5) Exposition live : `Almond cream` est `is_active = false` → **0 produit actif touché aujourd'hui**. | Bumper `_resolve_recipe_consumption_v1` en `_v2` qui appelle `convert_quantity` **strict** et échoue franchement (`unit_conversion_missing`, ERRCODE P0002) plutôt que de sous/sur-consommer — même doctrine que D5 (`recipe_depth_exceeded`). Bumper les 5 appelants. En amont, ajouter un `issue_type = 'unconvertible_recipe_unit'` (severity `critical`) à `get_stock_config_issues_v1` pour que les lignes héritées se voient AVANT d'être vendues. Laisser `_try_convert_quantity` aux seules fonctions d'affichage (`recipe_bom_full_v2`, `recipe_direct_cost_v1`), avec un drapeau `unconvertible` dans leur sortie. |
| F2 | **P1** | C/D — Ledger append-only | `finalize_opname_v3` fait un **`UPDATE stock_movements`** sur le ledger append-only : après l'appel à la primitive, elle repasse estampiller `reference_type='opname', reference_id=p_count_id`. L'écriture aboutit parce que la RPC est `SECURITY DEFINER` (le propriétaire n'est pas soumis à la RLS, qui ne verrouille que `authenticated`). C'est la seule fonction du schéma dans ce cas. Ancres : `supabase/migrations/20260818000013_finalize_opname_v3_review_only.sql:133` ; fonction `finalize_opname_v3` (corps live, bloc `UPDATE stock_movements SET reference_type='opname'`). Doctrine violée : CLAUDE.md « `stock_movements` = ledger append-only » et skill 5.D « never relax … Find another mechanism if you need correction ». | Balayage exhaustif du schéma : `SELECT oid::regprocedure, def ~* 'UPDATE\s+(public\.)?stock_movements' ... FROM pg_proc WHERE nspname='public'` → **une seule** fonction avec `upd = true` : `finalize_opname_v3`. `del = false` partout. | Ajouter `p_reference_type` / `p_reference_id` à la primitive (`record_stock_movement_v2`) et laisser l'opname passer la référence **à l'insertion**, comme le fait déjà `_record_sale_stock_v1`. Le chemin `UPDATE` disparaît alors du schéma, et l'invariant redevient vérifiable mécaniquement (une garde CI ou un test pgTAP peut asserter `0 fonction` avec un UPDATE sur le ledger). |
| F3 | **P1** | C — Sécurité, defense-in-depth | Le correctif m1 de l'audit 2026-06-12 (`supabase/migrations/20260626000016_revoke_extra_privileges_stock_tables.sql:5`, `REVOKE TRUNCATE, TRIGGER, REFERENCES … FROM authenticated, anon`) n'a **jamais été étendu aux tables adjacentes du domaine**. `authenticated` conserve `TRUNCATE` sur : `products`, `recipes`, `recipe_versions`, `production_records`, `production_batches`, `production_schedules`, `purchase_orders`, `purchase_order_items`, `goods_receipt_notes`, `stock_reservations`, **`units` et `unit_conversions`**. `TRUNCATE` **n'est pas filtré par la RLS** : les policies `SELECT`-only de ces tables ne l'arrêtent pas. `units`/`unit_conversions` sont la colonne vertébrale de `convert_quantity` — les vider casse toute déduction de recette. `products` porte en plus `INSERT` + `DELETE` (le `DELETE` est bien bloqué faute de policy, l'`INSERT` passe via la policy `perm_create`). | `SELECT table_name, grantee, string_agg(privilege_type) FROM information_schema.role_table_grants WHERE grantee IN ('authenticated','anon') AND privilege_type IN ('TRUNCATE',…)` → 13 tables du domaine avec `TRUNCATE` pour `authenticated`, `units`/`unit_conversions` avec en plus `DELETE,INSERT,UPDATE`. Contre-vérification RLS : `pg_class.relrowsecurity = true` et **une seule policy `SELECT`** sur `units` (`units_read`) et `unit_conversions` (`auth_read`) → la DML est bloquée, le `TRUNCATE` ne l'est pas. Les quatre tables du ledger proprement dit (`stock_movements`, `stock_lots`, `display_stock`, `display_movements`) sont **propres** : `SELECT` seul. | Une migration qui rejoue le `REVOKE TRUNCATE, TRIGGER, REFERENCES FROM authenticated, anon` sur les 13 tables listées, plus `REVOKE INSERT, UPDATE, DELETE` sur `units` / `unit_conversions` / `products` là où aucune policy ne les légitime. Exposition pratique aujourd'hui : PostgREST n'émet pas de `TRUNCATE`, donc c'est de la defense-in-depth — mais c'est exactement le raisonnement que m1 a déjà refusé une fois. |
| F4 | **P1** | D — Traçabilité vitrine | Les **quatre** RPC de vitrine (`add_display_stock_v1`, `adjust_display_stock_v1`, `waste_display_stock_v1`, `return_display_to_kitchen_v1`) n'écrivent **aucune ligne `audit_logs`**. Le cas grave est `waste_display_stock_v1` : elle **court-circuite la primitive** et fait un `INSERT INTO stock_movements` direct (`movement_type='waste'`, `reference_type='display_waste'`) + `UPDATE products.current_stock`. Résultat : c'est le **seul waste du système sans ligne `stock.movement` dans `audit_logs`** — tous les autres passent par la primitive, qui écrit l'audit. Or la perte est le vecteur de démarque classique, et `display.manage` est une permission de caisse. Ancres : fonction `waste_display_stock_v1` (corps live, bloc `INSERT INTO stock_movements … 'display_waste'`), `supabase/migrations/20260530185453_create_waste_display_stock_v1_rpc.sql:8` ; call-site `apps/pos/src/features/stock/hooks/useWasteDisplay.ts:43`. | `SELECT proname, def ~* 'INSERT INTO audit_logs' … FROM pg_proc` sur les 19 RPC du domaine → `ecrit_audit = false` pour les 4 RPC vitrine, `waste_display_stock_v1` cumulant `ins_ledger_global = true` et `via_primitive = false`. Contrôle données : `SELECT count(*) FROM display_movements` = **16**, `SELECT count(*) FROM audit_logs WHERE action ILIKE 'display%'` = **0**. | Soit router `waste_display_stock_v1` par la primitive (qui écrit l'audit et résout l'unité), soit y ajouter l'`INSERT INTO audit_logs` canonique (`actor_id` = **profil**, jamais `auth.uid()`). Et donner aux trois autres RPC vitrine leur ligne d'audit : `display_movements` trace le quoi, `audit_logs` trace le qui pour l'écran de sécurité. |
| F5 | **P1** | A — Précision / filet | Le contrôle canonique `current_stock − SUM(quantity) = 0` échoue sur **15 des 50 produits ayant des mouvements** (somme des écarts absolus : 2 461,8). La cause n'est **pas** un défaut de RPC — c'est que le ledger a été **purgé** vers le 2026-08-11 alors que `audit_logs` a été conservé : la plus vieille ligne de `stock_movements` date du **2026-08-11**, la plus vieille ligne d'audit `stock.movement` du **2026-05-14**, et **1 202 audits de mouvement pointent vers un `stock_movements.id` qui n'existe plus**. Le reliquat est de la pollution des specs vitest live-RPC (`Test Baguette` : 670 de `production_in` au ledger pour `current_stock = 0` ; `Vitest PO Product A/B`) qui remettent `current_stock` à plat. Conséquence : **le contrôle de précision de la dimension A est aveugle sur cette base**, et le restera. C'est la consigne m10 (« entrer le stock initial par le ledger ») prise à revers. | `WITH agg AS (SELECT product_id, SUM(quantity) FROM stock_movements GROUP BY 1) SELECT count(*) FILTER (WHERE abs(current_stock-ledger) > 0.001) …` → **15/50**. `SELECT count(*) FROM audit_logs a WHERE a.action='stock.movement' AND NOT EXISTS (SELECT 1 FROM stock_movements sm WHERE sm.id=a.entity_id)` → **1 202**. `min(created_at)` : ledger **2026-08-11**, audits **2026-05-14**. Grep : les seuls `DELETE FROM stock_movements` du dépôt sont dans `supabase/tests/inventory.test.sql` (lignes 215, 419, 649, 874), sous enveloppe de test. | Deux gestes distincts. (a) Décider explicitement du sort du ledger dev : soit on le remet à zéro **avec** les `audit_logs` correspondants, soit on ré-entre le stock initial par des mouvements `adjustment_in` (m10) — sinon aucun audit de précision n'aura jamais de valeur ici. (b) Isoler les specs live-RPC sur des produits dédiés qu'elles nettoient **entièrement** (mouvements + `current_stock`), au lieu de laisser `current_stock` désaligné. Rien à corriger côté prod : le mécanisme d'écriture est correct (la primitive fait `INSERT` puis `UPDATE` dans la même transaction, sous `FOR UPDATE`). |
| F6 | **P2** | B — Automatisation inerte | La chaîne d'alerte low-stock existe mais **ne peut structurellement pas se déclencher** sur cette base : `business_config.alert_email` est **NULL** (le trigger `_trg_notify_low_stock` sort alors immédiatement, `IF v_alert IS NULL … RETURN NULL`), et **330 des 336 produits suivis ont `min_stock_threshold = 0`** — or le trigger est conditionné par `WHEN (new.current_stock < new.min_stock_threshold AND old.current_stock >= old.min_stock_threshold)` et `get_low_stock_v2` filtre `min_stock_threshold > 0`. Aucun écran ne signale que l'alerting est éteint. Ancres : fonction `_trg_notify_low_stock`, trigger `trg_notify_low_stock` ; RPC `get_low_stock_v2` ; réglage exposé par `apps/backoffice/src/pages/settings/SettingsNotificationsPage.tsx`. | `SELECT allow_negative_stock, alert_email FROM business_config` → `alert_email = <NULL>`. `SELECT count(*) FILTER (WHERE track_inventory) , … FILTER (WHERE min_stock_threshold = 0) FROM products WHERE deleted_at IS NULL` → **336 suivis / 330 à seuil 0 / 6 à seuil > 0**. `pg_get_triggerdef(trg_notify_low_stock)` → clause `WHEN` de franchissement. | C'est de la **configuration**, pas du code : renseigner `alert_email` et poser des seuils. Le geste de code utile est de rendre l'inertie **visible** : un bandeau sur la page d'alertes quand `alert_email` est vide, et un compteur « N produits suivis sans seuil » dans `get_stock_config_issues_v1` (nouvel `issue_type`, severity `info`). |
| F7 | **P2** | A — Précision | Un produit `track_inventory = false` **voit quand même son `current_stock` décrémenté** à la vente : `_record_sale_stock_v1` saute la *garde* de solde pour ces produits mais exécute inconditionnellement `UPDATE products SET current_stock = current_stock - p_quantity`. Résultat : **10 produits non suivis portent un stock négatif fantôme**, pour une valorisation de **−217 399 IDR**. Ancre : fonction `_record_sale_stock_v1` (corps live, bloc `ELSIF v_track THEN … END IF;` suivi de l'`UPDATE products` hors condition). | `SELECT count(*), sum(current_stock*cost_price) FROM products WHERE track_inventory=false AND current_stock < 0` → **10 produits, −217 399,24 IDR**. Exemples : `Americano` −2, `Capuccino` −4, `American Bagel` −4. Atténuation vérifiée : `get_stock_levels_v4`, `get_stock_counters_v1`, `get_stock_position_v1`, `get_stock_variance_v3` filtrent tous `track_inventory` — la valorisation fantôme **ne fuit pas** dans la liste de stock ni dans la valorisation d'ADR-024. | Deux options, arbitrage Mamat : (a) ne plus décrémenter `current_stock` quand `track_inventory = false` (le champ redevient « non renseigné » plutôt que « faux ») ; (b) garder la décrémentation comme statistique de vente et l'assumer, mais alors le nommer. Ne rien faire est aussi tenable tant que les lecteurs filtrent — le risque est le **prochain** lecteur qui oubliera le filtre. |
| F8 | **P2** | B — Cohérence rapport | `get_low_stock_v2` **ne filtre pas `track_inventory`**, contrairement aux cinq autres fonctions de lecture du stock. Un produit non suivi doté d'un seuil > 0 remonterait donc dans la liste des ruptures, sur la base du `current_stock` fantôme de F7. Ancre : fonction `get_low_stock_v2` (corps live, clause `WHERE p.deleted_at IS NULL AND p.is_active AND p.min_stock_threshold > 0 AND p.current_stock < p.min_stock_threshold` — pas de `track_inventory`) ; call-site `apps/backoffice/src/features/inventory-alerts/hooks/useLowStock.ts:35`. | `SELECT proname, def ILIKE '%track_inventory%' FROM pg_proc WHERE proname IN (…)` → `get_low_stock_v2` = **false**, les cinq autres = **true**. | Bump `get_low_stock_v3` avec `AND p.track_inventory = true`, + bump du call-site. Aucun produit ne le déclenche aujourd'hui (les 6 seuils > 0 sont sur des produits suivis) — c'est une incohérence latente, pas un bug visible. |
| F9 | **P2** | A — Fuseau (ADR-019) | **Trois** RPC du domaine calculent leur numéro de document avec `now() AT TIME ZONE 'Asia/Jakarta'` (WIB, UTC+7) alors que le fuseau métier gravé par ADR-019 et posé en paramètre de session est **`Asia/Makassar`** (WITA, UTC+8). Entre 00 h 00 et 01 h 00 heure métier, le numéro porte la **date de la veille**. Ancres : `receive_purchase_order_v4` (préfixe `GRN-`), `record_production_v5` et `record_batch_production_v7` (préfixe de `batch_number`) — corps live, ligne `|| to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD')`. | `SELECT oid::regprocedure FROM pg_proc WHERE nspname='public' AND pg_get_functiondef(oid) ILIKE '%Asia/Jakarta%'` → exactement ces **3** fonctions. Extraction ligne à ligne des corps : l'usage est **uniquement** la numérotation ; ni `production_date` ni `received_date` ne passent par ce cast (ils utilisent `current_date`, donc le fuseau de session, donc le bon jour métier). | Remplacer par `current_date` (qui rend déjà le jour métier, cf. CLAUDE.md) ou par `'Asia/Makassar'`. Impact limité au préfixe de date d'un numéro séquencé — l'unicité n'est pas menacée, la lisibilité fiscale du numéro l'est. |
| F10 | **P2** | D — Traçabilité coût | `update_cost_price_v1` ne produit **aucune ligne `audit_logs`**. Le changement de coût est bien tracé dans le ledger (mouvement `cost_price_correction`, `metadata` porte `old_cost`/`new_cost`/`reason`, `created_by` porte le profil), mais le journal d'audit — la surface que lit l'écran de sécurité — ignore un levier direct sur le COGS et sur toutes les marges. Ancre : fonction `update_cost_price_v1` (corps live : `INSERT INTO stock_movements … 'cost_price_correction'` puis `UPDATE products SET cost_price`, sans `INSERT INTO audit_logs`) ; call-sites `apps/backoffice/src/features/products/hooks/useCorrectCostPrice.ts:29` et `useUpdateProduct.ts:6`. | `SELECT proname, def ~* 'INSERT INTO audit_logs' FROM pg_proc WHERE proname='update_cost_price_v1'` → **false**. Données : `SELECT count(*) FROM stock_movements WHERE movement_type='cost_price_correction'` → **4**, sans contrepartie d'audit dédiée. | Ajouter l'`INSERT INTO audit_logs` canonique (`action='product.cost_corrected'`, `actor_id` = profil résolu, `metadata` = contexte, `payload` = le diff old→new — deux colonnes, ne pas les fusionner). N'ajoute **aucune** écriture comptable : ADR-014 l'interdit et cela reste vrai. |
| F11 | **P3** | D — Idempotence | L'enveloppe de rejeu de `update_cost_price_v1` est **incohérente** : sur replay elle renvoie `'old_cost' = metadata->>'old_cost'` (bon) mais `'new_cost' = products.cost_price` **relu au moment du rejeu**. Si le coût a bougé entre-temps, le rejeu annonce un `new_cost` qui n'est pas celui de la première exécution — ce qui contredit la règle projet « replay renvoie le résultat de la 1ʳᵉ exécution ». Ancre : fonction `update_cost_price_v1`, bloc `IF p_idempotency_key IS NOT NULL THEN … RETURN jsonb_build_object('old_cost', v_replay_old_cost, 'new_cost', v_old_cost …)`. | Lecture du corps live : `v_old_cost` est chargé par `SELECT cost_price FROM products` **dans** la branche de replay, donc reflète l'état courant, pas l'état d'origine. | Lire `new_cost` depuis `metadata->>'new_cost'` du mouvement retrouvé, comme c'est déjà fait pour `old_cost`. Une ligne. |
| F12 | **P3** | B — Panne muette latente | Deux valeurs de l'enum `movement_type` sont **sans mapping** dans le `CASE` de `tr_stock_movement_je` alors qu'elles auraient un impact comptable si elles étaient utilisées : **`purchase_return`** (retour fournisseur : sortie de stock + contrepartie dette) et la valeur héritée **`production`**. Le trigger sort en silence (`RETURN NEW` de l'early-return), sans `P0002` — c'est exactement la panne muette décrite en 5.A. Aucune des deux n'est écrite aujourd'hui. Ancre : fonction `tr_stock_movement_je`, bloc `IF NEW.movement_type NOT IN ('waste','adjustment','adjustment_in','adjustment_out','opname_in','opname_out','production_in','production_out') THEN RETURN NEW;`. | `SELECT string_agg(enumlabel) FROM pg_enum WHERE typname='movement_type'` → 19 valeurs, dont `purchase_return` et `production`. `SELECT movement_type, count(*) FROM stock_movements GROUP BY 1` → **10 types utilisés**, ni `purchase_return` ni `production` (ni `incoming`, ni `adjustment_in/out`, ni `opname_in`, ni `sale_void`, ni `reservation_*`). | Ne rien coder maintenant. Poser la règle au moment où le retour fournisseur sera implémenté : avant d'écrire le premier mouvement `purchase_return`, ajouter sa branche DR/CR au `CASE` — sinon la sortie de stock existera sans écriture. Et envisager de retirer `production` de l'enum si plus rien ne l'écrit (chantier séparé, un enum ne se rétrécit pas à la légère). |

---

## Dérives de la skill

Trois écarts entre ce que la skill affirme et ce que la base montre. Aucun n'est un défaut de
code — ce sont des lignes de la skill à corriger.

1. **« Le helper de vente est le seul écrivain légitime hors primitive »** — skill, section
   *Critical patterns* n°1 : « **La déduction de stock de VENTE passe par l'unique helper
   `_record_sale_stock` — jamais en direct.** (Ce helper est le seul écrivain légitime hors
   primitive…) ». **Faux au 2026-08-31 : ils sont SEPT.** Balayage
   `pg_proc … def ~* 'INSERT INTO stock_movements'` → `record_stock_movement_v1` (la
   primitive), `_record_sale_stock_v1`, `_record_cancel_waste_stock_v1`,
   `cancel_b2b_order_v1`, `refund_order_rpc_v10`, `void_order_rpc_v10`,
   `update_cost_price_v1`, `waste_display_stock_v1`. Six fonctions écrivent donc le ledger
   sans passer par la primitive — et perdent au passage la résolution d'unité, la ligne
   `audit_logs` et le contrôle d'idempotence qu'elle porte (c'est le mécanisme de F4 et F10).
   La skill doit énumérer les écrivains directs, ou dire que la liste se relève et ne se
   mémorise pas.

2. **« Aucune fonction ne fait d'UPDATE sur le ledger »** — la skill présente
   l'append-only comme un acquis (*Traceability backbone* : « RLS revokes UPDATE/DELETE » ;
   5.D : « never relax »). C'est vrai **côté RLS** et faux **côté `SECURITY DEFINER`** :
   `finalize_opname_v3` fait un `UPDATE stock_movements` (F2). La RLS ne protège pas contre
   les RPC propriétaires ; la skill laisse croire l'inverse.

3. **« Le CHECK `chk_stock_movements_reason_required` impose `reason` ≥ 3 sauf sale/sale_void »**
   — exact, mais la skill n'en tire pas la conséquence : `_record_sale_stock_v1` insère
   `reason = NULL` (il n'y a pas de colonne `reason` dans son `INSERT`), y compris pour les
   mouvements `sale_void` de remboursement/annulation. Le contrôle D « `reason` populated »
   rend donc structurellement 0 ligne sur les ventes — ce n'est pas une preuve de propreté,
   c'est un contrôle qui ne porte que sur `adjustment*` et `waste`. À dire explicitement dans
   la checklist pour ne pas se rassurer à bon compte. (Vérifié : `SELECT … WHERE
   movement_type IN ('adjustment','adjustment_in','adjustment_out','waste') AND (reason IS
   NULL OR length(trim(reason)) < 3)` → **0 ligne**, le contrôle est vert sur son périmètre
   réel.)

---

## Faux positifs écartés

- **`lot_id` NULL sur toutes les consommations, `_resolve_fifo_lot` jamais appelée en
  pratique, `create_stock_lot_v1` appelée avec `p_expires_at := NULL` dans
  `receive_purchase_order_v4`** → **ADR-004** : ni péremption, ni FIFO, ni expiration. Infra
  dormante, pas un trou. Contrôle d'intégrité tout de même exécuté : **0 `lot_id` orphelin**.
- **`mark_expired_lots_hourly` présente dans `cron.job`** → ADR-004 conséq. 2, elle doit
  exister et être `active = false`. Vérifié : `active = false`. Aucune régression.
- **`from_section_id` / `to_section_id` NULL sur tous les mouvements récents ; 40 lignes
  `transfer_in`/`transfer_out` figées au 2026-08-14 ; aucun gate de solde par section ;
  opname sans section** → **ADR-027**, stock mono-emplacement. La primitive insère `NULL`
  dans les deux colonnes quoi qu'on lui passe (vérifié dans le corps live), les
  `transfer_*` sont de l'historique append-only. Vérifié en plus qu'**aucun fichier de
  `apps/`** ne mentionne `section_stock` / `internal_transfer` / `stock_locations` /
  `insufficient_section_stock` : pas de régression applicative, et les fichiers pgTAP ont
  été correctement retournés en assertions « la table est droppée ».
- **`section_required` (P0001) toujours levé par `record_production_v5` et
  `record_batch_production_v7`** → skill *Critical patterns* n°12 : c'est la **STATION** de
  production, donnée de routage, pas un emplacement de stock. Ne pas retirer.
- **Aucune écriture comptable sur les 4 mouvements `cost_price_correction`** → **ADR-014**
  conséq. 1 et 4. Vérifié que `cost_price_correction` est bien **absent** du `CASE` du
  trigger, comme exigé. (Ce qui manque est la ligne `audit_logs`, pas le JE — c'est F10.)
- **`quantity = 0` sur `cost_price_correction` alors que la primitive lève
  `quantity_must_be_nonzero`** → documenté : cette RPC contourne délibérément la primitive
  pour cela, et aucun CHECK de table n'impose le non-zéro.
- **30 produits en stock négatif** → `business_config.allow_negative_stock = true`, la vente
  est autorisée à passer sous zéro. Contrôle croisé fait avant de conclure, comme la skill
  l'exige. **Le stock de vitrine, lui, est à 0 négatif** — la garde inconditionnelle de
  `_record_sale_stock_v1` tient (`IF COALESCE(v_disp_qty,0) < p_quantity THEN RAISE … P0002`,
  sans `NOT p_allow_negative`). Les 10 négatifs sur produits **non suivis** sont un cas
  distinct, retenu en F7.
- **Le trigger JE n'émet rien quand la valorisation est nulle** (`IF v_value <= 0 THEN RETURN
  NEW`) → comportement documenté par la skill (« skips zero-value postings »). Conséquence
  connue : un produit entré uniquement par `incoming` reste à coût 0 et ses pertes n'ont
  aucun impact comptable — c'est le motif qui a fait droper `receive_stock_v1`, pas un défaut
  neuf.
- **`record_incoming_stock_v1` toujours exposée dans le BO** (`IncomingStockForm.tsx`,
  `useRecordIncomingStock.ts`) sans WAC ni JE → by design, BackOffice uniquement. Vérifié que
  le **POS ne l'appelle nulle part** : `apps/pos` ne touche que les quatre RPC de vitrine
  (`usePOSReceiveStock.ts:53` → `add_display_stock_v1`). L'isolation POS/BO annoncée par la
  skill est **confirmée**. Et `useRecordDirectPurchase.ts:8-11` route bien l'achat compté par
  `create_purchase_order_v2 → receive_purchase_order_v4 → record_po_payment_v2`.
- **Cascade de production qui « exige » d'avoir déclaré les semi-finis** → ADR-016 conséq. 4,
  voulu. Vérifié sur le corps live de `record_production_v5` : la récursion ne continue que
  `WHERE COALESCE(m.track_inventory, TRUE) = FALSE`, et `_resolve_recipe_consumption_v1`
  applique la **même** règle (`WHERE wp.track_inventory = FALSE`). **Aucune double déduction,
  aucune régression ADR-016** — c'est le point que je m'attendais le plus à trouver cassé.
- **Les 9 décisions ADR-008** → soldées, re-constatées au passage sur les corps live
  (`recipe_depth_exceeded` D5, `production_requires_deduct_stock` D6, `waste_reason` D3,
  `reverse_of_production` D7 dans le trigger JE). Rien à signaler.

---

## Ce que je n'ai pas pu vérifier

- **Le comportement en production.** Toutes les mesures portent sur V3 **dev**, où le ledger
  a été purgé (F5) et où les specs live-RPC polluent `current_stock`. Les contrôles de
  *précision* (A) n'ont donc qu'une valeur de méthode, pas de constat métier. La prod V2
  (`abjabuniwkqpfsenxljp`) est hors périmètre et de lignée incompatible.
- **L'exposition réelle de F1 sur le catalogue vivant.** J'ai balayé toutes les lignes de
  recette **actives** dont le matériau est suivi en stock (2 cas, tous deux sur un produit
  inactif). Je n'ai pas balayé les recettes désactivées ni l'historique des
  `recipe_versions.snapshot`, qui peuvent porter d'autres paires inconvertibles prêtes à
  redevenir actives.
- **Le franchissement effectif de l'alerte low-stock (F6).** Je n'ai pas provoqué la
  transition `current_stock` sous seuil pour observer l'enfilage : `alert_email` étant NULL,
  le trigger sort avant. La conclusion repose sur la lecture du corps et de la clause `WHEN`,
  pas sur une exécution.
- **Le contexte cron de la primitive** (correctif C2 : profil SYSTEM si
  `auth.uid() IS NULL AND session_user = 'postgres'`). La condition est bien dans le corps
  live, mais je n'ai pas pu vérifier sous quel `session_user` s'exécutent réellement les jobs
  `pg_cron` de ce projet — la skill avertit elle-même que le pooler peut le changer.
- **Les tests.** Consigne respectée : aucune suite lancée. Les fichiers pgTAP du domaine
  (`inventory*.test.sql`, `inventory_opname.test.sql`, `adr008_d7_d8.test.sql`,
  `inventory_phase1_complete.test.sql`) ont été **lus** et sont à jour d'ADR-027, mais je ne
  les ai pas exécutés — donc je ne peux pas affirmer qu'ils passent. Aucun d'eux ne couvre
  F1 (asymétrie strict/tolérant sur la conversion d'unité) ni F2 (UPDATE sur le ledger).
- **Le rendu écran.** Aucune vérification navigateur : les conclusions sur les compteurs, la
  liste de stock et la page d'alertes viennent des corps RPC et des hooks, pas de l'UI
  rendue.
