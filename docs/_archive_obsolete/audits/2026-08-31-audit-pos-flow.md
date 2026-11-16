# Audit pos-flow-audit — 2026-08-31

## Synthèse

Parcours réellement effectué : panier (`cartStore`, `ActiveOrderPanel`) → promotions
(`usePromotionsAutoEval` / `useEvaluatePromotions`) → envoi cuisine (`useFireToStations` →
corps live de `fire_counter_order_v7`) → KDS (hooks realtime) → écran client
(`useCartBroadcast` / `useDisplayRealtime`) → paiement (`useCheckout`,
`usePaymentFlowLogic`, `SuccessModal`, corps live de `pay_existing_order_v18`) →
post-paiement (annulation de ligne, reprise, ramassage tablette) → clôture
(`close_shift_v8`). Tous les corps de RPC cités ont été lus via `pg_get_functiondef`
sur V3 dev `ikcyvlovptebroadgtvd`, jamais dans les fichiers de migration.

Verdict : le chemin **panier neuf → `process-payment`** est sain et bien gardé. Le chemin
**« commande déjà persistée » (comptoir *fired* / tablette ramassée / *held* rouverte)**
porte deux défauts d'argent, tous deux du type « échec silencieux ».

**LE P0 : une ligne annulée sous ADR-010 (PIN manager + perte déclarée) est ré-encaissée
au client et re-déstockée au paiement.** Trois requêtes indépendantes — deux serveur, une
client — omettent le filtre `is_cancelled`, alors que leurs voisines immédiates l'ont.
Selon le moment de l'annulation, le résultat est soit une surfacturation silencieuse, soit
un encaissement rendu impossible.

Compte : **2 P0 · 1 P1 · 4 P2 · 1 P3**.

---

## Findings

### [P0] L'article annulé (ADR-010) est ré-encaissé au client et re-déstocké au paiement

**Gap** — Le filtre `is_cancelled` manque sur les trois requêtes qui ressuscitent les
lignes d'une commande déjà persistée. Aucune n'échoue, aucune ne prévient.

1. **`pay_existing_order_v18`** (corps live, `pg_get_functiondef`) — le total facturé :
   `SELECT COALESCE(SUM(line_total), 0) INTO v_items_total FROM order_items WHERE order_id = p_order_id;`
   Aucun `AND is_cancelled = false` — alors que la requête écrite **deux lignes plus bas**
   dans la même fonction (`v_eval_subtotal`) filtre bien `oi.is_cancelled = false AND
   oi.is_promo_gift = false`. La boucle de déstockage (`FOR v_item IN SELECT oi.product_id,
   oi.quantity, oi.combo_components … FROM order_items oi JOIN products p … WHERE
   oi.order_id = p_order_id FOR UPDATE OF p`) n'a pas le filtre non plus.
2. **`reopen_held_order_v1`** (corps live) — `SELECT jsonb_agg(…) FROM order_items oi WHERE
   oi.order_id = p_order_id` : ni filtre, ni champ `is_cancelled` dans l'objet renvoyé.
   `cartStore.reopenOrder` (`apps/pos/src/stores/cartStore.ts:531`) ne peut donc pas le poser.
3. **`usePickupTabletOrder`** — `apps/pos/src/features/inbox/hooks/usePickupTabletOrder.ts:63-64` :
   `.select('id, product_id, name_snapshot, unit_price, quantity, modifiers').eq('order_id', orderId)` ;
   `toCartItem` (même fichier, l.27) ne porte pas `is_cancelled` sur la ligne de panier.

Or `cancel_order_item_rpc_v6` (corps live) **ne remet jamais `line_total` à zéro** : il pose
`is_cancelled = true` et recalcule `orders.subtotal/tax/total` avec, lui,
`WHERE order_id = v_order_id AND is_cancelled = false`. La ligne annulée garde donc son
montant, et c'est ce montant que les trois requêtes ci-dessus ramassent.

Trois conséquences distinctes, toutes réelles :

