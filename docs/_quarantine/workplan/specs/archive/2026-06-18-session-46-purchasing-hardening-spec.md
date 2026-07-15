# Session 46 — Spec : Purchasing Hardening (page Backoffice Achats)

> Statut : **DRAFT** — à valider avant exécution.
> Branche : `swarm/session-46` (base `master` @ `80cfaba`, post-merge PR #93/#92/#91 costing).
> Type : **DB-heavy + Backoffice UI**. NAME-block migrations `20260701000010..` (prior max NAME `20260630000024` à re-vérifier `list_migrations` à l'exécution), 2 nouvelles perms (`purchasing.po.pay`, `purchasing.po.edit`), 1 nouvelle table (`purchase_payments`), 1 ALTER (`purchase_order_items`), types regen.

## 1. Contexte

Audit de la page **`/backoffice/purchasing`** (bons de commande fournisseurs). Le module Achats livré S13 (`docs/reference/04-modules/`) couvre create → receive → cancel, mais l'usage réel a remonté **4 manques** côté gestionnaire :

| # | Manque | État actuel | Symptôme |
|---|--------|-------------|----------|
| R1 | **Picker produit = matières premières uniquement** | `useAllProductsForPO` liste **tous** les produits actifs (`is_active=true`, `deleted_at IS NULL`), aucun filtre catégorie | un PO peut commander un produit fini ou semi-fini chez un fournisseur — non-sens métier |
| R2 | **Unité = liste contrainte** valide pour le produit choisi | input texte libre (16 car max) dans `POFormDraft.tsx:276-283`, pré-rempli depuis `products.unit` (`:124-130`) | saisie d'une unité incohérente → stock faussé à la réception (pas de conversion) |
| R3 | **Étape paiement traçable et INDÉPENDANTE de la réception** | **aucun** suivi de paiement ; le badge PAID/UNPAID est **dérivé** de la réception + `payment_terms` | impossible de saisir un acompte, un paiement partiel, ou de tracer *quand/comment* on a payé ; la dette n'a pas d'existence comptable propre |
| R4 | **Bon de commande éditable** par un utilisateur autorisé | bouton **Edit inerte** ; aucune RPC `update_purchase_order_v1`, aucune permission d'édition | une erreur de saisie (quantité, prix, fournisseur) ne se corrige pas — il faut annuler + recréer |

**Vérifié live DB V3 dev + code** (à citer) :
- Picker : `apps/backoffice/src/features/purchasing/hooks/useAllProductsForPO.ts` — `from('products').select('id,sku,name,unit,cost_price').is('deleted_at',null).eq('is_active',true)` sans jointure catégorie.
- Unité : `POFormDraft.tsx` ~`276-283` (input libre) + défaut `products.unit` ~`124-130`.
- PO tables : `purchase_orders` (statuts `draft/pending/partial/received/cancelled` ; `payment_terms cash/credit` ; `subtotal/vat_amount/total_amount` ; `received_date/received_by/cancelled_*` ; **pas** de colonne `payment_status`), `purchase_order_items` (`quantity, received_quantity, unit` texte libre, `unit_cost`), `goods_receipt_notes` (`received_date, received_by, grn_number` — l'INSERT déclenche `trg_create_purchase_je`).
- RPCs existantes (toutes SECURITY DEFINER, gate `has_permission`) : `create_purchase_order_v1` (`purchasing.po.create`, migr `20260517000111`), `receive_purchase_order_v1` (`purchasing.po.receive`, migr `20260517000112`, appelle `record_stock_movement_v1`), `cancel_purchase_order_v1` (`purchasing.po.cancel`, migr `20260517000114`). Trigger `create_purchase_journal_entry()` attaché via `20260517000113`, dernière version `20260603000012`.
- Perms existantes : `purchasing.po.{read,create,receive,cancel}` (MANAGER/ADMIN/SUPER_ADMIN).

## 2. Décisions déjà actées avec l'owner (NE PAS rouvrir)

| ID | Sujet | Décision |
|----|-------|----------|
| **D1** | Définition « matière première » | Filtre sur **`categories.category_type = 'raw_material'`** — colonne **réelle et peuplée** : **172** produits raw-material actifs sur 14 catégories (vs 58 semi_finished, 125 finished). **Pas** de nouveau `product_type`, **pas** de backfill. ⚠️ Le badge « Raw Material » de la page Products est **présentation-only**, dérivé du préfixe SKU (RAW/CON/HAS) via `classifyProduct` (`apps/backoffice/src/features/products/types.ts:93`) — **non fiable** (ne tague que 23 produits) et **NE DOIT PAS** servir ; `category_type` fait autorité. La correction du badge SKU est **hors scope** (juste notée). |
| **D2** | Modèle paiement | **Ledger append-only de paiements partiels** : nouvelle table `purchase_payments`, miroir du pattern `b2b_payments` (S24). Statut dérivé `unpaid/partial/paid` en comparant `SUM(payments)` au total PO. Nouvelle perm `purchasing.po.pay`. RPC `record_po_payment_v1` avec **idempotency flavor 2** (clé dédiée, S25) + REVOKE pair canonique. |
| **D3** | Périmètre d'édition | **Édition complète** (header + lignes), gate nouvelle perm `purchasing.po.edit`, via RPC atomique `update_purchase_order_v1`. Édition autorisée **uniquement** si `status='pending'` ET aucun GRN ET aucun paiement enregistré. Recalcule les totaux. |
| **D4** | Comptabilité (double-entrée propre) | La réception poste **`DR INVENTORY_GENERAL / CR PURCHASE_PAYABLE` TOUJOURS** (la dette naît à la réception). Le paiement poste une JE **séparée** `DR PURCHASE_PAYABLE / CR <cash/banque>`. Pour les POs `payment_terms='cash'`, **auto-enregistrer un paiement à la réception** (préserve « payé immédiatement », garde le ledger universel). **Garde la fold-VAT NON-PKP** (ADR-003) mais change la branche cash : au lieu de créditer `PURCHASE_CASH_OUT` directement, passer par AP + une JE de paiement. |
| **D5** | Conversion d'unité à la réception | La ligne PO porte `unit` + `unit_factor_to_base` ; `receive_purchase_order_v1` est bumpé **→ v2** pour convertir `received_qty × factor_to_base` en unités de base avant d'appeler `record_stock_movement_v1` (le stock reste en unité de base). Unités valides par produit = base (`products.unit`) ∪ `product_unit_alternatives.code` ∪ `product_unit_contexts.purchase_unit`. |
| **D6** | Verrou d'édition | Le PO se **re-verrouille** dès le 1er GRN OU le 1er paiement (header + lignes figés). |

## 3. Périmètre (les 4 exigences)

### R1 — Picker matières premières uniquement (D1)
- **DB** : aucune migration nécessaire — le contrat est `categories.category_type = 'raw_material'`. Documenter le contrat (Wave A1, doc-only).
- **Front** : `useAllProductsForPO` joint `categories` et filtre `category_type='raw_material'` (PostgREST inner-join embed ou jointure côté requête). Les produits sans catégorie ou hors raw-material disparaissent du picker.

### R2 — Unité contrainte par produit (D5)
- **DB** : `ALTER purchase_order_items ADD COLUMN unit_factor_to_base NUMERIC NOT NULL DEFAULT 1` (optionnel : colonne calculée/stockée `base_quantity = quantity * unit_factor_to_base`).
- **DB** : bump `receive_purchase_order_v1 → v2` (conversion facteur avant `record_stock_movement_v1`).
- **Front** : `<select>` contraint alimenté par un nouveau hook `useProductPurchaseUnits(productId)` qui agrège `products.unit` (base, factor 1) ∪ `product_unit_alternatives` (code + factor_to_base) ∪ `product_unit_contexts.purchase_unit`. Le draft de ligne stocke `unit` + `unit_factor_to_base` résolu depuis l'option choisie. Défaut = `purchase_unit` du contexte si présent, sinon base unit.

### R3 — Paiements traçables et indépendants (D2 + D4)
- **DB** : nouvelle table `purchase_payments` (append-only, REVOKE UPDATE/DELETE) : `id, purchase_order_id, amount, method, paid_at, paid_by, reference, idempotency_key UNIQUE, created_at`. Statut dérivé `unpaid/partial/paid` calculé par comparaison `SUM(amount)` vs `purchase_orders.total_amount`.
- **DB** : RPC `record_po_payment_v1(p_po_id, p_amount, p_method, p_reference, p_idempotency_key)` SECURITY DEFINER — gate `purchasing.po.pay`, insère dans le ledger (idempotency flavor 2), poste la JE paiement `DR PURCHASE_PAYABLE / CR <cash/banque>`, audit `po.payment_recorded`, REVOKE pair.
- **DB** : redesign `create_purchase_journal_entry()` — AP-always + émetteur JE de paiement séparé (garde la VAT-fold) + auto-paiement sur termes cash à la réception.
- **Front** : section Payments + dialog Record-Payment + badge statut paiement **indépendant** sur la page détail PO ; hooks `usePoPayments(poId)` + `useRecordPoPayment()`.

### R4 — Édition autorisée (D3 + D6)
- **DB** : RPC `update_purchase_order_v1(p_po_id, p_patch JSONB)` SECURITY DEFINER atomique — gate `purchasing.po.edit`, **lock** si GRN OU paiement existe (P0001 `po_locked`), recalcule `subtotal/vat_amount/total_amount`, audit `po.updated`, REVOKE pair.
- **Front** : câbler le bouton Edit → `POFormDraft` en mode édition (gate `purchasing.po.edit`) ; hook `useUpdatePurchaseOrder()`.

## 4. ADR-style note — changement comptable (référence ADR-003 NON-PKP)

Le trigger `create_purchase_journal_entry()` actuel (`20260603000012`) :
- **Garde** : la TVA fournisseur est **foldée dans `INVENTORY_GENERAL`** (ADR-003, statut NON-PKP — pas de PPN input récupérable, `PURCHASE_VAT_INPUT`/compte 1151 désactivé). **Inchangé.**
- **Change** : pour les termes `cash`, l'ancien trigger crédite **`PURCHASE_CASH_OUT` directement** (la dette n'existe jamais). Le redesign poste **toujours** `DR INVENTORY_GENERAL / CR PURCHASE_PAYABLE` à la réception (la dette naît), puis une **JE de paiement séparée** `DR PURCHASE_PAYABLE / CR PURCHASE_CASH_OUT` (auto pour les termes cash).

**Justification** : rendre le paiement traçable et indépendant (R3) exige que la dette ait une existence comptable propre — sinon un paiement partiel ou un acompte n'a rien à débiter. Le ledger AP devient universel (cash et credit passent par le même chemin), ce qui aligne Achats sur le pattern B2B AR (S24).

## 5. Open questions — RÉSOLUES (vérifié live DB V3 dev, 2026-06-18)

1. **Compte de crédit de la JE de paiement.** ✅ Résolu. La table de mapping est `accounting_mappings` (`mapping_key`→`account_code`, via `resolve_mapping_account`). Débit paiement = `PURCHASE_PAYABLE` → **2141** Accounts Payable. Crédit paiement **selon `p_method`** : `cash` → `PURCHASE_CASH_OUT` → **1110** Cash on Hand ; `transfer`/`bank` → **1112** Bank - Operating (mappings existants `CASH_MOVEMENT_BANK`/`B2B_PAYMENT_BANK` pointent déjà 1112). **Décision** : Wave A seede un mapping dédié **`PURCHASE_PAYMENT_BANK` → 1112** (propre, pas de réutilisation d'une clé B2B), et `record_po_payment_v1` mappe `cash→PURCHASE_CASH_OUT`, sinon `→PURCHASE_PAYMENT_BANK`.
2. **Backfill des POs cash déjà reçus.** ✅ **Sans objet.** La base V3 dev ne contient **aucun PO `payment_terms='cash'`** (seulement 4 POs credit : 1 pending, 3 received). Les POs credit reçus postent déjà correctement `CR PURCHASE_PAYABLE` sous le trigger actuel → ils s'affichent « unpaid » à juste titre (credit non payé), ledger paiement vide = cohérent. **Aucune migration de backfill.** Le redesign ne change concrètement que la branche cash (zéro donnée historique) + ajoute le chemin JE de paiement.

## 6. Hors scope (backlog S47+)

- Correction du badge SKU « Raw Material » présentation-only (`classifyProduct`, ne tague que 23 produits) — la page Products n'est pas touchée ici.
- Split multi-compte banque-vs-cash au-delà de la réutilisation des mapping keys existants (un seul compte de crédit si l'open-question #1 ne tranche pas pour le split).
- Backfill des JE historiques si déféré (open-question #2 option b).
- Multi-devise fournisseur.
- Annulation / void / reversal d'un paiement partiel (le ledger reste append-only ; un paiement erroné = correction par écriture inverse future, hors scope S46).

## 7. Critères d'acceptation

### R1 — Picker raw-material
1. `useAllProductsForPO` ne renvoie que les produits `category_type='raw_material'` (172 attendus en V3 dev) ; un produit fini/semi-fini n'apparaît plus dans le picker.
2. Le contrat `category_type` est documenté ; le badge SKU n'est **pas** utilisé.

### R2 — Unité contrainte + conversion
3. Le champ unité est un `<select>` borné aux unités valides du produit (base ∪ alternatives ∪ purchase_unit) ; plus de texte libre.
4. La ligne PO persiste `unit` + `unit_factor_to_base`.
5. `receive_purchase_order_v1 v2` convertit `received_qty × factor_to_base` en unités de base avant `record_stock_movement_v1` — le stock reste en unité de base (pgTAP balance).

### R3 — Paiements traçables et indépendants
6. `purchase_payments` est append-only (REVOKE UPDATE/DELETE) ; `record_po_payment_v1` gated `purchasing.po.pay`, idempotent (replay → même résultat), audité.
7. Le statut paiement (`unpaid/partial/paid`) est dérivé du ledger, **indépendant** de la réception.
8. La réception poste `DR INVENTORY_GENERAL / CR PURCHASE_PAYABLE` ; le paiement poste `DR PURCHASE_PAYABLE / CR <cash/banque>` ; **JE équilibrée (balance < 1 IDR)** ; VAT-fold NON-PKP préservée ; auto-paiement sur termes cash à la réception.

### R4 — Édition autorisée
9. `update_purchase_order_v1` gated `purchasing.po.edit`, **rejette** (P0001 `po_locked`) si GRN OU paiement existe, recalcule les totaux, audité.
10. Le bouton Edit est fonctionnel et conditionnel à `purchasing.po.edit` ; un PO verrouillé (reçu/payé) n'est pas éditable.

### Transverse
11. 2 perms seedées (`purchasing.po.pay`, `purchasing.po.edit`) ; REVOKE pairs canoniques sur les 3 nouvelles/bumpées RPCs ; types regen + commit.
12. pgTAP cloud (conversion, idempotency + statut dérivé, double-entrée balance < 1 IDR, gate édition + lock GRN/paiement, REVOKE pairs) ; smokes BO ; pattern-guardian sur le diff ; typecheck 6/6 ; sweep BO sans nouvelle failure (baseline env-gated notée).
