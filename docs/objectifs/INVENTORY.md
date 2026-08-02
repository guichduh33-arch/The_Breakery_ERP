# Module Inventory (Stock) — Objectif métier

> **Périmètre** : cette fiche répond à « **qu'est-ce que The Breakery possède,
> et comment ça bouge** ». Le catalogue — ce qui est vendable, comment c'est
> composé et coûté — est dans `PRODUCTS.md`. Frontière posée par **ADR-007 déc. 1**.
>
> **Révision** : 2026-07-28 · **Statut** : Partiel
> **ADR applicables** : ADR-004 (ni péremption, ni FIFO, ni lots — décision
> propriétaire, ne pas re-proposer), ADR-008 (production & recettes : blocage à
> stock insuffisant, refus du revert d'une production entamée), ADR-014 (aucune
> écriture de réévaluation sur un changement de coût ; le GL inventaire reste
> basé transactions)
>
> **Convention** : aucune version d'objet DB (`_vN`) dans cette fiche — on cite
> la famille (`record_stock_movement`, `receive_stock`). La version vivante se
> vérifie dans `supabase/migrations/` et au call-site, jamais ici.

---

## 1. Raison d'être

Une boulangerie perd de l'argent par le stock avant d'en perdre par la caisse :
farine payée et jamais tracée, pâte produite et jamais consommée, vitrine
réapprovisionnée sans qu'on sache ce qui a été jeté. Le module Inventory
répond à quatre questions, et à elles seules :

> *« Combien j'ai de chaque chose, où ? Combien ça m'a coûté ? Qu'est-ce qui a
> bougé, quand, et sur ordre de qui ? Et pourquoi mon comptage physique ne
> tombe pas juste ? »*

Il ne dit **pas** ce qu'on vend ni à quel prix — c'est `PRODUCTS.md`. Il ne
produit **pas** — c'est `PRODUCTION.md`. Il n'achète **pas** — c'est
`PURCHASING_AND_SUPPLIERS.md`. Il **enregistre** ce que ces trois modules font
au stock, et il est le seul à le faire.

## 2. L'invariant fondateur — le ledger append-only

`stock_movements` est un **journal en écriture seule**. Aucune ligne n'est
modifiée, aucune n'est supprimée : RLS révoque UPDATE et DELETE, et toute
écriture passe par une RPC SECURITY DEFINER. Une erreur ne se corrige pas en
réécrivant le passé, elle se corrige par un **mouvement inverse daté**.

C'est ce qui rend le stock opposable : le solde d'un produit n'est pas une
valeur qu'on ajuste, c'est la **somme d'une histoire**.

**Deux invariants d'unité, qui coûtent cher quand on les ignore.**

- `unit` est **NOT NULL** sur chaque mouvement. Quand l'appelant ne la fournit
  pas, la RPC d'écriture la **résout d'elle-même** — elle ne devine pas, elle
  la déduit du produit.
- `unit_cost` s'exprime en **unité de BASE**, jamais dans l'unité saisie. À la
  réception, la quantité est **multipliée** par le facteur de conversion et le
  coût **divisé** par ce même facteur. C'est la classe d'erreur du ×1000
  (ADR-008 D1) : une saisie en kilos rangée comme des grammes fausse le coût
  moyen de tout le produit, silencieusement.

## 3. Les familles de mouvement — et où lit-on la liste qui fait foi

⚠️ **L'énumération exacte des types de mouvement vit dans Postgres
(`movement_type`), et nulle part ailleurs.** Cette fiche décrit des
**familles** et leur sens métier ; elle n'en donne pas la liste, parce qu'une
liste recopiée diverge et fabrique la classe de bug que `CLAUDE.md` combat
(`take_away` vs `take_out`). Pour la liste réelle : `enum_range` en base.

