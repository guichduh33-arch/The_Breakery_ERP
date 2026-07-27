# Spec 015x — Encaissement hors-ligne, tous moyens de paiement

> Spec d'exécution exigée par **ADR-015**. Périmètre fermé, durée de vie limitée :
> **supprimée à la livraison**, résiduel éventuel reporté dans ADR-015.
> Toute question non tranchée ici remonte à Mamat, jamais arbitrée en séance.

## 1. État des lieux vérifié

Constats établis sur le code et sur le cloud V3 dev (`ikcyvlovptebroadgtvd`), pas
sur les fichiers de migration — les versions live divergent de l'historique.

| Fait | Preuve |
|---|---|
| Le money-path accepte déjà 1..5 règlements, toutes méthodes, en replay offline | `pay_existing_order_v16(p_payments jsonb, p_offline_replay boolean)`, corps §127-142 |
| L'enum `payment_method` live porte **9** valeurs (e-wallets compris) | `pg_enum` live — le fichier d'init n'en liste que 6 |
| L'avoir est gaté serveur sous verrou, et `p_offline_replay` ne le bypasse pas | `20260726000238_…_v16_store_credit_gate.sql` §174-196 et §527 |
| Le contrôle anti-fraude non-cash existe, en comptage aveugle | `close_shift_v8(p_counted_card, p_counted_qris)` — `…126_close_shift_v5_three_way_denominations.sql:159-161` |
| Le drain s'arrête au premier échec | `apps/pos/src/features/lan/offlineReplay.ts:162` |
| Versions settings live | `set_setting_v10`, `get_settings_by_category_v8` → cibles **v11** / **v9** |
| Plus haut NAME-block | `…251` → migration à écrire en **`…252`** |

**Conséquence de cadrage : aucune RPC money-path n'est touchée.** Le chantier est
client POS + une migration de réglages.

## 2. Invariants à ne pas casser

1. **Aucune vente perdue à la mise à jour.** Un terminal peut recevoir le nouveau
   build avec des intents `cash_payment` en file. Le replay doit les rejouer.
   Non négociable : ces enregistrements représentent de l'argent encaissé.
2. **`store_credit` jamais mis en file hors-ligne.** Refus en amont, dans le
   dispatch — pas un filtre au replay.
3. **Write-first conservé** : l'outbox est écrite AVANT le publish bus et avant
   tout retour visuel de succès (`usePaymentFlowLogic.ts` §250).
4. **Clé d'idempotence d'origine préservée** au replay. Un double drain reste un
   no-op serveur.
5. **Les refus hors-ligne existants restent** : promotions, remise commande,
   points fidélité, commande déjà cloud. Ils ne sont pas dans le périmètre.
6. **`stock_movements` et `audit_logs` intouchés** — le replay passe par la RPC,
   qui fait déjà le nécessaire.

## 3. Lots

### Lot 1 — Outbox et replay (`apps/pos/src/features/lan/`)

**`offlineOutbox.ts`**
- Nouvel intent `OfflinePaymentIntent { kind: 'payment'; payments: Tender[]; … }`,
  remplaçant `OfflineCashPaymentIntent`.
- `OfflineCashPaymentIntent` **conservé dans l'union** en tant que forme legacy,
  documenté comme non-émis (lecture seule, pour les files en cours).
- `removeIntentsByRoot` doit filtrer les deux kinds.

**`offlineReplay.ts`**
- Branche `payment` → `pay_existing_order_v16` avec `p_payments: intent.payments`.
- Branche `cash_payment` (legacy) conservée telle quelle, avec `p_payment`.
- La trace d'échec `emitPosEvent('payment_failed', …)` couvre les deux kinds ;
  le montant devient la somme des règlements.

### Lot 2 — Gate et dispatch

**`hooks/useOfflineCashGate.ts` → `hooks/useOfflinePaymentGate.ts`**
- Suppression de `isWindowExpired`, du tick 60 s, de l'état `window_expired` et
  de l'import `offlineSince`.
- `cashAllowed` → `paymentsAllowed` ; `blockedReason` se réduit à
  `'payments_disabled' | null`.
- Le fichier de test suit le renommage.

**`features/payment/hooks/usePaymentFlowLogic.ts`**
- `dispatchOfflineCash` → `dispatchOfflinePayment(tendersToShip: Tender[])`.
- Remplacer le refus « 1 seul cash » par : `1 ≤ length ≤ 5`, et refus si un
  règlement porte `method === 'store_credit'` → toast « Avoir indisponible
  hors-ligne — retirer ce règlement ».
- `cash_received` / `change_given` calculés sur les seuls règlements cash ; le
  rendu monnaie affiché en succès est celui du cash, 0 si aucun cash.
