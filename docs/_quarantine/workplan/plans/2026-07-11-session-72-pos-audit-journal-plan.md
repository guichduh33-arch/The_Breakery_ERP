# S72 — Journal d'audit opérationnel POS (plan)

> Daté, append-only. Cadrage complet dans le fil de session (livrables 1→7, 2026-07-11).
> Décisions propriétaire 2026-07-11 : **1** table dédiée · **2** enregistrement des terminaux ·
> **3** loguer chaque changement · **4** partitionnement (purge par partition) · **5** offline
> comptoir aussi (outbox POS global) · **6** quick-win fraude d'abord · **7** source unique dans le périmètre.

## Objectif
Passer l'onglet Activity d'un flux « Sale completed » à un **vrai journal d'audit opérationnel** :
chaque manipulation, par device et par opérateur, immuable (append-only), résiliente offline,
source unique dont les autres onglets pourront dériver.

## Constats de cadrage (source : investigation 2026-07-11)
- **Aucun bus d'événements client.** Seule `audit_logs` (serveur) trace, de façon coarse et
  post-persistance. Gros angles morts : pré-fire panier, ouverture commande/session, tiroir-caisse
  (fraude), méthode/échec paiement, print/reprint. L'Activity ne lit même pas `audit_logs`.
- **`order_number`** = compteur **quotidien** (`order_sequences`, reset chaque jour WITA, partagé
  tous devices). Jamais une clé. Clé stable = `orders.id`. Afficher `order_number` **avec sa date**.
- **Aucune infra d'écriture offline** (pas d'outbox/IndexedDB/SW). À construire.

## Architecture cible
- **`pos_devices`** — registre des terminaux (token opaque localStorage + label + kind).
- **`pos_events`** — table **dédiée, partitionnée par mois** (`occurred_at`), append-only (RLS + REVOKE
  DML + trigger anti-UPDATE/DELETE). Idempotence offline via `UNIQUE (client_event_id, occurred_at)`.
  Pas de FK (convention `audit_logs`) ; `actor_id` = opérateur à l'émission, `synced_by` = qui a sync.
- **`record_pos_events_v1(p_device_token, p_events jsonb)`** — ingest **batch idempotent**
  (`ON CONFLICT DO NOTHING`), résout/auto-provisionne le device, `SECURITY DEFINER`.
- **Client** — helper `emitPosEvent(type, payload)` → **outbox IndexedDB** (write-first non bloquant)
  → flush au retour réseau (`useTabletOffline` transition) via le RPC batch ; purge après ACK.
  `client_event_id` = `crypto.randomUUID()`, `device_seq` monotone par device.

## Lots
1. **Infra DB** — `pos_devices` (+`register_pos_device_v1`), `pos_events` partitionnée + enum +
   append-only + `record_pos_events_v1`. pgTAP write-path + idempotence. Types regen. ← **en cours**
2. **Client infra + fraude d'abord** — `emitPosEvent` + outbox IndexedDB + flush ; instrumenter
   en priorité `cash_drawer_opened` (vente + manuel) + `session_opened` (via RPC) + `payment_failed`.
3. **Émission client fine** — tout le cycle `cartStore` (add/qty/remove/void pré-fire/order_type/
   table/discount_removed), payment machine, print/reprint.
4. **UI Activity** — `get_pos_events_v1` (filtres type/device/opérateur/ticket, keyset paginé) +
   refonte onglet : timeline par ticket, signaux de contrôle mis en évidence, couleur/icône par type,
   WITA explicite, scroll infini, export CSV.
5. **Source unique** — faire dériver voids/paiements/ventes du flux d'événements (gros, en dernier).

## Invariants tenus
Money-path NON modifié (émission = fire-and-forget hors chemin critique). 6 invariants POS respectés.
Append-only strict. WITA uniforme. Types regen après migration. `audit_logs` conservé pour BO/sensible.
