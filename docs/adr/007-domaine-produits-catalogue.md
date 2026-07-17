# ADR-007 — Domaine Produits/Catalogue : périmètre, garde-fous money-path, sort des champs morts

> **Date** : 2026-07-17
> **Statut** : 🟡 BROUILLON — décisions à trancher par le propriétaire, puis passer à ✅ Accepted
> **Décideurs** : propriétaire The Breakery (guichduh33)
> **Supersedes** : —
> **Contexte** : audit lecture-seule du domaine Produits/Catalogue (2026-07-17,
>   toutes les routes /products*, /categories, sections et recettes ; consommation
>   aval des 39 colonnes de `products` vérifiée code + migrations live).
>   Constat global : surface saine (import/export idempotent, snapshots de vente
>   insensibles au catalogue), mais 2 anomalies de gouvernance, 3 features
>   fantômes, et un périmètre jamais acté.

## 1. Décisions

> ✏️ Chaque décision ci-dessous propose des options. Barrer/supprimer ce qui n'est
> pas retenu, compléter, puis passer le statut à Accepted. Rien ici n'est décidé
> tant que ce bloc n'a pas été édité par le propriétaire.

1. **Découpe normative : DEUX fiches.** `docs/objectifs/PRODUCTS.md` (catalogue :
   produits, catégories, modifiers, variantes, combos, recettes/SFG, costing) et
   `docs/objectifs/INVENTORY.md` (ledger : quantités, opname, waste, transferts,
   ajustements — audit dédié à venir). Frontière : PRODUCTS définit *ce qui est
   vendable et comment c'est composé/coûté* ; INVENTORY définit *ce qui est
   possédé et comment ça bouge*. Les recettes/SFG appartiennent à PRODUCTS ;
   leurs effets de stock à INVENTORY.

2. **Garde-fou money-path sur produits inactifs/masqués — À TRANCHER.**
   Constat : `complete_order_with_payment_v18` vend un produit `is_active=false`
   ou `visible_on_pos=false` sans vérification ; ces flags ne sont que des filtres
   d'affichage.
   - **Option A (recommandation de l'audit)** : la RPC money-path refuse la vente
     d'un produit inactif (erreur explicite), avec règle claire pour le cas
     « désactivé entre ajout au panier et encaissement » : ______
     (ex. : refus + message caissier / tolérance si présent au panier avant T).
     `visible_on_pos` reste un filtre d'affichage pur (masqué ≠ invendable).
   - **Option B** : statu quo assumé (flags = affichage seulement), acté ici pour
     ne plus jamais re-poser la question.
   - **Décision** : ______
   - Si Option A : chantier money-path → RPC versionnée `_vN+1` + pgTAP obligatoires.

3. **Fenêtre horaire des combos (`combo_available_from/to`) — À TRANCHER.**
   Constat : écrite par le formulaire, appliquée nulle part (feature fantôme).
   Le happy-hour vit déjà dans `promotions` (ADR-006, décision 10 : fenêtres
   jours/horaires livrées et appliquées par `evaluate_promotions_v2`).
   - **Option A** : retirer les champs de l'UI combo (et déprécier les colonnes) —
     un seul mécanisme horaire dans le produit : les promotions.
   - **Option B** : appliquer réellement la fenêtre (POS + money-path) — assumer
     deux mécanismes horaires distincts (combo vs promo).
   - **Décision** : ______

4. **`products.tax_inclusive` : DROP formel — À CONFIRMER.**
   Constat : colonne morte (plus écrite depuis `_180`, zéro lecteur ; le mode
   fiscal est 100 % `business_config` → `_pb1_split_v1`, Lot 6a).
   - Proposition : DROP de la colonne en migration dédiée + regen types.
   - **Décision** : ______

5. **Écran Sections : rapatrier sous RPC — À CONFIRMER.**
   Constat : `useSectionsList.ts:51-85` écrit en direct sur la table `sections` —
   seul écran du domaine hors pattern RPC SECURITY DEFINER + audit_logs.
   - Proposition : CRUD sections via RPCs versionnées auditées, alignement sur le
     reste du module (petit chantier, hors money-path).
   - **Décision** : ______

6. **`is_test` : exposer l'écriture — À TRANCHER.**
   Constat : flag lu (filtres d'exclusion rapports) mais posable uniquement en SQL
   manuel — l'inverse d'un champ mort. La commande de test géante de S78
   (3,5 Mds IDR à purger des données) est exactement l'accident que ce flag évite.
   - **Option A** : toggle UI sur la fiche produit, permission admin/super-admin.
   - **Option B** : statu quo (SQL manuel), acté.
   - **Décision** : ______

## 2. Micro-arbitrages renvoyés au backlog de la fiche (pas de décision ADR)

- `combo_display_order` écrit-jamais-appliqué (tri POS réel : par nom).
- `wholesale_price` sélectionné/transporté par le POS sans usage (prix B2B résolu
  serveur) — le select POS peut l'abandonner.
- `description` produit : aucune sortie client réelle (seulement export + form
  combo) — brancher (ticket ? écran client ?) ou assumer interne.
- Pill « Recipes » = redirection en boucle vers /products (verrouillée par smoke
  test) — créer une vraie liste ou retirer la pill.
- Onglet Modifiers absent de VALID_TABS → non deep-linkable.
- `cost_price` = WAC courant sans snapshot à la vente : la marge
  (`get_gross_margin_by_product_v1`) est valorisée au coût du jour (caveat connu,
  déjà documenté — pas de chantier ouvert ici).

## 3. Ce qui est confirmé sain (aucune action)

- Import/export catalogue : dry-run + commit + idempotence.
- Snapshots de vente (`order_items.name_snapshot`…) : l'historique des ventes est
  insensible aux renommages/suppressions catalogue.
- Classification produit dérivée client (`classifyProduct`) : pas d'écran
  « product types » et ce n'est pas un manque — la donnée source suffit.
- Permissions par onglet (products.variants.write, products.modifiers.update…).

## 4. Conséquences

- La fiche `docs/objectifs/PRODUCTS.md` (même date) est alignée sur ces décisions.
- Les décisions 2 (si Option A) et 4 touchent schéma/money-path : migrations
  versionnées + pgTAP + regen types, specs courtes si besoin.
- L'audit INVENTORY (opname, waste, transferts, `stock_movements`) reste à mener —
  il produira la 2ᵉ fiche et, si nécessaire, son propre ADR.

## 5. Révision

Les décisions 2, 3 et 6 ne se rouvrent que par un nouvel ADR. Les items du §2
vivent au backlog de la fiche et se décident au fil de l'eau par le propriétaire.
