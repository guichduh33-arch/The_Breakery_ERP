# Module Tablet Ordering — Objectif métier

> **Périmètre fonctionnel** : ce document décrit **ce que le module Tablet
> Ordering (`/tablet`) sert à faire au quotidien** pour The Breakery.
>
> **Révision** : 2026-08-01 · **Statut** : Livré
> **ADR applicables** : ADR-010 (un item envoyé en cuisine ne se retire qu'avec
> autorisation manager et déclaration de perte), ADR-015 (encaissement
> hors-ligne), ADR-018 (un envoi refusé au rejeu part en quarantaine et ne
> bloque plus la file)
>
> **Convention** : aucune version d'objet DB (`_vN`) dans cette fiche — on cite
> la famille (`create_tablet_order`, `pickup_tablet_order`). La version vivante
> se vérifie dans `supabase/migrations/` et au call-site, jamais ici.

---

## 1. Raison d'être

Le module Tablet Ordering est **l'extension salle de la caisse** de The Breakery. Il répond à une question simple mais structurante quand on sert en salle :

> *"Comment je prends la commande de la table 7 sans devoir faire 4 allers-retours au comptoir avec un carnet papier, et comment je m'assure que la cuisine reçoit la commande au moment où je quitte la table — pas 5 minutes plus tard ?"*

C'est le module qui transforme **un serveur en salle** en **noyau mobile du POS** : il prend la commande directement à la table sur une tablette, la cuisine la reçoit aussitôt, le caissier la reprend au comptoir pour l'encaisser. Le tout en quelques secondes au lieu de plusieurs minutes.

Le module est **délibérément simple** côté serveur :

