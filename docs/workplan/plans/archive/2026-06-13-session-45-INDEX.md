# Session 45 — INDEX : Products page — finir les actions catalogue (boutons morts)

> Branche : `swarm/session-45` (base `master` @ `b80e3d9`, post-merge S44 PR #81).
> Spec : [`../specs/2026-06-13-session-45-products-actions-spec.md`](../../specs/archive/2026-06-13-session-45-products-actions-spec.md) · Plan : [`2026-06-13-session-45-products-actions-plan.md`](2026-06-13-session-45-products-actions-plan.md).
> Méthode : subagent-driven TDD, spec-review + code-quality review par wave, pattern-guardian sur la migration, vérif live navigateur (playwright-cli), final review whole-branch.

## §1. Résultat

Ferme les **6 boutons morts** de `/backoffice/products` (audit live 2026-06-13). Objectif atteint : **zéro bouton mort restant**.

| Bouton | Avant | Après | Vérifié live |
|--------|-------|-------|--------------|
| Delete (ligne) | mort (ni handler, ni hook, ni RPC) | soft-delete réel (RPC + hook + dialog), affiché seulement si `products.delete` | ✅ dialog→confirm→disparaît + DB `deleted_at` + 1 audit |
| Edit pricing `$` (ligne) | mort | deep-link détail onglet General (`?tab=general`), affiché si `products.update` | ✅ onglet General actif |
| Import (pill) | mort | nav `/products/import-export`, **masqué** sans `catalog.import` | ✅ navigue |
| Recipes (pill) | mort | nav `/inventory/recipes` | ✅ navigue |
| Modifiers (pill) | mort | **retiré** (aucune destination) | ✅ absent |
| Products (pill) | no-op trompeur | `<span aria-current="page">` non-cliquable | ✅ plus un bouton |

## §2. Livrables

- **DB** : `delete_product_v1(UUID, UUID)` SECURITY DEFINER soft-delete (`is_active=false` + `deleted_at=now()`), gate `products.delete` (**perm pré-existante S13**, ADMIN+SUPER_ADMIN), garde parent-de-variantes (P0001), idempotent (replay sur `deleted_at`), audit `product.deleted`, REVOKE pair. **3 migrations** NAME-block `20260629000010` (RPC) + `_011` (REVOKE) + corrective `_012` (deleted_at). pgTAP **8/8** cloud. Types regen (signature additive).
- **Front** : `useDeleteProduct` + `DeleteProductDialog` ; `?tab=` param dans `ProductDetailPage` ; `ProductsTable` actions Delete/`$` conditionnelles aux handlers ; `ProductsHeader` Import conditionnel + Recipes + Modifiers retiré + Products neutralisé ; `Products.tsx` câble `canDelete`/`canEditPricing`/`canImport`.
- **Tests** : pgTAP 8/8 ; smokes BO neufs delete-dialog 7, table-delete-wiring 3, tab-param 4, table-pricing-wiring 3, header-pills 8 ; typecheck 6/6 ; sweep BO **535 pass / 1 skip** (5 flakes waitFor sous coverage+charge = baseline S42, verts en isolé).

## §3. Commits (branche)

`9069b90` Wave A RPC+pgTAP · `cd43926` corrective deleted_at · `4d935a9` Wave B delete UI · `6b943b7` Wave B hardening · `b00a20b` Wave C pricing · `bdffda8` docs spec+plan · `ac35a67` Wave D pills · `9a34efb` Wave D hide-Import fix.

## §4. Déviations (DEV-S45-*)

| ID | Sévérité | Description | Statut |
|----|----------|-------------|--------|
| DEV-S45-A-01 | **Medium** | Spec sous-spécifiait le soft-delete (`is_active=false` seul) ; or le catalogue filtre `deleted_at IS NULL` et affiche les inactifs → le produit ne disparaissait pas. Corrective `_012` ajoute `deleted_at` + replay guard sur `deleted_at`. Détecté par la spec-review Wave B. | **Fixé** |
| DEV-S45-A-02 | Info | REVOKE pair livrée en 5 lignes (GRANT authenticated + REVOKE PUBLIC/anon + ALTER DEFAULT PRIVILEGES ×2) au lieu des 3 canoniques — additif, défense en profondeur (pattern-guardian INFO). | Accepté |
| DEV-S45-A-03 | Info | Gate utilise ERRCODE `42501` message `permission_denied` (pattern projet `update_product_v1`), pas `insufficient_privilege` du draft. | Accepté |
| DEV-S45-C-01 | Info | `$` deep-link = lecture `?tab=` **une fois** au montage, pas de sync URL↔onglet bidirectionnelle (hors scope) → un refresh re-atterrit sur `?tab=general`. | Accepté |
| DEV-S45-D-01 | **Décision** | Pill Modifiers **retiré** (aucune page/route Modifiers dans le projet ; gestionnaire global = feature séparée). À valider owner — alternative : bouton désactivé « Bientôt ». | Acté (réversible) |
| DEV-S45-D-02 | Minor | Import pill **masqué** (pas désactivé) sans `catalog.import`, aligné sur le comportement de l'onglet `ProductsPageTabs`. Fix code-review Wave D. | **Fixé** |
| DEV-S45-PROC-01 | Info | MCP indisponible dans les subagents (cf. DEV-S41-A1-01) → `db-engineer` a appliqué les migrations via `supabase db query --linked` + insertion ledger manuelle ; le `test-engineer` n'a pas pu lancer le pgTAP. **Le contrôleur a vérifié en cloud via MCP** (body de fonction + pgTAP 8/8 ré-exécuté). | Process |
| DEV-S45-PROC-02 | Info | Des subagents ont créé à plusieurs reprises des fichiers 0-octet à la racine du repo (redirections shell mal échappées avec parenthèses/quotes). **Nettoyés par le contrôleur, jamais committés.** | Process |
| DEV-S45-E-01 | Info | Sweep BO sous `--coverage` + charge concurrente : ~5 flakes `waitFor` (inventory-kpi, inventory.smoke live-RPC ×2, journal-entries, product-detail-tab-param). **Tous verts en ré-exécution isolée** — baseline S42, zéro régression S45. | Baseline |

## §5. Hors scope (backlog S46+)

Page de gestion Modifiers globale ; dialog pricing inline multi-catégories ; bulk delete / restore / vue corbeille ; hard-delete ; tab-param générique sur les autres detail pages ; comment stale `useProducts.ts:5`/`useCombos.ts:4` (hors diff).

## §6. Reviews

Wave A : pattern-guardian **APPROVED** (14/14, 1 INFO) + pgTAP 8/8 ré-exécuté contrôleur. Wave B : spec-review ✅ + code-quality **APPROVED** + hardening. Wave C : review combinée **APPROVED**. Wave D : review **APPROVED** + fix M1. **Final whole-branch : APPROVED** (18 fichiers, zéro régression cross-wave, migration cohérente avec le filtre front).
