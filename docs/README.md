# 📚 The Breakery ERP — Documentation

> **Resynchronisé le 2026-07-24.** L'ancienne carte (remise à plat du 2026-07-04,
> arbre `workplan/` / `reference/` / `superpowers/`) est obsolète : ces zones ont
> été déplacées dans `_quarantine/` — voir l'historique git de ce fichier.

## ⚖️ Hiérarchie de vérité

La loi est **[`../CLAUDE.md`](../CLAUDE.md)** ; en cas de conflit avec tout autre
document, CLAUDE.md gagne. Résumé de la hiérarchie qu'il fixe :

1. **Le code et le schéma DB** — ce qui EST. Vérité factuelle.
2. **[`adr/`](adr/)** — ce qui DOIT ÊTRE. Décisions de Mamat, immuables : un
   changement d'avis = un nouvel ADR numéroté qui supersede l'ancien.
3. **[`objectifs/`](objectifs/)** — ce qui est VOULU. Écrit par Mamat, une fiche
   par module.
4. **[`product/`](product/), [`runbooks/`](runbooks/)** — opérationnel.
5. **`_quarantine/`** — MORT. N'existe pas. Interdiction de lire/citer/grep.

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
├── runbooks/            ← procédures opérationnelles (disaster-recovery)
└── _quarantine/         ← mort — ne pas lire
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
