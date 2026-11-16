# Documentation de The Breakery ERP

Réorganisée le **9 novembre 2026**, à la clôture de l'audit intégral. 43
documents périmés ont été déplacés dans `_archive_obsolete/` ; ils ne doivent
plus être lus.

## Hiérarchie de vérité

Les règles des agents vivent dans [AGENTS.md](../AGENTS.md).
[CLAUDE.md](../CLAUDE.md) est un miroir généré, pas une seconde source.

```
1. Le CODE et le SCHÉMA DB   ← ce qui EST. Vérité factuelle.
2. docs/adr/                 ← les décisions de Mamat. Texte IMMUABLE.
3. SPECS_OFFICIELS_ERP_POS.md ← la synthèse : ce qui est, ce qui est décidé.
4. docs/runbooks/            ← opérationnel, daté.
```

Si une affirmation **factuelle** d'un document contredit le code ou le schéma,
**signaler l'écart avant toute correction**. Une décision ou une intention non
implémentée reste valable : l'écart est du **backlog**, pas une erreur
documentaire.

Un énoncé **factuel** se corrige contre le code. Un énoncé **intentionnel** ne
se corrige **jamais** pour coller au code. En cas de doute sur le registre d'une
ligne : ne pas toucher, demander.

## Où lire quoi

| Besoin | Source |
|---|---|
| **Savoir ce que fait le système, et ce qui a été décidé** | [Spécifications officielles](SPECS_OFFICIELS_ERP_POS.md) |
| Connaître une décision arbitrée | [ADR](adr/) |
| Savoir ce qui reste à faire et dans quel ordre | [Master plan de finition](audit-2026-11/05_MASTER_PLAN_FINITION.md) |
| Comprendre l'architecture réelle et l'état de la production | [Cartographie](audit-2026-11/01_CARTOGRAPHIE_ET_ARCHITECTURE.md) |
| Retrouver un point de dette technique | [Dette technique](audit-2026-11/02_DETTE_TECHNIQUE_ET_NETTOYAGE.md) |
| Retrouver un arbitrage et sa preuve | [Questions de clarification](audit-2026-11/04_QUESTIONS_CLARIFICATION.md) |
| Modifier, vérifier, livrer et nettoyer | [Procédure commune de livraison](runbooks/delivery-standard.md) |
| Reprendre un chantier et rattacher ses preuves | [Outillage agents et bilans](runbooks/agent-tooling.md) |
| Retrouver les observations d'environnement | [État des environnements](runbooks/etat-environnements.md) |
| Préparer une bascule V3 | [Procédure et bilans de bascule](runbooks/production-v3-cutover.md) |
| **Sauvegarder, ou restaurer après incident** | [Sauvegardes et reprise](runbooks/sauvegardes-et-reprise.md) |
| Comprendre une coupure Internet en caisse | [Guide de caisse](runbooks/pos-internet-outage.md) |
| Vérifier un règlement différé et ses sessions | [Règlements différés](runbooks/pos-outstanding-shifts.md) |
| Fabriquer ou installer la tablette Android | [Guide tablette](runbooks/tablet-capacitor-build.md) |
| Installer une release POS + bridge sur le PC boutique | [Installation boutique](runbooks/shop-install.md) |

**La procédure de reprise existe depuis le 2026-11-09, mais elle n'est pas
éprouvée.** Celle d'avant a été archivée — elle prescrivait cinq objets SQL
inexistants. La nouvelle décrit la chaîne réelle, dont les 24 tests passent.

Deux choses manquent encore, et elles sont la priorité du projet : **aucune
sauvegarde autonome n'est installée**, et **aucune restauration n'a jamais été
menée à son terme**. Tant que la seconde n'a pas eu lieu, nous ne savons pas si
nous pouvons restaurer. Reste de la tâche `S1-01` du master plan.

## Zones et durée de vie

| Zone | Rôle | Durée de vie |
|---|---|---|
| `adr/` | Décisions arbitrées | Texte **immuable**. Changement d'avis = nouvel ADR qui supersede |
| `SPECS_OFFICIELS_ERP_POS.md` | Vérité fonctionnelle | Vivant. Se met à jour avec les faits et les décisions |
| `audit-2026-11/` | Relevé du 2026-11-09 et plan | Meurt à la livraison des 4 sprints (tâche `S4-11`) |
| `specs/` | Exécution exigée par un ADR | Meurt à la livraison de son chantier. Jamais plus de 3 vivantes |
| `runbooks/` | Procédures et relevés datés | Vivant, mais une observation datée ne prouve pas l'état courant |
| `_archive_obsolete/` | Documents périmés | **Mort. Ne pas lire.** |

