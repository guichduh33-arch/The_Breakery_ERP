# CLAUDE.md — The Breakery ERP

> Ce fichier est la loi. En cas de conflit avec tout autre document, wiki,
> session précédente ou résumé : **ce fichier gagne**.

## Hiérarchie de vérité

```
1. Le CODE et le SCHÉMA DB        ← ce qui EST. Vérité factuelle.
2. docs/adr/                      ← ce qui DOIT ÊTRE. Décisions de Mamat, immuables.
3. docs/objectifs/                ← ce qui est VOULU. Écrit par Mamat.
4. docs/product/, docs/runbooks/  ← opérationnel.
5. docs/_quarantine/              ← MORT. N'existe pas. Interdiction de lire/citer/grep.
```

Si un document contredit le code, le document a tort : **signale-le, ne corrige rien**.

## Règles documentaires — non négociables

1. **Tu ne crées pas de rapport, plan de session, INDEX, compte-rendu ou résumé** :
   ces contenus vivent dans ta réponse, jamais en fichier. **Exception — les
   documents que la tâche appelle** (un ADR qui grave une décision de Mamat, une
   spec exigée par un ADR, une fiche que Mamat demande) : ceux-là, **tu les
   rédiges toi-même dans le fichier**, puis tu les soumets à Mamat.
2. **Tu rédiges, Mamat valide, tu commites — dans cet ordre.** Le commit d'un
   fichier de doc se fait **après validation explicite de Mamat**, sur une branche
   dédiée (`docs/…`, `feat/…`, `fix/…`, **jamais `master`**), sans push sans
   demander. Pas de validation explicite = pas de commit.
3. **Les plans de session vivent dans la conversation** (mode plan), jamais en
   fichier. Ce qui mérite de survivre à une session devient un ADR — que tu
   rédiges et que Mamat valide (règles 1-2) — ou disparaît avec le contexte.
4. **Specs d'exécution (`docs/specs/`)** : uniquement quand un ADR l'exige
   explicitement pour un chantier lourd. Nom : `<ADR>x-<sujet>.md`. Rédigée par
   l'agent, relue et validée par Mamat (création/commit selon règles 1-2). Une
   spec meurt à la livraison du chantier : supprimée, son
   résiduel éventuel noté dans l'ADR. Jamais plus de 3 specs vivantes.
   Tout autre plan/spec/compte-rendu reste interdit de fichier.
5. **Un ADR ne se modifie jamais.** Changement d'avis = nouvel ADR numéroté qui
   supersede l'ancien (`Statut: remplacé par ADR-00XX`).
6. **Information manquante → tu t'arrêtes et tu demandes.** Tu n'inventes pas,
   tu ne déduis pas « ce qui semble logique », tu ne vas pas fouiller la quarantaine.
7. **Aucune décision autonome** : architecture, renommage, suppression, choix de
   librairie, changement de comportement → accord explicite de Mamat AVANT l'action.
8. **Périmètre strict** : tu touches les fichiers nécessaires à la tâche, rien d'autre.

## Règles d'écriture des documents de gouvernance

- **Séparer les registres.** Un énoncé **factuel** (nom d'objet, chemin, comptage, statut
  de livraison) se corrige contre le code. Un énoncé **intentionnel** (« le caissier doit
  pouvoir… ») ne se corrige **jamais** pour coller au code : l'écart est du backlog. En cas
  de doute sur le registre d'une ligne, on ne touche pas et on demande.
- **Aucun `_vN` hors ADR.** Une fiche, une skill, un agent citent la **famille**
  (`close_shift`), jamais la version. Le test porte sur le SENS : métavariable, fait
  historique daté et version fixée par un ADR sont légitimes ; un `_vN` présenté comme le
  pointeur de l'objet **vivant** ne l'est pas.
- **Aucun `Sxx` de plan.** Même test : « planifié pour S28 » est mort et se retire ; un
  identifiant (`DEV-S25-2.A-01`) ou un fait daté (« droppés S56 ») est un nom propre ou un
  événement — on garde.
- **Aucun composant de code dans une fiche `docs/objectifs/`.** Un identifiant PascalCase y
  est une affirmation sur le code : il pourrit au premier renommage et contraint
  l'implémentation sans y être autorisé. On désigne l'écran, la fonction, le parcours. Les
  **routes** et les **familles de RPC** restent citables ; un **nom de fichier** est un fait.
- **Aucun compteur vivant, aucun numéro de ligne dans un document évergreen.** Un compte est
  soit retiré (le système de fichiers compte mieux), soit **daté**. On désigne par ancre
  stable — titre de section, nom de pattern, texte cité — jamais par `fichier:ligne`.
- **Une ligne réécrite sort conforme** aux règles en vigueur et **vraie**. Le mandat d'un lot
  borne les lignes touchées, pas la conformité de celles produites — et le rayon d'action
  inclut les lignes que l'édition rend fausses.
- **On ne déclare pas un ADR applicable sans avoir lu son corps.** Un titre n'est pas un
  périmètre ; un bandeau trop large trompe autant qu'un bandeau faux.
