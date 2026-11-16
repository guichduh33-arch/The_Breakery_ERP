# Audit 02 — Dette technique, code mort et plan de nettoyage

> **Relevé du 2026-11-09**, branche `master` à `e204d57a`, arbre de travail propre.
> Mode **lecture seule** : aucun fichier applicatif modifié, supprimé ou commité.
> Aucun build, test, lint ou install lancé.
>
> **Toute analyse ci-dessous est statique.** Un fichier déclaré mort reste à
> confirmer par `pnpm typecheck` et la suite de tests complète avant tout
> retrait réel. Le classement « sûr / à vérifier / dangereux » est un avis
> d'audit, pas une autorisation.

---

## 0. Résumé

| Dimension | Mesure |
|---|---|
| Fichiers de code vivant scannés | 2 329 (`.ts`/`.tsx`/`.mjs`/`.js`) |
| Fichiers > 400 lignes (hors générés et tests) | **38** |
| Fichiers > 500 lignes (plafond `AGENTS.md`) | **11** |
| Fichiers orphelins confirmés (0 importeur) | **18** |
| Exports de paquets sans consommateur de production | 55 de valeur (sur 176 bruts) |
| `any` en code de production | **24** sur ~2 200 fichiers TS |
| `as unknown as` hors tests | **248** |
| `@ts-ignore` | **0** |
| `TODO` / `FIXME` / `HACK` dans le code vivant | **1** |
| Fichiers 0 octet suivis par git | **0** |
| Fichiers non suivis et non ignorés | **0** |
| Déchet d'outillage ignoré par git | **~190 Mo** |

**Ce dépôt est nettement au-dessus de la moyenne.** Le `strict` TypeScript est
complet, il n'y a aucun `@ts-ignore`, aucun `catch` muet par négligence, aucun
secret exploitable, aucune dette signalée par commentaire. La dette réelle est
concentrée et nommable :

1. **Un trou de filet P0** : `supabase/functions` n'est ni lintée ni typecheckée.
2. **Le typage s'arrête à la frontière RPC** : 248 casts, dont ~103 de réponse
   non validée côté back-office.
3. **Deux injections de filtre PostgREST** dues à un sanitizer dupliqué 4 fois
   sans garde CI.
4. **18 fichiers morts**, dont deux trous de parcours déguisés en code mort.
5. **11 fichiers au-delà du plafond de 500 lignes**, dont `routes/index.tsx` à
   1 278.

---

## 1. Fichiers monolithiques

### 1.1 Au-delà du plafond `AGENTS.md` de 500 lignes

La règle est outillée par `max-lines: ['warn', { max: 500 }]`
(`eslint.config.mjs:34`) — **un avertissement, pas une erreur**. C'est pourquoi
11 fichiers la dépassent sans bloquer la CI.

| Lignes | Fichier | Nature du découpage possible |
|---|---|---|
| **1 278** | `apps/backoffice/src/routes/index.tsx` | 138 `<Route>`, 124 `lazy()`, 4 gardes. Découpable par domaine : un module de routes par aire métier, les gardes dans leur propre fichier. |
| 700 | `apps/backoffice/src/pages/purchasing/PurchaseOrderDetailPage.tsx` | onglets / panneaux |
| 657 | `apps/backoffice/src/pages/orders/OrdersListPage.tsx` | filtres, table, barre d'actions |
| 625 | `apps/backoffice/src/pages/Inventory.tsx` | onglets |
| 545 | `apps/backoffice/src/pages/customers/CustomersListPage.tsx` | filtres + table |
| 536 | `apps/backoffice/src/pages/reports/RefundsVoidsPage.tsx` | KPI + table + export |
| **528** | `apps/pos/src/features/settings/POSSettingsPage.tsx` | 7 onglets déjà séparés en composants ; la page les orchestre |
| 513 | `apps/backoffice/src/pages/reports/DailySalesPage.tsx` | — |
| 510 | `apps/backoffice/src/features/recipes/components/RecipeBuilder.tsx` | le plus dense fonctionnellement |
| 509 | `apps/backoffice/src/pages/reports/SalesByCustomerPage.tsx` | — |
| **503** | `apps/pos/src/features/combos/components/ComboConfigModal.tsx` | money-path combo (ADR-017) |

### 1.2 Entre 400 et 500 lignes

27 fichiers de plus. Ils ne violent aucune règle, mais pèsent sur la relecture.
Les plus notables sur un parcours argent :

| Lignes | Fichier |
|---|---|
| 499 | `apps/pos/src/stores/cartStore.ts` |
| **498** | `apps/pos/src/features/payment/hooks/usePaymentFlowLogic.ts` — le nœud du money-path |
| 493 | `apps/pos/src/features/cart/hooks/useFireToStations.ts` |
| 493 | `apps/pos/src/features/cart/BottomActionBar.tsx` |
| 487 | `apps/pos/src/features/shift/components/CloseShiftModal.tsx` |
| 485 | `apps/backoffice/src/features/inventory-production/components/ProductionEntryCard.tsx` |
| 464 | `apps/pos/src/features/cart/CustomerAttachModal.tsx` |
| **428** | `supabase/functions/process-payment/index.ts` — et il n'est ni linté ni typechecké (§5.1) |
| 425 | `apps/pos/src/features/display/CustomerDisplayView.tsx` |
| 419 | `apps/pos/src/features/kds/components/KdsOrderCard.tsx` |

Les 17 autres sont des pages de rapport et des panneaux de catalogue, listés par
`git ls-files '*.ts' '*.tsx' | grep -v types.generated | grep -v __tests__` + `wc -l`.

> **Avis.** Le seul découpage qui paie vraiment est `routes/index.tsx` : c'est le
> fichier le plus modifié du back-office (6 fois en 2 semaines), et un fichier de
> 1 278 lignes modifié 6 fois est une surface de conflit de merge. Les autres sont
> de la dette de confort.

---

## 2. Fichiers orphelins — jamais importés

**Méthode.** Extraction de tous les spécificateurs d'import (`from '…'`,
`import('…')`, `require('…')`) de la totalité du code vivant, indexation par nom
de base **et par chaque segment de chemin** (pour couvrir l'import par dossier →
`index.ts`), puis recoupement par `grep` nominal et par regex d'instruction
d'import réelle. 57 candidats bruts → **18 orphelins réels**.

> **Note de méthode qui a failli fausser ce rapport.** Un premier script écrit par
> heredoc shell est ressorti avec `'\\b'` collapsé en `'\b'` : la regex contenait
> un caractère **backspace (0x08)** au lieu d'une frontière de mot, et déclarait
> « 514 exports sur 514 jamais utilisés ». Tous les chiffres de ce document
> proviennent de scripts réécrits hors shell et recoupés par `grep` direct. C'est
> exactement la classe de faux relevé qui a déjà produit des rapports faux dans
> ce dépôt.

### 2.1 Orphelins confirmés — 0 importeur, 0 mention hors du fichier

| Fichier | Lignes | Risque de retrait |
|---|---|---|
| `apps/pos/src/features/auth/hooks/useAuthPin.ts` | 62 | **sûr** |
| `apps/pos/src/features/auth/components/UserPicker.tsx` | — | **sûr** (`Login.tsx` fait son propre picker) |
| `apps/pos/src/features/customers/components/CustomerAttachButton.tsx` | 16 | **sûr** |
| `apps/pos/src/features/discounts/components/DiscountButton.tsx` | 25 | **sûr** |
| `apps/pos/src/features/discounts/components/LineDiscountButton.tsx` | 22 | **sûr** |
| `apps/pos/src/features/products/CategorySidebar.tsx` | 55 | **sûr** |
| `apps/backoffice/src/features/expenses/components/CategoryPicker.tsx` | 47 | **sûr** |
| `apps/backoffice/src/features/loyalty/components/CustomerListRow.tsx` | 175 | **sûr** |
| `apps/backoffice/src/features/promotions/components/PromotionListRow.tsx` | 87 | **sûr** |
| `apps/backoffice/src/features/suppliers/components/SupplierListRow.tsx` | 47 | **sûr** |
| `apps/backoffice/src/features/devices/hooks/useLanDevices.ts` | 31 | **sûr** — voir §3.1 |

**Pièges à connaître sur cette liste.**

- `CategorySidebar.tsx` : l'unique match de `grep` est `TabletCategorySidebar`,
  un **autre** composant. Le voisin vivant dans le même dossier est
  `CategoryNav.tsx`, qui a son test.
- `CustomerListRow` / `PromotionListRow` / `SupplierListRow` : **le nom survit,
  mais comme type exporté par un hook**, pas comme composant.
  `CustomerDeleteConfirm.tsx:11` importe
  `type { CustomerListRow } from '../hooks/useLoyaltyCustomersList.js'`.
  Supprimer le `.tsx` ne casse rien ; c'est la collision de nom qui masque
  l'orphelin.
- **`CustomerListRow.tsx` est le fichier mort déjà identifié par l'audit
  `/impeccable` du 2026-08-27** — celui sur lequel un correctif avait été posé
  par erreur. **Il est toujours là, deux mois et demi plus tard.** C'est le
  meilleur argument de ce rapport pour le nettoyage : un fichier mort attire les
  correctifs.

### 2.2 Orphelins avec une référence résiduelle — à vérifier avant retrait

| Fichier | Lignes | Référence résiduelle | Risque |
|---|---|---|---|
| `apps/pos/src/features/cart/hooks/useVoidServerOrder.ts` | 54 | `vi.mock` dans un test, aucun importeur de production | **à vérifier** |
| `apps/pos/src/features/customers/components/CustomerAttachedBadge.tsx` | 36 | cité dans un *titre* de test | **à vérifier** |
| `apps/pos/src/features/heldOrders/components/HeldOrdersInboxButton.tsx` | 28 | importe `HeldOrdersModal`, n'est importé par personne | **à vérifier** |
| `apps/pos/src/features/customers/hooks/useCreateCustomer.ts` | 19 | `Pos.tsx:148-159` réimplémente `createCustomer` en inline | **à vérifier** |
| `apps/pos/src/features/products/components/ServiceSpeedIndicator.tsx` + `hooks/useServiceSpeed.ts` | **137** à eux deux | appelle `get_sales_by_hour_v5`, **jamais rendu** | **à vérifier** |
| `apps/pos/src/features/tablet/hooks/useTabletOffline.ts` | 118 | **3 commentaires affirment qu'il est vivant**, dont `features/lan/hooks/useCloudPing.ts:9` | **à vérifier** |
| `apps/backoffice/src/features/inventory/hooks/useStockLots.ts` | 68 | cité en commentaire dans `packages/domain/src/inventory/expiry/fifo.ts:19` | **à vérifier** — voir §2.4 |
| `apps/backoffice/src/features/products/hooks/useSetProductTestFlag.ts` | 32 | aucune | **à vérifier** — porte une RPC |
| `apps/backoffice/src/features/products/hooks/useUpdateVariant.ts` | 36 | aucune | **dangereux** — voir §2.4 |
| `apps/backoffice/src/features/inventory-production/components/ProductionRecordList.tsx` | 75 | **orphelin DOCUMENTÉ et assumé** | **dangereux** |
| `apps/pos/src/lib/kioskAuth.ts` (export `clearKioskPairing`) | — | aucun appelant | **à vérifier** — aucun chemin POS ne dés-appaire un écran kiosk |

Deux détails qui comptent.

**Le mock mort de `useVoidServerOrder`** :

```
apps/pos/src/features/cart/__tests__/rehold-fired-order.smoke.test.tsx:48
  vi.mock('@/features/cart/hooks/useVoidServerOrder', () => ({
```

Un `vi.mock` d'un module qu'aucun sujet de test n'importe ne mocke rien : le test
passe sans exercer le chemin. **Le mock est aussi mort que le hook.**

**`ProductionRecordList.tsx` est un orphelin volontaire** — ne pas le supprimer
sans arbitrage :

```
apps/backoffice/src/features/inventory-production/components/RevertProductionAction.tsx:35-37
// Ce composant est monté par `ProductionTodayPanel` (l'écran atteignable) ET par
// `ProductionRecordList` (l'orphelin), pour que l'affordance n'existe qu'en un
// exemplaire le jour où le second retrouve un appelant.
```

