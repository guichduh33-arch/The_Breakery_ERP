# Module Purchasing & Suppliers — Objectif métier

> 🗄️ **ARCHIVED / SUPERSEDED (2026-06-04).** This legacy V2 "Objectif métier" brief was folded verbatim into **Partie I — Vue fonctionnelle** of the canonical reference module [`reference/04-modules/07-purchasing-suppliers.md`](../../reference/04-modules/07-purchasing-suppliers.md) (2026-05-13). The reference is the source of truth; this file is kept for history only.


> **Statut V2/V3** : décrit la vision business cible. **V2 jamais déployée**. Implémentation V3 = DONE + amélioré (RPCs `create_po`, `receive_po`, `cancel_po` + landed cost shipping pro-rata S23 + WAC `update_cost_price_v1` avec replay envelope S26). Voir [`../V2_V3_GLOSSARY.md`](../../V2_V3_GLOSSARY.md).
>
> **Périmètre fonctionnel** : ce document décrit **ce que le module sert à faire au quotidien** pour The Breakery,

---

## 1. Raison d'être

Le module Purchasing & Suppliers existe pour piloter **toute la chaîne d'approvisionnement** de la boulangerie : depuis le moment où l'on identifie un besoin (farine à recommander, nouveau fournisseur de packaging) jusqu'au paiement de la facture et à l'impact sur les comptes.

En un mot : **transformer un besoin matière en stock disponible en cuisine, avec une trace comptable propre.**

---

## 2. Objectif côté Suppliers (fournisseurs)

Tenir le **carnet d'adresses opérationnel** des partenaires d'approvisionnement de The Breakery.

Le module doit permettre à un responsable achat (ou au gérant) de :

- **Référencer** chaque fournisseur avec ses informations utiles : contact, adresse, NPWP (identifiant fiscal indonésien), coordonnées bancaires, conditions de paiement (cash on delivery, net 7/14/30/60 jours), catégorie (farine, boissons, packaging, services…).
- **Retrouver rapidement** un fournisseur (recherche par nom, par catégorie).
- **Désactiver** un fournisseur qui n'est plus sollicité, sans casser l'historique des commandes passées avec lui.
- **Visualiser la relation commerciale** sur la durée : combien on a dépensé chez lui, combien de commandes passées, combien reste impayé, quel est son délai moyen de livraison, comment ses prix évoluent sur les produits clés.
- **Importer en masse** un fichier de fournisseurs existant (Excel/CSV) pour démarrer rapidement ou intégrer une reprise de données.

Bénéfice métier : **objectiver les décisions d'achat** (qui est fiable, qui est cher, qui paie en retard) au lieu de naviguer à l'intuition.

---

## 3. Objectif côté Purchase Orders (bons de commande)

Donner à The Breakery un **vrai cycle de commande structuré**, à la place de WhatsApp + post-its.

Concrètement, le module doit permettre de :

### 3.1 Préparer une commande

- Créer un bon de commande adressé à un fournisseur précis.
- Lister les produits commandés avec quantité, unité (kg, L, pcs…), prix unitaire négocié et TVA applicable.
- Appliquer un escompte global (montant ou pourcentage) ou par ligne.
- Ajouter des frais de livraison (`shipping_cost`).
- Sauvegarder en brouillon (`draft`) pour finaliser plus tard.

### 3.2 Envoyer et faire confirmer

- Marquer la commande comme envoyée au fournisseur (`sent`).
- La passer en confirmée (`confirmed`) une fois que le fournisseur a accusé réception.
- Pouvoir annuler tant que la marchandise n'est pas arrivée.

### 3.3 Réceptionner la marchandise

C'est l'étape la plus sensible. Le module doit gérer :

- **Réception partielle** : si le fournisseur ne livre que 8 sacs sur 10 commandés, on saisit 8 et le bon passe en `partially_received`. Le solde reste ouvert pour la prochaine livraison.
- **Contrôle qualité (QC)** par ligne : chaque article peut être marqué accepté ou rejeté. Un article rejeté déclenche un retour fournisseur.
- **Mise à jour automatique du stock** : la quantité reçue alimente immédiatement le stock du produit en cuisine, avec gestion des conversions d'unité (commandé en kg, stocké en g, par exemple).
- **Recalcul automatique du prix de revient** du produit à partir du dernier prix d'achat — essentiel pour que les marges affichées restent justes.
- **Date de réception** modifiable (utile si on enregistre la livraison le lendemain).

### 3.4 Tracer chaque action

Tout événement sur le bon de commande (création, envoi, confirmation, réception, retour, paiement, annulation, modification) est consigné dans une **timeline horodatée** avec l'utilisateur qui l'a fait. Aucune action n'est silencieuse.

### 3.5 Gérer les retours fournisseur

- Sélectionner les articles à renvoyer (qty ≤ qty reçue).
- Indiquer la raison (défaut, mauvais produit, périmé, surstock, autre).
- Saisir le montant remboursé attendu.
- L'opération réduit le stock et déclenche l'écriture comptable correspondante.

### 3.6 Payer et clôturer

