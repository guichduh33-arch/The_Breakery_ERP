# Spec — Facture PDF B2B (S68, Vague 2)

> **Date :** 2026-07-08 · **Session :** S68 · **Fiche source :** [`docs/workplan/remise-a-plat/09-b2b-wholesale.md`](../../workplan/remise-a-plat/09-b2b-wholesale.md) §D2 · **Vague :** 2 (chantier moyen, plan requis)
> **Ferme :** B1.4 du module 09 (« générer une facture officielle en PDF avec numérotation ») — un des 3 surclaims 🔴 de la fiche.
> **Money-path :** touchée (bump `create_b2b_order_v3 → v4`, additif) — verrou money-path LEVÉ depuis S58 ; ancres re-vérifiées en closeout.

## 1. Contexte & problème

Le module B2B est financièrement solide (allocations par facture, plafond TOCTOU, annulation contrepassée, aging POS==BO) mais **il n'existe aucun document facture** : la « facture » est une commande interne (`orders` `order_type='b2b'`) visible dans `view_b2b_invoices`, sans PDF ni série de numérotation dédiée. Le seul identifiant est `order_number` (`B2B-YYYYMMDD-NNNN`), tiré d'`order_sequences` — **séquence journalière partagée avec les tickets POS**, donc ni continue, ni propre aux factures.

Ce chantier livre : (a) une **série de numérotation dédiée, annuelle, continue** ; (b) un **document PDF** téléchargeable depuis le BO.

## 2. Décisions actées (propriétaire, 2026-07-08)

