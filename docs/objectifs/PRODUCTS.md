# Module Products & Catalogue — Objectif métier

> **Version** : 2026-07-23 (rev. 2) — fiche alignée sur la livraison complète
> des chantiers ADR-007 (déc. 2 à 6) et ADR-011 (déc. 1 à 4 + micro-fixes §3),
> PRs #251-#265, migrations `_199` à `_206`. Première version : 2026-07-17.
> **Hiérarchie** : le code fait foi sur l'état actuel ; ce document décrit ce qui
> est VOULU. Contraintes actées : [ADR-004](../adr/004-pas-de-peremption-ni-fifo-stock.md)
> (pas de FIFO/péremption), [ADR-005](../adr/005-juridiction-fiscale-lombok-pbjt.md)
> (fiscalité), [ADR-006](../adr/006-settings-socle-business-config-perimetre.md)
> (périmètre Settings), [ADR-007](../adr/007-domaine-produits-catalogue.md)
> (périmètre et décisions du domaine),
> [ADR-011](../adr/011-durcissements-domaine-produits-post-audit.md)
> (durcissements post-audit 2026-07-22 : import ADMIN+, refus parents au
> money-path, Realtime catalogue, versioning RPC durci, suppression allergènes).

---

## 1. Raison d'être

Le catalogue est le **référentiel de ce qui est vendable** : produits, catégories,
variantes, modifiers, combos, recettes et semi-finis (SFG), et leur costing.
Tout le reste du système le consomme : le POS l'affiche, le money-path le prix,
la production le compose, les rapports le valorisent.

Frontière avec Inventory (ADR-007, décision 1) : PRODUCTS définit *ce qui est
vendable et comment c'est composé/coûté* ; INVENTORY définit *ce qui est possédé
et comment ça bouge*. Les recettes appartiennent au catalogue ; leurs effets de
stock au ledger.

## 2. État réel (audits 2026-07-17 et 2026-07-22, chantiers livrés 2026-07-22/23) — synthèse

### 2.1 Sain et confirmé
- Socle CRUD par RPCs versionnées (`create/update_product_v2`, 6 RPCs variantes,
  `upsert_product_modifiers_v1`, `upsert_recipe_v1`, `upsert/delete_section_v1`,
  `set_product_is_test_v1`…), permissions par onglet.
- Import/export catalogue : `import_catalog_v1` avec **dry-run + commit +
  idempotence** ; `export_catalog_v1`. Réservé **ADMIN+** depuis ADR-011 déc. 1
  (le payload d'import sait créer des variantes, gate aligné sur
  `products.variants.write`).
- **Money-path** : `complete_order_with_payment_v19` refuse strictement les
  produits inactifs, soft-deleted et les **parents de variantes** (composants
  combo inclus) — ADR-007 déc. 2 + ADR-011 déc. 2, erreurs propagées jusqu'au
  message caissier.
- **Fraîcheur POS** : souscription Realtime sur `products`/`categories`
  (`useCatalogRealtime`, ADR-011 déc. 3) — un changement BO se propage en
  push < 2 s ; la garde serveur v19 reste le seul filet opposable.
- **Snapshots de vente** : les commandes vivent sur `order_items.name_snapshot`
  (etc.) — l'historique est insensible aux renommages/suppressions du catalogue.
- Routage cuisine : `dispatch_stations` → `_resolve_dispatch_stations_v1`
  (snapshot KOT).
- Marge : `target_gross_margin_pct` + cron d'alertes ; caveat connu — la marge
  est valorisée au **WAC courant**, pas au coût du moment de la vente.
- Intégrité données vérifiée au 2026-07-22 : XOR variantes, SKU global,
  cohérence display-stock — 0 anomalie.

