---
name: stock-management
description: >-
  Stock et production Breakery : réceptions, mouvements, WAC, recettes, semi-finis, pertes et opname. Avant toute écriture de stock ou audit de ces flux. Respecter les décisions excluant FIFO/péremption et stock par section.
---

# Stock Management — The Breakery ERP

Suivre quantité, unité, coût et trace sur le parcours demandé. Avant toute proposition, lire les décisions du modèle concerné ; avant une écriture, appliquer aussi la checklist préventive pertinente.

## Lecture proportionnée

Les règles d’CLAUDE.md restent applicables. Les liens ci-dessous sont conditionnels : ne pas charger tout le dossier ni tous les skills voisins. Réutiliser les lectures déjà faites dans la session ; rouvrir si le code ou le périmètre a changé.

| Quand lire | Ressource |
|---|---|
| Pour le contrat, le parcours ou la surface concernée ; avant toute modification de sa logique. | [modèle, contrats et repères](references/model.md) |
| Avant une modification et avant de conclure : sélectionner les contrôles du parcours, puis exécuter les tests requis par CLAUDE.md. | [contrôles et sources](references/verification.md) |

## Décisions à garder visibles

- ADR-004 : pas de péremption automatique ni FIFO de stock ; pertes déclarées. Ne pas rouvrir ce chantier, ni confondre avec le FIFO des règlements B2B.
- ADR-027 : stock global mono-emplacement ; pas de transferts internes ni de contrainte de section sur le ledger. Une station de production n’est pas un emplacement de stock.
- ADR-016 : arrêter la cascade au premier semi-fini suivi en stock ; seuls les intermédiaires non stockés se déplient.
- ADR-014 : pas de JE de réévaluation sur un changement de coût ; valorisation instantanée et grand livre peuvent diverger entre deux opnames.
- Lire les corps des ADR concernés avant de modifier ces parcours ; ne pas les déduire de leurs titres.

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

## Qualité de restitution

Répondre d’abord au problème demandé. Distinguer fait observé, intention métier et hypothèse ; ancrer les constats dans le code lu ou le résultat mesuré. Un ancien relevé n’est pas une preuve actuelle. Donner impact, correction ou décision attendue, vérification effectuée et limite éventuelle ; ne pas remplir des rubriques sans résultat utile. Une consigne de skill n’élargit pas l’autorisation donnée par Mamat.
