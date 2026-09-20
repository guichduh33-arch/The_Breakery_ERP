# pos-flow-audit — méthode ciblée

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Discovery method — scan the flow, rank by impact
- The silent-failure sweep (do this on every audit — it's where the real findings hide)
- Product/UX audit checklist (primary)
- How to write a feature proposal

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

- **The action that lies.** A handler shows a success toast / advances the UI but never persists. Trace every "done!" signal back to a DB write or RPC call. If the success message isn't downstream of a real mutation, it lies. *(Cas historique, **corrigé** : l'envoi en cuisine était un verrouillage client sans écriture — « sent to kitchen » que le KDS ne voyait jamais. Le chemin vivant est `useFireToStations` → famille `fire_counter_order`, qui persiste avant d'imprimer. Ne re-signale pas ce bug-là : cherche de **nouvelles** instances de l'archétype.)*
- **The forced/hardcoded value that should be dynamic.** A field slammed to a constant regardless of input (receipt `method: 'cash'` for every tender; tax `0.10` hardcoded in 3 files while the server rate is dynamic). Grep for literal payment methods, tax rates, currency/locale, station names, role names, limits (`MAX_*`) — each is a candidate divergence from the source of truth.
- **The client recompute that diverges from the server.** UI recalculates a total/tax/discount instead of trusting the server result, and drifts (receipt total recomputed ignoring promotions/discounts). Anywhere the client does math the server already did, the two can disagree — flag it and prefer the server value as source of truth.
- **The unconditional side-effect.** A drawer opens / a print fires / a sync runs on *every* path when it should be conditional (cash drawer opens for QRIS/card payments). Look at effects that run on mount or on success with no guard.
- **The silent skip.** A `SELECT ... WHERE id = x` that inserts nothing when `x` doesn't exist, a `FOR` loop that drops unmatched rows, a filter that quietly excludes a value (`dispatch_station='none'` items fired to no KDS screen; missing-product row swallowed). No row, no error, truncated result. Check every set-based insert/loop for "what if the lookup matches nothing?"
- **The lost realtime event.** A subscription that only invalidates on live events with no refetch-on-reconnect / interval safety net — an event dropped during a Wi-Fi blip never recovers. Check every realtime hook for reconnection handling.
- **The dead branch.** A function that always returns the same value regardless of input (`resolveLoyaltyMultiplier` → always 1.0) — code that looks like logic but is inert. If a helper can't actually vary its output, the feature it implements doesn't exist.
- **The default that's wrong for this business.** A default that suits the generic case but not a counter-takeaway bakery (`order_type: 'dine_in'` default on a takeaway-dominant counter → skewed stats/tax). Check initial state against the real-world dominant path.

Run this sweep stage by stage alongside the four discovery questions. It is the single highest-value thing this skill does — a plain read will not surface these, and they outrank most UX polish. When you find one, it's almost always P0/P1.