| Famille | Sens métier | Origine |
|---|---|---|
| **Entrées d'achat** | ce qu'on a acheté et reçu ; c'est ce qui nourrit le coût moyen pondéré | module Purchasing, à la réception |
| **Entrées de production** | ce que la cuisine a fabriqué ; entre en produit fini et sort en matières | module Production |
| **Sorties de vente** | ce que la caisse a vendu ; déduit par l'unique helper de vente, jamais par le POS | money-path |
| **Pertes** | casse, invendu, retrait cuisine ; toujours motivées | POS, KDS, BO |
| **Transferts** | déplacement entre emplacements ; ne change pas la quantité totale possédée | BO |
| **Ajustements & inventaire** | l'écart constaté au comptage physique, matérialisé | opname |
| **Correction de coût** | outil de réparation admin, quantité nulle, trace du coût avant/après | BO, sous permission dédiée |

## 4. Ce que le module ne fait pas — par décision, pas par manque

- **Pas de FIFO. Pas de péremption. Pas de gestion de lots** — **ADR-004**,
  décision propriétaire. L'infrastructure `stock_lots` existe, elle est
  **dormante et assumée telle** ; le cron d'expiration est désactivé en base.
  **Ne pas la « réparer », ne pas re-proposer le sujet.**
- **Pas de réévaluation comptable quand un coût change** — **ADR-014**. Le
  grand livre inventaire reste basé transactions ; l'écart avec la
  valorisation instantanée `current_stock × cost_price` est **normal entre
  deux inventaires** et se résorbe à l'opname.
- **Pas de valorisation IFRS.** On est NON-PKP (ADR-003/005) : le besoin est
  le pilotage de marge, pas la conformité d'un groupe coté.

## 5. Le stock de vitrine du POS — une deuxième mesure, volontairement séparée

> **Intention propriétaire, datée du 2026-05-30.** Le module `stock` du POS est
> un **compteur de vitrine** : combien de croissants sont physiquement en
> présentoir, maintenant. Il est **indépendant du stock BO** : pas de lot, pas
> de coût moyen, pas d'écriture comptable. **C'est correct par design — ne pas
> le « réparer ».**

Cette intention vivait jusqu'ici dans un fichier de skill non gouverné. Elle
est ici parce que c'est ici sa place : une intention propriétaire ne se
transmet pas par un outil d'agent.

Conséquence pratique : deux écrans peuvent afficher deux nombres différents
pour le même produit, et **aucun des deux n'est en panne**. L'un compte la
vitrine, l'autre compte ce qu'on possède.

## 6. Frontière avec Accounting — qui porte le côté grand livre

La ligne de partage retenue :

- **Inventory possède le fait** : quoi, combien, quand, sur ordre de qui,
  à quel coût unitaire. Le ledger est sa vérité.
- **Accounting possède l'écriture** : quel compte est débité, quel compte est
  crédité, dans quelle période fiscale. Les triggers d'écriture, le mapping
  des comptes et la clôture de période sont décrits dans `ACCOUNTING.md`,
  jamais ici.
- **Le point de contact est nommé** : un mouvement de stock qui produit une
  écriture le fait par trigger, et la liste des types qui en produisent — comme
  celle des types silencieux — est un **fait de base**, décrit dans
  `ACCOUNTING.md`.
- **ADR-014 appartient aux deux fiches et ne se duplique pas** : Inventory dit
  *pourquoi les deux mesures divergent* (§4), Accounting dit *comment l'écart
  se solde*.

Sans cette ligne, INVENTORY et ACCOUNTING se disputeront ADR-014 comme
PRODUCTION et PURCHASING se disputaient le stock.

## 7. Les surfaces livrées

**Au 2026-07-28** : le back-office expose **12 pages** sous `inventory/` sur
**18 routes** — stock produit, mouvements, alertes, inventaires et leur détail,
stock vitrine, sections, production et son planning, veille de marge, dashboard
produit. Le POS porte son compteur de vitrine et la déclaration de perte.

## 8. Ce qui reste ouvert

- 🔴 Un intent de mouvement rejeté au rejeu hors-ligne bloque le drain — la
  politique n'est pas décidée (registre, candidat ADR n°1).
- 🟠 Jusqu'où tolère-t-on le stock négatif, et qui est alerté (D-28).
- 🟠 Revert d'un lot partiellement vendu : quel chemin, qui l'autorise (D-19).
- 🟡 Cadence des inventaires : c'est elle qui détermine la fraîcheur du grand
  livre (conséquence 3 d'ADR-014), elle n'est fixée nulle part.
