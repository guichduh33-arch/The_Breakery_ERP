# Session 36 — POS Correctness & Security Close-out (Spec)

> **Date** : 2026-06-04
> **Branche cible** : `swarm/session-36`
> **Base** : `master` @ `0086017` (post-merge S35 PR #62).
> **Effort estimé** : ~3-5 jours wall-time (S) — close-out, zero new feature. Mostly XS/S findings.
> **Status** : **spec** — plan détaillé rédigé en parallèle via `superpowers:writing-plans` (voir `../plans/2026-06-04-session-36-plan.md`).
> **Source** : [`docs/audit/2026-05-28-pos-audit.md`](../../../audit/2026-05-28-pos-audit.md) — findings F-008, F-002, F-021 + S35 follow-ups (DEV-S35-C-05, DEV-S35-E3-01, idle→lock).
> **Predecessor** : [`./2026-05-29-session-35-spec.md`](./2026-05-29-session-35-spec.md).

---

## 1. Contexte

S34 a fermé les 4 dettes critiques POS (Send-to-Kitchen no-op, enum drift partiel, receipt/drawer fraud, PIN-en-body void/cancel). S35 + S35a ont livré la couche service/polish (held orders DB-backed, virtual keypad, customer-display cart mirror, settings printing tab, lock terminal, PaymentTerminal refactor). Il reste un **résidu de correctness et de sécurité** : trois findings audit non encore traités (un risque de sécurité réel — F-008 ; un bug de correctness silencieux — F-002 ; une dette de typings — F-021) plus trois follow-ups identifiés en exécution de S35 (DEV-S35-C-05, DEV-S35-E3-01, idle→lock rewire).

S36 est une session **close-out** : on ferme la queue de correctness/sécurité avant d'ouvrir la prochaine vague de features POS (combos, scan QR, vente au poids — toutes reportées). **Direction ratifiée par l'utilisateur : "Correctness & Sécurité close-out", zéro nouvelle feature.**

**Périmètre S36 (3 waves, 6 items)** :

| Wave | Item | Sévérité audit | Effort | Nature |
|---|---|---|---|---|
| A — Sécurité | F-008 — `send_items_to_kitchen` `GRANT … TO anon` | 🟠 Major | XS | DB corrective (REVOKE pair) |
| A — Sécurité | kiosk-issue-jwt PIN sweep (S25 backlog) | — | XS | EF — **vérif → probable "déjà conforme"** |
| B — Correctness | F-002 — drift `take_away`/`takeaway` vs enum `take_out` | 🔴 Critical (résidu) | XS | Front TDD |
| B — Correctness | F-021 — `useDisplayRealtime` `'postgres_changes' as never` | 🟡 Minor | XS | Front typings |
| C — Follow-ups S35 | idle→lock rewire | 🟢 low | XS | Front |
| C — Follow-ups S35 | customer re-fetch on held restore (DEV-S35-C-05) | 🟢 low | S | Front |
| C — Follow-ups S35 | VKP a11y in modals (DEV-S35-E3-01) | 🟢 low | S | UI (`packages/ui`) |

**Ordre de priorité recommandé** : Wave A (sécurité d'abord, débloque le REVOKE avant tout le reste) → Wave B (correctness) → Wave C (polish). Les waves sont indépendantes et parallélisables (une seule migration en A, le reste front-only).

### Déjà fermés (closed prior — NE PAS inclure)

- **F-001** (Send-to-Kitchen) — fermé S34.
- **F-006** (PIN void/cancel en body) — fermé S34. Vérifié : `useVoidOrder` + `useCancelOrderItem` utilisent `x-manager-pin` (header). Le backlog S25 listait aussi `kiosk-issue-jwt` dans le sweep — traité en Wave A ci-dessous (réduction de scope probable, voir §3).
- **F-004 / F-009 / F-015** — fermés S35.
- **PaymentTerminal refactor / receipt method / cash-drawer toast / realtime channel UUID** — fermés S35a (PR #61).

---

## 2. Wave A — Sécurité (DB + EF)

### 2.1 F-008 — `send_items_to_kitchen` accessible à `anon`

**Problème (vérifié).** `supabase/migrations/20260505000004_send_items_rpc.sql:40` :
```sql
GRANT EXECUTE ON FUNCTION send_items_to_kitchen(UUID[]) TO authenticated, anon;
```
Cette RPC (datée 2026-05-05, **avant** la convention anon defense-in-depth S20) accorde explicitement `EXECUTE` à `anon`. Un appelant anonyme peut donc verrouiller des `order_items` (`is_locked=true`, `sent_to_kitchen_at=now()`) sans authentification — pollution KDS / déni de service léger.

**Critical pattern violé (CLAUDE.md S20).** `REVOKE EXECUTE … FROM anon` seul est **INSUFFISANT** : `anon` hérite `EXECUTE` via l'appartenance à `PUBLIC` (ACL `=X/postgres`). La correction canonique est la **paire S25** :
```sql
REVOKE EXECUTE ON FUNCTION public.send_items_to_kitchen(UUID[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.send_items_to_kitchen(UUID[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.send_items_to_kitchen(UUID[]) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

**Architecture proposée.** Une migration corrective unique (next block `20260620000017+` — vérifier le max via MCP `list_migrations` ; le dernier appliqué est `20260620000016`). Pas de bump de signature (la RPC fonctionne, seul le GRANT est en cause). Pas de regen types (aucun changement de schéma fonctionnel).

**Critère d'acceptation.** pgTAP : `has_function_privilege('anon', 'public.send_items_to_kitchen(uuid[])', 'EXECUTE')` → `false`, et `authenticated` → `true`.

### 2.2 kiosk-issue-jwt PIN sweep (S25 backlog) — **probable "déjà conforme"**

**Contexte.** Le backlog S25 listait : *"Sweep of other manager-PIN EFs (`void-order`, `cancel-item`, `kiosk-issue-jwt`) deferred to backlog post-S30."* `void-order` + `cancel-item` ont été migrés en S34 (F-006). Reste `kiosk-issue-jwt`.

**Vérification (faite cette session).** Lecture de `supabase/functions/kiosk-issue-jwt/index.ts` (205 lignes). L'EF **ne consomme aucun PIN ni secret dans son body** : `IssueRequest = { kiosk_id?, scope?, device_label? }` (lignes 31-35). Le seul secret est `SUPABASE_JWT_SECRET` (env, jamais body). L'auth est gérée par IP-allowlist + rate-limit, pas par PIN.

**Conclusion.** Il n'y a **rien à migrer** : `kiosk-issue-jwt` est déjà conforme au pattern PIN-en-header (il n'a pas de PIN du tout). On documente ceci comme déviation **"already compliant"** dans l'INDEX et on **réduit le scope** de Wave A à F-008 uniquement. L'item reste dans la spec pour clore proprement la ligne de backlog S25.

> **Arbitrage à valider (mineur)** : si l'utilisateur souhaite tout de même un durcissement supplémentaire de `kiosk-issue-jwt` (hors PIN — p.ex. exiger un secret d'appairage en header), c'est une feature hors-scope correctness/sécurité-close-out → reporter S37+. Recommandation : laisser tel quel, juste documenter la conformité.

---

## 3. Wave B — Correctness POS (front, TDD)

### 3.1 F-002 — drift `take_away` / `takeaway` vs enum DB `take_out`

**Problème (vérifié).** L'enum DB `order_type` réel est `('dine_in', 'take_out', 'delivery', 'b2b')` (confirmé `packages/supabase/src/types.generated.ts:7192,7402`). Trois sites de code POS comparent contre des valeurs **qui n'arrivent jamais** → branches mortes silencieuses, snake-case brut affiché à l'utilisateur :

| Fichier:ligne | Code actuel | Valeur attendue (jamais atteinte) |
|---|---|---|
| `apps/pos/src/features/display/components/OrderQueueTicker.tsx:33` | `if (orderType === 'take_away') return 'Pickup';` | `'take_away'` (dead) |
| `apps/pos/src/features/display/components/CurrentOrderCard.tsx:55` | `: order.order_type === 'take_away'` | `'take_away'` (dead) |
| `apps/pos/src/features/order-history/OrderHistoryPanel.tsx:189` | `{row.order_type === 'takeaway' ? 'Takeaway' : … : row.order_type}` | `'takeaway'` (dead → affiche `take_out` brut) |

Sites cosmétiques / non-code à NE PAS toucher (commentaires, refs images) :
- `apps/pos/src/features/cart/ActiveOrderPanel.tsx:15` (commentaire ref image `.jpg`)
- `apps/pos/src/features/cart/HeldOrdersModal.tsx:10` (commentaire ref image `.jpg`)

Fixture de test à corriger (sinon elle masque le bug) :
- `apps/pos/src/features/display/__tests__/OrderQueueTicker.test.tsx:48` — `order_type: 'take_away'` → doit devenir `'take_out'`.

**Architecture retenue (Option A — ratifiée utilisateur 2026-06-04).** Sweep complet `apps/pos/src` (hors commentaires/refs images) via un **helper centralisé dans `@breakery/domain`** : ajouter `ORDER_TYPE_LABELS: Record<OrderType, string>` + `orderTypeLabel(t: string): string` dans `packages/domain/src/orders` (IO-free), couvrir l'enum complet (type-level test forçant la couverture), puis réécrire les 3 sites pour consommer le helper. Élimine la classe entière de bug (toute UI future passe par le helper). `take_out` confirmé comme valeur exacte via `types.generated.ts:7192,7402`.

> **Option B rejetée (décision 2026-06-04)** : le remplacement direct in-place `'take_away'`/`'takeaway'` → `'take_out'` (sans helper) ne prévient pas la récidive — abandonné au profit d'Option A. Plus aucune ambiguïté à l'exécution.

**Découpage Wave B (F-002)** : (B1) création du helper `orderTypeLabel` + son test unit pur dans `@breakery/domain` = tâche distincte ; (B2) rewire des 3 sites POS + fixture = tâche dépendante de B1.

**Critère d'acceptation.** Smoke test : pour `order_type='take_out'`, l'UI affiche bien "Takeaway"/"Pickup" (pas `take_out` brut). Grep `take_away|takeaway` sur `apps/pos/src` ne retourne plus que les 2 commentaires refs-images. `pnpm --filter @breakery/app-pos typecheck` PASS.

### 3.2 F-021 — `useDisplayRealtime` typings cassés (`'postgres_changes' as never`)

**Problème (vérifié).** `apps/pos/src/features/display/hooks/useDisplayRealtime.ts:35` :
```ts
'postgres_changes' as never,
```
Cast `as never` introduit en S5 pour contourner des typings Supabase Realtime incomplets. Le cast masque la vraie signature et désactive la vérification de type sur l'abonnement realtime.

**Architecture proposée.** Regénérer les types (`mcp__plugin_supabase_supabase__generate_typescript_types` → `packages/supabase/src/types.generated.ts`) — les types `@supabase/supabase-js` actuels exposent désormais l'overload `'postgres_changes'` correctement. Retirer le cast `as never` et utiliser le littéral `'postgres_changes'`. Aligner sur le pattern propre déjà utilisé par `useOrdersRealtime` (S33) et `useKdsRealtime`.

> **NB** : la regen de types n'est nécessaire que si une migration de cette session change le schéma. F-008 ne change pas le schéma fonctionnel (REVOKE only). On regen tout de même par discipline si Wave A applique une migration — sinon, le fix F-021 repose sur les types Supabase JS du package, pas sur le schéma DB. À trancher en exécution (Task 0 vérifie si une regen est requise).

**Critère d'acceptation.** `apps/pos/src/features/display/hooks/useDisplayRealtime.ts` ne contient plus `as never`. `pnpm --filter @breakery/app-pos typecheck` PASS. Le canal realtime reste fonctionnel (smoke existant `display` suite non régressé). Channel name unique par mount préservé (critical pattern realtime StrictMode).

---

## 4. Wave C — Follow-ups S35 (front, low)

### 4.1 idle→lock rewire

**Problème.** S35 a livré `authStore.lock()` (session-preserving) mais a **délibérément** laissé `useIdleTimeout` brancher `signOut()`/`logout` sur l'idle (décision ratifiée 2026-06-03 : "Manual lock only — no idle→lock rewire"). En close-out S36, on rebranche l'idle sur `lock()` côté POS pour une meilleure sécurité opérationnelle (pause sans perte de shift cash).

**État vérifié.** `apps/pos/src/App.tsx:22` :
```ts
useIdleTimeout({ timeoutMinutes, onTimeout: logout });
```
`useIdleTimeout({ timeoutMinutes, onTimeout })` est mounté app-wide dans `App.tsx` (donc aussi sur l'écran de login). `authStore.lock()` + `unlock()` existent depuis S35.

**Architecture proposée.** Remplacer `onTimeout: logout` par `onTimeout: lock` côté POS, **conditionné à `isAuthenticated`** (ne pas lock l'écran de login non authentifié — un lock sur un store déjà déconnecté n'aurait pas de sens). Le `<TerminalLockedOverlay>` (S35) gère déjà le re-PIN. La shift + le cart survivent (stores séparés, déjà le cas pour le lock manuel).

> **Renversement assumé (ratifié utilisateur 2026-06-04)** : la décision S35 "manual lock only — no idle→lock rewire" (2026-06-03) est **explicitement renversée** en S36, car `lock()` préserve shift+cart là où `signOut()` les perd (lock > logout en sécurité opérationnelle). POS uniquement ; BackOffice reste sur logout-on-idle (pas de notion de shift cash à préserver côté BO). Tracé dans l'INDEX §9 sous `DEV-S36-C-01` (informational).

**Critère d'acceptation.** Smoke : sur idle timeout côté POS authentifié, `authStore.isLocked` devient `true` (pas `signOut`). `<TerminalLockedOverlay>` se monte. `pnpm --filter @breakery/app-pos typecheck` PASS.

### 4.2 customer re-fetch on held restore (DEV-S35-C-05)

**Problème (vérifié).** `restore_held_order_v1` (S35) ne renvoie que le `customerId` (pas l'objet customer complet). `useRestoreHeldOrder.ts:54-56` remappe `cart.customerId` mais l'objet `attachedCustomer` (badge visuel : nom, tier, points) reste nul après restore. Le pricing et les JE sont keyés sur `customerId` (corrects), seul le **badge visuel** manque jusqu'au re-attach manuel.

**Architecture proposée.** Dans `useRestoreHeldOrder`, après le remap du cart : si `payload.customerId !== null`, re-fetcher l'objet customer (via le hook/service de lookup existant — `useCustomerLookup` / `searchCustomers` / direct SELECT `customers`) et rétablir `attachedCustomer` dans le cart/store pour restaurer le badge. Pas de changement DB (le `customerId` suffit, on enrichit côté client).

**Critère d'acceptation.** Smoke : après restore d'un held order avec customer attaché, le badge customer (nom) réapparaît dans le panneau cart. Pricing/JE inchangés (keyed customerId). `pnpm --filter @breakery/app-pos typecheck` PASS.

### 4.3 VKP a11y in modals (DEV-S35-E3-01)

**Problème (vérifié, S35 INDEX §4).** Le `<VirtualKeypadProvider>` overlay (S35) est rendu **hors du portal** du `Dialog` Radix actif. Quand le VKP est ouvert depuis un input dans un Dialog Radix, le Dialog applique `aria-hidden` à tout ce qui est en dehors de son portal → l'overlay VKP devient `aria-hidden`, donc non annoncé aux lecteurs d'écran. Fonctionne visuellement et au toucher (modèle d'interaction POS), mais pas annoncé a11y.

**Architecture proposée.** Portail l'overlay VKP **dans le Dialog Radix actif** quand un est ouvert (détecter le portal/conteneur du Dialog actif et y monter l'overlay via `createPortal`), sinon comportement actuel (overlay au niveau racine). Sans Dialog ouvert, rien ne change. Composant touché : `packages/ui/src/components/VirtualKeypadProvider.tsx`.

> **Risque** : détecter le conteneur du Dialog Radix actif est non-trivial (Radix portail dans `document.body` par défaut, pas de contexte exposé proprement). Stratégie de repli si la détection est fragile : monter l'overlay VKP avec un `z-index` supérieur au Dialog ET retirer l'`aria-hidden` hérité via `aria-live`/`role` approprié sur le conteneur VKP. À valider en exécution.

**Critère d'acceptation.** UI unit : l'overlay VKP ouvert depuis un Dialog n'est plus `aria-hidden` (assertion sur l'attribut). Comportement visuel/touch inchangé. `pnpm --filter @breakery/ui typecheck` PASS.

---

## 5. Migrations (preview)

Block `20260620000017+` — **vérifier `supabase/migrations/` + `list_migrations` avant de figer** (dernier appliqué : `20260620000016`). **Une seule migration prévue** : F-008 REVOKE pair pour `send_items_to_kitchen`. Tout le reste de S36 est front-only (Waves B + C ne touchent pas le schéma). Regen types **uniquement si** la regen F-021 le requiert au niveau du package (probable non — voir §3.2).

| Migration | Wave | Objet |
|---|---|---|
| `…000017` | A | REVOKE pair `send_items_to_kitchen(UUID[])` FROM anon, PUBLIC + ALTER DEFAULT PRIVILEGES |

---

## 6. Permissions

Aucune nouvelle permission seedée. F-008 ne fait que retirer un GRANT trop large (`anon`) ; `authenticated` conserve l'accès.

---

## 7. Acceptance criteria (high-level — détaillé dans le plan)

- [ ] **F-008** : `anon` ne peut plus exécuter `send_items_to_kitchen` ; `authenticated` oui — pgTAP PASS.
- [ ] **kiosk-issue-jwt** : conformité PIN-en-header documentée ("already compliant", pas de PIN body) — déviation INDEX.
- [ ] **F-002** : sweep `take_away`/`takeaway` → `take_out` (3 sites code + 1 fixture) ; helper `orderTypeLabel` (Option A) couvre l'enum complet ; UI affiche "Takeaway"/"Pickup" — smoke PASS.
- [ ] **F-021** : `useDisplayRealtime` sans `as never` ; realtime fonctionnel — typecheck PASS.
- [ ] **idle→lock** : idle POS authentifié → `lock()` (pas logout) ; overlay monté — smoke PASS.
- [ ] **DEV-S35-C-05** : badge customer restauré au restore d'un held order — smoke PASS.
- [ ] **DEV-S35-E3-01** : overlay VKP non `aria-hidden` dans un Dialog Radix — UI unit PASS.
- [ ] `pnpm typecheck` full sweep PASS (baseline env-gated préservée).
- [ ] INDEX `2026-06-04-session-36-INDEX.md` + CLAUDE.md §Active Workplan bump.

---

## 8. Out of scope (backlog S37+)

**Features (zéro feature cette session)** :
- F-010 (scan QR / barcode caméra produits + clients)
- F-011 (ComboSelectorModal + table `combo_components`)
- F-012 (vente au poids + `products.sale_unit` + Web Serial balance)
- F-013 (Stripe Terminal pre-auth dine-in)
- F-019 (debts inline payment — `PaymentTerminal` inline depuis `CustomerDebtsPanel`)

**Polish tail (reportés)** :
- F-016 (SideMenuDrawer `onOpenHeldOrders`/`onOpenCustomers` boutons grisés)
- F-017 (seuil stock bas `<= 3` vs doc `<10` — **ARBITRAGE** : laissé tel quel sauf décision business ; côté boulangerie rotation rapide, `3` semble correct)
- F-018 (Recover shift — `toast.info('not implemented')`)
- F-020 (dedup `CartItemRow`/`CartLineRow`)
- F-022 (cart TTL `sessionStorage` 2h — warning UX)
- F-023 (NPWP sur receipt PB1 — exigence fiscale NON-PKP à **vérifier** ; implémentation déférée)
- F-024 (couverture test modifier sur receipt)

**Infra** :
- LAN cross-device cart mirror (extension F-007 — `useLanClient` hub réel pour 2 devices physiques séparés)
- print-bridge deployment (P0 mais matériel/infra — `localhost:3001` external bridge, S34 DEV-S34-W0-02)
- refund-test-investigation (env `SUPABASE_SERVICE_ROLE_KEY` requis pour Vitest live)

**Décisions business à acter** : allergens receipt/display (`project_allergens_wontfix` user-locked 2026-05-17), offline mode dégradé, Apple Pay/Google Pay.

---

## 9. Risques

| Risque | Wave | Mitigation |
|---|---|---|
| F-021 regen types touche un schéma non lié → diff de types large | B | N'appliquer la regen que si requis ; diff types review avant commit ; F-021 peut se fixer sans regen si les types Supabase JS du package exposent déjà l'overload |
| VKP portal dans Dialog Radix fragile (Radix portail dans `body`) | C | Stratégie de repli z-index + `aria-live` si détection conteneur échoue (voir §4.3) |
| idle→lock renverse une décision S35 explicite | C | **Renversement ratifié utilisateur 2026-06-04** (tracé `DEV-S36-C-01`) ; comportement gardé conditionnel à `isAuthenticated` côté POS uniquement (BO reste logout) |
| F-002 Option A (helper domain) crée une API publique sans consumer hors POS | B | Helper consommé par les 3 sites POS immédiatement (pas de dead API) ; aligné sur précédent `expandRecipeCascade` |

---

## 10. Next step

Arbitrages tranchés (2026-06-04) : **F-002 → Option A** (helper, Option B rejetée) ; **idle→lock → réintroduit** (renversement S35 assumé, `DEV-S36-C-01`). Restent figés au scope : F-017 laissé tel quel, kiosk-issue-jwt scope réduit (déjà conforme). Exécuter le plan `../plans/2026-06-04-session-36-plan.md` via `superpowers:subagent-driven-development` (waves A/B/C parallélisables, une tâche = un subagent, TDD).
