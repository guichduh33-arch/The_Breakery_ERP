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

## Sources du comportement

- `apps/pos/src/features/lan/hooks/useOfflinePaymentGate.ts` : conditions
  d'autorisation des paiements hors ligne.
- `apps/pos/src/features/lan/offlineOutbox.ts` : conservation locale des
  opérations et formats des règlements.
- `apps/pos/src/features/lan/offlineReplay.ts` : transmission des opérations.
- `apps/pos/vite.config.ts` : configuration de l'application web.

Le scénario de perte de connexion du guide `disaster-recovery.md` contient
encore des consignes anciennes, notamment l'impossibilité générale d'encaisser
et la limitation aux espèces. Ces consignes ne décrivent pas le mode hors
ligne exposé ici ; leur révision globale reste à traiter séparément.
