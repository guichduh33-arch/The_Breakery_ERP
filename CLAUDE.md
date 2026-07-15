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

1. **Tu ne crées JAMAIS de fichier `.md`, `.txt`, rapport, plan, spec, INDEX,
   compte-rendu ou résumé de session.** Si un document te semble nécessaire,
   propose son contenu dans ta réponse ; Mamat seul décide de l'écrire.
2. **Tu ne commites JAMAIS un fichier de `docs/`.** Même modifié sur demande,
   le commit de doc est réservé à Mamat.
3. **Les plans de session vivent dans la conversation** (mode plan), jamais en
   fichier. Ce qui mérite de survivre à une session devient un ADR — écrit et
   commité par Mamat — ou disparaît avec le contexte.
4. **Un ADR ne se modifie jamais.** Changement d'avis = nouvel ADR numéroté qui
   supersede l'ancien (`Statut: remplacé par ADR-00XX`).
5. **Information manquante → tu t'arrêtes et tu demandes.** Tu n'inventes pas,
   tu ne déduis pas « ce qui semble logique », tu ne vas pas fouiller la quarantaine.
6. **Aucune décision autonome** : architecture, renommage, suppression, choix de
   librairie, changement de comportement → accord explicite de Mamat AVANT l'action.
7. **Périmètre strict** : tu touches les fichiers nécessaires à la tâche, rien d'autre.

## Règles générales

- Do what has been asked; nothing more, nothing less.
- ALWAYS read a file before editing it.
- NEVER commit secrets, credentials, or .env files.
- Keep files under 500 lines.
- Validate input at system boundaries.
- Monorepo pnpm/turbo : code dans `apps/{pos,backoffice}/src`,
  `packages/{domain,supabase,ui,utils}/src`, `supabase/{functions,migrations,tests}`.
  Tests co-localisés dans `__tests__/`.
- **Une seule session Claude Code à la fois sur ce repo.** Pas de swarm,
  pas d'agents nommés qui s'auto-coordonnent, pas de sessions parallèles.

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
  (`_resolve_combo_price_v1`). Plafonds promo hard-gatés sous advisory lock.
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
- ⚠️ **Bookkeeping cloud `schema_migrations` abîmé** (repair historique, ~400 lignes
  supprimées) — schéma réel intact, workflow MCP non affecté. Ne pas « réparer ».

## Git

- Branches : `feat/<scope>`, `fix/<scope>`, `chore/<scope>`. Une branche = un sujet.
  (Le préfixe `swarm/` est aboli avec le mode multi-session.)
- Commits conventionnels (`feat(scope): …`). Co-author Claude si assisté.
- **Un commit `docs(...)` par un agent = violation de la règle 2.**

## MCP

- Préfixe Supabase : `mcp__claude_ai_Supabase__` (jamais l'ancien plugin désactivé).
