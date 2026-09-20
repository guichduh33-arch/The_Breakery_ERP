# b2b-credit — contrôles et sources

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Audit checklist
- Preventive checklists
- Sources de vérité (pointers)
- Verification before claiming a fix is complete
- When to escalate

## Audit checklist

### A. Intégrité AR (balance vs ledger)

- [ ] **Balance = Σ outstanding**, PAS Σ des `b2b_pending`. Depuis les paiements
  partiels, une facture partiellement réglée reste `b2b_pending` avec un outstanding
  réduit : sommer `orders.total` sur-compterait. La formule vivante est celle de
  `reconcile_b2b_balance` : `SUM(view_b2b_invoices.outstanding) WHERE is_unpaid` par
  customer doit égaler `customers.b2b_current_balance`. Le BO expose déjà ce contrôle —
  hook `useB2bBalanceDrift.ts`, affiché sur le dashboard B2B. Drift = ordre créé hors
  RPC, paiement hors ledger, ou annulation mal contre-passée.
- [ ] **Allocations cohérentes** — pour toute facture,
  `Σ b2b_payment_allocations.amount_applied ≤ orders.total` ; aucune facture `paid` avec
  un outstanding > 0, aucune facture `b2b_pending` avec un outstanding ≤ 0.
- [ ] **Overpayment impossible** — aucun `b2b_current_balance` négatif :
  `SELECT * FROM customers WHERE b2b_current_balance < 0` doit être vide.
- [ ] **Aging cohérent** — `SUM(view_ar_aging.total_outstanding)` par customer =
  `b2b_current_balance` (l'aging étant partial-aware, l'égalité est attendue, pas une
  approximation ; tout écart est un drift à instruire).
- [ ] **Factures annulées invisibles** — aucune ligne `status='voided'` dans
  `view_b2b_invoices`, et toute commande `voided` a une JE `b2b_order_cancel`.

### B. Sécurité (ledgers + balance write-path)

- [ ] **RLS `b2b_payments` et `b2b_payment_allocations`** — policy SELECT seule ; aucune
  policy INSERT/UPDATE/DELETE. Vérifier via MCP :
  `SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename IN ('b2b_payments','b2b_payment_allocations')`.
- [ ] **REVOKE column `b2b_current_balance`** — `SELECT * FROM
  information_schema.column_privileges WHERE table_name='customers' AND
  column_name='b2b_current_balance' AND privilege_type='UPDATE'` ne doit inclure ni
  `authenticated` ni `anon`.
- [ ] **Aucun 5ᵉ écrivain de `b2b_current_balance`** — grep `b2b_current_balance =` dans
  `supabase/migrations/` : seules les familles `create_b2b_order`, `record_b2b_payment`,
  `adjust_b2b_balance`, `cancel_b2b_order` doivent apparaître.
- [ ] **Credit-limit gate wired** — tout code path créant un ordre B2B appelle
  `validate_b2b_credit_limit` avant l'INSERT orders. Le vérifier sur le corps de la
  version live, pas sur la migration d'origine.
- [ ] **REVOKE pair sur CHAQUE RPC B2B** — pas seulement les trois d'origine :
  `create_b2b_order`, `record_b2b_payment`, `adjust_b2b_balance`, `cancel_b2b_order`,
  `reconcile_b2b_balance`, `get_b2b_invoice`, `get_b2b_dashboard_counters`,
  `get_pos_b2b_debts`, `get_b2b_settings` / `update_b2b_settings`. Chaque bump refait la
  paire pour SA signature — une signature changée sans REVOKE rouvre la fonction.
- [ ] **Gates dédiées présentes** — `b2b.read`, `b2b.payment.record`, `b2b.order.cancel`,
  `b2b.balance.adjust` existent dans `permissions` et sont accordées à
  SUPER_ADMIN/ADMIN/MANAGER ; aucune RPC B2B d'écriture ne retombe sur le générique
  `customers.update`.
