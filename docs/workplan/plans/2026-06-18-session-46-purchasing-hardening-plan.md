# Session 46 — Plan : Purchasing Hardening (page Backoffice Achats)

> Spec : [`docs/workplan/specs/2026-06-18-session-46-purchasing-hardening-spec.md`](../specs/2026-06-18-session-46-purchasing-hardening-spec.md)
> Branche : `swarm/session-46` (base `master` @ `80cfaba`).
> Méthode : **subagent-driven TDD**, 1 subagent par task, **spec-review + code-review par wave**, `pattern-guardian` sur les diffs migration, `test-engineer` sur le pgTAP. Squash-merge par PR en fin de session.
> Migration NAME-block : `20260701000010..` (base à vérifier `list_migrations`, prior max NAME `20260630000024`). **Appliquer via MCP `apply_migration`** sur V3 dev `ikcyvlovptebroadgtvd`. Types regen MCP → commit.
> ⚠️ **Subagents sans MCP** (cf. `workflow_subagents_no_mcp`, DEV-S41/S45-PROC-01) : `db-engineer` *rédige* le SQL ; le **contrôleur applique** via MCP `apply_migration`, regen types et **rejoue le pgTAP en cloud**. Nettoyer les fichiers 0-octet laissés à la racine.

## Ordre d'exécution

```
Wave A (DB/RPC, bloquant)
  A1 contrat raw-material (doc)   ──┐
  A2 ALTER PO items + factor        │
  A3 receive_purchase_order_v2      │ séquencé (A4/A5 dépendent du schéma + mapping)
  A4 purchase_payments + RPC pay    │
  A5 redesign JE trigger + pay JE   │
  A6 update_purchase_order_v1       │
  A7 seed 2 perms                   │
  A8 types regen ───────────────────┘
        │
        ├─ Wave B1 (picker raw-material)   ─┐
        ├─ Wave B2 (unité contrainte)       ├─ parallélisables (fichiers ~disjoints)
        ├─ Wave B3 (payments UI)            │
        └─ Wave B4 (edit UI)               ─┘
                                            │
Wave C (régression + review + closeout)
```

A est bloquant (B dépend des RPCs bumpées + types regen). À l'intérieur de A, **A4/A5 dépendent du schéma A2 et du mapping account résolu en A1** (open-question #1). B1/B2/B3/B4 touchent des fichiers quasi disjoints sauf `POFormDraft.tsx` (partagé B2 ↔ B4) et `PurchaseOrderDetailPage.tsx` (partagé B3 ↔ B4) → voir note conflits Wave C.

---

## Wave A — DB/RPC (subagent : `db-engineer`, contrôleur applique)

**TDD DB** : écrire le pgTAP d'abord (rouge), puis les migrations (vert). Chaque migration dans le NAME-block `20260701000010..`, monotone, un objet par migration.

### A1 — Contrat raw-material + résolution mapping (doc + vérif, bloquant pour A5)
- **Doc-only** : acter le contrat `categories.category_type = 'raw_material'` (172 produits) comme source d'autorité du picker R1. Aucune migration.
- **Vérif open-question #1** : `execute_sql` sur `mapping_accounts`/`resolve_mapping_account` → confirmer le(s) compte(s) de crédit de la JE de paiement (`PURCHASE_CASH_OUT` seul, ou split cash/banque type `B2B_PAYMENT_BANK` selon `p_method`). **Trancher avant A5.**
- **Vérif open-question #2** : compter les POs `payment_terms='cash'` déjà `received` → décider backfill (option a data-migration / option b déféré). Documenter le choix dans l'INDEX.

### A2 — ALTER `purchase_order_items` + facteur (R2 schéma)
- `20260701000010_alter_po_items_add_unit_factor.sql` :
  - `ALTER TABLE purchase_order_items ADD COLUMN unit_factor_to_base NUMERIC NOT NULL DEFAULT 1`.
  - *(optionnel)* colonne stockée/générée `base_quantity` ou calcul à la réception (au choix exécutant — privilégier le calcul in-RPC pour ne pas dupliquer la vérité).
  - Backfill implicite : les lignes existantes prennent `1` (unité = base unit, conversion neutre).

