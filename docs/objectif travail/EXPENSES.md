# Module Expenses — Objectif métier

> **Périmètre fonctionnel** : ce document décrit **ce que le module Expenses (`/expenses`) sert à faire au quotidien** pour The Breakery, 

---

## 1. Raison d'être

Le module Expenses est **le gardien des dépenses opérationnelles** de The Breakery. Il répond à une question simple mais omniprésente dans toute boulangerie qui paie chaque jour de l'électricité, des emballages, de l'essence, des réparations et des salaires :

> *"Combien je dépense vraiment ce mois, pour quoi, qui l'a engagé, qui l'a validé, est-ce que c'est passé en compta, et est-ce que je peux justifier chaque sortie d'argent face à un contrôleur ?"*

C'est le module qui transforme **les factures, tickets de caisse et notes de frais** en **données comptables structurées** : catégorisées, datées, validées, rattachées à un fournisseur, comptabilisées en charges et payées par méthode tracée.

Le module est **complémentaire de Purchasing** : Purchasing gère les **achats de marchandises** (matières premières, produits revendus — actif circulant) ; Expenses gère les **charges opérationnelles** (loyer, électricité, services, petits matériels — passées directement en résultat).

Sans lui, les dépenses se règlent à la main, le comptable les ressaisit à la fin du mois, et la trésorerie du gérant est aveuglée jusqu'à l'arrêté comptable.

---

## 2. Les 4 pages du module

Le module est structuré en **4 pages** correspondant à 4 jobs distincts :

| Page | Job-to-be-done | Permission |
|---|---|---|
| **Expenses List** | Voir toutes les dépenses filtrables, leur statut, leur total | `expenses.view` |
| **Expense Form** | Créer ou modifier une dépense | `expenses.create` / `expenses.update` |
| **Expense Detail** | Consulter une dépense + agir (approuver, payer, dupliquer) | `expenses.view` |
| **Expense Categories** | Gérer la nomenclature des catégories de charges | `settings.update` |

---

## 3. Les 5 invariants du module

Quel que soit le contexte d'utilisation, le module garantit :

1. **Catégorie obligatoire**. Aucune dépense ne se valide sans catégorie — c'est elle qui pilote le compte comptable destinataire.
2. **Workflow Draft → Approved → Paid**. Trois statuts. Une dépense passe par un cycle de validation explicite avant de toucher la compta.
3. **Écriture comptable automatique à l'approbation**. La RPC `approve_expense_with_journal` génère l'écriture journal en même temps que la validation — pas de saisie compta double.
4. **Traçabilité auteur**. `created_by` (qui a saisi) et `approved_by` (qui a validé) sont obligatoires et différents pour les montants élevés (séparation des tâches).
5. **Justificatif rattachable**. Chaque dépense peut porter une pièce jointe (photo de facture, scan de ticket) — preuve archivable.

---

## 4. La liste des dépenses — La vue centrale

Page `ExpensesListPage` : la **liste consolidée** de toutes les dépenses :

### 4.1 Affichage

Chaque ligne : numéro de dépense, date, catégorie, description, fournisseur, méthode de paiement, montant, statut, créateur.

### 4.2 Filtres

- **Status** : Draft / Approved / Paid / Cancelled / Rejected.
- **Catégorie** : Loyer, Électricité, Eau, Internet, Emballages, Maintenance, Marketing, Salaires, Transport, Petites fournitures, etc.
- **Méthode de paiement** : Cash, Bank Transfer, Card, Compte fournisseur.
- **Fourchette de dates** : `from` / `to`.
- **Recherche** texte libre sur la description.
- Limite serveur : **200 dépenses** par requête (pagination cliente au-delà).

### 4.3 Stats agrégées

En haut de page, un résumé (`useExpenseSummary`) :

- **Total dépenses** sur la période filtrée.
- **Par statut** : combien en attente d'approbation, combien approuvées non payées, combien payées.
- **Par catégorie** : top 5 des catégories en montant.
- **Comparaison période précédente** (delta %).

Bénéfice métier : **savoir où passe l'argent** en 10 secondes. Le gérant ouvre la page chaque lundi matin, voit que les expenses Maintenance ont doublé vs le mois précédent → enquête.

---

## 5. La création d'une dépense

