# Plan — POS double-print risk (path legacy print-queue vs bridge S34) (V1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **⚠ DÉPENDANCE D'ORDONNANCEMENT BLOQUANTE** — La Phase 2 (dépréciation du path legacy `enqueue_print_job_v1('kitchen_chit')`) NE DOIT PAS être exécutée tant que le print-bridge multi-imprimantes (Path A S34) n'est **pas opérationnel**. Déprécier Path B avant que Path A imprime réellement = **cuisine sans aucune impression sur bump**. Voir Phase 0 (gate de dépendance) et la spec [`pos-print-bridge-deploy`](../specs/2026-06-01-pos-print-bridge-deploy-spec.md). Le typage (Phase 1) est en revanche **inconditionnel** et peut être livré immédiatement.

**Goal:** Éliminer le risque de double-impression de tickets cuisine post-S34 en (1) typant correctement le client Supabase de `lanHubMessageHandler.ts` (immédiat, sans risque), puis (2) dépréciant le path legacy `enqueue_print_job_v1('kitchen_chit')` du `kds.bump` **une fois le bridge S34 déployé** — pour que l'impression cuisine passe par un seul chemin canonique (le bridge direct S34).

**Type:** clarification d'architecture + dépréciation conditionnelle + typage. Hors cycle session numéroté.

**Spec:** [`../specs/2026-06-01-pos-double-print-risk-spec.md`](../specs/2026-06-01-pos-double-print-risk-spec.md)
**Branch:** `fix/pos-double-print-risk` (à créer depuis `master` @ `70c5cf1`)
**Effort:** S-M (~0.5-1 jour de code repo ; Phase 2 gatée sur dépendance externe)
**Aucune migration DB.** L'RPC `enqueue_print_job_v1` reste en place côté DB (utilisée par `print.request` génériques) ; la dépréciation est purement côté client.

---

## Contexte vérifié (preuve `fichier:ligne`)

- **Path A (S34, canonique)** — bridge direct : `useFireToStations` → `printStationTicket` (`apps/pos/src/services/print/printService.ts`) POST `/print/ticket`. Câblé dans `PaymentTerminal` auto-fire (`PaymentTerminal.tsx:194`) + `SendToKitchenButton`.
- **Path B (S13 legacy, à arbitrer)** — print-queue DB : `lanHubMessageHandler.ts:99-117`. Sur `kds.bump` avec `new_status === 'preparing'`, appelle `enqueue_print_job_v1` avec `ticket_type: 'kitchen_chit'` (`:100-112`). **Path actif** : `handleLanMessage` câblé via `lanHub.ts` (`onMessage` → `handleLanMessage`) monté par `useLanHub` (`apps/pos/src/features/lan/hooks/useLanHub.ts:45-51`).
- **Typage `any`** — `lanHubMessageHandler.ts:13-14` : `type SupabaseClient = any`. Conséquence : `as never` sur les appels RPC (`:107`, `:112`, `:133`, `:176`) + `ctx.supabase.rpc(...)` non type-checké.
- **`print.request` générique** (`handlePrintRequest`, `:120-156`) — distinct du chit auto du bump ; il enqueue aussi via `enqueue_print_job_v1` (`:126`) mais pour des jobs explicites (≠ kitchen_chit auto). **À conserver** (hors décision de dépréciation, sauf clarification contraire en Phase 0).
- **Type Supabase disponible** — `@breakery/supabase` exporte `Database` (`packages/supabase/src/index.ts:9`) mais **PAS** `SupabaseClient`. Le type de client est `SupabaseClient<Database>` depuis `@supabase/supabase-js` (cf. `packages/supabase/src/client.ts:1,4`).
- **Précédent dans le même dossier** — `lanHub.ts:31-34` utilise délibérément `type SupabaseClient = any` + `type RealtimeChannel = any` pour **ne pas prendre de dép directe sur `@supabase/supabase-js` dans l'app** (commentaire `:28-30`). Cette tension doit être tranchée dans le plan (voir Phase 1.1).