- **(a) Surfacturation silencieuse** — annulation faite AVANT le ramassage/la réouverture :
  la ligne revient au panier POS comme une ligne normale (rien ne dit qu'elle est annulée),
  le client la voit, `calculateTotals` la facture, `pay_existing_order_v18` la facture aussi.
  Les deux côtés sont d'accord sur un total faux : aucun garde-fou ne se déclenche.
- **(b) Encaissement impossible** — annulation faite APRÈS (le POS a appelé `markCancelled`) :
  le client exclut la ligne, le serveur l'inclut, et le contrôle
  `IF v_pay_sum <> v_total THEN RAISE EXCEPTION 'Sum of tender amounts (%) != order total (%)'`
  refuse le paiement. Le caissier est bloqué devant le client, sans message actionnable.
- **(c) Double sortie de stock** — la boucle de déstockage passe sur la ligne annulée **en
  plus** du mouvement de perte déjà posé par `_record_order_item_waste_v1` dans
  `cancel_order_item_rpc_v6`. Le ledger `stock_movements` étant append-only, l'écart est
  définitif et ne se voit qu'à l'opname.
- **Effet de bord** : `pay_existing_order_v18` termine par
  `UPDATE orders SET subtotal = v_items_total …`, ce qui **écrase le recalcul correct** de
  `cancel_order_item_rpc_v6`. L'annulation disparaît des totaux de la commande.

**Who it helps** — Caissier (chemin comptoir *fired* et ramassage tablette), serveuse
(salle), client (il paie ce qu'il n'a pas), manager (variance de caisse et écarts d'opname
inexplicables).

**Proposal** — Ajouter `AND is_cancelled = false` aux deux requêtes de
`pay_existing_order_v18` (total facturé + boucle de déstockage) dans un bump `_v19`
(`DROP` du `_v18` dans la même migration, RPC versioning monotone) ; ajouter le filtre et
le champ `is_cancelled` à `reopen_held_order_v1` → `_v2` ; ajouter `is_cancelled` au
`.select()` de `usePickupTabletOrder` et le porter sur `CartItem` dans `toCartItem`, pour
que la ligne annulée reste **visible et barrée** au POS (traçabilité) sans être facturée.
Le rendu barré existe déjà (`CartLineRow` gère `is_cancelled`).

**Fits existing patterns** — Aucun nouveau chemin d'écriture : c'est un prédicat manquant
sur des RPC existantes. Idempotence inchangée (`p_idempotency_key`). Aucune permission
nouvelle. `_record_sale_stock_v1` reste l'unique helper de stock de vente.

**Effort & risk** — S côté SQL (2 prédicats + 1 champ renvoyé), S côté POS. L'invariant le
plus risqué : le bump doit re-viser les 3 call-sites (`useCheckout` l.220
`pay_existing_order_v18`, `offlineReplay.ts` l.181, `useReopenHeldOrder`) et régénérer
`types.generated.ts`.

**How to validate** — pgTAP `BEGIN/ROLLBACK` : créer une commande tablette à 2 lignes,
annuler l'une par `cancel_order_item_rpc_v6`, appeler `pay_existing_order_v19` et asserter
(i) `orders.total` = total de la seule ligne vivante, (ii) aucun `stock_movements` de type
vente sur le produit annulé, (iii) le tender égal au total vivant est ACCEPTÉ. Puis smoke
POS : `pnpm --filter @breakery/app-pos test tablet` et un repro deux surfaces
tablette→POS. **Comptage en base dev** : 78 commandes, **0 ligne annulée** — le défaut est
donc latent, aucun dégât mesurable à ce jour, ce qui est exactement pourquoi il n'a pas
encore été vu.

---

### [P0] Commande de salle : un combo ne déduit AUCUN stock, et son prix n'est jamais résolu serveur

**Gap** — `create_tablet_order_v8` (corps live) insère dans `order_items` **sans écrire
`combo_components` ni `modifier_ingredients_deducted`** :

```
INSERT INTO order_items (
  order_id, product_id, name_snapshot, unit_price, quantity, line_total,
  modifiers, modifiers_total, dispatch_station, dispatch_stations,
  is_locked, kitchen_status, sent_to_kitchen_at) VALUES (…)
```

Son jumeau comptoir `fire_counter_order_v7` écrit les deux (`CASE WHEN p.product_type =
'combo' THEN COALESCE(v_item->'combo_components', '[]') …` et
`_resolve_modifier_ingredients_v1` / `_resolve_combo_modifier_ingredients_v1`).

Or `pay_existing_order_v18` déduit **exactement** ces deux colonnes :
`IF v_item.product_type = 'combo' THEN FOR v_comp IN jsonb_array_elements(COALESCE(v_item.combo_components,'[]'))` —
et rien d'autre. Un combo venu de la tablette a `combo_components IS NULL` → la boucle
tourne à vide **et la branche `ELSE` (déstockage du produit lui-même) est sautée** : le
combo est vendu avec **zéro mouvement de stock**. De même,
`modifier_ingredients_deducted IS NULL` → aucun ingrédient de modificateur déduit.

Relevé en base dev : **6 des 17 options de modificateur actives (35 %) portent
`ingredients_to_deduct`** ; **2 combos actifs sont visibles au POS** et la grille tablette
les affiche (`TabletProductGrid.tsx:216`, badge combo). Le panier tablette ne pose d'ailleurs
jamais `combo_components` — `grep -rl combo_components apps/pos/src` ne retourne aucun
fichier de `features/tablet` : la serveuse ajoute un combo sans jamais choisir ses composants.

Second volet, prix : le relevé `pg_proc` sur le corps de toutes les fonctions montre que
`_resolve_combo_price_v1` n'est appelée que par `complete_order_with_payment_v27` et
`_resolve_line_price_v2`. Ni `create_tablet_order_v8` ni `fire_counter_order_v7` ne
l'appellent : ils prennent `v_unit_price := (v_item->>'unit_price')::DECIMAL` du client tel
quel. Sur ces deux chemins, ni les groupes requis, ni les surcharges de composants ne sont
exigés serveur. Cela contredit CLAUDE.md, « Combos validés ET pricés serveur
(`_resolve_combo_price_v1`) […] groupes requis exigés serveur » — l'affirmation ne vaut que
pour `complete_order_with_payment`.

**Who it helps** — Manager (stock des composants et des ingrédients de modificateurs
justes), cuisine (le KDS voit la composition), comptabilité (le COGS d'un combo de salle
est aujourd'hui nul).

**Proposal** — Aligner `create_tablet_order_v8` sur `fire_counter_order_v7` (`_v9`) :
persister `combo_components` et appeler `_resolve_modifier_ingredients_v1` /
`_resolve_combo_modifier_ingredients_v1`. Côté prix, faire appeler `_resolve_combo_price_v1`
par les deux RPC d'envoi en cuisine, de sorte que les trois chemins d'argent partagent la
même autorité de prix. Côté POS, ouvrir le sélecteur de composants (`useComboConfig`,
déjà utilisé par `ComboCartLineRow`) sur la grille tablette, ou masquer les combos de cette
grille tant que la sélection n'existe pas — **arbitrage produit à Mamat**, pas une décision
d'agent.

**Fits existing patterns** — Réutilise les helpers serveur existants ; aucun nouveau
chemin. Idempotence `p_client_uuid` / `tablet_order_idempotency_keys` inchangée.
ADR-017 (modificateurs de composants) et ADR-012 déc. 1 sont les décisions de référence.

**Effort & risk** — M. Risque : `_resolve_combo_price_v1` refuserait des combos existants
mal composés — le drapeau `p_tolerate_unsellable` fournit déjà le précédent d'un
assouplissement tracé en `audit_logs`.

**How to validate** — pgTAP : commander un combo via `create_tablet_order_v9`, payer via
`pay_existing_order`, asserter un `stock_movements` par composant et par ingrédient de
modificateur. Repro deux surfaces tablette→POS→KDS pour la composition affichée.

---

### [P1] « Cancel item » est proposé sur une commande comptoir *fired*, où il ne peut jamais aboutir

**Gap** — `ActiveOrderPanel.tsx:245` branche l'action d'annulation de ligne dès que
`pickedUp` est vrai, et `pickedUp` vaut `Boolean(pickedUpOrderId)` (même fichier, l.145).
Mais `useFireToStations` pose `pickedUpOrderId` **aussi après un envoi comptoir**
(`useCartStore.getState().setPickedUpOrderId(env.order_id)`, dans la branche `if
(!existingOrderId)`). Or `fire_counter_order_v7` insère ses lignes sans colonne `id` — donc
avec `gen_random_uuid()` — et `useFireToStations` ne transmet même pas `i.id` dans
`p_items`. L'identifiant de ligne du panier POS n'existe donc **pas** dans `order_items`.
Le clic envoie `orderItemId: cartTarget.id` (`ActiveOrderPanel.tsx:328`) → `cancel-item` →
`cancel_order_item_rpc_v6` → `RAISE EXCEPTION 'Order item not found' USING ERRCODE = 'P0002'`.

L'invariant est explicitement écrit dans le code et a été cassé par un chantier ultérieur :
`CartLineRow.tsx:51-55` documente `onRequestCancel` comme « Provided by ActiveOrderPanel
when the cart is rooted on **a tablet pickup** (item.id is a real UUID, so the cancel-item
RPC can address it) ». Le fire serveur d'ADR-022 a élargi `pickedUpOrderId` sans élargir
l'invariant.

Conséquence métier : sur le chemin comptoir, retirer un article déjà parti en cuisine est
**impossible ligne à ligne**. Le manager a saisi son PIN, déclaré la perte, et récolte une
erreur technique ; il ne reste que l'annulation de la commande entière (`VoidOrderModal`),
qui perd la déclaration de perte par ligne voulue par ADR-010 déc. 4.

**Who it helps** — Caissier et manager sur le chemin comptoir (le plus fréquent).

**Proposal** — Deux options, à arbitrer : (a) faire renvoyer par `fire_counter_order` la
correspondance `client_line_id → order_items.id` et la poser dans le `cartStore` (le plus
propre, aligne le comptoir sur la tablette) ; ou (b) restreindre `onRequestCancel` aux
paniers dont les ids sont des ids serveur (ramassage tablette + réouverture) et donner au
caissier comptoir un chemin explicite. (a) est nécessaire de toute façon si l'on veut
qu'ADR-010 s'applique au comptoir.

**Fits existing patterns** — L'enveloppe de `fire_counter_order` renvoie déjà
`{order_id, order_number, idempotent_replay}` ; l'ajout d'une table de correspondance est
additif. `reopenOrder` fait déjà exactement cette réutilisation d'id côté *held*.

**Effort & risk** — M. Risque : `markLocked`/`markPrinted` sont indexés sur les ids de
panier — un remplacement d'id doit être atomique avec le scellement, sinon une ligne
devient re-tirable (duplication serveur).

**How to validate** — Smoke POS : monter un panier, tirer en cuisine, ouvrir le modal
d'annulation sur une ligne, asserter que la mutation aboutit ; aujourd'hui elle rend
`P0002`. Test de non-régression : aucune ligne ne redevient éditable après le fire.

---

### [P2] Le miroir du panier vers l'écran client ne franchit pas la frontière de l'appareil

**Gap** — `useCartBroadcast` / `useCartBroadcastReceiver` (`features/display/hooks/`)
transportent le panier vivant et la confirmation de paiement par `new
BroadcastChannel('breakery-cart')` — un canal **même origine, même instance de
navigateur**. `busTopics.ts` ne définit aucun sujet de panier sur le bus LAN (seulement
`order.fired`, `order.item_status`, `order.paid_offline`), et `useDisplayRealtime` ne
sert que la file des commandes prêtes et la vitrine. Or l'écran client dispose d'un
appairage d'appareil distinct (`useKioskAuth`, `PairDevicePrompt`) qui suppose une
seconde machine. Sur un second écran piloté par le MÊME poste (seconde fenêtre Chrome),
tout fonctionne ; sur une tablette appairée, le total vivant et l'écran « merci / monnaie
à rendre » ne s'afficheront **jamais**, sans aucune erreur.

**Who it helps** — Client (voir ce qu'il paie), caissier (l'écran confirme le rendu).

**Proposal** — Soit documenter la contrainte de déploiement (l'écran client est une
seconde fenêtre du poste caisse, jamais un appareil appairé) — c'est peut-être l'intention,
et alors c'est une ligne d'ADR à écrire ; soit ajouter un sujet `cart.update` /
`cart.paid` au bus LAN existant, qui est déjà le véhicule inter-appareils du site.

**Fits existing patterns** — `hubBus.publish` + `busTopics.ts` + gardes de parsing sont
le patron établi ; un sujet de plus y est additif.

**Effort & risk** — S si l'on documente, M si l'on porte sur le bus. Risque : le panier
vivant transite alors sur le LAN — pas de donnée sensible, mais un débit à cadencer.

**How to validate** — Repro sur deux surfaces physiques (poste + tablette appairée) —
non faisable dans cette session, voir la dernière section.

---

### [P2] Le seuil d'une promotion ignore les suppléments payants

**Gap** — `useEvaluatePromotions.ts:188` calcule le sous-total soumis à l'évaluateur ainsi :
`(s, it) => (it.is_promo_gift ? s : s + it.unit_price * it.quantity)`, et
`cartToRpcPayload` (même fichier, l.146-153) envoie `unit_price` nu. Le serveur fait le
même calcul (`pay_existing_order_v18` : `SELECT COALESCE(SUM(oi.unit_price * oi.quantity),
0) INTO v_eval_subtotal`). Client et serveur sont donc **cohérents** — ce n'est pas une
divergence — mais les deux ignorent ce que `lineTotalOf` facture réellement : les
surcharges d'options (`price_adjustment`) et les ajustements de modificateurs de composants
de combo (ADR-017). Un client qui règle 120 000 dont 15 000 de suppléments n'atteint pas un
seuil promo fixé à 110 000, alors qu'il a bien dépensé la somme.

**Who it helps** — Client (la promo qu'il a méritée s'applique), gérant (le seuil promo
veut dire ce qu'il annonce).

**Proposal** — Décider explicitement ce que « sous-total » veut dire pour un seuil promo :
prix catalogue ou montant réellement payé. Si c'est le second, faire porter au payload
d'évaluation le total de ligne (`lineTotalOf`) et aligner `v_eval_subtotal` sur
`SUM(line_total)`. **C'est un arbitrage produit** — la fiche `docs/objectifs/PROMOTIONS_AND_COMBOS.md`
doit trancher avant tout code.

**Fits existing patterns** — `lineTotalOf` / `lineUnitEach` sont déjà l'unique formule du
domaine ; le payload d'évaluation est le seul endroit qui ne les consulte pas.

**Effort & risk** — S en code, mais le changement déplace le déclenchement de promotions
existantes : à valider en amont côté produit.

**How to validate** — Test domaine sur `evaluatePromotionsFallback` avec une ligne portant
un `price_adjustment`, plus un pgTAP miroir sur `evaluate_promotions_v2`.

---

### [P2] `auth-verify-pin` reçoit le PIN dans le body JSON d'une Edge Function

**Gap** — `supabase/functions/auth-verify-pin/index.ts` : `body = await req.json();` puis
`const { user_id, pin, device_type, required_permission } = body;` (l.51-56). La règle de
CLAUDE.md est nette et son périmètre est justement les Edge Functions : « PIN / secrets en
header HTTP, jamais en body JSON (les bodies sont loggés) ». Toutes les autres EF du dépôt
la respectent (`x-manager-pin` dans `useCancelOrderItem`, `useCheckout`,
`verify-manager-pin`). C'est le seul point d'entrée PIN resté en body, et c'est celui du
**login** — donc le PIN de tous les utilisateurs, pas seulement des managers.

**Who it helps** — Tout le personnel (le PIN de connexion ne transite plus par un champ
susceptible d'être journalisé).

**Proposal** — Hard cutover (jamais de dual-mode, per CLAUDE.md) : lire le PIN dans un
en-tête dédié, et bumper le call-site POS dans le même commit.

**Fits existing patterns** — `verify-manager-pin` fait déjà exactement cela ; le lockage
(`pin_max_failed` / `pin_lockout_minutes`) et le rate-limit restent inchangés.

**Effort & risk** — S. Risque : c'est le chemin de connexion — un cutover raté enferme
tout le monde dehors. À livrer avec un plan de retour.

**How to validate** — Smoke `pnpm --filter @breakery/app-pos test` sur les tests d'auth, et
une connexion réelle sur la base dev.

**Note d'honnêteté** — je n'ai pas prouvé que ce body-là est effectivement journalisé
quelque part ; la règle du dépôt, elle, est explicite et sans exception écrite.

---

### [P2] Un quatrième fork de la formule de prix de ligne, dans l'angle mort de la garde CI n°10

**Gap** — `packages/domain/src/tablet/calculatePreview.ts:31` :
`items_total += roundIdr((item.unit_price + adjustment) * item.quantity);`
C'est la recomposition manuelle que la garde `line-total-formula` existe pour tuer — mais
la garde ne balaie que `apps/` (son en-tête le dit : « `packages/domain` est LA maison de
la formule : il n'est pas balayé »). Elle ignore `combo_components`, donc diverge de
`lineTotalOf` dès qu'une ligne tablette en portera. Aujourd'hui l'écart est **nul** : le
panier tablette ne pose jamais `combo_components` (cf. P0 ci-dessus). C'est donc une mine,
pas une blessure : le jour où le P0 combo/tablette est corrigé, l'aperçu affiché à la
serveuse se met à sous-estimer le total sans que rien ne l'annonce.

**Who it helps** — Serveuse (l'aperçu tablette annonce le vrai prix), et l'équipe (une
quatrième résurrection du bug combo évitée d'avance).

**Proposal** — Faire appeler `lineTotalOf` par `calculatePreview` (les deux vivent dans
`packages/domain`, aucune dépendance nouvelle). Signaler à Mamat que la garde n°10 laisse
`packages/domain` hors périmètre par conception — c'est défendable, mais il faut alors que
le domaine n'ait qu'UNE formule, ce qui n'est pas le cas.

**Fits existing patterns** — `lineTotalOf` est explicitement l'unique source ;
`calculateTotals` l'utilise déjà.

**Effort & risk** — S. Aucun invariant à risque ; les tests
`packages/domain/src/tablet/__tests__/calculatePreview.test.ts` couvrent le comportement.

**How to validate** — `pnpm --filter @breakery/domain test` (suite tablet + cart).

---

### [P3] Deux RPC du parcours sont publiées sans suffixe de version

**Gap** — `pickup_tablet_order(uuid, uuid)` et `mark_item_served(uuid)` (relevé `pg_proc`)
n'ont pas de suffixe `_vN`. Toutes leurs voisines du parcours en ont
(`fire_counter_order_v7`, `pay_existing_order_v18`, `create_tablet_order_v8`,
`reopen_held_order_v1`, `close_shift_v8`). Le versioning monotone de CLAUDE.md n'a donc
pas de prise sur elles : le jour où il faut en modifier une, l'usage veut créer `_vN+1` et
`DROP` l'ancienne — impossible sans nommer d'abord la `_v1`.

**Who it helps** — L'équipe (une modification future du ramassage tablette ou du bump KDS
sans édition en place d'un objet publié).

**Proposal** — Créer `pickup_tablet_order_v1` et `mark_item_served_v1` à l'identique du
corps live, `DROP` les non-versionnées dans la même migration, bumper les deux call-sites
(`usePickupTabletOrder`, `useMarkItemServed`), régénérer les types.

**Fits existing patterns** — C'est exactement le patron de bump du dépôt.

**Effort & risk** — S, mais purement de la dette : à faire au prochain besoin de toucher
l'une des deux, pas isolément.

**How to validate** — `pnpm typecheck` après régénération des types + smoke inbox/KDS.

---

## Dérives de la skill

La skill s'interdit les ancres `fichier:ligne` (« aucun `fichier:ligne` ici — un numéro de
ligne pourrit au premier commit ») et n'en porte effectivement aucune : rien à corriger de
ce côté. Ses ancres stables ont toutes été re-vérifiées et **tiennent** :

- table des familles de RPC : les huit familles citées existent, aux versions vivantes
  `fire_counter_order_v7`, `pay_existing_order_v18`, `create_tablet_order_v8`,
  `complete_order_with_payment_v27`, `close_shift_v8`, `evaluate_promotions_v2`,
  `reopen_held_order_v1`, `hold_fired_order_v1` — cohérent avec l'avertissement de la
  skill que les versions bumpent ;
- « `pickup_tablet_order` (pas de suffixe de version) » et « `mark_item_served` (pas de
  suffixe de version) » : exact, et c'est justement mon P3 ;
- table des canaux realtime : les six noms sont exacts, forme `préfixe-{discriminant}-{uuid}`
  vérifiée dans chaque hook ;
- « le POS n'appelle jamais `complete_order_with_payment` directement » : exact
  (`useCheckout` passe par l'EF `process-payment`) ;
- « `useHoldFiredOrder` dans `features/cart/hooks` » : exact ;
- « (`auth-verify-pin` prend le PIN dans le body d'une EF — candidate finding, celui-là
  reste valable) » : **toujours vrai**, c'est mon P2 ;
- les preuves pgTAP citées existent bien (`adr022_paid_order_reaches_kds.test.sql`,
  `counter_fire.test.sql`, `held_orders.test.sql`, `hold_fired_order_v1.test.sql`,
  `reopen_held_order_v1.test.sql`).

**La seule dérive constatée n'est pas dans la skill mais dans CLAUDE.md.** La ligne
« Combos validés ET pricés serveur (`_resolve_combo_price_v1`) — y compris les
modificateurs des composants : ajustements résolus contre le composant, groupes requis
exigés serveur » se lit comme un invariant du money-path. Le relevé sur le corps live de
toutes les fonctions montre que `_resolve_combo_price_v1` n'est appelée que par
`complete_order_with_payment_v27` et `_resolve_line_price_v2` : ni `fire_counter_order_v7`
ni `create_tablet_order_v8` ne la consultent. L'affirmation est vraie d'UN chemin sur trois.
**Je la signale, je ne corrige rien** (règle documentaire 1).

Un point que la skill laissait ouvert et que je referme : sa checklist A demande
« **vérifie toi-même si les promotions sont ré-évaluées** après réouverture ou si le client
paie sans elles ». Vérifié : **elles le sont**. `usePromotionsAutoEval` est monté dans
`ActiveOrderPanel` et son `useEffect` dépend de `cart` ; `reopenOrder` et `restoreCart`
remplacent l'objet `cart` et remettent `appliedPromotions: []`, ce qui redéclenche
l'évaluation débouncée à 200 ms. Ce n'est pas un défaut.

---

## Faux positifs écartés

- **Envoi cuisine « client-only »** — clos par ADR-022 : `useFireToStations` appelle
  `fire_counter_order_v7`, qui persiste avant d'imprimer, et scelle
  (`markLocked` + `markPrinted`) quel que soit le sort de l'impression.
- **`hold_order` / `restore_held_order`** — mortes (ADR-022 déc. 4). Non ressuscitées, non
  proposées.
- **PIN de `close_shift` passé en argument** — correct par l'arbitrage du 2026-08-31, ET
  réellement vérifié : le corps live appelle `public._verify_pin_with_lockout(p_approver_id,
  p_manager_pin)` après avoir contrôlé la permission `shift.variance.approve` de
  l'approbateur et le format `^\d{6}$`. Le critère d'audit (« la cible vérifie-t-elle le
  PIN, avec verrouillage ? ») est satisfait.
- **Clôture de shift** — note de variance exigée serveur (`variance_note_required`), PIN
  sur gros écart, three-way cash/QRIS/carte, dénominations, `closed_by = v_profile` (id de
  profil, pas `auth.uid()`) : tout vérifié sur le corps live, chantier livré.
- **Tiroir-caisse inconditionnel** — corrigé : `SuccessModal.tsx` gate sur
  `needsDrawer = props.paymentMethod === 'cash' || (props.changeGiven ?? 0) > 0`.
- **Reçu avec `method: 'cash'` figé** — corrigé : `buildReceiptPayload` consomme
  `props.paymentMethod`, et `cash_received` vient de la somme des règlements expédiés, pas
  du brouillon.
- **Taxe 0,10 en dur** — plus sur le parcours : `useTaxConfig` sert le taux et le mode
  serveur ; `DEFAULT_TAX_RATE` ne subsiste que comme valeur de repli pendant le chargement.
- **Canaux realtime perdus** — les six hooks portent un `crypto.randomUUID()` par mount,
  et chacun a un filet : `refetchInterval` (`usePendingTabletOrders`), invalidation sur
  `online` (`useTabletOrderStatusListener`, `useHeldOrdersRealtime`, `useDisplayRealtime`),
  remontée d'état de connexion (`useKdsRealtime`).
- **`earnPointsForCustomer` côté client** — n'est qu'un repli lorsque l'enveloppe serveur
  omet les points ; les points réels viennent de la RPC.
- **Formule de prix de ligne dans `apps/`** — `lineTotalOf` est bien propagé
  (`SuccessModal`, `CartLineRow`, `OrderSummaryPanel`, `calculateTotals`) ; la garde CI
  n°10 tient. Le seul reliquat est dans `packages/domain`, hors de son périmètre (mon P2).
- **8 produits sur 152 (5,3 %) ne routent vers aucune station KDS** — relevé fait, puis
  écarté : ce sont 6 matières premières de la catégorie BEVERAGE (sirops, grains de café,
  eau) et 2 produits « Vitest PO Product » laissés `visible_on_pos` en base **dev**. Toutes
  les catégories vendables (Coffee, Cake, Sandwiches, Viennoiserie…) portent une station
  réelle. C'est de l'hygiène de catalogue en dev, pas un défaut de flux — et le bouton
  d'envoi remonte déjà un avertissement non bloquant via `unroutedCount`.

---

## Ce que je n'ai pas pu vérifier

- **Tout ce qui exige deux surfaces physiques.** Le miroir du panier vers l'écran client
  (P2), la propagation d'un fire vers un vrai écran KDS, la remontée `ready` vers la
  tablette de la serveuse, et la collision de canaux realtime sous StrictMode : aucun de
  ces comportements ne se prouve depuis une seule session. Le second onglet ne suffit pas —
  la skill le dit, et c'est précisément le point du P2 sur `BroadcastChannel`.
- **Le pourcentage de lignes touchées par le P0 n°1.** La base dev V3 contient 78
  commandes et **zéro** ligne `is_cancelled` ; aucune mesure d'impact n'est possible. Le
  défaut est établi par lecture des trois corps live, pas par les données.
- **L'impact du P0 n°2 en volume.** Zéro ligne de combo et zéro ligne à modificateur sur
  les commandes `created_via='tablet'` en dev. Les seuls chiffres tenables sont statiques :
  2 combos visibles au POS, 6 des 17 options de modificateur actives portant
  `ingredients_to_deduct`.
- **L'impression de station et le tiroir-caisse.** Le pont d'impression local n'est pas
  joignable depuis cette session ; le comportement `no_printer` / `copies = 0` n'a été lu
  que dans le code.
- **La suite de tests.** Consigne respectée : la suite POS complète n'a pas été lancée
  (elle part en timeout en local, la CI est le seul filet full-suite). Aucun test n'a été
  exécuté — cet audit est une lecture, pas une preuve d'exécution.
- **Le journal effectif des bodies d'Edge Function** (P2 `auth-verify-pin`) : je constate
  la violation de la règle du dépôt, pas une fuite observée.
