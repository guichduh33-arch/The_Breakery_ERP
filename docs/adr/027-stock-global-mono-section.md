# ADR-027 — Stock global mono-section : suppression de la dimension section du stock

> **Date :** 2026-08-16 · **Statut : ACTÉ** (décision propriétaire 2026-08-16, direction annoncée le 2026-08-05 ; commit du texte après validation)

## Décision

Le stock revient à un modèle **mono-emplacement** : `products.current_stock`, alimenté par
le ledger `stock_movements`, est l'**unique** niveau de stock. La dimension « section »
du stock est supprimée : cache par section, transferts internes, choix de section à
l'inventaire (opname), à la réception d'achat et à la production, filtres de section des
rapports.

La table `sections` **survit uniquement comme registre des stations de production**
(routage de la page Production et affectation produit↔station via `product_sections`).
Elle ne porte plus aucune sémantique de stock.

## Contexte

- Le multi-section promettait de la précision et a produit l'inverse, mesuré deux fois :
  - **2026-08-05, croissant CLV-007** — 105 comptés physiquement ; la section passe à 105
    mais le stock global (celui qui fait autorité) passe de 92 à **87** : l'opname
    sectionné a éloigné le stock de la réalité, et l'écart de 18 a survécu au comptage.
  - **2026-08-16, Matcha Powder** — stock global 48, caches de section totalisant 512
    (497 + 15) ; un opname sur une section à 0 rend expected 0 / compté 0 / variance 0 :
    aucun effet, le comptage est structurellement impuissant.
- Cause racine : la vente, la perte et l'ajustement sont exempts de section — ils
  décrémentent le global sans toucher `section_stock`. Le cache par section diverge donc
  mécaniquement, et tout ce qui se calcule contre lui (expected d'opname, low-stock par
  section, écrans par section) est faux.
- La complexité induite est réelle : sélecteurs de section bloquants sur trois
  formulaires (réception PO, achat direct, production), une feature transferts entière,
  un CHECK dédié sur le ledger — pour une précision négative.

## Arbitrages (propriétaire, 2026-08-16)

1. **Table `sections`** : conservée comme registre de stations de production. Pas de
   migration vers une table dédiée.
2. **Transferts internes** : la feature **et ses tables** (`internal_transfers`,
   `transfer_items`) sont supprimées. La perte de l'historique de transfert est assumée ;
   les mouvements `transfer_in`/`transfer_out` du ledger, eux, restent (append-only),
   leurs `reference_id` devenant des références mortes.
3. **Opname** : devient global dans ce chantier — l'attendu se lit sur
   `products.current_stock`, la finalisation corrige le stock qui fait autorité.
4. **Rapport Stock Variance** : refondu dans ce chantier (voir conséquence 7).

## Conséquences

1. **`section_stock` est droppée** (cache dérivé, documenté recalculable depuis le
   ledger), avec la vue `view_section_stock_details`. `stock_locations` (inutilisée) et
   `stock_reservations.section_id` (nullable, sans gate) partent dans le même chantier.
2. **Transferts** : RPCs `create/receive/cancel_internal_transfer` droppées, permissions
   `inventory.transfer.*` retirées, tables droppées, UI retirée (pages, nav, palette).
3. **Ledger** : `stock_movements.from_section_id`/`to_section_id` sont **conservées pour
   l'historique** et ne sont plus jamais alimentées. Les CHECK
   `chk_stock_movements_section_required` et `chk_stock_movements_transfer_both_sections`
   sont droppés. La primitive d'écriture perd son bloc d'entretien de `section_stock`
   (bump, versioning monotone — tous les appelants suivent).
4. **Opname global** : famille de RPCs bumpée — création sans section, `expected_qty`
   chargé depuis `products.current_stock` à l'ajout de la ligne, finalisation sans
   section. `inventory_counts.section_id` devient nullable ; l'historique des comptages
   garde sa section d'époque. Le comptage à l'aveugle (masquage avant validation) est
   conservé tel quel.
5. **Production** : les stations restent l'axe de la page Production ;
   `production_records.section_id` continue de porter la **station** (donnée de routage,
   pas de stock). Les RPCs de production bumpent pour cesser de passer des sections aux
   mouvements de stock ; le gate `section_required` sur les mouvements tombe avec le
   CHECK. La décision ADR-008 D4 (production bloquante, forçage gaté) est inchangée.
6. **Réception d'achat et achat direct** : le paramètre de section disparaît des RPCs
   (bumps) et les sélecteurs « Receive into » disparaissent des formulaires. Une
   réception ne demande plus aucun choix d'emplacement.
7. **Rapport Stock Variance refondu.** Constat : dans un système où toutes les
   variations passent par le ledger, `current = ouverture + flux` par construction —
   l'ancienne « variance » (current − flux net, sans ouverture) ne mesurait rien. Le
   rapport devient un état de **démarque constatée** sur la fenêtre : ouverture
   reconstruite, entrées (achats/production), sorties de vente, pertes déclarées,
   **corrections d'inventaire** (`opname_*`, `adjustment*`) — ces corrections étant,
   une fois l'opname global livré, la mesure réelle de l'écart entre théorie et
   étagère. Sans filtre de section.
8. **Lectures** : `get_low_stock` ne garde que le mode global ; les RPCs de lecture des
   mouvements perdent leurs filtres de section (les colonnes de section restent
   affichables sur les lignes historiques).
9. **Sections hors production** (warehouse/sales) : **soft-delete** (`deleted_at`) — le
   hard delete est impossible, le ledger historique les référence (FK RESTRICT). L'écran
   CRUD Sections se recentre sur les stations de production.
10. Types régénérés (`types.generated.ts`), tests pgTAP/vitest amendés, gardes CI au vert.

## Hors périmètre

- **Seaux comptables 1141/1142/1143** choisis par type de mouvement et non par nature de
  produit (constat du 2026-08-05, soldes aberrants) : chantier comptable distinct, à
  cadrer séparément.
- **Vitrine POS** (`display_stock`/`display_movements`) : déjà isolée et sans section,
  inchangée.
- **Plan de salle POS** (`table_sections`) et `accounts.cash_flow_section` : homonymes,
  aucun lien.

## Réversibilité

Réintroduire un stock multi-emplacements exigerait un nouvel ADR supersédant celui-ci.
Gestes de retour disponibles : l'historique sectionné du ledger survit intégralement
(colonnes conservées), et un cache par section serait recalculable depuis ce ledger pour
la période antérieure au présent ADR. Gestes perdus : l'historique des transferts
internes (tables droppées, arbitrage 2 assumé) ; les mouvements postérieurs au présent
ADR ne portent aucune section et ne pourront jamais être ventilés rétroactivement.
