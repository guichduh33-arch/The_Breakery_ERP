# 01 — Product Context

> **Last verified**: 2026-05-03

## The Breakery

**The Breakery** est une boulangerie artisanale française située à Lombok (Indonésie). AppGrav V2 est l'**ERP/POS production** qui gère l'ensemble des opérations : ventes au comptoir, commandes B2B (hôtels, cafés, restaurants partenaires), gestion stock, production, comptabilité Indonésienne, et reporting.

## Volumétrie cible

| Métrique | Valeur |
|---|---|
| Transactions / jour | ~200 |
| Utilisateurs simultanés | ~20 |
| Périphériques POS connectés | 1 hub + 4-6 clients (KDS, displays, tablettes) |
| Catalogue produits | ~150 SKU (pâtisserie, viennoiserie, salé, boissons) |
| Clients fidélité actifs | ~1500 |
| Comptes B2B | ~30 |
| Migrations DB cumulées | 223+ |

## Contraintes business

- **Online-only** : pas de mode offline POS (la connexion Internet du local est jugée fiable, le coût de complexité d'un offline-first n'est pas justifié à cette volumétrie).
- **Multi-device LAN** : un POS hub orchestre les KDS (cuisine), customer displays, tablettes serveur, et imprimantes thermiques sur le réseau local.
- **Anglais uniquement** : i18n est explicitement suspendue (toute la UI et les comptes sont en anglais). **Ne pas utiliser** `t()` ou `i18next`.
- **Conformité comptable indonésienne** : double-entry, SAK EMKM / SAK ETAP, taxe restaurant locale **PB1** (Pajak Restoran) **10% incluse** dans les prix. **Pas de PPN**, pas de reporting DJP automatisé.
- **Devise unique** : IDR (Indonesian Rupiah), arrondie à la centaine la plus proche (`round_idr`).
- **Tolérance aux pannes** : un POS hub down doit pouvoir être basculé manuellement vers un autre device en moins de 5 min (architecture LAN documentée dans [`06-lan-architecture/`](../06-lan-architecture/)).

## Politique tarifaire

Quatre tiers de prix par produit selon le client (voir [`04-modules/05-products-categories.md`](../04-modules/05-products-categories.md)) :

| Tier | Description |
|---|---|
| `retail` | Prix standard affiché au comptoir |
| `wholesale` | Prix B2B générique (`wholesale_price`) |
| `discount_percentage` | % de réduction appliqué au prix retail |
| `custom` | Prix négocié par catégorie de produit (`product_category_prices`) |

## Programme fidélité

| Tier | Seuil (points) | Discount |
|---|---|---|
| Bronze | 0 | 0 % |
| Silver | 500 | 5 % |
| Gold | 2000 | 8 % |
| Platinum | 5000 | 10 % |

**Calcul** : 1 point gagné par tranche de 1 000 IDR dépensés. Voir [`08-flows-end-to-end/07-loyalty-earn-redeem.md`](../08-flows-end-to-end/07-loyalty-earn-redeem.md).

## Types de commandes

`dine_in` · `takeaway` · `delivery` · `b2b`

## Stock alerts

| Niveau | Seuil |
|---|---|
| ⚠️ Warning | < 10 unités |
| 🚨 Critical | < 5 unités |

## Statut produit

V2 est **production-ready depuis 2026-03-23**. Une reconstruction V3 (Turborepo monorepo, micro-apps spécialisées par persona — caissapp, backoffice, kitchen, comptable) est en cours dans `breakery-platform/` (pipeline BMAD active depuis 2026-04-22). V2 reste en exploitation en parallèle pendant la migration progressive.

## Liens utiles

- Référence produit historique : [`docs/v2/APP_REFERENCE.md`](../../v2/APP_REFERENCE.md)
- État sprint et backlog vivant : [`CURRENT_STATE.md`](../../../CURRENT_STATE.md)
- Audit complet 2026-04-09 : [`docs/audit/00-executive-summary.md`](../../audit/00-executive-summary.md)
