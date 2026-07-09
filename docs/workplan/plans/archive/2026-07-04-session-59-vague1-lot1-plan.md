# Session 59 — Plan d'exécution — Remise à plat Vague 1, lot 1

> **Date :** 2026-07-04 · **Branche :** `swarm/session-59` (base master post-#145 / S58 soldée)
> **Périmètre :** lot 1 de la Vague 1 de la remise à plat = les **2 findings S58** (F-1 P0, F-4 P1) + tous les **quick wins « UI pures »** de la Vague 1 (démarrables immédiatement, hors règle money-path).
> **Source de périmètre :** `docs/workplan/remise-a-plat/00-INDEX.md` §3 « Vague 1 — UI pures » + `docs/workplan/plans/2026-07-04-session-58-INDEX.md` (Findings F-1/F-4).
> **Renvoi au lot 2 (S60) — HORS de ce plan :** les 6 items « sous règle money-path » restent pour S60 : paiement direct ardoise (02 D1.1), `reason_code` dans `CashInOutModal` (12 D1.1), note d'écart shift serveur (12 D1.4), lignes promo sur ticket + détail BO (13 D1.1/D1.2), « Tout prêt » bump en masse KDS (04 D1.2), `x-idempotency-key` sur le void BO (02b). **Ne rien implémenter de cette liste ici.**
> **Modèle d'exécution :** subagent-driven development, un implémenteur frais par tâche. Chaque tâche ci-dessous est **autonome** : l'implémenteur lit UNIQUEMENT sa section `## Task N` + la section `## Global Constraints`.

---

## Global Constraints

Contraintes transverses — **valables pour TOUTES les tâches** :

- **Monorepo pnpm 9.15 + turbo** — jamais `npm`. Commandes : `pnpm build`, `pnpm test`, `pnpm typecheck`, ou ciblé `pnpm --filter @breakery/<pkg> test <feature>`. Filtres : `@breakery/app-pos` (aussi appelé `@breakery/pos` selon le package.json — vérifier), `@breakery/app-backoffice` / `@breakery/backoffice`, `@breakery/domain`, `@breakery/supabase`, `@breakery/ui`, `@breakery/utils`.
- **DB = Supabase cloud V3 dev `ikcyvlovptebroadgtvd`** (Docker retiré 2026-05-14). Toute opération DB passe par les outils MCP UNIQUEMENT :
  - Appliquer une migration : `mcp__plugin_supabase_supabase__apply_migration` (`project_id='ikcyvlovptebroadgtvd'`, `name` en snake_case, body = SQL). L'appel wrappe DÉJÀ dans une transaction.
  - Exécuter du SQL / pgTAP : `mcp__plugin_supabase_supabase__execute_sql`.
  - Regénérer les types : `mcp__plugin_supabase_supabase__generate_typescript_types` → écrire dans `packages/supabase/src/types.generated.ts` et committer.
  - **JAMAIS** `supabase start`, `supabase db reset`, `pnpm db:reset`, `bash supabase/tests/run_pgtap.sh` (nécessitent Docker, échouent).
- **Prochaine migration = NAME-block monotone.** Le plus haut existant à l'ouverture S59 est `20260710000100`. **Numéros pré-assignés par tâche** dans ce plan pour éviter les collisions en exécution parallèle (T1 = `_101`, T2 = `_102`, T5 = `_103` puis `_104`). Si tu dois en créer un non prévu, `Glob supabase/migrations/*.sql`, prends le max +1, et note-le dans ton rapport.
- **Jamais de `BEGIN;` / `COMMIT;` dans le corps d'une migration** appliquée via MCP `apply_migration` (déjà wrappé — un COMMIT interne termine la transaction externe et affaiblit l'atomicité ; leçon S58, shippée par erreur 2 sessions de suite).
- **RPC versioning monotone.** On n'édite JAMAIS une signature `_vN` publiée. Deux cas autorisés : (a) **fix in-place** d'un corps à **signature ET comportement identiques** (ou correction pure d'un bug, avec justification écrite dans le commentaire de migration) ; (b) **nouveau `_vN+1`** + `DROP FUNCTION … vN(<args>)` dans la MÊME migration.
- **Tout fix d'une fonction SQL existante part du corps LIVE**, pas du fichier de migration d'origine (drift cloud↔git). Récupère le corps réel via `execute_sql` : `SELECT pg_get_functiondef('public.<fn>(<arg types>)'::regprocedure);` — puis modifie ce corps. Leçon durable **DEV-S57-02**.
- **Trio S20 sur toute NOUVELLE fonction** (defense-in-depth anon) : `REVOKE EXECUTE ON FUNCTION … FROM PUBLIC;` **ET** `REVOKE EXECUTE ON FUNCTION … FROM anon;` (le REVOKE anon seul est insuffisant — anon hérite via PUBLIC). Pour une fonction volontairement anon-callable, GRANT explicite + `COMMENT ON FUNCTION … IS 'anon-callable: <raison>';`.
- **Regen types OBLIGATOIRE après toute migration** de schéma/RPC (cause n°1 de CI cassée sur ce repo). `generate_typescript_types` → `packages/supabase/src/types.generated.ts` → commit.
- **Tests co-localisés** dans `__tests__/` à côté du code. Fichiers **< 500 lignes** (split si dépassement).
- **pgTAP via `execute_sql`** en enveloppe `BEGIN … ROLLBACK`. Critère de session = **`num_failed() = 0`** (plus strict que le code de sortie psql). Modèle : `BEGIN; SELECT plan(N); … ; SELECT * FROM finish(); ROLLBACK;` puis lire `num_failed()`.
- **Ne PAS lancer** `bash supabase/tests/run_pgtap.sh`. Rejoue les suites pgTAP concernées via MCP `execute_sql`.
- **Baseline env-gated pré-existante** (~3 POS + ~24 BO échecs `VITE_SUPABASE_URL Required`, DEV-S25-2.A-02) — ce ne sont PAS des régressions. En cas de doute, comparer à `master`.
- **Commits conventionnels co-signés Claude.** Format : `feat(scope): session 59 — <topic>` / `fix(scope): …`. Terminer par `Co-Authored-By: Claude <noreply@anthropic.com>`.
- **Ne PAS toucher aux items du lot 2** (liste money-path en tête de plan). Le verrou money-path est LEVÉ (S58, toutes ancres re-vertes), mais ces items sont réservés à S60 par décision d'ordonnancement.

---

## Task 1: F-1 (P0) — Garde dernier-admin de `delete_user_v1` doit ignorer les admins inactifs

**Objectif.** Corriger le finding **F-1 (P0)** du S58 : la garde `LAST_ADMIN_PROTECTED` de `delete_user_v1` compte les admins avec `deleted_at IS NULL` **sans filtrer `is_active`**. Le seed `SYS-CRON` (SUPER_ADMIN **inactif**) est donc compté comme admin restant → un opérateur peut supprimer le **dernier admin réel** et se verrouiller hors de l'administration (lockout administratif). Confirmé live au S58.

**Bug identique à vérifier et corriger dans la même migration.** `update_user_role_v1` (garde dernier-admin sur **downgrade de rôle**) a le **même pattern** : son sous-compte (`supabase/migrations/20260517000200_create_user_rpcs.sql:229-240`) filtre `deleted_at IS NULL` sans `is_active`. `delete_user_v1` : même fichier `:319-323`. Corriger LES DEUX si le corps live confirme l'absence de `is_active` (il l'a confirmé au grep du fichier d'origine — mais **repartir du corps live**, le corps a pu bouger).

**Procédure obligatoire (DEV-S57-02).** Récupère les corps LIVE avant toute édition :
```sql
SELECT pg_get_functiondef('public.delete_user_v1(uuid, text)'::regprocedure);
SELECT pg_get_functiondef('public.update_user_role_v1(uuid, text, text)'::regprocedure);
```
(Vérifie les types d'arguments exacts via `\df` / `pg_proc` si la signature diffère.) Le fix = ajouter `AND is_active = true` dans le sous-compte des admins restants des DEUX gardes. C'est une **correction de bug pure → migration in-place** (même signature, même comportement hormis le bug fermé). Justifier dans le commentaire de migration.

**Fichiers / migration.**
- Nouvelle migration `20260710000101_fix_last_admin_guard_ignore_inactive.sql` (via MCP `apply_migration`, name `fix_last_admin_guard_ignore_inactive`). Corps = `CREATE OR REPLACE FUNCTION` des deux fonctions à partir du corps live corrigé. **Pas de `BEGIN;`/`COMMIT;`** dans le corps.
- Regen types (`delete_user_v1`/`update_user_role_v1` gardent leur signature → diff probablement nul, mais lancer le regen et committer si diff).

**Critères d'acceptation.**
- La garde `LAST_ADMIN_PROTECTED` de `delete_user_v1` ne compte que les admins `is_active = true AND deleted_at IS NULL`. Idem pour `update_user_role_v1` (downgrade).
- Un scénario « il ne reste qu'un ADMIN réel actif + le SYS-CRON inactif → tenter de supprimer l'ADMIN actif » lève bien `LAST_ADMIN_PROTECTED` (P0001).
- Aucune régression sur la suppression normale (2+ admins actifs → suppression permise).

**Tests.**
- **Tripwire** : re-passer la suite pgTAP **`supabase/tests/users.test.sql` INTACTE** (ne PAS la modifier — c'est le tripwire rouge assumé du S58 qui DOIT redevenir vert après le fix) via MCP `execute_sql` en enveloppe `BEGIN … ROLLBACK`, vérifier `num_failed() = 0`.
- Si la suite ne couvre pas explicitement le cas « admin inactif compté », ajouter 1 assertion pgTAP dédiée dans `users.test.sql` (ou une suite voisine) prouvant qu'un SYS-CRON inactif ne sauve pas la garde.

**Commit attendu.** `fix(users): session 59 — F-1 last-admin guard ignores inactive admins (delete + role-downgrade)`

---

## Task 2: F-4 (P1) — `_emit_expense_je` conforme ADR-003 / NON-PKP (plus de compte 1151)

**Objectif.** Corriger le finding **F-4 (P1)** du S58 : le helper `_emit_expense_je` référence le mapping-key `EXPENSE_VAT_INPUT` → compte **1151 VAT Input**, **désactivé** (`is_active = false`) par la décision NON-PKP (ADR-003). Dès qu'une dépense a `vat_amount > 0`, l'approbation émet une ligne DR vers 1151 et **crashe** en `mapping_key_unknown`. Bug latent (0 dépense TVA en base aujourd'hui, mais toute approbation de dépense avec PPN saisie planterait).

**Règle ADR-003 (NON-PKP) à appliquer.** The Breakery est **NON-PKP** : le PPN 11 % payé aux fournisseurs PKP **n'est PAS récupérable** et doit être **capitalisé dans le coût** (fold dans la charge), jamais porté au compte 1151. Précédent identique côté achats : `20260603000012_bump_create_purchase_journal_entry_fold_vat_into_inventory.sql` (le goods-receipt fold `vat_amount` dans `INVENTORY_GENERAL`). Le compte 1151 est désactivé par `20260603000021_deactivate_account_1151_non_pkp.sql` et sa réactivation est gardée (`20260601183044`). Réf : `docs/adr/003-pkp-status-non-pkp.md` §2.

**Décision d'implémentation (tranchée dans ce plan).** **Fold `vat_amount` dans la ligne de charge** : le débit du compte de charge de la dépense devient `montant_charge + vat_amount` (le PPN devient partie intégrante du coût de la dépense), et la **ligne DR `EXPENSE_VAT_INPUT` disparaît**. On ne touche pas au crédit (AP / cash out inchangé, toujours sur le total). C'est le miroir exact du pattern achats `_000012`. (Alternative « interdire `vat_amount > 0` à la saisie » rejetée : elle casse la saisie légitime du PPN fournisseur et perd l'information de coût.)

**Procédure obligatoire (DEV-S57-02).** `_emit_expense_je` est défini en dernier lieu dans `supabase/migrations/20260524115443_fix_submit_expense_v2_security_hardening.sql` (origine git), mais **repars du corps LIVE** :
```sql
SELECT pg_get_functiondef('public._emit_expense_je(<signature>)'::regprocedure);
```
(Récupère la signature exacte via `pg_proc` — c'est un helper interne, arguments probablement `p_expense_id`/`p_amount`/`p_vat_amount`/etc.) Identifie la construction de la ligne DR charge et la ligne DR `EXPENSE_VAT_INPUT` conditionnée par `vat_amount > 0`. Modifie : ajoute `vat_amount` au débit de la charge, supprime la ligne 1151. Vérifie l'**équilibre** de la JE (ΣD = ΣC) après fold — le total crédité (AP ou cash) ne change pas, donc le DR charge doit absorber tout le `vat_amount`.

**Fichiers / migration.**
- Nouvelle migration `20260710000102_emit_expense_je_fold_vat_non_pkp.sql` (name `emit_expense_je_fold_vat_non_pkp`). Corps = `CREATE OR REPLACE FUNCTION public._emit_expense_je(…)` corrigé (in-place, helper interne, comportement corrigé du bug). Conserver les REVOKE existants sur le helper si présents (helper SECURITY DEFINER interne — vérifier les grants live et les re-poser à l'identique). **Pas de `BEGIN;`/`COMMIT;`.**
- Regen types (helper interne, diff probablement nul — committer si diff).

**Critères d'acceptation.**
- Une dépense avec `vat_amount > 0` s'approuve **sans erreur** ; sa JE est équilibrée ; le débit du compte de charge = `montant + vat_amount` ; **aucune ligne** ne référence le compte 1151 / `EXPENSE_VAT_INPUT`.
- Une dépense avec `vat_amount = 0` produit la même JE qu'avant (non-régression).
- `grep` du corps live post-fix : plus aucune occurrence de `EXPENSE_VAT_INPUT` ni `1151` dans `_emit_expense_je`.

**Tests.**
- **Tripwire** : re-passer la suite pgTAP **`supabase/tests/expenses.test.sql` INTACTE** (ne PAS la modifier — tripwire rouge assumé S58) via MCP `execute_sql`, `num_failed() = 0`.
- Si la suite ne couvre pas le cas `vat_amount > 0`, ajouter 1 assertion pgTAP prouvant l'approbation OK + JE équilibrée + absence de ligne 1151.

**Commit attendu.** `fix(expenses): session 59 — F-4 _emit_expense_je folds VAT into expense charge (ADR-003 NON-PKP)`

---

## Task 3: POS — respecter `visible_on_pos` (05 D1.1) + ticker écran client sur items réellement `ready` (16 D1.2)

> **Note de parallélisme :** cette tâche et la **Task 4 (KDS)** touchent toutes deux `apps/pos/` mais dans des dossiers distincts (`features/products` + `features/display` ici, `features/kds` là). Aucun fichier partagé — parallélisables, coordonner seulement au merge.

**Objectif.** Deux quick wins POS purement UI/lecture, sans migration.

### 3a — Filtre `visible_on_pos` dans la grille caisse (fiche 05 D1.1)
Le toggle BO `products.visible_on_pos` (éditable dans `GeneralPanel.tsx`) **n'a aucun effet** : `apps/pos/src/features/products/hooks/useProducts.ts` filtre uniquement sur `is_active` (≈ ligne 34). Ajouter `.eq('visible_on_pos', true)` aux requêtes produits **ET** variantes (les 2 requêtes du hook). Vérifier que la tablette (`apps/pos/src/features/tablet/`) et le KDS consomment le même hook ou, sinon, ne pas casser leur affichage (le KDS lit `order_items`, pas le catalogue — non impacté ; la tablette a son propre cache menu — vérifier `useTabletMenuCache`/grille tablette et appliquer le même filtre si elle lit `products` directement).

**Critères d'acceptation 3a.** Un produit dont `visible_on_pos = false` en BO **disparaît** de la grille caisse (et de la grille tablette si elle lit `products`). Un produit `visible_on_pos = true` reste visible. `is_active = false` reste exclu comme avant.

### 3b — Ticker « prêt » de l'écran client branché sur les items réellement `ready` (fiche 16 D1.2)
Le ticker de `/display` liste aujourd'hui les commandes **payées/complétées** des 15 dernières minutes (`apps/pos/src/features/display/hooks/useDisplayOrders.ts` ≈ l.44-49), pas les commandes **prêtes** en cuisine. Ajouter une source « Prêt à retirer » distincte : requête/subscription sur `order_items.kitchen_status = 'ready'` agrégée par commande, rendue dans une section dédiée du ticker.
- Fichiers : `apps/pos/src/features/display/hooks/useDisplayOrders.ts` (ou nouveau hook `useReadyOrders.ts`), `apps/pos/src/features/display/components/OrderQueueTicker.tsx`, éventuellement `CurrentOrderCard.tsx`.
- Réutiliser le pattern realtime existant du display : subscription `orders`/`order_items` + `useReconnectInvalidate` (voir `useDisplayRealtime.ts`). **Canal realtime à nom unique par mount** (StrictMode double-mount — cf. pattern `useKdsRealtime.ts`).
- `/display` reste **purement récepteur** : aucune écriture DB.

**Critères d'acceptation 3b.** Bumper un item en `ready` au KDS fait apparaître la commande dans la section « Prêt à retirer » de l'écran client **sans** paiement préalable. Le fil des commandes payées existant reste inchangé (section distincte).

**Tests.**
- Smoke POS : ajouter/étendre un smoke `apps/pos/src/features/products/__tests__/` prouvant que la grille masque un produit `visible_on_pos:false` (mock du hook). Suite : `pnpm --filter <pos> test products`.
- Smoke display : co-localisé `apps/pos/src/features/display/__tests__/`, prouvant le rendu de la section « ready » à partir d'items `kitchen_status:'ready'` mockés. Suite : `pnpm --filter <pos> test display`.
- `pnpm typecheck`.

**Commit attendu.** `feat(pos): session 59 — enforce visible_on_pos in cart grid + wire customer-display ready ticker`

---

## Task 4: KDS — câbler undo-bump / recall / prep-timer + alarme sonore nouvelle commande (04 D1.1 & D1.3)

> **Périmètre strict :** câblage des composants et RPCs **déjà présents** + alarme sonore. **NE PAS** faire le bump en masse « Tout prêt » (04 D1.2) — c'est le lot 2 (S60). Cette tâche est UI pure + lecture RPC (les RPCs existent déjà) — aucune migration.

**Objectif.** Monter les 3 composants KDS présents sur disque mais jamais importés, et ajouter l'alarme sonore.

**Contexte vérifié.**
- Composants présents (non importés hors tests) : `apps/pos/src/features/kds/components/BumpButton.tsx`, `UndoBumpToast.tsx`, `RecallButton.tsx`, `PrepTimer.tsx`. La carte est `apps/pos/src/features/kds/components/KdsOrderCard.tsx`. Store : `apps/pos/src/stores/kdsStore.ts`. Board : `apps/pos/src/features/kds/KdsBoard.tsx`.
- RPCs **déjà live** (migration `supabase/migrations/20260517000151_create_kds_recall_bump_rpcs.sql`) : `kds_bump_item_v1`, `kds_undo_bump_v1`, `kds_recall_order_v1`, `kds_start_prep_timer_v1`. Colonne `order_items.prep_started_at` existe (`20260517000150/151`). **Vérifier les signatures live** avant câblage : `SELECT pg_get_functiondef('public.kds_bump_item_v1(<args>)'::regprocedure);` etc. (ou lire la migration `_151`).

**Travail.**
1. **Undo-bump 60 s** : remplacer le CTA `Bump Ready` de `KdsOrderCard.tsx` par `BumpButton` (appelle `kds_bump_item_v1`, affiche `UndoBumpToast` pendant 60 s appelant `kds_undo_bump_v1`). Créer les hooks manquants si besoin (`useKdsBump`/`useKdsUndoBump`) sur le modèle de `useBumpItem.ts` existant.
2. **Recall d'une commande servie** : monter `RecallButton` sur les cartes servies (dialog + raison → `kds_recall_order_v1`).
3. **Prep-timer serveur** : monter `PrepTimer` sur le CTA `Start` (appelle `kds_start_prep_timer_v1`, écrit `order_items.prep_started_at`), afficher le timer sur les items démarrés.
4. **Alarme sonore nouvelle commande** (fiche 04 D1.3 / B1.3-B1.4) : émettre un bip **WebAudio** (pas d'asset externe) quand une **nouvelle commande** entre sur le board (et/ou quand une carte passe en bande `urgent` — voir fiche 04 D1.1 #1). Toggle **mute** persisté dans `kdsStore`, visible dans le header KDS. Un seul son par événement (dédup — ne pas re-sonner à chaque refetch/poll). Fichiers : nouveau hook `apps/pos/src/features/kds/hooks/useKdsAlarm.ts`, `KdsBoard.tsx`, `kdsStore.ts`.

**Décision tranchée dans ce plan :** l'alarme sonne sur **nouvelle commande entrante** (l'événement demandé par la doc « faire sonner la caisse/cuisine »). Le déclenchement additionnel sur passage en bande `urgent` (04 D1.1 #1) peut être inclus si trivial, mais le critère minimal = son à l'arrivée d'une nouvelle commande.

**Critères d'acceptation.**
- Après un bump, un toast d'undo est visible 60 s et l'undo restaure l'item (`preparing`).
- `RecallButton` accessible sur une commande servie ; le recall (avec raison) ramène la commande.
- Le prep-timer s'affiche sur les items démarrés (basé sur `prep_started_at`).
- Un bip est émis à l'arrivée d'une nouvelle commande ; le toggle mute (persisté) le coupe ; pas de spam au poll/refetch.
- Aucune régression du cycle Start → Bump Ready → Mark Served existant, ni du filtrage par poste.

**Tests.**
- Étendre/ajouter les tests co-localisés `apps/pos/src/features/kds/components/__tests__/` (les composants ont déjà des tests — les brancher au montage réel). Vérifier le montage de `BumpButton`/`RecallButton`/`PrepTimer` dans `KdsOrderCard`.
- Test du hook `useKdsAlarm` (dédup + mute). Mocker WebAudio.
- Suite : `pnpm --filter <pos> test kds`. `pnpm typecheck`.

**Commit attendu.** `feat(kds): session 59 — wire undo-bump/recall/prep-timer + new-order audio alarm`

---

## Task 5: Tablette — note par commande (17 D1.1)

**Objectif.** Permettre au serveur de saisir une **note libre au niveau commande** sur la tablette (« sans gluten », allergie), la persister dans `orders.notes` (colonne existante, jamais alimentée par la tablette aujourd'hui) et l'afficher côté KDS + pickup caisse.

**Contexte vérifié.** Aucun champ note aujourd'hui : ni dans `tabletCartStore`, ni dans `buildSubmitPayload` (`packages/domain/src/tablet/buildSubmitPayload.ts` — product_id/quantity/unit_price/modifiers seulement), et `create_tablet_order_v2` (`supabase/migrations/20260602000011_bump_create_tablet_order_v2.sql`) **n'accepte pas de note** (vérifié : pas de `p_notes`/`p_note`). `orders.notes` existe déjà. La **note par ligne** (`order_items.note`) est un chantier moyen (17 D2.1) — **HORS périmètre**, ne faire que la note par commande.

**Décision tranchée dans ce plan :** l'ajout d'un argument implique un **bump RPC** → créer **`create_tablet_order_v3`** avec un argument supplémentaire `p_notes text DEFAULT NULL`, écrivant `orders.notes`, et **`DROP FUNCTION create_tablet_order_v2(<args>)` dans la même migration** (versioning monotone). Reproduire le REVOKE anon de `20260602000012_revoke_anon_create_tablet_order_v2.sql` pour v3 (défense-in-depth anon : `REVOKE EXECUTE … FROM PUBLIC` + `FROM anon`).

**Procédure.** Récupère le corps live de v2 (`SELECT pg_get_functiondef('public.create_tablet_order_v2(<args>)'::regprocedure);`), ajoute `p_notes` en dernier argument, insère `notes = p_notes` dans l'`INSERT INTO orders`. Garde toute la mécanique idempotence (`p_client_uuid` + `tablet_order_idempotency_keys`) inchangée.

**Fichiers / migration.**
- `20260710000103_create_tablet_order_v3_notes.sql` : `CREATE FUNCTION create_tablet_order_v3(… , p_notes text DEFAULT NULL)` + `DROP FUNCTION create_tablet_order_v2(<args>)`. **Pas de `BEGIN;`/`COMMIT;`.**
- `20260710000104_revoke_anon_create_tablet_order_v3.sql` : trio REVOKE (miroir de `_000012`).
- Regen types → `packages/supabase/src/types.generated.ts`.
- Domain : `packages/domain/src/tablet/buildSubmitPayload.ts` (propager la note ; rester **IO-free**).
- POS : textarea de note dans `apps/pos/src/features/tablet/` (panneau panier tablette, ex. `TabletCartPanel.tsx`) → `tabletCartStore.ts` → `apps/pos/src/features/tablet/hooks/useCreateTabletOrder.ts` (passer `p_notes`, repointer v2 → **v3**).
- Affichage : la note sur `KdsOrderCard.tsx` (lire `orders.notes` sur la carte) et sur l'écran de pickup caisse (`usePickupTabletOrder` / panier caisse).

**Critères d'acceptation.**
- Une note saisie sur la tablette est persistée dans `orders.notes` et **visible en cuisine** (KDS) et au pickup caisse.
- Aucune commande tablette ne casse (idempotence `p_client_uuid` intacte : double-tap → 1 seule commande).
- Aucun call-site ne référence encore `create_tablet_order_v2`.

**Tests.**
- pgTAP : suite ciblée (nouvelle ou étendue) prouvant que v3 écrit `orders.notes` et que v2 est droppée ; rejouer via MCP `execute_sql`, `num_failed() = 0`.
- Domain : test co-localisé `packages/domain/src/tablet/__tests__/` sur `buildSubmitPayload` incluant la note. `pnpm --filter @breakery/domain test tablet`.
- POS smoke : `apps/pos/src/features/tablet/__tests__/` (saisie note → payload). `pnpm --filter <pos> test tablet`.
- `pnpm typecheck`.

**Commit attendu.** `feat(tablet): session 59 — order-level note (create_tablet_order_v3) surfaced on KDS + pickup`

---

## Task 6: BO — drill-down JE→origine (10) + bouton « Dupliquer » dépense (11) + filtres & avant/après journal d'audit (01)

> Tâche BackOffice pure (apps/backoffice), sans migration. Trois quick wins indépendants regroupés.

### 6a — Drill-down JE → opération d'origine (fiche 10 D1.1)
Aujourd'hui le drawer d'écriture affiche `Source : <reference_type>` en **texte mort** (`apps/backoffice/src/features/accounting/…/JournalEntryDetailDrawer.tsx` ≈ l.39) ; `reference_id` est retourné mais sans lien. Transformer `reference_type`/`reference_id` en **lien de navigation** vers l'opération d'origine, dans `JournalEntryDetailDrawer.tsx` **et** `GeneralLedgerPage.tsx`. Mapping cible :
- `sale` / `void` / `refund` → OrderDetailDrawer ou `orders?focus=<id>`
- `expense` / `expense_payment` → `/expenses/:id`
- `b2b_*` → onglet Invoices B2B
- `cash_movement` → page Treasury
Réutiliser l'infra `buildDrilldownUrl` existante (déjà utilisée côté rapports) plutôt que de recoder les URLs.

**Critère 6a.** Cliquer « Source » sur une écriture ouvre l'opération correspondante (commande, dépense, paiement, mouvement cash).

### 6b — Bouton « Dupliquer » une dépense (fiche 11 D1.1)
Depuis `apps/backoffice/src/pages/expenses/ExpenseDetailPage.tsx`, ajouter un bouton « Dupliquer » qui navigue vers `NewExpensePage` **pré-remplie** (montant, catégorie, fournisseur, mode de paiement) avec **date = aujourd'hui** et **sans** justificatif (receipt). Passer les valeurs par état de navigation ou query params ; `NewExpensePage.tsx` lit ces valeurs pour initialiser `ExpenseForm`. Le résultat est un **brouillon** (`draft`) — ne pas soumettre automatiquement.

**Critère 6b.** Deux clics (Dupliquer → Enregistrer) créent le brouillon de la dépense suivante avec les champs recopiés, date du jour, sans receipt.

### 6c — Filtres + affichage avant/après du journal d'audit (fiche 01 D1.1 #2)
La page Audit Log (`apps/backoffice/src/pages/reports/AuditPage.tsx` ≈ l.59-96) n'affiche **ni filtres ni le détail avant/après** : seulement timestamp/action/entity/actor. Le hook `useAuditLogs.ts` (≈ l.21-26) **accepte déjà** des filtres `actor`/`action`/`entity` jamais exposés. Travail :
- Brancher un composant de filtres (`AuditLogFilters` — le créer s'il n'existe pas) sur les filtres déjà supportés par `useAuditLogs`.
- Rendre le **détail dépliable** du `payload` (diff before/after, colonne JSONB S19) et/ou `metadata` sur chaque ligne. Vocabulaire canonique confirmé : `audit_logs.payload` (diff before/after) et `audit_logs.metadata` (contexte free-form) — **ne pas fusionner** (dualité voulue). S'inspirer du `HistoryPanel` produit qui rend déjà l'avant/après.

**Critère 6c.** Le scénario « qu'a fait Made cette semaine ? » est jouable : filtrer par actor/action/entity, et déplier une ligne montre l'avant/après. (Rappel RLS `audit_logs` = admin_read : un MANAGER voit un journal vide — comportement attendu, hors périmètre.)

**Tests.**
- Smokes BO co-localisés : `apps/backoffice/src/features/accounting/__tests__/` (le lien drill-down construit la bonne URL), `apps/backoffice/src/pages/expenses/__tests__/` (duplicate pré-remplit), `apps/backoffice/src/pages/reports/__tests__/` (filtres passés au hook + rendu du payload déplié).
- Suites : `pnpm --filter <backoffice> test accounting`, `… test expenses`, `… test audit`. `pnpm typecheck`.

**Commit attendu.** `feat(backoffice): session 59 — JE drilldown to source + duplicate expense + audit-log filters & before/after`

---

## Task 7: Nettoyage — doublon suggestions production (15 D1.1) + purge des hex codés en dur (22 D1.1)

> Tâche de nettoyage, sans migration DB. Deux volets indépendants.

### 7a — Résorber le doublon « suggestions de production » (fiche 15 D1.1)
Le composant `apps/backoffice/src/features/inventory-production/components/ProductionSuggestions.tsx` + son hook `useProductionSuggestions.ts` + le RPC `get_production_suggestions_v1` (`20260517000065`) forment un **doublon orphelin** : le chemin réel des suggestions vit dans la page Planning (`ProductionSchedulePage.tsx` via `suggest_production_schedule_v1`). Le composant/hook ne sont **importés nulle part** (vérifié : seuls composant + hook se référencent).

**Décision tranchée dans ce plan : PURGER l'UI orpheline** (composant + hook), plus lisible qu'un second chemin de suggestions.
- Supprimer `ProductionSuggestions.tsx` et `useProductionSuggestions.ts` (+ leurs tests co-localisés éventuels).
- **RPC `get_production_suggestions_v1` : le GARDER si consommé ailleurs, sinon le laisser dormant.** **Vérifier d'abord** son usage : `grep -rn "get_production_suggestions_v1" apps/ packages/ supabase/functions/`. S'il n'a **aucun** call-site hors le hook supprimé → le laisser en place (ne PAS DROP en Vague 1 : un DROP de RPC est une migration à risque, différer à un décommissionnement dédié) mais le noter dans le rapport. **Ne pas créer de migration pour ce volet.**

**Critère 7a.** `grep -rn "ProductionSuggestions\|useProductionSuggestions" apps/` → 0 hit hors historique git. Un seul chemin de suggestions subsiste (Planning). Build BO vert.

### 7b — Purge des couleurs hex codées en dur (fiche 22 D1.1 / B2.1)
Remplacer les hex `#rrggbb` codés en dur par les tokens du design system / le helper centralisé `chartColors.ts`. **Cibles réelles à purger** (identifiées fiche 22) :
`SalesVelocityChart.tsx`, `StockAnalyticsPanel.tsx`, les 3 composants suppliers concernés, `AnalyticsTab.tsx` (customers), `RecipeCostTimelinePage.tsx`, `SalesByCategoryPage.tsx`, `SalesByHourPage.tsx` (tous sous `apps/backoffice/src` ; localiser par grep). **À NE PAS toucher** (légitimes/centralisés) : `apps/backoffice/src/features/reports/utils/chartColors.ts`, `apps/pos/src/features/products/categoryTints.ts`, et les 4 smoke tests contenant des hex.
- Les couleurs de graphes → consommer `chartColors.ts` ; les autres → tokens sémantiques (`semantic.css` : success/warning/danger/info) ou classes Tailwind du preset (`packages/ui/tailwind-preset.ts`).

**Critère 7b.** `grep -rn "#[0-9a-fA-F]\{6\}" apps/backoffice/src apps/pos/src` ne retourne plus que les fichiers centralisés (`chartColors.ts`, `categoryTints.ts`) + les smoke tests. Rendu visuel inchangé (les tokens mappent les mêmes teintes). Le lint-ratchet CI (bloquant sur fichiers touchés) reste vert.

**Tests.**
- `pnpm --filter <backoffice> test` sur les features touchées ; `pnpm build` (les 2 apps) ; `pnpm typecheck`.
- Vérifier qu'aucun snapshot/smoke ne casse sur les couleurs.

**Commit attendu.** `refactor(backoffice): session 59 — drop orphan production-suggestions UI + purge hardcoded hex to tokens`

---

## Task 8: EF sécurité — `auth-change-pin` lit les PINs en headers (25 D1.1)

**Objectif.** Étendre la règle S25 « secret en header, jamais en body JSON » à l'EF `auth-change-pin` : les PINs `current_pin` / `new_pin` transitent aujourd'hui en **body JSON** (`supabase/functions/auth-change-pin/index.ts` ≈ l.36) — bodies loggables par PostgREST/pgaudit/proxies. **Hard cutover dans le même commit** (drop du champ body + lecture header côté EF + mise à jour du call-site client), pas de dual-mode.

**Pattern de référence (S25).** Voir comment les manager-PIN EFs lisent le header : `supabase/functions/refund-order/index.ts` lit `x-manager-pin` ; helper CORS partagé `supabase/functions/_shared/cors.ts` (les 6 fichiers qui référencent `x-manager-pin`). Réutiliser le même style : lire depuis un header dédié, ajouter le header à l'allowlist CORS (`_shared/cors.ts`).

**Décision de nommage tranchée dans ce plan :** headers **`x-current-pin`** (rotation self-service) et **`x-new-pin`** (nouveau PIN). L'admin-override (sans `current_pin`) omet simplement `x-current-pin`.

**Travail.**
- EF `supabase/functions/auth-change-pin/index.ts` : lire `current_pin`/`new_pin` depuis `req.headers` (`x-current-pin`/`x-new-pin`) au lieu du body JSON. Supprimer ces champs du parse du body. Conserver la validation regex `^\d{6}$` (PIN 6 chiffres — aligné S58), le rate-limit durable par compte cible, le reset lockout, l'audit `pin.change_self`/`pin.change_admin`, et le retour `evaluatePinStrength`.
- CORS : ajouter `x-current-pin`, `x-new-pin` à l'`Access-Control-Allow-Headers` (`_shared/cors.ts`).
- Call-site client : `packages/supabase/src/auth/pinAuth.ts` fonction `changePin` (≈ l.203-208) — déplacer `current_pin`/`new_pin` du body vers les headers de la requête `fetch`. Mettre à jour le type `ChangePinBody` (l.180-186) en conséquence. Vérifier tout autre appelant BO/POS de `changePin` (grep) — l'API du wrapper `changePin` peut rester identique côté signature JS, seul le transport HTTP change.

**Critères d'acceptation.**
- Un changement de PIN self-service (avec ancien PIN) et un admin-override (sans ancien PIN) fonctionnent via headers.
- **Aucun PIN dans le body JSON** de `auth-change-pin` (ni côté EF, ni côté client). `grep current_pin\|new_pin` dans le corps de requête → 0.
- Rate-limit, lockout reset, audit et détection PIN faible inchangés.

**Tests.**
- Test EF si présent (`supabase/functions/auth-change-pin/__tests__/` ou équivalent Deno) : adapter aux headers. Sinon, test du wrapper client `packages/supabase/src/auth/__tests__/pinAuth` prouvant que `changePin` envoie les PINs en headers et non en body.
- `pnpm typecheck`. Note : l'EF Deno ne passe pas par turbo — vérifier manuellement le parse header + relire la logique.

**Commit attendu.** `fix(auth): session 59 — auth-change-pin reads PINs from x-current-pin/x-new-pin headers (S25 hard cutover)`

---

## Task 9: LAN — câbler les heartbeats appareils (21 D1.1)

**Objectif.** Rendre vivante la page BO « LAN Devices » : aujourd'hui `useLanHeartbeat` + le RPC `update_lan_heartbeat_v1` existent mais **aucun poste n'émet de heartbeat** → la page affiche tout « stale » en permanence. **Sans** ressusciter le mesh LAN mort (décision d'architecture 2 non tranchée) : le simple appel RPC périodique suffit.

**Contexte vérifié.** `apps/pos/src/features/lan/hooks/useLanHeartbeat.ts` existe (tick vers `update_lan_heartbeat_v1`). RPC `update_lan_heartbeat_v1` : migration `supabase/migrations/20260517000171_init_lan_devices.sql` (table `lan_devices`, statut online = heartbeat < 60 s). La page BO : `apps/backoffice/src/pages/lan-devices/LanDevicesPage.tsx` (gate `lan.devices.read`). **Vérifier la signature live** du RPC avant câblage (`pg_get_functiondef`). **Aucune migration** — le RPC existe.

**Travail.**
- Monter `useLanHeartbeat` sur les surfaces POS/KDS/tablette avec le **device-code du terminal** (résolu depuis `posSettingsStore` — vérifier le champ existant, ex. printer/device identifiant ; si aucun device-code par terminal n'existe, utiliser l'identifiant d'appareil déjà persisté pour l'appairage/impression). Points de montage : shell POS commun (`apps/pos/src/pages/Pos.tsx` ou layout racine), `apps/pos/src/pages/Kds.tsx`, `apps/pos/src/pages/tablet/TabletLayout.tsx`.
- **Ne PAS** monter `useLanHub`/`useLanClient`/`lanHubMessageHandler` (mesh mort — hors périmètre, décision 2 gelée). Seul l'appel RPC de heartbeat est câblé.
- Vérifier que le tick (≈ 10 s dans le hook) n'introduit pas de fuite realtime ni de re-render excessif ; nettoyage à l'unmount.

**Critères d'acceptation.**
- Une fois un terminal POS/KDS/tablette ouvert, la page BO « LAN Devices » montre ce terminal **online** (heartbeat < 60 s), et « stale » après arrêt.
- Le mesh LAN reste non monté (aucun nouveau call-site `useLanHub`/`useLanClient`).

**Tests.**
- Smoke POS co-localisé prouvant que le hook `useLanHeartbeat` est monté et appelle le RPC (mock du client Supabase). `pnpm --filter <pos> test lan` (ou le nom de la suite existante `lan_devices`).
- Vérifier manuellement (ou via test BO) que `LanDevicesPage` reflète un heartbeat récent. `pnpm typecheck`.

**Commit attendu.** `feat(lan): session 59 — emit device heartbeats from POS/KDS/tablet so LAN Devices page shows live status`

---

## Ordonnancement & parallélisme

- **D'abord (priorité) :** Task 1 (F-1 **P0**) puis Task 2 (F-4 **P1**) — ce sont les tripwires rouges du S58 ; les suites `users`/`expenses` doivent redevenir vertes. Indépendantes l'une de l'autre (DB, fichiers disjoints) → parallélisables entre elles.
- **Ensuite, en parallèle (aucun chevauchement de fichiers) :** Task 5 (tablette), Task 6 (BO), Task 7 (nettoyage), Task 8 (EF auth), Task 9 (LAN).
- **Attention chevauchement POS :** Task 3 (products + display) et Task 4 (KDS) sont toutes deux dans `apps/pos/` mais dans des dossiers **disjoints** (`features/products` + `features/display` vs `features/kds`). Parallélisables ; coordonner seulement au moment du merge/typecheck global. Task 9 monte aussi des hooks dans des shells POS (`Pos.tsx`, `Kds.tsx`, `TabletLayout.tsx`) — léger recouvrement de points de montage avec T3/T4/T5 : si exécution parallèle, séquencer T9 après T3/T4/T5 OU coordonner les éditions de `Kds.tsx`/`TabletLayout.tsx`.
- **Migrations pré-assignées** (évite les collisions en parallèle) : T1 = `20260710000101`, T2 = `20260710000102`, T5 = `20260710000103` + `20260710000104`. T3/T4/T6/T7/T8/T9 = **aucune migration**.

## Closeout (à faire après les 9 tâches)
- Regen types final si divergence (T1/T2/T5 ont touché des RPCs). `pnpm typecheck` full + ciblés.
- Re-passer les tripwires `users.test.sql` + `expenses.test.sql` verts (preuve `num_failed()=0`).
- Écrire l'INDEX `docs/workplan/plans/2026-07-04-session-59-INDEX.md` (format INDEX standard).
- Bumper `CLAUDE.md` §Active Workplan (S59 = current, S58 → previous) + « Migration sequence active » (bloc `20260710000101..104`).
- Cocher dans `docs/workplan/remise-a-plat/00-INDEX.md` §3 Vague 1 les items « UI pures » soldés, et §2.3 les entrées ⚫ câblées (#1/#2/#3 KDS, #8 heartbeats, #11 suggestions, #21 visible_on_pos).
