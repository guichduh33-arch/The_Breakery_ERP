# Session 46 — INDEX : Purchasing Hardening (page Backoffice Achats)

> Statut : **À COMPLÉTER EN CLOSEOUT** — squelette pré-exécution.
> Branche : `swarm/session-46` (base `master` @ `80cfaba`, post-merge PR #93 costing).
> Spec : [`../specs/2026-06-18-session-46-purchasing-hardening-spec.md`](../specs/2026-06-18-session-46-purchasing-hardening-spec.md) · Plan : [`2026-06-18-session-46-purchasing-hardening-plan.md`](2026-06-18-session-46-purchasing-hardening-plan.md).
> Méthode : subagent-driven TDD, spec-review + code-quality review par wave, pattern-guardian sur les migrations, vérif live navigateur (playwright-cli) optionnelle, final review whole-branch.

## §1. Résultat

Durcit la page Achats `/backoffice/purchasing` sur 4 axes (à confirmer en closeout) :

| Exigence | Avant | Après | Vérifié |
|----------|-------|-------|---------|
| R1 — picker raw-material | tous les produits actifs | filtre `category_type='raw_material'` (172) | _(à remplir)_ |
| R2 — unité contrainte + conversion | input texte libre | `<select>` borné + `unit_factor_to_base` + `receive_v2` convertit | _(à remplir)_ |
| R3 — paiements traçables indépendants | aucun suivi (badge dérivé) | ledger `purchase_payments` append-only + `record_po_payment_v1` + JE AP/paiement séparées | _(à remplir)_ |
| R4 — édition autorisée | bouton Edit inerte | `update_purchase_order_v1` gated + lock GRN/paiement + bouton câblé | _(à remplir)_ |

## §2. Migrations appliquées

> NAME-block `20260701000010..` (prior max NAME `20260630000024` — re-vérifier `list_migrations` à l'exécution). Cloud versions clock-assignées (convention S36+).

| File timestamp | Cloud version | Object |
|----------------|---------------|--------|
| _(à remplir)_ | | `20260701000010` ALTER po_items + unit_factor_to_base |
| _(à remplir)_ | | `20260701000011` receive_purchase_order_v2 (+DROP v1) |
| _(à remplir)_ | | `20260701000012` purchase_payments table (append-only) |
| _(à remplir)_ | | `20260701000013` record_po_payment_v1 + REVOKE |
| _(à remplir)_ | | `20260701000014` redesign create_purchase_journal_entry (AP-always + cash auto-pay) |
| _(à remplir)_ | | `20260701000015` _(backfill cash POs — si option a)_ |
| _(à remplir)_ | | `20260701000016` update_purchase_order_v1 + REVOKE |
| _(à remplir)_ | | `20260701000017` seed perms pay/edit |

## §3. Nouveaux fichiers

- **DB + tests** : _(à remplir)_ — `po_receive_conversion.test.sql`, `po_payments.test.sql`, `po_je_double_entry.test.sql`, `po_update.test.sql`.
- **Hooks** : `useProductPurchaseUnits.ts`, `usePoPayments.ts`, `useRecordPoPayment.ts`, `useUpdatePurchaseOrder.ts`.
- **UI** : `RecordPaymentDialog.tsx`, section Payments + badge statut (PurchaseOrderDetailPage), `<select>` unité (POFormDraft).
- **Workplan** : ce trio spec/plan/INDEX.

## §4. Fichiers modifiés

- _(à remplir : `useAllProductsForPO.ts` filtre raw-material, `POFormDraft.tsx` select+edit, `PurchaseOrderDetailPage.tsx` payments+Edit, types.generated.ts regen, PermissionCode union, CLAUDE.md bump)._

## §5. Tests exécutés

| Suite | Count | Status |
|-------|-------|--------|
| pgTAP `po_receive_conversion` | _(à remplir)_ | |
| pgTAP `po_payments` | _(à remplir)_ | |
| pgTAP `po_je_double_entry` | _(à remplir)_ | |
| pgTAP `po_update` | _(à remplir)_ | |
| BO smokes (picker/unit/payments/edit) | _(à remplir)_ | |
| typecheck | 6 | _(à remplir)_ |
| sweep BO | _(à remplir)_ | _(baseline env-gated ~24 notée)_ |

## §6. Permissions seedées

- `purchasing.po.pay` — MANAGER / ADMIN / SUPER_ADMIN.
- `purchasing.po.edit` — MANAGER / ADMIN / SUPER_ADMIN.

## §7. RPCs added / bumped

| Action | RPC | Notes |
|--------|-----|-------|
| bump | `receive_purchase_order_v1 → v2` | conversion `factor_to_base` → base unit (DROP v1) |
| add | `record_po_payment_v1` | ledger append-only, idempotency flavor 2, JE paiement |
| add | `update_purchase_order_v1` | édition gated, lock GRN/paiement, recalcul totaux |
| redesign | `create_purchase_journal_entry()` (trigger) | AP-always + cash auto-pay + VAT-fold NON-PKP préservée |

## §8. Deferred S47+

1. Correction badge SKU « Raw Material » présentation-only (`classifyProduct`, 23 produits tagués).
2. Split multi-compte banque-vs-cash au-delà des mapping keys existants.
3. Backfill JE historiques (si open-question #2 tranchée option b).
4. Multi-devise fournisseur.
5. Annulation / void / reversal d'un paiement partiel (ledger append-only).

## §9. Déviations (DEV-S46-*)

> À remplir pendant l'exécution. Format : `DEV-S46-<wave>.<phase>-<nn>`.

| ID | Section | Original | What happened | Reason | Risk |
|----|---------|----------|---------------|--------|------|
| _(vide — à compléter)_ | | | | | |

## §10. Open questions résolues

| # | Question | Résolution |
|---|----------|------------|
| 1 | Compte de crédit JE paiement (`PURCHASE_CASH_OUT` seul vs split banque) | _(à remplir Wave A1)_ |
| 2 | Backfill POs cash historiques reçus | _(à remplir Wave A1 — option a / option b)_ |

## §11. Critères d'acceptation

- [ ] R1 — picker `category_type='raw_material'`, badge SKU non utilisé.
- [ ] R2 — `<select>` unité contraint + `unit_factor_to_base` + `receive_v2` conversion base unit.
- [ ] R3 — `purchase_payments` append-only + `record_po_payment_v1` gated/idempotent + JE double-entrée balance < 1 IDR + statut dérivé indépendant + auto-paiement cash.
- [ ] R4 — `update_purchase_order_v1` gated + lock GRN/paiement + recalcul + bouton Edit câblé conditionnel.
- [ ] 2 perms seedées + REVOKE pairs canoniques + types regen committés.
- [ ] pgTAP cloud verts + smokes BO + typecheck 6/6 + sweep BO propre + pattern-guardian APPROVED.
