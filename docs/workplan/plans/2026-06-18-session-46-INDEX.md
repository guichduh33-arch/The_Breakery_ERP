# Session 46 — INDEX : Purchasing Hardening (page Backoffice Achats)

> Statut : **Wave A + B + C livrées** (DB/RPC, UI, durcissement). PR non encore ouverte.
> Branche : `swarm/session-46` (base `master` @ `80cfaba`, post-merge PR #93 costing).
> Spec : [`../specs/2026-06-18-session-46-purchasing-hardening-spec.md`](../specs/2026-06-18-session-46-purchasing-hardening-spec.md) · Plan : [`2026-06-18-session-46-purchasing-hardening-plan.md`](2026-06-18-session-46-purchasing-hardening-plan.md).
> Méthode : controller-driven (subagents sans MCP — DEV-S46-PROC-01), TDD DB, pattern-guardian sur le diff Wave B.
> Commits : `d3190b8` (Wave A) · `0751d97` (Wave B) · `63b8665` (cleanup junk) · `c1d4e7a` (Wave C hardening).

## §1. Résultat

Durcit la page Achats `/backoffice/purchasing` sur 4 axes :

| Exigence | Avant | Après | Vérifié |
|----------|-------|-------|---------|
| R1 — picker raw-material | tous les produits actifs | `useAllProductsForPO` filtre `categories.category_type='raw_material'` (172) **+** `create_v2`/`update_v1` rejettent les non-MP server-side | ✅ pgTAP po_create T3 + smoke useAllProductsForPO |
| R2 — unité contrainte + conversion | input texte libre 16 car. | `<select>` borné (base ∪ alternatives, défaut = `purchase_unit`) + `unit_factor_to_base` persisté **create + edit** + `receive_v2` convertit en base unit | ✅ pgTAP po_receive 13/13 + po_create T1/T2 + smoke POFormDraft |
| R3 — paiements traçables indépendants | aucun suivi (badge dérivé de la réception) | ledger `purchase_payments` append-only + `record_po_payment_v1` gated/idempotent + JE AP-always / paiement séparées + badge **dérivé du ledger** (unpaid/partial/paid) indépendant + auto-pay cash | ✅ pgTAP po_payments 14/14 + po_je 11/11 + smokes |
| R4 — édition autorisée | bouton Edit inerte | `update_purchase_order_v1` gated `purchasing.po.edit` + lock dès 1ʳᵉ GRN OU paiement (D6) + bouton Edit câblé conditionnel | ✅ pgTAP po_update 10/10 + smokes |

## §2. Migrations appliquées

> NAME-block `20260701000010..019` (base verified `list_migrations`, prior max NAME `20260630000024`). Cloud versions clock-assignées (convention S36+) ; miroirs locaux = NAME-block exact. **DEV-S46-PROC-01** : subagents sans MCP → `db-engineer` a rédigé le SQL Wave A, le contrôleur a appliqué via MCP `apply_migration`, rejoué le pgTAP en cloud et regen types. `_018`/`_019` rédigés + appliqués par le contrôleur (Wave B0/C).

| Migration (NAME-block) | Wave | Object |
|------------------------|------|--------|
| `20260701000010` | A2 | ALTER `purchase_order_items` + `unit_factor_to_base NUMERIC(20,10) NOT NULL DEFAULT 1` + CHECK > 0 |
| `20260701000011` | A3 | `receive_purchase_order_v2` (conversion factor→base, +DROP v1) |
| `20260701000012` | A4 | table `purchase_payments` (append-only, RLS auth_read, REVOKE INSERT/UPDATE/DELETE) |
| `20260701000013` | A4 | `_record_po_payment_internal` (helper no-gate, C1) + `record_po_payment_v1` (gated) + REVOKE pairs |
| `20260701000014` | A5 | seed mapping `PURCHASE_PAYMENT_BANK` → 1112 |
| `20260701000015` | A5 | redesign `create_purchase_journal_entry` (DR INVENTORY / CR PAYABLE always + cash auto-pay) |
| `20260701000016` | A6 | `update_purchase_order_v1` + REVOKE pair |
| `20260701000017` | A7 | seed perms `purchasing.po.pay` + `purchasing.po.edit` |
| `20260701000018` | **B0** | `create_purchase_order_v2` (raw_material guard + factor persist, +DROP v1) + REVOKE pair |
| `20260701000019` | **C** | REVOKE TRUNCATE/TRIGGER/REFERENCES on `purchase_payments` (append-only hardening, pattern-guardian) |

> Note : **pas de migration backfill** (`_015` du plan abandonné — open-question #2 tranchée option b, 0 PO cash reçu à backfiller). La numérotation a glissé (`_014` seed mapping, `_015` redesign JE).

## §3. Nouveaux fichiers

- **DB** : migrations `_010..019` (10) ci-dessus.
- **pgTAP** : `po_receive_conversion.test.sql`, `po_payments.test.sql`, `po_je_double_entry.test.sql`, `po_update.test.sql`, `po_create.test.sql` (B0).
- **Hooks** : `usePoPayments.ts` (+ `derivePaymentStatus`), `useRecordPoPayment.ts`, `useUpdatePurchaseOrder.ts` (+ `updatePoErrorMessage`).
- **UI** : `RecordPaymentDialog.tsx`.
- **Smokes** : `RecordPaymentDialog.smoke.test.tsx`, `hooks/__tests__/useAllProductsForPO.smoke.test.tsx`, `hooks/__tests__/po-payment-logic.smoke.test.ts`.
- **Workplan** : trio spec/plan/INDEX.

> **Décision** : `useProductPurchaseUnits.ts` (prévu B2) **non créé** — l'agrégation des unités (base ∪ alternatives ∪ purchase_unit) est embarquée directement dans `useAllProductsForPO` (embed PostgREST 1 requête pour les 172 MP), évitant 172 requêtes per-product. DEV-S46-B2-02.

## §4. Fichiers modifiés

- `useAllProductsForPO.ts` — filtre `categories!inner.category_type='raw_material'` + embed `product_unit_alternatives` + `product_unit_contexts` → `unitOptions` + `defaultPurchaseUnit` par produit.
- `useCreatePurchaseOrder.ts` — appelle `create_purchase_order_v2`, transporte `unit_factor_to_base`, classifier `product_not_raw_material`.
- `POFormDraft.tsx` — `<select>` unité contraint (remplace l'input texte) + `unitFactorToBase` par ligne + prop `submitLabel` (réutilisation édition).
- `PurchaseOrderDetailPage.tsx` — section Payment Status pilotée par le ledger (badge unpaid/partial/paid + historique + Record payment) + bouton Edit câblé (mode édition `POFormDraft`).
- `POFormDraft.smoke.test.tsx` — fixtures `unitFactorToBase` + cas R2 select.
- 5 pgTAP + `functions/purchasing-po.test.ts` — `create_purchase_order_v1 → v2` + fixtures `category_type='raw_material'` ; fix bug latent parenthèse `po_je` T8.
- `packages/supabase/src/types.generated.ts` — regen (v1→v2, +purchase_payments, +record_po_payment_v1, +update_purchase_order_v1, +unit_factor_to_base).
- `packages/supabase/src/rls/permissions.ts` — union `PermissionCode` +`purchasing.po.pay`/`.edit`.

## §5. Tests exécutés

| Suite | Count | Status |
|-------|-------|--------|
| pgTAP `po_create` (B0) | 6/6 | ✅ cloud |
| pgTAP `po_receive_conversion` | 13/13 | ✅ cloud |
| pgTAP `po_payments` | 14/14 | ✅ cloud |
| pgTAP `po_je_double_entry` | 11/11 | ✅ cloud (après fix paren T8) |
| pgTAP `po_update` | 10/10 | ✅ cloud |
| **Total pgTAP** | **54/54** | ✅ |
| BO purchasing smokes (6 fichiers) | 28/28 | ✅ |
| typecheck | 6/6 | ✅ |
| pattern-guardian (diff Wave B) | 0 HIGH · 3 MEDIUM (#1/#2 typage `as never` corrigés · #3 TRUNCATE → `_019`) · 1 INFO | ✅ traité |

## §6. Permissions seedées

- `purchasing.po.pay` — MANAGER / ADMIN / SUPER_ADMIN.
- `purchasing.po.edit` — MANAGER / ADMIN / SUPER_ADMIN.

## §7. RPCs added / bumped

| Action | RPC | Notes |
|--------|-----|-------|
| bump | `receive_purchase_order_v1 → v2` | conversion `factor_to_base` → base unit (DROP v1) |
| bump | `create_purchase_order_v1 → v2` | **B0** — raw_material guard (R1 server-side) + `unit_factor_to_base` persisté (R2 chemin create) (DROP v1) |
| add | `record_po_payment_v1` (+ `_record_po_payment_internal` helper) | ledger append-only, idempotency flavor 2, JE paiement ; helper no-gate appelé par le trigger cash auto-pay (C1) |
| add | `update_purchase_order_v1` | édition gated, lock GRN/paiement, recalcul totaux |
| redesign | `create_purchase_journal_entry()` (trigger) | AP-always + cash auto-pay + VAT-fold NON-PKP préservée |

## §8. Deferred S47+

1. Correction badge SKU « Raw Material » présentation-only (`classifyProduct`, 23 produits tagués).
2. Split multi-compte banque-vs-cash au-delà des mapping keys existants.
3. Backfill JE historiques (si open-question #2 tranchée option b).
4. Multi-devise fournisseur.
5. Annulation / void / reversal d'un paiement partiel (ledger append-only).

## §9. Déviations (DEV-S46-*)

| ID | Section | Original | What happened | Reason | Risk |
|----|---------|----------|---------------|--------|------|
| DEV-S46-C1 | A4 plan | trigger appelle `record_po_payment_v1` (gated) pour l'auto-pay cash | extrait `_record_po_payment_internal` (no-gate) appelé par le trigger avec `p_actor:=NEW.received_by` | un réceptionnaire sans `purchasing.po.pay` aurait été bloqué à la réception d'un PO cash | informational (corrigé Wave A) |
| DEV-S46-C4 | A4 plan | JE postée avant l'insert ledger | ledger inséré **d'abord**, puis JE avec `reference_id=payment_id` | éviter une JE orpheline sur race | informational (corrigé Wave A) |
| DEV-S46-B2-01 | B2 plan (R1/R2) | seul le picker (B1) + `receive_v2` couvraient R1/R2 | **bump `create_purchase_order_v1 → v2`** (raw_material guard + `unit_factor_to_base` persist) — sinon un PO créé avec une unité non-base convertissait à facteur 1 (stock faux), et un client buggé pouvait commander un produit fini | R1/R2 n'étaient appliqués que sur le chemin *edit*, pas *create* | **medium** (fermé : DB + types + hook + pgTAP po_create 6/6) |
| DEV-S46-B2-02 | B2 plan | hook dédié `useProductPurchaseUnits(productId)` | agrégation embarquée dans `useAllProductsForPO` (embed PostgREST, 1 requête pour 172 MP) | éviter 172 requêtes per-product ; le picker charge déjà tous les produits | informational |
| DEV-S46-B-JE-T8 | tests Wave A | `po_je_double_entry.test.sql` committé (Wave A) avec T8 valide | **bug latent** : parenthèse manquante (`) < 1,` au lieu de `) < 1),`) → erreur 42601 au parse | le T8 n'avait jamais tourné réellement en cloud avant B (l'agent l'avait flatté différemment) | informational (corrigé Wave B, 11/11) |
| DEV-S46-B-PG1 | review Wave B | — | pattern-guardian : `purchase_payments` laissait à `authenticated` les privilèges auto `TRUNCATE/TRIGGER/REFERENCES` → TRUNCATE contourne le REVOKE DELETE (append-only) | `REVOKE DELETE` ne couvre pas `TRUNCATE` (op table-level, hors RLS) | **medium** (fermé : migration `_019`, mirroir Stock-Audit m1 ; anon avait déjà 0 privilège via S20) |
| DEV-S46-B-PG2 | review Wave B | `useRecordPoPayment`/`useUpdatePurchaseOrder` `supabase.rpc(..., {...} as never)` | cast `as never` retiré (appels **bound**, types générés) ; seul le patch JSON dynamique reste casté étroitement | les appels étaient déjà *bound* (pas le bug runtime C1) mais le cast affaiblissait le typage des args | informational (corrigé Wave C) |
| DEV-S46-PROC-01 | process | — | subagents sans accès MCP Supabase → contrôleur applique migrations + rejoue pgTAP en cloud + regen types ; nettoie les fichiers 0-octet racine (`notes`,`po_id`,`0`,`1`,`'notes'`,`'po_id'`) | limite connue (`workflow_subagents_no_mcp`) | informational |

## §10. Open questions résolues

| # | Question | Résolution |
|---|----------|------------|
| 1 | Compte de crédit JE paiement (`PURCHASE_CASH_OUT` seul vs split banque) | **Split par méthode** : `cash` → 1110 (`PURCHASE_CASH_OUT`), `transfer`/banque → 1112 (nouveau mapping `PURCHASE_PAYMENT_BANK`, seed `_014`). DR PAYABLE 2141 / CR compte résolu. pgTAP po_payments T8b vérifie 1110 pour cash. |
| 2 | Backfill POs cash historiques reçus | **Option b — déféré** : 0 PO `payment_terms='cash'` déjà reçu en base, 4 POs credit déjà cohérents → aucun backfill nécessaire. Migration `_015` du plan abandonnée. |

## §11. Critères d'acceptation

- [x] R1 — picker `category_type='raw_material'` (172) + guard server-side `create_v2`/`update_v1` ; badge SKU non utilisé.
- [x] R2 — `<select>` unité contraint + `unit_factor_to_base` persisté **create + edit** + `receive_v2` conversion base unit.
- [x] R3 — `purchase_payments` append-only (TRUNCATE compris, `_019`) + `record_po_payment_v1` gated/idempotent + JE double-entrée balance < 1 IDR + statut dérivé indépendant + auto-paiement cash.
- [x] R4 — `update_purchase_order_v1` gated + lock GRN/paiement (D6) + recalcul + bouton Edit câblé conditionnel.
- [x] 2 perms seedées + REVOKE pairs canoniques + types regen committés.
- [x] pgTAP cloud 54/54 + smokes BO 28/28 + typecheck 6/6 + pattern-guardian traité (0 HIGH).
- [ ] Sweep BO complet + vérif live navigateur (optionnelle) + PR squash → `master` (closeout final).
