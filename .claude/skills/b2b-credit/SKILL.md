---
name: b2b-credit
description: >-
  Crédit client B2B Breakery : commandes, factures, règlements, allocations FIFO, encours, limites et rapprochement AR. Pour modifier ces flux ou expliquer une créance. Les paiements fournisseurs relèvent du domaine achats.
---

# B2B Credit & AR — The Breakery ERP

Suivre la facture, ses allocations et son encours ; ne pas confondre paiement partiel et facture soldée. Lire la carte des RPC seulement pour le parcours concerné.

## Lecture proportionnée

Les règles d’CLAUDE.md restent applicables. Les liens ci-dessous sont conditionnels : ne pas charger tout le dossier ni tous les skills voisins. Réutiliser les lectures déjà faites dans la session ; rouvrir si le code ou le périmètre a changé.

| Quand lire | Ressource |
|---|---|
| Pour le contrat, le parcours ou la surface concernée ; avant toute modification de sa logique. | [modèle, contrats et repères](references/model.md) |
| Avant une modification et avant de conclure : sélectionner les contrôles du parcours, puis exécuter les tests requis par CLAUDE.md. | [contrôles et sources](references/verification.md) |

## Critical patterns (don't break these)

1. **`b2b_payments` et `b2b_payment_allocations` append-only** — jamais d'INSERT direct.
   Seul `record_b2b_payment` (SECURITY DEFINER) écrit dans les deux. RLS + REVOKE
   (INSERT/UPDATE/DELETE/TRUNCATE) pour authenticated/anon/PUBLIC.
2. **`b2b_current_balance` write-only via RPCs** — la colonne n'est pas dans le GRANT
   UPDATE per-colonne de `customers`. Tout UPDATE direct raise 42501. Les écrivains
   légitimes sont **quatre** : `create_b2b_order` (+= total), `record_b2b_payment`
   (−= amount), `adjust_b2b_balance` (±= delta), **`cancel_b2b_order` (−= total)**.
   Bypass légal : SECURITY DEFINER postgres owner. Un cinquième écrivain = bypass réel.
3. **Credit-limit gate OBLIGATOIRE** avant tout ordre B2B — `validate_b2b_credit_limit`
   doit être appelé dans toute RPC ou EF créant un ordre B2B, **avant** l'INSERT.
   `NULL` credit_limit = unlimited (gate retourne `allowed: true`). Payload
   `would_exceed_by` exposé à l'UI. Une seule version de cette famille existe et
   `create_b2b_order` l'appelle toujours.
4. **Idempotency flavor 2 (RPC arg)** — `record_b2b_payment`, `create_b2b_order`,
   `adjust_b2b_balance` et `cancel_b2b_order` acceptent tous `p_idempotency_key UUID`.
   Replay retourne le résultat original + `idempotent_replay: true`, sans re-poster de JE.
   Pattern CLAUDE.md §"Idempotence, 2 saveurs". `record_b2b_payment` déduplique sur
   `b2b_payments.idempotency_key` ; les trois autres sur `audit_logs.metadata`.
5. **Overpayment guard (P0011)** — `record_b2b_payment` refuse si
   `balance_before − amount < 0` ; `adjust_b2b_balance` refuse si `balance + delta < 0` ;
   `cancel_b2b_order` refuse si `balance − total < 0`. Le CHECK
   `customers_b2b_current_balance_nonneg` double la garde au niveau table.
6. **Fiscal period guard** — `record_b2b_payment`, `create_b2b_order`,
   `adjust_b2b_balance` et `cancel_b2b_order` appellent `check_fiscal_period_open()`.
   Raise P0004 si période fermée.
7. **Allocation = LIGNES RÉELLES, pas un snapshot** — `record_b2b_payment` écrit dans
   `b2b_payment_allocations` : d'abord les factures ciblées `p_invoice_ids` (dans l'ORDRE
   du tableau, chacune verrouillée `FOR UPDATE`, refus P0001 si la facture n'appartient
   pas au client / n'est pas b2b / est `voided` / est déjà soldée), puis **FIFO** sur le
   reliquat (plus anciennes `b2b_pending` d'abord, `ORDER BY created_at`). Règlement
   complet d'une facture ⇒ `paid_at` + `status='paid'`. **Construire de la logique
   applicative dessus est légitime** : le front le fait déjà (sélection de factures dans
   la modale de paiement, couverte par le test
   `features/btob/__tests__/record-payment-invoice-selection.smoke.test.tsx`).
   Le JSONB `b2b_payments.allocation` reste écrit pour continuité — ne pas le lire comme
   source de vérité.
8. **`cancel_b2b_order` ne touche jamais une facture déjà allouée** — refus P0011
   `order_has_payments` dès qu'une ligne `b2b_payment_allocations` existe, et exige
   `status='b2b_pending'` en entrée. Corollaire : une commande B2B `paid` ne passe jamais
   par cette porte, donc jamais de JE fantôme côté void.
9. **JE mapping** : `SALE_PAYMENT_CASH` → 1110 (cash) ; `B2B_PAYMENT_BANK` → 1112 (bank) ;
   `B2B_AR` → 1132 ; `SALE_B2B_REVENUE` → 4131 ; `B2B_AR_ADJUSTMENT` → 6520
   (Bad Debt / AR Write-off, contrepartie des ajustements). Pas de PB1 sur les commandes
   B2B (ADR-005, NON-PKP / PBJT). `reference_type` autorisés côté `journal_entries` :
   `b2b_order`, `b2b_payment`, `b2b_adjustment`, `b2b_order_cancel`.
10. **Le trigger de JE de vente est gardé contre les commandes B2B** — une commande B2B
    porte déjà sa JE de revenu émise à la création ; le trigger `AFTER UPDATE OF status`
    sur `orders` doit continuer de l'exclure, sinon revenu doublé (bug confirmé sur dev,
    corrigé par `20260818000006_bump_create_sale_journal_entry_b2b_guard.sql`).
11. **`adjust_b2b_balance` émet une JE et exige le PIN manager** — gate dédiée
    `b2b.balance.adjust` (SUPER_ADMIN/ADMIN/MANAGER), PIN vérifié serveur par
    `_verify_pin_with_lockout`, JE de contrepartie 1132 ⇄ 6520 (`delta>0` : Dr 1132 /
    Cr 6520 ; `delta<0` : Dr 6520 / Cr 1132), `reason` ≥ 3 caractères. **Ce n'est plus
    un simple audit_logs.**
12. **REVOKE pair canonique sur TOUTE RPC B2B** (PUBLIC + anon + `ALTER DEFAULT
    PRIVILEGES`), y compris les bumps et les RPC de lecture. Voir CLAUDE.md
    §Critical patterns.
13. **Permissions dédiées, plus le générique `customers.update`** : `b2b.read` (lecture /
    reconcile), `b2b.payment.record`, `b2b.order.cancel`, `b2b.balance.adjust`.
    `create_b2b_order` reste gardé par `pos.sale.create`.
14. **Prix B2B résolu serveur** — `create_b2b_order` calcule chaque ligne via
    `_resolve_b2b_line_price` (négocié > catégorie > retail) et **ignore tout
    `unit_price` client** (ADR-020).

---

## Qualité de restitution

Répondre d’abord au problème demandé. Distinguer fait observé, intention métier et hypothèse ; ancrer les constats dans le code lu ou le résultat mesuré. Un ancien relevé n’est pas une preuve actuelle. Donner impact, correction ou décision attendue, vérification effectuée et limite éventuelle ; ne pas remplir des rubriques sans résultat utile. Une consigne de skill n’élargit pas l’autorisation donnée par Mamat.