---

## File Structure (overview)

### Changed (typage — Phase 1)
```
apps/pos/src/features/lan/lanHubMessageHandler.ts   (type SupabaseClient = any → SupabaseClient<Database> ; retirer as never possibles)
```

### Changed (dépréciation conditionnelle — Phase 2, GATÉE)
```
apps/pos/src/features/lan/lanHubMessageHandler.ts   (retirer/feature-flag le bloc kitchen_chit :99-117)
```

### New (tests)
```
apps/pos/src/features/lan/__tests__/lan-hub-typed-client.test.ts        (NEW — Phase 1, type-level + runtime smoke)
apps/pos/src/features/lan/__tests__/lan-hub-no-kitchen-chit.smoke.test.tsx (NEW — Phase 2, GATÉE)
```

### Tests existants (non-régression)
```
apps/pos/src/features/lan/__tests__/lanHub.dedup.test.ts
apps/pos/src/features/lan/__tests__/useLanHub.uniqueChannel.test.tsx
apps/pos/src/features/cart/__tests__/fire-to-stations.smoke.test.tsx   (Path A intact)
```

---

## Phase 0 — Décision canonique + gate de dépendance (BLOQUANT)

> Cette phase n'écrit pas de code. Elle tranche la décision transverse et matérialise la dépendance d'ordonnancement avant toute dépréciation.

- [ ] **P0.1** Créer `fix/pos-double-print-risk` depuis `master` @ `70c5cf1` ; committer spec + plan (`docs(workplan): pos double-print risk — spec + plan`).
- [ ] **P0.2 — RATIFICATION (escalade requise, impact transverse impression).** Faire ratifier par le user/business la **décision canonique** :
  - **Option recommandée (défaut spec §2.A)** : Path A (bridge direct S34) est canonique → **déprécier** le `enqueue_print_job_v1('kitchen_chit')` du `kds.bump` (`lanHubMessageHandler.ts:99-117`). Le KDS écran (S35) gère le bump à l'écran, pas l'impression.
  - **Alternative** : garder Path B (print-queue durable) avec garde anti-double — plus complexe, non recommandé.
  - Documenter la décision retenue (ce fichier §Deviations + INDEX).