| # | Décision | Choix |
|---|----------|-------|
| 1 | Niveau de numérotation | **Série dédiée annuelle continue** (pas de conformité *faktur pajak* — le projet est NON-PKP ; ce n'est pas une numérotation fiscale lourde D3) |
| 2 | Moment d'attribution | **À la création** de la commande B2B (`create_b2b_order_v4`) + **backfill** des commandes existantes |
| 3 | Format | **`INV/2026/00001`** (préfixe `INV`, année 4 chiffres, compteur padé sur 5, séparateur `/`) |
| 4 | Mécanisme d'attribution | **Bump RPC `create_b2b_order_v4`** (pas de trigger) — convention RPC-centric ; l'envelope retour renvoie le numéro |
| 5 | Taxe sur la facture | **AUCUNE ligne PB1/taxe**, jamais. Les commandes B2B ont `tax_amount = 0`, `total = subtotal` — la facture reflète la compta réelle |

## 3. Hors scope (assumé, non livré ici)

- **Prix négociés par client** (D3, module 09 B1.1) — le prix reste éditable à la commande.
- **Cycle de livraison / livraisons partielles** (D3, B1.3).
- **Avoirs officiels** (D3, B2.4) — dépend du cycle de livraison.
- **PB1 sur les ventes B2B** — décision explicite : pas de PB1 en B2B.
- **Exposer `adjust_b2b_balance_v2` / `reconcile_b2b_balance_v1`** — quick wins séparés (fiche 09 §D1/D2).
- **Relances, commandes récurrentes, devis** (B2.1/B2.2/B2.3).

## 4. Architecture

Le pipeline reprend exactement le pattern reports/exports existant : **RPC de lecture pure** (données) → **EF `generate-pdf`** (template + upload + URL signée) → **hook BO** (télécharge). La numérotation vit en DB, attribuée dans la transaction de création.

```
create_b2b_order_v4 (money-path)          get_b2b_invoice_v1 (lecture)      EF generate-pdf
──────────────────────────────           ────────────────────────────      ───────────────
draw _next_b2b_invoice_number_v1()        SECURITY DEFINER STABLE            template 'b2b_invoice'
 → orders.invoice_number                  gate b2b.read                       permission b2b.read
 (rollback = pas de trou)                 → JSONB {invoice,customer,          → PDF → bucket
envelope { ..., invoice_number }             lines,payment}                      reports-exports/ TTL 30d
                                                                              → signed_url
        │                                          │                                 │
        └── useCreateB2bOrder (repoint v4)          └──────── useDownloadB2bInvoice ──┘
                                                              (BO, bouton par ligne B2bInvoicesTab)
```

## 5. Composants

### 5.1 Schéma DB (migrations)

**Table `invoice_sequences`** — miroir d'`order_sequences`, keyée par année :
```sql
CREATE TABLE public.invoice_sequences (
  year        INTEGER PRIMARY KEY,
  last_number INTEGER NOT NULL DEFAULT 0
);
```
Écrite **uniquement** par RPC SECURITY DEFINER (aucun GRANT direct à `authenticated`/`anon` ; RLS/grants alignés sur `order_sequences`).

**Colonne `orders.invoice_number TEXT`** nullable + **index unique partiel** :
```sql
ALTER TABLE public.orders ADD COLUMN invoice_number TEXT;
CREATE UNIQUE INDEX orders_invoice_number_key
  ON public.orders (invoice_number) WHERE invoice_number IS NOT NULL;
```
Les commandes POS (`order_type` ≠ `b2b`) restent `NULL`.

**Helper interne `_next_b2b_invoice_number_v1()`** — SECURITY DEFINER, source unique du format :
```sql
-- upsert atomique sur l'année courante (miroir order_sequences), renvoie 'INV/YYYY/NNNNN'
INSERT INTO invoice_sequences (year, last_number)
  VALUES (EXTRACT(YEAR FROM CURRENT_DATE)::int, 1)
  ON CONFLICT (year) DO UPDATE SET last_number = invoice_sequences.last_number + 1
  RETURNING last_number INTO v_n;
RETURN 'INV/' || EXTRACT(YEAR FROM CURRENT_DATE)::int || '/' || LPAD(v_n::text, 5, '0');
```
Trio REVOKE (anon + PUBLIC + `ALTER DEFAULT PRIVILEGES`) — pas de GRANT `authenticated` (usage interne seulement).

### 5.2 `create_b2b_order_v3 → v4`

- **Signature identique** : `(p_customer_id uuid, p_items jsonb, p_notes text, p_delivery_date date, p_idempotency_key uuid)`.
- **Corps repris du LIVE** (`pg_get_functiondef`, leçon DEV-S57-02 — jamais du fichier de migration d'origine).
- Après le credit-check réussi (avant/à l'`INSERT orders`) : `v_invoice_number := _next_b2b_invoice_number_v1();` posé dans l'`INSERT orders`. Comme tout le RPC est **une transaction**, un `RAISE` ultérieur rollback le tirage → **aucun trou à la création**.
- **Envelope** (fraîche ET replay idempotent) : ajouter `'invoice_number'`.
- `DROP FUNCTION create_b2b_order_v3(...)` **dans la même migration** ; trio REVOKE + **`GRANT EXECUTE TO authenticated`** (appelée par le hook BO en JWT user — sans ce grant, la création B2B casse).
- Aucun repoint EF (le `process-payment` EF n'appelle pas `create_b2b_order` ; seul `useCreateB2bOrder.ts` l'appelle en direct).

### 5.3 Backfill (même migration ou dédiée)

Attribue un `invoice_number` à **toutes** les commandes `order_type='b2b'` sans numéro, triées `(created_at, id)`, **regroupées par année de `created_at`**, et seede `invoice_sequences.last_number` par année au max attribué. **Inclut les `voided`** (série complète et traçable — une facture annulée conserve son numéro). Idempotent (n'attribue que si `invoice_number IS NULL`).

### 5.4 `get_b2b_invoice_v1(p_order_id uuid)` — RPC de lecture pure

- **Gate `b2b.read`**, SECURITY DEFINER **STABLE**, trio REVOKE + GRANT `authenticated`.
- Vérifie que la commande est bien `order_type='b2b'` (`invoice_not_found` P0002 sinon).
- Renvoie un **JSONB** consommé tel quel par le template :
  - `invoice` : `{ invoice_number, order_number, invoice_date (created_at), due_date (created_at + b2b_payment_terms_days), status, subtotal, tax_amount (=0), total, notes }`
  - `customer` : `{ company_name (b2b_company_name), tax_id (b2b_tax_id), name, address, phone, payment_terms_days }` — adresse/téléphone depuis les colonnes génériques `customers` si présentes, sinon omis.
  - `lines` : `[{ name (name_snapshot), quantity, unit_price, line_total }]`
  - `payment` : `{ amount_paid (Σ b2b_payment_allocations), outstanding }`

### 5.5 Template EF `b2b_invoice.ts`

- Nouveau `supabase/functions/_shared/pdf-templates/b2b_invoice.ts` exportant `render(ctx, data, period)`.
- **Enregistré dans `TEMPLATES`** (`index.ts`) avec permission **`b2b.read`**.
- Rendu (via `initLayout` / `pdf-layout.ts`) :
  - En-tête entreprise (nom, NPWP, adresse — fourni par l'EF depuis `business_config`).
  - Titre **« INVOICE »** + `invoice_number` + date d'émission + date d'échéance.
  - Bloc **Bill To** : raison sociale, NPWP client, nom, adresse/téléphone si dispo.
  - Tableau des lignes : produit · qté · PU · total.
  - Totaux : **Subtotal + Total uniquement — AUCUNE ligne taxe/PB1**.
  - Statut de paiement : payé / reste dû ; conditions (délai) + échéance ; notes.

### 5.6 Câblage BO

- Étendre l'union `PdfTemplate` (`useGeneratePdf.ts`) avec `'b2b_invoice'`.
- Hook **`useDownloadB2bInvoice(orderId)`** : appelle `get_b2b_invoice_v1` → `useGeneratePdf({ template:'b2b_invoice', data, filename:'invoice-INV-2026-00001' })` → `window.open(signed_url)`. (Filename : sanitiser les `/` du numéro en `-` pour respecter `SAFE_FILENAME_REGEX`.)
- Ajouter `invoice_number` à **`view_b2b_invoices`** (additif) + l'afficher dans la ligne de `B2bInvoicesTab` (à la place ou à côté de `order_number`) + **bouton « Invoice PDF »** (icône `FileText`) par ligne.
- Repointer **`useCreateB2bOrder.ts`** → `create_b2b_order_v4`.

### 5.7 Types + tests

- **Regen types** (`generate_typescript_types` → `packages/supabase/src/types.generated.ts`) — v4, nouvelle table, vue modifiée. **Obligatoire** (cause #1 de CI cassée).
- **pgTAP `b2b_invoice.test.sql`** : numéro attribué à la création, continuité annuelle (2 commandes → `00001`/`00002`), unicité, backfill (ordre + seed séquence), `get_b2b_invoice_v1` shape + gate + perm-denied + rejet non-B2B.
- **Re-passe ancres money-path** (closeout) : `b2b_settlement`, `b2b_display_aware_stock`, ancre `s44_money_gates`.
- **Vitest live `generate-pdf`** (env-gated) : smoke render `b2b_invoice`.
- **Smoke BO** : bouton « Invoice PDF » présent + gate.

## 6. Séquencement (vagues d'implémentation)

1. **DB** : `invoice_sequences` + `orders.invoice_number` + helper `_next_b2b_invoice_number_v1` + `create_b2b_order_v4` + backfill + `get_b2b_invoice_v1` + `view_b2b_invoices` (invoice_number) → regen types.
2. **EF** : template `b2b_invoice.ts` + registry.
3. **BO** : `useGeneratePdf` (+template) · `useDownloadB2bInvoice` · `useCreateB2bOrder` repoint v4 · `useB2bInvoices` (+invoice_number) · `B2bInvoicesTab` (affichage + bouton).
4. **Tests + closeout** : pgTAP + ancres + smokes + regen types committée.

## 7. Dépendances & risques

- **Money-path** : bump `create_b2b_order_v4` — additif, mais re-vérifier les ancres en closeout (verrou LEVÉ depuis S58).
- **Backfill** : sur données live dev — idempotent, ne touche que `invoice_number IS NULL`.
- **Filename EF** : le `/` du numéro doit être sanitisé (`SAFE_FILENAME_REGEX = [A-Za-z0-9._-]+`).
- **Colonnes `customers`** adresse/téléphone : à confirmer en base ; omises proprement si absentes (rendu défensif).
- **MCP Supabase** : toutes les opérations DB via le connecteur claude.ai `mcp__claude_ai_Supabase__*` (Docker retraité).

## 8. Critère de sortie

Depuis l'onglet Invoices du BO, un bouton « Invoice PDF » génère un document PDF propre portant un numéro `INV/2026/NNNNN` continu, sans ligne PB1, avec l'en-tête entreprise, le bloc client, les lignes et le statut de paiement — et toute nouvelle commande B2B reçoit son numéro à la création. Ancres money-path vertes.
