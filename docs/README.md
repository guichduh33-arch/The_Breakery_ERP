# 📚 The Breakery ERP — Documentation

> **Resynchronisé le 2026-07-28.** L'ancienne carte (remise à plat du 2026-07-04,
> arbre `workplan/` / `reference/` / `superpowers/`) est obsolète. Ces zones ont
> été mises en quarantaine, puis **sorties du dépôt le 2026-07-28** — elles
> restent résolubles, voir la **note de résolution** en bas de page.

## ⚖️ Hiérarchie de vérité

La loi est **[`../CLAUDE.md`](../CLAUDE.md)** ; en cas de conflit avec tout autre
document, CLAUDE.md gagne. Résumé de la hiérarchie qu'il fixe :

1. **Le code et le schéma DB** — ce qui EST. Vérité factuelle.
2. **[`adr/`](adr/)** — ce qui DOIT ÊTRE. Décisions de Mamat, immuables : un
   changement d'avis = un nouvel ADR numéroté qui supersede l'ancien.
3. **[`objectifs/`](objectifs/)** — ce qui est VOULU. Écrit par Mamat, une fiche
   par module.
4. **[`product/`](product/), [`runbooks/`](runbooks/)** — opérationnel.
5. **Zones sorties du dépôt** (ancien `_quarantine/`) — MORTES. N'existent plus.
   Interdiction de lire/citer/grep. Un chemin cité par un document immuable se
   résout par le tag git — voir la note de résolution en bas de page.

Si un document contredit le code, le document a tort : on le signale, on ne
« corrige » ni le code ni silencieusement le document.

## 🗂️ Structure

```
docs/
├── README.md            ← tu es ici (carte + hiérarchie de vérité)
├── adr/                 ← décisions numérotées, append-only, immuables
├── objectifs/           ← fiches module « objectif métier » (une par module)
├── specs/               ← specs d'exécution exigées par un ADR (≤ 3 vivantes,
│                          nom <ADR>x-<sujet>.md ; une spec meurt à la livraison)
├── product/             ← référence produit (DESCRIPTION.md)
└── runbooks/            ← procédures opérationnelles (disaster-recovery)
```

## 📐 Règles documentaires (rappel — détail dans CLAUDE.md)

- **Par défaut un agent ne crée ni ne commite un fichier de `docs/`** : il propose le
  contenu en conversation. **Exception, sur validation explicite de Mamat en séance** :
  il crée le fichier, et peut le commiter sur une branche dédiée (`docs/…`, `feat/…`,
  `fix/…`, **jamais `master`**), sans push sans demander. Détail : `CLAUDE.md` règles 1-2.
- Un ADR ne se modifie jamais ; les plans de session vivent en conversation.
- Documents évergreen (fiches objectifs, README) : date de dernière révision en
  tête, mise à jour en place. Langue : français pour la doc, anglais pour les
  noms de code/UI. Références code au format `chemin/fichier.ts:42`.

---

## 🔖 Note de résolution — les chemins des zones sorties du dépôt

Le contenu de l'ancien `docs/_quarantine/` (597 fichiers) est **sorti du dépôt le
2026-07-28**. Il n'est pas perdu : un **tag git annoté** le conserve à vie.

Tout chemin de l'une de ces **huit entrées** — `_archive/`, `audit/`,
`design-audits/`, `reference/`, `superpowers/`, `workplan/`, `CLAUDE-old.md`,
`DESIGN_POS_AND_BACKOFFICE.md` — cité par un document immuable (un ADR, une
migration appliquée) se résout ainsi :

```
git show quarantine/2026-07-27:docs/_quarantine/<chemin>
```

Exemple, pour la conséquence 4 d'ADR-004 :

```
git show quarantine/2026-07-27:docs/_quarantine/workplan/remise-a-plat/00-AMENDEMENTS-V13.md
```

**Un tag n'archive pas, il CONSERVE.** C'est pourquoi aucun ADR n'a été modifié
pour retirer ces chemins : ils ne sont pas morts, ils sont résolubles autrement.
`docs/adr/**` et `supabase/migrations/**` ont donc le droit permanent de les
citer — un document immuable a le droit de citer un chemin historique.

Ce fichier-ci est le seul document vivant autorisé à nommer ces zones : c'est
lui qui porte la carte et sa résolution.
