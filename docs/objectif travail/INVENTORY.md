# Module Inventory — Objectif métier

> **Périmètre fonctionnel** : ce document décrit **ce que le module Inventory sert à faire au quotidien** pour The Breakery, sans rentrer dans la mécanique technique.

---

## 1. Raison d'être

Le module Inventory est le **gardien du stock physique** de The Breakery. Il répond à une question simple mais critique pour une boulangerie :

> *"Combien j'ai de chaque ingrédient et de chaque produit fini, à quel endroit, et est-ce que ça colle avec ce que je vois sur les étagères ?"*

C'est le module qui transforme la cuisine, le frigo, l'arrière-boutique et la vitrine en **données fiables et chiffrées**, mises à jour à chaque vente, chaque production, chaque livraison, chaque casse — pour que personne ne tombe en rupture devant un client et que personne ne jette de la marchandise oubliée au fond d'un placard.

---

## 2. Les 7 outils du module (les 7 onglets)

Le module est structuré en **7 onglets** correspondant à 7 jobs-to-be-done distincts :

| Onglet | Job-to-be-done |
|---|---|
| **Stock** | Voir d'un coup d'œil le niveau de chaque produit + ajuster une quantité |
| **Incoming** | Enregistrer une marchandise qui arrive sans bon de commande formel |
| **Transfers** | Déplacer du stock d'une section à une autre (entrepôt → cuisine) |
| **Wastage** | Déclarer une perte (casse, péremption, brûlé, etc.) |
| **Production** | Enregistrer une fabrication et déduire automatiquement les ingrédients |
| **Opname** | Faire un inventaire physique et corriger les écarts |
| **Movements** | Consulter l'historique complet de tous les mouvements de stock |

Ces 7 onglets couvrent **toute la vie d'un produit** entre son entrée et sa sortie.

---

## 3. Objectif Stock (vue principale)

Donner au gérant ou au chef une **vue agrégée du stock disponible**, avec les bonnes alertes pour anticiper :

- Liste de tous les produits avec leur niveau de stock courant.
- Recherche par nom, code, catégorie.
- **Indicateurs visuels** d'alerte : stock faible (<10 unités) en orange, stock critique (<5 unités) en rouge.
- **Ajustement manuel** ponctuel (ajustement+ ou ajustement−) avec raison obligatoire — pour corriger une coquille de saisie sans devoir lancer un opname complet.
- Accès direct à la **fiche détaillée** d'un produit (dashboard analytique : timeline de stock, consommation hebdo, achats récents, recettes qui le consomment, opnames passés).

Bénéfice métier : **éviter les ruptures** sans surstocker. Le module remonte les alertes au lieu d'attendre que le chef ouvre un placard vide.

---

## 4. Objectif Incoming Stock (réception hors PO)

Permettre d'enregistrer une **marchandise qui arrive sans bon de commande formel** : achat cash & carry au supermarché, dépannage en urgence chez un voisin, don, retour client, etc.

Le responsable saisit :

- Produit reçu, quantité, unité, prix d'achat.
- Section de destination (entrepôt, cuisine, vitrine).
- Optionnel : fournisseur, note libre.

Le stock est mis à jour immédiatement, un mouvement `stock_in` est tracé dans le ledger, et le prix de revient du produit est rafraîchi si nécessaire.

Pour les commandes formelles avec négociation et suivi de paiement, on passe en revanche par le module **Purchasing** (et la réception PO alimente automatiquement le même ledger).

---

## 5. Objectif Internal Transfers (transferts inter-sections)

Tracer les **déplacements physiques de stock entre les sections** de The Breakery :