- **Un archivage invalide toute promesse de réversibilité qui en dépendait.** Toute
  affirmation de réversibilité nomme la liste complète des gestes de retour et se vérifie
  après le dernier déplacement.
- **Le contenu ne transite jamais par un shell** (`echo`, heredoc) : un `>` de citation y
  devient une redirection. `Write`/`Edit` le garantissent, un script qui lit et écrit des
  fichiers côté langage aussi. L'automatisation est permise ; le shell comme véhicule de
  contenu ne l'est pas.
- **On cible ce qui vit, on n'exclut pas ce qui est mort.** Une commande de relevé énumère
  les zones vivantes : une exclusion pointe un chemin qui peut disparaître, et une exclusion
  oubliée est silencieuse.
- **Un commit de merge ne contient jamais une réécriture.** Résoudre un conflit, c'est
  choisir entre deux versions existantes ; toute transformation se fait dans un commit
  suivant, relisable seul.

## Règles générales

- Do what has been asked; nothing more, nothing less.
- ALWAYS read a file before editing it.
- NEVER commit secrets, credentials, or .env files.
- Keep files under 500 lines.
- Validate input at system boundaries.
- Monorepo pnpm/turbo : code dans `apps/{pos,backoffice}/src`,
  `packages/{domain,supabase,ui,utils}/src`, `supabase/{functions,migrations,tests}`.
  Tests co-localisés dans `__tests__/` — un même module en a souvent PLUSIEURS
  (`pages/<x>/__tests__` ET `features/<x>/__tests__`) : chercher par glob, jamais
  conclure « pas de test » depuis un seul répertoire.
- **Sous-agents (Task tool) : autorisés dans une session, sous régime strict.**
  Le plan est approuvé par Mamat AVANT tout dispatch ; les sous-agents exécutent
  ce plan, toute déviation remonte à Mamat (jamais arbitrée en interne).
  Sous-agents lecture-seule : libres. Écrivain : UN à la fois, périmètre de
  fichiers déclaré. Reviewer : contexte vierge, reçoit le diff + la spec + les
  invariants (jamais le résumé de l'implémenteur), findings montrés à Mamat ;
  boucle implémentation↔review plafonnée à 1 correction, au-delà on s'arrête.
  Les consignes aux sous-agents citent fichiers/ADR précis ; leurs rapports
  citent fichier:ligne. La review ne remplace jamais les tests exécutés.
  L'orchestrateur coordonne, il ne décide pas. session-coordinator est aboli.

## Commandes

- Apps : les packages sont `@breakery/app-pos` / `@breakery/app-backoffice`
  (PAS `@breakery/pos`). Dev : `pnpm --filter @breakery/app-pos dev`.
- Tests JS : `pnpm --filter <pkg> test` (vitest). Les filtres vitest matchent le
  NOM DE FICHIER, pas le describe. Suite POS complète = timeout en local ;
  la CI est le seul filet full-suite. Le lint-ratchet CI bloque aussi sur les
  erreurs préexistantes des fichiers touchés par la PR.
- pgTAP : via MCP `execute_sql` (BEGIN/ROLLBACK), pas de runner local. SQL
  >~12 KB : POST le fichier sur l'API `database/query` (troncature inline MCP).
- Env : Vite lit `.env` à la RACINE du repo ; vitest lit `apps/<app>/.env.local`
  (copier les deux dans un worktree).

## Critical patterns — don't break these

- **DB target = Supabase cloud, PAS Docker local.** Projet V3 dev :
  `ikcyvlovptebroadgtvd` (`the-breakery-v3-dev`, ap-southeast-1). Migrations via
  MCP `apply_migration`, SQL via `execute_sql`, types via `generate_typescript_types`.
  NE JAMAIS lancer `pnpm db:reset`, `supabase start`, `supabase db reset` (Docker requis,
  échouera). Prod `abjabuniwkqpfsenxljp` = V2 monolith, lignée de migrations incompatible.
- **PIN auth fetch wrapper** — l'EF `auth-verify-pin` émet des JWT HS256 que GoTrue
  (ES256) ne valide pas par le header par défaut. Le client Supabase utilise un fetch
  wrapper qui injecte le PIN JWT via `setSupabaseAccessToken` (`packages/supabase`).
  Jamais de `Authorization` brut ni `auth.setSession`.
- **Realtime channel names uniques par mount** — StrictMode double-monte, les noms
  partagés collisionnent en silence. Voir `useKdsRealtime.ts`.
- **`packages/domain` est IO-free** — pas de fetch, pas de Supabase, pas de React.
- **Order writes = RPCs uniquement, jamais d'insert brut.** Le POS poste l'EF
  `process-payment`, qui appelle côté serveur la RPC money-path courante. Le POS
  n'appelle jamais la RPC directement. PIN discount vérifié in-EF, transporté par
  nonce `discount_authorizations`. Combos validés ET pricés serveur
  (`_resolve_combo_price_v1`) — y compris les modificateurs des composants :
  ajustements résolus contre le composant, groupes requis exigés serveur,
  ingrédients déduits/restitués (ADR-017). Plafonds promo hard-gatés sous
  advisory lock.
  Prix B2B résolu serveur (négocié > catégorie > retail), `unit_price` client ignoré.
  Déduction stock de vente via l'unique helper `_record_sale_stock_v1`.
  **Les versions de RPC bumpent souvent — TOUJOURS vérifier la version live dans
  `supabase/migrations/` + le call-site avant de te fier à un numéro.**
- **Audit-trail = table `audit_logs` UNIQUEMENT** (la vue `audit_log` singulier est
  droppée). `metadata` (contexte) et `payload` (diff) sont deux colonnes distinctes —
  ne pas fusionner. Jamais d'INSERT direct depuis le code app.
- **`stock_movements` = ledger append-only.** RLS révoque UPDATE/DELETE. Écritures
  via RPCs SECURITY DEFINER seulement. `unit` NOT NULL (auto-résolu par
  `record_stock_movement_v1` si NULL). `unit_cost` en unité de BASE (qty ×factor,
  cost ÷factor à la réception). Contrainte section movement-type-aware.
- **Idempotence, 2 saveurs** : (1) header HTTP `x-idempotency-key` pour le retry
  EF (UUID en `useRef`, helper `_shared/idempotency.ts`) ; (2) arg RPC
  `p_client_uuid`/`p_idempotency_key` pour l'idempotence métier (table dédiée,
  race gérée par catch `unique_violation` + re-read). Replay renvoie le résultat
  de la 1ʳᵉ exécution.
