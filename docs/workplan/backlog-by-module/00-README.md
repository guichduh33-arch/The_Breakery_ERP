# Travail — Backlog opérationnel AppGrav V2

> Last updated: 2026-05-03
> Source : audits 2026-04-09 (`docs/audit/`) + `CURRENT_STATE.md` + revue de code
> Scope : V2 monolith (`src/`, `supabase/`). V3 = `breakery-platform/` (hors scope, voir BMAD).

Ce dossier rassemble le **travail restant** sur AppGrav V2, traduit en tâches actionnables et priorisées. Il complète les références descriptives de `docs/reference/04-modules/` (état du système) en se concentrant sur **ce qu'il faut faire**.

---

## Légende

### Statuts

| Statut | Sens |
|--------|------|
| `TODO` | Identifiée, pas commencée |
| `DOING` | En cours (un seul `DOING` par développeur, idéalement) |
| `DONE` | Mergée + vérifiée (V3 monorepo — pas de prod déployée à ce jour) |
| `BLOCKED` | Bloquée — préciser la dépendance/raison dans `Notes` |

### Priorités

| Priorité | Sens | Délai cible |
|----------|------|-------------|
| `P0` | Bloque la production, corrompt des données, faille sécu exploitable | Hotfix immédiat |
| `P1` | Bug fonctionnel sans contournement, gap réglementaire, dette critique | Sprint courant |
| `P2` | Amélioration importante, dette modérée, UX dégradée | 1-2 sprints |
| `P3` | Nice-to-have, polish, optimisation longue traîne | Backlog ouvert |

### Estimations (T-shirt sizing)

| Taille | Effort cible | Exemples |
|--------|--------------|----------|
| `S` | ≤ 4h | Renommage, ajout `.limit()`, fix import, copy-paste config |
| `M` | 4-16h (½ à 2j) | Refactor d'un hook, nouvelle modale, migration SQL simple |
| `L` | 16-40h (2-5j) | Décomposition d'un store, nouvel écran avec backend, RLS audit |
| `XL` | > 40j | Nouveau module (expiry tracking, sub-recipes, e-Faktur) |

---

## Convention d'identifiants

`TASK-<module-id>-<seq3>` — ex. `TASK-01-001` pour la première tâche du module Auth.

| Module ID | Fichier | Domaine |
|-----------|---------|---------|
| 01 | `01-auth-permissions.md` | Authentification, sessions, permissions, RLS auth |
| 02 | `02-pos-cart-orders.md` | POS, panier, commandes, locked items, terminal |
| 03 | `03-payments-split.md` | Paiements, split, méthodes, idempotence, tip, QRIS |
| 04 | `04-kds-kitchen.md` | Kitchen Display, stations, sound, status flow |
| 05 | `05-products-categories.md` | Catalogue, modifiers, combos, variants, pricing |
| 06 | `06-inventory-stock.md` | Stock, opname, transferts, waste, locations, expiry |
| 07 | `07-purchasing-suppliers.md` | PO, suppliers, QC, AP aging, 3-way match |
| 08 | `08-customers-loyalty.md` | Customers, loyalty tiers, B2B link, birthday, dedup |

Modules supplémentaires à créer plus tard : 09-accounting, 10-reports, 11-lan, 12-mobile, 13-settings, 14-docs.

---

## Template de tâche

```markdown
### TASK-NN-NNN — [Titre court impératif] [PX] [STATUS]
**Contexte** : Pourquoi maintenant ? Référence audit / bug observé / gap fonctionnel.
**Critère d'acceptation** :
- [ ] Critère testable 1
- [ ] Critère testable 2
**Fichiers concernés** : `src/services/...`, `supabase/migrations/...`, etc.
**Dépend de** : `TASK-YY-NNN` (ou « aucune »)
**Estimation** : `S` / `M` / `L` / `XL`
**Risques** : effets de bord potentiels, données touchées, surface affectée
**Notes** : suivi, hypothèses, liens utiles
```

Tous les champs sont obligatoires sauf `Notes` (libre). Un champ vide doit afficher `—` plutôt que d'être omis.

---

## Workflow

1. **Ajouter une tâche** : éditer le fichier `0X-<module>.md`, prendre le prochain `TASK-NN-NNN` libre. Pas besoin d'ouvrir une PR pour l'ajout, mais référencer la source d'audit.
2. **Prioriser** : assigner `P0`/`P1`/`P2`/`P3`. Si le scope du sprint change, mettre à jour `00-roadmap-globale.md`.
3. **Démarrer** : passer le statut à `DOING` au début du travail. Mettre son nom/initiales dans `Notes` si plusieurs devs.
4. **Bloquer** : si une dépendance externe surgit, passer à `BLOCKED` et expliquer la raison + qui peut débloquer.
5. **Fermer** : `DONE` uniquement après merge + déploiement + vérification fonctionnelle. Lier la PR/commit dans `Notes`.
6. **Décomposer** : une tâche `XL` doit être découpée en sous-tâches `M`/`L` avant d'être prise.

---

## Cadence recommandée

- **Sprint = 2 semaines** (cohérent avec `CURRENT_STATE.md` Sprints 0-2 historiques).
- **Capacité estimée** : ~25 points / dev / sprint où `S=1, M=3, L=8, XL=21`.
- **Revue d'audit** : tous les 2 sprints, relire `docs/audit/` pour détecter des régressions ou nouveaux findings.
- **Régénération metrics** : à chaque sprint, vérifier que les findings résolus sont passés à `DONE` et radiés des audits si nécessaire.

---

## Pointeurs

- Roadmap globale + dépendances inter-modules : [`00-roadmap-globale.md`](./00-roadmap-globale.md)
- État détaillé du système (référence) : [`../04-modules/`](../04-modules/)
- Audit complet (8 rapports + executive summary) : [`../../audit/`](../../audit/)
- Plan d'implémentation original : [`../../audit/IMPLEMENTATION_PLAN.md`](../../audit/IMPLEMENTATION_PLAN.md)
- Sprint progress global : [`../../../CURRENT_STATE.md`](../../../CURRENT_STATE.md)
- Conventions code : [`../../../CLAUDE.md`](../../../CLAUDE.md)
