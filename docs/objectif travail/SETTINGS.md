# Module Settings — Objectif métier

> **Statut V2/V3** : décrit la vision business cible (~23 pages en 6 groupes). **V2 jamais déployée**. Implémentation V3 = **partielle** — 6 pages livrées (`SettingsGeneralPage`, `SettingsHubPage`, `SettingsHolidaysPage`, `SettingsEmailTemplatesPage`, `SettingsReceiptTemplatesPage`, `SettingsPermissionsPage`) + sous-dossier `security/` + RPCs (`get_settings_by_category`, `extend_settings_rpcs_for_pos_presets`, `update_role_session_timeout_v1`). Voir [`../V2_V3_GLOSSARY.md`](../V2_V3_GLOSSARY.md).
>
> **Périmètre fonctionnel** : ce document décrit **ce que le module Settings sert à faire au quotidien** pour The Breakery,

---

## 1. Raison d'être

Le module Settings est la **salle de contrôle** de The Breakery. Il répond à une question simple mais structurante pour un gérant qui veut que son ERP/POS colle à *sa* boulangerie et pas à un modèle générique :

> *"Comment je règle l'application pour qu'elle reflète ma boutique : mes horaires, ma taxe, mes méthodes de paiement, mes catégories produits, mes imprimantes, mes droits staff, mon plan de salle, mon programme fidélité ?"*

C'est le module qui transforme une **application générique** en **outil sur-mesure** pour The Breakery. Sans lui, l'app ne sait pas que la TVA s'appelle PB1, qu'elle vaut 10%, qu'elle est incluse dans les prix, que le café se livre à la table, que le ticket cuisine s'imprime sur la KitchenStar du four, que Made peut faire des remises jusqu'à 10% mais pas Putu, et que la session caisse se ferme automatiquement après 30 minutes d'inactivité.

Le module est **transverse** : chaque autre module (POS, Inventory, Customers, Accounting, KDS…) **lit** ici sa configuration. Une modification dans Settings se propage en temps réel à toute l'application.

---

## 2. Les 6 grandes familles de réglages (les 6 groupes du menu)

Le module est structuré en **6 groupes** correspondant à 6 territoires de configuration distincts :

| Groupe | Job-to-be-done | Pages |
|---|---|---|
| **General** | Identité de l'entreprise, horaires, taxe | 3 |
| **Sales & POS** | Comportement de la caisse, paiements, fidélité | 3 |
| **Operations** | Stock, catalogue, cuisine, display client | 5 |
| **Commerce** | B2B (wholesale, crédit, conditions) | 1 |
| **System** | Imprimantes, notifications, sécurité, RBAC, audit, réseau LAN | 9 |
| **Layout** | Plan de salle, sections | 2 |

Au total **~23 pages de réglages**. Toutes partagent la même mécanique : un formulaire, un bouton "Save", un retour visuel "Saved", et une trace écrite dans l'historique pour qui-a-changé-quoi-quand.

---

## 3. Les 5 invariants du module

Quelle que soit la page consultée, l'utilisateur retrouve toujours les mêmes mécaniques — c'est ce qui rend le module rassurant :

1. **Sauvegarde explicite**. Aucune modification n'est appliquée tant que l'utilisateur n'a pas cliqué "Save". Pas d'effet de bord caché en quittant la page.
2. **Historique systématique**. Chaque changement est tracé (qui, quoi, quand, ancienne valeur, nouvelle valeur) dans `Settings History`. Aucune modification n'est anonyme.
3. **Permission requise**. L'accès aux Settings est protégé par `settings.view` (lecture) et `settings.update` (écriture). Certaines pages réseau ont leur propre permission (`settings.network`).
4. **Propagation temps réel**. Les valeurs sont lues via Supabase Realtime + stores Zustand — un changement de taxe à 11h pendant une vente s'applique sur la transaction suivante sans relogin.
5. **Defaults raisonnables**. Tout réglage a une valeur par défaut cohérente pour une boulangerie indonésienne ; le module ne casse jamais l'app si une valeur manque.

---