`ExpenseFormPage` (`/expenses/new`) : le formulaire de saisie d'une dépense.

### 5.1 Champs collectés

- **Date** de la dépense (peut être antérieure à la saisie — saisie tardive autorisée).
- **Catégorie** (obligatoire — `ExpenseCategoryPicker`).
- **Description** courte ("Facture PLN avril", "Carburant scooter livraison").
- **Montant** en IDR.
- **Fournisseur** optionnel (rattachement à un `supplier` du module Purchasing si récurrent).
- **Méthode de paiement** : Cash / Bank Transfer / Card / À régler (compte fournisseur).
- **Date de paiement** : si déjà payé, date effective ; sinon vide pour règlement futur.
- **Numéro de référence** : N° facture fournisseur, N° ticket caisse.
- **Justificatif** : upload PDF / JPG / PNG dans Supabase Storage.
- **Notes** libres.

### 5.2 Cas d'usage typiques

- Saisie d'une **facture mensuelle** (loyer, internet, électricité) à payer en fin de mois.
- Saisie d'une **dépense cash** déjà engagée (carburant, petites fournitures) — date = aujourd'hui, méthode = cash, payé immédiatement.
- Saisie d'une **note de frais** d'un employé qui a avancé personnellement (remboursement à programmer).

Bénéfice métier : **chaque sortie d'argent a sa fiche**, créée en moins de 60 secondes, avec photo de justificatif si nécessaire.

---

## 6. La détail d'une dépense

Page `ExpenseDetailPage` : la **fiche complète** d'une dépense avec ses actions.

### 6.1 Bloc identité

- Numéro, date, statut.
- Catégorie + compte comptable cible (visible).
- Description, fournisseur, référence.

### 6.2 Bloc financier

- Montant, méthode de paiement, date de paiement.
- Si payable à terme : date d'échéance.

### 6.3 Bloc traçabilité

- Créé par (qui + quand).
- Approuvé par (qui + quand) — vide si pas encore approuvé.
- Payé par (qui + quand) — vide si pas encore payé.
- Justificatif attaché (preview + download).

### 6.4 Bloc actions (`ExpenseApprovalActions`)

Selon le statut et les permissions :

- **Draft** : Modifier, Soumettre pour approbation, Supprimer.
- **Approved** : Marquer payée, Imprimer, Cloner.
- **Paid** : Imprimer, Cloner, Consulter écriture compta.
- **Toutes** : Voir l'audit log (qui a fait quoi quand).

Bénéfice métier : **tout est centralisé sur une page** — pas de bascule entre 3 écrans pour traiter une dépense.

---

## 7. Le workflow d'approbation

C'est **le cœur du contrôle interne** sur les dépenses. Cycle standard :

```
Draft → (review) → Approved → (payment) → Paid
                       ↓
                   Rejected (avec raison)
```

### 7.1 Approbation

