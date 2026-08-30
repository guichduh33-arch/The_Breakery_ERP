---
name: stock-management
description: >-
  Stock flow expert — raw materials → semi-finished → finished products, entry → exit.
  Audits the inventory flow for precision/automation/security/traceability gaps AND guides
  future changes. Use this skill whenever the task mentions stock, inventory / inventaire,
  stock movement / mouvement de stock, WAC / coût moyen pondéré, recipe / recette,
  production, opname, lot / péremption, FIFO, matière première, semi-fini, spoilage /
  wastage / perte / gaspillage, transfer / transfert, receive / réception, purchase order /
  bon de commande / achat, current_stock / display_stock — or touches apps/backoffice
  inventory|recipes features, POS stock, packages/domain inventory|production, or any
  supabase migration/test with stock/inventory/recipe/production in the name. Invoke it
  BEFORE editing any stock-writing RPC — stock_movements is an append-only ledger.
  Il répond aussi « péremption / FIFO » : c'est un sujet CLOS par l'ADR-004, ne pas
  re-proposer de chantier. Idem « stock par section / transfert interne » : la dimension
  section est SUPPRIMÉE du stock par l'ADR-027 (tables et RPC droppées) — le skill répond
  pour dire que c'est mort, jamais pour le reconstruire.
pathPatterns:
  - 'apps/backoffice/src/features/inventory*/**'
  - 'apps/backoffice/src/features/recipes/**'
  - 'apps/pos/src/features/stock/**'
  - 'supabase/migrations/*stock*.sql'
  - 'supabase/migrations/*inventory*.sql'
  - 'supabase/migrations/*recipe*.sql'
  - 'supabase/migrations/*production*.sql'
  - 'supabase/tests/inventory*.test.sql'
  - 'supabase/tests/recipe*.test.sql'
  - 'supabase/tests/*production*.test.sql'
  - 'packages/domain/src/inventory/**'
  - 'packages/domain/src/production/**'
promptSignals:
  phrases:
    - 'stock movement'
    - 'inventory'
    - 'WAC'
    - 'recipe'
    - 'production'
    - 'opname'
    - 'lot'
    - 'FIFO'
    - 'matiere premiere'
    - 'semi-fini'
    - 'spoilage'
    - 'wastage'
    - 'transfer_stock'
---

# Stock Management — The Breakery ERP

