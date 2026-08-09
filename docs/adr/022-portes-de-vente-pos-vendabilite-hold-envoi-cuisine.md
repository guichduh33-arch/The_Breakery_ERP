# ADR-022 — Les portes de vente POS : vendabilité opposable, nature du hold, envoi en cuisine assuré par le serveur

> **Date** : 2026-08-09
> **Statut** : ✅ Accepted (2026-08-09)
> **Décideurs** : propriétaire The Breakery (guichduh33)
> **Complète** : ADR-009, ADR-011 (déc. 2), ADR-012 (déc. 1), ADR-015 et ADR-018
> — sans les modifier. Étend la garde de vendabilité à des portes d'entrée
> qu'aucun d'eux n'avait dans son périmètre, et tranche la nature d'un objet
> qu'ADR-009 n'avait pas qualifié.
>
> **Convention** : aucune version d'objet DB (`_vN`) dans cet ADR — on cite la
> **famille**. La version vivante se vérifie dans `supabase/migrations/` et au
> call-site.
>
> **Modifié le 2026-08-09**, par dérogation explicite du propriétaire à la règle
> documentaire 5 (« un ADR ne se modifie jamais »). Seule la conséquence 6 est
> touchée : elle affectait les trois invariants nouveaux à la fiche `ORDERS.md`,
> qui décrit la page de gestion du back-office et ne peut en porter que deux.
> **Aucune décision n'est modifiée** — la correction porte sur une consigne de
> mise en œuvre écrite sans avoir ouvert la fiche visée.

## Contexte

L'ADR-011 déc. 2 puis l'ADR-012 déc. 1 ont construit la garde de vendabilité du
money-path : un produit soft-deleted, désactivé ou **parent** d'un groupe de
variantes ne peut pas être encaissé, ni en ligne de commande, ni en composant de
combo. La seconde moitié de cette garde a été livrée le 2026-08-09.

Le même jour, la vérification des corps live a établi que **cette garde ne
protège qu'une porte sur sept**. Les autres chemins d'écriture d'`order_items`
sont nettement plus permissifs :

| Famille de RPC écrivant `order_items` | Contrôle produit réel, au 2026-08-09 |
|---|---|
| `complete_order_with_payment` | parent + inactif + soft-deleted, composants compris |
| `fire_counter_order` (comptoir) | **existence seule** |
| `create_tablet_order` (salle) | **aucun** |
| `hold_order` (mise en attente) | **aucun** |
| `add_order_item` (édition back-office) | inactif seul |
| `create_b2b_order` | existence seule |
| `import_sales` | soft-deleted seul, par SKU |

La famille `pay_existing_order`, qui encaisse ce que ces portes ont écrit, ne
revalide rien : elle ne relit les produits que pour la déduction de stock.

**Le parcours comptoir → paiement différé échappe donc entièrement à la garde.**
Un produit-parent envoyé en cuisine par le comptoir, ou une commande de salle
portant un produit supprimé, s'écrit sans obstacle ; le paiement qui suit ne
rattrape rien. La garde du money-path direct n'est contournée par aucune ruse :
il suffit d'emprunter l'autre chemin, celui que le personnel emprunte justement
pour toute commande servie à table ou payée après coup.

Ce n'est pas un oubli d'exécution, c'est un trou de **périmètre**. L'ADR-011 et
l'ADR-012 ont tranché sur la RPC de paiement parce que l'audit qui les a motivés
portait sur le catalogue produits, pas sur le cycle de vie des commandes.
Personne n'a jamais décidé que les autres portes en étaient dispensées.

### Le facteur hors-ligne, et l'appel d'appoint du checkout

Deux de ces portes — le comptoir et la salle — sont **rejouées par la file
hors-ligne**. L'ADR-018 D2 énonce qu'ajouter un garde serveur sur une RPC rejouée
oblige à revoir la liste des échecs définitifs dans le même lot, et sa D3 fait
cascader la quarantaine d'un intent sur tous ceux qui partagent sa racine de
commande — **le règlement compris**.

S'y ajoute un chemin moins visible : au moment d'encaisser, le terminal de
paiement **pousse d'abord au serveur les lignes du panier non encore envoyées**,
par un appel d'appoint à la famille `fire_counter_order`, avant d'appeler
`pay_existing_order`. Une garde posée sans discernement sur cette famille peut
donc refuser en plein encaissement, avec le client devant la caisse.

Ces deux chemins ont la même propriété : **le refus y arrive trop tard**. La
marchandise est partie ou l'argent est perçu ; la garde n'y protège plus rien et
n'y produit qu'un blocage.

### Ce qu'est réellement une commande « en attente »

Le code porte **deux mécaniques de hold** que rien ne distingue par le nom :

