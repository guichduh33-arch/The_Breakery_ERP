# Module Cash Register (Sessions de caisse) — Objectif métier

> 🗄️ **ARCHIVED / SUPERSEDED (2026-06-04).** This legacy V2 "Objectif métier" brief was folded verbatim into **Partie I — Vue fonctionnelle** of the canonical reference module [`reference/04-modules/12-cash-register-shift.md`](../../reference/04-modules/12-cash-register-shift.md) (2026-05-13). The reference is the source of truth; this file is kept for history only.


> **Statut V2/V3** : décrit la vision business cible. **V2 jamais déployée**. Implémentation V3 = DONE (RPCs `close_shift_rpc`, `record_cash_movement_rpc`, `apps/pos/src/features/shift`). Voir [`../V2_V3_GLOSSARY.md`](../../V2_V3_GLOSSARY.md).
>
> **Périmètre fonctionnel** : ce document décrit **ce que le module Cash Register sert à faire au quotidien** pour The Breakery, sans rentrer dans la mécanique technique 

---

## 1. Raison d'être

Le module Cash Register est le **gardien de la cohérence cash** de The Breakery. Il répond à une question simple mais structurante dans toute entreprise qui manipule du liquide :

> *"Au matin j'ai mis 500 000 IDR dans le tiroir. Au soir je compte 2 350 000 IDR. Est-ce que ça colle avec ce que la caisse a encaissé sur la journée ? Et si ça ne colle pas, qui peut me dire pourquoi ?"*

C'est le module qui transforme **un tiroir-caisse plein d'argent** en **objet auditable** : ouverture chiffrée, transactions cash tracées, comptage de fermeture, écart calculé automatiquement, validation manager, archivage permanent.

Sans lui, l'argent disparaît dans la masse — un cashier honnête ne sait pas se défendre face à un soupçon, un cashier malhonnête n'a aucun mur devant lui. Avec lui, chaque journée est un **cycle fermé** : on ouvre, on encaisse, on referme, on réconcilie, on signe.

C'est aussi le module qui **conditionne tout le reste du POS** : tant qu'aucune session n'est ouverte, la caisse refuse de prendre la moindre commande.

---

## 2. Les 5 modales du cycle de vie d'une session

Le module est piloté par **5 modales** correspondant aux 5 moments-clés d'une session :

| Modal | Quand | Job-to-be-done |
|---|---|---|
| **OpenShiftModal** | Début de service | Ouvrir une session avec comptage du fond de caisse |
| **CloseShiftModal** | Fin de service | Initier la clôture |
| **ShiftReconciliationModal** | Pendant la clôture | Compter le tiroir et constater l'écart |
| **ShiftStatsModal** | Pendant la clôture | Consulter les stats de session avant signature |
| **ShiftHistoryModal** | À tout moment | Revoir les sessions passées avec leurs écarts |

Le cycle est **strictement linéaire** : on ne peut pas re-compter une session fermée, on ne peut pas ouvrir si une autre est déjà ouverte sur le même terminal, on ne peut pas vendre sans session.

---

## 3. Les 5 invariants du module

Quelles que soient les circonstances, le module garantit :

1. **Une session par utilisateur par terminal**. Impossible d'avoir deux sessions ouvertes simultanément sur le même couple `(user, terminal)`. La RPC `open_shift` refuse.
2. **Pas de vente sans session ouverte**. Le POS refuse toute transaction tant qu'aucune session `status = 'open'` n'existe pour le cashier connecté.
3. **Comptage cash chiffré obligatoire**. Ouverture comme fermeture exigent une saisie numérique — on ne peut pas "estimer". Pas de session sans nombre.
4. **Écart calculé, jamais inventé**. À la clôture, `expected_cash = opening_cash + cash_sales − cash_refunds`. Le système calcule, le cashier ne triche pas en arrière.
5. **Session fermée = session figée**. Une fois `status = 'closed'`, aucune modification possible — même par admin. Pour corriger une erreur, il faut un ajustement comptable manuel tracé.

---

## 4. Ouvrir une session — Le rituel du matin

### 4.1 Le geste

Avant la première vente, le cashier qui prend son poste déclenche `OpenShiftModal` :

