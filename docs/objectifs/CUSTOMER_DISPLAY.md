# Module Customer Display — Objectif métier

> 🗄️ **ARCHIVED / SUPERSEDED (2026-06-04).** This legacy V2 "Objectif métier" brief was folded verbatim into **Partie I — Vue fonctionnelle** of the canonical reference module [`reference/04-modules/16-display-customer.md`](../../reference/04-modules/16-display-customer.md) (2026-05-13). The reference is the source of truth; this file is kept for history only.


> **Statut V2/V3** : décrit la vision business cible. **V2 jamais déployée**. Implémentation V3 = PARTIELLE (feature `apps/pos/src/features/display` existe — à vérifier en détail : table `display_promotions`, animations fidélité, ORDER_READY notification KDS). Voir [`../V2_V3_GLOSSARY.md`](../../V2_V3_GLOSSARY.md).
>
> **Périmètre fonctionnel** : ce document décrit **ce que le module Customer Display (`/display`) sert à faire au quotidien** pour The Breakery

---

## 1. Raison d'être

Le module Customer Display est **le second écran face client** de The Breakery. Il répond à une question simple mais déterminante pour la confiance et l'engagement :

> *"Comment je rends transparent ce que le caissier saisit à la caisse, comment je valorise les promotions et les points fidélité gagnés en direct, et comment je rends utile l'écran orienté client même quand personne n'achète, pendant la pause de 14h à 15h ?"*

C'est l'écran qui transforme **un client devant la caisse** en **client informé, rassuré et engagé** : il voit son panier se construire en direct, voit la remise s'appliquer quand une promo se déclenche, voit ses points fidélité monter, voit le total final avant de payer, voit son ticket arriver à la cuisine, et — quand il n'y a personne à encaisser — voit les promos du moment défiler.

Le module a **deux modes** complémentaires :

- **Active** — un client est en train de commander → afficher son panier en direct.
- **Idle** — personne n'est en cours d'encaissement → afficher promotions, logo, ambiance.

Le tout sans la moindre interaction de la part du client — l'écran est **purement informationnel et marketing**, jamais tactile.

---

## 2. Les 2 vues du module

| Vue | Quand | Quoi |
|---|---|---|
| **CDActiveCartView** | Pendant une commande en cours | Cart live, totaux, remises, points fidélité gagnés, statut envoi cuisine |
| **CDIdleView** | Aucune activité caisse | Logo The Breakery, promos rotatives, message d'accueil, ambiance visuelle |

La bascule entre les deux est **automatique** : dès que le caissier met un produit au panier, l'écran passe en mode Active ; après N secondes sans activité, il retourne en Idle.

---

## 3. Les 5 invariants du module

Quel que soit le mode, le module garantit :

1. **Aucune interaction tactile**. L'écran est purement passif. Pas de bouton, pas de clic. Le client regarde, il ne touche pas.
2. **Synchro temps réel avec le POS**. Chaque ajout / retrait au cart caisse se reflète sur l'écran client en <500 ms via LAN BroadcastChannel.
3. **Idle = utile**. L'idle screen n'est jamais "vide" : promos qui défilent, logo, messages d'accueil — l'écran continue à travailler pour la boutique.
4. **Économie d'énergie après 30 min idle**. Le screen se dim automatiquement → préservation de l'écran physique et de l'attention client (rien ne clignote inutilement).
5. **Configurable côté Settings**. Durées idle, rotation promos, sons, etc. ne sont pas codés en dur — le gérant ajuste depuis Settings → Display.

---

## 4. Le mode Active — `CDActiveCartView`

Activé dès qu'un item entre dans le cart caisse.

### 4.1 Ce que voit le client

- **Logo The Breakery** en en-tête (toujours visible — branding constant).
- **Liste des items** au fur et à mesure de leur ajout :
  - Nom du produit, quantité, prix unitaire, prix total ligne.
  - Modificateurs en sous-ligne ("Sucre +", "Sans lait").
  - Mise en valeur du dernier item ajouté (highlight 2 secondes).
- **Remises appliquées** :
  - Promo déclenchée → ligne dédiée avec nom et montant.
  - Animation visuelle subtile (la remise apparaît, le total baisse).
- **Sous-total / Taxe PB1 / Total** affichés en gros.
- **Si client lié** : nom du client, palier fidélité, **points gagnés en direct** ("+45 points pour cette commande").

### 4.2 Pendant le paiement

- **Méthode de paiement** affichée (Cash / Card / QRIS…).
- Pour cash : **montant reçu et monnaie à rendre** affichés en grand caractère (utile au client pour vérifier).
- Pour digital : **QR code de paiement** (futur — backlog).

### 4.3 À la finalisation

- **Message de confirmation** "Order Confirmed".
- **Numéro de commande** affiché en gros.
- **Estimation du temps** si dine-in.
- Bascule automatique en Idle après quelques secondes.

