# Module KDS (Kitchen Display System) — Objectif métier

> **Statut V2/V3** : décrit la vision business cible. **V2 jamais déployée**. Implémentation réelle = V3 monorepo (`apps/pos/src/features/kds`). Voir [`../V2_V3_GLOSSARY.md`](../V2_V3_GLOSSARY.md).
>
> **Périmètre fonctionnel** : ce document décrit **ce que le module KDS (`/kds`, `/kds/:station`) sert à faire au quotidien** pour The Breakery,

---

## 1. Raison d'être

Le module KDS est **l'œil et l'oreille de la cuisine** de The Breakery. Il répond à la question simple qui détermine la qualité du service en restauration :

> *"Quand le caissier envoie une commande, comment le boulanger / barista / serveur sait quoi préparer, dans quel ordre, depuis combien de temps il attend, et comment il signale au comptoir que c'est prêt — sans crier dans tout l'atelier et sans gribouillis papier ?"*

C'est l'écran qui transforme **un envoi caisse** en **mission cuisine claire** : commandes affichées par poste, items routés à la bonne station, timers visuels, alertes d'urgence sonores, bouton "Ready" qui prévient la salle. Sans lui, la cuisine fonctionne au cri ; avec lui, chaque item est une carte sur un mur numérique qui passe du jaune au orange au rouge à mesure que le temps file.

Le KDS est **un client du POS sur le LAN local** : il reçoit les commandes en direct, ne crée jamais rien, et renvoie uniquement des changements de statut (preparing → ready → served).

---

## 2. Les 4 stations supportées

Le module distingue **4 postes de travail** correspondant à 4 réalités cuisine d'une boulangerie/café :

| Station | Code | Quoi | Couleur |
|---|---|---|---|
| **Hot Kitchen** | `hot_kitchen` | Cuisine chaude — sandwichs, plats salés, four | Rouge (urgence) |
| **Barista** | `barista` | Boissons chaudes et froides | Or (signature The Breakery) |
| **Display** | `display` | Vitrine — produits déjà prêts à servir | Vert (frais) |
| **Waiter** | `waiter` | Vue serveur — toutes stations consolidées | Gris (lecture seule) |

Le **routage** d'un item vers une station est déterminé par sa **catégorie produit** (champ `categories.dispatch_station`). Le café route `barista`, les pains routent `display`, les sandwichs routent `hot_kitchen`.

Le **mode Waiter** est une vue spéciale : il agrège **toutes les stations** pour donner au serveur la vue d'ensemble du service en salle.

---

## 3. Les 5 invariants du module

Quelle que soit la station, le module garantit toujours :

1. **Lecture seule sauf statut d'item**. Le KDS n'ajoute, ne supprime ni ne modifie d'items. Il ne change que `item_status` (preparing → ready → served).
2. **Routage par catégorie**. Un item s'affiche uniquement sur la station correspondant à sa catégorie. Un café ne pollue jamais l'écran cuisine chaude.
3. **Granularité item-level**. Chaque item d'une commande a son propre statut, indépendant des autres. Le cappuccino sort en 1 minute, le croque-monsieur en 8 — chacun a son tempo.
4. **Temps réel via LAN**. Le KDS est un client `lanClient` connecté au hub POS. Une commande envoyée caisse apparaît à la KDS en <1 seconde.
5. **Alertes sonores progressives**. Bip discret à l'arrivée, alerte sonore plus forte si l'item dépasse un seuil critique (`useKdsUrgentAlertLoop`).

---

## 4. Le sélecteur de station — La porte d'entrée

Page `KDSStationSelector` (`/kds`) : la première vue au démarrage d'un écran KDS.

Affiche **4 grosses cartes** (Hot Kitchen / Barista / Display / Waiter) avec leur icône et leur couleur. Le membre d'équipe choisit son poste d'un seul tap.

Ce sélecteur est volontairement **plein écran et sans fioritures** :

- Pas de menu, pas de retour back-office.
- Pas de login séparé : le KDS hérite de la session ouverte sur le terminal physique.
- Une fois la station choisie, le retour au sélecteur exige une action explicite (long press, geste réservé) — pour éviter qu'un cuisinier sorte par erreur.

Bénéfice métier : **un appareil = un poste**. La tablette posée sur le plan de travail du four est sur la station Hot Kitchen toute la journée ; celle du bar est sur Barista. Personne ne se trompe d'écran.