Un statut de projet d'ADR n'est pas une décision actée. **Lire le corps** et le
statut avant de déclarer son périmètre applicable : un titre n'est pas un
périmètre.

## L'archive

`_archive_obsolete/` contient 43 documents déplacés le 2026-11-09 :

| Contenu | Nombre | Pourquoi |
|---|---|---|
| `objectifs/` | 20 | Décrivaient au présent une vingtaine de features inexistantes |
| `audits/` | 9 | Constats datés, non revérifiés |
| `impeccable-critique/` | 9 | Rapports de campagnes closes |
| `product/` | 2 | Contredits par le code sur des faits |
| `runbooks/disaster-recovery.md` | 1 | Prescrit 5 objets SQL qui n'existent pas |
| `runbooks/context-tools.md` | 1 | Relevés de preuves datés, non revérifiés |
| `context-profiles.md` | 1 | Les commandes `pnpm context:snapshot:*` font foi |

`docs/specs/006x-lan-device-security.md` **n'est pas archivée** : elle avait été
déplacée par erreur, puis rendue vivante le 2026-11-09. L'ADR-034 la désigne
comme sa spécification d'exécution et porte le statut **projet** — le chantier
n'est donc pas livré, et une spec ne meurt qu'à la livraison du sien. Elle est
la **seule** spec vivante ; le plafond est de trois.

Ils sont **conservés et suivis par git** : rien n'a été supprimé. Ils sont
exemptés de la garde CI des liens relatifs — leurs liens ont été écrits depuis
leur emplacement d'origine et ne résolvent plus. Les corriger reviendrait à
réécrire des documents morts.

Trois choses les tiennent fermés, par ordre de solidité :

1. **La règle de conduite** d'[AGENTS.md](../AGENTS.md), hiérarchie de vérité,
   entrée 5 : interdiction de lire et de citer. C'est elle qui tient vraiment.
2. **Un refus de lecture** dans `.claude/settings.json`
   (`Read(./docs/_archive_obsolete/**)`), versionné. Il s'applique aux outils de
   lecture de fichiers. **Limite** : il ne couvre pas un `grep -r` lancé par le
   shell sur `docs/`, et le dossier reste listable.
3. [`.claudeignore`](../.claudeignore), **déclaratif seulement** : la
   documentation du client énonce qu'un tel fichier est sans effet. Il est gardé
   parce qu'un lecteur humain y cherche cette intention, pas parce qu'il bloque
   quoi que ce soit.

**Ne pas réintroduire une ancienne architecture depuis un document archivé.** Ne
pas citer l'archive comme source. Si un fait n'est nulle part dans les zones
vivantes, **demander** : ne pas aller le chercher dans l'archive.

La **quarantaine documentaire** du lot Q est autre chose : elle vit hors du
dépôt, dans le tag `quarantine/2026-07-27`, et la garde
`scripts/ci/quarantined-paths.mjs` refuse toute référence neuve. Les deux
interdictions de lecture tiennent, pour des raisons différentes.

## Rédaction et validation

Mamat définit l'objectif et ses restrictions. Dans ce mandat, l'agent rédige,
vérifie et fait relire la documentation nécessaire, puis suit le circuit de
branche, commit et PR d'`AGENTS.md`. Les améliorations hors objectif restent des
propositions. **Les plans de session restent en conversation**, jamais en
fichier.

Le texte de décision d'un ADR est **immuable**. Son statut et son bilan factuel
peuvent être actualisés après vérification et revue, sans réécrire la décision
ni transformer une intention en livraison acquise.

Les documents evergreen utilisent des **ancres stables** — titre de section, nom
de pattern, texte cité — jamais `fichier:ligne`. Aucun compteur vivant : un
compte est soit retiré, soit **daté**. Aucun `_vN` hors ADR : on cite la
**famille**. Aucun composant PascalCase dans un document d'intention.
