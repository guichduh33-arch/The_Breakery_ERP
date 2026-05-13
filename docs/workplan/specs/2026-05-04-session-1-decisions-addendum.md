# Session 1 — Décisions arbitrées (addendum à la spec)

> **Trace historique** : ce fichier documente une session de travail datée. Le contenu de fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure documentaire (voir [`docs/README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13

> **Date** : 2026-05-04
> **Spec parent** : `2026-05-03-breakery-split-2apps-design.md`
> **Statut** : Acté pour exécution swarm
> **Source** : analyse comparative spec ↔ `docs/reference/` (rapports 3 agents Explore)

Cet addendum tranche 6 points soulevés par l'analyse de cohérence. Il **prévaut sur la spec parent** en cas de contradiction. La spec parent reste la référence pour tous les autres aspects.

---

## Décisions

| # | Sujet | Décision | Impact |
|---|---|---|---|
| **§6** | Trigger journal entry comptable | **Option A** — reproduire `trg_create_sale_journal_entry` dès la session 1 | +3 tables (`accounts`, `journal_entries`, `journal_entry_lines`), +1 trigger, +seed COA minimal (Cash 1110, Sales 4100, PB1 2110) |
| **D1** | Nom du RPC central | `complete_order_with_payment` (**singulier**) | Aligné spec parent. Migration de rename à prévoir si split payment introduit en session 6. |
| **D2** | Contrainte d'unicité shift | `EXCLUDE USING gist (opened_by WITH =) WHERE (status='open')` — **one-open-per-user** | Aligné spec parent. Diverge volontairement de V2 (`one-open-per-terminal`). Implication : un caissier mobile ne peut pas avoir 2 sessions sur 2 devices simultanément. |
| **D8** | Idempotency key dans le RPC | **Oui** — colonne `idempotency_key UUID UNIQUE` sur `orders`, paramètre `p_idempotency_key UUID` du RPC | Évite le double-charge sur double-tap PROCESS PAYMENT pendant timeout réseau. Le client génère un UUID v4 par tentative de checkout, le réutilise sur retry. |
| **PIN** | Longueur du PIN | **6 chiffres exacts** | Diverge de la spec parent (qui dit 4). À propager : `NumpadPin` affiche 6 dots, validation Zod `length: 6`, seed mis à jour : `EMP000`/`123456` (admin), `EMP001`/`567890` (cashier). |
| **§7-6** | RLS read filter `deleted_at IS NULL` | **Oui** — toutes les policies SELECT incluent `AND deleted_at IS NULL` | Évite que les comptes désactivés / produits supprimés remontent dans les UI. Helper `is_authenticated()` reste tel quel ; le filtre est dans chaque policy par table. |

---

## Conséquences sur le périmètre

### Tables ajoutées (14 → 17)

S'ajoutent aux 14 tables core POS de la spec :

- `accounts` — chart of accounts (COA) minimal v1
- `journal_entries` — header JE
- `journal_entry_lines` — lignes débit/crédit (au moins 3 par sale : DR Cash / CR Sales / CR PB1)

### Migrations supplémentaires

Ajouter à la liste Section 3 de la spec :

```
20260503000009_init_accounting.sql        # accounts + journal_entries + lines + seed COA
20260503000010_init_je_triggers.sql       # trg_create_sale_journal_entry
```

### DDL incrément (`orders.idempotency_key`)

```sql
ALTER TABLE orders
  ADD COLUMN idempotency_key UUID UNIQUE;
```

Le RPC `complete_order_with_payment` accepte `p_idempotency_key UUID DEFAULT NULL` :
- Si `NULL` → comportement actuel.
- Si fourni et déjà présent → retourne l'order existant (no-op idempotent).
- Si fourni et absent → INSERT avec cette valeur.

### COA minimal v1 (seed `accounts`)

| Code | Nom | Type | Side |
|---|---|---|---|
| 1110 | Cash on Hand | ASSET | DR |
| 4100 | Sales Revenue | REVENUE | CR |
| 2110 | PB1 (10%) Payable | LIABILITY | CR |

### Pattern RLS read avec soft-delete

```sql
CREATE POLICY "auth_read" ON public.{t}
  FOR SELECT USING (
    is_authenticated() AND deleted_at IS NULL
  );
```

Tables concernées avec `deleted_at` : `user_profiles`, `categories`, `products`, et toute table futur ajoutée avec soft-delete.

---

## Mémoire swarm

À charger dans `agentdb_hierarchical-store` sous les clés :

| Clé | Contenu |
|---|---|
| `breakery/decisions-session-1` | Cet addendum dans son intégralité |
| `breakery/db-schema` | Spec Section 6 **+ 3 tables accounting + idempotency_key + RLS soft-delete** |
| `breakery/auth-rls` | Spec Section 7 **+ PIN longueur = 6 + filtre deleted_at** |
| `breakery/architecture` | Spec Section 3 **+ 2 migrations supplémentaires** |

---

## Hors scope confirmé (rappel)

Toutes les autres simplifications de la spec parent restent valides :
- RBAC hardcodé dans `has_permission()` (junction tables scaffoldées vides pour session 2)
- Edge Functions auth = 4 (pas de `set-user-pin` admin reset en v1)
- Méthodes paiement actives = `cash` (les 6 enums Postgres existent mais le path UI est cash-only)
- Pas de modifiers, KDS, split, refund, loyalty, customer attach, held orders, etc.
- Pas de Capacitor, Sentry source maps prod, E2E Playwright, redondance LAN
