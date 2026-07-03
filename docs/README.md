# 📚 The Breakery ERP — Documentation

> **Réorganisé le 2026-07-04** (remise à plat). Ancienne carte : voir l'historique git de ce fichier.

## ⚖️ Hiérarchie de vérité — à lire avant tout

En cas de contradiction entre deux sources, l'ordre de foi est :

1. **Le code du monorepo** (apps/, packages/, supabase/) — seule vérité technique. Pour les RPCs, la version live = la plus haute migration.
2. **[`workplan/remise-a-plat/`](workplan/remise-a-plat/)** — **LA LIGNE DE CONDUITE ACTUELLE** : 26 fiches d'analyse réel-vs-demandé (une par module, code vérifié au commit `5b0fa92`), l'index priorisé ([`00-INDEX.md`](workplan/remise-a-plat/00-INDEX.md) : vagues 0→3, décisions, critères de sortie) et la checklist doc ([`00-AMENDEMENTS-V13.md`](workplan/remise-a-plat/00-AMENDEMENTS-V13.md)).
3. **[`product/`](product/)** — la référence produit (Description v1.2 → v1.3, non technique). C'est le cahier des charges ; la remise à plat mesure le code contre lui.
4. **[`../CLAUDE.md`](../CLAUDE.md)** — état courant condensé + conventions agents (Active Workplan).
5. **[`adr/`](adr/)** — décisions actées (ex. [ADR-003 NON-PKP](adr/003-pkp-status-non-pkp.md), [ADR-004 pas de péremption/FIFO](adr/004-pas-de-peremption-ni-fifo-stock.md)). Une décision ADR ne se rediscute pas, elle se remplace par un nouvel ADR.

**`reference/` ne fait plus foi** — voir son [README](reference/README.md) : les chapitres dangereux (V2, Docker, RBAC fictif) ont été **supprimés le 2026-07-04** (récupérables via git) ; les chapitres restants portent un avertissement STALE et seront régénérés depuis le code, module par module, après validation des corrections (Phase 3 de la remise à plat).

## 🗂️ Structure

```
docs/
├── README.md                    ← tu es ici (carte + hiérarchie de vérité)
├── V2_V3_GLOSSARY.md            ← pont V2→V3 (renommages) — fiable
├── DESIGN_POS_AND_BACKOFFICE.md ← design détaillé des 2 apps
├── product/                     ← RÉFÉRENCE PRODUIT (Description v1.3 à venir)
├── adr/                         ← décisions d'architecture et produit (numérotées, append-only)
├── workplan/                    ← LE TRAVAIL
│   ├── remise-a-plat/           ← ★ ligne de conduite actuelle (fiches + index + amendements)
│   ├── plans/ · specs/          ← historique par session (S50+ actifs ; avant → archive/)
│   ├── audits/                  ← audits datés (2026-06-27 intégral = source de la roadmap P0-P3)
│   └── refs/                    ← notes de référence de session
├── superpowers/{specs,plans}/   ← specs/plans du flux brainstorm→plan (datés, append-only)
├── reference/                   ← doc technique STALE (avertissements en place ; régénération progressive)
├── runbooks/                    ← disaster-recovery (réel, 6 scénarios)
├── design-audits/ · audit/      ← audits UX et métier datés (exacts à leur date)
└── _archive/                    ← tout ce qui ne fait plus foi (V2, screenshots pré-code, backlog figé S14-S30)
```

## 🧭 Où vont les futures docs (règles d'emplacement)

| Tu produis… | Emplacement | Règle |
|---|---|---|
| Une spec de design (avant code) | `superpowers/specs/AAAA-MM-JJ-<sujet>-design.md` | datée, append-only — jamais réécrire une ancienne |
| Un plan d'implémentation | `superpowers/plans/` ou `workplan/plans/AAAA-MM-JJ-session-N-*.md` | idem ; INDEX par session |
| Une décision produit/architecture | `adr/NNN-<slug>.md` (numéro suivant) | une décision = un fichier ; remplacée par un nouvel ADR, jamais éditée |
| Une mise à jour de fiche module | `workplan/remise-a-plat/NN-<module>.md` | re-vérifier contre le code + note de mise à jour en tête |
| La nouvelle référence produit | `product/DESCRIPTION.md` | v1.3 = v1.2 + `remise-a-plat/00-AMENDEMENTS-V13.md` |
| La doc technique régénérée | `reference/<chapitre>/` | UNIQUEMENT depuis le code, après la Phase 2 ; supprime l'avertissement du chapitre régénéré |
| Un audit | `workplan/audits/AAAA-MM-JJ-<sujet>.md` | daté ; l'ancien superseded part en `audits/archive/` |
| Du périmé / superseded | `_archive/` ou le `archive/` du dossier d'origine | ne JAMAIS laisser deux versions actives du même document |

## 📐 Conventions
- Documents datés `AAAA-MM-JJ-…` = photographies : exacts à leur date, jamais réécrits.
- Documents évergreen (README, fiches remise-à-plat, DESCRIPTION) : portent une date de dernière vérification en tête et se mettent à jour.
- Liens internes relatifs ; références code `chemin/fichier.ts:42` ; diagrammes Mermaid.
- Langue : français pour la doc, anglais pour les noms de code/UI.