## 4. Groupe **General** — Identité de la boutique

C'est le tout premier groupe à remplir le jour où on installe The Breakery. Il définit **qui est l'entreprise** aux yeux du système et de ses tickets.

### 4.1 Company

Permettre au gérant de saisir l'identité officielle de la boutique :

- Nom commercial, adresse, téléphone, e-mail, site web.
- Logo (affiché sur l'en-tête des tickets, factures, PDF de rapports).
- NPWP (identifiant fiscal indonésien) — apparaît sur les factures B2B officielles.
- Devise par défaut (IDR).

Bénéfice métier : **donner une identité visuelle et légale** à tous les documents sortants. Un ticket sans logo et sans NPWP n'a pas la même crédibilité face à un client B2B ou à un contrôleur fiscal.

### 4.2 Business Hours

Définir les horaires d'ouverture par jour de la semaine. Ces horaires servent à :

- Afficher les horaires sur le ticket et la page publique.
- Marquer une transaction comme "hors horaire" dans les rapports d'audit (signal de fraude potentielle).
- Permettre des règles de pricing horaire (happy hour) à terme.

Bénéfice métier : **objectiver ce qui est normal**. Une vente à 23h dans une boulangerie qui ferme à 19h ne déclenche pas une notification : elle devient un point rouge dans l'audit, à vérifier.

### 4.3 Tax

Le réglage **le plus critique** du module pour la conformité. Configurer la taxe applicable :

- **Nom** : PB1 (Pajak Restoran — taxe restaurant locale, **pas la TVA / PPN**).
- **Taux** : 10% (fixé par la réglementation locale, n'a pas vocation à bouger).
- **Mode** : **inclus** dans les prix (formule de calcul : tax = total × 10/110).
- **Comptes comptables associés** : 2143 (PB1 payable) et 2110 (PB1 collected).

Bénéfice métier : **séparer le chiffre d'affaires de la dette fiscale** sans demander au gérant de faire le calcul. Chaque vente alimente automatiquement la déclaration PB1 mensuelle. Une erreur ici (taux à 11%, mode "hors taxe") fausserait toute la comptabilité — d'où la protection en édition (permission `settings.update` + log historique).

---

## 5. Groupe **Sales & POS** — Comportement de la caisse

C'est ici que le gérant **personnalise l'expérience caisse** : ce qui s'imprime automatiquement, ce qui est obligatoire, ce qui est interdit.

### 5.1 POS Configuration

Régler ~15 toggles qui pilotent le comportement de la caisse en direct :

| Toggle | Effet métier |
|---|---|
| Auto-print receipt | Imprimer automatiquement le ticket à la fin d'une commande payée. |
| Auto-send to kitchen | Envoyer automatiquement les items à la KDS à la création de la commande. |
| Print kitchen ticket | Imprimer un ticket cuisine en plus de l'envoi KDS. |
| Lock kitchen items | Les items envoyés en cuisine ne peuvent plus être modifiés sans PIN manager. |
| Require PIN to remove locked item | Renforcement de la règle ci-dessus. |
| Sound notifications | Activer / couper les bips de la caisse. |
| Customer display | Afficher la commande sur un second écran client. |
| Require customer on order | Refuser de finaliser une commande sans client assigné (utile pour la fidélité). |
| Allow oversell | Autoriser la vente d'un produit en rupture (mode dépannage). |
| Auto-logout on order complete | Déconnecter le cashier après chaque commande (mode "caisse partagée"). |
| Session timeout | Durée d'inactivité avant déconnexion automatique (défaut 30 min). |

Bénéfice métier : **adapter la caisse au tempo de la boutique**. Une boulangerie tranquille active "Auto-logout" parce que la cashier va et vient en cuisine ; un rush du midi désactive "Require customer on order" pour ne pas ralentir la file.

### 5.2 Payment Methods

Activer / désactiver et ordonner les méthodes de paiement disponibles à la caisse :

- Cash (toujours actif, fond de caisse par session).
- Card (Visa, Mastercard, JCB) avec ou sans commission.
- QRIS (norme Indonésie unifiée).
- E-wallets (GoPay, OVO, DANA, ShopeePay).
- Bank transfer (paiement déféré, validation manuelle).
- B2B credit (paiement à terme, lié au crédit client).
- POS outstanding (ardoise informelle, à régler plus tard).

Pour chaque méthode : libellé, icône, ordre d'affichage, frais éventuels, compte comptable de débit.

Bénéfice métier : **refléter exactement les moyens de paiement réellement acceptés** ce mois-ci. Si la machine carte tombe en panne ou si un nouveau wallet débarque, le gérant l'active / désactive en un clic.

### 5.3 Loyalty Program

Configurer le programme de fidélité The Breakery :

- **Ratio** : 1 point = 1 000 IDR dépensés (modifiable).
- **Paliers** : Bronze (0 pts, 0% de remise), Silver (500 pts, 5%), Gold (2 000 pts, 8%), Platinum (5 000 pts, 10%).
- **Bonus anniversaire** : points doublés / fixe sur l'anniversaire client.
- **Date d'expiration** : durée de validité des points (défaut : jamais).
- **Descriptions par palier** affichées au client.

Bénéfice métier : **garder la main sur la générosité du programme** sans toucher au code. Le gérant peut ajuster les seuils Silver→Gold→Platinum quand le portefeuille client mûrit, ou lancer un événement "x2 points ce week-end" sans développeur.

---

## 6. Groupe **Operations** — Règles métier du stock, du catalogue et de la cuisine

Ce groupe pilote le **fonctionnement opérationnel** de l'arrière-boutique.

### 6.1 Inventory Configuration

Régler les seuils et comportements du stock :

- Seuil d'alerte stock bas (défaut : <10).
- Seuil d'alerte critique (défaut : <5).
- Activer ou non le suivi en lot (FIFO, dates de péremption).
- Politique de gestion des fractions d'unité (autoriser ou pas les 0,5 kg).
- Auto-recalcul du coût moyen pondéré à chaque réception.

Bénéfice métier : **calibrer les alertes au rythme réel** de chaque produit. Le seuil par défaut est trop bas pour la farine (consommation forte) et trop haut pour la vanille (consommation marginale).

### 6.2 Product Categories

Définir l'**arborescence catalogue** :

- Liste des catégories (Pains, Viennoiseries, Boissons, Plats salés, Sandwichs, Pâtisseries…).
- Couleur de catégorie pour l'affichage caisse.
- Catégorie parente pour les sous-catégories.
- Ordre d'affichage dans la grille produit.

Bénéfice métier : **classer les produits comme on les pense**. Une catégorisation propre divise le temps d'encaissement par deux en heure de pointe.

### 6.3 Product Types

Distinguer les **natures** de produit qui ne se gèrent pas pareil :

- Standard (vendu en pièce, géré en stock simple).
- Recette (produit fini issu d'une recette qui déduit ses ingrédients).
- Combo (produit composé d'autres produits).
- Service (pas de stock — frais de livraison, supplément…).
- Matière première (jamais vendu en caisse, uniquement consommé en production).

Bénéfice métier : **éviter qu'un sandwich décompte simplement "1 sandwich"** alors qu'il devrait décompter 200 g de pain, 50 g de jambon et 30 g de salade. Les types pilotent toute la logique stock du module.

### 6.4 KDS Configuration

Régler la **Kitchen Display System** :

- Stations de préparation (Pain, Pâtisserie, Boissons, Plats salés…).
- Routage automatique des items vers la bonne station selon la catégorie.
- Seuils de couleur (vert / orange / rouge) selon l'âge de la commande.
- Bip sonore à l'arrivée d'un nouvel item.
- Format d'affichage (gros / petit, ticket par ticket ou liste consolidée).

Bénéfice métier : **adapter la KDS au workflow réel** de chaque poste. Un poste pâtisserie (commandes lentes, peu de volume) n'a pas les mêmes besoins qu'un poste boissons (rush, commande de 2 minutes).

### 6.5 Customer Display

Configurer l'**écran client** (second écran face au client) :

- Activer / désactiver.
- Afficher logo, slogan, message d'accueil rotatif.
- Afficher le détail du ticket en cours.
- Afficher les promotions actives.
- Afficher les points fidélité gagnés à la commande.

Bénéfice métier : **valoriser le programme fidélité et la transparence prix**. Le client voit ses points monter en direct → le programme passe d'abstrait à tangible.

---

## 7. Groupe **Commerce** — Conditions B2B

### 7.1 B2B Settings

Définir les **règles transverses des ventes B2B** :

- Conditions de paiement par défaut pour les nouveaux clients B2B (COD, net 7, net 14, net 30, net 60).
- Plafond de crédit par défaut.
- Workflow d'approbation des commandes B2B (auto / un niveau / deux niveaux).
- Numérotation des factures B2B (préfixe, format, séquence annuelle ou continue).
- Templates de facture (en-tête, mentions légales, conditions générales).

Bénéfice métier : **standardiser les règles commerciales B2B** sans devoir les ressaisir à chaque nouveau client. Quand un hôtel ouvre un compte, ses conditions par défaut sont déjà calibrées sur ce que le gérant a décidé pour son segment.

---

## 8. Groupe **System** — Infrastructure, sécurité, RBAC

C'est le groupe **administrateur** par excellence. Il pilote tout ce qui touche au système, à la sécurité et à la traçabilité.

### 8.1 Printing

Configurer les **imprimantes physiques** et leur routage :

- Liste des imprimantes connectées (USB, Bluetooth, IP réseau).
- Type d'imprimante (thermique 80mm / 58mm, A4, étiquettes).
- Affectation au rôle : reçu client, ticket cuisine, ticket barista, étiquettes prix.
- Largeur du papier, vitesse, marges.
- Test d'impression direct depuis la page.

Bénéfice métier : **router le bon document vers la bonne imprimante** sans avoir à reconfigurer Windows à chaque rotation de matériel. Un changement d'imprimante cuisine se fait dans Settings en 30 secondes, pas en 30 minutes d'IT.

### 8.2 Notifications

Régler les canaux et seuils des notifications :

- Stock bas / critique (par produit ou global).
- Session caisse anormale (écart > X IDR).
- Tentative de PIN manager échouée.
- Commande B2B en attente d'approbation.
- Erreur d'impression / d'envoi cuisine.

Pour chaque type : activer le toast en app, le son, l'e-mail, le push mobile.

Bénéfice métier : **ne pas être noyé sous les alertes inutiles** tout en ne ratant pas les vrais signaux. Chaque gérant calibre son seuil de stress.

### 8.3 Security & PIN

Régler la **politique d'authentification PIN** :

- Longueur minimale (défaut : 4 chiffres).
- Durée de validité d'un PIN avant changement obligatoire.
- Nombre de tentatives avant verrouillage du compte.
- Durée du verrouillage automatique.
- Activation de la double authentification pour les opérations sensibles (void, refund, settings update).

Bénéfice métier : **équilibrer sécurité et friction**. Un PIN à 4 chiffres avec verrouillage après 3 essais arrête 99 % des tentatives de fraude staff sans gêner les cashiers honnêtes.

### 8.4 Financial / Accounting

Configurer les **paramètres comptables** transverses :

- Plan comptable de référence (SAK EMKM / SAK ETAP).
- Numérotation des écritures journal (préfixe, séquence annuelle / continue).
- Comptes par défaut pour les automatismes (compte cash, compte ventes, compte COGS, compte expenses).
- Date de clôture exercice (défaut : 31 décembre).
- Premier mois fiscal.

Bénéfice métier : **caler la compta automatique sur la réalité indonésienne** sans devoir mapper à la main chaque écriture journal.

### 8.5 Roles & Permissions

Le module **RBAC** (Role-Based Access Control) de l'application. Permet au gérant ou à l'admin de :

- Créer des rôles métier (Owner, Manager, Cashier, Barista, Kitchen, Accountant, Stockman…).
- Affecter ~70 permissions atomiques à chaque rôle (`sales.create`, `sales.void`, `sales.discount`, `inventory.adjust`, `customers.loyalty`, `accounting.manage`…).
- Attribuer un rôle à chaque utilisateur.
- Modifier en masse (mêmes droits pour tous les cashiers).
- Cloner un rôle existant pour créer une variante.

Bénéfice métier : **donner à chacun strictement les droits dont il a besoin**, ni plus ni moins. Un cashier qui ne peut pas voir le P&L ne peut pas le partager dehors ; un barista qui ne peut pas voider une commande ne peut pas frauder par annulation.

### 8.6 Audit Log

Consulter le **journal de tous les événements sensibles** du système. Ce n'est pas un réglage en soi mais une lecture des traces générées par tous les autres modules :

- Connexion / déconnexion utilisateur.
- Modification de permission ou de rôle.
- Modification de paramètre Settings.
- Suppression de produit, de client, d'employé.
- Annulation de commande, remise au-delà du seuil.
- Ajustement manuel de points fidélité ou de stock.

Filtrable par utilisateur, type d'événement, période.

Bénéfice métier : **le filet de sécurité ultime**. En cas de litige ou de fraude soupçonnée, ce journal donne la **réponse datée et signée**.

### 8.7 LAN Network

Visualiser et configurer le **réseau local** multi-appareils de The Breakery :

- Hub principal (caisse principale qui orchestre).
- Clients connectés (autres caisses, KDS, displays, tablettes serveur).
- Heartbeat de chaque appareil (dernier signe de vie).
- État des canaux BroadcastChannel et Supabase Realtime.
- Test de connectivité hub ↔ client.

Bénéfice métier : **diagnostiquer en direct un problème réseau** sans appeler l'IT. Si une KDS ne reçoit plus les commandes, le gérant voit immédiatement si c'est un problème hub, client, ou réseau.

### 8.8 Network Devices

Enregistrer et identifier chaque **appareil physique** (terminal POS, KDS, display, tablette serveur, imprimante réseau) :

- Nom de l'appareil et son rôle.
- Adresse IP / hostname.
- Type et modèle.
- Localisation physique (Cuisine, Comptoir, Salle, Caisse 1, Caisse 2…).
- Statut d'activation.

Bénéfice métier : **un inventaire matériel toujours à jour**. Quand un appareil dysfonctionne, le gérant identifie en 5 secondes "la KDS pâtisserie côté four" plutôt que "la deuxième tablette".

### 8.9 Settings History

Consulter l'historique de **tous les changements de paramètres** :

- Quel paramètre a été modifié.
- Ancienne valeur → nouvelle valeur.
- Qui a fait le changement.
- Quand exactement.

Filtrable et exportable.

Bénéfice métier : **comprendre pourquoi quelque chose ne marche plus**. Le ticket cuisine ne s'imprime plus depuis lundi ? Settings History montre que le toggle "Print kitchen ticket" a été désactivé dimanche soir par tel utilisateur — diagnostic en 10 secondes.

---

## 9. Groupe **Layout** — Plan de salle

### 9.1 Floor Plan

Dessiner le **plan de salle** de la boutique en mode visuel (drag & drop) :

- Positionner les tables avec leur numéro et leur capacité.
- Définir les zones (Salle principale, Terrasse, Comptoir, Privatif).
- Indiquer les éléments fixes (mur, bar, entrée).
- Réutiliser le plan dans le module POS pour le mode Dine-in et la prise de commande à table.

Bénéfice métier : **donner aux serveurs et au caissier la même carte mentale** de la salle. La table 7 est la table 7 dans l'app exactement où elle se trouve physiquement, ce qui supprime les erreurs d'envoi.

### 9.2 Sections

Définir les **sections logiques** au-delà du plan visuel :

- Sections de salle (Terrasse, Salle, Privé, Bar).
- Affectation des tables à une section.
- Affectation des serveurs à une section (un serveur ne voit que ses tables).
- Statut actif / inactif (terrasse fermée en cas de pluie).

Bénéfice métier : **organiser le service** en équipes responsables de leur secteur, et désactiver une zone d'un clic sans réorganiser tout le plan.

---

## 10. Mécaniques transverses — Comment le module se comporte

Au-delà du contenu page par page, le module garantit trois mécaniques essentielles à la robustesse globale de l'application.

### 10.1 Propagation temps réel

Toute modification est :

1. Persistée dans la table `settings` Supabase.
2. Diffusée via Realtime à tous les clients connectés (caisses, KDS, displays).
3. Re-hydratée dans le store Zustand approprié.
4. Re-render automatique des composants qui consomment le réglage.

Latence typique : **< 2 secondes** d'un poste à l'autre.

### 10.2 Versioning et rollback

Chaque modification crée une nouvelle entrée dans `settings_history`. Le rollback se fait en consultant l'historique et en réappliquant manuellement l'ancienne valeur (pas de bouton "revert" automatique — choix de design pour forcer l'utilisateur à comprendre ce qu'il restaure).

### 10.3 Cloisonnement par permissions

| Permission | Donne accès à |
|---|---|
| `settings.view` | Lecture de toutes les pages settings (sauf network) |
| `settings.update` | Écriture sur toutes les pages settings |
| `settings.network` | Lecture + écriture sur Printing, LAN, Network Devices uniquement |
| `users.roles` | Page Roles & Permissions |

Bénéfice métier : **séparer le technicien réseau du gérant**. L'IT externe a `settings.network` pour brancher une imprimante mais ne peut pas modifier la taxe ou les rôles staff.

---

## 11. Ce que le module ne fait **pas** (par design)

- Le module **ne crée pas d'utilisateurs**. La création de comptes utilisateur est dans `/users`. Settings ne gère que la définition des rôles et l'affectation des permissions à un rôle.
- Le module **ne modifie pas le catalogue produit** (sauf la définition des catégories et des types). L'ajout d'un produit reste dans `/products`.
- Le module **ne change pas les prix produits**. La pricing est dans le module Products / Categories.
- Le module **ne fait pas de migration de données**. Changer une devise ou un plan comptable en cours d'exercice impose de passer par un script dédié — Settings refuse les changements à conséquence rétroactive massive.
- Le module **n'a pas de mode "wizard d'installation"**. Chaque page est autonome et accessible dans n'importe quel ordre — c'est au gérant ou à l'intégrateur de connaître son chemin.

---

## 12. Ce que le module doit (encore) faire — backlog métier

Réglages identifiés comme à forte valeur ajoutée non encore livrés :

| Priorité | Réglage | Bénéfice attendu |
|---|---|---|
| 🔴 | **Approval workflows configurables** | Définir visuellement les seuils et les rôles d'approbation pour void, refund, remise > X%, expense > Y IDR. |
| 🔴 | **Pricing horaire (happy hour)** | Régler des fenêtres horaires avec prix réduits sans toucher au catalogue produit. |
| 🟠 | **Notification scheduler** | Programmer une notification de stock bas envoyée chaque matin à 7h plutôt qu'à l'instant T. |
| 🟠 | **Templates de tickets éditables** | Personnaliser l'en-tête, le pied et les mentions du reçu sans dev. |
| 🟠 | **Multi-boutique** | Préparer le passage à une deuxième adresse The Breakery (paramètres scoping par site). |
| 🟡 | **Export / Import complet de la configuration** | Sauvegarder tous les settings dans un fichier pour cloner sur un nouveau poste ou pour audit. |
| 🟡 | **Wizard d'installation guidé** | Onboarding pas-à-pas pour un nouveau gérant qui ouvre une boutique. |
| 🟢 | **Multi-devise** | Préparer une éventuelle facturation USD pour les expatriés (hors scope V2). |

---

## 13. En une phrase

Le module Settings est **l'interrupteur central** de The Breakery : il transforme une application générique en boulangerie personnalisée, applique chaque changement en temps réel à toutes les caisses, et garde la trace écrite de qui a changé quoi quand — pour qu'aucun réglage ne soit ni perdu, ni anonyme, ni irréversible.
