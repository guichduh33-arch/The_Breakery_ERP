---
name: pos-flow-audit
description: Audits and improves the POS order-to-payment flow of a multi-device bakery-café (counter takeaway + table service) — POS terminal, waiter tablet, KDS kitchen screen, customer display, self-order kiosk, shift/Z-report. Finds product/UX gaps and silent failures, then proposes features ranked by impact, plus a technical-correctness pass (idempotency, RPC versioning, realtime races). DEFER, inventory/WAC/recipe-cost → stock-management; RBAC/permissions/"who can do what"/audit-log completeness → security-fraud-guard; report/PDF, CI, auth internals, generic back-office CRUD → not this skill. Use WHENEVER the user touches the live order-to-payment path, even via a symptom and without saying "audit", checkout / encaissement speed / counter queues, dividing a table bill ("diviser l'addition") or split tender, cashier or waiter workflow, KDS or kitchen↔floor coordination, a tablet order not reaching the kitchen, customer display, self-order kiosk, held/parked orders across terminals, receipt / change / cash-drawer bugs, promotions at point of sale, or shift-close cash-variance & Z-report review for control & fraud risk (the POS shift flow lives here; only pure RBAC/permission questions go to security-fraud-guard). Scope, apps/pos, packages/domain (cart/orders/payment), supabase order/payment/shift RPCs.
pathPatterns:
  - 'apps/pos/src/features/cart/**'
  - 'apps/pos/src/features/payment/**'
  - 'apps/pos/src/features/kds/**'
  - 'apps/pos/src/features/tablet/**'
  - 'apps/pos/src/features/display/**'
  - 'apps/pos/src/features/inbox/**'
  - 'apps/pos/src/features/promotions/**'
  - 'apps/pos/src/features/discounts/**'
  - 'apps/pos/src/features/shift/**'
  - 'apps/pos/src/features/heldOrders/**'
  - 'apps/pos/src/features/tables/**'
  - 'apps/pos/src/features/floor-plan/**'
  - 'apps/pos/src/features/order-history/**'
  - 'packages/domain/src/orders/**'
  - 'packages/domain/src/cart/**'
  - 'packages/domain/src/payment/**'
  - 'packages/domain/src/promotions/**'
  - 'packages/domain/src/kitchen/**'
  - 'packages/domain/src/tables/**'
  - 'supabase/functions/process-payment/**'
  - 'supabase/migrations/*order*.sql'
  - 'supabase/migrations/*payment*.sql'
  - 'supabase/migrations/*shift*.sql'
  - 'supabase/migrations/*tablet*.sql'
promptSignals:
  phrases:
    - 'POS flow'
    - 'order to payment'
    - 'checkout'
    - 'prise de commande'
    - 'encaissement'
    - 'cashier workflow'
    - 'waiter'
    - 'tablet order'
    - 'KDS'
    - 'kitchen display'
    - 'customer display'
    - 'kiosk'
    - 'shift close'
    - 'close_shift'
    - 'split payment'
    - 'split bill'
    - 'diviser l''addition'
    - 'multi-device'
    - 'queue'
    - 'audit POS'
    - 'improve the POS'
    - 'POS feature'
---

# POS Flow Audit — The Breakery (bakery-café, multi-device)

Expert on the complete **order-to-payment journey** across every device and actor of a counter+table-service bakery-café. Two jobs, in priority order:

