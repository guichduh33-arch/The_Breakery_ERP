# ADR-010 — Items envoyés en cuisine : verrouillage, autorisation manager, perte obligatoire

> **Date** : 2026-07-17
> **Statut** : 🟡 BROUILLON — à relire et passer en ✅ Accepted par le propriétaire
> **Décideurs** : propriétaire The Breakery (guichduh33)
> **Supersedes** : — (complète ADR-009 ; formalise l'intention d'origine de
>   `is_locked`, migration _003/_004 : « cancel/edit interdit »)
> **Contexte** : un item envoyé en cuisine (`is_locked = true`, posé par
>   `send_items_rpc` à l'émission du KOT) peut aujourd'hui être **réduit ou
>   supprimé sans aucun contrôle** : `update_order_item_qty_v1` et
>   `remove_order_item_v1` ne vérifient que le statut de la commande, jamais
>   `is_locked`. L'annulation, elle, exige déjà le PIN manager (EF cancel-item,
>   header `x-manager-pin`) mais ne trace aucune perte. Le trou principal est
>   l'édition ; la perte manquante est le second.

## Décisions

1. **D1 — Un item verrouillé est intouchable par le serveur.** Sont couverts :
   l'**annulation**, la **baisse de quantité**, la **suppression**, la
   modification des **modifiers** et de la **note cuisine** d'un item
   `is_locked = true`. L'ajout de nouveaux items à la commande reste libre
   (nouveau KOT), y compris une ligne identique — une hausse de quantité se
   fait par ajout, jamais par retouche de la ligne verrouillée.

2. **D2 — La colonne d'autorité du verrou est `order_items.is_locked`**, posée
   à l'émission du KOT par `send_items_rpc`. Pas d'état intermédiaire : un
   item est libre ou verrouillé. (`sent_to_kitchen_at` reste l'horodatage,
   `is_locked` reste le booléen de garde.)

3. **D3 — Déverrouillage par autorisation manager ou admin, vérifiée serveur.**
   Le PIN du serveur ne débloque rien. Le véhicule dépend du flux, sans en
   réécrire un conforme :
   - **Flux cancel (POS)** : conserve le véhicule existant — EF `cancel-item`,
     PIN en header `x-manager-pin` vérifié in-EF, RPC service_role-only.
   - **Flux édition (RPCs appelées directement par le client)** : nonce
     d'autorisation à usage unique et expiration courte (pattern
     `discount_authorizations`), émis par une EF de vérification PIN.
   Dans les deux cas : `audit_logs` trace l'auteur du geste ET l'autorisateur.

4. **D4 — Toute annulation, suppression ou baisse de quantité d'un item
   verrouillé déclenche une déclaration de perte obligatoire**, dans le même
   flux : raison à choisir (erreur de saisie, client parti, plat raté, autre),
   quantité pré-remplie = quantité retirée (le delta, pour une baisse).
   **La perte est déclarée en unité produit et déduite via le circuit waste
   recette-aware existant** (ingrédients de la recette, ou produit fini pour
   un `is_display_item`) — jamais via la ligne de vente, qui n'a rien déduit
   avant paiement. Rattachement à la commande par
   `stock_movements.reference_type/reference_id`.
   *Modalité* : l'autorisateur peut ajuster la quantité de perte (cas où rien
   n'était produit) — la déclaration reste obligatoire, la quantité est son
   jugement. Conforme ADR-004 : les pertes se déclarent.

5. **D5 — Une seule porte de sortie pour un item verrouillé.** Sur
   `is_locked = true`, `remove_order_item` **refuse** et renvoie vers le flux
   cancel — sinon la suppression contournerait la perte du D4. De même, la
   baisse de quantité porte la perte sur le delta — sinon « réduire au lieu
   d'annuler » serait le contournement.

6. **D6 — Le KDS reflète l'annulation immédiatement** (item barré/retiré sur
   le ticket). Déjà largement en place : le KDS lit `is_cancelled` en
   realtime ; vérifier la couverture du cas suppression/réduction autorisée.

## Conséquences (RPCs nommées)

- `cancel_order_item_rpc_v5 → v6` : garde `is_locked` ⇒ perte obligatoire
  liée (PIN déjà exigé par l'EF, inchangé).
- `update_order_item_qty_v1 → v2` : garde `is_locked` ⇒ nonce + perte sur le
  delta en cas de baisse.
- `remove_order_item_v1 → v2` : garde `is_locked` ⇒ refus, renvoi flux cancel.
- Toute autre RPC d'édition d'item (modifiers, note) : même garde nonce —
  aucune n'existe à ce jour ; toute future RPC de ce type naît avec la garde.
- EF d'émission de nonce : réplique du pattern discount, PIN en header.
- POS + tablette : cadenas visuel sur lignes verrouillées, flux « demander un
  manager », plus d'édition proposée sans autorisation.
- Cérémonie money-path adjacente : RPC vN+1 depuis `pg_get_functiondef`,
  pgTAP (refus sans nonce, nonce expiré/réutilisé, PIN non-manager, perte
  créée/liée/en bonne unité, delta de baisse, remove refusé sur verrouillé,
  ajout toujours libre, comportement draft intact), regen types.
- Fiches à aligner après acceptation : ORDERS.md (invariant), POS.md,
  TABLET_ORDERING.md, KDS.md.

## Résiduel

- Rapport Waste : exposer le rattachement perte ↔ commande
  (`reference_type/reference_id` suffisent) — item backlog REPORTS.

## Révision

Ces décisions ne se rouvrent que par un nouvel ADR.
