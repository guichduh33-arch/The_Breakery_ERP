# ADR-019 — Domaine Clients : durcissements post-audit (plafonds de crédit, écritures hors RPC, prix négocié, périmètre fidélité)

> **Date** : 2026-08-02
> **Statut** : ✅ Accepted (2026-08-02)
> **Décideurs** : propriétaire The Breakery (guichduh33)
> **Supersedes** : — (ne modifie aucun ADR ; s'appuie sur ADR-013 pour l'avoir client)

## Contexte

Le 2026-08-02, un audit du module Clients a été mené sur le code et sur le schéma
live du projet V3 dev. L'intégrité des données est saine : les ledgers
(`loyalty_transactions`, `customer_store_credit_ledger`, `customer_product_prices`)
sont bien append-only au niveau des GRANT, `anon` n'a d'accès nulle part, le
`search_path` est épinglé sur tous les definers du domaine, et le solde d'avoir
colle au ledger au centime près. Le rachat de points est correctement gardé
serveur, et l'octroi d'avoir applique le patron ADR-013 en entier (nonce
d'autorisation manager, idempotence, écriture au journal, audit).

L'audit a en revanche exposé deux fonctionnalités **inertes en production**, une
**divergence de prix entre deux chemins d'encaissement**, et un ensemble de
**chemins d'écriture directs** qui contournent les RPC gatées et auditées du
domaine. Aucun de ces points n'avait été formellement tranché.

## 1. Décisions

### Décision 1 — Les plafonds de crédit s'écrivent par RPC gatée et auditée, jamais par UPDATE direct

**Le constat** : la migration qui a introduit `customers.retail_credit_limit` n'a
pas étendu la liste de colonnes du GRANT UPDATE de `authenticated`. Le BackOffice
persiste ce champ par un UPDATE direct sur la table : l'appel échoue en permission
refusée à chaque sauvegarde. Au 2026-08-02, aucun client actif n'a de plafond posé.
Or le contrôle d'encours de `attach_tab_customer` n'est évalué que si le plafond
est non NULL : **toute ardoise comptoir est aujourd'hui illimitée**. Le test de
fumée de la section reste vert parce qu'il monte le composant présentationnel avec
un `onSave` espionné, sans jamais exercer la persistance.

Symétriquement, `b2b_credit_limit`, `b2b_payment_terms_days`, `b2b_tax_id` et
`customer_type` **sont** dans le GRANT colonne UPDATE, sous la seule policy
`customers.update`. La permission dédiée `customers.b2b.update` est seedée et
accordée à ADMIN/MANAGER, mais n'est référencée par aucune RPC ni aucune policy :
c'est une permission fantôme. Relever l'encours autorisé d'un compte B2B ne laisse
aucune trace dans `audit_logs`.

**La décision** : les champs financiers d'une fiche client — plafond d'ardoise
retail, plafond de crédit B2B, conditions de paiement, type de client — ne sont
plus écrivables directement. Ils passent par une RPC `SECURITY DEFINER` dédiée,
gatée sur `customers.b2b.update` pour les champs B2B, écrivant `audit_logs` avec
l'ancienne et la nouvelle valeur. Le GRANT colonne UPDATE de `authenticated` est
réduit en conséquence ; `retail_credit_limit` n'y est pas ajouté.

**Et le plafond d'ardoise retail ne peut plus être absent** : un plafond par
défaut de **300 000 IDR** est porté par la configuration business et s'applique à
tout client **retail** qui n'a pas de plafond individuel. Le plafond individuel,
quand il existe, prime. Aucune ardoise retail n'est donc jamais non contrôlée,
sans exiger une saisie manuelle sur l'ensemble du fichier clients. Le contrôle
d'encours de `attach_tab_customer` cesse de dépendre d'un `IS NOT NULL` : pour un
client retail, il évalue toujours un plafond.

**L'ardoise comptoir d'un compte B2B relève du crédit B2B, pas du plafond
retail.** Le défaut de 300 000 ne s'y applique pas : ce serait plafonner à trois
cent mille roupies un compte dont l'encours autorisé se compte en millions. Un
B2B mis sur ardoise au comptoir est contrôlé contre son propre plafond de crédit
B2B, comme en commande B2B.

**Conséquence technique sur ce dernier point** : le solde B2B est réconcilié sur
les factures B2B impayées ; les ardoises comptoir n'y entrent pas. Le contrôle
doit donc additionner l'encours comptoir du client au solde B2B avant de le
comparer au plafond, faute de quoi un compte B2B accumule au comptoir un encours
qu'aucun plafond ne voit. La règle B2B « plafond NULL = crédit illimité » n'est
pas modifiée par le présent ADR : un compte B2B sans plafond reste non contrôlé,
au comptoir comme en commande — c'est une propriété du module B2B, à rouvrir là-bas
si elle n'est plus voulue.

**Conséquence technique générale** : nouvelle RPC + clé de configuration business
+ chantier `_vN+1` sur `attach_tab_customer` (DROP de l'ancienne version dans la
même migration) + migration de retrait de GRANT + bascule du BackOffice sur la
RPC dans le même commit (pas de mode double). pgTAP : écriture autorisée,
écriture refusée sans permission, ligne d'audit émise, UPDATE direct refusé,
plafond par défaut appliqué à un retail sans plafond individuel, plafond
individuel prioritaire sur le défaut, compte B2B contrôlé contre son plafond B2B
et non contre le défaut retail, encours comptoir compté dans le contrôle B2B.

### Décision 2 — Toute écriture de fiche client passe par une RPC gatée et auditée

**Le constat** : le BackOffice crée et modifie les fiches par INSERT et UPDATE
directs sur `customers`. La création n'affecte pas de catégorie : au 2026-08-02,
101 des 271 clients actifs n'en ont aucune, ce qui fausse les filtres et les
statistiques du fichier clients et fait dépendre leur tarification d'un repli
implicite. Aucune de ces mutations n'écrit dans `audit_logs`.

Côté caisse, `create_customer_v2` est `SECURITY DEFINER` **sans aucun gate de
permission** et accepte un type de client en paramètre : un CAISSIER — qui ne
détient ni `customers.create` ni `customers.read` — peut créer un compte B2B. La
policy permissive `auth_insert_retail` ouvre par ailleurs l'INSERT direct de tout
client retail à n'importe quel authentifié, indépendamment de `customers.create`.

**La décision** : la création, la modification et la désactivation d'une fiche
client passent exclusivement par des RPC gatées et auditées. `create_customer_v2`
reçoit un gate explicite. La création express en caisse est reconnue comme un
besoin métier légitime et reçoit **sa propre permission**, accordée au rôle
CAISSE et bornée au type retail — le droit de créer un compte B2B reste MANAGER+.
Le GRANT colonne INSERT/UPDATE de `authenticated` sur `customers` est retiré et la
policy `auth_insert_retail` supprimée.

### Décision 3 — L'écriture directe sur `customer_categories` est fermée

**Le constat** : `authenticated` dispose d'INSERT et d'UPDATE sur **toutes** les
colonnes de `customer_categories`, dont `discount_percentage`,
`points_multiplier`, `price_modifier_type` et `is_default`. Les trois RPC CRUD
gatées et auditées existent et sont le seul chemin emprunté par le BackOffice. La
surface directe est donc un résidu, et c'est un levier de prix modifiable sans
trace.

**La décision** : INSERT et UPDATE sont révoqués de `authenticated` sur
`customer_categories`. Les RPC CRUD restent le seul chemin d'écriture.

### Décision 4 — Le prix négocié par client fait autorité sur tous les chemins d'encaissement

**Le constat** : la résolution de prix B2B (négocié > catégorie > retail) n'est
appelée que par le chemin de commande B2B du BackOffice. Le money-path POS résout
ses lignes via un helper qui n'interroge que la grille **par catégorie**, jamais
la table des prix négociés **par client**. Le même client B2B est donc facturé
différemment selon qu'il commande au BackOffice ou passe au comptoir. Aucun prix
négocié n'est enregistré à ce jour : l'écart est latent, il deviendra réel dès la
première négociation saisie.

**La décision** : le prix négocié par client est opposable partout. Le helper de
résolution de ligne du money-path consulte les prix négociés en priorité, puis la
catégorie, puis le retail — alignement exact sur la résolution B2B existante.

**Conséquence technique** : chantier money-path — bump `_vN+1` avec DROP de
l'ancienne version dans la même migration pour les RPC touchées, redéploiement des
Edge Functions consommatrices, pgTAP obligatoires (client avec prix négocié,
client de catégorie custom sans prix négocié, client retail).

### Décision 5 — La fidélité est un dispositif retail ; l'anniversaire ne se promet pas sans se créditer

**Le constat** : le bloc d'acquisition de points ne filtre pas sur le type de
client et ne lit pas le drapeau `loyalty_enabled` de la catégorie — seul le
multiplicateur est consulté. Les deux écarts sont latents aujourd'hui (aucun
compte B2B n'a de points, les cinq catégories ont la fidélité activée), mais un
compte B2B à fort volume accumulerait des points convertibles en avoir monétaire,
en plus de son prix wholesale.

Par ailleurs, le modèle d'e-mail d'anniversaire affirme au client que des points
bonus **ont été crédités** sur son compte. La fonction qui déclenche cet envoi ne
crée aucun mouvement de points. Les tâches planifiées d'envoi et de dépêche sont
actives : l'e-mail part réellement, et il est faux.

**La décision** : l'acquisition de points est réservée aux clients retail et
respecte le drapeau `loyalty_enabled` de la catégorie.

Sur l'anniversaire, la règle est qu'un bonus ne se promet jamais sans être
crédité. Le bonus anniversaire n'étant pas implémenté, **c'est la promesse qui
disparaît** : le modèle d'e-mail est réécrit pour n'affirmer aucun crédit de
points. L'envoi lui-même est conservé — un mot d'anniversaire sans contrepartie
reste un geste relationnel valable. Le bonus anniversaire décrit par la fiche
métier retourne au backlog ; le jour où il sera livré, le modèle et le crédit
effectif partiront ensemble.

Enfin, la fonction qui déclenche ces envois est `SECURITY DEFINER`, sans gate, et
exécutable par tout utilisateur authentifié alors qu'elle lit de la PII et
provoque des envois : son EXECUTE est révoqué, seul le chemin planifié l'appelle.

### Décision 6 — Traçabilité et lecture : audit sur les gestes de valeur, gate `customers.read` sur les lectures sensibles

**Le constat** : l'ajustement manuel de points est gaté ADMIN+ et laisse une ligne
de ledger nominative, mais **n'écrit pas dans `audit_logs`** — alors que les points
se convertissent en avoir monétaire avec écriture au journal. L'export de la base
clients dumpe nom, téléphone, e-mail, identifiant fiscal et plafond B2B sans
laisser de trace. Enfin, `loyalty_transactions` et `customer_product_prices` sont
lisibles par tout utilisateur authentifié, là où `customers` et le ledger d'avoir
exigent `customers.read`.

**La décision** : l'ajustement manuel de points et l'export en masse de la base
clients écrivent chacun une ligne `audit_logs`. Les policies de lecture de
`loyalty_transactions` et `customer_product_prices` sont alignées sur
`customers.read`.

## 2. Arbitrages rendus (2026-08-02)

Quatre points ouverts ont été soumis au propriétaire le jour de l'audit. Ses
réponses sont intégrées aux décisions ci-dessus ; elles sont consignées ici pour
que le raisonnement reste lisible sans relire la conversation.

1. **Plafond d'ardoise absent** → un plafond par défaut porté par la configuration
   business s'applique, le plafond individuel prime. Aucune ardoise retail non
   contrôlée. **Valeur retenue : 300 000 IDR, et pour le retail uniquement** —
   l'ardoise comptoir d'un compte B2B relève du crédit B2B. *Intégré à la
   décision 1.*
   Repère chiffré ayant servi à l'arbitrage, relevé le 2026-08-02 : ticket moyen
   au comptoir 60 419 IDR, ticket maximum observé 490 000 IDR. Une commande unique
   de ce dernier ordre de grandeur sera donc refusée à un client retail sans
   plafond individuel — c'est l'effet voulu, il appelle un plafond individuel pour
   les habitués à gros paniers.
2. **Création express en caisse** → oui, par un code de permission dédié accordé au
   rôle CAISSE et borné au type retail ; le compte B2B reste MANAGER+.
   *Confirme la décision 2.*
3. **Bonus anniversaire** → la promesse est retirée du modèle d'e-mail. Aucun crédit
   de points n'est mis en place à ce stade ; le bonus retourne au backlog.
   *Intégré à la décision 5.*
4. **Expiration des points de fidélité** → **statu quo, les points n'expirent pas.**
   Le type de mouvement `expire` reste présent dans le ledger et inutilisé. La
   dissymétrie assumée est qu'un avoir client expire alors que les points qui l'ont
   engendré n'expiraient pas : elle est acceptée tant que le passif fidélité reste
   modeste. Ce point ne se rouvre que par un nouvel ADR, sur constat de croissance
   du passif.

## 3. Micro-corrections renvoyées au backlog de la fiche (pas de décision ADR)

- `total_visits` n'est pas décrémenté au void ni au refund, alors que le solde de
  points, les points à vie et le total dépensé le sont : le compteur de visites
  gonfle à chaque annulation.
- Le contrôle du solde de points avant rachat lit la ligne client sans verrou,
  alors que le gate d'avoir situé juste en dessous est explicitement
  lock-then-check : deux terminaux simultanés peuvent dépasser le solde.
- Aucune contrainte d'unicité sur le téléphone ni sur l'e-mail : les doublons se
  créent à la source (la fiche assume déjà l'absence de fusion automatique).
- La recherche client ne porte que sur le nom et le téléphone, pas sur l'e-mail ni
  sur la raison sociale.
- Commentaire périmé dans le hook de plafond retail : les types générés
  contiennent désormais le champ, le cast de contournement est inutile.
- Base dev polluée par des fiches de test résiduelles issues des suites
  automatisées.

## 4. Conséquences

- Chantiers à lancer, dans cet ordre : **(a)** RPC plafonds + plafond retail par
  défaut à 300 000 IDR en configuration business + bump du contrôle d'encours
  (défaut retail, renvoi des comptes B2B vers leur plafond B2B, encours comptoir
  compté) + retrait des GRANT colonne — c'est le chantier de démarrage retenu, il
  arme une garde money aujourd'hui inerte ; **(b)** réécriture du modèle d'e-mail d'anniversaire + révocation de la
  fonction d'envoi [petit, coupe un message client faux qui part chaque nuit] ;
  **(c)** RPC d'écriture de fiche client + permission de création en caisse +
  fermeture des policies et GRANT + rattachement des clients sans catégorie à la
  catégorie par défaut [moyen] ; **(d)** prix négocié dans le money-path POS
  **et** périmètre fidélité retail avec respect de `loyalty_enabled`, en un seul
  chantier `_vN+1` puisque ces deux corrections touchent les mêmes RPC [lourd, avec
  redéploiement des Edge Functions consommatrices] ; **(e)** audit sur l'ajustement
  de points et sur l'export, gates de lecture sur le ledger de points et les prix
  négociés [petit]. Fermeture de l'écriture directe sur les catégories au fil de
  l'eau.
- Le rattachement des clients sans catégorie à la catégorie par défaut est une
  écriture de données, pas une correction de code : elle ne change aucun prix (le
  repli implicite les traitait déjà en retail) mais rétablit la justesse des filtres
  et des statistiques du fichier clients.
- La fiche `docs/objectifs/CUSTOMERS.md` est à mettre à jour sur ses **énoncés
  factuels** : les codes de permission cités n'existent pas ; le numéro de membre
  et le QR code décrits ne sont ni en base ni en code ; l'adresse et la note libre
  n'ont pas de colonnes ; la recherche annoncée est plus large que celle
  implémentée ; l'affirmation que l'écriture est conditionnée aux permissions ne
  vaut que des RPC. Ses **énoncés intentionnels** ne se corrigent pas et
  alimentent le backlog : la remise de palier décrite n'existe nulle part, seuls
  les multiplicateurs de points sont implémentés ; le bonus anniversaire et la
  livraison offerte Platinum ne le sont pas non plus.
- La leçon du test vert sur une persistance morte vaut au-delà du module : un test
  de fumée qui espionne le callback de sauvegarde ne prouve rien de l'écriture.

## 5. Révision

Les décisions 1 à 6 ne se rouvrent que par un nouvel ADR.
