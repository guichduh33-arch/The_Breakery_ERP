# ADR-018 — Quarantaine des intents hors-ligne définitivement rejetés au rejeu

> **Date :** 2026-07-31 · **Statut : ACTÉ** (décision propriétaire, séance 2026-07-31)
> **Décideurs** : propriétaire The Breakery (guichduh33)
> **Complète** : ADR-015 (encaissement hors-ligne — tranche le point que son
>   registre laissait ouvert : la conduite à tenir sur un intent rejeté)
>
> **Convention** : aucune version d'objet DB (`_vN`) dans cet ADR — on cite la
> famille. La version vivante se vérifie dans `supabase/migrations/` et au
> call-site.

## Décisions

1. **D1 — Deux natures d'échec au rejeu, deux conduites.** Un échec
   **transitoire** — le serveur n'a pas rendu de réponse applicative (réseau
   coupé, délai dépassé, 5xx, session non authentifiée) — conserve la conduite
   actuelle : le drain s'arrête, l'ordre de la file est préservé, on retentera au
   prochain déclencheur. Un échec **définitif** — le serveur a répondu par un
   refus applicatif qui se reproduira à l'identique à chaque tentative — sort
   l'intent de la file vers la **quarantaine**, et **le drain continue derrière
   lui**.

2. **D2 — La classification repose sur une liste explicite, et le défaut est
   « transitoire ».** Un échec n'est définitif que si le code d'erreur renvoyé
   figure dans une liste tenue côté client. Tout code absent de la liste est
   traité comme transitoire. L'asymétrie est voulue : se tromper en gardant un
   intent en file coûte un retard de remontée ; se tromper en le quarantinant
   coûte la remontée automatique d'une vente. **Le défaut protège l'argent.**
   Corollaire : ajouter un garde serveur sur une RPC rejouée oblige à revoir
   cette liste dans le même lot.

3. **D3 — La quarantaine est en cascade sur la racine de commande.** Un intent
   mis en quarantaine y entraîne tous les intents de la file qui dépendent de lui
   — ceux qui partagent sa racine de commande. Sans cascade, le blocage ne serait
   déplacé que d'un cran : le règlement d'une commande dont la création vient
   d'être refusée échoue à son tour, puisque le rattrapage par rejeu idempotent
   de la racine re-déclenche exactement la validation qui vient d'échouer.

4. **D4 — La quarantaine est durable, append-only, et ne se vide jamais seule.**
   Même socle de stockage durable que l'outbox. Aucune purge automatique, aucun
   délai d'expiration. Un intent quarantiné est un fait en attente de
   régularisation, pas un déchet.

5. **D5 — Une mise en quarantaine n'est jamais silencieuse.** Elle émet une trace
   portant le type d'intent, la clé d'idempotence d'origine, le numéro local et
   le motif serveur. Un intent de **règlement** quarantiné déclenche en outre une
   alerte visible en caisse qui ne se referme pas d'elle-même : c'est de l'argent
   déjà encaissé qui ne remontera pas sans geste humain.

6. **D6 — La régularisation est manuelle et hors périmètre de cet ADR.** La
   quarantaine est un registre de constat, pas un atelier de réparation. On ne
   construit ni écran de correction, ni rejeu forcé : l'opération manquante se
   ressaisit en caisse. Un outil de régularisation, s'il devient nécessaire,
   fera l'objet d'un nouvel ADR.

7. **D7 — La quarantaine est un filet, jamais une permission.** L'invariant posé
   par l'ADR-015 reste la défense de première ligne : **on ne met pas en file ce
   qu'un garde serveur peut refuser.** Tout intent est validé côté client, avant
   enfilement, avec les mêmes gardes que la RPC qu'il rejouera. Cet ADR
   n'autorise en rien à relâcher cette validation.

## Contexte

L'ADR-015 fonde la sûreté de la file hors-ligne sur un invariant explicite : on
n'y met que ce dont le replay ne peut pas être refusé. C'est la raison — et il le
dit — de l'exclusion de l'avoir client : *« l'exclusion de l'avoir n'est donc pas
une précaution, c'est la condition pour que la file reste saine »*. Son registre
laissait toutefois la conduite à tenir non décidée si un intent était malgré tout
rejeté.

**L'audit du module Tablet Ordering (2026-07-31) établit que l'invariant est déjà
rompu**, sur un chemin qui n'a rien à voir avec l'avoir. Une commande de salle en
`dine_in` sans table est acceptée à la mise en file — aucune validation côté
tablette — puis refusée au rejeu par le garde `table_required_for_dine_in` de la
famille `create_tablet_order`. Le drain s'arrêtant au premier échec, l'intent
fautif reste en tête de file et **tout ce qui le suit ne remonte jamais**.

La scène qui a emporté la décision : coupure internet en soirée, hub LAN debout.
Une serveuse envoie la commande d'une table — la cuisine la reçoit et le plat
sort. Le caissier encaisse ensuite douze clients en espèces, qui s'empilent
derrière dans la file. Au retour du réseau, le serveur refuse la commande de
salle ; **les douze encaissements ne remontent pas**. De l'argent réellement
perçu reste invisible du cloud jusqu'à intervention manuelle.

L'enseignement de fond est que **l'invariant ne se maintient pas tout seul** : il
était vrai quand l'intent a été conçu, et faux dès l'ajout d'un garde serveur
ultérieur — ici un durcissement légitime, décidé pour empêcher qu'une commande
atteigne la cuisine sans table. Tout durcissement futur d'une RPC rejouée peut
casser l'invariant à distance, sans que rien ne le signale du côté qui remplit la
file. Un invariant vérifié à l'écriture appelle donc un filet vérifié à
l'exécution.

## Conséquences

1. **Le format d'outbox reste append-only.** La quarantaine s'ajoute ; aucun type
   d'intent publié n'est retiré ni réinterprété. Un poste mis à jour avec des
   ventes en file continue de les rejouer.
2. **La cause se ferme dans le même chantier que le filet.** Le garde dine-in est
   porté côté client avant enfilement : la quarantaine ne dispense pas de
   supprimer la pilule empoisonnée qui l'a révélée (D7).
3. **Tests exigibles** : un intent définitivement rejeté part en quarantaine et le
   drain poursuit ; un échec transitoire laisse la file intacte et ordonnée ; la
   cascade emporte les dépendants de la racine ; un règlement quarantiné laisse
   une trace et lève l'alerte caisse.
4. **Le hors-ligne n'a toujours pas été validé en conditions réelles de
   boutique.** La conséquence 5 de l'ADR-015 reste entière ; cet ADR réduit un
   risque de perte, il ne dispense pas de la session de test en boutique.
5. **Cet ADR n'exige pas de spec d'exécution** (règle documentaire 4) : le
   chantier tient dans un lot unique, adossé à l'audit qui l'a motivé.

## Réversibilité

Revenir au drain bloquant se fait en vidant la liste de codes définitifs (D2) :
sans code éligible, aucun intent ne part plus en quarantaine et le comportement
d'origine revient — sans migration, sans changement de format de file, sans
bump de RPC. Les intents déjà quarantinés resteraient en revanche dans leur
registre : leur régularisation manuelle est due de toute façon, et c'est
précisément ce que D4 garantit.

## Révision

Ces décisions ne se rouvrent que par un nouvel ADR.
