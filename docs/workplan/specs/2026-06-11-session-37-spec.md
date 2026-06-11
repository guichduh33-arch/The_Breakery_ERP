# Session 37 — Fraud Hardening & Correctness Close-out (Spec)

> **Date** : 2026-06-11
> **Branche cible** : `swarm/session-37`
> **Base** : `master` @ `06b8283` (post-merge S36 PR #68).
> **Effort estimé** : ~5-7 jours wall-time (M) — close-out, zéro nouvelle feature. Mix money-flow DB hardening (M/L), POS correctness (S/M), BO quick fixes (S), customers PII cutover (M).
> **Status** : **spec** — plan détaillé rédigé en parallèle via `superpowers:writing-plans` (voir [`../plans/2026-06-11-session-37-plan.md`](../plans/2026-06-11-session-37-plan.md)).
> **Source** : audit complet 6-agents (POS / BackOffice / DB / sécurité-fraude / tests / pattern-guardian) sur `master` post-S36 (2026-06-11).
> **Predecessor** : [`./2026-06-04-session-36-spec.md`](./2026-06-04-session-36-spec.md).

---

## 1. Contexte

S34 a fermé les 4 dettes critiques POS (Send-to-Kitchen no-op, enum drift partiel, receipt/drawer fraud, PIN-en-body void/cancel). S35/S35a ont livré la couche service/polish (held orders DB-backed, virtual keypad, customer-display cart mirror, settings printing, lock terminal, PaymentTerminal refactor). S36 a fermé le résidu de correctness/sécurité POS (F-008 REVOKE pair, F-002 enum sweep, F-021 typings, idle→lock, customer re-fetch, VKP a11y). En parallèle, les PR #53 (security fraud-guard) / #59 / #60 ont posé des fondations de durcissement.

L'audit 6-agents post-S36 identifie un nouveau lot de findings, dont **plusieurs failles money-flow réelles côté serveur** (remises non validées, prix client non réconcilié, rate-limit absent sur le chemin de paiement, PIN Z-report jamais lu) ainsi qu'un lot de bugs de **correctness POS visibles client** (total `0` hardcodé sur le pickup tablette, total customer-display pré-promo, points loyauté faux sur le reçu, void post-cuisine client-only) et du **dead code de sécurité** (les RPCs customers PII de PR #53 `_040`/`_042` non câblés ; la migration gate `_043` commitée mais DEFERRED).

S37 est une session **close-out fraud-hardening + correctness** : on ferme la queue de sécurité argent et de correctness avant d'ouvrir la prochaine vague de features POS. **Direction : "Fraud Hardening & Correctness close-out", zéro nouvelle feature.** Les refactors risqués (auth BO `setSession`) et les features (split-bill, ProductPicker, etc.) sont explicitement reportés.

**Périmètre S37 (4 waves)** :

| Wave | Item | Sévérité audit | Effort | Nature |
|---|---|---|---|---|
| A — Sécurité argent | SEC-01 — remises non validées serveur (RPC v10 + v6) | 🔴 High | M | DB bump + EF + audit_log |
| A — Sécurité argent | SEC-02 — `unit_price` client non réconcilié vs `retail_price` | 🔴 High | M | DB (même bump v10/v6) |
| A — Sécurité argent | SEC-04 — `loyalty_transactions` REVOKE INSERT/UPDATE/DELETE | 🟡 Medium | S | DB corrective |
| A — Sécurité argent | DB-02 — `process-payment` EF sans rate-limit durable | 🔴 High | S | EF |
| A — Sécurité argent | BO-01 — `sign_zreport_v1` PIN jamais lu | 🔴 Critical | M | EF wrapper (S25 pattern) |
| B — Correctness POS | POS-01 — `total: 0` hardcodé pickup tablette | 🔴 Critical | S/M | POS (+ RPC return) |
| B — Correctness POS | POS-02 — customer display total pré-promo | 🔴 High | S | POS front |
| B — Correctness POS | POS-04 — `balance_after: 0` reçu loyauté | 🔴 High | S | POS front |
| B — Correctness POS | POS-06 — void panier post-cuisine client-only | 🔴 High | L | POS (+ EF void-order) |
| B — Correctness POS | POS-05 — `TAX_RATE = 0.10` hardcodé ×7 | 🔴 High | M | POS + domain const |
| C — BO + PII cutover | BO-02 — queryKeys fantômes order detail | 🔴 High | S | BO front |
| C — BO + PII cutover | BO-03 — erreur OrdersListPage swallowed | 🟢 low | S | BO front |
| C — BO + PII cutover | BO-05 — bouton PDF Z-report partagé | 🟢 low | S | BO front |
| C — BO + PII cutover | BO-12 — OrderDetailPage back URL | 🟢 low | XS | BO front |
| C — BO + PII cutover | SEC-03/DB-03/DB-06 — câbler customers RPCs + gate `_043` | 🔴 High | M | POS + DB (cutover) |
| D — Tests + docs | TEST-02 — gate pgTAP PR-time CI | 🟡 Medium | M | CI |
| D — Tests + docs | TEST-01 — backfill `skipIf` guard 57 fichiers Vitest | 🟡 Medium | S | tests |
| D — Tests + docs | PAT-05/06/17/18 — rafraîchir CLAUDE.md | — | S | docs |
| D — Tests + docs | pgTAP nouveaux (SEC-01/02/04, BO-01) | — | M | tests |

**Ordre de priorité & dépendances** :
- **Wave A** d'abord (sécurité argent — débloque rien d'autre mais c'est la priorité business ; tâches A1-A5 indépendantes entre elles, parallélisables une fois Task 0 vert).
- **Wave B** indépendante de A (POS front + une partie RPC return). **POS-01 dépend** du choix de design RPC return de A (SEC-01/02 bumpent v6/v10 — POS-01 peut alors lire le `total` réel du même envelope → **B doit consommer le bump A**, donc B partiellement dépendant de A1).
- **Wave C** : les quick fixes (BO-02/03/05/12) sont indépendants. Le **cutover PII (SEC-03/DB-03)** est un **HARD CUTOVER** : il faut câbler les 4 sites POS sur les RPCs definer PUIS appliquer la migration `_043` dans le même déploiement — séquencé strictement (front d'abord, migration ensuite). **Bloquant préalable** : `search_customers_v1` ne retourne PAS l'embed `customer_categories` requis pour le pricing POS (voir §4.5) — arbitrage de design requis.
- **Wave D** en dernier (tests transverses + docs closeout). Les pgTAP nouveaux suivent leur wave respective (A).

### Déjà fermés (closed prior — NE PAS inclure)
- **F-001..F-008 / F-021 / DEV-S35-* / idle→lock / VKP a11y** — fermés S34/S35/S36.
- **PIN-en-body void/cancel** — fermés S34 (F-006). `refund-order` PIN-header — fermé S25. Reste `sign_zreport_v1` (BO-01) traité ci-dessous.
- **Reversal RPCs acting_user / MV anon / vues security_invoker / pin_hash grant / customers RPCs creation** — fermés PR #53/#59/#60 (mais le **câblage** customers + le **gate** `_043` restent à faire — Wave C).

---

## 2. Wave A — Sécurité argent (DB + EF)

### 2.1 SEC-01 — Remises non validées côté serveur 🔴 High

**Problème (vérifié).** Deux RPCs de paiement stockent les remises fournies par le client sans aucune validation d'autorité :

- `pay_existing_order_v6` (`supabase/migrations/20260517000016_bump_pay_existing_order_v6.sql:281-285`) écrit `p_discount_amount`, `p_discount_type`, `p_discount_value`, `p_discount_reason`, `p_discount_authorized_by` **verbatim** dans `orders`. Aucun `has_permission(p_discount_authorized_by, 'discount.*')`, aucune vérification PIN du manager nommé. Le seul gate est `payments.process` (ligne 79). Un caissier peut donc appliquer une remise arbitraire et nommer n'importe qui comme `authorized_by`.
- `complete_order_with_payment_v10` (`supabase/migrations/20260530190828_bump_complete_order_v10.sql:201,367,332`) applique les `discount_amount` per-item (`v_line_discount`) du cart client + le `p_discount_amount` order-level, avec pour seul gate `pos.sale.create` (ligne 101). `p_discount_authorized_by` est inséré verbatim (ligne 332).

**Risque.** Fraude employé : remises illimitées sans approbation manager, traçabilité falsifiée (`authorized_by` non vérifié). Pas de ligne `audit_logs` dédiée à la remise (SEC-05).

**Architecture proposée (bump RPC + PIN-en-header).**
- Bump `complete_order_with_payment_v10 → v11` et `pay_existing_order_v6 → v7` (DROP de l'ancienne signature dans la même migration — règle versioning monotone).
- Ajouter un argument `p_manager_pin TEXT DEFAULT NULL` aux deux RPCs (transmis par le POS via header `x-manager-pin` à l'EF `process-payment`, qui le relaie en arg RPC ; pour `pay_existing_order_v6` qui est appelé **directement** par le POS via `supabase.rpc`, voir l'arbitrage §2.1.1).
- **Validation** : si une remise non-nulle est présente (order-level `p_discount_amount > 0` OU une ligne avec `discount_amount > 0`), alors **exiger** un `p_discount_authorized_by` qui (a) détient la permission `orders.discount` (nouvelle permission seedée, ou réutiliser une existante — Task 0 vérifie l'inventaire) ET (b) dont le PIN correspond (`verify_manager_pin(p_discount_authorized_by, p_manager_pin)` — helper existant ou à créer ; Task 0 vérifie le pattern utilisé par les autres RPCs PIN comme `close_fiscal_period_v1`).
- **Audit (SEC-05)** : écrire une ligne `audit_logs` `action='order.discount_applied'` avec `metadata = { order_id, discount_amount, discount_type, line_discounts, authorized_by, rpc_version }`.

> **Arbitrage de design (à trancher Task 0)** : la vérification PIN suit le pattern projet "PIN-en-header HTTP, jamais body". `complete_order_with_payment_v10` est appelé **server-side** par l'EF `process-payment` → l'EF lira `x-manager-pin` et le passera en arg RPC (cohérent S25). `pay_existing_order_v6` est appelé **directement** par le POS via `supabase.rpc` (pas d'EF intermédiaire) — le PIN ne peut donc pas transiter par un header HTTP custom lu côté serveur dans une RPC PostgREST sans `current_setting('request.headers')`. **Option recommandée** : router le flow pickup tablette avec remise via l'EF `process-payment` également, OU lire le PIN via `current_setting('request.headers', true)::jsonb->>'x-manager-pin'` dans la RPC (PostgREST expose les headers ainsi). À valider en Task 0 selon ce que le projet supporte déjà.

#### 2.1.1 SEC-01 — Sous-arbitrage `pay_existing_order_v6`
Si lire le header dans une RPC PostgREST s'avère fragile, **fallback** : la remise sur un order pickup tablette est rare ; on peut en V1 **refuser** toute remise non-nulle sur `pay_existing_order_v7` sauf si `p_discount_authorized_by` détient `orders.discount` (gate permission seul, sans PIN) et logger l'audit. Le PIN reste exigé sur le chemin `complete_order_with_payment_v11` (chemin principal, via EF). À documenter comme déviation si retenu.

**Critère d'acceptation.** pgTAP : (T1) remise > 0 sans `authorized_by` → exception ; (T2) remise > 0 avec `authorized_by` sans permission `orders.discount` → exception ; (T3) remise > 0 avec authorized_by valide + PIN correct → succès + ligne `audit_logs` `order.discount_applied` ; (T4) remise > 0 + PIN incorrect → exception ; (T5) order sans remise → pas de PIN requis, succès.

### 2.2 SEC-02 — `unit_price` client non réconcilié 🔴 High

**Problème (vérifié).** `complete_order_with_payment_v10:194` : `v_unit_price := (v_item->>'unit_price')::DECIMAL;` — le prix unitaire vient **du cart client**, jamais comparé à `products.retail_price`. Idem `hold_order_v1` et la construction de `line_total` (`:202`, `:368`). Un client malveillant (ou un POS compromis) peut envoyer un `unit_price` arbitraire (ex. 0).

**Architecture proposée (même bump v10→v11 / v6→v7).** Pour chaque ligne, charger `products.retail_price` côté serveur et **réconcilier** :
- Si `unit_price` client == `retail_price` serveur → OK.
- Si différent → autorisé **uniquement** si la ligne porte un override explicite (`discount_*` non-nul authentifié/audité, voir SEC-01) ; sinon **forcer** `v_unit_price := products.retail_price` (source de vérité serveur) OU lever une exception. **Recommandation** : forcer le prix serveur (silencieux, robuste) + logger un `audit_logs` `order.price_overridden` si l'écart dépasse une tolérance. À trancher Task 0 (forcer vs lever).

> **Note** : `pay_existing_order_v6` utilise déjà `order_items.line_total` déjà persistés (ligne 138) — le risque y est moindre (le prix a été figé au `create_tablet_order`). La réconciliation prioritaire est sur `complete_order_with_payment` (chemin où le client envoie les lignes). Documenter le périmètre exact en exécution.

**Critère d'acceptation.** pgTAP : (T1) ligne avec `unit_price` < `retail_price` sans override → prix forcé au `retail_price` serveur (ou exception selon arbitrage) ; (T2) ligne avec override autorisé → `unit_price` client respecté ; (T3) ligne au `retail_price` exact → inchangé.

### 2.3 SEC-04 — `loyalty_transactions` append-only 🟡 Medium

**Problème (vérifié).** `loyalty_transactions` n'a aujourd'hui qu'une protection RLS, pas de `REVOKE INSERT/UPDATE/DELETE` au niveau rôle. C'est un ledger (earn/redeem) qui devrait être append-only et écrit **uniquement** par les RPCs SECURITY DEFINER (`pay_existing_order_v6`, `complete_order_with_payment_v10` écrivent déjà dedans en definer).

**Architecture proposée.** Migration corrective :
```sql
REVOKE INSERT, UPDATE, DELETE ON public.loyalty_transactions FROM authenticated, anon, PUBLIC;
```
Les RPCs definer (owner `postgres`) continuent d'écrire. Aligné sur le pattern `stock_movements` (append-only ledger).

**Critère d'acceptation.** pgTAP : `has_table_privilege('authenticated', 'public.loyalty_transactions', 'INSERT')` → `false` (idem UPDATE/DELETE) ; une vente via RPC continue d'insérer une ligne earn (definer non affecté).

### 2.4 DB-02 — `process-payment` EF sans rate-limit 🔴 High

**Problème (vérifié).** `supabase/functions/process-payment/index.ts` n'importe ni n'appelle `checkRateLimitDurable` — alors que `refund-order` (`:25,49`), `void-order`, `cancel-item`, `auth-verify-pin`, `kiosk-issue-jwt` l'ont (S19). Le chemin de paiement (le plus sensible) est non rate-limité.

**Architecture proposée.** Ajouter `import { checkRateLimitDurable, getClientIp } from '../_shared/rate-limit.ts';` + un check au début du handler (pattern identique : bucket `process-payment`, fenêtre/limite alignées sur `refund-order`). Fail-open sur erreur DB (trade-off projet S19). Redéployer l'EF via MCP.

**Critère d'acceptation.** Code review : import + appel présents, pattern identique à `refund-order`. Vitest live (env-gated) : N+1 requêtes rapides → 429. Pas de régression du happy-path checkout (smoke POS golden-path).

### 2.5 BO-01 — `sign_zreport_v1` PIN jamais lu 🔴 Critical

**Problème (vérifié spec S29).** Le hook BO `useSignZReport` envoie le PIN via header `x-manager-pin` sur un appel **RPC PostgREST direct** (`supabase.rpc`). `sign_zreport_v1` (S29) ne lit jamais ce header — la signature Z-report (document fiscal conformité Indonésie 7 ans) est donc accordée **sans vérification du PIN**. C'est un trou de contrôle Critical sur un document légal.

**Architecture proposée (EF wrapper — cohérent refund/void/cancel S25).** Créer une Edge Function `sign-zreport` qui :
1. Lit le PIN via `getManagerPin(req)` (header `x-manager-pin`, jamais body — pattern S25).
2. Vérifie le PIN du manager appelant (helper `verify_manager_pin` / pattern `close_fiscal_period_v1` qui prend `p_manager_pin`).
3. Appelle `sign_zreport_v1` en service-role (ou un `sign_zreport_v2(p_zreport_id, p_manager_pin)` qui valide le PIN en arg — **alternative** : bumper la RPC pour prendre `p_manager_pin` et valider, sans EF). **Arbitrage Task 0** : EF wrapper (cohérence refund/void/cancel) **vs** bump `sign_zreport_v2(p_zreport_id, p_manager_pin)` (plus simple, pas d'EF, le PIN reste en arg validé serveur — acceptable car appel BO authentifié, pas de chemin externe). **Recommandation : bump `sign_zreport_v2` avec `p_manager_pin` validé** (l'EF wrapper n'apporte de valeur que si le PIN doit transiter par header HTTP ; ici l'appel est BO interne, le PIN en arg validé suffit et évite une EF de plus). Le hook BO `useSignZReport` envoie alors le PIN en arg RPC (pas header). À trancher.

> **Si EF wrapper retenu** : rate-limit + idempotency `x-idempotency-key` (S25), redéploiement MCP, hook BO POST vers l'EF.

**Critère d'acceptation.** pgTAP : (T1) `sign_zreport_v2` sans PIN ou PIN incorrect → exception (pas de signature) ; (T2) PIN correct + permission `zreports.sign` → `z_reports.status='signed'` + audit_log `zreport.signed` ; (T3) replay idempotent inchangé.

---

## 3. Wave B — Correctness POS (front + RPC return)

### 3.1 POS-01 — `total: 0` hardcodé pickup tablette 🔴 Critical

**Problème (vérifié).** `apps/pos/src/features/payment/hooks/useCheckout.ts:95-102` — la branche `pickedUpOrderId` (paiement d'un order tablette existant via `pay_existing_order_v6`) retourne :
```ts
return { ok: true, order_id: pickedUpOrderId, order_number: …, total: 0, tax_amount: 0, change_given: null };
```
`total: 0` + `tax_amount: 0` **hardcodés** → SuccessModal affiche un total faux, le reçu est faux, le calcul de monnaie rendue est faux pour **tout** paiement pickup tablette.

**Architecture proposée.** `pay_existing_order_v6` retourne aujourd'hui seulement `UUID` (l'order_id). Deux options :
- **Option A (recommandée, alignée sur Wave A)** : dans le bump `pay_existing_order_v6 → v7` (déjà requis par SEC-01/02), changer le retour de `UUID` → `jsonb` (comme `complete_order_with_payment_v10` retourne déjà un envelope) exposant `{ order_id, order_number, total, tax_amount, change_given }`. `useCheckout` lit le vrai total.
- **Option B (front-only fallback)** : calculer le total côté client depuis le cart (`calculateTotals`) — mais le serveur recalcule (remises/promos), donc divergence possible. Rejeté au profit d'A si le bump v7 a lieu de toute façon.

> **Dépendance** : POS-01 (Wave B) **consomme** le bump v7 de SEC-01/SEC-02 (Wave A). Donc B1 (POS-01) attend A1. Si A change le return en `jsonb`, mettre à jour le typage `PayExistingOrderArgs`/return + regen types.

**Critère d'acceptation.** Smoke POS : après un paiement pickup tablette, `SuccessModal` reçoit le `total` réel (pas 0) et le `change_given` correct. `pnpm --filter @breakery/app-pos typecheck` PASS.

### 3.2 POS-02 — Customer display total pré-promo 🔴 High

**Problème (vérifié).** `apps/pos/src/features/display/hooks/useCartBroadcast.ts:21` : `calculateTotals(cart, TAX_RATE)` ne soustrait **pas** les promotions appliquées (`appliedPromotions` vit dans le store, pas dans `cart`). Le customer display affiche donc le total **pré-promo** (faux, supérieur au montant à payer).

**Architecture proposée.** Inclure la déduction promotions dans le total broadcasté : lire `appliedPromotions` depuis le store (`useCartStore.getState().appliedPromotions`) + `cartDiscount`, soustraire leur montant du total avant `postMessage`. Réutiliser la même logique de total que `usePaymentFlowLogic` (source de vérité du montant à payer) plutôt que `calculateTotals` brut. À aligner sur le calcul réel du PaymentTerminal.

**Critère d'acceptation.** Smoke POS : avec une promo appliquée, le message broadcast porte un `total` = items − promo − discount (pas le total brut). `pnpm --filter @breakery/app-pos typecheck` PASS.

### 3.3 POS-04 — `balance_after: 0` reçu loyauté 🔴 High

**Problème (vérifié).** `apps/pos/src/features/payment/SuccessModal.tsx:67` : `loyalty: { points_earned: props.pointsEarned, balance_after: 0 }` — `balance_after` hardcodé à `0`. Le reçu affiche un solde de points faux (toujours 0).

**Architecture proposée.** Threader `loyalty_points_after` depuis la réponse RPC. `complete_order_with_payment_v10` retourne déjà un envelope jsonb — vérifier s'il expose le solde post-vente (sinon l'ajouter dans le bump v11, additif). Passer la valeur en prop `SuccessModal` (`loyaltyBalanceAfter?`) et l'utiliser au lieu de `0`. Si le solde n'est pas disponible, omettre le champ plutôt que d'afficher `0` (moins faux).

**Critère d'acceptation.** Smoke POS : reçu d'une vente avec customer attaché → `balance_after` = solde réel (ou champ omis), jamais `0` codé en dur. `pnpm --filter @breakery/app-pos typecheck` PASS.

### 3.4 POS-06 — Void panier post-cuisine client-only 🔴 High

**Problème (vérifié).** `apps/pos/src/features/cart/BottomActionBar.tsx:121,287` → le bouton void appelle `cartStore.voidOrder()` (pur client). Si des items ont déjà été envoyés en cuisine (`is_locked=true` / `sent_to_kitchen_at`), le KDS continue la préparation alors que le panier est vidé côté caisse — perte de contrôle (gaspillage / fraude : annuler une commande déjà en prod sans trace serveur).

**Architecture proposée.** Avant le reset local : si des items du cart sont lockés (déjà envoyés — `cartStore` track `printedItemIds`/`is_locked` via S34), router vers le chemin **serveur** (EF `void-order` existant, PIN-header S34) pour annuler l'order serveur ET notifier le KDS, PUIS reset local. Si aucun item locké (rien envoyé), le void purement client reste valide (pas d'order serveur). Distinguer les deux cas dans `BottomActionBar` / le handler de void.

> **Effort L** : nécessite de savoir si un order serveur existe (draft envoyé en cuisine via `send_items_to_kitchen`) et de câbler l'EF void-order avec PIN. Vérifier l'état réel du cart (un cart POS counter avant checkout n'a pas forcément d'order serveur — seul l'envoi cuisine crée/locke des items). À cartographier en exécution (Task 0 + lecture `cartStore` + `useSendToKitchen`).

**Critère d'acceptation.** Smoke POS : void d'un cart avec items lockés → appel du chemin serveur void (EF void-order, PIN requis) avant reset ; void d'un cart sans items lockés → reset client direct (pas d'appel serveur). `pnpm --filter @breakery/app-pos typecheck` PASS.

### 3.5 POS-05 — `TAX_RATE = 0.10` hardcodé ×7 🔴 High

**Problème (vérifié).** 7 fichiers POS définissent `const TAX_RATE = 0.10` localement : `ActiveOrderPanel.tsx:35`, `BottomActionBar.tsx:51`, `usePrintBill.ts:14`, `useApplyCartDiscount.ts:8`, `useCartBroadcast.ts:5`, `usePaymentFlowLogic.ts:26`, `SuccessModal.tsx:12`. Le serveur lit `business_config.tax_rate` (cf. `pay_existing_order_v6:136`, `complete_order_with_payment_v10`). Si le taux change (10% → autre), 7 fichiers divergent silencieusement du serveur.

**Architecture proposée (2 étapes).**
1. **Centraliser** : ajouter `DEFAULT_TAX_RATE = 0.10` dans `@breakery/domain` (IO-free constant) + remplacer les 7 imports locaux. Élimine la divergence interne immédiate.
2. **(Idéalement) lecture `business_config`** : un hook `useTaxRate()` (TanStack Query, cache long) lit `business_config.tax_rate` au boot et le fournit aux composants. **Arbitrage** : l'étape 2 est plus risquée (async, fallback si non chargé) — **recommandation V1 : étape 1 seule** (constante domain partagée), étape 2 reportée S38 si le business veut un taux dynamique. À trancher utilisateur.

> **Note** : le taux serveur reste la source de vérité (les RPCs recalculent). La constante front sert l'affichage/preview avant checkout. La centraliser empêche la dérive d'affichage.

**Critère d'acceptation.** `git grep "TAX_RATE = 0.1" apps/pos/src` → 0 (tous importent la constante domain). `pnpm --filter @breakery/app-pos typecheck` PASS + suites POS cart/payment vertes.

---

## 4. Wave C — BO quick fixes + cutover customers PII

### 4.1 BO-02 — queryKeys fantômes order detail 🔴 High

**Problème (vérifié).** `useOrderDetail.ts:62` keye `['order-detail', id]`, mais `useEditOrderItems.ts:74` invalide `['orders', 'detail', orderId]` et `useVoidOrder.ts:57` invalide `['orders', 'detail']`. Les invalidations **ne matchent jamais** la query → après un void/edit en BO, le détail order affiché est **périmé** (pas de refetch).

**Architecture proposée.** Aligner les clés : choisir une convention unique (recommandé `['order-detail', id]` — déjà utilisée par la query) et corriger les 2 invalidations pour matcher (`['order-detail', orderId]`). Vérifier qu'aucun autre consommateur ne dépend de l'ancienne clé fantôme.

**Critère d'acceptation.** Unit/smoke BO : après mutation void/edit, `invalidateQueries` cible la clé réellement utilisée par `useOrderDetail`. Idéalement un test asserte le refetch.

### 4.2 BO-03 — erreur OrdersListPage swallowed 🟢 low

**Problème (vérifié).** `OrdersListPage.tsx:117` — une erreur est avalée silencieusement (pas de toast, pas de surface UI).

**Architecture proposée.** Ajouter un `toast.error` (sonner) sur l'erreur + éventuellement un état d'erreur visible dans la liste. Aligné sur le pattern toast du projet.

**Critère d'acceptation.** Smoke BO : sur erreur de fetch, un toast s'affiche.

### 4.3 BO-05 — bouton PDF Z-report partagé 🟢 low

**Problème (vérifié).** `ZReportsListPage.tsx:43` — une mutation PDF partagée désactive **tous** les boutons "Generate PDF" de toutes les lignes pendant qu'une seule génère. Devrait être un état `isPending` par row (par `zreport_id`).

**Architecture proposée.** Tracker l'id en cours (`useState<string | null>` du row actif, ou comparer `mutation.variables`) et ne désactiver que la ligne concernée.

**Critère d'acceptation.** Smoke BO : générer le PDF d'une ligne ne désactive pas les boutons des autres lignes.

### 4.4 BO-12 — OrderDetailPage back URL 🟢 low

**Problème (vérifié).** Le bouton retour de `OrderDetailPage` navigue vers `/backoffice` au lieu de `/backoffice/orders` (la liste d'où l'on vient).

**Architecture proposée.** Corriger la cible de navigation vers `/backoffice/orders`.

**Critère d'acceptation.** Smoke/visuel : back depuis le détail order → liste orders.

### 4.5 SEC-03 / DB-03 / DB-06 — Câbler customers RPCs + appliquer le gate `_043` 🔴 High (HARD CUTOVER)

**Problème (vérifié).** PR #53 a créé les RPCs definer `search_customers_v1` / `get_customer_v1` / `create_customer_v1` (`_040`) et `get_pos_b2b_debts_v1` (`_042`), MAIS **aucun n'est câblé** — le POS lit toujours `customers` en direct (PII non gatée) :
- `useCustomerSearch.ts:22-27` — direct `from('customers').select(CUSTOMER_SELECT)…`
- `useCreateCustomer.ts:29-39` — direct `from('customers').insert().select()`
- `Pos.tsx` (inline `searchCustomers`/`createCustomer`)
- `useRestoreHeldOrder.ts` — re-fetch customer (ajouté S36 via `CUSTOMER_SELECT`)
- `useOutstandingDebts.ts` — orders + embed `customer:customers(...)`

La migration `20260619000043_gate_customers_read.sql` est **commitée mais DEFERRED** (commentaire en tête : "DO NOT APPLY until the POS reads are migrated"). **Task 0 DOIT vérifier via MCP `list_migrations` qu'elle n'est PAS dans `schema_migrations`** ; si elle l'est (appliquée par erreur), le POS lit `customers` en direct → **PII cassée pour les rôles POS** → hotfix immédiat (câblage front ou rollback du gate).

**⚠️ Blocage de design (critique).** `search_customers_v1` / `get_customer_v1` / `create_customer_v1` retournent une **projection plate** (`category_id` mais **PAS** l'embed `customer_categories`). Or le POS a besoin de l'objet `category` complet (`price_modifier_type`, `discount_percentage`, `points_multiplier`, …) pour le **pricing et la loyauté** — cf. `useCheckout.ts:54` (`attachedCustomer.category.points_multiplier`) et `CUSTOMER_SELECT` (S36) qui embarque tout `customer_categories`. **Les RPCs actuels sont donc insuffisants en l'état.** Le commentaire `_043` (lignes 16-20) le note explicitement.

**Architecture proposée (cutover séquencé strict).**
1. **Étendre les RPCs** (bump ou nouvelle version) pour retourner l'objet category nécessaire au pricing POS : soit joindre `customer_categories` et retourner les colonnes pricing/loyalty dans le TABLE result (`search_customers_v2`/`get_customer_v2`), soit retourner `category_id` + un fetch séparé `customer_categories` côté client (déjà non-gatée ? vérifier — sinon une RPC `get_customer_category_v1`). **Arbitrage Task 0** : étendre le TABLE result des RPCs existants (recommandé, 1 round-trip) vs fetch séparé. **Recommandation : `search_customers_v2`/`get_customer_v2`/`create_customer_v2` retournant les colonnes category pricing/loyalty** (REVOKE pair canonique sur chaque, DROP des v1 dans la même migration si bump).
2. **Câbler les 4+1 sites POS** sur les RPCs (front, sans encore appliquer le gate) — l'app continue de fonctionner car `customers` SELECT est encore ouvert.
3. **Migrer `useOutstandingDebts` → `get_pos_b2b_debts_v1`** (DB-06).
4. **Build + déploiement front** des 4 sites câblés.
5. **PUIS appliquer la migration gate `_043`** (renumérotée dans le bloc S37 `20260621…` si on la re-crée, ou appliquer le fichier existant via MCP — Task 0 tranche). Le gate ferme le canal PII direct ; les rôles POS passent par les RPCs definer ; les rôles BO conservent l'accès direct via `customers.read`.

> **Risque cutover** : si la migration gate part **avant** que le front câblé soit déployé, le POS casse (lecture customers → 0 rows). Séquence stricte : front d'abord, gate ensuite, dans le même déploiement (pattern S25 refund cutover). Documenter en déviation.

**Critère d'acceptation.**
- Task 0 : `_043` confirmée NON appliquée (sinon hotfix).
- pgTAP : après gate, `auth_read` policy exige `customers.read` ; un rôle CASHIER ne peut plus `SELECT * FROM customers` ; les RPCs definer retournent les lignes (avec category pricing) pour un appelant authentifié.
- Smoke POS : recherche client + attach + checkout avec category pricing fonctionnent via RPCs (pas de SELECT direct). `git grep "from('customers')" apps/pos/src` → 0 (ou seulement via RPC wrapper).
- Smoke POS : panel B2B debts via `get_pos_b2b_debts_v1`.

---

## 5. Wave D — Tests + docs

### 5.1 TEST-02 — gate pgTAP PR-time CI 🟡 Medium

**Problème.** Le seul check pgTAP automatisé est le cron nocturne (`pgtap-nightly.yml`, S16) — pas de gate au moment de la PR (DEV-S16-1.A-01). Une régression DB n'est détectée que la nuit.

**Architecture proposée.** Ajouter un job dans `.github/workflows/ci.yml` qui exécute un **subset smoke** pgTAP (ou les fichiers touchés par la PR) contre le V3 dev cloud. **Arbitrage** : exécuter tout le suite pgTAP à chaque PR est lent/coûteux ; un subset smoke (REVOKE pairs critiques + RPCs money-flow) est un bon compromis. Nécessite les secrets cloud dans CI (`SUPABASE_SERVICE_ROLE_KEY` / connection string) — vérifier leur présence (gap S13 staging-deploy secrets). Si les secrets ne sont pas configurés, livrer le job en mode `continue-on-error` ou documenter le blocker.

**Critère d'acceptation.** Le job CI s'exécute sur PR et fait échouer le build si un pgTAP smoke critique échoue (ou est skippé proprement si secrets absents, documenté).

### 5.2 TEST-01 — backfill `skipIf` guard 🟡 Medium

**Problème.** 57 fichiers Vitest live (RPC EF) n'ont pas le guard `describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)` → ils échouent en CI sans le secret (baseline env-gated, DEV-S25-2.A-02 / S19-2.A-01) au lieu de skipper proprement.

**Architecture proposée.** Mécanique : wrapper chaque `describe` live avec `describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)` (ou un helper partagé `liveDescribe`). Script idempotent ou édition manuelle ciblée des 57 fichiers. Préserver le comportement quand le secret EST présent (tests s'exécutent).

**Critère d'acceptation.** `pnpm test` sans secret → les 57 suites live skippent (pas d'échec env-gated). Avec secret → s'exécutent.

### 5.3 PAT-05/06/17/18 — rafraîchir CLAUDE.md 🟢 doc

**Problème.** Le §Active Workplan de CLAUDE.md est périmé sur plusieurs points :
- S36 décrite comme "PR pending" alors que **PR #68 est mergée** (master @ `06b8283`).
- PR #66 (reload-fix) décrite comme "open" alors qu'elle est **mergée** (master @ `a6da9a5`).
- Le sweep PIN-header (`void-order`/`cancel-item`/`kiosk-issue-jwt`) est marqué "deferred post-S30" alors qu'il est **DONE** (S34 pour void/cancel ; kiosk vérifié no-PIN S36 ; refund S25). Marquer DONE.
- Le bloc S25 est encore "ready to merge" alors qu'il est **merged**.

**Architecture proposée.** En closeout S37, bumper CLAUDE.md §Active Workplan : current session → S37, S36 → previous session reference, corriger les 4 points périmés ci-dessus, bumper "Migration sequence active" avec le bloc S37, lister les nouvelles permissions seedées (si `orders.discount` créée).

**Critère d'acceptation.** CLAUDE.md cohérent avec l'état git réel (PR #68/#66 mergées, sweep PIN DONE, S25 merged).

### 5.4 pgTAP nouveaux

Suivent leur wave (A) : `order_discount_gate` (SEC-01), `unit_price_reconciliation` (SEC-02), `loyalty_transactions_append_only` (SEC-04), `sign_zreport_pin` (BO-01). Listés ici pour mémoire ; co-localisés `supabase/tests/`.

---

## 6. Migrations (preview)

Bloc `20260621000010+` — **vérifier `supabase/migrations/` + MCP `list_migrations` avant de figer** (dernier en git : `20260620000017`). Estimation : **~6-9 migrations** (selon arbitrages bump vs EF). Regen types après tout changement de signature RPC (v6→v7 return jsonb, v10→v11, customers v2, sign_zreport_v2).

| Migration (estimée) | Wave | Objet |
|---|---|---|
| `…000010` | A | bump `complete_order_with_payment_v10 → v11` (discount gate + PIN + unit_price reconcil + audit_log) + DROP v10 |
| `…000011` | A | REVOKE pair `complete_order_with_payment_v11` |
| `…000012` | A | bump `pay_existing_order_v6 → v7` (discount gate + return jsonb POS-01) + DROP v6 |
| `…000013` | A | REVOKE pair `pay_existing_order_v7` |
| `…000014` | A | REVOKE INSERT/UPDATE/DELETE `loyalty_transactions` (SEC-04) |
| `…000015` | A | bump `sign_zreport_v2(p_zreport_id, p_manager_pin)` + DROP v1 + REVOKE pair (BO-01) — si bump retenu vs EF |
| `…000016` | A | seed permission `orders.discount` (+ role_perms) — si nouvelle perm retenue |
| `…000017` | C | `search_customers_v2` / `get_customer_v2` / `create_customer_v2` (avec category pricing) + REVOKE pairs + DROP v1 |
| `…000018` | C | gate `customers.read` (équivalent `_043`, appliqué EN DERNIER après front câblé) |

> Le nombre exact dépend des arbitrages Task 0 (EF wrapper sign-zreport vs bump v2 ; nouvelle perm `orders.discount` vs réutilisation ; customers v2 bump vs fetch séparé). Le plan §Task 0 tranche.

---

## 7. Permissions

- **Potentiellement nouvelle** : `orders.discount` (gate de l'autorité de remise — SEC-01), seedée pour MANAGER+/ADMIN+/SUPER_ADMIN. **Arbitrage Task 0** : vérifier l'inventaire `permissions` — une permission discount existe peut-être déjà (`pos.discount.*` ?). Réutiliser si présent.
- `customers.read` : déjà existante (seedée par `_043` pour MANAGER/ADMIN/SUPER_ADMIN) — la migration gate la branche.
- Aucune autre.

---

## 8. Acceptance criteria (high-level — détaillé dans le plan)

- [ ] **SEC-01** : remise > 0 exige `authorized_by` avec `orders.discount` + PIN valide ; audit_log `order.discount_applied` — pgTAP PASS.
- [ ] **SEC-02** : `unit_price` client réconcilié vs `retail_price` (forcé ou exception) — pgTAP PASS.
- [ ] **SEC-04** : `loyalty_transactions` non-INSERT/UPDATE/DELETE pour authenticated/anon — pgTAP PASS.
- [ ] **DB-02** : `process-payment` EF rate-limité (pattern refund-order) — code review + happy-path non régressé.
- [ ] **BO-01** : `sign_zreport_v2` valide le PIN ; signature impossible sans PIN — pgTAP PASS.
- [ ] **POS-01** : pickup tablette affiche le total réel (pas 0) — smoke PASS.
- [ ] **POS-02** : customer display total post-promo — smoke PASS.
- [ ] **POS-04** : reçu loyauté `balance_after` réel (pas 0) — smoke PASS.
- [ ] **POS-06** : void post-cuisine route serveur — smoke PASS.
- [ ] **POS-05** : `TAX_RATE` centralisé (constante domain) — grep 0 ; suites POS vertes.
- [ ] **BO-02** : queryKeys order detail alignées ; refetch après mutation — smoke PASS.
- [ ] **BO-03/05/12** : toast erreur / PDF par-row / back URL — smoke PASS.
- [ ] **SEC-03/DB-03/DB-06** : 4+1 sites POS câblés sur RPCs ; gate `customers.read` appliqué EN DERNIER ; PII fermée — pgTAP + smoke PASS.
- [ ] **TEST-02** : gate pgTAP PR-time CI (ou blocker documenté).
- [ ] **TEST-01** : 57 fichiers Vitest live `skipIf`-guardés.
- [ ] **PAT-05/06/17/18** : CLAUDE.md rafraîchi (PR #68/#66 merged, sweep PIN DONE, S25 merged).
- [ ] `pnpm typecheck` full sweep PASS (baseline env-gated préservée). Types regen après bumps RPC.
- [ ] INDEX `2026-06-11-session-37-INDEX.md` + CLAUDE.md §Active Workplan bump.

---

## 9. Out of scope (backlog S38+)

**Refactors risqués (session dédiée S38)** :
- PAT-01 / PAT-02 — refactor auth BO `setSession` (risqué, contourne le PIN-JWT fetch wrapper ; session dédiée avec revue sécurité approfondie).

**Features POS (zéro feature cette session)** :
- POS-15 — split-bill (diviser l'addition / split tender étendu)
- POS-16 — LAN cross-device cart mirror (extension F-007, hub réel 2 devices)
- POS-17 — course timing / coordination KDS étape par étape
- F-010..013 / F-019..024 (QR scan, combos, vente au poids, Stripe Terminal, debts inline payment, polish tail)

**BackOffice features** :
- BO-04 — ProductPicker pour EditOrderItemsModal
- BO-08 — CF account drill (refactor RPC indirect→direct)
- BO-09 / BO-10 — Units / Costing panels (write mode)
- BO-15 — B2B settings backend
- BO-21 — 9 Soon cards restantes du hub reports

**Sécurité (S38+)** :
- SEC-06 / SEC-07 — lockout PIN après N échecs (brute-force PIN)
- TEST-05 / TEST-07 — suites de tests étendues

**Infra** :
- print-bridge deployment (`localhost:3001` external bridge, S34 DEV-S34-W0-02)
- staging-deploy.yml secrets (gap S13)

**Décisions business à acter** : taux TVA dynamique (`useTaxRate` lecture `business_config` — POS-05 étape 2), allergens receipt/display (`project_allergens_wontfix`), NPWP sur receipt PB1 (F-023).

---

## 10. Risques

| Risque | Wave | Mitigation |
|---|---|---|
| Bump v10→v11 / v6→v7 sur le chemin de paiement = chemin le plus critique | A/B | TDD pgTAP avant migration ; smoke golden-path POS non régressé ; DROP+CREATE dans la même migration ; regen types |
| PIN-en-header dans une RPC PostgREST directe (`pay_existing_order`) non supporté proprement | A | Arbitrage Task 0 : `current_setting('request.headers')` vs router via EF vs gate permission-seul (fallback §2.1.1) |
| Cutover PII : gate `_043` part avant le front câblé → POS cassé | C | Séquence stricte front-first puis gate ; même déploiement ; Task 0 confirme `_043` non appliquée |
| `search_customers_v1` n'a pas l'embed category → pricing POS cassé après cutover | C | Étendre RPCs en v2 avec colonnes category pricing AVANT le câblage (bloquant §4.5) |
| `unit_price` reconciliation casse des overrides légitimes (remises autorisées) | A | Réconcilier seulement les lignes SANS override audité ; pgTAP couvre les 2 cas |
| TEST-02 CI pgTAP nécessite secrets cloud absents | D | Job `continue-on-error` ou blocker documenté si secrets non configurés |
| POS-06 void serveur : un cart counter sans order serveur ≠ un cart avec items envoyés | B | Distinguer locked vs non-locked ; cartographier `cartStore`/`useSendToKitchen` en Task 0 |

---

## 11. Next step

Arbitrages à trancher en **Task 0** (préflight) avant de figer le plan d'exécution :
1. PIN-en-header vs `current_setting('request.headers')` vs EF-routing pour `pay_existing_order` (SEC-01).
2. `unit_price` reconciliation : forcer le prix serveur (silencieux) vs lever une exception (SEC-02).
3. BO-01 : EF wrapper `sign-zreport` vs bump `sign_zreport_v2(p_manager_pin)` — **recommandation bump v2**.
4. `orders.discount` : nouvelle permission vs réutilisation d'une existante.
5. POS-05 : constante domain seule (V1) vs lecture `business_config` (S38).
6. customers v2 : étendre le TABLE result (1 round-trip) vs fetch category séparé.
7. État de `_043` : confirmée non appliquée (sinon hotfix).

Exécuter le plan [`../plans/2026-06-11-session-37-plan.md`](../plans/2026-06-11-session-37-plan.md) via `superpowers:subagent-driven-development` — Wave A (db-engineer + edge-functions-engineer + test-engineer), Wave B (pos-specialist + test-engineer, B1 attend A1), Wave C (backoffice-specialist + pos-specialist + db-engineer, cutover séquencé), Wave D (test-engineer + docs). Revue pré-merge `pattern-guardian`.
