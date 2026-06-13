# Session 43 — POS Live Audit Fixes — Spec

**Date :** 2026-06-12
**Source :** audit live POS du 2026-06-12 (parcours navigateur réel via playwright-cli contre V3 dev `ikcyvlovptebroadgtvd`, croisé code + SQL). Findings reproduits en live, pas hypothétiques.
**Branche :** `swarm/session-43`
**Périmètre :** `apps/pos`, `packages/supabase`, `packages/ui`, `packages/domain`, `supabase/functions/{process-payment,auth-verify-pin}`, migrations NAME-block `20260627000010..0xx`.

---

## 1. Findings (constatés en live, groundés dans le code)

### P0 — bloquants du quotidien

| ID | Finding | Preuve |
|---|---|---|
| **P0-1** | **Toute remise ≤ 10 % rend la vente impayable.** `DiscountModal` (`packages/ui/src/components/DiscountModal.tsx:84`) ne demande l'autorisation manager que si `isAboveThreshold` (> 10 %), mais le RPC `complete_order_with_payment_v11` (migration `20260621000010`, l. 257-277) exige `p_discount_authorized_by` + PIN + `sales.discount` pour **toute** remise (ligne OU commande). Résultat live : remise 10 % → `process-payment` **409** `"Discount requires an authorizing manager"`. Aggravants : (a) l'EF mappe **tous** les P0001 sur `no_open_session` (`supabase/functions/process-payment/index.ts:238`) → copy trompeuse ; (b) les erreurs `fatal` ne s'affichent qu'en toast 4 s (`usePaymentFlowLogic.ts:169-171`), `RetryBanner` ignore le kind `fatal` → échec quasi invisible ; (c) au-dessus de 10 %, le PIN passe par `useVerifyManagerPin` → `supabase.functions.invoke` qui hérite du header global `x-app` → **preflight CORS rejeté** par les EFs déployées (allowlist déployée sans `x-app`, vérifiée dans les headers réseau live) → **aucune remise n'est encaissable en navigateur réel**. |
| **P0-2** | **Tout le realtime POS est mort sous PIN-auth.** Le wrapper fetch custom (`packages/supabase/src/client.ts:87-94`) n'authentifie que HTTP ; `realtime.setAuth()` n'est appelé **nulle part** (grep repo = 0) → le WebSocket s'authentifie en `anon`, intégralement révoqué depuis S20 → zéro événement `postgres_changes`, silencieusement. Reproduit live ×2 : commande tablette #0005 → badge inbox POS jamais mis à jour (8 s+, visible après reload seulement) ; ticket #0006 → KDS jamais mis à jour (15 s+, visible après reload). 6 consommateurs morts : `usePendingTabletOrders`, `useKdsRealtime`, `useHeldOrdersRealtime`, `usePromotionsRealtime`, `useDisplayRealtime` (kiosk JWT, même mécanique), `useTabletOrderStatusListener`. Masqué car chaque page refetch au mount. |
| **P0-3** | **« Send to Kitchen » comptoir = impression seule, zéro persistance.** `useFireToStations` (`apps/pos/src/features/cart/hooks/useFireToStations.ts`) ne fait que `POST localhost:3001/print/ticket` + `markLocked`/`markPrinted` locaux (vérifié réseau live : aucun appel Supabase). La commande comptoir n'existe en DB qu'au paiement. Crash/reload du terminal entre fire et paiement = aucune trace de ce que la cuisine doit produire ; le KDS ne couvre pas le comptoir (il ne lit que les `order_items` créés par le chemin tablette). |

### P1 — frictions fréquentes / anti-fraude

