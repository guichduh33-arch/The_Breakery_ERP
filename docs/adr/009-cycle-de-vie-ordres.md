# ADR-009 — Cycle de vie des commandes : verrouillage des écritures et transition completed

Date : 2026-07-17
Statut : accepté

## Contexte

Le statut `completed` existait dans l'enum `order_status` mais n'était jamais
atteint : les commandes restaient `paid` à vie. Par ailleurs des chemins
d'UPDATE direct (hors RPC) subsistaient sur `orders`/`order_items`, et
l'annulation de ligne n'était possible que sur `draft`.

## Décisions

1. **D1 — Plus d'UPDATE direct sur `orders` hors RPC.** DROP de la policy
   `perm_update` ; toute écriture passe par RPC SECURITY DEFINER. (#231, _182)
2. **D2 — Idem sur `order_items`.** DROP de `kds_update_kitchen_status` +
   REVOKE UPDATE FROM authenticated. (#231, _182)
3. **D3 — Annulation de ligne étendue à `pending_payment`.**
   `cancel_order_item_rpc_v5`, garde `draft|pending_payment`. (#232, _183)
4. **D4 — Les lecteurs financiers/rapports lisent `paid` ET `completed`.**
   Rapports ventes, dashboard produit, basket, close_shift/Z-report
   (_184.._186). Void/refund possibles depuis `completed` (v5/v6, _187.._188).
5. **D4bis — Événement de transition `paid → completed`** : une commande passe
   `completed` quand elle est payée ET que tous ses items non annulés sont
   servis (≥ 1 item non annulé). Deux chemins couverts par triggers (_189) :
   dernier item servi sur commande payée ; passage `paid` d'une commande déjà
   servie (comptoir). Pas de retour arrière automatique ; le void (RPC v5) est
   la seule sortie de `completed`.

## Conséquences / résiduel

- `retry_sale_journal_entry_v1` garde `status='paid'` strict : le retry de JE
  vente est inaccessible sur une commande passée `completed` (bump v2 à
  décider).
