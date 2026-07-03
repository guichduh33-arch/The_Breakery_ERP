# The Breakery ERP — Documentation de référence technique

> ⚠️ **AVERTISSEMENT (2026-07-04, remise à plat) : ce dossier NE FAIT PLUS FOI.**
> L'essentiel de son contenu date du 2026-05-03 (S13) et décrit un état pré-refactor, parfois l'architecture V2 jamais portée. **La vérité technique = le code** ; **la ligne de conduite = [`../workplan/remise-a-plat/`](../workplan/remise-a-plat/)** (fiches réel-vs-demandé par module, vérifiées au commit `5b0fa92`).

## État des chapitres

| Chapitre | État 2026-07-04 |
|---|---|
| `00-overview/` | 🟠 STALE — vision business OK, tech-stack périmé |
| ~~`01-architecture/`~~ | ❌ **SUPPRIMÉ** (décrivait le layout monolithe V2) — récupérable via git ; à régénérer depuis le code |
| `02-design-system/` | 🟠 STALE — tokens canoniques fiables, mais ~35 liens morts |
| ~~`03-database/`~~ | ❌ **SUPPRIMÉ** (pointait le projet Supabase **V2** + RPCs fictives — dangereux) |
| `04-modules/` | 🟠 STALE (fiches S13) — **les fiches [`../workplan/remise-a-plat/`](../workplan/remise-a-plat/) font foi** ; régénération module par module en Phase 3 |
| `05-integrations/` | 🟠 STALE (08-claude-proxy supprimé : composant fantôme ; capacitor/PWA décrivent du non-implémenté) |
| `06-lan-architecture/` | 🟠 STALE — le mesh décrit existe mais est **du code mort non monté** (cf. fiche remise-à-plat 21) |
| ~~`07-security/`~~ | ❌ **SUPPRIMÉ** (RBAC fictif, template audit_logs faux) — la fiche remise-à-plat 25 fait foi |
| ~~`08-flows-end-to-end/`~~ | ❌ **SUPPRIMÉ** (money-path mal nommé, EF process-payment absente) |
| ~~`09-testing/`~~ | ❌ **SUPPRIMÉ** (prescrivait `npm` et des chemins V2) — la fiche remise-à-plat 23 fait foi |
| ~~`10-deployment-ops/`~~ | ❌ **SUPPRIMÉ** (commandes Docker interdites + mauvais projet Supabase — risque n°1) — fiche 24 + `../runbooks/` font foi |
| `11-conventions/` | ✅ Fiable (sauf `02-file-organization`) |
| `12-appendices/` | 🟠 (02-permission-codes-matrix supprimée : matrice fausse — le catalogue réel = `packages/supabase/src/rls/permissions.ts` + tables roles/permissions live) |

## Règle de régénération
Un chapitre supprimé ou STALE ne se « corrige » pas à la main : il se **régénère depuis le code**, après la Phase 2 de la remise à plat, chapitre par chapitre — et cette table est mise à jour à chaque régénération (le chapitre régénéré repasse ✅ avec sa date).

Pont V2→V3 (renommages) : [`../V2_V3_GLOSSARY.md`](../V2_V3_GLOSSARY.md).