- **Sélection du terminal** : sur quel poste physique on ouvre (Terminal 1 caisse principale, Terminal 2 comptoir café…).
- **Comptage du fond de caisse** : saisie du montant total de l'`opening_cash`.
- **Détail facultatif par coupure** (`opening_cash_details` JSONB) : combien de 100k, combien de 50k, combien de 20k, etc. — pour audit fin.
- **Validation** → la RPC `open_shift` crée la session avec un numéro séquentiel `SHF-YYYYMMDD-NN`.

### 4.2 Les contrôles automatiques

- Vérifie qu'**aucune session ouverte** n'existe pour ce cashier — sinon refus.
- Génère le `session_number` (format daté pour traçabilité comptable).
- Marque l'horodatage `opened_at` au timestamp exact.
- Enregistre `opened_by = user_id` (qui a ouvert).

Bénéfice métier : **un point de départ chiffré et signé**. À 14h, si on suspecte un problème de caisse, on remonte au comptage d'ouverture du matin — il existe, il est signé, il est immuable.

---

## 5. Pendant la session — La caisse vit

Tant que la session est ouverte, le POS l'utilise comme contexte transparent :

- Chaque commande créée référence implicitement la session active.
- Chaque paiement cash alimente le **total cash attendu** de la session.
- Chaque refund cash alimente le **total cash sorti**.
- Les autres méthodes de paiement (carte, QRIS, e-wallet) sont également agrégées par session — pour la réconciliation par méthode.

Vue rapide pendant la session : `CashierAnalyticsModal` (accessible depuis le POS) affiche en direct :

- Nombre de commandes encaissées par ce cashier sur cette session.
- CA total, panier moyen.
- Répartition par méthode de paiement.
- Voids et refunds.

Bénéfice métier : **le cashier voit où il en est** pendant la journée, sans devoir attendre la clôture. Il peut anticiper son comptage de fin.

---

## 6. Fermer la session — Le rituel du soir

### 6.1 Initiation

`CloseShiftModal` est déclenché par le cashier ou le manager à la fin du service. La modale propose le parcours guidé :

1. Affichage rappel du fond d'ouverture.
2. Bouton "Compter le tiroir" → ouvre `ShiftReconciliationModal`.

### 6.2 La réconciliation — `ShiftReconciliationModal`

C'est **le cœur du module**. La modale demande au cashier :

- **Compter physiquement** le contenu du tiroir-caisse.
- **Saisir le `counted_cash`** (montant total compté).
- Optionnel : détail par coupure (`closing_cash_details`) pour audit fin.

Le système calcule **automatiquement** :

| Indicateur | Formule |
|---|---|
| `expected_cash` | `opening_cash + total cash sales − total cash refunds` |
| `cash_difference` | `counted_cash − expected_cash` |
| Sévérité de l'écart | OK (0), info (<5k), warning (5k−50k), critical (>50k) |

L'écart est affiché en grand, **avec sa couleur** : vert si zéro, orange si petit, rouge si critique.

Si écart > seuil configuré, le système **exige une raison écrite obligatoire** avant de pouvoir continuer.

Bénéfice métier : **la vérité chiffrée s'impose en 5 secondes**. Pas de bricolage Excel, pas de "à peu près" — le tiroir colle ou ne colle pas, et le système le dit.

### 6.3 Les stats — `ShiftStatsModal`

Avant signature finale, le cashier ou le manager consulte le récap complet :

- **CA total** sur la session.
- **Nombre de commandes** (et nombre de couverts si dine-in).
- **Panier moyen**.
- **Répartition par méthode** : combien en cash, combien en card, en QRIS, en e-wallet, en B2B credit.
- **Total des remises** appliquées sur la session.
- **Liste des voids** (annulations).
- **Liste des refunds** (remboursements).

Bénéfice : **dernière chance de détecter une anomalie** avant clôture (ex: "tiens, j'ai fait 5 refunds aujourd'hui — pourquoi tant ?").

### 6.4 Validation manager

Si la politique l'exige (configurable dans Settings), la clôture nécessite la **validation d'un manager** avec PIN :

- `manager_id` enregistré.
- `manager_validated = true`.
- Le manager couvre le cashier de sa signature.

### 6.5 Clôture finale

À la validation, la RPC `close_shift` :

