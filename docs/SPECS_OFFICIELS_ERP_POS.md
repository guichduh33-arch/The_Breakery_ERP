# Spécifications officielles — ERP / POS The Breakery

> **Source unique de vérité fonctionnelle.** Établie le **2026-11-09** à partir
> de l'audit intégral (`docs/audit-2026-11/`) et des 44 arbitrages rendus par
> Mamat.
>
> Ce fichier remplace les 20 fiches de `docs/objectifs/`, `docs/product/` et les
> rapports d'audit antérieurs, tous déplacés dans `docs/_archive_obsolete/`.
>
> **Hiérarchie de vérité inchangée.** `AGENTS.md` reste la loi du dépôt. Les
> décisions arbitrées vivent dans `docs/adr/` et y restent **immuables**. Ce
> fichier décrit *ce qui est* et *ce qui a été décidé* ; il ne remplace ni l'un
> ni l'autre. En cas de conflit : le code et le schéma établissent les faits,
> `docs/adr/` les décisions, ce fichier la synthèse.

## Comment lire ce document

Chaque énoncé porte une marque. **Ne jamais écrire de code sur un énoncé non
marqué.**

| Marque | Signification |
|---|---|
| **FAIT** | Vérifié en production le 2026-11-09, sur le corps live des fonctions ou par comptage. Opposable. |
| **RÈGLE** | Règle métier décidée par Mamat. Opposable, même si le code ne la respecte pas encore. |
| **À LIVRER** | Décidé, pas encore codé. Le détail et l'ordre sont dans `audit-2026-11/05_MASTER_PLAN_FINITION.md`. |
| **ABANDONNÉ** | Explicitement écarté. Ne pas rouvrir sans nouvel arbitrage. |
| **OUVERT** | Pas encore tranché. Ne pas deviner. |

---

## 1. Le produit

**FAIT** — Un ERP et un point de vente pour une boulangerie artisanale unique, à
Lombok (Indonésie). Monnaie IDR. Fuseau métier `Asia/Makassar` (UTC+8), posé
comme **constante de déploiement** au niveau de la base (ADR-019), pas comme un
réglage.

**FAIT** — Trois applications et quatre paquets partagés :

| Surface | Rôle | Hébergement |
|---|---|---|
| `apps/pos` | Caisse, écran cuisine, écran client, tablette de salle | LAN, servi par le PC boutique |
| `apps/backoffice` | Gestion, comptabilité, rapports | Vercel, `backoffice.the-breakery.com` |
| `apps/print-bridge` | Pont d'impression thermique, hub réseau local, serveur du bundle POS | PC boutique |

**FAIT** — Le POS n'est **jamais** publié sur Vercel (ADR-030, ADR-033). Un
fichier `apps/pos/vercel.json` existe mais aucun projet Vercel POS n'existe.

**FAIT** — L'interface parle **anglais**, les commentaires et la documentation
parlent **français**. Vérifié : zéro libellé français dans le JSX du
back-office. Aucune bibliothèque d'internationalisation, aucune garde CI sur la
langue.

---

## 2. Environnements

**FAIT** — Cibles Supabase :

| Environnement | Référence | État |
|---|---|---|
| Production V3 | `yjhhhmjgsmyzyymvixot` | En service depuis le **2026-10-29** |
| Dev V3 | `ikcyvlovptebroadgtvd` | Cible de tout travail de schéma |
| Répétition V3 | `getctmbpjnrrjzncaqze` | Disponibilité à recontrôler |
| Ancienne V2 | `abjabuniwkqpfsenxljp` | Historique, lignée incompatible |

**FAIT** — Production : 133 tables, **RLS activée sur les 133**, 286 policies,
491 fonctions applicatives dont 445 `SECURITY DEFINER`. 17 Edge Functions
déployées sur 19 présentes au dépôt.

**FAIT** — La production **n'a pas été construite par la lignée de migrations** :
elle vient d'un dump de schéma en 16 parties (candidat `aa7b34ed`, 2026-10-06)
puis de 21 paquets de livraison. Son journal ne compte que **37 entrées** pour
1 240 fichiers de migration au dépôt. **Savoir « quelle migration est appliquée
en production » n'a de réponse qu'au niveau du paquet, pas du fichier.**

**FAIT** — Aucune tâche planifiée en production (`cron.job` vide), alors que la
base de dev en porte 9. Conséquences : deux vues matérialisées jamais peuplées,
aucune purge du rate-limit, aucune sauvegarde autonome, aucun envoi de
notification.

---

## 3. Activité réelle

**FAIT** — Du 2026-10-29 au 2026-11-08 : **110 à 140 commandes par jour**, **12
à 18 M IDR par jour**. Le 2026-11-02 n'enregistre que 3 commandes pour 570 000
IDR — **OUVERT** : fermeture de boutique ou panne de caisse, à confirmer.

**FAIT** — Volumétrie au 2026-11-09 :