| ID | Finding | Preuve |
|---|---|---|
| **P1-1** | **« Sold out » calculé sur le stock entrepôt pour tout le catalogue.** `ProductGrid.tsx:112` : `soldOut = p.current_stock <= 0` — ignore `track_inventory` et `display_stock` (compteur vitrine documenté, memory `pos-stock-display-counter`). Constat SQL live : **44/52 produits vendables (85 %) affichés Sold out** (Beverage 10/11, Bread 7/7…), y compris les boissons faites à la minute. |
| **P1-2** | **Close shift sans garde-fou anti-fraude.** Variance **-70 000 « SHORT » validable sans note ni PIN** (testé live ; `CloseShiftModal.tsx:130` ne gate que `amountStr === ''`). Le montant attendu est affiché pendant le comptage (pas de blind count). |
| **P1-3** | **Transaction History périmée à l'ouverture.** Le panel a affiché « 1 transaction / Cash 35 000 » alors que 2 ventes cash (70 000) existaient. Cause vérifiée (RLS hors de cause, SQL rejoue les 2 lignes) : `OrderHistoryPanel` est monté en permanence dans `Pos.tsx`, `useOrderHistory` (staleTime 10 s) n'est jamais refetché à l'ouverture du panneau (flip de prop `open`, pas de remount), pas de realtime → données figées au dernier mount. Bonus même panel : « Remaining: Rp 35,000 » affiché sur une commande `paid`. |
| **P1-4** | **Liaison de table locale au device.** T-03 sélectionnée au POS apparaît « Free » sur la tablette : rien n'est persisté avant la création d'un ordre → double affectation possible. |

### P2 — polish

| ID | Finding |
|---|---|
| P2-1 | Void Order sur panier local sans confirmation (un mis-tap efface la commande). |
| P2-2 | Note de hold via `window.prompt()` natif (`BottomActionBar`) — bloque le thread, incompatible VKP/design. |
| P2-3 | Held order affiché avec l'ID brut `HELD-<uuid>` (`HeldOrdersModal`). |
| P2-4 | Tous les dialogues s'annoncent « Modal » aux lecteurs d'écran (`FullScreenModal` sans titre accessible). |
| P2-5 | KDS : `##0005` (double `#`) ; commandes payées affichées sans badge. |
| P2-6 | `order_type` par défaut `dine_in` (`cartStore.ts:163`) pour un comptoir takeaway-dominant ; dine-in sans table accepté silencieusement. |
| P2-7 | DiscountModal : erreurs de validation avec clés React dupliquées (`value_invalid` ×2 → warning console). |
| P2-8 | Images produits sur `via.placeholder.com` (ERR_CONNECTION_TIMED_OUT en boucle, hostile offline) + favicon 404. |
| P2-9 | Tables `Patio-1/Patio-2` en zone Interior (convention `sort_order >= 100` = Terrace non respectée par le seed). |
| P2-10 | PIN saisi 2× en 10 s (login puis open-shift) et le numpad open-shift n'auto-submit pas à 6 chiffres (incohérent avec le login). |

---

## 2. Décisions