### 2.3 Le bloc `features/inbox` du POS — 4 fichiers sur 7 inaccessibles

| Fichier | État |
|---|---|
| `components/TabletInboxButton.tsx` | inaccessible |
| `components/TabletInboxModal.tsx` | inaccessible |
| `hooks/usePendingTabletOrders.ts` | inaccessible |
| `hooks/usePickupTabletOrder.ts` | inaccessible — appelle `pickup_tablet_order` |
| `hooks/usePickedUpOrderSync.ts` | **vivant** (`Pos.tsx:67`) |
| `hooks/useCloseCancelledTabletOrder.ts` | **vivant** (`HeldOrdersModal.tsx:36`) |
| `fetchOrderSnapshot.ts` | **vivant** |

C'est une **implémentation parallèle du pickup tablette, supersédée** : le
parcours réel passe par `features/cart/HeldOrdersModal.tsx:33` →
`heldOrders/hooks/useReopenHeldOrder.ts:32`. **Deux tests valident ce code
mort.**

### 2.4 Trois « morts » qui sont en fait des trous de parcours

Ce n'est pas du déchet à balayer. C'est de la fonctionnalité écrite et non
atteignable.

1. **`useUpdateVariant.ts` enveloppe `update_variant_v2`, et rien ne l'appelle.**
   La création et la suppression de variante sont, elles, câblées
   (`AddVariantDialog.tsx` → `useCreateVariant`, `DeleteVariantDialog.tsx` →
   `useDeleteVariant`). **Le back-office peut créer et supprimer une variante,
   pas la modifier.**
2. **`useStockLots.ts` est le seul accès à `stock_lots` du back-office** :
   ```
   $ grep -rn "stock_lots" apps/backoffice/src --include='*.tsx' --include='*.ts' | grep -v __tests__
   apps/backoffice/src/features/inventory/hooks/useStockLots.ts:3,8,53
   ```
   **Toute la lecture de péremption (F1, session 13) est écrite et
   inatteignable.** La table existe en production avec 21 lignes.
3. **`useSetProductTestFlag.ts` enveloppe `set_product_is_test_v2`.** Le champ
   `is_test` est **lu** (`useProductDetail.ts:34,83`) mais jamais **écrit** depuis
   le back-office. À confronter à l'ADR-035 (« retrait interrupteur produit
   test ») : si l'interrupteur a été retiré par décision, le hook est du résidu à
   supprimer, pas un trou.

### 2.5 Faux positifs écartés — ne pas les signaler comme morts

39 candidats écartés. Les pièges les plus coûteux :

| Catégorie | Pourquoi ce n'est pas mort |
|---|---|
| **Les 24 fichiers de `scripts/**`** | points d'entrée CLI lancés **par glob** depuis les workflows : `ci.yml:113,116,135,143,150,158,175,204,214,222,229,240,250`, `vitest-live.yml:68`, `playwright-e2e.yml:81`, `package-shop-release.yml:47,54,106`, `package.json:16-18`. Invisibles d'une analyse d'import. **Les 10 gardes CI sont toutes vivantes.** |
| `apps/print-bridge/src/security/block-device.ts` | **entrée de build déclarée** : `tsup.config.ts:5` |
| `apps/backoffice/src/vite-env.d.ts`, `packages/ui/src/assets.d.ts` | déclarations ambiantes, jamais importées par construction |
| `supabase/functions/_shared/session-policy.ts` | **vivant** : `session-auth.ts:4` l'importe |
| `supabase/functions/customer-birthday-notify/` | EF **déclenchée par cron DB** (`20260517000220_extend_customers_birthday.sql`). **Dangereux** à retirer — et, fait relevé dans le rapport 01, elle n'est **pas déployée en production** |
| `apps/pos/src/lib/secureContextPolyfill.ts` | importé en **side-effect pur** à `main.tsx:2`, sans `from` |

---

## 3. Doublons de composants et de hooks