Bénéfice métier : **la transparence transformée en confiance**. Le client voit que rien n'est dissimulé, voit la valeur du programme fidélité (points qui montent), et part avec son numéro de commande visuellement validé.

---

## 5. Le mode Idle — `CDIdleView`

Activé quand aucune activité caisse n'est détectée pendant le `idleTimeoutSeconds` configurable (typiquement 60s).

### 5.1 Contenu

- **Logo The Breakery** dominant.
- **Promos rotatives** : carrousel des promotions actives (`display_promotions` table) :
  - Image, titre, description courte, période de validité visible.
  - Rotation toutes les `promoRotationIntervalSeconds` (typiquement 8-15s).
  - Fade in/out doux pour ne pas agresser l'œil.
- **Message d'accueil** : "Welcome to The Breakery — Try our signature croissant".
- **Horaires d'ouverture** discrets en bas.
- **QR code wifi guest** ou QR code Instagram (futur).

### 5.2 Gestion de l'attention

- Animations **lentes et apaisées** — l'objectif est de séduire, pas de distraire.
- **Pas de son** en mode Idle (sauf cas spécial cf. §6).
- **Dim automatique après 30 min** d'inactivité totale (la boutique est fermée ou en pause) — protège l'écran et réduit la consommation.

Bénéfice métier : **l'écran continue à vendre quand personne ne commande**. Pendant le creux de 14h-15h, les passants voient les promos du soir et reviennent peut-être.

---

## 6. Notifications d'ordres prêts — Le pont avec le KDS

Spécificité plus avancée : le Customer Display peut afficher les **commandes prêtes** quand le client attend en salle.

### 6.1 Mécanique

- Quand le KDS marque une commande `all ready`, le hub POS broadcaste un message `ORDER_READY` au Customer Display.
- L'écran affiche : "Order #124 — Ready" en grand caractère pendant N secondes.
- Bip sonore optionnel (configurable).
- Animation d'apparition.

### 6.2 Usage typique

- Le client a commandé pour emporter, paye et attend à sa table.
- Quand sa commande sort, l'écran le notifie sans qu'il ait à demander.
- Réduit la pression sur le caissier qui n'a plus à crier "Numéro 124 !".

Bénéfice métier : **scaler le service sans staff supplémentaire**. Un écran fait le travail d'un crieur — et c'est plus discret + plus stylé pour la marque.

---

## 7. Le canal LAN — Le cordon avec le POS

Le Customer Display est un **client LAN** qui écoute le hub POS :

| Message reçu | Effet |
|---|---|
| `CART_UPDATE` | Mise à jour du panier affiché (ajout / retrait / modif quantité) |
| `CART_CLEAR` | Vidage du panier → bascule en Idle après timeout |
| `ORDER_READY` | Affichage de la notification "ready" + son optionnel |
| `PROMOTION_UPDATE` | Recharge la liste des promos affichées en idle |
| `CONFIG_UPDATE` | Recharge les réglages (idle timeout, etc.) |

Le display **ne renvoie rien** au hub — c'est une communication strictement descendante. Pas d'écriture en base, pas de mutation.

Si la liaison LAN saute :

- L'écran reste sur le dernier état connu.
- Indicateur visuel discret de déconnexion (point gris en coin).
- Auto-reconnexion en arrière-plan.

Bénéfice métier : **client jamais visible**. Une coupure réseau ne casse pas l'écran — il continue à afficher quelque chose de cohérent.

---

## 8. Configuration — Settings → Display

Réglages disponibles :

| Réglage | Effet |
|---|---|
| **Idle timeout** | Combien de secondes d'inactivité avant bascule en mode Idle (défaut 60s) |
| **Promo rotation interval** | Combien de secondes entre deux promos (défaut 10s) |
| **Show ready orders** | Activer / désactiver l'affichage des commandes prêtes |
| **Sound on ready** | Bip sonore quand une commande est prête |
| **Welcome message** | Texte d'accueil personnalisé |
| **Show wifi QR** | Afficher un QR code wifi guest en idle |
| **Show fidélité animation** | Activer / désactiver l'animation de points en direct |
| **Theme** | Clair / sombre / auto |

Toutes ces valeurs sont propagées par `CONFIG_UPDATE` sans devoir redémarrer l'écran.

Bénéfice métier : **chaque boutique a sa personnalité**. The Breakery dark mode avec animation points = signature visuelle distincte.

---

## 9. Les promotions affichées — La table `display_promotions`

Les promotions affichées en mode Idle viennent d'une **table dédiée** distincte des promotions transactionnelles :

- **Titre + description**.
- **Image** (uploadée dans Supabase Storage).
- **Période d'affichage** (date début, date fin).
- **Ordre de rotation**.
- **Statut actif**.
- **Catégorie de promo** (Saison, Nouveauté, Événement, Fidélité).

