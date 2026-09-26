# Staging et validations cloud

Procédure à valider par Mamat avant commit.

## État et périmètre

Le workflow [staging-deploy.yml](staging-deploy.yml) s'arrête volontairement
avant le déploiement des Edge Functions et les builds. Renseigner ses secrets
ne lève pas cet arrêt. Il ne constitue pas une procédure de bascule production.

La cible de développement V3 est `ikcyvlovptebroadgtvd`. Son historique cloud
ne permet pas un replay global fiable. Ne pas renuméroter les migrations
historiques, réparer le bookkeeping ou lancer un reset.

Avant toute activation : faire valider une procédure DB ciblée, ses contrôles,
la cible et le retour arrière. Le présent document n'autorise aucune activation.

## Contrôles réellement disponibles

- [ci.yml](ci.yml) : gardes, build et tests applicatifs ; pas de certification DB.
- [pgtap-pr.yml](pgtap-pr.yml) : classification de toutes les PR et verdict
  `db-gate`. Seuls les changements DB, du workflow ou de son classificateur
  exécutent pgTAP ; un lancement manuel l'exige toujours. Un verdict front-only
  « non applicable » n'est pas une exécution de tests DB.
- [pgtap-nightly.yml](pgtap-nightly.yml) : contrôles périodiques sur dev.
- [vitest-live.yml](vitest-live.yml) : tests RPC manuels, après autorisation
  explicite des mutations dev ; aucun test trouvé n'est pas une réussite.
- [playwright-e2e.yml](playwright-e2e.yml) : E2E manuels, builds et serveurs
  locaux contre dev. Aucun résultat ne prouve l'impression physique en boutique.

Ne pas superposer des tests écrivant dans la base partagée. Vérifier les runs
actifs et les horaires des workflows avant de déclencher une suite.

## Contrats des secrets

Ne vérifier que les noms et la présence, jamais journaliser les valeurs.

| Usage | Noms attendus |
|---|---|
| Tests pgTAP | `V3_DEV_PG_POOLER_URL` |
| Tests live RPC | `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| E2E | `VITE_SUPABASE_ANON_KEY`, `E2E_PIN_ADMIN`, `E2E_PIN_CASHIER`, `V3_DEV_PG_POOLER_URL` |
| Staging bloqué | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF_STAGING`, `SUPABASE_DB_PASSWORD_STAGING`, `SUPABASE_URL_STAGING`, `SUPABASE_ANON_KEY_STAGING`, `SUPABASE_SERVICE_ROLE_STAGING` |

Les variables runtime `SUPABASE_ANON_KEY` et `VITE_SUPABASE_ANON_KEY` du job
live proviennent du même secret existant `VITE_SUPABASE_ANON_KEY`.
Les DSN Sentry staging sont distincts des identifiants Supabase.
La présence d'un nom ne prouve ni la validité de sa valeur ni ses droits.

## Hébergement

Le BO est publié sur Vercel. Le POS reste local, servi par
[print-bridge](../../apps/print-bridge/README.md) via `POS_DIST_DIR`.
Ne pas activer les anciennes étapes de publication POS Vercel du staging.

La préparation production est décrite dans
[la procédure de bascule V3](../../docs/runbooks/production-v3-cutover.md).