### A3 — `receive_purchase_order_v2` (R2 conversion)
- pgTAP rouge `supabase/tests/po_receive_conversion.test.sql` (conversion factor → base unit, idempotence préservée).
- `20260701000011_bump_receive_purchase_order_v2.sql` :
  - **RPC versioning monotone** : `CREATE ... receive_purchase_order_v2(...)` + `DROP FUNCTION receive_purchase_order_v1(<args>)` dans la même migration.
  - Convertit `received_qty × unit_factor_to_base` en unités de base **avant** `record_stock_movement_v1` (le stock reste en base ; `stock_movements.unit` NOT NULL = base unit).
  - Gate `purchasing.po.receive` (inchangé), auth-first, `search_path`, REVOKE pair canonique (inline ou migration dédiée).

### A4 — `purchase_payments` + `record_po_payment_v1` (R3 ledger)
- pgTAP rouge `supabase/tests/po_payments.test.sql` (insert gated, idempotency replay, statut dérivé, REVOKE).
- `20260701000012_create_purchase_payments_table.sql` : table append-only `purchase_payments` (`id, purchase_order_id, amount, method, paid_at, paid_by, reference, idempotency_key UNIQUE, created_at`), RLS, **REVOKE UPDATE/DELETE** (append-only, pattern `b2b_payments` + `stock_movements`).
- `20260701000013_create_record_po_payment_v1_rpc.sql` :
  - `record_po_payment_v1(p_po_id UUID, p_amount NUMERIC, p_method TEXT, p_reference TEXT, p_idempotency_key UUID) RETURNS JSONB SECURITY DEFINER SET search_path = public, pg_temp`.
  - Gate `purchasing.po.pay`, auth-first.
  - **Idempotency flavor 2** : `idempotency_key` = PK logique du ledger ; replay (unique_violation catch + re-read) → renvoie le résultat du 1er succès (`{ ..., idempotent_replay: true }`).
  - Garde montant (> 0, ≤ solde restant), insère ledger, poste la **JE de paiement** `DR PURCHASE_PAYABLE / CR <compte résolu A1>`, audit `po.payment_recorded`.
  - Renvoie le statut dérivé `unpaid/partial/paid` (`SUM(amount)` vs `total_amount`).
  - REVOKE pair canonique.

### A5 — Redesign JE trigger + auto-paiement cash (R3 comptabilité, D4)
- pgTAP rouge `supabase/tests/po_je_double_entry.test.sql` (AP-always à la réception ; JE paiement séparée ; balance < 1 IDR ; VAT-fold NON-PKP préservée ; auto-paiement termes cash).
- `20260701000014_redesign_create_purchase_journal_entry.sql` :
  - **Pattern corrective S38** (`pg_get_functiondef` + replace si signature trigger inchangée, sinon `CREATE OR REPLACE`).
  - Réception : **toujours** `DR INVENTORY_GENERAL / CR PURCHASE_PAYABLE` (**garde** la VAT-fold dans INVENTORY_GENERAL — ADR-003 NON-PKP).
  - Branche cash : si `payment_terms='cash'`, **auto-enregistrer un paiement** à la réception (appel interne → JE paiement `DR PURCHASE_PAYABLE / CR PURCHASE_CASH_OUT`). Ne plus créditer `PURCHASE_CASH_OUT` directement dans la JE de réception.
- *(si backfill option a)* `20260701000015_backfill_cash_received_po_payments.sql` : insertion ledger rétroactive pour les POs cash déjà reçus (pas de re-poste de JE).

