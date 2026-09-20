# stock-management — modèle, contrats et repères

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Contexte et conventions
- Mental model — The Breakery stock flow
- Audit 2026-06-12 — fixes shipped + ledger conventions

Périmètre : inventaire et recettes du back-office, stock POS, domaine inventory/production et RPC/tests de stock. Consulter ce skill avant toute écriture de stock ; les questions de péremption/FIFO ou de stock par section se traitent selon les décisions existantes, pas comme des fonctionnalités à recréer.

# Stock Management — The Breakery ERP

> **Skill re-vérifiée contre le code et le schéma live le 2026-08-31.** Les faits ci-dessous
> ont été relevés à cette date sur V3 dev (`pg_proc`, `pg_constraint`, `pg_trigger`,
> `cron.job`, `information_schema`) et sur la migration au numéro le plus haut. Après cette
> date, la base fait foi, pas ce fichier.
>
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

**`AGENTS.md` is the source of truth** for project-wide patterns, and `docs/adr/` carries the decisions that govern this domain. This skill adds stock-specific mental model, audit checklists, and preventive guidance that neither carries.

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
