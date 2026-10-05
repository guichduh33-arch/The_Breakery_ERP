# Caisse : que faire pendant une coupure Internet ?

## Conditions pour continuer à travailler

La caisse possède un mode hors ligne. Il exige une application déjà chargée,
une session déjà ouverte, un catalogue disponible et un relais local (hub)
joignable sur le réseau de la boutique. Le réglage autorisant les paiements
hors ligne doit être activé ; il est désactivé par défaut.

Une adresse web ne garantit pas à elle seule le fonctionnement hors ligne.
Le Wi-Fi et le relais local doivent continuer à fonctionner même si la
connexion Internet tombe. Une panne électrique ou une panne du réseau local
est un autre incident.

## Pendant la coupure

- Les ventes prises en charge par le mode hors ligne sont conservées sur
  l'appareil, en attente de transmission à la base centrale.
- Les espèces peuvent être encaissées.
- Pour la carte, QRIS, le virement ou les portefeuilles électroniques, vérifier
  que le paiement a réellement abouti sur le moyen de paiement externe avant
  de l'enregistrer dans la caisse. Celui-ci doit disposer de la connexion
  nécessaire, par exemple celle de son propre terminal mobile.
- Le paiement par avoir client est indisponible : son solde exige une
  vérification sur le serveur.
- Le back-office ne reçoit pas les nouvelles ventes tant qu'elles ne sont
  pas synchronisées. Les rapports ne reflètent donc pas encore ces ventes.

Garder la caisse ouverte. Ne pas effacer les données du navigateur, changer
de navigateur ou désinstaller l'application : les ventes en attente sont
stockées sur cet appareil.

La tablette refuse une nouvelle commande hors ligne si la correspondance
entre ses produits et les stations cuisine est indisponible ou incomplète.
Reconnecter la tablette pour recharger ce routage avant l'envoi. Un produit
explicitement configuré sans station reste accepté. L'ajout à une commande
existante est indisponible hors ligne.

## Réponse perdue après un envoi ou un mouvement de caisse

Une absence de réponse ne prouve pas que le serveur a refusé l'opération.
La caisse conserve dans le même onglet la requête et son identifiant pour
un envoi cuisine incertain ou un dépôt/retrait incertain. Reprendre cette
tentative avec le caissier, la session et la caisse d'origine avant une autre
opération ; ne pas la ressaisir sous un nouvel identifiant. Fermer la fenêtre
du mouvement ne supprime pas la tentative. Un refus de droits lors de sa
reprise ne suffit pas à conclure que le mouvement initial n'a pas eu lieu.

Cette conservation dans le même onglet ne garantit pas une reprise après
fermeture du navigateur. Ne pas effacer ses données. Si la reprise est
bloquée, conserver le poste en l'état et demander une investigation.

## Limites au redémarrage

Le redémarrage du POS web sans Internet n'est pas garanti : sa configuration
Vite actuelle ne fournit pas de service worker pour charger l'application
hors ligne. Une nouvelle connexion par PIN nécessite également Internet.

La tablette Android embarque les fichiers de l'application, mais cela ne
garantit pas la restauration d'une session sans serveur. Consulter le
[guide de fabrication et d'installation Android](tablet-capacitor-build.md)
pour ses réserves et les contraintes d'adresse du relais local.

## Quand Internet revient

Laisser l'application ouverte pour qu'elle transmette les opérations en
attente. Le mécanisme de transmission utilise des identifiants destinés à
éviter de créer deux fois la même opération lors d'une nouvelle tentative.
Cela ne garantit pas que toute opération sera acceptée : vérifier les erreurs
de synchronisation et les opérations restant en attente.

Le rejeu exige une connexion cloud disponible et une session authentifiée,
revalidée par le cloud et non verrouillée. Après une interruption, les
tentatives automatiques sont espacées de 15, puis 30, puis 60 secondes,
avec un intervalle plafonné à 60 secondes. Elles s'arrêtent à la déconnexion
ou au verrouillage ; les identifiants d'origine sont conservés.

Avant de ressaisir une vente, vérifier si elle a déjà été transmise. Comparer
les ventes, les règlements et leur présence dans le back-office. En cas
d'erreur persistante, conserver les données de l'appareil pour investigation.

## Vérification avant utilisation en boutique

Le code prévoit ce fonctionnement ; une validation sur les appareils réels
reste nécessaire. Dans un environnement de test, avec des opérations prévues
à cet effet, vérifier une coupure Internet en gardant le réseau local actif,
l'accès au relais, l'enregistrement d'une vente puis sa transmission unique
au retour de la connexion. Ne pas créer de fausses ventes en production.

Une connexion de secours mobile peut réduire les interruptions. Ce guide
n'atteste ni son installation, ni celle du relais local, ni la réussite d'un
essai de coupure en boutique.

### Livraison vérifiée le 2026-10-05

La [PR #553](https://github.com/guichduh33-arch/The_Breakery_ERP/pull/553)
est fusionnée dans `0bf3f6cc`. Elle protège les reprises incertaines et
l'annulation des commandes envoyées, et corrige le rejeu, le routage tablette,
l'écran client local, les dates des rapports et l'affichage des points.
La migration `20261005000001_guard_discard_locked_orders.sql` est appliquée
sur V3 dev et les types sont régénérés. Les contrôles CI applicatifs,
de gouvernance et la suite pgTAP ont réussi.

La [PR #552](https://github.com/guichduh33-arch/The_Breakery_ERP/pull/552)
de dépendances est fusionnée dans `b2a2e098`. Sa validation SQL manuelle
[pgTAP #361](https://github.com/guichduh33-arch/The_Breakery_ERP/actions/runs/37287058305)
a réussi sur le commit `037a78d0`, avec le secret GitHub Actions existant.
Le run antérieur #360 avait échoué sur les anciens tests, avant actualisation
de la branche ; il ne constitue pas la preuve de cette livraison.

Ces résultats ne valident pas la recette physique multi-appareils, la coupure
WAN réelle, ni l'APK tablette/KDS. Le bundle de ce lot n'a pas été déployé sur
le poste boutique pendant cette livraison. Le cas C2 de
`refund-modal-pin-header.smoke.test.tsx` reste ignoré.

## Sources du comportement

- `apps/pos/src/features/lan/hooks/useOfflinePaymentGate.ts` : conditions
  d'autorisation des paiements hors ligne.
- `apps/pos/src/features/lan/offlineOutbox.ts` : conservation locale des
  opérations et formats des règlements.
- `apps/pos/src/features/lan/offlineReplay.ts` : transmission des opérations.
- `apps/pos/src/features/lan/hooks/useOfflineReplay.ts` : conditions et
  temporisation des nouvelles tentatives.
- `apps/pos/src/features/cart/hooks/counterFireRecovery.ts` et
  `apps/pos/src/features/shift/hooks/cashMovementRecovery.ts` : reprises
  incertaines dans le même onglet.
- `apps/pos/src/features/tablet/hooks/useCreateTabletOrder.ts` : refus
  d'envoi lorsque le routage cuisine manque.
- `apps/pos/vite.config.ts` : configuration de l'application web.

Le scénario de perte de connexion du guide `disaster-recovery.md` contient
encore des consignes anciennes, notamment l'impossibilité générale d'encaisser
et la limitation aux espèces. Ces consignes ne décrivent pas le mode hors
ligne exposé ici ; leur révision globale reste à traiter séparément.
