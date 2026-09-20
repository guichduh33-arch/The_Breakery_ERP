# pos-flow-audit — modèle, contrats et repères

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Contexte et conventions
- Ground claims in code — but don't build a ceremony out of it
- Mental model — the multi-device journey

Sélection : un symptôme fonctionnel du parcours commande-paiement suffit, sans demande d’audit globale. Limiter le diagnostic et les propositions au périmètre demandé. [orders](../../orders/SKILL.md) couvre les invariants de commande, [pos-frontend-design-audit](../../pos-frontend-design-audit/SKILL.md) l’aspect et l’ergonomie visuelle ; [security-fraud-guard](../../security-fraud-guard/SKILL.md) couvre l’audit transversal de fraude et de traçabilité.

# POS Flow Audit — The Breakery (bakery-café, multi-device)

> **ADR applicables : ADR-009** (cycle de vie : écritures via RPC uniquement ; transition
> `paid → completed`) · **ADR-010** (item verrouillé en cuisine : autorisation manager
> serveur + perte obligatoire ; cadenas visuel POS/tablette, KDS en realtime) ·
> **ADR-013** (intégrité void/refund · nonce PIN manager sur toute remise · fin du
> dual-mode · ordre canonique des totaux · contrat d'idempotence) · **ADR-015**
> (hors-ligne : tous moyens de paiement **sauf l'avoir** ; un intent rejeté bloquerait tout
> le drain de l'outbox). Ils font loi : une proposition qui les contredit se **signale**,
> elle ne s'implémente pas.
> **Convention** : aucune version d'objet DB (`_vN`) dans ce fichier — on cite la **famille**.
> La version vivante se vérifie dans `supabase/migrations/` et au call-site, jamais ici.
> **Convention d'ancrage** : aucun `fichier:ligne` ici — un numéro de ligne pourrit au premier
> commit. On ancre par nom stable : nom de hook, nom de fichier, famille de RPC, titre de section.
>
> **Ancrages factuels re-vérifiés le 2026-08-31** (hooks, familles de RPC, noms de canaux
> realtime, état des chantiers cités). Tout ce qui suit a été confronté au code ce jour-là ;
> au-delà, **le code gagne** : si ce que tu lis dans `apps/pos` contredit cette fiche, la fiche
> est périmée, pas le codebase — note la dérive et signale-la.

Expert on the complete **order-to-payment journey** across every device and actor of a counter+table-service bakery-café. Two jobs, in priority order:

1. **Discover product/UX gaps and propose features.** Scan the end-to-end flow, find friction, unmet needs, and missing capabilities, then propose concrete improvements **ranked by impact**. This is the primary purpose.
2. **Verify technical correctness** (secondary, but never skip it for a proposal you'd actually ship): idempotency, RPC versioning, PIN-in-header, realtime races, RLS/REVOKE. A great UX idea that breaks an invariant is not a good proposal.

**The bar: be more thorough than a careful first read, not more ceremonial.** This codebase is well-documented (rich `AGENTS.md`, `docs/adr/`, `docs/objectifs/`), so a smart reader already finds the obvious gaps. The skill earns its keep only by catching what a quick pass misses — the *silent failures* where the code looks fine and even tells the user it succeeded, but doesn't. Spend your budget hunting those (see "The silent-failure sweep" below), not on rituals. Verification of versions/patterns is a means to ground a finding, never the deliverable. If you find yourself rebuilding a reference table instead of reading feature code, stop and go read the flow.

**`AGENTS.md` is the source of truth** for project-wide patterns; **`docs/adr/`** carries the binding decisions. This skill adds the POS-flow mental model, the discovery method, the silent-failure sweep, audit checklists, and a proposal format that AGENTS.md doesn't carry.

**Service context (owner, 2026-05):** comptoir + sur place mixte — counter takeaway (bakery) AND table service (café) coexist. The counter path optimizes for *encaissement speed*; the table path optimizes for *kitchen↔floor coordination*. A proposal that helps one path must not slow the other.

## Ground claims in code — but don't build a ceremony out of it

RPC versions bump every session, so the moment you're about to *cite* a version or quote a behaviour, confirm it in the code — a one-line grep, inline, as you go:

```
Grep  \.rpc\(['"](../complete_order|pay_existing_order|fire_counter_order|create_tablet_order|pickup_tablet_order|evaluate_promotions|hold_fired_order|reopen_held_order|discard_held_order|close_shift)
```

That's the whole rule: verify the specific thing you're about to assert, the instant you assert it. Do **not** open with a "verify every RPC version" pass or rebuild the table below before looking at feature code — that burns budget and narrows your search before you've seen anything. Likewise, a "what's already correct (verified)" section is optional polish, not a required deliverable; one or two lines at most. The reference below is a convenience map to know where to look — confirm a row only when a finding depends on it.

Reference map (V3 dev `ikcyvlovptebroadgtvd`, ancrages re-vérifiés le 2026-08-31) — convenience only, re-confirm per finding. **Familles seulement** : aucune version ici, elles bumpent quasi chaque session — la vivante se lit dans `supabase/migrations/` (numéro NAME-block le plus haut) **et** au call-site.

| Famille RPC / EF | Caller (hook / module — ancre stable) | Role |
|---|---|---|
| `complete_order_with_payment` | EF `supabase/functions/process-payment`, elle-même appelée par `useCheckout` (branche panier neuf). **Le POS n'appelle jamais cette RPC directement.** | New cart → order + items + payments + sale JE, atomic. Sale stock via l'unique helper de stock de vente (famille `_record_sale_stock`) : un produit `is_display_item` décrémente `products.current_stock` **et** `display_stock`. |
| `pay_existing_order` | `useCheckout`, branche `pickedUpOrderId` | Pays an order **already persisted** — trois provenances : ramassage tablette (`usePickupTabletOrder`), commande comptoir *fired*, commande *held* réouverte (`useReopenHeldOrder`). Multi-tender. |
| `fire_counter_order` | `useFireToStations` ; aussi la branche « append » de `useCheckout` (lignes ajoutées après le dernier fire) | Envoi comptoir : **persiste la commande et ses lignes côté serveur AVANT d'imprimer** les tickets de station (ADR-022). C'est le vrai aller-retour DB de l'envoi en cuisine. |
| `create_tablet_order` | `useCreateTabletOrder` | Waiter submits a table order. Idempotent via `p_client_uuid`, clés dans `tablet_order_idempotency_keys`. |
| `pickup_tablet_order` | `usePickupTabletOrder` | POS claims a tablet order from the inbox (pas de suffixe de version). |
| `evaluate_promotions` | `useEvaluatePromotions` | Returns applied promos + free items. Pure-TS fallback in `packages/domain/src/promotions`. |
| `mark_item_served` | `useMarkItemServed` | KDS bumps an item ready/served (pas de suffixe de version). |
| `hold_fired_order` · `reopen_held_order` · `discard_held_order` | `useHoldFiredOrder` (dans `features/cart/hooks`), `useReopenHeldOrder` et `useDiscardHeldOrder` (dans `features/heldOrders/hooks`) | Parking **serveur** d'une commande déjà envoyée en cuisine. La liste se lit sur la table `orders` via `useHeldOrdersQuery`. |
| `close_shift` | `useCloseShift` (UI : `CloseShiftModal`) | Closes the session, inserts a `z_reports` draft, fires non-blocking PDF EF. |

**Famille morte à ne pas ressusciter** : `hold_order` / `restore_held_order` (la voie « brouillon `HELD-<uuid>` sur panier neuf ») est supprimée par **ADR-022 déc. 4** — un objet portant un numéro de commande sans en être une polluait rapports, journal et rapprochement de caisse. Il n'en subsiste que des mentions en commentaire et dans d'anciennes migrations. Une commande n'existe qu'à partir de son envoi en cuisine ou de son paiement.

If the version you find ≠ the table above, **trust the code** and note the drift — the skill is out of date, not the codebase.

## Mental model — the multi-device journey

```
COUNTER PATH (takeaway, speed-first)            TABLE PATH (café, coordination-first)
────────────────────────────────────           ─────────────────────────────────────
POS terminal: build cart                         Waiter tablet: build cart at table
 │  add items + modifiers (cartStore)             │  create_tablet_order (idempotent)
 │  evaluate_promotions                             │        │
 │        │                                        ▼        ▼
 │        │                    pending-tablet-orders-… ──► POS inbox (usePickupTabletOrder)
 │        ▼                                                         │
 │   fire to stations ──► kds-{station}-… ──► KDS screen            │
 │   (useFireToStations → fire_counter_order :        │ mark_item_served
 │    persiste EN DB puis imprime les tickets)        ▼             │
 │        │                           order ready ──► display       │
 │        ▼                                                         │
 │   [optional] hold serveur (hold_fired_order)                     │
 │        │  reopen_held_order / discard_held_order                 │
 ▼        ▼                                                         ▼
PAYMENT (useCheckout)                                    PAYMENT (pickup → pay_existing_order)
 │  panier neuf : process-payment EF → complete_order_with_payment
 │  commande déjà persistée (fired / held rouverte / tablette) : pay_existing_order
 │  split tender / loyalty redeem / discount (manager PIN)
 │  display-{screenId}-… ◄── running total + "paid" broadcast (LAN realtime)
 ▼
receipt print + cash drawer + customer display confirm
 │
 ▼
SHIFT CLOSE (close_shift) → z_report draft → signed in BackOffice
```

### Actors & devices

| Actor | Device | Code home | Owns in the flow |
|---|---|---|---|
| Cashier | POS terminal | `features/cart`, `features/payment` | Counter order, payment, receipt, drawer, manager-PIN overrides |
| Waiter | Tablet | `features/tablet`, `features/tables`, `features/floor-plan` | Table order entry, table/occupancy state |
| Kitchen | KDS screen | `features/kds` (+ `packages/domain/src/kitchen`) | Item prep states, bump/recall, station routing |
| Customer | Customer display | `features/display`, `features/lan` | Running total, promos, "paid" confirmation |
| Customer | Kiosk (self-order) | *check `features/` — confirm presence before assuming* | Self-service order entry |
| Shift manager | POS user (PIN) | `features/shift`, `features/discounts` | Open/close session, cash variance, discount approval |

### Coordination backbone (realtime)

Realtime is where multi-device flows quietly break. **Channel names must be unique per mount** — StrictMode double-mounts collide silently (canon : `features/kds/hooks/useKdsRealtime.ts`, plus le test `apps/pos/src/__tests__/realtime-channel-uniqueness.test.tsx`). Le motif vivant est donc *préfixe métier + discriminant unique*, jamais un nom nu :

| Surface | Hook | Forme du nom |
|---|---|---|
| KDS | `useKdsRealtime` | `kds-{station}-{uuid}` |
| Customer display | `useDisplayRealtime` | `display-{screenId}-{uuid}` |
| Inbox tablette | `usePendingTabletOrders` | `pending-tablet-orders-{uuid}` |
| Held orders | `useHeldOrdersRealtime` | `held-orders-{uuid}` |
| Occupation des tables | `useTableOccupancy` | `table_occupancy_realtime-{uuid}` |
| Statut commande tablette | `useTabletOrderStatusListener` | `tablet-order-status-{uuid}` |

Ne cite pas un nom de canal de mémoire : lis la constante `channelName` du hook. Counter↔display uses LAN realtime (`features/lan`). A gap here shows up as "the kitchen didn't see the order" or "the display froze on the last customer" — always reproduce across two real devices, not one tab.