- `hold_fired_order` met en attente une commande **déjà envoyée en cuisine** —
  elle exige un statut `pending_payment` d'origine caisse et se contente de
  marquer la commande. Réouverture par `reopen_held_order`.
- `hold_order` prend le **panier local** et en fabrique une commande `draft`
  numérotée, dont les lignes sont écrites avec `is_locked` faux et un statut
  cuisine `pending` : **rien n'est envoyé en cuisine**. Sa restauration supprime
  la commande et rend le panier.

La seconde crée donc un objet qui porte un numéro de commande sans être une
commande — un panier parqué, promu au rang d'écriture serveur.

## 1. Décisions

### Décision 1 — La définition de « vendable » est unique et vaut pour toutes les portes de vente POS

Les familles `fire_counter_order`, `create_tablet_order` et `add_order_item`
appliquent **la même règle de vendabilité que le money-path** : sont refusés un
produit soft-deleted, un produit désactivé et un produit-parent d'un groupe de
variantes — **sur la ligne de commande comme sur chaque composant de combo**,
conformément à l'ADR-012 déc. 1.

Le **stock épuisé reste toléré**, sans changement : l'ADR-011 déc. 2 a tranché ce
point, et la vente hors-ligne peut légitimement diverger du stock cloud jusqu'au
rejeu.

**Pourquoi une règle unique.** Deux définitions de « vendable » qui coexistent sur
le même produit ne sont pas une nuance, c'est un défaut : la plus permissive
gagne toujours, puisqu'il suffit d'emprunter son chemin. Aligner les portes est
ce qui rend la garde du money-path réellement opposable, au lieu d'être une
garantie qui ne tient que sur le parcours le plus surveillé.

### Décision 2 — Rien n'oppose la vendabilité à un encaissement en cours

La garde vit **à l'entrée de la ligne dans la commande**. Elle ne s'oppose ni à
la famille `pay_existing_order`, qui ne revalide rien et n'a pas à le faire, ni à
l'appel d'appoint qui pousse les dernières lignes du panier au moment du
checkout.

**Pourquoi.** À cet instant, le plat est sorti de cuisine ou le client est devant
la caisse. Refuser là ne protège plus rien — la commande existe, la marchandise
est partie — et produit une **commande impayable**, c'est-à-dire précisément le
mal que la décision 1 répare. Un produit désactivé en back-office entre la saisie
et l'encaissement est un événement normal ; il ne doit jamais coincer une caisse.

**Conséquence assumée** : la fenêtre entre saisie et paiement n'est pas couverte.
C'est voulu. La garde a fait son travail au seul moment où elle pouvait éviter un
dégât.

### Décision 3 — Un appel de finalisation ou de rejeu est explicitement toléré, et la garde est portée en amont

Trois mouvements indissociables, à livrer dans le même lot :

1. **Un drapeau unique de tolérance**, côté serveur, couvre les deux situations
   où le refus arrive trop tard : le **rejeu hors-ligne** et l'**appel d'appoint
   du checkout**. La mécanique est celle qui existe déjà sur la famille
   `pay_existing_order` : un paramètre explicite, tracé dans `audit_logs`. Il est
   à ajouter aux familles `fire_counter_order` et `create_tablet_order`.
2. **La garde est portée côté client**, avec les mêmes critères que la RPC, **au
   moment où la ligne entre au panier** et **avant tout enfilement hors-ligne**,
   en application de l'ADR-018 D7. La tolérance serveur ne dispense jamais de
   refuser la ligne à la saisie.
3. **Le drapeau n'est jamais posé par défaut.** Un appel qui ne relève ni du
   rejeu ni de la finalisation d'un encaissement se voit opposer la garde.

**Pourquoi cette asymétrie.** Ce qui a été vendu hors-ligne l'a été sous le
catalogue d'alors, et l'argent a été perçu. Un durcissement postérieur ne peut
pas rendre cette vente rétroactivement irrecevable : la seule chose qu'il
obtiendrait serait d'empêcher l'encaissement de remonter. Refuser au rejeu
protégerait une donnée en sacrifiant de l'argent réel — le mauvais côté de
l'arbitrage que l'ADR-018 D2 a déjà tranché en posant que **le défaut protège
l'argent**.

**Corollaire** : la liste des échecs définitifs de l'ADR-018 D2 **n'est pas
étendue** par ce chantier. C'est la revue qu'imposait sa D2, et sa conclusion est
qu'il n'y a rien à y ajouter, puisque la garde ne se déclenche jamais au rejeu.

### Décision 4 — On ne met en attente qu'une commande envoyée en cuisine

**Une commande n'existe qu'à partir du moment où elle part en cuisine ou qu'elle
est payée.** Ce qui est saisi sans avoir franchi l'un de ces deux seuils est un
**brouillon**, pas une commande : il ne porte pas de numéro et ne s'écrit pas
dans `orders`.