- Marque `closed_at = now()`.
- Marque `closed_by = user_id`.
- Persiste `counted_cash`, `expected_cash`, `cash_difference`, `actual_cash`.
- Calcule et persiste les totaux par méthode de paiement.
- Calcule `total_sales` et `total_orders` agrégés.
- Bascule `status` en `closed`.
- Génère automatiquement une **écriture comptable** sur le compte cash (1110) qui reflète l'apport / la sortie nette de la journée.

Bénéfice métier : **la journée est fermée, signée et comptabilisée** en moins de 5 minutes. Le tiroir peut être vidé en sécurité, l'argent peut partir en banque.

---

## 7. Le `recounting` — La marche arrière contrôlée

Le système prévoit un **statut intermédiaire** `recounting` pour gérer le cas spécifique où le cashier vient de "fermer" mais réalise qu'il y a un problème :

- "Attends, j'ai oublié de compter les billets de 10k au fond du tiroir."
- Bascule en `recounting` → on peut re-saisir le `counted_cash`.
- Une fois corrigé, on confirme la clôture (`closed`).

Mais : **on ne peut pas re-ouvrir une session `closed`**. Le statut `recounting` est uniquement accessible **avant** la clôture finale signée.

Bénéfice métier : **tolérer l'erreur humaine** sans permettre la triche. Le cashier corrige son comptage, mais il ne peut pas revenir 3 jours plus tard pour modifier l'écart constaté.

---

## 8. Historique des sessions — `ShiftHistoryModal`

Une vue accessible à tout moment qui liste :

- Les **N dernières sessions** du cashier connecté (ou de tous les cashiers, selon permissions).
- Pour chaque session : numéro, date, opening, expected, counted, écart, durée, statut.
- **Coloration de l'écart** : vert OK, orange warning, rouge critical.
- Clic sur une session → détail complet (stats, méthodes de paiement, voids, refunds).

Bénéfice métier : **mémoire chiffrée de la performance cash** sur la durée. Permet de repérer les patterns (ce cashier a un écart positif systématique, cet autre est en moins le mardi…).

---

## 9. Multi-terminal — Le LAN partagé

The Breakery peut avoir **plusieurs terminaux POS** ouverts en même temps sur le même LAN (caisse principale + comptoir café + caisse mobile événement). Chaque terminal ouvre **sa propre session**, indépendante des autres.

La modale `LiveSessionsModal` (côté POS) permet à un manager de voir :

- Toutes les sessions actuellement ouvertes.
- Sur quel terminal, par qui, depuis quand.
- CA en cours sur chaque session.

Bénéfice métier : **piloter la salle en temps réel** depuis n'importe quel terminal. Le manager voit que la caisse 2 fait 80 % moins de transactions que la caisse 1 — peut-être que la cashier est en pause sans avoir prévenu.

---

## 10. Les reports adossés

Le module alimente plusieurs reports critiques du module Reports :

| Report | Donnée |
|---|---|
| **Sales Cash Balance** | Réconciliation cash par session — montrer les sessions avec écart |
| **Cash Variance Trend** | Tendance des écarts sur 30 jours par cashier (détection fraude progressive) |
| **Payment By Method** | Répartition cash / digital agrégée par session |
| **Staff Performance** | Stats par cashier basées sur les sessions qu'il a tenues |

Bénéfice métier : **les sessions ne sont pas juste des bouts de papier**, elles nourrissent l'audit comptable et l'audit RH du gérant.

---

## 11. Couplage comptable

Chaque session, à sa clôture, déclenche **automatiquement** des écritures comptables :

| Événement | Impact comptable |
|---|---|
| Ouverture | Pas d'écriture (le cash existait déjà — il bouge juste physiquement vers le tiroir). |
| Ventes cash pendant la session | Déjà écritées au fil de l'eau par les triggers de commande. |
| Écart positif à la clôture | Comptabilisé en `produit exceptionnel` (4900 ou équivalent). |
| Écart négatif à la clôture | Comptabilisé en `charge exceptionnelle` (compte de perte). |
| Clôture | Fige le solde du compte cash (1110) pour la journée. |

Bénéfice métier : **les écarts ne disparaissent pas dans la nature** — ils apparaissent en compta, mois par mois, et le comptable peut interroger les sessions à l'origine.