- Entrepôt principal → cuisine (sortie de matière pour la prod du jour).
- Cuisine → vitrine sales (sortie de produits finis pour la vente).
- Vitrine → cuisine (rappel d'un produit non vendu).
- Section A → section B (réorganisation).

Le transfert a son propre cycle de vie :

1. **Draft** — le bon est en préparation.
2. **Pending / In transit** — la marchandise circule.
3. **Received** — la section destinataire confirme la réception (avec validation possible des quantités, comme une réception PO).
4. **Cancelled** — annulation si le transfert ne se fait pas.

Bénéfice métier : **savoir où est physiquement chaque produit** dans la boutique. Une farine "en stock" mais coincée au sous-sol n'est pas la même qu'une farine "en stock" déjà en cuisine, prête à pétrir.

---

## 6. Objectif Wastage (gestion des pertes)

Permettre de **déclarer une perte** sans tricher avec le stock :

- Casse accidentelle d'un produit (tasse, bocal).
- Péremption (yaourt, lait).
- Brûlé / raté de production.
- Vol ou disparition.
- Test produit, dégustation, geste commercial offert.

Saisie typique :

- Produit, quantité perdue, unité.
- **Raison** (catégorisée pour les rapports).
- Note libre pour le détail.
- Date.

Le stock est diminué, un mouvement `waste` est inscrit au ledger, et la perte alimente des indicateurs de pilotage (taux de gâche, coût des pertes, fournisseurs problématiques).

Bénéfice métier : **chiffrer le coût réel** de la casse / péremption — souvent invisible pour le gérant — et **identifier les causes récurrentes** (ce produit périme toujours, ce fournisseur livre trop de marchandise abîmée…).

---

## 7. Objectif Production (fabrication interne)

C'est le **cœur métier d'une boulangerie** : la transformation d'ingrédients en produits finis.

Le module doit permettre au boulanger ou au chef de :

- Déclarer un **lot de production** : "j'ai produit 50 baguettes le 12 mai".
- Numéro de batch optionnel, notes, personnel qui a produit, date.
- **Déduction automatique des ingrédients** : si la recette de la baguette dit "1 baguette = 250 g de farine + 5 g de sel + 5 g de levure + 150 g d'eau", produire 50 baguettes décrémente automatiquement 12,5 kg de farine, 250 g de sel, etc., dans le stock des matières premières.
- **Incrémentation du stock produit fini** : les 50 baguettes apparaissent en stock prêtes à vendre.
- **Gestion de la casse de production** : `quantity_waste` (les 2 baguettes ratées du fournée) sont décomptées sans aller en stock vendable.
- Écriture comptable automatique transférant le coût des matières premières consommées vers le stock de produits finis (mécanique COGS de production).

Bénéfice métier : **traçabilité complète** de chaque fournée + **alerte automatique sur les recettes infaisables** (si on n'a pas assez d'œufs en stock pour faire 100 brioches, le système le dit).

Une vue de **suggestions de production** est également disponible : à partir de la vitesse de vente des produits finis et du stock courant, le module propose "tu devrais relancer une fournée de croissants demain matin".

---

## 8. Objectif Opname (inventaire physique)

L'opname est l'opération de **vérité comptable** : on compte physiquement, on compare avec le système, on corrige les écarts.

Le module permet de :

1. **Créer une session d'opname** sur une section précise (entrepôt, cuisine, vitrine) ou un emplacement précis.
2. **Lister les produits à compter** dans cette section.
3. **Saisir les quantités physiques** réellement présentes (souvent à plusieurs sur un même opname).
4. **Visualiser les écarts** par rapport au stock système (en plus = surplus inexpliqué ; en moins = perte / vol / oubli de saisie).
5. **Valider et finaliser** l'opname : les écarts sont automatiquement convertis en mouvements `adjustment_in` / `adjustment_out` qui alignent le stock système sur la réalité physique.
6. Statuts du cycle : `draft` → `in_progress` → `finalized` → `validated`.

Bénéfice métier : **garder un système fiable** dans la durée. Une boulangerie qui ne fait pas d'opname régulier finit toujours par avoir un stock système complètement déconnecté du réel — et donc des alertes faussées, des ruptures imprévues, des marges fausses.

---

## 9. Objectif Movements (ledger immutable)

Toute action ayant impacté le stock laisse une trace dans le **journal des mouvements** :

| Type de mouvement | Source |
|---|---|
| `purchase` / `stock_in` | Réception PO ou incoming stock |
| `sale_pos` | Vente caisse |
| `sale_b2b` | Vente B2B / wholesale |
| `waste` | Saisie wastage |
| `ingredient` | Consommation via recette de production |
| `production_in` | Sortie usine (produit fini créé) |
| `production_out` | Entrée matière première dans la prod |
| `transfer` | Transfert inter-sections |
| `adjustment_in` / `adjustment_out` | Ajustement manuel ou écart d'opname |

Le module offre :

- **Liste filtrable** des mouvements (par produit, par type, par section, par période, par utilisateur).
- **Stats agrégées** sur la période (volume in, volume out, types les plus fréquents).
- **Drill-down** vers la référence d'origine (le PO, l'opname, la production, la vente).

