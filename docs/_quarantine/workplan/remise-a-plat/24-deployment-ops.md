# Module 24 — Mises à jour & exploitation

> ⚠️ **Mise à jour S58 (2026-07-04, `swarm/session-58`)** : **D1.1 livré** — `staging-deploy.yml` (push retiré) et `playwright-e2e.yml` (cron retiré) sur `workflow_dispatch` seul, avec commentaires de réactivation ; plus d'échec automatique. D1.2 (environnement GitHub `staging`) et D1.3 (DSN Sentry) restent à faire. Le reste de la fiche reste daté `5b0fa92`.

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 24. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel sur la chaîne de livraison
> **Verdict global de l'analyse :** La doc surclame sur son cœur : la chaîne de déploiement staging **échoue en 0 s à chaque push depuis des mois** (environnement GitHub `staging` jamais configuré, secrets absents) et il n'existe aucune cible de production V3 — le « vrai magasin » n'est pas déployable par cette chaîne. Le runbook 6 scénarios est en revanche bien réel, et l'intégration Sentry est câblée côté code mais sans DSN provisionné démontrable.

## A. Ce qui fonctionne réellement (code vérifié)

- **Workflow de déploiement staging écrit et complet** (`.github/workflows/staging-deploy.yml`) : déclenché sur push `master`/`swarm/session-**` + dispatch manuel ; gate d'approbation via `environment: staging` (l.52-54) ; sanity-check du project-ref (l.87-95) ; `supabase db push` des migrations (l.103-110) ; déploiement de toutes les EFs (l.112-117) ; build des 2 apps câblées staging (l.119-128) ; artefacts dist. Étapes Vercel présentes mais **désactivées** (`if: false`, l.150-174) — aucun hébergement front automatisé. [CI — mais voir écart C-B1.1/B1.2 : ne s'exécute jamais avec succès]
- **CI de validation avant merge réellement bloquante** (`.github/workflows/ci.yml`, verte au 2026-07-03) + smoke pgTAP PR (`pgtap-pr.yml`) — c'est la partie « rien ne part si c'est rouge » qui fonctionne (détail au module 23). [CI]
- **Runbook de reprise après incident réel** : `docs/runbooks/disaster-recovery.md` (440 lignes) — 6 scénarios vérifiés : 1. perte de connectivité Supabase (l.23), 2. restauration DB via PITR (l.81), 3. panne de l'EF `auth-verify-pin` (l.153), 4. migration corrompue / stratégie de rollback (l.222), 5. panne totale du poste POS (l.292, avec « Recovery time » cible l.344), 6. bourrage file d'impression / panne imprimante (l.352). (Seule exception autorisée à l'exclusion de `docs/` comme source : ce fichier est l'objet même de la revendication.) [Doc opérationnelle]
- **Intégration Sentry câblée dans les 2 apps** : `apps/pos/src/lib/sentry.ts` et `apps/backoffice/src/lib/sentry.ts` (`Sentry.init` + browserTracing + session replay, `tracesSampleRate: 0.2`), appelées au boot (`apps/pos/src/main.tsx:8`, `apps/backoffice/src/main.tsx:7`), gated sur `VITE_SENTRY_DSN_POS`/`VITE_SENTRY_DSN_BACKOFFICE` (no-op sans DSN). Pont breadcrumbs depuis le logger maison (`packages/utils/src/logger.ts:2`, `setBreadcrumbHook`). Côté serveur : **rien** — l'EF `process-payment` porte seulement un commentaire « Logs Sentry server-side optionnel » (`supabase/functions/process-payment/index.ts:4`). [Code câblé, provisioning non démontré]
- **Documentation de provisionnement** : `.github/workflows/STAGING_SETUP.md` liste les 10+ secrets requis (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF_STAGING`, `STAGING_POS_URL`, `E2E_PIN_*`…). Vérifié via `gh secret list` : **seuls 2 secrets existent** (`V3_DEV_PG_POOLER_URL`, `SUPABASE_SERVICE_ROLE_KEY`) ; l'environnement GitHub `staging` renvoie 404 (jamais créé).
- **Notes de version** : `CHANGELOG.md` explicitement figé à v0.1.0 (2026-05-03) — l'historique vivant est tenu par session dans `docs/workplan/` ; un seul tag git (`v0.1.0`).

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 — Environnement d'essai dédié, séparé de la production, qui reçoit et valide chaque changement avant le vrai magasin, avec approbation manuelle.
- B1.2 — Chaîne de livraison automatisée.
- B1.3 — Manuel de reprise après incident : 6 scénarios avec objectifs de délai de reprise.
- B1.4 — Les erreurs utilisateurs remontent automatiquement dans un outil de surveillance.

### B2. Annoncé « À venir »
- B2.1 — Exercice réel de restauration de sauvegarde (jamais exécuté ni chronométré), puis répétition trimestrielle.
- B2.2 — Réglage fin des alertes de surveillance.
- B2.3 — Surveillance côté serveur.
- B2.4 — Budgets de performance (4G Lombok).
- B2.5 — Notes de version automatiques.

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Env d'essai séparé de la prod, valide chaque changement avant le vrai magasin, approbation manuelle | Le workflow existe avec le gate d'approbation, mais **il échoue en 0 s à chaque push** (runs 28660963637, 28658771391… tous `failure`) : l'environnement GitHub `staging` n'a jamais été créé (API 404) et aucun des secrets `*_STAGING` n'existe. De plus « avant le vrai magasin » est trompeur : il n'existe **aucune production V3** (le ref prod `abjabuniwkqpfsenxljp` est le monolithe V2, incompatible avec la lignée de migrations V3) ; l'« environnement d'essai » `ikcyvlovptebroadgtvd` est en réalité l'unique environnement, alimenté à la main via MCP en session, pas par la chaîne | 🔴 MANQUANT |
| B1.2 | Chaîne de livraison automatisée | Automatisée sur le papier (workflow complet migrations+EFs+builds), jamais exécutée avec succès ; hébergement front désactivé (`if: false`) ; livraison réelle = MCP `apply_migration`/`deploy_edge_function` manuel en session | 🔴 MANQUANT |
| B1.3 | Manuel de reprise 6 scénarios + objectifs de délai | `docs/runbooks/disaster-recovery.md` : 6 scénarios confirmés, objectifs de temps présents (ex. l.344) ; le manuel note lui-même qu'il doit être « drillé » avant cutover | ✅ CONFORME |
| B1.4 | Erreurs remontées automatiquement dans un outil de surveillance | Intégration Sentry réelle et câblée au boot des 2 apps, mais no-op sans DSN : les builds CI passent un DSN vide (`ci.yml:156-157`), les secrets `SENTRY_DSN_*_STAGING` n'existent pas, et aucun build hébergé n'est démontrable. La remontée effective dépend d'un DSN dans le `.env` des postes réels | ⚠️ À CONFIRMER (hors repo : projet Sentry + DSN provisionnés ?) |

**Bonus code (le code fait plus que la doc) :**
- 🔵 Session replay Sentry (10 % des sessions, 100 % sur erreur) + breadcrumbs du logger maison et stats de dédoublonnage LAN prêtes pour Sentry (`apps/pos/src/features/lan/lanHub.ts:128`) — plus riche que « les erreurs remontent ».
- 🔵 `STAGING_SETUP.md` : le mode d'emploi complet du provisionnement existe déjà — il n'a « que » jamais été exécuté.
- 🔵 Concurrence de déploiement sérialisée (`concurrency: staging-deploy`, l.36-39) et sanity-check anti-mauvais-projet (l.87-95).

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
- **Arrêter l'hémorragie de runs rouges** : tant que staging n'est pas provisionné, restreindre le déclencheur de `staging-deploy.yml` à `workflow_dispatch` seul (retirer `push: master` / `swarm/session-**`) — chaque push à master produit aujourd'hui un échec en 0 s qui banalise le rouge. Done : plus d'échec automatique ; réactivation du trigger push documentée dans le workflow.
- **Créer l'environnement GitHub `staging`** (Settings → Environments) avec reviewer requis — c'est la cause probable des échecs en 0 s. Done : un `workflow_dispatch` atteint au moins l'étape « Link to staging ».
- **Trancher le sort du DSN Sentry** : soit provisionner un projet Sentry et documenter le DSN dans `.env`/secrets (Done : événement de test visible dans Sentry), soit requalifier la doc (D4).

### D2. Chantiers moyens (1 session, plan requis)
- **Provisionner la chaîne staging de bout en bout** : suivre `.github/workflows/STAGING_SETUP.md` — secrets Supabase (`SUPABASE_ACCESS_TOKEN`, `*_STAGING`), puis run `workflow_dispatch` complet. Attention au caveat bookkeeping : `supabase db push --include-all` contre `ikcyvlovptebroadgtvd` risque de rejouer/conflicter avec l'état réel du `schema_migrations` abîmé (~400 lignes supprimées, cf. CLAUDE.md) — à tester sur un run manuel AVANT de réactiver le trigger push. ⚠️ à confirmer en DB live.
- **Hébergement des fronts staging** : activer les étapes Vercel (retirer `if: false`, câbler `VERCEL_*`) ou choisir un autre hébergeur ; poser `STAGING_POS_URL`/`STAGING_BO_URL`. Débloque aussi le E2E nightly (module 23 D3).

### D3. Chantiers lourds (spec dédiée avant code)
- **Définir la vraie cible de production V3** : aujourd'hui il n'y a ni environnement de prod V3 ni plan de cutover exécutable par CI. Spec dédiée : nouveau projet Supabase prod V3 (ou migration du ref V2), stratégie de migration des données V2→V3, promotion staging→prod avec approbation, DNS/hébergement des fronts du magasin. C'est le prérequis pour que « avant le vrai magasin » ait un sens.
- **Exercice de restauration PITR (B2.1)** : à exécuter et chronométrer contre un projet jetable (le runbook scénario 2 le prévoit) — coordonner avec le propriétaire du projet Supabase (coût d'un projet temporaire).
- **Surveillance côté serveur (B2.3)** : Sentry (ou logs structurés + alertes) dans les EFs Deno — seul un commentaire d'intention existe (`process-payment/index.ts:4`).

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
- **B1.1/B1.2 à réécrire d'urgence** — formulation honnête : « Une chaîne de livraison automatisée vers un environnement d'essai est écrite (workflow complet avec approbation manuelle) mais pas encore provisionnée : les livraisons se font aujourd'hui manuellement, migration par migration, sur l'environnement de développement cloud. Il n'existe pas encore d'environnement de production de la nouvelle version. » Le statut du module devrait être **Partiel**, pas « Opérationnel sur la chaîne de livraison ».
- **B1.4 à conditionner** : « la remontée automatique des erreurs est intégrée au logiciel et s'active dès que le compte de surveillance est configuré ».
- B2.5 : noter que le CHANGELOG est volontairement figé et que l'historique par session en tient lieu — les « notes de version automatiques » partiraient de là.

## E. Dépendances croisées

- **Module 23 (Qualité & tests)** : le E2E nightly rouge a la même cause racine (staging non provisionné, D2) ; la CI verte de validation est le maillon amont de cette chaîne.
- **Module 25 (Sécurité)** : le provisionnement des secrets (service-role, access token) doit respecter les règles du projet (jamais dans les bundles clients — `staging-deploy.yml:15`) ; la politique de rotation des clés annoncée « à venir » au module 25 conditionne D2.
- **Module 21 (réseau local)** : les scénarios 5-6 du runbook (poste POS, imprimantes) sont l'interface ops de ce module.
- **Tous les modules** : l'absence de cible de production V3 (D3) est LA dépendance systémique — aucune revendication « en production » des autres modules ne peut être servie par cette chaîne aujourd'hui.
