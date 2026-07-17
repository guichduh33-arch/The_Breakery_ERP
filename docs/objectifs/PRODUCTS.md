# Module Products & Catalogue — Objectif métier

> **Version** : 2026-07-17 — première fiche du domaine, issue de l'audit
> lecture-seule du 2026-07-17 (routes /products*, /categories, sections,
> recettes ; consommation aval des 39 colonnes de `products` vérifiée).
> **Hiérarchie** : le code fait foi sur l'état actuel ; ce document décrit ce qui
> est VOULU. Contraintes actées : [ADR-004](../adr/004-pas-de-peremption-ni-fifo-stock.md)
> (pas de FIFO/péremption), [ADR-005](../adr/005-juridiction-fiscale-lombok-pbjt.md)
> (fiscalité), [ADR-006](../adr/006-settings-socle-business-config-perimetre.md)
> (périmètre Settings), [ADR-007](../adr/007-domaine-produits-catalogue.md)
> (périmètre et décisions du domaine — ✅ accepté le 2026-07-17 : toutes les
> décisions citées dans cette fiche sont actées).

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

## 2. État réel (audit 2026-07-17) — synthèse

### 2.1 Sain et confirmé
- Socle CRUD par RPCs versionnées (`create/update_product_v2`, 6 RPCs variantes,
  `upsert_product_modifiers_v1`, `upsert_recipe_v1`…), permissions par onglet.
- Import/export catalogue : `import_catalog_v1` avec **dry-run + commit +
  idempotence** ; `export_catalog_v1`.
- **Snapshots de vente** : les commandes vivent sur `order_items.name_snapshot`
  (etc.) — l'historique est insensible aux renommages/suppressions du catalogue.
- Allergènes : propagation par recettes via `view_product_allergens_resolved`,
  affichés BO et POS.
- Routage cuisine : `dispatch_stations` → `_resolve_dispatch_stations_v1`
  (snapshot KOT).
- Marge : `target_gross_margin_pct` + cron d'alertes ; caveat connu — la marge
  est valorisée au **WAC courant**, pas au coût du moment de la vente.

### 2.2 Écarts identifiés (détail et arbitrages : ADR-007)
- 🔴 Money-path aveugle à `is_active`/`visible_on_pos` (vend un produit
  désactivé) — [ADR-007 déc. 2].
- 🔴 Écran Sections : écriture directe table, hors pattern RPC + audit —
  [ADR-007 déc. 5].
- 🟠 Features fantômes : fenêtre horaire combos jamais appliquée [déc. 3],
  `combo_display_order` jamais appliqué, `products.tax_inclusive` colonne morte
  [déc. 4].
- 🟠 `is_test` lu-jamais-écrivable (SQL manuel uniquement) — [déc. 6].
- 🟡 Pill « Recipes » en boucle morte ; onglet Modifiers non deep-linkable ;
  `wholesale_price` transporté par le POS pour rien ; `description` sans sortie
  client réelle.

## 3. Invariants voulus (opposables)

1. **Le serveur est seul juge de la vendabilité et du prix.** Aucune donnée
   catalogue transmise par le client (prix, flags, composition) ne fait foi —
   le money-path résout tout côté serveur. [Renforcé par ADR-007 déc. 2 :
   un produit inactif est invendable — refus strict au paiement, même si le
   produit était déjà au panier ; `visible_on_pos` reste un filtre d'affichage.]
2. **Toute écriture catalogue passe par une RPC versionnée et auditée.** Aucune
   écriture directe de table depuis l'UI. [Sections à rapatrier — déc. 5.]
3. **Un seul mécanisme par concept.** Fenêtres horaires → promotions ;
   mode fiscal → `business_config` ; prix B2B → résolution serveur
   (négocié > catégorie > retail). Pas de doublon dormant. [Déc. 3 et 4.]
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

> Issu de l'audit du 2026-07-17. Les décisions ADR-007 sont actées
> (2026-07-17) — les items marqués [ADR-007] sont des chantiers à lancer ;
> les autres se décident au fil de l'eau.

| Prio | Item | Note |
|---|---|---|
| ⬜ | Garde-fou money-path produits inactifs (refus strict) | [ADR-007 déc. 2] — RPC vN+1 + pgTAP |
| ⬜ | Rapatrier Sections sous RPC auditée | [déc. 5] |
| ⬜ | DROP `products.tax_inclusive` | [déc. 4] — migration + regen types |
| ⬜ | Fenêtre horaire combos : retirer de l'UI + déprécier les colonnes | [déc. 3] — un seul mécanisme horaire : les promotions |
| ⬜ | Toggle UI `is_test` (permission admin) | [déc. 6] |
| ⬜ | `combo_display_order` : appliquer le tri ou retirer le champ | micro |
| ⬜ | POS : cesser de sélectionner `wholesale_price` | micro, perf/clarté |
| ⬜ | `description` : brancher une sortie (ticket/écran client) ou acter interne | micro |
| ⬜ | Pill « Recipes » : vraie liste ou suppression | micro UX |
| ⬜ | Onglet Modifiers deep-linkable (VALID_TABS) | micro UX |
| ⬜ | Snapshot du coût à la vente (marge exacte vs WAC courant) | lourd — à ne rouvrir que si le besoin rapport l'exige |

## 6. Ce que le module ne fait pas (limites assumées)

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