### A6 — `update_purchase_order_v1` (R4 édition, D3 + D6)
- pgTAP rouge `supabase/tests/po_update.test.sql` (gate, lock GRN, lock paiement, recalcul totaux, audit).
- `20260701000016_create_update_purchase_order_v1_rpc.sql` :
  - `update_purchase_order_v1(p_po_id UUID, p_patch JSONB) RETURNS JSONB SECURITY DEFINER`.
  - Gate `purchasing.po.edit`, auth-first.
  - **Lock D6** : `RAISE 'po_locked' (P0001)` si `status<>'pending'` OU `EXISTS(GRN)` OU `EXISTS(purchase_payments)`.
  - Patch header + lignes (allowlist cols), recalcule `subtotal/vat_amount/total_amount`, audit `po.updated`.
  - REVOKE pair canonique.

### A7 — Seed perms
- `20260701000017_seed_purchasing_pay_edit_perms.sql` : seed `purchasing.po.pay` + `purchasing.po.edit` + grants MANAGER/ADMIN/SUPER_ADMIN (aligné sur `purchasing.po.{create,receive,cancel}`). Étendre le union `PermissionCode` côté types.

### A8 — Types regen (contrôleur)
- `generate_typescript_types` → `packages/supabase/src/types.generated.ts` → commit.

**Review A** : `test-engineer` rejoue les pgTAP indépendamment (contrôleur en cloud) ; `pattern-guardian` audite les diffs (REVOKE pairs, RPC versioning monotone + DROP, append-only REVOKE, idempotency flavor 2, auth-first, search_path, JE balance, audit cols canoniques).

**Gate de sortie A** : tous pgTAP verts + types committés + mapping account A1 résolu. → débloque B.

---

## Wave B — Backoffice UI (subagents : `backoffice-specialist`)

### B1 — Picker raw-material (R1)
- `useAllProductsForPO.ts` : joindre `categories` + filtrer `category_type='raw_material'` (inner-join embed PostgREST). Ne **pas** utiliser `classifyProduct`/badge SKU.
- Smoke `po-product-picker-raw-material.smoke.test.tsx` : un produit fini est absent ; un raw-material est présent.

### B2 — Unité contrainte (R2)
- `useProductPurchaseUnits(productId).ts` : agrège `products.unit` (factor 1) ∪ `product_unit_alternatives` (code + factor_to_base) ∪ `product_unit_contexts.purchase_unit`. Défaut = `purchase_unit` si présent.
- `POFormDraft.tsx` : remplacer l'input texte unité par un `<select>` (primitive native — `@breakery/ui` n'exporte pas `<Select>`) ; la ligne stocke `unit` + `unit_factor_to_base`.
- Smoke `po-unit-select.smoke.test.tsx` : options = unités valides ; choisir une alternative renseigne le factor.

### B3 — Payments UI (R3)
- `usePoPayments(poId).ts` (lecture ledger + statut dérivé) + `useRecordPoPayment().ts` (mutation `record_po_payment_v1`, `supabase.rpc` **bindé**, idempotency `useRef(crypto.randomUUID())`, invalide `['po-payments', poId]` + `['purchase-order', poId]`).
- `PurchaseOrderDetailPage.tsx` : section **Payments** (liste ledger) + **badge statut paiement indépendant** (unpaid/partial/paid dérivé) + `RecordPaymentDialog` (montant/méthode/référence, gate `purchasing.po.pay`).
- Smokes `po-payments-section.smoke.test.tsx` + `record-payment-dialog.smoke.test.tsx`.

