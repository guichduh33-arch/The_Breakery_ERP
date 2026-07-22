# ADR-011 — Domaine Produits : durcissements post-audit (permissions import, money-path, fraîcheur POS, versioning RPC)

> **Date** : 2026-07-22
> **Statut** : ✅ Accepted (2026-07-22)
> **Décideurs** : propriétaire The Breakery (guichduh33)
> **Supersedes** : — (complète ADR-007 sans la modifier)

## Contexte

Le 2026-07-22, un audit à l'aveugle du module products a été mené (3 reviewers indépendants BO/POS/DB + vérifications live sur V3 dev). L'intégrité des données est saine (XOR variants, SKU, display-stock : 0 anomalie) et les 19 RPCs catalogue sont correctement sécurisées (SECURITY DEFINER, search_path pinné, REVOKE pairs complets). L'audit a en revanche exposé quatre points de gouvernance qui n'avaient jamais été formellement décidés, et confirmé qu'aucun des chantiers ADR-007 (déc. 2 à 6) n'était encore livré.

## 1. Décisions

### Décision 1 — L'import catalogue devient ADMIN+

**Le constat** : `import_catalog_v1` est gaté sur la seule permission `catalog.import`, accordée à MANAGER. Or son payload permet de créer et modifier des **variantes**, alors que `products.variants.write` (qui gate `create_variant_v1`, `convert_product_to_parent_v1`, etc.) est réservé ADMIN/SUPER_ADMIN. Un MANAGER ne peut pas créer une variante à la main, mais peut le faire via un fichier d'import — une brèche du périmètre voulu.

**La décision** : la permission `catalog.import` est retirée au rôle MANAGER. L'import/export catalogue devient une opération ADMIN/SUPER_ADMIN, dans son intégralité. Aucune modification de la RPC : c'est un changement de seed `role_permissions` (migration dédiée), plus le masquage du bouton Import côté BO pour les rôles non autorisés (le gate UI existe déjà via `catalog.import`).

### Décision 2 — Le money-path refuse aussi les produits-parents

**Le constat** : ADR-007 déc. 2 (refus strict des produits inactifs au paiement) n'est pas encore livrée. L'audit a montré que la RPC de paiement courante ne vérifie pas non plus `parent_product_id` : un produit-PARENT — un groupement logique, jamais vendable par définition (architecture linked-products S27c) — peut être encaissé si le client l'envoie. La fenêtre de cache stale du POS (décision 3) rend ce chemin concret.

**La décision** : le chantier vN+1 de la RPC de paiement (ADR-007 déc. 2, dont le refus des inactifs reste acté et inchangé) embarque également le refus strict de tout produit ayant des enfants variants actifs, avec erreur explicite (« produit X est un groupe de variantes, sélectionnez une variante »). Le stock épuisé reste toléré côté serveur : la vente offline (hub LAN, cash différé) peut légitimement diverger du stock cloud au moment du replay.

**Conséquence technique** : chantier money-path — `_vN+1` + DROP de l'ancienne version dans la même migration, redéploiement des EFs consommatrices, pgTAP obligatoires (cas : inactif au panier, parent au panier, variant actif OK).

### Décision 3 — Le catalogue POS est rafraîchi par Realtime ; le serveur reste le filet dur

**Le constat** : le POS n'a aucune souscription Realtime sur `products`/`categories`. Entre une modification BO (conversion en parent, désactivation, masquage d'un variant) et le prochain refetch, l'écran caisse vend un catalogue périmé. Seul filet actuel : le refetch-on-focus de React Query, peu fiable sur un terminal plein écran.

**La décision** : le POS souscrit aux changements `postgres_changes` sur `products` et `categories` (nom de channel unique par mount, pattern `useKdsRealtime`) et invalide son cache catalogue à réception. Cette fraîcheur est un confort d'affichage, pas une garantie : **la garde serveur (décision 2) reste le seul filet opposable**, notamment en mode offline où l'écart est inévitable jusqu'au replay.

### Décision 4 — Versioning RPC : bump systématique, fin de la tolérance CREATE OR REPLACE

**Le constat** : la règle « jamais éditer une `_vN` publiée » a dévié en pratique : `create/update_product_v1` ont reçu trois `CREATE OR REPLACE` fonctionnels (ajouts de colonnes d'allowlist) sur trois mois avant d'être bumpées en v2 ; `create/update_category_v1` ont reçu deux ajouts de colonnes et sont toujours en v1.

**La décision** : tout changement fonctionnel d'une RPC publiée — ajout de colonne d'allowlist compris — exige un bump `_vN+1` avec DROP de l'ancienne version dans la même migration, sans exception. Le `CREATE OR REPLACE` sur version publiée est proscrit, y compris pour les bugfix. `create_category_v1`/`update_category_v1` passeront en v2 à leur prochaine modification (pas de bump à vide).

## 2. Enregistrement — suppression des allergènes (déjà livrée)

Pour mémoire, décision du même jour exécutée immédiatement : la feature allergènes est **entièrement supprimée** (PR #251 mergée, migration `20260722000199` appliquée — colonne `products.allergens`, vue `view_product_allergens_resolved`, enum `allergen_type`, UI BO/POS et primitif `AllergenBadge`). Motifs : pas un besoin métier (confirme le wontfix du 2026-05-17 en l'étendant), et son écriture BO était la seule écriture catalogue hors RPC, invisible d'`audit_logs`. La fiche `docs/objectifs/PRODUCTS.md` §2.1 est à purger de sa mention allergènes.

## 3. Micro-corrections renvoyées au backlog de la fiche (pas de décision ADR)

- POS : l'auto-pick d'un variant unique contourne le check sold-out (`VariantSelectModal`) — appliquer le même check que la tuile.
- BO : dropdowns catégories sur clé de cache non invalidée (stale 5 min) ; carte « Usage Sections » branchée sur des données factices `SAMPLE_SECTIONS` à retirer ; suppression de variante sans confirmation ni gestion d'erreur.
- `VALID_TABS` : onglet `modifiers` non deep-linkable (déjà au backlog ADR-007).

## 4. Conséquences

- Chantiers à lancer, par ordre : (a) seed `catalog.import` ADMIN+ [petit] ; (b) money-path vN+1 inactifs+parents + pgTAP + redéploiement EFs [lourd, prioritaire] ; (c) Realtime catalogue POS [moyen] ; les micro-fixes §3 au fil de l'eau.
- La fiche `docs/objectifs/PRODUCTS.md` est à mettre à jour : §2.1 (allergènes), §5 (nouveaux items backlog), invariant 1 (périmètre du refus serveur étendu aux parents).
- La règle de versioning durcie (déc. 4) vaut pour tout le repo, pas seulement le catalogue.

## 5. Révision

Les décisions 1 à 4 ne se rouvrent que par un nouvel ADR.
