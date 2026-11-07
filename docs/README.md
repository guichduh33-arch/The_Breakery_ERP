# Documentation de The Breakery ERP

Révision ciblée : 8 novembre 2026 — navigation et procédure de livraison.

## Sources et registres

Les règles des agents vivent dans [AGENTS.md](../AGENTS.md). [CLAUDE.md](../CLAUDE.md)
est un miroir généré, pas une seconde source à modifier.

- Le code et le schéma DB réel établissent les faits. Les migrations décrivent
  l'histoire dans Git ; elles ne prouvent pas seules l'application sur une cible.
- Les [ADR](adr/) portent les décisions validées. Une décision non implémentée
  reste valable : son écart avec le code est du backlog.
- Les [objectifs](objectifs/) portent les intentions de Mamat.
- La [référence produit](product/DESCRIPTION.md) et les [runbooks](runbooks/)
  décrivent le fonctionnement et les procédures, sous contrôle des sources.
- Les [audits](audits/) sont des constats datés. Un audit, une mémoire ou un
  résumé ne certifie pas l'état actuel ni une autorisation d'action.

Un écart factuel se signale avant correction. Une intention ne se réécrit pas
pour coller à l'implémentation. La génération de contexte aide à retrouver les
sources ; elle n'en remplace ni la lecture ni la vérification.

## Entrées de lecture

| Besoin | Source |
|---|---|
| Modifier, vérifier, livrer et nettoyer | [Procédure commune de livraison](runbooks/delivery-standard.md) |
| Reprendre un chantier et rattacher ses preuves | [Outillage agents et bilans](runbooks/agent-tooling.md) |
| Retrouver les observations d'environnement | [État des environnements](runbooks/etat-environnements.md) |
| Préparer une bascule V3 | [Procédure et bilans de bascule](runbooks/production-v3-cutover.md) |
| Préparer un retour ou une reprise après incident | [Reprise et sauvegardes](runbooks/disaster-recovery.md) |
| Comprendre une coupure Internet | [Guide de caisse](runbooks/pos-internet-outage.md) |
| Vérifier un Outstanding et ses shifts | [Règlements différés](runbooks/pos-outstanding-shifts.md) |
| Fabriquer ou installer Android | [Guide tablette](runbooks/tablet-capacitor-build.md) |
| Charger un contexte ciblé | [Profils de contexte](context-profiles.md) |

Pour chercher une règle métier, commencer par le domaine dans les objectifs et les
skills, puis lire les ADR concernés. Pour agir, suivre le runbook du parcours.
Les audits datés et les anciens bilans servent à retrouver une preuve, pas à
remplacer la procédure courante. La procédure commune n’est pas un plan de session.

## Catégories documentaires

| Zone | Rôle et durée de vie |
|---|---|
| `adr/` | Décisions ; texte immuable, nouvelle décision dans un nouvel ADR |
| `objectifs/` | Intentions métier evergreen écrites par Mamat |
| `product/` | Description factuelle et intentions identifiées séparément |
| `runbooks/` | Procédures et bilans factuels datés, avec leurs limites |
| `specs/` | Exécution exigée par un ADR ; supprimée à livraison après validation |
| `audits/` | Relevés historiques ; revalider les constats avant réemploi |

Un statut de projet d'ADR n'est pas une décision actée. Lire le corps et le
statut avant de déclarer son périmètre applicable.

## Rédaction et validation

Mamat définit l’objectif et ses restrictions. Dans ce mandat, l’agent rédige,
vérifie et fait relire la documentation nécessaire, puis suit le circuit de branche,
commit et PR d’AGENTS.md. Les améliorations hors objectif restent des propositions.
Les plans de session restent en conversation.

Le texte de décision d'un ADR est immuable. Son statut et son bilan factuel
peuvent être actualisés après vérification et revue, sans transformer une intention en
livraison acquise. Les documents evergreen utilisent des ancres stables,
sans numéros de ligne ni compteurs vivants non datés.

## Documents historiques sortis de l'arbre

Les zones documentaires retirées du dépôt restent conservées dans l'histoire
Git. Les références historiques d'artefacts immuables ne sont pas réécrites
pour les faire disparaître. Cela n'autorise aucune lecture de ces contenus.

Pour travailler aujourd'hui, utiliser les zones vivantes ci-dessus et les
preuves actuelles. Ne pas réintroduire une ancienne architecture depuis un
document historique. La garde de références interdites conserve son plafond
de baseline ; une correction ne l'augmente jamais.