### B4 — Edit UI (R4)
- `useUpdatePurchaseOrder().ts` (mutation `update_purchase_order_v1`, mappe `po_locked` → message FR).
- Câbler le bouton **Edit** (aujourd'hui inerte) → `POFormDraft` en mode édition, conditionnel à `purchasing.po.edit` ; bouton masqué/désactivé si PO verrouillé (reçu/payé).
- Smoke `po-edit-wiring.smoke.test.tsx` : Edit visible si perm + PO `pending` non payé ; absent sinon ; `po_locked` surface un toast.

> **Note conflits fichiers** : `POFormDraft.tsx` est édité par B2 (select unité) **et** B4 (mode édition) ; `PurchaseOrderDetailPage.tsx` par B3 (payments) **et** B4 (bouton Edit). Séquencer B2→B4 et B3→B4 sur ces 2 fichiers, ou worktree + merge contrôleur. Les hooks sont disjoints et parallélisables.

---

## Wave C — Régression, review, closeout (contrôleur)

### C.1 — Sweep
- `pnpm --filter @breakery/app-backoffice test` (sweep BO complet) — zéro nouvelle failure vs baseline env-gated (~24 BO `VITE_SUPABASE_URL Required`, DEV-S25-2.A-02 — **pas** des régressions).
- `pnpm typecheck` 6/6.

### C.2 — Code review
- `reviewer` : revue qualité B1-B4 (gates de perm corrects, query keys, mapping erreur `po_locked`, select unité ↔ factor).
- 2ᵉ passe `pattern-guardian` sur le diff complet (migrations + front).

### C.3 — Vérif live navigateur (playwright-cli, dev server BO) — optionnel si temps
- Login Owner. Créer un PO raw-material → réceptionner → vérifier JE `DR INVENTORY / CR PAYABLE` + auto-paiement cash en DB. Enregistrer un paiement partiel sur un PO credit → badge passe `partial`. Éditer un PO `pending` → OK ; tenter d'éditer un PO reçu → bloqué.

### C.4 — Closeout
- Compléter l'INDEX `docs/workplan/plans/2026-06-18-session-46-INDEX.md` (déviations numérotées DEV-S46-*).
- Bump CLAUDE.md « Active Workplan » + bullet « Migration sequence active » (NAME-block `20260701000010..`).
- PR squash `swarm/session-46` → `master`.

---

## Critères de sortie (rappel spec §7)

- [ ] R1 : picker raw-material only (`category_type`), badge SKU non utilisé.
- [ ] R2 : `<select>` unité contraint + `unit_factor_to_base` persisté + `receive_v2` convertit en base unit.
- [ ] R3 : `purchase_payments` append-only + `record_po_payment_v1` gated/idempotent + JE double-entrée balance < 1 IDR + statut dérivé indépendant + auto-paiement cash.
- [ ] R4 : `update_purchase_order_v1` gated + lock GRN/paiement + recalcul totaux + bouton Edit fonctionnel conditionnel.
- [ ] 2 perms seedées + REVOKE pairs + types regen committés.
- [ ] pgTAP cloud verts + smokes BO + typecheck 6/6 + sweep BO propre + pattern-guardian OK.

## Risques / pièges

- **RPC versioning** : `receive_purchase_order_v2` doit `DROP v1` dans la même migration ; ne jamais éditer une signature `_vN` publiée.
- **Append-only** : `purchase_payments` REVOKE UPDATE/DELETE — toute correction future = écriture inverse, pas un UPDATE.
- **Mapping account A1** : ne pas écrire l'émetteur JE paiement avant d'avoir confirmé le compte de crédit (open-question #1) — sinon P0002 `resolve_mapping_account` runtime.
- **Backfill cash** : si déféré, les POs historiques cash s'affichent « unpaid » — assumé et documenté (open-question #2).
- **VAT-fold NON-PKP** : ne **pas** réactiver `PURCHASE_VAT_INPUT`/1151 — la fold dans INVENTORY_GENERAL reste (ADR-003).
- **`supabase.rpc` non bindé** → erreur runtime (pattern stock-audit C1) : toujours binder.
- **Vitest mock data** : refs stables `vi.hoisted()` (`project_vitest_hoisted_mock_data`, S39 B1 OOM).
- **`Products.tsx`-like conflits** : `POFormDraft.tsx` + `PurchaseOrderDetailPage.tsx` partagés → séquencer (note Wave B).
- **types regen oublié** = #1 cause de CI cassée — commit obligatoire après Wave A.
- **Subagents sans MCP** : contrôleur applique migrations + rejoue pgTAP en cloud ; nettoyer les fichiers 0-octet racine.