---

## 5. La grille de commandes — Le cœur opérationnel

Page `KDSMainPage` (`/kds/:station`) — l'écran de travail à plein temps.

### 5.1 Structure

- **Header** (`KDSHeader`) en haut : nom de la station, compteur de commandes en cours, accès All-Day Count, bouton refresh.
- **All Day Count** (`KDSAllDayCount`) optionnel : compteur cumulé d'items préparés sur la journée par produit (utile pour la communication entre équipes).
- **Order Grid** (`KDSOrderGrid`) : grille de cartes commandes, scrollable horizontalement ou verticalement selon réglage.

### 5.2 Une carte commande (`KDSOrderCard`)

Chaque commande est une **carte** affichant :

- **Numéro de commande** + table (si dine-in) ou nom client (si pris).
- **Type** : badge Dine-in / Takeaway / Delivery / B2B.
- **Heure de réception** + **timer** (countdown bar `KDSCountdownBar`).
- **Liste des items routés à cette station uniquement** (les autres items sont invisibles ici).
- Pour chaque item :
  - Nom du produit + quantité.
  - Modifiers / variantes (sucre +, sans lait, etc.).
  - Notes spéciales (allergie, préparation).
  - Bouton **Ready** individuel par item.
  - Badge `item_status` (pending → preparing → ready → served).
- **Progress bar** (`OrderProgressBar`) : pourcentage d'items ready sur le total.
- **Bouton "All Ready"** quand tous les items sont prêts → signale au comptoir.

### 5.3 Comportement visuel

Code couleur **progressif** :

| Âge | Couleur | Signal |
|---|---|---|
| < 3 min | Vert / blanc | Frais, pas de stress |
| 3-7 min | Orange | Attention, à surveiller |
| 7-12 min | Rouge | Urgent |
| > 12 min | Rouge clignotant + alerte sonore | Critique — l'équipe doit agir |

Les seuils sont **configurables** dans Settings → KDS Configuration (par station).

Bénéfice métier : **discipline visuelle sans micro-management**. Le chef ne dit jamais "dépêche-toi !" — c'est l'écran qui le dit, et personne ne le prend mal.

---

## 6. Le cycle de vie d'un item

Chaque item d'une commande traverse un parcours **statutaire** :

```
pending → preparing → ready → served
                                ↓
                            cancelled
```

| Statut | Qui change | Quand |
|---|---|---|
| **pending** | Auto à l'envoi caisse | L'item est arrivé sur la station, personne ne l'a touché. |
| **preparing** | Cuisinier tape "Start" (optionnel) | L'item est en cours de préparation. Active le timer "en cours". |
| **ready** | Cuisinier tape "Ready" | Plus de travail à faire — à servir / remettre. |
| **served** | Auto via Waiter ou auto-remove timer | L'item est sorti de la cuisine vers le client. Auto-archive de la carte. |
| **cancelled** | Cashier voide la commande | L'item est rayé visuellement, retiré de la file. |

La **commande globale** passe à `ready` quand **tous ses items** sont `ready`. C'est ce statut qui déclenche le **son de notification côté POS** ("order ready") qu'on entend depuis la caisse.

Bénéfice métier : **chaque item a son tempo propre**. Le cappuccino part avant le croque-monsieur — le client a quelque chose dans les mains immédiatement, et son sandwich arrive 6 minutes plus tard. Service perçu comme rapide même si le plat principal prend du temps.

---

## 7. Les alertes sonores — Le KdsSoundService

Le KDS s'accompagne d'un **moteur sonore** (`kdsSoundService`) qui joue plusieurs sons selon le contexte :

| Événement | Son | Volume |
|---|---|---|
| **Nouvelle commande arrive** | Bip court neutre | Moyen |
| **Item passe en urgent** (`useKdsUrgentAlertLoop`) | Alerte répétée | Fort |
| **All Ready confirmé** | Bip de validation positif | Doux |
| **Erreur réseau (LAN déconnecté)** | Alerte d'erreur | Moyen |

Les volumes et l'activation sont **configurables par station** dans Settings → KDS Configuration. Une cuisine bruyante peut mettre fort, un display silencieux peut couper.

Bénéfice métier : **éveiller l'attention sans dépendre du regard**. Le cuisinier qui sort le four entend le bip et sait qu'il a une nouvelle mission, même sans regarder l'écran.

---

## 8. Le mode Waiter — Vue serveur

