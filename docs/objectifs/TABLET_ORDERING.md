# Module Tablet Ordering — Objectif métier

> 🗄️ **ARCHIVED / SUPERSEDED (2026-06-04).** This legacy V2 "Objectif métier" brief was folded verbatim into **Partie I — Vue fonctionnelle** of the canonical reference module [`reference/04-modules/17-tablet-ordering.md`](../../reference/04-modules/17-tablet-ordering.md) (2026-05-13). The reference is the source of truth; this file is kept for history only.


> **Statut V2/V3** : décrit la vision business cible. **V2 jamais déployée**. Implémentation V3 = DONE + amélioré (`create_tablet_order_v2` + table `idempotency_keys` S25, `useCreateTabletOrder` v2 + client_uuid lifecycle, `useTabletOffline`, PIN auth, ACK hub). Voir [`../V2_V3_GLOSSARY.md`](../../V2_V3_GLOSSARY.md).
>
> **Périmètre fonctionnel** : ce document décrit **ce que le module Tablet Ordering (`/tablet`) sert à faire au quotidien** pour The Breakery,.

---

## 1. Raison d'être

Le module Tablet Ordering est **l'extension salle de la caisse** de The Breakery. Il répond à une question simple mais structurante quand on sert en salle :

> *"Comment je prends la commande de la table 7 sans devoir faire 4 allers-retours au comptoir avec un carnet papier, et comment je m'assure que la cuisine reçoit la commande au moment où je quitte la table — pas 5 minutes plus tard ?"*

C'est le module qui transforme **un serveur en salle** en **noyau mobile du POS** : il prend la commande directement à la table sur une tablette Android, l'envoie au comptoir caisse via LAN, le caissier valide, la cuisine reçoit, le client est servi. Le tout en quelques secondes au lieu de plusieurs minutes.

Le module est **délibérément simple** côté serveur :

- Pas d'encaissement à la table (le paiement reste au comptoir pour la sécurité cash).
- Pas de gestion de stock complexe.
- Pas de modifier complexe (ajouts simples uniquement).
- Pas de promotion manuelle (l'engine du POS s'en charge à la réception).

Le serveur **saisit** ; le caissier **encaisse** ; la cuisine **prépare**. Trois rôles, un flux.

---

## 2. Les 2 pages du module

| Page | Job-to-be-done |
|---|---|
| **TabletOrderPage** (`/tablet/order`) | Composer une commande à la table — sélection produits, table, envoi au comptoir |
| **TabletOrdersPage** (`/tablet/orders`) | Voir l'historique des commandes envoyées par cette tablette + leur statut (envoyée, payée, annulée) |

Le tout est englobé par **TabletLayout** qui gère l'authentification PIN, la connexion LAN client, et l'écoute des ACKs du hub POS.

---

## 3. Les 5 invariants du module

Quelle que soit la situation, le module garantit toujours :

1. **PIN d'authentification serveur**. Chaque commande est attribuée à un serveur nommé. PIN exigé à l'ouverture de session tablette + relock après inactivité.
2. **LAN client uniquement**. La tablette est un client LAN qui dialogue avec le hub POS. Aucune écriture directe en base — toujours via le hub pour cohérence.
3. **Envoi explicite obligatoire**. Une commande saisie n'arrive **pas** au comptoir tant que le serveur n'a pas tapé "Send to POS". Pas d'envoi auto.
4. **ACK du hub avant confirmation**. Le serveur ne voit "Order sent" qu'après réception de l'accusé du hub POS (canal `TABLET_ORDER_RECEIVED`). Sinon il sait que ça n'est pas passé.
5. **Pas de paiement à la table**. Le serveur ne touche jamais à l'encaissement. La caisse reste **le seul point de contact argent**.

---

## 4. Le PIN d'authentification — La porte serveur

À l'ouverture de la tablette, **PinVerificationModal** s'affiche en plein écran :

- Le serveur tape son PIN à 4 chiffres.
- Vérification via `auth-verify-pin` (Edge Function).
- En cas de succès → la tablette charge le nom du serveur + son ID dans la session.
- Une commande envoyée depuis cette tablette portera **automatiquement** le nom du serveur (`waiterName`, `waiterId`).

Comportement de relock :

- Auto-lock après N minutes d'inactivité (configurable).
- Lock manuel via bouton "Switch waiter" pour passer la tablette à un collègue.
- Pas de session persistante navigateur — quitter et revenir = re-PIN.

Bénéfice métier : **chaque commande est nominative**. Pour les tips, les performances staff, les éventuels litiges, on sait qui a pris la commande.

---

## 5. Le connecteur LAN — Le cordon ombilical

La tablette s'enregistre comme **client LAN** auprès du hub POS dès la connexion :

