# Session 35 — POS Service Polish (Spec)

> **Date** : 2026-05-29
> **Branche cible** : `swarm/session-35`
> **Base** : `master` @ post-merge S34 PR (POS Critical Fixes) — dépend de S34 pour le draft-order flow (`create_draft_order_with_items_v1`) que F-003 held-orders réutilise/parallèle.
> **Effort estimé** : ~10-15 jours wall-time (L) — 5 findings *Major* dont 2 M et 1 L.
> **Status** : **spec-only** (plan détaillé à rédiger via `superpowers:writing-plans` au démarrage de S35, après ratification du périmètre).
> **Source** : [`docs/audit/2026-05-28-pos-audit.md`](../../../audit/2026-05-28-pos-audit.md) — findings F-003, F-005, F-007, F-009 (+ F-015 résolu), F-014.
> **Predecessor** : [`./archive/2026-05-29-session-34-spec.md`](./2026-05-29-session-34-spec.md) (draft « POS Critical Fixes » superseded — archivé 2026-06-12).

---

## 1. Contexte

S34 a fermé les 4 dettes critiques (Send-to-Kitchen no-op, enum drift, receipt/drawer fraud, PIN-en-body). S35 livre la **couche service/polish** : les findings *Major* qui ne cassent pas la prod mais qui (a) trahissent des promesses doc (`POS.md`), (b) dégradent la confiance client (live cart mirror), (c) bloquent l'autonomie manager (Settings stubs), (d) exposent un risque de sécurité d'inattention (pas de lock terminal), et (e) perdent des commandes en attente (held orders en localStorage).

**Périmètre S35 (5 findings)** :

| Finding | Sévérité | Effort | Promesse cassée |
|---|---|---|---|
| F-003 | 🔴→ promu polish | M (3-5j) | Held orders DB-backed (crash navigateur perd la commande, pas de multi-terminal) |
| F-005 | 🟠 | M (3-5j) | `VirtualKeypadProvider` + QwertyLayout (invariant touch-first `POS.md §11`) |
| F-007 | 🟠 | M (3-5j) | Customer Display live cart mirror (BroadcastChannel "Phase 5.A" jamais livrée) |
| F-009 | 🟠 | M (3-5j) | POSSettingsPage 3 onglets stub — au minimum le Printing tab (résout aussi F-015 URL hardcodée) |
| F-014 | 🟠 | S (1-2j) | Lock Terminal (pause sans logout, callback non câblé) |

**Ordre de priorité recommandé** : F-014 (S, quick win) → F-009 Printing tab (débloque config) → F-003 (persistence métier) → F-007 (confiance client) → F-005 (ergonomie matériel).

**Hors scope S35** (backlog S36+) : F-010 QR scan, F-011 ComboSelectorModal, F-012 vente au poids, F-013 Stripe Terminal, F-019 debts inline payment, F-020 CartItemRow/CartLineRow dedup, F-021 useDisplayRealtime typings, F-022 cart TTL UX, F-023 NPWP receipt, F-024 modifier receipt test, kiosk-issue-jwt PIN sweep.

---

## 2. F-003 — Held orders DB-backed

### Problème
`heldOrdersStore` est en `localStorage` only (`stores/heldOrdersStore.ts:40`). Le statut `held` n'existe pas dans l'enum DB `order_status` (`draft, paid, voided, pending_payment, completed, b2b_pending`). Conséquences : crash navigateur perd la commande, un 2e terminal ne voit pas les holds du 1er, le manager ne peut pas réconcilier les holds à la fermeture.

### Architecture proposée
**Réutilise le draft-order flow S34.** Un held order EST un draft order avec un flag/statut distinct. Deux options :