- [ ] **PIN manager sur l'ajustement** — `adjust_b2b_balance` refuse sans PIN valide
  (`_verify_pin_with_lockout`), et le PIN voyage en argument RPC (pas dans un body loggé
  d'EF).

### C. Traçabilité

- [ ] **audit_logs rows** — chaque appel RPC produit une ligne :
  `b2b.order.created`, `b2b.payment.recorded`, `b2b.balance.adjusted`,
  `b2b.order.cancelled`.
  `SELECT action, COUNT(*) FROM audit_logs WHERE action LIKE 'b2b.%' GROUP BY action`.
- [ ] **`actor_id` = `user_profiles.id`** — toutes les RPC B2B résolvent le profil depuis
  `auth_user_id`. Jamais `auth.uid()` brut (AGENTS.md).
- [ ] **Replay distinguishable** — les replays retournent `idempotent_replay: true`,
  ne créent ni JE ni allocation ni audit_log supplémentaires.
- [ ] **JE correctement liée** — `b2b_payments.journal_entry_id` non null hors replay ;
  `journal_entries.reference_type` ∈ {`b2b_order`, `b2b_payment`, `b2b_adjustment`,
  `b2b_order_cancel`}. Note : pour `b2b_payment` et `b2b_adjustment`, `reference_id` est
  posé après coup (paiement) ou laissé NULL (ajustement) pour éviter une collision sur la
  contrainte d'idempotence `(reference_type, reference_id)`.
- [ ] **Pas de double JE de revenu** — une commande B2B passée à `paid` ne doit produire
  AUCUNE JE `reference_type='sale'`.

---

## Preventive checklists

### Avant d'ajouter un nouveau method de paiement B2B
- [ ] Le type `payment_method` enum existe sur V3 dev ? (`SELECT enum_range(NULL::payment_method)`)
- [ ] Ajouter un mapping `B2B_PAYMENT_<METHOD>` dans `accounting_mappings` + migration.
- [ ] Bumper `record_b2b_payment` → version suivante (RPC versioning monotone), DROP de
      l'ancienne dans la MÊME migration, corps repris de `pg_get_functiondef` live.
- [ ] REVOKE pair sur la nouvelle signature.
- [ ] pgTAP couvrant le nouveau method + replay + overpayment guard + allocation.

### Avant de bumper `create_b2b_order`
- [ ] La gate `validate_b2b_credit_limit` est préservée — toute version suivante DOIT
      l'appeler, avant l'INSERT.
- [ ] Le prix de ligne reste résolu serveur (`_resolve_b2b_line_price`) ; aucun
      `unit_price` client honoré.
- [ ] `b2b_current_balance` mis à jour dans la même transaction que l'INSERT orders.
- [ ] `_record_sale_stock` toujours appelé pour chaque item (flag-aware :
      `track_inventory` direct, sinon `deduct_stock` via recette).
- [ ] `order_number` ET `invoice_number` posés ; la séquence de facturation reste
      `_next_b2b_invoice_number`.
- [ ] Types regen via MCP après la migration.

### Avant de toucher au règlement (paiement / annulation)
- [ ] Le refus d'annulation quand une allocation existe est conservé.
- [ ] Le passage `paid_at` + `status='paid'` reste conditionné au règlement COMPLET.
- [ ] `view_b2b_invoices` / `view_ar_aging` restent dérivées du ledger d'allocations —
      ne pas retomber sur `paid_at IS NULL`.
- [ ] La garde anti-double-JE côté trigger de vente reste active.

---

## Sources de vérité (pointers)

```
Migrations — la vérité est le numéro LE PLUS HAUT de chaque famille
  supabase/migrations/*b2b*.sql
    · socle : extend_customers_b2b_fields, create_validate_b2b_credit_limit_rpc,
              enums b2b / b2b_pending, relax_orders_session_id_nullable,
              create_b2b_payments_table, revoke_update_b2b_current_balance
    · refonte règlement (2026-07-10) : create_b2b_payment_allocations,
              seed_b2b_payment_record_cancel_perms, record_b2b_payment (v2),
              cancel_b2b_order, rebuild_b2b_views_outstanding,
              reconcile_b2b_balance
    · ajustement (2026-07-10) : adjust_b2b_balance_v2_je_pin (JE 1132⇄6520 + PIN)
    · facturation : invoice_sequences_and_number, backfill_b2b_invoice_numbers,
              get_b2b_invoice, view_b2b_invoices_invoice_number
    · dashboard : adr026_get_b2b_dashboard_counters (ADR-026)
    · garde JE : bump_create_sale_journal_entry_b2b_guard (2026-08-18)

Tests (vérité comportementale) — run via MCP execute_sql, enveloppe BEGIN/ROLLBACK
  supabase/tests/b2b_*.test.sql   — 10 fichiers au 2026-08-31 (foundation, credit,
    settlement, invoice, settings, negotiated_price, balance_adjust_je_pin,
    dashboard_counters, flag_aware_stock, display_aware_stock)
  supabase/tests/sale_je_b2b_guard.test.sql — garde anti-double-JE

Front (call-sites — la version vivante d'une RPC se lit ICI)
  apps/backoffice/src/features/btob/hooks/*.ts
  apps/pos/src/features/customers/hooks/useOutstandingDebts.ts

ADR
  ADR-005 — NON-PKP / PBJT Lombok : pas de PB1 sur les commandes B2B
  ADR-020 — prix négocié résolu serveur sur le money-path
  ADR-026 — les agrégats du dashboard B2B quittent le client (famille de compteurs serveur)

AGENTS.md
  §Critical patterns — REVOKE pair, idempotence 2 saveurs, RPC versioning monotone,
                       actor_id = user_profiles.id, ledgers append-only
```

---

## Verification before claiming a fix is complete

```bash
# Type check
pnpm typecheck

# BO smoke — feature btob (filtre = NOM DE FICHIER ; les fichiers b2b du BO sont
# en kebab-case ET en PascalCase — localiser par glob avant de conclure)
pnpm --filter @breakery/app-backoffice test b2b

# pgTAP via MCP execute_sql (BEGIN/ROLLBACK envelope)
# Rejouer les fichiers supabase/tests/b2b_*.test.sql concernés par le changement
```

Toujours cibler V3 dev cloud `ikcyvlovptebroadgtvd` via MCP. Jamais `pnpm db:reset` /
`supabase start` (Docker retiré 2026-05-14).

---

## When to escalate

- About to relax `customers_b2b_current_balance_nonneg` CHECK — couvre un invariant réel.
- About to make `b2b_current_balance` la source de vérité par facture, ou à l'inverse à
  supprimer le cache — c'est un changement d'architecture AR, pas un fix.
- About to relax the "cancel refusé si une allocation existe" rule, ou à autoriser
  l'annulation d'une facture `paid` — touche la réversibilité comptable.
- `validate_b2b_credit_limit` call removed from any order-creation flow — immediate flag.
- Audit finds `b2b_current_balance` drift ≠ 0 on any customer (`reconcile_b2b_balance` /
  `useB2bBalanceDrift`) — investiguer un UPDATE hors RPC (le REVOKE colonne devrait
  l'empêcher ; s'il y a drift, soit le REVOKE a été contourné, soit une RPC contre-passe
  mal).
- B2B PB1/tax change — confirm PKP status (ADR-005 supersedes ADR-003 : NON-PKP, PBJT
  municipale Lombok/NTB, currently no PB1 on B2B orders).
- L'aging doit-il basculer sur `b2b_payment_terms_days` (échéance) au lieu de l'âge de la
  facture ? La colonne existe et n'est pas utilisée — **signalement, pas décision** :
  c'est un arbitrage produit.
