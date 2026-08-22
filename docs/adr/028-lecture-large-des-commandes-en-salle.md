# ADR-028 — Lecture des commandes en salle : largeur assumée, écritures fermées

> **Date :** 2026-08-22 · **Statut : ACTÉ** (décision propriétaire 2026-08-22, en réponse au
> lot C de l'audit POS waiter du même jour ; commit du texte après validation)

## Décision

Tout compte authentifié — serveurs de salle compris — **lit toutes les commandes**. Il n'y a
pas de cloisonnement par serveur, et il n'y en aura pas.

La politique `orders.tablet_waiter_own_pending`, qui prétendait cloisonner sans le faire, est
**supprimée**. La politique survivante `orders.auth_read` porte désormais un `COMMENT` qui
énonce la règle à l'endroit où elle s'applique.

Les **écritures** restent fermées : aucune politique `INSERT` / `UPDATE` / `DELETE` sur
`orders` ni `order_items`. Toute écriture de commande passe par une RPC `SECURITY DEFINER`.

## Contexte

- L'audit du 2026-08-22 a établi que `orders` portait **deux** politiques `SELECT`, toutes
  deux **permissives**. Les politiques permissives se combinent par **OU** : `auth_read`
  (`is_authenticated() OR has_kiosk_jwt(NULL)`) accordant déjà la lecture de toute la table,
  la seconde ne pouvait rien restreindre.
- Le cloisonnement apparent d'une serveuse à ses propres commandes ne tenait donc qu'au
  filtre **client** de l'onglet « My Orders ». Via PostgREST, un compte waiter lisait déjà
  tout le restaurant — et le lisait ainsi depuis `20260507000007_tablet_rls.sql`.
- La décision initiale du propriétaire, le 2026-08-22, avait été de **durcir** la politique.
  L'implémentation a fait apparaître un empêchement mesuré : `useTableOccupancy` dérive
  l'occupation des tables de **toutes** les commandes portant un `table_number`. Une serveuse
  limitée à ses propres lignes aurait vu **libres** les tables tenues par ses collègues, et y
  aurait assis des clients. `useTableOrders` a le même besoin pour la 2ᵉ tournée.
- Remis devant cet écart, le propriétaire a tranché le même jour pour la **version allégée** :
  chaque serveur peut ouvrir toutes les commandes. Ce n'est pas un repli — c'est la
  reconnaissance d'un usage réel : un serveur reprend couramment la table d'un collègue en
  fin de service.

## Arbitrages (propriétaire, 2026-08-22)

1. **Pas de cloisonnement par serveur**, ni maintenant ni en projet. La question est close ;
   la rouvrir demande un ADR qui supersede celui-ci.
2. **La politique décorative est retirée, pas durcie.** Une politique qui ne fait rien coûte
   plus qu'elle ne rapporte : elle fait conclure à tort qu'un cloisonnement existe, et le
   prochain audit repart de cette illusion.
3. **La règle réelle est écrite en `COMMENT` sur `auth_read`**, pas seulement dans un ADR.
   Le schéma doit dire la vérité à qui le lit sans ouvrir `docs/`.
4. **Le filtre « mes commandes » de la tablette reste**, et reste **côté client**. C'est un
   confort d'affichage, jamais une frontière de sécurité.
5. **Le rempart est déplacé sur les écritures**, pas relâché. La lecture large n'est
   acceptable que tant que `orders` et `order_items` n'ont aucune politique d'écriture.

## Conséquences

1. `supabase/tests/orders_read_policy_is_deliberately_broad.test.sql` tient les deux choses
   qui rendent la largeur acceptable : l'absence de politique d'écriture, et la présence du
   commentaire. Il tient aussi le retour de la politique décorative par une fusion écrasante.
2. Ce test **ne teste pas** « la lecture est large » : c'est le défaut d'une table sans
   politique restrictive, il n'y a rien à y asserter.
3. L'imputation d'une commande à un serveur cesse d'être une affaire de lecture et devient
   une affaire d'**écriture** : elle est tenue par `create_tablet_order_v8` (ADR non requis,
   simple durcissement d'une RPC), qui refuse un `p_waiter_id` autre que le profil de
   l'appelant.
4. Un futur écran qui aurait besoin d'un vrai cloisonnement — un portail client, un compte
   partenaire — ne peut pas s'appuyer sur `orders` en lecture directe. Il lui faudra une RPC
   `SECURITY DEFINER` dédiée, ou une politique **restrictive** introduite par un nouvel ADR.

## Ce que cette décision ne tranche pas

- Le sort de `has_kiosk_jwt(NULL)` dans `auth_read`, hérité et non revu ici.
- La lecture de `order_items`, dont la politique `auth_read` reste sans commentaire : même
  largeur de fait, mais l'audit ne l'a pas instruite.
- L'état de la publication temps réel et des politiques **en production** : l'audit et ce
  chantier n'ont interrogé que la V3 dev.
