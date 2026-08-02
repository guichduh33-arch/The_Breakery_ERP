# Module Piste d'audit — Objectif métier

> **Périmètre** : cette fiche répond à « **qui a fait quoi, quand, et qu'est-ce
> qui a changé** ». Elle porte le journal d'audit transverse. Les **ledgers
> métier** append-only — mouvements de stock, écritures comptables, règlements —
> ne sont pas ici : chacun appartient à sa fiche, et cette fiche dit seulement
> ce qu'ils ont en commun.
>
> **Révision** : 2026-08-02 · **Statut** : Partiel
> **ADR applicables** : ADR-009 (cycle de vie des ordres — l'écriture passe par
> des RPC, jamais par le client), ADR-013 (intégrité comptable void / refund /
> remise : ce sont les gestes qui doivent laisser une trace)
>
> **Convention** : aucune version d'objet DB (`_vN`) dans cette fiche.

---

## 1. Raison d'être

Dans un commerce, la fraude et l'erreur se ressemblent : une remise anormale, un
void répété, un ajustement de stock qui tombe juste après un comptage. Ce qui
les distingue, c'est **l'intention**, et l'intention ne se lit que dans une
séquence de gestes attribués.

Le module répond à trois questions, et il est le seul à y répondre pour toute
l'application :

> *« Qui a fait ce geste ? Qu'est-ce qui valait quoi avant, et quoi après ?
> Et si quelqu'un le conteste, ai-je de quoi le prouver ? »*

Il ne remplace pas les rapports : un rapport dit **combien**, la piste d'audit
dit **qui et quand**. C'est ce qui la rend utile le jour où un chiffre est contesté.

## 2. L'invariant fondateur — une seule table, en écriture seule

**Le journal d'audit est une table unique et append-only.** Aucune ligne ne se
modifie, aucune ne se supprime. Les écritures passent par des RPC en élévation
de privilège ; **le code applicatif n'insère jamais directement**.

Deux conséquences que l'on paie cher si on les oublie :

- **Ce qui n'est pas écrit au moment du geste est perdu pour toujours.** On ne
  reconstitue pas une piste d'audit après coup — au mieux on l'infère, et une
  inférence n'est pas une preuve.
- **Un journal qu'on peut vider ne prouve rien.** La protection en écriture doit
  couvrir aussi l'effacement en masse, pas seulement la modification ligne à ligne.

## 3. Deux colonnes qui ne se confondent jamais

Le journal porte **deux** champs libres, et les fusionner détruirait sa valeur :

| Champ | Ce qu'il porte | Question à laquelle il répond |
|---|---|---|
| **contexte** | les circonstances du geste — poste, session, motif, référence | *dans quelles conditions ?* |
| **différentiel** | l'avant et l'après de ce qui a changé | *qu'est-ce qui a bougé ?* |

Un geste peut avoir un contexte sans différentiel (une connexion), ou les deux
(une correction de coût). **Ne jamais les regrouper en un seul champ** : la
recherche d'anomalie interroge le contexte, la contestation interroge le différentiel.

## 4. Ce qui est tracé — familles de gestes

⚠️ **La liste exacte des gestes tracés vit dans les données, pas dans cette
fiche.** Une liste recopiée diverge. Les familles observées :

| Famille | Exemples de gestes | Pourquoi ça compte |
|---|---|---|
| **Accès** | connexion réussie, connexion refusée, vérification de code manager | détecter le forçage et l'usage d'un compte qui n'est pas le sien |
| **Argent** | encaissement, clôture de caisse, règlement client, brouillon de rapport de clôture | ce sont les gestes contestables |
| **Stock** | mouvement, comptage, transfert, production, recalcul de coût | l'écart de stock est le premier symptôme de perte |
| **Catalogue & droits** | suppression de produit, octroi d'une permission à un rôle | changements structurants, rares et à fort impact |
| **Dégradations du système** | repli d'imputation comptable faute de correspondance | le système consigne ses propres approximations — voir §7 |

**Au 2026-08-02**, le journal porte environ 5 300 gestes, dominés par les accès
et les mouvements de stock.

## 5. Le journal opérationnel du POS — une deuxième piste, séparée à dessein

Le poste de caisse tient **son propre journal**, distinct du journal d'audit :
il enregistre le déroulé opérationnel d'un terminal — ce que l'appareil a fait,
dans quel ordre, avec quel numéro de séquence — et il est **découpé par mois**
pour rester exploitable dans la durée.

Les deux ne servent pas à la même chose et **ne doivent pas fusionner** : le
journal d'audit répond à une contestation, le journal du poste répond à une
panne. L'un est juridique, l'autre est technique.

## 6. Qui peut lire — et l'ambiguïté à lever

La lecture est réservée : le journal contient qui a fait quoi, donc il est
lui-même une donnée sensible.

⚠️ **Trois codes de permission coexistent aujourd'hui pour ce seul domaine.**
Un seul est réellement appliqué par les fonctions de lecture ; les deux autres
sont accordés à des rôles **sans qu'aucune fonction ne les vérifie**. Ils donnent
donc l'illusion d'un droit qui ne contrôle rien, dans les deux sens : on croit
avoir donné un accès, ou on croit l'avoir retiré. **À unifier** (§8).

## 7. Ce que le module ne fait pas — et ce qu'il faut en penser

- **Il ne juge pas.** Il consigne. La détection d'anomalie — remise anormale,
  void en série, écart de caisse répété — est un travail de rapport, décrit dans
  `REPORTS.md`, et elle reste largement à construire.
- **Il ne garantit pas encore la conservation longue.** L'archivage immuable sur
  la durée exigée par la loi indonésienne n'est pas outillé ; les rapports de
  clôture ont leur propre règle de conservation, décrite dans `CASH_REGISTER.md`.
- **Il ne couvre pas tous les gestes.** La couverture s'est construite geste par
  geste, au fil des modules ; personne n'a jamais établi la liste de ce qui
  *devrait* être tracé, puis mesuré l'écart. C'est le trou principal (§8).
- **Il consigne les replis du système.** Quand une imputation comptable ne trouve
  pas sa correspondance et retombe sur une valeur par défaut, le journal le dit.
  C'est une qualité — mais **une trace de repli est un défaut à corriger, pas une
  ligne à contempler** : le volume observé au 2026-08-02 signale un mapping
  incomplet, traité comme tel dans `ACCOUNTING.md`.

## 8. Ce qui reste ouvert

- 🔴 **Établir la liste des gestes qui doivent être tracés**, puis mesurer
  l'écart avec ce qui l'est. Sans ce référentiel, « la piste d'audit est
  complète » est une affirmation invérifiable.
- 🔴 **Unifier les trois codes de permission** de lecture en un seul, et retirer
  ceux qui ne contrôlent rien (§6).
- 🔴 **Protéger le journal contre l'effacement en masse**, pas seulement contre
  la modification ligne à ligne (§2).
- 🟠 Détection d'anomalies et d'escalades de privilège — annoncée dans
  `REPORTS.md` et `USERS_AND_PERMISSIONS.md`, non livrée.
- 🟠 **Purger les gestes de test** qui polluent le journal en base de
  développement, et empêcher qu'ils y reviennent.
- 🟡 Archivage immuable sur la durée légale : mécanisme à définir (`REPORTS.md`).