Le ledger est **immutable** : on ne supprime jamais un mouvement, on en crée un nouveau pour corriger. Cette discipline garantit la traçabilité et permet un audit complet.

Bénéfice métier : pouvoir **reconstituer à tout moment** comment on est arrivé au stock courant. Si la farine est en rupture alors qu'on a reçu un sac la veille, on lit le ledger et on retrouve : 50 kg reçus, 30 kg consommés en prod, 5 kg cassés, 5 kg transférés → reste 10 kg, cohérent.

---

## 10. Objectif Dashboard produit (vue analytique par produit)

Pour chaque produit, le module propose un **tableau de bord détaillé** consultable depuis sa fiche :

- **Stock overview KPIs** : niveau courant, valeur, vitesse de rotation.
- **Stock timeline chart** : évolution graphique du stock dans le temps.
- **Movement breakdown** : répartition par type de mouvement.
- **Recent movements** : derniers événements impactant ce produit.
- **Purchase pattern** : à quelle fréquence on l'achète, quel volume moyen.
- **Purchase price trend** : évolution du prix d'achat dans le temps (utile pour détecter les hausses fournisseur).
- **Weekly consumption** : combien on en consomme par semaine.
- **Recipe usage** : si c'est une matière première, quelles recettes l'utilisent.
- **Incoming / Production / Transfers / Wastage / Opname sections** : agrégats sur ce produit spécifique.

Bénéfice métier : **piloter chaque produit individuellement** — décider d'arrêter ceux qui se gâchent trop, négocier avec le fournisseur d'un produit dont le prix monte, ajuster une recette dont l'ingrédient principal flambe.

---

## 11. Objectif Alertes (panneau dédié)

Un panneau d'alertes synthétique remonte trois familles de signaux :

- **Low Stock** : produits sous le seuil critique, à recommander d'urgence.
- **Reorder Suggestions** : produits où la vitesse de vente vs le stock courant suggère qu'il faut passer commande (avec proposition de quantité et de fournisseur historique). Action directe : créer un PO pré-rempli depuis l'alerte.
- **Production Suggestions** : produits finis qu'il faut relancer en production (basé sur vitesse de vente vs stock).

Bénéfice métier : **passer en mode pull plutôt que push** — le module pousse les actions à faire au lieu d'attendre que le gérant s'en rende compte trop tard.

---

## 12. Objectif comptable (couplage avec Accounting)

Le module Inventory **génère automatiquement des écritures comptables** pour les opérations qui affectent la valeur du stock :

| Événement | Écriture comptable (logique) |
|---|---|
| Production (sortie matière + entrée produit fini) | Sortir le coût des matières premières du stock, le transférer vers le stock produits finis. |
| Wastage | Sortir la marchandise du stock, passer la perte en charge. |
| Ajustement d'opname (écart) | Sortir ou entrer la valeur de l'écart en charge / produit exceptionnel. |
| Transfert inter-sections | Pas d'écriture comptable (le bien reste dans le périmètre de l'entreprise). |

Comme pour Purchasing, ces écritures sont **invisibles pour l'utilisateur** mais **auditables**, et respectent la norme indonésienne SAK EMKM.

---

## 13. Modèle physique : sections et locations

Pour refléter la **réalité physique** de la boulangerie, le module introduit deux notions :