- **D1 (P0-2) — Realtime auth = même source de vérité que HTTP.** `setSupabaseAccessToken` et `setSupabaseKioskAccessToken` propagent le token à `client.realtime.setAuth()` ; `getSupabaseClient` ré-applique le token courant à la création. Pas de refactor des hooks. **Filet** : `refetchInterval: 30_000` sur les 2 requêtes critiques multi-device (`pending-tablet-orders`, KDS orders) — un event perdu pendant un blip Wi-Fi est rattrapé en ≤ 30 s.
- **D2 (P0-1) — La politique d'autorisation serveur est la bonne ; le client s'aligne.** Toute remise (ligne ou commande, quel que soit le montant) exige la vérification PIN manager côté client. `isAboveThreshold` reste exporté par `@breakery/domain` (consommateurs hypothétiques) mais `DiscountModal` ne l'utilise plus. Rationale : c'est le design S37 SEC-01 (anti-fraude money-flow), et assouplir le RPC serait une régression de contrôle.
- **D3 (P0-1) — `useVerifyManagerPin` passe en fetch brut** (même pattern que `useCheckout`/`useVoidOrder` via `getAccessToken()`) : contourne le header global `x-app` injecté par `functions.invoke`, donc plus de dépendance au CORS déployé. Les EFs `auth-verify-pin` + `process-payment` sont **redéployées** quand même (le repo `_shared/cors.ts` inclut déjà `x-app` ; le déployé non) — defense in depth pour les autres consommateurs.
- **D4 (P0-1) — Mapping d'erreurs EF par message pour P0001.** `process-payment` distingue `discount_requires_authorizer` (message `%authorizing manager%`) du vrai `no_open_session`. Pas de bump RPC (les ERRCODE dans le RPC v11 restent P0001 — un bump v12 juste pour des codes d'erreur ne vaut pas le churn). `classifyCheckoutError` mappe le nouveau code + `RetryBanner` rend désormais les erreurs `fatal` en bannière persistante (le toast 4 s reste).
- **D5 (P0-3) — Fire comptoir = ordre DB réel, symétrique du chemin tablette.** Nouveau RPC `fire_counter_order_v1(p_client_uuid, p_session_id, p_cart_payload, p_order_id DEFAULT NULL, p_table_number DEFAULT NULL)` modelé sur `create_tablet_order_v2` (mêmes inserts `orders` + `order_items` avec `kitchen_status='pending'`, `is_locked=true`, `sent_to_kitchen_at=now()` ; `created_via='pos'`, `session_id` obligatoire, totaux laissés à 0 comme v2 — `pay_existing_order_v7` calcule le vrai total). Mode append (`p_order_id` non NULL) pour les fires successifs. Idempotence flavor 2 : table dédiée `counter_fire_idempotency_keys`. Le client : RPC **d'abord** (persistance = source de vérité → `markLocked`+`markPrinted` sur succès RPC, échec d'impression = toast seulement), puis impression par station. Le fire set `cartStore.pickedUpOrderId` → le checkout passe **automatiquement** par `pay_existing_order_v7` (chemin existant, battle-testé tablette). Au checkout, les items ajoutés après le dernier fire sont appendés via le même RPC avant paiement. **Effets gratuits** : le KDS couvre le comptoir sans modification (il lit `order_items`), et la table devient « occupée » pour la tablette dès le fire (P1-4 partiellement résolu).
  - **Règle V1** : une remise *ligne* n'est plus applicable sur un item déjà fired (déjà le cas : items locked non éditables) ; la remise *commande* reste possible (`pay_existing_order_v7` la supporte). Hold désactivé quand `pickedUpOrderId` est set (l'ordre est déjà en DB).