En conséquence, la mise en attente ne s'applique qu'à une commande envoyée en
cuisine. La mécanique qui parque le panier en fabriquant une commande `draft`
disparaît — famille `hold_order` et son parcours de restauration —, et seule
subsiste celle qui marque une commande déjà envoyée. Le geste « mettre en
attente » depuis la caisse passe donc désormais **par l'envoi en cuisine**.

**Pourquoi.** Un objet qui porte un numéro de commande sans en être une pollue
tout ce qui compte des commandes — rapports, journal, listes, rapprochement de
caisse — et crée une septième porte d'écriture d'`order_items` sans contrepartie
métier. Le besoin qu'elle servait, mettre un panier de côté, est déjà couvert :
le brouillon vit en caisse et sa saisie est tracée (§2).

**Conséquence assumée** : on ne peut plus parquer au serveur un panier que le
client n'a pas confirmé. C'est le sens de la décision — ce panier-là n'a pas à
exister côté serveur.

### Décision 5 — Une commande payée directement part en cuisine par le serveur, pas par le poste

**Le constat** : les familles `fire_counter_order` et `create_tablet_order`
marquent leurs lignes comme envoyées en cuisine — verrou, statut cuisine,
horodatage d'envoi. La famille `complete_order_with_payment` résout bien la
station de dispatch, mais **ne pose aucune de ces trois marques**. Or l'écran de
cuisine ne retient que les lignes verrouillées et les ordonne par horodatage
d'envoi.

L'envoi en cuisine d'une vente payée au comptoir repose donc entièrement sur le
poste de caisse : après l'encaissement, le terminal imprime les tickets de
préparation **sans rien écrire au serveur** — ce chemin saute délibérément la RPC,
au motif que la commande est déjà en base. Elle l'est, mais **sans la marque qui
la rend visible en cuisine**.

Conséquence : **une vente directement payée n'atteint jamais l'écran de cuisine**,
quelle que soit sa station. Elle n'existe pour la production que par son ticket
papier, et si l'impression échoue il ne reste rien. Mesure du 2026-08-09 sur la
base de développement, à titre d'ordre de grandeur : 137 lignes payées portant
une station de préparation réelle n'avaient aucune chance de s'afficher, quand
les lignes issues de la salle étaient toutes marquées.

**La décision** : **le marquage d'envoi en cuisine appartient à la RPC qui crée
la commande**, pas au poste. La famille `complete_order_with_payment` pose les
mêmes marques que les deux autres portes, sur toutes ses lignes — le tri par
station reste le seul filtre de l'écran de cuisine, une ligne sans station n'y
apparaissant pas.

L'auto-impression post-paiement du poste **conserve son rôle d'impression** et
cesse d'être le chemin par lequel la cuisine apprend l'existence de la commande.

**Pourquoi.** Un envoi en cuisine qui ne vit que dans le poste disparaît avec lui
— impression en échec, terminal fermé, papier absent — et rien côté serveur ne
permet de constater la perte. C'est aussi la seule des trois portes de création à
ne pas tenir sa part du seuil posé par la décision 4 : elle produit une commande
au sens de cet ADR, elle doit en porter les marques.

### Décision 6 — Les commandes B2B et l'import de ventes restent hors périmètre

Les familles `create_b2b_order` et `import_sales` **ne sont pas durcies par cet
ADR**. Leur écart au tableau du contexte est constaté, daté, et laissé ouvert.

**Pourquoi les séparer.** Leurs risques ne sont pas ceux d'une caisse : la
commande B2B produit une facture et un encours client, l'import de ventes est une
reprise d'historique dont la règle de vendabilité doit vraisemblablement être
celle de la date d'origine, pas celle du jour. Les traiter au même bump
reviendrait à décider de ces deux sujets sans les avoir instruits.

**Ce que cela engage** : ces deux portes demandent leur propre décision. Les
laisser sans ADR reviendrait à transformer un report en oubli.

## 2. Enregistrement — la traçabilité du brouillon est déjà acquise

Pour mémoire, et parce que la décision 4 s'y adosse : les mutations du brouillon
de caisse sont **déjà journalisées**. Le journal opérationnel du POS enregistre
l'ouverture, l'ajout d'une ligne — ligne simple comme combo —, le changement de
quantité, le retrait avant envoi, le changement de type de commande et
l'affectation de table. Ces événements partent par une file durable, sont
dédupliqués côté serveur et se relisent par la famille `get_pos_events`.

Aucune décision n'est requise : l'exigence est satisfaite par l'existant.

## 3. Conséquences