- **Sections** : grandes zones fonctionnelles (warehouse / production / sales). Permet de répondre à "où est mon stock fonctionnellement ?"
- **Stock locations** : emplacements précis hiérarchiques (main_warehouse > rayon A > étagère 3). Permet de répondre à "où est physiquement ce sac de farine ?"

Chaque mouvement de stock peut référencer une section source et/ou destination. L'opname peut être ciblé sur une section précise pour ne pas avoir à tout compter d'un coup.

Bénéfice métier : adapter le système à la **vraie organisation spatiale** de The Breakery au lieu de tout mettre dans un grand sac "stock".

---

## 14. Objectifs transverses (non-fonctionnels)

| Objectif | Pourquoi |
|---|---|
| **Ledger immutable** | Aucun mouvement de stock ne disparaît ; toute correction passe par un mouvement compensatoire. Garantit l'auditabilité. |
| **Cohérence stock ↔ ventes** | Toute vente caisse (POS) ou B2B décrémente automatiquement le stock concerné, sans saisie manuelle. |
| **Cohérence stock ↔ production** | Toute production déclenche la déduction recette automatiquement, sans risque d'oubli. |
| **Conversion d'unités** | Le système gère les conversions kg ↔ g, L ↔ mL, etc. Une réception en kg met à jour un stock en g correctement. |
| **Mise à jour temps réel** | Le stock se rafraîchit immédiatement sur toutes les interfaces (caisse, KDS, backoffice) via Supabase Realtime. |
| **Multi-utilisateur** | Plusieurs personnes peuvent saisir simultanément (opname à plusieurs, production en parallèle), sans collision. |
| **Traçabilité utilisateur** | Chaque mouvement enregistre qui l'a effectué (`staff_id`) et quand. |
| **Permissions** | Les profils `inventory.view / .create / .update / .delete / .adjust` contrôlent qui peut faire quoi (un caissier voit le stock, un chef l'ajuste, seul un manager valide un opname). |

---

## 15. Ce que le module **ne fait pas** (limites assumées V2)

- **Pas de FEFO / FIFO strict par batch** — le stock est suivi en quantité agrégée par produit, pas par lot avec date de péremption individuelle. La péremption se gère manuellement (wastage déclaré).
- **Pas de prévision de demande** statistique avancée — les suggestions de réapprovisionnement et de production sont basées sur des règles simples (vitesse récente vs stock courant), pas du machine learning.
- **Pas de réservation de stock multi-canal** sophistiquée — un produit en cours de préparation d'une commande B2B reste "disponible" tant qu'il n'est pas effectivement sorti.
- **Pas de gestion native multi-site** — un seul établissement (1 site Lombok). Les sections suffisent.
- **Pas d'import en masse** des stocks historiques (à faire via SQL si reprise de données).
- **Pas de scanner code-barres natif** sur web — la saisie est au clavier (l'app Android peut compléter ce manque côté terrain).

---

## 16. Utilisateurs cibles

| Rôle | Ce qu'il fait dans le module |
|---|---|
| **Gérant** | Consulte les alertes, valide les opnames, surveille les pertes globales, pilote par les dashboards produits. |
| **Chef de production / boulanger** | Déclare les productions, reçoit les transferts en cuisine, signale les ratés. |
| **Responsable achats** | Consulte les niveaux de stock pour ses commandes (via le module Purchasing, qui s'appuie sur Inventory). |
| **Personnel de vente / caisse** | Consulte le stock en temps réel ("est-ce qu'on a encore des croissants ?"), saisit les casses simples. |
| **Inventoriste** | Lance et complète les opnames, recompte les sections. |
| **Comptable** | Audite les mouvements `adjustment`, vérifie la cohérence des écarts d'opname et leur impact sur la valeur stock. |

---

## 17. Résumé en une phrase

> **Le module Inventory est le système nerveux du stock de The Breakery : il sait à chaque instant combien il y a de quoi, où c'est physiquement, comment ça a évolué et pourquoi — pour qu'on ne tombe jamais en rupture devant un client, qu'on ne jette plus de marchandise oubliée, et que la cuisine, le bureau et le grand livre comptable racontent tous la même histoire.**