La station `waiter` est un mode spécial qui agrège **toutes les stations** :

- Toutes les commandes en cours apparaissent, peu importe leur destination cuisine.
- Le serveur voit la **progression globale** de chaque table.
- Quand une commande est `all ready` → le serveur prend l'écran pour signal d'apporter.
- Bouton "Served" final qui passe la commande en `served` côté système et la fait disparaître de toutes les KDS.

Bénéfice métier : **dispatcher le service à table** depuis un seul écran. Le serveur ne fait plus la tournée des stations pour voir ce qui est prêt — il regarde son écran et fonce sur la table prête.

---

## 9. Auto-remove — Le nettoyage automatique

Hook `useOrderAutoRemove` : les commandes terminées **disparaissent automatiquement** après un délai configurable.

- Une fois `all ready` confirmé → bouton "Served" optionnel sinon retrait auto après 2-5 minutes.
- Si l'item passe en `served` → retrait immédiat de la KDS source.
- Évite l'encombrement visuel — l'écran reflète uniquement le **travail en cours**.

Bénéfice métier : **clarté permanente**. La cuisine ne voit que ce qui reste à faire, jamais ce qui est déjà fait — réduit la charge cognitive.

---

## 10. Réception des commandes — Le couplage POS/KDS

Le hook `useKdsOrderReceiver` écoute en permanence :

- Les **broadcasts LAN** depuis le hub POS (canal `'appgrav-lan'`).
- Les **Supabase Realtime** comme fallback (canal `'lan-hub'`).

Quand une nouvelle commande arrive :

1. Filtrage des items par station (le hot_kitchen ne voit pas les cafés).
2. Insertion dans la queue (`useKdsOrderQueue`) avec timestamp local.
3. Tri automatique par âge décroissant (plus vieux en haut par défaut).
4. Bip de notification.

Si la connexion LAN saute, le KDS bascule automatiquement sur Realtime — pas d'interruption perçue.

Bénéfice métier : **synchro <1s sans perte de commande**. Une commande envoyée à 14h32:15 apparaît en cuisine à 14h32:16, dans le pire des cas via fallback Realtime.

---

## 11. Les actions cuisinier — Le geste minimaliste

Le module `useKdsOrderActions` expose un nombre **volontairement restreint** d'actions :

| Action | Effet |
|---|---|
| **Tap item "Ready"** | Bascule item_status → `ready`, met à jour Supabase. |
| **Tap item "Undo"** | Repasse à `preparing` si erreur de clic. |
| **Tap commande "All Ready"** | Passe tous les items en `ready` en un coup. |
| **Long press item** | Affiche les notes spéciales en grand (cas allergie). |
| **Bouton refresh global** | Recharge la queue depuis Supabase (en cas de doute). |

Pas de modification d'item, pas d'annulation, pas de remise en file. Le KDS **ne défait pas** ce que la caisse a fait — il l'exécute.

Bénéfice métier : **le cuisinier reste dans son geste métier**. Pas de clavier, pas de menu, pas de risque d'opération destructrice. Un tap, c'est fini.

---

## 12. Le rôle dans l'architecture LAN

Le KDS s'insère dans la mécanique **hub/client** de l'app :

- La **caisse principale POS** est le hub (`lanHub`).
- Chaque appareil KDS est un client (`lanClient`) qui s'enregistre auprès du hub via heartbeat (30s, stale à 120s).
- Les commandes voyagent **hub → clients** via BroadcastChannel local + Realtime cloud en backup.
- Les changements de statut voyagent **client → hub** via Supabase direct (le KDS update Postgres → trigger Realtime → POS notifié).
- Le hub utilise les statuts retournés pour mettre à jour le **son order ready** sur la caisse.

Bénéfice métier : **résilience réseau**. Si le wifi vacille, le LAN local prend le relais. Si le LAN tombe, Supabase prend le relais. Le KDS ne se déconnecte qu'en cas de double panne.

---

## 13. Configuration — Settings → KDS Configuration

Réglages disponibles dans Settings :