| Objet | Nombre |
|---|---|
| Commandes | 5 033 (dont 4 171 issues de la reprise historique d'octobre) |
| Lignes de commande | 12 462 |
| Lignes de paiement | 4 716 |
| Écritures comptables | 11 855 en-têtes, 28 863 lignes, **0 déséquilibrée** |
| Mouvements de stock | 7 682 |
| Journal d'audit | 21 172 |
| Produits | 379, dont **249 suivis en stock** |
| Recettes | 809 lignes de nomenclature, 3 952 versions figées |
| Fournées | 495 unitaires, 282 lots groupés |
| Clients | 43, dont **21 en B2B** |
| Comptes utilisateurs | 11, tous actifs |

**FAIT** — Moyens de paiement réellement utilisés :

| Moyen | Opérations | Montant |
|---|---|---|
| EDC (terminal bancaire) | 1 994 | 254 611 000 IDR |
| Espèces | 1 672 | 160 192 000 IDR |
| QRIS | 1 019 | 149 338 000 IDR |
| Virement | 30 | 6 882 000 IDR |
| Carte | 1 | 55 000 IDR |

---

## 4. Configuration métier en vigueur

**FAIT** — Contenu réel de `business_config` (un seul enregistrement) :

| Réglage | Valeur | Commentaire |
|---|---|---|
| `tax_rate` | `0.1000` | PB1 à 10 % |
| `tax_inclusive` | `true` | **La taxe est incluse dans le prix affiché** |
| `timezone` | `Asia/Makassar` | Miroir ; l'autorité est le paramètre de session |
| `currency` | `IDR` | |
| `allow_negative_stock` | **`true`** | Le stock négatif est autorisé à la vente |
| `offline_payments_enabled` | **`false`** | **Toute la machinerie hors ligne est éteinte** |
| `enabled_payment_methods` | `cash, card, qris, edc, transfer` | GoPay, OVO et DANA existent dans le code et sont **désactivés** |
| `shift_variance_threshold_abs` / `_pct` | 50 000 IDR / 0,5 % | Seuil d'écart de caisse signalé |
| `shift_variance_pin_threshold_abs` / `_pct` | 200 000 IDR / 2 % | Au-delà, PIN manager exigé |
| `shift_denomination_count_enabled` | `false` | Comptage par coupure désactivé |
| `pin_max_failed` / `pin_lockout_minutes` | 5 / 15 | |
| `store_credit_expiry_months` | `0` | Les avoirs n'expirent jamais |
| `pos_opening_cash_presets` | `[500000]` | |
| `pos_quick_payment_amounts` | 25 000 → 250 000 | |
| `pos_discount_presets` | 5, 10, 15, 20, 25 % | |
| `display_showcase_product_ids` | **`[]`** | **La vitrine de l'écran client est vide** |
| `display_show_ready_orders` | `false` | |
| `kds_warning` / `urgent` / `auto_archive` | 5 / 10 / 5 minutes | Réglages **globaux**, pas par poste |
| `npwp`, `fiscal_address`, `phone`, `logo_url`, `alert_email` | **vides** | Les factures B2B n'ont aucune identité fiscale |
| `payment_method_fees` | `{}` | |
| `business_hours` | `{}` | |

**FAIT** — Deux seuils métier existent en base **hors** du dictionnaire de
réglages, donc non modifiables depuis l'interface :
`production_yield_variance_threshold_pct` = 0,15 et
`retail_tab_credit_limit_default` = 300 000 IDR.

---

## 5. Droits d'accès

### 5.1 Les rôles réels

**FAIT** — La matrice de droits est de la **donnée**, éditable à chaud par le
propriétaire (ADR-031, ADR-032). 162 permissions au catalogue, 301 attributions.

| Rôle | Système | Permissions | Comptes | Créé le |
|---|---|---|---|---|
| `SUPER_ADMIN` | oui | 162 | mamat | 2026-10-06 |
| `ADMIN` | oui | 59 | Annisa, Riyanti, test | 2026-10-06 |
| `office` | non | 42 | **aucun** | 2026-11-06 |
| `CASHIER` | oui | 26 | Agus, Bambang, Enti ajah | 2026-10-06 |
| `Waiter` | non | 12 | Aini, Gafar, Jaka, Pito | 2026-10-25 |
| `MANAGER` | oui | **0** | **aucun** | 2026-10-06 |

**FAIT** — `MANAGER` est un rôle vide et inutilisé. `office` a été créé le
2026-11-06 et n'a aucun compte. Le compte `test` (ADMIN, 59 permissions) est
**assumé par Mamat**. Aucun compte de démonstration du dépôt n'est présent en
production.

**FAIT** — `Waiter` porte 12 permissions : lecture du catalogue, des clients, des
tables, de la vitrine et des appareils LAN, plus `sales.create`,
`pos.session.open` et `pos.session.close_own`. **Il ne peut pas encaisser** (pas
de `payments.process`).

**FAIT** — `CASHIER` porte `b2b.order.create` et `display.manage`.

### 5.2 Visibilité du stock et des comptes

**FAIT** — Aujourd'hui, `is_business_owner_v1()` ne reconnaît que
`role_code = 'SUPER_ADMIN'`, donc **un seul compte**. **37 fonctions** l'exigent
(tous les états de stock, l'inventaire, le bilan, le résultat, la balance, le
grand livre, la PB1, la marge) et **7 policies restrictives** passent par la même
porte (`stock_movements`, `display_stock`, `display_movements`, `audit_logs`,
`pos_events`, `z_reports`, `notification_outbox`).

**FAIT** — Les 3 comptes `ADMIN` **détiennent** `inventory.read`,
`reports.financial.read` et `reports.export` : ces permissions sont des lettres
mortes, la fonction les refuse.

**RÈGLE** — La visibilité du stock et des états financiers doit se piloter **par
permission**, pas par rôle codé en dur, pour redevenir déléguable depuis
l'écran RBAC.
**À LIVRER** — Remplacer le contrôle de rôle par `reports.inventory.read` et
`reports.financial.read` dans les 37 fonctions et les 7 policies.

### 5.3 Authentification

**FAIT** — PIN à **6 chiffres**, non réglable. Verrouillage après **5** échecs
pendant **15** minutes, tous deux réglables. Hachage bcrypt.

**FAIT** — L'Edge Function `auth-verify-pin` émet un jeton HS256 d'une heure,
injecté par un *fetch wrapper* dans `packages/supabase`. Jamais de
`auth.setSession`, jamais d'en-tête `Authorization` brut sur le client.

**FAIT** — Les permissions sont figées dans l'écran **jusqu'au prochain
rechargement d'onglet**. Côté serveur, `has_permission` est une lecture vivante :
**un retrait de droit prend effet immédiatement** sur toute opération gatée. Un
bouton peut donc rester affiché alors que le serveur refuse.

**FAIT** — `has_permission` vérifie que le profil n'est pas supprimé, mais **pas
qu'il est actif**.
**RÈGLE** — Désactiver un compte doit couper ses droits immédiatement.
**À LIVRER** — Ajouter le contrôle d'activité et révoquer les sessions à la
désactivation.

**ABANDONNÉ** — L'expiration automatique des PIN. Trois documents l'annonçaient
« déjà implémentée », dont l'ADR-006 : c'est faux et ce n'est pas voulu. La
désactivation de compte suffit, dès que la règle ci-dessus est livrée.

**FAIT** — Aucune connexion par e-mail et mot de passe n'existe. Les comptes
`auth.users` portent un mot de passe volontairement inutilisable. Une panne de
`auth-verify-pin` ferme les deux applications à tout le monde. **OUVERT** : faut-il
un chemin de secours pour les comptes ADMIN et plus.

---

## 6. Caisse et vente

### 6.1 Le chemin de l'argent

**FAIT** — Une vente neuve passe **toujours** par l'Edge Function
`process-payment`, qui appelle côté serveur la fonction de paiement courante. Le
POS n'appelle jamais cette fonction directement.

**FAIT** — Trois fonctions de money-path sont en revanche appelées **en direct**
depuis le navigateur, avec compensation documentée dans le code : le règlement
d'une commande existante, le report d'une commande en ardoise, et le règlement
d'une ardoise. Chacune porte sa clé d'idempotence. La règle d'`AGENTS.md` qui dit
« le POS n'appelle jamais la RPC directement » vise la **création** de vente.

**FAIT** — Ordre d'application des prix et remises, côté serveur, autorité unique :

1. Prix unitaire de base — ligne cadeau à 0, ligne de combo au prix du combo,
   sinon prix négocié du client, puis prix de sa catégorie, puis prix public.
2. Ajustements de modificateurs, relus serveur. Le montant envoyé par la caisse
   est ignoré. Une option inconnue fait refuser la vente.
3. Pour un combo : le prix est **écrasé** par le prix du combo plus les
   surcharges d'options plus les ajustements des modificateurs de composants
   (ADR-017).
4. Sous-total de ligne, arrondi à la centaine **après** empilement.
5. Moins la remise de ligne — **montant libre envoyé par la caisse**.
6. Moins les promotions, chacune revalidée serveur et dont le montant doit être
   **strictement égal** à celui calculé par le serveur.
7. Moins le rachat de points (1 point = 10 IDR, par multiples de 100 points).
8. Moins la remise de commande — **montant libre envoyé par la caisse**.
9. Toute remise, de ligne ou de commande, exige un jeton d'autorisation à usage
   unique émis par Edge Function après vérification du PIN manager, et la
   permission `sales.discount` sur l'autorisateur.
10. Gardes étagées : total après promotions ≥ 0, rachat ≤ total après
    promotions, total ≥ 0.
11. Extraction de la PB1 (taxe incluse).
12. Points gagnés = partie entière de (total × multiplicateur / 1000), calculé
    **après** toutes les remises et après extraction de la taxe.

**RÈGLE** — La remise de ligne doit être **plafonnée au sous-total serveur de la
ligne** concernée.
**À LIVRER** — Ajouter ce plafond.

**RÈGLE** — Le contrôle par PIN d'une remise est **systématique**, jamais
au-delà d'un seuil.

**FAIT** — Le PIN manager reste en mémoire après un paiement **échoué** : il
n'est effacé qu'au succès. Exposition mémoire seulement, jamais persistée.

### 6.2 Statuts de commande

**FAIT** — Les seuls statuts existants sont `draft`, `paid`, `voided`,
`pending_payment`, `completed`, `b2b_pending`. **Il n'existe ni `unpaid`, ni
`preparing`, ni `ready`, ni `refunded`** — ces trois derniers ont été tués par
l'ADR-025.

**FAIT** — Une ardoise est un `pending_payment` porteur de `outstanding_at`. Au
2026-11-09 : **6 ardoises ouvertes, 769 000 IDR**, la plus ancienne du
2026-11-03.

**FAIT** — Types de commande : `dine_in`, `take_out`, `delivery`, `b2b`.

**FAIT** — Deux commandes sont en `draft` alors qu'elles sont **déjà parties en
cuisine et numérotées** : la reprise d'une commande de tablette remet le statut à
`draft`, ce que l'ADR-022 réserve à ce qui ne doit pas exister en base.
**OUVERT** — Conserver `pending_byment` à la reprise : recommandé, non tranché.

### 6.3 Sessions de caisse

**FAIT** — Statuts `open` et `closed` uniquement. Il n'existe **aucun** état de
recomptage. Une session par **utilisateur** (pas par terminal). Le terminal est
facultatif : 6 sessions sur 22 n'en portent aucun.

**FAIT** — La clôture enregistre le comptage, l'attendu, l'écart, le comptage
carte et QRIS, les coupures et l'approbateur d'écart. Elle **n'enregistre ni les
totaux par moyen de paiement, ni le chiffre d'affaires, ni le nombre de
commandes**.

**FAIT** — 22 sessions, **2 à cheval sur plusieurs jours**, la plus longue de
**75 heures**.

**RÈGLE** — Une session ouverte depuis plus de 24 h déclenche une **alerte**, pas
une clôture automatique : clôturer sans comptage physique créerait un écart pire.
**RÈGLE** — Une session est unique **par terminal**, et le terminal est
obligatoire à l'ouverture.
**RÈGLE** — Les totaux par moyen de paiement, le chiffre d'affaires et le nombre
de commandes sont **figés** à la clôture.
**RÈGLE** — La dernière clôture peut être **annulée** par le propriétaire, ce qui
contre-passe l'écriture d'écart et remet la session en `open`.
**À LIVRER** — Les quatre règles ci-dessus.
**ABANDONNÉ** — L'état intermédiaire `recounting` : remplacé par l'annulation de
clôture.
**OUVERT** — Le numéro de session lisible (`SHF-YYYYMMDD-NN`) : recommandé, non
tranché.

### 6.4 Hors ligne

**FAIT** — `offline_payments_enabled` = `false` : **la vente hors ligne est
désactivée en production.** Toute la machinerie existe et est testée (file
d'attente durable en IndexedDB, rejeu ordonné, quarantaine ADR-018), mais elle ne
s'arme pas.

**FAIT** — Quatre genres d'intention en file : envoi comptoir, encaissement
multi-règlement, encaissement espèces mono-règlement (**lecture seule**, plus
jamais émis) et commande de tablette. Format **append-only** : un genre publié ne
se supprime jamais.

**FAIT** — La décision 5 de l'ADR-018 **n'est pas implémentée** : un règlement
définitivement rejeté au rejeu part en quarantaine **sans alerte en caisse**. Le
seul consommateur du résultat de rejeu ignore le champ.

**OUVERT** — Un article peut-il même entrer au panier hors ligne ? Le prix client
est demandé au serveur à chaque ajout et n'est pas préchargé. À confirmer en
boutique, cloud coupé, hub allumé.

---

## 7. Cuisine, tablette, écran client, impression

**FAIT** — **Trois** postes de dispatch : `kitchen`, `barista`, `display`, plus
`none`. Il n'existe ni quatrième poste, ni vue serveur consolidée, ni code
`hot_kitchen`.

**FAIT** — Les seuils d'âge de ticket et l'archivage automatique sont des
réglages **globaux**. Le son n'a qu'un interrupteur global, sans volume ni
réglage par poste.

**FAIT** — Le KDS fonctionne **hors ligne** : cache local, journal, rejeu et
réconciliation au retour du réseau.

**FAIT** — Le seul son existant est celui de l'écran cuisine. Il n'y a **aucun**
signal sonore au comptoir ni au back-office.
**À LIVRER** — Le son « commande prête » au comptoir.

**FAIT** — Une commande envoyée en cuisine est **verrouillée** : la retirer ou en
baisser la quantité exige un PIN et déclare une perte sur le différentiel
(ADR-010). La tablette de salle ne modifie ni n'annule une commande envoyée.

**FAIT** — L'écran client est une **fenêtre du même navigateur** que la caisse,
pas un client réseau. Posé sur un appareil séparé, il ne reçoit pas le panier. Il
reste la vitrine et la file de retrait. Aucun écran n'est appairé en production, et
la vitrine n'a aucun produit sélectionné.
**RÈGLE** — Ce fonctionnement est celui voulu. Les quatre réglages d'écran client
existants font le périmètre.
**ABANDONNÉ** — Le panier sur appareil séparé, la promo et les points en direct,
l'atténuation d'écran après inactivité.

**FAIT** — Impression : il **n'y a pas** de file d'attente persistante au sens
d'un rejeu automatique, mais il **y a** un journal persistant par terminal et un
bouton de relance manuelle par travail. Un ticket de poste déjà confirmé ne se
relance pas.

**RÈGLE** — *(Demande de Mamat, 2026-11-09.)* Avant le paiement, on peut
imprimer une **addition chiffrée** à présenter au client : le prix de chaque
ligne et les totaux. Celui qui l'imprime choisit l'imprimante : celle de la
caisse ou celle des serveurs. Elle s'imprime depuis la caisse **et** depuis la
tablette des serveurs *(précision de Mamat, 2026-11-09)*.
**À LIVRER** — Cette addition. Aujourd'hui elle n'affiche aucun prix, et pour
une commande de table elle sort toujours sur l'imprimante des serveurs.

**RÈGLE** — *(Demande de Mamat, 2026-11-09.)* Le nombre d'exemplaires du ticket
de commande imprimé sur l'imprimante des serveurs se règle, comme celui des
postes de préparation : un exemplaire par défaut, zéro pour ne pas imprimer
*(précision de Mamat, 2026-11-09)*.
**À LIVRER** — Ce réglage. Aujourd'hui ce ticket sort toujours en un seul
exemplaire.

**FAIT** — Le hub réseau autorise **par appareil** : code d'appairage à usage
unique, secret individuel, permissions par sujet, comparaison en temps constant
(ADR-034). Le modèle « secret partagé de boutique avec repli ouvert » n'existe
plus. TLS obligatoire au démarrage.
**À LIVRER** — Le runbook de mise en service du hub, dû et jamais écrit.

**FAIT** — La coquille Android **refuse le trafic en clair par défaut** et
n'autorise qu'une liste d'hôtes nommés : les trois adresses de développement et
le seul hub de la boutique. C'est exactement ce que demande l'**ADR-029, ACTÉ**,
dont la conséquence 1 exige que cette autorisation reste étroite. Le schéma
`http` de la coquille est ce qui permet au bus LAN en `ws://` de passer : une
page servie en `https` ne peut pas l'ouvrir.

**RÈGLE** — Le LAN doit passer en HTTPS et WSS (**ADR-034**). Mais cet ADR porte
le statut **projet**, et il subordonne lui-même sa mise en production à un
certificat accepté par les terminaux, un compte de service, des ACL système et
une mise à jour coordonnée des terminaux. Il écrit qu'il n'autorise aucun
déploiement production ni installation boutique.
**À LIVRER** — Ce chantier entier, gouverné par l'ADR-034 et sa spécification
d'exécution `docs/specs/006x-lan-device-security.md`.
**Ne jamais retirer l'autorisation en clair seule** : la cuisine cesserait de
recevoir dès la première coupure d'internet, c'est-à-dire la panne même que
l'ADR-029 corrige.

---

## 8. Stock, inventaire, vitrine

### 8.1 Principes

**FAIT** — Le stock est un **ledger append-only** : une erreur ne se corrige pas
en réécrivant le passé, mais par un mouvement inverse daté. 19 types de mouvement
existent. Les écritures passent exclusivement par des fonctions
`SECURITY DEFINER` ; la RLS révoque la modification et la suppression.

**FAIT** — Le coût unitaire d'un mouvement est exprimé en **unité de base**
(quantité multipliée par le facteur, coût divisé par le facteur à la réception).

**FAIT** — Le coût moyen pondéré est recalculé par un seul déclencheur, sur les
réceptions et les entrées de production. Il **se réinitialise** — il ne se pondère
pas — quand le stock de départ est nul ou négatif. Il se pondère contre le stock
**au moment de la saisie**, pas à la date de réception.
**RÈGLE** — Ces deux comportements sont ceux voulus ; ils doivent être écrits.

**FAIT** — Le stock négatif est autorisé à la vente (réglage global), **toujours
bloqué** pour une commande B2B quel que soit le réglage (ADR-036), et bloqué en
production sauf forçage sous permission dédiée (ADR-008).

**FAIT** — Un produit dont le suivi est désactivé voit **quand même** son
compteur décrémenté à la vente : la valeur devient fantôme. Un produit non suivi
est déjà en négatif.
**RÈGLE** — Le compteur d'un produit non suivi ne doit plus bouger.
**À LIVRER** — Rendre la décrémentation conditionnelle au suivi.

### 8.2 Péremption et lots — **ABANDONNÉ**

**FAIT** — Contrairement à l'ADR-004, la mécanique de lots **tourne** : la
fonction qui écrit tous les mouvements de stock sélectionne les lots par date de
péremption et les consomme en premier entré premier sorti ; les lots sont créés à
chaque réception et à chaque fournée dès que le produit porte une durée de
conservation. 21 lots actifs au 2026-11-09, créés du 2026-10-31 au 2026-11-08,
**tous avec une date de péremption**. 8 produits portent une durée de
conservation. Les deux grilles du POS lisent les lots toutes les 60 secondes et
peuvent désactiver une tuile.

**RÈGLE** — **Pas de dates de péremption, pas de consommation premier entré
premier sorti.** L'ADR-004 reste la règle.
**À LIVRER** — Retirer le bloc de résolution de lot de la primitive d'écriture,
la création de lots déclenchée par la durée de conservation, la lecture POS et la
désactivation de tuile. Décider du sort des 21 lots existants.
**ABANDONNÉ** — Le rapport de rotation des périssables, dont la route survivait.

### 8.3 Vitrine

**RÈGLE** — **Le stock de vitrine n'influence pas le stock général : il est
dissocié. Il sert seulement à éviter les ventes sans stock disponible.**

**FAIT** — Le code est conforme : aucune des six fonctions de vitrine ne touche
le stock général, n'écrit de mouvement général ni n'émet d'écriture comptable. Le
journal de vitrine distingue les quatre gestes.

**FAIT** — Du 2026-10-31 au 2026-11-08 : 1 416 ventes (−1 866,57 unités), 398
entrées (+2 491), 8 pertes déclarées (−14), **4 recomptages (−30)**.

### 8.4 Inventaire tournant

**FAIT** — Le comptage est à l'aveugle. L'attendu est figé **à l'ajout de la
ligne** ; l'écart est une colonne calculée ; la finalisation applique **l'écart**
au stock du moment. Tout ce qui bouge entre l'ajout et la finalisation est donc
compté deux fois. 3 inventaires, 2 finalisés.

**FAIT** — La finalisation exige le rôle propriétaire **et** refuse si celui qui
finalise a compté. Avec un seul compte propriétaire, un inventaire compté par
Mamat ne peut pas être finalisé.

**RÈGLE** — La finalisation **pose le stock à la quantité comptée** (valeur
absolue), conformément à l'ADR-027.
**RÈGLE** — Le propriétaire **peut** finaliser un inventaire qu'il a compté. La
séparation des tâches disparaît de l'inventaire, en connaissance de cause.
**À LIVRER** — Les deux règles ci-dessus.

### 8.5 Déclaration et approbation

**FAIT** — Les ajustements et les pertes de stock passent par un circuit
**déclaration puis approbation** : le geste ne touche le stock qu'après
approbation du propriétaire, par une personne différente du déclarant. Cette
règle ne figure dans aucun document : elle vit dans un commentaire de migration.
**3 déclarations sont en attente.**

**RÈGLE** — Le circuit est voulu et doit être gravé dans un ADR, avec une cadence
de traitement de la file. Pas d'alerte automatique.
**À LIVRER** — L'ADR et le traitement des 3 déclarations en attente.

### 8.6 Motifs de perte

**FAIT** — La production a une liste fermée de motifs : `mis_baked`,
`poor_proofing`, `cosmetic`, `demo`, `recipe_test`, `tasting`. Le stock et la
vitrine, eux, utilisent du **texte libre**.

**RÈGLE** — Les pertes de stock et de vitrine doivent avoir une **liste fermée**
de motifs, côté base, comme la production.
**À LIVRER** — Étendre un type énuméré aux deux chemins.

### 8.7 Alertes

**FAIT** — L'alerte de stock bas ne peut pas se déclencher : **245 des 249
produits suivis ont un seuil à zéro**, et aucune adresse de notification n'est
configurée. L'écran affiche une liste vide qui se lit comme « tout va bien ».

**RÈGLE** — L'écran doit **dire qu'il ne sait pas** : bandeau comptant les
produits suivis sans seuil. Pas de promesse d'e-mail.
**À LIVRER** — Le bandeau, puis la saisie des seuils par Mamat.

### 8.8 Abandonné dans ce domaine

**ABANDONNÉ** — La réservation de stock (table, fonctions, module de calcul et
les deux filtres d'écran qui ne ramènent jamais rien). Les transferts entre
zones, supprimés par l'ADR-027. Les allergènes, supprimés par l'ADR-011 : **ne
pas rebâtir**.

---

## 9. Production et recettes

**FAIT** — Nomenclature avec sous-recettes, versions figées à chaque changement,
pourcentages boulanger, semi-finis stockés. La cascade de production **s'arrête
au premier intermédiaire suivi en stock** (ADR-016), côté serveur comme à
l'affichage.

**FAIT** — Le calcul du **coût de revient** reste hors de cette règle et descend
jusqu'aux feuilles. Écart connu de l'ADR-016, jamais mesuré.

**FAIT** — L'annulation d'une fournée contre-passe le stock et les écritures mais
**ne défait pas le coût moyen** qu'elle a posé.
**OUVERT** — Restaurer le coût antérieur : recommandé, non tranché.

**FAIT** — Une fournée dont une partie est déjà vendue ne peut pas être annulée,
et le message d'erreur renvoie vers un ajustement qui ne corrige que le produit
fini : la matière consommée à tort reste sortie.
**RÈGLE** — Un ajustement de stock doit pouvoir porter **à la fois** sur le
produit fini et sur les matières, saisi par le propriétaire.
**À LIVRER** — Ce chemin de correction.

**FAIT** — Le chiffrage du manque avant une fournée n'est visible **que** par le
propriétaire ; le boulanger voit les quantités requises et découvre la pénurie au
refus serveur. Levé par la règle de visibilité par permission (§5.2).

**FAIT** — Les suggestions de production couvrent **3 jours**, en dur, et
l'arrondi est entier.
**RÈGLE** — La quantité suggérée s'arrondit au pas métier (douzaines, dizaines).
La couverture reste à 3 jours.
**À LIVRER** — L'arrondi.

**ABANDONNÉ** — Le suivi des causes d'écart de rendement : l'écran de saisie
n'était importé par personne. Les trois composants, leurs tests et le réglage de
seuil sont à supprimer. Les rapports montreront l'écart **sans** la cause.
**ABANDONNÉ** — Le planning de production hebdomadaire : table et fonction sans
aucun appelant, zéro ligne en production.

---

## 10. Achats et fournisseurs

**FAIT** — Cycle de vie réel d'un bon de commande : `draft`, `pending`,
`partial`, `received`, `cancelled`. Il n'existe ni `sent`, ni `confirmed`, ni
`partially_received`. La réception partielle existe, sous le nom `partial`.

**FAIT** — 123 bons de commande, 119 réceptions, 51 paiements fournisseur.

**FAIT** — La TVA d'une réception est **non récupérable** et foldée dans le coût
du stock, ce qui est correct pour un statut NON-PKP (ADR-003, ADR-005).

**FAIT** — Une réception erronée n'a **aucun** geste de correction. L'annulation
du bon est refusée dès qu'une réception existe et renvoie vers un retour
fournisseur inexistant.
**RÈGLE** — Une réception doit pouvoir être **annulée**, en contre-passant le
mouvement de stock, le coût moyen et la dette fournisseur.
**À LIVRER** — Cette annulation. La marchandise avariée rendue au fournisseur
reste sans chemin : à noter comme limite.

**FAIT** — Ni frais de port, ni escompte n'existent sur un bon de commande. Une
facture avec port ne peut pas être saisie à son montant réel.
**RÈGLE** — Les frais de livraison **et** les escomptes (global et par ligne)
doivent exister, le port étant réparti au prorata sur les lignes.
**À LIVRER** — Les deux.

**FAIT** — La fiche fournisseur calcule l'impayé depuis le **statut du bon**,
sans lire les paiements : un bon à crédit entièrement reçu et jamais payé est
compté payé. Le rapport des paiements, lui, lit le vrai journal.
**RÈGLE** — Une seule réponse à « combien je lui dois », celle du journal des
paiements.
**À LIVRER** — Brancher la fiche sur le journal.

---

## 11. Comptabilité et taxes

### 11.1 Régime fiscal

**FAIT** — Statut **NON-PKP** : pas de TVA nationale en sortie. Taxe locale
**PBJT / PB1 à 10 %, incluse dans le prix** (`total × 10 / 110`), juridiction
Lombok Tengah (ADR-003, ADR-005).

**FAIT** — La PB1 crédite le compte **2110 « PB1 (10%) Payable »**, et lui seul.
Le compte 2143 existe, est actif et postable, et n'est la cible d'aucun mapping.
Le compte 2142 « VAT Output » est actif, postable et agrégé au bilan avec la taxe
à payer, dans un plan NON-PKP.
**RÈGLE** — Désactiver 2143 et 2142, comme 1151 l'a été.
**À LIVRER** — Les deux désactivations.

**RÈGLE** — **La vente B2B n'est pas assujettie à la PB1.** Exonération
confirmée. Elle doit être gravée dans un ADR : aujourd'hui elle ne vit que dans
un commentaire de fonction, invisible à tout contrôle.
**FAIT** — Chiffre d'affaires B2B 63 534 500 IDR, dont 4 181 133 IDR portent une
PB1 issue de la reprise historique d'octobre.

### 11.2 Plan de comptes réel

**FAIT** — Les comptes mouvementés sont `1110` Caisse, `1111` Petite caisse,
`1112` Banque, `1115` Attente QRIS, `1116` Attente carte, `1131` Clients,
`1132` Clients B2B, `1141` Stock général, `1142` Matières premières,
`1143` Produits finis, `2110` PB1 à payer, `2141` Fournisseurs,
`2210` Fidélité, `2220` Avoirs client, `2230` Avances client, `3100` Capital,
`3110` Prélèvements, `4100` Ventes, `4131` Ventes B2B, `4510` Produit
d'ajustement, `4900` Remises, `4910` Gain d'écart de caisse, `4920` Avoirs
périmés, `5110` Coût de production, `5210` Pertes, `5910` Perte d'écart de
caisse, `6111`-`6117` et `6190` Charges, `6510` Charge d'ajustement,
`6520` Créances irrécouvrables. 46 mappings événement vers compte.

**Les comptes `1120`, `1300`, `1400`, `5200` et les douze comptes de charge
annoncés par les anciennes fiches n'existent pas.** `2100` et `5100` existent
mais sont des groupes non postables. `4900` est un **contre-produit** (remises),
pas un produit exceptionnel.

### 11.3 Le défaut structurel à corriger

**FAIT** — **La vente ne produit aucune écriture de coût de revient.** Le
déclencheur comptable des mouvements de stock ne traite pas le type `sale`.
Conséquences mesurées au 2026-11-09 :

| Compte | Solde |
|---|---|
| `4100` Ventes | **529 959 445 IDR** |
| `5110` Coût de production | **1 700 IDR** |
| `5210` Pertes | 122 900 IDR |
| `1141` Stock général | **+283 800 003 IDR** |
| `1142` Matières premières | **−34 767 500 IDR** (actif à solde créditeur) |
| `1143` Produits finis | **+34 765 800 IDR** |
| `1115` Attente QRIS | **+152 165 000 IDR**, jamais soldé |
| `1116` Attente carte | **+254 666 000 IDR**, jamais soldé |
| `1112` Banque | **−130 180 205 IDR** |
| `4510` Produit d'ajustement | **−91 225 600 IDR** |

**FAIT** — La chaîne des comptes de stock ne se raccorde pas : les achats
débitent `1141`, la production consomme `1142` que rien n'alimente, produit
`1143` que rien ne solde, et la vente ne touche rien.

**RÈGLE** — **La vente doit reconnaître le coût de revient** et relever le stock.
La chaîne de comptes doit être raccordée : achats vers matières premières,
production vers produits finis, vente vers coût des ventes.
**À LIVRER** — Ce chantier, qui conditionne tout résultat et tout bilan.

**RÈGLE** — Un règlement B2B doit utiliser **la même** table moyen-vers-compte
que la vente (ADR-013 décision 3). Aujourd'hui un règlement B2B en QRIS va en
banque alors qu'une vente QRIS va au compte d'attente.
**À LIVRER** — Unifier, **avant** tout rapprochement bancaire.

**RÈGLE** — Les comptes d'attente doivent être soldés par le **rapprochement
bancaire**, mois par mois depuis l'ouverture.
**À LIVRER** — Les 4 fonctions de rapprochement absentes de la production, puis
le rapprochement lui-même.

### 11.4 Écritures par événement

**FAIT** — Émetteurs réels, après vérification des corps live :

| Événement | Débit | Crédit |
|---|---|---|
| Vente payée | compte du moyen de paiement, une ligne par règlement | Ventes + PB1 |
| Annulation | Ventes + PB1 (+ fidélité si rachat) | comptes des règlements |
| Remboursement | Ventes + PB1 | compte du règlement |
| Remise | Remises | contre-produit |
| **Coût de la vente** | **aucune écriture** | — |
| Perte de stock | Pertes | Stock général |
| Production, sortie matière | Coût de production | Matières premières |
| Production, entrée produit | Produits finis | Coût de production |
| Ajustement, inventaire | Stock ou charge d'ajustement | Produit d'ajustement ou stock |
| Réception | Stock général (sous-total + TVA) | Fournisseurs |
| Paiement fournisseur | Fournisseurs | Caisse ou banque |
| Dépense approuvée | compte de la catégorie, montant TTC | Fournisseurs si crédit, **sinon petite caisse immédiatement** |
| Écart de caisse | Perte d'écart | Gain d'écart |
| Avoir client | selon le geste | Avoirs client |
| Vente B2B | Clients B2B | Ventes B2B, **taxe à zéro** |

**FAIT** — Un mouvement dont la valorisation est nulle n'émet **aucune**
écriture. 14 produits suivis sont à coût zéro.
**RÈGLE** — Ce comportement doit être écrit comme une limite assumée.

### 11.5 Périodes fiscales

**FAIT** — Statuts `draft`, `open`, `closed`, `locked`. Il n'existe pas de
`pending_closure`. Le contrôle de période est appelé par **tous** les émetteurs,
**y compris l'écriture de vente** : clôturer le mois en cours **arrête la
caisse**, et aucune fonction ne peut rouvrir une période. 24 périodes, **toutes
ouvertes**, jusqu'au 2027-12-31.

**RÈGLE** — Une réouverture de période doit exister, réservée au propriétaire,
sous PIN et tracée.
**À LIVRER** — Cette réouverture, **avant** toute première clôture.

### 11.6 Dépenses

**FAIT** — Statuts `draft`, `submitted`, `approved`, `rejected`, `paid`. Il
n'existe ni `cancelled`, ni `pending_approval`, et **aucun geste n'annule une
dépense soumise ou approuvée**.

**RÈGLE** — Pour une dépense en **espèces**, approbation et paiement sont le même
geste : l'argent sort de la petite caisse à l'approbation. Assumé.

**RÈGLE** — Toute dépense sous le seuil de 100 000 IDR est **auto-approuvée par
son créateur**, sans contrôle de rôle ni PIN. Assumé. **Conséquence** : la
permission `expenses.create` devient un droit sensible, à ne donner qu'à des
personnes de confiance.
**FAIT** — 11 dépenses en production, dont 2 auto-approuvées pour 92 000 IDR.

**FAIT** — Six catégories de dépense sur douze atterrissent **toutes** sur le
compte « autres charges ».
**RÈGLE** — Créer un compte dédié par nature (transport, assurance, taxes, frais
bancaires, bureau) et réaffecter les catégories.
**À LIVRER** — Les comptes et la réaffectation.

**OUVERT** — Annuler une dépense après soumission : recommandé, non tranché.

---

## 12. Clients, fidélité, B2B

**FAIT** — 4 catégories de clients : `Corporate` (tarif de gros, 21 clients),
`Staff` (public, 15), `Cafe Customer` (public, 6), `Owner` (public, 1). **Aucune
catégorie n'est en mode prix personnalisé.**

**FAIT** — Deux leviers de prix client existent : le prix négocié par client (10
clients, 21 lignes) et le mode tarifaire de la catégorie. Le troisième palier,
prix par catégorie et par produit, est câblé et **vide**.
**ABANDONNÉ** — Ce troisième palier. Piège signalé : il s'édite depuis la fiche
d'**un** client alors qu'il s'applique à **toute** sa catégorie.

**FAIT** — Fidélité : types de mouvement `earn`, `redeem`, `adjust`, `refund`.
1 point par tranche de 1 000 IDR dépensée, **1 point = 10 IDR** au rachat, par
multiples de 100 points, soit un taux de retour de **1 %**. Les points sont
gagnés **après** toutes les remises, après le rachat et après extraction de la
taxe. 9 clients ont des points. Conversion des points en avoir disponible.

**ABANDONNÉ** — La remise automatique par palier de fidélité, le bonus
anniversaire configurable et la livraison offerte. Les paliers ne servent qu'au
**multiplicateur de points**.
**ABANDONNÉ** — Le numéro de membre et le code QR client.
**OUVERT** — La base de calcul des points gagnés : recommandé de les calculer
avant remises, non tranché.

**FAIT** — Un combo est facturé au **prix public**.
**RÈGLE** — C'est voulu : un combo est une formule à prix fixe, ni le prix
négocié ni la remise de catégorie ne s'y appliquent.

**FAIT** — B2B : 21 clients, **les 21 sans plafond de crédit**, 14 avec un
encours, **24 285 400 IDR** au total.
**RÈGLE** — **Un plafond absent vaut crédit illimité.** Assumé. Le suivi de
l'encours reste humain ; aucun garde-fou applicatif ne sera ajouté. Le blocage
dur ne joue que sur les clients dont un plafond est saisi volontairement.

**FAIT** — `b2b_settings` est **vide** en production : la page de réglages B2B
lève une erreur serveur à chaque ouverture.
**À LIVRER** — Réinsérer l'enregistrement unique, et vérifier si d'autres
enregistrements uniques manquent.

**FAIT** — Le stock d'une commande B2B sort **à la saisie**, pas au retrait. 119
commandes sont en attente.
**RÈGLE** — Le stock doit sortir **au retrait**.
**À LIVRER** — Le déplacement, le garde-fou de suffisance au retrait, et la
reprise des 119 commandes déjà déduites.

**FAIT** — La facture B2B est numérotée `INV/<année>/<séquence>`, en dur.
L'imputation des règlements est en premier entré premier sorti, avec ciblage
manuel possible.

---

## 13. Promotions et combos

**FAIT** — Six mécaniques existent et sont évaluées par le serveur :
pourcentage, montant fixe, un acheté un offert, produit offert, palier, formule.
**Le formulaire du back-office n'en propose que quatre** : le palier et la formule
ne sont configurables qu'en base.
**À LIVRER** — Ouvrir le palier et la formule dans le formulaire.

**FAIT** — Le **cumul** de promotions existe, piloté par un drapeau par
promotion. **Il n'y a aucune sélection de la « meilleure » promo** : l'ordre est
la priorité saisie, puis la date de création.

**FAIT** — L'évaluation est **serveur d'abord**, à chaque changement de panier,
avec repli silencieux sur un moteur TypeScript local en cas d'échec. Ce repli
ignore les plafonds d'usage par conception.

**FAIT** — Une promotion ciblée produit ou catégorie calcule sa remise sur le
prix **envoyé par la caisse**, et le contrôle de cohérence compare deux valeurs
issues de ce même prix : il ne détecte rien. Zéro promotion active aujourd'hui,
la faille est dormante.
**RÈGLE** — L'évaluation doit relire les prix serveur. **Prérequis à la création
de la première promotion ciblée produit ou catégorie.**
**À LIVRER** — Cette relecture.

**FAIT** — Le seuil de montant minimum de panier n'est pas évalué sur la même
base à l'affichage et au paiement.
**OUVERT** — Harmoniser avant les remises de ligne : recommandé, non tranché.

**ABANDONNÉ** — Les codes promo. Les conditions par type de commande, par moyen
de paiement, par plafond journalier et par ticket. Le ciblage par palier de
fidélité.

**FAIT** — Combos : groupes d'options avec minimum, maximum et obligation,
surcharge par option, modificateurs de composants déduits et restitués
(ADR-017). La période de disponibilité d'un combo a été **supprimée** : le seul
mécanisme horaire du produit est la promotion.
**FAIT** — L'ordre d'affichage des combos est enregistré par le back-office et
**jamais appliqué** au POS, qui trie par nom.

---

## 14. Catalogue

**FAIT** — 379 produits, 35 catégories, 484 modificateurs, 10 groupes de combo,
76 options. Variantes liées par parent et enfant, unités alternatives avec
facteurs, contextes d'unité par produit, sections, postes de dispatch.

**FAIT** — Les énumérations ont **une seule source : Postgres**. Aucune chaîne
littérale dérivée côté TypeScript. Le miroir `enums.ts` omet néanmoins quatre
valeurs de statut de commande : à corriger.

**FAIT** — Le libellé d'une variante **n'est pas modifiable** : la fonction
serveur et le crochet existent, aucun bouton ne les appelle.
**À LIVRER** — Câbler l'édition.

**FAIT** — Il n'existe **aucune photo du coût au moment de la vente** : la marge
est toujours valorisée au coût moyen du jour de lecture. Limite connue, dont le
coût de report augmente chaque jour.

**ABANDONNÉ** — L'interrupteur « produit test » (ADR-035). Le crochet orphelin
est à supprimer.

---

## 15. Rapports

**FAIT** — **40 rapports réels**, répartis en 7 sections dans un hub de 45
tuiles. Socle commun avec bannière d'erreur unifiée et état vide distinct de
l'état d'erreur. Les 214 fonctions de rapport appelées existent toutes.

**FAIT** — Les anciennes fiches décrivaient **au présent** une vingtaine de
rapports inexistants (prévision de recettes, analyse ABC, valeur vie client,
mouvements fantômes, stock périmé, et une quinzaine d'autres). Aucun n'existe.

**FAIT** — Deux vues matérialisées (`mv_sales_daily`, `mv_pl_monthly`) ne sont
**jamais peuplées** en production, et aucune fonction applicative ne les lit.
**ABANDONNÉ** — La tendance de rentabilité sur 12 mois. Les deux vues sont à
supprimer : tout rapport qui s'y brancherait échouerait.

**FAIT** — Le « rapport de coût de production » mesure en réalité des **achats
commandés**, réception non incluse.
**RÈGLE** — Le renommer « dépense d'achat ». Un vrai coût des ventes viendra du
chantier comptable.

**FAIT** — Le rapport des dépenses inclut les dépenses **soumises** non
approuvées, alors que l'écriture n'est émise qu'à l'approbation.
**OUVERT** — Afficher « engagé » et « comptabilisé » séparément : recommandé, non
tranché.

**FAIT** — Quatre pages de marketing existent, routées et navigables : retour sur
investissement par promotion, segments, cohortes, anniversaires.

---

## 16. Piste d'audit

**FAIT** — Deux journaux distincts et **append-only** : `audit_logs` (21 172
lignes) pour les gestes métier, et `pos_events` pour le journal opérationnel du
POS, partitionné par mois.

**FAIT** — `audit_logs.actor_id` attend un identifiant de **profil applicatif**,
jamais l'identifiant d'authentification. Les colonnes `metadata` (contexte) et
`payload` (différentiel) sont distinctes et ne se fusionnent pas. Aucune
insertion directe depuis le code applicatif.

**FAIT** — Les sept tables écrites en direct par le back-office (fournisseurs,
promotions, appareils LAN, jours fériés, trois familles de modèles) **sont**
auditées par déclencheur depuis le 2026-11-04. Seule exception : le déclencheur
des promotions ne couvre pas la **suppression**.
**À LIVRER** — Étendre ce déclencheur à la suppression.

**FAIT** — Le journal du POS écrit tout dans sa partition par **défaut** depuis
le 2026-10-07 : 9 741 lignes, et il n'existe aucune partition pour octobre ni
novembre. Créer ces partitions échouera désormais sans déplacer les lignes
d'abord.
**À LIVRER** — Régulariser le partitionnement.

**FAIT** — Trois permissions du catalogue ne contrôlent **rien** :
`audit_log.read`, `users.view_audit`, `settings.kiosk.manage`.
**À LIVRER** — Les retirer du catalogue.

---

## 17. Exploitation

**FAIT** — Aucune sauvegarde autonome. PITR **désactivé**. La restauration n'a
jamais été éprouvée. 11 jours d'argent réel reposent sur les seules sauvegardes
physiques quotidiennes de Supabase.

**FAIT** — Le dépôt porte une chaîne de sauvegarde chiffrée complète et testée
qu'**aucun runbook ne mentionne**, et dont le script d'installation de tâche
Windows n'enregistre en réalité aucune tâche.

**RÈGLE** — Installer la tâche quotidienne, écrire le runbook de restauration, et
**éprouver une restauration réelle une fois**. Décider et écrire où est gardée la
clé privée de reprise : une sauvegarde chiffrée dont la clé se perd n'est pas une
sauvegarde.
**À LIVRER** — Ce chantier, le plus urgent de tous.

**FAIT** — Trois migrations planifient des tâches dont l'adresse est **écrite en
dur sur le projet de développement**. Inerte uniquement parce qu'aucune tâche
n'est installée.
**RÈGLE** — L'adresse du projet passe par un réglage lu en base.
**À LIVRER** — Avant toute installation de tâche planifiée.

**ABANDONNÉ** — Les notifications par e-mail. Les deux Edge Functions d'envoi ne
sont pas déployées, aucune clé de prestataire n'est posée, et les tables
concernées sont vides. La promesse d'envoi est à retirer des documents. Le code
reste dormant.

**FAIT** — Quatre fonctions appelées par le back-office **déployé** n'existent pas
en production : comptabilisation et lecture du compte d'attente du rapprochement
bancaire, aperçu et application de l'import de journal de caisse. Quatre écrans
sont donc cassés en production dès maintenant.
**À LIVRER** — Les livrer. C'est la seule panne **active**.

---

## 18. Invariants techniques opposables

Ces règles ne sont pas négociables sans nouvel arbitrage. Elles complètent
`AGENTS.md`, qui reste la loi.

1. **Les écritures de commande passent exclusivement par des fonctions
   `SECURITY DEFINER`.** Jamais d'insertion brute. La création de vente passe par
   l'Edge Function de paiement.
2. **Le ledger de stock est append-only.** Aucune modification, aucune
   suppression. Écritures par fonction serveur uniquement.
3. **La piste d'audit est append-only** et ne reçoit aucune insertion directe du
   code applicatif.
4. **Le PIN voyage en en-tête HTTP vers une Edge Function, en argument vers une
   fonction Postgres.** Jamais dans un corps JSON : les corps sont journalisés.
   Le critère d'audit n'est pas le véhicule mais : la cible vérifie-t-elle le PIN,
   avec verrouillage ?
5. **Les versions de fonction sont monotones.** Jamais éditer une version
   publiée : créer la suivante et supprimer l'ancienne dans la même migration.
   Tout nouveau corps part du **corps live**, jamais du fichier d'origine.
6. **Deux saveurs d'idempotence** : en-tête HTTP pour le retry d'Edge Function,
   argument de fonction pour l'idempotence métier.
7. **Le format de la file hors ligne est append-only.** Un genre d'intention
   publié ne se supprime jamais : on ajoute, on garde l'ancien en lecture.
8. **`packages/domain` est sans entrée-sortie** : ni requête, ni React, ni
   stockage. Imposé par la configuration de lint.
9. **Les énumérations ont une source unique : Postgres.**
10. **Le prix d'une ligne se calcule par les fonctions du domaine.** Jamais de
    recomposition manuelle. Une garde d'intégration continue l'impose.
11. **Pas d'alpha sur un jeton de couleur nu.** Seule la famille des couleurs de
    catégorie l'accepte.
12. **Les noms de canaux temps réel sont uniques par montage.**
13. **La cible de base est Supabase cloud.** Jamais Docker local.
14. **Toute migration régénère les types TypeScript.** Première cause
    d'intégration continue cassée.

---

## 19. Ce qui reste ouvert

À trancher avant la fin du projet. Ne pas deviner.

| # | Sujet | Recommandation |
|---|---|---|
| 1 | La reprise d'une commande de tablette la remet en `draft` | Conserver `pending_payment` |
| 2 | Base de calcul des points de fidélité | Avant remises, et écrire la valeur du point |
| 3 | Base du seuil de montant minimum de panier | Avant les remises de ligne, partout |
| 4 | L'annulation de fournée ne défait pas le coût moyen | Restaurer le coût antérieur |
| 5 | Aucune annulation de dépense après soumission | Ouvrir ce geste |
| 6 | Le rapport des dépenses compte les dépenses soumises | Séparer « engagé » et « comptabilisé » |
| 7 | Numéro de session de caisse lisible | Le livrer |
| 8 | Chemin de secours d'authentification si l'Edge Function tombe | À décider |
| 9 | Un article peut-il entrer au panier hors ligne ? | À confirmer en boutique |
| 10 | La journée du 2026-11-02 : fermeture ou panne ? | À confirmer |

---

## 20. Documents vivants

| Document | Rôle |
|---|---|
| `AGENTS.md` | **La loi du dépôt.** Gagne sur tout autre document. |
| `docs/adr/` | Les 34 décisions arbitrées, **immuables**. |
| **Ce fichier** | La synthèse fonctionnelle : ce qui est, ce qui est décidé. |
| `docs/audit-2026-11/01` à `04` | Le relevé d'audit du 2026-11-09 et les arbitrages, avec leurs preuves. |
| `docs/audit-2026-11/05_MASTER_PLAN_FINITION.md` | Le plan de fin de projet en 4 sprints. |
| `docs/runbooks/` | Les procédures d'exploitation et les relevés datés. |
| `docs/_archive_obsolete/` | **Ne pas lire.** Documents périmés conservés pour l'historique. |
