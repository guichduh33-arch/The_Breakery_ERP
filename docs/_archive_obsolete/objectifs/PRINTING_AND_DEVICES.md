# Module Impression & Réseau local — Objectif métier

> **Périmètre** : cette fiche répond à « **comment le papier sort, et comment les
> appareils de la boutique se parlent** ». Ce qui est imprimé — le contenu d'un
> reçu, d'un ticket de station — appartient au parcours qui l'émet (`POS.md`,
> `KDS.md`, `ORDERS.md`). Cette fiche porte le **transport** et la **présence**.
>
> **Révision** : 2026-08-02 · **Statut** : Partiel
> **ADR applicables** : ADR-006 (socle Settings — le hub réseau local et sa
> continuité en coupure sont une décision de ce périmètre), ADR-015 (encaissement
> hors ligne : ce qui continue de fonctionner sans internet)
>
> **Convention** : aucune version d'objet DB (`_vN`) dans cette fiche. Les
> **routes** de service et les **familles** d'objets sont citables ; les noms de
> composants ne le sont pas.

---

## 1. Raison d'être

Une caisse qui n'imprime pas est une caisse à l'arrêt : le client attend son
reçu, la cuisine ne sait pas quoi produire, et le tiroir ne s'ouvre pas. Ce
module existe parce que **le matériel de boutique ne parle pas la même langue que
le cloud** : les imprimantes thermiques attendent de l'ESC/POS sur un port TCP,
elles ne savent rien du web.

Le module répond à trois questions :

> *« Le papier est-il sorti, et sinon qu'est-ce que je fais ? Quels appareils
> sont vivants dans la boutique en ce moment ? Et que continue-t-il de
> fonctionner quand internet tombe ? »*

## 2. L'invariant fondateur — la commande n'est jamais perdue, le ticket peut l'être

C'est la ligne la plus importante de cette fiche, et elle est **assumée** :

- **Il n'y a pas de file d'attente d'impression persistante.** La caisse parle
  directement au boîtier d'impression de chaque poste. Un ticket qui échoue
  n'est pas mis en réserve pour plus tard.
- **La commande, elle, survit toujours** : elle reste visible en caisse et à
  l'écran cuisine, avec un avertissement honnête. On ne fait pas croire que le
  papier est sorti.
- Corollaire : **le papier n'est pas une preuve, la base l'est.** Aucune décision
  métier — encaissement, envoi en cuisine, clôture — ne dépend du succès d'une
  impression.

Cette asymétrie est un choix : une file d'impression persistante rejouerait des
tickets périmés au redémarrage, ce qui est pire qu'un ticket manquant.

## 3. Ce que le module transporte

| Famille | Sens métier | Émis par |
|---|---|---|
| **Reçu client** | la preuve remise au client, remises et promotions comprises | caisse, à l'encaissement |
| **Ticket de station** | l'ordre de production envoyé à un poste de la cuisine | caisse et tablette, à l'envoi |
| **Impulsion tiroir** | l'ouverture du tiroir-caisse, sur l'imprimante de caisse | caisse |
| **Découverte d'imprimantes** | balayage du réseau de la boutique pour trouver les boîtiers | back-office, page réseau local |
| **Sonde d'un appareil** | vérifier qu'une adresse répond, avant de la retenir | back-office et caisse |

Deux garde-fous permanents sur ces échanges : **le balayage et le bus n'acceptent
que des adresses privées** (jamais l'internet public), et le service est un
service **de confiance du réseau local** — il ne porte ni identifiant ni secret
client.

## 4. Le hub réseau local — la continuité quand internet tombe

Décision **ADR-006**. Sans hub, toute communication entre appareils (tablette →
caisse, caisse → cuisine, commande → écran client) passe par internet : une
coupure les isole les uns des autres alors qu'ils sont dans la même pièce.

Le hub donne trois choses :

- **Un bus local** auquel les appareils de la boutique se présentent en
  s'annonçant, et sur lequel ils échangent sans sortir du magasin.
- **Un rattrapage** : un appareil qui rejoint le bus reçoit ce qu'il a manqué,
  dans la limite d'une mémoire tampon bornée. Ce n'est pas un journal complet.
- **Un seul écrivain vers le cloud** pour la présence des appareils : le hub
  pousse périodiquement la liste des appareils vivants, et les terminaux se
  taisent tant qu'ils sont sur le bus — ils reprennent la main si le hub tombe.

**Le bus est protégé par un secret partagé de boutique.** En son absence, le hub
accepte tout appareil du réseau local et le signale au démarrage. Ce secret
n'est pas facultatif en exploitation : il fait partie de la mise en service.

## 5. Ce que le module ne fait pas — par décision

- **Il ne rejoue pas les tickets ratés** (§2). La relance est un geste humain, et
  le bouton qui la déclenche est encore à livrer (§7).
- **Il ne stocke pas les documents imprimés.** L'archive d'un reçu est la
  commande en base, pas une copie du papier.
- **Il ne configure pas l'impulsion du tiroir.** Le tiroir est câblé sur
  l'imprimante de caisse, il n'y a rien à régler.
- **Il n'est pas exposé hors du réseau local**, et ne doit jamais l'être.

## 6. Contraintes d'exploitation

Le service tourne **sur le PC de la boutique**, en service Windows, et démarre
avec la machine. Sa configuration vient du lanceur du service, pas d'un fichier
lu au démarrage — ce qui veut dire qu'**un changement de réglage exige de
reconfigurer le service**, pas seulement d'éditer un fichier.

L'adresse de l'imprimante utilisée se change **poste par poste, sans
redémarrage**.

**Le runbook de mise en service du hub reste à écrire** — il porte le secret
partagé, l'installation du service et la vérification de bout en bout.

## 7. Ce qui reste ouvert

- 🔴 **Relancer manuellement un ticket qui n'a pas pu s'imprimer.** C'est le
  manque le plus visible en salle : aujourd'hui le caissier constate l'échec et
  n'a aucun geste de réparation.
- 🔴 **Runbook de mise en service du hub** (secret partagé, installation,
  vérification) — dû, non écrit.
- 🟠 Tableau de bord de diagnostic réseau, et test d'impression par imprimante.
- 🟠 **Fausse alerte « appareil hors ligne »** : un appareil vivant peut être
  annoncé mort. Le défaut est connu, la cause ne l'est pas.
- 🟡 Le rattrapage du bus est borné : personne n'a fixé la profondeur qui
  convient à une journée de service.