**Where to spend the deep-read budget (so the sweep stays thorough without reading the whole app).** These bugs cluster in a handful of file types — open *these* function bodies first, and you'll find most silent failures fast:
- **Success/`onSuccess` handlers and effects** (`SuccessModal`, `useCheckout`, `useFireToStations`) — where toasts/prints/drawers fire and values get built for the receipt. Home of "the action that lies", "forced value", "unconditional side-effect".
- **The mutating RPC/EF bodies** the flow calls (familles `complete_order_with_payment`, `pay_existing_order`, `fire_counter_order`, `create_tablet_order`, `close_shift`, et l'EF `process-payment`) — read the SQL/loop of the **live** version, not just the signature, and not the original migration file (`pg_get_functiondef` fait foi). Home of "silent skip" and tax/total logic.
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
- [ ] **Hold / recall — serveur, LIVRÉ (ADR-022 déc. 4) : vérifier la non-régression, pas le manque.** Le parking passe par l'envoi en cuisine puis `hold_fired_order` ; la reprise par `reopen_held_order`, l'abandon par `discard_held_order`, la liste par `useHeldOrdersQuery` sur `orders`. « Survit à un refresh ? » et « partagé entre terminaux ? » sont **résolus par construction** — l'état vit en DB, pas dans le store. Ce qui reste auditable : la découvrabilité du geste, le comportement quand la commande n'a encore rien envoyé en cuisine, et **ce que `reopenOrder` remet à zéro** dans le `cartStore` (`appliedPromotions`, `dismissedPromotionIds`, `attachedCustomer`) : le badge client est re-fetché en best-effort par `useReopenHeldOrder`, mais **vérifie toi-même si les promotions sont ré-évaluées** après réouverture ou si le client paie sans elles — c'est un candidat de finding, pas un fait établi ici.
- [ ] **Order type switch** — dine-in ↔ takeaway mid-order: does it recompute tax/price correctly without restarting the cart? Is the default right for a takeaway-dominant counter?
- [ ] **Tablet table binding (`features/tables`, `floor-plan`)** — is the table picked before items? Can a waiter move an order to another table? Merge/split tables?

### B. Promotions & loyalty at the right moment
- [ ] **Promo visibility** — does `evaluate_promotions` show the customer/cashier *why* a discount applied, and what's one item away from a threshold? A silent promo is a missed upsell. Do applied promos survive a tab reload?
- [ ] **Loyalty at payment** — is point redemption offered at the natural moment, or buried? Is the customer's tier/balance visible during the order, not just at checkout?
- [ ] **Manager-PIN discounts (`features/discounts`)** — friction vs control: how many manager interruptions per shift? Is there a per-cashier discount ceiling instead of a PIN every time?

### C. Kitchen ↔ floor coordination (table path)
- [ ] **Send latency & confirmation — l'aller-retour DB EXISTE (ADR-022), auditer la non-régression.** `useFireToStations` appelle la famille `fire_counter_order`, qui **persiste la commande et ses lignes avant** de lancer l'impression : un échec d'impression ne laisse plus des lignes « non envoyées ». Preuve : `supabase/tests/adr022_paid_order_reaches_kds.test.sql` (+ `counter_fire.test.sql`). Ne re-signale pas « envoi client-only » comme un gap ouvert. Ce qui reste à vérifier : le retour d'échec au caissier quand la persistance passe mais que le ticket de station ne sort pas, et le comportement en mode hors-ligne (`isOfflineMode` → `offlineOutbox`).
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
- [ ] **Split tender & split bill** — `pay_existing_order` is multi-tender (split *payment*). Is there a split-*bill* (per-guest) path for a shared table? Is the split flow reachable on the table path, and does the per-payer breakdown survive (or is it discarded)?
- [ ] **Change & rounding** — `calculateChange` correct for IDR? Quick-cash buttons (exact, next 5k/10k/50k)? Does the drawer open only for cash?
- [ ] **Declined / retry** — card decline or network blip mid-payment: clean retry without losing the cart or double-charging (idempotency — see technical checklist)?
- [ ] **Receipt options** — print / no-print / digital? Reprint from `order-history`? Are totals/tax taken from the server, not recomputed client-side?

### F. Post-payment & shift
- [ ] **Refund / void path (`order-history`)** — how many steps, manager-gated, and does it reach the kitchen/inventory correctly?
- [ ] **Shift close clarity (`close_shift`) — LIVRÉ et durci : vérifier la non-régression, pas le manque.** Sont en place et se testent comme des acquis : note de variance **exigée par le serveur** au-delà du seuil (erreur `variance_note_required`), **PIN manager** requis sur gros écart (seuils dans `business_config`, badge `VarianceWarningBadge`), **comptage à l'aveugle** (le caissier saisit le compté sans voir l'attendu ; attendu et écart n'apparaissent qu'ensuite), grille de **dénominations** et comptage **three-way** cash / QRIS / carte (`DenominationGrid`), bucket **ewallet/QRIS** distinct, `closed_by` écrit avec un **id de profil** (jamais `auth.uid()`), et la modale `CloseShiftModal` est bien câblée (menu latéral + page POS). Ne re-signale aucun de ces points comme un gap ouvert. Reste auditable : la lisibilité de l'écart une fois révélé. En revanche le PIN manager passé en **argument de RPC** n'est PAS un défaut (arbitrage du 2026-08-31) — voir la règle de transport ci-dessous.
- [ ] **Z-report handoff** — draft → manager-signed in BackOffice. Is the manager-PIN on signing actually validated, and is author attribution (`closed_by`/`signed_by`) the real profile id?
- [ ] **Mid-shift visibility** — `useLiveSessions`: can a manager see live sales/cash without closing?

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