> **Skill re-vérifiée contre le code et le schéma live le 2026-08-31.** Les faits ci-dessous
> ont été relevés à cette date sur V3 dev (`pg_proc`, `pg_constraint`, `pg_trigger`,
> `cron.job`, `information_schema`) et sur la migration au numéro le plus haut. Après cette
> date, la base fait foi, pas ce fichier.
>
> **Ce fichier dépasse volontairement le plafond de 500 lignes** (arbitrage Mamat du
> 2026-08-31). Ce qui déborde est le bandeau ADR ci-dessous, et il doit rester **inline** :
> c'est lui qui empêche de re-proposer la péremption FIFO (close par ADR-004) ou de
> reconstruire le stock par section (supprimé par ADR-027). Derrière un lien de
> `references/`, il ne remplirait plus ce rôle. Ne pas découper ce fichier pour
> « rentrer dans les clous ».
>
> **ADR applicables — corps lus, pas leurs titres** (ADR-004/008/014 lus le 2026-07-28 ;
> ADR-016 et ADR-027 lus le 2026-08-31). Les ADR priment sur tout le reste de ce fichier.
> Un ADR ne se modifie jamais : un changement d'avis = nouvel ADR qui supersede.
>
> **ADR-004** (2026-07-04, ACTÉ) — **ni dates de péremption, ni expiration automatique, ni
> consommation FIFO.** Le modèle retenu, définitif, est le suivi en **quantité globale par
> produit** ; la péremption se gère par **déclaration de perte** (`waste_stock`, raison
> `Expired`). Chantier **abandonné : aucune spec, aucun développement, ne pas re-proposer**
> (conséq. 1). Décommissionnement acté (conséq. 2) : le cron `mark_expired_lots_hourly` est
> **`active = false`**, la page `/inventory/expiring` et le rapport perishable-turnover ont
> quitté la navigation ; l'infra reste **dormante, pas droppée** — `stock_lots`,
> `_resolve_fifo_lot`, `get_expiring_lots`, `create_stock_lot` existent encore, pour
> l'historique et la réversibilité. Partout ci-dessous, une mention de lot / `lot_id` / FIFO
> décrit une **infra dormante**, jamais une consigne à appliquer ni un défaut à corriger.
> → **Ne JAMAIS proposer de spec FIFO/FEFO, ni traiter « `lot_id` NULL » ou « FIFO non
> câblé » comme un gap.** Un `lot_id` renseigné est un résidu, pas une garantie de
> traçabilité. **Hors périmètre — homonymes** (conséq. 5) : le FIFO d'allocation des
> paiements B2B et l'expiration des points de fidélité.
>
> **ADR-008** (2026-07-17, accepté) — arbitrages Production & Recettes. **Le module est
> SOLDÉ : les neuf décisions sont livrées** (relevé du 2026-08-31 sur les corps live).
> Ne re-proposer AUCUN de ces chantiers, et ne pas re-signaler leur absence.
>
> - **D1** unité des lignes de sous-recette : la famille `upsert_recipe` refuse la conversion
>   IMPOSSIBLE (l'unité identique n'est pas exigée — précision ADR-016 conséq. 5).
> - **D2** coût des ratés : JE de reclassement DR 5210 Waste Expense / CR 5110 Production COGS.
> - **D3** enum PG `waste_reason` (mis_baked, poor_proofing, cosmetic, demo, recipe_test,
>   tasting) + colonne `production_records.waste_reason` + CHECK
>   `production_records_waste_reason_required` + argument `p_waste_reason`, obligatoire dès raté.
> - **D4** production bloquante : `p_force_negative` gaté `inventory.production.force_negative`.
> - **D5** échec `recipe_depth_exceeded` si un intermédiaire NON stocké subsiste à la
>   profondeur max — plus de sous-consommation silencieuse.
> - **D6** refus d'un fini `deduct_stock = false` (unitaire + refus au bord côté lot).
> - **D7** revert refusé (`already_consumed`, P0001) si une SORTIE du fini suit l'entrée du
>   lot, et revert repassé par la primitive au lieu d'INSERT directs.
> - **D8** statu quo acté (permission, pas de PIN) : rien à livrer.
> - **D9** dette : idempotence par catch `unique_violation` + relecture, nettoyage des tables
>   temporaires dans la fonction qui les crée.
>
> Migrations porteuses : `20260729000003_adr008_d5_d6_depth_and_deduct_stock.sql`,
> `20260729000004_adr008_d3_waste_reason.sql`,
> `20260729000005_adr008_d2_d9_production_waste_expense.sql`,
> `20260729000006_adr008_d7_revert_guard_and_helper.sql` (D1 via le lot ADR-016).
> Le constat de l'ADR reste valable et impératif : **les corps production en base ont divergé
> des fichiers de migration** — tout `_vN+1` se construit sur le corps live.
>
> **ADR-016** (2026-07-28, ACTÉ ; précise ADR-008 D1) — **la cascade de production s'arrête
> au premier intermédiaire suivi en stock** (`track_inventory = true`) et le consomme depuis
> SON stock. Seuls les intermédiaires `track_inventory = false` continuent d'être dépliés
> jusqu'aux feuilles. La règle de descente est **unique pour tout le système** : c'est celle
> que le résolveur de consommation à la vente appliquait déjà, la production s'y est alignée
> (`20260729000001_adr016_production_cascade_stop_at_stocked.sql`). L'affichage de
> nomenclature suit la même règle (famille `recipe_bom_full`, `20260729000002`) : un
> semi-fini stocké y est une ligne d'ingrédient terminale valorisée à son propre coût.
> → **Ne plus décrire la cascade comme un walk inconditionnel jusqu'aux matières premières.**
> → **Ne pas traiter « produire un fini exige d'avoir déclaré ses semi-finis » comme un
> trou** : c'est la conséquence 4, voulue. Le **calcul du coût de revient est hors périmètre**
> de cet ADR — il continue de se construire depuis les recettes, l'écart avec le coût
> réellement constaté sera tranché séparément. `track_inventory` est désormais le
> **discriminant métier** entre semi-fini géré en stock et simple étape de recette.
>
> **ADR-027** (2026-08-16, ACTÉ) — **le stock est mono-emplacement.** `products.current_stock`,
> alimenté par le ledger, est l'**unique** niveau de stock. La dimension « section » du stock
> est SUPPRIMÉE : cache par section, transferts internes, choix de section à l'opname, à la
> réception d'achat et aux rapports. La table `sections` **survit uniquement comme registre
> des stations de production** (routage de la page Production, `product_sections`,
> `production_records.section_id` = la STATION, donnée de routage et non de stock). Cause
> tranchée : vente, perte et ajustement étaient exempts de section et décrémentaient le
> global sans toucher le cache — qui divergeait mécaniquement, rendant tout calcul contre lui
> faux (deux mesures dans l'ADR).
> → Ce qui est **DROPPÉ** (vérifié absent en base le 2026-08-31) : tables `section_stock`,
> `internal_transfers`, `transfer_items`, `stock_locations`, vue `view_section_stock_details`,
> colonne `stock_reservations.section_id` ; familles `create_internal_transfer` /
> `receive_internal_transfer` / `cancel_internal_transfer` et le helper `next_transfer_number` ;
> permissions `inventory.transfer.*` ; **les deux CHECK de section du ledger**
> (`chk_stock_movements_section_required`, `chk_stock_movements_transfer_both_sections`).
> → Ce qui **survit** : `stock_movements.from_section_id` / `to_section_id` restent pour
> l'historique et ne sont **plus jamais alimentées** ; les mouvements `transfer_in`/`transfer_out`
> déjà écrits restent (append-only), leurs `reference_id` sont des références mortes.
> → **Ne JAMAIS traiter comme un défaut** : une section NULL sur un mouvement, l'absence de
> gate de solde par section, l'absence de filtre de section dans un rapport, un opname sans
> section. **Ne pas re-proposer de transferts internes** — réintroduire un stock
> multi-emplacements exige un ADR supersédant. **Homonymes hors périmètre** : le plan de
> salle POS (`table_sections`), `accounts.cash_flow_section`, et la vitrine POS (déjà isolée
> et sans section, inchangée).
>
> **ADR-014** (2026-07-27, ACTÉ) — **aucune écriture comptable de réévaluation** sur un
> changement de coût, ni par `update_cost_price` (mouvement `cost_price_correction`,
> quantity=0) ni par le recalcul WAC automatique. Le grand livre inventaire reste **basé
> transactions** ; l'écart avec la valorisation instantanée `current_stock × cost_price` est
> **normal entre deux opnames** et s'y résorbe. → **Ne jamais ajouter
> `cost_price_correction` au CASE du trigger JE** (conséq. 1) et **ne plus signaler
> « `cost_price_correction` sans JE » comme un finding** (conséq. 4).
>
> **ADR-024** (2026-08-11, ACTÉ ; complète ADR-014 sans le modifier) — corps lu le
> 2026-08-31. Deux règles qui touchent ce domaine : (1) les **compteurs d'une liste paginée
> sont servis par une fonction de lecture distincte** (famille `get_stock_counters`) et la
> famille `get_stock_levels` ne renvoie plus que des lignes — un agrégat recopié sur chaque
> ligne disparaît quand la liste est vide ; la parité compteurs↔lignes est tenue par un test
> de base, pas par la vigilance. (2) La liste porte **l'unité** de chaque produit et sa
> **valorisation au coût** (`current_stock × cost_price`) — qui **ne doit jamais être
> présentée comme un solde comptable** : ADR-014 a acté que cette valorisation et le grand
> livre inventaire divergent légitimement entre deux inventaires. Les paniers de filtre sont
> un **type énuméré Postgres**, jamais des littéraux TS.

Expert on the stock flow from raw materials through semi-finished to finished products. Two use cases:

1. **Audit** the existing flow against 4 dimensions: precision, automation, security, traceability.
2. **Guide** future changes (new movement types, new RPCs, trigger edits, constraint changes, RPC bumps).

**`CLAUDE.md` is the source of truth** for project-wide patterns, and `docs/adr/` carries the decisions that govern this domain. This skill adds stock-specific mental model, audit checklists, and preventive guidance that neither carries.

## Mental model — The Breakery stock flow

Noms vérifiés en live (V3 dev, relevé du 2026-08-31). **On cite la famille, jamais la
version : les RPC bumpent souvent — la version vivante se vérifie dans
`supabase/migrations/` et au call-site, jamais ici.**

```
ENTRY                             INTERNAL                          EXIT
─────                             ────────                          ────
receive_purchase_order (PO→GRN)   record_production                 complete_order_with_payment
 ↓ stock_movements                 ↓ cascade _resolve_recipe_        pay_existing_order
 ↓ (movement_type=purchase)        ↓ consumption — s'ARRÊTE aux      create_b2b_order
 ↓ → WAC update (trigger)          ↓ semi-finis stockés (ADR-016)     ↓ tous via _record_sale_stock
 ↓ → JE via le flux achat (GRN)    ↓ stock_movements                  ↓ stock_movements (sale)
 ↓ (plus aucun choix de section)   ↓ (production_in/out)              ↓ → JE via le flux commande
                                   ↓ → JE trigger + JE de reclassement
record_incoming_stock              ↓   des ratés (ADR-008 D2)        refund/void RPCs
 ↓ (incoming) — PAS de WAC,                                           ↓ stock_movements (sale_void)
 ↓ PAS de JE, PAS de lot          record_batch_production             _record_cancel_waste_stock
 ↓ BackOffice uniquement           ↓ wrapper canonique sur            ↓ (waste sur annulation)
                                   ↓ l'impl interne, non exposée
adjust_stock                                                        VITRINE POS (isolée)
 ↓ (adjustment) → JE              finalize_opname                    add_display_stock
                                   ↓ GLOBAL depuis ADR-027 :         adjust_display_stock
waste_stock                        ↓ attendu lu sur current_stock    waste_display_stock
 ↓ (waste) → JE                    ↓ (opname_in/out) → JE            return_display_to_kitchen
                                                                      ↓ display_stock + display_movements
```

**Les transferts internes n'existent plus** (ADR-027) : il n'y a plus de mouvement INTERNE
entre emplacements, seulement production et opname.

`update_cost_price` écrit un mouvement `cost_price_correction` (quantity=0) — voir
ADR-014 : pas de JE.

### ⚠️ Schema reality (re-vérifié V3 dev 2026-08-31 — les noms de colonnes trompent l'intuition)

- **Quantity column is `quantity`** (DECIMAL(10,3), **signed** — negative for sale/waste, positive for purchase/incoming/production_in). There is NO `quantity_delta` column. Opname/WAC queries must use `quantity`.
- **Ledger actor is `created_by`** (FK user_profiles). There is NO `actor_id` on `stock_movements` (`actor_id` is the `audit_logs` column).
- **Free-text reason column is `reason`** (TEXT, ≥3 chars except sale/sale_void via CHECK `chk_stock_movements_reason_required`). There is NO `reason_code`.
- **`audit_logs` porte DEUX colonnes distinctes** : `metadata` (contexte) et `payload` (diff). Ne jamais les fusionner. La vue `audit_log` (singulier) est **droppée**.
- **JE trigger is `tr_20_je_emit`** (the trigger name); the *function* it calls is `tr_stock_movement_je`. Query `pg_trigger` by `tr_20_je_emit`.
- **WAC trigger is `tr_update_product_cost_on_purchase`** — `AFTER INSERT … WHEN (movement_type IN ('purchase','production_in'))` since the 2026-06-12 audit fix (`20260626000015`). WAC lives in a trigger, NOT inside the receive RPC, and it does **NOT** fire on `movement_type='incoming'` (voir « Cost backbone » ci-dessous).
- **`from_section_id` / `to_section_id` sont MORTES en écriture** (ADR-027). Les colonnes
  existent toujours et portent l'historique antérieur au 2026-08-17 ; la primitive
  d'écriture les accepte encore en argument (compat des appelants publiés) mais insère
  `NULL` dans les deux. Un `GROUP BY section` sur le ledger ne rend donc plus rien pour la
  période courante — c'est **nominal**, pas un bug. `production_records.section_id`, lui,
  reste renseigné : c'est la **station** de production, pas un emplacement de stock.

### Traceability backbone

- `stock_movements` append-only ledger (RLS revokes UPDATE/DELETE for `authenticated` — la
  seule policy vivante est un `SELECT` perm-gaté, vérifié le 2026-08-31)
- `reason` (les colonnes de section ne sont plus alimentées, cf. schema-reality)
- `p_idempotency_key` UUID → `stock_movements.idempotency_key UUID UNIQUE` (replay-safe)
- trigger `tr_20_je_emit` (function `tr_stock_movement_je`) → `journal_entries` automatic,
  **uniquement** pour `waste`, `adjustment`, `adjustment_in/out`, `opname_in/out`,
  `production_in/out` (liste vérifiée dans le corps live ; `adjustment` a été ajouté par
  l'audit Q1, migration `20260727000246`). `incoming` / `purchase` / `sale` / `transfer_*` /
  `reservation_*` / `cost_price_correction` n'émettent RIEN ici — les JE de vente et
  d'achat viennent des flux commande / GRN. Le trigger sort aussi immédiatement quand
  `metadata->>'reverse_of_production' = 'true'` : les contre-passations d'annulation de
  production portent leurs propres écritures (ADR-008 D7).
- **Le coût des ratés de production a sa propre écriture** (ADR-008 D2), rattachée au
  mouvement `production_in` avec `metadata->>'movement_type' = 'production_waste'` —
  et non à un mouvement dédié : un raté n'entre jamais en stock, l'enum `movement_type`
  n'a donc PAS été étendu. Ne pas chercher un mouvement `production_waste` dans le ledger.
- `audit_logs` row per RPC call (cols canoniques : actor_id / action / entity_type /
  entity_id / metadata **+ payload**)
- `lot_id` : **résiduel, hors doctrine** (ADR-004). Il n'atteste plus rien — ne pas
  bâtir de contrôle de traçabilité dessus.

### Cost backbone

- `movement_type='purchase'` (réception de PO via `receive_purchase_order`) AND `movement_type='production_in'` (since `20260626000015`) update `products.cost_price` (WAC) via trigger `tr_update_product_cost_on_purchase`
- `production_in` is valued at the **actual consumed cost** (`SUM(total_consumed × material_cost)` from the BOM walk ÷ actual yield), NOT at stale `products.cost_price` (audit 2026-06-12 M5, `20260626000015`) — the production JE pair (DR 1135 finished goods / CR 5110) is balanced against the `production_out` legs by construction
- `movement_type='incoming'` (`record_incoming_stock`, BackOffice uniquement) does **NOT** touch `cost_price` — a product received only this way stays at its prior cost (often 0). Chemin de correction : `update_cost_price` (movement_type=`cost_price_correction`, quantity=0) — **sans JE**, cf. ADR-014. Pour une réception qui doit être valorisée, passer par le flux achat compté (`create_purchase_order` → `receive_purchase_order`) : c'est la conclusion de l'audit Q3, qui a fait DROP `receive_stock_v1` (fait historique — l'objet n'existe plus).
- A `cost_price` change fires `tr_snapshot_on_product_cost_change` → re-snapshots ancestor `recipe_versions.snapshot`
- **Nomenclature affichée : famille `recipe_bom_full`**, plafond de profondeur paramétrable
  (défaut 5). Depuis ADR-016 elle **s'arrête aux semi-finis stockés**, qui y apparaissent
  comme lignes d'ingrédient terminales valorisées à leur propre coût.
- **Le CALCUL du coût de revient n'a PAS suivi ADR-016** (hors périmètre acté, conséq. 2) :
  il continue de se construire depuis les recettes, en descendant. L'écart entre les deux
  méthodes est **connu et non tranché** — le mesurer produit par produit relève d'un
  arbitrage propriétaire, pas d'un correctif à poser.
- **Le coût par version vit dans `recipe_versions.snapshot`** (JSONB), pas dans une table.
  `product_cost_at_version` est une **CLÉ du snapshot**, jamais une table, une vue ni une
  colonne (vérifié le 2026-08-31 : aucune relation ni fonction de ce nom en base) — on l'y
  lit par `snapshot->>'product_cost_at_version'`. ⚠️ **Deux formes de snapshot coexistent** :
  le CHECK vivant `recipe_versions_snapshot_shape_chk` accepte soit un **objet**
  (`items` array + `product_cost_at_version` number, tous deux exigés), soit un **array nu**
  — la forme héritée, qui ne porte AUCUN coût. Un lecteur doit gérer les deux : supposer
  l'objet fait planter sur l'historique. ⚠️ **Cette valeur est de profondeur 1 seulement**, ainsi documentée
  dans `20260520000020_bump_recipe_version_snapshot_with_cost.sql` (le « D8 » qu'y cite le
  commentaire est antérieur à l'ADR-008 et ne le désigne pas) : les coûts matières des
  sous-recettes n'y sont pas cascadés. Ne pas la présenter comme un coût
  de revient complet, et ne pas la confondre avec ce que rend la famille
  `calculate_recipe_cost`. Les colonnes réelles de `recipe_versions` sont `id`, `product_id`,
  `version_number`, `snapshot`, `created_at`, `created_by`, `change_note`. L'historique de
  coût se lit par la famille `recipe_cost_history` ; le recalcul se fait par les familles
  `recompute_recipe_cost` / `recompute_all_recipe_costs` (crons quotidiens).

### POS display-stock vs BO stock — RESOLVED (isolation shipped, re-verified 2026-05-31)

**Business intent (owner, 2026-05-30):** the POS `stock` module is a *display-case counter* ONLY. It records finished goods brought from the kitchen into the front display and decrements them on direct sales, purely to avoid selling out-of-stock items. It is meant to be **independent** of the BO stock module and is NOT a procurement/costing flow — a finished good is already costed upstream via its recipe/production, so putting it in the display is not an acquisition (no lot / no WAC / no JE is correct by design). Do NOT "fix" this by adding WAC/lots to the POS path.

**Implementation status — ISOLATION LIVRÉE.** Le « gap » du 2026-05-30 décrit ci-dessous est
CLOS. État re-vérifié sur V3 dev `ikcyvlovptebroadgtvd` le **2026-08-31** :
- **Dedicated tables** exist, fully separate from the global ledger: `display_stock` (`product_id`, `quantity`, `updated_at` — the front-counter), `display_movements` (append-only ledger: `movement_type`, `quantity`, `reason`, `reference_type/id`, `created_by`, `idempotency_key`). RLS on both = **SELECT-only** (`display.read`) → writes only via SECURITY DEFINER RPCs.
- **QUATRE RPC dédiées** (perm-gate `display.manage`, `anon` révoqué) : familles
  `add_display_stock` / `adjust_display_stock` / `waste_display_stock` /
  `return_display_to_kitchen` (retour en cuisine).
- **POS rewired**: `usePOSReceiveStock` wraps the **`add_display_stock`** family ("mise en vitrine"), NOT `record_incoming_stock`. `record_incoming_stock` is called **only from the BackOffice** (`useRecordIncomingStock`) — POS is fully isolated. Vérifié par grep le 2026-08-31.
- **La double déduction vit dans le HELPER DE VENTE, pas dans une RPC de commande.** C'est
  la famille `_record_sale_stock` qui, pour un `is_display_item`, décrémente `display_stock`
  ET écrit `display_movements` ET décrémente `products.current_stock` — donc **tout** chemin
  de vente qui passe par le helper hérite du comportement (encaissement direct, paiement
  d'une commande existante, commande B2B). La garde de solde vitrine y est
  **inconditionnelle** : elle ne cède pas à `p_allow_negative` (qui ne gouverne que le stock
  global), et une vente d'article de vitrine sans ligne `display_stock` échoue en nommant la
  RPC de mise en vitrine.
- **Les chemins d'annulation touchent aussi la vitrine** : les familles `refund_order_rpc`
  et `void_order_rpc` restituent `display_stock`. → **L'affirmation « un seul endroit touche
  les deux stocks » est FAUSSE** : chercher les deux à la fois par grep, jamais en supposant
  un point unique.

> Historical note: avant la livraison de l'isolation, la réception POS passait par
> `record_incoming_stock` dans le ledger **partagé** + le `products.current_stock` global,
> d'où des interférences BO/POS. L'approche « section Front Display » a été remplacée par les
> tables dédiées `display_stock`/`display_movements`. Si un audit trouve encore le POS en
> train d'écrire des lignes `incoming`, c'est une régression — la signaler.

## Audit 2026-06-12 — fixes shipped + ledger conventions

Migrations `20260626000010..016`. Le résumé ci-dessous est **la seule trace exploitable** de
cet audit : il n'a plus de document source vivant, et il fait foi tel quel.

**Fixes shipped (don't re-flag these as gaps):**
- **C2 réparé** (`_010`) — `record_stock_movement` accepte le contexte cron : profil SYSTEM `00000000-0000-0000-0000-000000000999` (`SYS-CRON`, pin_hash non-bcrypt, is_active=false) utilisé quand `auth.uid() IS NULL AND session_user = 'postgres'`. ⚠️ Si le pooler / l'utilisateur d'exécution des crons change, re-vérifier la condition `session_user='postgres'`.
- **C3 réparé** (`_011`) — `margin_alerts.{expected_margin_pct, target_margin_pct, delta_pct}` élargis en NUMERIC(7,2) (le calcul est en 7,2 ; un produit cost élevé / prix faible donne des marges < -999.99 %).
- **C4 — PÉRIMÉ dans sa motivation, conservé dans son effet** (`_012`). Le CHECK de section
  du ledger qu'il servait à ne pas violer est **droppé** (ADR-027). Les RPC de production
  raisent toujours `section_required` (P0001) et le front exige toujours le choix, single et
  batch — mais ce qui est exigé est désormais la **STATION** de production, pas un
  emplacement de stock. Vérifié le 2026-08-31 : les corps live de la production portent
  encore ce code d'erreur. Ne pas le retirer, ne pas le rebrancher sur du stock.
- **M2 / M1 — SANS OBJET depuis ADR-027** (`_013`, `_014`). Le gate de solde par section
  (`insufficient_section_stock`) et la validation des items de transfert sur
  `track_inventory` vivaient dans les RPC de transfert, **droppées** avec la table
  `section_stock`. Vérifié le 2026-08-31 : plus aucune fonction en base ne contient
  `insufficient_section_stock`. → **Ne pas re-signaler l'absence de gate de solde par
  section, ne pas la reconstruire.** Ce qui SURVIT de M1, et reste doctrine : `is_active`
  = vendable au POS, le gate de stock est `track_inventory`.
- **M5 réparé** (`_015`) — voir Cost backbone ci-dessus (production_in au coût réel + WAC).
- **m1 réparé** (`_016`) — REVOKE TRUNCATE/TRIGGER/REFERENCES FROM authenticated, anon sur les tables stock. Le lot d'origine en visait cinq ; il n'en reste **quatre vivantes** au 2026-08-31 (`stock_movements`, `stock_lots`, `display_stock`, `display_movements`) — `section_stock` est droppée (ADR-027). Toute table stock NEUVE doit recevoir le même REVOKE.

**Statut M3 — CLOS SANS SUITE par ADR-004 (2026-07-04).** Le constat « FIFO non câblé »
était exact, mais la réponse n'est pas de le câbler : le propriétaire a abandonné le
chantier lots/FIFO/péremption. Le cron `mark_expired_lots_hourly` est désactivé, l'infra
reste dormante. **Aucune spec FIFO ne doit être écrite.** Si un audit re-signale ce point,
la réponse est l'ADR-004, pas un ticket.

**Conventions ledger (actées, pas des bugs) :**
- **m9** — l'audit `stock.movement` a pour `subject_id` l'**id du mouvement** ; le produit est dans `payload`/metadata. Ne pas "corriger" vers product_id.
- **m10 (reformulé 2026-08-31)** — toute mise en production d'un site migré doit **entrer le
  stock initial via le ledger** (mouvements `incoming`/`adjustment_in`), sinon
  `products.current_stock` et la somme des mouvements ne se réconcilient jamais et tout
  contrôle de précision est aveugle. Le motif d'origine — les caches de section partant de 0 —
  est mort avec ADR-027 ; la consigne, elle, tient et vise maintenant le stock global.
- **m11 — HISTORIQUE.** Les lignes `transfer_in`/`transfer_out` déjà écrites portent leurs
  deux sections (le CHECK d'époque l'exigeait) ; le sens y est porté par le signe de
  `quantity` et le `movement_type`. Aucun mouvement de transfert n'est plus produit, et
  aucun mouvement neuf ne porte de section. Utile pour LIRE l'historique, jamais pour écrire.
- **m2 (ouvert)** — parents de variantes stockables : décision produit requise (un parent porte-t-il du stock ?). Pas de code tant que non tranché.

## Critical patterns (always verify before shipping)

1. **`stock_movements` append-only** — RLS revokes UPDATE/DELETE for `authenticated`. Never INSERT directly from app/test/RPC. Always go through the `record_stock_movement` primitive or its family : `adjust_stock`, `record_incoming_stock`, `waste_stock`, `record_production`, `record_batch_production`, `revert_production`, `finalize_opname`, `receive_purchase_order`. **La déduction de stock de VENTE passe par l'unique helper `_record_sale_stock`** — jamais en direct. (Ce helper est le seul écrivain légitime hors primitive : la primitive REFUSE explicitement `sale` et `sale_void`.) Les familles de transfert interne **ne sont plus dans cette liste — elles sont droppées** (ADR-027).
2. **Primitive auto-resolves `unit`** — passing `unit = NULL` to the `record_stock_movement` primitive makes it fall back on `products.unit`, puis `'pcs'` (corps live vérifié le 2026-08-31). For NEW RPCs, populate `unit` explicitly — don't rely on auto-resolve (see migration `20260516000019_fix_record_stock_movement_v1_unit.sql`).
3. **Il n'y a PLUS de contrainte de section sur le ledger** (ADR-027, `20260817000001`).
   Les deux CHECK (`chk_stock_movements_section_required`,
   `chk_stock_movements_transfer_both_sections`) sont droppés : **aucun `movement_type`
   n'exige de section**, et la primitive insère `NULL` dans les deux colonnes quoi qu'on lui
   passe. → Ne pas écrire de test, de garde ni de doc qui suppose une section obligatoire ;
   ne pas ré-ajouter le CHECK. Les CHECK vivants sur la table, relevés le 2026-08-31 :
   `chk_stock_movements_reason_required`, `chk_stock_movements_reference_required_for_orders`,
   `chk_supplier_only_on_purchase`, `stock_movements_unit_cost_check` (+ `unit` et `quantity`
   en NOT NULL de colonne).
4. **`p_idempotency_key UUID`** on every retry-safe flow — replay returns the existing row instead of doubling. Always pass one from the client on retryable mutations. ⚠️ **Deux mécaniques distinctes, ne pas les confondre** : la primitive de mouvement fait un **SELECT-puis-INSERT** sous l'index UNIQUE `stock_movements_idempotency_key_key` (pas de catch `unique_violation` dans son corps live au 2026-08-31 — une course concurrente remonte donc l'erreur brute) ; les RPC de production, elles, appliquent le pattern projet **catch `unique_violation` + relecture** depuis ADR-008 D9. Une NOUVELLE RPC prend le second.
5. **WAC garbage-in if `current_stock` is stale** (DEV-S17-1.C-02, informational). Manual `UPDATE products.cost_price` bypasses WAC AND emits no `stock_movements` audit row (DEV-S17-1.B-01). If the audit finds drift between recomputed WAC and stored cost_price, look for manual UPDATEs in git history.
6. **RPC versioning monotonic** — never edit a published `_vN` signature. Create `_vN+1` and `DROP FUNCTION ... vN(<old args>)` in the same migration. See `20260516000019` (drop original `record_stock_movement_v1` then recreate with `unit`).
7. **REVOKE pair canonique** on every new RPC:
   ```sql
   REVOKE EXECUTE ON FUNCTION public.<rpc>(<sig>) FROM PUBLIC;
   REVOKE EXECUTE ON FUNCTION public.<rpc>(<sig>) FROM anon;
   ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
   ```
   `REVOKE FROM anon` alone is insufficient — anon inherits via PUBLIC.
8. **`tr_20_je_emit` trigger** (function `tr_stock_movement_je`) emits a `journal_entry` on INSERT — but ONLY for `waste`, `adjustment`, `adjustment_in/out`, `opname_in/out`, `production_in/out` (it early-returns for incoming/purchase/sale/transfer/reservation/cost_price_correction, for any production-revert counter-entry, and skips zero-value postings). It is idempotent (UNIQUE index `journal_entries_je_idempotency_uniq`) and fiscal-guarded (`check_fiscal_period_open`). If you add a new `movement_type` that needs accounting impact, add its DR/CR mapping in the CASE block or it silently emits nothing (no P0002 unless you add it to the handled set without a mapping key).
9. **Production bloquante par défaut (ADR-008 D4)** — une nouvelle RPC qui consomme des
   matières ne doit PAS dériver son autorisation de dépassement d'un réglage global.
   Le forçage se demande explicitement et se gate sur une permission dédiée.
   `_record_sale_stock` garde son `p_allow_negative` piloté par
   `business_config.allow_negative_stock` : c'est le chemin de VENTE, distinct. Attention :
   ce drapeau ne gouverne que le stock GLOBAL — la garde de solde de la vitrine, dans le même
   helper, est inconditionnelle.
10. **Recipe cascade immutable** — `recipe_versions.snapshot` is append-only. No retroactive mutation. La RPC de production lit la version au temps T pour le calcul de coût (pas la version courante). When changing a recipe, the trigger creates a new `recipe_versions` row — never UPDATE existing snapshots.
11. **Règle de descente UNIQUE pour tout le système (ADR-016)** — vente, production et
    affichage de nomenclature s'arrêtent au premier intermédiaire `track_inventory = true`
    et le consomment depuis son stock. Toute nouvelle RPC qui déplie une recette adopte
    cette règle : un résolveur qui redescend jusqu'aux feuilles à travers un semi-fini
    stocké **double-déduit la matière première** et perd l'unité du niveau parent (la classe
    d'erreur ×1000). Si un intermédiaire NON stocké subsiste à la profondeur maximale, on
    échoue franchement (`recipe_depth_exceeded`, ADR-008 D5) — on ne sous-consomme jamais
    en silence.
12. **La saisie d'une production exige toujours une STATION** (`section_required`, P0001,
    présent dans les corps live de production au 2026-08-31) et
    `production_records.section_id` la conserve. Ce n'est **pas** un emplacement de stock :
    la primitive ignore les sections. Ne pas retirer ce gate au motif d'ADR-027, ne pas le
    rebrancher sur du stock.

## Audit checklist (combo: précision / automatisation / sécurité / traçabilité)

Run a section when you suspect a gap. Each check is a discrete SQL/code query you can execute via MCP `execute_sql` or grep.

### A. Précision (computed matches stored)

- [ ] **Opname diff** — for every product, `current_stock - SUM(quantity) FROM stock_movements GROUP BY product_id` must equal 0 (column is `quantity`, signed — NOT `quantity_delta`). Caveat: only holds if ALL initial stock entered via the ledger; on a seeded dev DB most products have `current_stock` set without movements, so restrict to products that HAVE movements (`JOIN stock_movements`). ⚠️ **Ne jamais ventiler ce contrôle par section** : le stock est mono-emplacement (ADR-027) et les colonnes de section sont NULL sur tout mouvement récent.
- [ ] **WAC validity** — recompute weighted average cost from `stock_movements` `purchase` rows carrying a `unit_cost` (NOT `incoming` — those rarely have unit_cost and don't feed WAC) and compare to `products.cost_price`. Drift > 0.01 IDR = audit (likely manual UPDATE or `update_cost_price`, see Pattern #5).
- [ ] **Recipe yield** — for every `production_records` row, compare `quantity_produced` to `recipes.yield_quantity * batch_count`. Recurring discrepancy = recipe definition drift or production input was approximated.
- [ ] **Negative stock** — `SELECT * FROM products WHERE current_stock < 0`. ⚠️ Ce n'est PAS forcément un bug : la vente autorise le négatif tant que `business_config.allow_negative_stock` vaut true, et la production peut avoir été **forcée** (ADR-008 D4). Croiser avec `audit_logs` (`metadata->>'force_negative' = 'true'`) avant de conclure ; un négatif sans trace de forçage ni réglage permissif, lui, est un vrai trou. Un stock de **vitrine** négatif, en revanche, est toujours un défaut : sa garde est inconditionnelle.
- [ ] **Semi-finis stockés (ADR-016)** — un produit `track_inventory = true` qui a une recette
      ET qui est cité par la recette d'un autre produit doit voir son stock BAISSER quand ce
      parent est produit. S'il ne fait que croître, la cascade est repartie en dépliage
      intégral quelque part : régression ADR-016, à signaler.
- [ ] **Orphan lot_id** — `stock_movements.lot_id NOT NULL AND lot_id NOT IN (SELECT id FROM stock_lots)` should be empty. If not, the FK was relaxed somewhere (check `supabase/migrations/`). ⚠️ Contrôle d'intégrité référentielle **uniquement** — un `lot_id` NULL n'est pas un défaut (ADR-004).

### B. Automatisation (triggers + crons active)

- [ ] **JE trigger attached** — `SELECT * FROM pg_trigger WHERE tgname = 'tr_20_je_emit'` confirms attachment. (Also expect `tr_update_product_cost_on_purchase` = the WAC trigger.)
- [ ] **Spoilage cron** — `mark_expired_lots_hourly` doit être **`active = false`** (décommissionnement ADR-004). `SELECT jobname, active FROM cron.job`. S'il repasse à `true`, c'est une **régression** : il auto-wasterait du stock déjà vendu. Crons stock légitimes, relevés actifs le 2026-08-31 : `recompute-recipe-costs-daily`, `recompute-recipe-margins-daily`, `refresh-mv-stock-variance`, `release-expired-reservations`, plus `notification-dispatch-minutely` (transverse, il draine la file d'alertes ci-dessous).
- [ ] **WAC cascade on receive** — only `purchase` (PO) and `production_in` feed WAC → fires `tr_snapshot_on_product_cost_change` → ancestor `recipe_versions` re-snapshot. `incoming` does NOT (voir « Cost backbone »). Run pgTAP `recipe_cascade_snapshot.test.sql`.
- [ ] **Alertes low-stock — l'ancien constat « ABSENT » est PÉRIMÉ** (il datait du 2026-05-30).
      Relevé du 2026-08-31 : un trigger `trg_notify_low_stock` sur `products` (fonction
      `_trg_notify_low_stock`) enfile une notification `low_stock_alert` vers
      `business_config.alert_email`, drainée par le cron `notification-dispatch-minutely`.
      Les alertes ne sont donc plus seulement réactives. La RPC à la demande de la famille
      `get_low_stock` existe toujours, en **mode global uniquement** (le mode par section est
      tombé avec ADR-027). → Ne plus signaler l'absence d'alerte proactive ; si un audit
      cherche un trou ici, il porte sur le **seuil** (`min_stock_threshold`) et sur
      l'existence d'un destinataire, pas sur le mécanisme.
- [ ] **Recipe re-snapshot trigger** — `AFTER UPDATE ON recipes` creates a new `recipe_versions` row? Manual snapshots = drift risk.

### C. Sécurité

- [ ] **RLS on stock_movements** — aucune policy UPDATE ni DELETE ne doit exister. Vérifié le 2026-08-31 : une seule policy vivante, `perm_read` en `SELECT`. Verify with `pg_policies`.
- [ ] **REVOKE pair on every stock RPC** — for each function in `supabase/migrations/*stock*` and `*inventory*`, confirm the 3-line REVOKE block. Missing ALTER DEFAULT PRIVILEGES = anon may inherit EXECUTE via PUBLIC.
- [ ] **Perm gate** — every stock RPC checks `has_permission(auth.uid(), 'inventory.<scope>.<action>')`. Grep for any `SECURITY DEFINER` function without a `has_permission` call.
- [ ] **audit_logs row** — every mutation produces an audit_log row with canonical cols `actor_id / action / entity_type / entity_id / metadata`. Missing rows = silent operations.
- [ ] **Idempotency key validation** — UUID v4 enforced via regex or CHECK? Cross-RPC replay tracked in audit_logs as `*.replay` action?
- [ ] **CHECK constraints intact** — liste relevée le 2026-08-31 :
      `chk_stock_movements_reason_required` (reason ≥ 3 sauf sale/sale_void),
      `chk_stock_movements_reference_required_for_orders`, `chk_supplier_only_on_purchase`,
      `stock_movements_unit_cost_check`, plus `unit` et `quantity` NOT NULL et l'index UNIQUE
      `stock_movements_idempotency_key_key`. **Aucune contrainte de section** — les deux ont
      été droppées par ADR-027 et ne doivent pas revenir. Note: nonzero-quantity is enforced
      by the `record_stock_movement` primitive (`quantity_must_be_nonzero`), NOT a table
      CHECK — `cost_price_correction` legitimately writes `quantity=0` by bypassing the
      primitive.

### D. Traçabilité

- [ ] **Ledger continuity** — no gap in `stock_movements` sequence integrity. If the sequence is bumped without inserts, investigate.
- [ ] ~~**Lot_id on consumption**~~ — **contrôle SUPPRIMÉ (ADR-004)**. Un `lot_id IS NULL` sur une consommation est le fonctionnement nominal, pas un trou de traçabilité. La traçabilité repose sur `reason`, `metadata`, `reference_type/id` et `audit_logs`.
- [ ] **`reason` populated** — for `adjustment*`, `waste`, never NULL/blank (column is `reason`, NOT `reason_code`). Use `SELECT * FROM stock_movements WHERE movement_type IN ('adjustment','adjustment_in','adjustment_out','waste') AND (reason IS NULL OR length(trim(reason)) < 3)`.
- [ ] **Idempotency replay distinguished** — audit_logs distinguishes `*.created` vs `*.replay` to spot retries. If the same action appears N times without `.replay` suffix, the idempotency layer was bypassed.
- [ ] **Chain entry → exit** — for any product, you can trace at least one row of type `purchase`/`incoming` → `production_in/out` → `sale`, en chaînant sur `product_id` + `metadata->>'production_id'` / `reference_id` (**pas** sur `lot_id`, cf. ADR-004). Une chaîne rompue = lignes forcées par INSERT direct, ou stock initial jamais entré par le ledger (cf. m10).

## Preventive checklists (5 concrete cases)

### 5.A — Before adding a value to the `movement_type` enum
- [ ] Does `tr_stock_movement_je` know how to map the new type to a COA account? Sinon il
      sort en silence (l'early-return couvre tout type hors liste) — c'est la panne muette
      à redouter, pas une erreur.
- [ ] ~~Section constraint~~ — **sans objet** : plus aucune contrainte de section sur le
      ledger (ADR-027). Ne pas en ajouter une pour le nouveau type.
- [ ] Avant même d'ajouter une valeur : **le besoin exige-t-il vraiment un mouvement ?**
      ADR-008 D2 a délibérément refusé d'ajouter `production_waste` à l'enum, un raté
      n'entrant jamais en stock — l'écriture comptable s'est rattachée au `production_in`
      existant. Un besoin purement comptable ne justifie pas un `movement_type`.
- [ ] Is there a perm gate `inventory.<action>` for this new type? Seed the permission in the same migration block.
- [ ] New pgTAP coverage in `supabase/tests/inventory_movements.test.sql` for the happy path + REVOKE + audit_logs row.

### 5.B — Before creating a new stock RPC
- [ ] `SECURITY DEFINER` with explicit `has_permission(auth.uid(), 'inventory.<scope>.<action>')` gate.
- [ ] `p_idempotency_key UUID` arg if retry-safe (it usually is).
- [ ] Calls the `record_stock_movement` primitive — never direct `INSERT INTO stock_movements`.
- [ ] `audit_logs` insert with canonical cols.
- [ ] REVOKE pair canonique (3 lines, see Pattern #7).
- [ ] pgTAP coverage: happy path + perm denied + replay returns existing + edge cases (idempotent FK violation re-read).
- [ ] Types regen via MCP `generate_typescript_types` → write to `packages/supabase/src/types.generated.ts` + commit.

### 5.C — Before touching a trigger (JE, WAC cascade)
- [ ] Identify every RPC that depends on the trigger. JE trigger is depended on by la RPC de production, `adjust_stock` / `waste_stock`, `finalize_opname`. (Les mouvements de vente n'émettent PAS de JE via ce trigger — le JE de vente vient du flux commande.)
- [ ] Write an integration pgTAP test that exercises the full chain entry → production → sale, asserting the trigger fired the expected `journal_entries` row.
- [ ] Cross-check les correctifs historiques pour les régressions connues : DEV-S15-2.B-01 (recipe_versions cost reconstruction), DEV-S17-2.A-01 (`expandRecipeCascade` n'a aucun consommateur applicatif — re-vérifié le 2026-08-31, toujours vrai).
- [ ] Additive migration first (new trigger function, attach), then drop the old in the next migration once production is stable.

### 5.D — Before modifying a CHECK / FK / RLS on stock tables
- [ ] Identify the invariant the constraint protects (précédent : relâcher `orders.session_id NOT NULL` et le bug de RECORD de la famille `refund_order_rpc` ne se sont manifestés qu'une fois qu'un autre changement a exercé le chemin).
- [ ] Check existing rows that would violate the new constraint — data migration must run first if any.
- [ ] Regression test suite: `inventory*.test.sql` + `recipe_*.test.sql` + `*production*.test.sql` via MCP `execute_sql` BEGIN/ROLLBACK envelope.
- [ ] RLS on `stock_movements` UPDATE/DELETE is non-negotiable — never relax. Find another mechanism if you need correction (a new void RPC, never UPDATE).

### 5.E — Before bumping an existing RPC `_vN` → `_vN+1`
- [ ] New signature lives in a new migration file with a forward timestamp.
- [ ] `DROP FUNCTION ... vN(<exact old args>)` in the SAME migration as the new function definition.
- [ ] REVOKE pair on `_vN+1` (the new function is anon-callable by default, even if `_vN` wasn't).
- [ ] Hooks in BO / POS calling `_vN`: locate via `Grep` on the function name, bump all callers to `_vN+1`.
- [ ] Types regen + commit.
- [ ] pgTAP covers the new signature and at least one case that wasn't covered in `_vN`.

## Sources de vérité (pointers)

Hiérarchie de vérité (CLAUDE.md) : **le code et le schéma DB** d'abord, puis `docs/adr/`,
puis `docs/objectifs/`, puis `docs/product/` + `docs/runbooks/`.

```
Décisions qui gouvernent ce domaine (immuables)
  docs/adr/004-pas-de-peremption-ni-fifo-stock.md        # ni FIFO ni péremption — CLOS
  docs/adr/008-production-recettes-arbitrages.md         # SOLDÉ : les 9 décisions livrées
  docs/adr/014-pas-de-je-reevaluation-cost-price-correction.md
  docs/adr/016-consommation-semi-finis-stockes.md        # cascade stoppée aux semi-finis stockés
  docs/adr/027-stock-global-mono-section.md              # stock mono-emplacement, transferts droppés
  docs/adr/024-liste-de-stock-compteurs-portee-et-mesures.md  # compteurs séparés des lignes, unité + valorisation au coût
  docs/adr/007 / 011 / 012                               # domaine produits (track_inventory, variantes)

Documentation vivante — les seules arborescences à consulter
  docs/adr/                                              # décisions actées, immuables
  docs/objectifs/                                        # intention métier (dont INVENTORY, PRODUCTION)
  docs/product/ · docs/runbooks/                         # opérationnel

Vérité live (à préférer à tout fichier)
  MCP execute_sql : pg_get_functiondef, pg_trigger, cron.job, information_schema
  supabase/migrations/                                   # historique, mais peut avoir dérivé du live

Tests (vérité comportementale — les lancer pour vérifier un changement ; relevé du
2026-08-31, toujours localiser par glob et non de mémoire)
  supabase/tests/inventory*.test.sql · stock*.test.sql · recipe*.test.sql · *production*.test.sql
  supabase/tests/display_stock*.test.sql · display_oversell_contract · s44_display_symmetry
  supabase/tests/b2b_display_aware_stock · b2b_order_flag_aware_stock · f6_sub_recipes
  supabase/tests/adr008_d7_d8.test.sql                   # revert refusé si le lot a bougé
  supabase/tests/sale_stock_unification.test.sql         # helper de déduction de vente
  supabase/tests/pay_existing_recipe_consumption.test.sql # déduction recette au paiement différé
  (aucun test de transfert interne : la feature est droppée — ADR-027)

Domain (pure TS — mental model + validators, IO-free)
  packages/domain/src/inventory/                         # validations, computeStockDelta
  packages/domain/src/production/                        # bomResolver, expandRecipeCascade
```

## Verification before claiming an audit or fix is complete

Les filtres vitest matchent le **NOM DE FICHIER**, pas le `describe`.

```bash
# Type & lint (cheap, run first) — le lint-ratchet CI bloque aussi sur les erreurs
# PRÉEXISTANTES des fichiers touchés par la PR : lint ce que tu as touché.
pnpm typecheck
pnpm --filter @breakery/domain test inventory
pnpm --filter @breakery/domain test production

# RPC-level : pgTAP via MCP execute_sql, enveloppe BEGIN … ROLLBACK.
# Pas de runner local (Docker retiré). Pour voir TOUTES les assertions d'un coup,
# agréger les is() en un seul SELECT … UNION ALL — sinon le MCP ne renvoie que
# le dernier result set.

# Backoffice smoke (le paquet est @breakery/app-backoffice, PAS @breakery/backoffice)
pnpm --filter @breakery/app-backoffice test inventory
pnpm --filter @breakery/app-backoffice test recipes

# POS smoke — la suite POS complète part en timeout en local ; la CI est le seul
# filet full-suite.
pnpm --filter @breakery/app-pos test stock
```

Après tout changement de schéma : **régénérer les types** (`generate_typescript_types` →
`packages/supabase/src/types.generated.ts`) et les commiter. C'est la cause n°1 de CI cassée.

If you're auditing prod data, work against V3 dev cloud `ikcyvlovptebroadgtvd` via the Supabase MCP, never against prod (V2 monolith `abjabuniwkqpfsenxljp` is incompatible with V3 migration lineage).

## When to escalate

- About to relax a RLS policy / CHECK / FK on stock tables → flag, almost always covers a latent bug elsewhere.
- About to add a `movement_type` value → flag, JE mapping is silent if missing.
- About to write directly to `stock_movements` from a new RPC → don't. Always use the primitive.
- Audit finds drift between WAC and recomputed cost > 0.01 IDR on more than 3 products → flag, likely manual UPDATE in production history.
- Audit finds orphan `lot_id` rows → flag, FK was relaxed somewhere.
- `mark_expired_lots_hourly` repassé à `active = true` → flag immédiat, régression ADR-004.
- Envie de « réparer » le FIFO, la péremption, la vitrine POS (lui ajouter WAC/lots/JE), le
  stock par section ou les transferts internes → **ne pas coder**. Toutes sont des décisions
  actées (ADR-004, ADR-027), pas des trous.
- Un nouveau besoin de dépassement de stock → il se gate sur une permission dédiée,
  jamais sur un réglage global (ADR-008 D4).
- Un résolveur de recette qui redescend à travers un semi-fini `track_inventory = true`
  → flag immédiat, régression ADR-016 (double déduction de matière + erreur d'unité ×1000).
- Une table ou une RPC de section/transfert qui réapparaît → flag, régression ADR-027 :
  la réintroduction d'un stock multi-emplacements exige un ADR supersédant.

## Ce que ce skill ne couvre pas (déférer)

- Mécanique de migration / versioning / REVOKE / regen des types → skill `db-migrations`.
- Écritures comptables, mapping COA, période fiscale, clôture → skill `accounting`.
- RBAC, conception d'un gate de permission, RLS → skill `security-auth`.
- Cycle de vie des commandes, void/refund côté métier commande → skill `orders`.
- Catalogue produit, variantes, `is_display_item` → skill `products-catalog`.
