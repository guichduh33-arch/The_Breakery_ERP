# Session 24 — Pre-flight DB introspection

**Date :** 2026-05-19
**Source :** lectures des migrations existantes (MCP `execute_sql` en attente d'auth, mais les migrations locales sont autoritatives V3 dev).

## Découvertes

### Schémas confirmés

| Élément | État | Référence |
|---|---|---|
| `payment_method` enum | `'cash', 'card', 'qris', 'edc', 'transfer', 'store_credit'` | `20260503000000_init_extensions_enums.sql:16` |
| `order_type` enum | `('dine_in', 'take_out', 'delivery')` — **pas 'b2b'** | `20260503000000_init_extensions_enums.sql:14` |
| `order_status` enum | `('draft', 'paid', 'voided')` — **pas 'pending'** | `20260503000000_init_extensions_enums.sql:15` |
| `accounting_mappings` schema | `(mapping_key TEXT PK, account_code TEXT REFERENCES accounts(code), description, is_active, ...)` — **pas account_id UUID** | `20260517000001_init_accounting_mappings.sql:13` |
| `resolve_mapping_account(TEXT) → UUID` | Existe, SECURITY DEFINER, RAISEs P0002 si manquant | `20260517000001_init_accounting_mappings.sql:50` |
| `customer_type` enum | Existe (V2 carryover ; CHECK déjà drop par 20260517000130) | `20260517000130` |
| `B2B_AR` mapping | **Existe déjà** → compte 1132 ("AR — B2B") | `20260517000005_seed_full_coa_sak_emkm.sql:106` |
| `SALE_B2B_REVENUE` mapping | **Existe déjà** → compte 4131 ("B2B Revenue") | `20260517000005:87` |
| `SALE_PAYMENT_CASH` mapping | Existe → compte 1110 | `20260517000001:40` |
| `journal_entries` / `journal_entry_lines` | OK avec `reference_type`/`reference_id` + CHECK debit/credit XOR | `20260503000009_init_accounting.sql:21,38` |
| `next_journal_entry_number(date) → text` | Existe (D14 helper) | implied par `20260517000010:65` |
| `check_fiscal_period_open(date)` | Existe (D12 helper, RAISE P0004) | implied par `20260517000010:44` |
| `orders.session_id` | **NOT NULL REFERENCES pos_sessions(id)** | `20260503000003_init_pos.sql:27` |
| `orders.served_by` | NOT NULL REFERENCES user_profiles(id) | `20260503000003_init_pos.sql:28` |
| `order_sequences (date, last_number)` | Existe avec `ON CONFLICT (date) DO UPDATE SET last_number+=1` pattern | `20260503000008_init_complete_order_rpc.sql:96` |

### Ajustements au spec/INDEX S24

1. **`order_type` enum doit être étendu avec `'b2b'`** : nouvelle migration `_005` `ALTER TYPE order_type ADD VALUE 'b2b';` avant les autres. (PostgreSQL ne permet pas ALTER TYPE dans une transaction qui utilise ensuite la nouvelle valeur — mais `apply_migration` est isolé par migration, donc OK.)

2. **`order_status` enum doit être étendu avec `'b2b_pending'`** : nouvelle migration `_006` `ALTER TYPE order_status ADD VALUE 'b2b_pending';`. Décision : nouveau statut distinct de `'draft'` (qui sémantiquement = brouillon avant paiement) ; `'b2b_pending'` = commande B2B en attente de paiement. Permet aux requêtes UI de filter sans confusion.

3. **`orders.session_id` doit accepter NULL pour `order_type='b2b'`** : migration `_007` `ALTER TABLE orders ALTER COLUMN session_id DROP NOT NULL;` + CHECK constraint `(session_id IS NOT NULL OR order_type = 'b2b')`. Cela ne casse pas le POS path (qui passe toujours session_id).

4. **Migration `_014` (seed AR_B2B mapping) → SUPPRIMÉE** : `B2B_AR` mapping existe déjà → réutiliser ce key. Le spec doit corriger `'AR_B2B'` → `'B2B_AR'` partout.

5. **`SALE_B2B_REVENUE` réutilisé** pour CR Revenue dans `create_b2b_order_v1`. Pas de PB1 sur B2B en S24 (out of scope — Indonésie B2B typiquement sans PB1, mais à confirmer S30 décision PKP).

6. **JE de `record_b2b_payment_v1`** : DR `SALE_PAYMENT_CASH` (1110) si method=cash, OU créer un mapping spécifique. Décision : ajouter 1 nouveau mapping `B2B_PAYMENT_BANK` → '1112' (Bank Operating) dans migration `_014` pour les méthodes transfer/card. Cash réutilise `SALE_PAYMENT_CASH`. (Donc migration `_014` redevient utile mais avec contenu différent.)

7. **`accounting_mappings.account_code` est TEXT, pas UUID** : pas d'impact RPC car `resolve_mapping_account()` fait le JOIN et retourne UUID. Ajustement au spec §4.1.5 (commentaire structurel).

## Migration block corrigé (8 migrations)

| # | Filename | Type |
|---|----------|------|
| 005 | `20260601000005_extend_order_type_enum_b2b.sql` | ALTER TYPE |
| 006 | `20260601000006_extend_order_status_enum_b2b_pending.sql` | ALTER TYPE |
| 007 | `20260601000007_relax_orders_session_id_nullable.sql` | ALTER COLUMN + CHECK |
| 010 | `20260601000010_create_b2b_payments_table.sql` | CREATE TABLE |
| 011 | `20260601000011_create_view_b2b_invoices.sql` | CREATE VIEW |
| 012 | `20260601000012_create_view_ar_aging.sql` | CREATE VIEW |
| 013 | `20260601000013_revoke_update_b2b_current_balance.sql` | REVOKE |
| 014 | `20260601000014_seed_b2b_payment_bank_mapping.sql` | SEED (nouveau key seulement) |
| 020 | `20260601000020_create_record_b2b_payment_v1.sql` | RPC CREATE |
| 021 | `20260601000021_create_adjust_b2b_balance_v1.sql` | RPC CREATE |
| 022 | `20260601000022_create_b2b_order_v1.sql` | RPC CREATE |

11 migrations totales (au lieu de 8). Bloc `20260601000005..022` réservé.

## Risques validés

- ALTER TYPE doit être dans une migration séparée (Postgres limitation : nouvelle valeur non utilisable dans la même TX). `apply_migration` wrap chaque fichier en TX distinct → OK.
- `CHECK (session_id IS NOT NULL OR order_type = 'b2b')` doit accepter les rows existantes : toutes les rows existantes ont `session_id NOT NULL`, donc CHECK passe.
- Si V3 dev a des rows orders avec `order_type` autre que les 3 enum values existants → ALTER TYPE échouera. Pre-flight `SELECT DISTINCT order_type FROM orders` devra confirmer (à faire après auth MCP).

## Action

Mettre à jour le spec et INDEX avec ces ajustements avant dispatch subagent stream-a.