1. **Chantier**, dans cet ordre : (a) bump des trois familles de la décision 1,
   avec DROP de la version précédente dans la même migration (ADR-011 déc. 4) ;
   (b) drapeau de tolérance sur les deux familles concernées (décision 3) ;
   (c) garde client à la saisie et avant enfilement ; (d) retrait de la mécanique
   de hold du panier et de son parcours de restauration (décision 4) ;
   (e) bump de la famille `complete_order_with_payment` pour le marquage d'envoi
   en cuisine (décision 5) ; (f) redéploiement des edge functions consommatrices.
   Aucun `CREATE OR REPLACE` sur version publiée.
2. **Le parcours caisse change** (décision 4) : le geste de mise en attente
   implique l'envoi en cuisine. L'écran des commandes en attente ne présente plus
   que des commandes envoyées. La RPC de rejet d'une commande en attente conserve
   son rôle : elle sert aussi les commandes caisse non payées.
3. **Preuves exigibles** (ADR-021 déc. 6), **un test négatif par garde ajoutée** :
   produit-parent refusé sur chacune des portes de la décision 1 ; composant de
   combo parent refusé ; produit soft-deleted et produit désactivé refusés ;
   variante saine acceptée, pour prouver l'absence de sur-blocage ; **appel
   porteur du drapeau accepté malgré un produit devenu non vendable** ; **appel
   sans drapeau refusé sur le même produit**, pour prouver que la tolérance n'est
   pas le défaut ; encaissement d'une commande dont un produit a été désactivé
   après création, accepté (décision 2). Pour la décision 5 : **une vente payée
   directement rend ses lignes à préparer visibles de l'écran de cuisine**, et
   une ligne sans station n'y apparaît pas. Régénération des types après
   changement de signature.
4. **Le marquage d'envoi ne vaut que pour l'avenir** (décision 5). Les commandes
   déjà payées sans marque ne sont pas reprises : ADR-021 déc. 2 pose que le code
   se corrige et que les données de développement ne se réparent pas. Le chiffre
   cité au constat mesure le défaut, il n'ouvre pas un chantier de reprise.
5. **La revue imposée par l'ADR-018 D2 est faite** et conclut à aucun ajout à la
   liste des échecs définitifs (décision 3). Ce point est à re-instruire au
   prochain durcissement d'une RPC rejouée — il ne se déduit pas de cet ADR.
6. **Trois invariants nouveaux entrent dans les fiches d'objectifs, répartis
   selon leur registre.** La fiche `docs/objectifs/ORDERS.md` décrit la page de
   gestion du back-office : elle reçoit les deux qui la concernent — un produit
   non vendable n'entre pas dans une commande, même par l'édition depuis cette
   page ; et la liste ne montre que des commandes réelles, un brouillon de caisse
   ne s'écrivant pas en base. Le troisième — la marque d'envoi en cuisine est
   posée par la RPC qui crée la commande, sur les trois portes — n'est pas un
   invariant d'écran de gestion : il porte sur ce que la caisse écrit, et revient
   à la fiche `POS.md`. Une porte d'écriture nouvelle naît soumise aux trois.
7. **Le trou B2B / import reste ouvert** (décision 6) et doit être porté au
   backlog du module concerné pour ne pas se perdre.
8. **Ce chantier relève de la dette d'ADR** (ADR-021 déc. 4c) : il solde un
   engagement déjà pris par les ADR-011 et ADR-012, dont le périmètre était
   incomplet. Il ne constitue pas une fonctionnalité nouvelle.
9. **Cet ADR n'exige pas de spec d'exécution** (règle documentaire 4) : le
   chantier tient dans un lot unique.

## 4. Ce que cet ADR ne tranche pas

- **La borne du stock négatif.** Le stock épuisé reste toléré ; l'arbitrage
  ouvert que l'ADR-021 §3 relève n'est pas touché ici.
- **La vendabilité applicable à une reprise d'historique** — celle du jour ou
  celle de la date d'origine (décision 6).
- **Le sort d'une commande déjà créée dont un produit devient non vendable.**
  Elle s'encaisse (décision 2) ; savoir si elle mérite un signalement en
  back-office n'est pas décidé.
- **Le comportement du back-office lorsqu'il désactive un produit présent dans
  une commande ouverte.** Aucun avertissement n'est exigé par cet ADR.
- **La durée de vie et la persistance du brouillon de caisse.** La décision 4
  dit qu'il n'est pas une commande, pas où ni combien de temps il survit.
- **Le sort d'une impression de ticket en échec.** La décision 5 donne à la
  cuisine un second chemin, indépendant du papier ; elle ne décide pas de ce
  qu'il advient quand l'imprimante ne répond pas.

## 5. Révision

Les décisions 1 à 6 ne se rouvrent que par un nouvel ADR.
