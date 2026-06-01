# POS print-bridge deploy + runtime config — Implementation Plan (V1)

> **For agentic workers:** REQUIRED SUB-SKILL: invoke `superpowers:writing-plans` to align on structure, then `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) to execute task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. One phase = one isolable subagent; phases within a wave are parallelizable.

**Goal:** Rendre l'impression POS réellement fonctionnelle en prod en (a) **de-hardcodant** l'URL du bridge dans `printService.ts` via `VITE_PRINT_SERVER_URL`, (b) documentant le **contrat des endpoints** et la **procédure de déploiement** du bridge multi-imprimantes (livrable hors-repo remis à l'équipe ops/bridge), et (c) fournissant la **procédure d'enregistrement** des 5 imprimantes dans `lan_devices` + un **seed dev** (fixture) pour exercer la résolution sans matériel. Ferme le finding P0 « 100% des impressions échouent en prod sans le bridge » (DEV-S34-W0-02).

**Non-Goal (explicite) :** ce chantier ne livre PAS la config UI éditable manager (input URL + toggles) — c'est **F-009/S35** (`POSSettingsPage` Printing tab, `2026-05-29-session-35-spec.md` §5, qui résout aussi F-015). On introduit ici **uniquement** l'env var `VITE_PRINT_SERVER_URL` comme dé-hardcodage minimal déployable immédiatement. On ne livre PAS non plus le code du bridge (process externe hors monorepo), ni une UI BO « Devices », ni la découverte auto d'imprimantes.

**Architecture:** 2 volets clairement séparés.
- **REPO (ce qui est mergeable ici)** — Wave 1 : de-hardcode l'URL + smoke ; Wave 2 : seed dev `lan_devices` (fixture, **pas migration prod**) + sanity résolution. Wave 4 : tests + closeout.
- **EXTERNE (dépendance hors monorepo, non-mergeable, livrable = doc)** — Wave 3 : contrat endpoints `/print/*` + procédure déploiement bridge + procédure provisioning `lan_devices` prod (ops). Tracé comme dépendance bloquante P0-opérationnel, repro physique différé.

**Tech Stack:** Supabase cloud V3 dev (`ikcyvlovptebroadgtvd`) via MCP, pnpm/turbo monorepo, React Query + Vitest, Vite env vars (`apps/pos/.env.local`), bridge externe (`localhost:3001` dev → URL configurable prod, hors-repo).

**Spec:** [`../specs/2026-06-01-pos-print-bridge-deploy-spec.md`](../specs/2026-06-01-pos-print-bridge-deploy-spec.md)
**Branch:** `fix/pos-print-bridge-config` (à créer depuis `master` @ `70c5cf1`)
**Cross-ref S35 (NE PAS dupliquer):** [`../specs/2026-05-29-session-35-spec.md`](../specs/2026-05-29-session-35-spec.md) §5 (F-009 Printing tab + F-015).

---

## Code facts vérifiés (avant planification)

- `apps/pos/src/services/print/printService.ts:4` — `const SERVER_URL = 'http://localhost:3001';` **confirmé hardcodé**. Utilisé par `checkPrintServer` (`:97` `/health`), `printReceipt` (`:128` `/print/receipt`), `openCashDrawer` (`:150` `/drawer/open`), `printStationTicket` (`:183` `/print/ticket`). `VITE_PRINT_SERVER_URL` **n'existe nulle part dans le code** aujourd'hui (présent seulement dans des specs/INDEX docs).
- `apps/pos/src/features/cart/hooks/useStationPrinters.ts:37-74` — lit `lan_devices` filtré `device_type='printer'` + `is_active=true` + `deleted_at IS NULL`, indexe par `capabilities->>'station'` (`barista|kitchen|bakery|cashier|waiter`) → `Map<PrinterRole, {ip_address, port, name}>`. Skip si `station` absent OU `ip_address` NULL OU `port` NULL.
- `supabase/migrations/20260517000171_init_lan_devices.sql` — `lan_devices` colonnes : `code TEXT UNIQUE NOT NULL`, `name TEXT NOT NULL`, `device_type TEXT CHECK (... 'printer' ...)`, `ip_address INET` (PAS text), `port INT`, `capabilities JSONB DEFAULT '{}'`, `is_active BOOLEAN DEFAULT TRUE`, `deleted_at TIMESTAMPTZ`. INSERT/UPDATE/DELETE gated par perm `lan.devices.manage` (RLS). **Important :** un seed doit fournir un `code` unique par row (sinon NOT NULL viol).
- S35 §5 (ligne 107+) — `usePosSettingsStore` (Zustand persist localStorage) doit lire/écrire la même clé que l'env var. Ordre de résolution canonique à respecter : **store > env var > fallback `localhost:3001`**. La lecture `printService.ts` introduite ici (env > fallback) reste compatible : S35 préfixera juste le store.

---

## File Structure (overview)

### Changed (REPO — Wave 1)
```
apps/pos/src/services/print/printService.ts
  (EDIT: const SERVER_URL → fonction/const lisant import.meta.env.VITE_PRINT_SERVER_URL ?? 'http://localhost:3001')
apps/pos/src/services/print/__tests__/print-server-url-config.smoke.test.tsx   (NEW)
apps/pos/.env.example  ou  apps/pos/.env.local.example                          (EDIT/NEW: documenter VITE_PRINT_SERVER_URL)
```

### Changed (REPO — Wave 2, seed dev uniquement)
```
supabase/tests/fixtures/seed_dev_printers.sql        (NEW — fixture dev, NON appliquée en prod)
  OU script de seed dev documenté dans le contrat (Wave 3) si pas de dossier fixtures existant
```

### Externe (Wave 3 — livrables doc, hors code applicatif)
```
docs/reference/<…>/print-bridge-contract.md          (NEW ou section ajoutée à un ref existant)
  — contrat endpoints /print/ticket /print/receipt /drawer/open /health
  — procédure déploiement bridge multi-imprimantes (machine comptoir)
  — procédure provisioning lan_devices prod (ops, par site)
```

> **Note layout :** vérifier l'existence d'un dossier `supabase/tests/fixtures/` et d'un emplacement `docs/reference/` adéquat AVANT de créer ; réutiliser une page ref existante (p.ex. module 13 LAN/print) plutôt qu'en créer une si elle existe. Respecter la règle CLAUDE.md « NEVER create files unless absolutely necessary ».

---

## Wave 0 — pré-vérifications & branche (BLOQUANT, séquentiel)

> 1 subagent. Pré-requis aux autres waves. ~15 min.

- [ ] **W0.1** Créer `fix/pos-print-bridge-config` depuis `master` @ `70c5cf1`. Committer spec + plan (`docs(workplan): pos print-bridge deploy + runtime config — spec + plan`).
- [ ] **W0.2** Confirmer l'état actuel (déjà vérifié, re-checker avant edit) : `printService.ts:4` hardcodé ; `VITE_PRINT_SERVER_URL` absent du code. `Grep "SERVER_URL" apps/pos/src` pour lister toutes les références (4 endpoints) — toutes doivent passer par la même source après W1.1.
- [ ] **W0.3** Confirmer la convention env POS : où vivent les `.env*` (mémoire projet : `apps/pos/.env.local` requis, `envDir` non set) ; existe-t-il un `.env.example` POS à étendre ? Décider l'emplacement de doc de l'env var.
- [ ] **W0.4** Vérifier l'existence d'un dossier fixtures (`supabase/tests/fixtures/` ou équivalent) et d'une page `docs/reference/` LAN/print à enrichir, pour ne pas créer de fichiers superflus.

**Critère de sortie Wave 0 :** branche créée ; chemins cibles confirmés ; liste exhaustive des call-sites `SERVER_URL`.

---

## Wave 1 — REPO : de-hardcode URL bridge + smoke (parallélisable interne)

> Volet **mergeable**. Phases 1.1 et 1.3 séquentielles (1.3 dépend de 1.1) ; 1.2 (doc env) parallélisable avec 1.1.

- [ ] **W1.1 — De-hardcode `SERVER_URL` (`printService.ts`).** Remplacer la constante figée par une lecture runtime avec fallback :
  ```ts
  const SERVER_URL = import.meta.env.VITE_PRINT_SERVER_URL ?? 'http://localhost:3001';
  ```
  Les 4 call-sites (`checkPrintServer`, `printReceipt`, `openCashDrawer`, `printStationTicket`) continuent d'utiliser `SERVER_URL` → un seul point de lecture. **Compat S35 :** documenter en commentaire que l'ordre de résolution final sera `store(S35) > VITE_PRINT_SERVER_URL > 'http://localhost:3001'` ; ne PAS introduire de store ici. **Ne PAS** changer la sémantique mock (`VITE_PRINT_MOCK` court-circuite avant tout réseau dans `printReceipt`/`printStationTicket`) — l'URL n'est lue qu'en non-mock.
  - **Vérif :** `pnpm --filter @breakery/app-pos typecheck` PASS.
- [ ] **W1.2 — Documenter l'env var.** Ajouter `VITE_PRINT_SERVER_URL` à l'`.env.example` POS (ou créer `apps/pos/.env.local.example`) avec commentaire : valeur prod = URL LAN du bridge comptoir (ex. `http://192.168.1.50:3001`), absente en CI (mock), défaut dev `http://localhost:3001`. Ne PAS committer de `.env.local` réel (règle CLAUDE.md secrets).
- [ ] **W1.3 — POS smoke `print-server-url-config.smoke.test.tsx`.** Co-localisé dans `apps/pos/src/services/print/__tests__/`. Mocker `import.meta.env.VITE_PRINT_SERVER_URL` (via `vi.stubEnv`) **et** s'assurer que `VITE_PRINT_MOCK` est **unset/false** (sinon le réseau est court-circuité — cf. hygiène S34 W4 commit `f525bca` : unstub en `afterEach`). Mocker `global.fetch`. Asserts :
  1. Avec `VITE_PRINT_SERVER_URL='http://10.0.0.9:4000'` → `printStationTicket(printer, payload)` POST vers `http://10.0.0.9:4000/print/ticket`.
  2. `printReceipt(payload, printer)` POST vers `http://10.0.0.9:4000/print/receipt`.
  3. Sans l'env var (unset) → fallback `http://localhost:3001/print/ticket`.
  - **Hygiène :** `vi.unstubAllEnvs()` + restore `fetch` en `afterEach` pour ne pas polluer les 5 smokes S34.
  - **Vérif :** `pnpm --filter @breakery/app-pos test print-server-url-config` PASS.

**Critère de sortie Wave 1 :** `printService.ts` n'a plus de constante figée ; smoke URL config PASS ; typecheck PASS ; les 5 smokes S34 restent verts (vérifié en Wave 4).

---

## Wave 2 — REPO : seed dev `lan_devices` + sanity résolution (parallélisable avec W1)

> Volet **mergeable** (seed dev uniquement, **AUCUNE migration prod** — IP hardware-spécifiques, variables par site). 1 subagent.

- [ ] **W2.1 — Seed dev des 5 imprimantes (fixture, pas migration).** Écrire un script de seed dev (fixture `supabase/tests/fixtures/seed_dev_printers.sql` ou équivalent confirmé W0.4) qui INSERT 5 rows `lan_devices` `ON CONFLICT (code) DO NOTHING`, chacune avec `code` unique, `device_type='printer'`, `is_active=true`, `ip_address` LAN factice (ex. `192.168.99.x`), `port=9100` (ESC/POS standard), `capabilities = jsonb_build_object('station', '<role>')`. Les 5 rôles : `barista`, `kitchen`, `bakery`, `cashier`, `waiter`. **Important :** `ip_address` est de type `INET` — fournir une IP valide (pas une chaîne arbitraire). **Ne PAS** appliquer en prod (le contenu est exemplatif/dev). Exécuter le seed sur V3 dev via MCP `execute_sql` pour exercer `useStationPrinters`.
  - **Caveat RLS :** INSERT direct gated par `lan.devices.manage`. Le seed via MCP `execute_sql` s'exécute en service-role/postgres → bypass RLS, OK pour dev. Documenter que le provisioning prod passera par ops (UI BO Devices future, hors scope) avec un compte gated.
- [ ] **W2.2 — Sanity résolution (`execute_sql`).** Après seed :
  `SELECT name, ip_address, port, capabilities->>'station' AS station FROM lan_devices WHERE device_type='printer' AND is_active AND deleted_at IS NULL ORDER BY station;`
  → attendre 5 rows, un par rôle, tous avec `ip_address`/`port` non-NULL. Confirme que `useStationPrinters` produirait une Map de taille 5.
- [ ] **W2.3 — (optionnel) Smoke résolution `useStationPrinters`.** Si un smoke léger est jugé utile : mocker `@/lib/supabase` pour renvoyer les 5 rows fixture et asserter que la Map a 5 entrées indexées par rôle, et qu'une row sans `station`/`ip`/`port` est skippée. **Décision :** ne l'ajouter que si la couverture S34 ne le couvre pas déjà (grep les smokes S34 `fire-to-stations` / `fire-printer-unreachable` — ils exercent déjà la résolution). Sinon SKIP tracké en déviation.

**Critère de sortie Wave 2 :** 5 imprimantes résolvables en dev ; sanity SQL = 5 rows ; aucune migration prod ajoutée.

---

## Wave 3 — EXTERNE : contrat bridge + procédures déploiement/provisioning (livrable doc, NON-mergeable code)

> **Dépendance hors monorepo.** Ne contient AUCUN code applicatif. Livrable = documentation remise à l'équipe ops/bridge. 1 subagent (technical-writer-like). Parallélisable avec W1/W2.

- [ ] **W3.1 — Documenter le contrat des endpoints bridge** (réutiliser le contrat figé S34 spec §2 Choix 4 — ne pas le réinventer) :
  - `POST /print/ticket` — body `{ printer: { ip_address, port }, kind: 'prep'|'bill'|'receipt', role, order_number, items[], totals?, payment?, ... }`. Le bridge ouvre une connexion ESC/POS vers `printer.ip_address:port` et imprime le ticket.
  - `POST /print/receipt` — reçu cashier (body `ReceiptPayload` + `printer?`).
  - `POST /drawer/open` — pulse tiroir-caisse.
  - `GET /health` — liveness (utilisé par `checkPrintServer`).
  - Préciser les codes retour (2xx = ok ; non-2xx → `printService` retourne `{success:false, error:'HTTP <status>'}`), timeouts côté client (5s ticket/receipt, 2s health/drawer).
- [ ] **W3.2 — Procédure de déploiement du bridge multi-imprimantes** (machine comptoir / PC caisse) : prérequis réseau (accès LAN aux imprimantes thermiques barista/kitchen/bakery + doc cashier/waiter), port d'écoute (3001 par défaut, ou configurable), routage multi-imprimantes (le bridge ouvre N connexions ESC/POS selon `printer.ip_address:port` du payload), procédure de démarrage/supervision (service système). **Le code du bridge reste hors monorepo** — ce doc est le contrat remis.
- [ ] **W3.3 — Procédure de provisioning `lan_devices` en prod (ops, par site).** Documenter comment ops saisit les 5 rows imprimantes (IP/port réels du site) : aujourd'hui via SQL gated `lan.devices.manage` ou future UI BO « Devices » (hors scope ici). Rappeler le schéma : `code` unique, `device_type='printer'`, `capabilities = {"station":"<role>"}`, `ip_address`/`port` réels. Comportement si un rôle manque : `useStationPrinters` ne le résout pas → le flux S34 affiche « no printer configured for [station] » (pas de crash).
- [ ] **W3.4 — Ouvrir/mettre à jour le suivi de la dépendance externe** (S34-FOLLOWUP « pont multi-imprimantes ») : assigner un propriétaire ops, lister la checklist de repro physique (W4.x), marquer comme bloquant P0-opérationnel tant que non déployé.

**Critère de sortie Wave 3 :** doc de contrat + procédures déploiement & provisioning rédigées et remises ; suivi externe ouvert avec propriétaire.

---

## Wave 4 — tests, non-régression, closeout

> Séquentiel (dépend de W1/W2). 1 subagent (test-engineer + coordinator closeout).

- [ ] **W4.1 — Non-régression smokes S34.** `pnpm --filter @breakery/app-pos test` ciblé sur les 5 smokes S34 sous `VITE_PRINT_MOCK=1` : `fire-to-stations`, `fire-printer-unreachable`, `checkout-autofire`, `print-bill`, `receipt-targets-cashier` → tous verts (7/7 attendus). Vérifier que le nouveau smoke W1.3 n'a pas pollué l'env mock (unstub propre).
- [ ] **W4.2 — Smoke URL config** (W1.3) PASS.
- [ ] **W4.3 — Typecheck.** `pnpm --filter @breakery/app-pos typecheck` PASS + `pnpm typecheck` full sweep (vérifier baseline `@breakery/ui` env-gated documentée, non-régression).
- [ ] **W4.4 — Checklist repro physique (dépend du bridge, HORS CI).** Documenter (pas exécuter — bridge non déployé) la checklist S34-FOLLOWUP : 1 commande mixte → 3 tickets prep (barista/kitchen/bakery) + reçu cashier, une fois le bridge multi-imprimantes déployé et `lan_devices` prod provisionné. Tracer comme critère d'acceptation différé.
- [ ] **W4.5 — INDEX** `docs/workplan/plans/2026-06-01-pos-print-bridge-deploy-INDEX.md` : summary, fichiers modifiés (printService, smoke, env.example), seed dev appliqué (oui/non + 5 rows), livrables doc externes (contrat + procédures), tests run (smoke URL + 5 S34 non-régression + typecheck), deviations, acceptance criteria, dépendance externe restante (bridge non déployé = P0-opérationnel ouvert).
- [ ] **W4.6 — CLAUDE.md bump §Active Workplan.** Noter le chantier `fix/pos-print-bridge-config` : env var `VITE_PRINT_SERVER_URL` introduite (de-hardcode F-015 partiel), seed dev `lan_devices`, contrat bridge documenté. **Cross-ref explicite :** la config UI éditable reste F-009/S35 (ne pas re-spécifier). Migration sequence : **aucune migration** (data dev fixture uniquement, pas de schema/prod). Mettre à jour DEV-S34-W0-02 (bridge) : URL de-hardcodée + contrat livré ; déploiement physique reste différé.
- [ ] **W4.7 — PR** `fix/pos-print-bridge-config` → `master`. Titre `fix(pos): de-hardcode print server URL via VITE_PRINT_SERVER_URL + bridge deploy contract`. Squash-merge. Corps : préciser que le volet EXTERNE (déploiement bridge) reste une dépendance ops bloquante P0-opérationnel non résolue par cette PR.

**Critère de sortie Wave 4 :** smokes verts + typecheck PASS + INDEX + CLAUDE.md bumped + PR prête. Dépendance bridge externe explicitement tracée comme non-close.

---

## Acceptance criteria (miroir spec §3)

- [ ] `printService.ts` lit l'URL via `VITE_PRINT_SERVER_URL` (fallback `localhost:3001`) — plus de constante figée. *(W1.1)*
- [ ] Ordre de résolution documenté et compatible store F-009/S35 (store > env > fallback). *(W1.1 commentaire + W4.6)*
- [ ] Contrat endpoints bridge documenté (`/print/ticket`, `/print/receipt`, `/drawer/open`, `/health`) et remis à l'équipe bridge. *(W3.1)*
- [ ] Procédure d'enregistrement des 5 imprimantes dans `lan_devices` documentée (ops) + seed dev en fixture. *(W2.1, W3.3)*
- [ ] Repro réel (commande mixte → 3 tickets prep + reçu cashier) — **différé**, checklist tracée, dépend du bridge déployé. *(W4.4)*
- [ ] `pnpm --filter @breakery/app-pos typecheck` PASS. *(W4.3)*

---

## Critical patterns à respecter (CLAUDE.md)

- **DB cloud V3 via MCP** — seed dev via `mcp__plugin_supabase_supabase__execute_sql` ; **PAS** de `supabase start`/`db reset`/Docker. **Aucune migration prod** ici.
- **Pas de secrets committés** — `.env.local` réel jamais committé ; uniquement `.env.example` documenté.
- **`ip_address` est `INET`** — le seed doit fournir une IP valide, pas une chaîne libre.
- **RLS `lan.devices.manage`** — INSERT prod gated ; seed dev via MCP bypasse en service-role (dev only), provisioning prod passe par compte gated/ops.
- **Mock-first** — `VITE_PRINT_MOCK` court-circuite le réseau ; l'URL n'est lue qu'en non-mock. Le smoke URL doit explicitement unset le mock (hygiène S34 `f525bca`).
- **Ne pas dupliquer S35 F-009** — pas de store/UI config ici ; uniquement l'env var.

---

## Dependencies & risques (miroir spec §6)

1. **Dépendance externe bloquante (P0-opérationnel)** — sans déploiement bridge multi-imprimantes joignable à l'URL configurée, aucune impression réelle. Le de-hardcode seul ne suffit pas. *(Wave 3 livrable + W3.4 suivi)*
2. **Provisioning `lan_devices` prod** — sans rows, `useStationPrinters` vide → toast « no printer configured ». *(W3.3 doc ops)*
3. **Chevauchement S35 F-009** — risque double-implémentation config URL. Mitigation : ici env var seulement ; UI éditable = S35 lisant la même clé (store > env > fallback). *(W1.1, W4.6)*
4. **IP imprimantes variables par site** — pas de migration prod possible ; config par déploiement. *(W2.1 = dev fixture only)*

## Dépendances inter-specs

- **`pos-refund-test-investigation`** (l'autre P0 du 2026-06-01) : **aucune dépendance fonctionnelle directe** — périmètres disjoints (printing vs order-history refund). Parallélisable. Seul lien : tous deux exigent `pnpm --filter @breakery/app-pos test` propre avant merge ; si l'investigation refund conclut à un `it.skip` baseline, la suite POS doit rester verte pour valider les non-régressions de ce plan (W4.1).
- **S35 (`2026-05-29-session-35-spec.md` §5, F-009/F-015)** : ce plan est le **précurseur** du Printing tab S35. S35 ajoutera `usePosSettingsStore` au-dessus de l'env var introduite ici (même clé, store prioritaire). Ne pas re-spécifier.

---

## Deviations log (à remplir en cours d'exécution)

| ID | Section | Original | What happened | Reason | Risk |
|---|---|---|---|---|---|
| _(à compléter)_ | | | | | |

Candidats anticipés :
- **DEV-PB-W3-01** (informational) — déploiement bridge physique + provisioning `lan_devices` prod restent hors monorepo, non-mergeables ; repro physique différé (S34-FOLLOWUP).
- **DEV-PB-W2-01** (informational) — seed `lan_devices` = fixture dev avec IP factices ; provisioning prod = ops par site, pas de migration.
- **DEV-PB-W1-01** (informational, possible) — env var seule (pas de store) ici par design ; UI éditable déférée F-009/S35.