- **D6 (P1-1) — Règle sold-out : `track_inventory` d'abord, `display_stock` ensuite.** `useProducts` sélectionne aussi `track_inventory` + `display_stock(quantity)` et dérive `is_sellable` : un produit `track_inventory=false` n'est **jamais** sold out ; sinon sold out quand `display_stock.quantity` (si ligne existante) ou `current_stock` (fallback) ≤ 0. `ProductGrid` (et la grille tablette, qui consomme le même hook) lisent le champ dérivé.
- **D7 (P1-2) — Note obligatoire au-delà du seuil de variance.** `CloseShiftModal` désactive « Close Shift » quand `|variance|` dépasse `thresholdAbs` OU `expectedCash × thresholdPct` (props déjà câblées depuis `useShiftCloseSummary`) et que `notes` est vide — avec message explicite. Le blind count (masquer expected) est **hors scope** (décision owner requise, changerait l'ergonomie du comptage).
- **D8 (P1-3) — Refetch à l'ouverture du panneau.** `OrderHistoryPanel` refetch quand `open` passe à `true`. Fix « Remaining » : sur une commande `paid`, Remaining = `max(0, total − Σ order_payments)` (au lieu du total brut).
- **D9 (P2-6) — Défaut `take_out`.** Le comptoir est takeaway-dominant (contexte owner 2026-05) ; `dine_in` reste à 1 tap. **À valider owner au merge** — changement de stats par défaut.
- **D10 (P2) — Le reste du polish** suit les patterns existants : ConfirmDialog pour void local, modal de note hold (remplace `window.prompt`), label held humain, prop `accessibleTitle` sur `FullScreenModal` (défaut "Dialog", call-sites principaux nommés), fix `##`, badge PAID KDS (ajout `orders.status` au select), clés React uniques, migration data-only (images placeholder → NULL, `sort_order` Patio ≥ 100), favicon statique, `autoSubmitAtMaxLength` opt-in sur `NumpadVirtual` (open-shift PIN).

## 3. Hors scope (acté)

| Sujet | Raison |
|---|---|
| Blind count au close shift | Décision owner requise (ergonomie comptage). |
| Occupation de table avant tout ordre DB (sélection sans fire) | Demande un modèle d'état de table persistant ; D5 couvre le cas dès le 1er fire. Session future. |
| VKP recouvrant le bouton Confirm des dialogs | Utilisable (bouton Done) ; fix propre = repositionnement global du VKP, chantier UI séparé. |
| Refactor draft-order complet du checkout comptoir (fire dès le 1er item) | D5 livre la persistance au fire ; généraliser au panier entier = session dédiée. |
| Suppression double Americano / data seed twins | Déjà traité par Stock Audit m4 (`_018..020`) — les jumeaux sont voulus (fixtures). |
| `useDisplayRealtime` E2E kiosk | Couvert mécaniquement par D1 (kiosk token → setAuth) ; la validation pairing kiosk complète attend un device de test. |

## 4. Critères d'acceptation

1. **Remise 10 % encaissable en navigateur réel** : appliquer une remise ligne 10 % → modal PIN manager → PIN OK → checkout cash → `process-payment` 200, ordre créé avec `discount_authorized_by` non NULL et `audit_logs` `order.discount_applied`. (E2E Playwright + pgTAP existants v11 inchangés.)
2. **Erreur discount lisible** : sans PIN capturé (cas forcé), le 409 affiche une bannière persistante « authorizing manager » — plus de `no_open_session`.
3. **Realtime vivant** : commande tablette créée dans un onglet → badge inbox POS mis à jour **sans reload** en < 5 s ; ticket fired → KDS mis à jour sans reload. (Repro 2 onglets minimum, idéalement 2 devices.)
4. **Fire comptoir persistant** : « Send to Kitchen » comptoir → ligne `orders` (`created_via='pos'`, `status='pending_payment'`, items `kitchen_status='pending'`) visible au KDS ; reload du POS → l'ordre est toujours en DB ; checkout → `pay_existing_order_v7` paie ce même ordre (pas de doublon) ; double-tap fire = 1 seul ordre (idempotence pgTAP).
5. **Sold-out** : un produit `track_inventory=false` avec `current_stock=0` est tapable ; un produit tracké à 0 reste Sold out. La grille dev affiche > 0 produits vendables en Beverage.
6. **Close shift** : variance au-delà du seuil + notes vides → bouton désactivé + message ; avec note → passe.
7. **History à jour** : ouvrir le panneau après une vente → la vente apparaît ; commande paid → Remaining Rp 0.
8. Sweeps verts : domain + UI + POS (baseline env-gated S25 connue exclue), `pnpm typecheck` 6/6, pgTAP nouveaux 100 %.

## 5. Tests exigés

- **pgTAP** `supabase/tests/counter_fire.test.sql` (cloud MCP, BEGIN/ROLLBACK) : création, append, idempotence replay, perm gate P0003, anon REVOKE.
- **Unit** : `packages/supabase` realtime setAuth ; `packages/domain` buildOrderPayload authorizer top-level ; retryClassifier nouveau code.
- **Smokes POS/UI** : DiscountModal (PIN exigé pour toute remise — 3 tests existants à inverser), RetryBanner fatal, useFireToStations RPC-first, CloseShiftModal note gate, OrderHistoryPanel refetch-on-open, sold-out, confirm void, hold note modal, NumpadVirtual auto-submit.
- **E2E Playwright** `tests/e2e/s43-pos-audit-fixes.spec.ts` : discount flow complet + realtime 2 pages + fire counter → KDS.

## 6. Migrations (NAME-block `20260627000010..`)

Base vérifiée avant exécution via `list_migrations` (dernier NAME-block attendu : `20260626000020`).

| # | Contenu |
|---|---|
| `_010` | Table `counter_fire_idempotency_keys` (RLS sans policy, REVOKE all — RPC-only). |
| `_011` | RPC `fire_counter_order_v1` + REVOKE pair canonique S25 inline (PUBLIC + anon + ALTER DEFAULT PRIVILEGES). |
| `_012` | Data-only : `products.image_url` `via.placeholder.com%` → NULL ; `restaurant_tables.sort_order` `Patio-%` → ≥ 100. |
| `_0xx` | Correctives éventuelles découvertes en route (pattern S38 DO-block si signature inchangée). |

EFs redéployées via MCP `deploy_edge_function` : `process-payment` (mapping erreurs + CORS à jour), `auth-verify-pin` (CORS à jour). Types regen après `_010`/`_011` + commit.