---

## 12. Permissions

| Permission | Action |
|---|---|
| `pos.open_session` | Ouvrir une nouvelle session |
| `pos.close_session` | Fermer une session existante |
| `pos.view_sessions` | Voir l'historique des sessions |
| `pos.validate_session` | Valider la clôture en tant que manager (pour les seuils élevés) |
| `pos.recount_session` | Corriger un comptage avant clôture finale |

Bénéfice métier : **cloisonner les responsabilités cash**. Un cashier peut ouvrir et fermer la sienne, mais pas valider celle d'un autre ; un manager valide mais n'opère pas.

---

## 13. Mécaniques transverses — Comment le module dialogue avec le reste

| Module | Relation |
|---|---|
| **POS** | Refuse toute commande sans session active. Affiche la session active dans le header. |
| **Orders** | Chaque commande référence sa session — drill-down possible. |
| **Accounting** | Les écritures de clôture (écart, total cash) sont automatiques. |
| **Users & Permissions** | Permissions `pos.open_session` / `pos.close_session` / `pos.validate_session`. |
| **Reports** | Sales Cash Balance, Cash Variance Trend, Payment By Method consomment `pos_sessions`. |
| **Settings** | Seuil d'écart pour validation manager + politique de validation (`pos_config`). |

---

## 14. Ce que le module ne fait **pas** (par design)

- Le module **ne gère pas le coffre-fort**. Le dépôt en banque du cash est une opération externe (à venir : module Cash Management).
- Le module **ne fait pas de mouvement intermédiaire** (cash-in / cash-out pendant la session). Pour ajouter du fond en cours, il faut fermer la session puis en ouvrir une nouvelle. *Cf. backlog.*
- Le module **ne supporte pas les sessions multi-journée**. Une session ne peut pas durer plus de 24h — au-delà, fermeture forcée par script.
- Le module **ne calcule pas la TVA / PB1**. Ce calcul est fait au niveau de chaque commande (tax inclusive 10/110).
- Le module **ne signe pas électroniquement** (KSeF, fiscal certification). Pas de certification fiscale Indonésie obligatoire en V2.

---

## 15. Ce que le module doit (encore) faire — backlog métier

| Priorité | Évolution | Bénéfice attendu |
|---|---|---|
| 🔴 | **Cash-in / Cash-out en cours de session** | Permettre au cashier d'ajouter du fond ou de sortir un excédent en milieu de service avec trace nominative. |
| 🔴 | **Validation à deux mains pour gros écarts** | Au-delà d'un seuil critique, exiger PIN cashier + PIN manager en double-authentification. |
| 🟠 | **Dépôt bancaire intégré** | Saisir une remise bancaire en fin de journée avec photo du bordereau, lien automatique vers la compta. |
| 🟠 | **Compte des coupures obligatoire** | Forcer le détail par coupure (5k, 10k, 20k, 50k, 100k) pour audit fin et détection vol partiel. |
| 🟠 | **Alerte écart en temps réel** | Pendant la session, alerter si le cash en caisse théorique dépasse un seuil (pour inciter au dépôt). |
| 🟡 | **Session pause / reprise** | Permettre une pause déjeuner sans devoir fermer/rouvrir (cf. limite multi-journée). |
| 🟡 | **Auto-clôture programmée** | Clôture automatique à minuit pour les sessions oubliées, avec notif manager. |
| 🟢 | **KSeF / certification fiscale** | Signature électronique des sessions pour conformité fiscale Indonésie à venir. |
| 🟢 | **Coffre-fort intégré** | Module Cash Management complet (coffre, dépôts banque, retraits, mouvements inter-coffres). |

---

## 16. En une phrase

Le module Cash Register est **le notaire de la caisse** de The Breakery : il transforme un tiroir-caisse en cycle fermé, chiffré, signé et auditable, refuse toute vente tant qu'aucune session n'est ouverte, calcule l'écart à la fermeture sans jamais l'inventer, exige une raison écrite si l'écart est important, et alimente automatiquement la comptabilité — pour que chaque journée commence et finisse sur un chiffre indiscutable, et qu'aucun argent ne disparaisse jamais dans le flou.