- **Stations actives** : activer / désactiver une station (pas de KDS pâtisserie chez The Breakery par exemple).
- **Seuils de couleur** : à partir de combien de minutes l'item passe orange / rouge.
- **Sons** : activer / désactiver par station, volume par défaut.
- **Auto-remove delay** : 0 = bouton manuel obligatoire ; 120s = auto après 2 minutes.
- **Layout** : grille horizontale (façon ticket rail) ou verticale (façon liste).
- **Police** : grande (mauvaise vue / poste loin) ou compacte (beaucoup d'items en parallèle).

Bénéfice métier : **chaque cuisine a son tempo**. Le four cuisson rapide met les seuils à 5/10 min ; la pâtisserie longue à 15/30 min.

---

## 14. Mécaniques transverses — Comment le module dialogue avec le reste

| Module | Relation |
|---|---|
| **POS / Orders** | Les commandes sont créées au POS, le KDS les reçoit. Les changements de statut KDS sont écoutés par la page Orders. |
| **Products / Categories** | Le `dispatch_station` de la catégorie pilote le routage cuisine. |
| **Settings** | Configuration KDS centralisée dans Settings → KDS Configuration. |
| **LAN** | Le KDS est un client LAN avec heartbeat et fallback Realtime. |
| **Customer Display** | Quand le KDS marque all ready, le Customer Display peut afficher "Votre commande est prête". |
| **Reports** | `service_speed` (backlog) — temps cuisinier par item via `dispatch_station`. |
| **Permissions** | Pas de permission propre — le KDS est lisible par toute personne ayant un terminal physique configuré. |

---

## 15. Ce que le module ne fait **pas** (par design)

- Le KDS **ne crée pas de commande**. Pas de saisie manuelle "ajouter un café" depuis la cuisine — tout passe par la caisse.
- Le KDS **ne modifie pas les items** (ajouter un modificateur, retirer un ingrédient). Pour ça, le cuisinier doit appeler le caissier qui modifiera depuis le POS.
- Le KDS **n'a pas de mode "tickets imprimés"**. Si une station perd l'écran, pas de papier de secours. Le KDS papier (`Print kitchen ticket` dans Settings POS Config) est un *complément* du POS, pas du KDS.
- Le KDS **ne planifie pas la production**. Pas d'agrégation "tu vas avoir 50 baguettes demain matin à préparer" — ça relève du module Production.
- Le KDS **ne supporte pas la persistance offline**. Une coupure complète d'internet + LAN bloque la réception (pas de mode hors-ligne dégradé).
- Le KDS **ne communique pas entre cuisiniers**. Pas de chat, pas de messagerie. Si une station veut alerter une autre, c'est à la voix.

---

## 16. Ce que le module doit (encore) faire — backlog métier

| Priorité | Évolution | Bénéfice attendu |
|---|---|---|
| 🔴 | **Service Speed report** | Mesurer le temps moyen de préparation par item / par station / par cuisinier. Identifier les goulots. |
| 🔴 | **Throttling intelligent** | Quand 20 cafés arrivent en 30 secondes, le KDS prévient le barista et le caissier ("file d'attente saturée"). |
| 🟠 | **Chat inter-stations** | Messagerie courte entre stations pour les cas borderline ("le sandwich n°124 doit attendre la frite"). |
| 🟠 | **Mode urgences** | Bouton "URGENT" qui force un item en haut de la pile et passe en rouge immédiatement (commande VIP, complainte client). |
| 🟠 | **Reroute manuel** | Le manager peut renvoyer un item d'une station à une autre (cas erreur de catégorisation produit). |
| 🟡 | **Persistance offline** | Cache local + sync au retour réseau pour les courtes coupures (<5 min). |
| 🟡 | **Mode présentation public** | Écran de cuisine visible par les clients qui montre les commandes en cours (effet "cuisine ouverte"). |
| 🟢 | **Reconnaissance vocale "Ready"** | Le cuisinier dit "Ready 124" à voix haute, le système marque l'item — pour cuisiniers les mains pleines. |
| 🟢 | **Caméra timer cuisson** | Photo automatique de chaque préparation à la sortie pour QC (qualité). |

---

## 17. En une phrase

Le module KDS est **l'œil et l'oreille de la cuisine** de The Breakery : il transforme un envoi caisse en mission claire affichée sur l'écran de la bonne station selon la catégorie produit, gère chaque item avec son propre tempo via item_status, alerte avec un code couleur progressif et un son d'urgence quand le temps file, signale au comptoir quand tout est prêt, et s'insère dans l'architecture LAN avec fallback Realtime — pour que la cuisine soit toujours informée, jamais débordée par surprise, et que personne ne crie plus jamais "commande 124 pour la table 7 !" dans l'atelier.