- [ ] **P0.3 — CLARIFIER le sort de `print.request` générique** (`handlePrintRequest`, `:120-156`). Par défaut : **conservé** (jobs explicites, ≠ chit auto du bump). Confirmer que la décision P0.2 ne l'englobe pas. Tracer la réponse.
- [ ] **P0.4 — GATE DE DÉPENDANCE (critique).** Vérifier l'état du plan/spec [`pos-print-bridge-deploy`](../specs/2026-06-01-pos-print-bridge-deploy-spec.md). **La Phase 2 ne démarre QUE si l'un des deux est vrai** :
  - (a) Le print-bridge multi-imprimantes est **déployé et joignable** (les 5 imprimantes enregistrées dans `lan_devices`, `printStationTicket` POST réel vers `/print/ticket` confirmé fonctionnel — critère d'acceptation §3 du plan print-bridge, repro réel : 1 commande mixte → 3 tickets prep + reçu) ; **OU**
  - (b) La dépréciation Phase 2 est livrée **derrière un feature-flag explicitement OFF** (le bloc kitchen_chit reste exécutable tant que le flag n'est pas activé), de sorte qu'aucune impression cuisine ne disparaît avant que le bridge soit prouvé opérationnel. L'activation du flag = action ops post-déploiement bridge.

  > **Si ni (a) ni (b) ne sont satisfaits → STOP Phase 2.** Ne livrer que la Phase 1 (typage). Re-documenter la dépendance non levée dans l'INDEX (deviation + follow-up). Déprécier Path B « en dur » sans bridge prouvé = régression P0 « cuisine muette ».

---

## Phase 1 — Typage du client Supabase (INCONDITIONNEL, sans risque)

> Indépendant de la dépendance bridge. Peut être mergé seul si la Phase 2 reste gatée.

- [ ] **P1.1 — Trancher le typage vs le précédent `lanHub.ts` `any`.** `lanHub.ts:28-34` évite délibérément la dép directe `@supabase/supabase-js`. Deux options :
  - **Option A (recommandée)** : importer `SupabaseClient` depuis `@supabase/supabase-js` + `Database` depuis `@breakery/supabase`, typer `type SupabaseClient = SupabaseClientGeneric<Database>` (alias local pour éviter le shadowing du nom). `apps/pos` dépend déjà transitivement de `@supabase/supabase-js` via `@breakery/supabase` ; vérifier qu'il est résoluble en import direct (sinon l'ajouter en devDependency `apps/pos`).
  - **Option B (minimale, si A introduit une dép indésirable)** : exporter un type `TypedSupabaseClient = SupabaseClient<Database>` depuis `@breakery/supabase` (`packages/supabase/src/index.ts`) et l'importer dans le handler. Évite la dép `@supabase/supabase-js` directe côté app, cohérent avec le découplage voulu par `lanHub.ts`.

  **Trancher A vs B et le documenter.** Recommandation : **Option B** (centralise le type côté package, cohérent avec le découplage `lanHub.ts`, réutilisable pour typer aussi `lanHub.ts` plus tard).
- [ ] **P1.2** Remplacer `lanHubMessageHandler.ts:13-14` :
  ```ts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type SupabaseClient = any;
  ```
  par le client typé retenu en P1.1. Retirer le `eslint-disable`.
- [ ] **P1.3** Retirer les `as never` rendus inutiles par le bon typage, **un par un**, en vérifiant que le typecheck passe à chaque retrait :
  - `:107` `p_payload: {...} as never` (kitchen_chit) — peut disparaître si Phase 2 supprime le bloc ; sinon typer le payload.
  - `:112` `} as never)` (args de `enqueue_print_job_v1`).
  - `:133` `} as never)` (args de `print.request`).
  - `:176` `} as never)` (args de `update_lan_heartbeat_v1`).
  Si un `as never` persiste parce qu'un RPC n'est pas dans `types.generated.ts`, voir P1.4. Ne PAS introduire de nouveau `eslint-disable` pour contourner.
- [ ] **P1.4 — Vérifier la présence des RPCs LAN dans les types générés.** Les 3 RPCs consommés ici : `enqueue_print_job_v1`, `update_lan_heartbeat_v1` (et `claim_print_job_v1` côté print server, hors handler). Confirmer leur présence dans `packages/supabase/src/types.generated.ts` (Grep). Si l'un manque → une migration n'a pas été suivie d'un regen : regen via MCP `mcp__plugin_supabase_supabase__generate_typescript_types` (project `ikcyvlovptebroadgtvd`), écrire dans `types.generated.ts`, commit. Noter la déviation. (Attendu : présents depuis S13 — confirmer.)
- [ ] **P1.5** Test typage `lan-hub-typed-client.test.ts` : un mock de `ctx.supabase` typé `SupabaseClient<Database>` + assertion runtime que `handleHeartbeat` / `handlePrintRequest` appellent `.rpc('update_lan_heartbeat_v1'|'enqueue_print_job_v1', ...)` avec le bon shape (mock `rpc` retournant `{ data, error }`). Le bénéfice premier est compile-time : un mauvais nom d'RPC doit désormais faire échouer le typecheck.
- [ ] **P1.6** `pnpm --filter @breakery/app-pos typecheck` PASS — **sans nouveaux `eslint-disable`** (critère d'acceptation spec §3).

---

## Phase 2 — Dépréciation du path legacy kitchen_chit (GATÉE sur P0.4)

> **NE PAS DÉMARRER si P0.4 n'est pas satisfaite.** Si gate non levée → sauter à Phase 3 avec Phase 1 seule + follow-up tracé.

- [ ] **P2.1 — Selon l'option P0.4 retenue :**
  - **Si (a) bridge déployé** : retirer le bloc `lanHubMessageHandler.ts:99-117` (le `if (msg.payload.new_status === 'preparing') { enqueue_print_job_v1('kitchen_chit') }`). Conserver les `invalidateQueries(['kds'])` / `(['orders'])` (`:96-97`) — le bump rafraîchit toujours les caches downstream. Conserver `handlePrintRequest` (`print.request` génériques).
  - **Si (b) feature-flag OFF** : envelopper le bloc dans un flag (ex. `import.meta.env.VITE_LEGACY_KITCHEN_CHIT === '1'`, défaut absent/OFF). Documenter le flag + son cycle de vie (à retirer définitivement une fois le bridge stabilisé en prod).
- [ ] **P2.2** Mettre à jour le commentaire mensonger `lanHubMessageHandler.ts:92-95` (« We also enqueue a kitchen-chit print job… ») pour refléter la décision : impression cuisine = bridge direct S34 (Path A) ; le bump ne fait plus que rafraîchir les caches. Référencer la décision P0.2.
- [ ] **P2.3 Test `lan-hub-no-kitchen-chit.smoke.test.tsx`** : construire un `kds.bump` `new_status='preparing'`, appeler `handleLanMessage(msg, ctx)` avec `ctx.supabase.rpc` mocké, **assert que `rpc` n'est PAS appelé avec `('enqueue_print_job_v1', { ... ticket_type: 'kitchen_chit' ... })`** (cas (a)). Pour le cas (b) flag OFF : même assertion avec flag absent ; + un cas flag ON qui ré-enqueue (preuve que le flag fonctionne).
- [ ] **P2.4 Non-régression handlers restants** : `print.request`, `heartbeat`, `order.update`, `kds.recall/undo`, `print.result` restent fonctionnels. Couvrir via le nouveau test ou les tests lan existants (`lanHub.dedup.test.ts`, `useLanHub.uniqueChannel.test.tsx`) — vérifier qu'ils restent verts.
- [ ] **P2.5 Non-régression Path A S34** : `apps/pos/src/features/cart/__tests__/fire-to-stations.smoke.test.tsx` reste vert (le bridge direct est intact, on ne touche qu'au path legacy).

---

## Phase 3 — Vérification globale + closeout

- [ ] **P3.1**
  ```
  pnpm --filter @breakery/app-pos typecheck
  pnpm --filter @breakery/app-pos test lan
  pnpm --filter @breakery/app-pos test cart
  ```
  Baseline env-gated pré-existante tolérée (DEV-S25-2.A-02 `VITE_SUPABASE_URL Required`) — ne pas confondre avec une régression.
- [ ] **P3.2** INDEX `docs/workplan/plans/2026-06-01-pos-double-print-risk-INDEX.md` : Summary, Files modified (`lanHubMessageHandler.ts` typage + [dépréciation si Phase 2 livrée]), Tests run (tableau), **§Deviations** (au minimum : décision canonique P0.2 retenue ; état de la gate P0.4 = levée/non-levée ; option A/B typage P1.1 ; flag introduit le cas échéant), **§Dependency** (relation explicite avec `pos-print-bridge-deploy`), Acceptance checklist. **Pas de section Migrations/Permissions** (N/A).
- [ ] **P3.3** CLAUDE.md : hors cycle session numéroté. Bump léger sous "Active Workplan" : noter la décision canonique impression (Path A bridge S34 = chemin unique cuisine ; Path B kitchen_chit déprécié/flaggé) + la dépendance levée ou non sur le bridge. **Mettre à jour la note DEV-S34-W0-02** (bridge déféré) si la gate a été levée. Pas de "Migration sequence active" (aucune migration).
- [ ] **P3.4** PR `fix/pos-double-print-risk` → `master`. Titre selon le scope livré :
  - Phase 1 seule : `fix(pos): type lanHub Supabase client (remove SupabaseClient = any + as never)`
  - Phases 1+2 : `fix(pos): single canonical kitchen print path — deprecate legacy enqueue_print_job_v1 kitchen_chit + type lanHub client`
  Corps : décision canonique, gate de dépendance bridge (levée/flag), tests.

---

## Critères d'acceptation (miroir spec §3)

- [ ] Décision canonique Path A vs Path B ratifiée et documentée (P0.2, INDEX §Deviations).
- [ ] Si Path B kitchen_chit déprécié : le `kds.bump` n'enqueue plus de `kitchen_chit` (ou gardé derrière un flag explicitement OFF) ; aucun double-ticket pour un même item (test P2.3).
- [ ] `lanHubMessageHandler.ts` n'utilise plus `type SupabaseClient = any` ; client typé `SupabaseClient<Database>` (P1.1-P1.2).
- [ ] `as never` sur les appels RPC retirés là où le typage le permet (P1.3).
- [ ] `pnpm --filter @breakery/app-pos typecheck` PASS, **sans nouveaux `eslint-disable`** (P1.6).
- [ ] **Dépendance d'ordonnancement respectée** : Path B non déprécié « en dur » tant que Path A (bridge) n'est pas opérationnel (gate P0.4).

---

## Risques / dépendances (miroir spec §6 — matérialisés)

| # | Risque | Mitigation matérialisée |
|---|---|---|
| 1 | **Régression P0 « cuisine muette »** : déprécier Path B sans bridge déployé | **Gate P0.4 bloquante** : Phase 2 ne démarre que si bridge opérationnel (a) OU flag OFF (b). Dépendance explicite sur le plan/spec `pos-print-bridge-deploy`. STOP documenté si gate non levée. |
| 2 | Décision transverse impression | Escalade ratification P0.2 avant tout code de dépréciation |
| 3 | RPCs LAN absents de `types.generated.ts` → typage impossible | P1.4 : vérif + regen MCP si manquant (project `ikcyvlovptebroadgtvd`) |
| 4 | Précédent `any` voulu dans `lanHub.ts` (découplage `@supabase/supabase-js`) | P1.1 tranche A vs B explicitement ; option B recommandée (type centralisé `@breakery/supabase`, cohérent avec le découplage) |
| 5 | Aucune migration DB ; l'RPC `enqueue_print_job_v1` reste pour `print.request` | Dépréciation côté client uniquement ; `handlePrintRequest` conservé (P0.3) |

---

## Dépendance inter-plan (matérialisée)

```
pos-print-bridge-deploy  ──(bridge opérationnel OU flag OFF)──▶  pos-double-print-risk Phase 2
       (P0 — déploie Path A)          GATE P0.4                  (déprécie Path B kitchen_chit)
```

- **`pos-double-print-risk` Phase 1 (typage)** : indépendante, livrable immédiatement.
- **`pos-double-print-risk` Phase 2 (dépréciation)** : **dépend** de [`pos-print-bridge-deploy`](../specs/2026-06-01-pos-print-bridge-deploy-spec.md) (Path A prouvé fonctionnel : 5 imprimantes `lan_devices` + repro réel 3 tickets prep + reçu). Note : à ce jour, le plan `pos-print-bridge-deploy` n'existe pas encore (seule la spec est rédigée) — la gate P0.4 référence la **spec** et exige la preuve d'acceptation §3 du futur plan.

---

## Hors scope (miroir spec §5)

- Le KDS écran lui-même (S35 — kitchen revival `is_locked`/`kitchen_status`).
- Refonte du protocole LAN hub / format des messages.
- Le print server externe qui poll `claim_print_job_v1` (process hors monorepo).
- Migration / drop de l'RPC `enqueue_print_job_v1` côté DB (l'RPC reste pour `print.request` génériques).
- Le typage de `lanHub.ts` lui-même (`type SupabaseClient = any` `:34`, `type RealtimeChannel = any` `:32`) — candidat follow-up une fois le type centralisé en P1.1 option B (tracer en backlog, hors scope ici).