- **Option A (recommandée) — réutiliser `status='draft'` + colonne `is_held BOOLEAN`** : pas de migration ENUM (ajout d'`ENUM value` est non-transactionnel et irréversible). Un held order = draft order avec `is_held=true`. `create_draft_order_with_items_v1` (S34) sert de base ; on ajoute `hold_order_v1`/`restore_held_order_v1`/`discard_held_order_v1` qui flippent le flag + snapshot. **Le plus DRY post-S34.**
- **Option B — `ALTER TYPE order_status ADD VALUE 'held'`** (proposition audit originale) : plus explicite sémantiquement mais ENUM ADD VALUE ne peut pas être rollback dans une transaction et complique les CHECK/queries existantes.

> **Décision à ratifier au démarrage S35.** Recommandation : Option A (flag) pour rester transaction-safe et réutiliser le flow S34.

### DB (Option A)
- `_010` `ALTER TABLE orders ADD COLUMN is_held BOOLEAN NOT NULL DEFAULT false` + index partiel `WHERE is_held = true`.
- `_011` `hold_order_v1(p_cart_payload JSONB, p_table_number TEXT, p_notes TEXT, p_client_uuid UUID) RETURNS UUID` — crée (ou flippe) un draft order `is_held=true` + snapshot order_items. SECURITY DEFINER + gate `sales.create` + idempotency + audit_log. (Si le cart a déjà un `draftOrderId` S34 → flip `is_held=true` au lieu de créer.)
- `_012` REVOKE pair.
- `_013` `restore_held_order_v1(p_order_id UUID) RETURNS JSONB` — `is_held=false`, retourne le payload pour rehydration cart (mirror `pickup_tablet_order`). Gate + audit.
- `_014` REVOKE pair.
- `_015` `discard_held_order_v1(p_order_id UUID, p_reason TEXT) RETURNS VOID` — `status='voided'` + audit_log `order.held_discarded` (reason ≥ 10 chars).
- `_016` REVOKE pair.

### POS
- `useHeldOrdersStore` (localStorage) → devient un cache de `useQuery(['held-orders'])` (SELECT orders WHERE `is_held=true` AND session/terminal scope) avec realtime sub (`postgres_changes` on orders, channel unique par mount).
- `useHoldOrder` → appelle `hold_order_v1`.
- `useRestoreHeldOrder` → appelle `restore_held_order_v1` + rehydrate cartStore.
- `HeldOrdersModal` consomme la query (multi-terminal visible).
- Migration des holds localStorage existants : best-effort one-shot au boot (ou drop — décision business, holds locaux sont éphémères).

### Tests
pgTAP `held_orders` ~10 (hold/restore/discard happy + perm + idempotency + multi-terminal visibility + reason validation) + POS smoke ~5.

---

## 3. F-005 — VirtualKeypadProvider + QwertyLayout

### Problème
`POS.md §11` promet `<VirtualKeypadProvider>` enveloppant `/pos` avec layouts `NumpadLayout` + `QwertyLayout`. Inexistant en V3. Seuls `Numpad`/`NumpadPin`/`NumpadVirtual` (modaux ponctuels). Sur iPad, le clavier iOS natif masque 50% de l'écran lors de la recherche client.

### Architecture proposée
- `packages/ui/src/components/VirtualKeypadProvider.tsx` (NEW) — context provider monté autour de `/pos`. Intercepte le focus sur les `<input>` internes, affiche un clavier overlay (bottom sheet) selon `inputmode`/`type` (`numeric` → NumpadLayout, sinon QwertyLayout). Opt-out via `data-no-vkp` attribute.
- `packages/ui/src/components/QwertyLayout.tsx` (NEW) — clavier AZERTY/QWERTY tactile (touches + shift + backspace + space + done). Réutilise les primitives `Numpad`.
- `useVirtualKeypad` hook — expose `{ openFor(inputRef), close, activeLayout }`.
- Câblage : `CustomerAttachModal` (recherche nom), `DiscountModal` (reason), `CancelItemModal` (reason).
- Empêche le clavier natif iOS via `readOnly` + focus management (ou `inputmode="none"` sur les inputs ciblés).

### Tests
UI unit `VirtualKeypadProvider` (focus intercept, layout switch, opt-out) ~6 + smoke câblage CustomerAttachModal ~2.

### Risque
Conflit avec le clavier natif mobile (double clavier). Stratégie `inputmode="none"` + gestion focus à valider sur device réel.

---

## 4. F-007 — Customer Display live cart mirror

### Problème
`CustomerDisplayPage.tsx:11-14` : "full live cart mirror (`CDActiveCartView`) lands in Phase 5.A with the LAN BroadcastChannel port" — jamais livré (S13 closed sans). Le client ne voit que la file d'attente, pas son panier en construction.

### Architecture proposée
- `apps/pos/src/features/display/hooks/useCartBroadcast.ts` (NEW, émetteur côté POS) — émet `{ type: 'cart_update', cart, totals, customer }` via `BroadcastChannel('breakery-cart')` à chaque changement de `cartStore` (subscribe + debounce léger).
- `apps/pos/src/features/display/hooks/useCartBroadcastReceiver.ts` (NEW, récepteur côté `/display`) — écoute le channel, expose le cart courant.
- `apps/pos/src/features/display/CDActiveCartView.tsx` (NEW) — panneau "Your order" à gauche du queue ticker : lignes + totaux live + customer attaché.
- Wire : `pages/Pos.tsx` (émetteur monté), `CustomerDisplayPage` (récepteur + CDActiveCartView).
- **NB** : `BroadcastChannel` est same-origin same-browser. Pour un vrai 2e écran physique séparé (autre device), il faut le LAN hub (`useLanClient`) — V1 BroadcastChannel couvre le cas "2 fenêtres/onglets même machine" (montage display sur 2e sortie HDMI du même PC). Le port LAN hub réel = extension S36+.

### Innovation associée (audit Annexe Innovation 3)
Le Customer Display devient terrain de confirmation : flash + son à l'ajout, bouton "Add a coffee?" tappable. **Hors scope V1** — noter en backlog.

### Tests
POS smoke `useCartBroadcast` émet sur cart change ~2 + `CDActiveCartView` render depuis payload ~2.

---

## 5. F-009 — POSSettingsPage Printing tab (résout F-015)

### Problème
`POSSettingsPage.tsx:78-80` : 3 `PlaceholderSection` (Printing, KDS & Display, Devices) + lignes 139-141 : 3 `PlaceholderInline` (Automation, Advanced, Behavior). Le manager ne peut rien configurer. L'URL du print server est hardcodée (`printService.ts:2` — F-015).

### Architecture proposée (Printing tab minimal)
- Nouveau store/persistence settings POS : `usePosSettingsStore` (Zustand persist localStorage, ou table `pos_terminal_settings` si multi-terminal souhaité — décision : localStorage V1, suffisant car settings par terminal physique).
- **Printing tab** livre :
  - URL printer (input) → consommé par `printService.ts` (remplace le `const SERVER_URL` hardcodé par une lecture du store). **Résout F-015.**
  - Auto-print on/off (toggle).
  - Auto-open drawer on/off (toggle) — affine F-004 (S34 a déjà conditionné au cash ; ce toggle permet de désactiver complètement).
  - Receipt template toggles (loyalty footer, custom footer text) — optionnel.
- `printService.ts` lit l'URL depuis le store au lieu de la constante. Fallback `localhost:3001` si non configuré.
- KDS & Display / Devices tabs : restent stubs S35 (ou minimal) — décision périmètre.

### Tests
POS smoke `POSSettingsPage` Printing tab (URL persist + toggles) ~4 + `printService` lit l'URL du store ~2.

---

## 6. F-014 — Lock Terminal (quick win)

### Problème
`SideMenuDrawer.tsx:230` accepte `onLockTerminal` mais `Pos.tsx:170-180` ne passe pas le callback → bouton désactivé. Le cashier qui s'absente 2 min doit logout (perd la session shift) ou attendre l'idle timeout 30 min (S19).

### Architecture proposée
- `useLockTerminal()` hook — détache le user de l'auth store **sans** purger `shiftStore` ni `cartStore`.
- `<TerminalLockedOverlay>` (NEW) — overlay plein écran avec UserPicker + PinPad (vérification only). Au déverrouillage → restaure auth, cart + shift intacts.
- Câblage `Pos.tsx` : passer `onLockTerminal={() => lockTerminal()}` au `<SideMenuDrawer>`.
- Réutilise `useIdleTimeout` (S19) — possibilité de déclencher le lock au lieu du logout sur idle (décision : lock < logout en sécurité opérationnelle ; à arbitrer).

### Tests
POS smoke `useLockTerminal` (auth détaché, shift préservé) ~2 + `TerminalLockedOverlay` unlock flow ~2.

---

## 7. Migrations (preview)

Block `20260620000010..` (post-S34 `20260619xxx`). **Vérifier `supabase/migrations/` avant de figer.** Principalement F-003 (held orders, ~7 migrations Option A) ; F-005/F-007/F-009/F-014 sont front-only (pas de DB sauf si `pos_terminal_settings` table retenue pour F-009).

---

## 8. Permissions

| Permission | Finding | Roles |
|---|---|---|
| `sales.create` | F-003 (held RPCs reuse) | reuse |
| `orders.discard_held` (NEW, optionnel) | F-003 discard | MANAGER+ — ou reuse `sales.void`/`orders.void` |

Décision discard permission à ratifier (reuse void perm vs nouvelle).

---

## 9. Acceptance criteria (high-level — détaillé dans le plan S35)

- [ ] F-003 : held orders persistés DB, visibles multi-terminal, restore/discard fonctionnels — pgTAP ~10 + smoke ~5 PASS
- [ ] F-005 : VirtualKeypadProvider + QwertyLayout câblés ≥ 3 inputs — UI unit ~8 PASS
- [ ] F-007 : live cart mirror visible sur `/display` même-machine — smoke ~4 PASS
- [ ] F-009 : Printing tab fonctionnel (URL + auto-print + drawer toggle), F-015 résolu — smoke ~6 PASS
- [ ] F-014 : Lock Terminal opérationnel sans perte de shift — smoke ~4 PASS
- [ ] `pnpm typecheck` 6/6 PASS
- [ ] INDEX `2026-05-29-session-35-INDEX.md` + CLAUDE.md bump

---

## 10. Out of scope (backlog S36+)

F-010 (QR/barcode scan caméra), F-011 (ComboSelectorModal + table `combo_components`), F-012 (vente au poids + `products.sale_unit` + Web Serial balance), F-013 (Stripe Terminal pre-auth dine-in), F-019 (debts inline payment), F-020 (CartItemRow/CartLineRow dedup), F-021 (useDisplayRealtime typings via gen-types), F-022 (cart TTL UX warning), F-023 (NPWP sur receipt PB1), F-024 (modifier receipt test coverage), kiosk-issue-jwt PIN sweep, F-008 anon RPC global sweep, LAN hub réel pour live cart mirror cross-device (F-007 extension), Customer Display "Add a coffee?" interactif (Innovation 3), iPhone NFC loyalty auto-attach (Innovation 4), tablet handover QR paiement client (Innovation 5).

**Décisions business à acter** : allergens receipt/display (`project_allergens_wontfix` user-locked 2026-05-17), offline mode dégradé, Apple Pay/Google Pay.

---

## 11. Next step

Au démarrage de S35 : ratifier le périmètre + les décisions ouvertes (F-003 Option A vs B ; F-009 localStorage vs table ; F-014 lock-on-idle), puis rédiger `docs/workplan/plans/2026-05-29-session-35-plan.md` via `superpowers:writing-plans` (bite-sized tasks, TDD, par finding = une vague parallélisable).
