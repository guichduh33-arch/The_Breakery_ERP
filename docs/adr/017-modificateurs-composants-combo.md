# ADR-017 — Les modificateurs des composants d'un combo : saisis, facturés, déduits

> **Date :** 2026-07-30 · **Statut : ACTÉ** (décision propriétaire, arbitrages du 2026-07-30)
> Document reconstitué a posteriori le 2026-07-31 depuis les livrables du chantier
> (migrations `20260730000002` à `20260730000004`, commits de la branche
> `feat/adr017-pos-component-modifiers`), validé par Mamat le 2026-07-31.

## Décision

Un composant retenu dans un combo se configure, se facture et se déduit
**exactement comme s'il était vendu seul**. Quatre décisions :

1. **Saisie dans le combo.** Les groupes de modificateurs d'un composant retenu
   s'ouvrent **dans la modale de configuration du combo**, sous l'option qui a
   amené ce composant — un seul écran, une seule validation, le prix final
   visible avant de confirmer. Pas de second parcours après coup.
2. **Un groupe requis sans réponse bloque.** La confirmation du combo est
   refusée tant qu'un groupe requis d'un composant retenu est sans réponse —
   même règle que la vente à l'unité. **Rien n'est pré-coché sur un groupe
   requis de composant** : une réponse posée d'office n'est jamais manquante,
   et le blocage n'existerait pas (un café partirait au bar sans que chaud ou
   glacé ait été dit). Le pré-cochage des options du combo lui-même est
   conservé.
3. **Le prix est résolu serveur, modificateurs compris.** Le prix d'un combo
   devient : `combo_base_price` + Σ surcharges des options retenues + Σ
   ajustements des modificateurs répondus sur leurs composants — les trois
   termes résolus **serveur**, aucun montant joint par le client n'étant
   retenu. Chaque ajustement est résolu contre les `product_modifiers` **du
   composant** (scope produit d'abord, scope catégorie en repli, comme une
   ligne ordinaire), jamais contre le produit combo, qui ne porte pas ces
   options.
4. **Le stock suit.** Les ingrédients rattachés à un modificateur de composant
   sont **déduits à la vente** — multipliés par la quantité du composant dans
   le combo — et **restitués** à l'annulation et au remboursement, via le
   snapshot persisté sur la ligne de commande que les parcours void/refund
   relisent déjà.

## Contexte

Au 2026-07-30, le parcours combo court-circuitait entièrement le pipeline des
modificateurs, aux trois étages :

- **Saisie :** choisir un Capuccino dans un combo ne proposait ni chaud/glacé
  ni le type de lait — les groupes du composant n'étaient jamais présentés.
- **Prix :** « Oat Milk » sur le Capuccino d'un combo ne coûtait rien, alors
  que le même lait est facturé quand le café est vendu seul. La résolution des
  modificateurs opérait sur le produit **de la ligne** (le combo), or les
  modificateurs vivent sur le **composant**.
- **Stock :** les 200 ml de lait rattachés à « Oat Milk » sortaient sans trace
  dès que le café était vendu dans un combo — la résolution des ingrédients
  était explicitement désactivée sur une ligne de combo, à la vérification de
  disponibilité comme au calcul du snapshot persisté.

Découverte en chemin, hors périmètre des décisions mais corrigée dans le même
chantier : tout combo portant au moins une option était **inencaissable**
(refus `23514`), le résolveur de prix de ligne tentant de résoudre les options
du combo comme des `product_modifiers`. Corrigé serveur le 2026-07-30 (le
lookup est sauté sur une ligne combo, les libellés restant conservés pour la
cuisine et l'historique) — arbitrage de Mamat du 2026-07-30 : helper interne
sans appel front, signature inchangée, pas de bump des appelantes.

## Conséquences

La numérotation continue celle des décisions (1-4) — c'est sous cette forme
que le code et les tests la citent.

5. **Le KDS affiche les modificateurs des composants.** Le board lit la
   composition de la ligne combo : les modificateurs répondus sur chaque
   composant sont attribués au nom du composant et rendus en sous-lignes
   indentées sous les options du combo — le barista voit HOT/ICED et le lait
   d'avoine sur son écran.
6. *(Retirée à la validation du 2026-07-31 — le numéro est conservé vacant
   pour que les références « conséquence 7 » portées par le code et les
   migrations restent exactes.)*
7. **Un ajustement inconnu est un refus qui se corrige.** Un ajustement
   introuvable ou inactif est un refus dédié
   (`combo_component_modifier_unknown`), distinct des refus de composition
   existants — le caissier sait quoi corriger, jamais un silence à 0.

Conséquences d'implémentation constatées, gravées ici comme faits :

- **Format de transport additif.** Chaque élément de `combo_components` peut
  porter une clé `modifiers` (`[{group_name, option_label}]`). Un composant
  sans cette clé se price exactement comme avant, et les fonctions SQL qui
  lisent la composition sans connaître la clé l'ignorent sans rien casser —
  c'est ce qui a permis de déployer le pricing serveur avant l'émission POS.
- **Deux combos configurés différemment ne fusionnent jamais.** La signature
  de fusion des lignes de panier intègre la configuration des composants
  (l'ordre des composants et de leurs modificateurs étant neutralisé) : deux
  Capuccino, l'un chaud l'autre glacé, choisis via la même option de combo,
  restent deux lignes — sinon la cuisine n'aurait préparé qu'une boisson.
- **Bumps du 2026-07-30 :** l'encaissement direct et l'envoi en cuisine ont
  été bumpés (`complete_order_with_payment` v21→v22, `fire_counter_order`
  v4→v5, anciennes versions droppées) ; le paiement d'une commande firée n'a
  rien eu à changer, il déduit depuis le snapshot que le fire renseigne.

## Résiduel

- **La validation serveur des groupes requis n'est pas activée.** Le blocage
  de la décision 2 est aujourd'hui porté par le domaine et la modale (côté
  client). Le serveur accepte encore un combo dont un groupe requis de
  composant est sans réponse — refus volontairement différé tant que le POS
  n'émettait pas les choix ; l'émission étant livrée, l'activation serveur est
  du backlog.
- **Le chemin KDS hors-ligne n'affiche pas les modificateurs de composants.**
  Le payload du bus `order.fired` ne transporte pas la composition ; l'écran
  offline rend une liste vide. L'extension du format bus est additive et se
  décide séparément (régime append-only de l'outbox, ADR-015).

## Réversibilité

La facturation et la déduction sont portées par la **donnée** : un composant
sans modificateurs répondus se price et se déduit comme avant l'ADR, et
retirer les groupes de modificateurs d'un produit suffit à sortir ce produit
du dispositif. Revenir sur les décisions elles-mêmes (ne plus facturer ou ne
plus déduire des réponses émises) exigerait un nouvel ADR et un bump des RPC
de vente.