- `useLanClient` initialise la liaison.
- `deviceType: 'tablet'`, `deviceName: 'Tablet - Made'`.
- **Heartbeat** toutes les 30s → le hub sait que la tablette est en ligne.
- **Statut** affiché en permanence dans le header (Wifi icon vert = connecté, gris = déconnecté).

Si la liaison saute :

- La tablette tente une reconnexion automatique.
- L'envoi de commande est bloqué tant que LAN down.
- Le serveur voit l'alerte "Hors ligne — impossible d'envoyer" et sait qu'il doit attendre.

Bénéfice métier : **transparence sur la liaison**. Le serveur n'envoie jamais "dans le vide" — soit ça marche, soit l'app le dit clairement.

---

## 6. La prise de commande — `TabletOrderPage`

L'écran de saisie est volontairement **épuré et tactile** :

### 6.1 Layout

- **Sélecteur de table** en haut (table number ou nom client).
- **Grille produits** par catégorie, comme au POS mais simplifiée.
- **Cart latéral ou inférieur** selon orientation tablette.
- **Bouton "Send to POS"** en gros, accessible au pouce.

### 6.2 Fonctionnalités

- **Recherche produit** rapide.
- **Quantités** ajustables (+/−).
- **Modifiers basiques** (sucre, lait, sans X) — mais pas la totalité du modifier engine du POS.
- **Notes spéciales** par item (allergie, préparation).
- **Type de commande** : dine-in (défaut tablette), takeaway possible.
- **Stock indicator** : badge sur les produits en rupture.

### 6.3 Ce qui est *absent* volontairement

- Pas de remise / promotion manuelle.
- Pas de paiement.
- Pas de void d'une commande déjà envoyée (devient la responsabilité du caissier).
- Pas de modifier complexes type combo (combo → renvoyer au comptoir).

Bénéfice métier : **simplicité radicale**. Un serveur saisit une commande complète en 30 secondes — sans menu déroulant, sans dialog secondaire.

---

## 7. L'envoi au POS — Le moment de bascule

Bouton **"Send to POS"** → la commande quitte la tablette :

1. Construction du payload (items, modifiers, notes, table, waiter, total estimatif).
2. Envoi via `lanClient.send(LAN_MESSAGE_TYPES.TABLET_ORDER)` au hub.
3. Le hub POS :
   - Reçoit la commande, l'ajoute au `tabletOrderStore` côté caisse.
   - Notifie le caissier via `TabletOrdersPanel` (modal POS).
   - Renvoie un ACK `TABLET_ORDER_RECEIVED` avec status `'received'`.
4. La tablette reçoit l'ACK → toast "Order sent successfully".
5. Le cart se vide → prêt pour la prochaine table.

Si erreur :

- Le hub renvoie `status: 'error'` avec un message.
- Toast d'erreur côté tablette.
- Le cart **n'est pas vidé** — le serveur peut corriger et retenter.

Bénéfice métier : **garantie de réception**. Pas de commande perdue dans le tuyau — l'ACK est la confirmation explicite.

L'envoi est aussi un **point de non-retour par ligne** : une fois la commande
tirée en cuisine côté POS, ses lignes sont verrouillées (ADR-010) — toute
annulation ou réduction passe alors par le flux manager du POS (PIN + perte
obligatoire), jamais par la tablette.

---

## 8. Du côté du POS — La réception

Quand une commande tablette arrive au comptoir, le caissier en est notifié dans **`TabletOrdersPanel`** :

- Badge avec compteur d'unread.
- Liste des commandes reçues : table, serveur, items, montant estimatif, heure de réception.
- Trois actions par commande :
  - **Accept** → la commande passe dans le cart POS du caissier qui peut la finaliser (encaisser ou la basculer en ardoise).
  - **Reject** → la commande est annulée, message renvoyé au serveur.
  - **Hold** → en attente d'une décision.

Pendant cette phase, la commande est en statut `pending_payment` côté tablet store. Une fois encaissée au POS, le hub renvoie un message à la tablette → la commande passe en `paid`.

Bénéfice métier : **fluidité du flux salle-caisse**. La caisse maîtrise quand traiter une commande tablette ; le serveur en salle voit en direct quand elle est validée.

---

## 9. Suivi des commandes — `TabletOrdersPage`

Page accessible depuis le menu tablette : la **liste des commandes envoyées** depuis cette tablette ce jour.

Affiche pour chaque commande :

- Numéro, table, items résumés, total.
- Heure d'envoi.
- Statut : `pending_payment` (en attente caisse), `paid` (validée), `cancelled` (rejetée).
- Badge coloré (orange / vert / rouge).

Limites :

- Historique limité à **50 dernières commandes** (`MAX_INCOMING_ORDERS`).
- Pas de drill-down détaillé (la fiche commande complète reste côté POS).
- Pas d'export.