- **Outbox offline = formats append-only.** Un `kind` d'intent publié
  (`offlineOutbox.ts`) ne se supprime JAMAIS sans purge prouvée des terminaux :
  un poste mis à jour avec des ventes en file rejouerait dans le vide, et ces
  enregistrements sont de l'argent déjà encaissé. On ajoute un kind, on garde
  l'ancien en LECTURE (`offlineReplay.ts`). Corollaire : ne mettre en file que
  ce dont le replay ne peut pas être refusé serveur — un intent rejeté bloque
  tout le drain derrière lui (ADR-015, exclusion de `store_credit`).
- **RPC versioning monotone** — jamais éditer une `_vN` publiée. Créer `_vN+1` et
  DROP l'ancienne dans la même migration.
- **Tout bump/copie de RPC part du corps live `pg_get_functiondef`, jamais du
  fichier de migration d'origine.**
- **Migrations** : numérotation NAME-block monotone (vérifier le plus haut dans
  `supabase/migrations/` avant de choisir). **Jamais de `BEGIN;`/`COMMIT;` dans le
  corps** — MCP wrappe déjà, un COMMIT interne casse l'atomicité. Toujours régénérer
  les types après un changement de schéma (cause n°1 de CI cassée).
- **Grants anon, defense-in-depth** : `REVOKE ... FROM anon` est INSUFFISANT seul —
  anon hérite EXECUTE via PUBLIC. Toute migration REVOKE-on-functions doit aussi
  `REVOKE ... FROM PUBLIC` + `ALTER DEFAULT PRIVILEGES ... REVOKE ... FROM PUBLIC`.
  Besoin anon légitime = grant explicite par objet + `COMMENT ... 'anon-callable: <raison>'`.
- **PIN / secrets en header HTTP, jamais en body JSON** (les bodies sont loggés).
  Header dédié type `x-manager-pin`, hard cutover dans le même commit.
- **Enums : source unique = Postgres.** Aucun string littéral dérivé côté TS
  (`take_away` vs `take_out` = la classe de bug à tuer).
- **Fuseau métier = paramètre de session PostgreSQL**, posé pour toute la base
  (`Asia/Makassar`) par `20260503000000_init_extensions_enums.sql`. Un cast
  `::date` sur un `timestamptz` rend donc DÉJÀ le bon jour métier : ne jamais
  conclure à un décalage de fuseau sans l'avoir vérifié sur les données. La
  colonne `business_config.timezone` est un miroir, pas l'autorité. Le fuseau est
  une constante de déploiement (ADR-019), pas un réglage à chaud.
- ⚠️ **Bookkeeping cloud `schema_migrations` abîmé** (repair historique, ~400 lignes
  supprimées) — schéma réel intact, workflow MCP non affecté. Ne pas « réparer ».

## Git

- Branches : `feat/<scope>`, `fix/<scope>`, `chore/<scope>`. Une branche = un sujet.
  (Le préfixe `swarm/` est aboli avec le mode multi-session.)
- Commits conventionnels (`feat(scope): …`). Co-author Claude si assisté.
- **Un commit `docs(...)` par un agent sans validation préalable de Mamat =
  violation de la règle 2.**
- **Jamais de commit direct sur master.** Tout changement passe par une branche
  (`feat/`, `fix/`, `chore/`) puis une PR — même un fix d'une ligne. Si la session
  démarre sur master, créer la branche AVANT le premier commit.
- Windows : des fichiers 0-byte apparaissent à la racine (redirections ratées :
  `0`, `5`, `limite`…). `git status` avant chaque commit, suppression par chemin
  exact — JAMAIS `git clean -f` (risque d'emporter du travail non tracké).

## MCP

- Préfixe Supabase : `mcp__claude_ai_Supabase__` (jamais l'ancien plugin désactivé).