Le gérant gère cette table depuis Settings → Display → Promotions (ou un éditeur dédié).

Distinction importante : ces promos sont **purement marketing visuel**. Elles ne déclenchent pas de remise. La remise réelle est dans le module Promotions & Combos. Le Customer Display **promeut** ; le moteur **applique**.

Bénéfice métier : **séparation marketing / opérationnel**. On peut afficher "−15 % le mercredi sur les viennoiseries" en visuel marketing dans Idle, ET avoir la promo correspondante configurée dans Promotions qui s'applique automatiquement à la caisse. Mais on peut aussi afficher "Nouveauté — Cookie au chocolat blanc" sans qu'il y ait de promo réelle dessous.

---

## 10. Le `displayStore` — La mémoire locale

Côté technique métier, le `displayStore` (Zustand) maintient l'état local de l'écran :

- `cart` : le cart courant (ou null si idle).
- `isIdle` : true / false.
- `orderQueue` : liste des commandes en cours.
- `readyOrders` : commandes marquées ready récemment.
- `currentPromoIndex` : index dans la rotation de promos.
- `connected` : statut de connexion LAN.

L'écran est entièrement **piloté par cet état** — pas de fetch direct, pas d'écriture. Sa robustesse vient de cette simplicité.

---

## 11. Mécaniques transverses — Comment le module dialogue avec le reste

| Module | Relation |
|---|---|
| **POS** | Source des `CART_UPDATE` via `useDisplayBroadcast`. |
| **KDS** | Source des `ORDER_READY` quand commande all ready. |
| **Promotions** | Affichage marketing des `display_promotions` (table distincte des promos transactionnelles). |
| **Customers** | Affichage du nom + palier fidélité quand un client est lié au cart. |
| **Settings** | Configuration centralisée dans Settings → Display. |
| **LAN** | Client LAN sans écriture (réception uniquement). |
| **Branding** | `BreakeryLogo` et styles (`customerDisplayStyles`) cohérents avec la signature visuelle The Breakery. |

---

## 12. Ce que le module ne fait **pas** (par design)

- L'écran **n'est pas tactile**. Aucune interaction client. C'est un écran de **diffusion**, pas un kiosk.
- L'écran **ne saisit aucune donnée**. Pas de "tapez votre numéro de téléphone pour la fidélité".
- L'écran **ne pré-commande pas**. C'est le rôle de TabletOrdering ou du POS, pas du display.
- L'écran **ne paie pas**. Pas de NFC, pas de QR de paiement (encore — backlog).
- L'écran **ne joue pas de vidéos** (uniquement images statiques pour les promos).
- L'écran **ne fait pas d'analytics** sur les clients (eye tracking, comptage de regards) — pas d'IoT vision.
- L'écran **ne supporte pas l'offline complet** — coupure LAN = écran figé sur dernier état (acceptable car non transactionnel).

---

## 13. Ce que le module doit (encore) faire — backlog métier

| Priorité | Évolution | Bénéfice attendu |
|---|---|---|
| 🔴 | **QR de paiement digital affiché** | Pour QRIS / e-wallets, afficher le QR code de paiement directement sur le display au moment du paiement → le client scanne avec son téléphone. |
| 🔴 | **Affichage "commande prête" enrichi** | Numéro + nom client (si lié) + table → vue style "tableau d'aéroport" pour les commandes en attente. |
| 🟠 | **Vidéos courtes en idle** | Diffuser de courtes vidéos (15s loop) plutôt que des images statiques pour les promos premium. |
| 🟠 | **Animations programme fidélité** | Lors du gain de points, animation visuelle marquante ("Vous gagnez 45 points pour atteindre Silver dans 200 points !"). |
| 🟠 | **Multilingue affichage** | Bascule auto FR/EN/ID selon préférence shop / horaires. |
| 🟡 | **Météo et heure** | Affichage discret de l'heure + météo locale en idle. |
| 🟡 | **Compteur de visiteurs** | "Notre 10 000ᵉ client cette année !" — gamification douce. |
| 🟢 | **A/B testing visuel** | Tester deux variantes d'affichage d'une promo et mesurer l'impact ventes. |
| 🟢 | **Mode "vitrine externe"** | Si un écran est placé en vitrine côté rue, mode adapté qui ne dévoile pas le cart courant mais montre les promos en grand. |

---

## 14. En une phrase

Le module Customer Display est **le second écran face client** de The Breakery : il transforme un client devant la caisse en client informé en lui montrant son panier se construire en direct, voit la remise s'appliquer et ses points fidélité monter en temps réel, devient un panneau publicitaire animé pendant les creux d'activité, signale les commandes prêtes pour soulager le caissier, se dim automatiquement après 30 min d'inactivité — et tout cela sans qu'il ait jamais besoin d'être touché, en se contentant d'écouter le hub POS via LAN BroadcastChannel.