Bénéfice métier : **mémoire courte mais suffisante** pour le service en cours. Un serveur qui sert 30 tables en service voit toutes ses commandes du jour.

---

## 10. Sécurité et permissions

Le module hérite des règles globales :

- **Permission `tablet.use`** (ou équivalent) — non documentée séparément, héritée de la session POS.
- **Toutes les commandes tracées** côté audit (qui a saisi quoi à quelle heure).
- **PIN serveur obligatoire** — pas d'usage anonyme.
- **PIN manager** requis pour des actions sensibles (mais peu de telles actions existent côté tablette par design).

Pas de permission d'écriture directe en base — toute action passe par le hub POS qui valide les permissions du caissier qui traite.

Bénéfice métier : **sécurité cohérente avec le POS**. La tablette n'ouvre pas de nouvelle surface de fraude — elle reste un client soumis au contrôle central.

---

## 11. Mécaniques transverses — Comment le module dialogue avec le reste

| Module | Relation |
|---|---|
| **POS** | Récepteur des commandes tablette via `TabletOrdersPanel` et `useTabletOrderReceiver`. |
| **Products** | Catalogue partagé (lecture seule). |
| **LAN** | Client LAN avec heartbeat, fallback Realtime non implémenté (cf. backlog). |
| **Customers** | Possibilité de lier un client à la commande tablette (recherche simple). |
| **KDS** | Indirect — la commande tablette accepted au POS suit le flux normal (envoi cuisine, statuts). |
| **Settings** | Pas de réglage dédié pour l'instant — `POS Configuration` couvre indirectement. |

---

## 12. Ce que le module ne fait **pas** (par design)

- La tablette **ne fait pas de paiement**. Choix de sécurité — l'argent reste au comptoir.
- La tablette **ne supporte pas le modifier engine complet** du POS. Modifiers basiques uniquement.
- La tablette **ne crée pas de client**. Pour ajouter un nouveau client, le serveur passe par le caissier.
- La tablette **ne gère pas les combos avec sélection multi-groupes**. Un combo nécessite le `ComboSelectorModal` du POS — la tablette renvoie au comptoir.
- La tablette **ne supporte pas l'offline complet**. Si LAN down, envoi bloqué. Pas de queue locale.
- La tablette **ne déclenche pas l'envoi cuisine elle-même**. C'est le caissier qui décide quand envoyer en cuisine (souvent à l'acceptation).
- La tablette **ne consulte pas le KDS** ni les stocks détaillés — juste l'indicateur "rupture" sur les produits.
- La tablette **ne modifie jamais une commande déjà envoyée**. Son panier est
  local et pré-envoi ; après "Send to POS", corriger une ligne partie en
  cuisine est un geste manager au POS (verrou ADR-010 : PIN + déclaration de
  perte). La tablette n'a ni le droit ni les écrans pour le faire.

---

## 13. Ce que le module doit (encore) faire — backlog métier

| Priorité | Évolution | Bénéfice attendu |
|---|---|---|
| 🔴 | **Queue offline avec sync** | Saisir la commande même sans LAN, envoyer dès la reconnexion (couvre les coupures courtes). |
| 🔴 | **Auto-send à la cuisine optionnel** | Toggle "Envoyer directement en cuisine" pour le service rapide — bypass de l'acceptation caissier sur certains cas. |
| 🟠 | **Modifier engine complet** | Supporter tous les modifiers du POS pour ne pas refuser certaines configurations en salle. |
| 🟠 | **Combos sélectionnables** | Composer un combo depuis la tablette (sélection des groupes). |
| 🟠 | **Création de client à la table** | Saisir un nouveau client (nom, téléphone) directement depuis la tablette pour la fidélité. |
| 🟡 | **Pre-bill à la table** | Imprimer une note de table sans encaissement, pour que le client voie son addition. |
| 🟡 | **Notifications push KDS → tablet** | Le serveur reçoit "Table 7 ready" sur sa tablette sans avoir à regarder le KDS. |
| 🟢 | **Photos de plats** | Affichage de photos haute qualité pour l'aide à la suggestion au client. |
| 🟢 | **Mode "menu client"** | Donner la tablette directement au client pour qu'il sélectionne lui-même (style fast-casual). |

---

## 14. En une phrase

Le module Tablet Ordering est **l'extension salle du POS** de The Breakery : il transforme un serveur en noyau mobile de prise de commande en lui donnant une tablette PIN-authentifiée, connectée en LAN client au hub POS, capable d'envoyer une commande complète en moins de 30 secondes avec ACK du caissier — sans toucher au cash, sans risque de commande perdue, sans devoir faire l'aller-retour au comptoir — pour que le service en salle gagne le tempo qu'il perd dans les boulangeries qui prennent encore les commandes au carnet papier.