- Le créateur soumet la dépense → statut `pending_approval` (ou directement `approved` si l'auteur a la permission `expenses.approve`).
- Un manager / owner consulte, peut **approuver** ou **rejeter avec raison**.
- À l'approbation, la RPC `approve_expense_with_journal` :
  - Bascule le statut en `approved`.
  - Enregistre `approved_by = user_id` et `approved_at = now()`.
  - **Génère automatiquement l'écriture comptable** : DR Compte de charge (selon catégorie) / CR Cash ou Bank ou AP selon la méthode de paiement.
- En cas de rejet : statut `rejected` + raison obligatoire + notification au créateur.

### 7.2 Seuils configurables

Selon Settings → Financial :

- Dépenses < seuil 1 : auto-approuvées si créées par un manager.
- Dépenses < seuil 2 : approbation manager simple.
- Dépenses > seuil 2 : approbation owner + manager (séparation des tâches).

### 7.3 Marquage paiement

Une dépense `approved` mais non payée reste **un AP** (Accounts Payable). Une fois payée :

- Bouton "Marquer payée" → date de paiement, méthode confirmée.
- Génération de l'écriture de règlement : DR AP / CR Cash ou Bank.
- Bascule en statut `paid`.

Bénéfice métier : **séparer l'engagement de la dépense (approbation) du décaissement (paiement)**. Permet de provisionner une charge sans avoir encore décaissé — comportement comptable correct.

---

## 8. La gestion des catégories

Page `ExpenseCategoriesPage` : la **nomenclature** des catégories de charges.

### 8.1 Structure

Chaque catégorie a :

- **Code** unique (court, ex: `LOYER`, `ELEC`, `PACK`).
- **Libellé**.
- **Compte comptable cible** (référencé dans le plan comptable du module Accounting).
- **Statut actif / inactif**.
- **Description / notes**.

### 8.2 Catégories standards livrées

| Catégorie | Compte cible typique |
|---|---|
| **Loyer** | 6130 Locations |
| **Électricité / Eau / Gaz** | 6140 Services et fluides |
| **Internet / Téléphone** | 6150 Télécommunications |
| **Emballages** | 6210 Emballages consommables |
| **Maintenance / Réparation** | 6300 Entretien et réparations |
| **Marketing / Publicité** | 6400 Marketing |
| **Salaires** | 6500 Salaires et charges |
| **Transport** | 6610 Transport et déplacements |
| **Petites fournitures** | 6620 Fournitures de bureau |
| **Honoraires** | 6700 Honoraires comptable / juriste |
| **Banque** | 6800 Frais bancaires |
| **Divers** | 6900 Autres charges externes |

### 8.3 Bénéfice métier

**Standardiser le langage des charges** : chaque dépense, peu importe l'opérateur, atterrit dans la bonne catégorie, qui pilote le bon compte comptable, sans qu'il faille connaître le plan comptable par cœur. Un cashier saisit "Électricité" → l'app sait que c'est le 6140.

---

## 9. Le couplage Accounting

Le module Expenses est **fortement intégré** au module Accounting :

- Chaque approbation déclenche `approve_expense_with_journal` qui écrit dans `journal_entries`.
- L'écriture est immédiatement visible dans le grand livre (`GeneralLedgerPage`).
- Le report **Expenses by Category** (module Reports) lit `expenses` directement.
- Le **P&L Monthly Trend** consolide les expenses dans la section "Charges d'exploitation".
- Les expenses approuvées non payées apparaissent en **AP** dans le bilan.

Bénéfice métier : **la comptabilité reste à jour à la seconde**. Le gérant valide une dépense de 5M IDR à 14h ; à 14h01, son P&L mensuel s'est ajusté.

---

## 10. Les expenses récurrentes — Le cas mensuel

Le cas typique : **loyer, électricité, internet** se paient tous les mois pour des montants relativement stables.

### 10.1 Approche actuelle

Le module supporte la **duplication** ("Clone") d'une dépense :

- Bouton sur la fiche détail → recrée une nouvelle dépense pré-remplie avec mêmes catégorie, fournisseur, méthode, montant.
- Modification du montant et date avant validation.
- Validation rapide.

### 10.2 Workflow type "fin de mois"

1. Le gérant ouvre le dernier loyer payé.
2. Clic "Clone".
3. Ajustement de la date à ce mois.
4. Si le montant a changé : modification.
5. Soumission → Approbation → Paiement quand fait.

### 10.3 Évolution prévue

Un système de **dépenses récurrentes programmées** est dans le backlog (voir §14).

Bénéfice métier : **traitement des fixes mensuelles en 30 secondes par dépense** au lieu de tout ressaisir.

---

## 11. La gestion documentaire

Chaque dépense peut porter une **pièce jointe** :

- Format accepté : PDF, JPG, PNG.
- Stockage : Supabase Storage (bucket `expense-receipts`).
- Taille max : 5 MB par fichier (configurable).
- Preview directement dans la fiche détail.
- Téléchargement.

Cas d'usage : prise de photo du ticket caisse par le manager directement avec son téléphone, upload immédiat → la dépense est saisie + justifiée + validée en 90 secondes au comptoir.

Bénéfice métier : **archive numérique des justificatifs** sans classeur physique. Quand le comptable ou un contrôleur demande "tu peux me montrer la facture du loyer de mars ?", la réponse est dans la fiche dépense.

---

## 12. Permissions et contrôle d'accès

| Permission | Action |
|---|---|
| `expenses.view` | Lire la liste, voir le détail |
| `expenses.create` | Créer une dépense en draft |
| `expenses.update` | Modifier une dépense draft |
| `expenses.approve` | Approuver une dépense |
| `expenses.pay` | Marquer payée |
| `expenses.delete` | Supprimer une dépense draft (soft delete) |
| `expenses.categories.manage` | Gérer la nomenclature des catégories |

Bénéfice métier : **cloisonner les responsabilités**. Un cashier peut saisir des dépenses cash mais pas les approuver ; un manager approuve mais le owner valide les seuils élevés.

---

## 13. Mécaniques transverses — Comment le module dialogue avec le reste

| Module | Relation |
|---|---|
| **Accounting** | Écriture journal automatique à l'approbation via `approve_expense_with_journal`. |
| **Reports** | `expenses` (par date), `expense_by_category` (backlog), `pl_monthly_trend` consomment les données. |
| **Settings** | Catégories par défaut, seuils d'approbation, compte comptable par catégorie. |
| **Users & Permissions** | Permissions `expenses.*` cloisonnent les droits. |
| **Purchasing** | Suppliers partagés. Une réception PO génère un AP côté Purchasing ; une dépense de service génère un AP côté Expenses — deux flux séparés mais convergents en compta. |
| **Cash Register** | Une dépense payée cash sort de la caisse — impact sur la réconciliation de session. |

---

## 14. Ce que le module ne fait **pas** (par design)

- Le module **ne fait pas la paie**. Les salaires apparaissent en bloc mensuel comme une expense agrégée, mais le détail individuel (fiches de paie, BPJS, PPh21) est externe.
- Le module **ne supporte pas les dépenses récurrentes programmées** (auto-créer une dépense le 1ᵉʳ de chaque mois). Cf. backlog.
- Le module **ne gère pas l'OCR de factures**. Pas d'extraction automatique des champs depuis la photo de la facture.
- Le module **ne supporte pas les remboursements de notes de frais** comme un workflow dédié. Une note de frais est une dépense ordinaire avec `payment_method = cash` ou `supplier = nom_employé`.
- Le module **ne gère pas le budget prévisionnel** (budget vs réel). Pas de comparaison "vous avez consommé 80 % du budget marketing". Cf. backlog Accounting.
- Le module **ne traite pas les amortissements**. Achat d'une immobilisation = passer par un autre flux (saisie OD compta), pas par expenses.

---

## 15. Ce que le module doit (encore) faire — backlog métier

| Priorité | Évolution | Bénéfice attendu |
|---|---|---|
| 🔴 | **Dépenses récurrentes programmées** | "Crée automatiquement une dépense Loyer 15M le 1ᵉʳ de chaque mois en draft pour validation." |
| 🔴 | **Approval workflow visuel** | Définir graphiquement les seuils et rôles d'approbation au lieu de coder dans les permissions. |
| 🟠 | **OCR de factures** | Photographier la facture → extraction auto du montant, date, fournisseur. |
| 🟠 | **Budget par catégorie** | Saisir un budget mensuel par catégorie + alerte au dépassement. |
| 🟠 | **Remboursement note de frais structuré** | Workflow dédié employé : soumettre → manager approuve → payable au prochain salaire. |
| 🟡 | **Multi-devise** | Saisir une dépense en USD (équipement importé) avec conversion auto. |
| 🟡 | **Lien commande fournisseur ↔ dépense** | Quand un service est commandé via PO de service, sa réception alimente automatiquement une expense. |
| 🟢 | **Catégorisation auto par IA** | Suggestion automatique de catégorie basée sur la description ("Facture PLN" → Électricité). |
| 🟢 | **Export pour le comptable** | Format CSV / Excel formaté pour import direct dans Accurate ou MYOB. |

---

## 16. En une phrase

Le module Expenses est **le carnet de comptes des sorties d'argent** de The Breakery : il transforme chaque facture, ticket de caisse et note de frais en dépense catégorisée, validée par workflow Draft → Approved → Paid, photographiée et archivée, comptabilisée automatiquement à l'approbation via génération d'écriture journal, cloisonnée par permissions selon les seuils — pour que chaque IDR qui sort de la trésorerie soit justifié, validé, comptabilisé et explicable face à un contrôleur, sans que le gérant ait à tenir un Excel parallèle ni à attendre la fin de mois.