- Pas d'encaissement à la table (le paiement reste au comptoir pour la sécurité cash).
- Pas de gestion de stock complexe.
- Pas de modifier complexe (ajouts simples uniquement).
- Pas de promotion manuelle (l'engine du POS s'en charge à l'encaissement).

Le serveur **saisit** ; la cuisine **prépare** ; le caissier **encaisse**. Trois rôles, un flux.

---

## 2. Les 2 pages du module

| Page | Job-to-be-done |
|---|---|
| **Prise de commande** (`/tablet/order`) | Composer une commande à la table — plan de salle, sélection produits, envoi |
| **Historique tablette** (`/tablet/orders`) | Voir les commandes envoyées depuis cette tablette + leur statut |

Le tout est englobé par une coquille applicative qui gère l'authentification PIN, l'état de la liaison (cloud et hub boutique), et le suivi des commandes en cours.

---

## 3. Les 6 invariants du module

Quelle que soit la situation, le module garantit toujours :

1. **PIN d'authentification serveur**. Chaque commande est attribuée à un serveur nommé. PIN exigé à l'ouverture de session + verrouillage après inactivité.
2. **Écriture par RPC, jamais d'insert brut**. La tablette crée la commande par la famille `create_tablet_order`, qui porte l'idempotence. En coupure, elle écrit une **intention durable** rejouée plus tard contre **la même RPC avec la même clé** — jamais un chemin d'écriture parallèle.
3. **Envoi explicite obligatoire**. Une commande saisie ne part **pas** tant que le serveur n'a pas tapé « Send to Kitchen ». Pas d'envoi auto.
4. **La confirmation est adossée à une écriture réelle**. Le serveur ne voit « envoyée » qu'après la réponse de la RPC — ou, en coupure, une fois l'intention écrite dans la file durable et le ticket publié en cuisine, avec un numéro local. Jamais sur un simple geste d'interface.
5. **Une commande sur place a toujours une table**. Refusée à la saisie comme au serveur. La règle vaut aussi en coupure : on ne met jamais en file un envoi que le serveur refusera au retour du réseau (ADR-018).
6. **Pas de paiement à la table**. Le serveur ne touche jamais à l'encaissement. La caisse reste **le seul point de contact argent**.

---

## 4. Le PIN d'authentification — La porte serveur

À l'ouverture de la tablette, l'écran de vérification du PIN s'affiche en plein écran :

- Le serveur tape son PIN.
- En cas de succès → la tablette charge le nom du serveur et son identité dans la session.
- Une commande envoyée depuis cette tablette porte **automatiquement** le serveur qui l'a saisie.

Comportement de verrouillage :

- Verrouillage automatique après une durée d'inactivité **portée par le rôle** de l'utilisateur.
- Le verrouillage **préserve la session** : on redemande le PIN, on ne déconnecte pas — le service en cours n'est pas perdu.

Bénéfice métier : **chaque commande est nominative**. Pour les tips, les performances staff, les éventuels litiges, on sait qui a pris la commande.

---

## 5. Les liaisons — Cloud d'abord, hub en secours

La tablette dépend de deux liaisons distinctes, et sait dire laquelle manque :

- **Le cloud** est le chemin nominal : c'est là que la commande est créée.
- **Le hub de la boutique** sert la présence (la tablette apparaît en ligne dans le back-office) et, en cas de coupure internet, transporte le ticket vers la cuisine.

L'état est affiché en permanence dans l'en-tête (pastille en ligne / hors ligne).

**Le mode hors-ligne est le ET de deux conditions** : internet injoignable **et** hub de boutique joignable. Dans ce mode, la commande part quand même en cuisine par le hub, avec un numéro local, et l'intention est écrite dans une file durable rejouée au retour du réseau. Si les deux liaisons sont à terre, aucun flux métier n'est possible et l'application le dit.

Bénéfice métier : **le serveur n'envoie jamais dans le vide**. Soit ça part au cloud, soit ça part par le hub avec un numéro local, soit l'application refuse et l'annonce.

---

## 6. La prise de commande

L'écran de saisie est volontairement **épuré et tactile**.

### 6.1 Layout

- **Plan de salle** accessible depuis la barre d'outils : les tables y sont positionnées comme dans la vraie salle, les occupées sont signalées.
- **Grille produits** par catégorie, avec recherche.
- **Panier en rail latéral**, repliable en portrait pour rendre de la place à la grille.
- **Bouton « Send to Kitchen »** en pied de panier, toujours visible.

### 6.2 Fonctionnalités

- **Recherche produit** rapide.
- **Quantités** ajustables, cibles tactiles généreuses.
- **Modifiers basiques** (sucre, lait, sans X) — pas la totalité du modifier engine du POS.
- **Note de commande** libre pour la cuisine (allergie, préparation). Elle porte sur la **commande entière**, pas sur une ligne.
- **Type de commande** : sur place (défaut tablette) ou à emporter.
- **Indicateur de stock faible** sur les produits concernés.
- **Le panier survit** à une mise en veille ou à un rechargement en plein service.

### 6.3 Ce qui est *absent* volontairement

- Pas de remise / promotion manuelle.
- Pas de paiement.
- Pas d'annulation d'une commande déjà envoyée — voir §7.
- Pas de modifier complexes type combo (combo → renvoyer au comptoir).

Bénéfice métier : **simplicité radicale**. Un serveur saisit une commande complète en quelques secondes — sans menu déroulant, sans dialog secondaire.

---

## 7. L'envoi — Le moment de bascule

Bouton **« Send to Kitchen »** → la commande quitte la tablette :

1. Contrôle de recevabilité : une commande sur place sans table est refusée sur place, et le plan de salle s'ouvre.
2. **En ligne** : création de la commande au cloud par la famille `create_tablet_order`, avec une clé d'idempotence — un double appui ne crée jamais deux commandes. La commande **part en cuisine dès sa création** ; le serveur bascule sur son historique, la commande mise en avant.
3. **En coupure** : l'intention est écrite dans la file durable, puis le ticket est publié vers la cuisine par le hub. Le serveur reçoit un **numéro local**. Au retour du réseau, l'intention est rejouée contre la même RPC avec la même clé.
4. Le panier se vide — prêt pour la table suivante.

Si l'envoi échoue, le panier **n'est pas vidé** : le serveur corrige et retente.

L'envoi est un **point de non-retour**. Les lignes partent en cuisine verrouillées : à partir de là, retirer ou réduire une ligne est un geste **manager au POS**, avec PIN et **déclaration de perte obligatoire** (ADR-010). La tablette n'a ni le droit ni les écrans pour le faire — et c'est délibéré : la marchandise a été produite, sa disparition doit être déclarée.

---

## 8. Du côté du POS — La reprise

Les commandes de salle en attente s'affichent au comptoir dans le **panneau des commandes tablette** : numéro, table, serveur, ancienneté, note cuisine et montant.

- **Pickup** → la commande passe dans le panier du caissier, qui l'encaisse.
- **Close** → n'apparaît que pour une commande dont **toutes les lignes ont déjà été annulées** par le flux manager. Elle constate, elle n'annule rien : sans elle, une commande vidée resterait affichée indéfiniment.

Une commande reprise par un caissier ne peut plus l'être par un autre : la reprise est exclusive.

Bénéfice métier : **la caisse maîtrise quand traiter une commande de salle**, et le serveur voit en direct quand elle est validée.

---

## 9. Suivi des commandes

La page historique liste les commandes envoyées depuis cette tablette : numéro, table, items, heure d'envoi et statut (en attente de caisse, payée, annulée).

L'onglet porte un badge qui ne compte que les commandes **encore en vol** — ni encaissées, ni closes, ni annulées. Un compteur qui grossit sans fin cesse d'être regardé ; celui-ci n'affiche que ce sur quoi le serveur peut encore agir.

Limites assumées :

- Historique borné aux **50 dernières** commandes : c'est le service en cours qui compte, la fiche complète vit au POS.
- Pas de drill-down détaillé, pas d'export.

---

## 10. Sécurité et permissions

- **Accès à la tablette** : réservé au rôle serveur, ou à tout profil portant le droit de créer une vente.
- **Création de commande** : le même droit est exigé **côté serveur**, pas seulement dans l'interface.
- **PIN serveur obligatoire** — pas d'usage anonyme.
- **Aucune écriture sensible depuis la salle** : annuler une ligne partie en cuisine exige un manager au POS.

Manque identifié : la **création** d'une commande de salle ne laisse pas de ligne d'audit dédiée aujourd'hui (la commande porte son serveur, ce qui n'est pas la même chose qu'une trace d'événement). Voir backlog §13.