- Marquer un bon comme payé partiellement ou totalement.
- Renseigner la méthode (cash, virement bancaire, carte).
- Conserver la date de paiement pour le suivi cash-flow.

### 3.7 Joindre des documents

Attacher au bon de commande la facture du fournisseur, le bon de livraison, une photo des marchandises endommagées… stockés dans Supabase Storage et accessibles depuis la fiche du PO.

### 3.8 Importer / exporter

- Exporter en XLSX la liste des PO (pour reporting externe, comptable).
- Importer un fichier de PO historiques (reprise de données).

---

## 4. Objectif comptable (couplage avec Accounting)

Le module a pour mission de **produire automatiquement les écritures comptables** correspondant aux flux d'achat, pour respecter les standards SAK EMKM / SAK ETAP indonésiens — sans ressaisie manuelle dans le grand livre.

Trois moments génèrent une écriture :

| Moment | Écriture comptable (logique) |
|---|---|
| **Réception** des marchandises | Augmenter le stock + la TVA récupérable, créer une dette envers le fournisseur. |
| **Paiement** du fournisseur | Solder la dette, sortir l'argent de la caisse ou de la banque. |
| **Retour** au fournisseur | Réduire la dette, sortir la marchandise du stock. |

Le responsable des achats ne pense pas à ces écritures — elles sont créées automatiquement, mais auditables. La période fiscale doit rester ouverte au moment où l'opération est saisie (sinon le système refuse la réception, pour préserver l'intégrité des comptes déjà clôturés).

---

## 5. Objectif côté reporting et pilotage

À partir des données alimentées par ce module, The Breakery doit pouvoir répondre à :

- Quel est mon **top fournisseur** en montant dépensé sur les 90 derniers jours ?
- Quelles **factures impayées** s'accumulent (PO Aging) ?
- Comment se répartit ma **dépense par catégorie** (matières premières vs packaging vs services) ?
- Quel est le **taux de livraison à temps** de chaque fournisseur ?
- Comment **évolue le prix d'achat** de mes produits-clés (farine, beurre, café) dans le temps ?

Ces questions sont adressées par les rapports dédiés du module Reports, alimentés par les données saisies ici.

---

## 6. Objectifs transverses (non-fonctionnels)

| Objectif | Pourquoi |
|---|---|
| **Aucune saisie en double** | Le stock et la compta se mettent à jour automatiquement à partir des actions purchasing. Le responsable achat n'a pas à ressaisir ailleurs. |
| **Traçabilité totale** | Chaque action sur un PO est horodatée et attribuée à un utilisateur. L'historique est immutable (append-only) — on ne peut pas réécrire le passé. |
| **Contrôle d'accès** | Seuls les profils habilités (`inventory.create`, `inventory.update`, etc.) peuvent créer/modifier/recevoir. La lecture est autorisée à tout utilisateur authentifié pour la transparence. |
| **Résilience aux erreurs** | Un PO en brouillon peut être supprimé sans conséquence. Une fois envoyé, on doit l'annuler explicitement (avec raison loggée). Un PO reçu est figé — la correction passe par un retour fournisseur. |
| **Numérotation fiable** | Chaque PO a un numéro unique `PO-YYYYMM-XXXX` généré côté serveur, anti-collision si deux utilisateurs créent en même temps. |

---

## 7. Ce que le module **ne fait pas** (limites assumées V2)

- **Pas d'envoi d'email automatique** au fournisseur — le bouton "Send" change juste le statut. L'envoi réel se fait hors-outil (WhatsApp, email manuel).
- **Pas de génération PDF** du PO côté V2 (envisagé V3).
- **Pas de multi-devise** — tout est en IDR. Pour un fournisseur étranger, conversion manuelle à saisir dans les notes.
- **Pas de gestion automatique du landed cost** — les frais de port gonflent le total payé au fournisseur mais ne sont pas répartis pro-rata sur le coût de revient produit. Ajustement manuel si on veut intégrer.
- **Pas d'avoir comptable automatique** sur retour après paiement intégral — géré manuellement à la prochaine facture.
- **Pas de workflow d'approbation** multi-niveaux (un seul utilisateur crée et envoie). Suffisant pour ~20 utilisateurs / 1 site.

---

## 8. Utilisateurs cibles

| Rôle | Ce qu'il fait dans le module |
|---|---|
| **Gérant** | Référence un nouveau fournisseur, valide les conditions de paiement, consulte les KPIs (dépense, impayés). |
| **Responsable achats** | Crée et envoie les bons de commande, suit les confirmations, déclenche les paiements. |
| **Chef de production / cuisine** | Réceptionne la marchandise, fait le QC, signale les retours. |
| **Comptable** | Consulte les écritures générées, contrôle la cohérence des montants, paie les factures. |

---

## 9. Résumé en une phrase

> **Le module Purchasing & Suppliers est l'outil unique où The Breakery centralise tous ses fournisseurs et toutes ses commandes d'approvisionnement, de la rédaction du bon jusqu'au paiement, en alimentant automatiquement le stock et la comptabilité — pour que rien ne se perde entre la cuisine, le bureau et le grand livre.**