1. **Discover product/UX gaps and propose features.** Scan the end-to-end flow, find friction, unmet needs, and missing capabilities, then propose concrete improvements **ranked by impact**. This is the primary purpose.
2. **Verify technical correctness** (secondary, but never skip it for a proposal you'd actually ship): idempotency, RPC versioning, PIN-in-header, realtime races, RLS/REVOKE. A great UX idea that breaks an invariant is not a good proposal.

**The bar: be more thorough than a careful first read, not more ceremonial.** This codebase is well-documented (rich `CLAUDE.md`, docs/reference), so a smart reader already finds the obvious gaps. The skill earns its keep only by catching what a quick pass misses — the *silent failures* where the code looks fine and even tells the user it succeeded, but doesn't. Spend your budget hunting those (see "The silent-failure sweep" below), not on rituals. Verification of versions/patterns is a means to ground a finding, never the deliverable. If you find yourself rebuilding a reference table instead of reading feature code, stop and go read the flow.

**`CLAUDE.md` is the source of truth** for project-wide patterns and the active workplan. This skill adds the POS-flow mental model, the discovery method, the silent-failure sweep, audit checklists, and a proposal format that CLAUDE.md doesn't carry.

**Service context (owner, 2026-05):** comptoir + sur place mixte — counter takeaway (bakery) AND table service (café) coexist. The counter path optimizes for *encaissement speed*; the table path optimizes for *kitchen↔floor coordination*. A proposal that helps one path must not slow the other.

## Ground claims in code — but don't build a ceremony out of it

RPC versions bump every session, so the moment you're about to *cite* a version or quote a behaviour, confirm it in the code — a one-line grep, inline, as you go:

```
Grep  \.rpc\(['"](complete_order|pay_existing_order|create_tablet_order|evaluate_promotions|close_shift)
```

That's the whole rule: verify the specific thing you're about to assert, the instant you assert it. Do **not** open with a "verify every RPC version" pass or rebuild the table below before looking at feature code — that burns budget and narrows your search before you've seen anything. Likewise, a "what's already correct (verified)" section is optional polish, not a required deliverable; one or two lines at most. The reference below is a convenience map to know where to look — confirm a row only when a finding depends on it.

Reference map (V3 dev `ikcyvlovptebroadgtvd`, 2026-05-31) — convenience only, re-confirm per finding:

| RPC / EF | Caller (file:line) | Role |
|---|---|---|
| `complete_order_with_payment_v10` | EF `supabase/functions/process-payment/index.ts:149` (called by `useCheckout.ts:124`) | New cart → order + items + payments + sale JE, atomic. Decrements `display_stock` AND `products.current_stock` (documented double-deduction). |
| `pay_existing_order_v6` | `apps/pos/src/features/payment/hooks/useCheckout.ts:93` | Pay off an already-created (tablet) order. Multi-tender (S11). |
| `create_tablet_order_v2` | `apps/pos/src/features/tablet/hooks/useCreateTabletOrder.ts:19` | Waiter submits a table order. Idempotent via `p_client_uuid` (S25). |
| `pickup_tablet_order` | `apps/pos/src/features/inbox/hooks/usePickupTabletOrder.ts:43` | POS claims a tablet order from the inbox. |
| `evaluate_promotions_v1` | `apps/pos/src/features/promotions/hooks/useEvaluatePromotions.ts:166` | Returns applied promos + free items. Pure-TS fallback in `packages/domain/src/promotions`. |
| `mark_item_served` | `apps/pos/src/features/kds/hooks/useMarkItemServed.ts:14` | KDS bumps an item ready/served (no version suffix). |
| `close_shift_v2` | `apps/pos/src/features/shift/hooks/useCloseShift.ts:51` | Closes the session, inserts a `z_reports` draft, fires non-blocking PDF EF (S29). |

If the version you find ≠ the table above, **trust the code** and note the drift — the skill is out of date, not the codebase.

## Mental model — the multi-device journey

```
COUNTER PATH (takeaway, speed-first)            TABLE PATH (café, coordination-first)
────────────────────────────────────           ─────────────────────────────────────
POS terminal: build cart                         Waiter tablet: build cart at table
 │  add items + modifiers (cartStore)             │  create_tablet_order_v2 (idempotent)
 │  evaluate_promotions_v1                         │        │
 │  [optional] hold/recall (useHoldOrder)          ▼        ▼
 │        │                              tablet:new_orders ──► POS inbox (usePickupTabletOrder)
 │        ▼                                                         │
 │   send to kitchen ──► kds:{station} ──► KDS screen               │
 │   (useSendToKitchen, client-lock v1)        │ mark_item_served   │
 │                                             ▼                    │
 │                                    order ready ──► display       │
 ▼                                                                  ▼
PAYMENT (useCheckout)                                    PAYMENT (pickup → pay_existing_order_v6)
 │  process-payment EF → complete_order_with_payment_v10
 │  split tender / loyalty redeem / discount (manager PIN)
 │  display:{station} ◄── running total + "paid" broadcast (LAN realtime)
 ▼
receipt print + cash drawer + customer display confirm
 │
 ▼
SHIFT CLOSE (close_shift_v2) → z_report draft → signed in BackOffice
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

Realtime is where multi-device flows quietly break. Channels: `orders:*`, `display:{station}`, `kds:{station}`, `tablet:new_orders`. **Channel names must be unique per mount** — StrictMode double-mounts collide silently (see `features/kds/hooks/useKdsRealtime.ts`). Counter↔display uses LAN realtime (`features/lan`). A gap here shows up as "the kitchen didn't see the order" or "the display froze on the last customer" — always reproduce across two real devices, not one tab.

## Discovery method — scan the flow, rank by impact

When asked to audit or "find what to improve", **walk the journey stage by stage** (cart → promo → kitchen send → KDS → ready/display → payment → post-payment → shift). For each stage ask the four discovery questions, then rank findings.

**The four discovery questions (per stage):**
1. **Friction** — how many taps/screens/waits does the actor cross? Where do they backtrack?
2. **Unmet need** — what does a bakery-café cashier/waiter/customer obviously want here that the code doesn't do? (e.g., split a table bill, re-fire a forgotten item, pre-order pickup time, "course" timing for pastries vs hot drinks.)
3. **Multi-device coordination** — does each device show the right state at the right time? What's stale, missing, or duplicated across devices?
4. **Recovery** — when something goes wrong (wrong item, customer changes mind, payment declines, network blips), is there a clean path, or does the actor void & restart?

**Rank every finding by impact, not by ease:**

| Tier | Meaning | Example |
|---|---|---|
| **P0 — Daily pain** | Hits the most common path many times/day | Counter encaissement needs N taps it shouldn't |
| **P1 — Frequent friction** | Common but not every order | No clean "split this table bill" |
| **P2 — Edge / polish** | Real but occasional | Reprint a receipt from 3 orders ago |
| **P3 — Nice-to-have** | Strategic / future | Customer-facing order tracking screen |

Surface P0/P1 first. A long list of P3s buries the findings that matter. **Always state how you'd verify a gap is real** (which file you read, which flow you traced) — don't assert friction you didn't confirm in the code.

## The silent-failure sweep (do this on every audit — it's where the real findings hide)

A careful reader catches the *visible* gaps. The findings that justify an audit are the ones the code hides: it looks plausible, it even tells the user it worked, but it doesn't. These bugs cost real money and trust in a POS and never throw an error, so nobody notices until reconciliation. They recur because they're *easy to write and impossible to see by glancing*. Hunt them deliberately — read the actual function body, not just its name. Open the file that does the thing and ask: "if this is subtly wrong, how would it look exactly like this?"

The recurring archetypes on a POS flow (each one was a real, missed bug in this codebase at least once — they generalize, so look for new instances, not just these):

- **The action that lies.** A handler shows a success toast / advances the UI but never persists (`useSendToKitchen` markLocked-only — "sent to kitchen" but the KDS never sees it). Trace every "done!" signal back to a DB write or RPC call. If the success message isn't downstream of a real mutation, it lies.
- **The forced/hardcoded value that should be dynamic.** A field slammed to a constant regardless of input (receipt `method: 'cash'` for every tender; tax `0.10` hardcoded in 3 files while the server rate is dynamic). Grep for literal payment methods, tax rates, currency/locale, station names, role names, limits (`MAX_*`) — each is a candidate divergence from the source of truth.
- **The client recompute that diverges from the server.** UI recalculates a total/tax/discount instead of trusting the server result, and drifts (receipt total recomputed ignoring promotions/discounts). Anywhere the client does math the server already did, the two can disagree — flag it and prefer the server value as source of truth.
- **The unconditional side-effect.** A drawer opens / a print fires / a sync runs on *every* path when it should be conditional (cash drawer opens for QRIS/card payments). Look at effects that run on mount or on success with no guard.
- **The silent skip.** A `SELECT ... WHERE id = x` that inserts nothing when `x` doesn't exist, a `FOR` loop that drops unmatched rows, a filter that quietly excludes a value (`dispatch_station='none'` items fired to no KDS screen; missing-product row swallowed). No row, no error, truncated result. Check every set-based insert/loop for "what if the lookup matches nothing?"
- **The lost realtime event.** A subscription that only invalidates on live events with no refetch-on-reconnect / interval safety net — an event dropped during a Wi-Fi blip never recovers. Check every realtime hook for reconnection handling.
- **The dead branch.** A function that always returns the same value regardless of input (`resolveLoyaltyMultiplier` → always 1.0) — code that looks like logic but is inert. If a helper can't actually vary its output, the feature it implements doesn't exist.
- **The default that's wrong for this business.** A default that suits the generic case but not a counter-takeaway bakery (`order_type: 'dine_in'` default on a takeaway-dominant counter → skewed stats/tax). Check initial state against the real-world dominant path.

Run this sweep stage by stage alongside the four discovery questions. It is the single highest-value thing this skill does — a plain read will not surface these, and they outrank most UX polish. When you find one, it's almost always P0/P1.

**Where to spend the deep-read budget (so the sweep stays thorough without reading the whole app).** These bugs cluster in a handful of file types — open *these* function bodies first, and you'll find most silent failures fast:
- **Success/`onSuccess` handlers and effects** (`SuccessModal`, payment/checkout hooks, `useSendToKitchen`) — where toasts/prints/drawers fire and values get built for the receipt. Home of "the action that lies", "forced value", "unconditional side-effect".
- **The mutating RPC/EF bodies** the flow calls (`complete_order_*`, `pay_existing_order_*`, `create_tablet_order_*`, `close_shift_*`, `process-payment`) — read the SQL/loop, not just the signature. Home of "silent skip" and tax/total logic.
- **Realtime hooks** (`use*Realtime`) — check reconnect handling. Home of "lost realtime event".
- **Store initial state + `partialize`/persistence** (`cartStore`, `paymentStore`) — defaults and what survives a reload. Home of "wrong default" and dropped-on-reload state.
- **Client total/tax/discount math** (`packages/domain/src/payment`, `calculateTotals`, any hardcoded rate/method/`MAX_*`) — home of "client recompute diverges" and "hardcoded-should-be-dynamic".
- **When a routing/config value drives visibility** (a `dispatch_station`, a feature flag), and you can reach the dev DB via the Supabase MCP, *count how many rows hit the bad value* — an empirical "% affected" turns a hypothesis into a confirmed P0 (e.g. eval-2's 68% mis-routed products).

You don't need to read every component. Skim the journey for structure, then deep-read this short list of high-yield spots. That keeps the audit thorough and bounds the cost.

## Product/UX audit checklist (primary)

Run the stages relevant to the question. Each item is a concrete thing to look for in the code, not a vague principle.

### A. Cart & order entry (both paths)
- [ ] **Tap count to a typical order** — from product grid to "send"/"pay", count interactions for the 3 most common bakery items. Modifiers, quantity, notes — each extra screen on the counter path is a P0 candidate.
- [ ] **Item search/findability** — grid vs search vs categories vs `combos`. Can a cashier find a rarely-sold item fast? Are favorites/most-sold surfaced?
- [ ] **Hold / recall (`useHoldOrder`, `useRestoreHeldOrder`)** — counter parking for "I'll pay after I grab a coffee". Is it discoverable? Does it survive a refresh? Does it block the terminal? Is it shared across terminals?
- [ ] **Order type switch** — dine-in ↔ takeaway mid-order: does it recompute tax/price correctly without restarting the cart? Is the default right for a takeaway-dominant counter?
- [ ] **Tablet table binding (`features/tables`, `floor-plan`)** — is the table picked before items? Can a waiter move an order to another table? Merge/split tables?

### B. Promotions & loyalty at the right moment
- [ ] **Promo visibility** — does `evaluate_promotions_v1` show the customer/cashier *why* a discount applied, and what's one item away from a threshold? A silent promo is a missed upsell. Do applied promos survive a tab reload?
- [ ] **Loyalty at payment** — is point redemption offered at the natural moment, or buried? Is the customer's tier/balance visible during the order, not just at checkout?
- [ ] **Manager-PIN discounts (`features/discounts`)** — friction vs control: how many manager interruptions per shift? Is there a per-cashier discount ceiling instead of a PIN every time?

### C. Kitchen ↔ floor coordination (table path)
- [ ] **Send latency & confirmation** — when an item is sent, does the sender get a confirmation the KDS received it? `useSendToKitchen` is client-lock v1 — is there a real DB round-trip yet, or can a sent item silently never reach the kitchen?
- [ ] **Routing correctness** — items inherit `dispatch_station` from category; a `'none'`/NULL station reaches no KDS screen. Are all sellable products routed to a real station?
- [ ] **Course/timing** — pastries out now, hot drinks with dessert: can items be timed/coursed, or do they all fire at once?
- [ ] **Re-fire / recall** — wrong or forgotten item: can the kitchen recall a bumped item (`useKdsBumpItem`) and the floor see it?
- [ ] **Ready → served handoff** — when KDS marks ready, who is notified (display? waiter tablet?), and is "served" actually captured for table turn-time metrics?

### D. Customer display & self-service
- [ ] **Running order mirror** — does `display:{station}` show items as they're added, the live total, and applied promos? Does it reset cleanly between customers (no leftover from the last order)?
- [ ] **Payment confirmation** — does the display show "paid / change due / thank you", or go blank?
- [ ] **Kiosk self-order** — confirm whether a kiosk path exists before proposing kiosk features. If absent, that's itself a strategic gap to name (P3) for a takeaway-heavy counter.

### E. Payment & checkout
- [ ] **Method speed** — cash / card (EDC) / QRIS / store credit: how many taps to the most common method? Is the likely method pre-selected? Does the receipt record the *real* tender (not a hardcoded 'cash')?
- [ ] **Split tender & split bill** — `pay_existing_order_v6` is multi-tender (split *payment*). Is there a split-*bill* (per-guest) path for a shared table? Is the split flow reachable on the table path, and does the per-payer breakdown survive (or is it discarded)?
- [ ] **Change & rounding** — `calculateChange` correct for IDR? Quick-cash buttons (exact, next 5k/10k/50k)? Does the drawer open only for cash?
- [ ] **Declined / retry** — card decline or network blip mid-payment: clean retry without losing the cart or double-charging (idempotency — see technical checklist)?
- [ ] **Receipt options** — print / no-print / digital? Reprint from `order-history`? Are totals/tax taken from the server, not recomputed client-side?

### F. Post-payment & shift
- [ ] **Refund / void path (`order-history`)** — how many steps, manager-gated, and does it reach the kitchen/inventory correctly?
- [ ] **Shift close clarity (`close_shift_v2`)** — does the cashier see expected vs counted cash and the variance reason before committing? Is a reason *required* above a variance threshold? Blind count (expected hidden) to deter fraud? Is the modal actually wired in prod?
- [ ] **Z-report handoff** — draft → manager-signed in BackOffice. Is the manager-PIN on signing actually validated, and is author attribution (`closed_by`/`signed_by`) the real profile id?
- [ ] **Mid-shift visibility** — `useLiveSessions`: can a manager see live sales/cash without closing?

## Technical-correctness checklist (secondary — gate every shippable proposal)

A feature proposal that touches a write path MUST respect these or it's not shippable. Cross-reference CLAUDE.md "Critical patterns".

- [ ] **Order writes go through RPCs, never raw inserts.** `complete_order_with_payment_v10`, `pay_existing_order_v6`, `create_tablet_order_v2`, `pickup_tablet_order` handle JE triggers, loyalty, promotions, table state, and the `display_stock`/`products.current_stock` double-deduction atomically. A new write path must reuse or extend these, not bypass them.
- [ ] **Idempotency, 2 flavors (S25).** Retry-safe HTTP via `x-idempotency-key` header (client `useRef(crypto.randomUUID())`), propagated to the RPC; OR business-semantic via a required RPC arg (`p_client_uuid`) keyed in a dedicated idempotency table (`tablet_order_idempotency_keys`). Any new "tap = money/order" action needs one. A double-tap that creates two orders is a P0 bug, not a polish item.
- [ ] **PIN / secrets in HTTP header, never body JSON (S25).** Manager PIN → `x-manager-pin` header. Bodies get logged by PostgREST/pgaudit/proxies. Refund/void/discount overrides all follow this. (`auth-verify-pin` still takes the PIN in the body — candidate finding.)
- [ ] **RPC versioning monotonic.** Never edit a published `_vN`. Create `_vN+1` + `DROP FUNCTION ... vN(<old args>)` in the same migration, then bump every caller (Grep the name across `apps/pos`). Regen types.
- [ ] **REVOKE pair S25 on every new RPC** (FROM PUBLIC + FROM anon + ALTER DEFAULT PRIVILEGES). `REVOKE FROM anon` alone is insufficient — anon inherits via PUBLIC.
- [ ] **Realtime channel uniqueness per mount.** New realtime feature → unique channel name per mount or StrictMode double-mount collides silently. Reproduce across two devices.
- [ ] **PIN-auth fetch wrapper.** POS uses a custom fetch wrapper injecting the PIN JWT (`setSupabaseAccessToken`). Never bypass with raw `Authorization` headers or `auth.setSession`.
- [ ] **Tax/price snapshot at order time.** `complete_order_*` snapshots tax rate (NON-PKP: PB1 10% output). Don't recompute historical orders at current rate.
- [ ] **audit_logs row per mutation** (canonical cols `actor_id / action / entity_type / entity_id / metadata`). Silent writes = no traceability.

## How to write a feature proposal

When you propose a feature or improvement, use this shape so the user can decide fast:

```
### [P0/P1/P2/P3] <short title>
**Gap** — what's missing/painful today, and where you saw it (file:line or flow traced).
**Who it helps** — cashier / waiter / kitchen / customer / manager, counter vs table path.
**Proposal** — the concrete change (UI + data + RPC). One paragraph.
**Fits existing patterns** — which RPC it extends, idempotency flavor, perm gate, realtime channel.
**Effort & risk** — rough size (S/M/L) + the riskiest invariant it touches.
**How to validate** — the pgTAP / smoke test or two-device repro that proves it works.
```

Keep proposals grounded: tie each to a real file or flow you read. Prefer extending an existing RPC/pattern over inventing a new subsystem — the codebase rewards reuse (S25 idempotency, manager-PIN header, `display_stock` isolation are all established seams).

## Sources of truth (verified pointers)

```
Docs reference (read first, canonical)
  docs/reference/04-modules/02-pos-cart-orders.md      # full POS lifecycle, invariants, hooks/stores
  docs/reference/04-modules/02b-orders.md
  docs/reference/04-modules/03-payments-split.md        # payment modal, split, methods, paymentStore
  docs/reference/04-modules/04-kds-kitchen.md           # KDS, mark-served, recall, stations, channels
  docs/reference/04-modules/12-cash-register-shift.md   # session open/close, variance, z-reports
  docs/reference/04-modules/13-promotions-discounts.md  # promo eval (RPC + fallback), BOGO, threshold
  docs/reference/04-modules/16-display-customer.md       # customer display, realtime broadcast
  docs/reference/04-modules/17-tablet-ordering.md        # tablet app, create/pickup, waiter flow

POS features (thin UI wiring — the journey)
  apps/pos/src/features/{cart,payment,kds,tablet,inbox,display,promotions,discounts,shift,heldOrders,tables,floor-plan,order-history,lan,loyalty,combos}/

Domain (pure TS — business logic, IO-free, unit-testable)
  packages/domain/src/orders/buildOrderPayload.ts       # final payload for process-payment EF
  packages/domain/src/cart/{mutations.ts,calculateTotals.ts}
  packages/domain/src/payment/{validatePayment.ts,calculateChange.ts,splitTender.ts}
  packages/domain/src/promotions/{evaluator.ts,bogoEngine.ts}
  packages/domain/src/{kitchen,tables,loyalty}/

Write paths
  supabase/functions/process-payment/index.ts           # → complete_order_with_payment_v10
  supabase/migrations/*order*.sql / *payment*.sql / *shift*.sql / *tablet*.sql

Patterns canon
  CLAUDE.md "Critical patterns" + active workplan (the live truth)
```

## Verification before claiming an audit or proposal is done

```bash
# Cheap, first
pnpm typecheck
pnpm --filter @breakery/domain test orders
pnpm --filter @breakery/domain test payment
pnpm --filter @breakery/domain test promotions

# POS smoke (per feature touched)
pnpm --filter @breakery/app-pos test payment
pnpm --filter @breakery/app-pos test tablet
pnpm --filter @breakery/app-pos test kds

# RPC-level: pgTAP via Supabase MCP execute_sql with BEGIN/ROLLBACK envelope.
# DB target is V3 dev cloud `ikcyvlovptebroadgtvd` — NEVER local Docker (retired),
# NEVER prod (V2 monolith `abjabuniwkqpfsenxljp`, incompatible lineage).
```

For any multi-device feature, **reproduce across two real surfaces** (a second tab is not enough for realtime channel bugs) before claiming it works.

## When to escalate / flag

- A proposal needs a **new order/payment write path** → don't bypass the canonical RPCs; extend them or flag the design first.
- A proposal touches **money on a retry-able tap** without idempotency → flag, it's a double-charge waiting to happen.
- About to **relax `orders.session_id NOT NULL`** or any CHECK on orders/payments → flag; S24/S25 correctives show these relaxations hide latent bugs across the tablet/b2b paths.
- A realtime feature can't be reproduced on a second device → not done; the bug is hiding in channel naming or mount lifecycle.
- The RPC version you find disagrees with this skill → trust the code, note the drift, and consider that the skill needs an update.