Bénéfice métier : **la tablette n'ouvre pas de nouvelle surface de fraude**. Elle sait créer et consulter ; tout geste qui détruit de la valeur passe par le comptoir.

---

## 11. Mécaniques transverses — Comment le module dialogue avec le reste

| Module | Relation |
|---|---|
| **KDS** | Direct : la commande de salle atteint les écrans de cuisine dès sa création, routée par station. |
| **POS** | Repreneur des commandes de salle, via le panneau dédié. |
| **Products** | Catalogue partagé (lecture seule), mis en cache pour survivre à une coupure. |
| **Settings** | Plan de salle (tables, sections, positions) et taux de taxe pour l'estimation affichée. |
| **LAN / hub** | Présence de l'appareil, et transport du ticket cuisine en coupure. |
| **Orders** | La commande créée suit ensuite le cycle de vie commun (reprise, encaissement, annulation). |

---

## 12. Ce que le module ne fait **pas** (par design)

- La tablette **ne fait pas de paiement**. Choix de sécurité — l'argent reste au comptoir.
- La tablette **ne supporte pas le modifier engine complet** du POS.
- La tablette **ne crée pas de client** et n'en rattache pas à la commande.
- La tablette **ne gère pas les combos avec sélection multi-groupes** — un combo se compose au comptoir.
- La tablette **ne modifie ni n'annule une commande déjà envoyée**. Son panier est local et pré-envoi ; après l'envoi, corriger une ligne partie en cuisine est un geste manager au POS (ADR-010 : autorisation + perte).
- La tablette **ne consulte pas le KDS** ni les stocks détaillés — juste l'indicateur de stock faible.

En revanche, contrairement à ce que cette fiche a longtemps affirmé, la tablette **déclenche bien l'envoi en cuisine** : la commande atteint le KDS à sa création, sans attendre le caissier. Un réglage pour rendre ce comportement optionnel a été **arbitré hors périmètre** par le propriétaire (voir `SETTINGS.md`) — ne pas le re-proposer sans nouvelle décision.

---

## 13. Ce que le module doit (encore) faire — backlog métier

| Priorité | Évolution | Bénéfice attendu |
|---|---|---|
| 🔴 | **Ajouter à une commande existante** | Une seconde tournée crée aujourd'hui une commande séparée. Le verrou cuisine autorise explicitement l'ajout de lignes : il manque l'écran. |
| 🟠 | **Notifier la salle quand un plat est prêt** | Le serveur reçoit « table 7 prête » sur sa tablette au lieu d'aller lire le KDS. |
| 🟠 | **Transférer une commande de table** | Un groupe change de table en cours de service ; la bascule existe côté POS, pas depuis la salle. |
| 🟠 | **Modifier engine complet** | Ne plus renvoyer au comptoir certaines configurations demandées en salle. |
| 🟠 | **Combos sélectionnables** | Composer un combo depuis la tablette. |
| 🟠 | **Refuser une commande de salle depuis la caisse** | Le caissier ne peut aujourd'hui que reprendre ; refuser exige d'annuler ligne à ligne. |
| 🟡 | **Trace d'audit à la création** | Savoir qui a saisi quoi et quand, comme pour les autres gestes du POS. |
| 🟡 | **Création de client à la table** | Saisir un nouveau client pour la fidélité sans passer par le caissier. |
| 🟡 | **Pre-bill à la table** | Imprimer une note sans encaissement, pour que le client voie son addition. |
| 🟢 | **Photos de plats** | Aide à la suggestion au client. |
| 🟢 | **Mode « menu client »** | Donner la tablette au client pour qu'il sélectionne lui-même. |

---

## 14. En une phrase

Le module Tablet Ordering est **l'extension salle du POS** de The Breakery : il transforme un serveur en noyau mobile de prise de commande en lui donnant une tablette PIN-authentifiée qui envoie une commande complète en quelques secondes — directement en cuisine, avec une table obligatoire, une confirmation adossée à une écriture réelle, et une continuité en coupure internet — sans toucher au cash, sans commande perdue, sans aller-retour au comptoir, pour que le service en salle gagne le tempo qu'il perd dans les boulangeries qui prennent encore les commandes au carnet papier.
