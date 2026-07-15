# Spec — POS double-print risk (path legacy print-queue vs bridge S34) (V1)

- **Date** : 2026-06-01
- **Topic** : `pos-double-print-risk`
- **Type** : clarification d'architecture + dépréciation + typage (hors cycle session numéroté)
- **Branche cible suggérée** : `fix/pos-double-print-risk`
- **Base** : `master` @ `70c5cf1`
- **Effort estimé** : **S-M** (~0.5-1 jour — décision canonique + dépréciation conditionnelle + typage du client)
- **Status** : draft pour ratification
- **Origine** : audit POS `pos-specialist` 2026-06-01 — finding **P2 « deux chemins d'impression concurrents post-S34 »**

---

## 1. Contexte — ce qui est cassé (preuve `fichier:ligne`)

Deux chemins d'impression de tickets cuisine coexistent depuis S34, avec un **risque de double-impression** si les deux sont actifs simultanément :

**Path A (S34, nouveau)** — bridge HTTP direct : `useFireToStations` (`apps/pos/src/features/cart/hooks/useFireToStations.ts`) → `printStationTicket(printer, payload)` (`apps/pos/src/services/print/printService.ts:170`) POST `/print/ticket` vers l'imprimante résolue via `useStationPrinters`. C'est le chemin canonique « Send to Kitchen » de S34.

**Path B (S13 legacy)** — print-queue DB : `apps/pos/src/features/lan/lanHubMessageHandler.ts:99-117` — sur un message LAN `kds.bump` avec `new_status === 'preparing'`, le handler appelle l'RPC `enqueue_print_job_v1` avec `ticket_type: 'kitchen_chit'` (lignes 100-112). Un print server séparé (process polling `claim_print_job_v1`, cf. commentaire `lanHubMessageHandler.ts:124-125`) imprime alors le chit. Ce path est **actif** : `handleLanMessage` est câblé via `apps/pos/src/features/lan/lanHub.ts` + `useLanHub`.

**Risque** : si le KDS bump (Path B) ET le fire-to-stations S34 (Path A) impriment tous deux un ticket cuisine pour le même item, on imprime **deux fois**. S34 (spec station-printing) a explicitement repositionné le KDS écran en **S35** et fait de l'impression directe le mécanisme canonique — mais le path legacy `enqueue_print_job_v1` du `kds.bump` n'a pas été déprécié. La cohabitation n'est pas arbitrée.

**Sous-problème de typage** : `lanHubMessageHandler.ts:13-14` :
```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClient = any;
```
Le client Supabase est typé `any` dans tout le handler (`ctx.supabase.rpc(...)` n'est pas type-checké). Fragilité : un nom d'RPC erroné ou un mauvais shape d'argument passerait la compilation. Tous les `as never` sur les appels RPC (`:107`, `:112`, `:133`, `:176`) en découlent.

---

## 2. Architecture / approche proposée

### A. Décider le path canonique post-S34
**Décision à ratifier (business + archi)** : quel chemin imprime les tickets cuisine ?
- **Option recommandée** — Path A (bridge direct S34) est canonique ; **déprécier le `enqueue_print_job_v1('kitchen_chit')`** du `kds.bump` (`lanHubMessageHandler.ts:99-117`). Le KDS écran (S35) gérera le bump à l'écran, pas l'impression. Concrètement : retirer (ou feature-flag) le bloc lignes 99-117 pour que `kds.bump` n'enqueue plus de chit.
- **Alternative** — garder Path B (print-queue durable, survit aux déconnexions) et faire de S34 fire-to-stations le mécanisme principal seulement quand le bridge est joignable, avec garde anti-double. Plus complexe ; non recommandé.

> **Cette spec ne tranche pas seule** : escalade requise (impact transverse impression). Le plan d'implémentation suivra la décision ratifiée. Par défaut, recommandation = déprécier Path B kitchen_chit, garder Path A.

Conserver `handlePrintRequest` (`lanHubMessageHandler.ts:120-156`) qui gère `print.request` génériques (≠ le chit auto du bump) sauf si la décision l'englobe — à clarifier dans le plan.

### B. Typer correctement le client Supabase
Remplacer `type SupabaseClient = any` (`:14`) par le type généré du projet (`SupabaseClient<Database>` depuis `@breakery/supabase` / `@supabase/supabase-js`). Retirer les `as never` rendus inutiles par le bon typage là où c'est possible. Si certains RPCs ne sont pas encore dans les types générés, le noter (et regen si une migration manque).

---

## 3. Critères d'acceptation

- [ ] Décision canonique Path A vs Path B ratifiée et documentée.
- [ ] Si Path B kitchen_chit déprécié : le `kds.bump` n'enqueue plus de `kitchen_chit` (ou gardé derrière un flag explicitement off) ; aucun double-ticket pour un même item.
- [ ] `lanHubMessageHandler.ts` n'utilise plus `type SupabaseClient = any` ; client typé `SupabaseClient<Database>`.
- [ ] `as never` sur les appels RPC retirés là où le typage le permet.
- [ ] `pnpm --filter @breakery/app-pos typecheck` PASS (sans nouveaux `eslint-disable`).

## 4. Tests attendus

- POS smoke `lan-hub-no-kitchen-chit.smoke.test.tsx` (si Path B déprécié) : un message `kds.bump` `new_status='preparing'` → `enqueue_print_job_v1` **non appelé** avec `ticket_type:'kitchen_chit'` (mock `ctx.supabase.rpc`, assert non-appel).
- Non-régression : les autres handlers (`print.request`, `heartbeat`, `order.update`) restent fonctionnels — couverts par les tests lan-hub existants s'ils existent (`useLanHub`).
- Typage : `pnpm --filter @breakery/app-pos typecheck` valide le client typé.
- Non-régression S34 : `fire-to-stations.smoke` reste vert (Path A intact).

## 5. Hors scope

- Le KDS écran lui-même (S35 — kitchen revival `is_locked`/`kitchen_status`).
- Refonte du protocole LAN hub / format des messages.
- Le print server externe qui poll `claim_print_job_v1` (process hors monorepo).
- Migration / drop de l'RPC `enqueue_print_job_v1` côté DB (la dépréciation est côté client ; l'RPC peut rester pour `print.request` génériques).

## 6. Risques / dépendances

1. **Risque de régression d'impression** : déprécier Path B sans que Path A (bridge) soit déployé (cf. spec `pos-print-bridge-deploy`) laisserait la cuisine **sans aucune impression** sur bump. Mitigation : ne déprécier Path B que lorsque Path A est opérationnel, ou garder un flag de bascule. **Dépendance forte sur `pos-print-bridge-deploy`.**
2. **Décision transverse** : touche impression cuisine — escalade requise avant implémentation.
3. **Typage** : si des RPCs LAN ne sont pas dans `types.generated.ts`, regen via MCP nécessaire (vérifier `enqueue_print_job_v1`, `claim_print_job_v1`, `update_lan_heartbeat_v1`).