**Méthode.** Index de toutes les définitions `export (default)? (async)?
(function|const|class) <Nom>` du code vivant hors tests, puis comptage des
importeurs de chaque chemin. 60 collisions de nom brutes ; la grande majorité est
**légitime** — POS et back-office sont deux applications étanches par conception
(`App`, `LoginPage`, `useAuthStore`, `useProducts`, `useRefundOrder`… existent
de part et d'autre, et `eslint.config.mjs` interdit les imports croisés).

### 3.1 `useLanDevices` ×3, dont un dossier mort — **sûr**

```
apps/pos/src/features/shift/hooks/useLanDevices.ts:16            POS, légitime
apps/backoffice/src/features/devices/hooks/useLanDevices.ts:15   ← MORT
apps/backoffice/src/features/lan-devices/hooks/useLanDevices.ts:27  ← VIVANT
```

Le vivant est importé par `pages/lan-devices/LanDevicesPage.tsx:19`. Le mort vit
dans un dossier `features/devices/` qui **ne contient que ce fichier**, et aucun
code de production ne le cite. Sa seule trace est un mock mort :

```
apps/backoffice/src/pages/orders/__tests__/OrdersListPage.smoke.test.tsx:41
  vi.mock('@/features/devices/hooks/useLanDevices.js', () => ({
$ grep -n "useLanDevices\|LanDevice" apps/backoffice/src/pages/orders/OrdersListPage.tsx
(aucune sortie)
```

Les deux hooks ont **des clés de cache différentes** (`['lan_devices', …]` vs
`LAN_DEVICES_KEY`), donc une invalidation sur l'un ne touche pas l'autre — c'est
la classe de bug que ce doublon prépare.

**Geste : supprimer `features/devices/` en entier, et le `vi.mock` orphelin dans
le même commit.**

### 3.2 `HeldOrdersModal` ×2, celle de `packages/ui` morte — **à vérifier**

```
packages/ui/src/components/HeldOrdersModal.tsx    185 lignes   ← exportée, jamais importée
apps/pos/src/features/cart/HeldOrdersModal.tsx    383 lignes   ← la vraie
```

Elle est exportée par le barrel (`packages/ui/src/index.ts:128,132`), et pourtant
**chaque** usage applicatif pointe vers la version POS locale
(`BottomActionBar.tsx:42`, `Pos.tsx:40`, `HeldOrdersInboxButton.tsx:3`). Aucun
`import { HeldOrdersModal } from '@breakery/ui'` dans le dépôt.

**Pourquoi « à vérifier » et non « sûr » :** il existe une preview versionnée
`.design-sync/previews/HeldOrdersModal.tsx`. La supprimer casse le catalogue du
design system (§4.3).

### 3.3 `VoidOrderModal` ×3 — les trois vivants, mais deux dans la même app

```
apps/pos/src/features/cart/VoidOrderModal.tsx:24                     ← BottomActionBar.tsx:43
apps/pos/src/features/order-history/components/VoidOrderModal.tsx:20 ← OrderHistoryPanel.tsx:21
apps/backoffice/src/features/orders/components/VoidOrderModal.tsx:67
```

Pas du code mort : deux composants homonymes dans le POS, chacun avec son
appelant. **Mais c'est un nommage qui invite au correctif posé sur le mauvais
fichier** — exactement le motif qui a produit le bug `CustomerListRow` du
2026-08-27. **Risque : dangereux** de fusionner sans lire les deux. À signaler,
pas à nettoyer.

### 3.4 Deux moteurs de promotion, un seul appelé — **à vérifier**

```
packages/domain/src/promotions/evaluator.ts:135   evaluatePromotions          165 lignes
packages/domain/src/promotions/bogoEngine.ts:350  evaluatePromotionsFallback  375 lignes
```

Les deux sont exportés par `packages/domain/src/promotions/index.ts:19,27`. Le
POS n'appelle **que** le fallback
(`features/promotions/hooks/useEvaluatePromotions.ts:238`), et
`evaluatePromotions` n'a **aucun consommateur de production** dans tout le
dépôt :

```
$ grep -rn "\bevaluatePromotions\b" --include='*.ts' --include='*.tsx' \
    apps packages/supabase supabase/functions | grep -v __tests__ | grep -v "\.test\."
(aucune sortie)
```

Les deux partagent `matchAllConditions` (`evaluator.ts:7`, `bogoEngine.ts:22`),
donc `matchers.ts` reste vivant. **Risque : à vérifier** — c'est le money-path
promo, 5 fichiers de test s'appuient sur `evaluatePromotions`, et deux moteurs
divergents qui prétendent évaluer les mêmes promos sont un risque de fond, pas
seulement du poids mort. Voir aussi le repli silencieux décrit dans le rapport 01
§7.3.

### 3.5 `useUnpaidOrderSnapshot` — divergence de structure

```
apps/pos/src/features/cart/hooks/useUnpaidOrderSnapshot.ts:14
apps/backoffice/src/features/orders/hooks/useCancelUnpaidOrder.ts:21   ← même nom, autre fichier
```

Le back-office définit `useUnpaidOrderSnapshot` **et** `useCancelUnpaidOrder`
(ligne 44) dans un seul fichier, là où le POS les sépare. Divergence de
structure, pas du code mort. **À vérifier.**

### 3.6 Faux doublons à ne pas toucher

`apps/backoffice/src/components/BackofficeUi.tsx` définit `Button`,
`EmptyState`, `KpiTile`, `DataTable` qui portent les mêmes noms que les
primitives `@breakery/ui`. C'est un **adaptateur de thème documenté** qui les
réenveloppe (`import { Button as UiButton, … } from '@breakery/ui'`, en-tête
« Adaptations de présentation Instrument »), importé par **237 fichiers**. Idem
`components/FormField.tsx` (3 importeurs) et `components/SectionLabel.tsx` (36
importeurs).

**Ne rien toucher.**

---

## 4. Code mort interne aux paquets partagés

**Méthode.** 514 exports de `packages/{ui,domain,utils}/src` hors tests, chacun
recherché comme identifiant entier dans les 2 329 fichiers du code vivant, en
distinguant fichier de production / fichier de test / barrel.

**Résultat : 176 exports sans consommateur de production ; 55 une fois restreint
aux exports de VALEUR.** Les 121 restants sont des `type`/`interface` de props,
consommés structurellement — pas du code mort.

### 4.1 Les 3 plus nets : zéro consommateur, même pas un test

| Export | Emplacement | Risque |
|---|---|---|
| `computePromotion` | `packages/domain/src/promotions/bogoEngine.ts:268` | **à vérifier** — money-path |
| `isLastTenderCashOverpayAllowed` | `packages/domain/src/payment/splitTender.ts:23` | **à vérifier** — money-path |
| `FullScreenModalClose` | `packages/ui/src/components/FullScreenModal.tsx:94` | **sûr** |

Les deux premiers sont exportés par le barrel, testés par personne, appelés par
personne, et touchent au prix et au rendu de monnaie. **À signaler comme angle
mort de couverture**, pas à supprimer d'un revers de main.

### 4.2 Composants `packages/ui` qu'aucune application n'importe

Recoupement indépendant sur les imports réels depuis `'@breakery/ui'` :

| Fichier | Lignes | Export |
|---|---|---|
| `packages/ui/src/components/CustomerSearchModal.tsx` | 228 | `CustomerSearchModal` |
| `packages/ui/src/components/Stat.tsx` | 59 | `Stat` |
| `packages/ui/src/components/OrderTypeTabs.tsx` | 51 | `OrderTypeTabs` |

Et sur le barrel (38 exports de valeur), 10 jamais importés par un fichier de
production : `buttonVariants`, `ScrollArea`, `ScrollBar`, `Separator`,
`badgeVariants`, `Stat`, `QwertyLayout`, `OrderTypeTabs`, `useVirtualKeypad`,
`IDLE_WARNING_LEAD_MS`.

Les 32 autres composants `ui` ont tous ≥ 1 référence de production (`Currency`
175, `FullScreenModal` 66, `NumpadPin` 31, `Numpad` 30…).

> **Deux réserves, et elles sont décisives.**
>
> `buttonVariants` / `badgeVariants` sont des exports `cva` conventionnels —
> l'API publique d'un design system. **Ne pas supprimer.**
>
> `QwertyLayout` + `useVirtualKeypad` + `NumpadVirtual` forment le clavier
> virtuel POS corrigé par la PR #485. `NumpadVirtual` a 4 références,
> `useVirtualKeypad` en a 0 : **vérifier le câblage réel avant de conclure**.

### 4.3 Avertissement — ces composants ont des previews versionnées

```
$ git ls-files .design-sync | wc -l
60
$ grep -rln "HeldOrdersModal\|CustomerSearchModal\|OrderTypeTabs\|QwertyLayout\|Stat\b" .design-sync
.design-sync/previews/CustomerSearchModal.tsx
.design-sync/previews/HeldOrdersModal.tsx
.design-sync/previews/OrderTypeTabs.tsx
.design-sync/previews/QwertyLayout.tsx
.design-sync/previews/Stat.tsx
```

`.design-sync/` est **suivi par git et non ignoré** (60 fichiers, versionnés par
la PR #412). Retirer ces composants casse 5 previews du catalogue du design
system. **Jamais « sûr » : toujours « à vérifier ».**

### 4.4 Les 30 exports de `packages/domain` testés mais jamais atteints

Preuve générale pour chacun :
`grep -rn "\b<nom>\b" --include='*.ts' --include='*.tsx' apps packages/supabase supabase/functions | grep -v __tests__`
→ **aucune sortie**.

`calculateRecipeCost` · `UnknownUnitConversionError` · `computeRefundLineAmount`
· `computeRefundTotal` · `computeRefundTax` · `validatePayment` · `MAX_TENDERS` ·
`sumByHour` · `sumByCategory` · `sumByStaff` · `computeStockVariance` ·
`computeNewStock` · `computeStockDelta` · `selectLotForConsumption` ·
`filterExpiringLots` · `calculateLandedCostAllocation` · `lowStockFilter` ·
`activeHeldQuantity` / `availableQuantity` / `canHoldQuantity` ·
`movementRefPrefix` / `buildMovementRefNo` · `canTransition` / `nextStatus` ·
`calculateLineTotal` · `decideChannels` · `toHeldOrder` / `fromHeldOrder` ·
`isComboProduct` · `isValidDenominationGrid` · `isNewBogoShape` /
`evaluateThreshold` / `evaluateBundle` · `matchDateRange` / `matchDayOfWeek` /
`matchHour` / `matchMinTotal` / `matchCustomerTier` · `matchCustomerCategory` ·
`RedemptionExceedsTotalError` / `DiscountExceedsTotalError` · `MAPPING_KEYS` /
`isMappingKey` / `REFERENCE_TYPES_CANONICAL` / `isCanonicalReferenceType` /
`FISCAL_PERIOD_STATUSES` / `isFiscalPeriodEditable` · `setBreadcrumbHook`

**Risque : dangereux à supprimer en bloc, à vérifier un par un.** `AGENTS.md` est
explicite : la logique money-path vit **côté serveur**. Beaucoup de ces fonctions
sont le **miroir TypeScript délibéré** d'une RPC — le code le dit lui-même
(`useEvaluatePromotions.ts:11` : « The RPC mirrors
`packages/domain/src/promotions/bogoEngine.ts` »). Les retirer, c'est perdre le
harnais hors-ligne et de repli.

**Le constat utile n'est pas « c'est mort » mais « ces 30 fonctions sont testées
et jamais atteintes depuis une surface ».** C'est un arbitrage de périmètre, pas
un nettoyage.

Les plus nets et les plus sûrs du lot : les 6 constantes et gardes de
`packages/domain/src/accounting/types.ts` et `setBreadcrumbHook`
(`packages/utils/src/logger.ts:24`).

---

## 5. Qualité de typage et validation aux frontières

### 5.1 **P0 — `supabase/functions` échappe à toute analyse statique**

Trois faits vérifiés indépendamment :

1. **Le lint bloquant ne la voit pas.** `ci.yml:263-270` exige le glob
   `**/src/**/*.ts` ; `supabase/functions/process-payment/index.ts` n'est pas
   sous un `src/`. `scripts/**/*.mjs` non plus.
2. **Le lint consultatif ne la voit pas non plus.** `pnpm lint` =
   `turbo run lint`, limité aux membres du workspace. `pnpm-workspace.yaml`
   déclare `apps/*`, `packages/*`, `supabase/tests` — **pas
   `supabase/functions`**. Et `supabase/tests/package.json` n'a qu'un script
   `test`, ni `lint` ni `typecheck`.
3. **Aucun typecheck.** `grep -rni "deno" .github/workflows/` → **zéro
   résultat**. Il n'existe aucun `deno check`, `deno lint` ni `tsc` sur les 19
   Edge Functions.

**Conséquence.** Les ~3 000 lignes de Deno qui portent `process-payment`,
`refund-order`, `void-order`, `cancel-item`, `cancel-unpaid-order`,
`verify-manager-pin` et `auth-verify-pin` — **tout l'encaissement et toute
l'authentification** — n'ont aucune analyse statique en intégration continue. Un
renommage de champ, un `await` oublié, un argument RPC manquant ne seraient vus
qu'au déploiement, sur de l'argent réel.

C'est aussi l'explication mécanique du comptage des `any` : **14 des 24 `any` de
production du dépôt sont là**, le seul endroit où `no-explicit-any: 'error'` ne
s'applique jamais.

**Geste suggéré** : un job `deno check supabase/functions/**/index.ts` +
`deno lint` dans `ci.yml`. Quelques lignes, pour le rendement des gardes 3, 4 et
10 — le dépôt a déjà la démonstration chiffrée que c'est l'outillage, pas le
savoir-faire, qui tient un invariant.

### 5.2 Comptage des `any`

Commande exacte, avec retrait des lignes de commentaire (sans ce retrait, le
relevé brut surestime de 37 %, le mot anglais « any » apparaissant dans des
commentaires) :

```bash
PAT=': any|as any|<any>|any\[\]|Record<string, *any>|Array<any>|Promise<any>'
git ls-files <zone> | grep -E '\.(ts|tsx|mjs)$' \
  | tr '\n' '\0' | xargs -0 grep -hnE "$PAT" \
  | grep -vE '^\s*[0-9]+:\s*(//|\*|/\*)' | wc -l
```

| Zone | hors commentaires | dont tests | **en production** |
|---|---|---|---|
| `apps/pos/src` | 1 | 0 | **1** |
| `apps/backoffice/src` | 12 | 5 | **7** |
| `apps/print-bridge/src` | 0 | 0 | **0** |
| `packages/domain/src` | 0 | 0 | **0** |
| `packages/supabase/src` | 0 | 0 | **0** |
| `packages/ui/src` | 2 | 0 | **2** |
| `packages/utils/src` | 0 | 0 | **0** |
| `supabase/functions` | 14 | 0 | **14** |
| `scripts` | 0 | 0 | **0** |
| **Total** | **29** | **5** | **24** |

Autres marqueurs : `@ts-ignore` → **0**. `@ts-expect-error` → **1**, hors
production. `@ts-nocheck` → **0**. C'est remarquable.

### 5.3 Les 4 `any` sur un chemin sensible

1. **`features/btob/hooks/useCreateB2bOrder.ts:131`** — création de commande B2B
   à crédit :
   ```ts
   const { data, error } = await supabase.rpc('create_b2b_order_v10', rpcArgs as any);
   ```
   `rpcArgs` est pourtant typé localement (lignes 116-122, avec
   `p_idempotency_key: string`). Le `as any` contourne le type généré et annule
   la vérification que la clé d'idempotence est bien transmise. L'idempotence
   existe (ligne 125) mais **n'est plus garantie par le compilateur**.
2. **`features/inventory-opname/hooks/useOpnameMutations.ts:151`** —
   `FinalizeOpnameResult.movements: any[]` est la liste des mouvements de stock
   que la finalisation d'inventaire vient d'émettre. Voir §5.5.
3. **`features/inventory/hooks/useStockLots.ts:53`** et
   **`apps/pos/src/features/products/hooks/useActiveLotsByProduct.ts:31`** —
   `.from('stock_lots' as any)`, avec le commentaire « types regenerate after
   migration apply ».
   **Vérification faite : ce commentaire est périmé.** `stock_lots` **est**
   présent dans `packages/supabase/src/types.generated.ts:7015`, avec ses clés
   étrangères. Les deux `as any` sont donc du **poids mort qui masque un typage
   réel** — c'est le correctif le moins cher de tout ce rapport.
4. **`supabase/functions/notification-dispatch/index.ts:77`** —
   `constructor(private admin: any)` : le client `service_role` est typé `any`
   dans `HtmlRenderer`. Faible impact (lecture de branding), mais c'est le seul
   endroit où un client service-role circule non typé.

Les 10 autres `any` de `supabase/functions` sont des `page: any` dans
`_shared/pdf-templates/*` (handle `pdf-lib`) : **bénins**.

### 5.4 Le typage s'arrête à la frontière RPC — 248 `as unknown as`

| Zone | hors tests | avec tests |
|---|---|---|
| `apps/pos/src` | 84 | 98 |
| `apps/backoffice/src` | **161** | 186 |
| `packages/*` | 0 | 2 |
| `supabase/functions` | **0** | 0 |
| `scripts` | **0** | 0 |
| **Total** | **248** | **290** |

Répartition par direction côté back-office : ~29 casts d'**argument**
(`p_xxx: payload as unknown as Json`, bénins), ~103 casts de **réponse** (la
classe à risque : `supabase.rpc` est typé `Json`, le cast ne vérifie rien), et 10
`supabase.rpc.bind(supabase) as unknown as RpcFn` pour les RPC absentes des types
générés — ce dernier pattern est **protégé par un test de régression**
(`apps/backoffice/src/__tests__/no-unbound-supabase-rpc.test.ts:19`).

**Le cast en sortie de `supabase.rpc` est inévitable. Le défaut est l'absence de
garde au point de consommation, et il est inégalement réparti.**

**Ce qui est blindé** (à citer comme modèle, pas comme défaut) :

| Site | Ce qui est vérifié |
|---|---|
| `apps/pos/src/features/payment/hooks/useCheckout.ts:230-250` | `order_number` présent, `Number.isFinite(total)`, `Number.isFinite(tax_amount)`, et pour le paiement partiel l'**invariant comptable** `\|amount_paid + remaining_due − total\| ≤ 0,001`, `outstanding_due === remaining_due`, `amount_paid ≥ amount_received`. Un écart jette `network_error`. |
| `useCheckout.ts:338-351` | snapshot revérifié ligne par ligne (`order_id`, `quantity` finie > 0, `unit_price` finie, `modifiers` tableau) |
| `apps/pos/.../useRefundOrder.ts:75-85` et `apps/backoffice/.../useRefundOrder.ts:116-126` | validation exhaustive de la réponse de remboursement, cas « points seuls » inclus, avec `FinancialAttemptError` et classification définitif / transitoire |
| `apps/pos/src/features/shift/hooks/useCashMovement.ts:55-59` | `movement_id` non vide, `session_id` concordant, totaux finis |
| `features/accounting/bank-reconciliation/api.ts:43-51` | toute mutation passe par un `validate` obligatoire + garde de session |
| `features/inventory/components/StockDeclarationsPanel.tsx:33` | `if (!Array.isArray(data)) throw` — **la meilleure pratique du dépôt** |
| `features/orders/hooks/useOrdersCounters.ts:73-83` | cast vers une forme **nullable à champs optionnels**, puis `parseCell` sur chaque cellule |

**Les 15 sites les plus risqués — cast de réponse non validé sur un parcours
argent, stock ou droits :**

| # | `fichier:ligne` | RPC / EF | Pourquoi |
|---|---|---|---|
| 1 | `features/orders/hooks/useOrdersList.ts:110` + `:114` | `get_orders_list_v7` | **Le pire du lot.** Cast non nullable, puis `getNextPageParam` déréférence `lastPage.next_cursor_val` et `next_cursor_id` sans garde. Un `NULL` SQL lève un `TypeError` **hors** du `queryFn` : l'erreur ne passe pas par `error`, elle remonte à `RouteErrorBoundary`. Le modèle de correction est dans le même module (`useOrdersCounters.ts:73-83`). |
| 2 | `features/inventory-opname/hooks/useOpnameMutations.ts:166` | `finalize_opname_v6` | voir §5.5 |
| 3 | `features/expenses/hooks/useExpenseActions.ts:76` | `approve_expense_v5` | résultat d'**approbation de dépense** sans vérification du statut renvoyé |
| 4 | `features/expenses/hooks/useExpenseActions.ts:120` | `pay_expense_v4` | **sortie de trésorerie** ; `ApproveDialog.tsx:67` et `PayDialog.tsx` ne lisent rien du retour |
| 5 | `features/customers/hooks/useGrantStoreCredit.ts:78` | `grant_store_credit_v1` | octroi de **crédit magasin** (argent client) |
| 6 | `features/btob/hooks/useAdjustB2bBalance.ts:46` | `adjust_b2b_balance_v3` | **ajustement manuel d'encours client** |
| 7 | `features/purchasing/hooks/useRecordPoPayment.ts:92` | `record_po_payment_v2` | **paiement fournisseur** |
| 8 | `features/inventory/hooks/useRecordIncomingStock.ts:84` | `record_incoming_stock_v6` | **réception de stock** — impacte le coût moyen pondéré |
| 9 | `features/inventory-production/hooks/useRecordBatchProduction.ts:192` | `record_batch_production_v14` | production par lot (déduction de stock) |
| 10 | `features/inventory-production/hooks/useRecordProduction.ts:189` | `record_production_v12` | idem, unitaire |
| 11 | `features/accounting/hooks/useCreateManualJournalEntry.ts:30` | `create_manual_je_v2` | `p_lines: lines as unknown as Json` — **écriture comptable manuelle, lignes non vérifiées à l'envoi** |
| 12 | `apps/pos/src/features/promotions/hooks/useEvaluatePromotions.ts:219` | `evaluate_promotions_v3` | **montants de remise** |
| 13 | `features/accounting/hooks/useCloseFiscalYear.ts:70` | `close_fiscal_year_v3` | **clôture d'exercice** |
| 14 | `features/cash-register/hooks/useSignZReport.ts:36` | `sign_zreport_v3` | le type déclare `status: 'signed'` ; une réponse malformée affiche « signé » à tort sur un **document légal** conservé 7 ans |
| 15 | `features/kitchen/api.ts:52` | `get_user_kitchen_access_v1` | cast vers `KitchenAccess` **non nullable** ; `KitchenAccessPanel.tsx:19` fait ensuite `access.sections.filter(…)` → une dérive de forme lève dans le rendu |

Mentions de même classe, hors argent, atténuées en aval par de l'optional
chaining : `features/dashboard/hooks/useDashboardOverview.ts:124`,
`useDashboardPanels.ts:104`/`:160`, `features/accounting/hooks/useTrialBalance.ts:47`,
`useGeneralLedger.ts:87`.

**Le point structurel.** Les outils de validation **existent déjà** :
`apps/backoffice/src/features/reports/utils/parse.ts` fournit `toNum`, `toStr`,
`asRecord`, `asArray`, et son en-tête (lignes 4-7) nomme exactement ce risque.
Ils ne sont importés que par **12 fichiers sur les 788 du back-office**. Et il n'y
a **aucun `zod`** dans le back-office.

### 5.5 **P1 — `finalize_opname_v6` : la seule enveloppe de stock non validée**

`features/inventory-opname/hooks/useOpnameMutations.ts:151` type
`movements: any[]`, et `:166` fait `return data as FinalizeOpnameResult;`
**sans une seule vérification** : ni `count_id` concordant, ni `status`, ni
`Number.isFinite(movements_emitted)`, ni `idempotent_replay` booléen.

C'est l'opération qui solde un inventaire physique et redresse la valeur du
stock. Une réponse tronquée ou un rejeu silencieux affiche « finalisé » avec un
nombre de mouvements faux.

Tout le reste du dépôt valide ces enveloppes. **C'est le trou le plus net de
cette section.**

### 5.6 Assertions non-null sur données serveur

Relevé brut : 180 occurrences. Après tri manuel, la **majorité** sont des faux
positifs : syntaxe d'embed PostgREST
(`user_profiles!orders_served_by_fkey(full_name)`, ~25 sites), littéraux de
chaîne, et accès indexés rendus nécessaires par `noUncheckedIndexedAccess`
(`workbook.Sheets[name]!`) — **la conséquence attendue d'un réglage strict, pas
un défaut**.

Les sites réellement contestables :

- **`features/accounting/bank-reconciliation/api.ts:62,63,71`** — trois `null!`
  pour forcer `null` dans un argument que le type généré déclare non-nullable.
  **Tranché contre la base live** : `bank_reconciliation_balances_v2` prend bien
  `p_opening_balance numeric, p_closing_balance numeric` et **n'est pas `STRICT`**
  (`proisstrict = false`), donc elle accepte `NULL`. Les `null!` contournent une
  **inexactitude du type généré**, pas un contrat serveur. Ce n'est **pas** une
  vérification de sûreté désactivée — conclusion inverse de ce qu'un relevé
  purement statique suggérait.
- `pages/expenses/ExpenseDetailPage.tsx:144-151` — 8 `expense!` consécutifs dans
  la graine de duplication d'une dépense ; `expense` vient d'une query.
- `pages/purchasing/PurchaseOrderDetailPage.tsx:242,255` — `po!.id` passé à
  `cancel.mutateAsync` : **une annulation de bon de commande dont la cible dépend
  d'une assertion**.

---

## 6. Gestion des erreurs

### 6.1 Les trois filets en place

1. **`MutationCache.onError` global** — `apps/backoffice/src/lib/queryClient.ts:20-26` :
   toute mutation sans `onError` propre et sans `meta.errorHandled` toaste.
   Portée volontairement étroite, sortie nommée documentée. **C'est ce filet qui
   rend légitimes la plupart des `catch {}` du back-office.**
2. **`RouteErrorBoundary`** — câblé à `layouts/BackofficeLayout.tsx:91-95`,
   autour du `<Outlet>` et de son `<Suspense>`. `AppErrorBoundary` couvre
   l'extérieur (`App.tsx:105`).
3. **Composants partagés** — `components/QueryErrorBanner.tsx` utilisé dans **26
   fichiers de production** ; `features/reports/components/ReportShell.tsx:42`
   pour les 42 rapports, avec bannière `role="alert"` unifiée et traduction des
   codes serveur (`business_day_not_closed`, `stock_visibility_owner_required`,
   `42501`) ; `components/ErrorState.tsx` pour le boot.

### 6.2 Aucun `catch` muet par négligence

**POS** : les 75 `catch` ont été inspectés. 16 sont vides ou commentaire-seul, et
**les 16 portent une justification écrite en ligne** (`offlineOutboxWake.ts:14,24`,
`OfflineSaleContext.tsx:121,167`, `offlineSaleSnapshot.ts:74`,
`shiftClosePrinting.ts:62`, `useCreateTabletOrder.ts:119,164`, `Login.tsx:90,102`,
`printJobs.ts:97`, `receiptJobs.ts:35`, `paymentStore.ts:90,100`,
`kds/offlineItemStatus.ts:46`, `localOrderNumber.ts:21`).

**Back-office** : 27 occurrences détectées (catch vide / log-only / `return` nu),
**0 strictement vide sans commentaire**. Les 9 sans commentaire explicite ont été
vérifiées une à une et sont toutes justifiées — par exemple
`features/settings/expense-thresholds/ExpenseThresholdsPage.tsx:49` est couvert
par `deleteMut.error` rendu à `:94-96`, et
`features/products/components/VariantsPanel.tsx:97` est couvert par le toast
global parce que `useReorderVariants.ts` n'a pas d'`onError`.

**C'est inhabituellement propre.** Le risque n'est pas dans les `catch` vides,
mais dans **ce qui est avalé en sachant ce qu'on avale** et dans les **retours
ignorés**.

### 6.3 POS — les 8 cas les plus dangereux pour l'argent

Classés par sévérité. Le détail du n°1 et du n°2 est dans le rapport 01 §7.1.

| # | Site | Défaut |
|---|---|---|
| 1 | `features/lan/hooks/useOfflineReplay.ts:48-70` | **`res.quarantined` jamais lu.** Un règlement déjà encaissé peut être classé définitivement non-remontable sans aucune alerte en caisse. Viole ADR-018 décision 5. **Le trou le plus grave trouvé : de l'argent perçu qui sort du système en silence.** |
| 2 | `features/lan/offlineReplay.ts:175-186` | `p_session_id: intent.root_client_uuid` — un UUID de commande en identifiant de session. L'échec attendu (`23503`/`23514`) est classé **définitif**, donc quarantinable, donc invisible par le n°1. |
| 3 | `features/promotions/hooks/useEvaluatePromotions.ts:225-241` | repli TypeScript sur échec de la RPC de promotions : `console.warn` puis moteur local. **Aucun toast.** Une panne réseau transitoire suffit à basculer la caisse sur un moteur de prix non autoritaire sans que personne ne le sache. |
| 4 | `features/payment/hooks/useCheckout.ts:257`, `:311` | `clearManagerPin()` appelé **seulement en succès** (3 sites confirmés : import, succès pickup, succès online ; aucun sur le chemin d'échec). Le PIN manager reste dans le holder module après un paiement raté, jusqu'au prochain succès ou au rechargement. Exposition mémoire-seule (jamais persisté ni diffusé), mais la **fenêtre d'autorisation reste ouverte pour la vente suivante**. |
| 5 | `features/order-history/hooks/useVoidOrder.ts:66` | `return await res.json() as VoidResponse` — **zéro validation de l'enveloppe**, là où `useRefundOrder.ts:77-82` valide tout. Un `void-order` qui renvoie 200 avec un corps dégénéré fera afficher un reçu d'annulation vide. |
| 6 | `features/shift/hooks/useCloseShift.ts:152-159` | échec de génération du **PDF du Z-report** avalé en `console.warn`. Le caissier voit « Shift closed » sans indication. Le bloc juste au-dessus (`:137-145`) lève bien un `toast.warning` quand l'**impression** échoue — l'asymétrie est dans le même fichier. |
| 7 | `features/lan/OfflineSaleContext.tsx:89-101`, `:142-150` | `client.setQueryData(key, state.data, { updatedAt })` : une query qui vient d'échouer mais possède encore des données voit son statut repassé à succès. Le mécanisme ne **fabrique** pas de données (il exige `state.data !== undefined`), mais il **masque la fraîcheur** : la caisse peut vendre au prix d'un catalogue arbitrairement ancien. La validation de forme existe (`offlineSaleValidation.ts:72-90`) ; **aucune validation d'ÂGE**. |
| 8 | `features/audit/emitPosEvent.ts:82-86`, `:139-145` | journal d'audit POS en silence total : `logger.warn` et `return 0`, aucun compteur d'arriéré en UI (`features/audit/outbox.ts:125` `pendingCount` n'a aucun appelant). **Un terminal dont le journal d'audit ne part plus continue de vendre normalement.** |

Pour la contre-vérification : `features/kds/offlineKitchenReplay.ts:88-90` pose
bien une bannière utilisateur rendue à `pages/Kds.tsx:44` — **ce n'est pas un
catch silencieux**. Et `useCheckout.ts:361-378` (timeout 30 s, validation du
corps, `clearTimeout` en `finally`) est un chemin de paiement **robuste**.

### 6.4 Back-office — les 15 « faux vides »

Le vrai défaut du back-office est le hook de **lecture** dont on ne destructure
que `data` : un échec rend l'écran *vide* au lieu de *cassé*, et l'opérateur
conclut « il n'y a rien » là où il faudrait lire « on n'a pas pu savoir ».

| # | `fichier:ligne` | Conséquence |
|---|---|---|
| 1 | `features/expenses/components/ApprovalTimeline.tsx:16` | **chaîne d'approbation** de dépense : échec → frise vide, rendue comme le cas « approbation automatique ». Un approbateur peut croire qu'aucune étape ne reste. Aucune mention d'`error` **ni** de `isLoading` dans tout le fichier. |
| 2 | `features/btob/components/B2bInvoicesTab.tsx:115` | **factures B2B impayées** : échec → « rien à encaisser ». Zéro occurrence d'`error` dans le fichier. |
| 3 | `pages/customers/customer-detail/StoreCreditTab.tsx:30,33` | **historique de crédit magasin** : échec → « aucun historique ». Chargement traité, erreur non. |
| 4 | `pages/lan-devices/LanDevicesPage.tsx:23` | ni erreur ni chargement, alors que `features/lan-devices/components/LanDevicesTable.tsx:18` destructure `{ data, isLoading, error }`. **La page et sa table divergent sur le même hook.** |
| 5 | `features/inventory-alerts/components/AlertsBadge.tsx:16-17` | **badge d'alertes stock du chrome** : échec → « 0 alerte ». |
| 6 | `features/inventory-production/components/ProductionTodayPanel.tsx:77` | échec → « rien produit aujourd'hui » sur le **journal de production du jour**. |
| 7 | `pages/customers/CustomerDetailPage.tsx:92-93` | fiche client : aucune occurrence d'`error` dans le fichier. |
| 8 | `pages/customers/customer-detail/AnalyticsTab.tsx:24` | idem. |
| 9 | `pages/customers/customer-detail/LoyaltyTab.tsx:19` | **solde et historique de points** : échec → vide. |
| 10 | `features/accounting/pages/SettingsAccountingPage.tsx:28` | **périodes fiscales** (clôture) : aucune mention d'`error`. |
| 11 | `pages/users/NewUserPage.tsx:12` | création d'utilisateur : échec → sélecteur de rôle vide, formulaire insoumettable sans explication. |
| 12 | `features/inventory-movements/components/MovementsFilters.tsx:50` | autocomplétion produit : échec → « aucun résultat ». |
| 13 | `features/inventory-alerts/components/ProductionAlertsTab.tsx:90` | onglet d'alertes production sans surface d'erreur. |
| 14 | `features/products/components/ModifierCostBreakdown.tsx:37-38` | **coût des modificateurs** (déduction d'ingrédients) : échec → coûts à zéro. |
| 15 | `features/settings/components/ShowcaseCurator.tsx:40` | curation de la vitrine client : ni erreur ni chargement. |

Moins graves, même classe : `features/accounting-mappings/components/MappingEditDialog.tsx:1`,
`pages/categories/CategoriesPage.tsx:1`, `pages/inventory/ProductionPage.tsx:113`,
`pages/settings/SettingsHubPage.tsx:126`, `pages/settings/SettingsFloorPlanPage.tsx`,
`features/products/components/OptionIngredientPicker.tsx:28`,
`features/reports/components/AuditLogFilters.tsx:73`, `layouts/CommandPalette.tsx:1`,
et les **4 pages `pages/marketing/*`**, qui ne rendent aucune erreur alors
qu'elles figurent dans le hub des rapports et n'utilisent pas `ReportShell`.

> **Mise en garde de méthode.** Un premier passage avait signalé 63 fichiers
> « sans surface d'erreur ». La vérification manuelle a montré que l'écrasante
> majorité étaient des faux positifs : destructuration
> `const { data, isLoading, error }` non matchée par la regex, ou propagation
> `error={error}` vers un socle. Les 12 pages de rapport initialement signalées
> passent **toutes** `error={error}` à `ReportShell` — vérifié une à une. **Le
> back-office est défensif, nettement plus qu'un scan naïf ne le suggère.**

---

## 7. Performance

### 7.1 Requêtes N+1 — deux cas réels, tous deux assumés

Méthode : balayage des corps de `for`/`.map`/`.forEach` contenant un
`await supabase…`, puis **lecture manuelle** de chaque candidat (le relevé
mécanique produit ~50 faux positifs).

1. **`features/inventory-opname/opnameImport.ts:31-45` — P2, assumé.**
   1 à 2 allers-retours **par ligne d'inventaire**, séquentiels : sur un opname
   de 300 produits, 300 à 600 requêtes. Mais les deux lectures de référence sont
   **hors** de la boucle, le commentaire ligne 30 explique que les quantités sont
   absolues (rejeu sûr), l'erreur est attribuée à la bonne ligne (`${row.sku}: …`)
   et `onSaved()` alimente une progression. **C'est un choix de traçabilité, pas
   une négligence.** À améliorer seulement si la durée gêne en boutique.
2. **`features/historical-import/HistoricalReferencePanel.tsx:60-86` — P2 perf,
   P1 sécurité (§8.1).** Jusqu'à 3 requêtes par référence, puis la même structure
   pour les fournisseurs. Le re-lookup après création est volontaire. Panneau
   d'import ponctuel : impact faible.

**Ce qui est bien fait, à ne pas signaler comme défaut** :
`features/accounting/hooks/useEntityNames.ts:144-151` résout les noms par
**tranches avec `.in('id', slice)` dans un `Promise.all`** — exactement
l'anti-N+1. `opnameImport.ts:5-14` pagine explicitement par `range(start, start+499)`
avec le commentaire « le plafond PostgREST ne doit pas tronquer le modèle ».
**Aucun `useQuery` trouvé à l'intérieur d'un `.map()`** dans les deux apps.

### 7.2 Re-renders sur la caisse — la zone la mieux tenue du dépôt

- **Sélecteurs Zustand** : le balayage des sélecteurs retournant un objet, un
  tableau ou un `.filter()` renvoie **1 seul résultat**, et c'est un faux positif
  (`components/IdleTimeoutMount.tsx:23` retourne un **nombre**, identité stable).
  **Aucun sélecteur ne retourne d'objet littéral.** Les 46 consommations de
  `useCartStore` sont **toutes atomiques, un champ par appel** — par exemple
  `ActiveOrderPanel.tsx:76-87`, 12 appels séparés plutôt qu'un sélecteur-objet.
  La discipline est tenue à 100 %.
- Le repli d'identité stable est même traité explicitement :
  `features/products/ProductGrid.tsx:43` → `const EMPTY_ITEMS: never[] = [];`
  avec le commentaire « avoids selector re-render loops ».
- **`useEffect` sans tableau de dépendances** : script à équilibrage de
  parenthèses sur les deux apps → **0 occurrence réelle**.
- **Mémoïsation de la grille produits** : `ProductCard.tsx:217` est `memo`-isé,
  `ProductGrid.tsx:69` hisse `<ComboBadge />` dans un `useMemo` avec le motif
  expliqué, `qtyByProduct` et `filtered` sont mémoïsés, et `onSelect` est
  stabilisé à la source (`ProductTapHandler.tsx:108-111`).
- **Canaux realtime** : les 14 sites portent un nom unique par montage, soit par
  `crypto.randomUUID()` inline, soit par un `channelName` calculé. Le pattern
  critique d'`AGENTS.md` (StrictMode double-monte) est respecté partout.

**Le résidu, et c'est le correctif le plus rentable de cette section.** Aucun des
25 plus gros composants POS n'est `memo`-isé, sauf `KdsOrderCard.tsx`.
Le cas qui coûte : **`features/cart/CartLineRow.tsx` (330 lignes, non
mémoïsé)** est rendu une fois par ligne de panier depuis `ActiveOrderPanel`, qui
s'abonne à `s.cart` (`ActiveOrderPanel.tsx:78`). **Chaque modification de
quantité re-rend l'intégralité des lignes du ticket** : sur un panier de 20
lignes, 20 × 330 lignes de JSX par tap. `ProductCard` a reçu son `memo` ;
`CartLineRow` est le symétrique oublié.

Autre résidu : **18 `react-hooks/exhaustive-deps` désactivés**, dont 4 sur des
écrans d'argent (`SignZReportModal.tsx:99`, `VoidZReportModal.tsx:37`,
`RecordB2bPaymentModal.tsx:93`, `lib/useFinancialAttempt.ts:54`). La règle est à
`'warn'`, donc ces `disable` ne retirent même pas un blocage — **ils retirent un
signal**.

Pas de virtualisation de la grille produits ni des listes du back-office. Avec le
`memo` sur les tuiles, le coût est amorti ; **non classé comme défaut sans mesure
navigateur**.

### 7.3 Idempotence — couverture mesurée

Les Edge Functions du money-path sont complètes :

| EF | Clé | Preuve |
|---|---|---|
| `process-payment` | `body.idempotency_key` (UUID validé) | `index.ts:242`, pré-lecture de rejeu `:279-290`, relais `:333` |
| `refund-order` | header `x-idempotency-key` | `index.ts:72`, relais `:154` |
| `void-order` | header `x-idempotency-key` | `index.ts:83`, relais `:126` |
| `cancel-item` | header `x-idempotency-key` | `index.ts:87`, relais `:131` |
| `cancel-unpaid-order` | header **obligatoire** | `handler.ts:48-49`, relais `:60` |
| `generate-zreport-pdf` | header **obligatoire** | `index.ts:46` |

Côté client, les clés sont tenues dans des `useRef` et **rotées au succès** ou à
l'ouverture de modale. `useRecordB2bPayment.ts:135-139` va jusqu'à **relire la
ligne de paiement** et vérifier que `idempotency_key`, `customer_id` et `amount`
concordent.

**Écart à connaître** : `process-payment` est la **seule** EF d'argent à porter
l'idempotence en **corps** et non en header, ce qui est incohérent avec
`refund`/`void`/`cancel`. Sans conséquence fonctionnelle, mais c'est une
irrégularité de contrat.

**Point de vigilance sur React Query, côté POS** :
`apps/pos/src/lib/queryClient.ts:38-41` fixe `retry: failureCount < 1` **pour
toutes les mutations**. Seuls 9 fichiers surchargent `retry:`. Les mutations
d'argent qui héritent du retry sont protégées **par la discipline de l'appelant,
pas par le hook** :

| Site | Protection réelle |
|---|---|
| `features/order-history/hooks/useVoidOrder.ts:37` | pas de `retry: false`, mais `OrderHistoryPanel.tsx:321` passe toujours un `idempotencyKey` stable par ouverture de modale |
| `features/shift/hooks/useCloseShift.ts:94` | pas de `retry: false`, et `CloseShiftModal.tsx:149-171` **ne passe jamais de clé** — mais `close_shift_v13` est **idempotent par ÉTAT** (`FOR UPDATE` + `idempotent_replay: TRUE` si le statut n'est plus `open`). **Pas de double clôture. Ne pas « corriger » cette absence de clé.** |
| `features/stock/hooks/{useWasteDisplay,usePOSReceiveStock,useReturnToKitchen,useAdjustDisplay}.ts` | retry hérité, mais tous passent `p_idempotency_key` |
| `features/cart/hooks/useFireToStations.ts:324` | retry hérité, protégé par `p_client_uuid` |
| `useHoldFiredOrder.ts:15`, `useTransferOrderTable.ts:28`, `useAttachTabCustomer.ts:108` | retry hérité, **aucune clé d'idempotence dans les arguments**. Effet d'un double appel : **non vérifié** (corps live non lus) |

### 7.4 Accès stockage sans garde

Hors chemin critique, `try/catch` absent dans les 12 lignes de contexte :
`features/kitchen/drafts.ts:30,44` (BO) · `features/cart/hooks/counterFireRecovery.ts:54,58`
· `features/display/displaySource.ts:3,6` · `features/kds/offlineKitchenJournal.ts:25,42`
· `features/lan/lanCredential.ts:64` · `features/shift/hooks/cashMovementRecovery.ts:51,54`
· `features/shift/shiftClosePrinting.ts:11` · `features/stock/POSStockView.tsx:53`
· `packages/ui/src/components/OutstandingOrdersPanel.tsx:17,79`.

Deux méritent un regard :

- **`cashMovementRecovery.ts:51`** — persistance d'une tentative de **mouvement
  d'espèces**. Le fail-closed y serait probablement aussi souhaitable qu'en
  `paymentAttempt.ts`, mais il n'est pas documenté comme tel.
- **`features/shift/OpenShiftModal.tsx:330-331`** — `localStorage.setItem` /
  `removeItem` dans un `onChange` sans `try/catch` (le `getItem` ligne 91 est
  gardé par `typeof localStorage !== 'undefined'`, ce qui ne protège ni d'un
  quota plein ni d'un stockage désactivé). Une exception casse le gestionnaire de
  sélection du terminal **à l'ouverture de caisse**. Mineur, mais au pire moment.

---

## 8. Sécurité

### 8.1 Deux injections de filtre PostgREST

**(a) P1 — données de fichier interpolées sans sanitizer.**

```ts
// features/historical-import/HistoricalReferencePanel.tsx:51
const q = await supabase.from('suppliers')
  .select('id,code,name,is_active,deleted_at')
  .or(`code.eq.${ref.code},name.ilike.${ref.name}`);
```

`ref.code` et `ref.name` viennent d'un **fichier JSON téléversé par
l'utilisateur** (`<Input type="file" accept=".json">`, même composant). Aucune
sanitisation. Une virgule, une parenthèse ou un `*` dans `name` **restructure la
condition `or=`**.

L'impact est borné par la RLS et par la liste de colonnes — pas d'exfiltration
arbitraire. Mais le résultat de cette requête **pilote une garde de correction**
(lignes 52-54 : `if (q.data.length > 1 || q.data.some(…)) throw`) : un filtre
détourné peut faire échouer la détection d'ambiguïté, ou ne rien matcher et
**faire créer un fournisseur en doublon**. Les 4 autres fichiers du dépôt qui
construisent un `or=` ont un sanitizer ; celui-ci n'en a aucun.

**(b) P1 — deux recherches échappent `%_` mais pas `,()`.**

La défense correcte existe, définie **quatre fois à l'identique** :

```ts
const OR_FILTER_UNSAFE = /[,()*%_\\]/g;
function sanitizeSearchTerm(term: string): string {
  return term.replace(OR_FILTER_UNSAFE, '').slice(0, 64);
}
```

— `features/accounting/hooks/useJournalEntries.ts:93-95` ·
`features/customers/hooks/useCustomersList.ts:74-76` ·
`features/loyalty/hooks/useLoyaltyCustomersList.ts:71-73` ·
`layouts/usePaletteSearch.ts:41-43`.

**Deux fichiers utilisent une version affaiblie** qui n'échappe que les jokers
`LIKE` :

```ts
// features/expenses/hooks/useExpensesList.ts:54
const term = filters.search.trim().replace(/[%_]/g, '\\$&');
q = q.or(`description.ilike.%${term}%,vendor_name.ilike.%${term}%,remarks.ilike.%${term}%,expense_number.ilike.%${term}%`);

// features/suppliers/hooks/useSuppliersList.ts:36
const term = filters.search.trim().replace(/[%_]/g, '\\$&');
q = q.or(`name.ilike.%${term}%,code.ilike.%${term}%`);
```

Une virgule tapée dans la barre de recherche **ajoute une condition** au `or=`.
Les filtres `.is('deleted_at', null)` / `.eq('is_active', …)` restent en `AND`,
donc les lignes supprimées ne fuitent pas ; l'effet est un élargissement du jeu
de résultats, ou une erreur PostgREST brute à l'écran.

**La cause est structurelle et le dépôt la connaît** : `OR_FILTER_UNSAFE` est
**dupliqué 4 fois** au lieu de vivre dans `packages/utils`, et **aucune garde CI
ne surveille l'interpolation dans un `.or(`**. C'est exactement le motif que
décrit `AGENTS.md` (« une règle sans exécuteur est une règle enfreinte »), et
exactement ce qui a produit ces deux divergences. Une 11ᵉ garde sur
`\.(or|filter|ilike|like)\(\`[^\`]*\$\{` serait du même rendement que la n°10.

### 8.2 Argent en flottant sur le rapprochement bancaire — P1

`features/accounting/bank-reconciliation/money.ts` fait tout en `BigInt` de
centimes, avec validation regex (`:8`) et plafond (`:13`) — précisément pour ne
jamais toucher à un flottant. Puis `api.ts` le défait :

```ts
// api.ts:62-63
p_opening_balance: payload.opening === null ? null! : Number(payload.opening),
p_closing_balance: payload.closing === null ? null! : Number(payload.closing),
// api.ts:71
p_fee_amount: Number(payload.fee),
```

`Number('12345678901.99')` n'est pas exactement représentable ; la valeur qui
atteint le `numeric` Postgres peut porter un artefact binaire.

**Atténuation réelle** : le `validate` de `sendBankManage` (`:64`) **recompare la
valeur renvoyée à la chaîne d'origine**, donc une dérive échoue en « The response
could not confirm this operation ». **Le système ne perd pas d'argent, il refuse
l'opération.**

**Mais `p_fee_amount` (`:71`) n'a pas de recomparaison équivalente** dans le
`validate` de `sendBankPost` (`:73`, qui ne vérifie que des UUID). Le montant de
frais bancaires part en flottant sans confirmation de valeur.

> Rappel du rapport 01 : ce module n'a jamais tourné en production (0 ligne dans
> les 12 tables `bank_reconciliation_*`), et deux de ses RPC y sont absentes.

### 8.3 Secrets — rien d'exploitable

- `git ls-files .env` → **vide**. `.env`, `.env.local`, `.env.*.local` sont dans
  `.gitignore` (lignes 16-18). Seuls `.env.example`,
  `apps/pos/.env.example` et `apps/print-bridge/.env.example` sont suivis.
- Balayage de tous les fichiers suivis (hors binaires et `pnpm-lock.yaml`) sur
  `eyJ…`, `sb_secret_`, `sbp_…`, `sk-…`, `AIza…`, `ghp_…`, `re_…`,
  `postgres://user:pass@` :
  - `scripts/release/bundle-files.mjs:27` est un **détecteur** de clés privées ;
  - `scripts/release/manifest.test.mjs:78-80` et `supabase/tests/functions/*`
    portent des fixtures nommées `NOT_A_REAL_KEY`, `sb_secret_test-only` ;
  - `scripts/release/rehearsal-pgtap.test.mjs:11,13,86` utilise un mot de passe
    littéral `fixture`.
  **Aucun secret réel.**
- **`service_role` côté client : aucun usage.** Les 13 occurrences hors
  `supabase/functions` sont toutes légitimes, dont une excellente :
  `features/reports/utils/auditValues.ts:10` fait figurer `service_role_key` dans
  une **liste de clés à masquer** dans l'affichage des audit logs.
- Workflows : secrets tous référencés par `${{ secrets.X }}`. `ci.yml:22-26` fixe
  `VITE_SUPABASE_URL: http://stub-not-used.local` — la CI de build/test ne peut
  pas joindre une vraie base. `permissions: contents: read, actions: read` et
  `persist-credentials: false` sur les checkouts.

**Deux points à signaler, ni l'un ni l'autre n'étant une fuite :**

1. **`.env.example:3`** contient un **JWT `anon` complet et apparemment réel**
   pour le projet dev. Ce n'est **pas** un secret : la clé `anon` est embarquée
   dans tout bundle client par conception. Mais elle identifie publiquement le
   projet dev et ouvre le rôle `anon` à quiconque lit le dépôt ; toute la défense
   repose alors sur la RLS et les `REVOKE … FROM PUBLIC`. **P2, conforme à la
   doctrine du projet — à conserver tel quel, pas à « corriger » sans décision.**
2. **`README.md` publie les PIN de connexion du jeu de données de dev** (section
   « Seeded credentials » : `1234` pour l'Owner, `5678` pour le caissier de test),
   dans un fichier suivi par git. Ce sont des identifiants de dev ; ils ne doivent
   en aucun cas exister en production. **À vérifier côté production** — et à
   déplacer hors du dépôt si la vérification tourne mal. Je ne l'ai pas testé
   (aucun essai d'authentification en production).

### 8.4 En-têtes HTTP du back-office — P2

`vercel.json` porte des en-têtes de sécurité complets : HSTS 2 ans + `preload`,
`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`,
`Permissions-Policy` fermée, CSP avec `frame-ancestors 'none'` et
`object-src 'none'`.

**Réserve** : `script-src 'self' 'unsafe-inline' 'unsafe-eval'`. Sur une
application qui manipule de l'argent réel, ces deux directives annulent
l'essentiel de la protection XSS de la CSP.

À noter : le balayage `dangerouslySetInnerHTML` / `.innerHTML` / `eval(` /
`new Function(` sur **tout** `apps`, `packages` et `supabase/functions` renvoie
**zéro résultat**, donc la surface XSS réelle est très faible. `unsafe-eval` est
probablement un reliquat Vite dont la nécessité mériterait d'être retestée.

### 8.5 Edge Functions — tableau par fonction

`verify_jwt` lu dans `supabase/config.toml:369-430`.

| Fonction | CORS | Auth | Rate limit | Redaction | PIN en header | Constat |
|---|---|---|---|---|---|---|
| `auth-verify-pin` | oui | n/a (point d'entrée) | **oui**, durable | **oui, 20 sites** | n/a (PIN en body, format validé) | **la référence du dépôt** |
| `refund-order` | oui | oui | oui | oui ×3 | oui | modèle complet |
| `void-order` | oui | oui | oui | oui ×3 | oui | modèle complet |
| `cancel-item` | oui | oui | oui | oui ×3 | oui | modèle complet |
| `cancel-unpaid-order` | oui | oui | oui | partiel (code seul — bonne pratique) | oui | idempotence **obligatoire** |
| `process-payment` | oui | oui | oui, durable | oui ×5 | oui | **P2** : idempotence en **body**, seule EF d'argent dans ce cas |
| `verify-manager-pin` | oui | oui (17 sites) | oui + lockout | partiel | oui | OK |
| `auth-change-pin` | oui | oui | oui + lockout | partiel | oui | OK |
| `auth-session-activity` | oui | oui | oui | non | n/a | OK |
| `kiosk-issue-jwt` | oui | oui | oui | non | n/a | OK |
| `lan-device-access` | oui | oui | oui | non | n/a | OK |
| `download-expense-receipt` | oui | oui | oui | non | n/a | OK |
| `auth-get-session` | oui | oui | **non** | non | n/a | **P2** : pas de rate limit sur une lecture de session |
| `auth-logout` | oui | secret opaque `x-session-token` | **non** | oui | n/a | **P2** : non authentifié + une requête DB par appel, sans rate limit → vecteur de charge. Le modèle est justifié en commentaire (le secret n'autorise que sa propre révocation) |
| `lan-heartbeat-batch` | oui | secret partagé, comparé par `!==` | **non** | **non** | n/a | **P2 ×3** : pas de rate limit ; **fuite de `error.message` Postgres brut** (`:63`, `:84`) ; comparaison non timing-safe |
| `notification-dispatch` | oui | 2 voies (secret ou Bearer + permission) | **non** | **non** | n/a | **P2 ×3** : pas de rate limit ; `perm_check_error: ${permErr.message}` renvoyé en 401 ; **`verify_jwt = false` absent de `config.toml`** |
| `customer-birthday-notify` | oui | secret cron ou clé serveur | **non** | **non** | n/a | **P2 ×3** : idem, `details: fetchErr.message` (`:102`) |
| `generate-pdf` | oui | oui (Bearer + permission) | oui, 30/min | **non** | n/a | **P2** : 5 fuites de `detail: …message` |
| `generate-zreport-pdf` | oui | oui | oui, 10/min | **non** | n/a | **P2** : 5 fuites `detail:` ; idempotence obligatoire |

**Points transversaux.**

- **Redaction incomplète.** `AGENTS.md` / ADR-013 imposent « plus aucun `message`
  Postgres brut dans les réponses ». La discipline est **parfaite sur les 5 EF
  d'argent** (34 appels `redactError`/`logAndRedact` au total). Elle est
  **absente** sur `lan-heartbeat-batch`, `notification-dispatch`,
  `customer-birthday-notify`, `generate-pdf` et `generate-zreport-pdf`. Un
  `error.message` Postgres divulgue des noms de contrainte, de table et de
  colonne — de la cartographie de schéma offerte à qui peut appeler l'EF. **Les
  PDF sont accessibles à tout utilisateur authentifié.**
- **Dérive `config.toml`.** `notification-dispatch` et
  `customer-birthday-notify` reposent sur un secret partagé en header **sans
  Bearer**, ce qui exige `verify_jwt = false`. Les deux sont **absents** de la
  section `[functions.*]`. Le commentaire de `lan-heartbeat-batch:8` dit
  d'ailleurs « même pattern que notification-dispatch », et
  `lan-heartbeat-batch`, lui, **est** déclaré (`config.toml:396-397`).
  **Rapport 01 §5.7 tranche ce point : les deux fonctions ne sont pas déployées
  en production.** La dérive `config.toml` est donc une cause plausible, pas
  seulement une hypothèse.
- **Comparaisons de secret non timing-safe** : `customer-birthday-notify:41`,
  `lan-heartbeat-batch:37`, `notification-dispatch:150`. Exploitation réseau
  pratiquement irréaliste, mais
  `apps/print-bridge/src/security/deviceRegistry.ts:129` utilise déjà
  `timingSafeEqual` — **le dépôt sait faire, les EF ne le font pas.** Incohérence
  plus que faille.
- **CORS globalement permissif** : `supabase/functions/_shared/cors.ts:3` →
  `'Access-Control-Allow-Origin': '*'`, aucune allowlist, pour les 19 EF.
  Acceptable car l'authentification est portée par des **en-têtes** et jamais par
  cookie, donc pas de CSRF ambiant ; mais sur le money-path une allowlist
  coûterait peu. La liste `Allow-Headers` est en revanche propre et explicite.
- **La vérification du PIN-JWT est excellente.** `_shared/acting-user.ts:44-73`
  **vérifie** la signature HS256 (pas un simple decode), puis contrôle
  `role === 'authenticated'`, `app_metadata.provider === 'pin'`, le format UUID de
  `sub` **et** de `session_id`, `exp` numérique et non expiré, **puis** interroge
  `is_pin_session_active_v1` pour refuser une session révoquée. Une garde
  indisponible renvoie 503 (fail-closed), jamais un accès.
- **Rate limit à deux étages** (`_shared/rate-limit.ts`) : LRU en mémoire + table
  Postgres via `record_rate_limit_v1`, avec purge opportuniste échantillonnée
  pour tenir les instances sans état. Bien conçu. **5 EF ne l'utilisent pas.**
  Rappel du rapport 01 : la table `edge_function_rate_limits` compte 9 502 lignes
  en production et **n'est jamais purgée** faute de cron.

### 8.6 ESLint — aucune règle dure désactivée

Base : `tseslint.configs.recommendedTypeChecked` +
`stylisticTypeChecked`, avec `projectService: true` (lint type-aware réel).
**Aucun `off` sur une règle de sûreté** : `no-unsafe-assignment`,
`no-unsafe-member-access`, `no-unsafe-call`, `no-unsafe-return`,
`no-unsafe-argument`, `no-floating-promises` restent actives — c'est d'ailleurs
*pourquoi* le dépôt a 248 `as unknown as` plutôt que 248 `any`.

Les seuls `off` sont cosmétiques et corrects (`react/react-in-jsx-scope`,
`react/prop-types`).

Règles **ajoutées** au-delà du recommandé :
`no-explicit-any: 'error'` · `consistent-type-imports` ·
`react-hooks/rules-of-hooks: 'error'` ·
`breakery-local/no-raw-modal-overlay: 'error'` (**règle maison**,
`tools/eslint-rules/no-raw-modal-overlay.mjs`, interdisant les overlays
`fixed inset-0` hors `packages/ui`) · `no-restricted-syntax` ×2 (classes Tailwind
numérotées brutes, en littéral **et** en `TemplateElement`) ·
`import/no-restricted-paths` (11 zones, dont l'étanchéité POS ↔ back-office et
l'invariant IO-free de `packages/domain`) · `no-restricted-imports` ciblé.

Deux réserves : `max-lines` n'est qu'un `'warn'` (§1.1), et
`react-hooks/exhaustive-deps` est à `'warn'` avec 18 `disable` posés dessus
(§7.2).

### 8.7 Les 10 gardes de gouvernance — inventaire réel

| # | Nom | Script | Protège | Baseline (plafond) |
|---|---|---|---|---|
| — | verrou `has_permission` | inline `ci.yml:57-80` | interdit un `CREATE FUNCTION has_permission` dans une migration neuve | — |
| — | régénération des types | inline `ci.yml:88-108` | une migration neuve sans régénération des types bloque (échappatoire `[types-noop]`) | — |
| 1 | chemins quarantainés | `quarantined-paths.mjs` | aucun chemin du lot Q cité dans un fichier suivi | 35 / **40** |
| 2 | liens relatifs | `relative-links.mjs` | tout lien relatif d'un `.md` suivi résout | aucune |
| 3 | classes de couleur mortes | `tailwind-dead-classes.mjs` | classe qui ne génère **aucune** règle CSS (`bg-gold/5`) | 2 / **2** |
| 4 | couleurs du thème en dur | `hardcoded-theme-colors.mjs` | `#rrggbb` / `rgba()` recopié au lieu du token | 1 / **2** |
| 5 | anneau de focus | `focus-ring-controls.mjs` | tout contrôle a son focus visible | **vide — plafond 0** |
| 6 | aplats d'or | `gold-fills.mjs` | l'or reste un accent | 3 / **3** |
| 7 | classes de police menteuses | `lying-font-classes.mjs` | une classe ne nomme pas le contraire de son rendu | **vide — plafond 0** |
| 8 | portée `TOOLBAR_BTN_*` | `toolbar-button-scope.mjs` | ces chaînes restent dans un bandeau de page | 3 / **4** |
| 9 | coins entièrement ronds | `tight-corner.mjs` | The Tight-Corner Rule | 15 / **19** |
| 10 | **formule de prix de ligne** | `line-total-formula.mjs` | **impose `lineTotalOf`/`lineUnitEach` du domaine ; interdit `unit_price + price_adjustment`** | 1 / **1** |

9 des 10 partagent `scripts/ci/_guard-lib.mjs`, dont le régime est écrit noir sur
blanc (`_guard-lib.mjs:19`) : **« PLAFOND COMPTÉ, JAMAIS PLANCHER »**. Le drapeau
`--update-baseline` **refuse** de relever un plafond en cas de violation
(`:301`) et `--init-baseline` n'amorce qu'une baseline vide (`:294`).

**La garde n°10 est la seule du lot à protéger un invariant financier** plutôt
que visuel. Son plafond est de 1, donc elle ne gèle presque aucune dette.

**Deux gardes manquantes, identifiées par ce rapport** : la langue de l'interface
(§6 du rapport 01 : conformité à 100 % aujourd'hui, aucun exécuteur) et
l'interpolation dans un `.or(` (§8.1 : deux divergences déjà produites).

---

## 9. Déchets, dossiers douteux et dépendances

### 9.1 La racine du dépôt est propre

```
$ git ls-files | while read f; do [ -f "$f" ] && [ ! -s "$f" ] && echo "EMPTY: $f"; done
(aucune sortie)
$ git ls-files | grep -Ei "(^|/)(0|1|5|limite|tmp|temp|nul|out)(\.|$)|\.(bak|old|orig|tmp|rej|swp)$"
(aucune sortie)
$ git status --porcelain --untracked-files=all
(aucune sortie)
```

**Aucun fichier 0 octet suivi. Aucun fichier au nom non parlant. Aucun fichier
non suivi et non ignoré.** Le piège Windows des redirections ratées documenté
dans `AGENTS.md` ne s'est pas matérialisé cette fois.

Les 19 fichiers de la racine sont tous des fichiers de configuration légitimes,
**sauf un** (`ruvector.db`, §9.2).

### 9.2 Dossiers douteux — suivi, ignoré, taille

| Chemin | `git ls-files` | Ignoré | Taille | Verdict |
|---|---|---|---|---|
| `.turbo` | 0 | oui | **101 Mo** | cache de build — **déchet d'outillage, sûr** |
| `.ds-sync` | 0 | oui | **46 Mo** | scratch design-sync — **déchet, sûr** |
| `test-results` | 0 | oui | **20 Mo** | artefacts Playwright — **déchet, sûr** |
| `ds-bundle` | 0 | oui | **9,8 Mo** | sortie de build design-sync — **déchet, sûr** |
| `.swarm` | 0 | oui | 5,2 Mo | runtime claude-flow, **mort** (`swarm/` aboli par `AGENTS.md`) — **sûr** |
| `.playwright-mcp` | 0 | oui | 4,2 Mo | snapshots / traces — **déchet, sûr** |
| `.playwright-cli` | 0 | oui | 1,5 Mo | idem — **déchet, sûr** |
| `ruvector.db` | 0 | oui | 1,5 Mo | base vectorielle ruflo, **mtime 2026-06-12** (5 mois) — **sûr** |
| `.claude-flow` | 0 | oui | 44 ko | runtime claude-flow, **mort** — **sûr** |
| `apps/pos/android/app/build` | 0 | oui (`apps/pos/android/.gitignore:24`) | **31 Mo** (tout `android/`) | sortie Gradle — **déchet, sûr** |
| `.design-sync` | **60** | **non** | 408 ko | **UTILE** — previews + `NOTES.md` versionnés (PR #412) |
| `.impeccable` | **10** | non | 127 ko | **UTILE** — `config.json` partagé + 9 snapshots de critique datés |
| `tools` | **3** | non | 21 ko | **UTILE** — règle ESLint locale, chargée par `eslint.config.mjs:5` |
| `.serena` | **2** | non | 13 ko | `project.yml` + son `.gitignore` — **à vérifier** : rien dans le dépôt ne le lit |

**Total du déchet d'outillage ignoré par git : ~190 Mo** (hors `node_modules`).
Rien n'est versionné ; sa suppression n'affecte pas le dépôt, seulement les
caches locaux (`.turbo` sera reconstruit, coût = un build froid).

Les 4 fichiers 0 octet trouvés hors `.git` sont tous dans des zones ignorées :
`.claude/memory.db-wal`, `.codex/stock-lint-final.log`, `.swarm/attestation.db`,
`ds-bundle/.ds-bundle`.

### 9.3 `scripts/` — deux fichiers jamais référencés, aucun n'est un déchet

| Fichier | Lignes | Verdict |
|---|---|---|
| `scripts/cleanup/uxui-test-data-cleanup.sql` | 116 | **à vérifier** — pas un déchet |
| `scripts/release/prepare-backup-task.ps1` | 39 | **à vérifier** — procédure manuelle |

Le premier **s'annonce lui-même comme non exécutable en l'état** — c'est un
artefact d'arbitrage en attente :

```
scripts/cleanup/uxui-test-data-cleanup.sql:2
-- À RELIRE PAR MAMAT AVANT EXÉCUTION — NE PAS LANCER TEL QUEL.
```

Le second est une **procédure d'installation manuelle** (il ne crée aucune tâche
Windows), donc normalement absent de la CI :

```
scripts/release/prepare-backup-task.ps1:1
# Prépare une définition de tâche inspectable ; ne crée aucune tâche Windows.
```

Les trois autres non-`.mjs` isolés sont **bien référencés** :
`scripts/e2e/provision-pins.sql` (« Invoked by playwright-e2e.yml »),
`scripts/release/Mettre-a-jour.cmd` (lanceur de `install-shop.ps1`),
`scripts/release/bootstrap-parse.py`.

### 9.4 TODO / FIXME / HACK — **un seul dans tout le code vivant**

```
apps/backoffice/src/__tests__/suppliers-crud.smoke.test.tsx:193
  // TODO(session-15): Phase 5.A rewrote SuppliersPage from a table to a
```

Chiffres bruts par tag : TODO 58, HACK 1, XXX 9, **FIXME 0**. **Ces chiffres
bruts sont trompeurs et presque tout est du bruit** :

- ~49 des 58 TODO viennent de `supabase/tests/node_modules/`
  (`@supabase/postgrest-js`, `@types/node`, `undici-types`) — dépendances
  installées, pas du code du projet.
- Les 9 `XXX` sont des **masques de format** dans des commentaires SQL :
  `R-XXXX`, `JE-REF-XXXX`, `TRF-YYYYMMDD-XXXX`, `JE-YYYYMMDD-XXXX`.
- L'unique `HACK` est une **valeur de fixture pgTAP** :
  `supabase/tests/sections_rpc.test.sql:67: 'code', 'HACKED_CODE', …`.

**Il n'y a donc pas de dette signalée par commentaire dans ce dépôt.** Elle est
portée par les ADR et les tests, ce qui est cohérent avec `AGENTS.md`. **Rien à
nettoyer ici.**

### 9.5 Dépendances

**Imports de paquets non déclarés : aucun.** C'est le cas qui casse un build ;
il est propre. Les 3 détections sont des faux positifs de regex sur des chaînes
de test.

**Dépendances déclarées jamais importées — les 3 réelles :**

| Workspace | Dépendance | Preuve | Risque |
|---|---|---|---|
| `packages/supabase` | `@breakery/domain` | `grep -rn "@breakery/domain" packages/supabase/src` → aucune sortie | **sûr** |
| `packages/supabase` | `@breakery/utils` | `grep -rn "@breakery/utils" packages/supabase/src` → aucune sortie | **sûr** |
| `packages/utils` | `date-fns` | seul `date-fns-tz` est importé (`src/dates.ts:2`) | **à vérifier** |

`date-fns` est la **peer dependency de `date-fns-tz`** : la déclarer
explicitement est défendable et la retirer peut casser la résolution. **Ne pas y
toucher sans vérifier `pnpm-lock.yaml`.** Les deux `workspace:*` de
`packages/supabase`, en revanche, sont du poids mort net : ils créent une arête
de graphe Turbo — donc des reconstructions inutiles — pour rien.

**Les 29 autres « déclarées jamais importées » sont des faux positifs** et ne
doivent pas être signalées : `@fontsource*` (7, importées depuis le **CSS**),
`@types/*` (9, consommées par `tsc`), `postcss`/`autoprefixer` (6, chargées par
la config PostCSS), `jsdom` (4, environnement vitest),
`@vitest/coverage-v8` (5, chargé par `--coverage`), `tsx` (script `dev` de
print-bridge), `@capacitor/android` (consommée par Gradle, ADR-029).

---

## 10. Plan de nettoyage sans risque

**Principe.** Un lot par niveau de risque, dans l'ordre. Chaque lot est
vérifiable seul. Rien ici n'est autorisé : c'est une proposition.

**Préalable commun à tous les lots** : partir d'une branche dédiée
(`chore/<sujet>`), jamais de commit direct sur `master`. Après chaque lot :
`pnpm typecheck`, la **suite BO complète** (le lint-ratchet CI réveille les
erreurs préexistantes des fichiers touchés, et une suite partielle laisse passer
les régressions inter-fichiers), puis `node scripts/agents/sync.mjs --check`.

### Lot 0 — Gratuit, hors dépôt, aucun risque

Purger les caches locaux ignorés par git : `.turbo` (101 Mo), `.ds-sync` (46 Mo),
`test-results` (20 Mo), `ds-bundle` (9,8 Mo), `.swarm` (5,2 Mo),
`.playwright-mcp` (4,2 Mo), `.playwright-cli` (1,5 Mo), `ruvector.db` (1,5 Mo),
`.claude-flow` (44 ko), `apps/pos/android/app/build` (dans les 31 Mo d'`android/`).

**Ce qu'on perd** : rien dans le dépôt. Coût réel : un build froid Turbo et une
reconstruction du cache Playwright. **Aucun commit.**

### Lot 1 — Les deux `as any` périmés sur `stock_lots`

Le correctif le moins cher du rapport. `stock_lots` **est** présent dans
`packages/supabase/src/types.generated.ts:7015` : le commentaire « types
regenerate after migration apply » est périmé, et les deux `.from('stock_lots' as any)`
(`apps/backoffice/src/features/inventory/hooks/useStockLots.ts:53`,
`apps/pos/src/features/products/hooks/useActiveLotsByProduct.ts:31`) masquent un
typage réel.

**Ce qu'on perd** : rien. **Ce qu'on gagne** : le compilateur revalide deux accès
à une table de stock. **Le typecheck peut révéler des écarts de forme** — c'est
précisément l'intérêt.

### Lot 2 — Code mort « sûr », 12 fichiers / ~600 lignes

1. Les 11 orphelins de §2.1.
2. `features/devices/` en entier (dossier à 1 fichier) **et** le `vi.mock`
   orphelin de `pages/orders/__tests__/OrdersListPage.smoke.test.tsx:41`, dans le
   même commit.
3. `FullScreenModalClose` (`packages/ui/src/components/FullScreenModal.tsx:94`).
4. `@breakery/domain` et `@breakery/utils` dans
   `packages/supabase/package.json`.

**Ce qu'on perd** : rien de fonctionnel. **Ce qu'on vérifie avant** : que
`git grep` confirme 0 importeur **à la date du geste** (ce relevé a 1 jour).
`CustomerListRow.tsx` est le cas d'école : il est mort depuis le 2026-08-27 et a
déjà attiré un correctif erroné.

**Référence entrante à vérifier avant chaque suppression** : grep du nom de
fichier dans tout le dépôt, y compris `scripts/ci/` (gardes documentaires),
`.design-sync/` et les autres `.md`.

### Lot 3 — Deux trous de parcours à trancher, pas à nettoyer

Ce lot n'est **pas** un nettoyage : c'est une décision produit.

1. **`useUpdateVariant.ts`** — le back-office ne peut pas modifier une variante.
   Soit on câble le hook, soit on le supprime et on acte que la modification de
   variante n'existe pas.
2. **`useStockLots.ts`** — toute la lecture de péremption (F1) est écrite et
   inatteignable, alors que `stock_lots` porte 21 lignes en production. À
   confronter à **ADR-004** (« pas de péremption ni FIFO »), qui pourrait rendre
   ce code légitimement mort.
3. **`useSetProductTestFlag.ts`** — à confronter à **ADR-035** (« retrait
   interrupteur produit test »).

**Ce qu'on perd si on supprime sans trancher** : de la fonctionnalité écrite et
payée. **Ne pas faire ce lot avant les deux ADR.**

### Lot 4 — Mutualisation du sanitizer `or=` + 11ᵉ garde CI

1. Déplacer `OR_FILTER_UNSAFE` + `sanitizeSearchTerm` dans `packages/utils`, et
   faire pointer les 4 copies existantes dessus.
2. Appliquer le sanitizer aux 2 sites affaiblis
   (`features/expenses/hooks/useExpensesList.ts:54`,
   `features/suppliers/hooks/useSuppliersList.ts:36`) et au site non protégé
   (`features/historical-import/HistoricalReferencePanel.tsx:51`).
3. Ajouter une garde `scripts/ci/or-filter-interpolation.mjs` sur
   `` \.(or|filter|ilike|like)\(\`[^\`]*\$\{ ``, baseline vide.

**Ce qu'on perd** : rien. **Ce qu'on gagne** : la cause est traitée, pas les
symptômes. Le dépôt a déjà la démonstration chiffrée que seule une garde tient un
invariant.

### Lot 5 — Les 15 « faux vides », par ordre de gravité métier

Un lot par aire, en commençant par les 3 parcours argent : la chaîne
d'approbation de dépense (`ApprovalTimeline.tsx:16`), les créances B2B
(`B2bInvoicesTab.tsx:115`), le crédit magasin (`StoreCreditTab.tsx:30`).

Le motif à appliquer existe déjà dans le dépôt : `QueryErrorBanner` (26
importeurs) ou le passage de `error` à un socle comme le fait `ReportShell`.

### Lot 6 — Validation des enveloppes de RPC

1. **`finalize_opname_v6`** d'abord (§5.5) : c'est le seul trou net sur un
   parcours de stock.
2. Puis les 12 hooks de production, stock, B2B et achats listés en §5.4, en
   appliquant le motif déjà écrit dans
   `apps/pos/src/features/payment/hooks/useCheckout.ts:230-250` et
   `features/orders/hooks/useOrdersCounters.ts:73-83`.
3. **`useOrdersList.ts:110-116`** (pagination des commandes) peut partir dans le
   même lot : le correctif est à 10 lignes et le modèle est dans le module voisin.

**Alternative à arbitrer** : introduire `zod` dans le back-office plutôt que
d'étendre `features/reports/utils/parse.ts`. C'est une décision d'architecture,
pas un nettoyage.

### Lot 7 — `memo` sur `CartLineRow`

`features/cart/CartLineRow.tsx` (330 lignes) est rendu une fois par ligne de
panier depuis un parent abonné à `s.cart` : chaque modification de quantité
re-rend tout le ticket. `ProductCard` a reçu son `memo` ; c'est le symétrique
oublié.

**Ce qu'on perd** : rien. **À mesurer avant et après dans le navigateur** — un
raisonnement sur la chaîne d'abonnement est un majorant, pas un profil.

### Lot 8 — Découpage de `routes/index.tsx`

1 278 lignes, 6 modifications en 2 semaines, 138 `<Route>`. À découper par aire
métier, avec les 4 gardes dans leur propre fichier.

**Ce qu'on perd** : rien, mais le diff est large et touche un fichier que
plusieurs chantiers modifient. **À faire quand aucun autre lot n'est en vol**,
pour éviter les conflits.

### Lot 9 — Les 30 exports `packages/domain` testés et jamais atteints

**À ne pas faire comme un nettoyage.** Ce sont probablement des miroirs
TypeScript délibérés des RPC money-path et le harnais de repli hors ligne
(`useEvaluatePromotions.ts:11` le dit explicitement). Le constat utile à remonter
est : « ces 30 fonctions sont testées et jamais atteintes depuis une surface ».

Les seuls éléments de ce lot classables « sûrs » : les 6 constantes et gardes de
`packages/domain/src/accounting/types.ts` et `setBreadcrumbHook`
(`packages/utils/src/logger.ts:24`).

### Ce qu'il ne faut PAS toucher

Récapitulatif, pour qu'un nettoyage mécanique ne casse rien.

| Élément | Raison |
|---|---|
| `apps/pos/src/stores/paymentAttempt.ts:39-43` | absence de `try/catch` **voulue** : un stockage plein doit empêcher le paiement de partir |
| L'absence de clé d'idempotence dans `CloseShiftModal.tsx` | `close_shift_v13` est idempotent par **état** |
| `features/inventory-production/components/ProductionRecordList.tsx` | orphelin **assumé et commenté** (`RevertProductionAction.tsx:35-37`) |
| `supabase/functions/customer-birthday-notify/` | déclenchée par cron DB, invisible côté client |
| Les 3 `VoidOrderModal` | les trois ont un appelant |
| `components/BackofficeUi.tsx`, `FormField.tsx`, `SectionLabel.tsx` | adaptateurs de thème assumés, 237 + 3 + 36 importeurs |
| `buttonVariants`, `badgeVariants` | API publique `cva` d'un design system |
| Les 6 composants `packages/ui` sans importeur | **5 ont une preview versionnée** dans `.design-sync/` |
| `QwertyLayout` / `useVirtualKeypad` | clavier virtuel POS corrigé par la PR #485 — vérifier le câblage réel d'abord |
| `date-fns` dans `packages/utils` | peer dependency de `date-fns-tz` |
| `.design-sync/`, `.impeccable/`, `tools/` | suivis par git et utiles |
| `.env.example:3` (JWT `anon` dev) | clé publiable par conception, conforme à la doctrine du projet |
| Les 24 fichiers de `scripts/` « orphelins » | lancés **par glob** depuis les workflows |
| `reports/perishable-turnover` hors menu | décision ADR-004, documentée dans `nav.ts:214-226` |
| Les 2 tables « RLS sans policy » | fail-closed voulu |

---

## 11. Limites de cet audit

- **Analyse statique uniquement.** Aucun build, test, lint ou install n'a tourné.
  Un orphelin classé « sûr » reste à confirmer par un `typecheck` et la suite BO
  complète avant retrait réel.
- Le périmètre d'extensions exclut `.css`, `.html`, `.gradle` et les `.json` de
  configuration — d'où les faux positifs `@fontsource` / `@capacitor` écartés à
  la main en §9.5.
- Les exports de `supabase/functions` (Deno) et de `packages/supabase/src` n'ont
  pas été passés au crible « export mort ».
- Les constats de rendu (§7.2) sont des **lectures de code**, pas des profils
  React DevTools.
- Le constat « `verify_jwt` non déclaré » (§8.5) ne se tranche définitivement que
  contre le déploiement réel ; `config.toml` ne gouverne que les déploiements
  faits depuis cette configuration.
- Les PIN de dev publiés dans `README.md` (§8.3) n'ont **pas** été testés en
  production : aucun essai d'authentification n'a été effectué.
- `docs/` a été exclu des greps de constat, et la quarantaine documentaire n'a
  jamais été lue, conformément à `AGENTS.md`.

**Aucun fichier applicatif n'a été créé, modifié ou supprimé. Aucun commit.**