### 2.2 Écarts identifiés par les audits — tous soldés
- ✅ Money-path aveugle à `is_active` → **v19 livré** (PR #255, migration `_201`).
- ✅ Écran Sections hors pattern RPC → **`upsert/delete_section_v1` + policies
  d'écriture directe droppées** (PR #265, migration `_206`) — la RPC est
  l'unique chemin d'écriture.
- ✅ Fenêtre horaire combos fantôme → **retirée du formulaire, colonnes
  `COMMENT DEPRECATED`** (PR #262, `_203`) ; DROP différé au prochain bump
  fonctionnel d'`upsert_combo` (qui les écrit encore à null).
- ✅ `products.tax_inclusive` colonne morte → **DROP** (PR #263, `_204`).
- ✅ `is_test` lu-jamais-écrivable → **toggle fiche produit ADMIN+** via
  `set_product_is_test_v1` + permission `products.test_flag.update`
  (PR #264, `_205`).
- ✅ Allergènes → **feature entièrement supprimée** (ADR-011 §2, PR #251,
  `_199`) — voir §6.
- ✅ Micro-fixes ADR-011 §3 (PR #260) : auto-pick d'un variant épuisé bloqué,
  caches catégories invalidés, mock `SAMPLE_SECTIONS` retiré, confirmation
  avant suppression de variante, onglet Modifiers deep-linkable.

## 3. Invariants voulus (opposables)

1. **Le serveur est seul juge de la vendabilité et du prix.** Aucune donnée
   catalogue transmise par le client (prix, flags, composition) ne fait foi —
   le money-path résout tout côté serveur. [Livré : v19 refuse inactifs,
   soft-deleted ET parents de variantes (ADR-007 déc. 2 + ADR-011 déc. 2) ;
   `visible_on_pos` reste un filtre d'affichage ; le stock épuisé reste toléré
   serveur (vente offline / replay). La fraîcheur Realtime du POS est un
   confort d'affichage, jamais une garantie.]
2. **Toute écriture catalogue passe par une RPC versionnée et auditée.** Aucune
   écriture directe de table depuis l'UI. [Livré : Sections rapatriées sous
   RPC, policies d'écriture directe droppées — déc. 5.]
3. **Un seul mécanisme par concept.** Fenêtres horaires → promotions ;
   mode fiscal → `business_config` ; prix B2B → résolution serveur
   (négocié > catégorie > retail). Pas de doublon dormant. [Livré — déc. 3 et 4.]
4. **L'historique des ventes survit au catalogue.** Les snapshots de commande
   restent la source ; supprimer/renommer un produit ne réécrit jamais le passé.
5. **Un champ existe s'il est lu.** Tout champ écrit-jamais-consommé est un bug
   de périmètre : on le branche ou on le retire — on ne le laisse pas dormir.

## 4. Périmètre

**Dans le module** : produits (39 colonnes, cycle de vie, soft-delete), catégories
(CRUD + réordonnancement), variantes (parent/enfant, 6 RPCs), modifiers par
produit, combos (builder, pricing serveur `_resolve_combo_price_v1`), recettes &
SFG (versions, duplication, conversion baker→absolu, `is_semi_finished` calculé
par trigger), costing (`update_cost_price_v1`, WAC, cible de marge),
import/export, dashboard produit.

**Hors module** : quantités et mouvements de stock (→ INVENTORY), prix négociés
clients (→ B2B), fenêtres promotionnelles (→ Promotions), fidélité (→ Loyalty),
mapping comptable (→ Accounting).

## 5. Backlog du module — à prioriser par le propriétaire

> Rev. 2026-07-23 : tous les chantiers ADR-007/ADR-011 sont livrés (voir §2.2).
> Restent les micro-arbitrages au fil de l'eau et les résiduels techniques.

| Prio | Item | Note |
|---|---|---|
| ⬜ | DROP `combo_available_from/to` | résiduel déc. 3 — au prochain bump fonctionnel d'`upsert_combo` (qui écrit encore null dedans) ; colonnes déjà `COMMENT DEPRECATED` |
| ⬜ | `combo_display_order` : appliquer le tri ou retirer le champ | micro |
| ⬜ | POS : cesser de sélectionner `wholesale_price` | micro, perf/clarté |
| ⬜ | `description` : brancher une sortie (ticket/écran client) ou acter interne | micro |
| ⬜ | Pill « Recipes » : vraie liste ou suppression | micro UX |
| ⬜ | Snapshot du coût à la vente (marge exacte vs WAC courant) | lourd — à ne rouvrir que si le besoin rapport l'exige |
| ⬜ | Validation boutique : Realtime catalogue + toggle `is_test` en conditions réelles | ferme la boucle des livraisons 2026-07-22/23 |

Livrés depuis la rev. 1 (référence, ne plus prioriser) : garde money-path
inactifs+parents [déc. 2, v19], Sections sous RPC [déc. 5], DROP `tax_inclusive`
[déc. 4], retrait fenêtre combos [déc. 3], toggle `is_test` [déc. 6], onglet
Modifiers deep-linkable, suppression allergènes [ADR-011 §2].

## 6. Ce que le module ne fait pas (limites assumées)

- **Pas d'allergènes.** Feature entièrement supprimée le 2026-07-22 (ADR-011 §2,
  PR #251, migration `_199` : colonne, vue, enum, UI BO/POS). Pas un besoin
  métier, et son écriture BO était la seule écriture catalogue hors RPC. **Ne
  pas rebâtir** — les notes libres de commande couvrent le cas client.
- Pas d'écran « product types » : la classification est dérivée côté client
  (`classifyProduct`) — suffisant, pas un manque.
- Pas de catalogue de modifiers partagés entre produits
  (`product_modifiers.category_id` existe en base mais sans UI) — à ne rouvrir
  que sur besoin réel.
- Pas de gestion de péremption/lots (ADR-004) — `default_shelf_life_hours` sert
  l'étiquetage display, pas un FIFO.

## 7. Résumé en une phrase

Le catalogue dit ce qui est vendable, comment c'est composé et ce que ça coûte ;
le serveur en est le seul juge, l'historique des ventes n'en dépend jamais, et
aucun champ n'y dort sans lecteur.