- L'`emitPosEvent` de succès porte la liste des méthodes, plus `method: 'cash'`
  en dur.

**`features/payment/PaymentTerminal.tsx`**
- Retrait du garde-fou split hors-ligne (§181-186) et du toast associé.
- La bannière offline perd la branche `window_expired`.

### Lot 3 — Migration `…252` + réglages

Une seule migration, sans `BEGIN;`/`COMMIT;` :
1. `ALTER TABLE business_config RENAME COLUMN offline_cash_enabled TO offline_payments_enabled;`
2. `ALTER TABLE business_config DROP CONSTRAINT business_config_offline_max_hours_range, DROP COLUMN offline_max_hours;`
3. `set_setting_v11` — copie du **corps live** de v10 (`pg_get_functiondef`, jamais
   du fichier d'origine), clé `offline_cash_enabled` → `offline_payments_enabled`,
   branche `offline_max_hours` supprimée. `DROP FUNCTION set_setting_v10(...)` dans
   la même migration.
4. `get_settings_by_category_v9` — idem, catégorie `network` réduite à une clé.
5. Paires REVOKE complètes sur les deux nouvelles fonctions : `FROM PUBLIC` **et**
   `FROM anon`, puis `GRANT EXECUTE TO authenticated, service_role`.
6. `COMMENT ON` colonne et fonctions, citant ADR-015.

Puis **regen des types** (`generate_typescript_types`) — en diffant le résultat
avant commit, une autre session peut avoir migré le cloud partagé.

**`apps/pos/src/features/settings/hooks/useOfflineNetworkConfig.ts`**
- `OfflineNetworkConfig` se réduit à `{ offlinePaymentsEnabled: boolean }`,
  défaut `false` (fail-closed conservé, c'est le garde-fou principal).

**`apps/backoffice/src/features/lan-devices/components/OfflineSettingsPanel.tsx`**
- Retrait du champ heures, libellé du toggle corrigé (il ne parle plus de cash).

### Lot 4 — Tests

**pgTAP** (via MCP, `BEGIN`/`ROLLBACK`) :
- `set_setting_v11` accepte `offline_payments_enabled` en booléen, rejette un
  type invalide, et rejette `offline_max_hours` comme clé inconnue.
- `get_settings_by_category_v9('network')` renvoie exactement une clé.
- `pay_existing_order_v16` accepte deux règlements non-cash avec
  `p_offline_replay = true` et écrit deux lignes `order_payments`.
- `set_setting_v10` / `get_settings_by_category_v8` n'existent plus.

**Vitest POS** :
- Replay d'un intent legacy `cash_payment` → appelle `p_payment`, réussit.
- Replay d'un intent `payment` multi-tender → appelle `p_payments`.
- Gate : plus aucun blocage lié à la durée, quelle que soit `offlineSince`.
- Dispatch : accepte cash+carte en split, refuse un règlement `store_credit`
  **sans rien mettre en file**.

Les filtres vitest matchent le **nom de fichier**. La suite POS complète expire
en local : la CI est le seul filet full-suite.

## 4. Points de vigilance

- **Ne pas partir du fichier de migration** pour copier `set_setting` : le corps
  live fait foi (CLAUDE.md).
- **Redéployer les EF** si un DROP de RPC touche une fonction appelée depuis
  `supabase/functions/**` — grep systématique avant de clore le lot 3. Ici les
  RPC settings ne sont a priori pas appelées par une EF ; à vérifier, pas à
  supposer.
- **Une seule branche, un seul sujet** : `feat/offline-all-payment-methods`.
- Le renommage de colonne casse tout call-site oublié : grep
  `offline_cash_enabled` et `offline_max_hours` sur l'ensemble du repo avant de
  déclarer le lot 3 fini.

## 5. Définition de fini

- Les 4 lots livrés, pgTAP au vert, suites vitest POS/BO touchées au vert en CI.
- Aucune occurrence résiduelle de `offline_max_hours` ni `offline_cash_enabled`.
- Types régénérés et diffés.
- Fiche `docs/objectifs/POS.md` §18 mise à jour par Mamat : la ligne backlog
  décrit désormais du livré, pas une cible.
- **Cette spec supprimée**, résiduel éventuel reporté dans ADR-015.

## 6. Hors périmètre, explicitement

- La file empoisonnée (un intent en échec bloque le drain) — propriété existante.
- La clôture de shift pendant la coupure — impossible, RPC cloud.
- Tout rapport de rapprochement EDC — le comptage aveugle de `close_shift_v8`
  couvre le besoin (ADR-015).
- La validation en boutique du hors-ligne, toujours due, hors code.
